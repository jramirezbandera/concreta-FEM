// Tests de diagramaAnotaciones (UX-H5): helpers puros de DiagramaBarra para las
// anotaciones de maximo/minimo y la unidad del hover. Sin Plotly (testeable en jsdom).
import { describe, it, expect } from "vitest";
import {
  extraerUnidad,
  calcularExtremos,
  anotacionesExtremos,
  fmtValor,
} from "./diagramaAnotaciones";

describe("extraerUnidad", () => {
  it("toma el texto entre parentesis de la etiqueta del eje", () => {
    expect(extraerUnidad("Momento (kN·m)")).toBe("kN·m");
    expect(extraerUnidad("Flecha (mm)")).toBe("mm");
    expect(extraerUnidad("Axil (kN)")).toBe("kN");
  });
  it("sin parentesis devuelve cadena vacia", () => {
    expect(extraerUnidad("Momento")).toBe("");
  });
});

describe("calcularExtremos", () => {
  it("devuelve max y min con su posicion", () => {
    const ext = calcularExtremos([0, 3, 6], [0, 45, 10]);
    expect(ext).not.toBeNull();
    expect(ext!.max).toEqual({ valor: 45, posicion: 3 });
    expect(ext!.min).toEqual({ valor: 0, posicion: 0 });
  });
  it("con valores negativos (voladizo) el minimo es el mas negativo", () => {
    const ext = calcularExtremos([0, 2, 4], [0, -20, -60]);
    expect(ext!.min).toEqual({ valor: -60, posicion: 4 });
    expect(ext!.max).toEqual({ valor: 0, posicion: 0 });
  });
  it("serie vacia o longitudes dispares -> null", () => {
    expect(calcularExtremos([], [])).toBeNull();
    expect(calcularExtremos([0, 1], [0])).toBeNull();
  });
});

describe("fmtValor", () => {
  it("añade la unidad y usa 3 cifras significativas", () => {
    expect(fmtValor(45, "kN·m")).toBe("45 kN·m");
    expect(fmtValor(-10, "mm")).toBe("-10 mm");
  });
  it("sin unidad devuelve solo el numero", () => {
    expect(fmtValor(45, "")).toBe("45");
  });
});

describe("anotacionesExtremos (UX-H5)", () => {
  it("produce dos anotaciones (max arriba, min abajo) con valor + unidad", () => {
    const ext = calcularExtremos([0, 3, 6], [0, 45, 10]);
    const anot = anotacionesExtremos(ext, "kN·m");
    expect(anot).toHaveLength(2);
    const max = anot.find((a) => a.anclaje === "top")!;
    const min = anot.find((a) => a.anclaje === "bottom")!;
    expect(max).toMatchObject({ x: 3, y: 45, texto: "45 kN·m" });
    expect(min).toMatchObject({ x: 0, y: 0, texto: "0 kN·m" });
  });

  it("diagrama plano (max === min) produce una sola marca", () => {
    const ext = calcularExtremos([0, 1, 2], [5, 5, 5]);
    const anot = anotacionesExtremos(ext, "kN");
    expect(anot).toHaveLength(1);
    expect(anot[0]!.texto).toBe("5 kN");
  });

  it("sin extremos (null) no produce anotaciones", () => {
    expect(anotacionesExtremos(null, "kN")).toEqual([]);
  });
});
