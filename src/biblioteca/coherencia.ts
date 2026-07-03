// Coherencia seccion <-> material (auditoria UI/UX D15).
//
// PURA: sin React, sin IO. Solo lectura del catalogo y de la seccion de obra. Se
// testea en Node (project `node`).
//
// PROBLEMA: nada impide asignar a una barra una seccion de PERFIL METALICO (IPE/HEB)
// con un material de HORMIGON (HA-25), o una seccion de HORMIGON (hormigonRectangular/
// Circular) con un material de ACERO (S275). El calculo no falla (usa E y A/I sin
// mirar la "familia"), pero el resultado es fisicamente incoherente. La UI muestra un
// aviso NO bloqueante; este helper es la fuente de verdad de "esa combinacion chirria".
//
// No es un error de validacion (no bloquea el calculo): es una ADVERTENCIA de sentido
// comun. Por eso vive aqui (biblioteca, dato/logica pura) y la UI la pinta con
// `--warning` + role=status, no como error de campo.

import { getMaterial, getSeccion } from "./index";
import type { Seccion } from "../dominio/seccion";

// Familia mecanica de una seccion: "acero" (perfil metalico laminado) u "hormigon"
// (seccion parametrica rectangular/circular). Las secciones `generico` no tienen
// familia declarada (propiedades directas, sin material implicito), asi que no
// participan del aviso -> undefined.
type FamiliaSeccion = "acero" | "hormigon" | undefined;

// Familia mecanica de un material del catalogo, o undefined si el id no resuelve.
type FamiliaMaterial = "acero" | "hormigon" | undefined;

// Deriva la familia de una seccion de OBRA (Capa 1). El perfil metalico es de la
// familia acero; el hormigon rectangular/circular, de la de hormigon; el generico no
// declara familia (no dispara aviso).
function familiaDeSeccion(seccion: Seccion): FamiliaSeccion {
  switch (seccion.tipo) {
    case "perfilMetalico":
      return "acero";
    case "hormigonRectangular":
    case "hormigonCircular":
      return "hormigon";
    case "generico":
      return undefined;
  }
}

// Deriva la familia de un material por su id de catalogo. `EntradaMaterial` es una
// union discriminada por `tipo` ("acero" | "hormigon"): la familia ES ese `tipo`.
// undefined si el id no resuelve (material inexistente): sin material no hay aviso.
function familiaDeMaterialId(materialId: string): FamiliaMaterial {
  const material = getMaterial(materialId);
  if (material === undefined) return undefined;
  return material.tipo; // "acero" | "hormigon"
}

// Resuelve una seccion aceptando las DOS fuentes (igual que resolverSeccionFEMPorId):
// una seccion de OBRA (por su objeto) o un id que apunte a un PERFIL del catalogo.
// Devuelve la familia, o undefined si no se puede determinar.
function familiaDeSeccionId(
  seccionId: string,
  seccionesObra: readonly Seccion[],
): FamiliaSeccion {
  const obra = seccionesObra.find((s) => s.id === seccionId);
  if (obra !== undefined) return familiaDeSeccion(obra);
  // Perfil de catalogo referenciado directamente por id (IPE/HEB): familia acero.
  if (getSeccion(seccionId) !== undefined) return "acero";
  return undefined;
}

// Resultado del chequeo: si es incoherente, con las familias implicadas (para que la
// UI redacte el aviso en la direccion correcta).
export interface ResultadoCoherencia {
  incoherente: boolean;
  familiaSeccion: FamiliaSeccion;
  familiaMaterial: FamiliaMaterial;
}

// ¿La combinacion seccion (de obra) + material (por id) es incoherente? Lo es cuando
// AMBAS familias estan definidas y NO coinciden (perfil metalico con hormigon, o
// hormigon con acero). Si alguna familia es undefined (seccion generica, material
// inexistente), NO se avisa: no hay base para afirmar la incoherencia.
export function esCombinacionIncoherente(
  seccion: Seccion,
  materialId: string,
): ResultadoCoherencia {
  const familiaSeccion = familiaDeSeccion(seccion);
  const familiaMaterial = familiaDeMaterialId(materialId);
  const incoherente =
    familiaSeccion !== undefined &&
    familiaMaterial !== undefined &&
    familiaSeccion !== familiaMaterial;
  return { incoherente, familiaSeccion, familiaMaterial };
}

// Variante por ID de seccion: para los call sites de UI que solo tienen el seccionId
// (panel-herramienta con defaults, donde la seccion aun puede ser un perfil de
// catalogo por id) y el array de secciones de obra. Acepta null en ambos (el aviso
// no aplica si falta seccion o material). Devuelve el mismo resultado.
export function esCombinacionIncoherentePorId(
  seccionId: string | null,
  materialId: string | null,
  seccionesObra: readonly Seccion[],
): ResultadoCoherencia {
  if (seccionId === null || materialId === null) {
    return { incoherente: false, familiaSeccion: undefined, familiaMaterial: undefined };
  }
  const familiaSeccion = familiaDeSeccionId(seccionId, seccionesObra);
  const familiaMaterial = familiaDeMaterialId(materialId);
  const incoherente =
    familiaSeccion !== undefined &&
    familiaMaterial !== undefined &&
    familiaSeccion !== familiaMaterial;
  return { incoherente, familiaSeccion, familiaMaterial };
}

// Texto del aviso en lenguaje de obra, dado el resultado de coherencia. Devuelve
// undefined si no hay aviso (coherente o indeterminado). Centralizado aqui para que
// los inspectores/paneles muestren EXACTAMENTE el mismo mensaje (una sola fuente).
export function mensajeCoherencia(r: ResultadoCoherencia): string | undefined {
  if (!r.incoherente) return undefined;
  if (r.familiaSeccion === "acero" && r.familiaMaterial === "hormigon") {
    return "Sección de perfil metálico con material de hormigón: revisa la combinación.";
  }
  if (r.familiaSeccion === "hormigon" && r.familiaMaterial === "acero") {
    return "Sección de hormigón con material de acero: revisa la combinación.";
  }
  return undefined;
}
