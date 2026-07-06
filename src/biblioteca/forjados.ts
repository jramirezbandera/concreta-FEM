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
