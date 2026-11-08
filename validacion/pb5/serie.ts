// Serie de h de una estación (antes / ahora), frente a la referencia: bun validacion/pb5/serie.ts <modelo> <regex>
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [m, filtro] = process.argv.slice(2);
const leer = (n: string) => JSON.parse(readFileSync(join(import.meta.dirname, "../pb", `out_pb5-${n}-${m}.json`), "utf8"));
const ref = leer("despues")["0.0625/0.025"];
const A = { ...leer("antes"), ...leer("serieA") }, D = { ...leer("despues"), ...leer("serieD") };
const hs = ["0.9", "0.75", "0.6", "0.5", "0.45", "0.375", "0.3", "0.25", "0.125"];
const re = new RegExp(filtro!);
for (const campo of ["vigas", "franjas"])
  for (const k of Object.keys(ref[campo]).filter((k) => re.test(k))) {
    const r = ref[campo][k];
    console.log(`${k}  ref ${r.toFixed(2)}`);
    for (const [n, X] of [["antes", A], ["ahora", D]] as const)
      console.log(`   ${n.padEnd(6)}`, hs.map((h) => (X[h] ? `${h}:${(100 * (X[h][campo][k] / r - 1)).toFixed(1)}%` : "").padEnd(12)).join(""));
  }
