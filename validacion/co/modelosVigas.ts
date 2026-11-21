/**
 * Fase CO2 (`docs/fem3d/comprobaciones.md`): el pórtico de las pruebas de las vigas.
 *
 * Dos plantas de 3 m. Pilares de 40 × 40 en x = 0, 6 y 11 e y = 0 y 5. En cada planta:
 *  - dos vigas de 30 × 50 según X (y = 0 e y = 5), de x = 0 a 12,5: dos vanos (6 y 5 m entre ejes) y
 *    un voladizo de 1,5 m;
 *  - tres vigas de 30 × 50 según Y (x = 0, 6 y 11), de un vano de 5 m.
 * Sin losas (diafragma rígido por planta). Las cargas, repartidas en las vigas: el peso propio (caso
 * G, del programa), la carga muerta CM y la sobrecarga Q en las vigas según X, y el viento como una
 * puntual por planta en el centro. Con `sismo`, el del programa.
 */
import type { CargaFisica, ModeloFisico } from "../../src/compilador/fisico.ts";

export interface VariantePortico {
  /** Carga muerta y sobrecarga de las vigas según X, kN/m. */
  cm?: number;
  q?: number;
  /** Viento por planta, kN. */
  W?: number;
  sinViento?: boolean;
  sismo?: boolean;
  /** Sección de las vigas, m. */
  b?: number;
  h?: number;
  /** Girado 90° en planta (X ↔ Y): para la prueba metamórfica. */
  girado?: boolean;
}

const PLANTAS = ["F2", "F1"];
const XS = [0, 6, 11];
const YS = [0, 5];

export function porticoVigas(v: VariantePortico = {}): ModeloFisico {
  const cm = v.cm ?? 15;
  const q = v.q ?? 10;
  const W = v.W ?? 40;
  // El giro de 90°: (x, y) → (−y, x)
  const p = (x: number, y: number): [number, number] => (v.girado ? [-y, x] : [x, y]);
  const F = (fx: number, fy: number): [number, number, number] => (v.girado ? [-fy, fx, 0] : [fx, fy, 0]);
  const pilares = XS.flatMap((x, i) =>
    YS.map((y, j) => {
      const [px, py] = p(x, y);
      return { id: `P${2 * i + j + 1}`, x: px, y: py, desde: "CIM", hasta: "F2", seccion: "p", ...(v.girado ? { giro: 90 } : {}) };
    }),
  );
  const vigas = PLANTAS.flatMap((planta) => [
    ...YS.map((y, j) => ({ id: `${planta}-X${j}`, planta, puntos: [p(0, y), p(12.5, y)], seccion: "v" })),
    ...XS.map((x, i) => ({ id: `${planta}-Y${i}`, planta, puntos: [p(x, 0), p(x, 5)], seccion: "v" })),
  ]);
  const cargas: CargaFisica[] = [];
  for (const planta of PLANTAS) {
    for (let j = 0; j < YS.length; j++) {
      cargas.push({ tipo: "viga", id: `CM-${planta}-X${j}`, caso: "CM", viga: `${planta}-X${j}`, ejes: "global", q: [0, 0, -cm] });
      cargas.push({ tipo: "viga", id: `Q-${planta}-X${j}`, caso: "Q", viga: `${planta}-X${j}`, ejes: "global", q: [0, 0, -q] });
    }
    if (!v.sinViento) {
      const [cx, cy] = p(6, 2.5);
      cargas.push({ tipo: "puntual", id: `W+-${planta}`, caso: "W+", planta, x: cx, y: cy, F: F(W, 0) });
      cargas.push({ tipo: "puntual", id: `W--${planta}`, caso: "W-", planta, x: cx, y: cy, F: F(-W, 0) });
    }
  }
  const direccion = v.girado ? ("Y" as const) : ("X" as const);
  return {
    plantas: [
      { id: "F2", altura: null },
      { id: "F1", altura: 3 },
      { id: "CIM", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p", material: "H", forma: "rectangular", b: 0.4, h: 0.4 },
      { id: "v", material: "H", forma: "rectangular", b: v.b ?? 0.3, h: v.h ?? 0.5 },
    ],
    pilares,
    vigas,
    casos: [
      { id: "G", pesoPropio: true, accion: { tipo: "G" } },
      { id: "CM", accion: { tipo: "G" } },
      { id: "Q", accion: { tipo: "Q", psi: "uso-A" } },
      ...(v.sinViento
        ? []
        : [
            { id: "W+", accion: { tipo: "W" as const, direccion, signo: 1 as const, familia: "viento", psi: "viento" as const } },
            { id: "W-", accion: { tipo: "W" as const, direccion, signo: -1 as const, familia: "viento", psi: "viento" as const } },
          ]),
    ],
    cargas,
    ...(v.sismo ? { acciones: { sismo: { ab: 0.16, K: 1, terreno: "II" as const, mu: 2 } } } : {}),
  };
}

export interface VarianteBiapoyada {
  /** Luz entre apoyos, m. */
  L?: number;
  /** Vuelo tras el segundo apoyo, m (0: sin voladizo). */
  vuelo?: number;
  /** Carga muerta y sobrecarga, kN/m. */
  cm?: number;
  q?: number;
}

/**
 * Una viga de 30 × 50 sobre dos apoyos puntuales (sin pilares: biapoyada de verdad), con un voladizo
 * opcional tras el segundo. Para los oráculos analíticos de la flecha: con la carga uniforme w,
 * 5·w·L⁴/(384·E·I) + w·L²/(8·G·Av) en el centro del vano.
 */
export function vigaBiapoyada(v: VarianteBiapoyada = {}): ModeloFisico {
  const L = v.L ?? 6;
  const vuelo = v.vuelo ?? 0;
  return {
    plantas: [
      { id: "F1", altura: null, diafragma: "ninguno" },
      { id: "CIM", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "v", material: "H", forma: "rectangular", b: 0.3, h: 0.5 }],
    vigas: [{ id: "V1", planta: "F1", puntos: [[0, 0], [L + vuelo, 0]], seccion: "v" }],
    apoyos: [
      { id: "A1", planta: "F1", x: 0, y: 0, coartados: [true, true, true, true, false, false] },
      { id: "A2", planta: "F1", x: L, y: 0, coartados: [false, true, true, false, false, false] },
    ],
    casos: [
      { id: "G", pesoPropio: true, accion: { tipo: "G" } },
      { id: "CM", accion: { tipo: "G" } },
      { id: "Q", accion: { tipo: "Q", psi: "uso-A" } },
    ],
    cargas: [
      { tipo: "viga", id: "CM-1", caso: "CM", viga: "V1", ejes: "global", q: [0, 0, -(v.cm ?? 15)] },
      { tipo: "viga", id: "Q-1", caso: "Q", viga: "V1", ejes: "global", q: [0, 0, -(v.q ?? 10)] },
    ],
  };
}
