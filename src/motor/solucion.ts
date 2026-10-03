/**
 * Factorización y resolución de K'·X = B con diagnóstico de mecanismos (H12, E0-3).
 *
 * - Solver: el núcleo WASM (faer, LDLᵀ supernodal con AMD) o el de perfil en TypeScript (RCM),
 *   intercambiables; el de perfil es la referencia diferencial.
 * - Mecanismos: faer sólo falla con pivotes exactamente nulos. Tras factorizar se compara cada
 *   pivote dⱼ con la diagonal de K' (cifras perdidas = log₁₀(Kⱼⱼ/dⱼ), como el informe de
 *   «digits lost» de CSI). Un pivote ≤ 0 o con más de 11 cifras perdidas es un mecanismo.
 * - Modo del mecanismo: con muelles αⱼ = Kⱼⱼ en los GDL sospechosos S, la solución de
 *   (K' + Σ αⱼ·eⱼ·eⱼᵀ)·x = eₖ es exactamente un vector del núcleo de K' (vale 1/αₖ en k y 0 en
 *   el resto de S), así que dice qué nudos se mueven sin resistencia.
 * - Refinamiento iterativo con el error hacia atrás por componentes de Oettli–Prager,
 *   ω = maxᵢ |K·x − b|ᵢ / (|K|·|x| + |b|)ᵢ, como medida del residuo (§2.7 pide ≤ 1e-10). A
 *   diferencia de ‖r‖/‖b‖, ω no crece con el condicionamiento: mide la calidad del solver. Lo
 *   que el condicionamiento cuesta en precisión lo vigila el equilibrio (regla de oro 2).
 */
import { ErrorPivoteNulo, FactorLdlt, type PatronCsc } from "../nucleo/index.ts";
import { FactorPerfil } from "../solver/perfil.ts";
import { productoSimetrico } from "./ensamblado.ts";

export type TipoSolver = "nucleo" | "perfil";

/** Pivote relativo dⱼ/Kⱼⱼ por debajo del cual hay un mecanismo (más de 11 cifras perdidas). */
export const UMBRAL_MECANISMO = 1e-11;
/** Pivote relativo por debajo del cual se avisa de mal condicionamiento (más de 8 cifras perdidas). */
export const UMBRAL_MAL_CONDICIONADO = 1e-8;
/** Error hacia atrás objetivo tras el refinamiento. */
export const RESIDUO_OBJETIVO = 1e-10;
/** Error hacia atrás por debajo del cual ya no se refina (unas pocas ε). */
const RESIDUO_SUFICIENTE = 1e-15;

const MAX_PIVOTES_NULOS = 64;
const MAX_MODOS = 24;

interface Factor {
  resolver(b: Float64Array, nrhs: number): Float64Array;
  diagonal(): Float64Array;
  nnzL?: number;
  liberar(): void;
}

class FactorizadorNucleo {
  private readonly f: FactorLdlt;
  constructor(patron: PatronCsc) {
    this.f = new FactorLdlt(patron);
  }
  factorizar(valores: Float64Array): Factor {
    this.f.factorizar(valores);
    const f = this.f;
    return {
      resolver: (b, nrhs) => f.resolver(b, nrhs),
      diagonal: () => f.diagonal(),
      nnzL: f.estadisticas().nnzL,
      liberar: () => {},
    };
  }
  liberar(): void {
    this.f.liberar();
  }
}

class FactorizadorPerfil {
  private readonly patron: PatronCsc;
  constructor(patron: PatronCsc) {
    this.patron = patron;
  }
  factorizar(valores: Float64Array): Factor {
    const f = new FactorPerfil(this.patron, valores);
    const n = this.patron.n;
    return {
      resolver: (b, nrhs) => {
        const x = new Float64Array(b.length);
        for (let k = 0; k < nrhs; k++) x.set(f.resolver(b.subarray(n * k, n * (k + 1))), n * k);
        return x;
      },
      diagonal: () => f.diagonal(),
      nnzL: f.tamano,
      liberar: () => {},
    };
  }
  liberar(): void {}
}

export interface PivoteSospechoso {
  ecuacion: number;
  /** dⱼ/Kⱼⱼ; NaN si el pivote fue exactamente nulo. */
  relativo: number;
  cifrasPerdidas: number;
}

export interface Solucion {
  /** Solución por bloques (n·nrhs, en orden de columnas); ausente si hay mecanismo. */
  X?: Float64Array;
  /** Error hacia atrás por componentes (Oettli–Prager) final de cada lado derecho. */
  residuos: Float64Array;
  /** Pivotes de mecanismo y, para cada uno, su modo (n valores) si se pudo calcular. */
  mecanismos: { pivote: PivoteSospechoso; modo?: Float64Array }[];
  /** Pivotes con más de 8 cifras perdidas pero sin llegar a mecanismo. */
  malCondicionados: PivoteSospechoso[];
  nnzL?: number;
  pasosRefinamiento: number;
}

function cifras(relativo: number): number {
  return relativo > 0 ? -Math.log10(relativo) : Infinity;
}

export function resolver(patron: PatronCsc, valores: Float64Array, diagonalK: Float64Array, B: Float64Array, nrhs: number, tipo: TipoSolver): Solucion {
  const n = patron.n;
  const factorizador = tipo === "nucleo" ? new FactorizadorNucleo(patron) : new FactorizadorPerfil(patron);
  try {
    // 1. Factorizar; cada pivote exactamente nulo se marca y se sujeta con un muelle
    const nulos: number[] = [];
    let actuales = valores;
    let factor: Factor | undefined;
    while (!factor) {
      try {
        factor = factorizador.factorizar(actuales);
      } catch (e) {
        if (!(e instanceof ErrorPivoteNulo) || nulos.length >= MAX_PIVOTES_NULOS) throw e;
        nulos.push(e.columna);
        if (actuales === valores) actuales = valores.slice();
        actuales[patron.colPtr[e.columna + 1]! - 1]! += alfa(diagonalK, e.columna);
      }
    }

    // 2. Pivotes pequeños o negativos frente a la diagonal de K'
    const d = factor.diagonal();
    const sospechosos: PivoteSospechoso[] = nulos.map((ecuacion) => ({ ecuacion, relativo: NaN, cifrasPerdidas: Infinity }));
    const malCondicionados: PivoteSospechoso[] = [];
    const yaNulo = new Set(nulos);
    for (let j = 0; j < n; j++) {
      if (yaNulo.has(j)) continue;
      const relativo = d[j]! / Math.abs(diagonalK[j]!);
      if (!(relativo > UMBRAL_MECANISMO)) sospechosos.push({ ecuacion: j, relativo, cifrasPerdidas: cifras(relativo) });
      else if (relativo < UMBRAL_MAL_CONDICIONADO) malCondicionados.push({ ecuacion: j, relativo, cifrasPerdidas: cifras(relativo) });
    }

    if (sospechosos.length) {
      // 3. Modos de los mecanismos: muelles en todos los sospechosos y una carga unitaria en cada uno
      factor.liberar();
      const conMuelles = valores.slice();
      for (const s of sospechosos) conMuelles[patron.colPtr[s.ecuacion + 1]! - 1]! += alfa(diagonalK, s.ecuacion);
      let modos: Float64Array | undefined;
      const nModos = Math.min(sospechosos.length, MAX_MODOS);
      try {
        const f2 = factorizador.factorizar(conMuelles);
        const E = new Float64Array(n * nModos);
        for (let k = 0; k < nModos; k++) E[n * k + sospechosos[k]!.ecuacion] = 1;
        modos = f2.resolver(E, nModos);
        f2.liberar();
      } catch {
        modos = undefined;
      }
      return {
        residuos: new Float64Array(nrhs).fill(NaN),
        mecanismos: sospechosos.map((pivote, k) => ({ pivote, modo: modos && k < nModos ? modos.subarray(n * k, n * (k + 1)) : undefined })),
        malCondicionados,
        nnzL: factor.nnzL,
        pasosRefinamiento: 0,
      };
    }

    // 4. Resolver y refinar
    const X = nrhs > 0 ? factor.resolver(B, nrhs) : new Float64Array(0);
    const residuos = new Float64Array(nrhs);
    const R = new Float64Array(n * nrhs);
    const y = new Float64Array(n);
    const ya = new Float64Array(n);
    const absK = valores.map(Math.abs);
    const calcularResiduos = () => {
      for (let k = 0; k < nrhs; k++) {
        const x = X.subarray(n * k, n * (k + 1));
        productoSimetrico(patron, valores, x, y);
        productoSimetrico(patron, absK, x.map(Math.abs), ya);
        let w = 0;
        for (let i = 0; i < n; i++) {
          const b = B[n * k + i]!;
          const r = b - y[i]!;
          R[n * k + i] = r;
          const den = ya[i]! + Math.abs(b);
          if (den > 0) w = Math.max(w, Math.abs(r) / den);
        }
        residuos[k] = w;
      }
    };
    calcularResiduos();
    let pasos = 0;
    while (pasos < 3 && residuos.some((r) => r > RESIDUO_SUFICIENTE)) {
      const anterior = Math.max(...residuos);
      const dX = factor.resolver(R, nrhs);
      for (let i = 0; i < X.length; i++) X[i]! += dX[i]!;
      pasos++;
      calcularResiduos();
      if (Math.max(...residuos) > anterior / 2) break;
    }
    const nnzL = factor.nnzL;
    factor.liberar();
    return { X, residuos, mecanismos: [], malCondicionados, nnzL, pasosRefinamiento: pasos };
  } finally {
    factorizador.liberar();
  }
}

function alfa(diagonalK: Float64Array, j: number): number {
  const v = Math.abs(diagonalK[j]!);
  return v > 0 ? v : 1;
}

