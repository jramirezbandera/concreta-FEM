/**
 * A2-52 (`docs/fem3d/auditoria-2.md` §11): qué cambia en la referencia congelada de C4 con la esquina de
 * la huella sembrada en el cruce de las dos caras de ancho que tiene a ≤ 1 cm (`enEsquinaDeCaras`) y con
 * el umbral de ε_geom en `aLasCaras`. Por modelo, frente al fixture y con la tolerancia de su prueba
 * (1e-12 en el modelo analítico): si cambia algo además de las cargas de los casos, el número de cargas de
 * barra y nodales de cada caso que cambia, su resultante, las barras con cargas distintas y los resultados
 * (desplazamientos, reacciones y esfuerzos, con el error de `errorResultados`).
 * Uso: bun validacion/au2/cambiosA252.ts > validacion/au2/out_cambiosA252.txt (antes de regenerar el fixture)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resultanteAnalitica } from "../../src/compilador/cargas.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { errorResultados } from "../../src/pruebas/metamorficas.ts";
import { referenciaC2, type ReferenciaC2 } from "../c2/congelar.ts";
import { MODELOS_CONGELADOS_C4 } from "../c4/congelar.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const antes = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-c4.json"), "utf8")) as Record<string, ReferenciaC2>;
/** ¿Iguales con la tolerancia de la prueba? (estructura y textos exactos, números a 1e-12 relativo) */
function iguales(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => iguales(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined).sort();
    const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined).sort();
    return ka.join() === kb.join() && ka.every((k) => iguales((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}
const F = (v: number[]) => Float64Array.from(v);
let cambian = 0;
for (const [k, f] of Object.entries(MODELOS_CONGELADOS_C4)) {
  const ref = antes[k]!;
  const r = referenciaC2(f, "nucleo");
  const a = ref.modelo as ModeloAnalitico;
  const b = JSON.parse(JSON.stringify(r.modelo)) as ModeloAnalitico;
  if (iguales(b, a) && iguales(JSON.parse(JSON.stringify(r.mapeo)), ref.mapeo)) {
    console.log(`${k}: igual`);
    continue;
  }
  cambian++;
  const sinCasos = (x: ModeloAnalitico) => ({ ...x, casos: [] });
  console.log(`${k}: cambia; ${iguales(sinCasos(a), sinCasos(b)) ? "la malla, las barras y las restricciones, idénticas" : "¡cambia algo más que las cargas!"}; el mapeo, ${iguales(JSON.parse(JSON.stringify(r.mapeo)), ref.mapeo) ? "igual" : "distinto"}`);
  b.casos.forEach((c, i) => {
    const ca = a.casos[i]!;
    if (iguales(ca, c)) return;
    const R0 = resultanteAnalitica(a, i, [0, 0, 0]);
    const R1 = resultanteAnalitica(b, i, [0, 0, 0]);
    const esc = Math.max(1, ...R0.F.map(Math.abs), ...R0.M.map(Math.abs));
    const d = Math.max(...R0.F.map((v, j) => Math.abs(v - R1.F[j]!)), ...R0.M.map((v, j) => Math.abs(v - R1.M[j]!))) / esc;
    console.log(`  caso ${c.id}: cargas de barra ${ca.barras?.length ?? 0} → ${c.barras?.length ?? 0}, nodales ${ca.nodales?.length ?? 0} → ${c.nodales?.length ?? 0}; resultante, diferencia relativa ${d.toExponential(1)}`);
    const barra = (x: unknown) => (x as { barra: number | string }).barra;
    const porBarra = (l: readonly unknown[] | undefined) => {
      const m = new Map<number | string, unknown[]>();
      for (const x of l ?? []) m.set(barra(x), [...(m.get(barra(x)) ?? []), x]);
      return m;
    };
    const [ma, mb] = [porBarra(ca.barras), porBarra(c.barras)];
    const distintas = [...new Set([...ma.keys(), ...mb.keys()])].filter((x) => !iguales(ma.get(x) ?? [], mb.get(x) ?? []));
    for (const x of distintas) console.log(`    barra ${x}: ${JSON.stringify(ma.get(x) ?? [])}\n           → ${JSON.stringify(mb.get(x) ?? [])}`);
  });
  r.casos.forEach((c, i) => {
    const x = { u: F(c.u), reacciones: F(c.reacciones), esfuerzosBarras: F(c.esfuerzosBarras), esfuerzosLaminas: F(c.esfuerzosLaminas) };
    const y = { u: F(ref.casos[i]!.u), reacciones: F(ref.casos[i]!.reacciones), esfuerzosBarras: F(ref.casos[i]!.esfuerzosBarras), esfuerzosLaminas: F(ref.casos[i]!.esfuerzosLaminas) };
    console.log(`  caso ${a.casos[i]!.id}: resultados, error ${errorResultados(x, y).toExponential(1)}`);
  });
}
console.log(`\nCambian ${cambian} de ${Object.keys(MODELOS_CONGELADOS_C4).length} modelos.`);
