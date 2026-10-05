/**
 * Resumen medido de los criterios 1, 3, 4 y 5 de C4 (los tests comprueban los umbrales; esto da los
 * valores para el informe):
 * 1. los paños a mano: errores de u, reacciones y esfuerzos de barra frente al modelo hecho a mano;
 * 3 y 5. la batería al azar: «sin pérdidas» y equilibrio peores, viguetas, láminas de ábacos y avisos;
 * 4. las metamórficas: errores de u y reacciones al trasladar, girar 90° y 37°, invertir el contorno
 *    y partir un paño.
 *
 *   bun validacion/c4/resumen.ts → validacion/c4/out_resumen.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, PanoUnidireccional } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { compararModelos } from "../../src/pruebas/compilador.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conForjadosAleatorios } from "../../src/pruebas/forjadosAleatorios.ts";
import { emparejarTodos, errorU, planos, relacionPlanoC2, valido } from "../../src/pruebas/metamorficasFisicas.ts";
import { casosManoC4 } from "./mano.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const L: string[] = [];
const e = (x: number) => x.toExponential(1);

L.push("Criterio 1, paños a mano frente a su modelo analítico hecho a mano (u, reacciones, esfuerzos de barra):");
for (const c of casosManoC4()) {
  const r = valido(compilar(c.fisico, c.opciones));
  const x = compararModelos(r.modelo, c.mano);
  L.push(`  ${c.nombre}: ${x.nudos} nudos, ${x.nBarras} barras; ${e(x.u)}, ${e(x.reacciones)}, ${e(x.barras)}`);
}

L.push("Criterios 3 y 5, batería de plantas al azar (12 semillas por tipo):");
for (const tipo of [undefined, "unidireccional", "reticular"] as const) {
  let [sp, eq, vig, lab, nudos] = [0, 0, 0, 0, 0];
  const avisos = new Map<string, number>();
  for (let s = 1; s <= 12; s++) {
    const r = valido(compilar(conForjadosAleatorios(fisicoAleatorio(s), s, tipo ? { tipo } : {})));
    sp = Math.max(sp, r.estadisticas.sinPerdidas.fuerzas, r.estadisticas.sinPerdidas.momentos);
    for (const k of casosValidos(calcular(r.modelo))) eq = Math.max(eq, k.equilibrio.fuerzas, k.equilibrio.momentos);
    vig += r.estadisticas.forjados.viguetas;
    lab += r.estadisticas.forjados.laminasAbaco;
    nudos += r.estadisticas.nudos;
    for (const d of r.diagnosticos) avisos.set(d.codigo, (avisos.get(d.codigo) ?? 0) + 1);
  }
  L.push(`  ${tipo ?? "mixtas"}: ${nudos} nudos, ${vig} viguetas, ${lab} láminas de ábacos; sin pérdidas ≤ ${e(sp)}, equilibrio ≤ ${e(eq)}; avisos: ${[...avisos].map(([k, n]) => `${k} ${n}`).join(", ")}`);
}

L.push("Criterio 4, metamórficas (5 semillas mixtas y unidireccionales):");
const SEMILLAS = [1, 3, 5, 7, 10];
for (const { nombre, t } of planos()) {
  let [u, re, misma] = [0, 0, true];
  for (const s of SEMILLAS) {
    const x = relacionPlanoC2(conForjadosAleatorios(fisicoAleatorio(s), s), t);
    misma &&= x.mismaMalla;
    u = Math.max(u, x.u);
    re = Math.max(re, x.reacciones);
  }
  L.push(`  ${nombre}: ${misma ? "las mismas viguetas y malla" : "OTRA MALLA"}; u ${e(u)}, reacciones ${e(re)}`);
}
const identidad = (q: readonly number[]): [number, number, number] => [q[0]!, q[1]!, q[2]!];
const mismos = (f: ModeloFisico, g: ModeloFisico) => {
  const [a, b] = [valido(compilar(f)), valido(compilar(g))];
  const pares = emparejarTodos(a.modelo, b.modelo, (q) => q, 1e-9);
  const [ra, rb] = [casosValidos(calcular(a.modelo)), casosValidos(calcular(b.modelo))];
  return Math.max(errorU(ra, rb, pares, identidad, "u"), errorU(ra, rb, pares, identidad, "reacciones"));
};
let inv = 0;
for (const s of SEMILLAS) {
  const f = conForjadosAleatorios(fisicoAleatorio(s), s, { tipo: "unidireccional" });
  const panos: PanoUnidireccional[] = f.panos!.map((p) => ({ ...p, contorno: [...p.contorno].reverse(), huecos: p.huecos?.map((h) => [...h].reverse()), direccion: p.direccion + 180 }));
  inv = Math.max(inv, mismos(f, { ...f, panos }));
}
L.push(`  invertir el contorno y girar la dirección 180°: ${e(inv)}`);
writeFileSync(join(import.meta.dirname, "out_resumen.txt"), L.join("\n") + "\n");
console.log(L.join("\n"));
