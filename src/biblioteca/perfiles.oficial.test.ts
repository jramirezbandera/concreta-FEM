// AUDITORÍA [C-2]: verificación del catálogo de perfiles contra valores OFICIALES
// INDEPENDIENTES (EN 10365 / prontuarios ArcelorMittal), NO contra los datos crudos
// de la propia tabla (el test previo de biblioteca.test.ts era tautológico: usaba
// cm4ToM4(<dato crudo>) como esperado, así que verificaba la aritmética de la
// conversión pero no el dato físico).
//
// Fuente de los valores esperados:
//  - EN 10365 (geometría) vía prontuario ArcelorMittal / eurocodeapplied /
//    structolution (familia Kraus & Kindmann para It, la MISMA que cita la cabecera
//    de perfiles.ts como su fuente).
//  - La propia I+D del repo: investigacion/verificacion/04-verif-normativa.md:199
//    "IPE 300: A ≈ 53,8 cm², Iy ≈ 8356 cm⁴, Iz ≈ 604 cm⁴, It (J) ≈ 20,1 cm⁴ —
//    VERIFICADO". (La tabla de perfiles.ts almacena 83560/6038/197.5: 10× esos
//    valores; este test lo detecta.)
//
// Los valores se escriben aquí como LITERALES INDEPENDIENTES en cm⁴ (unidad de
// catálogo) y se convierten con los mismos helpers del borde (cm4ToM4/cm2ToM2):
// si la tabla y este test divergen, el bug está en la tabla, no en la fórmula.

import { describe, it, expect } from "vitest";
import { getSeccion } from "./index";
import { cm2ToM2, cm4ToM4 } from "../unidades";

// Tolerancias relativas: A/Iy/Iz son universales entre catálogos (≤0,5 %); It
// depende del modelado de los radios de acuerdo (familia K&K vs Orange Book), se
// admite un 8 % para no acoplarse a una familia concreta — un error 10× lo caza
// de sobra.
const TOL_REL = 0.005;
const TOL_REL_IT = 0.08;

function esperarCerca(real: number, esperado: number, tolRel: number, etiqueta: string) {
  const err = Math.abs(real - esperado) / Math.abs(esperado);
  expect(err, `${etiqueta}: obtenido ${real}, oficial ${esperado} (err rel ${(err * 100).toFixed(1)}%)`).toBeLessThan(tolRel);
}

// [designacion, A_cm2, Iy_cm4 (eje fuerte), Iz_cm4 (eje debil), It_cm4] — OFICIALES.
type PerfilOficial = [string, number, number, number, number];

// Muestra representativa de la serie IPE (extremos + centrales), EN 10365.
const IPE_OFICIAL: PerfilOficial[] = [
  ["IPE80", 7.64, 80.14, 8.489, 0.6727],
  ["IPE160", 20.09, 869.3, 68.31, 3.53],
  ["IPE200", 28.48, 1943, 142.4, 6.846],
  ["IPE300", 53.81, 8356, 603.8, 19.75],
  ["IPE400", 84.46, 23130, 1318, 50.41],
  ["IPE600", 155.98, 92080, 3387, 164.6],
];

// Muestra de la serie HEB (control: esta serie está bien en la tabla), EN 10365.
const HEB_OFICIAL: PerfilOficial[] = [
  ["HEB100", 26.04, 449.5, 167.3, 9.33],
  ["HEB200", 78.08, 5696, 2003, 59.7],
  ["HEB300", 149.08, 25170, 8563, 189.1],
  ["HEB600", 269.96, 171000, 13530, 677.1],
];

describe("catálogo de perfiles vs valores oficiales EN 10365 (auditoría C-2)", () => {
  it.each(IPE_OFICIAL)("%s coincide con el catálogo oficial", (id, A, Iy, Iz, It) => {
    const s = getSeccion(id);
    expect(s, `perfil ${id} existe en el catálogo`).toBeDefined();
    esperarCerca(s!.A, cm2ToM2(A), TOL_REL, `${id}.A`);
    esperarCerca(s!.Iy, cm4ToM4(Iy), TOL_REL, `${id}.Iy`);
    esperarCerca(s!.Iz, cm4ToM4(Iz), TOL_REL, `${id}.Iz`);
    esperarCerca(s!.J, cm4ToM4(It), TOL_REL_IT, `${id}.J(It)`);
  });

  it.each(HEB_OFICIAL)("%s coincide con el catálogo oficial", (id, A, Iy, Iz, It) => {
    const s = getSeccion(id);
    expect(s, `perfil ${id} existe en el catálogo`).toBeDefined();
    esperarCerca(s!.A, cm2ToM2(A), TOL_REL, `${id}.A`);
    esperarCerca(s!.Iy, cm4ToM4(Iy), TOL_REL, `${id}.Iy`);
    esperarCerca(s!.Iz, cm4ToM4(Iz), TOL_REL, `${id}.Iz`);
    esperarCerca(s!.J, cm4ToM4(It), TOL_REL_IT, `${id}.J(It)`);
  });
});
