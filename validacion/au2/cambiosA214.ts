/**
 * A2-14 y A2-17 (`docs/fem3d/auditoria-2.md` §11): qué cambia en la referencia congelada de C5 con la
 * fuerza de borde de Kirchhoff con su peso (y en los bordes apoyados sólo en uz) y los nudos que el corte
 * sólo toca en un punto. Por modelo, frente al fixture: lo que no son estaciones de bandas (igual o no) y
 * cada componente de estación que cambia, antes → ahora, con la diferencia relativa al mayor |valor| de
 * esa componente en las estaciones del modelo.
 * Uso: bun validacion/au2/cambiosA214.ts > validacion/au2/out_cambiosA214.txt (antes de regenerar el fixture)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { MODELOS_CONGELADOS_C5, redondeo, referenciaC5, type ReferenciaC5 } from "../c5/congelar.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const antes = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-c5.json"), "utf8")) as Record<string, ReferenciaC5>;
const NOMBRES = ["N", "Vy", "Vz", "T", "My", "Mz"];
type E = { s: number; tipo: string; esfuerzos: (number | null)[]; medios: (number | null)[]; wa: unknown };
for (const [k, f] of Object.entries(MODELOS_CONGELADOS_C5)) {
  const a = antes[k]!;
  const b = JSON.parse(JSON.stringify(referenciaC5(f), redondeo)) as ReferenciaC5;
  const resto = (r: ReferenciaC5) => JSON.stringify({ ...r, estaciones: undefined });
  const ea = a.estaciones as Record<string, E[]>;
  const eb = b.estaciones as Record<string, E[]>;
  const mayor = new Float64Array(6);
  for (const lista of Object.values(eb)) for (const s of lista) s.esfuerzos.forEach((v, i) => (mayor[i % 6] = Math.max(mayor[i % 6]!, Math.abs(v ?? 0))));
  const lineas: string[] = [];
  let iguales = 0;
  let total = 0;
  for (const [id, lista] of Object.entries(eb))
    lista.forEach((s, j) => {
      total++;
      const s0 = ea[id]![j]!;
      if (JSON.stringify(s0) === JSON.stringify(s)) return void iguales++;
      s.esfuerzos.forEach((v, i) => {
        const v0 = s0.esfuerzos[i];
        if (v === v0) return;
        lineas.push(`  ${id}[${j}] (${s.tipo}, s = ${s.s}) caso ${Math.floor(i / 6)} ${NOMBRES[i % 6]}: ${v0} → ${v} (${(((v ?? 0) - (v0 ?? 0)) / (mayor[i % 6] || 1)).toExponential(2)} del mayor)`);
      });
      if (JSON.stringify(s0.medios) !== JSON.stringify(s.medios) || JSON.stringify(s0.wa) !== JSON.stringify(s.wa)) lineas.push(`  ${id}[${j}]: cambian también los medios o Wood–Armer`);
    });
  console.log(`== ${k}: lo demás ${resto(a) === resto(b) ? "idéntico" : "CAMBIA"}; estaciones iguales ${iguales} de ${total}`);
  for (const l of lineas) console.log(l);
}
