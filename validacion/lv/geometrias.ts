/**
 * Fase LV: las plantas no ortogonales de G (`src/compilador/geometrias.test.ts`) con la unión por las
 * caras: por familia, variante y rejilla, los errores, el respaldo de la triangulación y los avisos de
 * calidad de malla (cuántos cuadriláteros por debajo de 0,2 y el jacobiano mínimo), y lo mismo con la
 * unión de antes.
 *
 *   bun validacion/lv/geometrias.ts > validacion/lv/out_geometrias.txt
 */
import { compilar } from "../../src/compilador/compilar.ts";
import { edificioGeometria, FAMILIAS, type OpcionesGeometria } from "../../src/pruebas/geometrias.ts";
import { reticulaAleatoria } from "../../src/pruebas/reticulasAleatorias.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";

const VARIANTES: [string, OpcionesGeometria][] = [
  ["base", {}],
  ["hueco", { hueco: true }],
  ["giro 23°", { giro: 23 }],
  ["circulares", { circulares: true }],
];
const resumen = (f: ModeloFisico, rejilla: boolean, union: "cara" | "eje") => {
  const r = compilar(f, { rejilla, unionLosaViga: union });
  const err = r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo);
  const sin = r.diagnosticos.some((d) => d.codigo === "malla/sin-rejilla");
  if (!r.valido) return `ERROR ${err.join(",")}`;
  const cal = r.estadisticas.malla;
  return `${sin ? "sin rejilla " : ""}bajos ${String(cal.bajos).padStart(3)} jmin ${cal.jacobianoMin.toFixed(3)} nudos ${r.estadisticas.nudos}`;
};
console.log("familia / variante / rejilla: unión por las caras | por el eje\n");
for (const fam of FAMILIAS)
  for (const [nv, v] of VARIANTES)
    for (const rejilla of [true, false]) {
      const f = edificioGeometria(fam, v);
      console.log(`${fam.padEnd(11)}${nv.padEnd(11)}${rejilla ? "rejilla" : "CDT    "}  ${resumen(f, rejilla, "cara").padEnd(44)}| ${resumen(f, rejilla, "eje")}`);
    }
for (let s = 1; s <= 24; s++) for (const rejilla of [true, false]) console.log(`retícula ${String(s).padEnd(13)}${rejilla ? "rejilla" : "CDT    "}  ${resumen(reticulaAleatoria(s), rejilla, "cara").padEnd(44)}| ${resumen(reticulaAleatoria(s), rejilla, "eje")}`);
