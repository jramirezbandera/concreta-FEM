/**
 * Fase CO, lo medido antes de empezar (`docs/fem3d/comprobaciones.md` §3): los pilares del edificio
 * objetivo de losas, con viento y con el sismo del programa, comprobados con el motor de pilares de
 * Concreta (`calcRCColumn`) tal como está en su repositorio.
 *
 *   bun validacion/co/medir.ts --concreta <ruta del clon de Concreta> [--plantas N]   escribe out_medir.txt
 *
 * Qué mide:
 *
 *  1. H31 con esfuerzos reales. En cada extremo de tramo de pilar, la comprobación con todas las
 *     combinaciones (con el sismo, sus ternas de signos pésimos, VS-o) frente a la comprobación con
 *     sólo los cuatro extremos con concomitantes que da `fem consultar pieza` (N+, N−, My y Mz).
 *     Se arma cada extremo con la primera disposición de una tabla (ordenada por área) que cumple, de
 *     las dos maneras, y se cuenta cuántas veces los cuatro extremos eligen un armado menor.
 *  2. El coste: llamadas al motor y tiempo, comprobando un armado dado y eligiéndolo de la tabla.
 *
 * Es una medida, no una dependencia: el motor de Concreta se importa de la ruta que se da (este
 * repositorio no lo importa nunca, y CO1 lo copiará a un commit fijo). Los esfuerzos se leen sólo por
 * `Consultas` (`combinar`, `sup.partir`), como hará el extractor.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { conjuntoCombinaciones } from "../../src/agente/combinaciones.ts";
import { ternasPesimas } from "../../src/agente/consultas.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { AccionCaso, ModeloFisico } from "../../src/compilador/fisico.ts";
import type { Situacion } from "../../src/combinaciones/generador.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const concreta = arg("--concreta");
if (!concreta) throw new Error("Falta --concreta <ruta del clon de Concreta>");
const url = (r: string) => pathToFileURL(join(concreta, r)).href;
const { calcRCColumn } = (await import(url("src/lib/calculations/rcColumns.ts"))) as { calcRCColumn: (i: Record<string, unknown>) => { valid: boolean; checks: { id: string; utilization: number }[] } };
const { rcColumnDefaults } = (await import(url("src/data/defaults.ts"))) as { rcColumnDefaults: Record<string, unknown> };

const RAIZ = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const ACCIONES: Record<string, AccionCaso> = {
  G: { tipo: "G" },
  Q: { tipo: "Q", psi: "uso-A" },
  Vx: { tipo: "W", psi: "viento", direccion: "X", signo: 1, familia: "viento" },
  Vy: { tipo: "W", psi: "viento", direccion: "Y", signo: 1, familia: "viento" },
};
const plantas = Number(arg("--plantas") ?? 7);
const base = plantas === 7 ? edificioObjetivoLosas(7) : edificioObjetivoLosas(plantas, 3, 2);
const f: ModeloFisico = { ...base, casos: base.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })), acciones: { sismo: { ab: 0.16, K: 1.0, terreno: "III", mu: 2, sistema: "porticos-ha" } } };
const t0 = performance.now();
const c = compilar(f);
if (!c.valido) throw new Error("no compila");
const r = calcular(c.modelo);
if (!r.valido) throw new Error("no calcula");
const tCalculo = performance.now() - t0;
const q = new Consultas(f, c, r.casos, {}, r.modal);

// La tabla de armados: esquinas y n barras intermedias por cara del mismo diámetro, por área creciente
const TABLA = [12, 16, 20, 25]
  .flatMap((d) => [0, 1, 2, 3].map((n) => ({ d, n, area: (4 + 4 * n) * Math.PI * (d / 2) ** 2 })))
  .sort((a, b) => a.area - b.area);
const RESISTENTES = new Set(["nd-max", "nm-y", "nm-z", "biaxial-check"]);
let llamadas = 0;
let tMotor = 0;

/** El mayor aprovechamiento resistente de una terna [N, Vy, Vz, T, My, Mz] (N > 0, tracción) con el armado k. */
function eta(b: number, h: number, fck: number, L: number, k: number, e: ArrayLike<number>): number {
  const Nd = -e[0]!;
  if (Nd < 1) return 0; // tracción: el motor de pilares no la comprueba (va aparte, §4)
  const a = TABLA[k]!;
  const t = performance.now();
  const x = calcRCColumn({ ...rcColumnDefaults, b: b * 1000, h: h * 1000, fck, cornerBarDiam: a.d, nBarsX: a.n, barDiamX: a.d, nBarsY: a.n, barDiamY: a.d, stirrupDiam: 8, stirrupSpacing: 150, Nd, MEdy: Math.abs(e[4]!), MEdz: Math.abs(e[5]!), L, beta: 1 });
  tMotor += performance.now() - t;
  llamadas++;
  if (!x.valid) return Infinity;
  let u = 0;
  for (const ch of x.checks) if (RESISTENTES.has(ch.id) && Number.isFinite(ch.utilization)) u = Math.max(u, ch.utilization);
  return u;
}

/** El primer armado de la tabla con el que todas las ternas cumplen, y su aprovechamiento; −1 si ninguno. */
function armar(b: number, h: number, fck: number, L: number, ternas: readonly ArrayLike<number>[]): { k: number; eta: number } {
  for (let k = 0; k < TABLA.length; k++) {
    let u = 0;
    for (const e of ternas) {
      u = Math.max(u, eta(b, h, fck, L, k, e));
      if (u > 1) break;
    }
    if (u <= 1) return { k, eta: u };
  }
  return { k: -1, eta: Infinity };
}

const cuantil = (v: number[], p: number) => (v.length ? [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(p * v.length))]! : NaN);
const lineas: string[] = [];
const di = (s: string) => {
  lineas.push(s);
  console.log(s);
};
di(`Fase CO, lo medido antes de empezar: pilares del edificio objetivo de losas (${plantas} plantas), viento y sismo del programa`);
di(`${f.pilares!.length} pilares, ${c.modelo.nudos.length} nudos; compilar y calcular, ${(tCalculo / 1000).toFixed(1)} s (información)`);
di(`Tabla de armados: ${TABLA.map((a) => `${4 + 4 * a.n}Ø${a.d}`).join(", ")}`);
di("");

for (const situaciones of [["ELU-PT"], ["ELU-PT", "ELU-SIS"]] as Situacion[][]) {
  const cj = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones });
  if (!cj.valido) throw new Error("sin combinaciones");
  const { factores } = cj.valor;
  llamadas = 0;
  tMotor = 0;
  let extremos = 0;
  let traccion = 0;
  let sinArmado = 0;
  let menor = 0;
  let nTernas = 0;
  const cociente: number[] = []; // η de los cuatro extremos / η de todas, con el armado de todas
  const exceso: number[] = []; // η de todas con el armado que eligen los cuatro extremos, cuando es menor
  let llamadasComprobar = 0;
  let tComprobar = 0;
  for (const p of f.pilares!) {
    const tr = q.pilar(p.id);
    if (!tr.valido) throw new Error(`pilar ${p.id}`);
    for (const t of tr.valor) {
      const sec = f.secciones.find((s) => s.id === t.seccion)! as { b: number; h: number; material: string };
      const fck = (f.materiales.find((m) => m.id === sec.material) as { fck: number }).fck;
      for (const porCaso of [t.base.esfuerzos, t.cabeza.esfuerzos]) {
        // Todas las combinaciones: una terna o, con el sismo del programa, las de sus signos pésimos (VS-o)
        const todas: number[][] = [];
        for (const fa of factores) todas.push(...(q.sup.esLineal(fa) ? [Array.from(q.combinar(porCaso, 6, fa))] : ternasPesimas(q.sup.partir(porCaso, 6, fa))));
        // Los cuatro extremos con concomitantes de `fem consultar pieza`
        const mejor: Record<string, number[]> = {};
        for (const e of todas) {
          if (!mejor["N+"] || e[0]! > mejor["N+"]![0]!) mejor["N+"] = e;
          if (!mejor["N-"] || e[0]! < mejor["N-"]![0]!) mejor["N-"] = e;
          if (!mejor.My || Math.abs(e[4]!) > Math.abs(mejor.My[4]!)) mejor.My = e;
          if (!mejor.Mz || Math.abs(e[5]!) > Math.abs(mejor.Mz[5]!)) mejor.Mz = e;
        }
        const cuatro = Object.values(mejor);
        extremos++;
        nTernas += todas.length;
        if (todas.some((e) => -e[0]! < 1)) traccion++;
        const A = armar(sec.b, sec.h, fck, t.longitud, todas);
        const B = armar(sec.b, sec.h, fck, t.longitud, cuatro);
        if (A.k < 0) {
          sinArmado++;
          continue;
        }
        // Comprobar el armado elegido con todas (lo que cuesta comprobar un armado dado, sin salir antes)
        const l0 = llamadas;
        const m0 = tMotor;
        let uTodas = 0;
        for (const e of todas) uTodas = Math.max(uTodas, eta(sec.b, sec.h, fck, t.longitud, A.k, e));
        llamadasComprobar += llamadas - l0;
        tComprobar += tMotor - m0;
        let uCuatro = 0;
        for (const e of cuatro) uCuatro = Math.max(uCuatro, eta(sec.b, sec.h, fck, t.longitud, A.k, e));
        if (uTodas > 0) cociente.push(uCuatro / uTodas);
        if (B.k >= 0 && B.k < A.k) {
          menor++;
          let u = 0;
          for (const e of todas) u = Math.max(u, eta(sec.b, sec.h, fck, t.longitud, B.k, e));
          exceso.push(u);
        }
      }
    }
  }
  di(`── ${situaciones.join(" + ")}: ${factores.length} combinaciones, ${extremos} extremos de tramo, ${(nTernas / extremos).toFixed(0)} ternas por extremo`);
  di(`   con alguna terna en tracción (fuera del motor de pilares): ${traccion}; sin armado en la tabla: ${sinArmado}`);
  di(`   η con los cuatro extremos / η con todas (mismo armado): mediana ${cuantil(cociente, 0.5).toFixed(3)}, p10 ${cuantil(cociente, 0.1).toFixed(3)}, mínimo ${Math.min(...cociente).toFixed(3)}`);
  di(`   los cuatro extremos no contienen la pésima: ${cociente.filter((x) => x < 1 - 1e-9).length} de ${cociente.length} (${((100 * cociente.filter((x) => x < 1 - 1e-9).length) / cociente.length).toFixed(0)} %); la subestiman más de un 5 %: ${cociente.filter((x) => x < 0.95).length} (${((100 * cociente.filter((x) => x < 0.95).length) / cociente.length).toFixed(0)} %)`);
  di(`   armando con los cuatro extremos sale un armado menor que con todas: ${menor} de ${extremos - sinArmado} (${((100 * menor) / (extremos - sinArmado)).toFixed(1)} %)${exceso.length ? `; con él, η de todas: mediana ${cuantil(exceso, 0.5).toFixed(2)}, máximo ${Math.max(...exceso).toFixed(2)}` : ""}`);
  di(`   coste (información): comprobar un armado dado con todas, ${llamadasComprobar} llamadas y ${(tComprobar / 1000).toFixed(1)} s (${((1e3 * tComprobar) / llamadasComprobar).toFixed(0)} µs por llamada); todo lo de esta medida, ${llamadas} llamadas y ${(tMotor / 1000).toFixed(1)} s`);
  di("");
}
writeFileSync(join(import.meta.dirname, "out_medir.txt"), lineas.join("\n") + "\n");
