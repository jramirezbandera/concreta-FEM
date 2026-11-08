/**
 * Modelos de la fase PB (las plantillas de LV2 en los pilares de borde; `docs/fem3d/pilares-borde.md`):
 * la configuración más común en obra, pilares en el eje de una viga de borde de su ancho y la losa
 * hasta la cara de fuera de la viga (VS5, `viento-sismo.md` §14).
 *
 * `recuadros(n, m, op)`: n × m vanos de `luz` m, pilares de `pilar` × `pilar` en cada cruce, vigas de
 * borde de `bViga` × `hViga` por el perímetro (una por vano) y, si `interiores`, también por los ejes
 * interiores; losa maciza de `espesor` (o el reticular del ejemplo 11 con `reticular`) con el contorno
 * en la cara de fuera de las vigas (`vuelo` más allá, si se da). Una planta sobre la cimentación, con
 * peso propio y una carga de superficie.
 */
import type { ModeloFisico, Vec2 } from "../../src/compilador/fisico.ts";

export interface OpcionesRecuadros {
  luz?: number;
  pilar?: number | [number, number];
  bViga?: number;
  hViga?: number;
  espesor?: number;
  interiores?: boolean;
  reticular?: boolean;
  /** Lo que sale la losa más allá de la cara de fuera de la viga de borde (por defecto 0). */
  vuelo?: number;
  /** Carga de superficie (kN/m², hacia abajo). */
  q?: number;
  /** Plantas sobre la cimentación (por defecto 1). */
  plantas?: number;
  /** Las vigas de borde, una por lado de esquina a esquina (sin junta en los pilares de borde). */
  continuas?: boolean;
  /** Vigas interiores sólo según X (los pilares interiores, tapados por ellas). */
  interioresX?: boolean;
}

const R = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

export function recuadros(n: number, m: number, op: OpcionesRecuadros = {}): ModeloFisico {
  const L = op.luz ?? 6;
  const [pb, ph] = typeof op.pilar === "number" ? [op.pilar, op.pilar] : (op.pilar ?? [0.3, 0.3]);
  const b = op.bViga ?? 0.3;
  const hv = op.hViga ?? 0.3;
  const e = op.espesor ?? 0.3;
  const vuelo = op.vuelo ?? 0;
  const nPl = op.plantas ?? 1;
  const plantas = Array.from({ length: nPl }, (_, k) => `N${nPl - k}`);
  const pilares = [];
  for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) pilares.push({ id: `P${i}-${j}`, x: i * L, y: j * L, desde: "CIM", hasta: plantas[0]!, seccion: "P" });
  const vigas: { id: string; planta: string; puntos: Vec2[]; seccion: string }[] = [];
  for (const p of plantas) {
    for (let j = 0; j <= m; j++) {
      if (!op.interiores && !op.interioresX && j !== 0 && j !== m) continue;
      if (op.continuas && (j === 0 || j === m)) vigas.push({ id: `${p}-X${j}`, planta: p, puntos: Array.from({ length: n + 1 }, (_, i) => [i * L, j * L] as Vec2), seccion: "V" });
      else for (let i = 0; i < n; i++) vigas.push({ id: `${p}-X${j}-${i}`, planta: p, puntos: [[i * L, j * L], [(i + 1) * L, j * L]], seccion: "V" });
    }
    for (let i = 0; i <= n; i++) {
      if (!op.interiores && i !== 0 && i !== n) continue;
      if (op.continuas && (i === 0 || i === n)) vigas.push({ id: `${p}-Y${i}`, planta: p, puntos: Array.from({ length: m + 1 }, (_, j) => [i * L, j * L] as Vec2), seccion: "V" });
      else for (let j = 0; j < m; j++) vigas.push({ id: `${p}-Y${i}-${j}`, planta: p, puntos: [[i * L, j * L], [i * L, (j + 1) * L]], seccion: "V" });
    }
  }
  const c = b / 2 + vuelo;
  const contorno = R(-c, -c, n * L + c, m * L + c);
  const q = op.q ?? 5;
  return {
    // de arriba abajo; la altura es la del tramo hasta la planta de encima (la de arriba, null)
    plantas: [...plantas, "CIM"].map((id, k) => ({ id, altura: k === 0 ? null : 3 })),
    materiales: [{ id: "HA-25", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "P", material: "HA-25", forma: "rectangular", b: pb, h: ph },
      { id: "V", material: "HA-25", forma: "rectangular", b, h: hv },
    ],
    pilares,
    vigas,
    losas: plantas.map((p) => ({
      id: `L-${p}`,
      planta: p,
      contorno,
      espesor: e,
      material: "HA-25",
      ...(op.reticular ? { reticular: { intereje: 0.72, nervio: 0.12, capa: 0.05, caseton: "hormigon", abacosPilares: { lado: 2 } } } : {}),
    })),
    casos: [
      { id: "G", nombre: "Peso propio", pesoPropio: true, accion: { tipo: "G" } },
      { id: "Q", nombre: "Uso", accion: { tipo: "Q", psi: "uso-A" } },
    ],
    cargas: plantas.map((p) => ({ tipo: "superficie", id: `Q-${p}`, caso: "Q", planta: p, q: [0, 0, -q], losa: `L-${p}` })),
  } as unknown as ModeloFisico;
}
