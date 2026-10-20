/**
 * Resultados por pieza física: los diagramas del motor (`DiagramasBarras`) recorridos por
 * estaciones de la pieza con el mapeo, nunca por proximidad (§8.1).
 *
 * Los pares de la losa en las vigas (`docs/fem3d/diagramas-vigas.md`): en cada nudo interior de una
 * viga o una vigueta, las láminas le pasan (directamente o por el enlace de los nudos de sus caras)
 * un par concentrado, que es su momento torsor a lo largo de la viga repartido en los nudos. En el
 * diagrama de la barra sale como un salto de T y My en cada nudo: dientes de sierra que dependen de
 * la malla (el M⁻ de la cara, del lado del salto que se lea). Por defecto, la parte del salto que
 * viene de las láminas se reparte a medias entre los dos medios tramos vecinos como un par uniforme
 * (`DiagramaBarra.conPares`): el diagrama sale continuo, el cortante no cambia y en cada barra se
 * cumple el equilibrio con su par repartido. Lo demás (una carga nodal o una puntual de la barra en
 * el nudo) se queda como salto. Mz no se toca: en él actúa también el diafragma. Con
 * `suavizado: false`, los diagramas del motor tal cual.
 */
import { DiagramasBarras } from "../motor/barras.ts";
import type { DiagramaBarra } from "../elementos/cargasBarra.ts";
import { FuerzasNodales } from "../motor/fuerzasNodales.ts";
import type { ModeloAnalitico, ResultadoCaso } from "../motor/modelo.ts";
import type { Mapeo } from "./mapeo.ts";

export interface TramoFlexible {
  barra: number;
  /** Estaciones de los extremos del tramo flexible (i', j') en la pieza. */
  s0: number;
  s1: number;
  /** Tramo de la polilínea (vigas) o planta de la cabeza (pilares). */
  tramo: number;
}

export class EsfuerzosPiezas {
  /** Los diagramas de las barras del modelo (también los usan los cortes de las bandas, `Consultas.cortes`). */
  readonly diagramas: DiagramasBarras;
  private readonly cache = new Map<string, DiagramaBarra>();
  private readonly crudos = new Map<string, DiagramaBarra>();
  readonly modelo: ModeloAnalitico;
  readonly mapeo: Mapeo;
  readonly casos: readonly ResultadoCaso[];

  /** Reparte los pares de la losa en vigas y viguetas (por defecto, sí). */
  readonly suavizado: boolean;
  private fuerzasC: FuerzasNodales | null = null;
  /** Por barra: la parte de la losa de los saltos de [T, My] en sus nudos i y j, por caso. */
  private readonly saltos = new Map<number, Float64Array[] | null>();
  private readonly gLaminas = new Map<number, Float64Array[]>();
  private preparado = false;
  private laminasNudo: { ptr: Uint32Array; idx: Uint32Array } = { ptr: new Uint32Array(1), idx: new Uint32Array(0) };
  private esclavosDe = new Map<number, number[]>();
  private esEsclavo = new Uint8Array(0);
  /** Barras, apoyos y muelles de cada nudo (lo que, además de las láminas y las cargas, le puede llegar). */
  private barrasNudo = new Uint16Array(0);
  private sujeto = new Uint8Array(0);
  /** Cargas nodales de cada caso, por nudo. */
  private nodales: Map<number, Float64Array>[] = [];

  /** `casos`: los de un cálculo válido del `modelo`, en su orden. */
  constructor(modelo: ModeloAnalitico, mapeo: Mapeo, casos: readonly ResultadoCaso[], opciones: { suavizado?: boolean } = {}) {
    this.modelo = modelo;
    this.mapeo = mapeo;
    this.casos = casos;
    this.diagramas = new DiagramasBarras(modelo);
    this.suavizado = opciones.suavizado ?? true;
  }

  /** Tramos flexibles de una pieza, en orden. */
  tramos(pieza: string): TramoFlexible[] {
    return (this.mapeo.piezas[pieza] ?? []).map((b) => {
      const m = this.mapeo.barras[b]!;
      return { barra: b, s0: m.s[1], s1: m.s[2], tramo: m.tramo };
    });
  }

  /** Diagrama de la barra `b` en el caso `k` (con los pares de la losa repartidos si `suavizado`). */
  diagrama(b: number, k: number): DiagramaBarra {
    const clave = `${b}/${k}`;
    let d = this.cache.get(clave);
    if (!d) {
      d = this.crudo(b, k);
      const j = this.suavizado ? this.saltosLosa(b)?.[k] : undefined;
      // −J_i/2·(1 − x/L) + J_j/2·x/L: la mitad de cada salto a cada lado de su nudo
      if (j && j.some((v) => v !== 0)) d = d.conPares([-j[0]! / 2, -j[1]! / 2, 0], [(j[0]! + j[2]!) / (2 * d.L), (j[1]! + j[3]!) / (2 * d.L), 0]);
      this.cache.set(clave, d);
    }
    return d;
  }

  /** El diagrama del motor, sin repartir nada. */
  private crudo(b: number, k: number): DiagramaBarra {
    const clave = `${b}/${k}`;
    let d = this.crudos.get(clave);
    if (!d) this.crudos.set(clave, (d = this.diagramas.diagrama(b, k, this.casos[k]!)));
    return d;
  }

  /**
   * La parte de las láminas de los saltos de [T, My] en los nudos i y j de la barra `b`, por caso
   * ([T_i, My_i, T_j, My_j], en sus ejes locales; el salto es lo de la derecha menos lo de la
   * izquierda al recorrer la pieza). Sólo en los nudos interiores de una viga o una vigueta: el
   * extremo común de dos tramos flexibles seguidos del mismo tramo de la polilínea, con los mismos
   * ejes, y que no es esclavo de un enlace. null si la barra no tiene ninguno.
   *
   * Con `laminas`, siempre por las fuerzas de las láminas (`saltoLaminas`); si no, en un nudo al que
   * sólo llegan sus dos barras, láminas y cargas, es el salto entre las fuerzas de extremo de las dos
   * barras menos el de las cargas nodales: lo mismo, sin la rigidez de las láminas.
   */
  saltosLosa(b: number, laminas = false): Float64Array[] | null {
    if (!laminas && this.saltos.has(b)) return this.saltos.get(b)!;
    let r: Float64Array[] | null = null;
    const m = this.mapeo.barras[b]!;
    if ((m.tipo === "viga" || m.tipo === "vigueta") && this.modelo.laminas?.length) {
      this.preparar();
      const ts = this.tramos(m.pieza);
      const k = ts.findIndex((t) => t.barra === b);
      const t = ts[k]!;
      const nudos = (x: number) => this.modelo.barras![x]!.nudos;
      const [i, j] = nudos(b);
      const a = ts[k - 1];
      const c = ts[k + 1];
      const interior = (n: number) => !this.esEsclavo[n] && this.colgados(n).some((v) => this.laminasNudo.ptr[v + 1]! > this.laminasNudo.ptr[v]!);
      const enI = a && a.tramo === t.tramo && Math.abs(a.s1 - t.s0) <= 1e-9 && nudos(a.barra)[1] === i && this.mismosEjes(a.barra, b) && interior(i) ? a.barra : null;
      const enJ = c && c.tramo === t.tramo && Math.abs(t.s1 - c.s0) <= 1e-9 && nudos(c.barra)[0] === j && this.mismosEjes(c.barra, b) && interior(j) ? c.barra : null;
      if (enI !== null || enJ !== null) {
        const JI = enI !== null ? this.saltoNudo(enI, b, i, laminas) : null;
        const JJ = enJ !== null ? this.saltoNudo(b, enJ, j, laminas) : null;
        r = this.casos.map((_, q) => Float64Array.of(JI?.[q]![0] ?? 0, JI?.[q]![1] ?? 0, JJ?.[q]![0] ?? 0, JJ?.[q]![1] ?? 0));
      }
    }
    if (!laminas) this.saltos.set(b, r);
    return r;
  }

  /** La parte de la losa del salto de [T, My] en el nudo n, entre la barra `a` (que acaba en n) y la `b` (que empieza), por caso. */
  private saltoNudo(a: number, b: number, n: number, laminas: boolean): [number, number][] {
    const R = this.diagramas.barra(b).R;
    // Equilibrio del nudo con las fuerzas de extremo de las dos barras (`fuerzasDeExtremo`): un par C
    // sobre el nudo (en los ejes de la barra) da un salto de T de −Cx y de My de Cy
    const salto = (C: ArrayLike<number>): [number, number] => [-(R[0]! * C[0]! + R[1]! * C[1]! + R[2]! * C[2]!), R[3]! * C[0]! + R[4]! * C[1]! + R[5]! * C[2]!];
    if (laminas || !this.limpio(n, a, b)) {
      const P = this.paresLaminas(n);
      return P.map((C) => salto(C));
    }
    return this.casos.map((_, q) => {
      // Entre las fuerzas de extremo: en L por la derecha y en 0 por la izquierda (con las puntuales de las barras en el nudo)
      const [ea, eb] = [this.crudo(a, q), this.crudo(b, q)];
      const [fa, fb] = [ea.esfuerzosEn(ea.L, 1), eb.esfuerzosEn(0, -1)];
      const [T, M] = salto(this.parCargas(n, q));
      return [fb[3]! - fa[3]! - T, fb[4]! - fa[4]! - M];
    });
  }

  /** Al nudo y a lo que cuelga de él sólo llegan sus dos barras, láminas y cargas (ni otras barras, ni apoyos, ni muelles). */
  private limpio(n: number, a: number, b: number): boolean {
    for (const v of this.colgados(n)) {
      if (this.sujeto[v]) return false;
      let propias = 0;
      for (const x of [a, b]) for (const w of this.modelo.barras![x]!.nudos) if (w === v) propias++;
      if (this.barrasNudo[v]! > propias) return false;
    }
    return true;
  }

  /** El nudo y los que cuelgan de él por enlaces rígidos (las caras de la viga, LV). */
  private colgados(n: number): number[] {
    const r = [n];
    for (let k = 0; k < r.length; k++) for (const e of this.esclavosDe.get(r[k]!) ?? []) if (!r.includes(e)) r.push(e);
    return r;
  }

  /** Par de las cargas nodales del caso q sobre el nudo n y lo que cuelga de él, trasladado a n (global). */
  private parCargas(n: number, q: number): number[] {
    const P = this.modelo.nudos[n]!;
    const C = [0, 0, 0];
    for (const v of this.colgados(n)) {
      const f = this.nodales[q]!.get(v);
      if (!f) continue;
      const Q = this.modelo.nudos[v]!;
      const [dx, dy, dz] = [Q.x - P.x, Q.y - P.y, Q.z - P.z];
      C[0]! += f[3]! + dy * f[2]! - dz * f[1]!;
      C[1]! += f[4]! + dz * f[0]! - dx * f[2]!;
      C[2]! += f[5]! + dx * f[1]! - dy * f[0]!;
    }
    return C;
  }

  /** Las dos barras tienen los mismos ejes locales: el salto se lee igual en las dos. */
  private mismosEjes(a: number, b: number): boolean {
    const [Ra, Rb] = [this.diagramas.barra(a).R, this.diagramas.barra(b).R];
    for (let f = 0; f < 3; f++) if (Ra[3 * f]! * Rb[3 * f]! + Ra[3 * f + 1]! * Rb[3 * f + 1]! + Ra[3 * f + 2]! * Rb[3 * f + 2]! < 1 - 1e-9) return false;
    return true;
  }

  /**
   * Par (global) que las láminas ejercen sobre el nudo `n`, por caso: el de las que lo tocan y el de
   * las de los nudos que cuelgan de él, trasladado a `n` (M + d × F, con −g lo que la lámina ejerce
   * sobre el nudo).
   */
  private paresLaminas(n: number): Float64Array[] {
    const fuerzas = (this.fuerzasC ??= new FuerzasNodales(this.modelo));
    const nudos = new Set(this.colgados(n));
    const { ptr, idx } = this.laminasNudo;
    const laminas = new Set<number>();
    for (const v of nudos) for (let p = ptr[v]!; p < ptr[v + 1]!; p++) laminas.add(idx[p]!);
    const P = this.modelo.nudos[n]!;
    const r = this.casos.map(() => new Float64Array(3));
    for (const l of [...laminas].sort((x, y) => x - y)) {
      let g = this.gLaminas.get(l);
      if (!g) this.gLaminas.set(l, (g = fuerzas.laminaCasos(l, this.casos)));
      this.modelo.laminas![l]!.nudos.forEach((v, a) => {
        if (!nudos.has(v)) return;
        const Q = this.modelo.nudos[v]!;
        const [dx, dy, dz] = [Q.x - P.x, Q.y - P.y, Q.z - P.z];
        g!.forEach((ge, q) => {
          const [Fx, Fy, Fz] = [-ge[6 * a]!, -ge[6 * a + 1]!, -ge[6 * a + 2]!];
          const C = r[q]!;
          C[0]! += -ge[6 * a + 3]! + dy * Fz - dz * Fy;
          C[1]! += -ge[6 * a + 4]! + dz * Fx - dx * Fz;
          C[2]! += -ge[6 * a + 5]! + dx * Fy - dy * Fx;
        });
      });
    }
    return r;
  }

  /** Las láminas de cada nudo (CSR), los enlaces rígidos, lo que llega a cada nudo y las cargas nodales. */
  private preparar(): void {
    if (this.preparado) return;
    this.preparado = true;
    const nn = this.modelo.nudos.length;
    const ls = this.modelo.laminas ?? [];
    const ptr = new Uint32Array(nn + 1);
    for (const l of ls) for (const v of l.nudos) ptr[v + 1]!++;
    for (let v = 0; v < nn; v++) ptr[v + 1]! += ptr[v]!;
    const idx = new Uint32Array(ptr[nn]!);
    const pos = ptr.slice(0, nn);
    ls.forEach((l, k) => {
      for (const v of l.nudos) idx[pos[v]!++] = k;
    });
    this.laminasNudo = { ptr, idx };
    this.esEsclavo = new Uint8Array(nn);
    for (const x of this.modelo.restricciones ?? [])
      if (x.tipo === "enlace-rigido") {
        this.esclavosDe.set(x.maestro, [...(this.esclavosDe.get(x.maestro) ?? []), ...x.esclavos]);
        for (const e of x.esclavos) this.esEsclavo[e] = 1;
      }
    this.barrasNudo = new Uint16Array(nn);
    for (const b of this.modelo.barras ?? []) for (const v of b.nudos) this.barrasNudo[v]!++;
    this.sujeto = new Uint8Array(nn);
    for (const a of this.modelo.apoyos ?? []) this.sujeto[a.nudo] = 1;
    for (const m of this.modelo.muelles ?? []) for (const v of m.nudos) this.sujeto[v] = 1;
    this.nodales = this.modelo.casos.map((caso) => {
      const m = new Map<number, Float64Array>();
      for (const cn of caso.nodales ?? []) {
        let f = m.get(cn.nudo);
        if (!f) m.set(cn.nudo, (f = new Float64Array(6)));
        for (let g = 0; g < 6; g++) f[g]! += cn.f[g]!;
      }
      return m;
    });
  }

  /**
   * Esfuerzos [N, Vy, Vz, T, My, Mz] en la estación `s` de la pieza, en el caso `k`, en los ejes
   * locales de su tramo. En el extremo común de dos tramos flexibles, `lado` elige el de la
   * izquierda (−1) o el de la derecha (+1). null si `s` cae en una zona rígida o fuera de la pieza.
   */
  en(pieza: string, k: number, s: number, lado: -1 | 1 = 1, tol = 1e-9): number[] | null {
    const ts = this.tramos(pieza).filter((t) => s >= t.s0 - tol && s <= t.s1 + tol);
    if (!ts.length) return null;
    const t = lado < 0 ? ts[0]! : ts[ts.length - 1]!;
    const x = Math.min(t.s1 - t.s0, Math.max(0, s - t.s0));
    return this.diagrama(t.barra, k).esfuerzosEn(x, lado);
  }
}
