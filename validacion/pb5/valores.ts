// Valores de unas estaciones de franja o de viga en las salidas de medir.ts (validacion/pb/out_<nombre>.json)
//   bun validacion/pb5/valores.ts <modelo> <filtro regex> ; modelo p45, p45i, p50, p3050
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [m, filtro] = process.argv.slice(2);
const leer = (n: string) => JSON.parse(readFileSync(join(import.meta.dirname, "../pb", `out_pb5-${n}-${m}.json`), "utf8"));
const A = leer("antes"), D = leer("despues");
const cols: [string, any][] = [["ref", D["0.0625/0.025"]], ["a.125", A["0.125"]], ["a.75", A["0.75"]], ["d.75", D["0.75"]], ["a.5", A["0.5"]], ["d.5", D["0.5"]]];
const re = new RegExp(filtro!);
for (const campo of ["vigas", "franjas"]) {
  const ks = Object.keys(cols[0]![1][campo]).filter((k) => re.test(k));
  for (const k of ks) console.log(k.padEnd(52), cols.map(([n, c]) => `${n} ${(c?.[campo]?.[k] ?? NaN).toFixed(2)}`.padEnd(12)).join(" "));
}
