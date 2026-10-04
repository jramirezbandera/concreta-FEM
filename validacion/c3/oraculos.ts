/**
 * Criterio 2 de C3: oráculos analíticos de los muros descritos como modelo físico.
 *
 * 1. Muro en voladizo de 3 plantas (H17, E0): 3 × 9 m, t = 0,25, E = 3e7, ν = 0,2, empotrado en su
 *    base y con 100 kN repartidos a lo largo de su cabeza (carga lineal sobre su eje). Frente a la
 *    viga de Timoshenko: δ = PH³/(3EI) + PH/(κGA), κ = 5/6 (1,5552 mm, la de E0). Se mide la media
 *    de ux en los nudos de la cabeza.
 * 2. Muro de sótano en flexión cilíndrica: 24 × 3 m, t = 0,3, empotrado en su base y libre arriba,
 *    con un empuje hidrostático de 30 kN/m² en la base a 0 en la cabeza. En el centro: flecha en
 *    cabeza p₀H⁴/(30D) + p₀H²/(6κGt) y momento M(z) = p₀(H − z)³/(6H) en el centroide de los
 *    elementos de su columna central (rectángulos: el valor del centroide converge con orden 2).
 * 3. Losa apoyada en dos muros paralelos: muros de 3 m (t = 0,3) empotrados en su base en x = 0 y
 *    x = 6, losa de 25 cm entre ellos y de 24 m de ancho (a ejes), con 10 kN/m². En su centro
 *    (y = 12), frente al pórtico equivalente de barras de 1 m de ancho (E' = E/(1 − ν²), I = t³/12,
 *    A = t, Av = 5t/6): en el encuentro con el muro, el momento por metro del corte por fuerzas
 *    nodales a lo largo del eje del muro (y de 6 a 18: lo que el muro ejerce sobre la losa, E5-5);
 *    en el vano, Mx de la losa por SPR.
 * 4. Viga en el plano de un muro (E0, H05): muro de 3 × 3 m (t = 0,25), empotrado, con una viga de
 *    30 × 50 que sale de su extremo a media altura (en la cota de una planta) y vuela 3 m, con 50 kN
 *    en la punta. La viga entra en el muro con las barras auxiliares de C3-e. Con elementos de 0,25
 *    es el modelo «embebida 2 elementos (= canto)» de E0: 6,430 mm (ASDShellQ4: 6,451); la solución
 *    rígida es 4,80 mm.
 */
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { DiagramasBarras } from "../../src/motor/barras.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { CamposLaminas } from "../../src/motor/campos.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import type { ModeloAnalitico, ResultadoCaso } from "../../src/motor/modelo.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { Constructor } from "../../src/pruebas/constructor.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";

const E = 3e7;
const NU = 0.2;
const G = E / (2 * (1 + NU));
const material = { id: "H", tipo: "general" as const, E, G, peso: 0 };
const sinDiafragma = (ids: string[], alturas: (number | null)[]) => ids.map((id, i) => ({ id, altura: alturas[i]!, diafragma: "ninguno" as const }));

function resolver(f: ModeloFisico, h: number) {
  const r = valido(compilar(f, { tamanoMalla: h, modificadores: {} }));
  const [c] = casosValidos(calcular(r.modelo));
  return { r, c: c! };
}

/** Lámina que contiene el punto (x, y, z) y sus coordenadas naturales. */
function enPunto(modelo: ModeloAnalitico, campos: CamposLaminas, u: Float64Array, X: [number, number, number], filtro: (k: number) => boolean): ArrayLike<number> {
  const ev = campos.evaluador(u);
  for (let k = 0; k < (modelo.laminas ?? []).length; k++) {
    if (!filtro(k)) continue;
    const nat = ev.naturales(k, X);
    if (nat && Math.abs(nat[0]) <= 1 + 1e-9 && Math.abs(nat[1]) <= 1 + 1e-9) return ev.en(k, nat[0], nat[1]);
  }
  throw new Error(`ninguna lámina en (${X.join(", ")})`);
}

// 1. Muro en voladizo
export const VOLADIZO = { B: 3, H: 9, t: 0.25, P: 100 };

export function voladizoFisico(): ModeloFisico {
  const { B, t, P } = VOLADIZO;
  return {
    plantas: sinDiafragma(["P3", "P2", "P1", "P0"], [null, 3, 3, 3]),
    materiales: [material],
    secciones: [],
    muros: [{ id: "M", puntos: [[0, 0], [B, 0]], desde: "P0", hasta: "P3", espesor: t, material: "H" }],
    casos: [{ id: "P" }],
    cargas: [{ tipo: "lineal", id: "q", caso: "P", planta: "P3", puntos: [[0, 0], [B, 0]], q: [P / B, 0, 0] }],
  };
}

export function voladizoTimoshenko(): number {
  const { B, H, t, P } = VOLADIZO;
  return (P * H ** 3) / (3 * E * ((t * B ** 3) / 12)) + (P * H) / ((5 / 6) * G * t * B);
}

export function voladizo(h: number): { delta: number; error: number; laminas: number } {
  const { r, c } = resolver(voladizoFisico(), h);
  const cabeza = r.modelo.nudos.flatMap((v, i) => (Math.abs(v.z - VOLADIZO.H) < 1e-9 ? [i] : []));
  const delta = cabeza.reduce((s, n) => s + c.u[6 * n]!, 0) / cabeza.length;
  return { delta, error: delta / voladizoTimoshenko() - 1, laminas: r.modelo.laminas!.length };
}

// 2. Muro de sótano en flexión cilíndrica
export const SOTANO = { L: 24, H: 3, t: 0.3, p0: 30 };

export function sotanoFisico(): ModeloFisico {
  const { L, H, t, p0 } = SOTANO;
  return {
    plantas: sinDiafragma(["P1", "P0"], [null, H]),
    materiales: [material],
    secciones: [],
    muros: [{ id: "M", puntos: [[0, 0], [L, 0]], desde: "P0", hasta: "P1", espesor: t, material: "H" }],
    casos: [{ id: "EMPUJE" }],
    cargas: [{ tipo: "empuje", id: "E", caso: "EMPUJE", muro: "M", lado: "derecho", z0: 0, z1: H, p0, p1: 0 }],
  };
}

export function sotanoExacto(z: number): { w: number; M: number } {
  const { H, t, p0 } = SOTANO;
  const D = (E * t ** 3) / (12 * (1 - NU * NU));
  return { w: (p0 * H ** 4) / (30 * D) + (p0 * H * H) / (6 * (5 / 6) * G * t), M: (p0 * (H - z) ** 3) / (6 * H) };
}

export function sotano(h: number): { w: number; errorW: number; errorM: number; laminas: number } {
  const { L, H } = SOTANO;
  const { r, c } = resolver(sotanoFisico(), h);
  const m = r.modelo;
  const centro = m.nudos.findIndex((v) => Math.abs(v.x - L / 2) < 1e-9 && Math.abs(v.z - H) < 1e-9);
  const w = c.u[6 * centro + 1]!;
  // Momento vertical (My, eje 2 hacia arriba) en el centroide de los elementos que tocan x = L/2
  let errorM = 0;
  m.laminas!.forEach((l, k) => {
    const X = l.nudos.map((n) => m.nudos[n]!);
    if (!(Math.abs(X[0]!.x - L / 2) < 1e-9 || Math.abs(X[1]!.x - L / 2) < 1e-9)) return;
    const zc = (X[0]!.z + X[3]!.z) / 2;
    const ex = sotanoExacto(zc).M;
    errorM = Math.max(errorM, Math.abs(Math.abs(c.esfuerzosLaminas[8 * k + 4]!) - ex) / sotanoExacto(0).M);
  });
  return { w, errorW: w / sotanoExacto(0).w - 1, errorM, laminas: m.laminas!.length };
}

// 3. Losa apoyada en dos muros
export const LOSA_MUROS = { L: 6, W: 24, H: 3, tm: 0.3, tl: 0.25, q: 10 };

export function losaMurosFisico(): ModeloFisico {
  const { L, W, tm, tl, q } = LOSA_MUROS;
  return {
    plantas: sinDiafragma(["P1", "P0"], [null, LOSA_MUROS.H]),
    materiales: [material],
    secciones: [],
    muros: [
      { id: "M1", puntos: [[0, 0], [0, W]], desde: "P0", hasta: "P1", espesor: tm, material: "H" },
      { id: "M2", puntos: [[L, 0], [L, W]], desde: "P0", hasta: "P1", espesor: tm, material: "H" },
    ],
    losas: [{ id: "L", planta: "P1", contorno: [[0, 0], [L, 0], [L, W], [0, W]], espesor: tl, material: "H", pp: 0 }],
    casos: [{ id: "Q" }],
    cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -q] }],
  };
}

/** Pórtico equivalente de 1 m de ancho: momentos de la viga (la losa) en su extremo y en el centro. */
export function porticoEquivalente(): { extremo: number; vano: number } {
  const { L, H, tm, tl, q } = LOSA_MUROS;
  const Ep = E / (1 - NU * NU);
  const seccion = (t: number) => ({ E: Ep, G, A: t, Iy: t ** 3 / 12, Iz: t / 12, J: t ** 3 / 3, Avz: (5 / 6) * t });
  const c = new Constructor();
  const [A, B, C, D] = [c.nudo(0, 0, 0), c.nudo(0, 0, H), c.nudo(L, 0, H), c.nudo(L, 0, 0)];
  c.barra(A, B, seccion(tm), [1, 0, 0]);
  const viga = c.barra(B, C, seccion(tl), [0, 0, 1]);
  c.barra(D, C, seccion(tm), [1, 0, 0]);
  c.apoyo(A);
  c.apoyo(D);
  for (const n of [B, C]) c.apoyo(n, [false, true, false, true, false, true]);
  c.caso("Q", [], [], [{ tipo: "distribuida", barra: viga, ejes: "global", qa: [0, 0, -q] }]);
  const m = c.modelo();
  const [res] = casosValidos(calcular(m));
  const d = new DiagramasBarras(m).diagrama(viga, 0, res as ResultadoCaso);
  return { extremo: d.esfuerzosEn(0, 1)[4]!, vano: d.esfuerzosEn(L / 2, 1)[4]! };
}

export function losaMuros(h: number): { extremo: number; vano: number; errorExtremo: number; errorVano: number; laminas: number } {
  const { L, W, H } = LOSA_MUROS;
  const { r, c } = resolver(losaMurosFisico(), h);
  const campos = new CamposLaminas(r.modelo);
  const deLosa = (k: number) => r.mapeo.laminas![k]!.losa !== undefined;
  // Corte por el eje del muro x = 0, con la normal hacia −x: lo que el muro ejerce sobre la losa
  const corte = new Cortes(r.modelo).cortar({ origen: [0, W / 2, H], x: [-1, 0, 0], vz: [0, 0, 1], y: [-W / 4, W / 4] }, [c]);
  if (!corte.valido || !corte.extension) throw new Error(corte.diagnosticos.map((d) => d.mensaje).join("; "));
  const extremo = corte.esfuerzos[4]! / (corte.extension.y[1] - corte.extension.y[0]);
  const vano = enPunto(r.modelo, campos, c.u, [L / 2, W / 2, H], deLosa)[3]!;
  const ref = porticoEquivalente();
  return { extremo, vano, errorExtremo: extremo / ref.extremo - 1, errorVano: vano / ref.vano - 1, laminas: r.modelo.laminas!.length };
}

// 4. Viga en el plano de un muro (E0)
export const VIGA_MURO = { W: 3, Hm: 3, t: 0.25, b: 0.3, hv: 0.5, L: 3, P: 50, E0: 6.43e-3, ASD: 6.451e-3, rigida: 4.8e-3 };

export function vigaMuroFisico(): ModeloFisico {
  const { W, t, b, hv, L, P } = VIGA_MURO;
  return {
    plantas: sinDiafragma(["P2", "P1", "P0"], [null, 1.5, 1.5]),
    materiales: [material],
    secciones: [{ id: "S30x50", material: "H", forma: "general", A: b * hv, Iy: (b * hv ** 3) / 12, Iz: (hv * b ** 3) / 12, J: 3e-3, b, h: hv }],
    muros: [{ id: "M", puntos: [[0, 0], [W, 0]], desde: "P0", hasta: "P2", espesor: t, material: "H" }],
    vigas: [{ id: "V", planta: "P1", puntos: [[W, 0], [W + L, 0]], seccion: "S30x50" }],
    casos: [{ id: "P" }],
    cargas: [{ tipo: "puntual", id: "F", caso: "P", planta: "P1", x: W + L, y: 0, F: [0, 0, -P] }],
  };
}

export function vigaMuro(h: number): { punta: number; frenteE0: number; frenteASD: number; frenteRigida: number; auxiliares: number } {
  const { W, L } = VIGA_MURO;
  const { r, c } = resolver(vigaMuroFisico(), h);
  const n = r.modelo.nudos.findIndex((v) => Math.abs(v.x - (W + L)) < 1e-9 && Math.abs(v.z - 1.5) < 1e-9);
  const punta = -c.u[6 * n + 2]!;
  return { punta, frenteE0: punta / VIGA_MURO.E0 - 1, frenteASD: punta / VIGA_MURO.ASD - 1, frenteRigida: punta / VIGA_MURO.rigida, auxiliares: r.estadisticas.muros.auxiliares };
}

if (import.meta.main) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { iniciarNucleo } = await import("../../src/nucleo/index.ts");
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const pct = (v: number) => `${(100 * v).toFixed(2)} %`;
  const lineas = [`# validacion/c3/oraculos.ts — ${new Date().toLocaleDateString("sv-SE")}: oráculos analíticos de los muros (criterio 2 de C3); h = 0,75 es el tamaño por defecto`, ""];
  lineas.push(`## Muro en voladizo 3 × 9 m frente a Timoshenko (${(voladizoTimoshenko() * 1e3).toFixed(4)} mm)`, "| h | láminas | δ (mm) | error |", "|---|---|---|---|");
  for (const h of [0.75, 0.375, 0.1875]) {
    const r = voladizo(h);
    lineas.push(`| ${h} | ${r.laminas} | ${(r.delta * 1e3).toFixed(4)} | ${pct(r.error)} |`);
  }
  const ex = sotanoExacto(0);
  lineas.push("", `## Muro de sótano 24 × 3 m con empuje hidrostático (flexión cilíndrica): w = ${(ex.w * 1e3).toFixed(4)} mm, M base = ${ex.M} kN·m/m`, "| h | láminas | w (mm) | error w | error M (máx en la columna central) |", "|---|---|---|---|---|");
  for (const h of [0.75, 0.375, 0.1875]) {
    const r = sotano(h);
    lineas.push(`| ${h} | ${r.laminas} | ${(r.w * 1e3).toFixed(4)} | ${pct(r.errorW)} | ${pct(r.errorM)} |`);
  }
  const p = porticoEquivalente();
  lineas.push("", `## Losa sobre dos muros frente al pórtico equivalente: encuentro ${p.extremo.toFixed(3)} y vano ${p.vano.toFixed(3)} kN·m/m`, "| h | láminas | encuentro (corte) | error | vano (SPR) | error |", "|---|---|---|---|---|---|");
  for (const h of [0.75, 0.375, 0.25]) {
    const r = losaMuros(h);
    lineas.push(`| ${h} | ${r.laminas} | ${r.extremo.toFixed(3)} | ${pct(r.errorExtremo)} | ${r.vano.toFixed(3)} | ${pct(r.errorVano)} |`);
  }
  lineas.push("", `## Viga en el plano de un muro (E0): embebida (E0) ${(VIGA_MURO.E0 * 1e3).toFixed(3)} mm, ASDShellQ4 ${(VIGA_MURO.ASD * 1e3).toFixed(3)} mm, rígida ${(VIGA_MURO.rigida * 1e3).toFixed(2)} mm`, "| h | barras auxiliares | punta (mm) | frente a E0 | frente a ASDShellQ4 | ÷ rígida |", "|---|---|---|---|---|---|");
  for (const h of [0.75, 0.375, 0.25]) {
    const r = vigaMuro(h);
    lineas.push(`| ${h} | ${r.auxiliares} | ${(r.punta * 1e3).toFixed(3)} | ${pct(r.frenteE0)} | ${pct(r.frenteASD)} | ${r.frenteRigida.toFixed(3)} |`);
  }
  const texto = lineas.join("\n");
  console.log(texto);
  writeFileSync(join(import.meta.dirname, "out_oraculos.txt"), texto + "\n");
}
