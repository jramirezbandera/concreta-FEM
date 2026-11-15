/**
 * Fase IG (`docs/fem3d/imperfeccion.md`): la **imperfección geométrica global** del Código Estructural
 * (Anejo 19 §5.2, el EC2), que es obligatoria en los estados límite últimos de las situaciones
 * persistentes y accidentales (5.2(2)P) y que la excentricidad mínima de la comprobación de un pilar
 * no cubre (ésa es la del elemento aislado, 5.2(7)).
 *
 * **La inclinación** (5.2(5)): θ_i = θ₀·α_h·α_m, con
 * - θ₀ = 1/200;
 * - α_h = 2/√l, entre 2/3 y 1, con l la altura del edificio en m (5.2(6): para el efecto sobre el
 *   sistema de arriostramiento): de la base del tramo más bajo de pilares y muros a la cabeza del más
 *   alto;
 * - α_m = √(0,5·(1 + 1/m)), con m los elementos verticales que contribuyen: los pilares y muros de la
 *   planta que menos tiene (el mayor α_m, del lado seguro: IG-b).
 *
 * **Las cargas** (5.2(7) y (8)): la inclinación se sustituye por fuerzas horizontales
 * H_i = θ_i·(N_b − N_a) en cada nivel, que con las demás acciones entran en el análisis global. Aquí,
 * nudo a nudo: en cada nudo, θ·P con P la carga vertical que el caso pone en él (sus fuerzas nodales
 * equivalentes: lo que ese nudo añade a lo que baja). Es un caso **derivado** del motor
 * (`CasoDerivado`): no lleva cargas en el modelo físico.
 *
 * **Los casos:** de cada caso vertical (acción G, Q o S) salen dos casos del programa, `IMP-X(<caso>)`
 * e `IMP-Y(<caso>)`: nocionales (N) derivados de él, con su `inclinacion` y sin signo. El generador de
 * combinaciones los pone en ELU-PT y ELU-ACC con el factor de su caso de origen, en el sentido del
 * viento de la combinación o, sin viento, en una combinación por dirección y sentido (RES-17).
 * `resolverImperfeccion` los añade al final de `casos` (detrás de los del viento) y sólo añade los que
 * faltan, así que es idempotente; se aplica antes de validar, en el compilador y en `Consultas`, como
 * el viento, para que los casos del modelo físico casen con los resultados.
 *
 * Como hipótesis horizontales que son, el segundo orden global las amplifica con su γz
 * (`segundoOrden.ts`; el F_H,0Ed del CE A19 H.2 es el «del viento, las imperfecciones, etc.»).
 */
import { cotasPlantas } from "./cotas.ts";
import type { CasoFisico, ImperfeccionEdificio, ModeloFisico } from "./fisico.ts";

/** θ₀ del CE A19 §5.2(5). */
export const INCLINACION_BASE = 1 / 200;
/** Mayor inclinación que se admite escrita (rad): 1/20 ya es diez veces la de la norma. */
export const INCLINACION_MAXIMA = 0.05;

/** α_h = 2/√l, entre 2/3 y 1 (l en m). */
export const alfaAltura = (l: number): number => (l > 0 ? Math.min(1, Math.max(2 / 3, 2 / Math.sqrt(l))) : 1);
/** α_m = √(0,5·(1 + 1/m)). */
export const alfaElementos = (m: number): number => Math.sqrt(0.5 * (1 + 1 / Math.max(1, m)));

export interface ProblemaImperfeccion {
  codigo: string;
  mensaje: string;
  ids?: string[];
}

export interface CasoImperfeccion {
  id: string;
  /** El caso vertical del que deriva y su dirección. */
  de: string;
  direccion: "X" | "Y";
  /** θ, rad. */
  inclinacion: number;
  /** Lo añade el programa (no está escrito en el proyecto). */
  delPrograma: boolean;
}

export interface ImperfeccionCalculada {
  /** θ de los casos del programa, rad. */
  inclinacion: number;
  origen: "calculada" | "escrita";
  /** l, m: la altura del edificio; α_h. */
  altura: number;
  alfaH: number;
  /** m: pilares y muros de la planta que menos tiene, esa planta (la de sus cabezas) y α_m. */
  elementos: number;
  planta: string;
  alfaM: number;
  /** Los casos de la imperfección con `inclinacion`: los del programa y los escritos. */
  casos: CasoImperfeccion[];
}

export interface CalculoImperfeccion {
  /** null si no hay: desactivada, sin casos verticales, o sin pilares ni muros. */
  imperfeccion: ImperfeccionCalculada | null;
  /** Los casos que faltan en el modelo (los que añade `resolverImperfeccion`). */
  nuevos: CasoFisico[];
  errores: ProblemaImperfeccion[];
  avisos: ProblemaImperfeccion[];
}

/** El id del caso de la imperfección según `direccion` del caso `de`. */
export const idCasoImperfeccion = (direccion: "X" | "Y", de: string): string => `IMP-${direccion}(${de})`;

const VERTICALES = new Set(["G", "Q", "S"]);

/** Lo que no vale de `acciones.imperfeccion` (los campos desconocidos los rechaza el esquema). */
export function erroresImperfeccion(d: ImperfeccionEdificio | undefined): ProblemaImperfeccion[] {
  if (d === undefined) return [];
  if (typeof d !== "object" || d === null || Array.isArray(d)) return [{ codigo: "imperfeccion/no-valida", mensaje: "La imperfección de las acciones tiene que ser un objeto { aplicar, inclinacion }." }];
  if (d.aplicar !== undefined && typeof d.aplicar !== "boolean") return [{ codigo: "imperfeccion/no-valida", mensaje: `aplicar de la imperfección tiene que ser true o false (es ${JSON.stringify(d.aplicar)}).` }];
  const t = d.inclinacion;
  if (t !== undefined && !(typeof t === "number" && Number.isFinite(t) && t > 0 && t <= INCLINACION_MAXIMA))
    return [{ codigo: "imperfeccion/no-valida", mensaje: `La inclinación de la imperfección va en radianes y tiene que ser mayor que 0 y no mayor que ${String(INCLINACION_MAXIMA)} (es ${String(t)}): la del Código Estructural es 1/200 = 0,005 por α_h y α_m.` }];
  return [];
}

/** Pilares y muros de cada tramo entre plantas (el k va de la planta k a la k + 1), y la altura que cubren. */
function elementosVerticales(m: ModeloFisico): { elementos: number; planta: string; altura: number } | null {
  const indice = new Map(m.plantas.map((p, k) => [p.id, k]));
  const n = m.plantas.length;
  const cuenta = new Array<number>(Math.max(0, n - 1)).fill(0);
  for (const p of [...(m.pilares ?? []), ...(m.muros ?? [])]) {
    const [kc, kb] = [indice.get(p.hasta), indice.get(p.desde)];
    if (kc === undefined || kb === undefined) continue;
    for (let k = Math.max(0, kc); k < Math.min(n - 1, kb); k++) cuenta[k]!++;
  }
  let mejor = -1;
  let [arriba, abajo] = [-1, -1];
  cuenta.forEach((c, k) => {
    if (c <= 0) return;
    if (mejor < 0 || c < cuenta[mejor]!) mejor = k;
    if (arriba < 0) arriba = k;
    abajo = k + 1;
  });
  if (mejor < 0) return null;
  const cotas = cotasPlantas(m.plantas);
  const [za, zb] = [cotas[arriba], cotas[abajo]];
  // Sin las alturas (un error de `validar`), α_h = 1: lo más desfavorable
  const altura = typeof za === "number" && typeof zb === "number" && Number.isFinite(za - zb) ? za - zb : 0;
  return { elementos: cuenta[mejor]!, planta: m.plantas[mejor]!.id, altura };
}

/**
 * La imperfección global del modelo: su θ, los casos que la llevan y los que faltan por añadir. Con
 * el modelo ya resuelto, los mismos casos y ninguno nuevo.
 */
export function calcularImperfeccion(m: ModeloFisico): CalculoImperfeccion {
  const d = m.acciones?.imperfeccion;
  const errores = erroresImperfeccion(d);
  const avisos: ProblemaImperfeccion[] = [];
  const nada: CalculoImperfeccion = { imperfeccion: null, nuevos: [], errores, avisos };
  if (errores.length || !Array.isArray(m.casos) || !Array.isArray(m.plantas)) return nada;
  // Los casos con `inclinacion` ya escritos (o ya resueltos)
  const escritos: CasoImperfeccion[] = [];
  for (const c of m.casos) {
    const a = c.accion;
    if (a?.tipo === "N" && typeof a.inclinacion === "number" && (a.direccion === "X" || a.direccion === "Y") && typeof a.derivadoDe === "string")
      escritos.push({ id: c.id, de: a.derivadoDe, direccion: a.direccion, inclinacion: a.inclinacion, delPrograma: c.id === idCasoImperfeccion(a.direccion, a.derivadoDe) });
  }
  const v = elementosVerticales(m);
  const verticales = m.casos.filter((c) => c.accion && VERTICALES.has(c.accion.tipo));
  if (!v || (!escritos.length && (d?.aplicar === false || !verticales.length))) return nada;
  const alfaH = alfaAltura(v.altura);
  const alfaM = alfaElementos(v.elementos);
  const inclinacion = d?.inclinacion ?? INCLINACION_BASE * alfaH * alfaM;
  const nuevos: CasoFisico[] = [];
  const casos = [...escritos];
  if (d?.aplicar !== false) {
    const ids = new Set(m.casos.map((c) => c.id));
    const choque: string[] = [];
    for (const c of verticales)
      for (const direccion of ["X", "Y"] as const) {
        if (escritos.some((e) => e.de === c.id && e.direccion === direccion)) continue;
        const id = idCasoImperfeccion(direccion, c.id);
        if (ids.has(id)) {
          choque.push(id);
          continue;
        }
        nuevos.push({ id, nombre: `Imperfección global según ${direccion}, de ${c.id}`, accion: { tipo: "N", direccion, derivadoDe: c.id, inclinacion } });
        casos.push({ id, de: c.id, direccion, inclinacion, delPrograma: true });
      }
    if (choque.length) {
      errores.push({ codigo: "imperfeccion/id-existente", mensaje: `Los ids ${choque.join(", ")} son los de los casos de la imperfección global del programa: hay que renombrar los casos que los usan.`, ids: choque });
      return { imperfeccion: null, nuevos: [], errores, avisos };
    }
    // Una nocional con sus cargas escritas, además de la del programa: ¿dos veces?
    const aMano = m.casos.filter((c) => c.accion?.tipo === "N" && c.accion.inclinacion === undefined).map((c) => c.id);
    if (aMano.length && nuevos.length)
      avisos.push({
        codigo: "imperfeccion/nocional-a-mano",
        mensaje: `${aMano.length === 1 ? `El caso ${aMano[0]} es una carga nocional escrita` : `Los casos ${aMano.join(", ")} son cargas nocionales escritas`} a mano, y el programa añade además la imperfección geométrica global (${nuevos.map((c) => c.id).join(", ")}). Si esas cargas ya son la imperfección, va dos veces: quite los casos o ponga acciones.imperfeccion.aplicar en false.`,
        ids: aMano,
      });
  }
  if (!casos.length) return nada;
  return { imperfeccion: { inclinacion, origen: d?.inclinacion !== undefined ? "escrita" : "calculada", altura: v.altura, alfaH, elementos: v.elementos, planta: v.planta, alfaM, casos }, nuevos, errores, avisos };
}

/**
 * El modelo con los casos de la imperfección global al final de `casos`. Si no se puede (un error),
 * el modelo tal cual: `validar` da sus errores con `calcularImperfeccion`.
 */
export function resolverImperfeccion(m: ModeloFisico): { modelo: ModeloFisico; calculo: CalculoImperfeccion } {
  const calculo = calcularImperfeccion(m);
  if (calculo.errores.length || !calculo.nuevos.length) return { modelo: m, calculo };
  return { modelo: { ...m, casos: [...m.casos, ...calculo.nuevos] }, calculo };
}

/** ¿Es el caso uno de la imperfección global (una nocional con su inclinación: sin cargas en el modelo)? */
export const esCasoImperfeccion = (c: CasoFisico): boolean => c.accion?.tipo === "N" && c.accion.inclinacion !== undefined;

const coma = (v: number, d = 2) => v.toFixed(d).replace(".", ",");

/** θ como fracción: «1/402». */
export const fraccionInclinacion = (t: number): string => `1/${String(Math.round(1 / t))}`;

/** La hipótesis del cálculo con lo que hace la imperfección global. */
export function hipotesisImperfeccion(i: ImperfeccionCalculada): string {
  const programa = i.casos.filter((c) => c.delPrograma);
  const otros = i.casos.filter((c) => !c.delPrograma);
  const theta =
    i.origen === "escrita"
      ? `θ = ${fraccionInclinacion(i.inclinacion)} (${coma(i.inclinacion * 1000, 3)} mm/m), escrita en acciones.imperfeccion`
      : `θ = θ₀·α_h·α_m = ${fraccionInclinacion(i.inclinacion)} (${coma(i.inclinacion * 1000, 3)} mm/m), con θ₀ = 1/200, α_h = ${coma(i.alfaH, 3)} (2/√l entre 2/3 y 1, con l = ${coma(i.altura)} m la altura del edificio) y α_m = ${coma(i.alfaM, 3)} (√(0,5·(1 + 1/m)), con m = ${String(i.elementos)} los pilares y muros de la planta que menos tiene, bajo ${i.planta})`;
  return (
    `Imperfección geométrica global del Código Estructural (Anejo 19 §5.2): una inclinación de toda la estructura, ${theta}. ` +
    `Va como fuerzas horizontales: de cada caso vertical, en cada nudo, θ·P con P la carga vertical que el caso pone en él (H = θ·(N_b − N_a) en cada nivel)` +
    (programa.length ? `, en los casos del programa ${programa.map((c) => c.id).join(", ")}` : "") +
    (otros.length ? `${programa.length ? " y" : ","} en los escritos ${otros.map((c) => `${c.id} (${fraccionInclinacion(c.inclinacion)})`).join(", ")}` : "") +
    `. Entran en las combinaciones de ELU de las situaciones persistentes y accidentales con el factor de su caso de origen: en la dirección y el sentido del viento de la combinación o, sin viento, en una combinación por dirección y sentido (±X, ±Y); no entran en la situación sísmica ni en servicio. ` +
    `No sustituye a la excentricidad mínima ni a la imperfección del pilar aislado, que son de su comprobación.`
  );
}
