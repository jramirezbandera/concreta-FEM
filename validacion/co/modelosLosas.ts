/**
 * Fase CO3 (`docs/fem3d/comprobaciones.md`): los modelos de las pruebas de las losas.
 *
 *  - `losaEnDosApoyos`: una losa maciza de L × B sobre dos apoyos lineales, con ν = 0 (flexión
 *    cilíndrica): los esfuerzos de sus franjas X son los de una viga biapoyada de 1 m de ancho.
 *  - `losaPlana`: una planta de 2 × 2 vanos sobre 9 pilares de 40 × 40, con 0,5 m de vuelo; maciza de
 *    25 cm o, con `reticular`, 25+5 a 80 cm con nervios de 12 y ábacos de 2,8 × 2,8 m en los pilares.
 */
import type { CargaFisica, ModeloFisico, Vec2 } from "../../src/compilador/fisico.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const CASOS = [
  { id: "G", pesoPropio: true, accion: { tipo: "G" as const } },
  { id: "CM", accion: { tipo: "G" as const } },
  { id: "Q", accion: { tipo: "Q" as const, psi: "uso-A" as const } },
];

export interface VarianteDosApoyos {
  L?: number;
  B?: number;
  /** Canto, m. */
  h?: number;
  /** Carga muerta y sobrecarga, kN/m². */
  cm?: number;
  q?: number;
}

/** El peso específico del hormigón de la losa en dos apoyos, kN/m³. */
export const PESO_HORMIGON = 25;

export function losaEnDosApoyos(v: VarianteDosApoyos = {}): ModeloFisico {
  const [L, B] = [v.L ?? 5, v.B ?? 3];
  return {
    plantas: [{ id: "P0", altura: null }],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25, nu: 0, peso: PESO_HORMIGON }],
    secciones: [],
    losas: [{ id: "L", planta: "P0", contorno: rect(0, 0, L, B), espesor: v.h ?? 0.2, material: "H" }],
    apoyosLineales: [
      { id: "A", planta: "P0", puntos: [[0, 0], [0, B]], coartados: [true, true, true, false, false, false] },
      { id: "B", planta: "P0", puntos: [[L, 0], [L, B]], coartados: [false, false, true, false, false, false] },
    ],
    casos: CASOS,
    cargas: [
      { tipo: "superficie", id: "cm", caso: "CM", planta: "P0", losa: "L", q: [0, 0, -(v.cm ?? 2)] },
      { tipo: "superficie", id: "q", caso: "Q", planta: "P0", losa: "L", q: [0, 0, -(v.q ?? 3)] },
    ],
  };
}

export interface VarianteLosaPlana {
  /** Luz de los vanos, m. */
  luz?: number;
  reticular?: boolean;
  /** Lado de los ábacos del reticular, m (por defecto 2,8). */
  abaco?: number;
  cm?: number;
  q?: number;
  /** Girada 90° en planta (X ↔ Y): para la prueba metamórfica. */
  girada?: boolean;
  /** Con el sismo del programa. */
  sismo?: boolean;
  /** Sin la imperfección global (IG): para la prueba metamórfica del giro. */
  sinImperfeccion?: boolean;
  /** Sin acciones en los casos: sin combinaciones de ELS. */
  sinAcciones?: boolean;
}

export function losaPlana(v: VarianteLosaPlana = {}): ModeloFisico {
  const luz = v.luz ?? (v.reticular ? 6 : 5);
  const p = (x: number, y: number): [number, number] => (v.girada ? [-y, x] : [x, y]);
  const xs = [0, luz, 2 * luz];
  const pilares = xs.flatMap((x, i) =>
    xs.map((y, j) => {
      const [px, py] = p(x, y);
      return { id: `P${3 * i + j + 1}`, x: px, y: py, desde: "CIM", hasta: "F1", seccion: "p" };
    }),
  );
  const contorno = rect(-0.5, -0.5, 2 * luz + 0.5, 2 * luz + 0.5).map(([x, y]) => p(x, y));
  const cargas: CargaFisica[] = [
    { tipo: "superficie", id: "cm", caso: "CM", planta: "F1", losa: "L", q: [0, 0, -(v.cm ?? 2)] },
    { tipo: "superficie", id: "q", caso: "Q", planta: "F1", losa: "L", q: [0, 0, -(v.q ?? 3)] },
  ];
  return {
    plantas: [
      { id: "F1", altura: null },
      { id: "CIM", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "p", material: "H", forma: "rectangular", b: 0.4, h: 0.4 }],
    pilares,
    losas: [
      v.reticular
        ? { id: "L", planta: "F1", contorno, espesor: 0.3, material: "H", ...(v.girada ? { eje1: 90 } : {}), reticular: { intereje: 0.8, nervio: 0.12, capa: 0.05, abacosPilares: { lado: v.abaco ?? 2.8 } } }
        : { id: "L", planta: "F1", contorno, espesor: 0.25, material: "H", ...(v.girada ? { eje1: 90 } : {}) },
    ],
    casos: v.sinAcciones ? CASOS.map(({ accion: _, ...c }) => c) : CASOS,
    cargas,
    ...(v.sismo || v.sinImperfeccion ? { acciones: { ...(v.sismo ? { sismo: { ab: 0.16, K: 1, terreno: "II" as const, mu: 2 } } : {}), ...(v.sinImperfeccion ? { imperfeccion: { aplicar: false } } : {}) } } : {}),
  };
}
