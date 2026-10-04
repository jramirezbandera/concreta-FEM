/**
 * Losas aleatorias para las pruebas de C2: sobre un modelo de `fisicoAleatorio`, una losa por planta
 * dibujada a ejes (a veces con una esquina achaflanada y un hueco en un vano), con `eje1` al azar, y
 * cargas de superficie (la losa entera y una zona), lineales y puntuales en la losa, y una banda.
 * Reproducible por semilla, sin `Math.hypot` ni `**` (COM-12). No es código del compilador.
 */
import type { Banda, CargaFisica, Losa, ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { azar } from "./fisicoAleatorio.ts";

export interface OpcionesLosasAleatorias {
  /** Ángulo del eje 1: "x" (0°), "y" (90°) o al azar. Por defecto, al azar entre los tres. */
  eje1?: "x" | "y" | "azar";
}

export function conLosasAleatorias(f: ModeloFisico, semilla: number, o: OpcionesLosasAleatorias = {}): ModeloFisico {
  const r = azar(7000 + semilla);
  const entre = (a: number, b: number) => a + (b - a) * r();
  const red = (x: number, paso = 0.05) => Math.round(x / paso) * paso;
  const xs = [...new Set(f.pilares!.map((p) => p.x))].sort((a, b) => a - b);
  const ys = [...new Set(f.pilares!.map((p) => p.y))].sort((a, b) => a - b);
  const [X, Y] = [xs[xs.length - 1]!, ys[ys.length - 1]!];
  const plantas = f.plantas.filter((p) => p.tipo !== "sotano").map((p) => p.id);
  const losas: Losa[] = [];
  const bandas: Banda[] = [];
  const cargas: CargaFisica[] = [...(f.cargas ?? [])];
  let n = 0;
  for (const p of plantas) {
    const chaflan = r() < 0.4;
    const c = red(entre(0.8, 1.5));
    const contorno: Vec2[] = chaflan
      ? [
          [0, 0],
          [X, 0],
          [X, Y],
          [c, Y],
          [0, Y - c],
        ]
      : [
          [0, 0],
          [X, 0],
          [X, Y],
          [0, Y],
        ];
    // Hueco en un vano, lejos de sus vigas (no en el primero en x, donde va el tabique)
    const i = Math.floor(entre(1, xs.length - 1 - 1e-9));
    const j = Math.floor(entre(0, ys.length - 1 - 1e-9));
    const [x0, x1, y0, y1] = [xs[i]!, xs[i + 1]!, ys[j]!, ys[j + 1]!];
    const huecos: Vec2[][] =
      r() < 0.5
        ? [
            [
              [red(x0 + 1), red(y0 + 1)],
              [red(x0 + 1 + entre(0.8, x1 - x0 - 2.2)), red(y0 + 1)],
              [red(x0 + 1 + entre(0.8, x1 - x0 - 2.2)), red(y0 + 1 + entre(0.8, (y1 - y0) / 2 - 1.2))],
              [red(x0 + 1), red(y0 + 1 + entre(0.8, (y1 - y0) / 2 - 1.2))],
            ],
          ]
        : [];
    // Un hueco degenerado por el redondeo (lados iguales) se descarta
    const huecosBien = huecos.filter((h) => h[1]![0] > h[0]![0] + 0.5 && h[2]![1] > h[1]![1] + 0.5);
    const u = r();
    const eje1 = o.eje1 === "x" ? 0 : o.eje1 === "y" ? 90 : u < 0.4 ? 0 : u < 0.7 ? 90 : red(entre(0, 180), 1);
    losas.push({ id: `L-${p}`, planta: p, contorno, huecos: huecosBien, espesor: red(entre(0.2, 0.3), 0.01), material: "HA", eje1, ...(r() < 0.3 ? { pp: red(entre(4, 7), 0.1) } : {}) });
    cargas.push({ tipo: "superficie", id: `s${n++}-${p}`, caso: "G", planta: p, losa: `L-${p}`, q: [0, 0, -red(entre(1, 3), 0.1)] });
    // Zona en otro vano (puede salirse de la losa por el chaflán)
    const zi = Math.floor(entre(0, xs.length - 1 - 1e-9));
    const zx = [red(xs[zi]! + entre(0.3, 1)), red(xs[zi + 1]! - entre(0.3, 1))];
    const zy = [red(entre(0.2, Y / 2)), red(entre(Y / 2 + 0.5, Y))];
    cargas.push({
      tipo: "superficie",
      id: `z${n++}-${p}`,
      caso: "Q",
      planta: p,
      zona: [
        [zx[0]!, zy[0]!],
        [zx[1]!, zy[0]!],
        [zx[1]!, zy[1]!],
        [zx[0]!, zy[1]!],
      ],
      q: [0, 0, -red(entre(2, 5), 0.5)],
    });
    // Tabique: polilínea dentro del primer vano en x
    const tx = red(xs[0]! + entre(1, xs[1]! - 1));
    cargas.push({
      tipo: "lineal",
      id: `t${n++}-${p}`,
      caso: "G",
      planta: p,
      puntos: [
        [tx, red(entre(0.5, Y / 3))],
        [tx, red(entre(Y / 2, Y - 0.5))],
        [red(Math.min(tx + entre(0.8, 2), xs[1]! - 0.5)), red(entre(Y / 2, Y - 0.5))],
      ],
      q: [0, 0, -red(entre(4, 8), 0.5)],
    });
    // Puntual en el centro de un vano
    const pi = Math.floor(entre(0, xs.length - 1 - 1e-9));
    const pj = Math.floor(entre(0, ys.length - 1 - 1e-9));
    cargas.push({ tipo: "puntual", id: `f${n++}-${p}`, caso: "Q", planta: p, x: red((xs[pi]! + xs[pi + 1]!) / 2 + entre(-0.6, 0.6), 0.01), y: red((ys[pj]! + ys[pj + 1]!) / 2 + entre(-0.6, 0.6), 0.01), F: [0, 0, -red(entre(5, 20), 0.5)] });
    // Banda de pilar a lo largo de un eje y, desde la cara de un pilar
    const bj = Math.floor(entre(0, ys.length - 1e-9));
    bandas.push({ id: `B-${p}`, planta: p, desde: [red(xs[0]! + 0.4), ys[bj]!], hasta: [red(xs[1]! - 0.4), ys[bj]!], ancho: red(entre(1.2, 2.5)) });
  }
  return { ...f, losas, bandas, cargas };
}
