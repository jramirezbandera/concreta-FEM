/**
 * VS4 · DOM: la ficha «Viento y sismo» con el emplazamiento común (de la prueba de uso del
 * 2026-11-07): la provincia da la zona eólica del viento y el municipio, ab y K del sismo; un fichero
 * de antes (el municipio en el sismo, la altitud en el viento) pasa al emplazamiento al aplicar sin
 * cambiar lo que se calcula; cada campo lleva su «?».
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

function montar(acciones: AccionesEdificio | undefined, pestana: "viento" | "sismo" = "viento") {
  const proyecto: Proyecto = { ...base, modelo: { ...base.modelo, acciones } };
  const editar = vi.fn((_o: Operacion, _e: string) => ({ ok: true as const }));
  const onCerrar = vi.fn();
  const visor = { proyecto: { edicion: { proyecto, editar }, cliente: null }, planta: "PL1", setPlanta() {}, seleccion: undefined, setSeleccion() {}, elegidos: [], setElegidos() {}, espacio: "cargas", modo: null, irA() {}, tablaPedida: null, pedirTabla() {} };
  render(
    <ContextoVisor.Provider value={visor as never}>
      <FichaAcciones pestana={pestana} onCerrar={onCerrar} />
    </ContextoVisor.Provider>,
  );
  const escrito = () => (editar.mock.calls.at(-1)![0] as unknown as { acciones: AccionesEdificio | null }).acciones;
  return { editar, escrito, onCerrar };
}

const aplicar = () => fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

describe("VS4: el emplazamiento común en la ficha «Viento y sismo»", () => {
  it("un fichero de antes: el municipio del sismo y la altitud del viento pasan al emplazamiento", () => {
    const { escrito } = montar({ viento: { zona: "A", aspereza: "IV", altitud: 50 }, sismo: { ine: "29008", municipio: "Alhaurín el Grande", terreno: "II", mu: 2 } });
    expect(screen.getByText("Alhaurín el Grande")).toBeTruthy();
    expect((screen.getByLabelText("Provincia") as HTMLSelectElement).value).toBe("29");
    expect((screen.getByLabelText("Altitud") as HTMLInputElement).value).toBe("50");
    expect(screen.getByText(/ab = 0,08 g · K = 1,0/)).toBeTruthy();
    aplicar();
    // La zona A es la de Málaga: queda como «la de la provincia», sin escribirla
    expect(escrito()).toEqual({
      emplazamiento: { ine: "29008", municipio: "Alhaurín el Grande", altitud: 50 },
      viento: { aspereza: "IV" },
      sismo: { terreno: "II", mu: 2 },
    });
  });

  it("la provincia da la zona eólica; forzada, se escribe", () => {
    const { escrito } = montar(undefined);
    fireEvent.change(screen.getByLabelText("Provincia"), { target: { value: "11" } });
    expect(screen.getByText(/C · qb = 0,52 kN\/m²/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Viento del programa/ }));
    expect((screen.getByLabelText(/Zona eólica/, { selector: "select" }) as HTMLSelectElement).selectedOptions[0]!.textContent).toMatch(/La de la provincia: C/);
    aplicar();
    expect(escrito()).toEqual({ emplazamiento: { provincia: "11" }, viento: { aspereza: "IV" } });
    fireEvent.change(screen.getByLabelText(/Zona eólica/, { selector: "select" }), { target: { value: "B" } });
    expect(screen.getByText("la de Cádiz es C")).toBeTruthy();
    aplicar();
    expect(escrito()).toEqual({ emplazamiento: { provincia: "11" }, viento: { aspereza: "IV", zona: "B" } });
  });

  it("sin provincia ni zona, el viento no se aplica y lo dice", () => {
    const { editar } = montar(undefined);
    fireEvent.click(screen.getByRole("checkbox", { name: /Viento del programa/ }));
    expect(screen.getByText(/El viento necesita la provincia del emplazamiento/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Aplicar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(editar).not.toHaveBeenCalled();
  });

  it("el buscador: los de la provincia primero, los de otras detrás; elegir uno fija la provincia", () => {
    const { escrito } = montar(undefined, "sismo");
    fireEvent.change(screen.getByLabelText("Provincia"), { target: { value: "18" } });
    fireEvent.change(screen.getByLabelText("Buscar municipio"), { target: { value: "alhaur" } });
    expect(screen.getByText("En otras provincias")).toBeTruthy();
    const lista = screen.getByRole("listbox", { name: "Municipios del Anejo 1" });
    fireEvent.click(within(lista).getByRole("option", { name: /Alhaurín el Grande/ }));
    expect((screen.getByLabelText("Provincia") as HTMLSelectElement).value).toBe("29");
    fireEvent.click(screen.getByRole("checkbox", { name: /Sismo \(NCSE-02\)/ }));
    aplicar();
    expect(escrito()).toEqual({ emplazamiento: { ine: "29008", municipio: "Alhaurín el Grande" }, sismo: { terreno: "II", mu: 2 } });
  });

  it("un municipio que no figura, sólo con su nombre: el sismo pide ab y K", () => {
    const { escrito } = montar(undefined, "sismo");
    fireEvent.change(screen.getByLabelText("Provincia"), { target: { value: "29" } });
    fireEvent.change(screen.getByLabelText("Buscar municipio"), { target: { value: "Pueblo inventado" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardarlo sólo con su nombre/ }));
    expect(screen.getByText(/no figura en el Anejo 1$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Sismo \(NCSE-02\)/ }));
    fireEvent.change(screen.getByLabelText(/ab escrita/), { target: { value: "0,05" } });
    expect(screen.getByText(/hace falta también K/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/K escrito/), { target: { value: "1" } });
    aplicar();
    expect(escrito()).toEqual({ emplazamiento: { provincia: "29", municipio: "Pueblo inventado" }, sismo: { ab: 0.05, K: 1, terreno: "II", mu: 2 } });
  });

  it("cada campo lleva su «?»", () => {
    montar({ emplazamiento: { provincia: "29" }, viento: { aspereza: "IV" }, sismo: { terreno: "II", mu: 2 } });
    // Emplazamiento (3) y viento (4)
    expect(screen.getAllByRole("button", { name: "Ayuda" })).toHaveLength(7);
    fireEvent.click(screen.getByRole("tab", { name: "Sismo" }));
    // Emplazamiento (3) y sismo (10, con la nieve)
    expect(screen.getAllByRole("button", { name: "Ayuda" })).toHaveLength(13);
  });
});
