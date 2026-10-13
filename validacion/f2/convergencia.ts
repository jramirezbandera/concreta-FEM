/**
 * Fase F2, criterio 1 (`docs/fem3d/refinamiento.md`): el metro centrado en cada pilar con cara, en
 * cada una de sus caras (la ventana de F-h), con h = 0,75 con y sin el refinamiento, frente a la
 * malla fina (h = 0,125; en el edificio, 0,1875). Se comparan las caras con demanda: |m| de la suma
 * de los casos ≥ 20 % del mayor de la losa. También el edificio objetivo de una planta, con pilares
 * de dos tamaños (informativo: la referencia es más gruesa).
 *
 * Uso: bun validacion/f2/convergencia.ts [--rapido] → validacion/f2/out_convergencia.txt. Con
 * SOLO=<parte del nombre>, sólo ese modelo, y con DETALLE=1, cada cara con F2 (sin escribir la salida).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosFranjas } from "../../src/compilador/esfuerzosFranjas.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { validar } from "../../src/compilador/validar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { losaPlanaFisica, OPCIONES_LOSA_PLANA } from "../c2/losaPlana.ts";
import { reticularH25 } from "../c5/modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const rapido = process.argv.includes("--rapido");

/** La losa de 3 × 3 vanos de F (`validacion/f/convergencia.ts`): pilares de 30 × 30, q = 10 kN/m². */
export function losa3x3(): ModeloFisico {
  const pilares = [];
  for (const x of [0, 6, 12, 18]) for (const y of [0, 5, 10, 15]) pilares.push({ id: `P${x}-${y}`, x, y, desde: "C", hasta: "P1", seccion: "p" });
  return {
    plantas: [{ id: "P1", altura: null }, { id: "C", tipo: "sotano", altura: 3 }],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 }],
    pilares,
    losas: [{ id: "L", planta: "P1", contorno: [[-0.5, -0.5], [18.5, -0.5], [18.5, 15.5], [-0.5, 15.5]], espesor: 0.25, material: "HA" }],
    casos: [{ id: "Q" }],
    cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -10] }],
  };
}
const sinVigas = (f: ModeloFisico): ModeloFisico => ({ ...f, vigas: [], cargas: f.cargas!.filter((c) => c.tipo !== "viga") });

interface Cara {
  clave: string;
  m: number;
  /** «propia» (la estación en la cara del pilar), «común por dentro» (la cara común de C5-g cae dentro de su huella) o «junto a un hueco» (a < 1 m). */
  grupo: string;
}
/** Grupo de una cara (losas con el eje 1 en x y pilares sin girar, como los de este fichero). */
function grupo(f: ModeloFisico, l: NonNullable<ModeloFisico["losas"]>[number], dir: 1 | 2, s: number, id: string): string {
  const p = f.pilares!.find((x) => x.id === id)!;
  const sec = f.secciones.find((x) => x.id === p.seccion)! as { b: number; h: number };
  const [c, e] = dir === 1 ? [p.x, sec.b / 2] : [p.y, sec.h / 2];
  const hueco = (l.huecos ?? []).some((h) => {
    const xs = h.map((q) => q[0]);
    const ys = h.map((q) => q[1]);
    const dx = Math.max(Math.min(...xs) - (p.x + sec.b / 2), 0, p.x - sec.b / 2 - Math.max(...xs));
    const dy = Math.max(Math.min(...ys) - (p.y + sec.h / 2), 0, p.y - sec.h / 2 - Math.max(...ys));
    return Math.hypot(dx, dy) < 1;
  });
  if (hueco) return "junto a un hueco";
  return Math.abs(Math.abs(s - c) - e) > 1e-6 ? "común por dentro" : "propia";
}

/** Las estaciones de cara con ventana (el metro centrado en un pilar) de todas las losas: la suma de los casos. */
function caras(f: ModeloFisico, op: OpcionesCompilacion): { caras: Cara[]; nudos: number; avisos: string[] } {
  const r = compilar(f, op);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(calcular(r.modelo));
  const ef = new EsfuerzosFranjas(validar(f, resolverOpciones(op), new Diagnosticos())!, r, casos, { cortes: new Cortes(r.modelo) });
  const res: Cara[] = [];
  for (const l of f.losas ?? [])
    for (const fr of ef.franjas(l.id))
      for (const e of ef.estaciones(fr.id)!.estaciones) {
        if (e.tipo !== "cara" || !e.ventana) continue;
        let m = 0;
        for (let k = 0; k < casos.length; k++) m += e.medios[3 * k]!;
        res.push({ clave: `${l.id}|${fr.direccion}|${e.s.toFixed(4)}|${e.lado}|${[...e.piezas].sort().join(",")}`, m, grupo: grupo(f, l, fr.direccion, e.s, e.piezas[0]!) });
      }
  const avisos = [...new Set(r.diagnosticos.filter((d) => d.codigo.startsWith("malla/")).map((d) => d.codigo))];
  return { caras: res, nudos: r.modelo.nudos.length, avisos };
}

if (import.meta.main) {
const lineas: string[] = ["# Fase F2: convergencia del metro centrado en el pilar, en sus caras", ""];
const decir = (s = "") => {
  lineas.push(s);
  console.log(s);
};
decir("Error de cada cara con demanda (≥ 20 % de la mayor) frente a la malla fina; media y máximo de |error|, y el peor con su signo.");
decir();
decir("losa | malla | nudos | caras | media | máx. | peor (con signo) | avisos de malla");
const modelos: [string, ModeloFisico, OpcionesCompilacion, number][] = [
  ["3 × 3 vanos, pilares de 30 × 30", losa3x3(), {}, 0.125],
  ["H25 losa plana", losaPlanaFisica(), { ...OPCIONES_LOSA_PLANA }, 0.125],
  ["H25 reticular con ábacos", reticularH25(), { ...OPCIONES_LOSA_PLANA }, 0.125],
  ...(rapido ? [] : ([["edificio objetivo, 1 planta, losa plana (pilares de 30 × 50 y 40 × 40)", sinVigas(edificioObjetivoLosas(1)), {}, 0.1875]] as [string, ModeloFisico, OpcionesCompilacion, number][])),
];
const resumen: { modelo: string; malla: string; max: number; media: number }[] = [];
for (const [nombre, f, op, hRef] of modelos) {
  if (process.env.SOLO && !nombre.includes(process.env.SOLO)) continue;
  const ref = caras(f, { ...op, tamanoMalla: hRef, refinoCaras: false });
  const mayor = Math.max(...ref.caras.map((c) => Math.abs(c.m)));
  const conDemanda = new Map(ref.caras.filter((c) => Math.abs(c.m) >= 0.2 * mayor).map((c) => [c.clave, c.m]));
  decir(`${nombre} | referencia h = ${hRef} | ${ref.nudos} | ${conDemanda.size} | — | — | — | ${ref.avisos.join(", ") || "—"}`);
  for (const [malla, o] of [
    ["h = 0,75 sin refinar", { ...op, tamanoMalla: 0.75, refinoCaras: false }],
    ["h = 0,75 con F2", { ...op, tamanoMalla: 0.75 }],
    ["h = 0,5 sin refinar", { ...op, tamanoMalla: 0.5, refinoCaras: false }],
  ] as [string, OpcionesCompilacion][]) {
    if (rapido && malla.startsWith("h = 0,5")) continue;
    const r = caras(f, o);
    const errores: number[] = [];
    const detalle: string[] = [];
    const porGrupo = new Map<string, number[]>();
    for (const [clave, c] of new Map(r.caras.map((c) => [c.clave, c]))) {
      const v = conDemanda.get(clave);
      if (v === undefined) continue;
      errores.push(c.m / v - 1);
      porGrupo.set(c.grupo, [...(porGrupo.get(c.grupo) ?? []), Math.abs(c.m / v - 1)]);
      detalle.push(`${clave} ${(100 * (c.m / v - 1)).toFixed(2)} % (ref ${v.toFixed(2)}) ${c.grupo}`);
    }
    if (process.env.DETALLE && malla.includes("F2")) for (const x of detalle.sort((p, q) => Math.abs(parseFloat(q.split(" ")[1]!)) - Math.abs(parseFloat(p.split(" ")[1]!)))) console.log(x);
    const abs = errores.map(Math.abs);
    const media = abs.reduce((s, x) => s + x, 0) / abs.length;
    const max = Math.max(...abs);
    const peor = errores[abs.indexOf(max)]!;
    resumen.push({ modelo: nombre, malla, max, media });
    decir(`${nombre} | ${malla} | ${r.nudos} | ${errores.length} | ${(100 * media).toFixed(2)} % | ${(100 * max).toFixed(2)} % | ${(100 * peor).toFixed(2)} % | ${r.avisos.join(", ") || "—"}`);
    if (porGrupo.size > 1)
      for (const [g, e] of [...porGrupo].sort())
        decir(`↳ cara ${g} | ${malla} | | ${e.length} | ${((100 * e.reduce((x, y) => x + y, 0)) / e.length).toFixed(2)} % | ${(100 * Math.max(...e)).toFixed(2)} % | | `);
  }
}
// La referencia de la 3 × 3, comprobada con una malla aún más fina
if (!rapido) {
  decir();
  decir("Referencia de la 3 × 3: h = 0,125 frente a h = 0,1 (sin refinar)");
  const a = caras(losa3x3(), { tamanoMalla: 0.125, refinoCaras: false });
  const b = new Map(caras(losa3x3(), { tamanoMalla: 0.1, refinoCaras: false }).caras.map((c) => [c.clave, c.m]));
  const mayor = Math.max(...a.caras.map((c) => Math.abs(c.m)));
  const d = a.caras.filter((c) => Math.abs(c.m) >= 0.2 * mayor).map((c) => Math.abs(c.m / b.get(c.clave)! - 1));
  decir(`caras ${d.length} | media ${(100 * d.reduce((s, x) => s + x, 0) / d.length).toFixed(2)} % | máx. ${(100 * Math.max(...d)).toFixed(2)} %`);
}
if (!rapido && !process.env.SOLO) writeFileSync(join(import.meta.dirname, "out_convergencia.txt"), lineas.join("\n") + "\n", { encoding: "utf8" });
}
