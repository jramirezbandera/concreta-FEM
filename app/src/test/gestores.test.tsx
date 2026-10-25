/**
 * GE en la app (`docs/fem3d/gestores.md`, criterios 1 y 2): los gestores de secciones y materiales
 * desde la barra, y «Nueva…» desde la hoja, el inspector y la plantilla de dibujo. Lo creado y
 * elegido es un solo paso de deshacer.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { DEF_TABLAS, type NombreTabla } from "../../../src/editor/tablas.ts";
import { hormigon } from "../../../src/secciones/seccion3D.ts";
import { App } from "../App.tsx";
import { fmt } from "../fmt.ts";
import { EDITAR, NUEVA } from "../editor/referencia.tsx";
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

async function proyectoNuevo(nombre: string) {
  render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Proyecto nuevo/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Nombre del proyecto" }), { target: { value: nombre } });
  fireEvent.click(screen.getByRole("button", { name: "Crear" }));
  await waitFor(() => expect(screen.getByRole("grid", { name: /Tabla de/ })).toBeTruthy(), { timeout: 30_000 });
}

const barra = () => screen.getByRole("toolbar", { name: "Herramientas de Modelo" });
const hoja = (t: NombreTabla) => screen.getByRole("grid", { name: `Tabla de ${DEF_TABLAS[t].titulo.toLowerCase()}` });
const elegirTabla = (t: NombreTabla) => fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${DEF_TABLAS[t].titulo}\\s*\\d`) }));
/** Los ids de una tabla (la primera columna de cada fila, sin la nueva). */
const idsTabla = (t: NombreTabla) => [...hoja(t).querySelectorAll("tbody tr")].slice(0, -1).map((tr) => tr.querySelectorAll("td")[1]!.textContent);
const deshacer = () => screen.getByRole("button", { name: "Deshacer" });

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

/** Escribe una celda de texto de la fila nueva. */
function escribirCelda(t: NombreTabla, clave: string, valor: string) {
  const filas = hoja(t).querySelectorAll("tbody tr");
  const j = DEF_TABLAS[t].columnas.findIndex((c) => c.clave === clave);
  const td = filas[filas.length - 1]!.querySelectorAll("td")[j + 1]!;
  fireEvent.mouseDown(td);
  fireEvent.doubleClick(td);
  const input = within(td as HTMLElement).getByRole("textbox");
  fireEvent.change(input, { target: { value: valor } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("GE: el gestor de secciones desde la barra", () => {
  it("un perfil HEB 200 del catálogo con su acero típico, en un paso; el material se ve en su gestor", async () => {
    await proyectoNuevo("ge-barra");
    fireEvent.click(within(barra()).getByRole("button", { name: "Secciones" }));
    const dlg = screen.getByRole("dialog", { name: "Secciones" });
    // Sin secciones, abre en «Nueva», con la rectangular de hormigón propuesta
    expect(within(dlg).getByRole("radio", { name: /Rectangular/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(dlg).getByRole("radio", { name: /Perfil de catálogo/ }));
    fireEvent.change(within(dlg).getByRole("combobox", { name: "Serie del perfil" }), { target: { value: "HEB" } });
    fireEvent.change(within(dlg).getByRole("combobox", { name: "Tamaño del perfil" }), { target: { value: "200" } });
    expect((within(dlg).getByRole("combobox", { name: "Material de la sección" }) as HTMLSelectElement).value).toBe("S275");
    expect(within(dlg).getByRole("textbox", { name: "id de la sección" }).getAttribute("placeholder")).toBe("HEB200");
    // Las propiedades, las del compilador: A del catálogo en cm²
    expect(within(dlg).getByText("78,10 cm²")).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Crear" }));
    expect(within(dlg).getByRole("status").textContent).toBe("Creada HEB200.");
    expect(within(within(dlg).getByRole("navigation", { name: "Lista de secciones" })).getByRole("button", { name: /HEB200/ }).getAttribute("aria-current")).toBe("true");
    expect(deshacer().getAttribute("title")).toMatch(/Nueva sección HEB200/);
    fireEvent.click(within(dlg).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog", { name: "Secciones" })).toBeNull();

    // El acero típico se creó con ella
    fireEvent.click(within(barra()).getByRole("button", { name: "Materiales" }));
    const mats = screen.getByRole("dialog", { name: "Materiales" });
    expect(within(within(mats).getByRole("navigation", { name: "Lista de materiales" })).getByRole("button", { name: /S275/ })).toBeTruthy();
    fireEvent.keyDown(mats, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Materiales" })).toBeNull();

    // Un paso de deshacer quita la sección y su material
    fireEvent.click(deshacer());
    elegirTabla("materiales");
    expect(idsTabla("materiales")).toEqual(["HA-30"]);
    elegirTabla("secciones");
    expect(idsTabla("secciones")).toEqual([]);
  }, 60_000);

  it("cambiar una sección que se usa: «Aplicar a 1 pilar», y Duplicar propone otro id", async () => {
    await proyectoNuevo("ge-cambiar");
    fireEvent.click(within(barra()).getByRole("button", { name: "Secciones" }));
    let dlg = screen.getByRole("dialog", { name: "Secciones" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Crear" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Cerrar" }));
    elegirTabla("pilares");
    escribirCelda("pilares", "x", "0");
    escribirCelda("pilares", "y", "0");
    elegirEnCelda("pilares", -1, "desde", "Cim");
    elegirEnCelda("pilares", -1, "hasta", "N1");
    elegirEnCelda("pilares", -1, "seccion", "V30x50");
    await waitFor(() => expect(idsTabla("pilares")).toEqual(["P1"]));

    fireEvent.click(within(barra()).getByRole("button", { name: "Secciones" }));
    dlg = screen.getByRole("dialog", { name: "Secciones" });
    expect(within(dlg).getByText(/Se usa en 1 pilar/)).toBeTruthy();
    fireEvent.change(within(dlg).getByRole("textbox", { name: "h de la sección, cm" }), { target: { value: "60" } });
    fireEvent.change(within(dlg).getByRole("textbox", { name: "id de la sección" }), { target: { value: "V30x60" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Aplicar a 1 pilar" }));
    expect(within(dlg).getByRole("status").textContent).toBe("V30x60: cambiada en 1 pilar.");
    fireEvent.click(within(dlg).getByRole("button", { name: "Duplicar" }));
    expect((within(dlg).getByRole("textbox", { name: "id de la sección" }) as HTMLInputElement).value).toBe("V30x60-2");
    fireEvent.click(within(dlg).getByRole("button", { name: "Cerrar" }));
    elegirTabla("pilares");
    expect(hoja("pilares").textContent).toContain("V30x60");
  }, 60_000);
});

describe("GE: «Nueva…» desde los desplegables", () => {
  it("en la hoja: una fila del modelo cambia de sección a una nueva en un solo paso", async () => {
    await proyectoNuevo("ge-hoja");
    elegirTabla("pilares");
    // En la fila nueva: crear y escribir la celda
    elegirEnCelda("pilares", -1, "seccion", NUEVA);
    let dlg = screen.getByRole("dialog", { name: "Secciones" });
    expect(within(dlg).getByText("Para sección de la fila nueva")).toBeTruthy();
    expect(within(dlg).getByRole("textbox", { name: "id de la sección" }).getAttribute("placeholder")).toBe("P30x30");
    fireEvent.click(within(dlg).getByRole("button", { name: "Crear y usar" }));
    expect(screen.queryByRole("dialog", { name: "Secciones" })).toBeNull();
    escribirCelda("pilares", "x", "1");
    escribirCelda("pilares", "y", "2");
    elegirEnCelda("pilares", -1, "desde", "Cim");
    elegirEnCelda("pilares", -1, "hasta", "N1");
    await waitFor(() => expect(idsTabla("pilares")).toEqual(["P1"]));
    expect(hoja("pilares").textContent).toContain("P30x30");

    // En una fila del modelo: un 40 × 40, creado y elegido de una vez
    elegirEnCelda("pilares", 0, "seccion", NUEVA);
    dlg = screen.getByRole("dialog", { name: "Secciones" });
    fireEvent.change(within(dlg).getByRole("textbox", { name: "b de la sección, cm" }), { target: { value: "40" } });
    fireEvent.change(within(dlg).getByRole("textbox", { name: "h de la sección, cm" }), { target: { value: "40" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Crear y usar" }));
    expect(screen.queryByRole("dialog", { name: "Secciones" })).toBeNull();
    expect(deshacer().getAttribute("title")).toMatch(/P1 · sección = P40x40/);
    expect(hoja("pilares").textContent).toContain("P40x40");
    fireEvent.click(deshacer());
    expect(hoja("pilares").textContent).toContain("P30x30");
    elegirTabla("secciones");
    expect(idsTabla("secciones")).toEqual(["P30x30"]);

    // «Editar…» abre el gestor con la de la celda, y «Usar» la deja
    elegirTabla("pilares");
    elegirEnCelda("pilares", 0, "seccion", EDITAR);
    dlg = screen.getByRole("dialog", { name: "Secciones" });
    expect(within(within(dlg).getByRole("navigation", { name: "Lista de secciones" })).getByRole("button", { name: /P30x30/ }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(within(dlg).getByRole("button", { name: "Usar P30x30" }));
    expect(screen.queryByRole("dialog", { name: "Secciones" })).toBeNull();
  }, 60_000);

  it("en el inspector: el material de una sección, con un hormigón típico que no estaba", async () => {
    await proyectoNuevo("ge-inspector");
    fireEvent.click(within(barra()).getByRole("button", { name: "Secciones" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Secciones" })).getByRole("button", { name: "Crear" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Secciones" })).getByRole("button", { name: "Cerrar" }));
    elegirTabla("secciones");
    fireEvent.mouseDown(hoja("secciones").querySelectorAll("tbody tr")[0]!.querySelectorAll("td")[1]!);
    const material = await screen.findByRole("combobox", { name: "material" });
    // Las opciones dicen qué es cada uno, y al final «Nuevo material…» y «Editar…»
    expect([...(material as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["HA-30 · hormigón, fck 30", "────────────", "Nuevo material…", "Editar «HA-30»…"]);
    fireEvent.change(material, { target: { value: NUEVA } });
    const dlg = screen.getByRole("dialog", { name: "Materiales" });
    expect(within(dlg).getByText("Para el material de V30x50")).toBeTruthy();
    fireEvent.click(within(within(dlg).getByRole("group", { name: "Materiales típicos" })).getByRole("button", { name: /HA-35/ }));
    expect(screen.queryByRole("dialog", { name: "Materiales" })).toBeNull();
    expect(deshacer().getAttribute("title")).toMatch(/V30x50 · material = HA-35/);
    expect((screen.getByRole("combobox", { name: "material" }) as HTMLSelectElement).value).toBe("HA-35");
    fireEvent.click(deshacer());
    await waitFor(() => expect((screen.getByRole("combobox", { name: "material" }) as HTMLSelectElement).value).toBe("HA-30"));
    elegirTabla("materiales");
    expect(idsTabla("materiales")).toEqual(["HA-30"]);
  }, 60_000);

  it("en la plantilla de Pilar: sin secciones, «Nueva sección…»; la creada queda en la plantilla", async () => {
    await proyectoNuevo("ge-plantilla");
    fireEvent.click(within(barra()).getByRole("button", { name: "Pilar" }));
    const region = screen.getByRole("region", { name: "Dibujar · Pilar" });
    fireEvent.click(within(region).getByRole("button", { name: "Nueva sección…" }));
    const dlg = screen.getByRole("dialog", { name: "Secciones" });
    fireEvent.click(within(dlg).getByRole("radio", { name: /Circular/ }));
    fireEvent.change(within(dlg).getByRole("textbox", { name: "D de la sección, cm" }), { target: { value: "35" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Crear y usar" }));
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Sección" }) as HTMLSelectElement).value).toBe("C35"));
    expect(within(region).getByText("circ. Ø 35 · HA-30")).toBeTruthy();
    expect(deshacer().getAttribute("title")).toMatch(/Sección C35/);
  }, 60_000);
});

describe("GE: el gestor de materiales", () => {
  it("otro hormigón: el id se propone por su fck y se ve el Ecm", async () => {
    await proyectoNuevo("ge-materiales");
    fireEvent.click(within(barra()).getByRole("button", { name: "Materiales" }));
    const dlg = screen.getByRole("dialog", { name: "Materiales" });
    expect(within(within(dlg).getByRole("navigation", { name: "Lista de materiales" })).getByRole("button", { name: /HA-30/ }).getAttribute("aria-current")).toBe("true");
    // HA-30: el Ecm del Código Estructural, al MPa (32 837), el de hormigon(30)
    expect(dlg.querySelector(".ges-props")!.textContent).toContain(`E${fmt(hormigon(30).E / 1000, 0)} MPa`);
    fireEvent.click(within(dlg).getByRole("button", { name: "Nuevo material" }));
    fireEvent.change(within(dlg).getByRole("textbox", { name: "fck del material, MPa" }), { target: { value: "28" } });
    expect(within(dlg).getByRole("textbox", { name: "id del material" }).getAttribute("placeholder")).toBe("HA-28");
    expect(within(within(dlg).getByRole("group", { name: "Materiales típicos" })).getByRole("button", { name: /HA-30/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(within(dlg).getByRole("button", { name: "Crear" }));
    expect(within(dlg).getByRole("status").textContent).toBe("Creado HA-28.");
    expect(deshacer().getAttribute("title")).toMatch(/Nuevo material HA-28/);
  }, 60_000);
});
