/**
 * CO2-k (docs/fem3d/comprobaciones.md §8.28): lo que cambia en la referencia congelada de las vigas
 * cuando la propuesta pone la misma armadura superior a los dos lados de cada apoyo.
 *
 *   bun validacion/co/cambiosUnificar.ts > validacion/co/out_cambiosUnificar.txt
 *
 * Compara el fixture de antes (src/comprobaciones/__fixtures__/congelado-co2.json, sin regenerar) con
 * lo de ahora, vano a vano: el armado propuesto (sólo puede subir la superior de un apoyo), lo que
 * cumple (no debe cambiar) y, con lo de ahora, los apoyos que siguen con una armadura distinta a cada
 * lado (con su motivo: anchos distintos o una regla que deja de cumplirse).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import { porticosDe } from "../../src/comprobaciones/porticos.ts";
import { comprobarVigas } from "../../src/comprobaciones/vigas.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { MODELOS_CONGELADOS_CO2, referenciaCO2, type ReferenciaCO2 } from "./congelarVigas.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const antes = JSON.parse(readFileSync(join(RAIZ, "src", "comprobaciones", "__fixtures__", "congelado-co2.json"), "utf8")) as Record<string, ReferenciaCO2>;

for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_CO2)) {
  const m = f();
  const ahora = referenciaCO2(m);
  const a = antes[nombre]!;
  let [cambian, cumpleCambia] = [0, 0];
  const detalle: string[] = [];
  ahora.vanos.forEach((t, i) => {
    const x = a.vanos[i]!;
    if (x.viga !== t.viga || x.vano !== t.vano) throw new Error(`${nombre}: los vanos no casan en ${i}`);
    if (x.cumple !== t.cumple) cumpleCambia++;
    if (x.texto === t.texto) return;
    cambian++;
    detalle.push(`   ${t.viga}/${t.vano}: ${x.texto}  →  ${t.texto}`);
  });
  // Los apoyos interiores de los pórticos, con lo propuesto ahora: ¿la misma superior a cada lado?
  const c = compilar(m.modelo, m.opciones);
  if (!c.valido) throw new Error(`${nombre}: no compila`);
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(`${nombre}: no calcula`);
  const q = new Consultas(m.modelo, c, r.casos, m.opciones ?? {}, r.modal);
  const p = comprobarVigas(q, undefined, undefined, { proponer: true });
  if (!p.valido) throw new Error(`${nombre}: no propone`);
  const armado = new Map(p.valor.vigas.flatMap((g) => g.vanos.map((v) => [`${g.viga}/${v.vano}`, v.armado] as const)));
  let [interiores, distintos] = [0, 0];
  const quedan: string[] = [];
  for (const pr of porticosDe(q)) {
    pr.apoyos.forEach((ap, i) => {
      const [vi, vd] = [pr.vanos.find((v) => v.apoyos[1] === i), pr.vanos.find((v) => v.apoyos[0] === i)];
      if (!vi || !vd || !vi.geometria || !vd.geometria) return;
      const [ai, ad] = [armado.get(vi.clave), armado.get(vd.clave)];
      if (!ai || !ad) return;
      interiores++;
      const zi = (vi.invertida ? ai.superiorInicio : ai.superiorFin) ?? ai.superior;
      const zd = (vd.invertida ? ad.superiorFin : ad.superiorInicio) ?? ad.superior;
      if (zi.n === zd.n && zi.diametro === zd.diametro) return;
      distintos++;
      const anchos = vi.geometria.b !== vd.geometria.b ? ` (anchos ${vi.geometria.b} y ${vd.geometria.b} mm)` : "";
      quedan.push(`   ${ap.objeto} entre ${vi.clave} y ${vd.clave}: ${zi.n}Ø${zi.diametro} | ${zd.n}Ø${zd.diametro}${anchos}`);
    });
  }
  console.log(`== ${nombre}: ${ahora.vanos.length} vanos`);
  console.log(`   resumen antes ${JSON.stringify(a.resumen)}; ahora ${JSON.stringify(ahora.resumen)}`);
  console.log(`   cambia el armado propuesto en ${cambian} vanos; si cumple, en ${cumpleCambia}`);
  console.log(`   apoyos interiores con vanos armados a los dos lados: ${interiores}; con otra superior a cada lado, ${distintos}`);
  for (const l of detalle) console.log(l);
  for (const l of quedan) console.log(l);
}
