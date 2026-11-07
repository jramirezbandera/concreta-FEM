/**
 * VS4: lo que retienen las consultas con el sismo del programa, en Node (`docs/fem3d/viento-sismo.md`
 * §13.1): el edificio objetivo de losas con viento y sismo, y lo que queda en memoria tras recoger la
 * basura después de cada paso (abrir las consultas, el mapa de M11 de la planta alta, el de V13, las
 * franjas de la planta alta en X y en Y, el mapa de la planta de debajo, sus franjas, y vuelta a la
 * alta). Lo que mide es lo retenido (Chrome lo suelta más tarde: `chrome.ts` da lo que ve el usuario).
 *
 *   node --expose-gc --experimental-strip-types validacion/vs4/memoria.ts [--plantas N] [--sin]
 *
 * Escribe `out_memoria_node.txt`. El «antes» se mide con un árbol de trabajo en el commit anterior
 * (HR-8). Los sha256 de las respuestas tienen que coincidir.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conjuntoCombinaciones } from "../../src/agente/combinaciones.ts";
import { franjas } from "../../src/agente/consultas.ts";
import { envolventeCampo, ResultadosRender } from "../../src/agente/render/resultados.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { AccionCaso, ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error("hace falta --expose-gc");
const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const plantas = Number(arg("--plantas") ?? 7);
const sismo = !process.argv.includes("--sin");
const ACCIONES: Record<string, AccionCaso> = {
  G: { tipo: "G" },
  Q: { tipo: "Q", psi: "uso-A" },
  Vx: { tipo: "W", psi: "viento", direccion: "X", signo: 1, familia: "viento" },
  Vy: { tipo: "W", psi: "viento", direccion: "Y", signo: 1, familia: "viento" },
};
const base = plantas === 7 ? edificioObjetivoLosas(7) : edificioObjetivoLosas(plantas, 3, 2);
const f: ModeloFisico = { ...base, casos: base.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })), ...(sismo ? { acciones: { sismo: { ab: 0.16, K: 1.0, terreno: "III", mu: 2, sistema: "porticos-ha" } } } : {}) };
const c = compilar(f);
if (!c.valido) throw new Error("no compila");
const r = calcular(c.modelo);
if (!r.valido) throw new Error("no calcula");

const MiB = (b: number) => (b / 2 ** 20).toFixed(0);
let ultimo = 0;
const filas: string[] = [];
let t0 = performance.now();
const medir = async (que: string, sha = "") => {
  const ms = performance.now() - t0;
  // Dos recogidas con una espera entre medias: V8 barre los búferes de los arrays tipados que se
  // sueltan en un hilo aparte, y `external` tarda en bajar
  gc();
  await new Promise((r) => setTimeout(r, 300));
  gc();
  await new Promise((r) => setTimeout(r, 300));
  const m = process.memoryUsage();
  const total = m.heapUsed + m.external;
  filas.push(`${que} | ${(ms / 1000).toFixed(2)} | ${MiB(m.heapUsed)} | ${MiB(m.external)} | ${MiB(total)} | ${ultimo ? (total >= ultimo ? "+" : "−") + MiB(Math.abs(total - ultimo)) : ""} | ${sha}`);
  console.log(filas[filas.length - 1]);
  ultimo = total;
  t0 = performance.now();
};
const sha256 = (x: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(x, (_k, v) => (typeof v === "number" && Number.isNaN(v) ? "NaN" : v instanceof Float64Array || v instanceof Int32Array ? Array.from(v) : v)))
    .digest("hex")
    .slice(0, 16);

await medir("calculado (sin consultas)");
const q = new Consultas(f, c, r.casos, {}, r.modal);
const rr = new ResultadosRender(q, c);
const cj = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: ["ELU-PT", "ELU-SIS"] });
if (!cj.valido) throw new Error("sin combinaciones");
const comb = cj.valor;
const [alta, siguiente] = [f.plantas[0]!.id, f.plantas[1]!.id];
await medir(`Consultas (${q.nb} casos base, ${comb.factores.length} combinaciones)`);
const mapa = (planta: string, campo: "m11" | "v13") => {
  const x = envolventeCampo(rr, planta, campo, comb, "max");
  return sha256([x.v, x.comb]);
};
const fr = (planta: string, direccion: 1 | 2) => {
  const x = franjas(q, comb, { planta, direccion });
  if (!x.valido) throw new Error("sin franjas");
  return sha256(x.valor);
};
await medir(`mapa M11 ${alta}`, mapa(alta, "m11"));
await medir(`mapa V13 ${alta}`, mapa(alta, "v13"));
await medir(`franjas ${alta} X`, fr(alta, 1));
await medir(`franjas ${alta} Y`, fr(alta, 2));
await medir(`mapa M11 ${siguiente}`, mapa(siguiente, "m11"));
await medir(`franjas ${siguiente} X`, fr(siguiente, 1));
await medir(`mapa V13 ${alta} (guardado)`, mapa(alta, "v13"));
await medir(`franjas ${alta} X (guardadas)`, fr(alta, 1));
// Lo que queda al soltar lo de los modos a mano (lo que se retiene de verdad por planta trabajada)
q.efimeros?.soltar();
await medir("tras soltar lo de los modos");

writeFileSync(
  join(import.meta.dirname, `out_memoria_node${sismo ? "" : "_sin"}.txt`),
  [
    `# VS4: lo retenido en Node con ${sismo ? "viento y sismo" : "sólo las cargas"} (${new Date().toISOString().slice(0, 10)}; ${plantas === 7 ? "edificio objetivo de losas, 7 plantas" : `edificio de losas de ${plantas} plantas`}; ${c.modelo.nudos.length} nudos, ${r.casos.length} casos y ${r.modal?.modos.length ?? 0} modos; Node ${process.version})`,
    "",
    "Tras cada paso, dos `gc()` y `process.memoryUsage()`: el montón de V8 (heap) y lo de fuera (external: los arrays tipados y el WASM), en MiB, con la diferencia con el paso anterior. El tiempo del paso, sólo como información (una pasada, máquina quizá cargada). El sha256 es el de la respuesta en JSON: tiene que ser el mismo que el de un árbol de trabajo en el commit anterior.",
    "",
    "Paso | s | heap | external | total | Δ | sha256",
    "---|---|---|---|---|---|---",
    ...filas,
    "",
  ].join("\n"),
);
