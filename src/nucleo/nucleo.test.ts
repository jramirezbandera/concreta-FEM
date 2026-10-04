import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FactorLdlt, iniciarNucleo, memoriaEnUsoNucleo, memoriaNucleo, type PatronCsc } from "./index.ts";

const pkg = join(import.meta.dirname, "pkg");

describe("artefacto versionado", () => {
  it("los ficheros de pkg/ coinciden con MANIFIESTO.json", () => {
    const manifiesto = JSON.parse(readFileSync(join(pkg, "MANIFIESTO.json"), "utf8"));
    for (const [fichero, hash] of Object.entries(manifiesto.sha256)) {
      const real = createHash("sha256").update(readFileSync(join(pkg, fichero))).digest("hex");
      expect(real, fichero).toBe(hash);
    }
    expect(manifiesto.bytes).toBeLessThanOrEqual(1.5 * 1024 * 1024); // criterio 4 de E0
  });
});

/** Laplaciano 2D en rejilla m×m (+ diagonal), triángulo superior CSC. */
function laplaciano2d(m: number): { patron: PatronCsc; valores: Float64Array } {
  const n = m * m;
  const colPtr = new Uint32Array(n + 1);
  const filas: number[] = [];
  const vals: number[] = [];
  for (let j = 0; j < n; j++) {
    const [r, c] = [Math.floor(j / m), j % m];
    const vecinos: number[] = [];
    if (r > 0) vecinos.push(j - m);
    if (c > 0) vecinos.push(j - 1);
    for (const i of vecinos) {
      filas.push(i);
      vals.push(-1);
    }
    filas.push(j);
    vals.push(4.01);
    colPtr[j + 1] = filas.length;
  }
  return { patron: { n, colPtr, rowIdx: Uint32Array.from(filas) }, valores: Float64Array.from(vals) };
}

function producto(p: PatronCsc, v: Float64Array, x: Float64Array): Float64Array {
  const y = new Float64Array(p.n);
  for (let j = 0; j < p.n; j++) {
    for (let k = p.colPtr[j]!; k < p.colPtr[j + 1]!; k++) {
      const i = p.rowIdx[k]!;
      y[i]! += v[k]! * x[j]!;
      if (i !== j) y[j]! += v[k]! * x[i]!;
    }
  }
  return y;
}

describe("FactorLdlt", () => {
  beforeAll(async () => {
    await iniciarNucleo(readFileSync(join(pkg, "nucleo_bg.wasm")));
  });

  for (const modo of ["supernodal", "simplicial", "auto"] as const) {
    it(`resuelve varios lados derechos (${modo})`, () => {
      const { patron, valores } = laplaciano2d(40);
      const f = new FactorLdlt(patron, { modo });
      f.factorizar(valores);
      const n = patron.n;
      const x0 = new Float64Array(3 * n).map((_, i) => Math.sin(i));
      const b = new Float64Array(3 * n);
      for (let k = 0; k < 3; k++) b.set(producto(patron, valores, x0.subarray(k * n, (k + 1) * n)), k * n);
      const x = f.resolver(b, 3);
      let err = 0;
      for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(x[i]! - x0[i]!));
      expect(err).toBeLessThan(1e-12);
      expect(f.diagonal().every((d) => d > 0)).toBe(true);
      expect(f.estadisticas().supernodal).toBe(modo === "supernodal" || (modo === "auto" && f.estadisticas().supernodal));
      // Refactorizar con otros valores sobre el mismo patrón
      f.factorizar(valores.map((v) => 2 * v));
      const x2 = f.resolver(b, 3);
      expect(Math.abs(x2[7]! - x0[7]! / 2)).toBeLessThan(1e-12);
      f.liberar();
    });
  }

  it("informa de un pivote nulo", () => {
    const patron: PatronCsc = { n: 2, colPtr: Uint32Array.of(0, 1, 3), rowIdx: Uint32Array.of(0, 0, 1) };
    const f = new FactorLdlt(patron, { modo: "simplicial", perm: Uint32Array.of(0, 1) });
    expect(() => f.factorizar(Float64Array.of(1, -1, 1))).toThrow(/pivote nulo en la columna 1/);
    f.liberar();
  });

  it("dice la memoria que pedirá sin reservarla, y la devuelve al liberar", () => {
    const { patron, valores } = laplaciano2d(60);
    const antes = memoriaEnUsoNucleo();
    const f = new FactorLdlt(patron, { modo: "supernodal" });
    const req = f.memoriaRequerida(4);
    const analizado = memoriaEnUsoNucleo();
    expect(req.l).toBe(8 * f.estadisticas().nnzL);
    expect(req.lados).toBe(8 * patron.n * 4);
    expect(req.total).toBe(req.l + req.factorizacion + req.resolucion + req.lados);
    expect(f.memoriaRequerida(1).resolucion).toBeLessThanOrEqual(req.resolucion);
    f.factorizar(valores);
    f.resolver(new Float64Array(4 * patron.n).fill(1), 4);
    // Lo que queda reservado tras resolver: L y los lados derechos, dentro de lo anunciado
    expect(memoriaEnUsoNucleo() - analizado).toBeGreaterThanOrEqual(req.l + req.lados);
    expect(memoriaEnUsoNucleo() - analizado).toBeLessThanOrEqual(req.total);
    expect(memoriaNucleo()).toBeGreaterThanOrEqual(memoriaEnUsoNucleo());
    f.liberar();
    // Sólo puede quedar la reserva fija de gemm (512 KiB) de la primera factorización densa
    expect(memoriaEnUsoNucleo() - antes).toBeLessThanOrEqual(512 * 1024 + 512);
  });

  it("rechaza un patrón con entradas bajo la diagonal", () => {
    const patron: PatronCsc = { n: 2, colPtr: Uint32Array.of(0, 2, 2), rowIdx: Uint32Array.of(0, 1) };
    expect(() => new FactorLdlt(patron)).toThrow(/bajo la diagonal/);
  });
});
