/**
 * AC-e (decisión del usuario del 2026-11-07): los ábacos según las luces (`proponerAbacosLuces`, el
 * de «Con ábacos» en la herramienta Forjado y el de «En todos los pilares…» por defecto).
 *
 * - Desde el eje del pilar, a cada lado y en cada dirección de los nervios, al menos el 15 % de la
 *   luz de ese lado (asimétrico si los vanos son distintos), y menos de un intereje más.
 * - Cada lado acaba en la cara de un casetón de la retícula del forjado (la del sólido): el + al
 *   empezar una celda y el − al acabar, así que no corta ninguno.
 * - Hacia un borde sin vano, justo hasta el borde; hacia un voladizo largo, lo del lado contrario.
 * - Con los nervios girados, lo mismo girado (a la precisión del µm de los vértices).
 * - Con los ábacos puestos, compila sin `reticular/pilar-sin-abaco` (AC-d).
 */
import { describe, expect, it } from "vitest";
import { reticulaCasetones } from "../compilador/abacos.ts";
import { compilar } from "../compilador/compilar.ts";
import type { ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { proyectoNuevo } from "./plantilla.ts";
import { aplicar } from "./operaciones.ts";
import { FRACCION_LUZ_ABACO, operacionAbacos, proponerAbacosLuces, type PropuestaAbacos } from "./abacos.ts";

const [S, BW] = [0.8, 0.12];
const C = S - BW;

/** Pilares en los cruces de xs × ys y un reticular de contorno [x0, x1] × [y0, y1], girado g grados alrededor del origen. */
function modelo(xs: number[], ys: number[], caja: [number, number, number, number], g = 0): ModeloFisico {
  const r = (g * Math.PI) / 180;
  const rot = (q: Vec2): Vec2 => (g ? [q[0] * Math.cos(r) - q[1] * Math.sin(r), q[0] * Math.sin(r) + q[1] * Math.cos(r)] : q);
  const [x0, x1, y0, y1] = caja;
  return {
    plantas: [
      { id: "N1", altura: null },
      { id: "N0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "P30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 }],
    pilares: xs.flatMap((x) => ys.map((y) => [x, y] as Vec2)).map((q, i) => ({ id: `P${i + 1}`, x: rot(q)[0], y: rot(q)[1], ...(g ? { giro: g } : {}), seccion: "P30", desde: "N0", hasta: "N1" })),
    losas: [{ id: "L", planta: "N1", contorno: ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Vec2[]).map(rot), espesor: 0.3, material: "H", ...(g ? { eje1: g } : {}), reticular: { intereje: S, nervio: BW, capa: 0.05 } }],
    casos: [{ id: "G", pesoPropio: true }],
    cargas: [],
  };
}

const propuesta = (m: ModeloFisico): PropuestaAbacos => {
  const p = proponerAbacosLuces(m, "L");
  if ("error" in p) throw new Error(p.error);
  return p;
};
/** La caja [s0, s1, t0, t1] de un ábaco en los ejes girados g. */
const caja = (p: readonly Vec2[], g = 0): [number, number, number, number] => {
  const r = (g * Math.PI) / 180;
  const s = p.map((q) => q[0] * Math.cos(r) + q[1] * Math.sin(r));
  const t = p.map((q) => -q[0] * Math.sin(r) + q[1] * Math.cos(r));
  return [Math.min(...s), Math.max(...s), Math.min(...t), Math.max(...t)];
};
const de = (p: PropuestaAbacos, pilar: string) => p.nuevos.find((x) => x.pilar === pilar)!.poligono;
/** El resto de x − x0 entre s, en [0, s). */
const resto = (x: number, x0: number) => (((x - x0) % S) + S) % S;

describe("AC-e: ábacos según las luces", () => {
  // Vanos de 5 y 7 m en x y de 6 m en y; la losa acaba en los ejes de los pilares de fuera
  const m = modelo([0, 5, 12], [0, 6], [0, 12, 0, 6]);
  const p = propuesta(m);
  const [xs] = reticulaCasetones(0, 12, S, C);
  const [xt] = reticulaCasetones(0, 6, S, C);

  it("un pilar con vanos distintos a cada lado: al menos 0,15·L de cada uno, menos de un intereje más, y asimétrico", () => {
    // P3 en (5, 0): 5 m a la izquierda, 7 m a la derecha, 6 m hacia arriba; abajo, el borde
    const [s0, s1, t0, t1] = caja(de(p, "P3"));
    for (const [lado, minimo] of [
      [5 - s0, FRACCION_LUZ_ABACO * 5],
      [s1 - 5, FRACCION_LUZ_ABACO * 7],
      [t1 - 0, FRACCION_LUZ_ABACO * 6],
    ] as const) {
      expect(lado).toBeGreaterThanOrEqual(minimo - 1e-9);
      expect(lado).toBeLessThan(minimo + S);
    }
    expect(s1 - 5).toBeGreaterThan(5 - s0);
    expect(t0).toBe(0);
  });

  it("cada lado acaba en la cara de un casetón (el + al empezar una celda, el − al acabar), salvo el que llega al borde", () => {
    for (const { poligono } of p.nuevos) {
      const [s0, s1, t0, t1] = caja(poligono);
      for (const [x, x0, empieza, enBorde] of [
        [s0, xs, false, s0 === 0],
        [s1, xs, true, s1 === 12],
        [t0, xt, false, t0 === 0],
        [t1, xt, true, t1 === 6],
      ] as const) {
        if (enBorde) continue;
        const r = resto(x, x0);
        expect(Math.min(Math.abs(r - (empieza ? 0 : C)), Math.abs(r - (empieza ? S : C))), `${x}`).toBeLessThan(2e-6);
      }
    }
  });

  it("hacia un borde sin vano, justo hasta el borde; hacia un voladizo largo, lo del lado contrario", () => {
    // P1 en la esquina (0, 0): a la izquierda y abajo, el borde
    const [s0, , t0] = caja(de(p, "P1"));
    expect([s0, t0]).toEqual([0, 0]);
    // Con un voladizo de 3 m a la derecha de P5 (12, 0), su ábaco llega lo que a la izquierda (0,15·7 redondeado)
    const v = propuesta(modelo([0, 5, 12], [0, 6], [0, 15, 0, 6]));
    const [a0, a1] = caja(de(v, "P5"));
    expect(a1 - 12).toBeGreaterThanOrEqual(12 - a0 - S);
    expect(a1 - 12).toBeLessThanOrEqual(12 - a0 + 1e-9);
    expect(a1).toBeLessThan(15);
  });

  it("con los nervios girados 30°, lo mismo girado", () => {
    const g = propuesta(modelo([0, 5, 12], [0, 6], [0, 12, 0, 6], 30));
    for (const { pilar, poligono } of p.nuevos) {
      const a = caja(poligono);
      const b = caja(de(g, pilar), 30);
      for (let i = 0; i < 4; i++) expect(Math.abs(a[i]! - b[i]!), `${pilar}`).toBeLessThan(5e-6);
    }
  });

  it("con los ábacos puestos compila, sin reticular/pilar-sin-abaco", () => {
    const a = aplicar({ ...proyectoNuevo("luces"), modelo: m }, operacionAbacos(m, p)!);
    if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
    const c = compilar(a.proyecto.modelo);
    expect(c.diagnosticos.filter((d) => d.severidad === "error")).toEqual([]);
    expect(compilar(m).diagnosticos.some((d) => d.codigo === "reticular/pilar-sin-abaco")).toBe(true);
  });
});
