/**
 * Criterio 2 de C2: la losa plana de H25 (12 × 12 m, t = 0,25 m, 3 × 3 pilares de 0,6 × 0,6 m en
 * x, y = 0, 6 y 12, q = 10 kN/m²) descrita como modelo físico y mallada por C2, frente a la rejilla
 * de E5 (`validacion/e5/bandas.ts`).
 *
 * Para parecerse al apoyo de E5 (la cabeza de cada pilar apoyada en z y articulada), los pilares
 * tienen la cabeza articulada (My y Mz liberados) y el axil ×100 (el máximo que se admite): su
 * acortamiento es del orden de 1e-6 m frente a flechas de milímetros. La planta lleva el diafragma
 * rígido por defecto, así que se prueba también la cadena huella → diafragma.
 *
 * Las bandas de pilar (3 m) y de pórtico (6 m) arrancan en la cara x = 6,3 del pilar central: sus
 * extremos siembran la línea de la cara en la malla, y el corte por fuerzas nodales es exacto. El
 * vano (x = 3) se corta por «campos».
 *
 * Uso: bun validacion/c2/losaPlana.ts → validacion/c2/out_losa_plana.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion, Pilar } from "../../src/compilador/fisico.ts";
import type { Corte } from "../../src/motor/cortes.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";
import { bandasLosaPlana, cortarModelo, LUZ, PILAR } from "../e5/bandas.ts";

export const Z_LOSA = 3;

export function losaPlanaFisica(): ModeloFisico {
  const pilares: Pilar[] = [];
  for (const x of [0, LUZ, 2 * LUZ]) for (const y of [0, LUZ, 2 * LUZ]) pilares.push({ id: `P${x}-${y}`, x, y, desde: "B", hasta: "L", seccion: "S", liberaciones: { cabeza: [false, false, false, false, true, true] } });
  const xc = LUZ + PILAR / 2;
  return {
    plantas: [
      { id: "L", altura: null },
      { id: "B", altura: Z_LOSA },
    ],
    materiales: [{ id: "M", tipo: "general", E: 3e7, G: 1.25e7, peso: 0 }],
    secciones: [{ id: "S", material: "M", forma: "rectangular", b: PILAR, h: PILAR }],
    pilares,
    losas: [
      {
        id: "LOSA",
        planta: "L",
        contorno: [
          [0, 0],
          [2 * LUZ, 0],
          [2 * LUZ, 2 * LUZ],
          [0, 2 * LUZ],
        ],
        espesor: 0.25,
        material: "M",
      },
    ],
    bandas: [
      { id: "banda-pilar", planta: "L", desde: [xc, LUZ], hasta: [2 * LUZ - PILAR / 2, LUZ], ancho: 3 },
      { id: "portico", planta: "L", desde: [xc, LUZ], hasta: [2 * LUZ - PILAR / 2, LUZ], ancho: 6 },
    ],
    casos: [{ id: "q" }],
    cargas: [{ tipo: "superficie", id: "Q", caso: "q", planta: "L", losa: "LOSA", q: [0, 0, -10] }],
  };
}

export const OPCIONES_LOSA_PLANA: OpcionesCompilacion = { modificadores: { pilares: { todos: { A: 100 } } } };

export interface ResultadoLosaPlana {
  /** My y Vz [banda, pórtico] en la cara, por fuerzas nodales. */
  cara: number[][];
  /** My [banda, pórtico] en el vano (x = 3), por campos. */
  vano: number[];
  nudos: number;
  laminas: number;
  jacobianoMin: number;
}

export function cortesC2(): Corte[] {
  const xc = LUZ + PILAR / 2;
  const c = (x: number, ancho: number, metodo: "fuerzas-nodales" | "campos"): Corte => ({ id: `${metodo} x = ${x}, ${ancho} m`, origen: [x, LUZ, Z_LOSA], x: [1, 0, 0], vz: [0, 0, 1], y: [-ancho / 2, ancho / 2], metodo });
  return [c(xc, 3, "fuerzas-nodales"), c(xc, 6, "fuerzas-nodales"), c(3, 3, "campos"), c(3, 6, "campos")];
}

export function losaPlanaC2(h: number): ResultadoLosaPlana {
  const r = valido(compilar(losaPlanaFisica(), { ...OPCIONES_LOSA_PLANA, tamanoMalla: h }));
  const cs = cortarModelo(r.modelo, cortesC2());
  for (const x of cs) if (!x.valido) throw new Error(x.diagnosticos.map((d) => d.mensaje).join(" | "));
  return {
    cara: [
      [cs[0]!.esfuerzos[4]!, cs[1]!.esfuerzos[4]!],
      [cs[0]!.esfuerzos[2]!, cs[1]!.esfuerzos[2]!],
    ],
    vano: [cs[2]!.esfuerzos[4]!, cs[3]!.esfuerzos[4]!],
    nudos: r.estadisticas.nudos,
    laminas: r.estadisticas.laminas,
    jacobianoMin: r.estadisticas.malla.jacobianoMin,
  };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const lineas: string[] = [`# validacion/c2/losaPlana.ts — ${new Date().toLocaleDateString("sv-SE")}: losa plana de H25 como modelo físico (C2) frente a la rejilla de E5`];
  const ref = bandasLosaPlana(0.075);
  lineas.push("", "Referencia: rejilla de E5 con h = 0,075 m (fuerzas nodales en la cara, campos en el vano).");
  lineas.push("| malla | nudos | láminas | jac. mín. | My banda, cara | My pórtico, cara | Vz banda, cara | Vz pórtico, cara | My banda, vano | My pórtico, vano |");
  lineas.push("|---|---|---|---|---|---|---|---|---|---|");
  const f = (v: number) => v.toFixed(2);
  lineas.push(`| E5, h = 0,075 | | | | ${f(ref.caraNodal[0]![0]!)} | ${f(ref.caraNodal[1]![0]!)} | ${f(ref.caraNodal[0]![1]!)} | ${f(ref.caraNodal[1]![1]!)} | ${f(ref.vanoCampos[0]!)} | ${f(ref.vanoCampos[1]!)} |`);
  const pct = (a: number, b: number) => `${(100 * (a / b - 1) >= 0 ? "+" : "") + (100 * (a / b - 1)).toFixed(2)} %`;
  for (const h of [0.5, 0.3, 0.15]) {
    const r = losaPlanaC2(h);
    lineas.push(
      `| C2, h = ${h} | ${r.nudos} | ${r.laminas} | ${r.jacobianoMin.toFixed(3)} | ${f(r.cara[0]![0]!)} (${pct(r.cara[0]![0]!, ref.caraNodal[0]![0]!)}) | ${f(r.cara[0]![1]!)} (${pct(r.cara[0]![1]!, ref.caraNodal[1]![0]!)}) | ${f(r.cara[1]![0]!)} (${pct(r.cara[1]![0]!, ref.caraNodal[0]![1]!)}) | ${f(r.cara[1]![1]!)} (${pct(r.cara[1]![1]!, ref.caraNodal[1]![1]!)}) | ${f(r.vano[0]!)} (${pct(r.vano[0]!, ref.vanoCampos[0]!)}) | ${f(r.vano[1]!)} (${pct(r.vano[1]!, ref.vanoCampos[1]!)}) |`,
    );
  }
  const texto = lineas.join("\n");
  console.log(texto);
  writeFileSync(join(import.meta.dirname, "out_losa_plana.txt"), texto + "\n");
}
