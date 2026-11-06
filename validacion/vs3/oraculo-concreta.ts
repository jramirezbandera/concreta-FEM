/**
 * Oráculo de VS3 (`docs/fem3d/viento-sismo.md` §5): el emplazamiento (cap. 2 de la NCSE-02) y el
 * método simplificado (art. 3.7) de Concreta (`src/lib/codes/seismic/ncse02.ts`, `calcularSismo`),
 * congelados en `src/normas/__fixtures__/ncse02-concreta.json`. Lo copiado aquí (`src/normas/ncse02.ts`:
 * `emplazamiento`, `factorAmortiguamiento`, `espectroElastico`, `simplificado`) tiene que dar lo mismo.
 *
 * No es código del repositorio: carga Concreta desde su clon (`../Concreta EST/concreta-v2`) sólo
 * para escribir el fixture, que sí se versiona, así que las pruebas no lo necesitan.
 *
 * Uso: bun validacion/vs3/oraculo-concreta.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ = join(import.meta.dirname, "..", "..");
const CONCRETA = join(RAIZ, "..", "Concreta EST", "concreta-v2");

interface Caso {
  nombre: string;
  ab: number;
  K: number;
  importancia: "normal" | "especial";
  terreno: "I" | "II" | "III" | "IV" | { C: number; espesor: number }[];
  sistema: "porticos-ha" | "porticos-acero" | "fabrica";
  mu: number;
  omega: number;
  /** Alturas de planta de abajo arriba, m, y peso sísmico de cada planta, kN. */
  alturas: number[];
  pesos: number[];
  /** Dimensión en planta en el sentido de la oscilación, m (fábrica). */
  L: number;
  /** Periodo fundamental dado, en lugar del de la expresión del art. 3.7.2.2. */
  TF?: number;
}

const CASOS: Caso[] = [
  { nombre: "Granada, cuatro plantas de pórticos de hormigón en terreno III", ab: 0.23, K: 1.0, importancia: "normal", terreno: "III", sistema: "porticos-ha", mu: 2, omega: 5, alturas: [3.5, 3, 3, 3], pesos: [2400, 2200, 2200, 1800], L: 20 },
  { nombre: "Málaga, siete plantas, importancia especial, terreno II", ab: 0.11, K: 1.0, importancia: "especial", terreno: "II", sistema: "porticos-ha", mu: 3, omega: 5, alturas: [4, 3, 3, 3, 3, 3, 3], pesos: [5200, 4800, 4800, 4800, 4800, 4800, 3900], L: 30 },
  { nombre: "Huelva (K = 1,3), doce plantas de acero: tres modos", ab: 0.1, K: 1.3, importancia: "normal", terreno: "IV", sistema: "porticos-acero", mu: 4, omega: 4, alturas: Array(12).fill(3.2), pesos: Array(12).fill(3100), L: 24 },
  { nombre: "fábrica achaparrada (periodo menor que TA), amortiguamiento del 6 %", ab: 0.16, K: 1.0, importancia: "normal", terreno: "II", sistema: "fabrica", mu: 1, omega: 6, alturas: [3, 3, 3, 3], pesos: [1500, 1500, 1500, 1200], L: 20 },
  { nombre: "estratos ponderados y periodo dado (dos modos)", ab: 0.07, K: 1.1, importancia: "normal", terreno: [{ C: 1.3, espesor: 8 }, { C: 1.6, espesor: 12 }, { C: 1.0, espesor: 6 }], sistema: "porticos-ha", mu: 2, omega: 5, alturas: [3.2, 3.2, 3.2, 3.2, 3.2], pesos: [2000, 2000, 2000, 2000, 1500], L: 18, TF: 0.9 },
];

const ncse = (await import(pathToFileURL(join(CONCRETA, "src", "lib", "codes", "seismic", "ncse02.ts")).href)) as {
  calcularSismo: (i: unknown) => {
    emplazamiento: { ab: number; K: number; rho: number; C: number; S: number; ac: number; TA: number; TB: number };
    nu: number;
    beta: number;
    x: { TF: number; nModos: number; Vk: number[]; Fk: number[]; cortanteBasal: number };
  };
  elasticSpectrum: (T: number, TA: number, TB: number) => number;
};

const salida = CASOS.map((c) => {
  // Las alturas sobre rasante como las suma el modelo: de abajo arriba, altura a altura
  const hs: number[] = [];
  let z = 0;
  for (const h of c.alturas) hs.push((z += h));
  const dir = { L: c.L, B: 0, elementos: [], ...(c.TF !== undefined ? { TFManual: c.TF } : {}) };
  const r = ncse.calcularSismo({
    emplazamiento: { ab: c.ab, K: c.K, importancia: c.importancia, terreno: c.terreno },
    estructura: { sistema: c.sistema, n: c.alturas.length, H: z, omega: c.omega, mu: c.mu },
    plantas: hs.map((h, i) => ({ h, P: c.pesos[i]! })),
    x: dir,
    y: dir,
  });
  const e = r.emplazamiento;
  const espectro = [0, 0.5 * e.TA, e.TA, 0.5 * (e.TA + e.TB), e.TB, 2 * e.TB, 3].map((T) => ({ T, alfa: ncse.elasticSpectrum(T, e.TA, e.TB) }));
  return { ...c, H: z, h: hs, emplazamiento: e, nu: r.nu, beta: r.beta, espectro, simplificado: { TF: r.x.TF, modos: r.x.nModos, cortantes: r.x.Vk, fuerzas: r.x.Fk, basal: r.x.cortanteBasal } };
});

const carpeta = join(RAIZ, "src", "normas", "__fixtures__");
mkdirSync(carpeta, { recursive: true });
const ruta = join(carpeta, "ncse02-concreta.json");
writeFileSync(ruta, JSON.stringify({ origen: "Concreta, src/lib/codes/seismic/ncse02.ts (calcularSismo, elasticSpectrum), por validacion/vs3/oraculo-concreta.ts", casos: salida }, null, 2) + "\n");
console.log(`${salida.length} casos en ${ruta}`);
