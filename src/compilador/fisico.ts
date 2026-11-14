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
 *   · barra (fase BN): x de su inicio a su fin; z en el plano vertical que la contiene y hacia
 *     arriba (el `vz` = +Z del motor, proyectado); y = z × x; `giro` gira y y z alrededor de x. Son
 *     los ejes por defecto de un frame inclinado de SAP2000. Vertical, la regla de los pilares:
 *     z = +X girado `giro` grados.
 *   Las liberaciones y las cargas "local" van en esos ejes.
 * - Estaciones: distancia en m a lo largo de la pieza, desde el primer punto de una viga (sumando
 *   sus tramos), desde la base de un pilar o desde el inicio de una barra (su longitud real).
 * - Losas (C2): planas, en el plano de su planta, a la cota del forjado. Esa cota es la cara superior
 *   del forjado (RV-b, `planoForjado: "superior"`, por defecto): las láminas, el eje
 *   de las vigas y sus nudos van en ella; con `planoForjado: "medio"`, es el plano medio de la losa.
 *   Su contorno y sus huecos son polígonos simples en planta, en cualquier sentido y sin repetir el
 *   primer punto. Los bordes van a ejes: un borde que se apoya en una viga se dibuja sobre su eje
 *   (C2-c). Las láminas tienen la normal hacia +Z y el eje 1 en la dirección `eje1` (E3-2).
 * - Muros (C3): verticales, de forjado a forjado, con el plano medio sobre su eje en planta (una
 *   polilínea; cada tramo es un paño plano). Los bordes de las losas que se apoyan en un muro van
 *   sobre su eje (C3-b). En alzado, la estación s va a lo largo del eje desde su primer punto
 *   (sumando sus tramos) y la altura z, desde la cota de su base. Sus láminas tienen el eje 1
 *   horizontal en el sentido del tramo, el 2 hacia +Z y el 3 (la normal) a la derecha del sentido
 *   del eje en planta. «Izquierdo» y «derecho» son los lados del eje mirando en su sentido.
 * - Forjados (C4): un reticular es una losa con `reticular` (los nervios van según su `eje1` y la
 *   perpendicular); un unidireccional es un paño (`panos`) dibujado como una losa, a ejes, cuyas
 *   viguetas van según su `direccion`. Cada vigueta es una pieza (`<paño>:v<n>`) con los ejes de
 *   una viga: x a lo largo de ella, en el sentido de la dirección llevada a [0°, 180°) (las de 0° y
 *   180° son las mismas), y z = +Z; sus estaciones van desde su primer extremo.
 */
import type { CasoCarga } from "../combinaciones/generador.ts";
import type { Psi, PsiNombrado } from "../combinaciones/psi.ts";
import type { ModificadoresBarra } from "../elementos/barra.ts";
import type { MultiplicadoresLamina } from "../elementos/lamina.ts";
import type { Seis, Vec3 } from "../motor/modelo.ts";
import type { PerfilCatalogo } from "../secciones/seccion3D.ts";

export type Vec2 = readonly [number, number];

export type TipoPlanta = "cubierta" | "planta" | "sotano" | "escalon";

export interface Planta {
  id: string;
  nombre?: string;
  /**
   * Como en `lib/edificio`: un sótano cuelga de la planta de encima. Por defecto, "planta". Sólo
   * cambia el origen de las cotas: la cota 0 es la planta más baja que no es sótano. El cálculo no
   * cambia: con la cimentación como sótano o como planta, los mismos resultados (salvo el redondeo)
   * con otras cotas. "escalon" (MA5) es un forjado a poca altura del de debajo, como el escalón entre
   * dos cubiertas: la sensatez no avisa de la altura del tramo que llega a él (sí si es nula o
   * negativa); en lo demás, como "planta".
   */
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
      /** Resistencia característica, MPa. E = 22000·((fck + 8)/10)^0,3 MPa al MPa (Ecm del Código Estructural, CY-a). */
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
   * Propiedades dadas (m², m⁴). Iy es la inercia de la flexión de My, en el plano vertical de una
   * viga y en el del canto h de un pilar (el de +X con giro 0); Iz, la de Mz. Sin áreas de
   * cortante, Euler–Bernoulli en ese plano. `b` y `h`, si se dan, son la huella del pilar y el
   * canto de la viga (sin ellos, no hay zonas rígidas).
   */
  | { id: string; material: string; forma: "general"; A: number; Iy: number; Iz: number; J: number; Avy?: number; Avz?: number; b?: number; h?: number };

/** GDL liberados de un extremo, en ejes locales: [N, Vy, Vz, T, My, Mz]. */
export type Liberacion = Seis<boolean>;

/**
 * Punto fijo de un pilar (fase PF): el punto de su sección que está en (x, y) en
 * todas las plantas. Los lados, en los ejes de la sección girados con ella: «derecha» según el canto
 * h y «superior» a 90° (con giro 0, +X y +Y). Lo explica `puntoFijo.ts`.
 */
export type PuntoFijo =
  | "centro"
  | "mitad-derecha"
  | "mitad-izquierda"
  | "mitad-superior"
  | "mitad-inferior"
  | "esquina-superior-derecha"
  | "esquina-superior-izquierda"
  | "esquina-inferior-derecha"
  | "esquina-inferior-izquierda";

export interface Pilar {
  id: string;
  nombre?: string;
  /** Posición en planta del punto fijo (por defecto, el centro de la sección: el eje), m. */
  x: number;
  y: number;
  /**
   * Punto fijo (fase PF). Por defecto, "centro". Si la sección cambia entre tramos con otro punto
   * fijo, el eje de cada tramo es el centro de su sección y la excentricidad entre tramos va en un
   * offset rígido en la base del de encima.
   */
  fijo?: PuntoFijo;
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
   * (apeado), que tiene que llegarle en esa planta: una viga, otro pilar, o una losa o un muro, a los
   * que se une por su huella (C2-d).
   */
  base?: "empotrado" | "articulado" | "ninguno";
  /** Liberaciones en la base física (tramo inferior) y en la cabeza física (tramo superior). */
  liberaciones?: { base?: Liberacion; cabeza?: Liberacion };
  /**
   * Coeficientes de empotramiento, en [0, 1] (CY2): el de la base del tramo
   * inferior y el de la cabeza del tramo superior. 0 es articulado y 1, empotrado (por defecto). El
   * de la cabeza se multiplica por la opción `empotramientoCabeza`.
   */
  empotramiento?: { base?: number; cabeza?: number };
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

/** Extremo de una barra (fase BN): un punto en planta de una planta, a su cota. */
export interface ExtremoBarra {
  planta: string;
  x: number;
  y: number;
  /** m sobre la cota de la planta. Previsto en el esquema; en BN sólo 0 (`barra/dz-no-admitido`). */
  dz?: number;
}

/**
 * Barra entre dos puntos del edificio (fase BN, `docs/fem3d/barras.md`): inclinada, horizontal (los
 * dos extremos en la misma planta) o vertical. Cada extremo se une a lo que encuentra en su planta
 * como un apoyo puntual: un pilar, un nudo, una viga, una losa o un muro.
 */
export interface Barra {
  id: string;
  nombre?: string;
  inicio: ExtremoBarra;
  fin: ExtremoBarra;
  seccion: string;
  /** Giro de la sección alrededor de su eje x, en grados. Por defecto, 0. */
  giro?: number;
  /** Liberaciones en el inicio y en el fin, en ejes locales. */
  liberaciones?: { inicio?: Liberacion; fin?: Liberacion };
  /** Sólo trabaja a tracción. En BN se calcula lineal, con el aviso `barra/compresion` (CB-e, opción a). */
  soloTraccion?: boolean;
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
  /**
   * C5.4 (C5-f): la acción del caso, con los datos de `CasoCarga` de `src/combinaciones/` (tipo, ψ,
   * familia, dirección…), para generar las combinaciones CTE/NCSE de las consultas. No cambia la
   * compilación. Sin ella, las consultas van por caso o con combinaciones dadas por sus factores.
   */
  accion?: AccionCaso;
}

/**
 * La acción de un caso: los datos de `CasoCarga` con ψ por su nombre o por sus valores (A-2).
 */
export type AccionCaso = Omit<CasoCarga, "id" | "psi" | "simultaneo"> & {
  /**
   * ψ de la tabla 4.2 del DB SE (Q, S, W y T). Mejor por su nombre, para no escribir los números de
   * la norma: "uso-A" … "uso-G" (la categoría de uso de la tabla 3.1 del DB SE-AE), "nieve-hasta-1000"
   * o "nieve-mas-de-1000" (por la altitud del emplazamiento), "viento" o "temperatura". O sus valores,
   * { psi0, psi1, psi2 }, si son otros.
   */
  psi?: Psi | PsiNombrado;
};

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
  /** Sobre una barra (fase BN), por metro de su longitud real; las estaciones, desde su inicio. */
  | { tipo: "barra"; id: string; caso: string; barra: string; ejes: "global" | "local"; q: Vec3; qb?: Vec3; desde?: number; hasta?: number }
  | {
      /**
       * Carga de superficie uniforme (C2), en kN/m² y ejes globales: sobre la losa `losa` o el paño
       * `pano` (C4) enteros (sin sus huecos) o sobre la parte de las losas y los paños de la planta
       * que cae en el polígono `zona` (si se dan los dos, la parte de esa losa o ese paño en la
       * zona). Lo que cae fuera de las losas y los paños no es carga (C2-h).
       */
      tipo: "superficie";
      id: string;
      caso: string;
      planta: string;
      q: Vec3;
      losa?: string;
      /** Paño unidireccional (C4): la carga va sobre él entero (o sobre su parte en la zona). */
      pano?: string;
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
       * Carga lineal uniforme por el borde de una losa (MA4, `bordes.ts`), en kN/m y ejes globales: un
       * peto, una fachada. Va por su contorno y, con `huecos`, también por el de sus huecos, menos los
       * tramos de `excepto`; el compilador la lleva como cargas lineales sobre esos tramos, que ya
       * están en la malla. Sigue a la losa si se cambia su contorno.
       */
      tipo: "borde";
      id: string;
      caso: string;
      losa: string;
      q: Vec3;
      /** También por el borde de los huecos de la losa. Por defecto, no. */
      huecos?: boolean;
      /**
       * Tramos del borde que no la llevan: un segmento [desde, hasta] (lo del borde que va por él) o
       * `{ junto }`, lo del borde que toca en planta otra losa o cae sobre ella (el encuentro de dos
       * cubiertas, aunque estén a otra cota).
       */
      excepto?: readonly ExceptoBorde[];
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

/** Un tramo del borde sin la carga de borde (MA4): un segmento del borde o lo que toca otra losa. */
export type ExceptoBorde = readonly [Vec2, Vec2] | { junto: string };

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
  /** De dónde sale el `pp` escrito (fabricante, usuario o estimado): sólo se informa, no cambia el cálculo. */
  ppProcedencia?: Procedencia;
  /** Dirección del eje 1 de sus láminas en planta, en grados desde +X (E3-2). Por defecto, 0. Orienta también la retícula de la malla. */
  eje1?: number;
  /**
   * Desnivel de la cara superior del forjado respecto a la cota de su planta, m (negativo, más bajo;
   * por defecto, 0): una terraza más baja o una losa enrasada por abajo con otra más gruesa (fase DN,
   * `docs/fem3d/desniveles.md`). Los nudos siguen en el plano de la planta (DN-a): cambian lo que
   * ocupa el nudo de cada pilar (ZR1), la cota de las vigas que toca y el dibujo. Dos forjados con
   * desniveles distintos que comparten un lado sin solapar en canto necesitan una viga, un muro o un
   * apoyo lineal en él (DN-b).
   */
  desnivel?: number;
  /**
   * Forjado reticular (C4, D3): la losa es su zona aligerada, de canto total `espesor`, con nervios
   * según el `eje1` y la perpendicular.
   */
  reticular?: Reticular;
}

/** Ábacos en los pilares de un reticular (MA2): cuadrados de `lado` o rectángulos de `lados` m. */
export type AbacosPilares = { lado: number } | { lados: readonly [number, number] };

/**
 * Nervios de un forjado reticular (C4, D3), en m, iguales en las dos direcciones. Con ellos el
 * compilador calcula los multiplicadores de la zona aligerada (`reticular.ts`, C4-h). El `pp` de la
 * losa, si se da, es el de su zona aligerada; los ábacos pesan γ·canto (MA3, desde el 2026-11-05;
 * antes era el medio de toda la losa con los ábacos).
 */
export interface Reticular {
  /** Distancia entre ejes de nervios. */
  intereje: number;
  /** Ancho del nervio (bw). */
  nervio: number;
  /** Espesor de la capa de compresión (hf). */
  capa: number;
  /**
   * Punto de paso de los nervios (como en CYPECAD), m: el cruce de los ejes de un nervio de cada
   * familia (según el `eje1` y su perpendicular). Por defecto, la retícula va centrada en la caja de
   * la losa según sus ejes. No cambia el cálculo (la zona aligerada va con sus multiplicadores, C4-h):
   * sólo dónde se dibujan los nervios y los casetones y adónde redondean los ábacos por luces (AC-e).
   */
  paso?: Vec2;
  /**
   * Casetón (C4-i, `pesoForjado.ts`). Sin `pp`, el peso sale de él: γ·volumen de hormigón más el peso
   * aparente del casetón en el hueco entre nervios, en la zona aligerada, y γ·h en los ábacos. Por
   * defecto, "hormigon" (perdido de hormigón, el más común en obra; desde el 2026-10-28). Los perdidos
   * "ceramica" y "poliestireno", y "recuperable" (el hueco no pesa). "perdido" es un casetón perdido
   * de otro material: el `pp` de la losa es obligatorio.
   */
  caseton?: "hormigon" | "ceramica" | "poliestireno" | "recuperable" | "perdido";
  /**
   * El relleno del hueco entre nervios dado por el usuario (de la ficha de un fabricante, por
   * ejemplo): sustituye al estimado del `caseton` en el peso propio. Con "perdido" basta con él (no
   * hace falta el `pp`); con "recuperable" no cabe (el hueco queda vacío). Un `pp` escrito manda.
   */
  relleno?: Relleno;
  /**
   * Ábacos: polígonos simples macizos (multiplicador 1). Pueden salirse de la losa: cuenta su
   * parte dentro. Los que se solapan o quedan a menos de h/2 (la mitad del tamaño de malla) se unen
   * en su envolvente rectangular según los ejes de la losa, con el aviso `reticular/abacos-unidos`
   * (MA2, `abacos.ts`; antes de MA2, dos solapados eran un error).
   */
  abacos?: readonly (readonly Vec2[])[];
  /**
   * Ábacos en los pilares (MA2): un rectángulo centrado en cada pilar que llega a la losa (en el eje
   * del tramo que la atraviesa), de `lado` × `lado` m o de `lados` [según el eje1, según su
   * perpendicular]. Un pilar con el eje dentro de un ábaco de `abacos` no lleva otro. Se unen con los
   * demás como los de `abacos`. Siguen a los pilares si se mueven.
   */
  abacosPilares?: AbacosPilares;
  /**
   * Multiplicadores de la zona aligerada dados por el usuario: sustituyen a los calculados y se
   * aplican sobre la maciza con el ν del material (C4-h). Cada uno en (0, 100].
   */
  multiplicadores?: MultiplicadoresLamina;
}

/**
 * Paño de forjado unidireccional (C4, D2): viguetas como barras según `direccion`, cada
 * `intereje`, dentro de su contorno (sin sus huecos). Vale también para placas alveolares y chapa
 * colaborante (barras unidireccionales con su intereje, H46). Su contorno va a ejes (C2-c): sobre
 * los ejes de las vigas y los muros en los que se apoya.
 */
export interface PanoUnidireccional {
  id: string;
  nombre?: string;
  planta: string;
  /**
   * Contorno exterior en planta, m: polígono simple de al menos 3 vértices. Las viguetas empiezan
   * en el lado más cercano a su primer vértice, a un intereje, y siguen hasta el otro (C4-a.1).
   */
  contorno: readonly Vec2[];
  /** Huecos: polígonos simples dentro del contorno, sin tocarse entre sí ni tocarlo. */
  huecos?: readonly (readonly Vec2[])[];
  /** Dirección de las viguetas en planta, en grados desde +X. */
  direccion: number;
  /** Distancia entre ejes de viguetas, m. */
  intereje: number;
  /** Sección de una vigueta: la T bruta (bf = intereje) u otra. No pesa: el peso es el `pp`. */
  seccion: string;
  /**
   * Peso propio del forjado, kN/m² (H24), con las bovedillas. Sin él, con una vigueta en T, sale de
   * la sección y de la `bovedilla` (`pesoForjado.ts`); con otra sección es obligatorio.
   */
  pp?: number;
  /** De dónde sale el `pp` escrito: sólo se informa, no cambia el cálculo. */
  ppProcedencia?: Procedencia;
  /**
   * Desnivel de la cara superior del paño respecto a la cota de su planta, m (negativo, más bajo;
   * por defecto, 0): una terraza más baja o una losa enrasada por abajo con otra más gruesa (fase DN,
   * `docs/fem3d/desniveles.md`). Los nudos siguen en el plano de la planta (DN-a): cambian lo que
   * ocupa el nudo de cada pilar (ZR1), la cota de las vigas que toca y el dibujo. Dos forjados con
   * desniveles distintos que comparten un lado sin solapar en canto necesitan una viga, un muro o un
   * apoyo lineal en él (DN-b).
   */
  desnivel?: number;
  /** Bovedilla, para el peso sin `pp`. Por defecto, "hormigon". */
  bovedilla?: "hormigon" | "ceramica" | "poliestireno";
  /** El relleno entre viguetas dado por el usuario: sustituye al estimado de la `bovedilla`. Un `pp` escrito manda. */
  relleno?: Relleno;
}

/**
 * El relleno del hueco de un forjado aligerado (el casetón o la bovedilla) dado por el usuario, de
 * una de dos formas, nunca las dos (`pesoForjado.ts`):
 * - `pesoAparente`: peso específico aparente equivalente, kN por m³ de hueco entre nervios o
 *   viguetas (no la densidad del material de la pieza: la pieza tiene sus propios huecos);
 * - `pesoPieza` (kg por pieza) y `piezasM2` (piezas por m² de forjado): el relleno pesa
 *   pesoPieza·piezasM2·9,80665/1000 kN/m².
 */
export interface Relleno {
  /** Peso específico aparente equivalente, kN/m³ de hueco. */
  pesoAparente?: number;
  /** Peso de una pieza, kg (con `piezasM2`). */
  pesoPieza?: number;
  /** Piezas por m² de forjado (con `pesoPieza`). */
  piezasM2?: number;
  procedencia?: Procedencia;
}

/** De dónde sale un dato de peso: estimado (de predimensionamiento), de un fabricante o del usuario, con su fuente («Ficha X, 2025»). */
export interface Procedencia {
  origen: "estimado" | "fabricante" | "usuario";
  fuente?: string;
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
  /** C5: banda de pilares o central (Anejo I). Una banda dibujada por el usuario puede no tenerlo. */
  tipo?: "pilares" | "central";
  /**
   * C5 (D5): "propuesta" si la dio `proponerBandas` y no se ha tocado; "usuario" si la creó o la
   * editó (la memoria las distingue). Por defecto, "usuario".
   */
  origen?: "propuesta" | "usuario";
  /**
   * C5.2: tramos del eje ocupados por apoyos (la huella de un pilar, o la línea de sus caras en una
   * banda central), como [desde, hasta] en m desde `desde`. Sus extremos son las caras: se siembran
   * a lo ancho de la banda (cortes exactos por fuerzas nodales, E5-5) y son las estaciones de los
   * momentos de apoyo; los centros entre apoyos, las de vano. Sin ellos, la banda sólo se siembra
   * por su contorno (C2).
   */
  apoyos?: readonly (readonly [number, number])[];
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
  /**
   * Eje en planta, m: polilínea de al menos dos puntos; cada tramo es un paño plano. Un muro cerrado
   * (un núcleo) repite el primer punto al final.
   */
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
  /** Fase BN: barras entre dos puntos, cada uno en su planta. */
  barras?: readonly Barra[];
  apoyos?: readonly ApoyoFisico[];
  losas?: readonly Losa[];
  apoyosLineales?: readonly ApoyoLineal[];
  bandas?: readonly Banda[];
  muros?: readonly Muro[];
  /** C4: paños de forjado unidireccional. */
  panos?: readonly PanoUnidireccional[];
  casos: readonly CasoFisico[];
  cargas?: readonly CargaFisica[];
  /** I2: ejes de replanteo, sólo para el dibujo. No entran en el cálculo ni en la huella. */
  ejes?: readonly EjeReplanteo[];
  /**
   * Fase VS: las acciones que el programa genera desde la situación del edificio. Sus casos y sus
   * cargas no se escriben: el compilador los añade al final de `casos` y de `cargas`.
   */
  acciones?: AccionesEdificio;
}

/** Fase VS (`docs/fem3d/viento-sismo.md`): las acciones generadas. VS1, el viento; VS2, las masas y los modos del sismo; VS3, su espectro y sus casos. */
export interface AccionesEdificio {
  /**
   * Dónde está la obra, común al viento y al sismo: de la provincia sale la zona eólica del viento
   * (si no se escribe la suya), del municipio, su ab y su K del sismo (si no se escriben), y la
   * altitud vale para los dos. Un `ine` o una `altitud` escritos en el viento o en el sismo mandan.
   */
  emplazamiento?: EmplazamientoEdificio;
  viento?: VientoEdificio;
  sismo?: SismoEdificio;
  /**
   * La nieve del emplazamiento: lo que el usuario fuerza de ella. No genera casos ni cargas (dónde va
   * la nieve lo decide el usuario: el caso S y sus cargas se escriben); de la provincia y la altitud
   * del emplazamiento sale sk, que la app propone como q = μ·sk en las cargas del caso de nieve, y el
   * compilador avisa si el ψ del caso no es el de la altitud. Basta `acciones.emplazamiento` para que
   * salga sk: esto sólo hace falta para cambiar algo.
   */
  nieve?: NieveEdificio;
  /**
   * Fase SO (`docs/fem3d/segundo-orden.md`): el segundo orden global (P-Δ) por el coeficiente de
   * estabilidad global de cada hipótesis horizontal (viento y sismo, casos con acción W o E) en cada
   * combinación, γz = 1 / (1 − Q), que multiplica el factor de esa hipótesis en la combinación. Por
   * defecto, activado en cuanto hay hipótesis horizontales. Basta con no escribirlo.
   */
  segundoOrden?: SegundoOrdenEdificio;
}

/**
 * El segundo orden global (SO). Q = Σ_k γ_k·M_Pδ,k / M_H por hipótesis horizontal y combinación, con
 * M_H = Σ H·z su momento volcador, M_Pδ,k = Σ P·δ el de las cargas verticales del caso gravitatorio k
 * en los desplazamientos de la hipótesis (los del sismo, por μ) y γ_k el factor del caso k en la
 * combinación. Es el método de la memoria de CYPECAD y el del CE Anejo 19 H.2. Con él, los pilares
 * se comprueban como intraslacionales (β = 1).
 */
export interface SegundoOrdenEdificio {
  /**
   * ¿Se amplifican las hipótesis horizontales en las combinaciones? Por defecto, sí. Con false, las
   * combinaciones son las de primer orden (y la estructura traslacional pide β > 1 en sus pilares).
   */
  amplificar?: boolean;
  /**
   * Multiplicador de los desplazamientos del cálculo (hecho con las secciones brutas) para tener en
   * cuenta la fisuración: 1 es la rigidez bruta (lo que CYPECAD trae por defecto), 2 la rigidez al
   * 50 % del Código Modelo CEB-FIP 1990 (lo que recomienda la memoria de CYPECAD) y 3 la rigidez
   * nominal del hormigón fisurado del CE Anejo 19 H.1.2(3), 0,4·Ecd·Ic (1,5 sin fisurar, 0,8·Ecd·Ic).
   * Por defecto, 2.
   */
  multiplicadorDesplazamientos?: number;
}

/** Lo que se fuerza de la nieve del emplazamiento (DB SE-AE art. 3.5 y Anejo E). */
export interface NieveEdificio {
  /** Zona de clima invernal de la figura E.2, de 1 a 7. Por defecto, la de la provincia (la de su capital). */
  zonaInvernal?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /**
   * ¿La obra está en la capital de la provincia? Con true, sk sale de la tabla 3.8; con false, de la
   * E.2 por la zona y la altitud. Por defecto, sí si el municipio del emplazamiento es la capital.
   */
  capital?: boolean;
  /** Art. 3.5.1-3: "protegida" de la acción del viento (−20 %) o "expuesta" (+20 %). Por defecto, "normal". */
  exposicion?: "normal" | "protegida" | "expuesta";
  /** Sobrecarga de nieve sobre terreno horizontal escrita, kN/m² (ordenanza municipal, datos empíricos): manda sobre las tablas. */
  sk?: number;
}

/**
 * El emplazamiento de la obra (VS4, a petición del usuario: como los datos de la obra de Concreta,
 * `lib/obra`, que comparten viento, nieve y sismo). Se busca con `fem emplazamiento <municipio>`.
 */
export interface EmplazamientoEdificio {
  /**
   * Código INE de la provincia, de 2 cifras ("29" es Málaga): decide la zona eólica de la figura
   * D.1 (la de su capital; el aviso de frontera lo dice si la figura parte la provincia). Con `ine`,
   * sus dos primeras cifras, y si se dan los dos tienen que casar.
   */
  provincia?: string;
  /**
   * Código INE del municipio, de 5 cifras ("29008" es Alhaurín el Grande). Si está en la tabla del
   * Anejo 1 de la NCSE-02, de él salen ab y K (es el `ine` del sismo cuando el sismo no lleva el
   * suyo); si no está, es un error: no estar en el Anejo 1 no es estar exento. Un municipio que no
   * figura se escribe sólo con `municipio` y la provincia.
   */
  ine?: string;
  /** Nombre del municipio. Con `ine` tiene que ser el de ese código; sin él, sólo se imprime. */
  municipio?: string;
  /** Altitud topográfica, m: la del viento (el DB no es aplicable por encima de 2 000 m) si no lleva la suya. */
  altitud?: number;
}

/**
 * Sismo de la NCSE-02 (fase VS). Con VS2, sus masas y sus modos de vibración: basta `"sismo": {}`
 * para que el cálculo dé la masa, el centro de masas y la inercia de giro de cada planta con
 * diafragma rígido, y los periodos y las formas de todos sus modos (`fem consultar modos`).
 *
 * Con VS3, y con la aceleración básica `ab` del emplazamiento, el análisis por espectros de respuesta
 * (art. 3.6.2, el método de referencia): cuatro casos del programa, `EX+e`, `EX-e`, `EY+e` y `EY-e`
 * (el sismo según X y según Y, con la excentricidad accidental a un lado y al otro; familias `EX` y
 * `EY`), que entran en las combinaciones de la situación sísmica con su ± y con el 30 % de la otra
 * dirección. No son casos con cargas: el valor de cada resultado (un esfuerzo, una reacción, un
 * desplazamiento) es la combinación de los valores de todos los modos de vibración, con el signo del
 * modo de más masa en esa dirección, más el del torsor de la excentricidad. Con `ab` hacen falta
 * `K`, `terreno` y `mu`. Sin `ab`, sólo las masas y los modos.
 *
 * VS4: `ab` y `K` salen también del municipio, por su código INE (`ine`), de la tabla del Anejo 1
 * de la norma (`src/normas/peligrosidad.ts`; `fem emplazamiento <nombre>` da el código). Con `ine`
 * hay espectro como con `ab`; un `ab` o un `K` escritos mandan sobre los de la tabla, cada uno por
 * su lado. Un código que no está en la tabla es un error: no estar en el Anejo 1 no es estar exento.
 *
 * La masa sale de las cargas (art. 3.2): de cada caso, la fracción que le toca de la componente
 * vertical de sus cargas, entre g. Por defecto, la de su acción:
 * - G (y el caso del peso propio), 1;
 * - Q, por el nombre de su ψ: "uso-A", 0,5; "uso-B", "uso-C" y "uso-D", 0,6; "uso-E", 0,6 y
 *   "uso-G", 0 (estas dos no están en la norma);
 * - S, 0,5 si la nieve permanece más de 30 días al año (`nievePermanente`) y 0 si no;
 * - W, T, E, A y N, 0.
 *
 * Un caso Q o S sin ψ por su nombre, o sin acción, necesita su fracción en `masas`. Todas las plantas
 * con forjado, salvo la más baja, tienen que tener diafragma rígido.
 */
export interface SismoEdificio {
  /**
   * Fracción de la carga de un caso que cuenta como masa, de 0 a 1, en lugar de la de su acción
   * (1 en un almacén o un archivo, o en un depósito de agua, por ejemplo).
   */
  masas?: readonly { caso: string; fraccion: number }[];
  /**
   * ¿Permanece la nieve más de 30 días al año? Si no se da, se toma que sí en los casos con el ψ
   * "nieve-mas-de-1000" y que no en los de "nieve-hasta-1000".
   */
  nievePermanente?: boolean;
  /**
   * VS4. Código INE del municipio, de 5 cifras ("29008" es Alhaurín el Grande): `ab` y `K` salen de
   * la tabla del Anejo 1 de la norma, salvo los que se escriban. Por defecto, el de
   * `acciones.emplazamiento` (lo normal es escribirlo allí, común al viento). Los nombres, como en la publicación
   * del sismo de Concreta (`ine` y `municipio`). Se busca con `fem emplazamiento`, nunca de memoria.
   */
  ine?: string;
  /**
   * Nombre del municipio, para quien lee el fichero. No decide nada: con `ine`, tiene que ser el de
   * ese código (si no, es un error: uno de los dos está mal), y sin `ine` sólo acompaña a un `ab` y
   * un `K` escritos a mano.
   */
  municipio?: string;
  /**
   * VS3. Aceleración sísmica básica del emplazamiento, en g (art. 2.1 y anejo 1 de la norma, por
   * municipio): 0,11 es 0,11 g. Con ella se calculan los casos del sismo. Escrita, manda sobre la
   * del municipio.
   */
  ab?: number;
  /** Coeficiente de contribución K del emplazamiento (anejo 1): de 1,0 a 1,3. Escrito, manda sobre el del municipio. */
  K?: number;
  /** Importancia de la construcción (art. 1.2.2): ρ = 1,0 con "normal" (por defecto) y 1,3 con "especial". */
  importancia?: "normal" | "especial";
  /**
   * Terreno de cimentación (art. 2.4): su tipo ("I", C = 1,0; "II", 1,3; "III", 1,6; "IV", 2,0), su
   * coeficiente C, o los estratos de los 30 primeros metros bajo la superficie, de arriba abajo, cada
   * uno con su tipo o su C y su espesor en metros (se ponderan).
   */
  terreno?: TipoTerrenoSismo | number | readonly { tipo?: TipoTerrenoSismo; C?: number; espesor: number }[];
  /**
   * Coeficiente de comportamiento por ductilidad μ (art. 3.7.3.1): 1 (sin ductilidad), 2 (baja), 3
   * (alta) o 4 (muy alta), según la organización estructural y los detalles del capítulo 4. Uno para
   * las dos direcciones o uno por dirección.
   */
  mu?: number | { x: number; y: number };
  /** Amortiguamiento Ω, en % del crítico (tabla 3.1). Por defecto, 5. */
  omega?: number;
  /**
   * Regla de combinación de los modos: "cqc" (por defecto), la combinación cuadrática completa con el
   * amortiguamiento Ω, la «expresión general» del comentario C.3.6.2.4; o "srss", la simplificación
   * del art. 3.6.2.4 (raíz de la suma de los cuadrados, con los modos de periodos a menos del 10 %
   * sumados en valor absoluto). La CQC no depende de cómo gire la malla dos modos de igual periodo
   * (VS-f, `viento-sismo.md` §14).
   */
  regla?: "srss" | "cqc";
  /**
   * Excentricidad accidental, como fracción de la dimensión de cada planta perpendicular al sismo.
   * Por defecto, 0,05 (el 1/20 del art. 3.2, que es el mínimo); 0, sin ella.
   */
  excentricidad?: number;
  /**
   * Sistema estructural, para el periodo fundamental aproximado del art. 3.7.2.2 con el que se
   * contrasta el cortante en la base (método simplificado): "porticos-ha", "porticos-ha-pantallas",
   * "porticos-acero", "acero-triangulado" o "fabrica". No cambia el cálculo.
   */
  sistema?: "fabrica" | "porticos-ha" | "porticos-ha-pantallas" | "porticos-acero" | "acero-triangulado";
}

/** Tipo de terreno de la NCSE-02 (art. 2.4). */
export type TipoTerrenoSismo = "I" | "II" | "III" | "IV";

/**
 * Viento del CTE DB SE-AE (art. 3.3, Anejo D) para el análisis global (VS1). Da 8 casos del
 * programa, de la familia `viento`: según X e Y, en los dos sentidos y con la excentricidad del
 * 5 % a un lado y al otro (`W+X+e`, `W+X-e`, `W-X+e`, `W-X-e` y los cuatro según Y).
 *
 * En cada sentido y cada planta sobre la rasante, F = (cp − cs) · qb · ce(z) · A, con z la cota de
 * la planta sobre la rasante, cp y cs de la tabla 3.5 por la esbeltez del edificio en esa
 * dirección y A el área de la fachada que le toca: en cada punto del ancho, la banda de media planta
 * por debajo y por encima entre las plantas que hay en ese punto (las que lo cubren con sus losas y
 * paños, o con sus vigas si no los tiene). Va como una puntual horizontal en la planta, en el centro de su
 * banda desplazado ±e (con el diafragma rígido, exacta: SP-5).
 */
export interface VientoEdificio {
  /**
   * Zona eólica de la figura D.1: qb = 0,42 (A), 0,45 (B) o 0,52 (C) kN/m². Por defecto, la de la
   * provincia del emplazamiento (`acciones.emplazamiento`); escrita, manda (la figura va por líneas,
   * no por provincias).
   */
  zona?: "A" | "B" | "C";
  /** Presión dinámica, kN/m², en lugar de la de la zona (0,5 es el valor simplificado del art. 3.3.2-1). */
  qb?: number;
  /**
   * Grado de aspereza del entorno (tabla 3.4): I, borde del mar o de un lago; II, terreno rural
   * llano; III, zona rural accidentada; IV, zona urbana, industrial o forestal; V, centro de
   * negocios de una gran ciudad.
   */
  aspereza: "I" | "II" | "III" | "IV" | "V";
  /**
   * Altitud del emplazamiento, m: el DB no es aplicable por encima de 2 000 m (art. 3.3.1-2). Por
   * defecto, la de `acciones.emplazamiento`.
   */
  altitud?: number;
  /** Cota de la rasante, m: la de la fachada a barlovento (art. 3.3.3-1). Por defecto, la ±0,00. */
  rasante?: number;
  /**
   * Área de la fachada de la banda de una planta, m², en lugar de la que sale del modelo: para el
   * viento según X (`x`, la fachada perpendicular a X) y según Y (`y`).
   */
  fachadas?: readonly { planta: string; x?: number; y?: number }[];
}

/**
 * Eje de replanteo (I2, `docs/fem3d/interfaz.md` §9): una recta en planta para los alzados, las
 * burbujas y las cotas del dibujo, y para nombrar posiciones. Se ve en todas las plantas. El
 * compilador lo ignora, así que no cambia la huella ni los resultados; sin ejes, el dibujo usa los
 * que propone `ejes.ts` con las alineaciones de los pilares.
 */
export interface EjeReplanteo {
  /** Lo que dicen sus burbujas, si no tiene `nombre` («A», «1»). Único en todo el modelo, como los demás ids. */
  id: string;
  nombre?: string;
  /** Sus dos extremos en planta, m (distintos); las burbujas van en ellos. */
  desde: Vec2;
  hasta: Vec2;
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
  /** Viguetas de los paños unidireccionales (C4). Su torsión ya va liberada (C4-c). */
  viguetas?: ModificadoresPieza;
  /** Barras entre dos niveles (fase BN). D4 no las toca. */
  barras?: ModificadoresPieza;
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

/** Coeficiente de empotramiento por defecto de la cabeza del último tramo de pilar (CY-b, decidido el 2026-10-15; el de CYPECAD). */
export const EMPOTRAMIENTO_CABEZA = 0.3;
/** RV-a: la flexión de las vigas planas en un reticular «uniforme», como en CYPECAD (`fase-lv.md` §2.4). */
export const RIGIDEZ_VIGAS_PLANAS = 0.6;
/** Factor de zona rígida por defecto (C1-a, decidido el 2026-10-04): la mitad del nudo es rígida. */
export const FACTOR_ZONA_RIGIDA = 0.5;
/** Ancho de las franjas de armado de una losa maciza por defecto, m (fase F, F-a). */
export const ANCHO_FRANJA = 1;

/**
 * Tamaño de malla por defecto de las losas, m (C2-a): triángulos de 2h divididos en 3
 * cuadriláteros de ~0,76·h de lado, unos 10 por vano de 5,5 m (H10 pide 8). Con él, el edificio
 * objetivo cabe en D9.
 */
export const TAMANO_MALLA = 0.75;

/**
 * Plantilla de esquina (fase LV2, §8 de la cabecera de `rejilla.ts`): la graduada parte el elemento de
 * la esquina en 3 hacia ella `niveles` veces en los cruces con pilar y `nivelesSinPilar` veces en los
 * cruces sin pilar (el de un zuncho o una viga secundaria con otra viga); sin `nivelesSinPilar`, los
 * mismos niveles en todos los cruces. La de tercios (sólo para medir, §6 de `refinamiento-vigas.md`)
 * parte la celda en tercios, con uno o dos niveles.
 */
export interface PlantillaEsquina {
  tipo: "tercios" | "graduada";
  /** Entero en [1, 4]. */
  niveles: number;
  /** Entero en [1, niveles]. */
  nivelesSinPilar?: number;
}

/**
 * Plantilla de esquina por defecto (LV2-i, 2026-10-18): 3 niveles en los cruces con pilar y 2 en los
 * demás (allí el tercer nivel no cambia ninguna estación de franja y cuesta un 7 % de los nudos).
 */
export const PLANTILLA_ESQUINA: Readonly<PlantillaEsquina> = Object.freeze({ tipo: "graduada", niveles: 3, nivelesSinPilar: 2 });

/**
 * Jacobiano escalado mínimo de una plantilla refinada (F2, LV2); por debajo, se queda sin refinar. El
 * mismo que el aviso de calidad de la malla (`JACOBIANO_BAJO` de `mallado.ts`): el refinamiento nunca
 * deja un cuadrilátero que lo dispare.
 */
export const JACOBIANO_REFINO = 0.2;

/**
 * Fracción mínima del área de una banda en las losas de su planta (C5): la propuesta descarta las
 * que quedan por debajo, y el compilador avisa de las editadas.
 */
export const FRACCION_MINIMA_BANDA = 0.5;

export interface OpcionesCompilacion {
  /** Tolerancia numérica, m: fusión silenciosa. Por defecto, 1e-6. */
  epsGeom?: number;
  /** Tolerancia de modelado, m: fusión con aviso. Por defecto, 0,05 (H28). */
  epsSnap?: number;
  /**
   * Fracción rígida de los nudos de dimensión finita en las vigas y viguetas, en [0, 1] (C1-a): de lo
   * que su eje recorre dentro de la huella del pilar. Por defecto, 0,5. Con 1, hasta la cara del
   * pilar; con 0, de eje a eje.
   */
  factorZonaRigida?: number;
  /**
   * Fracción rígida del nudo en los tramos de pilar, en [0, 1] (ZR1): de lo que el nudo físico ocupa
   * por debajo del plano del forjado en la cabeza y por encima en la base (`planoForjado`). Con el
   * plano en la cara superior (por defecto), todo el canto de la losa o de la viga más alta por debajo
   * y nada por encima; con el plano medio, medio canto de la losa o de una viga con el eje en el plano
   * por debajo (el canto entero de una viga con la cara superior en él) y por encima (con
   * `zonaRigidaBase`). Por defecto, 1 (hasta la cara), salvo con `factorZonaRigida: 0`,
   * que deja también los pilares de eje a eje.
   */
  factorZonaRigidaPilares?: number;
  /**
   * Plano de los nudos del forjado (RV-b, `fase-lv.md` §2.3). "superior" (por defecto): la
   * cota de la planta es la cara superior del forjado, y las láminas de la losa y el eje
   * de las vigas van en ella; el nudo físico de un pilar ocupa por debajo todo el canto de la losa de
   * su huella o de la viga más alta que le llega, y nada por encima. La cabeza de cada tramo es
   * rígida en ese canto y la base arranca en el nudo (`zonaRigidaBase` no actúa). "medio" (C1–ZR1):
   * la cota es el plano medio de la losa, y el nudo ocupa medio canto por debajo y medio por encima.
   * No es un hecho físico (la losa trabaja en su plano medio), sino el convenio habitual de los planos:
   * entre dos forjados del mismo canto la altura libre es la misma, pero la cabeza tiene de brazo el
   * canto entero y la base ninguno (en el pilar de esquina, +12–25 % de momento en el pie). Bajo el
   * primer forjado, la altura libre es la altura menos el canto entero.
   */
  planoForjado?: "superior" | "medio";
  /**
   * Coeficiente de empotramiento de la cabeza del último tramo de cada pilar, en [0, 1] (CY2, CY-b).
   * Por defecto, 0,3: la cabeza, con poco axil, fisura y no desarrolla el
   * empotramiento elástico. Se multiplica por el `empotramiento.cabeza` del pilar. No se aplica al
   * pilar sobre el que arranca otro en su cabeza. Con 1, la cabeza empotrada de antes de CY2.
   */
  empotramientoCabeza?: number;
  /**
   * Rigidez de los forjados reticulares (CY3, CY-c). "uniforme" (por defecto): la
   * zona aligerada y los ábacos con la mitad de la flexión de la maciza y la torsión de su
   * emparrillado, sin Poisson; como fisurados, los ábacos no se llevan los momentos de los vanos.
   * "bruta" (C4-h): la zona aligerada con la T bruta de sus nervios y los ábacos macizos. Los
   * `multiplicadores` dados en la losa mandan sobre las dos.
   */
  rigidezReticular?: "uniforme" | "bruta";
  /**
   * Flexión de las vigas planas en un reticular (RV-a, `fase-lv.md` §2.4), en (0, 1]: el `Iy` de los
   * tramos de viga de hormigón rectangular con un canto no mayor que el del forjado que tienen a uno
   * o a los dos lados un reticular «uniforme» (con `rigidezReticular: "uniforme"` y sin
   * `multiplicadores` dados), y ninguna otra losa, se multiplica por este factor (encima de los
   * `modificadores`). Por defecto, 0,6: un ajuste empírico (modelo A con vigas planas de 30 y
   * de 50: ±11 %, y del lado seguro en la viga). No rebaja las vigas descolgadas ni las de una losa
   * maciza. Con 1, nada.
   */
  rigidezVigasPlanas?: number;
  /**
   * Unión de las losas con las vigas de hormigón rectangulares (fase LV, CY-g). "cara" (por
   * defecto): el ancho de la viga no es losa, y los nudos de la losa en sus caras van
   * unidos a su eje por un enlace rígido; lo que cae en el ancho pasa a la viga. "eje" (C2-c, C2-e):
   * la losa llega al eje de la viga y la viga se parte en los nudos de la malla sobre él.
   */
  unionLosaViga?: "cara" | "eje";
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
  /**
   * Rejilla alineada en las zonas regulares de las losas (H52, C2-a): cuadriláteros de ≤ h en los
   * ejes de la losa donde la planta lo permite, y la triangulación restringida sólo alrededor de lo
   * que no cae en ella. Por defecto, sí; sin ella, toda la losa va por la triangulación.
   */
  rejilla?: boolean;
  /**
   * Torsión de equilibrio (C4-k): en los tramos de viga que sujetan viguetas en voladizo sin otro
   * apoyo en su línea (ni vano de atrás ni otra vigueta que compense su momento), la torsión no se
   * reduce: los modificadores de J menores que 1 (D4) no se aplican. Por defecto, sí.
   */
  torsionEquilibrio?: boolean;
  /**
   * Franjas de armado (fase F): las caras de los pilares se siembran en la malla de las losas, de lo
   * ancho de las franjas que tocan, para que el momento de esas franjas en la cara sea exacto. Por
   * defecto, sí; sin ellas, la malla de C1–C5.
   */
  franjas?: boolean;
  /** Ancho de las franjas de armado de las losas macizas, m (F-a). Por defecto, 1. En un reticular, el intereje. */
  anchoFranja?: number;
  /**
   * Refinamiento de la malla junto a las caras de los pilares de las franjas (fase F2): en su
   * plantilla de la rejilla, el primer tramo a cada lado de la cara se parte en tercios. Por defecto,
   * sí; sin él, la malla de F1.1 (con R0).
   */
  refinoCaras?: boolean;
  /**
   * Refinamiento de la malla en las esquinas de los paños de losa unidos a las vigas por sus caras
   * (fase LV2): en la celda de la rejilla de cada esquina en la que se encuentran dos caras de viga, el
   * elemento de la esquina se parte hacia ella (`plantillaEsquina`: 3 niveles en los
   * cruces con pilar y 2 en los cruces sin pilar, LV2-i). Con él van también las tiras de las huellas que
   * asoman del ancho de su viga (LV-8), la plantilla de cara delante de un pilar tapado (desde la fase
   * HR, sólo la huella es rígida en todos los pilares y con todas las opciones, no sólo en los pilares
   * bajo una viga, LV2-f), y el refinamiento de Delaunay de la triangulación
   * llega también a la losa junto a las vigas (§18: el eje de una viga dentro de su ancho y las aristas
   * que no se parten ya no lo tapan con su círculo diametral; compilador LV2.1). Por defecto, sí
   * (compilador LV2, 2026-10-19); sin él, la malla de LV1.
   */
  refinoEsquinas?: boolean;
  /**
   * Plantilla de las esquinas de `refinoEsquinas`. Por defecto, `PLANTILLA_ESQUINA`. Es para medir
   * (los bancos de LV2); en un proyecto no hace falta.
   */
  plantillaEsquina?: PlantillaEsquina;
  /**
   * Jacobiano escalado mínimo de una plantilla refinada (de `refinoCaras` y `refinoEsquinas`), en
   * (0, 2]; por debajo, se queda sin refinar con su aviso. Por defecto, `JACOBIANO_REFINO` (0,2). Es
   * para medir y para forzar el respaldo en las pruebas; en un proyecto no hace falta.
   */
  jacobianoRefino?: number;
  /**
   * Zona rígida en la base de los tramos de pilar (LV-d): la base de un tramo cuyo
   * nudo inferior está en un forjado es rígida en lo que ese nudo ocupa por encima del plano del
   * forjado (medio canto de la losa en la huella del pilar o de la viga más alta que le llega con el
   * eje en el plano; una viga con la cara superior en el forjado queda entera por debajo y no cuenta),
   * por `factorZonaRigidaPilares`. Con los valores por defecto, la cara del forjado.
   * Por defecto, sí (compilador LVD1, 2026-10-20); sin ella, sólo la cabeza, como en C1. Sólo actúa
   * con `planoForjado: "medio"`: con el plano en la cara superior, el nudo no ocupa nada por encima.
   */
  zonaRigidaBase?: boolean;
  /**
   * Tiras de borde (fase TB, `anchosVigas.ts`): con la unión por las caras, la franja de losa entre
   * la cara de fuera de una viga y el borde dibujado del forjado, de hasta el ancho de la viga (el
   * zuncho por el eje de los pilares y el forjado hasta la fachada), no se malla: va con la viga como
   * su ancho, y lo que cae en ella pasa a la viga con su momento de transporte. El borde dibujado no
   * se mueve. Por defecto, sí (compilador TB1, 2026-10-28); sin ellas, esa franja se malla como losa.
   */
  tirasBorde?: boolean;
}

export interface OpcionesResueltas {
  epsGeom: number;
  epsSnap: number;
  factorZonaRigida: number;
  factorZonaRigidaPilares: number;
  planoForjado: "superior" | "medio";
  empotramientoCabeza: number;
  rigidezReticular: "uniforme" | "bruta";
  rigidezVigasPlanas: number;
  unionLosaViga: "cara" | "eje";
  cortante: boolean;
  modificadores: ModificadoresPiezas;
  tamanoMalla: number;
  rejilla: boolean;
  torsionEquilibrio: boolean;
  franjas: boolean;
  anchoFranja: number;
  refinoCaras: boolean;
  refinoEsquinas: boolean;
  /** Sólo si se da: con las de por defecto, la huella no cambia. */
  plantillaEsquina?: PlantillaEsquina;
  /** Sólo si se da, como `plantillaEsquina`. */
  jacobianoRefino?: number;
  zonaRigidaBase: boolean;
  tirasBorde: boolean;
}

export function resolverOpciones(o: OpcionesCompilacion = {}): OpcionesResueltas {
  const factorZonaRigida = o.factorZonaRigida ?? FACTOR_ZONA_RIGIDA;
  return {
    epsGeom: o.epsGeom ?? 1e-6,
    epsSnap: o.epsSnap ?? 0.05,
    factorZonaRigida,
    // ZR1: hasta la cara del nudo; «de eje a eje» (factor 0) lo es también en los pilares
    factorZonaRigidaPilares: o.factorZonaRigidaPilares ?? (factorZonaRigida === 0 ? 0 : 1),
    planoForjado: o.planoForjado ?? "superior",
    empotramientoCabeza: o.empotramientoCabeza ?? EMPOTRAMIENTO_CABEZA,
    rigidezReticular: o.rigidezReticular ?? "uniforme",
    rigidezVigasPlanas: o.rigidezVigasPlanas ?? RIGIDEZ_VIGAS_PLANAS,
    unionLosaViga: o.unionLosaViga ?? "cara",
    cortante: o.cortante ?? true,
    modificadores: o.modificadores ?? MODIFICADORES_D4,
    tamanoMalla: o.tamanoMalla ?? TAMANO_MALLA,
    rejilla: o.rejilla ?? true,
    torsionEquilibrio: o.torsionEquilibrio ?? true,
    franjas: o.franjas ?? true,
    anchoFranja: o.anchoFranja ?? ANCHO_FRANJA,
    refinoCaras: o.refinoCaras ?? true,
    refinoEsquinas: o.refinoEsquinas ?? true,
    ...(o.plantillaEsquina !== undefined ? { plantillaEsquina: o.plantillaEsquina } : {}),
    ...(o.jacobianoRefino !== undefined ? { jacobianoRefino: o.jacobianoRefino } : {}),
    zonaRigidaBase: o.zonaRigidaBase ?? true,
    tirasBorde: o.tirasBorde ?? true,
  };
}
