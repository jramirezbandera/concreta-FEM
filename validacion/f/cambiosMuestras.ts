/**
 * LV2-h (`docs/fem3d/refinamiento-vigas.md` §12): qué cambia en la referencia congelada de F al tomar
 * my y mxy de las caras y los apoyos a un canto de la cara en vez de a δ. Por modelo, frente al fixture
 * de antes: la malla, los mx (no deberían moverse), las estaciones de paso (tampoco) y, en las de cara
 * y apoyo, cuántas cambian y cuánto (superior e inferior de Wood–Armer con la suma de los casos, sobre
 * el máximo de su franja), con las cinco que más.
 * Uso: bun validacion/f/cambiosMuestras.ts > validacion/f/out_cambiosMuestras.txt (antes de regenerar el fixture)
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

let totalCaras = 0;
let totalCambian = 0;
for (const [k, f] of Object.entries(MODELOS_CONGELADOS_F)) {
  const a = antes[k]!;
  const b = JSON.parse(JSON.stringify(referenciaF(f), redondeo)) as ReferenciaF;
  const malla = JSON.stringify(a.c2.modelo) === JSON.stringify(b.c2.modelo);
  let mxMueve = 0;
  let pasoMueve = 0;
  let caras = 0;
  const cambios: { id: string; est: string; dSup: number; dInf: number; supA: number; supB: number }[] = [];
  for (const id of Object.keys(b.franjas)) {
    const x = a.franjas[id];
    const y = b.franjas[id]!;
    if (!x) {
      console.log(`  ${id}: nueva`);
      continue;
    }
    const maxSup = Math.max(1, ...x.wa.map((w) => w[1] ?? 0));
    const maxInf = Math.max(1, ...x.wa.map((w) => w[0] ?? 0));
    const porClave = new Map(x.estaciones.map((e, i) => [clave(e), i]));
    y.estaciones.forEach((e, j) => {
      const i = porClave.get(clave(e));
      if (i === undefined) {
        console.log(`  ${id}: estación nueva ${clave(e)}`);
        return;
      }
      const e0 = x.estaciones[i]!;
      // mx por caso (medios[3k]) no debería moverse en ninguna estación
      for (let kc = 0; 3 * kc < e.medios.length; kc++) if (Math.abs(e.medios[3 * kc]! - e0.medios[3 * kc]!) > 1e-9 * Math.max(1, Math.abs(e0.medios[3 * kc]!))) mxMueve++;
      const [infA, supA] = x.wa[i]!;
      const [infB, supB] = y.wa[j]!;
      if (infA === null || supA === null || infB === null || supB === null) return;
      const dSup = (supB - supA) / maxSup;
      const dInf = (infB - infA) / maxInf;
      if (e.tipo === "paso") {
        if (Math.abs(dSup) > 1e-9 || Math.abs(dInf) > 1e-9) pasoMueve++;
        return;
      }
      caras++;
      if (Math.abs(dSup) > 1e-6 || Math.abs(dInf) > 1e-6) cambios.push({ id, est: clave(e), dSup, dInf, supA, supB });
    });
  }
  totalCaras += caras;
  totalCambian += cambios.length;
  const dS = cambios.map((c) => c.dSup);
  const dI = cambios.map((c) => c.dInf);
  console.log(`\n== ${k}${malla ? " (malla idéntica)" : " (¡la malla cambia!)"}: mx que se mueven: ${mxMueve}; estaciones de paso que se mueven: ${pasoMueve}`);
  console.log(`  estaciones de cara y apoyo: ${caras}; cambian: ${cambios.length}`);
  if (cambios.length) {
    console.log(`  superior: mediana ${pc(med(dS))}, de ${pc(Math.min(...dS))} a ${pc(Math.max(...dS))}; |cambio| > 5 %: ${dS.filter((x) => Math.abs(x) > 0.05).length}, > 10 %: ${dS.filter((x) => Math.abs(x) > 0.1).length}`);
    console.log(`  inferior: mediana ${pc(med(dI))}, de ${pc(Math.min(...dI))} a ${pc(Math.max(...dI))}`);
    console.log("  las cinco que más cambian la superior:");
    for (const c of [...cambios].sort((p, q) => Math.abs(q.dSup) - Math.abs(p.dSup)).slice(0, 5)) console.log(`    ${c.id.padEnd(18)} ${c.est.padEnd(24)} ${c.supA.toFixed(2).padStart(8)} → ${c.supB.toFixed(2).padStart(8)}   ${pc(c.dSup).padStart(8)}`);
  }
}
console.log(`\nEn total: ${totalCambian} de ${totalCaras} estaciones de cara y apoyo cambian.`);
