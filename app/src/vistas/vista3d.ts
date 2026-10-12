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
 * (`reacciones3d.ts`), flechas; y la deformada, animada si se pide, con la original en gris. Los
 * rótulos, en el lienzo 2D: los extremos de lo que se ve y los de las piezas elegidas, sin pisarse.
 *
 * Bajo el cursor (I4): al quedarse quieto el ratón, la vista busca lo que hay debajo (la estación de
 * un diagrama, el punto de un mapa, un tramo de pilar o una flecha) y lo dice por `eventos.pasar`;
 * quien la alimenta pide su consulta y le devuelve la sonda que dibuja (`ponerSonda`).
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
  Scene,
  Vector3,
  type WebGLRenderer,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { rotulo } from "../../../src/agente/render/escena.ts";
import type { Alambrico } from "../../../src/visor/alambrico.ts";
import type { Geometria3D } from "../../../src/visor/datos.ts";
import type { Diagramas3D } from "../../../src/visor/diagramas3d.ts";
import type { Isovalores3D } from "../../../src/visor/isovalores3d.ts";
import { SIN_BANDA, type Pilares3D } from "../../../src/visor/pilares3d.ts";
import { COLOR_REACCION, type Reacciones3D } from "../../../src/visor/reacciones3d.ts";
import type { ExtremoDeformada } from "../../../src/visor/datos.ts";
import { pintura } from "../lienzo/pintura.ts";
import { fuente, textoConHalo, Vista, type Entorno } from "./motor.ts";

export type Modo3D = "alambrico" | "analitico";
export type Proyeccion = "perspectiva" | "ortografica";

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
  /** Lo que hay bajo el cursor quieto (null: nada, o el cursor se fue). */
  pasar?: (o: Objetivo3D | null) => void;
}

interface Paleta3D {
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
  light: { pilar: "#1e293b", viga: "#475569", losa: "#8794a3", pano: "#97835c", muro: "#64748b", activa: "#0369a1", laminaLosa: "#c9d6e3", laminaMuro: "#9aa5b1", vigueta: "#a08a5e", original: "#94a3b8" },
  dark: { pilar: "#d4d6db", viga: "#9aa3ae", losa: "#6b7686", pano: "#b49a68", muro: "#8a94a1", activa: "#38bdf8", laminaLosa: "#33414f", laminaMuro: "#5b6573", vigueta: "#b49a68", original: "#5b6575" },
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
const CUBO = { margen: 44, lado: 17 };

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
  /** El alámbrico sin deformar, bajo la deformada. */
  original: new LineMaterial({ linewidth: 1, worldUnits: false, transparent: true, opacity: 0.55 }),
};

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
  private iso: Isovalores3D | null = null;
  private objsDiag: (Mesh | LineSegments2)[] = [];
  private objsIso: (Mesh | LineSegments)[] = [];
  private pil: Pilares3D | null = null;
  private reac: Reacciones3D | null = null;
  private objsPil: LineSegments2[] = [];
  private objsReac: LineSegments2[] = [];
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

  constructor(entorno: Entorno, camara?: Camara3D | null) {
    super(entorno);
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
    this.construirAlambrico();
    if (!this.encuadrada) this.encuadrar();
    this.entorno.pintar();
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
  ponerIsovalores(i: Isovalores3D | null): void {
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
    this.entorno.pintar();
  }

  private visibilidad(): void {
    if (this.lineas) this.lineas.visible = this.modo === "alambrico";
    for (const o of [this.laminas, this.barras, this.originales]) if (o) o.visible = this.modo === "analitico";
    if (this.lineasOriginal) this.lineasOriginal.visible = this.modo === "analitico" && !!this.u;
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

  private construirAlambrico(): void {
    if (this.lineas) {
      this.escena3.remove(this.lineas);
      this.lineas.geometry.dispose();
      this.lineas = null;
    }
    const a = this.alamb;
    if (a && a.objeto.length) {
      const g = new LineSegmentsGeometry();
      g.setPositions(a.segmentos);
      g.setColors(new Float32Array(a.segmentos.length));
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
    for (let i = 0; i < a.objeto.length; i++) if (k.has(a.objeto[i]!)) for (let j = 0; j < 6; j++) pos.push(a.segmentos[6 * i + j]!);
    const g = new LineSegmentsGeometry();
    g.setPositions(pos);
    MAT.elegidas.color.set(this.entorno.colores().acento);
    this.lineasElegidas = new LineSegments2(g, MAT.elegidas);
    this.lineasElegidas.renderOrder = 10;
    this.lineasElegidas.frustumCulled = false;
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
    this.originales.visible = this.modo === "analitico";
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
      const tipos: Record<string, [number, number, number]> = { pilar: rgb(c.pilar), viga: rgb(c.viga), losa: rgb(c.losa), pano: rgb(c.pano), muro: rgb(c.muro) };
      const tenues: Record<string, [number, number, number]> = Object.fromEntries(Object.entries(tipos).map(([k, v]) => [k, tenue(v)]));
      const ia = this.activa === null ? -1 : a.plantas.indexOf(this.activa);
      const col = new Float32Array(a.segmentos.length);
      for (let i = 0; i < a.objeto.length; i++) {
        const t = a.objetos[a.objeto[i]!]!.tipo;
        const cc = ia < 0 || a.planta[i] === ia ? tipos[t]! : tenues[t]!;
        for (let j = 0; j < 2; j++) col.set(cc, 6 * i + 3 * j);
      }
      this.lineas.geometry.setColors(col);
    }
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
    return null;
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

  /** El objeto del alámbrico bajo un píxel (null si no hay ninguno a menos de 6 px). */
  objetoEn(x: number, y: number): string | null {
    const a = this.alamb;
    const p = this.proyectados();
    if (!a || !p) return null;
    let mejor = -1;
    let [dm, zm] = [Infinity, Infinity];
    for (let i = 0; i < a.objeto.length; i++) {
      const [x0, y0, z0, x1, y1, z1] = [p[6 * i]!, p[6 * i + 1]!, p[6 * i + 2]!, p[6 * i + 3]!, p[6 * i + 4]!, p[6 * i + 5]!];
      if (Number.isNaN(x0) || Number.isNaN(x1)) continue;
      const [dx, dy] = [x1 - x0, y1 - y0];
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2)) : 0;
      const d = Math.hypot(x - x0 - t * dx, y - y0 - t * dy);
      const z = z0 + t * (z1 - z0);
      if (d <= RADIO_CLIC && (d < dm - 0.5 || (d < dm + 0.5 && z < zm))) [mejor, dm, zm] = [i, d, z];
    }
    return mejor < 0 ? null : a.objetos[a.objeto[mejor]!]!.id;
  }

  protected clic(x: number, y: number, ctrl: boolean, doble: boolean): void {
    const v = this.cuboEn(x, y);
    if (v) return this.vistaEstandar(v);
    const o = this.objetoEn(x, y);
    this.eventos.elegir?.(o ? [o] : [], ctrl, doble);
  }

  protected soltarVentana(c: [number, number, number, number], modo: "dentro" | "toca", ctrl: boolean): void {
    const a = this.alamb;
    const p = this.proyectados();
    if (!a || !p) return;
    const en = (x: number, y: number) => x >= c[0] && x <= c[2] && y >= c[1] && y <= c[3];
    const estado = new Map<number, boolean>();
    for (let i = 0; i < a.objeto.length; i++) {
      const k = a.objeto[i]!;
      const [x0, y0, x1, y1] = [p[6 * i]!, p[6 * i + 1]!, p[6 * i + 3]!, p[6 * i + 4]!];
      const visible = !Number.isNaN(x0) && !Number.isNaN(x1);
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
      estado.set(k, modo === "dentro" ? (estado.get(k) ?? true) && v : (estado.get(k) ?? false) || v);
    }
    const ids = [...estado].filter(([, v]) => v).map(([k]) => a.objetos[k]!.id);
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
      if (q[2] > px([0, 0, 0])[2] && Math.hypot(x - q[0], y - q[1]) <= 5) return e.vista;
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
      if (area > 200) {
        ctx.font = fuente(9, true);
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
      ctx.arc(q[0], q[1], 2.5, 0, 2 * Math.PI);
      ctx.fillStyle = col.acento;
      ctx.fill();
    }
    // Los ejes X, Y, Z bajo el cubo
    const o = px([0, 0, 0]);
    const base: [number, number] = [this.rect.w - CUBO.margen - 30, CUBO.margen + 32];
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
    }
    if (!this.alamb && !this.geo && !this.diag && !this.iso && !this.pil && !this.reac) return;
    this.actualizarCamaras();
    const { w, h } = this.rect;
    MAT.lineas.resolution.set(w, h);
    MAT.elegidas.resolution.set(w, h);
    MAT.curvas.resolution.set(w, h);
    MAT.pilares.resolution.set(w, h);
    MAT.reacciones.resolution.set(w, h);
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
    this.dibujarRotulos(ctx);
    this.dibujarSonda(ctx);
    if (this.alamb || this.geo) this.dibujarCubo(ctx);
    this.dibujarVentana(ctx);
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
      textoConHalo(ctx, r.texto, q[0] + 8, q[1], color, col.fondo);
    }
    ctx.restore();
  }

  /** Para el banco de Chrome: lo que dibuja y lo elegido. */
  async depuracion(): Promise<{ tipo: "3d"; segmentos: number; elegidos: string[]; modo: Modo3D; proyeccion: Proyeccion; diagramas: number; isovalores: number; pilares: number; reacciones: number; sonda: string[] | null; objetivo: Objetivo3D | null; animada: boolean }> {
    const d = this.diag;
    return {
      tipo: "3d",
      segmentos: this.alamb?.objeto.length ?? 0,
      elegidos: [...this.elegidos],
      modo: this.modo,
      proyeccion: this.proyeccion,
      diagramas: d ? (d.positivo.length + d.negativo.length) / 9 : 0,
      isovalores: (this.iso?.triangulos.length ?? 0) / 9,
      pilares: (this.pil?.segmentos.length ?? 0) / 6,
      reacciones: (this.reac?.segmentos.length ?? 0) / 6,
      sonda: this.sonda?.lineas ?? null,
      objetivo: this.objetivo,
      animada: this.animar,
    };
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
    if (this.lineasOriginal) {
      this.escena3.remove(this.lineasOriginal);
      this.lineasOriginal.geometry.dispose();
      this.lineasOriginal = null;
    }
    this.diag = this.iso = null;
    this.pil = null;
    this.reac = null;
    this.alamb = null;
    this.construirAlambrico();
    this.elegidos = new Set();
    this.construirElegidos();
  }
}
