/**
 * Comprobaciones de sensatez del modelo (A3, `docs/fem3d/agente.md` §3 y §8): oráculos del
 * MODELO, no del motor. El motor puede calcular bien un modelo equivocado (una carga en N, un
 * espesor en cm, un pilar que falta), y eso es un fallo silencioso como cualquier otro.
 *
 * - Dan avisos (`sensatez/…`), nunca errores: un valor raro puede ser legítimo (una viga de
 *   transición, un voladizo). El ingeniero los revisa en el informe (`informe.ts`) y lo firma.
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
import { compilar } from "../compilador/compilar.ts";
import { resultanteAnalitica } from "../compilador/cargas.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import type { CargaFisica, CasoFisico, Losa, Material, ModeloFisico, OpcionesCompilacion, Seccion, Vec2 } from "../compilador/fisico.ts";
import { momentosInterseccion, puntoEnRegion, type Region } from "../compilador/poligonos.ts";
import type { TipoAccion } from "../combinaciones/generador.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { cargasPorPlanta, type Resumen } from "./consultas.ts";

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
} as const;

/** Acciones que no son gravitatorias: no entran en la «gravedad» ni en las cargas por uso. */
export const ACCIONES_NO_GRAVITATORIAS: readonly TipoAccion[] = ["W", "E", "T", "N", "A"];

export type EstadoComprobacion = "bien" | "avisos" | "no-aplica";

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
    const r: [number, number] = ultima ? [0, U.altura[1]] : [U.altura[0], U.altura[1]];
    alt.peor(salida(p.altura, r), `${p.id}: ${num(p.altura)} m`);
    if (fuera(p.altura, r)) alt.aviso(`La planta ${p.id} tiene ${num(p.altura)} m de altura (${rango(r, "m")}): ¿está en cm o es la de otra planta?`, [p.id], { valor: p.altura });
  });

  const esp = new Registro("sensatez/espesor", "Espesor de losas y muros", rango(U.espesor, "m"));
  for (const x of [...(f.losas ?? []), ...(f.muros ?? [])]) {
    const que = "contorno" in x ? "losa" : "muro";
    esp.peor(salida(x.espesor, U.espesor), `${x.id}: ${num(x.espesor)} m`);
    if (fuera(x.espesor, U.espesor)) esp.aviso(`El ${que} ${x.id} tiene ${num(x.espesor)} m de espesor (${rango(U.espesor, "m")}): ¿está en cm?`, [x.id], { valor: x.espesor });
  }

  const sec = new Registro("sensatez/seccion", "Dimensiones de las secciones", `${rango(U.dimension, "m")} (bw y hf de una T, ${rango(U.dimensionFina, "m")})`);
  for (const s of f.secciones) {
    const dims: [string, number, readonly [number, number]][] =
      s.forma === "rectangular"
        ? [
            ["b", s.b, U.dimension],
            ["h", s.h, U.dimension],
          ]
        : s.forma === "circular"
          ? [["D", s.D, U.dimension]]
          : s.forma === "T"
            ? [
                ["bf", s.bf, U.dimension],
                ["h", s.h, U.dimension],
                ["bw", s.bw, U.dimensionFina],
                ["hf", s.hf, U.dimensionFina],
              ]
            : s.forma === "general"
              ? ([
                  ["b", s.b, U.dimension],
                  ["h", s.h, U.dimension],
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
      return [c.q[2]];
    case "viga": // z local = +Z
      return [c.q[2], ...(c.qb ? [c.qb[2]] : [])];
    case "pilar": // x local hacia arriba
      return c.ejes === "global" ? [c.q[2], ...(c.qb ? [c.qb[2]] : [])] : [c.q[0], ...(c.qb ? [c.qb[0]] : [])];
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
  const pesan = f.materiales.some((m) => gammaMaterial(m) > 0) || (f.panos ?? []).some((x) => x.pp > 0) || (f.losas ?? []).some((l) => (l.pp ?? 0) > 0);
  const conPiezas = [f.pilares, f.vigas, f.losas, f.muros, f.panos].some((x) => x?.length);
  if (conPiezas && pesan) {
    sinPP.aplica();
    if (!f.casos.some((c) => c.pesoPropio)) sinPP.aviso("Ningún caso lleva `pesoPropio`: las piezas no pesan en el cálculo.", f.casos.map((c) => c.id));
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
  return [sinPP, vacio, dup, arriba];
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
    const sigue = (f.pilares ?? []).some((q) => q !== p && q.desde === p.hasta && Math.hypot(q.x - p.x, q.y - p.y) <= epsSnap);
    if (sigue) continue;
    const cubre = [...(f.losas ?? []), ...(f.panos ?? [])].find((x) => x.planta === encima && puntoEnRegion([p.x, p.y], regionDe(x)));
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

/** Canto de una viga de canto h que queda en el punto q de la planta bajo su losa o su paño (C2-g): h menos lo que ocupan ellos. */
export function cantoLibre(f: ModeloFisico, planta: string, q: Vec2, h: number): number {
  const l = (f.losas ?? []).find((x) => x.planta === planta && puntoEnRegion(q, regionDe(x)));
  if (l) return h - Math.min(h, l.espesor);
  const pn = (f.panos ?? []).find((x) => x.planta === planta && puntoEnRegion(q, regionDe(x)));
  const s = pn && f.secciones.find((x) => x.id === pn.seccion);
  const hv = s ? cantoSeccion(s) : null;
  return hv ? h - Math.min(h, hv) : h;
}

/**
 * Peso propio esperado por planta y tipo de pieza, sin la malla: Σ V·γ con el pp de las losas y
 * los paños, menos los solapes que el compilador descuenta (C2-g: una viga rectangular de
 * hormigón bajo una losa o un paño pesa sólo su descuelgue; C3-g: el muro, menos su solape con
 * las losas, la mitad por cada lado de la planta al que llega). Estos se estiman por la huella de
 * la pieza (su eje con su ancho) dentro de las losas. El pilar no descuenta su solape (A-9).
 */
export function pesoPropioEsperado(f: ModeloFisico, P: Plantas, eps = 0.05): Omit<PesoPropioPlanta, "calculado">[] {
  const material = new Map(f.materiales.map((m) => [m.id, m]));
  const seccion = new Map(f.secciones.map((s) => [s.id, s]));
  const r = new Map(P.ids.map((id) => [id, { planta: id, pilares: 0, vigas: 0, losas: 0, panos: 0, muros: 0, solapes: 0, esperado: 0 }]));
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
  for (const v of f.vigas ?? []) {
    const w = pesoSeccion(v.seccion);
    if (!w) continue;
    const x = r.get(v.planta)!;
    x.vigas += w.w * longitud(v.puntos);
    if (w.s.forma !== "rectangular" || w.m.tipo !== "hormigon") continue;
    // C2-g: bajo una losa o un paño, sólo el descuelgue
    const gamma = gammaMaterial(w.m);
    const k = P.indice.get(v.planta)!;
    for (const t of tramos(v.puntos)) {
      const huella = huellaTramo(t, w.s.b);
      for (const l of losasEn(v.planta)) x.solapes += momentosInterseccion(regionDe(l), huella).A * Math.min(w.s.h, l.espesor) * gamma;
      for (const pn of panosEn(v.planta)) {
        const h = seccion.get(pn.seccion);
        const hv = h ? cantoSeccion(h) : null;
        if (hv) x.solapes += momentosInterseccion(regionDe(pn), huella).A * Math.min(w.s.h, hv) * gamma;
      }
      // A-9: por el eje de un muro que le llega desde abajo, sólo lo que sobresale de él
      for (const o of sobreMuros(t, k, f, P, eps)) {
        const sm = (o.desde + o.hasta) / 2;
        const { b, h } = w.s;
        const hl = [1, -1].reduce((suma, lado) => suma + cantoLibre(f, v.planta, [t.A[0] + t.u[0] * sm - (lado * t.u[1] * b) / 4, t.A[1] + t.u[1] * sm + (lado * t.u[0] * b) / 4], h), 0);
        x.solapes += ((gamma * Math.min(b, o.t)) / 2) * hl * (o.hasta - o.desde);
      }
    }
  }
  for (const l of f.losas ?? []) {
    const m = material.get(l.material);
    if (m) r.get(l.planta)!.losas += pesoLosa(l, m);
  }
  for (const pn of f.panos ?? []) r.get(pn.planta)!.panos += pn.pp * areaRegion(pn);
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
    // C3-g: el solape con las losas de cada planta a la que llega, la mitad por cada lado
    const kh = ks[0]!;
    const kb = ks[ks.length - 1]! + 1;
    for (let k = kh; k <= kb; k++) {
      const lados = (k < kb ? 0.5 : 0) + (k > kh ? 0.5 : 0);
      if (!lados) continue;
      for (const l of losasEn(P.ids[k]!))
        for (const t of tramos(m.puntos)) r.get(P.ids[k]!)!.solapes += momentosInterseccion(regionDe(l), huellaTramo(t, m.espesor)).A * l.espesor * gammaMaterial(mat) * lados;
    }
  }
  for (const x of r.values()) x.esperado = x.pilares + x.vigas + x.losas + x.panos + x.muros - x.solapes;
  return [...r.values()];
}

/**
 * Peso de una losa, kN: su pp por su área o, sin él, γ·e (maciza) o, en un reticular con casetón
 * recuperable (C4-i), γ·volumen en la zona aligerada y γ·e en los ábacos.
 */
export function pesoLosa(l: Losa, m: Material): number {
  const g = gammaMaterial(m);
  const A = areaRegion(l);
  if (l.pp !== undefined) return l.pp * A;
  if (!l.reticular) return g * l.espesor * A;
  const { intereje: s, nervio: bw, capa: hf } = l.reticular;
  const vol = hf + (l.espesor - hf) * (1 - ((s - bw) / s) ** 2);
  const Aab = (l.reticular.abacos ?? []).reduce((t, ab) => t + Math.abs(momentosInterseccion(regionDe(l), ab).A), 0);
  return g * (vol * (A - Aab) + l.espesor * Aab);
}

/**
 * Peso propio del cálculo por planta: el caso de peso propio compilado sin las demás cargas, con
 * el reparto por planta del resumen. Una compilación más (sin cargas, la misma malla salvo lo que
 * siembran las cargas, que no cambia el peso).
 */
export function pesoPropioCalculado(f: ModeloFisico, opciones: OpcionesCompilacion | undefined): Map<string, number> | null {
  const caso = f.casos.find((c) => c.pesoPropio);
  if (!caso) return null;
  const c = compilar({ ...f, casos: [caso], cargas: [] }, opciones);
  if (!c.valido) return null;
  const ids = f.plantas.map((p) => p.id);
  const r = new Map<string, number>();
  for (const [id, sub] of cargasPorPlanta(c, ids)) r.set(id, -resultanteAnalitica(sub, 0, [0, 0, 0]).F[2]);
  return r;
}

function pesoPropio(f: ModeloFisico, P: Plantas, opciones: OpcionesCompilacion | undefined): { registro: Registro; desglose: DesglosePesoPropio | null } {
  const U = UMBRALES;
  const reg = new Registro("sensatez/peso-propio", "Peso propio calculado frente al esperado", `difieren más de un ${num(U.pesoPropio * 100)} % (por planta y en total)`);
  const caso = f.casos.find((c) => c.pesoPropio);
  if (!caso) return { registro: reg, desglose: null };
  const calc = pesoPropioCalculado(f, opciones);
  const plantas: PesoPropioPlanta[] = pesoPropioEsperado(f, P, opciones?.epsSnap).map((x) => ({ ...x, calculado: calc ? (calc.get(x.planta) ?? 0) : null }));
  const total = { pilares: 0, vigas: 0, losas: 0, panos: 0, muros: 0, solapes: 0, esperado: 0, calculado: calc ? 0 : null } as DesglosePesoPropio["total"];
  for (const x of plantas)
    for (const k of ["pilares", "vigas", "losas", "panos", "muros", "solapes", "esperado"] as const) total[k] += x[k];
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
  return { registro: reg, desglose: { caso: caso.id, plantas, total } };
}

// ─── Entrada ────────────────────────────────────────────────────────────────────────────────────

/**
 * Las comprobaciones que sólo necesitan el modelo físico (datos, cargas y pilares): no compilan, así
 * que `fem validar` las da aunque el modelo no compile (un espesor en cm suele acabar en un error
 * del compilador que no dice la causa). Un modelo con referencias rotas no las rompe: lo que no
 * encuentran, lo saltan (el error es del compilador).
 */
export function sensatezPrevia(f: ModeloFisico, opciones?: OpcionesCompilacion): Comprobacion[] {
  return [...datos(f), ...cargas(f), ...pilares(f, new Plantas(f), opciones?.epsSnap ?? 0.05)].map((r) => r.c);
}

export interface SensatezModelo {
  comprobaciones: Comprobacion[];
  pesoPropio: DesglosePesoPropio | null;
}

/**
 * Las comprobaciones que no necesitan el cálculo: datos, cargas, plantas, pilares y peso propio.
 * `res` es el resumen del modelo compilado (A1).
 */
export function sensatezModelo(f: ModeloFisico, opciones: OpcionesCompilacion | undefined, res: Resumen): SensatezModelo {
  const P = new Plantas(f);
  const pp = pesoPropio(f, P, opciones);
  const regs = [...datos(f), ...cargas(f), ...cargasPorM2(f, P, res), ...pilares(f, P, opciones?.epsSnap ?? 0.05), pp.registro];
  // El mismo orden que en el informe: datos, cargas, cargas por planta, pilares y peso propio
  return { comprobaciones: regs.map((r) => r.c), pesoPropio: pp.desglose };
}

