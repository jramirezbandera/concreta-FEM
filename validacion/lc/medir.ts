/**
 * Fase LC, lo medido antes de decidir CB-b (`docs/fem3d/losa-cimentacion.md` §3): una losa sobre
 * balasto con un muelle vertical por nudo (k por el área tributaria, la fila sumada de la matriz
 * consistente bilineal) frente a la solución exacta de Navier de Mindlin con Winkler
 * (`src/pruebas/navier.ts`, con `balasto`).
 *
 * - **Prueba del parche:** losa libre con carga uniforme: w = q/k en todos los nudos y momentos nulos.
 * - **Pilar sobre la losa:** placa de 12,75 × 12,75 m apoyada («hard») con un parche de 0,75 × 0,75 m
 *   en el centro (P = 1 500 kN), lejos de los bordes (≥ 2,3 l). w, σ = k·w y Mx en el centroide de la
 *   lámina más cercana a x = c + {0; 1,5; 3} m, con la referencia en ese mismo punto.
 *
 * l = (D/k)^¼ es la longitud característica: lo que manda es h/l.
 *
 * Uso: bun validacion/lc/medir.ts → validacion/lc/out_medir.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KAPPA } from "../../src/elementos/dkmq.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { Constructor } from "../../src/pruebas/constructor.ts";
import { navierMindlin, type PlacaOrtotropa } from "../../src/pruebas/navier.ts";
import { mallaRectangular } from "../../src/pruebas/placa.ts";

const E = 22000 * Math.pow((30 + 8) / 10, 0.3) * 1000; // Ecm de HA-30, kN/m²
const NU = 0.2;
const L = 12.75;
const C = L / 2;
const PARCHE = 0.75;
const P = 1500;

interface Caso {
  t: number;
  k: number;
}
const CASOS: Caso[] = [
  { t: 0.6, k: 10000 },
  { t: 0.6, k: 50000 },
  { t: 1.0, k: 50000 },
  { t: 0.4, k: 150000 },
];
const HS = [0.75, 0.375, 0.25, 0.1875, 0.125];

const D = (t: number) => (E * t ** 3) / (12 * (1 - NU * NU));
const lc = (c: Caso) => Math.pow(D(c.t) / c.k, 0.25);

function placa(c: Caso): PlacaOrtotropa {
  const d = D(c.t);
  const G = E / (2 * (1 + NU));
  return { a: L, b: L, q: -P / (PARCHE * PARCHE), D11: d, D22: d, D12: NU * d, D66: (d * (1 - NU)) / 2, K55: KAPPA * G * c.t, K44: KAPPA * G * c.t, parche: { x: C, y: C, u: PARCHE, v: PARCHE }, balasto: c.k };
}

/** Losa n × n de lado L con un muelle por nudo; `apoyada`, con el apoyo «hard» de Navier. */
function modelo(c: Caso, h: number, carga: "parche" | "uniforme", apoyada: boolean) {
  const n = Math.round(L / h);
  const m = new Constructor();
  const g = mallaRectangular(m, { a: L, b: L, nx: n, ny: n, material: { E, nu: NU, t: c.t } });
  const area = new Map<number, number>();
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (const v of [g.nudos[i]![j]!, g.nudos[i + 1]![j]!, g.nudos[i + 1]![j + 1]!, g.nudos[i]![j + 1]!]) area.set(v, (area.get(v) ?? 0) + (h * h) / 4);
  for (const [v, a] of area) m.muelle([v], [0, 0, c.k * a, 0, 0, 0]);
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const bx = apoyada && (i === 0 || i === n);
      const by = apoyada && (j === 0 || j === n);
      m.apoyo(g.nudos[i]![j]!, [true, true, bx || by, bx, by, true]);
    }
  }
  const cargas = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const xc = (i + 0.5) * h;
      const yc = (j + 0.5) * h;
      const dentro = Math.abs(xc - C) < PARCHE / 2 && Math.abs(yc - C) < PARCHE / 2;
      if (carga === "uniforme") cargas.push({ tipo: "superficie" as const, lamina: g.laminas[i]![j]!, ejes: "global" as const, q: [0, 0, -50] as [number, number, number] });
      else if (dentro) cargas.push({ tipo: "superficie" as const, lamina: g.laminas[i]![j]!, ejes: "global" as const, q: [0, 0, -P / (PARCHE * PARCHE)] as [number, number, number] });
    }
  }
  m.caso("q", [], [], [], cargas);
  return { modelo: m.modelo(), g, n };
}

const raiz = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const pct = (v: number) => `${(100 * v).toFixed(2).padStart(7)} %`;
const lineas: string[] = [`# validacion/lc/medir.ts — ${new Date().toLocaleDateString("sv-SE")}: muelles por nudo (k·área tributaria) frente a Navier–Winkler (Mindlin); E = ${(E / 1e3).toFixed(0)} MPa, ν = ${NU}`];

lineas.push(`\n## Prueba del parche: losa libre de ${L} m, q = −50 kN/m²; máx |w·k/q − 1| y máx |M| en todas las láminas`);
for (const c of CASOS) {
  for (const h of [0.75, 0.375]) {
    const { modelo: mo } = modelo(c, h, "uniforme", false);
    const [r] = casosValidos(calcular(mo));
    let ew = 0;
    for (let v = 0; v < mo.nudos.length; v++) ew = Math.max(ew, Math.abs((r!.u[6 * v + 2]! * c.k) / -50 - 1));
    let mmax = 0;
    for (let e = 0; e < mo.laminas.length; e++) for (const k of [3, 4, 5]) mmax = Math.max(mmax, Math.abs(r!.esfuerzosLaminas[8 * e + k]!));
    lineas.push(`t = ${c.t} m, k = ${c.k} kN/m³, h = ${h}: ${ew.toExponential(2)}, ${mmax.toExponential(2)} kN·m/m`);
  }
}

for (const c of CASOS) {
  const p = placa(c);
  const l = lc(c);
  const w0 = navierMindlin(p, C, C)[0];
  lineas.push(`\n## t = ${c.t} m, k = ${c.k} kN/m³: l = ${l.toFixed(2)} m; Navier: w centro = ${(w0 * 1000).toFixed(3)} mm, σ = ${(-w0 * c.k).toFixed(1)} kN/m²`);
  lineas.push(`h (m)  | h/l  | w (σ) junto al centro | Mx centro            | Mx a 1,5 m           | Mx a 3 m`);
  for (const h of HS) {
    const { modelo: mo, g, n } = modelo(c, h, "parche", true);
    const [r] = casosValidos(calcular(mo));
    // w en el nudo más cercano al centro, frente a Navier en ese mismo punto
    const ic = Math.round(C / h);
    const nc = g.nudos[ic]![ic]!;
    const ew = r!.u[6 * nc + 2]! / navierMindlin(p, ic * h, ic * h)[0] - 1;
    const mx = (dx: number) => {
      const i = Math.min(n - 1, Math.max(0, Math.round((C + dx) / h - 0.5)));
      const j = Math.min(n - 1, Math.max(0, Math.round(C / h - 0.5)));
      const ref = navierMindlin(p, (i + 0.5) * h, (j + 0.5) * h)[1];
      const fe = r!.esfuerzosLaminas[8 * g.laminas[i]![j]! + 3]!;
      return `${fe.toFixed(1).padStart(7)} / ${ref.toFixed(1).padStart(7)} ${pct(fe / ref - 1)}`;
    };
    lineas.push(`${h.toFixed(4)} | ${(h / l).toFixed(2)} | ${pct(ew)}             | ${mx(0)} | ${mx(1.5)} | ${mx(3)}`);
  }
}

const texto = lineas.join("\n");
console.log(texto);
writeFileSync(join(import.meta.dirname, "out_medir.txt"), texto + "\n");
