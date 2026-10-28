/**
 * Propiedades de una carga (2026-10-28, a petición del usuario: el menú «es un lío»): sólo los campos
 * de su tipo, el valor como un número hacia abajo (como la plantilla de su herramienta) y lo que casi
 * nunca hace falta, plegado en «Opciones avanzadas».
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

function montar(id: string) {
  const editar = vi.fn((_o: Operacion, _e: string) => ({ ok: true as const }));
  const visor = { proyecto: { edicion: { proyecto, editar } }, planta: null, setPlanta() {}, seleccion: id, setSeleccion() {}, elegidos: [id], setElegidos() {}, espacio: "cargas", modo: null, irA() {}, tablaPedida: null, pedirTabla() {} };
  const r = render(
    <ContextoVisor.Provider value={visor as never}>
      <FormularioObjeto id={id} tabla="cargas" />
    </ContextoVisor.Provider>,
  );
  return { ...r, editar };
}

const nombres = (c: HTMLElement) => [...c.querySelectorAll(".campo-nombre")].map((x) => x.textContent);

describe("Propiedades de una carga", () => {
  it("una de superficie: sólo sus campos, y la q como un número hacia abajo", async () => {
    const { container, editar } = montar("CM-PB");
    expect([...container.querySelectorAll(".campo-grupo")].map((h) => h.textContent)).toEqual(["La carga", "Dónde", "Valor"]);
    expect(nombres(container)).toEqual(["id", "tipo*", "caso*", "planta*", "forjado", "zona", "q"]);
    expect((screen.getByLabelText("puntos") as HTMLInputElement).placeholder).toBe("todo el forjado");
    expect(screen.getByRole("radio", { name: "↓ Gravedad" }).getAttribute("aria-checked")).toBe("true");
    const q = screen.getByLabelText("q") as HTMLInputElement;
    expect(q.value).toBe("2");
    fireEvent.change(q, { target: { value: "3,5" } });
    fireEvent.blur(q);
    await act(async () => {});
    expect(editar).toHaveBeenCalledTimes(1);
    const op = editar.mock.calls[0]![0] as Extract<Operacion, { op: "cambiar" }>;
    expect(op.objeto).toMatchObject({ q: [0, 0, -3.5], losa: "L1" });
  });

  it("una de viga: ejes y tramo en «Opciones avanzadas», plegadas; la q que varía, detrás de una casilla", async () => {
    const { container, editar } = montar("PETO-1");
    const plegado = container.querySelector("details.campo-plegado") as HTMLDetailsElement;
    expect(plegado.open).toBe(false);
    expect(plegado.querySelector("summary")!.textContent).toBe("Opciones avanzadas");
    expect(nombres(plegado)).toEqual(["ejes", "desde", "hasta"]);
    expect(screen.queryByLabelText("qb")).toBeNull();
    fireEvent.click(screen.getByLabelText("Varía a lo largo de la pieza"));
    expect(screen.getByLabelText("qb")).toBeTruthy();
    // Cambiar la dirección con q y qb es un solo paso
    fireEvent.change(screen.getByLabelText("qb"), { target: { value: "5" } });
    fireEvent.blur(screen.getByLabelText("qb"));
    await act(async () => {});
    expect(editar).toHaveBeenCalledTimes(1);
    expect((editar.mock.calls[0]![0] as Extract<Operacion, { op: "cambiar" }>).objeto).toMatchObject({ q: [0, 0, -3], qb: [0, 0, -5], ejes: "global" });
  });

  it("una puntual: la posición del punto, y el momento sólo si se pide", () => {
    const { container } = montar("WX+P1");
    expect(nombres(container)).toEqual(["id", "tipo*", "caso*", "planta*", "x del punto*", "y del punto*", "F"]);
    expect(screen.getByRole("radio", { name: "X" }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByLabelText("F") as HTMLInputElement).value).toBe("27");
    expect(container.querySelector("details")).toBeNull();
  });
});
