/**
 * El 3D alámbrico del modelo físico (I2, `docs/fem3d/interfaz.md` §5.2 y §14): el eje de cada
 * pilar y de cada viga, el contorno de cada losa y de cada paño en su planta, y el de cada muro
 * (sus bordes en cada planta que atraviesa y sus aristas verticales). Cada segmento lleva el objeto
 * físico del que sale, para elegir y resaltar, y su planta, para la planta activa.
 *
 * Sólo necesita el modelo físico, así que se dibuja también si no compila: lo que no se puede
 * situar (una planta que no existe) se salta.
 *
 * Las coordenadas, en Float32 respecto a `origen` (el centro de la caja), Z hacia arriba.
 *
 * Puro: sin IO.
 */
import { cotasPlantas } from "../compilador/cotas.ts";
import type { ModeloFisico, Vec2 } from "../compilador/fisico.ts";

export const TIPOS_ALAMBRICO = ["pilar", "viga", "losa", "pano", "muro"] as const;
export type TipoAlambrico = (typeof TIPOS_ALAMBRICO)[number];

export interface Alambrico {
  origen: [number, number, number];
  /** x, y, z de los dos extremos de cada segmento, respecto al origen. */
  segmentos: Float32Array;
  /** Índice en `objetos` de cada segmento. */
  objeto: Uint32Array;
  /** Índice de la planta de cada segmento (la de la cabeza en un tramo de pilar o de muro). */
  planta: Uint16Array;
  objetos: { id: string; tipo: TipoAlambrico }[];
  plantas: string[];
  /** Caja del modelo, en coordenadas del modelo: [xmin, ymin, zmin, xmax, ymax, zmax]. */
  caja: [number, number, number, number, number, number];
}

const porId = <T extends { id: string }>(xs: readonly T[] | undefined): T[] => [...(xs ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function alambrico(f: ModeloFisico): Alambrico {
  const plantas = (f.plantas ?? []).map((p) => p.id);
  const indice = new Map(plantas.map((p, i) => [p, i]));
  const cotas = cotasPlantas(f.plantas ?? []);
  const seg: number[] = [];
  const obj: number[] = [];
  const pl: number[] = [];
  const objetos: { id: string; tipo: TipoAlambrico }[] = [];
  const caja: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let k = -1;
  const nuevo = (id: string, tipo: TipoAlambrico) => {
    objetos.push({ id, tipo });
    k = objetos.length - 1;
  };
  const poner = (a: readonly [number, number, number], b: readonly [number, number, number], planta: number) => {
    for (const q of [a, b]) {
      for (let i = 0; i < 3; i++) {
        if (q[i]! < caja[i]!) caja[i] = q[i]!;
        if (q[i]! > caja[i + 3]!) caja[i + 3] = q[i]!;
      }
      seg.push(q[0], q[1], q[2]);
    }
    obj.push(k);
    pl.push(planta);
  };
  const anillo = (r: readonly Vec2[], z: number, planta: number) => {
    for (let i = 0; i < r.length; i++) {
      const [a, b] = [r[i]!, r[(i + 1) % r.length]!];
      poner([a[0], a[1], z], [b[0], b[1], z], planta);
    }
  };
  /** Tramos de un vertical (de la planta `desde` a la `hasta`): [z0, z1, planta de la cabeza]. */
  const tramos = (desde: string, hasta: string): [number, number, number][] => {
    const a = indice.get(desde);
    const b = indice.get(hasta);
    if (a === undefined || b === undefined || b >= a) return [];
    const r: [number, number, number][] = [];
    for (let i = a - 1; i >= b; i--) {
      const [z0, z1] = [cotas[i + 1], cotas[i]];
      if (z0 !== null && z0 !== undefined && z1 !== null && z1 !== undefined) r.push([z0, z1, i]);
    }
    return r;
  };

  for (const p of porId(f.pilares)) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    nuevo(p.id, "pilar");
    for (const [z0, z1, i] of tramos(p.desde, p.hasta)) poner([p.x, p.y, z0], [p.x, p.y, z1], i);
  }
  for (const v of porId(f.vigas)) {
    const i = indice.get(v.planta);
    const z = i === undefined ? null : cotas[i];
    if (i === undefined || z === null || z === undefined) continue;
    nuevo(v.id, "viga");
    for (let j = 1; j < v.puntos.length; j++) poner([v.puntos[j - 1]![0], v.puntos[j - 1]![1], z], [v.puntos[j]![0], v.puntos[j]![1], z], i);
  }
  for (const [lista, tipo] of [
    [f.losas, "losa"],
    [f.panos, "pano"],
  ] as const) {
    for (const l of porId<{ id: string; planta: string; contorno: readonly Vec2[]; huecos?: readonly (readonly Vec2[])[] }>(lista)) {
      const i = indice.get(l.planta);
      const z = i === undefined ? null : cotas[i];
      if (i === undefined || z === null || z === undefined) continue;
      nuevo(l.id, tipo);
      anillo(l.contorno, z, i);
      for (const h of l.huecos ?? []) anillo(h, z, i);
    }
  }
  for (const m of porId(f.muros)) {
    const t = tramos(m.desde, m.hasta);
    if (!t.length) continue;
    nuevo(m.id, "muro");
    const zb = t[0]![0];
    // Sus bordes en la base y en cada planta, y sus aristas verticales tramo a tramo
    for (let j = 1; j < m.puntos.length; j++) {
      const [a, b] = [m.puntos[j - 1]!, m.puntos[j]!];
      poner([a[0], a[1], zb], [b[0], b[1], zb], t[0]![2]);
      for (const [, z1, i] of t) poner([a[0], a[1], z1], [b[0], b[1], z1], i);
    }
    for (const q of m.puntos) for (const [z0, z1, i] of t) poner([q[0], q[1], z0], [q[0], q[1], z1], i);
  }

  const vacio = !Number.isFinite(caja[0]);
  const c: Alambrico["caja"] = vacio ? [0, 0, 0, 1, 1, 1] : caja;
  const origen: [number, number, number] = [(c[0] + c[3]) / 2, (c[1] + c[4]) / 2, (c[2] + c[5]) / 2];
  const segmentos = new Float32Array(seg.length);
  for (let i = 0; i < seg.length; i++) segmentos[i] = seg[i]! - origen[i % 3]!;
  return { origen, segmentos, objeto: Uint32Array.from(obj), planta: Uint16Array.from(pl), objetos, plantas, caja: c };
}
