// Superficie publica de la BIBLIOTECA (catalogo de materiales y secciones).
//
// La biblioteca es un catalogo fijo e inmutable (Opcion A, feature-3): NO se
// persiste con el Modelo (Capa 1); el dominio referencia sus entradas por
// `materialId`/`seccionId`. Este barrel re-exporta tipos, catalogos y helpers, y
// anade la superficie de LOOKUP por id que feature-4 (discretizador/validaciones)
// usara para resolver y validar esas referencias.
//
// PURA: sin React, sin IO, sin Pyodide. Solo datos y funciones puras (CLAUDE.md).

import { ACEROS } from "./aceros";
import { HORMIGONES } from "./hormigon";
import { PERFILES } from "./perfiles";
import type { EntradaMaterial, EntradaSeccion } from "./tipos";

// --- Re-export de tipos -------------------------------------------------------
export type {
  EntradaMaterial,
  EntradaMaterialBase,
  EntradaMaterialHormigon,
  EntradaMaterialAcero,
  EntradaSeccion,
  TipoSeccionCatalogo,
} from "./tipos";
export type { EntradaCategoriaUso } from "./acciones";

// --- Re-export de la tabla normativa de acciones (feature-13 T1.1) ------------
// Sobrecargas de uso (qk) y coef. de simultaneidad (psi) por categoria, mas los
// coef. parciales gamma. Tabla de datos aislada y verificable (CTE DB-SE/DB-SE-AE).
export {
  categoriaUso,
  listarCategoriasUso,
  GAMMA_G_DESFAV,
  GAMMA_G_FAV,
  GAMMA_Q_DESFAV,
  GAMMA_Q_FAV,
  GAMMA_ELS,
} from "./acciones";

// --- Re-export de catalogos y helpers -----------------------------------------
export { ACEROS } from "./aceros";
export { HORMIGONES, derivarEcm, seccionRectangular, seccionCircular } from "./hormigon";
export { PERFILES, IPE, HEB } from "./perfiles";

// --- Catalogo combinado de materiales -----------------------------------------
// Union de todos los materiales del catalogo. El tipo es `EntradaMaterial[]`
// (union discriminada por `tipo`), de modo que el consumidor distingue hormigon
// de acero sin perder el estrechamiento del compilador.
export const MATERIALES: EntradaMaterial[] = [...ACEROS, ...HORMIGONES];

// Catalogo combinado de secciones FIJAS del catalogo. Solo perfiles metalicos:
// las secciones de hormigon son parametricas (las dimensiona el usuario y se
// derivan con `seccionRectangular`/`seccionCircular`), por lo que NO son entradas
// fijas y no aparecen aqui. El lookup por id cubre las secciones tabuladas.
export const SECCIONES: EntradaSeccion[] = [...PERFILES];

// --- Lookup por id ------------------------------------------------------------
// Se precomputa un Map por id (en vez de `.find()` por llamada) porque el
// discretizador resolvera muchas referencias por cada calculo: O(1) amortizado y
// una sola construccion al cargar el modulo. Los catalogos son inmutables, asi
// que el indice nunca se invalida.
const MATERIALES_POR_ID: ReadonlyMap<string, EntradaMaterial> = new Map(
  MATERIALES.map((m) => [m.id, m]),
);
const SECCIONES_POR_ID: ReadonlyMap<string, EntradaSeccion> = new Map(
  SECCIONES.map((s) => [s.id, s]),
);

// Devuelve el material de catalogo con ese `id`, o `undefined` si no existe.
// `undefined` (no excepcion) permite a validaciones.ts emitir un error en
// lenguaje de obra ("la seccion X no existe en la biblioteca").
export function getMaterial(id: string): EntradaMaterial | undefined {
  return MATERIALES_POR_ID.get(id);
}

// Devuelve la seccion FIJA de catalogo con ese `id`, o `undefined`. Las secciones
// de hormigon parametricas no estan indexadas (se generan bajo demanda).
export function getSeccion(id: string): EntradaSeccion | undefined {
  return SECCIONES_POR_ID.get(id);
}

// Listados para la UI futura (biblioteca de secciones, selectores). Devuelven una
// copia para que el consumidor no pueda mutar el catalogo interno por referencia.
export function listarMateriales(): EntradaMaterial[] {
  return [...MATERIALES];
}

export function listarSecciones(): EntradaSeccion[] {
  return [...SECCIONES];
}
