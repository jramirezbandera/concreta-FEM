// Tests del helper puro de etiquetas de elemento (etiquetasElemento.ts, D7a). Node puro:
// sin escena ni stores. Verifica el texto (nombre + seccion, con reglas de "si cabe") y la
// posicion (centro/punto medio, sobre la cara superior).
import { describe, it, expect } from "vitest";
import {
  etiquetasPilares,
  etiquetasVigas,
  type PilarEtiquetable,
  type VigaEtiquetable,
} from "./etiquetasElemento";

describe("etiquetasPilares (D7a)", () => {
  const base: PilarEtiquetable = {
    id: "p1",
    nombre: "P1",
    seccionNombre: "HA 30×30",
    cx: 2,
    cy: 3,
    cz: 1.5,
    alto: 3,
  };

  it("compone 'nombre · seccion' y posa la etiqueta sobre la cabeza (cz+alto/2)", () => {
    const [e] = etiquetasPilares([base]);
    expect(e!.texto).toBe("P1 · HA 30×30");
    expect(e!.x).toBe(2);
    expect(e!.y).toBe(3);
    // cz(1.5) + alto/2(1.5) + eps(0.04) = 3.04
    expect(e!.z).toBeCloseTo(3.04, 5);
    expect(e!.id).toBe("p1");
  });

  it("sin nombre de seccion rotula solo el nombre (sin separador colgando)", () => {
    const [e] = etiquetasPilares([{ ...base, seccionNombre: "" }]);
    expect(e!.texto).toBe("P1");
  });
});

describe("etiquetasVigas (D7a)", () => {
  const larga: VigaEtiquetable = {
    id: "v1",
    nombre: "V3",
    seccionNombre: "HA 30×40",
    ax: 0,
    ay: 0,
    bx: 5,
    by: 0,
    z: 3,
  };

  it("etiqueta en el punto medio, sobre la cota", () => {
    const [e] = etiquetasVigas([larga]);
    expect(e!.x).toBe(2.5);
    expect(e!.y).toBe(0);
    expect(e!.z).toBeCloseTo(3.04, 5);
  });

  it("viga larga: anexa la seccion ('V3 · HA 30×40')", () => {
    const [e] = etiquetasVigas([larga]);
    expect(e!.texto).toBe("V3 · HA 30×40");
  });

  it("viga corta (<1.2 m): rotula solo el nombre (la seccion no cabe)", () => {
    const corta: VigaEtiquetable = { ...larga, bx: 0.5 };
    const [e] = etiquetasVigas([corta]);
    expect(e!.texto).toBe("V3");
  });

  it("sin nombre de seccion: solo el nombre aunque sea larga", () => {
    const [e] = etiquetasVigas([{ ...larga, seccionNombre: "" }]);
    expect(e!.texto).toBe("V3");
  });
});
