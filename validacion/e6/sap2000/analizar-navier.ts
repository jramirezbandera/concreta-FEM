/**
 * La placa de Navier (S5 #21, D3; cualquier variante de navier.ts) con tres columnas: el motor, SAP2000
 * y la solución exacta de Navier para Mindlin ortótropa (src/pruebas/navier.ts), con la semántica de
 * multiplicadores del motor (D' = S·D·S: D'12 = √(m11·m22)·D12; cortante K55 = v13·κGt, K44 = v23·κGt).
 * El modelo, con sus multiplicadores, se lee del propio fichero que exporta SAP2000.
 *
 * Compara, frente a Navier:
 * - momentos y cortantes en el centroide de cada área (media de sus cuatro nudos, que no depende de
 *   cómo extrapola cada programa desde sus puntos de Gauss);
 * - w y momentos en el centro;
 * - la reacción vertical de cada par de lados: en un apoyo «hard» es ∫Qn a lo largo del borde (el
 *   torsor Mxy va a las reacciones de momento).
 *
 * Uso: bun validacion/e6/sap2000/analizar-navier.ts <resultados de SAP2000 (.s2k/.$2k)> [m22=…,v13=…]
 *   El segundo argumento sustituye multiplicadores en todas las áreas del motor (no en Navier), para
 *   contrastar hipótesis sobre cómo los aplica SAP2000 (p. ej. v13 y v23 intercambiados).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../../src/motor/calcular.ts";
import { ResultantesLaminas } from "../../../src/motor/laminas.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { navierMindlin, type PlacaOrtotropa } from "../../../src/pruebas/navier.ts";
import { importarS2k } from "./importar.ts";
import { leerTablas, num } from "./s2k.ts";

const [rutaSap, sustituir] = process.argv.slice(2);
if (!rutaSap) {
  console.error("Uso: bun validacion/e6/sap2000/analizar-navier.ts <resultados de SAP2000> [m22=…,v13=…]");
  process.exit(1);
}
await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const sap = leerTablas(readFileSync(rutaSap, "latin1"));
const imp = importarS2k(sap);
if (imp.errores.length) throw new Error(imp.errores.join("\n"));
// Navier usa los multiplicadores de SAP2000 (los de la primera área: en navier.ts todas son iguales),
// antes de sustituir los del motor
const lam0 = imp.modelo.laminas![0]!;
if (sustituir) {
  const s = Object.fromEntries(sustituir.split(",").map((p) => p.split("=")).map(([k, v]) => [k!, Number(v)]));
  imp.modelo = { ...imp.modelo, laminas: imp.modelo.laminas!.map((l) => ({ ...l, multiplicadores: { ...l.multiplicadores, ...s } })) };
}
const r = calcular(imp.modelo);
if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
const u = r.casos[0]!.u;
const laminas = new ResultantesLaminas(imp.modelo);

// Navier con el material, el espesor y los multiplicadores de SAP2000; q = −10 (gravedad) da el
// convenio de signos del motor
const [a, b] = [6, 4];
const { E, nu, t } = lam0.material;
const mu = { m11: 1, m22: 1, m12: 1, v13: 1, v23: 1, ...lam0.multiplicadores };
const D = (E * t ** 3) / (12 * (1 - nu ** 2));
const Ds = ((5 / 6) * E * t) / (2 * (1 + nu));
const placa: PlacaOrtotropa = { a, b, q: -10, D11: mu.m11 * D, D22: mu.m22 * D, D12: Math.sqrt(mu.m11 * mu.m22) * nu * D, D66: (mu.m12 * D * (1 - nu)) / 2, K55: mu.v13 * Ds, K44: mu.v23 * Ds };
const TERMINOS = 151;

// Esfuerzos de SAP2000 por área y nudo
const fuerzasSap = new Map<string, Map<string, Record<string, number>>>();
for (const f of sap.get("ELEMENT FORCES - AREA SHELLS") ?? []) {
  if (f.OutputCase !== "Q") continue;
  if (!fuerzasSap.has(f.Area!)) fuerzasSap.set(f.Area!, new Map());
  fuerzasSap.get(f.Area!)!.set(f.Joint!, Object.fromEntries(["M11", "M22", "M12", "V13", "V23"].map((k) => [k, num(f, k)])));
}
const nombresNudo = [...imp.nudos.entries()].reduce((m, [k, v]) => m.set(v, k), new Map<number, string>());
const COMP = ["M11", "M22", "M12", "V13", "V23"] as const;
const IDX = { M11: 3, M22: 4, M12: 5, V13: 6, V23: 7 } as const;
/** Índice en [w, Mx, My, Mxy, Qx, Qy] de Navier. */
const NAV = { M11: 1, M22: 2, M12: 3, V13: 4, V23: 5 } as const;

interface Fila {
  x: number;
  y: number;
  motor: Record<string, number>;
  sap: Record<string, number>;
  navier: Record<string, number>;
}
const filas: Fila[] = [];
for (const [area, l] of imp.laminas) {
  const lam = imp.modelo.laminas![l]!;
  const en = laminas.enNudos(l, u);
  const motor: Record<string, number> = {};
  const s: Record<string, number> = {};
  for (const c of COMP) {
    motor[c] = 0;
    s[c] = 0;
  }
  lam.nudos.forEach((v, k) => {
    const fs = fuerzasSap.get(area)?.get(nombresNudo.get(v)!);
    for (const c of COMP) {
      motor[c]! += en[8 * k + IDX[c]]! / 4;
      s[c]! += (fs?.[c] ?? Number.NaN) / 4;
    }
  });
  const x = lam.nudos.reduce((acc, v) => acc + imp.modelo.nudos[v]!.x, 0) / 4;
  const y = lam.nudos.reduce((acc, v) => acc + imp.modelo.nudos[v]!.y, 0) / 4;
  const nav = navierMindlin(placa, x, y, TERMINOS);
  filas.push({ x, y, motor, sap: s, navier: Object.fromEntries(COMP.map((c) => [c, nav[NAV[c]]])) });
}

const pct = (v: number, ref: number) => `${((100 * v) / ref).toFixed(2)} %`;
const lineas: string[] = [];
const decir = (l = "") => lineas.push(l);
decir(`# Placa de Navier (${rutaSap}): motor${sustituir ? ` (${sustituir})` : ""} y SAP2000 frente a la solución exacta`);
decir();
decir(`Multiplicadores de SAP2000: ${JSON.stringify(mu)}`);
decir();
decir("## Centroides de las 1536 áreas (media de los cuatro nudos de cada una)");
decir();
decir("Errores frente al mayor |Navier| de la componente; «borde» es la fila de áreas que toca un apoyo.");
decir();
decir("componente | máx. |Navier| | motor: máx. (dónde) | motor: RMS | motor: máx. sin borde | SAP2000: máx. (dónde) | SAP2000: RMS | SAP2000: máx. sin borde");
const h = 0.125;
const enBorde = (f: Fila) => f.x < h || f.x > a - h || f.y < h || f.y > b - h;
for (const c of COMP) {
  const ref = Math.max(...filas.map((f) => Math.abs(f.navier[c]!)));
  const col = (k: "motor" | "sap") => {
    const peor = filas.reduce((p, f) => (Math.abs(f[k][c]! - f.navier[c]!) > Math.abs(p[k][c]! - p.navier[c]!) ? f : p));
    const rms = Math.sqrt(filas.reduce((acc, f) => acc + (f[k][c]! - f.navier[c]!) ** 2, 0) / filas.length);
    const interior = Math.max(...filas.filter((f) => !enBorde(f)).map((f) => Math.abs(f[k][c]! - f.navier[c]!)));
    return `${pct(Math.abs(peor[k][c]! - peor.navier[c]!), ref)} (${peor.x}, ${peor.y}) | ${pct(rms, ref)} | ${pct(interior, ref)}`;
  };
  decir(`${c} | ${ref.toFixed(4)} | ${col("motor")} | ${col("sap")}`);
}

// Centro: w en el nudo 809 y momentos en el propio nudo (media de las cuatro áreas que lo tocan)
const centro = navierMindlin(placa, a / 2, b / 2, 301);
const w809 = (sap.get("JOINT DISPLACEMENTS") ?? []).find((f) => f.Joint === "809" && f.OutputCase === "Q")!;
const v809 = imp.nudos.get("809")!;
const enCentro = (k: "motor" | "sap", c: "M11" | "M22") => {
  let suma = 0;
  let n = 0;
  for (const [area, l] of imp.laminas) {
    const pos = imp.modelo.laminas![l]!.nudos.indexOf(v809);
    if (pos < 0) continue;
    suma += k === "motor" ? laminas.enNudos(l, u)[8 * pos + IDX[c]]! : fuerzasSap.get(area)!.get("809")![c]!;
    n++;
  }
  return suma / n;
};
decir();
decir("## Centro de la placa (nudo 809; momentos: media de las cuatro áreas en el nudo)");
decir();
decir("magnitud | Navier | motor | error | SAP2000 | error");
const filaCentro = (nombre: string, ref: number, m: number, s: number) => decir(`${nombre} | ${ref.toPrecision(6)} | ${m.toPrecision(6)} | ${pct(m - ref, Math.abs(ref))} | ${s.toPrecision(6)} | ${pct(s - ref, Math.abs(ref))}`);
filaCentro("w (m)", centro[0], u[6 * v809 + 2]!, num(w809, "U3"));
filaCentro("M11 (kN·m/m)", centro[1], enCentro("motor", "M11"), enCentro("sap", "M11"));
filaCentro("M22 (kN·m/m)", centro[2], enCentro("motor", "M22"), enCentro("sap", "M22"));

// Reacción vertical por par de lados: exacta = ∫Qn a lo largo del borde (punto medio, 400 tramos)
const N = 400;
let exactaX = 0;
let exactaY = 0;
for (let i = 0; i < N; i++) {
  exactaX += 2 * Math.abs(navierMindlin(placa, 0, ((i + 0.5) * b) / N, TERMINOS)[4]) * (b / N);
  exactaY += 2 * Math.abs(navierMindlin(placa, ((i + 0.5) * a) / N, 0, TERMINOS)[5]) * (a / N);
}
const reac = r.casos[0]!.reacciones;
const lados: Record<string, { motor: number; sap: number }> = { "lados x = 0, 6": { motor: 0, sap: 0 }, "lados y = 0, 4": { motor: 0, sap: 0 }, esquinas: { motor: 0, sap: 0 } };
const borde = (x: number, y: number) => {
  const bx = Math.abs(x) < 1e-9 || Math.abs(x - a) < 1e-9;
  const by = Math.abs(y) < 1e-9 || Math.abs(y - b) < 1e-9;
  return bx && by ? "esquinas" : bx ? "lados x = 0, 6" : by ? "lados y = 0, 4" : null;
};
for (const f of sap.get("JOINT REACTIONS") ?? []) {
  if (f.OutputCase !== "Q") continue;
  const v = imp.nudos.get(f.Joint!)!;
  const k = borde(imp.modelo.nudos[v]!.x, imp.modelo.nudos[v]!.y);
  if (!k) continue;
  lados[k]!.motor += reac[6 * v + 2]!;
  lados[k]!.sap += num(f, "F3");
}
const exactas: Record<string, number> = { "lados x = 0, 6": exactaX, "lados y = 0, 4": exactaY, esquinas: 0 };
decir();
decir("## Reacción vertical por par de lados (kN)");
decir();
decir("lado | Navier (∫Qn) | motor | SAP2000");
for (const [k, v] of Object.entries(lados)) decir(`${k} | ${exactas[k]!.toFixed(2)} | ${v.motor.toFixed(2)} | ${v.sap.toFixed(2)}`);
decir(`total | ${(exactaX + exactaY).toFixed(2)} (la serie de Qn converge despacio en las esquinas) | ${Object.values(lados).reduce((s, v) => s + v.motor, 0).toFixed(2)} | ${Object.values(lados).reduce((s, v) => s + v.sap, 0).toFixed(2)}`);
console.log(lineas.join("\n"));
