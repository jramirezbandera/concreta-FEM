import { describe, expect, it } from "vitest";
import type { Texto, Vec2 } from "../../../src/agente/render/escena.ts";
import type { Glifo } from "../../../src/visor/escena.ts";
import { colocarRotulos, ralearBurbujas } from "../vistas/rotulos.ts";

/** Diez ejes verticales cada 6 m con una burbuja en cada extremo (y = 0 e y = −40), a `s` px/m. */
function fila(s: number) {
  const glifos: Glifo[] = [];
  const textos: Texto[] = [];
  for (let k = 0; k < 10; k++)
    for (const p of [
      [6 * k, 0],
      [6 * k, -40],
    ] as Vec2[]) {
      glifos.push({
        tipo: "marca",
        p,
        forma: "circulo",
        radio: 11,
        estilo: "eje-burbuja",
        objeto: `${k + 1}`,
      });
      textos.push({
        tipo: "texto",
        p,
        texto: `${k + 1}`,
        tamano: 12,
        negrita: true,
        ancla: "medio",
        dy: 4,
        prioridad: 95,
        clase: "eje",
        objeto: `${k + 1}`,
      });
    }
  const px = (q: Vec2): [number, number] => [100 + q[0] * s, 100 - q[1] * s];
  return { glifos, textos, px };
}

const medir = (t: string, tam: number) => 0.6 * tam * t.length;

describe("ralearBurbujas", () => {
  it("con sitio, no oculta ninguna", () => {
    const { glifos, textos, px } = fila(10);
    const r = ralearBurbujas(glifos, textos, px);
    expect(r.ocultos.size).toBe(0);
    expect(r.textos).toHaveLength(20);
    expect(r.obstaculos).toHaveLength(20);
  });

  it("con poco zoom, deja los extremos y uno de cada dos o de cada tres, en los dos extremos de cada eje", () => {
    for (const [s, quedan] of [
      [3, ["1", "3", "5", "7", "10"]],
      [2, ["1", "4", "7", "10"]],
    ] as const) {
      const { glifos, textos, px } = fila(s);
      const r = ralearBurbujas(glifos, textos, px);
      const vistas = glifos
        .filter((g) => !r.ocultos.has(g))
        .map((g) => g.objeto);
      expect(vistas).toEqual(quedan.flatMap((x) => [x, x]));
      expect(r.textos.map((t) => t.objeto)).toEqual(vistas);
      // Ninguna de las que se ven toca a otra de su fila
      const q = glifos
        .filter((g) => !r.ocultos.has(g) && g.p[1] === 0)
        .map((g) => px(g.p));
      for (let i = 1; i < q.length; i++)
        expect(q[i]![0] - q[i - 1]![0]).toBeGreaterThanOrEqual(25);
    }
  });

  it("un eje elegido conserva su burbuja", () => {
    const { glifos, textos, px } = fila(3);
    const r = ralearBurbujas(glifos, textos, px, new Set(["2"]));
    expect(
      glifos.filter((g) => g.objeto === "2").some((g) => r.ocultos.has(g)),
    ).toBe(false);
  });

  it("una cota no se pone encima de una burbuja, y el rótulo de la burbuja sí", () => {
    const { glifos, textos, px } = fila(10);
    const r = ralearBurbujas(glifos, textos, px);
    const cota: Texto = {
      tipo: "texto",
      p: [0.6, 0.5],
      texto: "6,00",
      tamano: 11,
      ancla: "medio",
      prioridad: 15,
      clase: "cota",
    };
    const lejos: Texto = { ...cota, p: [3, -3] };
    const { puestos } = colocarRotulos(
      [...r.textos, cota, lejos],
      px,
      1000,
      1000,
      medir,
      10,
      new Set(),
      r.obstaculos,
    );
    expect(puestos.filter((p) => p.t.clase === "eje")).toHaveLength(20);
    expect(puestos.some((p) => p.t === cota)).toBe(false);
    expect(puestos.some((p) => p.t === lejos)).toBe(true);
  });
});
