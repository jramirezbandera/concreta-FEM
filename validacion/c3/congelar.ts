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
 * Fase LV: los modelos de antes llevan la unión de la losa con las vigas por el eje
 * (`unionLosaViga: "eje"`: los mismos bits que antes de la fase); los terminados en `-lv`, la de la
 * fase (por las caras, por defecto).
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
  "etabs-15c-3-60": () => ({ fisico: etabs("15c-3-60"), opciones: { franjas: false, tamanoMalla: 20 * IN, unionLosaViga: "eje", zonaRigidaBase: false, planoForjado: "medio" } }),
  "etabs-15f-1": () => ({ fisico: fisicoEtabs({ ...murosEtabs15().find((m) => m.id === "15f-3")!, plantas: 1 }), opciones: { franjas: false, tamanoMalla: 20 * IN, unionLosaViga: "eje", zonaRigidaBase: false, planoForjado: "medio" } }),
  "sotano-empuje": () => ({ fisico: sotanoFisico(), opciones: { franjas: false, modificadores: {}, unionLosaViga: "eje", zonaRigidaBase: false, planoForjado: "medio" } }),
  "viga-en-muro": () => ({ fisico: vigaMuroFisico(), opciones: { franjas: false, modificadores: {}, unionLosaViga: "eje", zonaRigidaBase: false, planoForjado: "medio" } }),
  "aleatorio-3-muros": () => ({ fisico: conMurosAleatorios(conLosasAleatorias(fisicoAleatorio(3), 3), 3), opciones: { franjas: false, tamanoMalla: 1.25, rejilla: false, unionLosaViga: "eje", zonaRigidaBase: false, planoForjado: "medio" } }),
  "reticula-nucleo": () => ({ fisico: reticulaConNucleo(), opciones: { franjas: false, tamanoMalla: 1, unionLosaViga: "eje", zonaRigidaBase: false, planoForjado: "medio" } }),
  // Fase LV: con la unión de la losa con las vigas por las caras, sin la malla de LV2 (la de LV1)
  "aleatorio-3-muros-lv": () => ({ fisico: conMurosAleatorios(conLosasAleatorias(fisicoAleatorio(3), 3), 3), opciones: { franjas: false, tamanoMalla: 1.25, rejilla: false, refinoEsquinas: false, zonaRigidaBase: false, planoForjado: "medio" } }),
  // Fase LV2: con la malla junto a las vigas (por defecto; sin rejilla, actúan las tiras y LV2-f)
  "aleatorio-3-muros-lv2": () => ({ fisico: conMurosAleatorios(conLosasAleatorias(fisicoAleatorio(3), 3), 3), opciones: { franjas: false, tamanoMalla: 1.25, rejilla: false, zonaRigidaBase: false, planoForjado: "medio" } }),
  // LV-d (compilador LVD1, 2026-10-20): la zona rígida también en la base de los tramos de pilar sobre un forjado (la de LVD1)
  "reticula-nucleo-lvd": () => ({ fisico: reticulaConNucleo(), opciones: { franjas: false, tamanoMalla: 1, planoForjado: "medio" } }),
  // RV-b (compilador RV1, 2026-10-20): los nudos del forjado en su cara superior (por defecto)
  "reticula-nucleo-rvb": () => ({ fisico: reticulaConNucleo(), opciones: { franjas: false, tamanoMalla: 1 } }),
};

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida = Object.fromEntries(Object.entries(MODELOS_CONGELADOS_C3).map(([k, f]) => [k, referenciaC2(f)]));
  const ruta = join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-c3.json");
  writeFileSync(ruta, JSON.stringify(salida, (_k, v: unknown) => (typeof v === "number" && v !== 0 && Number.isFinite(v) ? Number(v.toPrecision(13)) : v)));
  console.log(`Escrito ${ruta}`);
}
