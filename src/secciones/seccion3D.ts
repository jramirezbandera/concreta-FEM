/**
 * Secciones de barra 3D (E2): A, Iy, Iz, J y áreas de cortante Avy, Avz en m, con E y G en kN/m²
 * (D1). Es la `seccion3D()` que pedían H33 y el área 8: lo que `frame-core/sections` de Concreta
 * no da (Iy, Iz, J y áreas de cortante).
 *
 * Ejes (los del motor, H02): el canto h va según z local, así que Iy es siempre la inercia del eje
 * fuerte (la de `MEdy` en los módulos) e Iz la del débil; Avz es el área de cortante según el
 * canto.
 *
 * Áreas de cortante: las de CSI (SAP2000/ETABS), para que la comparación con esos programas no
 * falle por hipótesis: rectángulo 5/6·A; círculo 0,9·A; perfil en I, alma por canto total (h·tw)
 * según z y 5/3·b·tf según y; T, alma por canto total según z y 5/6 del ala según y.
 */
import type { SeccionBarra } from "../elementos/barra.ts";

export interface Material {
  /** Módulo de elasticidad, kN/m². */
  E: number;
  /** Módulo de cortante, kN/m². */
  G: number;
}

/**
 * Hormigón con el E que usa el solver de Concreta: 8500·∛(fck + 8) MPa (copiado de
 * `src/lib/frame-core/sections.ts`, `rcElasticModulusMPa`, de wh0am1-dev/concreta), y ν = 0,2.
 */
export function hormigon(fck: number, nu = 0.2): Material {
  const E = 8500 * Math.cbrt(fck + 8) * 1e3;
  return { E, G: E / (2 * (1 + nu)) };
}

/** Acero estructural: E = 210 000 MPa y ν = 0,3. */
export function acero(E_MPa = 210000, nu = 0.3): Material {
  const E = E_MPa * 1e3;
  return { E, G: E / (2 * (1 + nu)) };
}

/**
 * Constante de torsión de Saint-Venant de un rectángulo a×b (serie exacta de Timoshenko y
 * Goodier, *Theory of Elasticity*, §109): J = a·b³·[1/3 − (64/π⁵)·(b/a)·Σ tanh(nπa/2b)/n⁵], n
 * impar, con a ≥ b. La serie de 1/n⁵ converge despacio, así que se suma exacta,
 * Σ 1/n⁵ = (31/32)·ζ(5), y sólo se itera Σ (tanh − 1)/n⁵, que decae como e^(−nπ).
 */
export function torsionRectangulo(a: number, b: number): number {
  const [l, c] = a >= b ? [a, b] : [b, a];
  let s = SUMA_IMPARES_N5;
  for (let n = 1; n <= 15; n += 2) s -= 2 / ((Math.exp((n * Math.PI * l) / c) + 1) * n ** 5);
  return l * c ** 3 * (1 / 3 - (64 / Math.PI ** 5) * (c / l) * s);
}

/** Σ 1/n⁵ con n impar = (1 − 2⁻⁵)·ζ(5). */
const SUMA_IMPARES_N5 = (31 / 32) * 1.0369277551433699263;

/** Rectángulo de ancho b (según y) y canto h (según z), en m. */
export function rectangular(b: number, h: number, mat: Material): SeccionBarra {
  const A = b * h;
  return { E: mat.E, G: mat.G, A, Iy: (b * h ** 3) / 12, Iz: (h * b ** 3) / 12, J: torsionRectangulo(b, h), Avy: (5 / 6) * A, Avz: (5 / 6) * A };
}

/** Círculo macizo de diámetro D, en m. */
export function circular(D: number, mat: Material): SeccionBarra {
  const A = (Math.PI * D ** 2) / 4;
  const I = (Math.PI * D ** 4) / 64;
  return { E: mat.E, G: mat.G, A, Iy: I, Iz: I, J: 2 * I, Avy: 0.9 * A, Avz: 0.9 * A };
}

export interface SeccionT {
  seccion: SeccionBarra;
  /** Distancia del centro de gravedad a la fibra inferior (la del alma), m. */
  zg: number;
}

/**
 * Sección en T con el ala arriba (+z): ala bf×hf y alma bw de canto total h, en m. Es la T bruta
 * de una vigueta (D2). J es la suma de los dos rectángulos con la serie exacta (sin la mejora de
 * la unión, del lado de la flexibilidad); el eje de la barra pasa por el centro de gravedad, así
 * que el compilador da el punto de inserción con `zg`.
 */
export function seccionT(bf: number, hf: number, bw: number, h: number, mat: Material): SeccionT {
  const ha = h - hf;
  const Aa = bf * hf;
  const Aw = bw * ha;
  const A = Aa + Aw;
  const zg = (Aw * (ha / 2) + Aa * (ha + hf / 2)) / A;
  const Iy = (bf * hf ** 3) / 12 + Aa * (ha + hf / 2 - zg) ** 2 + (bw * ha ** 3) / 12 + Aw * (ha / 2 - zg) ** 2;
  const Iz = (hf * bf ** 3) / 12 + (ha * bw ** 3) / 12;
  const J = torsionRectangulo(bf, hf) + torsionRectangulo(bw, ha);
  return { seccion: { E: mat.E, G: mat.G, A, Iy, Iz, J, Avy: (5 / 6) * Aa, Avz: bw * h }, zg };
}

/**
 * Perfil de acero en I o H del catálogo de Concreta, en sus unidades (`src/data/steelProfiles.ts`:
 * A en cm², Iy, Iz e It en cm⁴; h, b, tf y tw en mm). Iy es el eje fuerte (canto según z).
 */
export interface PerfilCatalogo {
  A: number;
  Iy: number;
  Iz: number;
  It: number;
  h: number;
  b: number;
  tf: number;
  tw: number;
}

export function perfilI(p: PerfilCatalogo, mat: Material = acero()): SeccionBarra {
  const mm = 1e-3;
  return {
    E: mat.E,
    G: mat.G,
    A: p.A * 1e-4,
    Iy: p.Iy * 1e-8,
    Iz: p.Iz * 1e-8,
    J: p.It * 1e-8,
    Avy: (5 / 3) * p.b * mm * p.tf * mm,
    Avz: p.h * mm * p.tw * mm,
  };
}
