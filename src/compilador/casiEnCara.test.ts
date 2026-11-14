/**
 * La esquina de una huella casi en la cara de un ancho que no pasa por el centro del pilar
 * (`CASI_EN_CARA`, `aLasCaras` en losas.ts), de la prueba de uso «ejemplo 1» (2026-11-07): P5,
 * girado 10° en el quiebro de dos vigas que acaban en sus ejes, con el centro en la esquina sin
 * ancho y una esquina a 1,3 mm de la cara de V3. La regla de LV-8 sólo miraba los anchos que pasan
 * por el centro del pilar; la triangulación bajaba a láminas de 0,4 mm contra la esquina rígida y el
 * mapa de M11 daba 920 kN·m/m con 2 kN/m² (5 372 en la envolvente), con los elementos de un poco más
 * allá a ≤ 5. Aquí, el mismo nudo en ejes de las vigas: dos vigas de 40 × 30 por X y por −Y que acaban
 * en (0, 0), y el pilar de 30 × 30 girado −1° con el centro en (0,054; 0,057).
 * Fuera de este caso la malla no cambia: los edificios objetivo, la vivienda, el muestrario, las
 * geometrías de G y las 48 retículas al azar (con y sin muros) dan el mismo modelo analítico.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CamposLaminas } from "../motor/campos.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { conMurosAleatorios } from "../pruebas/murosAleatorios.ts";
import { reticulaAleatoria } from "../pruebas/reticulasAleatorias.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico, Vec2 } from "./fisico.ts";
import { casiEnCaras, convexoEstricto, CASI_EN_CARA } from "./losas.ts";

function quiebro(centro: Vec2): ModeloFisico {
  const pil = (id: string, x: number, y: number, giro = 0) => ({ id, x, y, giro, desde: "Cim", hasta: "N1", seccion: "P30" });
  return {
    plantas: [
      { id: "N1", altura: null },
      { id: "Cim", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 30 }],
    secciones: [
      { id: "P30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "V40", material: "HA", forma: "rectangular", b: 0.4, h: 0.3 },
    ],
    pilares: [pil("P", centro[0], centro[1], -1), pil("A", -4, 0), pil("B", 0, -4), pil("C", 4, -4), pil("D", 4, 4), pil("E", -4, 4)],
    vigas: [
      { id: "V2", planta: "N1", puntos: [[-4, 0], [0, 0]], seccion: "V40" },
      { id: "V3", planta: "N1", puntos: [[0, 0], [0, -4]], seccion: "V40" },
    ],
    losas: [{ id: "L", planta: "N1", contorno: [[0, 0], [0, -4], [4, -4], [4, 4], [-4, 4], [-4, 0]], espesor: 0.25, material: "HA" }],
    casos: [{ id: "CM", accion: { tipo: "G" } }],
    cargas: [{ tipo: "superficie", id: "q", caso: "CM", planta: "N1", losa: "L", q: [0, 0, -2] }],
  } as ModeloFisico;
}

/** El lado más corto de las láminas de la losa que no son rígidas (no caen enteras en una huella). */
function ladoMinimo(c: ReturnType<typeof valido>): number {
  const m = c.modelo;
  const esclavo = new Set<number>();
  for (const r of m.restricciones ?? []) if (r.tipo === "enlace-rigido") for (const e of r.esclavos) esclavo.add(e);
  let min = Infinity;
  for (const l of m.laminas ?? []) {
    if (l.nudos.every((n) => esclavo.has(n))) continue;
    for (let a = 0; a < 4; a++) {
      const p = m.nudos[l.nudos[a]!]!;
      const q = m.nudos[l.nudos[(a + 1) % 4]!]!;
      min = Math.min(min, Math.hypot(p.x - q.x, p.y - q.y));
    }
  }
  return min;
}

/** El mayor |M| (Mx, My, Mxy) de los valores nodales del SPR en el caso CM, kN·m/m. */
function mayorMomento(c: ReturnType<typeof valido>): number {
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error("no calcula");
  const campos = new CamposLaminas(c.modelo);
  const ev = campos.evaluador(r.casos[0]!.u);
  let max = 0;
  for (let p = 0; p < campos.nPlazas; p++) {
    const v = ev.plaza(p);
    for (const i of [3, 4, 5]) max = Math.max(max, Math.abs(v[i]!));
  }
  return max;
}

describe("una esquina de huella casi en la cara de una viga (ejemplo 1)", () => {
  beforeAll(async () => {
    await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
  });

  it("la esquina a 1,4 mm de la cara va a ella: sin láminas de milímetros ni picos en el mapa", () => {
    const junto = valido(compilar(quiebro([0.054, 0.057])));
    // El mismo pilar 2 cm dentro de las vigas: nada a menos de un centímetro de sus caras
    const dentro = valido(compilar(quiebro([0.034, 0.037])));
    expect(ladoMinimo(junto)).toBeGreaterThan(0.01);
    expect(junto.diagnosticos.filter((d) => d.codigo === "malla/astillas-junto-a-pilar")).toEqual([]);
    const mJunto = mayorMomento(junto);
    const mDentro = mayorMomento(dentro);
    // Con el código de antes, 0,4 mm y un pico de cientos de kN·m/m
    expect(mJunto).toBeLessThan(1.5 * mDentro);
    expect(mJunto).toBeLessThan(30);
  });

  it("casiEnCaras: una esquina de viga, una cara, y nada si el lado no corre por la cara", () => {
    const caraX: [Vec2, Vec2] = [[0.2, 0], [0.2, -4]];
    const caraY: [Vec2, Vec2] = [[-4, 0.2], [0, 0.2]];
    // Esquina de un rectángulo casi alineado: al cruce de las dos caras
    expect(casiEnCaras([0.2066, 0.2044], [0.2014, -0.0956], [-0.0934, 0.2096], [caraX, caraY], CASI_EN_CARA, 1e-6)).toEqual([0.2, 0.2]);
    // Un vértice con su lado por la cara X, a 1,4 mm: proyectado
    const X = casiEnCaras([0.2014, -0.0956], [0.199, -0.3956], [0.2066, 0.2044], [caraX], CASI_EN_CARA, 1e-6)!;
    expect(X[0]).toBeCloseTo(0.2, 12);
    expect(X[1]).toBeCloseTo(-0.0956, 12);
    // A más de 1 cm, o con los lados a 45° (la esquina de un octógono), nada
    expect(casiEnCaras([0.215, -0.1], [0.215, -0.4], [0.215, 0.2], [caraX], CASI_EN_CARA, 1e-6)).toBeNull();
    expect(casiEnCaras([0.1914, -0.1414], [0.25, 0], [0.05, -0.2], [caraX], CASI_EN_CARA, 1e-6)).toBeNull();
    // Ya sobre la cara: no se aparta de ella
    expect(casiEnCaras([0.2, -0.1], [0.2, -0.4], [0.205, 0.2], [caraX], CASI_EN_CARA, 1e-6)).toBeNull();
  });

  it("las astillas que quedan junto a una huella se avisan (retícula 22 con muros y sin rejilla: el ancho de la viga empieza 2 cm dentro de la huella de un pilar de esquina)", () => {
    // La retícula 2 con muros, la de antes, ya no tiene astillas (`astillasCirculares.test.ts`)
    const f = reticulaAleatoria(22);
    const conVb = { ...f, secciones: [...f.secciones, { id: "vb", material: "HA", forma: "rectangular" as const, b: 0.3, h: 0.5 }], casos: [...f.casos, { id: "V" }] };
    const c = valido(compilar(conMurosAleatorios(conVb, 22), { rejilla: false }));
    const avisos = c.diagnosticos.filter((d) => d.codigo === "malla/astillas-junto-a-pilar");
    expect(avisos.length).toBeGreaterThan(0);
    expect(avisos.every((d) => d.severidad === "aviso" && (d.ids?.length ?? 0) > 0)).toBe(true);
    // En una retícula sin muros, ninguna
    expect(valido(compilar(reticulaAleatoria(22), { rejilla: false })).diagnosticos.filter((d) => d.codigo === "malla/astillas-junto-a-pilar")).toEqual([]);
  });

  it("convexoEstricto", () => {
    expect(convexoEstricto([[0, 0], [1, 0], [1, 1], [0, 1]], 1e-6)).toBe(true);
    expect(convexoEstricto([[0, 0], [0, 1], [1, 1], [1, 0]], 1e-6)).toBe(true);
    expect(convexoEstricto([[0, 0], [1, 0], [1, 0], [0, 1]], 1e-6)).toBe(false);
    expect(convexoEstricto([[0, 0], [1, 0], [2, 0], [0, 1]], 1e-6)).toBe(false);
    expect(convexoEstricto([[0, 0], [2, 0], [0.5, 0.5], [0, 2]], 1e-6)).toBe(false);
  });
});
