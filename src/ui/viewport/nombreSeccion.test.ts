// Tests del resolutor de nombre de seccion (nombreSeccion.ts, D7a). Cubre las dos familias
// (obra parametrica + catalogo de biblioteca), la conversion m->cm de presentacion y las
// referencias rotas. Node puro (el catalogo es estatico; sin stores).
import { describe, it, expect } from "vitest";
import { nombreSeccion } from "./nombreSeccion";
import type { Seccion } from "../../dominio";

const rectSinNombre: Seccion = {
  id: "s-rect",
  nombre: "",
  tipo: "hormigonRectangular",
  b: 0.3, // m
  h: 0.4, // m
};
const rectConNombre: Seccion = { ...rectSinNombre, id: "s-rect2", nombre: "Zuncho A" };
const circ: Seccion = { id: "s-circ", nombre: "", tipo: "hormigonCircular", d: 0.25 };

describe("nombreSeccion · secciones de obra (Capa 1)", () => {
  it("hormigon rectangular sin nombre -> 'HA {b}×{h}' en cm", () => {
    expect(nombreSeccion("s-rect", [rectSinNombre])).toBe("HA 30×40");
  });
  it("hormigon circular sin nombre -> 'HA Ø{d}' en cm", () => {
    expect(nombreSeccion("s-circ", [circ])).toBe("HA Ø25");
  });
  it("respeta el nombre del usuario si lo puso", () => {
    expect(nombreSeccion("s-rect2", [rectConNombre])).toBe("Zuncho A");
  });
});

describe("nombreSeccion · catalogo de biblioteca (perfiles)", () => {
  it("resuelve un id de perfil a su nombre de UI ('IPE 300')", () => {
    // El id no esta en las secciones de obra: cae al catalogo.
    expect(nombreSeccion("IPE300", [])).toBe("IPE 300");
  });
});

describe("nombreSeccion · referencia rota", () => {
  it("id desconocido -> cadena vacia (la etiqueta rotula solo el nombre del elemento)", () => {
    expect(nombreSeccion("no-existe", [rectSinNombre])).toBe("");
  });
});
