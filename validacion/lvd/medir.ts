/**
 * LV-d (`docs/fem3d/fase-lv.md` §2.2): efecto de la zona rígida en la base de los tramos de pilar
 * sobre los edificios objetivo, con y sin ella (`zonaRigidaBase`):
 * - el de barras de C1 (7 plantas, 80 pilares, `validacion/c1/banco.ts`): deriva de cabeza y desplome
 *   relativo máximo con Vx, esfuerzos de un pilar interior y de uno de esquina en la base y en la
 *   cabeza del tramo de N3 (en las caras, i' y j') con G y con Vx, el momento de la viga interior
 *   X5-N3 en la cara del pilar con G, y las ecuaciones;
 * - el reducido con losas de C2 (2 plantas, 3 × 2 vanos, `validacion/c2/modelos.ts`): lo mismo con
 *   G, Vx y la flecha máxima de la losa.
 * El tramo flexible de cada tramo intermedio pierde f · canto en la base (0,25 m con vigas de 0,50;
 * 0,15 con la losa de 0,30), así que los pilares salen algo más rígidos frente a lo horizontal y los
 * esfuerzos de la base se dan en la cara del forjado, no en el eje. Desde RV-b (compilador RV1), con
 * los nudos del forjado en su plano medio (`planoForjado: "medio"`), el único en el que la base tiene
 * zona; lo de RV-b, en `validacion/rvb/medir.ts`.
 *
 *   bun validacion/lvd/medir.ts > validacion/lvd/out_medir.txt
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
  /** [pieza, tramo] → esfuerzos [N, Vy, Vz, T, My, Mz] en i' y j' por caso. */
  tramos: Record<string, { base: Float64Array; cabeza: Float64Array; s: [number, number] }>;
  vigaCara: number;
  flecha: number | null;
}

function medir(fisico: ModeloFisico, op: OpcionesCompilacion, pilares: string[], planta: string, viga: { id: string; s: number } | null, conLosa: boolean): Medida {
  const r = valido(compilar(fisico, op));
  const casos = casosValidos(calcular(r.modelo));
  const c = new Consultas(fisico, r, casos, op);
  const Vx = fisico.casos.findIndex((x) => x.id === "Vx");
  const cabeza = fisico.plantas[0]!.id;
  const factoresVx = fisico.casos.map((_, i) => (i === Vx ? 1 : 0));
  const dCab = c.desplomes(cabeza, factoresVx);
  const n = r.mapeo.nudosPilar[`${pilares[0]}@${cabeza}`]!;
  const deriva = casos[Vx]!.u[6 * n]!;
  let desplome = 0;
  for (const p of fisico.plantas) {
    const d = c.desplomes(p.id, factoresVx);
    if (d.valido && d.valor.maximo) desplome = Math.max(desplome, Math.abs(d.valor.maximo.relativo));
  }
  if (!dCab.valido) throw new Error("sin desplomes");
  const tramos: Medida["tramos"] = {};
  for (const id of pilares) {
    const t = c.pilar(id);
    if (!t.valido) throw new Error(id);
    const tr = t.valor.find((x) => x.planta === planta)!;
    tramos[id] = { base: tr.base.esfuerzos, cabeza: tr.cabeza.esfuerzos, s: [tr.base.s, tr.cabeza.s] };
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

function comparar(nombre: string, fisico: ModeloFisico, pilares: string[], planta: string, viga: { id: string; s: number } | null, conLosa: boolean) {
  const G = 0;
  const Vx = fisico.casos.findIndex((x) => x.id === "Vx");
  const con = medir(fisico, { planoForjado: "medio" }, pilares, planta, viga, conLosa);
  const sin = medir(fisico, { zonaRigidaBase: false, planoForjado: "medio" }, pilares, planta, viga, conLosa);
  console.log(`\n${nombre}: nudos ${con.ecuaciones / 6} (${sin.ecuaciones / 6} sin la base)`);
  console.log(`  Deriva de cabeza con Vx (${pilares[0]}): sin ${(1000 * sin.deriva).toFixed(2)} mm, con ${(1000 * con.deriva).toFixed(2)} mm (${pct(con.deriva, sin.deriva)})`);
  console.log(`  Desplome relativo máximo con Vx: sin ${(1000 * sin.desplome).toFixed(3)} ‰, con ${(1000 * con.desplome).toFixed(3)} ‰ (${pct(con.desplome, sin.desplome)})`);
  if (viga) console.log(`  Viga ${viga.id} en la cara del pilar (s = ${viga.s}), My con G: sin ${sin.vigaCara.toFixed(2)}, con ${con.vigaCara.toFixed(2)} kN·m (${pct(con.vigaCara, sin.vigaCara)})`);
  if (con.flecha !== null && sin.flecha !== null) console.log(`  Flecha máxima de la losa con G: sin ${(1000 * sin.flecha).toFixed(2)} mm, con ${(1000 * con.flecha).toFixed(2)} mm (${pct(con.flecha, sin.flecha)})`);
  console.log(`  Tramo de ${planta} (esfuerzos en i' y j'; s en m desde el arranque):`);
  console.log(`  ${"pilar".padEnd(8)} ${"caso".padEnd(4)} ${"".padEnd(6)} ${"s base".padStart(7)} ${"N".padStart(7)} ${"Vz".padStart(7)} ${"My".padStart(7)} | ${"s cab.".padStart(7)} ${"N".padStart(7)} ${"Vz".padStart(7)} ${"My".padStart(7)}`);
  for (const id of pilares)
    for (const [k, caso] of [
      [G, "G"],
      [Vx, "Vx"],
    ] as const)
      for (const [m, que] of [
        [sin, "sin"],
        [con, "con"],
      ] as const) {
        const t = m.tramos[id]!;
        const b = t.base.subarray(6 * k, 6 * k + 6);
        const h = t.cabeza.subarray(6 * k, 6 * k + 6);
        console.log(`  ${id.padEnd(8)} ${caso.padEnd(4)} ${que.padEnd(6)} ${f2(t.s[0])} ${f1(b[0]!)} ${f1(b[2]!)} ${f1(b[4]!)} | ${f2(t.s[1])} ${f1(h[0]!)} ${f1(h[2]!)} ${f1(h[4]!)}`);
      }
}

console.log("LV-d: zona rígida en la base de los tramos de pilar (con) frente a sólo en la cabeza (sin). kN, kN·m.");
comparar("Edificio objetivo de barras (7 plantas, 80 pilares)", edificioObjetivo(), ["P24-20", "P0-0"], "N3", { id: "X5-N3", s: 5.8 }, false);
comparar("Edificio reducido con losas (2 plantas, 3 × 2 vanos)", edificioObjetivoLosas(2, 3, 2), ["P6-5", "P0-0"], "N2", null, true);
