// Helper PURO unico de propiedades de barra (A-dry, F2a Fase 1).
//
// Dado un pilar o una viga de obra (Capa 1), resuelve sus propiedades de calculo
// en sistema interno kN-m: seccion (A, Iy, Iz, J) + material (E, rho) + longitud L.
// Es el UNICO lugar que resuelve seccion+material para una barra y la UNICA frontera
// donde ocurre la conversion de borde m->mm hacia la biblioteca parametrica
// (`resolverSeccion`). Lo consumen el peso propio del discretizador (A-core) y, en
// la Fase 2, el centro de masas (`centros.ts`): asi ambos comparten una sola fuente
// de verdad y no divergen en como derivan A/rho/L.
//
// PURO: sin React, sin IO, sin Pyodide. Modulo bajo en la jerarquia de imports
// (depende solo de ../dominio, ../biblioteca, ../unidades, ./geometria,
// ./contratoFEM): `discretizar.ts` importa de aqui, no al reves, para evitar ciclos.

import type { Modelo, Pilar, Viga, Seccion, Planta } from "../dominio";
import { plantaPorId, nudoPorId, seccionPorId } from "../dominio";
import { getMaterial, seccionRectangular, seccionCircular, getSeccion } from "../biblioteca";
import { mToMm } from "../unidades";
import { mapearEjes } from "./geometria";
import type { SeccionFEM } from "./contratoFEM";

// Resuelve las propiedades de calculo (A,Iy,Iz,J) de una seccion de obra. Es el
// UNICO lugar donde ocurre la conversion de borde m->mm: el dominio persiste
// dimensiones en m, pero `seccionRectangular`/`seccionCircular` de la biblioteca
// reciben mm. Se convierte aqui con `mToMm`, justo al cruzar el borde, y en ningun
// otro sitio de la logica. (Antes vivia en discretizar.ts; se eleva a este modulo
// hoja para que A-dry y el discretizador compartan una sola implementacion.)
export function resolverSeccion(seccion: Seccion): SeccionFEM {
  switch (seccion.tipo) {
    case "perfilMetalico": {
      const perfil = getSeccion(seccion.perfilId);
      if (perfil === undefined) {
        // No deberia ocurrir: validaciones (REF_SECCION) ya garantiza que el
        // perfilId existe en el catalogo antes de llegar aqui. Si pasa, es un bug
        // interno, no un error de obra.
        throw new Error(`Perfil de catalogo inexistente: ${seccion.perfilId}`);
      }
      return { name: seccion.id, A: perfil.A, Iy: perfil.Iy, Iz: perfil.Iz, J: perfil.J };
    }
    case "hormigonRectangular": {
      // Borde m->mm: la biblioteca espera mm y convierte a m internamente.
      const e = seccionRectangular(mToMm(seccion.b), mToMm(seccion.h));
      return { name: seccion.id, A: e.A, Iy: e.Iy, Iz: e.Iz, J: e.J };
    }
    case "hormigonCircular": {
      const e = seccionCircular(mToMm(seccion.d));
      return { name: seccion.id, A: e.A, Iy: e.Iy, Iz: e.Iz, J: e.J };
    }
    case "generico":
      // Propiedades directas en m (sistema interno), sin biblioteca ni conversion.
      return { name: seccion.id, A: seccion.A, Iy: seccion.Iy, Iz: seccion.Iz, J: seccion.J };
  }
}

// Propiedades de calculo de UNA barra de obra (pilar o viga), en sistema interno:
//   - A (m²), Iy/Iz/J (m⁴): de la seccion resuelta.
//   - E (kN/m²), rho (kN/m³, peso especifico): del material de catalogo.
//   - L (m): longitud total del elemento (geometrica). Para un pilar pasante es la
//     longitud completa de arranque a cabeza, no la de un tramo (su masa total es
//     A·rho·L). Para una viga, la distancia entre sus dos nudos en su planta.
//
// `rho` es PESO especifico (kN/m³), no masa (el catalogo guarda `peso`). El peso de
// la barra es A·rho·L (kN); para peso propio basta con la carga distribuida w=A·rho
// (kN/m), que PyNite integra sobre L de cada barra.
export interface PropiedadesBarra {
  A: number;
  Iy: number;
  Iz: number;
  J: number;
  rho: number;
  E: number;
  L: number;
}

// Resuelve la seccion+material de un elemento y devuelve sus propiedades + longitud.
// Lanza si la seccion o el material no se resuelven: igual que `resolverSeccion`, es
// un bug interno (las validaciones previas ya garantizan las referencias antes de
// que el discretizador/centros lleguen aqui), no un error de obra.
function propiedadesComunes(
  modelo: Modelo,
  seccionId: string,
  materialId: string,
  L: number,
): PropiedadesBarra {
  const seccion = seccionPorId(modelo, seccionId);
  if (seccion === undefined) {
    throw new Error(`Seccion de obra inexistente tras validar: ${seccionId}`);
  }
  const material = getMaterial(materialId);
  if (material === undefined) {
    throw new Error(`Material inexistente tras validar: ${materialId}`);
  }
  const s = resolverSeccion(seccion);
  return { A: s.A, Iy: s.Iy, Iz: s.Iz, J: s.J, rho: material.peso, E: material.E, L };
}

// Longitud total de un pilar (arranque a cabeza) = |cota cabeza - cota arranque|.
// El pilar es vertical (#18), asi que su longitud es la diferencia de cotas de sus
// plantas inicial y final (en valor absoluto: el dominio no impone cual es mayor).
export function longitudPilar(modelo: Modelo, p: Pilar): number {
  const pi = plantaPorId(modelo, p.plantaInicial) as Planta;
  const pf = plantaPorId(modelo, p.plantaFinal) as Planta;
  return Math.abs(pf.cota - pi.cota);
}

// Longitud de una viga = distancia euclidea entre sus dos nudos, en coordenadas FEM
// globales (misma cota: la viga vive en una sola planta). Se calcula via `mapearEjes`
// para usar exactamente la misma convencion de ejes que el resto del discretizador.
export function longitudViga(modelo: Modelo, v: Viga): number {
  const planta = plantaPorId(modelo, v.plantaId) as Planta;
  const ni = nudoPorId(modelo, v.nudoI)!;
  const nj = nudoPorId(modelo, v.nudoJ)!;
  const [xi, yi, zi] = mapearEjes(ni.x, ni.y, planta.cota);
  const [xj, yj, zj] = mapearEjes(nj.x, nj.y, planta.cota);
  return Math.hypot(xj - xi, yj - yi, zj - zi);
}

export function propiedadesDePilar(modelo: Modelo, p: Pilar): PropiedadesBarra {
  return propiedadesComunes(modelo, p.seccionId, p.materialId, longitudPilar(modelo, p));
}

export function propiedadesDeViga(modelo: Modelo, v: Viga): PropiedadesBarra {
  return propiedadesComunes(modelo, v.seccionId, v.materialId, longitudViga(modelo, v));
}

// ¿El material de una barra aporta masa? `rho` (peso especifico, kN/m³) es la unica
// magnitud que determina si una barra puede vibrar. Se lee SOLO el material (no se
// resuelve la seccion), de modo que es THROW-SAFE: a diferencia de
// `propiedadesDePilar/Viga`, no lanza si la referencia esta rota — devuelve `false`,
// porque sin material valido no hay masa. Lo consume la validacion modal MODAL_SIN_MASA
// para fallar rapido en lenguaje de obra antes de que el motor lance "massless". Vive
// aqui (no en validaciones.ts) para que la lectura de `rho` por barra tenga una sola
// fuente de verdad (A-dry), igual que el resto de propiedades de masa.
export function materialAportaMasa(materialId: string): boolean {
  const material = getMaterial(materialId);
  return material !== undefined && material.peso > 0;
}
