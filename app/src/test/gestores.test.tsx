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

/** Una obra nueva abre el gestor de plantas; con `abierto`, se queda abierto. */
async function proyectoNuevo(nombre: string, abierto = false) {
  render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Proyecto nuevo/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Nombre del proyecto" }), { target: { value: nombre } });
  fireEvent.click(screen.getByRole("button", { name: "Crear" }));
  await waitFor(() => expect(screen.getByRole("grid", { name: /Tabla de/ })).toBeTruthy(), { timeout: 30_000 });
  if (!abierto) fireEvent.click(within(screen.getByRole("dialog", { name: "Plantas" })).getByRole("button", { name: "Cerrar" }));
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

    // La sección de la fila nueva se creó con la fila: un paso de deshacer quita las dos
    expect(deshacer().getAttribute("title")).toMatch(/Nueva fila en pilares/);
    fireEvent.click(deshacer());
    expect(idsTabla("pilares")).toEqual([]);
    elegirTabla("secciones");
    expect(idsTabla("secciones")).toEqual([]);
  }, 60_000);

  it("en la fila nueva, la sección creada espera a la fila: sin fila, no hay sección", async () => {
    await proyectoNuevo("ge-borrador");
    elegirTabla("pilares");
    elegirEnCelda("pilares", -1, "seccion", NUEVA);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Secciones" })).getByRole("button", { name: "Crear y usar" }));
    expect(screen.getByText(/P30x30 se crea con ella/)).toBeTruthy();
    expect(deshacer().hasAttribute("disabled")).toBe(true);
    elegirTabla("secciones");
    expect(idsTabla("secciones")).toEqual([]);
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

/** Abre una orden de la paleta (Ctrl+K) por su nombre. */
function orden(nombre: string) {
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  fireEvent.change(screen.getByRole("combobox", { name: "Buscar una orden" }), { target: { value: nombre } });
  fireEvent.click(screen.getAllByRole("option", { name: (n) => n.includes(nombre) })[0]!);
}

describe("GE2: casos de carga", () => {
  it("las hipótesis típicas de una vez: reutiliza G y Q, crea el viento, y es un paso de deshacer", async () => {
    await proyectoNuevo("ge2-juego");
    orden("Hipótesis típicas");
    const dlg = screen.getByRole("dialog", { name: "Casos de carga" });
    expect(within(dlg).getByLabelText("Lo que se va a hacer").textContent).toBe("Se crean W+X, W-X, W+Y, W-Y. Ya están: G, Q.");
    // Los típicos que ya están lo dicen
    expect(within(within(dlg).getByRole("group", { name: "Casos típicos: uso" })).getByRole("button", { name: /^Q.*ya está: Q/ })).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Crear las hipótesis" }));
    expect(within(dlg).getByRole("status").textContent).toBe("Creados W+X, W-X, W+Y, W-Y; ya estaban G, Q.");
    expect(deshacer().getAttribute("title")).toMatch(/Hipótesis típicas: W\+X, W-X, W\+Y, W-Y/);
    // La ficha de un caso es su formulario
    fireEvent.click(within(within(dlg).getByRole("navigation", { name: "Lista de casos" })).getByRole("button", { name: /^W-Y/ }));
    expect((within(dlg).getByRole("combobox", { name: "dirección" }) as HTMLSelectElement).value).toBe("Y");
    expect((within(dlg).getByRole("combobox", { name: "signo" }) as HTMLSelectElement).value).toBe("-1");
    // La ayuda de la derecha: la acción con sus ψ (los del generador) y, con el foco en un campo, qué es y la opción del caso
    const ayuda = within(dlg).getByLabelText("Ayuda del caso");
    expect(ayuda.textContent).toMatch(/Viento.*ψ0\s*0,6.*ψ1\s*0,5.*ψ2\s*0/);
    expect(within(ayuda).queryByRole("note")).toBeNull();
    fireEvent.focus(within(dlg).getByRole("combobox", { name: "signo" }));
    const nota = within(ayuda).getByRole("note", { name: "Ayuda de signo" });
    expect([...nota.querySelectorAll('li[data-on="true"]')].map((li) => li.textContent)).toEqual(["-1hacia −X o −Y"]);
    fireEvent.blur(within(dlg).getByRole("combobox", { name: "signo" }));
    expect(within(ayuda).queryByRole("note")).toBeNull();
    // Esc cierra con el foco fuera (GE1-1)
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Casos de carga" })).toBeNull();
    elegirTabla("casos");
    expect(idsTabla("casos")).toEqual(["G", "Q", "W+X", "W-X", "W+Y", "W-Y"]);
    fireEvent.click(deshacer());
    expect(idsTabla("casos")).toEqual(["G", "Q"]);
  }, 60_000);

  it("en la fila nueva de Cargas: «Nuevo caso…» y un típico; se crea con la carga", async () => {
    await proyectoNuevo("ge2-hoja");
    elegirTabla("cargas");
    const caso = DEF_TABLAS.cargas.columnas.find((c) => c.clave === "caso")!;
    expect(caso.referencia).toBe("casos");
    elegirEnCelda("cargas", -1, "caso", NUEVA);
    const dlg = screen.getByRole("dialog", { name: "Casos de carga" });
    expect(within(dlg).getByText("Para caso de la fila nueva")).toBeTruthy();
    // Desde un campo no se ofrece el juego: sólo un caso
    expect(within(dlg).queryByRole("button", { name: "Crear las hipótesis" })).toBeNull();
    fireEvent.click(within(within(dlg).getByRole("group", { name: "Casos típicos: sismo" })).getByRole("button", { name: /^EX/ }));
    expect(screen.queryByRole("dialog", { name: "Casos de carga" })).toBeNull();
    expect(screen.getByText(/EX se crea con ella/)).toBeTruthy();
    elegirTabla("casos");
    expect(idsTabla("casos")).toEqual(["G", "Q"]);
  }, 60_000);
});

describe("GE3: plantas", () => {
  it("una obra nueva empieza por sus plantas: cuántas y de qué altura, viendo el alzado; un paso de deshacer", async () => {
    await proyectoNuevo("ge3-inicio", true);
    const dlg = screen.getByRole("dialog", { name: "Plantas" });
    expect(within(dlg).getByText("Empiece por las plantas.")).toBeTruthy();
    // La ayuda de cada campo, en un globo al pasar por su «?» (no un texto debajo)
    const q = within(dlg).getByRole("textbox", { name: "Altura de la primera planta, m" }).closest("label")!.querySelector(".campo-q")!;
    fireEvent.mouseEnter(q);
    expect((await screen.findByRole("tooltip")).textContent).toMatch(/cara superior del primer forjado/);
    fireEvent.mouseLeave(q);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.change(within(dlg).getByRole("textbox", { name: "Número de plantas sobre la cimentación" }), { target: { value: "4" } });
    fireEvent.change(within(dlg).getByRole("textbox", { name: "Altura de la primera planta, m" }), { target: { value: "4" } });
    fireEvent.change(within(dlg).getByRole("textbox", { name: "Altura de las demás plantas, m" }), { target: { value: "3" } });
    const filas = () => [...within(dlg).getByRole("table", { name: "Cómo quedan las plantas" }).querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
    expect(filas()).toEqual([
      ["N4 · nueva", "", "—", "+13,00"],
      ["N3 · nueva", "", "3,00", "+10,00"],
      ["N2 · nueva", "", "3,00", "+7,00"],
      ["N1", "", "3,00", "+4,00"],
      ["Cim", "", "4,00", "0,00"],
    ]);
    fireEvent.click(within(dlg).getByRole("button", { name: "Crear las plantas" }));
    expect(within(dlg).getByRole("status").textContent).toBe("4 plantas sobre Cim.");
    // Ya no es el primer paso: se añaden encima o debajo de una
    expect(within(dlg).getByRole("textbox", { name: "Número de plantas nuevas" })).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Cerrar" }));
    elegirTabla("plantas");
    expect(idsTabla("plantas")).toEqual(["N4", "N3", "N2", "N1", "Cim"]);
    fireEvent.click(deshacer());
    expect(idsTabla("plantas")).toEqual(["N1", "Cim"]);
  }, 60_000);

  it("dos plantas de 3,20 m encima de N1, viendo antes las cotas; un paso de deshacer", async () => {
    await proyectoNuevo("ge3-barra");
    fireEvent.click(within(barra()).getByRole("button", { name: "Plantas" }));
    const dlg = screen.getByRole("dialog", { name: "Plantas" });
    fireEvent.change(within(dlg).getByRole("textbox", { name: "Número de plantas nuevas" }), { target: { value: "2" } });
    fireEvent.change(within(dlg).getByRole("textbox", { name: "Altura de las plantas nuevas, m" }), { target: { value: "3,2" } });
    expect((within(dlg).getByRole("combobox", { name: "Planta de referencia" }) as HTMLSelectElement).value).toBe("N1");
    const filas = () => [...within(dlg).getByRole("table", { name: "Cómo quedan las plantas" }).querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
    expect(filas()).toEqual([
      ["N3 · nueva", "", "—", "+9,40"],
      ["N2 · nueva", "", "3,20", "+6,20"],
      ["N1", "", "3,20", "+3,00"],
      ["Cim", "", "3,00", "0,00"],
    ]);
    fireEvent.click(within(dlg).getByRole("button", { name: "Añadir" }));
    expect(within(dlg).getByRole("status").textContent).toBe("Plantas N2, N3 encima de N1.");
    expect(deshacer().getAttribute("title")).toMatch(/Plantas N2, N3 encima de N1/);
    fireEvent.click(within(dlg).getByRole("button", { name: "Cerrar" }));
    elegirTabla("plantas");
    expect(idsTabla("plantas")).toEqual(["N3", "N2", "N1", "Cim"]);
    fireEvent.click(deshacer());
    expect(idsTabla("plantas")).toEqual(["N1", "Cim"]);
  }, 60_000);

  it("desde «hasta» de un pilar en la hoja: la planta nueva queda elegida, y va con la fila", async () => {
    await proyectoNuevo("ge3-hoja");
    elegirTabla("pilares");
    elegirEnCelda("pilares", -1, "hasta", NUEVA);
    const dlg = screen.getByRole("dialog", { name: "Plantas" });
    expect(within(dlg).getByText("Para hasta de la fila nueva")).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Añadir y usar" }));
    expect(screen.queryByRole("dialog", { name: "Plantas" })).toBeNull();
    expect(screen.getByText(/N2 se crea con ella/)).toBeTruthy();
    elegirTabla("plantas");
    expect(idsTabla("plantas")).toEqual(["N1", "Cim"]);
  }, 60_000);
});
