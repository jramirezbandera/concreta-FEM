/**
 * Los pilares en el 3D del visor por colores (I4, `docs/fem3d/interfaz.md` §7 y §15): cada tramo,
 * de cota a cota en el eje del pilar (el del alámbrico), del color de la banda de su valor.
 *
 * - N: la mayor compresión de la base y la cabeza del tramo (la columna N del cuadro de pilares,
 *   `compresionTramo`); ν: el axil reducido de A3 (sólo en los tramos de hormigón; los demás, sin
 *   valor y en gris).
 * - Los valores son los del cuadro (`filasPilarQ`: `pieza` y `Consultas.pilar`), bit a bit.
 * - Bandas con los límites y la paleta de los mapas (`limitesMapa`, `coloresBandas`): en N, con el 0
 *   como límite; en ν, de 0 en pasos de 0,05, así que el límite de A3 (0,65) es uno de ellos.
 * - Rótulos: la mayor compresión y la mayor ν con su pilar, su tramo y su combinación, y los tramos
 *   que pasan el límite de ν.
 *
 * Las coordenadas, en Float32 respecto a `origen` (el del alámbrico), Z hacia arriba.
 *
 * Puro: sin IO.
 */
import type { ConjuntoCombinaciones } from "../agente/combinaciones.ts";
import { rotulo, type EntradaLeyenda } from "../agente/render/escena.ts";
import { coloresBandas, limitesMapa, type LimitesMapa } from "../agente/render/isovalores.ts";
import type { ResultadosRender } from "../agente/render/resultados.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import { compresionTramo, filasPilarQ, LIMITE_AXIL_REDUCIDO } from "./datos.ts";

type V3 = [number, number, number];

export type MagnitudPilares = "N" | "nu";
/** Banda de un tramo sin valor (ν de un pilar de acero). */
export const SIN_BANDA = 0xffff;
/** Paso de las bandas de ν. */
const PASO_NU = 0.05;

export interface TramoColor {
  pilar: string;
  /** Planta de su cabeza y de su base. */
  planta: string;
  plantaBase: string;
  seccion: string;
  /** null: sin valor (ν en un tramo que no es de hormigón). */
  valor: number | null;
  comb: string | null;
  /** Dónde se da (N: la base o la cabeza del tramo flexible). */
  donde?: "base" | "cabeza";
  /** Sus extremos (m, globales). */
  a: V3;
  b: V3;
}

export interface ExtremoPilares {
  que: "mayor compresión" | "mayor ν" | "pasa el límite";
  valor: number;
  pilar: string;
  planta: string;
  comb: string;
  /** El centro del tramo (m, globales). */
  punto: V3;
}

export interface Pilares3D {
  magnitud: MagnitudPilares;
  unidad: string;
  origen: [number, number, number];
  conjunto: { descripcion: string; n: number };
  /** Los dos extremos de cada tramo, respecto al origen, y su banda (SIN_BANDA: sin valor). */
  segmentos: Float32Array;
  banda: Uint16Array;
  colores: string[];
  tramos: TramoColor[];
  extremos: ExtremoPilares[];
  limite?: number;
  leyenda: EntradaLeyenda[];
  notas: string[];
}

export function pilares3D(r: ResultadosRender, origen: [number, number, number], magnitud: MagnitudPilares, conjunto: ConjuntoCombinaciones, planta: string | null): Pilares3D {
  const f = r.q.fisico;
  const idx = new Map(f.plantas.map((p, i) => [p.id, i]));
  const cotas = cotasPlantas(f.plantas);
  const tramos: TramoColor[] = [];
  let sinFilas = 0;
  for (const p of [...(f.pilares ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const filas = filasPilarQ(r.q, conjunto, p.id);
    if (!filas.valido) {
      sinFilas++;
      continue;
    }
    const t = r.q.pilar(p.id);
    for (const x of filas.valor) {
      if (planta !== null && x.planta !== planta) continue;
      const tp = t.valido ? t.valor.find((y) => y.planta === x.planta) : undefined;
      if (!tp) continue;
      const z0 = cotas[idx.get(tp.plantaBase) ?? -1];
      const z1 = cotas[idx.get(x.planta) ?? -1];
      if (z0 === null || z0 === undefined || z1 === null || z1 === undefined) continue;
      let valor: number | null = null;
      let comb: string | null = null;
      let donde: "base" | "cabeza" | undefined;
      if (magnitud === "N") {
        const c = compresionTramo(x);
        if (c) [valor, comb, donde] = [c.v, c.comb, c.donde];
      } else if (x.nu) [valor, comb] = [x.nu.nu, x.nu.comb];
      tramos.push({ pilar: p.id, planta: x.planta, plantaBase: tp.plantaBase, seccion: x.tramo.seccion, valor, comb, ...(donde ? { donde } : {}), a: [p.x, p.y, z0], b: [p.x, p.y, z1] });
    }
  }
  const valores = tramos.map((t) => t.valor).filter((v): v is number => v !== null);
  const [vmin, vmax] = valores.length ? [Math.min(...valores), Math.max(...valores)] : [0, 0];
  const notas: string[] = [];
  const leyenda: EntradaLeyenda[] = [];
  let colores: string[] = [];
  let L: number[] = [];
  if (valores.length) {
    const lm = (magnitud === "nu" ? limitesMapa(vmin, vmax, { min: 0, max: Math.max(PASO_NU, Math.ceil(vmax / PASO_NU - 1e-9) * PASO_NU), paso: PASO_NU }) : limitesMapa(vmin, vmax)) as LimitesMapa;
    L = lm.L;
    colores = coloresBandas(L, { abajo: lm.fueraAbajo, arriba: lm.fueraArriba });
    for (let b = L.length - 2; b >= 0; b--) leyenda.push({ relleno: colores[b]!, texto: `${rotulo(L[b]!, 4)} a ${rotulo(L[b + 1]!, 4)}${magnitud === "nu" && L[b]! >= LIMITE_AXIL_REDUCIDO - 1e-12 ? " (pasa el aviso de A3; no es la comprobación de norma)" : ""}` });
  }
  const banda = new Uint16Array(tramos.length).fill(SIN_BANDA);
  tramos.forEach((t, i) => {
    if (t.valor === null || !L.length) return;
    let k = 0;
    while (k < L.length - 2 && t.valor >= L[k + 1]!) k++;
    banda[i] = k;
  });
  if (tramos.some((t) => t.valor === null)) leyenda.push({ relleno: "#9ca3af", texto: "Sin ν: no es de hormigón" });
  const segmentos = new Float32Array(6 * tramos.length);
  tramos.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      segmentos[6 * i + k] = t.a[k]! - origen[k]!;
      segmentos[6 * i + 3 + k] = t.b[k]! - origen[k]!;
    }
  });
  const centro = (t: TramoColor): V3 => [(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2, (t.a[2] + t.b[2]) / 2];
  const extremos: ExtremoPilares[] = [];
  const conValor = tramos.filter((t): t is TramoColor & { valor: number; comb: string } => t.valor !== null && t.comb !== null);
  if (conValor.length) {
    if (magnitud === "N") {
      const m = conValor.reduce((x, y) => (y.valor < x.valor ? y : x));
      if (m.valor < 0) extremos.push({ que: "mayor compresión", valor: m.valor, pilar: m.pilar, planta: m.planta, comb: m.comb, punto: centro(m) });
    } else {
      const m = conValor.reduce((x, y) => (y.valor > x.valor ? y : x));
      extremos.push({ que: "mayor ν", valor: m.valor, pilar: m.pilar, planta: m.planta, comb: m.comb, punto: centro(m) });
      for (const t of conValor) if (t !== m && t.valor > LIMITE_AXIL_REDUCIDO) extremos.push({ que: "pasa el límite", valor: t.valor, pilar: t.pilar, planta: t.planta, comb: t.comb, punto: centro(t) });
    }
  }
  notas.push(conjunto.factores.length > 1 ? `Envolvente de ${conjunto.descripcion} (${conjunto.factores.length} combinaciones): cada tramo, con la combinación que da su valor.` : `Combinación ${conjunto.etiquetas[0] ?? conjunto.nombres[0] ?? ""}.`);
  if (magnitud === "N") notas.push("N: la mayor compresión de la base y la cabeza de cada tramo (negativa), la del cuadro de pilares.");
  else notas.push(`ν = Nd/(Ac·fcd), fcd = fck/1,5, en los tramos de hormigón: el aviso de A3 (orden de magnitud), con el límite en ${rotulo(LIMITE_AXIL_REDUCIDO)}. La comprobación de norma es la del módulo de pilares de Concreta.`);
  notas.push(planta === null ? "Todos los tramos de todos los pilares." : `Los tramos que llegan a ${planta} (su cabeza en ella).`);
  if (sinFilas) notas.push(`${sinFilas} pilares sin tramos con resultados.`);
  if (!tramos.length) notas.push("No hay pilares que dibujar.");
  return {
    magnitud,
    unidad: magnitud === "N" ? "kN" : "",
    origen,
    conjunto: { descripcion: conjunto.descripcion, n: conjunto.factores.length },
    segmentos,
    banda,
    colores,
    tramos,
    extremos,
    ...(magnitud === "nu" ? { limite: LIMITE_AXIL_REDUCIDO } : {}),
    leyenda,
    notas,
  };
}
