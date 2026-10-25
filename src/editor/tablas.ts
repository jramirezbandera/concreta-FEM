/**
 * Tablas del editor (V2a, `docs/fem3d/visor.md` §6.2; V2b, §7.2): plantas, ejes (I2), materiales,
 * secciones, pilares, vigas, forjados (losas macizas, reticulares y paños unidireccionales, con su
 * tipo, como los paños de CYPECAD), muros, apoyos, apoyos lineales, casos y cargas (con los empujes). Cada tabla pasa de un objeto del modelo físico a una fila de
 * textos (`fila`) y de una fila a un objeto (`objeto`); escribir en una celda, pegar desde Excel y
 * copiar a Excel usan las mismas dos funciones, así que lo que se ve es lo que se guarda.
 *
 * - Ida y vuelta: `objeto(fila(o))` es `o` para todo lo que la tabla edita.
 * - Lo que la tabla no edita (un perfil I del catálogo) se conserva del objeto anterior (`base`), y
 *   una fila nueva no puede crearlo. Desde V2b es lo único: lo demás se ve y se edita.
 * - Las columnas que no aplican a la variante de una fila (el D de una sección rectangular) tienen
 *   que estar vacías: así un dato no se pierde en silencio.
 *
 * Puro: sin IO.
 */
import type { AccionCaso, ApoyoFisico, ApoyoLineal, CargaFisica, CasoFisico, EjeReplanteo, Losa, Material, ModeloFisico, Muro, PanoUnidireccional, Pilar, Planta, Seccion, Viga } from "../compilador/fisico.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import { PUNTOS_FIJOS } from "../compilador/puntoFijo.ts";
import { describirCaso } from "./casos.ts";
import { describirMaterial, describirSeccion } from "./gestores.ts";
import { Lector, textoBooleano, textoClaves, textoGdl, textoGrupos, textoNumero, textoPoligonos, textoPuntos, textoVector, type ErrorCelda, type Fila } from "./celdas.ts";
import { indiceIds, lista, type Coleccion, type Objeto } from "./referencias.ts";

export const TABLAS = ["plantas", "ejes", "materiales", "secciones", "pilares", "vigas", "forjados", "muros", "apoyos", "apoyosLineales", "casos", "cargas"] as const;
export type NombreTabla = (typeof TABLAS)[number];

export interface Columna {
  clave: string;
  titulo: string;
  unidad?: string;
  /** Qué va en la celda y en qué formato. */
  ayuda?: string;
  /** Sólo se ve: sale del modelo (la cota de una planta). */
  calculada?: boolean;
  /**
   * Los valores que admite (una lista cerrada o los ids de otra colección), para elegirlos en un
   * desplegable; la celda se sigue pudiendo escribir y pegar. En una columna opcional, la primera
   * es «» (sin dar: el valor por defecto).
   */
  opciones?: (ctx: Contexto) => readonly Opcion[];
  /**
   * GE: la lista de la que elige la columna (`opciones` son sus ids), para que la interfaz ofrezca
   * «Nueva…» y «Editar…» junto a ellas. Sólo las que tienen gestor (GE1: secciones y materiales;
   * GE2: casos; GE3: plantas).
   */
  referencia?: "secciones" | "materiales" | "casos" | "plantas";
}

/** Una opción de un desplegable: el texto de la celda y, si es otro, lo que se ve en la lista. */
export interface Opcion {
  valor: string;
  texto?: string;
}

/** Las opciones con el valor actual delante si no está entre ellas (escrito o pegado), para que se vea lo que hay. */
export function conActual(opciones: readonly Opcion[], valor: string): readonly Opcion[] {
  return opciones.some((o) => o.valor === valor) ? opciones : [{ valor, texto: valor || "—" }, ...opciones];
}

/** Lo leído de una fila; `coleccion`, la lista del modelo en que va (en una tabla de varias, como Forjados). */
export type Lectura = { ok: true; objeto: Objeto; coleccion?: Coleccion } | { ok: false; errores: ErrorCelda[] };

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
  /**
   * Las listas del modelo que enseña, en este orden. Casi todas, una; Forjados, las losas (macizas y
   * reticulares) y los paños unidireccionales, porque para el ingeniero son la misma cosa con otro
   * tipo. En una de varias, `objeto` dice en cuál va cada fila.
   */
  colecciones: readonly Coleccion[];
  /** Prefijo de los ids nuevos. */
  prefijo: string;
  /** El prefijo de un id nuevo según la fila (Forjados: «F» para un unidireccional, como Renumerar). */
  prefijoDe?(f: Fila): string;
  columnas: readonly Columna[];
  fila(o: Objeto, ctx: Contexto): Fila;
  objeto(f: Fila, ctx: Contexto, base?: Objeto): Lectura;
  /** Las plantas en las que se ve el objeto (null: en todas, como las plantas o los casos). */
  plantas(o: Objeto, ctx: Contexto): string[] | null;
  /** ¿La columna aplica a la fila? Lo que no aplica va vacío y la hoja lo apaga (Forjados: según su tipo). Sin ella, todas. */
  aplica?(clave: string, f: Fila): boolean;
  /**
   * La fila con `valor` escrito en `clave`. Por defecto, sólo esa celda; en Forjados, cambiar el tipo
   * vacía lo que deja de aplicar y el pp (que es otro en cada tipo), para no arrastrar un dato que ya
   * no significa lo mismo.
   */
  conValor?(f: Fila, clave: string, valor: string): Fila;
}

/** La fila con `valor` escrito en `clave`, con lo que la tabla haga al cambiarla (`DefTabla.conValor`). */
export function filaConValor(def: DefTabla, f: Fila, clave: string, valor: string): Fila {
  return def.conValor ? def.conValor(f, clave, valor) : { ...f, [clave]: valor };
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

/** Opciones de una lista cerrada; con `defecto`, la columna es opcional y la vacía va primero. */
const fijas =
  (valores: readonly string[], defecto?: string) =>
  (): readonly Opcion[] => [...(defecto === undefined ? [] : [{ valor: "", texto: `(${defecto})` }]), ...valores.map((valor) => ({ valor }))];

/** Las plantas, de arriba abajo como en el modelo, con su cota. */
function opcionesPlantas(ctx: Contexto): Opcion[] {
  const cotas = cotasPlantas(ctx.modelo.plantas);
  return ctx.modelo.plantas.map((p, i) => {
    const z = cotas[i];
    return { valor: p.id, texto: `${p.id}${p.nombre ? ` · ${p.nombre}` : ""}${z === null || z === undefined ? "" : ` (${z > 0 ? "+" : ""}${z.toFixed(2).replace(".", ",")} m)`}` };
  });
}

/**
 * GE: las secciones o los materiales, con lo que es cada uno («P30x30 · rect. 30 × 30 · HA-30»), y
 * la columna marcada para que la interfaz ofrezca crear y editar.
 */
const secciones_ = (defecto?: string) =>
  (ctx: Contexto): Opcion[] => [...(defecto === undefined ? [] : [{ valor: "", texto: `(${defecto})` }]), ...ctx.modelo.secciones.map((x) => ({ valor: x.id, texto: `${x.id} · ${describirSeccion(x)}` }))];
/** GE2: los casos, con su nombre y lo que son para las combinaciones («W+X · Viento +X · W · viento +X · familia W»). */
const casos_ = (defecto?: string) =>
  (ctx: Contexto): Opcion[] => [
    ...(defecto === undefined ? [] : [{ valor: "", texto: `(${defecto})` }]),
    ...(ctx.modelo.casos ?? []).map((x) => ({ valor: x.id, texto: `${x.id}${x.nombre ? ` · ${x.nombre}` : ""} · ${describirCaso(x)}` })),
  ];
const materiales_ = (defecto?: string) =>
  (ctx: Contexto): Opcion[] => [...(defecto === undefined ? [] : [{ valor: "", texto: `(${defecto})` }]), ...ctx.modelo.materiales.map((x) => ({ valor: x.id, texto: `${x.id} · ${describirMaterial(x)}` }))];

const id: Columna = { clave: "id", titulo: "id", ayuda: "único en todo el modelo; vacío en una fila nueva: se pone solo" };
const nombre: Columna = { clave: "nombre", titulo: "nombre" };

// ─── Plantas ────────────────────────────────────────────────────────────────────────────────────

const plantas: DefTabla = {
  nombre: "plantas",
  titulo: "Plantas",
  colecciones: ["plantas"],
  prefijo: "N",
  columnas: [
    id,
    nombre,
    { clave: "tipo", titulo: "tipo", ayuda: "planta (por defecto), sotano o cubierta", opciones: fijas(["planta", "sotano", "cubierta"], "planta") },
    { clave: "altura", titulo: "altura", unidad: "m", ayuda: "de forjado a forjado hasta la planta de encima; vacía en la de arriba" },
    { clave: "cota", titulo: "cota", unidad: "m", calculada: true },
    { clave: "diafragma", titulo: "diafragma", ayuda: "rigido o ninguno; por defecto, rígido salvo en la más baja (C1-d)", opciones: fijas(["rigido", "ninguno"], "rígido salvo en la más baja") },
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
  colecciones: ["materiales"],
  prefijo: "M",
  columnas: [
    id,
    { clave: "tipo", titulo: "tipo", ayuda: "hormigon, acero o general", opciones: fijas(["hormigon", "acero", "general"]) },
    { clave: "fck", titulo: "fck", unidad: "MPa", ayuda: "hormigón: E = 22000·((fck + 8)/10)^0,3 (Código Estructural)" },
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
  colecciones: ["secciones"],
  prefijo: "S",
  columnas: [
    id,
    { clave: "material", titulo: "material", opciones: materiales_(), referencia: "materiales" },
    { clave: "forma", titulo: "forma", ayuda: "rectangular, circular, T o general (los perfiles I, desde «Nueva sección…»)", opciones: fijas(["rectangular", "circular", "T", "general"]) },
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
        if (!base || base.forma !== "I") L.errores.push({ columna: "forma", mensaje: "los perfiles I se crean con «Nueva sección…» (del catálogo)" });
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
  colecciones: ["pilares"],
  prefijo: "P",
  columnas: [
    id,
    nombre,
    { clave: "x", titulo: "x", unidad: "m" },
    { clave: "y", titulo: "y", unidad: "m" },
    { clave: "desde", titulo: "desde", ayuda: "planta de la base", opciones: opcionesPlantas, referencia: "plantas" },
    { clave: "hasta", titulo: "hasta", ayuda: "planta de la cabeza", opciones: opcionesPlantas, referencia: "plantas" },
    { clave: "seccion", titulo: "sección", opciones: secciones_(), referencia: "secciones" },
    { clave: "tramos", titulo: "tramos", ayuda: "sección de los tramos que cambian, por la planta de su cabeza: «N3: P30x30; N5: P25x25»" },
    { clave: "giro", titulo: "giro", unidad: "°", ayuda: "del canto h desde +X; por defecto, 0" },
    {
      clave: "fijo",
      titulo: "punto fijo",
      ayuda: "el punto de la sección que está en (x, y) en todas las plantas, como CYPECAD: centro (por defecto), mitad-… o esquina-… («derecha» según el canto h; con giro 0, +X, y «superior», +Y)",
      opciones: fijas(PUNTOS_FIJOS, "centro"),
    },
    { clave: "base", titulo: "base", ayuda: "empotrado (por defecto), articulado o ninguno (apeado: nace sobre una viga, una losa, un muro u otro pilar)", opciones: fijas(["empotrado", "articulado", "ninguno"], "empotrado") },
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
      fijo: s(p.fijo),
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
      fijo: L.opcion("fijo", PUNTOS_FIJOS),
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
  colecciones: ["vigas"],
  prefijo: "V",
  columnas: [
    id,
    nombre,
    { clave: "planta", titulo: "planta", opciones: opcionesPlantas, referencia: "plantas" },
    { clave: "puntos", titulo: "puntos", unidad: "m", ayuda: "eje en planta: «x y; x y; …» (al menos 2)" },
    { clave: "seccion", titulo: "sección", opciones: secciones_(), referencia: "secciones" },
    { clave: "insercion", titulo: "inserción", ayuda: "plano (por defecto: el eje en el plano del forjado, C1-c) o superior", opciones: fijas(["plano", "superior"], "plano") },
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

// ─── Forjados: losas macizas, reticulares y paños unidireccionales ────────────────────────────────

/** Multiplicadores de lámina de un reticular, en su orden (H47). */
const MULT = ["f11", "f22", "f12", "m11", "m22", "m12", "v13", "v23"] as const;

/** Tipos de forjado de la tabla: los dos primeros son losas (láminas) y el último, un paño (viguetas como barras, D2). */
export const TIPOS_FORJADO = ["maciza", "reticular", "unidireccional"] as const;
export type TipoForjado = (typeof TIPOS_FORJADO)[number];

const DEL_RETICULAR = ["nervio", "capa", "caseton", "abacos", "multiplicadores"] as const;

/** Las columnas propias de cada tipo; las demás (id, planta, contorno, pp, dirección…) son de todos. */
const PROPIAS: Readonly<Record<TipoForjado, readonly string[]>> = {
  maciza: ["espesor", "material"],
  reticular: ["espesor", "material", "intereje", ...DEL_RETICULAR],
  unidireccional: ["intereje", "seccion"],
};
const DE_ALGUNO = new Set(Object.values(PROPIAS).flat());

/** El tipo de un forjado del modelo. */
export function tipoForjado(o: Objeto, ctx: Contexto): TipoForjado {
  if (ctx.coleccionDe(o.id) === "panos") return "unidireccional";
  return (o as unknown as Losa).reticular ? "reticular" : "maciza";
}

/** El tipo de una fila: el de su celda o, vacía, maciza. */
const tipoFila = (f: Fila): string => (f.tipo ?? "").trim().toLowerCase() || "maciza";

/**
 * Forjados (como los paños de CYPECAD): una sola tabla con una columna «tipo». En el modelo siguen
 * siendo dos listas, las losas (maciza o reticular: láminas) y los paños unidireccionales (viguetas
 * como barras, D2), así que el fichero y el cálculo no cambian. Cambiar el tipo de una fila pasa el
 * objeto de una lista a la otra con su id y sus cargas (`convertir` en `operaciones.ts`).
 *
 * «dirección» es el eje 1 de una losa (la dirección de los nervios de un reticular) o la de las
 * viguetas de un unidireccional. Lo que no aplica al tipo de una fila tiene que estar vacío.
 */
const forjados: DefTabla = {
  nombre: "forjados",
  titulo: "Forjados",
  colecciones: ["losas", "panos"],
  prefijo: "L",
  prefijoDe: (f) => (tipoFila(f) === "unidireccional" ? "F" : "L"),
  columnas: [
    id,
    nombre,
    { clave: "planta", titulo: "planta", opciones: opcionesPlantas, referencia: "plantas" },
    { clave: "tipo", titulo: "tipo", ayuda: "maciza (por defecto), reticular o unidireccional; cambiarlo cambia las columnas que tocan", opciones: fijas(TIPOS_FORJADO) },
    { clave: "contorno", titulo: "contorno", unidad: "m", ayuda: "a ejes de las vigas y los muros en que se apoya: «x y; x y; …» (al menos 3, sin repetir el primero)" },
    { clave: "huecos", titulo: "huecos", unidad: "m", ayuda: "polígonos separados por «|»" },
    { clave: "espesor", titulo: "canto", unidad: "m", ayuda: "maciza y reticular: el canto total; vacío en un unidireccional (lo da la sección de la vigueta)" },
    { clave: "material", titulo: "material", ayuda: "maciza y reticular; vacío en un unidireccional", opciones: materiales_("ninguno: unidireccional"), referencia: "materiales" },
    { clave: "pp", titulo: "pp", unidad: "kN/m²", ayuda: "peso propio. Maciza: por defecto, γ·canto. Reticular con casetón perdido y unidireccional (con las bovedillas): obligatorio" },
    { clave: "direccion", titulo: "dirección", unidad: "°", ayuda: "desde +X. Maciza: la del eje 1 de las láminas (por defecto, 0). Reticular: la de los nervios y su perpendicular. Unidireccional: la de las viguetas (obligatoria)" },
    { clave: "intereje", titulo: "intereje", unidad: "m", ayuda: "reticular: entre ejes de nervios; unidireccional: entre ejes de viguetas; vacío en una maciza" },
    { clave: "nervio", titulo: "nervio", unidad: "m", ayuda: "reticular: ancho del nervio (bw)" },
    { clave: "capa", titulo: "capa", unidad: "m", ayuda: "reticular: espesor de la capa de compresión (hf)" },
    { clave: "caseton", titulo: "casetón", ayuda: "reticular: perdido (por defecto; entonces el pp es obligatorio) o recuperable", opciones: fijas(["perdido", "recuperable"], "perdido") },
    { clave: "abacos", titulo: "ábacos", unidad: "m", ayuda: "reticular: polígonos macizos separados por «|»; pueden salirse del forjado" },
    { clave: "multiplicadores", titulo: "multiplicadores", ayuda: `reticular: los que sustituyen a los calculados, «m11=0,32 m22=0,27 …» (${MULT.join(", ")}), cada uno en (0, 100]` },
    { clave: "seccion", titulo: "vigueta", ayuda: "unidireccional: sección de una vigueta (la T bruta u otra); no pesa: el peso es el pp", opciones: secciones_("ninguna: losa"), referencia: "secciones" },
  ],
  fila(o, ctx) {
    const tipo = tipoForjado(o, ctx);
    if (tipo === "unidireccional") {
      const p = o as unknown as PanoUnidireccional;
      return {
        id: p.id,
        nombre: s(p.nombre),
        planta: p.planta,
        tipo,
        contorno: textoPuntos(p.contorno),
        huecos: p.huecos?.length ? textoPoligonos(p.huecos) : "",
        espesor: "",
        material: "",
        pp: n(p.pp),
        direccion: n(p.direccion),
        intereje: n(p.intereje),
        nervio: "",
        capa: "",
        caseton: "",
        abacos: "",
        multiplicadores: "",
        seccion: p.seccion,
      };
    }
    const l = o as unknown as Losa;
    const r = l.reticular;
    return {
      id: l.id,
      nombre: s(l.nombre),
      planta: l.planta,
      tipo,
      contorno: textoPuntos(l.contorno),
      huecos: l.huecos?.length ? textoPoligonos(l.huecos) : "",
      espesor: n(l.espesor),
      material: l.material,
      pp: n(l.pp),
      direccion: n(l.eje1),
      intereje: n(r?.intereje),
      nervio: n(r?.nervio),
      capa: n(r?.capa),
      caseton: s(r?.caseton),
      abacos: r?.abacos?.length ? textoPoligonos(r.abacos) : "",
      multiplicadores: r?.multiplicadores ? textoClaves(r.multiplicadores as Record<string, number>, MULT) : "",
      seccion: "",
    };
  },
  objeto(f) {
    const L = new Lector(f);
    const tipo = tipoFila(f);
    const comun = { id: L.texto("id") ?? "", nombre: L.texto("nombre"), planta: L.texto("planta", { obligatorio: true }), contorno: L.puntos("contorno", { obligatorio: true, min: 3 }), huecos: L.poligonos("huecos") };
    if (tipo === "unidireccional") {
      L.vacias(["espesor", "material", ...DEL_RETICULAR], "a un unidireccional");
      const r = resultado(L, {
        ...comun,
        direccion: L.numero("direccion", { obligatorio: true }),
        intereje: L.numero("intereje", { obligatorio: true, mayorQue: 0 }),
        seccion: L.texto("seccion", { obligatorio: true }),
        pp: L.numero("pp", { obligatorio: true, min: 0 }),
      });
      return r.ok ? { ...r, coleccion: "panos" } : r;
    }
    if (tipo !== "maciza" && tipo !== "reticular") {
      L.errores.push({ columna: "tipo", mensaje: `«${f.tipo}» no es un tipo de forjado: ${TIPOS_FORJADO.join(", ")}` });
      return { ok: false, errores: L.errores };
    }
    L.vacias(["seccion"], `a una losa ${tipo}`);
    let reticular: Losa["reticular"];
    if (tipo === "maciza") L.vacias(["intereje", ...DEL_RETICULAR], "a una losa maciza");
    else
      reticular = limpio({
        intereje: L.numero("intereje", { obligatorio: true, mayorQue: 0 }),
        nervio: L.numero("nervio", { obligatorio: true, mayorQue: 0 }),
        capa: L.numero("capa", { obligatorio: true, mayorQue: 0 }),
        caseton: L.opcion("caseton", ["perdido", "recuperable"] as const),
        abacos: L.poligonos("abacos"),
        multiplicadores: L.claves("multiplicadores", MULT, { max: 100 }),
      }) as Losa["reticular"];
    const r = resultado(L, {
      ...comun,
      espesor: L.numero("espesor", { obligatorio: true, mayorQue: 0 }),
      material: L.texto("material", { obligatorio: true }),
      pp: L.numero("pp", { min: 0 }),
      eje1: L.numero("direccion"),
      reticular,
    });
    return r.ok ? { ...r, coleccion: "losas" } : r;
  },
  plantas: (o) => [o.planta as string],
  aplica(clave, f) {
    const propias = PROPIAS[tipoFila(f) as TipoForjado];
    return !propias || !DE_ALGUNO.has(clave) || propias.includes(clave);
  },
  conValor(f, clave, valor) {
    const r: Record<string, string> = { ...f, [clave]: valor };
    if (clave !== "tipo" || tipoFila(r) === tipoFila(f)) return r;
    for (const k of DE_ALGUNO) if (forjados.aplica!(k, f) && !forjados.aplica!(k, r)) r[k] = "";
    r.pp = "";
    return r;
  },
};

// ─── Muros ──────────────────────────────────────────────────────────────────────────────────────

const muros: DefTabla = {
  nombre: "muros",
  titulo: "Muros",
  colecciones: ["muros"],
  prefijo: "M",
  columnas: [
    id,
    nombre,
    { clave: "puntos", titulo: "puntos", unidad: "m", ayuda: "eje en planta: «x y; x y; …» (al menos 2); un núcleo cerrado repite el primero al final" },
    { clave: "desde", titulo: "desde", ayuda: "planta de la base", opciones: opcionesPlantas, referencia: "plantas" },
    { clave: "hasta", titulo: "hasta", ayuda: "planta de la cabeza", opciones: opcionesPlantas, referencia: "plantas" },
    { clave: "espesor", titulo: "espesor", unidad: "m" },
    { clave: "material", titulo: "material", opciones: materiales_(), referencia: "materiales" },
    { clave: "base", titulo: "base", ayuda: "empotrado (por defecto), articulado o ninguno (nace sobre una viga, una losa u otro muro)", opciones: fijas(["empotrado", "articulado", "ninguno"], "empotrado") },
    { clave: "huecos", titulo: "huecos", unidad: "m", ayuda: "rectángulos en alzado, «desde hasta z0 z1 | …»: estaciones a lo largo del eje y alturas sobre la base" },
  ],
  fila(o) {
    const w = o as unknown as Muro;
    return {
      id: w.id,
      nombre: s(w.nombre),
      puntos: textoPuntos(w.puntos),
      desde: w.desde,
      hasta: w.hasta,
      espesor: n(w.espesor),
      material: w.material,
      base: s(w.base),
      huecos: w.huecos?.length ? textoGrupos(w.huecos.map((h) => [h.desde, h.hasta, h.z0, h.z1])) : "",
    };
  },
  objeto(f) {
    const L = new Lector(f);
    const h = L.grupos("huecos", 4);
    return resultado(L, {
      id: L.texto("id") ?? "",
      nombre: L.texto("nombre"),
      puntos: L.puntos("puntos", { obligatorio: true, min: 2 }),
      desde: L.texto("desde", { obligatorio: true }),
      hasta: L.texto("hasta", { obligatorio: true }),
      espesor: L.numero("espesor", { obligatorio: true, mayorQue: 0 }),
      material: L.texto("material", { obligatorio: true }),
      base: L.opcion("base", ["empotrado", "articulado", "ninguno"] as const),
      huecos: h?.map(([desde, hasta, z0, z1]) => ({ desde, hasta, z0, z1 })),
    });
  },
  plantas: (o, ctx) => rango(ctx.modelo, o.desde, o.hasta),
};

// ─── Apoyos lineales ────────────────────────────────────────────────────────────────────────────

const apoyosLineales: DefTabla = {
  nombre: "apoyosLineales",
  titulo: "Apoyos lineales",
  colecciones: ["apoyosLineales"],
  prefijo: "AL",
  columnas: [
    id,
    { clave: "planta", titulo: "planta", opciones: opcionesPlantas, referencia: "plantas" },
    { clave: "puntos", titulo: "puntos", unidad: "m", ayuda: "polilínea sobre una losa o el eje de un muro: «x y; x y; …» (al menos 2)" },
    { clave: "coartados", titulo: "coartados", ayuda: COARTADOS },
  ],
  fila(o) {
    const a = o as unknown as ApoyoLineal;
    return { id: a.id, planta: a.planta, puntos: textoPuntos(a.puntos), coartados: textoGdl(a.coartados) };
  },
  objeto(f) {
    const L = new Lector(f);
    return resultado(L, { id: L.texto("id") ?? "", planta: L.texto("planta", { obligatorio: true }), puntos: L.puntos("puntos", { obligatorio: true, min: 2 }), coartados: L.gdl("coartados", { obligatorio: true }) });
  },
  plantas: (o) => [o.planta as string],
};

// ─── Ejes de replanteo ──────────────────────────────────────────────────────────────────────────

const ejes: DefTabla = {
  nombre: "ejes",
  titulo: "Ejes",
  colecciones: ["ejes"],
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
  colecciones: ["apoyos"],
  prefijo: "A",
  columnas: [id, { clave: "planta", titulo: "planta", opciones: opcionesPlantas, referencia: "plantas" }, { clave: "x", titulo: "x", unidad: "m" }, { clave: "y", titulo: "y", unidad: "m" }, { clave: "coartados", titulo: "coartados", ayuda: COARTADOS }],
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

/** Las acciones de las combinaciones (`TipoAccion`), con lo que es cada una. */
const ACCIONES = [
  ["G", "permanente (peso, empuje o agua)"],
  ["Q", "sobrecarga de uso"],
  ["S", "nieve"],
  ["W", "viento"],
  ["T", "temperatura"],
  ["E", "sismo"],
  ["A", "accidental"],
  ["N", "nocional (de un caso vertical)"],
] as const;
const PSI = ["uso-A", "uso-B", "uso-C", "uso-D", "uso-E", "uso-G", "nieve-hasta-1000", "nieve-mas-de-1000", "viento", "temperatura"] as const;
const casos: DefTabla = {
  nombre: "casos",
  titulo: "Casos",
  colecciones: ["casos"],
  prefijo: "C",
  columnas: [
    id,
    nombre,
    { clave: "pesoPropio", titulo: "peso propio", ayuda: "«sí» en el caso al que va el peso de las piezas (como mucho, uno)", opciones: fijas(["sí", "no"], "no") },
    {
      clave: "tipo",
      titulo: "acción",
      ayuda: "G permanente, Q sobrecarga de uso, S nieve, W viento, T temperatura, E sismo, A accidental o N nocional; vacía: el caso no entra en las combinaciones CTE/NCSE",
      opciones: () => [{ valor: "", texto: "(sin acción: fuera de las combinaciones)" }, ...ACCIONES.map(([valor, nombre]) => ({ valor, texto: `${valor} · ${nombre}` }))],
    },
    { clave: "psi", titulo: "ψ", ayuda: `por su nombre (${PSI.join(", ")}) o «ψ0 ψ1 ψ2»`, opciones: fijas(PSI, "sin dar") },
    { clave: "familia", titulo: "familia", ayuda: "excluyente: como mucho un caso de la familia por combinación" },
    { clave: "permanente", titulo: "permanente", ayuda: "G: peso (por defecto), empuje o agua", opciones: fijas(["peso", "empuje", "agua"], "peso") },
    { clave: "direccion", titulo: "dirección", ayuda: "W, E y N: X o Y", opciones: fijas(["X", "Y"], "sin dirección") },
    { clave: "signo", titulo: "signo", ayuda: "W y N: 1 o -1", opciones: fijas(["1", "-1"], "sin signo") },
    { clave: "derivadoDe", titulo: "deriva de", ayuda: "N: id del caso vertical", opciones: casos_("ninguno"), referencia: "casos" },
    { clave: "duracion", titulo: "duración", ayuda: "permanente, larga, media, corta o instantanea; por defecto, la del tipo", opciones: fijas(["permanente", "larga", "media", "corta", "instantanea"], "la del tipo") },
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

const CARGA = ["planta", "sobre", "ejes", "x", "y", "F", "M", "q", "qb", "desde", "hasta", "puntos", "lado", "z0", "z1", "p0", "p1"] as const;
const cargas: DefTabla = {
  nombre: "cargas",
  titulo: "Cargas",
  colecciones: ["cargas"],
  prefijo: "Q",
  columnas: [
    id,
    { clave: "tipo", titulo: "tipo", ayuda: "puntual, viga, pilar, superficie, lineal o empuje", opciones: fijas(["puntual", "viga", "pilar", "superficie", "lineal", "empuje"]) },
    { clave: "caso", titulo: "caso", opciones: casos_(), referencia: "casos" },
    { clave: "planta", titulo: "planta", ayuda: "puntual, superficie y lineal", opciones: (ctx) => [{ valor: "", texto: "(viga y pilar)" }, ...opcionesPlantas(ctx)], referencia: "plantas" },
    { clave: "sobre", titulo: "sobre", ayuda: "la viga, el pilar, el muro de un empuje, o la losa o el paño de una de superficie (una de superficie sin losa ni paño necesita su zona en «puntos»)" },
    { clave: "ejes", titulo: "ejes", ayuda: "viga y pilar: global o local", opciones: fijas(["global", "local"], "puntual, superficie y lineal") },
    { clave: "x", titulo: "x", unidad: "m", ayuda: "puntual" },
    { clave: "y", titulo: "y", unidad: "m", ayuda: "puntual" },
    { clave: "F", titulo: "F", unidad: "kN", ayuda: "puntual: «Fx Fy Fz» en ejes globales" },
    { clave: "M", titulo: "M", unidad: "kN·m", ayuda: "puntual: «Mx My Mz» en ejes globales" },
    { clave: "q", titulo: "q", ayuda: "«qx qy qz»: kN/m (viga, pilar, lineal) o kN/m² (superficie); hacia abajo es qz < 0" },
    { clave: "qb", titulo: "qb", ayuda: "viga y pilar: q al final del tramo, si varía" },
    { clave: "desde", titulo: "desde", unidad: "m", ayuda: "viga y pilar: estación de inicio; por defecto, la pieza entera" },
    { clave: "hasta", titulo: "hasta", unidad: "m", ayuda: "viga y pilar: estación final" },
    { clave: "puntos", titulo: "puntos", unidad: "m", ayuda: "lineal: la polilínea; superficie: la zona (vacía: la losa o el paño de «sobre» enteros)" },
    { clave: "lado", titulo: "lado", ayuda: "empuje: la cara del muro donde está el terreno, mirando de su primer punto al último; empuja hacia la otra", opciones: fijas(["izquierdo", "derecho"], "sólo empuje") },
    { clave: "z0", titulo: "z0", unidad: "m", ayuda: "empuje: altura sobre la base del muro donde vale p0" },
    { clave: "z1", titulo: "z1", unidad: "m", ayuda: "empuje: altura donde vale p1; nula fuera de z0–z1" },
    { clave: "p0", titulo: "p0", unidad: "kN/m²", ayuda: "empuje: presión en z0" },
    { clave: "p1", titulo: "p1", unidad: "kN/m²", ayuda: "empuje: presión en z1" },
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
        Object.assign(r, { sobre: c.muro, lado: c.lado, z0: n(c.z0), z1: n(c.z1), p0: n(c.p0), p1: n(c.p1) });
        break;
    }
    return r;
  },
  objeto(f, ctx) {
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
      case "empuje": {
        usa(["sobre", "lado", "z0", "z1", "p0", "p1"]);
        const z0 = L.numero("z0", { obligatorio: true, min: 0 });
        const z1 = L.numero("z1", { obligatorio: true, min: 0 });
        if (z0 !== undefined && z1 !== undefined && !(z1 > z0)) L.errores.push({ columna: "z1", mensaje: "tiene que ser mayor que z0" });
        return resultado(L, { ...comun, muro: L.texto("sobre", { obligatorio: true }), lado: L.opcion("lado", ["izquierdo", "derecho"] as const, { obligatorio: true }), z0, z1, p0: L.numero("p0", { obligatorio: true }), p1: L.numero("p1", { obligatorio: true }) });
      }
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

export const DEF_TABLAS: Readonly<Record<NombreTabla, DefTabla>> = { plantas, ejes, materiales, secciones, pilares, vigas, forjados, muros, apoyos, apoyosLineales, casos, cargas };

/** Un id libre con el prefijo de la tabla: el primero de `<prefijo>1`, `<prefijo>2`… que no está en el modelo. */
export function idNuevo(m: ModeloFisico, prefijo: string, ocupados: ReadonlySet<string> = new Set()): string {
  const idx = indiceIds(m);
  for (let i = 1; ; i++) {
    const x = `${prefijo}${i}`;
    if (!idx.has(x) && !ocupados.has(x)) return x;
  }
}

/** Los objetos de una tabla, de todas sus listas y en el orden del modelo (las losas antes que los paños). */
export function objetosTabla(m: ModeloFisico, t: NombreTabla): Objeto[] {
  return DEF_TABLAS[t].colecciones.flatMap((c) => lista(m, c));
}

/** La tabla en la que se edita una colección (losas y paños, en Forjados). */
export function tablaDeColeccion(c: Coleccion): NombreTabla | null {
  return TABLAS.find((t) => DEF_TABLAS[t].colecciones.includes(c)) ?? null;
}
