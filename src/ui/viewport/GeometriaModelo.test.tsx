// Tests del gating por herramienta del picking de pilares (feature-11, Tarea 2.2).
//
// El clic real sobre el InstancedMesh requiere WebGL/raycaster (no disponible en
// jsdom), por lo que NO renderizamos la escena. En su lugar ejercitamos el handler
// `clicSeleccionPilar`, que encapsula la unica logica nueva: respetar la
// herramienta activa de vistaStore. Verificamos contra los stores reales que:
//   - en modo "seleccion" el clic fija seleccion unica (y shift alterna),
//   - en modo "pilar" el clic NO selecciona (la colocacion tiene prioridad).
// Asi se cubre la decision load-bearing sin tocar three.js.
//
// F3.4 ("plantas sin grupos"): la sincronizacion de contexto en 3D fija solo la
// planta activa (ya no hay grupo).
import { describe, it, expect, beforeEach } from "vitest";
import { clicSeleccionPilar, clicSeleccionViga } from "./GeometriaModelo";
import { modeloStore, seleccionStore, vistaStore } from "../../estado";
import { crearModeloVacio } from "../../dominio";
import type { Modelo, Planta, Pilar, Viga } from "../../dominio";

// --- Modelo de contexto para los tests de sincronizacion 3D (F1.3) -----------
function planta(id: string, cota: number): Planta {
  return {
    id, nombre: id, cota, altura: 3,
    categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0,
  };
}
function pilar(id: string, plantaInicial: string, plantaFinal: string): Pilar {
  return {
    id, nombre: id, x: 0, y: 0, plantaInicial, plantaFinal,
    seccionId: "s1", materialId: "m1", angulo: 0,
    vinculacionExterior: true, arranque: "empotrado",
  };
}
function viga(id: string, plantaId: string): Viga {
  return {
    id, nombre: id, plantaId, nudoI: "n1", nudoJ: "n2",
    seccionId: "s1", materialId: "m1", extremoI: "empotrado", extremoJ: "empotrado",
    tirante: false,
  };
}
// Edificio: p0 cota 0, p1 cota 3, p2 cota 6. pilar "pa" (pie p0); viga "vb" en p2.
function modeloContexto(): Modelo {
  return {
    ...crearModeloVacio(),
    plantas: [planta("p0", 0), planta("p1", 3), planta("p2", 6)],
    pilares: [pilar("pa", "p0", "p1")],
    vigas: [viga("vb", "p2")],
  };
}

beforeEach(() => {
  seleccionStore.getState().limpiar();
  seleccionStore.getState().setHover(null);
  vistaStore.getState().setHerramienta("seleccion");
  // Estado de vista por defecto: planta (los tests de gating asumen modoVista planta,
  // donde la sincronizacion de contexto no actua).
  vistaStore.getState().setModoVista("planta");
  vistaStore.getState().setPlantaActiva(null);
  vistaStore.getState().setPestanaActiva("entradaPilares");
  modeloStore.getState().cargarModelo(modeloContexto());
});

describe("clicSeleccionPilar: gating por herramienta activa", () => {
  it("en modo 'seleccion' fija seleccion unica", () => {
    clicSeleccionPilar("P1", false);
    expect(seleccionStore.getState().seleccion).toEqual(["P1"]);

    // Otro clic (sin shift) reemplaza: sigue siendo seleccion unica.
    clicSeleccionPilar("P2", false);
    expect(seleccionStore.getState().seleccion).toEqual(["P2"]);
  });

  it("en modo 'seleccion' con shift alterna (multiseleccion explicita)", () => {
    clicSeleccionPilar("P1", false);
    clicSeleccionPilar("P2", true);
    expect(seleccionStore.getState().seleccion.sort()).toEqual(["P1", "P2"]);

    // Shift sobre uno ya seleccionado lo quita.
    clicSeleccionPilar("P1", true);
    expect(seleccionStore.getState().seleccion).toEqual(["P2"]);
  });

  it("en modo 'pilar' NO selecciona (prioridad de la colocacion)", () => {
    vistaStore.getState().setHerramienta("pilar");
    clicSeleccionPilar("P1", false);
    expect(seleccionStore.getState().seleccion).toEqual([]);
  });

  it("en modo 'pilar' NO altera una seleccion previa", () => {
    clicSeleccionPilar("P1", false); // modo seleccion
    vistaStore.getState().setHerramienta("pilar");
    clicSeleccionPilar("P2", false);
    expect(seleccionStore.getState().seleccion).toEqual(["P1"]);
  });

  it("en modo 'viga' tampoco selecciona pilares (gating !== 'seleccion')", () => {
    vistaStore.getState().setHerramienta("viga");
    clicSeleccionPilar("P1", false);
    expect(seleccionStore.getState().seleccion).toEqual([]);
  });
});

describe("clicSeleccionViga: gating por herramienta activa (feature-12)", () => {
  it("en modo 'seleccion' fija seleccion unica", () => {
    clicSeleccionViga("V1", false);
    expect(seleccionStore.getState().seleccion).toEqual(["V1"]);

    // Otro clic (sin shift) reemplaza: sigue siendo seleccion unica.
    clicSeleccionViga("V2", false);
    expect(seleccionStore.getState().seleccion).toEqual(["V2"]);
  });

  it("en modo 'seleccion' con shift alterna (multiseleccion explicita)", () => {
    clicSeleccionViga("V1", false);
    clicSeleccionViga("V2", true);
    expect(seleccionStore.getState().seleccion.sort()).toEqual(["V1", "V2"]);

    // Shift sobre una ya seleccionada la quita.
    clicSeleccionViga("V1", true);
    expect(seleccionStore.getState().seleccion).toEqual(["V2"]);
  });

  it("en modo 'viga' NO selecciona (prioridad de la colocacion)", () => {
    vistaStore.getState().setHerramienta("viga");
    clicSeleccionViga("V1", false);
    expect(seleccionStore.getState().seleccion).toEqual([]);
  });

  it("en modo 'pilar' tampoco selecciona vigas", () => {
    vistaStore.getState().setHerramienta("pilar");
    clicSeleccionViga("V1", false);
    expect(seleccionStore.getState().seleccion).toEqual([]);
  });

  it("en modo 'viga' NO altera una seleccion previa", () => {
    clicSeleccionViga("V1", false); // modo seleccion
    vistaStore.getState().setHerramienta("viga");
    clicSeleccionViga("V2", false);
    expect(seleccionStore.getState().seleccion).toEqual(["V1"]);
  });
});

// --- Sincronizacion de contexto al pickear en 3D (F1.3) ----------------------

describe("sincronizar contexto al pickear en 3D", () => {
  it("pick de pilar en 3D fija la planta del pie y cambia a la pestana de pilares", () => {
    vistaStore.getState().setModoVista("3d");
    vistaStore.getState().setPestanaActiva("entradaVigas"); // partimos de otra pestana
    clicSeleccionPilar("pa", false);
    const v = vistaStore.getState();
    expect(v.plantaActivaId).toBe("p0"); // pie (cota menor)
    expect(v.pestanaActiva).toBe("entradaPilares");
    expect(seleccionStore.getState().seleccion).toEqual(["pa"]);
  });

  it("pick de viga en 3D fija su planta y cambia a la pestana de vigas", () => {
    vistaStore.getState().setModoVista("3d");
    vistaStore.getState().setPestanaActiva("entradaPilares");
    clicSeleccionViga("vb", false);
    const v = vistaStore.getState();
    expect(v.plantaActivaId).toBe("p2");
    expect(v.pestanaActiva).toBe("entradaVigas");
  });

  it("en 3D, shift-multiseleccion NO mueve el contexto ni la pestana", () => {
    vistaStore.getState().setModoVista("3d");
    vistaStore.getState().setPlantaActiva("p2");
    vistaStore.getState().setPestanaActiva("entradaVigas");
    clicSeleccionPilar("pa", true); // shift
    const v = vistaStore.getState();
    expect(v.plantaActivaId).toBe("p2"); // intacto
    expect(v.pestanaActiva).toBe("entradaVigas");
  });

  it("en modo planta NO se sincroniza contexto (lo gobierna el sidebar)", () => {
    // modoVista por defecto es "planta".
    vistaStore.getState().setPlantaActiva("p2");
    clicSeleccionPilar("pa", false);
    const v = vistaStore.getState();
    expect(v.plantaActivaId).toBe("p2"); // sin cambios
    expect(seleccionStore.getState().seleccion).toEqual(["pa"]); // pero si selecciona
  });

  it("en 3D desde Resultados, sincroniza contexto pero NO saca de la pestana Resultados", () => {
    vistaStore.getState().setModoVista("3d");
    vistaStore.getState().setPestanaActiva("resultados");
    clicSeleccionPilar("pa", false);
    const v = vistaStore.getState();
    expect(v.plantaActivaId).toBe("p0"); // contexto si se mueve
    expect(v.pestanaActiva).toBe("resultados"); // pestana intacta
  });

  it("pick de un id inexistente en 3D no rompe ni cambia el contexto", () => {
    vistaStore.getState().setModoVista("3d");
    vistaStore.getState().setPlantaActiva("p2");
    clicSeleccionPilar("no-existe", false);
    const v = vistaStore.getState();
    expect(v.plantaActivaId).toBe("p2");
  });
});
