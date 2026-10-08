/**
 * Banco de C5 (criterio 8): en el edificio objetivo de 7 plantas, con losa plana y con la maciza con
 * vigas (`validacion/c5/malla.ts`), lo que cuesta cada paso frente al cálculo:
 * - proponer las bandas;
 * - compilar con ellas (las caras comunes sembradas, C5-g) y calcular;
 * - integrar todas las estaciones de todas las bandas (`Consultas.banda`) y Wood–Armer (a) en todas
 *   las combinaciones ELU-PT;
 * - las consultas de pilares (todas sus plantas), reacciones de sus bases, plantas y desplomes, y
 *   flechas de cada losa en las combinaciones ELS-C.
 * Los casos llevan su acción (G, Q y viento en X e Y) para que las combinaciones salgan del generador.
 *
 * Uso: bun validacion/c5/banco.ts [plantas] → validacion/c5/out_banco.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { proponerBandas } from "../../src/compilador/bandas.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import { woodArmerEstacion } from "../../src/compilador/esfuerzosBandas.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { conAcciones } from "./modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const lineas: string[] = [];
const decir = (l = "") => {
  lineas.push(l);
  console.log(l);
};
const n = process.argv[2] ? Number(process.argv[2]) : 7;
const sinVigas = (f: ModeloFisico): ModeloFisico => ({ ...f, vigas: [], cargas: f.cargas!.filter((c) => c.tipo !== "viga") });
const modelos: [string, ModeloFisico][] = [
  ["losa plana", conAcciones(sinVigas(edificioObjetivoLosas(n)))],
  ["maciza con vigas", conAcciones(edificioObjetivoLosas(n))],
];

decir(`# validacion/c5/banco.ts — ${new Date().toISOString().slice(0, 10)}: edificio objetivo de ${n} plantas (10 × 8 pilares), Bun`);
decir();
decir("modelo | nudos | ecuaciones | bandas | estaciones | combinaciones ELU-PT / ELS-C | proponer (s) | compilar (s) | calcular (s) | bandas y Wood–Armer (s) | consultas (s) | lo de C5 / cálculo");
const medir = <T>(f: () => T): [T, number] => {
  const t0 = performance.now();
  const r = f();
  return [r, (performance.now() - t0) / 1000];
};
for (const [nombre, f0] of modelos) {
  const [{ bandas }, tProp] = medir(() => proponerBandas(f0));
  const f = { ...f0, bandas };
  const [r, tComp] = medir(() => compilar(f));
  if (!r.valido) throw new Error(r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join("\n"));
  const [c, tCalc] = medir(() => calcular(r.modelo));
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(c);
  const q = new Consultas(f, r, casos);
  const elu = q.combinaciones({ situaciones: ["ELU-PT"] });
  const els = q.combinaciones({ situaciones: ["ELS-C"] });
  if (!elu.valido || !els.valido) throw new Error("sin combinaciones");
  const factores = elu.valor.map((x) => x.factores);
  let estaciones = 0;
  const [, tBandas] = medir(() => {
    for (const b of bandas) {
      const e = q.banda(b.id);
      if (!e.valido) throw new Error(b.id);
      for (const s of e.valor) {
        estaciones++;
        if (s.valido) woodArmerEstacion(s, factores);
      }
    }
  });
  const [, tConsultas] = medir(() => {
    for (const p of f.pilares!) {
      if (!q.pilar(p.id).valido) throw new Error(p.id);
      q.reacciones(p.id);
    }
    for (const p of f.plantas.slice(0, -1)) {
      q.planta(p.id);
      for (const k of els.valor) q.desplomes(p.id, k.factores);
    }
    for (const l of f.losas!) for (const k of els.valor) q.flechas(l.id, k.factores);
  });
  const c5 = tProp + tBandas + tConsultas;
  decir(
    `${nombre} | ${r.estadisticas.nudos} | ${c.estadisticas.ecuaciones} | ${bandas.length} | ${estaciones} | ${elu.valor.length} / ${els.valor.length} | ${tProp.toFixed(2)} | ${tComp.toFixed(1)} | ${tCalc.toFixed(1)} | ${tBandas.toFixed(1)} | ${tConsultas.toFixed(1)} | ${((100 * c5) / tCalc).toFixed(0)} %`,
  );
}
decir();
decir("«Lo de C5» es proponer, integrar las bandas con Wood–Armer y las consultas; compilar ya era de C1–C4. La integración de las bandas es sobre todo recuperar los campos SPR (my y mxy de Wood–Armer, y los vanos), que los cortes de las estaciones piden en casi toda la losa y en cada caso.");
writeFileSync(join(import.meta.dirname, "out_banco.txt"), lineas.join("\n") + "\n", { encoding: "utf8" });
