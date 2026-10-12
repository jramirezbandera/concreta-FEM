/**
 * Editor (V2a, `docs/fem3d/visor.md` §6.3), con la sesión de verdad en este proceso (el `Atendedor`
 * del worker en lugar del worker) y un origen en memoria:
 * - criterio 4: nunca se pierde ni se pisa nada en silencio (cambio en el disco con cambios sin
 *   guardar, guardado que falla, resultados desactualizados con el primer cambio, respuesta tardía
 *   de una versión anterior);
 * - criterio 3: un modelo pequeño metido escribiendo en las tablas (y pegando) da la huella del
 *   mismo modelo escrito a mano; en V2b (`visor.md` §7.3), también un muro con un hueco y su empuje y
 *   un paño unidireccional con su carga.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { huellaCompilacion } from "../../../src/compilador/compilar.ts";
import { resolverOpciones } from "../../../src/compilador/fisico.ts";
import type { Proyecto } from "../../../src/agente/proyecto.ts";
import { proyectoNuevo } from "../../../src/editor/plantilla.ts";
import { serializar } from "../../../src/editor/serializar.ts";
import { DEF_TABLAS, type NombreTabla } from "../../../src/editor/tablas.ts";
import type { Escritura, Origen } from "../sesion/origen.ts";
import { useProyecto } from "../sesion/useProyecto.ts";
import { App } from "../App.tsx";
import { ThemeProvider } from "../tema/ThemeProvider.tsx";

// El worker de sesión, en este proceso: un Atendedor por cliente (como un worker por versión)
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
      // Como un worker: contesta después, no en la misma vuelta
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
const EJEMPLO = readFileSync(join(RAIZ, ".claude", "skills", "fem", "ejemplo.json"), "utf8");
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
}, 120_000);

/** Un proyecto.json en memoria, con su sello, que se puede cambiar «desde fuera» y hacer fallar al escribir. */
function origenMemoria(texto: string) {
  let t = texto;
  let n = 1;
  const o = {
    descripcion: "memoria / proyecto.json",
    fichero: "proyecto.json",
    fallar: null as string | null,
    escrituras: 0,
    get texto() {
      return t;
    },
    async leer(nombre: string) {
      return nombre === "proyecto.json" ? { texto: t, sello: String(n) } : null;
    },
    async sello(nombre: string) {
      return nombre === "proyecto.json" ? String(n) : null;
    },
    async guardados() {
      return null;
    },
    async escribir(x: string, op: { sello: string | null; forzar?: boolean }): Promise<Escritura> {
      if (o.fallar) return { ok: false, conflicto: false, mensaje: o.fallar };
      if (!op.forzar && op.sello !== String(n)) return { ok: false, conflicto: true, mensaje: "proyecto.json cambió en el disco desde que se leyó." };
      t = x;
      n++;
      o.escrituras++;
      return { ok: true, sello: String(n) };
    },
    cambiarFuera(x: string) {
      t = x;
      n++;
    },
  };
  return o satisfies Origen;
}

const cambiarX = (p: Proyecto, x: number) => {
  const a = p.modelo.pilares![0]!;
  return { op: "cambiar" as const, coleccion: "pilares" as const, id: a.id, objeto: { ...a, x } };
};

describe("useProyecto con el editor (criterio 4)", () => {
  async function abierto(texto = EJEMPLO) {
    const o = origenMemoria(texto);
    const h = renderHook(() => useProyecto());
    act(() => h.result.current.abrirOrigen(o));
    await waitFor(() => expect(h.result.current.estado?.calculado).toBe(true), { timeout: 30_000 });
    return { o, h };
  }

  it("el primer cambio marca los resultados como desactualizados antes de nada; luego compila sin calcular", async () => {
    const { h } = await abierto();
    const antes = h.result.current.estado!.huella;
    const p = h.result.current.edicion!.proyecto;
    act(() => {
      expect(h.result.current.edicion!.editar(cambiarX(p, 0.5), "x").ok).toBe(true);
    });
    expect(h.result.current.desactualizado).toBe(true);
    expect(h.result.current.edicion!.sinGuardar).toBe(true);
    await waitFor(() => expect(h.result.current.desactualizado).toBe(false), { timeout: 10_000 });
    const e = h.result.current.estado!;
    expect(e.huella).not.toBe(antes);
    expect(e.huella).toBe(huella(h.result.current.edicion!.proyecto));
    expect(e.calculado).toBe(false);
    act(() => h.result.current.calcular!());
    await waitFor(() => expect(h.result.current.estado?.calculado).toBe(true), { timeout: 30_000 });
    expect(h.result.current.estado!.huella).toBe(e.huella);
  });

  it("la respuesta tardía de un cálculo anterior se descarta: queda la versión editada, sin calcular", async () => {
    const { h } = await abierto();
    act(() => h.result.current.recalcular());
    const p = h.result.current.edicion!.proyecto;
    act(() => {
      h.result.current.edicion!.editar(cambiarX(p, 0.75), "x");
    });
    await waitFor(() => expect(h.result.current.desactualizado).toBe(false), { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(h.result.current.estado!.huella).toBe(huella(h.result.current.edicion!.proyecto));
    expect(h.result.current.estado!.calculado).toBe(false);
  });

  it("si el fichero cambia en el disco con cambios sin guardar, no se recarga ni se sobrescribe: avisa", async () => {
    const { o, h } = await abierto();
    const p = h.result.current.edicion!.proyecto;
    act(() => {
      h.result.current.edicion!.editar(cambiarX(p, 1.25), "x");
    });
    const fuera = EJEMPLO.replace("Ejemplo: pórtico", "Cambiado fuera: pórtico");
    o.cambiarFuera(fuera);
    await waitFor(() => expect(h.result.current.edicion!.conflicto).not.toBeNull(), { timeout: 5_000 });
    expect(h.result.current.edicion!.proyecto.modelo.pilares![0]!.x).toBe(1.25);
    // Guardar no lo pisa: sigue el conflicto y el disco no cambia
    await act(() => h.result.current.edicion!.guardar());
    expect(o.texto).toBe(fuera);
    expect(h.result.current.edicion!.conflicto).not.toBeNull();
    // Sobrescribir, después de avisar
    await act(() => h.result.current.edicion!.guardar({ forzar: true }));
    expect(o.texto).toBe(serializar(h.result.current.edicion!.proyecto));
    expect(h.result.current.edicion!.conflicto).toBeNull();
    expect(h.result.current.edicion!.sinGuardar).toBe(false);
  });

  it("recargar del disco descarta lo de aquí y abre lo de fuera", async () => {
    const { o, h } = await abierto();
    const p = h.result.current.edicion!.proyecto;
    act(() => {
      h.result.current.edicion!.editar(cambiarX(p, 2), "x");
    });
    o.cambiarFuera(EJEMPLO.replace("Ejemplo: pórtico", "Fuera"));
    await waitFor(() => expect(h.result.current.edicion!.conflicto).not.toBeNull(), { timeout: 5_000 });
    act(() => h.result.current.edicion!.recargarDisco());
    await waitFor(() => expect(h.result.current.edicion!.proyecto.nombre?.startsWith("Fuera")).toBe(true), { timeout: 10_000 });
    expect(h.result.current.edicion!.sinGuardar).toBe(false);
    expect(h.result.current.edicion!.conflicto).toBeNull();
  });

  it("un guardado que falla lo dice y conserva los cambios", async () => {
    const { o, h } = await abierto();
    const p = h.result.current.edicion!.proyecto;
    act(() => {
      h.result.current.edicion!.editar(cambiarX(p, 3), "x");
    });
    o.fallar = "disco lleno";
    await act(() => h.result.current.edicion!.guardar());
    expect(h.result.current.edicion!.guardado).toEqual({ tipo: "error", mensaje: "disco lleno" });
    expect(h.result.current.edicion!.sinGuardar).toBe(true);
    expect(h.result.current.edicion!.proyecto.modelo.pilares![0]!.x).toBe(3);
    o.fallar = null;
    await act(() => h.result.current.edicion!.guardar());
    expect(h.result.current.edicion!.sinGuardar).toBe(false);
    expect(o.texto).toBe(serializar(h.result.current.edicion!.proyecto));
  });

  it("guardar y volver a abrir da la misma huella; un cambio fuera sin cambios aquí se recarga solo", async () => {
    const { o, h } = await abierto();
    const p = h.result.current.edicion!.proyecto;
    act(() => {
      h.result.current.edicion!.editar(cambiarX(p, 0.1), "x");
    });
    await act(() => h.result.current.edicion!.guardar());
    const guardada = h.result.current.edicion!.proyecto;
    // Lo propio no cuenta como cambio de fuera
    await new Promise((r) => setTimeout(r, 1500));
    expect(h.result.current.edicion!.proyecto).toBe(guardada);
    o.cambiarFuera(EJEMPLO);
    await waitFor(() => expect(h.result.current.edicion!.proyecto.modelo.pilares![0]!.x).toBe(0), { timeout: 10_000 });
    expect(h.result.current.edicion!.deshacerEtiqueta).toBeNull();
  });

  it("deshacer vuelve al proyecto del disco: ya no hay cambios sin guardar", async () => {
    const { h } = await abierto();
    const p = h.result.current.edicion!.proyecto;
    act(() => {
      h.result.current.edicion!.editar(cambiarX(p, 4), "x");
    });
    expect(h.result.current.edicion!.sinGuardar).toBe(true);
    act(() => h.result.current.edicion!.deshacer());
    expect(h.result.current.edicion!.proyecto).toBe(p);
    expect(h.result.current.edicion!.sinGuardar).toBe(false);
  });
});

// ─── DOM: meter un modelo escribiendo en las tablas ─────────────────────────────────────────────

function hoja(tabla: NombreTabla) {
  return screen.getByRole("grid", { name: `Tabla de ${DEF_TABLAS[tabla].titulo.toLowerCase()}` });
}

function elegirTabla(tabla: NombreTabla) {
  // El título y su número («Apoyos 3», no «Apoyos lineales 1»)
  fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${DEF_TABLAS[tabla].titulo}\\s*\\d`) }));
}

/**
 * Escribe en la fila nueva de una tabla, celda a celda, como el ingeniero: doble clic, escribir, Intro;
 * en una columna con opciones, doble clic y elegir en el desplegable.
 */
function escribirFilaNueva(tabla: NombreTabla, valores: Record<string, string>) {
  const g = hoja(tabla);
  for (const [clave, v] of Object.entries(valores)) {
    const filas = g.querySelectorAll("tbody tr");
    const nueva = filas[filas.length - 1]!;
    const j = DEF_TABLAS[tabla].columnas.findIndex((c) => c.clave === clave);
    const td = nueva.querySelectorAll("td")[j + 1]!;
    fireEvent.mouseDown(td);
    fireEvent.doubleClick(td);
    const lista = within(td as HTMLElement).queryByRole("combobox");
    if (DEF_TABLAS[tabla].columnas[j]!.opciones) {
      expect(lista, `${tabla}.${clave}: sin desplegable`).toBeTruthy();
      expect([...(lista as HTMLSelectElement).options].map((o) => o.value), `${tabla}.${clave}`).toContain(v);
      fireEvent.change(lista!, { target: { value: v } });
      continue;
    }
    const input = within(td as HTMLElement).getByRole("textbox");
    fireEvent.change(input, { target: { value: v } });
    fireEvent.keyDown(input, { key: "Enter" });
  }
}

describe("meter un modelo en las tablas (criterio 3)", () => {
  it("un pórtico con losa, tecleado y pegado, da la huella del mismo modelo escrito a mano", async () => {
    const { container } = render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Proyecto nuevo/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre del fichero" }), { target: { value: "portico" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));
    await waitFor(() => expect(screen.getByRole("grid", { name: /Tabla de/ })).toBeTruthy(), { timeout: 30_000 });
    // I1: la paleta de órdenes (Ctrl+K) lleva a las tablas
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByRole("combobox", { name: "Buscar una orden" }), { target: { value: "tabla secc" } });
    expect(screen.getAllByRole("option", { name: /Secciones/ }).length).toBe(1);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Buscar una orden" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Paleta de órdenes" })).toBeNull();

    elegirTabla("secciones");
    escribirFilaNueva("secciones", { id: "P30", material: "HA-30", forma: "rectangular", b: "0,3", h: "0,3" });
    escribirFilaNueva("secciones", { id: "V30x50", material: "HA-30", forma: "rectangular", b: "0,3", h: "0,5" });

    elegirTabla("pilares");
    fireEvent.click(screen.getByRole("checkbox", { name: /sólo/ }));
    escribirFilaNueva("pilares", { x: "0", y: "0", desde: "Cim", hasta: "N1", seccion: "P30" });
    // Los otros tres, pegados de una hoja de cálculo en la fila nueva, desde la columna x
    const g = hoja("pilares");
    const filas = g.querySelectorAll("tbody tr");
    const jx = DEF_TABLAS.pilares.columnas.findIndex((c) => c.clave === "x");
    fireEvent.mouseDown(filas[filas.length - 1]!.querySelectorAll("td")[jx + 1]!);
    fireEvent.paste(g, { clipboardData: { getData: () => "6\t0\tCim\tN1\tP30\n0\t5\tCim\tN1\tP30\n6\t5\tCim\tN1\tP30\n" } });

    elegirTabla("vigas");
    escribirFilaNueva("vigas", { planta: "N1", puntos: "0 0; 6 0", seccion: "V30x50" });
    escribirFilaNueva("vigas", { planta: "N1", puntos: "0 5; 6 5", seccion: "V30x50" });
    elegirTabla("losas");
    escribirFilaNueva("losas", { planta: "N1", contorno: "0 0; 6 0; 6 5; 0 5", espesor: "0,2", material: "HA-30" });
    elegirTabla("cargas");
    escribirFilaNueva("cargas", { tipo: "superficie", caso: "Q", planta: "N1", sobre: "L1", q: "0 0 -2" });

    const esperado: Proyecto = proyectoNuevo("portico");
    const sec = (id: string, h: number) => ({ id, material: "HA-30", forma: "rectangular" as const, b: 0.3, h });
    const pil = (id: string, x: number, y: number) => ({ id, x, y, desde: "Cim", hasta: "N1", seccion: "P30" });
    esperado.modelo = {
      ...esperado.modelo,
      secciones: [sec("P30", 0.3), sec("V30x50", 0.5)],
      pilares: [pil("P1", 0, 0), pil("P2", 6, 0), pil("P3", 0, 5), pil("P4", 6, 5)],
      vigas: [
        { id: "V1", planta: "N1", puntos: [[0, 0], [6, 0]], seccion: "V30x50" },
        { id: "V2", planta: "N1", puntos: [[0, 5], [6, 5]], seccion: "V30x50" },
      ],
      losas: [{ id: "L1", planta: "N1", contorno: [[0, 0], [6, 0], [6, 5], [0, 5]], espesor: 0.2, material: "HA-30" }],
      cargas: [{ tipo: "superficie", id: "Q1", caso: "Q", planta: "N1", q: [0, 0, -2], losa: "L1" }],
    };
    const h = huella(esperado);
    await waitFor(() => expect(container.querySelector("[data-huella]")?.getAttribute("data-huella")).toBe(h), { timeout: 30_000 });
    // Y compila: el estado no es «no compila»
    expect(container.querySelector("[data-estado]")?.getAttribute("data-estado")).toBe("sin-calcular");
    // I1, criterio 3: sin cálculo de esta huella no se entra en Resultados ni en Revisión
    expect(screen.getByRole("button", { name: "Resultados" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Revisión" }).hasAttribute("disabled")).toBe(true);
    // Guardar está activo (hay cambios sin guardar)
    expect(screen.getByRole("button", { name: /Descargar/ }).getAttribute("data-sin-guardar")).toBe("true");
  }, 120_000);

  it("V2b: un paño con su carga y un muro con un hueco y su empuje, tecleados, dan la huella del mismo modelo escrito a mano", async () => {
    const { container } = render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Proyecto nuevo/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre del fichero" }), { target: { value: "muro" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));
    await waitFor(() => expect(screen.getByRole("grid", { name: /Tabla de/ })).toBeTruthy(), { timeout: 30_000 });

    elegirTabla("secciones");
    escribirFilaNueva("secciones", { id: "P30", material: "HA-30", forma: "rectangular", b: "0,3", h: "0,3" });
    escribirFilaNueva("secciones", { id: "V30x50", material: "HA-30", forma: "rectangular", b: "0,3", h: "0,5" });
    escribirFilaNueva("secciones", { id: "T25", material: "HA-30", forma: "T", bf: "0,7", hf: "0,05", bw: "0,12", h: "0,3" });
    elegirTabla("pilares");
    fireEvent.click(screen.getByRole("checkbox", { name: /sólo/ }));
    const g = hoja("pilares");
    const jx = DEF_TABLAS.pilares.columnas.findIndex((c) => c.clave === "x");
    fireEvent.mouseDown(g.querySelectorAll("tbody tr")[0]!.querySelectorAll("td")[jx + 1]!);
    fireEvent.paste(g, { clipboardData: { getData: () => "0\t0\tCim\tN1\tP30\n6\t0\tCim\tN1\tP30\n0\t5\tCim\tN1\tP30\n6\t5\tCim\tN1\tP30\n" } });
    elegirTabla("vigas");
    escribirFilaNueva("vigas", { planta: "N1", puntos: "0 0; 6 0", seccion: "V30x50" });
    escribirFilaNueva("vigas", { planta: "N1", puntos: "0 5; 6 5", seccion: "V30x50" });
    elegirTabla("panos");
    escribirFilaNueva("panos", { planta: "N1", contorno: "0 0; 6 0; 6 5; 0 5", direccion: "90", intereje: "0,7", seccion: "T25", pp: "3,5" });
    elegirTabla("muros");
    fireEvent.click(screen.getByRole("checkbox", { name: /sólo/ }));
    // Los huecos antes que el material: con él, el muro tiene lo que necesita y se crea
    escribirFilaNueva("muros", { puntos: "10 0; 10 5", huecos: "1 2 0,5 1,5", desde: "Cim", hasta: "N1", espesor: "0,25", material: "HA-30" });
    elegirTabla("cargas");
    fireEvent.click(screen.getByRole("checkbox", { name: /sólo/ }));
    escribirFilaNueva("cargas", { tipo: "superficie", caso: "Q", planta: "N1", sobre: "F1", q: "0 0 -2" });
    escribirFilaNueva("cargas", { tipo: "empuje", caso: "G", sobre: "M1", lado: "derecho", z0: "0", z1: "1,5", p0: "15", p1: "0" });

    const esperado: Proyecto = proyectoNuevo("muro");
    const sec = (id: string, h: number) => ({ id, material: "HA-30", forma: "rectangular" as const, b: 0.3, h });
    const pil = (id: string, x: number, y: number) => ({ id, x, y, desde: "Cim", hasta: "N1", seccion: "P30" });
    esperado.modelo = {
      ...esperado.modelo,
      secciones: [sec("P30", 0.3), sec("V30x50", 0.5), { id: "T25", material: "HA-30", forma: "T", bf: 0.7, hf: 0.05, bw: 0.12, h: 0.3 }],
      pilares: [pil("P1", 0, 0), pil("P2", 6, 0), pil("P3", 0, 5), pil("P4", 6, 5)],
      vigas: [
        { id: "V1", planta: "N1", puntos: [[0, 0], [6, 0]], seccion: "V30x50" },
        { id: "V2", planta: "N1", puntos: [[0, 5], [6, 5]], seccion: "V30x50" },
      ],
      panos: [{ id: "F1", planta: "N1", contorno: [[0, 0], [6, 0], [6, 5], [0, 5]], direccion: 90, intereje: 0.7, seccion: "T25", pp: 3.5 }],
      muros: [{ id: "M1", puntos: [[10, 0], [10, 5]], desde: "Cim", hasta: "N1", espesor: 0.25, material: "HA-30", huecos: [{ desde: 1, hasta: 2, z0: 0.5, z1: 1.5 }] }],
      cargas: [
        { tipo: "superficie", id: "Q1", caso: "Q", planta: "N1", q: [0, 0, -2], pano: "F1" },
        { tipo: "empuje", id: "Q2", caso: "G", muro: "M1", lado: "derecho", z0: 0, z1: 1.5, p0: 15, p1: 0 },
      ],
    };
    const h = huella(esperado);
    await waitFor(() => expect(container.querySelector("[data-huella]")?.getAttribute("data-huella")).toBe(h), { timeout: 30_000 });
    expect(container.querySelector("[data-estado]")?.getAttribute("data-estado")).toBe("sin-calcular");
  }, 120_000);
});
