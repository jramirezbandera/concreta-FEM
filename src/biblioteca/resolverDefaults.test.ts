// Tests de la resolucion de la seccion de obra por defecto (auditoria UI/UX D4+D5).
// Proyecto `node`: puro. Verifican el orden de resolucion: (1) por nombre de la default
// de la biblioteca, (2) primera seccion de obra de hormigon, (3) fallback al catalogo.
import { describe, it, expect } from "vitest";
import {
  resolverSeccionDefault,
  DEFAULT_SECCION_PILAR,
  listarSecciones,
} from "./index";
import type { Seccion } from "../dominio/seccion";

const secHormigon30x30: Seccion = {
  id: "sec-default-pilar",
  nombre: "HA 30×30",
  tipo: "hormigonRectangular",
  b: 0.3,
  h: 0.3,
};
const otraHormigon: Seccion = {
  id: "sec-otra",
  nombre: "HA 40×40",
  tipo: "hormigonRectangular",
  b: 0.4,
  h: 0.4,
};
const perfilObra: Seccion = {
  id: "sec-perfil",
  nombre: "IPE 300",
  tipo: "perfilMetalico",
  perfilId: "IPE300",
};

describe("resolverSeccionDefault", () => {
  it("prioriza la seccion de obra cuyo nombre coincide con la default de la biblioteca", () => {
    const id = resolverSeccionDefault(DEFAULT_SECCION_PILAR.nombre, [
      perfilObra,
      secHormigon30x30,
    ]);
    expect(id).toBe("sec-default-pilar");
  });

  it("si no hay coincidencia por nombre, coge la primera seccion de obra de hormigon", () => {
    const id = resolverSeccionDefault("HA 99×99", [perfilObra, otraHormigon]);
    expect(id).toBe("sec-otra");
  });

  it("si no hay ninguna seccion de obra de hormigon, cae al primer perfil del catalogo", () => {
    const id = resolverSeccionDefault("HA 30×30", [perfilObra]);
    expect(id).toBe(listarSecciones()[0].id);
  });

  it("sin secciones de obra, cae al primer perfil del catalogo", () => {
    const id = resolverSeccionDefault("HA 30×30", []);
    expect(id).toBe(listarSecciones()[0].id);
  });
});
