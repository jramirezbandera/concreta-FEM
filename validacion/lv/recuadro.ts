/**
 * Criterio 2 de la fase LV (`docs/fem3d/union-losa-viga.md`): el recuadro de CY-10
 * (`validacion/cy/borde.ts`), de 6 × 6 intereje de 25+5 con vigas de 30×30 en los cuatro lados y
 * pilares de 30×30 en las esquinas, frente al emparrillado de CYPECAD, con la unión de la losa con
 * las vigas de la fase LV (por defecto) y con la de antes («eje»), a varios tamaños de malla.
 *
 * Para medir sólo la unión, el emparrillado y la lámina con la topología de CYPE hecha a mano llevan
 * los nudos de dimensión finita con el mismo factor de zona rígida que el compilador (C1-a: la viga,
 * flexible desde f·e dentro del pilar; el pilar, rígido en su cabeza a lo largo de f veces el canto).
 * Al final, el emparrillado de CY-10 (la viga flexible desde la cara y el pilar sin zona rígida).
 *
 *   bun validacion/lv/recuadro.ts > validacion/lv/out_recuadro.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { cabecera, cype, fila, laminasCype, MEDIO_ANCHO as e, nuestro } from "../cy/borde.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const MALLAS = [0.75, 0.5, 0.25, 0.12, 0.1];
for (const f of [0.5, 1]) {
  const ref = cype({ f, fPilar: f });
  console.log(`\n## Factor de zona rígida ${f}${f === 0.5 ? " (por defecto)" : ""}, en la referencia y en el compilador\n`);
  cabecera();
  fila(ref, "Emparrillado de CYPECAD (barras)", ref);
  fila(ref, "Nuestra lámina, topología de CYPE a mano", laminasCype({ f, fPilar: f }));
  for (const union of ["cara", "eje"] as const) {
    console.log(`Unión ${union === "cara" ? "por las caras (fase LV, por defecto)" : "por el eje (antes)"}, la losa dibujada hasta el eje de las vigas:`);
    for (const h of MALLAS) fila(ref, `  malla ${h.toFixed(2)}`, await nuestro(-e, { unionLosaViga: union, tamanoMalla: h, factorZonaRigida: f }));
  }
  console.log("Unión por las caras, la losa dibujada hasta la cara exterior de las vigas:");
  fila(ref, "  malla 0.75", await nuestro(-2 * e, { factorZonaRigida: f }));
}

const ref = cype();
console.log("\n## Emparrillado de CY-10: la viga flexible desde la cara del pilar y el pilar sin zona rígida\n");
cabecera();
fila(ref, "Emparrillado de CYPECAD (barras)", ref);
fila(ref, "Nuestra lámina, topología de CYPE a mano", laminasCype());
for (const union of ["cara", "eje"] as const) for (const h of [0.75, 0.12]) fila(ref, `Unión por ${union === "cara" ? "las caras" : "el eje"}, malla ${h.toFixed(2)}`, await nuestro(-e, { unionLosaViga: union, tamanoMalla: h }));
