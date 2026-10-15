/**
 * Criterio 8 de CY (`docs/fem3d/hipotesis-cype.md`): con las opciones que desactivan las hipótesis
 * de CYPECAD, cada modelo de las referencias congeladas del compilador da bit a bit (el JSON
 * entero: modelo analítico, mapeo y resultados) la referencia de un commit anterior.
 *
 *   bun validacion/cy/opciones.ts <commit> '<opciones JSON>' > validacion/cy/out_opciones_<paso>.txt
 *   p. ej.: bun validacion/cy/opciones.ts 94a0b94 '{"empotramientoCabeza":1}'
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { MODELOS_CONGELADOS_C1, referenciaC1, type ModeloCongelado } from "../c1/congelar.ts";
import { MODELOS_CONGELADOS_C2, referenciaC2 } from "../c2/congelar.ts";
import { MODELOS_CONGELADOS_C3 } from "../c3/congelar.ts";
import { MODELOS_CONGELADOS_C4 } from "../c4/congelar.ts";
import { MODELOS_CONGELADOS_C5, redondeo, referenciaC5 } from "../c5/congelar.ts";
import { MODELOS_CONGELADOS_F, referenciaF } from "../f/congelar.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const [commit, json] = process.argv.slice(2);
if (!commit || !json) throw new Error("uso: bun validacion/cy/opciones.ts <commit> '<opciones JSON>'");
const extra = JSON.parse(json) as OpcionesCompilacion;
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const FASES: [string, Record<string, () => ModeloCongelado>, (f: () => ModeloCongelado) => unknown, ((k: string, v: unknown) => unknown) | undefined][] = [
  ["c1", MODELOS_CONGELADOS_C1, referenciaC1, undefined],
  ["c2", MODELOS_CONGELADOS_C2, referenciaC2, redondeo],
  ["c3", MODELOS_CONGELADOS_C3, referenciaC2, redondeo],
  ["c4", MODELOS_CONGELADOS_C4, referenciaC2, redondeo],
  ["c5", MODELOS_CONGELADOS_C5, referenciaC5, redondeo],
  ["f", MODELOS_CONGELADOS_F, referenciaF, redondeo],
];
console.log(`Opciones ${json} frente a las referencias de ${commit}`);
let mal = 0;
for (const [fase, modelos, referencia, rep] of FASES) {
  const antes = JSON.parse(execFileSync("git", ["show", `${commit}:src/compilador/__fixtures__/congelado-${fase}.json`], { cwd: RAIZ, maxBuffer: 1 << 30 }).toString()) as Record<string, unknown>;
  for (const [k, f] of Object.entries(modelos)) {
    const g = () => {
      const m = f();
      return { ...m, opciones: { ...m.opciones, ...extra } };
    };
    const igual = JSON.stringify(referencia(g), rep) === JSON.stringify(antes[k], rep);
    if (!igual) mal++;
    console.log(`${fase.padEnd(3)}${k.padEnd(36)} ${igual ? "idéntica" : "DISTINTA"}`);
  }
}
console.log(mal ? `Criterio 8: NO PASA (${mal} distintas)` : "Criterio 8: PASA (todas idénticas)");
