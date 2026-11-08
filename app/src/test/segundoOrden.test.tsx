/**
 * SO · DOM (`docs/fem3d/segundo-orden.md` §9, criterio 9): la pestaña «Segundo orden» de la ficha
 * «Viento y sismo» escribe `acciones.segundoOrden` sólo con lo que no es lo de por defecto (activado,
 * desplazamientos × 2), y lo lee de un fichero que lo trae.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { leerProyecto, type Proyecto } from "../../../src/agente/proyecto.ts";
import type { AccionesEdificio } from "../../../src/compilador/fisico.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import { ContextoVisor } from "../contexto.ts";
import { FichaAcciones } from "../editor/FichaAcciones.tsx";

const RAIZ = join(__dirname, "..", "..", "..");
const leido = leerProyecto(readFileSync(join(RAIZ, "ejemplos", "muestrario", "proyecto.json"), "utf8"));
if (!leido.valido) throw new Error("muestrario no válido");
const base = leido.proyecto;

function montar(acciones: AccionesEdificio | undefined) {
  const proyecto: Proyecto = { ...base, modelo: { ...base.modelo, acciones } };
  const editar = vi.fn((_o: Operacion, _e: string) => ({ ok: true as const }));
  const onCerrar = vi.fn();
  const visor = { proyecto: { edicion: { proyecto, editar }, cliente: null }, planta: "PL1", setPlanta() {}, seleccion: undefined, setSeleccion() {}, elegidos: [], setElegidos() {}, espacio: "cargas", setEspacio() {}, caso: "G", setCaso() {} };
  render(
    <ContextoVisor.Provider value={visor as never}>
      <FichaAcciones pestana="segundoOrden" onCerrar={onCerrar} />
    </ContextoVisor.Provider>,
  );
  const escrito = () => (editar.mock.calls.at(-1)![0] as unknown as { acciones: AccionesEdificio | null }).acciones;
  return { editar, escrito, onCerrar };
}

const aplicar = () => fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

describe("SO: la pestaña «Segundo orden» de la ficha de acciones", () => {
  it("por defecto está activado con los desplazamientos por 2, y así no escribe nada", () => {
    const { escrito, editar } = montar({ viento: { aspereza: "IV", zona: "A" } });
    const casilla = screen.getByRole("checkbox", { name: /Segundo orden global/ }) as HTMLInputElement;
    expect(casilla.checked).toBe(true);
    expect((screen.getByLabelText("Multiplicador de los desplazamientos") as HTMLInputElement).value).toBe("");
    aplicar();
    expect(editar).toHaveBeenCalled();
    expect(escrito()?.segundoOrden).toBeUndefined();
  });

  it("desactivarlo o cambiar el multiplicador escribe sólo eso", () => {
    const { escrito } = montar({ viento: { aspereza: "IV", zona: "A" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Segundo orden global/ }));
    fireEvent.change(screen.getByLabelText("Multiplicador de los desplazamientos"), { target: { value: "3" } });
    aplicar();
    expect(escrito()?.segundoOrden).toEqual({ amplificar: false, multiplicadorDesplazamientos: 3 });
  });

  it("lee lo del fichero y un multiplicador fuera de rango no se aplica", () => {
    const { editar } = montar({ segundoOrden: { amplificar: false, multiplicadorDesplazamientos: 1 } });
    expect((screen.getByRole("checkbox", { name: /Segundo orden global/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Multiplicador de los desplazamientos") as HTMLInputElement).value).toBe("1");
    fireEvent.change(screen.getByLabelText("Multiplicador de los desplazamientos"), { target: { value: "20" } });
    aplicar();
    expect(editar).not.toHaveBeenCalled();
    expect(screen.getByText(/no mayor que 10/)).toBeTruthy();
  });
});
