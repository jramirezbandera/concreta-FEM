// Smoke test del Viewport (feature-9, Fase 2.2). Project `jsdom`.
//
// ESTRATEGIA (decision deliberada, prioriza robustez sobre exhaustividad):
// El Viewport monta un <Canvas> de R3F que necesita WebGL; jsdom no lo provee y
// la <Escena> (drei: cameras, controles, Grid, gizmo) reventaria al ejecutar
// useThree/render. Por eso MOCKEAMOS `Canvas` de @react-three/fiber para que
// renderice un marcador HTML e IGNORE sus children: asi la escena 3D nunca se
// ejecuta (no toca WebGL ni drei en runtime), mientras que el HUD (HTML normal
// sobre el canvas, Hud.tsx) si se monta de verdad. Verificamos que el modulo monta
// sin crashear y que su HUD/overlay HTML aparece. NO testeamos three.js ni el
// render WebGL. Mantenemos el resto del modulo r3f real (importActual) para no
// romper los imports de nivel de modulo de Escena.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@react-three/fiber", async () => {
  const actual = await vi.importActual<typeof import("@react-three/fiber")>(
    "@react-three/fiber",
  );
  return {
    ...actual,
    // Canvas stub: marcador HTML que NO renderiza children (la escena R3F).
    // Evita por completo WebGL/drei/useThree en jsdom.
    Canvas: () => <div data-testid="canvas-mock" />,
  };
});

import { Viewport } from "./index";
import { modeloStore, vistaStore } from "../../estado";
import { crearModeloVacio } from "../../dominio";

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  vistaStore.getState().setPestanaActiva("entradaPilares");
  vistaStore.getState().setModoVista("planta");
  vistaStore.getState().setGrupoActivo(null);
  vistaStore.getState().setPlantaActiva(null);
});

describe("Viewport: montaje en jsdom (Canvas R3F mockeado)", () => {
  it("monta sin crashear y renderiza el Canvas (stub) + el HUD HTML", () => {
    render(<Viewport />);
    // El Canvas (stub) esta presente; la escena WebGL real no se ejecuta.
    expect(screen.getByTestId("canvas-mock")).toBeInTheDocument();
    // El HUD es HTML normal sobre el canvas: el selector de modo de vista existe
    // (Radix toggle-group `type="single"` => role radiogroup).
    expect(
      screen.getByRole("radiogroup", { name: "Modo de vista" }),
    ).toBeInTheDocument();
  });

  it("inyecta hudOverlays en el HUD HTML", () => {
    render(<Viewport hudOverlays={<div data-testid="overlay-extra">leyenda</div>} />);
    expect(screen.getByTestId("overlay-extra")).toBeInTheDocument();
  });

  it("en modo 'mosaico' muestra el aviso de proximamente en el HUD", () => {
    vistaStore.getState().setModoVista("mosaico");
    render(<Viewport />);
    expect(screen.getByRole("status")).toHaveTextContent(/Mosaico/i);
  });
});
