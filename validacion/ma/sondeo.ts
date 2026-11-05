// Sondeo: casi alineados en los modelos de referencia y los ejemplos
import { readFileSync, existsSync } from "node:fs";
import { MODELOS } from "../a3/mutaciones.ts";
import { casiAlineados, proponerAlinear, textoGrupo } from "../../src/editor/alinear.ts";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";

const casos: [string, ModeloFisico][] = MODELOS.map((m) => [m.nombre, m.f()]);
for (const f of ["ejemplos/muestrario/proyecto.json", "ejemplos/vivienda/proyecto.json", "ejemplos/Proyectos/vivienda.json", ...process.argv.slice(2)]) {
  if (!existsSync(f)) continue;
  const r = leerProyecto(readFileSync(f, "utf8"));
  if (r.valido) casos.push([f, r.proyecto.modelo]);
  else console.log(f, "no válido");
}
for (const [n, m] of casos) {
  const t0 = performance.now();
  const g = casiAlineados(m);
  const t1 = performance.now();
  const p = proponerAlinear(m);
  console.log(`${n}: ${g.length} grupos (${(t1 - t0).toFixed(0)} ms); mueve ${p.movimientos.length}, quedan ${p.quedan}`);
  for (const x of g.slice(0, 4)) console.log("   ", textoGrupo(x));
}
