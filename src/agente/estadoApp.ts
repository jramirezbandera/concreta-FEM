/**
 * Lo que se mira en la app, para el agente (`docs/fem3d/agente.md` §13): la app deja en
 * `.fem/app.json`, junto al proyecto, la planta, el espacio y lo elegido, y `fem seleccion` lo lee
 * con cada objeto tal como está en el fichero. Así «esta viga» o «lo que tengo elegido» se entiende
 * sin dictar ids.
 *
 * - Lo escribe la app cuando cambia (tras una pausa), sólo si el proyecto está en una carpeta del
 *   disco o en el servidor local de `fem visor`: un proyecto del navegador no tiene dónde.
 * - Es derivado: no entra en la huella ni en el proyecto, y se puede borrar.
 * - `huella` es la de la versión que la app tiene compilada; si no es la del fichero, la app enseña
 *   otra versión (cambios sin guardar, o el fichero cambió después) y `fem seleccion` lo dice.
 *
 * Puro: sin IO.
 */
import type { Proyecto } from "./proyecto.ts";
import { indiceIds, lista, type Coleccion } from "../editor/referencias.ts";

export const ESQUEMA_APP = "concreta-fem/app@1";
/** El fichero, dentro de `.fem/`. */
export const FICHERO_APP = "app.json";
/** Tamaño máximo que se acepta (lo elegido son ids: con miles, sigue siendo poco). */
export const MAX_BYTES_APP = 256 * 1024;

export interface EstadoApp {
  esquema: typeof ESQUEMA_APP;
  /** El fichero del proyecto que tiene abierto la app, junto a `.fem/`. */
  proyecto: string;
  /** ISO 8601. */
  fecha: string;
  /** Huella de la versión que la app tiene compilada (null mientras compila la primera). */
  huella: string | null;
  /** La app tiene cambios que no están en el fichero. */
  sinGuardar: boolean;
  espacio: string;
  /** En Resultados, el modo (losas, diagramas, pilares, armado, deformada, reacciones). */
  modo?: string;
  planta: string | null;
  /** Lo elegido, en el orden en que se eligió (el último es el de Propiedades). */
  elegidos: string[];
}

/** El texto del fichero (sin la fecha, para comparar si cambió algo: `clave`). */
export function textoEstadoApp(e: Omit<EstadoApp, "esquema" | "fecha">, fecha: Date): string {
  const x: EstadoApp = { esquema: ESQUEMA_APP, proyecto: e.proyecto, fecha: fecha.toISOString(), huella: e.huella, sinGuardar: e.sinGuardar, espacio: e.espacio, ...(e.modo ? { modo: e.modo } : {}), planta: e.planta, elegidos: e.elegidos };
  return `${JSON.stringify(x, null, 2)}\n`;
}

export const claveEstadoApp = (e: Omit<EstadoApp, "esquema" | "fecha">): string => JSON.stringify([e.proyecto, e.huella, e.sinGuardar, e.espacio, e.modo ?? null, e.planta, e.elegidos]);

/** Lee el fichero; null si no es un estado de la app. */
export function leerEstadoApp(texto: string): EstadoApp | null {
  try {
    const x = JSON.parse(texto) as Partial<EstadoApp>;
    if (x.esquema !== ESQUEMA_APP || typeof x.proyecto !== "string" || !Array.isArray(x.elegidos) || !x.elegidos.every((y) => typeof y === "string")) return null;
    return {
      esquema: ESQUEMA_APP,
      proyecto: x.proyecto,
      fecha: typeof x.fecha === "string" ? x.fecha : "",
      huella: typeof x.huella === "string" ? x.huella : null,
      sinGuardar: x.sinGuardar === true,
      espacio: typeof x.espacio === "string" ? x.espacio : "",
      ...(typeof x.modo === "string" ? { modo: x.modo } : {}),
      planta: typeof x.planta === "string" ? x.planta : null,
      elegidos: x.elegidos,
    };
  } catch {
    return null;
  }
}

export interface ObjetoElegido {
  id: string;
  /** La colección del modelo («pilares», «vigas», «cargas»…). */
  coleccion: Coleccion;
  /** El objeto tal como está en el fichero. */
  objeto: Record<string, unknown>;
}

export interface SeleccionApp {
  proyecto: string;
  fecha: string;
  /** Segundos desde que la app lo escribió (con `ahora`). */
  antiguedad: number | null;
  espacio: string;
  modo?: string;
  planta: string | null;
  elegidos: ObjetoElegido[];
  /** Ids elegidos en la app que no están en el fichero (creados en la app sin guardar, o borrados después). */
  noEnElFichero: string[];
  /** La app enseña la versión del fichero (misma huella y nada sin guardar). */
  alDia: boolean;
  avisos: string[];
}

/** Lo elegido en la app, con cada objeto tal como está en el fichero. */
export function seleccionApp(e: EstadoApp, p: Proyecto, huellaFichero: string, ahora: Date): SeleccionApp {
  const ix = indiceIds(p.modelo);
  const elegidos: ObjetoElegido[] = [];
  const noEnElFichero: string[] = [];
  for (const id of e.elegidos) {
    const x = ix.get(id);
    if (!x) noEnElFichero.push(id);
    else elegidos.push({ id, coleccion: x.coleccion, objeto: lista(p.modelo, x.coleccion)[x.indice] as Record<string, unknown> });
  }
  const avisos: string[] = [];
  const t = Date.parse(e.fecha);
  const antiguedad = Number.isFinite(t) ? Math.max(0, Math.round((ahora.getTime() - t) / 1000)) : null;
  if (e.sinGuardar) avisos.push("La app tiene cambios sin guardar: lo que se ve allí no es lo del fichero. Pídele al ingeniero que guarde antes de que cambies nada.");
  else if (e.huella && e.huella !== huellaFichero) avisos.push("La app enseña otra versión del modelo que la del fichero (el fichero cambió después, o aún lo está recargando).");
  if (noEnElFichero.length) avisos.push(`${noEnElFichero.join(", ")}: elegido en la app, pero no está en el fichero.`);
  if (e.planta && !p.modelo.plantas.some((x) => x.id === e.planta)) avisos.push(`La planta ${e.planta} de la app no está en el fichero.`);
  return { proyecto: e.proyecto, fecha: e.fecha, antiguedad, espacio: e.espacio, ...(e.modo ? { modo: e.modo } : {}), planta: e.planta, elegidos, noEnElFichero, alDia: !e.sinGuardar && (e.huella === null || e.huella === huellaFichero), avisos };
}

