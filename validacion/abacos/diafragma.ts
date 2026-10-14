/**
 * SP-5 en el muestrario: láminas de L2 y, en los casos horizontales (viento y sismo, con sus
 * puntuales en (9; 5,5) de PL1 y CUB), las reacciones y los esfuerzos de los pilares. Escribe un JSON
 * para comparar dos versiones del compilador:
 *   bun validacion/abacos/diafragma.ts <salida.json>
 *   bun validacion/abacos/diafragma.ts --comparar <antes.json> <ahora.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepararNucleo } from "../a3/revisar.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { calcular } from "../../src/motor/calcular.ts";

const HORIZONTALES = ["WX+", "WX-", "WY+", "WY-", "EX", "EY"];

if (process.argv[2] === "--comparar") {
  const [a, b] = [process.argv[3]!, process.argv[4]!].map((f) => JSON.parse(readFileSync(f, "utf8")));
  console.log(`Láminas de L2: ${a.laminasL2} → ${b.laminasL2}; nudos del modelo: ${a.nudos} → ${b.nudos}`);
  for (const caso of HORIZONTALES) {
    const ra: number[] = a.reacciones[caso];
    const rb: number[] = b.reacciones[caso];
    const ea: Record<string, number[]> = a.pilares[caso];
    const eb: Record<string, number[]> = b.pilares[caso];
    const maxR = Math.max(...ra.map(Math.abs));
    const dR = Math.max(...ra.map((v, i) => Math.abs(v - rb[i]!)));
    let maxE = 0;
    let dE = 0;
    let peor = "";
    for (const id of Object.keys(ea)) {
      const x = ea[id]!;
      const y = eb[id]!;
      for (let i = 0; i < x.length; i++) {
        maxE = Math.max(maxE, Math.abs(x[i]!));
        const d = Math.abs(x[i]! - y[i]!);
        if (d > dE) [dE, peor] = [d, id];
      }
    }
    console.log(`${caso.padEnd(4)} reacciones: máx ${maxR.toFixed(2)} kN, dif. ${dR.toExponential(2)} (${((100 * dR) / maxR).toFixed(3)} %); extremos de pilares: máx ${maxE.toFixed(2)}, dif. ${dE.toExponential(2)} (${((100 * dE) / maxE).toFixed(3)} %, ${peor})`);
  }
} else {
  await prepararNucleo();
  const p = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "ejemplos", "muestrario", "proyecto.json"), "utf8"));
  const c = compilar(p.modelo);
  if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
  const laminasL2 = (c.mapeo.laminas ?? []).filter((m) => m.losa === "L2").length;
  // Reacciones en los nudos con apoyo (en el orden de los apoyos) y esfuerzos de extremo de las barras de pilar, por pieza física
  const reacciones: Record<string, number[]> = {};
  const pilares: Record<string, Record<string, number[]>> = {};
  const barrasPilar = (c.modelo.barras ?? []).map((b, i) => ({ b, i, m: c.mapeo.barras?.[i] })).filter((x) => x.m?.tipo === "pilar");
  for (const r of k.casos) {
    if (!HORIZONTALES.includes(r.id)) continue;
    reacciones[r.id] = (c.modelo.apoyos ?? []).flatMap((a) => Array.from(r.reacciones.subarray(6 * a.nudo, 6 * a.nudo + 6)));
    const e: Record<string, number[]> = {};
    for (const { b, i, m } of barrasPilar) e[`${m!.pieza}:${m!.tramo}:${b.id}`] = Array.from(r.esfuerzosBarras.subarray(12 * i, 12 * i + 12));
    pilares[r.id] = e;
  }
  writeFileSync(process.argv[2]!, JSON.stringify({ laminasL2, nudos: c.modelo.nudos.length, reacciones, pilares }));
  console.log(`Escrito ${process.argv[2]}: ${laminasL2} láminas en L2`);
}
