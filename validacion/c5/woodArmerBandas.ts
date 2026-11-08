/**
 * Wood–Armer de las estaciones de una banda del Anejo I (C5-c, H34), para las medidas y la referencia
 * congelada de C5 (`congelar.ts`, `bandas.ts`, `banco.ts`). Estaba en `src/compilador/esfuerzosBandas.ts`
 * y salió del motor con VS-o (2026-11-08, `viento-sismo.md` §13.4): la app ya no usa las bandas (fase F)
 * y con el sismo del programa daba Wood–Armer con un solo signo. Aquí sólo combina linealmente: con los
 * casos del sismo, `combinar` lanza (sus factores no son uno por caso base). Los mismos bits que antes.
 */
import { envolventeWoodArmer, woodArmer, type EnvolventeWoodArmer, type MomentosWoodArmer } from "../../src/dimensionado/woodArmer.ts";
import { combinar } from "../../src/compilador/envolventes.ts";
import type { EstacionResultado } from "../../src/compilador/esfuerzosBandas.ts";

export type MetodoWoodArmer = "medios" | "puntos";

/**
 * Wood–Armer de una estación en cada combinación (factores por caso) y su envolvente (H34, C5-c):
 * - "medios" (a, por defecto): con los momentos medios de la banda;
 * - "puntos" (b): en cada punto de las muestras, con su Mx corregido (la misma cantidad en todos)
 *   para que integren el My exacto del corte; la media de lo que pide cada punto.
 * Momentos de dimensionado por metro (kN·m/m), en los ejes de la banda: X a lo largo de su eje.
 */
export function woodArmerEstacion(
  e: EstacionResultado,
  combinaciones: readonly ArrayLike<number>[],
  metodo: MetodoWoodArmer = "medios",
): { porCombinacion: MomentosWoodArmer[]; envolvente: EnvolventeWoodArmer } {
  if (metodo === "medios") {
    const ternas = new Float64Array(3 * combinaciones.length);
    combinaciones.forEach((f, c) => ternas.set(combinar(e.medios, 3, f), 3 * c));
    const porCombinacion = combinaciones.map((_, c) => woodArmer(ternas[3 * c]!, ternas[3 * c + 1]!, ternas[3 * c + 2]!));
    return { porCombinacion, envolvente: envolventeWoodArmer(ternas) };
  }
  if (!e.muestras) throw new Error(`La estación ${e.banda}@${e.s} no tiene muestras para Wood–Armer punto a punto`);
  const { pesos, momentos } = e.muestras;
  const np = pesos.length;
  const suma = pesos.reduce((a, w) => a + w, 0);
  const todos = new Float64Array(3 * np * momentos.length);
  momentos.forEach((m, k) => todos.set(m, 3 * np * k));
  const porCombinacion = combinaciones.map((f) => {
    const m = combinar(todos, 3 * np, f);
    let integral = 0;
    for (let i = 0; i < np; i++) integral += pesos[i]! * m[3 * i]!;
    const My = combinar(e.esfuerzos, 6, f)[4]!;
    const correccion = (My - integral) / suma;
    const r: MomentosWoodArmer = { inferiorX: 0, inferiorY: 0, superiorX: 0, superiorY: 0 };
    for (let i = 0; i < np; i++) {
      const w = woodArmer(m[3 * i]! + correccion, m[3 * i + 1]!, m[3 * i + 2]!);
      for (const c of ["inferiorX", "inferiorY", "superiorX", "superiorY"] as const) r[c] += (pesos[i]! * w[c]) / suma;
    }
    return r;
  });
  const valores: MomentosWoodArmer = { inferiorX: 0, inferiorY: 0, superiorX: 0, superiorY: 0 };
  const combinacion = { inferiorX: -1, inferiorY: -1, superiorX: -1, superiorY: -1 };
  porCombinacion.forEach((r, c) => {
    for (const q of ["inferiorX", "inferiorY", "superiorX", "superiorY"] as const)
      if (r[q] > valores[q]) {
        valores[q] = r[q];
        combinacion[q] = c;
      }
  });
  return { porCombinacion, envolvente: { valores, combinacion } };
}
