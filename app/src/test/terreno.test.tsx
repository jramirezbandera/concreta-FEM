/**
 * Fase LC2 (`docs/fem3d/losa-cimentacion.md` §9): Resultados · Losas con una losa de cimentación.
 * La magnitud «σ terreno» sólo está con losas de cimentación; con ella, el panel «Terreno» dice los
 * números de `fem consultar terreno` (los del pedido `losas`), y los extremos, los del mapa.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { VERSION_ESQUEMA } from "../../../src/agente/proyecto.ts";
import { Atendedor } from "../../../src/visor/atender.ts";
import type { DatosLosas } from "../../../src/visor/datos.ts";
import type { Pedido } from "../../../src/visor/protocolo.ts";
import type { EstadoSesion } from "../../../src/visor/sesion.ts";
import { ContextoPaneles, useAlmacenPaneles } from "../armazon/paneles.ts";
import { ContextoVisor } from "../contexto.ts";
import { fmt } from "../fmt.ts";
import { ModoLosas } from "../pantallas/Losas.tsx";
import type { ClienteSesion } from "../sesion/cliente.ts";
import type { ProyectoAbierto } from "../sesion/useProyecto.ts";
import { ThemeProvider } from "../tema/ThemeProvider.tsx";
import { ContextoVistas, useEstadoVistas } from "../vistas/estado.ts";

const RAIZ = join(__dirname, "..", "..", "..");

class SinTamano {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const rect = (a: number, b: number) => [
  [0, 0],
  [a, 0],
  [a, b],
  [0, b],
];
/** Cuatro pilares sobre una losa de cimentación, con un forjado encima. */
const MODELO = {
  plantas: [
    { id: "N1", altura: null },
    { id: "C", altura: 3 },
  ],
  materiales: [{ id: "H", tipo: "hormigon", fck: 30 }],
  secciones: [{ id: "p30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 }],
  losas: [
    { id: "LN", planta: "N1", contorno: rect(10, 6), espesor: 0.25, material: "H" },
    { id: "LC", planta: "C", contorno: rect(10, 6), espesor: 0.6, material: "H", cimentacion: { balasto: 40000, tensionAdmisible: 150 } },
  ],
  pilares: [
    [2, 1.5],
    [8, 1.5],
    [2, 4.5],
    [8, 4.5],
  ].map(([x, y], i) => ({ id: `P${i + 1}`, x, y, desde: "C", hasta: "N1", seccion: "p30" })),
  casos: [
    { id: "G", pesoPropio: true, accion: { tipo: "G" } },
    { id: "Q", accion: { tipo: "Q", psi: "uso-A" } },
  ],
  cargas: [{ tipo: "superficie", id: "QN", caso: "Q", planta: "N1", losa: "LN", q: [0, 0, -3] }],
};

let at: Atendedor;
let estado: EstadoSesion;

beforeAll(async () => {
  globalThis.ResizeObserver ??= SinTamano as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  const wasm = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
  await iniciarNucleo(wasm);
  at = new Atendedor(sha256(new Uint8Array(wasm)));
  const a = await at.atender({ tipo: "abrir", texto: JSON.stringify({ esquema: VERSION_ESQUEMA, modelo: MODELO }) });
  expect(a.ok).toBe(true);
  const c = await at.atender({ tipo: "calcular" });
  if (!c.ok) throw new Error("no calcula");
  estado = c.valor as EstadoSesion;
}, 120_000);

const cliente = (pedidos?: Pedido[]) =>
  ({
    motor: at.motor,
    huella: estado.huella,
    pedir: async (p: Pedido) => {
      pedidos?.push(p);
      const r = await at.atender(p);
      return r.ok ? { ok: true, valor: r.valor, ms: 0 } : { ok: false, diagnosticos: r.diagnosticos, ms: 0 };
    },
  }) as unknown as ClienteSesion;

function Paneles({ children }: { children: React.ReactNode }) {
  return (
    <ContextoPaneles.Provider value={useAlmacenPaneles()}>
      <ContextoVistas.Provider value={useEstadoVistas("test-terreno")}>{children}</ContextoVistas.Provider>
    </ContextoPaneles.Provider>
  );
}

function montar(planta: string, est: EstadoSesion, pedidos?: Pedido[]) {
  const proyecto: ProyectoAbierto = { fase: "listo", estado: est, cliente: cliente(pedidos), fuente: { tipo: "texto", nombre: "lc2.json" }, desactualizado: false, errores: [], motivoGuardados: null, tiempos: {}, version: 1, abrirOrigen() {}, abrirTexto() {}, recalcular() {} };
  return render(
    <ThemeProvider>
      <Paneles>
        <ContextoVisor.Provider value={{ proyecto, planta, setPlanta() {}, seleccion: null, setSeleccion() {}, elegidos: [], setElegidos() {}, espacio: "resultados", modo: "losas", irA() {}, tablaPedida: null, pedirTabla() {} }}>
          <div style={{ display: "flex" }}>{pantalla()}</div>
        </ContextoVisor.Provider>
      </Paneles>
    </ThemeProvider>,
  );
}
const pantalla = () => <ModoLosas />;

describe("LC2 · Resultados · Losas con una losa de cimentación", () => {
  it("«σ terreno» sólo con losas de cimentación, y su panel dice lo de la consulta", async () => {
    expect(estado.cimentacion).toEqual([{ losa: "LC", planta: "C" }]);
    const pedidos: Pedido[] = [];
    const { unmount } = montar("C", estado, pedidos);
    fireEvent.click(await screen.findByRole("button", { name: "σ terreno" }));
    // Por defecto, la ELS característica (las reacciones) y la envolvente de la compresión
    await waitFor(() => expect(pedidos.some((p) => p.tipo === "losas" && p.campo === "sigma" && p.envolvente === "max")).toBe(true));
    const r = await at.atender({ tipo: "losas", planta: "C", campo: "sigma", combinaciones: { tipo: "defecto" }, envolvente: "max" });
    const d = (r as { valor: DatosLosas }).valor;
    expect(d.combinaciones.descripcion).toMatch(/ELS/);
    const t = d.terreno![0]!;
    const caja = await waitFor(() => {
      const x = document.querySelector('[data-terreno="LC"]');
      expect(x).not.toBeNull();
      return x as HTMLElement;
    });
    expect(within(caja).getByText((_, el) => el?.getAttribute("data-sigma-max") !== null && el?.tagName === "TD").textContent).toBe(`${fmt(t.sigmaMax.v, 1)} kN/m²${t.sigmaMax.comb}`);
    expect(within(caja).getByText("No despega en ninguna combinación.")).toBeTruthy();
    const ex = [...document.querySelectorAll("[data-extremo]")];
    expect(ex.length).toBe(d.escena.extremos.length);
    expect(Number(ex[0]!.getAttribute("data-extremo"))).toBe(t.sigmaMax.v);
    unmount();
    // Sin losas de cimentación, la magnitud no está
    montar("C", { ...estado, cimentacion: [] });
    await screen.findByRole("button", { name: "uz" });
    expect(screen.queryByRole("button", { name: "σ terreno" })).toBeNull();
  }, 60_000);
});
