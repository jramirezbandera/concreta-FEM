// Test del helper PURO plantaColocableViga (feature-12: fuente unica de verdad de
// LA planta donde cae una viga, usada por ColocacionViga al colocar y por App para
// guiar la barra de estado). Sin DOM; corre en el project `jsdom` porque vive bajo
// src/ui (que el project `node` excluye), pero no necesita render.
import { describe, it, expect } from "vitest";
import { crearModeloVacio } from "../../dominio";
import type { Grupo, Planta, Modelo } from "../../dominio";
import { plantaColocableViga } from "./tramoViga";

const grupo = (id: string): Grupo => ({
  id,
  nombre: id.toUpperCase(),
  categoriaUso: "A",
  sobrecargaUso: 2,
  cargasMuertas: 1,
});
const planta = (id: string, grupoId: string, cota: number): Planta => ({
  id,
  nombre: id,
  cota,
  altura: 3,
  grupoId,
});
const modeloCon = (grupos: Grupo[], plantas: Planta[]): Modelo => ({
  ...crearModeloVacio(),
  grupos,
  plantas,
});

describe("plantaColocableViga", () => {
  it("planta activa valida del grupo activo: se usa esa", () => {
    const m = modeloCon(
      [grupo("g1")],
      [planta("p0", "g1", 0), planta("p3", "g1", 3)],
    );
    expect(plantaColocableViga(m, "g1", "p3")).toBe("p3");
  });

  it("sin planta activa: cae a la planta mas baja por cota del grupo", () => {
    const m = modeloCon(
      [grupo("g1")],
      [planta("alta", "g1", 9), planta("baja", "g1", 0), planta("media", "g1", 3)],
    );
    expect(plantaColocableViga(m, "g1", null)).toBe("baja");
  });

  it("planta activa de OTRO grupo: se ignora, cae a la primera del grupo activo", () => {
    const m = modeloCon(
      [grupo("g1"), grupo("g2")],
      [planta("p0", "g1", 0), planta("pOtro", "g2", 0)],
    );
    expect(plantaColocableViga(m, "g1", "pOtro")).toBe("p0");
  });

  it("planta activa OBSOLETA (no existe): cae a la primera del grupo activo", () => {
    const m = modeloCon([grupo("g1")], [planta("p0", "g1", 0)]);
    expect(plantaColocableViga(m, "g1", "pBorrada")).toBe("p0");
  });

  it("sin grupo activo: null (no hay donde colocar)", () => {
    const m = modeloCon([grupo("g1")], [planta("p0", "g1", 0)]);
    expect(plantaColocableViga(m, null, "p0")).toBeNull();
  });

  it("grupo activo obsoleto (no existe): null", () => {
    const m = modeloCon([grupo("g1")], [planta("p0", "g1", 0)]);
    expect(plantaColocableViga(m, "gBorrado", null)).toBeNull();
  });

  it("grupo activo sin plantas y sin planta activa: null", () => {
    const m = modeloCon([grupo("g1")], []);
    expect(plantaColocableViga(m, "g1", null)).toBeNull();
  });
});
