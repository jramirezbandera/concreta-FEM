/**
 * CO6 (docs/fem3d/comprobaciones.md §8.13): los pórticos de un proyecto y el despiece de sus vigas
 * con el armado que proponen las tablas. Por pórtico: sus vigas, su largo, sus vanos, las barras y los
 * cercos del despiece, la barra más larga y el acero.
 *
 *   bun validacion/co/medirPorticos.ts [proyecto.json] > validacion/co/out_medirPorticos.txt
 *
 * Sin proyecto, la vivienda de `ejemplos/` y el pórtico de las pruebas de las vigas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Proyecto } from "../../src/agente/proyecto.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import type { DatosArmado } from "../../src/comprobaciones/armado.ts";
import { despiecePortico } from "../../src/comprobaciones/despieceVigas.ts";
import { datosDespiece, porticosDe } from "../../src/comprobaciones/porticos.ts";
import { armadoPropuestoVigas, comprobarVigas } from "../../src/comprobaciones/vigas.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { porticoVigas } from "./modelosVigas.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const f = (x: number, n = 2) => x.toFixed(n);

function medir(nombre: string, modelo: ModeloFisico, datos?: DatosArmado) {
  const c = compilar(modelo);
  if (!c.valido) throw new Error(`${nombre}: no compila`);
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(`${nombre}: no calcula`);
  const q = new Consultas(modelo, c, r.casos, {}, r.modal);
  const rv = comprobarVigas(q, undefined, datos, { proponer: true });
  if (!rv.valido) throw new Error(`${nombre}: no propone`);
  const vigas = armadoPropuestoVigas(rv.valor, undefined);
  const t0 = performance.now();
  const ps = porticosDe(q);
  const ms = performance.now() - t0;
  console.log(`== ${nombre}: ${modelo.vigas?.length ?? 0} vigas en ${ps.length} pórticos (${f(ms, 1)} ms)`);
  let [total, barras, largas, avisos] = [0, 0, 0, 0];
  for (const p of ps) {
    const armados = Object.fromEntries(p.vanos.map((v) => [v.clave, vigas[v.viga]?.[v.vano]]));
    const d = despiecePortico(p, armados, datosDespiece(p, datos));
    total += d.acero.total;
    barras += d.barras.length;
    largas += d.barras.filter((b) => b.largo > 12).length;
    avisos += d.avisos.length;
    const papel = (x: string) => d.barras.filter((b) => b.papel === x).length;
    console.log(`  ${p.planta} · ${p.nombre} [${p.id}]: ${f(p.x[1] - p.x[0])} m, ${p.vanos.length} vanos (${p.vanos.filter((v) => armados[v.clave]).length} armados)`);
    console.log(`    barras ${d.barras.length} (inferiores ${papel("vano")}, corridas ${papel("corrida")}, de apoyo ${papel("apoyo")}, de piel ${papel("piel")}); la más larga ${f(Math.max(0, ...d.barras.map((b) => b.largo)))} m; con patilla ${d.barras.filter((b) => b.patillas.some((x) => x > 0)).length}; tramos de cercos ${d.cercos.length} (${d.cercos.reduce((t, x) => t + x.n, 0)} cercos)`);
    console.log(`    acero ${f(d.acero.total, 1)} kg (${d.acero.porDiametro.map((x) => `Ø${x.diametro} ${f(x.kg, 1)}`).join(", ")})${d.avisos.length ? `; avisos: ${d.avisos.join(" | ")}` : ""}`);
  }
  console.log(`  total: ${barras} barras, ${largas} de más de 12 m, ${avisos} avisos, ${f(total, 1)} kg de acero en vigas\n`);
}

const arg = process.argv[2];
if (arg) {
  const p = JSON.parse(readFileSync(arg, "utf8")) as Proyecto;
  medir(arg, p.modelo, p.obra?.armado);
} else {
  const v = JSON.parse(readFileSync(join(RAIZ, "ejemplos", "vivienda", "proyecto.json"), "utf8")) as Proyecto;
  medir("vivienda", v.modelo, v.obra?.armado);
  medir("pórtico de las pruebas de las vigas", porticoVigas());
  medir("pórtico de las pruebas, con el sismo", porticoVigas({ sismo: true }));
}
