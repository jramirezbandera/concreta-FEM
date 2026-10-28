/**
 * El peso propio que sale solo de los forjados aligerados (`pesoForjado.ts`): los números a mano, que
 * sin pp el compilador da el mismo modelo que con el pp calculado escrito, y que la sensatez de A3 y la
 * tabla del editor pesan lo mismo que el compilador.
 */
import { describe, expect, it } from "vitest";
import { pesoLosa, ppDePano } from "../agente/sensatez.ts";
import { MULTIPLICADORES, rigidezAligerado, textoMultiplicadores } from "../editor/ficha.ts";
import { DEF_TABLAS, contexto, desglosePesoFila } from "../editor/tablas.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import type { Losa, ModeloFisico, Vec2 } from "./fisico.ts";
import { PESO_BOVEDILLA, PESO_CASETON, pesoReticular, pesoUnidireccional, ppLosa } from "./pesoForjado.ts";
import { volumenReticular } from "./reticular.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Un reticular 25+5 a 80/12 de 6 × 6 m sobre un apoyo lineal en su contorno, con ábacos o sin ellos. */
function reticular(o: { pp?: number; caseton?: NonNullable<Losa["reticular"]>["caseton"]; abacos?: boolean } = {}): ModeloFisico {
  return {
    plantas: [{ id: "P0", altura: null }],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [],
    losas: [
      {
        id: "L",
        planta: "P0",
        contorno: rect(0, 0, 6, 6),
        espesor: 0.3,
        material: "H",
        ...(o.pp !== undefined ? { pp: o.pp } : {}),
        reticular: { intereje: 0.8, nervio: 0.12, capa: 0.05, ...(o.caseton ? { caseton: o.caseton } : {}), ...(o.abacos ? { abacos: [rect(2, 2, 4, 4)] } : {}) },
      },
    ],
    apoyosLineales: [{ id: "A", planta: "P0", puntos: [[0, 0], [6, 0], [6, 6], [0, 6], [0, 0]], coartados: [true, true, true, false, false, false] }],
    casos: [{ id: "G", pesoPropio: true }],
  };
}

/** Un paño de viguetas T 25+5 a 70 sobre cuatro vigas y pilares. */
function unidireccional(o: { pp?: number; bovedilla?: "hormigon" | "ceramica" | "poliestireno"; seccion?: "T" | "R" } = {}): ModeloFisico {
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "P0", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
      { id: "T", material: "HA", forma: "T", bf: 0.7, hf: 0.05, bw: 0.12, h: 0.3 },
      { id: "R", material: "HA", forma: "rectangular", b: 0.12, h: 0.3 },
    ],
    pilares: rect(0, 0, 5, 7).map(([x, y], i) => ({ id: `C${i}`, x, y, desde: "P0", hasta: "P1", seccion: "p" })),
    vigas: [
      { id: "VA", planta: "P1", puntos: [[0, 0], [0, 7]], seccion: "v" },
      { id: "VB", planta: "P1", puntos: [[5, 0], [5, 7]], seccion: "v" },
      { id: "VC", planta: "P1", puntos: [[0, 0], [5, 0]], seccion: "v" },
      { id: "VD", planta: "P1", puntos: [[0, 7], [5, 7]], seccion: "v" },
    ],
    panos: [{ id: "F", planta: "P1", contorno: rect(0, 0, 5, 7), direccion: 0, intereje: 0.7, seccion: o.seccion ?? "T", ...(o.pp !== undefined ? { pp: o.pp } : {}), ...(o.bovedilla ? { bovedilla: o.bovedilla } : {}) }],
    casos: [{ id: "G", pesoPropio: true }],
  };
}

describe("el peso propio que sale solo", () => {
  it("reticular 25+5 a 80/12: hormigón 0,119375 m³/m² y hueco 0,180625 m³/m²; con casetón de hormigón, 4,34 kN/m²", () => {
    const g = { h: 0.3, hf: 0.05, bw: 0.12, s: 0.8 };
    const d = pesoReticular(g, 25, "hormigon")!;
    expect(d.hormigon).toBeCloseTo(0.119375, 14);
    expect(d.hueco).toBeCloseTo(0.180625, 14);
    expect(d.pp).toBeCloseTo(25 * 0.119375 + 7.5 * 0.180625, 12);
    expect(d.pp).toBeCloseTo(4.339, 3);
    // El recuperable es el de antes (C4-i), bit a bit
    expect(pesoReticular(g, 25, "recuperable")!.pp).toBe(25 * volumenReticular(g));
    expect(pesoReticular(g, 25, "perdido")).toBeUndefined();
    for (const c of ["hormigon", "ceramica", "poliestireno"] as const) expect(pesoReticular(g, 25, c)!.pesoHueco).toBe(PESO_CASETON[c]);
  });

  it("unidireccional T 25+5 a 70: hormigón 0,092857 m³/m² y hueco 0,207143 m³/m²; con bovedilla de hormigón, 3,56 kN/m²", () => {
    const d = pesoUnidireccional({ hf: 0.05, bw: 0.12, h: 0.3 }, 0.7, 25, "hormigon");
    expect(d.hormigon).toBeCloseTo((0.7 * 0.05 + 0.12 * 0.25) / 0.7, 14);
    expect(d.hueco).toBeCloseTo((0.58 * 0.25) / 0.7, 14);
    expect(d.pp).toBeCloseTo(3.564, 3);
    for (const b of ["hormigon", "ceramica", "poliestireno"] as const) expect(pesoUnidireccional({ hf: 0.05, bw: 0.12, h: 0.3 }, 0.7, 25, b).pesoHueco).toBe(PESO_BOVEDILLA[b]);
  });

  it("sin pp, el compilador da el mismo modelo que con el pp calculado escrito (reticular sin ábacos y unidireccional)", () => {
    for (const caseton of [undefined, "ceramica", "poliestireno"] as const) {
      const pp = pesoReticular({ h: 0.3, hf: 0.05, bw: 0.12, s: 0.8 }, 25, caseton)!.pp;
      const a = valido(compilar(reticular({ caseton })));
      expect(JSON.stringify(a.modelo)).toBe(JSON.stringify(valido(compilar(reticular({ caseton, pp }))).modelo));
    }
    for (const bovedilla of [undefined, "ceramica"] as const) {
      const pp = pesoUnidireccional({ hf: 0.05, bw: 0.12, h: 0.3 }, 0.7, 25, bovedilla).pp;
      const a = valido(compilar(unidireccional({ bovedilla })));
      expect(JSON.stringify(a.modelo)).toBe(JSON.stringify(valido(compilar(unidireccional({ bovedilla, pp }))).modelo));
    }
  });

  it("con ábacos, lo aligerado pesa el del casetón y los ábacos γ·canto; un pp escrito, en toda la losa (C4-i)", () => {
    const f = reticular({ abacos: true });
    const l = f.losas![0]!;
    const pp = pesoReticular({ h: 0.3, hf: 0.05, bw: 0.12, s: 0.8 }, 25)!.pp;
    expect(ppLosa(l, 25)).toEqual({ pp, ppAbaco: 25 * 0.3 });
    expect(pesoLosa(l, f.materiales[0]!)).toBeCloseTo(pp * 32 + 25 * 0.3 * 4, 9);
    expect(ppLosa({ ...l, pp: 4.5 }, 25)).toEqual({ pp: 4.5, ppAbaco: 4.5 });
    expect(compilar(f).valido).toBe(true);
  });

  it("un paño sin pp con una vigueta que no es una T no compila, y lo dice", () => {
    const r = compilar(unidireccional({ seccion: "R" }));
    expect(r.valido).toBe(false);
    expect(r.diagnosticos.find((d) => d.codigo === "fisico/valor-no-valido" && !!d.ids?.includes("F"))?.mensaje).toMatch(/vigueta en T/);
    expect(compilar(unidireccional({ seccion: "R", pp: 3 })).valido).toBe(true);
    const f = unidireccional({ bovedilla: "de corcho" as "ceramica" });
    expect(compilar(f).valido).toBe(false);
  });

  it("la sensatez de A3 y la tabla del editor pesan lo que el compilador", () => {
    const f = unidireccional({ bovedilla: "poliestireno" });
    const esperado = pesoUnidireccional({ hf: 0.05, bw: 0.12, h: 0.3 }, 0.7, 25, "poliestireno").pp;
    expect(ppDePano(f, f.panos![0]!)).toBe(esperado);
    expect(ppDePano(unidireccional({ seccion: "R" }), unidireccional({ seccion: "R" }).panos![0]!)).toBeUndefined();
    const ctx = contexto(f);
    expect(desglosePesoFila(DEF_TABLAS.forjados.fila(f.panos![0]! as never, ctx), ctx)?.pp).toBe(esperado);
    const r = reticular({ caseton: "ceramica" });
    const ctxR = contexto(r);
    expect(desglosePesoFila(DEF_TABLAS.forjados.fila(r.losas![0]! as never, ctxR), ctxR)?.pp).toBe(ppLosa(r.losas![0]!, 25)!.pp);
  });
});

describe("la rigidez del aligerado que enseña Propiedades (`rigidezAligerado`)", () => {
  /** Los multiplicadores de las láminas aligeradas (no de los ábacos) de un modelo compilado, con 1 los que no lleven. */
  const usadosCompilados = (f: ModeloFisico, op = {}) => {
    const r = valido(compilar(f, op));
    const ls = r.modelo.laminas!.filter((_, i) => !r.mapeo.laminas![i]!.abaco);
    const una = ls[0]!.multiplicadores ?? {};
    for (const l of ls) expect(l.multiplicadores ?? {}).toEqual(una);
    return Object.fromEntries(MULTIPLICADORES.map(({ clave }) => [clave, una[clave] ?? 1]));
  };
  const fila = (f: ModeloFisico) => {
    const ctx = contexto(f);
    return { f: DEF_TABLAS.forjados.fila(f.losas![0]! as never, ctx), ctx };
  };

  it("calculada: los del compilador, con «uniforme» (por defecto) y con «bruta»", () => {
    const f = reticular();
    const { f: fl, ctx } = fila(f);
    const u = rigidezAligerado(fl, ctx)!;
    expect(u.modo).toBe("calculada");
    expect(u.usados).toEqual(usadosCompilados(f));
    expect(rigidezAligerado(fl, ctx, "bruta")!.usados).toEqual(usadosCompilados(f, { rigidezReticular: "bruta" }));
  });

  it("la mía: los escritos y 1 los que no; empezar desde los calculados da casi los mismos (3 cifras)", () => {
    const f = reticular();
    (f.losas![0]!.reticular as { multiplicadores?: object }).multiplicadores = { m11: 0.3, m22: 0.25 };
    const { f: fl, ctx } = fila(f);
    const r = rigidezAligerado(fl, ctx)!;
    expect(r.modo).toBe("dada");
    expect(r.usados).toEqual(usadosCompilados(f));
    expect(r.usados.f11).toBe(1);
    const calc = rigidezAligerado(fila(reticular()).f, ctx)!.calculados;
    const texto = textoMultiplicadores(calc);
    const leidos = rigidezAligerado({ ...fl, multiplicadores: texto }, ctx)!.dados;
    for (const { clave } of MULTIPLICADORES) expect(Math.abs(leidos[clave]! / calc[clave] - 1)).toBeLessThan(5e-3);
  });

  it("sin los datos de los nervios, o en una maciza, no hay tabla", () => {
    const f = reticular();
    const { f: fl, ctx } = fila(f);
    expect(rigidezAligerado({ ...fl, nervio: "" }, ctx)).toBeNull();
    expect(rigidezAligerado({ ...fl, tipo: "maciza" }, ctx)).toBeNull();
  });
});
