// Test del helper PURO tramoColocable (endurecimiento del review de feature-11:
// fuente unica de verdad del tramo de un pilar, usada por ColocacionPilar al colocar
// y por App para guiar la barra de estado). Sin DOM; corre en el project `jsdom`
// porque vive bajo src/ui (que el project `node` excluye), pero no necesita render.
import { describe, it, expect } from "vitest";
import { crearModeloVacio } from "../../dominio";
import type { Grupo, Planta, Modelo } from "../../dominio";
import { tramoColocable } from "./tramoPilar";

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

describe("tramoColocable", () => {
  it("grupo con varias plantas: inicial = la mas baja, final = la mas alta", () => {
    const m = modeloCon(
      [grupo("g1")],
      [planta("p0", "g1", 0), planta("p3", "g1", 3), planta("p6", "g1", 6)],
    );
    expect(tramoColocable(m, "g1", null)).toEqual({
      plantaInicial: "p0",
      plantaFinal: "p6",
    });
  });

  it("ordena por cota, no por orden de insercion", () => {
    const m = modeloCon(
      [grupo("g1")],
      [planta("alta", "g1", 9), planta("baja", "g1", 0)],
    );
    expect(tramoColocable(m, "g1", null)).toEqual({
      plantaInicial: "baja",
      plantaFinal: "alta",
    });
  });

  it("grupo de una sola planta: inicial = final = esa planta", () => {
    const m = modeloCon([grupo("g1")], [planta("unica", "g1", 0)]);
    expect(tramoColocable(m, "g1", null)).toEqual({
      plantaInicial: "unica",
      plantaFinal: "unica",
    });
  });

  it("grupo sin plantas pero con planta activa existente: cae a la planta activa", () => {
    // La planta activa pertenece a otro grupo (g2); g1 no tiene plantas, asi que el
    // fallback usa la planta activa, que SI existe en el modelo.
    const m = modeloCon([grupo("g1"), grupo("g2")], [planta("pAct", "g2", 0)]);
    expect(tramoColocable(m, "g1", "pAct")).toEqual({
      plantaInicial: "pAct",
      plantaFinal: "pAct",
    });
  });

  it("sin grupo pero con planta activa existente: usa la planta activa", () => {
    const m = modeloCon([grupo("g1")], [planta("pAct", "g1", 0)]);
    expect(tramoColocable(m, null, "pAct")).toEqual({
      plantaInicial: "pAct",
      plantaFinal: "pAct",
    });
  });

  it("planta activa OBSOLETA (no existe en el modelo): null, no colocable", () => {
    // Endurecimiento: un plantaActivaId que ya no existe (planta borrada) no debe
    // dar luz verde a colocar un pilar contra una planta inexistente.
    const m = modeloCon([], []);
    expect(tramoColocable(m, null, "pBorrada")).toBeNull();
    expect(tramoColocable(m, "g1", "pBorrada")).toBeNull();
  });

  it("sin grupo ni planta activos: null (no hay donde colocar)", () => {
    const m = modeloCon([], []);
    expect(tramoColocable(m, null, null)).toBeNull();
  });

  it("grupo sin plantas y sin planta activa: null", () => {
    const m = modeloCon([grupo("g1")], []);
    expect(tramoColocable(m, "g1", null)).toBeNull();
  });
});
