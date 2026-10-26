/**
 * Fichero de proyecto de la capa de agente (A0, `docs/fem3d/agente.md` §7): el modelo físico y las
 * opciones de compilación en un JSON con esquema versionado. Es la única fuente de verdad (regla
 * A2): los resultados se regeneran desde él y se identifican por la huella de compilación.
 *
 * Es puro (sin IO): entra el texto del fichero y salen el proyecto o sus diagnósticos. La CLI
 * (`cli/fem.ts`) es la que lee y escribe ficheros.
 */
import type { ModeloFisico, OpcionesCompilacion } from "../compilador/fisico.ts";
import type { ArmadoProyecto } from "./armaduraBase.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { validarEsquema, type EsquemaRaiz } from "../compilador/esquema.ts";
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
  /**
   * I3: vistas guardadas del visor (`docs/fem3d/interfaz.md` §16), con su nombre. Sólo para mirar el
   * modelo: no entran en la huella ni en el cálculo.
   */
  vistas?: VistaGuardada[];
  /**
   * AB: la armadura base de las losas (`docs/fem3d/armado.md` §2.5), el momento que cubre en kN·m/m:
   * la común y la de cada losa. Para ver sólo lo que queda por encima (las zonas de refuerzo); no
   * entra en la huella ni en el cálculo.
   */
  armado?: ArmadoProyecto;
  /**
   * V2c-4: las plantillas DXF de las plantas (`docs/fem3d/dibujo.md` §10), para calcar. Sólo para
   * dibujar: no entran en la huella ni en el cálculo.
   */
  plantillas?: PlantillaDxf[];
}

/**
 * Una plantilla DXF (V2c-4): un plano en gris detrás de unas plantas, con enganches a sus líneas y
 * vértices. El fichero va junto al proyecto (en el disco) o en el navegador, y se reconoce por su
 * sha256. Un punto del DXF va al modelo como p = traslación + R(giro) · (p_dxf en m).
 */
export interface PlantillaDxf {
  /** Lo que se ve en el navegador; único entre las plantillas del proyecto. */
  nombre: string;
  /** Nombre del fichero DXF, junto al `proyecto.json`. */
  fichero: string;
  /** sha256 del fichero, en hexadecimal. */
  sha256: string;
  /** Unidades de las coordenadas del DXF. */
  unidades: "m" | "cm" | "mm" | "in" | "ft";
  /** Traslación, m; por defecto, ninguna. */
  traslacion?: [number, number];
  /** Giro, grados en sentido antihorario alrededor del origen del DXF; por defecto, 0. */
  giro?: number;
  /** Las plantas en las que se ve. */
  plantas: string[];
  /** Capas del DXF que no se ven ni enganchan. */
  ocultas?: string[];
  /** Redondeo de lo que se engancha de la plantilla, m: 0,001 por defecto (V2c4-c), 0,01, o 0 (nada). */
  redondeo?: 0 | 0.01 | 0.001;
}

/**
 * Una vista guardada del visor (I3): su tipo, lo que enseña, su cámara y sus filtros. Lo que no se
 * dice toma el valor por defecto del visor. Una planta o un eje que ya no existen se cambian por el
 * primero al abrirla.
 */
export interface VistaGuardada {
  /** Lo que se ve en el navegador; único entre las vistas del proyecto. */
  nombre: string;
  tipo: "planta" | "alzado" | "3d";
  /** La planta que se ve (planta) o la que se resalta (3D). */
  planta?: string;
  /** El eje del alzado. */
  eje?: string;
  /** Lo que dibuja una planta en Modelo. */
  dibujo?: "modelo" | "diagnosticos" | "malla";
  modo3d?: "alambrico" | "solido" | "translucido" | "analitico";
  proyeccion?: "perspectiva" | "ortografica";
  /** El color del sólido. */
  color3d?: "material" | "seccion" | "planta";
  /** ±d de un alzado, m. */
  profundidad?: number;
  /** La cámara de un 3D: su posición C y el punto al que mira T, m. */
  camara3d?: { C: [number, number, number]; T: [number, number, number] };
  /** La cámara de una planta o un alzado: el centro de la vista (m) y la escala (px/m). */
  camara2d?: { cx: number; cy: number; escala: number };
  filtro?: FiltroGuardado;
}

/** Los filtros de un 3D guardado (I3): rango de plantas, tipos que no se ven, aislados, ocultos y caja de sección (m). */
export interface FiltroGuardado {
  /** La planta de abajo del rango. */
  desde?: string;
  /** La planta de arriba del rango. */
  hasta?: string;
  sinTipos?: ("pilar" | "viga" | "losa" | "pano" | "muro" | "apoyo")[];
  aislados?: string[];
  ocultos?: string[];
  /** [xmin, ymin, zmin, xmax, ymax, zmax]. */
  caja?: [number, number, number, number, number, number];
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
