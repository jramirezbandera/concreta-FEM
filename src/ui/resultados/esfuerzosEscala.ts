// esfuerzosEscala: helper PURO de la escala BASE de ordenadas del overlay de
// esfuerzos. Sin React/R3F: testeable en Node.
//
// A diferencia de deformadaEscala (factor fisico ×N adimensional: m sobre m), aqui
// la escala es DIMENSIONAL (m de ordenada por kN o kN·m) y depende de la magnitud y
// combinacion activas: se DERIVA en cada reconstruccion (no se escribe en el store).
// Estrategia: la ordenada del |v| maximo global mide FRACCION_OBJETIVO del lado
// mayor del bounding box del modelo. El usuario la ajusta con un MULTIPLICADOR
// relativo (vistaStore.esfuerzosEscala, default 1):
//     escalaTotal = escalaBaseEsfuerzos(modeloFEM, vMaxAbs) * esfuerzosEscala
import type { ModeloFEM } from "../../discretizador";
import { ladoMayorBBox } from "./deformadaEscala";

// 7% del lado mayor del bbox: diagramas legibles sin invadir la lectura de la
// geometria (la deformada usa 5%; los diagramas rellenos admiten algo mas de cuerpo).
const FRACCION_OBJETIVO = 0.07;

// Escala base (m por kN | kN·m) para que el |v| maximo mida ~7% del bbox. Casos
// borde (todos devuelven 0 = no dibujar ordenadas): sin modelo, bbox degenerado o
// vMaxAbs no positivo/no finito. Nunca lanza.
export function escalaBaseEsfuerzos(
  modeloFEM: ModeloFEM | null,
  vMaxAbs: number,
): number {
  if (!modeloFEM || !Number.isFinite(vMaxAbs) || vMaxAbs <= 0) return 0;
  const lado = ladoMayorBBox(modeloFEM);
  if (lado <= 0) return 0;
  return (FRACCION_OBJETIVO * lado) / vMaxAbs;
}
