/**
 * DO2 (`docs/fem3d/datos-obra.md` §5): «Datos de la obra» en la app.
 * - criterio 2: el material de la obra es el que propone una sección nueva de pilar;
 * - criterio 4: el emplazamiento es un solo dato, escrito desde aquí o desde la ficha de acciones;
 * - criterio 5: una obra nueva va del nombre a los datos y a las plantas, y «Más tarde» salta los datos.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { DEF_TABLAS, type NombreTabla } from "../../../src/editor/tablas.ts";
import { App } from "../App.tsx";
import { NUEVA } from "../editor/referencia.tsx";
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

/** Una obra nueva, con el nombre: queda abierto «Datos de la obra» en su modo de inicio. */
async function obraNueva(nombre: string): Promise<HTMLElement> {
  render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Proyecto nuevo/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Nombre del proyecto" }), { target: { value: nombre } });
  fireEvent.click(screen.getByRole("button", { name: "Crear" }));
  await waitFor(() => expect(screen.getByRole("grid", { name: /Tabla de/ })).toBeTruthy(), { timeout: 30_000 });
  return screen.getByRole("dialog", { name: "Datos de la obra" });
}

/** Elige un municipio en el buscador del emplazamiento. */
function elegirMunicipio(dlg: HTMLElement, busqueda: string, nombre: RegExp) {
  fireEvent.change(within(dlg).getByRole("textbox", { name: "Buscar municipio" }), { target: { value: busqueda } });
  fireEvent.click(within(within(dlg).getByRole("listbox", { name: "Municipios del Anejo 1" })).getAllByRole("option", { name: nombre })[0]!);
}

const barra = () => screen.getByRole("toolbar", { name: "Herramientas de Modelo" });
const hoja = (t: NombreTabla) => screen.getByRole("grid", { name: `Tabla de ${DEF_TABLAS[t].titulo.toLowerCase()}` });
const elegirTabla = (t: NombreTabla) => fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${DEF_TABLAS[t].titulo}\\s*\\d`) }));
/** Los ids de una tabla (la primera columna de cada fila, sin la nueva). */
const idsTabla = (t: NombreTabla) => [...hoja(t).querySelectorAll("tbody tr")].slice(0, -1).map((tr) => tr.querySelectorAll("td")[1]!.textContent);
const deshacer = () => screen.getByRole("button", { name: "Deshacer" });
const nombreBarra = () => document.querySelector<HTMLButtonElement>("header button.nombre-proyecto")!;

/** Abre el desplegable de una celda (fila f; la nueva, con -1) y elige `valor`. */
function elegirEnCelda(t: NombreTabla, f: number, clave: string, valor: string) {
  const filas = hoja(t).querySelectorAll("tbody tr");
  const tr = filas[f < 0 ? filas.length + f : f]!;
  const j = DEF_TABLAS[t].columnas.findIndex((c) => c.clave === clave);
  const td = tr.querySelectorAll("td")[j + 1]!;
  fireEvent.mouseDown(td);
  fireEvent.doubleClick(td);
  fireEvent.change(within(td as HTMLElement).getByRole("combobox"), { target: { value: valor } });
}

describe("DO2: Datos de la obra", () => {
  it("obra nueva: nombre → datos (uso, municipio, material de pilares) → plantas, en un paso de deshacer; la sección nueva de un pilar va con su material", async () => {
    let dlg = await obraNueva("do-nueva");
    expect((within(dlg).getByRole("textbox", { name: "Nombre" }) as HTMLInputElement).value).toBe("do-nueva");
    // El proyecto nuevo trae el HA-30 en forjados, pilares y muros y el uso A
    expect((within(dlg).getByRole("combobox", { name: "Pilares" }) as HTMLSelectElement).value).toBe("HA-30");
    expect((within(dlg).getByRole("combobox", { name: "Uso del edificio" }) as HTMLSelectElement).value).toBe("A");
    fireEvent.change(within(dlg).getByRole("combobox", { name: "Uso del edificio" }), { target: { value: "B" } });
    elegirMunicipio(dlg, "Alhaurín el G", /^Alhaurín el Grande/);
    // Lo que sale del emplazamiento, al momento
    expect(within(dlg).getByText(/^ab = 0,\d+ g · K = 1/)).toBeTruthy();
    expect(within(dlg).getByText(/^A · qb = 0,42/)).toBeTruthy();
    fireEvent.change(within(dlg).getByRole("textbox", { name: "Altitud" }), { target: { value: "240" } });
    expect(within(dlg).getByText(/^sk = 0,\d+ kN\/m² \(zona \d\)/)).toBeTruthy();
    fireEvent.change(within(dlg).getByRole("combobox", { name: "Pilares" }), { target: { value: "HA-25" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Siguiente: plantas" }));
    // Después, las plantas en su modo de inicio
    dlg = screen.getByRole("dialog", { name: "Plantas" });
    expect(within(dlg).getByText("Empiece por las plantas.")).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Cerrar" }));
    expect(deshacer().getAttribute("title")).toMatch(/Datos de la obra/);
    elegirTabla("materiales");
    expect(idsTabla("materiales")).toEqual(["HA-30", "HA-25"]);
    // Criterio 2: la sección nueva de un pilar propone el HA-25 de la obra (el más usado sería el HA-30)
    elegirTabla("pilares");
    elegirEnCelda("pilares", -1, "seccion", NUEVA);
    const sec = screen.getByRole("dialog", { name: "Secciones" });
    expect((within(sec).getByRole("combobox", { name: "Material de la sección" }) as HTMLSelectElement).value).toBe("HA-25");
    fireEvent.click(within(sec).getByRole("button", { name: "Cerrar" }));
    // Un paso de deshacer quita todo lo de los datos
    fireEvent.click(deshacer());
    elegirTabla("materiales");
    expect(idsTabla("materiales")).toEqual(["HA-30"]);
  }, 90_000);

  it("«Más tarde» lleva a las plantas sin escribir nada; después se abre desde «Obra» y desde el nombre de la barra de título", async () => {
    const dlg = await obraNueva("do-tarde");
    fireEvent.click(within(dlg).getByRole("button", { name: "Más tarde" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Plantas" })).getByRole("button", { name: "Cerrar" }));
    expect((deshacer() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(barra()).getByRole("button", { name: "Obra" }));
    let obra = screen.getByRole("dialog", { name: "Datos de la obra" });
    expect(within(obra).getByRole("button", { name: "Aplicar" })).toBeTruthy();
    fireEvent.click(within(obra).getByRole("button", { name: "Cancelar" }));
    expect(nombreBarra().textContent).toBe("do-tarde");
    fireEvent.click(nombreBarra());
    obra = screen.getByRole("dialog", { name: "Datos de la obra" });
    // El nombre nuevo se ve en la barra de título
    fireEvent.change(within(obra).getByRole("textbox", { name: "Nombre" }), { target: { value: "otra" } });
    fireEvent.click(within(obra).getByRole("button", { name: "Aplicar" }));
    expect(screen.queryByRole("dialog", { name: "Datos de la obra" })).toBeNull();
    await waitFor(() => expect(nombreBarra().textContent).toBe("otra"));
  }, 90_000);

  it("criterio 4: el emplazamiento escrito aquí es el de la ficha de acciones, y lo escrito allí se ve aquí; «Configurar…» vuelve aquí", async () => {
    let dlg = await obraNueva("do-emp");
    elegirMunicipio(dlg, "Alhaurín el G", /^Alhaurín el Grande/);
    // Marcar el viento aplica lo escrito y abre la ficha con el viento marcado
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "Con viento" }));
    let ficha = screen.getByRole("dialog", { name: "Viento, nieve y sismo" });
    expect(within(ficha).getByText("Alhaurín el Grande")).toBeTruthy();
    expect((within(ficha).getByRole("checkbox", { name: /Viento del programa/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(within(ficha).getByRole("textbox", { name: "Altitud" }), { target: { value: "300" } });
    fireEvent.click(within(ficha).getByRole("button", { name: "Aplicar" }));
    // Vuelve a los datos de la obra, en su modo de inicio, con el viento y la altitud de la ficha
    dlg = screen.getByRole("dialog", { name: "Datos de la obra" });
    expect((within(dlg).getByRole("checkbox", { name: "Con viento" }) as HTMLInputElement).checked).toBe(true);
    expect(within(dlg).getByText(/zona A · entorno IV · 8 casos/)).toBeTruthy();
    expect((within(dlg).getByRole("textbox", { name: "Altitud" }) as HTMLInputElement).value).toBe("300");
    expect(within(dlg).getByRole("button", { name: "Siguiente: plantas" })).toBeTruthy();
    // Y al revés: la altitud de aquí es la de la ficha
    fireEvent.change(within(dlg).getByRole("textbox", { name: "Altitud" }), { target: { value: "320" } });
    fireEvent.click(within(dlg).getAllByRole("button", { name: "Configurar…" })[2]!);
    ficha = screen.getByRole("dialog", { name: "Viento, nieve y sismo" });
    expect((within(ficha).getByRole("textbox", { name: "Altitud" }) as HTMLInputElement).value).toBe("320");
    fireEvent.click(within(ficha).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("dialog", { name: "Datos de la obra" })).toBeTruthy();
  }, 90_000);
});
