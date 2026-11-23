/**
 * CO6 · DOM (`docs/fem3d/comprobaciones.md` §8.10 y §8.14): el espacio Comprobación. La tabla es la del
 * pedido `comprobaciones` del worker (lo de comprobar del agente); «Proponer» pide `armar` y escribe
 * el armado en el proyecto con la operación `armado` (y, al entrar, lo que falta se propone solo, una
 * vez por cálculo); un clic abre la ficha con las filas del módulo y un doble clic, el banco de armado;
 * y cambiar el armado en el banco vuelve a comprobar esa pieza, sin recalcular.
 */
import { barrasDe } from "../../../src/comprobaciones/armado.ts";
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
import type { DatosComprobaciones, DatosPortico, FichaComprobacion } from "../../../src/visor/comprobaciones.ts";
import { despiecePortico } from "../../../src/comprobaciones/despieceVigas.ts";
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
  /** §8.14: que el programa proponga solo lo que falta (en las pruebas de lo demás, no). */
  automatico: boolean;
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
        espacio: "comprobacion",
        modo: "losas",
        irA() {},
        tablaPedida: null,
        pedirTabla() {},
      }}
    >
      <div style={{ display: "flex" }}>
        <ModoComprobacion automatico={reg.automatico} />
      </div>
    </ContextoVisor.Provider>
  );
}

function montar(automatico = false): Registro & { desmontar: () => void } {
  const reg: Registro & { desmontar: () => void } = { automatico, pedidos: [], ediciones: [], elegidos: [], proyecto: inicial, desmontar() {} };
  // El panel de abajo recuerda su pestaña: cada prueba empieza en la tabla
  localStorage.clear();
  const { unmount } = render(
    <ThemeProvider>
      <Paneles>
        <Montada reg={reg} />
      </Paneles>
    </ThemeProvider>,
  );
  reg.desmontar = unmount;
  return reg;
}

const filasTabla = () => within(document.querySelector("[data-tabla-comprobacion]")!).getAllByRole("row").slice(1);
const celdas = (tr: HTMLElement) => within(tr).getAllByRole("cell").map((c) => c.textContent);

describe("CO6 · DOM: Comprobación", () => {
  it("§8.14: al entrar, lo que no tiene armado se propone solo en toda la obra (un paso de deshacer), una vez por cálculo", async () => {
    const reg = montar(true);
    await waitFor(() => expect(reg.ediciones.length).toBe(1), { timeout: 180_000 });
    expect(reg.pedidos.filter((p) => p.tipo === "armar").map((p) => p.tipo === "armar" && [p.tipos.join(), p.soloSinArmado])).toEqual([["pilares,vigas,losas,punzonamiento", true]]);
    expect(reg.ediciones[0]!.etiqueta).toBe("Armado propuesto: lo que falta en la obra");
    const a = reg.proyecto.armado!;
    for (const k of ["pilares", "vigas", "forjados"] as const) expect(Object.keys(a[k] ?? {}).length, k).toBeGreaterThan(0);
    await waitFor(() => expect(document.querySelector("[data-propuesta]")!.textContent).toContain("Armado propuesto por el programa"));
    await waitFor(() => expect(filasTabla().every((tr) => celdas(tr).at(-1) !== "Sin armado")).toBe(true), { timeout: 60_000 });
    // Otra vez en el espacio con el mismo cálculo y sin armado (deshecho): no vuelve a proponerlo solo
    reg.desmontar();
    const otra = montar(true);
    await waitFor(() => expect(filasTabla().length).toBeGreaterThan(0));
    expect(filasTabla().every((tr) => celdas(tr).at(-1) === "Sin armado")).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(otra.pedidos.some((p) => p.tipo === "armar")).toBe(false);
    expect(otra.ediciones.length).toBe(0);
  }, 240_000);

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
    // Un clic elige (la tabla sigue a la vista); el doble clic abre abajo el banco de armado
    expect(document.querySelector("[data-banco-armado]")).toBeNull();
    fireEvent.doubleClick(fila);
    await waitFor(() => expect(document.querySelector('[data-banco-armado][data-tipo="pilares"]')).toBeTruthy(), { timeout: 60_000 });
    // §8.14 y CO1-f: junto a la sección, el tramo en alzado con sus zonas de cercos y las envolventes de N, My y Mz
    const zonasDibujadas = [...document.querySelectorAll("[data-alzado-pilar] [data-zona-pilar]")].map((x) => x.getAttribute("data-zona-pilar"));
    expect(zonasDibujadas.length).toBeGreaterThanOrEqual(2);
    expect(zonasDibujadas[0]).toBe("pie");
    expect(zonasDibujadas.at(-1)).toBe("cabeza");
    await waitFor(() => expect([...document.querySelectorAll("[data-esfuerzo-pilar]")].map((x) => x.getAttribute("data-esfuerzo-pilar"))).toEqual(["N", "My", "Mz"]), { timeout: 60_000 });
    expect(reg.pedidos.some((p) => p.tipo === "esfuerzos-pilar" && p.pilar === pieza)).toBe(true);
    // Los cercos de los extremos, en su grupo del formulario (vacío: los del centro)
    expect(screen.getByLabelText("Cercos junto al pie: cada (mm)")).toBeTruthy();
    expect(screen.getByLabelText("Cercos junto a la cabeza: Ø")).toBeTruthy();
    const pestana = (nombre: RegExp) => fireEvent.click(screen.getByRole("tab", { name: nombre }));
    const tabla = await pedir<DatosComprobaciones>({ tipo: "comprobaciones", de: "pilares", armado: armado() });
    const ficha = await pedir<FichaComprobacion>({ tipo: "comprobacion", de: "pilares", clave: tabla.partes[0]!.clave, armado: armado() });
    await waitFor(() => expect(within(document.querySelector("[data-filas-modulo]")!).getAllByRole("row").length).toBe(ficha.filas.length + 1));
    expect(document.querySelector("[data-estado-ficha]")!.textContent).toBe("Cumple");
    // §8.11: el croquis de la sección, con las barras del armado; sigue a lo que se escribe, sin aplicarlo
    const dibujadas = () => document.querySelectorAll(`[data-banco-armado] [data-croquis-armado="pilar"] .ca-barra`).length;
    const suyo = ficha.armado.tipo === "pilares" ? ficha.armado.armado! : undefined;
    expect(dibujadas()).toBe(barrasDe(suyo!));
    const porCara = screen.getByLabelText("Intermedias en cada cara h: por cara") as HTMLInputElement;
    const diametroCara = screen.getByLabelText("Intermedias en cada cara h: Ø") as HTMLSelectElement;
    const [nAntes, oAntes] = [porCara.value, diametroCara.value];
    fireEvent.change(porCara, { target: { value: "3" } });
    fireEvent.change(diametroCara, { target: { value: "12" } });
    const conCara = barrasDe({ ...suyo!, caraH: { n: 3, diametro: 12 } });
    await waitFor(() => expect(dibujadas()).toBe(conCara));
    expect(reg.ediciones.length).toBe(1);
    fireEvent.change(porCara, { target: { value: nAntes } });
    fireEvent.change(diametroCara, { target: { value: oAntes } });
    await waitFor(() => expect(dibujadas()).toBe(barrasDe(suyo!)));
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
    pestana(/^Comprobaciones/);
    await waitFor(() => expect(celdas(filasTabla()[0]!).at(-1)).toBe("No cumple"));
    // «Editar el armado», en Propiedades, vuelve al banco
    fireEvent.click(screen.getByRole("button", { name: "Editar el armado" }));
    await waitFor(() => expect(document.querySelector("[data-banco-armado]")).toBeTruthy());
    // Sin recalcular: las comprobaciones y la planta por colores (CO6-d), con el armado nuevo
    const tras = reg.pedidos.slice(antes);
    expect(tras.every((p) => ["comprobaciones", "comprobacion", "escena", "elegir", "esfuerzos-pilar"].includes(p.tipo)), tras.map((p) => p.tipo).join()).toBe(true);
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
      filasTabla().forEach((tr, i) => expect(celdas(tr).at(-1), `${de} ${t.partes[i]!.clave}`).toBe(t.partes[i]!.origen === "no-aplica" ? "No se comprueba" : t.partes[i]!.cumple ? "Cumple" : t.partes[i]!.origen === "sin-armado" ? "Sin armado" : !t.partes[i]!.fallan && t.partes[i]!.pendientes.length ? "Sin comprobar" : "No cumple"));
    }
    // §8.11: la planta pide el armado dibujado (por defecto), y con «Aprovechamiento», sólo los colores
    expect(reg.pedidos.some((p) => p.tipo === "escena" && p.vista.vista === "comprobacion" && p.vista.dibujo === "armado")).toBe(true);
    // Los refuerzos de una losa, en su ficha: se eligen en la planta y se quitan
    const conRefuerzos = Object.entries(a.forjados ?? {}).find(([, f]) => f.refuerzos?.length);
    expect(conRefuerzos).toBeTruthy();
    const [losa, suyo] = conRefuerzos!;
    fireEvent.click(within(screen.getByRole("group", { name: "Qué se comprueba" })).getByRole("button", { name: "Losas" }));
    await waitFor(() => expect(filasTabla().some((tr) => celdas(tr)[0] === losa)).toBe(true));
    fireEvent.doubleClick(filasTabla().find((tr) => celdas(tr)[0] === losa)!);
    await waitFor(() => expect(document.querySelectorAll('[data-lista-armado="refuerzos"] .elemento-armado').length).toBe(suyo.refuerzos!.length), { timeout: 60_000 });
    expect(document.querySelector('[data-croquis-armado="losa"]')).toBeTruthy();
    const primero = document.querySelector('[data-lista-armado="refuerzos"] .elemento-armado') as HTMLElement;
    fireEvent.click(within(primero).getAllByRole("button")[0]!);
    expect(reg.elegidos.at(-1)).toEqual([`${losa}/R1`]);
    await waitFor(() => expect(document.querySelector('[data-lista-armado="refuerzos"] .elemento-armado[data-on]')).toBeTruthy());
    const antes = reg.ediciones.length;
    fireEvent.click(within(document.querySelector('[data-lista-armado="refuerzos"] .elemento-armado') as HTMLElement).getByRole("button", { name: /^Quitar: R1 / }));
    expect(reg.ediciones.length).toBe(antes + 1);
    expect(reg.proyecto.armado!.forjados![losa]!.refuerzos?.length ?? 0).toBe(suyo.refuerzos!.length - 1);
    // Los de detrás cambian de número: tras quitar uno, lo elegido es la losa
    expect(reg.elegidos.at(-1)).toEqual([losa]);
    // §8.12: con uno elegido, Supr lo quita (un paso de deshacer)
    const quedan = reg.proyecto.armado!.forjados![losa]!.refuerzos?.length ?? 0;
    if (quedan) {
      await waitFor(() => expect(document.querySelectorAll('[data-lista-armado="refuerzos"] .elemento-armado').length).toBe(quedan), { timeout: 60_000 });
      fireEvent.click(within(document.querySelector('[data-lista-armado="refuerzos"] .elemento-armado') as HTMLElement).getAllByRole("button")[0]!);
      expect(reg.elegidos.at(-1)).toEqual([`${losa}/R1`]);
      const n = reg.ediciones.length;
      fireEvent.keyDown(window, { key: "Delete" });
      expect(reg.ediciones.length).toBe(n + 1);
      expect(reg.proyecto.armado!.forjados![losa]!.refuerzos?.length ?? 0).toBe(quedan - 1);
      expect(reg.elegidos.at(-1)).toEqual([losa]);
    }
    // «Añadir» pone la herramienta (lo dice sobre la planta) y Esc la suelta
    const anadir = screen.getByRole("combobox", { name: "Añadir a una losa" }) as HTMLSelectElement;
    fireEvent.change(anadir, { target: { value: "x-sup" } });
    await waitFor(() => expect(anadir.value).toBe("x-sup"));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(anadir.value).toBe(""));
    // Lo que se ve: todo, una cara o los cercos
    fireEvent.click(within(screen.getByRole("group", { name: "Se ve" })).getByRole("button", { name: "Cercos" }));
    await waitFor(() => expect(reg.pedidos.some((p) => p.tipo === "escena" && p.vista.vista === "comprobacion" && p.vista.cara === "cercos")).toBe(true));
  }, 240_000);

  it("§8.13: con una viga elegida, su banco de armado dibuja el despiece de su pórtico: el de `despiecePortico` con el armado del proyecto; sigue a lo que se escribe y un clic en otro vano lo elige", async () => {
    const reg = montar();
    await waitFor(() => expect(filasTabla().length).toBeGreaterThan(0));
    fireEvent.click(within(screen.getByRole("group", { name: "Qué se comprueba" })).getByRole("button", { name: "Vigas" }));
    await waitFor(() => expect(document.querySelector("[data-tabla-comprobacion] th")!.textContent).toBe("Viga"));
    fireEvent.click(screen.getByRole("button", { name: "Todo" }));
    await waitFor(() => expect(reg.ediciones.length).toBe(1), { timeout: 120_000 });
    const vigas = reg.proyecto.armado!.vigas!;
    // Una viga de más de un vano, para cambiar de uno a otro
    const t = await pedir<DatosComprobaciones>({ tipo: "comprobaciones", de: "vigas", armado: { vigas } });
    const parte = t.partes.find((p) => t.partes.filter((x) => x.pieza === p.pieza).length > 1) ?? t.partes[0]!;
    await waitFor(() => expect(filasTabla().length).toBe(t.partes.length));
    fireEvent.doubleClick(filasTabla()[t.partes.indexOf(parte)]!);
    await waitFor(() => expect(document.querySelector("[data-despiece-portico]")).toBeTruthy(), { timeout: 60_000 });
    expect(reg.pedidos.some((p) => p.tipo === "portico" && p.viga === parte.pieza)).toBe(true);
    const dp = await pedir<DatosPortico>({ tipo: "portico", viga: parte.pieza });
    const armados = Object.fromEntries(dp.portico.vanos.map((v) => [v.clave, vigas[v.viga]?.[v.vano]]));
    const d = despiecePortico(dp.portico, armados, dp.despiece);
    const raiz = document.querySelector("[data-despiece-portico]")!;
    expect(raiz.getAttribute("data-despiece-portico")).toBe(dp.portico.id);
    expect([...raiz.querySelectorAll("[data-barra] .dp-rotulo")].map((x) => x.textContent)).toEqual(d.barras.map((b) => `${b.n}Ø${b.diametro} L=${fmt(b.largo, 2)}`));
    expect(raiz.querySelector("[data-tabla-despiece]")!.querySelectorAll("tbody tr")).toHaveLength(d.medicion.length);
    expect(raiz.querySelector(`[data-vano="${parte.clave}"]`)!.hasAttribute("data-on")).toBe(true);
    // §8.14: bajo el despiece, la envolvente de momentos de ELU del pórtico; la de cortantes, al marcarla
    await waitFor(() => expect(document.querySelector('[data-despiece-portico] [data-esfuerzo="My"]')).toBeTruthy(), { timeout: 60_000 });
    expect(reg.pedidos.some((p) => p.tipo === "esfuerzos-portico" && p.viga === parte.pieza)).toBe(true);
    expect(document.querySelector('[data-despiece-portico] [data-esfuerzo="Vz"]')).toBeNull();
    fireEvent.click(within(screen.getByRole("group", { name: "Esfuerzos bajo el despiece" })).getByLabelText("V"));
    expect(document.querySelector('[data-despiece-portico] [data-esfuerzo="Vz"]')).toBeTruthy();
    // Lo que se escribe en la ficha, sin aplicarlo: el despiece lo sigue (otra inferior), y el proyecto no cambia
    const inferior = within(document.querySelector("[data-form-armado]") as HTMLElement).getAllByRole("combobox")[0] as HTMLSelectElement;
    const suya = d.barras.find((b) => b.cara === "inferior" && b.origen.some((o) => o.clave === parte.clave))!;
    const otro = suya.diametro === 25 ? 20 : 25;
    fireEvent.change(inferior, { target: { value: String(otro) } });
    await waitFor(() => expect(raiz.querySelector(`[data-barra="${suya.marca}"] .dp-rotulo`)!.textContent).toMatch(new RegExp(`^${suya.n}Ø${otro} L=`)));
    expect(reg.ediciones.length).toBe(1);
    // Un clic en otro vano del pórtico lo elige: su ficha y su banda
    const otra = dp.portico.vanos.find((v) => v.clave !== parte.clave && t.partes.some((p) => p.clave === v.clave));
    if (otra) {
      fireEvent.click(raiz.querySelector(`[data-vano="${otra.clave}"]`)!);
      await waitFor(() => expect(document.querySelector("[data-despiece-portico]")!.querySelector(`[data-vano="${otra.clave}"]`)!.hasAttribute("data-on")).toBe(true), { timeout: 60_000 });
      expect(reg.elegidos.at(-1)).toEqual([otra.viga]);
      // El borrador era del otro vano: aquí vuelve a dibujarse lo del proyecto
      await waitFor(() => expect([...document.querySelectorAll("[data-despiece-portico] [data-barra] .dp-rotulo")].map((x) => x.textContent)).toEqual(d.barras.map((b) => `${b.n}Ø${b.diametro} L=${fmt(b.largo, 2)}`)), { timeout: 60_000 });
    }
  }, 240_000);
});
