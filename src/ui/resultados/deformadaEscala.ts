// deformadaEscala: helper PURO para la amplificacion INICIAL de la deformada (D6). Sin
// React/R3F: testeable en Node. La deformada real es imperceptible (m sobre m: 280 mm en
// un vano de 5 m no se ve a escala del edificio), asi que a ×1 el usuario cree que "no se
// ha calculado nada". Al llegar resultados estaticos NUEVOS calculamos una amplificacion
// que lleve el desplazamiento MAXIMO a ~5% de la dimension mayor del bounding box del
// modelo, redondeada y acotada a [1,500]. El usuario puede seguir moviendo el slider
// despues; esto solo fija el arranque legible (no se re-impone en cada render).
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import { deformadaGeometria } from "./deformadaGeometria";

// Limites del factor (mismos que el slider en LeyendaEscala): la escala inicial nunca sale
// de aqui. FRACCION_OBJETIVO = 5% del lado mayor del bbox es un compromiso legible (la
// curva se ve sin deformar la lectura de la geometria).
export const ESCALA_MIN = 1;
export const ESCALA_MAX = 500;
const FRACCION_OBJETIVO = 0.05;

// Redondea a un factor "bonito" y lo acota a [ESCALA_MIN, ESCALA_MAX]. Entero (el slider y
// la etiqueta muestran ×N enteros): un factor fraccionario no aporta y ensucia la lectura.
function acotar(escala: number): number {
  if (!Number.isFinite(escala) || escala <= ESCALA_MIN) return ESCALA_MIN;
  return Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, Math.round(escala)));
}

// Dimension mayor del bounding box del modelo (m), sobre las posiciones FEM de los nudos.
// Los ejes FEM y de escena difieren en un intercambio Y<->Z, pero el bbox (max-min por eje)
// es invariante a esa permutacion, asi que da igual usar coords FEM. 0 si no hay nudos.
function ladoMayorBBox(modeloFEM: ModeloFEM): number {
  const ns = modeloFEM.nodes;
  if (ns.length === 0) return 0;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const n of ns) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.z < minZ) minZ = n.z;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
    if (n.z > maxZ) maxZ = n.z;
  }
  return Math.max(maxX - minX, maxY - minY, maxZ - minZ);
}

// Calcula la amplificacion inicial legible para la combinacion `combo`. Estrategia:
//   escala = (FRACCION_OBJETIVO * ladoMayor) / desplazamientoMaximo
// acotada a [1,500] y redondeada. Casos borde (todos devuelven ESCALA_MIN=1):
//   - sin resultados/modelo/combo, o sin nudos (bbox 0),
//   - desplazamiento maximo ~0 (estructura rigida sin flecha apreciable): no hay nada que
//     amplificar; ×1.
//   - flecha ya grande respecto del bbox (escala calculada <= 1): se deja ×1 (amplificar
//     la empeoraria).
// Robusta: nunca lanza; reusa deformadaGeometria (misma fuente que el overlay/leyenda).
export function calcularEscalaInicial(
  modeloFEM: ModeloFEM | null,
  resultados: ResultadosCalculo | null,
  combo: string | null,
): number {
  if (!modeloFEM || !resultados || !combo) return ESCALA_MIN;
  const lado = ladoMayorBBox(modeloFEM);
  if (lado <= 0) return ESCALA_MIN;
  // magMax = desplazamiento maximo real (m) de la combinacion (escala 1, sin amplificar).
  const geo = deformadaGeometria(modeloFEM, resultados, combo, 1);
  if (geo.polilineas.length === 0 || geo.magMax <= 0) return ESCALA_MIN;
  return acotar((FRACCION_OBJETIVO * lado) / geo.magMax);
}
