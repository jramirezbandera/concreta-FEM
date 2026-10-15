/**
 * Criterio 4 de CY (`docs/fem3d/hipotesis-cype.md`): la rigidez local efectiva de una barra con
 * empotramiento parcial es la interpolación de CYPECAD entre las matrices biempotrada y
 * empotrada-articulada, calculadas aparte con PyNite 3.2 (`oraculo_empotramiento.py`, Euler–Bernoulli).
 * Con los dos extremos, la interpolación bilineal entre las cuatro.
 *
 *   bun validacion/cy/empotramiento.ts > validacion/cy/out_empotramiento.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prepararBarra } from "../../src/motor/barras.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import { geometria } from "../../src/motor/geometria.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";

const o = JSON.parse(readFileSync(join(import.meta.dirname, "oraculo_empotramiento.json"), "utf8")) as Record<string, number> & Record<"biempotrada" | "articulada_i" | "articulada_j" | "articulada_ij", number[][]>;

function kEfectiva(empotramiento: { i?: number; j?: number }): Float64Array {
  const modelo: ModeloAnalitico = {
    nudos: [
      { id: "a", x: 0, y: 0, z: 0 },
      { id: "b", x: o.L, y: 0, z: 0 },
    ],
    barras: [{ id: "M", nudos: [0, 1], seccion: { E: o.E, G: o.G, A: o.A, Iy: o.Iy, Iz: o.Iz, J: o.J }, vz: [0, 0, 1], empotramiento }],
    apoyos: [],
    casos: [],
  };
  const diag = new Diagnosticos();
  const pb = prepararBarra(modelo.barras![0]!, 0, modelo, geometria(modelo), diag);
  if (!pb) throw new Error("barra no válida");
  return pb.kEfectiva;
}

let peor = 0;
for (const [ai, aj] of [
  [0.3, 1],
  [0.7, 1],
  [1, 0.3],
  [1, 0.05],
  [0.4, 0.6],
  [0, 0.5],
  [0.3, 0],
]) {
  const w = { biempotrada: ai! * aj!, articulada_i: (1 - ai!) * aj!, articulada_j: ai! * (1 - aj!), articulada_ij: (1 - ai!) * (1 - aj!) };
  const k = kEfectiva({ i: ai, j: aj });
  let escala = 0;
  let dif = 0;
  for (let a = 0; a < 12; a++)
    for (let b = 0; b < 12; b++) {
      const ref = (Object.keys(w) as (keyof typeof w)[]).reduce((s, n) => s + w[n] * o[n][a]![b]!, 0);
      escala = Math.max(escala, Math.abs(ref));
      dif = Math.max(dif, Math.abs(k[12 * a + b]! - ref));
    }
  peor = Math.max(peor, dif / escala);
  console.log(`α = (${ai}, ${aj}): max |K − K_PyNite| / max |K_PyNite| = ${(dif / escala).toExponential(2)}`);
}
console.log(`\nPeor: ${peor.toExponential(2)} (criterio ≤ 1e-12)`);
console.log(peor <= 1e-12 ? "Criterio 4: PASA" : "Criterio 4: NO PASA");
