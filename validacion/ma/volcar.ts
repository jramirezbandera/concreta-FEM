/**
 * Vuelca, de un proyecto, lo que comparan los criterios de MA: el número de nudos y láminas de la
 * malla, los desplazamientos y reacciones de cada caso por coordenadas del nudo, y la suma de las
 * reacciones verticales por caso. Se ejecuta en el árbol de ahora y en un worktree en el commit de
 * antes (HR-8: el «antes» se mide con el código de antes), y `comparar.ts` compara los dos volcados.
 *
 *   bun validacion/ma/volcar.ts <proyecto.json> <salida.json> [--quitar <prefijo-de-id>]… [--casos PP+G]
 *
 * `--casos A+B` suma esos casos en uno («PP+G»: peso propio más permanentes, el criterio 3).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";

const args = process.argv.slice(2);
const [entrada, salida] = args;
if (!entrada || !salida) throw new Error("uso: volcar.ts <proyecto.json> <salida.json> [--quitar prefijo]… [--casos A+B]");
const quitar: string[] = [];
let suma: string[] | undefined;
for (let i = 2; i < args.length; i++) {
  if (args[i] === "--quitar") quitar.push(args[++i]!);
  else if (args[i] === "--casos") suma = args[++i]!.split("+");
}

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const p = JSON.parse(readFileSync(entrada, "utf8"));
const f = p.modelo ?? p;
f.cargas = (f.cargas ?? []).filter((c: { id: string }) => !quitar.some((q) => c.id.startsWith(q)));
const r = compilar(f);
if (!r.valido) throw new Error(`no compila: ${JSON.stringify(r.diagnosticos.filter((d) => d.severidad === "error"))}`);
const m = r.modelo;
const c = calcular(m);
if (!c.valido) throw new Error(`no calcula: ${JSON.stringify(c.diagnosticos.filter((d) => d.severidad === "error"))}`);
const casos = new Map(c.casos.map((x) => [x.id, x]));
const ids = suma ? [suma.join("+")] : [...casos.keys()];
const vec = (id: string, k: "u" | "reacciones"): Float64Array => {
  if (!suma) return casos.get(id)![k];
  const out = new Float64Array(m.nudos.length * 6);
  for (const s of suma) {
    const x = casos.get(s);
    if (!x) throw new Error(`no hay caso ${s} (hay ${[...casos.keys()].join(", ")})`);
    for (let i = 0; i < out.length; i++) out[i]! += x[k][i]!;
  }
  return out;
};
const clave = (n: { x: number; y: number; z: number }) => `${n.x.toFixed(6)};${n.y.toFixed(6)};${n.z.toFixed(6)}`;
const res: Record<string, { u: Record<string, number[]>; rz: number }> = {};
for (const id of ids) {
  const u = vec(id, "u");
  const R = vec(id, "reacciones");
  const porNudo: Record<string, number[]> = {};
  m.nudos.forEach((n, i) => (porNudo[clave(n)] = [...u.subarray(6 * i, 6 * i + 6)]));
  let rz = 0;
  for (let i = 0; i < m.nudos.length; i++) rz += R[6 * i + 2]!;
  res[id] = { u: porNudo, rz };
}
writeFileSync(salida, JSON.stringify({ nudos: m.nudos.length, laminas: m.laminas?.length ?? 0, barras: m.barras?.length ?? 0, casos: res }));
console.log(`${entrada}: ${m.nudos.length} nudos, ${m.laminas?.length ?? 0} láminas; casos ${ids.join(", ")}`);
