/**
 * Los datos de la obra (fase DO, `docs/fem3d/datos-obra.md`): el uso del edificio y el material por
 * defecto de cada tipo de elemento. Van en el `proyecto.json` fuera del modelo, como las vistas y la
 * armadura base: no entran en la huella ni en el cálculo. Sólo deciden lo que se propone al crear
 * (el material de una sección o un forjado nuevos, la Q de uso de los casos típicos).
 *
 * El nombre, la descripción y el emplazamiento no están aquí: el nombre y la descripción son del
 * proyecto (`nombre`, `descripcion`) y el emplazamiento es del modelo (`acciones.emplazamiento`),
 * porque de él salen el viento, la nieve y el sismo.
 *
 * Puro: sin IO.
 */
import type { CategoriaUso } from "../combinaciones/psi.ts";
import type { Material, ModeloFisico } from "../compilador/fisico.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";

/** Los tipos de elemento con material por defecto (DO-h): las vigas van con los forjados. */
export const TIPOS_OBRA = ["forjados", "pilares", "muros", "perfiles"] as const;
export type TipoObra = (typeof TIPOS_OBRA)[number];

/** El material por defecto de cada tipo de elemento: el id de un material del modelo. */
export interface MaterialesObra {
  /** Losas, paños (su vigueta) y vigas de hormigón. */
  forjados?: string;
  /** Las secciones de los pilares de hormigón. */
  pilares?: string;
  muros?: string;
  /** Las secciones de acero (perfiles laminados), de pilares, vigas y barras. */
  perfiles?: string;
}

/** DO: los datos de la obra. No entran en la huella ni en el cálculo. */
export interface ObraProyecto {
  /** La categoría de uso del edificio (DB SE-AE tabla 3.1), para la Q de los casos típicos. */
  uso?: CategoriaUso;
  /** El material por defecto de cada tipo de elemento, para lo que se crea. */
  materiales?: MaterialesObra;
}

/** La familia de material de cada tipo: la que se propone y la que lista su desplegable. */
export const FAMILIA_OBRA: Record<TipoObra, Material["tipo"]> = { forjados: "hormigon", pilares: "hormigon", muros: "hormigon", perfiles: "acero" };

/** El nombre de cada tipo en un texto. */
export const NOMBRE_TIPO_OBRA: Record<TipoObra, string> = { forjados: "forjados y vigas", pilares: "pilares", muros: "muros", perfiles: "perfiles de acero" };

/** Los materiales que no existen en el modelo. */
export function comprobarObra(o: ObraProyecto | undefined, m: ModeloFisico): Diagnostico[] {
  const r: Diagnostico[] = [];
  const hay = new Set(m.materiales.map((x) => x.id));
  for (const t of TIPOS_OBRA) {
    const id = o?.materiales?.[t];
    if (id !== undefined && !hay.has(id))
      r.push({ codigo: "obra/material-inexistente", severidad: "error", mensaje: `El material por defecto de los ${NOMBRE_TIPO_OBRA[t]} es «${id}», que no es un material del modelo.`, ids: [id], detalles: { tipo: t } });
  }
  return r;
}

/** El bloque sin lo vacío: undefined si no queda nada. */
export function limpiarObra(o: ObraProyecto | null | undefined): ObraProyecto | undefined {
  if (!o) return undefined;
  const materiales: MaterialesObra = {};
  for (const t of TIPOS_OBRA) {
    const v = o.materiales?.[t];
    if (v !== undefined && v !== "") materiales[t] = v;
  }
  // Una clave que no es un tipo se queda, para que la rechace el esquema
  for (const [k, v] of Object.entries(o.materiales ?? {})) if (!(TIPOS_OBRA as readonly string[]).includes(k) && v !== undefined) (materiales as Record<string, string>)[k] = v;
  const { uso: _u, materiales: _m, ...resto } = o;
  const r: ObraProyecto = { ...(o.uso ? { uso: o.uso } : {}), ...(Object.keys(materiales).length ? { materiales } : {}), ...resto };
  return Object.keys(r).length ? r : undefined;
}

/**
 * El bloque tras una operación del editor: los materiales renombrados o reasignados (`viejo →
 * nuevo`) con su nuevo id, y sin los que se borraron (un valor por defecto que desaparece no rompe
 * nada: se vuelve a proponer el más usado). Lo que ya no existía antes se queda como está (lo dice
 * `comprobarObra`; no se pierde en silencio).
 */
export function seguirMateriales(o: ObraProyecto | undefined, renombres: ReadonlyMap<string, string>, antes: ModeloFisico, despues: ModeloFisico): ObraProyecto | undefined {
  if (!o?.materiales) return o;
  const eran = new Set(antes.materiales.map((x) => x.id));
  const son = new Set(despues.materiales.map((x) => x.id));
  let cambia = false;
  const materiales: MaterialesObra = { ...o.materiales };
  for (const t of TIPOS_OBRA) {
    const id = o.materiales[t];
    if (id === undefined) continue;
    const n = renombres.get(id) ?? id;
    if (eran.has(id) && !son.has(n)) {
      delete materiales[t];
      cambia = true;
    } else if (n !== id) {
      materiales[t] = n;
      cambia = true;
    }
  }
  return cambia ? limpiarObra({ ...o, materiales }) : o;
}

/** El material por defecto de un tipo, si está en el modelo. */
export function materialDeObra(o: ObraProyecto | undefined, tipo: TipoObra, m: ModeloFisico): string | undefined {
  const id = o?.materiales?.[tipo];
  return id !== undefined && m.materiales.some((x) => x.id === id) ? id : undefined;
}
