/**
 * Fase LC (`docs/fem3d/losa-cimentacion.md`): la losa de cimentación sobre balasto.
 * - Prueba del parche: una losa libre con su peso y una carga uniforme da w = q/k en todos sus nudos
 *   y momentos nulos; las áreas tributarias suman la de la losa.
 * - Flexión cilíndrica frente a la solución exacta de una franja de Mindlin sobre Winkler (con ν = 0,
 *   sin acoplamiento anticlástico): la serie de Navier en x, con los bordes a ~8 l de la carga.
 * - Losa rígida (l ≫ lado): asiento y giro de sólido rígido de la resultante.
 * - Los pilares y muros que arrancan en ella (LC-c), lo horizontal (CB-a) y los errores.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { KAPPA } from "../elementos/dkmq.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { longitudCaracteristica } from "./cimentacion.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import { conjuntoCombinaciones } from "../agente/combinaciones.ts";
import { terreno } from "../agente/terreno.ts";
import type { CargaFisica, ModeloFisico, OpcionesCompilacion, Vec2 } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const rect = (a: number, b: number, x0 = 0, y0 = 0): Vec2[] => [
  [x0, y0],
  [x0 + a, y0],
  [x0 + a, y0 + b],
  [x0, y0 + b],
];

/** Una losa de cimentación sola en la planta C. */
function losaSola(o: { a: number; b: number; t: number; k: number; material?: ModeloFisico["materiales"][number]; cargas?: CargaFisica[]; casos?: string[] }): ModeloFisico {
  return {
    plantas: [{ id: "C", altura: null }],
    materiales: [o.material ?? { id: "H", tipo: "hormigon", fck: 30 }],
    secciones: [],
    losas: [{ id: "L", planta: "C", contorno: rect(o.a, o.b), espesor: o.t, material: o.material?.id ?? "H", cimentacion: { balasto: o.k } }],
    casos: (o.casos ?? ["G"]).map((id) => ({ id, ...(id === "G" ? { pesoPropio: true } : {}) })),
    cargas: o.cargas ?? [],
  };
}

function calculado(f: ModeloFisico, op: OpcionesCompilacion = {}) {
  const r = valido(compilar(f, op));
  const casos = casosValidos(calcular(r.modelo));
  return { r, casos };
}

describe("losa de cimentación: prueba del parche", () => {
  const f = losaSola({ a: 8, b: 6, t: 0.4, k: 20000, casos: ["G", "CM"], cargas: [{ tipo: "superficie", id: "Q", caso: "CM", planta: "C", losa: "L", q: [0, 0, -15] }] });
  it("w = q/k en todos los nudos, momentos nulos, y las áreas suman la losa", () => {
    const { r, casos } = calculado(f);
    const c = r.mapeo.cimentacion!.L!;
    expect(Math.abs(c.areas.reduce((s, a) => s + a, 0) - 48)).toBeLessThan(1e-9);
    expect(r.modelo.muelles!.length).toBe(c.nudos.length);
    const pp = 25 * 0.4;
    for (const [k, q] of [
      [0, pp],
      [1, 15],
    ] as const) {
      const u = casos[k]!.u;
      for (const n of c.nudos) expect(Math.abs((-u[6 * n + 2]! * 20000) / q - 1)).toBeLessThan(1e-9);
      const e = casos[k]!.esfuerzosLaminas;
      for (let l = 0; l < r.modelo.laminas!.length; l++) for (const j of [3, 4, 5]) expect(Math.abs(e[8 * l + j]!)).toBeLessThan(1e-8);
    }
  });
  it("la malla, a l/4, y lo horizontal coartado en todos sus nudos", () => {
    const { r } = calculado(f);
    const l = longitudCaracteristica({ E: 22000 * Math.pow(3.8, 0.3) * 1000, nu: 0.2, t: 0.4 }, 20000);
    const nudos = r.modelo.nudos;
    let lado = 0;
    for (const lm of r.modelo.laminas!)
      for (let i = 0; i < 4; i++) {
        const [p, q] = [nudos[lm.nudos[i]!]!, nudos[lm.nudos[(i + 1) % 4]!]!];
        lado = Math.max(lado, Math.hypot(q.x - p.x, q.y - p.y));
      }
    expect(lado).toBeLessThanOrEqual((l / 4) * 1.5);
    const coartados = new Set(r.modelo.apoyos!.filter((a) => a.coartados[0] && a.coartados[1] && !a.coartados[2]).map((a) => a.nudo));
    for (const n of r.mapeo.cimentacion!.L!.nudos) expect(coartados.has(n)).toBe(true);
    expect(r.hipotesis.some((h) => h.startsWith("Losas de cimentación sobre balasto"))).toBe(true);
  });
});

describe("losa de cimentación: flexión cilíndrica frente a Mindlin sobre Winkler", () => {
  // ν = 0 (material general con G = E/2): la franja trabaja en flexión cilíndrica exacta
  const E = 3e7;
  const t = 0.3;
  const k = 30000;
  const P = 100;
  const a = 20;
  const f = losaSola({
    a,
    b: 6,
    t,
    k,
    material: { id: "M", tipo: "general", E, G: E / 2, peso: 0 },
    cargas: [{ tipo: "lineal", id: "P", caso: "G", planta: "C", puntos: [[a / 2, 0], [a / 2, 6]], q: [0, 0, -P] }],
  });
  /** w y M de la franja infinita (apoyada a 0 y a, lejos de la carga): Σ con W = q(1 + Dα²/S)/(Dα⁴ + k(1 + Dα²/S)), M = −(q − kW)/α². */
  const serie = (x: number) => {
    const D = (E * t ** 3) / 12;
    const S = KAPPA * (E / 2) * t;
    let w = 0;
    let M = 0;
    for (let m = 1; m <= 4001; m += 2) {
      const al = (m * Math.PI) / a;
      const qm = ((2 * -P) / a) * Math.sin((al * a) / 2);
      const c = 1 + (D * al * al) / S;
      const W = (qm * c) / (D * al ** 4 + k * c);
      w += W * Math.sin(al * x);
      M += (-(qm - k * W) / (al * al)) * Math.sin(al * x);
    }
    return { w, M };
  };
  it("w bajo la carga a ≤ 0,5 % y Mx a ≤ 2 %", () => {
    const { r, casos } = calculado(f);
    const u = casos[0]!.u;
    const nudos = r.modelo.nudos;
    const bajo = r.mapeo.cimentacion!.L!.nudos.filter((n) => Math.abs(nudos[n]!.x - a / 2) < 1e-9 && nudos[n]!.y > 2 && nudos[n]!.y < 4);
    expect(bajo.length).toBeGreaterThan(0);
    const ref = serie(a / 2);
    for (const n of bajo) expect(Math.abs(u[6 * n + 2]! / ref.w - 1)).toBeLessThan(5e-3);
    // Mx en el centroide de las láminas junto a la carga, frente a la serie en ese punto
    const e = casos[0]!.esfuerzosLaminas;
    let peor = 0;
    r.modelo.laminas!.forEach((lm, i) => {
      const xs = lm.nudos.map((n) => nudos[n]!.x);
      const ys = lm.nudos.map((n) => nudos[n]!.y);
      const [xc, yc] = [xs.reduce((s, v) => s + v, 0) / 4, ys.reduce((s, v) => s + v, 0) / 4];
      if (Math.abs(xc - a / 2) > 0.4 || yc < 2 || yc > 4) return;
      peor = Math.max(peor, Math.abs(e[8 * i + 3]! / serie(xc).M - 1));
    });
    expect(peor).toBeLessThan(0.02);
  });
});

describe("losa de cimentación rígida", () => {
  // k = 4 kN/m³: l ≈ 29 m frente a 6 m de lado (y t = 1 m, para que el cortante no cuente): casi sólido
  // rígido; lo que queda es la flexión de la losa, proporcional a k.
  // P = 400 kN en un parche de 1 × 1 centrado en (4,5; 3), a 1,5 m del centro
  const f = losaSola({ a: 6, b: 6, t: 1, k: 4, cargas: [{ tipo: "superficie", id: "P", caso: "G", planta: "C", losa: "L", zona: rect(1, 1, 4, 2.5), q: [0, 0, -400] }], material: { id: "H", tipo: "hormigon", fck: 30, peso: 0 } });
  it("asiento y giro de sólido rígido de los muelles a ≤ 0,1 %, y su inercia de giro, algo mayor que la continua", () => {
    const { r, casos } = calculado(f);
    const u = casos[0]!.u;
    const c = r.mapeo.cimentacion!.L!;
    const xs = c.nudos.map((n) => r.modelo.nudos[n]!.x);
    const A = c.areas.reduce((s, a) => s + a, 0);
    const xc = c.areas.reduce((s, a, i) => s + a * xs[i]!, 0) / A;
    const I = c.areas.reduce((s, a, i) => s + a * (xs[i]! - xc) ** 2, 0);
    // LC-1: los muelles por nudo dan la inercia de la regla del trapecio, mayor que la continua (en una
    // malla regular, ∫x²dA + A·h²/12: con h = 0,75, +3,1 % frente a 6·6³/12; aquí la malla la ajustan el parche)
    expect(I / ((6 * 216) / 12)).toBeGreaterThan(1);
    expect(I / ((6 * 216) / 12)).toBeLessThan(1.04);
    // Sólido rígido sobre los muelles: w = −P/(kA) − P·e·(x − xc)/(k·I)
    const wr = (x: number) => -400 / (4 * A) - (400 * (4.5 - xc) * (x - xc)) / (4 * I);
    let peor = 0;
    for (const n of c.nudos) peor = Math.max(peor, Math.abs(u[6 * n + 2]! - wr(r.modelo.nudos[n]!.x)) / Math.abs(wr(6)));
    expect(peor).toBeLessThan(1e-3);
  });
});

/** Planta de cimentación C con una losa y dos pilares de 30 × 30 hasta P1, con una carga en cada cabeza. */
function conPilares(extra: Partial<ModeloFisico> = {}, base?: "empotrado" | "articulado" | "ninguno"): ModeloFisico {
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "C", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 30 }],
    secciones: [{ id: "p30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 }],
    losas: [{ id: "L", planta: "C", contorno: rect(10, 6), espesor: 0.6, material: "H", cimentacion: { balasto: 40000 } }],
    pilares: [
      { id: "A1", x: 2, y: 3, desde: "C", hasta: "P1", seccion: "p30", ...(base ? { base } : {}) },
      { id: "A2", x: 8, y: 3, desde: "C", hasta: "P1", seccion: "p30" },
    ],
    casos: [{ id: "G", pesoPropio: true }, { id: "W" }],
    cargas: [
      { tipo: "puntual", id: "F1", caso: "G", planta: "P1", x: 2, y: 3, F: [0, 0, -800] },
      { tipo: "puntual", id: "F2", caso: "G", planta: "P1", x: 8, y: 3, F: [0, 0, -500] },
      { tipo: "puntual", id: "H1", caso: "W", planta: "P1", x: 2, y: 3, F: [50, 0, 0] },
    ],
    ...extra,
  };
}

describe("pilares y muros sobre la losa de cimentación (LC-c)", () => {
  it("sin base escrita, se apoyan en ella: el terreno lleva todo, y lo horizontal va a la losa", () => {
    const { r, casos } = calculado(conPilares());
    const pie = r.mapeo.nudosPilar["A1@C"]!;
    // El pie del pilar es el maestro de su huella en la losa: lleva ux, uy y rz (lo horizontal coartado), no uz
    const a = r.modelo.apoyos!.find((x) => x.nudo === pie)!;
    expect(a.coartados).toEqual([true, true, false, false, false, true]);
    // Las reacciones de los muelles suman la carga vertical (con el peso de los pilares y de la losa)
    const fz = (k: number) => r.mapeo.cimentacion!.L!.nudos.reduce((s, n, i) => s + r.mapeo.cimentacion!.L!.balasto * r.mapeo.cimentacion!.L!.areas[i]! * -casos[k]!.u[6 * n + 2]!, 0);
    expect(fz(0)).toBeGreaterThan(1300 + 25 * 0.6 * 60);
    expect(Math.abs(fz(1))).toBeLessThan(1e-6 * 50);
  });
  it("con la base escrita, error; y lo que sigue por debajo, también", () => {
    const e = compilar(conPilares({}, "empotrado"));
    expect(e.valido).toBe(false);
    expect(e.diagnosticos.map((d) => d.codigo)).toContain("pilar/apoyo-sobre-cimentacion");
    const debajo = conPilares({
      plantas: [
        { id: "P1", altura: null },
        { id: "C", altura: 3 },
        { id: "S", altura: 3 },
      ],
      pilares: [
        { id: "A1", x: 2, y: 3, desde: "S", hasta: "P1", seccion: "p30" },
        { id: "A2", x: 8, y: 3, desde: "C", hasta: "P1", seccion: "p30" },
      ],
    });
    expect(compilar(debajo).diagnosticos.map((d) => d.codigo)).toContain("cimentacion/pilar-debajo");
  });
  it("un muro sin base escrita también se apoya en ella", () => {
    const f = conPilares({ muros: [{ id: "M1", puntos: [[3, 1], [7, 1]], desde: "C", hasta: "P1", espesor: 0.25, material: "H" }] });
    const { r } = calculado(f);
    expect(r.diagnosticos.filter((d) => d.severidad === "error")).toEqual([]);
  });
  it("la planta de la losa va sin diafragma, y con uno rígido escrito es un error", () => {
    const { r } = calculado(conPilares());
    expect(r.mapeo.restricciones.filter((x) => x.planta === "C" && !x.pilar && !x.viga)).toEqual([]);
    const f = conPilares({
      plantas: [
        { id: "P1", altura: null },
        { id: "C", altura: 3, diafragma: "rigido" },
      ],
    });
    expect(compilar(f).diagnosticos.map((d) => d.codigo)).toContain("cimentacion/diafragma");
  });
  it("con kh: muelles horizontales y sin apoyos; con el sismo, error", () => {
    const f = conPilares();
    const g: ModeloFisico = { ...f, losas: f.losas!.map((l) => ({ ...l, cimentacion: { balasto: 40000, horizontal: { kh: 10000 } } })) };
    const { r, casos } = calculado(g);
    expect(r.modelo.apoyos!.length).toBe(0);
    expect(r.modelo.muelles!.every((m) => m.k[0]! > 0 && m.k[1]! > 0)).toBe(true);
    // Lo horizontal: la suma de las reacciones de los muelles en X es −50
    const c = r.mapeo.cimentacion!.L!;
    const fx = c.nudos.reduce((s, n, i) => s + 10000 * c.areas[i]! * -casos[1]!.u[6 * n]!, 0);
    expect(Math.abs(fx + 50)).toBeLessThan(1e-6);
    const s: ModeloFisico = { ...g, casos: [{ id: "G", pesoPropio: true, accion: { tipo: "G" } }], cargas: g.cargas!.filter((c) => c.caso === "G"), acciones: { sismo: {} } };
    expect(compilar(s).diagnosticos.map((d) => d.codigo)).toContain("cimentacion/kh-con-sismo");
  });
  it("los datos no válidos, con su error", () => {
    const f = conPilares();
    for (const c of [{ balasto: 0 }, { balasto: 1000, horizontal: "libre" }, { balasto: 1000, tensionAdmisible: -1 }]) {
      const g = { ...f, losas: f.losas!.map((l) => ({ ...l, cimentacion: c })) } as unknown as ModeloFisico;
      expect(compilar(g).valido).toBe(false);
    }
  });
});

describe("el ancho de una viga sobre la losa de cimentación (LC-g)", () => {
  it("lo que no es losa apoya en el eje de la viga: las áreas suman la losa", () => {
    const f = conPilares({
      secciones: [
        { id: "p30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
        { id: "v40", material: "H", forma: "rectangular", b: 0.4, h: 0.8 },
      ],
      vigas: [{ id: "V1", planta: "C", puntos: [[2, 3], [8, 3]], seccion: "v40" }],
    });
    const { r } = calculado(f);
    expect(r.mapeo.anchos?.length).toBeGreaterThan(0);
    const c = r.mapeo.cimentacion!.L!;
    expect(Math.abs(c.areas.reduce((s, a) => s + a, 0) - 60)).toBeLessThan(1e-9);
  });
});

describe("las consultas de una losa de cimentación", () => {
  const f = conPilares();
  const datos = () => {
    const { r, casos } = calculado(f);
    return { r, casos, q: new Consultas(f, r, casos) };
  };
  it("la losa es el objeto con reacciones (los pilares que arrancan en ella, no), y suma las cargas", () => {
    const { q, r } = datos();
    expect(q.objetosReaccion()).toEqual([{ id: "L", tipo: "losa de cimentación" }]);
    const R = q.reacciones("L");
    if (!R.valido) throw new Error("sin reacciones");
    // G: 800 + 500 + el peso de la losa y de los pilares; W: −50 en X y nada en Z
    void r;
    expect(R.valor.resultante[2]!).toBeGreaterThan(1300 + 25 * 0.6 * 60);
    expect(Math.abs(R.valor.resultante[6]! + 50)).toBeLessThan(1e-6);
    expect(Math.abs(R.valor.resultante[8]!)).toBeLessThan(1e-6);
    expect(q.reacciones("A1").valido).toBe(false);
  });
  it("terreno: σ = k·asiento, la distorsión entre los pilares, y el despegue con una carga que levanta", () => {
    const { q } = datos();
    const c = conjuntoCombinaciones(q, { tipo: "casos" });
    if (!c.valido) throw new Error("sin combinaciones");
    const t = terreno(q, c.valor);
    if (!t.valido) throw new Error(t.diagnosticos.map((d) => d.mensaje).join(" "));
    const L = t.valor[0]!;
    expect(Math.abs(L.area - 60)).toBeLessThan(1e-9);
    expect(Math.abs(L.sigmaMax.v - 40000 * L.asientoMax.v)).toBeLessThan(1e-9 * L.sigmaMax.v);
    expect(L.sigmaMax.comb).toBe("G");
    expect(L.distorsion?.entre).toEqual(["A1", "A2"]);
    expect(L.despegue).not.toBeNull(); // el caso W solo: lo horizontal vuelca la losa y una parte sube
    expect(t.diagnosticos.map((d) => d.codigo)).toContain("cimentacion/despegue");
    // Con G + W no despega, y con una tensión admisible pequeña, su aviso
    const g = conPilares({ losas: [{ id: "L", planta: "C", contorno: rect(10, 6), espesor: 0.6, material: "H", cimentacion: { balasto: 40000, tensionAdmisible: 20 } }] });
    const x = calculado(g);
    const q2 = new Consultas(g, x.r, x.casos);
    const t2 = terreno(q2, { descripcion: "G+W", nombres: ["G+W"], etiquetas: ["G+W"], factores: [Float64Array.of(1, 1)] });
    if (!t2.valido) throw new Error("sin terreno");
    expect(t2.valor[0]!.despegue).toBeNull();
    expect(t2.diagnosticos.map((d) => d.codigo)).toEqual(["cimentacion/tension"]);
  });
});

describe("losa de cimentación: metamórficas", () => {
  const sigma = (f: ModeloFisico) => {
    const { r, casos } = calculado(f);
    const q = new Consultas(f, r, casos);
    const t = terreno(q, { descripcion: "G+W", nombres: ["G+W"], etiquetas: ["G+W"], factores: [Float64Array.of(1, 1)] });
    if (!t.valido) throw new Error("sin terreno");
    return t.valor[0]!;
  };
  it("trasladar el modelo y cambiar el orden de los pilares no mueve σ, el asiento ni la distorsión", () => {
    const f = conPilares();
    const a = sigma(f);
    const d: Vec2 = [37.25, -12.5];
    const mover = (p: Vec2): Vec2 => [p[0] + d[0], p[1] + d[1]];
    const g: ModeloFisico = {
      ...f,
      pilares: [...f.pilares!].reverse().map((p) => ({ ...p, x: p.x + d[0], y: p.y + d[1] })),
      losas: f.losas!.map((l) => ({ ...l, contorno: l.contorno.map(mover) })),
      cargas: [...f.cargas!].reverse().map((c) => (c.tipo === "puntual" ? { ...c, x: c.x + d[0], y: c.y + d[1] } : c)),
    };
    const b = sigma(g);
    for (const k of ["sigmaMax", "sigmaMin", "asientoMax"] as const) expect(Math.abs(b[k].v - a[k].v)).toBeLessThan(1e-9 * Math.abs(a.sigmaMax.v));
    expect(Math.abs(b.distorsion!.v - a.distorsion!.v)).toBeLessThan(1e-9 * a.distorsion!.v);
  });
});
