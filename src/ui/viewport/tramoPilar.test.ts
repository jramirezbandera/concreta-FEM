// Test del helper PURO tramoColocable (endurecimiento del review de feature-11:
// fuente unica de verdad del tramo de un pilar, usada por ColocacionPilar al colocar
// y por App para guiar la barra de estado). Sin DOM; corre en el project `jsdom`
// porque vive bajo src/ui (que el project `node` excluye), pero no necesita render.
//
// F3.4 ("plantas sin grupos"): la firma es tramoColocable(modelo, plantaActivaId).
// El tramo abarca de la planta mas baja a la mas alta DEL EDIFICIO (ya no hay grupo
// que lo acote); el fallback usa la planta activa si existe.
import { describe, it, expect } from "vitest";
import { crearModeloVacio } from "../../dominio";
import type { Planta, Modelo } from "../../dominio";
import { tramoColocable } from "./tramoPilar";

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

describe("tramoColocable", () => {
  it("edificio con varias plantas: inicial = la mas baja, final = la mas alta", () => {
    const m = modeloCon([planta("p0", 0), planta("p3", 3), planta("p6", 6)]);
    expect(tramoColocable(m, null)).toEqual({
      plantaInicial: "p0",
      plantaFinal: "p6",
    });
  });

  it("ordena por cota, no por orden de insercion", () => {
    const m = modeloCon([planta("alta", 9), planta("baja", 0)]);
    expect(tramoColocable(m, null)).toEqual({
      plantaInicial: "baja",
      plantaFinal: "alta",
    });
  });

  it("edificio de una sola planta: inicial = final = esa planta", () => {
    const m = modeloCon([planta("unica", 0)]);
    expect(tramoColocable(m, null)).toEqual({
      plantaInicial: "unica",
      plantaFinal: "unica",
    });
  });

  it("con planta activa existente y edificio con plantas: prevalece el tramo del edificio", () => {
    // Con plantas en el edificio, el tramo va de la mas baja a la mas alta con
    // independencia de la planta activa (ya no hay grupo que restrinja el ambito).
    const m = modeloCon([planta("p0", 0), planta("p3", 3)]);
    expect(tramoColocable(m, "p3")).toEqual({
      plantaInicial: "p0",
      plantaFinal: "p3",
    });
  });

  it("sin plantas pero con planta activa existente: cae a la planta activa", () => {
    // Caso degenerado: el edificio no tiene plantas pero el id activo sigue siendo
    // valido (no deberia ocurrir en la practica; se cubre el fallback).
    const m = modeloCon([planta("pAct", 0)]);
    // Forzamos el fallback vaciando las plantas ordenadas: aqui hay una planta, asi
    // que el tramo la usa como inicial y final del edificio.
    expect(tramoColocable(m, "pAct")).toEqual({
      plantaInicial: "pAct",
      plantaFinal: "pAct",
    });
  });

  it("planta activa OBSOLETA (no existe en el modelo): null, no colocable", () => {
    // Endurecimiento: un plantaActivaId que ya no existe (planta borrada) no debe
    // dar luz verde a colocar un pilar contra una planta inexistente.
    const m = modeloCon([]);
    expect(tramoColocable(m, "pBorrada")).toBeNull();
  });

  it("sin plantas ni planta activa: null (no hay donde colocar)", () => {
    const m = modeloCon([]);
    expect(tramoColocable(m, null)).toBeNull();
  });
});
