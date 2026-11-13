/**
 * Machones y dinteles de los muros (C5.3, C3, E5): sus esfuerzos como cortes del motor, definidos a
 * partir del muro físico.
 *
 * - Machón: en cada tramo del muro y cada planta (de la cota de abajo a la de arriba), cada trozo
 *   entre huecos que cruzan esa altura, o entre un hueco y el extremo del tramo. Se corta en
 *   horizontal en su base y en su cabeza, por fuerzas nodales, siempre con las láminas del propio
 *   machón en el lado A: en las cotas de la planta o, junto a un hueco que no llega a ellas, en su
 *   alféizar y en lo alto del hueco, como un «pier» (A2-49, decisión del usuario): allí los machones
 *   son todo el muro, y su suma, la estática; en la cota, el muro sigue por el antepecho o el dintel.
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
import type { CasosEfimeros } from "../motor/casosEfimeros.ts";
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
  /**
   * El corte del motor que se ha calculado (`Cortes`). Con `invertido` (la base de un machón y el
   * inicio de un dintel, para dejar sus láminas en el lado A), su normal va al revés y los esfuerzos
   * son los suyos con Vz y Mz cambiados de signo.
   */
  corte: Corte;
  invertido: boolean;
  /**
   * El nudo de la cota que el corte de un dintel reparte a medias (A2-48) y las láminas del muro
   * que lo tocan: a los esfuerzos del corte se les quita la mitad de lo que ese nudo da
   * a esas láminas. Sin él, el corte tal cual.
   */
  medioNudo?: { nudo: number; laminas: readonly number[] };
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
  /**
   * Cotas de su base y su cabeza, m: las de la planta o, junto a un hueco que no llega a ellas, el
   * alféizar y lo alto del hueco (A2-49).
   */
  z0: number;
  z1: number;
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
  /** Nudos del muro en el tramo: su índice, s (a lo largo del muro), z y su punto en planta. */
  nudos: { n: number; s: number; z: number; p: Vec2 }[];
}

export class EsfuerzosMuros {
  readonly modelo: ModeloAnalitico;
  readonly casos: readonly ResultadoCaso[];
  private readonly ctx: Contexto | null;
  private readonly mapeo: Mapeo;
  private readonly cortes: Cortes;
  private readonly campos: CamposLaminas;
  /** VS4: los casos de los modos, que `campos` y `cortes` sueltan al cambiar de muro. */
  private readonly efimeros: CasosEfimeros | null;

  constructor(fisico: ModeloFisico, compilado: { modelo: ModeloAnalitico; mapeo: Mapeo }, casos: readonly ResultadoCaso[], opciones: OpcionesCompilacion & { campos?: CamposLaminas; cortes?: Cortes; efimeros?: CasosEfimeros } = {}) {
    this.modelo = compilado.modelo;
    this.mapeo = compilado.mapeo;
    this.casos = casos;
    const { campos, cortes, efimeros, ...op } = opciones;
    this.ctx = validar(fisico, resolverOpciones(op), new Diagnosticos());
    this.cortes = cortes ?? new Cortes(this.modelo);
    this.campos = campos ?? new CamposLaminas(this.modelo);
    this.efimeros = efimeros ?? null;
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
        if (Math.abs(-dx * u[1] + dy * u[0]) <= eps && s >= -eps && s <= L + eps) ns.push({ n: v, s: m.s0[i]! + s, z: n.z, p: [n.x, n.y] });
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
  private cortar(c: Corte, invertido = false, cabeza?: { nudo: number; laminas: readonly number[] }): EsfuerzosCorte {
    const corte: Corte = invertido ? { ...c, x: [-c.x[0], -c.x[1], -c.x[2]], y: c.y ? [-c.y[1], -c.y[0]] : c.y } : c;
    const r: ResultadoCorte = this.cortes.cortar(corte, this.casos, this.campos);
    const esfuerzos = Float64Array.from(r.esfuerzos);
    const medio = cabeza && r.valido && corte.metodo !== "campos" ? cabeza : undefined;
    if (medio) this.medioNudo(r, medio, esfuerzos);
    if (invertido) for (let k = 0; k < esfuerzos.length / 6; k++) for (const q of [2, 5]) esfuerzos[6 * k + q] = -esfuerzos[6 * k + q]!;
    return { esfuerzos, origen: c.origen, barras: r.barras.map((i) => this.modelo.barras![i]!.id), valido: r.valido, corte, invertido, ...(medio ? { medioNudo: medio } : {}) };
  }

  /**
   * El centro de un dintel, por campos. Si hay un nudo en la cota en su recta, la recta sigue la malla
   * del muro y el corte por campos es el de fuerzas nodales (cortes.ts): entonces va por fuerzas
   * nodales, con la mitad del nudo de la cota (A2-48); si no sigue la malla, por campos, sin él.
   */
  private centro(c: Corte, cabeza: { nudo: number; laminas: readonly number[] } | undefined): EsfuerzosCorte {
    if (cabeza) {
      const r = this.cortar({ ...c, metodo: "fuerzas-nodales" }, false, cabeza);
      if (r.valido) return r;
    }
    return this.cortar(c);
  }

  /**
   * A2-48: el corte vertical de un dintel acaba por debajo de la cota (sin la losa ni la viga), y la
   * carga vertical que entra en el muro por el nudo de la cota del corte (una carga lineal, la losa,
   * la viga) quedaba entera del otro lado: el cortante de la cara salía corto en q·(ancho de
   * columna)/2 (−25 % con la malla de obra) y el del centro, con carga simétrica, distinto de 0. Ese
   * nudo se reparte a medias en Vz: se le quita la mitad de la componente según el z del corte de lo
   * que el nudo da a las láminas `laminas` (las del muro, de todas sus plantas: lo que baja por el
   * muro no entra de fuera). Sólo Vz: una fuerza vertical en el nudo de la recta del corte no da
   * momento respecto a su origen, y lo horizontal que entra por ese nudo es del diafragma o de la
   * losa, que el dintel no lleva (E5-1).
   */
  private medioNudo(r: ResultadoCorte, cabeza: { nudo: number; laminas: readonly number[] }, esfuerzos: Float64Array): void {
    const e = r.ejes;
    const fn = this.cortes.fuerzas;
    for (const l of cabeza.laminas) {
      const i = this.modelo.laminas![l]!.nudos.indexOf(cabeza.nudo);
      if (i < 0) continue;
      fn.laminaCasos(l, this.casos).forEach((g, k) => {
        esfuerzos[6 * k + 2]! -= 0.5 * (g[6 * i]! * e[6]! + g[6 * i + 1]! * e[7]! + g[6 * i + 2]! * e[8]!);
      });
    }
  }

  /** Machones del muro, por tramo y planta (de arriba abajo); null si el muro no existe. */
  machones(id: string): Machon[] | null {
    const m = this.ctx?.muroDe.get(id);
    if (!m) return null;
    this.efimeros?.trabajarEn(`muro ${id}`);
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
          .map((h) => ({ a: Math.min(h.desde, h.hasta), b: Math.max(h.desde, h.hasta), z0: base + h.z0, z1: base + h.z1 }))
          .sort((x, y) => x.a - y.a);
        // Cada trozo con los huecos que lo bordean (A2-49: su base y su cabeza van en ellos)
        const trozos: { a: number; b: number; junto: (typeof tapan)[number][] }[] = [];
        let desde = t.s0;
        let previo: (typeof tapan)[number] | null = null;
        for (const h of tapan) {
          if (h.a - desde > eps) trozos.push({ a: desde, b: h.a, junto: [...(previo ? [previo] : []), h] });
          if (h.b >= desde) previo = h;
          desde = Math.max(desde, h.b);
        }
        if (t.s0 + t.largo - desde > eps) trozos.push({ a: desde, b: t.s0 + t.largo, junto: previo ? [previo] : [] });
        trozos.forEach(({ a, b, junto }, n) => {
          const [A, B] = [this.ajustar(t, a), this.ajustar(t, b)];
          const centro: Vec2 = [(A.p[0] + B.p[0]) / 2, (A.p[1] + B.p[1]) / 2];
          const mitad = (B.s - A.s) / 2 - Math.min(DELTA_BORDE, (B.s - A.s) / 4);
          const corte = (z: number): Corte => ({ id: `${id}:${plantas[k]!.id}:T${i + 1}:M${n + 1}@${z}`, origen: [centro[0], centro[1], z], x: [0, 0, 1], vz: [-t.u[1], t.u[0], 0], y: [-mitad, mitad], z: [0, 0] });
          // A2-49 (decisión del usuario): junto a un hueco que no llega a la cota, el machón va del
          // alféizar a lo alto del hueco, como un «pier»: es la sección que dimensiona, y allí los
          // machones son todo el muro (en la cota, el muro sigue por el antepecho o el dintel). Con dos
          // huecos, del alféizar más alto a lo alto del hueco más bajo
          const zb = Math.max(abajo, ...junto.map((h) => h.z0));
          const zc = Math.min(arriba, ...junto.map((h) => h.z1));
          const [z0, z1] = [zb > abajo + eps ? this.ajustarZ(t, A.s, zb) : abajo, zc < arriba - eps ? this.ajustarZ(t, A.s, zc) : arriba];
          r.push({ id: `${id}:${plantas[k]!.id}:T${i + 1}:M${n + 1}`, muro: id, tramo: i, planta: plantas[k]!.id, desde: A.s, hasta: B.s, z0, z1, base: this.cortar(corte(z0), true), cabeza: this.cortar(corte(z1)) });
        });
      }
    });
    return r;
  }

  /** Dinteles del muro (uno por hueco con muro encima bajo una cota); null si el muro no existe. */
  dinteles(id: string): Dintel[] | null {
    const m = this.ctx?.muroDe.get(id);
    if (!m) return null;
    this.efimeros?.trabajarEn(`muro ${id}`);
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
      // A2-48: el nudo de la cota en cada corte (si lo hay) y las láminas del muro que lo tocan, también
      // las de la planta de encima: lo que baja por el muro no entra de fuera (en un muro acoplado con
      // carga horizontal, contarlo rompía el cortante constante del dintel)
      const delMuro = this.mapeo.muros?.[id] ?? [];
      const cabeza = (s: number) => {
        const n = t.nudos.find((x) => Math.abs(x.s - s) <= 1e-9 && Math.abs(x.z - z1) <= 1e-9)?.n;
        return n === undefined ? undefined : { nudo: n, laminas: delMuro.filter((l) => this.modelo.laminas![l]!.nudos.includes(n)) };
      };
      r.push({
        id: `${id}:H${nh + 1}`,
        muro: id,
        hueco: nh,
        planta: plantas[k]!.id,
        desde: A.s,
        hasta: B.s,
        z0,
        z1,
        inicio: this.cortar(corte(A.p, "fuerzas-nodales", "inicio"), true, cabeza(A.s)),
        centro: this.centro(corte(C, "campos", "centro"), cabeza((A.s + B.s) / 2)),
        fin: this.cortar(corte(B.p, "fuerzas-nodales", "fin"), false, cabeza(B.s)),
      });
    });
    return r;
  }
}
