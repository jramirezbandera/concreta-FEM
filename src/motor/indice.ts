/**
 * Índice espacial de cajas (C5, criterio 8): una rejilla uniforme 3D para que un corte (E5) sólo mire
 * los elementos y las restricciones que pueden tocarlo, y no todo el modelo. Sin él, cada corte
 * recorría todas las láminas, barras y nudos, y las estaciones de las bandas del edificio objetivo
 * costaban varias veces el cálculo.
 *
 * Cada objeto entra con una caja [mín, máx] en las celdas que cubre. Los que cubrirían más de
 * MAX_CELDAS celdas (un diafragma de planta) van a una lista aparte que se devuelve siempre. `buscar`
 * devuelve los índices cuya caja puede cortar la caja pedida, ordenados y sin repetir: quien lo usa
 * los recorre en el mismo orden que el modelo, así que las sumas salen idénticas bit a bit.
 */

/** Celdas que puede cubrir un objeto antes de ir a la lista de los que se devuelven siempre. */
export const MAX_CELDAS = 4096;

export class IndiceCajas {
  private readonly lado: number;
  private readonly celdas = new Map<number, number[]>();
  private readonly siempre: number[] = [];
  private readonly cajas: Float64Array;
  private readonly visto: Int32Array;
  private consulta = 0;
  private readonly min: [number, number, number];
  private readonly n: [number, number, number];

  /**
   * @param cajas 6 números por objeto: [xmín, ymín, zmín, xmáx, ymáx, zmáx] (un objeto con alguno
   *   no finito no entra).
   * @param lado lado de las celdas, m (> 0).
   */
  constructor(cajas: Float64Array, lado: number) {
    const n = cajas.length / 6;
    this.cajas = cajas;
    this.lado = lado;
    this.visto = new Int32Array(n);
    const finita = (i: number) => {
      for (let c = 0; c < 6; c++) if (!Number.isFinite(cajas[6 * i + c]!)) return false;
      return true;
    };
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++)
      if (finita(i))
        for (let c = 0; c < 3; c++) {
          min[c] = Math.min(min[c], cajas[6 * i + c]!);
          max[c] = Math.max(max[c], cajas[6 * i + 3 + c]!);
        }
    this.min = [0, 1, 2].map((c) => (Number.isFinite(min[c]!) ? min[c]! : 0)) as [number, number, number];
    this.n = [0, 1, 2].map((c) => (Number.isFinite(max[c]! - min[c]!) ? Math.floor((max[c]! - min[c]!) / lado) + 1 : 1)) as [number, number, number];
    for (let i = 0; i < n; i++) {
      if (!finita(i)) continue;
      const [i0, j0, k0] = this.celda(cajas[6 * i]!, cajas[6 * i + 1]!, cajas[6 * i + 2]!);
      const [i1, j1, k1] = this.celda(cajas[6 * i + 3]!, cajas[6 * i + 4]!, cajas[6 * i + 5]!);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1) > MAX_CELDAS) {
        this.siempre.push(i);
        continue;
      }
      for (let k = k0; k <= k1; k++)
        for (let j = j0; j <= j1; j++)
          for (let a = i0; a <= i1; a++) {
            const clave = a + this.n[0] * (j + this.n[1] * k);
            let l = this.celdas.get(clave);
            if (!l) this.celdas.set(clave, (l = []));
            l.push(i);
          }
    }
  }

  /** Celda (acotada a la rejilla) de un punto. */
  private celda(x: number, y: number, z: number): [number, number, number] {
    const f = (v: number, c: number) => Math.min(this.n[c]! - 1, Math.max(0, Math.floor((v - this.min[c]!) / this.lado)));
    return [f(x, 0), f(y, 1), f(z, 2)];
  }

  /** Objetos cuya caja corta la caja [mín, máx] (y los de la lista de siempre), ordenados. */
  buscar(min: ArrayLike<number>, max: ArrayLike<number>): number[] {
    const r: number[] = [];
    const q = ++this.consulta;
    const C = this.cajas;
    const corta = (i: number) => C[6 * i]! <= max[0]! && C[6 * i + 3]! >= min[0]! && C[6 * i + 1]! <= max[1]! && C[6 * i + 4]! >= min[1]! && C[6 * i + 2]! <= max[2]! && C[6 * i + 5]! >= min[2]!;
    for (const i of this.siempre) {
      this.visto[i] = q;
      r.push(i);
    }
    // Fuera de la rejilla no hay nada (la celda se acota, así que hay que comprobarlo aparte)
    for (let c = 0; c < 3; c++) if (max[c]! < this.min[c]! || min[c]! > this.min[c]! + this.n[c]! * this.lado) return r.sort((a, b) => a - b);
    const [i0, j0, k0] = this.celda(min[0]!, min[1]!, min[2]!);
    const [i1, j1, k1] = this.celda(max[0]!, max[1]!, max[2]!);
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let a = i0; a <= i1; a++) {
          const l = this.celdas.get(a + this.n[0] * (j + this.n[1] * k));
          if (!l) continue;
          for (const i of l) {
            if (this.visto[i] === q) continue;
            this.visto[i] = q;
            if (corta(i)) r.push(i);
          }
        }
    return r.sort((a, b) => a - b);
  }
}

/**
 * Caja de unos puntos (3 coordenadas cada uno en `xyz`, por índice), agrandada por `margen` y, con
 * `porDiametro`, también por su diámetro (la diagonal de la caja): así contiene la proyección sobre un
 * plano de cualquiera de sus puntos si el objeto corta o toca ese plano.
 */
export function cajaDe(xyz: Float64Array, nudos: ArrayLike<number>, extra: ArrayLike<number>[] = [], porDiametro = false, margen = 0): number[] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const poner = (p: ArrayLike<number>) => {
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c]!, p[c]!);
      max[c] = Math.max(max[c]!, p[c]!);
    }
  };
  for (let a = 0; a < nudos.length; a++) poner(xyz.subarray(3 * nudos[a]!, 3 * nudos[a]! + 3));
  for (const p of extra) poner(p);
  const d = porDiametro ? Math.sqrt((max[0]! - min[0]!) ** 2 + (max[1]! - min[1]!) ** 2 + (max[2]! - min[2]!) ** 2) : 0;
  return [min[0]! - d - margen, min[1]! - d - margen, min[2]! - d - margen, max[0]! + d + margen, max[1]! + d + margen, max[2]! + d + margen];
}
