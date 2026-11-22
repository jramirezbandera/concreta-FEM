/**
 * Fase CO4 (`docs/fem3d/comprobaciones.md` §8.7): los modelos de las pruebas del punzonamiento.
 *
 * `losaBordes`: una planta de 2 × 2 vanos sobre 9 pilares con la losa hasta la cara de fuera de los
 * pilares de borde (los de esquina, de esquina; los de los lados, de borde; el central, interior), sin
 * vigas; maciza o reticular con ábacos. Con `hueco`, uno junto al pilar central.
 */
import type { CargaFisica, ModeloFisico, Vec2 } from "../../src/compilador/fisico.ts";
import { losaPlana } from "./modelosLosas.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

export interface VarianteBordes {
  luz?: number;
  /** Canto de la losa, m. */
  h?: number;
  /** Lado de los pilares, m. */
  lado?: number;
  reticular?: boolean;
  /** Un hueco de 1 × 1 m con su esquina a esta distancia (en x y en y) de la esquina del pilar central; 0, pegado a ella. */
  hueco?: number;
  cm?: number;
  q?: number;
  /** Girada 90° en planta. */
  girada?: boolean;
  /** Pilar central circular de este diámetro, m. */
  circular?: number;
  /** Sin la imperfección global (IG): para la prueba del giro. */
  sinImperfeccion?: boolean;
  /** La losa vuela esto más allá de la cara de fuera de los pilares de borde, m. */
  vuelo?: number;
}

export function losaBordes(v: VarianteBordes = {}): ModeloFisico {
  const luz = v.luz ?? 5;
  const lado = v.lado ?? 0.4;
  const g = (x: number, y: number): Vec2 => (v.girada ? [-y, x] : [x, y]);
  const xs = [0, luz, 2 * luz];
  const pilares = xs.flatMap((x, i) => xs.map((y, j) => ({ id: `P${i}${j}`, x: g(x, y)[0], y: g(x, y)[1], desde: "P0", hasta: "P1", seccion: v.circular && i === 1 && j === 1 ? "C" : "P" })));
  const e = lado / 2 + (v.vuelo ?? 0);
  const contorno = rect(-e, -e, 2 * luz + e, 2 * luz + e).map(([x, y]) => g(x, y));
  const c = luz + lado / 2 + (v.hueco ?? 0);
  const huecos = v.hueco !== undefined ? [rect(c, c, c + 1, c + 1).map(([x, y]) => g(x, y))] : undefined;
  const cargas: CargaFisica[] = [
    { tipo: "superficie", id: "cm", caso: "CM", planta: "P1", losa: "L", q: [0, 0, -(v.cm ?? 2)] },
    { tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -(v.q ?? 3)] },
  ];
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "P0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "P", forma: "rectangular", b: lado, h: lado, material: "H" },
      ...(v.circular ? [{ id: "C", forma: "circular" as const, D: v.circular, material: "H" }] : []),
    ],
    pilares,
    losas: [
      {
        id: "L",
        planta: "P1",
        contorno,
        ...(huecos ? { huecos } : {}),
        espesor: v.h ?? (v.reticular ? 0.3 : 0.25),
        material: "H",
        ...(v.girada ? { eje1: 90 } : {}),
        ...(v.reticular ? { reticular: { intereje: 0.8, nervio: 0.12, capa: 0.05, abacosPilares: { lado: 2.8 } } } : {}),
      },
    ],
    casos: [
      { id: "G", pesoPropio: true, accion: { tipo: "G" } },
      { id: "CM", accion: { tipo: "G" } },
      { id: "Q", accion: { tipo: "Q", psi: "uso-A" } },
    ],
    cargas,
    ...(v.sinImperfeccion ? { acciones: { imperfeccion: { aplicar: false } } } : {}),
  };
}

/** Los modelos de la medida y de la referencia congelada. */
export function modelosPunzonamiento(): Record<string, ModeloFisico> {
  return {
    "losa plana maciza 2 × 2 de 5 m, con vuelo de 0,5 m": losaPlana(),
    "losa maciza 2 × 2 de 5 m hasta la cara de los pilares": losaBordes(),
    "la misma, de 7 m y 30 cm": losaBordes({ luz: 7, h: 0.3 }),
    "la de 5 m, con un hueco pegado a la esquina del pilar central": losaBordes({ hueco: 0 }),
    "reticular 25+5 de 2 × 2 de 6 m, con vuelo de 0,5 m": losaPlana({ reticular: true }),
    "reticular 25+5 de 2 × 2 de 6 m hasta la cara de los pilares": losaBordes({ luz: 6, reticular: true }),
  };
}
