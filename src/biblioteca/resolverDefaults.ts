// Resolucion de la SECCION DE OBRA por defecto para la herramienta de un elemento
// (auditoria UI/UX D4+D5). PURA: sin React, sin IO. Se testea en Node.
//
// Los paneles-herramienta (pilar/viga/paño) preseleccionan una seccion al activarse
// para que el primer clic pueda colocar de inmediato. ANTES cogian `listarSecciones()[0]`
// (el primer PERFIL del catalogo, IPE): incoherente con el MVP = hormigon. Ahora
// resuelven contra las secciones DE OBRA del modelo, en este orden:
//   1. La primera seccion de obra cuyo `nombre` coincida con la default de la
//      biblioteca (p. ej. "HA 30×30"): la sembrada por crearModeloVacio.
//   2. Si no la hay, la primera seccion de obra de HORMIGON (rect/circular): el
//      usuario pudo borrar la sembrada pero tener otras de hormigon.
//   3. Fallback: el primer PERFIL del catalogo (por si el modelo no tiene NINGUNA
//      seccion de obra), para no dejar la herramienta sin seccion.
//
// El `null` solo se devuelve si no hay ni secciones de obra ni catalogo (imposible en
// la practica: el catalogo de perfiles nunca esta vacio).

import type { Seccion } from "../dominio/seccion";
import { listarSecciones } from "./index";

// ¿Es una seccion de obra de HORMIGON (parametrica)? Excluye perfil metalico y
// generico (este ultimo no tiene familia declarada; ver coherencia.ts).
function esSeccionHormigon(s: Seccion): boolean {
  return s.tipo === "hormigonRectangular" || s.tipo === "hormigonCircular";
}

// Resuelve el id de la seccion de obra por defecto para una herramienta, dado el
// `nombre` de la default de la biblioteca (DEFAULT_SECCION_PILAR.nombre, etc.) y el
// array de secciones de obra del modelo. Ver el orden de resolucion arriba.
export function resolverSeccionDefault(
  nombreDefault: string,
  seccionesObra: readonly Seccion[],
): string | null {
  // 1. Coincidencia por nombre con la default de la biblioteca.
  const porNombre = seccionesObra.find((s) => s.nombre === nombreDefault);
  if (porNombre !== undefined) return porNombre.id;
  // 2. Primera seccion de obra de hormigon.
  const primeraHormigon = seccionesObra.find(esSeccionHormigon);
  if (primeraHormigon !== undefined) return primeraHormigon.id;
  // 3. Fallback: primer perfil del catalogo (nunca vacio en la practica).
  return listarSecciones()[0]?.id ?? null;
}
