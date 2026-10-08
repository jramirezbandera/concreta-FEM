/**
 * Diferencias motor – SAP2000 por zonas en un modelo de losa con pilares (el reticular del usuario,
 * RETICULAR/, 2026-10-08), en la misma malla:
 * - flechas de los nudos de las láminas: la máxima y el rango de motor/SAP2000 donde |w| > 0,3·máx;
 * - M11…V23 en el centroide de cada área (media de sus cuatro nudos), separando las áreas que tocan
 *   la cabeza de un pilar (singulares), el resto de los ábacos y la zona aligerada;
 * - esfuerzos de vigas y pilares en las estaciones de SAP2000.
 *
 * Uso: bun validacion/e6/sap2000/reticular-zonas.ts <modelo.s2k exportado con resultados> [caso = DEAD]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../../src/motor/calcular.ts";
import { DiagramasBarras } from "../../../src/motor/barras.ts";
import { ResultantesLaminas } from "../../../src/motor/laminas.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { importarS2k } from "./importar.ts";
import { leerTablas, num } from "./s2k.ts";

const [RUTA, CASO = "DEAD"] = process.argv.slice(2);
if (!RUTA) {
  console.error("Uso: bun validacion/e6/sap2000/reticular-zonas.ts <modelo.s2k> [caso]");
  process.exit(1);
}
await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const sap = leerTablas(readFileSync(RUTA, "latin1"));
const imp = importarS2k(sap);
if (imp.errores.length) throw new Error(imp.errores.join("\n"));
const r = calcular(imp.modelo);
if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
const k = imp.patrones.indexOf(CASO);
if (k < 0) throw new Error(`El caso ${CASO} no está en el modelo (${imp.patrones.join(", ")}).`);
const u = r.casos[k]!.u;
const M = imp.modelo;
const nombre = [...imp.nudos].reduce((m, [n, v]) => m.set(v, n), new Map<number, string>());
const cabezas = new Set<number>();
for (const b of M.barras!) {
  const [i, j] = b.nudos;
  if (Math.abs(M.nudos[i]!.z - M.nudos[j]!.z) > 1) cabezas.add(M.nudos[i]!.z > M.nudos[j]!.z ? i : j);
}
// Flechas de los nudos de las láminas
const deLosa = new Set(M.laminas!.flatMap((l) => [...l.nudos]));
const desp = new Map((sap.get("JOINT DISPLACEMENTS") ?? []).filter((f) => f.OutputCase === CASO).map((f) => [f.Joint!, num(f, "U3")]));
const filasU = [...deLosa].map((v) => ({ v, n: M.nudos[v]!, m: u[6 * v + 2]!, s: desp.get(nombre.get(v)!)! }));
const maxU = Math.max(...filasU.map((f) => Math.abs(f.s)));
console.log(`# ${CASO}: flecha máx. SAP ${maxU.toExponential(4)}; motor/SAP en el nudo de flecha máxima:`);
const fm = filasU.reduce((a, b) => (Math.abs(b.s) > Math.abs(a.s) ? b : a));
console.log(`  (${fm.n.x}, ${fm.n.y}) motor ${fm.m.toExponential(4)} SAP ${fm.s.toExponential(4)} (${((fm.m / fm.s - 1) * 100).toFixed(2)} %)`);
const rel = filasU.filter((f) => Math.abs(f.s) > 0.3 * maxU).map((f) => f.m / f.s - 1);
console.log(`  razón motor/SAP en los nudos con |w| > 0,3·máx: min ${(Math.min(...rel) * 100).toFixed(2)} %, máx ${(Math.max(...rel) * 100).toFixed(2)} %`);

// Momentos de área en centroides
const lam = new ResultantesLaminas(M);
const fs = new Map<string, Map<string, Record<string, number>>>();
for (const f of sap.get("ELEMENT FORCES - AREA SHELLS") ?? []) {
  if (f.OutputCase !== CASO) continue;
  if (!fs.has(f.Area!)) fs.set(f.Area!, new Map());
  fs.get(f.Area!)!.set(f.Joint!, { M11: num(f, "M11"), M22: num(f, "M22"), M12: num(f, "M12"), V13: num(f, "V13"), V23: num(f, "V23") });
}
const seccion = new Map((sap.get("AREA SECTION ASSIGNMENTS") ?? []).map((f) => [f.Area!, f.Section!]));
const IDX = { M11: 3, M22: 4, M12: 5, V13: 6, V23: 7 } as const;
type C = keyof typeof IDX;
const filas: { area: string; x: number; y: number; zona: string; cerca: boolean; m: Record<C, number>; s: Record<C, number> }[] = [];
for (const [area, l] of imp.laminas) {
  const L = M.laminas![l]!;
  const en = lam.enNudos(l, u);
  const m = { M11: 0, M22: 0, M12: 0, V13: 0, V23: 0 };
  const s = { M11: 0, M22: 0, M12: 0, V13: 0, V23: 0 };
  L.nudos.forEach((v, a) => {
    for (const c of Object.keys(IDX) as C[]) {
      m[c] += en[8 * a + IDX[c]]! / 4;
      s[c] += fs.get(area)!.get(nombre.get(v)!)![c] / 4;
    }
  });
  const x = L.nudos.reduce((a, v) => a + M.nudos[v]!.x, 0) / 4;
  const y = L.nudos.reduce((a, v) => a + M.nudos[v]!.y, 0) / 4;
  filas.push({ area, x, y, zona: /ABACO/.test(seccion.get(area)!) ? "ábaco" : "aligerada", cerca: L.nudos.some((v) => cabezas.has(v)), m, s });
}
for (const c of ["M11", "M22", "M12", "V13", "V23"] as C[]) {
  const ref = Math.max(...filas.map((f) => Math.abs(f.s[c])));
  const grupo = (nom: string, fl: typeof filas) => {
    if (!fl.length) return;
    const p = fl.reduce((a, b) => (Math.abs(b.m[c] - b.s[c]) > Math.abs(a.m[c] - a.s[c]) ? b : a));
    const rms = Math.sqrt(fl.reduce((a, f) => a + (f.m[c] - f.s[c]) ** 2, 0) / fl.length);
    console.log(`  ${c} ${nom}: máx ${((100 * Math.abs(p.m[c] - p.s[c])) / ref).toFixed(1)} % en (${p.x}, ${p.y}) [motor ${p.m[c].toFixed(2)}, SAP ${p.s[c].toFixed(2)}], RMS ${((100 * rms) / ref).toFixed(1)} %`);
  };
  console.log(`${c} (máx |SAP| en centroides ${ref.toFixed(2)})`);
  grupo("áreas que tocan un pilar", filas.filter((f) => f.cerca));
  grupo("resto del ábaco", filas.filter((f) => !f.cerca && f.zona === "ábaco"));
  grupo("aligerada", filas.filter((f) => !f.cerca && f.zona === "aligerada"));
}

// Barras: vigas y pilares, esfuerzos en los extremos
const diag = new DiagramasBarras(M);
const filasB: { nombre: string; tipo: string; dif: number[]; s: number[] }[] = [];
for (const f of sap.get("ELEMENT FORCES - FRAMES") ?? []) {
  if (f.OutputCase !== CASO) continue;
  const b = imp.barras.get(f.Frame!);
  if (!b) continue;
  const st = num(f, "Station") * imp.longitud;
  const tr = b.trozos.find((t) => st >= t.s0 - 1e-9 && st <= t.s1 + 1e-9);
  if (!tr) continue;
  const x = Math.min(Math.max(st - tr.s0, 0), tr.s1 - tr.s0);
  const e = diag.diagrama(tr.barra, k, r.casos[k]!).esfuerzosEn(x, x >= tr.s1 - tr.s0 ? -1 : 1);
  const [N, Vy, Vz, T, My, Mz] = e as unknown as number[];
  const s = ["P", "V2", "V3", "T", "M2", "M3"].map((c) => num(f, c));
  const m = [N!, Vz!, -Vy!, T!, -Mz!, My!];
  const ni = M.barras![tr.barra]!.nudos;
  const tipo = Math.abs(M.nudos[ni[0]]!.z - M.nudos[ni[1]]!.z) > 1 ? "pilar" : "viga";
  filasB.push({ nombre: `${f.Frame}@${f.Station}`, tipo, dif: m.map((v, i) => v - s[i]!), s });
}
for (const tipo of ["viga", "pilar"]) {
  const fl = filasB.filter((f) => f.tipo === tipo);
  ["P", "V2", "V3", "T", "M2", "M3"].forEach((c, i) => {
    const ref = Math.max(...fl.map((f) => Math.abs(f.s[i]!)));
    const p = fl.reduce((a, b) => (Math.abs(b.dif[i]!) > Math.abs(a.dif[i]!) ? b : a));
    console.log(`${tipo} ${c}: máx |SAP| ${ref.toFixed(2)}; máx dif ${Math.abs(p.dif[i]!).toFixed(2)} (${((100 * Math.abs(p.dif[i]!)) / (ref || 1)).toFixed(1)} %) en ${p.nombre}`);
  });
}
