/**
 * Solver de perfil frente al núcleo WASM (faer): diferencial a ≤ 1e-12 sobre K de láminas reales.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { marcoLocal, rigidezAGlobales, rigidezLaminaLocal } from "../elementos/lamina.ts";
import { FactorLdlt, iniciarNucleo, type PatronCsc } from "../nucleo/index.ts";
import { FactorPerfil, ordenRcm } from "./perfil.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

/** K libre (triángulo superior CSC) de una losa n×n de láminas apoyada en el contorno. */
function losa(n: number): { patron: PatronCsc; valores: Float64Array } {
  const L = 6;
  const nn = (n + 1) * (n + 1);
  const tag = (i: number, j: number) => i * (n + 1) + j;
  const libre = new Int32Array(6 * nn).fill(-1);
  let nl = 0;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    const borde = i === 0 || j === 0 || i === n || j === n;
    for (let c = 0; c < 6; c++) if (!(borde && c < 3)) libre[6 * tag(i, j) + c] = nl++;
  }
  const cols: Map<number, number>[] = Array.from({ length: nl }, () => new Map());
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const q = [tag(i, j), tag(i + 1, j), tag(i + 1, j + 1), tag(i, j + 1)];
    // nudos ligeramente distorsionados y fuera de plano para acoplar todo
    const X = q.flatMap((v) => {
      const a = Math.floor(v / (n + 1));
      const b = v % (n + 1);
      return [(L * a) / n + 0.05 * Math.sin(3 * b), (L * b) / n + 0.05 * Math.cos(2 * a), 0];
    });
    const m = marcoLocal(X);
    const k = rigidezAGlobales(rigidezLaminaLocal(m.xy, { E: 3e7, nu: 0.2, t: 0.25 }), m.R);
    const g = q.flatMap((v) => [0, 1, 2, 3, 4, 5].map((c) => libre[6 * v + c]!));
    for (let r = 0; r < 24; r++) for (let c = 0; c < 24; c++) {
      const [fi, cj] = [g[r]!, g[c]!];
      if (fi < 0 || cj < 0 || fi > cj) continue;
      cols[cj]!.set(fi, (cols[cj]!.get(fi) ?? 0) + k[24 * r + c]!);
    }
  }
  const colPtr = new Uint32Array(nl + 1);
  for (let j = 0; j < nl; j++) colPtr[j + 1] = colPtr[j]! + cols[j]!.size;
  const rowIdx = new Uint32Array(colPtr[nl]!);
  const valores = new Float64Array(colPtr[nl]!);
  cols.forEach((c, j) => [...c.entries()].sort((a, b) => a[0] - b[0]).forEach(([i, v], p) => {
    rowIdx[colPtr[j]! + p] = i;
    valores[colPtr[j]! + p] = v;
  }));
  return { patron: { n: nl, colPtr, rowIdx }, valores };
}

describe("solver de perfil", () => {
  it("RCM es una permutación", () => {
    const { patron } = losa(6);
    const p = ordenRcm(patron);
    expect([...p].sort((a, b) => a - b)).toEqual(Array.from({ length: patron.n }, (_, i) => i));
  });

  it("coincide con el núcleo WASM a ≤ 1e-12 (losa 20×20, ~2 500 GDL)", () => {
    const { patron, valores } = losa(20);
    const b = Float64Array.from({ length: patron.n }, (_, i) => Math.sin(i * 0.37) + (i % 7 === 0 ? 10 : 0));
    const xp = new FactorPerfil(patron, valores).resolver(b);
    const f = new FactorLdlt(patron);
    f.factorizar(valores);
    const xf = f.resolver(b);
    f.liberar();
    let num = 0;
    let den = 0;
    for (let i = 0; i < patron.n; i++) {
      num = Math.max(num, Math.abs(xp[i]! - xf[i]!));
      den = Math.max(den, Math.abs(xf[i]!));
    }
    expect(num / den).toBeLessThan(1e-12);
  });
});
