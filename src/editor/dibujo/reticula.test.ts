/** UI-41 (P-12): la retícula de ejes por sus luces. */
import { describe, expect, it } from "vitest";
import { MARGEN_EJES } from "../../compilador/ejes.ts";
import type { ModeloFisico } from "../../compilador/fisico.ts";
import { aplicar } from "../operaciones.ts";
import { proyectoNuevo } from "../plantilla.ts";
import { leerLuces, operacionReticula } from "./reticula.ts";

describe("leerLuces", () => {
  it("números sueltos y repeticiones, con coma o punto", () => {
    expect(leerLuces("5 5,5 6")).toEqual({ ok: true, luces: [5, 5.5, 6] });
    expect(leerLuces("3×5 4.2")).toEqual({ ok: true, luces: [5, 5, 5, 4.2] });
    expect(leerLuces("2x6; 3")).toEqual({ ok: true, luces: [6, 6, 3] });
    expect(leerLuces("")).toEqual({ ok: true, luces: [] });
    expect(leerLuces("5 -2").ok).toBe(false);
    expect(leerLuces("cinco").ok).toBe(false);
  });
});

describe("operacionReticula", () => {
  it("un 3 × 3 a 5 m: 1, 2, 3 en X y A, B, C en Y, exactos y con su margen; sustituye a los de antes", () => {
    const p = proyectoNuevo("ret");
    const m: ModeloFisico = { ...p.modelo, ejes: [{ id: "Z", desde: [0, 0], hasta: [1, 0] }] };
    const r = operacionReticula(m, { lucesX: [5, 5], lucesY: [5, 5], origen: [1, 2] });
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.ejes.map((e) => e.nombre ?? e.id)).toEqual(["1", "2", "3", "A", "B", "C"]);
    expect(r.ejes[1]).toEqual({ id: "2", desde: [6, 2 - MARGEN_EJES], hasta: [6, 12 + MARGEN_EJES] });
    expect(r.ejes[5]).toEqual({ id: "C", desde: [1 - MARGEN_EJES, 12], hasta: [11 + MARGEN_EJES, 12] });
    const a = aplicar({ ...p, modelo: m }, r.operacion);
    if (!a.ok) throw new Error(JSON.stringify(a.errores));
    expect(a.proyecto.modelo.ejes!.map((e) => e.id)).toEqual(["1", "2", "3", "A", "B", "C"]);
  });

  it("las sumas de luces decimales sin el ruido de la coma flotante; girada, alrededor del origen", () => {
    const m = proyectoNuevo("ret").modelo;
    const r = operacionReticula(m, { lucesX: [0.1, 0.2], lucesY: [] });
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.ejes[2]!.desde[0]).toBe(0.3);
    const g = operacionReticula(m, { lucesX: [4], lucesY: [3], giro: 90 });
    if (!g.ok) throw new Error(g.mensaje);
    // El eje 2 (x = 4) girado 90°: pasa a y = 4
    expect(g.ejes[1]!.desde[1]).toBeCloseTo(4, 12);
    expect(operacionReticula(m, { lucesX: [], lucesY: [] }).ok).toBe(false);
  });
});
