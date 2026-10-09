/**
 * Criterio 2 de A1: en el edificio objetivo de 7 plantas (10 × 8 pilares, losa maciza con vigas,
 * las bandas propuestas y los casos con su acción), el resumen y cada consulta con sus opciones por
 * defecto caben en 4 000 tokens. Sin un tokenizador oficial en local, los tokens se estiman como
 * bytes / 2,5, que cuenta de más en JSON con números (`docs/fem3d/agente.md` §7).
 *
 * Ejecuta la CLI de verdad (`bun cli/fem.ts`), como un agente, y mide también el tiempo de cada
 * orden. La pieza y el pilar son los del centro de la planta N3; la banda, la más larga de N3. Desde
 * A3, también `fem revisar`.
 *
 * Uso: bun validacion/a1/tamano.ts → validacion/a1/out_tamano.txt
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION_ESQUEMA } from "../../src/agente/proyecto.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { conAcciones, conPropuesta } from "../c5/modelos.ts";

export const TOPE_TOKENS = 4000;
export const BYTES_POR_TOKEN = 2.5;

const FEM = join(import.meta.dirname, "..", "..", "cli", "fem.ts");
const dir = mkdtempSync(join(tmpdir(), "fem-a1-"));
const ruta = join(dir, "proyecto.json");
const modelo = conAcciones(conPropuesta(edificioObjetivoLosas(7)));
writeFileSync(ruta, JSON.stringify({ esquema: VERSION_ESQUEMA, nombre: "edificio objetivo", modelo }));

const longitud = (b: { desde: readonly number[]; hasta: readonly number[] }) => Math.hypot(b.hasta[0]! - b.desde[0]!, b.hasta[1]! - b.desde[1]!);
const bandaN3 = [...modelo.bandas!].filter((b) => b.planta === "N3").sort((a, b) => longitud(b) - longitud(a))[0]!.id;

const ordenes: string[][] = [
  ["calcular", ruta],
  ["resumen", ruta],
  ["consultar", ruta, "envolventes"],
  ["consultar", ruta, "flechas"],
  ["consultar", ruta, "deriva"],
  ["consultar", ruta, "reacciones"],
  ["consultar", ruta, "combinaciones"],
  ["consultar", ruta, "pieza", "X15-N3"],
  ["consultar", ruta, "pieza", "P24-15"],
  ["consultar", ruta, "banda", bandaN3],
  // A3: la revisión, con sus avisos acotados como los demás diagnósticos
  ["revisar", ruta],
];

const lineas = [
  `# validacion/a1/tamano.ts — ${new Date().toISOString().slice(0, 10)}: edificio objetivo de 7 plantas (10 × 8 pilares, losa maciza con vigas, ${modelo.bandas!.length} bandas, casos con acción), CLI con Bun`,
  "",
  `Tope: ${TOPE_TOKENS} tokens, estimados como bytes / ${String(BYTES_POR_TOKEN).replace(".", ",")}.`,
  "",
  "orden | código | bytes | tokens (est.) | segundos | cabe",
  "---|---|---|---|---|---",
];
let todas = true;
for (const args of ordenes) {
  const t0 = performance.now();
  const r = spawnSync("bun", [FEM, ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  const s = (performance.now() - t0) / 1000;
  const bytes = Buffer.byteLength(r.stdout.trim(), "utf8");
  const tokens = Math.ceil(bytes / BYTES_POR_TOKEN);
  const ok = JSON.parse(r.stdout).ok === true;
  const cabe = args[0] === "calcular" || tokens <= TOPE_TOKENS;
  if (!ok || !cabe) todas = false;
  const nombre = args.filter((a) => a !== ruta).join(" ");
  lineas.push(`${nombre} | ${r.status}${ok ? "" : " (ok: false)"} | ${bytes} | ${tokens} | ${s.toFixed(1)} | ${args[0] === "calcular" ? "—" : cabe ? "sí" : "NO"}`);
  console.log(lineas[lineas.length - 1]);
}
lineas.push("", todas ? "Todas caben en el tope y dan ok: true." : "ALGUNA NO CABE O NO DA ok: true.");
lineas.push("", "«calcular» no cuenta para el tope (su salida no depende del tamaño del modelo); su tiempo es el de compilar y calcular la primera vez. Cada consulta vuelve a compilar (~4 s) y reutiliza los resultados guardados.");
writeFileSync(join(import.meta.dirname, "out_tamano.txt"), `${lineas.join("\n")}\n`);
rmSync(dir, { recursive: true, force: true });
if (!todas) process.exitCode = 1;
