/**
 * C5.1: bandas propuestas (Anejo I del EC2, D5) frente a un cálculo a mano (criterio 1), su
 * determinismo y sus metamórficas (criterio 7), y que se compilan como cualquier banda (C2).
 */
import { describe, expect, it } from "vitest";
import { proponerBandas } from "./bandas.ts";
import { compilar } from "./compilar.ts";
import type { Banda, Losa, ModeloFisico, Pilar, Vec2 } from "./fisico.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Losa plana de 3 × 3 vanos de 6 × 5 m sobre 16 pilares de 30 × 30, dibujada a ejes salvo que se diga. */
function losaPlana(o: { contorno?: Vec2[]; huecos?: Vec2[][]; pilares?: Pilar[]; reticular?: Losa["reticular"]; bandas?: Banda[] } = {}): ModeloFisico {
  const pilares: Pilar[] = [];
  for (const x of [0, 6, 12, 18]) for (const y of [0, 5, 10, 15]) pilares.push({ id: `P${x}-${y}`, x, y, desde: "C", hasta: "P1", seccion: "p" });
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "C", tipo: "sotano", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 }],
    pilares: o.pilares ?? pilares,
    losas: [{ id: "L", planta: "P1", contorno: o.contorno ?? rect(0, 0, 18, 15), ...(o.huecos ? { huecos: o.huecos } : {}), espesor: 0.25, material: "HA", ...(o.reticular ? { reticular: o.reticular } : {}) }],
    ...(o.bandas ? { bandas: o.bandas } : {}),
    casos: [{ id: "G", pesoPropio: true }],
    cargas: [],
  };
}

/** Banda por id, con su eje transversal (t del centro), su tramo [s0, s1] y su ancho. */
function porId(bandas: Banda[]) {
  return new Map(bandas.map((b) => [b.id, b]));
}

describe("bandas propuestas frente a un cálculo a mano (C5.1, criterio 1)", () => {
  it("retícula regular a ejes: lx/4 a cada lado, nada fuera de la losa en las de borde, y las centrales que faltan", () => {
    const { bandas, diagnosticos } = proponerBandas(losaPlana());
    expect(diagnosticos).toEqual([]);
    // 4 de pilares y 3 centrales en cada dirección
    expect(bandas.filter((b) => b.tipo === "pilares")).toHaveLength(8);
    expect(bandas.filter((b) => b.tipo === "central")).toHaveLength(6);
    expect(bandas.every((b) => b.origen === "propuesta" && b.planta === "P1")).toBe(true);
    const b = porId(bandas);
    // Dirección 1 (según X): alineaciones en y = 0, 5, 10, 15; lx = mín(vano 6, separación 5) = 5
    expect(b.get("L:1:P1")).toMatchObject({ desde: [0, 0.625], hasta: [18, 0.625], ancho: 1.25 });
    expect(b.get("L:1:P2")).toMatchObject({ desde: [0, 5], hasta: [18, 5], ancho: 2.5 });
    expect(b.get("L:1:C1-2")).toMatchObject({ desde: [0, 2.5], hasta: [18, 2.5], ancho: 2.5 });
    expect(b.get("L:1:P4")).toMatchObject({ desde: [0, 14.375], hasta: [18, 14.375], ancho: 1.25 });
    // Dirección 2 (según Y): alineaciones en x = 0, 6, 12, 18; lx = mín(vano 5, separación 6) = 5
    expect(b.get("L:2:P2")).toMatchObject({ desde: [6, 0], hasta: [6, 15], ancho: 2.5 });
    expect(b.get("L:2:C1-2")).toMatchObject({ desde: [3, 0], hasta: [3, 15], ancho: 3.5 });
  });

  it("un pilar desplazado ≤ τ sigue en su alineación (el eje va por la media); uno a más de τ forma otra o se queda solo", () => {
    const base = losaPlana();
    const mover = (dy: number) => losaPlana({ pilares: base.pilares!.map((p) => (p.id === "P6-5" ? { ...p, y: 5 + dy } : p)) });
    // S = menor separación > 1 m entre ejes = 4,8; τ = 0,48
    const cerca = porId(proponerBandas(mover(0.2)).bandas);
    // eje en y = 5,05; vecinas a 5,05 y 4,95: lx/4 = 1,2625 abajo y 1,2375 arriba, centro en 5,0375
    expect(cerca.get("L:1:P2")).toMatchObject({ desde: [0, 5.0375], ancho: 2.5 });
    // a 0,8 m (> τ) queda solo: su alineación ya no tiene dos pilares y la de y = 5 sigue con tres
    const lejos = proponerBandas(mover(0.8)).bandas;
    expect(lejos.filter((b) => b.id.startsWith("L:1:P"))).toHaveLength(4);
    expect(porId(lejos).get("L:1:P2")!.desde[1]).toBeCloseTo(5, 12);
  });

  it("voladizo: la banda llega al borde si el vuelo es ≤ el vano, y el lado exterior se queda en el borde", () => {
    const { bandas } = proponerBandas(losaPlana({ contorno: rect(-1.5, -1, 19.5, 16) }));
    const b = porId(bandas);
    // y = 0: 1 m de vuelo (< lx/4 = 1,25) por fuera y 1,25 por dentro; a lo largo, de −1,5 a 19,5
    expect(b.get("L:1:P1")).toMatchObject({ desde: [-1.5, 0.125], hasta: [19.5, 0.125], ancho: 2.25 });
  });

  it("reticular con ábacos de más de lx/3: la banda de pilares toma su ancho, sin salirse de la losa", () => {
    const abacos: Vec2[][] = [];
    for (const x of [0, 6, 12, 18]) for (const y of [0, 5, 10, 15]) abacos.push(rect(x - 1.5, y - 1.5, x + 1.5, y + 1.5));
    const { bandas } = proponerBandas(losaPlana({ reticular: { intereje: 0.8, nervio: 0.12, capa: 0.05, caseton: "recuperable", abacos } }));
    const b = porId(bandas);
    // interiores: el ábaco (3 m > 5/3) en vez de 2,5; de borde: 1,5 hacia dentro y nada fuera
    expect(b.get("L:1:P2")!.ancho).toBeCloseTo(3, 12);
    expect(b.get("L:1:P1")).toMatchObject({ desde: [0, 0.75], ancho: 1.5 });
    expect(b.get("L:1:C1-2")!.ancho).toBeCloseTo(5 - 1.5 - 1.5, 12);
  });

  it("una losa sin dos pilares alineados no tiene bandas en esa dirección (aviso)", () => {
    const { bandas, diagnosticos } = proponerBandas(losaPlana({ pilares: [{ id: "A", x: 3, y: 3, desde: "C", hasta: "P1", seccion: "p" }] }));
    expect(bandas).toEqual([]);
    expect(diagnosticos.filter((d) => d.codigo === "banda/sin-alineaciones")).toHaveLength(2);
  });

  it("un modelo no válido devuelve sus errores y ninguna banda", () => {
    const f = losaPlana();
    const r = proponerBandas({ ...f, losas: [{ ...f.losas![0]!, espesor: -1 }] });
    expect(r.bandas).toEqual([]);
    expect(r.diagnosticos.some((d) => d.severidad === "error")).toBe(true);
  });
});

describe("las bandas propuestas en el modelo (C5.1, criterio 7)", () => {
  it("se compilan como cualquier banda: sus lados quedan en la malla", () => {
    const f = losaPlana();
    const { bandas } = proponerBandas(f);
    const r = compilar({ ...f, bandas });
    expect(r.valido).toBe(true);
    if (!r.valido) return;
    // los lados de la banda central L:1:C1-2 (y = 1,25 y 3,75) tienen nudos de la losa a lo largo
    const enLinea = (y: number) => r.modelo.nudos.filter((n) => Math.abs(n.y - y) < 1e-9 && n.x > 0.5 && n.x < 17.5).length;
    expect(enLinea(1.25)).toBeGreaterThan(10);
    expect(enLinea(3.75)).toBeGreaterThan(10);
  });

  it("no dependen del orden de las listas", () => {
    const f = losaPlana();
    const g = { ...f, pilares: [...f.pilares!].reverse() };
    expect(proponerBandas(g).bandas).toEqual(proponerBandas(f).bandas);
  });

  it("trasladar la planta traslada las bandas, y girar los ejes de la losa 90° intercambia las direcciones", () => {
    const f = losaPlana();
    const [dx, dy] = [7, -3];
    const mover = (p: Vec2): Vec2 => [p[0] + dx, p[1] + dy];
    const g: ModeloFisico = { ...f, pilares: f.pilares!.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })), losas: [{ ...f.losas![0]!, contorno: f.losas![0]!.contorno.map(mover) }] };
    const a = proponerBandas(f).bandas;
    const b = porId(proponerBandas(g).bandas);
    for (const x of a) {
      const y = b.get(x.id)!;
      expect(y.ancho).toBeCloseTo(x.ancho, 9);
      for (const k of [0, 1] as const) {
        expect(y.desde[k]).toBeCloseTo(mover(x.desde)[k], 9);
        expect(y.hasta[k]).toBeCloseTo(mover(x.hasta)[k], 9);
      }
    }
    // eje 1 a 90°: la dirección 1 es la Y y la 2, la −X
    const girada = porId(proponerBandas({ ...f, losas: [{ ...f.losas![0]!, eje1: 90 }] }).bandas);
    const original = porId(a);
    expect(girada.get("L:1:P2")!.ancho).toBeCloseTo(original.get("L:2:P2")!.ancho, 12);
    expect(new Set([...girada.values()].map((x) => `${x.ancho}`))).toEqual(new Set(a.map((x) => `${x.ancho}`)));
  });

  it("tipo y origen no válidos son un error de la banda", () => {
    const f = losaPlana();
    const mal = (extra: Partial<Banda>) => compilar({ ...f, bandas: [{ id: "B", planta: "P1", desde: [0, 1], hasta: [18, 1], ancho: 1, ...extra } as Banda] });
    for (const extra of [{ tipo: "otra" }, { origen: "auto" }] as unknown as Partial<Banda>[]) {
      const r = mal(extra);
      expect(r.valido).toBe(false);
      expect(r.diagnosticos.some((d) => d.ids?.includes("B"))).toBe(true);
    }
  });
});
