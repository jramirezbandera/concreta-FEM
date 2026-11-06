/**
 * Edificio de cortante para las pruebas del análisis modal y espectral (VS2 y VS3): `n` plantas
 * iguales, cuatro pilares en las esquinas de A × B con los giros rx y ry y el uz coartados en cada
 * planta (forjado infinitamente rígido), un diafragma por planta y el peso de cada planta en sus
 * cuatro esquinas. Su solución es cerrada: en X, en Y y en giro, una cadena de masas y muelles.
 */
import type { SeccionBarra } from "../elementos/barra.ts";
import { GRAVEDAD, type CargaNodal, type ModeloAnalitico } from "../motor/modelo.ts";
import { carga, Constructor, seccionRectangular } from "./constructor.ts";

export interface OpcionesCortante {
  /** Lados de la planta y altura de planta, m. Por defecto, 6 × 4 y 3. */
  A?: number;
  B?: number;
  H?: number;
  seccion?: SeccionBarra;
  /** Dónde va el maestro de cada diafragma (por defecto, el centro). */
  maestro?: [number, number];
  /** Peso de cada planta, kN (por defecto, 800), y cómo se reparte entre sus cuatro esquinas (por defecto, a partes iguales). */
  pesos?: number[];
  reparto?: number[];
}

export interface EdificioCortante {
  modelo: ModeloAnalitico;
  /** Nudos de las esquinas de cada nivel (0, la base) y maestro de cada planta. */
  niveles: number[][];
  maestros: number[];
  /** Barra del pilar de la esquina c bajo la planta k (1…n). */
  pilar: (k: number, c: number) => number;
  A: number;
  B: number;
  H: number;
  seccion: SeccionBarra;
  /** Masa de cada planta, t. */
  masas: number[];
  /** Rigidez de una planta en X (Iy, con vz = X), en Y (Iz) y de giro respecto al centro. */
  kx: number;
  ky: number;
  kt: number;
}

export function edificioCortante(n = 3, o: OpcionesCortante = {}): EdificioCortante {
  const [A, B, H] = [o.A ?? 6, o.B ?? 4, o.H ?? 3];
  const seccion = o.seccion ?? seccionRectangular(0.3, 0.5);
  const m = new Constructor();
  const xy = [
    [0, 0],
    [A, 0],
    [A, B],
    [0, B],
  ] as const;
  const [xm, ym] = o.maestro ?? [A / 2, B / 2];
  const niveles = Array.from({ length: n + 1 }, (_, k) => xy.map(([x, y]) => m.nudo(x, y, k * H)));
  for (const v of niveles[0]!) m.apoyo(v);
  const nodales: CargaNodal[] = [];
  const maestros: number[] = [];
  const barras: number[][] = [];
  const masas: number[] = [];
  for (let k = 1; k <= n; k++) {
    const peso = o.pesos?.[k - 1] ?? 800;
    masas.push(peso / GRAVEDAD);
    barras.push(
      niveles[k]!.map((v, c) => {
        const b = m.barra(niveles[k - 1]![c]!, v, seccion, [1, 0, 0]);
        m.apoyo(v, [false, false, true, true, true, false]);
        nodales.push(carga(v, { fz: -peso * (o.reparto?.[c] ?? 0.25) }));
        return b;
      }),
    );
    const maestro = m.nudo(xm, ym, k * H, `M${k}`);
    maestros.push(maestro);
    m.diafragma(maestro, niveles[k]!, `D${k}`);
  }
  m.caso("G", nodales);
  const kx = (4 * 12 * seccion.E * seccion.Iy) / H ** 3;
  const ky = (4 * 12 * seccion.E * seccion.Iz) / H ** 3;
  const kt = kx * (B / 2) ** 2 + ky * (A / 2) ** 2 + (4 * seccion.G * seccion.J) / H;
  return { modelo: { ...m.modelo(), modal: { masas: [{ caso: "G", fraccion: 1 }] } }, niveles, maestros, pilar: (k, c) => barras[k - 1]![c]!, A, B, H, seccion, masas, kx, ky, kt };
}
