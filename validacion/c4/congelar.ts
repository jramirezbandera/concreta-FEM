/**
 * Referencia congelada de C4 (regla de oro 1): para cada modelo físico con forjados, el modelo
 * analítico que da el compilador (viguetas, su reparto y la malla de los reticulares), su mapeo y
 * los resultados completos de todos los casos (desplazamientos, reacciones y esfuerzos de barras y
 * láminas):
 * - el paño entre cuatro vigas girado 30° (viguetas oblicuas), de `mano.ts`;
 * - dos vanos y un voladizo (viguetas continuas y torsión en el voladizo), de `mano.ts`;
 * - el paño con un hueco sin brochales (viguetas en voladizo y franjas con transporte), de `mano.ts`;
 * - un modelo aleatorio unidireccional (semilla 7: paños oblicuos, huecos y un balcón);
 * - un modelo aleatorio reticular (semilla 6: ábacos en todos los pilares, los de fachada fuera de
 *   la losa), h = 1,25;
 * - un modelo aleatorio mixto (semilla 5), h = 1,25.
 * Con las opciones por defecto (C1-a, D4), salvo el tamaño de malla. Los números se guardan con 13
 * cifras significativas, como en C2 y C3. El test (src/compilador/congelado-c4.test.ts) los
 * recompila y recalcula con los dos solvers.
 *
 * Sólo se regenera a sabiendas (un cambio validado aparte, o un cambio de los generadores):
 *   bun validacion/c4/congelar.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conForjadosAleatorios } from "../../src/pruebas/forjadosAleatorios.ts";
import type { ModeloCongelado } from "../c1/congelar.ts";
import { referenciaC2 } from "../c2/congelar.ts";
import { casosManoC4 } from "./mano.ts";

const mano = (i: number) => casosManoC4()[i]!.fisico;

export const MODELOS_CONGELADOS_C4: Record<string, () => ModeloCongelado> = {
  "pano-oblicuo": () => ({ fisico: mano(1), opciones: {} }),
  "dos-vanos-voladizo": () => ({ fisico: mano(2), opciones: {} }),
  "pano-hueco": () => ({ fisico: mano(4), opciones: {} }),
  "aleatorio-7-unidireccional": () => ({ fisico: conForjadosAleatorios(fisicoAleatorio(7), 7, { tipo: "unidireccional" }), opciones: {} }),
  "aleatorio-6-reticular": () => ({ fisico: conForjadosAleatorios(fisicoAleatorio(6), 6, { tipo: "reticular" }), opciones: { tamanoMalla: 1.25 } }),
  "aleatorio-5-mixto": () => ({ fisico: conForjadosAleatorios(fisicoAleatorio(5), 5), opciones: { tamanoMalla: 1.25 } }),
};

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida = Object.fromEntries(Object.entries(MODELOS_CONGELADOS_C4).map(([k, f]) => [k, referenciaC2(f)]));
  const ruta = join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-c4.json");
  writeFileSync(ruta, JSON.stringify(salida, (_k, v: unknown) => (typeof v === "number" && v !== 0 && Number.isFinite(v) ? Number(v.toPrecision(13)) : v)));
  console.log(`Escrito ${ruta}`);
}
