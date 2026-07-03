// Defaults sensatos y PLANTILLAS de dimensiones de HORMIGON (auditoria UI/UX D3+D4).
//
// PURA: sin React, sin IO. Solo datos y funciones puras (CLAUDE.md). Se testea en
// Node (project `node`), como el resto de la biblioteca.
//
// DECISION DE ARQUITECTURA (condicion del guardian): el hormigon es PARAMETRICO, no
// catalogo (ver `index.ts`: SECCIONES solo lleva perfiles metalicos). Por eso los
// "presets" NO son entradas de catalogo: son PLANTILLAS de dimensiones (b×h o Ø en
// mm) que la UI ofrece como accesos rapidos y que se MATERIALIZAN como secciones DE
// OBRA (`modelo.secciones`, Capa 1) con un id opaco. Nunca se anaden a `SECCIONES`.
//
// UNIDADES (CLAUDE.md §14): las plantillas guardan las dimensiones en MILIMETROS (lo
// que el arquitecto teclea/lee); la conversion mm->m ocurre en el borde `src/unidades`
// al materializar la seccion de obra (el comando `crearSeccion` lo hace). Aqui no se
// convierte: son datos de presentacion/entrada.

// --- Material por defecto -----------------------------------------------------
// Material del MVP = HORMIGON (decision de usuario). El id debe existir en el
// catalogo de hormigones (biblioteca/hormigon.ts): "HA-25" es el primer hormigon
// estructural. Constante testeable (el test verifica que resuelve en getMaterial).
export const DEFAULT_MATERIAL_ID = "HA-25";

// --- Plantillas de dimensiones (mm) ------------------------------------------
// Preset de una seccion rectangular de hormigon: ancho b y canto h en MILIMETROS.
export interface PresetRectangular {
  clase: "rectangular";
  b: number; // mm
  h: number; // mm
  // Etiqueta legible para el acceso rapido (p. ej. "30×30"). El nombre de la
  // seccion de obra ("HA 30×30") lo compone el borde de UI, no la plantilla.
  etiqueta: string;
}

// Preset de una seccion circular de hormigon: diametro d en MILIMETROS.
export interface PresetCircular {
  clase: "circular";
  d: number; // mm
  etiqueta: string; // p. ej. "Ø30"
}

export type PresetHormigon = PresetRectangular | PresetCircular;

// Accesos rapidos de PILAR (dimensiones tipicas de hormigon). El primero (30×30)
// es el default de pilar (ver DEFAULT_SECCION_PILAR). En cm redondos, como los
// maneja el arquitecto: 25, 30, 40; mas dos circulares Ø30/Ø40.
export const PRESETS_PILAR: readonly PresetHormigon[] = [
  { clase: "rectangular", b: 250, h: 250, etiqueta: "25×25" },
  { clase: "rectangular", b: 300, h: 300, etiqueta: "30×30" },
  { clase: "rectangular", b: 400, h: 400, etiqueta: "40×40" },
  { clase: "circular", d: 300, etiqueta: "Ø30" },
  { clase: "circular", d: 400, etiqueta: "Ø40" },
];

// Accesos rapidos de VIGA (cantos tipicos de hormigon). El primero (30×50) es el
// default de viga (ver DEFAULT_SECCION_VIGA). El canto gobierna el eje fuerte (Iy),
// que es el que resiste la flexion vertical (convencion C-1b, ver hormigon.ts).
export const PRESETS_VIGA: readonly PresetHormigon[] = [
  { clase: "rectangular", b: 300, h: 500, etiqueta: "30×50" },
  { clase: "rectangular", b: 400, h: 600, etiqueta: "40×60" },
];

// Union de todos los presets (util para el dialogo, que ofrece todos como accesos
// rapidos al dimensionar una seccion a medida). Rectangulares primero, luego
// circulares (mismo orden que PRESETS_PILAR).
export const PRESETS_HORMIGON: readonly PresetHormigon[] = [
  { clase: "rectangular", b: 250, h: 250, etiqueta: "25×25" },
  { clase: "rectangular", b: 300, h: 300, etiqueta: "30×30" },
  { clase: "rectangular", b: 300, h: 500, etiqueta: "30×50" },
  { clase: "rectangular", b: 400, h: 400, etiqueta: "40×40" },
  { clase: "rectangular", b: 400, h: 600, etiqueta: "40×60" },
  { clase: "circular", d: 300, etiqueta: "Ø30" },
  { clase: "circular", d: 400, etiqueta: "Ø40" },
];

// --- Secciones de obra por defecto -------------------------------------------
// Descriptor de la seccion de obra por defecto de un tipo de elemento: la plantilla
// de dimensiones + el nombre legible con el que se siembra/materializa ("HA 30×30").
// NO lleva id: el id es opaco y se genera en la siembra/creacion (nunca semantico,
// para no ensombrecer el catalogo en resolverSeccionFEMPorId).
export interface DefaultSeccion {
  nombre: string; // p. ej. "HA 30×30"
  preset: PresetRectangular; // los defaults de F1 son rectangulares
}

// Pilar por defecto: HA 30×30 (rectangular 300×300 mm). Primer preset de pilar.
export const DEFAULT_SECCION_PILAR: DefaultSeccion = {
  nombre: "HA 30×30",
  preset: { clase: "rectangular", b: 300, h: 300, etiqueta: "30×30" },
};

// Viga por defecto: HA 30×50 (rectangular 300×500 mm). Primer preset de viga.
export const DEFAULT_SECCION_VIGA: DefaultSeccion = {
  nombre: "HA 30×50",
  preset: { clase: "rectangular", b: 300, h: 500, etiqueta: "30×50" },
};
