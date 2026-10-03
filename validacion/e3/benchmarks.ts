/**
 * Benchmarks de lámina de H48 con el motor de E3 (membrana con drilling + flexión DKMQ acopladas
 * en láminas curvas facetadas). Cada función devuelve el valor normalizado por la referencia:
 * - Scordelis-Lo (MacNeal–Harder, tabla 5a): 0,3024, flecha del centro del borde libre (Mindlin).
 * - Cilindro pellizcado con diafragmas (Code_Aster SSLS104): 1,8248e-5, bajo la carga.
 * - Hemisferio pellizcado con agujero de 18° (MacNeal–Harder, tabla 5b): 0,0940, bajo la carga.
 * - Viga recta de MacNeal–Harder (tabla 3), carga fuera del plano: 0,4321, en tres mallas.
 * Las mallas de los tres primeros son de cuadriláteros planos (cuerdas de un cilindro; trapecios
 * isósceles entre dos paralelos y dos meridianos de la esfera).
 *
 * Uso: bun validacion/e3/benchmarks.ts → validacion/e3/out_benchmarks.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../src/motor/calcular.ts";
import type { Apoyo, ModeloAnalitico } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { carga, Constructor } from "../../src/pruebas/constructor.ts";

type Mascara = Apoyo["coartados"];
/** Une dos máscaras de apoyo (un nudo en dos planos de simetría). */
const unir = (a: Mascara | undefined, b: Mascara): Mascara => (a ? (a.map((v, i) => v || b[i]!) as unknown as Mascara) : b);

function aplicarApoyos(m: Constructor, mascaras: Map<number, Mascara>): void {
  for (const [v, c] of mascaras) m.apoyo(v, c);
}

/** Scordelis-Lo: cuarto de cubierta, x ∈ [0, L/2] (centro del vano en x = 0) y θ ∈ [0, 40°]. */
export function scordelisLo(n: number): { valor: number; modelo: ModeloAnalitico } {
  const R = 25;
  const L = 50;
  const m = new Constructor();
  const nudos: number[][] = [];
  for (let i = 0; i <= n; i++) {
    nudos.push([]);
    for (let j = 0; j <= n; j++) {
      const x = ((L / 2) * i) / n;
      const th = ((40 * Math.PI) / 180) * (j / n);
      nudos[i]!.push(m.nudo(x, R * Math.sin(th), R * Math.cos(th)));
    }
  }
  const mat = { E: 4.32e8, nu: 0, t: 0.25 };
  const laminas: number[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) laminas.push(m.lamina([nudos[i]![j]!, nudos[i + 1]![j]!, nudos[i + 1]![j + 1]!, nudos[i]![j + 1]!], mat));
  const ap = new Map<number, Mascara>();
  const poner = (v: number, c: Mascara) => ap.set(v, unir(ap.get(v), c));
  for (let j = 0; j <= n; j++) {
    poner(nudos[0]![j]!, [true, false, false, false, true, true]); // simetría x = 0
    poner(nudos[n]![j]!, [false, true, true, false, false, false]); // diafragma
  }
  for (let i = 0; i <= n; i++) poner(nudos[i]![0]!, [false, true, false, true, false, true]); // simetría y = 0
  aplicarApoyos(m, ap);
  m.caso("peso", [], [], [], laminas.map((l) => ({ tipo: "superficie", lamina: l, ejes: "global", q: [0, 0, -90] })));
  const modelo = m.modelo();
  const [r] = casosValidos(calcular(modelo));
  return { valor: -r!.u[6 * nudos[0]![n]! + 2]! / 0.3024, modelo };
}

/** Cilindro pellizcado con diafragmas: octante x ∈ [0, L/2], θ ∈ [0, 90°]; carga P/4 en (0, 0, R). */
export function cilindroPellizcado(n: number): number {
  const R = 300;
  const L = 600;
  const m = new Constructor();
  const nudos: number[][] = [];
  for (let i = 0; i <= n; i++) {
    nudos.push([]);
    for (let j = 0; j <= n; j++) {
      const th = (Math.PI / 2) * (j / n);
      nudos[i]!.push(m.nudo(((L / 2) * i) / n, R * Math.sin(th), R * Math.cos(th)));
    }
  }
  const mat = { E: 3e6, nu: 0.3, t: 3 };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) m.lamina([nudos[i]![j]!, nudos[i + 1]![j]!, nudos[i + 1]![j + 1]!, nudos[i]![j + 1]!], mat);
  const ap = new Map<number, Mascara>();
  const poner = (v: number, c: Mascara) => ap.set(v, unir(ap.get(v), c));
  for (let j = 0; j <= n; j++) {
    poner(nudos[0]![j]!, [true, false, false, false, true, true]); // simetría x = 0
    poner(nudos[n]![j]!, [false, true, true, false, false, false]); // diafragma
  }
  for (let i = 0; i <= n; i++) {
    poner(nudos[i]![0]!, [false, true, false, true, false, true]); // simetría y = 0
    poner(nudos[i]![n]!, [false, false, true, true, true, false]); // simetría z = 0
  }
  aplicarApoyos(m, ap);
  m.caso("P", [carga(nudos[0]![0]!, { fz: -0.25 })]);
  const [r] = casosValidos(calcular(m.modelo()));
  return -r!.u[6 * nudos[0]![0]! + 2]! / 1.8248e-5;
}

/** Hemisferio pellizcado con agujero de 18°: cuarto con azimut ∈ [0, 90°] y latitud ∈ [0, 72°]. */
export function hemisferio(n: number): number {
  const R = 10;
  const m = new Constructor();
  const nudos: number[][] = [];
  for (let i = 0; i <= n; i++) {
    nudos.push([]);
    const fi = (Math.PI / 2) * (i / n);
    for (let j = 0; j <= n; j++) {
      const lat = ((72 * Math.PI) / 180) * (j / n);
      nudos[i]!.push(m.nudo(R * Math.cos(lat) * Math.cos(fi), R * Math.cos(lat) * Math.sin(fi), R * Math.sin(lat)));
    }
  }
  const mat = { E: 6.825e7, nu: 0.3, t: 0.04 };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) m.lamina([nudos[i]![j]!, nudos[i + 1]![j]!, nudos[i + 1]![j + 1]!, nudos[i]![j + 1]!], mat);
  const ap = new Map<number, Mascara>();
  const poner = (v: number, c: Mascara) => ap.set(v, unir(ap.get(v), c));
  for (let j = 0; j <= n; j++) {
    poner(nudos[0]![j]!, [false, true, false, true, false, true]); // simetría y = 0
    poner(nudos[n]![j]!, [true, false, false, false, true, true]); // simetría x = 0
  }
  poner(nudos[0]![0]!, [false, false, true, false, false, false]); // sólido rígido en z
  aplicarApoyos(m, ap);
  // fuerzas de 2 en el ecuador: hacia fuera en +X y hacia dentro en Y (la mitad en el cuarto)
  m.caso("F", [carga(nudos[0]![0]!, { fx: 1 }), carga(nudos[n]![0]!, { fy: -1 })]);
  const [r] = casosValidos(calcular(m.modelo()));
  return r!.u[6 * nudos[0]![0]!]! / 0.094;
}

/** Viga recta de MacNeal–Harder (6 × 0,2, t = 0,1), empotrada, carga unidad fuera del plano en la punta. */
export function vigaMacNealHarder(forma: "rectangular" | "trapezoidal" | "paralelogramo"): number {
  const m = new Constructor();
  const abajo: number[] = [];
  const arriba: number[] = [];
  for (let i = 0; i <= 6; i++) {
    const interior = i > 0 && i < 6;
    const [xa, xb] =
      forma === "rectangular" ? [i, i] : forma === "trapezoidal" ? (interior ? [i + (i % 2 ? -0.1 : 0.1), i + (i % 2 ? 0.1 : -0.1)] : [i, i]) : [i, interior ? i + 0.2 : i];
    abajo.push(m.nudo(xa, 0, 0));
    arriba.push(m.nudo(xb, 0.2, 0));
  }
  for (let i = 0; i < 6; i++) m.lamina([abajo[i]!, abajo[i + 1]!, arriba[i + 1]!, arriba[i]!], { E: 1e7, nu: 0.3, t: 0.1 });
  m.apoyo(abajo[0]!);
  m.apoyo(arriba[0]!);
  m.caso("P", [carga(abajo[6]!, { fz: 0.5 }), carga(arriba[6]!, { fz: 0.5 })]);
  const [r] = casosValidos(calcular(m.modelo()));
  return (r!.u[6 * abajo[6]! + 2]! + r!.u[6 * arriba[6]! + 2]!) / 2 / 0.4321;
}

if (import.meta.main) {
  const raiz = join(import.meta.dirname, "..", "..");
  await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const lineas = [`# validacion/e3/benchmarks.ts — ${new Date().toLocaleDateString("sv-SE")}: valor del motor / referencia (H48)`];
  const f = (v: number) => v.toFixed(4);
  lineas.push("\nmalla N×N | Scordelis-Lo (0,3024) | cilindro pellizcado (1,8248e-5) | hemisferio (0,0940)");
  for (const n of [4, 8, 16, 32]) lineas.push(`${String(n).padStart(9)} | ${f(scordelisLo(n).valor).padStart(21)} | ${f(cilindroPellizcado(n)).padStart(31)} | ${f(hemisferio(n)).padStart(19)}`);
  lineas.push("\nviga recta de MacNeal–Harder, carga fuera del plano (0,4321)");
  for (const forma of ["rectangular", "trapezoidal", "paralelogramo"] as const) lineas.push(`${forma.padEnd(13)} | ${f(vigaMacNealHarder(forma))}`);
  const texto = lineas.join("\n");
  console.log(texto);
  writeFileSync(join(import.meta.dirname, "out_benchmarks.txt"), texto + "\n");
}
