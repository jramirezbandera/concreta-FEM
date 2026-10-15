/**
 * F3.3 (`docs/fem3d/spr-abacos.md` §14): la vivienda de Alhaurín, por franja y pilar que la toca, la
 * mayor superior de ELU en las estaciones junto al pilar (a ≤ ed + 0,6 m de su centro), con cada h, y
 * el tipo de estación que la da (`cara*`: una cara del pilar; `paso`: por campos). Los avisos de la
 * franja, con la primera malla.
 * Uso: bun validacion/abacos/vivienda.ts [h1 h2 …] > validacion/abacos/out_vivienda.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prepararNucleo } from "../a3/revisar.ts";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import { pilaresEnLosa, semiextension } from "../../src/compilador/bandas.ts";
import { resolverOpciones } from "../../src/compilador/fisico.ts";
import { validar } from "../../src/compilador/validar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";

await prepararNucleo();
const ruta = join(import.meta.dirname, "..", "..", "ejemplos", "vivienda", "proyecto.json");
const hs = process.argv.length > 2 ? process.argv.slice(2) : ["0.75", "0.375", "0.25"];
const lec = leerProyecto(readFileSync(ruta, "utf8"));
if (!lec.valido) throw new Error("proyecto");
const p = lec.proyecto;
const tabla = new Map<string, string[]>();
const valores = new Map<string, number[]>();
for (const hh of hs) {
  const op = { ...(p.opciones ?? {}), tamanoMalla: Number(hh) };
  const r = compilar(p.modelo, op);
  if (!r.valido) throw new Error(r.diagnosticos[0]!.mensaje);
  const k = calcular(r.modelo);
  if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
  const q = new Consultas(p.modelo, r, k.casos, op);
  const comb = q.combinaciones({ situaciones: ["ELU-PT"] });
  if (!comb.valido) throw new Error("comb");
  const F = comb.valor.map((c) => c.factores);
  const ctx = validar(p.modelo, resolverOpciones(op), new Diagnosticos())!;
  for (const l of ctx.losas) {
    const pil = pilaresEnLosa(ctx, l);
    const fs = q.franjas(l.losa.id);
    if (!fs.valido) continue;
    for (const f of fs.valor) {
      const e = q.franja(f.id);
      const a = q.armadoFranja(f.id, F);
      if (!e.valido || !a.valido) continue;
      const avisos = e.valor.diagnosticos.map((x) => x.codigo.replace("franja/", "")).join(",");
      for (const pp of pil) {
        const tc = pp.p[0] * f.n[0] + pp.p[1] * f.n[1];
        const en = semiextension(pp.huella, f.n);
        if (!(tc + en > f.t0 + 1e-6 && tc - en < f.t1 - 1e-6)) continue;
        const sc = pp.p[0] * f.d[0] + pp.p[1] * f.d[1];
        const ed = semiextension(pp.huella, f.d);
        let best = 0;
        let tipo = "-";
        e.valor.estaciones.forEach((x, i) => {
          if (Math.abs(x.s - sc) > ed + 0.6) return;
          const v = a.valor[i]!.superior;
          if (v > best) [best, tipo] = [v, `${x.tipo}${x.piezas.includes(pp.id) ? "*" : ""}@${x.s.toFixed(2)}`];
        });
        const clave = `${f.id} ${pp.id}`;
        if (!tabla.has(clave)) [tabla.set(clave, []), valores.set(clave, [])];
        tabla.get(clave)!.push(`${best.toFixed(1).padStart(6)} ${tipo.padEnd(12)}${hh === hs[0] ? " " + avisos : ""}`);
        valores.get(clave)!.push(best);
      }
    }
  }
}
console.log(`franja pilar | ${hs.map((h) => `h=${h}`.padEnd(20)).join("| ")} | error de la 1.ª frente a la última`);
for (const [c, t] of tabla) {
  const v = valores.get(c)!;
  const err = v[v.length - 1]! > 1 ? (100 * (v[0]! - v[v.length - 1]!)) / v[v.length - 1]! : 0;
  console.log(`${c.padEnd(16)} | ${t.join(" | ")} | ${err.toFixed(1)} %`);
}
