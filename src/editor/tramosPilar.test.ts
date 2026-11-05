/**
 * Los tramos de un pilar en Propiedades (2026-11-05): `tramosPilar` lee los de una fila de Pilares
 * como el compilador (por la planta de su cabeza; los demás, con la sección del pilar) y `textoTramos`
 * escribe la celda con uno cambiado, que la tabla vuelve a leer y el compilador acepta.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { leerProyecto } from "../agente/proyecto.ts";
import { compilar } from "../compilador/compilar.ts";
import type { ModeloFisico, Pilar } from "../compilador/fisico.ts";
import { textoTramos, tramosPilar } from "./ficha.ts";
import { contexto, DEF_TABLAS, filaConValor } from "./tablas.ts";
import { operacionFila } from "./edicion.ts";
import type { Fila } from "./celdas.ts";

const leido = leerProyecto(readFileSync(join(__dirname, "..", "..", "ejemplos", "muestrario", "proyecto.json"), "utf8"));
if (!leido.valido) throw new Error("muestrario no válido");
/** El muestrario con una sección de acero para los tramos de arriba. */
const modelo: ModeloFisico = {
  ...leido.proyecto.modelo,
  materiales: [...leido.proyecto.modelo.materiales, { id: "S275", tipo: "acero" }],
  secciones: [...leido.proyecto.modelo.secciones, { id: "HEB200", material: "S275", forma: "general", A: 7.81e-3, Iy: 5.696e-5, Iz: 2.003e-5, J: 5.93e-7, b: 0.2, h: 0.2 }],
};
const ctx = contexto(modelo);
const def = DEF_TABLAS.pilares;
const fila = (id: string) => def.fila(modelo.pilares!.find((p) => p.id === id)! as never, ctx);

describe("los tramos de un pilar", () => {
  it("de la cabeza a la base, con su altura y la sección que llevan", () => {
    // P6: de CIM a CUB, P30x30 salvo el tramo con la cabeza en PB (P40x40)
    const t = tramosPilar(fila("P6"), ctx)!;
    expect(t.fuera).toEqual([]);
    expect(t.tramos.map((x) => [x.base, x.cabeza, x.seccion, x.propia])).toEqual([
      ["PL1", "CUB", "P30x30", false],
      ["PB", "PL1", "P30x30", false],
      ["CIM", "PB", "P40x40", true],
    ]);
    const plantas = modelo.plantas;
    // La altura de un tramo es la de la planta de su base (de forjado a forjado hasta la de encima)
    for (const x of t.tramos) expect(x.altura).toBeCloseTo(plantas.find((p) => p.id === x.base)!.altura!, 9);
    // La regla del compilador (`seccionTramo` de topologia.ts)
    const p = modelo.pilares!.find((x) => x.id === "P6")!;
    for (const x of t.tramos) expect(p.tramos?.find((y) => y.planta === x.cabeza)?.seccion ?? p.seccion).toBe(x.seccion);
  });

  it("cambiar uno escribe la celda que la tabla lee, sólo con los que no son la del pilar", () => {
    const f = fila("P6");
    const t = tramosPilar(f, ctx)!;
    expect(textoTramos(t, f.seccion!, { CUB: "HEB200" })).toBe("CUB: HEB200; PB: P40x40");
    // Volver a la del pilar lo quita
    expect(textoTramos(t, f.seccion!, { PB: "P30x30" })).toBe("");
    // «Y los de encima» desde PB–PL1: los dos de arriba
    expect(textoTramos(t, f.seccion!, { PL1: "HEB200", CUB: "HEB200" })).toBe("CUB: HEB200; PL1: HEB200; PB: P40x40");
    const nueva = filaConValor(def, f, "tramos", textoTramos(t, f.seccion!, { CUB: "HEB200" }));
    const op = operacionFila(modelo, "pilares", "P6", nueva);
    expect(op.ok).toBe(true);
    if (!op.ok || op.operacion.op !== "cambiar") return;
    const p = op.operacion.objeto as unknown as Pilar;
    expect(p.tramos).toEqual([
      { planta: "CUB", seccion: "HEB200" },
      { planta: "PB", seccion: "P40x40" },
    ]);
    // El compilador lo acepta: un pilar de hormigón abajo y de acero arriba
    const r = compilar({ ...modelo, pilares: modelo.pilares!.map((x) => (x.id === "P6" ? p : x)) });
    expect(r.diagnosticos.filter((d) => d.severidad === "error")).toEqual([]);
  });

  it("lo que no es de ningún tramo se dice y se conserva hasta que se quita", () => {
    const f: Fila = { ...fila("P1"), tramos: "CIM: P30x30; PL1: P30x30" };
    // P1: de PB a CUB; CIM no es la cabeza de ninguno de sus tramos
    const t = tramosPilar(f, ctx)!;
    expect(t.tramos.map((x) => x.cabeza)).toEqual(["CUB", "PL1"]);
    expect(t.fuera).toEqual([{ planta: "CIM", seccion: "P30x30" }]);
    expect(textoTramos(t, f.seccion!, { CUB: "HEB200" })).toBe("CUB: HEB200; PL1: P30x30; CIM: P30x30");
    expect(textoTramos(t, f.seccion!, {}, true)).toBe("PL1: P30x30");
  });

  it("sin arranque y cabeza que se lean, o con la celda mal escrita, no hay lista", () => {
    expect(tramosPilar({ ...fila("P6"), desde: "" }, ctx)).toBeNull();
    expect(tramosPilar({ ...fila("P6"), desde: "CUB", hasta: "CIM" }, ctx)).toBeNull();
    expect(tramosPilar({ ...fila("P6"), tramos: "PB P40x40" }, ctx)).toBeNull();
  });
});
