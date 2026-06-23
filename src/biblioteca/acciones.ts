// Tabla de datos normativa de ACCIONES: sobrecargas de uso, coeficientes de
// simultaneidad (psi) y coeficientes parciales de seguridad (gamma).
// feature-13 (Cargas, hipotesis y combinaciones), T1.1.
//
// Tabla de datos aislada y corregible, calcada al patron de `hormigon.ts`: cada
// valor cita su fuente (articulo / tabla) y lleva marca de verificacion, de modo
// que una correccion sea un cambio de UN dato, no de codigo (CLAUDE.md, regla
// anti-alucinacion).
//
// NORMA APLICABLE: a diferencia de los materiales (hormigon/acero), que se rigen
// por el Codigo Estructural (RD 470/2021), las ACCIONES y las COMBINACIONES en
// edificacion siguen el CTE, que NO esta derogado:
//   - Sobrecargas de uso (qk): CTE DB-SE-AE (Acciones en la edificacion), Tabla 3.1.
//   - Coef. parciales (gamma): CTE DB-SE (Seguridad Estructural), Tabla 4.1.
//   - Coef. de simultaneidad (psi): CTE DB-SE, Tabla 4.2.
// Estas formulaciones coinciden con EN 1990 (Eurocodigo 0), del que el CTE es
// transposicion.
//
// VALORES RECONFIRMADOS (2026-06-23) contra el texto oficial de los PDF de
// codigotecnico.org:
//   - DB-SE-AE pag. SE-AE 5, Tabla 3.1 (qk).
//   - DB-SE pag. SE-11, Tabla 4.1 (gamma) y Tabla 4.2 (psi).
//
// UNIDADES (CLAUDE.md §14): `qk` se almacena en sistema interno; kN/m² YA es la
// unidad interna de carga superficial, asi que NO hay conversion. `psi` y `gamma`
// son adimensionales. Identificadores ASCII (psi0/psi1/psi2, gamma), etiquetas en
// espanol correcto con tildes.

import type { CategoriaUso } from "../dominio/categoria";

// --- Tipo de la entrada de categoria de uso -----------------------------------

// Una entrada de la tabla por categoria de uso: sobrecarga de uso caracteristica
// (qk) y los tres coeficientes de simultaneidad (psi0 combinacion, psi1 frecuente,
// psi2 casi permanente).
//
// CONSUMIDOR REAL del `qk` (feature-13): el DIALOGO de grupos y plantas
// (`DialogoGruposYPlantas`). Al elegir la categoria de uso de un grupo, asigna
// `grupo.sobrecargaUso = categoriaUso(cat).qk` (override manual permitido despues),
// y el discretizador toma ese `sobrecargaUso` ya resuelto. El `qk` NO se consulta
// dentro del discretizador: la categoria se "cablea" a la sobrecarga en la UI.
// Los `psi` aun NO los usa nadie: son PREPARATORIOS para los combos ELS de F2
// (caracteristica/frecuente/casi permanente). Hoy F1 solo emite ELU/ELS con
// gamma; los psi entraran cuando se modelen esas situaciones.
export interface EntradaCategoriaUso {
  categoria: CategoriaUso; // letra del enum del dominio (A..G)
  descripcion: string; // etiqueta legible para UI (espanol con tildes)
  qk: number; // sobrecarga de uso caracteristica, kN/m² (interno; sin conversion)
  psi0: number; // coef. de combinacion (adimensional)     -> ELU / ELS caracteristica
  psi1: number; // coef. frecuente (adimensional)          -> ELS frecuente
  psi2: number; // coef. casi permanente (adimensional)    -> ELS casi permanente
}

// --- Tabla de categorias de uso (CTE DB-SE-AE Tabla 3.1 + CTE DB-SE Tabla 4.2) -
//
// El enum del dominio (`src/dominio/categoria.ts`) agrupa por LETRA (A..G), sin
// subcategorias A1/A2/C1..C5/D1/D2/G1/G2. Por eso, para cada letra se elige UN
// valor representativo de qk de la Tabla 3.1 y se DOCUMENTA la eleccion. Los psi
// de la Tabla 4.2 ya van por letra en el propio CTE (no por subcategoria), asi que
// se trasladan directos.
//
// VERIFICAR contra CTE DB-SE-AE Tabla 3.1 (qk) y CTE DB-SE Tabla 4.2 (psi) vigentes.
const TABLA_CATEGORIAS: Record<CategoriaUso, EntradaCategoriaUso> = {
  // A - Zonas residenciales. qk representativo = A1 "Viviendas y zonas de
  // habitaciones" = 2 kN/m² (el caso habitual; A2 "Trasteros" seria 3). psi de la
  // fila "Zonas residenciales (Categoria A)".
  // Fuente: DB-SE-AE Tabla 3.1 (A1 -> 2 kN/m²); DB-SE Tabla 4.2 (Cat. A 0,7/0,5/0,3).
  // VERIFICAR contra CTE DB-SE-AE Tabla 3.1 / DB-SE Tabla 4.2
  A: {
    categoria: "A",
    descripcion: "Zonas residenciales (viviendas)",
    qk: 2, // A1 viviendas (representativo de A); A2 trasteros seria 3 kN/m²
    psi0: 0.7,
    psi1: 0.5,
    psi2: 0.3,
  },
  // B - Zonas administrativas (oficinas). Sin subcategorias; qk = 2 kN/m². psi de
  // la fila "Zonas administrativas (Categoria B)": coinciden con A (0,7/0,5/0,3),
  // NO con C (ojo, error frecuente).
  // Fuente: DB-SE-AE Tabla 3.1 (B -> 2 kN/m²); DB-SE Tabla 4.2 (Cat. B 0,7/0,5/0,3).
  // VERIFICAR contra CTE DB-SE-AE Tabla 3.1 / DB-SE Tabla 4.2
  B: {
    categoria: "B",
    descripcion: "Zonas administrativas (oficinas)",
    qk: 2,
    psi0: 0.7,
    psi1: 0.5,
    psi2: 0.3,
  },
  // C - Zonas de acceso al publico. qk representativo = 5 kN/m² (C3/C4/C5, el caso
  // mas desfavorable y mas comun en publica; C1 seria 3, C2 seria 4). psi de la
  // fila "Zonas destinadas al publico (Categoria C)".
  // Fuente: DB-SE-AE Tabla 3.1 (C3/C4/C5 -> 5 kN/m²); DB-SE Tabla 4.2 (Cat. C 0,7/0,7/0,6).
  // VERIFICAR contra CTE DB-SE-AE Tabla 3.1 / DB-SE Tabla 4.2
  C: {
    categoria: "C",
    descripcion: "Zonas de acceso al publico",
    qk: 5, // C3/C4/C5 (representativo desfavorable de C); C1=3, C2=4 kN/m²
    psi0: 0.7,
    psi1: 0.7,
    psi2: 0.6,
  },
  // D - Zonas comerciales. qk = 5 kN/m² (D1 locales y D2 grandes superficies
  // comparten 5). psi de la fila "Zonas comerciales (Categoria D)".
  // Fuente: DB-SE-AE Tabla 3.1 (D1/D2 -> 5 kN/m²); DB-SE Tabla 4.2 (Cat. D 0,7/0,7/0,6).
  // VERIFICAR contra CTE DB-SE-AE Tabla 3.1 / DB-SE Tabla 4.2
  D: {
    categoria: "D",
    descripcion: "Zonas comerciales",
    qk: 5,
    psi0: 0.7,
    psi1: 0.7,
    psi2: 0.6,
  },
  // E - Trafico y aparcamiento de vehiculos ligeros (peso total < 30 kN). Sin
  // subcategorias; qk = 2 kN/m². psi de la fila "...(Categoria E)".
  // Fuente: DB-SE-AE Tabla 3.1 (E -> 2 kN/m²); DB-SE Tabla 4.2 (Cat. E 0,7/0,7/0,6).
  // VERIFICAR contra CTE DB-SE-AE Tabla 3.1 / DB-SE Tabla 4.2
  E: {
    categoria: "E",
    descripcion: "Trafico y aparcamiento de vehiculos ligeros (< 30 kN)",
    qk: 2,
    psi0: 0.7,
    psi1: 0.7,
    psi2: 0.6,
  },
  // F - Cubiertas transitables accesibles solo privadamente. qk = 1 kN/m².
  // ATENCION psi: el DB-SE Tabla 4.2 NO da psi propios para F; nota (1): "se
  // adoptaran los valores correspondientes al uso desde el que se accede". Como el
  // dominio agrupa por letra sin conocer el uso de acceso, se adoptan provisional-
  // mente los de residencial A (0,7/0,5/0,3) como caso por defecto. El usuario debe
  // ajustarlos al uso real de acceso al cubrir un grupo de categoria F.
  // Fuente: DB-SE-AE Tabla 3.1 (F -> 1 kN/m²); DB-SE Tabla 4.2 nota (1).
  // TODO VERIFICAR: psi de F dependen del uso de acceso (DB-SE Tabla 4.2 nota (1)),
  //   no tabulados por norma; aqui se usa el de residencial A como CANDIDATO.
  // VERIFICAR contra CTE DB-SE-AE Tabla 3.1 / DB-SE Tabla 4.2 nota (1)
  F: {
    categoria: "F",
    descripcion: "Cubiertas transitables (acceso privado)",
    qk: 1,
    psi0: 0.7, // TODO VERIFICAR: hereda del uso de acceso; candidato = residencial A
    psi1: 0.5, // TODO VERIFICAR
    psi2: 0.3, // TODO VERIFICAR
  },
  // G - Cubiertas accesibles unicamente para conservacion. qk representativo = 1
  // kN/m² (G1 cubierta con inclinacion < 20°; cubierta ligera sobre correas seria
  // 0,4; G2 con inclinacion > 40° seria 0).
  // ATENCION psi: el DB-SE Tabla 4.2 deja la fila de Categoria G EN BLANCO. La nota
  // de la I+D indica que G "no es concomitante con otras variables". Modelado como
  // psi = 0 (la sobrecarga de cubierta de conservacion no se combina como
  // concomitante con otra variable dominante).
  // Fuente: DB-SE-AE Tabla 3.1 (G1 < 20° -> 1 kN/m²); DB-SE Tabla 4.2 (Cat. G en blanco).
  // TODO VERIFICAR: psi de G no tabulados (fila en blanco en DB-SE Tabla 4.2); se
  //   adopta 0 por "no concomitancia". Confirmar tratamiento exacto en el CTE vigente.
  // VERIFICAR contra CTE DB-SE-AE Tabla 3.1 / DB-SE Tabla 4.2
  G: {
    categoria: "G",
    descripcion: "Cubiertas accesibles solo para conservacion",
    qk: 1, // G1 incl. < 20° (representativo de G); ligera = 0,4; G2 incl. > 40° = 0
    psi0: 0, // TODO VERIFICAR: G en blanco en Tabla 4.2; 0 por no concomitancia
    psi1: 0, // TODO VERIFICAR
    psi2: 0, // TODO VERIFICAR
  },
};

// --- Coeficientes parciales de seguridad gamma (CTE DB-SE Tabla 4.1) -----------
//
// Situacion persistente o transitoria, verificacion de RESISTENCIA (la pertinente
// para los esfuerzos de portico en F1; la verificacion de Estabilidad usa otros
// valores 1,10/0,90, fuera de alcance de F1). Adimensionales, sin conversion.
//
// Fuente: CTE DB-SE Tabla 4.1, fila "Resistencia / Permanente (peso propio)" y
// "Resistencia / Variable" (RECONFIRMADA contra PDF oficial pag. SE-11).

// Permanente desfavorable (peso propio, cargas muertas que suman esfuerzo).
// VERIFICAR contra CTE DB-SE Tabla 4.1 (Resistencia, permanente desfavorable)
export const GAMMA_G_DESFAV = 1.35;

// Permanente favorable (peso propio que alivia; vuelco, levantamiento, voladizos).
// VERIFICAR contra CTE DB-SE Tabla 4.1 (Resistencia, permanente favorable)
export const GAMMA_G_FAV = 0.8;

// Variable desfavorable (sobrecarga / viento / nieve que suma esfuerzo).
// VERIFICAR contra CTE DB-SE Tabla 4.1 (Resistencia, variable desfavorable)
export const GAMMA_Q_DESFAV = 1.5;

// Variable favorable: la accion variable favorable NO se considera (coef. 0).
// VERIFICAR contra CTE DB-SE Tabla 4.1 (Resistencia, variable favorable)
export const GAMMA_Q_FAV = 0;

// Estado limite de servicio (ELS): todos los coeficientes parciales valen 1,00
// (caracteristica / frecuente / casi permanente; la modulacion la dan los psi).
// Fuente: CTE DB-SE §4.3.2, expresiones 4.6/4.7/4.8 (sin gamma, equivalente a 1,00).
// VERIFICAR contra CTE DB-SE §4.3.2 (ec. 4.6/4.7/4.8)
export const GAMMA_ELS = 1.0;

// --- Helper de lookup ---------------------------------------------------------

// Devuelve la entrada normativa (qk + psi) de una categoria de uso. La categoria
// es un enum cerrado del dominio, asi que SIEMPRE existe en la tabla (no devuelve
// undefined): el compilador garantiza la exhaustividad de `TABLA_CATEGORIAS`.
// El consumidor del `qk` es el dialogo de grupos (ver cabecera de EntradaCategoriaUso).
export function categoriaUso(cat: CategoriaUso): EntradaCategoriaUso {
  return TABLA_CATEGORIAS[cat];
}

// Listado completo (para UI: selector de categoria con qk por defecto).
// Devuelve copia para que el consumidor no pueda mutar la tabla interna.
export function listarCategoriasUso(): EntradaCategoriaUso[] {
  return Object.values(TABLA_CATEGORIAS).map((e) => ({ ...e }));
}
