/**
 * Criterio 3 de E5: Q y M recuperados por SPR (src/motor/campos.ts) frente a soluciones cerradas.
 *
 * 1. Réplica de exp01d (H18, S5 #3): placa cuadrada de lado 1 simplemente apoyada («hard») con carga
 *    uniforme, a/t = 10, 25, 40 y 100, mallas de 8, 16 y 32. Qx en el centroide del elemento junto
 *    al borde (x = h/2) y en el de x ≈ a/4, en la fila central: el de la DKMQ (el de H18) y el
 *    recuperado. Referencia: Navier de Mindlin (src/pruebas/navier.ts).
 * 2. Placas de Navier de E3 (6 × 4 m: isótropa delgada, gruesa y ortótropa de reticular) con
 *    mallas de 0,5, 0,25 y 0,125 m: M en el nudo central, Mxy en la esquina, Qx en el centro del
 *    borde x = 0 y en x = a/4, y Qy en el centro del borde y = 0, en los nudos.
 *
 * Uso: bun validacion/e5/spr.ts → validacion/e5/out_spr.txt
 *      bun validacion/e5/spr.ts --comparar → out_spr_variantes.txt (muestreo y base del SPR, E5-2)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KAPPA } from "../../src/elementos/dkmq.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { CamposLaminas, type OpcionesCampos } from "../../src/motor/campos.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { Constructor } from "../../src/pruebas/constructor.ts";
import { navierMindlin, type PlacaOrtotropa } from "../../src/pruebas/navier.ts";
import { mallaRectangular } from "../../src/pruebas/placa.ts";
import type { MultiplicadoresLamina } from "../../src/elementos/lamina.ts";
import type { ModeloAnalitico, Vec3 } from "../../src/motor/modelo.ts";
import { girarModelo, invertirLaminas, matrizGiro, permutacion, renumerarModelo } from "../../src/pruebas/transformar.ts";
import { fijarEjes, laminaPlegada } from "../e3/metamorficas.ts";
import { A, B, CASOS_NAVIER, modeloNavier, placaNavier, type CasoNavier } from "../e3/navier.ts";
import { modeloParcheMacNealHarder } from "../e3/parche.ts";

const E = 3e7;
const NU = 0.2;
const QC = -10;

/** Placa cuadrada de lado a, apoyo «hard», carga uniforme: el modelo de exp01d en kN–m. */
function placaCuadrada(n: number, a: number, t: number) {
  const m = new Constructor();
  const g = mallaRectangular(m, { a, b: a, nx: n, ny: n, material: { E, nu: NU, t } });
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const bx = i === 0 || i === n;
      const by = j === 0 || j === n;
      m.apoyo(g.nudos[i]![j]!, [true, true, bx || by, bx, by, true]);
    }
  }
  m.caso("q", [], [], [], g.laminas.flat().map((l) => ({ tipo: "superficie" as const, lamina: l, ejes: "global" as const, q: [0, 0, QC] as const })));
  const D = (E * t ** 3) / (12 * (1 - NU * NU));
  const G = E / (2 * (1 + NU));
  const placa: PlacaOrtotropa = { a, b: a, q: QC, D11: D, D22: D, D12: NU * D, D66: (D * (1 - NU)) / 2, K55: KAPPA * G * t, K44: KAPPA * G * t };
  return { modelo: m.modelo(), laminas: g.laminas, placa };
}

/** Errores relativos de Qx (DKMQ y SPR) en los centroides de exp01d: [DKMQ borde, DKMQ a/4, SPR borde, SPR a/4]. */
export function cortanteExp01d(aSobreT: number, n: number, op: OpcionesCampos = {}): number[] {
  const a = 1;
  const { modelo, laminas, placa } = placaCuadrada(n, a, a / aSobreT);
  const [r] = casosValidos(calcular(modelo));
  const campos = new CamposLaminas(modelo, op);
  const h = a / n;
  const c = n / 2;
  const out: number[] = [];
  const filas = [0, n / 4];
  const refs = filas.map((i) => navierMindlin(placa, (i + 0.5) * h, (c + 0.5) * h)[4]);
  filas.forEach((i, s) => out.push(r!.esfuerzosLaminas[8 * laminas[i]![c]! + 6]! / refs[s]! - 1));
  filas.forEach((i, s) => out.push(campos.en(laminas[i]![c]!, r!.u, 0, 0)[6]! / refs[s]! - 1));
  return out;
}

/** Errores en los nudos de una placa de Navier de E3 con malla h. */
export function erroresSprNavier(c: CasoNavier, h: number, op: OpcionesCampos = {}) {
  const nx = Math.round(A / h);
  const ny = Math.round(B / h);
  const { modelo, laminas } = modeloNavier(c, nx, ny);
  const [r] = casosValidos(calcular(modelo));
  const p = placaNavier(c);
  const campos = new CamposLaminas(modelo, op);
  // Nudo (i, j): esquina 1 de la lámina (i, j) o esquina 2/3/4 de sus vecinas en el borde superior
  const nodal = (i: number, j: number) => {
    const li = Math.min(i, nx - 1);
    const lj = Math.min(j, ny - 1);
    const xi = i === li ? -1 : 1;
    const eta = j === lj ? -1 : 1;
    return campos.en(laminas[li]![lj]!, r!.u, xi, eta);
  };
  const centro = nodal(nx / 2, ny / 2);
  const ref = navierMindlin(p, A / 2, B / 2);
  const esquina = nodal(0, 0);
  const refEsq = navierMindlin(p, 0, 0);
  const borde = nodal(0, ny / 2);
  const refBorde = navierMindlin(p, 0, B / 2);
  const cuarto = nodal(nx / 4, ny / 2);
  const refCuarto = navierMindlin(p, A / 4, B / 2);
  const bordeY = nodal(nx / 2, 0);
  const refBordeY = navierMindlin(p, A / 2, 0);
  return {
    eMx: centro[3]! / ref[1] - 1,
    eMy: centro[4]! / ref[2] - 1,
    eMxy: esquina[5]! / refEsq[3] - 1,
    eQx: borde[6]! / refBorde[4] - 1,
    eQx4: (cuarto[6]! - refCuarto[4]) / refBorde[4],
    eQy: bordeY[7]! / refBordeY[5] - 1,
  };
}

/**
 * Patch test de MacNeal–Harder (5 cuadriláteros irregulares, campo de N y M constante): los valores
 * recuperados en los nudos de cada lámina = su resultante del centroide (exacta, E3). Devuelve los
 * errores de N y M (relativos) y de Q (frente a M/L).
 */
export function errorParcheSpr(mult: MultiplicadoresLamina = {}, angulo?: number): { N: number; M: number; Q: number } {
  const modelo = modeloParcheMacNealHarder(mult, angulo);
  const [r] = casosValidos(calcular(modelo));
  const campos = new CamposLaminas(modelo);
  const e = { N: 0, M: 0, Q: 0 };
  const ref = r!.esfuerzosLaminas;
  const max = (a: ArrayLike<number>, o: number, n: number) => Math.max(...Array.from({ length: n }, (_, i) => Math.abs(a[o + i]!)));
  const escN = max(ref, 0, 3);
  const escM = max(ref, 3, 3);
  for (let l = 0; l < modelo.laminas!.length; l++) {
    const v = campos.enNudos(l, r!.u);
    for (let a = 0; a < 4; a++) {
      for (let c = 0; c < 3; c++) e.N = Math.max(e.N, Math.abs(v[8 * a + c]! - ref[8 * l + c]!) / escN);
      for (let c = 3; c < 6; c++) e.M = Math.max(e.M, Math.abs(v[8 * a + c]! - ref[8 * l + c]!) / escM);
      for (let c = 6; c < 8; c++) e.Q = Math.max(e.Q, Math.abs(v[8 * a + c]!) / (escM / 0.24));
    }
  }
  return e;
}

/**
 * Ménsula de 4 × 1 con ν = 0 y una carga de línea F en la punta, malla nx × ny: Mx = −F(L − x) y
 * Qx = −F son exactos en la DKMQ (E3) y lineales, así que el SPR cuadrático tiene que darlos en
 * todos los nudos, también en los del borde. Devuelve el peor error relativo (frente a F·L y F).
 */
export function errorMensulaSpr(nx = 8, ny = 2): number {
  const [L, b, F] = [4, 1, 3];
  const m = new Constructor();
  const g = mallaRectangular(m, { a: L, b, nx, ny, material: { E: 3e7, nu: 0, t: 0.2 } });
  for (let j = 0; j <= ny; j++) m.apoyo(g.nudos[0]![j]!);
  m.caso("punta", [], [], [], g.laminas[nx - 1]!.map((l, j) => ({ tipo: "linea" as const, lamina: l, ejes: "global" as const, a: g.punto(L, (j * b) / ny), b: g.punto(L, ((j + 1) * b) / ny), qa: [0, 0, -F] as const })));
  const modelo = m.modelo();
  const [r] = casosValidos(calcular(modelo));
  const campos = new CamposLaminas(modelo);
  let e = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const v = campos.enNudos(g.laminas[i]![j]!, r!.u);
      [i, i + 1, i + 1, i].forEach((ia, a) => {
        const x = (ia * L) / nx;
        e = Math.max(e, Math.abs(v[8 * a + 3]! + F * (L - x)) / (F * L), Math.abs(v[8 * a + 6]! + F) / F);
        for (const c of [4, 5, 7]) e = Math.max(e, Math.abs(v[8 * a + c]!) / (c === 7 ? F : F * L));
      });
    }
  }
  return e;
}

/** Valores recuperados por (lámina, nudo global): «l,v» → 8 valores en los ejes de la lámina. */
function camposPorNudo(modelo: ModeloAnalitico): Map<string, Float64Array> {
  const [r] = casosValidos(calcular(modelo));
  const campos = new CamposLaminas(modelo);
  const out = new Map<string, Float64Array>();
  modelo.laminas!.forEach((l, k) => {
    if (campos.region(k) < 0) return;
    const v = campos.enNudos(k, r!.u);
    l.nudos.forEach((n, a) => out.set(`${k},${n}`, v.slice(8 * a, 8 * a + 8)));
  });
  return out;
}

/** max|a − b| por grupos (N, M, Q) entre la escala de cada grupo. */
function errorGrupos(pares: [ArrayLike<number>, ArrayLike<number>][]): number {
  const dif = [0, 0, 0];
  const esc = [0, 0, 0];
  for (const [a, b] of pares) {
    for (let c = 0; c < 8; c++) {
      const g = c < 3 ? 0 : c < 6 ? 1 : 2;
      dif[g] = Math.max(dif[g]!, Math.abs(a[c]! - b[c]!));
      esc[g] = Math.max(esc[g]!, Math.abs(b[c]!));
    }
  }
  // Escala mínima de cada grupo: 1e-6 de la de M, para no dividir ruido entre ruido
  return Math.max(...dif.map((d, g) => d / Math.max(esc[g]!, 1e-6 * esc[1]!)));
}

/**
 * Pruebas metamórficas de los campos recuperados: giro y traslación del modelo (con los ejes de las
 * láminas fijados), renumeración de nudos y láminas (con cambio del nudo inicial) e inversión del
 * orden de los nudos (con los cambios de signo de la cabecera): [giro, renumeración, inversión].
 */
export function erroresMetamorficosCampos(fabrica: () => ModeloAnalitico, R: number[] | null): number[] {
  const m = fabrica();
  const ref = camposPorNudo(m);
  const nl = m.laminas!.length;
  let giro = Number.NaN;
  if (R) {
    const g = camposPorNudo(girarModelo(fijarEjes(m), R, [12.3, -4.5, 2] as Vec3));
    giro = errorGrupos([...ref].map(([k, v]) => [g.get(k)!, v]));
  }
  const nuevo = permutacion(m.nudos.length, 777);
  const rn = camposPorNudo(renumerarModelo(m, nuevo));
  const ren = errorGrupos(
    [...ref].map(([k, v]) => {
      const [l, n] = k.split(",").map(Number);
      return [rn.get(`${nl - 1 - l!},${nuevo[n!]}`)!, v];
    }),
  );
  const inv = invertirLaminas(m);
  const ri = camposPorNudo(inv.modelo);
  const invertida = errorGrupos(
    [...ref].map(([k, v]) => {
      const s = inv.signos(Number(k.split(",")[0]));
      return [ri.get(k)!, v.map((x, c) => s[c]! * x)];
    }),
  );
  return [giro, ren, invertida];
}

/**
 * Ejes mezclados en una región isótropa: la placa de Navier delgada con la mitad de las láminas con
 * el eje 1 girado θ. Siguen en la misma región y sus valores, girados a X, coinciden con los de la
 * placa sin girar.
 */
export function errorEjesMezclados(theta = 37): number {
  const base = modeloNavier(CASOS_NAVIER[0]!, 12, 8);
  const t = (theta * Math.PI) / 180;
  const girada: ModeloAnalitico = { ...base.modelo, laminas: base.modelo.laminas!.map((l, k) => (k % 2 ? { ...l, eje1: [Math.cos(t), Math.sin(t), 0] as Vec3 } : l)) };
  const a = camposPorNudo(base.modelo);
  const b = camposPorNudo(girada);
  const [C, S] = [Math.cos(t), Math.sin(t)];
  // De los ejes girados a X, Y: T = G·T'·Gᵀ con G = [[C, −S], [S, C]]; Q = G·Q'
  const aX = (v: ArrayLike<number>) => {
    const ten = (xx: number, yy: number, xy: number) => [C * C * xx + S * S * yy - 2 * C * S * xy, S * S * xx + C * C * yy + 2 * C * S * xy, C * S * (xx - yy) + (C * C - S * S) * xy];
    return [...ten(v[0]!, v[1]!, v[2]!), ...ten(v[3]!, v[4]!, v[5]!), C * v[6]! - S * v[7]!, S * v[6]! + C * v[7]!];
  };
  return errorGrupos([...a].map(([k, v]) => [Number(k.split(",")[0]) % 2 ? aX(b.get(k)!) : b.get(k)!, v]));
}

export const MODELOS_METAMORFICOS_CAMPOS: [string, () => ModeloAnalitico, number[] | null][] = [
  ["lámina plegada", laminaPlegada, matrizGiro([0.3, -0.5, 0.8], 1.1)],
  ["placa de Navier ortótropa", () => modeloNavier(CASOS_NAVIER[2]!, 12, 8).modelo, null],
];

const pct = (v: number) => `${(100 * v >= 0 ? "+" : "") + (100 * v).toFixed(2)} %`.padStart(10);

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const lineas: string[] = [];
  const log = (s = "") => {
    console.log(s);
    lineas.push(s);
  };
  const comparar = process.argv.includes("--comparar");
  const variantes: [string, OpcionesCampos][] = comparar
    ? [["centroides, cuadrática", {}], ["puntos de Gauss, cuadrática", { muestreo: "gauss" }], ["puntos de Gauss, bilineal", { muestreo: "gauss", base: "bilineal" }], ["centroides, bilineal", { base: "bilineal" }]]
    : [["centroides, cuadrática", {}]];
  log("# Criterio 3 de E5: Q y M recuperados por SPR");
  log();
  log("## 1. Réplica de exp01d (H18, S5 #3): Qx en los centroides, placa cuadrada de lado 1");
  log("Error relativo frente a Navier (Mindlin) en el elemento junto al borde (x = h/2) y en el de x ≈ a/4.");
  for (const [nombre, op] of variantes) {
    log();
    log(`SPR: ${nombre}`);
    log(`| a/t | malla | h/t | DKMQ borde | DKMQ a/4 | SPR borde | SPR a/4 |`);
    log(`|---|---|---|---|---|---|---|`);
    for (const at of [10, 25, 40, 100]) {
      for (const n of [8, 16, 32]) {
        const e = cortanteExp01d(at, n, op);
        log(`| ${at} | ${n} | ${(at / n).toFixed(2)} | ${e.map(pct).join(" | ")} |`);
      }
    }
  }
  log();
  log("## 2. Placas de Navier de E3 (6 × 4 m), valores nodales recuperados");
  for (const [nombre, op] of variantes) {
    for (const c of CASOS_NAVIER) {
      log();
      log(`${c.nombre}; SPR: ${nombre}`);
      log(`| h | Mx centro | My centro | Mxy esquina | Qx borde | Qx a/4 (÷ Qx borde) | Qy borde |`);
      log(`|---|---|---|---|---|---|---|`);
      for (const h of [0.5, 0.25, 0.125]) {
        const e = erroresSprNavier(c, h, op);
        log(`| ${h} | ${[e.eMx, e.eMy, e.eMxy, e.eQx, e.eQx4, e.eQy].map(pct).join(" | ")} |`);
      }
    }
  }
  writeFileSync(join(import.meta.dirname, comparar ? "out_spr_variantes.txt" : "out_spr.txt"), lineas.join("\n") + "\n");
}
