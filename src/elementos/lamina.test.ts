/**
 * Lámina DKMQ24 de E3 con multiplicadores y ejes de usuario (criterio 1 de E3): sin
 * multiplicadores es la de E0 (validada contra PyNite y ASDShellQ4); con ellos, simétrica, con
 * exactamente 6 modos rígidos y con la rigidez global independiente de los ejes elegidos (girar
 * los ejes 90° equivale a intercambiar los multiplicadores de las dos direcciones).
 */
import { describe, expect, it } from "vitest";
import { asimetria, autovaloresSimetrica, errorRelativo, maxAbs, producto } from "../pruebas/densa.ts";
import type { MaterialLamina } from "./dkmq.ts";
import { marcoLamina, marcoLocal, rigidezAGlobales, rigidezLaminaGlobal, rigidezLaminaLocal, seccionLamina, type MultiplicadoresLamina } from "./lamina.ts";

const FORMAS: Record<string, number[]> = {
  cuadrado: [0, 0, 1, 0, 1, 1, 0, 1],
  rectangulo: [0, 0, 3, 0, 3, 0.5, 0, 0.5],
  paralelogramo: [0, 0, 2, 0, 2.6, 1, 0.6, 1],
  trapecio: [0, 0, 2, 0, 1.5, 1, 0.5, 1],
  distorsionado: [0, 0, 1.3, 0, 1.5, 1.1, -0.2, 0.8],
};
const MAT: MaterialLamina = { E: 3e7, nu: 0.2, t: 0.25 };
/** Reticular típico (H46/D3): flexión ~0,3 con torsión menor, membrana y cortante reducidos y distintos por dirección. */
const RETICULAR: MultiplicadoresLamina = { f11: 0.55, f22: 0.4, f12: 0.25, m11: 0.32, m22: 0.27, m12: 0.12, v13: 0.2, v23: 0.15 };
const GIRADO_90: MultiplicadoresLamina = { f11: 0.4, f22: 0.55, f12: 0.25, m11: 0.27, m22: 0.32, m12: 0.12, v13: 0.15, v23: 0.2 };

/** Coloca un cuadrilátero plano (x, y) en el espacio con dos giros y una traslación. */
function enElEspacio(xy: number[], a = 0.7, b = -0.4): number[] {
  const [c1, s1, c2, s2] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
  const X: number[] = [];
  for (let k = 0; k < 4; k++) {
    const [x, y] = [xy[2 * k]!, xy[2 * k + 1]!];
    const p = [x, y * c1, y * s1];
    X.push(c2 * p[0]! - s2 * p[1]! + 1, s2 * p[0]! + c2 * p[1]! - 2, p[2]! + 3);
  }
  return X;
}

function kGlobal(X: number[], mult?: MultiplicadoresLamina, eje1?: number[]): Float64Array {
  const m = marcoLamina(X, eje1);
  if (typeof m === "string") throw new Error(m);
  return rigidezLaminaGlobal(m.xy, m.R, seccionLamina(MAT, mult));
}

describe("lámina E3: sin multiplicadores es la de E0", () => {
  for (const [nombre, xy] of Object.entries(FORMAS)) {
    it(`${nombre}: misma rigidez local que la del spike`, () => {
      expect(errorRelativo(rigidezLaminaLocal(xy, seccionLamina(MAT)), rigidezLaminaLocal(xy, MAT))).toBeLessThan(1e-14);
    });
  }
  it("γ y estabilización se trasladan igual que en E0", () => {
    const xy = FORMAS.distorsionado!;
    const op = { gamma: 1e-3, estabilizacion: 0.1 };
    expect(errorRelativo(rigidezLaminaLocal(xy, seccionLamina(MAT, {}, op)), rigidezLaminaLocal(xy, MAT, op))).toBeLessThan(1e-14);
  });
});

describe("lámina E3 con multiplicadores: propiedades", () => {
  for (const [nombre, xy] of Object.entries(FORMAS)) {
    it(`${nombre} en el espacio: simétrica, exactamente 6 modos rígidos y el resto positivos`, () => {
      const X = enElEspacio(xy);
      const k = kGlobal(X, RETICULAR, [1, 0.3, -0.2]);
      expect(asimetria(k, 24)).toBeLessThan(1e-14);
      const rigidos: number[][] = [];
      for (let d = 0; d < 3; d++) {
        const tr: number[] = [];
        for (let a = 0; a < 4; a++) for (let c = 0; c < 6; c++) tr.push(c === d ? 1 : 0);
        rigidos.push(tr);
        // giro alrededor del eje d: u = e_d × X, θ = e_d
        const gi: number[] = [];
        for (let a = 0; a < 4; a++) {
          const p = [X[3 * a]!, X[3 * a + 1]!, X[3 * a + 2]!];
          const e = [0, 0, 0];
          e[d] = 1;
          gi.push(e[1]! * p[2]! - e[2]! * p[1]!, e[2]! * p[0]! - e[0]! * p[2]!, e[0]! * p[1]! - e[1]! * p[0]!, ...e);
        }
        rigidos.push(gi);
      }
      for (const r of rigidos) expect(maxAbs(producto(k, r, 24)) / maxAbs(k)).toBeLessThan(1e-12);
      const lambda = autovaloresSimetrica(k, 24);
      expect(Math.abs(lambda[5]!) / lambda[23]!).toBeLessThan(1e-12);
      expect(lambda[6]! / lambda[23]!).toBeGreaterThan(1e-10);
    });
  }
});

describe("lámina E3: la rigidez global no depende de los ejes elegidos", () => {
  for (const [nombre, xy] of Object.entries(FORMAS)) {
    it(`${nombre}, isótropa: ejes de CSI = eje 1 cualquiera = ejes de PyNite`, () => {
      const X = enElEspacio(xy);
      const ref = kGlobal(X);
      expect(errorRelativo(kGlobal(X, {}, [0.3, -1, 0.5]), ref)).toBeLessThan(1e-12);
      const p = marcoLocal(X);
      expect(errorRelativo(rigidezAGlobales(rigidezLaminaLocal(p.xy, MAT), p.R), ref)).toBeLessThan(1e-12);
    });

    it(`${nombre}, ortótropa: girar el eje 1 90° = intercambiar los multiplicadores de las dos direcciones`, () => {
      const X = enElEspacio(xy);
      const m = marcoLamina(X, [1, 0.3, -0.2]);
      if (typeof m === "string") throw new Error(m);
      const e2 = [m.R[3]!, m.R[4]!, m.R[5]!];
      const a = kGlobal(X, RETICULAR, [1, 0.3, -0.2]);
      const b = kGlobal(X, GIRADO_90, e2);
      expect(errorRelativo(b, a)).toBeLessThan(1e-12);
      // y no es una igualdad trivial: con los mismos multiplicadores, la rigidez cambia
      expect(errorRelativo(kGlobal(X, RETICULAR, e2), a)).toBeGreaterThan(1e-3);
    });
  }
});

describe("lámina E3: ejes de usuario", () => {
  it("regla de CSI: losa con normal +Z → 1 = X, 2 = Y; con normal −Z → 1 = −X; muro → 1 horizontal y 2 = +Z", () => {
    const losa = marcoLamina([0, 0, 3, 2, 0, 3, 2, 1, 3, 0, 1, 3]) as { R: Float64Array };
    expect(Array.from(losa.R).map((v) => v + 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const invertida = marcoLamina([0, 0, 3, 0, 1, 3, 2, 1, 3, 2, 0, 3]) as { R: Float64Array };
    expect(Array.from(invertida.R).map((v) => v + 0)).toEqual([-1, 0, 0, 0, 1, 0, 0, 0, -1]);
    // muro en el plano x = 5, recorrido de modo que la normal es +X
    const muro = marcoLamina([5, 0, 0, 5, 2, 0, 5, 2, 3, 5, 0, 3]) as { R: Float64Array };
    const R = Array.from(muro.R).map((v) => Math.round(v * 1e12) / 1e12 + 0);
    expect(R).toEqual([0, 1, 0, 0, 0, 1, 1, 0, 0]);
  });

  it("eje 1 de referencia proyectado sobre el plano; normal o casi normal → error", () => {
    const X = [0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0];
    const m = marcoLamina(X, [1, 1, 5]) as { R: Float64Array };
    const s = Math.SQRT1_2;
    expect(errorRelativo(m.R, [s, s, 0, -s, s, 0, 0, 0, 1])).toBeLessThan(1e-15);
    expect(typeof marcoLamina(X, [0, 0, 1])).toBe("string");
    expect(typeof marcoLamina(X, [1e-4, 0, 1])).toBe("string");
    expect(typeof marcoLamina(X, [Number.NaN, 0, 1])).toBe("string");
  });

  it("losa casi horizontal (seno < 1e-3): eje 2 = +Y proyectado; con más pendiente, eje 1 horizontal y 2 hacia arriba (salto de 90°, como CSI)", () => {
    const z = 0.5e-3 * 2; // pendiente de 0,5e-3 en x
    const m = marcoLamina([0, 0, 0, 2, 0, z, 2, 1, z, 0, 1, 0]) as { R: Float64Array };
    expect(Math.abs(m.R[4]! - 1)).toBeLessThan(1e-6); // e2 ≈ Y
    expect(Math.abs(m.R[0]! - 1)).toBeLessThan(1e-6); // e1 ≈ X
    // pendiente de 2e-3 en x: rampa. El eje 1 sigue la horizontal (−Y) y el 2 sube por la pendiente (≈ +X)
    const n = marcoLamina([0, 0, 0, 2, 0, 4 * z, 2, 1, 4 * z, 0, 1, 0]) as { R: Float64Array };
    expect(Math.abs(n.R[2]!)).toBeLessThan(1e-15);
    expect(Math.abs(n.R[1]! + 1)).toBeLessThan(1e-12);
    expect(n.R[3]!).toBeGreaterThan(0.99);
    expect(n.R[5]!).toBeGreaterThan(0);
  });
});
