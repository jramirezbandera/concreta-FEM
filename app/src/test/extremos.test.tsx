/**
 * Los extremos de una viga o una barra con sus esfuerzos (`pantallas/Extremos.tsx`, VS-o): cada fila,
 * el valor del extremo en negrita y los demás esfuerzos de su combinación en ese punto; con el sismo
 * del programa, la «±». Los números son los de `fem consultar pieza`, sin cuentas en la pantalla.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Extremo } from "../../../src/agente/consultas.ts";
import { COLUMNAS_BARRA, COLUMNAS_VANO, FILAS_BARRA, FILAS_VANO, TablaExtremos } from "../pantallas/Extremos.tsx";
import { TITULO_PESIMOS } from "../pantallas/Ternas.tsx";

const ext = (v: number, esfuerzos: number[], pesimos = false): Extremo => ({ v, s: 2.5, comb: "1,00·G + EX+e", esfuerzos, ...(pesimos ? { pesimos: true as const } : {}) });

describe("la tabla de extremos", () => {
  it("un vano: cada extremo con su Vz, su T y su My; el suyo, en negrita; con el sismo, «±»", () => {
    const extremos: Record<string, Extremo> = {
      "My+": ext(41.2, [0, 0, 3.1, 0.7, 41.2, 0], true),
      "My-": ext(-63.4, [0, 0, -52.6, -1.9, -63.4, 0], true),
      Vz: ext(-55.3, [0, 0, -55.3, -2.4, -60.1, 0], true),
      T: ext(-3.2, [0, 0, -48.0, -3.2, -40.2, 0]),
    };
    render(<TablaExtremos grupos={[{ titulo: "Vano 1", extremos }]} filas={FILAS_VANO} columnas={COLUMNAS_VANO} />);
    const fila = (k: string) => document.querySelector(`tr[data-extremo="${k}"]`) as HTMLElement;
    const celdas = (k: string) => Array.from(fila(k).querySelectorAll("td")).map((td) => td.textContent);
    expect(celdas("My-").slice(1)).toEqual(["−52,6", "−1,9", "−63,4"]);
    expect(celdas("T").slice(1)).toEqual(["−48,0", "−3,2", "−40,2"]);
    // el del extremo, en negrita, en su columna
    expect(within(fila("Vz")).getByText("−55,3").tagName).toBe("B");
    expect(within(fila("My+")).getByText("41,2").tagName).toBe("B");
    // la marca de los pésimos, sólo en las filas con el sismo del programa
    expect(within(fila("My+")).getByTitle(TITULO_PESIMOS)).toBeTruthy();
    expect(within(fila("T")).queryByTitle(TITULO_PESIMOS)).toBeNull();
    expect(screen.getByText("Vano 1")).toBeTruthy();
  });

  it("una barra: N con los cortantes y los momentos; sin un extremo, «—»", () => {
    const extremos: Record<string, Extremo> = { "N-": ext(-120.5, [-120.5, 0.2, 1.5, 0, 3.4, -0.8]) };
    render(<TablaExtremos grupos={[{ extremos }]} filas={FILAS_BARRA} columnas={COLUMNAS_BARRA} />);
    const tds = (k: string) => Array.from(document.querySelector(`tr[data-extremo="${k}"]`)!.querySelectorAll("td")).map((td) => td.textContent);
    expect(tds("N-").slice(1)).toEqual(["−120,5", "1,5", "3,4", "−0,8"]);
    expect(tds("Mz").slice(1)).toEqual(["—", "—", "—", "—"]);
  });
});
