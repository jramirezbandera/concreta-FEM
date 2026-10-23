/**
 * Resultados · Armado (fase F, `docs/fem3d/franjas.md` §2.6, criterio 8), en el DOM: la tabla de las
 * franjas y el detalle de la elegida dicen los valores de sus consultas (`fem consultar franjas` y
 * `franja`) con su formato. Con la sesión de verdad en este proceso (el `Atendedor` del worker),
 * sobre el reticular de H25 (las bandas que trae no se dibujan ni se usan).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { conAcciones, conPropuesta, reticularH25 } from "../../../validacion/c5/modelos.ts";
import { VERSION_ESQUEMA } from "../../../src/agente/proyecto.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { serializar } from "../../../src/editor/serializar.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { Atendedor } from "../../../src/visor/atender.ts";
import type { DatosArmado, DatosFranja } from "../../../src/visor/franjas.ts";
import type { Pedido } from "../../../src/visor/protocolo.ts";
import type { EstadoSesion } from "../../../src/visor/sesion.ts";
import { ContextoPaneles, useAlmacenPaneles } from "../armazon/paneles.ts";
import { ContextoVisor } from "../contexto.ts";
import { fmt } from "../fmt.ts";
import { ModoArmado } from "../pantallas/Armado.tsx";
import type { ClienteSesion } from "../sesion/cliente.ts";
import { soloArmado, type Edicion, type ProyectoAbierto } from "../sesion/useProyecto.ts";
import { aplicar, type Operacion } from "../../../src/editor/operaciones.ts";
import type { Proyecto } from "../../../src/agente/proyecto.ts";
import { fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../tema/ThemeProvider.tsx";
import { ContextoVistas, useEstadoVistas } from "../vistas/estado.ts";

const RAIZ = join(__dirname, "..", "..", "..");
let at: Atendedor;
let estado: EstadoSesion;
const MODELO = conAcciones(conPropuesta(reticularH25()));

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
  expect((await at.atender({ tipo: "abrir", texto: serializar({ esquema: VERSION_ESQUEMA, modelo: MODELO }) })).ok).toBe(true);
  const c = await at.atender({ tipo: "calcular" });
  if (!c.ok) throw new Error("no calcula");
  estado = c.valor as EstadoSesion;
}, 120_000);

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
      <ContextoVistas.Provider value={useEstadoVistas("test-armado")}>{children}</ContextoVistas.Provider>
    </ContextoPaneles.Provider>
  );
}

function montar(planta: string, seleccion: string | null, edicion?: Edicion) {
  const proyecto: ProyectoAbierto = { fase: "listo", estado, cliente: cliente(), fuente: { tipo: "texto", nombre: "h25.json" }, desactualizado: false, errores: [], motivoGuardados: null, firmas: "", tiempos: {}, version: 1, abrirOrigen() {}, abrirTexto() {}, recalcular() {}, ...(edicion ? { edicion } : {}) };
  return render(
    <ThemeProvider>
      <Paneles>
        <ContextoVisor.Provider value={{ proyecto, planta, setPlanta() {}, seleccion, setSeleccion() {}, elegidos: [], setElegidos() {}, espacio: "resultados", modo: "armado", irA() {}, tablaPedida: null, pedirTabla() {} }}>
          <div style={{ display: "flex" }}>
            <ModoArmado />
          </div>
        </ContextoVisor.Provider>
      </Paneles>
    </ThemeProvider>,
  );
}

const conComb = (v: [number, string], n: number, varias: boolean) => (Number.isFinite(v[0]) ? `${fmt(v[0], n)}${varias ? v[1] : ""}` : "—");

describe("Fase F · Resultados · Armado en el DOM", () => {
  it("la tabla de la planta (X superior) y el detalle de la franja elegida dicen los valores de sus consultas", async () => {
    const planta = MODELO.losas![0]!.planta;
    const d = ((await at.atender({ tipo: "armado", planta, combinaciones: { tipo: "defecto" }, armadura: "x-sup" })) as { valor: DatosArmado }).valor;
    const varias = d.combinaciones.nombres.length > 1;
    expect(d.filas.length).toBeGreaterThan(3);
    expect(d.filas.every((f) => f.direccion === 1)).toBe(true);
    const id = d.filas[2]!.id;
    const fr = ((await at.atender({ tipo: "franja", id, combinaciones: { tipo: "defecto" } })) as { valor: DatosFranja }).valor;
    montar(planta, id);
    const tabla = await waitFor(() => {
      const t = screen.getByRole("table", { name: "Franjas de la planta" });
      expect(within(t).getAllByRole("row").length).toBe(d.filas.length + 1);
      return t;
    });
    const filas = within(tabla).getAllByRole("row").slice(1);
    d.filas.forEach((f, i) => {
      const c = within(filas[i]!).getAllByRole("cell");
      expect(Number(c[3]!.getAttribute("data-superior"))).toBe(f.superior?.v ?? 0);
      expect(c[3]!.textContent!.startsWith(f.superior ? fmt(f.superior.v, 1) : "0")).toBe(true);
    });
    (await waitFor(() => screen.getByRole("button", { name: `Ver las ${fr.estaciones.length} estaciones` }))).click();
    const est = await waitFor(() => screen.getByRole("table", { name: `Estaciones de ${id}` }));
    const filasE = within(est).getAllByRole("row").slice(1);
    expect(filasE.length).toBe(fr.estaciones.length);
    fr.estaciones.forEach((x, i) => {
      const c = within(filasE[i]!).getAllByRole("cell");
      expect(c[1]!.textContent).toBe(fmt(x.max[0], 1));
      expect(c[4]!.textContent).toBe(fmt(x.superior[0], 1));
    });
    const caras = screen.getByRole("table", { name: `Caras y apoyos de ${id}` });
    const exactas = fr.estaciones.filter((x) => x.tipo !== "paso");
    const filasC = within(caras).getAllByRole("row").slice(1);
    expect(filasC.length).toBe(exactas.length);
    exactas.forEach((x, i) => expect(within(filasC[i]!).getAllByRole("cell")[3]!.textContent).toBe(conComb(x.superior, 1, varias)));
    // La distancia de my y mxy (LV2-h), si no es δ
    exactas.forEach((x, i) => {
      const t = within(filasC[i]!).getAllByRole("cell")[0]!.textContent!;
      if (x.distanciaMuestras === undefined) expect(t).not.toContain("my, mxy");
      else expect(t).toContain(`my, mxy a ${fmt(x.distanciaMuestras, 2)} m`);
    });
    expect(screen.getByRole("img", { name: `Diagrama de ${id}` })).toBeTruthy();
  }, 60_000);
});

describe("Fase AB · la armadura base y las zonas de refuerzo en el DOM", () => {
  const proyectoBase = (armado: Proyecto["armado"]): Proyecto => ({ esquema: VERSION_ESQUEMA, modelo: MODELO, ...(armado ? { armado } : {}) });
  const edicion = (p: Proyecto, editar: (o: Operacion) => void): Edicion => ({
    proyecto: p,
    sinGuardar: false,
    deshacerEtiqueta: null,
    rehacerEtiqueta: null,
    editar: (o) => {
      editar(o);
      return aplicar(p, o);
    },
    deshacer() {},
    rehacer() {},
    guardar: async () => {},
    guardado: { tipo: "nada" },
    conflicto: null,
    recargarDisco() {},
    exportar() {},
    alNavegador: async () => {},
    modo: "descargar",
    pendiente: false,
  });

  it("la pestaña Refuerzos dice las zonas de su consulta, y la base se edita con la operación «armado»", async () => {
    const planta = MODELO.losas![0]!.planta;
    const losa = MODELO.losas![0]!.id;
    const armado = { base: { "x-sup": 15 } };
    const d = ((await at.atender({ tipo: "armado", planta, combinaciones: { tipo: "defecto" }, armadura: "x-sup", armado, soloExceso: true })) as { valor: DatosArmado }).valor;
    expect(d.zonas.length).toBeGreaterThan(0);
    const ops: Operacion[] = [];
    montar(planta, null, edicion(proyectoBase(armado), (o) => ops.push(o)));
    (await waitFor(() => screen.getByRole("tab", { name: /Refuerzos/ }))).click();
    const tabla = await waitFor(() => {
      const t = screen.getByRole("table", { name: "Zonas de refuerzo" });
      expect(within(t).getAllByRole("row").length).toBe(d.zonas.length + 1);
      return t;
    });
    within(tabla)
      .getAllByRole("row")
      .slice(1)
      .forEach((f, i) => {
        const c = within(f).getAllByRole("cell");
        expect(c[0]!.textContent!.startsWith(d.zonas[i]!.id)).toBe(true);
        expect(Number(c[5]!.getAttribute("data-maximo"))).toBe(d.zonas[i]!.maximo.v);
        expect(Number(c[6]!.getAttribute("data-exceso"))).toBe(d.zonas[i]!.maximo.exceso);
      });
    // La base común se ve y se cambia; la de la losa, vacía, hereda la común
    const comun = screen.getByRole("textbox", { name: "Base X superior de todas las losas" }) as HTMLInputElement;
    expect(comun.value).toBe("15");
    const propia = screen.getByRole("textbox", { name: `Base X superior de ${losa}` }) as HTMLInputElement;
    expect(propia.value).toBe("");
    expect(propia.placeholder).toBe("15");
    fireEvent.change(propia, { target: { value: "22,5" } });
    fireEvent.blur(propia);
    expect(ops).toEqual([{ op: "armado", armado: { base: { "x-sup": 15 }, losas: { [losa]: { "x-sup": 22.5 } } } }]);
    // Un número negativo no se manda
    fireEvent.change(comun, { target: { value: "-3" } });
    fireEvent.blur(comun);
    expect(ops.length).toBe(1);
    expect(comun.getAttribute("aria-invalid")).toBe("true");
  }, 60_000);

  it("siempre todo (sin «Lo que no cubre»); el filtro y la escala de Propiedades van en el pedido del mapa", async () => {
    const planta = MODELO.losas![0]!.planta;
    const pedidos: Pedido[] = [];
    const original = at.atender.bind(at);
    at.atender = (p: Pedido) => {
      pedidos.push(p);
      return original(p);
    };
    try {
      montar(planta, null, edicion(proyectoBase({ base: { "x-sup": 15 } }), () => {}));
      const mapas = () => pedidos.filter((p): p is Extract<Pedido, { tipo: "armado" }> => p.tipo === "armado");
      await waitFor(() => expect(mapas().length).toBeGreaterThan(0));
      expect(screen.queryByRole("button", { name: "Lo que no cubre" })).toBeNull();
      expect(mapas().every((p) => p.soloExceso === undefined && p.filtro === undefined && p.escala === undefined)).toBe(true);
      // «Desde la base»: el filtro desde 15
      (await waitFor(() => screen.getByRole("button", { name: /^Desde la base \(15/ }))).click();
      await waitFor(() => expect(mapas().some((p) => p.filtro?.min === 15 && p.filtro.max === undefined)).toBe(true));
      expect((screen.getByRole("textbox", { name: "Desde del filtro" }) as HTMLInputElement).value).toBe("15");
      // Un «hasta» por debajo del «desde» no se manda
      const n = mapas().length;
      const hasta = screen.getByRole("textbox", { name: "Hasta del filtro" });
      fireEvent.change(hasta, { target: { value: "10" } });
      fireEvent.blur(hasta);
      expect(screen.getByText(/tiene que ser menor que «hasta»/)).toBeTruthy();
      expect(mapas().length).toBe(n);
      fireEvent.change(hasta, { target: { value: "40" } });
      fireEvent.blur(hasta);
      await waitFor(() => expect(mapas().some((p) => p.filtro?.min === 15 && p.filtro.max === 40)).toBe(true));
      // La escala sin picos, y quitar el filtro
      within(screen.getByRole("group", { name: "Escala del mapa" })).getByRole("button", { name: "Sin picos" }).click();
      await waitFor(() => expect(mapas().some((p) => p.escala?.modo === "sin-picos" && p.filtro?.max === 40)).toBe(true));
      screen.getByRole("button", { name: "Quitar" }).click();
      await waitFor(() => {
        const u = mapas()[mapas().length - 1]!;
        expect(u.filtro).toBeUndefined();
        expect(u.escala).toEqual({ modo: "sin-picos" });
      });
    } finally {
      at.atender = original;
    }
  }, 60_000);

  it("sólo la base no reabre el proyecto (soloArmado)", () => {
    const p = proyectoBase(undefined);
    const r = aplicar(p, { op: "armado", armado: { base: { "x-inf": 5 } } });
    if (!r.ok) throw new Error();
    expect(soloArmado(p, r.proyecto)).toBe(true);
    const r2 = aplicar(r.proyecto, { op: "datos", nombre: "otro" });
    if (!r2.ok) throw new Error();
    expect(soloArmado(r.proyecto, r2.proyecto)).toBe(false);
    const l = MODELO.losas![0]!;
    const r3 = aplicar(r.proyecto, { op: "cambiar", coleccion: "losas", id: l.id, objeto: { ...l, espesor: l.espesor + 0.01 } });
    if (!r3.ok) throw new Error();
    expect(soloArmado(r.proyecto, r3.proyecto)).toBe(false);
  });
});
