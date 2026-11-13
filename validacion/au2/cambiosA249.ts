/**
 * A2-49 (`docs/fem3d/auditoria-2.md` §10.2): qué cambia en la referencia congelada de C5 con los machones
 * cortados en el alféizar y en lo alto del hueco (antes, en las cotas). Por modelo, frente al fixture: los machones
 * (no deberían cambiar) y, en cada dintel, inicio, centro y fin por caso, antes → ahora, con la
 * diferencia relativa al mayor |valor| de esa componente en los dinteles del modelo.
 * Uso: bun validacion/au2/cambiosA249.ts > validacion/au2/out_cambiosA249.txt (antes de regenerar el fixture)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { MODELOS_CONGELADOS_C5, redondeo, referenciaC5, type ReferenciaC5 } from "../c5/congelar.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const antes = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-c5.json"), "utf8")) as Record<string, ReferenciaC5>;
type C = { esfuerzos: (number | null)[]; valido: boolean };
type D = { id: string; inicio: C; centro: C; fin: C };
type M = { id: string; base: C; cabeza: C };
const NOMBRES = ["N", "Vy", "Vz", "T", "My", "Mz"];
for (const [k, f] of Object.entries(MODELOS_CONGELADOS_C5)) {
  const a = antes[k]!;
  const b = JSON.parse(JSON.stringify(referenciaC5(f), redondeo)) as ReferenciaC5;
  for (const w of Object.keys(b.muros)) {
    const ma = a.muros[w]!.machones as M[];
    const mb = b.muros[w]!.machones as M[];
    const igualesM = JSON.stringify(ma) === JSON.stringify(mb);
    console.log(`\n== ${k}, muro ${w}: machones ${igualesM ? "idénticos" : "cambian"}`);
    mb.forEach((x, i) => {
      for (const cual of ["base", "cabeza"] as const) {
        const a0 = ma[i]![cual].esfuerzos;
        const b0 = x[cual].esfuerzos;
        if (JSON.stringify(a0) === JSON.stringify(b0)) continue;
        console.log(`  ${x.id} ${cual}: [N, Vy, Mz] (caso 0) ${[0, 1, 5].map((q) => (a0[q] ?? NaN).toFixed(2)).join(", ")} → ${[0, 1, 5].map((q) => (b0[q] ?? NaN).toFixed(2)).join(", ")}`);
      }
    });
    const da = a.muros[w]!.dinteles as D[];
    const db = b.muros[w]!.dinteles as D[];
    const esc = [0, 1, 2, 3, 4, 5].map((q) => Math.max(1e-9, ...db.flatMap((d) => [d.inicio, d.centro, d.fin].flatMap((c) => c.esfuerzos.filter((_, i) => i % 6 === q).map((v) => Math.abs(v ?? 0))))));
    let peor = [0, 0, 0, 0, 0, 0];
    db.forEach((d, i) => {
      for (const cual of ["inicio", "centro", "fin"] as const) {
        const x = da[i]![cual].esfuerzos;
        const y = d[cual].esfuerzos;
        y.forEach((v, j) => {
          const q = j % 6;
          const dv = Math.abs((v ?? NaN) - (x[j] ?? NaN)) / esc[q]!;
          if (Number.isFinite(dv)) peor[q] = Math.max(peor[q]!, dv);
        });
      }
      const caso0 = (c: C, q: number) => (c.esfuerzos[q] ?? NaN).toFixed(3);
      console.log(`  ${d.id}: Vz (caso 0) inicio ${caso0(da[i]!.inicio, 2)} → ${caso0(d.inicio, 2)}, centro ${caso0(da[i]!.centro, 2)} → ${caso0(d.centro, 2)}, fin ${caso0(da[i]!.fin, 2)} → ${caso0(d.fin, 2)}`);
    });
    console.log(`  mayor cambio por componente (relativo al mayor de los dinteles): ${peor.map((p, q) => `${NOMBRES[q]} ${(100 * p).toFixed(1)} %`).join(", ")}`);
  }
  const resto = (r: ReferenciaC5) => JSON.stringify({ ...r, muros: undefined });
  console.log(`  lo demás de ${k} (malla, casos, bandas, consultas): ${resto(a) === resto(b) ? "idéntico" : "¡cambia!"}`);
}
