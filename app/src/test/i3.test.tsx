/**
 * I3 en el DOM (`docs/fem3d/interfaz.md` §16), con la app entera y la sesión de verdad en este
 * proceso (sin WebGL: las vistas no pintan, pero su estado y sus controles sí funcionan):
 * - el 3D tiene los cuatro modos, con el sólido por defecto;
 * - las opciones de la vista y H, Ctrl+H y Mayús+H cambian los filtros de la vista activa, y la
 *   cabecera los dice y los quita;
 * - la profundidad del alzado se elige en su cabecera;
 * - guardar una vista es una operación del editor (se deshace) que no cambia la huella; el navegador
 *   la lista, la renombra, la abre en la vista activa y la borra (criterio 4).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { App } from "../App.tsx";
import { ThemeProvider } from "../tema/ThemeProvider.tsx";

// El worker de sesión, en este proceso
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

const celda = (i = 0) => document.querySelector<HTMLElement>(`.celda[data-vista="${i}"]`)!;
const selectEn = (etiqueta: string) => within(celda()).getByRole("combobox", { name: etiqueta }) as HTMLSelectElement;
const chips = () => [...celda().querySelectorAll(".chip-filtro")].map((c) => c.textContent?.trim());

async function abrirEjemplo() {
  localStorage.clear();
  window.history.replaceState(null, "", "/?ejemplo=ejemplo");
  const r = render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
  await waitFor(() => expect(r.container.querySelector("[data-estado]")?.getAttribute("data-estado")).toMatch(/calculado|sin-calcular/), { timeout: 60_000 });
  fireEvent.click(screen.getByRole("button", { name: "3D" }));
  await waitFor(() => expect(celda().dataset.tipo).toBe("3d"));
  return r;
}

describe("I3 · DOM", () => {
  it("el 3D: cuatro modos con el sólido por defecto; opciones, H, Ctrl+H y Mayús+H filtran la vista activa y los chips lo quitan", async () => {
    const r = await abrirEjemplo();
    const modo = selectEn("Modo del 3D");
    expect([...modo.options].map((o) => o.value)).toEqual(["solido", "translucido", "alambrico", "analitico"]);
    expect(modo.value).toBe("solido");

    // Opciones: sin losas y de la planta de abajo a la de arriba
    fireEvent.click(within(celda()).getByRole("button", { name: "Opciones de la vista" }));
    const opciones = within(celda()).getByRole("group", { name: "Opciones de la vista" });
    fireEvent.click(within(opciones).getByRole("checkbox", { name: "Losas" }));
    expect(chips()).toEqual(["Sin losas"]);
    const plantas = [...within(opciones).getByRole("combobox", { name: "Planta de abajo" }).querySelectorAll("option")].map((o) => o.getAttribute("value")).filter(Boolean);
    fireEvent.change(within(opciones).getByRole("combobox", { name: "Planta de abajo" }), { target: { value: plantas[plantas.length - 1] } });
    expect(chips()[0]).toMatch(/^Plantas /);
    fireEvent.click(within(opciones).getByRole("radio", { name: "Por planta" }));
    fireEvent.click(within(opciones).getByRole("button", { name: "Mostrar todo" }));
    expect(chips()).toEqual([]);
    fireEvent.click(within(opciones).getByRole("button", { name: "Cerrar las opciones" }));

    // H con algo elegido: aislado; otra vez, suelto; Ctrl+H, oculto; Mayús+H, todo. Se elige el primer pilar en el navegador
    fireEvent.click(screen.getByRole("button", { name: /^Pilares/ }));
    const filaPilar = document.querySelector<HTMLButtonElement>(".arbol-fila.sub")!;
    fireEvent.click(filaPilar);
    fireEvent.keyDown(window, { key: "h" });
    expect(chips()).toEqual(["Aislados: 1"]);
    fireEvent.keyDown(window, { key: "h" });
    expect(chips()).toEqual([]);
    fireEvent.keyDown(window, { key: "h", ctrlKey: true });
    expect(chips()).toEqual(["Ocultos: 1"]);
    fireEvent.keyDown(window, { key: "H", shiftKey: true });
    expect(chips()).toEqual([]);
    // Un chip se quita con su botón
    fireEvent.keyDown(window, { key: "h" });
    fireEvent.click(within(celda()).getByRole("button", { name: "Quitar: Aislados: 1" }));
    expect(chips()).toEqual([]);
    r.unmount();
  }, 120_000);

  it("guardar una vista no cambia la huella y se deshace; el navegador la renombra, la abre como se guardó y la borra", async () => {
    const r = await abrirEjemplo();
    const huella = () => r.container.querySelector("[data-huella]")?.getAttribute("data-huella");
    const h0 = huella();
    // Un 3D translúcido, sin losas, guardado como «Sin losas»
    fireEvent.change(selectEn("Modo del 3D"), { target: { value: "translucido" } });
    fireEvent.click(within(celda()).getByRole("button", { name: "Opciones de la vista" }));
    fireEvent.click(within(celda()).getByRole("checkbox", { name: "Losas" }));
    fireEvent.click(within(celda()).getByRole("button", { name: "Guardar la vista" }));
    const form = within(celda()).getByRole("group", { name: "Guardar la vista" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Nombre de la vista" }), { target: { value: "Sin losas" } });
    fireEvent.click(within(form).getByRole("button", { name: "Guardar" }));
    const nav = () => screen.getByText("Vistas", { selector: "h2 span" }).closest("section")!;
    await waitFor(() => expect(within(nav()).getByRole("button", { name: "Sin losas" })).toBeTruthy());
    // No cambia la huella (las vistas no son del modelo)
    await new Promise((x) => setTimeout(x, 200));
    expect(huella()).toBe(h0);

    // La vista activa, a otra cosa; abrir la guardada la deja como estaba
    fireEvent.click(within(celda()).getByRole("button", { name: "Mostrar todo" }));
    fireEvent.change(selectEn("Modo del 3D"), { target: { value: "alambrico" } });
    expect(chips()).toEqual([]);
    fireEvent.click(within(nav()).getByRole("button", { name: "Sin losas" }));
    await waitFor(() => expect(selectEn("Modo del 3D").value).toBe("translucido"));
    expect(chips()).toEqual(["Sin losas"]);

    // Renombrar y borrar; deshacer devuelve la borrada
    fireEvent.click(within(nav()).getByRole("button", { name: "Renombrar la vista Sin losas" }));
    const entrada = within(nav()).getByRole("textbox", { name: "Nuevo nombre de la vista Sin losas" });
    fireEvent.change(entrada, { target: { value: "Pórtico sin losas" } });
    fireEvent.keyDown(entrada, { key: "Enter" });
    await waitFor(() => expect(within(nav()).getByRole("button", { name: "Pórtico sin losas" })).toBeTruthy());
    fireEvent.click(within(nav()).getByRole("button", { name: "Borrar la vista Pórtico sin losas" }));
    await waitFor(() => expect(within(nav()).queryByRole("button", { name: "Pórtico sin losas" })).toBeNull());
    act(() => {
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    });
    await waitFor(() => expect(within(nav()).getByRole("button", { name: "Pórtico sin losas" })).toBeTruthy());
    r.unmount();
  }, 120_000);

  it("el alzado elige su profundidad en la cabecera", async () => {
    const r = await abrirEjemplo();
    fireEvent.click(screen.getByRole("button", { name: "Alzado" }));
    await waitFor(() => expect(celda().dataset.tipo).toBe("alzado"));
    const d = selectEn("Profundidad del alzado");
    expect([...d.options].map((o) => o.value)).toEqual(["0.25", "0.5", "1", "2", "5"]);
    expect(d.value).toBe("0.5");
    fireEvent.change(d, { target: { value: "2" } });
    expect(selectEn("Profundidad del alzado").value).toBe("2");
    r.unmount();
  }, 120_000);
});
