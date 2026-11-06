/**
 * VS3 (`docs/fem3d/viento-sismo.md` §6): la memoria de JavaScript de las consultas con el sismo del
 * programa en el edificio objetivo de losas de 7 plantas, paso a paso y tras recoger la basura. Con
 * los modos como casos base, lo que se guarda «por caso» crece con ellos: aquí se ve cuánto.
 *
 * `bun validacion/vs3/memoria.ts 7 9 7 sin` y `… con` (una variante por proceso) → validacion/vs3/out_memoria_sin.txt
 * y out_memoria_con.txt. `out_memoria.txt`, el versionado, es la unión de los dos. Lo que retiene el
 * resultado del cálculo, por ramas, lo da `retenido.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conjuntoCombinaciones } from "../../src/agente/combinaciones.ts";
import { envolventes, franjas } from "../../src/agente/consultas.ts";
import { envolventeCampo, ResultadosRender } from "../../src/agente/render/resultados.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { AccionCaso, ModeloFisico, SismoEdificio } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";

declare const Bun: { gc(completa: boolean): void };

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const ACCIONES: Record<string, AccionCaso> = {
  G: { tipo: "G" },
  Q: { tipo: "Q", psi: "uso-A" },
  Vx: { tipo: "W", psi: "viento", direccion: "X", signo: 1, familia: "viento" },
  Vy: { tipo: "W", psi: "viento", direccion: "Y", signo: 1, familia: "viento" },
};
const SISMO: SismoEdificio = { ab: 0.16, K: 1.0, terreno: "III", mu: 2 };
const [plantas, nx, ny] = process.argv.slice(2, 5).map(Number);
// «sin» o «con»: una sola variante por proceso (lo de la primera tarda en soltarse y ensucia la segunda)
const variante = process.argv[5];
const base = edificioObjetivoLosas(plantas || 7, nx || 9, ny || 7);

const MB = (b: number) => (b / 2 ** 20).toFixed(0);
function memoria(): { js: number; binaria: number } {
  Bun.gc(true);
  const m = process.memoryUsage();
  return { js: m.heapUsed, binaria: m.arrayBuffers };
}

const lineas = [`# VS3: la memoria de las consultas con el sismo del programa (edificio de losas, ${plantas || 7} plantas de ${nx || 9} × ${ny || 7} vanos)`, "", "Memoria de JavaScript tras recoger la basura, MiB: objetos y, aparte, los vectores de números (los resultados y lo que se guarda por caso). Cada paso, sobre el anterior.", ""];
for (const [nombre, sismo] of [
  ["sin el sismo", null],
  ["con el sismo del programa", SISMO],
] as [string, SismoEdificio | null][]) {
  if (variante && (variante === "con") !== (sismo !== null)) continue;
  const f: ModeloFisico = { ...base, casos: base.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })), ...(sismo ? { acciones: { sismo } } : {}) };
  const m0 = memoria();
  const c = compilar(f);
  if (!c.valido) throw new Error("no compila");
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error("no se calcula");
  const pasos: [string, { js: number; binaria: number }][] = [["compilado y calculado", memoria()]];
  const q = new Consultas(f, c, r.casos, {}, r.modal);
  const cj = (s: ("ELU-PT" | "ELU-SIS")[]) => {
    const x = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: s });
    if (!x.valido) throw new Error("sin combinaciones");
    return x.valor;
  };
  const elu = cj(sismo ? ["ELU-PT", "ELU-SIS"] : ["ELU-PT"]);
  pasos.push(["las consultas", memoria()]);
  const t0 = performance.now();
  envolventes(q, elu);
  const tEnv = performance.now() - t0;
  pasos.push([`envolventes de todas las piezas (${elu.factores.length} combinaciones, ${(tEnv / 1000).toFixed(1)} s)`, memoria()]);
  const planta = f.plantas[0]!.id;
  const t1 = performance.now();
  franjas(q, elu, { planta });
  pasos.push([`franjas de armado de ${planta} (${((performance.now() - t1) / 1000).toFixed(1)} s)`, memoria()]);
  const rr = new ResultadosRender(q, c);
  const t2 = performance.now();
  envolventeCampo(rr, planta, "m11", elu, "max");
  pasos.push([`mapa de M11 de ${planta}, envolvente (${((performance.now() - t2) / 1000).toFixed(1)} s)`, memoria()]);
  lineas.push(`## ${nombre}: ${r.estadisticas.nudos} nudos, ${c.estadisticas.barras} barras, ${c.estadisticas.laminas} láminas, ${r.casos.length} casos${r.modal ? ` y ${r.modal.modos.length} modos` : ""}`, "", "paso | objetos, MiB | vectores, MiB | total sobre el arranque, MiB");
  for (const [que, m] of pasos) lineas.push(`${que} | ${MB(m.js)} | ${MB(m.binaria)} | ${MB(m.js + m.binaria - m0.js - m0.binaria)}`);
  lineas.push("");
  console.log(lineas.slice(-pasos.length - 4).join("\n"));
}
writeFileSync(join(import.meta.dirname, `out_memoria${variante ? `_${variante}` : ""}.txt`), lineas.join("\n"));
