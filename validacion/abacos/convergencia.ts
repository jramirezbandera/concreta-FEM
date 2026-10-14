/**
 * SP-2: franjas de armado con h = 0,75 frente a una malla más fina, en dos reticulares con ábacos
 * en pilares sin caras de franja (de borde, de esquina o atravesados por vigas):
 * - el muestrario (L2, ejemplos/muestrario), frente a h = 0,25;
 * - el edificio reticular de C4 con 2 plantas (`conAcciones(edificioReticular(2))`), frente a h = 0,375.
 * Por franja, la envolvente inferior y superior de las combinaciones ELU por defecto (lo que da
 * `fem consultar franjas`); sólo las de |m| ≥ 20 kN·m/m en la referencia, que son las que dimensionan.
 * Con h = 0,1 aparece F3-8 (los nudos a ≤ ε_snap de la huella se hacen rígidos: caras un 6–9 % altas),
 * así que no es una referencia limpia.
 * Uso: bun validacion/abacos/convergencia.ts > validacion/abacos/out_convergencia.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prepararNucleo } from "../a3/revisar.ts";
import { edificioReticular } from "../c4/modelos.ts";
import { conAcciones } from "../c5/modelos.ts";
import { conjuntoCombinaciones, seleccionPorDefecto } from "../../src/agente/combinaciones.ts";
import { franjas, type FilaFranja } from "../../src/agente/consultas.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";

await prepararNucleo();

function envolventes(fisico: ModeloFisico, h: number, losas: readonly string[]): Map<string, FilaFranja> {
  const opciones = { tamanoMalla: h };
  const c = compilar(fisico, opciones);
  if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
  const q = new Consultas(fisico, c, k.casos, opciones);
  const cj = conjuntoCombinaciones(q, seleccionPorDefecto(fisico.casos, "esfuerzos"));
  if (!cj.valido) throw new Error(cj.diagnosticos[0]!.mensaje);
  const r = new Map<string, FilaFranja>();
  for (const losa of losas) {
    const f = franjas(q, cj.valor, { losa });
    if (!f.valido) throw new Error(f.diagnosticos[0]!.mensaje);
    for (const x of f.valor.franjas) r.set(x.id, x);
  }
  console.log(`  h = ${h}: ${c.modelo.nudos.length} nudos, ${c.estadisticas.malla?.plantillasRefinadas} de ${c.estadisticas.malla?.plantillas} plantillas refinadas`);
  return r;
}

function comparar(nombre: string, fisico: ModeloFisico, losas: readonly string[], href: number): void {
  console.log(`\n${nombre}`);
  const a = envolventes(fisico, 0.75, losas);
  const r = envolventes(fisico, href, losas);
  const errores: { e: number; t: string }[] = [];
  for (const [id, fr] of r)
    for (const lado of ["inferior", "superior"] as const) {
      const vr = fr[lado]?.v;
      const va = a.get(id)?.[lado]?.v;
      if (vr === undefined || va === undefined || Math.abs(vr) < 20) continue;
      const e = (va - vr) / vr;
      errores.push({ e, t: `${id.padEnd(10)} ${lado.padEnd(9)} ${va.toFixed(1).padStart(7)} frente a ${vr.toFixed(1).padStart(7)} (${(100 * e).toFixed(1).padStart(6)} %)  s = ${a.get(id)![lado]!.s.toFixed(2)} / ${fr[lado]!.s.toFixed(2)}` });
    }
  errores.sort((x, y) => x.e - y.e);
  const es = errores.map((x) => x.e);
  const media = es.reduce((s, x) => s + x, 0) / es.length;
  const absMedia = es.reduce((s, x) => s + Math.abs(x), 0) / es.length;
  console.log(`  ${es.length} envolventes ≥ 20 kN·m/m: media ${(100 * media).toFixed(1)} %, |media| ${(100 * absMedia).toFixed(1)} %, por debajo de −10 %: ${es.filter((x) => x < -0.1).length}, de −5 %: ${es.filter((x) => x < -0.05).length}`);
  console.log("  Las peores (h = 0,75 frente a la referencia):");
  for (const x of errores.slice(0, 8)) console.log(`    ${x.t}`);
  console.log("  Las más altas:");
  for (const x of errores.slice(-3)) console.log(`    ${x.t}`);
}

const muestrario: ModeloFisico = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "ejemplos", "muestrario", "proyecto.json"), "utf8")).modelo;
comparar("Muestrario, L2 (frente a h = 0,25)", muestrario, ["L2"], 0.25);
comparar("Edificio reticular de C4, 2 plantas (frente a h = 0,375)", conAcciones(edificioReticular(2)), ["L-N1", "L-N2"], 0.375);
