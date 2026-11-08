/**
 * Las acciones del programa en el visor (VS4, `docs/fem3d/viento-sismo.md` §3.5): el viento y el sismo
 * de `acciones` no están en el fichero como casos ni como cargas, así que la app no los veía. Aquí:
 *
 * - los casos del programa, para los selectores, con su familia (`casosPrograma`);
 * - el modelo físico con sus cargas, para dibujarlas en la planta, el alzado y el 3D con lo que ya
 *   hay (`fisicoConPrograma`): las del viento, las que resuelve el compilador; las del sismo, que no
 *   es un caso estático, sus fuerzas equivalentes de planta (la combinación de las fuerzas de la
 *   planta en cada modo, como CYPECAD: VS3-d) en el centro de masas de cada planta, desplazadas ±e:
 *   dan el par de la excentricidad accidental de cada caso; juntas suman más que el cortante en la
 *   base, que es la combinación de sus sumas. Sólo con resultados;
 * - los datos de las fichas: el viento por plantas (`datosViento`, sin calcular), el espectro con su
 *   curva (`datosSismo`) y las masas y los modos (`datosModal`), con la forma de un modo para
 *   animarla como una deformada (`formaModo`).
 *
 * Puro: todo sale del modelo físico, de la compilación y de las consultas.
 */
import { modos as consultaModos, sismo as consultaSismo, type ModosAgente, type SismoAgente } from "../agente/consultas.ts";
import type { Consultas } from "../compilador/consultas.ts";
import type { CargaFisica, CasoFisico, ModeloFisico } from "../compilador/fisico.ts";
import { calcularSismo, CASOS_SISMO, casosSismo, tieneEspectro, type EspectroSismo } from "../compilador/sismo.ts";
import { calcularViento, resolverViento, type CalculoViento } from "../compilador/viento.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { coeficienteModal, espectroElastico } from "../normas/ncse02.ts";
import type { DatosDeformada } from "./datos.ts";

export type Programa = "viento" | "sismo";

export interface CasoVisor {
  id: string;
  nombre?: string;
  accion?: string;
  pesoPropio?: boolean;
  /** Un caso del programa (VS4): no está en el fichero. */
  programa?: Programa;
}

/** Los casos del modelo físico y, detrás, los del programa: los del viento y los del sismo (con espectro). */
export function casosPrograma(f: ModeloFisico): CasoVisor[] {
  const r: CasoVisor[] = f.casos.map((x) => ({ id: x.id, ...(x.nombre ? { nombre: x.nombre } : {}), ...(x.accion ? { accion: x.accion.tipo } : {}), ...(x.pesoPropio ? { pesoPropio: true } : {}) }));
  const propios = new Set(f.casos.map((c) => c.id));
  const caso = (c: CasoFisico, programa: Programa): CasoVisor => ({ id: c.id, ...(c.nombre ? { nombre: c.nombre } : {}), ...(c.accion ? { accion: c.accion.tipo } : {}), programa });
  for (const c of resolverViento(f).modelo.casos) if (!propios.has(c.id)) r.push(caso(c, "viento"));
  if (tieneEspectro(f)) for (const c of casosSismo()) r.push(caso(c, "sismo"));
  return r;
}

/** Id de la carga equivalente del sismo de un caso en una planta. */
export const idCargaSismo = (caso: string, planta: string): string => `${caso}@${planta}`;

/**
 * El modelo físico con los casos y las cargas del programa, para dibujarlos: las del viento, las del
 * compilador (`resolverViento`); las del sismo, sus fuerzas equivalentes de planta (sólo con las
 * consultas de un cálculo con espectro: `q`), en el centro de masas de la planta desplazado ±e (+e,
 * hacia +Y con el sismo según X y hacia +X según Y, como en el viento).
 */
export function fisicoConPrograma(f: ModeloFisico, q: Consultas | null): ModeloFisico {
  const m = resolverViento(f).modelo;
  const sc = q?.sismoCalculado;
  const md = q?.modal;
  if (!sc || !md || !sc.logicos.length) return m;
  const cargas: CargaFisica[] = [];
  for (const c of CASOS_SISMO) {
    const r = sc.respuestas[c.eje];
    md.diafragmas.forEach((df, k) => {
      const F = r.fuerzas[k]!;
      if (!F) return;
      const planta = q!.mapeo.restricciones[df.restriccion]!.planta;
      const e = c.exc * (sc.excentricidades[c.eje][k] ?? 0);
      const [x, y] = c.eje === 0 ? [df.cm[0], df.cm[1] + e] : [df.cm[0] + e, df.cm[1]];
      cargas.push({ tipo: "puntual", id: idCargaSismo(c.id, planta), caso: c.id, planta, x, y, F: c.eje === 0 ? [F, 0, 0] : [0, F, 0] });
    });
  }
  const { acciones: _a, ...sin } = m;
  void _a;
  return { ...sin, casos: [...m.casos, ...casosSismo()], cargas: [...(m.cargas ?? []), ...cargas] };
}

// ─── Las fichas ─────────────────────────────────────────────────────────────────────────────────

/** El viento del programa, para su ficha: lo que calcula el compilador del modelo físico de ahora (sin calcular). */
export type DatosViento = { definido: false } | ({ definido: true } & CalculoViento);

export function datosViento(f: ModeloFisico): DatosViento {
  const c = calcularViento(f);
  return c ? { definido: true, ...c } : { definido: false };
}

/** Periodo hasta el que se dibuja el espectro, s, y su paso. */
export const T_MAXIMO_ESPECTRO = 3;
const PASO_ESPECTRO = 0.01;

export interface CurvaEspectro {
  /** Periodos, s. */
  T: number[];
  /** α(T) del espectro elástico (art. 2.3), adimensional. */
  elastico: number[];
  /** αᵢ(T) del análisis por espectros según X y según Y (art. 3.6.2.2), con su β. */
  x: number[];
  y: number[];
}

export interface DatosSismo {
  /** Hay espectro en las acciones (con `ab` o `ine`): si no, sólo masas y modos o nada. */
  definido: boolean;
  /** El espectro del modelo físico de ahora, con sus errores y avisos (sin calcular). */
  espectro: EspectroSismo | null;
  problemas: Diagnostico[];
  curva: CurvaEspectro | null;
  /** Con resultados: la consulta `sismo` (cortantes, plantas, θ, el simplificado) o por qué no. */
  resultado: SismoAgente | null;
  motivo?: string;
  /** Los periodos de los modos, s, para marcarlos en la curva (con resultados). */
  periodos: number[];
}

/** La curva del espectro de un emplazamiento. */
export function curvaEspectro(e: EspectroSismo, mesetaLarga: [boolean, boolean] = [false, false]): CurvaEspectro {
  const { TA, TB } = e.emplazamiento;
  const n = Math.round(T_MAXIMO_ESPECTRO / PASO_ESPECTRO);
  const r: CurvaEspectro = { T: [], elastico: [], x: [], y: [] };
  for (let i = 0; i <= n; i++) {
    const T = i * PASO_ESPECTRO;
    r.T.push(T);
    r.elastico.push(espectroElastico(T, TA, TB));
    r.x.push(coeficienteModal(T, TA, TB, e.beta[0], mesetaLarga[0]));
    r.y.push(coeficienteModal(T, TA, TB, e.beta[1], mesetaLarga[1]));
  }
  return r;
}

export function datosSismo(f: ModeloFisico, q: Consultas | null): DatosSismo {
  const c = calcularSismo(f);
  const definido = tieneEspectro(f);
  const problemas: Diagnostico[] = [...(c?.errores ?? []).map((p): Diagnostico => ({ ...p, severidad: "error" })), ...(c?.avisos ?? []).map((p): Diagnostico => ({ ...p, severidad: "aviso" }))];
  const espectro = c?.espectro ?? null;
  let resultado: SismoAgente | null = null;
  let motivo: string | undefined;
  const periodos: number[] = [];
  if (q) {
    const s = consultaSismo(q, { todos: true });
    if (s.valido) {
      resultado = s.valor;
      problemas.push(...s.diagnosticos);
    } else motivo = s.diagnosticos.map((d) => d.mensaje).join(" ");
    for (const m of q.modal?.modos ?? []) periodos.push(m.periodo);
  }
  const mesetaLarga: [boolean, boolean] = resultado ? [!!resultado.direcciones[0]?.mesetaLarga, !!resultado.direcciones[1]?.mesetaLarga] : [false, false];
  return { definido, espectro, problemas, curva: espectro ? curvaEspectro(espectro, mesetaLarga) : null, resultado, ...(motivo ? { motivo } : {}), periodos };
}

export interface DatosModal {
  /** Hay sismo en las acciones (basta `{}`): si no, no hay masas ni modos. */
  definido: boolean;
  /** Con resultados: las masas por planta y todos los modos; si no, por qué. */
  modal: ModosAgente | null;
  motivo?: string;
}

export function datosModal(f: ModeloFisico, q: Consultas | null): DatosModal {
  const definido = f.acciones?.sismo !== undefined;
  if (!q) return { definido, modal: null, motivo: definido ? "Los modos salen con el cálculo." : "El proyecto no tiene el sismo en sus acciones." };
  const r = consultaModos(q, { todos: true });
  return r.valido ? { definido, modal: r.valor } : { definido, modal: null, motivo: r.diagnosticos.map((d) => d.mensaje).join(" ") };
}

/**
 * La forma de un modo (1, el de mayor periodo) como una deformada: ux, uy, uz de cada nudo con la
 * mayor traslación de los centros de masas igual a 1 m (la escala de la animación la pone la app).
 */
export function formaModo(q: Consultas, modo: number): DatosDeformada | null {
  const md = q.modal;
  const m = md?.modos[modo - 1];
  if (!md || !m) return null;
  let t = 0;
  for (let k = 0; k < md.diafragmas.length; k++) t = Math.max(t, Math.abs(m.forma[3 * k]!), Math.abs(m.forma[3 * k + 1]!));
  let u = 0;
  const n = m.u.length / 6;
  if (t <= 0) for (let i = 0; i < n; i++) u = Math.max(u, Math.abs(m.u[6 * i]!), Math.abs(m.u[6 * i + 1]!), Math.abs(m.u[6 * i + 2]!));
  const escala = t > 0 ? 1 / t : u > 0 ? 1 / u : 1;
  const r = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) r[3 * i + a] = m.u[6 * i + a]! * escala;
  const T = m.periodo;
  return { comb: `modo-${modo}`, etiqueta: `Modo ${modo} · T = ${T.toFixed(3).replace(".", ",")} s`, u: r, extremos: [] };
}
