/**
 * Fase CO6 (`docs/fem3d/comprobaciones.md` §8.10): las comprobaciones de CO1–CO4 para la app. Los
 * pilares, las vigas, las losas y su punzonamiento, con el armado en barras del proyecto, en la
 * forma de una tabla (una fila por tramo, vano, losa o unión de pilar y losa) y de la ficha de una
 * de ellas (todas las filas del módulo), y la propuesta de armado de las tablas.
 *
 * - **Los números son los de `fem comprobar` y `fem armar`:** aquí sólo se llama a `comprobarPilares`,
 *   `comprobarVigas`, `comprobarLosas` y `comprobarPunzonamientos` y se cambia la forma.
 * - **El armado llega en cada pedido,** como la armadura base de AB: no entra en la huella y el worker
 *   no se reabre al cambiarlo. Los datos comunes (`obra.armado`) sí son de la sesión.
 * - **Cambiar el armado de una pieza sólo vuelve a comprobar esa pieza:** lo comprobado se guarda por
 *   pieza con el armado con el que se comprobó (por `Consultas`: otros resultados, otra caché). Con
 *   el armado del proyecto cada pieza es independiente de las demás (las reglas de obra de CO1-e sólo
 *   actúan al proponer); el punzonamiento depende además del armado de las losas.
 * - Las zapatas (CO5) entran cuando estén.
 */
import type { ArmadoProyecto } from "../agente/armaduraBase.ts";
import { DATOS_ARMADO, type ArmadoForjado, type ArmadoTramoPilar, type ArmadoVanoViga, type ArmaduraPunzonamiento, type DatosArmado } from "../comprobaciones/armado.ts";
import { armadoPropuestoLosas, comprobarLosas } from "../comprobaciones/losas.ts";
import { armadoPropuesto, comprobarPilares } from "../comprobaciones/pilares.ts";
import { solapesPilar } from "../comprobaciones/armar/pilares.ts";
import { SITUACIONES_ELU } from "../comprobaciones/demandas/pilares.ts";
import { datosViga, filasPilarQ, type Esfuerzo } from "./datos.ts";
import type { Extremo, TramoEnvolvente } from "../agente/consultas.ts";
import { armadoPropuestoPunzonamiento, comprobarPunzonamientos } from "../comprobaciones/punzonamiento.ts";
import { armadoPropuestoVigas, comprobarVigas } from "../comprobaciones/vigas.ts";
import type { DatosDespiece } from "../comprobaciones/despieceVigas.ts";
import { datosDespiece, porticoDe, type Portico } from "../comprobaciones/porticos.ts";
import type { Consultas } from "../compilador/consultas.ts";
import type { Vec2 } from "../compilador/fisico.ts";
import { bandaPolilinea, numeroFijo, type EntradaLeyenda, type Escena, type ExtremoRotulado, type Primitiva } from "../agente/render/escena.ts";
import { anchoViga, fondoModelo, giroTexto, huellaSeccion, PlantaFisica, type DatosVista } from "../agente/render/modelo.ts";
import { cabecera, caja, circuloPilar } from "../agente/render/resultados.ts";
import { puntoEnPoligono } from "../compilador/poligonos.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { Sesion } from "./sesion.ts";

export const TIPOS_COMPROBACION = ["pilares", "vigas", "losas", "punzonamiento"] as const;
export type TipoComprobacion = (typeof TIPOS_COMPROBACION)[number];

type Resultado<T> = { valido: true; valor: T } | { valido: false; diagnosticos: Diagnostico[] };
const no = <T>(codigo: string, mensaje: string): Resultado<T> => ({ valido: false, diagnosticos: [{ codigo, severidad: "error", mensaje }] });

/** Una fila del módulo: una comprobación de la norma con su aprovechamiento. */
export interface FilaModulo {
  id: string;
  descripcion: string;
  articulo: string;
  /** null si la fila falla sin cociente. */
  aprovechamiento: number | null;
  estado: "ok" | "warn" | "fail";
  /** La combinación de la demanda (las reglas de armado no tienen). */
  comb?: string;
  /** Dónde: el extremo del tramo, la zona del vano, la franja y su armadura, la cara de la losa. */
  lugar?: string;
  /** La estación de la demanda a lo largo de la viga o de la franja, m. */
  s?: number;
  /** Con los signos pésimos del sismo (VS-o). */
  pesimos?: true;
  /** No comprueba nada: da un dato. */
  informativa?: true;
}

/** Una fila de la tabla: un tramo de pilar, un vano de viga, una losa o una unión de pilar y losa. */
export interface ParteComprobada {
  /** «P1/N2», «V3/0», «L1»: lo que se pide para su ficha. */
  clave: string;
  /** El objeto del modelo (para elegirlo en las vistas). */
  pieza: string;
  /** «N1 → N2», «vano 1 · P1 – P2», «maciza», «N2 · L1». */
  parte: string;
  planta?: string;
  seccion?: string;
  /**
   * De dónde sale el armado: del proyecto, o no hay (`sin-armadura`: el punzonamiento, que puede no
   * llevar). `no-aplica`: un pilar que atraviesa la losa sin unión por su huella (dentro del ancho de
   * sus vigas): no tiene punzonamiento que comprobar, y `pendientes` dice por qué.
   */
  origen: "proyecto" | "propuesto" | "sin-armado" | "sin-armadura" | "no-aplica";
  /** «4Ø16 + 4Ø12 (caras b) · cØ6/140». */
  texto?: string;
  cumple: boolean;
  aprovechamiento: number | null;
  manda?: FilaModulo;
  /** Filas que fallan. */
  fallan: number;
  /** Lo que queda sin comprobar, en palabras. */
  pendientes: string[];
  /** En una viga, las estaciones del vano a lo largo de ella (m), entre las caras de sus apoyos. */
  tramo?: [number, number];
}

/** Un dato de la ficha («β», 1,15). */
export interface DatoFicha {
  nombre: string;
  valor: number | string;
  unidad?: string;
}

/** El armado de una parte, como dato del proyecto; `circular` y `reticular` dicen qué forma tiene (anillo; barras por nervio y ábacos). */
export type ArmadoParte =
  | { tipo: "pilares"; armado?: ArmadoTramoPilar; circular?: true }
  | { tipo: "vigas"; armado?: ArmadoVanoViga }
  | { tipo: "losas"; armado?: ArmadoForjado; reticular?: true }
  | { tipo: "punzonamiento"; armado?: ArmaduraPunzonamiento };

/**
 * Lo que mide una parte, para dibujar su armado (`comprobaciones/dibujoArmado.ts`), en mm: la sección
 * del tramo de pilar o de la viga (sin ella, no es rectangular ni circular: no se dibuja), la luz del
 * vano entre las caras de sus apoyos (m) y la sección de la losa.
 */
export type GeometriaParte =
  | {
      tipo: "pilares";
      seccion?: { b: number; h: number } | { D: number };
      /** CO1-f: el tramo flexible (m) y el solape de cada diámetro en su pie (m), para sus zonas de cercos (`alzadoPilar`). */
      libre?: number;
      solapes?: Record<number, number>;
    }
  | { tipo: "vigas"; seccion?: { b: number; h: number }; luz: number; apoyos: [string | null, string | null] }
  | { tipo: "losas"; espesor: number; reticular?: { intereje: number; nervio: number; capa: number }; /** Es una losa de cimentación (CO3-k: admite la armadura mínima reducida). */ cimentacion?: true }
  | { tipo: "punzonamiento"; seccion?: { b: number; h: number } | { D: number }; d?: number; perimetros?: number; alcance?: number; posicion?: string };

/** La ficha de una parte: todas las filas del módulo y su armado, como dato. */
export interface FichaComprobacion extends ParteComprobada {
  filas: FilaModulo[];
  armado: ArmadoParte;
  datos: DatoFicha[];
  geometria: GeometriaParte;
  /** El recubrimiento hasta el cerco con el que se ha comprobado, mm. */
  recubrimiento: number;
  /** Las hipótesis de partida de la comprobación, en palabras (el punzonamiento). */
  hipotesis?: string[];
}

export interface ResumenComprobaciones {
  piezas: number;
  partes: number;
  cumplen: number;
  noCumplen: number;
  sinArmado: number;
  /** Las que no se comprueban (`no-aplica`): no cuentan en las demás. */
  noAplica: number;
}

export interface DatosComprobaciones {
  tipo: TipoComprobacion;
  partes: ParteComprobada[];
  resumen: ResumenComprobaciones;
  /** Los datos comunes con los que se ha comprobado (`obra.armado` y lo que falta, por defecto). */
  datos: Required<DatosArmado>;
  diagnosticos: Diagnostico[];
  /** Partes que se han vuelto a comprobar en este pedido (las demás, de la caché). */
  comprobadas: number;
}

// ─── La caché, por consultas ────────────────────────────────────────────────────────────────────

interface Guardado {
  /** El armado con el que se comprobó la pieza, en texto. */
  con: string;
  fichas: FichaComprobacion[];
}
interface Cache {
  piezas: Map<string, Guardado>;
  diagnosticos: Diagnostico[];
}
const CACHES = new WeakMap<Consultas, Record<TipoComprobacion, Cache>>();

function cacheDe(q: Consultas): Record<TipoComprobacion, Cache> {
  let c = CACHES.get(q);
  if (!c) {
    const vacia = (): Cache => ({ piezas: new Map(), diagnosticos: [] });
    CACHES.set(q, (c = { pilares: vacia(), vigas: vacia(), losas: vacia(), punzonamiento: vacia() }));
  }
  return c;
}

const texto = (x: unknown) => JSON.stringify(x ?? null);

/** Los objetos del modelo que tienen comprobaciones de un tipo, en su orden. */
function piezasDe(q: Consultas, tipo: TipoComprobacion): string[] {
  const f = q.fisico;
  if (tipo === "vigas") return (f.vigas ?? []).map((x) => x.id);
  if (tipo === "losas") return (f.losas ?? []).map((x) => x.id);
  return (f.pilares ?? []).map((x) => x.id);
}

/** El armado del que depende lo comprobado de una pieza, en texto. */
function armadoDe(tipo: TipoComprobacion, id: string, a: ArmadoProyecto | undefined): string {
  if (tipo === "pilares") return texto(a?.pilares?.[id]);
  if (tipo === "vigas") return texto(a?.vigas?.[id]);
  if (tipo === "losas") return texto(a?.forjados?.[id]);
  // El punzonamiento, con la armadura de flexión de las losas (cualquiera: no se sabe aquí cuál es la suya)
  return `${texto(a?.punzonamiento?.[id])}|${texto(a?.forjados)}`;
}

// ─── De cada módulo a la forma común ────────────────────────────────────────────────────────────

type FilaDe = { id: string; descripcion: string; articulo: string; aprovechamiento: number | null; estado: string; comb?: string; s?: number; pesimos?: true; informativa?: true };
const filaComun = (f: FilaDe, lugar?: string): FilaModulo => ({
  id: f.id,
  descripcion: f.descripcion,
  articulo: f.articulo,
  aprovechamiento: f.aprovechamiento,
  estado: f.estado as FilaModulo["estado"],
  ...(f.comb ? { comb: f.comb } : {}),
  ...(lugar ? { lugar } : {}),
  ...(f.s !== undefined ? { s: f.s } : {}),
  ...(f.pesimos ? { pesimos: true as const } : {}),
  ...(f.informativa ? { informativa: true as const } : {}),
});
const fallan = (filas: readonly FilaModulo[]) => filas.filter((f) => f.estado === "fail" && !f.informativa).length;

/** La sección de un pilar o de una viga, en mm, si es rectangular o circular. */
function medidas(q: Consultas, id: string | undefined): { b: number; h: number } | { D: number } | undefined {
  const s = q.fisico.secciones.find((x) => x.id === id);
  if (!s || !("forma" in s)) return undefined;
  if (s.forma === "rectangular") return { b: s.b * 1000, h: s.h * 1000 };
  if (s.forma === "circular") return { D: s.D * 1000 };
  return undefined;
}

const rect = (m: { b: number; h: number } | { D: number } | undefined) => (m && "b" in m ? m : undefined);

function geometriaLosa(q: Consultas, id: string): GeometriaParte {
  const l = q.fisico.losas?.find((x) => x.id === id);
  const r = l?.reticular;
  return { tipo: "losas", espesor: (l?.espesor ?? 0) * 1000, ...(r ? { reticular: { intereje: r.intereje * 1000, nervio: r.nervio * 1000, capa: r.capa * 1000 } } : {}), ...(l?.cimentacion !== undefined ? { cimentacion: true as const } : {}) };
}

/** La sección del tramo de un pilar que llega a una planta por debajo (la de su huella en la losa). */
function seccionEnPlanta(q: Consultas, pilar: string, planta: string): { b: number; h: number } | { D: number } | undefined {
  const p = q.fisico.pilares?.find((x) => x.id === pilar);
  return p ? medidas(q, p.tramos?.find((t) => t.planta === planta)?.seccion ?? p.seccion) : undefined;
}

/** El fck del material de una sección, si es hormigón. */
function fckDe(q: Consultas, seccion: string): number | undefined {
  const sc = q.fisico.secciones.find((x) => x.id === seccion);
  const m = sc && q.fisico.materiales.find((x) => x.id === sc.material);
  return m?.tipo === "hormigon" ? m.fck : undefined;
}

const NOMBRE_ARMADURA: Record<string, string> = { "x-inf": "X inferior", "x-sup": "X superior", "y-inf": "Y inferior", "y-sup": "Y superior" };

/** Comprueba las piezas `ids` de un tipo con el armado dado y da sus fichas, por pieza. */
function comprobar(q: Consultas, tipo: TipoComprobacion, ids: readonly string[], a: ArmadoProyecto | undefined, datos: DatosArmado | undefined): Resultado<{ fichas: Map<string, FichaComprobacion[]>; diagnosticos: Diagnostico[] }> {
  const fichas = new Map<string, FichaComprobacion[]>(ids.map((id) => [id, []]));
  const recubrimiento = datos?.recubrimiento ?? DATOS_ARMADO.recubrimiento;
  const a_ = (id: string, f: Omit<FichaComprobacion, "recubrimiento">) => (fichas.get(id) ?? fichas.set(id, []).get(id)!).push({ ...f, recubrimiento });
  if (tipo === "pilares") {
    const r = comprobarPilares(q, a?.pilares, datos, { ids, filas: true });
    if (!r.valido) return r;
    const circulares = new Set(q.fisico.secciones.filter((x) => "forma" in x && x.forma === "circular").map((x) => x.id));
    for (const p of r.valor.pilares)
      for (const t of p.tramos) {
        const filas = (t.filas ?? []).map((f) => filaComun(f, f.extremo));
        a_(p.pilar, {
          clave: `${p.pilar}/${t.planta}`,
          pieza: p.pilar,
          parte: `${t.plantaBase} → ${t.planta}`,
          planta: t.planta,
          seccion: t.seccion,
          origen: t.origen,
          ...(t.texto ? { texto: t.texto } : {}),
          cumple: t.cumple,
          aprovechamiento: t.aprovechamiento,
          ...(t.manda ? { manda: filaComun(t.manda, t.manda.extremo) } : {}),
          fallan: fallan(filas),
          pendientes: t.pendientes.map((x) => (x.demandas > 1 ? `${x.motivo} (${x.demandas} demandas)` : x.motivo)),
          filas,
          armado: { tipo, ...(t.armado ? { armado: t.armado } : {}), ...(circulares.has(t.seccion) ? { circular: true as const } : {}) },
          datos: [{ nombre: "Combinaciones de ELU", valor: p.combinaciones }],
          geometria: { tipo, ...(medidas(q, t.seccion) ? { seccion: medidas(q, t.seccion)! } : {}), ...(t.libre !== undefined ? { libre: t.libre } : {}), ...(fckDe(q, t.seccion) !== undefined ? { solapes: solapesPilar(fckDe(q, t.seccion)!, datos) } : {}) },
        });
      }
    return { valido: true, valor: { fichas, diagnosticos: r.diagnosticos } };
  }
  if (tipo === "vigas") {
    const r = comprobarVigas(q, a?.vigas, datos, { ids, filas: true });
    if (!r.valido) return r;
    for (const g of r.valor.vigas)
      for (const v of g.vanos) {
        const filas = (v.filas ?? []).map((f) => filaComun(f, f.zona));
        const apoyos = v.apoyos.map((x) => x ?? "libre").join(" – ");
        a_(g.viga, {
          clave: `${g.viga}/${v.vano}`,
          pieza: g.viga,
          parte: `vano ${v.vano + 1} · ${apoyos}`,
          tramo: [v.desde, v.hasta],
          seccion: g.seccion,
          origen: v.origen,
          ...(v.texto ? { texto: v.texto } : {}),
          cumple: v.cumple,
          aprovechamiento: v.aprovechamiento,
          ...(v.manda ? { manda: filaComun(v.manda, v.manda.zona) } : {}),
          fallan: fallan(filas),
          pendientes: v.pendientes.map((x) => (x.zona ? `${x.motivo} (${x.zona})` : x.motivo)),
          filas,
          armado: { tipo, ...(v.armado ? { armado: v.armado } : {}) },
          datos: [
            { nombre: "Desde", valor: v.desde, unidad: "m" },
            { nombre: "Hasta", valor: v.hasta, unidad: "m" },
            { nombre: "Combinaciones de ELU", valor: g.combinaciones },
          ],
          geometria: { tipo, ...(rect(medidas(q, g.seccion)) ? { seccion: rect(medidas(q, g.seccion))! } : {}), luz: v.hasta - v.desde, apoyos: [v.apoyos[0] ?? null, v.apoyos[1] ?? null] },
        });
      }
    return { valido: true, valor: { fichas, diagnosticos: r.diagnosticos } };
  }
  if (tipo === "losas") {
    const r = comprobarLosas(q, a?.forjados, datos, { ids, filas: true });
    if (!r.valido) return r;
    const lugar = (f: { franja?: string; armadura?: string; armado: string }) => [f.franja, f.armadura ? NOMBRE_ARMADURA[f.armadura] : undefined, f.armado].filter(Boolean).join(" · ");
    for (const l of r.valor.losas) {
      const filas = (l.filas ?? []).map((f) => filaComun(f, lugar(f)));
      a_(l.losa, {
        clave: l.losa,
        pieza: l.losa,
        parte: l.tipo,
        planta: l.planta,
        origen: l.origen,
        ...(l.texto ? { texto: l.texto } : {}),
        cumple: l.cumple,
        aprovechamiento: l.aprovechamiento,
        ...(l.manda ? { manda: filaComun(l.manda, lugar(l.manda)) } : {}),
        fallan: l.fallan,
        pendientes: l.pendientes.map((x) => x.motivo),
        filas,
        armado: { tipo, ...(l.armado ? { armado: l.armado } : {}), ...(l.tipo === "reticular" ? { reticular: true as const } : {}) },
        datos: [
          { nombre: "Combinaciones de ELU", valor: l.combinaciones },
          { nombre: "Estaciones comprobadas", valor: l.estaciones },
        ],
        geometria: geometriaLosa(q, l.losa),
      });
    }
    return { valido: true, valor: { fichas, diagnosticos: r.diagnosticos } };
  }
  const r = comprobarPunzonamientos(q, a?.forjados, a?.punzonamiento, datos, { ids, filas: true });
  if (!r.valido) return r;
  for (const p of r.valor.pilares) {
    const filas = (p.filas ?? []).map((f) => filaComun(f, `cara ${f.cara}`));
    const d: DatoFicha[] = [];
    if (p.posicion) d.push({ nombre: "Posición", valor: p.posicion });
    if (p.cara) d.push({ nombre: "Cara que manda", valor: p.cara });
    if (p.VEd !== undefined) d.push({ nombre: "VEd (lo que la losa pasa al pilar)", valor: p.VEd, unidad: "kN" });
    if (p.porVigasPlanas !== undefined) d.push({ nombre: "Por las vigas planas (no cuenta)", valor: p.porVigasPlanas, unidad: "kN" });
    if (p.beta !== undefined) d.push({ nombre: "β", valor: p.beta });
    if (p.u1 !== undefined) d.push({ nombre: "u1 eficaz", valor: p.u1, unidad: "mm" });
    if (p.d !== undefined) d.push({ nombre: "d", valor: p.d, unidad: "mm" });
    if (p.sinArmadura !== null) d.push({ nombre: "vEd / vRd,c (sin armadura)", valor: p.sinArmadura });
    if (p.perimetros !== undefined) d.push({ nombre: "Perímetros de cercos", valor: p.perimetros });
    if (p.alcance !== undefined) d.push({ nombre: "Hasta, desde la cara del pilar", valor: p.alcance, unidad: "mm" });
    if (p.vigas.length) d.push({ nombre: "Vigas que le llegan", valor: p.vigas.join(", ") });
    a_(p.pilar, {
      clave: `${p.pilar}/${p.planta}`,
      pieza: p.pilar,
      parte: `${p.planta} · ${p.losa}`,
      planta: p.planta,
      origen: p.origen,
      ...(p.texto ? { texto: p.texto } : {}),
      cumple: p.cumple,
      aprovechamiento: p.aprovechamiento,
      ...(p.manda ? { manda: filaComun(p.manda, `cara ${p.manda.cara}`) } : {}),
      fallan: p.fallan,
      pendientes: p.pendientes.map((x) => x.motivo),
      filas,
      armado: { tipo, ...(p.armadura ? { armado: p.armadura } : {}) },
      datos: d,
      geometria: { tipo, ...(seccionEnPlanta(q, p.pilar, p.planta) ? { seccion: seccionEnPlanta(q, p.pilar, p.planta)! } : {}), ...(p.d !== undefined ? { d: p.d } : {}), ...(p.perimetros !== undefined ? { perimetros: p.perimetros } : {}), ...(p.alcance !== undefined ? { alcance: p.alcance } : {}), ...(p.posicion ? { posicion: p.posicion } : {}) },
      ...(p.hipotesis ? { hipotesis: p.hipotesis } : {}),
    });
  }
  // Los que atraviesan la losa sin unión por su huella: no se comprueban, y se dice por qué
  for (const s of r.valor.sinUnion)
    a_(s.pilar, {
      clave: `${s.pilar}/${s.planta}`,
      pieza: s.pilar,
      parte: `${s.planta} · ${s.losa}`,
      planta: s.planta,
      origen: "no-aplica",
      texto: "no se comprueba",
      cumple: true,
      aprovechamiento: null,
      fallan: 0,
      pendientes: [s.motivo],
      filas: [],
      armado: { tipo },
      datos: [...(s.vigas.length ? [{ nombre: "Dentro del ancho de", valor: s.vigas.join(", ") }] : []), { nombre: "d (para dibujar el perímetro)", valor: s.d, unidad: "mm" }],
      geometria: { tipo, ...(seccionEnPlanta(q, s.pilar, s.planta) ? { seccion: seccionEnPlanta(q, s.pilar, s.planta)! } : {}), d: s.d, posicion: "no se comprueba" },
      hipotesis: [`El perímetro crítico se dibuja a puntos, a 2·d de la cara del pilar, sólo como referencia: d ≈ ${Math.round(s.d)} mm, el canto útil de la armadura superior de la losa junto al pilar (sin armado, el canto menos el recubrimiento y un Ø12).`],
    });
  // Cada pilar, de arriba abajo (el orden de las plantas)
  const orden = new Map(q.fisico.plantas.map((x, i) => [x.id, i]));
  for (const fs of fichas.values()) fs.sort((x, y) => (orden.get(x.planta ?? "") ?? 0) - (orden.get(y.planta ?? "") ?? 0));
  return { valido: true, valor: { fichas, diagnosticos: r.diagnosticos } };
}

/** Lo comprobado de un tipo con el armado dado, de la caché donde vale: las fichas de todas sus piezas, en el orden del modelo. */
export function alDia(s: Sesion, tipo: TipoComprobacion, armado: ArmadoProyecto | undefined): Resultado<{ fichas: FichaComprobacion[]; diagnosticos: Diagnostico[]; comprobadas: number }> {
  const q = s.q;
  if (!q) return no("visor/sin-resultados", "No hay resultados de esta huella.");
  const cache = cacheDe(q)[tipo];
  const ids = piezasDe(q, tipo);
  // Lo comprobado vale para su armado y para los datos de armado de la obra (cambian sin recalcular)
  const obra = JSON.stringify(s.datosArmado ?? null);
  const con = (id: string) => `${armadoDe(tipo, id, armado)}|${obra}`;
  const faltan = ids.filter((id) => cache.piezas.get(id)?.con !== con(id));
  let comprobadas = 0;
  if (faltan.length) {
    const r = comprobar(q, tipo, faltan, armado, s.datosArmado);
    if (!r.valido) return r;
    for (const id of faltan) {
      const fichas = r.valor.fichas.get(id) ?? [];
      comprobadas += fichas.length;
      cache.piezas.set(id, { con: con(id), fichas });
    }
    // Los avisos que cuentan piezas («3 de 12 tramos sin armado») son de la llamada: se dan sólo los
    // de una llamada con todas; de una parcial, los demás que no estaban
    const cuenta = (d: Diagnostico) => d.codigo === "comprobacion/sin-armado";
    if (faltan.length === ids.length) cache.diagnosticos = r.valor.diagnosticos;
    else {
      const vistos = new Set(cache.diagnosticos.map((d) => `${d.codigo}|${d.mensaje}`));
      cache.diagnosticos = [...cache.diagnosticos.filter((d) => !cuenta(d)), ...r.valor.diagnosticos.filter((d) => !cuenta(d) && !vistos.has(`${d.codigo}|${d.mensaje}`))];
    }
  }
  return { valido: true, valor: { fichas: ids.flatMap((id) => cache.piezas.get(id)?.fichas ?? []), diagnosticos: cache.diagnosticos, comprobadas } };
}

/** El pórtico de una viga (pedido `portico`): sus apoyos y sus vanos a lo largo de él, y lo que su despiece necesita además del armado. */
export interface DatosPortico {
  portico: Portico;
  despiece: DatosDespiece;
}

export function datosPortico(s: Sesion, viga: string): Resultado<DatosPortico> {
  const q = s.q;
  if (!q) return no("visor/sin-resultados", "No hay resultados de esta huella.");
  const portico = porticoDe(q, viga);
  if (!portico) return no("visor/comprobacion", `No hay ninguna viga «${viga}» con vanos.`);
  return { valido: true, valor: { portico, despiece: datosDespiece(portico, s.datosArmado) } };
}

/** Un punto de una envolvente: la coordenada del dibujo (m) y el máximo y el mínimo de las combinaciones. */
export interface PuntoEsfuerzo {
  x: number;
  max: number;
  min: number;
}

/**
 * Las envolventes de ELU para dibujarlas con el armado (§8.14): por esfuerzo, sus tramos continuos
 * (se cortan en las zonas rígidas) en la coordenada del dibujo. En un pórtico, su x; en un tramo de
 * pilar, la altura desde la cara de su nudo de abajo. kN y kN·m.
 */
export interface DatosEsfuerzosArmado {
  esfuerzos: Partial<Record<Esfuerzo, PuntoEsfuerzo[][]>>;
  /** Qué combinaciones envuelven («ELU: 12 combinaciones»). */
  combinaciones: string;
  /** En un tramo de pilar: los pésimos de su pie y de su cabeza, cada uno con su combinación y sus [N, Vy, Vz, T, My, Mz] concomitantes. */
  ternas?: TramoEnvolvente;
  /** En un pórtico: los extremos de cada vano (por su clave, «V3/0») con su combinación y sus esfuerzos concomitantes. */
  vanos?: Record<string, Record<string, Extremo>>;
  /** En un pórtico: las vigas cuyo axil no tiene valor (van en un diafragma rígido, que se lo lleva). */
  axilSinValor?: string[];
}

const ELU = { tipo: "situaciones" as const, situaciones: [...SITUACIONES_ELU] };

/** Los puntos de una envolvente entre dos estaciones de su pieza, por tramos flexibles contiguos. */
function tramosEnvolvente(v: { envolvente: { s: number; max: number; min: number }[]; flexibles: [number, number][] }, desde: number, hasta: number): { s: number; max: number; min: number }[][] {
  const continuos: [number, number][] = [];
  for (const [a, b] of [...v.flexibles].sort((x, y) => x[0] - y[0])) {
    const u = continuos[continuos.length - 1];
    if (u && a - u[1] < 1e-9) u[1] = Math.max(u[1], b);
    else continuos.push([a, b]);
  }
  const r: { s: number; max: number; min: number }[][] = [];
  for (const [a, b] of continuos) {
    const [p, q] = [Math.max(a, desde), Math.min(b, hasta)];
    if (!(q > p + 1e-9)) continue;
    const ps = v.envolvente.filter((x) => x.s >= p - 1e-9 && x.s <= q + 1e-9);
    if (ps.length > 1) r.push(ps);
  }
  return r;
}

/** Las envolventes de My y Vz de las vigas de un pórtico, en su x y en su sentido (pedido `esfuerzos-portico`). */
export function esfuerzosPortico(s: Sesion, viga: string): Resultado<DatosEsfuerzosArmado> {
  const q = s.q;
  if (!q) return no("visor/sin-resultados", "No hay resultados de esta huella.");
  const p = porticoDe(q, viga);
  if (!p) return no("visor/comprobacion", `No hay ninguna viga «${viga}» con vanos.`);
  const esfuerzos: DatosEsfuerzosArmado["esfuerzos"] = {};
  let combinaciones = "";
  const vanos: Record<string, Record<string, Extremo>> = {};
  const axilSinValor = new Set<string>();
  for (const e of ["My", "Vz", "T", "N"] as const) {
    const tramos: PuntoEsfuerzo[][] = [];
    for (const v of p.vigas) {
      const d = datosViga(s, v.id, e, ELU);
      if (!d.valido) return d;
      combinaciones = d.valor.combinaciones.descripcion;
      if (d.valor.axilSinValor) axilSinValor.add(v.id);
      d.valor.vanos.forEach((x, i) => (vanos[`${v.id}/${i}`] = x.extremos));
      for (const t of tramosEnvolvente(d.valor, -Infinity, Infinity)) {
        // Una viga dibujada al revés: su s va de derecha a izquierda, y su cortante y su torsor cambian de signo
        const cambia = e === "Vz" || e === "T";
        const ps = t.map((x): PuntoEsfuerzo => (v.invertida ? { x: v.x[1] - x.s, max: cambia ? -x.min : x.max, min: cambia ? -x.max : x.min } : { x: v.x[0] + x.s, max: x.max, min: x.min }));
        tramos.push(v.invertida ? ps.reverse() : ps);
      }
    }
    esfuerzos[e] = tramos.sort((a, b) => a[0]!.x - b[0]!.x);
  }
  return { valido: true, valor: { esfuerzos, combinaciones, vanos, ...(axilSinValor.size ? { axilSinValor: [...axilSinValor] } : {}) } };
}

/** Las envolventes de N, My, Mz, Vy y Vz de un tramo de pilar (el de la cabeza en `planta`), desde la cara de su nudo de abajo (pedido `esfuerzos-pilar`). */
export function esfuerzosTramoPilar(s: Sesion, pilar: string, planta: string): Resultado<DatosEsfuerzosArmado> {
  const q = s.q;
  if (!q) return no("visor/sin-resultados", "No hay resultados de esta huella.");
  const ts = q.pilar(pilar);
  if (!ts.valido) return ts;
  const t = ts.valor.find((x) => x.planta === planta);
  if (!t) return no("visor/comprobacion", `${pilar} no tiene ningún tramo con la cabeza en ${planta}.`);
  const esfuerzos: DatosEsfuerzosArmado["esfuerzos"] = {};
  let combinaciones = "";
  for (const e of ["N", "My", "Mz", "Vz", "Vy"] as const) {
    const d = datosViga(s, pilar, e, ELU);
    if (!d.valido) return d;
    combinaciones = d.valor.combinaciones.descripcion;
    esfuerzos[e] = tramosEnvolvente(d.valor, t.base.s, t.cabeza.s).map((ps) => ps.map((x) => ({ x: x.s - t.base.s, max: x.max, min: x.min })));
  }
  // De qué combinación sale cada pésimo: las ternas del tramo (las de `fem consultar pieza`)
  const conj = s.conjunto(ELU, "esfuerzos");
  const filas = conj.valido ? filasPilarQ(q, conj.valor, pilar) : null;
  const ternas = filas?.valido ? filas.valor.find((x) => x.planta === planta)?.tramo : undefined;
  return { valido: true, valor: { esfuerzos, combinaciones, ...(ternas ? { ternas } : {}) } };
}

export const sinFilas = ({ filas: _f, armado: _a, datos: _d, geometria: _g, recubrimiento: _r, hipotesis: _h, ...p }: FichaComprobacion): ParteComprobada => p;

/** La tabla de un tipo de pieza (pedido `comprobaciones`). */
export function datosComprobaciones(s: Sesion, tipo: TipoComprobacion, armado: ArmadoProyecto | undefined): Resultado<DatosComprobaciones> {
  const r = alDia(s, tipo, armado);
  if (!r.valido) return r;
  const partes = r.valor.fichas.map(sinFilas);
  const sinArmado = partes.filter((p) => p.origen === "sin-armado").length;
  const diagnosticos = [...r.valor.diagnosticos.filter((d) => d.codigo !== "comprobacion/sin-armado")];
  const comprobadas = partes.filter((p) => p.origen !== "no-aplica");
  return {
    valido: true,
    valor: {
      tipo,
      partes,
      resumen: { piezas: new Set(comprobadas.map((p) => p.pieza)).size, partes: comprobadas.length, cumplen: comprobadas.filter((p) => p.cumple).length, noCumplen: comprobadas.filter((p) => !p.cumple).length, sinArmado, noAplica: partes.length - comprobadas.length },
      datos: { ...DATOS_ARMADO, ...s.datosArmado },
      diagnosticos,
      comprobadas: r.valor.comprobadas,
    },
  };
}

/** La ficha de una parte (pedido `comprobacion`): todas sus filas. */
export function datosComprobacion(s: Sesion, tipo: TipoComprobacion, clave: string, armado: ArmadoProyecto | undefined): Resultado<FichaComprobacion> {
  const r = alDia(s, tipo, armado);
  if (!r.valido) return r;
  const f = r.valor.fichas.find((x) => x.clave === clave);
  return f ? { valido: true, valor: f } : no("visor/comprobacion", `No hay ninguna comprobación «${clave}» en ${tipo}.`);
}

// ─── Proponer ───────────────────────────────────────────────────────────────────────────────────

export interface PedidoArmar {
  tipos: readonly TipoComprobacion[];
  armado?: ArmadoProyecto;
  /** Los datos de armado de la obra con los que se propone (`Sesion.datosArmado`); sin ellos, los de la sesión. */
  datos?: DatosArmado;
  /** Sólo estas piezas (pilares, vigas o losas; el punzonamiento, el de esos pilares). */
  ids?: readonly string[];
  /**
   * Sólo lo que no tiene armado en el proyecto. En el punzonamiento (CO6-b), sólo las uniones sin
   * armadura de punzonamiento escrita: en ellas se propone la que haga falta, o ninguna; la escrita
   * se conserva aunque ya no hiciera falta o no bastara.
   */
  soloSinArmado?: boolean;
}

export interface DatosArmar {
  /** El armado del proyecto con lo propuesto: lo que se le da a la operación `armado`. */
  armado: ArmadoProyecto;
  /** Por tipo, lo propuesto y lo que se queda sin propuesta. */
  resumen: Partial<Record<TipoComprobacion, { partes: number; propuestas: number; sinPropuesta: number; conservadas?: number }>>;
  sinPropuesta: { tipo: TipoComprobacion; clave: string; motivo: string }[];
  diagnosticos: Diagnostico[];
}

/**
 * El armado que proponen las tablas (pedido `armar`), como `fem armar`: los pilares con sus reglas de
 * obra, las vigas, las losas y, con el armado de las losas que queda (el propuesto), el punzonamiento.
 * No escribe nada: la app lo aplica con la operación `armado`.
 */
export function datosArmar(s: Sesion, p: PedidoArmar): Resultado<DatosArmar> {
  const q = s.q;
  if (!q) return no("visor/sin-resultados", "No hay resultados de esta huella.");
  const datos = s.datosArmado;
  const previo = p.armado;
  const armado: ArmadoProyecto = { ...previo };
  const resumen: DatosArmar["resumen"] = {};
  const sinPropuesta: DatosArmar["sinPropuesta"] = [];
  const diagnosticos: Diagnostico[] = [];
  const con = new Set(p.tipos);
  const de = (tipo: TipoComprobacion) => {
    const todas = new Set(piezasDe(q, tipo));
    return p.ids?.length ? p.ids.filter((id) => todas.has(id)) : [...todas];
  };
  const solo = p.soloSinArmado ? { soloSinArmado: true } : {};
  const anotar = (tipo: TipoComprobacion, partes: { clave: string; origen: string; pendientes: string[] }[]) => {
    const mias = partes.filter((x) => x.origen === "propuesto" || x.origen === "sin-armado");
    const sin = mias.filter((x) => x.origen === "sin-armado");
    const conservadas = partes.filter((x) => x.origen === "proyecto").length;
    resumen[tipo] = { partes: partes.length, propuestas: mias.length - sin.length, sinPropuesta: sin.length, ...(conservadas ? { conservadas } : {}) };
    for (const x of sin) sinPropuesta.push({ tipo, clave: x.clave, motivo: x.pendientes[0] ?? "sin propuesta" });
  };
  if (con.has("pilares")) {
    const ids = de("pilares");
    if (ids.length) {
      const r = comprobarPilares(q, previo?.pilares, datos, { ids, proponer: true, ...solo });
      if (!r.valido) return r;
      armado.pilares = armadoPropuesto(r.valor, previo?.pilares);
      diagnosticos.push(...r.diagnosticos);
      anotar("pilares", r.valor.pilares.flatMap((x) => x.tramos.map((t) => ({ clave: `${x.pilar}/${t.planta}`, origen: t.origen, pendientes: t.pendientes.map((y) => y.motivo) }))));
    }
  }
  if (con.has("vigas")) {
    const ids = de("vigas");
    if (ids.length) {
      const r = comprobarVigas(q, previo?.vigas, datos, { ids, proponer: true, ...solo });
      if (!r.valido) return r;
      armado.vigas = armadoPropuestoVigas(r.valor, previo?.vigas);
      diagnosticos.push(...r.diagnosticos);
      anotar("vigas", r.valor.vigas.flatMap((x) => x.vanos.map((v) => ({ clave: `${x.viga}/${v.vano}`, origen: v.origen, pendientes: v.pendientes.map((y) => y.motivo) }))));
    }
  }
  if (con.has("losas")) {
    const ids = de("losas");
    if (ids.length) {
      const r = comprobarLosas(q, previo?.forjados, datos, { ids, proponer: true, ...solo, ...(previo ? { bases: previo } : {}) });
      if (!r.valido) return r;
      armado.forjados = armadoPropuestoLosas(r.valor, previo?.forjados);
      diagnosticos.push(...r.diagnosticos);
      anotar("losas", r.valor.losas.map((l) => ({ clave: l.losa, origen: l.origen, pendientes: l.pendientes.map((y) => y.motivo) })));
    }
  }
  if (con.has("punzonamiento")) {
    const ids = de("punzonamiento");
    if (ids.length) {
      // Con el armado de las losas que queda: el que se acaba de proponer o el del proyecto
      const r = comprobarPunzonamientos(q, armado.forjados, previo?.punzonamiento, datos, { ids, proponer: true });
      if (!r.valido) return r;
      // CO6-b: con «sólo lo que falta», la armadura escrita se conserva (lo propuesto parte de la de antes)
      const escrita = (x: { pilar: string; planta: string }) => !!previo?.punzonamiento?.[x.pilar]?.[x.planta];
      const nuevas = p.soloSinArmado ? r.valor.pilares.filter((x) => !escrita(x)) : r.valor.pilares;
      armado.punzonamiento = armadoPropuestoPunzonamiento({ ...r.valor, pilares: nuevas }, previo?.punzonamiento);
      diagnosticos.push(...r.diagnosticos);
      const conservadas = r.valor.pilares.length - nuevas.length;
      const partes = nuevas.map((x) => ({ clave: `${x.pilar}/${x.planta}`, origen: x.origen, pendientes: x.pendientes.map((y) => y.motivo), sin: !x.cumple && x.origen !== "sin-armado" }));
      const sin = partes.filter((x) => x.sin || x.origen === "sin-armado");
      resumen.punzonamiento = { partes: r.valor.pilares.length, propuestas: partes.filter((x) => x.origen === "propuesto").length, sinPropuesta: sin.length, ...(conservadas ? { conservadas } : {}) };
      for (const x of sin) sinPropuesta.push({ tipo: "punzonamiento", clave: x.clave, motivo: x.pendientes[0] ?? "sin propuesta" });
    }
  }
  // Los bloques vacíos no se escriben
  for (const k of ["pilares", "vigas", "forjados", "punzonamiento"] as const) if (armado[k] && !Object.keys(armado[k]!).length) delete armado[k];
  const vistos = new Set<string>();
  return { valido: true, valor: { armado, resumen, sinPropuesta, diagnosticos: diagnosticos.filter((d) => d.codigo !== "comprobacion/sin-armado" && !vistos.has(`${d.codigo}|${d.mensaje}`) && !!vistos.add(`${d.codigo}|${d.mensaje}`)) } };
}

// ─── En planta, por colores (CO6-d) ─────────────────────────────────────────────────────────────

/** Lo que dice el color de una parte. */
export type ClaseAprovechamiento = "cumple" | "alto" | "no-cumple" | "sin-armado" | "no-aplica";

/** Por encima de este aprovechamiento, una parte que cumple va en ámbar. */
export const APROVECHAMIENTO_ALTO = 0.9;

/** Los colores de cada clase (los de la leyenda; en el tema oscuro, la app los aclara). */
export const COLOR_APROVECHAMIENTO: Record<ClaseAprovechamiento, string> = { cumple: "#7cc48f", alto: "#f0b443", "no-cumple": "#e2574c", "sin-armado": "#cfd4db", "no-aplica": "#a3aab5" };

/**
 * La clase de una parte: sin armado, gris; no cumple (alguna fila falla), rojo; cumple con el
 * aprovechamiento por encima de `APROVECHAMIENTO_ALTO`, o sin comprobar del todo (lo que queda
 * pendiente, sin que nada falle), ámbar; el resto, verde.
 */
export function claseAprovechamiento(p: ParteComprobada): ClaseAprovechamiento {
  if (p.origen === "no-aplica") return "no-aplica";
  if (p.origen === "sin-armado") return "sin-armado";
  if (!p.cumple) return !p.fallan && p.pendientes.length ? "alto" : "no-cumple";
  return (p.aprovechamiento ?? 0) > APROVECHAMIENTO_ALTO ? "alto" : "cumple";
}

/** Los textos de la leyenda (sin «, » ni « (»: la de la app los corta ahí). */
export const TEXTO_CLASE: Record<ClaseAprovechamiento, string> = {
  cumple: `Cumple con ${numeroFijo(APROVECHAMIENTO_ALTO, 2)} o menos`,
  alto: `Cumple con más de ${numeroFijo(APROVECHAMIENTO_ALTO, 2)} o sin comprobar del todo`,
  "no-cumple": "No cumple",
  "sin-armado": "Sin armado",
  "no-aplica": "No se comprueba: dentro del ancho de sus vigas",
};

/** El trozo de una polilínea entre dos estaciones a lo largo de ella (m). */
export function trozo(p: readonly Vec2[], s0: number, s1: number): Vec2[] {
  const r: Vec2[] = [];
  let s = 0;
  for (let i = 1; i < p.length; i++) {
    const [a, b] = [p[i - 1]!, p[i]!];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [t0, t1] = [Math.max(s0, s), Math.min(s1, s + l)];
    if (l > 0 && t1 > t0) {
      const en = (t: number): Vec2 => [a[0] + ((b[0] - a[0]) * (t - s)) / l, a[1] + ((b[1] - a[1]) * (t - s)) / l];
      if (!r.length) r.push(en(t0));
      r.push(en(t1));
    }
    s += l;
  }
  return r;
}

/**
 * En el punzonamiento, un clic en un ábaco es un clic en su pilar: lo que el fondo dibuja de cada
 * ábaco (`<losa>/A<n>`) que contiene el centro de uno de `pilares` pasa a llevar su id.
 */
export function abacosDePilares(P: Primitiva[], pilares: readonly { id: string; c: Vec2 }[]): void {
  const de = new Map<string, string>();
  // (el centro de un pilar de borde o de esquina cae justo en el contorno de su ábaco: a 1 cm vale)
  const aBorde = (c: Vec2, a: readonly Vec2[]) => {
    let m = Infinity;
    for (let i = 0; i < a.length; i++) {
      const [p, q] = [a[i]!, a[(i + 1) % a.length]!];
      const [ex, ey] = [q[0] - p[0], q[1] - p[1]];
      const L2 = ex * ex + ey * ey;
      const t = L2 > 0 ? Math.min(1, Math.max(0, ((c[0] - p[0]) * ex + (c[1] - p[1]) * ey) / L2)) : 0;
      m = Math.min(m, Math.hypot(c[0] - p[0] - t * ex, c[1] - p[1] - t * ey));
    }
    return m;
  };
  for (const x of P) {
    if (x.tipo !== "poligono" || !x.objeto || !/\/A[1-9]\d*$/.test(x.objeto) || de.has(x.objeto)) continue;
    const anillo = x.anillos[0];
    if (!anillo) continue;
    const p = pilares.find((y) => puntoEnPoligono(y.c, anillo)) ?? pilares.find((y) => aBorde(y.c, anillo) <= 0.01);
    if (p) de.set(x.objeto, p.id);
  }
  if (!de.size) return;
  for (let i = 0; i < P.length; i++) {
    const x = P[i]!;
    const id = "objeto" in x && x.objeto ? de.get(x.objeto) : undefined;
    if (id) P[i] = { ...x, objeto: id } as Primitiva;
  }
}

const NOMBRE_VISTA: Record<TipoComprobacion, string> = { pilares: "los tramos de pilar que llegan a la planta", vigas: "los vanos de las vigas de la planta", losas: "las losas de la planta", punzonamiento: "el punzonamiento de las losas de la planta junto a cada pilar" };

/** La planta con cada parte de un tipo del color de su aprovechamiento: la escena de la vista `comprobacion`. */
export function vistaComprobacion(s: Sesion, planta: string, tipo: TipoComprobacion, armado: ArmadoProyecto | undefined, d: DatosVista): Resultado<Escena> {
  const r = alDia(s, tipo, armado);
  if (!r.valido) return r;
  const pl = new PlantaFisica(s.proyecto.modelo, planta);
  const P: Primitiva[] = [...fondoModelo(pl, { atenuado: true }).primitivas];
  const textos: Primitiva[] = [];
  const extremos: ExtremoRotulado[] = [];
  const usadas = new Set<ClaseAprovechamiento>();
  const valor = (p: ParteComprobada) => (p.aprovechamiento === null ? "—" : numeroFijo(p.aprovechamiento, 2));
  const anotar = (p: ParteComprobada, anillos: Vec2[][], donde: Vec2, rotulo: string, giro?: number) => {
    const clase = claseAprovechamiento(p);
    usadas.add(clase);
    for (const a of anillos) P.push({ tipo: "poligono", anillos: [a], estilo: "contorno", relleno: COLOR_APROVECHAMIENTO[clase], objeto: p.pieza });
    textos.push({ tipo: "texto", p: donde, texto: rotulo, tamano: 11, ancla: "medio", dy: 4, fondo: true, prioridad: clase === "no-cumple" ? 60 : 50, ...(giro !== undefined ? { giro } : {}), objeto: p.pieza });
    if (p.aprovechamiento !== null) extremos.push({ que: `aprovechamiento de ${p.clave}${p.manda ? ` (${p.manda.descripcion})` : ""}`, valor: p.aprovechamiento, unidad: "", objeto: p.pieza, punto: donde, ...(p.manda?.comb ? { comb: p.manda.comb } : {}) });
  };
  const partes = r.valor.fichas.map(sinFilas);
  if (tipo === "pilares" || tipo === "punzonamiento") {
    // El tramo con la cabeza en la planta, o la unión con la losa de la planta: en la huella del pilar
    const pilares = new Map(pl.pilares().map((x) => [x.p.id, x]));
    const centros: { id: string; c: Vec2 }[] = [];
    for (const p of partes) {
      if (p.planta !== planta) continue;
      const x = pilares.get(p.pieza);
      const h = x && huellaSeccion(x.p, x.seccion);
      if (!h) continue;
      const anillo = "anillo" in h ? h.anillo : circuloPilar(h.centro, h.radio);
      const c: Vec2 = "anillo" in h ? [h.anillo.reduce((a, q) => a + q[0], 0) / h.anillo.length, h.anillo.reduce((a, q) => a + q[1], 0) / h.anillo.length] : h.centro;
      const lado = Math.max(...anillo.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1])));
      anotar(p, [anillo], [c[0], c[1] + lado], p.origen === "no-aplica" ? `${p.pieza} · no se comprueba` : `${p.pieza} ${valor(p)}`);
      centros.push({ id: p.pieza, c });
    }
    if (tipo === "punzonamiento") abacosDePilares(P, centros);
  } else if (tipo === "vigas") {
    const vigas = new Map(pl.enPlanta(pl.f.vigas).map((v) => [v.id, v]));
    for (const p of partes) {
      const v = vigas.get(p.pieza);
      if (!v || !p.tramo) continue;
      const linea = trozo(v.puntos, p.tramo[0], p.tramo[1]);
      if (linea.length < 2) continue;
      const b = Math.max(anchoViga(pl.f.secciones?.find((x) => x.id === v.seccion)), 0.1);
      // El rótulo, en el medio del vano a lo largo de la viga
      const medio = trozo(v.puntos, (p.tramo[0] + p.tramo[1]) / 2 - 1e-6, (p.tramo[0] + p.tramo[1]) / 2 + 1e-6);
      const m = medio[0] ?? linea[0]!;
      const dir: Vec2 = medio.length > 1 ? [medio[1]![0] - medio[0]![0], medio[1]![1] - medio[0]![1]] : [linea[1]![0] - linea[0]![0], linea[1]![1] - linea[0]![1]];
      anotar(p, bandaPolilinea(linea, b), m, valor(p), giroTexto(dir));
    }
  } else {
    const losas = new Map(pl.enPlanta(pl.f.losas).map((l) => [l.id, l]));
    const coloreadas = new Map<string, Primitiva>();
    for (const p of partes) {
      const l = losas.get(p.pieza);
      if (!l) continue;
      const c: Vec2 = [l.contorno.reduce((a, q) => a + q[0], 0) / l.contorno.length, l.contorno.reduce((a, q) => a + q[1], 0) / l.contorno.length];
      const anillos = [l.contorno.map((q) => [q[0], q[1]] as Vec2), ...(l.huecos ?? []).map((h) => h.map((q) => [q[0], q[1]] as Vec2))];
      // Un polígono con sus huecos (el relleno, par-impar), en el sitio de la losa del fondo
      const clase = claseAprovechamiento(p);
      usadas.add(clase);
      coloreadas.set(l.id, { tipo: "poligono", anillos, estilo: "contorno", relleno: COLOR_APROVECHAMIENTO[clase], objeto: p.pieza });
      textos.push({ tipo: "texto", p: c, texto: `${p.pieza} ${valor(p)}`, tamano: 11, ancla: "medio", fondo: true, prioridad: 60, objeto: p.pieza });
      if (p.aprovechamiento !== null) extremos.push({ que: `aprovechamiento de ${p.clave}${p.manda ? ` (${p.manda.descripcion})` : ""}`, valor: p.aprovechamiento, unidad: "", objeto: p.pieza, punto: c, ...(p.manda?.comb ? { comb: p.manda.comb } : {}) });
    }
    // Cada losa coloreada, donde el fondo dibuja la suya y sus ábacos (lo que lleva su id): así las
    // vigas, los pilares y los muros quedan encima
    const de = (o: string | undefined) => (o === undefined ? undefined : [...coloreadas.keys()].find((id) => o === id || o.startsWith(`${id}/`)));
    const puestas = new Set<string>();
    const fondo = P.splice(0);
    for (const x of fondo) {
      const l = x.tipo === "poligono" || x.tipo === "linea" ? de(x.objeto) : undefined;
      if (!l) P.push(x);
      else if (!puestas.has(l)) {
        puestas.add(l);
        P.push(coloreadas.get(l)!);
      }
    }
    for (const [id, x] of coloreadas) if (!puestas.has(id)) P.push(x);
  }
  const leyenda: EntradaLeyenda[] = (["no-cumple", "alto", "cumple", "sin-armado", "no-aplica"] as const).filter((x) => usadas.has(x)).map((x) => ({ relleno: COLOR_APROVECHAMIENTO[x], texto: TEXTO_CLASE[x] }));
  const ninguna = !usadas.size;
  return {
    valido: true,
    valor: {
      titulo: d.nombre ?? "Proyecto",
      cabecera: cabecera(pl, `Vista: comprobación de ${NOMBRE_VISTA[tipo]}, con su armado`, d),
      primitivas: [...P, ...textos],
      leyenda,
      tituloLeyenda: "Aprovechamiento (la comprobación que manda)",
      notas: [
        "Rótulo: el aprovechamiento de la comprobación que manda (la que no cumple, si la hay; si no, la de agotamiento más alta). Todas, en la ficha de cada pieza.",
        ...(ninguna ? [tipo === "pilares" ? "Ningún tramo de pilar tiene la cabeza en esta planta." : tipo === "vigas" ? "No hay vigas en esta planta." : tipo === "losas" ? "No hay losas macizas ni reticulares en esta planta." : "Ninguna losa de esta planta pasa carga a un pilar por su huella."] : []),
      ],
      extremos: extremos.sort((a, b) => b.valor - a.valor),
      caja: caja(pl),
    },
  };
}
