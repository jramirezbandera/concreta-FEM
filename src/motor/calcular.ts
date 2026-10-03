/**
 * Cálculo lineal estático: modelo analítico → desplazamientos y reacciones por caso.
 *
 * Fases, cada una con sus diagnósticos (si alguna deja un error, el cálculo no sigue):
 * 1. Comprobación de nudos, elementos, muelles y apoyos.
 * 2. Numeración de GDL con las restricciones por transformación (u = T·û).
 * 3. Partes del modelo sin ningún apoyo (mecanismo de sólido rígido evidente).
 * 4. Cargas: b = Tᵀ·f por caso y desplazamientos impuestos.
 * 5. Patrón CSC y ensamblado de K' = Tᵀ·K·T.
 * 6. Factorización con diagnóstico de mecanismos, resolución por bloque y refinamiento.
 * 7. Recuperación: u = T·û, reacciones de apoyos y muelles a tierra.
 * 8. Regla de oro 2: equilibrio ΣF/ΣM a 1e-9 y resultados finitos en cada caso.
 *
 * El motor es puro: sin IO, sin DOM. El solver "nucleo" necesita `iniciarNucleo()` antes.
 */
import { Diagnosticos, listaIds } from "./diagnosticos.ts";
import { elementosDelModelo, esMuelleATierra, geometria, rigidezGlobal, type ElementoMotor, type Geometria } from "./elementos.ts";
import { ensamblarRigidez, patronSistema } from "./ensamblado.ts";
import { equilibrio } from "./equilibrio.ts";
import { desplazamientosFisicos, fuerzasIndependientes, numerar, TipoGdl, type Numeracion } from "./gdl.ts";
import { NOMBRES_GDL, type EstadisticasCalculo, type ModeloAnalitico, type ResultadoCalculo, type ResultadoCaso } from "./modelo.ts";
import { resolver, RESIDUO_OBJETIVO, type TipoSolver } from "./solucion.ts";

/** Tolerancia del equilibrio global por caso (regla de oro 2). */
export const TOL_EQUILIBRIO = 1e-9;

export interface OpcionesCalculo {
  /** "nucleo" (faer en WASM, por defecto) o "perfil" (TypeScript, referencia para modelos pequeños). */
  solver?: TipoSolver;
}

const ahora = () => performance.now();

export function calcular(modelo: ModeloAnalitico, opciones: OpcionesCalculo = {}): ResultadoCalculo {
  const diag = new Diagnosticos();
  const tiempos: Record<string, number> = {};
  let t0 = ahora();
  const marcar = (fase: string) => {
    const t = ahora();
    tiempos[fase] = t - t0;
    t0 = t;
  };
  const fallo = (estadisticas?: EstadisticasCalculo): ResultadoCalculo => ({ valido: false, diagnosticos: diag.lista, estadisticas });

  // 1. Nudos y elementos
  const nn = modelo.nudos.length;
  const noFinitos = modelo.nudos.filter((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)).map((v) => v.id);
  if (noFinitos.length) {
    diag.error("modelo/valor-no-finito", `Hay nudos con coordenadas no finitas: ${listaIds(noFinitos)}.`, noFinitos);
    return fallo();
  }
  const geo = geometria(modelo);
  const elementos = elementosDelModelo(modelo, geo, diag);
  nudosCoincidentes(modelo, geo, diag);
  if (diag.hayErrores) return fallo();

  // 2. Numeración y restricciones
  const num = numerar(modelo, elementos, geo, diag);
  if (!num || diag.hayErrores) return fallo();

  // 3. Partes sin apoyo
  partesSinApoyo(modelo, elementos, diag);
  if (diag.hayErrores) return fallo();
  marcar("numeracion");

  // 4. Cargas
  const casos = modelo.casos;
  const nc = casos.length;
  const P = 6 * nn;
  const cargas = casos.map(() => new Float64Array(P));
  const indep = casos.map(() => new Float64Array(P)); // û por GDL físico independiente
  casos.forEach((caso, k) => {
    for (const c of caso.nodales ?? []) {
      if (!Number.isInteger(c.nudo) || c.nudo < 0 || c.nudo >= nn || c.f.length !== 6 || !c.f.every(Number.isFinite)) {
        diag.error("carga/no-valida", `El caso ${caso.id} tiene una carga nodal sobre un nudo inexistente o con valores no finitos.`, [caso.id]);
        continue;
      }
      for (let g = 0; g < 6; g++) cargas[k]![6 * c.nudo + g]! += c.f[g]!;
    }
    for (const d of caso.impuestos ?? []) {
      const p = 6 * d.nudo + d.gdl;
      if (!Number.isInteger(d.nudo) || d.nudo < 0 || d.nudo >= nn || !Number.isInteger(d.gdl) || d.gdl < 0 || d.gdl > 5 || !Number.isFinite(d.valor)) {
        diag.error("carga/no-valida", `El caso ${caso.id} tiene un desplazamiento impuesto no válido.`, [caso.id]);
        continue;
      }
      if (num.tipo[p] !== TipoGdl.Coartado) {
        const id = modelo.nudos[d.nudo]!.id;
        diag.error(
          "carga/impuesto-sin-apoyo",
          `El caso ${caso.id} impone el GDL ${NOMBRES_GDL[d.gdl]} del nudo ${id}, que no está coartado por un apoyo.`,
          [caso.id, id],
        );
        continue;
      }
      indep[k]![p] = d.valor;
    }
  });
  if (diag.hayErrores) return fallo();
  const bIndep = cargas.map((f) => fuerzasIndependientes(num, f));
  casos.forEach((caso, k) => {
    const perdidas: number[] = [];
    for (let q = 0; q < P; q++) if (num.tipo[q] === TipoGdl.SinRigidez && bIndep[k]![q] !== 0) perdidas.push(q);
    if (perdidas.length) {
      const nombres = perdidas.map((q) => `${modelo.nudos[Math.floor(q / 6)]!.id}.${NOMBRES_GDL[q % 6]}`);
      diag.error(
        "carga/gdl-sin-rigidez",
        `El caso ${caso.id} carga GDL que no tienen rigidez (${listaIds(nombres)}): la carga no tendría por dónde ir.`,
        [caso.id, ...new Set(perdidas.map((q) => modelo.nudos[Math.floor(q / 6)]!.id))],
      );
    }
  });
  if (diag.hayErrores) return fallo();
  marcar("cargas");

  // 5. Patrón y ensamblado
  const ps = patronSistema(num, elementos);
  marcar("patron");
  const K = ensamblarRigidez(modelo, geo.xyz, num, elementos, ps);
  marcar("ensamblado");
  const n = num.nEcuaciones;
  const estadisticas: EstadisticasCalculo = {
    nudos: nn,
    gdl: P,
    ecuaciones: n,
    esclavos: num.nEsclavos,
    coartados: num.coartados.length,
    sinRigidez: num.nSinRigidez,
    nnzK: ps.patron.rowIdx.length,
    tiempos,
  };

  // Lados derechos: b = (Tᵀ·f)_libres − K'_{libres, coartados}·û_coartados
  const B = new Float64Array(n * nc);
  for (let k = 0; k < nc; k++) for (let j = 0; j < n; j++) B[n * k + j] = bIndep[k]![num.gdlDeEcuacion[j]!]!;
  for (let k = 0; k < nc; k++) {
    const u = indep[k]!;
    if (!(casos[k]!.impuestos?.length)) continue;
    for (const e of K.coartados) {
      const nq = e.gdl.length;
      for (let i = 0; i < nq; i++) {
        const ei = num.ecuacion[e.gdl[i]!]!;
        if (ei < 0) continue;
        let s = 0;
        for (let j = 0; j < nq; j++) if (num.tipo[e.gdl[j]!] === TipoGdl.Coartado) s += e.k[nq * i + j]! * u[e.gdl[j]!]!;
        B[n * k + ei]! -= s;
      }
    }
  }

  // 6. Factorización y resolución
  const sol = n > 0 ? resolver(ps.patron, K.valores, K.diagonal, B, nc, opciones.solver ?? "nucleo") : null;
  marcar("solucion");
  if (sol) {
    estadisticas.nnzL = sol.nnzL;
    for (const [fase, ms] of Object.entries(sol.tiempos)) tiempos[`solucion.${fase}`] = ms;
    estadisticas.pasosRefinamiento = sol.pasosRefinamiento;
  }
  if (sol && sol.mecanismos.length) {
    diagnosticarMecanismos(modelo, num, geo, sol.mecanismos, diag);
    return fallo(estadisticas);
  }
  if (sol && sol.malCondicionados.length) {
    const peor = sol.malCondicionados.reduce((a, b) => (b.cifrasPerdidas > a.cifrasPerdidas ? b : a));
    const p = num.gdlDeEcuacion[peor.ecuacion]!;
    const id = modelo.nudos[Math.floor(p / 6)]!.id;
    diag.aviso(
      "solver/mal-condicionado",
      `La matriz de rigidez está mal condicionada: ${sol.malCondicionados.length} pivotes pierden más de 8 cifras (el peor, ${peor.cifrasPerdidas.toFixed(1)} cifras en ${id}.${NOMBRES_GDL[p % 6]}). Suele deberse a rigideces muy dispares.`,
      [id],
      { cifrasPerdidas: peor.cifrasPerdidas },
    );
  }

  // 7. Recuperación y 8. comprobaciones
  const muellesTierra = elementos.filter(esMuelleATierra);
  const kMuelles = muellesTierra.map((e) => rigidezGlobal(modelo, e, geo.xyz));
  const resultados: ResultadoCaso[] = [];
  let equilibrioRoto = false;
  for (let k = 0; k < nc; k++) {
    const caso = casos[k]!;
    const uI = indep[k]!;
    if (sol?.X) for (let j = 0; j < n; j++) uI[num.gdlDeEcuacion[j]!] = sol.X[n * k + j]!;
    const u = desplazamientosFisicos(num, uI);
    // Reacciones de los apoyos: R = (K'·û − Tᵀ·f) en los GDL coartados
    // (`magnitud`: suma de |términos| de cada reacción, la escala de su redondeo)
    const reacciones = new Float64Array(P);
    const magnitud = new Float64Array(P);
    for (const p of num.coartados) {
      reacciones[p] = -bIndep[k]![p]!;
      magnitud[p] = Math.abs(bIndep[k]![p]!);
    }
    for (const e of K.coartados) {
      const nq = e.gdl.length;
      for (let i = 0; i < nq; i++) {
        const p = e.gdl[i]!;
        if (num.tipo[p] !== TipoGdl.Coartado) continue;
        let s = 0;
        let a = 0;
        for (let j = 0; j < nq; j++) {
          const t = e.k[nq * i + j]! * uI[e.gdl[j]!]!;
          s += t;
          a += Math.abs(t);
        }
        reacciones[p]! += s;
        magnitud[p]! += a;
      }
    }
    // Muelles a tierra: fuerza −k·u sobre la estructura
    muellesTierra.forEach((e, im) => {
      const v = e.nudos[0]!;
      const km = kMuelles[im]!;
      for (let a = 0; a < 6; a++) {
        let s = 0;
        let m = 0;
        for (let b = 0; b < 6; b++) {
          const t = km[6 * a + b]! * u[6 * v + b]!;
          s += t;
          m += Math.abs(t);
        }
        reacciones[6 * v + a]! -= s;
        magnitud[6 * v + a]! += m;
      }
    });
    const eq = equilibrio(geo, cargas[k]!, reacciones, magnitud);
    const residuo = sol ? sol.residuos[k]! : 0;
    const finito = u.every(Number.isFinite) && reacciones.every(Number.isFinite);
    if (!finito) {
      diag.error("resultado/no-finito", `El caso ${caso.id} da desplazamientos o reacciones no finitos.`, [caso.id]);
    } else if (!(eq.fuerzas <= TOL_EQUILIBRIO && eq.momentos <= TOL_EQUILIBRIO)) {
      equilibrioRoto = true;
      diag.error(
        "equilibrio/no-cumple",
        `El caso ${caso.id} no cumple el equilibrio global: |ΣF|/Σ|F| = ${eq.fuerzas.toExponential(2)} y |ΣM|/Σ|M| = ${eq.momentos.toExponential(2)} (tolerancia ${TOL_EQUILIBRIO}). El resultado no es válido.` +
          (sol?.malCondicionados.length
            ? " La causa probable es el mal condicionamiento (ver el aviso solver/mal-condicionado): si hay barras o muelles muy rígidos que hacen de zona rígida, sustitúyelos por enlaces rígidos."
            : ""),
        [caso.id],
        { ...eq, residuo },
      );
    }
    if (residuo > RESIDUO_OBJETIVO) {
      diag.aviso(
        "solver/residuo",
        `El caso ${caso.id} queda con un error hacia atrás de ${residuo.toExponential(2)} tras el refinamiento (objetivo ${RESIDUO_OBJETIVO}): el solver no ha resuelto bien el sistema.`,
        [caso.id],
        { residuo },
      );
    }
    resultados.push({ id: caso.id, u, reacciones, equilibrio: eq, residuo });
  }
  marcar("recuperacion");
  if (diag.hayErrores) {
    return { valido: false, casosNoValidos: equilibrioRoto ? resultados : undefined, diagnosticos: diag.lista, estadisticas };
  }
  return { valido: true, casos: resultados, diagnosticos: diag.lista, estadisticas };
}

/** Errores de mecanismo: el GDL del pivote, las cifras perdidas y los nudos que mueve su modo. */
function diagnosticarMecanismos(
  modelo: ModeloAnalitico,
  num: Numeracion,
  geo: Geometria,
  mecanismos: { pivote: { ecuacion: number; relativo: number; cifrasPerdidas: number }; modo?: Float64Array }[],
  diag: Diagnosticos,
): void {
  const uI = new Float64Array(6 * num.nNudos);
  const MAX = 10;
  for (const { pivote, modo } of mecanismos.slice(0, MAX)) {
    const p = num.gdlDeEcuacion[pivote.ecuacion]!;
    const id = modelo.nudos[Math.floor(p / 6)]!.id;
    let mueve: string[] = [];
    if (modo) {
      uI.fill(0);
      for (let j = 0; j < num.nEcuaciones; j++) uI[num.gdlDeEcuacion[j]!] = modo[j]!;
      const u = desplazamientosFisicos(num, uI);
      // Giros escalados por el tamaño del modelo para compararlos con las traslaciones
      const mag = new Float64Array(num.nNudos);
      let max = 0;
      for (let v = 0; v < num.nNudos; v++) {
        const t = Math.hypot(u[6 * v]!, u[6 * v + 1]!, u[6 * v + 2]!);
        const r = Math.hypot(u[6 * v + 3]!, u[6 * v + 4]!, u[6 * v + 5]!) * geo.tamano;
        mag[v] = Math.max(t, r);
        max = Math.max(max, mag[v]!);
      }
      const orden = [...mag.keys()].filter((v) => mag[v]! > 1e-3 * max).sort((a, b) => mag[b]! - mag[a]!);
      mueve = orden.map((v) => modelo.nudos[v]!.id);
    }
    const perdidas = Number.isNaN(pivote.relativo)
      ? "pivote nulo"
      : pivote.relativo <= 0
        ? `pivote ≤ 0: ${pivote.relativo.toExponential(1)} de la diagonal`
        : `se pierden ${pivote.cifrasPerdidas.toFixed(1)} cifras`;
    diag.error(
      "solver/mecanismo",
      `Mecanismo: el GDL ${NOMBRES_GDL[p % 6]} del nudo ${id} no tiene rigidez frente al resto (${perdidas}).` +
        (mueve.length ? ` Se mueven sin resistencia ${mueve.length} nudos: ${listaIds(mueve)}.` : "") +
        " Revisa los apoyos, las uniones y las liberaciones de ese grupo.",
      [id, ...mueve.filter((m) => m !== id)],
      { gdl: NOMBRES_GDL[p % 6], pivoteRelativo: pivote.relativo, cifrasPerdidas: pivote.cifrasPerdidas, nudosQueSeMueven: mueve.length },
    );
  }
  if (mecanismos.length > MAX) {
    diag.error("solver/mecanismo", `Hay ${mecanismos.length} pivotes de mecanismo; sólo se detallan los ${MAX} primeros.`, [], { total: mecanismos.length });
  }
}

/** Partes conexas (por elementos, muelles y restricciones) sin apoyo ni muelle a tierra. */
function partesSinApoyo(modelo: ModeloAnalitico, elementos: readonly ElementoMotor[], diag: Diagnosticos): void {
  const nn = modelo.nudos.length;
  const padre = Int32Array.from({ length: nn }, (_, i) => i);
  const raiz = (a: number): number => {
    while (padre[a] !== a) {
      padre[a] = padre[padre[a]!]!;
      a = padre[a]!;
    }
    return a;
  };
  const unir = (a: number, b: number) => {
    const ra = raiz(a);
    const rb = raiz(b);
    if (ra !== rb) padre[ra] = rb;
  };
  const conAlgo = new Uint8Array(nn);
  for (const e of elementos) {
    for (const v of e.nudos) {
      conAlgo[v] = 1;
      unir(e.nudos[0]!, v);
    }
  }
  for (const r of modelo.restricciones ?? []) {
    conAlgo[r.maestro] = 1;
    for (const s of r.esclavos) {
      conAlgo[s] = 1;
      unir(r.maestro, s);
    }
  }
  const atierra = new Uint8Array(nn);
  for (const a of modelo.apoyos ?? []) if (a.coartados.some(Boolean)) atierra[raiz(a.nudo)] = 1;
  for (const e of elementos) if (esMuelleATierra(e)) atierra[raiz(e.nudos[0]!)] = 1;
  const partes = new Map<number, number[]>();
  for (let v = 0; v < nn; v++) {
    if (!conAlgo[v]) continue;
    const r = raiz(v);
    if (atierra[r]) continue;
    let l = partes.get(r);
    if (!l) partes.set(r, (l = []));
    l.push(v);
  }
  for (const nudos of partes.values()) {
    const ids = nudos.map((v) => modelo.nudos[v]!.id);
    diag.error(
      "modelo/parte-sin-apoyo",
      `Hay una parte del modelo de ${ids.length} nudos sin ningún apoyo ni muelle a tierra (${listaIds(ids)}): se movería como un sólido rígido.`,
      ids,
    );
  }
}

/**
 * Nudos coincidentes (a menos de 1e-6 m, H28) que no unen un muelle ni una restricción: casi
 * siempre un fallo del compilador (H19, H23). Es un aviso: el cálculo sigue.
 */
function nudosCoincidentes(modelo: ModeloAnalitico, geo: Geometria, diag: Diagnosticos): void {
  const TOL = 1e-6;
  const nn = modelo.nudos.length;
  const { xyz } = geo;
  const orden = Array.from({ length: nn }, (_, i) => i).sort((a, b) => xyz[3 * a]! - xyz[3 * b]!);
  const unidos = new Set<string>();
  const clave = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (const m of modelo.muelles ?? []) if (m.nudos.length === 2) unidos.add(clave(m.nudos[0], m.nudos[1]!));
  for (const r of modelo.restricciones ?? []) for (const s of r.esclavos) unidos.add(clave(r.maestro, s));
  const pares: string[] = [];
  for (let a = 0; a < nn; a++) {
    const i = orden[a]!;
    for (let b = a + 1; b < nn; b++) {
      const j = orden[b]!;
      if (xyz[3 * j]! - xyz[3 * i]! > TOL) break;
      const d = Math.hypot(xyz[3 * j]! - xyz[3 * i]!, xyz[3 * j + 1]! - xyz[3 * i + 1]!, xyz[3 * j + 2]! - xyz[3 * i + 2]!);
      if (d <= TOL && !unidos.has(clave(i, j))) pares.push(`${modelo.nudos[i]!.id}–${modelo.nudos[j]!.id}`);
    }
  }
  if (pares.length) {
    diag.aviso(
      "modelo/nudos-coincidentes",
      `${pares.length} pares de nudos coinciden (a menos de ${TOL} m) sin un muelle ni una restricción que los una: ${listaIds(pares)}. Suele ser un nudo duplicado.`,
      undefined,
      { pares: pares.slice(0, 50) },
    );
  }
}
