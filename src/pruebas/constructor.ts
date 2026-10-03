/**
 * Constructor de modelos analíticos para los tests del motor: no es código del motor.
 * Los ids se generan solos (N0, B0, L0, M0, R0) si no se dan.
 */
import type { SeccionBarra } from "../elementos/barra.ts";
import type { MaterialLamina } from "../elementos/dkmq.ts";
import type {
  Apoyo,
  BarraAnalitica,
  CargaBarra,
  CargaNodal,
  CasoCarga,
  DesplazamientoImpuesto,
  LaminaAnalitica,
  ModeloAnalitico,
  Muelle,
  NudoAnalitico,
  Restriccion,
  Vec3,
} from "../motor/modelo.ts";

export const EMPOTRADO = [true, true, true, true, true, true] as const;
export const ARTICULADO = [true, true, true, false, false, false] as const;

/** Sección rectangular b×h con el canto h según z local; J de Saint-Venant aproximada (Roark). */
export function seccionRectangular(b: number, h: number, E = 3e7, nu = 0.2): SeccionBarra {
  const [a, c] = b >= h ? [b, h] : [h, b];
  const J = a * c ** 3 * (1 / 3 - 0.21 * (c / a) * (1 - c ** 4 / (12 * a ** 4)));
  return { E, G: E / (2 * (1 + nu)), A: b * h, Iy: (b * h ** 3) / 12, Iz: (h * b ** 3) / 12, J };
}

export type OpcionesBarra = Partial<Pick<BarraAnalitica, "id" | "offsets" | "liberaciones" | "modificadores">>;

/** Sección rectangular con áreas de cortante 5/6·A (Timoshenko). */
export function seccionRectangularTimoshenko(b: number, h: number, E = 3e7, nu = 0.2): SeccionBarra {
  const s = seccionRectangular(b, h, E, nu);
  return { ...s, Avy: (5 / 6) * s.A, Avz: (5 / 6) * s.A };
}

export class Constructor {
  readonly nudos: NudoAnalitico[] = [];
  readonly barras: BarraAnalitica[] = [];
  readonly laminas: LaminaAnalitica[] = [];
  readonly muelles: Muelle[] = [];
  readonly apoyos: Apoyo[] = [];
  readonly restricciones: Restriccion[] = [];
  readonly casos: CasoCarga[] = [];

  nudo(x: number, y: number, z: number, id = `N${this.nudos.length}`): number {
    this.nudos.push({ id, x, y, z });
    return this.nudos.length - 1;
  }

  /** `extra`: el id, u opciones de E2 (offsets, liberaciones, modificadores) con id opcional. */
  barra(i: number, j: number, seccion: SeccionBarra, vz: Vec3, extra?: string | OpcionesBarra): number {
    const o = typeof extra === "string" ? { id: extra } : (extra ?? {});
    this.barras.push({ ...o, id: o.id ?? `B${this.barras.length}`, nudos: [i, j], seccion, vz });
    return this.barras.length - 1;
  }

  lamina(nudos: readonly [number, number, number, number], material: MaterialLamina, id = `L${this.laminas.length}`): number {
    this.laminas.push({ id, nudos, material });
    return this.laminas.length - 1;
  }

  muelle(nudos: readonly [number] | readonly [number, number], k: readonly number[], ejes?: readonly number[], id = `M${this.muelles.length}`): number {
    this.muelles.push({ id, nudos, k, ejes });
    return this.muelles.length - 1;
  }

  apoyo(nudo: number, coartados: Apoyo["coartados"] = EMPOTRADO): void {
    this.apoyos.push({ nudo, coartados });
  }

  diafragma(maestro: number, esclavos: readonly number[], id = `R${this.restricciones.length}`): void {
    this.restricciones.push({ tipo: "diafragma", id, maestro, esclavos });
  }

  enlace(maestro: number, esclavos: readonly number[], id = `R${this.restricciones.length}`): void {
    this.restricciones.push({ tipo: "enlace-rigido", id, maestro, esclavos });
  }

  caso(id: string, nodales: CargaNodal[] = [], impuestos: DesplazamientoImpuesto[] = [], barras: CargaBarra[] = []): void {
    this.casos.push({ id, nodales, impuestos, barras });
  }

  modelo(): ModeloAnalitico {
    return {
      nudos: this.nudos,
      barras: this.barras,
      laminas: this.laminas,
      muelles: this.muelles,
      apoyos: this.apoyos,
      restricciones: this.restricciones,
      casos: this.casos,
    };
  }
}

/** Carga nodal con sólo algunas componentes: `carga(n, { fx: 10, mz: 2 })`. */
export function carga(nudo: number, c: Partial<Record<"fx" | "fy" | "fz" | "mx" | "my" | "mz", number>>): CargaNodal {
  return { nudo, f: [c.fx ?? 0, c.fy ?? 0, c.fz ?? 0, c.mx ?? 0, c.my ?? 0, c.mz ?? 0] };
}
