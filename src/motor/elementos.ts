/**
 * Capa de elementos del motor: lista uniforme de barras, láminas y muelles, comprobaciones
 * geométricas previas al cálculo y rigidez de cada uno en ejes globales.
 *
 * El núcleo (numeración, restricciones, ensamblado) no sabe de tipos de elemento: sólo ve
 * nudos, una matriz (6m)×(6m) en ejes globales y qué GDL rigidiza cada elemento.
 */
import { marcoBarra, rigidezBarraGlobal, rigidezBarraLocal } from "../elementos/barra.ts";
import { marcoLocal, rigidezAGlobales, rigidezLaminaLocal } from "../elementos/lamina.ts";
import type { Diagnosticos } from "./diagnosticos.ts";
import type { ModeloAnalitico, Muelle } from "./modelo.ts";

export type TipoElemento = "barra" | "lamina" | "muelle";

export interface ElementoMotor {
  tipo: TipoElemento;
  /** Índice dentro de su lista del modelo (`barras`, `laminas` o `muelles`). */
  indice: number;
  id: string;
  nudos: readonly number[];
}

/**
 * Tolerancia geométrica relativa al tamaño del modelo (con un mínimo de 1 m). Es la de las
 * comprobaciones que, si fallan, romperían el equilibrio a 1e-9: nudos de un diafragma a la
 * misma cota, muelles de longitud nula y láminas planas.
 */
export const TOL_GEOMETRICA = 1e-9;

/** Coordenadas de los nudos [x0, y0, z0, x1, …] y tamaño característico del modelo. */
export interface Geometria {
  xyz: Float64Array;
  /** Centro de la caja envolvente. */
  centro: [number, number, number];
  /** Mitad de la diagonal de la caja envolvente, con un mínimo de 1 m. */
  tamano: number;
}

export function geometria(modelo: ModeloAnalitico): Geometria {
  const n = modelo.nudos.length;
  const xyz = new Float64Array(3 * n);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const v = modelo.nudos[i]!;
    const p = [v.x, v.y, v.z];
    for (let c = 0; c < 3; c++) {
      xyz[3 * i + c] = p[c]!;
      min[c] = Math.min(min[c]!, p[c]!);
      max[c] = Math.max(max[c]!, p[c]!);
    }
  }
  if (n === 0) return { xyz, centro: [0, 0, 0], tamano: 1 };
  const centro: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) centro[c] = (min[c]! + max[c]!) / 2;
  const tamano = Math.max(1, Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) / 2);
  return { xyz, centro, tamano };
}

const finito = (...v: number[]) => v.every(Number.isFinite);

/** Comprueba índices de nudo de un objeto: en rango y sin repetir. */
function nudosValidos(nudos: readonly number[], nn: number): boolean {
  for (let a = 0; a < nudos.length; a++) {
    const v = nudos[a]!;
    if (!Number.isInteger(v) || v < 0 || v >= nn) return false;
    for (let b = 0; b < a; b++) if (nudos[b] === v) return false;
  }
  return true;
}

/** Rigidez 6×6 de un muelle en ejes globales (por filas). */
function rigidezMuelle6(m: Muelle): Float64Array {
  const k = new Float64Array(36);
  if (m.k.length === 6) for (let i = 0; i < 6; i++) k[7 * i] = m.k[i]!;
  else for (let i = 0; i < 36; i++) k[i] = m.k[i]!;
  if (!m.ejes) return k;
  // K_g = Tᵀ·k·T con T = diag(R, R) y u_muelle = R·u_global
  const R = m.ejes;
  const T = new Float64Array(36);
  for (let b = 0; b < 2; b++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) T[6 * (3 * b + i) + 3 * b + j] = R[3 * i + j]!;
  const kT = new Float64Array(36);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    let s = 0;
    for (let p = 0; p < 6; p++) s += k[6 * i + p]! * T[6 * p + j]!;
    kT[6 * i + j] = s;
  }
  const kg = new Float64Array(36);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    let s = 0;
    for (let p = 0; p < 6; p++) s += T[6 * p + i]! * kT[6 * p + j]!;
    kg[6 * i + j] = s;
  }
  // Simetría exacta frente al redondeo del giro
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
    const v = (kg[6 * i + j]! + kg[6 * j + i]!) / 2;
    kg[6 * i + j] = v;
    kg[6 * j + i] = v;
  }
  return kg;
}

/** ¿Es la matriz 6×6 simétrica y semidefinida positiva? (Cholesky con pivotes ≥ −ε). */
function semidefinidaPositiva(k: Float64Array): boolean {
  let escala = 0;
  for (let i = 0; i < 36; i++) escala = Math.max(escala, Math.abs(k[i]!));
  if (escala === 0) return true;
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (Math.abs(k[6 * i + j]! - k[6 * j + i]!) > 1e-12 * escala) return false;
  const a = Float64Array.from(k);
  for (let j = 0; j < 6; j++) {
    let d = a[7 * j]!;
    for (let p = 0; p < j; p++) d -= a[6 * j + p]! ** 2;
    if (d < -1e-12 * escala) return false;
    if (d <= 1e-14 * escala) {
      // pivote nulo: la columna tiene que ser nula para seguir siendo semidefinida
      for (let i = j + 1; i < 6; i++) {
        let s = a[6 * i + j]!;
        for (let p = 0; p < j; p++) s -= a[6 * i + p]! * a[6 * j + p]!;
        if (Math.abs(s) > 1e-12 * escala) return false;
        a[6 * i + j] = 0;
      }
      a[7 * j] = 0;
      continue;
    }
    const l = Math.sqrt(d);
    a[7 * j] = l;
    for (let i = j + 1; i < 6; i++) {
      let s = a[6 * i + j]!;
      for (let p = 0; p < j; p++) s -= a[6 * i + p]! * a[6 * j + p]!;
      a[6 * i + j] = s / l;
    }
  }
  return true;
}

function ortonormal(R: readonly number[]): boolean {
  if (R.length !== 9 || !finito(...R)) return false;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const p = R[3 * i]! * R[3 * j]! + R[3 * i + 1]! * R[3 * j + 1]! + R[3 * i + 2]! * R[3 * j + 2]!;
    if (Math.abs(p - (i === j ? 1 : 0)) > 1e-9) return false;
  }
  // dextrógira: det = +1
  const det =
    R[0]! * (R[4]! * R[8]! - R[5]! * R[7]!) - R[1]! * (R[3]! * R[8]! - R[5]! * R[6]!) + R[2]! * (R[3]! * R[7]! - R[4]! * R[6]!);
  return det > 0;
}

/**
 * Comprueba los elementos y devuelve la lista uniforme. Los defectos van a `diag` como errores
 * (el cálculo no sigue si hay alguno).
 */
export function elementosDelModelo(modelo: ModeloAnalitico, geo: Geometria, diag: Diagnosticos): ElementoMotor[] {
  const nn = modelo.nudos.length;
  const { xyz, tamano } = geo;
  const lista: ElementoMotor[] = [];
  const tol = TOL_GEOMETRICA * tamano;

  (modelo.barras ?? []).forEach((b, indice) => {
    if (!nudosValidos(b.nudos, nn)) {
      diag.error("modelo/nudo-no-valido", `La barra ${b.id} hace referencia a nudos inexistentes o repetidos.`, [b.id]);
      return;
    }
    const s = b.seccion;
    if (!finito(s.E, s.G, s.A, s.Iy, s.Iz, s.J) || !(s.E > 0 && s.G > 0 && s.A > 0 && s.Iy > 0 && s.Iz > 0 && s.J > 0)) {
      diag.error("modelo/propiedad-no-valida", `La barra ${b.id} tiene una sección o un material no válidos (E, G, A, Iy, Iz y J tienen que ser positivos).`, [b.id]);
      return;
    }
    const [i, j] = b.nudos;
    const L = Math.hypot(xyz[3 * j] - xyz[3 * i], xyz[3 * j + 1] - xyz[3 * i + 1], xyz[3 * j + 2] - xyz[3 * i + 2]);
    if (!(L > tol)) {
      diag.error("modelo/elemento-degenerado", `La barra ${b.id} tiene longitud nula.`, [b.id, modelo.nudos[i]!.id, modelo.nudos[j]!.id]);
      return;
    }
    if (!finito(...b.vz)) {
      diag.error("modelo/propiedad-no-valida", `La barra ${b.id} tiene un vector de canto no válido.`, [b.id]);
      return;
    }
    try {
      marcoBarra(xyz.subarray(3 * i, 3 * i + 3), xyz.subarray(3 * j, 3 * j + 3), b.vz);
    } catch {
      diag.error("modelo/orientacion-no-valida", `El vector de canto de la barra ${b.id} es paralelo a su eje.`, [b.id]);
      return;
    }
    lista.push({ tipo: "barra", indice, id: b.id, nudos: b.nudos });
  });

  (modelo.laminas ?? []).forEach((l, indice) => {
    if (!nudosValidos(l.nudos, nn)) {
      diag.error("modelo/nudo-no-valido", `La lámina ${l.id} hace referencia a nudos inexistentes o repetidos.`, [l.id]);
      return;
    }
    const m = l.material;
    if (!finito(m.E, m.nu, m.t) || !(m.E > 0 && m.t > 0 && m.nu >= 0 && m.nu < 0.5)) {
      diag.error("modelo/propiedad-no-valida", `La lámina ${l.id} tiene un material no válido (E > 0, t > 0 y 0 ≤ ν < 0,5).`, [l.id]);
      return;
    }
    const X = l.nudos.flatMap((v) => [xyz[3 * v]!, xyz[3 * v + 1]!, xyz[3 * v + 2]!]);
    const marco = marcoLocal(X);
    const xy = marco.xy;
    let lado = 0;
    let convexa = finito(...xy);
    for (let a = 0; a < 4; a++) {
      const b = (a + 1) % 4;
      const c = (a + 2) % 4;
      const ex = xy[2 * b]! - xy[2 * a]!;
      const ey = xy[2 * b + 1]! - xy[2 * a + 1]!;
      lado = Math.max(lado, Math.hypot(ex, ey));
      const cruz = ex * (xy[2 * c + 1]! - xy[2 * b + 1]!) - ey * (xy[2 * c]! - xy[2 * b]!);
      if (!(cruz > 0)) convexa = false;
    }
    if (!convexa) {
      diag.error(
        "modelo/elemento-degenerado",
        `La lámina ${l.id} es degenerada, no convexa o tiene los nudos desordenados (el orden tiene que recorrer el contorno).`,
        [l.id],
      );
      return;
    }
    if (marco.alabeo > TOL_GEOMETRICA * Math.max(1, lado)) {
      diag.error(
        "modelo/lamina-alabeada",
        `La lámina ${l.id} no es plana: su cuarto nudo se separa ${marco.alabeo.toExponential(2)} m del plano de los otros tres. El elemento es plano y una lámina alabeada rompe el equilibrio.`,
        [l.id],
        { alabeo: marco.alabeo },
      );
      return;
    }
    lista.push({ tipo: "lamina", indice, id: l.id, nudos: l.nudos });
  });

  (modelo.muelles ?? []).forEach((m, indice) => {
    if ((m.nudos.length !== 1 && m.nudos.length !== 2) || !nudosValidos(m.nudos, nn)) {
      diag.error("modelo/nudo-no-valido", `El muelle ${m.id} hace referencia a nudos inexistentes o repetidos.`, [m.id]);
      return;
    }
    if ((m.k.length !== 6 && m.k.length !== 36) || !finito(...m.k)) {
      diag.error("modelo/propiedad-no-valida", `El muelle ${m.id} tiene que dar 6 rigideces (diagonal) o 36 (matriz 6×6) finitas.`, [m.id]);
      return;
    }
    if (m.ejes && !ortonormal(m.ejes)) {
      diag.error("modelo/orientacion-no-valida", `Los ejes del muelle ${m.id} no forman un triedro ortonormal dextrógiro.`, [m.id]);
      return;
    }
    if (!semidefinidaPositiva(rigidezMuelle6(m))) {
      diag.error("modelo/propiedad-no-valida", `La rigidez del muelle ${m.id} no es simétrica y semidefinida positiva.`, [m.id]);
      return;
    }
    if (m.nudos.length === 2) {
      const [i, j] = m.nudos;
      const d = Math.hypot(xyz[3 * j] - xyz[3 * i], xyz[3 * j + 1] - xyz[3 * i + 1], xyz[3 * j + 2] - xyz[3 * i + 2]);
      if (d > tol) {
        diag.error(
          "modelo/muelle-no-nulo",
          `El muelle ${m.id} une nudos separados ${d.toExponential(2)} m: sólo se admiten muelles de longitud nula entre nudos coincidentes.`,
          [m.id, modelo.nudos[i]!.id, modelo.nudos[j]!.id],
        );
        return;
      }
    }
    lista.push({ tipo: "muelle", indice, id: m.id, nudos: m.nudos });
  });

  return lista;
}

/** Rigidez del elemento en ejes globales, (6m)×(6m) por filas. */
export function rigidezGlobal(modelo: ModeloAnalitico, e: ElementoMotor, xyz: Float64Array): Float64Array {
  if (e.tipo === "barra") {
    const b = modelo.barras![e.indice]!;
    const [i, j] = b.nudos;
    const { R, L } = marcoBarra(xyz.subarray(3 * i, 3 * i + 3), xyz.subarray(3 * j, 3 * j + 3), b.vz);
    return rigidezBarraGlobal(rigidezBarraLocal(L, b.seccion), R);
  }
  if (e.tipo === "lamina") {
    const l = modelo.laminas![e.indice]!;
    const X = l.nudos.flatMap((v) => [xyz[3 * v]!, xyz[3 * v + 1]!, xyz[3 * v + 2]!]);
    const marco = marcoLocal(X);
    return rigidezAGlobales(rigidezLaminaLocal(marco.xy, l.material, l.membrana), marco.R);
  }
  const m = modelo.muelles![e.indice]!;
  const k6 = rigidezMuelle6(m);
  if (m.nudos.length === 1) return k6;
  const k = new Float64Array(144);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    const v = k6[6 * i + j]!;
    k[12 * i + j] = v;
    k[12 * (i + 6) + j + 6] = v;
    k[12 * i + j + 6] = -v;
    k[12 * (i + 6) + j] = -v;
  }
  return k;
}

/**
 * GDL locales (0..6m−1) que el elemento rigidiza. Barras y láminas, todos (la lámina tiene
 * drilling real); un muelle, sólo los de diagonal no nula en ejes globales.
 */
export function gdlRigidizados(modelo: ModeloAnalitico, e: ElementoMotor): boolean[] {
  const m = 6 * e.nudos.length;
  if (e.tipo !== "muelle") return new Array<boolean>(m).fill(true);
  const k6 = rigidezMuelle6(modelo.muelles![e.indice]!);
  const r: boolean[] = [];
  for (let n = 0; n < e.nudos.length; n++) for (let c = 0; c < 6; c++) r.push(k6[7 * c] !== 0);
  return r;
}

/** Sólo los muelles a tierra aportan reacciones: ¿es `e` uno de ellos? */
export function esMuelleATierra(e: ElementoMotor): boolean {
  return e.tipo === "muelle" && e.nudos.length === 1;
}
