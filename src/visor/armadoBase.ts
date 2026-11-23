/**
 * Fase CO6 (`docs/fem3d/comprobaciones.md` §8.20): la armadura base de una losa, barra a barra, para
 * dibujarla en la planta y en el 3D. Es de toda la losa, así que por defecto no se dibuja (va en
 * palabras, en la leyenda): se pide con `base`.
 *
 * - **Reticular:** la base es el montaje de los nervios (n barras por nervio): una línea por cada
 *   nervio paralelo a la armadura, en lo que tiene de zona aligerada (`nerviosLosa`: sin los ábacos,
 *   que llevan su parrilla).
 * - **Maciza:** una barra cada separación, de lado a lado de la losa y recortada con ella; con muchas,
 *   una de cada pocas (el dibujo enseña dónde van, no las cuenta).
 *
 * Las dos caras de una dirección caen en la misma línea (el eje del nervio, la misma separación): la
 * inferior va `DESVIO_BASE` a un lado y la superior al otro, para que se vean las dos. Los refuerzos
 * se dibujan en su sitio, entre ellas.
 *
 * Puro: sin IO.
 */
import { trozosEnLosa } from "../agente/render/armado.ts";
import { nerviosLosa } from "../compilador/abacos.ts";
import type { Losa, Vec2 } from "../compilador/fisico.ts";
import { ARMADURAS_FORJADO, textoBarrasForjado, type ArmadoForjado, type ArmaduraForjado } from "../comprobaciones/armado.ts";
import { ejesArmadura } from "../comprobaciones/dibujoArmado.ts";

/** Lo que se separa de su sitio cada cara de la base, m (como mucho, un cuarto del nervio). */
export const DESVIO_BASE = 0.03;
/** Como mucho, tantas barras de la base por armadura en una maciza (con más, una de cada k). */
export const BARRAS_BASE_MAXIMAS = 80;

export interface BaseDibujada {
  armadura: ArmaduraForjado;
  cara: "inferior" | "superior";
  /** En los nervios de un reticular (una línea por nervio) o a una separación. */
  porNervio: boolean;
  /** «2Ø8 por nervio», «Ø12/200». */
  texto: string;
  /** De cada cuántas barras se dibuja una (1: todas). */
  una: number;
  tramos: [Vec2, Vec2][];
}

type Region = Parameters<typeof trozosEnLosa>[0];

/** La armadura base de una losa, por armaduras: las de la cara pedida («cercos», ninguna). */
export function baseDibujada(l: Losa, a: Pick<ArmadoForjado, "base"> | undefined, region: Region, cara: "inferior" | "superior" | "cercos" | "todas" = "todas"): BaseDibujada[] {
  const r: BaseDibujada[] = [];
  if (!a?.base || cara === "cercos" || l.contorno.length < 3) return r;
  const nervios = l.reticular ? nerviosLosa(l) : [];
  for (const k of ARMADURAS_FORJADO) {
    const b = a.base[k];
    const c = k.endsWith("inf") ? "inferior" : "superior";
    if (!b || !(b.diametro > 0) || (cara !== "todas" && cara !== c)) continue;
    const { d, n } = ejesArmadura(l.eje1, k);
    const tramos: [Vec2, Vec2][] = [];
    let una = 1;
    if (l.reticular) {
      const desvio = (c === "inferior" ? -1 : 1) * Math.min(DESVIO_BASE, l.reticular.nervio / 4);
      for (const [p, q] of nervios) {
        const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
        const L = Math.hypot(dx, dy);
        // Los nervios paralelos a la armadura
        if (!(L > 0) || Math.abs(dx * n[0] + dy * n[1]) > 1e-6 * L) continue;
        tramos.push([[p[0] + desvio * n[0], p[1] + desvio * n[1]], [q[0] + desvio * n[0], q[1] + desvio * n[1]]]);
      }
    } else {
      const desvio = (c === "inferior" ? -1 : 1) * DESVIO_BASE;
      const sep = b.separacion && b.separacion > 0 ? b.separacion / 1000 : 0.2;
      const ss = l.contorno.map((q) => q[0] * d[0] + q[1] * d[1]);
      const ts = l.contorno.map((q) => q[0] * n[0] + q[1] * n[1]);
      const [s0, s1, t0, t1] = [Math.min(...ss), Math.max(...ss), Math.min(...ts), Math.max(...ts)];
      const m = Math.max(1, Math.floor((t1 - t0) / sep + 1e-9));
      una = Math.max(1, Math.ceil(m / BARRAS_BASE_MAXIMAS));
      const primera = (t0 + t1) / 2 - ((m - 1) * sep) / 2;
      const en = (s: number, t: number): Vec2 => [s * d[0] + t * n[0], s * d[1] + t * n[1]];
      for (let i = 0; i < m; i += una) {
        const t = primera + i * sep + desvio;
        for (const tr of trozosEnLosa(region, en(s0, t), en(s1, t))) tramos.push(tr);
      }
    }
    if (tramos.length) r.push({ armadura: k, cara: c, porNervio: !!l.reticular, texto: textoBarrasForjado(b), una, tramos });
  }
  return r;
}
