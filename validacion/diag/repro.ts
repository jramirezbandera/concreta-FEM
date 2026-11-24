/**
 * Los pedidos de Resultados · Diagramas y Losas del ejemplo del edificio de 7 plantas (con viento,
 * sismo, imperfección y segundo orden: 128 combinaciones por defecto), por el atendedor del worker, en
 * Node (el motor de Chrome). Da el tiempo y el sha256 de cada contestación, o su error con la pila.
 *
 *   node --experimental-strip-types validacion/diag/repro.ts [proyecto.json] [--solo <pedido>]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PerformanceObserver } from "node:perf_hooks";
import { join } from "node:path";
import { sha256 } from "../../src/compilador/huella.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { Atendedor } from "../../src/visor/atender.ts";
import type { Pedido } from "../../src/visor/protocolo.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const WASM = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
await iniciarNucleo(WASM);
const args = process.argv.slice(2);
const solo = args.includes("--solo") ? args[args.indexOf("--solo") + 1] : undefined;
const fichero = args.find((a) => a.endsWith(".json")) ?? join(RAIZ, "ejemplos", "app", "edificio.json");
const texto = readFileSync(fichero, "utf8");
const plantas: string[] = JSON.parse(texto).modelo.plantas.map((p: { id: string }) => p.id);
const D = { tipo: "defecto" } as const;
const a = new Atendedor(sha256(new Uint8Array(WASM)));

const huella = (x: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(x, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v)) ?? "")
    .digest("hex")
    .slice(0, 16);
// Lo que se lleva el recolector de basura dentro de cada pedido
let basura = 0;
new PerformanceObserver((l) => {
  for (const e of l.getEntries()) basura += e.duration;
}).observe({ entryTypes: ["gc"] });
const pedir = async (nombre: string, p: Pedido) => {
  if (solo && !nombre.startsWith(solo) && p.tipo !== "abrir" && p.tipo !== "calcular") return;
  const t0 = performance.now();
  try {
    basura = 0;
    const r = await a.atender(p);
    const ms = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 0));
    console.log(`${nombre} | ${(ms / 1000).toFixed(2)} s (basura ${(basura / 1000).toFixed(2)}) | ${r.ok ? huella(r.valor) : "FALLO " + JSON.stringify(r.diagnosticos).slice(0, 300)}`);
  } catch (e) {
    console.log(`${nombre} | ${((performance.now() - t0) / 1000).toFixed(2)} s | EXCEPCIÓN ${(e as Error).message}\n${((e as Error).stack ?? "").split("\n").slice(0, 14).join("\n")}`);
  }
};

await pedir("abrir", { tipo: "abrir", texto });
await pedir("calcular", { tipo: "calcular" });
const [alta, siguiente] = [plantas[0]!, plantas[1]!];
await pedir("diagramas3d My, todas las plantas", { tipo: "diagramas3d", esfuerzo: "My", combinaciones: D, planta: null, piezas: "todas" } as Pedido);
await pedir(`escena vigas My ${alta}`, { tipo: "escena", planta: alta, vista: { vista: "vigas", esfuerzo: "My", combinaciones: D } } as Pedido);
await pedir(`escena vigas My ${siguiente}`, { tipo: "escena", planta: siguiente, vista: { vista: "vigas", esfuerzo: "My", combinaciones: D } } as Pedido);
await pedir(`escena vigas Vz ${alta}`, { tipo: "escena", planta: alta, vista: { vista: "vigas", esfuerzo: "Vz", combinaciones: D } } as Pedido);
await pedir(`piezas ${alta}`, { tipo: "piezas", planta: alta });
await pedir(`losas m11 ${alta}`, { tipo: "losas", planta: alta, campo: "m11", combinaciones: D } as Pedido);
await pedir(`losas uz ${alta}`, { tipo: "losas", planta: alta, campo: "uz", combinaciones: D } as Pedido);
await pedir(`losas m11 ${siguiente}`, { tipo: "losas", planta: siguiente, campo: "m11", combinaciones: D } as Pedido);
await pedir("isovalores3d m11, todas", { tipo: "isovalores3d", campo: "m11", combinaciones: D, planta: null } as Pedido);
