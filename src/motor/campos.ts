/**
 * Campos recuperados de las láminas (E5): N, M y Q continuos por SPR (superconvergent patch
 * recovery, Zienkiewicz y Zhu, IJNME 33, 1992), para los mapas y para integrar bandas en cualquier
 * posición (método "campos" de cortes.ts).
 *
 * - Regiones: las láminas se agrupan en regiones conexas, coplanarias y de la misma sección. Cada
 *   región tiene su triedro (el de su primera lámina) y sus valores nodales: en el borde entre dos
 *   regiones (losa y muro, ábaco y reticular «bruto») un nudo tiene un valor por región, porque la
 *   componente tangente del tensor salta. Una lámina con sus 4 nudos en un mismo enlace rígido (la
 *   huella de un pilar) no se deforma y no entra en ninguna región: lo que pasa por ella lo
 *   transmite el enlace.
 * - Dos particiones en regiones, una por campo (SP-7, `spr-abacos.md` §15): la de **flexión**, para
 *   M y Q, en la que dos láminas son de la misma sección si tienen el mismo E, ν y t y los mismos
 *   multiplicadores m11, m22 y m12 (y el mismo eje 1 si no son isótropos); y la de **membrana**, para
 *   N, con f11, f22, f12 y las opciones de la membrana. El momento es continuo donde la rigidez a
 *   flexión lo es, aunque cambien la membrana o el cortante: en un reticular «uniforme» (CY3) el
 *   ábaco y el aligerado tienen la misma flexión y distinta membrana, y con una sola partición cada
 *   ábaco era una región de pocas láminas y el M11 del mapa saltaba hasta 23 kN·m/m en su borde,
 *   con las láminas iguales a los dos lados. Cada partición ajusta sólo sus tres componentes, así
 *   que donde las dos coinciden los valores son los mismos bits que con una sola.
 * - SPR: en cada nudo interior de una región, ajuste por mínimos cuadrados de un polinomio
 *   cuadrático [1, x, y, x², xy, y²] a N o M en los centroides de las láminas de sus dos coronas
 *   (las que tocan el nudo y sus vecinas: 4 × 4 en una malla regular). El valor en el nudo es el del
 *   polinomio. En un nudo del borde, la media de los polinomios de los parches interiores vecinos
 *   evaluados en él. Sin parches interiores, su propio parche con una base menor (bilineal o
 *   lineal). Si sus centroides están alineados (una región de una sola fila de láminas), el nudo
 *   queda «degradado»: un polinomio a lo largo de la fila, suponiendo que nada varía a través de
 *   ella; y con un único centroide, su valor y el Q de la DKMQ.
 * - Estabilidad (SP-1): el valor de un nudo es Σ wₛ·vₛ sobre sus muestras, y ningún ajuste se usa
 *   con una constante de Lebesgue Λ = Σ|wₛ| mayor que LEBESGUE_MAXIMO: si la media de los vecinos
 *   la pasa, sólo los vecinos que no; si no queda ninguno, la siguiente base del parche propio, y al
 *   final la media de sus muestras (Λ = 1, degradado). Lo decide la geometría, no u: sigue lineal.
 *   En una región pequeña (el ábaco de un pilar de borde, de 8 láminas) un bilineal de 4 muestras
 *   daba Λ ≈ 170 y nudos 30 veces fuera del rango de las láminas.
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
 * `ResultantesLaminas`. Lo que `CamposLaminas` expone sin decir la partición (`regiones`, `region`,
 * `plazas`, `lebesgueEn`…) es de la de flexión.
 */
import { PUNTOS_GAUSS } from "../elementos/dkmq.ts";
import { coordenadasNaturales, funcionesForma, operadorResultantes } from "../elementos/lamina.ts";
import { cajaCorte, ladoIndice, TOL_CORTE, type CortePreparado, type InfoCorte, type IntegradorCampos, type MuestrasCorte } from "./cortes.ts";
import { cajaDe, IndiceCajas } from "./indice.ts";
import { Diagnosticos, listaIds } from "./diagnosticos.ts";
import { geometria, type Geometria } from "./geometria.ts";
import { prepararLamina, type LaminaPreparada } from "./laminas.ts";
import type { LaminaAnalitica, ModeloAnalitico, ResultadoCaso } from "./modelo.ts";

/** Gauss–Legendre de 4 puntos en [0, 1]: abscisas y pesos. */
const GL4_S = [0.0694318442029737, 0.3300094782075719, 0.6699905217924281, 0.9305681557970263];
const GL4_W = [0.1739274225687269, 0.3260725774312731, 0.3260725774312731, 0.1739274225687269];
/** Gauss–Legendre de 2 puntos en [0, 1] (cortes con `cuadratura: 2`). */
const GL2_S = [0.21132486540518713, 0.7886751345948129];
const GL2_W = [0.5, 0.5];

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

/** Componentes que ajusta cada partición (en el triedro de la región): Nx, Ny, Nxy o Mx, My, Mxy. */
const NC = 3;
/** Valores por muestra de la lámina en sus ejes: N, M y el Q de la DKMQ. */
const NV = 8;
/** Muestras de una lámina: sus 4 puntos de Gauss y su centroide (la media de los cuatro). */
const MUESTRAS_LAMINA = 5;
const CENTROIDE = 4;
/** Seno máximo del ángulo entre dos láminas de una misma región. */
const SENO_COPLANAR = 1e-3;
/** Cociente mínimo entre el menor y el mayor pivote de la matriz normal de un parche. */
const PIVOTE_MINIMO = 1e-8;
/**
 * Constante de Lebesgue máxima del ajuste de un nudo (Λ = Σ|wₛ|, valor = Σ wₛ·vₛ): por encima, el
 * polinomio extrapola de más y se pasa a una base menor (SP-1, `spr-abacos.md`). Con Λ < 10 el
 * nudo no se sale más de ~1,9 veces del rango de sus muestras; en un ábaco medianero de 8 láminas,
 * el bilineal de 4 muestras daba Λ ≈ 170 y 31 veces. En los modelos congelados, fuera de esos ábacos, Λ ≤ 9,2.
 */
export const LEBESGUE_MAXIMO = 10;

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

/** Los tres multiplicadores de un campo: iguales en las dos láminas, y si no son isótropos, el mismo eje 1. */
function mismosMultiplicadores(a: LaminaAnalitica, pa: LaminaPreparada, b: LaminaAnalitica, pb: LaminaPreparada, claves: readonly ["f11", "f22", "f12"] | readonly ["m11", "m22", "m12"]): boolean {
  const ma = a.multiplicadores ?? {};
  const mb = b.multiplicadores ?? {};
  const va = claves.map((k) => ma[k] ?? 1);
  const vb = claves.map((k) => mb[k] ?? 1);
  if (va.some((x, i) => x !== vb[i])) return false;
  // Con multiplicadores distintos por dirección, la sección depende del eje 1
  if (va[0] === va[1] && va[1] === va[2]) return true;
  const c = pa.R[0]! * pb.R[0]! + pa.R[1]! * pb.R[1]! + pa.R[2]! * pb.R[2]!;
  return Math.abs(c) >= 1 - 1e-9;
}

/** ¿Tienen dos láminas el mismo material (E, ν y t)? */
function mismoMaterial(a: LaminaAnalitica, b: LaminaAnalitica): boolean {
  return a.material.E === b.material.E && a.material.nu === b.material.nu && a.material.t === b.material.t;
}

/** Qué recupera una partición: sus componentes en las muestras de la lámina y cuándo dos láminas son de la misma sección. */
interface CampoParticion {
  nombre: "flexion" | "membrana";
  /** Primera de sus componentes en las 8 de la lámina ([Nx, Ny, Nxy, Mx, My, Mxy, Qx, Qy]). */
  desde: number;
  /** Valores por muestra: los 3 que ajusta y, en flexión, el Qx, Qy de la DKMQ (para los nudos degradados). */
  nv: number;
  misma: (a: LaminaAnalitica, pa: LaminaPreparada, b: LaminaAnalitica, pb: LaminaPreparada) => boolean;
}

/** Flexión: M y Q. La misma sección si coinciden el material y m11, m22 y m12. */
const FLEXION: CampoParticion = {
  nombre: "flexion",
  desde: 3,
  nv: 5,
  misma: (a, pa, b, pb) => mismoMaterial(a, b) && mismosMultiplicadores(a, pa, b, pb, ["m11", "m22", "m12"]),
};

/** Membrana: N. La misma sección si coinciden el material, f11, f22 y f12 y las opciones de la membrana. */
const MEMBRANA: CampoParticion = {
  nombre: "membrana",
  desde: 0,
  nv: 3,
  misma: (a, pa, b, pb) =>
    mismoMaterial(a, b) &&
    (a.membrana?.gamma ?? 1) === (b.membrana?.gamma ?? 1) &&
    (a.membrana?.estabilizacion ?? 0) === (b.membrana?.estabilizacion ?? 0) &&
    mismosMultiplicadores(a, pa, b, pb, ["f11", "f22", "f12"]),
};

/**
 * Una partición de las láminas deformables en regiones SPR, para un campo (flexión o membrana): sus
 * regiones, las plazas (un valor por nudo y región), los parches y el plan de cada plaza. Lo que no
 * depende de u.
 */
export class ParticionCampos {
  readonly campo: CampoParticion;
  readonly regiones: RegionCampos[] = [];
  /** Región de cada lámina (−1: fuera de las regiones). */
  readonly regionDe: Int32Array;
  /** Plaza (nudo de una región) de cada nudo de cada lámina: 4 por lámina (−1 si la lámina no está en ninguna región). */
  readonly plazas: Int32Array;
  /** Nudo y región de cada plaza. */
  readonly nudoDePlaza: Int32Array;
  readonly regionDePlaza: Int32Array;
  /** Láminas de cada plaza (CSR). */
  private readonly ptrPlaza: Uint32Array;
  private readonly lamPlaza: Uint32Array;
  /** ¿Está la plaza en el borde de su región? */
  readonly borde: Uint8Array;
  /** Coordenadas de cada plaza en el triedro de su región. */
  readonly xyPlaza: Float64Array;
  /** Por lámina: cambio de sus ejes a los de su región: A (2×2 por filas, A_ij = s_i·e_j) y σ₃ = s₃·e₃. */
  readonly cambio: Float64Array;
  private readonly planes: (PlanNudo | undefined)[] = [];
  private readonly parchesCentro: (Parche | null | undefined)[] = [];
  private readonly modelo: ModeloAnalitico;
  private readonly geo: Geometria;
  private readonly base: Base;
  private readonly muestreo: MuestreoSpr;

  constructor(campo: CampoParticion, modelo: ModeloAnalitico, geo: Geometria, laminas: readonly (LaminaPreparada | undefined)[], deformable: Uint8Array, porLado: ReadonlyMap<number, number[]>, base: Base, muestreo: MuestreoSpr) {
    this.campo = campo;
    this.modelo = modelo;
    this.geo = geo;
    this.base = base;
    this.muestreo = muestreo;
    const lista = modelo.laminas ?? [];
    const nl = lista.length;
    const nn = modelo.nudos.length;
    const { xyz } = geo;

    // Regiones: unión por lados compartidos entre láminas compatibles
    const padre = Int32Array.from({ length: nl }, (_, i) => i);
    const raiz = (a: number): number => {
      while (padre[a] !== a) {
        padre[a] = padre[padre[a]!]!;
        a = padre[a]!;
      }
      return a;
    };
    const compatibles = (a: number, b: number) => {
      const pa = laminas[a]!;
      const pb = laminas[b]!;
      const c = pa.R[6]! * pb.R[6]! + pa.R[7]! * pb.R[7]! + pa.R[8]! * pb.R[8]!;
      if (Math.sqrt(Math.max(0, 1 - c * c)) > SENO_COPLANAR) return false;
      return campo.misma(lista[a]!, pa, lista[b]!, pb);
    };
    for (const q of porLado.values()) {
      for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) if (compatibles(q[i]!, q[j]!)) padre[raiz(q[i]!)] = raiz(q[j]!);
    }
    this.regionDe = new Int32Array(nl).fill(-1);
    const deRaiz = new Map<number, number>();
    lista.forEach((_, k) => {
      if (!deformable[k]) return;
      const r = raiz(k);
      let g = deRaiz.get(r);
      if (g === undefined) {
        g = this.regiones.length;
        deRaiz.set(r, g);
        const pl = laminas[k]!;
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
    // (la clave de un lado, min·np + max: un número exacto, sin crear textos)
    const usoLado = new Map<number, number>();
    for (let k = 0; k < nl; k++) {
      if (this.regionDe[k]! < 0) continue;
      for (let a = 0; a < 4; a++) {
        const u = this.plazas[4 * k + a]!;
        const v = this.plazas[4 * k + ((a + 1) % 4)]!;
        const clave = u < v ? u * np + v : v * np + u;
        usoLado.set(clave, (usoLado.get(clave) ?? 0) + 1);
      }
    }
    for (const [clave, n] of usoLado) {
      if (n !== 1) continue;
      this.borde[Math.floor(clave / np)] = 1;
      this.borde[clave % np] = 1;
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
      const E = laminas[k]!.R;
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

  /** Triedro de la región de la lámina k. */
  triedro(k: number): Float64Array {
    return this.regiones[this.regionDe[k]!]!.R;
  }

  /** Primera lámina de la plaza p y la posición del nudo en ella. */
  laminaDePlaza(p: number): [number, number] {
    const k = this.lamPlaza[this.ptrPlaza[p]!]!;
    for (let a = 0; a < 4; a++) if (this.plazas[4 * k + a] === p) return [k, a];
    throw new Error("CamposLaminas: plaza sin lámina");
  }

  /** Coordenadas (en el triedro de la región `g`) del punto global X. */
  private coordenadas(g: number, X: ArrayLike<number>): [number, number] {
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
    return this.coordenadas(this.regionDe[k]!, X);
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

  /**
   * Constante de Lebesgue en la plaza p de la media de unos parches: Λ = Σ|wₛ|, con el valor del
   * nudo Σ wₛ·vₛ sobre sus muestras. |valor| ≤ Λ·máx|vₛ|: lo que puede salirse del rango de las muestras.
   */
  private lebesgue(p: number, parches: readonly Parche[]): number {
    const x = this.xyPlaza[2 * p]!;
    const y = this.xyPlaza[2 * p + 1]!;
    const w = new Map<number, number>();
    for (const c of parches) {
      const n = c.base.n;
      const z = new Float64Array(n);
      c.base.p((x - c.x) / c.h, (y - c.y) / c.h, z);
      resolverCholesky(c.L, n, z, 1);
      for (let s = 0; s < c.muestras.length; s++) {
        let ws = 0;
        for (let j = 0; j < n; j++) ws += c.p[n * s + j]! * z[j]!;
        const m = c.muestras[s]!;
        w.set(m, (w.get(m) ?? 0) + ws / parches.length);
      }
    }
    let l = 0;
    for (const v of w.values()) l += Math.abs(v);
    return l;
  }

  /** Constante de Lebesgue del ajuste de la plaza p (≤ LEBESGUE_MAXIMO, o 1 con la media de sus muestras). */
  lebesgueEn(p: number): number {
    return this.lebesgue(p, this.plan(p).parches);
  }

  /** Cómo se calcula el valor de la plaza p. */
  plan(p: number): PlanNudo {
    let pl = this.planes[p];
    if (pl) return pl;
    const estable = (ps: readonly Parche[]) => ps.length > 0 && this.lebesgue(p, ps) <= LEBESGUE_MAXIMO;
    let parches: Parche[] = [];
    const propio = this.centro(p);
    if (propio) {
      if (estable([propio])) parches = [propio];
    } else {
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
      // Si su media amplifica de más, sólo los que no lo hacen en p
      if (parches.length && !estable(parches)) {
        parches = parches.filter((c) => estable([c]));
        if (!estable(parches)) parches = [];
      }
    }
    let degradado = false;
    let qDkmq = false;
    if (!parches.length) {
      // Sin parches interiores estables: el propio, con la mayor base que admita sin amplificar de más
      for (const b of [this.base, BASES.bilineal, BASES.lineal, "1d-cuadratica", "1d-lineal"] as const) {
        const c = this.parche(p, b);
        if (c && estable([c])) {
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
}

export class CamposLaminas implements IntegradorCampos {
  readonly modelo: ModeloAnalitico;
  readonly geo: Geometria;
  /** Partición de M y Q (la que exponen `regiones`, `region`, `plazas`, `lebesgueEn`…). */
  readonly flexion: ParticionCampos;
  /** Partición de N. */
  readonly membrana: ParticionCampos;
  private readonly laminas: (LaminaPreparada | undefined)[] = [];
  /** ¿Se deforma la lámina (no tiene sus 4 nudos en un mismo enlace rígido)? Igual en las dos particiones. */
  private readonly deformable: Uint8Array;
  private libres: Set<string> | null = null;
  private porLado: Map<string, number[]> | null = null;
  /** Índice espacial de las láminas, para los cortes (C5, criterio 8). */
  private indice: IndiceCajas | null = null;
  /** Evaluadores de los cortes por desplazamientos: se reutilizan entre cortes con sus cachés. */
  private readonly deCortes = new WeakMap<object, EvaluadorCampos>();
  /** Operadores de resultantes de las últimas láminas evaluadas (`_operador`). */
  private readonly operadores = new Map<number, Float64Array>();

  constructor(modelo: ModeloAnalitico, opciones: OpcionesCampos = {}) {
    this.modelo = modelo;
    const base = BASES[opciones.base ?? "cuadratica"];
    const muestreo = opciones.muestreo ?? "centroides";
    this.geo = geometria(modelo);
    const diag = new Diagnosticos();
    const lista = modelo.laminas ?? [];
    lista.forEach((l, k) => {
      this.laminas[k] = prepararLamina(l, k, this.geo, diag) ?? undefined;
    });
    if (diag.hayErrores) throw new Error(`CamposLaminas: el modelo tiene errores (${diag.lista[0]!.mensaje}); calcúlalo antes con calcular()`);
    const nl = lista.length;

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
    this.deformable = new Uint8Array(nl);
    lista.forEach((_, k) => {
      if (this.laminas[k] && !rigida[k]) this.deformable[k] = 1;
    });

    // Lados compartidos entre láminas deformables, para unir las regiones de las dos particiones
    // (la clave de un lado, min·nn + max: un número exacto, sin crear textos; el orden de la unión es
    // el de inserción, como antes)
    const nn = modelo.nudos.length;
    const porLado = new Map<number, number[]>();
    lista.forEach((l, k) => {
      if (!this.deformable[k]) return;
      for (let a = 0; a < 4; a++) {
        const u = l.nudos[a]!;
        const v = l.nudos[(a + 1) % 4]!;
        const clave = u < v ? u * nn + v : v * nn + u;
        let q = porLado.get(clave);
        if (!q) porLado.set(clave, (q = []));
        q.push(k);
      }
    });
    this.flexion = new ParticionCampos(FLEXION, modelo, this.geo, this.laminas, this.deformable, porLado, base, muestreo);
    this.membrana = new ParticionCampos(MEMBRANA, modelo, this.geo, this.laminas, this.deformable, porLado, base, muestreo);
  }

  /** Regiones de la partición de flexión. */
  get regiones(): RegionCampos[] {
    return this.flexion.regiones;
  }

  /** Región (de flexión) de la lámina l (−1 si no entra en ninguna: rígida; igual en las dos particiones). */
  region(l: number): number {
    return this.flexion.region(l);
  }

  /** Plazas de la partición de flexión: 4 por lámina (−1 si la lámina no está en ninguna región). */
  get plazas(): Int32Array {
    return this.flexion.plazas;
  }

  /** Nudo y región de cada plaza de flexión. */
  get nudoDePlaza(): Int32Array {
    return this.flexion.nudoDePlaza;
  }

  get regionDePlaza(): Int32Array {
    return this.flexion.regionDePlaza;
  }

  /** Número de plazas (nudos de región) de la partición de flexión. */
  get nPlazas(): number {
    return this.flexion.nPlazas;
  }

  /** Constante de Lebesgue del ajuste de la plaza p de flexión (≤ LEBESGUE_MAXIMO, o 1 con la media de sus muestras). */
  lebesgueEn(p: number): number {
    return this.flexion.lebesgueEn(p);
  }

  /** Evaluador de los campos de unos desplazamientos `u` (6 por nudo), con sus cachés. */
  evaluador(u: ArrayLike<number>): EvaluadorCampos {
    return new EvaluadorCampos(this, u);
  }

  /**
   * El evaluador de `u` que comparten los cortes y quien lo pida (los mapas de A4): lo que uno ya
   * recuperó lo reutilizan los demás, con los mismos valores. Uno por objeto `u`.
   */
  evaluadorCompartido(u: ArrayLike<number>): EvaluadorCampos {
    let ev = this.deCortes.get(u as object);
    if (!ev) this.deCortes.set(u as object, (ev = this.evaluador(u)));
    return ev;
  }

  /** Valores nodales (8 por plaza de flexión, en el triedro de su región) de todas las plazas. */
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

  /**
   * ¿Comparte el lado (u, v) con la lámina k otra lámina coplanaria que esté en alguna región? (la
   * de su otro lado en la misma superficie: un muro que cuelgue del lado no cuenta).
   */
  private vecinaEnRegion(u: number, v: number, k: number): boolean {
    if (!this.porLado) {
      this.porLado = new Map();
      (this.modelo.laminas ?? []).forEach((l, i) => {
        for (let a = 0; a < 4; a++) {
          const p = l.nudos[a]!;
          const q = l.nudos[(a + 1) % 4]!;
          const c = p < q ? `${p},${q}` : `${q},${p}`;
          let lista = this.porLado!.get(c);
          if (!lista) this.porLado!.set(c, (lista = []));
          lista.push(i);
        }
      });
    }
    const nk = this.laminas[k]!.R;
    return (this.porLado.get(u < v ? `${u},${v}` : `${v},${u}`) ?? []).some((i) => {
      if (i === k || !this.deformable[i]) return false;
      const ni = this.laminas[i]!.R;
      return Math.abs(ni[6]! * nk[6]! + ni[7]! * nk[7]! + ni[8]! * nk[8]!) >= 1 - 1e-6;
    });
  }

  /**
   * Lados de lámina libres: en el borde de su región, sin otra lámina ni barra que los comparta y
   * sin apoyo, muelle ni enlace rígido en sus nudos. Claves «u,v» con u < v.
   */
  private bordesLibres(): Set<string> {
    if (this.libres) return this.libres;
    const clave = (u: number, v: number) => (u < v ? `${u},${v}` : `${v},${u}`);
    const usos = new Map<string, number>();
    const enRegion = new Map<string, number>();
    (this.modelo.laminas ?? []).forEach((l, k) => {
      for (let a = 0; a < 4; a++) {
        const c = clave(l.nudos[a]!, l.nudos[(a + 1) % 4]!);
        usos.set(c, (usos.get(c) ?? 0) + 1);
        if (this.deformable[k]) enRegion.set(c, (enRegion.get(c) ?? 0) + 1);
      }
    });
    const barras = new Set((this.modelo.barras ?? []).map((b) => clave(b.nudos[0], b.nudos[1])));
    const atados = new Set<number>();
    for (const a of this.modelo.apoyos ?? []) if (a.coartados.some(Boolean)) atados.add(a.nudo);
    for (const m of this.modelo.muelles ?? []) for (const v of m.nudos) atados.add(v);
    for (const r of this.modelo.restricciones ?? []) if (r.tipo === "enlace-rigido") for (const v of [r.maestro, ...r.esclavos]) atados.add(v);
    this.libres = new Set<string>();
    for (const [c, n] of enRegion) {
      if (n !== 1 || usos.get(c) !== 1 || barras.has(c)) continue;
      const [u, v] = c.split(",").map(Number);
      if (!atados.has(u!) && !atados.has(v!)) this.libres.add(c);
    }
    return this.libres;
  }

  /** Índice espacial de las láminas (su caja con la holgura de los cortes), la primera vez que se pide. */
  private indiceLaminas(): IndiceCajas {
    if (this.indice) return this.indice;
    const lista = this.modelo.laminas ?? [];
    const cajas = new Float64Array(6 * lista.length);
    const diametros: number[] = [];
    lista.forEach((l, k) => {
      cajas.set(cajaDe(this.geo.xyz, l.nudos, [], false, TOL_CORTE), 6 * k);
      const b = cajaDe(this.geo.xyz, l.nudos);
      diametros.push(Math.sqrt((b[3]! - b[0]!) ** 2 + (b[4]! - b[1]!) ** 2 + (b[5]! - b[2]!) ** 2));
    });
    this.indice = new IndiceCajas(cajas, ladoIndice(diametros, this.geo.tamano));
    return this.indice;
  }

  /**
   * Método «campos» de los cortes (IntegradorCampos), para las láminas que atraviesan el plano:
   * integra a lo largo de su intersección con el plano la fuerza y el momento por unidad de longitud
   * que el lado B ejerce sobre el A, f = N·ν + (Q·ν)·e₃ y m = (M·ν) × e₃, con ν la normal al corte
   * en el plano de la lámina (hacia +x) y e₃ la normal de su región, con Gauss de 4 puntos por
   * tramo. Si un tramo acaba en un borde libre, añade allí la fuerza de borde de Kirchhoff ±Mxy·e₃
   * (en los ejes de la franja): el Mxy recuperado no se anula en el borde, mientras que el de la
   * lámina real cae a cero en una capa de anchura ~t que concentra ese cortante. Los lados de lámina
   * sobre el plano se integran sólo con `lados` (corte mixto, C2-2), cada uno una vez (con la lámina
   * del lado A o, si ésa es rígida o no existe, la del B); si no, los da cortes.ts por fuerzas
   * nodales y aquí sólo se muestrean. Las láminas rígidas no entran: lo que pasa por ellas lo
   * transmite su enlace. El marco de cada punto (ν, t, e₃) sale de la región de flexión; N se toma
   * con sus componentes en el triedro de la región de membrana.
   */
  integrar(cp: CortePreparado, casos: readonly ResultadoCaso[], info: InfoCorte, diag: Diagnosticos, lados = false): { suma: Float64Array; muestras: MuestrasCorte } {
    const { xyz } = this.geo;
    const ex = [cp.ejes[0]!, cp.ejes[1]!, cp.ejes[2]!];
    const ey = [cp.ejes[3]!, cp.ejes[4]!, cp.ejes[5]!];
    const ez = [cp.ejes[6]!, cp.ejes[7]!, cp.ejes[8]!];
    const pr = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    const cruz = (a: ArrayLike<number>, b: ArrayLike<number>) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
    const libres = this.bordesLibres();
    const claveLado = (l: LaminaAnalitica, e: number) => {
      const u = l.nudos[e]!;
      const v = l.nudos[(e + 1) % 4]!;
      return u < v ? `${u},${v}` : `${v},${u}`;
    };
    // 1. Tramos: intersección del plano con cada lámina, recortada al rectángulo
    interface Tramo {
      k: number;
      A: number[];
      B: number[];
      /** Atraviesa la lámina; si no, es un lado sobre el plano. */
      cruza: boolean;
      /** Se integra: atraviesa, o es un lado sobre el plano de un corte mixto. */
      integra: boolean;
      /** ¿Acaba A (o B) en un borde libre? */
      libreA: boolean;
      libreB: boolean;
    }
    const tramos: Tramo[] = [];
    const ext = { y: [Infinity, -Infinity] as [number, number], z: [Infinity, -Infinity] as [number, number] };
    // Sólo las láminas que pueden cortar el rectángulo (índice espacial), en el orden del modelo
    const caja = cajaCorte(cp);
    const todas = this.modelo.laminas ?? [];
    this.indiceLaminas().buscar(caja.min, caja.max).forEach((k) => {
      const l = todas[k]!;
      if (!this.deformable[k]) return;
      const X = l.nudos.map((v) => xyz.subarray(3 * v, 3 * v + 3));
      const d = X.map((p) => {
        const s = cp.coordenadas(p)[0];
        return Math.abs(s) <= TOL_CORTE ? 0 : s;
      });
      const neg = d.filter((s) => s < 0).length;
      const pos = d.filter((s) => s > 0).length;
      const cer = 4 - neg - pos;
      // Puntos de corte con los lados en los que están (un vértice está en dos)
      let P: { x: number[]; lados: number[] }[] = [];
      const cruza = neg > 0 && pos > 0;
      if (cruza) {
        for (let a = 0; a < 4; a++) {
          const b = (a + 1) % 4;
          if (d[a] === 0) P.push({ x: [...X[a]!], lados: [(a + 3) % 4, a] });
          else if (d[a]! * d[b]! < 0) {
            const t = d[a]! / (d[a]! - d[b]!);
            P.push({ x: [0, 1, 2].map((c) => X[a]![c]! + t * (X[b]![c]! - X[a]![c]!)), lados: [a] });
          }
        }
      } else if (cer === 2 && (pos === 0 || neg === 0)) {
        // Un lado sobre el plano: lo muestrea la lámina del lado A o, si ésa no está en ninguna región
        // (la huella de un pilar) o no existe, la del lado B
        for (let a = 0; a < 4; a++) {
          if (d[a] !== 0 || d[(a + 1) % 4] !== 0) continue;
          if (neg === 0 && this.vecinaEnRegion(l.nudos[a]!, l.nudos[(a + 1) % 4]!, k)) break;
          // Sus extremos están en los lados contiguos (para los bordes libres de un corte mixto)
          P = [{ x: [...X[a]!], lados: [(a + 3) % 4] }, { x: [...X[(a + 1) % 4]!], lados: [(a + 1) % 4] }];
        }
      }
      if (P.length < 2) return;
      if (P.length > 2) {
        // Por redondeo: los dos más alejados
        let mejor: [number, number] = [0, 1];
        let dm = -1;
        for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
          const dd = Math.hypot(P[i]!.x[0]! - P[j]!.x[0]!, P[i]!.x[1]! - P[j]!.x[1]!, P[i]!.x[2]! - P[j]!.x[2]!);
          if (dd > dm) [dm, mejor] = [dd, [i, j]];
        }
        P = [P[mejor[0]]!, P[mejor[1]]!];
      }
      // Recorte al rectángulo: y(t), z(t) lineales en el tramo
      const [, ya, za] = cp.coordenadas(P[0]!.x);
      const [, yb, zb] = cp.coordenadas(P[1]!.x);
      let t0 = 0;
      let t1 = 1;
      for (const [va, vb, [lo, hi]] of [
        [ya, yb, cp.y],
        [za, zb, cp.z],
      ] as const) {
        const dv = vb - va;
        if (Math.abs(dv) < 1e-15) {
          if (va < lo - TOL_CORTE || va > hi + TOL_CORTE) t1 = -1;
          continue;
        }
        let ta = (lo - TOL_CORTE - va) / dv;
        let tb = (hi + TOL_CORTE - va) / dv;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
      }
      const L = Math.hypot(P[1]!.x[0]! - P[0]!.x[0]!, P[1]!.x[1]! - P[0]!.x[1]!, P[1]!.x[2]! - P[0]!.x[2]!);
      if (!((t1 - t0) * L > 10 * TOL_CORTE)) return;
      const en = (t: number) => [0, 1, 2].map((c) => P[0]!.x[c]! + t * (P[1]!.x[c]! - P[0]!.x[c]!));
      const esLibre = (q: { lados: number[] }) => q.lados.some((e) => libres.has(claveLado(l, e)));
      const integra = cruza || lados;
      // Partido en los quiebres del corte que caen dentro (los bordes de las franjas, F)
      const ta = Math.max(0, t0);
      const tb = Math.min(1, t1);
      const partes = [ta];
      const qs = cp.corte.quiebres;
      if (qs?.length && Math.abs(yb - ya) > 1e-15) partes.push(...qs.map((q) => (q - ya) / (yb - ya)).filter((t) => (t - ta) * L > 10 * TOL_CORTE && (tb - t) * L > 10 * TOL_CORTE).sort((x, y) => x - y));
      partes.push(tb);
      const primero = tramos.length;
      for (let i = 0; i + 1 < partes.length; i++) {
        const ultimo = i + 2 === partes.length;
        tramos.push({ k, A: en(partes[i]!), B: en(partes[i + 1]!), cruza, integra, libreA: i === 0 && integra && t0 <= 0 && esLibre(P[0]!), libreB: ultimo && integra && t1 >= 1 && esLibre(P[1]!) });
      }
      if (integra) info.laminas.push(k);
      for (const q of [tramos[primero]!.A, tramos.at(-1)!.B]) {
        const [, cy, cz] = cp.coordenadas(q);
        ext.y = [Math.min(ext.y[0], cy), Math.max(ext.y[1], cy)];
        ext.z = [Math.min(ext.z[0], cz), Math.max(ext.z[1], cz)];
      }
    });
    if (tramos.length) info.extension = ext;

    // 2. Puntos de integración, ejes de franja y extremos libres (no dependen del caso)
    const [GS, GW] = cp.corte.cuadratura === 2 ? [GL2_S, GL2_W] : [GL4_S, GL4_W];
    const npt = GS.length;
    const ns = npt * tramos.length;
    const m: MuestrasCorte = {
      laminas: new Int32Array(ns),
      puntos: new Float64Array(3 * ns),
      yz: new Float64Array(2 * ns),
      pesos: new Float64Array(ns),
      ejes: new Float64Array(9 * ns),
      valores: [],
    };
    const natural = new Float64Array(2 * ns);
    /** Por punto: ν y t = n × ν en el triedro de la región de flexión y σ = n·s₃. */
    const marco = new Float64Array(5 * ns);
    /** Por punto: ν y t en el triedro de la región de membrana. */
    const marcoM = new Float64Array(4 * ns);
    const naturales = (k: number, P: ArrayLike<number>): [number, number] => {
      const pl = this.laminas[k]!;
      const d = [P[0]! - pl.origen[0]!, P[1]! - pl.origen[1]!, P[2]! - pl.origen[2]!];
      const nat = coordenadasNaturales(pl.xy, pr(d, pl.R.subarray(0, 3)), pr(d, pl.R.subarray(3, 6)));
      return [Math.min(1, Math.max(-1, nat?.[0] ?? 0)), Math.min(1, Math.max(-1, nat?.[1] ?? 0))];
    };
    /** Extremos libres: lámina, punto, coordenadas naturales, signo del extremo, marco y normal n. */
    const extremos: { k: number; P: number[]; nat: [number, number]; s: number; marco: number[]; n: number[] }[] = [];
    tramos.forEach(({ k, A, B, integra, libreA, libreB }, i) => {
      const Rf = this.flexion.triedro(k);
      const Rm = this.membrana.triedro(k);
      const s1 = Rf.subarray(0, 3);
      const s2 = Rf.subarray(3, 6);
      const s3 = Rf.subarray(6, 9);
      const L = Math.hypot(B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!);
      const dir = [0, 1, 2].map((c) => (B[c]! - A[c]!) / L);
      let nu = cruz(s3, dir);
      if (pr(nu, ex) < 0) nu = nu.map((c) => -c);
      // Normal de la franja: hacia z del corte; si es perpendicular, hacia y; si no, hacia x
      const zs = pr(s3, ez);
      const ys = pr(s3, ey);
      const sigma = Math.abs(zs) > 1e-9 ? Math.sign(zs) : Math.abs(ys) > 1e-9 ? Math.sign(ys) : Math.sign(pr(s3, ex)) || 1;
      const n = [0, 1, 2].map((c) => sigma * s3[c]!);
      const t = cruz(n, nu);
      const mr = [pr(nu, s1), pr(nu, s2), pr(t, s1), pr(t, s2), sigma];
      const mrM = [pr(nu, Rm.subarray(0, 3)), pr(nu, Rm.subarray(3, 6)), pr(t, Rm.subarray(0, 3)), pr(t, Rm.subarray(3, 6))];
      for (let q = 0; q < npt; q++) {
        const j = npt * i + q;
        const P = [0, 1, 2].map((c) => A[c]! + GS[q]! * (B[c]! - A[c]!));
        m.laminas[j] = k;
        m.puntos.set(P, 3 * j);
        const [, cy, cz] = cp.coordenadas(P);
        m.yz.set([cy, cz], 2 * j);
        m.pesos[j] = GW[q]! * L;
        m.ejes.set([...nu, ...t, ...n], 9 * j);
        natural.set(naturales(k, P), 2 * j);
        marco.set(mr, 5 * j);
        marcoM.set(mrM, 4 * j);
      }
      if (!integra) return;
      // Signo del extremo: + en el que está más adelante según t
      const st = pr(dir, t) >= 0 ? 1 : -1;
      if (libreA) extremos.push({ k, P: A, nat: naturales(k, A), s: -st, marco: mr, n });
      if (libreB) extremos.push({ k, P: B, nat: naturales(k, B), s: st, marco: mr, n });
    });

    // 3. Por caso: campos en cada punto, fuerza y momento de los tramos que atraviesan
    const nc = casos.length;
    const suma = new Float64Array(6 * nc);
    const O = cp.origen;
    let degradadas = 0;
    /** Mxy en los ejes de franja (de ν y t con σ) a partir de los valores en el triedro de la región. */
    const mxyFranja = (v: ArrayLike<number>, mr: readonly number[]) => {
      const [nx, ny, tx, ty, sg] = mr;
      const b11 = nx! * v[3]! + ny! * v[5]!;
      const b12 = nx! * v[5]! + ny! * v[4]!;
      return sg! * (b11 * tx! + b12 * ty!);
    };
    const agregar = (o: number, P: ArrayLike<number>, f: ArrayLike<number>, mm: ArrayLike<number>, w: number) => {
      const rx = P[0]! - O[0]!;
      const ry = P[1]! - O[1]!;
      const rz = P[2]! - O[2]!;
      suma[o]! += w * f[0]!;
      suma[o + 1]! += w * f[1]!;
      suma[o + 2]! += w * f[2]!;
      suma[o + 3]! += w * (mm[0]! + ry * f[2]! - rz * f[1]!);
      suma[o + 4]! += w * (mm[1]! + rz * f[0]! - rx * f[2]!);
      suma[o + 5]! += w * (mm[2]! + rx * f[1]! - ry * f[0]!);
    };
    /** T' = B·T·Bᵀ con B = [ν; t], por s, en out[o…o+2]. */
    const girar = (out: Float64Array, o: number, xx: number, yy: number, xy: number, s: number, nx: number, ny: number, tx: number, ty: number) => {
      const b11 = nx * xx + ny * xy;
      const b12 = nx * xy + ny * yy;
      const b21 = tx * xx + ty * xy;
      const b22 = tx * xy + ty * yy;
      out[o] = s * (b11 * nx + b12 * ny);
      out[o + 1] = s * (b21 * tx + b22 * ty);
      out[o + 2] = s * (b11 * tx + b12 * ty);
    };
    casos.forEach((r, kc) => {
      // El evaluador de estos desplazamientos, con lo que ya calcularon los cortes anteriores (los
      // mismos valores); cuenta las plazas degradadas que usa este corte
      const ev = this.evaluadorCompartido(r.u);
      ev.empezar();
      const val = new Float64Array(8 * ns);
      const pts = m.puntos;
      // Sin crear arrays por punto (los cortes de las franjas piden cientos de miles): las mismas
      // cuentas, en el mismo orden, que con vectores
      for (let j = 0; j < ns; j++) {
        const k = m.laminas[j]!;
        const R = this.flexion.triedro(k);
        const RM = this.membrana.triedro(k);
        const v = ev.enRegiones(k, natural[2 * j]!, natural[2 * j + 1]!);
        const nx = marco[5 * j]!;
        const ny = marco[5 * j + 1]!;
        const tx = marco[5 * j + 2]!;
        const ty = marco[5 * j + 3]!;
        const sg = marco[5 * j + 4]!;
        const nxM = marcoM[4 * j]!;
        const nyM = marcoM[4 * j + 1]!;
        const Qn = v[6]! * nx + v[7]! * ny;
        if (tramos[(j / npt) | 0]!.integra) {
          // Tracción en los triedros de las regiones: N·ν (membrana), Q·ν y M·ν (flexión);
          // m = (M·ν) × e₃ = (Mν)_y·s₁ − (Mν)_x·s₂
          const Nn0 = v[0]! * nxM + v[2]! * nyM;
          const Nn1 = v[2]! * nxM + v[1]! * nyM;
          const Mn0 = v[3]! * nx + v[5]! * ny;
          const Mn1 = v[5]! * nx + v[4]! * ny;
          const f0 = Nn0 * RM[0]! + Nn1 * RM[3]! + Qn * R[6]!;
          const f1 = Nn0 * RM[1]! + Nn1 * RM[4]! + Qn * R[7]!;
          const f2 = Nn0 * RM[2]! + Nn1 * RM[5]! + Qn * R[8]!;
          const m0 = Mn1 * R[0]! - Mn0 * R[3]!;
          const m1 = Mn1 * R[1]! - Mn0 * R[4]!;
          const m2 = Mn1 * R[2]! - Mn0 * R[5]!;
          const w = m.pesos[j]!;
          const o = 6 * kc;
          const rx = pts[3 * j]! - O[0]!;
          const ry = pts[3 * j + 1]! - O[1]!;
          const rz = pts[3 * j + 2]! - O[2]!;
          suma[o]! += w * f0;
          suma[o + 1]! += w * f1;
          suma[o + 2]! += w * f2;
          suma[o + 3]! += w * (m0 + ry * f2 - rz * f1);
          suma[o + 4]! += w * (m1 + rz * f0 - rx * f2);
          suma[o + 5]! += w * (m2 + rx * f1 - ry * f0);
        }
        // Valores en los ejes de franja: T' = B·T·Bᵀ con B = [ν; t] (M y Q, con σ)
        girar(val, 8 * j, v[0]!, v[1]!, v[2]!, 1, nxM, nyM, marcoM[4 * j + 2]!, marcoM[4 * j + 3]!);
        girar(val, 8 * j + 3, v[3]!, v[4]!, v[5]!, sg, nx, ny, tx, ty);
        val[8 * j + 6] = sg * Qn;
        val[8 * j + 7] = sg * (v[6]! * tx + v[7]! * ty);
      }
      // Fuerza de borde de Kirchhoff en los extremos libres: ±Mxy·n
      for (const e of extremos) {
        const v = ev.enRegiones(e.k, e.nat[0], e.nat[1]);
        const fk = e.s * mxyFranja(v, e.marco);
        agregar(6 * kc, e.P, e.n.map((c) => fk * c), [0, 0, 0], 1);
      }
      m.valores.push(val);
      degradadas = Math.max(degradadas, ev.usadasDegradadas);
    });
    if (degradadas) {
      const ids = [...new Set(tramos.map((t) => this.modelo.laminas![t.k]!.id))];
      diag.aviso(
        "corte/campos-degradados",
        `El corte ${cp.corte.id ?? "(sin id)"} usa ${degradadas} nudos con campos degradados (una sola fila de láminas: no se puede ajustar un polinomio en dos direcciones; ${listaIds(ids)}). Su Q es aproximado.`,
        [cp.corte.id ?? "(sin id)", ...ids],
      );
    }
    return { suma, muestras: m };
  }

  // Acceso para el evaluador
  /** @internal */ _lamina(k: number): LaminaPreparada | undefined {
    return this.laminas[k];
  }
  /**
   * @internal Operador de resultantes de la lámina k (768): no depende del caso, así que los
   * evaluadores de los casos de un mismo corte lo comparten. Se guardan los últimos que se piden.
   */
  _operador(k: number): Float64Array {
    let op = this.operadores.get(k);
    if (op) return op;
    if (this.operadores.size >= OPERADORES_GUARDADOS) this.operadores.clear();
    const pl = this.laminas[k]!;
    op = new Float64Array(768);
    operadorResultantes(pl.xy, pl.seccion, op);
    this.operadores.set(k, op);
    return op;
  }
}

/** Operadores de resultantes que guarda CamposLaminas (6 KB cada uno). */
const OPERADORES_GUARDADOS = 2048;

/** Los valores de una partición para unos desplazamientos: sus muestras por lámina, los coeficientes de sus parches y el valor de sus plazas. */
class EvaluadorParticion {
  readonly part: ParticionCampos;
  /** Muestras de cada lámina en el triedro de su región: 5 × nv (arrays: los cortes de un edificio piden decenas de miles). */
  readonly muestras: (Float64Array | undefined)[];
  private readonly coef = new Map<Parche, Float64Array>();
  private readonly valores: (Float64Array | undefined)[];
  /** Plazas degradadas (sin derivadas: Q de la DKMQ) que ha evaluado. */
  degradadas = 0;
  /** Plazas degradadas usadas desde `empezar`. */
  usadas: Set<number> | null = null;

  constructor(part: ParticionCampos, nl: number) {
    this.part = part;
    this.muestras = new Array(nl);
    this.valores = new Array(part.nPlazas);
  }

  /** Coeficientes del polinomio de un parche (base.n × 3). */
  private coeficientes(c: Parche, muestrasDe: (k: number) => Float64Array): Float64Array {
    let a = this.coef.get(c);
    if (a) return a;
    const nv = this.part.campo.nv;
    const n = c.base.n;
    a = new Float64Array(n * NC);
    for (let s = 0; s < c.muestras.length; s++) {
      const m = c.muestras[s]!;
      const vg = muestrasDe(Math.floor(m / MUESTRAS_LAMINA));
      const o = nv * (m % MUESTRAS_LAMINA);
      for (let i = 0; i < n; i++) {
        const pi = c.p[n * s + i]!;
        for (let q = 0; q < NC; q++) a[NC * i + q]! += pi * vg[o + q]!;
      }
    }
    resolverCholesky(c.L, n, a, NC);
    this.coef.set(c, a);
    return a;
  }

  /** Valores de la plaza p (nv, en el triedro de su región): las 3 componentes ajustadas y, en flexión, Q por equilibrio. */
  plaza(p: number, muestrasDe: (k: number) => Float64Array): Float64Array {
    const pl = this.part.plan(p);
    if (pl.degradado) this.usadas?.add(p);
    let v = this.valores[p];
    if (v) return v;
    const nv = this.part.campo.nv;
    v = new Float64Array(nv);
    const dx = new Float64Array(NC);
    const dy = new Float64Array(NC);
    const w = 1 / pl.parches.length;
    pl.parches.forEach((c, i) => {
      const a = this.coeficientes(c, muestrasDe);
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
    if (nv > NC) {
      if (pl.qDkmq) {
        // Q de la DKMQ (el del único centroide)
        const c = pl.parches[0]!;
        for (let s = 0; s < c.muestras.length; s++) {
          const vg = muestrasDe(Math.floor(c.muestras[s]! / MUESTRAS_LAMINA));
          v[3]! += vg[nv * CENTROIDE + 3]! / c.muestras.length;
          v[4]! += vg[nv * CENTROIDE + 4]! / c.muestras.length;
        }
      } else {
        // Qx = −(∂Mx/∂x + ∂Mxy/∂y), Qy = −(∂Mxy/∂x + ∂My/∂y)
        v[3] = -(dx[0]! + dy[2]!);
        v[4] = -(dx[2]! + dy[1]!);
      }
    }
    this.valores[p] = v;
    return v;
  }
}

/** Tensor (txx, tyy, txy) a la región: T' = A·T·Aᵀ (M con el signo s de la normal), en v desde o. */
function girarTensor(v: Float64Array, o: number, txx: number, tyy: number, txy: number, s: number, a11: number, a12: number, a21: number, a22: number): void {
  const b11 = a11 * txx + a12 * txy;
  const b12 = a11 * txy + a12 * tyy;
  const b21 = a21 * txx + a22 * txy;
  const b22 = a21 * txy + a22 * tyy;
  v[o] = s * (b11 * a11 + b12 * a12);
  v[o + 1] = s * (b21 * a21 + b22 * a22);
  v[o + 2] = s * (b11 * a21 + b12 * a22);
}

/** La muestra del centroide: la media de las de los 4 puntos de Gauss (nv valores cada una). */
function centroide(v: Float64Array, nv: number): void {
  for (let q = 0; q < nv; q++) v[nv * CENTROIDE + q] = 0.25 * (v[q]! + v[nv + q]! + v[2 * nv + q]! + v[3 * nv + q]!);
}

/** Valores de los campos para unos desplazamientos concretos, con cachés por lámina, parche y plaza. */
export class EvaluadorCampos {
  private readonly c: CamposLaminas;
  private readonly u: ArrayLike<number>;
  /** Las dos particiones: M y Q, y N. */
  private readonly flexion: EvaluadorParticion;
  private readonly membrana: EvaluadorParticion;
  private static readonly R = new Float64Array(8);
  private static readonly UG = new Float64Array(24);
  private static readonly UL = new Float64Array(24);
  private readonly muestrasFlexion = (k: number) => this.muestrasDe(k, this.flexion);
  private readonly muestrasMembrana = (k: number) => this.muestrasDe(k, this.membrana);

  /** Plazas degradadas de flexión (sin derivadas: Q de la DKMQ) que ha evaluado. */
  get degradadas(): number {
    return this.flexion.degradadas;
  }

  /** Empieza a contar las plazas degradadas que se usan (las ya calculadas también cuentan). */
  empezar(): void {
    this.flexion.usadas = new Set();
    this.membrana.usadas = new Set();
  }

  /** Plazas degradadas de flexión distintas usadas desde `empezar` (un corte que reutiliza el evaluador). */
  get usadasDegradadas(): number {
    return this.flexion.usadas?.size ?? 0;
  }

  constructor(campos: CamposLaminas, u: ArrayLike<number>) {
    this.c = campos;
    this.u = u;
    const nl = (campos.modelo.laminas ?? []).length;
    this.flexion = new EvaluadorParticion(campos.flexion, nl);
    this.membrana = new EvaluadorParticion(campos.membrana, nl);
  }

  /**
   * Muestras de la lámina k para la partición `e`, en el triedro de su región: 4 puntos de Gauss y
   * el centroide (su media), con nv valores cada una (N, o M y el Q de la DKMQ). Las dos particiones
   * se llenan a la vez, con los esfuerzos de la lámina calculados una sola vez.
   */
  private muestrasDe(k: number, e: EvaluadorParticion): Float64Array {
    const hecho = e.muestras[k];
    if (hecho) return hecho;
    const pl = this.c._lamina(k)!;
    const nudos = this.c.modelo.laminas![k]!.nudos;
    // Sin crear arrays más que los que se guardan (un mapa recorre decenas de miles de láminas por
    // caso): las mismas cuentas, en el mismo orden, que `vectorALocales` y los tensores girados
    const ug = EvaluadorCampos.UG;
    const ul = EvaluadorCampos.UL;
    for (let a = 0; a < 4; a++) for (let q = 0; q < 6; q++) ug[6 * a + q] = this.u[6 * nudos[a]! + q]!;
    const R = pl.R;
    for (let I = 0; I < 8; I++) {
      for (let a = 0; a < 3; a++) {
        let s = 0;
        for (let c = 0; c < 3; c++) s += R[3 * a + c]! * ug[3 * I + c]!;
        ul[3 * I + a] = s;
      }
    }
    const OP = this.c._operador(k);
    const r = EvaluadorCampos.R;
    const vf = new Float64Array(MUESTRAS_LAMINA * FLEXION.nv);
    const vm = new Float64Array(MUESTRAS_LAMINA * MEMBRANA.nv);
    const cf = this.flexion.part.cambio;
    const cm = this.membrana.part.cambio;
    const f11 = cf[5 * k]!;
    const f12 = cf[5 * k + 1]!;
    const f21 = cf[5 * k + 2]!;
    const f22 = cf[5 * k + 3]!;
    const fs3 = cf[5 * k + 4]!;
    const m11 = cm[5 * k]!;
    const m12 = cm[5 * k + 1]!;
    const m21 = cm[5 * k + 2]!;
    const m22 = cm[5 * k + 3]!;
    for (let g = 0; g < 4; g++) {
      for (let f = 0; f < NV; f++) {
        let s = 0;
        const o = 192 * g + 24 * f;
        for (let q = 0; q < 24; q++) s += OP[o + q]! * ul[q]!;
        r[f] = s;
      }
      girarTensor(vm, MEMBRANA.nv * g, r[0]!, r[1]!, r[2]!, 1, m11, m12, m21, m22);
      girarTensor(vf, FLEXION.nv * g, r[3]!, r[4]!, r[5]!, fs3, f11, f12, f21, f22);
      vf[FLEXION.nv * g + 3] = fs3 * (f11 * r[6]! + f12 * r[7]!);
      vf[FLEXION.nv * g + 4] = fs3 * (f21 * r[6]! + f22 * r[7]!);
    }
    centroide(vf, FLEXION.nv);
    centroide(vm, MEMBRANA.nv);
    this.flexion.muestras[k] = vf;
    this.membrana.muestras[k] = vm;
    return e.muestras[k]!;
  }

  /**
   * Valores de la plaza p de flexión (8, en el triedro de su región): N ajustado en la plaza de
   * membrana del mismo nudo (la de la primera lámina de p), M ajustado y Q por equilibrio. Si las
   * dos regiones tienen distinto triedro, N se gira al de flexión.
   */
  plaza(p: number): Float64Array {
    const v = new Float64Array(8);
    const vf = this.flexion.plaza(p, this.muestrasFlexion);
    v.set(vf, 3);
    const [k, a] = this.c.flexion.laminaDePlaza(p);
    const pm = this.c.membrana.plazas[4 * k + a]!;
    const vm = this.membrana.plaza(pm, this.muestrasMembrana);
    const Rf = this.c.flexion.triedro(k);
    const Rm = this.c.membrana.triedro(k);
    let iguales = true;
    for (let i = 0; i < 9 && iguales; i++) iguales = Rf[i] === Rm[i];
    if (iguales) v.set(vm, 0);
    else {
      // A_ij = sf_i · sm_j (en el plano): N_f = A·N_m·Aᵀ
      const pr = (i: number, j: number) => Rf[3 * i]! * Rm[3 * j]! + Rf[3 * i + 1]! * Rm[3 * j + 1]! + Rf[3 * i + 2]! * Rm[3 * j + 2]!;
      const [a11, a12, a21, a22] = [pr(0, 0), pr(0, 1), pr(1, 0), pr(1, 1)];
      const b11 = a11 * vm[0]! + a12 * vm[2]!;
      const b12 = a11 * vm[2]! + a12 * vm[1]!;
      const b21 = a21 * vm[0]! + a22 * vm[2]!;
      const b22 = a21 * vm[2]! + a22 * vm[1]!;
      v[0] = b11 * a11 + b12 * a12;
      v[1] = b21 * a21 + b22 * a22;
      v[2] = b11 * a21 + b12 * a22;
    }
    return v;
  }

  /**
   * Campos en (ξ, η) de la lámina k (interpolación bilineal de los nodales): N en el triedro de su
   * región de membrana; M y Q, en el de su región de flexión.
   */
  enRegiones(k: number, xi: number, eta: number): Float64Array {
    const N = funcionesForma(xi, eta);
    const out = new Float64Array(8);
    const pf = this.c.flexion.plazas;
    const pm = this.c.membrana.plazas;
    for (let a = 0; a < 4; a++) {
      const p = pf[4 * k + a]!;
      if (p < 0) throw new Error(`CamposLaminas: la lámina ${this.c.modelo.laminas![k]!.id} no está en ninguna región (es rígida)`);
      const vm = this.membrana.plaza(pm[4 * k + a]!, this.muestrasMembrana);
      for (let q = 0; q < 3; q++) out[q]! += N[a]! * vm[q]!;
      const vf = this.flexion.plaza(p, this.muestrasFlexion);
      for (let q = 0; q < 5; q++) out[3 + q]! += N[a]! * vf[q]!;
    }
    return out;
  }

  /**
   * Sólo una partición de `en`, con las mismas cuentas: «flexion», [Mx, My, Mxy, Qx, Qy] (out[3..7]
   * de `en`); «membrana», [Nx, Ny, Nxy] (out[0..2]). Un mapa de M no ajusta así la membrana.
   */
  enParte(k: number, xi: number, eta: number, parte: "flexion" | "membrana"): Float64Array {
    const N = funcionesForma(xi, eta);
    const flexion = parte === "flexion";
    const ps = flexion ? this.c.flexion.plazas : this.c.membrana.plazas;
    const r = new Float64Array(flexion ? 5 : 3);
    for (let a = 0; a < 4; a++) {
      const p = ps[4 * k + a]!;
      if (p < 0) throw new Error(`CamposLaminas: la lámina ${this.c.modelo.laminas![k]!.id} no está en ninguna región (es rígida)`);
      const v = flexion ? this.flexion.plaza(p, this.muestrasFlexion) : this.membrana.plaza(p, this.muestrasMembrana);
      for (let q = 0; q < r.length; q++) r[q]! += N[a]! * v[q]!;
    }
    const cambio = flexion ? this.c.flexion.cambio : this.c.membrana.cambio;
    const a11 = cambio[5 * k]!;
    const a12 = cambio[5 * k + 1]!;
    const a21 = cambio[5 * k + 2]!;
    const a22 = cambio[5 * k + 3]!;
    const s = flexion ? cambio[5 * k + 4]! : 1;
    // Lo mismo que `deshacer` de `en`
    const b11 = a11 * r[0]! + a21 * r[2]!;
    const b12 = a11 * r[2]! + a21 * r[1]!;
    const b21 = a12 * r[0]! + a22 * r[2]!;
    const b22 = a12 * r[2]! + a22 * r[1]!;
    const out = new Float64Array(r.length);
    out[0] = s * (b11 * a11 + b12 * a21);
    out[1] = s * (b21 * a12 + b22 * a22);
    out[2] = s * (b11 * a12 + b12 * a22);
    if (flexion) {
      out[3] = s * (a11 * r[3]! + a21 * r[4]!);
      out[4] = s * (a12 * r[3]! + a22 * r[4]!);
    }
    return out;
  }

  /** Campos en (ξ, η) de la lámina k, en sus ejes. */
  en(k: number, xi: number, eta: number): Float64Array {
    const r = this.enRegiones(k, xi, eta);
    const [f11, f12, f21, f22, s3] = this.c.flexion.cambio.subarray(5 * k, 5 * k + 5);
    const [m11, m12, m21, m22] = this.c.membrana.cambio.subarray(5 * k, 5 * k + 5);
    // De la región a la lámina: T = Aᵀ·T'·A; Q = σ₃·Aᵀ·Q'
    const deshacer = (txx: number, tyy: number, txy: number, s: number, a11: number, a12: number, a21: number, a22: number) => {
      const b11 = a11 * txx + a21 * txy;
      const b12 = a11 * txy + a21 * tyy;
      const b21 = a12 * txx + a22 * txy;
      const b22 = a12 * txy + a22 * tyy;
      return [s * (b11 * a11 + b12 * a21), s * (b21 * a12 + b22 * a22), s * (b11 * a12 + b12 * a22)];
    };
    const out = new Float64Array(8);
    out.set(deshacer(r[0]!, r[1]!, r[2]!, 1, m11!, m12!, m21!, m22!), 0);
    out.set(deshacer(r[3]!, r[4]!, r[5]!, s3!, f11!, f12!, f21!, f22!), 3);
    out[6] = s3! * (f11! * r[6]! + f21! * r[7]!);
    out[7] = s3! * (f12! * r[6]! + f22! * r[7]!);
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
