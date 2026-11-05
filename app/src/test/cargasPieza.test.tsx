/**
 * Propiedades en Cargas (`pantallas/CargasPieza.tsx`): con una pieza elegida, sus cargas por caso
 * (con las cifras de `cargasPieza`) y añadirle una en el caso activo; sin nada, el caso en la planta.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { leerProyecto } from "../../../src/agente/proyecto.ts";
import { cargasPieza } from "../../../src/editor/cargasPieza.ts";
import type { Plantillas } from "../../../src/editor/dibujo/herramientas.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import { ContextoVisor } from "../contexto.ts";
import { fmt } from "../fmt.ts";
import { PropiedadesCargas, ResumenCaso } from "../pantallas/CargasPieza.tsx";

const RAIZ = join(__dirname, "..", "..", "..");
const leido = leerProyecto(readFileSync(join(RAIZ, ".claude", "skills", "fem", "ejemplo.json"), "utf8"));
if (!leido.valido) throw new Error("ejemplo no válido");
const proyecto = leido.proyecto;

function visor(seleccion: string | null) {
  const editar = vi.fn((_o: Operacion, _e: string) => ({ ok: true as const }));
  const v = {
    proyecto: { edicion: { proyecto, editar }, estado: { casos: proyecto.modelo.casos, resumen: null } },
    planta: "P1",
    setPlanta() {},
    seleccion,
    setSeleccion: vi.fn(),
    elegidos: seleccion ? [seleccion] : [],
    setElegidos() {},
    espacio: "cargas",
    modo: null,
    irA: vi.fn(),
    tablaPedida: null,
    pedirTabla() {},
  };
  return { v, editar };
}

describe("Propiedades en Cargas", () => {
  it("una losa: sus cargas por caso con su resultante, y el peso propio aparte, como lo del programa", () => {
    const { v } = visor("L-P1");
    render(
      <ContextoVisor.Provider value={v as never}>
        <PropiedadesCargas id="L-P1" caso="Q" plantillas={{ pilar: {}, viga: {}, cargas: { caso: "Q" } }} setPlantillas={() => {}} editar={() => null} />
      </ContextoVisor.Provider>,
    );
    const d = cargasPieza(proyecto.modelo, "L-P1")!;
    expect(screen.getByText("Forjado · sus cargas")).toBeTruthy();
    // Cada carga de cada caso, con su resultante hacia abajo
    for (const c of d.casos) for (const x of c.cargas) expect(screen.getByRole("button", { name: x.carga.id }).closest("tr")!.textContent).toContain(fmt(-x.F[2], 1));
    // El caso activo, marcado
    expect(screen.getByText("● Q", { selector: "h2 span" })).toBeTruthy();
    // CM: lo suyo, sin el peso propio, con su flecha (UI-2)
    const cm = d.casos.find((c) => c.caso === "CM")!;
    expect(screen.getByText(`↓ ${fmt(-cm.F[2], 1)} kN`)).toBeTruthy();
    // El peso propio, en su bloque y no en la tabla de G, que sólo lo lleva a él
    expect(screen.getByText("Peso propio · lo calcula el programa")).toBeTruthy();
    expect(document.querySelector("[data-peso-propio]")!.textContent).toContain(`↓ ${fmt(d.pesoPropio!.total!, 1)} kN`);
    expect(screen.getByText("sólo el peso propio")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Pasar/ })).toBeNull();
  });

  it("con cargas del usuario en el caso del peso propio: lo avisa y las pasa a CM en un paso", () => {
    const mezclado = { ...proyecto, modelo: { ...proyecto.modelo, cargas: proyecto.modelo.cargas!.map((c) => (c.caso === "CM" ? { ...c, caso: "G" } : c)) } };
    const editar = vi.fn((_o: Operacion, _e: string) => ({ ok: true as const }));
    const v = { ...visor("L-P1").v, proyecto: { edicion: { proyecto: mezclado, editar }, estado: { casos: mezclado.modelo.casos, resumen: null } } };
    render(
      <ContextoVisor.Provider value={v as never}>
        <PropiedadesCargas id="L-P1" caso="Q" plantillas={{ pilar: {}, viga: {}, cargas: { caso: "Q" } }} setPlantillas={() => {}} editar={() => null} />
      </ContextoVisor.Provider>,
    );
    expect(screen.getByText(/se mezclan con lo que calcula el programa/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pasar las 3 cargas a CM" }));
    expect(editar).toHaveBeenCalledTimes(1);
    const [op, etiqueta] = editar.mock.calls[0]!;
    expect(op).toMatchObject({ op: "lote" });
    expect(etiqueta).toBe("3 cargas de G a CM");
  });

  it("añadir en el caso activo: la plantilla de Superficie y un clic, una carga en toda la losa", () => {
    const { v } = visor("L-P1");
    const editar = vi.fn((_o: Operacion, _e: string) => null);
    let t: Plantillas = { pilar: {}, viga: {}, cargas: { caso: "Q" } };
    const montar = () => (
      <ContextoVisor.Provider value={v as never}>
        <PropiedadesCargas id="L-P1" caso="Q" plantillas={t} setPlantillas={(x) => (t = x)} editar={editar} />
      </ContextoVisor.Provider>
    );
    const r = render(montar());
    // Sin valor, no añade y dice por qué
    fireEvent.click(screen.getByRole("button", { name: "Añadir a L-P1" }));
    expect(editar).not.toHaveBeenCalled();
    expect(screen.getByText(/kN\/m²\)\./)).toBeTruthy();
    const q = screen.getByLabelText("q");
    fireEvent.change(q, { target: { value: "1,5" } });
    fireEvent.keyDown(q, { key: "Enter" });
    expect(t.cargas?.superficie?.q).toEqual([0, 0, -1.5]);
    r.rerender(montar());
    fireEvent.click(screen.getByRole("button", { name: "Añadir a L-P1" }));
    expect(editar).toHaveBeenCalledTimes(1);
    const [op, etiqueta] = editar.mock.calls[0]!;
    expect(op).toMatchObject({ op: "crear", coleccion: "cargas", objeto: { tipo: "superficie", planta: "P1", q: [0, 0, -1.5], losa: "L-P1", caso: "Q" } });
    expect(etiqueta).toMatch(/superficie en L-P1, Q/);
  });

  it("nada elegido: el caso activo en la planta, por tipo", () => {
    const { v } = visor(null);
    render(
      <ContextoVisor.Provider value={v as never}>
        <ResumenCaso caso="CM" />
      </ContextoVisor.Provider>,
    );
    expect(screen.getByText("Caso activo · nada elegido")).toBeTruthy();
    expect(screen.getByText("Superficie").closest("tr")!.textContent).toMatch(/^Superficie1/);
    expect(screen.getByText("Lineal").closest("tr")!.textContent).toMatch(/^Lineal1/);
  });

  it("nada elegido en el caso del peso propio: lo explica y lleva a CM", () => {
    const { v } = visor(null);
    const setCaso = vi.fn();
    render(
      <ContextoVisor.Provider value={v as never}>
        <ResumenCaso caso="G" setCaso={setCaso} />
      </ContextoVisor.Provider>,
    );
    expect(screen.getByText("El caso del peso propio")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ir a CM" }));
    expect(setCaso).toHaveBeenCalledWith("CM");
  });
});
