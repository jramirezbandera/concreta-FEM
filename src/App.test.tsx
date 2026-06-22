// Test del hook usePuedeColocarPilar (hueco detectado en el 2o /plan-eng-review de
// feature-11). El helper PURO tramoColocable ya esta cubierto en tramoPilar.test; lo
// que aqui se verifica es la REACTIVIDAD del hook: que recalcula al cambiar el modelo
// o el ambito activo (grupo/planta). Project `jsdom`, via renderHook (sin montar App
// ni el Canvas R3F: el hook solo lee/suscribe stores).
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePuedeColocarPilar } from "./App";
import {
  modeloStore,
  vistaStore,
  crearGrupo,
  crearPlanta,
} from "./estado";
import { crearModeloVacio } from "./dominio";

const modelo = () => modeloStore.getState().getModelo();

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  vistaStore.getState().setGrupoActivo(null);
  vistaStore.getState().setPlantaActiva(null);
});

// Crea un grupo con una planta y lo deja como grupo activo (como haria la Sidebar).
function prepararGrupoConPlanta(): void {
  act(() => {
    modeloStore
      .getState()
      .ejecutar(
        crearGrupo(modelo(), {
          categoriaUso: "A",
          sobrecargaUso: 2,
          cargasMuertas: 1,
        }),
      );
    const grupoId = modelo().grupos[0]!.id;
    modeloStore
      .getState()
      .ejecutar(crearPlanta(modelo(), { cota: 0, altura: 3, grupoId }));
    vistaStore.getState().setGrupoActivo(grupoId);
  });
}

describe("usePuedeColocarPilar", () => {
  it("false con modelo vacío y sin ámbito activo", () => {
    const { result } = renderHook(() => usePuedeColocarPilar());
    expect(result.current).toBe(false);
  });

  it("recalcula a true al crear grupo+planta y activarlos", () => {
    const { result } = renderHook(() => usePuedeColocarPilar());
    expect(result.current).toBe(false);
    prepararGrupoConPlanta();
    expect(result.current).toBe(true);
  });

  it("vuelve a false si se retira el ámbito activo", () => {
    const { result } = renderHook(() => usePuedeColocarPilar());
    prepararGrupoConPlanta();
    expect(result.current).toBe(true);
    act(() => {
      vistaStore.getState().setGrupoActivo(null);
      vistaStore.getState().setPlantaActiva(null);
    });
    expect(result.current).toBe(false);
  });

  it("false si la planta activa apunta a una planta inexistente (id obsoleto)", () => {
    // Endurecimiento: un plantaActivaId obsoleto no debe dar luz verde a colocar.
    const { result } = renderHook(() => usePuedeColocarPilar());
    act(() => {
      vistaStore.getState().setPlantaActiva("p-borrada");
    });
    expect(result.current).toBe(false);
  });
});
