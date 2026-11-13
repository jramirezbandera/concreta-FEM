/**
 * Fase F (`docs/fem3d/franjas.md`): las franjas de armado de una losa, sus caras en la malla y sus
 * esfuerzos.
 * - reparto (§2.1, F-c): franjas iguales de ancho ≤ b de borde a borde, el intereje en un reticular;
 * - criterio 1: en una línea de la malla que cruza la losa (una cara, un apoyo), la suma de las
 *   franjas es el corte de las láminas de toda la losa; por campos, la de la recta entera;
 * - criterio 2: flexión cilíndrica, qL²/8 en todas las franjas;
 * - simetría, Wood–Armer por combinación y la opción `franjas: false`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { woodArmer } from "../dimensionado/woodArmer.ts";
import { calcular } from "../motor/calcular.ts";
import { Cortes } from "../motor/cortes.ts";
import { Diagnosticos } from "../motor/diagnosticos.ts";
import type { ResultadoCaso } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { nerviosLosa } from "./abacos.ts";
import { compilar } from "./compilar.ts";
import { combinar } from "./envolventes.ts";
import { EsfuerzosFranjas } from "./esfuerzosFranjas.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion, type Pilar, type Vec2 } from "./fisico.ts";
import { franjasLosa, PASO_ESTACIONES, tramosRecta } from "./franjas.ts";
import { validar } from "./validar.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Losa plana de 3 × 3 vanos de 6 × 5 m sobre 16 pilares de 30 × 30, con 0,5 m de vuelo; G (peso) y Q (10 kN/m²). */
function losaPlana(): ModeloFisico {
  const pilares: Pilar[] = [];
  for (const x of [0, 6, 12, 18]) for (const y of [0, 5, 10, 15]) pilares.push({ id: `P${x}-${y}`, x, y, desde: "C", hasta: "P1", seccion: "p" });
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "C", tipo: "sotano", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 }],
    pilares,
    losas: [{ id: "L", planta: "P1", contorno: rect(-0.5, -0.5, 18.5, 15.5), espesor: 0.25, material: "HA" }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -10] }],
  };
}

interface Calculado {
  fisico: ModeloFisico;
  ef: EsfuerzosFranjas;
  casos: ResultadoCaso[];
  cortes: Cortes;
}

function calculado(f: ModeloFisico, op: OpcionesCompilacion = {}): Calculado {
  const r = compilar(f, op);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(calcular(r.modelo));
  const ctx = validar(f, resolverOpciones(op), new Diagnosticos())!;
  const cortes = new Cortes(r.modelo);
  return { fisico: f, ef: new EsfuerzosFranjas(ctx, r, casos, { cortes }), casos, cortes };
}

describe("F: reparto de las franjas (§2.1)", () => {
  it("de borde a borde, iguales y de ancho ≤ b, numeradas por t; X según el eje 1 e Y según el 2", () => {
    const l = losaPlana().losas![0]!;
    const fs = franjasLosa(l, 1);
    const x = fs.filter((f) => f.direccion === 1);
    const y = fs.filter((f) => f.direccion === 2);
    expect(x.length).toBe(16);
    expect(y.length).toBe(19);
    expect(x[0]!.id).toBe("L:X1");
    expect(y[18]!.id).toBe("L:Y19");
    for (const g of [x, y]) {
      expect(g[0]!.t0).toBe(-0.5);
      for (let i = 1; i < g.length; i++) expect(g[i]!.t0).toBe(g[i - 1]!.t1);
      for (const f of g) {
        expect(f.ancho).toBeLessThanOrEqual(1 + 1e-12);
        expect(f.ancho).toBeCloseTo(g[0]!.ancho, 12);
      }
    }
    expect(x[0]!.d).toEqual([1, 0]);
    expect(y[0]!.d).toEqual([0, 1]);
    expect([x[3]!.s0, x[3]!.s1]).toEqual([-0.5, 18.5]);
    // 16 m entre 1 m: 16 franjas de 1 m, sin una de ancho nulo por el redondeo
    expect(franjasLosa({ ...l, contorno: rect(0, 0, 10, 1.6) }, 0.1).filter((f) => f.direccion === 1).length).toBe(16);
  });

  it("en un reticular, una franja por nervio, centrada en él (también por el punto de paso y girado)", () => {
    const l = losaPlana().losas![0]!;
    const s = 0.82;
    for (const [paso, eje1] of [[undefined, 0], [[1.37, -0.21], 0], [[2.1, 3.3], 30]] as [Vec2 | undefined, number][]) {
      const ret = { intereje: s, nervio: 0.12, capa: 0.05, ...(paso ? { paso } : {}) };
      const L = { ...l, eje1, reticular: ret };
      const r = franjasLosa(L, 1);
      const n = nerviosLosa(L);
      for (const k of [1, 2] as const) {
        const g = r.filter((f) => f.direccion === k);
        // De borde a borde, seguidas
        for (let i = 1; i < g.length; i++) expect(g[i]!.t0).toBe(g[i - 1]!.t1);
        // Las de dentro, de un intereje; las de los extremos, de s/2 a 3s/2
        for (const f of g.slice(1, -1)) expect(f.ancho).toBeCloseTo(s, 9);
        for (const f of [g[0]!, g.at(-1)!]) expect(f.ancho > s / 2 - 1e-9 && f.ancho < 1.5 * s + 1e-9).toBe(true);
        // Cada franja lleva un solo eje de nervio de su dirección, y en las de dentro, en su centro
        const tsNervios = [...new Set(n.filter(([a, b]) => Math.abs((b[0] - a[0]) * g[0]!.n[0] + (b[1] - a[1]) * g[0]!.n[1]) < 1e-9).map(([a]) => Math.round((a[0] * g[0]!.n[0] + a[1] * g[0]!.n[1]) * 1e6) / 1e6))];
        expect(tsNervios.length).toBe(g.length);
        for (const [i, f] of g.entries()) {
          const dentro = tsNervios.filter((t) => t > f.t0 && t < f.t1);
          expect(dentro.length).toBe(1);
          if (i > 0 && i < g.length - 1) expect(dentro[0]!).toBeCloseTo((f.t0 + f.t1) / 2, 6);
        }
        expect(g.every((f) => f.intereje === s)).toBe(true);
      }
    }
    const g = franjasLosa({ ...l, eje1: 90 }, 1);
    expect(g.filter((f) => f.direccion === 1).length).toBe(19);
    expect(g[0]!.d).toEqual([0, 1]);
  });

  it("una losa en L: cada franja va de un borde al otro de su parte de la losa", () => {
    const l = { ...losaPlana().losas![0]!, contorno: [[0, 0], [10, 0], [10, 4], [4, 4], [4, 8], [0, 8]] as Vec2[] };
    const fs = franjasLosa(l, 1).filter((f) => f.direccion === 1);
    expect(fs.length).toBe(8);
    expect([fs[0]!.s0, fs[0]!.s1]).toEqual([0, 10]);
    expect([fs[7]!.s0, fs[7]!.s1]).toEqual([0, 4]);
    expect(tramosRecta({ contorno: l.contorno, huecos: [rect(1, 1, 2, 2)] }, [1, 0], [0, 1], 1.5)).toEqual([
      [0, 1],
      [2, 8],
    ]);
  });
});

describe("F: esfuerzos de las franjas (criterio 1, simetría y Wood–Armer)", () => {
  let c: Calculado;
  beforeAll(() => {
    c = calculado(losaPlana());
  }, 60_000);

  it("en una línea de apoyo que cruza la losa, la suma de las franjas es el corte de las láminas de toda la losa, a cada lado (≤ 1e-9)", () => {
    // La losa plana con un apoyo lineal (uz) en x = 3 de borde a borde
    const f = losaPlana();
    const ca = calculado({ ...f, apoyosLineales: [{ id: "AL", planta: "P1", puntos: [[3, -0.5], [3, 15.5]], coartados: [false, false, true, false, false, false] }] });
    for (const lado of [-1, 1] as const) {
      let suma = [0, 0];
      for (const fr of ca.ef.franjas("L").filter((x) => x.direccion === 1)) {
        const e = ca.ef.estaciones(fr.id)!.estaciones.find((q) => q.tipo === "apoyo" && q.s === 3 && q.lado === lado)!;
        expect(e.metodo).toBe("fuerzas-nodales");
        expect(e.piezas).toEqual(["AL"]);
        suma = suma.map((v, k) => v + e.medios[3 * k]! * e.anchoEnLosa);
      }
      const r = ca.cortes.cortar({ origen: [3, -0.5, 0], x: [-lado, 0, 0], vz: [0, 0, 1], y: lado === 1 ? [-16, 0] : [0, 16], soloLaminas: true }, ca.casos);
      expect(r.valido).toBe(true);
      for (let k = 0; k < 2; k++) expect(Math.abs(suma[k]! - r.esfuerzos[6 * k + 4]!)).toBeLessThanOrEqual(1e-9 * Math.abs(r.esfuerzos[6 * k + 4]!));
    }
    // A un lado y otro del apoyo, el momento de la losa es el mismo (el apoyo no transmite giros): en
    // total, exacto; en una franja, salvo el reparto de cada lado por sus láminas, que no son las mismas
    const e = ca.ef.estaciones("L:X4")!.estaciones.filter((q) => q.tipo === "apoyo");
    expect(e).toHaveLength(2);
    expect(Math.abs(e[0]!.medios[3]! / e[1]!.medios[3]! - 1)).toBeLessThan(0.02);
  }, 60_000);

  it("en la cara de un pilar, la franja que lo toca toma el metro centrado en él (F-h): no depende de dónde caen los bordes", () => {
    const f = losaPlana();
    const r = compilar(f, {});
    if (!r.valido) throw new Error("no compila");
    const ctx = validar(f, resolverOpciones({}), new Diagnosticos())!;
    const corrida = new EsfuerzosFranjas(ctx, r, c.casos, { desfase: 0.37 });
    let vistas = 0;
    for (const fr of c.ef.franjas("L")) {
      for (const e of c.ef.estaciones(fr.id)!.estaciones) {
        if (e.tipo !== "cara" || !e.ventana) continue;
        const [t0, t1] = e.ventana;
        expect(t1 - t0).toBeCloseTo(1, 12);
        // En las franjas corridas, la que toca el mismo pilar tiene la misma ventana y el mismo mx
        const o = corrida
          .franjas("L")
          .filter((g) => g.direccion === fr.direccion)
          .flatMap((g) => corrida.estaciones(g.id)!.estaciones)
          .find((q) => q.tipo === "cara" && q.s === e.s && q.lado === e.lado && q.ventana?.[0] === t0)!;
        expect(o.medios[0]).toBe(e.medios[0]);
        expect(o.medios[3]).toBe(e.medios[3]);
        vistas++;
      }
    }
    expect(vistas).toBeGreaterThan(40);
  });

  it("en una cara, las franjas que no tocan ningún pilar suman, con las ventanas de los que sí, lo que da la recta en su ancho", () => {
    // L:X7 (t de 5,5 a 6,5) no toca ningún pilar: su cara es su propio corte
    const e = c.ef.estaciones("L:X7")!.estaciones.find((q) => q.tipo === "cara" && q.s === 6.15)!;
    expect(e.ventana).toBeUndefined();
    expect(e.anchoEnLosa).toBeCloseTo(1, 12);
  });

  it("por campos, la suma de las franjas de una estación es el corte por campos de la recta entera (malla de rectángulos: ≤ 1e-9)", () => {
    const s = 3 + PASO_ESTACIONES / 2 + 0.003;
    // Una estación de paso cualquiera: la de s más próximo
    const fs = c.ef.franjas("L").filter((x) => x.direccion === 1);
    const e0 = c.ef.estaciones(fs[5]!.id)!.estaciones.filter((q) => q.tipo === "paso").sort((a, b) => Math.abs(a.s - s) - Math.abs(b.s - s))[0]!;
    let suma = [0, 0];
    for (const f of fs) {
      const e = c.ef.estaciones(f.id)!.estaciones.find((q) => q.tipo === "paso" && q.s === e0.s)!;
      suma = suma.map((v, k) => v + e.medios[3 * k]! * e.anchoEnLosa);
    }
    const r = c.cortes.cortar({ origen: [e0.s, -0.5, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [0, 16], soloLaminas: true, metodo: "campos" }, c.casos, c.ef["campos"]);
    expect(r.valido).toBe(true);
    for (let k = 0; k < 2; k++) expect(Math.abs(suma[k]! - r.esfuerzos[6 * k + 4]!)).toBeLessThanOrEqual(1e-9 * Math.abs(r.esfuerzos[6 * k + 4]!));
  });

  it("la losa es simétrica: las franjas simétricas dan lo mismo en las estaciones simétricas", () => {
    const x2 = c.ef.estaciones("L:X2")!.estaciones;
    const x15 = c.ef.estaciones("L:X15")!.estaciones;
    expect(x2.length).toBe(x15.length);
    // Simetría respecto a y = 7,5: X2 ↔ X15, en la misma s
    x2.forEach((e, i) => {
      const o = x15[i]!;
      expect(o.s).toBeCloseTo(e.s, 9);
      expect(o.medios[3]).toBeCloseTo(e.medios[3]!, 6);
    });
    // Respecto a x = 9: s ↔ 18 − s, con el lado cambiado
    const sim = (s: number) => 18 - s;
    for (const e of x2.filter((q) => q.tipo === "cara")) {
      const o = x2.find((q) => q.tipo === "cara" && Math.abs(q.s - sim(e.s)) < 1e-9 && q.lado === -e.lado)!;
      expect(o.medios[3]).toBeCloseTo(e.medios[3]!, 6);
    }
  });

  it("las franjas que tocan un pilar no tienen estaciones entre sus caras; las demás sí", () => {
    // El pilar P6-5 (x = 6, y = 5) toca L:X6 (t de 4,5 a 5,5)
    const x6 = c.ef.estaciones("L:X6")!.estaciones;
    expect(x6.some((q) => q.s > 5.85 + 1e-9 && q.s < 6.15 - 1e-9)).toBe(false);
    const caras = x6.filter((q) => q.tipo === "cara" && (q.s === 5.85 || q.s === 6.15));
    expect(caras.map((q) => q.piezas)).toEqual([["P6-5"], ["P6-5"]]);
    expect(c.ef.estaciones("L:X7")!.estaciones.some((q) => q.tipo === "paso" && q.s > 5.85 && q.s < 6.15)).toBe(true);
  });

  it("Wood–Armer por combinación con los momentos medios, y su envolvente con la combinación que la da", () => {
    const combs = [
      [1.35, 1.5],
      [1, 0],
      [1.35, 0],
    ];
    const id = "L:X6";
    const env = c.ef.envolvente(id, combs)!;
    c.ef.estaciones(id)!.estaciones.forEach((e, i) => {
      const w = combs.map((f) => {
        const [mx, my, mxy] = combinar(e.medios, 3, f);
        return woodArmer(mx!, my!, mxy!);
      });
      const inf = Math.max(0, ...w.map((x) => x.inferiorX));
      const sup = Math.max(0, ...w.map((x) => x.superiorX));
      expect(env[i]!.inferior).toBe(inf);
      expect(env[i]!.superior).toBe(sup);
      if (sup > 0) expect(w[env[i]!.combSuperior]!.superiorX).toBe(sup);
    });
  });

  it("ninguna estación válida tiene un momento que no sea un número, ni una demanda 0 por un NaN (A2-1)", () => {
    // En esta losa los bordes de las franjas que tocan un pilar coinciden con los de su ventana (centro
    // ± 0,5): el quiebre repetido daba un tramo de largo nulo, my y mxy NaN y Wood–Armer 0/0 en 36 caras
    let caras = 0;
    for (const fr of c.ef.franjas("L")) {
      const est = c.ef.estaciones(fr.id)!.estaciones;
      const env = c.ef.envolvente(fr.id, [[1.35, 1.5]])!;
      est.forEach((e, i) => {
        if (!e.valido) return;
        if (e.tipo === "cara") caras++;
        expect(e.medios.every(Number.isFinite)).toBe(true);
        expect(Number.isFinite(env[i]!.inferior) && Number.isFinite(env[i]!.superior)).toBe(true);
        if (Math.abs(env[i]!.mxMin) > 1) expect(env[i]!.superior + env[i]!.inferior).toBeGreaterThan(0);
      });
    }
    expect(caras).toBeGreaterThan(100);
  });

  it("un corte por campos con un quiebre repetido da lo mismo que sin repetirlo (A2-1)", () => {
    const corte = (quiebres: number[]) => c.cortes.cortar({ origen: [5.85 - 0.001, -0.5, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [0, 16], soloLaminas: true, metodo: "campos", cuadratura: 2, quiebres }, c.casos, c.ef["campos"]);
    const a = corte([1, 2, 3]);
    const b = corte([1, 1, 2, 2, 3]);
    expect(b.valido).toBe(true);
    expect(Array.from(b.esfuerzos)).toEqual(Array.from(a.esfuerzos));
    expect(b.muestras!.pesos.length).toBe(a.muestras!.pesos.length);
  });
});

describe("F: flexión cilíndrica (criterio 2)", () => {
  it("una losa apoyada en dos bordes con ν = 0 da qL²/8 en el centro de todas sus franjas (≤ 0,5 %)", () => {
    const [L, B, q] = [6, 4, 10];
    const f: ModeloFisico = {
      plantas: [{ id: "P0", altura: null }],
      materiales: [{ id: "H", tipo: "hormigon", fck: 25, nu: 0, peso: 0 }],
      secciones: [],
      losas: [{ id: "L", planta: "P0", contorno: rect(0, 0, L, B), espesor: 0.2, material: "H" }],
      apoyosLineales: [
        { id: "A", planta: "P0", puntos: [[0, 0], [0, B]], coartados: [true, true, true, false, false, false] },
        { id: "B", planta: "P0", puntos: [[L, 0], [L, B]], coartados: [false, false, true, false, false, false] },
      ],
      casos: [{ id: "Q" }],
      cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "P0", losa: "L", q: [0, 0, -q] }],
    };
    const c = calculado(f, { tamanoMalla: 0.25 });
    const fs = c.ef.franjas("L").filter((x) => x.direccion === 1);
    expect(fs.length).toBe(4);
    for (const fr of fs) {
      const e = c.ef.estaciones(fr.id)!.estaciones.find((x) => Math.abs(x.s - L / 2) < 1e-9)!;
      expect(e.tipo).toBe("paso");
      expect(Math.abs(e.medios[0]! / ((q * L * L) / 8) - 1)).toBeLessThanOrEqual(5e-3);
    }
  }, 60_000);

  it("en una losa continua de dos vanos, my en la cara del apoyo interior es ν·M a un canto de la cara (LV2-h), y mxy, 0", () => {
    // Flexión cilíndrica con ν ≠ 0: los bordes largos con el giro θx coartado (en w = w(x) es 0, así
    // que no reacciona) para que my = ν·mx. Dos vanos de L: M(x) = (3qL/8)·x − q·x²/2 en el primero.
    // El apoyo interior coarta también θx (tampoco reacciona): es un borde rígido, y la estación toma
    // my y mxy a un canto de él; articulado, los tomaría en su recta
    const [L, B, q, nu, t] = [5, 4, 10, 0.2, 0.3];
    const f: ModeloFisico = {
      plantas: [{ id: "P0", altura: null }],
      materiales: [{ id: "H", tipo: "hormigon", fck: 25, nu, peso: 0 }],
      secciones: [],
      losas: [{ id: "L", planta: "P0", contorno: rect(0, 0, 2 * L, B), espesor: t, material: "H" }],
      apoyosLineales: [
        { id: "A", planta: "P0", puntos: [[0, 0], [0, B]], coartados: [true, true, true, false, false, false] },
        { id: "C", planta: "P0", puntos: [[L, 0], [L, B]], coartados: [false, false, true, true, false, false] },
        { id: "B", planta: "P0", puntos: [[2 * L, 0], [2 * L, B]], coartados: [false, false, true, false, false, false] },
        { id: "G0", planta: "P0", puntos: [[0, 0], [2 * L, 0]], coartados: [false, false, false, true, false, false] },
        { id: "G1", planta: "P0", puntos: [[0, B], [2 * L, B]], coartados: [false, false, false, true, false, false] },
      ],
      casos: [{ id: "Q" }],
      cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "P0", losa: "L", q: [0, 0, -q] }],
    };
    const M = (x: number) => ((3 * q * L) / 8) * x - (q * x * x) / 2;
    const c = calculado(f, { tamanoMalla: 0.25 });
    const fs = c.ef.franjas("L").filter((x) => x.direccion === 1);
    expect(fs.length).toBe(4);
    for (const fr of fs) {
      const apoyos = c.ef.estaciones(fr.id)!.estaciones.filter((x) => x.tipo === "apoyo" && Math.abs(x.s - L) < 1e-9);
      expect(apoyos.map((x) => x.lado).sort()).toEqual([-1, 1]);
      for (const e of apoyos) {
        expect(e.valido).toBe(true);
        expect(e.distanciaMuestras).toBeCloseTo(t, 9);
        // mx, el del apoyo: −qL²/8 (con h = 0,25, a 0,52 %); my, ν·M a un canto hacia el vano; mxy, 0 (sobre qL²/8)
        expect(Math.abs(e.medios[0]! / M(L) - 1)).toBeLessThanOrEqual(1e-2);
        expect(Math.abs(e.medios[1]! - nu * M(L - t)) / Math.abs(M(L))).toBeLessThanOrEqual(1e-2);
        expect(Math.abs(e.medios[2]!) / Math.abs(M(L))).toBeLessThanOrEqual(1e-3);
      }
    }
  }, 60_000);
});

describe("F: la opción franjas: false", () => {
  it("no siembra las caras: el mismo modelo que sin pilares que sembrar", () => {
    const f = losaPlana();
    const con = compilar(f, {});
    const sin = compilar(f, { franjas: false });
    if (!con.valido || !sin.valido) throw new Error("no compila");
    expect(sin.modelo.nudos.length).toBeLessThan(con.modelo.nudos.length);
    expect(con.huella).not.toBe(sin.huella);
  });
});

describe("estaciones de apoyo en las caras de unas vigas dibujadas por vanos (A2-3)", () => {
  it("en un reticular simétrico con vigas de borde una por vano, las estaciones de las dos caras son simétricas y ninguna sale de una astilla", () => {
    // Antes, en la cara de s mayor la cobertura no se aplicaba (el ancho de la viga se restaba entero) y
    // la primera viga tapaba a la segunda en la misma recta: L:X14 salía con 0,10 m de 0,80 y −29,3 kN·m/m
    // frente a −5,5 en su simétrica
    const xs = [0, 5, 10, 15];
    const pilares: Pilar[] = xs.flatMap((x) => xs.map((y) => ({ id: `P${x}-${y}`, x, y, desde: "C", hasta: "P1", seccion: "p" })));
    const vigas: NonNullable<ModeloFisico["vigas"]> = [];
    for (const y of [0, 15]) for (let i = 0; i < 3; i++) vigas.push({ id: `VX${y}-${i}`, planta: "P1", puntos: [[xs[i]!, y], [xs[i + 1]!, y]], seccion: "v" });
    for (const x of [0, 15]) for (let i = 0; i < 3; i++) vigas.push({ id: `VY${x}-${i}`, planta: "P1", puntos: [[x, xs[i]!], [x, xs[i + 1]!]], seccion: "v" });
    const f: ModeloFisico = {
      plantas: [{ id: "P1", altura: null }, { id: "C", tipo: "sotano", altura: 3 }],
      materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
      secciones: [
        { id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
        { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
      ],
      pilares,
      vigas,
      losas: [{ id: "L", planta: "P1", contorno: [[-0.15, -0.15], [15.15, -0.15], [15.15, 15.15], [-0.15, 15.15]], espesor: 0.3, material: "HA", reticular: { intereje: 0.8, nervio: 0.12, capa: 0.05, abacosPilares: { lado: 2 } } }],
      casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
      cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -10] }],
    };
    const c = calculado(f);
    const X = c.ef.franjas("L").filter((x) => x.direccion === 1);
    let pares = 0;
    for (const x of X) {
      const est = c.ef.estaciones(x.id)!.estaciones.filter((e) => e.tipo === "apoyo");
      for (const e of est) {
        // Ninguna estación de apoyo de menos de la mitad de lo que la franja tiene en losa en esa recta (sin
        // los anchos de las vigas de borde perpendiculares, de −0,15 a 0,15 y de 14,85 a 15,15)
        expect(e.anchoEnLosa, `${x.id} s = ${e.s}`).toBeGreaterThan(0.5 * (Math.min(x.t1, 14.85) - Math.max(x.t0, 0.15)) - 1e-6);
        // Y su simétrica respecto a x = 7,5, en la misma franja
        const o = est.find((q) => Math.abs(q.s - (15 - e.s)) < 1e-6 && q.lado === -e.lado);
        expect(o, `${x.id} s = ${e.s}`).toBeDefined();
        expect(Math.abs(o!.medios[3]! - e.medios[3]!)).toBeLessThan(0.01 * Math.max(1, Math.abs(e.medios[3]!)));
        pares++;
      }
    }
    expect(pares).toBeGreaterThan(20);
  }, 120_000);
});
