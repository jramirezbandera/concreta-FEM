/**
 * Criterio 4 de la fase LV2 (`docs/fem3d/refinamiento-vigas.md` §3, §13 y §18): la calidad de la
 * malla en las 24 retículas al azar de G, en las 20 geometrías no ortogonales (5 familias × 4
 * variantes) y en las 24 retículas con los muros al azar de C3, con LV1 (`refinoEsquinas: false`) y
 * LV2. Por modelo: el jacobiano escalado mínimo, los cuadriláteros por debajo de 0,2, los nudos y los
 * avisos `malla/calidad`, `malla/esquina-sin-refinar`, `malla/pilar-asoma-sin-plantilla` y
 * `malla/sin-rejilla`.
 *
 *   bun validacion/lv2/calidad.ts > validacion/lv2/out_calidad.txt
 */
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { FAMILIAS, edificioGeometria, type OpcionesGeometria } from "../../src/pruebas/geometrias.ts";
import { conMurosAleatorios } from "../../src/pruebas/murosAleatorios.ts";
import { reticulaAleatoria } from "../../src/pruebas/reticulasAleatorias.ts";

/** La retícula al azar con los muros al azar de C3 (su sección «vb» y su caso «V», que la retícula no tiene). */
function reticulaConMuros(semilla: number): ModeloFisico {
  const f = reticulaAleatoria(semilla);
  const conVb = { ...f, secciones: [...f.secciones, { id: "vb", material: "HA", forma: "rectangular" as const, b: 0.3, h: 0.5 }], casos: [...f.casos, { id: "V" }] };
  return conMurosAleatorios(conVb, semilla);
}

const modelos: [string, ModeloFisico][] = [];
for (let s = 1; s <= 24; s++) modelos.push([`ret${s}`, reticulaAleatoria(s)]);
const VARIANTES: [string, OpcionesGeometria][] = [
  ["base", {}],
  ["hueco", { hueco: true }],
  ["giro", { giro: 23 }],
  ["circ", { circulares: true }],
];
for (const fam of FAMILIAS) for (const [vn, v] of VARIANTES) modelos.push([`${fam}-${vn}`, edificioGeometria(fam, v)]);
for (let s = 1; s <= 24; s++) modelos.push([`retmuros${s}`, reticulaConMuros(s)]);

const AVISOS = ["malla/calidad", "malla/esquina-sin-refinar", "malla/pilar-asoma-sin-plantilla", "malla/sin-rejilla"] as const;
const cuenta = (c: ReturnType<typeof compilar>, codigo: string) => c.diagnosticos.filter((d) => d.codigo === codigo).length;
const fila = (n: string, c: ReturnType<typeof compilar>) => {
  if (!c.valido) return `${n.padEnd(22)} NO COMPILA: ${c.diagnosticos[0]?.mensaje.slice(0, 80)}`;
  const m = c.estadisticas.malla;
  return `${n.padEnd(22)} jac ${m.jacobianoMin.toFixed(3)} bajos ${String(m.bajos).padStart(3)} nudos ${String(c.modelo.nudos.length).padStart(6)}   ${AVISOS.map((a) => `${a.slice(6)} ${cuenta(c, a)}`).join("  ")}`;
};
const conAviso: Record<string, number> = { LV1: 0, LV2: 0 };
for (const [n, m] of modelos) {
  for (const [v, op] of [
    ["LV1", { refinoEsquinas: false }],
    ["LV2", { refinoEsquinas: true }],
  ] as const) {
    const c = compilar(m, op);
    if (c.valido && cuenta(c, "malla/calidad") > 0) conAviso[v]!++;
    console.log(fila(`${n} ${v}`, c));
  }
}
console.log(`\nModelos con malla/calidad: LV1 ${conAviso.LV1}, LV2 ${conAviso.LV2} (de ${modelos.length})`);
