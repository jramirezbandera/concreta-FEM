/**
 * Cálculo lineal estático: modelo analítico → desplazamientos y reacciones por caso.
 *
 * Fases, cada una con sus diagnósticos (si alguna deja un error, el cálculo no sigue):
 * 1. Comprobación de nudos, elementos, muelles y apoyos.
 * 2. Numeración de GDL con las restricciones por transformación (u = T·û).
 * 3. Partes del modelo sin ningún apoyo (mecanismo de sólido rígido evidente).
 * 4. Cargas: nodales, de barra (fuerzas nodales equivalentes de sus FER) y de lámina, b = Tᵀ·f
 *    por caso y desplazamientos impuestos.
 * 5. Patrón CSC y ensamblado de K' = Tᵀ·K·T.
 * 6. Factorización con diagnóstico de mecanismos, resolución por bloque y refinamiento.
 * 7. Recuperación: u = T·û, reacciones de apoyos y muelles a tierra, esfuerzos de las barras y
 *    resultantes de las láminas en su centroide.
 * 8. Regla de oro 2: equilibrio ΣF/ΣM a 1e-9 (con la resultante real de las cargas de barra y de
 *    lámina) y resultados finitos en cada caso.
 * 9. Con `modelo.modal` (VS2, `modal.ts`): las masas de cada diafragma salen de las cargas en la
 *    fase 4; los GDL de sus maestros llevan una carga unidad cada uno, como lados de más del mismo
 *    sistema (la misma factorización), y de esas soluciones salen los modos, cada uno con su
 *    equilibrio.
 *
 * El motor es puro: sin IO, sin DOM. El solver "nucleo" necesita `iniciarNucleo()` antes.
 */
import { cargasDeBarrasDelCaso, desplazamientosLocales, equivalentesEnNudos, esfuerzosDeExtremo, fuerzasLocales, type BarraPreparada } from "./barras.ts";
import { Diagnosticos, listaIds } from "./diagnosticos.ts";
import { elementosDelModelo, esMuelleATierra, geometria, rigidezGlobal, type ElementoMotor, type Geometria } from "./elementos.ts";
import { ensamblarRigidez, patronSistema } from "./ensamblado.ts";
import { desequilibrioCargas, equilibrio, sumaResultantes } from "./equilibrio.ts";
import { desplazamientosFisicos, fuerzasIndependientes, numerar, TipoGdl, type Numeracion } from "./gdl.ts";
import { cargasDeLaminasDelCaso, resultantesEnCentroides, type LaminaPreparada } from "./laminas.ts";
import { definicionModal, modosCondensados, prepararModal, type PlanModal } from "./modal.ts";
import { NOMBRES_GDL, type CargasCaso, type CasoCarga, type EstadisticasCalculo, type ModeloAnalitico, type ModoVibracion, type ResultadoCalculo, type ResultadoCaso, type ResultadoModal } from "./modelo.ts";
import { ErrorSinMemoria } from "../nucleo/index.ts";
import { ErrorLimiteMemoria, resolver, RESIDUO_INADMISIBLE, RESIDUO_OBJETIVO, type TipoSolver } from "./solucion.ts";

/** Tolerancia del equilibrio global por caso (regla de oro 2). */
export const TOL_EQUILIBRIO = 1e-9;
/**
 * A2-10: el desequilibrio referido sólo a las cargas. Con un caso resuelto, su redondeo es del orden de
 * 1e-16 por Σ|k·u|/Σ|cargas|; pasar de 1e-6 exige que las reacciones sean 1e10 veces las cargas, que
 * sólo pasa cuando u se dispara (un mecanismo que el pivote no ha visto).
 */
export const TOL_EQUILIBRIO_CARGAS = 1e-6;

/**
 * Límites de tamaño del dispositivo (D9, H16). Un modelo que los pasa acaba con el error
 * `modelo/demasiado-grande` antes de factorizar, en vez de agotar la memoria a medias.
 */
export interface LimitesCalculo {
  /** Ecuaciones del sistema reducido (GDL libres e independientes); se comprueba tras numerar. */
  ecuaciones?: number;
  /** Bytes de memoria lineal del núcleo; se comprueba tras el análisis simbólico, con lo que pedirá factorizar. */
  memoriaNucleo?: number;
}

export interface OpcionesCalculo {
  /** "nucleo" (faer en WASM, por defecto) o "perfil" (TypeScript, referencia para modelos pequeños). */
  solver?: TipoSolver;
  limites?: LimitesCalculo;
  /**
   * Se llama al terminar cada fase (las claves de `estadisticas.tiempos`), con su duración en ms.
   * Las de la solución llegan con el prefijo «solucion.» antes que la propia «solucion».
   */
  alProgreso?: (fase: string, ms: number) => void;
}

const ahora = () => performance.now();
const MB = (b: number) => Math.ceil(b / 2 ** 20);

/**
 * Calcula el modelo. Nunca lanza por un dato del modelo: un dato no válido es un diagnóstico de
 * error, y cualquier otra excepción de JavaScript (un campo obligatorio que falta, un fallo del
 * propio motor) acaba en el error `motor/error-interno`. Sólo se propaga una trampa del WASM
 * (`WebAssembly.RuntimeError`): deja el núcleo en un estado desconocido y quien llama tiene que
 * descartarlo (el worker se recicla, E4).
 */
export function calcular(modelo: ModeloAnalitico, opciones: OpcionesCalculo = {}): ResultadoCalculo {
  try {
    return calcularModelo(modelo, opciones);
  } catch (e) {
    if (e instanceof WebAssembly.RuntimeError) throw e;
    const texto = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return {
      valido: false,
      diagnosticos: [
        {
          codigo: "motor/error-interno",
          severidad: "error",
          mensaje: `El motor no ha podido calcular el modelo (${texto}). Suele deberse a un modelo analítico mal formado (un campo obligatorio que falta); si no, es un fallo del motor.`,
        },
      ],
    };
  }
}

function calcularModelo(modelo: ModeloAnalitico, opciones: OpcionesCalculo): ResultadoCalculo {
  const diag = new Diagnosticos();
  const tiempos: Record<string, number> = {};
  let t0 = ahora();
  const marcar = (fase: string) => {
    const t = ahora();
    tiempos[fase] = t - t0;
    opciones.alProgreso?.(fase, t - t0);
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
  const limiteEcuaciones = opciones.limites?.ecuaciones;
  if (limiteEcuaciones !== undefined && num.nEcuaciones > limiteEcuaciones) {
    diag.error(
      "modelo/demasiado-grande",
      `El modelo tiene ${num.nEcuaciones} ecuaciones y el límite de este dispositivo es ${limiteEcuaciones}. Usa una malla más gruesa o diafragma rígido, o calcula en un equipo con más memoria.`,
      undefined,
      { ecuaciones: num.nEcuaciones, limite: limiteEcuaciones },
    );
    return fallo();
  }
  marcar("numeracion");

  // 4. Cargas. Los vectores de 6 por nudo de cada caso (cargas nodales, equivalentes, Tᵀ·f,
  // desplazamientos impuestos) se construyen caso a caso y se sueltan: del caso sólo quedan sus
  // ecuaciones libres (en B) y Tᵀ·f en los GDL coartados, para las reacciones. La memoria de un
  // cálculo es sobre todo JS (E4-1) y eran ~5 vectores por caso (E6).
  const casos = modelo.casos;
  const nc = casos.length;
  const P = 6 * nn;
  // AU-11: quien indexa los resultados por id pisaría uno con otro
  const vistos = new Set<string>();
  for (const caso of casos) {
    if (vistos.has(caso.id)) diag.error("modelo/id-duplicado", `Hay dos casos con el id ${caso.id}: cada caso tiene que tener el suyo.`, [caso.id]);
    vistos.add(caso.id);
  }
  casos.forEach((caso) => {
    /** AU-12: dos impuestos en el mismo GDL valían el último, sin aviso. */
    const impuestos = new Set<number>();
    for (const c of caso.nodales ?? []) {
      if (!Number.isInteger(c.nudo) || c.nudo < 0 || c.nudo >= nn || !Array.isArray(c.f) || c.f.length !== 6 || !c.f.every(Number.isFinite)) {
        diag.error("carga/no-valida", `El caso ${caso.id} tiene una carga nodal sobre un nudo inexistente o con valores no finitos.`, [caso.id]);
      }
    }
    for (const d of caso.impuestos ?? []) {
      const p = 6 * d.nudo + d.gdl;
      if (!Number.isInteger(d.nudo) || d.nudo < 0 || d.nudo >= nn || !Number.isInteger(d.gdl) || d.gdl < 0 || d.gdl > 5 || !Number.isFinite(d.valor)) {
        diag.error("carga/no-valida", `El caso ${caso.id} tiene un desplazamiento impuesto no válido.`, [caso.id]);
        continue;
      }
      if (impuestos.has(p)) {
        const id = modelo.nudos[d.nudo]!.id;
        diag.error("carga/impuesto-repetido", `El caso ${caso.id} impone dos veces el GDL ${NOMBRES_GDL[d.gdl]} del nudo ${id}: déjelo en uno.`, [caso.id, id]);
        continue;
      }
      impuestos.add(p);
      if (num.tipo[p] !== TipoGdl.Coartado) {
        const id = modelo.nudos[d.nudo]!.id;
        diag.error(
          "carga/impuesto-sin-apoyo",
          `El caso ${caso.id} impone el GDL ${NOMBRES_GDL[d.gdl]} del nudo ${id}, que no está coartado por un apoyo.`,
          [caso.id, id],
        );
      }
    }
  });
  // VS2: los casos que hacen de masa, con su fracción
  const defModal = modelo.modal ? definicionModal(modelo, diag) : null;
  if (diag.hayErrores) return fallo();
  // Cargas de barra: FER condensadas → fuerzas nodales equivalentes. El equilibrio usa su
  // resultante real, no las equivalentes, para que un error de las FER no se cancele.
  const preparadas: (BarraPreparada | undefined)[] = [];
  for (const e of elementos) if (e.barra) preparadas[e.indice] = e.barra;
  const deBarras = casos.map((caso) => cargasDeBarrasDelCaso(caso.id, caso.barras ?? [], preparadas, modelo, geo, diag));
  // Cargas de lámina: equivalentes por las funciones bilineales; el equilibrio usa su resultante real
  const laminas: (LaminaPreparada | undefined)[] = [];
  for (const e of elementos) if (e.lamina) laminas[e.indice] = e.lamina;
  const deLaminas = casos.map((caso) => cargasDeLaminasDelCaso(caso.id, caso.laminas ?? [], laminas, modelo, geo, diag));
  if (diag.hayErrores) return fallo();
  // Lados derechos: b = Tᵀ·f, con f = nodales + equivalentes de barras y de láminas
  const n = num.nEcuaciones;
  const nCoart = num.coartados.length;
  let B = new Float64Array(n * nc);
  const bCoartados = new Float64Array(nCoart * nc);
  /** VS2: masa de cada nudo, t: la componente vertical hacia abajo de las cargas de los casos que hacen de masa, entre g. */
  const masa = defModal ? new Float64Array(nn) : null;
  /** SO: la carga vertical hacia abajo de cada caso en cada nudo (−Fz de sus fuerzas nodales equivalentes), kN, y su resultante. */
  const pesos: Float64Array[] = [];
  const resultantes: { F: [number, number, number]; zF: [number, number] }[] = [];
  casos.forEach((caso, k) => {
    const t = cargasNodales(caso, P);
    const porBarra = deBarras[k]!.porBarra;
    const deLamina = deLaminas[k]!.equivalentes;
    if (deLamina) for (let q = 0; q < P; q++) t[q] += deLamina[q]!;
    deLaminas[k]!.equivalentes = null;
    // A2-19: lo de las barras entra en Σ z·F donde está su carga, no en la cota de sus nudos (las
    // fuerzas nodales equivalentes llevan el resto en sus momentos, que Σ z·F no ve: una puntual a
    // 0,75 m de la base de un pilar de 3 m contaba 5,625 de 9)
    const zF: [number, number] = [deBarras[k]!.zF[0], deBarras[k]!.zF[1]];
    for (const [ib, cb] of porBarra) {
      const [i, j] = modelo.barras![ib]!.nudos;
      const eq = equivalentesEnNudos(preparadas[ib]!, cb.ferC);
      for (let c = 0; c < 6; c++) {
        t[6 * i + c]! += eq[c]!;
        t[6 * j + c]! += eq[6 + c]!;
      }
      const [zi, zj] = [geo.xyz[3 * i + 2]!, geo.xyz[3 * j + 2]!];
      zF[0] -= zi * eq[0]! + zj * eq[6]!;
      zF[1] -= zi * eq[1]! + zj * eq[7]!;
    }
    if (masa && defModal!.fraccion[k] !== 0) {
      const f = defModal!.fraccion[k]! / defModal!.g;
      for (let v = 0; v < nn; v++) masa[v]! -= f * t[6 * v + 2]!;
    }
    const peso = new Float64Array(nn);
    const F: [number, number, number] = [0, 0, 0];
    for (let v = 0; v < nn; v++) {
      const [fx, fy, fz] = [t[6 * v]!, t[6 * v + 1]!, t[6 * v + 2]!];
      peso[v] = -fz;
      F[0] += fx;
      F[1] += fy;
      F[2] += fz;
      const z = geo.xyz[3 * v + 2]!;
      zF[0] += z * fx;
      zF[1] += z * fy;
    }
    pesos.push(peso);
    resultantes.push({ F, zF });
    const b = fuerzasIndependientes(num, t);
    for (let j = 0; j < n; j++) B[n * k + j] = b[num.gdlDeEcuacion[j]!]!;
    for (let i = 0; i < nCoart; i++) bCoartados[nCoart * k + i] = b[num.coartados[i]!]!;
    const perdidas: number[] = [];
    for (let q = 0; q < P; q++) if (num.tipo[q] === TipoGdl.SinRigidez && b[q] !== 0) perdidas.push(q);
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
  // VS2: la masa, a los diafragmas, y una carga unidad en cada GDL dinámico (los lados nc … nc + nm − 1)
  let plan: PlanModal | null = null;
  if (masa) {
    for (const m of modelo.modal!.nodales ?? []) masa[m.nudo]! += m.m;
    plan = prepararModal(modelo, geo, num, masa, defModal!.g, diag);
    if (!plan || diag.hayErrores) return fallo();
    const conCasos = B;
    B = new Float64Array(n * (nc + plan.gdl.length));
    B.set(conCasos);
    plan.gdl.forEach((p, j) => (B[n * (nc + j) + num.ecuacion[p]!] = 1));
  }
  const nm = plan ? plan.gdl.length : 0;
  marcar("cargas");

  // 5. Patrón y ensamblado
  const ps = patronSistema(num, elementos);
  marcar("patron");
  const K = ensamblarRigidez(modelo, num, elementos, ps);
  marcar("ensamblado");
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

  // Desplazamientos impuestos: b = (Tᵀ·f)_libres − K'_{libres, coartados}·û_coartados
  for (let k = 0; k < nc; k++) {
    if (!(casos[k]!.impuestos?.length)) continue;
    const u = impuestosDelCaso(casos[k]!, P);
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
  const alProgreso = opciones.alProgreso;
  let sol: ReturnType<typeof resolver> | null = null;
  try {
    sol =
      n > 0
        ? resolver(ps.patron, K.valores, K.diagonal, B, nc + nm, opciones.solver ?? "nucleo", {
            limiteMemoria: opciones.limites?.memoriaNucleo,
            // VS2: los lados del modal se refinan aparte, para que los casos salgan como sin él
            ...(nm ? { grupos: [nc, nm] } : {}),
            alProgreso: alProgreso && ((fase, ms) => alProgreso(`solucion.${fase}`, ms)),
          })
        : null;
  } catch (e) {
    if (e instanceof ErrorLimiteMemoria) {
      diag.error(
        "modelo/demasiado-grande",
        `Factorizar el modelo (${n} ecuaciones) necesitaría unos ${MB(e.estimada)} MB de memoria y el límite de este dispositivo es ${MB(e.limite)} MB. Usa una malla más gruesa o diafragma rígido, o calcula en un equipo con más memoria.`,
        undefined,
        { ecuaciones: n, memoriaEstimada: e.estimada, limite: e.limite },
      );
      return fallo(estadisticas);
    }
    if (e instanceof ErrorSinMemoria) {
      diag.error(
        "solver/sin-memoria",
        `El núcleo se ha quedado sin memoria al resolver el modelo (${n} ecuaciones): es demasiado grande para la memoria disponible. Usa una malla más gruesa o diafragma rígido, o calcula en un equipo con más memoria.`,
        undefined,
        { ecuaciones: n },
      );
      return fallo(estadisticas);
    }
    throw e;
  }
  marcar("solucion");
  if (sol) {
    estadisticas.nnzL = sol.nnzL;
    if (sol.memoria) estadisticas.memoriaNucleo = sol.memoria;
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
  const kMuelles = muellesTierra.map((e) => rigidezGlobal(modelo, e));
  const resultados: ResultadoCaso[] = [];
  let equilibrioRoto = false;
  /** SO: la resultante de las cargas de un caso (o de un modo) y el trabajo P·δ de cada caso del modelo con el desplazamiento u. */
  const cargasCaso = (resultante: { F: readonly number[]; zF: readonly number[] }, u: Float64Array): CargasCaso => {
    const pdelta = new Float64Array(2 * nc);
    for (let k = 0; k < nc; k++) {
      const peso = pesos[k]!;
      let sx = 0;
      let sy = 0;
      for (let v = 0; v < nn; v++) {
        const p = peso[v]!;
        if (p !== 0) {
          sx += p * u[6 * v]!;
          sy += p * u[6 * v + 1]!;
        }
      }
      pdelta[2 * k] = sx;
      pdelta[2 * k + 1] = sy;
    }
    return { F: [resultante.F[0]!, resultante.F[1]!, resultante.F[2]!], zF: [resultante.zF[0]!, resultante.zF[1]!], pdelta };
  };
  const magnitud = new Float64Array(P);
  /**
   * Reacciones de los apoyos y de los muelles a tierra con los desplazamientos û (por GDL físico
   * independiente) y u: R = (K'·û − Tᵀ·f) en los GDL coartados, con Tᵀ·f del caso k (nada con
   * k < 0: un modo, que sólo carga GDL libres). Deja en `magnitud` la suma de |términos| de cada
   * reacción, la escala de su redondeo.
   */
  const reaccionesDe = (uI: Float64Array, u: Float64Array, k: number): Float64Array => {
    const reacciones = new Float64Array(P);
    magnitud.fill(0);
    if (k >= 0) {
      for (let i = 0; i < nCoart; i++) {
        const p = num.coartados[i]!;
        const b = bCoartados[nCoart * k + i]!;
        reacciones[p] = -b;
        magnitud[p] = Math.abs(b);
      }
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
    return reacciones;
  };
  for (let k = 0; k < nc; k++) {
    const caso = casos[k]!;
    const uI = impuestosDelCaso(caso, P); // û por GDL físico independiente
    if (sol?.X) for (let j = 0; j < n; j++) uI[num.gdlDeEcuacion[j]!] = sol.X[n * k + j]!;
    const u = desplazamientosFisicos(num, uI);
    const reacciones = reaccionesDe(uI, u, k);
    const extra = sumaResultantes(deBarras[k]!.resultante, deLaminas[k]!.resultante);
    const eq = equilibrio(geo, cargasNodales(caso, P), reacciones, magnitud, extra);
    const eqCargas = desequilibrioCargas(geo, cargasNodales(caso, P), reacciones, extra);
    // Esfuerzos de las barras en los extremos de su tramo flexible
    const esfuerzosBarras = new Float64Array(12 * (modelo.barras?.length ?? 0));
    for (const e of elementos) {
      if (!e.barra) continue;
      const cb = deBarras[k]!.porBarra.get(e.indice);
      const ul = desplazamientosLocales(e.barra, u, e.nudos[0]!, e.nudos[1]!, cb);
      esfuerzosDeExtremo(fuerzasLocales(e.barra, ul, cb), cb, esfuerzosBarras, 12 * e.indice);
    }
    const residuo = sol ? sol.residuos[k]! : 0;
    const finito = u.every(Number.isFinite) && reacciones.every(Number.isFinite) && esfuerzosBarras.every(Number.isFinite);
    if (!finito) {
      diag.error("resultado/no-finito", `El caso ${caso.id} da desplazamientos, reacciones o esfuerzos no finitos.`, [caso.id]);
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
    } else if (eqCargas && !(eqCargas.fuerzas <= TOL_EQUILIBRIO_CARGAS && eqCargas.momentos <= TOL_EQUILIBRIO_CARGAS)) {
      equilibrioRoto = true;
      diag.error(
        "equilibrio/no-cumple",
        `El caso ${caso.id} no cumple el equilibrio global respecto a sus cargas: |ΣF|/Σ|cargas| = ${eqCargas.fuerzas.toExponential(2)} y |ΣM|/Σ|M de las cargas| = ${eqCargas.momentos.toExponential(2)} (tolerancia ${TOL_EQUILIBRIO_CARGAS}), con desplazamientos de hasta ${u.reduce((a, v) => Math.max(a, Math.abs(v)), 0).toExponential(2)}. El resultado no es válido: lo más probable es un mecanismo (un giro o un desplazamiento sin coartar) que el solver no ha detectado.` +
          (sol?.malCondicionados.length ? " Ver el aviso solver/mal-condicionado: el GDL que nombra suele ser el del mecanismo." : ""),
        [caso.id],
        { ...eqCargas, residuo },
      );
    }
    if (!(residuo <= RESIDUO_INADMISIBLE)) {
      diag.error(
        "solver/residuo",
        `El caso ${caso.id} queda con un error hacia atrás de ${residuo.toExponential(2)} tras el refinamiento (inadmisible por encima de ${RESIDUO_INADMISIBLE}): el solver no ha resuelto el sistema y el resultado no es válido, aunque cumpla el equilibrio global.`,
        [caso.id],
        { residuo },
      );
    } else if (residuo > RESIDUO_OBJETIVO) {
      diag.aviso(
        "solver/residuo",
        `El caso ${caso.id} queda con un error hacia atrás de ${residuo.toExponential(2)} tras el refinamiento (objetivo ${RESIDUO_OBJETIVO}): el solver no ha resuelto bien el sistema.`,
        [caso.id],
        { residuo },
      );
    }
    const esfuerzosLaminas = new Float64Array(8 * (modelo.laminas?.length ?? 0));
    resultados.push({ id: caso.id, u, reacciones, esfuerzosBarras, esfuerzosLaminas, equilibrio: eq, residuo, cargas: cargasCaso(resultantes[k]!, u) });
  }
  // Resultantes de las láminas en su centroide: el operador de cada lámina se calcula una vez para todos los casos
  if (modelo.laminas?.length) {
    resultantesEnCentroides(
      elementos.filter((e) => e.lamina),
      resultados.map((r) => r.u),
      resultados.map((r) => r.esfuerzosLaminas),
    );
    for (const r of resultados) {
      if (!r.esfuerzosLaminas.every(Number.isFinite)) diag.error("resultado/no-finito", `El caso ${r.id} da resultantes de lámina no finitas.`, [r.id]);
    }
  }
  marcar("recuperacion");
  if (diag.hayErrores) {
    return { valido: false, casosNoValidos: equilibrioRoto ? resultados : undefined, diagnosticos: diag.lista, estadisticas };
  }
  if (!plan) return { valido: true, casos: resultados, diagnosticos: diag.lista, estadisticas };

  // 9. Modos (VS2): la flexibilidad en los GDL dinámicos, el problema propio y la forma de cada modo
  const X = sol?.X;
  if (!X) {
    diag.error("modal/sin-ecuaciones", "El análisis modal no se puede hacer: el modelo no tiene ecuaciones.");
    return { valido: false, diagnosticos: diag.lista, estadisticas };
  }
  const F = new Float64Array(nm * nm);
  const xy = new Float64Array(2 * nm);
  for (let i = 0; i < nm; i++) {
    const p = plan.gdl[i]!;
    const e = num.ecuacion[p]!;
    for (let j = 0; j < nm; j++) F[nm * i + j] = X[n * (nc + j) + e]!;
    const v = Math.floor(p / 6);
    xy[2 * i] = geo.xyz[3 * v]!;
    xy[2 * i + 1] = geo.xyz[3 * v + 1]!;
  }
  const condensados = modosCondensados(plan, F, xy, diag);
  if (!condensados || diag.hayErrores) return { valido: false, diagnosticos: diag.lista, estadisticas };
  const modos: ModoVibracion[] = [];
  const nDiaf = plan.diafragmas.length;
  const uE = new Float64Array(n);
  const uI = new Float64Array(P);
  const fNodal = new Float64Array(P);
  const rotos: number[] = [];
  const elPlan = plan;
  condensados.forEach((md, im) => {
    // û = Σ fⱼ·xⱼ, con xⱼ la solución de la carga unidad en el GDL dinámico j
    uE.fill(0);
    fNodal.fill(0);
    const fuerzas = new Float64Array(3 * nDiaf);
    for (let j = 0; j < nm; j++) {
      const fj = md.f[j]!;
      fNodal[elPlan.gdl[j]!] = fj;
      fuerzas[3 * elPlan.diafragma[j]! + elPlan.componente[j]!] = fj;
      if (fj === 0) continue;
      const o = n * (nc + j);
      for (let e = 0; e < n; e++) uE[e]! += fj * X[o + e]!;
    }
    uI.fill(0);
    for (let e = 0; e < n; e++) uI[num.gdlDeEcuacion[e]!] = uE[e]!;
    const u = desplazamientosFisicos(num, uI);
    const reacciones = reaccionesDe(uI, u, -1);
    const eq = equilibrio(geo, fNodal, reacciones, magnitud);
    // VS3: el modo como un caso: los esfuerzos de sus barras (no lleva cargas de barra) y, después, los de sus láminas
    const esfuerzosBarras = new Float64Array(12 * (modelo.barras?.length ?? 0));
    for (const e of elementos) {
      if (!e.barra) continue;
      const ul = desplazamientosLocales(e.barra, u, e.nudos[0]!, e.nudos[1]!);
      esfuerzosDeExtremo(fuerzasLocales(e.barra, ul), undefined, esfuerzosBarras, 12 * e.indice);
    }
    const esfuerzosLaminas = new Float64Array(8 * (modelo.laminas?.length ?? 0));
    if (!u.every(Number.isFinite) || !reacciones.every(Number.isFinite) || !esfuerzosBarras.every(Number.isFinite) || !(eq.fuerzas <= TOL_EQUILIBRIO && eq.momentos <= TOL_EQUILIBRIO)) rotos.push(im + 1);
    const forma = new Float64Array(3 * nDiaf);
    elPlan.diafragmas.forEach((df, d) => {
      const m = df.maestro;
      const rz = u[6 * m + 5]!;
      forma[3 * d] = u[6 * m]! - (df.cm[1] - geo.xyz[3 * m + 1]!) * rz;
      forma[3 * d + 1] = u[6 * m + 1]! + (df.cm[0] - geo.xyz[3 * m]!) * rz;
      forma[3 * d + 2] = rz;
    });
    // SO: la resultante de las fuerzas de inercia (sobre los maestros, a su cota) y el trabajo P·δ con la forma del modo
    const F: [number, number, number] = [0, 0, 0];
    const zF: [number, number] = [0, 0];
    elPlan.diafragmas.forEach((df, d) => {
      const z = geo.xyz[3 * df.maestro + 2]!;
      F[0] += fuerzas[3 * d]!;
      F[1] += fuerzas[3 * d + 1]!;
      zF[0] += z * fuerzas[3 * d]!;
      zF[1] += z * fuerzas[3 * d + 1]!;
    });
    modos.push({ omega2: md.omega2, periodo: (2 * Math.PI) / Math.sqrt(md.omega2), forma, fuerzas, participacion: md.participacion, masaEfectiva: md.masaEfectiva, u, reacciones, esfuerzosBarras, esfuerzosLaminas, equilibrio: eq, cargas: cargasCaso({ F, zF }, u) });
  });
  if (modelo.laminas?.length && modos.length) {
    resultantesEnCentroides(
      elementos.filter((e) => e.lamina),
      modos.map((m) => m.u),
      modos.map((m) => m.esfuerzosLaminas),
    );
    modos.forEach((m, im) => {
      if (!m.esfuerzosLaminas.every(Number.isFinite) && !rotos.includes(im + 1)) rotos.push(im + 1);
    });
  }
  if (rotos.length) {
    diag.error(
      "modal/equilibrio",
      `${rotos.length === 1 ? `El modo ${rotos[0]} no cumple` : `Los modos ${listaIds(rotos.map(String))} no cumplen`} el equilibrio entre sus fuerzas de inercia y sus reacciones (tolerancia ${TOL_EQUILIBRIO}): el análisis modal no es válido.`,
      undefined,
      { modos: rotos },
    );
    return { valido: false, diagnosticos: diag.lista, estadisticas };
  }
  let residuo = 0;
  for (let j = 0; j < nm; j++) residuo = Math.max(residuo, sol!.residuos[nc + j]!);
  if (!(residuo <= RESIDUO_INADMISIBLE)) {
    diag.error("solver/residuo", `Las soluciones unitarias del análisis modal quedan con un error hacia atrás de ${residuo.toExponential(2)} tras el refinamiento (inadmisible por encima de ${RESIDUO_INADMISIBLE}): el análisis modal no es válido.`, undefined, { residuo });
    return { valido: false, diagnosticos: diag.lista, estadisticas };
  }
  if (residuo > RESIDUO_OBJETIVO) {
    diag.aviso("solver/residuo", `Las soluciones unitarias del análisis modal quedan con un error hacia atrás de ${residuo.toExponential(2)} tras el refinamiento (objetivo ${RESIDUO_OBJETIVO}).`, undefined, { residuo });
  }
  const modal: ResultadoModal = { g: plan.g, masas: plan.masas, cm: plan.cm, diafragmas: plan.diafragmas, modos, gdl: nm, residuo };
  marcar("modal");
  return { valido: true, casos: resultados, diagnosticos: diag.lista, estadisticas, modal };
}

/** Cargas nodales del caso (ya comprobadas), 6 por nudo, sumadas en el orden del caso. */
function cargasNodales(caso: CasoCarga, P: number): Float64Array {
  const f = new Float64Array(P);
  for (const c of caso.nodales ?? []) for (let g = 0; g < 6; g++) f[6 * c.nudo + g]! += c.f[g]!;
  return f;
}

/** Desplazamientos impuestos del caso (ya comprobados) en sus GDL físicos; si se repite uno, vale el último. */
function impuestosDelCaso(caso: CasoCarga, P: number): Float64Array {
  const u = new Float64Array(P);
  for (const d of caso.impuestos ?? []) u[6 * d.nudo + d.gdl] = d.valor;
  return u;
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
  for (const m of modelo.muelles ?? []) if (Array.isArray(m.nudos) && m.nudos.length === 2) unidos.add(clave(m.nudos[0], m.nudos[1]!));
  for (const r of modelo.restricciones ?? []) for (const s of Array.isArray(r.esclavos) ? r.esclavos : []) unidos.add(clave(r.maestro, s));
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
