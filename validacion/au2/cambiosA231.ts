/**
 * A2-31 (`docs/fem3d/auditoria-2.md` §11.2): qué cambia en las referencias congeladas de C2–C5 y de F con
 * el peso de las vigas bajo losa (C2-g, AU-4) integrado con el área de cada mitad de su ancho, no mirado
 * en un punto a b/4 del eje. Por modelo, frente al fixture: la malla (nudos, láminas y barras: no
 * deberían cambiar), los casos cuya ΣRz cambia, con antes → ahora, y el mayor cambio de desplazamiento
 * relativo al mayor |u| del caso.
 * Uso: bun validacion/au2/cambiosA231.ts > validacion/au2/out_cambiosA231.txt (antes de regenerar)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { MODELOS_CONGELADOS_C2, referenciaC2, type ReferenciaC2 } from "../c2/congelar.ts";
import { MODELOS_CONGELADOS_C3 } from "../c3/congelar.ts";
import { MODELOS_CONGELADOS_C4 } from "../c4/congelar.ts";
import { MODELOS_CONGELADOS_C5 } from "../c5/congelar.ts";
import { MODELOS_CONGELADOS_F } from "../f/congelar.ts";

const raiz = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const fixture = (n: string) => JSON.parse(readFileSync(join(raiz, "src", "compilador", "__fixtures__", `congelado-${n}.json`), "utf8")) as Record<string, ReferenciaC2 | { c2: ReferenciaC2 }>;
type M = { nudos: unknown[]; laminas?: unknown[]; barras?: { nudos: unknown }[] };
const fases = [
  ["c2", MODELOS_CONGELADOS_C2],
  ["c3", MODELOS_CONGELADOS_C3],
  ["c4", MODELOS_CONGELADOS_C4],
  ["c5", MODELOS_CONGELADOS_C5],
  ["f", MODELOS_CONGELADOS_F],
] as const;
const sigFz = (rs: number[]) => rs.reduce((s, v, i) => s + (i % 6 === 2 ? v : 0), 0);
for (const [fase, modelos] of fases) {
  const antes = fixture(fase);
  console.log(`\n### ${fase.toUpperCase()}`);
  for (const [k, f] of Object.entries(modelos)) {
    const x = antes[k]!;
    const a = ("c2" in x ? x.c2 : x) as ReferenciaC2;
    const b = JSON.parse(JSON.stringify(referenciaC2(f), (_k, v: unknown) => (typeof v === "number" && v !== 0 && Number.isFinite(v) ? Number(v.toPrecision(13)) : v))) as ReferenciaC2;
    const ma = a.modelo as unknown as M;
    const mb = b.modelo as unknown as M;
    const malla = JSON.stringify([ma.nudos, ma.laminas, (ma.barras ?? []).map((q) => q.nudos)]) === JSON.stringify([mb.nudos, mb.laminas, (mb.barras ?? []).map((q) => q.nudos)]);
    const lineas: string[] = [];
    b.casos.forEach((c, i) => {
      const c0 = a.casos[i]!;
      const [r0, r1] = [sigFz(c0.reacciones), sigFz(c.reacciones)];
      const umax = Math.max(1e-30, ...c0.u.map(Math.abs));
      const du = Math.max(0, ...c.u.map((v, j) => Math.abs(v - c0.u[j]!))) / umax;
      if (Math.abs(r1 - r0) > 1e-9 * Math.max(1, Math.abs(r0)) || du > 1e-9) lineas.push(`  caso ${i}: ΣRz ${r0.toFixed(4)} → ${r1.toFixed(4)} kN (${(((r1 - r0) / Math.abs(r0 || 1)) * 100).toFixed(3)} %); Δu máx ${(du * 100).toFixed(3)} % del mayor`);
    });
    console.log(`== ${k}: malla ${malla ? "idéntica" : "CAMBIA"}${lineas.length ? "" : "; casos idénticos"}`);
    for (const l of lineas) console.log(l);
  }
}
