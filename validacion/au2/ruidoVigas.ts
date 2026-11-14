/**
 * A2-53, lo que quedaba (`docs/fem3d/auditoria-2.md` §11): con un ruido de ±ε_geom/3 en el dibujo, alguna
 * viga se parte en un nudo más. Por retícula al azar (con y sin muros) y semilla, las piezas cuyas barras
 * cambian de número, con los puntos de corte que sobran o faltan (frente al modelo sin ruido, a 1e-5).
 * Uso: bun validacion/au2/ruidoVigas.ts > validacion/au2/out_ruidoVigas.txt
 */
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, Vec2 } from "../../src/compilador/fisico.ts";
import { azar } from "../../src/pruebas/fisicoAleatorio.ts";
import { transformar } from "../../src/pruebas/metamorficasFisicas.ts";
import { conMurosAleatorios } from "../../src/pruebas/murosAleatorios.ts";
import { reticulaAleatoria } from "../../src/pruebas/reticulasAleatorias.ts";

const conRuido = (f: ModeloFisico, amp: number, semilla: number): ModeloFisico => {
  const r = azar(semilla);
  const e = () => (2 * r() - 1) * amp;
  return transformar(f, { p: (q: Vec2) => [q[0] + e(), q[1] + e()], v: (q) => [q[0]!, q[1]!, q[2]!], giro: 0 });
};
/** La retícula al azar con los muros al azar de C3 (como en `geometrias.test.ts`). */
function reticulaConMuros(semilla: number): ModeloFisico {
  const f = reticulaAleatoria(semilla);
  const conVb = { ...f, secciones: [...f.secciones, { id: "vb", material: "HA", forma: "rectangular" as const, b: 0.3, h: 0.5 }], casos: [...f.casos, { id: "V" }] };
  return conMurosAleatorios(conVb, semilla);
}
type C = Extract<ReturnType<typeof compilar>, { valido: true }>;
const puntos = (c: C, pieza: string) => {
  const bs = c.mapeo.piezas[pieza] ?? [];
  const ps: [number, number, number][] = [];
  for (const b of bs) for (const n of c.modelo.barras![b]!.nudos) { const nd = c.modelo.nudos[n]!; ps.push([nd.x, nd.y, nd.z]); }
  return ps;
};
const args = process.argv.slice(2);
const casos = args.length ? args.map((a) => a.split(":")) : Array.from({ length: 24 }, (_, i) => [[String(i + 1), ""], [String(i + 1), "m"]]).flat();
let total = 0;
for (const [i, m] of casos) {
  const f = m === "m" ? reticulaConMuros(Number(i)) : reticulaAleatoria(Number(i));
  const a = compilar(f);
  if (!a.valido) { console.log(`ret ${i}${m}: no compila`); continue; }
  for (const semilla of [555, 7]) {
    const b = compilar(conRuido(f, 1e-6 / 3, semilla));
    if (!b.valido) { console.log(`ret ${i}${m} s${semilla}: no compila con ruido`); continue; }
    for (const pieza of Object.keys(a.mapeo.piezas)) {
      const [na, nb] = [a.mapeo.piezas[pieza]!.length, b.mapeo.piezas[pieza]?.length ?? 0];
      if (na === nb) continue;
      total++;
      const [pa, pb] = [puntos(a, pieza), puntos(b, pieza)];
      const lejos = (p: number[], qs: number[][]) => !qs.some((q) => Math.abs(p[0]! - q[0]!) + Math.abs(p[1]! - q[1]!) + Math.abs(p[2]! - q[2]!) <= 1e-5);
      const sobran = pb.filter((p) => lejos(p, pa)).map((p) => `(${p.map((v) => v.toFixed(4)).join(", ")})`);
      const faltan = pa.filter((p) => lejos(p, pb)).map((p) => `(${p.map((v) => v.toFixed(4)).join(", ")})`);
      console.log(`ret ${i}${m} s${semilla} ${pieza}: ${na} → ${nb} barras; sobran ${[...new Set(sobran)].join(" ")}; faltan ${[...new Set(faltan)].join(" ")}`);
    }
  }
}
console.log(`\npiezas que cambian: ${total}`);
