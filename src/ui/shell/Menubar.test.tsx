// Test del DISPATCH del Menubar (hueco detectado en el review de ingenieria de
// feature-11: las acciones de menu de F11 no tenian cobertura). Project `jsdom`.
//
// El clic real abre un Popover de Radix (inestable en jsdom), asi que se prueba la
// LOGICA de los handlers directamente contra los stores reales, via la costura de
// test exportada (`borrarSeleccion`, `DISPATCH`) — mismo patron que
// clicSeleccionPilar en GeometriaModelo.test. Lo que importa cubrir es el
// comportamiento con guardas de `borrarSeleccion` (solo borra un pilar; no-op en
// cualquier otro caso) y el cableado de `activarHerramientaPilar`.
import { describe, it, expect, beforeEach } from "vitest";
import { borrarSeleccion, DISPATCH } from "./Menubar";
import {
  modeloStore,
  seleccionStore,
  vistaStore,
  crearGrupo,
  crearPlanta,
  crearPilar,
  crearViga,
} from "../../estado";
import { crearModeloVacio, plantasDeGrupo } from "../../dominio";
import { listarSecciones, listarMateriales } from "../../biblioteca";

const modelo = () => modeloStore.getState().getModelo();

// Siembra un grupo + una planta con los comandos reales. Devuelve el id de la
// planta creada (raiz comun de sembrarPilar/sembrarViga).
function sembrarGrupoPlanta(): string {
  modeloStore
    .getState()
    .ejecutar(
      crearGrupo(modelo(), { categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 }),
    );
  const grupoId = modelo().grupos[0]!.id;
  modeloStore
    .getState()
    .ejecutar(crearPlanta(modelo(), { cota: 0, altura: 3, grupoId }));
  return plantasDeGrupo(modelo(), grupoId)[0]!.id;
}

// Siembra un grupo + una planta + un pilar. Devuelve el id del pilar creado.
function sembrarPilar(): string {
  const plantaId = sembrarGrupoPlanta();
  modeloStore.getState().ejecutar(
    crearPilar(modelo(), {
      x: 0,
      y: 0,
      plantaInicial: plantaId,
      plantaFinal: plantaId,
      seccionId: listarSecciones()[0]!.id,
      materialId: listarMateriales()[0]!.id,
      angulo: 0,
      vinculacionExterior: true,
      arranque: "empotrado",
    }),
  );
  return modelo().pilares[0]!.id;
}

// Siembra un grupo + una planta + una viga. Devuelve el id de la viga creada.
function sembrarViga(): string {
  const plantaId = sembrarGrupoPlanta();
  modeloStore.getState().ejecutar(
    crearViga(modelo(), {
      plantaId,
      i: { x: 0, y: 0 },
      j: { x: 5, y: 0 },
      seccionId: listarSecciones()[0]!.id,
      materialId: listarMateriales()[0]!.id,
      extremoI: "empotrado",
      extremoJ: "empotrado",
      tirante: false,
    }),
  );
  return modelo().vigas[0]!.id;
}

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  seleccionStore.getState().limpiar();
  vistaStore.getState().setHerramienta("seleccion");
});

describe("Menubar · borrarSeleccion", () => {
  it("borra el pilar seleccionado y limpia la selección", () => {
    const pilarId = sembrarPilar();
    seleccionStore.getState().seleccionar([pilarId]);
    borrarSeleccion();
    expect(modelo().pilares).toHaveLength(0);
    expect(seleccionStore.getState().seleccion).toHaveLength(0);
  });

  it("borra la viga seleccionada y limpia la selección", () => {
    const vigaId = sembrarViga();
    seleccionStore.getState().seleccionar([vigaId]);
    borrarSeleccion();
    expect(modelo().vigas).toHaveLength(0);
    expect(seleccionStore.getState().seleccion).toHaveLength(0);
  });

  it("es no-op sin selección (no toca el modelo)", () => {
    sembrarPilar();
    expect(modelo().pilares).toHaveLength(1);
    borrarSeleccion();
    expect(modelo().pilares).toHaveLength(1);
  });

  it("es no-op con varios elementos seleccionados", () => {
    const pilarId = sembrarPilar();
    seleccionStore.getState().seleccionar([pilarId, "otro-id"]);
    borrarSeleccion();
    expect(modelo().pilares).toHaveLength(1);
  });

  it("es no-op si el id seleccionado no es un pilar del modelo", () => {
    sembrarPilar();
    seleccionStore.getState().seleccionar(["id-fantasma"]);
    borrarSeleccion();
    expect(modelo().pilares).toHaveLength(1);
    // La selección no se limpia: no hubo borrado.
    expect(seleccionStore.getState().seleccion).toEqual(["id-fantasma"]);
  });
});

describe("Menubar · DISPATCH", () => {
  it("activarHerramientaPilar conmuta la herramienta a 'pilar'", () => {
    expect(vistaStore.getState().herramienta).toBe("seleccion");
    DISPATCH.activarHerramientaPilar();
    expect(vistaStore.getState().herramienta).toBe("pilar");
  });

  it("activarHerramientaViga conmuta la herramienta a 'viga'", () => {
    expect(vistaStore.getState().herramienta).toBe("seleccion");
    DISPATCH.activarHerramientaViga();
    expect(vistaStore.getState().herramienta).toBe("viga");
  });

  it("cablea borrarSeleccion en el mapa de acciones", () => {
    expect(DISPATCH.borrarSeleccion).toBe(borrarSeleccion);
  });

  it('abrirHipotesis abre el diálogo "hipotesis"', () => {
    expect(vistaStore.getState().dialogoActivo).toBeNull();
    DISPATCH.abrirHipotesis();
    expect(vistaStore.getState().dialogoActivo).toBe("hipotesis");
    vistaStore.getState().cerrarDialogo();
  });
});
