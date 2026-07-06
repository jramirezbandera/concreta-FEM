// Test del hook usePuedeColocarPilar (hueco detectado en el 2o /plan-eng-review de
// feature-11). El helper PURO tramoColocable ya esta cubierto en tramoPilar.test; lo
// que aqui se verifica es la REACTIVIDAD del hook: que recalcula al cambiar el modelo
// o la planta activa. Project `jsdom`, via renderHook (sin montar App ni el Canvas
// R3F: el hook solo lee/suscribe stores).
//
// F3.4 ("plantas sin grupos"): la colocabilidad depende de que el EDIFICIO tenga
// plantas (tramoColocable devuelve el tramo global mas baja->mas alta) — ya no de que
// haya un grupo/planta ACTIVO. El fallback a la planta activa solo cuenta cuando el
// edificio no tiene plantas (id obsoleto).
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  usePuedeColocarPilar,
  usePuedeColocarViga,
  useMensajeCalculo,
  MENSAJE_CALCULANDO,
  MENSAJE_MOTOR_CARGANDO,
} from "./App";
import {
  modeloStore,
  vistaStore,
  calculoStore,
  crearPlanta,
} from "./estado";
import { crearModeloVacio } from "./dominio";

const modelo = () => modeloStore.getState().getModelo();

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  vistaStore.getState().setPlantaActiva(null);
  // Resetea los defaults de viga (seccion/material): usePuedeColocarViga los exige.
  vistaStore.getState().setDefaultsViga({ seccionId: null, materialId: null });
});

// Crea una planta del edificio y la deja como planta activa (como haria la Sidebar).
function prepararPlanta(): void {
  act(() => {
    modeloStore
      .getState()
      .ejecutar(
        crearPlanta(modelo(), {
          cota: 0,
          altura: 3,
          categoriaUso: "A",
          sobrecargaUso: 0,
          cargasMuertas: 0,
        }),
      );
    vistaStore.getState().setPlantaActiva(modelo().plantas[0]!.id);
  });
}

describe("usePuedeColocarPilar", () => {
  it("false con modelo vacío (sin plantas)", () => {
    const { result } = renderHook(() => usePuedeColocarPilar());
    expect(result.current).toBe(false);
  });

  it("recalcula a true al crear una planta en el edificio", () => {
    const { result } = renderHook(() => usePuedeColocarPilar());
    expect(result.current).toBe(false);
    prepararPlanta();
    expect(result.current).toBe(true);
  });

  it("sigue en true aunque se deseleccione la planta activa (el tramo global existe)", () => {
    // Sin grupos, el tramo de un pilar abarca todo el edificio: mientras haya plantas,
    // se puede colocar aunque no haya una planta ACTIVA seleccionada.
    const { result } = renderHook(() => usePuedeColocarPilar());
    prepararPlanta();
    expect(result.current).toBe(true);
    act(() => {
      vistaStore.getState().setPlantaActiva(null);
    });
    expect(result.current).toBe(true);
  });

  it("false si la planta activa apunta a una planta inexistente y el edificio no tiene plantas", () => {
    // Endurecimiento: un plantaActivaId obsoleto no debe dar luz verde a colocar
    // cuando el edificio esta vacio de plantas.
    const { result } = renderHook(() => usePuedeColocarPilar());
    act(() => {
      vistaStore.getState().setPlantaActiva("p-borrada");
    });
    expect(result.current).toBe(false);
  });
});

// Da seccion/material por defecto a la viga (como haria el PanelHerramientaViga al
// elegirlos): es la SEGUNDA condicion que usePuedeColocarViga exige, ademas de la
// planta colocable.
function fijarDefaultsViga(): void {
  act(() => {
    vistaStore
      .getState()
      .setDefaultsViga({ seccionId: "s-1", materialId: "m-1" });
  });
}

describe("usePuedeColocarViga", () => {
  it("false con modelo vacío, sin plantas ni defaults", () => {
    const { result } = renderHook(() => usePuedeColocarViga());
    expect(result.current).toBe(false);
  });

  it("false si hay planta colocable pero faltan sección/material", () => {
    const { result } = renderHook(() => usePuedeColocarViga());
    prepararPlanta();
    // Hay planta, pero sin defaults de viga no se puede tender una viga valida.
    expect(result.current).toBe(false);
  });

  it("false si hay sección/material pero no hay planta colocable", () => {
    const { result } = renderHook(() => usePuedeColocarViga());
    fijarDefaultsViga();
    expect(result.current).toBe(false);
  });

  it("true cuando hay planta colocable Y sección/material", () => {
    const { result } = renderHook(() => usePuedeColocarViga());
    prepararPlanta();
    fijarDefaultsViga();
    expect(result.current).toBe(true);
  });

  it("vuelve a false si se borra la única planta del edificio", () => {
    const { result } = renderHook(() => usePuedeColocarViga());
    prepararPlanta();
    fijarDefaultsViga();
    expect(result.current).toBe(true);
    act(() => {
      // Vaciar el modelo de plantas retira la planta colocable.
      modeloStore.getState().cargarModelo(crearModeloVacio());
    });
    expect(result.current).toBe(false);
  });

  it("reacciona al cambio de defaults: false al limpiar la sección", () => {
    const { result } = renderHook(() => usePuedeColocarViga());
    prepararPlanta();
    fijarDefaultsViga();
    expect(result.current).toBe(true);
    act(() => {
      vistaStore.getState().setDefaultsViga({ seccionId: null });
    });
    expect(result.current).toBe(false);
  });
});

// UX-L6: la barra de estado refleja el trabajo del motor mientras calcula.
describe("useMensajeCalculo", () => {
  beforeEach(() => {
    calculoStore.getState().setCalculando(false);
    calculoStore.getState().setEstadoMotor("listo");
  });

  it("null en reposo (deja ganar al mensaje contextual)", () => {
    const { result } = renderHook(() => useMensajeCalculo());
    expect(result.current).toBeNull();
  });

  it("'Calculando obra…' mientras hay un cálculo en vuelo", () => {
    const { result } = renderHook(() => useMensajeCalculo());
    act(() => {
      calculoStore.getState().setCalculando(true);
    });
    expect(result.current).toBe(MENSAJE_CALCULANDO);
  });

  it("'Preparando el motor…' mientras el motor carga (y no hay cálculo)", () => {
    const { result } = renderHook(() => useMensajeCalculo());
    act(() => {
      calculoStore.getState().setEstadoMotor("cargando");
    });
    expect(result.current).toBe(MENSAJE_MOTOR_CARGANDO);
  });

  it("el cálculo en vuelo prioriza sobre la carga del motor", () => {
    const { result } = renderHook(() => useMensajeCalculo());
    act(() => {
      calculoStore.getState().setEstadoMotor("cargando");
      calculoStore.getState().setCalculando(true);
    });
    expect(result.current).toBe(MENSAJE_CALCULANDO);
  });

  it("vuelve a null al terminar (restaura el contextual)", () => {
    const { result } = renderHook(() => useMensajeCalculo());
    act(() => {
      calculoStore.getState().setCalculando(true);
    });
    expect(result.current).toBe(MENSAJE_CALCULANDO);
    act(() => {
      calculoStore.getState().setCalculando(false);
      calculoStore.getState().setEstadoMotor("listo");
    });
    expect(result.current).toBeNull();
  });
});
