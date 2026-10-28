/**
 * La herramienta activa de V2c-1 en la app (`docs/fem3d/dibujo.md` §2.1), sin las vistas (jsdom no
 * tiene WebGL; lo que pasa en ellas lo prueba `validacion/v2c/chrome.ts`): la barra la activa, la
 * plantilla sale en Propiedades, una sección nueva se crea desde ella, F8 pone el ortogonal, F3 los enganches al DXF, una
 * tecla abre el campo de teclado y Esc vuelve a Elegir.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    // Una obra nueva abre el gestor de plantas: aquí no se toca
    fireEvent.click(within(screen.getByRole("dialog", { name: "Plantas" })).getByRole("button", { name: "Cerrar" }));

    const pilar = screen.getByRole("button", { name: "Pilar" });
    expect(pilar.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pilar);
    expect(pilar.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("region", { name: "Dibujar · Pilar" })).toBeTruthy();
    // El proyecto nuevo no tiene secciones: la plantilla ofrece crear una en el gestor (GE; 30 × 30 por defecto)
    fireEvent.click(screen.getByRole("button", { name: "Nueva sección…" }));
    fireEvent.click(screen.getByRole("button", { name: "Crear y usar" }));
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Sección" }) as HTMLSelectElement).value).toBe("P30x30"));
    expect(screen.getByRole("button", { name: "Deshacer" }).getAttribute("title")).toMatch(/Sección P30x30/);

    // F8, el ortogonal
    const orto = screen.getByRole("checkbox", { name: /Ortogonal/ }) as HTMLInputElement;
    expect(orto.checked).toBe(false);
    fireEvent.keyDown(window, { key: "F8" });
    expect(orto.checked).toBe(true);
    // F3, los enganches a la plantilla DXF; el botón dice lo mismo
    const dxf = within(screen.getByRole("group", { name: "Enganchar a" })).getByRole("button", { name: "Plantilla DXF" });
    expect(dxf.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "F3" });
    expect(dxf.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(dxf);
    expect(dxf.getAttribute("aria-pressed")).toBe("true");

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

  it("V2c-2: las plantillas de Forjado, Muro y Apoyo, y las cargas en el caso activo", async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Proyecto nuevo/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre del proyecto" }), { target: { value: "piezas" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));
    await waitFor(() => expect(screen.getByRole("grid", { name: /Tabla de/ })).toBeTruthy(), { timeout: 30_000 });
    // Una obra nueva abre el gestor de plantas: aquí no se toca
    fireEvent.click(within(screen.getByRole("dialog", { name: "Plantas" })).getByRole("button", { name: "Cerrar" }));

    // Forjado: recuadro y maciza por defecto, con el material del proyecto; reticular, 25+5 y el pp obligatorio
    fireEvent.click(screen.getByRole("button", { name: "Forjado" }));
    const forjado = screen.getByRole("region", { name: "Dibujar · Forjado" });
    expect(screen.getByRole("radio", { name: "Recuadro" }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByRole("textbox", { name: "canto" }) as HTMLInputElement).value).toBe("0,25");
    expect((screen.getByRole("combobox", { name: "Material" }) as HTMLSelectElement).value).toBe("HA-30");
    fireEvent.click(screen.getByRole("radio", { name: "Reticular" }));
    expect((screen.getByRole("textbox", { name: "canto" }) as HTMLInputElement).value).toBe("0,3");
    expect((screen.getByRole("textbox", { name: "nervio" }) as HTMLInputElement).value).toBe("0,12");
    expect(screen.getByRole("textbox", { name: "pp" }).getAttribute("data-error")).toBe("true");
    expect(forjado.textContent).toMatch(/Un clic dentro de un recuadro/);

    // Muro y Apoyo
    fireEvent.click(screen.getByRole("button", { name: "Muro" }));
    expect((screen.getByRole("textbox", { name: "espesor" }) as HTMLInputElement).value).toBe("0,25");
    fireEvent.click(screen.getByRole("button", { name: "Apoyo" }));
    expect(screen.getByRole("radio", { name: "Empotrado" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "uz" }));
    expect(screen.getByRole("radio", { name: "Empotrado" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("button", { name: "uz" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.keyDown(window, { key: "Escape" });

    // En Cargas, las herramientas van al caso activo; sin valor no hay carga por defecto
    fireEvent.click(screen.getByRole("button", { name: "Cargas" }));
    fireEvent.click(await screen.findByRole("button", { name: "Puntual" }));
    const puntual = screen.getByRole("region", { name: "Dibujar · Carga puntual" });
    expect(puntual.textContent).toMatch(/caso G/);
    expect((screen.getByRole("textbox", { name: "F" }) as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByRole("textbox", { name: "F" }), { target: { value: "0 0 -12,5" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "F" }), { key: "Enter" });
    expect((screen.getByRole("textbox", { name: "F" }) as HTMLInputElement).value).toBe("0 0 -12,5");
    fireEvent.change(screen.getByRole("combobox", { name: "Caso activo" }), { target: { value: "Q" } });
    await waitFor(() => expect(screen.getByRole("region", { name: "Dibujar · Carga puntual" }).textContent).toMatch(/caso Q/));
  }, 60_000);

  it("Alzado sin ejes: se puede elegir, lo dice y «Dibujar ejes» vuelve a la planta con la herramienta Ejes", async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Proyecto nuevo/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre del proyecto" }), { target: { value: "alzado" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));
    await waitFor(() => expect(screen.getByRole("grid", { name: /Tabla de/ })).toBeTruthy(), { timeout: 30_000 });
    // Una obra nueva abre el gestor de plantas: aquí no se toca
    fireEvent.click(within(screen.getByRole("dialog", { name: "Plantas" })).getByRole("button", { name: "Cerrar" }));

    const celda = () => document.querySelector<HTMLElement>(".celda")!;
    const alzado = screen.getByRole("button", { name: "Alzado" }) as HTMLButtonElement;
    expect(alzado.disabled).toBe(false);
    fireEvent.click(alzado);
    await waitFor(() => expect(celda().dataset.tipo).toBe("alzado"));
    expect(screen.getByText(/el proyecto aún no tiene ninguno/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dibujar ejes" }));
    await waitFor(() => expect(celda().dataset.tipo).toBe("planta"));
    expect(screen.getByRole("button", { name: "Ejes" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("region", { name: "Dibujar · Ejes" })).toBeTruthy();
  }, 60_000);
});
