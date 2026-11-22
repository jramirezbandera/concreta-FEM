/**
 * CO4-7 (docs/fem3d/comprobaciones.md §8.9): qué cambia en las referencias congeladas de CO3 y CO4 al
 * regenerarlas a sabiendas, sin el cortante de las astillas (las estaciones con menos de un canto de
 * losa en el ancho de su franja).
 *
 *   bun validacion/co/cambiosAstillas.ts <co3-antes.json> <co4-antes.json> > validacion/co/out_cambiosAstillas.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReferenciaCO3 } from "./congelarLosas.ts";
import type { ReferenciaCO4 } from "./congelarPunzonamiento.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const leer = <T,>(r: string) => JSON.parse(readFileSync(r, "utf8")) as Record<string, T>;
const [co3a, co4a] = [leer<ReferenciaCO3>(process.argv[2]!), leer<ReferenciaCO4>(process.argv[3]!)];
const co3 = leer<ReferenciaCO3>(join(RAIZ, "src", "comprobaciones", "__fixtures__", "congelado-co3.json"));
const co4 = leer<ReferenciaCO4>(join(RAIZ, "src", "comprobaciones", "__fixtures__", "congelado-co4.json"));
const f = (x: number | null | undefined) => (x === null || x === undefined ? "—" : x.toFixed(3));

console.log("== CO3, las losas");
for (const [m, r] of Object.entries(co3)) {
  const a = co3a[m]!;
  console.log(`${m}: ${JSON.stringify(a.resumen)} → ${JSON.stringify(r.resumen)}`);
  for (const l of r.losas) {
    const o = a.losas.find((x) => x.losa === l.losa)!;
    const cortante = (x: typeof l) => x.filas.filter((y) => /\/shear$/.test(y.id));
    const nuevas = cortante(l).length - cortante(o).length;
    const peor = (x: typeof l) => Math.max(0, ...cortante(x).map((y) => y.aprovechamiento ?? Infinity));
    if (o.cumple !== l.cumple || JSON.stringify(o.armado) !== JSON.stringify(l.armado) || nuevas || peor(o) !== peor(l))
      console.log(`  ${l.losa}: cumple ${o.cumple} → ${l.cumple}; filas de cortante ${cortante(o).length} → ${cortante(l).length}; el peor cortante ${f(peor(o))} → ${f(peor(l))}; armado ${JSON.stringify(o.armado) === JSON.stringify(l.armado) ? "igual" : "distinto"}`);
  }
}
console.log("\n== CO4, el punzonamiento");
for (const [m, r] of Object.entries(co4)) {
  const a = co4a[m]!;
  console.log(`${m}: ${JSON.stringify(a.resumen)} → ${JSON.stringify(r.resumen)}`);
  for (const p of r.pilares) {
    const o = a.pilares.find((x) => x.pilar === p.pilar && x.planta === p.planta);
    if (!o) {
      console.log(`  ${p.pilar}@${p.planta}: nuevo`);
      continue;
    }
    const fila = (x: typeof p, id: string) => x.filas.find((y) => y.id.endsWith(id))?.aprovechamiento ?? null;
    const [v0, v1] = [fila(o, "/punz-ved-vrdc"), fila(p, "/punz-ved-vrdc")];
    const [r0, r1] = [fila(o, "/punz-rho-min"), fila(p, "/punz-rho-min")];
    const arm = JSON.stringify(o.armadura) === JSON.stringify(p.armadura) ? "" : `; armadura ${JSON.stringify(o.armadura)} → ${JSON.stringify(p.armadura)}`;
    console.log(`  ${p.pilar}@${p.planta}: vEd/vRd,c ${f(v0)} → ${f(v1)}; ρl,min/ρl ${f(r0)} → ${f(r1)}; cumple ${o.cumple} → ${p.cumple}${arm}`);
  }
}
