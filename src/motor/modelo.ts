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
 *
 * Barras (E2, convenio tipo CSI de H02):
 * - Ejes locales del tramo flexible (entre los extremos i' y j', tras los offsets rígidos):
 *   x = i'→j'; z = dirección del canto h (el vector `vz` proyectado); y = z × x. El eje fuerte de
 *   una viga o un pilar es siempre y (inercia Iy, momento My), como `MEdy` de los módulos.
 * - Esfuerzos [N, Vy, Vz, T, My, Mz] de una sección, con la regla de CSI aplicada a estos ejes:
 *   · N, Vy, Vz, T: sobre la cara de normal +x, positivos en el sentido de +x, +y, +z y del giro +x.
 *     N > 0 es tracción.
 *   · My > 0 comprime la fibra +z (tracciona la −z): en una viga con z hacia arriba, el momento de
 *     vano es positivo. Mz > 0 comprime la fibra +y.
 *   · Por equilibrio: N' = −qx, Vy' = −qy, Vz' = −qz, My' = −Vz, Mz' = −Vy. En una biapoyada
 *     con carga de gravedad, Vz es negativo en el apoyo izquierdo y positivo en el derecho.
 * - Correspondencia con la salida de SAP2000/ETABS si su eje 2 es el canto (z de aquí = 2,
 *   y de aquí = −3): N = P, Vz = V2, Vy = −V3, T = T, My = M3, Mz = −M2.
 * - Con los mismos ejes locales, PyNite da todas las componentes con el signo cambiado (H02).
 * - Cargas de barra: por unidad de longitud del tramo flexible (no proyectada), en ejes locales o
 *   globales; posiciones en m desde i'.
 *
 * Láminas (E3, convenio tipo CSI de H02):
 * - Ejes de la lámina (1, 2, 3): 3 = normal según el orden de los nudos (regla de la mano
 *   derecha, (X₃ − X₁) × (X₄ − X₂)); 1 = `eje1` proyectado sobre el plano o, sin él, la regla de
 *   CSI (eje 1 horizontal y eje 2 hacia +Z; en una lámina horizontal, eje 2 = +Y); 2 = 3 × 1. Una
 *   losa con la normal hacia +Z tiene 1 = X y 2 = Y. Los multiplicadores van en estos ejes.
 * - Resultantes por unidad de longitud en esos ejes (x = 1, y = 2, z = 3):
 *   · Nx, Ny, Nxy = ∫ σ dz (kN/m), tracción positiva (= F11, F22, F12 de CSI).
 *   · Mx = −∫ z·σx dz, My = −∫ z·σy dz, Mxy = −∫ z·τxy dz (kN·m/m) (= M11, M22, M12 de CSI): Mx
 *     produce σx y es positivo con tracción en la cara −z. En una losa con la normal hacia arriba,
 *     el momento de vano es positivo, como en las barras.
 *   · Qx = ∫ τxz dz, Qy = ∫ τyz dz (kN/m) (= V13, V23 de CSI). Por equilibrio, Qx = −(∂Mx/∂x +
 *     ∂Mxy/∂y): en una losa con gravedad, Qx es negativo junto al apoyo de x menor, como Vz en una
 *     biapoyada. Son los de la DKMQ, que con mallas de obra quedan un 30–50 % bajos (H18): sólo
 *     sirven para ver; para comprobar, las fuerzas nodales en una línea (E5).
 * - Invertir el orden de los nudos invierte el eje 3 y con él otro: el 1 con la regla de CSI, el 2
 *   con `eje1`. Nxy, Mx y My cambian de signo; Mxy no; y de los cortantes, el del eje que se
 *   invierte no cambia (Qx con la regla de CSI, Qy con `eje1`) y el otro sí.
 * - Cargas de lámina por unidad de superficie real (no proyectada) o de longitud, en ejes de la
 *   lámina ("local") o globales. Una presión normal es [0, 0, p] en locales, positiva según +3.
 *
 * Los objetos se referencian por índice (nudos de un elemento, maestro de una restricción…). Los
 * `id` no los usa el cálculo: sólo sirven para que los diagnósticos señalen el objeto analítico,
 * que el compilador traduce después al objeto físico.
 */
import type { ModificadoresBarra, SeccionBarra } from "../elementos/barra.ts";
import type { MaterialLamina } from "../elementos/dkmq.ts";
import type { MultiplicadoresLamina } from "../elementos/lamina.ts";
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

/** Seis valores por extremo de barra, en el orden de los GDL locales [ux, uy, uz, rx, ry, rz]. */
export type Seis<T> = readonly [T, T, T, T, T, T];

/**
 * Barra 3D de Timoshenko (Euler–Bernoulli si la sección no da áreas de cortante), con offsets
 * rígidos, liberaciones y modificadores de rigidez.
 */
export interface BarraAnalitica {
  id: string;
  nudos: readonly [number, number];
  seccion: SeccionBarra;
  /** Dirección del canto (z local), que no puede ser paralela al tramo flexible. */
  vz: Vec3;
  /**
   * Offsets rígidos en ejes globales, del nudo al extremo del tramo flexible (m): i' = i + dᵢ,
   * j' = j + dⱼ. Sirven para las zonas rígidas (a lo largo del eje) y para el punto de inserción
   * (offset lateral, como una viga descolgada). Por defecto, nulos.
   */
  offsets?: { i?: Vec3; j?: Vec3 };
  /**
   * GDL liberados en los extremos del tramo flexible, en ejes locales: [N, Vy, Vz, T, My, Mz]
   * (= [ux, uy, uz, rx, ry, rz] locales). Se condensan; un juego inestable es un error.
   */
  liberaciones?: { i?: Seis<boolean>; j?: Seis<boolean> };
  /** Multiplicadores de A, Avy, Avz, J, Iy e Iz (H47). Por defecto, 1. */
  modificadores?: ModificadoresBarra;
}

/**
 * Lámina cuadrilátera plana DKMQ24: flexión DKMQ + membrana con drilling real, con multiplicadores
 * de rigidez por componente (D3) en sus ejes 1-2.
 */
export interface LaminaAnalitica {
  id: string;
  /** Recorren el contorno; su orden fija la normal (eje 3) por la regla de la mano derecha. */
  nudos: readonly [number, number, number, number];
  material: MaterialLamina;
  /**
   * Dirección de referencia del eje 1 (global), que se proyecta sobre el plano: la de los nervios
   * de un reticular, por ejemplo. Por defecto, la regla de CSI (cabecera).
   */
  eje1?: Vec3;
  /** Multiplicadores f11…v23 sobre la sección maciza, en los ejes 1-2 (D3). Por defecto, 1. */
  multiplicadores?: MultiplicadoresLamina;
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

/**
 * Carga sobre el tramo flexible de una barra (exacta: no se trocea la barra). Las posiciones son
 * distancias en m desde i' y tienen que caer en [0, L'], con L' la longitud del tramo flexible.
 * Las componentes van en ejes locales del tramo flexible o en globales, por unidad de longitud
 * del tramo (no proyectada).
 */
export type CargaBarra =
  | {
      tipo: "puntual";
      barra: number;
      ejes: "local" | "global";
      x: number;
      /** Fuerza, kN. */
      F?: Vec3;
      /** Momento, kN·m (vector, regla de la mano derecha). */
      M?: Vec3;
    }
  | {
      tipo: "distribuida";
      barra: number;
      ejes: "local" | "global";
      /** Carga en `a`, kN/m. */
      qa: Vec3;
      /** Carga en `b` (variación lineal entre a y b). Por defecto, igual a `qa`. */
      qb?: Vec3;
      /** Tramo cargado [a, b] en m desde i'. Por defecto, todo el tramo flexible. */
      a?: number;
      b?: number;
    };

/**
 * Carga sobre una lámina, en ejes de la lámina ("local": 1, 2, 3) o globales. Las de superficie
 * van por unidad de superficie real (kN/m²) y las de línea por unidad de longitud (kN/m). Los
 * puntos son globales y tienen que caer en la lámina (en su plano y dentro de su contorno). Las
 * fuerzas nodales equivalentes salen de las funciones bilineales (sin momentos nodales, como la
 * presión de PyNite), así que son estáticamente equivalentes a la carga.
 */
export type CargaLamina =
  | {
      tipo: "superficie";
      lamina: number;
      ejes: "local" | "global";
      /**
       * Uniforme (un vector) o con un valor en cada nudo de la lámina, en su orden, interpolado
       * bilinealmente: así una ley lineal en el espacio (un empuje hidrostático) es exacta.
       */
      q: Vec3 | readonly [Vec3, Vec3, Vec3, Vec3];
    }
  | {
      tipo: "linea";
      lamina: number;
      ejes: "local" | "global";
      /** Extremos del tramo cargado (globales), dentro de la lámina. */
      a: Vec3;
      b: Vec3;
      /** Carga en `a`, kN/m. */
      qa: Vec3;
      /** Carga en `b` (variación lineal). Por defecto, igual a `qa`. */
      qb?: Vec3;
    }
  | {
      tipo: "puntual";
      lamina: number;
      ejes: "local" | "global";
      /** Punto de aplicación (global), dentro de la lámina. */
      punto: Vec3;
      /** Fuerza, kN. */
      F?: Vec3;
      /** Momento, kN·m (vector, regla de la mano derecha). */
      M?: Vec3;
    };

export interface CasoCarga {
  id: string;
  nodales?: readonly CargaNodal[];
  barras?: readonly CargaBarra[];
  laminas?: readonly CargaLamina[];
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
   * Esfuerzos de cada barra (en el orden de `barras`) en los extremos de su tramo flexible,
   * 12 por barra: [N, Vy, Vz, T, My, Mz] en i' (x = 0⁺) y en j' (x = L'⁻), en ejes locales y con
   * el convenio de la cabecera. Son esfuerzos dentro de la barra: una carga puntual justo en un
   * extremo pasa al nudo y no aparece. Los diagramas completos los da `DiagramasBarras`.
   */
  esfuerzosBarras: Float64Array;
  /**
   * Resultantes de cada lámina (en el orden de `laminas`) en su centroide, 8 por lámina:
   * [Nx, Ny, Nxy, Mx, My, Mxy, Qx, Qy] en los ejes de la lámina y con el convenio de la cabecera.
   * El valor del centroide es la media de los 4 puntos de Gauss (como PyNite), que converge con
   * orden 2 en su punto (H10): es el dato bruto para comprobar. Los valores en los puntos de Gauss
   * y en los nudos los da `ResultantesLaminas`.
   */
  esfuerzosLaminas: Float64Array;
  /**
   * Regla de oro 2: |ΣF| / Σ|F| y |ΣM| / Σ|M| entre cargas y reacciones, con los momentos
   * respecto al centro del modelo. Las cargas de barra y de lámina entran con su resultante real
   * (no con las fuerzas nodales equivalentes). Tienen que quedar por debajo de 1e-9.
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
  /** Pasos de refinamiento iterativo que hicieron falta (0 casi siempre). */
  pasosRefinamiento?: number;
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
