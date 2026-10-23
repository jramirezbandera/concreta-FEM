/**
 * Punto 5 de lo pendiente de LV2 (`docs/fem3d/fase-lv2.md` §5): en la retícula 5 con muros, la
 * plantilla refinada de P2-1 (un 25 × 60 girado bajo X1, de 30, que asoma 15 cm a cada lado: dos tiras
 * de 25 × 15 cm, LV-8) no pasa la guarda de calidad. Hasta el 2026-10-23 el pilar se quedaba con la
 * plantilla sin tercios (`malla/cara-sin-refinar`); desde entonces, sus tiras van por la triangulación
 * (`malla/pilar-asoma-sin-plantilla`). La viga en las caras de P2-1 y las estaciones de franja a
 * ≤ 0,5 m de él, con h = 0,75 y 0,25, frente a h = 0,125. Las medidas, como en `asoma.ts`
 * (`precisionLocal.ts`). Para el «antes», el mismo script en un worktree en el commit anterior.
 *
 *   bun validacion/lv2/p21.ts > validacion/lv2/out_p21.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { conMurosAleatorios } from "../../src/pruebas/murosAleatorios.ts";
import { diferenciasLocales, medirLocal, pilaresMedidos } from "../../src/pruebas/precisionLocal.ts";
import { reticulaAleatoria } from "../../src/pruebas/reticulasAleatorias.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

/** La de `geometrias.test.ts`: la retícula al azar con los muros al azar de C3. */
function reticulaConMuros(semilla: number): ModeloFisico {
  const f = reticulaAleatoria(semilla);
  const conVb = { ...f, secciones: [...f.secciones, { id: "vb", material: "HA", forma: "rectangular" as const, b: 0.3, h: 0.5 }], casos: [...f.casos, { id: "V" }] };
  return conMurosAleatorios(conVb, semilla);
}

const f = reticulaConMuros(5);
const pil = pilaresMedidos(f).filter((p) => p.pilar.id === "P2-1");
const pct = (v: number) => `${(100 * v).toFixed(1)} %`.padStart(9);
const variantes: [string, OpcionesCompilacion][] = [
  ["h = 0,75", {}],
  ["h = 0,25", { tamanoMalla: 0.25 }],
];
const ref = medirLocal(f, { tamanoMalla: 0.125 }, pil);
console.log("## P2-1 en la retícula 5 con muros: diferencias frente a h = 0,125 (respecto al máximo de la viga o de la franja)\n");
const claves = [...ref.vigas.keys(), ...ref.franjas.keys()];
const filas: string[][] = [];
for (const [nombre, op] of variantes) {
  const c = compilar(f, op);
  if (!c.valido) throw new Error(nombre);
  const con = (codigo: string) => c.diagnosticos.some((d) => d.codigo === codigo && d.mensaje.includes("P2-1"));
  const avisos = con("malla/cara-sin-refinar") ? "P2-1 con la plantilla sin tercios" : con("malla/pilar-asoma-sin-plantilla") ? "P2-1 por la triangulación" : "P2-1 con la plantilla refinada";
  const m = medirLocal(f, op, pil);
  const dif = new Map([...diferenciasLocales(m.vigas, ref.vigas), ...diferenciasLocales(m.franjas, ref.franjas)].map((x) => [x.k, x.d]));
  console.log(`${nombre}: ${avisos}, jacobiano mínimo ${c.estadisticas.malla.jacobianoMin.toFixed(3)}, ${c.estadisticas.malla.bajos} bajos, ${m.nudos} nudos`);
  filas.push([nombre, ...claves.map((k) => (dif.has(k) ? pct(dif.get(k)!) : "—".padStart(9)))]);
}
console.log("");
console.log(`${"".padEnd(44)}${variantes.map(([n]) => n.padStart(12)).join("")}`);
claves.forEach((k, i) => console.log(`${k.padEnd(44)}${filas.map((r) => r[i + 1]!.padStart(12)).join("")}`));
