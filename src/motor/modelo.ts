/**
 * Modelo analítico de entrada del motor y forma de sus resultados.
 *
 * Convenios del motor (cabecera única, H02):
 * - Unidades kN y m (D1): fuerzas en kN, momentos en kN·m, desplazamientos en m, giros en rad,
 *   módulos elásticos en kN/m², rigideces de muelle en kN/m y kN·m/rad.
 * - Ejes globales X, Y, Z dextrógiros, con Z hacia arriba.
 * - 6 GDL por nudo, siempre en este orden: [ux, uy, uz, rx, ry, rz]. Giros y momentos según la
 *   regla de la mano derecha. El GDL físico `c` del nudo `i` es el 6·i + c en todos los vectores.
 * - Cargas nodales positivas en el sentido de los ejes globales.
 * - Reacciones: fuerza que ejercen sobre la estructura los apoyos y los muelles a tierra, en ejes
 *   globales (como las «Joint Reactions» de CSI, que también incluyen los muelles).
 * - Los esfuerzos de barra y de lámina (E2, E3) seguirán el convenio tipo CSI de H02.
 *
 * Los objetos se referencian por índice (nudos de un elemento, maestro de una restricción…). Los
 * `id` no los usa el cálculo: sólo sirven para que los diagnósticos señalen el objeto analítico,
 * que el compilador traduce después al objeto físico.
 */
import type { SeccionBarra } from "../elementos/barra.ts";
import type { MaterialLamina } from "../elementos/dkmq.ts";
import type { OpcionesMembrana } from "../elementos/membrana.ts";
import type { Diagnostico } from "./diagnosticos.ts";

export type Vec3 = readonly [number, number, number];

/** Índice de un GDL dentro del nudo: 0 = ux, 1 = uy, 2 = uz, 3 = rx, 4 = ry, 5 = rz. */
export type Gdl = 0 | 1 | 2 | 3 | 4 | 5;

export const NOMBRES_GDL = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;

export interface NudoAnalitico {
  id: string;
  x: number;
  y: number;
  z: number;
}

/**
 * Barra de Euler–Bernoulli de 12 GDL (la del spike E0). En E2 la sustituye la de Timoshenko con
 * offsets, punto de inserción y liberaciones.
 */
export interface BarraAnalitica {
  id: string;
  nudos: readonly [number, number];
  seccion: SeccionBarra;
  /** Dirección del canto (z local), que no puede ser paralela al eje de la barra. */
  vz: Vec3;
}

/** Lámina cuadrilátera plana DKMQ + membrana con drilling (la del spike E0). */
export interface LaminaAnalitica {
  id: string;
  /** En sentido antihorario visto desde la cara +z local, que es (1→2) × (1→3). */
  nudos: readonly [number, number, number, number];
  material: MaterialLamina;
  membrana?: OpcionesMembrana;
}

/**
 * Muelle lineal a tierra (un nudo) o entre dos nudos coincidentes (longitud nula). Un muelle
 * entre nudos separados no conserva el equilibrio de momentos y se rechaza.
 */
export interface Muelle {
  id: string;
  nudos: readonly [number] | readonly [number, number];
  /**
   * Rigidez en los ejes del muelle: 6 valores (diagonal) o 36 (matriz 6×6 simétrica y
   * semidefinida positiva, por filas), en el orden de GDL del motor.
   */
  k: readonly number[];
  /** Ejes del muelle: matriz 3×3 ortonormal por filas (e1, e2, e3). Por defecto, los globales. */
  ejes?: readonly number[];
}

export interface Apoyo {
  nudo: number;
  /** GDL coartados, en el orden [ux, uy, uz, rx, ry, rz]. */
  coartados: readonly [boolean, boolean, boolean, boolean, boolean, boolean];
}

/**
 * Restricciones por transformación (u = T·û), nunca por penalización.
 * - Diafragma rígido en un plano horizontal: ux = uxm − (y − ym)·rzm, uy = uym + (x − xm)·rzm,
 *   rz = rzm. Todos sus nudos, también el maestro, tienen que estar a la misma cota.
 * - Enlace rígido (sólido rígido de 6 GDL): u = um + θm × (x − xm), θ = θm.
 * El maestro de una restricción puede ser esclavo de otra (cadenas: huella → cabeza de pilar →
 * diafragma); un GDL no puede ser esclavo de dos restricciones ni llevar apoyo.
 */
export interface Restriccion {
  tipo: "diafragma" | "enlace-rigido";
  id: string;
  maestro: number;
  esclavos: readonly number[];
}

export interface CargaNodal {
  nudo: number;
  /** [Fx, Fy, Fz, Mx, My, Mz] en ejes globales. */
  f: readonly [number, number, number, number, number, number];
}

/** Desplazamiento impuesto en un GDL coartado por un apoyo (los coartados sin valor valen 0). */
export interface DesplazamientoImpuesto {
  nudo: number;
  gdl: Gdl;
  valor: number;
}

export interface CasoCarga {
  id: string;
  nodales?: readonly CargaNodal[];
  impuestos?: readonly DesplazamientoImpuesto[];
}

export interface ModeloAnalitico {
  nudos: readonly NudoAnalitico[];
  barras?: readonly BarraAnalitica[];
  laminas?: readonly LaminaAnalitica[];
  muelles?: readonly Muelle[];
  apoyos?: readonly Apoyo[];
  restricciones?: readonly Restriccion[];
  casos: readonly CasoCarga[];
}

export interface ResultadoCaso {
  id: string;
  /** Desplazamientos de todos los nudos, 6 por nudo (m, rad), en ejes globales. */
  u: Float64Array;
  /** Reacciones de apoyos y muelles a tierra, 6 por nudo (kN, kN·m); 0 donde no hay. */
  reacciones: Float64Array;
  /**
   * Regla de oro 2: |ΣF| / Σ|F| y |ΣM| / Σ|M| entre cargas y reacciones, con los momentos
   * respecto al centro del modelo. Tienen que quedar por debajo de 1e-9.
   */
  equilibrio: { fuerzas: number; momentos: number };
  /**
   * Error hacia atrás por componentes de las ecuaciones libres tras el refinamiento iterativo
   * (Oettli–Prager): maxᵢ |K·x − b|ᵢ / (|K|·|x| + |b|)ᵢ. Mide el solver, no el condicionamiento.
   */
  residuo: number;
}

export interface EstadisticasCalculo {
  nudos: number;
  /** GDL físicos (6 por nudo). */
  gdl: number;
  ecuaciones: number;
  esclavos: number;
  coartados: number;
  /** GDL sin rigidez que se restringen solos (nudos maestros auxiliares, nudos aislados…). */
  sinRigidez: number;
  nnzK: number;
  nnzL?: number;
  /** Milisegundos de cada fase. */
  tiempos: Record<string, number>;
}

/**
 * Resultado del cálculo. Un cálculo con algún diagnóstico de error no es válido y no trae
 * `casos`: los desplazamientos que se llegaran a obtener van en `casosNoValidos`, sólo para
 * depurar, para que ningún consumidor los presente por descuido.
 */
export type ResultadoCalculo =
  | { valido: true; casos: ResultadoCaso[]; diagnosticos: Diagnostico[]; estadisticas: EstadisticasCalculo }
  | { valido: false; casosNoValidos?: ResultadoCaso[]; diagnosticos: Diagnostico[]; estadisticas?: EstadisticasCalculo };
