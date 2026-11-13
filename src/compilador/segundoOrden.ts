/**
 * Fase SO (`docs/fem3d/segundo-orden.md`): el segundo orden global (P-Δ) por el **coeficiente de
 * estabilidad global**, el método de la memoria de CYPECAD («Consideración de Efectos de 2º Orden») y
 * el de la amplificación del CE Anejo 19 H.2.
 *
 * Con el cálculo de primer orden de cada caso base (sus desplazamientos y, del motor, la resultante
 * de sus cargas y el trabajo P·δ de cada caso del modelo en ellos: `CargasCaso`), de cada **hipótesis
 * horizontal** h (un caso lógico con acción de viento, W, o de sismo, E; los del programa también):
 * - su dirección e: la de su acción (`direccion`) o, si no la lleva, la de su cortante en la base; el
 *   sentido, el de ese cortante, para que lo que sigue salga positivo;
 * - su **momento volcador** M_H = Σ_v (F_v·e)·(z_v − z₀), con las fuerzas nodales equivalentes del caso
 *   y z₀ el nivel sin desplazamientos horizontales (la cota más baja de los apoyos con alguna coacción
 *   horizontal): el Σ H_i·z_i de CYPECAD;
 * - y con cada **caso gravitatorio** k (los lógicos que no son hipótesis horizontales), el **momento
 *   P·δ** M_Pδ,k = m·Σ_v P_v,k·(δ_v,h·e), con P_v,k la carga vertical hacia abajo del caso k en el nudo v,
 *   δ_v,h el desplazamiento del nudo en la hipótesis h y m el multiplicador de los desplazamientos (la
 *   fisuración): el Σ P_ij·Δ_ij de CYPECAD, nudo a nudo. C_k = M_Pδ,k / M_H es su índice de estabilidad.
 *
 * Con el sismo del programa las dos sumas son variables lineales en cada modo y se combinan como
 * cualquier otra variable (`Superposicion.valor`: la regla del cálculo, los desplazamientos por μ).
 *
 * En una combinación con factores γ, el índice de estabilidad de h es **Q = Σ_k γ_k·C_k** y su
 * coeficiente **γz = 1 / (1 − Q)**, que multiplica el factor de h en la combinación: todo lo de la
 * hipótesis (esfuerzos y desplazamientos) sale amplificado. Un caso suelto o una expresión escrita a
 * mano no se amplifican. Con Q ≥ 1 no hay coeficiente: inestabilidad global.
 *
 * Puro: entra lo del cálculo y salen números y diagnósticos.
 */
import type { Combinacion } from "../combinaciones/generador.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { Superposicion } from "../motor/espectral.ts";
import type { ModeloAnalitico, ResultadoCaso } from "../motor/modelo.ts";
import type { CasoFisico, SegundoOrdenEdificio } from "./fisico.ts";

/** Multiplicador de los desplazamientos por defecto: la rigidez al 50 % del Código Modelo CEB-FIP 1990 (SO-c). */
export const MULTIPLICADOR_POR_DEFECTO = 2;
/** Mayor multiplicador admitido (3 es la rigidez nominal del hormigón fisurado del CE; más, un error de escritura). */
export const MULTIPLICADOR_MAXIMO = 10;
/** γz por encima del cual la estructura es traslacional (NBR 6118; la memoria de CYPECAD: por debajo de 1,1, «su efecto será pequeño y prácticamente despreciable»). */
export const GAMMA_TRASLACIONAL = 1.1;
/** γz por encima del cual el método de la amplificación no es aplicable (lo que avisa CYPECAD; el CE A22 corta en αcr < 3, γz > 1,5; EC8, en θ > 0,2, γz > 1,25). */
export const GAMMA_FUERA_DEL_METODO = 1.33;

export interface OpcionesSegundoOrden {
  amplificar: boolean;
  /** m: por cuánto se multiplican los desplazamientos del cálculo (secciones brutas). */
  multiplicador: number;
  /** ¿Lo escribió el usuario (`acciones.segundoOrden`)? */
  escrito: boolean;
}

export function opcionesSegundoOrden(s: SegundoOrdenEdificio | undefined): OpcionesSegundoOrden {
  return { amplificar: s?.amplificar ?? true, multiplicador: s?.multiplicadorDesplazamientos ?? MULTIPLICADOR_POR_DEFECTO, escrito: s !== undefined };
}

/** Lo que no vale de `acciones.segundoOrden` (los tipos y los campos desconocidos los rechaza el esquema). */
export function erroresSegundoOrden(s: SegundoOrdenEdificio | undefined): { codigo: string; mensaje: string }[] {
  // A2-62: amplificar «no» amplificaba
  if (s?.amplificar !== undefined && typeof s.amplificar !== "boolean") return [{ codigo: "segundo-orden/no-valido", mensaje: `amplificar del segundo orden tiene que ser true o false (es ${JSON.stringify(s.amplificar)}).` }];
  const m = s?.multiplicadorDesplazamientos;
  if (m === undefined) return [];
  if (!(typeof m === "number" && Number.isFinite(m) && m > 0 && m <= MULTIPLICADOR_MAXIMO))
    return [{ codigo: "segundo-orden/multiplicador", mensaje: `El multiplicador de los desplazamientos del segundo orden tiene que ser un número mayor que 0 y no mayor que ${MULTIPLICADOR_MAXIMO} (es ${String(m)}): 1 es la rigidez bruta, 2 la del Código Modelo y 3 la nominal del CE para hormigón fisurado.` }];
  return [];
}

/** ¿Es el caso una hipótesis horizontal (viento o sismo)? */
export const esHipotesisHorizontal = (c: CasoFisico): boolean => c.accion?.tipo === "W" || c.accion?.tipo === "E";

export interface HipotesisHorizontal {
  caso: string;
  /** Índice del caso lógico. */
  indice: number;
  /** Dirección unitaria e en planta (con el sentido de su cortante en la base). */
  direccion: [number, number];
  /** Cortante en la base en e, kN, y momento volcador M_H respecto a z0, kN·m. */
  V: number;
  MH: number;
  /**
   * A2-4: el nivel sin desplazamientos de esta hipótesis, m: el más alto bajo el cual su desplazamiento
   * según e no pasa de FRACCION_SIN_DESPLAZAMIENTO de su máximo (con un sótano sujeto, su techo), y
   * nunca por debajo del de los apoyos horizontales más bajos (`SegundoOrdenCalculado.z0`).
   */
  z0: number;
  /** Por caso lógico (0 en los que no son gravitatorios): M_Pδ,k ya por m, kN·m, y C_k = M_Pδ,k / M_H. */
  MPdelta: Float64Array;
  C: Float64Array;
}

/** A2-4: por debajo de esta fracción del máximo, el desplazamiento de un nivel es despreciable. */
export const FRACCION_SIN_DESPLAZAMIENTO = 0.01;

export interface SegundoOrdenCalculado {
  opciones: OpcionesSegundoOrden;
  /** La cota de los apoyos horizontales más bajos, m (el z0 de cada hipótesis no baja de ella). */
  z0: number;
  horizontales: HipotesisHorizontal[];
  /** Índices lógicos de los casos gravitatorios (los que no son hipótesis horizontales). */
  gravitatorios: number[];
  /** Hipótesis horizontales sin carga horizontal (no se amplifican). */
  sinCarga: string[];
}

/**
 * El segundo orden de un cálculo. `casosLogicos`: `Consultas.fisico.casos`; `casos`: los casos base
 * con sus `cargas`; `sup`: la superposición de los lógicos sobre los base.
 */
export function calcularSegundoOrden(casosLogicos: readonly CasoFisico[], modelo: ModeloAnalitico, casos: readonly ResultadoCaso[], sup: Superposicion, opciones: OpcionesSegundoOrden): SegundoOrdenCalculado {
  let z0 = Infinity;
  for (const a of modelo.apoyos ?? []) if (a.coartados[0] || a.coartados[1]) z0 = Math.min(z0, modelo.nudos[a.nudo]!.z);
  if (!Number.isFinite(z0)) for (const n of modelo.nudos) z0 = Math.min(z0, n.z);
  if (!Number.isFinite(z0)) z0 = 0;
  const gravitatorios: number[] = [];
  const indicesH: number[] = [];
  casosLogicos.forEach((c, k) => (esHipotesisHorizontal(c) ? indicesH : gravitatorios).push(k));
  const horizontales: HipotesisHorizontal[] = [];
  const sinCarga: string[] = [];
  const nl = casosLogicos.length;
  // A2-4: los nudos por niveles (cota), de abajo arriba
  const porNivel = new Map<number, number[]>();
  modelo.nudos.forEach((n, i) => {
    const z = Math.round(n.z * 1e6) / 1e6;
    porNivel.set(z, [...(porNivel.get(z) ?? []), i]);
  });
  const niveles = [...porNivel.keys()].sort((a, b) => a - b);
  /** El nivel sin desplazamientos de la hipótesis de factores f en la dirección e (A2-4). */
  const z0De = (f: ArrayLike<number>, e: readonly [number, number]): number => {
    const maximo = niveles.map((z) => {
      let m = 0;
      for (const n of porNivel.get(z)!) m = Math.max(m, Math.abs(sup.valor(f, (b) => e[0] * casos[b]!.u[6 * n]! + e[1] * casos[b]!.u[6 * n + 1]!, true)));
      return m;
    });
    const tope = FRACCION_SIN_DESPLAZAMIENTO * Math.max(0, ...maximo);
    let r = z0;
    for (let i = 0; i < niveles.length && maximo[i]! <= tope; i++) r = Math.max(r, niveles[i]!);
    return r;
  };
  for (const k of indicesH) {
    const c = casosLogicos[k]!;
    const f = sup.factoresCaso(k);
    const Fx = sup.valor(f, (b) => casos[b]!.cargas.F[0]);
    const Fy = sup.valor(f, (b) => casos[b]!.cargas.F[1]);
    // La dirección: la de la resultante horizontal (A2-22: un viento a 45° declarado «X» contaba sólo su
    // componente en X, y uno sólo en Y declarado «X» no se amplificaba). La declarada, sólo en un caso
    // del sismo, cuya resultante combinada no tiene signo
    let e: [number, number];
    const n = Math.hypot(Fx, Fy);
    if (sup.logicos[k]!.espectral && (c.accion?.direccion === "X" || c.accion?.direccion === "Y")) e = c.accion.direccion === "X" ? [1, 0] : [0, 1];
    else {
      if (!(n > 0)) {
        sinCarga.push(c.id);
        continue;
      }
      e = [Fx / n, Fy / n];
    }
    let V = sup.valor(f, (b) => e[0] * casos[b]!.cargas.F[0] + e[1] * casos[b]!.cargas.F[1]);
    // A2-4: desde el nivel sin desplazamientos de esta hipótesis (con un sótano sujeto en horizontal,
    // su techo: medido desde la base de sus muros, Q salía ×0,61 con viento y ×0,64 con sismo)
    const zh = z0De(f, e);
    // El momento respecto a z0 de cada caso base, y luego combinado: con el sismo la combinación de los
    // modos no es lineal, y combinar Σ z·F y ΣF por separado hacía depender M_H del origen de cotas (A2-5)
    let MH = sup.valor(f, (b) => e[0] * (casos[b]!.cargas.zF[0] - zh * casos[b]!.cargas.F[0]) + e[1] * (casos[b]!.cargas.zF[1] - zh * casos[b]!.cargas.F[1]));
    if (!(Math.abs(V) > 0) || !(Math.abs(MH) > 0)) {
      sinCarga.push(c.id);
      continue;
    }
    // El sentido de e: el del cortante en la base (cambiar e de signo cambia el de todo lo lineal en e)
    const signo = V < 0 ? -1 : 1;
    if (signo < 0) e = [-e[0], -e[1]];
    V *= signo;
    MH *= signo;
    const MPdelta = new Float64Array(nl);
    const C = new Float64Array(nl);
    for (const kg of gravitatorios) {
      const lg = sup.logicos[kg]!;
      if (lg.espectral) continue;
      const b0 = lg.base;
      // e ya lleva el sentido del cortante: con él, el trabajo P·δ sale positivo cuando la estructura cede en la dirección del empuje
      const w = opciones.multiplicador * sup.valor(f, (b) => e[0] * casos[b]!.cargas.pdelta[2 * b0]! + e[1] * casos[b]!.cargas.pdelta[2 * b0 + 1]!, true);
      MPdelta[kg] = w;
      C[kg] = w / MH;
    }
    horizontales.push({ caso: c.id, indice: k, direccion: e, V, MH, z0: zh, MPdelta, C });
  }
  return { opciones, z0, horizontales, gravitatorios, sinCarga };
}

export interface CoeficienteHipotesis {
  caso: string;
  indice: number;
  /** Q = Σ_k γ_k·C_k de la combinación. */
  Q: number;
  /** γz = 1 / (1 − Q), y 1 con Q < 0 (A2-23); null con Q ≥ 1 (inestable). */
  coeficiente: number | null;
}

/** Q y γz de cada hipótesis horizontal con factor en la combinación. */
export function coeficientes(so: SegundoOrdenCalculado, factores: ArrayLike<number>): CoeficienteHipotesis[] {
  const r: CoeficienteHipotesis[] = [];
  for (const h of so.horizontales) {
    if (!factores[h.indice]) continue;
    let Q = 0;
    for (const kg of so.gravitatorios) {
      const g = factores[kg]!;
      if (g) Q += g * h.C[kg]!;
    }
    // A2-23: un Q negativo (la gravedad de la combinación hacia arriba) no desamplifica: γz = 1
    r.push({ caso: h.caso, indice: h.indice, Q, coeficiente: Q < 1 ? 1 / (1 - Math.max(0, Q)) : null });
  }
  return r;
}

/**
 * La combinación con los factores de sus hipótesis horizontales multiplicados por su γz, y qué se ha
 * aplicado (`amplificacion`). La misma combinación si no tiene hipótesis horizontales con carga; null
 * si alguna tiene Q ≥ 1.
 */
export function amplificar(so: SegundoOrdenCalculado, c: Combinacion): Combinacion | null {
  const cs = coeficientes(so, c.factores);
  if (!cs.length) return c;
  if (cs.some((x) => x.coeficiente === null)) return null;
  const factores = Float64Array.from(c.factores);
  for (const x of cs) factores[x.indice] = factores[x.indice]! * x.coeficiente!;
  // La etiqueta lleva los factores de primer orden; con el γz de cada hipótesis detrás (A2-65)
  const etiqueta = `${c.etiqueta} (×γz: ${cs.map((x) => `${x.caso} ${String(Math.round(x.coeficiente! * 1e4) / 1e4)}`).join(", ")})`;
  return { ...c, factores, etiqueta, amplificacion: cs.map((x) => ({ caso: x.caso, Q: x.Q, coeficiente: x.coeficiente! })) };
}

/** Lo peor de cada hipótesis horizontal en un conjunto de combinaciones. */
export interface MaximoHipotesis {
  caso: string;
  combinacion: string;
  Q: number;
  coeficiente: number | null;
}

export function maximos(so: SegundoOrdenCalculado, combinaciones: readonly Combinacion[]): MaximoHipotesis[] {
  const peor = new Map<string, MaximoHipotesis>();
  for (const c of combinaciones) {
    for (const x of coeficientes(so, c.factores)) {
      const p = peor.get(x.caso);
      if (!p || x.Q > p.Q) peor.set(x.caso, { caso: x.caso, combinacion: c.id, Q: x.Q, coeficiente: x.coeficiente });
    }
  }
  return so.horizontales.map((h) => peor.get(h.caso)).filter((x): x is MaximoHipotesis => x !== undefined);
}

const coma = (v: number, d = 2) => v.toFixed(d).replace(".", ",");

/**
 * Los diagnósticos del segundo orden sobre un conjunto de combinaciones (§7.3 del plan): inestable
 * (error), fuera del método (aviso), traslacional (info) y, desactivado, el recordatorio de β > 1.
 */
export function diagnosticosSegundoOrden(so: SegundoOrdenCalculado, combinaciones: readonly Combinacion[]): Diagnostico[] {
  const d: Diagnostico[] = [];
  const m = maximos(so, combinaciones);
  if (!m.length) return d;
  const peor = m.reduce((a, b) => (b.Q > a.Q ? b : a));
  const inestables = m.filter((x) => x.coeficiente === null);
  const dicho = (x: MaximoHipotesis) => `${x.caso} en ${x.combinacion}`;
  if (inestables.length) {
    d.push({
      codigo: "segundo-orden/inestable",
      severidad: "error",
      mensaje: `Con ${inestables.map(dicho).join(", ")} el índice de estabilidad Q = Σγ·C llega a ${coma(peor.Q)} ≥ 1: el edificio es inestable frente al segundo orden en esa dirección (el coeficiente de estabilidad global no existe) y esas combinaciones no se pueden dar. Hay que rigidizarlo.`,
      ids: inestables.map((x) => x.caso),
    });
    return d;
  }
  const gz = peor.coeficiente!;
  if (!so.opciones.amplificar) {
    if (gz > GAMMA_TRASLACIONAL)
      d.push({
        codigo: "segundo-orden/sin-amplificar",
        severidad: "aviso",
        mensaje: `El segundo orden global está desactivado (acciones.segundoOrden.amplificar) y la estructura es traslacional: el coeficiente de estabilidad global llega a γz = ${coma(gz, 3)} (Q = ${coma(peor.Q, 3)}, ${dicho(peor)}, con los desplazamientos por ${coma(so.opciones.multiplicador, 1)}). Las combinaciones son de primer orden, así que los pilares necesitan un coeficiente de pandeo β > 1 (estructura traslacional).`,
        ids: [peor.caso],
      });
    return d;
  }
  if (gz > GAMMA_FUERA_DEL_METODO)
    d.push({
      codigo: "segundo-orden/fuera-del-metodo",
      severidad: "aviso",
      mensaje: `El coeficiente de estabilidad global llega a γz = ${coma(gz, 3)} (Q = ${coma(peor.Q, 3)}, ${dicho(peor)}, con los desplazamientos por ${coma(so.opciones.multiplicador, 1)}): por encima de ${coma(GAMMA_FUERA_DEL_METODO)} el método de la amplificación de las hipótesis horizontales no es aplicable y hace falta un cálculo de segundo orden. Los resultados van amplificados igualmente.`,
      ids: [peor.caso],
    });
  else if (gz > GAMMA_TRASLACIONAL)
    d.push({
      codigo: "segundo-orden/traslacional",
      severidad: "info",
      mensaje: `Estructura traslacional: el coeficiente de estabilidad global de las hipótesis horizontales llega a γz = ${coma(gz, 3)} (Q = ${coma(peor.Q, 3)}, ${dicho(peor)}, con los desplazamientos por ${coma(so.opciones.multiplicador, 1)}), por encima de ${coma(GAMMA_TRASLACIONAL)}. Sus esfuerzos y desplazamientos van multiplicados por su γz en cada combinación (segundo orden global, P-Δ), y los pilares se comprueban como intraslacionales (β = 1).`,
      ids: [peor.caso],
    });
  return d;
}

/** La hipótesis del cálculo (lo que hace el segundo orden del programa). */
export function hipotesisSegundoOrden(s: SegundoOrdenEdificio | undefined, casosHorizontales: readonly string[]): string | null {
  if (!casosHorizontales.length) return null;
  const o = opcionesSegundoOrden(s);
  const casos = casosHorizontales.join(", ");
  if (!o.amplificar) return `Segundo orden global (P-Δ) desactivado (acciones.segundoOrden.amplificar: false): las combinaciones con ${casos} son de primer orden, y en una estructura traslacional los pilares necesitan un coeficiente de pandeo β > 1. Se calcula e informa el coeficiente de estabilidad global γz de cada hipótesis con los desplazamientos por ${coma(o.multiplicador, 1)}.`;
  return `Segundo orden global (P-Δ) por el coeficiente de estabilidad global (el método de la amplificación del CE Anejo 19 H.2, el γz de la NBR 6118): en cada combinación, el factor de cada hipótesis horizontal (${casos}) va multiplicado por γz = 1 / (1 − Q), con Q = Σ γ_k·M_Pδ,k / M_H (M_H = Σ H·z el momento volcador de la hipótesis respecto al nivel sin desplazamientos horizontales y M_Pδ,k = Σ P·δ el de las cargas verticales del caso k en sus desplazamientos, nudo a nudo; los del sismo, por μ). Los desplazamientos del cálculo (secciones brutas) van multiplicados por ${coma(o.multiplicador, 1)} (${o.multiplicador === 1 ? "la rigidez bruta" : o.multiplicador === 2 ? "la rigidez al 50 % del Código Modelo CEB-FIP 1990" : o.multiplicador === 3 ? "la rigidez nominal del hormigón fisurado del CE Anejo 19 H.1.2(3)" : "el valor escrito"}). Con ello, los pilares se comprueban como intraslacionales (β = 1), con su segundo orden local en la comprobación. Un caso suelto o una combinación escrita a mano no se amplifican.`;
}
