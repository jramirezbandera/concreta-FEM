/**
 * El registro de la propuesta de armado (`registroProceso.ts`) y su pestaña «Proceso»: una línea por
 * tipo y por fase, con sus cuentas y sus tiempos, y el final.
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ProgresoTarea } from "../../../src/visor/comprobaciones.ts";
import { Proceso } from "../componentes/Proceso.tsx";
import { duracion, RegistroProceso, reloj } from "../sesion/registroProceso.ts";

const paso = (tipo: ProgresoTarea["tipo"], fase: string, hecho: number, total: number, parte: number, mas: Partial<ProgresoTarea> = {}): ProgresoTarea => ({ tipo, fase, hecho, total, parte, partes: 2, ...mas }) as ProgresoTarea;

describe("el registro del proceso", () => {
  it("los tiempos, en palabras", () => {
    expect(duracion(400)).toBe("menos de 1 s");
    expect(duracion(12_300)).toBe("12 s");
    expect(duracion(65_000)).toBe("1 min 05 s");
    expect(reloj(205_000)).toBe("03:25");
  });

  it("una línea por tipo y por fase, no por pieza; el tipo acabado y el final con el total", () => {
    const r = new RegistroProceso();
    let avisos = 0;
    r.alCambiar(() => avisos++);
    r.empezar("Proponiendo el armado", "Lo que falta · pilares, vigas", 1000);
    for (let k = 1; k <= 80; k++) r.avance(paso("pilares", "demandas", k, 80, 1, { pieza: `P${k}` }), 1000 + 100 * k);
    r.avance(paso("pilares", "reglas de obra", 3, 0, 1), 10_000);
    r.avance(paso("pilares", "hecho", 1, 1, 1), 12_000);
    r.avance(paso("vigas", "demandas", 1, 40, 2, { unidad: "vanos" }), 12_500);
    r.avance(paso("vigas", "demandas", 40, 40, 2, { unidad: "vanos" }), 75_000);
    expect(r.abierta()?.avance.hecho).toBe(40);
    r.avance(paso("vigas", "hecho", 1, 1, 2), 76_000);
    r.anotar("aviso", "Sin propuesta · V3/1: la sección no basta", 76_000);
    r.acabar("fin", "Armado propuesto.", 77_000);

    const e = r.estado();
    expect(e.enMarcha).toBe(false);
    expect(e.duracion).toBe(76_000);
    expect(e.lineas.map((l) => `${l.clase}|${l.texto}`)).toEqual([
      "inicio|Lo que falta · pilares, vigas",
      "tipo|1 de 2 · Pilares",
      "fase|demandas · 80 pilares · 9 s",
      "fase|reglas de obra · 3 ajustes · 2 s",
      "hecho|Pilares: propuesto y comprobado en 11 s. Ya se puede ver en su pestaña.",
      "tipo|2 de 2 · Vigas",
      "fase|demandas · 40 vanos · 1 min 04 s",
      "hecho|Vigas: propuesto y comprobado en 1 min 04 s. Ya se puede ver en su pestaña.",
      "aviso|Sin propuesta · V3/1: la sección no basta",
      "fin|Armado propuesto. Tiempo total: 1 min 16 s.",
    ]);
    // (los 80 avisos de pieza de una fase no avisan a quien mira: sólo las líneas)
    expect(avisos).toBeLessThan(15);
    // Acabado, lo que llegue tarde no se anota; el siguiente proceso empieza de cero
    r.avance(paso("vigas", "demandas", 1, 40, 2), 80_000);
    r.acabar("aviso", "Interrumpido.", 80_000);
    expect(r.estado().lineas).toHaveLength(10);
    r.empezar("Proponiendo el armado", "Todo · losas", 90_000);
    expect(r.estado().lineas).toHaveLength(1);
    expect(r.estado().enMarcha).toBe(true);
  });

  it("la pestaña: vacía, en marcha y acabada", () => {
    const r = new RegistroProceso();
    render(<Proceso cliente={null} registro={r} />);
    expect(document.querySelector("[data-proceso-vacio]")).not.toBeNull();
    act(() => {
      r.empezar("Proponiendo el armado", "Lo que falta · pilares");
      r.avance(paso("pilares", "demandas", 1, 80, 1));
    });
    expect(document.querySelector("[data-proceso]")?.getAttribute("data-proceso")).toBe("en-marcha");
    expect(screen.getByText("1 de 2 · Pilares")).toBeTruthy();
    act(() => r.acabar("error", "El proyecto cambió."));
    expect(document.querySelector("[data-proceso]")?.getAttribute("data-proceso")).toBe("acabado");
    expect(screen.getByText(/El proyecto cambió\. Tiempo total/)).toBeTruthy();
  });
});
