/**
 * Prueba en sombra de la vivienda: los esfuerzos de cada tramo de pilar de la réplica frente a
 * los de CYPE (apartado 24 del listado), por hipótesis, y la carga que recibe cada cubierta (la
 * suma del axil en la base de los tramos de esa planta).
 *
 * CYPE lista [N, Mx, My, Qx, Qy, T] en ejes locales del pilar en la base y en la cabeza del tramo;
 * los nuestros van en el orden [N, Vy, Vz, T, My, Mz] de la barra. Se imprimen los dos tal cual
 * (N, los dos momentos y los dos cortantes): comparar los módulos, no los signos ni el orden.
 *
 *   bun validacion/sombra/vivienda/tramos.ts <carpeta de la variante> [<hipótesis>]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../../src/compilador/compilar.ts";
import { Consultas } from "../../../src/compilador/consultas.ts";
import { calcular } from "../../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { casosValidos } from "../../../src/pruebas/comparar.ts";
import { valido } from "../../../src/pruebas/metamorficasFisicas.ts";

const RAIZ = join(import.meta.dirname, "..", "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const dir = process.argv[2]!;
const hip = process.argv[3] ?? "Peso propio";
const HIP = ["Peso propio", "Cargas muertas", "Sobrecarga de uso"];
const ic = HIP.indexOf(hip);
if (ic < 0) throw new Error(`hipótesis desconocida: ${hip}`);
const p = JSON.parse(readFileSync(join(dir, "proyecto.json"), "utf8"));
const cy = JSON.parse(readFileSync(join(import.meta.dirname, ".datos", "cype.json"), "utf8"));
const r = valido(compilar(p.modelo, p.opciones ?? {}));
const casos = casosValidos(calcular(r.modelo));
const c = new Consultas(p.modelo, r, casos, p.opciones ?? {});
const PL: Record<string, string> = { "CUB-S": "Cubierta", CUB: "Planta 1" };
const f = (v: number) => v.toFixed(1).padStart(6);
const ours = (e: Float64Array) => `${f(-e[0]!)} ${f(e[5]!)} ${f(e[4]!)} ${f(e[1]!)} ${f(e[2]!)}`;
const cyp = (v: number[] | undefined) => (v ? `${f(v[0]!)} ${f(v[1]!)} ${f(v[2]!)} ${f(v[3]!)} ${f(v[4]!)}` : "   (sin dato)");

console.log(`${hip}: CYPE [N Mx My Qx Qy] base | cabeza  ||  nuestro [N Mz My Vy Vz] base | cabeza`);
const total: Record<string, [number, number]> = {};
for (const q of p.modelo.pilares as { id: string }[]) {
  const res = c.pilar(q.id);
  if (!res.valido) continue;
  for (const t of res.valor) {
    const pl = PL[t.planta] ?? t.planta;
    const cyt = cy.pilares[q.id]?.[pl]?.[hip];
    const b = t.base.esfuerzos.subarray(6 * ic, 6 * ic + 6);
    const h = t.cabeza.esfuerzos.subarray(6 * ic, 6 * ic + 6);
    console.log(`${q.id.padEnd(4)} ${pl.padEnd(9)} L=${t.longitud.toFixed(2)}  CYPE ${cyp(cyt?.base)} | ${cyp(cyt?.cabeza)}  ||  ${ours(b)} | ${ours(h)}`);
    if (cyt) {
      const tt = (total[pl] ??= [0, 0]);
      tt[0] += cyt.base[0];
      tt[1] += -b[0]!;
    }
  }
}
for (const [pl, [a, b]] of Object.entries(total)) console.log(`Carga de ${pl} (ΣN en la base de sus tramos): CYPE ${a.toFixed(1)}, nuestro ${b.toFixed(1)} (${(100 * (b / a - 1)).toFixed(1)} %)`);
