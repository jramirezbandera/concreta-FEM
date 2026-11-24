/**
 * Unas pocas piezas del edificio de 7 plantas con el sismo, para perfilar sus demandas o su propuesta:
 *
 *   node --cpu-prof --cpu-prof-dir=<carpeta> --experimental-strip-types validacion/co6/perfil.ts losas|armar-losas|vigas|armar-vigas|pilares [n]
 *   node --experimental-strip-types validacion/co6/perfil.ts --resumen <fichero.cpuprofile>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--resumen") {
  // El tiempo propio de cada función y el acumulado (con lo que llama)
  type Nodo = { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] };
  const p = JSON.parse(readFileSync(args[1]!, "utf8")) as { nodes: Nodo[]; samples: number[]; timeDeltas: number[] };
  const nodo = new Map(p.nodes.map((n) => [n.id, n]));
  const padre = new Map<number, number>();
  for (const n of p.nodes) for (const c of n.children ?? []) padre.set(c, n.id);
  const propio = new Map<string, number>();
  const total = new Map<string, number>();
  const nombre = (n: Nodo) => `${n.callFrame.functionName || "(anónima)"} ${n.callFrame.url.split("/").slice(-2).join("/")}:${n.callFrame.lineNumber + 1}`;
  let T = 0;
  p.samples.forEach((id, i) => {
    const dt = (p.timeDeltas[i] ?? 0) / 1000;
    T += dt;
    const n = nodo.get(id)!;
    propio.set(nombre(n), (propio.get(nombre(n)) ?? 0) + dt);
    const vistos = new Set<string>();
    for (let x: number | undefined = id; x !== undefined; x = padre.get(x)) {
      const k = nombre(nodo.get(x)!);
      if (vistos.has(k)) continue;
      vistos.add(k);
      total.set(k, (total.get(k) ?? 0) + dt);
    }
  });
  const lista = (m: Map<string, number>, n: number) =>
    [...m]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => `${(v / 1000).toFixed(2).padStart(8)} s ${((100 * v) / T).toFixed(1).padStart(5)} %  ${k}`)
      .join("\n");
  console.log(`total ${(T / 1000).toFixed(1)} s\n-- propio\n${lista(propio, Number(args[2] ?? 30))}\n-- acumulado\n${lista(total, Number(args[3] ?? 60))}`);
  process.exit(0);
}

const { sha256 } = await import("../../src/compilador/huella.ts");
const { iniciarNucleo } = await import("../../src/nucleo/index.ts");
const { Sesion } = await import("../../src/visor/sesion.ts");
const { demandasLosa } = await import("../../src/comprobaciones/demandas/losas.ts");
const { demandasViga } = await import("../../src/comprobaciones/demandas/vigas.ts");
const { comprobarPilares } = await import("../../src/comprobaciones/pilares.ts");
const { comprobarVigas } = await import("../../src/comprobaciones/vigas.ts");
const { comprobarLosas } = await import("../../src/comprobaciones/losas.ts");

const RAIZ = join(import.meta.dirname, "..", "..");
const WASM = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
await iniciarNucleo(WASM);
const texto = readFileSync(join(RAIZ, "ejemplos", "app", "edificio.json"), "utf8");
const a = Sesion.abrir(texto, sha256(new Uint8Array(WASM)), {});
if (!a.valido) throw new Error("no abre");
const s = a.sesion;
const c = await s.calcular();
if (!c.ok) throw new Error("no calcula");
const q = s.q!;
const que = args[0] ?? "losas";
const n = Number(args[1] ?? 1);
const t0 = performance.now();
const MiB = () => {
  (globalThis as { gc?: () => void }).gc?.();
  return Math.round(process.memoryUsage().heapUsed / 2 ** 20);
};
if (que === "losas")
  for (const l of (q.fisico.losas ?? []).slice(0, n)) {
    const t = performance.now();
    const r = demandasLosa(q, l.id);
    console.log(`${l.id} (${l.planta}) ${r.valido ? r.valor.direcciones[0].estaciones.length + r.valor.direcciones[1].estaciones.length : "FALLO"} estaciones | ${((performance.now() - t) / 1000).toFixed(1)} s | ${MiB()} MiB`);
  }
else if (que === "vigas") for (const v of (q.fisico.vigas ?? []).slice(0, n)) demandasViga(q, v.id);
else if (que === "armar-losas") comprobarLosas(q, undefined, s.datosArmado, { ids: (q.fisico.losas ?? []).slice(0, n).map((l) => l.id), proponer: true });
else if (que === "armar-vigas") comprobarVigas(q, undefined, s.datosArmado, { ids: (q.fisico.vigas ?? []).slice(0, n).map((v) => v.id), proponer: true });
else comprobarPilares(q, undefined, s.datosArmado, { ids: (q.fisico.pilares ?? []).slice(0, n).map((p) => p.id), proponer: true });
console.log(`${que} x ${n}: ${((performance.now() - t0) / 1000).toFixed(2)} s`);
