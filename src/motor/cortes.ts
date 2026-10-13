/**
 * Cortes (E5): esfuerzos que atraviesan un plano, reducidos a un punto, con el convenio de las
 * barras: [N, Vy, Vz, T, My, Mz] en la cara de normal +x del corte (cabecera de modelo.ts). Una
 * franja de losa cortada con z = la normal de la losa se lee como una viga (My > 0, momento de
 * vano; Vz, el cortante); un machón de muro cortado en horizontal con x hacia arriba, como un pilar.
 *
 * Definición (`Corte`): plano por `origen` con normal `x`; eje z = `vz` proyectado sobre el plano;
 * y = z × x. El corte es la parte del plano dentro del rectángulo y ∈ [y0, y1], z ∈ [z0, z1]
 * (coordenadas respecto al origen). El rectángulo puede ser un segmento: una franja de losa
 * (z0 = z1 = 0) o un machón de muro (y0 = y1 = 0). Los esfuerzos son los que el lado +x (B) ejerce
 * sobre el lado −x (A) a través del corte; los nudos del corte (a menos de TOL_CORTE del plano)
 * quedan del lado B, así que una carga nodal sobre ellos no entra.
 *
 * Qué entra:
 * - Láminas que tocan el plano desde el lado A, con el centroide dentro del rectángulo: la suma de
 *   sus fuerzas nodales g = k·u − f_eq en los nudos del corte. Es exacto: un corte que separa el
 *   modelo en dos cierra el equilibrio con las cargas y reacciones de un lado.
 * - Láminas que atraviesan el plano:
 *   · "fuerzas-nodales" (por defecto): no puede haberlas (error): el corte tiene que seguir la malla
 *     (el compilador siembra las líneas de corte, H29).
 *   · "campos": la integral de los campos recuperados (SPR, campos.ts) a lo largo de su intersección
 *     con el plano, recortada al rectángulo; si el tramo acaba en un borde libre, con la fuerza de
 *     borde de Kirchhoff. Vale en cualquier posición; no es exacto. Si el corte sigue la malla
 *     entero, usa fuerzas nodales, así que un corte alineado da lo mismo por los dos métodos. Si
 *     atraviesa alguna lámina, todas las láminas van por campos, también los lados que caen sobre el
 *     plano (C2-2): las fuerzas nodales sólo son exactas sumando todas las láminas de un lado en cada
 *     nudo del corte, y mezclarlas con integrales en un mismo nudo contaba dos veces lo que pasa por
 *     él (+38 % en un corte que pasa por los vértices de una malla no estructurada).
 * - Barras: si atraviesan el plano, su esfuerzo exacto en el punto de cruce (diagrama de E2, o la
 *   fuerza de su nudo del lado A si el cruce cae en un offset rígido); si sólo lo tocan en un nudo
 *   desde el lado A, su fuerza nodal en ese nudo.
 * - Restricciones (cuerpos rígidos) con nudos a los dos lados: lo que transmiten a través del
 *   plano, Σ de sus fuerzas sobre sus nudos del lado A (fuerzasNodales.ts). Si parte de esos nudos
 *   cae fuera del rectángulo (un diafragma cortado por una franja), su parte no se puede atribuir
 *   al corte: las componentes que transmite (todas en un enlace rígido; las de su plano en un
 *   diafragma) quedan en NaN con un aviso.
 *
 * Todo es lineal en (u, cargas): los esfuerzos de una combinación son la combinación de los de sus
 * casos.
 *
 * Rendimiento (C5, criterio 8): un corte sólo mira lo que tiene cerca, con un índice espacial
 * (`indice.ts`) de láminas, barras y restricciones; el lado de cada nudo se calcula al pedirlo, y las
 * fuerzas nodales de un elemento o de una restricción que ya pidió otro corte (con los mismos
 * `casos`) se reutilizan. El resultado es el mismo, bit a bit, que recorriendo todo el modelo. Lo
 * único que se mira en todo el modelo es si una barra con offsets es ambigua.
 */
import { DiagramasBarras } from "./barras.ts";
import type { ElementoMotor } from "./elementos.ts";
import { Diagnosticos, listaIds, type Diagnostico } from "./diagnosticos.ts";
import { FuerzasNodales, type FuerzasRestriccion } from "./fuerzasNodales.ts";
import { cajaDe, IndiceCajas } from "./indice.ts";
import type { ModeloAnalitico, ResultadoCaso, Vec3 } from "./modelo.ts";

/** Distancia al plano por debajo de la cual un nudo está en el corte (m): la tolerancia numérica de H28. */
export const TOL_CORTE = 1e-6;

export type MetodoCorte = "fuerzas-nodales" | "campos";

export interface Corte {
  /** Para los diagnósticos. */
  id?: string;
  /** Punto de reducción de los momentos y origen de las coordenadas y, z del rectángulo (global). */
  origen: Vec3;
  /** Normal del plano (eje x del corte): los esfuerzos son los del lado +x sobre el −x. */
  x: Vec3;
  /** Dirección de referencia del eje z del corte, que se proyecta sobre el plano (como el vz de las barras). */
  vz: Vec3;
  /** Extensión del corte según y (m, respecto al origen). Por defecto, [0, 0]. */
  y?: readonly [number, number];
  /** Extensión del corte según z (m, respecto al origen). Por defecto, [0, 0]. */
  z?: readonly [number, number];
  metodo?: MetodoCorte;
  /**
   * Sólo las láminas (F): sin barras ni restricciones, ni las láminas rígidas (con sus 4 nudos en un
   * mismo enlace rígido: la huella de un pilar), que pueden atravesar el plano. Es el corte de la losa
   * de una franja de armado: las vigas se dimensionan con sus diagramas, y lo que pasa por la huella
   * de un pilar no es de la losa.
   */
  soloLaminas?: boolean;
  /**
   * Método «campos»: coordenadas y en las que se parten los tramos de lámina antes de integrarlos
   * (los bordes de las franjas de una estación, F), para que cada punto de integración caiga entero
   * a un lado. Sin ellas, los tramos de siempre.
   */
  quiebres?: readonly number[];
  /**
   * Por fuerzas nodales: devuelve también lo que aporta cada lámina que toca el plano desde el lado
   * A (`porLamina` del resultado), para repartir el corte entre franjas cuyos bordes no siguen la
   * malla (F).
   */
  porLamina?: boolean;
  /**
   * Método «campos»: puntos de Gauss por tramo de lámina, 4 (por defecto) o 2. Con 2, exacto si el
   * campo es cuadrático a lo largo del tramo (una lámina paralelogramo, como las de la rejilla), y
   * la mitad de puntos: lo usan las estaciones de paso de las franjas (F).
   */
  cuadratura?: 2 | 4;
}

/**
 * Puntos de integración del método «campos» a lo largo del corte (los de Gauss de cada tramo de
 * lámina), con los campos recuperados en unos ejes de franja: x = la normal al corte en el plano de
 * la lámina (hacia +x del corte), z = la normal de la lámina orientada hacia el z del corte (si es
 * perpendicular, hacia su y), y = z × x. En una franja de losa son los ejes de la franja: Mx es el
 * momento que la flecta, y Σ peso·Mx es su My. Sirven para aplicar Wood–Armer punto a punto antes
 * de integrar (H25, H34).
 */
export interface MuestrasCorte {
  /** Lámina de cada punto. */
  laminas: Int32Array;
  /** Puntos (globales): 3 por punto. */
  puntos: Float64Array;
  /** Coordenadas y, z en el corte: 2 por punto. */
  yz: Float64Array;
  /** Peso de integración (m): Σ peso·valor = ∫ valor a lo largo del corte. */
  pesos: Float64Array;
  /** Ejes de franja de cada punto por filas (x, y, z): 9 por punto. */
  ejes: Float64Array;
  /** Por caso: [Nx, Ny, Nxy, Mx, My, Mxy, Qx, Qy] en los ejes de franja, 8 por punto. */
  valores: Float64Array[];
}

/** Contribución de las láminas por el método de campos (la da campos.ts). */
export interface IntegradorCampos {
  /**
   * Fuerza y momento (respecto al origen del corte, globales) que el lado B ejerce sobre las láminas
   * del lado A, por caso (6 por caso), y los puntos de integración. Con `lados`, integra también los
   * lados de lámina que caen sobre el plano (corte mixto); sin él, sólo los muestrea. Añade a `info`
   * las láminas que integra y la extensión, y a `diag` sus avisos.
   */
  integrar(corte: CortePreparado, casos: readonly ResultadoCaso[], info: InfoCorte, diag: Diagnosticos, lados?: boolean): { suma: Float64Array; muestras: MuestrasCorte };
}

/** Corte con sus ejes y el lado de cada nudo, preparado para integrar. */
export interface CortePreparado {
  corte: Corte;
  origen: Float64Array;
  /** Ejes por filas: x, y, z. */
  ejes: Float64Array;
  y: readonly [number, number];
  z: readonly [number, number];
  /** Lado de un nudo: −1 (A), 0 (en el plano), +1 (B). Se calcula al pedirlo. */
  lado(v: number): number;
  /** ¿Cae la proyección del punto dentro del rectángulo (con TOL_CORTE)? */
  dentro(p: ArrayLike<number>): boolean;
  /** `dentro` del nudo v. */
  dentroNudo(v: number): boolean;
  /** Coordenadas (x, y, z) del punto en los ejes del corte, respecto al origen. */
  coordenadas(p: ArrayLike<number>): [number, number, number];
}

export interface InfoCorte {
  laminas: number[];
  barras: number[];
  restricciones: number[];
  /** Extensión real del corte según y y z: la de lo que lo atraviesa (null si no lo atraviesa nada). */
  extension: { y: [number, number]; z: [number, number] } | null;
}

export interface ResultadoCorte extends InfoCorte {
  /**
   * [N, Vy, Vz, T, My, Mz] por caso (6·nc), en los ejes del corte y respecto a su origen. NaN en
   * las componentes que el corte no puede dar (ver los diagnósticos).
   */
  esfuerzos: Float64Array;
  /** Ejes del corte por filas: x, y, z. */
  ejes: Float64Array;
  diagnosticos: Diagnostico[];
  /** Sin diagnósticos de error. Un corte no válido no trae esfuerzos (todo NaN). */
  valido: boolean;
  /** Sólo con el método «campos»: los puntos de integración de las láminas. */
  muestras?: MuestrasCorte;
  /**
   * Con `porLamina` (y sin láminas que atraviesen el plano): lo que aporta cada lámina que toca el
   * plano desde el lado A, [N, Vy, Vz, T, My, Mz] por caso (6·nc) en los ejes del corte y respecto a
   * su origen, y el tramo y de sus nudos en el corte. Suman las láminas de `esfuerzos`.
   */
  porLamina?: { lamina: number; y: [number, number]; esfuerzos: Float64Array }[];
}

const norma = (v: ArrayLike<number>) => Math.hypot(v[0]!, v[1]!, v[2]!);
const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === "number" && Number.isFinite(c));
const rango = (r: unknown): r is readonly [number, number] => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[0] <= r[1];
const COMPONENTES = ["N", "Vy", "Vz", "T", "My", "Mz"] as const;

/** Acumulador de fuerza y momento (respecto a O) por caso. */
class Suma {
  readonly v: Float64Array;
  private readonly O: Float64Array;
  constructor(nc: number, O: Float64Array) {
    this.v = new Float64Array(6 * nc);
    this.O = O;
  }
  /** Fuerza F y momento m aplicados en X, con signo s. */
  agregar(k: number, X: ArrayLike<number>, F: ArrayLike<number>, m: ArrayLike<number>, s = 1): void {
    const o = 6 * k;
    const x = X[0]! - this.O[0]!;
    const y = X[1]! - this.O[1]!;
    const z = X[2]! - this.O[2]!;
    const fx = s * F[0]!;
    const fy = s * F[1]!;
    const fz = s * F[2]!;
    this.v[o]! += fx;
    this.v[o + 1]! += fy;
    this.v[o + 2]! += fz;
    this.v[o + 3]! += s * m[0]! + y * fz - z * fy;
    this.v[o + 4]! += s * m[1]! + z * fx - x * fz;
    this.v[o + 5]! += s * m[2]! + x * fy - y * fx;
  }
}

/**
 * Caja (global) del rectángulo de un corte, con holgura: lo que el corte puede tocar tiene su caja en
 * el índice (las láminas, agrandada por su diámetro) cortándola.
 */
export function cajaCorte(cp: CortePreparado): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const y of cp.y)
    for (const z of cp.z)
      for (let c = 0; c < 3; c++) {
        const v = cp.origen[c]! + y * cp.ejes[3 + c]! + z * cp.ejes[6 + c]!;
        min[c] = Math.min(min[c]!, v - 4 * TOL_CORTE);
        max[c] = Math.max(max[c]!, v + 4 * TOL_CORTE);
      }
  return { min, max };
}

/** Lado de las celdas del índice: el doble del diámetro medio de los elementos (o 1/16 del modelo, sin elementos). */
export function ladoIndice(diametros: readonly number[], tamano: number): number {
  const d = diametros.filter((x) => x > 0);
  return Math.max(1e-3, d.length ? (2 * d.reduce((a, b) => a + b, 0)) / d.length : tamano / 16);
}

export class Cortes {
  readonly modelo: ModeloAnalitico;
  readonly fuerzas: FuerzasNodales;
  private diagramas: DiagramasBarras | null = null;
  private indice: {
    /** Láminas (caja agrandada por su diámetro) y barras (con sus offsets), por su posición en `fuerzas.elementos`. */
    elementos: IndiceCajas;
    /** Barras con algún offset (posición en `fuerzas.elementos`): las únicas que pueden ser ambiguas. */
    conOffsets: number[];
    /** Restricciones (caja de sus nudos agrandada por su diámetro). */
    restricciones: IndiceCajas;
    /** Caja de los nudos de cada restricción, sin agrandar (6 por restricción). */
    cajasRestricciones: Float64Array;
  } | null = null;

  /**
   * Fuerzas nodales de los elementos y de las restricciones que ya ha pedido algún corte, por la
   * identidad de `casos` (los resultados de un cálculo, que no cambian): una lámina junto a un pilar
   * o el enlace de su huella los piden varios cortes (sus dos caras, las muestras, las bandas de las
   * dos direcciones). Son los mismos valores que se calcularían de nuevo.
   */
  private readonly guardados = new WeakMap<readonly ResultadoCaso[], { laminas: Map<number, Float64Array[]>; barras: Map<number, Float64Array[]>; restricciones: Map<string, Map<number, FuerzasRestriccion>[]> }>();

  /** Lado de cada nudo del último corte preparado y su época (`preparar`). */
  private lados = new Int8Array(0);
  private epocas = new Uint32Array(0);
  private epoca = 0;

  /** `diagramas`: los de las barras del modelo, si ya se tienen (se preparan una sola vez). */
  constructor(modelo: ModeloAnalitico, opciones: { diagramas?: DiagramasBarras } = {}) {
    this.modelo = modelo;
    this.fuerzas = new FuerzasNodales(modelo);
    if (opciones.diagramas) this.diagramas = opciones.diagramas;
  }

  private guardado(casos: readonly ResultadoCaso[]) {
    let g = this.guardados.get(casos);
    if (!g) this.guardados.set(casos, (g = { laminas: new Map(), barras: new Map(), restricciones: new Map() }));
    const { laminas, barras, restricciones } = g;
    const pedir = <K, V>(m: Map<K, V>, k: K, f: () => V): V => {
      let v = m.get(k);
      if (v === undefined) m.set(k, (v = f()));
      return v;
    };
    return {
      lamina: (l: number) => pedir(laminas, l, () => this.fuerzas.laminaCasos(l, casos)),
      barra: (b: number) => pedir(barras, b, () => this.fuerzas.barraCasos(b, casos)),
      restricciones: (cuales: readonly number[]) => pedir(restricciones, cuales.join(","), () => this.fuerzas.restricciones(casos, cuales)),
    };
  }

  /** Índices espaciales de elementos y restricciones (C5, criterio 8), la primera vez que se piden. */
  private indices(): NonNullable<Cortes["indice"]> {
    if (this.indice) return this.indice;
    const { xyz, tamano } = this.fuerzas.geo;
    const els = this.fuerzas.elementos;
    const cajas = new Float64Array(6 * els.length).fill(NaN);
    const conOffsets: number[] = [];
    const diametros: number[] = [];
    els.forEach((e, p) => {
      if (e.tipo === "lamina") {
        cajas.set(cajaDe(xyz, e.nudos, [], true, TOL_CORTE), 6 * p);
        const b = cajaDe(xyz, e.nudos);
        diametros.push(Math.sqrt((b[3]! - b[0]!) ** 2 + (b[4]! - b[1]!) ** 2 + (b[5]! - b[2]!) ** 2));
      } else if (e.tipo === "barra") {
        const pb = e.barra!;
        cajas.set(cajaDe(xyz, e.nudos, [pb.ip, pb.jp], false, TOL_CORTE), 6 * p);
        const [i, j] = e.nudos as [number, number];
        let igual = true;
        for (let q = 0; q < 3; q++) igual &&= pb.ip[q] === xyz[3 * i + q] && pb.jp[q] === xyz[3 * j + q];
        if (!igual) conOffsets.push(p);
      }
    });
    const lado = ladoIndice(diametros, tamano);
    const lista = this.modelo.restricciones ?? [];
    const cajasR = new Float64Array(6 * lista.length);
    const agrandadas = new Float64Array(6 * lista.length);
    lista.forEach((rs, ir) => {
      const nudos = [rs.maestro, ...rs.esclavos];
      cajasR.set(cajaDe(xyz, nudos), 6 * ir);
      agrandadas.set(cajaDe(xyz, nudos, [], true, TOL_CORTE), 6 * ir);
    });
    this.indice = { elementos: new IndiceCajas(cajas, lado), conOffsets, restricciones: new IndiceCajas(agrandadas, lado), cajasRestricciones: cajasR };
    return this.indice;
  }

  /** Comprueba la definición y prepara los ejes y el lado de cada nudo; null si no es válida. */
  preparar(corte: Corte, diag: Diagnosticos): CortePreparado | null {
    const id = corte.id ?? "(sin id)";
    const y = corte.y ?? [0, 0];
    const z = corte.z ?? [0, 0];
    const quiebres = corte.quiebres;
    if (!vec(corte.origen) || !vec(corte.x) || !vec(corte.vz) || !rango(y) || !rango(z) || (corte.metodo !== undefined && corte.metodo !== "fuerzas-nodales" && corte.metodo !== "campos") || (quiebres !== undefined && !(Array.isArray(quiebres) && quiebres.every((q) => typeof q === "number" && Number.isFinite(q)))) || (corte.cuadratura !== undefined && corte.cuadratura !== 2 && corte.cuadratura !== 4)) {
      diag.error("corte/no-valido", `El corte ${id} no está bien definido: origen, x y vz son vectores finitos, y e z rangos [mín, máx] finitos, el método "fuerzas-nodales" o "campos", los quiebres, números finitos, y la cuadratura, 2 o 4.`, [id]);
      return null;
    }
    const nx = norma(corte.x);
    if (!(nx > 0)) {
      diag.error("corte/no-valido", `El corte ${id} tiene una normal nula.`, [id]);
      return null;
    }
    const ex = corte.x.map((c) => c / nx);
    const p = corte.vz[0] * ex[0]! + corte.vz[1] * ex[1]! + corte.vz[2] * ex[2]!;
    const vzp = [corte.vz[0] - p * ex[0]!, corte.vz[1] - p * ex[1]!, corte.vz[2] - p * ex[2]!];
    const nz = norma(vzp);
    if (!(nz > 1e-6 * norma(corte.vz))) {
      diag.error("corte/no-valido", `El vz del corte ${id} es (casi) paralelo a su normal: no fija el eje z.`, [id]);
      return null;
    }
    const ez = vzp.map((c) => c / nz);
    const ey = [ez[1]! * ex[2]! - ez[2]! * ex[1]!, ez[2]! * ex[0]! - ez[0]! * ex[2]!, ez[0]! * ex[1]! - ez[1]! * ex[0]!];
    const ejes = Float64Array.of(...ex, ...ey, ...ez);
    const O = Float64Array.from(corte.origen);
    const coordenadas = (q: ArrayLike<number>): [number, number, number] => {
      const d0 = q[0]! - O[0]!;
      const d1 = q[1]! - O[1]!;
      const d2 = q[2]! - O[2]!;
      return [d0 * ejes[0]! + d1 * ejes[1]! + d2 * ejes[2]!, d0 * ejes[3]! + d1 * ejes[4]! + d2 * ejes[5]!, d0 * ejes[6]! + d1 * ejes[7]! + d2 * ejes[8]!];
    };
    // Las cuentas de `coordenadas`, sin crear el array
    const enRectangulo = (q0: number, q1: number, q2: number) => {
      const d0 = q0 - O[0]!;
      const d1 = q1 - O[1]!;
      const d2 = q2 - O[2]!;
      const cy = d0 * ejes[3]! + d1 * ejes[4]! + d2 * ejes[5]!;
      const cz = d0 * ejes[6]! + d1 * ejes[7]! + d2 * ejes[8]!;
      return cy >= y[0] - TOL_CORTE && cy <= y[1] + TOL_CORTE && cz >= z[0] - TOL_CORTE && cz <= z[1] + TOL_CORTE;
    };
    const { xyz } = this.fuerzas.geo;
    const dentro = (q: ArrayLike<number>) => enRectangulo(q[0]!, q[1]!, q[2]!);
    const dentroNudo = (v: number) => enRectangulo(xyz[3 * v]!, xyz[3 * v + 1]!, xyz[3 * v + 2]!);
    // El lado de cada nudo, al pedirlo: un corte sólo mira los nudos de lo que tiene cerca. Los
    // búferes se reutilizan entre cortes; `epoca` dice si el lado guardado es de este corte
    const nn = this.modelo.nudos.length;
    if (this.lados.length !== nn) [this.lados, this.epocas] = [new Int8Array(nn), new Uint32Array(nn)];
    const { lados, epocas } = this;
    const epoca = ++this.epoca;
    const lado = (v: number) => {
      if (epocas[v] === epoca) return lados[v]!;
      const d = (xyz[3 * v]! - O[0]!) * ex[0]! + (xyz[3 * v + 1]! - O[1]!) * ex[1]! + (xyz[3 * v + 2]! - O[2]!) * ex[2]!;
      epocas[v] = epoca;
      return (lados[v] = Math.abs(d) <= TOL_CORTE ? 0 : d < 0 ? -1 : 1);
    };
    return { corte, origen: O, ejes, y, z, lado, dentro, dentroNudo, coordenadas };
  }

  /**
   * Esfuerzos del corte en cada caso de `casos` (los de un cálculo válido, en el orden de
   * `modelo.casos`). `campos` hace falta con el método "campos".
   */
  cortar(corte: Corte, casos: readonly ResultadoCaso[], campos?: IntegradorCampos): ResultadoCorte {
    const diag = new Diagnosticos();
    const nc = casos.length;
    const id = corte.id ?? "(sin id)";
    const info: InfoCorte = { laminas: [], barras: [], restricciones: [], extension: null };
    const vacio = (ejes: Float64Array = new Float64Array(9)): ResultadoCorte => ({ ...info, esfuerzos: new Float64Array(6 * nc).fill(NaN), ejes, diagnosticos: diag.lista, valido: false });
    const cp = this.preparar(corte, diag);
    if (!cp) return vacio();
    const metodo = corte.metodo ?? "fuerzas-nodales";
    if (metodo === "campos" && !campos) throw new Error("Cortes: el método «campos» necesita un IntegradorCampos (CamposLaminas)");
    const { lado, origen: O, ejes } = cp;
    const { xyz } = this.fuerzas.geo;
    const X = (v: number) => xyz.subarray(3 * v, 3 * v + 3);
    // Lo que puede tocar el rectángulo del corte (índice espacial), en el orden del modelo
    const ind = this.indices();
    const caja = cajaCorte(cp);
    const cerca = ind.elementos.buscar(caja.min, caja.max).map((p) => this.fuerzas.elementos[p]!);
    const suma = new Suma(nc, O);
    const ext = { y: [Infinity, -Infinity] as [number, number], z: [Infinity, -Infinity] as [number, number] };
    let muestras: MuestrasCorte | undefined;
    const extender = (p: ArrayLike<number>) => {
      const [, cy, cz] = cp.coordenadas(p);
      ext.y[0] = Math.min(ext.y[0], cy);
      ext.y[1] = Math.max(ext.y[1], cy);
      ext.z[0] = Math.min(ext.z[0], cz);
      ext.z[1] = Math.max(ext.z[1], cz);
    };

    // Láminas: las que tocan el plano desde el lado A, por sus fuerzas nodales (exacto); las que lo
    // atraviesan, error por fuerzas nodales o integral de campos. Si el método es «campos» y alguna lo
    // atraviesa, todas van por campos (corte mixto, C2-2).
    let mixto = false;
    const porLamina: { lamina: number; y: [number, number]; suma: Float64Array }[] = [];
    {
      const atraviesan: string[] = [];
      const bordes: string[] = [];
      const tocan: ElementoMotor[] = [];
      const rigida = corte.soloLaminas ? this.laminaRigida() : null;
      for (const e of cerca) {
        if (e.tipo !== "lamina" || rigida?.(e.nudos)) continue;
        let menos = 0;
        let mas = 0;
        const c = [0, 0, 0];
        for (const v of e.nudos) {
          const s = lado(v);
          if (s < 0) menos++;
          else if (s > 0) mas++;
          for (let q = 0; q < 3; q++) c[q]! += xyz[3 * v + q]! / 4;
        }
        if (menos === 0 || !cp.dentro(c)) continue;
        if (mas > 0) {
          if (metodo === "fuerzas-nodales") atraviesan.push(e.id);
          else mixto = true;
          continue;
        }
        tocan.push(e);
      }
      for (const e of mixto ? [] : tocan) {
        const enCorte = e.nudos.map((v, a) => [v, a] as const).filter(([v]) => lado(v) === 0);
        if (enCorte.length === 0) continue;
        info.laminas.push(e.indice);
        if (enCorte.some(([v]) => !cp.dentro(X(v)))) bordes.push(e.id);
        const propia = corte.porLamina ? new Suma(nc, O) : null;
        this.guardado(casos).lamina(e.indice).forEach((g, k) => {
          for (const [v, a] of enCorte) {
            suma.agregar(k, X(v), g.subarray(6 * a, 6 * a + 3), g.subarray(6 * a + 3, 6 * a + 6));
            propia?.agregar(k, X(v), g.subarray(6 * a, 6 * a + 3), g.subarray(6 * a + 3, 6 * a + 6));
          }
        });
        if (propia) {
          const ys = enCorte.map(([v]) => cp.coordenadas(X(v))[1]);
          porLamina.push({ lamina: e.indice, y: [Math.min(...ys), Math.max(...ys)], suma: propia.v });
        }
        for (const [v] of enCorte) extender(X(v));
      }
      if (atraviesan.length) {
        diag.error(
          "corte/atraviesa-laminas",
          `El corte ${id} atraviesa ${atraviesan.length} láminas por dentro (${listaIds(atraviesan)}): por fuerzas nodales tiene que seguir los lados de la malla. Usa el método "campos" o siembra la línea del corte en la malla.`,
          [id, ...atraviesan],
        );
      }
      if (bordes.length) {
        diag.aviso(
          "corte/borde-no-sigue-malla",
          `Los bordes del corte ${id} no siguen la malla: ${bordes.length} láminas (${listaIds(bordes)}) entran enteras aunque parte de su lado quede fuera del rectángulo. La extensión real va en «extension».`,
          [id, ...bordes],
        );
      }
    }
    if (metodo === "campos") {
      const c = campos!.integrar(cp, casos, info, diag, mixto);
      for (let q = 0; q < c.suma.length; q++) suma.v[q]! += c.suma[q]!;
      muestras = c.muestras;
      if (info.extension) {
        for (const q of [0, 1] as const) {
          ext.y[q] = q ? Math.max(ext.y[1], info.extension.y[1]) : Math.min(ext.y[0], info.extension.y[0]);
          ext.z[q] = q ? Math.max(ext.z[1], info.extension.z[1]) : Math.min(ext.z[0], info.extension.z[0]);
        }
      }
    }

    // Barras (no con `soloLaminas`)
    const conBarras = !corte.soloLaminas;
    const ladoDe = (d: number) => (Math.abs(d) <= TOL_CORTE ? 0 : d < 0 ? -1 : 1);
    // Con los dos nudos del mismo lado (o los dos en el plano), una barra sólo cruza si un offset saca
    // el tramo flexible al otro lado: se mira en todas las que tienen offsets, estén donde estén
    const ambiguas: string[] = [];
    for (const p of conBarras ? ind.conOffsets : []) {
      const e = this.fuerzas.elementos[p]!;
      const [i, j] = e.nudos as [number, number];
      const si = lado(i);
      if (si === 0 || si !== lado(j)) continue;
      if (ladoDe(this.distancia(cp, e.barra!.ip)) === -si || ladoDe(this.distancia(cp, e.barra!.jp)) === -si) ambiguas.push(e.id);
    }
    for (const e of cerca) {
      if (e.tipo !== "barra" || !conBarras) continue;
      const [i, j] = e.nudos as [number, number];
      const si = lado(i);
      const sj = lado(j);
      if (si === sj) continue;
      const pb = e.barra!;
      const dIp = this.distancia(cp, pb.ip);
      const dJp = this.distancia(cp, pb.jp);
      if (si === 0 || sj === 0) {
        // Toca el plano en un nudo: entra si la barra queda del lado A
        const [n0, a0, otro] = si === 0 ? [i, 0, sj] : [j, 1, si];
        if (otro !== -1 || !cp.dentro(X(n0))) continue;
        info.barras.push(e.indice);
        extender(X(n0));
        this.guardado(casos).barra(e.indice).forEach((g, k) => {
          suma.agregar(k, X(n0), g.subarray(6 * a0, 6 * a0 + 3), g.subarray(6 * a0 + 3, 6 * a0 + 6));
        });
        continue;
      }
      // Atraviesa: en el tramo flexible (diagrama exacto) o en un offset (fuerza del nudo del lado A)
      const aEsI = si === -1;
      const flexible = ladoDe(dIp) * ladoDe(dJp) === -1;
      let p: number[];
      if (flexible) {
        const t = dIp / (dIp - dJp);
        p = [0, 1, 2].map((q) => pb.ip[q]! + t * (pb.jp[q]! - pb.ip[q]!));
      } else {
        // Primer tramo del polígono i → i' → j' → j que cambia de lado
        const puntos = [X(i), pb.ip, pb.jp, X(j)];
        const d = [this.distancia(cp, X(i)), dIp, dJp, this.distancia(cp, X(j))];
        p = [...puntos[0]!];
        for (let s = 0; s < 3; s++) {
          if (d[s]! === 0 || d[s]! * d[s + 1]! <= 0) {
            const t = d[s]! === d[s + 1]! ? 0 : d[s]! / (d[s]! - d[s + 1]!);
            p = [0, 1, 2].map((q) => puntos[s]![q]! + t * (puntos[s + 1]![q]! - puntos[s]![q]!));
            break;
          }
        }
      }
      if (!cp.dentro(p)) continue;
      info.barras.push(e.indice);
      extender(p);
      if (flexible) {
        const dgs = this.diagramasBarras();
        const t = dIp / (dIp - dJp);
        const x = t * pb.L;
        const R = pb.R;
        casos.forEach((r, k) => {
          const s = dgs.diagrama(e.indice, k, r).esfuerzosEn(x, aEsI ? -1 : 1);
          // Fuerza y momento sobre la cara +x de la barra (del tramo [0, x) por el (x, L]); My = −m_y, Mz = m_z
          const Fl = [s[0]!, s[1]!, s[2]!];
          const ml = [s[3]!, -s[4]!, s[5]!];
          const F = [0, 1, 2].map((q) => R[q]! * Fl[0]! + R[3 + q]! * Fl[1]! + R[6 + q]! * Fl[2]!);
          const m = [0, 1, 2].map((q) => R[q]! * ml[0]! + R[3 + q]! * ml[1]! + R[6 + q]! * ml[2]!);
          suma.agregar(k, p, F, m, aEsI ? 1 : -1);
        });
      } else {
        const [nA, aA] = aEsI ? [i, 0] : [j, 1];
        this.guardado(casos).barra(e.indice).forEach((g, k) => {
          suma.agregar(k, X(nA), g.subarray(6 * aA, 6 * aA + 3), g.subarray(6 * aA + 3, 6 * aA + 6), -1);
        });
      }
    }
    if (ambiguas.length) {
      diag.error(
        "corte/barra-ambigua",
        `El corte ${id} pasa entre un nudo y el tramo flexible de ${ambiguas.length} barras (${listaIds(ambiguas)}): sus offsets cruzan el plano y vuelven. Mueve el corte.`,
        [id, ...ambiguas],
      );
    }

    // Restricciones que atraviesan el plano (no con `soloLaminas`)
    const lista = this.modelo.restricciones ?? [];
    const incluidas: number[] = [];
    const nan = new Uint8Array(6);
    // Sólo las que pueden tener un nudo del lado A dentro del rectángulo: las cercanas (índice) cuya
    // caja, proyectada sobre los ejes y, z del corte, alcanza el rectángulo
    const yz = (ir: number) => {
      const c = ind.cajasRestricciones;
      for (const [e, [lo, hi]] of [
        [3, cp.y],
        [6, cp.z],
      ] as const) {
        let a = -O[0]! * ejes[e]! - O[1]! * ejes[e + 1]! - O[2]! * ejes[e + 2]!;
        let b = a;
        for (let q = 0; q < 3; q++) {
          const [m, M] = [c[6 * ir + q]! * ejes[e + q]!, c[6 * ir + 3 + q]! * ejes[e + q]!];
          a += Math.min(m, M);
          b += Math.max(m, M);
        }
        if (b < lo - 2 * TOL_CORTE || a > hi + 2 * TOL_CORTE) return false;
      }
      return true;
    };
    for (const ir of conBarras ? ind.restricciones.buscar(caja.min, caja.max) : []) {
      if (!yz(ir)) continue;
      const rs = lista[ir]!;
      // Sus nudos del lado A, dentro y fuera del rectángulo, y los demás; se para en cuanto está
      // partida. Los esclavos se recorren alternando sus dos extremos: en un diafragma (numerado por
      // coordenadas) así aparecen pronto nudos de los dos lados
      let enA = false;
      let otros = false;
      let dentro = false;
      let fuera = false;
      const n = rs.esclavos.length;
      for (let a = -1; a < n && !(otros && dentro && fuera); a++) {
        const v = a < 0 ? rs.maestro : rs.esclavos[a % 2 ? n - 1 - (a >> 1) : a >> 1]!;
        if (lado(v) !== -1) otros = true;
        else {
          enA = true;
          if (cp.dentroNudo(v)) dentro = true;
          else fuera = true;
        }
      }
      if (!enA || !otros || !dentro) continue;
      if (!fuera) {
        incluidas.push(ir);
        continue;
      }
      // Partida por el borde del rectángulo: no se puede atribuir al corte
      const afectadas = this.componentesDe(rs.tipo, cp, [X(rs.maestro)[2]!]);
      afectadas.forEach((a, c) => {
        if (a) nan[c] = 1;
      });
      diag.aviso(
        "corte/restriccion-partida",
        `La restricción ${rs.id} (${rs.tipo}) atraviesa el corte ${id} pero tiene nudos del lado A fuera de él: lo que transmite no se puede atribuir al corte, así que ${COMPONENTES.filter((_, c) => afectadas[c]).join(", ")} quedan sin valor (NaN).` +
          (rs.tipo === "diafragma" ? " Con diafragma rígido, la losa no tiene esfuerzos de membrana: lo transmite el diafragma." : ""),
        [id, rs.id],
        { componentes: COMPONENTES.filter((_, c) => afectadas[c]) },
      );
    }
    if (incluidas.length) {
      info.restricciones.push(...incluidas);
      this.guardado(casos).restricciones(incluidas).forEach((fr, k) => {
        for (const ir of incluidas) {
          const rs = lista[ir]!;
          const f = fr.get(ir)!;
          [rs.maestro, ...rs.esclavos].forEach((v, a) => {
            if (lado(v) !== -1) return;
            suma.agregar(k, X(v), f.subarray(6 * a, 6 * a + 3), f.subarray(6 * a + 3, 6 * a + 6));
            if (k === 0) extender(X(v));
          });
        }
      });
    }

    if (diag.hayErrores) return vacio(ejes);
    if (info.laminas.length + info.barras.length + info.restricciones.length === 0) {
      diag.aviso("corte/vacio", `El corte ${id} no atraviesa ningún elemento: sus esfuerzos son nulos.`, [id]);
    }
    // A los ejes del corte, con el convenio de las barras: My = −m_y, Mz = m_z
    const aEjes = (v: Float64Array, nan?: Uint8Array) => {
      const esfuerzos = new Float64Array(6 * nc);
      for (let k = 0; k < nc; k++) {
        const o = 6 * k;
        const F = v.subarray(o, o + 3);
        const M = v.subarray(o + 3, o + 6);
        const pr = (w: ArrayLike<number>, e: number) => w[0]! * ejes[3 * e]! + w[1]! * ejes[3 * e + 1]! + w[2]! * ejes[3 * e + 2]!;
        esfuerzos[o] = pr(F, 0);
        esfuerzos[o + 1] = pr(F, 1);
        esfuerzos[o + 2] = pr(F, 2);
        esfuerzos[o + 3] = pr(M, 0);
        esfuerzos[o + 4] = -pr(M, 1);
        esfuerzos[o + 5] = pr(M, 2);
        if (nan) for (let c = 0; c < 6; c++) if (nan[c]) esfuerzos[o + c] = NaN;
      }
      return esfuerzos;
    };
    const esfuerzos = aEjes(suma.v, nan);
    info.extension = Number.isFinite(ext.y[0]) ? ext : null;
    const r: ResultadoCorte = { ...info, esfuerzos, ejes, diagnosticos: diag.lista, valido: true, muestras };
    if (corte.porLamina && !mixto) r.porLamina = porLamina.map((p) => ({ lamina: p.lamina, y: p.y, esfuerzos: aEjes(p.suma) }));
    return r;
  }

  private enlaceDe: Int32Array | null = null;

  /** ¿Están los nudos (los de una lámina) en un mismo enlace rígido? */
  private laminaRigida(): (nudos: readonly number[]) => boolean {
    if (!this.enlaceDe) {
      const e = new Int32Array(this.modelo.nudos.length).fill(-1);
      (this.modelo.restricciones ?? []).forEach((r, i) => {
        if (r.tipo !== "enlace-rigido") return;
        for (const v of [r.maestro, ...r.esclavos]) e[v] = i;
      });
      this.enlaceDe = e;
    }
    const e = this.enlaceDe;
    return (nudos) => {
      const k = e[nudos[0]!]!;
      return k >= 0 && nudos.every((v) => e[v] === k);
    };
  }

  /** Distancia con signo de un punto al plano del corte. */
  private distancia(cp: CortePreparado, p: ArrayLike<number>): number {
    // La x de `coordenadas`, con las mismas cuentas y sin crear el array (se pide para cada barra
    // con offsets del modelo en cada corte)
    const O = cp.origen;
    const e = cp.ejes;
    return (p[0]! - O[0]!) * e[0]! + (p[1]! - O[1]!) * e[1]! + (p[2]! - O[2]!) * e[2]!;
  }

  private diagramasBarras(): DiagramasBarras {
    return (this.diagramas ??= new DiagramasBarras(this.modelo));
  }

  /**
   * Componentes del corte [N, Vy, Vz, T, My, Mz] a las que contribuye una restricción: todas en un
   * enlace rígido; en un diafragma (fuerzas horizontales y momento según Z en su plano, a la cota
   * zd), las fuerzas con componente horizontal, los momentos con componente según Z y, si el origen
   * no está a la cota del diafragma, también los de componente horizontal.
   */
  private componentesDe(tipo: "diafragma" | "enlace-rigido", cp: CortePreparado, cotas: number[]): boolean[] {
    if (tipo === "enlace-rigido") return [true, true, true, true, true, true];
    const e = cp.ejes;
    const h = Math.abs(cotas[0]! - cp.origen[2]!) > TOL_CORTE;
    const r: boolean[] = [];
    for (let c = 0; c < 3; c++) r.push(Math.hypot(e[3 * c]!, e[3 * c + 1]!) > 1e-9);
    for (let c = 0; c < 3; c++) r.push(Math.abs(e[3 * c + 2]!) > 1e-9 || (h && Math.hypot(e[3 * c]!, e[3 * c + 1]!) > 1e-9));
    return r;
  }
}
