/**
 * SP-7 (`docs/fem3d/spr-abacos.md` §15): qué cambia en la referencia congelada de F al hacer las
 * regiones SPR por campo (flexión para M y Q, membrana para N). Sólo deberían moverse los reticulares
 * «uniformes» (CY3), en los que el ábaco y el aligerado pasan a ser una sola región de flexión: en
 * ellos cambia lo que sale por campos (las estaciones de paso enteras, y el my y el mxy de las de cara
 * y apoyo), y nunca el mx de cara y apoyo, que va por fuerzas nodales. Por modelo, frente al fixture
 * de antes: la malla (no debería cambiar), el conjunto de estaciones (tampoco), el mx de cara y apoyo
 * que se mueve, cuántas estaciones de cada tipo cambian y cuánto (superior e inferior de Wood–Armer
 * con la suma de los casos, sobre el máximo de su franja), con las cinco que más.
 * Uso: bun validacion/f/cambiosRegiones.ts > validacion/f/out_cambiosRegiones.txt (antes de regenerar el fixture)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { redondeo } from "../c5/congelar.ts";
import { MODELOS_CONGELADOS_F, referenciaF, type ReferenciaF } from "./congelar.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const antes = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-f.json"), "utf8")) as Record<string, ReferenciaF>;
const pc = (x: number) => `${(100 * x).toFixed(1)} %`;
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;

type Est = ReferenciaF["franjas"][string]["estaciones"][number];
const clave = (e: Est) => `${e.tipo}${e.s.toFixed(6)}:${e.lado}`;

let modelosQueCambian = 0;
for (const [k, f] of Object.entries(MODELOS_CONGELADOS_F)) {
  const a = antes[k]!;
  const b = JSON.parse(JSON.stringify(referenciaF(f), redondeo)) as ReferenciaF;
  const malla = JSON.stringify(a.c2.modelo) === JSON.stringify(b.c2.modelo);
  const resultados = JSON.stringify(a.c2.casos) === JSON.stringify(b.c2.casos);
  let mxCaraMueve = 0;
  let conjunto = true;
  const cambios: { id: string; est: string; tipo: string; dSup: number; dInf: number; supA: number; supB: number }[] = [];
  const porTipo = new Map<string, { n: number; cambian: number }>();
  for (const id of Object.keys(b.franjas)) {
    const x = a.franjas[id];
    const y = b.franjas[id]!;
    if (!x) {
      conjunto = false;
      continue;
    }
    const maxSup = Math.max(1, ...x.wa.map((w) => w[1] ?? 0));
    const maxInf = Math.max(1, ...x.wa.map((w) => w[0] ?? 0));
    const porClave = new Map(x.estaciones.map((e, i) => [clave(e), i]));
    if (x.estaciones.length !== y.estaciones.length) conjunto = false;
    y.estaciones.forEach((e, j) => {
      const i = porClave.get(clave(e));
      if (i === undefined) {
        conjunto = false;
        return;
      }
      const e0 = x.estaciones[i]!;
      let t = porTipo.get(e.tipo);
      if (!t) porTipo.set(e.tipo, (t = { n: 0, cambian: 0 }));
      t.n++;
      // mx por caso (medios[3k]) de las estaciones de cara y de apoyo va por fuerzas nodales: no se mueve
      if (e.tipo !== "paso") for (let kc = 0; 3 * kc < e.medios.length; kc++) if (Math.abs(e.medios[3 * kc]! - e0.medios[3 * kc]!) > 1e-9 * Math.max(1, Math.abs(e0.medios[3 * kc]!))) mxCaraMueve++;
      const [infA, supA] = x.wa[i]!;
      const [infB, supB] = y.wa[j]!;
      if (infA === null || supA === null || infB === null || supB === null) return;
      const dSup = (supB - supA) / maxSup;
      const dInf = (infB - infA) / maxInf;
      if (Math.abs(dSup) > 1e-9 || Math.abs(dInf) > 1e-9) {
        t.cambian++;
        cambios.push({ id, est: clave(e), tipo: e.tipo, dSup, dInf, supA, supB });
      }
    });
  }
  if (Object.keys(a.franjas).length !== Object.keys(b.franjas).length) conjunto = false;
  const identico = JSON.stringify(a) === JSON.stringify(b);
  if (!identico) modelosQueCambian++;
  console.log(`\n== ${k}: ${identico ? "idéntico al byte" : "cambia"}${malla ? "" : " (¡la malla cambia!)"}${resultados ? "" : " (¡los resultados de los casos cambian!)"}${conjunto ? "" : " (¡el conjunto de estaciones cambia!)"}`);
  if (identico) continue;
  console.log(`  mx de cara y apoyo que se mueve: ${mxCaraMueve}`);
  for (const [tipo, t] of porTipo) console.log(`  ${tipo.padEnd(6)}: ${t.cambian} de ${t.n} estaciones cambian`);
  if (cambios.length) {
    const dS = cambios.map((c) => c.dSup);
    const dI = cambios.map((c) => c.dInf);
    console.log(`  superior: mediana ${pc(med(dS))}, de ${pc(Math.min(...dS))} a ${pc(Math.max(...dS))}; |cambio| > 5 %: ${dS.filter((x) => Math.abs(x) > 0.05).length}, > 10 %: ${dS.filter((x) => Math.abs(x) > 0.1).length}`);
    console.log(`  inferior: mediana ${pc(med(dI))}, de ${pc(Math.min(...dI))} a ${pc(Math.max(...dI))}`);
    console.log("  las cinco que más cambian la superior:");
    for (const c of [...cambios].sort((p, q) => Math.abs(q.dSup) - Math.abs(p.dSup)).slice(0, 5)) console.log(`    ${c.id.padEnd(18)} ${c.est.padEnd(24)} ${c.supA.toFixed(2).padStart(8)} → ${c.supB.toFixed(2).padStart(8)}   ${pc(c.dSup).padStart(8)}`);
  }
}
console.log(`\nEn total cambian ${modelosQueCambian} de ${Object.keys(MODELOS_CONGELADOS_F).length} modelos.`);
