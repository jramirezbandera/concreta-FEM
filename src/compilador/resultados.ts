/**
 * Resultados por pieza física: los diagramas del motor (`DiagramasBarras`) recorridos por
 * estaciones de la pieza con el mapeo, nunca por proximidad (§8.1).
 */
import { DiagramasBarras } from "../motor/barras.ts";
import type { DiagramaBarra } from "../elementos/cargasBarra.ts";
import type { ModeloAnalitico, ResultadoCaso } from "../motor/modelo.ts";
import type { Mapeo } from "./mapeo.ts";

export interface TramoFlexible {
  barra: number;
  /** Estaciones de los extremos del tramo flexible (i', j') en la pieza. */
  s0: number;
  s1: number;
  /** Tramo de la polilínea (vigas) o planta de la cabeza (pilares). */
  tramo: number;
}

export class EsfuerzosPiezas {
  private readonly diagramas: DiagramasBarras;
  private readonly cache = new Map<string, DiagramaBarra>();
  readonly modelo: ModeloAnalitico;
  readonly mapeo: Mapeo;
  readonly casos: readonly ResultadoCaso[];

  /** `casos`: los de un cálculo válido del `modelo`, en su orden. */
  constructor(modelo: ModeloAnalitico, mapeo: Mapeo, casos: readonly ResultadoCaso[]) {
    this.modelo = modelo;
    this.mapeo = mapeo;
    this.casos = casos;
    this.diagramas = new DiagramasBarras(modelo);
  }

  /** Tramos flexibles de una pieza, en orden. */
  tramos(pieza: string): TramoFlexible[] {
    return (this.mapeo.piezas[pieza] ?? []).map((b) => {
      const m = this.mapeo.barras[b]!;
      return { barra: b, s0: m.s[1], s1: m.s[2], tramo: m.tramo };
    });
  }

  /** Diagrama de la barra `b` en el caso `k`. */
  diagrama(b: number, k: number): DiagramaBarra {
    const clave = `${b}/${k}`;
    let d = this.cache.get(clave);
    if (!d) this.cache.set(clave, (d = this.diagramas.diagrama(b, k, this.casos[k]!)));
    return d;
  }

  /**
   * Esfuerzos [N, Vy, Vz, T, My, Mz] en la estación `s` de la pieza, en el caso `k`, en los ejes
   * locales de su tramo. En el extremo común de dos tramos flexibles, `lado` elige el de la
   * izquierda (−1) o el de la derecha (+1). null si `s` cae en una zona rígida o fuera de la pieza.
   */
  en(pieza: string, k: number, s: number, lado: -1 | 1 = 1, tol = 1e-9): number[] | null {
    const ts = this.tramos(pieza).filter((t) => s >= t.s0 - tol && s <= t.s1 + tol);
    if (!ts.length) return null;
    const t = lado < 0 ? ts[0]! : ts[ts.length - 1]!;
    const x = Math.min(t.s1 - t.s0, Math.max(0, s - t.s0));
    return this.diagrama(t.barra, k).esfuerzosEn(x, lado);
  }
}
