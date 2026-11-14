/**
 * A2-37 y las astillas junto a pilares (`docs/fem3d/auditoria-2.md` §11.2): las láminas con un lado de
 * menos de 5 mm (LADO_ASTILLA) en las geometrías de G (5 familias × 4 variantes) y en las retículas al
 * azar 1–24 con y sin muros, con la rejilla y sin ella. Por modelo: cuántas, el lado más corto, dónde
 * (el centro de cada racimo, a 5 cm) y a qué distancia del borde de la huella del pilar más cercano, y
 * si la compilación avisa (`malla/astillas-junto-a-pilar`).
 * Uso: bun validacion/au2/astillas.ts > validacion/au2/out_astillas.txt
 */
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { edificioGeometria, FAMILIAS, type OpcionesGeometria } from "../../src/pruebas/geometrias.ts";
import { conMurosAleatorios } from "../../src/pruebas/murosAleatorios.ts";
import { reticulaAleatoria } from "../../src/pruebas/reticulasAleatorias.ts";

const LADO = 0.005;
const VARIANTES: [string, OpcionesGeometria][] = [["", {}], ["hueco", { hueco: true }], ["giro", { giro: 23 }], ["circ", { circulares: true }]];
function reticulaConMuros(semilla: number): ModeloFisico {
  const f = reticulaAleatoria(semilla);
  const conVb = { ...f, secciones: [...f.secciones, { id: "vb", material: "HA", forma: "rectangular" as const, b: 0.3, h: 0.5 }], casos: [...f.casos, { id: "V" }] };
  return conMurosAleatorios(conVb, semilla);
}
const modelos: [string, ModeloFisico][] = [];
const solo = process.argv[2];
for (const fam of FAMILIAS) for (const [n, v] of VARIANTES) modelos.push([`${fam}${n ? "-" + n : ""}`, edificioGeometria(fam, v)]);
for (let s = 1; s <= 24; s++) {
  modelos.push([`ret${s}`, reticulaAleatoria(s)]);
  modelos.push([`ret${s}-muros`, reticulaConMuros(s)]);
}
let total = 0;
for (const [nombre, f] of modelos) {
  if (solo && !nombre.startsWith(solo)) continue;
  for (const rejilla of [true, false]) {
    const c = compilar(f, { rejilla });
    if (!c.valido) {
      console.log(`${nombre} rejilla=${rejilla}: no compila (${c.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo).join(", ")})`);
      continue;
    }
    const nudos = c.modelo.nudos;
    const rigidos = new Set<number>();
    for (const r of c.modelo.restricciones ?? []) if (r.tipo === "enlace-rigido") for (const v of r.esclavos) rigidos.add(v);
    const racimos: { x: number; y: number; z: number; n: number; lado: number; rigidas: number }[] = [];
    (c.modelo.laminas ?? []).forEach((l) => {
      const X = l.nudos.map((n) => nudos[n]!);
      let lado = Infinity;
      for (let m = 0; m < 4; m++) lado = Math.min(lado, Math.hypot(X[(m + 1) % 4]!.x - X[m]!.x, X[(m + 1) % 4]!.y - X[m]!.y, X[(m + 1) % 4]!.z - X[m]!.z));
      if (!(lado < LADO)) return;
      const [x, y, z] = [X.reduce((s, p) => s + p.x, 0) / 4, X.reduce((s, p) => s + p.y, 0) / 4, X.reduce((s, p) => s + p.z, 0) / 4];
      const todoRigido = l.nudos.every((n) => rigidos.has(n));
      const r = racimos.find((q) => Math.abs(q.x - x) < 0.05 && Math.abs(q.y - y) < 0.05 && Math.abs(q.z - z) < 1e-6);
      if (r) {
        r.n++;
        r.lado = Math.min(r.lado, lado);
        if (todoRigido) r.rigidas++;
      } else racimos.push({ x, y, z, n: 1, lado, rigidas: todoRigido ? 1 : 0 });
    });
    if (!racimos.length) continue;
    const aviso = c.diagnosticos.some((d) => d.codigo === "malla/astillas-junto-a-pilar");
    const pilares = f.pilares ?? [];
    for (const r of racimos) {
      const p = pilares.reduce((m, q) => (Math.hypot(q.x - r.x, q.y - r.y) < Math.hypot(m.x - r.x, m.y - r.y) ? q : m), pilares[0]!);
      total += r.n;
      console.log(`${nombre.padEnd(16)} rejilla=${String(rejilla).padEnd(5)} (${r.x.toFixed(3)}, ${r.y.toFixed(3)}, z ${r.z.toFixed(2)}): ${String(r.n).padStart(3)} láminas, lado ${(1000 * r.lado).toFixed(3)} mm, ${r.rigidas} rígidas; pilar más cercano ${p.id} a ${Math.hypot(p.x - r.x, p.y - r.y).toFixed(3)} m${aviso ? "; con aviso" : ""}`);
    }
  }
}
console.log(`\nláminas de menos de ${LADO * 1000} mm: ${total}`);
