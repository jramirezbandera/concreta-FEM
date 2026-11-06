/**
 * VS4 · DOM: Resultados · Modal con un proyecto con el sismo del programa: la tabla de modos tiene
 * los de la consulta, la forma del modo elegido se pide al worker y los cortantes de planta son los
 * de `fem consultar sismo`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioObjetivoLosas } from "../../../validacion/c2/modelos.ts";
import { VERSION_ESQUEMA } from "../../../src/agente/proyecto.ts";
import type { AccionCaso, ModeloFisico } from "../../../src/compilador/fisico.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { Atendedor } from "../../../src/visor/atender.ts";
import type { DatosModal, DatosSismo } from "../../../src/visor/programa.ts";
import type { Pedido } from "../../../src/visor/protocolo.ts";
import type { EstadoSesion } from "../../../src/visor/sesion.ts";
import { ContextoPaneles, useAlmacenPaneles } from "../armazon/paneles.ts";
import { ContextoVisor } from "../contexto.ts";
import { fmt } from "../fmt.ts";
import { ModoModal } from "../pantallas/Modal.tsx";
import type { ClienteSesion } from "../sesion/cliente.ts";
import type { ProyectoAbierto } from "../sesion/useProyecto.ts";
import { ThemeProvider } from "../tema/ThemeProvider.tsx";
import { ContextoVistas, useEstadoVistas } from "../vistas/estado.ts";

const RAIZ = join(import.meta.dirname, "..", "..", "..");
const ACCIONES: Record<string, AccionCaso> = {
  G: { tipo: "G" },
  Q: { tipo: "Q", psi: "uso-A" },
  Vx: { tipo: "W", psi: "viento", direccion: "X", signo: 1, familia: "viento" },
  Vy: { tipo: "W", psi: "viento", direccion: "Y", signo: 1, familia: "viento" },
};
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
  const f = edificioObjetivoLosas(2, 3, 2);
  const modelo: ModeloFisico = { ...f, casos: f.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })), acciones: { viento: { zona: "A", aspereza: "IV" }, sismo: { ab: 0.16, K: 1.0, terreno: "III", mu: 2 } } };
  const a = await at.atender({ tipo: "abrir", texto: JSON.stringify({ esquema: VERSION_ESQUEMA, modelo }) });
  expect(a.ok).toBe(true);
  const c = await at.atender({ tipo: "calcular" });
  if (!c.ok) throw new Error("no calcula");
  estado = c.valor as EstadoSesion;
}, 120_000);

const cliente = (pedidos: Pedido[]) =>
  ({
    motor: at.motor,
    huella: estado.huella,
    pedir: async (p: Pedido) => {
      pedidos.push(p);
      const r = await at.atender(p);
      return r.ok ? { ok: true, valor: r.valor, ms: 0 } : { ok: false, diagnosticos: r.diagnosticos, ms: 0 };
    },
  }) as unknown as ClienteSesion;

function Paneles({ children }: { children: React.ReactNode }) {
  return (
    <ContextoPaneles.Provider value={useAlmacenPaneles()}>
      <ContextoVistas.Provider value={useEstadoVistas("test-modal")}>{children}</ContextoVistas.Provider>
    </ContextoPaneles.Provider>
  );
}

function montar(pedidos: Pedido[]) {
  const proyecto: ProyectoAbierto = { fase: "listo", estado, cliente: cliente(pedidos), fuente: { tipo: "texto", nombre: "sismo.json" }, desactualizado: false, errores: [], motivoGuardados: null, tiempos: {}, version: 1, abrirOrigen() {}, abrirTexto() {}, recalcular() {} };
  return render(
    <ThemeProvider>
      <Paneles>
        <ContextoVisor.Provider value={{ proyecto, planta: estado.plantas[0]!.id, setPlanta() {}, seleccion: null, setSeleccion() {}, elegidos: [], setElegidos() {}, espacio: "resultados", modo: "modal", irA() {}, tablaPedida: null, pedirTabla() {} }}>
          <div style={{ display: "flex" }}>
            <ModoModal />
          </div>
        </ContextoVisor.Provider>
      </Paneles>
    </ThemeProvider>,
  );
}

describe("VS4 · DOM: Resultados · Modal", () => {
  it("el estado lista los casos del programa; la tabla de modos y la de cortantes son las de las consultas, y elegir un modo pide su forma", async () => {
    expect(estado.casos.filter((c) => c.programa === "viento").length).toBe(8);
    expect(estado.casos.filter((c) => c.programa === "sismo").map((c) => c.id)).toEqual(["EX+e", "EX-e", "EY+e", "EY-e"]);
    const md = ((await at.atender({ tipo: "modal" })) as { valor: DatosModal }).valor.modal!;
    const sd = ((await at.atender({ tipo: "sismo" })) as { valor: DatosSismo }).valor.resultado!;
    const pedidos: Pedido[] = [];
    montar(pedidos);
    const tabla = await waitFor(() => {
      const s = screen.getByText("Modos de vibración", { selector: "h2 span" }).closest("section")!;
      expect(within(s).getAllByRole("row").length).toBe(md.numeroDeModos + 1);
      return s;
    });
    const filas = within(tabla).getAllByRole("row").slice(1);
    md.modos.forEach((m, i) => {
      const celdas = within(filas[i]!).getAllByRole("cell").map((c) => c.textContent);
      expect(celdas[1]).toBe(fmt(m.T, 3));
      expect(celdas[3]).toBe(`${fmt(100 * m.masaEfectiva[0], 1)} %`);
      // con espectro, el cortante en la base de cada modo
      expect(celdas[8]).toBe(fmt(sd.direcciones[0]!.modos.find((x) => x.modo === m.modo)!.cortanteBasal, 1));
    });
    // el modo 1 se pidió al entrar; un clic en el modo 2 pide el 2
    await waitFor(() => expect(pedidos.some((p) => p.tipo === "modo" && p.modo === 1)).toBe(true));
    fireEvent.click(filas[1]!);
    await waitFor(() => expect(pedidos.some((p) => p.tipo === "modo" && p.modo === 2)).toBe(true));
    // los cortantes de planta
    fireEvent.click(screen.getByRole("tab", { name: /Cortantes de planta/ }));
    const cortantes = await waitFor(() => screen.getByText("Cortantes de planta", { selector: "h2 span" }).closest("section")!);
    const fc = within(cortantes).getAllByRole("row").slice(1);
    expect(fc.length).toBe(sd.direcciones[0]!.plantas.length);
    sd.direcciones[0]!.plantas.forEach((p, i) => {
      const celdas = within(fc[i]!).getAllByRole("cell").map((c) => c.textContent);
      expect(celdas[3]).toBe(fmt(p.cortante, 1));
      expect(celdas[8]).toBe(fmt(sd.direcciones[1]!.plantas[i]!.cortante, 1));
    });
    // el cortante en la base combinado, en Propiedades
    expect(screen.getByText(new RegExp(`${fmt(sd.direcciones[0]!.cortanteBasal, 1).replace(".", "\\.")} kN`))).toBeTruthy();
  });
});
