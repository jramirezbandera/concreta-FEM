/**
 * C5.2 en la losa plana de H25 (12 × 12 m, t = 0,25 m, 3 × 3 pilares de 0,6 × 0,6, q = 10 kN/m²;
 * `validacion/c2/losaPlana.ts`), ahora con las bandas que propone el compilador (C5.1) en vez de
 * las dibujadas a mano:
 * - las bandas propuestas (la de pilares interior sale de 3 m, como la de H25);
 * - momento en la cara x = 6,3 del pilar central de la banda de pilares y de las centrales vecinas,
 *   con h = 1, 0,5 y 0,25 m: convergencia y reparto (H25: 261 kN·m de 337 en el pórtico virtual, el
 *   77 %, dentro del 60–80 % de la tabla I.1);
 * - Wood–Armer (a) con los momentos medios frente a (b) punto a punto, en la cara y en el vano
 *   (C5-c, criterio 3).
 *
 * Uso: bun validacion/c5/bandas.ts → validacion/c5/out_bandas.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { proponerBandas } from "../../src/compilador/bandas.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosBandas, woodArmerEstacion, type EstacionResultado } from "../../src/compilador/esfuerzosBandas.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { losaPlanaFisica, OPCIONES_LOSA_PLANA } from "../c2/losaPlana.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const lineas: string[] = [];
const decir = (l = "") => lineas.push(l);
const base = { ...losaPlanaFisica(), bandas: undefined };
const { bandas, diagnosticos } = proponerBandas(base);
decir(`# validacion/c5/bandas.ts — ${new Date().toISOString().slice(0, 10)}: bandas propuestas en la losa plana de H25`);
decir();
decir(`Diagnósticos de la propuesta: ${diagnosticos.length ? diagnosticos.map((d) => d.codigo).join(", ") : "ninguno"}`);
decir();
decir("banda | tipo | eje | ancho (m) | apoyos (m desde el comienzo)");
for (const b of bandas) decir(`${b.id} | ${b.tipo} | (${b.desde.join(", ")}) → (${b.hasta.join(", ")}) | ${b.ancho} | ${(b.apoyos ?? []).map(([a, c]) => `${a}–${c}`).join(", ")}`);

const enCara = (e: EstacionResultado[], s: number) => e.find((x) => x.tipo === "cara" && Math.abs(x.s - s) < 1e-6)!;
const fisico = { ...base, bandas };
decir();
decir("## Cara x = 6,3 del pilar central (dirección 1, alineación y = 6), caso q");
decir();
decir("h (m) | banda de pilares 3 m (kN·m) | centrales C1-2 + C2-3 (kN·m) | pórtico virtual de 6 m, corte exacto (kN·m) | pilares / pórtico | toda la losa (kN·m) | WA cara, superior X: (a) / (b) (kN·m/m) | WA vano, inferior X: (a) / (b)");
let ultimo: { eb: EsfuerzosBandas } | null = null;
const Z = 3;
for (const h of [1, 0.5, 0.25]) {
  const r = compilar(fisico, { ...OPCIONES_LOSA_PLANA, tamanoMalla: h });
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(calcular(r.modelo));
  const eb = new EsfuerzosBandas(fisico, r.modelo, casos);
  const M = (id: string) => {
    const b = bandas.find((x) => x.id === id)!;
    const s = 6.3 - b.desde[0];
    return enCara(eb.estaciones(id)!, s).esfuerzos[4]!;
  };
  const [P, C1, C2] = [M("LOSA:1:P2"), M("LOSA:1:C1-2"), M("LOSA:1:C2-3")];
  const toda = bandas.filter((b) => b.id.startsWith("LOSA:1:")).reduce((a, b) => a + M(b.id), 0);
  const portico = new Cortes(r.modelo).cortar({ origen: [6.3, 6, Z], x: [1, 0, 0], vz: [0, 0, 1], y: [-3, 3], z: [0, 0] }, casos).esfuerzos[4]!;
  const est = eb.estaciones("LOSA:1:P2")!;
  const wa = (e: EstacionResultado, m: "medios" | "puntos") => woodArmerEstacion(e, [Float64Array.from([1])], m).porCombinacion[0]!;
  const [cara, vano] = [enCara(est, 6.3), est.find((x) => x.tipo === "vano" && x.s > 6.3)!];
  decir(`${h} | ${P.toFixed(1)} | ${(C1 + C2).toFixed(1)} | ${portico.toFixed(1)} | ${((100 * P) / portico).toFixed(1)} % | ${toda.toFixed(1)} | ${wa(cara, "medios").superiorX.toFixed(1)} / ${wa(cara, "puntos").superiorX.toFixed(1)} | ${wa(vano, "medios").inferiorX.toFixed(1)} / ${wa(vano, "puntos").inferiorX.toFixed(1)}`);
  ultimo = { eb };
}

decir();
decir("## Wood–Armer en la banda de pilares interior (h = 0,25), caso q (kN·m/m)");
decir();
decir("estación | s (m) | método | inferior X | inferior Y | superior X | superior Y");
const eb = ultimo!.eb;
const est = eb.estaciones("LOSA:1:P2")!;
for (const e of [enCara(est, 6.3), est.find((x) => x.tipo === "vano" && x.s > 6.3)!]) {
  for (const metodo of ["medios", "puntos"] as const) {
    const w = woodArmerEstacion(e, [Float64Array.from([1])], metodo).porCombinacion[0]!;
    decir(`${e.tipo} | ${e.s.toFixed(2)} | ${metodo === "medios" ? "(a) medios" : "(b) puntos"} | ${w.inferiorX.toFixed(1)} | ${w.inferiorY.toFixed(1)} | ${w.superiorX.toFixed(1)} | ${w.superiorY.toFixed(1)}`);
  }
}
decir();
decir("Referencia: la rejilla fina de E5 (h = 0,075 m) con el mismo modelo, en la cara: banda de pilares de 3 m −205,58 kN·m y pórtico de 6 m −262,71 (`validacion/c2/out_losa_plana.txt`); la banda de pilares lleva el 78,3 %. Las cifras de la tabla de H25 (211 / 264 / 261 y 331 / 337 / 337) son de su experimento con PyNite, con otro pilar.");

const salida = lineas.join("\n") + "\n";
writeFileSync(join(import.meta.dirname, "out_bandas.txt"), salida);
console.log(salida);
