/**
 * Banco del compilador (criterio 8 de C3): el edificio objetivo con losas, un núcleo de muros y un
 * muro de sótano perimetral (`modelos.ts`). Mide cada paso de la compilación y el cálculo con el
 * núcleo, comprueba que la huella no cambia entre repeticiones y da el tamaño.
 *
 *   node validacion/c3/banco.ts [h] > validacion/c3/out_banco.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivoMuros } from "./modelos.ts";

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const h = process.argv[2] ? Number(process.argv[2]) : undefined;
  const f = edificioObjetivoMuros();
  console.log(`Edificio objetivo con losas y muros: ${f.pilares!.length} pilares, ${f.plantas.length - 1} plantas, ${f.vigas!.length} vigas, ${f.losas!.length} losas, ${f.muros!.length} muros, ${f.cargas!.length} cargas; h = ${h ?? "por defecto"}`);
  const huellas = new Set<string>();
  const tiempos: number[] = [];
  let r = compilar(f, h ? { tamanoMalla: h } : {});
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    r = compilar(f, h ? { tamanoMalla: h } : {});
    tiempos.push(performance.now() - t0);
    huellas.add(r.huella);
  }
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  tiempos.sort((a, b) => a - b);
  const e = r.estadisticas;
  console.log(`Compilación: ${e.nudos} nudos, ${e.barras} barras (${e.muros.auxiliares} auxiliares), ${e.laminas} láminas (${e.laminasMuros} de muros), ${e.diafragmas} diafragmas, ${e.huellas} huellas; jacobiano mínimo ${e.malla.jacobianoMin.toFixed(3)} (${e.malla.bajos} bajo el umbral); aspecto de los muros ≤ ${e.muros.aspectoMax.toFixed(2)} (${e.muros.altos} por encima de 4)`);
  console.log(`  diagnósticos: ${r.diagnosticos.length} (${[...new Set(r.diagnosticos.map((d) => d.codigo))].join(", ")})`);
  console.log(`  mediana de 3: ${tiempos[1]!.toFixed(0)} ms (mín ${tiempos[0]!.toFixed(0)}, máx ${tiempos[2]!.toFixed(0)}); huellas distintas: ${huellas.size}`);
  console.log(`  por paso (última): ${Object.entries(e.tiempos).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", ")} ms`);
  console.log(`  sin pérdidas: fuerzas ${e.sinPerdidas.fuerzas.toExponential(1)}, momentos ${e.sinPerdidas.momentos.toExponential(1)}`);
  const t0 = performance.now();
  const c = calcular(r.modelo);
  const tc = performance.now() - t0;
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const eq = Math.max(...c.casos.map((k) => Math.max(k.equilibrio.fuerzas, k.equilibrio.momentos)));
  console.log(`Cálculo con el núcleo: ${tc.toFixed(0)} ms, ${c.estadisticas.ecuaciones} ecuaciones (${c.estadisticas.gdl} GDL), equilibrio ≤ ${eq.toExponential(1)}`);
  console.log(`Compilación / cálculo: ${((100 * tiempos[1]!) / tc).toFixed(0)} %`);
}
