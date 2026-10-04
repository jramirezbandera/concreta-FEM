/**
 * Campos recuperados de las láminas (E5): N, M y Q continuos por SPR (superconvergent patch
 * recovery, Zienkiewicz y Zhu, IJNME 33, 1992), para los mapas y para integrar bandas en cualquier
 * posición (método "campos" de cortes.ts).
 *
 * - Regiones: las láminas se agrupan en regiones conexas, coplanarias y de la misma sección
 *   (material, multiplicadores, opciones de membrana y, si la sección no es isótropa, la misma
 *   dirección del eje 1). Cada región tiene su triedro (el de su primera lámina) y sus valores
 *   nodales: en el borde entre dos regiones (losa y muro, ábaco y reticular) un nudo tiene un valor
 *   por región, porque la componente tangente de M salta. Una lámina con sus 4 nudos en un mismo
 *   enlace rígido (la huella de un pilar) no se deforma y no entra en ninguna región: lo que pasa
 *   por ella lo transmite el enlace.
 * - SPR: en cada nudo interior de una región, ajuste por mínimos cuadrados de un polinomio
 *   cuadrático [1, x, y, x², xy, y²] a N y M en los centroides de las láminas de sus dos coronas
 *   (las que tocan el nudo y sus vecinas: 4 × 4 en una malla regular). El valor en el nudo es el del
 *   polinomio. En un nudo del borde, la media de los polinomios de los parches interiores vecinos
 *   evaluados en él. Sin parches interiores, su propio parche con una base menor (bilineal o
 *   lineal). Si sus centroides están alineados (una región de una sola fila de láminas), el nudo
 *   queda «degradado»: un polinomio a lo largo de la fila, suponiendo que nada varía a través de
 *   ella; y con un único centroide, su valor y el Q de la DKMQ.
 * - Muestreo en el centroide y no en los 4 puntos de Gauss (E5-2): dentro de cada lámina, la DKMQ da
 *   a M una pendiente espuria (un diente de sierra entre los puntos de Gauss que se reduce con h al
 *   mismo ritmo que h), que no afecta al valor del centroide (orden 2, H10) pero sí a la derivada:
 *   con los puntos de Gauss, el Q recuperado de una placa gruesa no converge.
 * - Q por equilibrio: Qx = −(∂Mx/∂x + ∂Mxy/∂y) y Qy = −(∂Mxy/∂x + ∂My/∂y), con las derivadas del
 *   polinomio en el nudo. No es el Q de la DKMQ, que con mallas de obra sale un 30–50 % bajo (H18).
 * - Dentro de una lámina, interpolación bilineal de los valores nodales de su región.
 *
 * Los valores son lineales en u: los de una combinación son los de su u combinado. Convenios de
 * signos y ejes: los de las resultantes de lámina (cabecera de modelo.ts). Los valores nodales van
 * en el triedro de su región; `en` y `enNudos` los dan en los ejes de la lámina, como
 * `ResultantesLaminas`.
 */
import { PUNTOS_GAUSS } from "../elementos/dkmq.ts";
import { coordenadasNaturales, funcionesForma, operadorResultantes, vectorALocales } from "../elementos/lamina.ts";
import { Diagnosticos } from "./diagnosticos.ts";
import { geometria, type Geometria } from "./geometria.ts";
import { prepararLamina, type LaminaPreparada } from "./laminas.ts";
import type { LaminaAnalitica, ModeloAnalitico } from "./modelo.ts";

/** Base del polinomio de los parches. */
export type BaseSpr = "cuadratica" | "bilineal";

/** Puntos de muestreo del SPR. */
export type MuestreoSpr = "centroides" | "gauss";

export interface OpcionesCampos {
  /** Por defecto, "cuadratica": [1, x, y, x², xy, y²]. */
  base?: BaseSpr;
  /** Por defecto, "centroides" (un punto por lámina, parches de dos coronas); "gauss" sólo para comparar (E5-2). */
  muestreo?: MuestreoSpr;
}

/** Componentes que se ajustan (en el triedro de la región): Nx, Ny, Nxy, Mx, My, Mxy. */
const NC = 6;
/** Valores por muestra: los 6 que se ajustan y el Qx, Qy de la DKMQ (para los nudos degradados). */
const NV = 8;
/** Muestras de una lámina: sus 4 puntos de Gauss y su centroide (la media de los cuatro). */
const MUESTRAS_LAMINA = 5;
const CENTROIDE = 4;
/** Seno máximo del ángulo entre dos láminas de una misma región. */
const SENO_COPLANAR = 1e-3;
/** Cociente mínimo entre el menor y el mayor pivote de la matriz normal de un parche. */
const PIVOTE_MINIMO = 1e-8;

type Base = { n: number; p: (x: number, y: number, o: Float64Array) => void; px: (x: number, y: number, o: Float64Array) => void; py: (x: number, y: number, o: Float64Array) => void };

const BASES: Record<BaseSpr | "lineal" | "constante", Base> = {
  cuadratica: {
    n: 6,
    p: (x, y, o) => o.set([1, x, y, x * x, x * y, y * y]),
    px: (x, y, o) => o.set([0, 1, 0, 2 * x, y, 0]),
    py: (x, y, o) => o.set([0, 0, 1, 0, x, 2 * y]),
  },
  bilineal: {
    n: 4,
    p: (x, y, o) => o.set([1, x, y, x * y]),
    px: (_x, y, o) => o.set([0, 1, 0, y]),
    py: (x, _y, o) => o.set([0, 0, 1, x]),
  },
  lineal: {
    n: 3,
    p: (x, y, o) => o.set([1, x, y]),
    px: (_x, _y, o) => o.set([0, 1, 0]),
    py: (_x, _y, o) => o.set([0, 0, 1]),
  },
  constante: {
    n: 1,
    p: (_x, _y, o) => o.set([1]),
    px: (_x, _y, o) => o.set([0]),
    py: (_x, _y, o) => o.set([0]),
  },
};

export interface RegionCampos {
  /** Triedro de la región por filas (s1, s2, s3): el de su primera lámina. */
  R: Float64Array;
  /** Origen de las coordenadas de la región (global). */
  origen: Float64Array;
  laminas: number[];
}

/** Polinomio a lo largo de la dirección (dx, dy) del triedro de la región: no varía a través de ella. */
function base1D(n: 2 | 3, dx: number, dy: number): Base {
  return {
    n,
    p: (x, y, o) => {
      const s = x * dx + y * dy;
      o.set(n === 3 ? [1, s, s * s] : [1, s]);
    },
    px: (x, y, o) => o.set(n === 3 ? [0, dx, 2 * (x * dx + y * dy) * dx] : [0, dx]),
    py: (x, y, o) => o.set(n === 3 ? [0, dy, 2 * (x * dx + y * dy) * dy] : [0, dy]),
  };
}

/** Ajuste de un parche: polinomio centrado en (x, y) con escala h, sobre unas muestras. */
interface Parche {
  base: Base;
  x: number;
  y: number;
  h: number;
  /** Muestras: 5·lámina + punto (0–3, Gauss; 4, centroide). */
  muestras: Int32Array;
  /** Valores de la base en cada muestra (base.n por muestra). */
  p: Float64Array;
  /** Cholesky de la matriz normal (base.n × base.n, triangular inferior). */
  L: Float64Array;
}

/** Cómo se obtiene el valor de un nudo de una región: media de los polinomios de unos parches evaluados en él. */
interface PlanNudo {
  parches: Parche[];
  /** Sin parche bidimensional: ajuste a lo largo de una fila de centroides o un solo centroide. */
  degradado: boolean;
  /** Un solo centroide: Q de la DKMQ en vez del de equilibrio. */
  qDkmq: boolean;
  /** Por parche: la base y sus derivadas en el nudo (base.n cada una). */
  pv: Float64Array[];
  px: Float64Array[];
  py: Float64Array[];
}

/** Cholesky in situ de una matriz n×n simétrica (por filas); false si un pivote es demasiado pequeño. */
function cholesky(A: Float64Array, n: number): boolean {
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, A[n * i + i]!);
  for (let j = 0; j < n; j++) {
    let d = A[n * j + j]!;
    for (let k = 0; k < j; k++) d -= A[n * j + k]! ** 2;
    if (!(d > PIVOTE_MINIMO * max)) return false;
    const l = Math.sqrt(d);
    A[n * j + j] = l;
    for (let i = j + 1; i < n; i++) {
      let s = A[n * i + j]!;
      for (let k = 0; k < j; k++) s -= A[n * i + k]! * A[n * j + k]!;
      A[n * i + j] = s / l;
    }
    for (let i = 0; i < j; i++) A[n * i + j] = 0;
  }
  return true;
}

/** Resuelve L·Lᵀ·x = b in situ (b de n filas y m columnas, por filas). */
function resolverCholesky(L: Float64Array, n: number, b: Float64Array, m: number): void {
  for (let c = 0; c < m; c++) {
    for (let i = 0; i < n; i++) {
      let s = b[m * i + c]!;
      for (let k = 0; k < i; k++) s -= L[n * i + k]! * b[m * k + c]!;
      b[m * i + c] = s / L[n * i + i]!;
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = b[m * i + c]!;
      for (let k = i + 1; k < n; k++) s -= L[n * k + i]! * b[m * k + c]!;
      b[m * i + c] = s / L[n * i + i]!;
    }
  }
}

const MULT = ["f11", "f22", "f12", "m11", "m22", "m12", "v13", "v23"] as const;

/** ¿Tienen dos láminas la misma sección (en el sentido de las regiones)? */
function mismaSeccion(a: LaminaAnalitica, pa: LaminaPreparada, b: LaminaAnalitica, pb: LaminaPreparada): boolean {
  if (a.material.E !== b.material.E || a.material.nu !== b.material.nu || a.material.t !== b.material.t) return false;
  const ma = a.multiplicadores ?? {};
  const mb = b.multiplicadores ?? {};
  if (MULT.some((k) => (ma[k] ?? 1) !== (mb[k] ?? 1))) return false;
  if ((a.membrana?.gamma ?? 1) !== (b.membrana?.gamma ?? 1) || (a.membrana?.estabilizacion ?? 0) !== (b.membrana?.estabilizacion ?? 0)) return false;
  // Con multiplicadores distintos por dirección, la sección depende del eje 1
  const iso = (x: number, y: number, z: number) => x === y && y === z;
  const isotropa = iso(ma.f11 ?? 1, ma.f22 ?? 1, ma.f12 ?? 1) && iso(ma.m11 ?? 1, ma.m22 ?? 1, ma.m12 ?? 1) && (ma.v13 ?? 1) === (ma.v23 ?? 1);
  if (isotropa) return true;
  const c = pa.R[0]! * pb.R[0]! + pa.R[1]! * pb.R[1]! + pa.R[2]! * pb.R[2]!;
  return Math.abs(c) >= 1 - 1e-9;
}

export class CamposLaminas {
  readonly modelo: ModeloAnalitico;
  readonly geo: Geometria;
  readonly regiones: RegionCampos[] = [];
  private readonly base: Base;
  private readonly muestreo: MuestreoSpr;
  private readonly laminas: (LaminaPreparada | undefined)[] = [];
  /** Región de cada lámina (−1: fuera de las regiones). */
  private readonly regionDe: Int32Array;
  /** Plaza (nudo de una región) de cada nudo de cada lámina: 4 por lámina (−1 si la lámina no está en ninguna región). */
  readonly plazas: Int32Array;
  /** Nudo y región de cada plaza. */
  readonly nudoDePlaza: Int32Array;
  readonly regionDePlaza: Int32Array;
  /** Láminas de cada plaza (CSR). */
  private readonly ptrPlaza: Uint32Array;
  private readonly lamPlaza: Uint32Array;
  /** ¿Está la plaza en el borde de su región? */
  private readonly borde: Uint8Array;
  /** Coordenadas de cada plaza en el triedro de su región. */
  private readonly xyPlaza: Float64Array;
  /** Por lámina: cambio de sus ejes a los de su región: A (2×2 por filas, A_ij = s_i·e_j) y σ₃ = s₃·e₃. */
  private readonly cambio: Float64Array;
  private readonly planes: (PlanNudo | undefined)[] = [];
  private readonly parchesCentro: (Parche | null | undefined)[] = [];

  constructor(modelo: ModeloAnalitico, opciones: OpcionesCampos = {}) {
    this.modelo = modelo;
    this.base = BASES[opciones.base ?? "cuadratica"];
    this.muestreo = opciones.muestreo ?? "centroides";
    this.geo = geometria(modelo);
    const diag = new Diagnosticos();
    const lista = modelo.laminas ?? [];
    lista.forEach((l, k) => {
      this.laminas[k] = prepararLamina(l, k, this.geo, diag) ?? undefined;
    });
    if (diag.hayErrores) throw new Error(`CamposLaminas: el modelo tiene errores (${diag.lista[0]!.mensaje}); calcúlalo antes con calcular()`);
    const nl = lista.length;
    const nn = modelo.nudos.length;
    const { xyz } = this.geo;

    // Láminas rígidas: sus 4 nudos en un mismo enlace rígido
    const rigida = new Uint8Array(nl);
    const enlaces = (modelo.restricciones ?? []).filter((r) => r.tipo === "enlace-rigido").map((r) => new Set([r.maestro, ...r.esclavos]));
    if (enlaces.length) {
      const deNudo = new Map<number, number[]>();
      enlaces.forEach((s, i) => {
        for (const v of s) {
          let l = deNudo.get(v);
          if (!l) deNudo.set(v, (l = []));
          l.push(i);
        }
      });
      lista.forEach((l, k) => {
        for (const i of deNudo.get(l.nudos[0]) ?? []) if (l.nudos.every((v) => enlaces[i]!.has(v))) rigida[k] = 1;
      });
    }

    // Regiones: unión por lados compartidos entre láminas compatibles
    const padre = Int32Array.from({ length: nl }, (_, i) => i);
    const raiz = (a: number): number => {
      while (padre[a] !== a) {
        padre[a] = padre[padre[a]!]!;
        a = padre[a]!;
      }
      return a;
    };
    const porLado = new Map<string, number[]>();
    lista.forEach((l, k) => {
      if (!this.laminas[k] || rigida[k]) return;
      for (let a = 0; a < 4; a++) {
        const u = l.nudos[a]!;
        const v = l.nudos[(a + 1) % 4]!;
        const clave = u < v ? `${u},${v}` : `${v},${u}`;
        let q = porLado.get(clave);
        if (!q) porLado.set(clave, (q = []));
        q.push(k);
      }
    });
    const compatibles = (a: number, b: number) => {
      const pa = this.laminas[a]!;
      const pb = this.laminas[b]!;
      const c = pa.R[6]! * pb.R[6]! + pa.R[7]! * pb.R[7]! + pa.R[8]! * pb.R[8]!;
      if (Math.sqrt(Math.max(0, 1 - c * c)) > SENO_COPLANAR) return false;
      return mismaSeccion(lista[a]!, pa, lista[b]!, pb);
    };
    for (const q of porLado.values()) {
      for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) if (compatibles(q[i]!, q[j]!)) padre[raiz(q[i]!)] = raiz(q[j]!);
    }
    this.regionDe = new Int32Array(nl).fill(-1);
    const deRaiz = new Map<number, number>();
    lista.forEach((_, k) => {
      if (!this.laminas[k] || rigida[k]) return;
      const r = raiz(k);
      let g = deRaiz.get(r);
      if (g === undefined) {
        g = this.regiones.length;
        deRaiz.set(r, g);
        const pl = this.laminas[k]!;
        this.regiones.push({ R: Float64Array.from(pl.R), origen: Float64Array.from(pl.origen), laminas: [] });
      }
      this.regionDe[k] = g;
      this.regiones[g]!.laminas.push(k);
    });

    // Plazas: un valor por nudo y región
    this.plazas = new Int32Array(4 * nl).fill(-1);
    const plazaDe = new Map<number, number>(); // nn·región + nudo → plaza
    const nudoDePlaza: number[] = [];
    const regionDePlaza: number[] = [];
    lista.forEach((l, k) => {
      const g = this.regionDe[k]!;
      if (g < 0) return;
      for (let a = 0; a < 4; a++) {
        const clave = nn * g + l.nudos[a]!;
        let p = plazaDe.get(clave);
        if (p === undefined) {
          p = nudoDePlaza.length;
          plazaDe.set(clave, p);
          nudoDePlaza.push(l.nudos[a]!);
          regionDePlaza.push(g);
        }
        this.plazas[4 * k + a] = p;
      }
    });
    const np = nudoDePlaza.length;
    this.nudoDePlaza = Int32Array.from(nudoDePlaza);
    this.regionDePlaza = Int32Array.from(regionDePlaza);
    this.ptrPlaza = new Uint32Array(np + 1);
    for (let k = 0; k < nl; k++) if (this.regionDe[k]! >= 0) for (let a = 0; a < 4; a++) this.ptrPlaza[this.plazas[4 * k + a]! + 1]!++;
    for (let p = 0; p < np; p++) this.ptrPlaza[p + 1]! += this.ptrPlaza[p]!;
    this.lamPlaza = new Uint32Array(this.ptrPlaza[np]!);
    const pos = this.ptrPlaza.slice(0, np);
    for (let k = 0; k < nl; k++) if (this.regionDe[k]! >= 0) for (let a = 0; a < 4; a++) this.lamPlaza[pos[this.plazas[4 * k + a]!]!++] = k;

    // Borde: plazas en un lado que sólo usa una lámina de la región
    this.borde = new Uint8Array(np);
    const usoLado = new Map<string, number>();
    for (let k = 0; k < nl; k++) {
      if (this.regionDe[k]! < 0) continue;
      for (let a = 0; a < 4; a++) {
        const u = this.plazas[4 * k + a]!;
        const v = this.plazas[4 * k + ((a + 1) % 4)]!;
        const clave = u < v ? `${u},${v}` : `${v},${u}`;
        usoLado.set(clave, (usoLado.get(clave) ?? 0) + 1);
      }
    }
    for (const [clave, n] of usoLado) {
      if (n !== 1) continue;
      const [u, v] = clave.split(",").map(Number);
      this.borde[u!] = 1;
      this.borde[v!] = 1;
    }

    // Coordenadas de las plazas en su región y cambio de ejes de cada lámina
    this.xyPlaza = new Float64Array(2 * np);
    for (let p = 0; p < np; p++) {
      const g = this.regiones[this.regionDePlaza[p]!]!;
      const v = this.nudoDePlaza[p]!;
      const d = [xyz[3 * v]! - g.origen[0]!, xyz[3 * v + 1]! - g.origen[1]!, xyz[3 * v + 2]! - g.origen[2]!];
      this.xyPlaza[2 * p] = d[0]! * g.R[0]! + d[1]! * g.R[1]! + d[2]! * g.R[2]!;
      this.xyPlaza[2 * p + 1] = d[0]! * g.R[3]! + d[1]! * g.R[4]! + d[2]! * g.R[5]!;
    }
    this.cambio = new Float64Array(5 * nl);
    for (let k = 0; k < nl; k++) {
      const g = this.regionDe[k]!;
      if (g < 0) continue;
      const S = this.regiones[g]!.R;
      const E = this.laminas[k]!.R;
      const pr = (i: number, j: number) => S[3 * i]! * E[3 * j]! + S[3 * i + 1]! * E[3 * j + 1]! + S[3 * i + 2]! * E[3 * j + 2]!;
      this.cambio.set([pr(0, 0), pr(0, 1), pr(1, 0), pr(1, 1), Math.sign(pr(2, 2))], 5 * k);
    }
  }

  /** Región de la lámina l (−1 si no entra en ninguna: rígida). */
  region(l: number): number {
    return this.regionDe[l] ?? -1;
  }

  /** Número de plazas (nudos de región). */
  get nPlazas(): number {
    return this.nudoDePlaza.length;
  }

  /** Coordenadas (en el triedro de la región `g`) del punto global X. */
  private enRegion(g: number, X: ArrayLike<number>): [number, number] {
    const r = this.regiones[g]!;
    const d0 = X[0]! - r.origen[0]!;
    const d1 = X[1]! - r.origen[1]!;
    const d2 = X[2]! - r.origen[2]!;
    return [d0 * r.R[0]! + d1 * r.R[1]! + d2 * r.R[2]!, d0 * r.R[3]! + d1 * r.R[4]! + d2 * r.R[5]!];
  }

  /** Posición (en su región) de la muestra g de la lámina k (0–3: punto de Gauss; 4: centroide). */
  private puntoMuestra(k: number, g: number): [number, number] {
    const N = g === CENTROIDE ? funcionesForma(0, 0) : funcionesForma(PUNTOS_GAUSS[g]![0], PUNTOS_GAUSS[g]![1]);
    const nudos = this.modelo.laminas![k]!.nudos;
    const X = [0, 0, 0];
    const { xyz } = this.geo;
    for (let a = 0; a < 4; a++) for (let c = 0; c < 3; c++) X[c]! += N[a]! * xyz[3 * nudos[a]! + c]!;
    return this.enRegion(this.regionDe[k]!, X);
  }

  /** Láminas de la región que tocan la plaza p (primera corona). */
  private corona(p: number): number[] {
    const l: number[] = [];
    for (let q = this.ptrPlaza[p]!; q < this.ptrPlaza[p + 1]!; q++) l.push(this.lamPlaza[q]!);
    return l;
  }

  /** Láminas del parche de la plaza p: su corona con Gauss; sus dos coronas con centroides. */
  private laminasParche(p: number): number[] {
    const c1 = this.corona(p);
    if (this.muestreo === "gauss") return c1;
    const set = new Set<number>(c1);
    for (const k of c1) for (let a = 0; a < 4; a++) for (const k2 of this.corona(this.plazas[4 * k + a]!)) set.add(k2);
    return [...set];
  }

  /**
   * Parche de la plaza p con la base dada (null si no se puede ajustar). Con "1d", la base va a lo
   * largo de la dirección principal de las muestras (cuadrática o lineal según cuántas haya).
   */
  private parche(p: number, baseDada: Base | "1d-cuadratica" | "1d-lineal"): Parche | null {
    const x = this.xyPlaza[2 * p]!;
    const y = this.xyPlaza[2 * p + 1]!;
    const lams = this.laminasParche(p);
    let base: Base;
    if (typeof baseDada === "string") {
      // Dirección principal de los centroides
      const pts = lams.map((k) => this.puntoMuestra(k, CENTROIDE));
      const mx = pts.reduce((a, q) => a + q[0], 0) / pts.length;
      const my = pts.reduce((a, q) => a + q[1], 0) / pts.length;
      let sxx = 0, sxy = 0, syy = 0;
      for (const [qx, qy] of pts) {
        sxx += (qx - mx) ** 2;
        sxy += (qx - mx) * (qy - my);
        syy += (qy - my) ** 2;
      }
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      base = base1D(baseDada === "1d-cuadratica" ? 3 : 2, Math.cos(ang), Math.sin(ang));
    } else base = baseDada;
    // Escala: la mayor distancia del nudo a los nudos del parche
    let h = 0;
    for (const k of lams) for (let a = 0; a < 4; a++) {
      const pa = this.plazas[4 * k + a]!;
      h = Math.max(h, Math.hypot(this.xyPlaza[2 * pa]! - x, this.xyPlaza[2 * pa + 1]! - y));
    }
    const puntos = this.muestreo === "gauss" ? [0, 1, 2, 3] : [CENTROIDE];
    const n = base.n;
    const ns = puntos.length * lams.length;
    if (ns < n || !(h > 0)) return null;
    const muestras = new Int32Array(ns);
    const pv = new Float64Array(n * ns);
    const fila = new Float64Array(n);
    const M = new Float64Array(n * n);
    let s = 0;
    for (const k of lams) {
      for (const g of puntos) {
        muestras[s] = MUESTRAS_LAMINA * k + g;
        const [gx, gy] = this.puntoMuestra(k, g);
        base.p((gx - x) / h, (gy - y) / h, fila);
        pv.set(fila, n * s);
        for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) M[n * a + b]! += fila[a]! * fila[b]!;
        s++;
      }
    }
    if (!cholesky(M, n)) return null;
    return { base, x, y, h, muestras, p: pv, L: M };
  }

  /** Parche de una plaza interior como centro (null si no es interior o no se puede ajustar). */
  private centro(p: number): Parche | null {
    let c = this.parchesCentro[p];
    if (c !== undefined) return c;
    c = this.borde[p] ? null : this.parche(p, this.base);
    this.parchesCentro[p] = c;
    return c;
  }

  /** Cómo se calcula el valor de la plaza p. */
  private plan(p: number): PlanNudo {
    let pl = this.planes[p];
    if (pl) return pl;
    let parches: Parche[] = [];
    const propio = this.centro(p);
    if (propio) parches = [propio];
    else {
      // Borde: parches interiores de los nudos de sus láminas
      const vistos = new Set<number>();
      for (let q = this.ptrPlaza[p]!; q < this.ptrPlaza[p + 1]!; q++) {
        const k = this.lamPlaza[q]!;
        for (let a = 0; a < 4; a++) {
          const v = this.plazas[4 * k + a]!;
          if (v === p || vistos.has(v)) continue;
          vistos.add(v);
          const c = this.centro(v);
          if (c) parches.push(c);
        }
      }
    }
    let degradado = false;
    let qDkmq = false;
    if (!parches.length) {
      // Sin parches interiores: el propio, con la mayor base que admita
      for (const b of [this.base, BASES.bilineal, BASES.lineal, "1d-cuadratica", "1d-lineal"] as const) {
        const c = this.parche(p, b);
        if (c) {
          parches = [c];
          degradado = typeof b === "string";
          break;
        }
      }
      if (!parches.length) {
        degradado = qDkmq = true;
        parches = [this.parche(p, BASES.constante)!];
      }
    }
    const x = this.xyPlaza[2 * p]!;
    const y = this.xyPlaza[2 * p + 1]!;
    pl = { parches, degradado, qDkmq, pv: [], px: [], py: [] };
    for (const c of parches) {
      const qx = (x - c.x) / c.h;
      const qy = (y - c.y) / c.h;
      const v = new Float64Array(c.base.n);
      const dx = new Float64Array(c.base.n);
      const dy = new Float64Array(c.base.n);
      c.base.p(qx, qy, v);
      c.base.px(qx, qy, dx);
      c.base.py(qx, qy, dy);
      for (let a = 0; a < c.base.n; a++) {
        dx[a]! /= c.h;
        dy[a]! /= c.h;
      }
      pl.pv.push(v);
      pl.px.push(dx);
      pl.py.push(dy);
    }
    this.planes[p] = pl;
    return pl;
  }

  /** Evaluador de los campos de unos desplazamientos `u` (6 por nudo), con sus cachés. */
  evaluador(u: ArrayLike<number>): EvaluadorCampos {
    return new EvaluadorCampos(this, u);
  }

  /** Valores nodales (8 por plaza, en el triedro de su región) de todas las plazas. */
  nodales(u: ArrayLike<number>): Float64Array {
    const ev = this.evaluador(u);
    const out = new Float64Array(8 * this.nPlazas);
    for (let p = 0; p < this.nPlazas; p++) out.set(ev.plaza(p), 8 * p);
    return out;
  }

  /** Campos en (ξ, η) de la lámina l, en sus ejes: [Nx, Ny, Nxy, Mx, My, Mxy, Qx, Qy]. */
  en(l: number, u: ArrayLike<number>, xi: number, eta: number): Float64Array {
    return this.evaluador(u).en(l, xi, eta);
  }

  /** Campos en los 4 nudos de la lámina l, en sus ejes (4 × 8): continuos dentro de su región. */
  enNudos(l: number, u: ArrayLike<number>): Float64Array {
    const ev = this.evaluador(u);
    const out = new Float64Array(32);
    const XI = [-1, 1, 1, -1];
    const ETA = [-1, -1, 1, 1];
    for (let a = 0; a < 4; a++) out.set(ev.en(l, XI[a]!, ETA[a]!), 8 * a);
    return out;
  }

  // Acceso para el evaluador
  /** @internal */ _lamina(k: number): LaminaPreparada | undefined {
    return this.laminas[k];
  }
  /** @internal */ _cambio(k: number): Float64Array {
    return this.cambio.subarray(5 * k, 5 * k + 5);
  }
  /** @internal */ _plan(p: number): PlanNudo {
    return this.plan(p);
  }
}

/** Valores de los campos para unos desplazamientos concretos, con cachés por lámina, parche y plaza. */
export class EvaluadorCampos {
  private readonly c: CamposLaminas;
  private readonly u: ArrayLike<number>;
  private readonly gauss = new Map<number, Float64Array>();
  private readonly coef = new Map<Parche, Float64Array>();
  private readonly valores = new Map<number, Float64Array>();
  private static readonly OP = new Float64Array(768);
  /** Plazas degradadas (sin derivadas: Q de la DKMQ) que ha evaluado. */
  degradadas = 0;

  constructor(campos: CamposLaminas, u: ArrayLike<number>) {
    this.c = campos;
    this.u = u;
  }

  /**
   * Muestras de la lámina k en el triedro de su región: 4 puntos de Gauss y el centroide (su
   * media), con 8 valores cada una: N y M ajustables y el Q de la DKMQ (5 × 8).
   */
  private gaussDe(k: number): Float64Array {
    let v = this.gauss.get(k);
    if (v) return v;
    const pl = this.c._lamina(k)!;
    const nudos = this.c.modelo.laminas![k]!.nudos;
    const ug = new Float64Array(24);
    for (let a = 0; a < 4; a++) for (let q = 0; q < 6; q++) ug[6 * a + q] = this.u[6 * nudos[a]! + q]!;
    const ul = vectorALocales(ug, pl.R);
    const OP = EvaluadorCampos.OP;
    operadorResultantes(pl.xy, pl.seccion, OP);
    const [a11, a12, a21, a22, s3] = this.c._cambio(k);
    v = new Float64Array(MUESTRAS_LAMINA * NV);
    for (let g = 0; g < 4; g++) {
      const r = new Float64Array(8);
      for (let f = 0; f < 8; f++) {
        let s = 0;
        const o = 192 * g + 24 * f;
        for (let q = 0; q < 24; q++) s += OP[o + q]! * ul[q]!;
        r[f] = s;
      }
      // Tensores a la región: T' = A·T·Aᵀ (M con el signo de la normal)
      const girar = (txx: number, tyy: number, txy: number, s: number) => {
        const b11 = a11! * txx + a12! * txy;
        const b12 = a11! * txy + a12! * tyy;
        const b21 = a21! * txx + a22! * txy;
        const b22 = a21! * txy + a22! * tyy;
        return [s * (b11 * a11! + b12 * a12!), s * (b21 * a21! + b22 * a22!), s * (b11 * a21! + b12 * a22!)];
      };
      v.set(girar(r[0]!, r[1]!, r[2]!, 1), NV * g);
      v.set(girar(r[3]!, r[4]!, r[5]!, s3!), NV * g + 3);
      v[NV * g + 6] = s3! * (a11! * r[6]! + a12! * r[7]!);
      v[NV * g + 7] = s3! * (a21! * r[6]! + a22! * r[7]!);
    }
    for (let q = 0; q < NV; q++) v[NV * CENTROIDE + q] = 0.25 * (v[q]! + v[NV + q]! + v[2 * NV + q]! + v[3 * NV + q]!);
    this.gauss.set(k, v);
    return v;
  }

  /** Coeficientes del polinomio de un parche (base.n × 6). */
  private coeficientes(c: Parche): Float64Array {
    let a = this.coef.get(c);
    if (a) return a;
    const n = c.base.n;
    a = new Float64Array(n * NC);
    for (let s = 0; s < c.muestras.length; s++) {
      const m = c.muestras[s]!;
      const vg = this.gaussDe(Math.floor(m / MUESTRAS_LAMINA));
      const o = NV * (m % MUESTRAS_LAMINA);
      for (let i = 0; i < n; i++) {
        const pi = c.p[n * s + i]!;
        for (let q = 0; q < NC; q++) a[NC * i + q]! += pi * vg[o + q]!;
      }
    }
    resolverCholesky(c.L, n, a, NC);
    this.coef.set(c, a);
    return a;
  }

  /** Valores de la plaza p (8, en el triedro de su región): N y M ajustados y Q por equilibrio. */
  plaza(p: number): Float64Array {
    let v = this.valores.get(p);
    if (v) return v;
    const pl = this.c._plan(p);
    v = new Float64Array(8);
    const dx = new Float64Array(NC);
    const dy = new Float64Array(NC);
    const w = 1 / pl.parches.length;
    pl.parches.forEach((c, i) => {
      const a = this.coeficientes(c);
      const n = c.base.n;
      for (let j = 0; j < n; j++) {
        for (let q = 0; q < NC; q++) {
          v![q]! += w * pl.pv[i]![j]! * a[NC * j + q]!;
          dx[q]! += w * pl.px[i]![j]! * a[NC * j + q]!;
          dy[q]! += w * pl.py[i]![j]! * a[NC * j + q]!;
        }
      }
    });
    if (pl.degradado) this.degradadas++;
    if (pl.qDkmq) {
      // Q de la DKMQ (el del único centroide)
      const c = pl.parches[0]!;
      for (let s = 0; s < c.muestras.length; s++) {
        const vg = this.gaussDe(Math.floor(c.muestras[s]! / MUESTRAS_LAMINA));
        v[6]! += vg[NV * CENTROIDE + 6]! / c.muestras.length;
        v[7]! += vg[NV * CENTROIDE + 7]! / c.muestras.length;
      }
    } else {
      // Qx = −(∂Mx/∂x + ∂Mxy/∂y), Qy = −(∂Mxy/∂x + ∂My/∂y)
      v[6] = -(dx[3]! + dy[5]!);
      v[7] = -(dx[5]! + dy[4]!);
    }
    this.valores.set(p, v);
    return v;
  }

  /** Campos en (ξ, η) de la lámina k, en el triedro de su región (interpolación bilineal de los nodales). */
  enRegion(k: number, xi: number, eta: number): Float64Array {
    const N = funcionesForma(xi, eta);
    const out = new Float64Array(8);
    for (let a = 0; a < 4; a++) {
      const p = this.c.plazas[4 * k + a]!;
      if (p < 0) throw new Error(`CamposLaminas: la lámina ${this.c.modelo.laminas![k]!.id} no está en ninguna región (es rígida)`);
      const vp = this.plaza(p);
      for (let q = 0; q < 8; q++) out[q]! += N[a]! * vp[q]!;
    }
    return out;
  }

  /** Campos en (ξ, η) de la lámina k, en sus ejes. */
  en(k: number, xi: number, eta: number): Float64Array {
    const r = this.enRegion(k, xi, eta);
    const [a11, a12, a21, a22, s3] = this.c._cambio(k);
    // De la región a la lámina: T = Aᵀ·T'·A; Q = σ₃·Aᵀ·Q'
    const deshacer = (txx: number, tyy: number, txy: number, s: number) => {
      const b11 = a11! * txx + a21! * txy;
      const b12 = a11! * txy + a21! * tyy;
      const b21 = a12! * txx + a22! * txy;
      const b22 = a12! * txy + a22! * tyy;
      return [s * (b11 * a11! + b12 * a21!), s * (b21 * a12! + b22 * a22!), s * (b11 * a12! + b12 * a22!)];
    };
    const out = new Float64Array(8);
    out.set(deshacer(r[0]!, r[1]!, r[2]!, 1), 0);
    out.set(deshacer(r[3]!, r[4]!, r[5]!, s3!), 3);
    out[6] = s3! * (a11! * r[6]! + a21! * r[7]!);
    out[7] = s3! * (a12! * r[6]! + a22! * r[7]!);
    return out;
  }

  /** Coordenadas naturales del punto global X dentro de la lámina k (null si cae fuera). */
  naturales(k: number, X: ArrayLike<number>): [number, number] | null {
    const pl = this.c._lamina(k)!;
    const d = [X[0]! - pl.origen[0]!, X[1]! - pl.origen[1]!, X[2]! - pl.origen[2]!];
    const x = d[0]! * pl.R[0]! + d[1]! * pl.R[1]! + d[2]! * pl.R[2]!;
    const y = d[0]! * pl.R[3]! + d[1]! * pl.R[4]! + d[2]! * pl.R[5]!;
    return coordenadasNaturales(pl.xy, x, y);
  }
}
