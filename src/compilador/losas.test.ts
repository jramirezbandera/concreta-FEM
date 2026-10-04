/**
 * C2 en modelos pequeños escritos a mano: huellas (C2-d), diafragma con losas y dobles alturas
 * (C2-f), vigas embebidas (C2-e), peso propio y descuelgue de las vigas (C2-g, frente a un cálculo
 * a mano), bordes de losa dentro del ancho de una viga (C2-c), cargas y apoyos en losa (C2-h); y en
 * baterías al azar, el validador de la malla (criterio 3) y «sin pérdidas» (criterio 5).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { fisicoAleatorio } from "../pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../pruebas/losasAleatorias.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { resultanteAnalitica } from "./cargas.ts";
import { compilar } from "./compilar.ts";
import type { CargaFisica, Losa, ModeloFisico, Vec2, Viga } from "./fisico.ts";
import { jacobianoEscalado } from "./mallado.ts";
import { momentosRegion } from "./poligonos.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** 4 pilares de 0,3 × 0,4 en las esquinas de 6 × 5 m, vigas de borde a ejes y una losa de 25 cm a ejes. */
function base(extra: { vigas?: Viga[]; losas?: Losa[]; cargas?: CargaFisica[] } = {}): ModeloFisico {
  const esquinas: Vec2[] = [
    [0, 0],
    [6, 0],
    [6, 5],
    [0, 5],
  ];
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "C", tipo: "sotano", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.4 },
      { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.6 },
    ],
    pilares: esquinas.map(([x, y], i) => ({ id: `A${i}`, x, y, desde: "C", hasta: "P1", seccion: "p" })),
    vigas: [
      ...esquinas.map((a, i): Viga => ({ id: `V${i}`, planta: "P1", puntos: [a, esquinas[(i + 1) % 4]!], seccion: "v" })),
      ...(extra.vigas ?? []),
    ],
    losas: extra.losas ?? [{ id: "L", planta: "P1", contorno: rect(0, 0, 6, 5), espesor: 0.25, material: "HA" }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: extra.cargas ?? [{ tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -3] }],
  };
}

describe("huellas, diafragma y vigas embebidas", () => {
  it("cada pilar se une a la losa por su huella, encadenada al diafragma (C2-d, C2-f)", () => {
    const r = valido(compilar(base(), { tamanoMalla: 0.5 }));
    const m = r.modelo;
    const enlaces = m.restricciones!.filter((x) => x.tipo === "enlace-rigido");
    expect(enlaces).toHaveLength(4);
    const diaf = m.restricciones!.find((x) => x.tipo === "diafragma")!;
    const enLaminas = new Set(m.laminas!.flatMap((l) => [...l.nudos]));
    for (const e of enlaces) {
      const pilar = r.mapeo.restricciones[m.restricciones!.indexOf(e)]!.pilar!;
      expect(e.maestro).toBe(r.mapeo.nudosPilar[`${pilar}@P1`]);
      expect(enLaminas.has(e.maestro)).toBe(false); // el nudo del pilar no es de la malla
      // Los esclavos, en la huella de 0,3 × 0,4 (ampliada en ε_snap) y no en el diafragma
      const P = m.nudos[e.maestro]!;
      for (const s of e.esclavos) {
        expect(Math.abs(m.nudos[s]!.x - P.x)).toBeLessThanOrEqual(0.2 + 0.05 + 1e-9);
        expect(Math.abs(m.nudos[s]!.y - P.y)).toBeLessThanOrEqual(0.15 + 0.05 + 1e-9);
        expect(diaf.esclavos.includes(s)).toBe(false);
      }
      expect(diaf.esclavos.includes(e.maestro)).toBe(true);
    }
    // El diafragma abarca todos los nudos de la malla que no están en una huella
    const enHuella = new Set(enlaces.flatMap((e) => e.esclavos));
    for (const n of enLaminas) if (!enHuella.has(n)) expect(diaf.esclavos.includes(n)).toBe(true);
  });

  it("un pilar en una doble altura (hueco a su alrededor) no entra en el diafragma de esa planta (C2-f)", () => {
    const f = base({ losas: [{ id: "L", planta: "P1", contorno: rect(0, 0, 6, 5), huecos: [rect(2.2, 1.7, 3.8, 3.3)], espesor: 0.25, material: "HA" }] });
    const g: ModeloFisico = {
      ...f,
      plantas: [{ id: "P2", altura: null }, { id: "P1", altura: 3 }, ...f.plantas.slice(1)],
      pilares: [...f.pilares!.map((p) => ({ ...p, hasta: "P2" })), { id: "PC", x: 3, y: 2.5, desde: "C", hasta: "P2", seccion: "p" }],
      vigas: [...f.vigas!, ...f.vigas!.map((v) => ({ ...v, id: `${v.id}b`, planta: "P2" }))],
      losas: [...f.losas!, { id: "L2", planta: "P2", contorno: rect(0, 0, 6, 5), espesor: 0.25, material: "HA" }],
    };
    const r = valido(compilar(g, { tamanoMalla: 0.5 }));
    const m = r.modelo;
    const nP1 = r.mapeo.nudosPilar["PC@P1"]!;
    const nP2 = r.mapeo.nudosPilar["PC@P2"]!;
    const diaf = (p: string) => m.restricciones![r.mapeo.restricciones.findIndex((x, i) => x.planta === p && m.restricciones![i]!.tipo === "diafragma")]!;
    expect(diaf("P1").esclavos.includes(nP1)).toBe(false);
    expect(diaf("P2").esclavos.includes(nP2)).toBe(true);
    expect(r.mapeo.restricciones.some((x) => x.pilar === "PC" && x.planta === "P1")).toBe(false);
    expect(r.mapeo.restricciones.some((x) => x.pilar === "PC" && x.planta === "P2")).toBe(true);
    // y el cálculo cierra
    const c = calcular(m);
    expect(c.valido).toBe(true);
  });

  it("una viga embebida se parte en los nudos de la malla sobre su eje (C2-e)", () => {
    const r = valido(compilar(base({ vigas: [{ id: "VE", planta: "P1", puntos: [[0, 2.5], [6, 2.5]], seccion: "v" }] }), { tamanoMalla: 0.5 }));
    const m = r.modelo;
    const barras = r.mapeo.piezas["VE"]!;
    expect(barras.length).toBeGreaterThan(6);
    for (const b of barras) {
      for (const n of m.barras![b]!.nudos) {
        expect(m.nudos[n]!.y).toBeCloseTo(2.5, 12);
        expect(r.mapeo.nudos[n]!.fisicos).toContain("L");
      }
      // Sin offsets: los nudos están sobre su eje
      expect(m.barras![b]!.offsets).toBeUndefined();
    }
  });
});

describe("peso propio (C2-g) frente a un cálculo a mano", () => {
  it("losa desde su pp y vigas de borde e interiores por su descuelgue", () => {
    const f = base({ vigas: [{ id: "VE", planta: "P1", puntos: [[0, 2.5], [6, 2.5]], seccion: "v" }], cargas: [] });
    const r = valido(compilar(f, { tamanoMalla: 0.5 }));
    const g = 25;
    const t = 0.25;
    const [b, h] = [0.3, 0.6];
    // Vigas de borde (un lado cubierto) y la interior (dos)
    const bordes = 2 * 6 + 2 * 5;
    const vigas = g * (b * h - (b / 2) * t) * bordes + g * (b * h - b * t) * 6;
    const losa = g * t * 30;
    const pilares = 4 * g * 0.3 * 0.4 * 3;
    const Fz = resultanteAnalitica(r.modelo, 0, [0, 0, 0]).F[2];
    expect(Fz).toBeCloseTo(-(vigas + losa + pilares), 9);
    expect(r.hipotesis.some((x) => x.includes("descuelgue"))).toBe(true);
  });
});

describe("errores y avisos de C2", () => {
  it("un borde de losa dentro del ancho de una viga sin ir por su eje es un error (C2-c)", () => {
    const r = compilar(base({ losas: [{ id: "L", planta: "P1", contorno: rect(0, 0.12, 6, 5), espesor: 0.25, material: "HA" }] }));
    expect(r.valido).toBe(false);
    const d = r.diagnosticos.find((x) => x.codigo === "losa/borde-en-viga")!;
    expect(d.ids).toEqual(["L", "V0"]);
  });

  it("cargas y apoyos fuera de las losas", () => {
    const fuera = compilar(base({ cargas: [{ tipo: "lineal", id: "t", caso: "Q", planta: "P1", puntos: [[3, 1], [3, 7]], q: [0, 0, -5] }] }));
    expect(fuera.valido).toBe(false);
    expect(fuera.diagnosticos.find((x) => x.codigo === "carga/fuera-de-losa")!.ids).toEqual(["t"]);
    const ap = compilar({ ...base(), apoyosLineales: [{ id: "AL", planta: "P1", puntos: [[1, 1], [8, 1]], coartados: [false, false, true, false, false, false] }] });
    expect(ap.valido).toBe(false);
    expect(ap.diagnosticos.find((x) => x.codigo === "apoyo/fuera-de-losa")!.ids).toEqual(["AL"]);
  });

  it("una zona que se sale de la losa: aviso con el área, y su resultante es la de la parte en la losa", () => {
    const r = valido(compilar(base({ cargas: [{ tipo: "superficie", id: "z", caso: "Q", planta: "P1", zona: rect(4, 3, 8, 6), q: [0, 0, -2] }] }), { tamanoMalla: 0.5 }));
    const d = r.diagnosticos.find((x) => x.codigo === "carga/zona-fuera-de-losa")!;
    expect(d.detalles!.area).toBeCloseTo(12 - 4, 9);
    expect(resultanteAnalitica(r.modelo, 1, [0, 0, 0]).F[2]).toBeCloseTo(-2 * 4, 9);
  });

  it("una carga puntual en la losa cae en un nudo de la malla en su punto exacto", () => {
    const r = valido(compilar(base({ cargas: [{ tipo: "puntual", id: "F", caso: "Q", planta: "P1", x: 2.37, y: 3.11, F: [0, 0, -10] }] }), { tamanoMalla: 0.5 }));
    const cn = r.modelo.casos[1]!.nodales!;
    expect(cn).toHaveLength(1);
    const n = r.modelo.nudos[cn[0]!.nudo]!;
    expect([n.x, n.y]).toEqual([2.37, 3.11]);
    expect(cn[0]!.f.slice(3).every((v) => v === 0)).toBe(true);
  });
});

describe("criterio 3 de C2: validador de la malla en plantas al azar", () => {
  it("orientación +Z, jacobiano > 0 y Σ áreas = área de la losa (con lo que avisa C2-b)", () => {
    let jmin = Infinity;
    for (let s = 1; s <= 12; s++) {
      const f = conLosasAleatorias(fisicoAleatorio(s), s);
      const r = valido(compilar(f));
      const m = r.modelo;
      const areas = new Map<string, number>();
      m.laminas!.forEach((l, i) => {
        const X = l.nudos.map((n) => [m.nudos[n]!.x, m.nudos[n]!.y] as Vec2);
        let a = 0;
        for (let k = 0; k < 4; k++) a += (X[k]![0] * X[(k + 1) % 4]![1] - X[(k + 1) % 4]![0] * X[k]![1]) / 2;
        expect(a, `semilla ${s}, ${l.id}`).toBeGreaterThan(0);
        const j = jacobianoEscalado(X);
        expect(j).toBeGreaterThan(0);
        jmin = Math.min(jmin, j);
        const losa = r.mapeo.laminas![i]!.losa;
        areas.set(losa, (areas.get(losa) ?? 0) + a);
      });
      for (const l of f.losas!) {
        const ajuste = r.diagnosticos.find((d) => d.codigo === "losa/ajuste" && d.ids?.[0] === l.id)?.detalles?.area ?? 0;
        const A = momentosRegion({ contorno: l.contorno, huecos: l.huecos ?? [] }).A + (ajuste as number);
        expect(Math.abs(areas.get(l.id)! - A) / A, `semilla ${s}, ${l.id}`).toBeLessThan(1e-9);
      }
      // Sin nudos sueltos: todo nudo de losa está en alguna lámina
      const enLaminas = new Set(m.laminas!.flatMap((l) => [...l.nudos]));
      r.mapeo.nudos.forEach((n, i) => {
        if (n.fisicos.some((x) => x.startsWith("L-")) && !n.fisicos.some((x) => !x.startsWith("L-"))) expect(enLaminas.has(i)).toBe(true);
      });
    }
    expect(jmin).toBeGreaterThan(0.02);
  });
});

describe("criterio 5 de C2: sin pérdidas y equilibrio en modelos al azar", () => {
  it("≤ 1e-9 en cada compilación y en el motor", () => {
    let peor = 0;
    for (let s = 1; s <= 16; s++) {
      for (const eje1 of ["x", "azar"] as const) {
        const r = valido(compilar(conLosasAleatorias(fisicoAleatorio(s, { diafragma: s % 3 !== 0 }), s, { eje1 })));
        peor = Math.max(peor, r.estadisticas.sinPerdidas.fuerzas, r.estadisticas.sinPerdidas.momentos);
        const c = calcular(r.modelo);
        expect(c.valido, `semilla ${s}`).toBe(true);
        if (c.valido) for (const k of c.casos) expect(Math.max(k.equilibrio.fuerzas, k.equilibrio.momentos)).toBeLessThan(1e-9);
      }
    }
    expect(peor).toBeLessThan(1e-9);
  });
});
