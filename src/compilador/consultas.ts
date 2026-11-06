/**
 * Consultas por objeto físico (C5.4, H35, H36, A1): lo que piden los módulos de comprobación de
 * Concreta y la capa de agente, sacado del cálculo por el mapeo y nunca por proximidad (§8.1).
 *
 * Convenios: los del motor y de C1–C5, sin cambiar ningún signo. Los cambios hacia cada módulo (el
 * axil de compresión positivo de rcColumns, los |M| de las vigas…) son de sus extractores, en un
 * solo sitio (H02, H35).
 * - Unidades kN y m (D1); giros en rad.
 * - Esfuerzos [N, Vy, Vz, T, My, Mz] en los ejes locales de la pieza (cabecera de `fisico.ts`), con
 *   el convenio de las barras: N > 0 es tracción; en una viga, My > 0 tracciona la cara inferior
 *   (momento de vano) y Vz es el cortante vertical; en un pilar, My es el momento que flecta en el
 *   plano de su canto h (el de la armadura de las caras de ancho b) y Mz, en el del ancho b.
 * - Desplazamientos y reacciones en ejes globales; los momentos de una resultante, respecto a su
 *   punto.
 *
 * Qué es lineal y qué no:
 * - Los esfuerzos en un punto fijo (cabeza y base de un pilar, una estación de banda, un machón,
 *   una reacción, el maestro de una planta) son lineales en los casos: se dan por caso base (n
 *   valores por caso, seguidos) y una combinación es `Consultas.combinar(v, n, factores)`.
 * - Los máximos sobre una región (el vano de una viga, la flecha de una losa, el desplome de una
 *   planta) no lo son: el máximo de una combinación no es la combinación de los máximos. Esas
 *   consultas reciben los factores de una combinación (o de un caso, `factoresCaso`) y la buscan en
 *   ella, de forma exacta en las barras (diagramas combinados) y nudo a nudo en las losas.
 *
 * Una consulta a un objeto que no existe, o con factores que no casan con los casos, no lanza: da su
 * diagnóstico con el id (`Respuesta`).
 *
 * Casos base y casos lógicos (VS3, `src/motor/espectral.ts`): `casos` son los casos base, los
 * resultados lineales que hay; sin sismo, los del modelo. Con el sismo del programa (`acciones.sismo`
 * con `ab`), detrás van los modos de vibración, uno por caso base, y los casos del modelo físico
 * (`fisico.casos`, los **lógicos**: los que llevan factor en una combinación) acaban en `EX+e`,
 * `EX-e`, `EY+e` y `EY-e`, que no son casos base: su valor en cada variable es la combinación de los
 * de los modos. Los factores de todas las consultas son los de los casos lógicos, y **nadie los
 * aplica a mano**: `combinar`, `sup` (la `Superposicion`) o `diagramaBarra`. Los desplazamientos de
 * los casos del sismo van multiplicados por μ.
 */
import { generarCombinaciones, type CasoCarga, type Combinacion, type OpcionesCombinaciones } from "../combinaciones/generador.ts";
import { psiDe } from "../combinaciones/psi.ts";
import { DiagramaBarra } from "../elementos/cargasBarra.ts";
import { CamposLaminas } from "../motor/campos.ts";
import { Cortes } from "../motor/cortes.ts";
import { DiagramaCompuesto, EspectralBarra, type DiagramaLeible } from "../motor/diagramaCompuesto.ts";
import { Diagnosticos, type Diagnostico } from "../motor/diagnosticos.ts";
import { modeloConModos, Superposicion, type CasoEspectral, type PartesCombinacion } from "../motor/espectral.ts";
import type { ModeloAnalitico, ModoVibracion, ResultadoCaso, ResultadoModal, Vec3 } from "../motor/modelo.ts";
import { alineacionesLosa, semiextension } from "./bandas.ts";
import { EsfuerzosBandas, type EstacionResultado, type LineaReparto } from "./esfuerzosBandas.ts";
import { EsfuerzosFranjas, type EnvolventeEstacionFranja, type ResultadoFranja } from "./esfuerzosFranjas.ts";
import { EsfuerzosMuros, type Dintel, type Machon } from "./esfuerzosMuros.ts";
import type { Franja } from "./franjas.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion, type Pilar, type Seccion, type Vec2 } from "./fisico.ts";
import { huellaPilar } from "./geometria2d.ts";
import type { Mapeo } from "./mapeo.ts";
import { diafragmaDe } from "./piezas.ts";
import { EsfuerzosPiezas } from "./resultados.ts";
import { calcularSismo, sismoDelCalculo, type EspectroSismo, type SismoCalculado } from "./sismo.ts";
import { validar, type Contexto, type LosaCompilada } from "./validar.ts";
import { dimensionesPlanta, resolverViento } from "./viento.ts";
import { DESPLAZAMIENTO_SIN_SEGUNDO_ORDEN, LIMITE_SEGUNDO_ORDEN, periodoFundamental, simplificado } from "../normas/ncse02.ts";

export type Respuesta<T> = { valido: true; valor: T; diagnosticos: Diagnostico[] } | { valido: false; diagnosticos: Diagnostico[] };

/** Barras de las que se guarda lo que no depende de la combinación en los diagramas con sismo (`Consultas.diagramaBarra`). */
const BARRAS_RECIENTES = 256;

/** Seno mínimo del ángulo entre una pieza y un muro o una viga para que sea su apoyo (≈ 5,7°): más paralelos, la pieza corre por ellos. */
export const SENO_MINIMO_APOYO = 0.1;

/** Esfuerzos de una sección de una pieza: su estación y [N, Vy, Vz, T, My, Mz] por caso (6·nc) o de una combinación (6). */
export interface SeccionPieza {
  s: number;
  esfuerzos: Float64Array;
}

export interface TramoPilar {
  /** Planta de su cabeza y de su base. */
  planta: string;
  plantaBase: string;
  /** De cota a cota, m. La longitud de pandeo la decide el módulo. */
  longitud: number;
  seccion: string;
  /** Giro del canto h en planta, grados desde +X (los ejes de los esfuerzos). */
  giro: number;
  /** En los extremos de su tramo flexible: la base (justo encima de su zona rígida) y la cabeza (justo debajo). */
  base: SeccionPieza;
  cabeza: SeccionPieza;
}

export interface ApoyoPieza {
  /** Objeto físico que apoya la pieza en ese nudo. */
  objeto: string;
  tipo: "pilar" | "muro" | "apoyo" | "viga" | "losa";
  /** Estación del nudo (el eje del apoyo) a lo largo de la pieza. */
  s: number;
  /** Estaciones de sus caras: s ∓ media anchura del apoyo a lo largo de la pieza. */
  caras: [number, number];
}

export interface VanoPieza {
  /** Estaciones de sus extremos: las caras de sus apoyos, o el extremo libre de un voladizo. */
  desde: number;
  hasta: number;
  apoyoInicio: ApoyoPieza | null;
  apoyoFin: ApoyoPieza | null;
  /** Tiene algún tramo con torsión de equilibrio (C4-k): su torsión hay que dimensionarla. */
  torsionEquilibrio: boolean;
}

export interface PiezaVanos {
  tipo: "viga" | "vigueta";
  apoyos: ApoyoPieza[];
  vanos: VanoPieza[];
  /**
   * El axil no tiene valor (C1-d): la viga está en el plano de un diafragma rígido, que impide su
   * alargamiento; el axil de atado lo lleva el diafragma, y el de la barra sale nulo.
   */
  axilSinValor: boolean;
}

export interface ExtremoDiagrama {
  s: number;
  valor: number;
}

/** Esfuerzos de un vano en una combinación (o un caso). */
export interface EsfuerzosVano {
  /** [N, Vy, Vz, T, My, Mz] en sus extremos (las caras o, si caen en una zona rígida, el extremo del tramo flexible). */
  inicio: SeccionPieza;
  fin: SeccionPieza;
  /** Máximo y mínimo de My (exactos: los extremos del diagrama combinado) y de Vz dentro del vano. */
  maxMy: ExtremoDiagrama;
  minMy: ExtremoDiagrama;
  maxVz: ExtremoDiagrama;
  minVz: ExtremoDiagrama;
}

export interface Resultante {
  /** Punto de reducción (global) y nudos que suma. */
  punto: Vec3;
  nudos: number;
  /** [Fx, Fy, Fz, Mx, My, Mz] globales por caso (6·nc), con los momentos respecto a `punto`. */
  resultante: Float64Array;
}

export interface PlantaConsulta {
  cota: number;
  /** Maestro del diafragma rígido: su punto y [ux, uy, rz] por caso (3·nc); null sin diafragma rígido. */
  maestro: { punto: Vec3; u: Float64Array } | null;
}

/** Masa de una planta con diafragma rígido en el análisis modal (VS2). */
export interface PlantaModal {
  planta: string;
  cota: number;
  /** Masa, t; centro de masas, m; inercia de giro respecto a él, t·m². */
  masa: number;
  cm: [number, number];
  J: number;
  /** De la masa, la de los nudos que no son del diafragma y le llegan por su cota, t. */
  repartida: number;
}

/** El análisis modal por plantas: `forma` y `fuerzas` de cada modo van de 3 en 3, en el orden de `plantas`. */
export interface ModosConsulta {
  g: number;
  masas: ResultadoModal["masas"];
  cm: [number, number];
  plantas: PlantaModal[];
  modos: readonly ModoVibracion[];
}

/** Un nivel (las plantas de una cota) en el sismo de una dirección (VS3). */
export interface NivelSismo {
  /** Plantas con diafragma rígido en esa cota. */
  plantas: string[];
  cota: number;
  /** Masa, t. */
  masa: number;
  /** Cortante combinado bajo el nivel y fuerza equivalente (la diferencia de los cortantes combinados), kN. */
  cortante: number;
  fuerza: number;
  /** Excentricidad accidental, m, y par de su torsor, kN·m (sumados los de sus plantas). */
  excentricidad: number;
  par: number;
  /** Desplazamiento combinado del nivel y deriva respecto al de debajo, m, ya por μ. */
  desplazamiento: number;
  deriva: number;
  /** Altura hasta el nivel de debajo (el más bajo, hasta la planta más baja), m. */
  altura: number;
  /** Art. 3.8: θ = P·d/(V·h), con P el peso sísmico del nivel y de los de encima. */
  theta: number;
}

/** El sismo en una dirección (VS3). */
export interface DireccionSismo {
  eje: "X" | "Y";
  /** μ y β = ν/μ de la dirección. */
  mu: number;
  beta: number;
  /** Se ha tomado α = 2,5 por encima de TB (C > 1,8 con el periodo fundamental mayor que TB, art. 2.4). */
  mesetaLarga: boolean;
  /** El modo de más masa efectiva en la dirección (el que da el signo): su número (1, el de mayor periodo), su periodo y su fracción de masa. */
  dominante: { modo: number; periodo: number; masaEfectiva: number };
  /** Cortante combinado en la base, kN; peso sísmico (la masa de los diafragmas por g), kN; y su cociente. */
  basal: number;
  peso: number;
  coeficiente: number;
  /** Por modo: periodo (s), αᵢ del art. 3.6.2.2, aceleración (m/s²), fracción de masa en la dirección y cortante en la base (kN, con signo). */
  modos: { periodo: number; alfa: number; aceleracion: number; masaEfectiva: number; basal: number }[];
  /** De arriba abajo. */
  niveles: NivelSismo[];
  /** El mayor desplazamiento combinado (por μ), m, y la mayor θ. */
  desplazamientoMaximo: number;
  thetaMaxima: number;
  /**
   * El cortante en la base del método simplificado (art. 3.7), sólo para contrastar (VS-j): con el
   * periodo del modo dominante y, si el sistema estructural tiene expresión que se pueda evaluar, con
   * el periodo fundamental aproximado del art. 3.7.2.2.
   */
  simplificado: { origen: "modal" | "formula"; TF: number; modos: number; basal: number }[];
}

/** El sismo del programa (VS3): el espectro, la respuesta en X y en Y y sus casos. */
export interface SismoConsulta {
  espectro: EspectroSismo;
  g: number;
  /** Los casos del sismo, al final de los casos del modelo. */
  casos: string[];
  direcciones: [DireccionSismo, DireccionSismo];
}

export interface Desplome {
  pilar: string;
  /** Desplazamiento horizontal de su nudo en la planta respecto al de la planta de abajo (m). */
  dx: number;
  dy: number;
  d: number;
  /** d / altura de la planta. */
  relativo: number;
}

export interface Desplomes {
  /** Altura entre la planta y la de abajo, m. */
  altura: number;
  pilares: Desplome[];
  /** El mayor desplome relativo (null si no hay pilares entre las dos plantas). */
  maximo: Desplome | null;
}

export interface FlechaPunto {
  nudo: number;
  punto: Vec3;
  /** Flecha hacia abajo, m (positiva hacia abajo). */
  flecha: number;
}

export interface Recuadro {
  /** Pilares de sus esquinas: (i, j), (i, j+1), (i+1, j), (i+1, j+1) de las alineaciones. */
  pilares: [string, string, string, string];
  /** La mayor flecha relativa a sus esquinas (la uz de la losa menos la interpolación bilineal de las de sus pilares), positiva hacia abajo. */
  maxima: FlechaPunto | null;
}

export interface Flechas {
  /** La mayor flecha absoluta de la losa (uz más negativa), positiva hacia abajo. */
  maxima: FlechaPunto;
  /** Recuadros entre cuatro pilares de dos alineaciones consecutivas de cada dirección (las de las bandas, C5-b). */
  recuadros: Recuadro[];
}

/** Lo de las flechas de una losa que no depende de la combinación (`geometriaFlechas`). */
interface GeometriaFlechas {
  nudos: number[];
  recuadros: { pilares: [string, string, string, string]; esquinas: number[]; nudos: number[]; xi: number[]; eta: number[] }[];
}

const ANCHO_POR_FORMA = (s: Seccion): number => (s.forma === "rectangular" ? s.b : s.forma === "T" ? s.bw : s.forma === "circular" ? s.D : s.forma === "general" ? (s.b ?? 0) : 0);

/** Sección del tramo de pilar cuya cabeza está en la planta, o la del pilar. */
const seccionPilarEn = (p: Pilar, planta: string): string => p.tramos?.find((t) => t.planta === planta)?.seccion ?? p.seccion;

export class Consultas {
  /** El modelo físico, con los casos del programa: `fisico.casos` son los casos lógicos (cabecera). */
  readonly fisico: ModeloFisico;
  /** El modelo analítico; con el sismo del programa, con un caso por modo detrás de los suyos. */
  readonly modelo: ModeloAnalitico;
  /** El modelo analítico tal como se compiló (sin los casos de los modos): con él se sabe si otra compilación es la de estas consultas. */
  readonly compilado: ModeloAnalitico;
  readonly mapeo: Mapeo;
  /** Los casos base: los resultados del cálculo y, con el sismo del programa, los de cada modo. */
  readonly casos: readonly ResultadoCaso[];
  /** VS2: el análisis modal del cálculo (sólo con `acciones.sismo` en el proyecto). */
  readonly modal: ResultadoModal | null;
  /** VS3: de los factores de los casos lógicos a los valores de los casos base. */
  readonly sup: Superposicion;
  /** VS3: el sismo del programa (espectro, respuesta en X y en Y); null sin `ab` o sin modos. */
  readonly sismoCalculado: SismoCalculado | null;
  private readonly ctx: Contexto;
  private readonly opciones: OpcionesCompilacion;
  private piezasC?: EsfuerzosPiezas;
  private bandasC?: EsfuerzosBandas;
  private franjasC?: EsfuerzosFranjas;
  private camposC?: CamposLaminas;
  private cortesC?: Cortes;
  private murosC?: EsfuerzosMuros;
  private readonly flechasGeo = new Map<string, GeometriaFlechas>();
  /** VS3: de las últimas barras con diagramas de combinaciones con sismo, lo que no depende de la combinación (`diagramaBarra`). */
  private readonly combinacionesVistas = new WeakMap<object, { copia: Float64Array; partes: PartesCombinacion; clave: string }>();
  private readonly barrasSismo = new Map<number, { extremos: Map<Int32Array, Float64Array>; espectrales: Map<CasoEspectral, EspectralBarra>; estaticos: Map<string, DiagramaBarra> }>();
  private readonly apoyoEnNudo = new Map<number, string>();
  private readonly coartado = new Set<number>();
  private readonly nudoPorId = new Map<string, number>();

  /**
   * @param fisico el modelo físico que se compiló (con sus bandas) y `opciones`, las de la compilación.
   * @param compilado su modelo analítico y su mapeo; `casos`, los resultados de un cálculo válido;
   * `modal`, su análisis modal, si lo tiene.
   */
  constructor(fisico: ModeloFisico, compilado: { modelo: ModeloAnalitico; mapeo: Mapeo }, casos: readonly ResultadoCaso[], opciones: OpcionesCompilacion = {}, modal?: ResultadoModal | null) {
    // VS1: con los casos y las cargas del viento del programa, al final, como en la compilación: los
    // casos del modelo físico casan uno a uno con los resultados
    fisico = resolverViento(fisico).modelo;
    this.mapeo = compilado.mapeo;
    this.compilado = compilado.modelo;
    this.modal = modal ?? null;
    this.opciones = opciones;
    const diag = new Diagnosticos();
    const ctx = validar(fisico, resolverOpciones(opciones), diag);
    if (!ctx || diag.hayErrores) throw new Error("Consultas: el modelo físico no es válido (tiene que ser el que se compiló)");
    if (casos.length !== compilado.modelo.casos.length) throw new Error(`Consultas: ${casos.length} resultados para ${compilado.modelo.casos.length} casos`);
    this.ctx = ctx;
    // VS3: con el espectro y los modos, los modos son casos base y los casos del sismo, lógicos
    const md = this.modal;
    const sismo = md
      ? sismoDelCalculo(
          calcularSismo(fisico)?.espectro ?? null,
          md,
          casos.length,
          (k) => compilado.mapeo.restricciones[md.diafragmas[k]!.restriccion]!.planta,
          (planta) => dimensionesPlanta(fisico, ctx.planta.get(planta)!),
        )
      : null;
    this.sismoCalculado = sismo;
    if (sismo && sismo.logicos.length) {
      this.modelo = modeloConModos(compilado.modelo, sismo.casosBase);
      this.casos = [...casos, ...sismo.resultadosBase];
      this.fisico = { ...fisico, casos: [...fisico.casos, ...sismo.casos] };
      this.sup = new Superposicion(this.casos.length, [...fisico.casos.map((c, base) => ({ id: c.id, base })), ...sismo.logicos]);
    } else {
      this.modelo = compilado.modelo;
      this.casos = casos;
      this.fisico = fisico;
      this.sup = Superposicion.directa(fisico.casos.map((c) => c.id));
    }
    for (const [id, n] of Object.entries(this.mapeo.apoyos)) this.apoyoEnNudo.set(n, id);
    for (const a of this.modelo.apoyos ?? []) this.coartado.add(a.nudo);
    this.modelo.nudos.forEach((n, i) => this.nudoPorId.set(n.id, i));
  }

  /** Número de casos base: los de `casos` (lo que mide un vector «por caso» de una consulta). */
  get nb(): number {
    return this.casos.length;
  }

  /** Número de casos lógicos: los de `fisico.casos`, los que llevan factor. */
  get nl(): number {
    return this.sup.nl;
  }

  /**
   * La combinación de un vector por caso base (n valores por caso, seguidos) con los factores de los
   * casos lógicos. `desplazamiento`: son desplazamientos o giros (los del sismo van por μ).
   */
  combinar(porBase: ArrayLike<number>, n: number, factores: ArrayLike<number>, desplazamiento = false): Float64Array {
    return this.sup.combinar(porBase, n, factores, desplazamiento);
  }

  private piezas(): EsfuerzosPiezas {
    // VS3: los casos de los modos (detrás de los del modelo) son ligeros: sin cargas en las barras
    return (this.piezasC ??= new EsfuerzosPiezas(this.modelo, this.mapeo, this.casos, { ligeros: this.compilado.casos.length }));
  }

  /**
   * Los esfuerzos de las piezas de este cálculo (con los pares de la losa repartidos), los mismos
   * para todo lo que los lea: cada uno guarda sus diagramas, y rehacerlos en cada consumidor (render,
   * sensatez, envolventes…) costaba en el edificio objetivo ~1 s por consumidor.
   */
  get esfuerzosPiezas(): EsfuerzosPiezas {
    return this.piezas();
  }

  private no<T>(codigo: string, mensaje: string, ids: string[]): Respuesta<T> {
    const d = new Diagnosticos();
    d.error(codigo, mensaje, ids);
    return { valido: false, diagnosticos: d.lista };
  }

  private noExiste<T>(que: string, id: string): Respuesta<T> {
    return this.no("consulta/no-existe", `${que} «${id}» no existe en el modelo.`, [id]);
  }

  /** null si los factores valen (uno finito por caso lógico); si no, la respuesta de error. */
  private factoresMal<T>(f: ArrayLike<number>, id: string): Respuesta<T> | null {
    if (this.sup.defecto(f) === null) return null;
    return this.no("consulta/factores", `Los factores de la combinación tienen que ser ${this.nl} números finitos, uno por caso (${this.fisico.casos.map((c) => c.id).join(", ")}).`, [id]);
  }

  // ─── Pilares ────────────────────────────────────────────────────────────────────────────────

  /** Tramos del pilar (de la base a la cabeza), con sus esfuerzos por caso base en base y cabeza. */
  pilar(id: string): Respuesta<TramoPilar[]> {
    const p = this.ctx.pilarDe.get(id);
    if (!p) return this.noExiste("El pilar", id);
    const ep = this.piezas();
    const nc = this.nb;
    const grupos = new Map<number, ReturnType<EsfuerzosPiezas["tramos"]>>();
    for (const t of ep.tramos(id)) grupos.set(t.tramo, [...(grupos.get(t.tramo) ?? []), t]);
    const r: TramoPilar[] = [];
    for (const [k, ts] of grupos) {
      const [a, b] = [ts[0]!, ts[ts.length - 1]!];
      const base = new Float64Array(6 * nc);
      const cabeza = new Float64Array(6 * nc);
      for (let c = 0; c < nc; c++) {
        // (en un caso de un modo, de sus resultados, sin hacer el diagrama: `EsfuerzosPiezas.extremos`)
        if (c >= ep.ligeros) {
          base.set(ep.extremos(a.barra, c).subarray(0, 6), 6 * c);
          cabeza.set(ep.extremos(b.barra, c).subarray(6, 12), 6 * c);
          continue;
        }
        base.set(ep.diagrama(a.barra, c).esfuerzosEn(0, 1), 6 * c);
        cabeza.set(ep.diagrama(b.barra, c).esfuerzosEn(b.s1 - b.s0, -1), 6 * c);
      }
      const planta = this.ctx.plantas[k]!.id;
      r.push({
        planta,
        plantaBase: this.ctx.plantas[k + 1]!.id,
        longitud: this.ctx.cotas[k]! - this.ctx.cotas[k + 1]!,
        seccion: seccionPilarEn(p, planta),
        giro: p.giro ?? 0,
        base: { s: a.s0, esfuerzos: base },
        cabeza: { s: b.s1, esfuerzos: cabeza },
      });
    }
    return { valido: true, valor: r, diagnosticos: [] };
  }

  // ─── Vigas y viguetas ───────────────────────────────────────────────────────────────────────

  /** Dirección en planta de la barra b (de su nudo i a su nudo j). */
  private direccionBarra(b: number): Vec2 {
    const [i, j] = this.modelo.barras![b]!.nudos;
    const [A, B] = [this.modelo.nudos[i]!, this.modelo.nudos[j]!];
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    return [(B.x - A.x) / L, (B.y - A.y) / L];
  }

  /** Tramo de una polilínea en planta que pasa por P (a ≤ ε_snap), con su dirección. */
  private tramoPor(puntos: readonly Vec2[], P: Vec2): Vec2 | null {
    for (let i = 1; i < puntos.length; i++) {
      const [A, B] = [puntos[i - 1]!, puntos[i]!];
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const u: Vec2 = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
      const s = (P[0] - A[0]) * u[0] + (P[1] - A[1]) * u[1];
      const d = Math.abs((P[0] - A[0]) * u[1] - (P[1] - A[1]) * u[0]);
      if (d <= this.ctx.op.epsSnap && s >= -this.ctx.op.epsSnap && s <= L + this.ctx.op.epsSnap) return u;
    }
    return null;
  }

  /**
   * Apoyo de la pieza en el nudo n (u: su dirección allí), o null. Un pilar, un muro o un apoyo lo
   * son siempre; otra viga, sólo en un extremo de la pieza (la viga que acaba en otra se apoya en
   * ella; la que la cruza, no: lo decide su rigidez, y el vano sigue). En una vigueta, todo nudo
   * interior es un apoyo (va de apoyo a apoyo, C4) y una losa también lo es (su borde).
   */
  private apoyoEn(pieza: string, n: number, s: number, u: Vec2, extremo: boolean, vigueta: boolean): ApoyoPieza | null {
    const nd = this.modelo.nudos[n]!;
    const P: Vec2 = [nd.x, nd.y];
    const fis = this.mapeo.nudos[n]!.fisicos;
    const planta = this.mapeo.nudos[n]!.planta;
    const conCaras = (objeto: string, tipo: ApoyoPieza["tipo"], media: number): ApoyoPieza => ({ objeto, tipo, s, caras: [s - media, s + media] });
    const pilar = fis.map((f) => this.ctx.pilarDe.get(f)).find((p) => p !== undefined);
    if (pilar) {
      const forma = this.ctx.secciones.get(seccionPilarEn(pilar, planta))?.huella ?? null;
      return conCaras(pilar.id, "pilar", semiextension(huellaPilar(pilar.x, pilar.y, pilar.giro ?? 0, forma), u));
    }
    const seno = (w: Vec2) => Math.abs(u[0] * w[1] - u[1] * w[0]);
    for (const f of fis) {
      const m = this.ctx.muroDe.get(f);
      if (!m) continue;
      const w = this.tramoPor(m.muro.puntos, P);
      if (w && seno(w) >= SENO_MINIMO_APOYO) return conCaras(m.muro.id, "muro", m.material.t / 2 / seno(w));
    }
    const apoyo = this.apoyoEnNudo.get(n);
    if (apoyo) return conCaras(apoyo, "apoyo", 0);
    if (extremo || vigueta) {
      for (const f of fis) {
        const v = f !== pieza ? this.ctx.vigaDe.get(f) : undefined;
        if (!v) continue;
        const w = this.tramoPor(v.puntos, P);
        const sec = this.fisico.secciones.find((x) => x.id === v.seccion);
        if (w && seno(w) >= SENO_MINIMO_APOYO) return conCaras(v.id, "viga", (sec ? ANCHO_POR_FORMA(sec) : 0) / 2 / seno(w));
      }
    }
    if (vigueta) {
      const losa = fis.find((f) => this.ctx.losaDe.has(f));
      if (losa) return conCaras(losa, "losa", 0);
      if (!extremo) return conCaras(pieza, "apoyo", 0);
    }
    return null;
  }

  /** Apoyos y vanos de una viga o una vigueta (`<paño>:v<n>`). */
  viga(id: string): Respuesta<PiezaVanos> {
    const barras = this.mapeo.piezas[id];
    const tipo = barras?.length ? this.mapeo.barras[barras[0]!]!.tipo : undefined;
    if (!barras || (tipo !== "viga" && tipo !== "vigueta")) return this.noExiste("La viga", id);
    const vigueta = tipo === "vigueta";
    // Nudos a lo largo de la pieza, con la dirección de la barra de cada lado
    const nudos: { n: number; s: number; u: Vec2 }[] = [];
    barras.forEach((b, i) => {
      const [ni, nj] = this.modelo.barras![b]!.nudos;
      const s = this.mapeo.barras[b]!.s;
      const u = this.direccionBarra(b);
      if (i === 0) nudos.push({ n: ni, s: s[0], u });
      nudos.push({ n: nj, s: s[3], u });
    });
    const apoyos: ApoyoPieza[] = [];
    nudos.forEach((q, i) => {
      const a = this.apoyoEn(id, q.n, q.s, q.u, i === 0 || i === nudos.length - 1, vigueta);
      if (a) apoyos.push(a);
    });
    const [s0, s1] = [nudos[0]!.s, nudos[nudos.length - 1]!.s];
    const vanos: VanoPieza[] = [];
    const eq = (a: number, b: number) => barras.some((x) => this.mapeo.barras[x]!.torsionEquilibrio && this.mapeo.barras[x]!.s[2] > a && this.mapeo.barras[x]!.s[1] < b);
    const nuevo = (desde: number, hasta: number, ai: ApoyoPieza | null, af: ApoyoPieza | null) => {
      if (hasta - desde > this.ctx.op.epsGeom) vanos.push({ desde, hasta, apoyoInicio: ai, apoyoFin: af, torsionEquilibrio: eq(desde, hasta) });
    };
    if (!apoyos.length) nuevo(s0, s1, null, null);
    else {
      const [primero, ultimo] = [apoyos[0]!, apoyos[apoyos.length - 1]!];
      if (primero.s > s0 + this.ctx.op.epsGeom) nuevo(s0, primero.caras[0], null, primero);
      for (let i = 1; i < apoyos.length; i++) nuevo(apoyos[i - 1]!.caras[1], apoyos[i]!.caras[0], apoyos[i - 1]!, apoyos[i]!);
      if (ultimo.s < s1 - this.ctx.op.epsGeom) nuevo(ultimo.caras[1], s1, ultimo, null);
    }
    // C1-d: una viga (o una vigueta) en el plano de un diafragma rígido no tiene axil
    const enPlano = vigueta || this.ctx.vigaDe.get(id)?.insercion !== "superior";
    const planta = this.ctx.planta.get(this.mapeo.nudos[nudos[0]!.n]!.planta)!;
    const axilSinValor = enPlano && diafragmaDe(this.ctx, planta) === "rigido";
    return { valido: true, valor: { tipo, apoyos, vanos, axilSinValor }, diagnosticos: [] };
  }

  /**
   * Diagrama de la barra b en una combinación (los factores de los casos lógicos): la combinación de
   * los diagramas de sus casos y, si lleva algún caso del sismo, la de los modos en cada punto
   * (`DiagramaCompuesto`).
   */
  diagramaBarra(b: number, f: ArrayLike<number>): DiagramaBarra | DiagramaCompuesto {
    const ep = this.piezas();
    // La combinación partida, una vez por combinación y no por barra (quien recorre las barras pasa los
    // mismos vectores de factores): se reconoce por ser el mismo vector con los mismos números
    let u = typeof f === "object" ? this.combinacionesVistas.get(f) : undefined;
    if (!u || u.copia.length !== f.length || u.copia.some((v, k) => v !== f[k])) {
      const partes = this.sup.partes(f);
      u = { copia: Float64Array.from(f), partes, clave: partes.espectrales.length ? partes.lineal.join(",") : "" };
      if (typeof f === "object") this.combinacionesVistas.set(f, u);
    }
    const { lineal, espectrales } = u.partes;
    const estatico = (): DiagramaBarra => {
      const ks: number[] = [];
      for (let k = 0; k < lineal.length; k++) if (lineal[k]) ks.push(k);
      return ks.length
        ? DiagramaBarra.combinar(
            ks.map((k) => ep.diagrama(b, k)),
            ks.map((k) => lineal[k]!),
          )
        : DiagramaBarra.combinar([ep.diagrama(b, 0)], [0]);
    };
    if (!espectrales.length) return estatico();
    // Lo de la barra que no depende de la combinación: las de la situación sísmica (el ± y el 30 % de
    // cada caso del sismo, con y sin las variables) comparten los casos espectrales y su parte estática
    let cb = this.barrasSismo.get(b);
    if (cb) this.barrasSismo.delete(b);
    else cb = { extremos: new Map(), espectrales: new Map(), estaticos: new Map() };
    this.barrasSismo.set(b, cb);
    if (this.barrasSismo.size > BARRAS_RECIENTES) this.barrasSismo.delete(this.barrasSismo.keys().next().value!);
    const clave = u.clave;
    let D = cb.estaticos.get(clave);
    if (!D) cb.estaticos.set(clave, (D = estatico()));
    const guardada = cb;
    return new DiagramaCompuesto(
      D,
      espectrales.map(({ factor, caso }) => {
        let e = guardada.espectrales.get(caso);
        if (!e) {
          // Los esfuerzos de los modos en los extremos de la barra (los mismos para los casos que comparten
          // los modos): de sus resultados, sin hacer un diagrama por modo; los diagramas, sólo si se piden
          // los desplazamientos
          let ext = guardada.extremos.get(caso.modos);
          if (ext === undefined) {
            ext = new Float64Array(12 * caso.modos.length);
            caso.modos.forEach((k, i) => ep.extremos(b, k, ext!, 12 * i));
            guardada.extremos.set(caso.modos, ext);
          }
          guardada.espectrales.set(caso, (e = new EspectralBarra(caso, () => Array.from(caso.modos, (k) => ep.diagrama(b, k)), ext, D!.L)));
        }
        return { factor, espectral: e };
      }),
    );
  }

  private diagramaCombinado(b: number, f: ArrayLike<number>): DiagramaLeible {
    return this.diagramaBarra(b, f);
  }

  /** Esfuerzos de la pieza en s con su diagrama combinado; null si s cae fuera de sus tramos flexibles. */
  private seccion(id: string, f: ArrayLike<number>, s: number, lado: -1 | 1): SeccionPieza | null {
    const ts = this.piezas()
      .tramos(id)
      .filter((t) => s >= t.s0 - 1e-9 && s <= t.s1 + 1e-9);
    if (!ts.length) return null;
    const t = lado < 0 ? ts[0]! : ts[ts.length - 1]!;
    const x = Math.min(t.s1 - t.s0, Math.max(0, s - t.s0));
    return { s, esfuerzos: Float64Array.from(this.diagramaCombinado(t.barra, f).esfuerzosEn(x, lado)) };
  }

  /** Esfuerzos del vano i de la viga en una combinación (sus factores por caso, o `factoresCaso`). */
  vano(id: string, i: number, factores: ArrayLike<number>): Respuesta<EsfuerzosVano> {
    const r = this.viga(id);
    if (!r.valido) return r;
    const mal = this.factoresMal<EsfuerzosVano>(factores, id);
    if (mal) return mal;
    const v = r.valor.vanos[i];
    if (!v) return this.no("consulta/no-existe", `La viga ${id} no tiene vano ${i} (tiene ${r.valor.vanos.length}).`, [id]);
    const ts = this.piezas()
      .tramos(id)
      .filter((t) => t.s1 > v.desde + 1e-9 && t.s0 < v.hasta - 1e-9);
    if (!ts.length) return this.no("consulta/sin-tramo-flexible", `El vano ${i} de la viga ${id} cae entero en zonas rígidas.`, [id]);
    // Extremos: la cara, o el extremo del tramo flexible si la cara cae en una zona rígida
    const desde = Math.max(v.desde, ts[0]!.s0);
    const hasta = Math.min(v.hasta, ts[ts.length - 1]!.s1);
    const inicio = this.seccion(id, factores, desde, 1)!;
    const fin = this.seccion(id, factores, hasta, -1)!;
    const ext = { maxMy: { s: desde, valor: -Infinity }, minMy: { s: desde, valor: Infinity }, maxVz: { s: desde, valor: -Infinity }, minVz: { s: desde, valor: Infinity } };
    for (const t of ts) {
      const D = this.diagramaCombinado(t.barra, factores);
      const [a, b] = [Math.max(desde, t.s0) - t.s0, Math.min(hasta, t.s1) - t.s0];
      const xs = [a, b, ...D.estaciones().filter((x) => x > a && x < b)];
      for (const x of xs)
        for (const lado of [-1, 1] as const) {
          if ((x === a && lado < 0) || (x === b && lado > 0)) continue;
          const e = D.esfuerzosEn(x, lado);
          const s = t.s0 + x;
          if (e[4]! > ext.maxMy.valor) ext.maxMy = { s, valor: e[4]! };
          if (e[4]! < ext.minMy.valor) ext.minMy = { s, valor: e[4]! };
          if (e[2]! > ext.maxVz.valor) ext.maxVz = { s, valor: e[2]! };
          if (e[2]! < ext.minVz.valor) ext.minVz = { s, valor: e[2]! };
        }
    }
    return { valido: true, valor: { inicio, fin, ...ext }, diagnosticos: [] };
  }

  /**
   * Diagrama de la pieza (viga, vigueta o pilar) en una combinación: sus estaciones (las de cada
   * tramo flexible: extremos, cuartos, puntos de carga y extremos interiores de My y Mz, H36) con
   * [N, Vy, Vz, T, My, Mz] en cada una (por la izquierda y por la derecha en los saltos).
   */
  diagrama(id: string, factores: ArrayLike<number>): Respuesta<{ s: number; izquierda: Float64Array; derecha: Float64Array }[]> {
    if (!this.mapeo.piezas[id]?.length) return this.noExiste("La pieza", id);
    const mal = this.factoresMal<{ s: number; izquierda: Float64Array; derecha: Float64Array }[]>(factores, id);
    if (mal) return mal;
    const r: { s: number; izquierda: Float64Array; derecha: Float64Array }[] = [];
    for (const t of this.piezas().tramos(id)) {
      const D = this.diagramaCombinado(t.barra, factores);
      for (const x of D.estaciones()) r.push({ s: t.s0 + x, izquierda: Float64Array.from(D.esfuerzosEn(x, -1)), derecha: Float64Array.from(D.esfuerzosEn(x, 1)) });
    }
    return { valido: true, valor: r, diagnosticos: [] };
  }

  // ─── Bandas, machones y dinteles ────────────────────────────────────────────────────────────

  /** Los campos SPR del modelo (E5), los mismos para las bandas, los muros y los mapas de A4. */
  get campos(): CamposLaminas {
    return (this.camposC ??= new CamposLaminas(this.modelo));
  }

  /** Los cortes del modelo, con los diagramas de las barras de las piezas: los mismos para las bandas y los muros. */
  get cortes(): Cortes {
    return (this.cortesC ??= new Cortes(this.modelo, { diagramas: this.piezas().diagramas }));
  }

  /** Estaciones de una banda con sus esfuerzos por caso (C5.2). */
  banda(id: string): Respuesta<EstacionResultado[]> {
    this.bandasC ??= new EsfuerzosBandas(this.fisico, this.modelo, this.casos, { epsGeom: this.ctx.op.epsGeom, campos: this.campos, cortes: this.cortes, combinar: this.combinarBase });
    const r = this.bandasC.estaciones(id);
    return r ? { valido: true, valor: r, diagnosticos: r.flatMap((e) => e.diagnosticos) } : this.noExiste("La banda", id);
  }

  /**
   * Reparto entre bandas de pilares y centrales en las líneas de caras y de vanos de una losa, en
   * la dirección `direccion` y la combinación `factores` (C5-d): con un aviso donde sale de la tabla
   * I.1 del Anejo I.
   */
  reparto(losa: string, direccion: Vec2, factores: ArrayLike<number>): Respuesta<LineaReparto[]> {
    if (!this.ctx.losaDe.has(losa)) return this.noExiste("La losa", losa);
    const mal = this.factoresMal<LineaReparto[]>(factores, losa);
    if (mal) return mal;
    this.bandasC ??= new EsfuerzosBandas(this.fisico, this.modelo, this.casos, { epsGeom: this.ctx.op.epsGeom, campos: this.campos, cortes: this.cortes, combinar: this.combinarBase });
    const r = this.bandasC.reparto(losa, direccion, factores);
    return { valido: true, valor: r.lineas, diagnosticos: r.diagnosticos };
  }

  // ─── Franjas de armado (fase F) ─────────────────────────────────────────────────────────────

  /** `combinar`, para lo que combina por dentro (las bandas, las franjas). */
  readonly combinarBase = (porBase: ArrayLike<number>, n: number, factores: ArrayLike<number>): Float64Array => this.sup.combinar(porBase, n, factores);

  private esfuerzosFranjas(): EsfuerzosFranjas {
    return (this.franjasC ??= new EsfuerzosFranjas(this.ctx, { modelo: this.modelo, mapeo: this.mapeo }, this.casos, { campos: this.campos, cortes: this.cortes, combinar: this.combinarBase }));
  }

  /** Las franjas de armado de una losa maciza o reticular, o de todas (fase F). */
  franjas(losa?: string): Respuesta<Franja[]> {
    if (losa !== undefined && !this.ctx.losaDe.has(losa)) return this.noExiste("La losa", losa);
    return { valido: true, valor: this.esfuerzosFranjas().franjas(losa), diagnosticos: [] };
  }

  /** Estaciones de una franja con sus momentos medios por caso (fase F). */
  franja(id: string): Respuesta<ResultadoFranja> {
    const r = this.esfuerzosFranjas().estaciones(id);
    return r ? { valido: true, valor: r, diagnosticos: [...r.diagnosticos, ...r.estaciones.flatMap((e) => e.diagnosticos)] } : this.noExiste("La franja", id);
  }

  /**
   * Wood–Armer de una franja en las combinaciones dadas (factores por caso), por combinación y con
   * los momentos medios: en cada estación, la mayor demanda inferior y superior de su dirección y el
   * mx máximo y mínimo, con la combinación (su índice) que los da.
   */
  armadoFranja(id: string, combinaciones: readonly ArrayLike<number>[]): Respuesta<EnvolventeEstacionFranja[]> {
    for (const f of combinaciones) {
      const mal = this.factoresMal<EnvolventeEstacionFranja[]>(f, id);
      if (mal) return mal;
    }
    const r = this.esfuerzosFranjas().envolvente(id, combinaciones);
    return r ? { valido: true, valor: r, diagnosticos: [] } : this.noExiste("La franja", id);
  }

  private muros(): EsfuerzosMuros {
    return (this.murosC ??= new EsfuerzosMuros(this.fisico, { modelo: this.modelo, mapeo: this.mapeo }, this.casos, { ...this.opciones, campos: this.campos, cortes: this.cortes }));
  }

  /** Machones del muro (C5.3). */
  machones(muro: string): Respuesta<Machon[]> {
    const r = this.muros().machones(muro);
    return r ? { valido: true, valor: r, diagnosticos: [] } : this.noExiste("El muro", muro);
  }

  /** Dinteles del muro (C5.3). */
  dinteles(muro: string): Respuesta<Dintel[]> {
    const r = this.muros().dinteles(muro);
    return r ? { valido: true, valor: r, diagnosticos: [] } : this.noExiste("El muro", muro);
  }

  // ─── Reacciones ─────────────────────────────────────────────────────────────────────────────

  /** Nudos coartados de un objeto físico que da reacciones: apoyo, pilar (su base), muro (su base) o apoyo lineal. */
  private nudosReaccion(id: string): number[] | null | "sin-base" {
    if (id in this.mapeo.apoyos) return [this.mapeo.apoyos[id]!];
    const p = this.ctx.pilarDe.get(id);
    if (p) {
      if (p.base === "ninguno") return "sin-base";
      const n = this.mapeo.nudosPilar[`${id}@${p.desde}`];
      return n === undefined ? [] : [n];
    }
    const m = this.ctx.muroDe.get(id);
    if (m) {
      if (m.muro.base === "ninguno") return "sin-base";
      const z = this.ctx.cotas[m.kb]!;
      const nudos = new Set<number>();
      for (const l of this.mapeo.muros?.[id] ?? []) for (const n of this.modelo.laminas![l]!.nudos) if (Math.abs(this.modelo.nudos[n]!.z - z) <= 1e-9 && this.coartado.has(n)) nudos.add(n);
      return [...nudos].sort((a, b) => a - b);
    }
    const al = this.ctx.apoyosLineales.find((a) => a.id === id);
    if (al) {
      const z = this.ctx.cotas[this.ctx.planta.get(al.planta)!]!;
      const r: number[] = [];
      for (const n of this.coartado) {
        const nd = this.modelo.nudos[n]!;
        if (Math.abs(nd.z - z) <= 1e-9 && this.tramoPor(al.puntos, [nd.x, nd.y])) r.push(n);
      }
      // Fase LV: los del eje de las vigas a las que llega por su ancho o su cara
      for (const n of this.mapeo.apoyosEnVigas?.[id] ?? []) if (!r.includes(n)) r.push(n);
      return r.sort((a, b) => a - b);
    }
    return null;
  }

  /**
   * Resultante de las reacciones de un apoyo, un pilar (su base), un muro (su base) o un apoyo
   * lineal, por caso, respecto al centro de sus nudos coartados.
   */
  reacciones(id: string): Respuesta<Resultante> {
    const nudos = this.nudosReaccion(id);
    if (nudos === null) return this.noExiste("El objeto con reacciones", id);
    if (nudos === "sin-base") return this.no("consulta/sin-reaccion", `${id} nace sobre otra pieza (base "ninguno"): no tiene reacciones.`, [id]);
    const c = [0, 0, 0];
    for (const n of nudos) {
      const nd = this.modelo.nudos[n]!;
      c[0]! += nd.x / nudos.length;
      c[1]! += nd.y / nudos.length;
      c[2]! += nd.z / nudos.length;
    }
    const punto: Vec3 = [c[0]!, c[1]!, c[2]!];
    const nc = this.nb;
    const R = new Float64Array(6 * nc);
    for (let k = 0; k < nc; k++) {
      const rk = this.casos[k]!.reacciones;
      for (const n of nudos) {
        const nd = this.modelo.nudos[n]!;
        const r = [nd.x - punto[0], nd.y - punto[1], nd.z - punto[2]];
        const F = [rk[6 * n]!, rk[6 * n + 1]!, rk[6 * n + 2]!];
        R[6 * k] += F[0]!;
        R[6 * k + 1] += F[1]!;
        R[6 * k + 2] += F[2]!;
        R[6 * k + 3] += rk[6 * n + 3]! + r[1]! * F[2]! - r[2]! * F[1]!;
        R[6 * k + 4] += rk[6 * n + 4]! + r[2]! * F[0]! - r[0]! * F[2]!;
        R[6 * k + 5] += rk[6 * n + 5]! + r[0]! * F[1]! - r[1]! * F[0]!;
      }
    }
    return { valido: true, valor: { punto, nudos: nudos.length, resultante: R }, diagnosticos: [] };
  }

  // ─── Plantas ────────────────────────────────────────────────────────────────────────────────

  /** Cota y desplazamiento del maestro del diafragma rígido de la planta, por caso. */
  planta(id: string): Respuesta<PlantaConsulta> {
    const k = this.ctx.planta.get(id);
    if (k === undefined) return this.noExiste("La planta", id);
    const n = this.nudoPorId.get(`${id}:maestro`);
    let maestro: PlantaConsulta["maestro"] = null;
    if (n !== undefined && this.mapeo.nudos[n]!.maestro) {
      const u = new Float64Array(3 * this.nb);
      this.casos.forEach((c, j) => {
        u[3 * j] = c.u[6 * n]!;
        u[3 * j + 1] = c.u[6 * n + 1]!;
        u[3 * j + 2] = c.u[6 * n + 5]!;
      });
      const nd = this.modelo.nudos[n]!;
      maestro = { punto: [nd.x, nd.y, nd.z], u };
    }
    return { valido: true, valor: { cota: this.ctx.cotas[k]!, maestro }, diagnosticos: [] };
  }

  /**
   * Masas y modos de vibración (VS2): la masa, el centro de masas y la inercia de giro de cada planta
   * con diafragma rígido, y todos los modos, del periodo mayor al menor.
   */
  modos(): Respuesta<ModosConsulta> {
    const md = this.modal;
    if (!md) {
      return this.no(
        "consulta/sin-modal",
        this.fisico.acciones?.sismo === undefined
          ? 'El proyecto no tiene el sismo en sus acciones: los modos de vibración se calculan con "acciones": { "sismo": {} } en el modelo.'
          : "Los resultados no llevan el análisis modal: hay que volver a calcular.",
        [],
      );
    }
    const plantas = md.diafragmas.map((df): PlantaModal => ({ planta: this.mapeo.restricciones[df.restriccion]!.planta, cota: df.z, masa: df.masa, cm: df.cm, J: df.J, repartida: df.repartida }));
    return { valido: true, valor: { g: md.g, masas: md.masas, cm: md.cm, plantas, modos: md.modos }, diagnosticos: [] };
  }

  /**
   * El sismo del programa (VS3): el emplazamiento y el espectro, y en cada dirección, los modos con
   * su aceleración y su cortante en la base, los cortantes combinados de planta, las fuerzas
   * equivalentes y los pares de la excentricidad accidental, los desplazamientos (por μ), el índice θ
   * de los efectos de segundo orden (art. 3.8) y el cortante en la base del método simplificado.
   */
  sismo(): Respuesta<SismoConsulta> {
    const sc = this.sismoCalculado;
    const md = this.modal;
    if (!sc || !md) {
      const s = this.fisico.acciones?.sismo;
      return this.no(
        "consulta/sin-sismo",
        s === undefined
          ? 'El proyecto no tiene el sismo en sus acciones: con "acciones": { "sismo": { "ab": …, "K": …, "terreno": …, "mu": … } } se calcula por espectros de respuesta.'
          : s.ab === undefined
            ? "El sismo de las acciones no lleva la aceleración básica «ab» del emplazamiento: sin ella sólo hay masas y modos (fem consultar modos)."
            : "Los resultados no llevan el análisis modal: hay que volver a calcular.",
        [],
      );
    }
    if (!sc.logicos.length) return { valido: false, diagnosticos: sc.diagnosticos };
    const { espectro } = sc;
    const em = espectro.emplazamiento;
    const z0 = this.ctx.cotas[this.ctx.plantas.length - 1]!;
    const plantaDe = (k: number) => this.mapeo.restricciones[md.diafragmas[k]!.restriccion]!.planta;
    const diags: Diagnostico[] = [...sc.diagnosticos];
    const direcciones = ([0, 1] as const).map((eje): DireccionSismo => {
      const r = sc.respuestas[eje];
      const peso = md.masas.diafragmas * md.g;
      let encima = 0;
      const niveles = r.niveles.map((n, i): NivelSismo => {
        encima += n.masa;
        const debajo = r.niveles[i + 1];
        const altura = n.z - (debajo ? debajo.z : z0);
        const theta = n.cortante > 0 && altura > 0 ? (encima * md.g * n.deriva) / (n.cortante * altura) : 0;
        return {
          plantas: n.diafragmas.map(plantaDe),
          cota: n.z,
          masa: n.masa,
          cortante: n.cortante,
          fuerza: n.fuerza,
          excentricidad: Math.max(0, ...n.diafragmas.map((k) => sc.excentricidades[eje][k]!)),
          par: n.diafragmas.reduce((s, k) => s + (r.pares?.[k] ?? 0), 0),
          desplazamiento: n.desplazamiento,
          deriva: n.deriva,
          altura,
          theta,
        };
      });
      const dom = md.modos[r.dominante]!;
      // El método simplificado, con las plantas de abajo arriba y sus alturas sobre la planta más baja
      const plantas = [...r.niveles].reverse().map((n) => ({ h: n.z - z0, P: n.masa * md.g }));
      const H = plantas.length ? plantas[plantas.length - 1]!.h : 0;
      const simp: DireccionSismo["simplificado"] = [];
      const conTF = (origen: "modal" | "formula", TF: number | null) => {
        if (TF === null || !(TF > 0) || !(H > 0)) return;
        const s = simplificado(plantas, TF, H, em.ac, espectro.beta[eje], em.TB);
        simp.push({ origen, TF, modos: s.modos, basal: s.basal });
      };
      conTF("modal", dom.periodo);
      if (espectro.sistema && espectro.sistema !== "porticos-ha-pantallas" && espectro.sistema !== "acero-triangulado") {
        // L: la dimensión en planta en el sentido de la oscilación (la mayor de sus plantas)
        const L = Math.max(0, ...this.ctx.plantas.map((_, k) => dimensionesPlanta(this.fisico, k)?.[eje] ?? 0));
        conTF("formula", periodoFundamental(espectro.sistema, { n: plantas.length, H, L, B: 0 }));
      }
      return {
        eje: eje === 0 ? "X" : "Y",
        mu: espectro.mu[eje],
        beta: espectro.beta[eje],
        mesetaLarga: sc.mesetaLarga[eje],
        dominante: { modo: r.dominante + 1, periodo: dom.periodo, masaEfectiva: r.masaEfectiva[r.dominante]! },
        basal: r.basal,
        peso,
        coeficiente: peso > 0 ? r.basal / peso : 0,
        modos: md.modos.map((m, i) => ({ periodo: m.periodo, alfa: r.aceleraciones[i]! / (em.ac * md.g), aceleracion: r.aceleraciones[i]!, masaEfectiva: r.masaEfectiva[i]!, basal: r.basalModos[i]! })),
        niveles,
        desplazamientoMaximo: Math.max(0, ...niveles.map((n) => n.desplazamiento)),
        thetaMaxima: Math.max(0, ...niveles.map((n) => n.theta)),
        simplificado: simp,
      };
    }) as [DireccionSismo, DireccionSismo];
    // Art. 3.8: los efectos de segundo orden
    for (const d of direcciones) {
      const H = d.niveles.length ? d.niveles[0]!.cota - z0 : 0;
      const altos = d.niveles.filter((n) => n.theta >= LIMITE_SEGUNDO_ORDEN);
      if (altos.length && d.desplazamientoMaximo > DESPLAZAMIENTO_SIN_SEGUNDO_ORDEN * H)
        diags.push({
          codigo: "sismo/segundo-orden",
          severidad: "aviso",
          mensaje: `Con el sismo según ${d.eje}, el desplazamiento máximo (${(1000 * d.desplazamientoMaximo).toFixed(1)} mm) pasa del 2 ‰ de la altura y en ${altos.length === 1 ? "la planta" : "las plantas"} ${altos.map((n) => n.plantas.join("/")).join(", ")} P·d/(V·h) llega a ${Math.max(...altos.map((n) => n.theta)).toFixed(2)}, por encima de 0,10 (NCSE-02, art. 3.8): hay que considerar los efectos de segundo orden, y este cálculo es de primer orden.`,
          ids: altos.flatMap((n) => n.plantas),
        });
    }
    return { valido: true, valor: { espectro, g: md.g, casos: sc.casos.map((c) => c.id), direcciones }, diagnosticos: diags };
  }

  /**
   * Desplomes de los pilares entre la planta y la de debajo en una combinación (CTE DB SE 4.3.3.2):
   * el desplazamiento horizontal relativo de sus nudos en las dos plantas, y el mayor.
   */
  desplomes(id: string, factores: ArrayLike<number>): Respuesta<Desplomes> {
    const k = this.ctx.planta.get(id);
    if (k === undefined) return this.noExiste("La planta", id);
    if (k + 1 >= this.ctx.plantas.length) return this.no("consulta/sin-planta-inferior", `La planta ${id} es la más baja: no tiene desplome.`, [id]);
    const mal = this.factoresMal<Desplomes>(factores, id);
    if (mal) return mal;
    const abajo = this.ctx.plantas[k + 1]!.id;
    const altura = this.ctx.cotas[k]! - this.ctx.cotas[k + 1]!;
    const partes = this.sup.partes(factores);
    const fl = partes.lineal;
    const u = (n: number, c: number) => {
      let v = 0;
      for (let j = 0; j < fl.length; j++) if (fl[j]) v += fl[j]! * this.casos[j]!.u[6 * n + c]!;
      return v;
    };
    // El desplome es una diferencia de desplazamientos: la de los casos del sismo, la de cada modo, combinada
    const relativo = (a: number, b: number, c: number) => {
      const v = u(a, c) - u(b, c);
      return partes.espectrales.length ? v + this.sup.deEspectrales(partes, (j) => this.casos[j]!.u[6 * a + c]! - this.casos[j]!.u[6 * b + c]!, true) : v;
    };
    const pilares: Desplome[] = [];
    for (const p of this.ctx.pilares) {
      const [a, b] = [this.mapeo.nudosPilar[`${p.id}@${id}`], this.mapeo.nudosPilar[`${p.id}@${abajo}`]];
      if (a === undefined || b === undefined) continue;
      const [dx, dy] = [relativo(a, b, 0), relativo(a, b, 1)];
      const d = Math.hypot(dx, dy);
      pilares.push({ pilar: p.id, dx, dy, d, relativo: d / altura });
    }
    const maximo = pilares.reduce<Desplome | null>((m, q) => (!m || q.relativo > m.relativo ? q : m), null);
    return { valido: true, valor: { altura, pilares, maximo }, diagnosticos: [] };
  }

  // ─── Losas ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Flechas de una losa en una combinación: la mayor de toda la losa y, en cada recuadro entre
   * cuatro pilares de dos alineaciones consecutivas de cada dirección, la mayor relativa a sus
   * esquinas. Son flechas elásticas del modelo; la activa, con la fluencia y la fisuración, es del
   * módulo de comprobación.
   */
  flechas(id: string, factores: ArrayLike<number>): Respuesta<Flechas> {
    const l = this.ctx.losaDe.get(id);
    if (!l) return this.noExiste("La losa", id);
    const mal = this.factoresMal<Flechas>(factores, id);
    if (mal) return mal;
    const partes = this.sup.partes(factores);
    const fl = partes.lineal;
    const conSismo = partes.espectrales.length > 0;
    /** La parte lineal de uz. */
    const uzLineal = (n: number) => {
      let v = 0;
      for (let j = 0; j < fl.length; j++) if (fl[j]) v += fl[j]! * this.casos[j]!.u[6 * n + 2]!;
      return v;
    };
    /** uz del nudo: con los casos del sismo, su uz combinada (por μ). */
    const uz = (n: number) => (conSismo ? uzLineal(n) + this.sup.deEspectrales(partes, (j) => this.casos[j]!.u[6 * n + 2]!, true) : uzLineal(n));
    const { nudos, recuadros: geo } = this.geometriaFlechas(id, l);
    const punto = (n: number): Vec3 => [this.modelo.nudos[n]!.x, this.modelo.nudos[n]!.y, this.modelo.nudos[n]!.z];
    let maxima: FlechaPunto = { nudo: nudos[0]!, punto: punto(nudos[0]!), flecha: -uz(nudos[0]!) };
    for (const n of nudos) if (-uz(n) > maxima.flecha) maxima = { nudo: n, punto: punto(n), flecha: -uz(n) };
    const recuadros: Recuadro[] = [];
    for (const g of geo) {
      if (g.esquinas.some((n) => n < 0)) continue;
      const w = g.esquinas.map((n) => uzLineal(n));
      const [e0, e1, e2, e3] = g.esquinas as [number, number, number, number];
      let mejor: FlechaPunto | null = null;
      for (let k = 0; k < g.nudos.length; k++) {
        const n = g.nudos[k]!;
        const [xi, eta] = [g.xi[k]!, g.eta[k]!];
        // esquinas: (i, j) = (t0, s0); (i, j+1) = (t0, s1); (i+1, j) = (t1, s0); (i+1, j+1) = (t1, s1)
        const base = (1 - eta) * ((1 - xi) * w[0]! + xi * w[1]!) + eta * ((1 - xi) * w[2]! + xi * w[3]!);
        let f = base - uzLineal(n);
        // La flecha relativa es lineal en los desplazamientos: la de los casos del sismo, la de cada modo, combinada
        if (conSismo)
          f += this.sup.deEspectrales(
            partes,
            (j) => {
              const u = this.casos[j]!.u;
              return (1 - eta) * ((1 - xi) * u[6 * e0 + 2]! + xi * u[6 * e1 + 2]!) + eta * ((1 - xi) * u[6 * e2 + 2]! + xi * u[6 * e3 + 2]!) - u[6 * n + 2]!;
            },
            true,
          );
        if (!mejor || f > mejor.flecha) mejor = { nudo: n, punto: punto(n), flecha: f };
      }
      recuadros.push({ pilares: g.pilares, maxima: mejor });
    }
    return { valido: true, valor: { maxima, recuadros }, diagnosticos: [] };
  }

  /**
   * Lo de las flechas de una losa que no depende de la combinación (se calcula la primera vez): sus
   * nudos y, por recuadro entre cuatro pilares de dos alineaciones consecutivas de cada dirección, sus
   * pilares, los nudos de sus esquinas (−1 si no hay) y los nudos de dentro con sus coordenadas
   * relativas (ξ a lo largo de la dirección 1, η a lo largo de la 2).
   */
  private geometriaFlechas(id: string, l: LosaCompilada): GeometriaFlechas {
    const hecha = this.flechasGeo.get(id);
    if (hecha) return hecha;
    const nudos = [...new Set((this.mapeo.losas?.[id] ?? []).flatMap((i) => [...this.modelo.laminas![i]!.nudos]))].sort((a, b) => a - b);
    // Recuadros: las alineaciones de la dirección 1 (t a lo largo de n1) y de la 2 (t a lo largo de d1)
    const [dir1, dir2] = alineacionesLosa(this.ctx, l);
    const A = [...dir1!.alineaciones].sort((a, b) => a.t - b.t);
    const B = [...dir2!.alineaciones].sort((a, b) => a.t - b.t);
    const [d1, n1] = [dir1!.d, dir1!.n];
    const esquina = (a: { pilares: string[] }, b: { pilares: string[] }) => {
      const comunes = a.pilares.filter((p) => b.pilares.includes(p));
      return comunes.length === 1 ? comunes[0]! : null;
    };
    const recuadros: GeometriaFlechas["recuadros"] = [];
    for (let i = 0; i + 1 < A.length; i++)
      for (let j = 0; j + 1 < B.length; j++) {
        const ps = [esquina(A[i]!, B[j]!), esquina(A[i]!, B[j + 1]!), esquina(A[i + 1]!, B[j]!), esquina(A[i + 1]!, B[j + 1]!)];
        if (ps.some((p) => p === null)) continue;
        const esquinas = ps.map((p) => this.mapeo.nudosPilar[`${p}@${l.losa.planta}`] ?? -1);
        const [s0, s1, t0, t1] = [B[j]!.t, B[j + 1]!.t, A[i]!.t, A[i + 1]!.t];
        const dentro: number[] = [];
        const xi: number[] = [];
        const eta: number[] = [];
        for (const n of nudos) {
          const nd = this.modelo.nudos[n]!;
          const s = nd.x * d1[0] + nd.y * d1[1];
          const t = nd.x * n1[0] + nd.y * n1[1];
          if (s < s0 - 1e-9 || s > s1 + 1e-9 || t < t0 - 1e-9 || t > t1 + 1e-9) continue;
          dentro.push(n);
          xi.push((s - s0) / (s1 - s0));
          eta.push((t - t0) / (t1 - t0));
        }
        recuadros.push({ pilares: ps as [string, string, string, string], esquinas, nudos: dentro, xi, eta });
      }
    const g = { nudos, recuadros };
    this.flechasGeo.set(id, g);
    return g;
  }

  // ─── Combinaciones ──────────────────────────────────────────────────────────────────────────

  /**
   * Combinaciones CTE/NCSE de los casos (C5-f), con el generador de `src/combinaciones/`, si todos
   * los casos llevan su `accion`. Sus factores van en el orden de los casos del modelo.
   */
  combinaciones(opciones: OpcionesCombinaciones = {}): Respuesta<Combinacion[]> {
    // Los casos lógicos: con el sismo del programa, también los suyos (VS3)
    const logicos = this.fisico.casos;
    const sin = logicos.filter((c) => !c.accion).map((c) => c.id);
    if (sin.length) return this.no("consulta/sin-accion", `Para generar las combinaciones, todos los casos tienen que llevar su acción (tipo, ψ…); no la llevan: ${sin.join(", ")}.`, sin);
    // A-2: ψ por su nombre, a sus valores
    const casos: CasoCarga[] = logicos.map((c) => {
      const { psi, ...a } = c.accion!;
      return { ...a, ...(psi !== undefined ? { psi: psiDe(psi) } : {}), id: c.id };
    });
    try {
      return { valido: true, valor: generarCombinaciones(casos, opciones), diagnosticos: [] };
    } catch (e) {
      return this.no("consulta/combinaciones", `No se pueden generar las combinaciones: ${e instanceof Error ? e.message : String(e)}.`, logicos.map((c) => c.id));
    }
  }
}
