/**
 * Retículas de edificio al azar para probar la rejilla alineada (H52) donde de verdad entra: losa
 * maciza sobre una retícula de 3–6 × 2–4 vanos de 4–7,5 m, con pilares de secciones variadas
 * (a veces girados 90° o circulares), vigas por algunos ejes, y a veces un hueco de escalera pegado
 * a un pilar, voladizo en una fachada, losa enrasada con los pilares de otra y un chaflán.
 * Reproducible por semilla, sin `Math.hypot` ni `**` (COM-12). No es código del compilador.
 */
import type { CargaFisica, ModeloFisico, Pilar, Vec2, Viga } from "../compilador/fisico.ts";
import { azar } from "./fisicoAleatorio.ts";

export function reticulaAleatoria(semilla: number): ModeloFisico {
  const r = azar(9100 + semilla);
  const entre = (a: number, b: number) => a + (b - a) * r();
  const entero = (a: number, b: number) => Math.floor(entre(a, b + 1 - 1e-12));
  const red = (x: number, paso = 0.05) => Math.round(x / paso) * paso;
  const xs = [0];
  for (let i = 0, n = entero(3, 6); i < n; i++) xs.push(red(xs[i]! + entre(4, 7.5)));
  const ys = [0];
  for (let j = 0, n = entero(2, 4); j < n; j++) ys.push(red(ys[j]! + entre(4, 7)));
  const [X, Y] = [xs.at(-1)!, ys.at(-1)!];
  const np = entero(1, 2);
  const ids = Array.from({ length: np }, (_, k) => `N${np - k}`);

  // Contorno: a ejes de los pilares, con voladizo en y = Y, enrasado por fuera en x = 0 (la cara
  // exterior de los pilares de esa fachada; ≥ 0,25 para los más grandes) y un chaflán en (X, 0),
  // que se lleva el pilar de esa esquina
  const vuelo = r() < 0.4 ? red(entre(0.8, 1.6)) : 0;
  const enrasa = r() < 0.4 ? 0.3 : 0;
  const chaflan = r() < 0.3 ? red(entre(1, 2)) : 0;
  const secciones = ["p30", "p40", "p3050", "p2560", "pc"];
  const pilares: Pilar[] = [];
  xs.forEach((x, i) =>
    ys.forEach((y, j) => {
      if (chaflan && x === X && y === 0) return;
      const s = secciones[entero(0, secciones.length - 1)]!;
      pilares.push({ id: `P${i}-${j}`, x, y, desde: "C", hasta: `N${np}`, seccion: s, ...(s !== "pc" && r() < 0.4 ? { giro: 90 } : {}) });
    }),
  );

  const contorno: Vec2[] = [
    [-enrasa, 0],
    ...(chaflan ? ([[X - chaflan, 0], [X, chaflan]] as Vec2[]) : ([[X, 0]] as Vec2[])),
    [X, Y + vuelo],
    [-enrasa, Y + vuelo],
  ];
  // Hueco de escalera de 2,4 × 2 m en un vano interior, con una esquina a 0,3–0,9 m de un pilar
  const huecos: Vec2[][] = [];
  if (r() < 0.6 && xs.length > 2 && ys.length > 2) {
    const i = entero(1, xs.length - 2);
    const j = entero(1, ys.length - 2);
    const [dx, dy] = [red(entre(0.3, 0.9)), red(entre(0.3, 0.9))];
    const [sx, sy] = [r() < 0.5 ? 1 : -1, r() < 0.5 ? 1 : -1];
    const a: Vec2 = [xs[i]! + sx * dx, ys[j]! + sy * dy];
    const b: Vec2 = [a[0] + sx * 2.4, a[1] + sy * 2];
    const [x0, x1, y0, y1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])];
    // Sólo si cabe en el vano sin tocar los ejes vecinos (a ≥ 0,6 m de ellos)
    if (x0 > xs[i - 1]! + 0.6 && x1 < xs[i + 1]! - 0.6 && y0 > ys[j - 1]! + 0.6 && y1 < ys[j + 1]! - 0.6 && !xs.some((x) => x > x0 - 0.3 && x < x1 + 0.3) && !ys.some((y) => y > y0 - 0.3 && y < y1 + 0.3))
      huecos.push([
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ]);
  }

  const vigas: Viga[] = [];
  const cargas: CargaFisica[] = [];
  const conVigaX = ys.map((_, j) => j === 0 || j === ys.length - 1 || r() < 0.5);
  const conVigaY = xs.map((_, i) => (i === 0 && !enrasa) || i === xs.length - 1 || r() < 0.5);
  for (const p of ids) {
    ys.forEach((y, j) => {
      // La fachada del chaflán, hasta el chaflán; la del voladizo, en su eje (la losa vuela fuera)
      if (conVigaX[j]) vigas.push({ id: `X${j}-${p}`, planta: p, puntos: [[xs[0]!, y], [j === 0 && chaflan ? X - chaflan : X, y]], seccion: "v3050" });
    });
    xs.forEach((x, i) => {
      if (conVigaY[i]) vigas.push({ id: `Y${i}-${p}`, planta: p, puntos: [[x, i === xs.length - 1 && chaflan ? chaflan : 0], [x, Y]], seccion: "v3050" });
    });
    if (chaflan) vigas.push({ id: `C-${p}`, planta: p, puntos: [[X - chaflan, 0], [X, chaflan]], seccion: "v3050" });
    cargas.push({ tipo: "superficie", id: `G-${p}`, caso: "G", planta: p, losa: `L-${p}`, q: [0, 0, -2] });
    cargas.push({ tipo: "superficie", id: `Q-${p}`, caso: "Q", planta: p, losa: `L-${p}`, q: [0, 0, -3] });
  }
  for (const q of pilares) if (q.x === 0) cargas.push({ tipo: "pilar", id: `w${q.id}`, caso: "Vx", pilar: q.id, ejes: "global", q: [2, 0, 0] });
  return {
    plantas: [...ids.map((id, k) => ({ id, altura: k === 0 ? null : 3 })), { id: "C", tipo: "sotano" as const, altura: 1.5 }],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 30 }],
    secciones: [
      { id: "p30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "p40", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 },
      { id: "p3050", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
      { id: "p2560", material: "HA", forma: "rectangular", b: 0.25, h: 0.6 },
      { id: "pc", material: "HA", forma: "circular", D: 0.4 },
      { id: "v3050", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares,
    vigas,
    losas: ids.map((p) => ({ id: `L-${p}`, planta: p, contorno, huecos, espesor: 0.25, material: "HA" })),
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }, { id: "Vx" }],
    cargas,
  };
}
