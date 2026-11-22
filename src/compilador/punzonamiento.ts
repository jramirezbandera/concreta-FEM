/**
 * Fase CO4 (`docs/fem3d/comprobaciones.md` §8.7): lo que el forjado pasa a un pilar en una planta, para
 * el punzonamiento (CO-i).
 *
 * El pilar se une a la losa por su huella (C2-d, HR): su nudo de la planta es el maestro de un enlace
 * rígido cuyos esclavos son los nudos de la losa dentro de la huella (y, con la unión por las caras de
 * las vigas, los de las caras que caen en su zona rígida). Lo que la losa le pasa es, por caso base, la
 * suma de las fuerzas nodales de sus láminas (g = k·u − f_eq, lo que los nudos hacen sobre ellas,
 * cambiado de signo) en esos nudos, reducida al nudo del pilar: exacta, en equilibrio con lo que la
 * losa carga, y lineal en los casos.
 *
 * Aparte, y sólo como información, lo que le pasan las **vigas planas** (de hormigón, rectangulares,
 * en el plano del forjado y de canto no mayor que el de la losa). Lo de las vigas no es punzonamiento
 * de la losa (CO-i): es el cortante de la viga (CO2).
 *
 * Componentes, sobre el pilar y respecto a su nudo, en ejes globales: [Fz, Mx, My] de la losa y
 * [Fz, Mx, My] de las vigas planas (kN, kN·m). Con las cargas de gravedad, Fz < 0 (el forjado cuelga
 * del pilar).
 */
import type { FuerzasNodales } from "../motor/fuerzasNodales.ts";
import type { ModeloAnalitico, ResultadoCaso } from "../motor/modelo.ts";
import type { Vec2 } from "./fisico.ts";
import type { Mapeo } from "./mapeo.ts";
import type { Contexto } from "./validar.ts";

/** Valores por caso base de `TransmitidoPilar.porBase`. */
export const N_TRANSMITIDO = 6;

export interface TransmitidoPilar {
  pilar: string;
  planta: string;
  /** El nudo del pilar en la planta y su punto. */
  nudo: number;
  punto: [number, number, number];
  /** La losa a la que se une (la de más láminas en sus nudos). */
  losa: string;
  /** Canto de la losa, m. */
  espesor: number;
  /** Los ábacos de la losa, si es reticular. */
  abacos: Vec2[][] | null;
  /** Nudos rígidos con el del pilar (él incluido) y láminas de losa que los tocan. */
  nudos: number;
  laminas: number;
  /** Vigas planas que le llegan y las demás vigas. */
  vigasPlanas: string[];
  vigas: string[];
  /** Por caso base: [Fz, Mx, My] de la losa y [Fz, Mx, My] de las vigas planas. */
  porBase: Float64Array;
}

const TOL_CANTO = 1e-6;

/** Los índices de la consulta, hechos una vez por modelo. */
export class IndicePunzonamiento {
  /** Enlaces rígidos de los que cada nudo es maestro. */
  private readonly deMaestro = new Map<number, number[]>();
  /** Láminas y barras de cada nudo. */
  private readonly laminasDe = new Map<number, number[]>();
  private readonly barrasDe = new Map<number, number[]>();

  private readonly modelo: ModeloAnalitico;

  constructor(modelo: ModeloAnalitico) {
    this.modelo = modelo;
    (modelo.restricciones ?? []).forEach((r, i) => {
      if (r.tipo !== "enlace-rigido") return;
      let l = this.deMaestro.get(r.maestro);
      if (!l) this.deMaestro.set(r.maestro, (l = []));
      l.push(i);
    });
    const anotar = (m: Map<number, number[]>, nudos: readonly number[], i: number) => {
      for (const v of nudos) {
        let l = m.get(v);
        if (!l) m.set(v, (l = []));
        l.push(i);
      }
    };
    (modelo.laminas ?? []).forEach((l, i) => anotar(this.laminasDe, l.nudos, i));
    (modelo.barras ?? []).forEach((b, i) => anotar(this.barrasDe, b.nudos, i));
  }

  /** El nudo y todos los que cuelgan de él por enlaces rígidos (cadenas incluidas). */
  rigidos(nudo: number): number[] {
    const vistos = new Set<number>([nudo]);
    const pila = [nudo];
    while (pila.length) {
      const v = pila.pop()!;
      for (const ir of this.deMaestro.get(v) ?? [])
        for (const s of this.modelo.restricciones![ir]!.esclavos)
          if (!vistos.has(s)) {
            vistos.add(s);
            pila.push(s);
          }
    }
    return [...vistos].sort((a, b) => a - b);
  }

  laminas(nudos: readonly number[]): number[] {
    return [...new Set(nudos.flatMap((v) => this.laminasDe.get(v) ?? []))].sort((a, b) => a - b);
  }

  barras(nudos: readonly number[]): number[] {
    return [...new Set(nudos.flatMap((v) => this.barrasDe.get(v) ?? []))].sort((a, b) => a - b);
  }
}

/**
 * La losa que llega a la huella del pilar en la planta (la de más láminas en sus nudos rígidos), sin
 * calcular nada; null si el pilar no llega a la planta o ninguna losa toca su huella (va dentro del
 * ancho de sus vigas, o no hay losa).
 */
export function losaEnHuella(mapeo: Mapeo, indice: IndicePunzonamiento, pilar: string, planta: string): string | null {
  const nudo = mapeo.nudosPilar[`${pilar}@${planta}`];
  if (nudo === undefined) return null;
  const cuenta = new Map<string, number>();
  for (const l of indice.laminas(indice.rigidos(nudo))) {
    const losa = mapeo.laminas?.[l]?.losa;
    if (losa !== undefined) cuenta.set(losa, (cuenta.get(losa) ?? 0) + 1);
  }
  return [...cuenta].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
}

/**
 * Lo que el forjado pasa al pilar en la planta; null si el pilar no llega a ella o no se une a ninguna
 * losa (va por sus vigas, o no hay losa).
 */
export function transmitidoPilar(
  ctx: Contexto,
  compilado: { modelo: ModeloAnalitico; mapeo: Mapeo },
  fuerzas: FuerzasNodales,
  casos: readonly ResultadoCaso[],
  indice: IndicePunzonamiento,
  pilar: string,
  planta: string,
): TransmitidoPilar | null {
  const { modelo, mapeo } = compilado;
  const nudo = mapeo.nudosPilar[`${pilar}@${planta}`];
  if (nudo === undefined) return null;
  const S = indice.rigidos(nudo);
  const pos = new Map(S.map((v, i) => [v, i]));
  // Las láminas de losa en esos nudos, y su losa (la de más láminas)
  const cuenta = new Map<string, number>();
  const laminas = indice.laminas(S).filter((l) => {
    const losa = mapeo.laminas?.[l]?.losa;
    if (losa === undefined) return false;
    cuenta.set(losa, (cuenta.get(losa) ?? 0) + 1);
    return true;
  });
  if (!laminas.length) return null;
  const losa = [...cuenta].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
  const lc = ctx.losaDe.get(losa);
  if (!lc) return null;
  const espesor = lc.losa.espesor;
  // Las vigas que llegan: planas (cuentan) o no
  const planas = new Set<string>();
  const otras = new Set<string>();
  const barras = indice.barras(S).filter((b) => {
    const m = mapeo.barras[b]!;
    if (m.tipo !== "viga" || m.auxiliar) return false;
    const v = ctx.vigaDe.get(m.pieza);
    const sc = v && ctx.secciones.get(v.seccion);
    const plana = !!v && !!sc && v.insercion !== "superior" && sc.material === "hormigon" && sc.forma === "rectangular" && sc.canto <= espesor + TOL_CANTO;
    (plana ? planas : otras).add(m.pieza);
    return plana;
  });
  const n0 = modelo.nudos[nudo]!;
  const [x0, y0, z0] = [n0.x, n0.y, n0.z];
  const nb = casos.length;
  const porBase = new Float64Array(N_TRANSMITIDO * nb);
  /** Suma −g de un elemento en los nudos de S, reducida al nudo del pilar. */
  const sumar = (nudos: readonly number[], g: readonly Float64Array[], desde: number) => {
    nudos.forEach((v, a) => {
      if (!pos.has(v)) return;
      const n = modelo.nudos[v]!;
      const [dx, dy, dz] = [n.x - x0, n.y - y0, n.z - z0];
      for (let k = 0; k < nb; k++) {
        const o = 6 * a;
        const [fx, fy, fz] = [-g[k]![o]!, -g[k]![o + 1]!, -g[k]![o + 2]!];
        const p = N_TRANSMITIDO * k + desde;
        porBase[p]! += fz;
        porBase[p + 1]! += -g[k]![o + 3]! + dy * fz - dz * fy;
        porBase[p + 2]! += -g[k]![o + 4]! + dz * fx - dx * fz;
      }
    });
  };
  for (const l of laminas) sumar(modelo.laminas![l]!.nudos, fuerzas.laminaCasos(l, casos), 0);
  for (const b of barras) sumar(modelo.barras![b]!.nudos, fuerzas.barraCasos(b, casos), 3);
  return {
    pilar,
    planta,
    nudo,
    punto: [x0, y0, z0],
    losa,
    espesor,
    abacos: lc.reticular ? lc.reticular.abacos : null,
    nudos: S.length,
    laminas: laminas.length,
    vigasPlanas: [...planas].sort(),
    vigas: [...otras].sort(),
    porBase,
  };
}
