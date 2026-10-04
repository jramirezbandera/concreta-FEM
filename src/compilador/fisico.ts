/**
 * Modelo físico del compilador (fase C1: plantas, pilares, vigas, apoyos, casos y cargas). Es lo
 * que el usuario describe; el compilador lo convierte en el `ModeloAnalitico` del motor
 * (`docs/fem3d/compilador.md`).
 *
 * Convenios:
 * - Unidades kN y m (D1); los módulos elásticos, en kN/m², salvo los datos de material que se
 *   dicen en MPa; el peso específico, en kN/m³.
 * - Ejes globales X, Y en planta y Z hacia arriba, los del motor (cabecera de `motor/modelo.ts`).
 * - Las plantas van de ARRIBA ABAJO, cada una con su altura de forjado a forjado hasta la de
 *   encima, como `lib/edificio` de Concreta. Las cotas se derivan (`cotas.ts`); nunca se guardan
 *   (H33, COM-17). Un nivel de cimentación es una planta más, de tipo `sotano`, que cuelga de la de
 *   encima su propia altura.
 * - Todo lo demás se sitúa en planta (x, y) y por la planta a la que pertenece.
 * - Los `id` son únicos en todo el modelo (plantas, materiales, secciones, piezas, apoyos, casos y
 *   cargas), así que un diagnóstico nombra el objeto sólo por su `id`.
 * - Ejes locales de las piezas, los de las barras del motor (H02):
 *   · viga: x a lo largo de cada tramo de su polilínea, en el sentido de sus puntos; z = +Z (el
 *     canto, vertical); y = z × x;
 *   · pilar: x hacia arriba; z = dirección del canto h en planta, girada `giro` grados desde +X;
 *     y = z × x. Con giro 0, el canto h va según X y el ancho b según −Y.
 *   Las liberaciones y las cargas "local" van en esos ejes.
 * - Estaciones: distancia en m a lo largo de la pieza, desde el primer punto de una viga (sumando
 *   sus tramos) o desde la base de un pilar.
 */
import type { ModificadoresBarra } from "../elementos/barra.ts";
import type { Seis, Vec3 } from "../motor/modelo.ts";
import type { PerfilCatalogo } from "../secciones/seccion3D.ts";

export type Vec2 = readonly [number, number];

export type TipoPlanta = "cubierta" | "planta" | "sotano";

export interface Planta {
  id: string;
  nombre?: string;
  /** Como en `lib/edificio`: un sótano cuelga de la planta de encima. Por defecto, "planta". */
  tipo?: TipoPlanta;
  /** m, de forjado a forjado hasta la planta de encima; la de arriba del todo no la necesita. */
  altura: number | null;
  /**
   * Diafragma de la planta (C1-d). Por defecto, rígido en todas menos en la más baja, donde
   * suelen estar los arranques empotrados.
   */
  diafragma?: "rigido" | "ninguno";
}

export type Material =
  | {
      id: string;
      tipo: "hormigon";
      /** Resistencia característica, MPa. E = 8500·∛(fck + 8) MPa, como el solver de Concreta. */
      fck: number;
      /** Coeficiente de Poisson. Por defecto, 0,2. */
      nu?: number;
      /** Peso específico, kN/m³. Por defecto, 25. */
      peso?: number;
    }
  | {
      id: string;
      tipo: "acero";
      /** Módulo de elasticidad, MPa. Por defecto, 210 000. */
      E?: number;
      /** Peso específico, kN/m³. Por defecto, 78,5. */
      peso?: number;
    }
  | {
      id: string;
      tipo: "general";
      /** Módulos de elasticidad y de cortante, kN/m². */
      E: number;
      G: number;
      /** Peso específico, kN/m³. */
      peso: number;
    };

/**
 * Sección de pieza, en m. `b` va según y local y `h` (el canto) según z local. De la forma salen
 * las propiedades (`seccion3D()`) y la huella en planta del pilar, que fija sus zonas rígidas.
 */
export type Seccion =
  | { id: string; material: string; forma: "rectangular"; b: number; h: number }
  | { id: string; material: string; forma: "circular"; D: number }
  /** Perfil en I o H del catálogo de Concreta, en sus unidades (cm², cm⁴ y mm). */
  | { id: string; material: string; forma: "I"; perfil: PerfilCatalogo }
  /** T con el ala arriba: ala bf×hf y alma bw de canto total h. El eje pasa por su centro de gravedad. */
  | { id: string; material: string; forma: "T"; bf: number; hf: number; bw: number; h: number }
  /**
   * Propiedades dadas (m², m⁴). Sin áreas de cortante, Euler–Bernoulli en ese plano. `b` y `h`,
   * si se dan, son la huella del pilar y el canto de la viga (sin ellos, no hay zonas rígidas).
   */
  | { id: string; material: string; forma: "general"; A: number; Iy: number; Iz: number; J: number; Avy?: number; Avz?: number; b?: number; h?: number };

/** GDL liberados de un extremo, en ejes locales: [N, Vy, Vz, T, My, Mz]. */
export type Liberacion = Seis<boolean>;

export interface Pilar {
  id: string;
  nombre?: string;
  /** Posición del eje en planta, m. */
  x: number;
  y: number;
  /** Planta de su base y planta de su cabeza; entre ellas, un tramo por planta. */
  desde: string;
  hasta: string;
  seccion: string;
  /** Sección de algunos tramos, por la planta de su cabeza. */
  tramos?: readonly { planta: string; seccion: string }[];
  /** Giro en planta de la dirección del canto h, en grados desde +X. Por defecto, 0. */
  giro?: number;
  /**
   * Vínculo de la base. Por defecto, "empotrado". "ninguno" es un pilar que nace sobre otra pieza
   * (apeado), que tiene que llegarle en esa planta.
   */
  base?: "empotrado" | "articulado" | "ninguno";
  /** Liberaciones en la base física (tramo inferior) y en la cabeza física (tramo superior). */
  liberaciones?: { base?: Liberacion; cabeza?: Liberacion };
}

export interface Viga {
  id: string;
  nombre?: string;
  planta: string;
  /** Polilínea en planta, m, con al menos dos puntos distintos. */
  puntos: readonly Vec2[];
  seccion: string;
  /** Liberaciones en el primer punto (inicio) y en el último (fin). */
  liberaciones?: { inicio?: Liberacion; fin?: Liberacion };
  /**
   * Punto de inserción (C1-c). "plano" (por defecto): el eje analítico en el plano del forjado.
   * "superior": la cara superior en el plano del forjado y el eje h/2 más abajo (con diafragma
   * rígido, la viga trabaja como una T de ala infinitamente rígida).
   */
  insercion?: "plano" | "superior";
}

export interface ApoyoFisico {
  id: string;
  planta: string;
  x: number;
  y: number;
  /** GDL coartados en ejes globales, [ux, uy, uz, rx, ry, rz]. */
  coartados: Seis<boolean>;
}

export interface CasoFisico {
  id: string;
  nombre?: string;
  /** El peso propio de las piezas (γ·A) va a este caso. Como mucho, uno. */
  pesoPropio?: boolean;
}

/**
 * Cargas físicas (C1). Las repartidas van por unidad de longitud de la pieza (kN/m), en ejes
 * globales o locales, con variación lineal de `q` (en `desde`) a `qb` (en `hasta`). `desde` y
 * `hasta` son estaciones de la pieza; por defecto, la pieza entera.
 */
export type CargaFisica =
  | {
      tipo: "puntual";
      id: string;
      caso: string;
      /** Punto en planta y planta: cae en un pilar, en un nudo o sobre una viga. */
      planta: string;
      x: number;
      y: number;
      /** Fuerza, kN, y momento, kN·m, en ejes globales. */
      F?: Vec3;
      M?: Vec3;
    }
  | { tipo: "viga"; id: string; caso: string; viga: string; ejes: "global" | "local"; q: Vec3; qb?: Vec3; desde?: number; hasta?: number }
  | { tipo: "pilar"; id: string; caso: string; pilar: string; ejes: "global" | "local"; q: Vec3; qb?: Vec3; desde?: number; hasta?: number };

export interface ModeloFisico {
  plantas: readonly Planta[];
  materiales: readonly Material[];
  secciones: readonly Seccion[];
  pilares?: readonly Pilar[];
  vigas?: readonly Viga[];
  apoyos?: readonly ApoyoFisico[];
  casos: readonly CasoFisico[];
  cargas?: readonly CargaFisica[];
}

/** Multiplicadores de rigidez por tipo de pieza (H47, D4). */
export interface ModificadoresPiezas {
  pilares?: ModificadoresBarra;
  vigas?: ModificadoresBarra;
}

export interface OpcionesCompilacion {
  /** Tolerancia numérica, m: fusión silenciosa. Por defecto, 1e-6. */
  epsGeom?: number;
  /** Tolerancia de modelado, m: fusión con aviso. Por defecto, 0,05 (H28). */
  epsSnap?: number;
  /** Fracción rígida de los nudos de dimensión finita, en [0, 1] (C1-a). Por defecto, 1. */
  factorZonaRigida?: number;
  /** Deformación por cortante (Timoshenko). Por defecto, sí. */
  cortante?: boolean;
  /** Por defecto, ninguno (C1-g, hasta que se decida D4). */
  modificadores?: ModificadoresPiezas;
}

export interface OpcionesResueltas {
  epsGeom: number;
  epsSnap: number;
  factorZonaRigida: number;
  cortante: boolean;
  modificadores: ModificadoresPiezas;
}

export function resolverOpciones(o: OpcionesCompilacion = {}): OpcionesResueltas {
  return {
    epsGeom: o.epsGeom ?? 1e-6,
    epsSnap: o.epsSnap ?? 0.05,
    factorZonaRigida: o.factorZonaRigida ?? 1,
    cortante: o.cortante ?? true,
    modificadores: o.modificadores ?? {},
  };
}
