/**
 * Banco del compilador (criterio 7 de C1): las barras del edificio objetivo de D9, 7 plantas con
 * 80 pilares (retícula de 10 × 8 con luces de 6 × 5 m), vigas continuas por todos los ejes y
 * secundarias en T en la mitad de los vanos, más la cimentación. Mide cada paso de la compilación
 * y el cálculo con el núcleo, y comprueba que la huella no cambia entre repeticiones.
 *
 *   node validacion/c1/banco.ts > validacion/c1/out_banco.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { CargaFisica, ModeloFisico, Pilar, Viga } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";

export function edificioObjetivo(plantas = 7, nx = 9, ny = 7): ModeloFisico {
  const xs = Array.from({ length: nx + 1 }, (_, i) => 6 * i);
  const ys = Array.from({ length: ny + 1 }, (_, j) => 5 * j);
  const ids = Array.from({ length: plantas }, (_, k) => `N${plantas - k}`);
  const pilares: Pilar[] = [];
  for (const x of xs) for (const y of ys) pilares.push({ id: `P${x}-${y}`, x, y, desde: "C", hasta: `N${plantas}`, seccion: (x + y) % 2 ? "p40" : "p3050", giro: (x / 6) % 2 ? 90 : 0 });
  const vigas: Viga[] = [];
  const cargas: CargaFisica[] = [];
  for (let k = 1; k <= plantas; k++) {
    const p = `N${k}`;
    for (const y of ys) vigas.push({ id: `X${y}-${p}`, planta: p, puntos: [[xs[0]!, y], [xs[nx]!, y]], seccion: "v3060" });
    for (const x of xs) vigas.push({ id: `Y${x}-${p}`, planta: p, puntos: [[x, ys[0]!], [x, ys[ny]!]], seccion: "v3060" });
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) vigas.push({ id: `S${i}-${j}-${p}`, planta: p, puntos: [[xs[i]! + 3, ys[j]!], [xs[i]! + 3, ys[j + 1]!]], seccion: "v2540" });
  }
  for (const v of vigas) {
    cargas.push({ tipo: "viga", id: `g${v.id}`, caso: "G", viga: v.id, ejes: "global", q: [0, 0, v.id.startsWith("S") ? -15 : -8] });
    cargas.push({ tipo: "viga", id: `q${v.id}`, caso: "Q", viga: v.id, ejes: "global", q: [0, 0, v.id.startsWith("S") ? -10 : -5] });
  }
  for (const pl of pilares) if (pl.x === 0) cargas.push({ tipo: "pilar", id: `w${pl.id}`, caso: "Vx", pilar: pl.id, ejes: "global", q: [3, 0, 0] });
  for (const pl of pilares) if (pl.y === 0) cargas.push({ tipo: "pilar", id: `v${pl.id}`, caso: "Vy", pilar: pl.id, ejes: "global", q: [0, 3, 0] });
  return {
    plantas: [...ids.map((id, k) => ({ id, altura: k === 0 ? null : 3 })), { id: "C", tipo: "sotano" as const, altura: 1.5 }],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 30 }],
    secciones: [
      { id: "p3050", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
      { id: "p40", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 },
      { id: "v3060", material: "HA", forma: "rectangular", b: 0.3, h: 0.6 },
      { id: "v2540", material: "HA", forma: "rectangular", b: 0.25, h: 0.4 },
    ],
    pilares,
    vigas,
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }, { id: "Vx" }, { id: "Vy" }],
    cargas,
  };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const f = edificioObjetivo();
  console.log(`Edificio objetivo, sólo barras: ${f.pilares!.length / 1} pilares por ${f.plantas.length - 1} plantas, ${f.vigas!.length} vigas, ${f.cargas!.length} cargas`);
  const huellas = new Set<string>();
  const tiempos: number[] = [];
  let r = compilar(f);
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    r = compilar(f);
    tiempos.push(performance.now() - t0);
    huellas.add(r.huella);
  }
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  tiempos.sort((a, b) => a - b);
  console.log(`Compilación: ${r.estadisticas.nudos} nudos, ${r.estadisticas.barras} barras, ${r.estadisticas.diafragmas} diafragmas, ${r.diagnosticos.length} diagnósticos`);
  console.log(`  mediana de 5: ${tiempos[2]!.toFixed(0)} ms (mín ${tiempos[0]!.toFixed(0)}, máx ${tiempos[4]!.toFixed(0)}); huellas distintas: ${huellas.size}`);
  console.log(`  por paso (última): ${Object.entries(r.estadisticas.tiempos).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(", ")} ms`);
  const t0 = performance.now();
  const c = calcular(r.modelo);
  const tc = performance.now() - t0;
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const eq = Math.max(...c.casos.map((k) => Math.max(k.equilibrio.fuerzas, k.equilibrio.momentos)));
  console.log(`Cálculo con el núcleo: ${tc.toFixed(0)} ms, ${c.estadisticas.ecuaciones} ecuaciones, equilibrio ≤ ${eq.toExponential(1)}`);
  console.log(`Compilación / cálculo: ${((100 * tiempos[2]!) / tc).toFixed(0)} %`);
}
