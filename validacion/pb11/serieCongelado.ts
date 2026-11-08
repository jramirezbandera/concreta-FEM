/**
 * PB-11: una estación de cara de un modelo de la referencia congelada de F con varios tamaños de malla,
 * con el código de una carpeta (la de ahora o un árbol de trabajo en el commit de antes, HR-8): mx, my y
 * mxy de la suma de los casos y Wood–Armer superior.
 *
 *   bun validacion/pb11/serieCongelado.ts <raíz> <modelo> <franja> <s> <h>[/<eps>] [<h> ...]
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MODELOS_CONGELADOS_F } from "../f/congelar.ts";

const [raizA, nombre, fr, sA, ...hs] = process.argv.slice(2);
const raiz = resolve(raizA!);
const { iniciarNucleo } = (await import(join(raiz, "src/nucleo/index.ts"))) as typeof import("../../src/nucleo/index.ts");
const { compilar } = (await import(join(raiz, "src/compilador/compilar.ts"))) as typeof import("../../src/compilador/compilar.ts");
const { EsfuerzosFranjas } = (await import(join(raiz, "src/compilador/esfuerzosFranjas.ts"))) as typeof import("../../src/compilador/esfuerzosFranjas.ts");
const { resolverOpciones } = (await import(join(raiz, "src/compilador/fisico.ts"))) as typeof import("../../src/compilador/fisico.ts");
const { validar } = (await import(join(raiz, "src/compilador/validar.ts"))) as typeof import("../../src/compilador/validar.ts");
const { calcular } = (await import(join(raiz, "src/motor/calcular.ts"))) as typeof import("../../src/motor/calcular.ts");
const { Diagnosticos } = (await import(join(raiz, "src/motor/diagnosticos.ts"))) as typeof import("../../src/motor/diagnosticos.ts");
const { woodArmer } = (await import(join(raiz, "src/dimensionado/woodArmer.ts"))) as typeof import("../../src/dimensionado/woodArmer.ts");
const { casosValidos } = (await import(join(raiz, "src/pruebas/comparar.ts"))) as typeof import("../../src/pruebas/comparar.ts");
await iniciarNucleo(readFileSync(join(raiz, "src/nucleo/pkg/nucleo_bg.wasm")));
const { fisico, opciones } = MODELOS_CONGELADOS_F[nombre!]!();
for (const hA of hs) {
  const [th, te] = hA.split("/");
  const op = { ...(opciones ?? {}), tamanoMalla: Number(th), ...(te ? { epsSnap: Number(te) } : {}) };
  const r = compilar(fisico, op);
  if (!r.valido) throw new Error(hA);
  const casos = casosValidos(calcular(r.modelo));
  const ctx = validar(fisico, resolverOpciones(op), new Diagnosticos())!;
  const ef = new EsfuerzosFranjas(ctx, r, casos, {});
  const nc = casos.length;
  for (const e of ef.estaciones(fr!)!.estaciones) {
    if (e.tipo !== "cara" || Math.abs(e.s - Number(sA)) > 1e-3) continue;
    const sum = (a: number) => [...Array(nc).keys()].reduce((x, k) => x + e.medios[3 * k + a]!, 0);
    const [mx, my, mxy] = [sum(0), sum(1), sum(2)];
    console.log(`${hA} ${fr} s=${e.s.toFixed(3)} ${e.lado} ${e.piezas.join(",")} ${e.metodo} mx ${mx.toFixed(2)} my ${my.toFixed(2)} mxy ${mxy.toFixed(2)} WAsup ${woodArmer(mx, my, mxy).superiorX.toFixed(2)}`);
  }
}
