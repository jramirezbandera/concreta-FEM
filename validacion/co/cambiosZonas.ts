/**
 * CO1-f (docs/fem3d/comprobaciones.md §8.14): lo que cambia en la referencia congelada de los pilares
 * con las tres zonas de cercos (pie, centro y cabeza) y la comprobación en la sección central.
 *
 *   bun validacion/co/cambiosZonas.ts > validacion/co/out_cambiosZonas.txt
 *
 * Compara el fixture de antes (src/comprobaciones/__fixtures__/congelado-co1.json, sin regenerar) con
 * lo de ahora, tramo a tramo: el armado longitudinal (no debe cambiar), los cercos, lo que cumple y la
 * mayor diferencia de aprovechamiento de las filas que ya estaban.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { MODELOS_CONGELADOS_CO1, referenciaCO1, type ReferenciaCO1 } from "./congelar.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const antes = JSON.parse(readFileSync(join(RAIZ, "src", "comprobaciones", "__fixtures__", "congelado-co1.json"), "utf8")) as Record<string, ReferenciaCO1>;

const partes = (texto: string | null): [string, string] => {
  const [barras = "", ...cercos] = (texto ?? "sin propuesta").split(" · ");
  return [barras, cercos.join(" · ")];
};

for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_CO1)) {
  const ahora = referenciaCO1(f());
  const a = antes[nombre]!;
  let [barrasCambian, conZonas, dejanDeCumplir, pasanACumplir] = [0, 0, 0, 0];
  let mayor = { d: 0, que: "" };
  const cercos = new Map<string, number>();
  const nuevas = new Set<string>();
  ahora.tramos.forEach((t, i) => {
    const x = a.tramos[i]!;
    if (x.pilar !== t.pilar || x.planta !== t.planta) throw new Error(`${nombre}: los tramos no casan en ${i}`);
    const [[b0, c0], [b1, c1]] = [partes(x.texto), partes(t.texto)];
    if (b0 !== b1) barrasCambian++;
    if (/pie|cabeza/.test(c1)) conZonas++;
    cercos.set(`${c0}  →  ${c1}`, (cercos.get(`${c0}  →  ${c1}`) ?? 0) + 1);
    if (x.cumple && !t.cumple) dejanDeCumplir++;
    if (!x.cumple && t.cumple) pasanACumplir++;
    const de = new Map(x.filas.map((y) => [y.id, y]));
    for (const y of t.filas) {
      const z = de.get(y.id);
      if (!z) {
        nuevas.add(y.id);
        continue;
      }
      // Las filas de los cercos cambian con ellos: aquí, las de agotamiento que no son el cortante
      if (/^(stirrup|cortante|biela)/.test(y.id) || y.aprovechamiento === null || z.aprovechamiento === null) continue;
      const d = Math.abs(y.aprovechamiento - z.aprovechamiento);
      if (d > mayor.d) mayor = { d, que: `${t.pilar}/${t.planta} ${y.id}: ${z.aprovechamiento.toFixed(4)} → ${y.aprovechamiento.toFixed(4)}` };
    }
  });
  console.log(`== ${nombre}: ${ahora.tramos.length} tramos`);
  console.log(`  resumen antes ${JSON.stringify(a.resumen)}`);
  console.log(`  resumen ahora ${JSON.stringify(ahora.resumen)}`);
  console.log(`  cambia el armado longitudinal en ${barrasCambian}; con zonas de cercos, ${conZonas}; dejan de cumplir ${dejanDeCumplir}; pasan a cumplir ${pasanACumplir}`);
  console.log(`  mayor diferencia en una fila que no es de cercos ni de cortante: ${mayor.d.toExponential(2)}${mayor.que ? ` (${mayor.que})` : ""}`);
  if (nuevas.size) console.log(`  filas nuevas: ${[...nuevas].join(", ")}`);
  for (const [k, n] of [...cercos].sort((p, q) => q[1] - p[1])) console.log(`  ${String(n).padStart(4)} × ${k}`);
  console.log("");
}
