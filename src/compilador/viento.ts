/**
 * El viento del edificio desde su situación (fase VS1, `docs/fem3d/viento-sismo.md` §3.1): de
 * `acciones.viento` salen 8 casos del programa (familia `viento`) con una puntual horizontal por
 * planta y caso. `resolverViento` los añade al final de `casos` y de `cargas` y quita
 * `acciones.viento`, así que es idempotente; se aplica antes de validar, en el compilador, y en
 * `Consultas`, para que los casos del modelo físico casen con los resultados.
 *
 * **La fuerza de una planta** en la dirección del viento es F = (cp − cs) · qb · ce(z) · A:
 * - z, la cota de la planta sobre la rasante; ce, la fórmula D.2 a esa altura;
 * - cp y cs, de la tabla 3.5 por la esbeltez del edificio en esa dirección (su planta más alta
 *   sobre la rasante entre su fondo, paralelo al viento);
 * - A, el área de fachada de su banda. En cada punto del ancho (la coordenada perpendicular al
 *   viento), las plantas que hay en él (las que lo cubren con la proyección de sus losas y paños, o
 *   de sus vigas si no tiene ni lo uno ni lo otro) se reparten la altura con la regla de
 *   `alturasTributarias`: media planta por debajo y media por encima, la banda entre la rasante y la
 *   mitad de la primera planta a la cimentación y nada por encima de la última. A es la integral de
 *   esa altura en el ancho. Con todas las plantas del mismo ancho b, A = h_trib · b: el
 *   `calcularViento` de Concreta. Con una cubierta más baja junto a otra más alta (la planta
 *   `escalon` de la vivienda, VS-n), cada una lleva su banda.
 *
 * **Dónde se aplica (VS-c):** en el centro de su banda (el centroide de esa altura en el ancho),
 * desplazado ±e, con e el 5 % del ancho máximo del edificio (art. 3.3.2-2). Es una puntual sólo
 * horizontal sobre la recta de acción, en la losa de la planta que la recta atraviesa (SP-5 la lleva
 * al diafragma, exacta); si no atraviesa ninguna, en el punto de una losa más cercano a la recta, con
 * su momento de transporte (también SP-5); y en una planta sin losas, en un pilar con nudo en ella
 * (en el borde de un paño, si los tiene), con su momento. VS1 exige el diafragma rígido en las
 * plantas que reciben viento.
 *
 * Convenio de direcciones, como en Concreta: «según X» es el viento que sopla paralelo al eje X; su
 * fachada es la que se ve desde X (el ancho, en Y). `W+X` empuja hacia +X; `+e` desplaza la recta
 * hacia +Y (según X) o hacia +X (según Y).
 */
import { cotasPlantas } from "./cotas.ts";
import type { AccionCaso, CargaFisica, CasoFisico, ModeloFisico, Seccion, Vec2, VientoEdificio } from "./fisico.ts";
import { momentosRegion, puntoEnRegion, trozosSegmento, type Region } from "./poligonos.ts";
import { distanciaARegion } from "./topologia.ts";
import { medidasSeccion } from "./puntoFijo.ts";
import {
  ALTITUD_MAX_VIENTO,
  ASPEREZAS,
  alturasTributarias,
  coeficienteExposicion,
  coeficientesEolicos,
  ESBELTEZ_MAX,
  EXCENTRICIDAD_VIENTO,
  QB_SIMPLIFICADO,
  Z_MAX_ANEJO_D,
  ZONAS_EOLICAS,
  type GradoAspereza,
  type ZonaEolica,
} from "../normas/cteViento.ts";

/** Por debajo de esto, dos coordenadas son la misma (m). */
const EPS = 1e-9;

export interface ProblemaViento {
  codigo: string;
  mensaje: string;
  ids?: string[];
}

export interface PlantaViento {
  planta: string;
  /** Cota sobre la rasante, m. */
  z: number;
  ce: number;
  /** qb · ce, kN/m². */
  qe: number;
  /** Área de la fachada de su banda, m². */
  area: number;
  /** El área viene de `fachadas`, no del modelo. */
  dada: boolean;
  /** Centro de su banda en el ancho (Y según X, X según Y), m: la recta de acción sin la excentricidad. */
  centro: number;
  /** Fuerza, kN (≥ 0): la de W+…; la de W−… es la misma con el otro signo. */
  F: number;
}

export interface DireccionViento {
  eje: "X" | "Y";
  /** Fondo del edificio, paralelo al viento, m. */
  profundidad: number;
  /** Ancho máximo del edificio, perpendicular al viento, m. */
  ancho: number;
  esbeltez: number;
  cp: number;
  cs: number;
  /** Excentricidad, m: el 5 % del ancho. */
  e: number;
  /** De la más baja a la más alta. */
  plantas: PlantaViento[];
  /** Σ F, kN. */
  F: number;
}

export interface VientoCalculado {
  zona: ZonaEolica;
  qb: number;
  qbOrigen: "zona" | "simplificado" | "dada";
  aspereza: GradoAspereza;
  rasante: number;
  /** Cota sobre la rasante de la planta más alta con viento, m. */
  altura: number;
  x: DireccionViento;
  y: DireccionViento;
  /** Los casos que genera, en su orden. */
  casos: string[];
}

export interface CalculoViento {
  viento: VientoCalculado | null;
  errores: ProblemaViento[];
  avisos: ProblemaViento[];
}

/** Los 8 casos del programa, en su orden: según X y según Y, cada sentido con +e y −e. */
export const CASOS_VIENTO: readonly { id: string; eje: 0 | 1; signo: 1 | -1; exc: 1 | -1 }[] = (["X", "Y"] as const).flatMap((d, eje) =>
  ([1, -1] as const).flatMap((signo) =>
    ([1, -1] as const).map((exc) => ({ id: `W${signo > 0 ? "+" : "-"}${d}${exc > 0 ? "+e" : "-e"}`, eje: eje as 0 | 1, signo, exc })),
  ),
);

/** Id de la carga de un caso del viento en una planta. */
export const idCargaViento = (caso: string, planta: string): string => `${caso}@${planta}`;

const coma = (x: number, d = 2): string => {
  const t = Number(x.toFixed(d));
  return String(t === 0 ? 0 : t).replace(".", ",").replace("-", "−");
};

type Intervalo = [number, number];

/** Une los intervalos que se solapan o se tocan. */
function unir(iv: Intervalo[]): Intervalo[] {
  const s = iv.filter(([a, b]) => b - a >= 0).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const r: Intervalo[] = [];
  for (const [a, b] of s) {
    const u = r[r.length - 1];
    if (u && a <= u[1] + EPS) u[1] = Math.max(u[1], b);
    else r.push([a, b]);
  }
  return r;
}

const cubre = (iv: readonly Intervalo[], s: number): boolean => iv.some(([a, b]) => s >= a - EPS && s <= b + EPS);

/**
 * Lo que una planta ocupa en planta: sus losas y paños (y sus vigas, si no tiene ni lo uno ni lo
 * otro) como intervalos en X y en Y (sin unir). Las vigas que salen de una losa (una pérgola) no son
 * fachada. Los pilares y los muros no cuentan: un pilar que atraviesa la cota de una planta sin losa
 * alrededor (el de una cubierta más alta junto a otra más baja) no es de ella, y su nudo no está en
 * su diafragma (C2-f).
 */
function huellaPlanta(m: ModeloFisico, k: number, secciones: ReadonlyMap<string, Seccion>): [Intervalo[], Intervalo[]] {
  const id = m.plantas[k]!.id;
  const res: [Intervalo[], Intervalo[]] = [[], []];
  const puntos = (ps: readonly Vec2[]) => {
    if (!ps.length) return;
    for (const eje of [0, 1] as const) {
      let a = Infinity;
      let b = -Infinity;
      for (const p of ps) [a, b] = [Math.min(a, p[eje]), Math.max(b, p[eje])];
      res[eje].push([a, b]);
    }
  };
  // Una polilínea con su ancho: cada tramo, con el medio ancho según su normal
  const banda = (ps: readonly Vec2[], ancho: number) => {
    for (let i = 0; i + 1 < ps.length; i++) {
      const [A, B] = [ps[i]!, ps[i + 1]!];
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const n: Vec2 = L > 0 ? [-(B[1] - A[1]) / L, (B[0] - A[0]) / L] : [0, 0];
      for (const eje of [0, 1] as const) {
        const d = (ancho / 2) * Math.abs(n[eje]);
        res[eje].push([Math.min(A[eje], B[eje]) - d, Math.max(A[eje], B[eje]) + d]);
      }
    }
    if (ps.length === 1) puntos(ps);
  };
  for (const l of m.losas ?? []) if (l.planta === id) puntos(l.contorno);
  for (const p of m.panos ?? []) if (p.planta === id) puntos(p.contorno);
  // Las vigas, sólo sin losas ni paños: con ellos, las que salen son una pérgola o un voladizo, abiertos
  if (!res[0].length) for (const v of m.vigas ?? []) if (v.planta === id) banda(v.puntos, medidasSeccion(secciones.get(v.seccion))?.b ?? 0);
  return res;
}

/** El viento del modelo: sus fuerzas por planta, o por qué no se puede calcular. Sin `acciones.viento`, null. */
export function calcularViento(m: ModeloFisico): CalculoViento | null {
  // Un modelo que no es un objeto lo rechaza `validar`
  if (typeof m !== "object" || m === null || !Array.isArray(m.plantas) || !Array.isArray(m.casos)) return null;
  const v: VientoEdificio | undefined = m.acciones?.viento;
  if (!v) return null;
  const errores: ProblemaViento[] = [];
  const avisos: ProblemaViento[] = [];
  const err = (codigo: string, mensaje: string, ids?: string[]) => errores.push({ codigo, mensaje, ...(ids ? { ids } : {}) });
  const fallo = (): CalculoViento => ({ viento: null, errores, avisos });

  if (typeof v !== "object" || (v.fachadas !== undefined && !(Array.isArray(v.fachadas) && v.fachadas.every((f) => typeof f === "object" && f !== null && typeof f.planta === "string")))) {
    err("viento/no-valido", "El viento de las acciones tiene que ser un objeto con su zona y su aspereza, y sus fachadas, una lista de { planta, x, y }.");
    return fallo();
  }
  if (typeof v.zona !== "string" || !(v.zona in ZONAS_EOLICAS)) err("viento/zona", "La zona eólica del viento tiene que ser A, B o C (figura D.1 del DB SE-AE).");
  if (typeof v.aspereza !== "string" || !(v.aspereza in ASPEREZAS)) err("viento/aspereza", "El grado de aspereza del viento tiene que ser I, II, III, IV o V (tabla 3.4 del DB SE-AE).");
  if (v.qb !== undefined && !(Number.isFinite(v.qb) && v.qb > 0)) err("viento/qb", "La presión dinámica del viento tiene que ser un número mayor que cero, en kN/m².");
  if (v.altitud !== undefined && !Number.isFinite(v.altitud)) err("viento/altitud", "La altitud del emplazamiento tiene que ser un número, en m.");
  else if (v.altitud !== undefined && v.altitud > ALTITUD_MAX_VIENTO)
    err("viento/altitud", `El DB SE-AE no es aplicable por encima de ${ALTITUD_MAX_VIENTO} m de altitud (art. 3.3.1-2): las presiones del viento se establecen con datos empíricos.`);
  if (v.rasante !== undefined && !Number.isFinite(v.rasante)) err("viento/rasante", "La cota de la rasante tiene que ser un número, en m.");
  const indice = new Map(m.plantas.map((p, k) => [p.id, k]));
  const dadas = new Map<string, { x?: number; y?: number }>();
  for (const f of v.fachadas ?? []) {
    if (!indice.has(f.planta)) err("viento/fachada", `La fachada del viento de la planta ${f.planta}: esa planta no existe.`, [f.planta]);
    else if (dadas.has(f.planta)) err("viento/fachada", `La planta ${f.planta} tiene dos fachadas del viento escritas.`, [f.planta]);
    for (const x of [f.x, f.y]) if (x !== undefined && !(Number.isFinite(x) && x >= 0)) err("viento/fachada", `La fachada del viento de la planta ${f.planta} tiene que ser un área ≥ 0, en m².`, [f.planta]);
    dadas.set(f.planta, f);
  }
  // Los casos y las cargas que genera no pueden estar ya en el modelo
  const reservados = new Set(CASOS_VIENTO.map((c) => c.id));
  const repetidos = m.casos.filter((c) => reservados.has(c.id)).map((c) => c.id);
  if (repetidos.length) err("viento/caso-existente", `Los casos ${repetidos.join(", ")} son los del viento del programa: hay que renombrarlos o quitar el viento de las acciones.`, repetidos);
  const enReservados = (m.cargas ?? []).filter((c) => reservados.has(c.caso)).map((c) => c.id);
  if (enReservados.length) err("viento/carga-en-caso-del-programa", `Las cargas ${enReservados.join(", ")} van en un caso del viento del programa, que no se escribe: sus cargas las pone el programa.`, enReservados);
  const aMano = m.casos.filter((c) => c.accion?.tipo === "W").map((c) => c.id);
  if (aMano.length)
    avisos.push({ codigo: "viento/casos-a-mano", mensaje: `Además del viento del programa hay casos de viento escritos (${aMano.join(", ")}): los dos van en las combinaciones.`, ids: aMano });

  const cotas = cotasPlantas(m.plantas);
  const rasante = v.rasante ?? 0;
  if (errores.length) return fallo();

  // Las plantas sobre la rasante, de la más baja a la más alta
  const secciones = new Map(m.secciones.map((s) => [s.id, s]));
  const sobre: { k: number; z: number; huella: [Intervalo[], Intervalo[]] }[] = [];
  for (let k = m.plantas.length - 1; k >= 0; k--) {
    const c = cotas[k];
    if (c === null || c === undefined) {
      err("viento/cota", `Falta la altura de alguna planta, así que no se sabe la cota de ${m.plantas[k]!.id} para el viento.`, [m.plantas[k]!.id]);
      continue;
    }
    const z = c - rasante;
    if (z <= EPS) continue;
    const h = huellaPlanta(m, k, secciones);
    sobre.push({ k, z, huella: [unir(h[0]), unir(h[1])] });
  }
  if (errores.length) return fallo();
  sobre.sort((a, b) => a.z - b.z || b.k - a.k);
  if (!sobre.length) {
    err("viento/sin-plantas", `Ninguna planta está por encima de la rasante (cota ${coma(rasante)} m): el viento no tiene dónde actuar.`);
    return fallo();
  }

  const zona = v.zona;
  const qb = v.qb ?? ZONAS_EOLICAS[zona].qb;
  const qbOrigen = v.qb === undefined ? "zona" : v.qb === QB_SIMPLIFICADO ? "simplificado" : "dada";
  const conGeometria = sobre.filter((p) => p.huella[0].length > 0);
  const extension = (eje: 0 | 1): Intervalo => {
    let [a, b] = [Infinity, -Infinity];
    for (const p of conGeometria) for (const [x, y] of p.huella[eje]) [a, b] = [Math.min(a, x), Math.max(b, y)];
    return conGeometria.length ? [a, b] : [0, 0];
  };
  const altura = Math.max(...sobre.filter((p) => p.huella[0].length > 0 || dadas.has(m.plantas[p.k]!.id)).map((p) => p.z), 0);
  if (altura > Z_MAX_ANEJO_D) avisos.push({ codigo: "viento/altura", mensaje: `La fórmula del Anejo D.2 está dada para alturas de hasta ${Z_MAX_ANEJO_D} m; el edificio tiene ${coma(altura)} m sobre la rasante.` });

  const direccion = (a: 0 | 1): DireccionViento => {
    const t = (1 - a) as 0 | 1;
    const [f0, f1] = extension(a);
    const [s0, s1] = extension(t);
    const profundidad = f1 - f0;
    const ancho = s1 - s0;
    const esbeltez = profundidad > 0 ? altura / profundidad : 0;
    const { cp, cs } = coeficientesEolicos(esbeltez);
    // La banda de cada planta, segmento a segmento del ancho
    const area = new Map<number, number>();
    const momento = new Map<number, number>();
    const cortes = [...new Set(sobre.flatMap((p) => p.huella[t].flat()))].sort((x, y) => x - y);
    for (let i = 0; i + 1 < cortes.length; i++) {
      const [x0, x1] = [cortes[i]!, cortes[i + 1]!];
      if (x1 - x0 <= EPS) continue;
      const xm = (x0 + x1) / 2;
      const pila = sobre.filter((p) => cubre(p.huella[t], xm));
      for (let j = 1; j < pila.length; j++) {
        const [i0, i1] = [m.plantas[pila[j - 1]!.k]!.id, m.plantas[pila[j]!.k]!.id];
        if (pila[j]!.z - pila[j - 1]!.z <= EPS && !errores.some((e) => e.codigo === "viento/plantas-misma-cota" && e.ids?.[0] === i0 && e.ids[1] === i1))
          err("viento/plantas-misma-cota", `Las plantas ${i0} y ${i1} están a la misma cota y una encima de la otra: la banda del viento no se puede repartir.`, [i0, i1]);
      }
      const h = alturasTributarias(pila.map((p) => p.z));
      pila.forEach((p, j) => {
        const dA = h[j]! * (x1 - x0);
        area.set(p.k, (area.get(p.k) ?? 0) + dA);
        momento.set(p.k, (momento.get(p.k) ?? 0) + dA * xm);
      });
    }
    const plantas: PlantaViento[] = [];
    for (const p of sobre) {
      const id = m.plantas[p.k]!.id;
      const dada = dadas.get(id)?.[a === 0 ? "x" : "y"];
      const A = dada ?? area.get(p.k) ?? 0;
      if (!(A > 0)) continue;
      const Am = area.get(p.k) ?? 0;
      const centro = Am > 0 ? momento.get(p.k)! / Am : (s0 + s1) / 2;
      const ce = coeficienteExposicion(p.z, v.aspereza);
      const qe = qb * ce;
      plantas.push({ planta: id, z: p.z, ce, qe, area: A, dada: dada !== undefined, centro, F: (cp - cs) * qe * A });
    }
    if (esbeltez > ESBELTEZ_MAX)
      err("viento/esbeltez", `Esbeltez ${coma(esbeltez)} según ${a === 0 ? "X" : "Y"}: el DB SE-AE no cubre esbelteces mayores de ${ESBELTEZ_MAX} (art. 3.3.1-3); hay que considerar los efectos dinámicos.`);
    return { eje: a === 0 ? "X" : "Y", profundidad, ancho, esbeltez, cp, cs, e: EXCENTRICIDAD_VIENTO * ancho, plantas, F: plantas.reduce((s, x) => s + x.F, 0) };
  };
  const x = direccion(0);
  const y = direccion(1);
  if (!x.plantas.length && !y.plantas.length) err("viento/sin-fachada", "Ninguna planta sobre la rasante tiene losas, paños, vigas, pilares ni muros: el viento no tiene fachada.");
  // VS1: las plantas con viento, con el diafragma rígido
  const ultima = m.plantas.length - 1;
  const sinDiafragma = [...new Set([...x.plantas, ...y.plantas].map((p) => p.planta))].filter((id) => {
    const k = indice.get(id)!;
    return (m.plantas[k]!.diafragma ?? (k === ultima ? "ninguno" : "rigido")) !== "rigido";
  });
  if (sinDiafragma.length)
    err("viento/planta-sin-diafragma", `Las plantas ${sinDiafragma.join(", ")} reciben viento y no tienen el diafragma rígido: el viento del programa todavía no se reparte por los bordes de un forjado sin diafragma.`, sinDiafragma);
  if (errores.length) return fallo();
  return { viento: { zona, qb, qbOrigen, aspereza: v.aspereza, rasante, altura, x, y, casos: CASOS_VIENTO.map((c) => c.id) }, errores, avisos };
}

/** Dónde va la puntual de una planta: un punto de la recta de acción en una losa o, si no, un punto con su momento. */
function puntoDeAplicacion(m: ModeloFisico, k: number, eje: 0 | 1, recta: number, extension: Intervalo): { P: Vec2; conMomento: boolean } | null {
  const id = m.plantas[k]!.id;
  const t = (1 - eje) as 0 | 1;
  const regiones: Region[] = (m.losas ?? []).filter((l) => l.planta === id).map((l) => ({ contorno: l.contorno, huecos: l.huecos ?? [] }));
  const punto = (u: number, w = recta): Vec2 => (eje === 0 ? [u, w] : [w, u]);
  const dentro = (q: Vec2) => regiones.some((r) => puntoEnRegion(q, r));
  const poligonos = regiones.flatMap((r) => [r.contorno, ...r.huecos]);
  /** El trozo más largo de la recta w dentro de las losas (a igual largo, el de menor coordenada). */
  const trozo = (w: number): [number, number] | null => {
    let mejor: [number, number] | null = null;
    for (const [A, B] of trozosSegmento(punto(extension[0] - 1, w), punto(extension[1] + 1, w), poligonos, dentro)) {
      const [u0, u1] = [Math.min(A[eje], B[eje]), Math.max(A[eje], B[eje])];
      if (!mejor || u1 - u0 > mejor[1] - mejor[0] + EPS || (Math.abs(u1 - u0 - (mejor[1] - mejor[0])) <= EPS && u0 < mejor[0])) mejor = [u0, u1];
    }
    return mejor;
  };
  if (regiones.length) {
    const enRecta = trozo(recta);
    if (enRecta) return { P: punto((enRecta[0] + enRecta[1]) / 2), conMomento: false };
    // La recta no pisa ninguna losa (una planta en U con la recta por el patio): el punto de una losa
    // más cercano a ella, en la recta paralela por el centroide de esa losa
    let mejor: { P: Vec2; d: number } | null = null;
    for (const r of regiones) {
      const mr = momentosRegion(r);
      if (!(mr.A > 0)) continue;
      const w = (t === 0 ? mr.Sx : mr.Sy) / mr.A;
      const tr = trozo(w);
      if (!tr) continue;
      const P = punto((tr[0] + tr[1]) / 2, w);
      const d = Math.abs(w - recta);
      if (!mejor || d < mejor.d - EPS || (Math.abs(d - mejor.d) <= EPS && P[eje] < mejor.P[eje])) mejor = { P, d };
    }
    if (mejor) return { P: mejor.P, conMomento: true };
    return null;
  }
  // Sin losas: un pilar con nudo en la planta (con paños, en el borde de uno: su nudo va en el
  // diafragma, C4-g), el más cercano a la recta
  const indice = new Map(m.plantas.map((p, i) => [p.id, i]));
  const panos: Region[] = (m.panos ?? []).filter((p) => p.planta === id).map((p) => ({ contorno: p.contorno, huecos: p.huecos ?? [] }));
  const centro = (extension[0] + extension[1]) / 2;
  let elegido: { P: Vec2; d: number; u: number; id: string } | null = null;
  for (const p of m.pilares ?? []) {
    const [kc, kb] = [indice.get(p.hasta), indice.get(p.desde)];
    if (kc === undefined || kb === undefined || !(kc <= k && k <= kb)) continue;
    const P: Vec2 = [p.x, p.y];
    if (panos.length && !panos.some((r) => distanciaARegion(P, r) <= 1e-6)) continue;
    const d = Math.abs(P[t] - recta);
    const u = Math.abs(P[eje] - centro);
    if (!elegido || d < elegido.d - EPS || (Math.abs(d - elegido.d) <= EPS && (u < elegido.u - EPS || (Math.abs(u - elegido.u) <= EPS && p.id < elegido.id)))) elegido = { P, d, u, id: p.id };
  }
  return elegido ? { P: elegido.P, conMomento: true } : null;
}

/**
 * El modelo con los casos y las cargas del viento, sin `acciones.viento`. Si el viento no se puede
 * calcular, el modelo tal cual (con `acciones.viento`: `validar` da sus errores con `calcularViento`).
 */
export function resolverViento(m: ModeloFisico): { modelo: ModeloFisico; calculo: CalculoViento | null } {
  const calculo = calcularViento(m);
  if (!calculo) return { modelo: m, calculo: null };
  const v = calculo.viento;
  if (!v) return { modelo: m, calculo };
  const indice = new Map(m.plantas.map((p, k) => [p.id, k]));
  const casos: CasoFisico[] = [];
  const cargas: CargaFisica[] = [];
  const sinPunto: string[] = [];
  for (const c of CASOS_VIENTO) {
    const d = c.eje === 0 ? v.x : v.y;
    const accion: AccionCaso = { tipo: "W", direccion: d.eje, signo: c.signo, familia: "viento", psi: "viento" };
    casos.push({ id: c.id, nombre: `Viento ${c.signo > 0 ? "+" : "−"}${d.eje}, excentricidad ${c.exc > 0 ? "+" : "−"}`, accion });
    // La extensión del edificio paralela al viento, para buscar el punto en la recta
    const ext: Intervalo = [Infinity, -Infinity];
    for (const l of m.losas ?? []) for (const p of l.contorno) [ext[0], ext[1]] = [Math.min(ext[0], p[c.eje]), Math.max(ext[1], p[c.eje])];
    for (const p of m.pilares ?? []) [ext[0], ext[1]] = [Math.min(ext[0], p[c.eje === 0 ? "x" : "y"]), Math.max(ext[1], p[c.eje === 0 ? "x" : "y"])];
    if (!(ext[1] >= ext[0])) [ext[0], ext[1]] = [0, 0];
    for (const p of d.plantas) {
      const k = indice.get(p.planta)!;
      const recta = p.centro + c.exc * d.e;
      const r = puntoDeAplicacion(m, k, c.eje, recta, ext);
      if (!r) {
        sinPunto.push(p.planta);
        continue;
      }
      const F = c.signo * p.F;
      const Fv: [number, number, number] = c.eje === 0 ? [F, 0, 0] : [0, F, 0];
      // Del punto a la recta de acción: Mz = −(y_r − P_y)·Fx según X, (x_r − P_x)·Fy según Y
      const Mz = !r.conMomento ? 0 : c.eje === 0 ? -(recta - r.P[1]) * F : (recta - r.P[0]) * F;
      cargas.push({ tipo: "puntual", id: idCargaViento(c.id, p.planta), caso: c.id, planta: p.planta, x: r.P[0], y: r.P[1], F: Fv, ...(Mz !== 0 ? { M: [0, 0, Mz] } : {}) });
    }
  }
  if (sinPunto.length) {
    const ids = [...new Set(sinPunto)];
    return {
      modelo: m,
      calculo: {
        viento: null,
        errores: [{ codigo: "viento/sin-punto", mensaje: `Las plantas ${ids.join(", ")} reciben viento y no tienen ni una losa ni un pilar donde ponerlo.`, ids }],
        avisos: calculo.avisos,
      },
    };
  }
  const usados = new Set([...m.casos.map((c) => c.id), ...(m.cargas ?? []).map((c) => c.id)]);
  const choque = cargas.filter((c) => usados.has(c.id)).map((c) => c.id);
  if (choque.length)
    return { modelo: m, calculo: { viento: null, errores: [{ codigo: "viento/id-existente", mensaje: `Los ids ${choque.join(", ")} son los de las cargas del viento del programa: hay que renombrar lo que los usa.`, ids: choque }], avisos: calculo.avisos } };
  const { viento: _v, ...resto } = m.acciones!;
  void _v;
  const { acciones: _a, ...sin } = m;
  void _a;
  return {
    modelo: { ...sin, ...(Object.keys(resto).length ? { acciones: resto } : {}), casos: [...m.casos, ...casos], cargas: [...(m.cargas ?? []), ...cargas] },
    calculo,
  };
}

/** La hipótesis del cálculo con lo que hace el viento del programa. */
export function hipotesisViento(v: VientoCalculado): string {
  const dir = (d: DireccionViento) =>
    `según ${d.eje}, fondo ${coma(d.profundidad)} m y esbeltez ${coma(d.esbeltez)}: cp = ${coma(d.cp, 3)} y cs = ${coma(d.cs, 3)}, e = ±${coma(d.e)} m (el 5 % del ancho, ${coma(d.ancho)} m)`;
  const plantas = [...new Set([...v.x.plantas, ...v.y.plantas].map((p) => p.planta))];
  const F = (d: DireccionViento, id: string) => {
    const p = d.plantas.find((x) => x.planta === id);
    return p ? `${coma(p.F)}${p.dada ? "*" : ""}` : "0";
  };
  const dadas = [...v.x.plantas, ...v.y.plantas].some((p) => p.dada);
  return (
    `Viento del DB SE-AE generado por el programa (VS1): ${v.casos.length} casos de la familia «viento» (${v.casos.join(", ")}). ` +
    `Zona ${v.zona}, qb = ${coma(v.qb, 3)} kN/m²${v.qbOrigen === "simplificado" ? " (el valor simplificado del art. 3.3.2-1)" : v.qbOrigen === "dada" ? " (escrita)" : ""}, aspereza ${v.aspereza} (${ASPEREZAS[v.aspereza].descripcion}), rasante a la cota ${coma(v.rasante)} m; ` +
    `${dir(v.x)}; ${dir(v.y)}. ` +
    `Cada planta sobre la rasante recibe F = (cp − cs)·qb·ce(z)·A, con ce de la fórmula D.2 a su cota y A la fachada de su banda: en cada punto del ancho, media planta por debajo y media por encima entre las plantas que hay en él; la banda entre la rasante y la mitad de la primera planta va a la cimentación y lo que hay por encima de la última (petos, casetones) no se cuenta. ` +
    `Va como una puntual horizontal en el centro de su banda desplazado ±e. Fuerzas según X / Y, kN: ${plantas.map((id) => `${id} ${F(v.x, id)} / ${F(v.y, id)}`).join("; ")}${dadas ? " (*: con la fachada escrita)" : ""}. ` +
    `No entran el rozamiento (art. 3.3.2-3) ni la cubierta a dos aguas (Anejo D.6).`
  );
}
