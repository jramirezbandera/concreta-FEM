/**
 * La hoja con varias filas elegidas, como en Excel (de la prueba de uso: «cambio la planta final de
 * los pilares uno a uno»): pegar un valor, Ctrl+D, Ctrl+Intro, Supr y el desplegable escriben en la
 * columna de todas las filas elegidas, en un paso de deshacer. Con la sesión de verdad en este proceso,
 * como `editor.test.tsx`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { DEF_TABLAS, type NombreTabla } from "../../../src/editor/tablas.ts";
import { App } from "../App.tsx";
import { ThemeProvider } from "../tema/ThemeProvider.tsx";

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

const hoja = (t: NombreTabla) => screen.getByRole("grid", { name: `Tabla de ${DEF_TABLAS[t].titulo.toLowerCase()}` });
const col = (t: NombreTabla, clave: string) => DEF_TABLAS[t].columnas.findIndex((c) => c.clave === clave) + 1;
const celda = (t: NombreTabla, fila: number, clave: string) => hoja(t).querySelectorAll("tbody tr")[fila]!.querySelectorAll("td")[col(t, clave)]! as HTMLElement;
/** La columna de las filas del modelo (sin la nueva). */
const columna = (t: NombreTabla, clave: string) => {
  const fs = [...hoja(t).querySelectorAll("tbody tr")].slice(0, -1);
  return fs.map((f) => f.querySelectorAll("td")[col(t, clave)]!.textContent);
};
const mensaje = () => document.querySelector("[data-mensaje-hoja]")!.textContent;

function elegirTabla(t: NombreTabla) {
  fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${DEF_TABLAS[t].titulo}\\s*\\d`) }));
}

/** Elige las filas a..b por la columna `clave`, como Mayús+clic. */
function elegirFilas(t: NombreTabla, a: number, b: number, clave: string) {
  fireEvent.mouseDown(celda(t, a, clave));
  fireEvent.mouseDown(celda(t, b, clave), { shiftKey: true });
}

describe("la hoja con varias filas elegidas", () => {
  it("pegar, Ctrl+D, Ctrl+Intro, Supr y el desplegable escriben en todas, y se deshace de una vez", async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Proyecto nuevo/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre del proyecto" }), { target: { value: "varias" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));
    await waitFor(() => expect(screen.getByRole("grid", { name: /Tabla de/ })).toBeTruthy(), { timeout: 30_000 });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Datos de la obra" })).getByRole("button", { name: "Más tarde" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Plantas" })).getByRole("button", { name: "Cerrar" }));

    elegirTabla("secciones");
    fireEvent.mouseDown(celda("secciones", 0, "id"));
    // La fila nueva de secciones es la única: pegar un bloque con cabecera
    fireEvent.paste(hoja("secciones"), { clipboardData: { getData: () => "id\tmaterial\tforma\tb\th\nP30\tHA-30\trectangular\t0,3\t0,3\n" } });
    expect(mensaje()).toMatch(/Pegada/);

    elegirTabla("pilares");
    const nueva = hoja("pilares").querySelectorAll("tbody tr").length - 1;
    fireEvent.mouseDown(celda("pilares", nueva, "x"));
    fireEvent.paste(hoja("pilares"), { clipboardData: { getData: () => "0\t0\tCim\tN1\tP30\n6\t0\tCim\tN1\tP30\n0\t5\tCim\tN1\tP30\n6\t5\tCim\tN1\tP30\n" } });
    expect(columna("pilares", "giro")).toEqual(["", "", "", ""]);

    // Un solo valor pegado sobre las cuatro filas: en todas
    elegirFilas("pilares", 0, 3, "giro");
    expect(mensaje()).toMatch(/4 filas elegidas/);
    fireEvent.paste(hoja("pilares"), { clipboardData: { getData: () => "90\r\n" } });
    expect(columna("pilares", "giro")).toEqual(["90", "90", "90", "90"]);
    expect(mensaje()).toMatch(/en 4 filas/);

    // Un paso de deshacer
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(columna("pilares", "giro")).toEqual(["", "", "", ""]));

    // Ctrl+D: la primera hacia abajo (sin tocar la primera)
    fireEvent.mouseDown(celda("pilares", 1, "giro"));
    fireEvent.keyDown(hoja("pilares"), { key: "4" });
    fireEvent.keyDown(within(celda("pilares", 1, "giro")).getByRole("textbox"), { key: "Enter" });
    expect(columna("pilares", "giro")).toEqual(["", "4", "", ""]);
    elegirFilas("pilares", 1, 3, "giro");
    fireEvent.keyDown(hoja("pilares"), { key: "d", ctrlKey: true });
    expect(columna("pilares", "giro")).toEqual(["", "4", "4", "4"]);

    // Ctrl+Intro: lo tecleado, en todas; Intro sin Ctrl, sólo en la activa
    elegirFilas("pilares", 0, 2, "giro");
    fireEvent.keyDown(hoja("pilares"), { key: "7" });
    fireEvent.keyDown(within(celda("pilares", 2, "giro")).getByRole("textbox"), { key: "Enter", ctrlKey: true });
    expect(columna("pilares", "giro")).toEqual(["7", "7", "7", "4"]);

    // Cambiar de columna con las flechas deja las filas elegidas; el desplegable va a todas
    fireEvent.keyDown(hoja("pilares"), { key: "ArrowLeft" });
    fireEvent.keyDown(hoja("pilares"), { key: "ArrowRight" });
    fireEvent.keyDown(hoja("pilares"), { key: "Delete" });
    expect(columna("pilares", "giro")).toEqual(["", "", "", "4"]);
    elegirFilas("pilares", 0, 3, "base");
    fireEvent.keyDown(hoja("pilares"), { key: "Enter" });
    fireEvent.change(within(celda("pilares", 3, "base")).getByRole("combobox"), { target: { value: "articulado" } });
    expect(columna("pilares", "base")).toEqual(["articulado", "articulado", "articulado", "articulado"]);

    // Supr: vacía la columna de todas
    elegirFilas("pilares", 0, 3, "giro");
    fireEvent.keyDown(hoja("pilares"), { key: "Delete" });
    expect(columna("pilares", "giro")).toEqual(["", "", "", ""]);

    // Si una no lo admite, ninguna
    elegirFilas("pilares", 0, 3, "giro");
    fireEvent.paste(hoja("pilares"), { clipboardData: { getData: () => "abc" } });
    expect(columna("pilares", "giro")).toEqual(["", "", "", ""]);
    expect(mensaje()).toMatch(/No se cambió ninguna/);
  }, 120_000);
});
