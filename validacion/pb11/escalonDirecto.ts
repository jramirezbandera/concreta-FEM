/**
 * PB-11: en la misma malla, el escalón (`caraDirecta: false`) frente al corte directo por la recta de
 * la cara, en todas las estaciones de cara de los pilares sin cara de franja en las que el directo
 * sigue la malla (las mallas finas), con el código de una carpeta (la de ahora o un árbol de trabajo en
 * el commit de antes, HR-8). Por estación, Wood–Armer superior de la suma de los casos; al final, la
 * mediana y el máximo de |escalón / directo − 1|.
 *
 *   bun validacion/pb11/escalonDirecto.ts <raíz> <modelo> <h>[/<eps>]
 *
 * Modelos: `2x2-<opciones JSON>` (`recuadros(2, 2)` de `validacion/pb/modelos.ts`) o `ej11-pf`.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { recuadros } from "../pb/modelos.ts";
import { modelo } from "../sombra/ejemplo11/modelo.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";

const [raizA, cual, hA] = process.argv.slice(2);
const raiz = resolve(raizA!);
const imp = async <T>(r: string) => (await import(join(raiz, r))) as T;
const { iniciarNucleo } = await imp<typeof import("../../src/nucleo/index.ts")>("src/nucleo/index.ts");
const { compilar } = await imp<typeof import("../../src/compilador/compilar.ts")>("src/compilador/compilar.ts");
const { EsfuerzosFranjas } = await imp<typeof import("../../src/compilador/esfuerzosFranjas.ts")>("src/compilador/esfuerzosFranjas.ts");
const { resolverOpciones } = await imp<typeof import("../../src/compilador/fisico.ts")>("src/compilador/fisico.ts");
const { validar } = await imp<typeof import("../../src/compilador/validar.ts")>("src/compilador/validar.ts");
const { calcular } = await imp<typeof import("../../src/motor/calcular.ts")>("src/motor/calcular.ts");
const { Diagnosticos } = await imp<typeof import("../../src/motor/diagnosticos.ts")>("src/motor/diagnosticos.ts");
const { Cortes } = await imp<typeof import("../../src/motor/cortes.ts")>("src/motor/cortes.ts");
const { woodArmer } = await imp<typeof import("../../src/dimensionado/woodArmer.ts")>("src/dimensionado/woodArmer.ts");
const { casosValidos } = await imp<typeof import("../../src/pruebas/comparar.ts")>("src/pruebas/comparar.ts");
await iniciarNucleo(readFileSync(join(raiz, "src/nucleo/pkg/nucleo_bg.wasm")));

let fisico: ModeloFisico;
if (cual === "ej11-pf") {
  fisico = structuredClone(modelo("pf").modelo);
  delete fisico.acciones;
} else fisico = recuadros(2, 2, cual!.startsWith("2x2-") ? JSON.parse(cual!.slice(4)) : {});
const [th, te] = hA!.split("/");
const op = { tamanoMalla: Number(th), ...(te ? { epsSnap: Number(te) } : {}) };
const r = compilar(fisico, op);
if (!r.valido) throw new Error(hA);
const casos = casosValidos(calcular(r.modelo));
const ctx = validar(fisico, resolverOpciones(op), new Diagnosticos())!;
const cortes = new Cortes(r.modelo);
const directo = new EsfuerzosFranjas(ctx, r, casos, { cortes });
const escalon = new EsfuerzosFranjas(ctx, r, casos, { cortes, caraDirecta: false });
const nc = casos.length;
const sup = (m: Float64Array) => {
  const s = (a: number) => [...Array(nc).keys()].reduce((x, k) => x + m[3 * k + a]!, 0);
  return woodArmer(s(0), s(1), s(2)).superiorX;
};
const errs: { k: string; e: number }[] = [];
for (const fr of directo.franjas()) {
  const a = directo.estaciones(fr.id)!.estaciones;
  const b = escalon.estaciones(fr.id)!.estaciones;
  for (const e of a) {
    if (e.tipo !== "cara" || !e.valido) continue;
    const f = b.find((x) => x.tipo === "cara" && x.lado === e.lado && Math.abs(x.s - e.s) < 1e-9 && x.valido);
    if (!f || f.medios.every((v, i) => v === e.medios[i])) continue;
    const [sd, se] = [sup(e.medios), sup(f.medios)];
    if (!(sd > 1)) continue;
    const k = `${fr.id} s=${e.s.toFixed(3)} ${e.lado} ${e.piezas.join(",")}`;
    errs.push({ k, e: se / sd - 1 });
    console.log(`${k} directo ${sd.toFixed(2)} escalón ${se.toFixed(2)} ${(100 * (se / sd - 1)).toFixed(1)} %`);
  }
}
const abs = errs.map((x) => Math.abs(x.e)).sort((x, y) => x - y);
if (!errs.length) {
  console.log(`${cual} h = ${hA}: ninguna estación`);
  process.exit(0);
}
const peor = errs.reduce((x, y) => (Math.abs(y.e) > Math.abs(x.e) ? y : x), errs[0]!);
console.log(`${cual} h = ${hA}: ${errs.length} estaciones; |escalón / directo − 1|: mediana ${(100 * abs[Math.floor(abs.length / 2)]!).toFixed(1)} %, máximo ${(100 * peor.e).toFixed(1)} % (${peor.k})`);
