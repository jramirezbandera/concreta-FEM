/**
 * Sondeo del sólido de I3: tamaño, tiempo, cierre y volumen de cada pieza en los proyectos de V1 y
 * en los edificios de C3 y C4. `bun validacion/i3/sondeo.ts`
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { alambrico } from "../../src/visor/alambrico.ts";
import { piezasSolido, solido, volumen } from "../../src/visor/solido.ts";
import { edificioReticular, edificioUnidireccional } from "../c4/modelos.ts";
import { edificioObjetivoMuros, reticulaConNucleo } from "../c3/modelos.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const leer = (r: string): ModeloFisico => JSON.parse(readFileSync(join(RAIZ, r), "utf8")).modelo;
const modelos: [string, ModeloFisico][] = [
  ["ejemplo", leer(".claude/skills/fem/ejemplo.json")],
  ["1022", leer("validacion/a2/agente/1022/proyecto.json")],
  ["nucleo", leer("validacion/a2/agente/nucleo/proyecto.json")],
  ["edificio", leer("validacion/a2/agente/edificio/proyecto.json")],
  ["reticulaConNucleo", reticulaConNucleo()],
  ["edificioMuros", edificioObjetivoMuros()],
  ["reticular V2", edificioReticular()],
  ["unidireccional V3", edificioUnidireccional()],
];
for (const [nombre, f] of modelos) {
  const c = compilar(f);
  const comp = c.valido ? c : null;
  let t = performance.now();
  const { piezas } = piezasSolido(f, comp);
  const tp = performance.now() - t;
  t = performance.now();
  const s = solido(f, alambrico(f).origen, comp);
  const ts = performance.now() - t;
  let abiertas = 0;
  let negativas = 0;
  for (const p of piezas) {
    const v0 = volumen(p.caras);
    const v1 = volumen(p.caras, [123.4, -56.7, 89]);
    if (Math.abs(v0 - v1) > 1e-9 * Math.max(1, Math.abs(v0))) abiertas++;
    if (v0 <= 0) negativas++;
  }
  console.log(`${nombre}: ${c.valido ? "compila" : "no compila"}; ${piezas.length} piezas, ${s.triangulos.length / 9} triángulos, ${s.aristas.length / 6} aristas; piezas ${tp.toFixed(0)} ms, sólido ${ts.toFixed(0)} ms; abiertas ${abiertas}, V ≤ 0 ${negativas}`);
}
