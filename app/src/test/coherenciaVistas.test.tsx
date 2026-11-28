/**
 * VC1 · DOM (`docs/fem3d/coherencia-vistas.md` §5): el contrato de las vistas. Un modo que dice lo que
 * dibuja (`dibuja`) y no da fuente para un tipo de vista lo avisa en ése, con el botón a la vista que
 * sí lo dibuja; un modo sin `dibuja` (Modelo) cae en el modelo sin aviso; y una herramienta que no va
 * en un tipo de vista lo dice en él.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { edificioObjetivoLosas } from "../../../validacion/c2/modelos.ts";
import { VERSION_ESQUEMA } from "../../../src/agente/proyecto.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { Atendedor } from "../../../src/visor/atender.ts";
import type { Pedido } from "../../../src/visor/protocolo.ts";
import type { EstadoSesion } from "../../../src/visor/sesion.ts";
import { ContextoPaneles, useAlmacenPaneles } from "../armazon/paneles.ts";
import { ContextoVisor } from "../contexto.ts";
import type { ClienteSesion } from "../sesion/cliente.ts";
import type { ProyectoAbierto } from "../sesion/useProyecto.ts";
import { ThemeProvider } from "../tema/ThemeProvider.tsx";
import { ContextoVistas, useEstadoVistas, type TipoVista } from "../vistas/estado.ts";
import { tipoQueDibuja, ZonaVistas, type FuentesVistas } from "../vistas/Zona.tsx";

const RAIZ = join(import.meta.dirname, "..", "..", "..");
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
  const a = await at.atender({ tipo: "abrir", texto: JSON.stringify({ esquema: VERSION_ESQUEMA, modelo: edificioObjetivoLosas(2, 2, 2) }) });
  if (!a.ok) throw new Error("no abre");
  estado = a.valor as EstadoSesion;
}, 120_000);

const CLAVE = "test-coherencia";
// Cuatro vistas: planta, 3D y dos alzados (los de por defecto)
beforeEach(() => localStorage.setItem(`fem-vistas:${CLAVE}`, JSON.stringify({ disposicion: "2x2", activa: 0, vistas: (["planta", "3d", "alzado", "alzado"] as TipoVista[]).map((tipo) => ({ tipo, planta: null, eje: null, dibujo: "modelo", modo3d: "alambrico", proyeccion: "perspectiva" })) })));

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

function Vistas({ children }: { children: React.ReactNode }) {
  return (
    <ContextoPaneles.Provider value={useAlmacenPaneles()}>
      <ContextoVistas.Provider value={useEstadoVistas(CLAVE)}>{children}</ContextoVistas.Provider>
    </ContextoPaneles.Provider>
  );
}

function montar(fuentes: FuentesVistas) {
  const proyecto: ProyectoAbierto = { fase: "listo", estado, cliente: cliente([]), fuente: { tipo: "texto", nombre: "x.json" }, desactualizado: false, errores: [], motivoGuardados: null, tiempos: {}, version: 1, abrirOrigen() {}, abrirTexto() {}, recalcular() {} };
  return render(
    <ThemeProvider>
      <Vistas>
        <ContextoVisor.Provider value={{ proyecto, planta: estado.plantas[0]!.id, setPlanta() {}, seleccion: null, setSeleccion() {}, elegidos: [], setElegidos() {}, espacio: "resultados", modo: "deformada", irA() {}, tablaPedida: null, pedirTabla() {} }}>
          <ZonaVistas fuentes={fuentes} />
        </ContextoVisor.Provider>
      </Vistas>
    </ThemeProvider>,
  );
}

const celda = (c: HTMLElement, tipo: TipoVista) => [...c.querySelectorAll<HTMLElement>(`.celda[data-tipo="${tipo}"]`)];

describe("VC1 · el contrato de las vistas", () => {
  it("tipoQueDibuja: el 3D si lo tiene, si no la planta; nada sin `dibuja` o con fuente propia", () => {
    const f = () => null;
    expect(tipoQueDibuja({ dibuja: "La deformada", tresD: f }, "alzado")).toBe("3d");
    expect(tipoQueDibuja({ dibuja: "El mapa", planta: f, tresD: f }, "alzado")).toBe("3d");
    expect(tipoQueDibuja({ dibuja: "La comprobación", planta: f }, "3d")).toBe("planta");
    expect(tipoQueDibuja({ dibuja: "Las reacciones", planta: f, alzado: f, tresD: f }, "alzado")).toBeNull();
    expect(tipoQueDibuja({ planta: f }, "alzado")).toBeNull();
  });

  it("un modo que no dibuja en planta ni en alzado lo dice en los dos, y el botón lleva la vista al 3D", async () => {
    const { container } = montar({ dibuja: "La deformada", tresD: () => <span data-mio="3d" /> });
    await waitFor(() => expect(container.querySelectorAll("[data-no-se-dibuja]").length).toBe(3));
    expect(container.querySelector('[data-no-se-dibuja="planta"]')!.textContent).toContain("La deformada no se dibuja en planta");
    expect(container.querySelectorAll('[data-no-se-dibuja="alzado"]').length).toBe(2);
    expect(container.querySelector('[data-no-se-dibuja="3d"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-no-se-dibuja="planta"] button')!);
    await waitFor(() => expect(celda(container, "3d").length).toBe(2));
    expect(container.querySelectorAll("[data-mio=\"3d\"]").length).toBe(2);
  });

  it("un modo sin `dibuja` (Modelo) cae en el modelo sin aviso", async () => {
    const { container } = montar({ planta: () => <span data-mio="planta" /> });
    await waitFor(() => expect(container.querySelector("[data-mio=\"planta\"]")).toBeTruthy());
    expect(container.querySelector("[data-no-se-dibuja]")).toBeNull();
  });

  it("una herramienta que no va en un tipo de vista lo dice en ése, y no en el que la admite", async () => {
    const { container } = montar({ herramientaFuera: (t) => (t === "planta" ? null : "Esta herramienta dibuja en planta; aquí, un clic elige") });
    await waitFor(() => expect(container.querySelectorAll("[data-herramienta-fuera]").length).toBe(3));
    expect(celda(container, "planta")[0]!.querySelector("[data-herramienta-fuera]")).toBeNull();
    expect(celda(container, "3d")[0]!.querySelector("[data-herramienta-fuera]")).toBeTruthy();
  });
});
