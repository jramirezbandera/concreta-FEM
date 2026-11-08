// Errores frente a la referencia, estación a estación, de un grupo (comparar.ts los agrupa)
//   bun validacion/pb5/lista.ts <modelo> <regex de clave> <h> [<h> ...]   (modelo: pf, p45…)
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [m, filtro, ...hs] = process.argv.slice(2);
const leer = (n: string) => JSON.parse(readFileSync(join(import.meta.dirname, "../pb", `out_pb5-${n}-${m}.json`), "utf8"));
const ref = leer("despues")["0.0625/0.025"];
const A = leer("antes"), D = leer("despues");
const re = new RegExp(filtro!);
for (const campo of ["vigas", "franjas"]) {
  const ks = Object.keys(ref[campo]).filter((k) => re.test(k));
  const mayor = Math.max(...ks.map((k) => Math.abs(ref[campo][k])));
  for (const k of ks) {
    const r = ref[campo][k];
    if (Math.abs(r) < 0.2 * mayor) continue;
    console.log(k.padEnd(50), `ref ${r.toFixed(1).padStart(7)}`, hs.map((h) => `${h} antes ${(100 * (A[h][campo][k] / r - 1)).toFixed(1).padStart(6)} ahora ${(100 * (D[h][campo][k] / r - 1)).toFixed(1).padStart(6)}`).join(" | "));
  }
}
