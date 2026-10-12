/**
 * Edificios de planta no ortogonal para probar el compilador fuera de la retícula: rombo, planta
 * circular con vigas curvas, abanico, dos alas en ángulo y planta triangular con una esquina aguda.
 * Todos con losa maciza a ejes de los pilares de borde, vigas por las alineaciones, peso propio,
 * sobrecarga y viento. Las vigas curvas son polilíneas con los mismos vértices que el borde de la
 * losa. No es código del compilador.
 */
import type { CargaFisica, ModeloFisico, Pilar, Vec2, Viga } from "../compilador/fisico.ts";

export type Familia = "rombo" | "circular" | "abanico" | "alas" | "triangular";
export const FAMILIAS: readonly Familia[] = ["rombo", "circular", "abanico", "alas", "triangular"];

export interface OpcionesGeometria {
  /** Plantas sobre la cimentación. Por defecto, 2. */
  plantas?: number;
  /** Giro de toda la planta, en grados. Por defecto, 0. */
  giro?: number;
  /** Pilares circulares (D = 0,45) en lugar de rectangulares. */
  circulares?: boolean;
  /** Un hueco de escalera en un vano interior. */
  hueco?: boolean;
}

interface Planta2D {
  pilares: { id: string; p: Vec2; giro: number }[];
  vigas: Vec2[][];
  contorno: Vec2[];
  huecos: Vec2[][];
}

const R = (deg: number) => (deg * Math.PI) / 180;
const arco = (c: Vec2, r: number, a0: number, a1: number, n: number): Vec2[] =>
  Array.from({ length: n + 1 }, (_, k) => {
    const a = R(a0 + ((a1 - a0) * k) / n);
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as Vec2;
  });
/** Punto a la distancia r de c, en la dirección a (grados). */
const polar = (c: Vec2, r: number, a: number): Vec2 => [c[0] + r * Math.cos(R(a)), c[1] + r * Math.sin(R(a))];
const sumar = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const escalar = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
/** Hueco de 2,4 × 2 m, alineado con u y v, con su esquina en o + 1·(u + v) (u y v unitarios). */
const huecoEn = (o: Vec2, u: Vec2, v: Vec2): Vec2[] => {
  const a = sumar(o, sumar(u, v));
  return [a, sumar(a, escalar(u, 2.4)), sumar(sumar(a, escalar(u, 2.4)), escalar(v, 2)), sumar(a, escalar(v, 2))];
};

/** Rombo: retícula de 4 × 3 vanos con las alineaciones a 60°. */
function rombo(o: OpcionesGeometria): Planta2D {
  const u: Vec2 = [6, 0];
  const v: Vec2 = escalar([Math.cos(R(60)), Math.sin(R(60))], 5.5);
  const P = (i: number, j: number) => sumar(escalar(u, i), escalar(v, j));
  const pilares = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 3; j++) pilares.push({ id: `P${i}-${j}`, p: P(i, j), giro: (i + j) % 2 ? 60 : 0 });
  const vigas: Vec2[][] = [];
  for (let j = 0; j <= 3; j++) vigas.push([P(0, j), P(4, j)]);
  for (let i = 0; i <= 4; i++) vigas.push([P(i, 0), P(i, 3)]);
  const huecos = o.hueco ? [huecoEn(P(2, 1), [1, 0], [Math.cos(R(60)), Math.sin(R(60))])] : [];
  return { pilares, vigas, contorno: [P(0, 0), P(4, 0), P(4, 3), P(0, 3)], huecos };
}

/** Planta circular de 12 m de radio: pilar central, anillos de 6 y 12 m y vigas radiales y curvas. */
function circular(o: OpcionesGeometria): Planta2D {
  const c: Vec2 = [0, 0];
  const pilares = [{ id: "P0", p: c, giro: 0 }];
  const vigas: Vec2[][] = [];
  const nAnillo = [8, 16];
  [6, 12].forEach((r, k) => {
    const n = nAnillo[k]!;
    for (let s = 0; s < n; s++) pilares.push({ id: `P${k + 1}-${s}`, p: polar(c, r, (360 * s) / n), giro: (360 * s) / n });
    // Viga curva por el anillo: 4 tramos rectos por vano (el borde de la losa usa los mismos vértices)
    vigas.push(arco(c, r, 0, 360, 4 * n));
  });
  for (let s = 0; s < 8; s++) vigas.push([c, polar(c, 12, 45 * s)]);
  const contorno = arco(c, 12, 0, 360, 64).slice(0, 64);
  const huecos = o.hueco ? [huecoEn(polar(c, 6, 22.5), [1, 0], [0, 1])] : [];
  return { pilares, vigas, contorno, huecos };
}

/** Abanico de 90°: radios de 6 a 24 m, 4 sectores de 22,5°, fachadas curvas. */
function abanico(o: OpcionesGeometria): Planta2D {
  const c: Vec2 = [0, 0];
  const radios = [6, 12, 18, 24];
  const pilares = [];
  const vigas: Vec2[][] = [];
  for (const r of radios) {
    for (let s = 0; s <= 4; s++) pilares.push({ id: `P${r}-${s}`, p: polar(c, r, 22.5 * s), giro: 22.5 * s });
    vigas.push(arco(c, r, 0, 90, 4 * Math.max(2, r / 6)));
  }
  for (let s = 0; s <= 4; s++) vigas.push([polar(c, 6, 22.5 * s), polar(c, 24, 22.5 * s)]);
  const exterior = arco(c, 24, 0, 90, 16);
  const interior = arco(c, 6, 90, 0, 8);
  const huecos = o.hueco ? [huecoEn(polar(c, 12, 45), [Math.cos(R(45)), Math.sin(R(45))], [-Math.sin(R(45)), Math.cos(R(45))])] : [];
  return { pilares, vigas, contorno: [...exterior, ...interior.slice(0, -1)], huecos };
}

/**
 * Dos alas: un bloque ortogonal de 3 × 2 vanos (6 × 5 m) y otro igual girado −30° alrededor de su
 * esquina común (18, 0), con una cuña triangular entre los dos.
 */
function alas(o: OpcionesGeometria): Planta2D {
  const A = (i: number, j: number): Vec2 => [6 * i, 5 * j];
  const g = R(-30);
  const [eu, ev]: [Vec2, Vec2] = [
    [Math.cos(g), Math.sin(g)],
    [-Math.sin(g), Math.cos(g)],
  ];
  const B = (i: number, j: number): Vec2 => sumar([18, 0], sumar(escalar(eu, 6 * i), escalar(ev, 5 * j)));
  const pilares = [];
  for (let i = 0; i <= 3; i++) for (let j = 0; j <= 2; j++) pilares.push({ id: `A${i}-${j}`, p: A(i, j), giro: 0 });
  for (let i = 0; i <= 3; i++) for (let j = i === 0 ? 1 : 0; j <= 2; j++) pilares.push({ id: `B${i}-${j}`, p: B(i, j), giro: -30 });
  const vigas: Vec2[][] = [];
  for (let j = 0; j <= 2; j++) vigas.push([A(0, j), A(3, j)], [B(0, j), B(3, j)]);
  for (let i = 0; i <= 3; i++) vigas.push([A(i, 0), A(i, 2)]);
  for (let i = 1; i <= 3; i++) vigas.push([B(i, 0), B(i, 2)]);
  vigas.push([B(0, 0), B(0, 2)]);
  const contorno: Vec2[] = [A(0, 0), A(3, 0), B(3, 0), B(3, 2), B(0, 2), A(3, 2), A(0, 2)];
  const huecos = o.hueco ? [huecoEn(A(1, 0), [1, 0], [0, 1])] : [];
  return { pilares, vigas, contorno, huecos };
}

/** Triángulo de 30 × 14 m: esquina de 25° en el origen, pilares cada 6 m en x y 5 m en y. */
function triangular(o: OpcionesGeometria): Planta2D {
  const yh = (x: number) => (14 * x) / 30;
  const pilares = [];
  const vigas: Vec2[][] = [];
  for (let i = 0; i <= 5; i++) {
    const x = 6 * i;
    const ys = [0, 5, 10].filter((y) => y < yh(x) - 1);
    for (const y of ys) pilares.push({ id: `P${i}-${y}`, p: [x, y] as Vec2, giro: 0 });
    if (i > 0) pilares.push({ id: `P${i}-h`, p: [x, yh(x)] as Vec2, giro: (Math.atan2(14, 30) * 180) / Math.PI });
    if (i > 0) vigas.push([[x, 0], [x, yh(x)]]);
  }
  vigas.push([[0, 0], [30, 0]], [[0, 0], [30, 14]]);
  for (const y of [5, 10]) vigas.push([[(30 * y) / 14, y], [30, y]]);
  const huecos = o.hueco ? [huecoEn([18, 0], [1, 0], [0, 1])] : [];
  return { pilares, vigas, contorno: [[0, 0], [30, 0], [30, 14]], huecos };
}

const PLANTAS: Record<Familia, (o: OpcionesGeometria) => Planta2D> = { rombo, circular, abanico, alas, triangular };

export function edificioGeometria(familia: Familia, o: OpcionesGeometria = {}): ModeloFisico {
  const n = o.plantas ?? 2;
  const pl = PLANTAS[familia](o);
  const g = R(o.giro ?? 0);
  const girar = (p: Vec2): Vec2 => [p[0] * Math.cos(g) - p[1] * Math.sin(g), p[0] * Math.sin(g) + p[1] * Math.cos(g)];
  const ids = Array.from({ length: n }, (_, k) => `N${n - k}`);
  const pilares: Pilar[] = pl.pilares.map((q, k) => {
    const [x, y] = girar(q.p);
    return { id: q.id, x, y, desde: "C", hasta: `N${n}`, seccion: o.circulares ? "pc" : k % 2 ? "p40" : "p3050", giro: q.giro + (o.giro ?? 0) };
  });
  const vigas: Viga[] = [];
  const cargas: CargaFisica[] = [];
  for (const p of ids) {
    pl.vigas.forEach((v, k) => vigas.push({ id: `V${k}-${p}`, planta: p, puntos: v.map(girar), seccion: "v3060" }));
    cargas.push({ tipo: "superficie", id: `G-${p}`, caso: "G", planta: p, losa: `L-${p}`, q: [0, 0, -2] });
    cargas.push({ tipo: "superficie", id: `Q-${p}`, caso: "Q", planta: p, losa: `L-${p}`, q: [0, 0, -3] });
  }
  for (const q of pilares) cargas.push({ tipo: "pilar", id: `w${q.id}`, caso: "Vx", pilar: q.id, ejes: "global", q: [1, 0, 0] });
  return {
    plantas: [...ids.map((id, k) => ({ id, altura: k === 0 ? null : 3 })), { id: "C", tipo: "sotano" as const, altura: 1.5 }],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 30 }],
    secciones: [
      { id: "p3050", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
      { id: "p40", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 },
      { id: "pc", material: "HA", forma: "circular", D: 0.45 },
      { id: "v3060", material: "HA", forma: "rectangular", b: 0.3, h: 0.6 },
    ],
    pilares,
    vigas,
    losas: ids.map((p) => ({ id: `L-${p}`, planta: p, contorno: pl.contorno.map(girar), huecos: pl.huecos.map((h) => h.map(girar)), espesor: 0.25, material: "HA", eje1: o.giro ?? 0 })),
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }, { id: "Vx" }],
    cargas,
  };
}

