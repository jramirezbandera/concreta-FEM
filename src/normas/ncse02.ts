/**
 * NCSE-02 (RD 997/2002), lo que usa el motor (fase VS, `docs/fem3d/viento-sismo.md`). La norma va
 * en su módulo para poder añadir otra (la NCSR-23, si se aprueba) sin tocar el cálculo (VS-a).
 *
 * VS2: las masas del artículo 3.2. El espectro (2.3 y 3.6.2.2) llega con VS3.
 *
 * **Art. 3.2, «Masas que intervienen en el cálculo»** (p. 21 del texto de la norma): «se
 * considerarán las masas correspondientes a la propia estructura, las masas permanentes, y una
 * fracción de las restantes masas —siempre que éstas tengan un efecto desfavorable sobre la
 * estructura— de valor:
 * - para sobrecargas de uso en viviendas, hoteles y residencias: 0,5
 * - para sobrecargas de uso en edificios públicos, oficinas y comercios: 0,6
 * - para sobrecargas de uso en locales de aglomeración y espectáculos: 0,6
 * - para sobrecarga de nieve, siempre que ésta permanezca más de 30 días al año: 0,5
 * - para sobrecargas de uso en almacenes, archivos, etc.: 1,0
 * - para sobrecarga de tabiquería: 1,0
 * - para piscinas o grandes depósitos de agua: 1,0».
 *
 * No es el ψ₂ del CTE: estas fracciones dicen qué masa se sacude; qué gravedad actúa a la vez que el
 * sismo lo dicen las combinaciones (art. 3.4).
 */
import type { PsiNombrado } from "../combinaciones/psi.ts";

/** Fracción de una carga permanente (la estructura, las permanentes y la tabiquería): entera. */
export const FRACCION_MASA_PERMANENTE = 1;

/** Fracción de la nieve que permanece más de 30 días al año (y nada de la que no). */
export const FRACCION_MASA_NIEVE = 0.5;

/**
 * Fracción de la sobrecarga de uso por su categoría del DB SE-AE (tabla 3.1), que es como se nombra
 * el ψ de un caso (decisión VS-d):
 * - A (zonas residenciales: viviendas, hoteles, residencias), 0,5;
 * - B (administrativas: oficinas), C (acceso al público: los locales de aglomeración) y D
 *   (comerciales), 0,6;
 * - E (tráfico y aparcamiento) y G (cubiertas accesibles sólo para conservación) no están en la
 *   norma: 0,6 y 0, los ψ₂ del Eurocódigo 8 para esas categorías.
 *
 * Los almacenes y archivos (1,0) no tienen categoría en el DB SE-AE: su fracción se escribe.
 */
export const FRACCION_MASA_USO: Readonly<Record<Extract<PsiNombrado, `uso-${string}`>, number>> = {
  "uso-A": 0.5,
  "uso-B": 0.6,
  "uso-C": 0.6,
  "uso-D": 0.6,
  "uso-E": 0.6,
  "uso-G": 0,
};

/** Las dos de la lista que salen de la norma tal cual; las otras (E y G) son una decisión, y la hipótesis lo dice. */
export const USOS_FUERA_DE_LA_NORMA: readonly PsiNombrado[] = ["uso-E", "uso-G"];
