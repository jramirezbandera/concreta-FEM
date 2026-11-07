/**
 * «Situación» en el navegador (`armazon/Situacion.tsx`): el alzado y la planta esquemáticos dicen qué
 * enseña la vista activa, y un clic en una planta o en un eje lleva la vista a ella.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { huellaCompilacion } from "../../../src/compilador/compilar.ts";
import { resolverOpciones } from "../../../src/compilador/fisico.ts";
import type { Proyecto } from "../../../src/agente/proyecto.ts";
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

describe("Situación", () => {
  it("marca la planta de la vista; un clic en otra planta la enseña y uno en un eje enseña su alzado", async () => {
    try {
      localStorage.clear();
    } catch {
      // sin almacenamiento
    }
    const p = JSON.parse(readFileSync(join(RAIZ, "ejemplos", "muestrario", "proyecto.json"), "utf8")) as Proyecto;
    const { container } = render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Muestrario/ }));
    const h = huellaCompilacion(p.modelo, resolverOpciones(p.opciones));
    await waitFor(() => expect(container.querySelector("[data-huella]")?.getAttribute("data-huella")).toBe(h), { timeout: 30_000 });
    const sit = () => screen.getByText("Situación", { selector: "h2 span" }).closest("section")!;
    const [p0, p1] = p.modelo.plantas;
    // Por defecto, una vista de planta en la primera planta
    expect(within(sit()).getByRole("button", { name: `Ver la planta ${p0!.id}` }).getAttribute("aria-pressed")).toBe("true");
    expect(sit().querySelector("h2")!.textContent).toContain(`Planta ${p0!.id}`);

    fireEvent.click(within(sit()).getByRole("button", { name: `Ver la planta ${p1!.id}` }));
    expect(within(sit()).getByRole("button", { name: `Ver la planta ${p1!.id}` }).getAttribute("aria-pressed")).toBe("true");
    expect(within(sit()).getByRole("button", { name: `Ver la planta ${p0!.id}` }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("img", { name: `Planta ${p1!.id}` })).toBeTruthy();

    // Un eje: la vista pasa al alzado de ese eje, con su eje marcado en la planta esquemática
    const ejes = within(sit()).getAllByRole("button", { name: /^Ver el alzado del eje / });
    expect(ejes.length).toBeGreaterThan(1);
    const segundo = ejes[1]!.getAttribute("aria-label")!.replace("Ver el alzado del eje ", "");
    fireEvent.click(ejes[1]!);
    await waitFor(() => expect(container.querySelector(".celda")?.getAttribute("data-tipo")).toBe("alzado"));
    expect(screen.getByRole("img", { name: `Alzado del eje ${segundo}` })).toBeTruthy();
    expect(within(sit()).getByRole("button", { name: `Ver el alzado del eje ${segundo}` }).getAttribute("aria-pressed")).toBe("true");
    expect(sit().querySelectorAll(".sit-corte").length).toBe(2);
    // En un alzado, ninguna planta marcada; un clic en una vuelve a la planta
    expect(within(sit()).queryAllByRole("button", { pressed: true, name: /^Ver la planta/ })).toHaveLength(0);
    fireEvent.click(within(sit()).getByRole("button", { name: `Ver la planta ${p0!.id}` }));
    await waitFor(() => expect(container.querySelector(".celda")?.getAttribute("data-tipo")).toBe("planta"));
    expect(screen.getByRole("img", { name: `Planta ${p0!.id}` })).toBeTruthy();
  }, 120_000);
});
