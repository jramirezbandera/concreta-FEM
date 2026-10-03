/**
 * Barra 3D de Timoshenko (12 GDL) con offsets rígidos, liberaciones por condensación estática y
 * modificadores de rigidez (fase E2).
 *
 * Geometría:
 * - Los offsets son vectores rígidos en ejes globales desde cada nudo hasta el extremo del tramo
 *   flexible: i' = i + dᵢ, j' = j + dⱼ. Sirven para las zonas rígidas en los extremos (offset a lo
 *   largo del eje) y para el punto de inserción (offset lateral, viga descolgada). Cinemática del
 *   sólido rígido: u' = u + θ × d, θ' = θ (Wilson, *3D Static and Dynamic Analysis*, cap. 7).
 * - Ejes locales del tramo flexible: x = i'→j'; z según el vector de referencia `vz` proyectado
 *   (la dirección del canto, H02); y = z × x. GDL por extremo: [ux, uy, uz, rx, ry, rz].
 *
 * Formulación (Przemieniecki, *Theory of Matrix Structural Analysis*, 1968, §5.6):
 * - Plano x-y (flexión alrededor de z): v' = θz + γxy, θz' = Mz/(E·Iz), Vy = G·Avy·γxy,
 *   Φy = 12·E·Iz/(G·Avy·L²).
 * - Plano x-z (flexión alrededor de y): w' = −θy + γxz, θy' = −My/(E·Iy), Vz = G·Avz·γxz,
 *   Φz = 12·E·Iy/(G·Avz·L²).
 * - Sin área de cortante (Av ausente), Φ = 0: Euler–Bernoulli. Torsión de Saint-Venant (G·J).
 * Los signos de los esfuerzos (My, Mz, Vy, Vz…) son los de la cabecera de `motor/modelo.ts`.
 *
 * Liberaciones: en ejes locales, en los extremos del tramo flexible. La rigidez local se separa
 * en cuatro subsistemas independientes (axil, torsión y los dos planos de flexión) y cada uno se
 * condensa por separado. Un juego de liberaciones es inestable si deja un modo de sólido rígido
 * del subsistema dentro de los GDL liberados (las reglas de CSI: axil, torsor o un cortante
 * liberados en los dos extremos; un momento en los dos extremos junto con su cortante en uno).
 */

export interface SeccionBarra {
  E: number;
  G: number;
  A: number;
  /** Inercia para la flexión alrededor del eje local y (canto según z), m⁴. */
  Iy: number;
  /** Inercia para la flexión alrededor del eje local z, m⁴. */
  Iz: number;
  J: number;
  /** Área de cortante según y local, m². Ausente: sin deformación por cortante en el plano x-y. */
  Avy?: number;
  /** Área de cortante según z local, m². Ausente: sin deformación por cortante en el plano x-z. */
  Avz?: number;
}

/** Multiplicadores de las propiedades de la sección (H47). Ausentes valen 1. */
export interface ModificadoresBarra {
  A?: number;
  Avy?: number;
  Avz?: number;
  J?: number;
  Iy?: number;
  Iz?: number;
}

/** Sección con los modificadores aplicados. */
export function seccionEfectiva(s: SeccionBarra, m?: ModificadoresBarra): SeccionBarra {
  if (!m) return s;
  const r: SeccionBarra = {
    E: s.E,
    G: s.G,
    A: s.A * (m.A ?? 1),
    Iy: s.Iy * (m.Iy ?? 1),
    Iz: s.Iz * (m.Iz ?? 1),
    J: s.J * (m.J ?? 1),
  };
  if (s.Avy !== undefined) r.Avy = s.Avy * (m.Avy ?? 1);
  if (s.Avz !== undefined) r.Avz = s.Avz * (m.Avz ?? 1);
  return r;
}

/** Matriz 3×3 por filas (e1, e2, e3) y longitud. u_local = R·u_global. */
export function marcoBarra(Xi: ArrayLike<number>, Xj: ArrayLike<number>, vz: ArrayLike<number>): { R: Float64Array; L: number } {
  const d = [Xj[0]! - Xi[0]!, Xj[1]! - Xi[1]!, Xj[2]! - Xi[2]!];
  const L = Math.hypot(d[0]!, d[1]!, d[2]!);
  const e1 = d.map((c) => c / L);
  const nvz = Math.hypot(vz[0]!, vz[1]!, vz[2]!);
  const p = vz[0]! * e1[0]! + vz[1]! * e1[1]! + vz[2]! * e1[2]!;
  const z = [vz[0]! - p * e1[0]!, vz[1]! - p * e1[1]!, vz[2]! - p * e1[2]!];
  const nz = Math.hypot(z[0]!, z[1]!, z[2]!);
  if (!(nz > 1e-9 * nvz)) throw new Error("el vector de referencia de la barra es paralelo a su eje");
  const e3 = z.map((c) => c / nz);
  const e2 = [e3[1]! * e1[2]! - e3[2]! * e1[1]!, e3[2]! * e1[0]! - e3[0]! * e1[2]!, e3[0]! * e1[1]! - e3[1]! * e1[0]!];
  return { R: Float64Array.of(...e1, ...e2, ...e3), L };
}

/** 1/(G·Av), o 0 si no hay área de cortante (Euler–Bernoulli). */
export function flexibilidadCortante(G: number, Av: number | undefined): number {
  return Av === undefined ? 0 : 1 / (G * Av);
}

/** Rigidez local 12×12 (por filas) del tramo flexible, sin liberaciones. */
export function rigidezBarraLocal(L: number, s: SeccionBarra): Float64Array {
  const k = new Float64Array(144);
  const pon = (i: number, j: number, v: number) => {
    k[12 * i + j] = v;
    k[12 * j + i] = v;
  };
  const EA = (s.E * s.A) / L;
  const GJ = (s.G * s.J) / L;
  pon(0, 0, EA); pon(6, 6, EA); pon(0, 6, -EA);
  pon(3, 3, GJ); pon(9, 9, GJ); pon(3, 9, -GJ);
  // Flexión en el plano x-y (alrededor de z): v, θz
  {
    const EI = s.E * s.Iz;
    const F = 12 * EI * flexibilidadCortante(s.G, s.Avy) / L ** 2;
    const a = (12 * EI) / (L ** 3 * (1 + F));
    const b = (6 * EI) / (L ** 2 * (1 + F));
    const c = ((4 + F) * EI) / (L * (1 + F));
    const e = ((2 - F) * EI) / (L * (1 + F));
    pon(1, 1, a); pon(7, 7, a); pon(1, 7, -a);
    pon(1, 5, b); pon(1, 11, b); pon(5, 7, -b); pon(7, 11, -b);
    pon(5, 5, c); pon(11, 11, c); pon(5, 11, e);
  }
  // Flexión en el plano x-z (alrededor de y): w, θy
  {
    const EI = s.E * s.Iy;
    const F = 12 * EI * flexibilidadCortante(s.G, s.Avz) / L ** 2;
    const a = (12 * EI) / (L ** 3 * (1 + F));
    const b = (6 * EI) / (L ** 2 * (1 + F));
    const c = ((4 + F) * EI) / (L * (1 + F));
    const e = ((2 - F) * EI) / (L * (1 + F));
    pon(2, 2, a); pon(8, 8, a); pon(2, 8, -a);
    pon(2, 4, -b); pon(2, 10, -b); pon(4, 8, b); pon(8, 10, b);
    pon(4, 4, c); pon(10, 10, c); pon(4, 10, e);
  }
  return k;
}

/** Rigidez en ejes globales: Tᵀ·k·T con T = diag(R, R, R, R). */
export function rigidezBarraGlobal(kl: ArrayLike<number>, R: ArrayLike<number>): Float64Array {
  const kg = new Float64Array(144);
  for (let I = 0; I < 4; I++) for (let J = 0; J < 4; J++) {
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      let s = 0;
      for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) s += R[3 * p + a]! * kl[12 * (3 * I + p) + 3 * J + q]! * R[3 * q + b]!;
      kg[12 * (3 * I + a) + 3 * J + b] = s;
    }
  }
  return kg;
}

// ---------------------------------------------------------------------------------------------
// Liberaciones

/** Subsistemas de la rigidez local: GDL de cada uno. */
const SUBSISTEMAS = {
  axil: [0, 6],
  torsion: [3, 9],
  /** Plano x-y: [vᵢ, θzᵢ, vⱼ, θzⱼ]. */
  flexionZ: [1, 5, 7, 11],
  /** Plano x-z: [wᵢ, θyᵢ, wⱼ, θyⱼ]. */
  flexionY: [2, 4, 8, 10],
} as const;
type NombreSubsistema = keyof typeof SUBSISTEMAS;

/** Por qué un juego de liberaciones deja un mecanismo dentro de la barra (o null si es estable). */
export function liberacionInestable(lib: ArrayLike<boolean>): string | null {
  const libre = (g: number) => lib[g] === true;
  if (libre(0) && libre(6)) return "libera el axil en los dos extremos";
  if (libre(3) && libre(9)) return "libera el torsor en los dos extremos";
  for (const [nombre, [vi, ti, vj, tj]] of [
    ["x-y (Vy, Mz)", SUBSISTEMAS.flexionZ],
    ["x-z (Vz, My)", SUBSISTEMAS.flexionY],
  ] as const) {
    const conservados = [vi, ti, vj, tj].filter((g) => !libre(g));
    // Estable si queda una traslación y al menos dos GDL (el par de giros es dependiente)
    const traslacion = conservados.includes(vi) || conservados.includes(vj);
    if (conservados.length < 2 || !traslacion) {
      return libre(vi) && libre(vj)
        ? `libera el cortante del plano ${nombre} en los dos extremos`
        : `deja sin rigidez transversal el plano ${nombre} (un momento liberado en los dos extremos junto con su cortante, o tres liberaciones en el plano)`;
    }
  }
  return null;
}

/** Datos de la condensación de un subsistema. */
interface Condensacion {
  /** GDL locales conservados y liberados del subsistema. */
  c: number[];
  r: number[];
  /** K_rr⁻¹ (|r|×|r| por filas) y K_rc (|r|×|c| por filas). */
  krrInv: Float64Array;
  krc: Float64Array;
}

function inversaPequena(a: Float64Array, n: number): Float64Array {
  if (n === 1) return Float64Array.of(1 / a[0]!);
  if (n === 2) {
    const det = a[0]! * a[3]! - a[1]! * a[2]!;
    return Float64Array.of(a[3]! / det, -a[1]! / det, -a[2]! / det, a[0]! / det);
  }
  throw new Error("inversaPequena: sólo 1×1 y 2×2");
}

export interface RigidezCondensada {
  /** Rigidez local 12×12 con las liberaciones condensadas (filas y columnas liberadas a 0). */
  k: Float64Array;
  condensaciones: Condensacion[];
}

/**
 * Condensación estática de las liberaciones, subsistema por subsistema. Cuando la teoría dice que
 * la rigidez condensada es nula (axil o torsor liberado en un extremo; en flexión, si quedan sólo
 * dos GDL) se pone a cero exactamente, para que el núcleo detecte los GDL sin rigidez.
 * El juego de liberaciones tiene que ser estable (`liberacionInestable`).
 */
export function condensarLiberaciones(kl: Float64Array, lib: ArrayLike<boolean>): RigidezCondensada {
  const k = Float64Array.from(kl);
  const condensaciones: Condensacion[] = [];
  for (const nombre of Object.keys(SUBSISTEMAS) as NombreSubsistema[]) {
    const gdl = SUBSISTEMAS[nombre];
    const r = gdl.filter((g) => lib[g] === true);
    if (r.length === 0) continue;
    const c = gdl.filter((g) => lib[g] !== true);
    const nr = r.length;
    const nc = c.length;
    const krr = new Float64Array(nr * nr);
    for (let a = 0; a < nr; a++) for (let b = 0; b < nr; b++) krr[nr * a + b] = kl[12 * r[a]! + r[b]!]!;
    const krrInv = inversaPequena(krr, nr);
    const krc = new Float64Array(nr * nc);
    for (let a = 0; a < nr; a++) for (let b = 0; b < nc; b++) krc[nc * a + b] = kl[12 * r[a]! + c[b]!]!;
    condensaciones.push({ c: [...c], r: [...r], krrInv, krc });
    const nula = nombre === "axil" || nombre === "torsion" ? nc <= 1 : nc <= 2;
    // K_cc ← K_cc − K_cr·K_rr⁻¹·K_rc
    for (let a = 0; a < nc; a++) for (let b = 0; b < nc; b++) {
      let s = 0;
      if (!nula) for (let p = 0; p < nr; p++) for (let q = 0; q < nr; q++) s += krc[nc * p + a]! * krrInv[nr * p + q]! * krc[nc * q + b]!;
      k[12 * c[a]! + c[b]!] = nula ? 0 : kl[12 * c[a]! + c[b]!]! - s;
    }
    for (const g of r) for (let m = 0; m < 12; m++) {
      k[12 * g + m] = 0;
      k[12 * m + g] = 0;
    }
  }
  // Simetría exacta
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) {
    const v = (k[12 * i + j]! + k[12 * j + i]!) / 2;
    k[12 * i + j] = v;
    k[12 * j + i] = v;
  }
  return { k, condensaciones };
}

/** Fuerzas de empotramiento (12, locales) con las liberaciones condensadas: r_c − K_cr·K_rr⁻¹·r_r, r_r = 0. */
export function condensarFer(fer: Float64Array, cond: readonly Condensacion[]): Float64Array {
  const f = Float64Array.from(fer);
  for (const { c, r, krrInv, krc } of cond) {
    const nr = r.length;
    const nc = c.length;
    for (let a = 0; a < nc; a++) {
      let s = 0;
      for (let p = 0; p < nr; p++) for (let q = 0; q < nr; q++) s += krc[nc * p + a]! * krrInv[nr * p + q]! * fer[r[q]!]!;
      f[c[a]!]! -= s;
    }
    for (const g of r) f[g] = 0;
  }
  return f;
}

/**
 * Desplazamientos locales de los GDL liberados (el giro en la rótula, por ejemplo), a partir de
 * los conservados y de las fuerzas de empotramiento sin condensar: u_r = −K_rr⁻¹·(K_rc·u_c + r_r).
 * Modifica `u` (12, locales) en su sitio.
 */
export function recuperarLiberados(u: Float64Array, fer: Float64Array | null, cond: readonly Condensacion[]): void {
  for (const { c, r, krrInv, krc } of cond) {
    const nr = r.length;
    const nc = c.length;
    const t = new Float64Array(nr);
    for (let p = 0; p < nr; p++) {
      let s = fer ? fer[r[p]!]! : 0;
      for (let b = 0; b < nc; b++) s += krc[nc * p + b]! * u[c[b]!]!;
      t[p] = s;
    }
    for (let a = 0; a < nr; a++) {
      let s = 0;
      for (let q = 0; q < nr; q++) s += krrInv[nr * a + q]! * t[q]!;
      u[r[a]!] = -s;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Offsets rígidos

/**
 * Kₙ = Aᵀ·K·A, con A la cinemática de los offsets: u' = u − [d]×·θ, θ' = θ en cada extremo
 * (K en ejes globales, en los extremos del tramo flexible; Kₙ, en los nudos).
 */
export function aplicarOffsets(K: Float64Array, di: ArrayLike<number> | null, dj: ArrayLike<number> | null): Float64Array {
  if (!di && !dj) return K;
  // −[d]× por filas: [[0, dz, −dy], [−dz, 0, dx], [dy, −dx, 0]]
  const menosCruz = (d: ArrayLike<number>) => Float64Array.of(0, d[2]!, -d[1]!, -d[2]!, 0, d[0]!, d[1]!, -d[0]!, 0);
  const B = [di ? menosCruz(di) : null, dj ? menosCruz(dj) : null];
  // KA = K·A: columnas de giro += columnas de traslación · B
  const KA = Float64Array.from(K);
  for (let e = 0; e < 2; e++) {
    const b = B[e];
    if (!b) continue;
    const t0 = 6 * e;
    for (let m = 0; m < 12; m++) for (let col = 0; col < 3; col++) {
      let s = 0;
      for (let t = 0; t < 3; t++) s += K[12 * m + t0 + t]! * b[3 * t + col]!;
      KA[12 * m + t0 + 3 + col]! += s;
    }
  }
  // Aᵀ·KA: filas de giro += Bᵀ · filas de traslación
  const Kn = Float64Array.from(KA);
  for (let e = 0; e < 2; e++) {
    const b = B[e];
    if (!b) continue;
    const t0 = 6 * e;
    for (let fila = 0; fila < 3; fila++) for (let m = 0; m < 12; m++) {
      let s = 0;
      for (let t = 0; t < 3; t++) s += b[3 * t + fila]! * KA[12 * (t0 + t) + m]!;
      Kn[12 * (t0 + 3 + fila) + m]! += s;
    }
  }
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) {
    const v = (Kn[12 * i + j]! + Kn[12 * j + i]!) / 2;
    Kn[12 * i + j] = v;
    Kn[12 * j + i] = v;
  }
  return Kn;
}

/** Desplazamientos en los extremos del tramo flexible a partir de los de los nudos (globales, 12). */
export function desplazamientosExtremos(un: ArrayLike<number>, di: ArrayLike<number> | null, dj: ArrayLike<number> | null): Float64Array {
  const u = Float64Array.from(un);
  for (const [e, d] of [[0, di], [1, dj]] as const) {
    if (!d) continue;
    const b = 6 * e;
    const [tx, ty, tz] = [un[b + 3]!, un[b + 4]!, un[b + 5]!];
    // θ × d
    u[b]! += ty * d[2]! - tz * d[1]!;
    u[b + 1]! += tz * d[0]! - tx * d[2]!;
    u[b + 2]! += tx * d[1]! - ty * d[0]!;
  }
  return u;
}

/** Fuerzas en los nudos (globales, 12) equivalentes a las de los extremos del tramo flexible: M += d × F. */
export function fuerzasANudos(f: ArrayLike<number>, di: ArrayLike<number> | null, dj: ArrayLike<number> | null): Float64Array {
  const r = Float64Array.from(f);
  for (const [e, d] of [[0, di], [1, dj]] as const) {
    if (!d) continue;
    const b = 6 * e;
    const [fx, fy, fz] = [f[b]!, f[b + 1]!, f[b + 2]!];
    r[b + 3]! += d[1]! * fz - d[2]! * fy;
    r[b + 4]! += d[2]! * fx - d[0]! * fz;
    r[b + 5]! += d[0]! * fy - d[1]! * fx;
  }
  return r;
}

/** v_global = Rᵀ·v_local por bloques de 3 (12 componentes). */
export function aGlobales(v: ArrayLike<number>, R: ArrayLike<number>): Float64Array {
  const r = new Float64Array(12);
  for (let b = 0; b < 4; b++) for (let a = 0; a < 3; a++) {
    r[3 * b + a] = R[a]! * v[3 * b]! + R[3 + a]! * v[3 * b + 1]! + R[6 + a]! * v[3 * b + 2]!;
  }
  return r;
}

/** v_local = R·v_global por bloques de 3 (12 componentes). */
export function aLocales(v: ArrayLike<number>, R: ArrayLike<number>): Float64Array {
  const r = new Float64Array(12);
  for (let b = 0; b < 4; b++) for (let a = 0; a < 3; a++) {
    r[3 * b + a] = R[3 * a]! * v[3 * b]! + R[3 * a + 1]! * v[3 * b + 1]! + R[3 * a + 2]! * v[3 * b + 2]!;
  }
  return r;
}
