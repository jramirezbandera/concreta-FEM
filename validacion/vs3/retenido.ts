/**
 * VS3: lo que retiene el resultado de `calcular` con el sismo del programa, por ramas: los bytes de los
 * vectores de números alcanzables desde cada campo (cada búfer, una vez).
 *
 * `bun validacion/vs3/retenido.ts 3 5 4`
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const [plantas, nx, ny] = process.argv.slice(2, 5).map(Number);
const base = edificioObjetivoLosas(plantas || 3, nx || 5, ny || 4);
const f: ModeloFisico = {
  ...base,
  casos: base.casos.map((c) => ({ ...c, accion: c.id === "G" ? { tipo: "G" } : c.id === "Q" ? { tipo: "Q", psi: "uso-A" } : { tipo: "W", psi: "viento", direccion: c.id === "Vx" ? "X" : "Y", signo: 1, familia: "viento" } })),
  acciones: { sismo: { ab: 0.16, K: 1.0, terreno: "III", mu: 2 } },
};
const c = compilar(f);
if (!c.valido) throw new Error("no compila");
const r = calcular(c.modelo);
if (!r.valido) throw new Error("no se calcula");

const vistos = new Set<unknown>();
function bytes(x: unknown, porRama: Map<string, number>, rama: string, nivel: number): number {
  if (x === null || typeof x !== "object" || vistos.has(x)) return 0;
  vistos.add(x);
  if (ArrayBuffer.isView(x)) {
    if (vistos.has(x.buffer)) return 0;
    vistos.add(x.buffer);
    return x.buffer.byteLength;
  }
  let s = 0;
  const entradas: [string, unknown][] = Array.isArray(x) ? x.map((v, i) => [nivel < 2 ? "[]" : String(i), v]) : x instanceof Map ? [...x.entries()].map(([k, v]) => [String(k), v]) : Object.entries(x);
  for (const [k, v] of entradas) {
    const b = bytes(v, porRama, nivel < 3 ? `${rama}.${k}` : rama, nivel + 1);
    s += b;
    if (nivel < 3 && b > 0) porRama.set(`${rama}.${k}`, (porRama.get(`${rama}.${k}`) ?? 0) + b);
  }
  return s;
}
const porRama = new Map<string, number>();
const total = bytes(r, porRama, "r", 0);
const MB = (b: number) => (b / 2 ** 20).toFixed(1);
console.log(`${r.estadisticas.nudos} nudos, ${r.casos.length} casos, ${r.modal?.modos.length} modos: ${MB(total)} MiB en vectores`);
for (const [k, v] of [...porRama.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${MB(v).padStart(8)}  ${k}`);
