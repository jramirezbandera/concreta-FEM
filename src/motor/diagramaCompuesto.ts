/**
 * El diagrama de una barra en una combinación con casos espectrales (fase VS3, `espectral.ts`).
 *
 * El de una combinación de casos estáticos es un polinomio por tramos (`DiagramaBarra.combinar`). El
 * de un caso espectral no: en cada punto, cada esfuerzo es la combinación de los de los modos en ese
 * punto, con el signo del modo dominante allí. `DiagramaCompuesto` se lee igual (`esfuerzosEn`,
 * `desplazamientosEn`, `estaciones`), con la parte estática como siempre y la espectral combinada en
 * cada punto y cada componente.
 *
 * Lo de un caso espectral en una barra (`EspectralBarra`) no depende de la combinación, sólo de su
 * factor: sus esfuerzos en cada punto se calculan una vez y se guardan, y todas las combinaciones de
 * la situación sísmica (el ± y el 30 % de cada caso) los comparten.
 *
 * Los modos no llevan cargas en las barras: sus esfuerzos son lineales en la barra (el axil, los
 * cortantes y el torsor, constantes), y se interpolan entre sus dos extremos. Si alguno no lo fuera,
 * se evalúa su diagrama.
 *
 * **Las estaciones.** Las de la parte estática (extremos, cuartos, puntos de carga y extremos
 * interiores de sus My y Mz) no bastan: el sismo desplaza el máximo del vano (con G + E, el momento
 * positivo mayor no está donde se anula el cortante de G). Se añaden los décimos de la barra, los
 * puntos donde el modo dominante cambia de signo en My y en Mz (allí el caso espectral salta de un
 * signo al otro) y, alrededor del mayor y del menor My y Mz de esas muestras, el vértice de la
 * parábola por la muestra y sus dos vecinas. El máximo que se lee es un valor del diagrama, no una
 * extrapolación; lo que le puede faltar al de verdad es de cuarto orden en el paso (L/10).
 */
import type { DiagramaBarra } from "../elementos/cargasBarra.ts";
import { valorEspectral, type CasoEspectral } from "./espectral.ts";

/** Lo que se lee de un diagrama, sea de una combinación lineal o de una con casos espectrales. */
export interface DiagramaLeible {
  readonly L: number;
  estaciones(): number[];
  esfuerzosEn(x: number, lado?: -1 | 1): number[];
  desplazamientosEn(x: number): number[];
}

/** Valores ya calculados en unos pocos puntos de una barra: las x y, en el mismo orden, lo de cada una. */
interface Hechos<T> {
  xs: number[];
  vs: T[];
}

/** Fracción de L a la que se mira el signo del modo dominante a cada lado de un punto. */
const LADO = 1e-9;
const DECIMOS = 10;

/**
 * Los esfuerzos de cada modo en los dos extremos de una barra (12 por modo: en 0⁺ y en L⁻), si todos
 * son lineales en ella; null si alguno no lo es. Es de la barra, no del caso espectral: los casos de
 * las dos direcciones y las dos excentricidades usan los mismos modos.
 */
export function extremosModales(modos: readonly DiagramaBarra[]): Float64Array | null {
  if (!modos.every(esLineal)) return null;
  const e = new Float64Array(12 * modos.length);
  modos.forEach((d, i) => {
    e.set(d.esfuerzosEn(0, 1), 12 * i);
    e.set(d.esfuerzosEn(d.L, -1), 12 * i + 6);
  });
  return e;
}

/** Un caso espectral en una barra: sus esfuerzos y sus desplazamientos en cada punto, sin su factor. */
export class EspectralBarra {
  readonly L: number;
  readonly caso: CasoEspectral;
  private readonly diagramas: readonly DiagramaBarra[] | (() => readonly DiagramaBarra[]);
  private modosC: readonly DiagramaBarra[] | null = null;
  private readonly extremos: Float64Array | null;
  private readonly v: Float64Array;
  private readonly x: Float64Array;
  /** Los seis esfuerzos en cada punto ya pedido, por la derecha y por la izquierda (pocos puntos por barra: se buscan recorriéndolos). */
  private readonly hechos: [Hechos<Float64Array>, Hechos<Float64Array>] = [
    { xs: [], vs: [] },
    { xs: [], vs: [] },
  ];

  /**
   * @param modos el diagrama de la barra en cada modo del caso, en su orden, o cómo hacerlos: con
   * `extremos` y `L`, los esfuerzos no los necesitan (un diagrama por barra y por modo no cabe en un
   * edificio grande) y sólo se hacen para los desplazamientos.
   * @param extremos los esfuerzos de cada modo en los dos extremos (`extremosModales`), si ya se
   * tienen (undefined: se calculan con los diagramas; null: algún modo no es lineal en la barra).
   */
  constructor(caso: CasoEspectral, modos: readonly DiagramaBarra[] | (() => readonly DiagramaBarra[]), extremos?: Float64Array | null, L?: number) {
    this.caso = caso;
    this.diagramas = modos;
    const n = caso.modos.length;
    if (extremos === undefined || L === undefined) {
      this.L = this.modos[0]!.L;
      this.extremos = extremos === undefined ? extremosModales(this.modos) : extremos;
    } else {
      this.L = L;
      this.extremos = extremos;
    }
    this.v = new Float64Array(n);
    this.x = new Float64Array(n);
  }

  /** El diagrama de la barra en cada modo del caso, en su orden. */
  get modos(): readonly DiagramaBarra[] {
    return (this.modosC ??= typeof this.diagramas === "function" ? this.diagramas() : this.diagramas);
  }

  /** El esfuerzo c del modo i en x. */
  private modo(i: number, c: number, x: number, lado: -1 | 1): number {
    const e = this.extremos;
    if (!e) return this.modos[i]!.esfuerzosEn(x, lado)[c]!;
    const [a, b] = [e[12 * i + c]!, e[12 * i + 6 + c]!];
    return a + ((b - a) * x) / this.L;
  }

  /** El valor en x de una variable lineal en los esfuerzos: `deModo` da la del modo i. */
  private combinado(deModo: (i: number, x: number) => number, x: number, lado: -1 | 1): number {
    const c = this.caso;
    // El signo del dominante, un poco hacia el lado: en el punto donde se anula, el caso salta
    const xs = Math.min(this.L, Math.max(0, x + lado * LADO * this.L));
    for (let i = 0; i < c.modos.length; i++) this.v[i] = deModo(i, x);
    return valorEspectral(c, this.v, this.x, false, c.coeficientes[c.dominante]! * deModo(c.dominante, xs));
  }

  /** Los seis esfuerzos del caso en x, por la izquierda (−1) o por la derecha (+1). No se cambian: se guardan. */
  esfuerzosEn(x: number, lado: -1 | 1 = 1): Float64Array {
    const l = x <= 0 ? 1 : x >= this.L ? -1 : lado;
    const hechos = this.hechos[l > 0 ? 0 : 1];
    const k = hechos.xs.indexOf(x);
    if (k >= 0) return hechos.vs[k]!;
    const r = new Float64Array(6);
    for (let c = 0; c < 6; c++) r[c] = this.combinado((i, xx) => this.modo(i, c, xx, l), x, l);
    hechos.xs.push(x);
    hechos.vs.push(r);
    return r;
  }

  /** Una combinación lineal de los esfuerzos en x, Σ k·e[c] con `pesos` = [c, k]…: la de cada modo, combinada. */
  proyectadoEn(x: number, lado: -1 | 1, pesos: readonly (readonly [number, number])[]): number {
    const l = x <= 0 ? 1 : x >= this.L ? -1 : lado;
    return this.combinado((i, xx) => pesos.reduce((a, [c, k]) => a + k * this.modo(i, c, xx, l), 0), x, l);
  }

  /** Desplazamientos locales del caso en x, por μ. */
  desplazamientosEn(x: number): number[] {
    const us = this.modos.map((d) => d.desplazamientosEn(x));
    return us[0]!.map((_, c) => {
      for (let i = 0; i < us.length; i++) this.v[i] = us[i]![c]!;
      return valorEspectral(this.caso, this.v, this.x, true);
    });
  }

  /** Lo que cada desplazamiento se separa en x de la cuerda entre los dos extremos de la barra, por μ: lo de cada modo, combinado. */
  relativoEn(x: number): number[] {
    const us = this.modos.map((d) => cuerda(d, x));
    return us[0]!.map((_, c) => {
      for (let i = 0; i < us.length; i++) this.v[i] = us[i]![c]!;
      return valorEspectral(this.caso, this.v, this.x, true);
    });
  }

  /** Donde el modo dominante cambia de signo en My o en Mz (allí el caso salta). */
  cambiosDeSigno(): number[] {
    if (!this.extremos) return [];
    const r: number[] = [];
    const d = this.caso.dominante;
    for (const c of [4, 5]) {
      const [a, b] = [this.extremos[12 * d + c]!, this.extremos[12 * d + 6 + c]!];
      if (a * b < 0) r.push((this.L * a) / (a - b));
    }
    return r;
  }
}

/** u(0) + (u(L) − u(0))·x/L − u(x) de cada desplazamiento de un diagrama. */
function cuerda(d: DiagramaBarra, x: number): number[] {
  const [u0, uL, u] = [d.desplazamientosEn(0), d.desplazamientosEn(d.L), d.desplazamientosEn(x)];
  return u.map((v, c) => u0[c]! + ((uL[c]! - u0[c]!) * x) / d.L - v);
}

export interface ParteEspectral {
  factor: number;
  espectral: EspectralBarra;
}

/**
 * Lo ya evaluado de la parte estática de una combinación: sus esfuerzos en cada punto (por la derecha
 * y por la izquierda) y sus estaciones. Las combinaciones de la situación sísmica comparten su parte
 * estática (el mismo `DiagramaBarra`), y cada una la pedía otra vez en las mismas estaciones.
 */
interface Evaluado {
  hechos: [Hechos<number[]>, Hechos<number[]>];
  estaciones: number[] | null;
}
const EVALUADOS = new WeakMap<DiagramaBarra, Evaluado>();

export class DiagramaCompuesto implements DiagramaLeible {
  readonly L: number;
  /** La parte estática de la combinación. */
  readonly lineal: DiagramaBarra;
  private readonly partes: readonly ParteEspectral[];
  private readonly evaluado: Evaluado;
  private estacionesC: number[] | null = null;

  constructor(lineal: DiagramaBarra, partes: readonly ParteEspectral[]) {
    this.L = lineal.L;
    this.lineal = lineal;
    this.partes = partes;
    let ev = EVALUADOS.get(lineal);
    if (!ev)
      EVALUADOS.set(
        lineal,
        (ev = {
          hechos: [
            { xs: [], vs: [] },
            { xs: [], vs: [] },
          ],
          estaciones: null,
        }),
      );
    this.evaluado = ev;
  }

  /** Los esfuerzos de la parte estática en x (los mismos números que `lineal.esfuerzosEn`; no se cambian). */
  private estatico(x: number, l: -1 | 1): number[] {
    const hechos = this.evaluado.hechos[l > 0 ? 0 : 1];
    const k = hechos.xs.indexOf(x);
    if (k >= 0) return hechos.vs[k]!;
    const e = this.lineal.esfuerzosEn(x, l);
    hechos.xs.push(x);
    hechos.vs.push(e);
    return e;
  }

  esfuerzosEn(x: number, lado: -1 | 1 = 1): number[] {
    const l = x <= 0 ? 1 : x >= this.L ? -1 : lado;
    const r = this.estatico(x, l).slice();
    for (const p of this.partes) {
      const e = p.espectral.esfuerzosEn(x, l);
      for (let c = 0; c < 6; c++) r[c]! += p.factor * e[c]!;
    }
    return r;
  }

  /**
   * Una combinación lineal de los esfuerzos en x, Σ k·e[c] con `pesos` = [c, k]… (el momento en el
   * plano de un alzado, que mezcla My, Mz y T): lo de los casos espectrales, la de cada modo,
   * combinada (no la de los esfuerzos ya combinados).
   */
  proyectadoEn(x: number, lado: -1 | 1, pesos: readonly (readonly [number, number])[]): number {
    const l = x <= 0 ? 1 : x >= this.L ? -1 : lado;
    const e = this.estatico(x, l);
    let r = pesos.reduce((a, [c, k]) => a + k * e[c]!, 0);
    for (const p of this.partes) r += p.factor * p.espectral.proyectadoEn(x, l, pesos);
    return r;
  }

  /** Desplazamientos locales en x: los de los casos espectrales, por μ. */
  desplazamientosEn(x: number): number[] {
    const r = this.lineal.desplazamientosEn(x);
    for (const p of this.partes) {
      const u = p.espectral.desplazamientosEn(x);
      for (let c = 0; c < 6; c++) r[c]! += p.factor * u[c]!;
    }
    return r;
  }

  /**
   * Lo que cada desplazamiento se separa de la cuerda entre los dos extremos de la barra en x:
   * u(0) + (u(L) − u(0))·x/L − u(x). Es lineal en los desplazamientos, así que lo de los casos
   * espectrales es la combinación de lo de cada modo (no la diferencia de los combinados), por μ.
   */
  relativoEn(x: number): number[] {
    const r = cuerda(this.lineal, x);
    for (const p of this.partes) {
      const u = p.espectral.relativoEn(x);
      for (let c = 0; c < 6; c++) r[c]! += p.factor * u[c]!;
    }
    return r;
  }

  estaciones(): number[] {
    if (this.estacionesC) return this.estacionesC;
    const L = this.L;
    const xs = new Set<number>((this.evaluado.estaciones ??= this.lineal.estaciones()));
    for (let k = 0; k <= DECIMOS; k++) xs.add(k === DECIMOS ? L : (L * k) / DECIMOS);
    for (const p of this.partes) for (const x of p.espectral.cambiosDeSigno()) xs.add(x);
    // El vértice de la parábola alrededor del mayor y del menor My y Mz de las muestras
    const orden = [...xs].sort((u, w) => u - w);
    const muestras = orden.map((x) => this.esfuerzosEn(x, 1));
    for (const c of [4, 5]) {
      for (const signo of [1, -1]) {
        let k = 0;
        for (let i = 1; i < muestras.length; i++) if (signo * muestras[i]![c]! > signo * muestras[k]![c]!) k = i;
        if (k === 0 || k === muestras.length - 1) continue;
        const [x0, x1, x2] = [orden[k - 1]!, orden[k]!, orden[k + 1]!];
        const [y0, y1, y2] = [muestras[k - 1]![c]!, muestras[k]![c]!, muestras[k + 1]![c]!];
        const d = (x1 - x0) * (y1 - y2) - (x1 - x2) * (y1 - y0);
        if (d === 0) continue;
        const xv = x1 - (0.5 * ((x1 - x0) ** 2 * (y1 - y2) - (x1 - x2) ** 2 * (y1 - y0))) / d;
        if (xv > x0 && xv < x2 && Number.isFinite(xv)) xs.add(xv);
      }
    }
    return (this.estacionesC = [...xs].sort((u, w) => u - w));
  }
}

/** Una combinación lineal de los esfuerzos de un diagrama en x: Σ k·e[c], con `pesos` = [c, k]… (`DiagramaCompuesto.proyectadoEn`). */
export function esfuerzoProyectado(D: DiagramaLeible, x: number, lado: -1 | 1, pesos: readonly (readonly [number, number])[]): number {
  if (D instanceof DiagramaCompuesto) return D.proyectadoEn(x, lado, pesos);
  const e = D.esfuerzosEn(x, lado);
  return pesos.reduce((a, [c, k]) => a + k * e[c]!, 0);
}

/** ¿Son los esfuerzos del diagrama lineales en toda la barra (un solo tramo, grado ≤ 1 y sin saltos)? */
function esLineal(d: DiagramaBarra): boolean {
  if (d.cortes.length !== 2) return false;
  for (const t of d.esfuerzos) {
    const nc = t.c.length / t.nTramos;
    for (let p = 2; p < nc; p++) if (t.c[p] !== 0) return false;
  }
  return true;
}
