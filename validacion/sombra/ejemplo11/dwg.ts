/**
 * Prueba en sombra del ejemplo 11 (`modelo.ts`): la retícula de casetones del forjado 1 en el DWG que
 * exportó CYPECAD (`ejemplos/ejemplo 1 6x6/ejemplo 11/1.DWG`, AC1018, en cm, con las plantas una al
 * lado de otra), leído con el lector propio (`src/dwg/`). Los casetones son polilíneas de 60 × 60 de
 * la capa PA_NERV_RETI; los recortados por un ábaco, líneas sueltas de la misma capa. De ella salen
 * el punto de paso de los nervios de `modelo.ts` y la comprobación de los bordes de los ábacos que
 * cortan un casetón (los demás, de los nudos del listado).
 *
 *   bun validacion/sombra/ejemplo11/dwg.ts [ruta.dwg]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { leerDwg } from "../../../src/dwg/lector.ts";

const RAIZ = join(import.meta.dirname, "..", "..", "..");
const ruta = process.argv[2] ?? join(RAIZ, "ejemplos", "ejemplo 1 6x6", "ejemplo 11", "1.DWG");
const d = leerDwg(new Uint8Array(readFileSync(ruta)));
// El origen del forjado 1 en el dibujo: el «Ejes del pilar» de P1 en su vista (x 1500–2900 cm)
const p1 = d.entidades.filter((e) => e.tipo === "INSERT" && e.capa === "PILAR_EJES").map((e) => [Number(e.valores[e.codigos.indexOf(10)]), Number(e.valores[e.codigos.indexOf(20)])] as [number, number]).filter(([x]) => x > 1500 && x < 2900);
const [ox, oy] = [Math.min(...p1.map((p) => p[0])), Math.min(...p1.map((p) => p[1]))];
const r = (v: number) => Math.round(v * 1e4) / 1e4;
const dentro = (x: number, y: number) => x > -2 && x < 14 && y > -2 && y < 14;
const cajas: number[][] = [];
for (const p of d.entidades.filter((e) => e.tipo === "POLYLINE" && e.capa === "PA_NERV_RETI")) {
  const vs = (p.hijos ?? []).filter((h) => h.tipo === "VERTEX").map((h) => [(Number(h.valores[h.codigos.indexOf(10)]) - ox) / 100, (Number(h.valores[h.codigos.indexOf(20)]) - oy) / 100]);
  if (!vs.length || !dentro(vs[0]![0]!, vs[0]![1]!)) continue;
  const xs = vs.map((v) => v[0]!), ys = vs.map((v) => v[1]!);
  cajas.push([r(Math.min(...xs)), r(Math.min(...ys)), r(Math.max(...xs)), r(Math.max(...ys))]);
}
const llenos = cajas.filter((c) => c[2]! - c[0]! > 0.5 && c[3]! - c[1]! > 0.5);
const xs0 = [...new Set(llenos.map((c) => c[0]!))].sort((a, b) => a - b);
const ys0 = [...new Set(llenos.map((c) => c[1]!))].sort((a, b) => a - b);
console.log(`Origen del forjado 1 en el dibujo: (${ox}; ${oy}) cm. ${llenos.length} casetones enteros de ${r(llenos[0]![2]! - llenos[0]![0]!)} × ${r(llenos[0]![3]! - llenos[0]![1]!)} m.`);
console.log(`Caras izquierdas: ${xs0.join(" ")} (paso ${r(xs0[1]! - xs0[0]!)})`);
console.log(`Caras inferiores: ${ys0.join(" ")} (paso ${r(ys0[1]! - ys0[0]!)})`);
const nervio = r(xs0[1]! - (xs0[0]! + (llenos[0]![2]! - llenos[0]![0]!)));
console.log(`Nervio ${nervio} m; un eje de nervio en x = ${r(xs0[1]! - nervio / 2)} y otro en y = ${r(ys0[1]! - nervio / 2)} (el punto de paso de modelo.ts).`);
console.log("Casetones (# entero, . no), de arriba abajo:");
for (const y of [...ys0].reverse()) console.log("  " + xs0.map((x) => (llenos.some((c) => c[0] === x && c[1] === y) ? "#" : ".")).join(""));
// Los casetones recortados: los lados sueltos de la capa que no son de un casetón entero
const lineas = d.entidades.filter((e) => e.tipo === "LINE" && e.capa === "PA_NERV_RETI").map((e) => {
  const g = (c: number) => Number(e.valores[e.codigos.indexOf(c)]);
  return [(g(10) - ox) / 100, (g(20) - oy) / 100, (g(11) - ox) / 100, (g(21) - oy) / 100].map(r);
}).filter((l) => dentro(l[0]!, l[1]!));
const enCaseton = (x: number) => xs0.some((x0) => Math.abs(x - x0) < 1e-6 || Math.abs(x - (x0 + 0.6)) < 1e-6);
const enCasetonY = (y: number) => ys0.some((y0) => Math.abs(y - y0) < 1e-6 || Math.abs(y - (y0 + 0.6)) < 1e-6);
const cortesX = [...new Set(lineas.filter((l) => l[0] === l[2] && !enCaseton(l[0]!)).map((l) => l[0]!))].sort((a, b) => a - b);
const cortesY = [...new Set(lineas.filter((l) => l[1] === l[3] && !enCasetonY(l[1]!)).map((l) => l[1]!))].sort((a, b) => a - b);
const cortesP = cajas.filter((c) => !(c[2]! - c[0]! > 0.5 && c[3]! - c[1]! > 0.5));
console.log(`Bordes de ábaco que cortan un casetón: x = ${[...new Set([...cortesX, ...cortesP.filter((c) => c[1] === c[3]).flatMap((c) => [c[0]!, c[2]!]).filter((x) => !enCaseton(x))])].sort((a, b) => a - b).join(", ") || "—"}; y = ${cortesY.join(", ") || "—"}`);
