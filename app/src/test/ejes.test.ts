/** Las flechas del alzado: recorren los ejes de una dirección, en el orden de la lista, sin saltar a la otra. */
import { describe, expect, it } from "vitest";
import { ejesParalelos, ejeVecino } from "../armazon/Disposicion.tsx";

const eje = (id: string, desde: [number, number], hasta: [number, number]) => ({ id, desde, hasta, propuesto: true });
// Dos números (horizontales), tres letras (verticales, una dibujada al revés) y una diagonal
const EJES = [eje("1", [0, 0], [10, 0]), eje("2", [0, 5], [10, 5]), eje("A", [0, 0], [0, 5]), eje("B", [4, 5], [4, 0]), eje("C", [8, 0], [8, 5]), eje("D1", [0, 0], [5, 5])];

describe("ejes del alzado", () => {
  it("la familia de un eje son sus paralelos, en el orden de la lista", () => {
    expect(ejesParalelos(EJES, "B").map((x) => x.id)).toEqual(["A", "B", "C"]);
    expect(ejesParalelos(EJES, "1").map((x) => x.id)).toEqual(["1", "2"]);
    expect(ejesParalelos(EJES, "D1").map((x) => x.id)).toEqual(["D1"]);
    expect(ejesParalelos(EJES, "no")).toEqual([]);
  });
  it("el vecino se queda en la familia y es null en los extremos", () => {
    expect(ejeVecino(EJES, "A", 1)).toBe("B");
    expect(ejeVecino(EJES, "C", 1)).toBeNull();
    expect(ejeVecino(EJES, "A", -1)).toBeNull();
    expect(ejeVecino(EJES, "2", -1)).toBe("1");
    expect(ejeVecino(EJES, "2", 1)).toBeNull();
  });
});
