/**
 * Solución de Navier de una placa rectangular de Mindlin (FSDT) ortótropa, simplemente apoyada en
 * los cuatro bordes con el giro tangente coartado («hard»), con carga uniforme. No es código del
 * motor: es la referencia analítica de la flexión ortótropa de E3 (m11 ≠ m22, v13 ≠ v23).
 *
 * Reddy, Mechanics of Laminated Composite Plates and Shells (2.ª ed.), §6.2 (placas
 * especialmente ortótropas). Con w = Σ W·sin αx·sin βy, φx = Σ X·cos αx·sin βy y
 * φy = Σ Y·sin αx·cos βy (α = mπ/a, β = nπ/b; u = z·φx, v = z·φy), cada término cumple
 *
 *   [K55α² + K44β²   K55α                 K44β               ] [W]   [q_mn]
 *   [K55α            D11α² + D66β² + K55  (D12 + D66)αβ      ] [X] = [0   ]
 *   [K44β            (D12 + D66)αβ        D66α² + D22β² + K44] [Y]   [0   ]
 *
 * con K55 = rigidez a cortante en xz y K44 en yz, y q_mn = 16q/(π²mn) para m y n impares. Las
 * resultantes salen con el convenio del motor (Mx = −∫z·σx, Qx = ∫τxz): Mx = (D11αX + D12βY)·sin·sin,
 * My = (D12αX + D22βY)·sin·sin, Mxy = −D66(βX + αY)·cos·cos, Qx = K55(X + αW)·cos·sin,
 * Qy = K44(Y + βW)·sin·cos. Las ecuaciones se han deducido de nuevo de las de equilibrio de Mindlin
 * (Qx,x + Qy,y + q = 0; Mx,x + Mxy,y = Qx; Mxy,x + My,y = Qy, en el convenio de ∫z·σ).
 */

export interface PlacaOrtotropa {
  a: number;
  b: number;
  /** Carga uniforme según +z, kN/m². */
  q: number;
  D11: number;
  D22: number;
  D12: number;
  D66: number;
  /** Rigideces a cortante en xz (K55) y en yz (K44), kN/m. */
  K55: number;
  K44: number;
}

/** [w, Mx, My, Mxy, Qx, Qy] en (x, y), sumando los términos impares hasta `terminos`. */
export function navierMindlin(p: PlacaOrtotropa, x: number, y: number, terminos = 301): [number, number, number, number, number, number] {
  const r: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  for (let m = 1; m <= terminos; m += 2) {
    const al = (m * Math.PI) / p.a;
    const sx = Math.sin(al * x);
    const cx = Math.cos(al * x);
    for (let n = 1; n <= terminos; n += 2) {
      const be = (n * Math.PI) / p.b;
      const qmn = (16 * p.q) / (Math.PI * Math.PI * m * n);
      const s11 = p.K55 * al * al + p.K44 * be * be;
      const s12 = p.K55 * al;
      const s13 = p.K44 * be;
      const s22 = p.D11 * al * al + p.D66 * be * be + p.K55;
      const s23 = (p.D12 + p.D66) * al * be;
      const s33 = p.D66 * al * al + p.D22 * be * be + p.K44;
      // Cramer sobre la matriz simétrica 3×3
      const det = s11 * (s22 * s33 - s23 * s23) - s12 * (s12 * s33 - s23 * s13) + s13 * (s12 * s23 - s22 * s13);
      const W = (qmn * (s22 * s33 - s23 * s23)) / det;
      const X = (-qmn * (s12 * s33 - s13 * s23)) / det;
      const Y = (qmn * (s12 * s23 - s13 * s22)) / det;
      const sy = Math.sin(be * y);
      const cy = Math.cos(be * y);
      r[0] += W * sx * sy;
      r[1] += (p.D11 * al * X + p.D12 * be * Y) * sx * sy;
      r[2] += (p.D12 * al * X + p.D22 * be * Y) * sx * sy;
      r[3] += -p.D66 * (be * X + al * Y) * cx * cy;
      r[4] += p.K55 * (X + al * W) * cx * sy;
      r[5] += p.K44 * (Y + be * W) * sx * cy;
    }
  }
  return r;
}
