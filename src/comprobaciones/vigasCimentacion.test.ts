/**
 * Las vigas sobre una losa de cimentación (LC-g) no tienen flecha que comprobar: apoyan en el terreno
 * por los muelles de su eje. Un vano entero sobre la losa no la pide (ni queda pendiente: cumple con lo
 * demás) y lleva una fila informativa; uno que sale de la losa la sigue pidiendo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compilar } from "../compilador/compilar.ts";
import { Consultas } from "../compilador/consultas.ts";
import type { ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { proponerVano } from "./armar/vigas.ts";
import { demandasViga, sobreCimentacion, type DemandasViga } from "./demandas/vigas.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const rect = (a: number, b: number): Vec2[] => [
  [0, 0],
  [a, 0],
  [a, b],
  [0, b],
];

/** Losa de cimentación de 10 × 6 en C, dos pilares hasta P1 y una viga de atado entre ellos (o hasta `fin`). */
function modelo(fin: Vec2 = [8, 3]): ModeloFisico {
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "C", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 30 }],
    secciones: [
      { id: "p30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v40", material: "H", forma: "rectangular", b: 0.4, h: 0.8 },
    ],
    losas: [{ id: "L", planta: "C", contorno: rect(10, 6), espesor: 0.5, material: "H", cimentacion: { balasto: 40000 } }],
    pilares: [
      { id: "A1", x: 2, y: 3, desde: "C", hasta: "P1", seccion: "p30" },
      { id: "A2", x: 8, y: 3, desde: "C", hasta: "P1", seccion: "p30" },
    ],
    vigas: [{ id: "V1", planta: "C", puntos: [[2, 3], fin], seccion: "v40" }],
    casos: [
      { id: "G", pesoPropio: true, accion: { tipo: "G" } },
      { id: "Q", accion: { tipo: "Q", psi: "uso-A" } },
    ],
    cargas: [
      { tipo: "puntual", id: "F1", caso: "G", planta: "P1", x: 2, y: 3, F: [0, 0, -800] },
      { tipo: "puntual", id: "F2", caso: "G", planta: "P1", x: 8, y: 3, F: [0, 0, -500] },
      { tipo: "puntual", id: "F3", caso: "Q", planta: "P1", x: 2, y: 3, F: [0, 0, -200] },
    ],
  };
}

function consultas(f: ModeloFisico): Consultas {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return new Consultas(f, c, r.casos, {}, r.modal);
}

function demandas(q: Consultas): DemandasViga {
  const d = demandasViga(q, "V1");
  if (!d.valido) throw new Error(d.diagnosticos.map((x) => x.mensaje).join("\n"));
  return d.valor;
}

describe("vigas sobre una losa de cimentación: sin flecha", () => {
  it("un vano entero sobre la losa no pide flecha ni la deja pendiente, y cumple con lo demás", () => {
    const q = consultas(modelo());
    const d = demandas(q);
    expect(d.vanos.length).toBe(1);
    const v = d.vanos[0]!;
    expect(v.sobreCimentacion).toBe("L");
    expect(v.flecha).toBeNull();
    expect(v.sinFlecha).toBeUndefined();
    const p = proponerVano(d, v);
    expect(p.armado).not.toBeNull();
    const c = p.comprobacion!;
    expect(c.cumple).toBe(true);
    expect(c.pendientes).toEqual([]);
    const ids = c.filas.map((f) => f.id);
    expect(ids).toContain("flecha-no-aplica");
    expect(ids.some((id) => id === "flecha-total" || id === "flecha-activa")).toBe(false);
    const fila = c.filas.find((f) => f.id === "flecha-no-aplica")!;
    expect(fila.informativa).toBe(true);
    expect(fila.aprovechamiento).toBe(0);
  });

  it("un vano que sale de la losa sigue con su flecha", () => {
    // La viga sigue 2 m más allá del borde, en voladizo desde A2
    const q = consultas(modelo([12, 3]));
    const d = demandas(q);
    // s, a lo largo de la viga desde A1: el vuelo empieza en la cara de A2 (s = 6,15)
    expect(d.vanos.length).toBe(2);
    const vuelo = d.vanos[1]!;
    expect(sobreCimentacion(q, "V1", vuelo.desde, vuelo.hasta)).toBeNull();
    expect(vuelo.sobreCimentacion).toBeUndefined();
    expect(vuelo.flecha).not.toBeNull();
    // El vano entre los pilares, sobre la losa, no
    expect(d.vanos[0]!.sobreCimentacion).toBe("L");
  });

  it("sin losas de cimentación, nada cambia: una viga de forjado tiene su flecha", () => {
    const f = modelo();
    const sinCim: ModeloFisico = { ...f, losas: [{ ...f.losas![0]!, cimentacion: undefined }], pilares: f.pilares!.map((p) => ({ ...p, base: "empotrado" as const })) };
    delete (sinCim.losas![0] as { cimentacion?: unknown }).cimentacion;
    const d = demandas(consultas(sinCim));
    expect(d.vanos[0]!.sobreCimentacion).toBeUndefined();
    expect(d.vanos[0]!.flecha).not.toBeNull();
  });
});
