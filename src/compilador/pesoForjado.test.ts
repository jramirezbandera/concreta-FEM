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
import { compilar, huellaSinCompilar } from "./compilar.ts";
import type { Losa, ModeloFisico, Relleno, Vec2 } from "./fisico.ts";
import { G_KN_POR_KG, PESO_BOVEDILLA, PESO_CASETON, pesoMedioConMacizo, pesoReticular, pesoUnidireccional, ppLosa } from "./pesoForjado.ts";
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

  it("con ábacos, lo aligerado pesa el del casetón y los ábacos γ·canto; un pp escrito es el de lo aligerado (MA3)", () => {
    const f = reticular({ abacos: true });
    const l = f.losas![0]!;
    const pp = pesoReticular({ h: 0.3, hf: 0.05, bw: 0.12, s: 0.8 }, 25)!.pp;
    expect(ppLosa(l, 25)).toEqual({ pp, ppAbaco: 25 * 0.3 });
    expect(pesoLosa(l, f.materiales[0]!)).toBeCloseTo(pp * 32 + 25 * 0.3 * 4, 9);
    expect(ppLosa({ ...l, pp: 4.5 }, 25)).toEqual({ pp: 4.5, ppAbaco: 25 * 0.3 });
    expect(compilar(f).valido).toBe(true);
    // Con ábacos, sin pp da el mismo modelo que con el pp calculado escrito (antes de MA3, no)
    expect(JSON.stringify(valido(compilar(f)).modelo)).toBe(JSON.stringify(valido(compilar(reticular({ abacos: true, pp }))).modelo));
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

// ─── Revisión del peso propio del usuario (2026-11-05) ──────────────────────────────────────────

/** Los seis forjados de la tabla de la revisión, con lo que sale con cada relleno estimado (sin redondear). */
const TABLA: { nombre: string; tipo: "reticular" | "unidireccional"; h: number; hf: number; s: number; b: number }[] = [
  { nombre: "reticular 25+5, 80/12", tipo: "reticular", h: 0.3, hf: 0.05, s: 0.8, b: 0.12 },
  { nombre: "reticular 25+5, 72/12", tipo: "reticular", h: 0.3, hf: 0.05, s: 0.72, b: 0.12 },
  { nombre: "reticular 30+5, 80/12", tipo: "reticular", h: 0.35, hf: 0.05, s: 0.8, b: 0.12 },
  { nombre: "reticular 35+5, 80/15", tipo: "reticular", h: 0.4, hf: 0.05, s: 0.8, b: 0.15 },
  { nombre: "unidireccional 25+5, 70/12", tipo: "unidireccional", h: 0.3, hf: 0.05, s: 0.7, b: 0.12 },
  { nombre: "unidireccional 21+4, 70/12", tipo: "unidireccional", h: 0.25, hf: 0.04, s: 0.7, b: 0.12 },
];
/** Lo que da la tabla de la revisión, a dos decimales. */
const ESPERADO: Record<string, number[]> = {
  "reticular 25+5, 80/12": [4.34, 3.56, 3.02, 2.98],
  "reticular 25+5, 72/12": [4.46, 3.72, 3.19, 3.16],
  "reticular 30+5, 80/12": [4.96, 4.02, 3.37, 3.33],
  "reticular 35+5, 80/15": [5.96, 4.96, 4.27, 4.22],
  "unidireccional 25+5, 70/12": [3.56, 2.98, 2.36],
  "unidireccional 21+4, 70/12": [2.94, 2.46, 1.93],
};

describe("la revisión del peso propio (2026-11-05)", () => {
  it("las fórmulas de la revisión (§3) dan lo de su tabla, sin redondear por el camino", () => {
    for (const t of TABLA) {
      const hn = t.h - t.hf;
      // §3.1 y §3.2, escritas aparte
      const Vh = t.tipo === "reticular" ? hn * ((t.s - t.b) / t.s) ** 2 : (hn * (t.s - t.b)) / t.s;
      const Vc = t.h - Vh;
      const pesos = t.tipo === "reticular" ? (["hormigon", "ceramica", "poliestireno", "recuperable"] as const).map((c) => PESO_CASETON[c]) : (["hormigon", "ceramica", "poliestireno"] as const).map((b) => PESO_BOVEDILLA[b]);
      const nuestros =
        t.tipo === "reticular"
          ? (["hormigon", "ceramica", "poliestireno", "recuperable"] as const).map((c) => pesoReticular({ h: t.h, hf: t.hf, bw: t.b, s: t.s }, 25, c)!)
          : (["hormigon", "ceramica", "poliestireno"] as const).map((b) => pesoUnidireccional({ hf: t.hf, bw: t.b, h: t.h }, t.s, 25, b));
      nuestros.forEach((d, i) => {
        expect(d.hueco, t.nombre).toBeCloseTo(Vh, 14);
        expect(d.hormigon, t.nombre).toBeCloseTo(Vc, 14);
        expect(d.pp, t.nombre).toBeCloseTo(25 * Vc + pesos[i]! * Vh, 12);
        // La tabla, a dos decimales (1,935 sale 1,93 en binario: la revisión lo dice en su nota)
        expect(Math.abs(d.pp - ESPERADO[t.nombre]![i]!), `${t.nombre} [${i}]`).toBeLessThanOrEqual(0.005 + 1e-12);
      });
    }
  });

  it("los criterios de aceptación: 4,3390625, el recuperable 2,984375 y el medio con un 15 % macizo 4,813203125", () => {
    const g = { h: 0.3, hf: 0.05, bw: 0.12, s: 0.8 };
    const h = pesoReticular(g, 25, "hormigon")!;
    expect(h.pp).toBeCloseTo(4.3390625, 12);
    expect(pesoReticular(g, 25, "recuperable")!.pp).toBeCloseTo(2.984375, 12);
    expect(pesoMedioConMacizo(h.pp, 25 * 0.3, 0.15)).toBeCloseTo(4.813203125, 12);
  });

  it("un relleno dado sustituye al estimado: por su peso aparente o por sus piezas, nunca sumados", () => {
    const g = { h: 0.3, hf: 0.05, bw: 0.12, s: 0.8 };
    const base = pesoReticular(g, 25, "hormigon")!;
    const a = pesoReticular(g, 25, "hormigon", { pesoAparente: 6.5 })!;
    expect(a.metodo).toBe("aparente");
    expect(a.pp).toBeCloseTo(25 * base.hormigon + 6.5 * base.hueco, 12);
    // 12 kg × 6,25 piezas/m² = 75 kg/m² = 0,73549875 kN/m²
    const p = pesoReticular(g, 25, "hormigon", { pesoPieza: 12, piezasM2: 6.25 })!;
    expect(p.metodo).toBe("piezas");
    expect(p.relleno).toBeCloseTo(0.73549875, 12);
    expect(p.pp).toBeCloseTo(25 * base.hormigon + 0.73549875, 12);
    // Con «perdido» (material sin decir), el relleno basta
    expect(pesoReticular(g, 25, "perdido", { pesoAparente: 5 })!.pp).toBeCloseTo(25 * base.hormigon + 5 * base.hueco, 12);
    // Unidireccional
    const u = pesoUnidireccional({ hf: 0.05, bw: 0.12, h: 0.3 }, 0.7, 25, "ceramica", { pesoPieza: 8, piezasM2: 5 });
    expect(u.pp).toBeCloseTo(25 * u.hormigon + 8 * 5 * G_KN_POR_KG, 12);
  });

  it("en el compilador: el relleno cambia el modelo como su pp escrito; el pp escrito manda sobre él y lo avisa", () => {
    const g = { h: 0.3, hf: 0.05, bw: 0.12, s: 0.8 };
    const conRelleno = (relleno: Relleno, extra: { pp?: number; caseton?: "perdido" | "recuperable" } = {}): ModeloFisico => {
      const f = reticular({ pp: extra.pp, caseton: extra.caseton });
      return { ...f, losas: [{ ...f.losas![0]!, reticular: { ...f.losas![0]!.reticular!, relleno } }] };
    };
    const pp = pesoReticular(g, 25, "hormigon", { pesoAparente: 6.5 })!.pp;
    expect(JSON.stringify(valido(compilar(conRelleno({ pesoAparente: 6.5 }))).modelo)).toBe(JSON.stringify(valido(compilar(reticular({ pp }))).modelo));
    // Con «perdido» y relleno, sin pp: compila
    expect(compilar(conRelleno({ pesoAparente: 6.5 }, { caseton: "perdido" })).valido).toBe(true);
    // pp escrito y relleno: manda el pp, con el aviso
    const r = valido(compilar(conRelleno({ pesoAparente: 6.5 }, { pp: 4 })));
    expect(r.diagnosticos.some((d) => d.codigo === "forjado/relleno-sin-efecto")).toBe(true);
    expect(JSON.stringify(r.modelo)).toBe(JSON.stringify(valido(compilar(reticular({ pp: 4 }))).modelo));
    // Lo que no vale
    const mal = (f: ModeloFisico) => compilar(f).diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join(" | ");
    expect(mal(conRelleno({ pesoAparente: 6.5, pesoPieza: 12, piezasM2: 6 } as never))).toMatch(/no los dos/);
    expect(mal(conRelleno({ pesoAparente: 6.5 }, { caseton: "recuperable" }))).toMatch(/recuperable deja el hueco vacío/);
    expect(mal(conRelleno({ pesoAparente: Number.NaN }))).toMatch(/entre 0 y 30/);
    expect(mal(conRelleno({ pesoAparente: 31 }))).toMatch(/entre 0 y 30/);
    expect(mal(conRelleno({ pesoPieza: 12 } as never))).toMatch(/pesoPieza \(kg\) y piezasM2/);
    expect(mal(conRelleno({ pesoAparente: 6.5, procedencia: { origen: "catalogo" } } as never))).toMatch(/la procedencia/);
    // Los límites de la geometría (los de antes)
    const geo = (r: Partial<NonNullable<Losa["reticular"]>>, espesor = 0.3) => {
      const f = reticular();
      return mal({ ...f, losas: [{ ...f.losas![0]!, espesor, reticular: { ...f.losas![0]!.reticular!, ...r } }] });
    };
    expect(geo({ nervio: 0.8 })).toMatch(/más estrecho que su intereje/);
    expect(geo({ capa: 0.3 })).toMatch(/más delgada que el canto/);
    expect(geo({ capa: 0 })).toMatch(/intereje, nervio y capa > 0/);
    expect(geo({ intereje: Number.NaN })).toMatch(/intereje, nervio y capa > 0/);
  });

  it("la procedencia sólo informa: no cambia la huella ni el modelo; el relleno, sí", () => {
    const f = reticular({ pp: 4.2 });
    const conP: ModeloFisico = { ...f, losas: [{ ...f.losas![0]!, ppProcedencia: { origen: "fabricante", fuente: "Ficha X, 2025" } }] };
    expect(huellaSinCompilar(conP)).toBe(huellaSinCompilar(f));
    const r = valido(compilar(conP));
    expect(r.hipotesis.join(" ")).toMatch(/L: escrito, 4,2 kN\/m² \(de fabricante: Ficha X, 2025\)/);
    const g = reticular();
    const conR = (relleno: Relleno): ModeloFisico => ({ ...g, losas: [{ ...g.losas![0]!, reticular: { ...g.losas![0]!.reticular!, relleno } }] });
    expect(huellaSinCompilar(conR({ pesoAparente: 6.5, procedencia: { origen: "usuario" } }))).toBe(huellaSinCompilar(conR({ pesoAparente: 6.5 })));
    expect(huellaSinCompilar(conR({ pesoAparente: 6.5 }))).not.toBe(huellaSinCompilar(g));
    // Sin nada escrito, la hipótesis dice que es estimado
    expect(valido(compilar(g)).hipotesis.join(" ")).toMatch(/casetón de hormigón estimado, 7,5 kN\/m³ aparente equivalente \(de predimensionamiento\)/);
  });

  it("la tabla del editor lee y escribe el relleno y la procedencia, y pesa lo del compilador", () => {
    const f = reticular();
    const ctx = contexto(f);
    const fila = { ...DEF_TABLAS.forjados.fila(f.losas![0]! as never, ctx), relleno: "12 kg × 6,25", procedencia: "fabricante: Ficha X, 2025" };
    const o = DEF_TABLAS.forjados.objeto(fila, ctx);
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    const l = o.objeto as unknown as Losa;
    expect(l.reticular!.relleno).toEqual({ pesoPieza: 12, piezasM2: 6.25, procedencia: { origen: "fabricante", fuente: "Ficha X, 2025" } });
    const ctx2 = contexto({ ...f, losas: [l] });
    const vuelta = DEF_TABLAS.forjados.fila(l as never, ctx2);
    expect([vuelta.relleno, vuelta.procedencia]).toEqual(["12 kg × 6,25", "fabricante: Ficha X, 2025"]);
    expect(desglosePesoFila(vuelta, ctx2)!.pp).toBeCloseTo(ppLosa(l, 25)!.pp, 12);
    // Con pp escrito, la procedencia es la del pp
    const conPp = DEF_TABLAS.forjados.objeto({ ...fila, relleno: "", pp: "4,2" }, ctx);
    expect(conPp.ok && (conPp.objeto as unknown as Losa).ppProcedencia).toEqual({ origen: "fabricante", fuente: "Ficha X, 2025" });
    // Una procedencia sin nada escrito, o un relleno mal escrito, no entran
    expect(DEF_TABLAS.forjados.objeto({ ...fila, relleno: "" }, ctx).ok).toBe(false);
    expect(DEF_TABLAS.forjados.objeto({ ...fila, relleno: "doce" }, ctx).ok).toBe(false);
    expect(DEF_TABLAS.forjados.objeto({ ...fila, relleno: "6,5 kN/m³", procedencia: "" }, ctx).ok).toBe(true);
    // Una maciza no lleva relleno
    expect(DEF_TABLAS.forjados.objeto({ ...fila, tipo: "maciza", intereje: "", nervio: "", capa: "" }, ctx).ok).toBe(false);
  });

  it("la sensatez pesa como el compilador una losa con pp escrito y ábacos (MA3)", () => {
    const f = reticular({ abacos: true, pp: 4.2 });
    expect(pesoLosa(f.losas![0]!, f.materiales[0]!)).toBeCloseTo(4.2 * 32 + 25 * 0.3 * 4, 9);
  });
});
