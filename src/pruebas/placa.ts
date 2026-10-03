/**
 * Mallas rectangulares de láminas para los tests y los oráculos de E3: no es código del motor.
 */
import type { MaterialLamina } from "../elementos/dkmq.ts";
import type { Vec3 } from "../motor/modelo.ts";
import type { Constructor, OpcionesLamina } from "./constructor.ts";

export interface OpcionesMalla {
  /** Lados según ex y según ey, m. */
  a: number;
  b: number;
  nx: number;
  ny: number;
  material: MaterialLamina;
  /** Esquina (0, 0) y direcciones (unitarias y ortogonales) de los lados. Por defecto, el plano XY. */
  origen?: Vec3;
  ex?: Vec3;
  ey?: Vec3;
  /** Opciones de cada lámina (i según ex, j según ey). */
  lamina?: OpcionesLamina | ((i: number, j: number) => OpcionesLamina);
  /** Prefijo de los ids. */
  prefijo?: string;
  /** Nudo ya existente que ocupa la posición (i, j) (un borde compartido con otra malla). */
  existente?: (i: number, j: number) => number | undefined;
}

export interface Malla {
  /** nudos[i][j]: nudo en (i·a/nx, j·b/ny). */
  nudos: number[][];
  /** laminas[i][j]: lámina (i, j), con la normal ex × ey. */
  laminas: number[][];
  /** Punto (x, y) del plano de la malla, en globales. */
  punto: (x: number, y: number) => Vec3;
}

export function mallaRectangular(m: Constructor, o: OpcionesMalla): Malla {
  const O = o.origen ?? [0, 0, 0];
  const ex = o.ex ?? [1, 0, 0];
  const ey = o.ey ?? [0, 1, 0];
  const p = o.prefijo ?? "";
  const punto = (x: number, y: number): Vec3 => [O[0] + x * ex[0] + y * ey[0], O[1] + x * ex[1] + y * ey[1], O[2] + x * ex[2] + y * ey[2]];
  const nudos: number[][] = [];
  for (let i = 0; i <= o.nx; i++) {
    nudos.push([]);
    for (let j = 0; j <= o.ny; j++) nudos[i]!.push(o.existente?.(i, j) ?? m.nudo(...punto((i * o.a) / o.nx, (j * o.b) / o.ny), `${p}N${i}-${j}`));
  }
  const laminas: number[][] = [];
  for (let i = 0; i < o.nx; i++) {
    laminas.push([]);
    for (let j = 0; j < o.ny; j++) {
      const op = typeof o.lamina === "function" ? o.lamina(i, j) : (o.lamina ?? {});
      laminas[i]!.push(m.lamina([nudos[i]![j]!, nudos[i + 1]![j]!, nudos[i + 1]![j + 1]!, nudos[i]![j + 1]!], o.material, { id: `${p}L${i}-${j}`, ...op }));
    }
  }
  return { nudos, laminas, punto };
}
