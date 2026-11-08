/**
 * Fase PB: compara las salidas de `medir.ts` con una referencia fina (`out_<ref>.json` a un h dado).
 * Por grupo (las caras de las vigas en los pilares de esquina, de borde e interiores, su mínimo y su
 * máximo, los vanos, y las
 * estaciones de las franjas de cara por el tipo de su pilar y de apoyo), el error relativo frente a la
 * referencia: mediana y máximo de |error| y cuántas pasan del 10 % y del 20 %. Sólo valores de al menos
 * el 20 % del mayor de su grupo en la referencia (los pequeños no cuentan en un error relativo).
 *
 *   bun validacion/pb/comparar.ts <ref> <h ref> <nombre>:<h> [<nombre>:<h> ...]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AQUI = import.meta.dirname;
const [ref, href, ...casos] = process.argv.slice(2);
if (!ref || !href || !casos.length) throw new Error("bun validacion/pb/comparar.ts <ref> <h ref> <nombre>:<h> ...");
type Medida = { nudos: number; ecuaciones: number; avisos: string[]; vigas: Record<string, number>; franjas: Record<string, number> };
const leer = (n: string): Record<string, Medida> => JSON.parse(readFileSync(join(AQUI, `out_${n}.json`), "utf8"));
const R = leer(ref)[href];
if (!R) throw new Error(`sin ${ref} h = ${href}`);

/** Grupo de una clave: «viga cara esquina», «franja cara borde sup»… */
const grupoViga = (k: string) => (k.split("@")[3] === "vano" ? "viga vano" : `viga ${k.split("@")[3] === "caramax" ? "cara (máximo)" : "cara"} ${k.split("@")[2]}`);
const grupoFranja = (k: string) => {
  const p = k.split("@");
  const tipo = p[0]!.split(":")[2];
  return `franja ${tipo}${tipo === "cara" ? ` ${p[2]}` : ""} ${p[3]}`;
};
const med = (x: number[]) => {
  const s = [...x].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : NaN;
};
const pc = (x: number) => `${(100 * x).toFixed(1)} %`;

function tabla(titulo: string, campo: "vigas" | "franjas", grupo: (k: string) => string) {
  const grupos = new Map<string, string[]>();
  for (const k of Object.keys(R![campo])) {
    const g = grupo(k);
    const v = grupos.get(g);
    if (v) v.push(k);
    else grupos.set(g, [k]);
  }
  console.log(`\n## ${titulo} (referencia: ${ref}, h = ${href})\n`);
  console.log(`Grupo | caso | n | mediana | máximo (dónde) | > 10 % | > 20 %`);
  for (const [g, ks] of [...grupos].sort()) {
    const mayor = Math.max(...ks.map((k) => Math.abs(R![campo][k]!)));
    const vale = ks.filter((k) => Math.abs(R![campo][k]!) >= 0.2 * mayor);
    for (const caso of casos) {
      const [n, h] = [caso.slice(0, caso.indexOf(":")), caso.slice(caso.indexOf(":") + 1)];
      const M = leer(n)[h];
      if (!M) throw new Error(`sin ${caso}`);
      const errs = vale.flatMap((k) => (M[campo][k] === undefined ? [] : [{ k, e: M[campo][k]! / R![campo][k]! - 1 }]));
      if (!errs.length) continue;
      const peor = errs.reduce((a, b) => (Math.abs(b.e) > Math.abs(a.e) ? b : a));
      console.log(`${g} | ${caso} | ${errs.length} | ${pc(med(errs.map((x) => Math.abs(x.e))))} | ${pc(peor.e)} (${peor.k.split("@").slice(0, 2).join(" ")}) | ${errs.filter((x) => Math.abs(x.e) > 0.1).length} | ${errs.filter((x) => Math.abs(x.e) > 0.2).length}`);
    }
  }
}

console.log(`Caso | nudos | ecuaciones | avisos de malla`);
for (const caso of [`${ref}:${href}`, ...casos]) {
  const [n, h] = [caso.slice(0, caso.indexOf(":")), caso.slice(caso.indexOf(":") + 1)];
  const M = leer(n)[h]!;
  console.log(`${caso} | ${M.nudos} | ${M.ecuaciones} | ${M.avisos.length ? M.avisos.join("; ") : "—"}`);
}
tabla("Vigas: My en las caras de los pilares y máximo del vano (ELU persistentes)", "vigas", grupoViga);
tabla("Franjas: Wood–Armer en las estaciones de cara y de apoyo (ELU persistentes)", "franjas", grupoFranja);
