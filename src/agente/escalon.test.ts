/**
 * MA5 (`docs/fem3d/modelado.md` §2.5 y §8): el escalón de cubierta (`"tipo": "escalon"`). La vivienda
 * tiene una «planta» de 0,90 m entre sus dos cubiertas: sin el tipo, `sensatez/altura` avisa en cada
 * validación; con él (como va el ejemplo desde MA5), no. Una altura nula o negativa sigue avisando, y el cálculo no cambia.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compilar } from "../compilador/compilar.ts";
import type { ModeloFisico } from "../compilador/fisico.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { leerProyecto } from "./proyecto.ts";
import { sensatezPrevia } from "./sensatez.ts";

const vivienda = (): ModeloFisico => {
  const r = leerProyecto(readFileSync(join(import.meta.dirname, "..", "..", "ejemplos", "vivienda", "proyecto.json"), "utf8"));
  if (!r.valido) throw new Error("la vivienda no es válida");
  return r.proyecto.modelo;
};
const avisosAltura = (f: ModeloFisico) => sensatezPrevia(f).find((c) => c.codigo === "sensatez/altura")!.avisos;
const conTipo = (f: ModeloFisico, id: string, tipo: "escalon" | undefined, altura?: number): ModeloFisico => ({
  ...f,
  plantas: f.plantas.map((p) => (p.id === id ? { ...p, tipo } : p)).map((p, i, ps) => (altura !== undefined && ps[i - 1]?.id === id ? { ...p, altura } : p)),
});

describe("MA5: el escalón de cubierta", () => {
  it("la vivienda, con CUB-S como escalón, no avisa del tramo de 0,90 m entre sus cubiertas; sin el tipo, sí", () => {
    const f = vivienda();
    expect(f.plantas.find((p) => p.id === "CUB-S")!.tipo).toBe("escalon");
    expect(avisosAltura(f)).toEqual([]);
    expect(avisosAltura(conTipo(f, "CUB-S", undefined)).map((a) => a.ids)).toEqual([["CUB"]]);
  });

  it("una altura nula o negativa hasta el escalón sigue avisando", () => {
    const f = conTipo(vivienda(), "CUB-S", "escalon", 0.0);
    expect(avisosAltura(f).map((a) => a.ids)).toEqual([["CUB"]]);
  });

  it("el cálculo no cambia: el mismo modelo analítico", () => {
    const f = vivienda();
    expect(JSON.stringify(valido(compilar(conTipo(f, "CUB-S", undefined))).modelo)).toBe(JSON.stringify(valido(compilar(f)).modelo));
  });
});
