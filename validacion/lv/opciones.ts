/**
 * Criterio 1 de la fase LV (`docs/fem3d/union-losa-viga.md`): con `unionLosaViga: "eje"`, el
 * compilador da lo mismo que antes de la fase, bit a bit. Para cada modelo (los congelados de C1–C5
 * y F, los de las huellas de C2, los edificios objetivo y los proyectos de ejemplo y de A2), el
 * sha256 del modelo analítico, del mapeo y de los códigos de los diagnósticos. Se ejecuta en un
 * worktree en el commit anterior a la fase (sin argumento: allí la opción no existe) y aquí con
 * `eje`, y se comparan las dos salidas:
 *
 *   bun validacion/lv/opciones.ts > antes.txt            (en el worktree del commit anterior)
 *   bun validacion/lv/opciones.ts eje > ahora.txt        (aquí)
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { MODELOS_CONGELADOS_C1 } from "../c1/congelar.ts";
import { MODELOS_CONGELADOS_C2 } from "../c2/congelar.ts";
import { losaPlanaFisica } from "../c2/losaPlana.ts";
import { edificioObjetivoLosas, reticulaEnrasada } from "../c2/modelos.ts";
import { MODELOS_CONGELADOS_C3 } from "../c3/congelar.ts";
import { MODELOS_CONGELADOS_C4 } from "../c4/congelar.ts";
import { edificioReticular } from "../c4/modelos.ts";
import { MODELOS_CONGELADOS_C5 } from "../c5/congelar.ts";
import { MODELOS_CONGELADOS_F } from "../f/congelar.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conForjadosAleatorios } from "../../src/pruebas/forjadosAleatorios.ts";
import { conLosasAleatorias } from "../../src/pruebas/losasAleatorias.ts";

const extra: OpcionesCompilacion = process.argv[2] === "eje" ? ({ unionLosaViga: "eje" } as OpcionesCompilacion) : {};
const raiz = join(import.meta.dirname, "..", "..");
const proyecto = (ruta: string) => {
  const p = JSON.parse(readFileSync(join(raiz, ruta), "utf8")) as { modelo: ModeloFisico; opciones?: OpcionesCompilacion };
  return { fisico: p.modelo, opciones: p.opciones ?? {} };
};
type Fuente = () => { fisico: ModeloFisico; opciones?: OpcionesCompilacion };
const modelos: (readonly [string, Fuente])[] = [
  ...Object.entries(MODELOS_CONGELADOS_C1).map(([n, f]) => [`c1 ${n}`, f] as const),
  ...Object.entries(MODELOS_CONGELADOS_C2).map(([n, f]) => [`c2 ${n}`, f] as const),
  ...Object.entries(MODELOS_CONGELADOS_C3).map(([n, f]) => [`c3 ${n}`, f] as const),
  ...Object.entries(MODELOS_CONGELADOS_C4).map(([n, f]) => [`c4 ${n}`, f] as const),
  ...Object.entries(MODELOS_CONGELADOS_C5).map(([n, f]) => [`c5 ${n}`, f] as const),
  ...Object.entries(MODELOS_CONGELADOS_F).map(([n, f]) => [`f ${n}`, f] as const),
  ["losa plana de H25", () => ({ fisico: losaPlanaFisica() })] as const,
  ...[1, 2, 3, 5, 8, 11].flatMap((s) => (["x", "azar"] as const).map((e) => [`aleatorio ${s} con losas, eje 1 ${e}`, () => ({ fisico: conLosasAleatorias(fisicoAleatorio(s), s, { eje1: e }) })] as const)),
  ...[1, 2, 3, 4, 5, 6].flatMap((s) => ([undefined, "unidireccional", "reticular"] as const).map((t) => [`aleatorio ${s} con forjados ${t ?? "mixtos"}`, () => ({ fisico: conForjadosAleatorios(fisicoAleatorio(s), s, t ? { tipo: t } : {}) })] as const)),
  ["edificio objetivo con losas (2 plantas)", () => ({ fisico: edificioObjetivoLosas(2) })] as const,
  ["retícula enrasada (2 plantas)", () => ({ fisico: reticulaEnrasada(2) })],
  ["edificio reticular 1×3×3", () => ({ fisico: edificioReticular(1, 3, 3) })],
  ["muestrario", () => proyecto("ejemplos/muestrario/proyecto.json")],
  ["vivienda", () => proyecto("ejemplos/vivienda/proyecto.json")],
  ["a2 1022", () => proyecto("validacion/a2/agente/1022/proyecto.json")],
  ["a2 nucleo", () => proyecto("validacion/a2/agente/nucleo/proyecto.json")],
  ["a2 edificio", () => proyecto("validacion/a2/agente/edificio/proyecto.json")],
];
const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);
for (const [nombre, f] of modelos) {
  const { fisico, opciones } = f();
  const r = compilar(fisico, { ...opciones, ...extra });
  const diag = r.diagnosticos.map((d) => `${d.severidad}:${d.codigo}`).join(",");
  console.log(`${nombre.padEnd(60)} ${r.valido ? `${sha(r.modelo)} ${sha(r.mapeo)}` : "no compila"} ${sha(diag)}`);
}
