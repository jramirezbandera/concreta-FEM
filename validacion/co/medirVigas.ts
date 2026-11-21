/**
 * Fase CO2 (docs/fem3d/comprobaciones.md §8.5): lo que tarda y lo que da `fem armar` con las vigas
 * del edificio objetivo de losas (vigas de 30 × 60 por todos los ejes y secundarias de 25 × 40 a media
 * luz), con viento y, con --sismo, el sismo del programa.
 *
 *   bun validacion/co/medirVigas.ts [--plantas N] [--sismo]     escribe validacion/co/out_medirVigas[-sismo].txt
 *
 * El tiempo es sólo información (la fase no cambia el modelo: en ecuaciones, su coste es cero).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { AccionCaso, ModeloFisico } from "../../src/compilador/fisico.ts";
import { demandasViga } from "../../src/comprobaciones/demandas/vigas.ts";
import { comprobarVigas } from "../../src/comprobaciones/vigas.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const RAIZ = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const ACCIONES: Record<string, AccionCaso> = {
  G: { tipo: "G" },
  Q: { tipo: "Q", psi: "uso-A" },
  Vx: { tipo: "W", psi: "viento", direccion: "X", signo: 1, familia: "viento" },
  Vy: { tipo: "W", psi: "viento", direccion: "Y", signo: 1, familia: "viento" },
};
const plantas = Number(arg("--plantas") ?? 7);
const sismo = process.argv.includes("--sismo");
const base = plantas === 7 ? edificioObjetivoLosas(7) : edificioObjetivoLosas(plantas, 3, 2);
const f: ModeloFisico = { ...base, casos: base.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })), ...(sismo ? { acciones: { sismo: { ab: 0.16, K: 1.0, terreno: "III", mu: 2, sistema: "porticos-ha" } } } : {}) };
const c = compilar(f);
if (!c.valido) throw new Error("no compila");
const r = calcular(c.modelo);
if (!r.valido) throw new Error("no calcula");
const q = new Consultas(f, c, r.casos, {}, r.modal);

const lineas: string[] = [];
const di = (s: string) => {
  lineas.push(s);
  console.log(s);
};
di(`CO2: las vigas del edificio objetivo de losas (${plantas} plantas), con viento${sismo ? " y el sismo del programa" : ""}`);

// Las demandas solas (lo que cuesta leer los diagramas) y la propuesta entera
let t0 = performance.now();
let vanos = 0;
let combinaciones = 0;
for (const v of f.vigas ?? []) {
  const d = demandasViga(q, v.id);
  if (!d.valido) throw new Error(v.id);
  vanos += d.valor.vanos.length;
  combinaciones = d.valor.combinaciones;
}
di(`demandas: ${(f.vigas ?? []).length} vigas, ${vanos} vanos, ${combinaciones} combinaciones de ELU, ${((performance.now() - t0) / 1e3).toFixed(1)} s (la primera vez: hace los diagramas)`);
t0 = performance.now();
const p = comprobarVigas(q, undefined, undefined, { proponer: true, filas: true });
if (!p.valido) throw new Error("no comprueba");
const s = p.valor.resumen;
di(`proponer: ${((performance.now() - t0) / 1e3).toFixed(1)} s, ${s.vanos} vanos, ${s.cumplen} cumplen, ${s.noCumplen} no, ${s.sinArmado} sin propuesta`);

const todos = p.valor.vigas.flatMap((g) => g.vanos.map((v) => ({ viga: g.viga, seccion: g.seccion, ...v })));
const cuenta = (claves: string[]) => {
  const m = new Map<string, number>();
  for (const k of claves) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
di("");
di("Lo pendiente o sin propuesta, por motivo:");
for (const [k, n] of cuenta(todos.flatMap((v) => v.pendientes.map((x) => x.motivo.replace(/«.*?»/, "«…»").replace(/\(.*?\)/, "(…)"))))) di(`  ${n}  ${k}`);
di("");
di("La fila que manda en los que cumplen:");
for (const [k, n] of cuenta(todos.filter((v) => v.cumple).map((v) => (v.manda?.id ?? "—").replace(/^(inicio|centro|fin)\//, "zona/")))) di(`  ${n}  ${k}`);
di("");
di("Probados por vano (armados comprobados hasta dar con el propuesto): " + (todos.reduce((n, v) => n + (v.probados ?? 0), 0) / Math.max(1, todos.length)).toFixed(1) + " de media");
di("");
di("Los armados más repetidos, por sección:");
for (const sec of [...new Set(todos.map((v) => v.seccion))]) {
  di(`  ${sec}:`);
  for (const [k, n] of cuenta(todos.filter((v) => v.seccion === sec).map((v) => v.texto ?? "sin propuesta")).slice(0, 8)) di(`    ${n}  ${k}`);
}
di("");
di("Filas informativas de torsión de compatibilidad: " + todos.filter((v) => v.filas?.some((x) => x.id.endsWith("torsion-compatibilidad"))).length + " vanos");
writeFileSync(join(import.meta.dirname, `out_medirVigas${sismo ? "-sismo" : ""}${plantas === 7 ? "" : `-${plantas}`}.txt`), lineas.join("\n") + "\n");
