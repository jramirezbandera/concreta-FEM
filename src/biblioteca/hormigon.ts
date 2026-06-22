// Catalogo de materiales de HORMIGON y secciones parametricas (feature-3, T2.2).
//
// Tabla de datos aislada y corregible: cada valor/formula normativa cita su
// fuente y lleva marca de verificacion, de modo que una correccion sea un
// cambio de un dato, no de codigo (CLAUDE.md regla anti-alucinacion).
//
// NORMA APLICABLE: Codigo Estructural (RD 470/2021), alineado con el
// Eurocodigo 2 (EN 1992-1-1). La EHE-08 esta DEROGADA: NO se usa su formula de
// modulo `Ecm = 8500·fcm^(1/3)`. El cambio es por derogacion, no por error de
// formula de la I+D (ver spec/feature-3 y memoria normativa-codigo-estructural).
//
// NOMENCLATURA: solo espanola HA-25 / HA-30 / HA-35 (decision cerrada en T2.2),
// no la designacion EC2 C25/30.
//
// UNIDADES: el catalogo se almacena en sistema interno kN-m (CLAUDE.md §14).
//   - fck, Ecm, E, G estan tabulados/derivados en MPa por norma -> se convierten
//     a kN/m² con `mpaToInterno` (borde de unidades), nunca con un factor a mano.
//   - `peso` ya esta en kN/m³ (interno), sin conversion.
//   - Secciones parametricas: la UI introduce b/h/d en mm; cada funcion convierte
//     a m con `mmToM` ANTES de calcular A (m²), I (m⁴), J (m⁴).
//
// NOTA F1: el analisis FEM lineal solo usa E, G y las propiedades de seccion
// (A, Iy, Iz, J). `fck`/`Ecm` se catalogan para trazabilidad normativa y para la
// futura comprobacion resistente (F4). No hay armado ni comprobacion en F1.

import { mmToM, mpaToInterno } from "../unidades";
import type { EntradaMaterialHormigon, EntradaSeccion } from "./tipos";

// --- Propiedades comunes del hormigon -----------------------------------------

// Coeficiente de Poisson del hormigon sin fisurar (adimensional, sin conversion).
// Fuente: Codigo Estructural / EC2 EN 1992-1-1 §3.1.3 (nu = 0,2 para hormigon
// no fisurado; 0 si se considera fisurado, no es el caso del analisis elastico F1).
// VERIFICAR contra Codigo Estructural / EC2 EN 1992-1-1 §3.1.3
const NU_HORMIGON = 0.2;

// Peso especifico del hormigon (armado), ya en unidades internas kN/m³.
// Fuente: Codigo Estructural / EC1 (hormigon armado 25 kN/m³).
// VERIFICAR contra Codigo Estructural / EC1 EN 1991-1-1 Anejo A
const PESO_HORMIGON_KNM3 = 25;

// --- Derivacion del modulo secante Ecm ----------------------------------------

// Modulo secante de elasticidad del hormigon segun Codigo Estructural / EC2.
// Formula:  Ecm = 22000·(fcm/10)^0,3   [MPa]
// con la resistencia media a compresion  fcm = fck + 8       [MPa].
//
// IMPORTANTE: NO es la formula EHE-08 derogada `Ecm = 8500·fcm^(1/3)`.
//
// Fuente (VERIFICADA contra el PDF oficial MITMA del Codigo Estructural):
//   Anejo 19, apartado 3.1.3 "Deformacion elastica", Tabla A19.3.1
//   "Caracteristicas de resistencia y deformacion del hormigon".
//   Texto literal de la tabla: `Ecm = 22·[(fcm)/10]^0,3` con Ecm en 10³·N/mm²
//   (=> 22000 en N/mm²) y `fcm = fck + 8 (N/mm²)`.
//   Equivalente en EC2 EN 1992-1-1 §3.1.3 Tabla 3.1.
//
// Entrada/salida en MPa (es una formula normativa expresada en MPa). La conversion
// a unidades internas ocurre fuera, en el constructor, con `mpaToInterno`.
// Comprobacion informativa: fck25 -> ≈31476, fck30 -> ≈32837, fck35 -> ≈34077 MPa.
export function derivarEcm(fckMPa: number): number {
  const fcmMPa = fckMPa + 8; // resistencia media (Codigo Estructural / EC2)
  return 22000 * Math.pow(fcmMPa / 10, 0.3); // MPa
}

// --- Catalogo de hormigones HA-xx ---------------------------------------------

// Resistencias caracteristicas a compresion (cilindrica) por tipo, en MPa.
// Fuente: Codigo Estructural / EC2 (serie de hormigones estructurales).
// VERIFICAR contra Codigo Estructural Anejo 19 / EC2 EN 1992-1-1 Tabla 3.1
const FCK_HA25_MPA = 25; // VERIFICAR contra Codigo Estructural (HA-25)
const FCK_HA30_MPA = 30; // VERIFICAR contra Codigo Estructural (HA-30)
const FCK_HA35_MPA = 35; // VERIFICAR contra Codigo Estructural (HA-35)

// Constructor interno: deriva Ecm con la formula normativa (en MPa), deriva G y
// aplica la conversion de bordes MPa -> kN/m² una sola vez. `id` y `denominacion`
// coinciden (la designacion HA-xx ya es ASCII y legible para UI), pero se mantienen
// separados por contrato de `EntradaMaterial`.
function hormigonEstructural(
  id: string,
  fckMpa: number,
): EntradaMaterialHormigon {
  const ecmMpa = derivarEcm(fckMpa);
  // Modulo de cortante derivado de la elasticidad isotropa: G = E/(2(1+nu)).
  // Se calcula en MPa (mismas unidades que Ecm) y se convierte despues.
  // Fuente: relacion elastica isotropa (no es un dato tabulado, es derivado).
  const gMpa = ecmMpa / (2 * (1 + NU_HORMIGON));
  return {
    id,
    denominacion: id,
    tipo: "hormigon",
    E: mpaToInterno(ecmMpa), // Ecm como modulo elastico del FEM; MPa -> kN/m²
    G: mpaToInterno(gMpa), // MPa -> kN/m² (interno)
    nu: NU_HORMIGON, // adimensional, sin conversion
    peso: PESO_HORMIGON_KNM3, // ya en kN/m³ (interno)
    fck: mpaToInterno(fckMpa), // MPa -> kN/m² (interno)
    Ecm: mpaToInterno(ecmMpa), // MPa -> kN/m² (interno)
  };
}

// Catalogo de hormigones estructurales disponibles en F1.
// `id` estables y referenciables por `materialId` del dominio.
export const HORMIGONES: EntradaMaterialHormigon[] = [
  hormigonEstructural("HA-25", FCK_HA25_MPA),
  hormigonEstructural("HA-30", FCK_HA30_MPA),
  hormigonEstructural("HA-35", FCK_HA35_MPA),
];

// --- Secciones parametricas de hormigon ---------------------------------------
//
// Estas funciones son geometria pura (no normativa): A, Iy, Iz e J por formula
// cerrada. NO se tabulan en un catalogo fijo porque sus dimensiones las elige el
// usuario; el dominio guardara las dimensiones y estas funciones derivan la
// EntradaSeccion equivalente para el discretizador.
//
// CONVENCION DE EJES (coherente con add_section de PyNite):
//   - eje local y: horizontal de la seccion (asociado a `b` en rectangular).
//   - eje local z: vertical de la seccion   (asociado a `h` en rectangular).
//   Iy = inercia respecto al eje y;  Iz = inercia respecto al eje z.
//
// UNIDADES DE LOS PARAMETROS: milimetros (mm), tal como los introduce la UI.
// Cada funcion convierte a metros con `mmToM` ANTES de operar, devolviendo
// A en m², Iy/Iz/J en m⁴ (sistema interno). No se usan factores a mano.

// Seccion rectangular de ancho `b` y canto `h` (ambos en mm).
//   A  = b·h
//   Iy = b·h³/12   (flexion respecto al eje y; el canto h gobierna)
//   Iz = h·b³/12   (flexion respecto al eje z; el ancho b gobierna)
//   J  = 0         (ver nota torsion abajo)
export function seccionRectangular(b: number, h: number): EntradaSeccion {
  const bM = mmToM(b); // mm (UI) -> m (interno)
  const hM = mmToM(h); // mm (UI) -> m (interno)
  return {
    id: `HR-${b}x${h}`,
    nombre: `${b}x${h}`,
    tipo: "hormigonRectangular",
    A: bM * hM,
    Iy: (bM * Math.pow(hM, 3)) / 12,
    Iz: (hM * Math.pow(bM, 3)) / 12,
    // J = constante de torsion de St. Venant. Para seccion rectangular maciza NO
    // existe formula cerrada elemental (es una serie / coeficiente β=β(h/b)) y
    // NUNCA es el momento polar Ix+Iy. F1 es flexion pura sin comprobacion de
    // torsion, por lo que se deja J=0 (no introduce rigidez torsional espuria).
    // Se documenta como decision F1; ampliable con β tabulado en una fase futura.
    J: 0,
  };
}

// Seccion circular maciza de diametro `d` (en mm).
//   r  = d/2
//   A  = π·r²
//   Iy = Iz = π·r⁴/4
//   J  = π·r⁴/2   (momento polar; valido como constante de torsion SOLO en
//                  seccion circular maciza, donde St. Venant coincide con el polar)
export function seccionCircular(d: number): EntradaSeccion {
  const dM = mmToM(d); // mm (UI) -> m (interno)
  const rM = dM / 2;
  const r4 = Math.pow(rM, 4);
  const inercia = (Math.PI * r4) / 4; // Iy = Iz para seccion circular
  return {
    id: `HC-${d}`,
    nombre: `D${d}`,
    tipo: "hormigonCircular",
    A: Math.PI * Math.pow(rM, 2),
    Iy: inercia,
    Iz: inercia,
    // Excepcion a la regla "J nunca es momento polar": en el CIRCULO MACIZO la
    // constante de torsion de St. Venant SI coincide con el momento polar
    // J = π·r⁴/2 = Iy + Iz. Es correcto y es el unico caso donde aplica. En
    // perfiles metalicos (perfiles.ts) J va tabulada / por β, jamas como polar.
    J: (Math.PI * r4) / 2,
  };
}
