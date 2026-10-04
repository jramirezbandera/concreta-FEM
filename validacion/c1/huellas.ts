/**
 * Huellas de un juego fijo de modelos (criterio 6 de C1): la de compilación (sobre el modelo físico)
 * y la del modelo analítico con 12 cifras significativas. El test `src/compilador/huella.test.ts`
 * ejecuta este script con Bun (JavaScriptCore) y compara su salida con lo que calcula Node (V8).
 *
 * El 1-022 se lee de `fisico-1022.json` (generado por Node con `fisico1022()`): construido en cada
 * motor no sería el mismo dato, porque `0.0254 ** 4` ya difiere en 1 ulp entre V8 y JSC.
 *
 *   bun validacion/c1/huellas.ts      → JSON por la salida estándar
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { huellaDe } from "../../src/compilador/huella.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";

export interface Huellas {
  nombre: string;
  compilacion: string;
  analitica: string;
}

export function huellas(): Huellas[] {
  const f1022 = JSON.parse(readFileSync(join(import.meta.dirname, "fisico-1022.json"), "utf8")) as ModeloFisico;
  const modelos = [{ nombre: "1-022", f: f1022 }, ...[1, 2, 5, 13, 21, 29].flatMap((s) => [true, false].map((d) => ({ nombre: `aleatorio ${s}${d ? "" : " sin diafragma"}`, f: fisicoAleatorio(s, { diafragma: d }) })))];
  return modelos.map(({ nombre, f }) => {
    const r = compilar(f);
    if (!r.valido) throw new Error(`${nombre}: ${r.diagnosticos.map((d) => d.mensaje).join("; ")}`);
    return { nombre, compilacion: r.huella, analitica: huellaDe(r.modelo, 12) };
  });
}

if (import.meta.main) console.log(JSON.stringify(huellas()));
