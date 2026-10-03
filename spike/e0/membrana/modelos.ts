/**
 * Modelos del criterio 2 del spike E0, construidos con la lámina del motor (DKMQ + membrana con
 * drilling) y resueltos con el núcleo WASM. Son los mismos de oraculo_opensees.py.
 */
import { rigidezBarraGlobal, rigidezBarraLocal, marcoBarra, type SeccionBarra } from "../../../src/elementos/barra.ts";
import type { MaterialLamina } from "../../../src/elementos/dkmq.ts";
import { marcoLocal, rigidezAGlobales, rigidezLaminaLocal } from "../../../src/elementos/lamina.ts";
import type { OpcionesMembrana } from "../../../src/elementos/membrana.ts";
import { ModeloPrueba } from "../../../src/pruebas/ensamblador.ts";

const gdl6 = (v: number) => [0, 1, 2, 3, 4, 5].map((c) => 6 * v + c);

/** Rigidez local 24×24 de la lámina; por defecto la del motor. La exploración pasa sus variantes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FabricaLamina = (xy: ArrayLike<number>, mat: MaterialLamina, op: any) => Float64Array;

/** Malla de láminas en el plano XY: nudos (i, j) con i en x (0..nx) y j en y (0..ny). */
function malla(coords: (i: number, j: number) => [number, number], nx: number, ny: number, mat: MaterialLamina, op: OpcionesMembrana, lamina: FabricaLamina, extra = 0) {
  const tag = (i: number, j: number) => i * (ny + 1) + j;
  const nudos: number[] = [];
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) nudos.push(...coords(i, j), 0);
  const nn = (nx + 1) * (ny + 1) + extra;
  const modelo = new ModeloPrueba(6 * nn);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const q = [tag(i, j), tag(i + 1, j), tag(i + 1, j + 1), tag(i, j + 1)];
      const marco = marcoLocal(q.flatMap((v) => nudos.slice(3 * v, 3 * v + 3)));
      modelo.sumarRigidez(q.flatMap(gdl6), rigidezAGlobales(lamina(marco.xy, mat, op), marco.R));
    }
  }
  return { modelo, tag, nudos };
}

export const MURO = { H: 9, B: 3, t: 0.25, E: 3e7, nu: 0.2, P: 100 };

/** Muro en voladizo (H17): desplazamiento medio de la cabeza, m. */
export function muro(nx: number, ny: number, op: OpcionesMembrana = {}, lamina: FabricaLamina = rigidezLaminaLocal): number {
  const { H, B, t, E, nu, P } = MURO;
  const { modelo, tag } = malla((i, j) => [(B * i) / nx, (H * j) / ny], nx, ny, { E, nu, t }, op, lamina);
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const v = tag(i, j);
      for (const c of [2, 3, 4]) modelo.coartar(6 * v + c);
      if (j === 0) for (const c of [0, 1, 5]) modelo.coartar(6 * v + c);
    }
    modelo.cargas[6 * tag(i, ny)] = (P * (i === 0 || i === nx ? 0.5 : 1)) / nx;
  }
  const { u } = modelo.resolver();
  let s = 0;
  for (let i = 0; i <= nx; i++) s += u[6 * tag(i, ny)]!;
  return s / (nx + 1);
}

export const MH = { E: 1e7, nu: 0.3, t: 0.1 };

/** Viga recta de MacNeal–Harder (6 × 0,2): flecha media de la punta. */
export function macnealHarder(
  forma: "rectangular" | "trapezoidal" | "paralelogramo",
  carga: "cortante" | "momento",
  op: OpcionesMembrana = {},
  lamina: FabricaLamina = rigidezLaminaLocal,
): number {
  const abajo: [number, number][] = [];
  const arriba: [number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const interior = i > 0 && i < 6;
    if (forma === "rectangular") {
      abajo.push([i, 0]);
      arriba.push([i, 0.2]);
    } else if (forma === "trapezoidal") {
      abajo.push([interior ? i + (i % 2 ? -0.1 : 0.1) : i, 0]);
      arriba.push([interior ? i + (i % 2 ? 0.1 : -0.1) : i, 0.2]);
    } else {
      abajo.push([i, 0]);
      arriba.push([interior ? i + 0.2 : i, 0.2]);
    }
  }
  const { modelo, tag } = malla((i, j) => (j === 0 ? abajo[i]! : arriba[i]!), 6, 1, { ...MH }, op, lamina);
  for (let i = 0; i <= 6; i++) {
    for (let j = 0; j <= 1; j++) {
      const v = tag(i, j);
      for (const c of [2, 3, 4]) modelo.coartar(6 * v + c);
      if (i === 0) for (const c of [0, 1, 5]) modelo.coartar(6 * v + c);
    }
  }
  if (carga === "cortante") {
    modelo.cargas[6 * tag(6, 0) + 1] = 0.5;
    modelo.cargas[6 * tag(6, 1) + 1] = 0.5;
  } else {
    modelo.cargas[6 * tag(6, 0)] = 5;
    modelo.cargas[6 * tag(6, 1)] = -5;
  }
  const { u } = modelo.resolver();
  return 0.5 * (u[6 * tag(6, 0) + 1]! + u[6 * tag(6, 1) + 1]!);
}

export const VIGA = { W: 3, Hm: 3, t: 0.25, E: 3e7, nu: 0.2, b: 0.3, h: 0.5, L: 3, P: 50 };

/**
 * Muro 3×3 con la base empotrada y viga en voladizo en su plano (H05). `embebida`: elementos que la
 * viga se prolonga dentro del muro por la fila de nudos (0 = unida en un nudo, por el drilling).
 */
export function vigaEnMuro(n: number, embebida: number, op: OpcionesMembrana = {}, lamina: FabricaLamina = rigidezLaminaLocal) {
  const { W, Hm, t, E, nu, b, h, L, P } = VIGA;
  const { modelo, tag, nudos } = malla((i, j) => [(W * i) / n, (Hm * j) / n], n, n, { E, nu, t }, op, lamina, 1);
  const punta = (n + 1) * (n + 1);
  nudos.push(W + L, Hm / 2, 0);
  const jm = n / 2;
  const sec: SeccionBarra = { E, G: E / (2 * (1 + nu)), A: b * h, Iz: (b * h ** 3) / 12, Iy: (h * b ** 3) / 12, J: 3e-3 };
  const barra = (vi: number, vj: number) => {
    const { R, L: l } = marcoBarra(nudos.slice(3 * vi, 3 * vi + 3), nudos.slice(3 * vj, 3 * vj + 3), [0, 0, 1]);
    modelo.sumarRigidez([...gdl6(vi), ...gdl6(vj)], rigidezBarraGlobal(rigidezBarraLocal(l, sec), R));
  };
  barra(tag(n, jm), punta);
  for (let k = 0; k < embebida; k++) barra(tag(n - k - 1, jm), tag(n - k, jm));
  for (let i = 0; i <= n; i++) for (let c = 0; c < 6; c++) modelo.coartar(6 * tag(i, 0) + c);
  modelo.cargas[6 * punta + 1] = -P;
  const { u, reacciones } = modelo.resolver();
  const eq = modelo.equilibrio(nudos, reacciones);
  return { punta: -u[6 * punta + 1]!, raiz: -u[6 * tag(n, jm) + 1]!, giroRaiz: u[6 * tag(n, jm) + 5]!, equilibrio: eq };
}
