/**
 * CO6-g (docs/fem3d/comprobaciones.md §8.12): qué cambia en las referencias congeladas de CO3 y CO4 al
 * regenerarlas a sabiendas con el despiece de los refuerzos de las losas (anclaje, uniones, un
 * refuerzo por ábaco y las puntas a 5 cm).
 *
 *   bun validacion/co/cambiosDespiece.ts <co3-antes.json> <co4-antes.json> > validacion/co/out_cambiosDespiece.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArmadoForjado } from "../../src/comprobaciones/armado.ts";
import type { ReferenciaCO3 } from "./congelarLosas.ts";
import type { ReferenciaCO4 } from "./congelarPunzonamiento.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const leer = <T,>(r: string) => JSON.parse(readFileSync(r, "utf8")) as Record<string, T>;
const [co3a, co4a] = [leer<ReferenciaCO3>(process.argv[2]!), leer<ReferenciaCO4>(process.argv[3]!)];
const co3 = leer<ReferenciaCO3>(join(RAIZ, "src", "comprobaciones", "__fixtures__", "congelado-co3.json"));
const co4 = leer<ReferenciaCO4>(join(RAIZ, "src", "comprobaciones", "__fixtures__", "congelado-co4.json"));
const f = (x: number | null | undefined, n = 3) => (x === null || x === undefined ? "—" : x.toFixed(n));

/** De un armado: refuerzos, el más corto, su área en planta (m²) y lo mismo de las zonas de cercos. */
function medidas(a: ArmadoForjado | null) {
  const largo = (x: { s: [number, number] }) => x.s[1] - x.s[0];
  const area = (x: { s: [number, number]; t: [number, number] }) => largo(x) * (x.t[1] - x.t[0]);
  const [rs, cs] = [a?.refuerzos ?? [], a?.cercos ?? []];
  let pisan = 0;
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const [x, y] = [rs[i]!, rs[j]!];
      if (x.armadura !== y.armadura || x.en !== y.en) continue;
      if (Math.min(x.s[1], y.s[1]) - Math.max(x.s[0], y.s[0]) > 1e-6 && Math.min(x.t[1], y.t[1]) - Math.max(x.t[0], y.t[0]) > 1e-6) pisan++;
    }
  return {
    refuerzos: rs.length,
    corto: rs.length ? Math.min(...rs.map(largo)) : null,
    area: rs.reduce((x, r) => x + area(r), 0),
    pisan,
    cercos: cs.length,
    cortoCercos: cs.length ? Math.min(...cs.map(largo)) : null,
    areaCercos: cs.reduce((x, r) => x + area(r), 0),
  };
}

console.log("== CO3, las losas");
for (const [m, r] of Object.entries(co3)) {
  const a = co3a[m]!;
  console.log(`${m}: ${JSON.stringify(a.resumen)} → ${JSON.stringify(r.resumen)}`);
  for (const l of r.losas) {
    const o = a.losas.find((x) => x.losa === l.losa)!;
    const [x, y] = [medidas(o.armado), medidas(l.armado)];
    const peor = (z: typeof l) => Math.max(0, ...z.filas.map((w) => w.aprovechamiento ?? Infinity));
    console.log(`  ${l.losa}: cumple ${o.cumple} → ${l.cumple}; el peor aprovechamiento ${f(peor(o))} → ${f(peor(l))}; base ${JSON.stringify(o.armado?.base) === JSON.stringify(l.armado?.base) ? "igual" : "distinta"}`);
    console.log(`    refuerzos ${x.refuerzos} → ${y.refuerzos}; el más corto ${f(x.corto, 2)} → ${f(y.corto, 2)} m; lo que cubren ${f(x.area, 1)} → ${f(y.area, 1)} m²; parejas de la misma armadura que se pisan ${x.pisan} → ${y.pisan}`);
    console.log(`    zonas de cercos ${x.cercos} → ${y.cercos}; la más corta ${f(x.cortoCercos, 2)} → ${f(y.cortoCercos, 2)} m; lo que cubren ${f(x.areaCercos, 1)} → ${f(y.areaCercos, 1)} m²`);
    if (o.sinRefuerzo.length || l.sinRefuerzo.length) console.log(`    sin refuerzo: ${o.sinRefuerzo.length} → ${l.sinRefuerzo.length}`);
  }
}
console.log("\n== CO4, el punzonamiento (la cuantía de la losa sobre el pilar cuenta los refuerzos que lo cubren)");
for (const [m, r] of Object.entries(co4)) {
  const a = co4a[m]!;
  console.log(`${m}: ${JSON.stringify(a.resumen)} → ${JSON.stringify(r.resumen)}`);
  let iguales = 0;
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
    if (f(v0) === f(v1) && f(r0) === f(r1) && o.cumple === p.cumple && !arm) {
      iguales++;
      continue;
    }
    console.log(`  ${p.pilar}@${p.planta}: vEd/vRd,c ${f(v0)} → ${f(v1)}; ρl,min/ρl ${f(r0)} → ${f(r1)}; cumple ${o.cumple} → ${p.cumple}${arm}`);
  }
  console.log(`  sin cambio: ${iguales} de ${r.pilares.length}`);
}
