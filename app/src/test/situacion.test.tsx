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
import { AlzadoEsquema } from "../armazon/Situacion.tsx";
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

describe("Situación · alzado esquemático", () => {
  it("cada fila mide la altura de la planta de abajo (hasta la de encima), no la de la de arriba", () => {
    // Cinco plantas de 3 m sobre la cimentación; la de arriba, con una altura que no se dibuja (nada encima)
    const plantas = [
      { id: "N5", cota: 15, altura: 0.5 },
      { id: "N4", cota: 12, altura: 3 },
      { id: "N3", cota: 9, altura: 3 },
      { id: "N2", cota: 6, altura: 3 },
      { id: "N1", cota: 3, altura: 3 },
      { id: "Cim", cota: 0, altura: 3 },
    ];
    const { container } = render(<AlzadoEsquema plantas={plantas} activa={null} otras={new Set()} onPlanta={() => {}} />);
    const ys = [...container.querySelectorAll(".sit-id")].map((t) => Number(t.getAttribute("y")));
    const filas = ys.slice(1).map((y, i) => y - ys[i]!);
    expect(filas).toHaveLength(5);
    for (const f of filas) expect(f).toBeCloseTo(filas[0]!, 9);
    expect(filas[0]).toBeGreaterThan(15);
    // El tramo de debajo de cada planta, en su rótulo
    expect(container.querySelector("title")!.textContent).toContain("tramo de debajo 3,00 m");
  });
});

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

    // En Resultados también: el navegador lleva la Situación y navega igual
    // El ejemplo se calcula solo al abrirlo
    await waitFor(() => expect(screen.getByRole("button", { name: "Resultados" }).hasAttribute("disabled")).toBe(false), { timeout: 90_000 });
    fireEvent.click(screen.getByRole("button", { name: "Resultados" }));
    await waitFor(() => expect(screen.getByText("Situación", { selector: "h2 span" })).toBeTruthy());
    fireEvent.click(within(sit()).getByRole("button", { name: `Ver la planta ${p1!.id}` }));
    expect(within(sit()).getByRole("button", { name: `Ver la planta ${p1!.id}` }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("img", { name: `Planta ${p1!.id}` })).toBeTruthy();
  }, 180_000);
});
