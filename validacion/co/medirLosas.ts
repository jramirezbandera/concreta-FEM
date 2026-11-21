/**
 * Fase CO3 (`docs/fem3d/comprobaciones.md`): lo que sale de proponer el armado de las losas de unos
 * modelos, como información (`bun validacion/co/medirLosas.ts > validacion/co/out_medirLosas.txt`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { textoBarrasForjado } from "../../src/comprobaciones/armado.ts";
import { proponerLosa } from "../../src/comprobaciones/armar/losas.ts";
import { demandasLosa } from "../../src/comprobaciones/demandas/losas.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import type { AccionCaso } from "../../src/compilador/fisico.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { losaEnDosApoyos, losaPlana } from "./modelosLosas.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

function medir(nombre: string, f: ModeloFisico, soloLosas?: readonly string[]): void {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const q = new Consultas(f, c, r.casos, {}, r.modal);
  console.log(`\n== ${nombre}: ${c.modelo.nudos.length} nudos`);
  for (const losa of (f.losas ?? []).filter((l) => !soloLosas || soloLosas.includes(l.id))) {
    let t = performance.now();
    const d = demandasLosa(q, losa.id);
    if (!d.valido) throw new Error(d.diagnosticos.map((x) => x.mensaje).join("\n"));
    const tDemandas = (performance.now() - t) / 1000;
    t = performance.now();
    const p = proponerLosa(d.valor);
    const tProponer = (performance.now() - t) / 1000;
    const n = d.valor.direcciones.map((x) => x.estaciones.length);
    console.log(`losa ${losa.id}: ${n[0]} + ${n[1]} estaciones, ${d.valor.combinaciones} combinaciones de ELU; demandas ${tDemandas.toFixed(1)} s, proponer ${tProponer.toFixed(1)} s (${p.probados} armados probados)`);
    if (!p.armado) {
      console.log(`  sin propuesta: ${p.motivo}`);
      continue;
    }
    const cuatro = (b: typeof p.armado.base) => Object.entries(b).map(([k, x]) => `${k} ${textoBarrasForjado(x)}`).join(" · ");
    console.log(`  base: ${cuatro(p.armado.base)}`);
    if (p.armado.abacos) console.log(`  ábacos: ${cuatro(p.armado.abacos)}`);
    const porArmadura = new Map<string, string[]>();
    for (const x of p.armado.refuerzos ?? []) porArmadura.set(x.armadura + (x.en ? ` (${x.en})` : ""), [...(porArmadura.get(x.armadura + (x.en ? ` (${x.en})` : "")) ?? []), textoBarrasForjado(x.barras)]);
    for (const [k, v] of porArmadura) {
      const cuenta = new Map<string, number>();
      for (const x of v) cuenta.set(x, (cuenta.get(x) ?? 0) + 1);
      console.log(`  refuerzos ${k}: ${v.length} (${[...cuenta].map(([x, m]) => `${m} × ${x}`).join(", ")})`);
    }
    if (p.armado.cercos) console.log(`  cercos de nervios: ${p.armado.cercos.length} zonas (${[...new Set(p.armado.cercos.map((x) => `${x.direccion} c${x.cercos.diametro}/${x.cercos.separacion}`))].join(', ')})`);
    const c2 = p.comprobacion!;
    console.log(`  cumple: ${c2.cumple}; aprovechamiento ${c2.aprovechamiento.toFixed(3)}; ${c2.llamadas} llamadas; sin refuerzo ${p.sinRefuerzo.length}; pendientes ${c2.pendientes.map((x) => x.motivo).join(" | ") || "—"}`);
    const fallan = c2.filas.filter((x) => x.estado === "fail");
    for (const x of fallan.slice(0, 8)) console.log(`  FALLA ${x.id} (${x.seccion}) ${x.aprovechamiento.toFixed(2)} ${x.franja ?? ""} s=${x.s?.toFixed(2) ?? ""} ${x.comb ?? ""}: ${x.descripcion}`);
    for (const x of p.sinRefuerzo.slice(0, 5)) console.log(`  sin refuerzo ${x.zona}: ${x.motivo}`);
    const peor = (id: RegExp) => c2.filas.filter((x) => id.test(x.id)).reduce((m, x) => Math.max(m, x.aprovechamiento), 0);
    console.log(`  peores: flexión ${peor(/bending$/).toFixed(2)}, fisuración ${peor(/cracking$/).toFixed(2)}, cortante ${peor(/shear$/).toFixed(2)}`);
  }
}

medir("losa en dos apoyos", losaEnDosApoyos());
medir("losa plana maciza de 25, 2 × 2 vanos de 5 m", losaPlana());
medir("losa plana reticular 25+5, 2 × 2 vanos de 6 m", losaPlana({ reticular: true }));
medir("la misma reticular con ábacos de 2 m", losaPlana({ reticular: true, abaco: 2 }));
medir("losa plana maciza con sismo", losaPlana({ sismo: true }));

// La vivienda (dos cubiertas reticulares con vigas planas) y, con --objetivo, el edificio objetivo de losas de 7 plantas con viento
const viv = leerProyecto(readFileSync(join(import.meta.dirname, "..", "..", "ejemplos", "vivienda", "proyecto.json"), "utf8"));
if (viv.valido) medir("la vivienda", viv.proyecto.modelo);
if (process.argv.includes("--objetivo")) {
  const ACCIONES: Record<string, AccionCaso> = { G: { tipo: "G" }, Q: { tipo: "Q", psi: "uso-A" }, Vx: { tipo: "W", psi: "viento", direccion: "X", signo: 1, familia: "viento" }, Vy: { tipo: "W", psi: "viento", direccion: "Y", signo: 1, familia: "viento" } };
  const base = edificioObjetivoLosas(7);
  const f: ModeloFisico = { ...base, casos: base.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })) };
  const ids = (f.losas ?? []).map((l) => l.id);
  medir("el edificio objetivo de losas de 7 plantas, con viento (la losa de arriba y la de abajo)", f, [ids[0]!, ids[ids.length - 1]!]);
}
