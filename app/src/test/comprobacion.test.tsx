/**
 * CO6 · DOM (`docs/fem3d/comprobaciones.md` §8.10): Resultados · Comprobación. La tabla es la del
 * pedido `comprobaciones` del worker (lo de comprobar del agente); «Proponer» pide `armar` y escribe
 * el armado en el proyecto con la operación `armado`; un clic abre la ficha con las filas del módulo;
 * y cambiar el armado en la ficha vuelve a comprobar esa pieza, sin recalcular.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioObjetivoLosas } from "../../../validacion/c2/modelos.ts";
import { VERSION_ESQUEMA, type Proyecto } from "../../../src/agente/proyecto.ts";
import type { AccionCaso, ModeloFisico } from "../../../src/compilador/fisico.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { aplicar, type Operacion } from "../../../src/editor/operaciones.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { Atendedor } from "../../../src/visor/atender.ts";
import type { DatosComprobaciones, FichaComprobacion } from "../../../src/visor/comprobaciones.ts";
import type { Pedido } from "../../../src/visor/protocolo.ts";
import type { EstadoSesion } from "../../../src/visor/sesion.ts";
import { ContextoPaneles, useAlmacenPaneles } from "../armazon/paneles.ts";
import { ContextoVisor } from "../contexto.ts";
import { fmt } from "../fmt.ts";
import { ModoComprobacion } from "../pantallas/Comprobacion.tsx";
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
let inicial: Proyecto;

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
  const f = edificioObjetivoLosas(2, 2, 2);
  const modelo: ModeloFisico = { ...f, casos: f.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })) };
  inicial = { esquema: VERSION_ESQUEMA, modelo };
  const a = await at.atender({ tipo: "abrir", texto: JSON.stringify(inicial) });
  expect(a.ok).toBe(true);
  const c = await at.atender({ tipo: "calcular" });
  if (!c.ok) throw new Error("no calcula");
  estado = c.valor as EstadoSesion;
}, 120_000);

const pedir = async <T,>(p: Pedido): Promise<T> => {
  const r = await at.atender(p);
  if (!r.ok) throw new Error("pedido");
  return r.valor as T;
};

function Paneles({ children }: { children: React.ReactNode }) {
  return (
    <ContextoPaneles.Provider value={useAlmacenPaneles()}>
      <ContextoVistas.Provider value={useEstadoVistas("test-comprobacion")}>{children}</ContextoVistas.Provider>
    </ContextoPaneles.Provider>
  );
}

interface Registro {
  pedidos: Pedido[];
  ediciones: { op: Operacion; etiqueta: string }[];
  elegidos: string[][];
  proyecto: Proyecto;
}

/** La pantalla con un proyecto que se edita de verdad (la operación `armado` del editor). */
function Montada({ reg }: { reg: Registro }) {
  const [p, setP] = useState(reg.proyecto);
  const [elegidos, setEl] = useState<string[]>([]);
  const [cliente] = useState(
    () =>
      ({
        motor: at.motor,
        huella: estado.huella,
        pedir: async (x: Pedido) => {
          reg.pedidos.push(x);
          const r = await at.atender(x);
          return r.ok ? { ok: true, valor: r.valor, ms: 0 } : { ok: false, diagnosticos: r.diagnosticos, ms: 0 };
        },
      }) as unknown as ClienteSesion,
  );
  const edicion = {
    proyecto: p,
    editar: (op: Operacion, etiqueta: string) => {
      reg.ediciones.push({ op, etiqueta });
      const r = aplicar(p, op);
      if (r.ok) {
        reg.proyecto = r.proyecto;
        setP(r.proyecto);
      }
      return r;
    },
  };
  const proyecto = { fase: "listo", estado, cliente, fuente: { tipo: "texto", nombre: "obra.json" }, desactualizado: false, errores: [], motivoGuardados: null, tiempos: {}, version: 1, abrirOrigen() {}, abrirTexto() {}, recalcular() {}, edicion } as unknown as ProyectoAbierto;
  return (
    <ContextoVisor.Provider
      value={{
        proyecto,
        planta: estado.plantas[0]!.id,
        setPlanta() {},
        seleccion: null,
        setSeleccion() {},
        elegidos,
        setElegidos: (ids) => {
          reg.elegidos.push(ids);
          setEl(ids);
        },
        espacio: "resultados",
        modo: "comprobacion",
        irA() {},
        tablaPedida: null,
        pedirTabla() {},
      }}
    >
      <div style={{ display: "flex" }}>
        <ModoComprobacion />
      </div>
    </ContextoVisor.Provider>
  );
}

function montar(): Registro {
  const reg: Registro = { pedidos: [], ediciones: [], elegidos: [], proyecto: inicial };
  render(
    <ThemeProvider>
      <Paneles>
        <Montada reg={reg} />
      </Paneles>
    </ThemeProvider>,
  );
  return reg;
}

const filasTabla = () => within(document.querySelector("[data-tabla-comprobacion]")!).getAllByRole("row").slice(1);
const celdas = (tr: HTMLElement) => within(tr).getAllByRole("cell").map((c) => c.textContent);

describe("CO6 · DOM: Resultados · Comprobación", () => {
  it("sin armado nada cumple; «Todo» propone y escribe el armado, y la tabla es la del worker con él", async () => {
    const reg = montar();
    const sin = await pedir<DatosComprobaciones>({ tipo: "comprobaciones", de: "pilares" });
    await waitFor(() => expect(filasTabla().length).toBe(sin.partes.length));
    expect(filasTabla().every((tr) => celdas(tr).at(-1) === "Sin armado")).toBe(true);
    expect(document.querySelector("[data-resumen-comprobacion]")!.textContent).toContain(`0 de ${sin.partes.length} tramos cumplen`);

    fireEvent.click(screen.getByRole("button", { name: "Todo" }));
    await waitFor(() => expect(reg.ediciones.length).toBe(1), { timeout: 60_000 });
    expect(reg.pedidos.some((p) => p.tipo === "armar" && p.tipos.join() === "pilares" && !p.soloSinArmado)).toBe(true);
    expect(reg.ediciones[0]!.op.op).toBe("armado");
    const armado = reg.proyecto.armado!;
    expect(Object.keys(armado.pilares ?? {}).length).toBeGreaterThan(0);
    expect(armado.vigas).toBeUndefined();
    // La tabla, la del worker con el armado del proyecto
    const con = await pedir<DatosComprobaciones>({ tipo: "comprobaciones", de: "pilares", armado: { pilares: armado.pilares! } });
    await waitFor(() => expect(celdas(filasTabla()[0]!)[3]).toBe(con.partes[0]!.texto));
    filasTabla().forEach((tr, i) => {
      const c = celdas(tr);
      const p = con.partes[i]!;
      expect(c[0]).toBe(p.pieza);
      expect(c[3]).toBe(p.texto);
      expect(c[4]).toBe(p.aprovechamiento === null ? "—" : fmt(p.aprovechamiento, 2));
      expect(c.at(-1)).toBe(p.cumple ? "Cumple" : "No cumple");
    });
    expect(con.partes.every((p) => p.cumple)).toBe(true);
    expect(document.querySelector("[data-propuesta]")!.textContent).toContain(`${con.partes.length} de ${con.partes.length} con propuesta`);

    // CO6-b: con armado ya escrito, «Todo» pregunta; «Cancelar» no toca nada y «Sustituir» propone
    fireEvent.click(screen.getByRole("button", { name: "Todo" }));
    const aviso = await waitFor(() => document.querySelector("[data-sustituir]")!);
    expect(aviso.textContent).toContain(`${con.partes.length} de ${con.partes.length} tramos ya tienen armado`);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(document.querySelector("[data-sustituir]")).toBeNull();
    expect(reg.ediciones.length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Todo" }));
    await waitFor(() => document.querySelector("[data-sustituir]")!);
    fireEvent.click(screen.getByRole("button", { name: "Sustituir" }));
    await waitFor(() => expect(reg.ediciones.length).toBe(2), { timeout: 60_000 });
    expect(reg.pedidos.filter((p) => p.tipo === "armar" && !p.soloSinArmado).length).toBe(2);
    // «Sólo lo que falta» desde la pregunta: con todo armado, no cambia nada
    fireEvent.click(screen.getByRole("button", { name: "Todo" }));
    await waitFor(() => document.querySelector("[data-sustituir]")!);
    fireEvent.click(screen.getByRole("button", { name: "Sólo lo que falta" }));
    await waitFor(() => expect(reg.ediciones.length).toBe(3), { timeout: 60_000 });
    expect(reg.proyecto.armado!.pilares).toEqual(armado.pilares);
    expect(document.querySelector("[data-propuesta]")!.textContent).toContain(`0 de ${con.partes.length} con propuesta, ${con.partes.length} con el suyo`);
  }, 120_000);

  it("un clic abre la ficha con las filas del módulo y elige la pieza; cambiar el armado vuelve a comprobar sólo esa pieza; «Quitar» lo deja sin armado", async () => {
    const reg = montar();
    await waitFor(() => expect(filasTabla().length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Lo que falta" }));
    await waitFor(() => expect(reg.ediciones.length).toBe(1), { timeout: 60_000 });
    const armado = () => ({ pilares: reg.proyecto.armado!.pilares! });
    await waitFor(() => expect(celdas(filasTabla()[0]!).at(-1)).toBe("Cumple"));
    const fila = filasTabla()[0]!;
    const pieza = celdas(fila)[0]!;
    fireEvent.click(fila);
    expect(reg.elegidos.at(-1)).toEqual([pieza]);
    const tabla = await pedir<DatosComprobaciones>({ tipo: "comprobaciones", de: "pilares", armado: armado() });
    const ficha = await pedir<FichaComprobacion>({ tipo: "comprobacion", de: "pilares", clave: tabla.partes[0]!.clave, armado: armado() });
    await waitFor(() => expect(within(document.querySelector("[data-filas-modulo]")!).getAllByRole("row").length).toBe(ficha.filas.length + 1));
    expect(document.querySelector("[data-estado-ficha]")!.textContent).toBe("Cumple");
    // Los cercos, a 400 mm: deja de cumplir
    const sep = screen.getByLabelText("Cercos: cada (mm)") as HTMLInputElement;
    expect(sep.value).toBe(String(ficha.armado.tipo === "pilares" ? ficha.armado.armado!.cercos.separacion : ""));
    expect((screen.getByRole("button", { name: "Aplicar" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Cercos: cada (mm)"), { target: { value: "400" } });
    const antes = reg.pedidos.length;
    await waitFor(() => expect((screen.getByRole("button", { name: "Aplicar" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(reg.ediciones.length).toBe(2);
    const [, planta] = tabla.partes[0]!.clave.split("/");
    expect(reg.proyecto.armado!.pilares![pieza]![planta!]!.cercos.separacion).toBe(400);
    await waitFor(() => expect(document.querySelector("[data-estado-ficha]")!.textContent).toBe("No cumple"));
    await waitFor(() => expect(celdas(filasTabla()[0]!).at(-1)).toBe("No cumple"));
    // Sin recalcular: las comprobaciones y la planta por colores (CO6-d), con el armado nuevo
    const tras = reg.pedidos.slice(antes);
    expect(tras.every((p) => ["comprobaciones", "comprobacion", "escena", "elegir"].includes(p.tipo)), tras.map((p) => p.tipo).join()).toBe(true);
    expect(tras.some((p) => p.tipo === "escena" && p.vista.vista === "comprobacion" && p.vista.armado?.pilares?.[pieza]?.[planta!]?.cercos.separacion === 400)).toBe(true);
    const otra = await pedir<DatosComprobaciones>({ tipo: "comprobaciones", de: "pilares", armado: armado() });
    expect(otra.comprobadas).toBe(0);
    expect(otra.partes.filter((p) => !p.cumple).every((p) => p.pieza === pieza)).toBe(true);
    // Un dato que no vale no se escribe, y se dice
    fireEvent.change(screen.getByLabelText("Cercos: cada (mm)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(reg.ediciones.length).toBe(2);
    expect(screen.getByText(/Falta «cada \(mm\)» en «Cercos»/)).toBeTruthy();
    // Quitar
    fireEvent.click(screen.getByRole("button", { name: "Quitar" }));
    expect(reg.ediciones.length).toBe(3);
    expect(reg.proyecto.armado!.pilares![pieza]?.[planta!]).toBeUndefined();
    await waitFor(() => expect(document.querySelector("[data-estado-ficha]")!.textContent).toBe("Sin armado"));
  }, 120_000);

  it("las losas y el punzonamiento: «Toda la obra» arma los cuatro tipos y cada pestaña da su tabla", async () => {
    const reg = montar();
    await waitFor(() => expect(filasTabla().length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Toda la obra" }));
    await waitFor(() => expect(reg.ediciones.length).toBe(1), { timeout: 120_000 });
    const a = reg.proyecto.armado!;
    expect(Object.keys(a.pilares ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(a.vigas ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(a.forjados ?? {}).length).toBeGreaterThan(0);
    for (const [nombre, de] of [["Vigas", "vigas"], ["Losas", "losas"], ["Punzonamiento", "punzonamiento"]] as const) {
      fireEvent.click(within(screen.getByRole("group", { name: "Qué se comprueba" })).getByRole("button", { name: nombre }));
      const t = await pedir<DatosComprobaciones>({ tipo: "comprobaciones", de, armado: de === "vigas" ? { vigas: a.vigas! } : de === "losas" ? { forjados: a.forjados! } : { forjados: a.forjados!, ...(a.punzonamiento ? { punzonamiento: a.punzonamiento } : {}) } });
      if (!t.partes.length) continue;
      await waitFor(() => {
        expect(filasTabla().length).toBe(t.partes.length);
        expect(celdas(filasTabla()[0]!)[0]).toBe(t.partes[0]!.pieza);
      });
      filasTabla().forEach((tr, i) => expect(celdas(tr).at(-1), `${de} ${t.partes[i]!.clave}`).toBe(t.partes[i]!.cumple ? "Cumple" : t.partes[i]!.origen === "sin-armado" ? "Sin armado" : !t.partes[i]!.fallan && t.partes[i]!.pendientes.length ? "Sin comprobar" : "No cumple"));
    }
  }, 240_000);
});
