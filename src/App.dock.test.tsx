// Test de regresion del refactor "dock de paneles" (PR1). Project `jsdom`.
//
// QUE PRUEBA (la clase de bug que motivo el `dispatchEvent` historico, T-hud-layout):
// que pulsar "Calcular" NO lo intercepta ningun control del HUD. Antes, BotonCalcular
// flotaba en la capa glass del HUD (.cx-hud, position:absolute sobre el canvas) y un
// panel/zona vecina podia quedar por encima y robar el clic (z-order/pointer-events);
// por eso los specs E2E recurrieron a dispatchEvent para esquivar el hit-test.
//
// Con el dock, BotonCalcular vive en la region ACOPLADA del Shell (<aside "Panel de
// datos">), que es una hermana flex de .cx-body: EMPUJA el lienzo en vez de flotar
// sobre el. Por construccion ya no hay capa glass encima del boton. Esta prueba lo
// asevera estructuralmente (el boton NO es descendiente de .cx-hud y SI del dock) y
// funcionalmente (el clic dispara el pipeline: el onClick corre, no se traga).
//
// Igual que Viewport.test.tsx, MOCKEAMOS el <Canvas> de R3F (jsdom no tiene WebGL) y
// el modulo `solver` (no arrancar Pyodide/Web Worker): el motor se reporta "listo" y
// calcular() es observable sin tocar Python (CLAUDE.md §13).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Canvas stub: marcador HTML que NO renderiza children (la escena R3F). Evita WebGL.
vi.mock("@react-three/fiber", async () => {
  const actual = await vi.importActual<typeof import("@react-three/fiber")>(
    "@react-three/fiber",
  );
  return { ...actual, Canvas: () => <div data-testid="canvas-mock" /> };
});

// Solver stub: el motor se reporta "listo" (boton habilitado) y calcular() es un spy
// observable. precargar()/estado() no arrancan nada. Asi App monta sin Web Worker y el
// clic en "Calcular" recorre el pipeline real (discretizar -> solverClient.calcular).
// El spy se crea con vi.hoisted: la factory de vi.mock se eleva al tope del modulo y no
// puede capturar variables de modulo normales (solo las hoisted).
const { calcularSpy } = vi.hoisted(() => ({
  calcularSpy: vi.fn(async () => {
    throw { fase: "calculo", mensaje: "stub: sin solver real en jsdom" };
  }),
}));
vi.mock("./solver", () => ({
  solverClient: {
    precargar: vi.fn(async () => {}),
    estado: vi.fn(async () => "listo" as const),
    calcular: calcularSpy,
    calcularModal: vi.fn(),
    calcularCR: vi.fn(),
  },
  esErrorMotor: () => true,
}));

import App from "./App";
import { modeloStore, vistaStore } from "./estado";
import { calculoStore } from "./estado/calculoStore";
import { crearModeloVacio } from "./dominio";

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  vistaStore.getState().setPestanaActiva("resultados");
  vistaStore.getState().setModoVista("planta");
  vistaStore.getState().setPlantaActiva(null);
  // El motor "listo" habilita "Calcular" sin depender del sondeo asincrono del stub.
  calculoStore.getState().setEstadoMotor("listo");
  calculoStore.getState().setCalculando(false);
  calculoStore.getState().setErrores([]);
  calculoStore.getState().setAvisos([]);
  calculoStore.getState().setUltimoError(null);
  calcularSpy.mockClear();
});

// Localiza el boton "Calcular" por su nombre accesible exacto (excluye "Calcular obra"
// del brandbar/menu). Mismo regex que el spec E2E (F1.pipeline.happy).
function botonCalcular() {
  return screen.getByRole("button", {
    name: /^(Calcular|Calculando…|Reintentar|Cargando motor…)$/,
  });
}

describe("PR1 dock: 'Calcular' no lo intercepta el HUD", () => {
  it("BotonCalcular vive en el dock (<aside 'Panel de datos'>), no en la capa glass .cx-hud", () => {
    const { container } = render(<App />);

    const boton = botonCalcular();

    // Estructural: el dock es un landmark complementario real (empuja el lienzo).
    const dock = screen.getByRole("complementary", { name: "Panel de datos" });
    expect(dock).toContainElement(boton);

    // Y NO cuelga de la capa HUD glass (la que historicamente solapaba el boton). Si
    // hubiera una .cx-hud, el boton no debe estar dentro de ella.
    const capaHud = container.querySelector(".cx-hud");
    if (capaHud) expect(capaHud.contains(boton)).toBe(false);
  });

  it("pulsar 'Calcular' dispara el pipeline (el onClick corre, no se lo traga un overlay)", async () => {
    const user = userEvent.setup();
    render(<App />);

    const boton = botonCalcular();
    await expect.poll(() => boton).toBeEnabled();

    // Clic REAL (no dispatchEvent): si un control del HUD interceptara el puntero, el
    // handler no correria y NADA del estado de calculo cambiaria. El clic llega al boton
    // y arranca el pipeline (discretizar -> motor): tras el, hay un efecto observable
    // (el motor stub fue invocado, o el discretizador/motor reporto un error de obra).
    // Cualquiera de ellos prueba que el onClick corrio y no se lo trago un overlay.
    await user.click(boton);

    await waitFor(() => {
      const { errores, ultimoError } = calculoStore.getState();
      const disparoElPipeline =
        calcularSpy.mock.calls.length > 0 ||
        errores.length > 0 ||
        ultimoError !== null;
      expect(disparoElPipeline).toBe(true);
    });
  });
});
