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
 *   una reacción, el maestro de una planta) son lineales en los casos: se dan por caso (n valores por
 *   caso, seguidos) y una combinación es `combinar(v, n, factores)` (envolventes.ts).
 * - Los máximos sobre una región (el vano de una viga, la flecha de una losa, el desplome de una
 *   planta) no lo son: el máximo de una combinación no es la combinación de los máximos. Esas
 *   consultas reciben los factores de una combinación (o de un caso, `factoresCaso`) y la buscan en
 *   ella, de forma exacta en las barras (diagramas combinados) y nudo a nudo en las losas.
 *
 * Una consulta a un objeto que no existe, o con factores que no casan con los casos, no lanza: da su
 * diagnóstico con el id (`Respuesta`).
 */
import { generarCombinaciones, type CasoCarga, type Combinacion, type OpcionesCombinaciones } from "../combinaciones/generador.ts";
import { psiDe } from "../combinaciones/psi.ts";
import { DiagramaBarra } from "../elementos/cargasBarra.ts";
import { CamposLaminas } from "../motor/campos.ts";
import { Cortes } from "../motor/cortes.ts";
import { Diagnosticos, type Diagnostico } from "../motor/diagnosticos.ts";
import type { ModeloAnalitico, ResultadoCaso, Vec3 } from "../motor/modelo.ts";
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
import { validar, type Contexto, type LosaCompilada } from "./validar.ts";

export type Respuesta<T> = { valido: true; valor: T; diagnosticos: Diagnostico[] } | { valido: false; diagnosticos: Diagnostico[] };

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
  readonly fisico: ModeloFisico;
  readonly modelo: ModeloAnalitico;
  readonly mapeo: Mapeo;
  readonly casos: readonly ResultadoCaso[];
  private readonly ctx: Contexto;
  private readonly opciones: OpcionesCompilacion;
  private piezasC?: EsfuerzosPiezas;
  private bandasC?: EsfuerzosBandas;
  private franjasC?: EsfuerzosFranjas;
  private camposC?: CamposLaminas;
  private cortesC?: Cortes;
  private murosC?: EsfuerzosMuros;
  private readonly flechasGeo = new Map<string, GeometriaFlechas>();
  private readonly apoyoEnNudo = new Map<number, string>();
  private readonly coartado = new Set<number>();
  private readonly nudoPorId = new Map<string, number>();

  /**
   * @param fisico el modelo físico que se compiló (con sus bandas) y `opciones`, las de la compilación.
   * @param compilado su modelo analítico y su mapeo; `casos`, los resultados de un cálculo válido.
   */
  constructor(fisico: ModeloFisico, compilado: { modelo: ModeloAnalitico; mapeo: Mapeo }, casos: readonly ResultadoCaso[], opciones: OpcionesCompilacion = {}) {
    this.fisico = fisico;
    this.modelo = compilado.modelo;
    this.mapeo = compilado.mapeo;
    this.casos = casos;
    this.opciones = opciones;
    const diag = new Diagnosticos();
    const ctx = validar(fisico, resolverOpciones(opciones), diag);
    if (!ctx || diag.hayErrores) throw new Error("Consultas: el modelo físico no es válido (tiene que ser el que se compiló)");
    if (casos.length !== this.modelo.casos.length) throw new Error(`Consultas: ${casos.length} resultados para ${this.modelo.casos.length} casos`);
    this.ctx = ctx;
    for (const [id, n] of Object.entries(this.mapeo.apoyos)) this.apoyoEnNudo.set(n, id);
    for (const a of this.modelo.apoyos ?? []) this.coartado.add(a.nudo);
    this.modelo.nudos.forEach((n, i) => this.nudoPorId.set(n.id, i));
  }

  /** Número de casos. */
  get nc(): number {
    return this.casos.length;
  }

  private piezas(): EsfuerzosPiezas {
    return (this.piezasC ??= new EsfuerzosPiezas(this.modelo, this.mapeo, this.casos));
  }

  private no<T>(codigo: string, mensaje: string, ids: string[]): Respuesta<T> {
    const d = new Diagnosticos();
    d.error(codigo, mensaje, ids);
    return { valido: false, diagnosticos: d.lista };
  }

  private noExiste<T>(que: string, id: string): Respuesta<T> {
    return this.no("consulta/no-existe", `${que} «${id}» no existe en el modelo.`, [id]);
  }

  /** null si los factores valen (uno finito por caso); si no, la respuesta de error. */
  private factoresMal<T>(f: ArrayLike<number>, id: string): Respuesta<T> | null {
    if (f.length === this.nc && Array.from(f).every(Number.isFinite)) return null;
    return this.no("consulta/factores", `Los factores de la combinación tienen que ser ${this.nc} números finitos, uno por caso (${this.modelo.casos.map((c) => c.id).join(", ")}).`, [id]);
  }

  // ─── Pilares ────────────────────────────────────────────────────────────────────────────────

  /** Tramos del pilar (de la base a la cabeza), con sus esfuerzos por caso en base y cabeza. */
  pilar(id: string): Respuesta<TramoPilar[]> {
    const p = this.ctx.pilarDe.get(id);
    if (!p) return this.noExiste("El pilar", id);
    const ep = this.piezas();
    const nc = this.nc;
    const grupos = new Map<number, ReturnType<EsfuerzosPiezas["tramos"]>>();
    for (const t of ep.tramos(id)) grupos.set(t.tramo, [...(grupos.get(t.tramo) ?? []), t]);
    const r: TramoPilar[] = [];
    for (const [k, ts] of grupos) {
      const [a, b] = [ts[0]!, ts[ts.length - 1]!];
      const base = new Float64Array(6 * nc);
      const cabeza = new Float64Array(6 * nc);
      for (let c = 0; c < nc; c++) {
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

  /** Diagrama combinado de la barra b (la combinación de los diagramas de sus casos). */
  private diagramaCombinado(b: number, f: ArrayLike<number>): DiagramaBarra {
    const ep = this.piezas();
    const ks: number[] = [];
    for (let k = 0; k < f.length; k++) if (f[k]) ks.push(k);
    if (!ks.length) return DiagramaBarra.combinar([ep.diagrama(b, 0)], [0]);
    return DiagramaBarra.combinar(
      ks.map((k) => ep.diagrama(b, k)),
      ks.map((k) => f[k]!),
    );
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
    this.bandasC ??= new EsfuerzosBandas(this.fisico, this.modelo, this.casos, { epsGeom: this.ctx.op.epsGeom, campos: this.campos, cortes: this.cortes });
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
    this.bandasC ??= new EsfuerzosBandas(this.fisico, this.modelo, this.casos, { epsGeom: this.ctx.op.epsGeom, campos: this.campos, cortes: this.cortes });
    const r = this.bandasC.reparto(losa, direccion, factores);
    return { valido: true, valor: r.lineas, diagnosticos: r.diagnosticos };
  }

  // ─── Franjas de armado (fase F) ─────────────────────────────────────────────────────────────

  private esfuerzosFranjas(): EsfuerzosFranjas {
    return (this.franjasC ??= new EsfuerzosFranjas(this.ctx, { modelo: this.modelo, mapeo: this.mapeo }, this.casos, { campos: this.campos, cortes: this.cortes }));
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
    const nc = this.nc;
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
      const u = new Float64Array(3 * this.nc);
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
    const u = (n: number, c: number) => {
      let v = 0;
      for (let j = 0; j < this.nc; j++) if (factores[j]) v += factores[j]! * this.casos[j]!.u[6 * n + c]!;
      return v;
    };
    const pilares: Desplome[] = [];
    for (const p of this.ctx.pilares) {
      const [a, b] = [this.mapeo.nudosPilar[`${p.id}@${id}`], this.mapeo.nudosPilar[`${p.id}@${abajo}`]];
      if (a === undefined || b === undefined) continue;
      const [dx, dy] = [u(a, 0) - u(b, 0), u(a, 1) - u(b, 1)];
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
    const uz = (n: number) => {
      let v = 0;
      for (let j = 0; j < this.nc; j++) if (factores[j]) v += factores[j]! * this.casos[j]!.u[6 * n + 2]!;
      return v;
    };
    const { nudos, recuadros: geo } = this.geometriaFlechas(id, l);
    const punto = (n: number): Vec3 => [this.modelo.nudos[n]!.x, this.modelo.nudos[n]!.y, this.modelo.nudos[n]!.z];
    let maxima: FlechaPunto = { nudo: nudos[0]!, punto: punto(nudos[0]!), flecha: -uz(nudos[0]!) };
    for (const n of nudos) if (-uz(n) > maxima.flecha) maxima = { nudo: n, punto: punto(n), flecha: -uz(n) };
    const recuadros: Recuadro[] = [];
    for (const g of geo) {
      const w = g.esquinas.map((n) => (n < 0 ? Number.NaN : uz(n)));
      if (w.some(Number.isNaN)) continue;
      let mejor: FlechaPunto | null = null;
      for (let k = 0; k < g.nudos.length; k++) {
        const n = g.nudos[k]!;
        const [xi, eta] = [g.xi[k]!, g.eta[k]!];
        // esquinas: (i, j) = (t0, s0); (i, j+1) = (t0, s1); (i+1, j) = (t1, s0); (i+1, j+1) = (t1, s1)
        const base = (1 - eta) * ((1 - xi) * w[0]! + xi * w[1]!) + eta * ((1 - xi) * w[2]! + xi * w[3]!);
        const f = base - uz(n);
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
    const sin = this.ctx.casos.filter((c) => !c.accion).map((c) => c.id);
    if (sin.length) return this.no("consulta/sin-accion", `Para generar las combinaciones, todos los casos tienen que llevar su acción (tipo, ψ…); no la llevan: ${sin.join(", ")}.`, sin);
    // A-2: ψ por su nombre, a sus valores
    const casos: CasoCarga[] = this.ctx.casos.map((c) => {
      const { psi, ...a } = c.accion!;
      return { ...a, ...(psi !== undefined ? { psi: psiDe(psi) } : {}), id: c.id };
    });
    try {
      return { valido: true, valor: generarCombinaciones(casos, opciones), diagnosticos: [] };
    } catch (e) {
      return this.no("consulta/combinaciones", `No se pueden generar las combinaciones: ${e instanceof Error ? e.message : String(e)}.`, this.ctx.casos.map((c) => c.id));
    }
  }
}
