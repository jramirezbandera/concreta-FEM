/**
 * Fase CO5 (`docs/fem3d/comprobaciones.md` §8.9): los modelos de las pruebas de las zapatas.
 *
 * - `pilarAislado`: un pilar en ménsula de la cimentación a una planta, con cargas en su cabeza: G
 *   vertical y, en el caso W, una fuerza horizontal y un momento. Lo que llega a la zapata se sabe a
 *   mano: la estática de la ménsula.
 * - `edificioZapatas`: el edificio de 3 plantas de SO (3 × 3 pilares de 40 × 40 a 6 m), con viento o
 *   con el sismo del programa, girado en planta si se pide (las cargas y los pilares con él).
 */
import type { CargaFisica, ModeloFisico } from "../../src/compilador/fisico.ts";
import type { CargaZapata, DemandasZapata } from "../../src/comprobaciones/demandas/zapatas.ts";
import { edificioSO, type VarianteSO } from "../so/modelos.ts";

export interface VariantePilar {
  /** kN hacia abajo, en G. */
  P?: number;
  /** En W: fuerza horizontal (kN) y momento (kN·m) en la cabeza, globales. */
  Fx?: number;
  Fy?: number;
  Mx?: number;
  My?: number;
  /** Altura del pilar, m. */
  altura?: number;
  giro?: number;
  b?: number;
  h?: number;
  circular?: boolean;
}

export function pilarAislado(v: VariantePilar = {}): ModeloFisico {
  const cargas: CargaFisica[] = [
    { tipo: "puntual", id: "G1", caso: "G", planta: "F1", x: 0, y: 0, F: [0, 0, -(v.P ?? 400)] },
    { tipo: "puntual", id: "W1", caso: "W", planta: "F1", x: 0, y: 0, F: [v.Fx ?? 20, v.Fy ?? 0, 0], M: [v.Mx ?? 0, v.My ?? 0, 0] },
  ];
  return {
    plantas: [
      { id: "F1", altura: null },
      { id: "CIM", altura: v.altura ?? 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [v.circular ? { id: "p", material: "H", forma: "circular", D: v.h ?? 0.4 } : { id: "p", material: "H", forma: "rectangular", b: v.b ?? 0.4, h: v.h ?? 0.4 }],
    pilares: [{ id: "P1", x: 0, y: 0, desde: "CIM", hasta: "F1", seccion: "p", ...(v.giro ? { giro: v.giro } : {}) }],
    casos: [
      { id: "G", accion: { tipo: "G" } },
      { id: "W", accion: { tipo: "W", direccion: "X", signo: 1, familia: "viento", psi: "viento" } },
    ],
    cargas,
    // Sin la imperfección global ni el segundo orden: la estática a mano es la de las cargas escritas, y
    // girar el pilar no cambia los factores de las combinaciones
    acciones: { imperfeccion: { aplicar: false }, segundoOrden: { amplificar: false } },
  };
}

/** El edificio de SO girado `giro` grados en planta alrededor del origen (pilares, vigas y cargas). */
export function edificioZapatas(v: VarianteSO & { giro?: number; sinImperfeccion?: boolean } = {}): ModeloFisico {
  const m = edificioSO(v);
  const t = ((v.giro ?? 0) * Math.PI) / 180;
  const [c, s] = [Math.cos(t), Math.sin(t)];
  const r = (x: number, y: number): [number, number] => [c * x - s * y, s * x + c * y];
  const giro = (g: number | undefined) => ((g ?? 0) + (v.giro ?? 0)) % 360;
  return {
    ...m,
    pilares: (m.pilares ?? []).map((p) => {
      const [x, y] = r(p.x, p.y);
      return { ...p, x, y, ...(v.giro ? { giro: giro(p.giro) } : {}) };
    }),
    vigas: (m.vigas ?? []).map((w) => ({ ...w, puntos: w.puntos.map(([x, y]) => r(x, y)) })),
    cargas: (m.cargas ?? []).map((q) => {
      if (q.tipo !== "puntual") return q;
      const [x, y] = r(q.x, q.y);
      const F = q.F ? ([...r(q.F[0], q.F[1]), q.F[2]] as [number, number, number]) : undefined;
      return { ...q, x, y, ...(F ? { F } : {}) };
    }),
    // El viento según X del edificio, girado con él: la dirección de su acción no cambia la combinación
    ...(v.sinImperfeccion ? { acciones: { ...m.acciones, imperfeccion: { aplicar: false } } } : {}),
  };
}

/** Las demandas de una zapata escritas a mano, sin modelo: las mismas cargas para cualquier canto. */
export function sintetica(geo: CargaZapata[], elu: CargaZapata[], o: { cx?: number; cy?: number; circular?: boolean; giro?: number } = {}): DemandasZapata {
  return {
    pilar: "P1",
    planta: "CIM",
    punto: [0, 0, 0],
    giro: o.giro ?? 0,
    seccion: o.circular ? { id: "p", material: "H", forma: "circular", D: o.cx ?? 0.4 } : { id: "p", material: "H", forma: "rectangular", b: o.cy ?? 0.4, h: o.cx ?? 0.4 },
    material: { id: "H", tipo: "hormigon", fck: 25 },
    cx: o.cx ?? 0.4,
    cy: o.cy ?? (o.circular ? o.cx ?? 0.4 : 0.4),
    circular: !!o.circular,
    combinaciones: { geo: new Set(geo.map((x) => x.comb)).size, elu: new Set(elu.map((x) => x.comb)).size },
    cargas: () => ({ geo, elu }),
  };
}

