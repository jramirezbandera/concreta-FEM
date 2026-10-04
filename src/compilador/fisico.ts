/**
 * Modelo físico del compilador (C1: plantas, pilares, vigas, apoyos, casos y cargas; C2: losas,
 * apoyos lineales, bandas y cargas de superficie y lineales; C3: muros y empujes). Es lo que el
 * usuario describe; el compilador lo convierte en el `ModeloAnalitico` del motor
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
 * - Losas (C2): planas, en el plano de su planta (el plano medio a la cota del forjado). Su contorno
 *   y sus huecos son polígonos simples en planta, en cualquier sentido y sin repetir el primer
 *   punto. Los bordes van a ejes: un borde que se apoya en una viga se dibuja sobre su eje (C2-c).
 *   Las láminas tienen la normal hacia +Z y el eje 1 en la dirección `eje1` (E3-2).
 * - Muros (C3): verticales, de forjado a forjado, con el plano medio sobre su eje en planta (una
 *   polilínea; cada tramo es un paño plano). Los bordes de las losas que se apoyan en un muro van
 *   sobre su eje (C3-b). En alzado, la estación s va a lo largo del eje desde su primer punto
 *   (sumando sus tramos) y la altura z, desde la cota de su base. Sus láminas tienen el eje 1
 *   horizontal en el sentido del tramo, el 2 hacia +Z y el 3 (la normal) a la derecha del sentido
 *   del eje en planta. «Izquierdo» y «derecho» son los lados del eje mirando en su sentido.
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
   * suelen estar los arranques empotrados. Con losas, el rígido abarca los nudos que caen en ellas
   * (C2-f) y "ninguno" es un forjado semirrígido (la membrana de las losas).
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
      /** Punto en planta y planta: cae en un pilar, en un nudo, sobre una viga o en una losa. */
      planta: string;
      x: number;
      y: number;
      /** Fuerza, kN, y momento, kN·m, en ejes globales. */
      F?: Vec3;
      M?: Vec3;
    }
  | { tipo: "viga"; id: string; caso: string; viga: string; ejes: "global" | "local"; q: Vec3; qb?: Vec3; desde?: number; hasta?: number }
  | { tipo: "pilar"; id: string; caso: string; pilar: string; ejes: "global" | "local"; q: Vec3; qb?: Vec3; desde?: number; hasta?: number }
  | {
      /**
       * Carga de superficie uniforme (C2), en kN/m² y ejes globales: sobre la losa `losa` entera
       * (sin sus huecos) o sobre la parte de las losas de la planta que cae en el polígono `zona`
       * (si se dan los dos, la parte de esa losa en la zona). Lo que cae fuera de las losas no es
       * carga (C2-h).
       */
      tipo: "superficie";
      id: string;
      caso: string;
      planta: string;
      q: Vec3;
      losa?: string;
      zona?: readonly Vec2[];
    }
  | {
      /**
       * Carga lineal uniforme sobre una polilínea de una planta (C2), en kN/m y ejes globales: sobre
       * una losa o sobre el eje de un muro (C3).
       */
      tipo: "lineal";
      id: string;
      caso: string;
      planta: string;
      puntos: readonly Vec2[];
      q: Vec3;
    }
  | {
      /**
       * Empuje sobre un muro (C3-h): presión normal a su cara del lado `lado` (donde está el terreno
       * o el agua), que empuja hacia el otro lado. Vale `p0` a la altura `z0` y `p1` a la `z1` (sobre
       * la base del muro, m), varía linealmente entre ellas y es nula fuera; kN/m². Va sobre el muro
       * entero, sin sus huecos.
       */
      tipo: "empuje";
      id: string;
      caso: string;
      muro: string;
      lado: "izquierdo" | "derecho";
      z0: number;
      z1: number;
      p0: number;
      p1: number;
    };

/** Losa maciza (C2): una lámina plana en el plano de su planta. */
export interface Losa {
  id: string;
  nombre?: string;
  planta: string;
  /** Contorno exterior en planta, m: polígono simple de al menos 3 vértices. */
  contorno: readonly Vec2[];
  /** Huecos: polígonos simples dentro del contorno, sin tocarse entre sí ni tocarlo. */
  huecos?: readonly (readonly Vec2[])[];
  /** Espesor, m (el de su rigidez). */
  espesor: number;
  /** Material: hormigón o general. */
  material: string;
  /** Peso propio, kN/m² (H24). Por defecto, γ·espesor: el de una losa maciza. */
  pp?: number;
  /** Dirección del eje 1 de sus láminas en planta, en grados desde +X (E3-2). Por defecto, 0. Orienta también la retícula de la malla. */
  eje1?: number;
}

/** Apoyo lineal (C2): todos los nudos de la malla sobre una polilínea de una losa o del eje de un muro (C3). */
export interface ApoyoLineal {
  id: string;
  planta: string;
  puntos: readonly Vec2[];
  /** GDL coartados en ejes globales, [ux, uy, uz, rx, ry, rz]. */
  coartados: Seis<boolean>;
}

/**
 * Banda de dimensionado (D5): el rectángulo de eje `desde` → `hasta` y anchura `ancho`. En C2 sólo
 * se siembran sus lados en la malla, para que los cortes por fuerzas nodales en sus extremos (las
 * caras de los apoyos) y en sus bordes sean exactos (E5-5); las automáticas y su integración son
 * de C5.
 */
export interface Banda {
  id: string;
  planta: string;
  desde: Vec2;
  hasta: Vec2;
  ancho: number;
}

/** Hueco de un muro (C3): rectángulo en su alzado, dentro de un tramo. */
export interface HuecoMuro {
  /** Estaciones de sus bordes a lo largo del eje del muro, m. */
  desde: number;
  hasta: number;
  /** Alturas de sus bordes sobre la base del muro, m. */
  z0: number;
  z1: number;
}

/** Muro (C3): láminas verticales de forjado a forjado, sobre una polilínea en planta. */
export interface Muro {
  id: string;
  nombre?: string;
  /** Eje en planta, m: polilínea de al menos dos puntos; cada tramo es un paño plano. */
  puntos: readonly Vec2[];
  /** Planta de su base y planta de su cabeza, como los pilares. */
  desde: string;
  hasta: string;
  /** Espesor, m. */
  espesor: number;
  /** Material: hormigón o general. */
  material: string;
  /**
   * Vínculo de la base (C3-f). Por defecto, "empotrado" (todos los nudos de la base). "ninguno": el
   * muro nace sobre una viga, una losa u otro muro, que tienen que llegarle.
   */
  base?: "empotrado" | "articulado" | "ninguno";
  huecos?: readonly HuecoMuro[];
}

export interface ModeloFisico {
  plantas: readonly Planta[];
  materiales: readonly Material[];
  secciones: readonly Seccion[];
  pilares?: readonly Pilar[];
  vigas?: readonly Viga[];
  apoyos?: readonly ApoyoFisico[];
  losas?: readonly Losa[];
  apoyosLineales?: readonly ApoyoLineal[];
  bandas?: readonly Banda[];
  muros?: readonly Muro[];
  casos: readonly CasoFisico[];
  cargas?: readonly CargaFisica[];
}

/**
 * Multiplicadores de rigidez de un tipo de pieza (H47, D4): `todos` vale para cualquier material y
 * los de un material lo completan o lo sustituyen campo a campo ({ ...todos, ...hormigon }).
 */
export interface ModificadoresPieza {
  todos?: ModificadoresBarra;
  hormigon?: ModificadoresBarra;
  acero?: ModificadoresBarra;
  general?: ModificadoresBarra;
}

export interface ModificadoresPiezas {
  pilares?: ModificadoresPieza;
  vigas?: ModificadoresPieza;
}

/**
 * Modificadores por defecto (D4, decidida el 2026-10-04, `validacion/c1/out_decisiones.txt`):
 * - axil de todos los pilares ×2: el acortamiento de los pilares se va compensando en obra planta a
 *   planta, como hace CYPECAD (ccadmc01, p. 20); sin él, el acortamiento diferencial entre pilares
 *   interiores y de borde quita momento a los apoyos interiores (−6 % en la cara en el edificio
 *   objetivo);
 * - torsión de las vigas de hormigón ×0,1: la de compatibilidad se pierde al fisurar (EC2,
 *   6.3.1(2)); con la entera, una viga de borde empotra a la secundaria que le llega y el vano de
 *   ésta sale un 27 % corto. La torsión de equilibrio se sigue transmitiendo, con más giro.
 */
export const MODIFICADORES_D4: ModificadoresPiezas = { pilares: { todos: { A: 2 } }, vigas: { hormigon: { J: 0.1 } } };

/** Factor de zona rígida por defecto (C1-a, decidido el 2026-10-04): la mitad del nudo es rígida. */
export const FACTOR_ZONA_RIGIDA = 0.5;

/**
 * Tamaño de malla por defecto de las losas, m (C2-a): triángulos de 2h divididos en 3
 * cuadriláteros de ~0,76·h de lado, unos 10 por vano de 5,5 m (H10 pide 8). Con él, el edificio
 * objetivo cabe en D9.
 */
export const TAMANO_MALLA = 0.75;

export interface OpcionesCompilacion {
  /** Tolerancia numérica, m: fusión silenciosa. Por defecto, 1e-6. */
  epsGeom?: number;
  /** Tolerancia de modelado, m: fusión con aviso. Por defecto, 0,05 (H28). */
  epsSnap?: number;
  /**
   * Fracción rígida de los nudos de dimensión finita, en [0, 1] (C1-a). Por defecto, 0,5. Con 1, el
   * nudo es infinitamente rígido, como en CYPECAD; con 0, se calcula de eje a eje, como SAP2000 por
   * defecto.
   */
  factorZonaRigida?: number;
  /** Deformación por cortante (Timoshenko). Por defecto, sí. */
  cortante?: boolean;
  /**
   * Multiplicadores de rigidez, cada uno en (0, 100] (E6-1: uno enorme es una penalización). Por
   * defecto, `MODIFICADORES_D4`; si se dan, sustituyen enteros a los de por defecto, y `{}` los
   * quita todos.
   */
  modificadores?: ModificadoresPiezas;
  /**
   * Tamaño de malla de las losas y los muros, h en m (C2-a, C3-a): la retícula de triángulos de las
   * losas va a 2h, y los muros llevan elementos de ~h. Por defecto, 0,75.
   */
  tamanoMalla?: number;
}

export interface OpcionesResueltas {
  epsGeom: number;
  epsSnap: number;
  factorZonaRigida: number;
  cortante: boolean;
  modificadores: ModificadoresPiezas;
  tamanoMalla: number;
}

export function resolverOpciones(o: OpcionesCompilacion = {}): OpcionesResueltas {
  return {
    epsGeom: o.epsGeom ?? 1e-6,
    epsSnap: o.epsSnap ?? 0.05,
    factorZonaRigida: o.factorZonaRigida ?? FACTOR_ZONA_RIGIDA,
    cortante: o.cortante ?? true,
    modificadores: o.modificadores ?? MODIFICADORES_D4,
    tamanoMalla: o.tamanoMalla ?? TAMANO_MALLA,
  };
}
