/**
 * Banco del compilador (criterio 8 de C4): el edificio objetivo con reticular y ábacos (H52 V2) y con
 * unidireccional (V3) (`modelos.ts`). Mide cada paso de la compilación y el cálculo con el núcleo,
 * comprueba que la huella no cambia entre repeticiones y da el tamaño frente a D9.
 *
 *   node validacion/c4/banco.ts > validacion/c4/out_banco.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { LIMITES } from "../../src/worker/limites.ts";
import { edificioReticular, edificioUnidireccional } from "./modelos.ts";

function banco(nombre: string, f: ModeloFisico) {
  console.log(`${nombre}: ${f.pilares!.length} pilares, ${f.plantas.length - 1} plantas, ${f.vigas!.length} vigas, ${(f.losas ?? []).length} losas, ${(f.panos ?? []).length} paños, ${f.cargas!.length} cargas`);
  const huellas = new Set<string>();
  const tiempos: number[] = [];
  let r = compilar(f);
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    r = compilar(f);
    tiempos.push(performance.now() - t0);
    huellas.add(r.huella);
  }
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  tiempos.sort((a, b) => a - b);
  const e = r.estadisticas;
  console.log(`  compilación: ${e.nudos} nudos, ${e.barras} barras (${e.forjados.viguetas} viguetas), ${e.laminas} láminas (${e.forjados.laminasAbaco} de ábacos), ${e.diafragmas} diafragmas, ${e.huellas} huellas; jacobiano mínimo ${e.malla.jacobianoMin.toFixed(3)} (${e.malla.bajos} bajo el umbral)`);
  console.log(`  diagnósticos: ${r.diagnosticos.length} (${[...new Set(r.diagnosticos.map((d) => d.codigo))].join(", ")})`);
  console.log(`  mediana de 3: ${tiempos[1]!.toFixed(0)} ms (mín ${tiempos[0]!.toFixed(0)}, máx ${tiempos[2]!.toFixed(0)}); huellas distintas: ${huellas.size}`);
  console.log(`  por paso (última): ${Object.entries(e.tiempos).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", ")} ms`);
  console.log(`  sin pérdidas: fuerzas ${e.sinPerdidas.fuerzas.toExponential(1)}, momentos ${e.sinPerdidas.momentos.toExponential(1)}`);
  const t0 = performance.now();
  const c = calcular(r.modelo);
  const tc = performance.now() - t0;
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const eq = Math.max(...c.casos.map((k) => Math.max(k.equilibrio.fuerzas, k.equilibrio.momentos)));
  console.log(`  cálculo con el núcleo: ${tc.toFixed(0)} ms, ${c.estadisticas.ecuaciones} ecuaciones (${c.estadisticas.gdl} GDL), equilibrio ≤ ${eq.toExponential(1)}`);
  const perfil = (Object.entries(LIMITES) as [string, { ecuaciones: number }][]).filter(([, l]) => c.estadisticas.ecuaciones <= l.ecuaciones).map(([k]) => k);
  console.log(`  compilación / cálculo: ${((100 * tiempos[1]!) / tc).toFixed(0)} %; tamaño: ${e.nudos} nudos (D9 estimaba ≈ 50 000) y ${c.estadisticas.ecuaciones} ecuaciones, dentro de los perfiles ${perfil.join(", ") || "ninguno"}`);
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  banco("V2, reticular 30+5 con ábacos de 2,5 m", edificioReticular());
  banco("V3, unidireccional con viguetas cada 0,70 m", edificioUnidireccional());
}
