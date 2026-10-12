/**
 * Criterio 1 de V1, en el DOM: el texto de las tablas es el valor de la consulta con su formato.
 * Desde I1, las pantallas de V1 son modos de Resultados (`docs/fem3d/interfaz.md` §13); se montan en jsdom con una sesión de verdad en este proceso (el `Atendedor` del worker,
 * sin worker), y cada celda se compara con el dato que la sesión da para ella.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { Atendedor } from "../../../src/visor/atender.ts";
import type { DatosEstacion, DatosLosas, DatosPilares } from "../../../src/visor/datos.ts";
import type { Pilares3D } from "../../../src/visor/pilares3d.ts";
import type { Reacciones3D } from "../../../src/visor/reacciones3d.ts";
import type { Pedido } from "../../../src/visor/protocolo.ts";
import type { EstadoSesion } from "../../../src/visor/sesion.ts";
import { ContextoPaneles, useAlmacenPaneles } from "../armazon/paneles.ts";
import { ContextoVisor, type ModoResultados } from "../contexto.ts";
import { fmt, mm } from "../fmt.ts";
import { ModoLosas } from "../pantallas/Losas.tsx";
import { lineasTramo, ModoPilares } from "../pantallas/Pilares.tsx";
import { lineasReaccion, ModoReacciones } from "../pantallas/Reacciones.tsx";
import { lineasEstacion } from "../pantallas/Vigas.tsx";
import type { ClienteSesion } from "../sesion/cliente.ts";
import type { ProyectoAbierto } from "../sesion/useProyecto.ts";
import { ThemeProvider } from "../tema/ThemeProvider.tsx";
import { ContextoVistas, useEstadoVistas } from "../vistas/estado.ts";

const RAIZ = join(__dirname, "..", "..", "..");
let at: Atendedor;
let estado: EstadoSesion;

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
  at = new Atendedor(sha256(new Uint8Array(wasm)));
  const a = await at.atender({ tipo: "abrir", texto: readFileSync(join(RAIZ, "validacion", "a2", "agente", "nucleo", "proyecto.json"), "utf8") });
  expect(a.ok).toBe(true);
  const c = await at.atender({ tipo: "calcular" });
  if (!c.ok) throw new Error("no calcula");
  estado = c.valor as EstadoSesion;
}, 120_000);

/** Un cliente que contesta con el atendedor de este proceso. */
const cliente = () =>
  ({
    motor: at.motor,
    huella: estado.huella,
    pedir: async (p: Pedido) => {
      const r = await at.atender(p);
      return r.ok ? { ok: true, valor: r.valor, ms: 0 } : { ok: false, diagnosticos: r.diagnosticos, ms: 0 };
    },
  }) as unknown as ClienteSesion;

function Paneles({ children }: { children: React.ReactNode }) {
  return (
    <ContextoPaneles.Provider value={useAlmacenPaneles()}>
      <ContextoVistas.Provider value={useEstadoVistas("test")}>{children}</ContextoVistas.Provider>
    </ContextoPaneles.Provider>
  );
}

function montar(pantalla: React.ReactNode, planta: string, modo: ModoResultados) {
  const proyecto: ProyectoAbierto = { fase: "listo", estado, cliente: cliente(), fuente: { tipo: "texto", nombre: "nucleo.json" }, desactualizado: false, errores: [], motivoGuardados: null, firmas: "", tiempos: {}, version: 1, abrirOrigen() {}, abrirTexto() {}, recalcular() {} };
  return render(
    <ThemeProvider>
      <Paneles>
        <ContextoVisor.Provider value={{ proyecto, planta, setPlanta() {}, seleccion: null, setSeleccion() {}, elegidos: [], setElegidos() {}, espacio: "resultados", modo, irA() {}, tablaPedida: null, pedirTabla() {} }}>
          <div style={{ display: "flex" }}>{pantalla}</div>
        </ContextoVisor.Provider>
      </Paneles>
    </ThemeProvider>,
  );
}

const seccion = (titulo: string) => screen.getByText(titulo, { selector: "h2 span" }).closest("section")!;

describe("V1 · DOM", () => {
  it("pilares: el cuadro de la planta dice los valores de la consulta", async () => {
    const planta = estado.plantas[0]!.id;
    const r = await at.atender({ tipo: "pilares", planta, combinaciones: { tipo: "defecto" } });
    const d = (r as { valor: DatosPilares }).valor;
    montar(<ModoPilares />, planta, "pilares");
    const cuadro = await waitFor(() => {
      const s = seccion(`Cuadro bajo ${planta}`);
      expect(within(s).getAllByRole("row").length).toBe(d.filas.length + 1);
      return s;
    });
    const filas = within(cuadro).getAllByRole("row").slice(1);
    d.filas.forEach((f, i) => {
      const celdas = within(filas[i]!).getAllByRole("cell");
      expect(celdas[0]!.textContent).toBe(`${f.pilar}${f.tramo.seccion}`);
      // N: la mayor compresión de la base y la cabeza, con su combinación
      const nb = f.tramo.base["N-"]!;
      const nc = f.tramo.cabeza["N-"]!;
      const n = nb.esfuerzos[0]! <= nc.esfuerzos[0]! ? nb : nc;
      expect(celdas[1]!.textContent).toBe(`${fmt(n.esfuerzos[0]!, 0)}${n.comb}`);
      expect(celdas[4]!.textContent).toBe(f.nu ? `${fmt(f.nu.nu, 2)}${f.nu.comb}` : "—");
    });
  }, 60_000);

  it("losas: los extremos y las flechas dicen los valores de la consulta", async () => {
    const planta = estado.plantas[0]!.id;
    const r = await at.atender({ tipo: "losas", planta, campo: "uz", combinaciones: { tipo: "defecto" } });
    const d = (r as { valor: DatosLosas }).valor;
    montar(<ModoLosas />, planta, "losas");
    await waitFor(() => expect(document.querySelectorAll("[data-extremo]").length).toBe(d.escena.extremos.length));
    const ex = [...document.querySelectorAll("[data-extremo]")];
    d.escena.extremos.forEach((e, i) => expect(ex[i]!.textContent).toBe(`${fmt(e.valor, 2)} ${e.unidad}`));
    const fl = within(seccion("Flechas")).getAllByRole("row").slice(1);
    expect(fl.length).toBe(d.flechas.length);
    d.flechas.forEach((f, i) => {
      const celdas = within(fl[i]!).getAllByRole("cell");
      expect(celdas[1]!.textContent).toBe(`${mm(f.maxima.v)}${f.maxima.comb}`);
    });
  }, 60_000);

  it("reacciones (I4): la tabla dice los valores de la consulta, y la sonda de cada flecha también", async () => {
    const planta = estado.plantas[0]!.id;
    const r = await at.atender({ tipo: "reacciones3d", combinaciones: { tipo: "defecto" }, escala: 1 });
    const d = (r as { valor: Reacciones3D }).valor;
    expect(d.objetos.length).toBeGreaterThan(0);
    montar(<ModoReacciones />, planta, "reacciones");
    await waitFor(() => expect(document.querySelectorAll("[data-reaccion]").length).toBe(d.objetos.length));
    const filas = within(seccion("Reacciones por objeto")).getAllByRole("row").slice(1);
    d.objetos.forEach((o, i) => {
      const celdas = within(filas[i]!).getAllByRole("cell");
      expect(celdas[0]!.textContent).toBe(`${o.id}${o.tipo} · ${o.planta}${d.conjunto.n > 1 ? ` · ${o.comb}` : ""}`);
      o.R.forEach((v, k) => expect(celdas[k + 1]!.textContent).toBe(fmt(v, 1)));
      expect(lineasReaccion(o)[1]).toBe(`Fz ${fmt(o.R[2], 1)} kN · Fx ${fmt(o.R[0], 1)} · Fy ${fmt(o.R[1], 1)}`);
    });
    // Sin acciones no hay combinaciones, y el selector dice por qué
    const sin = estado.sinCombinaciones;
    expect(estado.combinaciones.length === 0).toBe(!!sin);
    if (sin) {
      const opcion = within(screen.getByRole("combobox", { name: /Combinaciones · reacciones/ })).getByRole("option", { name: /^Casos sin acción/ }) as HTMLOptionElement;
      expect(opcion.disabled).toBe(true);
      expect(opcion.textContent).toBe(`Casos sin acción: ${sin.sinAccion.join(", ")} (Cargas › Casos)`);
    }
  }, 60_000);

  it("sondas (I4): un tramo de pilar y una estación dicen los valores de su consulta", async () => {
    const r = await at.atender({ tipo: "pilares3d", magnitud: "N", combinaciones: { tipo: "defecto" }, planta: null });
    const d = (r as { valor: Pilares3D }).valor;
    d.tramos.forEach((t, k) => expect(lineasTramo(d, k)![1]).toBe(`N ${fmt(t.valor, 1)} kN · ${t.comb}${t.donde ? ` (en la ${t.donde})` : ""}`));
    const p = d.tramos[0]!.pilar;
    const e = await at.atender({ tipo: "estacion", id: p, esfuerzo: "N", combinaciones: { tipo: "defecto" }, s: 1 });
    const x = (e as { valor: DatosEstacion }).valor;
    const l = lineasEstacion(p, x, "N", "kN");
    expect(l[0]).toBe(`${p} · s = ${fmt(1, 2)} m`);
    if (!x.rigida) expect(l[1]).toBe(`N máx. ${fmt(x.derecha!.max.v, 1)} kN · ${x.derecha!.max.comb}`);
  }, 60_000);
});
