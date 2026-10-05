/**
 * Criterio 3 de C4 y comportamiento de los forjados:
 * - batería de plantas al azar (`forjadosAleatorios.ts`) con paños unidireccionales (oblicuos, con
 *   huecos, contiguos y balcones) y reticulares con ábacos (también los de fachada, que se salen):
 *   todas compilan, «sin pérdidas» ≤ 1e-9, el cálculo es válido (sin mecanismos) y en equilibrio;
 * - unidireccional: viguetas, mapeo, torsión liberada, continuidad, diafragma, pesos, avisos,
 *   modificadores y esfuerzos por vigueta;
 * - reticular: multiplicadores y ν de la zona aligerada, ábacos macizos y su peso;
 * - regresiones de la malla de C2 que encontró C4.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { fisicoAleatorio } from "../pruebas/fisicoAleatorio.ts";
import { conForjadosAleatorios } from "../pruebas/forjadosAleatorios.ts";
import { planos, transformar, valido } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico, Vec2 } from "./fisico.ts";
import { momentosInterseccion } from "./poligonos.ts";
import { EsfuerzosPiezas } from "./resultados.ts";
import { multiplicadoresReticular, volumenReticular } from "./reticular.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Un recuadro de 5 × 6 m sobre cuatro pilares con sus vigas y un paño de viguetas según X. */
function recuadro(o: { diafragma?: "ninguno"; pp?: number } = {}): ModeloFisico {
  return {
    plantas: [
      { id: "P1", altura: null, ...(o.diafragma ? { diafragma: o.diafragma } : {}) },
      { id: "P0", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
      { id: "T", material: "HA", forma: "T", bf: 0.75, hf: 0.05, bw: 0.12, h: 0.3 },
    ],
    pilares: (
      [
        [0, 0],
        [5, 0],
        [5, 6],
        [0, 6],
      ] as const
    ).map(([x, y], i) => ({ id: `C${i}`, x, y, desde: "P0", hasta: "P1", seccion: "p" })),
    vigas: [
      { id: "VA", planta: "P1", puntos: [[0, 0], [0, 6]], seccion: "v" },
      { id: "VB", planta: "P1", puntos: [[5, 0], [5, 6]], seccion: "v" },
      { id: "VC", planta: "P1", puntos: [[0, 0], [5, 0]], seccion: "v" },
      { id: "VD", planta: "P1", puntos: [[0, 6], [5, 6]], seccion: "v" },
    ],
    panos: [{ id: "F", planta: "P1", contorno: rect(0, 0, 5, 6), direccion: 0, intereje: 0.75, seccion: "T", pp: o.pp ?? 3 }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [{ tipo: "superficie", id: "S", caso: "Q", planta: "P1", pano: "F", q: [0, 0, -2] }],
  };
}

describe("criterio 3 de C4: batería de plantas al azar con forjados", () => {
  const tipos = [undefined, "unidireccional", "reticular"] as const;
  for (const tipo of tipos)
    it(`${tipo ?? "mixtas"}: todas compilan sin pérdidas y calculan en equilibrio, sin mecanismos`, () => {
      for (let s = 1; s <= 12; s++) {
        const r = valido(compilar(conForjadosAleatorios(fisicoAleatorio(s), s, tipo ? { tipo } : {})));
        expect(r.estadisticas.sinPerdidas.fuerzas, `semilla ${s}`).toBeLessThan(1e-9);
        expect(r.estadisticas.sinPerdidas.momentos, `semilla ${s}`).toBeLessThan(1e-9);
        const c = calcular(r.modelo);
        expect(c.valido, `semilla ${s}: ${c.diagnosticos.map((d) => d.codigo).join(", ")}`).toBe(true);
        if (!c.valido) continue;
        expect(c.diagnosticos.filter((d) => d.codigo.startsWith("solver/mecanismo")), `semilla ${s}`).toEqual([]);
        for (const k of c.casos) expect(Math.max(k.equilibrio.fuerzas, k.equilibrio.momentos), `semilla ${s}`).toBeLessThan(1e-9);
        if (tipo === "unidireccional") expect(r.estadisticas.forjados.viguetas, `semilla ${s}`).toBeGreaterThan(0);
        if (tipo === "reticular") expect(r.estadisticas.forjados.laminasAbaco, `semilla ${s}`).toBeGreaterThan(0);
      }
    });
});

describe("C4: unidireccional", () => {
  it("las viguetas: rectas centradas, piezas en el mapeo, nudos sobre las vigas y la torsión liberada en su primer extremo", () => {
    const r = valido(compilar(recuadro()));
    const ids = r.mapeo.panos!.F!;
    expect(ids.length).toBe(8);
    expect(r.estadisticas.forjados).toMatchObject({ panos: 1, viguetas: 8, nudosViguetas: 16, voladizos: 0 });
    ids.forEach((v, j) => {
      const [b] = r.mapeo.piezas[v]!;
      const barra = r.modelo.barras[b!]!;
      expect(r.mapeo.barras[b!]).toMatchObject({ pieza: v, tipo: "vigueta", pano: "F" });
      expect(barra.liberaciones).toEqual({ i: [false, false, false, true, false, false] });
      const [ni, nj] = barra.nudos.map((n) => r.modelo.nudos[n]!);
      expect([ni!.x, ni!.y, nj!.x, nj!.y]).toEqual([0, 0.375 + 0.75 * j, 5, 0.375 + 0.75 * j]);
    });
    expect(r.hipotesis.some((h) => h.includes("viguetas-barra"))).toBe(true);
  });

  it("el diafragma rígido de la planta abarca los nudos de las viguetas; sin él, aviso (C4-g)", () => {
    const r = valido(compilar(recuadro()));
    const d = r.modelo.restricciones!.find((x) => x.tipo === "diafragma")!;
    const conVigueta = r.modelo.barras.filter((_, i) => r.mapeo.barras[i]!.tipo === "vigueta").flatMap((b) => [...b.nudos]);
    for (const n of conVigueta) expect(d.esclavos).toContain(n);
    const s = valido(compilar(recuadro({ diafragma: "ninguno" })));
    expect(s.diagnosticos.map((x) => x.codigo)).toContain("pano/sin-diafragma");
    expect(s.modelo.restricciones?.some((x) => x.tipo === "diafragma") ?? false).toBe(false);
  });

  it("peso propio: el pp del paño y las vigas por su descuelgue (C2-g con el canto de la vigueta)", () => {
    const r = valido(compilar(recuadro()));
    const [g] = casosValidos(calcular(r.modelo));
    let Rz = 0;
    for (let i = 2; i < g!.reacciones.length; i += 6) Rz += g!.reacciones[i]!;
    const vigas = 2 * (5 + 6) * 25 * (0.3 * 0.5 - 0.15 * 0.3);
    const pilares = 4 * 3 * 25 * 0.09;
    expect(Rz).toBeCloseTo(3 * 30 + vigas + pilares, 9);
  });

  it("dos paños contiguos con la misma dirección comparten nudos (viguetas continuas); con otro intereje, no", () => {
    const dos = (s2: number): ModeloFisico => {
      const f = recuadro();
      return {
        ...f,
        pilares: [...f.pilares!, { id: "C4", x: 10, y: 0, desde: "P0", hasta: "P1", seccion: "p" }, { id: "C5", x: 10, y: 6, desde: "P0", hasta: "P1", seccion: "p" }],
        vigas: [...f.vigas!.filter((v) => v.id !== "VC" && v.id !== "VD"), { id: "VE", planta: "P1", puntos: [[10, 0], [10, 6]], seccion: "v" }, { id: "VC", planta: "P1", puntos: [[0, 0], [10, 0]], seccion: "v" }, { id: "VD", planta: "P1", puntos: [[0, 6], [10, 6]], seccion: "v" }],
        panos: [...f.panos!, { id: "F2", planta: "P1", contorno: rect(5, 0, 10, 6), direccion: 180, intereje: s2, seccion: "T", pp: 3 }],
      };
    };
    const nudosEn5 = (r: ReturnType<typeof valido>, p: string) => new Set(r.mapeo.panos![p]!.flatMap((v) => r.mapeo.piezas[v]!.flatMap((b) => [...r.modelo.barras[b]!.nudos])).filter((n) => r.modelo.nudos[n]!.x === 5));
    const a = valido(compilar(dos(0.75)));
    expect([...nudosEn5(a, "F2")].sort()).toEqual([...nudosEn5(a, "F")].sort());
    const b = valido(compilar(dos(0.6)));
    const comunes = [...nudosEn5(b, "F2")].filter((n) => nudosEn5(b, "F").has(n));
    expect(comunes.length).toBeLessThan(nudosEn5(b, "F").size);
  });

  it("un contorno a 3 cm del eje de las vigas se une a él con aviso, y las viguetas acaban en los ejes", () => {
    const f = recuadro();
    const g: ModeloFisico = { ...f, panos: [{ ...f.panos![0]!, contorno: [[0.03, 0], [5, 0], [5, 6], [0.03, 6]] }] };
    const r = valido(compilar(g));
    expect(r.diagnosticos.map((d) => d.codigo)).toContain("pano/ajuste");
    for (const v of r.mapeo.panos!.F!) {
      const barra = r.modelo.barras[r.mapeo.piezas[v]![0]!]!;
      expect(r.modelo.nudos[barra.nudos[0]]!.x).toBe(0);
      expect(barra.offsets).toBeUndefined();
    }
  });

  it("los modificadores de las viguetas van a sus barras y a las hipótesis", () => {
    const r = valido(compilar(recuadro(), { modificadores: { viguetas: { hormigon: { Iy: 0.5 } } } }));
    for (const v of r.mapeo.panos!.F!) expect(r.modelo.barras[r.mapeo.piezas[v]![0]!]!.modificadores).toEqual({ Iy: 0.5 });
    expect(r.hipotesis.some((h) => h.includes("viguetas de hormigón: Iy ×0,5"))).toBe(true);
  });

  it("esfuerzos por vigueta (EsfuerzosPiezas): la interior lleva q·s·L/2 de cortante en sus apoyos", () => {
    const r = valido(compilar(recuadro({ pp: 0 })));
    const ep = new EsfuerzosPiezas(r.modelo, r.mapeo, casosValidos(calcular(r.modelo)));
    const v = r.mapeo.panos!.F![3]!;
    const t = ep.tramos(v);
    expect(t[0]!.s0).toBe(0);
    expect(t[t.length - 1]!.s1).toBe(5);
    const qsL2 = (2 * 0.75 * 5) / 2;
    expect(ep.en(v, 1, 0)![2]!).toBeCloseTo(-qsL2, 9);
    expect(ep.en(v, 1, 5)![2]!).toBeCloseTo(qsL2, 9);
  });

  it("una carga lineal paralela a las viguetas entre dos de ellas se reparte por la palanca", () => {
    const f = recuadro({ pp: 0 });
    const g: ModeloFisico = { ...f, cargas: [{ tipo: "lineal", id: "L", caso: "Q", planta: "P1", puntos: [[1, 2], [4, 2]], q: [0, 0, -6] }] };
    const r = valido(compilar(g));
    const ep = new EsfuerzosPiezas(r.modelo, r.mapeo, casosValidos(calcular(r.modelo)));
    // Entre las viguetas de 1,875 (v3) y 2,625 (v4), a 1/6 de la primera
    const reaccion = (v: string) => ep.en(v, 1, 5)![2]! - ep.en(v, 1, 0)![2]!;
    expect(reaccion(r.mapeo.panos!.F![2]!)).toBeCloseTo(6 * 3 * (5 / 6), 9);
    expect(reaccion(r.mapeo.panos!.F![3]!)).toBeCloseTo(6 * 3 * (1 / 6), 9);
  });
});

describe("C4: reticular", () => {
  const reticular = (pp?: number, multiplicadores?: object): ModeloFisico => ({
    plantas: [{ id: "P0", altura: null }],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [],
    losas: [{ id: "L", planta: "P0", contorno: rect(0, 0, 6, 6), espesor: 0.35, material: "H", ...(pp !== undefined ? { pp } : {}), reticular: { intereje: 0.82, nervio: 0.12, capa: 0.05, abacos: [rect(2, 2, 4, 4), rect(5, 5, 7, 7)], ...(multiplicadores ? { multiplicadores } : {}) } }],
    apoyosLineales: [{ id: "A", planta: "P0", puntos: [[0, 0], [6, 0], [6, 6], [0, 6], [0, 0]], coartados: [true, true, true, false, false, false] }],
    casos: [{ id: "G", pesoPropio: true }],
  });

  it("la zona aligerada lleva los multiplicadores del emparrillado con ν = 0; los ábacos, macizos con el ν del material", () => {
    const r = valido(compilar(reticular()));
    const m = multiplicadoresReticular({ h: 0.35, hf: 0.05, bw: 0.12, s: 0.82 }, 0.2);
    let areaAbaco = 0;
    r.modelo.laminas!.forEach((l, i) => {
      if (r.mapeo.laminas![i]!.abaco) {
        expect(l.multiplicadores).toBeUndefined();
        expect(l.material.nu).toBeCloseTo(0.2, 12);
        const X = l.nudos.map((n) => [r.modelo.nudos[n]!.x, r.modelo.nudos[n]!.y] as Vec2);
        let a = 0;
        for (let k = 0; k < 4; k++) a += X[k]![0] * X[(k + 1) % 4]![1] - X[(k + 1) % 4]![0] * X[k]![1];
        areaAbaco += a / 2;
      } else {
        expect(l.multiplicadores).toEqual(m);
        expect(l.material.nu).toBe(0);
      }
    });
    // El ábaco de la esquina se sale: cuenta su parte dentro (1 m²)
    expect(areaAbaco).toBeCloseTo(4 + 1, 9);
    expect(r.estadisticas.forjados.laminasAbaco).toBeGreaterThan(0);
    expect(r.hipotesis.some((h) => h.includes("Forjado reticular L"))).toBe(true);
  });

  it("peso propio: γ·volumen en la zona aligerada y γ·h en los ábacos; con pp, el mismo en toda la losa", () => {
    const peso = (f: ModeloFisico) => {
      const r = valido(compilar(f));
      const [g] = casosValidos(calcular(r.modelo));
      let Rz = 0;
      for (let i = 2; i < g!.reacciones.length; i += 6) Rz += g!.reacciones[i]!;
      return Rz;
    };
    const v = 25 * volumenReticular({ h: 0.35, hf: 0.05, bw: 0.12, s: 0.82 });
    const abaco = momentosInterseccion({ contorno: rect(0, 0, 6, 6), huecos: [] }, rect(2, 2, 4, 4)).A + 1;
    expect(peso(reticular())).toBeCloseTo(v * (36 - abaco) + 25 * 0.35 * abaco, 8);
    expect(peso(reticular(4.5))).toBeCloseTo(4.5 * 36, 8);
  });

  it("los multiplicadores dados se aplican sobre la maciza con el ν del material", () => {
    const r = valido(compilar(reticular(undefined, { m11: 0.3, m22: 0.3 })));
    const l = r.modelo.laminas!.find((_, i) => !r.mapeo.laminas![i]!.abaco)!;
    expect(l.multiplicadores).toEqual({ m11: 0.3, m22: 0.3 });
    expect(l.material.nu).toBeCloseTo(0.2, 12);
  });
});

describe("regresiones de la malla de C2 que encontró C4", () => {
  /**
   * Las plantas de un modelo al azar con losas macizas en lugar de reticulares, y sus ábacos (que
   * en las esquinas y en las fachadas se salen de la losa) como zonas de carga o como bandas.
   */
  const macizas = (s: number, como: "zonas" | "bandas", reticulares = false): ModeloFisico => {
    const f = conForjadosAleatorios(fisicoAleatorio(s), s, reticulares ? { tipo: "reticular" } : {});
    const ab = (f.losas ?? []).flatMap((l) => (l.reticular?.abacos ?? []).map((a, i) => ({ l, a, i })));
    return {
      ...f,
      losas: (f.losas ?? []).map((l) => ({ ...l, reticular: undefined })),
      cargas: [...f.cargas!, ...(como === "zonas" ? ab.map(({ l, a, i }) => ({ tipo: "superficie" as const, id: `Z${i}-${l.id}`, caso: "Q", planta: l.planta, zona: a, q: [0, 0, -1] as [number, number, number] })) : [])],
      ...(como === "bandas" ? { bandas: ab.map(({ l, a, i }) => ({ id: `B${i}-${l.id}`, planta: l.planta, desde: [a[0]![0], (a[0]![1] + a[2]![1]) / 2] as Vec2, hasta: [a[1]![0], (a[0]![1] + a[2]![1]) / 2] as Vec2, ancho: a[2]![1] - a[0]![1] })) } : {}),
    };
  };

  it("una zona o una banda que se sale de la losa junto a un pilar de esquina: la malla cubre la losa (arista de plantilla por el borde, obligatoria)", () => {
    for (const como of ["zonas", "bandas"] as const) {
      const r = valido(compilar(macizas(8, como, true)));
      expect(r.estadisticas.malla.plantillas, como).toBeGreaterThan(0);
      expect(r.estadisticas.sinPerdidas.fuerzas, como).toBeLessThan(1e-9);
    }
  });

  it("zonas que se salen de la losa en plantas giradas 37°: la triangulación no falla (los lados enteros fuera de la losa no son obligatorios)", () => {
    const giro = planos()[2]!.t;
    for (const s of [5, 6]) {
      const r = valido(compilar(transformar(macizas(s, "zonas"), giro)));
      expect(r.estadisticas.sinPerdidas.fuerzas, `semilla ${s}`).toBeLessThan(1e-9);
    }
  });
});
