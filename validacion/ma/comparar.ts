/**
 * Compara dos volcados de `volcar.ts`: la misma malla (nudos, láminas y barras), y por caso la mayor
 * diferencia de desplazamientos relativa al mayor |u| del caso y la de la reacción vertical total.
 *
 *   bun validacion/ma/comparar.ts <antes.json> <ahora.json>
 */
import { readFileSync } from "node:fs";

type Volcado = { nudos: number; laminas: number; barras: number; casos: Record<string, { u: Record<string, number[]>; rz: number }> };
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f!, "utf8")) as Volcado);
if (!a || !b) throw new Error("uso: comparar.ts <antes.json> <ahora.json>");
console.log(`malla: ${a.nudos} / ${b.nudos} nudos, ${a.laminas} / ${b.laminas} láminas, ${a.barras} / ${b.barras} barras${a.nudos === b.nudos && a.laminas === b.laminas && a.barras === b.barras ? " (igual)" : " (DISTINTA)"}`);
let peor = 0;
for (const id of Object.keys(a.casos)) {
  const ca = a.casos[id]!;
  const cb = b.casos[id];
  if (!cb) {
    console.log(`${id}: no está en el segundo`);
    peor = Infinity;
    continue;
  }
  let umax = 0;
  for (const u of Object.values(ca.u)) for (const x of u) umax = Math.max(umax, Math.abs(x));
  let d = 0;
  let faltan = 0;
  for (const [k, u] of Object.entries(ca.u)) {
    const v = cb.u[k];
    if (!v) {
      faltan++;
      continue;
    }
    for (let i = 0; i < 6; i++) d = Math.max(d, Math.abs(u[i]! - v[i]!));
  }
  const rel = umax > 0 ? d / umax : d;
  const drz = Math.abs(ca.rz - cb.rz) / Math.max(Math.abs(ca.rz), 1e-30);
  peor = Math.max(peor, rel, drz, faltan ? Infinity : 0);
  console.log(`${id}: |Δu|/|u|máx = ${rel.toExponential(2)}, ΣRz ${ca.rz.toFixed(6)} / ${cb.rz.toFixed(6)} (${drz.toExponential(2)})${faltan ? `, ${faltan} nudos sin pareja` : ""}`);
}
console.log(`peor: ${peor.toExponential(2)}`);
