/**
 * Oráculo de VS1 (criterio 1, `docs/fem3d/viento-sismo.md` §5): las fuerzas por planta del viento
 * de Concreta (`src/lib/acciones/viento.ts`, `calcularViento`) en edificios rectangulares, congeladas
 * en `src/compilador/__fixtures__/viento-concreta.json`. Con todas las plantas del mismo ancho, el
 * viento del compilador tiene que dar lo mismo.
 *
 * No es código del repositorio: carga Concreta desde su clon (`../Concreta EST/concreta-v2`) sólo
 * para escribir el fixture, que sí se versiona, así que las pruebas no lo necesitan.
 *
 * Uso: bun validacion/vs/oraculo-concreta.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ = join(import.meta.dirname, "..", "..");
const CONCRETA = join(RAIZ, "..", "Concreta EST", "concreta-v2");

interface Caso {
  nombre: string;
  zona: "A" | "B" | "C";
  qb?: number;
  aspereza: "I" | "II" | "III" | "IV" | "V";
  /** Alturas de planta de abajo arriba, m: el primer forjado está a la primera. */
  alturas: number[];
  dimensiones: { x: number; y: number };
}

const CASOS: Caso[] = [
  { nombre: "tres plantas de 3,10 en 20 × 12 (prueba de Concreta)", zona: "B", aspereza: "III", alturas: [3.1, 3.1, 3.1], dimensiones: { x: 20, y: 12 } },
  { nombre: "siete plantas de 3 m en 30 × 18", zona: "A", aspereza: "II", alturas: [3, 3, 3, 3, 3, 3, 3], dimensiones: { x: 30, y: 18 } },
  { nombre: "una planta de 4 m con qb simplificada en 7,5 × 7,5", zona: "C", qb: 0.5, aspereza: "I", alturas: [4], dimensiones: { x: 7.5, y: 7.5 } },
  { nombre: "doce plantas de 3,2 en 15 × 10 (esbelto)", zona: "A", aspereza: "V", alturas: Array(12).fill(3.2), dimensiones: { x: 15, y: 10 } },
  { nombre: "planta baja alta y cuatro de 2,9 en 24,3 × 13,7", zona: "C", qb: 0.61, aspereza: "IV", alturas: [4.5, 2.9, 2.9, 2.9, 2.9], dimensiones: { x: 24.3, y: 13.7 } },
];

const viento = (await import(pathToFileURL(join(CONCRETA, "src", "lib", "acciones", "viento.ts")).href)) as {
  calcularViento: (i: unknown) => {
    errores: string[];
    x: { cp: number; cs: number; esbeltez: number; excentricidad: number; plantas: { h?: number; z: number; hTrib: number; ce: number; F: number }[] };
    y: { cp: number; cs: number; esbeltez: number; excentricidad: number; plantas: { z: number; hTrib: number; ce: number; F: number }[] };
  };
};

const salida = CASOS.map((c) => {
  // Las cotas como las suma el modelo: de abajo arriba, altura a altura
  const cotas: number[] = [];
  let z = 0;
  for (const h of c.alturas) cotas.push((z += h));
  const r = viento.calcularViento({
    zona: c.zona,
    ...(c.qb !== undefined ? { qbManual: c.qb } : {}),
    aspereza: c.aspereza,
    plantas: cotas.map((h, i) => ({ id: `N${i + 1}`, h })),
    dimensiones: c.dimensiones,
  });
  if (r.errores.length) throw new Error(`${c.nombre}: ${r.errores.join("; ")}`);
  const dir = (d: typeof r.x) => ({ cp: d.cp, cs: d.cs, esbeltez: d.esbeltez, e: d.excentricidad, plantas: d.plantas.map((p) => ({ z: p.z, hTrib: p.hTrib, ce: p.ce, F: p.F })) });
  return { ...c, x: dir(r.x), y: dir(r.y) };
});

const ruta = join(RAIZ, "src", "compilador", "__fixtures__", "viento-concreta.json");
writeFileSync(ruta, JSON.stringify({ origen: "Concreta, src/lib/acciones/viento.ts (calcularViento), por validacion/vs/oraculo-concreta.ts", casos: salida }, null, 2) + "\n");
console.log(`${salida.length} casos en ${ruta}`);
