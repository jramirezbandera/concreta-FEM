// ENSAMBLAJE del ResultadosCR final (puro). Toma la salida CRUDA del glue (CRGlue:
// x/y del centro de rigidez por planta, en coords de obra por la identidad de
// `mapearEjes`) y le AÑADE la excentricidad estructural ex/ey respecto al centro de
// MASAS, que es un concepto de obra (Capa 1) y se calcula PURO en TS
// (calcularCentroMasaPlanta) — NO en el glue (que se mantiene FEM-puro, regla #1).
//
// ex = CM.x - CR.x, ey = CM.y - CR.y (m). null si el CM de esa planta es null (sin
// masa permanente) o si el CR no es determinable (x/y null). La salida se valida con
// ResultadosCRSchema: si no cumple, es un bug interno del ensamblaje (no dato de
// frontera), por eso .parse() (lanza) y no safeParse.
//
// PURO: sin React/IO/Pyodide. La frontera Pyodide ya la valido el cliente (CRGlue).
import type { Modelo } from "../dominio";
import { calcularCentroMasaPlanta, type CentroMasaPlanta } from "../discretizador";
import {
  ResultadosCRSchema,
  type ResultadosCR,
  type CRGlue,
} from "./resultadosCR";

// Resolutor del centro de masas de una planta. Por defecto el calculo puro real; se
// inyecta en test para asertar el ensamblaje de ex/ey sin construir un Modelo completo.
type ResolverCM = (modelo: Modelo, plantaId: string) => CentroMasaPlanta | null;

export function ensamblarResultadosCR(
  crGlue: CRGlue,
  modelo: Modelo,
  cmDe: ResolverCM = calcularCentroMasaPlanta,
): ResultadosCR {
  const cr_por_planta: Record<
    string,
    { x: number | null; y: number | null; ex: number | null; ey: number | null }
  > = {};

  for (const [plantaId, cr] of Object.entries(crGlue.cr_por_planta)) {
    const cm = cmDe(modelo, plantaId);
    const determinable = cr.x !== null && cr.y !== null;
    // ex/ey solo si hay CM (masa) Y el CR es determinable; en otro caso null.
    const ex = cm !== null && determinable ? cm.x - (cr.x as number) : null;
    const ey = cm !== null && determinable ? cm.y - (cr.y as number) : null;
    cr_por_planta[plantaId] = { x: cr.x, y: cr.y, ex, ey };
  }

  // .parse (no safeParse): la entrada no es de frontera (ya validada), un fallo aqui
  // seria un bug del propio ensamblaje, que debe propagar como excepcion.
  return ResultadosCRSchema.parse({
    units: "kN-m",
    analysis: { type: "centroRigidez" },
    cr_por_planta,
  });
}
