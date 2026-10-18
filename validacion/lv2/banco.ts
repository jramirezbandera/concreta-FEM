/**
 * Criterios 5 y 10 de la fase LV2 (`docs/fem3d/refinamiento-vigas.md`): el tamaño y el tiempo de los
 * edificios objetivo de 7 plantas con vigas (C2) y reticular con vigas, con las esquinas (LV2) y sin
 * ellas (LV1): nudos, láminas, plantillas (de pilar y de esquina), calidad, ecuaciones y tiempos.
 *
 *   bun validacion/lv2/banco.ts > validacion/lv2/out_banco.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { PLANTILLA_ESQUINA } from "../../src/compilador/rejilla.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { edificioReticular } from "../c4/modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const plantas = Number(process.argv[2] ?? 7);
const casos: [string, ModeloFisico][] = [
  [`edificio objetivo con vigas (${plantas} plantas)`, edificioObjetivoLosas(plantas)],
  [`reticular objetivo con vigas (${plantas} plantas)`, edificioReticular(plantas)],
];
for (const [nombre, f] of casos) {
  console.log(`## ${nombre}`);
  // LV2 con la plantilla de 3 niveles en todos los cruces, y con 2 en los cruces sin pilar (§15)
  for (const [n, op, sinPilar] of [["LV1", {}], ["LV2", { refinoEsquinas: true }], ["LV2, 2 niv. sin pilar", { refinoEsquinas: true }, 2]] as [string, OpcionesCompilacion, number?][]) {
    PLANTILLA_ESQUINA.nivelesSinPilar = sinPilar;
    const t0 = performance.now();
    const r = compilar(f, op);
    const ms = performance.now() - t0;
    delete PLANTILLA_ESQUINA.nivelesSinPilar;
    if (!r.valido) {
      console.log(`  ${n}: NO compila: ${r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo).join(", ")}`);
      continue;
    }
    const e = r.estadisticas;
    const t1 = performance.now();
    const c = calcular(r.modelo);
    const tc = performance.now() - t1;
    const avisos = [...new Set(r.diagnosticos.filter((d) => d.codigo.startsWith("malla/")).map((d) => d.codigo))].join(", ");
    console.log(
      `  ${n} nudos ${e.nudos}, láminas ${e.laminas} (${e.malla.laminasRejilla} en la rejilla, ${e.malla.plantillas} plantillas), jacobiano mínimo ${e.malla.jacobianoMin.toFixed(3)} (${e.malla.bajos} bajos), compilación ${Math.round(ms)} ms; ${c.valido ? `cálculo ${Math.round(tc)} ms, ${c.estadisticas.ecuaciones} ecuaciones` : `cálculo NO válido: ${c.diagnosticos.map((d) => d.codigo).join(", ")}`}${avisos ? `; ${avisos}` : ""}`,
    );
  }
}
