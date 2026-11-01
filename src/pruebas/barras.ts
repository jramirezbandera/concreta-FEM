/**
 * Modelos de prueba de la fase BN (`docs/fem3d/barras.md`): barras entre dos niveles. No es código
 * del compilador.
 */
import type { ModeloFisico } from "../compilador/fisico.ts";

/**
 * Pórtico arriostrado de dos plantas: cuatro pilares de hormigón de 30 × 30 en un recuadro de 5 × 4,
 * vigas de 30 × 50 por y = 0 e y = 4 y una losa de 20 en P1 y en P2. En el plano y = 0, una cruz de
 * redondos de acero de C a P1 (sólo a tracción); en el plano y = 4, un tornapuntas de tubo del pilar
 * (0, 4) en P1 a la viga de P2, y una diagonal de la base de (5, 4) a la losa de P1. Peso propio, una
 * sobrecarga en las losas, una carga en el tornapuntas y viento en P2.
 */
export function porticoArriostrado(): ModeloFisico {
  const losa = (planta: string) => ({ id: `L-${planta}`, planta, contorno: [[0, 0], [5, 0], [5, 4], [0, 4]] as [number, number][], espesor: 0.2, material: "HA" });
  const viga = (planta: string, y: number) => ({ id: `V-${planta}-${y}`, planta, puntos: [[0, y], [5, y]] as [number, number][], seccion: "v" });
  return {
    plantas: [
      { id: "P2", altura: null },
      { id: "P1", altura: 3 },
      { id: "C", altura: 3 },
    ],
    materiales: [
      { id: "HA", tipo: "hormigon", fck: 25 },
      { id: "S", tipo: "acero" },
    ],
    secciones: [
      { id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
      { id: "r", material: "S", forma: "circular", D: 0.03 },
      { id: "t", material: "S", forma: "general", A: 1.2e-3, Iy: 1.5e-6, Iz: 1.5e-6, J: 3e-6 },
    ],
    pilares: [
      { id: "A", x: 0, y: 0, desde: "C", hasta: "P2", seccion: "p" },
      { id: "B", x: 5, y: 0, desde: "C", hasta: "P2", seccion: "p" },
      { id: "C1", x: 0, y: 4, desde: "C", hasta: "P2", seccion: "p" },
      { id: "D", x: 5, y: 4, desde: "C", hasta: "P2", seccion: "p" },
    ],
    vigas: [viga("P1", 0), viga("P1", 4), viga("P2", 0), viga("P2", 4)],
    losas: [losa("P1"), losa("P2")],
    barras: [
      { id: "X1", inicio: { planta: "C", x: 0, y: 0 }, fin: { planta: "P1", x: 5, y: 0 }, seccion: "r", soloTraccion: true, liberaciones: { inicio: [false, false, false, false, true, true], fin: [false, false, false, true, true, true] } },
      { id: "X2", inicio: { planta: "C", x: 5, y: 0 }, fin: { planta: "P1", x: 0, y: 0 }, seccion: "r", soloTraccion: true, liberaciones: { inicio: [false, false, false, false, true, true], fin: [false, false, false, true, true, true] } },
      { id: "T1", inicio: { planta: "P1", x: 0, y: 4 }, fin: { planta: "P2", x: 1.5, y: 4 }, seccion: "t" },
      { id: "T2", inicio: { planta: "C", x: 5, y: 4 }, fin: { planta: "P1", x: 3.5, y: 3 }, seccion: "t", giro: 30 },
    ],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }, { id: "W" }],
    cargas: [
      { tipo: "superficie", id: "q1", caso: "Q", planta: "P1", losa: "L-P1", q: [0, 0, -3] },
      { tipo: "superficie", id: "q2", caso: "Q", planta: "P2", losa: "L-P2", q: [0, 0, -1] },
      { tipo: "barra", id: "qt", caso: "Q", barra: "T1", ejes: "local", q: [0, 0, -1.5], qb: [0, 0.4, -0.5], desde: 0.3, hasta: 2.5 },
      { tipo: "puntual", id: "w", caso: "W", planta: "P2", x: 0, y: 2, F: [15, 0, 0] },
    ],
  };
}
