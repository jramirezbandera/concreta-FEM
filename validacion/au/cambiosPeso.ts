/**
 * AU-4 (`docs/fem3d/auditoria.md` §7): qué modelos de las referencias congeladas de C3, C4, C5 y F
 * cambian con el peso del ancho de las vigas bajo un forjado aligerado o un paño, y cuánto cambia
 * su peso propio. Compara dos copias de los fixtures (las de antes, en `--antes <dir>`, y las del
 * repositorio) y escribe `out_cambiosPeso.txt`.
 *
 *   bun validacion/au/cambiosPeso.ts --antes <carpeta con congelado-<fase>.json de antes>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const i = process.argv.indexOf("--antes");
if (i < 0) throw new Error("Falta --antes <carpeta>");
const antes = process.argv[i + 1]!;
const fixtures = join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__");

/** Σ Fz de las reacciones del primer caso (el de peso propio en todos estos modelos), kN. */
function pesoPrimerCaso(ref: unknown): number | null {
  const r = ref as { c2?: { casos?: { reacciones: number[] }[] }; casos?: { reacciones: number[] }[] };
  const casos = r.c2?.casos ?? r.casos;
  const re = casos?.[0]?.reacciones;
  if (!re) return null;
  let s = 0;
  for (let k = 2; k < re.length; k += 6) s += re[k]!;
  return s;
}

const lineas: string[] = ["AU-4: modelos de las referencias congeladas que cambian (el resto, idénticos)", ""];
for (const fase of ["c3", "c4", "c5", "f"]) {
  const a = JSON.parse(readFileSync(join(antes, `congelado-${fase}.json`), "utf8")) as Record<string, unknown>;
  const b = JSON.parse(readFileSync(join(fixtures, `congelado-${fase}.json`), "utf8")) as Record<string, unknown>;
  const cambian = Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  lineas.push(`${fase.toUpperCase()}: ${cambian.length} de ${Object.keys(b).length}`);
  for (const k of cambian) {
    const [pa, pb] = [pesoPrimerCaso(a[k]), pesoPrimerCaso(b[k])];
    lineas.push(`  ${k}: ${pa !== null && pb !== null ? `Σ Rz del primer caso ${pa.toFixed(3)} → ${pb.toFixed(3)} kN (${(((pb - pa) / pa) * 100).toFixed(2)} %)` : "(sin reacciones)"}`);
  }
}
const ruta = join(import.meta.dirname, "out_cambiosPeso.txt");
writeFileSync(ruta, lineas.join("\n") + "\n");
console.log(lineas.join("\n"));
