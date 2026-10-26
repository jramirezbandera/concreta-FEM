/**
 * La plantilla DXF en la app (V2c-4, `docs/fem3d/dibujo.md` §10.3), sin las vistas (jsdom no tiene
 * WebGL; lo que pasa en ellas lo prueba `validacion/v2c4/chrome.ts`): «Plantilla DXF» lee el fichero
 * (aquí, sin worker) y la pone en la planta activa; en el navegador se cambian sus unidades y sus
 * capas, todo con deshacer; quitarla deja el proyecto como estaba.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { escribirDxf } from "../../../src/pruebas/dxfPrueba.ts";
import { App } from "../App.tsx";
import { ThemeProvider } from "../tema/ThemeProvider.tsx";

// El worker de sesión, en este proceso (como en `dibujo.test.tsx`)
vi.mock("../sesion/cliente.ts", async () => {
  const { Atendedor } = await import("../../../src/visor/atender.ts");
  class ErrorObsoleto extends Error {}
  class ClienteSesion {
    private readonly at = new Atendedor((globalThis as unknown as { __motor: string }).__motor);
    motor = (globalThis as unknown as { __motor: string }).__motor;
    huella: string | null = null;
    private cerrado = false;
    iniciado() {
      return Promise.resolve(this.motor);
    }
    async pedir(p: { tipo: string }) {
      if (this.cerrado) throw new ErrorObsoleto();
      await new Promise((r) => setTimeout(r, 5));
      const r = await this.at.atender(p as never);
      if (this.cerrado) throw new ErrorObsoleto();
      if (p.tipo === "abrir") this.huella = this.at.huella;
      return r.ok ? { ok: true, valor: r.valor, ms: 0 } : { ok: false, diagnosticos: r.diagnosticos, ms: 0 };
    }
    cerrar() {
      this.cerrado = true;
    }
  }
  return { ClienteSesion, ErrorObsoleto };
});

const RAIZ = join(__dirname, "..", "..", "..");

class SinTamano {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(async () => {
  globalThis.ResizeObserver ??= SinTamano as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  const wasm = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
  await iniciarNucleo(wasm);
  (globalThis as unknown as { __motor: string }).__motor = sha256(new Uint8Array(wasm));
}, 120_000);

describe("la plantilla DXF (V2c-4)", () => {
  it("importar, unidades, capas, deshacer y quitar", async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Proyecto nuevo/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre del proyecto" }), { target: { value: "calcar" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));
    await waitFor(() => expect(screen.getByRole("grid", { name: /Tabla de/ })).toBeTruthy(), { timeout: 30_000 });

    // Un plano en mm: un rectángulo de muros y una línea de cotas
    const bytes = escribirDxf(
      [
        { capa: "MUROS", polilinea: [[0, 0], [12, 0], [12, 8], [0, 8]], cerrada: true },
        { capa: "COTAS", linea: [[0, -1], [12, -1]] },
      ],
      { escala: 1000, insunits: 4 },
    );
    const f = new File([bytes as Uint8Array<ArrayBuffer>], "Planta baja.dxf");
    fireEvent.change(screen.getByLabelText("Fichero DXF de la plantilla"), { target: { files: [f] } });
    const nav = await waitFor(() => screen.getByRole("heading", { name: /Plantillas DXF/ }).closest("section")!, { timeout: 10_000 });
    await waitFor(() => expect(within(nav).getByText("2 entidades")).toBeTruthy(), { timeout: 10_000 });
    expect(screen.getByRole("button", { name: "Deshacer" }).getAttribute("title")).toMatch(/Plantilla DXF «Planta baja»/);

    // Desplegada: en mm (por el tamaño), las dos capas visibles; ocultar la de cotas y pasar a m
    fireEvent.click(within(nav).getByRole("button", { name: "Planta baja" }));
    const unidades = within(nav).getByRole("combobox", { name: "Unidades del DXF" }) as HTMLSelectElement;
    expect(unidades.value).toBe("mm");
    fireEvent.click(within(nav).getByRole("checkbox", { name: /COTAS/ }));
    await waitFor(() => expect((within(nav).getByRole("checkbox", { name: /COTAS/ }) as HTMLInputElement).checked).toBe(false));
    fireEvent.change(unidades, { target: { value: "m" } });
    await waitFor(() => expect((within(nav).getByRole("combobox", { name: "Unidades del DXF" }) as HTMLSelectElement).value).toBe("m"));
    // En m, el plano mediría 12 km: se avisa de que $INSUNITS dice mm
    expect(within(nav).getByText(/El DXF dice que está en milímetros/)).toBeTruthy();

    // Deshacer las unidades; y quitar la plantilla
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect((within(nav).getByRole("combobox", { name: "Unidades del DXF" }) as HTMLSelectElement).value).toBe("mm"));
    fireEvent.click(within(nav).getByRole("button", { name: "Quitar la plantilla Planta baja" }));
    await waitFor(() => expect(within(nav).getByText(/Un plano DXF en gris detrás de la planta/)).toBeTruthy());
  }, 60_000);
});
