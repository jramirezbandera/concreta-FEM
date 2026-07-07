import { describe, it, expect } from "vitest";
import {
  proyectarOrtoMuro,
  procesarClicMuro,
  LARGO_MIN_MURO,
} from "./colocacionMuroLogica";

// Tests PUROS del flujo de dos clics del muro (orto FORZADO). Node puro, sin escena.

describe("proyectarOrtoMuro — orto forzado", () => {
  it("dominante en X: proyecta B a la horizontal (B.y := A.y)", () => {
    const a = { x: 0, y: 0 };
    expect(proyectarOrtoMuro(a, { x: 4, y: 0.3 })).toEqual({ x: 4, y: 0 });
  });

  it("dominante en Y: proyecta B a la vertical (B.x := A.x)", () => {
    const a = { x: 1, y: 1 };
    expect(proyectarOrtoMuro(a, { x: 1.2, y: 5 })).toEqual({ x: 1, y: 5 });
  });

  it("empate |dx|==|dy|: gana X (estable)", () => {
    const a = { x: 0, y: 0 };
    expect(proyectarOrtoMuro(a, { x: 3, y: 3 })).toEqual({ x: 3, y: 0 });
    expect(proyectarOrtoMuro(a, { x: -3, y: 3 })).toEqual({ x: -3, y: 0 });
  });
});

describe("procesarClicMuro", () => {
  it("primer clic (sin A pendiente): guarda A", () => {
    expect(procesarClicMuro(null, { x: 2, y: 3 })).toEqual({
      tipo: "guardarA",
      a: { x: 2, y: 3 },
    });
  });

  it("segundo clic: crea con B YA proyectado a orto", () => {
    const r = procesarClicMuro({ x: 0, y: 0 }, { x: 5, y: 0.4 });
    expect(r.tipo).toBe("crear");
    if (r.tipo !== "crear") return;
    expect(r.a).toEqual({ x: 0, y: 0 });
    expect(r.b).toEqual({ x: 5, y: 0 }); // proyectado a X
  });

  it("segundo clic degenerado (extremos coinciden tras proyectar): ignorar", () => {
    // El cursor casi coincide con A: tras proyectar, el eje no tiene longitud.
    const r = procesarClicMuro({ x: 1, y: 1 }, { x: 1 + LARGO_MIN_MURO / 2, y: 1 });
    expect(r.tipo).toBe("ignorar");
  });

  it("un clic perpendicular puro tambien crea (proyecta a Y)", () => {
    const r = procesarClicMuro({ x: 2, y: 0 }, { x: 2.1, y: 4 });
    expect(r.tipo).toBe("crear");
    if (r.tipo !== "crear") return;
    expect(r.b).toEqual({ x: 2, y: 4 }); // proyectado a Y
  });
});
