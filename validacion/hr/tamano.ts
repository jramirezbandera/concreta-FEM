/**
 * Fase HR, criterio 7 (`docs/fem3d/huella-rigida.md`): las ecuaciones de los tres edificios objetivo
 * de 7 plantas (con vigas, reticular con vigas y losa plana) con la huella rígida de todos los pilares
 * y sin las cotas de F2-e y de la plantilla de esquina, frente a lo de antes de la fase (`CLAUDE.md`:
 * 153 132, 204 288 y 192 066).
 *
 *   bun validacion/hr/tamano.ts > validacion/hr/out_tamano.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { contarRigidosFuera } from "../../src/pruebas/huellasRigidas.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { edificioReticular } from "../c4/modelos.ts";
import { conAcciones } from "../c5/modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const sinVigas = (f: ModeloFisico): ModeloFisico => ({ ...f, vigas: [], cargas: f.cargas!.filter((c) => c.tipo !== "viga") });
const MODELOS: [string, ModeloFisico, number][] = [
  ["edificio objetivo con vigas", conAcciones(edificioObjetivoLosas()), 153132],
  ["edificio reticular objetivo", conAcciones(edificioReticular()), 204288],
  ["edificio objetivo con losa plana", sinVigas(edificioObjetivoLosas()), 192066],
];
console.log("| Modelo | Nudos | Ecuaciones | Antes | Cambio | Esclavos fuera | Jacobiano mín. | Avisos de malla |");
console.log("|---|---|---|---|---|---|---|---|");
for (const [nombre, f, antes] of MODELOS) {
  process.stderr.write(`${nombre}\n`);
  const r = compilar(f);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const c = calcular(r.modelo);
  const ecs = c.valido ? c.estadisticas.ecuaciones : NaN;
  const fuera = contarRigidosFuera(f).total;
  const avisos = [...new Set(r.diagnosticos.filter((d) => d.codigo.startsWith("malla/")).map((d) => d.codigo))];
  console.log(`| ${nombre} | ${r.modelo.nudos.length} | ${ecs} | ${antes} | ${((100 * (ecs - antes)) / antes).toFixed(2)} % | ${fuera} | ${r.estadisticas.malla.jacobianoMin.toFixed(3)} | ${avisos.join(", ") || "—"} |`);
}
