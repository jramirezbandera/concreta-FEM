/**
 * Las herramientas de las piezas de V2c-2 (`docs/fem3d/dibujo.md` §2.4): Forjado, Hueco, Muro,
 * Apoyo y Apoyo lineal, como las de V2c-1 (`herramientas.ts`): máquinas de estados puras que reciben
 * los eventos de la vista ya enganchados y dan, al terminar, la `Operacion` (un paso de deshacer) con
 * lo mismo que daría su fila en la tabla.
 *
 * - **Forjado:** losa maciza, reticular o paño unidireccional, según la plantilla. Con «recuadro»
 *   (por defecto), un clic dentro de un recuadro cerrado por vigas, muros, apoyos lineales o bordes
 *   de forjado da su contorno por los ejes (`recuadros.ts`, V2c-c), desde el vértice más cercano al
 *   clic (el lado donde empiezan las viguetas de un unidireccional). Con «polígono», clic a clic;
 *   Intro, doble clic o un clic en el primer punto lo cierra.
 * - **Con zunchos** (por defecto, en una losa maciza o reticular y en un hueco de una losa): en el
 *   mismo paso, las vigas de borde de «Vigas de borde» (`vigasBorde.ts`) en los lados que no van sobre
 *   una viga, un muro, un apoyo lineal u otro forjado; en un hueco, sólo en los suyos. Un forjado
 *   cerrado por vigas no tiene ninguno libre y sale igual que sin la casilla.
 * - **Hueco:** el primer clic dice dónde va. En un forjado, un rectángulo (dos esquinas, en los ejes
 *   del ortogonal) o un polígono, dentro de su contorno. En un muro, dos clics por su eje dan las
 *   estaciones de sus bordes (en un tramo) y las alturas, las de la plantilla sobre el suelo de la
 *   planta de abajo (la del tramo de muro que llega a la planta de la vista).
 * - **Muro:** polilínea, como una viga; un clic en el primer punto lo cierra (un núcleo, que repite
 *   el primero). Con el eje en lo dibujado o con una cara (desplazado medio espesor).
 * - **Apoyo**, un clic, y **Apoyo lineal**, una polilínea, con lo que coaccionan en la plantilla.
 *
 * Las estaciones de un hueco de muro se redondean a 1e-9 m: no son puntos del modelo, sino distancias
 * a lo largo de él (8,4 − 6 es 2,4000000000000004).
 *
 * Puro: sin IO, sin React ni DOM.
 */
import { huellaMuro, PlantaFisica } from "../../agente/render/modelo.ts";
import { cotasPlantas } from "../../compilador/cotas.ts";
import type { ApoyoFisico, ApoyoLineal, HuecoMuro, Losa, ModeloFisico, Muro, PanoUnidireccional, Vec2 } from "../../compilador/fisico.ts";
import type { Seis } from "../../motor/modelo.ts";
import type { Operacion } from "../operaciones.ts";
import type { Objeto } from "../referencias.ts";
import { idNuevo, type TipoForjado } from "../tablas.ts";
import { unitario } from "./enganches.ts";
import { ESTADO_INICIAL, igual, plantasPilar, seccionValida, type Alinear, type Borrador, type ContextoHerramienta, type EstadoHerramienta, type Evento, type Paso, type Plantillas } from "./herramientas.ts";
import { contornoDesde, puntoEnPoligono, recuadroEn, recuadrosPlanta } from "./recuadros.ts";
import { operacionVigasBorde, proponerVigasBorde } from "../vigasBorde.ts";

export const PIEZAS = ["forjado", "hueco", "muro", "apoyo", "apoyoLineal"] as const;
export type NombrePieza = (typeof PIEZAS)[number];
export const esPieza = (h: string): h is NombrePieza => (PIEZAS as readonly string[]).includes(h);

export interface PlantillaForjado {
  /** Un clic dentro de un recuadro cerrado (por defecto) o un polígono a clics. */
  modo?: "recuadro" | "poligono";
  tipo?: TipoForjado;
  /** Canto total (maciza y reticular). */
  espesor?: number;
  material?: string;
  pp?: number;
  /** Eje 1 de la losa (nervios de un reticular) o dirección de las viguetas, ° desde +X. */
  direccion?: number;
  /** Reticular: entre nervios; unidireccional: entre viguetas. */
  intereje?: number;
  nervio?: number;
  capa?: number;
  caseton?: "perdido" | "recuperable";
  /** Unidireccional: la sección de la vigueta. */
  seccion?: string;
  /** Maciza y reticular: las vigas de borde en los lados libres (por defecto, sí). */
  zunchos?: boolean;
  /** Ancho de esas vigas, m (por defecto, `ANCHO_ZUNCHO`); el canto, el del forjado. */
  anchoZuncho?: number;
}

export interface PlantillaHueco {
  /** En un forjado: rectángulo (por defecto) o polígono. */
  modo?: "rectangulo" | "poligono";
  /** En un muro: alturas de sus bordes sobre el suelo de la planta de abajo, m (por defecto, 0 y 2,1). */
  z0?: number;
  z1?: number;
  /** En una losa: las vigas de borde en los lados del hueco (por defecto, sí), de este ancho. */
  zunchos?: boolean;
  anchoZuncho?: number;
}

/** Ancho por defecto de los zunchos, m (el de la regla de la skill). */
export const ANCHO_ZUNCHO = 0.3;

export interface PlantillaMuro {
  desde?: string;
  hasta?: string;
  espesor?: number;
  material?: string;
  base?: Muro["base"];
  /** Lo dibujado es el eje (por defecto) o su cara izquierda o derecha, según el sentido del dibujo. */
  alinear?: Alinear;
}

export interface PlantillaApoyo {
  coartados?: Seis<boolean>;
}

/** Lo que coacciona un apoyo, con su nombre (los de la plantilla). */
export const COARTADOS: Readonly<Record<"empotrado" | "articulado" | "uz", Seis<boolean>>> = {
  empotrado: [true, true, true, true, true, true],
  articulado: [true, true, true, false, false, false],
  uz: [false, false, true, false, false, false],
};

/** Huecos de muro por defecto: una puerta. */
export const HUECO_MURO = { z0: 0, z1: 2.1 } as const;

const r9 = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const hecho = (operacion: Operacion, etiqueta: string): Paso => ({ estado: ESTADO_INICIAL, hecho: { operacion, etiqueta } });
const crear = (coleccion: Extract<Operacion, { op: "crear" }>["coleccion"], objeto: object): Operacion => ({ op: "crear", coleccion, objeto: objeto as unknown as Objeto });

// ─── Lo común ───────────────────────────────────────────────────────────────────────────────────

/**
 * Una polilínea a clics: el mismo punto otra vez (el segundo clic de un doble clic) no añade nada;
 * con `cerrable`, un clic en el primero (con tres o más) la termina cerrada; Intro o doble clic la
 * terminan abierta; Retroceso quita el último.
 */
export function pasoPolilinea(e: EstadoHerramienta, ev: Evento, o: { min: number; cerrable: boolean; que: string; terminar: (ps: Vec2[], cerrada: boolean) => Paso }): Paso {
  switch (ev.tipo) {
    case "punto": {
      const ps = e.puntos;
      const u = ps[ps.length - 1];
      if (u && igual(u.p, ev.p)) return { estado: e };
      if (o.cerrable && ps.length >= 3 && igual(ps[0]!.p, ev.p)) return o.terminar(ps.map((x) => x.p), true);
      return { estado: { ...e, puntos: [...ps, { p: ev.p }] } };
    }
    case "retroceso":
      return { estado: { ...e, puntos: e.puntos.slice(0, -1) } };
    case "terminar":
      if (e.puntos.length < o.min) return { estado: e, ...(e.puntos.length ? { error: `${o.que} necesita al menos ${o.min} puntos.` } : {}) };
      return o.terminar(
        e.puntos.map((x) => x.p),
        false,
      );
    default:
      return { estado: e };
  }
}

/** El forjado de la planta en el que cae q (dentro de su contorno y fuera de sus huecos), o null. */
export function forjadoEn(m: ModeloFisico, planta: string, q: Vec2): { id: string; coleccion: "losas" | "panos"; f: Losa | PanoUnidireccional } | null {
  for (const [coleccion, xs] of [
    ["losas", m.losas],
    ["panos", m.panos],
  ] as const)
    for (const f of xs ?? []) if (f.planta === planta && puntoEnPoligono(q, f.contorno) && !(f.huecos ?? []).some((h) => puntoEnPoligono(q, h))) return { id: f.id, coleccion, f };
  return null;
}

/** Distancia de q al borde del polígono p. */
export function distBorde(q: Vec2, p: readonly Vec2[]): number {
  let d = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) d = Math.min(d, distTramo(q, p[j]!, p[i]!).d);
  return d;
}

/** Proyección de q en ab: el punto, su parámetro y la distancia. */
function distTramo(q: Vec2, a: Vec2, b: Vec2): { p: Vec2; t: number; d: number } {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
  const p: Vec2 = t === 0 ? a : t === 1 ? b : dx === 0 ? [a[0], q[1]] : dy === 0 ? [q[0], a[1]] : [a[0] + t * dx, a[1] + t * dy];
  return { p, t, d: dist(p, q) };
}

/** El punto de la polilínea más cercano a q: tramo, estación (sin redondear) y distancia. */
export function estacion(ps: readonly Vec2[], q: Vec2): { tramo: number; s: number; p: Vec2; d: number } {
  let mejor = { tramo: 0, s: 0, p: ps[0]!, d: Infinity };
  let s0 = 0;
  for (let i = 0; i + 1 < ps.length; i++) {
    const [a, b] = [ps[i]!, ps[i + 1]!];
    const x = distTramo(q, a, b);
    if (x.d < mejor.d) mejor = { tramo: i, s: s0 + dist(a, x.p), p: x.p, d: x.d };
    s0 += dist(a, b);
  }
  return mejor;
}

/**
 * La polilínea desplazada d en perpendicular (a la izquierda del sentido del dibujo si d > 0), con
 * los vértices en los cruces de los tramos desplazados; cerrada si repite el primero. Con tramos
 * paralelos a X o a Y, los números se suman tal cual.
 */
export function desplazar(ps: readonly Vec2[], d: number): Vec2[] {
  if (d === 0 || ps.length < 2) return [...ps];
  const cerrada = ps.length > 3 && igual(ps[0]!, ps[ps.length - 1]!);
  const base = cerrada ? ps.slice(0, -1) : ps;
  const n = base.length;
  const lineas = Array.from({ length: cerrada ? n : n - 1 }, (_, i) => {
    const [a, b] = [base[i]!, base[(i + 1) % n]!];
    const l = dist(a, b);
    const t: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const mover = (p: Vec2): Vec2 => [p[0] - d * t[1], p[1] + d * t[0]];
    return { a: mover(a), b: mover(b), t };
  });
  const corte = (u: (typeof lineas)[number], v: (typeof lineas)[number]): Vec2 => {
    if (u.t[1] === 0 && v.t[0] === 0) return [v.a[0], u.a[1]];
    if (u.t[0] === 0 && v.t[1] === 0) return [u.a[0], v.a[1]];
    const den = u.t[0] * v.t[1] - u.t[1] * v.t[0];
    if (Math.abs(den) < 1e-12) return v.a;
    const k = ((v.a[0] - u.a[0]) * v.t[1] - (v.a[1] - u.a[1]) * v.t[0]) / den;
    return [u.a[0] + k * u.t[0], u.a[1] + k * u.t[1]];
  };
  if (cerrada) {
    const r = lineas.map((v, i) => corte(lineas[(i - 1 + lineas.length) % lineas.length]!, v));
    return [...r, r[0]!];
  }
  return [lineas[0]!.a, ...lineas.slice(1).map((v, i) => corte(lineas[i]!, v)), lineas[lineas.length - 1]!.b];
}

const materialValido = (m: ModeloFisico, x: string | undefined) => !!x && m.materiales.some((y) => y.id === x);

// ─── Con zunchos ─────────────────────────────────────────────────────────────────────────────────

/**
 * `op` (que crea la losa o le pone un hueco; `losa`, como queda) y, en el mismo paso, sus vigas de
 * borde en los anillos `anillos`. Sin lados libres, `op` tal cual; si no se pueden poner, `op` con
 * un aviso.
 */
function conZunchos(ctx: ContextoHerramienta, op: Operacion, etiqueta: string, losa: Losa, ancho: number | undefined, anillos?: ReadonlySet<number>): Paso {
  const m = ctx.modelo;
  const losas = m.losas ?? [];
  const m2: ModeloFisico = { ...m, losas: losas.some((x) => x.id === losa.id) ? losas.map((x) => (x.id === losa.id ? losa : x)) : [...losas, losa] };
  const p = proponerVigasBorde(m2, losa.id, ancho ?? ANCHO_ZUNCHO, losa.espesor, undefined, anillos);
  if ("error" in p) return { estado: ESTADO_INICIAL, hecho: { operacion: op, etiqueta, avisos: [`Sin zunchos: ${p.error}`] } };
  const z = operacionVigasBorde(m2, p);
  if (!z || z.op !== "lote") return hecho(op, etiqueta);
  const avisos = [...p.avisos, ...(p.sueltas.length ? [`Las cargas puntuales ${p.sueltas.join(", ")} quedan en la banda del zuncho, fuera de la losa.`] : [])];
  const n = p.vigas.length;
  return { estado: ESTADO_INICIAL, hecho: { operacion: { op: "lote", operaciones: [op, ...z.operaciones] }, etiqueta: `${etiqueta} con ${n} ${n === 1 ? "zuncho" : "zunchos"}`, ...(avisos.length ? { avisos } : {}) } };
}

// ─── Forjado ────────────────────────────────────────────────────────────────────────────────────

/** El forjado de la plantilla con ese contorno, o por qué no. */
function forjadoCon(ctx: ContextoHerramienta, contorno: Vec2[]): Paso | string {
  const m = ctx.modelo;
  const t = ctx.plantillas.forjado ?? {};
  const tipo = t.tipo ?? "maciza";
  // Que no pise otro forjado: ningún vértice de uno dentro del otro
  for (const q of contorno) {
    const f = forjadoEn(m, ctx.planta, q);
    if (f && distBorde(q, f.f.contorno) > 1e-9) return `Se solaparía con el forjado ${f.id}.`;
  }
  for (const f of [...(m.losas ?? []), ...(m.panos ?? [])])
    if (f.planta === ctx.planta && f.contorno.some((q) => puntoEnPoligono(q, contorno) && distBorde(q, contorno) > 1e-9)) return `Se solaparía con el forjado ${f.id}.`;
  const positivo = (v: number | undefined) => v !== undefined && v > 0;
  if (tipo === "unidireccional") {
    if (!positivo(t.intereje)) return "Escriba en Propiedades el intereje de las viguetas.";
    if (!seccionValida(m, t.seccion)) return "Elija en Propiedades la sección de la vigueta (o cree una).";
    if (t.pp === undefined) return "Escriba en Propiedades el peso propio del forjado (con las bovedillas).";
    const id = idNuevo(m, "F");
    const pano: PanoUnidireccional = { id, planta: ctx.planta, contorno, direccion: t.direccion ?? 0, intereje: t.intereje!, seccion: t.seccion!, pp: t.pp };
    return hecho(crear("panos", pano), `Forjado ${id} (unidireccional)`);
  }
  if (!positivo(t.espesor)) return "Escriba en Propiedades el canto del forjado.";
  if (!materialValido(m, t.material)) return "Elija en Propiedades el material del forjado (o cree uno).";
  let reticular: Losa["reticular"];
  if (tipo === "reticular") {
    if (!positivo(t.intereje) || !positivo(t.nervio) || !positivo(t.capa)) return "Escriba en Propiedades el intereje, el nervio y la capa del reticular.";
    if (t.caseton !== "recuperable" && t.pp === undefined) return "Con casetón perdido, escriba en Propiedades el peso propio del reticular.";
    reticular = { intereje: t.intereje!, nervio: t.nervio!, capa: t.capa!, ...(t.caseton === "recuperable" ? { caseton: t.caseton } : {}) };
  }
  const id = idNuevo(m, "L");
  const losa: Losa = { id, planta: ctx.planta, contorno, espesor: t.espesor!, material: t.material!, ...(t.pp !== undefined ? { pp: t.pp } : {}), ...(t.direccion ? { eje1: t.direccion } : {}), ...(reticular ? { reticular } : {}) };
  const etiqueta = `Forjado ${id} (${tipo})`;
  return t.zunchos === false ? hecho(crear("losas", losa), etiqueta) : conZunchos(ctx, crear("losas", losa), etiqueta, losa, t.anchoZuncho);
}

const comoPaso = (e: EstadoHerramienta, r: Paso | string): Paso => (typeof r === "string" ? { estado: e, error: r } : r);

/** El contorno del recuadro que encierra q (sin forjado), o por qué no. */
function recuadroPara(ctx: ContextoHerramienta, q: Vec2): Vec2[] | string {
  const ya = forjadoEn(ctx.modelo, ctx.planta, q);
  if (ya) return `Ya hay un forjado (${ya.id}) ahí.`;
  const r = recuadroEn(recuadrosPlanta(ctx.modelo, ctx.planta, ctx.indice), q);
  if (!r) return "Ahí no hay ningún recuadro cerrado por vigas, muros, apoyos lineales o bordes de forjado: dibújelo como polígono (Propiedades).";
  if (!r.simple) return "Ese recuadro no es un polígono simple (lo cruza una pieza suelta): dibújelo como polígono (Propiedades).";
  return contornoDesde(r.anillo, q);
}

function pasoForjado(e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  const t = ctx.plantillas.forjado ?? {};
  if ((t.modo ?? "recuadro") === "recuadro") {
    if (ev.tipo !== "punto") return { estado: e };
    const c = recuadroPara(ctx, ev.cursor ?? ev.p);
    return comoPaso(e, typeof c === "string" ? c : forjadoCon(ctx, c));
  }
  return pasoPolilinea(e, ev, { min: 3, cerrable: true, que: "Un forjado", terminar: (ps) => comoPaso(e, forjadoCon(ctx, ps)) });
}

// ─── Hueco ──────────────────────────────────────────────────────────────────────────────────────

/** El rectángulo de esquinas a y c en los ejes del ortogonal (antihorario, desde a si a es la de abajo a la izquierda). */
export function rectangulo(a: Vec2, c: Vec2, direccion: number): Vec2[] {
  const d = unitario(direccion);
  const n: Vec2 = [-d[1] + 0, d[0]];
  const u = (c[0] - a[0]) * d[0] + (c[1] - a[1]) * d[1];
  const v = (c[0] - a[0]) * n[0] + (c[1] - a[1]) * n[1];
  const b: Vec2 = d[1] === 0 ? [c[0], a[1]] : d[0] === 0 ? [a[0], c[1]] : [a[0] + u * d[0], a[1] + u * d[1]];
  const e: Vec2 = d[1] === 0 ? [a[0], c[1]] : d[0] === 0 ? [c[0], a[1]] : [a[0] + v * n[0], a[1] + v * n[1]];
  // Antihorario: con u·v < 0 se recorre al revés
  return u * v >= 0 ? [a, b, c, e] : [a, e, c, b];
}

/** El muro de la planta bajo q (a menos de su medio espesor más el radio), o null. */
export function muroEn(ctx: ContextoHerramienta, q: Vec2, radio: number): Muro | null {
  const s = ctx.indice.siluetas.filter((x) => x.tipo === "muro" && x.distancia(q, radio) <= radio).sort((a, b) => a.distancia(q, radio) - b.distancia(q, radio))[0];
  return s ? (ctx.modelo.muros?.find((w) => w.id === s.id) ?? null) : null;
}

/** El hueco del muro w entre p y q (sus estaciones, en un tramo) con las alturas de la plantilla. */
function huecoMuro(ctx: ContextoHerramienta, w: Muro, p: Vec2, q: Vec2): Paso | string {
  const m = ctx.modelo;
  const t = ctx.plantillas.hueco ?? {};
  const [z0, z1] = [t.z0 ?? HUECO_MURO.z0, t.z1 ?? HUECO_MURO.z1];
  if (!(z1 > z0)) return "En Propiedades, la altura de arriba del hueco tiene que ser mayor que la de abajo.";
  // Los tramos en los que está cada punto (en un vértice, los dos)
  const tramos = (x: Vec2) => {
    const r = new Set<number>();
    for (let i = 0; i + 1 < w.puntos.length; i++) if (distTramo(x, w.puntos[i]!, w.puntos[i + 1]!).d <= 1e-9) r.add(i);
    return r;
  };
  const [ta, tb] = [tramos(p), tramos(q)];
  const k = [...ta].find((i) => tb.has(i));
  if (k === undefined) return "El hueco tiene que quedar en un solo tramo del muro.";
  let s0 = 0;
  for (let i = 0; i < k; i++) s0 += dist(w.puntos[i]!, w.puntos[i + 1]!);
  const a = w.puntos[k]!;
  const [sa, sb] = [s0 + dist(a, p), s0 + dist(a, q)].sort((x, y) => x - y) as [number, number];
  if (!(sb > sa)) return "Los dos bordes del hueco son el mismo punto.";
  // Las alturas, desde el suelo del tramo de muro de la planta de la vista
  const pl = new PlantaFisica(m, ctx.planta);
  const { llega } = pl.vertical(w);
  const suelo = llega ? m.plantas[pl.k + 1]?.id : ctx.planta;
  const cotas = cotasPlantas(m.plantas);
  const cota = (id: string | undefined) => cotas[m.plantas.findIndex((x) => x.id === id)] ?? null;
  const [cs, cb] = [cota(suelo), cota(w.desde)];
  const sube = suelo === w.desde || cs === null || cb === null ? 0 : cs - cb;
  const h: HuecoMuro = { desde: r9(sa), hasta: r9(sb), z0: sube ? r9(z0 + sube) : z0, z1: sube ? r9(z1 + sube) : z1 };
  return hecho({ op: "cambiar", coleccion: "muros", id: w.id, objeto: { ...w, huecos: [...(w.huecos ?? []), h] } as unknown as Objeto }, `Hueco en el muro ${w.id}`);
}

/** El hueco del forjado `id` con ese polígono, o por qué no. */
function huecoForjado(ctx: ContextoHerramienta, id: string, anillo: Vec2[]): Paso | string {
  const m = ctx.modelo;
  const coleccion = m.losas?.some((x) => x.id === id) ? "losas" : "panos";
  const f = (coleccion === "losas" ? m.losas : m.panos)?.find((x) => x.id === id);
  if (!f) return `No está el forjado ${id}.`;
  for (const q of anillo) {
    if (!puntoEnPoligono(q, f.contorno) || distBorde(q, f.contorno) <= 1e-9) return `El hueco tiene que quedar dentro del forjado ${id}, sin tocar su borde.`;
    if ((f.huecos ?? []).some((h) => puntoEnPoligono(q, h) || distBorde(q, h) <= 1e-9)) return `El hueco no puede tocar otro hueco del forjado ${id}.`;
  }
  const nuevo = { ...f, huecos: [...(f.huecos ?? []), anillo] };
  const op: Operacion = { op: "cambiar", coleccion, id, objeto: nuevo as unknown as Objeto };
  const t = ctx.plantillas.hueco ?? {};
  // El hueco nuevo es el último anillo (0, el contorno)
  if (coleccion === "panos" || t.zunchos === false) return hecho(op, `Hueco en el forjado ${id}`);
  return conZunchos(ctx, op, `Hueco en el forjado ${id}`, nuevo as Losa, t.anchoZuncho, new Set([nuevo.huecos.length]));
}

function pasoHueco(e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  const m = ctx.modelo;
  const t = ctx.plantillas.hueco ?? {};
  const muro = e.objeto ? m.muros?.find((w) => w.id === e.objeto) : undefined;
  if (ev.tipo === "punto" && !e.puntos.length) {
    const q = ev.cursor ?? ev.p;
    const w = muroEn(ctx, q, ev.radio ?? 0);
    if (w) return { estado: { puntos: [{ p: estacion(w.puntos, ev.p).p }], objeto: w.id, enMuro: true } };
    const f = forjadoEn(m, ctx.planta, q);
    if (f) return { estado: { puntos: [{ p: ev.p }], objeto: f.id } };
    return { estado: e, error: "Un hueco va dentro de un forjado o en un muro de la planta: haga clic en uno." };
  }
  if (ev.tipo === "retroceso") return { estado: e.puntos.length > 1 ? { ...e, puntos: e.puntos.slice(0, -1) } : ESTADO_INICIAL };
  if (muro) {
    if (ev.tipo !== "punto") return { estado: e };
    const q = estacion(muro.puntos, ev.p).p;
    if (igual(q, e.puntos[0]!.p)) return { estado: e };
    return comoPaso(e, huecoMuro(ctx, muro, e.puntos[0]!.p, q));
  }
  if (!e.objeto) return { estado: e };
  if ((t.modo ?? "rectangulo") === "rectangulo") {
    if (ev.tipo !== "punto" || igual(ev.p, e.puntos[0]!.p)) return { estado: e };
    const r = rectangulo(e.puntos[0]!.p, ev.p, ctx.indice.direccion);
    if (r.some((x, i) => i && igual(x, r[0]!)) || igual(r[1]!, r[2]!)) return { estado: e, error: "Las dos esquinas del rectángulo están en una misma recta de los ejes." };
    return comoPaso(e, huecoForjado(ctx, e.objeto, r));
  }
  return pasoPolilinea(e, ev, { min: 3, cerrable: true, que: "Un hueco", terminar: (ps) => comoPaso(e, huecoForjado(ctx, e.objeto!, ps)) });
}

// ─── Muro, apoyo y apoyo lineal ─────────────────────────────────────────────────────────────────

/** El eje del muro de la plantilla para lo dibujado (cerrado si `cerrada`). */
function ejeMuro(ctx: ContextoHerramienta, ps: readonly Vec2[], cerrada: boolean): Vec2[] {
  const t = ctx.plantillas.muro ?? {};
  const puntos = cerrada ? [...ps, ps[0]!] : [...ps];
  const e = t.espesor ?? 0;
  // La cara izquierda en lo dibujado: el eje, a la derecha
  if (t.alinear === "izquierda") return desplazar(puntos, -e / 2);
  if (t.alinear === "derecha") return desplazar(puntos, e / 2);
  return puntos;
}

function muroCon(ctx: ContextoHerramienta, ps: Vec2[], cerrada: boolean): Paso | string {
  const m = ctx.modelo;
  const t = ctx.plantillas.muro ?? {};
  const pl = plantasPilar(m, ctx.planta, t, "del muro");
  if (!pl.ok) return pl.mensaje;
  if (!(t.espesor !== undefined && t.espesor > 0)) return "Escriba en Propiedades el espesor del muro.";
  if (!materialValido(m, t.material)) return "Elija en Propiedades el material del muro (o cree uno).";
  const id = idNuevo(m, "M");
  const w: Muro = { id, puntos: ejeMuro(ctx, ps, cerrada), desde: pl.desde, hasta: pl.hasta, espesor: t.espesor, material: t.material!, ...(t.base && t.base !== "empotrado" ? { base: t.base } : {}) };
  return hecho(crear("muros", w), `Muro ${id}${cerrada ? " (cerrado)" : ""}`);
}

function pasoApoyo(e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  if (ev.tipo !== "punto") return { estado: e };
  const m = ctx.modelo;
  const ya = m.apoyos?.find((a) => a.planta === ctx.planta && a.x === ev.p[0] && a.y === ev.p[1]);
  if (ya) return { estado: e, error: `Ya hay un apoyo (${ya.id}) en ese punto.` };
  const id = idNuevo(m, "A");
  const a: ApoyoFisico = { id, planta: ctx.planta, x: ev.p[0], y: ev.p[1], coartados: ctx.plantillas.apoyo?.coartados ?? COARTADOS.empotrado };
  return hecho(crear("apoyos", a), `Apoyo ${id}`);
}

function pasoApoyoLineal(e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  return pasoPolilinea(e, ev, {
    min: 2,
    cerrable: true,
    que: "Un apoyo lineal",
    terminar: (ps, cerrada) => {
      const id = idNuevo(ctx.modelo, "AL");
      const a: ApoyoLineal = { id, planta: ctx.planta, puntos: cerrada ? [...ps, ps[0]!] : ps, coartados: ctx.plantillas.apoyoLineal?.coartados ?? COARTADOS.uz };
      return hecho(crear("apoyosLineales", a), `Apoyo lineal ${id}`);
    },
  });
}

export function pasoPieza(h: NombrePieza, e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  switch (h) {
    case "forjado":
      return pasoForjado(e, ev, ctx);
    case "hueco":
      return pasoHueco(e, ev, ctx);
    case "muro":
      return pasoPolilinea(e, ev, { min: 2, cerrable: true, que: "Un muro", terminar: (ps, cerrada) => comoPaso(e, muroCon(ctx, ps, cerrada)) });
    case "apoyo":
      return pasoApoyo(e, ev, ctx);
    case "apoyoLineal":
      return pasoApoyoLineal(e, ev, ctx);
  }
}

// ─── Borrador y ayuda ───────────────────────────────────────────────────────────────────────────

/** La polilínea en curso hasta el cursor; cerrada hasta el primero, si `cerrar`. */
export function borradorPolilinea(e: EstadoHerramienta, cursor: Vec2 | null, r: Borrador, cerrar: boolean): Vec2[] {
  if (!e.puntos.length) return [];
  const ps = e.puntos.map((x) => x.p);
  if (cursor && !igual(cursor, ps[ps.length - 1]!)) ps.push(cursor);
  r.lineas.push(cerrar && ps.length > 2 ? [...ps, ps[0]!] : ps);
  return ps;
}

export function borradorPieza(h: NombrePieza, e: EstadoHerramienta, cursor: Vec2 | null, ctx: ContextoHerramienta, r: Borrador, crudo: Vec2 | null): void {
  const m = ctx.modelo;
  if (h === "forjado") {
    if ((ctx.plantillas.forjado?.modo ?? "recuadro") === "recuadro") {
      const q = crudo ?? cursor;
      const c = q ? recuadroPara(ctx, q) : null;
      if (c && typeof c !== "string") r.anillos.push(c);
    } else borradorPolilinea(e, cursor, r, true);
  } else if (h === "hueco") {
    const muro = e.objeto ? m.muros?.find((w) => w.id === e.objeto) : undefined;
    if (muro && cursor) r.lineas.push([e.puntos[0]!.p, estacion(muro.puntos, cursor).p]);
    else if (e.objeto && (ctx.plantillas.hueco?.modo ?? "rectangulo") === "rectangulo") {
      if (cursor && !igual(cursor, e.puntos[0]!.p)) r.anillos.push(rectangulo(e.puntos[0]!.p, cursor, ctx.indice.direccion));
    } else borradorPolilinea(e, cursor, r, true);
  } else if (h === "muro") {
    const ps = borradorPolilinea(e, cursor, r, false);
    const t = ctx.plantillas.muro ?? {};
    if (ps.length > 1 && t.espesor) {
      const cerrada = ps.length > 3 && igual(ps[0]!, ps[ps.length - 1]!);
      r.anillos.push(...huellaMuro(ejeMuro(ctx, cerrada ? ps.slice(0, -1) : ps, cerrada), t.espesor));
    }
  } else if (h === "apoyoLineal") borradorPolilinea(e, cursor, r, false);
}

const nPuntos = (e: EstadoHerramienta) => `${e.puntos.length} puesto${e.puntos.length > 1 ? "s" : ""}`;

export function ayudaPieza(h: NombrePieza, e: EstadoHerramienta, t: Plantillas): string {
  const n = e.puntos.length;
  switch (h) {
    case "forjado":
      if ((t.forjado?.modo ?? "recuadro") === "recuadro") return "Forjado: un clic dentro de un recuadro cerrado por vigas, muros o bordes (o polígono, en Propiedades). Esc vuelve a Elegir.";
      return n ? `Forjado: el vértice siguiente (${nPuntos(e)}). Intro, doble clic o un clic en el primero lo cierra; Retroceso quita el último; Esc anula.` : "Forjado: el primer vértice. Esc vuelve a Elegir.";
    case "hueco":
      if (!n) return "Hueco: un clic en el forjado o en el muro donde va. Esc vuelve a Elegir.";
      if (e.enMuro) return `Hueco en el muro ${e.objeto}: el otro borde, por su eje y en el mismo tramo. Esc anula.`;
      return (t.hueco?.modo ?? "rectangulo") === "rectangulo" ? `Hueco en ${e.objeto}: la otra esquina. Esc anula.` : `Hueco en ${e.objeto}: el vértice siguiente (${nPuntos(e)}); Intro o un clic en el primero lo cierra. Esc anula.`;
    case "muro":
      return n ? `Muro: el punto siguiente (${nPuntos(e)}). Doble clic o Intro termina; un clic en el primero lo cierra; Retroceso quita el último; Esc anula.` : "Muro: el primer punto. Esc vuelve a Elegir.";
    case "apoyo":
      return "Apoyo: un clic donde va. Esc vuelve a Elegir.";
    case "apoyoLineal":
      return n ? `Apoyo lineal: el punto siguiente (${nPuntos(e)}). Doble clic o Intro termina; Retroceso quita el último; Esc anula.` : "Apoyo lineal: el primer punto. Esc vuelve a Elegir.";
  }
}
