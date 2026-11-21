// Factor de flecha DIFERIDA con sección fisurada — EC2/CE Anejo 19 §7.4.3.
//
// El solver FEM calcula la flecha elástica con la rigidez BRUTA
// B_sol = Ec_base·Ig (Ec_base = rcElasticModulusMPa, la base E del solver —
// única fuente, ver frame-core/sections.ts). Este módulo devuelve el
// multiplicador k que la convierte en la flecha diferida cuasipermanente con
// fisuración y fluencia:
//
//   δ_dif = δ_cp,solver × k
//   k = B_sol · ( ζ/B_II + (1−ζ)/B_I )
//
// que es la interpolación de deformaciones α = ζ·α_II + (1−ζ)·α_I del
// §7.4.3(3) aplicada a la flecha (interpolación de FLEXIBILIDADES), con:
//   - B_I  = Ec_eff·Ig      (estado bruto SIN homogeneizar: subestima B_I
//                            ligeramente ⇒ conservador)
//   - B_II = Ec_eff·I_II    (estado fisurado, sección homogeneizada con
//                            n_eff = Es/Ec_eff; solo la armadura TRACCIONADA,
//                            misma forma que la fisuración de rcBeams —
//                            ignorar As' subestima I_II ⇒ conservador)
//   - Ec_eff = Ec_base/(1+φef)  (fluencia, §7.4.3(5))
//   - ζ = 1 − β·(Mcr/Mcp)²  con β = 0.5 (cargas mantenidas, §7.4.3(4));
//     Mcp ≤ Mcr ⇒ ζ = 0 (sin fisurar)
//   - Mcr = fctm·W_bruta = fctm·b·h²/6 (misma línea que computeMcrit del
//     módulo de sección de vigas — es local allí, se reimplementa con
//     getConcrete)
//
// Caso no fisurado: k = B_sol/B_I = (1+φef) EXACTO (los Ig cancelan) — la
// flecha elástica simplemente se difiere por fluencia. Esa exactitud es la
// razón de exigir la MISMA base E que el solver.

import { getConcrete, Es } from '../../data/materials.ts';
import { rcElasticModulusMPa } from '../frame-core/sections.ts';

export interface CrackedDeflectionParams {
  b: number;      // mm
  h: number;      // mm
  fck: number;    // MPa
  /** Armadura de la cara traccionada dominante (mm²) y su canto útil (mm). */
  As: number;
  d: number;
  /** Máx |M| cuasipermanente del miembro (kN·m) — sección más fisurada. */
  Mcp: number;
  /** Coeficiente de fluencia efectivo (típico edificación 2.0). */
  phiEf: number;
}

export interface CrackedDeflectionResult {
  /** Multiplicador sobre la flecha cuasipermanente elástica del solver. */
  k: number;
  zeta: number;
  Mcr: number;    // kN·m
  BI: number;     // N·mm² (estado bruto con fluencia)
  BII: number;    // N·mm² (estado fisurado con fluencia)
}

export function crackedDeflectionFactor(p: CrackedDeflectionParams): CrackedDeflectionResult {
  const EcBase = rcElasticModulusMPa(p.fck);
  const EcEff = EcBase / (1 + p.phiEf);
  const Ig = (p.b * Math.pow(p.h, 3)) / 12;
  const Bsol = EcBase * Ig;
  const BI = EcEff * Ig;

  const Mcr = (getConcrete(p.fck).fctm * p.b * p.h * p.h) / 6 / 1e6; // kN·m
  const zeta = p.Mcp <= Mcr ? 0 : 1 - 0.5 * Math.pow(Mcr / p.Mcp, 2);

  if (zeta === 0) {
    // Sin fisurar: k = Bsol/BI = 1+φef exacto (los Ig cancelan).
    return { k: Bsol / BI, zeta, Mcr, BI, BII: BI };
  }
  if (p.As <= 0) {
    // Fisurada sin armadura de tracción: el estado II no existe — el caller
    // trata k = ∞ como fail (en la práctica as-min falla antes).
    return { k: Infinity, zeta, Mcr, BI, BII: 0 };
  }

  // Fibra neutra del estado II homogeneizado (misma ecuación que la
  // fisuración de rcBeams: 0.5·b·x² + n·As·x − n·As·d = 0, solo As tracción).
  const nEff = Es / EcEff;
  const A = 0.5 * p.b;
  const B = nEff * p.As;
  const C = -nEff * p.As * p.d;
  const xII = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
  const III = (p.b * Math.pow(xII, 3)) / 3 + nEff * p.As * Math.pow(p.d - xII, 2);
  const BII = EcEff * III;

  const k = Bsol * (zeta / BII + (1 - zeta) / BI);
  return { k, zeta, Mcr, BI, BII };
}
