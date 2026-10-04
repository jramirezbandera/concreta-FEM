/**
 * Criterio 4 de E5: bandas (cortes por el método «campos», en cualquier posición) frente a
 * soluciones cerradas y frente al corte exacto por fuerzas nodales.
 *
 * 1. Losa unidireccional (isostática en el ancho completo): My = −q·b·x(L − x)/2 y Vz = q·b(L/2 − x)
 *    en estaciones fuera de las líneas de la malla.
 * 2. Placas de Navier de E3: ∫Mx dy y ∫Qx dy a lo ancho de toda la placa en x = a/2 (línea de la
 *    malla) y en x = 1,3 m (fuera de ella), frente a la integral de la serie.
 * 3. Losa plana de H25 (12 × 12 m sobre 3 × 3 pilares, luces de 6 m, t = 0,25 m) con la huella de
 *    0,6 × 0,6 m de cada pilar como enlace rígido: banda de pilar (3 m) y pórtico virtual (6 m) en la
 *    cara del pilar central (x = 6,3) y en el vano (x = 3), por fuerzas nodales y por campos, con
 *    mallas de 0,3, 0,15 y 0,075 m; y Wood–Armer punto a punto en la banda frente a sobre su media.
 *
 * Uso: bun validacion/e5/bandas.ts → validacion/e5/out_bandas.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { woodArmer } from "../../src/dimensionado/woodArmer.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { CamposLaminas } from "../../src/motor/campos.ts";
import { Cortes, type Corte, type ResultadoCorte } from "../../src/motor/cortes.ts";
import type { CargaLamina, ModeloAnalitico } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { Constructor } from "../../src/pruebas/constructor.ts";
import { navierMindlin } from "../../src/pruebas/navier.ts";
import { mallaRectangular } from "../../src/pruebas/placa.ts";
import { A, B, modeloNavier, placaNavier, type CasoNavier } from "../e3/navier.ts";
import { losaUnidireccional } from "./cortes.ts";

/** Calcula un modelo y corta por los dos métodos (los cortes de fuerzas nodales sólo si se piden). */
export function cortarModelo(modelo: ModeloAnalitico, cortes: readonly Corte[]): ResultadoCorte[] {
  const casos = casosValidos(calcular(modelo));
  const ct = new Cortes(modelo);
  const campos = new CamposLaminas(modelo);
  return cortes.map((c) => ct.cortar(c, casos, campos));
}

/** Losa unidireccional: peores errores de My y Vz (frente a q·b·L²/8 y q·b·L/2) en estaciones fuera de la malla. */
export function erroresLosaCampos(nx: number, ny: number): { My: number; Vz: number } {
  const { modelo, L, b, q } = losaUnidireccional(nx, ny);
  const xs = [0.37, 1.23, 2.5, 3.11, 4.71, 5.6].map((x) => (x * L) / 6);
  const r = cortarModelo(
    modelo,
    xs.map((x): Corte => ({ origen: [x, b / 2, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-b / 2, b / 2], metodo: "campos" })),
  );
  const e = { My: 0, Vz: 0 };
  xs.forEach((x, i) => {
    const s = r[i]!.esfuerzos;
    e.My = Math.max(e.My, Math.abs(s[4]! + (q * b * x * (L - x)) / 2) / Math.abs((q * b * L * L) / 8));
    e.Vz = Math.max(e.Vz, Math.abs(s[2]! - q * b * (L / 2 - x)) / Math.abs((q * b * L) / 2));
  });
  return e;
}

/** ∫₀ᴮ f(y) dy por Gauss–Legendre de 4 puntos en 256 tramos. */
function integralY(f: (y: number) => number): number {
  const s = [0.0694318442029737, 0.3300094782075719, 0.6699905217924281, 0.9305681557970263];
  const w = [0.1739274225687269, 0.3260725774312731, 0.3260725774312731, 0.1739274225687269];
  const n = 256;
  let r = 0;
  for (let i = 0; i < n; i++) for (let q = 0; q < 4; q++) r += (w[q]! * B * f(((i + s[q]!) * B) / n)) / n;
  return r;
}

/** Placa de Navier: errores relativos de ∫Mx dy (en x = a/2 y x = 1,3) y de ∫Qx dy (en x = 1,3). */
export function erroresBandaNavier(c: CasoNavier, h: number): { MyCentro: number; MyFuera: number; VzFuera: number } {
  const { modelo } = modeloNavier(c, Math.round(A / h), Math.round(B / h));
  const p = placaNavier(c);
  const xs = [A / 2, 1.3];
  const r = cortarModelo(
    modelo,
    xs.map((x): Corte => ({ origen: [x, B / 2, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-B / 2, B / 2], metodo: "campos" })),
  );
  const ref = xs.map((x) => [integralY((y) => navierMindlin(p, x, y, 151)[1]), integralY((y) => navierMindlin(p, x, y, 151)[4])] as const);
  return {
    MyCentro: r[0]!.esfuerzos[4]! / ref[0]![0] - 1,
    MyFuera: r[1]!.esfuerzos[4]! / ref[1]![0] - 1,
    VzFuera: r[1]!.esfuerzos[2]! / ref[1]![1] - 1,
  };
}

export const LUZ = 6;
export const PILAR = 0.6;

/**
 * Losa plana de H25: 12 × 12 m, t = 0,25 m, sobre 3 × 3 pilares (en x, y = 0, 6 y 12) con la huella
 * de PILAR × PILAR enlazada rígidamente a la cabeza, que apoya en z (articulada). Carga uniforme de
 * 10 kN/m². Malla h (PILAR/2 tiene que ser múltiplo de h).
 */
export function losaPlana(h: number): ModeloAnalitico {
  const L = 2 * LUZ;
  const n = Math.round(L / h);
  const m = new Constructor();
  const g = mallaRectangular(m, { a: L, b: L, nx: n, ny: n, material: { E: 3e7, nu: 0.2, t: 0.25 } });
  const r = Math.round(PILAR / 2 / h);
  for (const ci of [0, LUZ, 2 * LUZ]) {
    for (const cj of [0, LUZ, 2 * LUZ]) {
      const i0 = Math.round(ci / h);
      const j0 = Math.round(cj / h);
      const esclavos: number[] = [];
      for (let i = Math.max(0, i0 - r); i <= Math.min(n, i0 + r); i++) for (let j = Math.max(0, j0 - r); j <= Math.min(n, j0 + r); j++) if (i !== i0 || j !== j0) esclavos.push(g.nudos[i]![j]!);
      const cabeza = g.nudos[i0]![j0]!;
      m.enlace(cabeza, esclavos, `H${ci}-${cj}`);
      m.apoyo(cabeza, [true, true, true, false, false, true]);
    }
  }
  m.caso("q", [], [], [], g.laminas.flat().map((l): CargaLamina => ({ tipo: "superficie", lamina: l, ejes: "global", q: [0, 0, -10] })));
  return m.modelo();
}

/** Cortes de la losa plana: cara del pilar central (x = 6,3) y vano (x = 3), banda de pilar y pórtico. */
export function cortesLosaPlana(metodo: "fuerzas-nodales" | "campos", x: number): Corte[] {
  return [
    { id: `banda de pilar en x = ${x}`, origen: [x, LUZ, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-1.5, 1.5], metodo },
    { id: `pórtico virtual en x = ${x}`, origen: [x, LUZ, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-3, 3], metodo },
  ];
}

export interface BandasLosaPlana {
  /** My y Vz [banda de pilar, pórtico] en la cara del pilar, por fuerzas nodales y por campos. */
  caraNodal: number[][];
  caraCampos: number[][];
  /** My [banda, pórtico] en el vano (x = 3), por los dos métodos. */
  vanoNodal: number[];
  vanoCampos: number[];
  /**
   * Banda de pilar en la cara, con las muestras: ∫Mx dy, y Wood–Armer de la cara superior en x
   * punto a punto e integrado, y sobre los momentos medios.
   */
  woodArmer: { integralMx: number; porPunto: number; sobreMedia: number };
}

export function bandasLosaPlana(h: number): BandasLosaPlana {
  const modelo = losaPlana(h);
  const xc = LUZ + PILAR / 2;
  const r = cortarModelo(modelo, [...cortesLosaPlana("fuerzas-nodales", xc), ...cortesLosaPlana("campos", xc), ...cortesLosaPlana("fuerzas-nodales", 3), ...cortesLosaPlana("campos", 3)]);
  for (const x of r) if (!x.valido) throw new Error(x.diagnosticos.map((d) => d.mensaje).join(" | "));
  const par = (i: number) => [r[i]!.esfuerzos[4]!, r[i]!.esfuerzos[2]!];
  // Wood–Armer en la banda de pilar de la cara (por campos): momentos de los puntos en los ejes de la franja
  const m = r[2]!.muestras!;
  let porPunto = 0;
  let integralMx = 0;
  let ancho = 0;
  const media = [0, 0, 0];
  for (let j = 0; j < m.pesos.length; j++) {
    const v = m.valores[0]!.subarray(8 * j, 8 * j + 8);
    const w = m.pesos[j]!;
    porPunto += w * woodArmer(v[3]!, v[4]!, v[5]!).superiorX;
    integralMx += w * v[3]!;
    ancho += w;
    for (let c = 0; c < 3; c++) media[c]! += (w * v[3 + c]!) / 3; // ÷ 3 m de banda
  }
  return {
    caraNodal: [par(0), par(1)],
    caraCampos: [par(2), par(3)],
    vanoNodal: [r[4]!.esfuerzos[4]!, r[5]!.esfuerzos[4]!],
    vanoCampos: [r[6]!.esfuerzos[4]!, r[7]!.esfuerzos[4]!],
    woodArmer: { integralMx, porPunto, sobreMedia: woodArmer(media[0]!, media[1]!, media[2]!).superiorX * ancho },
  };
}

const pct = (v: number) => `${(100 * v >= 0 ? "+" : "") + (100 * v).toFixed(2)} %`;

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const { CASOS_NAVIER } = await import("../e3/navier.ts");
  const lineas: string[] = [];
  const log = (s = "") => {
    console.log(s);
    lineas.push(s);
  };
  log("# Criterio 4 de E5: bandas por el método «campos»");
  log();
  log("## 1. Losa unidireccional de 6 × 2 m: estaciones fuera de la malla (x = 0,37 … 5,6 m)");
  log("| malla | error de My (÷ qbL²/8) | error de Vz (÷ qbL/2) |");
  log("|---|---|---|");
  for (const [nx, ny] of [[6, 2], [12, 4], [24, 8]] as const) {
    const e = erroresLosaCampos(nx, ny);
    log(`| ${nx} × ${ny} | ${e.My.toExponential(2)} | ${e.Vz.toExponential(2)} |`);
  }
  log();
  log("## 2. Placas de Navier (6 × 4 m): ∫Mx dy y ∫Qx dy a lo ancho de la placa");
  for (const c of CASOS_NAVIER) {
    log();
    log(c.nombre);
    log("| h | ∫Mx dy en x = 3 (línea de malla) | ∫Mx dy en x = 1,3 | ∫Qx dy en x = 1,3 |");
    log("|---|---|---|---|");
    for (const h of [0.5, 0.25, 0.125]) {
      const e = erroresBandaNavier(c, h);
      log(`| ${h} | ${pct(e.MyCentro)} | ${pct(e.MyFuera)} | ${pct(e.VzFuera)} |`);
    }
  }
  log();
  log("## 3. Losa plana de H25 con huella de 0,6 × 0,6 m (q = 10 kN/m²): banda de pilar (3 m) y pórtico virtual (6 m)");
  log("| h | método | My banda, cara | My pórtico, cara | Vz banda, cara | Vz pórtico, cara | My banda, vano | My pórtico, vano |");
  log("|---|---|---|---|---|---|---|---|");
  const f = (v: number) => v.toFixed(2);
  const wa: string[] = [];
  for (const h of [0.3, 0.15, 0.075]) {
    const b = bandasLosaPlana(h);
    log(`| ${h} | fuerzas nodales | ${f(b.caraNodal[0]![0]!)} | ${f(b.caraNodal[1]![0]!)} | ${f(b.caraNodal[0]![1]!)} | ${f(b.caraNodal[1]![1]!)} | ${f(b.vanoNodal[0]!)} | ${f(b.vanoNodal[1]!)} |`);
    log(`| ${h} | campos | ${f(b.caraCampos[0]![0]!)} | ${f(b.caraCampos[1]![0]!)} | ${f(b.caraCampos[0]![1]!)} | ${f(b.caraCampos[1]![1]!)} | ${f(b.vanoCampos[0]!)} | ${f(b.vanoCampos[1]!)} |`);
    wa.push(`| ${h} | ${f(-b.caraNodal[0]![0]!)} | ${f(-b.woodArmer.integralMx)} | ${f(b.woodArmer.porPunto)} | ${f(b.woodArmer.sobreMedia)} |`);
  }
  log();
  log("Banda de pilar en la cara, con las muestras del corte (kN·m): −My exacto (fuerzas nodales), −∫Mx dy de las muestras, y Wood–Armer de la cara superior en x integrado punto a punto y sobre los momentos medios de la banda (× su ancho)");
  log("| h | −My | −∫Mx dy (muestras) | ∫ WA punto a punto | WA de la media × ancho |");
  log("|---|---|---|---|---|");
  for (const l of wa) log(l);
  writeFileSync(join(import.meta.dirname, "out_bandas.txt"), lineas.join("\n") + "\n");
}
