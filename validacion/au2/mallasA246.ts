/**
 * A2-46 (`docs/fem3d/auditoria-2.md` §11.2): las mallas de las geometrías de G y de las 48 retículas al
 * azar (con y sin muros), con h = 0,75, 0,5 y 0,25: por modelo, el sha256 de nudos y láminas y si la
 * planta fue por la triangulación sola (`malla/sin-rejilla`). Se corre con el código de antes (un
 * worktree) y con el de ahora, y se comparan las salidas.
 * Uso: bun validacion/au2/mallasA246.ts > salida.txt
 */
import { createHash } from "node:crypto";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { edificioGeometria, FAMILIAS, type OpcionesGeometria } from "../../src/pruebas/geometrias.ts";
import { conMurosAleatorios } from "../../src/pruebas/murosAleatorios.ts";
import { reticulaAleatoria } from "../../src/pruebas/reticulasAleatorias.ts";

const VARIANTES: [string, OpcionesGeometria][] = [["", {}], ["hueco", { hueco: true }], ["giro", { giro: 23 }], ["circ", { circulares: true }]];
function reticulaConMuros(semilla: number): ModeloFisico {
  const f = reticulaAleatoria(semilla);
  return conMurosAleatorios({ ...f, secciones: [...f.secciones, { id: "vb", material: "HA", forma: "rectangular" as const, b: 0.3, h: 0.5 }], casos: [...f.casos, { id: "V" }] }, semilla);
}
const modelos: [string, ModeloFisico][] = [];
for (const fam of FAMILIAS) for (const [n, v] of VARIANTES) modelos.push([`${fam}${n ? "-" + n : ""}`, edificioGeometria(fam, v)]);
for (let s = 1; s <= 24; s++) modelos.push([`ret${s}`, reticulaAleatoria(s)], [`ret${s}-muros`, reticulaConMuros(s)]);
for (const [nombre, f] of modelos)
  for (const h of [0.75, 0.5, 0.25]) {
    const c = compilar(f, { tamanoMalla: h });
    if (!c.valido) {
      console.log(`${nombre} h=${h}: no compila`);
      continue;
    }
    const sha = createHash("sha256").update(JSON.stringify([c.modelo.nudos.map((n) => [n.x, n.y, n.z]), (c.modelo.laminas ?? []).map((l) => l.nudos)])).digest("hex").slice(0, 16);
    const sin = c.diagnosticos.filter((d) => d.codigo === "malla/sin-rejilla").length;
    console.log(`${nombre} h=${h}: ${sha} ${c.modelo.nudos.length} nudos${sin ? ` sin-rejilla ${sin}` : ""}`);
  }
