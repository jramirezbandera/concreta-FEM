/**
 * C5.2: esfuerzos de las bandas (criterio 2, integración exacta) y Wood–Armer por combinación
 * (criterio 3), en la losa plana de 3 × 3 vanos de 6 × 5 m con las bandas propuestas.
 *
 * Con `franjas: false` (fase F): con las franjas, las caras de las bandas son las de las franjas y no
 * se siembran a lo ancho de cada banda; estas pruebas son las de C5, con las caras de las bandas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { woodArmer } from "../dimensionado/woodArmer.ts";
import { calcular } from "../motor/calcular.ts";
import { Cortes } from "../motor/cortes.ts";
import type { ResultadoCaso } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { proponerBandas } from "./bandas.ts";
import { compilar } from "./compilar.ts";
import { EsfuerzosBandas, woodArmerEstacion } from "./esfuerzosBandas.ts";
import type { ModeloFisico, Pilar, Vec2 } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const Q = 10;

/** Losa plana a ejes de 18 × 15 m sobre 16 pilares de 30 × 30; casos G (peso) y Q (10 kN/m²). */
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
    losas: [{ id: "L", planta: "P1", contorno: rect(0, 0, 18, 15), espesor: 0.25, material: "HA" }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -Q] }],
  };
}

let fisico: ModeloFisico;
let eb: EsfuerzosBandas;
let casos: ResultadoCaso[];
let cortes: Cortes;

beforeAll(() => {
  const f = losaPlana();
  fisico = { ...f, bandas: proponerBandas(f).bandas };
  const r = compilar(fisico, { tamanoMalla: 0.5, franjas: false, empotramientoCabeza: 1 });
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  casos = casosValidos(calcular(r.modelo));
  eb = new EsfuerzosBandas(fisico, r.modelo, casos);
  cortes = new Cortes(r.modelo);
});

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);

describe("estaciones de las bandas (C5.2)", () => {
  it("las caras de los pilares de la alineación y el centro de cada vano", () => {
    const e = eb.estaciones("L:1:P2")!;
    expect(e.map((x) => [x.tipo, Number(x.s.toFixed(9))])).toEqual([
      ["cara", 0.15],
      ["vano", 3],
      ["cara", 5.85],
      ["cara", 6.15],
      ["vano", 9],
      ["cara", 11.85],
      ["cara", 12.15],
      ["vano", 15],
      ["cara", 17.85],
    ]);
    expect(e.every((x) => x.valido)).toBe(true);
    expect(eb.estaciones("no-existe")).toBeNull();
  });
});

describe("integración exacta (C5, criterio 2)", () => {
  it("en una línea de caras, la suma de las bandas que la cruzan es el corte de toda la losa (≤ 1e-9)", () => {
    const ids = eb.bandas.filter((id) => id.startsWith("L:1:"));
    const enCara = (id: string) => eb.estaciones(id)!.find((x) => x.tipo === "cara" && Math.abs(x.s - 5.85) < 1e-9)!;
    const toda = cortes.cortar({ origen: [5.85, 7.5, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-7.5, 7.5], z: [0, 0] }, casos);
    expect(toda.valido).toBe(true);
    for (const k of [0, 1]) {
      // My y Vz de cada banda, llevados al origen del corte entero (el My no cambia: las fuerzas están en el plano)
      let My = 0;
      let Vz = 0;
      for (const id of ids) {
        const e = enCara(id);
        My += e.esfuerzos[6 * k + 4]!;
        Vz += e.esfuerzos[6 * k + 2]!;
      }
      expect(rel(My, toda.esfuerzos[6 * k + 4]!)).toBeLessThan(1e-9);
      expect(rel(Vz, toda.esfuerzos[6 * k + 2]!)).toBeLessThan(1e-9);
    }
  });

  it("con pilares de tamaños distintos, la cara común de cada línea sale recta en la malla: todas las caras son válidas y suman el corte de toda la losa (C5-g)", () => {
    // Pilares de 30 × 30 y 40 × 40 alternos: cada línea corta por la cara del de 30, 5 cm dentro de
    // la huella del de 40; con el h por defecto, en la rejilla alineada con sus plantillas
    const base = losaPlana();
    const f0: ModeloFisico = {
      ...base,
      secciones: [...base.secciones, { id: "p40", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 }],
      pilares: base.pilares!.map((p) => ((p.x / 6 + p.y / 5) % 2 ? { ...p, seccion: "p40" } : p)),
    };
    const f = { ...f0, bandas: proponerBandas(f0).bandas };
    const r = compilar(f, { franjas: false, empotramientoCabeza: 1 });
    if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
    expect(r.estadisticas.malla.plantillas).toBe(16);
    const cs = casosValidos(calcular(r.modelo));
    const e2 = new EsfuerzosBandas(f, r.modelo, cs);
    const todas = e2.bandas.flatMap((id) => e2.estaciones(id)!);
    expect(todas.filter((x) => x.tipo === "cara")).toHaveLength(14 * 6);
    expect(todas.every((x) => x.valido)).toBe(true);
    const ids = e2.bandas.filter((id) => id.startsWith("L:1:"));
    const toda = new Cortes(r.modelo).cortar({ origen: [5.85, 7.5, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-7.5, 7.5], z: [0, 0] }, cs);
    expect(toda.valido).toBe(true);
    for (const k of [0, 1]) {
      let My = 0;
      for (const id of ids) My += e2.estaciones(id)!.find((x) => x.tipo === "cara" && Math.abs(x.s - 5.85) < 1e-9)!.esfuerzos[6 * k + 4]!;
      expect(rel(My, toda.esfuerzos[6 * k + 4]!)).toBeLessThan(1e-9);
    }
  });

  it("el trozo de losa entre las caras de un vano está en equilibrio con su carga (≤ 1e-9)", () => {
    // Pórtico virtual entero (toda la losa) entre x = 6,15 y x = 11,85, caso Q
    const [a, b] = [6.15, 11.85];
    const corte = (x: number) => cortes.cortar({ origen: [x, 7.5, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-7.5, 7.5], z: [0, 0] }, casos);
    const [A, B] = [corte(a), corte(b)];
    const L = b - a;
    const carga = Q * 15 * L;
    const k = 1;
    const [VzA, VzB, MyA, MyB] = [A.esfuerzos[6 * k + 2]!, B.esfuerzos[6 * k + 2]!, A.esfuerzos[6 * k + 4]!, B.esfuerzos[6 * k + 4]!];
    // ΣFz = 0 y ΣMy = 0 del trozo (lo que el lado −x de A y el +x de B ejercen sobre él, y su carga)
    expect(Math.abs(VzB - VzA - carga) / carga).toBeLessThan(1e-9);
    expect(Math.abs(MyB - MyA - L * VzB + (carga * L) / 2) / ((carga * L) / 2)).toBeLessThan(1e-9);
  });
});

describe("reparto entre bandas de pilares y centrales (C5-d)", () => {
  it("en cada línea de caras y de vanos, las sumas de las bandas de la línea; aviso sólo fuera de la tabla I.1", () => {
    const { lineas, diagnosticos } = eb.reparto("L", [1, 0], [0, 1]);
    // Líneas de caras y de vanos de las bandas según X: cuatro líneas de pilares y tres vanos
    expect(lineas.filter((l) => l.tipo === "vano").map((l) => l.s)).toEqual([3, 9, 15]);
    for (const l of lineas) {
      // Las sumas son las de las estaciones de la línea (con las caras comunes, todas en la misma recta)
      let [p, c] = [0, 0];
      for (const id of eb.bandas.filter((x) => x.startsWith("L:1:"))) {
        const e = eb.estaciones(id)!.find((x) => x.tipo === l.tipo && Math.abs(x.s - l.s) < 1e-9);
        if (!e) continue;
        if (id.includes(":P")) p += e.esfuerzos[6 + 4]!;
        else c += e.esfuerzos[6 + 4]!;
      }
      expect(l.pilares).toBeCloseTo(p, 9);
      expect(l.centrales).toBeCloseTo(c, 9);
    }
    // Las caras de los pilares interiores, con negativos en las dos sumas: dentro del 60–80 %
    const interiores = lineas.filter((l) => l.tipo === "cara" && l.s > 1 && l.s < 17);
    expect(interiores.length).toBe(4);
    for (const l of interiores) expect(l.fraccion).toBeGreaterThan(0.6);
    // Un aviso por cada línea fuera de su rango, con el id de la losa
    expect(diagnosticos.length).toBe(lineas.filter((l) => l.fuera).length);
    expect(diagnosticos.every((d) => d.codigo === "banda/reparto" && d.ids![0] === "L")).toBe(true);
  });
});

describe("huecos y bandas editadas (C5, criterio 1)", () => {
  it("un hueco que corta las bandas: el ancho en losa de cada estación, y una estación entera en el hueco no vale", () => {
    // Hueco [8, 10] × [6, 9] en el vano x = 6–12: tapa la central y = 6,25–8,75 entera en x = 9 y
    // 0,25 m de cada banda de pilares vecina
    const base = losaPlana();
    const f0: ModeloFisico = { ...base, losas: [{ ...base.losas![0]!, huecos: [rect(8, 6, 10, 9)] }], cargas: [] };
    const f = { ...f0, bandas: proponerBandas(f0).bandas };
    const r = compilar(f, { tamanoMalla: 0.5, franjas: false, empotramientoCabeza: 1 });
    if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
    const cs = casosValidos(calcular(r.modelo));
    const e2 = new EsfuerzosBandas(f, r.modelo, cs);
    const en = (id: string, s: number) => e2.estaciones(id)!.find((x) => Math.abs(x.s - s) < 1e-9)!;
    const central = en("L:1:C2-3", 9);
    expect(central.valido).toBe(false);
    expect(central.anchoEnLosa).toBe(0);
    expect(central.diagnosticos.map((d) => d.codigo)).toContain("banda/estacion-sin-losa");
    expect(Array.from(central.medios).every(Number.isNaN)).toBe(true);
    for (const id of ["L:1:P2", "L:1:P3"]) {
      const e = en(id, 9);
      expect(e.valido).toBe(true);
      expect(e.anchoEnLosa).toBeCloseTo(2.25, 12);
      expect(e.medios[0]).toBeCloseTo(e.esfuerzos[4]! / 2.25, 12);
    }
    // Las demás estaciones, enteras en la losa: el ancho de la banda, exacto
    expect(en("L:1:P2", 3).anchoEnLosa).toBe(2.5);
    // Las bandas que cruzan x = 9 suman el corte de toda la losa (el hueco no tiene nada)
    const toda = new Cortes(r.modelo).cortar({ origen: [9, 7.5, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-7.5, 7.5], z: [0, 0], metodo: "campos" }, cs, (e2 as unknown as { campos: import("../motor/campos.ts").CamposLaminas }).campos);
    let My = 0;
    for (const id of e2.bandas.filter((x) => x.startsWith("L:1:"))) My += en(id, 9).esfuerzos[4]!;
    expect(rel(My, toda.esfuerzos[4]!)).toBeLessThan(1e-9);
  });

  it("las bandas editadas se respetan tal cual: su geometría en la malla y en sus estaciones", () => {
    const f0 = losaPlana();
    const propuestas = proponerBandas(f0).bandas;
    // La de pilares de y = 5, movida 0,5 m y con 2 m de ancho; y una nueva, sin apoyos, en y = 13. Lo
    // editado a menos de ε_snap de otra línea se une a ella, como cualquier geometría (C2)
    const bandas = propuestas.map((b) => (b.id === "L:1:P2" ? { ...b, desde: [0, 5.5] as Vec2, hasta: [18, 5.5] as Vec2, ancho: 2, origen: "usuario" as const } : b));
    bandas.push({ id: "U", planta: "P1", desde: [1, 13], hasta: [17, 13], ancho: 1, origen: "usuario" });
    const f = { ...f0, bandas };
    const r = compilar(f, { tamanoMalla: 0.5, franjas: false, empotramientoCabeza: 1 });
    if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
    // Sus bordes, en la malla (y = 4,5 y 6,5; y = 12,5 y 13,5 de x = 1 a 17)
    const enLinea = (y: number, x0: number, x1: number) => r.modelo.nudos.filter((n) => Math.abs(n.y - y) < 1e-9 && n.x > x0 + 0.1 && n.x < x1 - 0.1).length;
    for (const y of [4.5, 6.5]) expect(enLinea(y, 0, 18)).toBeGreaterThan(10);
    for (const y of [12.5, 13.5]) expect(enLinea(y, 1, 17)).toBeGreaterThan(10);
    const cs = casosValidos(calcular(r.modelo));
    const e2 = new EsfuerzosBandas(f, r.modelo, cs);
    const est = e2.estaciones("L:1:P2")!;
    expect(est.every((x) => x.ancho === 2 && x.punto[1] === 5.5 && x.valido)).toBe(true);
    // Sin apoyos no hay estaciones
    expect(e2.estaciones("U")).toEqual([]);
  });
});

describe("reticular: momento por nervio (C4-j)", () => {
  it("es My·s/b en losa, con la parte del ancho en ábacos; en una maciza no hay", () => {
    expect(eb.estaciones("L:1:P2")!.every((e) => e.nervio === null)).toBe(true);
    const base = losaPlana();
    const abacos = base.pilares!.map((p) => rect(p.x - 1, p.y - 1, p.x + 1, p.y + 1));
    const f0: ModeloFisico = { ...base, losas: [{ ...base.losas![0]!, espesor: 0.35, reticular: { intereje: 0.82, nervio: 0.12, capa: 0.05, caseton: "recuperable", abacos } }] };
    const f = { ...f0, bandas: proponerBandas(f0).bandas };
    const r = compilar(f, { tamanoMalla: 0.5, franjas: false, empotramientoCabeza: 1 });
    if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
    const e2 = new EsfuerzosBandas(f, r.modelo, casosValidos(calcular(r.modelo)));
    const est = e2.estaciones("L:1:P2")!;
    for (const e of est) {
      for (let k = 0; k < 2; k++) expect(e.nervio!.momentos[k]).toBeCloseTo((e.esfuerzos[6 * k + 4]! * 0.82) / e.anchoEnLosa, 9);
      expect(e.nervio!.intereje).toBe(0.82);
    }
    // Los ábacos (2 m > lx/3) dan el ancho de la banda de pilares: en la cara de un pilar, entera en el
    // ábaco; en el vano, nada
    expect(est.find((e) => e.tipo === "cara" && Math.abs(e.s - 5.85) < 1e-9)!.nervio!.fraccionAbaco).toBeCloseTo(1, 9);
    expect(est.find((e) => e.tipo === "vano")!.nervio!.fraccionAbaco).toBe(0);
  });
});

describe("Wood–Armer en las bandas (C5, criterio 3)", () => {
  it("por combinación, con los momentos medios, es woodArmer de su combinación de casos", () => {
    const e = eb.estaciones("L:1:P2")!.find((x) => x.tipo === "cara")!;
    const combinaciones = [Float64Array.from([1.35, 1.5]), Float64Array.from([1, 0])];
    const { porCombinacion, envolvente } = woodArmerEstacion(e, combinaciones);
    combinaciones.forEach((f, c) => {
      const m = [0, 1, 2].map((q) => f[0]! * e.medios[q]! + f[1]! * e.medios[3 + q]!);
      expect(porCombinacion[c]).toEqual(woodArmer(m[0]!, m[1]!, m[2]!));
    });
    // la envolvente no pierde el máximo y guarda la combinación (la ELU, aquí)
    expect(envolvente.valores.superiorX).toBe(Math.max(...porCombinacion.map((p) => p.superiorX)));
    expect(envolvente.combinacion.superiorX).toBe(0);
    // en la cara del pilar manda el negativo (cara superior) en la dirección de la banda
    expect(envolvente.valores.superiorX).toBeGreaterThan(0);
    expect(envolvente.valores.inferiorX).toBe(0);
  });

  it("mx medio es el My del corte entre el ancho, y las muestras punto a punto integran ese My exacto", () => {
    const e = eb.estaciones("L:1:P2")!.find((x) => x.tipo === "vano")!;
    expect(e.medios[3] * e.ancho).toBeCloseTo(e.esfuerzos[6 + 4]!, 9);
    const [a, b] = ["medios", "puntos"].map((m) => woodArmerEstacion(e, [Float64Array.from([0, 1])], m as "medios" | "puntos").porCombinacion[0]!);
    // en el vano, momento positivo: los dos métodos dan armadura inferior en x y se parecen
    expect(a!.inferiorX).toBeGreaterThan(0);
    expect(Math.abs(b!.inferiorX - a!.inferiorX) / a!.inferiorX).toBeLessThan(0.15);
  });
});
