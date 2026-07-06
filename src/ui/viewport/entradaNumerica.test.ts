// Test del parser puro de la entrada numerica (UX-2.5). Node-agnostico.
import { describe, expect, it } from "vitest";

import {
  parsearEntradaNumerica,
  resolverPuntoEntrada,
  type ExprNumerica,
} from "./entradaNumerica";

function parseaOk(texto: string): ExprNumerica {
  const r = parsearEntradaNumerica(texto);
  if (!r.ok) throw new Error(`esperaba ok para "${texto}": ${r.error}`);
  return r.expr;
}

describe("parsearEntradaNumerica (UX-2.5)", () => {
  it("absoluta: 'x,y' con decimales y espacios", () => {
    expect(parseaOk("3,4.5")).toEqual({ tipo: "absoluta", x: 3, y: 4.5 });
    expect(parseaOk("  -1.25 , 0 ")).toEqual({ tipo: "absoluta", x: -1.25, y: 0 });
  });

  it("relativa: '@dx,dy' (admite negativos)", () => {
    expect(parseaOk("@2,-1")).toEqual({ tipo: "relativa", dx: 2, dy: -1 });
  });

  it("polar: 'd<a' y '@d<a' son equivalentes", () => {
    expect(parseaOk("3<45")).toEqual({ tipo: "polar", d: 3, anguloGrados: 45 });
    expect(parseaOk("@3<45")).toEqual({ tipo: "polar", d: 3, anguloGrados: 45 });
    // Angulo negativo permitido (giro horario).
    expect(parseaOk("2<-90")).toEqual({ tipo: "polar", d: 2, anguloGrados: -90 });
  });

  it("errores: vacio, una sola coordenada, basura, distancia negativa", () => {
    expect(parsearEntradaNumerica("").ok).toBe(false);
    expect(parsearEntradaNumerica("3").ok).toBe(false);
    expect(parsearEntradaNumerica("a,b").ok).toBe(false);
    expect(parsearEntradaNumerica("3,").ok).toBe(false);
    expect(parsearEntradaNumerica("-2<45").ok).toBe(false);
    expect(parsearEntradaNumerica("3<").ok).toBe(false);
  });
});

describe("resolverPuntoEntrada", () => {
  const BASE = { x: 10, y: 5 };

  it("absoluta no necesita base", () => {
    expect(resolverPuntoEntrada({ tipo: "absoluta", x: 3, y: 4 }, null)).toEqual({
      ok: true,
      x: 3,
      y: 4,
    });
  });

  it("relativa suma a la base", () => {
    expect(
      resolverPuntoEntrada({ tipo: "relativa", dx: 2, dy: -1 }, BASE),
    ).toEqual({ ok: true, x: 12, y: 4 });
  });

  it("polar: 90 grados es +Y EXACTO (sin residuo de cos)", () => {
    const r = resolverPuntoEntrada({ tipo: "polar", d: 3, anguloGrados: 90 }, BASE);
    expect(r).toEqual({ ok: true, x: 10, y: 8 });
  });

  it("polar a 45 grados reparte por igual", () => {
    const r = resolverPuntoEntrada({ tipo: "polar", d: Math.SQRT2, anguloGrados: 45 }, BASE);
    if (!r.ok) throw new Error(r.error);
    expect(r.x).toBeCloseTo(11, 10);
    expect(r.y).toBeCloseTo(6, 10);
  });

  it("relativa/polar sin base: error en lenguaje de obra", () => {
    const r = resolverPuntoEntrada({ tipo: "relativa", dx: 1, dy: 1 }, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/referencia/);
  });
});
