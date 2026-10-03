/**
 * Geometría del modelo: coordenadas, centro, tamaño característico y tolerancia geométrica.
 */
import type { ModeloAnalitico } from "./modelo.ts";

/**
 * Tolerancia geométrica relativa al tamaño del modelo (con un mínimo de 1 m). Es la de las
 * comprobaciones que, si fallan, romperían el equilibrio a 1e-9: nudos de un diafragma a la
 * misma cota, muelles de longitud nula y láminas planas.
 */
export const TOL_GEOMETRICA = 1e-9;

/** Coordenadas de los nudos [x0, y0, z0, x1, …] y tamaño característico del modelo. */
export interface Geometria {
  xyz: Float64Array;
  /** Centro de la caja envolvente. */
  centro: [number, number, number];
  /** Mitad de la diagonal de la caja envolvente, con un mínimo de 1 m. */
  tamano: number;
}

export function geometria(modelo: ModeloAnalitico): Geometria {
  const n = modelo.nudos.length;
  const xyz = new Float64Array(3 * n);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const v = modelo.nudos[i]!;
    const p = [v.x, v.y, v.z];
    for (let c = 0; c < 3; c++) {
      xyz[3 * i + c] = p[c]!;
      min[c] = Math.min(min[c]!, p[c]!);
      max[c] = Math.max(max[c]!, p[c]!);
    }
  }
  if (n === 0) return { xyz, centro: [0, 0, 0], tamano: 1 };
  const centro: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) centro[c] = (min[c]! + max[c]!) / 2;
  const tamano = Math.max(1, Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) / 2);
  return { xyz, centro, tamano };
}
