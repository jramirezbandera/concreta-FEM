/**
 * Decisiones de C4 medidas (para el informe y para que el usuario las confirme):
 * - C4-a: viguetas de dos vanos en las mismas rectas (continuas) frente a desalineadas (cada paño
 *   centrado en su ancho: otro intereje y un borde 30 cm más corto), sobre una viga intermedia;
 * - C4-c: torsión de las viguetas liberada en un extremo frente a conservada (J de la T bruta, entera
 *   y ×0,1), en el recuadro sobre cuatro vigas;
 * - C4-e: la parte del peso del paño que va a las vigas paralelas a las viguetas;
 * - C4-h: los multiplicadores del emparrillado con ν = 0 frente a las mismas razones aplicadas a la
 *   maciza con ν = 0,2 (como un modelo de SAP2000 con multiplicadores), frente al emparrillado de
 *   nervios del criterio 2.
 *
 *   node validacion/c4/decisiones.ts > validacion/c4/out_decisiones.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, Vec2 } from "../../src/compilador/fisico.ts";
import { EsfuerzosPiezas } from "../../src/compilador/resultados.ts";
import { seccionNervio } from "../../src/compilador/reticular.ts";
import { calcular } from "../../src/motor/calcular.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";
import { torsionRectangulo } from "../../src/secciones/seccion3D.ts";
import { emparrillado } from "./oraculos.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const pct = (a: number, b: number) => `${((a / b - 1) * 100).toFixed(1)} %`;

/** Dos vanos de 5 m (x de 0 a 10) por 6 m sobre vigas y pilares. */
function dosVanos(desalineados: boolean): ModeloFisico {
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "P0", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
      { id: "T", material: "HA", forma: "T", bf: 0.75, hf: 0.05, bw: 0.12, h: 0.3 },
    ],
    pilares: [0, 5, 10].flatMap((x) => [0, 6].map((y) => ({ id: `C${x}-${y}`, x, y, desde: "P0", hasta: "P1", seccion: "p" }))),
    vigas: [
      ...[0, 5, 10].map((x) => ({ id: `VY${x}`, planta: "P1", puntos: [[x, 0], [x, 6]] as Vec2[], seccion: "v" })),
      { id: "VX0", planta: "P1", puntos: [[0, 0], [10, 0]], seccion: "v" },
      { id: "VX6", planta: "P1", puntos: [[0, 6], [10, 6]], seccion: "v" },
      ...(desalineados ? [{ id: "VX03", planta: "P1", puntos: [[5, 0.3], [10, 0.3]] as Vec2[], seccion: "v" }] : []),
    ],
    panos: [
      { id: "F1", planta: "P1", contorno: rect(0, 0, 5, 6), direccion: 0, intereje: 0.75, seccion: "T", pp: 3.5 },
      { id: "F2", planta: "P1", contorno: desalineados ? rect(5, 0.3, 10, 6) : rect(5, 0, 10, 6), direccion: 0, intereje: desalineados ? 0.7501 : 0.75, seccion: "T", pp: 3.5 },
    ],
    casos: [{ id: "G", pesoPropio: true }],
  };
}

function c4a(): string[] {
  const L = ["C4-a, viguetas de dos vanos de 5 m sobre una viga intermedia (peso propio):"];
  for (const des of [false, true]) {
    const r = valido(compilar(dosVanos(des)));
    const ep = new EsfuerzosPiezas(r.modelo, r.mapeo, casosValidos(calcular(r.modelo)));
    const v = r.mapeo.panos!.F1![3]!;
    const t = ep.tramos(v);
    const Mapoyo = ep.en(v, 0, t[t.length - 1]!.s1)![4]!;
    let Mvano = -Infinity;
    for (let s = 0; s <= 5; s += 0.05) Mvano = Math.max(Mvano, ep.en(v, 0, Math.min(Math.max(s, t[0]!.s0), t[t.length - 1]!.s1))![4]!);
    // Torsión de la viga intermedia
    let T = 0;
    for (const b of r.mapeo.piezas.VY5!) for (const x of [0, 1]) T = Math.max(T, Math.abs(ep.diagrama(b, 0).esfuerzosEn(x === 0 ? 0 : ep.diagrama(b, 0).L, 1)[3]!));
    L.push(`  ${des ? "desalineadas (cada paño en su ancho)" : "en las mismas rectas (C4-a)"}: vigueta del vano 1, momento en el apoyo intermedio ${Mapoyo.toFixed(2)} kN·m y máximo de vano ${Mvano.toFixed(2)} kN·m; torsión máxima de la viga intermedia ${T.toFixed(2)} kN·m`);
  }
  const q = 3.5 * 0.75;
  L.push(`  (viga continua de dos vanos iguales: −qL²/8 = ${(-(q * 25) / 8).toFixed(2)} y 9qL²/128 = ${((9 * q * 25) / 128).toFixed(2)} kN·m; biapoyada: qL²/8 = ${((q * 25) / 8).toFixed(2)})`);
  return L;
}

/** El recuadro de 5 × 6 sobre cuatro vigas con un paño de viguetas según X. */
function recuadro(): ModeloFisico {
  return {
    plantas: [
      { id: "P1", altura: null },
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
    panos: [{ id: "F", planta: "P1", contorno: rect(0, 0, 5, 6), direccion: 0, intereje: 0.75, seccion: "T", pp: 3.5 }],
    casos: [{ id: "G", pesoPropio: true }],
  };
}

function c4c(): string[] {
  // En los dos vanos: la viga de fachada gira y la intermedia casi no, así que las viguetas se tuercen
  // (en un recuadro simétrico sus dos extremos giran igual y la torsión no trabaja)
  const L = ["C4-c, torsión de las viguetas en los dos vanos de 5 m sobre vigas (peso propio):"];
  const r = valido(compilar(dosVanos(false)));
  const variantes: [string, (m: ModeloAnalitico) => ModeloAnalitico][] = [
    ["liberada en un extremo (C4-c)", (m) => m],
    ["conservada, J de la T bruta", (m) => ({ ...m, barras: m.barras!.map((b, i) => (r.mapeo.barras[i]!.tipo === "vigueta" ? { ...b, liberaciones: undefined } : b)) })],
    ["conservada, J ×0,1 (como D4 en las vigas)", (m) => ({ ...m, barras: m.barras!.map((b, i) => (r.mapeo.barras[i]!.tipo === "vigueta" ? { ...b, liberaciones: undefined, modificadores: { J: 0.1 } } : b)) })],
  ];
  for (const [nombre, f] of variantes) {
    const m = f(r.modelo);
    const ep = new EsfuerzosPiezas(m, r.mapeo, casosValidos(calcular(m)));
    const v = r.mapeo.panos!.F1![3]!;
    const t = ep.tramos(v);
    const Mext = ep.en(v, 0, t[0]!.s0)![4]!;
    const Mint = ep.en(v, 0, t[t.length - 1]!.s1)![4]!;
    let Mv = -Infinity;
    for (let x = t[0]!.s0; x <= t[t.length - 1]!.s1; x += 0.05) Mv = Math.max(Mv, ep.en(v, 0, x)![4]!);
    let Mva = -Infinity;
    let Tva = 0;
    for (const b of r.mapeo.piezas.VY0!) {
      const d = ep.diagrama(b, 0);
      for (let x = 0; x <= d.L; x += d.L / 10) {
        Mva = Math.max(Mva, d.esfuerzosEn(x, 1)[4]!);
        Tva = Math.max(Tva, Math.abs(d.esfuerzosEn(x, 1)[3]!));
      }
    }
    L.push(`  ${nombre}: vigueta del vano 1, M en la fachada ${Mext.toFixed(2)}, máximo de vano ${Mv.toFixed(2)} y en el apoyo intermedio ${Mint.toFixed(2)} kN·m; viga de fachada, M máximo de vano ${Mva.toFixed(2)} y torsión máxima ${Tva.toFixed(2)} kN·m`);
  }
  return L;
}

function c4e(): string[] {
  // El pp del paño como carga de superficie, sin el peso de las vigas
  const f = recuadro();
  const g: ModeloFisico = { ...f, panos: [{ ...f.panos![0]!, pp: 0 }], casos: [{ id: "Q" }], cargas: [{ tipo: "superficie", id: "S", caso: "Q", planta: "P1", pano: "F", q: [0, 0, -3.5] }] };
  const r = valido(compilar(g));
  let paralelas = 0;
  for (const cb of r.modelo.casos[0]!.barras ?? []) {
    const p = r.mapeo.barras[cb.barra]!.pieza;
    if ((p === "VC" || p === "VD") && cb.tipo === "distribuida") paralelas += ((cb.qa[2] + (cb.qb ?? cb.qa)[2]) / 2) * ((cb.b ?? 0) - (cb.a ?? 0));
  }
  for (const cn of r.modelo.casos[0]!.nodales ?? []) paralelas += cn.f[2];
  return [
    `C4-e, de 3,5 kN/m² sobre el recuadro de 5 × 6 (105 kN), lo que va a las vigas paralelas a las viguetas (VC y VD): ${(-paralelas).toFixed(3)} kN, el ${((-100 * paralelas) / 105).toFixed(2)} % (franjas de 0,1875 m, la mitad de la de borde de 0,375 m); con toda la franja de borde a la última vigueta, 0`,
  ];
}

function c4h(): string[] {
  const L = ["C4-h, multiplicadores del reticular 30+5 frente al emparrillado de nervios (recuadro apoyado de 8 nervios, flecha junto al centro y momento por nervio):"];
  const x = emparrillado(8, false);
  L.push(`  del emparrillado con ν = 0 (C4-h): lámina w ${(x.lamina.w * 1000).toFixed(3)} mm y M ${x.lamina.M.toFixed(3)} kN·m; emparrillado ${(x.barras.w * 1000).toFixed(3)} mm y ${x.barras.M.toFixed(3)} kN·m: ${pct(x.lamina.w, x.barras.w)} y ${pct(x.lamina.M, x.barras.M)}`);
  // Las mismas razones (sin compensar G) sobre la maciza con ν = 0,2, como multiplicadores dados
  const g = { h: 0.35, hf: 0.05, bw: 0.12, s: 0.82 };
  const { A, I } = seccionNervio(g);
  const Jw = torsionRectangulo(g.bw, g.h - g.hf);
  const razones = { f11: A / (g.s * g.h), f22: A / (g.s * g.h), f12: g.hf / g.h, m11: (12 * I) / (g.s * g.h ** 3), m22: (12 * I) / (g.s * g.h ** 3), m12: (g.hf ** 3 + (6 * Jw) / g.s) / g.h ** 3, v13: g.bw / g.s, v23: g.bw / g.s };
  const s = g.s;
  const Lr = 8 * s;
  const sop = [true, true, true, false, false, false] as const;
  const f: ModeloFisico = {
    plantas: [{ id: "P0", altura: null }],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25, peso: 0 }],
    secciones: [],
    losas: [{ id: "L", planta: "P0", contorno: rect(0, 0, Lr, Lr), espesor: g.h, material: "H", reticular: { intereje: s, nervio: g.bw, capa: g.hf, multiplicadores: razones } }],
    apoyosLineales: [{ id: "a", planta: "P0", puntos: [[0, 0], [Lr, 0], [Lr, Lr], [0, Lr], [0, 0]], coartados: sop }],
    casos: [{ id: "q" }],
    cargas: [{ tipo: "superficie", id: "Q", caso: "q", planta: "P0", losa: "L", q: [0, 0, -10] }],
  };
  const r = valido(compilar(f, { tamanoMalla: s / 4 }));
  const u = casosValidos(calcular(r.modelo))[0]!.u;
  const n = r.modelo.nudos.findIndex((p) => Math.abs(p.x - 3.5 * s) < 1e-6 && Math.abs(p.y - 3.5 * s) < 1e-6);
  L.push(`  las mismas razones sobre la maciza con ν = 0,2 (multiplicadores dados, como SAP2000): w ${(u[6 * n + 2]! * 1000).toFixed(3)} mm: ${pct(u[6 * n + 2]!, x.barras.w)} frente al emparrillado`);
  return L;
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  console.log([...c4a(), ...c4c(), ...c4e(), ...c4h()].join("\n"));
}
