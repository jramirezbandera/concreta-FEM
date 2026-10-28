/**
 * Fase TB (`docs/fem3d/tiras-borde.md`): lo que cambian las tiras de borde.
 * 1. La vivienda sin zunchos (`src/editor/vigasBorde.vivienda.json`) con «Vigas de borde» en sus dos
 *    cubiertas (la losa y sus cargas, como se dibujaron), con las tiras (por defecto) y sin ellas (la
 *    franja de 12 cm entre la cara de los zunchos y el borde, mallada): nudos, reacciones totales y
 *    de cada pilar en G y Q.
 * 2. La retícula al azar 16 (la de la regresión de precisión de HR): las vigas en la cara de los
 *    pilares y las estaciones de las franjas junto a ellos, gruesa (h = 0,75) frente a fina (0,25),
 *    con y sin tiras, y la fina con frente a sin (el cambio de modelo).
 *   bun validacion/tb/medir.ts > validacion/tb/out_medir.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { aplicar } from "../../src/editor/operaciones.ts";
import { operacionVigasBorde, proponerVigasBorde } from "../../src/editor/vigasBorde.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { diferenciasLocales, medirLocal, type MedidaLocal } from "../../src/pruebas/precisionLocal.ts";
import { reticulaAleatoria } from "../../src/pruebas/reticulasAleatorias.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const f1 = (x: number) => x.toFixed(1);

// 1. La vivienda
const l = leerProyecto(readFileSync(join(RAIZ, "src", "editor", "vigasBorde.vivienda.json"), "utf8"));
if (!l.valido) throw new Error("vivienda");
let p = l.proyecto;
for (const id of ["L-CUB", "L-CUB-S"]) {
  const r = proponerVigasBorde(p.modelo, id, 0.3, 0.3);
  if ("error" in r) throw new Error(r.error);
  const a = aplicar(p, operacionVigasBorde(p.modelo, r)!);
  if (!a.ok) throw new Error(id);
  p = a.proyecto;
}
const f: ModeloFisico = p.modelo;
const medir = (tirasBorde: boolean) => {
  const c = compilar(f, { tirasBorde });
  if (!c.valido) throw new Error(c.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join("\n"));
  const cs = casosValidos(calcular(c.modelo));
  const q = new Consultas(f, c, cs, {});
  const R = new Map(f.pilares!.map((x) => {
    const r = q.reacciones(x.id);
    if (!r.valido) throw new Error(x.id);
    return [x.id, Array.from(r.valor.resultante)] as const;
  }));
  return { c, R, casos: c.modelo.casos.map((x) => x.id), tiras: (c.mapeo.anchos ?? []).filter((a) => a.tira).length };
};
const [con, sin] = [medir(true), medir(false)];
console.log("1. Vivienda con «Vigas de borde» (las dos cubiertas), con tiras frente a la franja mallada");
console.log(`   nudos: ${con.c.modelo.nudos.length} con tiras (${con.tiras}), ${sin.c.modelo.nudos.length} sin ellas`);
con.casos.forEach((caso, k) => {
  const tot = (m: typeof con) => [...m.R.values()].reduce((s, v) => s + v[6 * k + 2]!, 0);
  console.log(`   ${caso}: ΣFz ${tot(con).toFixed(6)} frente a ${tot(sin).toFixed(6)} kN`);
  const d = [...con.R].map(([id, v]) => ({ id, a: v[6 * k + 2]!, b: sin.R.get(id)![6 * k + 2]! })).filter((x) => Math.abs(x.b) > 5);
  d.sort((x, y) => Math.abs(y.a / y.b - 1) - Math.abs(x.a / x.b - 1));
  console.log(`      pilares (|Fz| > 5 kN), los que más cambian: ${d.slice(0, 5).map((x) => `${x.id} ${f1(x.b)} → ${f1(x.a)} (${f1(100 * (x.a / x.b - 1))} %)`).join("; ")}`);
});

// 2. La retícula 16
const g = reticulaAleatoria(16);
const base = { zonaRigidaBase: false, planoForjado: "medio" as const };
const m = (tirasBorde: boolean, h?: number) => medirLocal(g, { ...base, tirasBorde, ...(h ? { tamanoMalla: h } : {}) });
const [g0, g1, fi0, fi1] = [m(false), m(true), m(false, 0.25), m(true, 0.25)];
const res = (n: string, a: MedidaLocal, b: MedidaLocal) => {
  for (const k of ["vigas", "franjas"] as const) {
    const d = diferenciasLocales(a[k], b[k]);
    const abs = d.map((x) => Math.abs(x.d)).sort((x, y) => x - y);
    const top = [...d].sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 3).map((x) => `${x.k} ${f1(100 * x.d)} %`);
    console.log(`   ${n}, ${k}: ${abs.length} estaciones, mediana ${(100 * abs[abs.length >> 1]!).toFixed(2)} %, máximo ${f1(100 * abs.at(-1)!)} %, > 10 %: ${abs.filter((x) => x > 0.1).length}; peores ${top.join("; ")}`);
  }
};
console.log("2. Retícula 16, precisión local (respecto al máximo de la viga o de la franja)");
res("gruesa frente a fina, sin tiras", g0, fi0);
res("gruesa frente a fina, con tiras", g1, fi1);
res("fina con tiras frente a fina sin ellas (el modelo)", fi1, fi0);
