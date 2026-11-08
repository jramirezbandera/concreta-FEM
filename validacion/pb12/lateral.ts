/**
 * PB-12 (`docs/fem3d/pilares-borde.md` §14): en la misma malla, el escalón de los pilares sin cara de
 * franja (`caraDirecta: false`) frente al corte directo por la recta de la cara, sin y con lo que
 * entra en la tira por los bordes de la ventana (`lateralEscalon`: por campos en la tira o a un canto
 * de la cara). Por estación, mx de la suma de los casos (kN·m/m) y la
 * diferencia con el directo; al final, la mediana y el máximo de |x / directo − 1| de cada variante.
 *
 *   bun validacion/pb12/lateral.ts <modelo> <h>[/<eps>]
 *
 * Modelos: `2x2-<opciones JSON>` (`recuadros(2, 2)` de `validacion/pb/modelos.ts`) o `ej11-pf`.
 */
import { prepararNucleo } from "../a3/revisar.ts";
import { recuadros } from "../pb/modelos.ts";
import { modelo } from "../sombra/ejemplo11/modelo.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosFranjas, type EstacionFranja } from "../../src/compilador/esfuerzosFranjas.ts";
import { resolverOpciones, type ModeloFisico } from "../../src/compilador/fisico.ts";
import { validar } from "../../src/compilador/validar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import { CamposLaminas } from "../../src/motor/campos.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";

await prepararNucleo();
const [cual, hA] = process.argv.slice(2);
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
const campos = new CamposLaminas(r.modelo);
const comun = { cortes, campos };
const variantes = {
  directo: new EsfuerzosFranjas(ctx, r, casos, comun),
  escalon: new EsfuerzosFranjas(ctx, r, casos, { ...comun, caraDirecta: false }),
  campos: new EsfuerzosFranjas(ctx, r, casos, { ...comun, caraDirecta: false, lateralEscalon: "campos" }),
  canto: new EsfuerzosFranjas(ctx, r, casos, { ...comun, caraDirecta: false, lateralEscalon: "canto" }),
};
const nc = casos.length;
const mx = (e: EstacionFranja) => [...Array(nc).keys()].reduce((x, k) => x + e.medios[3 * k]!, 0);
const errores: Record<string, number[]> = { escalon: [], campos: [], canto: [] };
for (const fr of variantes.directo.franjas()) {
  const de = variantes.directo.estaciones(fr.id)!.estaciones;
  const es = variantes.escalon.estaciones(fr.id)!.estaciones;
  for (const e of de) {
    if (e.tipo !== "cara" || !e.valido) continue;
    const buscar = (v: EsfuerzosFranjas) => v.estaciones(fr.id)!.estaciones.find((x) => x.tipo === "cara" && x.lado === e.lado && Math.abs(x.s - e.s) < 1e-9);
    const f = es.find((x) => x.tipo === "cara" && x.lado === e.lado && Math.abs(x.s - e.s) < 1e-9 && x.valido);
    if (!f || f.medios.every((v, i) => v === e.medios[i])) continue;
    const D = mx(e);
    if (!(Math.abs(D) > 1)) continue;
    const fila = [`${fr.id} s=${e.s.toFixed(3)} ${e.lado} ${e.piezas.join(",")}`, `directo ${D.toFixed(3)}`];
    for (const k of ["escalon", "campos", "canto"] as const) {
      const x = buscar(variantes[k]);
      if (!x?.valido) {
        fila.push(`${k} —`);
        continue;
      }
      const v = mx(x);
      errores[k]!.push(v / D - 1);
      fila.push(`${k} ${v.toFixed(3)} (${(100 * (v / D - 1)).toFixed(1)} %)`);
    }
    console.log(fila.join(" | "));
  }
}
for (const [k, es] of Object.entries(errores)) {
  if (!es.length) continue;
  const a = es.map(Math.abs).sort((x, y) => x - y);
  const peor = es.reduce((x, y) => (Math.abs(y) > Math.abs(x) ? y : x), 0);
  console.log(`${cual} h = ${hA} ${k}: ${es.length} estaciones; |x / directo − 1| mediana ${(100 * a[Math.floor(a.length / 2)]!).toFixed(1)} %, peor ${(100 * peor).toFixed(1)} %`);
}
