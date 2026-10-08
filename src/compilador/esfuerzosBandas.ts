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
 * Momentos medios por metro de ancho, para Wood–Armer (C5-c):
 * - mx = My/b, exacto;
 * - my (el que flecta la banda en transversal) y mxy, medias de las muestras de un corte «campos»
 *   a DELTA_MUESTRAS de la estación (en el plano exacto de una cara sembrada no hay láminas que
 *   atravesar).
 * Wood–Armer va por combinación (H34), con (a) los momentos medios, por defecto, o (b) punto a punto
 * con las muestras corregidas para que integren el My exacto, y de ellas la media de lo que pide
 * cada punto.
 *
 * Todo es lineal: los esfuerzos de una combinación son la combinación de los de sus casos.
 */
import { envolventeWoodArmer, woodArmer, type EnvolventeWoodArmer, type MomentosWoodArmer } from "../dimensionado/woodArmer.ts";
import { CamposLaminas } from "../motor/campos.ts";
import { Cortes, type Corte } from "../motor/cortes.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { ModeloAnalitico, ResultadoCaso } from "../motor/modelo.ts";
import { cotasPlantas } from "./cotas.ts";
import { ejesBanda, estacionesBanda, puntoBanda } from "./estaciones.ts";
import type { Banda, ModeloFisico, Vec2 } from "./fisico.ts";

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
  /** [N, Vy, Vz, T, My, Mz] por caso (6·nc), en los ejes de la banda. kN y kN·m. */
  esfuerzos: Float64Array;
  /** [mx, my, mxy] medios por caso (3·nc), kN·m/m. my y mxy son NaN sin muestras. */
  medios: Float64Array;
  /** Muestras del corte a DELTA_MUESTRAS: pesos (m) y [Mx, My, Mxy] por punto y caso (3·np por caso). */
  muestras: { pesos: Float64Array; momentos: Float64Array[] } | null;
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

  /** Esfuerzos de la banda en todas sus estaciones; null si no existe. */
  estaciones(id: string): EstacionResultado[] | null {
    const b = this.bandaDe.get(id);
    if (!b) return null;
    const { L } = ejesBanda(b);
    const nc = this.casos.length;
    return estacionesBanda(b, this.eps).map((e) => {
      const r = this.cortes.cortar(this.corte(b, e.s, e.tipo === "cara" ? "fuerzas-nodales" : "campos"), this.casos, this.campos);
      // Muestras a δ de la estación, del lado del vano más largo (las dos caras de un apoyo miran a vanos distintos)
      const sm = e.s - DELTA_MUESTRAS > 0 ? e.s - DELTA_MUESTRAS : Math.min(L, e.s + DELTA_MUESTRAS);
      const rm = this.cortes.cortar(this.corte(b, sm, "campos"), this.casos, this.campos);
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
      for (let k = 0; k < nc; k++) medios[3 * k] = r.esfuerzos[6 * k + 4]! / b.ancho;
      return {
        banda: b.id,
        s: e.s,
        tipo: e.tipo,
        punto: puntoBanda(b, e.s),
        ancho: b.ancho,
        esfuerzos: r.esfuerzos,
        medios,
        muestras,
        barras: r.barras.map((i) => this.modelo.barras![i]!.id),
        valido: r.valido,
        diagnosticos: [...r.diagnosticos, ...rm.diagnosticos.filter((d) => d.severidad === "error")],
      };
    });
  }
}

/** Combinación lineal de un vector por caso (n valores por caso) con unos factores. */
function combinar(v: ArrayLike<number>, n: number, f: ArrayLike<number>): Float64Array {
  const r = new Float64Array(n);
  for (let k = 0; k < f.length; k++) {
    const a = f[k]!;
    if (a) for (let q = 0; q < n; q++) r[q]! += a * v[n * k + q]!;
  }
  return r;
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
