/**
 * CO2-j (docs/fem3d/comprobaciones.md §8.26): lo que cambia en la referencia congelada de las vigas
 * con la fila del momento mínimo en la cara de los apoyos con continuidad (`<zona>/sup-empotramiento`).
 *
 *   bun validacion/co/cambiosEmpotramiento.ts > validacion/co/out_cambiosEmpotramiento.txt
 *
 * Compara el fixture de antes (src/comprobaciones/__fixtures__/congelado-co2.json, sin regenerar) con
 * lo de ahora, vano a vano: el armado propuesto y lo que cumple (no deben cambiar si la fila nueva no
 * manda), las filas que ya estaban (su estado y su aprovechamiento) y las nuevas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { MODELOS_CONGELADOS_CO2, referenciaCO2, type ReferenciaCO2 } from "./congelarVigas.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const antes = JSON.parse(readFileSync(join(RAIZ, "src", "comprobaciones", "__fixtures__", "congelado-co2.json"), "utf8")) as Record<string, ReferenciaCO2>;
const NUEVA = /\/sup-empotramiento$/;

for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_CO2)) {
  const ahora = referenciaCO2(f());
  const a = antes[nombre]!;
  if (ahora.vanos.length !== a.vanos.length) throw new Error(`${nombre}: ${ahora.vanos.length} vanos frente a ${a.vanos.length}`);
  let [armadoCambia, cumpleCambia, pendientesCambian, quitadas, otrasNuevas, estadoCambia] = [0, 0, 0, 0, 0, 0];
  let mayor = { d: 0, que: "" };
  const nuevas: { que: string; u: number; manda: boolean }[] = [];
  const detalle: string[] = [];
  ahora.vanos.forEach((t, i) => {
    const x = a.vanos[i]!;
    const donde = `${t.viga}/${t.vano}`;
    if (x.viga !== t.viga || x.vano !== t.vano) throw new Error(`${nombre}: los vanos no casan en ${i}`);
    if (x.texto !== t.texto) {
      armadoCambia++;
      detalle.push(`   ${donde}: ${x.texto}  →  ${t.texto}`);
    }
    if (x.cumple !== t.cumple) cumpleCambia++;
    if (JSON.stringify(x.pendientes) !== JSON.stringify(t.pendientes)) pendientesCambian++;
    const viejas = new Map(x.filas.map((y) => [y.id, y]));
    const otras = Math.max(0, ...t.filas.filter((y) => !NUEVA.test(y.id)).map((y) => y.aprovechamiento ?? 0));
    for (const y of t.filas) {
      const v = viejas.get(y.id);
      viejas.delete(y.id);
      if (!v) {
        if (NUEVA.test(y.id)) nuevas.push({ que: `${donde} ${y.id}`, u: y.aprovechamiento ?? NaN, manda: (y.aprovechamiento ?? 0) > otras });
        else otrasNuevas++;
        continue;
      }
      if (v.estado !== y.estado) estadoCambia++;
      const d = Math.abs((y.aprovechamiento ?? 0) - (v.aprovechamiento ?? 0));
      if (d > mayor.d) mayor = { d, que: `${donde} ${y.id}` };
    }
    quitadas += viejas.size;
  });
  const us = nuevas.map((x) => x.u).sort((p, q) => p - q);
  console.log(`== ${nombre}: ${ahora.vanos.length} vanos`);
  console.log(`   resumen antes ${JSON.stringify(a.resumen)}; ahora ${JSON.stringify(ahora.resumen)}`);
  console.log(`   cambian: el armado propuesto en ${armadoCambia} vanos, si cumple en ${cumpleCambia}, lo pendiente en ${pendientesCambian}`);
  console.log(`   filas que ya estaban: ${quitadas} desaparecen, ${estadoCambia} cambian de estado; la mayor diferencia de aprovechamiento, ${mayor.d.toExponential(2)}${mayor.que ? ` (${mayor.que})` : ""}; otras filas nuevas: ${otrasNuevas}`);
  console.log(`   filas nuevas del momento mínimo: ${nuevas.length}${nuevas.length ? `, aprovechamiento de ${us[0]!.toFixed(3)} a ${us[us.length - 1]!.toFixed(3)} (mediana ${us[Math.floor(us.length / 2)]!.toFixed(3)}); manda en su vano en ${nuevas.filter((x) => x.manda).length}` : ""}`);
  for (const l of detalle) console.log(l);
}
