/**
 * Referencia congelada de C3 (regla de oro 1): para cada modelo físico con muros, el modelo
 * analítico que da el compilador (malla incluida), su mapeo y los resultados completos de todos
 * los casos (desplazamientos, reacciones y esfuerzos de barras y láminas):
 * - ETABS 15c (3 plantas, dinteles de 60 in) como un muro con un hueco por planta, h = 20 in;
 * - ETABS 15f reducido a 1 planta: alma y tres alas, dos en sus extremos y una en T, h = 20 in;
 * - el muro de sótano con empuje hidrostático (cargas con un valor por nudo), h = 0,75;
 * - la viga en el plano de un muro con sus barras auxiliares (C3-e), h = 0,75;
 * - un modelo aleatorio con losas y muros (semilla 3): núcleo con puertas, muro de sótano con
 *   empuje, muro apeado sobre una viga y vigas que acaban en el núcleo, h = 1,25, con la
 *   triangulación sola (`rejilla: false`), como se congeló en C3;
 * - la retícula con la losa enrasada y un núcleo de muros (`reticulaConNucleo`), h = 1: la rejilla
 *   alineada de H52 con plantillas de pilar junto a los muros.
 * Los números se guardan con 13 cifras significativas, como en C2. El test
 * (src/compilador/congelado-c3.test.ts) los recompila y recalcula con los dos solvers.
 *
 * Sólo se regenera a sabiendas (un cambio validado aparte, o un cambio de los generadores):
 *   bun validacion/c3/congelar.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../../src/pruebas/losasAleatorias.ts";
import { conMurosAleatorios } from "../../src/pruebas/murosAleatorios.ts";
import type { ModeloCongelado } from "../c1/congelar.ts";
import { referenciaC2 } from "../c2/congelar.ts";
import { IN } from "../e6/csi.ts";
import { murosEtabs15 } from "../e6/etabs15.ts";
import { fisicoEtabs } from "./etabs15.ts";
import { reticulaConNucleo } from "./modelos.ts";
import { sotanoFisico, vigaMuroFisico } from "./oraculos.ts";

const etabs = (id: string) => fisicoEtabs(murosEtabs15().find((m) => m.id === id)!);

export const MODELOS_CONGELADOS_C3: Record<string, () => ModeloCongelado> = {
  "etabs-15c-3-60": () => ({ fisico: etabs("15c-3-60"), opciones: { tamanoMalla: 20 * IN } }),
  "etabs-15f-1": () => ({ fisico: fisicoEtabs({ ...murosEtabs15().find((m) => m.id === "15f-3")!, plantas: 1 }), opciones: { tamanoMalla: 20 * IN } }),
  "sotano-empuje": () => ({ fisico: sotanoFisico(), opciones: { modificadores: {} } }),
  "viga-en-muro": () => ({ fisico: vigaMuroFisico(), opciones: { modificadores: {} } }),
  "aleatorio-3-muros": () => ({ fisico: conMurosAleatorios(conLosasAleatorias(fisicoAleatorio(3), 3), 3), opciones: { tamanoMalla: 1.25, rejilla: false } }),
  "reticula-nucleo": () => ({ fisico: reticulaConNucleo(), opciones: { tamanoMalla: 1 } }),
};

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida = Object.fromEntries(Object.entries(MODELOS_CONGELADOS_C3).map(([k, f]) => [k, referenciaC2(f)]));
  const ruta = join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-c3.json");
  writeFileSync(ruta, JSON.stringify(salida, (_k, v: unknown) => (typeof v === "number" && v !== 0 && Number.isFinite(v) ? Number(v.toPrecision(13)) : v)));
  console.log(`Escrito ${ruta}`);
}
