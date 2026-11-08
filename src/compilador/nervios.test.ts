/**
 * El punto de paso de los nervios de un reticular (`Reticular.paso`, como en CYPECAD; a petición del
 * usuario el 2026-11-08) y los nervios en planta (`nerviosLosa`).
 *
 * - Sin `paso`, la retícula es la de antes (centrada en la caja de la losa), así que el sólido y los
 *   ábacos por luces no cambian.
 * - Con `paso`, un eje de nervio de cada familia pasa por él, también con los nervios girados.
 * - Los nervios en planta caen en la zona aligerada (fuera de huecos y ábacos), según el `eje1`.
 * - No cambia el cálculo: el modelo analítico es el mismo con y sin `paso`.
 * - El editor: la tabla lo lee y lo escribe, Mover y Girar lo llevan con la losa, y su pinzamiento lo
 *   cambia.
 */
import { describe, expect, it } from "vitest";
import { ejesNervios, nerviosLosa, puntoPasoNervios, reticulaCasetones } from "./abacos.ts";
import { compilar } from "./compilar.ts";
import type { Losa, ModeloFisico, Vec2 } from "./fisico.ts";
import { asas, moverAsa, transformar } from "../editor/transformar.ts";
import { contexto, DEF_TABLAS } from "../editor/tablas.ts";
import { fondoModelo, PlantaFisica } from "../agente/render/modelo.ts";

const [S, BW] = [0.8, 0.12];
const C = S - BW;
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function modelo(reticular: Partial<NonNullable<Losa["reticular"]>> = {}, eje1 = 0): ModeloFisico {
  return {
    plantas: [
      { id: "N1", altura: null },
      { id: "N0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "P30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 }],
    pilares: ([[0, 0], [6, 0], [0, 5], [6, 5]] as Vec2[]).map((q, i) => ({ id: `P${i + 1}`, x: q[0], y: q[1], seccion: "P30", desde: "N0", hasta: "N1" })),
    losas: [
      {
        id: "L",
        planta: "N1",
        contorno: rect(0, 0, 6, 5),
        espesor: 0.3,
        material: "H",
        ...(eje1 ? { eje1 } : {}),
        reticular: { intereje: S, nervio: BW, capa: 0.05, abacos: ([[0, 0], [6, 0], [0, 5], [6, 5]] as Vec2[]).map((q) => rect(q[0] - 0.7, q[1] - 0.7, q[0] + 0.7, q[1] + 0.7)), ...reticular },
      },
    ],
    casos: [{ id: "G", pesoPropio: true }],
    cargas: [],
  };
}

/** El resto de x − x0 entre s, en [0, s). */
const resto = (x: number, x0: number) => (((x - x0) % S) + S + 1e-12) % S;

describe("la retícula de los nervios", () => {
  it("sin paso, la de antes (las celdas enteras, centradas)", () => {
    const [x0, i0, i1] = reticulaCasetones(0, 6, S, C);
    expect(x0).toBeCloseTo((6 - (6 * S + C)) / 2 + 0, 12); // 7 celdas enteras caben en 6 m
    expect([i0, i1]).toEqual([-1, 7]);
  });

  it("con paso, un eje de nervio pasa por él", () => {
    for (const p of [0, 0.3, 2.41, -5.17, 13.9]) {
      const xs = ejesNervios(0, 6, S, C, p);
      expect(xs.length).toBeGreaterThan(5);
      for (const x of xs) expect(resto(x, p) < 1e-9 || S - resto(x, p) < 1e-9).toBe(true);
      // Las celdas empiezan a medio nervio de cada eje
      const [x0] = reticulaCasetones(0, 6, S, C, p);
      expect(Math.min(resto(x0 - BW / 2, p), S - resto(x0 - BW / 2, p))).toBeLessThan(1e-9);
    }
  });

  it("los nervios en planta, en la zona aligerada y por el punto de paso", () => {
    const m = modelo({ paso: [2.05, 1.33] });
    const t = nerviosLosa(m.losas![0]!);
    expect(t.length).toBeGreaterThan(10);
    const abacos = m.losas![0]!.reticular!.abacos!;
    for (const [a, b] of t) {
      const v = a[0] === b[0] ? a[0] : a[1] === b[1] ? a[1] : NaN;
      expect(Number.isNaN(v)).toBe(false);
      const p = a[0] === b[0] ? 2.05 : 1.33;
      expect(Math.min(resto(v, p), S - resto(v, p))).toBeLessThan(1e-9);
      const medio: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      expect(abacos.some((ab) => medio[0] > ab[0]![0] && medio[0] < ab[1]![0] && medio[1] > ab[0]![1] && medio[1] < ab[2]![1])).toBe(false);
      expect(medio[0] > 0 && medio[0] < 6 && medio[1] > 0 && medio[1] < 5).toBe(true);
    }
  });

  it("girados, según el eje 1", () => {
    const g = 30;
    const m = modelo({ paso: [1, 1] }, g);
    const [c, s] = [Math.cos((g * Math.PI) / 180), Math.sin((g * Math.PI) / 180)];
    const t = nerviosLosa(m.losas![0]!);
    expect(t.length).toBeGreaterThan(0);
    for (const [a, b] of t) {
      const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
      const L = Math.hypot(...d);
      // Según el eje 1 o su perpendicular
      const segunE1 = Math.abs(d[0] * c + d[1] * s) / L > 1 - 1e-9;
      expect(segunE1 || Math.abs(-d[0] * s + d[1] * c) / L > 1 - 1e-9).toBe(true);
      // Su coordenada transversal, por el punto de paso
      const tq = segunE1 ? -(a[0] - 1) * s + (a[1] - 1) * c : (a[0] - 1) * c + (a[1] - 1) * s;
      expect(Math.min(resto(tq, 0), S - resto(tq, 0))).toBeLessThan(1e-9);
    }
  });

  it("el punto para cogerla: el dado o el cruce más cercano al centro", () => {
    expect(puntoPasoNervios(modelo({ paso: [9, 9] }).losas![0]!)).toEqual([9, 9]);
    const p = puntoPasoNervios(modelo().losas![0]!)!;
    expect(ejesNervios(0, 6, S, C)).toContain(p[0]);
    expect(ejesNervios(0, 5, S, C)).toContain(p[1]);
    expect(Math.abs(p[0] - 3)).toBeLessThanOrEqual(S / 2 + 1e-9);
    expect(Math.abs(p[1] - 2.5)).toBeLessThanOrEqual(S / 2 + 1e-9);
  });

  it("se dibujan en planta (estilo nervio) y no en la vista atenuada", () => {
    const m = modelo({ paso: [1, 1] });
    const pl = new PlantaFisica(m, "N1");
    const nervios = (atenuado: boolean) => fondoModelo(pl, { atenuado }).primitivas.filter((x) => "estilo" in x && x.estilo === "nervio").length;
    expect(nervios(false)).toBe(nerviosLosa(pl.f.losas![0]!).length);
    expect(nervios(true)).toBe(0);
  });
});

describe("no cambia el cálculo", () => {
  it("el mismo modelo analítico con y sin paso", () => {
    const a = compilar(modelo());
    const b = compilar(modelo({ paso: [0.37, 4.1] }));
    expect(a.valido && b.valido).toBe(true);
    if (!a.valido || !b.valido) return;
    expect(JSON.stringify(b.modelo)).toBe(JSON.stringify(a.modelo));
  });

  it("un paso mal formado es un error", () => {
    const r = compilar(modelo({ paso: [1] as unknown as Vec2 }));
    expect(r.valido).toBe(false);
  });
});

describe("en el editor", () => {
  it("la tabla Forjados lo lee y lo escribe", () => {
    const m = modelo({ paso: [1.25, -0.5] });
    const ctx = contexto(m);
    const l = m.losas![0]!;
    const f = DEF_TABLAS.forjados.fila(l as never, ctx);
    expect(f.paso).toBe("1,25 -0,5");
    const r = DEF_TABLAS.forjados.objeto(f, ctx, l as never);
    expect(r.ok && (r.objeto as unknown as Losa).reticular!.paso).toEqual([1.25, -0.5]);
    const vacio = DEF_TABLAS.forjados.objeto({ ...f, paso: "" }, ctx, l as never);
    expect(vacio.ok && (vacio.objeto as unknown as Losa).reticular!.paso).toBeUndefined();
    expect(DEF_TABLAS.forjados.objeto({ ...f, paso: "1 2; 3 4" }, ctx, l as never).ok).toBe(false);
  });

  it("Mover y Girar lo llevan con la losa", () => {
    const m = modelo({ paso: [1, 2] });
    const r = transformar(m, ["L"], { tipo: "mover", de: [0, 0], a: [3, 1] });
    expect(r.ok).toBe(true);
    if (!r.ok || r.operacion.op !== "cambiar") throw new Error("se esperaba un cambio");
    expect((r.operacion.objeto as unknown as Losa).reticular!.paso).toEqual([4, 3]);
    const g = transformar(m, ["L"], { tipo: "girar", centro: [0, 0], angulo: 90 });
    if (!g.ok || g.operacion.op !== "cambiar") throw new Error("se esperaba un cambio");
    expect((g.operacion.objeto as unknown as Losa).reticular!.paso).toEqual([-2, 1]);
  });

  it("su pinzamiento lo cambia (también sin paso dado)", () => {
    const m = modelo();
    const a = asas(m, ["L"], "N1").find((x) => x.ruta[0] === "reticular");
    expect(a?.p).toEqual(puntoPasoNervios(m.losas![0]!));
    const r = moverAsa(m, a!, [2.5, 2.5]);
    if (!r.ok || r.operacion.op !== "cambiar") throw new Error("se esperaba un cambio");
    const l = r.operacion.objeto as unknown as Losa;
    expect(l.reticular!.paso).toEqual([2.5, 2.5]);
    expect(l.contorno).toEqual(m.losas![0]!.contorno);
  });
});
