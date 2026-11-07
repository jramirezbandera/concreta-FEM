/**
 * «Situación» en el navegador (`armazon/Situacion.tsx`): en una vista de planta, el alzado esquemático;
 * en un alzado, la planta esquemática con los ejes. Dicen qué enseña la vista activa, y un clic en una
 * planta o en un eje lleva la vista a ella.
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
    const tipoVista = (t: "Planta" | "Alzado") => within(screen.getByRole("group", { name: "Tipo de la vista activa" })).getByRole("button", { name: t });
    // Por defecto, una vista de planta en la primera planta: sólo el alzado esquemático, con ella marcada
    expect(within(sit()).getByRole("button", { name: `Ver la planta ${p0!.id}` }).getAttribute("aria-pressed")).toBe("true");
    expect(sit().querySelector("h2")!.textContent).toContain(`Planta ${p0!.id}`);
    expect(sit().querySelector(".sit-alzado")).toBeTruthy();
    expect(sit().querySelector(".sit-planta")).toBeNull();
    expect(within(sit()).queryAllByRole("button", { name: /^Ver el alzado del eje / })).toHaveLength(0);

    fireEvent.click(within(sit()).getByRole("button", { name: `Ver la planta ${p1!.id}` }));
    expect(within(sit()).getByRole("button", { name: `Ver la planta ${p1!.id}` }).getAttribute("aria-pressed")).toBe("true");
    expect(within(sit()).getByRole("button", { name: `Ver la planta ${p0!.id}` }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("img", { name: `Planta ${p1!.id}` })).toBeTruthy();

    // En un alzado: sólo la planta esquemática, con su eje marcado y las flechas de corte
    fireEvent.click(tipoVista("Alzado"));
    await waitFor(() => expect(container.querySelector(".celda")?.getAttribute("data-tipo")).toBe("alzado"));
    expect(sit().querySelector(".sit-planta")).toBeTruthy();
    expect(sit().querySelector(".sit-alzado")).toBeNull();
    expect(within(sit()).queryAllByRole("button", { name: /^Ver la planta/ })).toHaveLength(0);
    expect(within(sit()).getAllByRole("button", { pressed: true, name: /^Ver el alzado del eje / })).toHaveLength(1);
    expect(sit().querySelectorAll(".sit-corte").length).toBe(2);

    // Un clic en otro eje enseña su alzado
    const ejes = within(sit()).getAllByRole("button", { name: /^Ver el alzado del eje / });
    expect(ejes.length).toBeGreaterThan(1);
    const otro = ejes.find((b) => b.getAttribute("aria-pressed") === "false")!;
    const nombre = otro.getAttribute("aria-label")!.replace("Ver el alzado del eje ", "");
    fireEvent.click(otro);
    await waitFor(() => expect(screen.getByRole("img", { name: `Alzado del eje ${nombre}` })).toBeTruthy());
    expect(within(sit()).getByRole("button", { name: `Ver el alzado del eje ${nombre}` }).getAttribute("aria-pressed")).toBe("true");
    expect(sit().querySelectorAll(".sit-corte").length).toBe(2);

    // De vuelta a la planta, otra vez el alzado esquemático
    fireEvent.click(tipoVista("Planta"));
    await waitFor(() => expect(container.querySelector(".celda")?.getAttribute("data-tipo")).toBe("planta"));
    expect(sit().querySelector(".sit-alzado")).toBeTruthy();
    expect(sit().querySelector(".sit-planta")).toBeNull();
  }, 120_000);
});
