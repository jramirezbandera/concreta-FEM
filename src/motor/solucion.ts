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
 * - Memoria (H16): tras el análisis simbólico, el núcleo dice cuántos bytes pedirán factorizar y
 *   resolver. El pico estimado es max(memoria lineal, en uso + lo pedido): si pasa del límite del
 *   dispositivo, se rechaza el modelo antes de factorizar en vez de agotar la memoria a medias.
 */
import { ErrorPivoteNulo, FactorLdlt, memoriaEnUsoNucleo, memoriaNucleo, type MemoriaRequerida, type PatronCsc } from "../nucleo/index.ts";
import { FactorPerfil } from "../solver/perfil.ts";
import { productoSimetrico } from "./ensamblado.ts";

export type TipoSolver = "nucleo" | "perfil";

/** Pivote relativo dⱼ/Kⱼⱼ por debajo del cual hay un mecanismo (más de 11 cifras perdidas). */
export const UMBRAL_MECANISMO = 1e-11;
/** Pivote relativo por debajo del cual se avisa de mal condicionamiento (más de 8 cifras perdidas). */
export const UMBRAL_MAL_CONDICIONADO = 1e-8;
/** Error hacia atrás objetivo tras el refinamiento. */
export const RESIDUO_OBJETIVO = 1e-10;
/**
 * Error hacia atrás por debajo del cual no se refina. LDLᵀ deja ω entre 5e-16 y 2e-15 en los
 * modelos de E1 (el ruido de la propia medida), y hasta 1,3e-13 en unas pocas filas con barras
 * de E2 (brazos rígidos y vigas descolgadas, E2-4); refinar por debajo de 1e-12 no mejora nada que
 * importe y cuesta otra resolución (≈ 0,9 s en el semirrígido del edificio objetivo).
 */
const RESIDUO_SUFICIENTE = 1e-12;

/** El pico de memoria estimado del núcleo pasa del límite: el modelo se rechaza antes de factorizar. */
export class ErrorLimiteMemoria extends Error {
  readonly estimada: number;
  readonly limite: number;
  constructor(estimada: number, limite: number) {
    super(`el núcleo necesitaría ${estimada} bytes y el límite es ${limite}`);
    this.name = "ErrorLimiteMemoria";
    this.estimada = estimada;
    this.limite = limite;
  }
}

/**
 * Margen sobre la memoria pedida por la fragmentación del asignador: al repetir un cálculo en el
 * mismo núcleo, los huecos liberados no siempre sirven y la memoria lineal llega hasta un 9 % por
 * encima de en uso + lo pedido (369 → 424 MB en el semirrígido del edificio objetivo; se estabiliza
 * en la segunda vuelta). En un núcleo nuevo, la estimación con el margen queda un 0–20 % por encima.
 */
const MARGEN_FRAGMENTACION = 1.15;
/**
 * Margen fijo para lo que el núcleo reserva fuera de lo que anuncia faer: la reserva de `gemm`
 * (512 KiB), la diagonal y el redondeo a páginas de 64 KiB. Sin él, el edificio objetivo con malla
 * de 1,5 m y 5 casos quedaba 1 MB por debajo (15 MB estimados, 16 reales; E4, en Chrome y en iOS).
 */
const MARGEN_FIJO = 4 * 2 ** 20;

export interface OpcionesResolver {
  /** Bytes de memoria lineal que el núcleo no debe pasar (sólo con el solver "nucleo"). */
  limiteMemoria?: number;
  /** Se llama al terminar cada subfase, con su duración en ms. */
  alProgreso?: (fase: string, ms: number) => void;
}

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
  memoriaRequerida(nrhs: number): MemoriaRequerida {
    return this.f.memoriaRequerida(nrhs);
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
  /** Memoria del núcleo (bytes): lo que pedirán factorizar y resolver, y el pico estimado. */
  memoria?: { requerida: number; picoEstimado: number };
  /** Milisegundos de: análisis simbólico, factorización, resolución, residuo y refinamiento. */
  tiempos: Record<string, number>;
}

function cifras(relativo: number): number {
  return relativo > 0 ? -Math.log10(relativo) : Infinity;
}

export function resolver(
  patron: PatronCsc,
  valores: Float64Array,
  diagonalK: Float64Array,
  B: Float64Array,
  nrhs: number,
  tipo: TipoSolver,
  opciones: OpcionesResolver = {},
): Solucion {
  const n = patron.n;
  const tiempos: Record<string, number> = {};
  let t0 = performance.now();
  const marcar = (fase: string) => {
    const t = performance.now();
    tiempos[fase] = (tiempos[fase] ?? 0) + t - t0;
    opciones.alProgreso?.(fase, t - t0);
    t0 = t;
  };
  const factorizador = tipo === "nucleo" ? new FactorizadorNucleo(patron) : new FactorizadorPerfil(patron);
  try {
    let memoria: Solucion["memoria"];
    if (factorizador instanceof FactorizadorNucleo) {
      marcar("analisis");
      const requerida = factorizador.memoriaRequerida(nrhs).total;
      memoria = { requerida, picoEstimado: Math.max(memoriaNucleo(), memoriaEnUsoNucleo() + MARGEN_FRAGMENTACION * requerida + MARGEN_FIJO) };
      if (opciones.limiteMemoria !== undefined && memoria.picoEstimado > opciones.limiteMemoria) {
        throw new ErrorLimiteMemoria(memoria.picoEstimado, opciones.limiteMemoria);
      }
    }
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

    marcar("factorizacion");
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
        memoria,
        tiempos,
      };
    }

    // 4. Resolver y refinar
    const X = nrhs > 0 ? factor.resolver(B, nrhs) : new Float64Array(0);
    marcar("resolucion");
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
    marcar("residuo");
    let pasos = 0;
    while (pasos < 3 && residuos.some((r) => r > RESIDUO_SUFICIENTE)) {
      const anterior = Math.max(...residuos);
      const dX = factor.resolver(R, nrhs);
      for (let i = 0; i < X.length; i++) X[i]! += dX[i]!;
      pasos++;
      calcularResiduos();
      marcar("refinamiento");
      if (Math.max(...residuos) > anterior / 2) break;
    }
    const nnzL = factor.nnzL;
    factor.liberar();
    return { X, residuos, mecanismos: [], malCondicionados, nnzL, pasosRefinamiento: pasos, memoria, tiempos };
  } finally {
    factorizador.liberar();
  }
}

function alfa(diagonalK: Float64Array, j: number): number {
  const v = Math.abs(diagonalK[j]!);
  return v > 0 ? v : 1;
}

