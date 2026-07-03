// Serie CONCATENADA de una viga con varios tramos FEM (F3.2). El arquitecto dibujo
// UNA viga; si el acople paño<->portico la subdividio en N members, su diagrama se
// dibuja como UNA serie continua a lo largo de toda la viga, no como "tramos" (eso
// filtraria jerga FEM, CLAUDE.md §2). Distinto del PILAR pasante, cuyos tramos son
// PLANTAS reales de la obra y por eso llevan selector (D20).
//
// PURO: sin React ni stores; testeable en aislamiento. Concatena las series por
// member con OFFSET x acumulado usando la longitud GEOMETRICA de cada tramo
// (coordenadas de sus nudos en modeloFEM.nodes), en el orden i->j de
// `trazabilidad.vigaAMembers`.
//
// SALTOS REALES: en el nudo compartido entre dos tramos se CONSERVAN los dos puntos
// (el ultimo del tramo k y el primero del k+1, a la misma x). El cortante SALTA ahi
// exactamente la carga que entra de la losa por ese nudo: es un escalon fisico
// honesto, NO se suaviza ni se dedup.

import type { ResultadosCalculo, EstadoMiembroCombo } from "../../solver";
import type { ModeloFEM } from "../../discretizador";

// Campo del diagrama (2,n) del contrato del solver a concatenar.
export type CampoDiagrama = "axial" | "shear_y" | "moment_z" | "defl_y";

// Resultado discriminado en los MISMOS estados-guia que usa PanelDiagramas:
//  - "sin-barra": algun tramo no tiene resultados (trazabilidad y resultados de
//    calculos distintos; no deberia pasar, se maneja sin romper).
//  - "sin-combo": algun tramo no tiene la combinacion pedida.
export type ResultadoSerieViga =
  | { estado: "ok"; posiciones: number[]; valores: number[] }
  | { estado: "sin-barra" }
  | { estado: "sin-combo" };

// Longitud geometrica de un member desde las coordenadas de sus nudos. undefined si
// el member o alguno de sus nudos no esta en el ModeloFEM (datos incoherentes).
function longitudMember(modeloFEM: ModeloFEM, memberName: string): number | undefined {
  const member = modeloFEM.members.find((m) => m.name === memberName);
  if (member === undefined) return undefined;
  const ni = modeloFEM.nodes.find((n) => n.name === member.i);
  const nj = modeloFEM.nodes.find((n) => n.name === member.j);
  if (ni === undefined || nj === undefined) return undefined;
  return Math.hypot(nj.x - ni.x, nj.y - ni.y, nj.z - ni.z);
}

export function serieVigaTramos(
  members: readonly string[],
  resultados: ResultadosCalculo,
  modeloFEM: ModeloFEM,
  combo: string,
  campo: CampoDiagrama,
): ResultadoSerieViga {
  const posiciones: number[] = [];
  const valores: number[] = [];
  let offset = 0;

  for (const memberName of members) {
    const porCombo = resultados.barras[memberName];
    if (porCombo === undefined) return { estado: "sin-barra" };
    const estado: EstadoMiembroCombo | undefined = porCombo[combo];
    if (estado === undefined) return { estado: "sin-combo" };
    const diagrama = estado[campo]; // [ [x...], [v...] ] con x local al tramo (0..L)
    const xs = diagrama[0];
    const vs = diagrama[1];
    for (let k = 0; k < xs.length; k++) {
      posiciones.push(offset + xs[k]);
      valores.push(vs[k]);
    }
    // El offset avanza la longitud GEOMETRICA del tramo (no el ultimo x muestreado,
    // que es el mismo valor salvo ruido de flotante en el muestreo del solver).
    const L = longitudMember(modeloFEM, memberName);
    if (L === undefined) return { estado: "sin-barra" };
    offset += L;
  }

  if (posiciones.length === 0) return { estado: "sin-barra" };
  return { estado: "ok", posiciones, valores };
}
