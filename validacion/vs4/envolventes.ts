/**
 * VS4: las consultas con la situación sísmica en el edificio objetivo, con el sha256 de lo que dan
 * (`docs/fem3d/viento-sismo.md` §13):
 *
 *   bun validacion/vs4/envolventes.ts [--plantas N] [--consultas a,b,c]   escribe out_envolventes.txt
 *
 * Las 64 combinaciones de la situación sísmica comparten 2 partes estáticas y 4 casos del sismo; lo
 * que cada consulta hace una vez por combinación (combinar los modos en cada punto) se hace ahora una
 * vez por caso y se guarda (`DiagramaCompuesto.recorrer`, `CampoPlanta`, `combinarLogico`). Los
 * números tienen que ser los mismos: el «antes» se mide con un árbol de trabajo en el commit anterior
 * (HR-8) y se comparan los sha256 de cada consulta. El tiempo, sólo como información (una pasada por
 * consulta con unas Consultas nuevas, en caliente tras compilar y calcular).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conjuntoCombinaciones } from "../../src/agente/combinaciones.ts";
import { deriva, envolventes, flechas, franjas, pieza, reacciones } from "../../src/agente/consultas.ts";
import { envolventeCampo, ResultadosRender } from "../../src/agente/render/resultados.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { AccionCaso, ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const ACCIONES: Record<string, AccionCaso> = {
  G: { tipo: "G" },
  Q: { tipo: "Q", psi: "uso-A" },
  Vx: { tipo: "W", psi: "viento", direccion: "X", signo: 1, familia: "viento" },
  Vy: { tipo: "W", psi: "viento", direccion: "Y", signo: 1, familia: "viento" },
};
const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const plantas = Number(arg("--plantas") ?? 7);
const base = plantas === 7 ? edificioObjetivoLosas(7) : edificioObjetivoLosas(plantas, 3, 2);
const f: ModeloFisico = { ...base, casos: base.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })), acciones: { sismo: { ab: 0.16, K: 1.0, terreno: "III", mu: 2, sistema: "porticos-ha" } } };
const c = compilar(f);
if (!c.valido) throw new Error("no compila");
const r = calcular(c.modelo);
if (!r.valido) throw new Error("no calcula");
const cj = (q: Consultas, s: ("ELU-PT" | "ELU-SIS" | "ELS-C")[]) => {
  const x = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: s });
  if (!x.valido) throw new Error("sin combinaciones");
  return x.valor;
};
const planta = f.plantas[0]!.id;
const CONSULTAS: Record<string, (q: Consultas) => unknown> = {
  envolventes: (q) => envolventes(q, cj(q, ["ELU-PT", "ELU-SIS"])),
  "franjas N7": (q) => franjas(q, cj(q, ["ELU-PT", "ELU-SIS"]), { planta }),
  "mapa M11 (máx.)": (q) => {
    const x = envolventeCampo(new ResultadosRender(q, c), planta, "m11", cj(q, ["ELU-PT", "ELU-SIS"]), "max");
    return [Array.from(x.v), Array.from(x.comb)];
  },
  "mapa uz (mín.)": (q) => {
    const x = envolventeCampo(new ResultadosRender(q, c), planta, "uz", cj(q, ["ELS-C", "ELU-SIS"]), "min");
    return [Array.from(x.v), Array.from(x.comb)];
  },
  flechas: (q) => flechas(q, cj(q, ["ELS-C", "ELU-SIS"])),
  deriva: (q) => deriva(q, cj(q, ["ELU-PT", "ELU-SIS"])),
  reacciones: (q) => reacciones(q, cj(q, ["ELU-PT", "ELU-SIS"]), { todos: true }),
  "pieza (viga)": (q) => pieza(q, cj(q, ["ELU-PT", "ELU-SIS"]), f.vigas![0]!.id),
  "pieza (pilar)": (q) => pieza(q, cj(q, ["ELU-PT", "ELU-SIS"]), f.pilares![0]!.id),
};
const cuales = arg("--consultas")?.split(",") ?? Object.keys(CONSULTAS);
const filas: string[] = [];
for (const que of cuales) {
  const q = new Consultas(f, c, r.casos, {}, r.modal);
  const t = performance.now();
  const x = CONSULTAS[que]!(q);
  const ms = performance.now() - t;
  const texto = JSON.stringify(x, (_k, v) => (typeof v === "number" && Number.isNaN(v) ? "NaN" : v));
  filas.push(`${que} | ${(ms / 1000).toFixed(2)} | ${createHash("sha256").update(texto).digest("hex").slice(0, 16)}`);
  console.log(filas[filas.length - 1]);
}
writeFileSync(
  join(import.meta.dirname, "out_envolventes.txt"),
  [
    `# VS4: las consultas con la situación sísmica (${new Date().toISOString().slice(0, 10)}; ${plantas === 7 ? "edificio objetivo de losas, 7 plantas" : `edificio de losas de ${plantas} plantas`}; ${c.modelo.nudos.length} nudos, ${r.casos.length} casos y ${r.modal?.modos.length ?? 0} modos; ${typeof Bun === "undefined" ? "Node" : "Bun"})`,
    "",
    "Una pasada por consulta, en caliente, con unas Consultas nuevas. El sha256 es el de la respuesta en JSON: tiene que ser el mismo que el de un árbol de trabajo en el commit anterior.",
    "",
    "Consulta | s | sha256",
    "---|---|---",
    ...filas,
    "",
  ].join("\n"),
);
declare const Bun: unknown;
