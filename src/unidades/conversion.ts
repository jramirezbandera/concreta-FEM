/*
 * Conversion de unidades en los BORDES (CLAUDE.md §14).
 *
 * Sistema interno unico: kN, m (y derivados: kN/m, kN/m², kN·m, kN/m²=presion).
 * La UI introduce/presenta en otras unidades (mm para secciones, MPa para E);
 * la conversion ocurre SOLO aqui, nunca en mitad de la logica de dominio/calculo.
 *
 * Todas las funciones son PURAS y nombran origen→destino de forma explicita.
 */

// --- Longitud: secciones en mm (UI) <-> m (interno) ---
export const mmToM = (mm: number): number => mm / 1000;
export const mToMm = (m: number): number => m * 1000;

// --- Modulo elastico y tensiones: MPa (N/mm²) (UI) <-> kN/m² (interno) ---
// Cadena: 1 N/mm² = 1e6 N/m² = 1e3 kN/m²  ⟹  1 MPa = 1000 kN/m².
export const mpaToInterno = (mpa: number): number => mpa * 1000;
export const internoToMpa = (kNm2: number): number => kNm2 / 1000;

// --- Area e inercia de catalogo: cm (catalogos de perfiles) -> m (interno) ---
// Los catalogos de perfiles laminados (EN 10365, etc.) tabulan A en cm² e I/J en
// cm⁴; se convierten al sistema interno en el borde de esa tabla (perfiles.ts).
// Cadena: 1 cm = 1e-2 m  ⟹  1 cm² = 1e-4 m² ;  1 cm⁴ = (1e-2)^4 m⁴ = 1e-8 m⁴.
export const cm2ToM2 = (cm2: number): number => cm2 * 1e-4;
export const cm4ToM4 = (cm4: number): number => cm4 * 1e-8;

/*
 * Magnitudes que YA estan en el sistema interno (identidad, sin conversion):
 *   - Fuerzas:        kN
 *   - Momentos:       kN·m
 *   - Cargas lineales: kN/m
 *   - Cargas superf.:  kN/m²
 * Se documentan aqui para dejar claro que NO requieren transformacion en los bordes.
 */
