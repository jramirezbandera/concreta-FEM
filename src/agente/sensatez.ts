/**
 * Comprobaciones de sensatez del modelo (A3, `docs/fem3d/agente.md` §3 y §8): oráculos del
 * MODELO, no del motor. El motor puede calcular bien un modelo equivocado (una carga en N, un
 * espesor en cm, un pilar que falta), y eso es un fallo silencioso como cualquier otro.
 *
 * - Dan avisos (`sensatez/…`), nunca errores: un valor raro puede ser legítimo (una viga de
 *   transición, un voladizo). El ingeniero los revisa en el informe (`informe.ts`).
 * - Se calculan desde el modelo físico, por un camino independiente del compilador: sin la malla,
 *   con sus polígonos (`poligonos.ts`) y las fórmulas de las secciones. De lo compilado sólo usan
 *   el reparto de las cargas por planta (el del resumen, A1) y el peso propio calculado, que es lo
 *   que se compara con el esperado.
 * - Los umbrales (`UMBRALES`) los fijó el usuario al empezar A3 (§8). Las comprobaciones con
 *   resultados (bajada tributaria, esbelteces, flechas, desplomes y axil reducido) están en
 *   `sensatezResultados.ts`.
 *
 * Unidades kN y m (D1); fck en MPa; pesos específicos en kN/m³. Puro: sin IO.
 */
import { desnivelesVigasFisico } from "../compilador/desniveles.ts";
import { resolverAbacos, TOLERANCIA_ABACOS } from "../compilador/abacos.ts";
import { compilar } from "../compilador/compilar.ts";
import { direccionEjes } from "../compilador/ejes.ts";
import { resultanteAnalitica, SOLAPE_MURO_LOSA } from "../compilador/cargas.ts";
import { puntosBarra } from "../compilador/barras.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import { cuerdaHuella, distanciaAHuella, huellaPilar } from "../compilador/geometria2d.ts";
import { MARGEN_SNAP } from "../compilador/topologia.ts";
import { compilarSeccion } from "../compilador/secciones.ts";
import { TAMANO_MALLA, type CargaFisica, type CasoFisico, type Losa, type Material, type ModeloFisico, type OpcionesCompilacion, type PanoUnidireccional, type Seccion, type Vec2 } from "../compilador/fisico.ts";
import { ppLosa as ppLosaFisica, ppPano } from "../compilador/pesoForjado.ts";
import { areaConSigno, momentosInterseccion, puntoEnRegion, recorteRegionConvexo, type Region } from "../compilador/poligonos.ts";
import { TIRA_MAXIMA } from "../compilador/anchosVigas.ts";
import { ejeSeccion } from "../compilador/puntoFijo.ts";
import { volumenReticular } from "../compilador/reticular.ts";
import type { TipoAccion } from "../combinaciones/generador.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { cargasPorPlanta, type Resumen } from "./consultas.ts";
import { casiAlineados as gruposCasiAlineados, distancia, textoGrupo, TOLERANCIA_ALINEAR } from "../editor/alinear.ts";

/** Umbrales de aviso (§8 de `agente.md`, fijados con el usuario el 2026-10-09). */
export const UMBRALES = {
  /** Altura de planta, m; en la más baja (los arranques), sólo el máximo. */
  altura: [2.2, 8],
  /** Espesor de losa o muro, m. */
  espesor: [0.08, 2],
  /** b, h o D de una sección, m (en una T, h y bf). */
  dimension: [0.1, 3],
  /** bw y hf de una T, m. */
  dimensionFina: [0.03, 3],
  /** b, h o D de una sección que sólo usan barras entre dos niveles (fase BN: redondos y perfiles de arriostramiento), m. Hasta 1 m (decisión del usuario, 2026-11-06): con 3 m, un Ø20 escrito en cm («2») no se avisaba. */
  dimensionBarra: [0.01, 1],
  /** fck, MPa. */
  fck: [12, 100],
  /** E de un material general, kN/m². */
  E: [1e6, 4e8],
  /** Peso específico, kN/m³. */
  peso: [1, 100],
  /** pp dado / (γ·espesor) de una losa maciza y de un reticular. */
  ppLosa: [0.3, 1.3],
  ppReticular: [0.3, 1],
  /** pp de un paño unidireccional, kN/m². */
  ppPano: [1.5, 8],
  /** Carga vertical de una planta por m² de sus losas y paños, kN/m², sumando los casos G, Q o S. */
  cargaG: [3, 20],
  cargaQ: [0.5, 10],
  cargaS: [0.1, 3],
  /** Cada caso sin acción (salvo el de peso propio), kN/m². */
  cargaSinAccion: 25,
  /** Diferencia relativa entre el peso propio calculado y el esperado. */
  pesoPropio: 0.1,
  /** Axil de un tramo de pilar / su bajada tributaria, y la bajada mínima (fracción de la mediana de su planta). */
  tributaria: [0.5, 2],
  tributariaMinima: 0.1,
  /** Luz libre / canto de un vano de viga: descolgada y plana (b ≥ h). */
  esbeltezViga: 18,
  esbeltezVigaPlana: 25,
  /** Mayor lado del recuadro / espesor: losa maciza y reticular. */
  esbeltezLosa: 35,
  esbeltezReticular: 30,
  /** Flecha relativa elástica / luz. */
  flecha: 1 / 500,
  /** Desplome de una planta / su altura. */
  desplome: 1 / 250,
  /** Nd / (Ac·fcd). */
  axilReducido: 0.65,
  /** M-26: un objeto a más de estas veces la extensión del resto (con la extensión mínima, m) está lejos. */
  lejos: 5,
  lejosExtension: 10,
  /** MA5: pilares y vértices que no coinciden por menos de esto según los ejes, m (la tolerancia de «Alinear»). */
  casiAlineados: TOLERANCIA_ALINEAR,
} as const;

/** Acciones que no son gravitatorias: no entran en la «gravedad» ni en las cargas por uso. */
export const ACCIONES_NO_GRAVITATORIAS: readonly TipoAccion[] = ["W", "E", "T", "N", "A"];

/** «pendiente»: todavía no se ha hecho (la Revisión de la app enseña el informe antes que el peso propio calculado). */
export type EstadoComprobacion = "bien" | "avisos" | "no-aplica" | "pendiente";

export interface Comprobacion {
  codigo: string;
  titulo: string;
  /** Cuándo avisa, en texto. */
  umbral: string;
  estado: EstadoComprobacion;
  /** Lo más desfavorable encontrado (en texto), aunque no avise. */
  peor?: string;
  avisos: Diagnostico[];
}

/** Una comprobación en curso: se marca que aplica, se le dan avisos y se guarda lo peor. */
export class Registro {
  readonly c: Comprobacion;
  private gravedad = -Infinity;

  constructor(codigo: string, titulo: string, umbral: string) {
    this.c = { codigo, titulo, umbral, estado: "no-aplica", avisos: [] };
  }

  aplica(): void {
    if (this.c.estado === "no-aplica") this.c.estado = "bien";
  }

  aviso(mensaje: string, ids: string[], detalles?: Record<string, unknown>): void {
    this.c.estado = "avisos";
    this.c.avisos.push({ codigo: this.c.codigo, severidad: "aviso", mensaje, ids, ...(detalles ? { detalles } : {}) });
  }

  /** Lo peor: el texto del valor con mayor `gravedad` (una medida que crece al acercarse o pasar del umbral). */
  peor(gravedad: number, texto: string): void {
    this.aplica();
    if (gravedad > this.gravedad) {
      this.gravedad = gravedad;
      this.c.peor = texto;
    }
  }
}

// ─── Números y geometría ────────────────────────────────────────────────────────────────────────

/** Número con `cifras` significativas y coma decimal, para los mensajes. */
export function num(x: number, cifras = 3): string {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return "0";
  const t = Math.abs(x) >= 1e-3 && Math.abs(x) < 1e7 ? String(Number(x.toPrecision(cifras))) : x.toExponential(cifras - 1);
  return t.replace(".", ",");
}

export const rango = (r: readonly [number, number], u = "") => `fuera de [${num(r[0])}; ${num(r[1])}]${u ? ` ${u}` : ""}`;
const fuera = (x: number, r: readonly [number, number]) => !(x >= r[0] && x <= r[1]);
/**
 * Cuánto se separa un cociente axil/bajada de 1, en escala logarítmica; uno negativo (el tramo va a
 * tracción) es lo más lejos (UI-18: con Math.log daba NaN y ni salía como lo peor ni se ordenaba).
 */
export const separacion = (c: number): number => (c > 0 ? Math.abs(Math.log(c)) : Infinity);
/** Cuánto sale x de [a, b] en escala logarítmica (0 en el borde; negativo dentro). */
const salida = (x: number, r: readonly [number, number]) => (x > 0 ? Math.max(Math.log(x / r[1]), Math.log(r[0] / x)) : Infinity);

export function areaPoligono(p: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]!;
    const [x1, y1] = p[(i + 1) % p.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

export const regionDe = (x: { contorno: readonly Vec2[]; huecos?: readonly (readonly Vec2[])[] }): Region => ({ contorno: x.contorno, huecos: x.huecos ?? [] });
export const areaRegion = (x: { contorno: readonly Vec2[]; huecos?: readonly (readonly Vec2[])[] }) => areaPoligono(x.contorno) - (x.huecos ?? []).reduce((s, h) => s + areaPoligono(h), 0);

/** Tramos de una polilínea: extremos, longitud y dirección unitaria. */
export function tramos(p: readonly Vec2[]): { A: Vec2; B: Vec2; L: number; u: Vec2 }[] {
  const r: { A: Vec2; B: Vec2; L: number; u: Vec2 }[] = [];
  for (let i = 1; i < p.length; i++) {
    const [A, B] = [p[i - 1]!, p[i]!];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (L > 0) r.push({ A, B, L, u: [(B[0] - A[0]) / L, (B[1] - A[1]) / L] });
  }
  return r;
}

export const longitud = (p: readonly Vec2[]) => tramos(p).reduce((s, t) => s + t.L, 0);

/** Rectángulo de ancho `b` centrado en el tramo AB (la huella en planta de una viga o un muro). */
export function huellaTramo(t: { A: Vec2; B: Vec2; u: Vec2 }, b: number): Vec2[] {
  const n: Vec2 = [(-t.u[1] * b) / 2, (t.u[0] * b) / 2];
  return [
    [t.A[0] - n[0], t.A[1] - n[1]],
    [t.B[0] - n[0], t.B[1] - n[1]],
    [t.B[0] + n[0], t.B[1] + n[1]],
    [t.A[0] + n[0], t.A[1] + n[1]],
  ];
}

// ─── Materiales y secciones ─────────────────────────────────────────────────────────────────────

export function gammaMaterial(m: Material): number {
  return m.tipo === "hormigon" ? (m.peso ?? 25) : m.tipo === "acero" ? (m.peso ?? 78.5) : m.peso;
}

/** Área bruta de una sección, m². */
export function areaSeccion(s: Seccion): number {
  switch (s.forma) {
    case "rectangular":
      return s.b * s.h;
    case "circular":
      return (Math.PI * s.D * s.D) / 4;
    case "I":
      return s.perfil.A * 1e-4;
    case "T":
      return s.bf * s.hf + s.bw * (s.h - s.hf);
    case "general":
      return s.A;
  }
}

/** Canto de una sección (h; D en una circular), m; null si no se sabe. */
export function cantoSeccion(s: Seccion): number | null {
  switch (s.forma) {
    case "rectangular":
    case "T":
      return s.h;
    case "circular":
      return s.D;
    case "I":
      return s.perfil.h / 1000;
    case "general":
      return s.h ?? null;
  }
}

/** Ancho de una sección rectangular o general con b; null en las demás. */
export function anchoSeccion(s: Seccion): number | null {
  return s.forma === "rectangular" ? s.b : s.forma === "general" ? (s.b ?? null) : null;
}

// ─── Plantas ────────────────────────────────────────────────────────────────────────────────────

/** Lo que las comprobaciones necesitan de las plantas: índices, cotas y área de losas y paños. */
export class Plantas {
  readonly ids: string[];
  readonly indice: Map<string, number>;
  readonly cotas: number[];
  /** Área de losas y paños de cada planta, m². */
  readonly area: Map<string, number>;

  constructor(f: ModeloFisico) {
    this.ids = f.plantas.map((p) => p.id);
    this.indice = new Map(this.ids.map((id, i) => [id, i]));
    this.cotas = cotasPlantas(f.plantas).map((c) => c ?? Number.NaN);
    this.area = new Map(this.ids.map((id) => [id, 0]));
    for (const x of [...(f.losas ?? []), ...(f.panos ?? [])]) this.area.set(x.planta, this.area.get(x.planta)! + areaRegion(x));
  }

  /** Índices de las plantas de cabeza de los tramos de una pieza vertical (de arriba abajo). */
  tramosVertical(p: { desde: string; hasta: string }): number[] {
    const [kh, kb] = [this.indice.get(p.hasta)!, this.indice.get(p.desde)!];
    const r: number[] = [];
    for (let k = kh; k < kb; k++) r.push(k);
    return r;
  }

  /** Altura del tramo con su cabeza en la planta k, m. */
  altura(k: number): number {
    return this.cotas[k]! - this.cotas[k + 1]!;
  }
}

/** Tipo de acción de un caso: el de su `accion` o, si es el del peso propio y no la lleva, G. */
export const tipoCaso = (c: CasoFisico): TipoAccion | null => c.accion?.tipo ?? (c.pesoPropio ? "G" : null);

// ─── Datos ──────────────────────────────────────────────────────────────────────────────────────

function datos(f: ModeloFisico): Registro[] {
  const U = UMBRALES;
  const alt = new Registro("sensatez/altura", "Altura de planta", `${rango(U.altura, "m")} (en la más baja, más de ${num(U.altura[1])} m)`);
  f.plantas.forEach((p, i) => {
    if (i === 0 || p.altura === null) return; // la de arriba del todo no la usa
    const ultima = i === f.plantas.length - 1;
    // MA5: el tramo que llega a un escalón (dos cubiertas a poca altura) sólo tiene que ser positivo
    const escalon = f.plantas[i - 1]!.tipo === "escalon";
    const r: [number, number] = escalon ? [0.01, U.altura[1]] : ultima ? [0, U.altura[1]] : [U.altura[0], U.altura[1]];
    // UI-15: la altura de una planta es la del tramo hasta la de encima; el aviso dice el tramo
    const arriba = f.plantas[i - 1]!.id;
    alt.peor(salida(p.altura, r), `${p.id}–${arriba}: ${num(p.altura)} m`);
    if (fuera(p.altura, r)) alt.aviso(`El tramo de ${p.id} a ${arriba} mide ${num(p.altura)} m (${rango(r, "m")}): ¿está en cm o es la altura de otro tramo? (es la altura de ${p.id} en la tabla Plantas)`, [p.id], { valor: p.altura });
  });

  const esp = new Registro("sensatez/espesor", "Espesor de losas y muros", rango(U.espesor, "m"));
  for (const x of [...(f.losas ?? []), ...(f.muros ?? [])]) {
    const que = "contorno" in x ? "La losa" : "El muro";
    esp.peor(salida(x.espesor, U.espesor), `${x.id}: ${num(x.espesor)} m`);
    if (fuera(x.espesor, U.espesor)) esp.aviso(`${que} ${x.id} tiene ${num(x.espesor)} m de espesor (${rango(U.espesor, "m")}): ¿está en cm?`, [x.id], { valor: x.espesor });
  }

  const sec = new Registro(
    "sensatez/seccion",
    "Dimensiones de las secciones",
    `${rango(U.dimension, "m")} (bw y hf de una T, ${rango(U.dimensionFina, "m")}${f.barras?.length ? `; las que sólo usan barras, ${rango(U.dimensionBarra, "m")}` : ""})`,
  );
  // Fase BN: las secciones que sólo usan barras entre dos niveles admiten redondos y perfiles finos
  const deOtras = new Set([...(f.pilares ?? []).flatMap((p) => [p.seccion, ...(p.tramos ?? []).map((t) => t.seccion)]), ...(f.vigas ?? []).map((v) => v.seccion), ...(f.panos ?? []).map((p) => p.seccion)]);
  const deBarras = new Set((f.barras ?? []).map((b) => b.seccion).filter((id) => !deOtras.has(id)));
  for (const s of f.secciones) {
    const D = deBarras.has(s.id) ? U.dimensionBarra : U.dimension;
    const dims: [string, number, readonly [number, number]][] =
      s.forma === "rectangular"
        ? [
            ["b", s.b, D],
            ["h", s.h, D],
          ]
        : s.forma === "circular"
          ? [["D", s.D, D]]
          : s.forma === "T"
            ? [
                ["bf", s.bf, D],
                ["h", s.h, D],
                ["bw", s.bw, U.dimensionFina],
                ["hf", s.hf, U.dimensionFina],
              ]
            : s.forma === "general"
              ? ([
                  ["b", s.b, D],
                  ["h", s.h, D],
                ].filter((d) => d[1] !== undefined) as [string, number, readonly [number, number]][])
              : [];
    for (const [nombre, v, r] of dims) {
      sec.peor(salida(v, r), `${s.id}: ${nombre} = ${num(v)} m`);
      if (fuera(v, r)) sec.aviso(`La sección ${s.id} tiene ${nombre} = ${num(v)} m (${rango(r, "m")}): ¿está en cm?`, [s.id], { [nombre]: v });
    }
  }

  const mat = new Registro("sensatez/material", "Materiales", `fck ${rango(U.fck, "MPa")}; E de un material general ${rango(U.E, "kN/m²")}; peso específico ${rango(U.peso, "kN/m³")}`);
  for (const m of f.materiales) {
    if (m.tipo === "hormigon") {
      mat.peor(salida(m.fck, U.fck), `${m.id}: fck = ${num(m.fck)} MPa`);
      if (fuera(m.fck, U.fck)) mat.aviso(`El hormigón ${m.id} tiene fck = ${num(m.fck)} MPa (${rango(U.fck, "MPa")}): ¿está en kN/m²?`, [m.id], { fck: m.fck });
    }
    if (m.tipo === "general") {
      mat.peor(salida(m.E, U.E), `${m.id}: E = ${num(m.E)} kN/m²`);
      if (fuera(m.E, U.E)) mat.aviso(`El material ${m.id} tiene E = ${num(m.E)} kN/m² (${rango(U.E, "kN/m²")}): ¿está en MPa?`, [m.id], { E: m.E });
    }
    // Un peso 0 es un modelo sin peso propio, deliberado (lo dice «sin peso propio» si hace falta)
    const g = gammaMaterial(m);
    if ((m.peso !== undefined || m.tipo === "general") && g !== 0) {
      mat.peor(salida(g, U.peso), `${m.id}: γ = ${num(g)} kN/m³`);
      if (fuera(g, U.peso)) mat.aviso(`El material ${m.id} pesa ${num(g)} kN/m³ (${rango(U.peso, "kN/m³")}): ¿está en kg/m³?`, [m.id], { peso: g });
    }
    mat.aplica();
  }

  const pp = new Registro("sensatez/pp", "Peso propio dado de losas y paños", `pp/(γ·e) ${rango(U.ppLosa)} en una losa maciza y ${rango(U.ppReticular)} en un reticular; pp de un paño ${rango(U.ppPano, "kN/m²")}`);
  const material = new Map(f.materiales.map((m) => [m.id, m]));
  for (const l of f.losas ?? []) {
    if (l.pp === undefined) continue;
    const m = material.get(l.material);
    if (!m) continue;
    const r = l.reticular ? U.ppReticular : U.ppLosa;
    const x = l.pp / (gammaMaterial(m) * l.espesor);
    pp.peor(salida(x, r), `${l.id}: pp/(γ·e) = ${num(x)}`);
    if (fuera(x, r)) pp.aviso(`La losa ${l.id} tiene pp = ${num(l.pp)} kN/m², ${num(x)} veces el de una maciza de su espesor (${rango(r)}): ¿es un peso específico o está mal el espesor?`, [l.id], { pp: l.pp, relacion: x });
  }
  for (const x of f.panos ?? []) {
    if (x.pp === undefined) continue;
    pp.peor(salida(x.pp, U.ppPano), `${x.id}: pp = ${num(x.pp)} kN/m²`);
    if (fuera(x.pp, U.ppPano)) pp.aviso(`El paño ${x.id} tiene pp = ${num(x.pp)} kN/m² (${rango(U.ppPano, "kN/m²")}).`, [x.id], { pp: x.pp });
  }
  return [alt, esp, sec, mat, pp];
}

// ─── Cargas ─────────────────────────────────────────────────────────────────────────────────────

/** Componentes verticales (hacia +Z) de una carga, las que se dan en sus datos. */
function verticales(c: CargaFisica): number[] {
  switch (c.tipo) {
    case "puntual":
      return c.F ? [c.F[2]] : [];
    case "superficie":
    case "lineal":
    case "borde":
      return [c.q[2]];
    case "viga": // z local = +Z
      return [c.q[2], ...(c.qb ? [c.qb[2]] : [])];
    case "pilar": // x local hacia arriba
      return c.ejes === "global" ? [c.q[2], ...(c.qb ? [c.qb[2]] : [])] : [c.q[0], ...(c.qb ? [c.qb[0]] : [])];
    case "barra": // en locales, z en el plano vertical y hacia arriba (fase BN)
      return [c.q[2], ...(c.qb ? [c.qb[2]] : [])];
    case "empuje":
      return [];
  }
}

/** Clave de una carga sin su id, con las claves ordenadas: dos cargas iguales dan la misma. */
function claveCarga(c: CargaFisica): string {
  const orden = (v: unknown): unknown => (Array.isArray(v) ? v.map(orden) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, orden((v as Record<string, unknown>)[k])])) : v);
  const { id: _id, ...resto } = c;
  void _id;
  return JSON.stringify(orden(resto));
}

function cargas(f: ModeloFisico): Registro[] {
  const sinPP = new Registro("sensatez/sin-peso-propio", "Caso de peso propio", "no hay ningún caso con `pesoPropio`");
  // Sólo si algo pesaría: un modelo con todos los materiales de peso 0 y paños sin pp no lo necesita
  const pesan = f.materiales.some((m) => gammaMaterial(m) > 0) || (f.panos ?? []).some((x) => (ppDePano(f, x) ?? 0) > 0) || (f.losas ?? []).some((l) => (l.pp ?? 0) > 0);
  const conPiezas = [f.pilares, f.vigas, f.losas, f.muros, f.panos].some((x) => x?.length);
  if (conPiezas && pesan) {
    sinPP.aplica();
    if (!f.casos.some((c) => c.pesoPropio)) sinPP.aviso("Ningún caso lleva `pesoPropio`: las piezas no pesan en el cálculo.", f.casos.map((c) => c.id));
  }

  // El caso del peso propio es del programa: lo que mete el usuario, aparte (en cargas muertas), para
  // que se distinga en el dibujo y en los resultados por caso. Con la misma acción, las combinaciones no cambian.
  const mezcla = new Registro("sensatez/cargas-en-peso-propio", "Caso del peso propio, sólo con el peso propio", "una carga del usuario en el caso que lleva el peso propio");
  const casoPP = f.casos.find((c) => c.pesoPropio);
  if (casoPP) {
    mezcla.aplica();
    const ids = (f.cargas ?? []).filter((c) => c.caso === casoPP.id).map((c) => c.id);
    if (ids.length)
      mezcla.aviso(
        `El caso ${casoPP.id} lleva el peso propio, que calcula el programa, y además ${ids.length === 1 ? "una carga" : `${ids.length} cargas`} del usuario (${ids.slice(0, 6).join(", ")}${ids.length > 6 ? "…" : ""}): no se distingue lo uno de lo otro. Páselas a un caso de cargas muertas con la misma acción; las combinaciones dan lo mismo.`,
        [casoPP.id, ...ids],
        { caso: casoPP.id, cargas: ids },
      );
  }

  const vacio = new Registro("sensatez/caso-vacio", "Casos vacíos", "un caso sin cargas ni peso propio");
  const usados = new Set((f.cargas ?? []).map((c) => c.caso));
  for (const c of f.casos) {
    vacio.aplica();
    if (!c.pesoPropio && !usados.has(c.id)) vacio.aviso(`El caso ${c.id} no tiene ninguna carga.`, [c.id]);
  }

  const dup = new Registro("sensatez/carga-duplicada", "Cargas duplicadas", "una carga igual a otra salvo el id, en el mismo caso");
  const vistas = new Map<string, string>();
  for (const c of f.cargas ?? []) {
    dup.aplica();
    const k = claveCarga(c);
    const otra = vistas.get(k);
    if (otra) dup.aviso(`La carga ${c.id} es igual que la ${otra} (mismo caso, mismo destino y mismos valores): ¿está dos veces?`, [c.id, otra]);
    else vistas.set(k, c.id);
  }

  const arriba = new Registro("sensatez/carga-hacia-arriba", "Cargas verticales hacia arriba", "en un caso G, Q o S, o sin acción");
  const caso = new Map(f.casos.map((c) => [c.id, c]));
  for (const c of f.cargas ?? []) {
    const k = caso.get(c.caso);
    const t = k ? tipoCaso(k) : null;
    if (t !== null && !["G", "Q", "S"].includes(t)) continue;
    const vs = verticales(c);
    if (!vs.length) continue;
    arriba.aplica();
    if (vs.some((v) => v > 0)) arriba.aviso(`La carga ${c.id} del caso ${c.caso} va hacia arriba (componente vertical ${num(Math.max(...vs))} > 0; Z es hacia arriba): ¿falta el signo?`, [c.id, c.caso]);
  }
  return [sinPP, mezcla, vacio, dup, arriba];
}

/**
 * Carga de cada planta por m² de sus losas y paños, por tipo de acción, y plantas a las que les
 * falta un caso. Las cargas por planta son las del resumen (A1): lo que recibe cada planta, con el
 * peso propio (el de un tramo de pilar o de muro, en la planta de su cabeza).
 */
function cargasPorM2(f: ModeloFisico, P: Plantas, res: Resumen): Registro[] {
  const U = UMBRALES;
  const reg = new Registro(
    "sensatez/carga-planta",
    "Carga por m² de planta",
    `casos G ${rango(U.cargaG, "kN/m²")}; Q ${rango(U.cargaQ)}; S ${rango(U.cargaS)}; cada caso sin acción, más de ${num(U.cargaSinAccion)} kN/m²`,
  );
  const tipos = new Map(f.casos.map((c) => [c.id, tipoCaso(c)]));
  const hay = (t: TipoAccion) => f.casos.some((c) => tipoCaso(c) === t);
  for (const pl of res.plantas) {
    const A = P.area.get(pl.id)!;
    if (!(A > 0)) continue;
    for (const [t, r, minimo] of [
      ["G", U.cargaG, true],
      ["Q", U.cargaQ, false],
      ["S", U.cargaS, false],
    ] as const) {
      if (!hay(t)) continue;
      const casos = f.casos.filter((c) => tipos.get(c.id) === t).map((c) => c.id);
      const q = casos.reduce((s, c) => s + (pl.cargas[c] ?? 0), 0) / A;
      if (!minimo && q === 0) continue; // que falte la carga lo dice «planta sin caso»
      reg.peor(salida(q, r), `${pl.id}, ${t}: ${num(q)} kN/m²`);
      if (fuera(q, r))
        reg.aviso(`La planta ${pl.id} recibe ${num(q)} kN/m² de los casos ${t} (${casos.join(", ")}), con ${num(A)} m² de losas y paños (${rango(r, "kN/m²")}): ¿unidades, cargas olvidadas o duplicadas?`, [pl.id, ...casos], { valor: q, tipo: t });
    }
    for (const c of f.casos) {
      if (tipos.get(c.id) !== null) continue;
      const q = (pl.cargas[c.id] ?? 0) / A;
      reg.peor(q / U.cargaSinAccion, `${pl.id}, ${c.id}: ${num(q)} kN/m²`);
      if (Math.abs(q) > U.cargaSinAccion) reg.aviso(`La planta ${pl.id} recibe ${num(q)} kN/m² del caso ${c.id} (más de ${num(U.cargaSinAccion)} kN/m²): ¿está en N?`, [pl.id, c.id], { valor: q });
    }
  }

  const falta = new Registro("sensatez/planta-sin-caso", "Plantas sin la carga de un caso", "una planta con losas o paños sin carga de un caso que carga a la mayoría (salvo la más alta y las cubiertas)");
  const conArea = P.ids.filter((id) => P.area.get(id)! > 0);
  const masAlta = conArea[0];
  for (const c of f.casos) {
    const t = tipos.get(c.id);
    if (c.pesoPropio || (t !== null && t !== undefined && ACCIONES_NO_GRAVITATORIAS.includes(t))) continue;
    const cargadas = conArea.filter((id) => (res.plantas.find((p) => p.id === id)!.cargas[c.id] ?? 0) > 0);
    if (cargadas.length < 2 || cargadas.length < conArea.length / 2) continue;
    falta.aplica();
    for (const id of conArea) {
      if (cargadas.includes(id) || id === masAlta || f.plantas[P.indice.get(id)!]!.tipo === "cubierta") continue;
      falta.aviso(`La planta ${id} no recibe ninguna carga del caso ${c.id}, que carga ${cargadas.length} de las ${conArea.length} plantas con losas o paños: ¿la carga está en otro caso o falta?`, [id, c.id]);
    }
  }
  return [reg, falta];
}

// ─── Pilares ────────────────────────────────────────────────────────────────────────────────────

function pilares(f: ModeloFisico, P: Plantas, epsSnap: number): Registro[] {
  const arranque = new Registro("sensatez/pilar-arranque", "Arranques de pilares", "un pilar con vínculo en la base que arranca en una planta que no es la más baja");
  const corte = new Registro("sensatez/pilar-interrumpido", "Pilares interrumpidos", "un pilar que acaba bajo una losa o un paño de la planta de encima que cubre su eje");
  const ultima = P.ids.length - 1;
  for (const p of f.pilares ?? []) {
    const [kb, kh] = [P.indice.get(p.desde), P.indice.get(p.hasta)];
    if (kb === undefined || kh === undefined) continue; // lo dice el compilador
    arranque.aplica();
    corte.aplica();
    if ((p.base ?? "empotrado") !== "ninguno" && kb !== ultima)
      arranque.aviso(`El pilar ${p.id} arranca ${p.base ?? "empotrado"} en la planta ${p.desde}, que no es la más baja: ¿le falta un tramo debajo o tendría que nacer sobre otra pieza (base "ninguno")?`, [p.id, p.desde]);
    if (kh === 0) continue;
    const encima = P.ids[kh - 1]!;
    // PF: el eje del último tramo de p frente al del primero de q (el centro de su sección)
    const eje = (x: typeof p, cabeza: string) => ejeSeccion(x, f.secciones?.find((s) => s.id === (x.tramos?.find((t) => t.planta === cabeza)?.seccion ?? x.seccion)));
    const [px, py] = eje(p, p.hasta);
    const sigue = (f.pilares ?? []).some((q) => {
      if (q === p || q.desde !== p.hasta) return false;
      const [qx, qy] = eje(q, encima);
      return Math.hypot(qx - px, qy - py) <= epsSnap * MARGEN_SNAP;
    });
    if (sigue) continue;
    const cubre = [...(f.losas ?? []), ...(f.panos ?? [])].find((x) => x.planta === encima && puntoEnRegion([px, py], regionDe(x)));
    if (cubre) corte.aviso(`El pilar ${p.id} acaba en la planta ${p.hasta}, pero ${"espesor" in cubre ? "la losa" : "el paño"} ${cubre.id} de la planta ${encima} pasa sobre su eje: ¿tendría que seguir hasta arriba?`, [p.id, cubre.id]);
  }
  return [arranque, corte];
}

// ─── Peso propio ────────────────────────────────────────────────────────────────────────────────

export interface PesoPropioPlanta {
  planta: string;
  /** Σ V·γ de cada tipo de pieza, kN: pilares y muros, los tramos con su cabeza en la planta. */
  pilares: number;
  vigas: number;
  losas: number;
  panos: number;
  muros: number;
  /** Fase BN: las barras entre dos niveles, enteras en la planta de su extremo alto (sólo si el modelo tiene alguna). */
  barras?: number;
  /** Lo que el compilador no cuenta dos veces (C2-g, C3-g), estimado aparte, kN. */
  solapes: number;
  esperado: number;
  /** El del cálculo (el caso de peso propio sin las demás cargas), kN; null si no se pudo compilar. */
  calculado: number | null;
}

export interface DesglosePesoPropio {
  caso: string;
  plantas: PesoPropioPlanta[];
  total: Omit<PesoPropioPlanta, "planta">;
  /** Lo calculado, todavía sin hacer (`sensatezModelo` con `"pendiente"`): la columna va vacía. */
  pendiente?: true;
}

/**
 * A-9: trozos [desde, hasta] del tramo `t` de una viga de la planta k que corren por el eje de un
 * muro que llega a esa planta desde abajo (los extremos del tramo del muro a ≤ eps de su recta),
 * con el espesor del muro.
 */
export function sobreMuros(t: { A: Vec2; L: number; u: Vec2 }, k: number, f: ModeloFisico, P: Plantas, eps: number): { desde: number; hasta: number; t: number }[] {
  const r: { desde: number; hasta: number; t: number }[] = [];
  const pr = (q: Vec2) => {
    const [dx, dy] = [q[0] - t.A[0], q[1] - t.A[1]];
    return { s: dx * t.u[0] + dy * t.u[1], d: Math.abs(dx * t.u[1] - dy * t.u[0]) };
  };
  for (const m of f.muros ?? []) {
    if (!P.tramosVertical(m).includes(k)) continue;
    for (const tm of tramos(m.puntos)) {
      const [a, b] = [pr(tm.A), pr(tm.B)];
      if (a.d > eps || b.d > eps) continue;
      const [desde, hasta] = [Math.max(0, Math.min(a.s, b.s)), Math.min(t.L, Math.max(a.s, b.s))];
      if (hasta - desde > eps) r.push({ desde, hasta, t: m.espesor });
    }
  }
  return r;
}

/**
 * El pp de una losa (kN/m²) en su zona maciza o aligerada y en sus ábacos, como el compilador (C4-i,
 * `pesoForjado.ts`). Un reticular con casetón "perdido" sin pp (error del compilador) pesa como el
 * recuperable.
 */
export function ppLosa(l: Losa, m: Material): { pp: number; ppAbaco: number } {
  const g = gammaMaterial(m);
  const r = l.reticular;
  return ppLosaFisica(l, g) ?? { pp: g * volumenReticular({ h: l.espesor, hf: r!.capa, bw: r!.nervio, s: r!.intereje }), ppAbaco: g * l.espesor };
}

/** El pp de un paño (kN/m²), como el compilador: el escrito o el de su vigueta en T y su bovedilla (`pesoForjado.ts`). */
export function ppDePano(f: ModeloFisico, p: PanoUnidireccional): number | undefined {
  const s = f.secciones.find((x) => x.id === p.seccion);
  return ppPano(p, s, s && f.materiales.find((x) => x.id === s.material));
}

/**
 * Lo que una viga de hormigón de canto h y peso específico γ bajo una losa o un paño pesa por m² de
 * planta en el punto q, sin lo que ese trozo de su ancho ya pesa como forjado (C2-g, AU-4):
 * γ·h − min(γ·min(h, t), pp), con el pp del ábaco si q cae en uno.
 */
export function pesoLibre(f: ModeloFisico, planta: string, q: Vec2, h: number, gamma: number): number {
  const solido = (t: number, pp: number) => gamma * h - Math.min(gamma * Math.min(h, t), pp);
  const l = (f.losas ?? []).find((x) => x.planta === planta && puntoEnRegion(q, regionDe(x)));
  const m = l && f.materiales.find((x) => x.id === l.material);
  if (l && m) {
    const { pp, ppAbaco } = ppLosa(l, m);
    const enAbaco = (l.reticular?.abacos ?? []).some((ab) => puntoEnRegion(q, { contorno: ab, huecos: [] }));
    return solido(l.espesor, enAbaco ? ppAbaco : pp);
  }
  if (l) return gamma * (h - Math.min(h, l.espesor));
  const pn = (f.panos ?? []).find((x) => x.planta === planta && puntoEnRegion(q, regionDe(x)));
  const s = pn && f.secciones.find((x) => x.id === pn.seccion);
  const hv = s ? cantoSeccion(s) : null;
  return hv ? solido(hv, ppDePano(f, pn!) ?? 0) : gamma * h;
}

/**
 * Peso propio esperado por planta y tipo de pieza, sin la malla: Σ V·γ con el pp de las losas y
 * los paños, menos los solapes que el compilador descuenta (C2-g: una viga rectangular de
 * hormigón bajo una losa o un paño no pesa lo que su ancho ya pesa como forjado, AU-4; C3-g: el muro, menos su solape con
 * las losas, la mitad por cada lado de la planta al que llega). Estos se estiman por la huella de
 * la pieza (su eje con su ancho) dentro de las losas. El pilar no descuenta su solape (A-9). Una barra
 * entre dos niveles (fase BN) pesa γ·A por su longitud real, en la planta de su extremo alto salvo su
 * zona rígida en el extremo bajo (CB-f, la que el compilador lleva al nudo de esa planta).
 */
export function pesoPropioEsperado(f: ModeloFisico, P: Plantas, eps = 0.05, toleranciaAbacos = TOLERANCIA_ABACOS, planoForjado: "superior" | "medio" = "superior"): Omit<PesoPropioPlanta, "calculado">[] {
  // MA2: con los ábacos que usa el compilador (los de los pilares y los unidos)
  f = resolverAbacos(f, toleranciaAbacos).modelo;
  const material = new Map(f.materiales.map((m) => [m.id, m]));
  const seccion = new Map(f.secciones.map((s) => [s.id, s]));
  const conBarras = !!f.barras?.length;
  const r = new Map(P.ids.map((id) => [id, { planta: id, pilares: 0, vigas: 0, losas: 0, panos: 0, muros: 0, ...(conBarras ? { barras: 0 } : {}), solapes: 0, esperado: 0 } as Omit<PesoPropioPlanta, "calculado">]));
  const pesoSeccion = (id: string) => {
    const s = seccion.get(id);
    const m = s && material.get(s.material);
    return s && m ? { s, m, w: areaSeccion(s) * gammaMaterial(m) } : null;
  };
  for (const p of f.pilares ?? [])
    for (const k of P.tramosVertical(p)) {
      const w = pesoSeccion(p.tramos?.find((t) => t.planta === P.ids[k])?.seccion ?? p.seccion);
      if (w) r.get(P.ids[k]!)!.pilares += w.w * P.altura(k);
    }
  const losasEn = (planta: string) => (f.losas ?? []).filter((l) => l.planta === planta);
  const panosEn = (planta: string) => (f.panos ?? []).filter((x) => x.planta === planta);
  // Fase DN: el desnivel de cada viga, el del forjado más alto que la toca (DN-e), como el compilador
  const desnivelViga = desnivelesVigasFisico(f, eps);
  for (const v of f.vigas ?? []) {
    const w = pesoSeccion(v.seccion);
    if (!w) continue;
    const x = r.get(v.planta)!;
    x.vigas += w.w * longitud(v.puntos);
    if (w.s.forma !== "rectangular" || w.m.tipo !== "hormigon") continue;
    // C2-g: bajo una losa o un paño, sólo lo que no pesa ya como forjado (AU-4)
    const gamma = gammaMaterial(w.m);
    const k = P.indice.get(v.planta)!;
    for (const t of tramos(v.puntos)) {
      const huella = huellaTramo(t, w.s.b);
      const hs = w.s.h;
      const dv = desnivelViga.get(v.id) ?? 0;
      // DN: con un desnivel, sólo lo que se solapan en canto la viga (cara superior en dv) y el forjado
      const forjado = (t: number, pp: number, dz = 0) => {
        if (dv === 0 && dz === 0) return Math.min(gamma * Math.min(hs, t), pp);
        const solape = Math.max(0, Math.min(dv, dz) - Math.max(dv - hs, dz - t));
        return Math.min(gamma * solape, pp * (solape / t));
      };
      for (const l of losasEn(v.planta)) {
        const ml = material.get(l.material);
        if (!ml) continue;
        const { pp, ppAbaco } = ppLosa(l, ml);
        const A = momentosInterseccion(regionDe(l), huella).A;
        // Lo de los ábacos dentro de la losa (uno de fachada se sale de ella): el ábaco recortado por la huella, que es convexa
        const Aab = (l.reticular?.abacos ?? []).reduce((t, ab) => t + (recorteRegionConvexo({ contorno: ab, huecos: [] }, huella) ?? []).reduce((u, z) => u + Math.abs(momentosInterseccion(regionDe(l), z).A), 0), 0);
        x.solapes += (A - Aab) * forjado(l.espesor, pp, l.desnivel ?? 0) + Aab * forjado(l.espesor, ppAbaco, l.desnivel ?? 0);
      }
      for (const pn of panosEn(v.planta)) {
        const h = seccion.get(pn.seccion);
        const hv = h ? cantoSeccion(h) : null;
        if (hv) x.solapes += momentosInterseccion(regionDe(pn), huella).A * forjado(hv, ppDePano(f, pn) ?? 0, pn.desnivel ?? 0);
      }
      // A-9: por el eje de un muro que le llega desde abajo, sólo lo que sobresale de él
      for (const o of sobreMuros(t, k, f, P, eps)) {
        const sm = (o.desde + o.hasta) / 2;
        const { b, h } = w.s;
        const wl = [1, -1].reduce((suma, lado) => suma + pesoLibre(f, v.planta, [t.A[0] + t.u[0] * sm - (lado * t.u[1] * b) / 4, t.A[1] + t.u[1] * sm + (lado * t.u[0] * b) / 4], h, gamma), 0);
        x.solapes += (Math.min(b, o.t) / 2) * wl * (o.hasta - o.desde);
      }
    }
  }
  for (const l of f.losas ?? []) {
    const m = material.get(l.material);
    if (m) r.get(l.planta)!.losas += pesoLosa(l, m);
  }
  for (const pn of f.panos ?? []) r.get(pn.planta)!.panos += (ppDePano(f, pn) ?? 0) * areaRegion(pn);
  for (const m of f.muros ?? []) {
    const mat = material.get(m.material);
    if (!mat) continue;
    const w = gammaMaterial(mat) * m.espesor;
    const L = longitud(m.puntos);
    const ks = P.tramosVertical(m);
    const zBase = P.cotas[P.indice.get(m.desde)!]!;
    for (const k of ks) {
      const [z0, z1] = [P.cotas[k + 1]! - zBase, P.cotas[k]! - zBase];
      const huecos = (m.huecos ?? []).reduce((s, h) => s + Math.max(0, h.hasta - h.desde) * Math.max(0, Math.min(z1, h.z1) - Math.max(z0, h.z0)), 0);
      r.get(P.ids[k]!)!.muros += w * (L * (z1 - z0) - huecos);
    }
    // C3-g: el solape con las losas de cada planta a la que llega, lo que la losa ocupa del muro de
    // debajo y del de encima (A2-58: todo el canto en la cabeza con RV-b; la mitad y la mitad con el plano medio)
    const kh = ks[0]!;
    const kb = ks[ks.length - 1]! + 1;
    const [fDebajo, fEncima] = SOLAPE_MURO_LOSA[planoForjado];
    for (let k = kh; k <= kb; k++) {
      const lados = (k < kb ? fDebajo : 0) + (k > kh ? fEncima : 0);
      if (!lados) continue;
      for (const l of losasEn(P.ids[k]!))
        for (const t of tramos(m.puntos)) r.get(P.ids[k]!)!.solapes += momentosInterseccion(regionDe(l), huellaTramo(t, m.espesor)).A * l.espesor * gammaMaterial(mat) * lados;
    }
  }
  for (const b of f.barras ?? []) {
    const w = pesoSeccion(b.seccion);
    const AB = puntosBarra(f.plantas, b);
    const [ki, kf] = [P.indice.get(b.inicio.planta), P.indice.get(b.fin.planta)];
    if (!w || !AB || ki === undefined || kf === undefined) continue;
    const L = Math.hypot(AB[1][0] - AB[0][0], AB[1][1] - AB[0][1], AB[1][2] - AB[0][2]);
    // La zona rígida del extremo bajo (si lo hay), a su planta
    const bajo = ki === kf ? 0 : zonaRigidaBarra(f, ki > kf ? AB[0] : AB[1], ki > kf ? AB[1] : AB[0], Math.max(ki, kf), eps);
    r.get(P.ids[Math.min(ki, kf)]!)!.barras! += w.w * (L - bajo);
    r.get(P.ids[Math.max(ki, kf)]!)!.barras! += w.w * bajo;
  }
  for (const x of r.values()) x.esperado = x.pilares + x.vigas + x.losas + x.panos + x.muros + (x.barras ?? 0) - x.solapes;
  return [...r.values()];
}

/**
 * Lo que una barra recorre en la huella del pilar de hormigón al que llega en X (CB-f), desde X hacia
 * Y, m: la zona rígida del compilador (`piezas.ts`), con la huella del nudo de la planta k.
 */
function zonaRigidaBarra(f: ModeloFisico, X: readonly number[], Y: readonly number[], k: number, eps: number): number {
  const L = Math.hypot(Y[0]! - X[0]!, Y[1]! - X[1]!, Y[2]! - X[2]!);
  const h = Math.hypot(Y[0]! - X[0]!, Y[1]! - X[1]!) / L;
  if (!(h > 1e-9)) return 0;
  const ids = f.plantas.map((p) => p.id);
  const Q: Vec2 = [X[0]!, X[1]!];
  let mejor: { d: number; huella: ReturnType<typeof huellaPilar>; hormigon: boolean } | null = null;
  for (const p of f.pilares ?? []) {
    const [kb, kh] = [ids.indexOf(p.desde), ids.indexOf(p.hasta)];
    if (!(k >= kh && k <= kb)) continue;
    // El tramo del nudo: el de debajo o, en la planta de su base, el de encima
    const kt = k < kb ? k : k - 1;
    const sec = f.secciones.find((x) => x.id === (p.tramos?.find((t) => t.planta === ids[kt])?.seccion ?? p.seccion));
    const mat = sec && f.materiales.find((m) => m.id === sec.material);
    if (!sec || !mat) continue;
    const forma = compilarSeccion(sec, mat, true).huella;
    if (!forma) continue;
    const [cx, cy] = ejeSeccion(p, sec);
    const huella = huellaPilar(cx, cy, p.giro ?? 0, forma);
    const d = distanciaAHuella(Q, huella);
    if (d <= eps && (!mejor || d < mejor.d)) mejor = { d, huella, hormigon: mat.tipo === "hormigon" };
  }
  if (!mejor?.hormigon) return 0;
  const u: Vec2 = [(Y[0]! - X[0]!) / (L * h), (Y[1]! - X[1]!) / (L * h)];
  const cu = cuerdaHuella(Q, u, mejor.huella, 1e-6);
  return cu ? Math.max(0, cu[1]) / h : 0;
}

/**
 * Peso de una losa, kN: su pp por su área o, sin él, γ·e (maciza) o, en un reticular (C4-i), el pp
 * de su casetón en la zona aligerada y γ·e en los ábacos (`ppLosa`).
 */
export function pesoLosa(l: Losa, m: Material): number {
  const A = areaRegion(l);
  // En un reticular, el pp escrito es el de la zona aligerada y los ábacos pesan γ·canto (MA3)
  if (l.pp !== undefined && !l.reticular) return l.pp * A;
  if (!l.reticular) return gammaMaterial(m) * l.espesor * A;
  const { pp, ppAbaco } = ppLosa(l, m);
  const Aab = (l.reticular.abacos ?? []).reduce((t, ab) => t + Math.abs(momentosInterseccion(regionDe(l), ab).A), 0);
  return pp * (A - Aab) + ppAbaco * Aab;
}

/**
 * Peso propio del cálculo por planta: el caso de peso propio compilado sin las demás cargas, con
 * el reparto por planta del resumen. Una compilación más (sin cargas, la misma malla salvo lo que
 * siembran las cargas, que no cambia el peso).
 */
export function pesoPropioCalculado(f: ModeloFisico, opciones: OpcionesCompilacion | undefined): Map<string, number> | null {
  const caso = f.casos.find((c) => c.pesoPropio);
  if (!caso) return null;
  // Sin la zona rígida de la base de los pilares (LV-d): el peso es el mismo, pero el de esa zona
  // iría al nudo de la planta de abajo, y el esperado cuenta el tramo entero en la de su cabeza
  // Sin las acciones del programa (VS): no cambian el peso ni la malla, y sus casos no están aquí (las
  // masas del sismo nombran casos que se quitan)
  const { acciones: _a, ...sinAcciones } = f;
  const c = compilar({ ...sinAcciones, casos: [caso], cargas: [] }, { ...opciones, zonaRigidaBase: false });
  if (!c.valido) return null;
  const ids = f.plantas.map((p) => p.id);
  const r = new Map<string, number>();
  for (const [id, sub] of cargasPorPlanta(c, ids)) r.set(id, -resultanteAnalitica(sub, 0, [0, 0, 0]).F[2]);
  return r;
}

/**
 * Lo calculado del peso propio: sin darlo, se compila (`pesoPropioCalculado`); `"pendiente"`, se deja
 * para después (la comprobación sale «pendiente» y la columna, vacía).
 */
export type PesoCalculado = Map<string, number> | null | "pendiente";

function pesoPropio(f: ModeloFisico, P: Plantas, opciones: OpcionesCompilacion | undefined, dado?: PesoCalculado): { registro: Registro; desglose: DesglosePesoPropio | null } {
  const U = UMBRALES;
  const reg = new Registro("sensatez/peso-propio", "Peso propio calculado frente al esperado", `difieren más de un ${num(U.pesoPropio * 100)} % (por planta y en total)`);
  const caso = f.casos.find((c) => c.pesoPropio);
  if (!caso) return { registro: reg, desglose: null };
  const pendiente = dado === "pendiente";
  const calc = dado === undefined ? pesoPropioCalculado(f, opciones) : pendiente ? null : dado;
  if (pendiente) reg.c.estado = "pendiente";
  const plantas: PesoPropioPlanta[] = pesoPropioEsperado(f, P, opciones?.epsSnap, (opciones?.tamanoMalla ?? TAMANO_MALLA) / 2, opciones?.planoForjado ?? "superior").map((x) => ({ ...x, calculado: calc ? (calc.get(x.planta) ?? 0) : null }));
  const total = { pilares: 0, vigas: 0, losas: 0, panos: 0, muros: 0, ...(f.barras?.length ? { barras: 0 } : {}), solapes: 0, esperado: 0, calculado: calc ? 0 : null } as DesglosePesoPropio["total"];
  for (const x of plantas) {
    for (const k of ["pilares", "vigas", "losas", "panos", "muros", "solapes", "esperado"] as const) total[k] += x[k];
    if (total.barras !== undefined) total.barras += x.barras ?? 0;
  }
  if (calc) total.calculado = plantas.reduce((s, x) => s + x.calculado!, 0);
  for (const x of [...plantas, { ...total, planta: "total" }]) {
    if (x.calculado === null || !(x.esperado > 0 || x.calculado > 0)) continue;
    const d = (x.calculado - x.esperado) / Math.max(x.esperado, x.calculado);
    reg.peor(Math.abs(d), `${x.planta}: ${num(d * 100, 2)} %`);
    if (Math.abs(d) > U.pesoPropio)
      reg.aviso(
        `${x.planta === "total" ? "En total" : `En la planta ${x.planta}`}, el peso propio del cálculo es ${num(x.calculado)} kN y el esperado (Σ V·γ menos solapes), ${num(x.esperado)} kN (${num(d * 100, 2)} %): ¿falta el pp de alguna pieza o hay piezas que no se compilan?`,
        x.planta === "total" ? [caso.id] : [x.planta, caso.id],
        { calculado: x.calculado, esperado: x.esperado },
      );
  }
  return { registro: reg, desglose: { caso: caso.id, plantas, total, ...(pendiente ? { pendiente: true as const } : {}) } };
}

// ─── Bordes de forjado ──────────────────────────────────────────────────────────────────────────

type Forjado = { id: string; planta: string; contorno: readonly Vec2[]; huecos?: readonly (readonly Vec2[])[] };

/** Los anillos de un forjado: el contorno y sus huecos. */
export const anillosForjado = (x: Forjado): (readonly Vec2[])[] => [x.contorno, ...(x.huecos ?? [])];

/**
 * Los ejes que atan el borde de un forjado: los tramos de las vigas y los apoyos lineales de su
 * planta, de los muros que llegan a ella o salen de ella, y los bordes de los otros forjados de la
 * planta. Los de las vigas, con su ancho: un borde dentro de él también está atado (fase LV: la
 * losa se une a la viga por su cara, así que el borde puede ir por el eje o hasta la cara de fuera),
 * y hasta TIRA_MAXIMA·b más allá de su cara de fuera (fase TB: la tira de borde, `libresTramo`).
 */
export function ejesQueAtan(f: ModeloFisico, P: Plantas, x: Forjado): { A: Vec2; B: Vec2; ancho?: number }[] {
  const k = P.indice.get(x.planta);
  const ejes: { A: Vec2; B: Vec2; ancho?: number }[] = [];
  if (k === undefined) return ejes;
  const ancho = (id: string) => {
    const sc = (f.secciones ?? []).find((s) => s.id === id);
    return sc?.forma === "rectangular" ? sc.b : sc?.forma === "circular" ? sc.D : 0;
  };
  for (const v of f.vigas ?? []) if (v.planta === x.planta) ejes.push(...tramos(v.puntos).map((t) => ({ ...t, ancho: ancho(v.seccion) })));
  for (const a of f.apoyosLineales ?? []) if (a.planta === x.planta) ejes.push(...tramos(a.puntos));
  for (const m of f.muros ?? []) {
    const [kh, kb] = [P.indice.get(m.hasta), P.indice.get(m.desde)];
    if (kh !== undefined && kb !== undefined && kh <= k && k <= kb) ejes.push(...tramos(m.puntos));
  }
  for (const o of [...(f.losas ?? []), ...(f.panos ?? [])]) if (o.id !== x.id && o.planta === x.planta) for (const an of anillosForjado(o)) ejes.push(...tramos([...an, an[0]!]));
  return ejes;
}

/**
 * Los trozos [s0, s1] del tramo t (de A a B, de largo L y dirección u) que no van sobre ninguno de los
 * `ejes` (a ≤ eps de su recta, o dentro de su ancho), de más de eps. Con `dentro` (la normal del
 * tramo hacia el forjado), como el compilador en la fase TB (`tirasBorde`): una viga del lado del
 * forjado ata también el borde que queda a no más de TIRA_MAXIMA·b de su cara de fuera (su tira va
 * con la viga), y una viga ata hasta el extremo del tramo si le queda a no más de b/2 + TIRA_MAXIMA·b
 * (la esquina más allá del pilar de esquina, en el que acaba la viga). Un tramo que cae entero en esa
 * franja de la viga (un escalón del borde junto a ella) también está atado.
 */
export function libresTramo(t: { A: Vec2; L: number; u: Vec2 }, ejes: readonly { A: Vec2; B: Vec2; ancho?: number }[], eps: number, dentro?: Vec2): [number, number][] {
  const pr = (q: Vec2) => {
    const [dx, dy] = [q[0] - t.A[0], q[1] - t.A[1]];
    return { s: dx * t.u[0] + dy * t.u[1], d: Math.abs(dx * t.u[1] - dy * t.u[0]), n: dentro ? dx * dentro[0] + dy * dentro[1] : 0 };
  };
  const cub: [number, number][] = [];
  for (const e of ejes) {
    const w = e.ancho ?? 0;
    if (dentro && w > 0) {
      const Le = Math.hypot(e.B[0] - e.A[0], e.B[1] - e.A[1]);
      const ue: Vec2 = Le > 0 ? [(e.B[0] - e.A[0]) / Le, (e.B[1] - e.A[1]) / Le] : [0, 0];
      const ext = w / 2 + TIRA_MAXIMA * w + eps;
      const enFranja = (q: Vec2) => {
        const [dx, dy] = [q[0] - e.A[0], q[1] - e.A[1]];
        const sg = dx * ue[0] + dy * ue[1];
        return Le > 0 && Math.abs(dx * ue[1] - dy * ue[0]) <= ext && sg >= -ext && sg <= Le + ext;
      };
      if (enFranja(t.A) && enFranja([t.A[0] + t.L * t.u[0], t.A[1] + t.L * t.u[1]])) {
        cub.push([0, t.L]);
        continue;
      }
    }
    const [a, b] = [pr(e.A), pr(e.B)];
    const tira = w > 0 && a.n > 0 && b.n > 0 ? TIRA_MAXIMA * w : 0;
    const tol = Math.max(eps, w / 2 + tira + eps);
    if (a.d > tol || b.d > tol) continue;
    let [s0, s1] = [Math.max(0, Math.min(a.s, b.s)), Math.min(t.L, Math.max(a.s, b.s))];
    if (dentro && w > 0 && s1 > s0) {
      const ext = w / 2 + TIRA_MAXIMA * w + eps;
      if (s0 <= ext) s0 = 0;
      if (t.L - s1 <= ext) s1 = t.L;
    }
    if (s1 > s0) cub.push([s0, s1]);
  }
  cub.sort((p, q) => p[0] - q[0]);
  const r: [number, number][] = [];
  let s = 0;
  for (const [s0, s1] of cub) {
    if (s0 - s > eps) r.push([s, s0]);
    s = Math.max(s, s1);
  }
  if (t.L - s > eps) r.push([s, t.L]);
  return r;
}

/**
 * Los tramos del borde (contorno y huecos) de cada losa y cada paño que no van sobre el eje de una
 * viga de su planta, de un muro que llega a ella o sale de ella, de un apoyo lineal de su planta ni
 * del borde de otra losa o paño de la planta (a ≤ eps de su recta). Todo borde de forjado lleva su
 * zuncho (decisión del usuario, 2026-10-15): un borde libre se calcula, pero suele ser un zuncho
 * que falta en el modelo.
 */
export function bordesSinViga(f: ModeloFisico, P: Plantas, eps: number): { pieza: string; planta: string; tramos: [Vec2, Vec2][] }[] {
  const r: { pieza: string; planta: string; tramos: [Vec2, Vec2][] }[] = [];
  for (const x of [...(f.losas ?? []), ...(f.panos ?? [])]) {
    if (!P.indice.has(x.planta)) continue;
    const ejes = ejesQueAtan(f, P, x);
    const libres: [Vec2, Vec2][] = [];
    for (const [ia, an] of anillosForjado(x).entries()) {
      // Hacia el forjado: a la izquierda en un contorno antihorario; en un hueco, hacia fuera de él
      const sentido = Math.sign(areaConSigno(an)) * (ia === 0 ? 1 : -1);
      for (const t of tramos([...an, an[0]!]))
        for (const [s0, s1] of libresTramo(t, ejes, eps, [-t.u[1] * sentido, t.u[0] * sentido])) libres.push([[t.A[0] + s0 * t.u[0], t.A[1] + s0 * t.u[1]], [t.A[0] + s1 * t.u[0], t.A[1] + s1 * t.u[1]]]);
    }
    if (libres.length) r.push({ pieza: x.id, planta: x.planta, tramos: libres });
  }
  return r;
}

function bordes(f: ModeloFisico, P: Plantas, eps: number): Registro[] {
  const reg = new Registro("sensatez/borde-sin-viga", "Bordes de forjado con su zuncho", "un tramo del borde de una losa o un paño, de más de ε_snap, sin una viga, un muro, un apoyo lineal u otro forjado debajo");
  if ((f.losas ?? []).length + (f.panos ?? []).length === 0) return [reg];
  reg.aplica();
  const pt = (q: Vec2) => `(${num(q[0])}, ${num(q[1])})`;
  for (const b of bordesSinViga(f, P, eps)) {
    const L = b.tramos.reduce((t, [A, B]) => t + Math.hypot(B[0] - A[0], B[1] - A[1]), 0);
    reg.peor(L, `${b.pieza}: ${num(L)} m de borde sin viga`);
    const lista = b.tramos.slice(0, 6).map(([A, B]) => `${pt(A)}–${pt(B)}`).join(", ");
    reg.aviso(
      `${b.pieza} (${b.planta}): ${num(L)} m de borde sin viga, muro ni apoyo lineal debajo, en ${b.tramos.length} tramo${b.tramos.length > 1 ? "s" : ""}: ${lista}${b.tramos.length > 6 ? "…" : ""}. Todo borde de forjado lleva su zuncho: si lo tiene en obra, póngalo como viga (el borde de la losa, a su eje); si el borde es libre de verdad, este aviso se puede dejar.`,
      [b.pieza],
      { tramos: b.tramos },
    );
  }
  return [reg];
}

// ─── Objetos lejos del resto ────────────────────────────────────────────────────────────────────

/**
 * M-26 (`auditoria-ui.md`): un objeto muy lejos del resto (un pilar tecleado a 1 km en vez de a 10 m)
 * entraba sin aviso. En planta, con la caja de cada objeto (no los ejes de replanteo ni las cargas, que
 * son de su pieza): avisa del que queda a más de `lejos` veces la extensión del resto (como poco
 * `lejosExtension`). El resto, sin recorrer todo por cada objeto: en cada lado de la caja de todos, el
 * objeto que lo da y el segundo. Dos objetos lejos juntos no se avisan uno al otro (son un grupo).
 */
function lejanos(f: ModeloFisico): Registro[] {
  const U = UMBRALES;
  const reg = new Registro("sensatez/lejos", "Objetos lejos del resto", `a más de ${num(U.lejos)} veces la extensión del resto en planta (como poco, ${num(U.lejos * U.lejosExtension)} m)`);
  type Caja = { id: string; c: [number, number, number, number] };
  const cajas: Caja[] = [];
  const de = (id: string, ps: readonly (readonly [number, number])[]) => {
    if (!ps.length) return;
    const c: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of ps) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      c[0] = Math.min(c[0], x);
      c[1] = Math.min(c[1], y);
      c[2] = Math.max(c[2], x);
      c[3] = Math.max(c[3], y);
    }
    cajas.push({ id, c });
  };
  for (const p of f.pilares ?? []) de(p.id, [[p.x, p.y]]);
  for (const v of f.vigas ?? []) de(v.id, v.puntos);
  for (const w of f.muros ?? []) de(w.id, w.puntos);
  for (const l of [...(f.losas ?? []), ...(f.panos ?? [])]) de(l.id, l.contorno);
  for (const a of f.apoyos ?? []) de(a.id, [[a.x, a.y]]);
  for (const a of f.apoyosLineales ?? []) de(a.id, a.puntos);
  for (const b of f.barras ?? []) de(b.id, [[b.inicio.x, b.inicio.y], [b.fin.x, b.fin.y]]);
  if (cajas.length < 3) return [reg];
  reg.aplica();
  // Por lado (x0, y0 hacia abajo; x1, y1 hacia arriba): el objeto que lo da y el segundo
  const extremos = ([0, 1, 2, 3] as const).map((k) => {
    const signo = k < 2 ? 1 : -1;
    const orden = [...cajas].sort((a, b) => signo * (a.c[k] - b.c[k]));
    return [orden[0]!, orden[1]!] as const;
  });
  for (const o of cajas) {
    const r = extremos.map(([a, b], k) => (a === o ? b : a).c[k]!) as [number, number, number, number];
    const L = Math.max(U.lejosExtension, r[2] - r[0], r[3] - r[1]);
    const dx = Math.max(0, r[0] - o.c[2], o.c[0] - r[2]);
    const dy = Math.max(0, r[1] - o.c[3], o.c[1] - r[3]);
    const d = Math.hypot(dx, dy);
    reg.peor(d / L, `${o.id}: a ${num(d)} m del resto (que mide ${num(L)} m)`);
    if (d > U.lejos * L) reg.aviso(`${o.id} está a ${num(d)} m del resto del modelo, que mide ${num(L)} m en planta: ¿se tecleó mal una coordenada (en cm, o un cero de más)?`, [o.id], { distancia: d, extension: L });
  }
  return [reg];
}

// ─── Casi alineados ─────────────────────────────────────────────────────────────────────────────

/**
 * MA5 (`docs/fem3d/modelado.md` §7): pilares y vértices casi alineados según los ejes (a menos de
 * `casiAlineados` sin coincidir) y tramos casi rectos, con lo que les falta. Un dibujo calcado de un
 * DXF los trae, y la malla los resuelve con láminas de décimas de milímetro. La regla y la propuesta
 * de dónde llevarlos son las de «Alinear» (`editor/alinear.ts`).
 */
function alineados(f: ModeloFisico): Registro[] {
  const tol = UMBRALES.casiAlineados;
  const reg = new Registro("sensatez/casi-alineados", "Pilares y vértices alineados", `a menos de ${distancia(tol)} sin coincidir según la dirección de los ejes (pilares, vértices y tramos casi rectos), sin contar lo que comparte una cara`);
  if (!(f.pilares ?? []).length && !(f.vigas ?? []).length && !(f.losas ?? []).length && !(f.muros ?? []).length && !(f.panos ?? []).length) return [reg];
  reg.aplica();
  let grupos;
  try {
    grupos = gruposCasiAlineados(f, tol);
  } catch {
    // Un modelo con datos rotos (lo dice el compilador): sin esta comprobación
    return [reg];
  }
  const theta = grupos.length ? direccionEjes(f) : 0;
  for (const g of grupos) {
    reg.peor(g.falta, `${g.nombre} = ${num(g.valor, 5)}: les falta ${distancia(g.falta)}`);
    const ids = [...new Set(g.valores.flatMap((v) => v.objetos))].sort();
    reg.aviso(textoGrupo(g, theta), ids, { eje: g.nombre, valor: g.valor, falta: g.falta, valores: g.valores, ...(g.tramos.length ? { tramos: g.tramos } : {}), plantas: g.plantas });
  }
  return [reg];
}

// ─── Entrada ────────────────────────────────────────────────────────────────────────────────────

/**
 * Las comprobaciones que sólo necesitan el modelo físico (datos, cargas y pilares): no compilan, así
 * que `fem validar` las da aunque el modelo no compile (un espesor en cm suele acabar en un error
 * del compilador que no dice la causa). Un modelo con referencias rotas no las rompe: lo que no
 * encuentran, lo saltan (el error es del compilador).
 */
export function sensatezPrevia(f: ModeloFisico, opciones?: OpcionesCompilacion): Comprobacion[] {
  const P = new Plantas(f);
  const eps = opciones?.epsSnap ?? 0.05;
  return [...datos(f), ...lejanos(f), ...alineados(f), ...cargas(f), ...pilares(f, P, eps), ...bordes(f, P, eps)].map((r) => r.c);
}

export interface SensatezModelo {
  comprobaciones: Comprobacion[];
  pesoPropio: DesglosePesoPropio | null;
}

/**
 * Las comprobaciones que no necesitan el cálculo: datos, cargas, plantas, pilares y peso propio.
 * `res` es el resumen del modelo compilado (A1). `pesoCalculado`, lo calculado del peso propio si ya
 * se tiene o `"pendiente"` (si no se da, se compila: ~2 s en el edificio objetivo).
 */
export function sensatezModelo(f: ModeloFisico, opciones: OpcionesCompilacion | undefined, res: Resumen, pesoCalculado?: PesoCalculado): SensatezModelo {
  const P = new Plantas(f);
  const pp = pesoPropio(f, P, opciones, pesoCalculado);
  const eps = opciones?.epsSnap ?? 0.05;
  const regs = [...datos(f), ...lejanos(f), ...alineados(f), ...cargas(f), ...cargasPorM2(f, P, res), ...pilares(f, P, eps), ...bordes(f, P, eps), pp.registro];
  // El mismo orden que en el informe: datos, objetos lejos, casi alineados, cargas, cargas por planta, pilares, bordes y peso propio
  return { comprobaciones: regs.map((r) => r.c), pesoPropio: pp.desglose };
}

