/**
 * Criterio 2 de C4 y la viga continua del criterio 1 (detalle en validacion/c4/out_oraculos.txt):
 * - los multiplicadores del reticular frente a la T calculada a mano;
 * - la placa de Navier ortótropa descrita como modelo físico;
 * - el recuadro reticular frente al emparrillado de nervios como barras, apoyado en su contorno y
 *   con un pilar central y su ábaco;
 * - dos vanos de viguetas sobre muros finos frente a la viga continua (1,25·q·s·L, H46).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { iniciarNucleo } from "../nucleo/index.ts";
import { comparaMultiplicadores, continuaSobreMuros, emparrillado, emparrilladoPilar, navierReticular } from "../../validacion/c4/oraculos.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("criterio 2 de C4: oráculos del reticular", () => {
  it("multiplicadores de 25+5, 30+5 y 35+10: los de la T a mano (m12 con J_w de Roark, a ≤ 0,5 %)", () => {
    for (const x of comparaMultiplicadores()) {
      expect(x.exactos, x.nombre).toBeLessThan(1e-12);
      expect(x.m12, x.nombre).toBeLessThan(5e-3);
      expect(x.compilador.m11, x.nombre).toBeGreaterThan(0.29);
      expect(x.compilador.m11, x.nombre).toBeLessThan(0.31);
    }
  });

  it("placa de Navier ortótropa como modelo físico: ≤ 0,5 % en w con h = 0,25 y orden ≈ 2", () => {
    const [a, b] = [navierReticular(0.25), navierReticular(0.125)];
    expect(Math.abs(a.error)).toBeLessThan(5e-3);
    const orden = Math.log(Math.abs(a.error / b.error)) / Math.log(2);
    expect(orden).toBeGreaterThan(1.8);
    expect(orden).toBeLessThan(2.2);
  });

  it("recuadro apoyado (8 nervios por lado) frente al emparrillado de nervios: ≤ 3 % en la flecha y ≤ 5 % en el momento por nervio", () => {
    const x = emparrillado(8, false);
    expect(Math.abs(x.errorW)).toBeLessThan(0.03);
    expect(Math.abs(x.errorM)).toBeLessThan(0.05);
  });

  it("recuadro con un pilar central y su ábaco (12 nervios) frente al emparrillado: ≤ 3 % y ≤ 5 % con ν = 0 en los dos; con el ν del hormigón el ábaco es algo más rígido", () => {
    const x = emparrilladoPilar(12, true, true);
    expect(Math.abs(x.errorW)).toBeLessThan(0.03);
    expect(Math.abs(x.errorM)).toBeLessThan(0.05);
    const y = emparrilladoPilar(12, true, false);
    expect(y.errorW).toBeLessThan(0);
    expect(Math.abs(y.errorW)).toBeLessThan(0.05);
    expect(Math.abs(y.errorM)).toBeLessThan(0.05);
  });
});

describe("criterio 1 de C4: viguetas continuas", () => {
  it("dos vanos de viguetas sobre muros de 5 cm: la reacción central a ≤ 1 % de 1,25·q·s·L", () => {
    const x = continuaSobreMuros(0.05);
    expect(Math.abs(x.error)).toBeLessThan(0.01);
    expect(Math.abs(x.extrema / 0.375 - 1)).toBeLessThan(0.02);
  });
});
