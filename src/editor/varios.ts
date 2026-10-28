/**
 * Editar varios objetos a la vez (a petición del usuario, 2026-10-28): de los elegidos de una tabla,
 * cada columna con su valor si es el mismo en todos o «varios» si no, y escribir un valor en todos
 * de una vez. Es lo que hace la tabla fila a fila (`operacionFila` con `filaConValor`), en un lote:
 * o entran todos o ninguno, y se deshace de una vez.
 *
 * Puro: sin IO.
 */
import type { ModeloFisico } from "../compilador/fisico.ts";
import type { Fila } from "./celdas.ts";
import { operacionFila, type ErrorFila, type Traduccion } from "./edicion.ts";
import { indiceIds } from "./referencias.ts";
import { contexto, DEF_TABLAS, filaConValor, objetosTabla, tablaDeColeccion, type Columna, type NombreTabla } from "./tablas.ts";

/** Una columna de los elegidos: `valor`, el de todos, o null si no es el mismo. */
export interface ColumnaComun {
  columna: Columna;
  valor: string | null;
}

/** Los elegidos repartidos por su tabla, en el orden de las tablas (lo que no está en ninguna, fuera). */
export function porTabla(m: ModeloFisico, ids: readonly string[]): Map<NombreTabla, string[]> {
  const idx = indiceIds(m);
  const r = new Map<NombreTabla, string[]>();
  for (const id of ids) {
    const c = idx.get(id)?.coleccion;
    const t = c ? tablaDeColeccion(c) : null;
    if (t) r.set(t, [...(r.get(t) ?? []), id]);
  }
  return r;
}

/** Las filas de los objetos `ids` de la tabla (los que no están, fuera). */
function filasDe(m: ModeloFisico, tabla: NombreTabla, ids: readonly string[]): { id: string; fila: Fila }[] {
  const def = DEF_TABLAS[tabla];
  const ctx = contexto(m);
  const quiero = new Set(ids);
  return objetosTabla(m, tabla)
    .filter((o) => quiero.has(o.id))
    .map((o) => ({ id: o.id, fila: def.fila(o, ctx) }));
}

/**
 * Las columnas que se pueden ver juntas: todas menos el id y, en Forjados, las que no aplican a
 * alguno (las de un reticular, si hay también una maciza).
 */
export function columnasComunes(m: ModeloFisico, tabla: NombreTabla, ids: readonly string[]): ColumnaComun[] {
  const def = DEF_TABLAS[tabla];
  const fs = filasDe(m, tabla, ids);
  if (!fs.length) return [];
  return def.columnas
    .filter((c) => c.clave !== "id")
    .filter((c) => !def.aplica || fs.every((f) => def.aplica!(c.clave, f.fila) || (f.fila[c.clave] ?? "") !== ""))
    .map((c) => {
      const v0 = fs[0]!.fila[c.clave] ?? "";
      return { columna: c, valor: fs.every((f) => (f.fila[c.clave] ?? "") === v0) ? v0 : null };
    });
}

/**
 * La operación de escribir `valor` en la columna `clave` de todos los objetos `ids` de la tabla: un
 * lote con la de cada uno (los que ya lo tienen, fuera). Si alguno no lo admite, ninguno, con los
 * errores de cada uno.
 */
export function operacionVarios(m: ModeloFisico, tabla: NombreTabla, ids: readonly string[], clave: string, valor: string): Traduccion {
  if (clave === "id") return { ok: false, errores: [{ fila: null, columna: "id", mensaje: "El id es de cada uno: no se cambia en varios a la vez." }] };
  const def = DEF_TABLAS[tabla];
  const ops = [];
  const errores: ErrorFila[] = [];
  for (const { id, fila } of filasDe(m, tabla, ids)) {
    if ((fila[clave] ?? "") === valor) continue;
    const t = operacionFila(m, tabla, id, filaConValor(def, fila, clave, valor));
    if (t.ok) ops.push(t.operacion);
    else errores.push(...t.errores.map((e) => ({ ...e, id })));
  }
  if (errores.length) return { ok: false, errores };
  if (ops.length === 1) return { ok: true, operacion: ops[0]! };
  return { ok: true, operacion: { op: "lote", operaciones: ops } };
}
