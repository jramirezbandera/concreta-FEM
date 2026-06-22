// Catalogo de materiales de ACERO ESTRUCTURAL (feature-3, T2.1).
//
// Tabla de datos aislada y corregible: cada valor normativo cita su fuente y
// lleva marca de verificacion, de modo que una correccion sea un cambio de un
// dato, no de codigo (CLAUDE.md regla anti-alucinacion).
//
// NORMA APLICABLE: Codigo Estructural (RD 470/2021), que subsume EAE y se alinea
// con el Eurocodigo 3 (EN 1993-1-1). Las propiedades elasticas del acero son
// estables y no dependieron del cambio EHE-08 -> Codigo Estructural.
//
// UNIDADES: el catalogo se almacena en sistema interno kN-m (CLAUDE.md §14).
// E, G y fy estan tabulados en MPa en la norma -> se convierten a kN/m² con
// `mpaToInterno` (borde de unidades), nunca con un factor 1000 a mano. `peso`
// ya esta en kN/m³ (interno), sin conversion.
//
// NOTA F1: en el analisis FEM lineal de F1 el limite elastico `fy` NO entra en el
// calculo (PyNite solo usa E, G y las propiedades de seccion A, Iy, Iz, J). `fy`
// se cataloga aqui para la futura comprobacion resistente (F4); en PyNite es un
// parametro opcional de add_material.

import { mpaToInterno } from "../unidades";
import type { EntradaMaterialAcero } from "./tipos";

// --- Propiedades elasticas comunes a S235/S275/S355 ---------------------------
// Los tres aceros estructurales comparten modulos y peso; solo cambia `fy`.

// Modulo de elasticidad longitudinal del acero.
// Fuente: EC3 EN 1993-1-1 §3.2.6 (E = 210000 MPa).
// VERIFICAR contra Codigo Estructural / EC3 EN 1993-1-1 §3.2.6
const E_MPA = 210000;

// Modulo de cortante (transversal) del acero.
// Fuente: EC3 EN 1993-1-1 §3.2.6 (G = 81000 MPa, coherente con E y nu).
// VERIFICAR contra Codigo Estructural / EC3 EN 1993-1-1 §3.2.6
const G_MPA = 81000;

// Coeficiente de Poisson en regimen elastico (adimensional, sin conversion).
// Fuente: EC3 EN 1993-1-1 §3.2.6 (nu = 0,3).
// VERIFICAR contra Codigo Estructural / EC3 EN 1993-1-1 §3.2.6
const NU_ACERO = 0.3;

// Peso especifico del acero, ya en unidades internas kN/m³ (sin conversion).
// Fuente: Codigo Estructural / EC3 (acero 78,5 kN/m³).
// VERIFICAR contra Codigo Estructural / EC3 EN 1993-1-1 §3.2.6
const PESO_ACERO_KNM3 = 78.5;

// --- Limites elasticos fy por grado (espesor nominal t <= 40 mm) ---------------
// Fuente: EN 10025-2 (productos laminados en caliente), valores recogidos en la
// tabla de limites elasticos del Codigo Estructural / EC3.
// VERIFICAR contra Codigo Estructural / EC3 EN 1993-1-1 §3.2.6 y EN 10025-2
const FY_S235_MPA = 235; // VERIFICAR contra EN 10025-2 (t <= 40 mm)
const FY_S275_MPA = 275; // VERIFICAR contra EN 10025-2 (t <= 40 mm)
const FY_S355_MPA = 355; // VERIFICAR contra EN 10025-2 (t <= 40 mm)

// Constructor interno: aplica la conversion de bordes MPa -> kN/m² una sola vez.
// `id` y `denominacion` coinciden (la denominacion normalizada del grado ya es
// ASCII y legible), pero se mantienen separados por contrato de `EntradaMaterial`.
function aceroEstructural(
  id: string,
  fyMpa: number,
): EntradaMaterialAcero {
  return {
    id,
    denominacion: id,
    tipo: "acero",
    E: mpaToInterno(E_MPA), // MPa -> kN/m² (interno)
    G: mpaToInterno(G_MPA), // MPa -> kN/m² (interno)
    nu: NU_ACERO, // adimensional, sin conversion
    peso: PESO_ACERO_KNM3, // ya en kN/m³ (interno)
    fy: mpaToInterno(fyMpa), // MPa -> kN/m² (interno)
  };
}

// Catalogo de aceros estructurales disponibles en F1.
// `id` estables y referenciables por `materialId` del dominio.
export const ACEROS: EntradaMaterialAcero[] = [
  aceroEstructural("S235", FY_S235_MPA),
  aceroEstructural("S275", FY_S275_MPA),
  aceroEstructural("S355", FY_S355_MPA),
];
