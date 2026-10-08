/**
 * Fichero de proyecto de la capa de agente (A0, `docs/fem3d/agente.md` §7): el modelo físico y las
 * opciones de compilación en un JSON con esquema versionado. Es la única fuente de verdad (regla
 * A2): los resultados se regeneran desde él y se identifican por la huella de compilación.
 *
 * Es puro (sin IO): entra el texto del fichero y salen el proyecto o sus diagnósticos. La CLI
 * (`cli/fem.ts`) es la que lee y escribe ficheros.
 */
import type { ModeloFisico, OpcionesCompilacion } from "../compilador/fisico.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { validarEsquema, type EsquemaRaiz } from "./esquema.ts";
import esquemaProyecto from "./proyecto.schema.json" with { type: "json" };

/** Versión del esquema del fichero: un cambio incompatible sube el número. */
export const VERSION_ESQUEMA = "concreta-fem/proyecto@1";

/** Proyecto de Concreta FEM 3D: el modelo físico y sus opciones de compilación. Unidades kN y m. */
export interface Proyecto {
  /** Para el editor: ruta o URL de este esquema. No cambia nada del cálculo. */
  $schema?: string;
  /** Versión del esquema del fichero. */
  esquema: typeof VERSION_ESQUEMA;
  /** Nombre del proyecto. No entra en la huella. */
  nombre?: string;
  /** Descripción libre. No entra en la huella. */
  descripcion?: string;
  modelo: ModeloFisico;
  /** Opciones de compilación; por defecto, las decididas (C1-a, D4, C2-a…). */
  opciones?: OpcionesCompilacion;
}

export type Lectura = { valido: true; proyecto: Proyecto; diagnosticos: Diagnostico[] } | { valido: false; diagnosticos: Diagnostico[] };

/**
 * Lee el texto de un `proyecto.json`: JSON, versión y esquema. No compila: lo que el esquema no
 * puede ver (referencias, geometría, cotas…) lo dice `compilar`.
 */
export function leerProyecto(texto: string): Lectura {
  let dato: unknown;
  try {
    dato = JSON.parse(texto);
  } catch (e) {
    return { valido: false, diagnosticos: [{ codigo: "proyecto/json", severidad: "error", mensaje: `El fichero no es JSON válido: ${e instanceof Error ? e.message : String(e)}.` }] };
  }
  return comprobarProyecto(dato);
}

/** Comprueba un proyecto ya leído: versión y esquema. */
export function comprobarProyecto(dato: unknown): Lectura {
  if (typeof dato === "object" && dato !== null && !Array.isArray(dato)) {
    const v = (dato as Record<string, unknown>).esquema;
    if (v !== undefined && v !== VERSION_ESQUEMA)
      return {
        valido: false,
        diagnosticos: [
          {
            codigo: "proyecto/version",
            severidad: "error",
            mensaje: `El proyecto es de la versión de esquema ${JSON.stringify(v)} y este programa lee la ${JSON.stringify(VERSION_ESQUEMA)}.`,
            detalles: { ruta: "esquema" },
          },
        ],
      };
  }
  const diagnosticos = validarEsquema(esquemaProyecto as unknown as EsquemaRaiz, dato);
  return diagnosticos.length ? { valido: false, diagnosticos } : { valido: true, proyecto: dato as Proyecto, diagnosticos: [] };
}

/** El esquema del proyecto (JSON Schema 2020-12), generado desde los tipos (`scripts/generar-esquema.ts`). */
export function esquema(): EsquemaRaiz {
  return esquemaProyecto as unknown as EsquemaRaiz;
}
