/**
 * Lo que hace el espacio Comprobación al entrar en él con una obra sin armado, pedido a pedido, por el
 * atendedor del worker, en Node (el motor de Chrome): la tabla sin armado, la propuesta de lo que falta
 * (tipo a tipo, como la app) y las cuatro tablas con lo propuesto. Da el tiempo, la memoria tras cada
 * pedido y el sha256 de cada contestación (para comparar antes y después de un cambio).
 *
 *   node --expose-gc --experimental-strip-types validacion/co6/tiempos.ts [proyecto.json] [--junto] [--tipos losas,punzonamiento]
 *
 * `--junto`: la propuesta de los cuatro tipos en un solo pedido, como antes del 2026-11-24.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArmadoProyecto } from "../../src/agente/armaduraBase.ts";
import { sha256 } from "../../src/compilador/huella.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { Atendedor } from "../../src/visor/atender.ts";
import { TIPOS_COMPROBACION, type DatosArmar } from "../../src/visor/comprobaciones.ts";
import type { Pedido } from "../../src/visor/protocolo.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const WASM = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
await iniciarNucleo(WASM);
const args = process.argv.slice(2);
const fichero = args.find((a) => a.endsWith(".json")) ?? join(RAIZ, "ejemplos", "app", "edificio.json");
const texto = readFileSync(fichero, "utf8");
/** `--tipos losas,punzonamiento`: sólo esos (por defecto, los cuatro). */
const tipos = args.includes("--tipos") ? args[args.indexOf("--tipos") + 1]!.split(",") : [...TIPOS_COMPROBACION];
const a = new Atendedor(sha256(new Uint8Array(WASM)));

const huella = (x: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(x, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v)) ?? "")
    .digest("hex")
    .slice(0, 16);
const MiB = () => {
  (globalThis as { gc?: () => void }).gc?.();
  return Math.round(process.memoryUsage().heapUsed / 2 ** 20);
};
let total = 0;
const pedir = async (nombre: string, p: Pedido): Promise<unknown> => {
  const t0 = performance.now();
  const r = await a.atender(p, (fase) => void fase);
  const ms = performance.now() - t0;
  if (p.tipo !== "abrir" && p.tipo !== "calcular") total += ms;
  // (`comprobadas` dice cuántas partes se han comprobado en ese pedido, no qué sale: no entra en la huella)
  const v = r.ok && r.valor && typeof r.valor === "object" && "comprobadas" in r.valor ? { ...r.valor, comprobadas: (r.valor as unknown as { partes: unknown[] }).partes.length } : r.ok ? r.valor : null;
  const nota = r.ok && r.valor && typeof r.valor === "object" && "comprobadas" in r.valor ? ` (${(r.valor as { comprobadas: number }).comprobadas} comprobadas)` : "";
  console.log(`${nombre.padEnd(46)} | ${(ms / 1000).toFixed(2).padStart(7)} s | ${String(MiB()).padStart(5)} MiB | ${r.ok ? huella(v) + nota : "FALLO " + JSON.stringify(r.diagnosticos).slice(0, 300)}`);
  return r.ok ? r.valor : null;
};

await pedir("abrir", { tipo: "abrir", texto });
await pedir("calcular", { tipo: "calcular" });
let armado: ArmadoProyecto | undefined = JSON.parse(texto).armado;
await pedir("tabla de pilares, sin armado", { tipo: "comprobaciones", de: "pilares", ...(armado ? { armado } : {}) } as Pedido);
if (args.includes("--junto")) {
  const r = (await pedir("armar, los cuatro tipos", { tipo: "armar", tipos: TIPOS_COMPROBACION, ...(armado ? { armado } : {}), soloSinArmado: true } as Pedido)) as DatosArmar | null;
  if (r) armado = r.armado;
} else
  for (const t of TIPOS_COMPROBACION.filter((x) => tipos.includes(x))) {
    const r = (await pedir(`armar ${t}`, { tipo: "armar", tipos: [t], ...(armado ? { armado } : {}), soloSinArmado: true } as Pedido)) as DatosArmar | null;
    if (r) armado = r.armado;
  }
console.log(`armado propuesto: ${huella(armado)}`);
for (const t of TIPOS_COMPROBACION.filter((x) => tipos.includes(x))) await pedir(`tabla de ${t}, con lo propuesto`, { tipo: "comprobaciones", de: t, armado } as Pedido);
console.log(`total sin abrir ni calcular: ${(total / 1000).toFixed(1)} s`);
