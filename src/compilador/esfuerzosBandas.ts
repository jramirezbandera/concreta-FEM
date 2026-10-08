/**
 * Esfuerzos de las bandas de dimensionado (C5.2, D5, E5, H25, H34): en cada estación de una banda
 * (sus caras de apoyo y sus centros de vano, `estaciones.ts`), el corte de la losa a lo ancho de la
 * banda.
 *
 * Ejes de la banda: x a lo largo de su eje (de `desde` a `hasta`), z vertical hacia arriba e
 * y = z × x. Los esfuerzos [N, Vy, Vz, T, My, Mz] son los del corte del motor (cortes.ts): los que
 * el lado +x ejerce sobre el −x, reducidos al punto del eje en la cota de la planta. Como en una
 * viga, My > 0 es momento de vano (tracción abajo) y Vz es el cortante. Con diafragma rígido, N, Vy
 * y Mz de una banda no se pueden atribuir y quedan en NaN (E5-1).
 * - En las caras, por fuerzas nodales: exacto, porque el compilador las siembra (`apoyos`).
 * - En los vanos, por campos (mixto, E5-6).
 *
 * En un reticular, también el momento por nervio, My·s/b (C4-j), y la parte del ancho en ábacos.
 *
 * Momentos medios por metro de ancho, para Wood–Armer (C5-c):
 * - mx = My/b, exacto, con b el ancho de la banda que cae en losa en esa estación (sin lo que cruza
 *   un hueco o se sale); una estación sin losa no vale (aviso `banda/estacion-sin-losa`);
 * - my (el que flecta la banda en transversal) y mxy, medias de las muestras: en un vano, las de su
 *   propio corte; en una cara, las de un corte «campos» a DELTA_MUESTRAS (en el plano exacto de una
 *   cara sembrada no hay láminas que atravesar).
 * Wood–Armer va por combinación (H34), con (a) los momentos medios, por defecto, o (b) punto a punto
 * con las muestras corregidas para que integren el My exacto, y de ellas la media de lo que pide
 * cada punto.
 *
 * Todo es lineal: los esfuerzos de una combinación son la combinación de los de sus casos.
 */
import { envolventeWoodArmer, woodArmer, type EnvolventeWoodArmer, type MomentosWoodArmer } from "../dimensionado/woodArmer.ts";
import { CamposLaminas } from "../motor/campos.ts";
import { Cortes, type Corte } from "../motor/cortes.ts";
import { Diagnosticos, type Diagnostico } from "../motor/diagnosticos.ts";
import type { ModeloAnalitico, ResultadoCaso } from "../motor/modelo.ts";
import { cotasPlantas } from "./cotas.ts";
import { combinar } from "./envolventes.ts";
import { ejesBanda, estacionesBanda, ladoEstacion, puntoBanda } from "./estaciones.ts";
import type { Banda, Losa, ModeloFisico, Vec2 } from "./fisico.ts";
import { fraccionEnRegiones, puntoEnRegion, type Region } from "./poligonos.ts";

/** Distancia a la estación del corte de muestras, m. */
export const DELTA_MUESTRAS = 1e-3;

export interface EstacionResultado {
  banda: string;
  /** Distancia desde `desde` a lo largo del eje, m. */
  s: number;
  tipo: "cara" | "vano";
  /** Punto del eje en planta. */
  punto: Vec2;
  /** Ancho de la banda, m. */
  ancho: number;
  /**
   * Ancho de la banda que cae en las losas de su planta en esta estación, m: el ancho menos lo que
   * cruza un hueco o se sale de la losa. Es el de los momentos medios.
   */
  anchoEnLosa: number;
  /** [N, Vy, Vz, T, My, Mz] por caso (6·nc), en los ejes de la banda. kN y kN·m. */
  esfuerzos: Float64Array;
  /** [mx, my, mxy] medios por caso (3·nc), kN·m/m: mx = My / anchoEnLosa. my y mxy son NaN sin muestras. */
  medios: Float64Array;
  /** Muestras (del corte del vano, o del corte a DELTA_MUESTRAS de la cara): pesos (m) y [Mx, My, Mxy] por punto y caso (3·np por caso). */
  muestras: { pesos: Float64Array; momentos: Float64Array[] } | null;
  /**
   * En un reticular (la losa del punto del eje), el momento por nervio (C4-j): My·s/b por caso, con s
   * el intereje y b el ancho en losa, kN·m por nervio; y la fracción del ancho en losa que cae en
   * ábacos (macizos: ahí no hay nervios). null en una losa maciza.
   */
  nervio: { intereje: number; momentos: Float64Array; fraccionAbaco: number } | null;
  /** Ids de las barras que atraviesan el corte (vigas embebidas en la banda, por ejemplo). */
  barras: string[];
  valido: boolean;
  diagnosticos: Diagnostico[];
}

export class EsfuerzosBandas {
  readonly fisico: ModeloFisico;
  readonly modelo: ModeloAnalitico;
  readonly casos: readonly ResultadoCaso[];
  private readonly cortes: Cortes;
  private readonly campos: CamposLaminas;
  private readonly cota: Map<string, number>;
  private readonly bandaDe: Map<string, Banda>;
  private readonly eps: number;
  /** Losas de cada planta (sus regiones), con la losa de cada región. */
  private readonly regiones = new Map<string, Region[]>();
  private readonly losasPlanta = new Map<string, Losa[]>();
  /** Estaciones ya calculadas por banda (no se cambian: las devuelve `estaciones`). */
  private readonly hechas = new Map<string, EstacionResultado[]>();

  /**
   * @param fisico el modelo físico con sus bandas (las que se compilaron).
   * @param modelo el modelo analítico compilado, y `casos`, sus resultados (válidos).
   */
  constructor(fisico: ModeloFisico, modelo: ModeloAnalitico, casos: readonly ResultadoCaso[], opciones: { campos?: CamposLaminas; epsGeom?: number } = {}) {
    this.fisico = fisico;
    this.modelo = modelo;
    this.casos = casos;
    this.cortes = new Cortes(modelo);
    this.campos = opciones.campos ?? new CamposLaminas(modelo);
    this.eps = opciones.epsGeom ?? 1e-6;
    const cotas = cotasPlantas(fisico.plantas);
    this.cota = new Map(fisico.plantas.map((p, k) => [p.id, cotas[k] ?? Number.NaN]));
    this.bandaDe = new Map((fisico.bandas ?? []).map((b) => [b.id, b]));
    for (const l of fisico.losas ?? []) {
      let r = this.regiones.get(l.planta);
      if (!r) this.regiones.set(l.planta, (r = []));
      r.push({ contorno: l.contorno, huecos: l.huecos ?? [] });
      let ls = this.losasPlanta.get(l.planta);
      if (!ls) this.losasPlanta.set(l.planta, (ls = []));
      ls.push(l);
    }
  }

  /** Ids de las bandas. */
  get bandas(): string[] {
    return [...this.bandaDe.keys()];
  }

  /** Corte de la banda en la estación s. */
  private corte(b: Banda, s: number, metodo: Corte["metodo"]): Corte {
    const { d } = ejesBanda(b);
    const P = puntoBanda(b, s);
    return { id: `${b.id}@${s.toFixed(3)}`, origen: [P[0], P[1], this.cota.get(b.planta)!], x: [d[0], d[1], 0], vz: [0, 0, 1], y: [-b.ancho / 2, b.ancho / 2], z: [0, 0], metodo };
  }

  /** Esfuerzos de la banda en todas sus estaciones (se calculan la primera vez; no se cambian); null si no existe. */
  estaciones(id: string): EstacionResultado[] | null {
    const b = this.bandaDe.get(id);
    if (!b) return null;
    let r = this.hechas.get(id);
    if (!r) this.hechas.set(id, (r = this.calcularEstaciones(b)));
    return r;
  }

  /**
   * Reparto entre bandas de pilares y centrales (C5-d): en cada línea de caras y de vanos de las
   * bandas de la planta de la losa paralelas a `direccion` (con su `tipo`), la suma de los My de las
   * de pilares y la de las centrales en la combinación `factores`. Con las caras comunes (C5-g),
   * todas las bandas de una línea de pilares tienen sus caras en las mismas rectas. Un aviso
   * `banda/reparto` cuando la parte de las de pilares sale del 60–80 % (caras, negativos) o del
   * 50–70 % (vanos, positivos) de la tabla I.1 del Anejo I: el reparto es el del cálculo, la tabla es
   * la referencia del método simplificado. Sólo se compara cuando las dos sumas son negativas (caras)
   * o positivas (vanos).
   */
  reparto(losa: string, direccion: Vec2, factores: ArrayLike<number>): { lineas: LineaReparto[]; diagnosticos: Diagnostico[] } {
    const l = (this.fisico.losas ?? []).find((x) => x.id === losa);
    const diag = new Diagnosticos();
    if (!l) return { lineas: [], diagnosticos: diag.lista };
    const nd = Math.sqrt(direccion[0] * direccion[0] + direccion[1] * direccion[1]);
    const d: Vec2 = [direccion[0] / nd, direccion[1] / nd];
    const lineas = new Map<string, LineaReparto>();
    for (const b of this.fisico.bandas ?? []) {
      if (b.planta !== l.planta || !b.tipo) continue;
      const e = ejesBanda(b).d;
      if (Math.abs(Math.abs(e[0] * d[0] + e[1] * d[1]) - 1) > 1e-9) continue;
      for (const x of this.estaciones(b.id)!) {
        if (!x.valido) continue;
        const s = x.punto[0] * d[0] + x.punto[1] * d[1];
        const clave = `${x.tipo}@${Math.round(s / this.eps)}`;
        let li = lineas.get(clave);
        if (!li) lineas.set(clave, (li = { tipo: x.tipo, s, pilares: 0, centrales: 0, fraccion: Number.NaN, rango: x.tipo === "cara" ? [0.6, 0.8] : [0.5, 0.7], fuera: false, bandas: [] }));
        const M = combinar(x.esfuerzos, 6, factores)[4]!;
        if (b.tipo === "pilares") li.pilares += M;
        else li.centrales += M;
        li.bandas.push(b.id);
      }
    }
    const r = [...lineas.values()].sort((a, b) => a.s - b.s || (a.tipo < b.tipo ? -1 : 1));
    for (const li of r) {
      const total = li.pilares + li.centrales;
      // La tabla reparte negativos en las caras y positivos en los vanos: con el otro signo en alguna
      // de las dos sumas (un pilar de borde articulado, las centrales junto a una fachada, un viento)
      // no se compara
      const signo = li.tipo === "cara" ? -1 : 1;
      if (!li.bandas.length || !(signo * li.pilares > 0 && signo * li.centrales > 0)) continue;
      li.fraccion = li.pilares / total;
      li.fuera = li.fraccion < li.rango[0] || li.fraccion > li.rango[1];
      if (li.fuera)
        diag.aviso(
          "banda/reparto",
          `En la ${li.tipo === "cara" ? "línea de caras" : "línea de vanos"} s = ${li.s.toFixed(3)} m de la losa ${losa}, las bandas de pilares llevan el ${(100 * li.fraccion).toFixed(0)} % del momento (la tabla I.1 del Anejo I da del ${100 * li.rango[0]} al ${100 * li.rango[1]} %). El reparto es el del cálculo; revise las bandas si no lo espera.`,
          [losa, ...li.bandas],
          { s: li.s, fraccion: li.fraccion },
        );
    }
    return { lineas: r, diagnosticos: diag.lista };
  }

  private calcularEstaciones(b: Banda): EstacionResultado[] {
    const { L } = ejesBanda(b);
    const nc = this.casos.length;
    return estacionesBanda(b, this.eps).map((e) => {
      const r = this.cortes.cortar(this.corte(b, e.s, e.tipo === "cara" ? "fuerzas-nodales" : "campos"), this.casos, this.campos);
      // Muestras: en un vano, las del propio corte (por campos); en una cara, las de un corte a δ, del
      // lado del vano más largo (las dos caras de un apoyo miran a vanos distintos)
      const sm = e.s - DELTA_MUESTRAS > 0 ? e.s - DELTA_MUESTRAS : Math.min(L, e.s + DELTA_MUESTRAS);
      const rm = e.tipo === "vano" ? r : this.cortes.cortar(this.corte(b, sm, "campos"), this.casos, this.campos);
      const ms = rm.valido && rm.muestras && rm.muestras.pesos.length ? rm.muestras : null;
      const medios = new Float64Array(3 * nc);
      let muestras: EstacionResultado["muestras"] = null;
      if (ms) {
        const np = ms.pesos.length;
        const suma = ms.pesos.reduce((a, w) => a + w, 0);
        const momentos = ms.valores.map((v) => {
          const m = new Float64Array(3 * np);
          for (let i = 0; i < np; i++) for (let q = 0; q < 3; q++) m[3 * i + q] = v[8 * i + 3 + q]!;
          return m;
        });
        muestras = { pesos: Float64Array.from(ms.pesos), momentos };
        for (let k = 0; k < nc; k++) {
          let my = 0;
          let mxy = 0;
          for (let i = 0; i < np; i++) {
            my += ms.pesos[i]! * momentos[k]![3 * i + 1]!;
            mxy += ms.pesos[i]! * momentos[k]![3 * i + 2]!;
          }
          medios[3 * k + 1] = my / suma;
          medios[3 * k + 2] = mxy / suma;
        }
      } else for (let k = 0; k < nc; k++) medios[3 * k + 1] = medios[3 * k + 2] = Number.NaN;
      // El ancho en losa: sin losa (la estación cae entera en un hueco o fuera), la estación no vale
      const [A, B] = ladoEstacion(b, e.s);
      const anchoEnLosa = b.ancho * fraccionEnRegiones(A!, B!, this.regiones.get(b.planta) ?? []);
      const diag = new Diagnosticos();
      const enLosa = anchoEnLosa > this.eps;
      if (!enLosa) diag.aviso("banda/estacion-sin-losa", `La estación ${e.s.toFixed(3)} m de la banda ${b.id} cae entera en un hueco o fuera de las losas: no tiene esfuerzos.`, [b.id]);
      for (let k = 0; k < nc; k++) medios[3 * k] = enLosa ? r.esfuerzos[6 * k + 4]! / anchoEnLosa : Number.NaN;
      if (!enLosa) medios.fill(Number.NaN);
      // Por nervio, en un reticular
      const P = puntoBanda(b, e.s);
      const regs = this.regiones.get(b.planta) ?? [];
      const losa = (this.losasPlanta.get(b.planta) ?? []).find((_, i) => puntoEnRegion(P, regs[i]!));
      let nervio: EstacionResultado["nervio"] = null;
      if (losa?.reticular) {
        const s = losa.reticular.intereje;
        const momentos = new Float64Array(nc);
        for (let k = 0; k < nc; k++) momentos[k] = enLosa ? (r.esfuerzos[6 * k + 4]! * s) / anchoEnLosa : Number.NaN;
        const enAbacos = b.ancho * fraccionEnRegiones(A!, B!, (losa.reticular.abacos ?? []).map((c) => ({ contorno: c, huecos: [] })));
        nervio = { intereje: s, momentos, fraccionAbaco: enLosa ? Math.min(1, enAbacos / anchoEnLosa) : Number.NaN };
      }
      return {
        banda: b.id,
        s: e.s,
        tipo: e.tipo,
        punto: P,
        ancho: b.ancho,
        anchoEnLosa,
        esfuerzos: r.esfuerzos,
        medios,
        muestras,
        nervio,
        barras: r.barras.map((i) => this.modelo.barras![i]!.id),
        valido: r.valido && enLosa,
        diagnosticos: [...r.diagnosticos, ...(rm === r ? [] : rm.diagnosticos.filter((d) => d.severidad === "error")), ...diag.lista],
      };
    });
  }
}

/** Una línea de caras o de vanos para el reparto entre bandas (C5-d). */
export interface LineaReparto {
  tipo: "cara" | "vano";
  /** Coordenada de la línea a lo largo de la dirección, m (p·d). */
  s: number;
  /** Suma de los My de las bandas de pilares y de las centrales en la línea, kN·m. */
  pilares: number;
  centrales: number;
  /** pilares / (pilares + centrales); NaN si alguna de las dos sumas no es negativa (en una cara) o positiva (en un vano). */
  fraccion: number;
  /** El de la tabla I.1: [0,6, 0,8] en las caras, [0,5, 0,7] en los vanos. */
  rango: [number, number];
  fuera: boolean;
  bandas: string[];
}

export type MetodoWoodArmer = "medios" | "puntos";

/**
 * Wood–Armer de una estación en cada combinación (factores por caso) y su envolvente (H34, C5-c):
 * - "medios" (a, por defecto): con los momentos medios de la banda;
 * - "puntos" (b): en cada punto de las muestras, con su Mx corregido (la misma cantidad en todos)
 *   para que integren el My exacto del corte; la media de lo que pide cada punto.
 * Momentos de dimensionado por metro (kN·m/m), en los ejes de la banda: X a lo largo de su eje.
 */
export function woodArmerEstacion(e: EstacionResultado, combinaciones: readonly ArrayLike<number>[], metodo: MetodoWoodArmer = "medios"): { porCombinacion: MomentosWoodArmer[]; envolvente: EnvolventeWoodArmer } {
  if (metodo === "medios") {
    const ternas = new Float64Array(3 * combinaciones.length);
    combinaciones.forEach((f, c) => ternas.set(combinar(e.medios, 3, f), 3 * c));
    const porCombinacion = combinaciones.map((_, c) => woodArmer(ternas[3 * c]!, ternas[3 * c + 1]!, ternas[3 * c + 2]!));
    return { porCombinacion, envolvente: envolventeWoodArmer(ternas) };
  }
  if (!e.muestras) throw new Error(`La estación ${e.banda}@${e.s} no tiene muestras para Wood–Armer punto a punto`);
  const { pesos, momentos } = e.muestras;
  const np = pesos.length;
  const suma = pesos.reduce((a, w) => a + w, 0);
  const todos = new Float64Array(3 * np * momentos.length);
  momentos.forEach((m, k) => todos.set(m, 3 * np * k));
  const porCombinacion = combinaciones.map((f) => {
    const m = combinar(todos, 3 * np, f);
    let integral = 0;
    for (let i = 0; i < np; i++) integral += pesos[i]! * m[3 * i]!;
    const My = combinar(e.esfuerzos, 6, f)[4]!;
    const correccion = (My - integral) / suma;
    const r: MomentosWoodArmer = { inferiorX: 0, inferiorY: 0, superiorX: 0, superiorY: 0 };
    for (let i = 0; i < np; i++) {
      const w = woodArmer(m[3 * i]! + correccion, m[3 * i + 1]!, m[3 * i + 2]!);
      for (const c of ["inferiorX", "inferiorY", "superiorX", "superiorY"] as const) r[c] += (pesos[i]! * w[c]) / suma;
    }
    return r;
  });
  const valores: MomentosWoodArmer = { inferiorX: 0, inferiorY: 0, superiorX: 0, superiorY: 0 };
  const combinacion = { inferiorX: -1, inferiorY: -1, superiorX: -1, superiorY: -1 };
  porCombinacion.forEach((r, c) => {
    for (const q of ["inferiorX", "inferiorY", "superiorX", "superiorY"] as const)
      if (r[q] > valores[q]) {
        valores[q] = r[q];
        combinacion[q] = c;
      }
  });
  return { porCombinacion, envolvente: { valores, combinacion } };
}
