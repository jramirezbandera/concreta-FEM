/**
 * Propiedades de un forjado (prueba de uso del 2026-10-28): los campos por grupos, lo obligatorio
 * marcado y dicho en el campo vacío, el valor por defecto de uno opcional, la ayuda con «Ayudas» y
 * el croquis enlazado con los campos.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
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
  const visor = { proyecto: { edicion: { proyecto, editar } }, planta: null, setPlanta() {}, seleccion: id, setSeleccion() {}, elegidos: [id], setElegidos() {}, espacio: "modelo", modo: null, irA() {}, tablaPedida: null, pedirTabla() {} };
  return render(
    <ContextoVisor.Provider value={visor as never}>
      <FormularioObjeto id={id} tabla="forjados" />
    </ContextoVisor.Provider>,
  );
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

  it("«Ayudas» enseña todas, y un clic en una cota lleva a su campo", () => {
    const { container } = montar("L2");
    const datos = container.querySelector(".form-datos")!;
    expect(datos.hasAttribute("data-ayudas")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Ayudas" }));
    expect(datos.hasAttribute("data-ayudas")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Ayudas" }));
    const cota = container.querySelector('.cq-cota[data-campo="nervio"]')!;
    fireEvent.click(cota);
    expect(document.activeElement).toBe(screen.getByLabelText("nervio"));
    expect(cota.getAttribute("data-activo")).toBe("true");
  });
});
