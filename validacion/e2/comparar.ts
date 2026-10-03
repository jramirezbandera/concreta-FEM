/**
 * Comparación de E2 con sus oráculos (PyNite y OpenSeesPy), compartida por el test
 * (src/motor/oraculos-e2.test.ts) y el resumen del informe (resumen.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DiagramasBarras } from "../../src/motor/barras.ts";
import type { ModeloAnalitico, ResultadoCaso } from "../../src/motor/modelo.ts";
import { errorPorGrupos } from "../../src/pruebas/comparar.ts";

export const fixture = (f: string) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "src", "motor", "__fixtures__", f), "utf8"));

const conApoyo = (m: ModeloAnalitico) => [...new Set((m.apoyos ?? []).map((a) => a.nudo))];

/** Peor error de esfuerzos por grupos (fuerzas N, Vy, Vz; momentos T, My, Mz) relativo al máximo del grupo. */
export function errorEsfuerzos(nuestros: number[][], ref: number[][]): number {
  let peor = 0;
  for (const g of [[0, 1, 2], [3, 4, 5]]) {
    let dif = 0;
    let esc = 0;
    nuestros.forEach((fila, k) => {
      for (const c of g) {
        dif = Math.max(dif, Math.abs(fila[c]! - ref[k]![c]!));
        esc = Math.max(esc, Math.abs(ref[k]![c]!));
      }
    });
    peor = Math.max(peor, esc > 0 ? dif / esc : dif);
  }
  return peor;
}

/** Errores de un modelo frente a PyNite: [u, reacciones, esfuerzos]. */
export function erroresPynite(nombre: string, modelo: ModeloAnalitico, casos: ResultadoCaso[]): number[] {
  const ref = fixture("pynite-e2.json");
  const fr: number[] = ref.fracciones;
  const diag = new DiagramasBarras(modelo);
  let eu = 0;
  let er = 0;
  let ee = 0;
  casos.forEach((c, k) => {
    const r = ref.modelos[nombre][c.id];
    eu = Math.max(eu, errorPorGrupos(c.u, r.u));
    er = Math.max(er, errorPorGrupos(c.reacciones, r.reacciones, conApoyo(modelo)));
    const nuestros: number[][] = [];
    const suyos: number[][] = [];
    modelo.barras!.forEach((_, b) => {
      const d = diag.diagrama(b, k, c);
      fr.forEach((f, s) => {
        nuestros.push(d.esfuerzosEn(f * d.L));
        suyos.push((r.esfuerzos[b][s] as number[]).map((v) => -v));
      });
    });
    ee = Math.max(ee, errorEsfuerzos(nuestros, suyos));
  });
  return [eu, er, ee];
}

/** Errores de un modelo frente a OpenSees (una variante): [u, reacciones, esfuerzos de los trozos]. */
export function erroresOpenSees(nombre: string, variante: string, modelo: ModeloAnalitico, casos: ResultadoCaso[]): number[] {
  const ref = fixture("opensees-e2.json").modelos[nombre][variante];
  const diag = new DiagramasBarras(modelo);
  let eu = 0;
  let er = 0;
  let ee = 0;
  casos.forEach((c, k) => {
    const r = ref.casos[c.id];
    eu = Math.max(eu, errorPorGrupos(c.u, r.u));
    const excluidos = new Set<number>(ref.sinReaccion);
    er = Math.max(er, errorPorGrupos(c.reacciones, r.reacciones, conApoyo(modelo).filter((v) => !excluidos.has(v))));
    const nuestros: number[][] = [];
    const suyos: number[][] = [];
    const diagramas = modelo.barras!.map((_, b) => diag.diagrama(b, k, c));
    for (const t of ref.trozos as { barra: number; x0: number; x1: number }[]) {
      const f = r.fuerzasTrozos[ref.trozos.indexOf(t)] as number[];
      const d = diagramas[t.barra]!;
      // fuerzas de extremo sobre el trozo (OpenSees localForce) → esfuerzos con el convenio del motor
      nuestros.push(d.esfuerzosEn(t.x0, 1), d.esfuerzosEn(t.x1, -1));
      suyos.push([-f[0]!, -f[1]!, -f[2]!, -f[3]!, f[4]!, -f[5]!], [f[6]!, f[7]!, f[8]!, f[9]!, -f[10]!, f[11]!]);
    }
    ee = Math.max(ee, errorEsfuerzos(nuestros, suyos));
  });
  return [eu, er, ee];
}
