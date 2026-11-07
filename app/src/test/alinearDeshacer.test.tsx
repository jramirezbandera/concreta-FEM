/**
 * «Alinear» (MA5) se deshace con Ctrl+Z, también después del autoguardado en el navegador, y la vista
 * lo dice: lo que mueve son centímetros, y con «N puntos alineados» aún en la vista parecía que el
 * deshacer no hacía nada (de la prueba de uso del usuario).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { huellaCompilacion } from "../../../src/compilador/compilar.ts";
import { resolverOpciones } from "../../../src/compilador/fisico.ts";
import type { Proyecto } from "../../../src/agente/proyecto.ts";
import { olvidarBD } from "../sesion/almacen.ts";
import { App } from "../App.tsx";
import { ThemeProvider } from "../tema/ThemeProvider.tsx";

vi.mock("../sesion/cliente.ts", async () => {
  const { Atendedor } = await import("../../../src/visor/atender.ts");
  class ErrorObsoleto extends Error {}
  class ClienteSesion {
    private readonly at = new Atendedor((globalThis as unknown as { __motor: string }).__motor);
    motor = (globalThis as unknown as { __motor: string }).__motor;
    huella: string | null = null;
    iniciado() {
      return Promise.resolve(this.motor);
    }
    async pedir(p: { tipo: string }) {
      await new Promise((r) => setTimeout(r, 5));
      const r = await this.at.atender(p as never);
      if (p.tipo === "abrir") this.huella = this.at.huella;
      return r.ok ? { ok: true, valor: r.valor, ms: 0 } : { ok: false, diagnosticos: r.diagnosticos, ms: 0 };
    }
    cerrar() {}
  }
  return { ClienteSesion, ErrorObsoleto };
});

const RAIZ = join(__dirname, "..", "..", "..");
const huella = (p: Proyecto) => huellaCompilacion(p.modelo, resolverOpciones(p.opciones));

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
  globalThis.indexedDB = new IDBFactory();
  olvidarBD();
}, 120_000);

describe("Alinear y deshacer", () => {
  it("Ctrl+Z tras alinear vuelve al modelo de antes (tras el autoguardado) y la vista dice «Deshecho: Alinear»", async () => {
    const p = JSON.parse(readFileSync(join(RAIZ, ".claude", "skills", "fem", "ejemplo.json"), "utf8")) as Proyecto;
    // A2 a 1 cm de la fila de B2
    p.modelo.pilares![1]!.x = 6.01;
    const { container } = render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
    fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [new File([JSON.stringify(p)], "p.json", { type: "application/json" })] } });
    const antes = huella(p);
    const h = () => container.querySelector("[data-huella]")?.getAttribute("data-huella");
    await waitFor(() => expect(h()).toBe(antes), { timeout: 30_000 });

    fireEvent.click(screen.getAllByRole("button", { name: "Alinear" })[0]!);
    const d = screen.getByRole("dialog", { name: "Alinear" });
    fireEvent.click(within(d).getByRole("button", { name: "Alinear" }));
    await waitFor(() => expect(h()).not.toBe(antes), { timeout: 30_000 });
    expect(screen.getByText(/punto alineado en 1 pieza \(movidos 1 cm como mucho\)/)).toBeTruthy();
    expect(screen.getByTitle("Deshacer: Alinear (Ctrl+Z)")).toBeTruthy();

    // Después del autoguardado (400 ms)
    await new Promise((r) => setTimeout(r, 1000));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "z", ctrlKey: true });
    await waitFor(() => expect(h()).toBe(antes), { timeout: 30_000 });
    expect(screen.getByText("Deshecho: Alinear.")).toBeTruthy();
    expect(screen.queryByText(/puntos? alineados?/)).toBeNull();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "y", ctrlKey: true });
    await waitFor(() => expect(h()).not.toBe(antes), { timeout: 30_000 });
    expect(screen.getByText("Rehecho: Alinear.")).toBeTruthy();
  }, 120_000);
});
