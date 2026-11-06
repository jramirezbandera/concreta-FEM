/**
 * NCSE-02 (RD 997/2002), lo que usa el motor (fase VS, `docs/fem3d/viento-sismo.md`). La norma va
 * en su módulo para poder añadir otra (la NCSR-23, si se aprueba) sin tocar el cálculo (VS-a).
 *
 * VS2: las masas del artículo 3.2. VS3: el emplazamiento y el espectro (capítulo 2 y art. 3.6.2.2),
 * al final, y el método simplificado (3.7) para contrastar.
 *
 * **Art. 3.2, «Masas que intervienen en el cálculo»** (p. 21 del texto de la norma): «se
 * considerarán las masas correspondientes a la propia estructura, las masas permanentes, y una
 * fracción de las restantes masas —siempre que éstas tengan un efecto desfavorable sobre la
 * estructura— de valor:
 * - para sobrecargas de uso en viviendas, hoteles y residencias: 0,5
 * - para sobrecargas de uso en edificios públicos, oficinas y comercios: 0,6
 * - para sobrecargas de uso en locales de aglomeración y espectáculos: 0,6
 * - para sobrecarga de nieve, siempre que ésta permanezca más de 30 días al año: 0,5
 * - para sobrecargas de uso en almacenes, archivos, etc.: 1,0
 * - para sobrecarga de tabiquería: 1,0
 * - para piscinas o grandes depósitos de agua: 1,0».
 *
 * No es el ψ₂ del CTE: estas fracciones dicen qué masa se sacude; qué gravedad actúa a la vez que el
 * sismo lo dicen las combinaciones (art. 3.4).
 */
import type { PsiNombrado } from "../combinaciones/psi.ts";

/** Fracción de una carga permanente (la estructura, las permanentes y la tabiquería): entera. */
export const FRACCION_MASA_PERMANENTE = 1;

/** Fracción de la nieve que permanece más de 30 días al año (y nada de la que no). */
export const FRACCION_MASA_NIEVE = 0.5;

/**
 * Fracción de la sobrecarga de uso por su categoría del DB SE-AE (tabla 3.1), que es como se nombra
 * el ψ de un caso (decisión VS-d):
 * - A (zonas residenciales: viviendas, hoteles, residencias), 0,5;
 * - B (administrativas: oficinas), C (acceso al público: los locales de aglomeración) y D
 *   (comerciales), 0,6;
 * - E (tráfico y aparcamiento) y G (cubiertas accesibles sólo para conservación) no están en la
 *   norma: 0,6 y 0, los ψ₂ del Eurocódigo 8 para esas categorías.
 *
 * Los almacenes y archivos (1,0) no tienen categoría en el DB SE-AE: su fracción se escribe.
 */
export const FRACCION_MASA_USO: Readonly<Record<Extract<PsiNombrado, `uso-${string}`>, number>> = {
  "uso-A": 0.5,
  "uso-B": 0.6,
  "uso-C": 0.6,
  "uso-D": 0.6,
  "uso-E": 0.6,
  "uso-G": 0,
};

/** Las dos de la lista que salen de la norma tal cual; las otras (E y G) son una decisión, y la hipótesis lo dice. */
export const USOS_FUERA_DE_LA_NORMA: readonly PsiNombrado[] = ["uso-E", "uso-G"];

// ─── VS3: el emplazamiento y el espectro (capítulo 2 y art. 3.6.2.2) ────────────────────────────
//
// Copiado de Concreta (`src/lib/codes/seismic/ncse02.ts`: el coeficiente del terreno ponderado, la
// amplificación S, ac, TA, TB, ν y el espectro elástico), con el texto de la norma delante. El
// coeficiente αᵢ del análisis por espectros (3.6.2.2) no está allí: Concreta lleva el del método
// simplificado (3.7.3), que no tiene rama ascendente, y avisa de que no son la misma función.
//
// ab y ac van aquí en múltiplos de g, como en el mapa y en Concreta: `ab = 0,11` es 0,11 g.

/** Tipo de terreno del art. 2.4. */
export type TipoTerreno = "I" | "II" | "III" | "IV";

/** Tabla 2.1: coeficiente C de cada tipo de terreno. */
export const COEFICIENTE_TERRENO: Readonly<Record<TipoTerreno, number>> = { I: 1.0, II: 1.3, III: 1.6, IV: 2.0 };

/** Art. 2.2: coeficiente de riesgo ρ por la importancia de la construcción (1.2.2). */
export const COEFICIENTE_RIESGO = { normal: 1.0, especial: 1.3 } as const;
export type Importancia = keyof typeof COEFICIENTE_RIESGO;

/** Art. 2.4: C se pondera en los 30 primeros metros bajo la superficie. */
export const ESPESOR_PONDERACION = 30;

/** Un estrato del perfil del terreno: su coeficiente C y su espesor, m. */
export interface Estrato {
  C: number;
  espesor: number;
}

/**
 * Art. 2.4: C = Σ Cᵢ·eᵢ / 30, con los estratos de arriba abajo. Si el perfil no llega a 30 m, el
 * último estrato se prolonga (dejar el hueco a cero daría un C bajo, del lado inseguro).
 */
export function coeficienteTerrenoPonderado(estratos: readonly Estrato[]): number {
  if (!estratos.length) return COEFICIENTE_TERRENO.I;
  let restante = ESPESOR_PONDERACION;
  let acumulado = 0;
  for (const e of estratos) {
    if (restante <= 0) break;
    const tramo = Math.min(Math.max(e.espesor, 0), restante);
    acumulado += e.C * tramo;
    restante -= tramo;
  }
  if (restante > 0) acumulado += estratos[estratos.length - 1]!.C * restante;
  return acumulado / ESPESOR_PONDERACION;
}

/**
 * Art. 2.2: coeficiente de amplificación del terreno S, con ρ·ab en g:
 * - ρ·ab ≤ 0,1 g: S = C/1,25;
 * - 0,1 g < ρ·ab < 0,4 g: S = C/1,25 + 3,33·(ρ·ab/g − 0,1)·(1 − C/1,25);
 * - 0,4 g ≤ ρ·ab: S = 1,0.
 */
export function amplificacionTerreno(C: number, rho: number, ab: number): number {
  const rab = rho * ab;
  if (rab <= 0.1) return C / 1.25;
  if (rab < 0.4) return C / 1.25 + 3.33 * (rab - 0.1) * (1 - C / 1.25);
  return 1.0;
}

export interface Emplazamiento {
  /** Aceleración sísmica básica, en g, y coeficiente de contribución (art. 2.1, anejo 1). */
  ab: number;
  K: number;
  rho: number;
  C: number;
  S: number;
  /** Aceleración sísmica de cálculo, en g: ac = S·ρ·ab (art. 2.2). */
  ac: number;
  /** Periodos característicos del espectro, s: TA = K·C/10 y TB = K·C/2,5 (art. 2.3). */
  TA: number;
  TB: number;
}

/** El emplazamiento (cap. 2): S, ac, TA y TB. */
export function emplazamiento(ab: number, K: number, rho: number, C: number): Emplazamiento {
  const S = amplificacionTerreno(C, rho, ab);
  return { ab, K, rho, C, S, ac: S * rho * ab, TA: (K * C) / 10, TB: (K * C) / 2.5 };
}

/** Art. 2.5: ν = (5/Ω)^0,4, con Ω el amortiguamiento en % del crítico. */
export function factorAmortiguamiento(omega: number): number {
  return Math.pow(5 / omega, 0.4);
}

/** Por encima de este C, el espectro puede no valer con el periodo fundamental mayor que TB (art. 2.4). */
export const C_MESETA_LARGA = 1.8;

/**
 * Art. 2.3: espectro normalizado de respuesta elástica (5 % de amortiguamiento):
 * α(T) = 1 + 1,5·T/TA si T < TA; 2,5 si TA ≤ T ≤ TB; K·C/T si T > TB (que es 2,5·TB/T).
 *
 * `mesetaLarga` (art. 2.4): «en aquellos casos especiales en que resulte C > 1,8, el espectro […]
 * puede no ser aplicable a las construcciones con período fundamental mayor de TB. En este caso, para
 * T > TB se tomará α(T) = 2,5».
 */
export function espectroElastico(T: number, TA: number, TB: number, mesetaLarga = false): number {
  if (T < TA) return 1 + (1.5 * T) / TA;
  if (T <= TB || mesetaLarga) return 2.5;
  return (2.5 * TB) / T;
}

/**
 * Art. 3.6.2.2: coeficiente αᵢ del modo de periodo T en el análisis por espectros de respuesta, con
 * β = ν/μ:
 * - αᵢ = α(Tᵢ)·β si Tᵢ ≥ TA;
 * - αᵢ = 1 + (2,5·β − 1)·Tᵢ/TA si Tᵢ ≤ TA.
 *
 * La aceleración del modo en el grado de libertad j es αᵢ·ηᵢⱼ·ac. **La rama ascendente no es
 * β·(1 + 1,5·T/TA):** va de 1 (un modo muy rígido se mueve con el suelo: ni la ductilidad ni el
 * amortiguamiento lo reducen) a 2,5·β en TA, que es la interpolación del art. 2.5 con la ductilidad
 * dentro. Con β < 1 queda por encima de la otra, y con periodos cortos (las plantas rígidas) pesa.
 * No es la α del método simplificado (3.7.3), que se queda en 2,5 por debajo de TB.
 */
export function coeficienteModal(T: number, TA: number, TB: number, beta: number, mesetaLarga = false): number {
  if (T >= TA) return espectroElastico(T, TA, TB, mesetaLarga) * beta;
  return 1 + ((2.5 * beta - 1) * T) / TA;
}

/** Art. 3.8: los efectos de segundo orden se pueden despreciar si en cada planta Pk·dk < 0,10·Vk·hk. */
export const LIMITE_SEGUNDO_ORDEN = 0.1;
/** Art. 3.8: y tampoco hay que considerarlos mientras el desplazamiento máximo no pase del 2 ‰ de la altura. */
export const DESPLAZAMIENTO_SIN_SEGUNDO_ORDEN = 0.002;

/** Art. 3.2: excentricidad adicional de las masas, «no menor de 1/20 de la mayor dimensión de la planta en el sentido perpendicular a la dirección del sismo». */
export const EXCENTRICIDAD_ACCIDENTAL = 1 / 20;

// ─── VS3: el método simplificado (art. 3.7), sólo para contrastar ───────────────────────────────
//
// También de Concreta, lo justo para el cortante en la base: el periodo fundamental aproximado
// (3.7.2.2), el número de modos (3.7.2.1), sus periodos y sus formas (3.7.3.2) y la raíz de la suma
// de los cuadrados de los cortantes de planta (3.7.4). No se calcula con él (VS-j): sale al lado del
// análisis por espectros, que es el método de referencia (3.5), cuando el edificio lo admite (3.5.1).

/** Sistemas estructurales con expresión de T_F en el art. 3.7.2.2. */
export type SistemaEstructural = "fabrica" | "porticos-ha" | "porticos-ha-pantallas" | "porticos-acero" | "acero-triangulado";
export const SISTEMAS_ESTRUCTURALES: readonly SistemaEstructural[] = ["fabrica", "porticos-ha", "porticos-ha-pantallas", "porticos-acero", "acero-triangulado"];

/**
 * Art. 3.7.2.2: periodo fundamental aproximado, s. n, plantas sobre rasante; H, altura sobre rasante;
 * L, dimensión en planta en el sentido de la oscilación (fábrica); B, la de las pantallas o
 * triangulaciones en ese sentido. null si la expresión no se puede evaluar.
 */
export function periodoFundamental(sistema: SistemaEstructural, g: { n: number; H: number; L: number; B: number }): number | null {
  const { n, H, L, B } = g;
  switch (sistema) {
    case "fabrica":
      return L > 0 && H > 0 ? (0.06 * H * Math.sqrt(H / (2 * L + H))) / Math.sqrt(L) : null;
    case "porticos-ha":
      return 0.09 * n;
    case "porticos-ha-pantallas":
      return B + H > 0 ? 0.07 * n * Math.sqrt(H / (B + H)) : null;
    case "porticos-acero":
      return 0.11 * n;
    case "acero-triangulado":
      return B + H > 0 ? 0.085 * n * Math.sqrt(H / (B + H)) : null;
  }
}

/** Art. 3.7.2.1: modos a considerar por el periodo fundamental. */
export function modosSimplificado(TF: number): 1 | 2 | 3 {
  return TF <= 0.75 ? 1 : TF <= 1.25 ? 2 : 3;
}

export interface Simplificado {
  TF: number;
  modos: number;
  /** Cortante combinado bajo cada planta (en el orden dado) y el de la base, kN. */
  cortantes: number[];
  basal: number;
}

/**
 * Art. 3.7.3 y 3.7.4: los cortantes del método simplificado con el periodo fundamental TF, para unas
 * plantas de altura sobre rasante h (m) y peso sísmico P (kN), de abajo arriba. Tᵢ = TF/(2i − 1);
 * Φᵢₖ = sen[(2i − 1)·π·hₖ/(2H)]; ηᵢₖ = Φᵢₖ·Σ(P·Φ)/Σ(P·Φ²); sᵢₖ = ac·αᵢ·β·ηᵢₖ, con αᵢ = 2,5 si
 * Tᵢ ≤ TB y 2,5·TB/Tᵢ si no (sin rama ascendente); Fᵢₖ = sᵢₖ·Pₖ. `ac`, en g.
 */
export function simplificado(plantas: readonly { h: number; P: number }[], TF: number, H: number, ac: number, beta: number, TB: number): Simplificado {
  const modos = modosSimplificado(TF);
  const n = plantas.length;
  const V2 = new Array<number>(n).fill(0);
  for (let i = 1; i <= modos; i++) {
    const T = TF / (2 * i - 1);
    const alfa = T <= TB ? 2.5 : (2.5 * TB) / T;
    const Phi = plantas.map((p) => Math.sin(((2 * i - 1) * Math.PI * p.h) / (2 * H)));
    let [num, den] = [0, 0];
    plantas.forEach((p, k) => {
      num += p.P * Phi[k]!;
      den += p.P * Phi[k]! * Phi[k]!;
    });
    const F = plantas.map((p, k) => (den > 0 ? ac * alfa * beta * ((Phi[k]! * num) / den) * p.P : 0));
    let acumulado = 0;
    for (let k = n - 1; k >= 0; k--) {
      acumulado += F[k]!;
      V2[k]! += acumulado * acumulado;
    }
  }
  const cortantes = V2.map(Math.sqrt);
  return { TF, modos, cortantes, basal: cortantes[0] ?? 0 };
}
