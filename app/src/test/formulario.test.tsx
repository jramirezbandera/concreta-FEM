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
