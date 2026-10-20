/**
 * Prueba en sombra, modelos mínimos: el modelo con el plano del forjado en su cara superior (la cota
 * de CYPE, 3,00) y la cabeza de los pilares rígida en todo el canto (por defecto 0,30), como hace
 * CYPECAD, en lugar de la losa a media altura con medio canto rígido. Cambia el brazo en el modelo
 * analítico ya compilado (la opción `factorZonaRigidaPilares` no pasa de 1) y recorta el peso de los
 * pilares a su tramo flexible. Escribe el pilar P3 y la viga P3–P4 en peso propio.
 *
 *   bun validacion/sombra/minimo/brazo.ts <carpeta de la variante> [<brazo, m>]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../../src/compilador/compilar.ts";
import { Consultas } from "../../../src/compilador/consultas.ts";
import { calcular } from "../../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { casosValidos } from "../../../src/pruebas/comparar.ts";
import { valido } from "../../../src/pruebas/metamorficasFisicas.ts";
await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const p = JSON.parse(readFileSync(join(process.argv[2]!, "proyecto.json"), "utf8"));
const brazo = Number(process.argv[3] ?? "0.30");
for (const pl of p.modelo.plantas) if (pl.id === "PB") pl.altura = 3.0;
const r = valido(compilar(p.modelo, p.opciones ?? {}));
let n = 0;
for (const b of r.modelo.barras ?? []) {
  if (!/^P\d/.test(b.id)) continue;
  const j = b.offsets?.j;
  if (j) { console.log("  ", b.id, "offset j antes", j.map((v: number) => v.toFixed(3)).join(",")); b.offsets!.j = [0, 0, -brazo]; n++; }
}
const idx = new Set((r.modelo.barras ?? []).map((b, i) => (/^P\d/.test(b.id) ? i : -1)).filter((i) => i >= 0));
for (const caso of r.modelo.casos as unknown as Record<string, unknown>[]) for (const v of Object.values(caso)) if (Array.isArray(v)) for (const q of v as Record<string, number>[]) if (typeof q === "object" && q && idx.has(q.barra) && (q.b === undefined || q.b > 3 - brazo)) { q.a = 0; q.b = 3 - brazo; }
const c = new Consultas(p.modelo, r, casosValidos(calcular(r.modelo)), p.opciones ?? {});
console.log("pilares cambiados", n);
for (const id of ["P3"]) {
  const t = c.pilar(id);
  if (!t.valido) throw new Error("x");
  const f = (e: Float64Array) => `N ${(-e[0]!).toFixed(2)} Vy ${e[1]!.toFixed(2)} Vz ${e[2]!.toFixed(2)} My ${e[4]!.toFixed(2)} Mz ${e[5]!.toFixed(2)}`;
  for (const tr of t.valor) console.log(id, "| base", f(tr.base.esfuerzos), "| cabeza", f(tr.cabeza.esfuerzos));
}
const dg = c.diagrama("V-P3-P4", [1]);
if (dg.valido) { const e = dg.valor; const mx = Math.max(...e.map((x) => x.derecha[4]!)); const a = e.find((x) => x.s >= 0.15 - 1e-9)!; console.log("viga P3-P4: cara", a.izquierda[4]!.toFixed(2), "vano", mx.toFixed(2), "V", a.izquierda[2]!.toFixed(2)); }
