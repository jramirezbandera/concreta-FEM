/**
 * Fase DN3 (`docs/fem3d/desniveles.md` §10): el desnivel en la capa de agente.
 * - `fem resumen` da el desnivel de cada forjado que lo tiene, y no lo escribe si no.
 * - Lo que dice la skill: la regla del enrase por abajo (Δ_otro − canto_otro + canto_este) es la de
 *   «Enrasar» del editor, y el escalón da error sin solape, aviso por debajo de medio canto y nada
 *   por encima, con el ejemplo de la skill partido en dos losas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compilar } from "../compilador/compilar.ts";
import type { ModeloFisico } from "../compilador/fisico.ts";
import { desnivelEnrasado } from "../editor/desnivel.ts";
import { resumen } from "./consultas.ts";
import { VERSION_ESQUEMA } from "./proyecto.ts";

const EJEMPLO = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", ".claude", "skills", "fem", "ejemplo.json"), "utf8")) as { modelo: ModeloFisico };

/** El ejemplo de la skill con la losa de P1 partida en x = 3 y la mitad de x > 3 con `desnivel`. */
function terraza(desnivel: number | undefined, espesorB = 0.2): ModeloFisico {
  const m = structuredClone(EJEMPLO.modelo) as ModeloFisico & { losas: NonNullable<ModeloFisico["losas"]>; cargas: NonNullable<ModeloFisico["cargas"]> };
  const lp1 = m.losas.find((l) => l.id === "L-P1")!;
  m.losas = [
    ...m.losas.filter((l) => l !== lp1),
    { ...lp1, id: "LA", contorno: [[0, 0], [3, 0], [3, 5], [0, 5]] },
    { ...lp1, id: "LB", contorno: [[3, 0], [6, 0], [6, 5], [3, 5]], espesor: espesorB, ...(desnivel === undefined ? {} : { desnivel }) },
  ];
  m.cargas = m.cargas.map((c) => {
    if (c.tipo !== "superficie" || c.losa !== "L-P1") return c;
    const { losa: _, ...resto } = c;
    return { ...resto, zona: [[0, 0], [6, 0], [6, 5], [0, 5]] };
  });
  return m;
}

const codigos = (f: ModeloFisico) => {
  const c = compilar(f);
  return { valido: c.valido, codigos: c.diagnosticos.map((d) => d.codigo).filter((k) => k.startsWith("losa/escalon")), c };
};

describe("DN3: fem resumen", () => {
  it("da el desnivel del forjado que lo tiene, y sólo de ése", () => {
    const f = terraza(-0.05);
    const { c } = codigos(f);
    if (!c.valido) throw new Error("no compila");
    const r = resumen({ esquema: VERSION_ESQUEMA, modelo: f }, c);
    if (!r.valido) throw new Error("sin resumen");
    const losas = r.valor.plantas.find((p) => p.id === "P1")!.losas!;
    expect(losas.find((l) => l.id === "LB")!.desnivel).toBe(-0.05);
    expect("desnivel" in losas.find((l) => l.id === "LA")!).toBe(false);
  });

  it("sin desniveles, el resumen no cambia", () => {
    const f = EJEMPLO.modelo;
    const c = compilar(f);
    if (!c.valido) throw new Error("no compila");
    const r = resumen({ esquema: VERSION_ESQUEMA, modelo: f }, c);
    if (!r.valido) throw new Error("sin resumen");
    expect(JSON.stringify(r.valor)).not.toContain("desnivel");
  });
});

describe("DN3: lo que dice la skill", () => {
  it("el enrase por abajo es Δ_otro − canto_otro + canto_este, como «Enrasar»", () => {
    // La maciza de 20 (LB) junto a un forjado de 30 (LA) a la cota: −0,10.
    const f = terraza(undefined, 0.2);
    const la = f.losas!.find((l) => l.id === "LA")! as { espesor: number };
    la.espesor = 0.3;
    const r = desnivelEnrasado(f, "LB", "LA", "abajo");
    expect(r.ok && r.desnivel).toBeCloseTo(0 - 0.3 + 0.2, 12);
  });

  it("el escalón: error sin solape, aviso por debajo de medio canto, nada por encima", () => {
    expect(codigos(terraza(-0.05))).toMatchObject({ valido: true, codigos: [] });
    expect(codigos(terraza(-0.12))).toMatchObject({ valido: true, codigos: ["losa/escalon-solape-corto"] });
    expect(codigos(terraza(-0.25))).toMatchObject({ valido: false, codigos: ["losa/escalon-sin-apoyo"] });
  });
});
