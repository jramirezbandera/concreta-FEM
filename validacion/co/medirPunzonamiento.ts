/**
 * Fase CO4 (`docs/fem3d/comprobaciones.md` §8.7): lo que sale del punzonamiento de unos modelos, como
 * información (`bun validacion/co/medirPunzonamiento.ts > validacion/co/out_medirPunzonamiento.txt`).
 *
 * De cada pilar y planta: lo que le pasa el forjado (CO-i: por la huella, y de ello lo que llega por
 * la losa) frente a la diferencia de axiles del pilar (la alternativa de CO-i, que cuenta también lo
 * que llega por las vigas descolgadas), su posición, β, y el resultado con el armado propuesto.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { AccionCaso, ModeloFisico } from "../../src/compilador/fisico.ts";
import { textoPunzonamiento } from "../../src/comprobaciones/armado.ts";
import { conjuntoCombinaciones } from "../../src/agente/combinaciones.ts";
import { SITUACIONES_ELU } from "../../src/comprobaciones/demandas/pilares.ts";
import { comprobarLosas, armadoPropuestoLosas } from "../../src/comprobaciones/losas.ts";
import { comprobarPunzonamientos } from "../../src/comprobaciones/punzonamiento.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { losaPlana } from "./modelosLosas.ts";
import { modelosPunzonamiento } from "./modelosPunzonamiento.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const n1 = (x: number | null | undefined) => (x === null || x === undefined ? "—" : x.toFixed(1));
const n2 = (x: number | null | undefined) => (x === null || x === undefined ? "—" : x.toFixed(2));

function medir(nombre: string, f: ModeloFisico, opciones: { tiempos?: boolean } = {}): void {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const q = new Consultas(f, c, r.casos, {}, r.modal);
  console.log(`\n== ${nombre}: ${c.modelo.nudos.length} nudos`);
  let t = performance.now();
  const rl = comprobarLosas(q, undefined, undefined, { proponer: true });
  if (!rl.valido) throw new Error(rl.diagnosticos.map((x) => x.mensaje).join("\n"));
  const tLosas = (performance.now() - t) / 1000;
  const forjados = armadoPropuestoLosas(rl.valor, undefined);
  t = performance.now();
  const rp = comprobarPunzonamientos(q, forjados, undefined, undefined, { proponer: true, filas: true });
  if (!rp.valido) throw new Error(rp.diagnosticos.map((x) => x.mensaje).join("\n"));
  const tPunz = (performance.now() - t) / 1000;
  const v = rp.valor;
  console.log(`resumen: ${JSON.stringify(v.resumen)}${opciones.tiempos ? `; armar las losas ${tLosas.toFixed(1)} s, el punzonamiento ${tPunz.toFixed(1)} s` : ""}`);
  const elu = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: [...SITUACIONES_ELU] });
  if (!elu.valido) throw new Error("sin combinaciones");
  /** La alternativa de CO-i: la diferencia de axiles del pilar en la planta, en la combinación que manda (sólo la parte lineal). */
  const axil = (pilar: string, planta: string, comb: string | undefined): number | null => {
    const k = comb ? elu.valor.nombres.indexOf(comb) : -1;
    const ts = q.pilar(pilar);
    if (k < 0 || !ts.valido) return null;
    const f = elu.valor.factores[k]!;
    const abajo = ts.valor.find((x) => x.planta === planta);
    const arriba = ts.valor.find((x) => x.plantaBase === planta);
    const N = (e: Float64Array | undefined) => (e ? q.combinar(e, 6, f)[0]! : 0);
    return N(arriba?.base.esfuerzos) - N(abajo?.cabeza.esfuerzos);
  };
  console.log("pilar@planta       losa     pos       VEd (planas)   ΔN pilar  β     u1    d    vEd/vRd,c  aprov.  armadura        estado");
  if (opciones.tiempos) {
    // Un edificio: por posición, cuántas uniones, cuántas con armadura y la peor
    for (const pos of ["interior", "borde", "esquina", undefined] as const) {
      const suyas = v.pilares.filter((p) => p.posicion === pos);
      if (!suyas.length) continue;
      const peor = suyas.reduce((m, p) => ((p.sinArmadura ?? 0) > (m.sinArmadura ?? 0) ? p : m));
      console.log(`  ${pos ?? "sin posición"}: ${suyas.length} uniones, ${suyas.filter((p) => p.armadura).length} con armadura, ${suyas.filter((p) => !p.cumple).length} no cumplen; la peor, ${peor.pilar}@${peor.planta}: VEd ${n1(peor.VEd)} kN, β ${n2(peor.beta)}, vEd/vRd,c ${n2(peor.sinArmadura)}${peor.pendientes.length ? `; ${peor.pendientes[0]!.motivo}` : ""}`);
    }
    for (const d of rp.diagnosticos) console.log(`  [${d.severidad}] ${d.codigo}: ${d.mensaje}`);
    return;
  }
  for (const p of v.pilares) {
    // La alternativa de CO-i: la diferencia de axiles del pilar en la combinación que manda
    const m = p.manda;
    console.log(
      [
        `${p.pilar}@${p.planta}`.padEnd(18),
        p.losa.padEnd(8),
        (p.posicion ?? "—").padEnd(9),
        n1(p.VEd).padStart(6),
        n1(p.porVigasPlanas).padStart(8),
        n1(axil(p.pilar, p.planta, p.comb)).padStart(10),
        n2(p.beta).padStart(6),
        (p.u1 !== undefined ? p.u1.toFixed(0) : "—").padStart(6),
        (p.d !== undefined ? p.d.toFixed(0) : "—").padStart(5),
        n2(p.sinArmadura).padStart(9),
        n2(p.aprovechamiento).padStart(8),
        (p.armadura ? `${textoPunzonamiento(p.armadura)}${p.perimetros ? ` ×${p.perimetros}` : ""}` : "—").padEnd(16),
        p.cumple ? "cumple" : `NO: ${p.pendientes.map((x) => x.motivo).join(" | ") || m?.descripcion || ""}`,
      ].join(" "),
    );
  }
  for (const d of rp.diagnosticos) console.log(`  [${d.severidad}] ${d.codigo}: ${d.mensaje}`);
}

for (const [nombre, f] of Object.entries(modelosPunzonamiento())) medir(nombre, f);
medir("losa plana maciza 2 × 2 de 5 m, con sismo", losaPlana({ sismo: true }));
const viv = leerProyecto(readFileSync(join(import.meta.dirname, "..", "..", "ejemplos", "vivienda", "proyecto.json"), "utf8"));
if (viv.valido) medir("la vivienda", viv.proyecto.modelo);
if (process.argv.includes("--objetivo")) {
  const ACCIONES: Record<string, AccionCaso> = { G: { tipo: "G" }, Q: { tipo: "Q", psi: "uso-A" }, Vx: { tipo: "W", psi: "viento", direccion: "X", signo: 1, familia: "viento" }, Vy: { tipo: "W", psi: "viento", direccion: "Y", signo: 1, familia: "viento" } };
  const base = edificioObjetivoLosas(7);
  medir("el edificio objetivo de losas de 7 plantas, con viento (losas macizas con vigas en todos los ejes)", { ...base, casos: base.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })) }, { tiempos: true });
}
