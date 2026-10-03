/**
 * Funciones polinómicas a trozos en [0, L], con saltos en los puntos de corte: la base exacta de
 * las cargas de barra, sus esfuerzos de empotramiento perfecto y los diagramas (E2).
 *
 * Una carga distribuida lineal es lineal a trozos; su integral (cortante) es cuadrática; la
 * siguiente (momento), cúbica; y los giros y flechas llegan a grado 5. Las cargas puntuales son
 * saltos en los cortes. Todo se integra en forma cerrada: no hay cuadratura ni troceado.
 *
 * Convenio de los saltos: el salto del corte xₖ se aplica en xₖ. El valor «por la izquierda» en
 * xₖ (lado −1) no lo incluye y el valor «por la derecha» (lado +1), sí. En x = 0 el valor por la
 * izquierda es el inicial (antes de cualquier salto en 0) y en x = L el valor por la derecha
 * incluye los saltos en L.
 */

/** Coeficientes por tramo: grado máximo 5. */
export const NC = 6;

export class Tramos {
  /** x₀ = 0 < x₁ < … < xₙ = L. */
  readonly cortes: Float64Array;
  /** n·NC coeficientes: en el tramo k, f(x) = Σ c[NC·k + p]·(x − xₖ)ᵖ. */
  readonly c: Float64Array;
  /** n + 1 saltos, uno por corte. */
  readonly saltos: Float64Array;
  /** Valor en 0 por la izquierda (antes del salto en 0). */
  readonly inicial: number;

  constructor(cortes: Float64Array, c: Float64Array, saltos: Float64Array, inicial = 0) {
    this.cortes = cortes;
    this.c = c;
    this.saltos = saltos;
    this.inicial = inicial;
  }

  static cero(cortes: Float64Array): Tramos {
    const n = cortes.length - 1;
    return new Tramos(cortes, new Float64Array(NC * n), new Float64Array(n + 1));
  }

  get nTramos(): number {
    return this.cortes.length - 1;
  }

  /** Tramo que contiene x (por la derecha: el que empieza en x si x es un corte). */
  private tramo(x: number, lado: -1 | 1): number {
    const xs = this.cortes;
    const n = xs.length - 1;
    // último k con xₖ < x (lado −1) o xₖ ≤ x (lado +1), acotado a [0, n−1]
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (lado > 0 ? xs[mid]! <= x : xs[mid]! < x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private poli(k: number, t: number): number {
    const c = this.c;
    const b = NC * k;
    let s = c[b + NC - 1]!;
    for (let p = NC - 2; p >= 0; p--) s = s * t + c[b + p]!;
    return s;
  }

  /** Valor en x, por la izquierda (−1) o por la derecha (+1). */
  en(x: number, lado: -1 | 1 = 1): number {
    const xs = this.cortes;
    const n = xs.length - 1;
    if (lado < 0 && x <= xs[0]!) return this.inicial;
    if (lado > 0 && x >= xs[n]!) return this.poli(n - 1, xs[n]! - xs[n - 1]!) + this.saltos[n]!;
    const k = this.tramo(x, lado);
    return this.poli(k, x - xs[k]!);
  }

  /** Valor por la izquierda en el corte k (k = 0: el inicial). */
  izquierda(k: number): number {
    return k === 0 ? this.inicial : this.poli(k - 1, this.cortes[k]! - this.cortes[k - 1]!);
  }

  /** Valor en L por la derecha (con los saltos en L). */
  final(): number {
    const n = this.nTramos;
    return this.izquierda(n) + this.saltos[n]!;
  }

  /**
   * F(x) = ∫₀ˣ f + Σ saltos de F en los cortes ≤ x. F es continua salvo en esos saltos, y su
   * valor inicial es 0.
   */
  integral(saltosF?: Float64Array): Tramos {
    const n = this.nTramos;
    const xs = this.cortes;
    const c = new Float64Array(NC * n);
    const s = saltosF ? Float64Array.from(saltosF) : new Float64Array(n + 1);
    let F = 0; // F por la izquierda en el corte k
    for (let k = 0; k < n; k++) {
      const b = NC * k;
      if (this.c[b + NC - 1] !== 0) throw new Error("Tramos.integral: se supera el grado 5");
      F += s[k]!;
      c[b] = F;
      for (let p = 0; p < NC - 1; p++) c[b + p + 1] = this.c[b + p]! / (p + 1);
      // F en el corte k + 1 por la izquierda
      const t = xs[k + 1]! - xs[k]!;
      let v = c[b + NC - 1]!;
      for (let p = NC - 2; p >= 0; p--) v = v * t + c[b + p]!;
      F = v;
    }
    return new Tramos(xs, c, s, 0);
  }

  /** f + a·g, con los mismos cortes. */
  mas(g: Tramos, a = 1): Tramos {
    if (g.cortes !== this.cortes) throw new Error("Tramos.mas: cortes distintos");
    const c = Float64Array.from(this.c);
    for (let i = 0; i < c.length; i++) c[i]! += a * g.c[i]!;
    const s = Float64Array.from(this.saltos);
    for (let i = 0; i < s.length; i++) s[i]! += a * g.saltos[i]!;
    return new Tramos(this.cortes, c, s, this.inicial + a * g.inicial);
  }

  /** a·f + b0 + b1·x (los términos afines no tienen saltos). */
  afin(a: number, b0: number, b1 = 0): Tramos {
    const n = this.nTramos;
    const c = new Float64Array(NC * n);
    for (let k = 0; k < n; k++) {
      const b = NC * k;
      for (let p = 0; p < NC; p++) c[b + p] = a * this.c[b + p]!;
      c[b]! += b0 + b1 * this.cortes[k]!;
      c[b + 1]! += b1;
    }
    const s = this.saltos.map((v) => a * v);
    return new Tramos(this.cortes, c, s, a * this.inicial + b0);
  }

  /** La misma función sobre cortes más finos (que contengan a los suyos). */
  refinar(cortes: Float64Array): Tramos {
    if (cortes === this.cortes) return this;
    const n = cortes.length - 1;
    const c = new Float64Array(NC * n);
    const s = new Float64Array(n + 1);
    const propios = this.cortes;
    let j = 0; // tramo propio que contiene el tramo nuevo k
    for (let k = 0; k <= n; k++) {
      const x = cortes[k]!;
      // saltos: sólo en los cortes propios
      while (j < propios.length && propios[j]! < x) j++;
      if (j < propios.length && propios[j] === x) s[k] = this.saltos[j]!;
      if (k === n) break;
      const kp = Math.min(Math.max(0, propios[j] === x ? j : j - 1), propios.length - 2);
      // desplazar el polinomio del tramo kp de t = x − x_kp a t' = x − x_k (Taylor)
      const d = x - propios[kp]!;
      const b0 = NC * kp;
      const b = NC * k;
      for (let p = 0; p < NC; p++) {
        // c'_p = Σ_{q≥p} C(q, p)·c_q·dᵠ⁻ᵖ
        let v = 0;
        let binom = 1;
        let pot = 1;
        for (let q = p; q < NC; q++) {
          v += binom * this.c[b0 + q]! * pot;
          binom = (binom * (q + 1)) / (q + 1 - p);
          pot *= d;
        }
        c[b + p] = v;
      }
    }
    return new Tramos(cortes, c, s, this.inicial);
  }
}

/** Unión ordenada de cortes (sin repetidos exactos). */
export function unirCortes(...listas: ArrayLike<number>[]): Float64Array {
  const todos: number[] = [];
  for (const l of listas) for (let i = 0; i < l.length; i++) todos.push(l[i]!);
  todos.sort((a, b) => a - b);
  const r: number[] = [];
  for (const v of todos) if (r.length === 0 || v !== r[r.length - 1]) r.push(v);
  return Float64Array.from(r);
}
