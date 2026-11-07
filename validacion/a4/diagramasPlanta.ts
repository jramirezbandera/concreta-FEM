/**
 * Los diagramas de vigas en planta con los seis esfuerzos: en cada planta de la vivienda, del ejemplo de
 * la skill y del edificio objetivo con losas, el mayor |valor| de cada esfuerzo, si sale nulo
 * (`DIAGRAMA_NULO`) y cuántos extremos rotula. Para fijar el umbral de lo nulo: en un diafragma rígido,
 * Mz y Vy de las vigas son del orden del redondeo.
 *
 *   bun validacion/a4/diagramasPlanta.ts > validacion/a4/out_diagramasPlanta.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resumen } from "../../src/agente/consultas.ts";
import { conjuntoPorDefecto, ESFUERZOS_PLANTA, ResultadosRender, vistaDiagramas } from "../../src/agente/render/index.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { prepararNucleo, proyectoDe } from "../a3/revisar.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const leer = (r: string) => JSON.parse(readFileSync(join(RAIZ, r), "utf8")).modelo as ModeloFisico;
const MODELOS: [string, ModeloFisico][] = [
  ["vivienda", leer("ejemplos/vivienda/proyecto.json")],
  ["ejemplo de la skill", leer(".claude/skills/fem/ejemplo.json")],
  ["edificio objetivo con losas", edificioObjetivoLosas()],
];

await prepararNucleo();
for (const [nombre, f] of MODELOS) {
  const c = compilar(f);
  if (!c.valido) throw new Error(nombre);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(nombre);
  const q = new Consultas(f, c, k.casos);
  const res = resumen(proyectoDe(f), c);
  if (!res.valido) throw new Error(nombre);
  const r = new ResultadosRender(q, c);
  const cj = conjuntoPorDefecto(q, res.valor, "esfuerzos");
  console.log(`\n## ${nombre} (${cj.descripcion}, ${cj.factores.length} combinaciones)`);
  console.log("planta   " + ESFUERZOS_PLANTA.map((e) => e.padStart(22)).join(""));
  for (const p of f.plantas) {
    const celdas = ESFUERZOS_PLANTA.map((e) => {
      const s = vistaDiagramas(r, p.id, e, cj, { huella: c.huella });
      const nulo = s.notas.find((x) => x.includes("nulo en toda la planta ("));
      const mayor = nulo ? `nulo ${nulo.match(/el mayor, ([^)]+)\)/)?.[1]}` : s.extremos.length ? Math.abs(s.extremos[0]!.valor).toFixed(2) : "—";
      return `${mayor} (${s.extremos.length})`.padStart(22);
    });
    console.log(p.id.padEnd(9) + celdas.join(""));
  }
}
