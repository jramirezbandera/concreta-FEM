/**
 * Machones y dinteles de los muros (C5.3, C3, E5): sus esfuerzos como cortes del motor, definidos a
 * partir del muro físico.
 *
 * - Machón: en cada tramo del muro y cada planta (de la cota de abajo a la de arriba), cada trozo
 *   entre huecos que cruzan esa altura, o entre un hueco y el extremo del tramo. Se corta en
 *   horizontal en su base y en su cabeza (las filas de la malla en las cotas), por fuerzas nodales,
 *   siempre con las láminas del propio machón en el lado A. En la cabeza, junto a un dintel, es la
 *   suma de las fuerzas nodales de las láminas del machón (como el «pier» de ETABS): lo que el
 *   dintel transmite va por su cara.
 *   Ejes como un pilar: x hacia arriba, y a lo largo del tramo (del primer punto al segundo) y z su
 *   normal (y × z = x). N > 0 es tracción; Vy, el cortante en su plano; Mz, el momento en su plano;
 *   My y Vz, los de fuera de su plano. Los extremos del corte quedan DELTA_BORDE dentro del machón:
 *   un pilar unido al extremo del muro va aparte, con su barra (C5-e); uno dentro del machón entra
 *   y aparece en `barras`.
 * - Dintel: el trozo de muro sobre un hueco y bajo la cota de encima. Se corta en vertical en sus
 *   extremos (las caras del hueco, por fuerzas nodales) y en su centro (por campos). Ejes como una
 *   viga: x a lo largo del tramo, z hacia arriba e y = z × x. Vz es el cortante y My el momento de
 *   su plano. El corte queda DELTA_BORDE por debajo de la cota, sin la losa ni la viga de esa cota;
 *   con diafragma rígido, N, Vy y Mz no se pueden atribuir y quedan en NaN (E5-1).
 *
 * Las posiciones se ajustan a los nudos reales de la malla del muro (el compilador mueve sus
 * vértices y los bordes de sus huecos hasta ε_snap para unirlos a lo cercano, C3-b).
 */
import { CamposLaminas } from "../motor/campos.ts";
import { Cortes, type Corte, type ResultadoCorte } from "../motor/cortes.ts";
import { Diagnosticos } from "../motor/diagnosticos.ts";
import type { ModeloAnalitico, ResultadoCaso, Vec3 } from "../motor/modelo.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion, type Vec2 } from "./fisico.ts";
import type { Mapeo } from "./mapeo.ts";
import { validar, type Contexto, type MuroCompilado } from "./validar.ts";

/** Distancia a la que el corte de un machón o un dintel queda dentro de sus bordes, m. */
export const DELTA_BORDE = 1e-3;

export interface EsfuerzosCorte {
  /** [N, Vy, Vz, T, My, Mz] por caso (6·nc), en los ejes del machón o del dintel. kN y kN·m. */
  esfuerzos: Float64Array;
  /** Punto de reducción (global). */
  origen: Vec3;
  /** Barras que atraviesan el corte. */
  barras: string[];
  valido: boolean;
}

export interface Machon {
  id: string;
  muro: string;
  /** Tramo del muro (0, 1, …) y planta de su cabeza. */
  tramo: number;
  planta: string;
  /** Estaciones de sus bordes a lo largo del eje del muro (desde su primer punto), m. */
  desde: number;
  hasta: number;
  base: EsfuerzosCorte;
  cabeza: EsfuerzosCorte;
}

export interface Dintel {
  id: string;
  muro: string;
  /** Hueco (0, 1, …) bajo el dintel y planta de la cota de encima. */
  hueco: number;
  planta: string;
  desde: number;
  hasta: number;
  /** Cotas de su borde inferior (lo alto del hueco) y de la planta. */
  z0: number;
  z1: number;
  inicio: EsfuerzosCorte;
  centro: EsfuerzosCorte;
  fin: EsfuerzosCorte;
}

interface Tramo {
  A: Vec2;
  u: Vec2;
  s0: number;
  largo: number;
  /** Nudos del muro en el tramo: s (a lo largo del muro), z y su punto en planta. */
  nudos: { s: number; z: number; p: Vec2 }[];
}

export class EsfuerzosMuros {
  readonly modelo: ModeloAnalitico;
  readonly casos: readonly ResultadoCaso[];
  private readonly ctx: Contexto | null;
  private readonly mapeo: Mapeo;
  private readonly cortes: Cortes;
  private readonly campos: CamposLaminas;

  constructor(fisico: ModeloFisico, compilado: { modelo: ModeloAnalitico; mapeo: Mapeo }, casos: readonly ResultadoCaso[], opciones: OpcionesCompilacion & { campos?: CamposLaminas } = {}) {
    this.modelo = compilado.modelo;
    this.mapeo = compilado.mapeo;
    this.casos = casos;
    this.ctx = validar(fisico, resolverOpciones(opciones), new Diagnosticos());
    this.cortes = new Cortes(this.modelo);
    this.campos = opciones.campos ?? new CamposLaminas(this.modelo);
  }

  /** Tramos del muro con sus nudos reales. */
  private tramos(m: MuroCompilado): Tramo[] {
    const eps = this.ctx!.op.epsSnap;
    const nudos = new Set((this.mapeo.muros?.[m.muro.id] ?? []).flatMap((l) => [...this.modelo.laminas![l]!.nudos]));
    return m.largo.map((largo, i) => {
      const A = m.muro.puntos[i]!;
      const B = m.muro.puntos[i + 1]!;
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const u: Vec2 = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
      const ns: Tramo["nudos"] = [];
      for (const v of nudos) {
        const n = this.modelo.nudos[v]!;
        const [dx, dy] = [n.x - A[0], n.y - A[1]];
        const s = dx * u[0] + dy * u[1];
        if (Math.abs(-dx * u[1] + dy * u[0]) <= eps && s >= -eps && s <= L + eps) ns.push({ s: m.s0[i]! + s, z: n.z, p: [n.x, n.y] });
      }
      return { A, u, s0: m.s0[i]!, largo, nudos: ns };
    });
  }

  /** La estación de la malla más cercana a s (a ≤ ε_snap), con su punto en planta. */
  private ajustar(t: Tramo, s: number): { s: number; p: Vec2 } {
    let mejor: { s: number; p: Vec2 } | null = null;
    for (const n of t.nudos) if (Math.abs(n.s - s) <= this.ctx!.op.epsSnap && (!mejor || Math.abs(n.s - s) < Math.abs(mejor.s - s))) mejor = { s: n.s, p: n.p };
    return mejor ?? { s, p: [t.A[0] + (s - t.s0) * t.u[0], t.A[1] + (s - t.s0) * t.u[1]] };
  }

  /** La cota de la malla más cercana a z en la estación s del tramo. */
  private ajustarZ(t: Tramo, s: number, z: number): number {
    let mejor: number | null = null;
    for (const n of t.nudos) if (Math.abs(n.s - s) <= 1e-9 && Math.abs(n.z - z) <= this.ctx!.op.epsSnap && (mejor === null || Math.abs(n.z - z) < Math.abs(mejor - z))) mejor = n.z;
    return mejor ?? z;
  }

  /**
   * Corte con la normal `x` (o con la contraria, si `invertido`: para que su lado A sea el machón o el
   * dintel, cuyas láminas caen enteras en el rectángulo, y la fuerza nodal de cada nudo del corte esté
   * completa). Con la normal invertida y el mismo z, el resultado se pasa al convenio de `x`:
   * [N, Vy, −Vz, T, My, −Mz].
   */
  private cortar(c: Corte, invertido = false): EsfuerzosCorte {
    const corte: Corte = invertido ? { ...c, x: [-c.x[0], -c.x[1], -c.x[2]], y: c.y ? [-c.y[1], -c.y[0]] : c.y } : c;
    const r: ResultadoCorte = this.cortes.cortar(corte, this.casos, this.campos);
    const esfuerzos = Float64Array.from(r.esfuerzos);
    if (invertido) for (let k = 0; k < esfuerzos.length / 6; k++) for (const q of [2, 5]) esfuerzos[6 * k + q] = -esfuerzos[6 * k + q]!;
    return { esfuerzos, origen: c.origen, barras: r.barras.map((i) => this.modelo.barras![i]!.id), valido: r.valido };
  }

  /** Machones del muro, por tramo y planta (de arriba abajo); null si el muro no existe. */
  machones(id: string): Machon[] | null {
    const m = this.ctx?.muroDe.get(id);
    if (!m) return null;
    const { cotas, plantas, op } = this.ctx!;
    const eps = op.epsGeom;
    const base = cotas[m.kb]!;
    const r: Machon[] = [];
    this.tramos(m).forEach((t, i) => {
      for (let k = m.kh; k < m.kb; k++) {
        const [arriba, abajo] = [cotas[k]!, cotas[k + 1]!];
        // Huecos del tramo que cruzan la altura de la planta
        const tapan = m.huecos
          .filter((h) => h.tramo === i && base + h.z0 < arriba - eps && base + h.z1 > abajo + eps)
          .map((h) => [Math.min(h.desde, h.hasta), Math.max(h.desde, h.hasta)] as const)
          .sort((a, b) => a[0] - b[0]);
        const trozos: [number, number][] = [];
        let desde = t.s0;
        for (const [a, b] of tapan) {
          if (a - desde > eps) trozos.push([desde, a]);
          desde = Math.max(desde, b);
        }
        if (t.s0 + t.largo - desde > eps) trozos.push([desde, t.s0 + t.largo]);
        trozos.forEach(([a, b], n) => {
          const [A, B] = [this.ajustar(t, a), this.ajustar(t, b)];
          const centro: Vec2 = [(A.p[0] + B.p[0]) / 2, (A.p[1] + B.p[1]) / 2];
          const mitad = (B.s - A.s) / 2 - Math.min(DELTA_BORDE, (B.s - A.s) / 4);
          const corte = (z: number): Corte => ({ id: `${id}:${plantas[k]!.id}:T${i + 1}:M${n + 1}@${z}`, origen: [centro[0], centro[1], z], x: [0, 0, 1], vz: [-t.u[1], t.u[0], 0], y: [-mitad, mitad], z: [0, 0] });
          r.push({ id: `${id}:${plantas[k]!.id}:T${i + 1}:M${n + 1}`, muro: id, tramo: i, planta: plantas[k]!.id, desde: A.s, hasta: B.s, base: this.cortar(corte(abajo), true), cabeza: this.cortar(corte(arriba)) });
        });
      }
    });
    return r;
  }

  /** Dinteles del muro (uno por hueco con muro encima bajo una cota); null si el muro no existe. */
  dinteles(id: string): Dintel[] | null {
    const m = this.ctx?.muroDe.get(id);
    if (!m) return null;
    const { cotas, plantas, op } = this.ctx!;
    const eps = op.epsGeom;
    const base = cotas[m.kb]!;
    const tramos = this.tramos(m);
    const r: Dintel[] = [];
    m.huecos.forEach((h, nh) => {
      const t = tramos[h.tramo]!;
      let k = -1;
      for (let j = m.kh; j < m.kb; j++) if (cotas[j]! > base + h.z1 + eps && (k < 0 || cotas[j]! < cotas[k]!)) k = j;
      if (k < 0) return;
      const [A, B] = [this.ajustar(t, Math.min(h.desde, h.hasta)), this.ajustar(t, Math.max(h.desde, h.hasta))];
      const z1 = cotas[k]!;
      const z0 = this.ajustarZ(t, A.s, base + h.z1);
      if (!(z1 - z0 > eps)) return;
      const zc = (z0 + z1) / 2;
      const mitad = (z1 - z0) / 2 - Math.min(DELTA_BORDE, (z1 - z0) / 4);
      const corte = (P: Vec2, metodo: Corte["metodo"], cual: string): Corte => ({ id: `${id}:H${nh + 1}:${cual}`, origen: [P[0], P[1], zc], x: [t.u[0], t.u[1], 0], vz: [0, 0, 1], y: [0, 0], z: [-mitad, mitad], metodo });
      const C: Vec2 = [(A.p[0] + B.p[0]) / 2, (A.p[1] + B.p[1]) / 2];
      r.push({
        id: `${id}:H${nh + 1}`,
        muro: id,
        hueco: nh,
        planta: plantas[k]!.id,
        desde: A.s,
        hasta: B.s,
        z0,
        z1,
        inicio: this.cortar(corte(A.p, "fuerzas-nodales", "inicio"), true),
        centro: this.cortar(corte(C, "campos", "centro")),
        fin: this.cortar(corte(B.p, "fuerzas-nodales", "fin")),
      });
    });
    return r;
  }
}
