import { describe, it, expect } from "vitest";
import {
  femAEscena,
  dispFemAEscena,
  puntoFemDesplazadoAEscena,
} from "./ejesEscena";

describe("ejesEscena", () => {
  it("femAEscena intercambia Y<->Z (FEM Y-up -> escena Z-up)", () => {
    // FEM [xPlanta, cota, yPlanta] -> escena [xPlanta, yPlanta, cota].
    expect(femAEscena(1, 2, 3)).toEqual([1, 3, 2]);
  });

  it("dispFemAEscena aplica el mismo intercambio al desplazamiento", () => {
    expect(dispFemAEscena(1, 2, 3)).toEqual([1, 3, 2]);
  });

  it("puntoFemDesplazadoAEscena combina base + disp*escala con intercambio Y<->Z", () => {
    // base FEM (10, 20, 30), disp FEM (1, 2, 3), escala 2.
    // escena = [bx + dx*e, bz + dz*e, by + dy*e] = [12, 36, 24].
    expect(puntoFemDesplazadoAEscena(10, 20, 30, 1, 2, 3, 2)).toEqual([12, 36, 24]);
  });

  it("con escala 0 el punto coincide con la base proyectada (femAEscena)", () => {
    expect(puntoFemDesplazadoAEscena(10, 20, 30, 9, 9, 9, 0)).toEqual(
      femAEscena(10, 20, 30),
    );
  });
});
