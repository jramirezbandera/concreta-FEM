// Test del predicado puro debeIgnorarEscColocacion (UX-C11). Node/jsdom-agnostico:
// no toca R3F ni stores. Cubre la regla de coordinacion del Esc entre las herramientas
// de introduccion (Colocacion*) y los dialogos.
import { describe, it, expect } from "vitest";
import { debeIgnorarEscColocacion } from "./escColocacion";

describe("debeIgnorarEscColocacion (UX-C11)", () => {
  it("NO ignora el Esc cuando no fue consumido y no hay dialogo abierto", () => {
    // Caso normal: el Esc debe cancelar el punto pendiente / salir de la herramienta.
    expect(debeIgnorarEscColocacion(false, null)).toBe(false);
  });

  it("ignora el Esc si otro handler ya lo consumio (defaultPrevented)", () => {
    // p. ej. un CampoNumero/CampoTexto que revierte su edicion con Esc (preventDefault).
    expect(debeIgnorarEscColocacion(true, null)).toBe(true);
  });

  it("ignora el Esc si hay un dialogo abierto (dialogoActivo != null)", () => {
    // Cerrar un dialogo con Esc no debe ademas cancelar la colocacion.
    expect(debeIgnorarEscColocacion(false, "plantas")).toBe(true);
    expect(debeIgnorarEscColocacion(false, "hipotesis")).toBe(true);
  });

  it("ignora el Esc si se dan ambas condiciones", () => {
    expect(debeIgnorarEscColocacion(true, "plantas")).toBe(true);
  });
});
