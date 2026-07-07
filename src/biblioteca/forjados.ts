// Tabla de datos normativa del PESO PROPIO de forjados (kN/m²).
// Corte "forjado unidireccional", T1.3: el pano unidireccional gana un campo
// `pesoPropio` (kN/m²) editable por el usuario. Aqui vive el DEFAULT y la tabla
// orientativa canto->peso, con fuente citada, para poblar ese campo.
//
// Tabla de datos aislada y corregible, calcada al patron de `acciones.ts` y
// `hormigon.ts`: cada valor cita su fuente (documento / tabla) y lleva marca de
// verificacion, de modo que una correccion sea un cambio de UN dato, no de codigo
// (CLAUDE.md, regla anti-alucinacion).
//
// NORMA APLICABLE: el peso propio de elementos constructivos es una ACCION
// permanente, y las acciones en edificacion siguen el CTE (NO derogado, a
// diferencia de los materiales, que van por Codigo Estructural):
//   - CTE DB-SE-AE (Acciones en la edificacion), Anejo C "Practicas constructivas
//     que pueden considerarse habituales", Tabla C.5 "Peso propio de elementos
//     constructivos", subseccion "Forjados".
//
// VALORES VERIFICADOS (2026-07-06) contra el PDF oficial de codigotecnico.org
// (edicion "Abril 2009", pagina SE-AE 20). Transcripcion literal de la subseccion
// "Forjados" de la Tabla C.5:
//   - Chapa grecada con capa de hormigon; grueso total < 0,12 m ............. 2 kN/m²
//   - Forjado UNIDIRECCIONAL, luces de hasta 5 m; grueso total < 0,28 m ..... 3 kN/m²
//   - Forjado uni o bidireccional; grueso total < 0,30 m ................... 4 kN/m²
//   - Forjado bidireccional, grueso total < 0,35 m ........................ 5 kN/m²
//   - Losa maciza de hormigon, grueso total 0,20 m ........................ 5 kN/m²
// Estos son valores ORIENTATIVOS de "practica constructiva habitual": el CTE los
// da por CANTO TOTAL (grueso), NO desglosados por intereje ni por material de
// bovedilla. Son la referencia que el arquitecto puede afinar segun ficha tecnica.
//
// UNIDADES (CLAUDE.md §14): el peso propio se almacena en kN/m², que YA es la
// unidad interna de carga superficial -> NO hay conversion. El `canto` que entra
// al helper se expresa en METROS (unidad interna de geometria), coherente con el
// "grueso total" de la Tabla C.5 (que la propia norma tabula en m). Identificadores
// ASCII; los umbrales de la norma se citan en su forma original (0,28 / 0,30 / 0,35).

// --- Tipo de la entrada de la tabla orientativa -------------------------------

// Una fila de la tabla orientativa de forjados: el canto total maximo (grueso, en
// m) que cubre el tramo, el peso propio asociado (kN/m²) y la descripcion literal
// de la Tabla C.5. `cantoMax` es el LIMITE SUPERIOR del tramo (grueso total < ...).
export interface EntradaForjado {
  cantoMax: number; // grueso total maximo del tramo, en m (limite superior)
  pesoPropio: number; // peso propio orientativo, kN/m² (interno; sin conversion)
  descripcion: string; // etiqueta literal de la Tabla C.5 (UI, con tildes)
}

// --- Tabla orientativa de forjados UNIDIRECCIONALES (CTE DB-SE-AE Tabla C.5) ---
//
// Solo se tabulan aqui los tramos APLICABLES a un forjado UNIDIRECCIONAL (el
// elemento del corte). La Tabla C.5 nombra "unidireccional" hasta grueso < 0,28 m
// (3 kN/m²) y a partir de ahi lo agrupa con el bidireccional ("uni o bidireccional
// grueso < 0,30 m" -> 4; "bidireccional grueso < 0,35 m" -> 5). Un forjado
// unidireccional de canto >= 0,28 m cae por tanto en el tramo "< 0,30 m -> 4".
//
// El tramo "Chapa grecada... < 0,12 m -> 2" y la "Losa maciza 0,20 m -> 5" NO son
// forjados unidireccionales de viguetas+bovedillas, asi que NO entran en esta tabla
// (la losa maciza es otro elemento del proyecto, ya modelado como quad FEM).
//
// Los tramos van ORDENADOS por `cantoMax` ascendente: el helper toma el PRIMER
// tramo cuyo limite cubre el canto dado.
//
// VERIFICAR contra CTE DB-SE-AE Anejo C, Tabla C.5 "Forjados" (vigente).
const TABLA_UNIDIRECCIONAL: readonly EntradaForjado[] = [
  // Forjado unidireccional, luces de hasta 5 m; grueso total < 0,28 m -> 3 kN/m².
  // Fuente: DB-SE-AE Tabla C.5, subseccion Forjados, fila "Forjado unidireccional".
  // VERIFICAR contra CTE DB-SE-AE Anejo C Tabla C.5
  { cantoMax: 0.28, pesoPropio: 3, descripcion: "Forjado unidireccional, luces de hasta 5 m; grueso total < 0,28 m" },
  // Forjado uni o bidireccional; grueso total < 0,30 m -> 4 kN/m². Cubre el
  // unidireccional de canto habitual 0,28..0,30 m (p.ej. 0,30 con intereje 0,70).
  // Fuente: DB-SE-AE Tabla C.5, subseccion Forjados, fila "Forjado uni o bidireccional".
  // VERIFICAR contra CTE DB-SE-AE Anejo C Tabla C.5
  { cantoMax: 0.3, pesoPropio: 4, descripcion: "Forjado uni o bidireccional; grueso total < 0,30 m" },
  // Forjado bidireccional, grueso total < 0,35 m -> 5 kN/m². La norma solo nombra
  // "bidireccional" en este tramo, pero se usa como cota superior orientativa para
  // un unidireccional de gran canto (0,30..0,35 m). Marcado como extrapolacion.
  // Fuente: DB-SE-AE Tabla C.5, subseccion Forjados, fila "Forjado bidireccional".
  // TODO VERIFICAR: este tramo la norma lo tabula como "bidireccional"; se adopta
  //   como cota orientativa para unidireccional de canto > 0,30 m (extrapolacion).
  // VERIFICAR contra CTE DB-SE-AE Anejo C Tabla C.5
  { cantoMax: 0.35, pesoPropio: 5, descripcion: "Forjado (bi/unidireccional) de gran canto; grueso total < 0,35 m" },
] as const;

// Peso propio orientativo para cantos por ENCIMA del ultimo tramo tabulado
// (> 0,35 m). La Tabla C.5 no cubre forjados tan gruesos como "practica habitual";
// se conserva el ultimo valor (5 kN/m²) como cota conservadora y se deja al usuario
// afinarlo con la ficha tecnica del forjado real.
// TODO VERIFICAR: fuera del rango tabulado por el CTE; 5 kN/m² es una cota
//   orientativa (ultimo tramo), no un valor de norma para canto > 0,35 m.
const PESO_FUERA_DE_RANGO = 5;

// --- Default del corte "forjado unidireccional" -------------------------------

// Peso propio por defecto del pano unidireccional del corte. El corte define su
// forjado por defecto con CANTO 0,30 m e INTEREJE 0,70 m. Segun la Tabla C.5, un
// forjado de grueso total 0,30 m cae en el tramo "grueso total < 0,30 m -> 4 kN/m²"
// (el tramo unidireccional puro "< 0,28 m -> 3" no lo cubre). De ahi el default = 4.
//
// Es un valor EDITABLE: es el peso del forjado COMPLETO (viguetas + bovedillas +
// capa de compresion), no incluye solados, tabiqueria ni sobrecarga de uso (esas
// son cargas muertas / variables aparte). El usuario lo ajusta a su forjado real.
//
// Fuente: CTE DB-SE-AE Tabla C.5 (tramo "Forjado uni o bidireccional; grueso < 0,30 m").
// VERIFICAR contra CTE DB-SE-AE Anejo C Tabla C.5
export const PESO_PROPIO_UNIDIRECCIONAL_DEFAULT = 4;

// Canto por defecto del corte (m). Documentado aqui para trazar de donde sale el
// default de peso: es el `cantoMax` del tramo "< 0,30 m". Sirve tambien de semilla
// a la UI si necesita un canto inicial coherente con el peso por defecto.
export const CANTO_UNIDIRECCIONAL_DEFAULT = 0.3;

// --- Helper de lookup ---------------------------------------------------------

// Devuelve el peso propio ORIENTATIVO (kN/m²) de un forjado unidireccional segun
// su canto total (grueso, en m), tomando el primer tramo de la Tabla C.5 cuyo
// limite cubre el canto. Puro y sin efectos.
//
// Convencion de umbrales: la norma tabula "grueso total < X", asi que un canto de
// EXACTAMENTE 0,28 m NO entra en el tramo "< 0,28" y sube al siguiente ("< 0,30").
// Se usa comparacion estricta `canto < cantoMax` para respetar la letra del CTE.
//
// Cantos no fisicos (<= 0): se devuelve el valor del primer tramo (el mas ligero)
// como cota inferior; no se lanza (el helper es orientativo, no validador). El
// dominio/UI es quien valida que el canto introducido sea positivo y razonable.
//
// Fuera de rango (> 0,35 m): se devuelve `PESO_FUERA_DE_RANGO` (5 kN/m²), cota
// conservadora del ultimo tramo tabulado.
export function pesoPropioOrientativo(canto: number): number {
  for (const tramo of TABLA_UNIDIRECCIONAL) {
    if (canto < tramo.cantoMax) return tramo.pesoPropio;
  }
  return PESO_FUERA_DE_RANGO;
}

// Listado completo de la tabla orientativa (para UI: mostrar la referencia por
// canto junto al campo editable). Devuelve copia para que el consumidor no pueda
// mutar la tabla interna.
export function listarForjadosUnidireccionales(): EntradaForjado[] {
  return TABLA_UNIDIRECCIONAL.map((e) => ({ ...e }));
}

// =============================================================================
// FORJADO RETICULAR / BIDIRECCIONAL (corte F3-reticular, T2.3)
// =============================================================================
//
// El pano `tipo:"reticular"` (losa aligerada bidireccional, emparrillado de
// nervios en dos direcciones) gana el mismo campo `pesoPropio` (kN/m²) editable
// que el unidireccional. Aqui viven su DEFAULT y su tabla orientativa canto->peso,
// ESPEJO del bloque unidireccional (arriba), con la MISMA fuente citada y marca de
// verificacion por fila.
//
// A diferencia del unidireccional, el reticular ES bidireccional, asi que las DOS
// filas de la Tabla C.5 que lo tabulan le aplican LITERALMENTE (no por
// extrapolacion): la fila "uni o bidireccional; grueso < 0,30 -> 4" y la fila
// "bidireccional; grueso < 0,35 -> 5" nombran expresamente al bidireccional. Por
// eso el tramo "< 0,35" NO lleva el `TODO VERIFICAR` de extrapolacion que si lleva
// el unidireccional (para el uni ese tramo era una cota prestada del bidireccional).
//
// Fuente (misma que el bloque unidireccional, VERIFICADA 2026-07-06 contra el PDF
// oficial de codigotecnico.org, edicion "Abril 2009", pag. SE-AE 20):
//   - CTE DB-SE-AE, Anejo C, Tabla C.5, subseccion "Forjados":
//       - Forjado uni o bidireccional; grueso total < 0,30 m ... 4 kN/m²
//       - Forjado bidireccional, grueso total < 0,35 m ......... 5 kN/m²
//
// DEUDA / ORIENTACION (NO tabla de norma): el peso propio real de un reticular
// depende del TIPO DE CASETON (recuperable de plastico/metal vs perdido de
// hormigon/EPS/ceramica) y de la geometria del aligeramiento. Esos pesos son
// ORIENTACION DE FABRICANTE (ficha tecnica), NO norma, y por eso NO se tabulan aqui:
// el default de producto lo fija la Tabla C.5 por CANTO TOTAL (grueso), como en el
// unidireccional. El desglose por tipo de caseton queda como deuda `T-f3-ret-casetones`.
//
// RANGO NORMATIVO (contexto; la VALIDACION de estos rangos NO vive aqui sino en
// validaciones.ts con codigo `PANO_RET_CAMPOS`, F4): Codigo Estructural, Anejo 19
// §5.3.1(6) (VERIFICADO contra PDF oficial MITMA, pag. 805): capa de compresion
// >= 0,05 m (0,04 con caseton perdido); intereje (separacion entre ejes de nervios)
// <= 1,5 m; esbeltez del nervio (canto - capaCompresion)/anchoNervio <= 4. Aqui solo
// se tabula el peso propio orientativo y se fijan los defaults; los rangos son de F4.

// --- Tabla orientativa de forjados RETICULARES/BIDIRECCIONALES (Tabla C.5) -----
//
// Solo los tramos APLICABLES al bidireccional. La Tabla C.5 no da un tramo ligero
// especifico para bidireccional (el "< 0,28 -> 3" es del unidireccional puro), asi
// que la tabla bidireccional arranca en "< 0,30 -> 4". Tramos ordenados por
// `cantoMax` ascendente: el helper toma el PRIMER tramo cuyo limite cubre el canto.
//
// VERIFICAR contra CTE DB-SE-AE Anejo C, Tabla C.5 "Forjados" (vigente).
const TABLA_BIDIRECCIONAL: readonly EntradaForjado[] = [
  // Forjado uni o bidireccional; grueso total < 0,30 m -> 4 kN/m². Cubre el
  // reticular de canto habitual (default del corte, 0,30 m = 25+5). La norma nombra
  // EXPRESAMENTE "bidireccional" en este tramo: aplica al reticular sin extrapolar.
  // Fuente: DB-SE-AE Tabla C.5, subseccion Forjados, fila "Forjado uni o bidireccional".
  // VERIFICAR contra CTE DB-SE-AE Anejo C Tabla C.5
  { cantoMax: 0.3, pesoPropio: 4, descripcion: "Forjado uni o bidireccional; grueso total < 0,30 m" },
  // Forjado bidireccional, grueso total < 0,35 m -> 5 kN/m². La norma nombra
  // EXPRESAMENTE "bidireccional": para el reticular es valor de norma (a diferencia
  // del unidireccional, donde este mismo tramo era una extrapolacion prestada).
  // Fuente: DB-SE-AE Tabla C.5, subseccion Forjados, fila "Forjado bidireccional".
  // VERIFICAR contra CTE DB-SE-AE Anejo C Tabla C.5
  { cantoMax: 0.35, pesoPropio: 5, descripcion: "Forjado bidireccional; grueso total < 0,35 m" },
] as const;

// Peso propio orientativo para cantos por ENCIMA del ultimo tramo tabulado del
// bidireccional (> 0,35 m). La Tabla C.5 no cubre forjados tan gruesos como
// "practica habitual"; se conserva el ultimo valor (5 kN/m²) como cota conservadora
// y se deja al usuario afinarlo con la ficha tecnica del forjado real.
// TODO VERIFICAR: fuera del rango tabulado por el CTE; 5 kN/m² es una cota
//   orientativa (ultimo tramo), no un valor de norma para canto > 0,35 m.
const PESO_FUERA_DE_RANGO_BIDIRECCIONAL = 5;

// --- Defaults del corte "forjado reticular" -----------------------------------
//
// El corte define su reticular por defecto con la geometria del contrato §3
// (coherente con el Codigo Estructural, Anejo 19 §5.3.1(6)):
//   - canto 0,30 m (25+5)  ·  intereje 0,80 m (<= 1,5 m con holgura)
//   - anchoNervio 0,12 m (esbeltez (0,30-0,05)/0,12 = 2,08 <= 4 OK)
//   - capaCompresion 0,05 m (= minimo de norma; 0,04 con caseton perdido)
//
// Como en el unidireccional, el peso por defecto SALE del tramo de la Tabla C.5 que
// cubre el canto por defecto: un reticular de grueso total 0,30 m cae en el tramo
// "grueso total < 0,30 m -> 4 kN/m²". De ahi PESO_PROPIO_RETICULAR_DEFAULT = 4
// (coherencia peso<->canto identica a PESO_PROPIO_UNIDIRECCIONAL_DEFAULT).

// Peso propio por defecto del pano reticular del corte (kN/m²). Es el peso del
// forjado COMPLETO (nervios + casetones + capa de compresion), EDITABLE por el
// usuario; no incluye solados, tabiqueria ni sobrecarga de uso.
// Fuente: CTE DB-SE-AE Tabla C.5 (tramo "Forjado uni o bidireccional; grueso < 0,30 m").
// VERIFICAR contra CTE DB-SE-AE Anejo C Tabla C.5
export const PESO_PROPIO_RETICULAR_DEFAULT = 4;

// Canto total por defecto (m). Documentado aqui para trazar de donde sale el default
// de peso: es el `cantoMax` del tramo "< 0,30 m". Semilla de UI coherente con el peso.
export const CANTO_RETICULAR_DEFAULT = 0.3;

// Intereje (separacion entre ejes de nervios) por defecto (m). Contrato §3: 0,80 m,
// holgado bajo el maximo normativo 1,5 m (Codigo Estructural Anejo 19 §5.3.1(6)).
export const INTEREJE_RETICULAR_DEFAULT = 0.8;

// Ancho del nervio por defecto (m). Contrato §3: 0,12 m; con canto 0,30 y capa 0,05
// da esbeltez (0,30-0,05)/0,12 = 2,08 <= 4 (Codigo Estructural Anejo 19 §5.3.1(6)).
export const ANCHO_NERVIO_RETICULAR_DEFAULT = 0.12;

// Espesor de la capa de compresion por defecto (m). Contrato §3: 0,05 m = minimo de
// norma (0,04 admisible con caseton perdido; el tipo de caseton no es campo del corte).
// Codigo Estructural, Anejo 19 §5.3.1(6).
export const CAPA_COMPRESION_RETICULAR_DEFAULT = 0.05;

// --- Helper de lookup (reticular) ---------------------------------------------

// Devuelve el peso propio ORIENTATIVO (kN/m²) de un forjado reticular/bidireccional
// segun su canto total (grueso, en m), sobre TABLA_BIDIRECCIONAL. Mismo lookup por
// tramo estricto (`canto < cantoMax`) y misma convencion de umbrales que
// `pesoPropioOrientativo`: un canto de EXACTAMENTE 0,30 m NO entra en "< 0,30" y sube
// a "< 0,35". Puro y sin efectos.
//
// Cantos no fisicos (<= 0): se devuelve el valor del primer tramo (el mas ligero, 4);
// no lanza (helper orientativo, no validador). Fuera de rango (> 0,35 m): se devuelve
// `PESO_FUERA_DE_RANGO_BIDIRECCIONAL` (5 kN/m²), cota conservadora del ultimo tramo.
export function pesoPropioOrientativoReticular(canto: number): number {
  for (const tramo of TABLA_BIDIRECCIONAL) {
    if (canto < tramo.cantoMax) return tramo.pesoPropio;
  }
  return PESO_FUERA_DE_RANGO_BIDIRECCIONAL;
}

// Listado completo de la tabla orientativa bidireccional (para UI: mostrar la
// referencia por canto junto al campo editable del reticular). Devuelve copia para
// que el consumidor no pueda mutar la tabla interna.
export function listarForjadosReticulares(): EntradaForjado[] {
  return TABLA_BIDIRECCIONAL.map((e) => ({ ...e }));
}
