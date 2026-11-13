/**
 * A2-24 (`docs/fem3d/auditoria-2.md` §11.2): la θ del art. 3.8 de la NCSE-02 en una planta `escalon`.
 * La vivienda (dos cubiertas a 3,40 y 4,30) con un sismo de prueba: por nivel, la deriva, la altura y la
 * θ que da `Consultas.sismo()`.
 * Uso: bun validacion/au2/thetaEscalon.ts > validacion/au2/out_thetaEscalon.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";

const raiz = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const p = JSON.parse(readFileSync(join(raiz, "ejemplos", "vivienda", "proyecto.json"), "utf8")) as { modelo: ModeloFisico };
const f: ModeloFisico = { ...p.modelo, acciones: { ...p.modelo.acciones, sismo: { ab: 0.11, K: 1, terreno: "II", mu: 2 } } } as ModeloFisico;
const c = compilar(f);
if (!c.valido) throw new Error(c.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join("\n"));
const r = calcular(c.modelo);
if (!r.valido) throw new Error("no calcula");
const s = new Consultas(f, c, r.casos, {}, r.modal).sismo();
if (!s.valido) throw new Error(JSON.stringify(s.diagnosticos));
for (const d of s.valor.direcciones) {
  console.log(`== ${d.eje}: θ máx ${d.thetaMaxima.toFixed(4)}, desplazamiento máx ${(1000 * d.desplazamientoMaximo).toFixed(2)} mm`);
  for (const n of d.niveles)
    console.log(`  ${n.plantas.join("/").padEnd(8)} z ${n.cota.toFixed(2)}  P ${(n.masa * 9.80665).toFixed(0).padStart(5)} kN(nivel)  V ${n.cortante.toFixed(1).padStart(6)}  d ${(1000 * n.deriva).toFixed(3)} mm  h ${n.altura.toFixed(2)}  d/h ${(n.deriva / n.altura).toExponential(3)}  θ ${n.theta.toFixed(4)}`);
}
