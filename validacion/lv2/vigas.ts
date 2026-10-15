/**
 * Criterio 2 de la fase LV2 (`docs/fem3d/refinamiento-vigas.md`): 3 × 3 recuadros de 7,2 m entre
 * caras (reticular 25+5 recuperable, vigas y pilares de 30 × 30 en todos los ejes, 10 kN/m²). El
 * momento y el cortante de la viga de borde X0 y de la interior X1 en las caras de los pilares, y el
 * momento de vano, con h = 0,75 (LV1 sin las esquinas, LV2 con uno y dos niveles) y con la malla
 * uniforme de 0,25, frente a la de 0,055 (con ε_snap = 0,025: con 0,05, h no baja de 0,1). Pasa si
 * ningún valor de LV2 está más lejos de la referencia que el de la malla uniforme de 0,25.
 *
 *   bun validacion/lv2/vigas.ts > validacion/lv2/out_vigas.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { PLANTILLA_ESQUINA } from "../../src/compilador/rejilla.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const e = 0.15;
const L = 10 * 0.72;
const P = L + 2 * e;
const n = 3;
const ejes = Array.from({ length: n + 1 }, (_, i) => i * P);

/** El modelo: losa hasta los ejes de las vigas de borde. */
export function tresPorTres(): ModeloFisico {
  return {
    plantas: [{ id: "T", altura: null }, { id: "B", altura: 3.35 }],
    materiales: [{ id: "H", tipo: "hormigon", fck: 30, peso: 0 }],
    secciones: [
      { id: "P30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "V30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
    ],
    pilares: ejes.flatMap((x, i) => ejes.map((y, j) => ({ id: `C${i}${j}`, x, y, desde: "B", hasta: "T", seccion: "P30" }))),
    vigas: [
      ...ejes.map((y, j) => ({ id: `X${j}`, planta: "T", puntos: [[0, y], [n * P, y]] as [number, number][], seccion: "V30" })),
      ...ejes.map((x, i) => ({ id: `Y${i}`, planta: "T", puntos: [[x, 0], [x, n * P]] as [number, number][], seccion: "V30" })),
    ],
    losas: [
      {
        id: "L",
        planta: "T",
        contorno: [[0, 0], [n * P, 0], [n * P, n * P], [0, n * P]],
        espesor: 0.3,
        material: "H",
        reticular: { intereje: 0.72, nervio: 0.12, capa: 0.05, caseton: "recuperable", abacos: [] },
      },
    ],
    casos: [{ id: "q" }],
    cargas: [{ tipo: "superficie", id: "Q", caso: "q", planta: "T", q: [0, 0, -10], losa: "L" }],
  };
}

const f = tresPorTres();
// Estaciones: cara del pilar de esquina (s = e), caras izquierda y derecha del primer pilar interior
// (P ∓ e: lado del vano extremo y del central) y centro del vano central
const ESTACIONES: [string, number, "izquierda" | "derecha", 2 | 4][] = [];
for (const [nombre, s, lado] of [
  ["esquina", e, "derecha"],
  ["vano extremo", P - e, "izquierda"],
  ["vano central", P + e, "derecha"],
] as const)
  for (const [m, k] of [["M", 4], ["V", 2]] as const) ESTACIONES.push([`${m} ${nombre}`, s, lado, k]);
ESTACIONES.push(["M centro", 1.5 * P, "derecha", 4]);

function medir(op: OpcionesCompilacion): { r: Map<string, number>; nudos: number } {
  const c = valido(compilar(f, op));
  const q = new Consultas(f, c, casosValidos(calcular(c.modelo)), op);
  const r = new Map<string, number>();
  for (const v of ["X0", "X1"]) {
    const dg = q.diagrama(v, [1]);
    if (!dg.valido) throw new Error(JSON.stringify(dg));
    const est = dg.valor;
    for (const [nombre, s, lado, k] of ESTACIONES) {
      let x: number | undefined;
      for (let i = 0; i + 1 < est.length && x === undefined; i++) {
        const [a, b] = [est[i]!, est[i + 1]!];
        if (s >= a.s - 1e-9 && s <= b.s + 1e-9 && b.s > a.s) {
          const w = (s - a.s) / (b.s - a.s);
          x = a[lado][k]! * (1 - w) + b[lado][k]! * w;
        }
      }
      if (x === undefined) throw new Error(`estación ${s}`);
      r.set(`${v} ${nombre}`, x);
    }
  }
  return { r, nudos: c.estadisticas.nudos };
}

if (import.meta.main) {
  const ref = medir({ tamanoMalla: 0.055, epsSnap: 0.025 });
  const claves = [...ref.r.keys()];
  const defecto = { ...PLANTILLA_ESQUINA };
  const variantes: [string, OpcionesCompilacion, typeof defecto][] = [
    ["h = 0,25 uniforme (LV1)", { tamanoMalla: 0.25, refinoEsquinas: false }, defecto],
    ["LV1, h = 0,75 (sin esquinas)", { refinoEsquinas: false }, defecto],
    ["LV2, tercios, dos niveles", { refinoEsquinas: true }, { tipo: "tercios", niveles: 2 }],
    ["LV2, graduada, 2 niveles", { refinoEsquinas: true }, { tipo: "graduada", niveles: 2 }],
    ["LV2, graduada, 3 niveles", { refinoEsquinas: true }, { tipo: "graduada", niveles: 3 }],
  ];
  const res = variantes.map(([nombre, op, pe]) => {
    Object.assign(PLANTILLA_ESQUINA, pe);
    return { nombre, ...medir(op) };
  });
  Object.assign(PLANTILLA_ESQUINA, defecto);
  console.log(`## 3 × 3 recuadros de 7,2 m: error frente a h = 0,055 (${ref.nudos} nudos)\n`);
  console.log(`${"".padEnd(30)}${"nudos".padStart(7)}${claves.map((k) => k.padStart(17)).join("")}`);
  console.log(`${"h = 0,055 (kN·m, kN)".padEnd(30)}${String(ref.nudos).padStart(7)}${claves.map((k) => ref.r.get(k)!.toFixed(2).padStart(17)).join("")}`);
  const err = (x: Map<string, number>, k: string) => x.get(k)! / ref.r.get(k)! - 1;
  for (const x of res) console.log(`${x.nombre.padEnd(30)}${String(x.nudos).padStart(7)}${claves.map((k) => `${(100 * err(x.r, k)).toFixed(1)} %`.padStart(17)).join("")}`);
  const u = res[0]!;
  for (const x of res.slice(2)) {
    const peores = claves.filter((k) => Math.abs(err(x.r, k)) > Math.abs(err(u.r, k)) + 1e-9);
    console.log(`\n${x.nombre}: ${peores.length ? `peor que h = 0,25 en ${peores.join(", ")}` : "en todo, no peor que h = 0,25 (pasa)"}`);
  }
}
