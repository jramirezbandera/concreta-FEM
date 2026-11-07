/**
 * La nieve del DB SE-AE (art. 3.5 y Anejo E): lo que sale del emplazamiento, no dónde va la carga.
 *
 *   qn = μ · sk                                                      (3.2)
 *
 * sk sale de la tabla 3.8 si la obra está en la capital de la provincia y si no de la E.2, por la
 * zona de clima invernal (figura E.2) y la altitud, interpolando entre filas (D-VN2 de Concreta);
 * el factor de exposición del art. 3.5.1-3 la sube o la baja un 20 %. El coeficiente de forma μ
 * del faldón (art. 3.5.3-2), 1 hasta 30° y 0 desde 60°.
 *
 * Copiado de Concreta (`src/lib/acciones/tablasAE.ts`, `nieve.ts` e `interp.ts`, commit f6afb7d;
 * citado en `NOTICE`): las tablas E.2 y 3.8, los factores y las funciones de sk y de μ. No se copian
 * los faldones, las limahoyas, la acumulación ni el hielo: dónde va la nieve lo decide el usuario
 * (decisión del usuario, 2026-11-07), y aquí sólo se da el valor.
 */

export type ZonaInvernal = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const ZONAS_INVERNALES: readonly ZonaInvernal[] = [1, 2, 3, 4, 5, 6, 7];

/** Altitudes (m) de las filas de la tabla E.2. */
export const ALTITUDES_TABLA_E2: readonly number[] = [0, 200, 400, 500, 600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2200];

/**
 * Tabla E.2 (p. 46): sobrecarga de nieve en un terreno horizontal, kN/m², por zona de clima
 * invernal y altitud. null = guion en la tabla: altitud no tabulada para esa zona (art. 3.5.2-3:
 * ordenanza municipal o datos empíricos).
 */
export const TABLA_E2: Readonly<Record<ZonaInvernal, readonly (number | null)[]>> = {
  1: [0.3, 0.5, 0.6, 0.7, 0.9, 1.0, 1.2, 1.4, 1.7, 2.3, 3.2, 4.3, null, null],
  2: [0.4, 0.5, 0.6, 0.7, 0.9, 1.0, 1.1, 1.3, 1.5, 2.0, 2.6, 3.5, 4.6, 8.0],
  3: [0.2, 0.2, 0.2, 0.3, 0.3, 0.4, 0.5, 0.6, 0.7, 1.1, 1.7, 2.6, 4.0, null],
  4: [0.2, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.2, 1.9, 3.0, 4.6, null, null],
  5: [0.2, 0.3, 0.4, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.3, 1.8, 2.5, null, null],
  6: [0.2, 0.2, 0.2, 0.3, 0.4, 0.5, 0.7, 0.9, 1.2, 2.0, 3.3, 5.5, 9.3, null],
  7: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, null],
};

export interface CapitalNieve {
  capital: string;
  /** Altitud de la capital según la tabla, m. */
  altitud: number;
  /** Sobrecarga de nieve sobre terreno horizontal, kN/m². */
  sk: number;
}

/**
 * Tabla 3.8 (p. 15): sobrecarga de nieve en capitales de provincia y ciudades autónomas, por el
 * código INE de la provincia. Ceuta y Melilla comparten fila en la norma.
 */
export const TABLA_3_8: Readonly<Record<string, CapitalNieve>> = {
  "01": { capital: "Vitoria / Gasteiz", altitud: 520, sk: 0.7 },
  "02": { capital: "Albacete", altitud: 690, sk: 0.6 },
  "03": { capital: "Alicante / Alacant", altitud: 0, sk: 0.2 },
  "04": { capital: "Almería", altitud: 0, sk: 0.2 },
  "05": { capital: "Ávila", altitud: 1130, sk: 1.0 },
  "06": { capital: "Badajoz", altitud: 180, sk: 0.2 },
  "07": { capital: "Palma de Mallorca", altitud: 0, sk: 0.2 },
  "08": { capital: "Barcelona", altitud: 0, sk: 0.4 },
  "09": { capital: "Burgos", altitud: 860, sk: 0.6 },
  "10": { capital: "Cáceres", altitud: 440, sk: 0.4 },
  "11": { capital: "Cádiz", altitud: 0, sk: 0.2 },
  "12": { capital: "Castellón", altitud: 0, sk: 0.2 },
  "13": { capital: "Ciudad Real", altitud: 640, sk: 0.6 },
  "14": { capital: "Córdoba", altitud: 100, sk: 0.2 },
  "15": { capital: "Coruña / A Coruña", altitud: 0, sk: 0.3 },
  "16": { capital: "Cuenca", altitud: 1010, sk: 1.0 },
  "17": { capital: "Gerona / Girona", altitud: 70, sk: 0.4 },
  "18": { capital: "Granada", altitud: 690, sk: 0.5 },
  "19": { capital: "Guadalajara", altitud: 680, sk: 0.6 },
  "20": { capital: "San Sebastián / Donostia", altitud: 0, sk: 0.3 },
  "21": { capital: "Huelva", altitud: 0, sk: 0.2 },
  "22": { capital: "Huesca", altitud: 470, sk: 0.7 },
  "23": { capital: "Jaén", altitud: 570, sk: 0.4 },
  "24": { capital: "León", altitud: 820, sk: 1.2 },
  "25": { capital: "Lérida / Lleida", altitud: 150, sk: 0.5 },
  "26": { capital: "Logroño", altitud: 380, sk: 0.6 },
  "27": { capital: "Lugo", altitud: 470, sk: 0.7 },
  "28": { capital: "Madrid", altitud: 660, sk: 0.6 },
  "29": { capital: "Málaga", altitud: 0, sk: 0.2 },
  "30": { capital: "Murcia", altitud: 40, sk: 0.2 },
  "31": { capital: "Pamplona / Iruña", altitud: 450, sk: 0.7 },
  "32": { capital: "Orense / Ourense", altitud: 130, sk: 0.4 },
  "33": { capital: "Oviedo", altitud: 230, sk: 0.5 },
  "34": { capital: "Palencia", altitud: 740, sk: 0.4 },
  "35": { capital: "Las Palmas", altitud: 0, sk: 0.2 },
  "36": { capital: "Pontevedra", altitud: 0, sk: 0.3 },
  "37": { capital: "Salamanca", altitud: 780, sk: 0.5 },
  "38": { capital: "Tenerife", altitud: 0, sk: 0.2 },
  "39": { capital: "Santander", altitud: 0, sk: 0.3 },
  "40": { capital: "Segovia", altitud: 1000, sk: 0.7 },
  "41": { capital: "Sevilla", altitud: 10, sk: 0.2 },
  "42": { capital: "Soria", altitud: 1090, sk: 0.9 },
  "43": { capital: "Tarragona", altitud: 0, sk: 0.4 },
  "44": { capital: "Teruel", altitud: 950, sk: 0.9 },
  "45": { capital: "Toledo", altitud: 550, sk: 0.5 },
  "46": { capital: "Valencia / València", altitud: 0, sk: 0.2 },
  "47": { capital: "Valladolid", altitud: 690, sk: 0.4 },
  "48": { capital: "Bilbao / Bilbo", altitud: 0, sk: 0.3 },
  "49": { capital: "Zamora", altitud: 650, sk: 0.4 },
  "50": { capital: "Zaragoza", altitud: 210, sk: 0.5 },
  "51": { capital: "Ceuta", altitud: 0, sk: 0.2 },
  "52": { capital: "Melilla", altitud: 0, sk: 0.2 },
};

/** Art. 3.5.1-1: en cubiertas planas de edificios de pisos por debajo de 1 000 m basta 1,0 kN/m². */
export const NIEVE_PLANA_SIMPLIFICADA = { carga: 1.0, altitudMax: 1000 } as const;

export type ExposicionNieve = "normal" | "protegida" | "expuesta";

/** Art. 3.5.1-3: protegida de la acción del viento, −20 %; fuertemente expuesta, +20 %. */
export const FACTOR_EXPOSICION_NIEVE: Readonly<Record<ExposicionNieve, number>> = { normal: 1.0, protegida: 0.8, expuesta: 1.2 };

/** Art. 3.5.3-2: μ = 1 hasta 30° de inclinación y 0 desde 60°, lineal entre medias. */
export const MU_FALDON = { inclinacionMu1: 30, inclinacionMu0: 60 } as const;

/** Art. 3.5.1-4: por encima de 1 000 m, los voladizos llevan además el hielo, pn = 3·μ²·sk. */
export const HIELO_VOLADIZOS = { altitudMin: 1000, k: 3 } as const;

/** Por encima de esta altitud, el ψ de la nieve es el de «más de 1 000 m» (DB SE, tabla 4.2). */
export const ALTITUD_NIEVE_ALTA = 1000;

/** Interpolación lineal; fuera del rango, el extremo (la regla de las tablas de la norma). */
export function interpolar(x: number, xs: readonly number[], ys: readonly number[]): number {
  if (x <= xs[0]!) return ys[0]!;
  const n = xs.length;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  let i = 1;
  while (xs[i]! < x) i++;
  const t = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
  return ys[i - 1]! + t * (ys[i]! - ys[i - 1]!);
}

/** Tabla E.2 interpolada en altitud; null si queda por encima de lo tabulado para la zona (art. 3.5.2-3). */
export function cargaNieveTerreno(zona: ZonaInvernal, altitud: number): number | null {
  const xs: number[] = [];
  const ys: number[] = [];
  TABLA_E2[zona].forEach((sk, i) => {
    if (sk !== null) {
      xs.push(ALTITUDES_TABLA_E2[i]!);
      ys.push(sk);
    }
  });
  if (altitud > xs[xs.length - 1]!) return null;
  return interpolar(altitud, xs, ys);
}

/** Art. 3.5.3-2: μ del faldón por su inclinación (grados), o 1 si algo impide deslizar. */
export function coeficienteForma(inclinacion: number, impedimento = false): number {
  if (impedimento) return 1;
  return interpolar(inclinacion, [MU_FALDON.inclinacionMu1, MU_FALDON.inclinacionMu0], [1, 0]);
}
