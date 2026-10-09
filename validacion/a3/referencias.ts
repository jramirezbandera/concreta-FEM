/**
 * Criterio 2 de A3 (`docs/fem3d/agente.md` §8): avisos de sensatez en los modelos de referencia sin
 * mutar, a tamaño completo, y en los tres proyectos de los agentes de A2. Cada aviso que quede se
 * justifica en el informe de la fase (`docs/fem3d/fase-a3.md`).
 *
 *   bun validacion/a3/referencias.ts > validacion/a3/out_referencias.txt
 *
 * Deja además el informe del edificio objetivo con losas y acciones como ejemplo
 * (`validacion/a3/informe-edificio.md`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Proyecto } from "../../src/agente/proyecto.ts";
import { fisico1022 } from "../c1/modelos.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { edificioObjetivoMuros, reticulaConNucleo } from "../c3/modelos.ts";
import { edificioReticular, edificioUnidireccional } from "../c4/modelos.ts";
import { conAcciones } from "../c5/modelos.ts";
import { prepararNucleo, proyectoDe, revisarProyecto } from "./revisar.ts";

const agente = (m: string): Proyecto => JSON.parse(readFileSync(join(import.meta.dirname, "..", "a2", "agente", m, "proyecto.json"), "utf8")) as Proyecto;

export const REFERENCIAS: { nombre: string; p: () => Proyecto }[] = [
  { nombre: "1-022", p: () => proyectoDe(fisico1022()) },
  { nombre: "retícula con núcleo", p: () => proyectoDe(reticulaConNucleo()) },
  { nombre: "edificio objetivo con losas", p: () => proyectoDe(edificioObjetivoLosas()) },
  { nombre: "edificio objetivo con losas y acciones", p: () => proyectoDe(conAcciones(edificioObjetivoLosas())) },
  { nombre: "edificio objetivo con muros", p: () => proyectoDe(edificioObjetivoMuros()) },
  { nombre: "edificio reticular (V2)", p: () => proyectoDe(edificioReticular()) },
  { nombre: "edificio unidireccional (V3)", p: () => proyectoDe(edificioUnidireccional()) },
  { nombre: "A2: 1-022 del agente", p: () => agente("1022") },
  { nombre: "A2: retícula con núcleo del agente", p: () => agente("nucleo") },
  { nombre: "A2: edificio objetivo del agente", p: () => agente("edificio") },
];

if (import.meta.main) {
  await prepararNucleo();
  const solo = process.argv[2];
  for (const ref of REFERENCIAS.filter((r) => !solo || r.nombre.includes(solo))) {
    const r = revisarProyecto(ref.p());
    if (!r.valido) {
      console.log(`== ${ref.nombre}: NO SE PUEDE REVISAR: ${r.errores.map((e) => e.mensaje).join("; ")}`);
      continue;
    }
    const rev = r.revision;
    if (ref.nombre === "edificio objetivo con losas y acciones") writeFileSync(join(import.meta.dirname, "informe-edificio.md"), rev.markdown);
    console.log(`\n== ${ref.nombre} (${r.segundos.toFixed(1)} s): ${rev.avisos.length} avisos`);
    for (const c of rev.comprobaciones) {
      console.log(`  ${c.estado.padEnd(9)} ${c.codigo.padEnd(28)} ${c.peor ?? ""}`);
      for (const a of c.avisos.slice(0, 5)) console.log(`      ${a.mensaje}`);
      if (c.avisos.length > 5) console.log(`      … y ${c.avisos.length - 5} más`);
    }
    const cs = rev.tributaria.flatMap((t) => (t.cociente === null ? [] : [t.cociente]));
    if (cs.length) console.log(`  bajada tributaria: ${cs.length} de ${rev.tributaria.length} tramos comparados; axil/bajada de ${Math.min(...cs).toFixed(3)} a ${Math.max(...cs).toFixed(3)}`);
  }
}
