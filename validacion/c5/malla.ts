/**
 * Tamaño de la malla con las bandas propuestas (C5, criterio 8; D5, D9): una planta del edificio
 * objetivo de C2 (10 × 8 pilares de 30 × 50, girados 0° o 90°, y de 40 × 40; luces de 6 × 5 m) en
 * tres variantes de forjado:
 * - losa plana: la maciza de 25 cm sin vigas (donde el Anejo I del EC2 aplica de verdad);
 * - maciza con vigas por todos los ejes y secundarias (`edificioObjetivoLosas`);
 * - reticular con ábacos y vigas (V2 de C4).
 * Para cada una: sin bandas, con sólo los contornos de las bandas (sin `apoyos`) y con sus caras
 * sembradas. Con las caras, además, cuántas caras dan un corte por fuerzas nodales válido.
 * Con `--plantas 7`, también el edificio entero con losa plana y con la maciza con vigas (D9), sin
 * integrar las caras.
 *
 * Uso: bun validacion/c5/malla.ts [--plantas 7] → validacion/c5/out_malla.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { proponerBandas } from "../../src/compilador/bandas.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosBandas } from "../../src/compilador/esfuerzosBandas.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { edificioReticular } from "../c4/modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const sinVigas = (f: ModeloFisico): ModeloFisico => ({ ...f, vigas: [], cargas: f.cargas!.filter((c) => c.tipo !== "viga") });
const modelos: [string, (plantas: number) => ModeloFisico][] = [
  ["losa plana", (n) => sinVigas(edificioObjetivoLosas(n))],
  ["maciza con vigas", (n) => edificioObjetivoLosas(n)],
  ["reticular con vigas", (n) => edificioReticular(n)],
];

const lineas: string[] = [];
const decir = (l = "") => {
  lineas.push(l);
  console.log(l);
};

function medir(nombre: string, f0: ModeloFisico, variantes: ("sin bandas" | "contornos" | "caras")[], cortes: boolean): void {
  const { bandas, diagnosticos } = proponerBandas({ ...f0, bandas: undefined });
  if (diagnosticos.some((d) => d.severidad === "error")) throw new Error(diagnosticos.map((d) => d.mensaje).join("\n"));
  for (const v of variantes) {
    const f: ModeloFisico = v === "sin bandas" ? { ...f0, bandas: undefined } : { ...f0, bandas: v === "contornos" ? bandas.map(({ apoyos: _a, ...b }) => b) : bandas };
    const t0 = performance.now();
    const r = compilar(f);
    const tc = performance.now() - t0;
    if (!r.valido) throw new Error(`${nombre}, ${v}: ${r.diagnosticos.filter((d) => d.severidad === "error").map((d) => `${d.codigo}: ${d.mensaje}`).join("\n")}`);
    const e = r.estadisticas;
    let caras = "";
    let ecuaciones = "";
    {
      const c = calcular(r.modelo);
      if (!c.valido) throw new Error(`${nombre}, ${v}: ${c.diagnosticos.map((d) => d.mensaje).join("\n")}`);
      ecuaciones = String(c.estadisticas.ecuaciones);
      if (v === "caras" && cortes) {
        const eb = new EsfuerzosBandas(f, r.modelo, casosValidos(c));
        let total = 0;
        let validas = 0;
        const t1 = performance.now();
        for (const id of eb.bandas)
          for (const s of eb.estaciones(id)!)
            if (s.tipo === "cara") {
              total++;
              if (s.valido) validas++;
            }
        caras = `${validas} de ${total} (${((performance.now() - t1) / 1000).toFixed(1)} s)`;
      }
    }
    decir(`${nombre} | ${v} | ${e.nudos} | ${ecuaciones} | ${e.malla.plantillas} | ${e.malla.jacobianoMin.toFixed(3)} | ${e.malla.bajos} | ${(tc / 1000).toFixed(1)} | ${caras}`);
  }
}

const plantas = process.argv.includes("--plantas") ? Number(process.argv[process.argv.indexOf("--plantas") + 1]) : 1;
decir(`# validacion/c5/malla.ts — ${new Date().toISOString().slice(0, 10)}: malla con las bandas propuestas (h por defecto, 0,75 m)`);
decir();
decir("modelo | bandas | nudos | ecuaciones | plantillas | jacobiano mín. | bajos | compilación (s) | caras válidas");
for (const [nombre, f] of modelos) medir(`${nombre}, 1 planta`, f(1), ["sin bandas", "contornos", "caras"], true);
if (plantas > 1) for (const [nombre, f] of modelos.slice(0, 2)) medir(`${nombre}, ${plantas} plantas`, f(plantas), ["sin bandas", "contornos", "caras"], false);
writeFileSync(join(import.meta.dirname, "out_malla.txt"), lineas.join("\n") + "\n", { encoding: "utf8" });
