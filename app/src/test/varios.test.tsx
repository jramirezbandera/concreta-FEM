/**
 * Editar varios objetos a la vez en Propiedades (`FormularioVarios`, `src/editor/varios.ts`): lo
 * común se ve, lo distinto dice «varios», y un cambio va a todos en una sola edición.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { leerProyecto } from "../../../src/agente/proyecto.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import { objetosTabla } from "../../../src/editor/tablas.ts";
import { ContextoVisor } from "../contexto.ts";
import { FormularioVarios } from "../editor/Formulario.tsx";

const RAIZ = join(__dirname, "..", "..", "..");
const leido = leerProyecto(readFileSync(join(RAIZ, ".claude", "skills", "fem", "ejemplo.json"), "utf8"));
if (!leido.valido) throw new Error("ejemplo no válido");
const proyecto = leido.proyecto;

function montar(ids: string[]) {
  const editar = vi.fn((_o: Operacion, _e: string) => ({ ok: true as const }));
  const visor = { proyecto: { edicion: { proyecto, editar } }, planta: null, setPlanta() {}, seleccion: null, setSeleccion() {}, elegidos: ids, setElegidos() {}, espacio: "modelo", modo: null, irA() {}, tablaPedida: null, pedirTabla() {} };
  render(
    <ContextoVisor.Provider value={visor as never}>
      <FormularioVarios ids={ids} tabla="pilares" />
    </ContextoVisor.Provider>,
  );
  return editar;
}

describe("Propiedades con varios elegidos", () => {
  const pilares = objetosTabla(proyecto.modelo, "pilares");
  const ids = pilares.map((p) => p.id);

  it("sin el id; lo distinto, «varios»; y un cambio, una sola edición para todos", () => {
    expect(ids.length).toBeGreaterThan(1);
    const editar = montar(ids);
    expect(screen.queryByLabelText("id")).toBeNull();
    // x no es la misma en todos
    const x = screen.getByLabelText("x") as HTMLInputElement;
    expect(x.value).toBe("");
    expect(x.placeholder).toBe("(varios)");
    // Dejar vacío un campo «varios» no toca nada
    fireEvent.blur(x);
    expect(editar).not.toHaveBeenCalled();
    const giro = screen.getByLabelText("giro") as HTMLInputElement;
    fireEvent.change(giro, { target: { value: "45" } });
    fireEvent.keyDown(giro, { key: "Enter" });
    expect(editar).toHaveBeenCalledTimes(1);
    const [op, etiqueta] = editar.mock.calls[0]!;
    expect(etiqueta).toMatch(new RegExp(`^${ids.length} pilares · giro = 45$`));
    const ops = op.op === "lote" ? op.operaciones : [op];
    expect(ops.map((o) => (o.op === "cambiar" ? o.id : "?")).sort()).toEqual([...ids].sort());
  });
});
