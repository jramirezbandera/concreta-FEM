/**
 * Las herramientas de las cargas de V2c-2 (`docs/fem3d/dibujo.md` §2.4), en el caso activo de la
 * barra de Cargas, como las demás (`herramientas.ts`): dan, al terminar, la `Operacion` que crea la
 * carga, con lo mismo que su fila en la tabla.
 *
 * - **Puntual:** un clic (F y M de la plantilla, en ejes globales).
 * - **Lineal:** polilínea; un clic en el primer punto la cierra (repite el primero).
 * - **Superficie:** con «forjado» (por defecto), un clic dentro de una losa o un paño la pone en todo
 *   él; con «zona», un polígono, que lleva su forjado si cae entero en uno (la parte de ese forjado
 *   en la zona, como en la tabla).
 * - **En barra:** un clic en una viga o un pilar (la pieza entera); con «tramo», dos clics en la
 *   misma viga dan sus estaciones (redondeadas a 1e-9 m, como las de un hueco de muro).
 * - **Empuje:** un clic en un muro, del lado del terreno (el del clic, mirando de su primer punto al
 *   último).
 *
 * Puro: sin IO, sin React ni DOM.
 */
import type { CargaFisica, Vec2 } from "../../compilador/fisico.ts";
import type { Vec3 } from "../../motor/modelo.ts";
import type { Operacion } from "../operaciones.ts";
import type { Objeto } from "../referencias.ts";
import { idNuevo } from "../tablas.ts";
import { ESTADO_INICIAL, igual, type Borrador, type ContextoHerramienta, type EstadoHerramienta, type Evento, type Paso, type Plantillas } from "./herramientas.ts";
import { borradorPolilinea, desplazar, distBorde, estacion, forjadoEn, muroEn, pasoPolilinea } from "./piezas.ts";
import { puntoEnPoligono } from "./recuadros.ts";

export const CARGAS = ["puntual", "lineal", "superficie", "barra", "empuje"] as const;
export type NombreCarga = (typeof CARGAS)[number];
export const esCarga = (h: string): h is NombreCarga => (CARGAS as readonly string[]).includes(h);

export interface PlantillaCargas {
  /** El caso activo de la barra. */
  caso?: string;
  puntual?: { F?: Vec3; M?: Vec3 };
  lineal?: { q?: Vec3 };
  superficie?: { q?: Vec3; modo?: "forjado" | "zona" };
  barra?: { q?: Vec3; qb?: Vec3; ejes?: "global" | "local"; modo?: "entera" | "tramo" };
  empuje?: { z0?: number; z1?: number; p0?: number; p1?: number };
}

const r9 = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
const noNulo = (v: Vec3 | undefined): v is Vec3 => !!v && v.some((x) => x !== 0);

/** La carga con el id y el caso, o por qué no. */
function carga(ctx: ContextoHerramienta, c: Record<string, unknown> & { tipo: CargaFisica["tipo"] }, que: string): Paso | string {
  const caso = ctx.plantillas.cargas?.caso;
  if (!caso || !ctx.modelo.casos.some((x) => x.id === caso)) return "Elija el caso activo en la barra (o cree uno con Casos).";
  const id = idNuevo(ctx.modelo, "Q");
  const objeto = { ...c, id, caso } as unknown as Objeto;
  const op: Operacion = { op: "crear", coleccion: "cargas", objeto };
  return { estado: ESTADO_INICIAL, hecho: { operacion: op, etiqueta: `Carga ${id} (${que}, ${caso})` } };
}

const comoPaso = (e: EstadoHerramienta, r: Paso | string): Paso => (typeof r === "string" ? { estado: e, error: r } : r);

/** La viga o el pilar bajo el clic: el del enganche o, si no, el que está a menos del radio (los pilares antes). */
function barraEn(ctx: ContextoHerramienta, ev: Extract<Evento, { tipo: "punto" }>): { tipo: "viga" | "pilar"; id: string } | null {
  const ix = ctx.indice;
  const o = ev.enganche?.objeto;
  const s = o ? ix.siluetas.find((x) => x.id === o && (x.tipo === "viga" || x.tipo === "pilar")) : undefined;
  if (s) return { tipo: s.tipo as "viga" | "pilar", id: s.id };
  const q = ev.cursor ?? ev.p;
  const radio = ev.radio ?? 0;
  let mejor: { tipo: "viga" | "pilar"; id: string; d: number } | null = null;
  for (const x of ix.siluetas) {
    if (x.tipo !== "viga" && x.tipo !== "pilar") continue;
    const d = x.distancia(q, radio);
    if (d > radio) continue;
    if (!mejor || (x.tipo === "pilar" && mejor.tipo === "viga") || (x.tipo === mejor.tipo && d < mejor.d)) mejor = { tipo: x.tipo, id: x.id, d };
  }
  return mejor && { tipo: mejor.tipo, id: mejor.id };
}

function pasoPuntual(e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  if (ev.tipo !== "punto") return { estado: e };
  const t = ctx.plantillas.cargas?.puntual ?? {};
  if (!noNulo(t.F) && !noNulo(t.M)) return { estado: e, error: "Escriba en Propiedades la fuerza o el momento de la carga." };
  return comoPaso(e, carga(ctx, { tipo: "puntual", planta: ctx.planta, x: ev.p[0], y: ev.p[1], ...(noNulo(t.F) ? { F: t.F } : {}), ...(noNulo(t.M) ? { M: t.M } : {}) }, "puntual"));
}

function pasoLineal(e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  return pasoPolilinea(e, ev, {
    min: 2,
    cerrable: true,
    que: "Una carga lineal",
    terminar: (ps, cerrada) => {
      const q = ctx.plantillas.cargas?.lineal?.q;
      if (!noNulo(q)) return { estado: e, error: "Escriba en Propiedades el valor de la carga lineal (kN/m)." };
      return comoPaso(e, carga(ctx, { tipo: "lineal", planta: ctx.planta, puntos: cerrada ? [...ps, ps[0]!] : ps, q }, "lineal"));
    },
  });
}

function pasoSuperficie(e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  const t = ctx.plantillas.cargas?.superficie ?? {};
  const sinQ = "Escriba en Propiedades el valor de la carga de superficie (kN/m²).";
  if ((t.modo ?? "forjado") === "forjado") {
    if (ev.tipo !== "punto") return { estado: e };
    if (!noNulo(t.q)) return { estado: e, error: sinQ };
    const f = forjadoEn(ctx.modelo, ctx.planta, ev.cursor ?? ev.p);
    if (!f) return { estado: e, error: "Haga clic dentro de una losa o de un paño de la planta (o dibuje una zona, en Propiedades)." };
    return comoPaso(e, carga(ctx, { tipo: "superficie", planta: ctx.planta, q: t.q, ...(f.coleccion === "losas" ? { losa: f.id } : { pano: f.id }) }, `superficie en ${f.id}`));
  }
  return pasoPolilinea(e, ev, {
    min: 3,
    cerrable: true,
    que: "Una zona",
    terminar: (zona) => {
      if (!noNulo(t.q)) return { estado: e, error: sinQ };
      // Si cae entera en un forjado, la carga es de esa parte de él
      const m = ctx.modelo;
      const f = [...(m.losas ?? []).map((x) => ["losa", x] as const), ...(m.panos ?? []).map((x) => ["pano", x] as const)].find(
        ([, x]) => x.planta === ctx.planta && zona.every((q) => puntoEnPoligono(q, x.contorno) || distBorde(q, x.contorno) <= 1e-9),
      );
      return comoPaso(e, carga(ctx, { tipo: "superficie", planta: ctx.planta, q: t.q, ...(f ? { [f[0]]: f[1].id } : {}), zona }, `superficie en una zona${f ? ` de ${f[1].id}` : ""}`));
    },
  });
}

function pasoBarra(e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  const t = ctx.plantillas.cargas?.barra ?? {};
  const m = ctx.modelo;
  if (ev.tipo === "retroceso" || (ev.tipo === "terminar" && e.objeto)) return { estado: ESTADO_INICIAL };
  if (ev.tipo !== "punto") return { estado: e };
  const valores = () => (noNulo(t.q) ? null : "Escriba en Propiedades el valor de la carga (kN/m).");
  const base = (tipo: "viga" | "pilar", id: string) => ({ tipo, [tipo]: id, ejes: t.ejes ?? "global", q: t.q!, ...(noNulo(t.qb) ? { qb: t.qb } : {}) });
  // El segundo clic de un tramo: en la misma viga
  if (e.objeto) {
    const v = m.vigas?.find((x) => x.id === e.objeto);
    if (!v) return { estado: ESTADO_INICIAL };
    const b = estacion(v.puntos, ev.p);
    const a = estacion(v.puntos, e.puntos[0]!.p);
    if (igual(b.p, a.p)) return { estado: e };
    const falta = valores();
    if (falta) return { estado: e, error: falta };
    const [desde, hasta] = [r9(a.s), r9(b.s)].sort((x, y) => x - y) as [number, number];
    return comoPaso(e, carga(ctx, { ...base("viga", v.id), desde, hasta }, `en un tramo de ${v.id}`));
  }
  const x = barraEn(ctx, ev);
  if (!x) return { estado: e, error: "Haga clic en una viga o en un pilar de la planta." };
  const falta = valores();
  if (falta) return { estado: e, error: falta };
  if (x.tipo === "viga" && (t.modo ?? "entera") === "tramo") {
    const v = m.vigas!.find((y) => y.id === x.id)!;
    return { estado: { puntos: [{ p: estacion(v.puntos, ev.p).p }], objeto: v.id } };
  }
  return comoPaso(e, carga(ctx, base(x.tipo, x.id), `en ${x.id}`));
}

/** El lado del muro w en el que está q (mirando de su primer punto al último), o null en su eje. */
function ladoMuro(ps: readonly Vec2[], q: Vec2): "izquierdo" | "derecho" | null {
  const { tramo } = estacion(ps, q);
  const [a, b] = [ps[tramo]!, ps[tramo + 1]!];
  const x = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
  if (Math.abs(x) <= 1e-12 * Math.hypot(b[0] - a[0], b[1] - a[1])) return null;
  return x > 0 ? "izquierdo" : "derecho";
}

function pasoEmpuje(e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  if (ev.tipo !== "punto") return { estado: e };
  const t = ctx.plantillas.cargas?.empuje ?? {};
  const q = ev.cursor ?? ev.p;
  const w = muroEn(ctx, q, ev.radio ?? 0);
  if (!w) return { estado: e, error: "Haga clic en un muro de la planta, del lado del terreno." };
  const lado = ladoMuro(w.puntos, q);
  if (!lado) return { estado: e, error: "Haga clic a un lado del eje del muro: el del terreno." };
  const [z0, p1] = [t.z0 ?? 0, t.p1 ?? 0];
  if (t.z1 === undefined || t.p0 === undefined) return { estado: e, error: "Escriba en Propiedades la altura z1 y la presión p0 del empuje." };
  if (!(t.z1 > z0)) return { estado: e, error: "En Propiedades, z1 tiene que ser mayor que z0." };
  return comoPaso(e, carga(ctx, { tipo: "empuje", muro: w.id, lado, z0, z1: t.z1, p0: t.p0, p1 }, `empuje en ${w.id}, lado ${lado}`));
}

export function pasoCarga(h: NombreCarga, e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  switch (h) {
    case "puntual":
      return pasoPuntual(e, ev, ctx);
    case "lineal":
      return pasoLineal(e, ev, ctx);
    case "superficie":
      return pasoSuperficie(e, ev, ctx);
    case "barra":
      return pasoBarra(e, ev, ctx);
    case "empuje":
      return pasoEmpuje(e, ev, ctx);
  }
}

export function borradorCarga(h: NombreCarga, e: EstadoHerramienta, cursor: Vec2 | null, ctx: ContextoHerramienta, r: Borrador, crudo: Vec2 | null): void {
  const m = ctx.modelo;
  if (h === "lineal") borradorPolilinea(e, cursor, r, false);
  else if (h === "superficie" && (ctx.plantillas.cargas?.superficie?.modo ?? "forjado") === "zona") borradorPolilinea(e, cursor, r, true);
  else if (h === "superficie" && crudo) {
    const f = forjadoEn(m, ctx.planta, crudo);
    if (f) r.anillos.push(...[f.f.contorno, ...(f.f.huecos ?? [])].map((x) => [...x]));
  } else if (h === "barra" && e.objeto && cursor) {
    const v = m.vigas?.find((x) => x.id === e.objeto);
    if (v) r.lineas.push([e.puntos[0]!.p, estacion(v.puntos, cursor).p]);
  } else if (h === "empuje" && crudo) {
    // La cara del muro del lado del cursor
    const w = muroEn(ctx, crudo, Infinity);
    const lado = w && w.puntos.length > 1 && estacion(w.puntos, crudo).d <= w.espesor ? ladoMuro(w.puntos, crudo) : null;
    if (w && lado) r.lineas.push(desplazar(w.puntos, lado === "izquierdo" ? w.espesor / 2 : -w.espesor / 2));
  }
}

export function ayudaCarga(h: NombreCarga, e: EstadoHerramienta, t: Plantillas): string {
  const caso = t.cargas?.caso ? ` (caso ${t.cargas.caso})` : "";
  const n = e.puntos.length;
  const mas = `${n} puesto${n > 1 ? "s" : ""}`;
  switch (h) {
    case "puntual":
      return `Carga puntual${caso}: un clic donde va. Esc vuelve a Elegir.`;
    case "lineal":
      return n ? `Carga lineal${caso}: el punto siguiente (${mas}). Doble clic o Intro termina; Retroceso quita el último; Esc anula.` : `Carga lineal${caso}: el primer punto. Esc vuelve a Elegir.`;
    case "superficie":
      if ((t.cargas?.superficie?.modo ?? "forjado") === "forjado") return `Carga de superficie${caso}: un clic dentro de la losa o del paño (o una zona, en Propiedades). Esc vuelve a Elegir.`;
      return n ? `Carga de superficie${caso}: el vértice siguiente de la zona (${mas}); Intro o un clic en el primero la cierra. Esc anula.` : `Carga de superficie${caso}: el primer vértice de la zona. Esc vuelve a Elegir.`;
    case "barra":
      if (e.objeto) return `Carga en un tramo de ${e.objeto}${caso}: un clic en su otro extremo, en la misma viga. Esc anula.`;
      return (t.cargas?.barra?.modo ?? "entera") === "tramo" ? `Carga en barra${caso}: un clic en una viga donde empieza el tramo (en un pilar, todo él). Esc vuelve a Elegir.` : `Carga en barra${caso}: un clic en una viga o en un pilar (toda la pieza). Esc vuelve a Elegir.`;
    case "empuje":
      return `Empuje${caso}: un clic en un muro, del lado del terreno. Esc vuelve a Elegir.`;
  }
}
