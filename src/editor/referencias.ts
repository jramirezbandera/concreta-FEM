/**
 * Colecciones del modelo físico y referencias entre ellas, para el editor (V2a, `docs/fem3d/visor.md`
 * §6.1). Los ids son únicos en todo el modelo (`fisico.ts`), así que una referencia es un id y la
 * colección a la que apunta.
 *
 * Con este catálogo, renombrar un id cambia todas sus referencias, y borrar algo que otro usa dice
 * qué lo usa y lo borra o lo reasigna. Así el editor nunca deja una referencia a un id que no existe
 * (criterio 2 de V2a).
 *
 * Puro: sin IO, sin React ni DOM.
 */
import type { CargaFisica, ModeloFisico } from "../compilador/fisico.ts";

/** Las listas con id del modelo físico, en el orden de `validar.ts`. */
export const COLECCIONES = ["plantas", "materiales", "secciones", "pilares", "vigas", "apoyos", "casos", "cargas", "losas", "apoyosLineales", "bandas", "muros", "panos"] as const;
export type Coleccion = (typeof COLECCIONES)[number];

export type Objeto = { readonly id: string } & Record<string, unknown>;

/**
 * Una referencia de un objeto a otro: el id `id` de la colección `destino`, en la ruta `ruta` del
 * objeto. Si `elemento` es el índice de un elemento de una lista (los tramos de un pilar), borrar el
 * destino quita ese elemento y no el objeto entero.
 */
export interface Referencia {
  destino: Coleccion;
  id: string;
  ruta: readonly (string | number)[];
  elemento?: { lista: string; indice: number };
}

const ref = (destino: Coleccion, v: unknown, ...ruta: (string | number)[]): Referencia[] => (typeof v === "string" ? [{ destino, id: v, ruta }] : []);

/** Las referencias de un objeto de una colección. */
export function referenciasDe(coleccion: Coleccion, o: Objeto): Referencia[] {
  const r: Referencia[] = [];
  switch (coleccion) {
    case "secciones":
      r.push(...ref("materiales", o.material, "material"));
      break;
    case "pilares": {
      r.push(...ref("plantas", o.desde, "desde"), ...ref("plantas", o.hasta, "hasta"), ...ref("secciones", o.seccion, "seccion"));
      const tramos = Array.isArray(o.tramos) ? (o.tramos as Record<string, unknown>[]) : [];
      tramos.forEach((t, i) => {
        for (const x of [...ref("plantas", t.planta, "tramos", i, "planta"), ...ref("secciones", t.seccion, "tramos", i, "seccion")]) r.push({ ...x, elemento: { lista: "tramos", indice: i } });
      });
      break;
    }
    case "vigas":
    case "panos":
      r.push(...ref("plantas", o.planta, "planta"), ...ref("secciones", o.seccion, "seccion"));
      break;
    case "apoyos":
    case "apoyosLineales":
    case "bandas":
      r.push(...ref("plantas", o.planta, "planta"));
      break;
    case "losas":
      r.push(...ref("plantas", o.planta, "planta"), ...ref("materiales", o.material, "material"));
      break;
    case "muros":
      r.push(...ref("plantas", o.desde, "desde"), ...ref("plantas", o.hasta, "hasta"), ...ref("materiales", o.material, "material"));
      break;
    case "casos": {
      const a = o.accion as Record<string, unknown> | undefined;
      if (a) r.push(...ref("casos", a.derivadoDe, "accion", "derivadoDe"));
      break;
    }
    case "cargas": {
      const c = o as unknown as CargaFisica;
      r.push(...ref("casos", c.caso, "caso"));
      switch (c.tipo) {
        case "puntual":
        case "lineal":
          r.push(...ref("plantas", c.planta, "planta"));
          break;
        case "superficie":
          r.push(...ref("plantas", c.planta, "planta"), ...ref("losas", c.losa, "losa"), ...ref("panos", c.pano, "pano"));
          break;
        case "viga":
          r.push(...ref("vigas", c.viga, "viga"));
          break;
        case "pilar":
          r.push(...ref("pilares", c.pilar, "pilar"));
          break;
        case "empuje":
          r.push(...ref("muros", c.muro, "muro"));
          break;
      }
      break;
    }
    case "plantas":
    case "materiales":
      break;
  }
  return r;
}

/** Los objetos de una colección (vacía si el modelo no la tiene). */
export const lista = (m: ModeloFisico, c: Coleccion): readonly Objeto[] => ((m as unknown as Record<string, readonly Objeto[] | undefined>)[c] ?? []) as readonly Objeto[];

/** Dónde está cada id del modelo: su colección y su índice. */
export function indiceIds(m: ModeloFisico): Map<string, { coleccion: Coleccion; indice: number }> {
  const r = new Map<string, { coleccion: Coleccion; indice: number }>();
  for (const c of COLECCIONES) lista(m, c).forEach((o, indice) => r.has(o.id) || r.set(o.id, { coleccion: c, indice }));
  return r;
}

/** Un uso de un id: qué objeto lo usa y en qué campo. */
export interface Uso {
  coleccion: Coleccion;
  id: string;
  /** El id usado (uno de los que se preguntan). */
  usa: string;
  ruta: readonly (string | number)[];
  elemento?: { lista: string; indice: number };
}

/** Quién usa los ids `ids` (sin contar los usos desde los propios `ids`). */
export function usos(m: ModeloFisico, ids: ReadonlySet<string>): Uso[] {
  const r: Uso[] = [];
  for (const c of COLECCIONES)
    for (const o of lista(m, c)) {
      if (ids.has(o.id)) continue;
      for (const x of referenciasDe(c, o)) if (ids.has(x.id)) r.push({ coleccion: c, id: o.id, usa: x.id, ruta: x.ruta, ...(x.elemento ? { elemento: x.elemento } : {}) });
    }
  return r;
}

/** Referencias a ids que no existen (las que el editor nunca deja). */
export function referenciasRotas(m: ModeloFisico): { coleccion: Coleccion; id: string; ruta: readonly (string | number)[]; destino: Coleccion; falta: string }[] {
  const idx = indiceIds(m);
  const r: { coleccion: Coleccion; id: string; ruta: readonly (string | number)[]; destino: Coleccion; falta: string }[] = [];
  for (const c of COLECCIONES)
    for (const o of lista(m, c))
      for (const x of referenciasDe(c, o)) {
        const d = idx.get(x.id);
        if (!d || d.coleccion !== x.destino) r.push({ coleccion: c, id: o.id, ruta: x.ruta, destino: x.destino, falta: x.id });
      }
  return r;
}

/** Copia de `o` con el valor `v` en la ruta `ruta` (copia sólo lo que cambia). */
export function conValor<T>(o: T, ruta: readonly (string | number)[], v: unknown): T {
  if (ruta.length === 0) return v as T;
  const [k, ...resto] = ruta;
  if (Array.isArray(o)) {
    const r = [...o];
    r[k as number] = conValor(o[k as number], resto, v);
    return r as T;
  }
  const r = { ...(o as Record<string, unknown>) };
  r[k as string] = conValor((o as Record<string, unknown>)[k as string], resto, v);
  return r as T;
}
