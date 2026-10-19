/**
 * Criterio 10 de la fase LV2 (`docs/fem3d/refinamiento-vigas.md` §19): compilar y calcular los
 * edificios objetivo de 7 plantas, LV1 y LV2 alternados tres veces en el mismo proceso, y el mínimo
 * de cada uno. El banco (`banco.ts`) mide cada variante una vez y en frío, y §15 comparaba LV2 en
 * caliente con LV1 en frío (+19 %); en las mismas condiciones, el edificio con vigas sale a +55 %.
 *
 *   bun validacion/lv2/tiempos.ts > validacion/lv2/out_tiempos.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { edificioReticular } from "../c4/modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const PASADAS = 3;
for (const [nombre, f] of [
  ["edificio objetivo con vigas", edificioObjetivoLosas(7)],
  ["reticular objetivo con vigas", edificioReticular(7)],
] as const) {
  const min: Record<string, [number, number]> = { LV1: [Infinity, Infinity], LV2: [Infinity, Infinity] };
  for (let i = 0; i < PASADAS; i++)
    for (const [v, op] of [
      ["LV1", { refinoEsquinas: false }],
      ["LV2", {}],
    ] as [string, OpcionesCompilacion][]) {
      const t0 = performance.now();
      const r = compilar(f, op);
      const t1 = performance.now();
      if (!r.valido) throw new Error(`${nombre} ${v} no compila`);
      calcular(r.modelo);
      const t2 = performance.now();
      min[v] = [Math.min(min[v]![0], t1 - t0), Math.min(min[v]![1], t2 - t1)];
    }
  const s = (ms: number) => (ms / 1000).toFixed(1);
  const total = (v: string) => min[v]![0] + min[v]![1];
  console.log(`${nombre} (mínimo de ${PASADAS}, compilación + cálculo): LV1 ${s(min.LV1![0])} + ${s(min.LV1![1])} = ${s(total("LV1"))} s; LV2 ${s(min.LV2![0])} + ${s(min.LV2![1])} = ${s(total("LV2"))} s; ${((100 * total("LV2")) / total("LV1") - 100).toFixed(0)} %`);
}
