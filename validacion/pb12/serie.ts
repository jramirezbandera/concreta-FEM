/**
 * PB-12 (`docs/fem3d/pilares-borde.md` §14): las estaciones de cara de los pilares sin cara de franja
 * con varias mallas, por el camino de siempre (el corte directo si la recta de la cara sigue la malla;
 * si no, el escalón) sin y con lo que entra en la tira del escalón por los bordes de la ventana
 * (`lateralEscalon: "campos"`), frente a la última malla de la lista por el corte directo. Por
 * estación, mx de la suma de los casos y Wood–Armer superior de esa suma (kN·m/m).
 *
 *   bun validacion/pb12/serie.ts <modelo> <h> [<h> ...]
 *
 * Modelos: `2x2-<opciones JSON>` (`recuadros(2, 2)` de `validacion/pb/modelos.ts`), `ej11` o `ej11-pf`.
 */
import { prepararNucleo } from "../a3/revisar.ts";
import { recuadros } from "../pb/modelos.ts";
import { modelo } from "../sombra/ejemplo11/modelo.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosFranjas, type EstacionFranja } from "../../src/compilador/esfuerzosFranjas.ts";
import { resolverOpciones, type ModeloFisico } from "../../src/compilador/fisico.ts";
import { validar } from "../../src/compilador/validar.ts";
import { woodArmer } from "../../src/dimensionado/woodArmer.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import { CamposLaminas } from "../../src/motor/campos.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";

await prepararNucleo();
const [cual, ...hs] = process.argv.slice(2);
const VARIANTE = (process.env.PB12_VARIANTE ?? "campos") as "campos" | "canto";
const fisicoDe = (): ModeloFisico => {
  if (cual === "ej11-pf" || cual === "ej11") {
    const m = structuredClone(modelo(cual === "ej11-pf" ? "pf" : "cype").modelo);
    delete m.acciones;
    return m;
  }
  return recuadros(2, 2, cual!.startsWith("2x2-") ? JSON.parse(cual!.slice(4)) : {});
};
type Valor = { mx: number; wa: number; metodo: string };
const porH: Map<string, { antes?: Valor; ahora?: Valor }>[] = [];
for (const hA of hs) {
  const fisico = fisicoDe();
  const [th, te] = hA.split("/");
  const op = { tamanoMalla: Number(th), ...(te ? { epsSnap: Number(te) } : {}) };
  const r = compilar(fisico, op);
  if (!r.valido) throw new Error(hA);
  const casos = casosValidos(calcular(r.modelo));
  const ctx = validar(fisico, resolverOpciones(op), new Diagnosticos())!;
  const comun = { cortes: new Cortes(r.modelo), campos: new CamposLaminas(r.modelo) };
  const antes = new EsfuerzosFranjas(ctx, r, casos, comun);
  const ahora = new EsfuerzosFranjas(ctx, r, casos, { ...comun, lateralEscalon: VARIANTE });
  const directo = new EsfuerzosFranjas(ctx, r, casos, comun);
  const nc = casos.length;
  const suma = (e: EstacionFranja, a: number) => [...Array(nc).keys()].reduce((x, k) => x + e.medios[3 * k + a]!, 0);
  const valor = (e: EstacionFranja, metodo: string): Valor => ({ mx: suma(e, 0), wa: woodArmer(suma(e, 0), suma(e, 1), suma(e, 2)).superiorX, metodo });
  const m = new Map<string, { antes?: Valor; ahora?: Valor }>();
  // Las estaciones de cara de los pilares sin cara de franja: las que cambian con `caraDirecta: false`
  const escalon = new EsfuerzosFranjas(ctx, r, casos, { ...comun, caraDirecta: false });
  for (const fr of antes.franjas()) {
    const ea = antes.estaciones(fr.id)!.estaciones;
    const eh = ahora.estaciones(fr.id)!.estaciones;
    const ee = escalon.estaciones(fr.id)!.estaciones;
    void directo;
    for (const e of ea) {
      if (e.tipo !== "cara" || !e.valido || !e.ventana) continue;
      const k = `${fr.id} s=${e.s.toFixed(3)} ${e.lado} ${e.piezas.join(",")}`;
      const x = eh.find((y) => y.tipo === "cara" && y.lado === e.lado && Math.abs(y.s - e.s) < 1e-9);
      const z = ee.find((y) => y.tipo === "cara" && y.lado === e.lado && Math.abs(y.s - e.s) < 1e-9);
      // Sólo las del escalón o las que el escalón haría (las que cambian con `caraDirecta: false` o con el lateral)
      const esEscalon = !!z && z.valido && !z.medios.every((v, i) => v === e.medios[i]);
      const cambia = !!x && !x.medios.every((v, i) => v === e.medios[i]);
      if (!esEscalon && !cambia) continue;
      m.set(k, { antes: valor(e, esEscalon ? "directo" : "escalón"), ...(x?.valido ? { ahora: valor(x, esEscalon ? "directo" : "escalón") } : {}) });
    }
  }
  porH.push(m);
  console.error(`${cual} h = ${hA}: ${m.size} estaciones`);
}
const ref = porH[porH.length - 1]!;
const claves = [...new Set(porH.flatMap((m) => [...m.keys()]))].sort();
const errores = hs.map(() => ({ antes: [] as number[], ahora: [] as number[] }));
for (const k of claves) {
  const r = ref.get(k)?.antes;
  if (!r || !(Math.abs(r.wa) > 1)) continue;
  const fila = [k.padEnd(34), `ref ${r.wa.toFixed(2)}`];
  porH.forEach((m, i) => {
    const v = m.get(k);
    if (!v?.antes) return void fila.push(`${hs[i]}: —`);
    const ea = v.antes.wa / r.wa - 1;
    const eh = v.ahora ? v.ahora.wa / r.wa - 1 : NaN;
    if (i < porH.length - 1) {
      errores[i]!.antes.push(ea);
      if (v.ahora) errores[i]!.ahora.push(eh);
    }
    fila.push(`${hs[i]}: ${(100 * ea).toFixed(1)} → ${(100 * eh).toFixed(1)} %`);
  });
  console.log(fila.join(" | "));
}
const resumen = (x: number[]) => {
  const a = x.map(Math.abs).sort((p, q) => p - q);
  const peor = x.reduce((p, q) => (Math.abs(q) > Math.abs(p) ? q : p), 0);
  const peorBajo = Math.min(0, ...x);
  return `mediana |e| ${(100 * (a[Math.floor(a.length / 2)] ?? NaN)).toFixed(1)} %, peor ${(100 * peor).toFixed(1)} %, peor por abajo ${(100 * peorBajo).toFixed(1)} % (${x.length})`;
};
hs.slice(0, -1).forEach((h, i) => console.log(`${cual} h = ${h} frente a ${hs[hs.length - 1]}: antes ${resumen(errores[i]!.antes)} | ahora ${resumen(errores[i]!.ahora)}`));
