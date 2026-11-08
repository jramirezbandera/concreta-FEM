/**
 * Las franjas de un reticular en sus nervios (2026-11-08, `docs/fem3d/franjas.md` §2.8): qué cambia en
 * la referencia congelada de F. Sólo deberían moverse las franjas de los reticulares (cuántas, sus
 * bordes y sus medios): ni la malla, ni los resultados de los casos, ni las macizas, ni el metro de un
 * pilar (su ventana es de un intereje centrada en él, no depende de los bordes de las franjas).
 *
 * Por modelo, frente al fixture de antes: la malla y los casos (iguales), si las franjas son las
 * mismas, y en los que cambian, por dirección: cuántas franjas, el ancho de las de los extremos, los
 * metros de pilar (estaciones con ventana) que no casan y el mayor Wood–Armer inferior y superior con
 * la suma de los casos, por metro y por nervio (antes, por metro × s; ahora, por metro × ancho de su
 * franja).
 * Uso: bun validacion/f/cambiosNervios.ts > validacion/f/out_cambiosNervios.txt (antes de regenerar el fixture)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { redondeo } from "../c5/congelar.ts";
import { MODELOS_CONGELADOS_F, referenciaF, type ReferenciaF } from "./congelar.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const antes = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-f.json"), "utf8")) as Record<string, ReferenciaF>;
const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);

type Franjas = ReferenciaF["franjas"];
/** Los metros de pilar (estaciones con ventana), por su recta y su ventana: los medios. */
function metros(fs: Franjas): Map<string, string> {
  const r = new Map<string, string>();
  for (const f of Object.values(fs)) for (const e of f.estaciones) if (e.ventana) r.set(`${e.tipo}:${e.s.toFixed(6)}:${e.lado}:${e.ventana.map((x) => x.toFixed(6)).join(",")}`, e.medios.map((x) => x.toPrecision(10)).join(","));
  return r;
}
/** Por dirección: n franjas, anchos de los extremos, máximos de Wood–Armer por metro y por nervio. */
function resumen(fs: Franjas, dir: "X" | "Y", s: number | null, anchoNervio: (t: [number, number]) => number) {
  const g = Object.entries(fs).filter(([id]) => id.split(":").at(-1)!.startsWith(dir));
  let [inf, sup, infN, supN] = [0, 0, 0, 0];
  for (const [, f] of g)
    for (const w of f.wa) {
      if (w[0] === null || w[1] === null) continue;
      const b = s === null ? 1 : anchoNervio(f.t);
      inf = Math.max(inf, w[0]);
      sup = Math.max(sup, Math.abs(w[1]));
      infN = Math.max(infN, w[0] * b);
      supN = Math.max(supN, Math.abs(w[1]) * b);
    }
  const anchos = g.map(([, f]) => f.t[1] - f.t[0]);
  return { n: g.length, extremos: anchos.length ? `${f2(anchos[0]!)} / ${f2(anchos.at(-1)!)}` : "-", inf, sup, infN, supN };
}

for (const [k, f] of Object.entries(MODELOS_CONGELADOS_F)) {
  const a = antes[k]!;
  const b = JSON.parse(JSON.stringify(referenciaF(f), redondeo)) as ReferenciaF;
  const malla = JSON.stringify(a.c2.modelo) === JSON.stringify(b.c2.modelo);
  const casos = JSON.stringify(a.c2.casos) === JSON.stringify(b.c2.casos);
  const iguales = JSON.stringify(a.franjas) === JSON.stringify(b.franjas);
  console.log(`${k}: malla ${malla ? "igual" : "DISTINTA"}, casos ${casos ? "iguales" : "DISTINTOS"}, franjas ${iguales ? "iguales" : "cambian"}`);
  if (iguales) continue;
  const ret = f().fisico.losas?.find((l) => l.reticular)?.reticular;
  const s = ret?.intereje ?? null;
  const [ma, mb] = [metros(a.franjas), metros(b.franjas)];
  let distintos = 0;
  let faltan = 0;
  for (const [c, v] of mb) {
    const x = ma.get(c);
    if (x === undefined) faltan++;
    else if (x !== v) distintos++;
  }
  console.log(`  metros de pilar: ${mb.size} (antes ${ma.size}); ${faltan} sin pareja antes, ${distintos} con otros medios`);
  for (const dir of ["X", "Y"] as const) {
    const ra = resumen(a.franjas, dir, s, () => s ?? 1);
    const rb = resumen(b.franjas, dir, s, (t) => t[1] - t[0]);
    console.log(`  ${dir}: franjas ${ra.n} → ${rb.n}; extremos ${ra.extremos} → ${rb.extremos} m`);
    console.log(`     máx. por metro (kN·m/m)   inferior ${f1(ra.inf)} → ${f1(rb.inf)}, superior ${f1(ra.sup)} → ${f1(rb.sup)}`);
    if (s !== null) console.log(`     máx. por nervio (kN·m)    inferior ${f1(ra.infN)} → ${f1(rb.infN)}, superior ${f1(ra.supN)} → ${f1(rb.supN)}`);
  }
}
