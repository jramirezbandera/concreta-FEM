// Tests del helper de coherencia seccion<->material (auditoria UI/UX D15). Proyecto
// `node`: puro (lee catalogo + seccion de obra). Verifican los 4 casos: perfil+acero
// (coherente), perfil+hormigon (aviso), hormigon+acero (aviso), hormigon+hormigon
// (coherente); mas los casos indeterminados (generico / material inexistente).
import { describe, it, expect } from "vitest";
import {
  esCombinacionIncoherente,
  esCombinacionIncoherentePorId,
  mensajeCoherencia,
} from "./index";
import { listarSecciones } from "./index";
import type { Seccion } from "../dominio/seccion";

// Secciones de obra de muestra.
const rectHormigon: Seccion = {
  id: "sec-h",
  nombre: "HA 30×30",
  tipo: "hormigonRectangular",
  b: 0.3,
  h: 0.3,
};
const circHormigon: Seccion = {
  id: "sec-c",
  nombre: "HA Ø30",
  tipo: "hormigonCircular",
  d: 0.3,
};
const perfilObra: Seccion = {
  id: "sec-p",
  nombre: "IPE 300",
  tipo: "perfilMetalico",
  perfilId: "IPE300",
};
const generica: Seccion = {
  id: "sec-g",
  nombre: "Genérica",
  tipo: "generico",
  A: 0.01,
  Iy: 1e-4,
  Iz: 1e-5,
  J: 1e-6,
};

describe("esCombinacionIncoherente (por objeto seccion)", () => {
  it("hormigon + acero => incoherente, con mensaje", () => {
    const r = esCombinacionIncoherente(rectHormigon, "S275");
    expect(r.incoherente).toBe(true);
    expect(mensajeCoherencia(r)).toBe(
      "Sección de hormigón con material de acero: revisa la combinación.",
    );
  });

  it("perfil metalico + hormigon => incoherente, con mensaje", () => {
    const r = esCombinacionIncoherente(perfilObra, "HA-25");
    expect(r.incoherente).toBe(true);
    expect(mensajeCoherencia(r)).toBe(
      "Sección de perfil metálico con material de hormigón: revisa la combinación.",
    );
  });

  it("hormigon + hormigon => coherente (sin mensaje)", () => {
    const r = esCombinacionIncoherente(rectHormigon, "HA-25");
    expect(r.incoherente).toBe(false);
    expect(mensajeCoherencia(r)).toBeUndefined();
  });

  it("perfil + acero => coherente (sin mensaje)", () => {
    const r = esCombinacionIncoherente(perfilObra, "S355");
    expect(r.incoherente).toBe(false);
  });

  it("circular hormigon + acero => incoherente", () => {
    expect(esCombinacionIncoherente(circHormigon, "S235").incoherente).toBe(true);
  });

  it("seccion generica (sin familia) => nunca avisa", () => {
    expect(esCombinacionIncoherente(generica, "S275").incoherente).toBe(false);
    expect(esCombinacionIncoherente(generica, "HA-25").incoherente).toBe(false);
  });

  it("material inexistente => nunca avisa (indeterminado)", () => {
    expect(esCombinacionIncoherente(rectHormigon, "NO-EXISTE").incoherente).toBe(false);
  });
});

describe("esCombinacionIncoherentePorId (por id de seccion)", () => {
  const obra: Seccion[] = [rectHormigon, perfilObra];

  it("id de seccion de obra de hormigon + acero => incoherente", () => {
    expect(
      esCombinacionIncoherentePorId("sec-h", "S275", obra).incoherente,
    ).toBe(true);
  });

  it("id de PERFIL DE CATALOGO (no en obra) + hormigon => incoherente", () => {
    const perfilCatalogo = listarSecciones()[0].id; // IPE/HEB del catalogo
    expect(
      esCombinacionIncoherentePorId(perfilCatalogo, "HA-25", obra).incoherente,
    ).toBe(true);
  });

  it("seccionId o materialId null => no avisa", () => {
    expect(esCombinacionIncoherentePorId(null, "S275", obra).incoherente).toBe(false);
    expect(esCombinacionIncoherentePorId("sec-h", null, obra).incoherente).toBe(false);
  });

  it("id de seccion desconocido (ni obra ni catalogo) => no avisa", () => {
    expect(
      esCombinacionIncoherentePorId("fantasma", "S275", obra).incoherente,
    ).toBe(false);
  });
});
