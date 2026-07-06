// Test del modulo puro de guias de alineacion (UX-2.4). Node-agnostico.
import { describe, expect, it } from "vitest";

import { buscarAlineaciones } from "./guiasAlineacion";

const CANDIDATOS = [
  { x: 0, y: 0 },
  { x: 5, y: 0 },
  { x: 5, y: 4 },
  { x: 0, y: 4 },
];

describe("buscarAlineaciones (UX-2.4)", () => {
  it("alinea la X con el pilar de la misma vertical (dentro de tolerancia)", () => {
    const r = buscarAlineaciones(5.08, 2, CANDIDATOS, 0.15);
    expect(r.guiaX).not.toBeNull();
    expect(r.guiaX!.valor).toBe(5);
    expect(r.guiaY).toBeNull();
    expect(r.ajustado).toEqual({ x: 5, y: 2 });
  });

  it("alinea X e Y a la vez (esquina): el cursor cae al cruce exacto", () => {
    const r = buscarAlineaciones(4.9, 3.95, CANDIDATOS, 0.15);
    expect(r.guiaX!.valor).toBe(5);
    expect(r.guiaY!.valor).toBe(4);
    expect(r.ajustado).toEqual({ x: 5, y: 4 });
  });

  it("fuera de tolerancia no hay guias y el cursor no se toca", () => {
    const r = buscarAlineaciones(2.5, 2, CANDIDATOS, 0.15);
    expect(r.guiaX).toBeNull();
    expect(r.guiaY).toBeNull();
    expect(r.ajustado).toEqual({ x: 2.5, y: 2 });
  });

  it("con dos candidatos alineados en la misma X gana el mas cercano al cursor", () => {
    // (5,0) y (5,4) comparten X=5; el cursor esta a la altura de y=3.5 -> origen (5,4).
    const r = buscarAlineaciones(5.05, 3.5, CANDIDATOS, 0.15);
    expect(r.guiaX!.origen).toEqual({ x: 5, y: 4 });
  });

  it("lista vacia: sin guias, cursor intacto", () => {
    const r = buscarAlineaciones(1, 2, [], 0.15);
    expect(r.guiaX).toBeNull();
    expect(r.guiaY).toBeNull();
    expect(r.ajustado).toEqual({ x: 1, y: 2 });
  });
});
