/**
 * CO2-j (docs/fem3d/comprobaciones.md §8.26): el momento mínimo en la cara de los apoyos con
 * continuidad (CE Anejo 19 §5.3.2.2(3): no menos de 0,65 veces el de empotramiento perfecto), frente
 * al que da el modelo en esa cara. Por proyecto: en cuántas caras manda el mínimo y por cuánto.
 *
 *   bun validacion/co/medirEmpotramiento.ts [proyecto.json…] > validacion/co/out_medirEmpotramiento.txt
 *
 * Sin proyectos, los ejemplos de la app que tienen vigas continuas y el pórtico de las pruebas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Proyecto } from "../../src/agente/proyecto.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { FRACCION_EMPOTRAMIENTO } from "../../src/comprobaciones/comprobar/vigas.ts";
import { demandasViga } from "../../src/comprobaciones/demandas/vigas.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { porticoVigas } from "./modelosVigas.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const f = (x: number, n = 1) => x.toFixed(n);

function medir(nombre: string, modelo: ModeloFisico) {
  const c = compilar(modelo);
  if (!c.valido) return console.log(`== ${nombre}: no compila`);
  const r = calcular(c.modelo);
  if (!r.valido) return console.log(`== ${nombre}: no calcula`);
  const q = new Consultas(modelo, c, r.casos, {}, r.modal);
  const filas: { donde: string; cara: number; minimo: number }[] = [];
  let vanos = 0;
  for (const v of modelo.vigas ?? []) {
    const d = demandasViga(q, v.id);
    if (!d.valido) continue;
    for (const va of d.valor.vanos) {
      vanos++;
      ([0, 1] as const).forEach((lado) => {
        const e = va.empotramiento[lado];
        if (!e) return;
        // El momento del modelo en esa cara: el menor de la zona de ese apoyo (su extremo es la cara)
        const cara = -va.zonas[lado ? 2 : 0]!.negativo.valor;
        filas.push({ donde: `${v.id}/${va.indice} en ${va.apoyos[lado]}`, cara, minimo: FRACCION_EMPOTRAMIENTO * -e.valor });
      });
    }
  }
  const mandan = filas.filter((x) => x.minimo > x.cara + 1e-9).sort((a, b) => b.minimo / Math.max(b.cara, 1e-9) - a.minimo / Math.max(a.cara, 1e-9));
  const cocientes = filas.map((x) => x.minimo / Math.max(x.cara, 1e-9)).sort((a, b) => a - b);
  const mediana = cocientes.length ? cocientes[Math.floor(cocientes.length / 2)]! : NaN;
  console.log(`== ${nombre}: ${vanos} vanos, ${filas.length} caras con continuidad; el mínimo manda en ${mandan.length}; 0,65·M emp / M cara: mediana ${f(mediana, 2)}, de ${f(cocientes[0] ?? NaN, 2)} a ${f(cocientes[cocientes.length - 1] ?? NaN, 2)}`);
  for (const x of mandan.slice(0, 8)) console.log(`   ${x.donde}: cara ${f(x.cara)} kN·m, mínimo ${f(x.minimo)} (×${f(x.minimo / Math.max(x.cara, 1e-9), 2)})`);
}

const args = process.argv.slice(2);
if (args.length) for (const a of args) medir(a, (JSON.parse(readFileSync(a, "utf8")) as Proyecto).modelo);
else {
  for (const n of ["nucleo", "ejemplo", "vivienda", "muestrario"]) medir(n, (JSON.parse(readFileSync(join(RAIZ, "ejemplos", "app", `${n}.json`), "utf8")) as Proyecto).modelo);
  medir("pórtico de las pruebas de las vigas", porticoVigas());
}
