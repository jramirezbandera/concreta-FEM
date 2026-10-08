/**
 * D3 frente al modelo de SAP2000 del usuario (RETICULAR/, 2026-10-08): el mismo edificio calculado
 * con el motor con los multiplicadores de la zona aligerada del usuario (su hoja «EQUIVALENCIA LOSA
 * RETICULAR SAP»: ν = 0,2, todo por razones de la T) y con los del compilador (C4-h:
 * `multiplicadoresReticular`, ν = 0), y con cada diferencia por separado, para ver cuánto pesa cada una.
 *
 * Lo demás (geometría, malla de 1 m, ábacos, vigas y pilares, apoyos) es el modelo del usuario tal
 * cual lo importa `importar.ts`. Casos: peso propio (DEAD del usuario) y una carga uniforme de
 * 5 kN/m² hacia abajo en toda la losa (las cargas CPERM y Q del modelo de SAP2000 son «gravity» con
 * multiplicador +2: dos veces el peso de cada área hacia arriba).
 *
 * Uso: bun validacion/e6/sap2000/reticular-d3.ts <reticular.s2k exportado por SAP2000> → informe en pantalla
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../../src/motor/calcular.ts";
import { DiagramasBarras } from "../../../src/motor/barras.ts";
import { ResultantesLaminas } from "../../../src/motor/laminas.ts";
import type { ModeloAnalitico, ResultadoCaso } from "../../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { multiplicadoresReticular } from "../../../src/compilador/reticular.ts";
import type { MultiplicadoresLamina } from "../../../src/elementos/lamina.ts";
import { importarS2k } from "./importar.ts";
import { leerTablas } from "./s2k.ts";

const ruta = process.argv[2];
if (!ruta) {
  console.error("Uso: bun validacion/e6/sap2000/reticular-d3.ts <reticular.s2k>");
  process.exit(1);
}
await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const tablas = leerTablas(readFileSync(ruta, "latin1"));
const imp = importarS2k(tablas);
if (imp.errores.length) throw new Error(imp.errores.join("\n"));
const seccion = new Map((tablas.get("AREA SECTION ASSIGNMENTS") ?? []).map((f) => [f.Area!, f.Section!]));
const aligeradas = new Set([...imp.laminas].filter(([a]) => /RETICULAR/i.test(seccion.get(a) ?? "")).map(([, l]) => l));

// Nervio de la hoja del usuario: intereje 70, nervio 12, canto 25 + 5 de capa (cm)
const g = { h: 0.3, hf: 0.05, bw: 0.12, s: 0.7 };
const nu = 0.2;
const usuario = imp.modelo.laminas![[...aligeradas][0]!]!.multiplicadores!;
const compilador = multiplicadoresReticular(g, nu);

interface Variante {
  nombre: string;
  /** ν de la lámina aligerada y sus multiplicadores. */
  nu: number;
  mult: MultiplicadoresLamina;
}
const VARIANTES: Variante[] = [
  { nombre: "usuario (SAP2000)", nu, mult: usuario },
  { nombre: "usuario con ν = 0", nu: 0, mult: usuario },
  { nombre: "usuario con m12 del compilador", nu, mult: { ...usuario, m12: compilador.m12 * (1 + nu) } },
  { nombre: "usuario con v13, v23 del compilador", nu, mult: { ...usuario, v13: compilador.v13 * (1 + nu), v23: compilador.v23 * (1 + nu) } },
  { nombre: "usuario con f12 del compilador", nu, mult: { ...usuario, f12: compilador.f12 * (1 + nu) } },
  { nombre: "compilador (C4-h)", nu: 0, mult: compilador },
];

/** Modelo con la variante y un caso más: 5 kN/m² hacia abajo en todas las láminas. */
function modeloVariante(v: Variante): ModeloAnalitico {
  const m = imp.modelo;
  return {
    ...m,
    laminas: m.laminas!.map((l, i) => (aligeradas.has(i) ? { ...l, material: { ...l.material, nu: v.nu }, multiplicadores: v.mult } : l)),
    casos: [m.casos![imp.patrones.indexOf("DEAD")]!, { id: "q5", laminas: m.laminas!.map((_, i) => ({ tipo: "superficie" as const, lamina: i, ejes: "global" as const, q: [0, 0, -5] as const })) }],
  };
}

interface Medidas {
  wMax: number;
  w: Float64Array;
  N: number[];
  Mpilar: number[];
  M: Float64Array;
}
const pilares = imp.modelo.barras!.map((b, i) => ({ b, i })).filter(({ b }) => Math.abs(imp.modelo.nudos[b.nudos[0]]!.z - imp.modelo.nudos[b.nudos[1]]!.z) > 1);
function medir(m: ModeloAnalitico, c: ResultadoCaso): Medidas {
  const losa = m.nudos.map((n, v) => (Math.abs(n.z - 3) < 1e-9 ? c.u[6 * v + 2]! : 0));
  const diag = new DiagramasBarras(m);
  const lam = new ResultantesLaminas(m);
  // momentos M11, M22 en el centroide de cada lámina (media de sus nudos)
  const M = new Float64Array(2 * m.laminas!.length);
  m.laminas!.forEach((_, l) => {
    const en = lam.enNudos(l, c.u);
    for (let a = 0; a < 4; a++) {
      M[2 * l] += en[8 * a + 3]! / 4;
      M[2 * l + 1] += en[8 * a + 4]! / 4;
    }
  });
  const N: number[] = [];
  const Mpilar: number[] = [];
  for (const { i } of pilares) {
    const d = diag.diagrama(i, 0, c);
    const [a, b] = m.barras![i]!.nudos.map((v) => m.nudos[v]!);
    const arriba = d.esfuerzosEn(Math.hypot(b!.x - a!.x, b!.y - a!.y, b!.z - a!.z), -1);
    N.push(d.esfuerzosEn(0, 1)[0]!);
    Mpilar.push(Math.hypot(arriba[4]!, arriba[5]!));
  }
  return { wMax: Math.min(...losa), w: Float64Array.from(losa), N, Mpilar, M };
}

const pct = (a: number, b: number) => `${(100 * (a / b - 1)).toFixed(1)} %`;
const lineas: string[] = [];
const decir = (l = "") => lineas.push(l);
decir(`# D3: multiplicadores del usuario frente a los del compilador, en el reticular de SAP2000 del usuario`);
decir();
decir(`Nervio: h = ${g.h}, hf = ${g.hf}, bw = ${g.bw}, s = ${g.s} m; ν del hormigón ${nu}.`);
decir(`Usuario: ${JSON.stringify(usuario)}`);
decir(`Compilador (sobre ν = 0): ${JSON.stringify(Object.fromEntries(Object.entries(compilador).map(([k, v]) => [k, Number(v.toFixed(4))])))}`);
for (const [k, caso] of [[0, "peso propio (DEAD)"], [1, "5 kN/m² en toda la losa"]] as const) {
  decir();
  decir(`## ${caso}`);
  decir();
  decir("variante | flecha máx. (m) | frente al usuario | flechas (|w| > 0,3·máx): rango frente al usuario | axil de pilares: máx. dif. | M en cabeza de pilares: máx. dif. (sobre el máx.) | M11, M22 en centroides: máx. dif. (sobre el máx.)");
  let ref: Medidas | null = null;
  for (const v of VARIANTES) {
    const m = modeloVariante(v);
    const r = calcular(m);
    if (!r.valido) throw new Error(`${v.nombre}: ${r.diagnosticos.map((d) => d.mensaje).join("; ")}`);
    const med = medir(m, r.casos[k]!);
    ref ??= med;
    const sel = [...ref.w.keys()].filter((i) => Math.abs(ref!.w[i]!) > 0.3 * Math.abs(ref!.wMax));
    const razones = sel.map((i) => med.w[i]! / ref!.w[i]! - 1);
    const maxN = Math.max(...ref.N.map(Math.abs));
    const maxMp = Math.max(...ref.Mpilar);
    const maxM = Math.max(...ref.M.map(Math.abs));
    const dN = Math.max(...med.N.map((x, i) => Math.abs(x - ref!.N[i]!) / Math.abs(ref!.N[i]!)));
    const dMp = Math.max(...med.Mpilar.map((x, i) => Math.abs(x - ref!.Mpilar[i]!))) / maxMp;
    const dM = Math.max(...med.M.map((x, i) => Math.abs(x - ref!.M[i]!))) / maxM;
    void maxN;
    decir(`${v.nombre} | ${med.wMax.toExponential(4)} | ${pct(med.wMax, ref.wMax)} | ${(100 * Math.min(...razones)).toFixed(1)} … ${(100 * Math.max(...razones)).toFixed(1)} % | ${(100 * dN).toFixed(1)} % | ${(100 * dMp).toFixed(1)} % | ${(100 * dM).toFixed(1)} %`);
  }
}
console.log(lineas.join("\n"));
