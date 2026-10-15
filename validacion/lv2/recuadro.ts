/**
 * Criterio 1 de la fase LV2 (`docs/fem3d/refinamiento-vigas.md`): el recuadro de CY-10
 * (`validacion/cy/borde.ts`) frente al emparrillado de CYPECAD, con h = 0,75, sin las esquinas (LV1)
 * y con cada plantilla de esquina. Pasa si el momento y el cortante de la viga en la cara del pilar
 * quedan a ≤ 5 % del emparrillado.
 *
 *   bun validacion/lv2/recuadro.ts > validacion/lv2/out_recuadro.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLANTILLA_ESQUINA } from "../../src/compilador/rejilla.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { cabecera, cype, fila, MEDIO_ANCHO as e, nuestro } from "../cy/borde.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const ref = cype({ f: 0.5, fPilar: 0.5 });
cabecera();
fila(ref, "Emparrillado de CYPECAD (barras)", ref);
fila(ref, "LV1 (sin esquinas), h = 0,75", await nuestro(-e, {}));
const defecto = { ...PLANTILLA_ESQUINA };
for (const [tipo, niveles] of [["tercios", 1], ["tercios", 2], ["graduada", 2], ["graduada", 3]] as const) {
  Object.assign(PLANTILLA_ESQUINA, { tipo, niveles });
  fila(ref, `LV2, ${tipo}, ${niveles} nivel${niveles > 1 ? "es" : ""}`, await nuestro(-e, { refinoEsquinas: true }));
}
Object.assign(PLANTILLA_ESQUINA, defecto);
