/**
 * Barras entre dos niveles (fase BN, `docs/fem3d/barras.md`): su geometría, común al compilador, al
 * dibujo y al 3D.
 */
import type { Vec3 } from "../motor/modelo.ts";
import { cotasPlantas } from "./cotas.ts";
import type { Barra, Planta } from "./fisico.ts";

/** A2-36: desvío horizontal (m) entre los extremos por debajo del cual una barra es vertical (el ε_geom por defecto). */
export const DESVIO_VERTICAL_BARRA = 1e-6;

/** +X sin su componente según x, unitario (x casi vertical). */
function ortogonalX(ex: Vec3): Vec3 {
  const c = ex[0];
  if (c === 0) return [1, 0, 0];
  const v: Vec3 = [1 - c * ex[0], -c * ex[1], -c * ex[2]];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/**
 * Ejes locales de una barra (fase BN, cabecera de `fisico.ts`): x de A a B; z en el plano vertical
 * que la contiene y hacia arriba; y = z × x; `giro` (grados) gira y y z alrededor de x a derechas.
 * Vertical, z = +X antes del giro (la regla de los pilares).
 */
export function ejesBarra(A: Vec3, B: Vec3, giro: number): { ex: Vec3; ey: Vec3; ez: Vec3 } {
  const L = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
  const ex: Vec3 = [(B[0] - A[0]) / L, (B[1] - A[1]) / L, (B[2] - A[2]) / L];
  const h = Math.hypot(ex[0], ex[1]);
  // Proyección de +Z sobre el plano normal a x: (−x_z·x_x, −x_z·x_y, 1 − x_z²)/h. A2-36: con menos de
  // DESVIO_VERTICAL_BARRA de desvío horizontal en toda su longitud es vertical (la regla de los pilares):
  // +X, quitada su componente según x (nada si es vertical del todo). Antes el umbral era 1e-9 del
  // coseno, y los ejes giraban con un desvío de nanómetros hacia donde cayera
  const z0: Vec3 = h * L > DESVIO_VERTICAL_BARRA ? [(-ex[2] * ex[0]) / h, (-ex[2] * ex[1]) / h, h] : ortogonalX(ex);
  const cruz = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const g = (((giro % 360) + 360) % 360) / 90;
  const [c, s] = Number.isInteger(g) ? ([[1, 0], [0, 1], [-1, 0], [0, -1]][g]! as [number, number]) : [Math.cos((giro * Math.PI) / 180), Math.sin((giro * Math.PI) / 180)];
  const xz = cruz(ex, z0);
  const ez: Vec3 = s === 0 ? z0 : [c * z0[0] + s * xz[0], c * z0[1] + s * xz[1], c * z0[2] + s * xz[2]];
  return { ex, ey: cruz(ez, ex), ez };
}

/** Los puntos de inicio y fin de una barra en el espacio, o null si falta la cota de alguna de sus plantas. */
export function puntosBarra(plantas: readonly Planta[], b: Pick<Barra, "inicio" | "fin">): [Vec3, Vec3] | null {
  const cotas = cotasPlantas(plantas);
  const cota = (id: string) => cotas[plantas.findIndex((p) => p.id === id)] ?? null;
  const [zi, zf] = [cota(b.inicio.planta), cota(b.fin.planta)];
  if (zi === null || zf === null) return null;
  return [
    [b.inicio.x, b.inicio.y, zi + (b.inicio.dz ?? 0)],
    [b.fin.x, b.fin.y, zf + (b.fin.dz ?? 0)],
  ];
}
