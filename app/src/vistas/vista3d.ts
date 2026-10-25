/**
 * Vista 3D (I2, `docs/fem3d/interfaz.md` §5 y §14): el alámbrico del modelo físico
 * (`src/visor/alambrico.ts`) o el analítico (la malla de V1, con la deformada en Resultados), en
 * perspectiva u ortográfica.
 *
 * - Cámara: posición C y objetivo T, Z hacia arriba. Orbitar gira C y T alrededor del punto bajo el
 *   cursor (en el plano de T); desplazar los mueve en el plano de la pantalla; la rueda acerca hacia
 *   el cursor. La ortográfica mide lo mismo que la perspectiva a la distancia de T.
 * - Elegir: los segmentos del alámbrico proyectados en pantalla; gana el más cercano al cursor a
 *   menos de 6 px (y, empatados, el más cercano a la cámara). Por ventana: «dentro», todos sus
 *   segmentos dentro; «toca», alguno que la corta.
 * - ViewCube en la esquina: sus caras llevan a las seis vistas estándar y sus esquinas de arriba, a
 *   las cuatro isométricas.
 *
 * Los colores del alámbrico y del analítico se reescriben en sitio (bucles planos sobre arrays): ni
 * la planta activa ni lo elegido rehacen la geometría (H42). Los materiales son de la página y no se
 * liberan, como los de la planta (`capas.ts`, I2-4).
 *
 * Resultados (I4): los diagramas de las barras (`src/visor/diagramas3d.ts`), rellenos translúcidos
 * por signo con sus curvas; los isovalores de las losas y los muros (`src/visor/isovalores3d.ts`),
 * bandas de color sin sombrear (el color es el de la leyenda) con sus isolíneas; los pilares por
 * colores (`pilares3d.ts`), líneas gruesas del color de su banda; las reacciones
 * (`reacciones3d.ts`), flechas; y la deformada, animada si se pide, con la original en gris. Las
 * cargas de un caso (`cargas3d.ts`, en Cargas), bloques translúcidos con sus flechas: los filtros las
 * tratan como a su pieza (rango de plantas, tipos, aislar y ocultar), se eligen con un clic (la más
 * cercana a menos de 6 px, o su bloque bajo el cursor; en sólido, si no la tapa una pieza) o por
 * ventana, y las elegidas se resaltan encima como las piezas elegidas (gruesas, en el acento). Los
 * rótulos, en el lienzo 2D: los extremos de lo que se ve y los de las piezas elegidas, sin pisarse.
 *
 * Bajo el cursor (I4): al quedarse quieto el ratón, la vista busca lo que hay debajo (la estación de
 * un diagrama, el punto de un mapa, un tramo de pilar o una flecha) y lo dice por `eventos.pasar`;
 * quien la alimenta pide su consulta y le devuelve la sonda que dibuja (`ponerSonda`).
 *
 * Sólido (I3, `src/visor/solido.ts`): las secciones extruidas con sus aristas, opaco o translúcido
 * (al 35 %, con el alámbrico encima), por material, sección o planta. En sólido se elige la pieza
 * que se ve bajo el cursor (un rayo contra sus triángulos). Los filtros (rango de plantas, tipos,
 * aislar y ocultar) rehacen los índices de lo que se pinta, no la geometría; la caja de sección son
 * seis planos de recorte, los mismos en todos los materiales del 3D (siempre seis: lejos si no hay
 * caja, para no recompilar los programas al encenderla).
 *
 * Fondo (`fondo.ts`): un degradado suave y, en la cota más baja, un suelo con rejilla y los ejes
 * del origen; sin nada dibujado, encuadra `CAJA_VACIA`.
 */
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Scene,
  Sphere,
  Vector3,
  type Material,
  type WebGLRenderer,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { rotulo } from "../../../src/agente/render/escena.ts";
import type { Alambrico } from "../../../src/visor/alambrico.ts";
import type { Solido } from "../../../src/visor/solido.ts";
import type { Geometria3D } from "../../../src/visor/datos.ts";
import type { Diagramas3D } from "../../../src/visor/diagramas3d.ts";
import type { MallaIsovalores } from "../../../src/visor/isovalores3d.ts";
import { SIN_BANDA, type Pilares3D } from "../../../src/visor/pilares3d.ts";
import { COLOR_REACCION, type Reacciones3D } from "../../../src/visor/reacciones3d.ts";
import { CLASES_CARGA, COLOR_CARGA, type Cargas3D } from "../../../src/visor/cargas3d.ts";
import type { ExtremoDeformada } from "../../../src/visor/datos.ts";
import { pintura } from "../lienzo/pintura.ts";
import { CAJA_VACIA, Degradado, Suelo3D } from "./fondo.ts";
import { fuente, textoConHalo, Vista, type Entorno } from "./motor.ts";
import { MATERIALES_3D } from "./renderer.ts";

export type Modo3D = "alambrico" | "solido" | "translucido" | "analitico";
export type Proyeccion = "perspectiva" | "ortografica";
/** Color del sólido (I3). */
export type Color3D = "material" | "seccion" | "planta";

/** Los tipos de objeto que se pueden ocultar en un 3D (I3). */
export const TIPOS_FILTRO = ["pilar", "viga", "losa", "pano", "muro", "apoyo"] as const;
export type TipoFiltro = (typeof TIPOS_FILTRO)[number];

/** Caja de sección, en coordenadas del modelo: [xmin, ymin, zmin, xmax, ymax, zmax]. */
export type CajaSeccion = [number, number, number, number, number, number];

/**
 * Los filtros de un 3D (I3, `interfaz.md` §16): de la planta `desde` (la de abajo) a la `hasta` (la
 * de arriba), los tipos que no se ven, lo aislado (sólo eso) y lo oculto, y la caja de sección.
 */
export interface FiltroVista {
  desde?: string | null;
  hasta?: string | null;
  sinTipos?: TipoFiltro[];
  aislados?: string[] | null;
  ocultos?: string[];
  caja?: CajaSeccion | null;
}

/** ¿Filtra algo (sin contar la caja)? */
export const filtra = (f: FiltroVista | undefined): boolean => !!f && (!!f.desde || !!f.hasta || !!f.sinTipos?.length || !!f.aislados || !!f.ocultos?.length);

export interface Camara3D {
  C: [number, number, number];
  T: [number, number, number];
}

/** Lo que hay bajo el cursor (I4): `p`, el punto del modelo (m, globales). */
export type Objetivo3D =
  | { tipo: "barra"; pieza: string; s: number; p: [number, number, number] }
  | { tipo: "lamina"; lamina: number; p: [number, number, number] }
  | { tipo: "pilar"; k: number; p: [number, number, number] }
  | { tipo: "reaccion"; k: number; p: [number, number, number] };

/** Lo que dice la vista de un punto bajo el cursor: sus líneas de texto (de una consulta). */
export interface Sonda {
  p: readonly [number, number, number];
  lineas: string[];
}

export interface Eventos3D {
  /** Lo elegido con un clic (null: nada bajo el cursor) o con una ventana. */
  elegir?: (ids: string[], ctrl: boolean, doble: boolean) => void;
  /** La caja de sección movida con sus asas (I3). */
  caja?: (c: CajaSeccion) => void;
  /** Lo que hay bajo el cursor quieto (null: nada, o el cursor se fue). */
  pasar?: (o: Objetivo3D | null) => void;
}

interface Paleta3D {
  /** El sólido por material (I3), sus aristas y los apoyos. */
  hormigon: string;
  acero: string;
  general: string;
  /** La cara inferior de los casetones perdidos de un reticular. */
  caseton: string;
  apoyo: string;
  arista: string;
  pilar: string;
  viga: string;
  losa: string;
  pano: string;
  muro: string;
  activa: string;
  laminaLosa: string;
  laminaMuro: string;
  vigueta: string;
  original: string;
}

const PALETAS: Record<"light" | "dark", Paleta3D> = {
  light: { hormigon: "#c4c9d0", acero: "#8ea7c2", general: "#cdbf9c", caseton: "#e6dcc6", apoyo: "#0f766e", arista: "#1f2937", pilar: "#1e293b", viga: "#475569", losa: "#8794a3", pano: "#97835c", muro: "#64748b", activa: "#0369a1", laminaLosa: "#c9d6e3", laminaMuro: "#9aa5b1", vigueta: "#a08a5e", original: "#94a3b8" },
  dark: { hormigon: "#8b939e", acero: "#6d88a6", general: "#9b8c6a", caseton: "#a99d84", apoyo: "#2dd4bf", arista: "#0b0f14", pilar: "#d4d6db", viga: "#9aa3ae", losa: "#6b7686", pano: "#b49a68", muro: "#8a94a1", activa: "#38bdf8", laminaLosa: "#33414f", laminaMuro: "#5b6573", vigueta: "#b49a68", original: "#5b6575" },
};

/** Las vistas estándar: la dirección de T a C. */
export const VISTAS_ESTANDAR = {
  superior: [0, -1e-3, 1],
  inferior: [0, -1e-3, -1],
  frente: [0, -1, 0],
  atras: [0, 1, 0],
  izquierda: [-1, 0, 0],
  derecha: [1, 0, 0],
  so: [-1, -1, 1],
  se: [1, -1, 1],
  no: [-1, 1, 1],
  ne: [1, 1, 1],
} as const satisfies Record<string, readonly [number, number, number]>;
export type VistaEstandar = keyof typeof VISTAS_ESTANDAR;

const CARAS: { n: [number, number, number]; vista: VistaEstandar; nombre: string }[] = [
  { n: [0, 0, 1], vista: "superior", nombre: "Sup." },
  { n: [0, 0, -1], vista: "inferior", nombre: "Inf." },
  { n: [0, -1, 0], vista: "frente", nombre: "Frente" },
  { n: [0, 1, 0], vista: "atras", nombre: "Atrás" },
  { n: [-1, 0, 0], vista: "izquierda", nombre: "Izq." },
  { n: [1, 0, 0], vista: "derecha", nombre: "Der." },
];
const ESQUINAS: { p: [number, number, number]; vista: VistaEstandar }[] = [
  { p: [-1, -1, 1], vista: "so" },
  { p: [1, -1, 1], vista: "se" },
  { p: [-1, 1, 1], vista: "no" },
  { p: [1, 1, 1], vista: "ne" },
];
const FOV = 35;
const RADIO_CLIC = 6;
/** Distancia (px) a la que el cursor está sobre una barra, un pilar o una flecha. */
const RADIO_SONDA = 8;
/** Lo que el cursor tiene que estar quieto para buscar lo que hay debajo (ms). */
const PAUSA_SONDA = 90;
/** Un ciclo de la animación de la deformada (ms). */
const CICLO_DEFORMADA = 1500;
const CUBO = { margen: 58, lado: 24 };

/** Colores del sólido por sección o por planta (cíclicos). */
const CATEGORIAS = ["#8fb3d9", "#e3a972", "#9cc59b", "#d98f8f", "#b39ddb", "#d4c27a", "#80cbc4", "#c9a6a0", "#a9b4c2", "#e6b0c8"];
/** Opacidad del translúcido. */
const OPACIDAD_TRANSLUCIDO = 0.35;
/** Lado de un asa de la caja de sección (px) y lo que hay que acercarse para cogerla. */
const ASA = { lado: 9, radio: 10 };
/** Una caja de sección no puede quedar más estrecha (m). */
const CAJA_MINIMA = 0.1;
const LEJOS = 1e7;

/**
 * Los seis planos de la caja de sección, los mismos objetos en todos los materiales del 3D: cada
 * vista pone los suyos antes de pintarse (sin caja, lejos).
 */
const PLANOS = [new Plane(new Vector3(1, 0, 0), LEJOS), new Plane(new Vector3(0, 1, 0), LEJOS), new Plane(new Vector3(0, 0, 1), LEJOS), new Plane(new Vector3(-1, 0, 0), LEJOS), new Plane(new Vector3(0, -1, 0), LEJOS), new Plane(new Vector3(0, 0, -1), LEJOS)];

/** Vértices de cada lámina: dos triángulos, 0-1-2 y 0-2-3. */
const ESQ_LAMINA = [0, 1, 2, 0, 2, 3];

/** Los materiales del 3D, de la página (la resolución de las líneas se pone antes de pintar cada vista). */
const MAT = {
  lineas: new LineMaterial({ vertexColors: true, linewidth: 1.5, worldUnits: false }),
  elegidas: new LineMaterial({ linewidth: 3.5, worldUnits: false, depthTest: false, transparent: true }),
  laminas: new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.82, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
  barras: new LineBasicMaterial({ vertexColors: true }),
  originales: new LineBasicMaterial({ transparent: true, opacity: 0.45 }),
  // I4: diagramas e isovalores
  positivo: new MeshBasicMaterial({ side: DoubleSide, transparent: true, opacity: 0.5, depthWrite: false }),
  negativo: new MeshBasicMaterial({ side: DoubleSide, transparent: true, opacity: 0.5, depthWrite: false }),
  curvas: new LineMaterial({ vertexColors: true, linewidth: 1.25, worldUnits: false }),
  bandas: new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
  sinMapa: new MeshBasicMaterial({ side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
  isolineas: new LineBasicMaterial({ color: 0x1f2937, transparent: true, opacity: 0.35 }),
  ceros: new LineBasicMaterial({ color: 0x111827, transparent: true, opacity: 0.8 }),
  pilares: new LineMaterial({ vertexColors: true, linewidth: 7, worldUnits: false }),
  reacciones: new LineMaterial({ vertexColors: true, linewidth: 2.5, worldUnits: false }),
  // Las cargas: flechas y bloques translúcidos
  cargas: new LineMaterial({ vertexColors: true, linewidth: 1.5, worldUnits: false }),
  bloques: new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.2, depthWrite: false }),
  /** El alámbrico sin deformar, bajo la deformada. */
  original: new LineMaterial({ linewidth: 1, worldUnits: false, transparent: true, opacity: 0.55 }),
  // I3: el sólido, opaco y translúcido, y sus aristas
  // Sombreado plano: la normal de cada cara sale en el shader, sin un búfer de normales
  solido: new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  translucido: new MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: OPACIDAD_TRANSLUCIDO, depthWrite: false }),
  aristas: new LineBasicMaterial({ transparent: true, opacity: 0.55 }),
  /** La caja de sección. */
  caja: new LineBasicMaterial({ transparent: true, opacity: 0.9, depthTest: false }),
};
/**
 * Las aristas del sólido, un poco hacia la cámara (2·10⁻⁴ de su distancia: 1,6 cm a 80 m) para que
 * ganen a la cara en la que están sin que se vean las que quedan a unos centímetros detrás (los
 * nervios de un reticular bajo su capa). Un polygonOffset en las caras depende de su pendiente en
 * pantalla y, vistas de lado, las empujaba más atrás que eso.
 */
MAT.aristas.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n\tgl_Position = projectionMatrix * vec4( mvPosition.xy, mvPosition.z * ( 1.0 - 2e-4 ), 1.0 );");
};
MAT.aristas.customProgramCacheKey = () => "aristas-hacia-la-camara";
// La caja de sección recorta todo el 3D (menos su propio dibujo)
for (const [k, m] of Object.entries(MAT) as [string, Material][]) {
  if (k !== "caja") m.clippingPlanes = PLANOS;
  MATERIALES_3D.push(m);
}

/** Un rótulo de resultados: un punto del modelo (m) y su texto. */
interface Rotulo3D {
  p: readonly [number, number, number];
  texto: string;
  signo: number;
  prioridad: number;
}

export class Vista3D extends Vista {
  private readonly escena3 = new Scene();
  private readonly persp = new PerspectiveCamera(FOV, 1, 0.1, 5000);
  private readonly orto = new OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
  private C = new Vector3(-30, -45, 30);
  private T = new Vector3(0, 0, 0);
  proyeccion: Proyeccion = "perspectiva";
  modo: Modo3D = "alambrico";
  eventos: Eventos3D = {};
  private origen: [number, number, number] | null = null;
  private alamb: Alambrico | null = null;
  private lineas: LineSegments2 | null = null;
  private lineasElegidas: LineSegments2 | null = null;
  private geo: Geometria3D | null = null;
  private u: Float32Array | null = null;
  private escalaU = 1;
  private laminas: Mesh<BufferGeometry, MeshLambertMaterial> | null = null;
  private barras: LineSegments<BufferGeometry, LineBasicMaterial> | null = null;
  private originales: LineSegments<BufferGeometry, LineBasicMaterial> | null = null;
  private activa: string | null = null;
  private elegidos: ReadonlySet<string> = new Set();
  private diag: Diagramas3D | null = null;
  private iso: MallaIsovalores | null = null;
  private objsDiag: (Mesh | LineSegments2)[] = [];
  private objsIso: (Mesh | LineSegments)[] = [];
  private pil: Pilares3D | null = null;
  private reac: Reacciones3D | null = null;
  private objsPil: LineSegments2[] = [];
  private objsReac: LineSegments2[] = [];
  private carg: Cargas3D | null = null;
  private objsCarg: (Mesh | LineSegments2)[] = [];
  /** Lo que se ve de las cargas con los filtros (para elegir): segmentos y triángulos, con su carga. */
  private cargVis: { segmentos: Float32Array; objeto: Uint32Array; triangulos: Float32Array; objetoTri: Uint32Array; visibles: Set<number> } | null = null;
  private lineasOriginal: LineSegments2 | null = null;
  private extremosDef: ExtremoDeformada[] = [];
  private animar = false;
  private fase = 1;
  private reloj = 0;
  private sonda: Sonda | null = null;
  private pausaSonda = 0;
  private ultimoObjetivo = "";
  /** Lo último que se dijo que había bajo el cursor (para el banco). */
  private objetivo: Objetivo3D | null = null;
  private encuadrada = false;
  private temaColores: string | null = null;
  // I3: el sólido, sus aristas, los filtros y la caja de sección
  private sol: Solido | null = null;
  private malla: Mesh<BufferGeometry, MeshLambertMaterial> | null = null;
  private bordes: LineSegments<BufferGeometry, LineBasicMaterial> | null = null;
  private filtro: FiltroVista = {};
  private color: Color3D = "material";
  /** Los segmentos del alámbrico que se ven (con los filtros), en orden. */
  private segVis: Uint32Array = new Uint32Array(0);
  /** Los triángulos del sólido que se ven. */
  private triVis = 0;
  private lineasCaja: LineSegments<BufferGeometry, LineBasicMaterial> | null = null;
  private arrastreCaja: { cara: number; v0: number; s0: number } | null = null;
  private readonly suelo = new Suelo3D();
  private readonly degradado = new Degradado();

  constructor(entorno: Entorno, camara?: Camara3D | null) {
    super(entorno);
    this.escena3.add(this.suelo.objeto);
    this.escena3.add(new AmbientLight(0xffffff, 1.6));
    const sol = new DirectionalLight(0xffffff, 1.4);
    sol.position.set(1, -2, 3);
    this.escena3.add(sol);
    this.persp.up.set(0, 0, 1);
    this.orto.up.set(0, 0, 1);
    if (camara) {
      this.camaraAbsoluta = camara;
      this.encuadrada = true;
    }
  }

  /** La cámara pedida antes de saber el origen, en coordenadas del modelo. */
  private camaraAbsoluta: Camara3D | null = null;

  camara(): Camara3D | null {
    const o = this.origen;
    if (!o) return this.camaraAbsoluta;
    return { C: [this.C.x + o[0], this.C.y + o[1], this.C.z + o[2]], T: [this.T.x + o[0], this.T.y + o[1], this.T.z + o[2]] };
  }

  private fijarOrigen(o: [number, number, number]): void {
    if (this.origen) return;
    this.origen = o;
    const c = this.camaraAbsoluta;
    if (c) {
      this.C.set(c.C[0] - o[0], c.C[1] - o[1], c.C[2] - o[2]);
      this.T.set(c.T[0] - o[0], c.T[1] - o[1], c.T[2] - o[2]);
    }
  }

  private get paleta(): Paleta3D {
    return PALETAS[this.entorno.tema()];
  }

  // ─── Contenido ──────────────────────────────────────────────────────────────────────────────

  ponerAlambrico(a: Alambrico | null): void {
    if (a === this.alamb) return;
    this.alamb = a;
    if (a) this.fijarOrigen(a.origen);
    this.construirCaja();
    this.aplicarFiltro();
    if (!this.encuadrada) this.encuadrar();
    this.entorno.pintar();
  }

  /** El sólido (I3); null lo quita. */
  ponerSolido(x: Solido | null): void {
    if (x === this.sol) return;
    this.sol = x;
    if (x) this.fijarOrigen(x.origen);
    // En su propia tarea: con el reticular grande son 300 000 triángulos
    this.enTarea("solido", () => this.construirSolido());
  }

  /** Los filtros y la caja de sección (I3). */
  ponerFiltro(f: FiltroVista | undefined): void {
    const nuevo = f ?? {};
    const antes = this.filtro;
    this.filtro = nuevo;
    const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    if (!igual({ ...antes, caja: null }, { ...nuevo, caja: null })) this.enTarea("filtro", () => this.aplicarFiltro());
    if (!igual(antes.caja, nuevo.caja)) {
      this.construirCaja();
      this.entorno.pintar();
    }
  }

  ponerColor(c: Color3D): void {
    if (c === this.color) return;
    this.color = c;
    this.colores();
  }

  ponerAnalitico(g: Geometria3D | null): void {
    if (g === this.geo) return;
    this.geo = g;
    // En su propia tarea: con el edificio objetivo (33 000 láminas) son unos 40 ms, que no se suman a los del alámbrico ni a los de React
    this.enTarea("analitico", () => this.analiticoNuevo());
  }

  private readonly tareas = new Map<string, number>();
  /** Lo pesado, en una tarea aparte (la última de cada clase gana). */
  private enTarea(clase: string, f: () => void): void {
    clearTimeout(this.tareas.get(clase));
    this.tareas.set(
      clase,
      window.setTimeout(() => {
        this.tareas.delete(clase);
        f();
      }, 0),
    );
  }

  private analiticoNuevo(): void {
    const g = this.geo;
    if (g && !this.origen) {
      // Sin alámbrico, el centro de la malla
      const c = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = 0; i < g.nudos.length; i++) {
        const k = i % 3;
        c[k] = Math.min(c[k]!, g.nudos[i]!);
        c[k + 3] = Math.max(c[k + 3]!, g.nudos[i]!);
      }
      this.fijarOrigen([(c[0]! + c[3]!) / 2, (c[1]! + c[4]!) / 2, (c[2]! + c[5]!) / 2]);
    }
    this.construirAnalitico();
    if (!this.encuadrada) this.encuadrar();
  }

  /** Desplazamientos (3 por nudo, m), su escala y sus extremos (para rotularlos); null quita la deformada. */
  ponerDeformada(u: Float32Array | null, escala: number, extremos: ExtremoDeformada[] = []): void {
    this.extremosDef = extremos;
    if (u === this.u && escala === this.escalaU) return this.entorno.pintar();
    this.u = u;
    this.escalaU = escala;
    // Sólo las posiciones y las barras sin deformar: la malla es la misma
    this.enTarea("deformada", () => {
      this.originalesAnalitico();
      this.construirOriginal();
      this.posicionesAnalitico();
    });
  }

  /** La deformada animada (la escala va de 0 a la dada y vuelve) o quieta. */
  ponerAnimacion(si: boolean): void {
    if (si === this.animar) return;
    this.animar = si;
    cancelAnimationFrame(this.reloj);
    this.reloj = 0;
    if (!si) {
      this.fase = 1;
      this.posicionesAnalitico();
      return;
    }
    const t0 = performance.now();
    const paso = (t: number) => {
      if (!this.animar) return;
      this.fase = (1 - Math.cos((2 * Math.PI * (t - t0)) / CICLO_DEFORMADA)) / 2;
      if (this.u) this.posicionesAnalitico();
      this.reloj = requestAnimationFrame(paso);
    };
    this.reloj = requestAnimationFrame(paso);
  }

  /** Los pilares por colores (I4); null los quita. */
  ponerPilares(p: Pilares3D | null): void {
    if (p === this.pil) return;
    this.pil = p;
    if (p) this.fijarOrigen(p.origen);
    this.enTarea("pilares", () => this.construirPilares());
  }

  /** Las flechas de las reacciones (I4); null las quita. */
  ponerReacciones(r: Reacciones3D | null): void {
    if (r === this.reac) return;
    this.reac = r;
    if (r) this.fijarOrigen(r.origen);
    this.enTarea("reacciones", () => this.construirReacciones());
  }

  /** Las cargas de un caso; null las quita. */
  ponerCargas(c: Cargas3D | null): void {
    if (c === this.carg) return;
    this.carg = c;
    if (c) this.fijarOrigen(c.origen);
    this.enTarea("cargas", () => this.construirCargas());
  }

  /** Lo que se dice del punto bajo el cursor (null: nada). */
  ponerSonda(x: Sonda | null): void {
    this.sonda = x;
    this.entorno.pintar();
  }

  /** Los diagramas de las barras (I4); null los quita. */
  ponerDiagramas(d: Diagramas3D | null): void {
    if (d === this.diag) return;
    this.diag = d;
    if (d) this.fijarOrigen(d.origen);
    this.enTarea("diagramas", () => this.construirDiagramas());
  }

  /** Los isovalores de las losas (I4); null los quita. */
  ponerIsovalores(i: MallaIsovalores | null): void {
    if (i === this.iso) return;
    this.iso = i;
    if (i) this.fijarOrigen(i.origen);
    this.enTarea("isovalores", () => this.construirIsovalores());
  }

  ponerModo(m: Modo3D): void {
    if (m === this.modo) return;
    this.modo = m;
    this.visibilidad();
    this.entorno.pintar();
  }

  ponerProyeccion(p: Proyeccion): void {
    if (p === this.proyeccion) return;
    this.proyeccion = p;
    this.entorno.pintar();
  }

  ponerPlantaActiva(p: string | null): void {
    if (p === this.activa) return;
    this.activa = p;
    this.colores();
  }

  ponerElegidos(ids: ReadonlySet<string>): void {
    this.elegidos = ids;
    this.construirElegidos();
    if (this.carg) this.construirCargas(false);
    if (this.malla) this.colores();
    this.entorno.pintar();
  }

  /** El modo que se pinta: sin sólido todavía, el alámbrico. */
  private get modoPintado(): Modo3D {
    return (this.modo === "solido" || this.modo === "translucido") && !this.malla ? "alambrico" : this.modo;
  }

  private visibilidad(): void {
    const m = this.modoPintado;
    if (this.lineas) this.lineas.visible = m === "alambrico" || m === "translucido";
    for (const o of [this.laminas, this.barras, this.originales]) if (o) o.visible = m === "analitico";
    if (this.lineasOriginal) this.lineasOriginal.visible = m === "analitico" && !!this.u;
    if (this.malla) {
      this.malla.visible = m === "solido" || m === "translucido";
      this.malla.material = m === "translucido" ? MAT.translucido : MAT.solido;
    }
    if (this.bordes) this.bordes.visible = m === "solido";
    // En sólido, lo elegido va en las caras; los ejes gruesos, en los demás modos
    if (this.lineasElegidas) this.lineasElegidas.visible = m !== "solido";
  }

  // ─── Sólido y filtros (I3) ──────────────────────────────────────────────────────────────────

  private construirSolido(): void {
    for (const o of [this.malla, this.bordes]) {
      if (!o) continue;
      this.escena3.remove(o);
      o.geometry.dispose();
    }
    this.malla = null;
    this.bordes = null;
    const x = this.sol;
    if (x && x.objeto.length) {
      const nt = x.objeto.length;
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(x.triangulos, 3));
      // Colores en bytes: con el reticular grande, 2,7 MB en vez de 11 MB que subir a la GPU
      g.setAttribute("color", new BufferAttribute(new Uint8Array(9 * nt), 3, true));
      // La esfera que la envuelve, de su caja: si no, Three la calcula recorriendo los vértices para ordenar lo que pinta
      const o = x.origen;
      const centro = new Vector3((x.caja[0] + x.caja[3]) / 2 - o[0], (x.caja[1] + x.caja[4]) / 2 - o[1], (x.caja[2] + x.caja[5]) / 2 - o[2]);
      const esfera = new Sphere(centro, Math.hypot(x.caja[3] - x.caja[0], x.caja[4] - x.caja[1], x.caja[5] - x.caja[2]) / 2);
      g.boundingSphere = esfera;
      this.malla = this.situar(new Mesh(g, MAT.solido), x.origen);
      const gb = new BufferGeometry();
      gb.boundingSphere = esfera.clone();
      gb.setAttribute("position", new BufferAttribute(x.aristas, 3));
      this.bordes = this.situar(new LineSegments(gb, MAT.aristas), x.origen);
      this.bordes.renderOrder = 1;
    }
    this.aplicarFiltro();
    if (!this.encuadrada) this.encuadrar();
  }

  /** Las plantas que se ven: [la de arriba, la de abajo] en el orden de la lista (de arriba abajo). */
  private rangoPlantas(plantas: readonly string[]): [number, number] {
    const f = this.filtro;
    const a = f.hasta ? plantas.indexOf(f.hasta) : -1;
    const b = f.desde ? plantas.indexOf(f.desde) : -1;
    return [a < 0 ? 0 : a, b < 0 ? plantas.length - 1 : b];
  }

  /** ¿Se ve un objeto (por su tipo y por aislar y ocultar)? */
  private objetoVisible(): (id: string, tipo: string) => boolean {
    const f = this.filtro;
    const sin = new Set<string>(f.sinTipos ?? []);
    const aislados = f.aislados ? new Set(f.aislados) : null;
    const ocultos = new Set(f.ocultos ?? []);
    return (id, tipo) => !sin.has(tipo) && !ocultos.has(id) && (!aislados || aislados.has(id));
  }

  /** Rehace lo que se pinta con los filtros: los índices del sólido y del analítico y los segmentos del alámbrico. */
  private aplicarFiltro(): void {
    const ve = this.objetoVisible();
    const x = this.sol;
    if (x && this.malla && this.bordes && !filtra(this.filtro)) {
      // Sin filtros, sin índices: todo
      this.malla.geometry.setIndex(null);
      this.bordes.geometry.setIndex(null);
      this.triVis = x.objeto.length;
    } else if (x && this.malla && this.bordes) {
      const [a, b] = this.rangoPlantas(x.plantas);
      const vo = x.objetos.map((o) => ve(o.id, o.tipo));
      const nt = x.objeto.length;
      let n = 0;
      const idx = new Uint32Array(3 * nt);
      for (let t = 0; t < nt; t++) {
        const p = x.planta[t]!;
        if (!vo[x.objeto[t]!] || p < a || p > b) continue;
        idx[n++] = 3 * t;
        idx[n++] = 3 * t + 1;
        idx[n++] = 3 * t + 2;
      }
      this.triVis = n / 3;
      this.malla.geometry.setIndex(new BufferAttribute(idx.slice(0, n), 1));
      const na = x.objetoArista.length;
      const ia = new Uint32Array(2 * na);
      let m = 0;
      for (let i = 0; i < na; i++) {
        const p = x.plantaArista[i]!;
        if (!vo[x.objetoArista[i]!] || p < a || p > b) continue;
        ia[m++] = 2 * i;
        ia[m++] = 2 * i + 1;
      }
      this.bordes.geometry.setIndex(new BufferAttribute(ia.slice(0, m), 1));
    }
    const al = this.alamb;
    if (al) {
      const [a, b] = this.rangoPlantas(al.plantas);
      const vo = al.objetos.map((o) => ve(o.id, o.tipo));
      const r: number[] = [];
      for (let i = 0; i < al.objeto.length; i++) {
        const p = al.planta[i]!;
        if (vo[al.objeto[i]!] && p >= a && p <= b) r.push(i);
      }
      this.segVis = Uint32Array.from(r);
    } else this.segVis = new Uint32Array(0);
    this.construirAlambrico();
    this.filtrarAnalitico();
    if (this.carg) this.construirCargas(false);
    this.colores();
    this.visibilidad();
    this.entorno.pintar();
  }

  /** Los índices de las láminas y las barras del analítico que se ven. */
  private filtrarAnalitico(): void {
    const g = this.geo;
    if (!g || !this.laminas || !this.barras) return;
    const ve = this.objetoVisible();
    const [a, b] = this.rangoPlantas(g.plantas);
    const TB = ["pilar", "viga", "pano", "viga"];
    const vo = (k: number, tipo: string) => k === 0xffffffff || ve(g.objetos[k]!, tipo);
    const nl = g.laminas.length / 4;
    const il: number[] = [];
    for (let i = 0; i < nl; i++) {
      const p = g.plantaLamina[i]!;
      if (p < a || p > b || !vo(g.objetoLamina[i]!, g.esMuro[i] ? "muro" : "losa")) continue;
      for (let w = 0; w < 6; w++) il.push(6 * i + w);
    }
    this.laminas.geometry.setIndex(il);
    const nb = g.barras.length / 2;
    const ib: number[] = [];
    for (let i = 0; i < nb; i++) {
      const p = g.plantaBarra[i]!;
      if (p < a || p > b || !vo(g.objetoBarra[i]!, TB[g.tipoBarra[i]!]!)) continue;
      ib.push(2 * i, 2 * i + 1);
    }
    this.barras.geometry.setIndex(ib);
    this.originales?.geometry.setIndex(ib);
  }

  /** El dibujo de la caja de sección (sus doce aristas). */
  private construirCaja(): void {
    if (this.lineasCaja) {
      this.escena3.remove(this.lineasCaja);
      this.lineasCaja.geometry.dispose();
      this.lineasCaja = null;
    }
    const c = this.filtro.caja;
    const o = this.origen;
    if (!c || !o) return;
    const v = (i: number, j: number, k: number) => [c[3 * i]! - o[0], c[1 + 3 * j]! - o[1], c[2 + 3 * k]! - o[2]];
    const pos: number[] = [];
    const lados: [number, number, number, number, number, number][] = [
      [0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1],
      [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1],
      [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1],
    ];
    for (const [a, b, c2, d, e, f] of lados) pos.push(...v(a, b, c2), ...v(d, e, f));
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    this.lineasCaja = new LineSegments(g, MAT.caja);
    this.lineasCaja.frustumCulled = false;
    this.lineasCaja.renderOrder = 20;
    this.escena3.add(this.lineasCaja);
  }

  /** El alámbrico sin deformar, en gris, bajo la deformada (si la hay). */
  private construirOriginal(): void {
    if (this.lineasOriginal) {
      this.escena3.remove(this.lineasOriginal);
      this.lineasOriginal.geometry.dispose();
      this.lineasOriginal = null;
    }
    const a = this.alamb;
    if (!a || !a.objeto.length || !this.u) return;
    const g = new LineSegmentsGeometry();
    g.setPositions(a.segmentos);
    MAT.original.color.set(this.paleta.original);
    this.lineasOriginal = new LineSegments2(g, MAT.original);
    this.lineasOriginal.frustumCulled = false;
    this.escena3.add(this.lineasOriginal);
    this.visibilidad();
  }

  private construirPilares(): void {
    this.quitar(this.objsPil);
    const p = this.pil;
    if (p && p.segmentos.length) {
      const g = new LineSegmentsGeometry();
      g.setPositions(p.segmentos);
      const cs = p.colores.map((x) => new Color(x));
      const gris = new Color("#9ca3af");
      const col = new Float32Array(p.segmentos.length);
      for (let i = 0; i < p.banda.length; i++) {
        const c = p.banda[i] === SIN_BANDA ? gris : cs[p.banda[i]!]!;
        for (let j = 0; j < 2; j++) col.set([c.r, c.g, c.b], 6 * i + 3 * j);
      }
      g.setColors(col);
      const o = this.situar(new LineSegments2(g, MAT.pilares), p.origen);
      o.renderOrder = 4;
      this.objsPil.push(o);
    }
    this.entorno.pintar();
  }

  private construirReacciones(): void {
    this.quitar(this.objsReac);
    const r = this.reac;
    if (r && r.segmentos.length) {
      const g = new LineSegmentsGeometry();
      g.setPositions(r.segmentos);
      const [cv, ch] = [new Color(COLOR_REACCION.vertical), new Color(COLOR_REACCION.horizontal)];
      const col = new Float32Array(r.segmentos.length);
      for (let i = 0; i < r.tipoSegmento.length; i++) {
        const c = r.tipoSegmento[i] ? ch : cv;
        for (let j = 0; j < 2; j++) col.set([c.r, c.g, c.b], 6 * i + 3 * j);
      }
      g.setColors(col);
      const o = this.situar(new LineSegments2(g, MAT.reacciones), r.origen);
      o.renderOrder = 7;
      this.objsReac.push(o);
    }
    this.entorno.pintar();
  }

  /** ¿Se ve cada carga con los filtros? Como su pieza: por su tipo, y aislada u oculta ella o su pieza. */
  private cargasVisibles(c: Cargas3D): boolean[] {
    const f = this.filtro;
    const sin = new Set<string>(f.sinTipos ?? []);
    const aislados = f.aislados ? new Set(f.aislados) : null;
    const ocultos = new Set(f.ocultos ?? []);
    return c.objetos.map((o) => !(o.tipoPieza && sin.has(o.tipoPieza)) && !ocultos.has(o.id) && !(o.pieza && ocultos.has(o.pieza)) && (!aislados || aislados.has(o.id) || (!!o.pieza && aislados.has(o.pieza))));
  }

  /** Las cargas que se ven con los filtros (y las plantas del rango), en su color; las elegidas, además, encima como lo elegido. */
  private construirCargas(pintar = true): void {
    this.quitar(this.objsCarg);
    this.cargVis = null;
    const c = this.carg;
    if (c) {
      const color = CLASES_CARGA.map((k) => new Color(COLOR_CARGA[k]));
      const vo = this.cargasVisibles(c);
      const [a, b] = this.rangoPlantas(c.plantas);
      const elegida = c.objetos.map((o) => this.elegidos.has(o.id));
      const ve = (obj: number, pl: number) => vo[obj]! && pl >= a && pl <= b;
      const nt = c.claseTriangulo.length;
      const ns = c.claseSegmento.length;
      let [kt, ks] = [0, 0];
      for (let i = 0; i < nt; i++) if (ve(c.objetoTriangulo[i]!, c.plantaTriangulo[i]!)) kt++;
      for (let i = 0; i < ns; i++) if (ve(c.objetoSegmento[i]!, c.plantaSegmento[i]!)) ks++;
      const tri = new Float32Array(9 * kt);
      const colT = new Float32Array(9 * kt);
      const objT = new Uint32Array(kt);
      const seg = new Float32Array(6 * ks);
      const colS = new Float32Array(6 * ks);
      const objS = new Uint32Array(ks);
      const visibles = new Set<number>();
      kt = 0;
      for (let i = 0; i < nt; i++) {
        const k = c.objetoTriangulo[i]!;
        if (!ve(k, c.plantaTriangulo[i]!)) continue;
        tri.set(c.triangulos.subarray(9 * i, 9 * i + 9), 9 * kt);
        const q = color[c.claseTriangulo[i]!]!;
        for (let j = 0; j < 3; j++) colT.set([q.r, q.g, q.b], 9 * kt + 3 * j);
        objT[kt++] = k;
        visibles.add(k);
      }
      ks = 0;
      const elegidos: number[] = [];
      for (let i = 0; i < ns; i++) {
        const k = c.objetoSegmento[i]!;
        if (!ve(k, c.plantaSegmento[i]!)) continue;
        seg.set(c.segmentos.subarray(6 * i, 6 * i + 6), 6 * ks);
        if (elegida[k]) for (let j = 0; j < 6; j++) elegidos.push(c.segmentos[6 * i + j]!);
        const q = color[c.claseSegmento[i]!]!;
        for (let j = 0; j < 2; j++) colS.set([q.r, q.g, q.b], 6 * ks + 3 * j);
        objS[ks++] = k;
        visibles.add(k);
      }
      this.cargVis = { segmentos: seg, objeto: objS, triangulos: tri, objetoTri: objT, visibles };
      if (tri.length) {
        const g = new BufferGeometry();
        g.setAttribute("position", new BufferAttribute(tri, 3));
        g.setAttribute("color", new BufferAttribute(colT, 3));
        const o = this.situar(new Mesh(g, MAT.bloques), c.origen);
        o.renderOrder = 5;
        this.objsCarg.push(o);
      }
      if (seg.length) {
        const g = new LineSegmentsGeometry();
        g.setPositions(seg);
        g.setColors(colS);
        const o = this.situar(new LineSegments2(g, MAT.cargas), c.origen);
        o.renderOrder = 6;
        this.objsCarg.push(o);
      }
      if (elegidos.length) {
        const g = new LineSegmentsGeometry();
        g.setPositions(elegidos);
        const o = this.situar(new LineSegments2(g, MAT.elegidas), c.origen);
        o.renderOrder = 10;
        this.objsCarg.push(o);
      }
    }
    if (pintar) this.entorno.pintar();
  }

  private construirAlambrico(): void {
    if (this.lineas) {
      this.escena3.remove(this.lineas);
      this.lineas.geometry.dispose();
      this.lineas = null;
    }
    const a = this.alamb;
    if (a && this.segVis.length) {
      const g = new LineSegmentsGeometry();
      const pos = new Float32Array(6 * this.segVis.length);
      this.segVis.forEach((i, k) => pos.set(a.segmentos.subarray(6 * i, 6 * i + 6), 6 * k));
      g.setPositions(pos);
      g.setColors(new Float32Array(pos.length));
      this.lineas = new LineSegments2(g, MAT.lineas);
      this.lineas.frustumCulled = false;
      this.escena3.add(this.lineas);
    }
    this.visibilidad();
    this.colores();
    this.construirElegidos();
  }

  private construirElegidos(): void {
    if (this.lineasElegidas) {
      this.escena3.remove(this.lineasElegidas);
      this.lineasElegidas.geometry.dispose();
      this.lineasElegidas = null;
    }
    const a = this.alamb;
    if (!a || !this.elegidos.size) return;
    const k = new Set<number>();
    a.objetos.forEach((o, i) => this.elegidos.has(o.id) && k.add(i));
    if (!k.size) return;
    const pos: number[] = [];
    for (const i of this.segVis) if (k.has(a.objeto[i]!)) for (let j = 0; j < 6; j++) pos.push(a.segmentos[6 * i + j]!);
    if (!pos.length) return;
    const g = new LineSegmentsGeometry();
    g.setPositions(pos);
    MAT.elegidas.color.set(this.entorno.colores().acento);
    this.lineasElegidas = new LineSegments2(g, MAT.elegidas);
    this.lineasElegidas.renderOrder = 10;
    this.lineasElegidas.frustumCulled = false;
    this.lineasElegidas.visible = this.modoPintado !== "solido";
    this.escena3.add(this.lineasElegidas);
  }

  /** Un objeto de resultados en el origen de la vista (los datos traen el suyo, que es el del alámbrico). */
  private situar<T extends Mesh | LineSegments | LineSegments2>(o: T, origen: readonly [number, number, number]): T {
    const v = this.origen ?? origen;
    o.position.set(origen[0] - v[0], origen[1] - v[1], origen[2] - v[2]);
    o.frustumCulled = false;
    this.escena3.add(o);
    return o;
  }

  private quitar(os: (Mesh | LineSegments | LineSegments2)[]): void {
    for (const o of os) {
      this.escena3.remove(o);
      o.geometry.dispose();
    }
    os.length = 0;
  }

  private construirDiagramas(): void {
    this.quitar(this.objsDiag);
    const d = this.diag;
    if (d) {
      for (const [a, m] of [
        [d.positivo, MAT.positivo],
        [d.negativo, MAT.negativo],
      ] as const) {
        if (!a.length) continue;
        const g = new BufferGeometry();
        g.setAttribute("position", new BufferAttribute(a, 3));
        const o = this.situar(new Mesh(g, m), d.origen);
        o.renderOrder = 5;
        this.objsDiag.push(o);
      }
      if (d.lineas.length) {
        const g = new LineSegmentsGeometry();
        g.setPositions(d.lineas);
        g.setColors(this.coloresCurvas(d));
        const o = this.situar(new LineSegments2(g, MAT.curvas), d.origen);
        o.renderOrder = 6;
        this.objsDiag.push(o);
      }
    }
    this.entorno.pintar();
  }

  /** El color de cada segmento de las curvas: el trazo de su signo. */
  private coloresCurvas(d: Diagramas3D): Float32Array {
    const t = this.entorno.tema();
    const [cp, cn] = [new Color(pintura("diagrama-positivo", t).stroke ?? "#b91c1c"), new Color(pintura("diagrama-negativo", t).stroke ?? "#1d4ed8")];
    const col = new Float32Array(d.lineas.length);
    for (let i = 0; i < d.signoLinea.length; i++) {
      const c = d.signoLinea[i] ? cp : cn;
      for (let j = 0; j < 2; j++) col.set([c.r, c.g, c.b], 6 * i + 3 * j);
    }
    return col;
  }

  private construirIsovalores(): void {
    this.quitar(this.objsIso);
    const i = this.iso;
    if (i) {
      if (i.triangulos.length) {
        const g = new BufferGeometry();
        g.setAttribute("position", new BufferAttribute(i.triangulos, 3));
        const col = new Float32Array(i.triangulos.length);
        const cs = i.colores.map((x) => new Color(x));
        for (let t = 0; t < i.banda.length; t++) {
          const c = cs[i.banda[t]!]!;
          for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], 9 * t + 3 * v);
        }
        g.setAttribute("color", new BufferAttribute(col, 3));
        this.objsIso.push(this.situar(new Mesh(g, MAT.bandas), i.origen));
      }
      if (i.sinMapa.length) {
        const g = new BufferGeometry();
        g.setAttribute("position", new BufferAttribute(i.sinMapa, 3));
        this.objsIso.push(this.situar(new Mesh(g, MAT.sinMapa), i.origen));
      }
      for (const [a, m] of [
        [i.isolineas, MAT.isolineas],
        [i.ceros, MAT.ceros],
      ] as const) {
        if (!a.length) continue;
        const g = new BufferGeometry();
        g.setAttribute("position", new BufferAttribute(a, 3));
        const o = this.situar(new LineSegments(g, m), i.origen);
        o.renderOrder = 1;
        this.objsIso.push(o);
      }
    }
    this.entorno.pintar();
  }

  private quitarAnalitico(): void {
    for (const o of [this.laminas, this.barras, this.originales]) {
      if (!o) continue;
      this.escena3.remove(o);
      o.geometry.dispose();
    }
    this.laminas = this.barras = this.originales = null;
  }

  private construirAnalitico(): void {
    this.quitarAnalitico();
    const g = this.geo;
    if (!g) return this.entorno.pintar();
    const nl = g.laminas.length / 4;
    const nb = g.barras.length / 2;
    const gl = new BufferGeometry();
    gl.setAttribute("position", new BufferAttribute(new Float32Array(nl * 18), 3));
    gl.setAttribute("normal", new BufferAttribute(new Float32Array(nl * 18), 3));
    gl.setAttribute("color", new BufferAttribute(new Float32Array(nl * 18), 3));
    this.laminas = new Mesh(gl, MAT.laminas);
    const gb = new BufferGeometry();
    gb.setAttribute("position", new BufferAttribute(new Float32Array(nb * 6), 3));
    gb.setAttribute("color", new BufferAttribute(new Float32Array(nb * 6), 3));
    this.barras = new LineSegments(gb, MAT.barras);
    for (const o of [this.laminas, this.barras]) o.frustumCulled = false;
    this.escena3.add(this.laminas, this.barras);
    this.originalesAnalitico();
    this.filtrarAnalitico();
    this.visibilidad();
    this.posicionesAnalitico();
    this.colores();
  }

  /** Las barras sin deformar, en tenue, si hay deformada. */
  private originalesAnalitico(): void {
    if (this.originales) {
      this.escena3.remove(this.originales);
      this.originales.geometry.dispose();
      this.originales = null;
    }
    const g = this.geo;
    if (!g || !this.u) return;
    const o = this.origen ?? [0, 0, 0];
    const nb = g.barras.length / 2;
    const po = new Float32Array(nb * 6);
    for (let i = 0; i < nb; i++)
      for (let e = 0; e < 2; e++) {
        const n = 3 * g.barras[2 * i + e]!;
        for (let k = 0; k < 3; k++) po[6 * i + 3 * e + k] = g.nudos[n + k]! - o[k]!;
      }
    const go = new BufferGeometry();
    go.setAttribute("position", new BufferAttribute(po, 3));
    MAT.originales.color.set(this.paleta.original);
    this.originales = new LineSegments(go, MAT.originales);
    this.originales.frustumCulled = false;
    this.originales.visible = this.modoPintado === "analitico";
    if (this.barras?.geometry.index) this.originales.geometry.setIndex(this.barras.geometry.index.clone());
    this.escena3.add(this.originales);
  }

  /** Reescribe las posiciones (x + escala·u − origen) y las normales de cada triángulo. */
  private posicionesAnalitico(): void {
    const g = this.geo;
    if (!g || !this.laminas || !this.barras) return;
    const o = this.origen ?? [0, 0, 0];
    const X = g.nudos;
    const u = this.u;
    const k = u ? this.escalaU * (this.animar ? this.fase : 1) : 0;
    const v = (n: number, a: number) => X[n + a]! - o[a]! + (u ? k * u[n + a]! : 0);
    const pos = this.laminas.geometry.getAttribute("position") as BufferAttribute;
    const nor = this.laminas.geometry.getAttribute("normal") as BufferAttribute;
    const P = pos.array as Float32Array;
    const N = nor.array as Float32Array;
    const nl = g.laminas.length / 4;
    for (let i = 0; i < nl; i++) {
      for (let w = 0; w < 6; w++) {
        const n = 3 * g.laminas[4 * i + ESQ_LAMINA[w]!]!;
        const q = 18 * i + 3 * w;
        P[q] = v(n, 0);
        P[q + 1] = v(n, 1);
        P[q + 2] = v(n, 2);
      }
      for (let t = 0; t < 2; t++) {
        const q = 18 * i + 9 * t;
        const [ax, ay, az] = [P[q + 3]! - P[q]!, P[q + 4]! - P[q + 1]!, P[q + 5]! - P[q + 2]!];
        const [bx, by, bz] = [P[q + 6]! - P[q]!, P[q + 7]! - P[q + 1]!, P[q + 8]! - P[q + 2]!];
        let [nx, ny, nz] = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
        const l = Math.hypot(nx, ny, nz) || 1;
        [nx, ny, nz] = [nx / l, ny / l, nz / l];
        for (let w = 0; w < 3; w++) {
          N[q + 3 * w] = nx;
          N[q + 3 * w + 1] = ny;
          N[q + 3 * w + 2] = nz;
        }
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    const pb = this.barras.geometry.getAttribute("position") as BufferAttribute;
    const B = pb.array as Float32Array;
    const nb = g.barras.length / 2;
    for (let i = 0; i < nb; i++)
      for (let e = 0; e < 2; e++) {
        const n = 3 * g.barras[2 * i + e]!;
        for (let a = 0; a < 3; a++) B[6 * i + 3 * e + a] = v(n, a);
      }
    pb.needsUpdate = true;
    this.entorno.pintar();
  }

  /**
   * Reescribe los colores: por tipo. Con una planta activa, ella con los suyos y el resto atenuado
   * (hacia el fondo), para que lo elegido, en el color de acento, no se confunda con ella.
   */
  private colores(): void {
    this.temaColores = this.entorno.tema();
    const c = this.paleta;
    const rgb = (s: string): [number, number, number] => {
      const x = new Color(s);
      return [x.r, x.g, x.b];
    };
    const fondo = rgb(this.entorno.colores().fondo);
    const tenue = (x: [number, number, number]): [number, number, number] => [x[0] * 0.3 + fondo[0] * 0.7, x[1] * 0.3 + fondo[1] * 0.7, x[2] * 0.3 + fondo[2] * 0.7];
    const activa = rgb(c.activa);
    const a = this.alamb;
    if (a && this.lineas) {
      const tipos: Record<string, [number, number, number]> = { pilar: rgb(c.pilar), viga: rgb(c.viga), losa: rgb(c.losa), pano: rgb(c.pano), muro: rgb(c.muro), apoyo: rgb(c.apoyo) };
      const tenues: Record<string, [number, number, number]> = Object.fromEntries(Object.entries(tipos).map(([k, v]) => [k, tenue(v)]));
      const ia = this.activa === null ? -1 : a.plantas.indexOf(this.activa);
      const col = new Float32Array(6 * this.segVis.length);
      this.segVis.forEach((i, k) => {
        const t = a.objetos[a.objeto[i]!]!.tipo;
        const cc = ia < 0 || a.planta[i] === ia ? tipos[t]! : tenues[t]!;
        for (let j = 0; j < 2; j++) col.set(cc, 6 * k + 3 * j);
      });
      this.lineas.geometry.setColors(col);
    }
    const x = this.sol;
    if (x && this.malla) {
      const ia = this.activa === null ? -1 : x.plantas.indexOf(this.activa);
      const mat: Record<string, [number, number, number]> = { hormigon: rgb(c.hormigon), acero: rgb(c.acero), general: rgb(c.general) };
      const cats = CATEGORIAS.map(rgb);
      const secciones = [...new Set(x.objetos.map((o) => o.seccion).filter((y): y is string => !!y))].sort();
      const base = x.objetos.map((o) => (o.tipo === "apoyo" ? rgb(c.apoyo) : this.color === "seccion" && o.seccion ? cats[secciones.indexOf(o.seccion) % cats.length]! : mat[o.material ?? "hormigon"]!));
      const baseT = base.map(tenue);
      const porPlanta = x.plantas.map((_, k) => cats[k % cats.length]!);
      const porPlantaT = porPlanta.map(tenue);
      const elegido = x.objetos.map((o) => this.elegidos.has(o.id));
      const acento = rgb(this.entorno.colores().acento);
      const C = (this.malla.geometry.getAttribute("color") as BufferAttribute).array as Uint8Array;
      const bytes = (c: [number, number, number]) => [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];
      const [baseB, baseTB, plB, plTB, acB] = [base.map(bytes), baseT.map(bytes), porPlanta.map(bytes), porPlantaT.map(bytes), bytes(acento)];
      const [casB, casTB] = [bytes(rgb(c.caseton)), bytes(tenue(rgb(c.caseton)))];
      const planta = this.color === "planta";
      for (let t = 0; t < x.objeto.length; t++) {
        const o = x.objeto[t]!;
        const p = x.planta[t]!;
        const fuera = ia >= 0 && p !== ia;
        const cc = elegido[o] ? acB : x.caseton[t] ? (fuera ? casTB : casB) : planta && x.objetos[o]!.tipo !== "apoyo" ? (fuera ? plTB[p]! : plB[p]!) : fuera ? baseTB[o]! : baseB[o]!;
        for (let v = 0; v < 9; v += 3) {
          C[9 * t + v] = cc[0]!;
          C[9 * t + v + 1] = cc[1]!;
          C[9 * t + v + 2] = cc[2]!;
        }
      }
      (this.malla.geometry.getAttribute("color") as BufferAttribute).needsUpdate = true;
    }
    MAT.aristas.color.set(c.arista);
    MAT.caja.color.set(this.entorno.colores().acento);
    const g = this.geo;
    if (g && this.laminas && this.barras) {
      const ia = this.activa === null ? -1 : g.plantas.indexOf(this.activa);
      const [losa, muro] = [rgb(c.laminaLosa), rgb(c.laminaMuro)];
      const tipos = [rgb(c.pilar), rgb(c.viga), rgb(c.vigueta), rgb(c.viga)];
      const C = (this.laminas.geometry.getAttribute("color") as BufferAttribute).array as Float32Array;
      const nl = g.laminas.length / 4;
      for (let i = 0; i < nl; i++) {
        const cc = g.esMuro[i] ? muro : g.plantaLamina[i] === ia ? activa : losa;
        for (let w = 0; w < 6; w++) C.set(cc, 18 * i + 3 * w);
      }
      (this.laminas.geometry.getAttribute("color") as BufferAttribute).needsUpdate = true;
      const CB = (this.barras.geometry.getAttribute("color") as BufferAttribute).array as Float32Array;
      const nb = g.barras.length / 2;
      for (let i = 0; i < nb; i++) {
        const t = g.tipoBarra[i]!;
        const cc = t !== 0 && g.plantaBarra[i] === ia ? activa : tipos[t]!;
        for (let e = 0; e < 2; e++) CB.set(cc, 6 * i + 3 * e);
      }
      (this.barras.geometry.getAttribute("color") as BufferAttribute).needsUpdate = true;
      MAT.originales.color.set(c.original);
    }
    MAT.original.color.set(c.original);
    MAT.sinMapa.color.set(this.entorno.tema() === "dark" ? "#4b5563" : "#d1d5db");
    const curvas = this.objsDiag.find((o): o is LineSegments2 => o instanceof LineSegments2);
    if (curvas && this.diag) curvas.geometry.setColors(this.coloresCurvas(this.diag));
    this.entorno.pintar();
  }

  // ─── Cámara ─────────────────────────────────────────────────────────────────────────────────

  private get camaraActiva(): PerspectiveCamera | OrthographicCamera {
    return this.proyeccion === "perspectiva" ? this.persp : this.orto;
  }

  private actualizarCamaras(): void {
    const { w, h } = this.rect;
    const aspecto = Math.max(1e-3, w / Math.max(1, h));
    const D = this.C.distanceTo(this.T);
    const p = this.persp;
    p.aspect = aspecto;
    p.near = Math.max(0.01, D / 200);
    p.far = D * 50 + 1000;
    p.position.copy(this.C);
    p.lookAt(this.T);
    p.updateProjectionMatrix();
    const o = this.orto;
    const mh = D * Math.tan((FOV * Math.PI) / 360);
    o.left = -mh * aspecto;
    o.right = mh * aspecto;
    o.top = mh;
    o.bottom = -mh;
    o.near = -D * 50 - 1000;
    o.far = D * 50 + 1000;
    o.position.copy(this.C);
    o.lookAt(this.T);
    o.updateProjectionMatrix();
    p.updateMatrixWorld();
    o.updateMatrixWorld();
  }

  /** Caja de lo que se dibuja, respecto al origen. */
  private caja(): [Vector3, Vector3] | null {
    const a = this.alamb;
    const o = this.origen;
    if (a && o && a.objeto.length) return [new Vector3(a.caja[0] - o[0], a.caja[1] - o[1], a.caja[2] - o[2]), new Vector3(a.caja[3] - o[0], a.caja[4] - o[1], a.caja[5] - o[2])];
    const g = this.geo;
    if (g && o && g.nudos.length) {
      const m = new Vector3(Infinity, Infinity, Infinity);
      const M = new Vector3(-Infinity, -Infinity, -Infinity);
      for (let i = 0; i < g.nudos.length; i += 3) {
        const v = new Vector3(g.nudos[i]! - o[0], g.nudos[i + 1]! - o[1], g.nudos[i + 2]! - o[2]);
        m.min(v);
        M.max(v);
      }
      return [m, M];
    }
    // Sin nada dibujado, el sitio de un edificio con el origen en una esquina
    if (a && o) return [new Vector3(CAJA_VACIA[0] - o[0], CAJA_VACIA[1] - o[1], -o[2]), new Vector3(CAJA_VACIA[2] - o[0], CAJA_VACIA[3] - o[1], 4 - o[2])];
    return null;
  }

  /** El suelo: bajo el modelo (o en `CAJA_VACIA`), en su cota más baja. */
  private actualizarSuelo(): void {
    const a = this.alamb;
    const o = this.origen;
    if (!this.fondo.rejilla || !a || !o) {
      this.suelo.objeto.visible = false;
      return;
    }
    const lleno = a.objeto.length > 0;
    const caja = lleno ? ([a.caja[0], a.caja[1], a.caja[3], a.caja[4]] as const) : CAJA_VACIA;
    this.suelo.actualizar(caja, lleno ? a.caja[2] : 0, o, this.entorno.colores().texto, this.entorno.tema(), this.fondo.tenue);
    this.suelo.objeto.visible = true;
  }

  encuadrar(direccion?: readonly [number, number, number]): void {
    const c = this.caja();
    if (!c) return;
    const centro = c[0].clone().add(c[1]).multiplyScalar(0.5);
    const radio = Math.max(1, c[0].distanceTo(c[1]) / 2);
    const aspecto = Math.max(0.3, Math.min(1, this.rect.w / Math.max(1, this.rect.h)));
    const D = (radio / Math.sin((FOV * Math.PI) / 360)) * (aspecto < 1 ? 1 / aspecto : 1) * 0.92;
    const d = direccion ? new Vector3(...direccion) : this.encuadrada ? this.C.clone().sub(this.T) : new Vector3(-0.55, -0.85, 0.5);
    if (d.lengthSq() === 0) d.set(-0.55, -0.85, 0.5);
    d.normalize();
    this.T.copy(centro);
    this.C.copy(centro).addScaledVector(d, D);
    this.encuadrada = true;
    this.ajustada = true;
    this.camaraCambiada();
  }

  vistaEstandar(v: VistaEstandar): void {
    this.ajustada = false;
    const d = VISTAS_ESTANDAR[v];
    // Se conserva la distancia y el punto mirado; sólo cambia la dirección
    const D = this.C.distanceTo(this.T) || 10;
    const n = new Vector3(...d).normalize();
    this.C.copy(this.T).addScaledVector(n, D);
    this.camaraCambiada();
  }

  /** El rayo de la cámara por un píxel de la vista, y su corte con el plano de T normal a la mirada. */
  private puntoEnPlanoT(x: number, y: number): Vector3 {
    this.actualizarCamaras();
    const cam = this.camaraActiva;
    const ndc = new Vector3((x / this.rect.w) * 2 - 1, -((y / this.rect.h) * 2 - 1), 0.5);
    const mirada = this.T.clone().sub(this.C).normalize();
    if (this.proyeccion === "perspectiva") {
      const p = ndc.unproject(cam);
      const dir = p.sub(this.C).normalize();
      const den = dir.dot(mirada);
      const t = den > 1e-6 ? this.T.clone().sub(this.C).dot(mirada) / den : this.C.distanceTo(this.T);
      return this.C.clone().addScaledVector(dir, t);
    }
    const p = ndc.unproject(cam);
    // En ortográfica, el rayo es paralelo a la mirada: se lleva al plano de T
    return p.addScaledVector(mirada, this.T.clone().sub(p).dot(mirada));
  }

  protected desplazar(dx: number, dy: number): void {
    this.actualizarCamaras();
    const D = this.C.distanceTo(this.T);
    const k = (2 * D * Math.tan((FOV * Math.PI) / 360)) / Math.max(1, this.rect.h);
    const cam = this.camaraActiva;
    const derecha = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const arriba = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const v = derecha.multiplyScalar(-dx * k).addScaledVector(arriba, dy * k);
    this.C.add(v);
    this.T.add(v);
  }

  private pivote: Vector3 | null = null;

  protected orbitar(dx: number, dy: number, x0: number, y0: number): void {
    // El punto bajo el cursor al empezar a orbitar
    this.pivote ??= this.puntoEnPlanoT(x0, y0);
    const P = this.pivote;
    const giro = (eje: Vector3, ang: number) => {
      const m = new Matrix4().makeRotationAxis(eje, ang);
      this.C.sub(P).applyMatrix4(m).add(P);
      this.T.sub(P).applyMatrix4(m).add(P);
    };
    giro(new Vector3(0, 0, 1), -dx * 0.008);
    const mirada = this.T.clone().sub(this.C).normalize();
    const derecha = new Vector3().crossVectors(mirada, new Vector3(0, 0, 1)).normalize();
    const ang = -dy * 0.008;
    // Sin pasar por encima del cenit ni por debajo del nadir
    const elev = Math.asin(Math.max(-1, Math.min(1, -mirada.z)));
    const lim = (89.5 * Math.PI) / 180;
    const nueva = elev - ang;
    if (derecha.lengthSq() > 0 && Math.abs(nueva) < lim) giro(derecha, ang);
  }

  protected acercar(factor: number, x: number, y: number): void {
    const P = this.puntoEnPlanoT(x, y);
    const D = this.C.distanceTo(this.T);
    const f = Math.max(0.02 / Math.max(D, 1e-6), 1 / factor);
    this.C.sub(P).multiplyScalar(f).add(P);
    this.T.sub(P).multiplyScalar(f).add(P);
  }

  override pointerup(e: PointerEvent, x: number, y: number): void {
    this.pivote = null;
    if (this.arrastreCaja) {
      this.arrastreCaja = null;
      if (this.filtro.caja) this.eventos.caja?.(this.filtro.caja);
      this.entorno.pintar();
      return;
    }
    super.pointerup(e, x, y);
  }

  // ─── Elegir ─────────────────────────────────────────────────────────────────────────────────

  /** Los extremos de cada segmento del alámbrico en px de la vista, y su profundidad (NaN detrás de la cámara). */
  private proyectados(): Float32Array | null {
    const a = this.alamb;
    if (!a) return null;
    this.actualizarCamaras();
    const cam = this.camaraActiva;
    const m = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
    const n = a.segmentos.length / 3;
    const r = new Float32Array(n * 3);
    const { w, h } = this.rect;
    for (let i = 0; i < n; i++) {
      const [x, y, z] = [a.segmentos[3 * i]!, a.segmentos[3 * i + 1]!, a.segmentos[3 * i + 2]!];
      const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
      if (cw <= 1e-6) {
        r[3 * i] = r[3 * i + 1] = r[3 * i + 2] = NaN;
        continue;
      }
      r[3 * i] = (((m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / cw + 1) / 2) * w;
      r[3 * i + 1] = ((1 - (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / cw) / 2) * h;
      r[3 * i + 2] = (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / cw;
    }
    return r;
  }

  /** ¿Está un punto del modelo (m) dentro de la caja de sección (o no hay caja)? */
  private enCaja(px: number, py: number, pz: number): boolean {
    const c = this.filtro.caja;
    return !c || (px >= c[0] - 1e-6 && px <= c[3] + 1e-6 && py >= c[1] - 1e-6 && py <= c[4] + 1e-6 && pz >= c[2] - 1e-6 && pz <= c[5] + 1e-6);
  }

  /** El rayo de la cámara por un píxel, en coordenadas de unos datos con su `origen`: [O, D]. */
  private rayo(x: number, y: number, origen: readonly number[]): [number[], number[]] | null {
    const o = this.origen;
    if (!o) return null;
    this.actualizarCamaras();
    const ndc = new Vector3((x / this.rect.w) * 2 - 1, -((y / this.rect.h) * 2 - 1), -1);
    const cam = this.camaraActiva;
    const a = ndc.clone().unproject(cam);
    const b = ndc.clone().setZ(1).unproject(cam);
    const dir = b.sub(a).normalize();
    return [
      [a.x + o[0] - origen[0]!, a.y + o[1] - origen[1]!, a.z + o[2] - origen[2]!],
      [dir.x, dir.y, dir.z],
    ];
  }

  /** El objeto del sólido que se ve bajo un píxel: el triángulo visible más cercano que corta su rayo dentro de la caja. */
  objetoSolidoEn(x: number, y: number): string | null {
    return this.solidoEn(x, y)?.id ?? null;
  }

  /** Lo mismo, con la distancia (m) del corte al origen del rayo. */
  private solidoEn(x: number, y: number): { id: string; t: number } | null {
    const so = this.sol;
    const r = so && this.malla ? this.rayo(x, y, so.origen) : null;
    if (!so || !this.malla || !r) return null;
    const idx = this.malla.geometry.index;
    const [O, D] = r;
    const T = so.triangulos;
    const I = idx ? (idx.array as Uint32Array) : null;
    const n = I ? I.length : 3 * so.objeto.length;
    let [mejor, tMin] = [-1, Infinity];
    for (let q = 0; q < n; q += 3) {
      const iv = I ? I[q]! : q;
      const k = 3 * iv;
      const e1 = [T[k + 3]! - T[k]!, T[k + 4]! - T[k + 1]!, T[k + 5]! - T[k + 2]!];
      const e2 = [T[k + 6]! - T[k]!, T[k + 7]! - T[k + 1]!, T[k + 8]! - T[k + 2]!];
      const pv = [D[1]! * e2[2]! - D[2]! * e2[1]!, D[2]! * e2[0]! - D[0]! * e2[2]!, D[0]! * e2[1]! - D[1]! * e2[0]!];
      const det = e1[0]! * pv[0]! + e1[1]! * pv[1]! + e1[2]! * pv[2]!;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tv = [O[0]! - T[k]!, O[1]! - T[k + 1]!, O[2]! - T[k + 2]!];
      const u = (tv[0]! * pv[0]! + tv[1]! * pv[1]! + tv[2]! * pv[2]!) * inv;
      if (u < 0 || u > 1) continue;
      const qv = [tv[1]! * e1[2]! - tv[2]! * e1[1]!, tv[2]! * e1[0]! - tv[0]! * e1[2]!, tv[0]! * e1[1]! - tv[1]! * e1[0]!];
      const v = (D[0]! * qv[0]! + D[1]! * qv[1]! + D[2]! * qv[2]!) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2[0]! * qv[0]! + e2[1]! * qv[1]! + e2[2]! * qv[2]!) * inv;
      if (!(t > 0 && t < tMin)) continue;
      if (!this.enCaja(O[0]! + t * D[0]! + so.origen[0], O[1]! + t * D[1]! + so.origen[1], O[2]! + t * D[2]! + so.origen[2])) continue;
      [mejor, tMin] = [iv / 3, t];
    }
    return mejor < 0 ? null : { id: so.objetos[so.objeto[mejor]!]!.id, t: tMin };
  }

  /**
   * La carga bajo un píxel: la de la flecha o el contorno más cercano a menos de 6 px o, si no, la del
   * bloque que corta su rayo; en sólido, sólo si no la tapa una pieza. Lo que recorta la caja, no.
   */
  cargaEn(x: number, y: number): string | null {
    const c = this.carg;
    const v = this.cargVis;
    const r = c ? this.rayo(x, y, c.origen) : null;
    if (!c || !v || !r) return null;
    const [O, D] = r;
    const solido = this.modoPintado === "solido" ? this.solidoEn(x, y) : null;
    const delante = (P: number[]) => {
      const t = (P[0]! - O[0]!) * D[0]! + (P[1]! - O[1]!) * D[1]! + (P[2]! - O[2]!) * D[2]!;
      return this.enCaja(P[0]! + c.origen[0], P[1]! + c.origen[1], P[2]! + c.origen[2]) && (!solido || t <= solido.t + 0.05);
    };
    const h = this.segmentoEn(v.segmentos, c.origen, x, y, RADIO_CLIC);
    if (h) {
      const S = v.segmentos;
      const P = [0, 1, 2].map((j) => S[6 * h.i + j]! + h.t * (S[6 * h.i + 3 + j]! - S[6 * h.i + j]!));
      if (delante(P)) return c.objetos[v.objeto[h.i]!]!.id;
    }
    // Los bloques (Möller–Trumbore)
    const T = v.triangulos;
    let [mejor, tMin] = [-1, Infinity];
    for (let k = 0; k < T.length; k += 9) {
      const e1 = [T[k + 3]! - T[k]!, T[k + 4]! - T[k + 1]!, T[k + 5]! - T[k + 2]!];
      const e2 = [T[k + 6]! - T[k]!, T[k + 7]! - T[k + 1]!, T[k + 8]! - T[k + 2]!];
      const pv = [D[1]! * e2[2]! - D[2]! * e2[1]!, D[2]! * e2[0]! - D[0]! * e2[2]!, D[0]! * e2[1]! - D[1]! * e2[0]!];
      const det = e1[0]! * pv[0]! + e1[1]! * pv[1]! + e1[2]! * pv[2]!;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tv = [O[0]! - T[k]!, O[1]! - T[k + 1]!, O[2]! - T[k + 2]!];
      const u = (tv[0]! * pv[0]! + tv[1]! * pv[1]! + tv[2]! * pv[2]!) * inv;
      if (u < 0 || u > 1) continue;
      const qv = [tv[1]! * e1[2]! - tv[2]! * e1[1]!, tv[2]! * e1[0]! - tv[0]! * e1[2]!, tv[0]! * e1[1]! - tv[1]! * e1[0]!];
      const w = (D[0]! * qv[0]! + D[1]! * qv[1]! + D[2]! * qv[2]!) * inv;
      if (w < 0 || u + w > 1) continue;
      const t = (e2[0]! * qv[0]! + e2[1]! * qv[1]! + e2[2]! * qv[2]!) * inv;
      if (!(t > 0 && t < tMin) || !delante([O[0]! + t * D[0]!, O[1]! + t * D[1]!, O[2]! + t * D[2]!])) continue;
      [mejor, tMin] = [k / 9, t];
    }
    return mejor < 0 ? null : c.objetos[v.objetoTri[mejor]!]!.id;
  }

  /** El objeto bajo un píxel: en sólido, la pieza que se ve; si no, el eje del alámbrico más cercano a menos de 6 px. */
  objetoEn(x: number, y: number): string | null {
    if (this.modoPintado === "solido" && this.sol) return this.objetoSolidoEn(x, y);
    const a = this.alamb;
    const p = this.proyectados();
    const o = this.origen;
    if (!a || !p || !o) return null;
    let mejor = -1;
    let [dm, zm] = [Infinity, Infinity];
    for (const i of this.segVis) {
      const [x0, y0, z0, x1, y1, z1] = [p[6 * i]!, p[6 * i + 1]!, p[6 * i + 2]!, p[6 * i + 3]!, p[6 * i + 4]!, p[6 * i + 5]!];
      if (Number.isNaN(x0) || Number.isNaN(x1)) continue;
      const [dx, dy] = [x1 - x0, y1 - y0];
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2)) : 0;
      const d = Math.hypot(x - x0 - t * dx, y - y0 - t * dy);
      const z = z0 + t * (z1 - z0);
      if (!(d <= RADIO_CLIC && (d < dm - 0.5 || (d < dm + 0.5 && z < zm)))) continue;
      // Lo que recorta la caja no se elige (el punto del eje más cercano, aproximado por t en pantalla)
      const q = (j: number) => a.segmentos[6 * i + j]! + t * (a.segmentos[6 * i + 3 + j]! - a.segmentos[6 * i + j]!) + a.origen[j]!;
      if (!this.enCaja(q(0), q(1), q(2))) continue;
      [mejor, dm, zm] = [i, d, z];
    }
    return mejor < 0 ? null : a.objetos[a.objeto[mejor]!]!.id;
  }

  protected clic(x: number, y: number, ctrl: boolean, doble: boolean): void {
    const v = this.cuboEn(x, y);
    if (v) return this.vistaEstandar(v);
    // Las cargas, antes que las piezas que cargan
    const o = this.cargaEn(x, y) ?? this.objetoEn(x, y);
    this.eventos.elegir?.(o ? [o] : [], ctrl, doble);
  }

  protected soltarVentana(c: [number, number, number, number], modo: "dentro" | "toca", ctrl: boolean): void {
    const a = this.alamb;
    const p = this.proyectados();
    if (!a || !p) return;
    const en = (x: number, y: number) => x >= c[0] && x <= c[2] && y >= c[1] && y <= c[3];
    const estado = new Map<number, boolean>();
    const evaluar = (x0: number, y0: number, x1: number, y1: number, visible: boolean): boolean => {
      let v: boolean;
      if (modo === "dentro") v = visible && en(x0, y0) && en(x1, y1);
      else {
        v = false;
        if (visible) {
          if (en(x0, y0) || en(x1, y1)) v = true;
          else {
            // Corte con los lados de la ventana
            const lados: [number, number, number, number][] = [
              [c[0], c[1], c[2], c[1]],
              [c[2], c[1], c[2], c[3]],
              [c[2], c[3], c[0], c[3]],
              [c[0], c[3], c[0], c[1]],
            ];
            const cruza = (a0: number, b0: number, a1: number, b1: number, p0: number, q0: number, p1: number, q1: number) => {
              const d = (a1 - a0) * (q1 - q0) - (b1 - b0) * (p1 - p0);
              if (d === 0) return false;
              const t = ((p0 - a0) * (q1 - q0) - (q0 - b0) * (p1 - p0)) / d;
              const u = ((p0 - a0) * (b1 - b0) - (q0 - b0) * (a1 - a0)) / d;
              return t >= 0 && t <= 1 && u >= 0 && u <= 1;
            };
            v = lados.some((l) => cruza(x0, y0, x1, y1, ...l));
          }
        }
      }
      return v;
    };
    for (const i of this.segVis) {
      const k = a.objeto[i]!;
      const [x0, y0, x1, y1] = [p[6 * i]!, p[6 * i + 1]!, p[6 * i + 3]!, p[6 * i + 4]!];
      const v = evaluar(x0, y0, x1, y1, !Number.isNaN(x0) && !Number.isNaN(x1));
      estado.set(k, modo === "dentro" ? (estado.get(k) ?? true) && v : (estado.get(k) ?? false) || v);
    }
    const ids = [...estado].filter(([, v]) => v).map(([k]) => a.objetos[k]!.id);
    // Las cargas, por sus flechas y contornos
    const cg = this.carg;
    const cv = this.cargVis;
    if (cg && cv) {
      const ec = new Map<number, boolean>();
      const S = cv.segmentos;
      const o = cg.origen;
      for (let i = 0; 6 * i < S.length; i++) {
        const k = cv.objeto[i]!;
        const q0 = this.aPantalla(S[6 * i]! + o[0], S[6 * i + 1]! + o[1], S[6 * i + 2]! + o[2]);
        const q1 = this.aPantalla(S[6 * i + 3]! + o[0], S[6 * i + 4]! + o[1], S[6 * i + 5]! + o[2]);
        const v = evaluar(q0?.[0] ?? NaN, q0?.[1] ?? NaN, q1?.[0] ?? NaN, q1?.[1] ?? NaN, !!q0 && !!q1);
        ec.set(k, modo === "dentro" ? (ec.get(k) ?? true) && v : (ec.get(k) ?? false) || v);
      }
      for (const [k, v] of ec) if (v) ids.push(cg.objetos[k]!.id);
    }
    this.eventos.elegir?.(ids, ctrl, false);
  }

  // ─── Bajo el cursor ─────────────────────────────────────────────────────────────────────────

  protected override pasar(x: number, y: number): void {
    if (!this.eventos.pasar) return;
    clearTimeout(this.pausaSonda);
    this.pausaSonda = window.setTimeout(() => this.avisarObjetivo(this.objetivoEn(x, y)), PAUSA_SONDA);
  }

  override salir(): void {
    clearTimeout(this.pausaSonda);
    this.avisarObjetivo(null);
  }

  private avisarObjetivo(o: Objetivo3D | null): void {
    const clave = o ? `${o.tipo}|${"pieza" in o ? `${o.pieza}|${o.s.toFixed(3)}` : "lamina" in o ? `${o.lamina}|${o.p.map((v) => v.toFixed(2)).join(",")}` : o.k}` : "";
    if (clave === this.ultimoObjetivo) return;
    this.ultimoObjetivo = clave;
    this.objetivo = o;
    if (!o && this.sonda) this.ponerSonda(null);
    this.eventos.pasar?.(o);
  }

  /** Un punto de la escena (relativo al origen de la vista) en px de la vista y su profundidad; null detrás de la cámara. */
  private proyector(): (x: number, y: number, z: number) => [number, number, number] | null {
    this.actualizarCamaras();
    const cam = this.camaraActiva;
    const m = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
    const { w, h } = this.rect;
    return (x, y, z) => {
      const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
      if (cw <= 1e-6) return null;
      return [(((m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / cw + 1) / 2) * w, ((1 - (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / cw) / 2) * h, (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / cw];
    };
  }

  /**
   * El segmento (de a pares de puntos, relativos a `origen` de sus datos) más cercano al cursor a
   * menos de `radio` px: su índice y el parámetro t (0 en a, 1 en b) del punto más cercano.
   */
  private segmentoEn(seg: Float32Array, origen: readonly number[], x: number, y: number, radio: number): { i: number; t: number } | null {
    const o = this.origen;
    if (!o) return null;
    const pr = this.proyector();
    const d = [origen[0]! - o[0], origen[1]! - o[1], origen[2]! - o[2]];
    let mejor: { i: number; t: number; d: number; z: number } | null = null;
    for (let i = 0; 6 * i < seg.length; i++) {
      const a = pr(seg[6 * i]! + d[0]!, seg[6 * i + 1]! + d[1]!, seg[6 * i + 2]! + d[2]!);
      const b = pr(seg[6 * i + 3]! + d[0]!, seg[6 * i + 4]! + d[1]!, seg[6 * i + 5]! + d[2]!);
      if (!a || !b) continue;
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
      const dd = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
      const z = a[2] + t * (b[2] - a[2]);
      if (dd <= radio && (!mejor || dd < mejor.d - 0.5 || (dd < mejor.d + 0.5 && z < mejor.z))) mejor = { i, t, d: dd, z };
    }
    return mejor && { i: mejor.i, t: mejor.t };
  }

  /** Lo que hay bajo un píxel: una flecha, un pilar, una barra con diagrama o un punto de un mapa. */
  objetivoEn(x: number, y: number): Objetivo3D | null {
    const entre = (seg: Float32Array, i: number, t: number, o: readonly number[]): [number, number, number] => [o[0]! + seg[6 * i]! + t * (seg[6 * i + 3]! - seg[6 * i]!), o[1]! + seg[6 * i + 1]! + t * (seg[6 * i + 4]! - seg[6 * i + 1]!), o[2]! + seg[6 * i + 2]! + t * (seg[6 * i + 5]! - seg[6 * i + 2]!)];
    const re = this.reac;
    if (re) {
      const h = this.segmentoEn(re.segmentos, re.origen, x, y, RADIO_SONDA);
      if (h) return { tipo: "reaccion", k: re.objetoSegmento[h.i]!, p: [...re.objetos[re.objetoSegmento[h.i]!]!.punto] as [number, number, number] };
    }
    const pl = this.pil;
    if (pl) {
      const h = this.segmentoEn(pl.segmentos, pl.origen, x, y, RADIO_SONDA);
      if (h) return { tipo: "pilar", k: h.i, p: entre(pl.segmentos, h.i, h.t, pl.origen) };
    }
    const d = this.diag;
    if (d) {
      const h = this.segmentoEn(d.ejes, d.origen, x, y, RADIO_SONDA);
      if (h) {
        const [s0, s1] = [d.ejeS[2 * h.i]!, d.ejeS[2 * h.i + 1]!];
        return { tipo: "barra", pieza: d.piezas[d.ejePieza[h.i]!]!.id, s: s0 + h.t * (s1 - s0), p: entre(d.ejes, h.i, h.t, d.origen) };
      }
    }
    const iso = this.iso;
    if (iso && iso.triangulos.length && this.origen) {
      this.actualizarCamaras();
      const ndc = new Vector3((x / this.rect.w) * 2 - 1, -((y / this.rect.h) * 2 - 1), -1);
      const cam = this.camaraActiva;
      const a = ndc.clone().unproject(cam);
      const b = ndc.clone().setZ(1).unproject(cam);
      const dir = b.sub(a).normalize();
      // El rayo en las coordenadas de los datos (relativas a su origen)
      const o = this.origen;
      const O = [a.x + o[0] - iso.origen[0], a.y + o[1] - iso.origen[1], a.z + o[2] - iso.origen[2]];
      const D = [dir.x, dir.y, dir.z];
      const T = iso.triangulos;
      let [mejor, tMin] = [-1, Infinity];
      for (let k = 0; k < T.length; k += 9) {
        // Möller–Trumbore
        const e1 = [T[k + 3]! - T[k]!, T[k + 4]! - T[k + 1]!, T[k + 5]! - T[k + 2]!];
        const e2 = [T[k + 6]! - T[k]!, T[k + 7]! - T[k + 1]!, T[k + 8]! - T[k + 2]!];
        const pv = [D[1]! * e2[2]! - D[2]! * e2[1]!, D[2]! * e2[0]! - D[0]! * e2[2]!, D[0]! * e2[1]! - D[1]! * e2[0]!];
        const det = e1[0]! * pv[0]! + e1[1]! * pv[1]! + e1[2]! * pv[2]!;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const tv = [O[0]! - T[k]!, O[1]! - T[k + 1]!, O[2]! - T[k + 2]!];
        const u = (tv[0]! * pv[0]! + tv[1]! * pv[1]! + tv[2]! * pv[2]!) * inv;
        if (u < 0 || u > 1) continue;
        const qv = [tv[1]! * e1[2]! - tv[2]! * e1[1]!, tv[2]! * e1[0]! - tv[0]! * e1[2]!, tv[0]! * e1[1]! - tv[1]! * e1[0]!];
        const v = (D[0]! * qv[0]! + D[1]! * qv[1]! + D[2]! * qv[2]!) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2[0]! * qv[0]! + e2[1]! * qv[1]! + e2[2]! * qv[2]!) * inv;
        if (t > 0 && t < tMin) [mejor, tMin] = [k / 9, t];
      }
      if (mejor >= 0) return { tipo: "lamina", lamina: iso.lamina[mejor]!, p: [O[0]! + tMin * D[0]! + iso.origen[0], O[1]! + tMin * D[1]! + iso.origen[1], O[2]! + tMin * D[2]! + iso.origen[2]] };
    }
    return null;
  }

  /** La sonda: un punto y un recuadro con sus líneas, dentro de la vista. */
  private dibujarSonda(ctx: CanvasRenderingContext2D): void {
    const so = this.sonda;
    if (!so || !so.lineas.length) return;
    const q = this.aPantalla(so.p[0], so.p[1], so.p[2]);
    if (!q) return;
    const col = this.entorno.colores();
    const anchos = so.lineas.map((t, i) => this.entorno.medir(t, 11, i === 0));
    const [w, h] = [Math.max(...anchos) + 16, so.lineas.length * 15 + 8];
    let [bx, by] = [q[0] + 12, q[1] - h - 8];
    if (bx + w > this.rect.w - 4) bx = q[0] - 12 - w;
    if (by < 4) by = q[1] + 12;
    ctx.save();
    ctx.beginPath();
    ctx.arc(q[0], q[1], 3.5, 0, 2 * Math.PI);
    ctx.fillStyle = col.acento;
    ctx.fill();
    ctx.strokeStyle = col.fondo;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = col.panel;
    ctx.globalAlpha = 0.96;
    ctx.fillRect(bx, by, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col.borde;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    so.lineas.forEach((t, i) => {
      ctx.font = fuente(11, i === 0);
      ctx.fillStyle = i === 0 ? col.texto : col.textoSuave;
      ctx.fillText(t, bx + 8, by + 4 + 7.5 + 15 * i);
    });
    ctx.restore();
  }

  cursor(): string | null {
    const T = this.T;
    const o = this.origen;
    if (!o) return null;
    return `3D · mirando a x ${rotulo(T.x + o[0], 4)} · y ${rotulo(T.y + o[1], 4)} · z ${rotulo(T.z + o[2], 4)} m`;
  }

  // ─── ViewCube ───────────────────────────────────────────────────────────────────────────────

  /** Los vértices del cubo en px y su profundidad, con la rotación de la cámara. */
  private cubo(): { centro: [number, number]; px: (v: readonly number[]) => [number, number, number] } {
    this.actualizarCamaras();
    const m = this.camaraActiva.matrixWorldInverse.elements;
    const centro: [number, number] = [this.rect.w - CUBO.margen, CUBO.margen];
    const px = (v: readonly number[]): [number, number, number] => {
      const [x, y, z] = [m[0]! * v[0]! + m[4]! * v[1]! + m[8]! * v[2]!, m[1]! * v[0]! + m[5]! * v[1]! + m[9]! * v[2]!, m[2]! * v[0]! + m[6]! * v[1]! + m[10]! * v[2]!];
      return [centro[0] + x * CUBO.lado, centro[1] - y * CUBO.lado, z];
    };
    return { centro, px };
  }

  private carasVisibles(): { cara: (typeof CARAS)[number]; poligono: [number, number][]; z: number }[] {
    const { px } = this.cubo();
    const r: { cara: (typeof CARAS)[number]; poligono: [number, number][]; z: number }[] = [];
    for (const cara of CARAS) {
      const n = px(cara.n.map((x) => x));
      const c0 = px([0, 0, 0]);
      // Visible si su normal mira a la cámara (z de vista hacia el observador)
      if (n[2] - c0[2] <= 0.05) continue;
      // Las cuatro esquinas de la cara: los dos ejes que no son su normal
      const ejes = [0, 1, 2].filter((k) => cara.n[k] === 0);
      const esq = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([a, b]) => {
        const v = [...cara.n] as number[];
        v[ejes[0]!] = a!;
        v[ejes[1]!] = b!;
        const q = px(v);
        return [q[0], q[1]] as [number, number];
      });
      r.push({ cara, poligono: esq, z: n[2] });
    }
    return r.sort((a, b) => a.z - b.z);
  }

  private cuboEn(x: number, y: number): VistaEstandar | null {
    const { px } = this.cubo();
    for (const e of ESQUINAS) {
      const q = px(e.p);
      if (q[2] > px([0, 0, 0])[2] && Math.hypot(x - q[0], y - q[1]) <= 6) return e.vista;
    }
    const caras = this.carasVisibles();
    for (let i = caras.length - 1; i >= 0; i--) {
      const p = caras[i]!.poligono;
      let c = false;
      for (let a = 0, b = p.length - 1; a < p.length; b = a++) if (p[a]![1] > y !== p[b]![1] > y && x < ((p[b]![0] - p[a]![0]) * (y - p[a]![1])) / (p[b]![1] - p[a]![1]) + p[a]![0]) c = !c;
      if (c) return caras[i]!.cara.vista;
    }
    return null;
  }

  private dibujarCubo(ctx: CanvasRenderingContext2D): void {
    const col = this.entorno.colores();
    const { px } = this.cubo();
    ctx.save();
    ctx.lineJoin = "round";
    for (const { cara, poligono } of this.carasVisibles()) {
      ctx.beginPath();
      poligono.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = col.panel;
      ctx.globalAlpha = 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col.borde;
      ctx.lineWidth = 1;
      ctx.stroke();
      const [cx, cy] = [poligono.reduce((s, p) => s + p[0], 0) / 4, poligono.reduce((s, p) => s + p[1], 0) / 4];
      const area = Math.abs(poligono.reduce((s, p, i) => s + p[0] * poligono[(i + 1) % 4]![1] - poligono[(i + 1) % 4]![0] * p[1], 0)) / 2;
      if (area > 320) {
        ctx.font = fuente(10.5, true);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = col.textoSuave;
        ctx.fillText(cara.nombre, cx, cy);
      }
    }
    for (const e of ESQUINAS) {
      const q = px(e.p);
      if (q[2] <= px([0, 0, 0])[2]) continue;
      ctx.beginPath();
      ctx.arc(q[0], q[1], 3, 0, 2 * Math.PI);
      ctx.fillStyle = col.acento;
      ctx.fill();
    }
    // Los ejes X, Y, Z bajo el cubo
    const o = px([0, 0, 0]);
    const base: [number, number] = [this.rect.w - CUBO.margen - 1.75 * CUBO.lado, CUBO.margen + 1.9 * CUBO.lado];
    for (const [v, t, c] of [
      [[1, 0, 0], "X", "#dc2626"],
      [[0, 1, 0], "Y", "#16a34a"],
      [[0, 0, 1], "Z", "#2563eb"],
    ] as const) {
      const q = px(v);
      const [dx, dy] = [(q[0] - o[0]) * 0.75, (q[1] - o[1]) * 0.75];
      ctx.beginPath();
      ctx.moveTo(base[0], base[1]);
      ctx.lineTo(base[0] + dx, base[1] + dy);
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = fuente(9, true);
      ctx.fillStyle = c;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(t, base[0] + dx * 1.35, base[1] + dy * 1.35);
    }
    ctx.restore();
  }

  // ─── Pintar ─────────────────────────────────────────────────────────────────────────────────

  render(r: WebGLRenderer): void {
    if (this.temaColores !== this.entorno.tema()) {
      this.colores();
      this.construirElegidos();
      if (this.carg) this.construirCargas(false);
    }
    this.degradado.pintar(r, this.entorno.colores().fondo, this.entorno.tema());
    if (!this.alamb && !this.geo && !this.diag && !this.iso && !this.pil && !this.reac && !this.carg && !this.sol) return;
    this.actualizarCamaras();
    this.actualizarSuelo();
    // La caja de sección de esta vista (los planos son de todos los materiales del 3D)
    const c = this.filtro.caja;
    const o = this.origen;
    for (let k = 0; k < 6; k++) PLANOS[k]!.constant = c && o ? (k < 3 ? -(c[k]! - o[k]!) : c[k]! - o[k - 3]!) : LEJOS;
    const { w, h } = this.rect;
    MAT.lineas.resolution.set(w, h);
    MAT.elegidas.resolution.set(w, h);
    MAT.curvas.resolution.set(w, h);
    MAT.pilares.resolution.set(w, h);
    MAT.reacciones.resolution.set(w, h);
    MAT.cargas.resolution.set(w, h);
    MAT.original.resolution.set(w, h);
    // Los colores de los rellenos, los del tema de esta vista (las vistas comparten los materiales)
    const t = this.entorno.tema();
    MAT.positivo.color.set(pintura("diagrama-positivo", t).fill ?? "#dc2626");
    MAT.negativo.color.set(pintura("diagrama-negativo", t).fill ?? "#2563eb");
    // El color de lo elegido es el de esta vista (el acento del tema)
    MAT.elegidas.color.set(this.entorno.colores().acento);
    r.render(this.escena3, this.camaraActiva);
  }

  superponer(ctx: CanvasRenderingContext2D): void {
    if (this.fondo.rejilla && this.suelo.objeto.visible) this.suelo.rotular(ctx, (x, y, z) => this.aPantalla(x, y, z), this.entorno.tema(), this.entorno.colores().fondo, this.fondo.tenue);
    this.dibujarRotulos(ctx);
    this.dibujarAsas(ctx);
    this.dibujarSonda(ctx);
    if (this.alamb || this.geo) this.dibujarCubo(ctx);
    this.dibujarVentana(ctx);
  }

  // ─── Caja de sección (I3) ───────────────────────────────────────────────────────────────────

  /**
   * La caja de sección con la que empezar: la de lo elegido (su sólido o, sin él, sus ejes) con
   * 0,5 m de margen, o la de todo el modelo.
   */
  cajaPropuesta(ids: ReadonlySet<string>): CajaSeccion | null {
    const c: CajaSeccion = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const poner = (x: number, y: number, z: number) => {
      const q = [x, y, z];
      for (let k = 0; k < 3; k++) {
        c[k] = Math.min(c[k]!, q[k]!);
        c[k + 3] = Math.max(c[k + 3]!, q[k]!);
      }
    };
    const so = this.sol;
    const a = this.alamb;
    if (ids.size && so) {
      const k = new Set<number>();
      so.objetos.forEach((o, i) => ids.has(o.id) && k.add(i));
      for (let t = 0; t < so.objeto.length; t++) if (k.has(so.objeto[t]!)) for (let v = 0; v < 3; v++) poner(so.triangulos[9 * t + 3 * v]! + so.origen[0], so.triangulos[9 * t + 3 * v + 1]! + so.origen[1], so.triangulos[9 * t + 3 * v + 2]! + so.origen[2]);
    } else if (ids.size && a) {
      for (let i = 0; i < a.objeto.length; i++) if (ids.has(a.objetos[a.objeto[i]!]!.id)) for (let v = 0; v < 2; v++) poner(a.segmentos[6 * i + 3 * v]! + a.origen[0], a.segmentos[6 * i + 3 * v + 1]! + a.origen[1], a.segmentos[6 * i + 3 * v + 2]! + a.origen[2]);
    }
    const m = Number.isFinite(c[0]) ? 0.5 : 0.01;
    if (!Number.isFinite(c[0])) {
      const t = so?.caja ?? a?.caja;
      if (!t) return null;
      for (let k = 0; k < 6; k++) c[k] = t[k]!;
    }
    return [c[0] - m, c[1] - m, c[2] - m, c[3] + m, c[4] + m, c[5] + m];
  }

  /** El centro de cada cara de la caja (0–2: las de menor x, y, z; 3–5: las de mayor) y su normal hacia fuera. */
  private carasCaja(): { centro: [number, number, number]; n: [number, number, number] }[] {
    const c = this.filtro.caja;
    if (!c) return [];
    const m = [(c[0] + c[3]) / 2, (c[1] + c[4]) / 2, (c[2] + c[5]) / 2];
    return [0, 1, 2, 3, 4, 5].map((k) => {
      const a = k % 3;
      const centro = [...m] as [number, number, number];
      centro[a] = c[k]!;
      const n: [number, number, number] = [0, 0, 0];
      n[a] = k < 3 ? -1 : 1;
      return { centro, n };
    });
  }

  /** El asa bajo un píxel, con la dirección en pantalla de 1 m hacia fuera de su cara. */
  private asaEn(x: number, y: number): { cara: number; dir: [number, number] } | null {
    let mejor: { cara: number; dir: [number, number]; d: number } | null = null;
    this.carasCaja().forEach(({ centro, n }, k) => {
      const p = this.aPantalla(...centro);
      const q = this.aPantalla(centro[0] + n[0], centro[1] + n[1], centro[2] + n[2]);
      if (!p || !q) return;
      const d = Math.hypot(x - p[0], y - p[1]);
      const dir: [number, number] = [q[0] - p[0], q[1] - p[1]];
      // De canto (su normal mira a la cámara) no se puede arrastrar
      if (d <= ASA.radio && Math.hypot(...dir) > 0.5 && (!mejor || d < mejor.d)) mejor = { cara: k, dir, d };
    });
    return mejor && { cara: (mejor as { cara: number }).cara, dir: (mejor as { dir: [number, number] }).dir };
  }

  private dibujarAsas(ctx: CanvasRenderingContext2D): void {
    if (!this.filtro.caja) return;
    const col = this.entorno.colores();
    ctx.save();
    this.carasCaja().forEach(({ centro }, k) => {
      const p = this.aPantalla(...centro);
      if (!p) return;
      ctx.fillStyle = this.arrastreCaja?.cara === k ? col.acento : col.panel;
      ctx.strokeStyle = col.acento;
      ctx.lineWidth = 1.5;
      ctx.fillRect(p[0] - ASA.lado / 2, p[1] - ASA.lado / 2, ASA.lado, ASA.lado);
      ctx.strokeRect(p[0] - ASA.lado / 2 + 0.5, p[1] - ASA.lado / 2 + 0.5, ASA.lado - 1, ASA.lado - 1);
    });
    ctx.restore();
  }

  override pointerdown(e: PointerEvent, x: number, y: number): void {
    const c = this.filtro.caja;
    const asa = c && e.button === 0 ? this.asaEn(x, y) : null;
    if (c && asa) {
      const s0 = this.sobreEjeCara(asa.cara, x, y);
      if (s0 !== null) {
        this.alActivar?.();
        this.arrastreCaja = { cara: asa.cara, v0: c[asa.cara]!, s0 };
        this.entorno.pintar();
        return;
      }
    }
    super.pointerdown(e, x, y);
  }

  /**
   * Dónde cae el cursor a lo largo del eje de una cara de la caja (la recta por su centro según su
   * eje): el punto de esa recta más cercano al rayo del cursor, como su coordenada en el eje (m).
   */
  private sobreEjeCara(cara: number, x: number, y: number): number | null {
    const c = this.carasCaja()[cara];
    const r = this.rayo(x, y, [0, 0, 0]);
    if (!c || !r) return null;
    const [O, D] = r;
    const a = cara % 3;
    // Recta P0 + s·e (e, el eje a); rayo O + t·D: s = (b·e' − d)/(1 − b²) con b = e·D, d = e·w, e' = D·w, w = P0 − O
    const w = [c.centro[0] - O[0]!, c.centro[1] - O[1]!, c.centro[2] - O[2]!];
    const b = D[a]!;
    const den = 1 - b * b;
    if (den < 1e-6) return null;
    const s = (b * (D[0]! * w[0]! + D[1]! * w[1]! + D[2]! * w[2]!) - w[a]!) / den;
    return c.centro[a]! + s;
  }

  override pointermove(e: PointerEvent, x: number, y: number): void {
    const a = this.arrastreCaja;
    const c = this.filtro.caja;
    if (!a || !c) return super.pointermove(e, x, y);
    // Lo que se mueve el cursor a lo largo del eje de la cara, en m
    const s = this.sobreEjeCara(a.cara, x, y);
    if (s === null) return;
    const nueva = [...c] as CajaSeccion;
    const k = a.cara;
    const v = a.v0 + (s - a.s0);
    nueva[k] = k < 3 ? Math.min(v, c[k + 3]! - CAJA_MINIMA) : Math.max(v, c[k - 3]! + CAJA_MINIMA);
    this.filtro = { ...this.filtro, caja: nueva };
    this.construirCaja();
    this.entorno.pintar();
  }

  /** Los rótulos de resultados: los extremos de lo que se ve y los de las piezas elegidas. */
  private rotulos(): Rotulo3D[] {
    const r: Rotulo3D[] = [];
    const d = this.diag;
    if (d) {
      for (const e of d.extremos) r.push({ p: e.punta, texto: `${e.que} ${rotulo(e.valor)} ${d.unidad} · ${e.pieza}${e.comb ? ` · ${e.comb}` : ""}`, signo: Math.sign(e.valor), prioridad: 100 });
      if (this.elegidos.size)
        for (const x of d.piezas) {
          if (!this.elegidos.has(x.id)) continue;
          if (x.max && x.max.valor > 0) r.push({ p: x.max.punta, texto: rotulo(x.max.valor), signo: 1, prioridad: 80 });
          if (x.min && x.min.valor < 0) r.push({ p: x.min.punta, texto: rotulo(x.min.valor), signo: -1, prioridad: 80 });
        }
    }
    const i = this.iso;
    if (i) for (const e of i.extremos) r.push({ p: e.punto, texto: `${e.que} ${rotulo(e.valor)} ${i.unidad} · ${e.objeto}`, signo: Math.sign(e.valor), prioridad: 100 });
    const pl = this.pil;
    if (pl)
      for (const e of pl.extremos) {
        const v = pl.magnitud === "nu" ? `ν ${rotulo(e.valor, 3)}` : `N ${rotulo(e.valor)} kN`;
        r.push({ p: e.punto, texto: `${e.que === "pasa el límite" ? "" : `${e.que} `}${v} · ${e.pilar} bajo ${e.planta}${e.que === "pasa el límite" ? "" : ` · ${e.comb}`}`, signo: e.que === "mayor compresión" ? -1 : 1, prioridad: e.que === "pasa el límite" ? 70 : 100 });
      }
    const re = this.reac;
    if (re) {
      // En el color del texto: el rojo y el azul son los signos de los diagramas, no los de una fuerza
      for (const e of re.extremos) r.push({ p: e.punto, texto: `${e.que}: Fz ${rotulo(e.valor)} kN · ${e.id}${re.conjunto.n > 1 ? ` · ${e.comb}` : ""}`, signo: 0, prioridad: 100 });
      for (const o of re.objetos) if (o.R[2]) r.push({ p: [o.punto[0], o.punto[1], o.punto[2] - (o.R[2]! * re.escala.m) / (re.escala.valor || 1)], texto: rotulo(o.R[2]!), signo: 0, prioridad: 10 + 50 * (Math.abs(o.R[2]!) / (re.escala.valor || 1)) });
    }
    const ca = this.carg;
    if (ca) {
      // Las de la planta resaltada y las elegidas (en sólido, las de abajo están dentro del edificio)
      const max = Math.max(...ca.objetos.map((o) => o.peso), 1e-30);
      const vis = this.cargVis?.visibles;
      for (const [k, o] of ca.objetos.entries()) {
        if (vis && !vis.has(k)) continue;
        const elegida = this.elegidos.has(o.id);
        if (elegida || (this.activa !== null && o.plantas.includes(this.activa))) r.push({ p: o.punto, texto: o.texto, signo: 0, prioridad: elegida ? 90 : 10 + (50 * o.peso) / max });
      }
    }
    if (this.u && this.modo === "analitico" && this.geo)
      for (const e of this.extremosDef) {
        const k = this.escalaU * (this.animar ? this.fase : 1);
        const n = 3 * e.nudo;
        r.push({ p: [e.punto[0] + k * this.u[n]!, e.punto[1] + k * this.u[n + 1]!, e.punto[2] + k * this.u[n + 2]!], texto: `${e.que} ${rotulo(e.valor)} mm${e.objeto ? ` · ${e.objeto}` : ""}`, signo: e.que === "menor uz" ? -1 : 0, prioridad: 100 });
      }
    return r.sort((a, b) => b.prioridad - a.prioridad);
  }

  /** Con halo y sin pisarse: el que no cabe no se dibuja (el de más prioridad, antes). */
  private dibujarRotulos(ctx: CanvasRenderingContext2D): void {
    const rs = this.rotulos();
    if (!rs.length || !this.origen) return;
    const col = this.entorno.colores();
    const oscuro = this.entorno.tema() === "dark";
    const ocupados: [number, number, number, number][] = [];
    ctx.save();
    ctx.font = fuente(11, true);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const r of rs) {
      const q = this.aPantalla(r.p[0], r.p[1], r.p[2]);
      if (!q || q[0] < 0 || q[1] < 0 || q[0] > this.rect.w || q[1] > this.rect.h) continue;
      const ancho = this.entorno.medir(r.texto, 11, true);
      const caja: [number, number, number, number] = [q[0] - 4, q[1] - 8, q[0] + 10 + ancho, q[1] + 8];
      if (ocupados.some((o) => caja[0] < o[2] && caja[2] > o[0] && caja[1] < o[3] && caja[3] > o[1])) continue;
      ocupados.push(caja);
      const color = r.signo > 0 ? (oscuro ? "#fca5a5" : "#b91c1c") : r.signo < 0 ? (oscuro ? "#93c5fd" : "#1d4ed8") : col.texto;
      ctx.beginPath();
      ctx.arc(q[0], q[1], 3, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      // El signo, en el punto; el texto, en el color del texto: el azul sobre las bandas azules de un mapa no se leía
      textoConHalo(ctx, r.texto, q[0] + 8, q[1], col.texto, col.fondo);
    }
    ctx.restore();
  }

  /** Para el banco de Chrome: lo que dibuja y lo elegido. */
  async depuracion(): Promise<{ tipo: "3d"; segmentos: number; elegidos: string[]; modo: Modo3D; pintado: Modo3D; proyeccion: Proyeccion; diagramas: number; isovalores: number; pilares: number; reacciones: number; cargas: number; cargasVisibles: number; sonda: string[] | null; objetivo: Objetivo3D | null; animada: boolean; solido: { triangulos: number; aristas: number } | null; color: Color3D; filtro: FiltroVista }> {
    const d = this.diag;
    return {
      tipo: "3d",
      segmentos: this.segVis.length,
      pintado: this.modoPintado,
      solido: this.malla ? { triangulos: this.triVis, aristas: (this.bordes?.geometry.index?.count ?? 0) / 2 } : null,
      color: this.color,
      filtro: this.filtro,
      elegidos: [...this.elegidos],
      modo: this.modo,
      proyeccion: this.proyeccion,
      diagramas: d ? (d.positivo.length + d.negativo.length) / 9 : 0,
      isovalores: (this.iso?.triangulos.length ?? 0) / 9,
      pilares: (this.pil?.segmentos.length ?? 0) / 6,
      reacciones: (this.reac?.segmentos.length ?? 0) / 6,
      cargas: (this.carg?.segmentos.length ?? 0) / 6,
      cargasVisibles: (this.cargVis?.segmentos.length ?? 0) / 6,
      sonda: this.sonda?.lineas ?? null,
      objetivo: this.objetivo,
      animada: this.animar,
    };
  }

  /**
   * Para el banco (I3): sha256 de los búferes del sólido que llegaron (triángulos y aristas) y de la
   * lista de los triángulos que se pintan con los filtros.
   */
  async huellaSolido(): Promise<{ triangulos: string; aristas: string; visibles: string } | null> {
    const x = this.sol;
    if (!x || !this.malla) return null;
    const idx = this.malla.geometry.index;
    const sha = async (a: ArrayBufferView) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(a.buffer, a.byteOffset, a.byteLength) as Uint8Array<ArrayBuffer>)), (b) => b.toString(16).padStart(2, "0")).join("");
    const I = idx ? (idx.array as Uint32Array) : null;
    const vis = new Uint32Array(I ? I.length / 3 : x.objeto.length);
    for (let k = 0; k < vis.length; k++) vis[k] = I ? I[3 * k]! / 3 : k;
    return { triangulos: await sha(x.triangulos), aristas: await sha(x.aristas), visibles: await sha(vis) };
  }

  /** Un punto del modelo (m) en px de la vista (para el banco). */
  aPantalla(x: number, y: number, z: number): [number, number] | null {
    const o = this.origen;
    if (!o) return null;
    this.actualizarCamaras();
    const v = new Vector3(x - o[0], y - o[1], z - o[2]).project(this.camaraActiva);
    // Detrás de la cámara (o fuera de sus planos): no está en pantalla
    if (v.z < -1 || v.z > 1) return null;
    return [((v.x + 1) / 2) * this.rect.w, ((1 - v.y) / 2) * this.rect.h];
  }

  liberar(): void {
    for (const t of this.tareas.values()) clearTimeout(t);
    this.tareas.clear();
    this.animar = false;
    cancelAnimationFrame(this.reloj);
    clearTimeout(this.pausaSonda);
    this.quitarAnalitico();
    this.quitar(this.objsDiag);
    this.quitar(this.objsIso);
    this.quitar(this.objsPil);
    this.quitar(this.objsReac);
    this.quitar(this.objsCarg);
    if (this.lineasOriginal) {
      this.escena3.remove(this.lineasOriginal);
      this.lineasOriginal.geometry.dispose();
      this.lineasOriginal = null;
    }
    for (const o of [this.malla, this.bordes, this.lineasCaja]) {
      if (!o) continue;
      this.escena3.remove(o);
      o.geometry.dispose();
    }
    this.malla = this.bordes = null;
    this.lineasCaja = null;
    this.sol = null;
    this.diag = this.iso = null;
    this.pil = null;
    this.reac = null;
    this.carg = null;
    this.cargVis = null;
    this.alamb = null;
    this.segVis = new Uint32Array(0);
    this.construirAlambrico();
    this.elegidos = new Set();
    this.construirElegidos();
  }
}
