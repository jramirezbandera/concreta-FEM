/**
 * Cargas de barra en ejes locales del tramo flexible, sus fuerzas de empotramiento perfecto (FER)
 * y los diagramas de esfuerzos y desplazamientos (E2). Todo en forma cerrada, para Timoshenko y
 * Euler–Bernoulli, y sin trocear la barra (H11).
 *
 * Esfuerzos (convenio de `motor/modelo.ts`) a partir de los del arranque s₀ = s(0⁺ antes de las
 * cargas en 0), por equilibrio del tramo [0, x]:
 *   N = N₀ − Qx,  Vy = Vy₀ − Qy,  Vz = Vz₀ − Qz,  T = T₀ − ΣMx,
 *   My = My₀ − Vz₀·x + ∫₀ˣ Qz + ΣMy,  Mz = Mz₀ − Vy₀·x + ∫₀ˣ Qy − ΣMz,
 * con Q(x) = ∫₀ˣ q + ΣF (cargas puntuales con ξ ≤ x). Así My' = −Vz y Mz' = −Vy.
 *
 * FER: con el extremo i' empotrado, s₀ es la única incógnita; las seis condiciones de
 * desplazamiento nulo en j' (método de flexibilidad) dan s₀ exactamente. Las fuerzas que el
 * empotramiento ejerce sobre la barra son r₀ = [−N₀, −Vy₀, −Vz₀, −T₀, My₀, −Mz₀] en i' y
 * [N, Vy, Vz, T, −My, Mz](L⁺) en j'.
 */
import { flexibilidadCortante, type SeccionBarra } from "./barra.ts";
import { Tramos, unirCortes } from "./tramos.ts";

export type V3 = readonly [number, number, number];

/** Carga en ejes locales del tramo flexible; posiciones en m desde i', dentro de [0, L]. */
export type CargaLocal =
  | { tipo: "puntual"; x: number; F: V3; M: V3 }
  | { tipo: "distribuida"; a: number; b: number; qa: V3; qb: V3 };

/** Esfuerzos debidos sólo a las cargas (s₀ = 0), en el orden [N, Vy, Vz, T, My, Mz]. */
export interface DiagramaCargas {
  L: number;
  cortes: Float64Array;
  s: Tramos[];
}

const indiceCorte = (cortes: Float64Array, x: number): number => {
  let lo = 0;
  let hi = cortes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cortes[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  if (cortes[lo] !== x) throw new Error("indiceCorte: x no es un corte");
  return lo;
};

export function diagramaDeCargas(L: number, cargas: readonly CargaLocal[]): DiagramaCargas {
  const pos: number[] = [0, L];
  for (const c of cargas) {
    if (c.tipo === "puntual") pos.push(c.x);
    else pos.push(c.a, c.b);
  }
  const cortes = unirCortes(pos);
  const n = cortes.length - 1;
  const q = [0, 1, 2].map(() => Tramos.cero(cortes));
  const saltosF = [0, 1, 2].map(() => new Float64Array(n + 1));
  const saltosM = [0, 1, 2].map(() => new Float64Array(n + 1));
  for (const c of cargas) {
    if (c.tipo === "puntual") {
      const k = indiceCorte(cortes, c.x);
      for (let d = 0; d < 3; d++) {
        saltosF[d]![k]! += c.F[d]!;
        saltosM[d]![k]! += c.M[d]!;
      }
      continue;
    }
    const ka = indiceCorte(cortes, c.a);
    const kb = indiceCorte(cortes, c.b);
    for (let d = 0; d < 3; d++) {
      const m = (c.qb[d]! - c.qa[d]!) / (c.b - c.a);
      const coef = q[d]!.c;
      for (let k = ka; k < kb; k++) {
        coef[6 * k]! += c.qa[d]! + m * (cortes[k]! - c.a);
        coef[6 * k + 1]! += m;
      }
    }
  }
  const Q = q.map((qd, d) => qd.integral(saltosF[d]));
  const N = Q[0]!.afin(-1, 0);
  const Vy = Q[1]!.afin(-1, 0);
  const Vz = Q[2]!.afin(-1, 0);
  const T = Tramos.cero(cortes).integral(saltosM[0]).afin(-1, 0);
  const My = Q[2]!.integral(saltosM[1]);
  const Mz = Q[1]!.integral(saltosM[2]!.map((v) => -v));
  return { L, cortes, s: [N, Vy, Vz, T, My, Mz] };
}

/** ∫₀ᴸ f (sin los saltos de la integral). */
const integralTotal = (f: Tramos) => f.integral().izquierda(f.nTramos);
/** ∫₀ᴸ ∫₀ˣ f. */
const integralDoble = (f: Tramos) => f.integral().integral().izquierda(f.nTramos);

/** Esfuerzos de arranque s₀ con los dos extremos empotrados (método de flexibilidad). */
export function arranqueEmpotrado(s: SeccionBarra, dc: DiagramaCargas): number[] {
  const { L } = dc;
  const [N, Vy, Vz, T, My, Mz] = dc.s as [Tramos, Tramos, Tramos, Tramos, Tramos, Tramos];
  const N0 = -integralTotal(N) / L;
  const T0 = -integralTotal(T) / L;
  // Plano x-z: θy(L) = 0 y w(L) = 0
  const plano = (V: Tramos, M: Tramos, EI: number, f: number): [number, number] => {
    const I1 = integralTotal(M);
    const I2 = integralDoble(M);
    const J1 = integralTotal(V);
    const V0 = (-J1 * f + (I1 * L / 2 - I2) / EI) / (L * f + L ** 3 / (12 * EI));
    const M0 = (V0 * L) / 2 - I1 / L;
    return [V0, M0];
  };
  const [Vz0, My0] = plano(Vz, My, s.E * s.Iy, flexibilidadCortante(s.G, s.Avz));
  const [Vy0, Mz0] = plano(Vy, Mz, s.E * s.Iz, flexibilidadCortante(s.G, s.Avy));
  return [N0, Vy0, Vz0, T0, My0, Mz0];
}

/** Valores de los esfuerzos en L⁺ (con las cargas en L) para un arranque s₀. */
function esfuerzosFinales(dc: DiagramaCargas, s0: readonly number[]): number[] {
  const { L } = dc;
  const f = dc.s.map((t) => t.final());
  return [
    s0[0]! + f[0]!,
    s0[1]! + f[1]!,
    s0[2]! + f[2]!,
    s0[3]! + f[3]!,
    s0[4]! - s0[2]! * L + f[4]!,
    s0[5]! - s0[1]! * L + f[5]!,
  ];
}

/** Fuerzas de los extremos sobre la barra (12, locales) a partir de s₀ y de los esfuerzos en L⁺. */
export function fuerzasDeExtremo(s0: readonly number[], sL: readonly number[]): Float64Array {
  return Float64Array.of(-s0[0]!, -s0[1]!, -s0[2]!, -s0[3]!, s0[4]!, -s0[5]!, sL[0]!, sL[1]!, sL[2]!, sL[3]!, -sL[4]!, sL[5]!);
}

/** Esfuerzos de arranque s₀ a partir de las fuerzas del extremo i' sobre la barra (6 primeras de f). */
export function arranqueDeFuerzas(f: ArrayLike<number>): number[] {
  return [-f[0]!, -f[1]!, -f[2]!, -f[3]!, f[4]!, -f[5]!];
}

/** FER locales de empotramiento perfecto (sin liberaciones): fuerzas de los empotramientos sobre la barra. */
export function ferBarra(s: SeccionBarra, dc: DiagramaCargas): Float64Array {
  const s0 = arranqueEmpotrado(s, dc);
  return fuerzasDeExtremo(s0, esfuerzosFinales(dc, s0));
}

export const COMPONENTES_ESFUERZO = ["N", "Vy", "Vz", "T", "My", "Mz"] as const;
export const COMPONENTES_DESPLAZAMIENTO = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;

/**
 * Diagrama exacto de una barra: esfuerzos [N, Vy, Vz, T, My, Mz] y desplazamientos locales
 * [ux, uy, uz, rx, ry, rz] del eje del tramo flexible, en función de x ∈ [0, L] desde i'.
 */
export class DiagramaBarra {
  readonly L: number;
  readonly cortes: Float64Array;
  /** [N, Vy, Vz, T, My, Mz]. */
  readonly esfuerzos: Tramos[];
  /** [ux, uy, uz, rx, ry, rz] en ejes locales. */
  readonly desplazamientos: Tramos[];

  constructor(L: number, cortes: Float64Array, esfuerzos: Tramos[], desplazamientos: Tramos[]) {
    this.L = L;
    this.cortes = cortes;
    this.esfuerzos = esfuerzos;
    this.desplazamientos = desplazamientos;
  }

  /**
   * @param s0 esfuerzos de arranque (en 0, antes de las cargas en 0).
   * @param u0 desplazamientos locales de i' (del tramo flexible: con el giro propio si i' está liberado).
   */
  static desde(s: SeccionBarra, dc: DiagramaCargas, s0: readonly number[], u0: ArrayLike<number>): DiagramaBarra {
    const [NL, VyL, VzL, TL, MyL, MzL] = dc.s as [Tramos, Tramos, Tramos, Tramos, Tramos, Tramos];
    const N = NL.afin(1, s0[0]!);
    const Vy = VyL.afin(1, s0[1]!);
    const Vz = VzL.afin(1, s0[2]!);
    const T = TL.afin(1, s0[3]!);
    const My = MyL.afin(1, s0[4]!, -s0[2]!);
    const Mz = MzL.afin(1, s0[5]!, -s0[1]!);
    const fy = flexibilidadCortante(s.G, s.Avy);
    const fz = flexibilidadCortante(s.G, s.Avz);
    const ux = N.integral().afin(1 / (s.E * s.A), u0[0]!);
    const rx = T.integral().afin(1 / (s.G * s.J), u0[3]!);
    const ry = My.integral().afin(-1 / (s.E * s.Iy), u0[4]!);
    const rz = Mz.integral().afin(1 / (s.E * s.Iz), u0[5]!);
    const uz = Vz.afin(fz, 0).mas(ry, -1).integral().afin(1, u0[2]!);
    const uy = Vy.afin(fy, 0).mas(rz, 1).integral().afin(1, u0[1]!);
    return new DiagramaBarra(dc.L, dc.cortes, [N, Vy, Vz, T, My, Mz], [ux, uy, uz, rx, ry, rz]);
  }

  /** Esfuerzos en x, por la izquierda (−1) o por la derecha (+1) de un salto. */
  esfuerzosEn(x: number, lado: -1 | 1 = 1): number[] {
    const l = x <= 0 ? 1 : x >= this.L ? -1 : lado;
    return this.esfuerzos.map((t) => t.en(x, l));
  }

  /** Desplazamientos locales en x (continuos). */
  desplazamientosEn(x: number): number[] {
    return this.desplazamientos.map((t) => t.en(x, x >= this.L ? -1 : 1));
  }

  /** a·this + Σ bᵢ·otrosᵢ (combinación lineal de casos de la misma barra). */
  static combinar(diagramas: readonly DiagramaBarra[], factores: readonly number[]): DiagramaBarra {
    const d0 = diagramas[0]!;
    const cortes = unirCortes(...diagramas.map((d) => d.cortes));
    const sumar = (sel: (d: DiagramaBarra) => Tramos[]) =>
      sel(d0).map((_, c) => {
        let t = Tramos.cero(cortes);
        diagramas.forEach((d, k) => {
          t = t.mas(sel(d)[c]!.refinar(cortes), factores[k]!);
        });
        return t;
      });
    return new DiagramaBarra(d0.L, cortes, sumar((d) => d.esfuerzos), sumar((d) => d.desplazamientos));
  }

  /**
   * Estaciones para tablas y comprobaciones: extremos, cuartos y puntos de carga (H36), más los
   * extremos interiores de My y Mz (donde se anulan Vz y Vy, salvo en los saltos).
   */
  estaciones(): number[] {
    const L = this.L;
    const xs = new Set<number>([0, L / 4, L / 2, (3 * L) / 4, L, ...this.cortes]);
    for (const c of [1, 2]) for (const x of this.ceros(c)) xs.add(x);
    return [...xs].sort((a, b) => a - b);
  }

  /** Raíces interiores de la componente de esfuerzo `c` (un cortante: grado ≤ 2 por tramo). */
  ceros(c: number): number[] {
    const t = this.esfuerzos[c]!;
    const r: number[] = [];
    for (let k = 0; k < t.nTramos; k++) {
      const x0 = this.cortes[k]!;
      const h = this.cortes[k + 1]! - x0;
      const [a0, a1, a2] = [t.c[6 * k]!, t.c[6 * k + 1]!, t.c[6 * k + 2]!];
      for (let p = 3; p < 6; p++) if (t.c[6 * k + p] !== 0) throw new Error("ceros: el cortante es de grado > 2");
      const raices: number[] = [];
      if (a2 === 0) {
        if (a1 !== 0) raices.push(-a0 / a1);
      } else {
        const disc = a1 * a1 - 4 * a2 * a0;
        if (disc >= 0) {
          // fórmula estable
          const qq = -0.5 * (a1 + Math.sign(a1 || 1) * Math.sqrt(disc));
          raices.push(qq / a2);
          if (qq !== 0) raices.push(a0 / qq);
        }
      }
      for (const s of raices) if (s > 0 && s < h) r.push(x0 + s);
    }
    return r;
  }
}

/** Fuerzas de empotramiento y diagrama de cargas de una barra con sus cargas locales. */
export function cargasDeBarra(s: SeccionBarra, L: number, cargas: readonly CargaLocal[]): { dc: DiagramaCargas; fer: Float64Array } {
  const dc = diagramaDeCargas(L, cargas);
  return { dc, fer: ferBarra(s, dc) };
}
