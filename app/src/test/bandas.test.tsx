/**
 * Resultados · Bandas (V2b, `docs/fem3d/visor.md` §7.4 d, criterio 7), en el DOM: la tabla de las
 * bandas y el detalle de la elegida dicen los valores de su consulta con su formato. Con la sesión de
 * verdad en este proceso (el `Atendedor` del worker), sobre el reticular de H25 con sus bandas
 * propuestas.
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
import type { DatosBanda, DatosBandas } from "../../../src/visor/bandas.ts";
import type { Pedido } from "../../../src/visor/protocolo.ts";
import type { EstadoSesion } from "../../../src/visor/sesion.ts";
import { ContextoPaneles, useAlmacenPaneles } from "../armazon/paneles.ts";
import { ContextoVisor } from "../contexto.ts";
import { fmt } from "../fmt.ts";
import { ModoBandas } from "../pantallas/Bandas.tsx";
import type { ClienteSesion } from "../sesion/cliente.ts";
import type { ProyectoAbierto } from "../sesion/useProyecto.ts";
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
      <ContextoVistas.Provider value={useEstadoVistas("test-bandas")}>{children}</ContextoVistas.Provider>
    </ContextoPaneles.Provider>
  );
}

function montar(planta: string, seleccion: string | null) {
  const proyecto: ProyectoAbierto = { fase: "listo", estado, cliente: cliente(), fuente: { tipo: "texto", nombre: "h25.json" }, desactualizado: false, errores: [], motivoGuardados: null, firmas: "", tiempos: {}, version: 1, abrirOrigen() {}, abrirTexto() {}, recalcular() {} };
  return render(
    <ThemeProvider>
      <Paneles>
        <ContextoVisor.Provider value={{ proyecto, planta, setPlanta() {}, seleccion, setSeleccion() {}, elegidos: [], setElegidos() {}, espacio: "resultados", modo: "bandas", irA() {}, tablaPedida: null, pedirTabla() {} }}>
          <div style={{ display: "flex" }}>
            <ModoBandas />
          </div>
        </ContextoVisor.Provider>
      </Paneles>
    </ThemeProvider>,
  );
}

const conComb = (v: [number, string] | null, n: number, varias: boolean) => (v ? `${fmt(v[0], n)}${varias ? v[1] : ""}` : "—");

describe("V2b · Resultados · Bandas en el DOM", () => {
  it("la tabla de la planta (dirección 1) y el detalle de la banda elegida dicen los valores de su consulta", async () => {
    const planta = MODELO.bandas![0]!.planta;
    const d = ((await at.atender({ tipo: "bandas", planta, combinaciones: { tipo: "defecto" }, direccion: "1" })) as { valor: DatosBandas }).valor;
    const varias = d.combinaciones.nombres.length > 1;
    const id = d.filas[1]!.id;
    const b = ((await at.atender({ tipo: "banda", id, combinaciones: { tipo: "defecto" } })) as { valor: DatosBanda }).valor;
    montar(planta, id);
    const tabla = await waitFor(() => {
      const t = screen.getByRole("table", { name: "Bandas de la planta" });
      expect(within(t).getAllByRole("row").length).toBe(d.filas.length + 1);
      return t;
    });
    const filas = within(tabla).getAllByRole("row").slice(1);
    d.filas.forEach((f, i) => {
      const c = within(filas[i]!).getAllByRole("cell");
      expect(c[2]!.textContent).toBe(conComb(f.cara, 1, varias));
      expect(c[3]!.textContent).toBe(conComb(f.vano, 1, varias));
    });
    const est = await waitFor(() => screen.getByRole("table", { name: `Estaciones de ${id}` }));
    const filasE = within(est).getAllByRole("row").slice(1);
    expect(filasE.length).toBe(b.estaciones.length);
    b.estaciones.forEach((x, i) => {
      const c = within(filasE[i]!).getAllByRole("cell");
      if (!x.valido) return;
      expect(c[1]!.textContent).toBe(conComb(x.max, 1, varias));
      expect(c[2]!.textContent).toBe(conComb(x.min, 1, varias));
    });
    const wa = screen.getByRole("table", { name: `Wood–Armer de ${id}` });
    const filasW = within(wa).getAllByRole("row").slice(1);
    b.estaciones.forEach((x, i) => {
      if (!x.woodArmer) return;
      expect(within(filasW[i]!).getAllByRole("cell")[1]!.textContent).toBe(conComb(x.woodArmer.inferiorX, 1, varias));
    });
    // Reticular: el momento por nervio
    expect(screen.getByRole("table", { name: `Momento por nervio de ${id}` })).toBeTruthy();
  }, 60_000);
});
