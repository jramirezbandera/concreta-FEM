/**
 * Numeración de GDL y restricciones por transformación (Felippa, IFEM, caps. 8–9).
 *
 * Cada GDL físico p = 6·nudo + c es de uno de estos tipos:
 * - esclavo: u_p = Σ T_pq·û_q, combinación de GDL independientes (filas de T en CSR, ya con las
 *   cadenas expandidas: un maestro puede ser a su vez esclavo de otra restricción);
 * - libre: independiente y con rigidez; es una ecuación del sistema;
 * - coartado: independiente con apoyo; su valor lo da el caso (0 por defecto);
 * - sin rigidez: independiente y sin ningún elemento ni muelle que lo rigidice (directa o a
 *   través de sus esclavos). Se restringe solo, con aviso si el nudo tiene elementos.
 *
 * Los GDL independientes se identifican por su propio índice físico p.
 */
import { Diagnosticos, listaIds } from "./diagnosticos.ts";
import { gdlRigidizados, TOL_GEOMETRICA, type ElementoMotor, type Geometria } from "./elementos.ts";
import { NOMBRES_GDL, type ModeloAnalitico } from "./modelo.ts";

export const TipoGdl = { Libre: 0, Coartado: 1, Esclavo: 2, SinRigidez: 3 } as const;

export interface Numeracion {
  nNudos: number;
  tipo: Uint8Array;
  /** Ecuación de cada GDL físico libre; −1 en los demás. */
  ecuacion: Int32Array;
  nEcuaciones: number;
  /** GDL físico de cada ecuación. */
  gdlDeEcuacion: Uint32Array;
  /** Fila de T de cada GDL esclavo (−1 si no lo es): índice en `tPtr`. */
  filaEsclavo: Int32Array;
  tPtr: Uint32Array;
  /** GDL independientes (físicos) de cada fila de T y sus coeficientes. */
  tIdx: Uint32Array;
  tVal: Float64Array;
  /** GDL físicos coartados por apoyo. */
  coartados: Uint32Array;
  nEsclavos: number;
  nSinRigidez: number;
}

const COMPONENTES_DIAFRAGMA = [0, 1, 5] as const;

/** Relación directa de un GDL esclavo con los GDL de su maestro (antes de expandir cadenas). */
function relacionDirecta(tipo: "diafragma" | "enlace-rigido", c: number, m: number, r: readonly number[]): [number, number][] {
  const [rx, ry, rz] = r;
  const M = (k: number) => 6 * m + k;
  const t: [number, number][] = [[M(c), 1]];
  if (tipo === "diafragma") {
    // ux = uxm − ry·rzm ; uy = uym + rx·rzm ; rz = rzm
    if (c === 0) t.push([M(5), -ry!]);
    else if (c === 1) t.push([M(5), rx!]);
  } else {
    // u = um + θm × r
    if (c === 0) t.push([M(4), rz!], [M(5), -ry!]);
    else if (c === 1) t.push([M(5), rx!], [M(3), -rz!]);
    else if (c === 2) t.push([M(3), ry!], [M(4), -rx!]);
  }
  return t.filter(([, v]) => v !== 0);
}

export function numerar(modelo: ModeloAnalitico, elementos: readonly ElementoMotor[], geo: Geometria, diag: Diagnosticos): Numeracion | null {
  const nn = modelo.nudos.length;
  const P = 6 * nn;
  const idNudo = (v: number) => modelo.nudos[v]!.id;
  const { xyz } = geo;
  const tolZ = TOL_GEOMETRICA * geo.tamano;

  // 1. Relaciones directas de las restricciones
  const directa: ([number, number][] | undefined)[] = new Array(P);
  const origen = new Int32Array(P).fill(-1); // restricción que esclaviza cada GDL
  const restricciones = modelo.restricciones ?? [];
  const enRestriccion = new Uint8Array(nn);
  restricciones.forEach((r, ir) => {
    const indices = Array.isArray(r.esclavos) ? [r.maestro, ...r.esclavos] : [Number.NaN];
    if (indices.some((v) => !Number.isInteger(v) || v < 0 || v >= nn) || new Set(indices).size !== indices.length) {
      diag.error("restriccion/nudo-no-valido", `La restricción ${r.id} hace referencia a nudos inexistentes o repetidos (el maestro no puede ser esclavo de sí mismo).`, [r.id]);
      return;
    }
    if (r.tipo !== "diafragma" && r.tipo !== "enlace-rigido") {
      diag.error("restriccion/tipo-no-valido", `La restricción ${r.id} es de un tipo desconocido.`, [r.id]);
      return;
    }
    const m = r.maestro;
    if (r.tipo === "diafragma") {
      const fuera = r.esclavos.filter((s) => Math.abs(xyz[3 * s + 2]! - xyz[3 * m + 2]!) > tolZ);
      if (fuera.length) {
        diag.error(
          "restriccion/diafragma-no-plano",
          `El diafragma ${r.id} tiene nudos fuera de la cota de su maestro (${listaIds(fuera.map(idNudo))}). Un diafragma rígido es horizontal y todos sus nudos, también el maestro, tienen que estar a la misma cota.`,
          [r.id, ...fuera.map(idNudo)],
        );
        return;
      }
    }
    enRestriccion[m] = 1;
    for (const s of r.esclavos) {
      enRestriccion[s] = 1;
      const rel = [xyz[3 * s]! - xyz[3 * m]!, xyz[3 * s + 1]! - xyz[3 * m + 1]!, xyz[3 * s + 2]! - xyz[3 * m + 2]!];
      const comps = r.tipo === "diafragma" ? COMPONENTES_DIAFRAGMA : ([0, 1, 2, 3, 4, 5] as const);
      for (const c of comps) {
        const p = 6 * s + c;
        if (origen[p] >= 0) {
          const otra = restricciones[origen[p]!]!;
          diag.error(
            "restriccion/esclavo-doble",
            `El GDL ${NOMBRES_GDL[c]} del nudo ${idNudo(s)} es esclavo de dos restricciones (${otra.id} y ${r.id}). Saca el nudo de una de ellas o encadénalas (el maestro de una puede ser esclavo de la otra).`,
            [idNudo(s), otra.id, r.id],
          );
          continue;
        }
        origen[p] = ir;
        directa[p] = relacionDirecta(r.tipo, c, m, rel);
      }
    }
  });

  // 2. Cadenas: orden topológico de los esclavos (DFS iterativo) y expansión de sus filas
  const estado = new Uint8Array(P); // 0 sin visitar, 1 en la pila, 2 expandido
  const expandida: (Map<number, number> | undefined)[] = new Array(P);
  let hayCiclo = false;
  for (let p0 = 0; p0 < P && !hayCiclo; p0++) {
    if (!directa[p0] || estado[p0] === 2) continue;
    const pila: number[] = [p0];
    estado[p0] = 1;
    while (pila.length && !hayCiclo) {
      const p = pila[pila.length - 1]!;
      let pendiente = -1;
      for (const [q] of directa[p]!) {
        if (!directa[q]) continue;
        if (estado[q] === 1) {
          const ciclo = pila.slice(pila.indexOf(q)).map((g) => restricciones[origen[g]!]!.id);
          diag.error(
            "restriccion/ciclo",
            `Las restricciones forman un ciclo (${[...new Set(ciclo)].join(" → ")}): el maestro de una acaba dependiendo de su propio esclavo.`,
            [...new Set(ciclo)],
          );
          hayCiclo = true;
          break;
        }
        if (estado[q] === 0) {
          pendiente = q;
          break;
        }
      }
      if (hayCiclo) break;
      if (pendiente >= 0) {
        estado[pendiente] = 1;
        pila.push(pendiente);
        continue;
      }
      // todos sus maestros están expandidos
      const fila = new Map<number, number>();
      for (const [q, c] of directa[p]!) {
        const sub = expandida[q];
        if (sub) for (const [k, v] of sub) fila.set(k, (fila.get(k) ?? 0) + c * v);
        else fila.set(q, (fila.get(q) ?? 0) + c);
      }
      for (const [k, v] of fila) if (v === 0) fila.delete(k);
      expandida[p] = fila;
      estado[p] = 2;
      pila.pop();
    }
  }
  if (diag.hayErrores) return null;

  // 3. Apoyos
  const coartado = new Uint8Array(P);
  for (const a of modelo.apoyos ?? []) {
    if (!Number.isInteger(a.nudo) || a.nudo < 0 || a.nudo >= nn || !Array.isArray(a.coartados) || a.coartados.length !== 6) {
      diag.error("modelo/apoyo-no-valido", `Hay un apoyo sobre un nudo inexistente o sin sus 6 GDL (índice ${a.nudo}).`);
      continue;
    }
    for (let c = 0; c < 6; c++) {
      if (!a.coartados[c]) continue;
      const p = 6 * a.nudo + c;
      if (directa[p]) {
        diag.error(
          "restriccion/apoyo-en-esclavo",
          `El nudo ${idNudo(a.nudo)} tiene coartado el GDL ${NOMBRES_GDL[c]}, que es esclavo de la restricción ${restricciones[origen[p]!]!.id}. Pon el apoyo en el maestro.`,
          [idNudo(a.nudo), restricciones[origen[p]!]!.id],
        );
        continue;
      }
      coartado[p] = 1;
    }
  }
  if (diag.hayErrores) return null;

  // 4. GDL rigidizados por elementos y muelles, y GDL independientes activos
  const rigidizado = new Uint8Array(P);
  const conElementos = new Uint8Array(nn);
  for (const e of elementos) {
    const mask = gdlRigidizados(modelo, e);
    e.nudos.forEach((v, a) => {
      conElementos[v] = 1;
      for (let c = 0; c < 6; c++) if (mask[6 * a + c]) rigidizado[6 * v + c] = 1;
    });
  }
  const activo = new Uint8Array(P);
  for (let p = 0; p < P; p++) {
    if (!rigidizado[p]) continue;
    const fila = expandida[p];
    if (fila) for (const q of fila.keys()) activo[q] = 1;
    else activo[p] = 1;
  }

  // 5. Tipos y ecuaciones
  const tipo = new Uint8Array(P);
  const ecuacion = new Int32Array(P).fill(-1);
  const gdlDeEcuacion: number[] = [];
  const coartados: number[] = [];
  const filaEsclavo = new Int32Array(P).fill(-1);
  const tPtr: number[] = [0];
  const tIdx: number[] = [];
  const tVal: number[] = [];
  let nSinRigidez = 0;
  const sinRigidezConElementos: number[] = [];
  for (let p = 0; p < P; p++) {
    const fila = expandida[p];
    if (fila) {
      tipo[p] = TipoGdl.Esclavo;
      filaEsclavo[p] = tPtr.length - 1;
      for (const [q, v] of [...fila.entries()].sort((a, b) => a[0] - b[0])) {
        tIdx.push(q);
        tVal.push(v);
      }
      tPtr.push(tIdx.length);
    } else if (coartado[p]) {
      tipo[p] = TipoGdl.Coartado;
      coartados.push(p);
    } else if (!activo[p]) {
      tipo[p] = TipoGdl.SinRigidez;
      nSinRigidez++;
      if (conElementos[Math.floor(p / 6)]) sinRigidezConElementos.push(p);
    } else {
      tipo[p] = TipoGdl.Libre;
      ecuacion[p] = gdlDeEcuacion.length;
      gdlDeEcuacion.push(p);
    }
  }

  // 6. Avisos: GDL sin rigidez en nudos con elementos y nudos aislados
  if (sinRigidezConElementos.length) {
    const nombres = sinRigidezConElementos.map((p) => `${idNudo(Math.floor(p / 6))}.${NOMBRES_GDL[p % 6]}`);
    diag.aviso(
      "gdl/sin-rigidez",
      `${sinRigidezConElementos.length} GDL de nudos con elementos no tienen rigidez y se restringen automáticamente: ${listaIds(nombres)}.`,
      [...new Set(sinRigidezConElementos.map((p) => idNudo(Math.floor(p / 6))))],
      { gdl: nombres.slice(0, 50) },
    );
  }
  const apoyados = new Uint8Array(nn);
  for (const a of modelo.apoyos ?? []) if (a.nudo >= 0 && a.nudo < nn) apoyados[a.nudo] = 1;
  const aislados: string[] = [];
  for (let v = 0; v < nn; v++) if (!conElementos[v] && !enRestriccion[v] && !apoyados[v]) aislados.push(idNudo(v));
  if (aislados.length) {
    diag.aviso("modelo/nudo-aislado", `${aislados.length} nudos no tienen elementos, muelles, apoyos ni restricciones y se ignoran: ${listaIds(aislados)}.`, aislados);
  }

  return {
    nNudos: nn,
    tipo,
    ecuacion,
    nEcuaciones: gdlDeEcuacion.length,
    gdlDeEcuacion: Uint32Array.from(gdlDeEcuacion),
    filaEsclavo,
    tPtr: Uint32Array.from(tPtr),
    tIdx: Uint32Array.from(tIdx),
    tVal: Float64Array.from(tVal),
    coartados: Uint32Array.from(coartados),
    nEsclavos: tPtr.length - 1,
    nSinRigidez,
  };
}

/**
 * Expande un GDL físico en sus GDL independientes: llama a `f(q, coef)` por cada término de
 * u_p = Σ T_pq·û_q (un único término (p, 1) si p no es esclavo).
 */
export function expandir(num: Numeracion, p: number, f: (q: number, coef: number) => void): void {
  const fila = num.filaEsclavo[p]!;
  if (fila < 0) {
    f(p, 1);
    return;
  }
  for (let k = num.tPtr[fila]!; k < num.tPtr[fila + 1]!; k++) f(num.tIdx[k]!, num.tVal[k]!);
}

/** u = T·û: desplazamientos físicos (6 por nudo) a partir de los valores de los GDL independientes. */
export function desplazamientosFisicos(num: Numeracion, uIndep: Float64Array, u: Float64Array = new Float64Array(uIndep.length)): Float64Array {
  const P = 6 * num.nNudos;
  for (let p = 0; p < P; p++) {
    const fila = num.filaEsclavo[p]!;
    if (fila < 0) {
      u[p] = num.tipo[p] === TipoGdl.SinRigidez ? 0 : uIndep[p]!;
      continue;
    }
    let s = 0;
    for (let k = num.tPtr[fila]!; k < num.tPtr[fila + 1]!; k++) s += num.tVal[k]! * uIndep[num.tIdx[k]!]!;
    u[p] = s;
  }
  return u;
}

/** b = Tᵀ·f: fuerzas físicas llevadas a los GDL independientes (indexados por su GDL físico). */
export function fuerzasIndependientes(num: Numeracion, f: Float64Array, b: Float64Array = new Float64Array(f.length)): Float64Array {
  b.fill(0);
  const P = 6 * num.nNudos;
  for (let p = 0; p < P; p++) {
    const v = f[p]!;
    if (v === 0) continue;
    const fila = num.filaEsclavo[p]!;
    if (fila < 0) {
      b[p]! += v;
      continue;
    }
    for (let k = num.tPtr[fila]!; k < num.tPtr[fila + 1]!; k++) b[num.tIdx[k]!]! += num.tVal[k]! * v;
  }
  return b;
}
