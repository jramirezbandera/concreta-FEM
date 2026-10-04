/**
 * Mapeo físico ↔ analítico (§8.1 del diseño): forma parte del artefacto de cálculo y nunca se
 * reconstruye por proximidad. Va en listas paralelas a las del modelo analítico y en registros
 * por objeto físico, todo serializable (sin `Map`).
 */
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { ModeloAnalitico } from "../motor/modelo.ts";

export interface NudoMapeado {
  /** Objetos físicos que lo originan (pilares, vigas, losas, apoyos); vacío en un maestro de diafragma. */
  fisicos: string[];
  planta: string;
  /** Nudo maestro (auxiliar, sin pieza) del diafragma de su planta. */
  maestro?: true;
}

export interface BarraMapeada {
  pieza: string;
  tipo: "viga" | "pilar";
  /** Tramo de la polilínea de la viga, o índice de la planta de la cabeza del tramo de pilar. */
  tramo: number;
  /**
   * Estaciones a lo largo de la pieza (m, desde el primer punto de la viga o la base del pilar)
   * de [i, i', j', j]: los nudos (proyectados sobre el eje) y los extremos del tramo flexible.
   */
  s: readonly [number, number, number, number];
}

export interface Mapeo {
  nudos: NudoMapeado[];
  barras: BarraMapeada[];
  /** Planta de cada restricción; las huellas (C2-d), además, su pilar. */
  restricciones: { planta: string; pilar?: string }[];
  /** C2: losa de cada lámina, en paralelo a `modelo.laminas` (sólo si hay losas). */
  laminas?: { losa: string }[];
  /** C2: láminas de cada losa, en orden canónico (sólo si hay losas). */
  losas?: Record<string, number[]>;
  /** Barras de cada pieza física, en orden a lo largo de ella. */
  piezas: Record<string, number[]>;
  /** Nudo del eje de cada pilar en cada planta: clave `${pilar}@${planta}`. */
  nudosPilar: Record<string, number>;
  /** Nudo de cada apoyo físico. */
  apoyos: Record<string, number>;
}

/** Objetos físicos de cada id analítico (nudos, barras, restricciones y casos). */
export function fisicosDeIds(modelo: ModeloAnalitico, mapeo: Mapeo): Map<string, string[]> {
  const m = new Map<string, string[]>();
  modelo.nudos.forEach((n, i) => m.set(n.id, mapeo.nudos[i]!.maestro ? [mapeo.nudos[i]!.planta] : mapeo.nudos[i]!.fisicos));
  (modelo.barras ?? []).forEach((b, i) => m.set(b.id, [mapeo.barras[i]!.pieza]));
  (modelo.laminas ?? []).forEach((l, i) => m.set(l.id, [mapeo.laminas![i]!.losa]));
  (modelo.restricciones ?? []).forEach((r, i) => m.set(r.id, [mapeo.restricciones[i]!.pilar ?? mapeo.restricciones[i]!.planta]));
  for (const c of modelo.casos) m.set(c.id, [c.id]);
  return m;
}

/**
 * Traduce los diagnósticos del motor a objetos físicos: `ids` pasa a ser la lista de ids físicos
 * y los analíticos quedan en `detalles.analiticos`. El mensaje no cambia (nombra los objetos
 * analíticos, cuyos ids ya dicen la pieza y la planta).
 */
export function traducirDiagnosticos(diagnosticos: readonly Diagnostico[], modelo: ModeloAnalitico, mapeo: Mapeo): Diagnostico[] {
  const m = fisicosDeIds(modelo, mapeo);
  return diagnosticos.map((d) => {
    if (!d.ids?.length) return d;
    const fisicos = [...new Set(d.ids.flatMap((id) => m.get(id) ?? [id]))];
    return { ...d, ids: fisicos, detalles: { ...d.detalles, analiticos: d.ids } };
  });
}
