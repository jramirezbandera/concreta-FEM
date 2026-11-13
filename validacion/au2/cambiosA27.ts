/**
 * A2-7 (`docs/fem3d/auditoria-2.md` §3.2): qué cambia en la referencia congelada de C4 con el umbral
 * relativo de las cargas de superficie (antes, «A > 0» con el resto de redondeo de la intersección de
 * una zona con un paño que no toca, hasta 1e-15 m², que se repartía a sus viguetas como cargas nulas).
 * Por modelo y caso, frente al fixture: el número de cargas de barra y nodales, y la resultante
 * (fuerza y momento respecto al origen), que tiene que ser la misma.
 * Uso: bun validacion/au2/cambiosA27.ts > validacion/au2/out_cambiosA27.txt (antes de regenerar el fixture)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resultanteAnalitica } from "../../src/compilador/cargas.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { MODELOS_CONGELADOS_C4 } from "../c4/congelar.ts";

const antes = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-c4.json"), "utf8")) as Record<string, { modelo: ModeloAnalitico }>;
let cambian = 0;
for (const [k, f] of Object.entries(MODELOS_CONGELADOS_C4)) {
  const m = f();
  const r = compilar(m.fisico, m.opciones);
  const a = antes[k]!.modelo;
  if (!r.valido) {
    console.log(`${k}: no compila`);
    continue;
  }
  const lineas: string[] = [];
  let dRes = 0;
  r.modelo.casos.forEach((c, i) => {
    const ca = a.casos[i]!;
    const [nb0, nb1] = [ca.barras?.length ?? 0, c.barras?.length ?? 0];
    const [nn0, nn1] = [ca.nodales?.length ?? 0, c.nodales?.length ?? 0];
    const R0 = resultanteAnalitica(a, i, [0, 0, 0]);
    const R1 = resultanteAnalitica(r.modelo, i, [0, 0, 0]);
    const esc = Math.max(1, ...R0.F.map(Math.abs), ...R0.M.map(Math.abs));
    const d = Math.max(...R0.F.map((v, j) => Math.abs(v - R1.F[j]!)), ...R0.M.map((v, j) => Math.abs(v - R1.M[j]!))) / esc;
    dRes = Math.max(dRes, d);
    if (nb0 !== nb1 || nn0 !== nn1) lineas.push(`  caso ${c.id}: cargas de barra ${nb0} → ${nb1}, nodales ${nn0} → ${nn1}; resultante, diferencia relativa ${d.toExponential(1)}`);
  });
  if (lineas.length) cambian++;
  console.log(`${k}: ${lineas.length ? "cambia" : "igual"} (resultantes a ${dRes.toExponential(1)})`);
  for (const l of lineas) console.log(l);
}
console.log(`\nCambian ${cambian} de ${Object.keys(MODELOS_CONGELADOS_C4).length} modelos, sólo en el número de cargas.`);
