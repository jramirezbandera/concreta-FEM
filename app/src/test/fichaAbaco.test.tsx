/**
 * Fase AC: Propiedades de los ábacos elegidos. Uno, con su a × b y su centro, que se escriben (y lo
 * elegido sigue al ábaco tras unirse); varios, «Unir»; todos, «Borrar». Con el muestrario: L2, 12
 * ábacos de 2,40 en pilares a 6 × 5,5 m.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { leerProyecto } from "../../../src/agente/proyecto.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import { ContextoVisor } from "../contexto.ts";
import { FichaAbacos } from "../editor/FichaAbaco.tsx";

const RAIZ = join(__dirname, "..", "..", "..");
const leido = leerProyecto(readFileSync(join(RAIZ, "ejemplos", "muestrario", "proyecto.json"), "utf8"));
if (!leido.valido) throw new Error("muestrario no válido");
const proyecto = leido.proyecto;

function montar(ids: string[]) {
  const editar = vi.fn((_o: Operacion, _e: string) => ({ ok: true as const }));
  const setElegidos = vi.fn();
  const visor = { proyecto: { edicion: { proyecto, editar } }, planta: "PL1", setPlanta() {}, seleccion: ids.at(-1), setSeleccion() {}, elegidos: ids, setElegidos, espacio: "modelo", modo: null, irA() {}, tablaPedida: null, pedirTabla() {} };
  render(
    <ContextoVisor.Provider value={visor as never}>
      <FichaAbacos ids={ids} />
    </ContextoVisor.Provider>,
  );
  return { editar, setElegidos };
}

const abacos = (o: Operacion) => (o as unknown as { objeto: { reticular: { abacos: number[][][] } } }).objeto.reticular.abacos;

describe("AC: Propiedades de un ábaco", () => {
  it("uno: a × b y su centro; ensancharlo hasta el de P7 los une y deja elegido el unido", () => {
    const { editar, setElegidos } = montar(["L2/A6"]);
    expect(screen.getByRole("region", { name: "Ábaco A6 de L2" })).toBeTruthy();
    const a = screen.getByLabelText("según los nervios") as HTMLInputElement;
    expect(a.value).toBe("2,4");
    expect((screen.getByLabelText("centro x") as HTMLInputElement).value).toBe("6");
    // 8 m centrado en x = 6: llega a x = 10, a 0,8 m del de P7 (10,8) → no se unen
    fireEvent.change(a, { target: { value: "8" } });
    fireEvent.blur(a);
    expect(editar).toHaveBeenCalledTimes(1);
    expect(abacos(editar.mock.calls[0]![0])[5]).toEqual([[2, 4.3], [10, 4.3], [10, 6.7], [2, 6.7]]);
    // 9,5 m: llega a 10,75, a 5 cm del de P7 → se unen, y lo elegido es el unido (y el de P5, que también pisa)
    fireEvent.change(a, { target: { value: "9,5" } });
    fireEvent.blur(a);
    expect(abacos(editar.mock.calls[1]![0])).toHaveLength(10);
    expect(setElegidos).toHaveBeenLastCalledWith(["L2/A5"]);
  });

  it("varios: «Unir» los deja en su rectángulo envolvente; «Borrar» los quita", () => {
    const { editar } = montar(["L2/A6", "L2/A7"]);
    fireEvent.click(screen.getByRole("button", { name: "Unir" }));
    expect(editar.mock.calls[0]![1]).toBe("Unir 2 ábacos de L2");
    expect(abacos(editar.mock.calls[0]![0])[5]).toEqual([[4.8, 4.3], [13.2, 4.3], [13.2, 6.7], [4.8, 6.7]]);
    fireEvent.click(screen.getByRole("button", { name: /Borrar/ }));
    expect(abacos(editar.mock.calls[1]![0])).toHaveLength(10);
  });
});
