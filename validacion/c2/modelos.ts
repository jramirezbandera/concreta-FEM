/**
 * Modelos físicos de validación de C2 (no son código del compilador).
 *
 * `edificioObjetivoLosas`: el edificio objetivo de C1 (`validacion/c1/banco.ts`: retícula de
 * 10 × 8 pilares con luces de 6 × 5 m, vigas por todos los ejes y secundarias a media luz) con una
 * losa maciza de 25 cm por planta dibujada a ejes, con el hueco de la escalera. Cargas: peso propio
 * (pilares, vigas por su descuelgue y losas por su pp), resto de permanentes y sobrecarga como
 * superficie (con una zona más cargada), tabiquería como carga lineal y viento en los pilares.
 */
import type { CargaFisica, ModeloFisico, Vec2 } from "../../src/compilador/fisico.ts";
import { edificioObjetivo } from "../c1/banco.ts";

export function edificioObjetivoLosas(plantas = 7, nx = 9, ny = 7): ModeloFisico {
  const f = edificioObjetivo(plantas, nx, ny);
  const [X, Y] = [6 * nx, 5 * ny];
  // Hueco de la escalera en el vano (4, 3), o en el último si el edificio es más pequeño
  const [bx, by] = [6 * Math.min(4, nx - 1), 5 * Math.min(3, ny - 1)];
  const ids = Array.from({ length: plantas }, (_, k) => `N${k + 1}`);
  // Sin las cargas lineales de las vigas de C1: las cargas van ahora a la losa
  const cargas: CargaFisica[] = f.cargas!.filter((c) => c.tipo === "pilar");
  for (const p of ids) {
    cargas.push({ tipo: "superficie", id: `R-${p}`, caso: "G", planta: p, losa: `L-${p}`, q: [0, 0, -2] });
    cargas.push({ tipo: "superficie", id: `Q-${p}`, caso: "Q", planta: p, losa: `L-${p}`, q: [0, 0, -2] });
    cargas.push({
      tipo: "superficie",
      id: `Qz-${p}`,
      caso: "Q",
      planta: p,
      zona: [
        [6.8, 2.6],
        [Math.min(17.2, X - 0.8), 2.6],
        [Math.min(17.2, X - 0.8), Math.min(12.4, Y - 0.6)],
        [6.8, Math.min(12.4, Y - 0.6)],
      ],
      q: [0, 0, -3],
    });
    cargas.push({
      tipo: "lineal",
      id: `T-${p}`,
      caso: "G",
      planta: p,
      // En un edificio pequeño, en la primera fila de vanos (lejos del hueco)
      puntos: [
        [1.5, ny >= 4 ? 7.5 : 2.5],
        [Math.min(22.5, X - 1.5), ny >= 4 ? 7.5 : 2.5],
        [Math.min(22.5, X - 1.5), ny >= 4 ? Math.min(21.5, Y - 1.5) : 4.5],
      ],
      q: [0, 0, -7],
    });
  }
  return {
    ...f,
    losas: ids.map((p) => ({
      id: `L-${p}`,
      planta: p,
      contorno: [
        [0, 0],
        [X, 0],
        [X, Y],
        [0, Y],
      ],
      huecos: [
        [
          [bx + 0.6, by + 0.4],
          [bx + 5.4, by + 0.4],
          [bx + 5.4, by + 4.6],
          [bx + 0.6, by + 4.6],
        ],
      ],
      espesor: 0.25,
      material: "HA",
    })),
    cargas,
  };
}

/**
 * Retícula con la losa enrasada con la cara exterior de los pilares de fachada (lo habitual en obra):
 * nx × ny vanos de 6 × 5 m, pilares de 50 × 50 cm, vigas de 30 × 50 por los ejes interiores y, en la
 * fachada, con su cara exterior en el borde (eje a 15 cm del borde y a 10 cm del de los pilares);
 * losa de 22 cm, peso propio, sobrecarga de 3 kN/m² y viento en los pilares de la fachada x = 0.
 * Ejercita las plantillas de pilar con la cara en el borde y la franja estrecha bajo la viga de
 * fachada (H52).
 */
export function reticulaEnrasada(plantas = 2, nx = 3, ny = 2): ModeloFisico {
  const [r, e] = [0.25, 0.1];
  const xs = Array.from({ length: nx + 1 }, (_, i) => 6 * i);
  const ys = Array.from({ length: ny + 1 }, (_, j) => 5 * j);
  const [X, Y] = [xs[nx]!, ys[ny]!];
  const ids = Array.from({ length: plantas }, (_, k) => `N${plantas - k}`);
  // Eje de las vigas de fachada: hacia dentro del de los pilares
  const ex = (x: number) => (x === 0 ? e : x === X ? -e : 0);
  const ey = (y: number) => (y === 0 ? e : y === Y ? -e : 0);
  const vigas = ids.flatMap((p) => [
    ...ys.map((y) => ({ id: `X${y}-${p}`, planta: p, puntos: [[-r, y + ey(y)], [X + r, y + ey(y)]] as Vec2[], seccion: "v3050" })),
    ...xs.map((x) => ({ id: `Y${x}-${p}`, planta: p, puntos: [[x + ex(x), -r], [x + ex(x), Y + r]] as Vec2[], seccion: "v3050" })),
  ]);
  const cargas: CargaFisica[] = ids.flatMap((p) => [{ tipo: "superficie" as const, id: `Q-${p}`, caso: "Q", planta: p, losa: `L-${p}`, q: [0, 0, -3] as [number, number, number] }]);
  for (const y of ys) cargas.push({ tipo: "pilar", id: `w${y}`, caso: "V", pilar: `P0-${y}`, ejes: "global", q: [2, 0, 0] });
  return {
    plantas: [...ids.map((id, k) => ({ id, altura: k === 0 ? null : 3 })), { id: "C", tipo: "sotano" as const, altura: 1.5 }],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p50", material: "HA", forma: "rectangular", b: 0.5, h: 0.5 },
      { id: "v3050", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares: xs.flatMap((x) => ys.map((y) => ({ id: `P${x}-${y}`, x, y, desde: "C", hasta: ids[0]!, seccion: "p50" }))),
    vigas,
    losas: ids.map((p) => ({ id: `L-${p}`, planta: p, contorno: [[-r, -r], [X + r, -r], [X + r, Y + r], [-r, Y + r]] as Vec2[], espesor: 0.22, material: "HA" })),
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }, { id: "V" }],
    cargas,
  };
}
