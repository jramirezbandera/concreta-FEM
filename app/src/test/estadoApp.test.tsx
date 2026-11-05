/**
 * La app deja lo que se mira en `.fem/app.json` para el agente (`docs/fem3d/agente.md` §13.2): con
 * el proyecto en el servidor local (`?proyecto=`, un `fetch` simulado que hace de `app/servidor.ts`),
 * al abrir y al elegir algo (por la paleta), tras su pausa y sólo si cambió algo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { leerEstadoApp, type EstadoApp } from "../../../src/agente/estadoApp.ts";
import { leerProyecto, type Proyecto } from "../../../src/agente/proyecto.ts";
import { olvidarBD } from "../sesion/almacen.ts";
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
const P = (leerProyecto(EJEMPLO) as { proyecto: Proyecto }).proyecto;
const global = globalThis as unknown as { __motor: string };

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
  global.__motor = sha256(new Uint8Array(wasm));
}, 120_000);

/** Lo que llega por PUT a `.fem/app.json`. */
let escritos: EstadoApp[] = [];
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  olvidarBD();
  escritos = [];
  history.replaceState(null, "", "/?proyecto=%2Fproyecto%2Fproyecto.json");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, o) => {
    const u = String(url);
    const metodo = o?.method ?? "GET";
    if (u.endsWith("/proyecto/.fem/app.json") && metodo === "PUT") {
      const e = leerEstadoApp(String(o!.body));
      if (!e) return new Response("{}", { status: 422 });
      escritos.push(e);
      return new Response("{}", { status: 200 });
    }
    if (u.endsWith("/proyecto/proyecto.json")) return new Response(metodo === "HEAD" ? null : EJEMPLO, { status: 200, headers: { etag: '"1"' } });
    return new Response(null, { status: 204, headers: { "x-existe": "no" } });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("lo que se mira en la app, para el agente", () => {
  it("al abrir, y al elegir un pilar por la paleta; nada si no cambia", async () => {
    const { container } = render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
    await waitFor(() => expect(container.querySelector("[data-huella]")).toBeTruthy(), { timeout: 30_000 });
    await waitFor(() => expect(escritos.some((e) => e.huella)).toBe(true), { timeout: 5_000 });
    const primero = escritos[escritos.length - 1]!;
    expect(primero).toMatchObject({ proyecto: "proyecto.json", espacio: "modelo", elegidos: [], sinGuardar: false });
    expect(P.modelo.plantas.some((x) => x.id === primero.planta)).toBe(true);
    const id = P.modelo.pilares![0]!.id;
    fireEvent.click(screen.getByRole("button", { name: "Buscar u ordenar (Ctrl+K)" }));
    const q = screen.getByRole("combobox", { name: "Buscar una orden" });
    fireEvent.change(q, { target: { value: id } });
    fireEvent.keyDown(q, { key: "Enter" });
    await waitFor(() => expect(escritos[escritos.length - 1]!.elegidos).toEqual([id]), { timeout: 5_000 });
    const n = escritos.length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800));
    });
    expect(escritos.length).toBe(n);
  }, 120_000);
});
