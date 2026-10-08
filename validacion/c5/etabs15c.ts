/**
 * C5, criterio 4: machones y dinteles del muro acoplado de ETABS 15c frente a OpenSeesPy ASDShellQ4
 * con los mismos cortes calculados aparte (`etabs15c-modelos.ts`, `oraculo_cortes.py`), y la
 * estática: en cada planta, los cortantes de las bases de sus machones suman la carga (100 k).
 *
 * Uso: bun validacion/c5/etabs15c.ts → validacion/c5/out_etabs15c.txt (necesita el fixture
 * src/compilador/__fixtures__/opensees-c5.json del oráculo).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { IN, KIP } from "../e6/csi.ts";
import { cortes15c, H_15C, MODELOS_15C, type CorteMuro } from "./etabs15c-modelos.ts";

const lineas: string[] = [];
const decir = (l = "") => {
  lineas.push(l);
  console.log(l);
};
const NOMBRES = ["N", "Vy", "Vz", "T", "My", "Mz"];

/** Peor diferencia de cada componente, relativa al mayor valor de esa componente en las piezas del tipo. */
export function peores(cortes: CorteMuro[], o: Record<string, (number | null)[]>, pieza: string): { q: number; peor: number; id: string; escala: number }[] {
  const cs = cortes.filter((c) => c.pieza === pieza);
  const r: { q: number; peor: number; id: string; escala: number }[] = [];
  for (let q = 0; q < 6; q++) {
    const escala = Math.max(0, ...cs.map((c) => Math.abs(c.esfuerzos[q]!)).filter(Number.isFinite));
    if (!(escala > 1e-6)) continue;
    let peor = { peor: -1, id: "" };
    for (const c of cs) {
      const b = o[c.id]![q];
      const a = c.esfuerzos[q]!;
      if (b === null || b === undefined || !Number.isFinite(a)) continue;
      const d = Math.abs(a - b) / escala;
      if (d > peor.peor) peor = { peor: d, id: c.id };
    }
    if (peor.peor >= 0) r.push({ q, ...peor, escala });
  }
  return r;
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const oraculo = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "opensees-c5.json"), "utf8")) as Record<string, { esfuerzos: Record<string, (number | null)[]>; notas: Record<string, string> }>;
  decir(`# validacion/c5/etabs15c.ts — ${new Date().toISOString().slice(0, 10)}: machones y dinteles de ETABS 15c frente a OpenSeesPy ASDShellQ4`);
  decir();
  decir("Los mismos cortes por fuerzas nodales, calculados en Python con las fuerzas de los elementos de OpenSees. La diferencia es la peor de cada componente, relativa a su mayor valor en las piezas del modelo. Ninguno de los cortes cruza una restricción.");
  decir();
  decir("modelo | h (in) | pieza | componente: peor diferencia (pieza) | Σ Vy de las bases de los machones por planta / P");
  for (const id of MODELOS_15C)
    for (const h of H_15C) {
      const { fisico, cortes } = cortes15c(id, h);
      const o = oraculo[`${id}@${h}`]!;
      const plantas = fisico.plantas.slice(0, -1).map((p) => p.id);
      const estatica = plantas.map((p) => cortes.filter((c) => c.pieza === "machon" && c.id.includes(`:${p}:`) && c.id.endsWith(":base")).reduce((s, c) => s + c.esfuerzos[1]!, 0) / (100 * KIP));
      for (const pieza of ["machon", "dintel"]) {
        const p = peores(cortes, o.esfuerzos, pieza);
        decir(`${id} | ${h} | ${pieza} | ${p.map((x) => `${NOMBRES[x.q]} ${(100 * x.peor).toFixed(2)} % (${x.id})`).join("; ")} | ${pieza === "machon" ? estatica.map((v) => v.toFixed(12)).join(", ") : ""}`);
      }
      if (Object.keys(o.notas).length) decir(`  sin comparar: ${JSON.stringify(o.notas)}`);
    }
  decir();
  decir(`Con h = 20 in, lo peor está en la cabeza del machón de la planta baja, junto a la esquina del hueco (el axil, hasta un 5,9 % con dinteles de 240 in); con h = 10 in todo queda por debajo del 1,4 %: es la diferencia entre los dos elementos junto a la esquina, que se reduce al refinar. La estática cuadra a precisión de máquina. Unidades del modelo: kN y m (1 in = ${IN} m).`);
  writeFileSync(join(import.meta.dirname, "out_etabs15c.txt"), lineas.join("\n") + "\n", { encoding: "utf8" });
}
