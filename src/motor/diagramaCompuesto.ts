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

/**
 * Valores ya calculados en unos puntos de una barra, por su x. VS4: un mapa; con una lista recorrida,
 * las combinaciones de la situación sísmica (cada una añade sus vértices) la hacían cuadrática.
 */
type Hechos<T> = Map<number, T>;

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
  private readonly hechos: [Hechos<Float64Array>, Hechos<Float64Array>] = [new Map(), new Map()];
  private cambios: number[] | null = null;
  /** Los esfuerzos que no son constantes en la barra en algún modo, y el valor del caso en los que sí. */
  private variablesC: number[] | null = null;
  private constantes: Float64Array | null = null;

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
    const hecho = hechos.get(x);
    if (hecho) return hecho;
    // El lado sólo cuenta en el signo del modo dominante: si en x es el mismo por los dos, lo del otro lado
    const otro = this.hechos[l > 0 ? 1 : 0].get(x);
    if (otro && this.mismoSigno(x)) {
      hechos.set(x, otro);
      return otro;
    }
    const r = new Float64Array(6);
    this.calcular(x, l, r);
    hechos.set(x, r);
    return r;
  }

  /**
   * ¿Dan lo mismo los dos lados de x (un punto interior)? Sí, si el modo dominante no cambia de signo
   * entre un poco antes y un poco después en ningún esfuerzo que varíe en la barra; sin los esfuerzos
   * de los modos en los extremos, no se sabe (false).
   */
  mismoSigno(x: number): boolean {
    const e = this.extremos;
    if (!e) return false;
    const L = this.L;
    const d = this.caso.dominante;
    const cd = this.caso.coeficientes[d]!;
    const [xa, xb] = [Math.min(L, Math.max(0, x - LADO * L)), Math.min(L, Math.max(0, x + LADO * L))];
    for (let c = 0; c < 6; c++) {
      const ad = e[12 * d + c]!;
      const p = e[12 * d + 6 + c]! - ad;
      if (p === 0) continue;
      if (cd * (ad + (p * xa) / L) < 0 !== cd * (ad + (p * xb) / L) < 0) return false;
    }
    return true;
  }

  /**
   * Los seis esfuerzos del caso en x por el lado l (ya el que vale en los extremos: +1 en 0 y −1 en L),
   * en `r`, sin guardarlos. Con los esfuerzos de los modos en los extremos, lo mismo que `combinado`
   * con `modo` (las mismas cuentas, en el mismo orden) sin un cierre por componente, y un esfuerzo
   * constante en la barra en todos los modos (sin cargas en las barras, el axil, los cortantes y el
   * torsor) se combina una sola vez: vale lo mismo en todos sus puntos.
   */
  calcular(x: number, l: -1 | 1, r: Float64Array): void {
    const e = this.extremos;
    if (!e) {
      for (let c = 0; c < 6; c++) r[c] = this.combinado((i, xx) => this.modo(i, c, xx, l), x, l);
      return;
    }
    const caso = this.caso;
    const n = caso.modos.length;
    const L = this.L;
    const v = this.v;
    const d = caso.dominante;
    const cd = caso.coeficientes[d]!;
    const xs = Math.min(L, Math.max(0, x + l * LADO * L));
    let variables = this.variablesC;
    if (!variables) {
      variables = this.variablesC = [];
      for (let c = 0; c < 6; c++) {
        let constante = true;
        for (let i = 0; i < n && constante; i++) constante = e[12 * i + c] === e[12 * i + 6 + c];
        if (!constante) variables.push(c);
      }
    }
    let constantes = this.constantes;
    const primera = !constantes;
    if (!constantes) constantes = this.constantes = new Float64Array(6);
    for (let c = 0, k = 0; c < 6; c++) {
      if (variables[k] !== c) {
        if (!primera) {
          r[c] = constantes[c]!;
          continue;
        }
      } else k++;
      for (let i = 0; i < n; i++) {
        const a = e[12 * i + c]!;
        v[i] = a + ((e[12 * i + 6 + c]! - a) * x) / L;
      }
      const ad = e[12 * d + c]!;
      r[c] = valorEspectral(caso, v, this.x, false, cd * (ad + ((e[12 * d + 6 + c]! - ad) * xs) / L));
      if (primera) constantes[c] = r[c]!;
    }
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
    if (this.cambios) return this.cambios;
    if (!this.extremos) return (this.cambios = []);
    const r: number[] = [];
    const d = this.caso.dominante;
    for (const c of [4, 5]) {
      const [a, b] = [this.extremos[12 * d + c]!, this.extremos[12 * d + 6 + c]!];
      if (a * b < 0) r.push((this.L * a) / (a - b));
    }
    return (this.cambios = r);
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
  /**
   * VS4: las estaciones de antes de los vértices (las de la parte estática, los décimos y los cambios
   * de signo de sus casos espectrales), en orden, por los casos espectrales que llevan: no dependen de
   * los factores, y cada combinación de la situación sísmica las ordenaba otra vez.
   */
  rejillas: Rejilla[];
}

/**
 * Las estaciones de antes de los vértices, en orden, con lo ya evaluado en cada una: los esfuerzos de
 * la parte estática (`est[lado][i]`) y de cada caso espectral, sin su factor (`esp[p][lado][i]`), por
 * la derecha (lado 0) y por la izquierda (1). Por índice: buscar cada punto por su x en un mapa era lo
 * que más costaba al recorrer las combinaciones de la situación sísmica.
 */
interface Rejilla {
  espectrales: readonly EspectralBarra[];
  orden: number[];
  est: [number[][], number[][]];
  esp: [Float64Array[], Float64Array[]][];
}
const EVALUADOS = new WeakMap<DiagramaBarra, Evaluado>();

export class DiagramaCompuesto implements DiagramaLeible {
  readonly L: number;
  /** La parte estática de la combinación. */
  readonly lineal: DiagramaBarra;
  private readonly partes: readonly ParteEspectral[];
  private readonly evaluado: Evaluado;
  private estacionesC: number[] | null = null;
  private rejillaC: Rejilla | null = null;

  constructor(lineal: DiagramaBarra, partes: readonly ParteEspectral[]) {
    this.L = lineal.L;
    this.lineal = lineal;
    this.partes = partes;
    let ev = EVALUADOS.get(lineal);
    if (!ev)
      EVALUADOS.set(
        lineal,
        (ev = {
          hechos: [new Map(), new Map()],
          estaciones: null,
          rejillas: [],
        }),
      );
    this.evaluado = ev;
  }

  /** Los esfuerzos de la parte estática en x (los mismos números que `lineal.esfuerzosEn`; no se cambian). */
  private estatico(x: number, l: -1 | 1): number[] {
    const hechos = this.evaluado.hechos[l > 0 ? 0 : 1];
    let e = hechos.get(x);
    if (!e) hechos.set(x, (e = this.lineal.esfuerzosEn(x, l)));
    return e;
  }

  /** Las estaciones sin los vértices, en orden: las mismas para todas las combinaciones con esta parte estática y estos casos espectrales. */
  private rejilla(): Rejilla {
    if (this.rejillaC) return this.rejillaC;
    const ev = this.evaluado;
    const mia = ev.rejillas.find((r) => r.espectrales.length === this.partes.length && r.espectrales.every((e, i) => e === this.partes[i]!.espectral));
    if (mia) return (this.rejillaC = mia);
    const L = this.L;
    const xs = new Set<number>((ev.estaciones ??= this.lineal.estaciones()));
    for (let k = 0; k <= DECIMOS; k++) xs.add(k === DECIMOS ? L : (L * k) / DECIMOS);
    for (const p of this.partes) for (const x of p.espectral.cambiosDeSigno()) xs.add(x);
    const orden = [...xs].sort((u, w) => u - w);
    // En cada punto, por los dos lados (en los extremos, el que vale: `esfuerzosEn` ya lo cambia)
    const lado = (x: number, l: -1 | 1): -1 | 1 => (x <= 0 ? 1 : x >= L ? -1 : l);
    const nueva: Rejilla = {
      espectrales: this.partes.map((p) => p.espectral),
      orden,
      est: [orden.map((x) => this.estatico(x, lado(x, 1))), orden.map((x) => this.estatico(x, lado(x, -1)))],
      esp: this.partes.map((p) => [orden.map((x) => p.espectral.esfuerzosEn(x, 1)), orden.map((x) => p.espectral.esfuerzosEn(x, -1))]),
    };
    ev.rejillas.push(nueva);
    return (this.rejillaC = nueva);
  }

  /**
   * Recorre las estaciones del diagrama por los dos lados (en 0, sólo por la derecha; en L, sólo por la
   * izquierda), como quien lee `estaciones()` y `esfuerzosEn(x, lado)`: en el mismo orden y con los
   * mismos números, pero sin buscar cada punto ni hacer un vector por lectura. `e` es de trabajo: quien
   * lo quiera guardar lo copia. Es lo que usan las envolventes, que leen cada combinación entera.
   */
  recorrer(ver: (x: number, lado: -1 | 1, e: Float64Array) => void): void {
    const R = this.rejilla();
    const xs = this.estaciones();
    const { orden } = R;
    const L = this.L;
    const partes = this.partes;
    const e = new Float64Array(6);
    const t = new Float64Array(6);
    let i = 0;
    for (const x of xs) {
      while (i < orden.length && orden[i]! < x) i++;
      const enRejilla = i < orden.length && orden[i] === x;
      if (!enRejilla && x > 0 && x < L) {
        // Un vértice: no es un corte de la parte estática (todos están en la rejilla), así que ésta vale
        // lo mismo por los dos lados; y los casos espectrales, si su modo dominante no cambia de signo aquí
        let igual = true;
        for (let p = 0; p < partes.length && igual; p++) igual = partes[p]!.espectral.mismoSigno(x);
        if (igual) {
          const est = this.lineal.esfuerzosEn(x, -1);
          for (let c = 0; c < 6; c++) e[c] = est[c]!;
          for (let p = 0; p < partes.length; p++) {
            const f = partes[p]!.factor;
            partes[p]!.espectral.calcular(x, -1, t);
            for (let c = 0; c < 6; c++) e[c]! += f * t[c]!;
          }
          ver(x, -1, e);
          ver(x, 1, e);
          continue;
        }
      }
      for (let k = 0; k < 2; k++) {
        const pedido = k === 0 ? -1 : 1;
        if ((x === 0 && pedido < 0) || (x === L && pedido > 0)) continue;
        const l = x <= 0 ? 1 : x >= L ? -1 : pedido;
        const s = l > 0 ? 0 : 1;
        // Los vértices no están en la rejilla (cada combinación tiene los suyos): se evalúan aquí
        const est = enRejilla ? R.est[s][i]! : this.lineal.esfuerzosEn(x, l);
        for (let c = 0; c < 6; c++) e[c] = est[c]!;
        for (let p = 0; p < partes.length; p++) {
          const f = partes[p]!.factor;
          let ep: Float64Array;
          if (enRejilla) ep = R.esp[p]![s][i]!;
          else {
            partes[p]!.espectral.calcular(x, l, t);
            ep = t;
          }
          for (let c = 0; c < 6; c++) e[c]! += f * ep[c]!;
        }
        ver(x, pedido, e);
      }
    }
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
   * VS-o: los esfuerzos en x partidos como `Superposicion.partirLogico`: `estatica`, los de la parte
   * estática (los mismos números que `lineal.esfuerzosEn`), y `sismo`, por esfuerzo, la amplitud del
   * sismo: Σ |factor·valor| de sus casos espectrales, sin signo. Con la excentricidad accidental, el
   * valor de un caso es s·√(…) + su torsor, así que su amplitud depende del signo s del modo dominante
   * y se toma por el lado pedido, como en `esfuerzosEn`.
   */
  partidoEn(x: number, lado: -1 | 1 = 1): EsfuerzosPartidos {
    const l = x <= 0 ? 1 : x >= this.L ? -1 : lado;
    const estatica = Float64Array.from(this.estatico(x, l));
    const sismo = new Float64Array(6);
    for (const p of this.partes) {
      const e = p.espectral.esfuerzosEn(x, l);
      for (let c = 0; c < 6; c++) sismo[c]! += Math.abs(p.factor * e[c]!);
    }
    return { estatica, sismo };
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
    // El vértice de la parábola alrededor del mayor y del menor My y Mz de las muestras
    const R = this.rejilla();
    const { orden } = R;
    const n = orden.length;
    const partes = this.partes;
    const y = new Float64Array(n);
    let nuevas: number[] | null = null;
    for (const c of [4, 5]) {
      // Las muestras: `esfuerzosEn(x, 1)[c]` en cada punto de la rejilla (en L, por la izquierda), con las mismas cuentas
      for (let i = 0; i < n; i++) {
        const s = orden[i]! >= this.L ? 1 : 0;
        let v = R.est[s][i]![c]!;
        for (let p = 0; p < partes.length; p++) v += partes[p]!.factor * R.esp[p]![s][i]![c]!;
        y[i] = v;
      }
      for (const signo of [1, -1]) {
        let k = 0;
        for (let i = 1; i < n; i++) if (signo * y[i]! > signo * y[k]!) k = i;
        if (k === 0 || k === n - 1) continue;
        const [x0, x1, x2] = [orden[k - 1]!, orden[k]!, orden[k + 1]!];
        const [y0, y1, y2] = [y[k - 1]!, y[k]!, y[k + 1]!];
        const d = (x1 - x0) * (y1 - y2) - (x1 - x2) * (y1 - y0);
        if (d === 0) continue;
        const xv = x1 - (0.5 * ((x1 - x0) ** 2 * (y1 - y2) - (x1 - x2) ** 2 * (y1 - y0))) / d;
        if (xv > x0 && xv < x2 && Number.isFinite(xv)) (nuevas ??= []).push(xv);
      }
    }
    // Sin vértices, la rejilla misma (quien la lee no la cambia)
    if (!nuevas) return (this.estacionesC = orden);
    // Cada vértice, en su sitio de la rejilla (ya ordenada), si no está
    const xs = orden.slice();
    for (const xv of nuevas) {
      let k = xs.length;
      while (k > 0 && xs[k - 1]! > xv) k--;
      if (k > 0 && xs[k - 1] === xv) continue;
      xs.splice(k, 0, xv);
    }
    return (this.estacionesC = xs);
  }
}

/**
 * Recorre las estaciones de un diagrama por los dos lados (en 0, sólo por la derecha; en L, sólo por la
 * izquierda) con sus seis esfuerzos: `ver(x, lado, e)`, con `e` de trabajo (`DiagramaCompuesto.recorrer`).
 */
export function recorrerDiagrama(D: DiagramaLeible, ver: (x: number, lado: -1 | 1, e: ArrayLike<number>) => void): void {
  if (D instanceof DiagramaCompuesto) return D.recorrer(ver);
  for (const x of D.estaciones())
    for (const lado of [-1, 1] as const) {
      if ((x === 0 && lado < 0) || (x === D.L && lado > 0)) continue;
      ver(x, lado, D.esfuerzosEn(x, lado));
    }
}

/** [N, Vy, Vz, T, My, Mz] partidos en su parte estática y la amplitud del sismo de cada uno (VS-o). */
export interface EsfuerzosPartidos {
  estatica: Float64Array;
  sismo: Float64Array;
}

/**
 * Los esfuerzos de un diagrama en x partidos (`DiagramaCompuesto.partidoEn`); sin casos espectrales,
 * los de la combinación con la amplitud del sismo nula.
 */
export function esfuerzosPartidos(D: DiagramaLeible, x: number, lado: -1 | 1 = 1): EsfuerzosPartidos {
  if (D instanceof DiagramaCompuesto) return D.partidoEn(x, lado);
  return { estatica: Float64Array.from(D.esfuerzosEn(x, lado)), sismo: new Float64Array(6) };
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
