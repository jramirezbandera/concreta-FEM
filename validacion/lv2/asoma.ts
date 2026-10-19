/**
 * LV2-f (`docs/fem3d/refinamiento-vigas.md` §9 y §10) y fase HR (criterio 5 de `huella-rigida.md`):
 * la precisión local junto a los pilares en las 24 retículas al azar de G, con h = 0,75 frente a LV2
 * con h = 0,25: el momento de las vigas en las caras de sus pilares y las estaciones de apoyo y de
 * cara de las franjas junto a cada pilar (la superior de 1,35·G + 1,5·Q), respecto al máximo de la
 * viga o de la franja, como en `franjas.ts`. Desde §14, el metro de un pilar tapado cuya huella cruza
 * la cara de la viga es una estación de cara (antes su parte iba en la de apoyo, según la malla), así
 * que las dos se miden.
 * - LV1 (`refinoEsquinas: false`): sin plantillas de esquina;
 * - LV2: con las esquinas.
 * Hasta la fase HR, LV1 llevaba la regla de antes de C2-d (rígidos también los nudos de fuera de la
 * huella a ≤ ε_snap) y LV2 la quitaba sólo en los pilares con viga (LV2-f); desde HR, sólo la huella
 * es rígida en todos los pilares y con todas las opciones, y se miden también los pilares sin viga por
 * su centro (antes, sólo los que asoman de la suya). Cuenta los nudos rígidos de cada huella fuera de
 * ella, sin los de las caras de las vigas en su zona rígida en el pilar (C1-a, `unirCaras`).
 *
 * La medida que decidió LV2-f (A: la regla de antes con las esquinas; C y D: no sembrar lo que asoma)
 * está en §9 y en el `out_asoma.txt` del commit 1f46a20; la de antes de HR, en el de la fase LV2.
 * La medida está en `src/pruebas/precisionLocal.ts` (la comparte `precision.test.ts`).
 *
 *   bun validacion/lv2/asoma.ts > validacion/lv2/out_asoma.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { diferenciasLocales, medirLocal, pilaresMedidos, type MedidaLocal, type Valor } from "../../src/pruebas/precisionLocal.ts";
import { reticulaAleatoria } from "../../src/pruebas/reticulasAleatorias.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const pct = (v: number) => `${(100 * v).toFixed(1)} %`;
const med = (v: number[]) => [...v].map(Math.abs).sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? NaN;
const max = (v: number[]) => Math.max(0, ...v.map(Math.abs));
const col = (v: number[]) => `${pct(med(v))} / ${pct(max(v))}`.padStart(18);
const d = (x: { d: number }[]) => x.map((y) => y.d);

type Dif = { s: number; k: string; d: number };
const VARIANTES: [string, OpcionesCompilacion][] = [
  ["LV1", { refinoEsquinas: false }],
  ["LV2", { refinoEsquinas: true }],
];
const REF: OpcionesCompilacion = { tamanoMalla: 0.25, refinoEsquinas: true };
const GRUPOS = ["vigas", "franjas con viga", "franjas sin viga", "franjas de los que asoman"] as const;
const err = new Map<string, Map<string, Dif[]>>(GRUPOS.map((g) => [g, new Map(VARIANTES.map(([n]) => [n, []]))]));
/** El grupo «de los que asoman» (el de LV2-f, para comparar con `out_asoma.txt` de antes de HR) es parte del «con viga». */
let asomanActual = new Set<string>();
const grupo = (m: MedidaLocal, g: (typeof GRUPOS)[number]): Map<string, Valor> =>
  g === "vigas" ? m.vigas : g === "franjas de los que asoman" ? new Map([...m.franjas].filter(([k]) => asomanActual.has(k))) : new Map([...m.franjas].filter(([k]) => m.franjasConViga.has(k) === (g === "franjas con viga")));

console.log("## Precisión local junto a los pilares, en las retículas al azar de G\n");
console.log("h = 0,75 frente a LV2 con h = 0,25. LV1: sin esquinas; LV2: con las esquinas. Sólo la huella es rígida en los dos (fase HR). Diferencias respecto al máximo de la viga o de la franja; mediana / máximo. «Con viga»: pilares que atraviesa una viga por su centro (entre ellos, los que asoman de ella).\n");
console.log(`${"ret.".padEnd(5)}${"pil. (asoman / con viga / sin)".padStart(32)}${"rígidos fuera LV1 / LV2".padStart(25)}${"jac. mín. LV1 / LV2".padStart(22)}${"nudos LV1 / LV2".padStart(16)}   vigas LV1 | LV2      franjas con viga LV1 | LV2      franjas sin viga LV1 | LV2      franjas de los que asoman LV1 | LV2`);
for (let s = 1; s <= 24; s++) {
  const f = reticulaAleatoria(s);
  const pil = pilaresMedidos(f);
  const n = [pil.filter((p) => p.asoma).length, pil.filter((p) => p.vigas.length).length, pil.filter((p) => !p.vigas.length).length];
  process.stderr.write(`retícula ${s}\n`);
  const ref = medirLocal(f, REF, pil);
  // Las estaciones de los pilares que asoman: las que da la medida de sólo esos pilares
  asomanActual = new Set(n[0] ? medirLocal(f, REF, pil.filter((p) => p.asoma)).franjas.keys() : []);
  const m = new Map(VARIANTES.map(([nombre, op]) => [nombre, medirLocal(f, op, pil)] as const));
  for (const [nombre] of VARIANTES) for (const g of GRUPOS) err.get(g)!.get(nombre)!.push(...diferenciasLocales(grupo(m.get(nombre)!, g), grupo(ref, g)).map((x) => ({ s, ...x })));
  const [A, B] = [m.get("LV1")!, m.get("LV2")!];
  const e = (x: MedidaLocal, g: (typeof GRUPOS)[number]) => col(d(diferenciasLocales(grupo(x, g), grupo(ref, g))));
  console.log(
    `${String(s).padEnd(5)}${`${n[0]} / ${n[1]} / ${n[2]}`.padStart(32)}${`${A.rigidosFuera} / ${B.rigidosFuera}`.padStart(25)}${`${A.jacobiano.toFixed(2)} / ${B.jacobiano.toFixed(2)}`.padStart(22)}${`${A.nudos} / ${B.nudos}`.padStart(16)}   ${GRUPOS.map((g) => [A, B].map((x) => e(x, g)).join(" |")).join("   ")}`,
  );
}
const masDe = (v: number[], u: number) => v.filter((x) => Math.abs(x) > u).length;
for (const g of GRUPOS) {
  const por = err.get(g)!;
  console.log(`\n### ${g} (${por.get("LV2")!.length} estaciones)\n`);
  console.log(`| | mediana / máximo | > 10 % | > 20 % |`);
  console.log(`|---|---|---|---|`);
  for (const [nombre] of VARIANTES) console.log(`| ${nombre}, h = 0,75, frente a la referencia |${col(d(por.get(nombre)!))} | ${masDe(d(por.get(nombre)!), 0.1)} | ${masDe(d(por.get(nombre)!), 0.2)} |`);
  if (g !== "vigas")
    for (const tipo of ["cara", "apoyo"]) {
      const de = (nombre: string) => d(por.get(nombre)!.filter((x) => x.k.endsWith(` ${tipo}`)));
      console.log(`- estaciones de ${tipo} (${de("LV2").length}): ${VARIANTES.map(([n]) => `${n} ${col(de(n)).trim()}, > 10 % / 20 %: ${masDe(de(n), 0.1)} / ${masDe(de(n), 0.2)}`).join("; ")}`);
    }
  console.log(`\nLas diez peores de LV2 (retícula, estación; LV2 y LV1 frente a la referencia)`);
  const lv1 = (x: Dif) => por.get("LV1")!.find((y) => y.s === x.s && y.k === x.k)?.d ?? NaN;
  for (const x of [...por.get("LV2")!].sort((p, q) => Math.abs(q.d) - Math.abs(p.d)).slice(0, 10)) console.log(`   ${String(x.s).padStart(2)}  ${x.k.padEnd(34)} LV2 ${pct(x.d).padStart(8)}   LV1 ${pct(lv1(x)).padStart(8)}`);
}
