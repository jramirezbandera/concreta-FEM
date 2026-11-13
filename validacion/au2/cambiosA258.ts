/**
 * A2-58 (`docs/fem3d/auditoria-2.md` §11.2): qué cambia en la referencia congelada de C3 con el solape
 * muro–losa según el plano del forjado. Por modelo, frente al fixture: la estructura del modelo analítico
 * (igual o no), las cargas nodales de cada caso que cambian (nudo, antes → ahora) y la resultante del
 * peso propio, antes y ahora.
 * Uso: bun validacion/au2/cambiosA258.ts > validacion/au2/out_cambiosA258.txt (antes de regenerar el fixture)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { referenciaC2 } from "../c2/congelar.ts";
import { MODELOS_CONGELADOS_C3 } from "../c3/congelar.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const antes = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-c3.json"), "utf8")) as Record<string, ReturnType<typeof referenciaC2>>;
type Caso = { id: string; nodales?: { nudo: number; f: number[] }[] };
type Modelo = { nudos: unknown[]; laminas?: unknown[]; barras?: unknown[]; casos: Caso[] };
/** ¿Iguales a 1e-12 relativo (el fixture va redondeado a 13 cifras)? */
function iguales(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => iguales(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).filter((x) => (a as Record<string, unknown>)[x] !== undefined).sort();
    const kb = Object.keys(b).filter((x) => (b as Record<string, unknown>)[x] !== undefined).sort();
    return ka.join() === kb.join() && ka.every((x) => iguales((a as Record<string, unknown>)[x], (b as Record<string, unknown>)[x]));
  }
  return a === b;
}
for (const [k, f] of Object.entries(MODELOS_CONGELADOS_C3)) {
  const a = antes[k]!.modelo as unknown as Modelo;
  const b = JSON.parse(JSON.stringify(referenciaC2(f).modelo)) as Modelo;
  const estructura = (m: Modelo) => [m.nudos, m.laminas, m.barras];
  const lineas: string[] = [];
  b.casos.forEach((c, i) => {
    const c0 = a.casos[i]!;
    const n0 = new Map((c0.nodales ?? []).map((n) => [n.nudo, n.f]));
    const n1 = new Map((c.nodales ?? []).map((n) => [n.nudo, n.f]));
    const fz = (m: Map<number, number[]>) => [...m.values()].reduce((s, v) => s + v[2]!, 0);
    let cambian = 0;
    for (const v of new Set([...n0.keys(), ...n1.keys()])) {
      const x = n0.get(v)?.[2] ?? 0;
      const y = n1.get(v)?.[2] ?? 0;
      if (Math.abs(x - y) > 1e-9 * Math.max(1, Math.abs(x))) cambian++;
    }
    const otros = iguales({ ...c0, nodales: undefined }, { ...c, nodales: undefined });
    if (cambian || !otros) lineas.push(`  caso ${c.id}: ${cambian} cargas nodales cambian en Fz (Σ Fz nodal ${fz(n0).toFixed(6)} → ${fz(n1).toFixed(6)} kN); lo demás del caso ${otros ? "igual" : "CAMBIA"}`);
  });
  console.log(`== ${k}: estructura ${iguales(estructura(a), estructura(b)) ? "idéntica" : "CAMBIA"}${lineas.length ? "" : "; cargas idénticas"}`);
  for (const l of lineas) console.log(l);
}
