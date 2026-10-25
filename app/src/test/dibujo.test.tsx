/**
 * La herramienta activa de V2c-1 en la app (`docs/fem3d/dibujo.md` §2.1), sin las vistas (jsdom no
 * tiene WebGL; lo que pasa en ellas lo prueba `validacion/v2c/chrome.ts`): la barra la activa, la
 * plantilla sale en Propiedades, una sección nueva se crea desde ella, F8 pone el ortogonal, una
 * tecla abre el campo de teclado y Esc vuelve a Elegir.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { App } from "../App.tsx";
import { ThemeProvider } from "../tema/ThemeProvider.tsx";

// El worker de sesión, en este proceso (como en `editor.test.tsx`)
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

describe("la herramienta activa (V2c-1)", () => {
  it("Pilar: plantilla en Propiedades, sección nueva, F8, el campo de teclado y Esc", async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Proyecto nuevo/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre del proyecto" }), { target: { value: "dibujo" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));
    await waitFor(() => expect(screen.getByRole("grid", { name: /Tabla de/ })).toBeTruthy(), { timeout: 30_000 });

    const pilar = screen.getByRole("button", { name: "Pilar" });
    expect(pilar.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pilar);
    expect(pilar.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("region", { name: "Dibujar · Pilar" })).toBeTruthy();
    // El proyecto nuevo no tiene secciones: la plantilla ofrece crear una (30 × 30 por defecto)
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Sección" }) as HTMLSelectElement).value).toBe("P30x30"));
    expect(screen.getByRole("button", { name: "Deshacer" }).getAttribute("title")).toMatch(/Sección P30x30/);

    // F8, el ortogonal
    const orto = screen.getByRole("checkbox", { name: /Ortogonal/ }) as HTMLInputElement;
    expect(orto.checked).toBe(false);
    fireEvent.keyDown(window, { key: "F8" });
    expect(orto.checked).toBe(true);

    // Una cifra abre el campo; lo que no se puede situar sin cursor en una planta lo dice; Esc lo cierra
    fireEvent.keyDown(window, { key: "3" });
    const campo = screen.getByRole("textbox", { name: /Punto: x; y/ }) as HTMLInputElement;
    expect(campo.value).toBe("3");
    fireEvent.change(campo, { target: { value: "3; 4" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(screen.getByText("Lleve el cursor a una planta.")).toBeTruthy();
    fireEvent.keyDown(campo, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: /Punto: x; y/ })).toBeNull();

    // Viga, desde Pilar; y Esc sin nada en curso vuelve a Elegir
    fireEvent.click(screen.getByRole("button", { name: "Viga" }));
    expect(screen.getByRole("region", { name: "Dibujar · Viga" })).toBeTruthy();
    expect(pilar.getAttribute("aria-pressed")).toBe("false");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Viga" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("region", { name: "Dibujar · Viga" })).toBeNull();
  }, 60_000);
});
