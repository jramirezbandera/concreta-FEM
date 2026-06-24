// Tests del autosave y carga de plantillas DXF (feature-15, T2.3). Project
// `persistencia`. Mismo patron de fake-timers + Dexie que autosave.test.ts (CRITICO
// para no caer en flaky/deadlocks):
//   - Solo falsificamos setTimeout/clearTimeout (`toFake`). NO microtasks: Dexie +
//     fake-indexeddb los usan para completar transacciones; si se falsifican todos,
//     hasta un `await db...` se cuelga.
//   - Tras advanceTimersByTimeAsync(ms), `await _esperarGuardadoPlantillas()` cierra
//     la cadena async de Dexie antes de que el test lea la DB.
import { afterEach, beforeEach, expect, it, describe, vi } from "vitest";
import { db } from "../esquema";
import { vistaStore } from "../../estado/vistaStore";
import type { Plantilla } from "../../ui/viewport/dxf/tiposDxf";
import { cargarPlantillasDeProyecto } from "./repositorioPlantillas";
import {
  cargarPlantillasEnStore,
  iniciarAutosavePlantillas,
  _esperarGuardadoPlantillas,
} from "./autosavePlantillas";

function plantillaValida(overrides: Partial<Plantilla> = {}): Plantilla {
  return {
    id: "pl-1",
    nombre: "Planta",
    nombreArchivo: "planta.dxf",
    plantaId: "p1",
    entidades: [],
    transform: { x: 0, y: 0, escala: 1, rotacion: 0, opacidad: 1 },
    visible: true,
    bloqueado: false,
    creadaEn: 1000,
    ...overrides,
  };
}

// Avanza el reloj `ms` (dispara el debounce) y espera a que el guardado
// fire-and-forget termine de tocar Dexie.
async function avanzarYGuardar(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await _esperarGuardadoPlantillas();
}

beforeEach(() => {
  // Solo setTimeout/clearTimeout: dejar microtasks/setImmediate reales para Dexie.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  // Store de plantillas limpio antes de cada test (vistaStore es singleton de modulo).
  vistaStore.getState().setPlantillas([]);
});

afterEach(async () => {
  vi.useRealTimers();
  vistaStore.getState().setPlantillas([]);
  await db.plantillas.clear();
});

describe("iniciarAutosavePlantillas", () => {
  it("guarda las plantillas tras el debounce", async () => {
    const baja = iniciarAutosavePlantillas("proy-1", { debounceMs: 800 });
    try {
      vistaStore.getState().addPlantilla(plantillaValida({ id: "a" }));
      await avanzarYGuardar(800);

      const guardadas = await cargarPlantillasDeProyecto("proy-1");
      expect(guardadas.map((p) => p.id)).toEqual(["a"]);
    } finally {
      baja();
    }
  });

  it("debounce: dos ediciones rapidas -> un solo guardado con el ultimo estado", async () => {
    const baja = iniciarAutosavePlantillas("proy-1", { debounceMs: 800 });
    try {
      vistaStore.getState().addPlantilla(plantillaValida({ id: "a" }));
      await vi.advanceTimersByTimeAsync(400); // dentro de la ventana: no guarda aun
      vistaStore.getState().addPlantilla(plantillaValida({ id: "b" })); // re-arma
      await vi.advanceTimersByTimeAsync(400); // 800 desde la 1a, 400 desde la 2a

      // A los 800 ms desde la 1a edicion todavia NO debe haber guardado.
      expect(await cargarPlantillasDeProyecto("proy-1")).toEqual([]);

      await avanzarYGuardar(400); // completa la ventana de la 2a edicion
      const final = await cargarPlantillasDeProyecto("proy-1");
      expect(final.map((p) => p.id)).toEqual(["a", "b"]);
    } finally {
      baja();
    }
  });

  it("baja: cancela un timer pendiente (no guarda despues de la baja)", async () => {
    const baja = iniciarAutosavePlantillas("proy-1", { debounceMs: 800 });
    vistaStore.getState().addPlantilla(plantillaValida());
    await vi.advanceTimersByTimeAsync(400); // a medias de la ventana
    baja(); // cancela el timer pendiente

    await vi.advanceTimersByTimeAsync(800); // el timer cancelado no dispara

    expect(await cargarPlantillasDeProyecto("proy-1")).toEqual([]);
  });

  it("baja: tras dar de baja, una edicion no guarda", async () => {
    const baja = iniciarAutosavePlantillas("proy-1", { debounceMs: 800 });
    baja();

    vistaStore.getState().addPlantilla(plantillaValida());
    await vi.advanceTimersByTimeAsync(800);

    expect(await cargarPlantillasDeProyecto("proy-1")).toEqual([]);
  });

  it("es independiente del proyecto pasado: guarda en SU proyecto, no en otro", async () => {
    const baja = iniciarAutosavePlantillas("A", { debounceMs: 800 });
    try {
      vistaStore.getState().addPlantilla(plantillaValida({ id: "x" }));
      await avanzarYGuardar(800);

      expect((await cargarPlantillasDeProyecto("A")).map((p) => p.id)).toEqual([
        "x",
      ]);
      // El proyecto B no recibe nada: el autosave esta ligado a "A".
      expect(await cargarPlantillasDeProyecto("B")).toEqual([]);
    } finally {
      baja();
    }
  });

  it("si Dexie rechaza el guardado, onError se llama y no relanza", async () => {
    const errores: unknown[] = [];
    const spy = vi
      .spyOn(db.plantillas, "put")
      .mockRejectedValueOnce(new Error("QuotaExceededError simulado"));

    const baja = iniciarAutosavePlantillas("proy-1", {
      debounceMs: 800,
      onError: (e) => errores.push(e),
    });
    try {
      vistaStore.getState().addPlantilla(plantillaValida());
      await avanzarYGuardar(800);

      expect(errores).toHaveLength(1);
      expect((errores[0] as Error).message).toMatch(/QuotaExceededError/);

      // El store sigue editable: otra edicion guarda sin problema.
      spy.mockRestore();
      vistaStore.getState().addPlantilla(plantillaValida({ id: "otra" }));
      await avanzarYGuardar(800);
      expect(await cargarPlantillasDeProyecto("proy-1")).toHaveLength(2);
    } finally {
      baja();
      spy.mockRestore();
    }
  });

  it("eliminar una plantilla tambien autosalva (cualquier cambio de la referencia)", async () => {
    const baja = iniciarAutosavePlantillas("proy-1", { debounceMs: 800 });
    try {
      vistaStore.getState().setPlantillas([
        plantillaValida({ id: "a" }),
        plantillaValida({ id: "b" }),
      ]);
      await avanzarYGuardar(800);
      expect(await cargarPlantillasDeProyecto("proy-1")).toHaveLength(2);

      vistaStore.getState().quitarPlantilla("a");
      await avanzarYGuardar(800);
      const final = await cargarPlantillasDeProyecto("proy-1");
      expect(final.map((p) => p.id)).toEqual(["b"]);
    } finally {
      baja();
    }
  });
});

describe("cargarPlantillasEnStore", () => {
  it("hidrata el vistaStore con las plantillas persistidas", async () => {
    await db.plantillas.put({
      proyectoId: "proy-1",
      plantillas: [plantillaValida({ id: "guardada" })],
      actualizadoEn: 0,
    });

    await cargarPlantillasEnStore("proy-1");
    expect(vistaStore.getState().plantillas.map((p) => p.id)).toEqual([
      "guardada",
    ]);
  });

  it("proyecto sin plantillas -> deja el store con []", async () => {
    // Pre-cargamos algo en el store para verificar que se reemplaza por [].
    vistaStore.getState().setPlantillas([plantillaValida({ id: "previa" })]);
    await cargarPlantillasEnStore("sin-plantillas");
    expect(vistaStore.getState().plantillas).toEqual([]);
  });

  it("descarta plantillas corruptas al hidratar (cargar nunca rompe)", async () => {
    await db.plantillas.put({
      proyectoId: "proy-1",
      plantillas: [plantillaValida({ id: "buena" }), { basura: true }],
      actualizadoEn: 0,
    });

    await cargarPlantillasEnStore("proy-1");
    expect(vistaStore.getState().plantillas.map((p) => p.id)).toEqual([
      "buena",
    ]);
  });
});
