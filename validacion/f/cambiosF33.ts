/**
 * F3.3 (`docs/fem3d/spr-abacos.md` §14): qué cambia en la referencia congelada de F. Por modelo, los
 * nudos y, por franja, las estaciones de cara, el máximo de Wood–Armer (suma de los casos) y los avisos
 * frente a la referencia de F3.2.
 * Uso: bun validacion/f/cambiosF33.ts > validacion/f/out_cambiosF33.txt (antes de regenerar el fixture)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { MODELOS_CONGELADOS_F, referenciaF, type ReferenciaF } from "./congelar.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const antes = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-f.json"), "utf8")) as Record<string, ReferenciaF>;
const max = (wa: (number | null)[][], j: number) => Math.max(0, ...wa.map((x) => x[j] ?? 0));
const caras = (r: ReferenciaF["franjas"][string]) => r.estaciones.filter((x) => x.tipo === "cara").map((x) => x.s.toFixed(3)).join(" ");
for (const [k, f] of Object.entries(MODELOS_CONGELADOS_F)) {
  const a = antes[k]!;
  const b = referenciaF(f);
  const iguales = JSON.stringify(a.c2.modelo) === JSON.stringify(JSON.parse(JSON.stringify(b.c2.modelo)));
  console.log(`\n== ${k}: nudos ${(a.c2.modelo as { nudos: unknown[] }).nudos.length} → ${(b.c2.modelo as { nudos: unknown[] }).nudos.length}${iguales ? " (malla idéntica)" : ""}`);
  let cambian = 0;
  for (const id of Object.keys(b.franjas)) {
    const x = a.franjas[id];
    const y = b.franjas[id]!;
    if (!x) {
      console.log(`  ${id}: nueva`);
      continue;
    }
    const [ia, sa, ib, sb] = [max(x.wa, 0), max(x.wa, 1), max(y.wa, 0), max(y.wa, 1)];
    const cc = caras(x) !== caras(y);
    const dd = x.diagnosticos.join() !== y.diagnosticos.join();
    const dv = Math.abs(ia - ib) > 1e-6 * Math.max(1, ia) || Math.abs(sa - sb) > 1e-6 * Math.max(1, sa);
    if (!cc && !dd && !dv) continue;
    cambian++;
    console.log(`  ${id.padEnd(16)} inferior ${ia.toFixed(1)} → ${ib.toFixed(1)}, superior ${sa.toFixed(1)} → ${sb.toFixed(1)}`);
    if (cc) console.log(`      caras: [${caras(x)}] → [${caras(y)}]`);
    if (dd) console.log(`      avisos: [${x.diagnosticos.join(", ")}] → [${y.diagnosticos.join(", ")}]`);
  }
  console.log(`  franjas que cambian: ${cambian} de ${Object.keys(b.franjas).length}`);
}
