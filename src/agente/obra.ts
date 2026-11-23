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
import { EXPOSICIONES, FLECHAS_ACTIVAS, type DatosArmado } from "../comprobaciones/armado.ts";
import type { Material, ModeloFisico } from "../compilador/fisico.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";

/** Los tipos de elemento con material por defecto (DO-h): las vigas van con los forjados. Las zapatas (CO5) no están en el modelo: su hormigón es el de sus comprobaciones. */
export const TIPOS_OBRA = ["forjados", "pilares", "muros", "perfiles", "zapatas"] as const;
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
  /** CO5: el hormigón de las zapatas de los pilares (fuera del modelo: el de sus comprobaciones). */
  zapatas?: string;
}

/**
 * CO5: el terreno bajo las zapatas, del estudio geotécnico. Sin la tensión admisible no se comprueba
 * ninguna zapata; lo demás tiene valor por defecto (`DATOS_TERRENO`).
 */
export interface DatosTerreno {
  /** Tensión admisible del terreno, kPa (la presión total bruta sobre el área equivalente, DB SE-C 4.3.1.3). */
  tensionAdmisible?: number;
  /** En las combinaciones sísmicas (GEO-SIS), kPa; sin ella, la de arriba. */
  tensionAdmisibleSismo?: number;
  /** Peso específico de las tierras sobre las zapatas, kN/m³. */
  pesoEspecifico?: number;
  /** Coeficiente de rozamiento entre la zapata y el terreno, para el deslizamiento. */
  rozamiento?: number;
  /** Tierras sobre la cara superior de las zapatas, m (la de cada zapata puede ser otra). */
  tierras?: number;
}

/** Lo del terreno que tiene valor por defecto. */
export const DATOS_TERRENO = { pesoEspecifico: 18, rozamiento: 0.5, tierras: 0 } as const;

/** DO: los datos de la obra. No entran en la huella ni en el cálculo. */
export interface ObraProyecto {
  /** La categoría de uso del edificio (DB SE-AE tabla 3.1), para la Q de los casos típicos. */
  uso?: CategoriaUso;
  /** El material por defecto de cada tipo de elemento, para lo que se crea. */
  materiales?: MaterialesObra;
  /** CO: lo común a las armaduras de la obra: acero, recubrimiento y fluencia. Lo que falta, por defecto. */
  armado?: DatosArmado;
  /** CO5: el terreno bajo las zapatas. */
  terreno?: DatosTerreno;
}

/** La familia de material de cada tipo: la que se propone y la que lista su desplegable. */
export const FAMILIA_OBRA: Record<TipoObra, Material["tipo"]> = { forjados: "hormigon", pilares: "hormigon", muros: "hormigon", perfiles: "acero", zapatas: "hormigon" };

/** El nombre de cada tipo en un texto. */
export const NOMBRE_TIPO_OBRA: Record<TipoObra, string> = { forjados: "forjados y vigas", pilares: "pilares", muros: "muros", perfiles: "perfiles de acero", zapatas: "zapatas" };

/** Los materiales que no existen en el modelo. */
export function comprobarObra(o: ObraProyecto | undefined, m: ModeloFisico): Diagnostico[] {
  const r: Diagnostico[] = [];
  const hay = new Set(m.materiales.map((x) => x.id));
  for (const t of TIPOS_OBRA) {
    const id = o?.materiales?.[t];
    if (id !== undefined && !hay.has(id))
      r.push({ codigo: "obra/material-inexistente", severidad: "error", mensaje: `El material por defecto de los ${NOMBRE_TIPO_OBRA[t]} es «${id}», que no es un material del modelo.`, ids: [id], detalles: { tipo: t } });
  }
  const a = o?.armado;
  const rango = (v: number | undefined, que: string, min: number, max: number, unidad: string) => {
    if (v !== undefined && !(Number.isFinite(v) && v >= min && v <= max))
      r.push({ codigo: "obra/armado", severidad: "error", mensaje: `${que} de las armaduras de la obra tiene que estar entre ${min} y ${max}${unidad}, y es ${String(v)}.` });
  };
  rango(a?.fyk, "El límite elástico (fyk)", 400, 600, " MPa");
  rango(a?.recubrimiento, "El recubrimiento", 10, 100, " mm");
  rango(a?.phiEf, "El coeficiente de fluencia efectivo (phiEf)", 0, 4, "");
  rango(a?.recubrimientoZapatas, "El recubrimiento de las zapatas (recubrimientoZapatas)", 20, 150, " mm");
  if (a?.exposicion !== undefined && !EXPOSICIONES.includes(a.exposicion))
    r.push({ codigo: "obra/armado", severidad: "error", mensaje: `La clase de exposición de las armaduras de la obra tiene que ser una de ${EXPOSICIONES.join(", ")}, y es ${String(a.exposicion)}.` });
  if (a?.minimaReducidaCimentacion !== undefined && typeof a.minimaReducidaCimentacion !== "boolean")
    r.push({ codigo: "obra/armado", severidad: "error", mensaje: `La armadura mínima reducida de las losas de cimentación (minimaReducidaCimentacion) es true o false, y es ${String(a.minimaReducidaCimentacion)}.` });
  if (a?.flechaActiva !== undefined && !(FLECHAS_ACTIVAS as readonly number[]).includes(a.flechaActiva))
    r.push({ codigo: "obra/armado", severidad: "error", mensaje: `El límite de la flecha activa de la obra (flechaActiva) tiene que ser ${FLECHAS_ACTIVAS.join(", ")} (L/…), y es ${String(a.flechaActiva)}.` });
  // CO5: el terreno
  const t = o?.terreno;
  const terreno = (v: number | undefined, que: string, min: number, max: number, unidad: string) => {
    if (v !== undefined && !(Number.isFinite(v) && v >= min && v <= max))
      r.push({ codigo: "obra/terreno", severidad: "error", mensaje: `${que} del terreno tiene que estar entre ${min} y ${max}${unidad}, y es ${String(v)}.` });
  };
  terreno(t?.tensionAdmisible, "La tensión admisible (tensionAdmisible)", 10, 5000, " kPa");
  terreno(t?.tensionAdmisibleSismo, "La tensión admisible en las combinaciones sísmicas (tensionAdmisibleSismo)", 10, 5000, " kPa");
  terreno(t?.pesoEspecifico, "El peso específico de las tierras (pesoEspecifico)", 10, 25, " kN/m³");
  terreno(t?.rozamiento, "El coeficiente de rozamiento (rozamiento)", 0.1, 1.5, "");
  terreno(t?.tierras, "El espesor de las tierras sobre las zapatas (tierras)", 0, 10, " m");
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
