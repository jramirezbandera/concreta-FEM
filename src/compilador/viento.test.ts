/**
 * VS1, el viento del programa (`docs/fem3d/viento-sismo.md` §3.1 y §5):
 * 1. con todas las plantas del mismo ancho, las fuerzas de Concreta (`calcularViento`, congeladas
 *    por `validacion/vs/oraculo-concreta.ts`) y un caso a mano;
 * 2. la reacción horizontal de cada caso es −ΣF a 1e-9, y su momento, el de las fuerzas en el
 *    centro de su banda desplazado ±e;
 * 3. sin `acciones`, el mismo modelo analítico bit a bit;
 * 4. girar el edificio cambia X por Y; trasladarlo no cambia las fuerzas;
 * y la regla de la pila con dos cubiertas a cotas distintas (VS-n), los errores y la idempotencia.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ALTURAS_TABLA_3_4, coeficienteExposicion, ORDEN_ASPEREZAS, TABLA_3_4 } from "../normas/cteViento.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { ModeloFisico, Planta, Vec2, VientoEdificio } from "./fisico.ts";
import { CASOS_VIENTO, calcularViento, resolverViento } from "./viento.ts";

const ORACULO = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "viento-concreta.json"), "utf8")) as {
  casos: {
    nombre: string;
    zona: "A" | "B" | "C";
    qb?: number;
    aspereza: VientoEdificio["aspereza"];
    alturas: number[];
    dimensiones: { x: number; y: number };
    x: { cp: number; cs: number; esbeltez: number; e: number; plantas: { z: number; hTrib: number; ce: number; F: number }[] };
    y: { cp: number; cs: number; esbeltez: number; e: number; plantas: { z: number; hTrib: number; ce: number; F: number }[] };
  }[];
};

const rect = (x0: number, y0: number, X: number, Y: number): Vec2[] => [
  [x0, y0],
  [x0 + X, y0],
  [x0 + X, y0 + Y],
  [x0, y0 + Y],
];

/**
 * Un edificio rectangular de X × Y con su origen en (x0, y0): una losa por planta, la cimentación a
 * ±0,00 y cuatro pilares de 30 × 30 en las esquinas, enrasados por dentro (el ancho es el de la losa).
 */
function edificio(alturas: number[], X: number, Y: number, viento?: VientoEdificio, x0 = 0, y0 = 0): ModeloFisico {
  const n = alturas.length;
  const plantas: Planta[] = [...Array.from({ length: n }, (_, i) => ({ id: `N${n - i}`, altura: n - i < n ? alturas[n - i]! : null })), { id: "C", altura: alturas[0]! }];
  const esquinas: Vec2[] = [
    [x0 + 0.15, y0 + 0.15],
    [x0 + X - 0.15, y0 + 0.15],
    [x0 + X - 0.15, y0 + Y - 0.15],
    [x0 + 0.15, y0 + Y - 0.15],
  ];
  return {
    plantas,
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "P30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 }],
    pilares: esquinas.map(([x, y], i) => ({ id: `P${i + 1}`, x, y, desde: "C", hasta: `N${n}`, seccion: "P30" })),
    losas: Array.from({ length: n }, (_, i) => ({ id: `L${i + 1}`, planta: `N${i + 1}`, contorno: rect(x0, y0, X, Y), espesor: 0.2, material: "HA" })),
    casos: [{ id: "G", pesoPropio: true, accion: { tipo: "G" } }],
    ...(viento ? { acciones: { viento } } : {}),
  };
}

const cerca = (a: number, b: number, rel = 1e-12) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));

describe("VS1: con el mismo ancho en todas las plantas, el viento de Concreta", () => {
  for (const c of ORACULO.casos)
    it(c.nombre, () => {
      const v = calcularViento(edificio(c.alturas, c.dimensiones.x, c.dimensiones.y, { zona: c.zona, aspereza: c.aspereza, ...(c.qb !== undefined ? { qb: c.qb } : {}) }))!;
      expect(v.errores).toEqual([]);
      for (const eje of ["x", "y"] as const) {
        const [d, o] = [v.viento![eje], c[eje]];
        cerca(d.cp, o.cp);
        cerca(d.cs, o.cs);
        cerca(d.esbeltez, o.esbeltez);
        cerca(d.e, o.e);
        expect(d.plantas.map((p) => p.planta)).toEqual(o.plantas.map((_, i) => `N${i + 1}`));
        d.plantas.forEach((p, i) => {
          cerca(p.z, o.plantas[i]!.z);
          cerca(p.ce, o.plantas[i]!.ce);
          cerca(p.area, o.plantas[i]!.hTrib * c.dimensiones[eje === "x" ? "y" : "x"]);
          cerca(p.F, o.plantas[i]!.F);
        });
      }
    });

  it("a mano: una planta de 4 m en 10 × 8, zona B y aspereza II", () => {
    const v = calcularViento(edificio([4], 10, 8, { zona: "B", aspereza: "II" }))!.viento!;
    // ce(4) = F·(F + 7k), F = k·ln(4/L), k = 0,17 y L = 0,01 (tabla D.2)
    const Fk = 0.17 * Math.log(4 / 0.01);
    const ce = Fk * (Fk + 7 * 0.17);
    // Según X: esbeltez 4/10 = 0,4 → cp 0,7, cs −0,3 − 0,1·0,15/0,25 = −0,36; banda de 2 m × 8 m
    expect(v.x.cp).toBe(0.7);
    cerca(v.x.cs, -0.36);
    cerca(v.x.plantas[0]!.F, (0.7 + 0.36) * 0.45 * ce * 2 * 8);
    // Según Y: esbeltez 4/8 = 0,5 → cp 0,7, cs −0,4; banda de 2 m × 10 m
    cerca(v.y.plantas[0]!.F, (0.7 + 0.4) * 0.45 * ce * 2 * 10);
    cerca(v.x.e, 0.4);
    cerca(v.y.e, 0.5);
  });

  it("la tabla 3.4 es la fórmula D.2 redondeada: sus 40 casillas, a menos de 0,1", () => {
    for (const g of ORDEN_ASPEREZAS) ALTURAS_TABLA_3_4.forEach((z, i) => expect(Math.abs(coeficienteExposicion(z, g) - TABLA_3_4[g][i]!), `${g} a ${z} m`).toBeLessThanOrEqual(0.1));
  });
});

describe("VS1: la banda de cada planta", () => {
  /** Dos cubiertas a 3,40 (CUB-S, x de 0 a 6) y 4,30 (CUB, x de 6 a 10), de 8 m en Y, como la vivienda. */
  function dosCubiertas(viento: VientoEdificio): ModeloFisico {
    return {
      plantas: [
        { id: "CUB", altura: null },
        { id: "CUB-S", tipo: "escalon", altura: 0.9 },
        { id: "C", altura: 3.4 },
      ],
      materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
      secciones: [{ id: "P30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 }],
      pilares: [
        { id: "P1", x: 0.15, y: 0.15, desde: "C", hasta: "CUB-S", seccion: "P30" },
        { id: "P2", x: 0.15, y: 7.85, desde: "C", hasta: "CUB-S", seccion: "P30" },
        { id: "P3", x: 6, y: 0.15, desde: "C", hasta: "CUB", seccion: "P30" },
        { id: "P4", x: 6, y: 7.85, desde: "C", hasta: "CUB", seccion: "P30" },
        { id: "P5", x: 9.85, y: 0.15, desde: "C", hasta: "CUB", seccion: "P30" },
        { id: "P6", x: 9.85, y: 7.85, desde: "C", hasta: "CUB", seccion: "P30" },
      ],
      losas: [
        { id: "LS", planta: "CUB-S", contorno: rect(0, 0, 6, 8), espesor: 0.25, material: "HA" },
        { id: "LC", planta: "CUB", contorno: rect(5.85, 0, 4.15, 8), espesor: 0.25, material: "HA" },
      ],
      casos: [{ id: "G", pesoPropio: true, accion: { tipo: "G" } }],
      acciones: { viento },
    };
  }

  it("dos cubiertas a cotas distintas: cada punto del ancho reparte su altura entre las plantas que tiene encima (VS-n)", () => {
    const v = calcularViento(dosCubiertas({ zona: "A", aspereza: "IV" }))!;
    expect(v.errores).toEqual([]);
    const { x, y } = v.viento!;
    // Según Y (ancho en X): CUB-S sola de 0 a 5,85 (media planta de 3,40); de 5,85 a 6, las dos
    // losas; CUB sola de 6 a 10 (media planta de 4,30). Los pilares de CUB que atraviesan la cota de
    // CUB-S no son de CUB-S
    const S = y.plantas.find((p) => p.planta === "CUB-S")!;
    const C = y.plantas.find((p) => p.planta === "CUB")!;
    cerca(S.area, 1.7 * 5.85 + (1.7 + 0.45) * 0.15);
    cerca(C.area, 0.45 * 0.15 + 2.15 * 4);
    cerca(S.centro, (1.7 * 5.85 * 2.925 + 2.15 * 0.15 * 5.925) / S.area);
    // Según X (ancho en Y, las dos en todo él): CUB-S de 1,70 a 3,85 y CUB de 3,85 a 4,30
    cerca(x.plantas.find((p) => p.planta === "CUB-S")!.area, 2.15 * 8);
    cerca(x.plantas.find((p) => p.planta === "CUB")!.area, 0.45 * 8);
    // La esbeltez, con la planta más alta y el fondo de todo el edificio
    cerca(x.esbeltez, 4.3 / 10);
    cerca(y.esbeltez, 4.3 / 8);
  });

  it("en cada punto del ancho, Σ h_trib = z_alta − z_baja/2: Σ A es su integral, sin la pila", () => {
    const v = calcularViento(dosCubiertas({ zona: "A", aspereza: "IV" }))!.viento!;
    // Según Y: de 0 a 5,85 sólo 3,40; de 5,85 a 6 las dos; de 6 a 10 sólo 4,30
    cerca(
      v.y.plantas.reduce((s, p) => s + p.area, 0),
      1.7 * 5.85 + (4.3 - 1.7) * 0.15 + 2.15 * 4,
    );
    // Según X: las dos en los 8 m
    cerca(
      v.x.plantas.reduce((s, p) => s + p.area, 0),
      (4.3 - 1.7) * 8,
    );
  });

  it("una pérgola (vigas fuera de la losa) no es fachada", () => {
    const m = dosCubiertas({ zona: "A", aspereza: "IV" });
    const con: ModeloFisico = {
      ...m,
      secciones: [...m.secciones, { id: "V30", material: "HA", forma: "rectangular", b: 0.3, h: 0.4 }],
      vigas: [{ id: "V1", planta: "CUB", seccion: "V30", puntos: [[10, 4], [14, 4]] }],
    };
    expect(calcularViento(con)!.viento!.y.plantas.map((p) => p.area)).toEqual(calcularViento(m)!.viento!.y.plantas.map((p) => p.area));
  });

  it("con la fachada escrita, su área manda; el centro sigue siendo el del modelo", () => {
    const m = dosCubiertas({ zona: "A", aspereza: "IV", fachadas: [{ planta: "CUB", y: 12 }] });
    const v = calcularViento(m)!.viento!;
    const C = v.y.plantas.find((p) => p.planta === "CUB")!;
    expect(C.dada).toBe(true);
    cerca(C.area, 12);
    cerca(C.centro, calcularViento(dosCubiertas({ zona: "A", aspereza: "IV" }))!.viento!.y.plantas.find((p) => p.planta === "CUB")!.centro);
  });

  it("intercambiar X e Y cambia las fuerzas según X por las de según Y; trasladar no las cambia", () => {
    const a = calcularViento(edificio([3.5, 3, 3], 20, 12, { zona: "B", aspereza: "III" }))!.viento!;
    const b = calcularViento(edificio([3.5, 3, 3], 12, 20, { zona: "B", aspereza: "III" }))!.viento!;
    const c = calcularViento(edificio([3.5, 3, 3], 20, 12, { zona: "B", aspereza: "III" }, 137.25, -48.5))!.viento!;
    expect(b.x.plantas.map((p) => p.F)).toEqual(a.y.plantas.map((p) => p.F));
    expect(b.y.plantas.map((p) => p.F)).toEqual(a.x.plantas.map((p) => p.F));
    a.x.plantas.forEach((p, i) => {
      cerca(c.x.plantas[i]!.F, p.F);
      cerca(c.x.plantas[i]!.centro, p.centro - 48.5);
      cerca(c.y.plantas[i]!.centro, a.y.plantas[i]!.centro + 137.25);
    });
  });

  it("la rasante: lo que queda por debajo no recibe viento y las cotas se miden desde ella", () => {
    const v = calcularViento(edificio([3, 3, 3], 20, 12, { zona: "A", aspereza: "IV", rasante: 3 }))!.viento!;
    expect(v.x.plantas.map((p) => [p.planta, p.z])).toEqual([
      ["N2", 3],
      ["N3", 6],
    ]);
  });
});

describe("VS1: los casos y las cargas", () => {
  it("8 casos al final de la lista, de la familia «viento», y una puntual por planta y caso; resolver dos veces no cambia nada", () => {
    const m = edificio([3, 3], 20, 12, { zona: "A", aspereza: "IV" });
    const r = resolverViento(m);
    expect(r.modelo.acciones).toBeUndefined();
    expect(r.modelo.casos.map((c) => c.id)).toEqual(["G", ...CASOS_VIENTO.map((c) => c.id)]);
    for (const c of r.modelo.casos.slice(1)) expect(c.accion).toMatchObject({ tipo: "W", familia: "viento", psi: "viento" });
    expect(r.modelo.cargas).toHaveLength(8 * 2);
    expect(resolverViento(r.modelo).modelo).toBe(r.modelo);
    // W−X es W+X con el otro signo; ±e mueve la recta
    const de = (caso: string) => r.modelo.cargas!.filter((c) => c.caso === caso);
    const [mas, menos] = [de("W+X+e"), de("W-X+e")];
    mas.forEach((c, i) => {
      expect(c.tipo === "puntual" && menos[i]!.tipo === "puntual" && c.F![0] === -menos[i]!.F![0]!).toBe(true);
      expect(c.tipo === "puntual" && c.y).toBeCloseTo(6 + 0.6, 12);
    });
    for (const c of de("W+Y-e")) expect(c.tipo === "puntual" && c.x).toBeCloseTo(10 - 1, 12);
  });

  it("errores: zona, caso ya usado, carga en un caso del programa, planta sin diafragma", () => {
    const m = edificio([3, 3], 20, 12, { zona: "A", aspereza: "IV" });
    const codigos = (f: ModeloFisico) => calcularViento(f)!.errores.map((e) => e.codigo);
    expect(codigos({ ...m, acciones: { viento: { zona: "D" as "A", aspereza: "IV" } } })).toContain("viento/zona");
    expect(codigos({ ...m, casos: [...m.casos, { id: "W+X+e" }] })).toContain("viento/caso-existente");
    expect(codigos({ ...m, cargas: [{ tipo: "puntual", id: "x", caso: "W+Y-e", planta: "N1", x: 1, y: 1, F: [1, 0, 0] }] })).toContain("viento/carga-en-caso-del-programa");
    expect(codigos({ ...m, plantas: m.plantas.map((p) => (p.id === "N1" ? { ...p, diafragma: "ninguno" as const } : p)) })).toContain("viento/planta-sin-diafragma");
    expect(codigos({ ...m, acciones: { viento: { zona: "A", aspereza: "IV", altitud: 2100 } } })).toContain("viento/altitud");
    // Un dato mal formado no lanza (E6)
    expect(codigos({ ...m, acciones: { viento: 7 as unknown as VientoEdificio } })).toContain("viento/no-valido");
    expect(codigos({ ...m, acciones: { viento: { zona: "A", aspereza: "IV", fachadas: 5 as unknown as [] } } })).toContain("viento/no-valido");
    expect(codigos({ ...m, acciones: { viento: { zona: 3 as unknown as "A", aspereza: "IV" } } })).toContain("viento/zona");
    // Y el compilador los da como errores
    const c = compilar({ ...m, acciones: { viento: { zona: "A", aspereza: "IV", qb: -1 } } });
    expect(c.valido).toBe(false);
    expect(c.diagnosticos.map((d) => d.codigo)).toContain("viento/qb");
  });
});

describe("VS1: en el cálculo", () => {
  beforeAll(async () => {
    await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
  });

  it("sin acciones, el mismo modelo analítico bit a bit", () => {
    const m = edificio([3, 3], 20, 12);
    const a = compilar(m);
    const b = compilar({ ...m, acciones: {} });
    expect(a.valido && b.valido).toBe(true);
    if (!a.valido || !b.valido) return;
    expect(JSON.stringify(b.modelo)).toBe(JSON.stringify(a.modelo));
  });

  it("la malla no cambia con el viento: sus puntuales van al diafragma sin sembrar su punto (SP-5)", () => {
    const sin = compilar(edificio([3.5, 3, 3], 20, 12));
    const con = compilar(edificio([3.5, 3, 3], 20, 12, { zona: "B", aspereza: "III" }));
    if (!sin.valido || !con.valido) throw new Error("no compila");
    expect(con.modelo.nudos.map((n) => [n.x, n.y, n.z])).toEqual(sin.modelo.nudos.map((n) => [n.x, n.y, n.z]));
    expect(con.modelo.laminas).toEqual(sin.modelo.laminas);
  });

  for (const [nombre, m] of [
    ["un bloque de 3 plantas", edificio([3.5, 3, 3], 20, 12, { zona: "B", aspereza: "III" })],
    ["el bloque trasladado", edificio([3.5, 3, 3], 20, 12, { zona: "B", aspereza: "III" }, 137.25, -48.5)],
  ] as const)
    it(`${nombre}: la reacción de cada caso es −ΣF y su momento, el de las fuerzas en su recta (±e)`, () => {
      const c = compilar(m);
      if (!c.valido) throw new Error(c.diagnosticos.find((d) => d.severidad === "error")!.mensaje);
      expect(c.hipotesis.some((h) => h.startsWith("Viento del DB SE-AE"))).toBe(true);
      const k = calcular(c.modelo);
      if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
      const v = calcularViento(m)!.viento!;
      for (const cv of CASOS_VIENTO) {
        const r = k.casos.find((x) => x.id === cv.id)!;
        const d = cv.eje === 0 ? v.x : v.y;
        let [R, Mz] = [0, 0];
        c.modelo.nudos.forEach((nd, i) => {
          const [rx, ry] = [r.reacciones[6 * i]!, r.reacciones[6 * i + 1]!];
          R += cv.eje === 0 ? rx : ry;
          Mz += nd.x * ry - nd.y * rx + r.reacciones[6 * i + 5]!;
        });
        cerca(R, -cv.signo * d.F, 1e-9);
        // Las fuerzas: Fx en y = c + e da Mz = −y·Fx; Fy en x = c + e da Mz = x·Fy
        const Mf = d.plantas.reduce((s, p) => s + (cv.eje === 0 ? -1 : 1) * (p.centro + cv.exc * d.e) * cv.signo * p.F, 0);
        cerca(Mz, -Mf, 1e-9);
      }
      // Las consultas ven los mismos casos que los resultados
      const q = new Consultas(m, c, k.casos);
      expect(q.fisico.casos.map((x) => x.id)).toEqual(c.modelo.casos.map((x) => x.id));
    });
});

describe("A2-29: el viento con las fachadas escritas y sin geometría en planta", () => {
  it("avisa viento/sin-geometria; con la planta dibujada, no", () => {
    const sinNada: ModeloFisico = {
      plantas: [
        { id: "N2", altura: null },
        { id: "N1", altura: 3 },
        { id: "C", altura: 3 },
      ],
      materiales: [],
      secciones: [],
      casos: [{ id: "G", pesoPropio: true, accion: { tipo: "G" } }],
      acciones: { viento: { zona: "A", aspereza: "IV", fachadas: [{ planta: "N2", x: 10, y: 10 }, { planta: "N1", x: 20, y: 20 }] } },
    };
    const c = calcularViento(sinNada)!;
    expect(c.avisos.map((a) => a.codigo)).toContain("viento/sin-geometria");
    expect(calcularViento(edificio([3, 3], 20, 12, { zona: "B", aspereza: "III" }))!.avisos.map((a) => a.codigo)).not.toContain("viento/sin-geometria");
  });
});
