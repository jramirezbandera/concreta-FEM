/**
 * Operaciones del editor (V2a, `docs/fem3d/visor.md` §6.1): cada cambio que hace el ingeniero en
 * la interfaz (escribir en una celda, pegar una tabla, copiar a otras plantas, borrar…) es una
 * operación que toma un `Proyecto` y devuelve el proyecto nuevo, sin tocar el anterior (copia sólo
 * lo que cambia). Deshacer es volver al proyecto anterior (`historial.ts`), así que devuelve los
 * mismos bytes.
 *
 * Reglas (criterio 2 de V2a):
 * - el proyecto que sale pasa siempre `comprobarProyecto` (el esquema); si no, la operación no se
 *   aplica y se dice por qué;
 * - los ids son únicos en todo el modelo, y las referencias de lo que se crea o se cambia apuntan a
 *   un objeto que existe y de la colección que toca;
 * - renombrar un id cambia todas sus referencias;
 * - borrar algo que otro usa no se hace sin decir qué hacer con lo que lo usa: borrarlo también
 *   (`dependientes: "borrar"`) o pasarlo a otro id (`dependientes: { reasignar }`). Así no queda
 *   ninguna referencia rota.
 *
 * Lo que sólo ve el compilador (un pilar fuera de las losas, una viga suelta…) sí se aplica: es un
 * diagnóstico de `compilar`, no un error de edición.
 *
 * Puro: sin IO, sin React ni DOM.
 */
import { comprobarProyecto, type Proyecto } from "../agente/proyecto.ts";
import type { ModeloFisico } from "../compilador/fisico.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { conValor, indiceIds, lista, referenciasDe, usos, type Coleccion, type Objeto, type Uso } from "./referencias.ts";

export type Operacion =
  /** Crea un objeto al final de su colección, o antes del objeto `antesDe` (las plantas y los casos tienen orden). */
  | { op: "crear"; coleccion: Coleccion; objeto: Objeto; antesDe?: string | null }
  /** Sustituye el objeto `id` por `objeto`; si cambia el id, cambia también todas sus referencias. */
  | { op: "cambiar"; coleccion: Coleccion; id: string; objeto: Objeto }
  /** Borra unos objetos; si otros los usan, `dependientes` dice qué hacer con ellos. */
  | { op: "borrar"; ids: readonly string[]; dependientes?: "borrar" | { reasignar: Readonly<Record<string, string>> } }
  /** Lleva el objeto `id` antes de `antesDe` (al final con null). */
  | { op: "mover"; coleccion: Coleccion; id: string; antesDe: string | null }
  /** Nombre y descripción del proyecto (no entran en la huella). */
  | { op: "datos"; nombre?: string; descripcion?: string }
  /** Varias operaciones como una sola: o entran todas o ninguna (y se deshacen de una vez). */
  | { op: "lote"; operaciones: readonly Operacion[] };

export type Aplicacion =
  | { ok: true; proyecto: Proyecto }
  /** `usos`: con `editor/en-uso`, quién usa lo que se quería borrar (para preguntar qué hacer). */
  | { ok: false; errores: Diagnostico[]; usos?: Uso[] };

const error = (codigo: string, mensaje: string, objetos: string[] = [], detalles?: Record<string, unknown>): Diagnostico => ({ codigo, severidad: "error", mensaje, ...(objetos.length ? { objetos } : {}), ...(detalles ? { detalles } : {}) });

const NOMBRES: Record<Coleccion, string> = {
  plantas: "planta",
  materiales: "material",
  secciones: "sección",
  pilares: "pilar",
  vigas: "viga",
  apoyos: "apoyo",
  casos: "caso",
  cargas: "carga",
  losas: "losa",
  apoyosLineales: "apoyo lineal",
  bandas: "banda",
  muros: "muro",
  panos: "paño",
};
export const nombreColeccion = (c: Coleccion): string => NOMBRES[c];

const conLista = (m: ModeloFisico, c: Coleccion, l: readonly Objeto[]): ModeloFisico => ({ ...m, [c]: l }) as ModeloFisico;

type Paso = { ok: true; modelo: ModeloFisico; proyecto?: Partial<Pick<Proyecto, "nombre" | "descripcion">> } | { ok: false; errores: Diagnostico[]; usos?: Uso[] };

/** Las referencias de `o` que no apuntan a un objeto de su colección. */
function referenciasMalas(m: ModeloFisico, c: Coleccion, o: Objeto, extra?: Map<string, Coleccion>): Diagnostico[] {
  const idx = indiceIds(m);
  const r: Diagnostico[] = [];
  for (const x of referenciasDe(c, o)) {
    const d = extra?.get(x.id) ?? idx.get(x.id)?.coleccion;
    if (d === x.destino) continue;
    r.push(
      error(
        "editor/referencia",
        d === undefined
          ? `${nombreColeccion(c)} ${o.id}: no hay ningún objeto «${x.id}» (${x.ruta.join(".")} tiene que ser un id de ${nombreColeccion(x.destino)}).`
          : `${nombreColeccion(c)} ${o.id}: «${x.id}» es un id de ${nombreColeccion(d)}, y ${x.ruta.join(".")} tiene que serlo de ${nombreColeccion(x.destino)}.`,
        [o.id],
        { campo: x.ruta.join(".") },
      ),
    );
  }
  return r;
}

function idValido(id: unknown): string | null {
  if (typeof id !== "string" || id.trim() === "") return "el id no puede estar vacío";
  if (id !== id.trim()) return "el id no puede empezar ni acabar con espacios";
  return null;
}

function crear(m: ModeloFisico, o: Extract<Operacion, { op: "crear" }>): Paso {
  const mal = idValido(o.objeto.id);
  if (mal) return { ok: false, errores: [error("editor/id", `Nueva ${nombreColeccion(o.coleccion)}: ${mal}.`)] };
  const ya = indiceIds(m).get(o.objeto.id);
  if (ya) return { ok: false, errores: [error("editor/id-repetido", `El id «${o.objeto.id}» ya es de ${nombreColeccion(ya.coleccion)}: los ids son únicos en todo el modelo.`, [o.objeto.id])] };
  const malas = referenciasMalas(m, o.coleccion, o.objeto, new Map([[o.objeto.id, o.coleccion]]));
  if (malas.length) return { ok: false, errores: malas };
  const l = [...lista(m, o.coleccion)];
  if (o.antesDe === undefined || o.antesDe === null) l.push(o.objeto);
  else {
    const i = l.findIndex((x) => x.id === o.antesDe);
    if (i < 0) return { ok: false, errores: [error("editor/no-existe", `No hay ninguna ${nombreColeccion(o.coleccion)} «${o.antesDe}» delante de la que crear.`)] };
    l.splice(i, 0, o.objeto);
  }
  return { ok: true, modelo: conLista(m, o.coleccion, l) };
}

/** Cambia el id `viejo` por `nuevo` en todas las referencias del modelo. */
function renombrarReferencias(m: ModeloFisico, viejo: string, nuevo: string): ModeloFisico {
  let r = m;
  for (const c of Object.keys(NOMBRES) as Coleccion[]) {
    const l = lista(r, c);
    let cambio = false;
    const n = l.map((o) => {
      let x = o;
      for (const ref of referenciasDe(c, o))
        if (ref.id === viejo) {
          x = conValor(x, ref.ruta, nuevo);
          cambio = true;
        }
      return x;
    });
    if (cambio) r = conLista(r, c, n);
  }
  return r;
}

function cambiar(m: ModeloFisico, o: Extract<Operacion, { op: "cambiar" }>): Paso {
  const l = lista(m, o.coleccion);
  const i = l.findIndex((x) => x.id === o.id);
  if (i < 0) return { ok: false, errores: [error("editor/no-existe", `No hay ninguna ${nombreColeccion(o.coleccion)} «${o.id}».`, [o.id])] };
  const nuevo = o.objeto.id;
  const mal = idValido(nuevo);
  if (mal) return { ok: false, errores: [error("editor/id", `${nombreColeccion(o.coleccion)} ${o.id}: ${mal}.`, [o.id])] };
  if (nuevo !== o.id) {
    const ya = indiceIds(m).get(nuevo);
    if (ya) return { ok: false, errores: [error("editor/id-repetido", `El id «${nuevo}» ya es de ${nombreColeccion(ya.coleccion)}: los ids son únicos en todo el modelo.`, [o.id])] };
  }
  const n = [...l];
  n[i] = o.objeto;
  let r = conLista(m, o.coleccion, n);
  if (nuevo !== o.id) r = renombrarReferencias(r, o.id, nuevo);
  // Las referencias del objeto, ya con el id nuevo (una referencia a sí mismo, también)
  const malas = referenciasMalas(r, o.coleccion, lista(r, o.coleccion)[i]!);
  if (malas.length) return { ok: false, errores: malas };
  return { ok: true, modelo: r };
}

function borrar(m: ModeloFisico, o: Extract<Operacion, { op: "borrar" }>): Paso {
  const idx = indiceIds(m);
  const faltan = o.ids.filter((id) => !idx.has(id));
  if (faltan.length) return { ok: false, errores: [error("editor/no-existe", `No hay ningún objeto ${faltan.map((x) => `«${x}»`).join(", ")} que borrar.`, faltan)] };
  let borrados = new Set(o.ids);
  let quitar = new Map<string, Set<number>>();
  let r = m;
  const u = usos(m, borrados);
  if (u.length && o.dependientes === undefined)
    return {
      ok: false,
      errores: [error("editor/en-uso", `${[...new Set(u.map((x) => x.id))].join(", ")} usa${u.length > 1 ? "n" : ""} lo que se quiere borrar: hay que decir si se borra también o se pasa a otro.`, o.ids.slice())],
      usos: u,
    };
  if (o.dependientes === "borrar") {
    // Cierre: lo que usa algo borrado se borra también (o se le quita el elemento: un tramo de pilar)
    for (;;) {
      const v = usos(m, borrados);
      const nuevos = v.filter((x) => !x.elemento).map((x) => x.id);
      quitar = new Map<string, Set<number>>();
      for (const x of v) if (x.elemento) (quitar.get(x.id) ?? quitar.set(x.id, new Set()).get(x.id)!).add(x.elemento.indice);
      if (nuevos.every((x) => borrados.has(x))) break;
      borrados = new Set([...borrados, ...nuevos]);
    }
  } else if (o.dependientes) {
    const rea = o.dependientes.reasignar;
    for (const [viejo, nuevo] of Object.entries(rea)) {
      if (!borrados.has(viejo)) return { ok: false, errores: [error("editor/reasignar", `«${viejo}» no está entre lo que se borra.`, [viejo])] };
      const a = idx.get(viejo)!;
      const b = idx.get(nuevo);
      if (!b || borrados.has(nuevo)) return { ok: false, errores: [error("editor/reasignar", `No se puede pasar lo de «${viejo}» a «${nuevo}»: ${b ? "también se borra" : "no existe"}.`, [viejo])] };
      if (b.coleccion !== a.coleccion) return { ok: false, errores: [error("editor/reasignar", `«${nuevo}» es de ${nombreColeccion(b.coleccion)} y «${viejo}», de ${nombreColeccion(a.coleccion)}.`, [viejo])] };
    }
    const sinDestino = [...new Set(u.map((x) => x.usa))].filter((id) => rea[id] === undefined);
    if (sinDestino.length) return { ok: false, errores: [error("editor/reasignar", `Falta decir a qué se pasa lo que usa ${sinDestino.map((x) => `«${x}»`).join(", ")}.`, sinDestino)] };
    for (const [viejo, nuevo] of Object.entries(rea)) r = renombrarReferencias(r, viejo, nuevo);
  }
  for (const c of Object.keys(NOMBRES) as Coleccion[]) {
    const l = lista(r, c);
    if (!l.some((x) => borrados.has(x.id) || quitar.has(x.id))) continue;
    const n = l
      .filter((x) => !borrados.has(x.id))
      .map((x) => {
        const q = quitar.get(x.id);
        if (!q) return x;
        // Los elementos que se quitan son de la lista `tramos` (la única con referencias por elemento)
        const tramos = (x.tramos as unknown[]).filter((_, i) => !q.has(i));
        const { tramos: _t, ...resto } = x;
        return (tramos.length ? { ...resto, tramos } : resto) as Objeto;
      });
    r = conLista(r, c, n);
  }
  return { ok: true, modelo: r };
}

function mover(m: ModeloFisico, o: Extract<Operacion, { op: "mover" }>): Paso {
  const l = [...lista(m, o.coleccion)];
  const i = l.findIndex((x) => x.id === o.id);
  if (i < 0) return { ok: false, errores: [error("editor/no-existe", `No hay ninguna ${nombreColeccion(o.coleccion)} «${o.id}».`, [o.id])] };
  const [x] = l.splice(i, 1);
  if (o.antesDe === null) l.push(x!);
  else {
    const j = l.findIndex((y) => y.id === o.antesDe);
    if (j < 0) return { ok: false, errores: [error("editor/no-existe", `No hay ninguna ${nombreColeccion(o.coleccion)} «${o.antesDe}».`, [o.antesDe])] };
    l.splice(j, 0, x!);
  }
  return { ok: true, modelo: conLista(m, o.coleccion, l) };
}

function paso(m: ModeloFisico, o: Operacion, datos: Partial<Pick<Proyecto, "nombre" | "descripcion">>): Paso {
  switch (o.op) {
    case "crear":
      return crear(m, o);
    case "cambiar":
      return cambiar(m, o);
    case "borrar":
      return borrar(m, o);
    case "mover":
      return mover(m, o);
    case "datos":
      return { ok: true, modelo: m, proyecto: { ...datos, ...("nombre" in o ? { nombre: o.nombre } : {}), ...("descripcion" in o ? { descripcion: o.descripcion } : {}) } };
    case "lote": {
      let r = m;
      let d = datos;
      for (const [k, x] of o.operaciones.entries()) {
        const s = paso(r, x, d);
        if (!s.ok) return { ...s, errores: s.errores.map((e) => ({ ...e, detalles: { ...e.detalles, operacion: k } })) };
        r = s.modelo;
        d = s.proyecto ?? d;
      }
      return { ok: true, modelo: r, proyecto: d };
    }
  }
}

/** Aplica una operación. El proyecto que sale pasa el esquema; si no, no se aplica. */
export function aplicar(p: Proyecto, o: Operacion): Aplicacion {
  const s = paso(p.modelo, o, { nombre: p.nombre, descripcion: p.descripcion });
  if (!s.ok) return s.usos ? { ok: false, errores: s.errores, usos: s.usos } : { ok: false, errores: s.errores };
  const q: Proyecto = { ...p, modelo: s.modelo };
  if (s.proyecto) {
    for (const k of ["nombre", "descripcion"] as const) {
      const v = s.proyecto[k];
      if (v === undefined || v === "") delete q[k];
      else q[k] = v;
    }
  }
  const c = comprobarProyecto(q);
  if (!c.valido) return { ok: false, errores: c.diagnosticos.map((d) => ({ ...d, severidad: "error" as const })) };
  return { ok: true, proyecto: q };
}
