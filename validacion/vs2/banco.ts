/**
 * VS2, criterio 6 (`docs/fem3d/viento-sismo.md` §5): lo que cuesta el análisis modal en los
 * edificios objetivo de 7 plantas. El coste de una fase se fija en ecuaciones y en el perfil móvil
 * (CLAUDE.md, «Coste de una fase»); el tiempo, sólo como información, en caliente, alternando las
 * dos variantes y con el mínimo de tres pasadas.
 *
 * - Las ecuaciones son las mismas con y sin el modal (son 3 lados más por planta sobre la misma
 *   factorización), y los casos salen con los mismos bits.
 * - La memoria del núcleo que pide el cálculo con el modal (`memoriaRequerida` con nc + 3n lados) y
 *   su pico estimado en un núcleo recién arrancado (el del worker, que se recicla tras cada cálculo:
 *   1,15 veces lo pedido más 4 MiB, como en `solucion.ts`), frente al límite del perfil móvil
 *   (512 MiB y 200 000 ecuaciones). Aquí los cuatro edificios se calculan en el mismo núcleo, y su
 *   memoria lineal sólo crece: el pico que da cada cálculo lleva el del edificio anterior.
 *
 * `bun validacion/vs2/banco.ts` → validacion/vs2/out_banco.txt
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import type { ModeloAnalitico, ResultadoCalculo } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { edificioObjetivoMuros } from "../c3/modelos.ts";
import { edificioReticular, edificioUnidireccional } from "../c4/modelos.ts";
import { conSismo } from "./modelos-oraculo.ts";

const MOVIL = { ecuaciones: 200_000, memoria: 512 * 2 ** 20 };
const MB = (b: number) => (b / 2 ** 20).toFixed(0);

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const sha = (r: Extract<ResultadoCalculo, { valido: true }>) => {
  const h = createHash("sha256");
  for (const c of r.casos) for (const a of [c.u, c.reacciones, c.esfuerzosBarras, c.esfuerzosLaminas]) h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  return h.digest("hex").slice(0, 12);
};

function calcularValido(m: ModeloAnalitico): Extract<ResultadoCalculo, { valido: true }> {
  const r = calcular(m);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  return r;
}

const lineas = [
  "# VS2, criterio 6: el coste del análisis modal en los edificios objetivo de 7 plantas",
  "",
  `Perfil móvil: ${MOVIL.ecuaciones} ecuaciones y ${MB(MOVIL.memoria)} MiB de memoria del núcleo. El tiempo, sólo como información (mínimo de 3 pasadas, alternando).`,
  "",
  "edificio | ecuaciones (sin / con) | casos | GDL dinámicos | memoria del núcleo pedida, MiB (sin / con) | pico estimado en un núcleo nuevo, MiB (sin / con) | ¿cabe en el móvil? (sin / con) | mismos bits en los casos | pasos de refinamiento (sin / con) | cálculo, s (sin / con) | de ello, modal, s | T1, s | Σ masa efectiva X / Y | equilibrio peor de un modo | residuo",
];
for (const [nombre, f] of [
  ["losas", edificioObjetivoLosas(7)],
  ["losas y muros", edificioObjetivoMuros(7)],
  ["reticular", edificioReticular(7)],
  ["unidireccional", edificioUnidireccional(7)],
] as [string, ModeloFisico][]) {
  const sin = compilar(f);
  const con = compilar(conSismo(f));
  if (!sin.valido || !con.valido) throw new Error(`${nombre} no compila`);
  let [tSin, tCon, tModal] = [Infinity, Infinity, Infinity];
  let [rs, rc] = [calcularValido(sin.modelo), calcularValido(con.modelo)];
  for (let i = 0; i < 3; i++) {
    let t = performance.now();
    rs = calcularValido(sin.modelo);
    tSin = Math.min(tSin, performance.now() - t);
    t = performance.now();
    rc = calcularValido(con.modelo);
    tCon = Math.min(tCon, performance.now() - t);
    tModal = Math.min(tModal, rc.estadisticas.tiempos.modal!);
  }
  const md = rc.modal!;
  const [ms, mc] = [rs.estadisticas.memoriaNucleo!, rc.estadisticas.memoriaNucleo!];
  const pico = (pedida: number) => 1.15 * pedida + 4 * 2 ** 20;
  const cabe = (r: typeof rc, pedida: number) => (r.estadisticas.ecuaciones <= MOVIL.ecuaciones && pico(pedida) <= MOVIL.memoria ? "sí" : r.estadisticas.ecuaciones > MOVIL.ecuaciones ? "no (ecuaciones)" : "no (memoria)");
  const ef = (d: number) => md.modos.reduce((s, m) => s + m.masaEfectiva[d]!, 0).toFixed(6);
  const eq = Math.max(...md.modos.flatMap((m) => [m.equilibrio.fuerzas, m.equilibrio.momentos]));
  lineas.push(
    `${nombre} | ${rs.estadisticas.ecuaciones} / ${rc.estadisticas.ecuaciones} | ${con.modelo.casos.length} | ${md.gdl} | ${MB(ms.requerida)} / ${MB(mc.requerida)} | ${MB(pico(ms.requerida))} / ${MB(pico(mc.requerida))} | ${cabe(rs, ms.requerida)} / ${cabe(rc, mc.requerida)} | ${sha(rs) === sha(rc) ? "sí" : "NO"} | ${rs.estadisticas.pasosRefinamiento} / ${rc.estadisticas.pasosRefinamiento} | ${(tSin / 1000).toFixed(2)} / ${(tCon / 1000).toFixed(2)} | ${(tModal / 1000).toFixed(2)} | ${md.modos[0]!.periodo.toFixed(4)} | ${ef(0)} / ${ef(1)} | ${eq.toExponential(1)} | ${md.residuo.toExponential(1)}`,
  );
  console.log(lineas[lineas.length - 1]);
}
writeFileSync(join(import.meta.dirname, "out_banco.txt"), lineas.join("\n") + "\n");
