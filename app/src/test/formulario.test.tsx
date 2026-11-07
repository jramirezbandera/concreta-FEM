/**
 * Propiedades de un forjado (prueba de uso del 2026-10-28): los campos por grupos, lo obligatorio
 * marcado y dicho en el campo vacío, el valor por defecto de uno opcional, la ayuda en un globo y
 * el croquis enlazado con los campos.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { leerProyecto } from "../../../src/agente/proyecto.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import { ContextoVisor } from "../contexto.ts";
import { FormularioObjeto } from "../editor/Formulario.tsx";

const RAIZ = join(__dirname, "..", "..", "..");
const leido = leerProyecto(readFileSync(join(RAIZ, "ejemplos", "muestrario", "proyecto.json"), "utf8"));
if (!leido.valido) throw new Error("muestrario no válido");
const proyecto = leido.proyecto;
// L2, con el casetón perdido de otro material y su pp escrito (el muestrario lo tuvo así hasta el 2026-11-06)
proyecto.modelo.losas = proyecto.modelo.losas!.map((l) => (l.id === "L2" ? { ...l, pp: 4.6, reticular: { ...l.reticular!, caseton: "perdido" as const } } : l));

function montar(id: string, tabla: "forjados" | "pilares" = "forjados") {
  const editar = vi.fn((_o: Operacion, _e: string) => ({ ok: true as const }));
  const visor = { proyecto: { edicion: { proyecto, editar } }, planta: null, setPlanta() {}, seleccion: id, setSeleccion() {}, elegidos: [id], setElegidos() {}, espacio: "modelo", modo: null, irA() {}, tablaPedida: null, pedirTabla() {} };
  return Object.assign(render(
    <ContextoVisor.Provider value={visor as never}>
      <FormularioObjeto id={id} tabla={tabla} />
    </ContextoVisor.Provider>,
  ), { editar });
}

const nombre = (el: HTMLElement) => el.closest("label")!.querySelector(".campo-nombre")!.textContent;

describe("Propiedades de un forjado", () => {
  it("por grupos, con lo obligatorio marcado y el pp que toma una maciza", () => {
    const { container } = montar("L1");
    expect([...container.querySelectorAll(".campo-grupo")].map((h) => h.textContent)).toEqual(["General", "Geometría en planta", "Sección", "Material y peso"]);
    expect(nombre(screen.getByLabelText("canto"))).toBe("canto*");
    expect(nombre(screen.getByLabelText("pp"))).toBe("pp");
    expect((screen.getByLabelText("pp") as HTMLInputElement).placeholder).toBe("6,25 = γ·canto");
    expect((screen.getByLabelText("dirección") as HTMLInputElement).placeholder).toBe("0 (según +X)");
    expect(screen.getByRole("img", { name: /^Planta del forjado/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Sección de la losa maciza" })).toBeTruthy();
  });

  it("en un reticular con casetón perdido, el pp es obligatorio y vacío lo dice", () => {
    montar("L2");
    const pp = screen.getByLabelText("pp") as HTMLInputElement;
    expect(nombre(pp)).toBe("pp*");
    fireEvent.change(pp, { target: { value: "" } });
    expect(pp.placeholder).toBe("obligatorio");
    expect(pp.dataset.falta).toBe("true");
    expect(screen.getByRole("img", { name: "Sección del reticular" }).textContent).toContain("nervio 12");
  });

  it("la ayuda sale en un globo al pasar por su «?», y un clic en una cota lleva a su campo", () => {
    vi.useFakeTimers();
    const { container } = montar("L2");
    expect(container.querySelector("p.ayuda")).toBeNull();
    const q = screen.getByLabelText("ábacos").closest("label")!.querySelector(".campo-q")!;
    fireEvent.mouseEnter(q);
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByRole("tooltip").textContent).toMatch(/polígonos macizos/);
    fireEvent.mouseLeave(q);
    expect(screen.queryByRole("tooltip")).toBeNull();
    vi.useRealTimers();
    const cota = container.querySelector('.cq-cota[data-campo="nervio"]')!;
    fireEvent.click(cota);
    expect(document.activeElement).toBe(screen.getByLabelText("nervio"));
    expect(cota.getAttribute("data-activo")).toBe("true");
  });
});

describe("Propiedades de un pilar: sus tramos (2026-11-05)", () => {
  it("cada tramo con su sección; cambiar uno escribe la celda de los tramos en un paso", () => {
    // P6 del muestrario: de CIM a CUB, P30x30 salvo el tramo de CIM a PB (P40x40)
    const { container, editar } = montar("P6", "pilares");
    expect([...container.querySelectorAll(".campo-grupo")].map((h) => h.textContent)).toEqual(["General", "Posición", "Plantas y sección", "Tramos", "Base y liberaciones"]);
    // La celda no sale como campo: la lleva la lista
    expect(screen.queryByLabelText("tramos")).toBeNull();
    const filas = [...screen.getByTestId("tramos-pilar").querySelectorAll("tr")].map((tr) => tr.getAttribute("data-tramo"));
    expect(filas).toEqual(["CUB", "PL1", "PB"]);
    const abajo = screen.getByLabelText("Sección del tramo CIM–PB") as HTMLSelectElement;
    expect(abajo.value).toBe("P40x40");
    expect((screen.getByLabelText("Sección del tramo PL1–CUB") as HTMLSelectElement).value).toBe("");
    // Hormigón y acero, por separado
    expect([...abajo.querySelectorAll("optgroup")].map((g) => g.label)).toEqual(["Hormigón"]);
    fireEvent.change(screen.getByLabelText("Sección del tramo PL1–CUB"), { target: { value: "P40x40" } });
    expect(editar).toHaveBeenCalledTimes(1);
    const [op] = editar.mock.calls[0]!;
    expect(op.op === "cambiar" && (op.objeto as { tramos?: unknown }).tramos).toEqual([
      { planta: "CUB", seccion: "P40x40" },
      { planta: "PB", seccion: "P40x40" },
    ]);
  });

  it("«y los de encima» pone la del tramo en todos los de encima", () => {
    const { editar } = montar("P6", "pilares");
    fireEvent.click(screen.getByRole("button", { name: "P40x40 también en los tramos de encima de CIM–PB" }));
    const [op] = editar.mock.calls[0]!;
    expect(op.op === "cambiar" && (op.objeto as { tramos?: unknown }).tramos).toEqual([
      { planta: "CUB", seccion: "P40x40" },
      { planta: "PL1", seccion: "P40x40" },
      { planta: "PB", seccion: "P40x40" },
    ]);
  });
});

describe("Propiedades de un forjado: el peso propio (revisión del 2026-11-05)", () => {
  it("dice qué manda, el peso medio con los ábacos sólo como dato, y el relleno y su procedencia se escriben", () => {
    // L2 del muestrario: reticular con casetón «perdido», pp escrito de 4,6 y 12 ábacos
    const { editar } = montar("L2");
    const peso = screen.getByTestId("peso-forjado");
    expect(peso.textContent).toMatch(/Manda el escrito, 4,6 kN\/m², en la zona aligerada/);
    expect(screen.getByTestId("peso-medio").textContent).toMatch(/sólo como dato/);
    const relleno = screen.getByLabelText("relleno") as HTMLInputElement;
    expect(nombre(relleno)).toBe("relleno");
    fireEvent.change(relleno, { target: { value: "12 kg × 6,25" } });
    fireEvent.blur(relleno);
    expect(editar).toHaveBeenCalledTimes(1);
    const [op] = editar.mock.calls[0]!;
    expect(op.op === "cambiar" && (op.objeto as { reticular?: { relleno?: unknown } }).reticular?.relleno).toEqual({ pesoPieza: 12, piezasM2: 6.25 });
    const proc = screen.getByLabelText("procedencia") as HTMLInputElement;
    fireEvent.change(proc, { target: { value: "fabricante: Ficha X, 2025" } });
    fireEvent.blur(proc);
    const [op2] = editar.mock.calls[1]!;
    expect(op2.op === "cambiar" && (op2.objeto as { ppProcedencia?: unknown }).ppProcedencia).toEqual({ origen: "fabricante", fuente: "Ficha X, 2025" });
  });
});

describe("el croquis en planta de un reticular con ábacos que se salen", () => {
  it("dibuja los ábacos sólo en lo que cae en el forjado y encuadra el contorno (prueba de uso «31», 2026-11-07)", async () => {
    const { PlantaForjado } = await import("../editor/CroquisForjado.tsx");
    const contorno: [number, number][] = [[0, 0], [10, 0], [10, 6], [0, 6]];
    const { container } = render(
      <PlantaForjado
        c={{ tipo: "reticular", contorno, huecos: [], abacos: [[[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]]], area: 60, caja: [0, 0, 10, 6], direccion: 0, intereje: 0.8, caseton: "perdido" }}
        activo={null}
        onCampo={() => {}}
      />,
    );
    const ab = container.querySelector(".cq-abaco")!;
    const g = ab.closest("g[clip-path]")!;
    expect(g).not.toBeNull();
    const id = /url\(#(.+)\)/.exec(g.getAttribute("clip-path")!)![1]!;
    const recorte = container.querySelector(`clipPath[id="${id}"] path`)!;
    expect(recorte.getAttribute("d")).toBe(container.querySelector(".cq-losa")!.getAttribute("d"));
    // El encuadre, el del contorno: su primer vértice no se aparta del margen por el ábaco
    const borde = container.querySelector(".cq-borde")!.getAttribute("d")!;
    const xs = [...borde.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[1]));
    const svg = container.querySelector("svg")!;
    const W = Number(svg.getAttribute("width"));
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(W, 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(W * 0.75);
  });
});
