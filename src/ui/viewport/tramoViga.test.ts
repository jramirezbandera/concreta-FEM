// Test del helper PURO plantaColocableViga (feature-12: fuente unica de verdad de
// LA planta donde cae una viga, usada por ColocacionViga al colocar y por App para
// guiar la barra de estado). Sin DOM; corre en el project `jsdom` porque vive bajo
// src/ui (que el project `node` excluye), pero no necesita render.
//
// F3.4 ("plantas sin grupos"): la firma es plantaColocableViga(modelo, plantaActivaId).
// Sin grupo que acote el ambito: planta activa valida o, en su defecto, la planta mas
// baja del edificio.
import { describe, it, expect } from "vitest";
import { crearModeloVacio } from "../../dominio";
import type { Planta, Modelo } from "../../dominio";
import { plantaColocableViga } from "./tramoViga";

const planta = (id: string, cota: number): Planta => ({
  id,
  nombre: id,
  cota,
  altura: 3,
  categoriaUso: "A",
  sobrecargaUso: 0,
  cargasMuertas: 0,
});
const modeloCon = (plantas: Planta[]): Modelo => ({
  ...crearModeloVacio(),
  plantas,
});

describe("plantaColocableViga", () => {
  it("planta activa valida: se usa esa", () => {
    const m = modeloCon([planta("p0", 0), planta("p3", 3)]);
    expect(plantaColocableViga(m, "p3")).toBe("p3");
  });

  it("sin planta activa: cae a la planta mas baja por cota del edificio", () => {
    const m = modeloCon([planta("alta", 9), planta("baja", 0), planta("media", 3)]);
    expect(plantaColocableViga(m, null)).toBe("baja");
  });

  it("planta activa OBSOLETA (no existe): cae a la primera del edificio", () => {
    const m = modeloCon([planta("p0", 0)]);
    expect(plantaColocableViga(m, "pBorrada")).toBe("p0");
  });

  it("sin plantas y sin planta activa: null", () => {
    const m = modeloCon([]);
    expect(plantaColocableViga(m, null)).toBeNull();
  });

  it("sin plantas y con planta activa obsoleta: null (no hay donde colocar)", () => {
    const m = modeloCon([]);
    expect(plantaColocableViga(m, "pBorrada")).toBeNull();
  });
});
