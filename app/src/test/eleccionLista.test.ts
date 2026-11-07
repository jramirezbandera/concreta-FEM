import { describe, expect, it } from "vitest";
import { eleccionLista } from "../armazon/eleccionLista.ts";

const L = ["P1", "P2", "P3", "P4", "P5"];
const sin = { ctrl: false, mayus: false };
const ctrl = { ctrl: true, mayus: false };
const mayus = { ctrl: false, mayus: true };
const ambas = { ctrl: true, mayus: true };

describe("elegir en una lista con Ctrl y Mayús", () => {
  it("clic: sólo ése, y es el ancla", () => {
    expect(eleccionLista(L, ["P1", "P2"], "P1", "P3", sin)).toEqual({ elegidos: ["P3"], ancla: "P3" });
  });
  it("Ctrl+clic añade y quita", () => {
    expect(eleccionLista(L, ["P1"], "P1", "P3", ctrl)).toEqual({ elegidos: ["P1", "P3"], ancla: "P3" });
    expect(eleccionLista(L, ["P1", "P3"], "P3", "P1", ctrl)).toEqual({ elegidos: ["P3"], ancla: "P1" });
  });
  it("Mayús+clic: del ancla a ése, hacia abajo y hacia arriba, sin mover el ancla", () => {
    expect(eleccionLista(L, ["P2"], "P2", "P4", mayus)).toEqual({ elegidos: ["P2", "P3", "P4"], ancla: "P2" });
    expect(eleccionLista(L, ["P2", "P3", "P4"], "P2", "P1", mayus)).toEqual({ elegidos: ["P1", "P2"], ancla: "P2" });
  });
  it("Ctrl+Mayús+clic: el rango además de lo elegido", () => {
    expect(eleccionLista(L, ["X", "P1"], "P3", "P5", ambas)).toEqual({ elegidos: ["X", "P1", "P3", "P4", "P5"], ancla: "P3" });
  });
  it("sin ancla en la lista (otro grupo), Mayús hace de clic", () => {
    expect(eleccionLista(L, ["V1"], "V1", "P2", mayus)).toEqual({ elegidos: ["P2"], ancla: "P2" });
    expect(eleccionLista(L, ["V1"], null, "P2", ambas)).toEqual({ elegidos: ["V1", "P2"], ancla: "P2" });
  });
});
