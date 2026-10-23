/**
 * Los proyectos del navegador en la app (fase AL, `docs/fem3d/almacen-local.md` §5), con la sesión de
 * verdad en este proceso (como `editor.test.tsx`) y `fake-indexeddb`:
 * - criterio 1: un cambio se guarda solo, y cerrar y volver a abrir da el proyecto tal cual;
 * - criterio 2: exportar da el texto canónico, e importar no cambia la huella;
 * - criterio 3: lo que guarda otra pestaña se recarga si aquí no hay nada por guardar; si lo hay,
 *   conflicto, sin pisar nada;
 * - criterio 4: reabrir un proyecto calculado usa la caché con el mismo sha256, y se recalcula si
 *   cambia el núcleo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { huellaCompilacion } from "../../../src/compilador/compilar.ts";
import { resolverOpciones } from "../../../src/compilador/fisico.ts";
import { leerProyecto, type Proyecto } from "../../../src/agente/proyecto.ts";
import { serializar } from "../../../src/editor/serializar.ts";
import { crear, escribir, ficha, leer, leerResultados, listar, olvidarBD, origenNavegador, versiones } from "../sesion/almacen.ts";
import { useProyecto } from "../sesion/useProyecto.ts";
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
const EJEMPLO = readFileSync(join(RAIZ, ".claude", "skills", "fem", "ejemplo.json"), "utf8");
const CANONICO = (() => {
  const l = leerProyecto(EJEMPLO);
  if (!l.valido) throw new Error("el ejemplo de la skill no es válido");
  return serializar(l.proyecto);
})();
const huella = (p: Proyecto) => huellaCompilacion(p.modelo, resolverOpciones(p.opciones));
const global = globalThis as unknown as { __motor: string };
let motor = "";

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
  motor = global.__motor = sha256(new Uint8Array(wasm));
}, 120_000);

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  olvidarBD();
  global.__motor = motor;
  history.replaceState(null, "", "/");
});

/** Lo que se descarga (exportar): el texto de cada Blob. */
let descargas: Blob[] = [];
beforeEach(() => {
  descargas = [];
  URL.createObjectURL = ((b: Blob) => {
    descargas.push(b);
    return "blob:prueba";
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = () => {};
});
afterEach(() => {
  vi.restoreAllMocks();
});

const cambiarX = (p: Proyecto, x: number) => {
  const a = p.modelo.pilares![0]!;
  return { op: "cambiar" as const, coleccion: "pilares" as const, id: a.id, objeto: { ...a, x } };
};

async function abierto(id: string) {
  const f = (await ficha(id))!;
  const h = renderHook(() => useProyecto());
  act(() => h.result.current.abrirOrigen(origenNavegador(f.id, f.nombre)));
  await waitFor(() => expect(h.result.current.estado?.calculado).toBe(true), { timeout: 30_000 });
  return h;
}

describe("criterios 1 y 4: se guarda solo, y reabrir usa lo calculado", () => {
  it("un cambio se guarda sin pulsar nada; al reabrir, el proyecto tal cual y sus resultados de la caché", async () => {
    const f = await crear(CANONICO);
    const h = await abierto(f.id);
    expect(h.result.current.estado!.origen).toBe("calculo");
    expect(h.result.current.edicion!.modo).toBe("auto");
    const sha = h.result.current.estado!.sha256Resultados;
    // Lo calculado, a la caché (sin bloquear nada)
    await waitFor(async () => expect(await leerResultados(h.result.current.estado!.huella)).not.toBeNull(), { timeout: 10_000 });
    // La versión de lo que había al abrir
    expect((await versiones(f.id)).length).toBe(1);
    // Un cambio: se guarda solo
    const p = h.result.current.edicion!.proyecto;
    act(() => {
      expect(h.result.current.edicion!.editar(cambiarX(p, 0.5), "x").ok).toBe(true);
    });
    expect(h.result.current.edicion!.sinGuardar).toBe(true);
    await waitFor(() => expect(h.result.current.edicion!.sinGuardar).toBe(false), { timeout: 5_000 });
    const editado = serializar(h.result.current.edicion!.proyecto);
    expect((await leer(f.id))!.texto).toBe(editado);
    expect(h.result.current.edicion!.conflicto).toBeNull();
    // Se calcula la versión editada, y se cierra la pestaña
    act(() => h.result.current.calcular!());
    await waitFor(() => expect(h.result.current.estado?.calculado).toBe(true), { timeout: 30_000 });
    const sha2 = h.result.current.estado!.sha256Resultados;
    const huella2 = h.result.current.estado!.huella;
    expect(sha2).not.toBe(sha);
    await waitFor(async () => expect(await leerResultados(huella2)).not.toBeNull(), { timeout: 10_000 });
    h.unmount();

    // Volver: el mismo texto y los resultados de la caché, bit a bit
    const h2 = await abierto(f.id);
    expect(serializar(h2.result.current.edicion!.proyecto)).toBe(editado);
    expect(h2.result.current.estado!.huella).toBe(huella2);
    expect(h2.result.current.estado!.origen).toBe("guardados");
    expect(h2.result.current.estado!.sha256Resultados).toBe(sha2);
    h2.unmount();

    // Con otro núcleo, la caché no vale: se recalcula y se dice por qué
    global.__motor = "otro-nucleo";
    const h3 = await abierto(f.id);
    expect(h3.result.current.estado!.origen).toBe("calculo");
    expect(h3.result.current.motivoGuardados).toMatch(/otro núcleo/);
    h3.unmount();
  }, 120_000);
});

describe("criterio 3: dos pestañas", () => {
  it("lo que guarda la otra se recarga aquí; con un cambio por guardar, conflicto y nada pisado", async () => {
    const f = await crear(CANONICO);
    const a = await abierto(f.id);
    const b = await abierto(f.id);
    // B cambia: se guarda solo, y A (sin nada por guardar) lo recarga
    const pb = b.result.current.edicion!.proyecto;
    act(() => {
      b.result.current.edicion!.editar(cambiarX(pb, 0.75), "x");
    });
    await waitFor(() => expect(a.result.current.edicion!.proyecto.modelo.pilares![0]!.x).toBe(0.75), { timeout: 5_000 });
    await waitFor(() => expect(a.result.current.desactualizado).toBe(false), { timeout: 30_000 });
    // A cambia y, antes de que se guarde, la otra pestaña escribe: conflicto
    const pa = a.result.current.edicion!.proyecto;
    act(() => {
      a.result.current.edicion!.editar(cambiarX(pa, 1.5), "x");
    });
    const otra = CANONICO.replace(/"nombre": "[^"]*"/, '"nombre": "Cambiado en otra pestaña"');
    const s = (await ficha(f.id))!.sello;
    expect(await escribir(f.id, otra, { sello: s })).toMatchObject({ ok: true });
    await waitFor(() => expect(a.result.current.edicion!.conflicto).not.toBeNull(), { timeout: 5_000 });
    expect(a.result.current.edicion!.conflicto).toMatch(/otra pestaña/);
    expect((await leer(f.id))!.texto).toBe(otra);
    expect(a.result.current.edicion!.proyecto.modelo.pilares![0]!.x).toBe(1.5);
    a.unmount();
    b.unmount();
  }, 120_000);
});

describe("criterio 2 y la pantalla de inicio", () => {
  it("importar guarda el texto canónico con la misma huella; exportar lo descarga byte a byte", async () => {
    const { container } = render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
    const archivo = new File([EJEMPLO], "portico.json", { type: "application/json" });
    fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [archivo] } });
    await waitFor(() => expect(container.querySelector("[data-huella]")).toBeTruthy(), { timeout: 30_000 });
    const l = leerProyecto(EJEMPLO);
    if (!l.valido) throw new Error("no válido");
    expect(container.querySelector("[data-huella]")!.getAttribute("data-huella")).toBe(huella(l.proyecto));
    const [f] = await listar();
    expect((await leer(f!.id))!.texto).toBe(CANONICO);
    expect(location.search).toBe(`?local=${f!.id}`);
    expect(screen.getByRole("status", { name: "Estado del guardado" }).textContent).toMatch(/Guardado/);
    fireEvent.click(screen.getByRole("button", { name: "Exportar el proyecto.json" }));
    expect(descargas.length).toBe(1);
    expect(await descargas[0]!.text()).toBe(CANONICO);
  }, 120_000);

  it("un ejemplo se abre sin guardar; «Guardar en mis proyectos» lo pasa al navegador y sigue en la pestaña", async () => {
    const { container } = render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /ejemplo de la skill/ }));
    await waitFor(() => expect(container.querySelector("[data-huella]")).toBeTruthy(), { timeout: 30_000 });
    expect(await listar()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Guardar en mis proyectos/ }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Estado del guardado" }).textContent).toMatch(/Guardado/), { timeout: 5_000 });
    const [f] = await listar();
    expect((await leer(f!.id))!.texto).toBe(CANONICO);
    expect(location.search).toBe(`?local=${f!.id}`);
  }, 120_000);

  it("la lista de mis proyectos: abrir, duplicar y borrar con confirmación", async () => {
    const a = await crear(CANONICO);
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
    const nombre = (await ficha(a.id))!.nombre;
    await waitFor(() => expect(screen.getByRole("button", { name: nombre })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: `Duplicar ${nombre}` }));
    await waitFor(() => expect(screen.getByRole("button", { name: `${nombre} (copia)` })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: `Borrar ${nombre} (copia)` }));
    expect(screen.getByText(/No se puede deshacer/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Borrar" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: `${nombre} (copia)` })).toBeNull());
    expect((await listar()).map((x) => x.id)).toEqual([a.id]);
  }, 120_000);
});
