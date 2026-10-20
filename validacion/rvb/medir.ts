/**
 * RV-b (`docs/fem3d/fase-lv.md` §2.3): efecto de poner los nudos del forjado en su cara superior, con la
 * cabeza de los pilares rígida en todo el canto y la base en el nudo (`planoForjado: "superior"`, por
 * defecto), frente al plano medio con medio canto en la cabeza y en la base (`"medio"`, LVD1–ZR1), en
 * los edificios objetivo con las mismas cotas:
 * - el de barras de C1 (7 plantas, 80 pilares, `validacion/c1/banco.ts`): deriva de cabeza y desplome
 *   relativo máximo con Vx, esfuerzos de un pilar interior y de uno de esquina en la base y en la
 *   cabeza de los tramos de N1 (sobre la cimentación) y de N3 (en las caras, i' y j') con G y con Vx,
 *   y el momento de la viga interior X5-N3 en la cara del pilar con G;
 * - el reducido con losas de C2 (2 plantas, 3 × 2 vanos, `validacion/c2/modelos.ts`): lo mismo con
 *   G, Vx y la flecha máxima de la losa.
 * Entre dos forjados del mismo canto el tramo flexible mide lo mismo, medio canto más abajo; el
 * primero, sobre la cimentación, medio canto menos.
 *
 *   bun validacion/rvb/medir.ts > validacion/rvb/out_medir.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { EsfuerzosPiezas } from "../../src/compilador/resultados.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";
import { edificioObjetivo } from "../c1/banco.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const f1 = (v: number) => v.toFixed(1).padStart(7);
const f2 = (v: number) => v.toFixed(2).padStart(7);
const pct = (a: number, b: number) => `${(100 * (a / b - 1)).toFixed(1).padStart(6)} %`;

interface Medida {
  ecuaciones: number;
  deriva: number;
  desplome: number;
  /** `pilar@planta` → esfuerzos [N, Vy, Vz, T, My, Mz] en i' y j' por caso. */
  tramos: Record<string, { base: Float64Array; cabeza: Float64Array; s: [number, number] }>;
  vigaCara: number;
  flecha: number | null;
}

function medir(fisico: ModeloFisico, op: OpcionesCompilacion, pilares: string[], plantas: string[], viga: { id: string; s: number } | null, conLosa: boolean): Medida {
  const r = valido(compilar(fisico, op));
  const casos = casosValidos(calcular(r.modelo));
  const c = new Consultas(fisico, r, casos, op);
  const Vx = fisico.casos.findIndex((x) => x.id === "Vx");
  const cabeza = fisico.plantas[0]!.id;
  const factoresVx = fisico.casos.map((_, i) => (i === Vx ? 1 : 0));
  const n = r.mapeo.nudosPilar[`${pilares[0]}@${cabeza}`]!;
  const deriva = casos[Vx]!.u[6 * n]!;
  let desplome = 0;
  for (const p of fisico.plantas) {
    const d = c.desplomes(p.id, factoresVx);
    if (d.valido && d.valor.maximo) desplome = Math.max(desplome, Math.abs(d.valor.maximo.relativo));
  }
  const tramos: Medida["tramos"] = {};
  for (const id of pilares) {
    const t = c.pilar(id);
    if (!t.valido) throw new Error(id);
    for (const planta of plantas) {
      const tr = t.valor.find((x) => x.planta === planta)!;
      tramos[`${id}@${planta}`] = { base: tr.base.esfuerzos, cabeza: tr.cabeza.esfuerzos, s: [tr.base.s, tr.cabeza.s] };
    }
  }
  let vigaCara = 0;
  if (viga) {
    const e = new EsfuerzosPiezas(r.modelo, r.mapeo, casos);
    vigaCara = e.en(viga.id, 0, viga.s, -1)![4]!;
  }
  let flecha: number | null = null;
  if (conLosa) {
    const fl = c.flechas(fisico.losas![0]!.id, fisico.casos.map((_, i) => (i === 0 ? 1 : 0)));
    if (fl.valido) flecha = fl.valor.maxima?.flecha ?? null;
  }
  return { ecuaciones: r.modelo.nudos.length * 6, deriva, desplome, tramos, vigaCara, flecha };
}

function comparar(nombre: string, fisico: ModeloFisico, pilares: string[], plantas: string[], viga: { id: string; s: number } | null, conLosa: boolean) {
  const G = 0;
  const Vx = fisico.casos.findIndex((x) => x.id === "Vx");
  const sup = medir(fisico, {}, pilares, plantas, viga, conLosa);
  const med = medir(fisico, { planoForjado: "medio" }, pilares, plantas, viga, conLosa);
  console.log(`\n${nombre}: nudos ${sup.ecuaciones / 6} (${med.ecuaciones / 6} con el plano medio)`);
  console.log(`  Deriva de cabeza con Vx (${pilares[0]}): medio ${(1000 * med.deriva).toFixed(2)} mm, superior ${(1000 * sup.deriva).toFixed(2)} mm (${pct(sup.deriva, med.deriva)})`);
  console.log(`  Desplome relativo máximo con Vx: medio ${(1000 * med.desplome).toFixed(3)} ‰, superior ${(1000 * sup.desplome).toFixed(3)} ‰ (${pct(sup.desplome, med.desplome)})`);
  if (viga) console.log(`  Viga ${viga.id} en la cara del pilar (s = ${viga.s}), My con G: medio ${med.vigaCara.toFixed(2)}, superior ${sup.vigaCara.toFixed(2)} kN·m (${pct(sup.vigaCara, med.vigaCara)})`);
  if (sup.flecha !== null && med.flecha !== null) console.log(`  Flecha máxima de la losa con G: medio ${(1000 * med.flecha).toFixed(2)} mm, superior ${(1000 * sup.flecha).toFixed(2)} mm (${pct(sup.flecha, med.flecha)})`);
  console.log(`  Tramos de ${plantas.join(" y ")} (esfuerzos en i' y j'; s en m desde el arranque):`);
  console.log(`  ${"tramo".padEnd(11)} ${"caso".padEnd(4)} ${"".padEnd(8)} ${"s base".padStart(7)} ${"N".padStart(7)} ${"Vz".padStart(7)} ${"My".padStart(7)} | ${"s cab.".padStart(7)} ${"N".padStart(7)} ${"Vz".padStart(7)} ${"My".padStart(7)}`);
  for (const id of pilares)
    for (const planta of plantas)
      for (const [k, caso] of [
        [G, "G"],
        [Vx, "Vx"],
      ] as const)
        for (const [m, que] of [
          [med, "medio"],
          [sup, "superior"],
        ] as const) {
          const t = m.tramos[`${id}@${planta}`]!;
          const b = t.base.subarray(6 * k, 6 * k + 6);
          const h = t.cabeza.subarray(6 * k, 6 * k + 6);
          console.log(`  ${`${id}@${planta}`.padEnd(11)} ${caso.padEnd(4)} ${que.padEnd(8)} ${f2(t.s[0])} ${f1(b[0]!)} ${f1(b[2]!)} ${f1(b[4]!)} | ${f2(t.s[1])} ${f1(h[0]!)} ${f1(h[2]!)} ${f1(h[4]!)}`);
        }
}

console.log("RV-b: los nudos del forjado en su cara superior (superior) frente a su plano medio (medio), con las mismas cotas. kN, kN·m.");
comparar("Edificio objetivo de barras (7 plantas, 80 pilares)", edificioObjetivo(), ["P24-20", "P0-0"], ["N1", "N3"], { id: "X5-N3", s: 5.8 }, false);
comparar("Edificio reducido con losas (2 plantas, 3 × 2 vanos)", edificioObjetivoLosas(2, 3, 2), ["P6-5", "P0-0"], ["N1", "N2"], null, true);
