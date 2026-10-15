/**
 * Criterio 2 de CY (`docs/fem3d/hipotesis-cype.md`): al pasar el hormigón al Ecm del Código
 * Estructural (CY1), en los modelos con un solo E los esfuerzos no cambian y los desplazamientos
 * escalan con E_viejo/E_nuevo. Compara las referencias congeladas del compilador de un commit
 * anterior (por defecto, el de antes de CY1) con las de ahora.
 *
 *   bun validacion/cy/ecm.ts [commit] > validacion/cy/out_ecm.txt
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(import.meta.dirname, "..", "..");
const COMMIT = process.argv[2] ?? "4c5172c";
const FASES = ["c1", "c2", "c3", "c4", "c5", "f"];

interface Modelo {
  barras?: { seccion: { E: number } }[];
  laminas?: { material?: { E?: number } }[];
}
type Caso = Record<string, unknown>;

/** (nombre, modelo, casos): en C1 directos; en las demás, anidados por fase. */
function* modelos(d: Record<string, Record<string, unknown>>): Generator<[string, Modelo, Caso[]]> {
  for (const [k, v] of Object.entries(d)) {
    if ("modelo" in v) yield [k, v.modelo as Modelo, (v.casos ?? []) as Caso[]];
    else for (const [f, w] of Object.entries(v)) if (w && typeof w === "object" && "modelo" in w) yield [`${k}/${f}`, (w as { modelo: Modelo }).modelo, ((w as { casos?: Caso[] }).casos ?? []) as Caso[]];
  }
}
const Es = (m: Modelo) => new Set([...(m.barras ?? []).map((b) => b.seccion.E), ...(m.laminas ?? []).flatMap((l) => (l.material?.E !== undefined ? [l.material.E] : []))]);
const numerico = (x: unknown): x is number[] => Array.isArray(x) && x.length > 0 && typeof x[0] === "number";

let peorF = 0;
let peorU = 0;
let varios = 0;
console.log(`Referencias congeladas de ${COMMIT} frente a las de ahora`);
for (const f of FASES) {
  const ruta = `src/compilador/__fixtures__/congelado-${f}.json`;
  const antes = new Map([...modelos(JSON.parse(execFileSync("git", ["show", `${COMMIT}:${ruta}`], { cwd: RAIZ, maxBuffer: 1 << 30 }).toString()))].map(([k, m, c]) => [k, { m, c }]));
  const ahora = new Map([...modelos(JSON.parse(readFileSync(join(RAIZ, ruta), "utf8")))].map(([k, m, c]) => [k, { m, c }]));
  for (const [k, a] of antes) {
    const n = ahora.get(k);
    if (!n) throw new Error(`${f} ${k}: no está en la referencia nueva`);
    const ea = [...Es(a.m)];
    const en = [...Es(n.m)];
    const unSolo = ea.length === 1 && en.length === 1;
    if (!unSolo) varios++;
    const r = unSolo ? ea[0]! / en[0]! : NaN;
    let pf = 0;
    let pu = 0;
    a.c.forEach((x, i) => {
      for (const [clave, v] of Object.entries(x)) {
        const w = n.c[i]![clave];
        if (!numerico(v) || !numerico(w)) continue;
        const esc = Math.max(...v.map(Math.abs), 1e-300);
        for (let j = 0; j < v.length; j++) {
          if (clave === "u") { if (unSolo) pu = Math.max(pu, Math.abs(w[j]! - v[j]! * r) / esc); }
          else pf = Math.max(pf, Math.abs(w[j]! - v[j]!) / esc);
        }
      }
    });
    peorF = Math.max(peorF, pf);
    peorU = Math.max(peorU, pu);
    const e = (l: number[]) => l.map((x) => (x / 1e3).toFixed(0)).join(", ");
    console.log(`${f.padEnd(3)}${k.padEnd(36)} E [${e(ea)}] → [${e(en)}] MPa  ${unSolo ? "un solo E" : "VARIOS E "}  esfuerzos ${pf.toExponential(1)}  u escalados ${pu.toExponential(1)}`);
  }
}
console.log(`\nPeor: esfuerzos ${peorF.toExponential(1)} (criterio ≤ 1e-9), desplazamientos escalados ${peorU.toExponential(1)}; modelos con varios E: ${varios}`);
console.log(peorF <= 1e-9 && peorU <= 1e-9 ? "Criterio 2: PASA" : "Criterio 2: NO PASA");
