/**
 * Modelos de prueba de la fase BN (`docs/fem3d/barras.md`): barras entre dos niveles. No es código
 * del compilador.
 */
import type { ModeloFisico } from "../compilador/fisico.ts";

/**
 * Pórtico de acero de dos plantas para el oráculo externo (criterio 8 de BN1,
 * `validacion/bn/oraculo_pynite.py`): perfiles dados por sus propiedades (sin dimensiones, así que sin
 * zonas rígidas), sin diafragmas y sin losas. Lleva una cruz de C a P1, una diagonal de un pilar a la
 * viga de encima (que se parte), un puntal vertical entre las dos vigas, una barra en el plano de P2
 * y una barra girada, con peso propio, cargas de viga y de barra en locales y en globales, y viento.
 */
export function porticoAcero(): ModeloFisico {
  const viga = (id: string, planta: string, a: [number, number], b: [number, number]) => ({ id, planta, puntos: [a, b], seccion: "IPE" });
  const pilar = (id: string, x: number, y: number) => ({ id, x, y, desde: "C", hasta: "P2", seccion: "HEB", giro: x === 0 ? 0 : 90 });
  return {
    plantas: [
      { id: "P2", altura: null, diafragma: "ninguno" },
      { id: "P1", altura: 3.5, diafragma: "ninguno" },
      { id: "C", altura: 4, diafragma: "ninguno" },
    ],
    materiales: [{ id: "S", tipo: "acero" }],
    secciones: [
      { id: "HEB", material: "S", forma: "general", A: 7.81e-3, Iy: 5.696e-5, Iz: 2.003e-5, J: 9.53e-7 },
      { id: "IPE", material: "S", forma: "general", A: 5.38e-3, Iy: 8.356e-5, Iz: 6.04e-6, J: 2.01e-7 },
      { id: "R", material: "S", forma: "general", A: 7.07e-4, Iy: 3.98e-8, Iz: 3.98e-8, J: 7.95e-8 },
      { id: "T", material: "S", forma: "general", A: 1.6e-3, Iy: 2.8e-6, Iz: 1.1e-6, J: 3.1e-6 },
    ],
    pilares: [pilar("A", 0, 0), pilar("B", 6, 0), pilar("C1", 0, 5), pilar("D", 6, 5)],
    vigas: [
      viga("V1a", "P1", [0, 0], [6, 0]),
      viga("V1b", "P1", [0, 5], [6, 5]),
      viga("V2a", "P2", [0, 0], [6, 0]),
      viga("V2b", "P2", [0, 5], [6, 5]),
      viga("V2c", "P2", [0, 0], [0, 5]),
    ],
    barras: [
      { id: "X1", inicio: { planta: "C", x: 0, y: 0 }, fin: { planta: "P1", x: 6, y: 0 }, seccion: "R", liberaciones: { inicio: [false, false, false, false, true, true], fin: [false, false, false, true, true, true] } },
      { id: "X2", inicio: { planta: "C", x: 6, y: 0 }, fin: { planta: "P1", x: 0, y: 0 }, seccion: "R", liberaciones: { inicio: [false, false, false, false, true, true], fin: [false, false, false, true, true, true] } },
      { id: "T1", inicio: { planta: "P1", x: 0, y: 5 }, fin: { planta: "P2", x: 2.5, y: 5 }, seccion: "T" },
      { id: "T2", inicio: { planta: "P1", x: 4, y: 0 }, fin: { planta: "P2", x: 4, y: 0 }, seccion: "T", giro: 20 },
      { id: "T3", inicio: { planta: "P2", x: 6, y: 0 }, fin: { planta: "P2", x: 0, y: 2.5 }, seccion: "T", giro: 35 },
      { id: "T4", inicio: { planta: "C", x: 6, y: 5 }, fin: { planta: "P1", x: 3, y: 0 }, seccion: "T", giro: -60 },
    ],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }, { id: "W" }],
    cargas: [
      { tipo: "viga", id: "qv", caso: "Q", viga: "V1b", ejes: "global", q: [0, 0, -8] },
      { tipo: "viga", id: "qv2", caso: "Q", viga: "V2a", ejes: "local", q: [0, 0.5, -4], qb: [0, -0.5, -2], desde: 1, hasta: 5 },
      { tipo: "barra", id: "qt1", caso: "Q", barra: "T1", ejes: "local", q: [0.3, 0.6, -1.5], qb: [0, -0.2, -0.5], desde: 0.4, hasta: 3.2 },
      { tipo: "barra", id: "qt3", caso: "Q", barra: "T3", ejes: "global", q: [0.2, 0, -1] },
      { tipo: "barra", id: "qt4", caso: "W", barra: "T4", ejes: "local", q: [0, 1.2, 0.4] },
      { tipo: "puntual", id: "w1", caso: "W", planta: "P2", x: 0, y: 0, F: [12, 3, 0] },
      { tipo: "puntual", id: "w2", caso: "W", planta: "P1", x: 6, y: 5, F: [8, -2, 0], M: [0, 0, 1.5] },
    ],
  };
}

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
