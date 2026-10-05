/**
 * Criterio 2 de C4 (y la comprobación de la viga continua del criterio 1): oráculos de los forjados.
 *
 * 1. Multiplicadores de 25+5, 30+5 y 35+10 (nervio de 12 cm cada 82 cm) frente a la T calculada a
 *    mano (área, centro de gravedad e inercia por Steiner) y J_w por la aproximación de Roark
 *    (β = 1/3 − 0,21·r·(1 − r⁴/12)), distinta de la serie exacta que usa el compilador.
 * 2. Placa de Navier ortótropa: un reticular 30+5 de 6 × 4 m apoyado «hard» en su contorno, con
 *    10 kN/m², frente a la serie de Mindlin con D11 = m11·E·h³/12, D12 = 0, D66 = m12·E·h³/24 y
 *    K = v13·κ·(E/2)·h (la zona aligerada va con ν = 0, C4-h). w en el centro.
 * 3. Recuadro reticular 30+5 de N·s × N·s apoyado en su contorno (uz), con 10 kN/m², frente al
 *    emparrillado de nervios como barras (el modelo de CYPECAD, H46): T bruta, J = J_w + s·hf³/6
 *    (la capa como placa) y Avz = κ·bw·h, con la carga repartida por áreas tributarias en los cruces.
 *    Flecha en el cruce junto al centro y momento por nervio en el centro (M11·s frente al de la
 *    barra). Con ábacos de 2s × 2s en las esquinas, el emparrillado lleva en ellos franjas macizas
 *    (I = s·h³/(12(1 − ν²)), J = s·h³/6).
 * 4. Dos vanos iguales de viguetas sobre muros de espesor t (casi articulados con t pequeño): la
 *    reacción del apoyo central frente a la de la viga continua, 1,25·q·s·L (H46).
 */
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, Vec2 } from "../../src/compilador/fisico.ts";
import { EsfuerzosPiezas } from "../../src/compilador/resultados.ts";
import { multiplicadoresReticular } from "../../src/compilador/reticular.ts";
import { KAPPA } from "../../src/elementos/dkmq.ts";
import { DiagramasBarras } from "../../src/motor/barras.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { CamposLaminas } from "../../src/motor/campos.ts";
import type { CargaNodal } from "../../src/motor/modelo.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { Constructor } from "../../src/pruebas/constructor.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";
import { navierMindlin } from "../../src/pruebas/navier.ts";
import { hormigon, seccionT, torsionRectangulo } from "../../src/secciones/seccion3D.ts";

const HA = hormigon(25);
const HA_ = HA;

// 1. Multiplicadores
export const TIPOLOGIAS = [
  { nombre: "25+5", h: 0.3, hf: 0.05 },
  { nombre: "30+5", h: 0.35, hf: 0.05 },
  { nombre: "35+10", h: 0.45, hf: 0.1 },
].map((t) => ({ ...t, bw: 0.12, s: 0.82 }));

/** Los multiplicadores a mano (ν = 0,2 del hormigón). */
export function multiplicadoresAMano(t: { h: number; hf: number; bw: number; s: number }) {
  const { h, hf, bw, s } = t;
  const hw = h - hf;
  const Aa = s * hf;
  const Aw = bw * hw;
  const A = Aa + Aw;
  const zg = (Aa * (hw + hf / 2) + Aw * (hw / 2)) / A;
  const I = (s * hf * hf * hf) / 12 + Aa * (hw + hf / 2 - zg) * (hw + hf / 2 - zg) + (bw * hw * hw * hw) / 12 + Aw * (hw / 2 - zg) * (hw / 2 - zg);
  const r = bw / hw;
  const Jw = (1 / 3 - 0.21 * r * (1 - (r * r * r * r) / 12)) * hw * bw * bw * bw;
  const kG = 1 / 1.2;
  return { f11: A / (s * h), f12: (kG * hf) / h, m11: (12 * I) / (s * h * h * h), m12: (kG * (hf * hf * hf + (6 * Jw) / s)) / (h * h * h), v13: (kG * bw) / s };
}

export function comparaMultiplicadores() {
  return TIPOLOGIAS.map((t) => {
    const a = multiplicadoresAMano(t);
    const c = multiplicadoresReticular(t, 0.2);
    const err = (x: number, y: number) => Math.abs(x / y - 1);
    return { nombre: t.nombre, mano: a, compilador: c, exactos: Math.max(err(c.f11, a.f11), err(c.f12, a.f12), err(c.m11, a.m11), err(c.v13, a.v13), err(c.f22, a.f11), err(c.m22, a.m11), err(c.v23, a.v13)), m12: err(c.m12, a.m12) };
  });
}

// 2. Navier ortótropa
const RET = { h: 0.35, hf: 0.05, bw: 0.12, s: 0.82 };
export const NAVIER = { A: 6, B: 4, q: -10 };

export function navierReticular(malla: number) {
  const { A, B, q } = NAVIER;
  const bx = [true, true, true, true, false, false] as const;
  const by = [true, true, true, false, true, false] as const;
  const f: ModeloFisico = {
    plantas: [{ id: "P0", altura: null }],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25, peso: 0 }],
    secciones: [],
    losas: [{ id: "L", planta: "P0", contorno: [[0, 0], [A, 0], [A, B], [0, B]], espesor: RET.h, material: "H", reticular: { intereje: RET.s, nervio: RET.bw, capa: RET.hf } }],
    apoyosLineales: [
      { id: "x0", planta: "P0", puntos: [[0, 0], [0, B]], coartados: bx },
      { id: "xA", planta: "P0", puntos: [[A, 0], [A, B]], coartados: bx },
      { id: "y0", planta: "P0", puntos: [[0, 0], [A, 0]], coartados: by },
      { id: "yB", planta: "P0", puntos: [[0, B], [A, B]], coartados: by },
    ],
    casos: [{ id: "q" }],
    cargas: [{ tipo: "superficie", id: "Q", caso: "q", planta: "P0", losa: "L", q: [0, 0, q] }],
  };
  const r = valido(compilar(f, { tamanoMalla: malla }));
  const [c] = casosValidos(calcular(r.modelo));
  const n = r.modelo.nudos.findIndex((x) => Math.abs(x.x - A / 2) < 1e-9 && Math.abs(x.y - B / 2) < 1e-9);
  const m = multiplicadoresReticular(RET, 0.2);
  const D = (HA.E * RET.h ** 3) / 12;
  const ex = navierMindlin({ a: A, b: B, q, D11: m.m11 * D, D22: m.m22 * D, D12: 0, D66: (m.m12 * D) / 2, K55: m.v13 * KAPPA * (HA.E / 2) * RET.h, K44: m.v23 * KAPPA * (HA.E / 2) * RET.h }, A / 2, B / 2);
  return { malla, laminas: r.modelo.laminas!.length, w: c!.u[6 * n + 2]!, wExacta: ex[0], error: c!.u[6 * n + 2]! / ex[0] - 1 };
}

// 3. Emparrillado
export interface Emparrillado {
  N: number;
  abacos: boolean;
  malla: number;
  /** Flecha en el cruce ((N/2 − ½)s, (N/2 − ½)s), m, y momento por nervio en el centro del nervio de y = (N/2 − ½)s, kN·m. */
  lamina: { w: number; M: number; laminas: number };
  barras: { w: number; M: number };
  errorW: number;
  errorM: number;
}

export function emparrillado(N: number, abacos: boolean, malla = RET.s / 4): Emparrillado {
  const { h, hf, bw, s } = RET;
  const L = N * s;
  const q = -10;
  const sop = [true, true, true, false, false, false] as const;
  const esq = (x: number, y: number): Vec2[] => [
    [x, y],
    [x + 2 * s, y],
    [x + 2 * s, y + 2 * s],
    [x, y + 2 * s],
  ];
  const ab = abacos ? [esq(0, 0), esq(L - 2 * s, 0), esq(L - 2 * s, L - 2 * s), esq(0, L - 2 * s)] : [];
  const f: ModeloFisico = {
    plantas: [{ id: "P0", altura: null }],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25, peso: 0 }],
    secciones: [],
    losas: [{ id: "L", planta: "P0", contorno: [[0, 0], [L, 0], [L, L], [0, L]], espesor: h, material: "H", reticular: { intereje: s, nervio: bw, capa: hf, abacos: ab } }],
    apoyosLineales: [
      { id: "a", planta: "P0", puntos: [[0, 0], [L, 0]], coartados: sop },
      { id: "b", planta: "P0", puntos: [[L, 0], [L, L]], coartados: sop },
      { id: "c", planta: "P0", puntos: [[L, L], [0, L]], coartados: sop },
      { id: "d", planta: "P0", puntos: [[0, L], [0, 0]], coartados: sop },
    ],
    casos: [{ id: "q" }],
    cargas: [{ tipo: "superficie", id: "Q", caso: "q", planta: "P0", losa: "L", q: [0, 0, q] }],
  };
  const r = valido(compilar(f, { tamanoMalla: malla }));
  const [c] = casosValidos(calcular(r.modelo));
  const u = c!.u;
  const nd = (x: number, y: number) => r.modelo.nudos.findIndex((n) => Math.abs(n.x - x) < 1e-6 && Math.abs(n.y - y) < 1e-6);
  const c0 = N / 2;
  const nw = nd((c0 - 0.5) * s, (c0 - 0.5) * s);
  const nm = nd(c0 * s, (c0 - 0.5) * s);
  const campos = new CamposLaminas(r.modelo);
  const l = r.modelo.laminas!.findIndex((x) => x.nudos.includes(nm));
  const M11 = campos.enNudos(l, u)[8 * r.modelo.laminas![l]!.nudos.indexOf(nm) + 3]!;
  const lamina = { w: u[6 * nw + 2]!, M: M11 * s, laminas: r.modelo.laminas!.length };

  // Emparrillado: nervios en s/2 + i·s, cruces cargados con q·s² (áreas tributarias)
  const t = seccionT(s, hf, bw, h, HA).seccion;
  const nervio = { ...t, J: torsionRectangulo(bw, h - hf) + (s * hf ** 3) / 6, Avz: KAPPA * bw * h };
  const nu = HA.E / (2 * HA.G) - 1;
  const macizo = { E: HA.E, G: HA.G, A: s * h, Iy: (s * h ** 3) / (12 * (1 - nu * nu)), Iz: (h * s ** 3) / 12, J: (s * h ** 3) / 6, Avy: KAPPA * s * h, Avz: KAPPA * s * h };
  const enAbaco = (x: number, y: number) => ab.some(([P0, , P2]) => x > P0![0] && x < P2![0] && y > P0![1] && y < P2![1]);
  const m = new Constructor();
  const pos = Array.from({ length: N }, (_, i) => s / 2 + i * s);
  const nudos = new Map<string, number>();
  const nudo = (x: number, y: number) => {
    const k = `${x.toFixed(9)},${y.toFixed(9)}`;
    let n = nudos.get(k);
    if (n === undefined) nudos.set(k, (n = m.nudo(x, y, 0)));
    return n;
  };
  const F: CargaNodal[] = [];
  for (const x of pos) for (const y of pos) F.push({ nudo: nudo(x, y), f: [0, 0, q * s * s, 0, 0, 0] });
  // Cortes de cada nervio: los bordes, los cruces y, con ábacos, sus lados (2s y L − 2s)
  const cortes = [0, ...pos, L, ...(abacos ? [2 * s, L - 2 * s] : [])].sort((a, b) => a - b);
  let barraM = -1;
  for (const dir of [0, 1])
    for (const c of pos) {
      const P = (a: number) => (dir === 0 ? nudo(a, c) : nudo(c, a));
      m.apoyo(P(0), sop);
      m.apoyo(P(L), sop);
      for (let k = 0; k + 1 < cortes.length; k++) {
        const [a, b] = [cortes[k]!, cortes[k + 1]!];
        const xm = (a + b) / 2;
        const sec = enAbaco(dir === 0 ? xm : c, dir === 0 ? c : xm) ? macizo : nervio;
        const br = m.barra(P(a), P(b), sec, [0, 0, 1]);
        if (dir === 0 && Math.abs(c - (c0 - 0.5) * s) < 1e-9 && Math.abs(a - (c0 - 0.5) * s) < 1e-9) barraM = br;
      }
    }
  m.caso("q", F);
  const mod = m.modelo();
  const [cb] = casosValidos(calcular(mod));
  const w = cb!.u[6 * nudo((c0 - 0.5) * s, (c0 - 0.5) * s) + 2]!;
  const M = new DiagramasBarras(mod).diagrama(barraM, 0, cb!).esfuerzosEn(s / 2, 1)[4]!;
  return { N, abacos, malla, lamina, barras: { w, M }, errorW: lamina.w / w - 1, errorM: lamina.M / M - 1 };
}

/**
 * Recuadro reticular de N·s × N·s apoyado en su contorno (uz) y en un pilar puntual en su centro,
 * con un ábaco de 3s × 3s centrado en él o sin él, frente al emparrillado con nervios en i·s (pasan
 * por el pilar). La carga va sobre [s/2, (N − ½)s]², lo que cubren las áreas tributarias de los
 * cruces. Flecha en el cruce (2s, 2s) y momento por nervio en (2,5s, 2s): el del nervio según X en
 * el centro de su barra (en un cruce, el del emparrillado salta por la torsión del transversal).
 */
export function emparrilladoPilar(N: number, conAbaco: boolean, nu0 = false, malla = RET.s / 4): Emparrillado {
  const { h, hf, bw, s } = RET;
  // Con nu0, hormigón con ν = 0 en la lámina y en las barras: el emparrillado no puede tener el
  // acoplamiento de Poisson del ábaco macizo, así que es la comparación homogénea
  const HA = nu0 ? { E: HA_.E, G: HA_.E / 2 } : HA_;
  const material: ModeloFisico["materiales"][number] = nu0 ? { id: "H", tipo: "general", E: HA.E, G: HA.G, peso: 0 } : { id: "H", tipo: "hormigon", fck: 25, peso: 0 };
  const L = N * s;
  const c = (N / 2) * s;
  const q = -10;
  const sop = [true, true, true, false, false, false] as const;
  const ab: Vec2[][] = conAbaco
    ? [
        [
          [c - 1.5 * s, c - 1.5 * s],
          [c + 1.5 * s, c - 1.5 * s],
          [c + 1.5 * s, c + 1.5 * s],
          [c - 1.5 * s, c + 1.5 * s],
        ],
      ]
    : [];
  const f: ModeloFisico = {
    plantas: [{ id: "P0", altura: null }],
    secciones: [],
    losas: [{ id: "L", planta: "P0", contorno: [[0, 0], [L, 0], [L, L], [0, L]], espesor: h, material: "H", reticular: { intereje: s, nervio: bw, capa: hf, abacos: ab } }],
    apoyosLineales: [
      { id: "a", planta: "P0", puntos: [[0, 0], [L, 0]], coartados: sop },
      { id: "b", planta: "P0", puntos: [[L, 0], [L, L]], coartados: sop },
      { id: "c", planta: "P0", puntos: [[L, L], [0, L]], coartados: sop },
      { id: "d", planta: "P0", puntos: [[0, L], [0, 0]], coartados: sop },
    ],
    apoyos: [{ id: "P", planta: "P0", x: c, y: c, coartados: [false, false, true, false, false, false] }],
    materiales: [material],
    casos: [{ id: "q" }],
    cargas: [
      {
        tipo: "superficie",
        id: "Q",
        caso: "q",
        planta: "P0",
        zona: [
          [s / 2, s / 2],
          [L - s / 2, s / 2],
          [L - s / 2, L - s / 2],
          [s / 2, L - s / 2],
        ],
        q: [0, 0, q],
      },
    ],
  };
  const r = valido(compilar(f, { tamanoMalla: malla }));
  const [cl] = casosValidos(calcular(r.modelo));
  const u = cl!.u;
  const nd = (x: number, y: number) => r.modelo.nudos.findIndex((n) => Math.abs(n.x - x) < 1e-6 && Math.abs(n.y - y) < 1e-6);
  const nw = nd(2 * s, 2 * s);
  const nm = nd(2.5 * s, 2 * s);
  const campos = new CamposLaminas(r.modelo);
  const l = r.modelo.laminas!.findIndex((x) => x.nudos.includes(nm));
  const M11 = campos.enNudos(l, u)[8 * r.modelo.laminas![l]!.nudos.indexOf(nm) + 3]!;
  const lamina = { w: u[6 * nw + 2]!, M: M11 * s, laminas: r.modelo.laminas!.length };

  const t = seccionT(s, hf, bw, h, HA).seccion;
  const nervio = { ...t, J: torsionRectangulo(bw, h - hf) + (s * hf ** 3) / 6, Avz: KAPPA * bw * h };
  const nu = HA.E / (2 * HA.G) - 1;
  const macizo = { E: HA.E, G: HA.G, A: s * h, Iy: (s * h ** 3) / (12 * (1 - nu * nu)), Iz: (h * s ** 3) / 12, J: (s * h ** 3) / 6, Avy: KAPPA * s * h, Avz: KAPPA * s * h };
  const enAbaco = (x: number, y: number) => ab.some(([P0, , P2]) => x > P0![0] && x < P2![0] && y > P0![1] && y < P2![1]);
  const m = new Constructor();
  const pos = Array.from({ length: N - 1 }, (_, i) => (i + 1) * s);
  const nudos = new Map<string, number>();
  const nudo = (x: number, y: number) => {
    const k = `${x.toFixed(9)},${y.toFixed(9)}`;
    let n = nudos.get(k);
    if (n === undefined) nudos.set(k, (n = m.nudo(x, y, 0)));
    return n;
  };
  const F: CargaNodal[] = [];
  for (const x of pos) for (const y of pos) F.push({ nudo: nudo(x, y), f: [0, 0, q * s * s, 0, 0, 0] });
  m.apoyo(nudo(c, c), [false, false, true, false, false, false]);
  const cortes = [0, ...pos, L, ...(conAbaco ? [c - 1.5 * s, c + 1.5 * s] : [])].sort((a, b) => a - b);
  let barraM = -1;
  for (const dir of [0, 1])
    for (const y of pos) {
      const P = (a: number) => (dir === 0 ? nudo(a, y) : nudo(y, a));
      m.apoyo(P(0), sop);
      m.apoyo(P(L), sop);
      for (let k = 0; k + 1 < cortes.length; k++) {
        const [a, b] = [cortes[k]!, cortes[k + 1]!];
        const xm = (a + b) / 2;
        const br = m.barra(P(a), P(b), enAbaco(dir === 0 ? xm : y, dir === 0 ? y : xm) ? macizo : nervio, [0, 0, 1]);
        if (dir === 0 && Math.abs(y - 2 * s) < 1e-9 && Math.abs(a - 2 * s) < 1e-9) barraM = br;
      }
    }
  m.caso("q", F);
  const mod = m.modelo();
  const [cb] = casosValidos(calcular(mod));
  const w = cb!.u[6 * nudo(2 * s, 2 * s) + 2]!;
  const M = new DiagramasBarras(mod).diagrama(barraM, 0, cb!).esfuerzosEn(s / 2, 1)[4]!;
  return { N, abacos: conAbaco, malla, lamina, barras: { w, M }, errorW: lamina.w / w - 1, errorM: lamina.M / M - 1 };
}

// 4. Viga continua de viguetas sobre muros
export function continuaSobreMuros(t: number) {
  const f: ModeloFisico = {
    plantas: [
      { id: "P1", altura: null },
      { id: "P0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "T", material: "H", forma: "T", bf: 0.75, hf: 0.05, bw: 0.12, h: 0.3 }],
    muros: [0, 5, 10].map((x, i) => ({ id: `M${i}`, puntos: [[x, -1], [x, 7]] as Vec2[], desde: "P0", hasta: "P1", espesor: t, material: "H" })),
    panos: [
      { id: "F1", planta: "P1", contorno: [[0, 0], [5, 0], [5, 6], [0, 6]], direccion: 0, intereje: 0.75, seccion: "T", pp: 0 },
      { id: "F2", planta: "P1", contorno: [[5, 0], [10, 0], [10, 6], [5, 6]], direccion: 0, intereje: 0.75, seccion: "T", pp: 0 },
    ],
    casos: [{ id: "q" }],
    cargas: [{ tipo: "superficie", id: "S", caso: "q", planta: "P1", zona: [[0, 0], [10, 0], [10, 6], [0, 6]], q: [0, 0, -5] }],
  };
  const r = valido(compilar(f));
  const c = casosValidos(calcular(r.modelo));
  const ep = new EsfuerzosPiezas(r.modelo, r.mapeo, c);
  const v = r.mapeo.panos!.F1![3]!;
  const tr = ep.tramos(v);
  const qL = 5 * 0.75 * 5;
  const Rb = ep.en(v, 0, tr[tr.length - 1]!.s1)![2]!;
  const Ra = -ep.en(v, 0, tr[0]!.s0)![2]!;
  return { t, extrema: Ra / qL, central: (2 * Rb) / qL, error: (2 * Rb) / qL / 1.25 - 1 };
}

if (import.meta.main) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { iniciarNucleo } = await import("../../src/nucleo/index.ts");
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const L: string[] = [];
  const p = (x: number, d = 4) => (x * 100).toFixed(d);
  L.push("1. Multiplicadores del reticular frente a la T a mano (ν = 0,2):");
  for (const x of comparaMultiplicadores()) {
    const c = x.compilador;
    L.push(`   ${x.nombre}: f11 ${c.f11.toFixed(4)}, f12 ${c.f12.toFixed(4)}, m11 ${c.m11.toFixed(4)}, m12 ${c.m12.toFixed(4)}, v13 ${c.v13.toFixed(4)}; error de los exactos ${x.exactos.toExponential(1)}, m12 frente a Roark ${p(x.m12, 2)} %`);
  }
  L.push("2. Placa de Navier ortótropa (reticular 30+5 de 6 × 4 m, «hard»), w en el centro:");
  for (const h of [0.5, 0.25, 0.125]) {
    const x = navierReticular(h);
    L.push(`   h = ${h}: ${x.laminas} láminas, w ${(x.w * 1000).toFixed(5)} mm frente a ${(x.wExacta * 1000).toFixed(5)} mm: ${p(x.error, 3)} %`);
  }
  L.push("3. Recuadro reticular 30+5 frente al emparrillado de nervios (flecha junto al centro y momento por nervio en el centro):");
  const linea = (x: Emparrillado, que: string) =>
    `   ${que}: lámina w ${(x.lamina.w * 1000).toFixed(3)} mm y M ${x.lamina.M.toFixed(3)} kN·m; emparrillado ${(x.barras.w * 1000).toFixed(3)} mm y ${x.barras.M.toFixed(3)} kN·m: ${p(x.errorW, 2)} % y ${p(x.errorM, 2)} %`;
  for (const N of [8, 12, 16]) L.push(linea(emparrillado(N, false), `apoyado, ${N} nervios por lado (${(N * 0.82).toFixed(2)} m)`));
  L.push(linea(emparrillado(8, true), "apoyado, 8 nervios, con ábacos de 2s en las esquinas (el emparrillado no tiene nudo en la esquina: no da su reacción de torsión)"));
  for (const ab of [false, true])
    for (const nu0 of [false, true])
      L.push(linea(emparrilladoPilar(12, ab, nu0), `12 nervios (9,84 m) con un pilar central${ab ? " y su ábaco de 3s" : " sin ábaco"}${nu0 ? ", con ν = 0 en los dos" : ""} (w en (2s, 2s), M en (2,5s, 2s))`));
  L.push("4. Dos vanos de viguetas (5 m, s = 0,75) sobre muros de espesor t: reacción central frente a 1,25·q·s·L:");
  for (const t of [0.25, 0.1, 0.05, 0.03]) {
    const x = continuaSobreMuros(t);
    L.push(`   t = ${t} m: extrema ${x.extrema.toFixed(4)}·qL (0,375), central ${x.central.toFixed(4)}·qL: ${p(x.error, 2)} %`);
  }
  writeFileSync(join(import.meta.dirname, "out_oraculos.txt"), L.join("\n") + "\n");
  console.log(L.join("\n"));
}
