/**
 * Convergencia de la flexión de E3 frente a la solución de Navier de Mindlin (src/pruebas/navier.ts):
 * placa rectangular de 6 × 4 m simplemente apoyada («hard») con carga uniforme, isótropa delgada,
 * isótropa gruesa y ortótropa con los multiplicadores de un reticular (m11 ≠ m22, m12 y
 * v13 ≠ v23). Mallas de 0,5, 0,25 y 0,125 m; errores en w del centro, en Mx, My del centroide de
 * los 4 elementos centrales, en Mxy del elemento de la esquina y en Qx del elemento del centro del
 * borde x = 0; orden observado entre las dos mallas más finas.
 *
 * Uso: bun validacion/e3/navier.ts → validacion/e3/out_navier.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KAPPA } from "../../src/elementos/dkmq.ts";
import type { MultiplicadoresLamina } from "../../src/elementos/lamina.ts";
import { calcular } from "../../src/motor/calcular.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { Constructor } from "../../src/pruebas/constructor.ts";
import { navierMindlin, type PlacaOrtotropa } from "../../src/pruebas/navier.ts";
import { mallaRectangular } from "../../src/pruebas/placa.ts";

export interface CasoNavier {
  nombre: string;
  E: number;
  nu: number;
  t: number;
  mult: MultiplicadoresLamina;
}

export const CASOS_NAVIER: CasoNavier[] = [
  { nombre: "isótropa delgada (a/t = 100)", E: 3e7, nu: 0.2, t: 0.06, mult: {} },
  { nombre: "isótropa gruesa (a/t = 15)", E: 3e7, nu: 0.2, t: 0.4, mult: {} },
  { nombre: "ortótropa (reticular, a/t = 20)", E: 3e7, nu: 0.2, t: 0.3, mult: { m11: 1, m22: 0.3, m12: 0.2, v13: 0.5, v23: 0.15 } },
];
export const A = 6;
export const B = 4;
export const Q = -10;

export function placaNavier(c: CasoNavier): PlacaOrtotropa {
  const D = (c.E * c.t ** 3) / (12 * (1 - c.nu ** 2));
  const G = c.E / (2 * (1 + c.nu));
  const m = { m11: 1, m22: 1, m12: 1, v13: 1, v23: 1, ...c.mult };
  return {
    a: A,
    b: B,
    q: Q,
    D11: m.m11 * D,
    D22: m.m22 * D,
    D12: Math.sqrt(m.m11 * m.m22) * c.nu * D,
    D66: (m.m12 * D * (1 - c.nu)) / 2,
    K55: m.v13 * KAPPA * G * c.t,
    K44: m.v23 * KAPPA * G * c.t,
  };
}

/** Placa de A × B con malla nx × ny, apoyo «hard» (w = 0 y giro tangente nulo) y carga Q. */
export function modeloNavier(c: CasoNavier, nx: number, ny: number): { modelo: ModeloAnalitico; centro: number; laminas: number[][] } {
  const m = new Constructor();
  const g = mallaRectangular(m, { a: A, b: B, nx, ny, material: { E: c.E, nu: c.nu, t: c.t }, lamina: { multiplicadores: c.mult } });
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const bx = i === 0 || i === nx;
      const by = j === 0 || j === ny;
      // membrana fuera; en x = 0, a: w = 0 y θx = 0; en y = 0, b: w = 0 y θy = 0
      m.apoyo(g.nudos[i]![j]!, [true, true, bx || by, bx, by, true]);
    }
  }
  m.caso("q", [], [], [], g.laminas.flat().map((l) => ({ tipo: "superficie", lamina: l, ejes: "global", q: [0, 0, Q] })));
  return { modelo: m.modelo(), centro: g.nudos[nx / 2]![ny / 2]!, laminas: g.laminas };
}

/** Errores relativos de una malla: w centro, Mx y My centrales, Mxy de esquina y Qx de borde. */
export function erroresNavier(c: CasoNavier, h: number) {
  const nx = Math.round(A / h);
  const ny = Math.round(B / h);
  const { modelo, centro, laminas } = modeloNavier(c, nx, ny);
  const [r] = casosValidos(calcular(modelo));
  const p = placaNavier(c);
  const s = (i: number, j: number) => r!.esfuerzosLaminas.subarray(8 * laminas[i]![j]!, 8 * laminas[i]![j]! + 8);
  const ref = (i: number, j: number) => navierMindlin(p, (i + 0.5) * h, (j + 0.5) * h);
  const w0 = navierMindlin(p, A / 2, B / 2)[0];
  const ew = r!.u[6 * centro + 2]! / w0 - 1;
  let eMx = 0;
  let eMy = 0;
  for (const [i, j] of [
    [nx / 2 - 1, ny / 2 - 1],
    [nx / 2, ny / 2 - 1],
    [nx / 2 - 1, ny / 2],
    [nx / 2, ny / 2],
  ] as const) {
    const e = ref(i, j);
    eMx = Math.max(eMx, Math.abs(s(i, j)[3]! / e[1] - 1));
    eMy = Math.max(eMy, Math.abs(s(i, j)[4]! / e[2] - 1));
  }
  const eMxy = s(0, 0)[5]! / ref(0, 0)[3] - 1;
  const eQx = s(0, ny / 2)[6]! / ref(0, ny / 2)[4] - 1;
  return { h, ew, eMx, eMy, eMxy, eQx, w: r!.u[6 * centro + 2]!, w0 };
}

if (import.meta.main) {
  const raiz = join(import.meta.dirname, "..", "..");
  await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const lineas: string[] = [`# validacion/e3/navier.ts — ${new Date().toLocaleDateString("sv-SE")}: placa ${A} × ${B} m apoyada («hard»), q = ${Q} kN/m²; errores relativos frente a Navier (Mindlin)`];
  const pct = (v: number) => `${(100 * v).toFixed(3).padStart(8)} %`;
  for (const c of CASOS_NAVIER) {
    lineas.push(`\n## ${c.nombre}: multiplicadores ${JSON.stringify(c.mult)}`);
    lineas.push(`h (m)  | w centro   | Mx centro  | My centro  | Mxy esquina | Qx borde`);
    const filas = [0.5, 0.25, 0.125].map((h) => erroresNavier(c, h));
    for (const f of filas) lineas.push(`${f.h.toFixed(3)}  | ${pct(f.ew)} | ${pct(f.eMx)} | ${pct(f.eMy)} | ${pct(f.eMxy)} | ${pct(f.eQx)}`);
    const orden = (k: "ew" | "eMx" | "eMy" | "eMxy" | "eQx") => Math.log2(Math.abs(filas[1]![k] / filas[2]![k]));
    lineas.push(`orden  | ${orden("ew").toFixed(2).padStart(10)} | ${orden("eMx").toFixed(2).padStart(10)} | ${orden("eMy").toFixed(2).padStart(10)} | ${orden("eMxy").toFixed(2).padStart(11)} | ${orden("eQx").toFixed(2).padStart(8)}`);
    lineas.push(`w Navier = ${filas[0]!.w0.toExponential(6)} m`);
  }
  const texto = lineas.join("\n");
  console.log(texto);
  writeFileSync(join(import.meta.dirname, "out_navier.txt"), texto + "\n");
}
