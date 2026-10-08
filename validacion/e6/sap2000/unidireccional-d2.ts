/**
 * D2 frente al modelo de SAP2000 del usuario (UNIDIRECCIONAL/, 2026-10-08): 18 × 12 m, 3 × 2 vanos de
 * 6 m, viguetas T 72/5/12/30 según Y continuas sobre la viga central, vigas y pilares 30 × 30,
 * pilares articulados en la base. Cuánto cambia cada criterio del compilador (C4) respecto a cómo lo
 * modela el usuario, en el caso CPERM:
 *
 * 1. Sobre el modelo del usuario importado (`importar.ts`):
 *    - las cargas por la regla de la palanca (C4-e): el usuario da a las vigas paralelas a las
 *      viguetas la carga de una vigueta entera;
 *    - además, la torsión de las viguetas liberada en un extremo (C4-c).
 * 2. El mismo edificio como modelo físico, compilado (las viguetas las coloca el compilador: rectas
 *    centradas, n = round(W/s), C4-a):
 *    - con las elecciones del usuario: sin modificadores, de eje a eje (zona rígida 0), sin diafragma;
 *    - y añadiendo, uno a uno, el diafragma rígido (C4-g), los modificadores de D4 y la zona rígida
 *      de 0,5 (C1-a); al final, el compilador con sus valores por defecto.
 * El material es el de SAP2000 (E = 33 GPa, G = 13,75 GPa) en todos.
 *
 * Uso: bun validacion/e6/sap2000/unidireccional-d2.ts <UNIDIRECCIONAL.s2k exportado con resultados>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../../src/compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../../src/compilador/fisico.ts";
import { calcular } from "../../../src/motor/calcular.ts";
import { DiagramasBarras } from "../../../src/motor/barras.ts";
import type { ModeloAnalitico, ResultadoCaso } from "../../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { importarS2k } from "./importar.ts";
import { leerTablas, num, type Tablas } from "./s2k.ts";

const ruta = process.argv[2];
if (!ruta) {
  console.error("Uso: bun validacion/e6/sap2000/unidireccional-d2.ts <UNIDIRECCIONAL.s2k>");
  process.exit(1);
}
await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const tablas = leerTablas(readFileSync(ruta, "latin1"));
const INTEREJE = 0.72;

// ---------------------------------------------------------------------------------------------
// 1. Variantes del modelo del usuario

/** Las cargas de las rectas según Y (viguetas y vigas paralelas) por la palanca: q/intereje × ancho. */
function conPalanca(t: Tablas): Tablas {
  const xy = new Map((t.get("JOINT COORDINATES") ?? []).map((r) => [r.Joint!, [num(r, "GlobalX"), num(r, "GlobalY"), num(r, "GlobalZ")] as const]));
  const xDe = new Map<string, number>();
  for (const r of t.get("CONNECTIVITY - FRAME") ?? []) {
    const [a, b] = [xy.get(r.JointI!)!, xy.get(r.JointJ!)!];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6 && Math.abs(a[1] - b[1]) > 1e-6) xDe.set(r.Frame!, a[0]);
  }
  const xs = [...new Set([...xDe.values()].map((x) => Math.round(x * 1e6) / 1e6))].sort((a, b) => a - b);
  const ancho = (x: number) => {
    const i = xs.indexOf(Math.round(x * 1e6) / 1e6);
    return ((xs[Math.min(i + 1, xs.length - 1)]! - xs[Math.max(i - 1, 0)]!) / 2) * (i === 0 || i === xs.length - 1 ? 1 : 1);
  };
  const nueva = new Map(t);
  nueva.set(
    "FRAME LOADS - DISTRIBUTED",
    (t.get("FRAME LOADS - DISTRIBUTED") ?? []).map((r) => {
      const x = xDe.get(r.Frame!);
      if (x === undefined) return r;
      const f = ancho(x) / INTEREJE;
      return { ...r, FOverLA: String(num(r, "FOverLA") * f), FOverLB: String(num(r, "FOverLB") * f) };
    }),
  );
  return nueva;
}

/** La torsión de cada vigueta liberada en su extremo i (C4-c). */
function torsionLiberada(m: ModeloAnalitico, t: Tablas, imp: ReturnType<typeof importarS2k>): ModeloAnalitico {
  const viguetas = new Set<number>();
  for (const r of t.get("FRAME SECTION ASSIGNMENTS") ?? []) if (/VIGUETA/i.test(r.AnalSect ?? "")) viguetas.add(imp.barras.get(r.Frame!)!.trozos[0]!.barra);
  return { ...m, barras: m.barras!.map((b, i) => (viguetas.has(i) ? { ...b, liberaciones: { i: [false, false, false, true, false, false] as const } } : b)) };
}

// ---------------------------------------------------------------------------------------------
// 2. El edificio como modelo físico

function edificio(diafragma: "rigido" | "ninguno"): ModeloFisico {
  const xs = [-9, -3, 3, 9];
  const ys = [-6, 0, 6];
  const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  return {
    plantas: [
      { id: "P1", altura: null, diafragma },
      { id: "C", tipo: "sotano", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "general", E: 33e6, G: 13.75e6, peso: 25 }],
    secciones: [
      { id: "p30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "T", material: "HA", forma: "T", bf: INTEREJE, hf: 0.05, bw: 0.12, h: 0.3 },
    ],
    pilares: xs.flatMap((x) => ys.map((y) => ({ id: `P${x}_${y}`, x, y, desde: "C", hasta: "P1", seccion: "p30", base: "articulado" as const }))),
    vigas: [
      ...ys.map((y) => ({ id: `X${y}`, planta: "P1", puntos: [[-9, y], [9, y]] as [number, number][], seccion: "v30" })),
      ...xs.map((x) => ({ id: `Y${x}`, planta: "P1", puntos: [[x, -6], [x, 6]] as [number, number][], seccion: "v30" })),
    ],
    panos: [0, 1, 2].flatMap((i) => [0, 1].map((j) => ({ id: `F${i}${j}`, planta: "P1", contorno: rect(xs[i]!, ys[j]!, xs[i + 1]!, ys[j + 1]!), direccion: 90, intereje: INTEREJE, seccion: "T", pp: 1 }))),
    casos: [{ id: "G", pesoPropio: true }, { id: "CPERM" }, { id: "Q" }],
    cargas: [
      { tipo: "superficie", id: "cp", caso: "CPERM", planta: "P1", zona: rect(-9, -6, 9, 6), q: [0, 0, -6.14 / INTEREJE] },
      { tipo: "superficie", id: "q", caso: "Q", planta: "P1", zona: rect(-9, -6, 9, 6), q: [0, 0, -2.1 / INTEREJE] },
    ],
  };
}

function compilado(diafragma: "rigido" | "ninguno", op: OpcionesCompilacion): ModeloAnalitico {
  const r = compilar(edificio(diafragma), op);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  return r.modelo;
}

// ---------------------------------------------------------------------------------------------
// Medidas, por la geometría de las barras (vale igual para el modelo importado y el compilado)

interface Medidas {
  reaccion: number;
  nViguetas: number;
  wVigueta: number;
  MvPos: number;
  MvNeg: number;
  MvigaX: number;
  MvigaY: number;
  Ncentral: number;
  Nborde: number;
  Nesquina: number;
  Mpilar: number;
}

function medir(m: ModeloAnalitico, caso: string): Medidas {
  const r = calcular(m);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const k = m.casos!.findIndex((c) => c.id === caso);
  const c: ResultadoCaso = r.casos[k]!;
  const diag = new DiagramasBarras(m);
  const med: Medidas = { reaccion: 0, nViguetas: 0, wVigueta: 0, MvPos: 0, MvNeg: 0, MvigaX: 0, MvigaY: 0, Ncentral: 0, Nborde: 0, Nesquina: 0, Mpilar: 0 };
  for (let v = 0; v < m.nudos.length; v++) med.reaccion += c.reacciones[6 * v + 2]!;
  const enLinea = (x: number, lista: number[]) => lista.some((a) => Math.abs(x - a) < 1e-6);
  m.barras!.forEach((b, i) => {
    const [p, q] = b.nudos.map((v) => m.nudos[v]!);
    const d = diag.diagrama(i, k, c);
    const muestras = Array.from({ length: 41 }, (_, s) => (d.L * s) / 40);
    const My = muestras.map((x, s) => d.esfuerzosEn(x, s === 40 ? -1 : 1)[4]!);
    if (Math.abs(p!.z - q!.z) > 1) {
      // pilar: axil en la base y momento en la cabeza
      const N = Math.abs(d.esfuerzosEn(0, 1)[0]!);
      const borde = (enLinea(p!.x, [-9, 9]) ? 1 : 0) + (enLinea(p!.y, [-6, 6]) ? 1 : 0);
      if (borde === 2) med.Nesquina = Math.max(med.Nesquina, N);
      else if (borde === 1) med.Nborde = Math.max(med.Nborde, N);
      else med.Ncentral = Math.max(med.Ncentral, N);
      const cabeza = d.esfuerzosEn(d.L, -1);
      med.Mpilar = Math.max(med.Mpilar, Math.hypot(cabeza[4]!, cabeza[5]!));
      return;
    }
    const segunY = Math.abs(p!.x - q!.x) < 1e-6;
    const Mmax = Math.max(...My.map(Math.abs));
    if (segunY && !enLinea(p!.x, [-9, -3, 3, 9])) {
      med.nViguetas++;
      med.MvPos = Math.max(med.MvPos, ...My);
      med.MvNeg = Math.min(med.MvNeg, ...My);
      for (const x of muestras) {
        const w = diag.posicion(i, d, x, 1)[2] - diag.posicion(i, d, x, 0)[2];
        med.wVigueta = Math.min(med.wVigueta, w);
      }
    } else if (segunY) med.MvigaY = Math.max(med.MvigaY, Mmax);
    else med.MvigaX = Math.max(med.MvigaX, Mmax);
  });
  return med;
}

// ---------------------------------------------------------------------------------------------

const impUsuario = importarS2k(tablas);
const tPalanca = conPalanca(tablas);
const impPalanca = importarS2k(tPalanca);
for (const imp of [impUsuario, impPalanca]) if (imp.errores.length) throw new Error(imp.errores.join("\n"));
const sinNada: OpcionesCompilacion = { modificadores: {}, factorZonaRigida: 0 };
const VARIANTES: [string, () => ModeloAnalitico][] = [
  ["usuario (SAP2000)", () => impUsuario.modelo],
  ["usuario, cargas por la palanca", () => impPalanca.modelo],
  ["… y torsión de viguetas liberada", () => torsionLiberada(impPalanca.modelo, tPalanca, impPalanca)],
  ["compilado con las elecciones del usuario", () => compilado("ninguno", sinNada)],
  ["… + diafragma rígido", () => compilado("rigido", sinNada)],
  ["… + modificadores D4", () => compilado("rigido", { factorZonaRigida: 0 })],
  ["compilador por defecto (+ zona rígida 0,5)", () => compilado("rigido", {})],
];

const lineas: string[] = [];
const decir = (l = "") => lineas.push(l);
decir("# D2: el unidireccional del usuario (SAP2000) frente al del compilador, caso CPERM");
decir();
decir("Valores absolutos (kN, kN·m, mm) y, entre paréntesis, la diferencia frente a la fila anterior.");
decir();
decir("variante | ΣRz | viguetas | flecha de vigueta | M+ vigueta | M− vigueta | M vigas X | M vigas Y | N pilar central | N borde | N esquina | M cabeza pilar");
let previa: Medidas | null = null;
for (const [nombre, f] of VARIANTES) {
  const m = medir(f(), "CPERM");
  const d = (a: number, b: number | undefined, dec = 1) => `${a.toFixed(dec)}${b === undefined ? "" : ` (${b === 0 ? "—" : `${(100 * (a / b - 1)).toFixed(1)} %`})`}`;
  const p = previa;
  decir(
    `${nombre} | ${d(m.reaccion, p?.reaccion, 0)} | ${m.nViguetas} | ${d(-1000 * m.wVigueta, p ? -1000 * p.wVigueta : undefined, 2)} | ${d(m.MvPos, p?.MvPos)} | ${d(-m.MvNeg, p ? -p.MvNeg : undefined)} | ${d(m.MvigaX, p?.MvigaX)} | ${d(m.MvigaY, p?.MvigaY)} | ${d(m.Ncentral, p?.Ncentral)} | ${d(m.Nborde, p?.Nborde)} | ${d(m.Nesquina, p?.Nesquina)} | ${d(m.Mpilar, p?.Mpilar)}`,
  );
  previa = m;
}
console.log(lineas.join("\n"));
