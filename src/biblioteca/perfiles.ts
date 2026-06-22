// Catalogo de PERFILES METALICOS LAMINADOS (feature-3, T2.3): series IPE e HEB.
//
// Tabla de datos aislada y corregible: cada serie cita su fuente y lleva marca de
// verificacion, de modo que una correccion sea un cambio de un DATO, no de codigo
// (CLAUDE.md regla anti-alucinacion). Los numeros crudos se guardan en unidades de
// CATALOGO (cm², cm⁴) tal como aparecen en EN 10365 / eurocodeapplied / ArcelorMittal,
// y se convierten a unidades internas (m², m⁴) programaticamente al construir cada
// `EntradaSeccion`. Asi se evita cablear a mano numeros ya convertidos (fuente de
// errores silenciosos) y la tabla queda cotejable 1:1 contra el catalogo de origen.
//
// J = It: CRITICO. `J` es la CONSTANTE DE TORSION DE ST. VENANT (It) tabulada en el
// catalogo de perfiles, NUNCA el momento polar Ip. Para un perfil abierto en I,
// It << Ip = Iy + Iz (un orden de magnitud menor); confundirlos falsea la rigidez
// torsional. Por eso se toma It directamente de la tabla, no se calcula como Iy+Iz.
//
// UNIDADES: el catalogo de la biblioteca se almacena en sistema interno kN-m
// (CLAUDE.md §14, ver tipos.ts): A en m², Iy/Iz/J en m⁴. La conversion cm->m ocurre
// en el BORDE de esta tabla con `cm2ToM2`/`cm4ToM4`, helpers centralizados en
// `src/unidades` (T3.2: TODA conversion de borde vive en un unico modulo).

import { cm2ToM2, cm4ToM4 } from "../unidades";
import type { EntradaSeccion } from "./tipos";

// --- Datos crudos de cada perfil (unidades de CATALOGO: cm², cm⁴) -------------
// Tupla [designacion, A_cm2, Iy_cm4, Iz_cm4, It_cm4]. `designacion` (p.ej. "IPE 200")
// genera tanto el `id` ASCII (sin espacio: "IPE200") como el `nombre` de UI.
type PerfilCrudo = [
  designacion: string,
  A_cm2: number,
  Iy_cm4: number,
  Iz_cm4: number,
  It_cm4: number, // J = constante de torsion de St.Venant (NO momento polar)
];

// IPE (perfiles I de alas estrechas y paralelas).
// Fuente: EN 10365 (T1.2), eurocodeapplied/ArcelorMittal.
// VERIFICAR It (J) contra EN 10365
const IPE_CRUDO: PerfilCrudo[] = [
  ["IPE 80", 7.64, 801.4, 84.89, 6.727],
  ["IPE 100", 10.32, 1710, 159.2, 11.53],
  ["IPE 120", 13.21, 3178, 276.7, 16.89],
  ["IPE 140", 16.43, 5412, 449.2, 24.01],
  ["IPE 160", 20.09, 8693, 683.1, 35.3],
  ["IPE 180", 23.95, 13170, 1009, 47.23],
  ["IPE 200", 28.48, 19430, 1424, 68.46],
  ["IPE 220", 33.37, 27720, 2049, 89.82],
  ["IPE 240", 39.12, 38920, 2836, 127.4],
  ["IPE 270", 45.95, 57900, 4199, 157.1],
  ["IPE 300", 53.81, 83560, 6038, 197.5],
  ["IPE 330", 62.61, 117700, 7881, 275.9],
  ["IPE 360", 72.73, 162700, 10430, 370.8],
  ["IPE 400", 84.46, 231300, 13180, 504.1],
  ["IPE 450", 98.82, 337400, 16760, 660.5],
  ["IPE 500", 115.52, 482000, 21420, 886.2],
  ["IPE 550", 134.42, 671200, 26680, 1217],
  ["IPE 600", 155.98, 920800, 33870, 1646],
];

// HEB (serie europea de alas anchas, variante B).
// Fuente A/Iy/Iz: EN 10365 (T1.2), confirmados por doble fuente (eurocodeapplied/ArcelorMittal).
// Fuente It (J): VERIFICADO contra EN 10365 (geometria) + constante de torsion de
//   St.Venant de Kraus & Kindmann (calculo FE con radios de acuerdo), tal como tabula
//   structolution.com/steel-beam-properties/hot_rolled/heb/<n> (precision ~4 cifras,
//   dada en mm⁴; aqui en cm⁴ = mm⁴/1e4). Se eligio ESTA familia (misma de
//   eurocodeapplied) por coherencia con la serie IPE, que coincide 1:1 con ella.
//   Los It previos (ArcelorMittal Orange Book, 3 cifras) eran sistematicamente algo
//   menores (modelo de acuerdo distinto); cerrada la ultima cifra contra EN 10365.
const HEB_CRUDO: PerfilCrudo[] = [
  ["HEB 100", 26.04, 449.5, 167.3, 9.33],
  ["HEB 120", 34.01, 864.4, 317.5, 13.93],
  ["HEB 140", 42.96, 1509, 549.7, 20.15],
  ["HEB 160", 54.25, 2492, 889.2, 31.27],
  ["HEB 180", 65.25, 3831, 1363, 42.21],
  ["HEB 200", 78.08, 5696, 2003, 59.7],
  ["HEB 220", 91.04, 8091, 2843, 77.02],
  ["HEB 240", 105.99, 11260, 3923, 103.8],
  ["HEB 260", 118.44, 14920, 5135, 126.6],
  ["HEB 280", 131.36, 19270, 6595, 146.0],
  ["HEB 300", 149.08, 25170, 8563, 189.1],
  ["HEB 320", 161.34, 30820, 9239, 230.4],
  ["HEB 340", 170.9, 36660, 9690, 262.8],
  ["HEB 360", 180.63, 43190, 10140, 298.3],
  ["HEB 400", 197.78, 57680, 10820, 361.0],
  ["HEB 450", 217.98, 79890, 11720, 447.9],
  ["HEB 500", 238.64, 107200, 12620, 548.1],
  ["HEB 550", 254.06, 136700, 13080, 610.1],
  ["HEB 600", 269.96, 171000, 13530, 677.1],
];

// --- Generador: PerfilCrudo (cm) -> EntradaSeccion (m, interno) ---------------
// Funcion PURA. Estructura ampliable: para anadir HEA/HEM/UPN/L/tubos en el futuro
// basta declarar otra tabla `*_CRUDO` y mapearla con este mismo generador, sin
// refactor. `id` es la designacion sin espacios (ASCII estable, referenciable por
// `seccionId` del dominio); `nombre` conserva el espacio para la UI.
function perfilMetalico(crudo: PerfilCrudo): EntradaSeccion {
  const [designacion, A_cm2, Iy_cm4, Iz_cm4, It_cm4] = crudo;
  return {
    id: designacion.replace(/\s+/g, ""), // "IPE 200" -> "IPE200"
    nombre: designacion, // "IPE 200" (etiqueta UI)
    tipo: "perfilMetalico",
    A: cm2ToM2(A_cm2), // cm² -> m² (interno)
    Iy: cm4ToM4(Iy_cm4), // cm⁴ -> m⁴ (interno)
    Iz: cm4ToM4(Iz_cm4), // cm⁴ -> m⁴ (interno)
    J: cm4ToM4(It_cm4), // It (constante de torsion) cm⁴ -> m⁴ (interno), NO polar
  };
}

// Series ya convertidas a unidades internas, exportadas por separado por si la UI
// quiere agruparlas; `PERFILES` es la union usada por la biblioteca.
export const IPE: EntradaSeccion[] = IPE_CRUDO.map(perfilMetalico);
export const HEB: EntradaSeccion[] = HEB_CRUDO.map(perfilMetalico);

// Catalogo completo de perfiles metalicos disponibles en F1 (IPE + HEB).
export const PERFILES: EntradaSeccion[] = [...IPE, ...HEB];
