/**
 * El caso del peso propio, sólo del programa (2026-11-05):
 * - `sensatez/cargas-en-peso-propio` avisa de las cargas del usuario en él, y deja de avisar al
 *   pasarlas a cargas muertas (`separarPesoPropio`);
 * - la vista de cargas de ese caso dibuja el peso propio de forjados y vigas en gris, sin objeto (no
 *   se elige), con el pp del compilador (`ppLosa`); en los demás casos, nada;
 * - separadas, las combinaciones dan lo mismo (a la precisión de máquina) en la vivienda.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ModeloFisico } from "../compilador/fisico.ts";
import { separarPesoPropio } from "../editor/casos.ts";
import { proyectoNuevo } from "../editor/plantilla.ts";
import { aplicar } from "../editor/operaciones.ts";
import { vistaCargas } from "./render/modelo.ts";
import { ppLosa, sensatezPrevia } from "./sensatez.ts";

const modelo = (): ModeloFisico => ({
  ...proyectoNuevo().modelo,
  secciones: [
    { id: "P30", forma: "rectangular", b: 0.3, h: 0.3, material: "HA-30" },
    { id: "V30", forma: "rectangular", b: 0.3, h: 0.5, material: "HA-30" },
  ],
  pilares: [
    { id: "P1", x: 0, y: 0, desde: "Cim", hasta: "N1", seccion: "P30" },
    { id: "P2", x: 5, y: 0, desde: "Cim", hasta: "N1", seccion: "P30" },
  ],
  vigas: [{ id: "V1", planta: "N1", puntos: [[0, 0], [5, 0]], seccion: "V30" }],
  losas: [{ id: "L1", planta: "N1", contorno: [[0, 0], [5, 0], [5, 4], [0, 4]], espesor: 0.25, material: "HA-30" }],
  cargas: [
    { tipo: "superficie", id: "G-1", caso: "G", planta: "N1", losa: "L1", q: [0, 0, -1.5] },
    { tipo: "superficie", id: "Q-1", caso: "Q", planta: "N1", losa: "L1", q: [0, 0, -2] },
  ],
});

const aviso = (f: ModeloFisico) => sensatezPrevia(f).find((c) => c.codigo === "sensatez/cargas-en-peso-propio")!;

describe("el caso del peso propio, sólo del programa", () => {
  it("avisa de las cargas del usuario en él, y no tras pasarlas a cargas muertas", () => {
    const f = modelo();
    const c = aviso(f);
    expect(c.estado).toBe("avisos");
    expect(c.avisos[0]!.ids).toEqual(["G", "G-1"]);
    const r = separarPesoPropio(f);
    if (!r.ok) throw new Error(r.mensaje);
    const a = aplicar({ ...proyectoNuevo(), modelo: f }, r.operacion);
    if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join("\n"));
    expect(aviso(a.proyecto.modelo).estado).toBe("bien");
  });

  it("la vista de cargas del caso del peso propio lo dibuja en gris y sin objeto; las demás, no", () => {
    const f = modelo();
    const d = { huella: "0".repeat(64) };
    const e = vistaCargas(f, "N1", "G", d);
    const pp = e.primitivas.filter((p) => p.tipo !== "texto" && (p.estilo === "peso-propio" || p.estilo === "peso-propio-linea"));
    expect(pp.map((p) => p.tipo).sort()).toEqual(["linea", "poligono"]);
    for (const p of pp) expect("objeto" in p && p.objeto).toBeFalsy();
    const { pp: q } = ppLosa(f.losas![0]!, f.materiales[0]!);
    const textos = e.primitivas.flatMap((p) => (p.tipo === "texto" ? [p.texto] : []));
    expect(textos).toContain(`pp ↓ ${String(q).replace(".", ",")} kN/m²`);
    expect(textos).toContain("pp ↓ 3,75 kN/m");
    expect(e.leyenda.some((x) => x.estilo === "peso-propio")).toBe(true);
    // La carga del usuario sigue con su objeto
    expect(e.primitivas.some((p) => p.tipo === "poligono" && p.objeto === "G-1")).toBe(true);
    const otra = vistaCargas(f, "N1", "Q", d);
    expect(otra.primitivas.some((p) => p.tipo !== "texto" && p.estilo.startsWith("peso-propio"))).toBe(false);
  });

  it("la vivienda tiene sus cargas permanentes aparte del peso propio, con la misma acción", () => {
    const f = (JSON.parse(readFileSync(new URL("../../ejemplos/vivienda/proyecto.json", import.meta.url), "utf8")) as { modelo: ModeloFisico }).modelo;
    expect(aviso(f).estado).toBe("bien");
    const g = f.casos.find((c) => c.pesoPropio)!;
    const cm = f.casos.find((c) => c.id === "CM")!;
    expect(cm.accion).toEqual(g.accion);
  });
});
