// Tests del runner compartido de pipeline (auditoria UX-L2/UX-L5). Project `jsdom` (vive
// bajo src/ui). No usa React; ejercita la logica imperativa con el solver SIMULADO por
// las callbacks `ejecutar`/`preparar` (no toca solverClient real). Foco:
//   - UX-L2: navega a "resultados" en EXITO, en fallo de VALIDACION y en fallo de MOTOR,
//     SALVO cuando autoSwitchResultados===false (camino CR: su panel vive en planta).
import { describe, it, expect, beforeEach, vi } from "vitest";

// esErrorMotor real (mismo type-guard): distingue el ErrorMotor plano del worker.
vi.mock("../../solver", () => ({
  esErrorMotor: (e: unknown): boolean =>
    typeof e === "object" &&
    e !== null &&
    "fase" in e &&
    "mensaje" in e &&
    ((e as { fase: unknown }).fase === "carga" ||
      (e as { fase: unknown }).fase === "calculo"),
}));

import { ejecutarPipelineAuxiliar } from "./ejecutarPipelineAuxiliar";
import type { PipelineAuxiliar } from "./ejecutarPipelineAuxiliar";
import { modeloStore } from "../../estado/modeloStore";
import { vistaStore } from "../../estado/vistaStore";
import { crearModeloVacio } from "../../dominio";

// Config base del runner con un camino trivial (payload/resultado numero). Cada test
// sobreescribe lo que necesita (preparar / ejecutar / autoSwitchResultados).
function cfgBase(
  over: Partial<PipelineAuxiliar<number, number>> = {},
): PipelineAuxiliar<number, number> {
  let enVuelo = false;
  return {
    estaEnVuelo: () => enVuelo,
    marcarEnVuelo: (v) => {
      enVuelo = v;
    },
    preparar: () => ({ ok: true, payload: 1 }),
    ejecutar: async () => 42,
    alExito: () => {},
    mensajeFalloInesperado: "fallo inesperado de prueba",
    sink: {},
    ...over,
  };
}

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  vistaStore.getState().setPestanaActiva("entradaPilares");
});

describe("ejecutarPipelineAuxiliar · navegacion a Resultados (UX-L2)", () => {
  it("EXITO -> navega a resultados", async () => {
    await ejecutarPipelineAuxiliar(cfgBase());
    expect(vistaStore.getState().pestanaActiva).toBe("resultados");
  });

  it("fallo de VALIDACION -> navega a resultados (para ver los errores)", async () => {
    await ejecutarPipelineAuxiliar(
      cfgBase({ preparar: () => ({ ok: false, errores: [] }) }),
    );
    expect(vistaStore.getState().pestanaActiva).toBe("resultados");
  });

  it("fallo del MOTOR -> navega a resultados (para ver ultimoError)", async () => {
    await ejecutarPipelineAuxiliar(
      cfgBase({
        ejecutar: async () => {
          throw { fase: "calculo", mensaje: "boom del motor" };
        },
      }),
    );
    expect(vistaStore.getState().pestanaActiva).toBe("resultados");
  });

  it("camino CR (autoSwitchResultados:false) NO navega en EXITO", async () => {
    await ejecutarPipelineAuxiliar(cfgBase({ autoSwitchResultados: false }));
    expect(vistaStore.getState().pestanaActiva).toBe("entradaPilares");
  });

  it("camino CR NO navega en fallo de VALIDACION", async () => {
    await ejecutarPipelineAuxiliar(
      cfgBase({
        autoSwitchResultados: false,
        preparar: () => ({ ok: false, errores: [] }),
      }),
    );
    expect(vistaStore.getState().pestanaActiva).toBe("entradaPilares");
  });

  it("camino CR NO navega en fallo del MOTOR", async () => {
    await ejecutarPipelineAuxiliar(
      cfgBase({
        autoSwitchResultados: false,
        ejecutar: async () => {
          throw { fase: "calculo", mensaje: "boom del motor" };
        },
      }),
    );
    expect(vistaStore.getState().pestanaActiva).toBe("entradaPilares");
  });
});

describe("ejecutarPipelineAuxiliar · guard de identidad (UX-L5)", () => {
  it("si la obra cambia durante el vuelo: no navega y avisa por onErrorMotor", async () => {
    const onErrorMotor = vi.fn();
    await ejecutarPipelineAuxiliar(
      cfgBase({
        sink: { onErrorMotor },
        // Durante el await, edita la obra: cambia la referencia del modelo.
        ejecutar: async () => {
          modeloStore.getState().cargarModelo(crearModeloVacio());
          return 42;
        },
      }),
    );
    // No navega (los resultados eran del modelo viejo).
    expect(vistaStore.getState().pestanaActiva).toBe("entradaPilares");
    // Publica el aviso de obra (antes era un return mudo).
    expect(onErrorMotor).toHaveBeenCalledWith(
      expect.objectContaining({ mensaje: expect.stringMatching(/obra cambió/i) }),
    );
  });
});
