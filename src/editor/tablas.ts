/**
 * Tablas del editor (V2a, `docs/fem3d/visor.md` §6.2): plantas, ejes (I2), materiales, secciones, pilares,
 * vigas, losas, apoyos, casos y cargas. Cada tabla pasa de un objeto del modelo físico a una fila de
 * textos (`fila`) y de una fila a un objeto (`objeto`); escribir en una celda, pegar desde Excel y
 * copiar a Excel usan las mismas dos funciones, así que lo que se ve es lo que se guarda.
 *
 * - Ida y vuelta: `objeto(fila(o))` es `o` para todo lo que la tabla edita.
 * - Lo que la tabla no edita (un reticular, un perfil I, un empuje…; son de V2b) se conserva del
 *   objeto anterior (`base`), y una fila nueva no puede crearlo.
 * - Las columnas que no aplican a la variante de una fila (el D de una sección rectangular) tienen
 *   que estar vacías: así un dato no se pierde en silencio.
 *
 * Puro: sin IO.
 */
import type { CargaFisica, CasoFisico, EjeReplanteo, Losa, Material, ModeloFisico, Pilar, Planta, Seccion, Viga, ApoyoFisico, AccionCaso } from "../compilador/fisico.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import { Lector, textoBooleano, textoGdl, textoNumero, textoPoligonos, textoPuntos, textoVector, type ErrorCelda, type Fila } from "./celdas.ts";
import { indiceIds, lista, type Coleccion, type Objeto } from "./referencias.ts";

export const TABLAS = ["plantas", "ejes", "materiales", "secciones", "pilares", "vigas", "losas", "apoyos", "casos", "cargas"] as const;
export type NombreTabla = (typeof TABLAS)[number];

export interface Columna {
  clave: string;
  titulo: string;
  unidad?: string;
  /** Qué va en la celda y en qué formato. */
  ayuda?: string;
  /** Sólo se ve: sale del modelo (la cota de una planta). */
  calculada?: boolean;
}

export type Lectura = { ok: true; objeto: Objeto } | { ok: false; errores: ErrorCelda[] };

/** Lo que una tabla necesita del modelo: de qué colección es un id. */
export interface Contexto {
  modelo: ModeloFisico;
  coleccionDe(id: string): Coleccion | undefined;
}

export function contexto(modelo: ModeloFisico): Contexto {
  const idx = indiceIds(modelo);
  return { modelo, coleccionDe: (id) => idx.get(id)?.coleccion };
}

export interface DefTabla {
  nombre: NombreTabla;
  titulo: string;
  coleccion: Coleccion;
  /** Prefijo de los ids nuevos. */
  prefijo: string;
  columnas: readonly Columna[];
  fila(o: Objeto, ctx: Contexto): Fila;
  objeto(f: Fila, ctx: Contexto, base?: Objeto): Lectura;
  /** Las plantas en las que se ve el objeto (null: en todas, como las plantas o los casos). */
  plantas(o: Objeto, ctx: Contexto): string[] | null;
}

// ─── Utilidades ─────────────────────────────────────────────────────────────────────────────────

const n = (v: number | undefined | null): string => (v === undefined || v === null ? "" : textoNumero(v));
const s = (v: string | undefined): string => v ?? "";

/** Quita las claves con undefined (para que la ida y vuelta dé el mismo objeto). */
function limpio<T extends Record<string, unknown>>(o: T): T {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v;
  return r as T;
}

const resultado = (L: Lector, o: Record<string, unknown>): Lectura => (L.errores.length ? { ok: false, errores: L.errores } : { ok: true, objeto: limpio(o) as Objeto });

const GDL = "seis cifras 1 o 0, en el orden N Vy Vz T My Mz («000011»)";
const COARTADOS = "seis cifras 1 o 0, en el orden ux uy uz rx ry rz («111111»)";

/** Plantas entre dos (las de un pilar), en el orden del modelo. */
function rango(m: ModeloFisico, desde: unknown, hasta: unknown): string[] {
  const ids = m.plantas.map((p) => p.id);
  const a = ids.indexOf(desde as string);
  const b = ids.indexOf(hasta as string);
  return a < 0 || b < 0 ? [] : ids.slice(Math.min(a, b), Math.max(a, b) + 1);
}

const id: Columna = { clave: "id", titulo: "id", ayuda: "único en todo el modelo; vacío en una fila nueva: se pone solo" };
const nombre: Columna = { clave: "nombre", titulo: "nombre" };

// ─── Plantas ────────────────────────────────────────────────────────────────────────────────────

const plantas: DefTabla = {
  nombre: "plantas",
  titulo: "Plantas",
  coleccion: "plantas",
  prefijo: "N",
  columnas: [
    id,
    nombre,
    { clave: "tipo", titulo: "tipo", ayuda: "planta (por defecto), sotano o cubierta" },
    { clave: "altura", titulo: "altura", unidad: "m", ayuda: "de forjado a forjado hasta la planta de encima; vacía en la de arriba" },
    { clave: "cota", titulo: "cota", unidad: "m", calculada: true },
    { clave: "diafragma", titulo: "diafragma", ayuda: "rigido o ninguno; por defecto, rígido salvo en la más baja (C1-d)" },
  ],
  fila(o, ctx) {
    const p = o as unknown as Planta;
    const i = ctx.modelo.plantas.findIndex((x) => x.id === p.id);
    const cota = i >= 0 ? cotasPlantas(ctx.modelo.plantas)[i] : null;
    return { id: p.id, nombre: s(p.nombre), tipo: s(p.tipo), altura: n(p.altura), cota: n(cota ?? null), diafragma: s(p.diafragma) };
  },
  objeto(f, _ctx, base) {
    const L = new Lector(f);
    return resultado(L, {
      ...base,
      id: L.texto("id") ?? "",
      nombre: L.texto("nombre"),
      tipo: L.opcion("tipo", ["planta", "sotano", "cubierta"] as const),
      altura: L.numero("altura", { mayorQue: 0 }) ?? null,
      diafragma: L.opcion("diafragma", ["rigido", "ninguno"] as const),
    });
  },
  plantas: () => null,
};

// ─── Materiales ─────────────────────────────────────────────────────────────────────────────────

const materiales: DefTabla = {
  nombre: "materiales",
  titulo: "Materiales",
  coleccion: "materiales",
  prefijo: "M",
  columnas: [
    id,
    { clave: "tipo", titulo: "tipo", ayuda: "hormigon, acero o general" },
    { clave: "fck", titulo: "fck", unidad: "MPa", ayuda: "hormigón: E = 8500·∛(fck + 8)" },
    // El modelo físico da el E del acero en MPa y el de un material general en kN/m²: dos columnas, cada una con su unidad
    { clave: "Eacero", titulo: "E acero", unidad: "MPa", ayuda: "sólo acero; por defecto, 210 000" },
    { clave: "E", titulo: "E general", unidad: "kN/m²", ayuda: "sólo general" },
    { clave: "G", titulo: "G general", unidad: "kN/m²", ayuda: "sólo general" },
    { clave: "nu", titulo: "ν", ayuda: "sólo hormigón; por defecto, 0,2" },
    { clave: "peso", titulo: "γ", unidad: "kN/m³", ayuda: "por defecto, 25 (hormigón) o 78,5 (acero)" },
  ],
  fila(o) {
    const m = o as unknown as Material;
    return {
      id: m.id,
      tipo: m.tipo,
      fck: m.tipo === "hormigon" ? n(m.fck) : "",
      Eacero: m.tipo === "acero" ? n(m.E) : "",
      E: m.tipo === "general" ? n(m.E) : "",
      G: m.tipo === "general" ? n(m.G) : "",
      nu: m.tipo === "hormigon" ? n(m.nu) : "",
      peso: n(m.peso),
    };
  },
  objeto(f, _ctx, base) {
    const L = new Lector(f);
    const tipo = L.opcion("tipo", ["hormigon", "acero", "general"] as const, { obligatorio: true });
    const comun = { id: L.texto("id") ?? "", tipo };
    const sinBase = (b: Objeto | undefined) => (b && b.tipo === tipo ? b : undefined);
    if (tipo === "hormigon") {
      L.vacias(["Eacero", "E", "G"], "al hormigón (su E sale de fck)");
      return resultado(L, { ...sinBase(base), ...comun, fck: L.numero("fck", { obligatorio: true, mayorQue: 0 }), nu: L.numero("nu", { min: 0, max: 0.5 }), peso: L.numero("peso", { min: 0 }) });
    }
    if (tipo === "acero") {
      L.vacias(["fck", "E", "G", "nu"], "al acero (su E va en «E acero», en MPa)");
      return resultado(L, { ...sinBase(base), ...comun, E: L.numero("Eacero", { mayorQue: 0 }), peso: L.numero("peso", { min: 0 }) });
    }
    if (tipo === "general") {
      L.vacias(["fck", "Eacero", "nu"], "a un material general (E y G en kN/m²)");
      return resultado(L, { ...sinBase(base), ...comun, E: L.numero("E", { obligatorio: true, mayorQue: 0 }), G: L.numero("G", { obligatorio: true, mayorQue: 0 }), peso: L.numero("peso", { obligatorio: true, min: 0 }) });
    }
    return { ok: false, errores: L.errores };
  },
  plantas: () => null,
};

// ─── Secciones ──────────────────────────────────────────────────────────────────────────────────

const DIM = ["b", "h", "D", "bf", "hf", "bw", "A", "Iy", "Iz", "J", "Avy", "Avz"] as const;
const secciones: DefTabla = {
  nombre: "secciones",
  titulo: "Secciones",
  coleccion: "secciones",
  prefijo: "S",
  columnas: [
    id,
    { clave: "material", titulo: "material" },
    { clave: "forma", titulo: "forma", ayuda: "rectangular, circular, T o general (los perfiles I, en el JSON por ahora)" },
    { clave: "b", titulo: "b", unidad: "m", ayuda: "ancho (según y local); en general, la huella del pilar" },
    { clave: "h", titulo: "h", unidad: "m", ayuda: "canto (según z local)" },
    { clave: "D", titulo: "D", unidad: "m", ayuda: "diámetro" },
    { clave: "bf", titulo: "bf", unidad: "m", ayuda: "T: ancho del ala" },
    { clave: "hf", titulo: "hf", unidad: "m", ayuda: "T: espesor del ala" },
    { clave: "bw", titulo: "bw", unidad: "m", ayuda: "T: ancho del alma" },
    { clave: "A", titulo: "A", unidad: "m²", ayuda: "general" },
    { clave: "Iy", titulo: "Iy", unidad: "m⁴", ayuda: "general: la de My" },
    { clave: "Iz", titulo: "Iz", unidad: "m⁴", ayuda: "general: la de Mz" },
    { clave: "J", titulo: "J", unidad: "m⁴", ayuda: "general" },
    { clave: "Avy", titulo: "Avy", unidad: "m²", ayuda: "general; sin ella, Euler–Bernoulli" },
    { clave: "Avz", titulo: "Avz", unidad: "m²", ayuda: "general; sin ella, Euler–Bernoulli" },
  ],
  fila(o) {
    const x = o as unknown as Seccion & Record<string, unknown>;
    const r: Record<string, string> = { id: x.id, material: x.material, forma: x.forma };
    for (const k of DIM) r[k] = typeof x[k] === "number" ? n(x[k] as number) : "";
    return r;
  },
  objeto(f, _ctx, base) {
    const L = new Lector(f);
    const forma = L.opcion("forma", ["rectangular", "circular", "T", "general", "I"] as const, { obligatorio: true });
    const comun = { id: L.texto("id") ?? "", material: L.texto("material", { obligatorio: true }), forma };
    const usa = (cs: readonly (typeof DIM)[number][]) => L.vacias(DIM.filter((k) => !cs.includes(k)), `a la forma ${forma}`);
    const pos = (c: string, obligatorio = true) => L.numero(c, { obligatorio, mayorQue: 0 });
    switch (forma) {
      case "rectangular":
        usa(["b", "h"]);
        return resultado(L, { ...comun, b: pos("b"), h: pos("h") });
      case "circular":
        usa(["D"]);
        return resultado(L, { ...comun, D: pos("D") });
      case "T":
        usa(["bf", "hf", "bw", "h"]);
        return resultado(L, { ...comun, bf: pos("bf"), hf: pos("hf"), bw: pos("bw"), h: pos("h") });
      case "general":
        usa(["A", "Iy", "Iz", "J", "Avy", "Avz", "b", "h"]);
        return resultado(L, { ...comun, A: pos("A"), Iy: pos("Iy"), Iz: pos("Iz"), J: pos("J"), Avy: pos("Avy", false), Avz: pos("Avz", false), b: pos("b", false), h: pos("h", false) });
      case "I":
        usa([]);
        if (!base || base.forma !== "I") L.errores.push({ columna: "forma", mensaje: "los perfiles I se meten por ahora en el JSON (su catálogo llega con V2b)" });
        return resultado(L, { ...comun, perfil: base?.perfil });
    }
    return { ok: false, errores: L.errores };
  },
  plantas: () => null,
};

// ─── Pilares ────────────────────────────────────────────────────────────────────────────────────

const pilares: DefTabla = {
  nombre: "pilares",
  titulo: "Pilares",
  coleccion: "pilares",
  prefijo: "P",
  columnas: [
    id,
    nombre,
    { clave: "x", titulo: "x", unidad: "m" },
    { clave: "y", titulo: "y", unidad: "m" },
    { clave: "desde", titulo: "desde", ayuda: "planta de la base" },
    { clave: "hasta", titulo: "hasta", ayuda: "planta de la cabeza" },
    { clave: "seccion", titulo: "sección" },
    { clave: "tramos", titulo: "tramos", ayuda: "sección de los tramos que cambian, por la planta de su cabeza: «N3: P30x30; N5: P25x25»" },
    { clave: "giro", titulo: "giro", unidad: "°", ayuda: "del canto h desde +X; por defecto, 0" },
    { clave: "base", titulo: "base", ayuda: "empotrado (por defecto), articulado o ninguno" },
    { clave: "libBase", titulo: "lib. base", ayuda: GDL },
    { clave: "libCabeza", titulo: "lib. cabeza", ayuda: GDL },
  ],
  fila(o) {
    const p = o as unknown as Pilar;
    return {
      id: p.id,
      nombre: s(p.nombre),
      x: n(p.x),
      y: n(p.y),
      desde: p.desde,
      hasta: p.hasta,
      seccion: p.seccion,
      tramos: (p.tramos ?? []).map((t) => `${t.planta}: ${t.seccion}`).join("; "),
      giro: n(p.giro),
      base: s(p.base),
      libBase: p.liberaciones?.base ? textoGdl(p.liberaciones.base) : "",
      libCabeza: p.liberaciones?.cabeza ? textoGdl(p.liberaciones.cabeza) : "",
    };
  },
  objeto(f, _ctx, base) {
    const L = new Lector(f);
    const t = L.texto("tramos");
    let tramos: { planta: string; seccion: string }[] | undefined;
    if (t !== undefined) {
      tramos = [];
      for (const x of t.split(";").map((y) => y.trim()).filter(Boolean)) {
        const m = /^([^:]+):\s*(.+)$/.exec(x);
        if (!m) {
          L.errores.push({ columna: "tramos", mensaje: `«${x}» tiene que ser «planta: sección»` });
          break;
        }
        tramos.push({ planta: m[1]!.trim(), seccion: m[2]!.trim() });
      }
    }
    const lb = L.gdl("libBase");
    const lc = L.gdl("libCabeza");
    return resultado(L, {
      ...base,
      id: L.texto("id") ?? "",
      nombre: L.texto("nombre"),
      x: L.numero("x", { obligatorio: true }),
      y: L.numero("y", { obligatorio: true }),
      desde: L.texto("desde", { obligatorio: true }),
      hasta: L.texto("hasta", { obligatorio: true }),
      seccion: L.texto("seccion", { obligatorio: true }),
      tramos,
      giro: L.numero("giro"),
      base: L.opcion("base", ["empotrado", "articulado", "ninguno"] as const),
      liberaciones: lb || lc ? limpio({ base: lb, cabeza: lc }) : undefined,
    });
  },
  plantas: (o, ctx) => rango(ctx.modelo, o.desde, o.hasta),
};

// ─── Vigas ──────────────────────────────────────────────────────────────────────────────────────

const vigas: DefTabla = {
  nombre: "vigas",
  titulo: "Vigas",
  coleccion: "vigas",
  prefijo: "V",
  columnas: [
    id,
    nombre,
    { clave: "planta", titulo: "planta" },
    { clave: "puntos", titulo: "puntos", unidad: "m", ayuda: "eje en planta: «x y; x y; …» (al menos 2)" },
    { clave: "seccion", titulo: "sección" },
    { clave: "insercion", titulo: "inserción", ayuda: "plano (por defecto: el eje en el plano del forjado, C1-c) o superior" },
    { clave: "libInicio", titulo: "lib. inicio", ayuda: GDL },
    { clave: "libFin", titulo: "lib. fin", ayuda: GDL },
  ],
  fila(o) {
    const v = o as unknown as Viga;
    return {
      id: v.id,
      nombre: s(v.nombre),
      planta: v.planta,
      puntos: textoPuntos(v.puntos),
      seccion: v.seccion,
      insercion: s(v.insercion),
      libInicio: v.liberaciones?.inicio ? textoGdl(v.liberaciones.inicio) : "",
      libFin: v.liberaciones?.fin ? textoGdl(v.liberaciones.fin) : "",
    };
  },
  objeto(f, _ctx, base) {
    const L = new Lector(f);
    const li = L.gdl("libInicio");
    const lf = L.gdl("libFin");
    return resultado(L, {
      ...base,
      id: L.texto("id") ?? "",
      nombre: L.texto("nombre"),
      planta: L.texto("planta", { obligatorio: true }),
      puntos: L.puntos("puntos", { obligatorio: true, min: 2 }),
      seccion: L.texto("seccion", { obligatorio: true }),
      insercion: L.opcion("insercion", ["plano", "superior"] as const),
      liberaciones: li || lf ? limpio({ inicio: li, fin: lf }) : undefined,
    });
  },
  plantas: (o) => [o.planta as string],
};

// ─── Losas ──────────────────────────────────────────────────────────────────────────────────────

const losas: DefTabla = {
  nombre: "losas",
  titulo: "Losas",
  coleccion: "losas",
  prefijo: "L",
  columnas: [
    id,
    nombre,
    { clave: "planta", titulo: "planta" },
    { clave: "contorno", titulo: "contorno", unidad: "m", ayuda: "a ejes: «x y; x y; …» (al menos 3, sin repetir el primero)" },
    { clave: "huecos", titulo: "huecos", unidad: "m", ayuda: "polígonos separados por «|»" },
    { clave: "espesor", titulo: "espesor", unidad: "m" },
    { clave: "material", titulo: "material" },
    { clave: "pp", titulo: "pp", unidad: "kN/m²", ayuda: "peso propio; por defecto, γ·espesor" },
    { clave: "eje1", titulo: "eje 1", unidad: "°", ayuda: "dirección del eje 1 de las láminas desde +X; por defecto, 0" },
    { clave: "reticular", titulo: "reticular", calculada: true, ayuda: "los reticulares se editan en V2b" },
  ],
  fila(o) {
    const l = o as unknown as Losa;
    return {
      id: l.id,
      nombre: s(l.nombre),
      planta: l.planta,
      contorno: textoPuntos(l.contorno),
      huecos: l.huecos?.length ? textoPoligonos(l.huecos) : "",
      espesor: n(l.espesor),
      material: l.material,
      pp: n(l.pp),
      eje1: n(l.eje1),
      reticular: l.reticular ? `nervio ${n(l.reticular.nervio)} cada ${n(l.reticular.intereje)}` : "",
    };
  },
  objeto(f, _ctx, base) {
    const L = new Lector(f);
    return resultado(L, {
      ...base,
      id: L.texto("id") ?? "",
      nombre: L.texto("nombre"),
      planta: L.texto("planta", { obligatorio: true }),
      contorno: L.puntos("contorno", { obligatorio: true, min: 3 }),
      huecos: L.poligonos("huecos"),
      espesor: L.numero("espesor", { obligatorio: true, mayorQue: 0 }),
      material: L.texto("material", { obligatorio: true }),
      pp: L.numero("pp", { min: 0 }),
      eje1: L.numero("eje1"),
    });
  },
  plantas: (o) => [o.planta as string],
};

// ─── Ejes de replanteo ──────────────────────────────────────────────────────────────────────────

const ejes: DefTabla = {
  nombre: "ejes",
  titulo: "Ejes",
  coleccion: "ejes",
  prefijo: "E",
  columnas: [
    { ...id, ayuda: "lo que dicen sus burbujas si no tiene nombre («A», «1»); único en todo el modelo" },
    { ...nombre, ayuda: "lo que dicen sus burbujas, si no es el id" },
    { clave: "x0", titulo: "x desde", unidad: "m" },
    { clave: "y0", titulo: "y desde", unidad: "m" },
    { clave: "x1", titulo: "x hasta", unidad: "m" },
    { clave: "y1", titulo: "y hasta", unidad: "m" },
  ],
  fila(o) {
    const e = o as unknown as EjeReplanteo;
    return { id: e.id, nombre: s(e.nombre), x0: n(e.desde[0]), y0: n(e.desde[1]), x1: n(e.hasta[0]), y1: n(e.hasta[1]) };
  },
  objeto(f, _ctx, base) {
    const L = new Lector(f);
    const [x0, y0, x1, y1] = (["x0", "y0", "x1", "y1"] as const).map((c) => L.numero(c, { obligatorio: true }));
    if (x0 !== undefined && y0 !== undefined && x1 === x0 && y1 === y0) L.errores.push({ columna: "x1", mensaje: "los dos extremos del eje son el mismo punto" });
    return resultado(L, { ...base, id: L.texto("id") ?? "", nombre: L.texto("nombre"), desde: [x0, y0], hasta: [x1, y1] });
  },
  plantas: () => null,
};

// ─── Apoyos ─────────────────────────────────────────────────────────────────────────────────────

const apoyos: DefTabla = {
  nombre: "apoyos",
  titulo: "Apoyos",
  coleccion: "apoyos",
  prefijo: "A",
  columnas: [id, { clave: "planta", titulo: "planta" }, { clave: "x", titulo: "x", unidad: "m" }, { clave: "y", titulo: "y", unidad: "m" }, { clave: "coartados", titulo: "coartados", ayuda: COARTADOS }],
  fila(o) {
    const a = o as unknown as ApoyoFisico;
    return { id: a.id, planta: a.planta, x: n(a.x), y: n(a.y), coartados: textoGdl(a.coartados) };
  },
  objeto(f, _ctx, base) {
    const L = new Lector(f);
    return resultado(L, { ...base, id: L.texto("id") ?? "", planta: L.texto("planta", { obligatorio: true }), x: L.numero("x", { obligatorio: true }), y: L.numero("y", { obligatorio: true }), coartados: L.gdl("coartados", { obligatorio: true }) });
  },
  plantas: (o) => [o.planta as string],
};

// ─── Casos ──────────────────────────────────────────────────────────────────────────────────────

const PSI = ["uso-A", "uso-B", "uso-C", "uso-D", "uso-E", "uso-G", "nieve-hasta-1000", "nieve-mas-de-1000", "viento", "temperatura"] as const;
const casos: DefTabla = {
  nombre: "casos",
  titulo: "Casos",
  coleccion: "casos",
  prefijo: "C",
  columnas: [
    id,
    nombre,
    { clave: "pesoPropio", titulo: "peso propio", ayuda: "«sí» en el caso al que va el peso de las piezas (como mucho, uno)" },
    { clave: "tipo", titulo: "acción", ayuda: "G, Q, S, W, T, E, A o N; vacía: el caso no entra en las combinaciones CTE/NCSE" },
    { clave: "psi", titulo: "ψ", ayuda: `por su nombre (${PSI.join(", ")}) o «ψ0 ψ1 ψ2»` },
    { clave: "familia", titulo: "familia", ayuda: "excluyente: como mucho un caso de la familia por combinación" },
    { clave: "permanente", titulo: "permanente", ayuda: "G: peso (por defecto), empuje o agua" },
    { clave: "direccion", titulo: "dirección", ayuda: "W, E y N: X o Y" },
    { clave: "signo", titulo: "signo", ayuda: "W y N: 1 o -1" },
    { clave: "derivadoDe", titulo: "deriva de", ayuda: "N: id del caso vertical" },
    { clave: "duracion", titulo: "duración", ayuda: "permanente, larga, media, corta o instantanea; por defecto, la del tipo" },
  ],
  fila(o) {
    const c = o as unknown as CasoFisico;
    const a = c.accion;
    return {
      id: c.id,
      nombre: s(c.nombre),
      pesoPropio: textoBooleano(c.pesoPropio),
      tipo: s(a?.tipo),
      psi: a?.psi === undefined ? "" : typeof a.psi === "string" ? a.psi : `${n(a.psi.psi0)} ${n(a.psi.psi1)} ${n(a.psi.psi2)}`,
      familia: s(a?.familia),
      permanente: s(a?.permanente),
      direccion: s(a?.direccion),
      signo: a?.signo === undefined ? "" : String(a.signo),
      derivadoDe: s(a?.derivadoDe),
      duracion: s(a?.duracion),
    };
  },
  objeto(f, _ctx, base) {
    const L = new Lector(f);
    const tipo = L.opcion("tipo", ["G", "Q", "S", "W", "T", "E", "A", "N"] as const);
    let accion: AccionCaso | undefined;
    const ACCION = ["psi", "familia", "permanente", "direccion", "signo", "derivadoDe", "duracion"];
    if (tipo === undefined) L.vacias(ACCION, "sin acción");
    else {
      let psi: AccionCaso["psi"];
      const tp = L.texto("psi");
      if (tp !== undefined) {
        const nombrado = PSI.find((x) => x.toLowerCase() === tp.toLowerCase());
        if (nombrado) psi = nombrado;
        else {
          const v = L.vector("psi");
          if (v) psi = { psi0: v[0], psi1: v[1], psi2: v[2] };
        }
      }
      const signo = L.opcion("signo", ["1", "-1", "+1"] as const);
      accion = limpio({
        ...(base?.accion as object | undefined),
        tipo,
        psi,
        familia: L.texto("familia"),
        permanente: L.opcion("permanente", ["peso", "empuje", "agua"] as const),
        direccion: L.opcion("direccion", ["X", "Y"] as const),
        signo: signo === undefined ? undefined : signo === "-1" ? -1 : 1,
        derivadoDe: L.texto("derivadoDe"),
        duracion: L.opcion("duracion", ["permanente", "larga", "media", "corta", "instantanea"] as const),
      }) as AccionCaso;
    }
    return resultado(L, { ...base, id: L.texto("id") ?? "", nombre: L.texto("nombre"), pesoPropio: L.booleano("pesoPropio"), accion });
  },
  plantas: () => null,
};

// ─── Cargas ─────────────────────────────────────────────────────────────────────────────────────

const CARGA = ["planta", "sobre", "ejes", "x", "y", "F", "M", "q", "qb", "desde", "hasta", "puntos"] as const;
const cargas: DefTabla = {
  nombre: "cargas",
  titulo: "Cargas",
  coleccion: "cargas",
  prefijo: "Q",
  columnas: [
    id,
    { clave: "tipo", titulo: "tipo", ayuda: "puntual, viga, pilar, superficie o lineal (los empujes, en V2b)" },
    { clave: "caso", titulo: "caso" },
    { clave: "planta", titulo: "planta", ayuda: "puntual, superficie y lineal" },
    { clave: "sobre", titulo: "sobre", ayuda: "la viga, el pilar, o la losa o el paño de una de superficie (una de superficie sin losa ni paño necesita su zona en «puntos»)" },
    { clave: "ejes", titulo: "ejes", ayuda: "viga y pilar: global o local" },
    { clave: "x", titulo: "x", unidad: "m", ayuda: "puntual" },
    { clave: "y", titulo: "y", unidad: "m", ayuda: "puntual" },
    { clave: "F", titulo: "F", unidad: "kN", ayuda: "puntual: «Fx Fy Fz» en ejes globales" },
    { clave: "M", titulo: "M", unidad: "kN·m", ayuda: "puntual: «Mx My Mz» en ejes globales" },
    { clave: "q", titulo: "q", ayuda: "«qx qy qz»: kN/m (viga, pilar, lineal) o kN/m² (superficie); hacia abajo es qz < 0" },
    { clave: "qb", titulo: "qb", ayuda: "viga y pilar: q al final del tramo, si varía" },
    { clave: "desde", titulo: "desde", unidad: "m", ayuda: "viga y pilar: estación de inicio; por defecto, la pieza entera" },
    { clave: "hasta", titulo: "hasta", unidad: "m", ayuda: "viga y pilar: estación final" },
    { clave: "puntos", titulo: "puntos", unidad: "m", ayuda: "lineal: la polilínea; superficie: la zona (vacía: la losa o el paño de «sobre» enteros)" },
  ],
  fila(o) {
    const c = o as unknown as CargaFisica;
    const r: Record<string, string> = { id: c.id, tipo: c.tipo, caso: c.caso };
    for (const k of CARGA) r[k] = "";
    switch (c.tipo) {
      case "puntual":
        Object.assign(r, { planta: c.planta, x: n(c.x), y: n(c.y), F: c.F ? textoVector(c.F) : "", M: c.M ? textoVector(c.M) : "" });
        break;
      case "viga":
      case "pilar":
        Object.assign(r, { sobre: c.tipo === "viga" ? c.viga : c.pilar, ejes: c.ejes, q: textoVector(c.q), qb: c.qb ? textoVector(c.qb) : "", desde: n(c.desde), hasta: n(c.hasta) });
        break;
      case "superficie":
        Object.assign(r, { planta: c.planta, sobre: c.losa ?? c.pano ?? "", q: textoVector(c.q), puntos: c.zona ? textoPuntos(c.zona) : "" });
        break;
      case "lineal":
        Object.assign(r, { planta: c.planta, q: textoVector(c.q), puntos: textoPuntos(c.puntos) });
        break;
      case "empuje":
        r.sobre = c.muro;
        break;
    }
    return r;
  },
  objeto(f, ctx, base) {
    const L = new Lector(f);
    const tipo = L.opcion("tipo", ["puntual", "viga", "pilar", "superficie", "lineal", "empuje"] as const, { obligatorio: true });
    const comun = { tipo, id: L.texto("id") ?? "", caso: L.texto("caso", { obligatorio: true }) };
    const usa = (cs: readonly (typeof CARGA)[number][]) => L.vacias(CARGA.filter((k) => !cs.includes(k)), `a una carga ${tipo}`);
    switch (tipo) {
      case "puntual":
        usa(["planta", "x", "y", "F", "M"]);
        return resultado(L, { ...comun, planta: L.texto("planta", { obligatorio: true }), x: L.numero("x", { obligatorio: true }), y: L.numero("y", { obligatorio: true }), F: L.vector("F"), M: L.vector("M") });
      case "viga":
      case "pilar":
        usa(["sobre", "ejes", "q", "qb", "desde", "hasta"]);
        return resultado(L, {
          ...comun,
          [tipo]: L.texto("sobre", { obligatorio: true }),
          ejes: L.opcion("ejes", ["global", "local"] as const, { obligatorio: true }),
          q: L.vector("q", { obligatorio: true }),
          qb: L.vector("qb"),
          desde: L.numero("desde", { min: 0 }),
          hasta: L.numero("hasta", { min: 0 }),
        });
      case "superficie": {
        usa(["planta", "sobre", "q", "puntos"]);
        const sobre = L.texto("sobre");
        const pano = sobre !== undefined && ctx.coleccionDe(sobre) === "panos";
        return resultado(L, { ...comun, planta: L.texto("planta", { obligatorio: true }), q: L.vector("q", { obligatorio: true }), losa: pano ? undefined : sobre, pano: pano ? sobre : undefined, zona: L.puntos("puntos", { min: 3 }) });
      }
      case "lineal":
        usa(["planta", "puntos", "q"]);
        return resultado(L, { ...comun, planta: L.texto("planta", { obligatorio: true }), puntos: L.puntos("puntos", { obligatorio: true, min: 2 }), q: L.vector("q", { obligatorio: true }) });
      case "empuje":
        if (!base || base.tipo !== "empuje") L.errores.push({ columna: "tipo", mensaje: "los empujes se meten por ahora en el JSON (llegan con los muros, en V2b)" });
        return resultado(L, { ...base, ...comun });
    }
    return { ok: false, errores: L.errores };
  },
  plantas(o, ctx) {
    const c = o as unknown as CargaFisica;
    if (c.tipo === "viga") return [(lista(ctx.modelo, "vigas").find((v) => v.id === c.viga)?.planta as string) ?? ""];
    if (c.tipo === "pilar") {
      const p = lista(ctx.modelo, "pilares").find((v) => v.id === c.pilar);
      return p ? rango(ctx.modelo, p.desde, p.hasta) : [];
    }
    if (c.tipo === "empuje") {
      const m = lista(ctx.modelo, "muros").find((v) => v.id === c.muro);
      return m ? rango(ctx.modelo, m.desde, m.hasta) : [];
    }
    return [c.planta];
  },
};

export const DEF_TABLAS: Readonly<Record<NombreTabla, DefTabla>> = { plantas, ejes, materiales, secciones, pilares, vigas, losas, apoyos, casos, cargas };

/** Un id libre con el prefijo de la tabla: el primero de `<prefijo>1`, `<prefijo>2`… que no está en el modelo. */
export function idNuevo(m: ModeloFisico, prefijo: string, ocupados: ReadonlySet<string> = new Set()): string {
  const idx = indiceIds(m);
  for (let i = 1; ; i++) {
    const x = `${prefijo}${i}`;
    if (!idx.has(x) && !ocupados.has(x)) return x;
  }
}
