/**
 * Valores medidos de los criterios de E1 para el informe (docs/fem3d/fase-e1.md): el error real
 * frente a cada oráculo y en cada prueba metamórfica, no sólo «por debajo de la tolerancia».
 * Uso: bun validacion/e1/resumen.ts → out_resumen.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../src/motor/calcular.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos, errorPorGrupos } from "../../src/pruebas/comparar.ts";
import { edificio, type OpcionesEdificio } from "../../src/pruebas/edificio.ts";
import { girarModelo, girarVector6, matrizGiro, permutacion, renumerarModelo } from "../../src/pruebas/transformar.ts";
import { MODELOS_ORACULO } from "./modelos-oraculo.ts";

const raiz = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const e = (x: number) => x.toExponential(1);

// 1. Oráculo OpenSees
const os = JSON.parse(readFileSync(join(raiz, "src", "motor", "__fixtures__", "opensees-e1.json"), "utf8")).modelos;
console.log("## OpenSeesPy (peor de u y reacciones; faer)");
for (const [nombre, f] of Object.entries(MODELOS_ORACULO)) {
  const modelo = f();
  const conR = [...new Set([...(modelo.apoyos ?? []).map((a) => a.nudo), ...(modelo.muelles ?? []).filter((m) => m.nudos.length === 1).map((m) => m.nudos[0])])];
  const casos = casosValidos(calcular(modelo));
  let T = 0;
  let L = 0;
  let TL = 0;
  let eq = 0;
  for (const c of casos) {
    const ref = os[nombre][c.id];
    T = Math.max(T, errorPorGrupos(c.u, ref.Transformation.u), errorPorGrupos(c.reacciones, ref.Transformation.reacciones, conR));
    L = Math.max(L, errorPorGrupos(c.u, ref.Lagrange.u), errorPorGrupos(c.reacciones, ref.Lagrange.reacciones, conR));
    TL = Math.max(TL, errorPorGrupos(ref.Transformation.u, ref.Lagrange.u));
    eq = Math.max(eq, c.equilibrio.fuerzas, c.equilibrio.momentos);
  }
  console.log(`${nombre}: Transformation ${e(T)} · Lagrange ${e(L)} · (OpenSees T frente a L: ${e(TL)}) · equilibrio ${e(eq)}`);
}

// 4. Metamórficas
const BASE: OpcionesEdificio = { vanosX: 2, vanosY: 2, luzX: 5, luzY: 4, plantas: 2, altura: 3, malla: 1, huella: 1, muro: true, vigas: true };
const modelos: [string, ModeloAnalitico, number[]][] = [
  ["con diafragma", edificio({ ...BASE, diafragma: true }).modelo, matrizGiro([0, 0, 1], 0.7)],
  ["sin diafragma, con muelles", edificio({ ...BASE, muelles: true }).modelo, matrizGiro([0.3, -0.5, 0.8], 1.1)],
];
console.log("\n## Metamórficas (peor de u y reacciones)");
for (const [nombre, m, R] of modelos) {
  const a = casosValidos(calcular(m));
  const g = casosValidos(calcular(girarModelo(m, R, [12.3, -4.5, 2])));
  let giro = 0;
  for (let k = 0; k < a.length; k++) giro = Math.max(giro, errorPorGrupos(g[k]!.u, girarVector6(R, a[k]!.u)), errorPorGrupos(g[k]!.reacciones, girarVector6(R, a[k]!.reacciones)));
  const nuevo = permutacion(m.nudos.length);
  const b = casosValidos(calcular(renumerarModelo(m, nuevo)));
  let ren = 0;
  for (let k = 0; k < a.length; k++) {
    const ua = new Float64Array(a[k]!.u.length);
    nuevo.forEach((nv, v) => ua.set(a[k]!.u.subarray(6 * v, 6 * v + 6), 6 * nv));
    ren = Math.max(ren, errorPorGrupos(b[k]!.u, ua));
  }
  const p = casosValidos(calcular(m, { solver: "perfil" }));
  let dif = 0;
  for (let k = 0; k < a.length; k++) dif = Math.max(dif, errorPorGrupos(a[k]!.u, p[k]!.u), errorPorGrupos(a[k]!.reacciones, p[k]!.reacciones));
  const eq = Math.max(...a.map((c) => Math.max(c.equilibrio.fuerzas, c.equilibrio.momentos)));
  const om = Math.max(...a.map((c) => c.residuo));
  console.log(`${nombre}: giro ${e(giro)} · renumeración ${e(ren)} · faer/perfil ${e(dif)} · equilibrio ${e(eq)} · ω ${e(om)}`);
}
