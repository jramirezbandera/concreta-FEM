/**
 * Viento del CTE DB SE-AE (art. 3.3 y Anejo D) para el análisis global de un edificio de pisos:
 * las tablas y las piezas de cálculo, sin el modelo (fase VS1, `docs/fem3d/viento-sismo.md`).
 *
 *   qe = qb · ce(z) · cp                                            (3.1)
 *   ce = F · (F + 7k),  F = k · ln(max(z, Z) / L)                   (D.2, D.3)
 *
 * Copiado de Concreta (wh0am1-dev/concreta): las tablas, de `src/lib/acciones/tablasAE.ts`
 * (transcritas del texto de abril de 2009, con su página); la interpolación, de
 * `src/lib/acciones/interp.ts`; y `coeficienteExposicion`, `coeficientesEolicos`,
 * `alturasTributarias` y `presionDinamicaDesdeVelocidad`, de `src/lib/acciones/viento.ts`. Sus
 * decisiones se conservan: ce por la fórmula del Anejo D.2 a la altura de cada forjado (D-VN3; la
 * tabla 3.4 es esa fórmula redondeada y sólo sirve para probar), cp y cs interpolados en la tabla
 * 3.5 (D-VN2) y la banda tributaria de media planta por debajo y por encima.
 *
 * Lo que no se copia: el rozamiento (3.3.2-3), la cubierta a dos aguas (D.6) y los paramentos
 * (D.3), que no entran en VS1. La composición por plantas con el ancho de cada una está en
 * `src/compilador/viento.ts`.
 */

export type ZonaEolica = "A" | "B" | "C";
export type GradoAspereza = "I" | "II" | "III" | "IV" | "V";

/**
 * Anejo D.1-4 (p. 27): velocidad básica de la figura D.1 y presión dinámica «respectivamente de
 * 0,42, 0,45 y 0,52 kN/m² para las zonas A, B y C», tal como la escribe la norma (no como
 * 0,5·δ·vb²).
 */
export const ZONAS_EOLICAS: Readonly<Record<ZonaEolica, { vb: number; qb: number }>> = {
  A: { vb: 26, qb: 0.42 },
  B: { vb: 27, qb: 0.45 },
  C: { vb: 29, qb: 0.52 },
};

/** Anejo D.1-3 (p. 27): densidad del aire, kg/m³. */
export const DENSIDAD_AIRE = 1.25;

/** Art. 3.3.2-1 (p. 11): «como valor en cualquier punto del territorio español, puede adoptarse 0,5 kN/m²». */
export const QB_SIMPLIFICADO = 0.5;

export const ORDEN_ASPEREZAS: readonly GradoAspereza[] = ["I", "II", "III", "IV", "V"];

/** Tabla D.2 (p. 28): coeficientes k, L y Z de cada tipo de entorno para la fórmula D.2. */
export const ASPEREZAS: Readonly<Record<GradoAspereza, { k: number; L: number; Z: number; descripcion: string }>> = {
  I: { k: 0.156, L: 0.003, Z: 1.0, descripcion: "borde del mar o de un lago, con una superficie de agua en la dirección del viento de al menos 5 km de longitud" },
  II: { k: 0.17, L: 0.01, Z: 1.0, descripcion: "terreno rural llano sin obstáculos ni arbolado de importancia" },
  III: { k: 0.19, L: 0.05, Z: 2.0, descripcion: "zona rural accidentada o llana con algunos obstáculos aislados, como árboles o construcciones pequeñas" },
  IV: { k: 0.22, L: 0.3, Z: 5.0, descripcion: "zona urbana en general, industrial o forestal" },
  V: { k: 0.24, L: 1.0, Z: 10.0, descripcion: "centro de negocios de grandes ciudades, con profusión de edificios en altura" },
};

/** Tabla 3.4 (p. 12): ce tabulado por altura. No se usa para calcular: prueba la fórmula D.2. */
export const ALTURAS_TABLA_3_4: readonly number[] = [3, 6, 9, 12, 15, 18, 24, 30];
export const TABLA_3_4: Readonly<Record<GradoAspereza, readonly number[]>> = {
  I: [2.4, 2.7, 3.0, 3.1, 3.3, 3.4, 3.5, 3.7],
  II: [2.1, 2.5, 2.7, 2.9, 3.0, 3.1, 3.3, 3.5],
  III: [1.6, 2.0, 2.3, 2.5, 2.6, 2.7, 2.9, 3.1],
  IV: [1.3, 1.4, 1.7, 1.9, 2.1, 2.2, 2.4, 2.6],
  V: [1.2, 1.2, 1.2, 1.4, 1.5, 1.6, 1.9, 2.0],
};

/** Anejo D.2-1 (p. 28): la fórmula vale para alturas z no mayores de 200 m. */
export const Z_MAX_ANEJO_D = 200;

/** Art. 3.3.1-2 (p. 11): el DB no es aplicable por encima de 2 000 m de altitud. */
export const ALTITUD_MAX_VIENTO = 2000;

/** Art. 3.3.1-3 (p. 11): el DB no cubre construcciones de esbeltez superior a 6. */
export const ESBELTEZ_MAX = 6;

/**
 * Tabla 3.5 (p. 12): coeficiente eólico global de edificios de pisos según la esbeltez en el plano
 * paralelo al viento. La primera columna es «< 0,25» y la última «≥ 5,00»: fuera, el extremo.
 */
export const TABLA_3_5 = {
  esbeltez: [0.25, 0.5, 0.75, 1.0, 1.25, 5.0],
  cp: [0.7, 0.7, 0.8, 0.8, 0.8, 0.8],
  cs: [-0.3, -0.4, -0.4, -0.5, -0.6, -0.7],
} as const;

/** Art. 3.3.2-2 (p. 11): excentricidad en planta del 5 % de la dimensión máxima perpendicular al viento. */
export const EXCENTRICIDAD_VIENTO = 0.05;

/**
 * Interpolación lineal en una tabla de la norma (D-VN2, Anejo D.3-2: «en todas las tablas puede
 * interpolarse linealmente»). Fuera del rango tabulado, el extremo: es la regla de la tabla 3.5.
 */
export function interpolar(x: number, xs: readonly number[], ys: readonly number[]): number {
  if (xs.length === 0 || xs.length !== ys.length) throw new Error("interpolar: las abscisas y las ordenadas no casan");
  if (x <= xs[0]!) return ys[0]!;
  const n = xs.length;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  let i = 1;
  while (xs[i]! < x) i++;
  const t = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
  return ys[i - 1]! + t * (ys[i]! - ys[i - 1]!);
}

/** Fórmula D.1: qb = 0,5 · δ · vb², en kN/m² (vb en m/s). */
export function presionDinamicaDesdeVelocidad(vb: number): number {
  return (0.5 * DENSIDAD_AIRE * vb * vb) / 1000;
}

/** Fórmulas D.2 y D.3: coeficiente de exposición a la altura z (m) sobre la rasante. */
export function coeficienteExposicion(z: number, aspereza: GradoAspereza): number {
  const { k, L, Z } = ASPEREZAS[aspereza];
  const F = k * Math.log(Math.max(z, Z) / L);
  return F * (F + 7 * k);
}

/** Tabla 3.5 interpolada: coeficientes eólicos de presión y succión para una esbeltez. */
export function coeficientesEolicos(esbeltez: number): { cp: number; cs: number } {
  return { cp: interpolar(esbeltez, TABLA_3_5.esbeltez, TABLA_3_5.cp), cs: interpolar(esbeltez, TABLA_3_5.esbeltez, TABLA_3_5.cs) };
}

/**
 * Altura tributaria de cada forjado: media planta por debajo y media por encima. La banda entre la
 * rasante y la mitad de la primera planta va a la cimentación; el de arriba sólo recibe la mitad
 * de abajo (petos y casetones, a mano). Las alturas, sobre la rasante, ordenadas y crecientes.
 */
export function alturasTributarias(alturas: readonly number[]): number[] {
  return alturas.map((h, i) => {
    const inferior = (h - (i === 0 ? 0 : alturas[i - 1]!)) / 2;
    const superior = i === alturas.length - 1 ? 0 : (alturas[i + 1]! - h) / 2;
    return inferior + superior;
  });
}
