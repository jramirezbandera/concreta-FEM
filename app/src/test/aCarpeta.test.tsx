/**
 * «Pasar a una carpeta» (`docs/fem3d/agente.md` §13): un proyecto del navegador pasa a una carpeta
 * del disco con su `proyecto.json` canónico, sus plantillas DXF y lo calculado en `.fem/<huella>/`
 * (con los bytes de la caché, como los deja la CLI), y desde entonces se guarda ahí. Nunca pisa un
 * proyecto que ya esté en la carpeta. La carpeta es una File System Access API en memoria.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { leerProyecto, type Proyecto } from "../../../src/agente/proyecto.ts";
import { serializar } from "../../../src/editor/serializar.ts";
import { crear, ficha, guardarDxf, leerResultados, olvidarBD, origenNavegador } from "../sesion/almacen.ts";
import { useProyecto } from "../sesion/useProyecto.ts";

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

// ─── Una carpeta en memoria ─────────────────────────────────────────────────────────────────────

type Arbol = Map<string, Uint8Array | Arbol>;
let reloj = 1;
/** La fecha de cada fichero, la de su última escritura (como en un disco). */
const fechas = new WeakMap<Uint8Array, number>();

function carpeta(nombre: string, arbol: Arbol = new Map()) {
  const dir = {
    kind: "directory" as const,
    name: nombre,
    arbol,
    queryPermission: async () => "granted" as PermissionState,
    requestPermission: async () => "granted" as PermissionState,
    async getDirectoryHandle(n: string, o?: { create?: boolean }) {
      let x = arbol.get(n);
      if (!x && o?.create) arbol.set(n, (x = new Map()));
      if (!(x instanceof Map)) throw new DOMException("no está", "NotFoundError");
      return carpeta(n, x);
    },
    async getFileHandle(n: string, o?: { create?: boolean }) {
      if (!arbol.has(n)) {
        if (!o?.create) throw new DOMException("no está", "NotFoundError");
        arbol.set(n, new Uint8Array());
      }
      return {
        kind: "file" as const,
        name: n,
        async getFile() {
          const b = arbol.get(n) as Uint8Array;
          if (!fechas.has(b)) fechas.set(b, reloj++);
          return { size: b.length, lastModified: fechas.get(b)!, text: async () => new TextDecoder().decode(b), arrayBuffer: async () => b.slice().buffer };
        },
        async createWritable() {
          let datos: Uint8Array = new Uint8Array();
          return {
            write: async (d: string | Uint8Array) => void (datos = typeof d === "string" ? new TextEncoder().encode(d) : d),
            close: async () => {
              fechas.set(datos, reloj++);
              arbol.set(n, datos);
            },
            abort: async () => {},
          };
        },
      };
    },
    async *values() {
      for (const [n, v] of arbol) yield { kind: v instanceof Map ? ("directory" as const) : ("file" as const), name: n };
    },
  };
  return dir;
}

const texto = (a: Arbol, ...ruta: string[]): string | null => {
  let x: Uint8Array | Arbol | undefined = a;
  for (const r of ruta) x = x instanceof Map ? x.get(r) : undefined;
  return x && !(x instanceof Map) && ArrayBuffer.isView(x) ? new TextDecoder().decode(x) : null;
};

// ─── La sesión ──────────────────────────────────────────────────────────────────────────────────

const RAIZ = join(__dirname, "..", "..", "..");
const EJEMPLO = (() => {
  const l = leerProyecto(readFileSync(join(RAIZ, ".claude", "skills", "fem", "ejemplo.json"), "utf8"));
  if (!l.valido) throw new Error("el ejemplo de la skill no es válido");
  return l.proyecto;
})();
const DXF = new TextEncoder().encode("0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nA\n10\n0\n20\n0\n11\n1\n21\n1\n0\nENDSEC\n0\nEOF\n");
const SHA_DXF = sha256(DXF);
const CON_PLANTILLA: Proyecto = { ...EJEMPLO, nombre: "Nave Málaga", plantillas: [{ nombre: "Planta", fichero: "planta.dxf", sha256: SHA_DXF, unidades: "m", plantas: [EJEMPLO.modelo.plantas[0]!.id] }] };
const global = globalThis as unknown as { __motor: string };
let motor = "";

beforeAll(async () => {
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
afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

async function abiertoEnNavegador() {
  const f = await crear(serializar(CON_PLANTILLA));
  await guardarDxf(SHA_DXF, DXF);
  const h = renderHook(() => useProyecto());
  act(() => h.result.current.abrirOrigen(origenNavegador(f.id, f.nombre)));
  await waitFor(() => expect(h.result.current.estado?.calculado).toBe(true), { timeout: 30_000 });
  await waitFor(async () => expect(await leerResultados(h.result.current.estado!.huella)).not.toBeNull(), { timeout: 10_000 });
  return { h, id: f.id };
}

describe("Pasar a una carpeta", () => {
  it("escribe el proyecto, su plantilla y lo calculado, y desde ahí se guarda en la carpeta", async () => {
    const { h, id } = await abiertoEnNavegador();
    expect(h.result.current.edicion!.aCarpeta).toBeUndefined(); // sin carpetas en este navegador
    const dir = carpeta("Obra");
    window.showDirectoryPicker = (async () => dir) as never;
    h.rerender();
    await waitFor(() => expect(h.result.current.edicion!.aCarpeta).toBeDefined());
    const huella = h.result.current.estado!.huella;
    let r: Awaited<ReturnType<NonNullable<NonNullable<typeof h.result.current.edicion>["aCarpeta"]>>> = null;
    await act(async () => {
      r = await h.result.current.edicion!.aCarpeta!();
    });
    expect(r).toEqual({ ok: true, carpeta: "Obra", fichero: "proyecto.json", plantillas: 1, resultados: true, faltan: [] });
    expect(texto(dir.arbol, "proyecto.json")).toBe(serializar(CON_PLANTILLA));
    expect(texto(dir.arbol, "planta.dxf")).toBe(new TextDecoder().decode(DXF));
    // Lo de la caché, byte a byte, como lo deja la CLI (con el núcleo y el sha256 en la cabecera)
    const cache = (await leerResultados(huella))!;
    expect(texto(dir.arbol, ".fem", huella, "resultados.json")).toBe(cache.cabecera);
    expect((dir.arbol.get(".fem") as Arbol).get(huella) instanceof Map).toBe(true);
    expect(JSON.parse(cache.cabecera)).toMatchObject({ huella, motor });
    // La fuente es ya la carpeta: guardar escribe ahí, y el navegador se queda como estaba
    const e = h.result.current.edicion!;
    expect(e.modo).toBe("escribir");
    expect(h.result.current.fuente?.tipo === "origen" && h.result.current.fuente.origen.descripcion).toBe("carpeta Obra / proyecto.json");
    const p = e.proyecto;
    const a = p.modelo.pilares![0]!;
    act(() => void e.editar({ op: "cambiar", coleccion: "pilares", id: a.id, objeto: { ...a, x: a.x + 0.25 } }, "x"));
    await act(async () => {
      await h.result.current.edicion!.guardar();
    });
    expect(texto(dir.arbol, "proyecto.json")).toBe(serializar(h.result.current.edicion!.proyecto));
    expect((await ficha(id))!.sello).toBeGreaterThan(0);
    h.unmount();
  }, 60_000);

  it("no pisa un proyecto que ya está en la carpeta: usa el nombre del proyecto, y si también está, no escribe", async () => {
    const { h } = await abiertoEnNavegador();
    const ocupada = carpeta("Obra", new Map([["proyecto.json", new TextEncoder().encode("{}")]]));
    window.showDirectoryPicker = (async () => ocupada) as never;
    h.rerender();
    await waitFor(() => expect(h.result.current.edicion!.aCarpeta).toBeDefined());
    let r: unknown = null;
    await act(async () => {
      r = await h.result.current.edicion!.aCarpeta!();
    });
    expect(r).toMatchObject({ ok: true, fichero: "Nave Málaga.json" });
    expect(texto(ocupada.arbol, "proyecto.json")).toBe("{}");
    h.unmount();

    const { h: h2 } = await abiertoEnNavegador();
    const llena = carpeta("Obra", new Map([["proyecto.json", new TextEncoder().encode("{}")], ["Nave Málaga.json", new TextEncoder().encode("[]")]]));
    window.showDirectoryPicker = (async () => llena) as never;
    h2.rerender();
    await waitFor(() => expect(h2.result.current.edicion!.aCarpeta).toBeDefined());
    await act(async () => {
      r = await h2.result.current.edicion!.aCarpeta!();
    });
    expect(r).toMatchObject({ ok: false });
    expect(texto(llena.arbol, "proyecto.json")).toBe("{}");
    expect(texto(llena.arbol, "Nave Málaga.json")).toBe("[]");
    expect(h2.result.current.edicion!.modo).toBe("auto");
    h2.unmount();
  }, 90_000);
});
