/**
 * Láminas en el motor (E3): preparación (ejes de la lámina, coordenadas locales y sección con
 * multiplicadores) con sus diagnósticos, cargas de lámina por caso (fuerzas nodales equivalentes y
 * resultante real para el equilibrio) y resultantes en los ejes de la lámina.
 *
 * Las resultantes sólo dependen de los desplazamientos (elemento de desplazamientos: no hay término
 * de carga como las FER de las barras), así que las de una combinación son las de su u combinado.
 */
import { PUNTOS_GAUSS } from "../elementos/dkmq.ts";
import {
  coordenadasNaturales,
  funcionesForma,
  marcoLamina,
  operadorResultantes,
  rigidezLaminaGlobal,
  seccionLamina,
  type SeccionLamina,
} from "../elementos/lamina.ts";
import type { Resultante } from "./barras.ts";
import { Diagnosticos } from "./diagnosticos.ts";
import { geometria, TOL_GEOMETRICA, type Geometria } from "./geometria.ts";
import type { CargaLamina, LaminaAnalitica, ModeloAnalitico, Vec3 } from "./modelo.ts";

export interface LaminaPreparada {
  indice: number;
  /** Ejes de la lámina por filas (e1, e2, e3): u_local = R·u_global. */
  R: Float64Array;
  /** Coordenadas de los nudos en los ejes 1-2, con el origen en el nudo 1. */
  xy: Float64Array;
  /** Nudo 1 (global). */
  origen: Float64Array;
  seccion: SeccionLamina;
  area: number;
}

const finito = (...v: number[]) => v.every(Number.isFinite);
const MULTIPLICADORES = ["f11", "f22", "f12", "m11", "m22", "m12", "v13", "v23"] as const;

/**
 * Comprueba y prepara una lámina. Los defectos van a `diag` como errores y devuelve null. Los
 * nudos ya se han comprobado (en rango y distintos).
 */
export function prepararLamina(l: LaminaAnalitica, indice: number, geo: Geometria, diag: Diagnosticos): LaminaPreparada | null {
  const ids = [l.id];
  const m = l.material;
  if (!m || !finito(m.E, m.nu, m.t) || !(m.E > 0 && m.t > 0 && m.nu >= 0 && m.nu < 0.5)) {
    diag.error("modelo/propiedad-no-valida", `La lámina ${l.id} tiene un material no válido (E > 0, t > 0 y 0 ≤ ν < 0,5).`, ids);
    return null;
  }
  const mult = l.multiplicadores;
  if (mult) {
    const malos = MULTIPLICADORES.filter((k) => mult[k] !== undefined && !(Number.isFinite(mult[k]) && mult[k]! > 0));
    if (malos.length) {
      diag.error(
        "modelo/propiedad-no-valida",
        `La lámina ${l.id} tiene multiplicadores no válidos (${malos.map((k) => `${k} = ${mult[k]}`).join(", ")}): tienen que ser positivos.`,
        ids,
      );
      return null;
    }
  }
  const op = l.membrana;
  if (op && ((op.gamma !== undefined && !(Number.isFinite(op.gamma) && op.gamma > 0)) || (op.estabilizacion !== undefined && !(Number.isFinite(op.estabilizacion) && op.estabilizacion >= 0)))) {
    diag.error("modelo/propiedad-no-valida", `La lámina ${l.id} tiene opciones de membrana no válidas (γ/G > 0 y estabilización ≥ 0).`, ids);
    return null;
  }
  const X = new Float64Array(12);
  for (let a = 0; a < 4; a++) for (let c = 0; c < 3; c++) X[3 * a + c] = geo.xyz[3 * l.nudos[a]! + c]!;
  const marco = marcoLamina(X, l.eje1);
  if (typeof marco === "string") {
    const eje = marco.includes("eje 1");
    diag.error(
      eje ? "modelo/orientacion-no-valida" : "modelo/elemento-degenerado",
      eje ? `La lámina ${l.id} no tiene ejes: ${marco}.` : `La lámina ${l.id} es degenerada, no convexa o tiene los nudos desordenados (el orden tiene que recorrer el contorno).`,
      ids,
    );
    return null;
  }
  const xy = marco.xy;
  let lado = 0;
  let convexa = finito(...xy);
  let area = 0;
  for (let a = 0; a < 4; a++) {
    const b = (a + 1) % 4;
    const c = (a + 2) % 4;
    const ex = xy[2 * b]! - xy[2 * a]!;
    const ey = xy[2 * b + 1]! - xy[2 * a + 1]!;
    lado = Math.max(lado, Math.hypot(ex, ey));
    const cruz = ex * (xy[2 * c + 1]! - xy[2 * b + 1]!) - ey * (xy[2 * c]! - xy[2 * b]!);
    if (!(cruz > 0)) convexa = false;
    area += xy[2 * a]! * xy[2 * b + 1]! - xy[2 * b]! * xy[2 * a + 1]!;
  }
  if (!convexa) {
    diag.error(
      "modelo/elemento-degenerado",
      `La lámina ${l.id} es degenerada, no convexa o tiene los nudos desordenados (el orden tiene que recorrer el contorno).`,
      ids,
    );
    return null;
  }
  if (marco.alabeo > TOL_GEOMETRICA * Math.max(1, lado)) {
    diag.error(
      "modelo/lamina-alabeada",
      `La lámina ${l.id} no es plana: su cuarto nudo se separa ${marco.alabeo.toExponential(2)} m del plano de los otros tres. El elemento es plano y una lámina alabeada rompe el equilibrio.`,
      ids,
      { alabeo: marco.alabeo },
    );
    return null;
  }
  return { indice, R: marco.R, xy, origen: marco.origen, seccion: seccionLamina(m, mult, op), area: area / 2 };
}

/** Rigidez de la lámina en ejes globales (24×24, nueva). */
export function rigidezLamina(pl: LaminaPreparada): Float64Array {
  return rigidezLaminaGlobal(pl.xy, pl.R, pl.seccion);
}

// ---------------------------------------------------------------------------------------------
// Cargas

/** Cargas de lámina de un caso: fuerzas nodales equivalentes y resultante real. */
export interface CargasDeLaminas {
  /** Fuerzas nodales equivalentes (globales, 6 por nudo) de todas las cargas del caso; null si no hay. */
  equivalentes: Float64Array | null;
  /** Resultante real de las cargas, respecto al centro del modelo, con sus escalas. */
  resultante: Resultante;
}

const aGlobal = (R: ArrayLike<number>, v: ArrayLike<number>): [number, number, number] => [
  R[0]! * v[0]! + R[3]! * v[1]! + R[6]! * v[2]!,
  R[1]! * v[0]! + R[4]! * v[1]! + R[7]! * v[2]!,
  R[2]! * v[0]! + R[5]! * v[1]! + R[8]! * v[2]!,
];
const cruz = (a: ArrayLike<number>, b: ArrayLike<number>): [number, number, number] => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];
const norma = (v: ArrayLike<number>) => Math.hypot(v[0]!, v[1]!, v[2]!);
const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));

/** Coordenadas naturales de los nudos. */
const XI = [-1, 1, 1, -1];
const ETA = [-1, -1, 1, 1];
/** Nudos de la lámina respecto al centro del modelo (búfer). */
const XR = new Float64Array(12);

/**
 * Punto global → (x, y) locales, distancia al plano y si está dentro del contorno (con la
 * tolerancia `tol`, m). Devuelve también (ξ, η), acotadas a [−1, 1].
 */
function situar(pl: LaminaPreparada, p: Vec3, tol: number): { x: number; y: number; fuera: number; dentro: boolean; xi: number; eta: number } {
  const { R, origen, xy } = pl;
  const d = [p[0] - origen[0]!, p[1] - origen[1]!, p[2] - origen[2]!];
  const x = d[0]! * R[0]! + d[1]! * R[1]! + d[2]! * R[2]!;
  const y = d[0]! * R[3]! + d[1]! * R[4]! + d[2]! * R[5]!;
  const fuera = Math.abs(d[0]! * R[6]! + d[1]! * R[7]! + d[2]! * R[8]!);
  let dentro = fuera <= tol;
  for (let a = 0; a < 4 && dentro; a++) {
    const b = (a + 1) & 3;
    const ex = xy[2 * b]! - xy[2 * a]!;
    const ey = xy[2 * b + 1]! - xy[2 * a + 1]!;
    // distancia con signo al lado (positiva hacia dentro en un contorno antihorario)
    const s = (ex * (y - xy[2 * a + 1]!) - ey * (x - xy[2 * a]!)) / Math.hypot(ex, ey);
    if (s < -tol) dentro = false;
  }
  const n = dentro ? coordenadasNaturales(xy, x, y) : null;
  if (dentro && !n) dentro = false;
  const xi = n ? Math.min(1, Math.max(-1, n[0])) : 0;
  const eta = n ? Math.min(1, Math.max(-1, n[1])) : 0;
  return { x, y, fuera, dentro, xi, eta };
}

/** Coeficientes del jacobiano, que es lineal: det J(ξ, η) = j0 + j1·ξ + j2·η. */
function coeficientesJacobiano(xy: ArrayLike<number>): [number, number, number] {
  const det = (xi: number, eta: number) => {
    const j11 = 0.25 * (-(1 - eta) * xy[0]! + (1 - eta) * xy[2]! + (1 + eta) * xy[4]! - (1 + eta) * xy[6]!);
    const j12 = 0.25 * (-(1 - eta) * xy[1]! + (1 - eta) * xy[3]! + (1 + eta) * xy[5]! - (1 + eta) * xy[7]!);
    const j21 = 0.25 * (-(1 - xi) * xy[0]! - (1 + xi) * xy[2]! + (1 + xi) * xy[4]! + (1 - xi) * xy[6]!);
    const j22 = 0.25 * (-(1 - xi) * xy[1]! - (1 + xi) * xy[3]! + (1 + xi) * xy[5]! + (1 - xi) * xy[7]!);
    return j11 * j22 - j12 * j21;
  };
  const j0 = det(0, 0);
  return [j0, det(1, 0) - j0, det(0, 1) - j0];
}

/**
 * Convierte y comprueba las cargas de lámina de un caso. Devuelve sus fuerzas nodales equivalentes
 * (Gauss 2×2 o a lo largo del tramo, con las funciones bilineales) y la resultante real, que se
 * calcula por otro camino (integrales cerradas de la carga sobre el cuadrilátero, el tramo o el
 * punto) para que un error en las equivalentes rompa el equilibrio. Los defectos van a `diag`.
 */
export function cargasDeLaminasDelCaso(
  idCaso: string,
  cargas: readonly CargaLamina[],
  laminas: readonly (LaminaPreparada | undefined)[],
  modelo: ModeloAnalitico,
  geo: Geometria,
  diag: Diagnosticos,
): CargasDeLaminas {
  const res: Resultante = { F: [0, 0, 0], M: [0, 0, 0], escalaF: 0, escalaM: 0 };
  if (cargas.length === 0) return { equivalentes: null, resultante: res };
  const tol = TOL_GEOMETRICA * geo.tamano;
  const C = geo.centro;
  const { xyz } = geo;
  const eq = new Float64Array(6 * modelo.nudos.length);
  const N = new Float64Array(4);
  const f = new Float64Array(24);
  const sumarResultante = (F: readonly number[], M: readonly number[], escF: number, escM: number) => {
    for (let c = 0; c < 3; c++) {
      res.F[c] += F[c]!;
      res.M[c] += M[c]!;
    }
    res.escalaF += escF;
    res.escalaM += escM;
  };
  for (const c of cargas) {
    const pl = Number.isInteger(c.lamina) ? laminas[c.lamina] : undefined;
    const la = Number.isInteger(c.lamina) ? modelo.laminas?.[c.lamina] : undefined;
    if (!pl || !la || (c.ejes !== "local" && c.ejes !== "global")) {
      diag.error("carga/no-valida", `El caso ${idCaso} tiene una carga de lámina sobre una lámina inexistente o con unos ejes no válidos.`, [idCaso, ...(la ? [la.id] : [])]);
      continue;
    }
    const ids = [idCaso, la.id];
    const { R } = pl;
    const g = (v: Vec3): [number, number, number] => (c.ejes === "global" ? [v[0], v[1], v[2]] : aGlobal(R, v));
    f.fill(0);
    if (c.tipo === "superficie") {
      const porNudo = Array.isArray(c.q[0]);
      const qs = (porNudo ? (c.q as readonly Vec3[]) : [c.q as Vec3]) as readonly unknown[];
      if ((porNudo && qs.length !== 4) || !qs.every(vec)) {
        diag.error("carga/no-valida", `El caso ${idCaso} tiene una carga de superficie no válida en la lámina ${la.id} (un vector o uno por nudo, finitos).`, ids);
        continue;
      }
      const qg = [0, 1, 2, 3].map((a) => g(qs[porNudo ? a : 0] as Vec3));
      // Equivalentes: ∫ Nₐ·q dA con Gauss 2×2 (q bilineal entre los nudos)
      const [j0, j1, j2] = coeficientesJacobiano(pl.xy);
      for (const [xi, eta] of PUNTOS_GAUSS) {
        funcionesForma(xi, eta, N);
        const det = j0 + j1 * xi + j2 * eta;
        const q = [0, 0, 0];
        for (let b = 0; b < 4; b++) for (let k = 0; k < 3; k++) q[k] += N[b]! * qg[b]![k]!;
        for (let a = 0; a < 4; a++) for (let k = 0; k < 3; k++) f[6 * a + k] += N[a]! * q[k]! * det;
      }
      // Resultante, en forma cerrada: ∫ Nₐ dA = j0 + (j1·ξₐ + j2·ηₐ)/3 y
      // ∫ Nₐ·N_b dA = [j0·Iₐᵦ(ξ)·Iₐᵦ(η) + j1·Jₐᵦ(ξ)·Iₐᵦ(η) + j2·Iₐᵦ(ξ)·Jₐᵦ(η)]/16, con
      // Iₐᵦ(ξ) = ∫(1 + ξₐξ)(1 + ξᵦξ) dξ = 2 + 2ξₐξᵦ/3 y Jₐᵦ(ξ) = ∫ ξ(1 + ξₐξ)(1 + ξᵦξ) dξ = 2(ξₐ + ξᵦ)/3
      for (let b = 0; b < 4; b++) for (let k = 0; k < 3; k++) XR[3 * b + k] = xyz[3 * la.nudos[b]! + k]! - C[k]!;
      const F = [0, 0, 0];
      const M = [0, 0, 0];
      let brazo = 0;
      let qmax = 0;
      for (let a = 0; a < 4; a++) {
        const Ia = j0 + (j1 * XI[a]! + j2 * ETA[a]!) / 3;
        const [qx, qy, qz] = qg[a]!;
        F[0] += qx * Ia;
        F[1] += qy * Ia;
        F[2] += qz * Ia;
        qmax = Math.max(qmax, Math.hypot(qx, qy, qz));
        brazo = Math.max(brazo, Math.hypot(XR[3 * a]!, XR[3 * a + 1]!, XR[3 * a + 2]!));
        for (let b = 0; b < 4; b++) {
          const Ix = 2 + (2 * XI[a]! * XI[b]!) / 3;
          const Iy = 2 + (2 * ETA[a]! * ETA[b]!) / 3;
          const Jx = (2 * (XI[a]! + XI[b]!)) / 3;
          const Jy = (2 * (ETA[a]! + ETA[b]!)) / 3;
          const Iab = (j0 * Ix * Iy + j1 * Jx * Iy + j2 * Ix * Jy) / 16;
          const x = XR[3 * b]!;
          const y = XR[3 * b + 1]!;
          const z = XR[3 * b + 2]!;
          M[0] += (y * qz - z * qy) * Iab;
          M[1] += (z * qx - x * qz) * Iab;
          M[2] += (x * qy - y * qx) * Iab;
        }
      }
      sumarResultante(F, M, qmax * pl.area, brazo * qmax * pl.area);
    } else if (c.tipo === "linea") {
      const qa = c.qa;
      const qb = c.qb ?? c.qa;
      if (!vec(c.a) || !vec(c.b) || !vec(qa) || !vec(qb)) {
        diag.error("carga/no-valida", `El caso ${idCaso} tiene una carga de línea no válida en la lámina ${la.id}.`, ids);
        continue;
      }
      const pa = situar(pl, c.a, tol);
      const pb = situar(pl, c.b, tol);
      if (!pa.dentro || !pb.dentro) {
        diag.error(
          "carga/fuera-de-lamina",
          `El caso ${idCaso} pone una carga de línea en la lámina ${la.id} con un extremo fuera de ella (a ${Math.max(pa.fuera, pb.fuera).toExponential(2)} m de su plano o fuera de su contorno).`,
          ids,
        );
        continue;
      }
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      if (!(len > tol)) {
        diag.error("carga/no-valida", `El caso ${idCaso} tiene una carga de línea de longitud nula en la lámina ${la.id}.`, ids);
        continue;
      }
      const ga = g(qa);
      const gb = g(qb);
      // Equivalentes: Gauss de 3 puntos a lo largo del tramo (estáticamente exacto: ∫q y ∫x·q son de grado ≤ 2)
      const S3 = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)];
      const W3 = [5 / 9, 8 / 9, 5 / 9];
      let fuera = false;
      for (let p = 0; p < 3; p++) {
        const s = 0.5 * (1 + S3[p]!);
        const n = coordenadasNaturales(pl.xy, pa.x + s * (pb.x - pa.x), pa.y + s * (pb.y - pa.y));
        if (!n) {
          fuera = true;
          break;
        }
        funcionesForma(Math.min(1, Math.max(-1, n[0])), Math.min(1, Math.max(-1, n[1])), N);
        const w = 0.5 * W3[p]! * len;
        for (let a = 0; a < 4; a++) for (let k = 0; k < 3; k++) f[6 * a + k] += N[a]! * (ga[k]! + s * (gb[k]! - ga[k]!)) * w;
      }
      if (fuera) {
        diag.error("carga/fuera-de-lamina", `El caso ${idCaso} pone una carga de línea fuera de la lámina ${la.id}.`, ids);
        continue;
      }
      // Resultante: ∫q = (qa + qb)/2·L; ∫ s·q ds = L²·(qa + 2qb)/6; momento (A − C) × ∫q + e × ∫ s·q
      const A = aGlobal(R, [pa.x, pa.y, 0]).map((v, k) => v + pl.origen[k]! - C[k]!);
      const e = aGlobal(R, [(pb.x - pa.x) / len, (pb.y - pa.y) / len, 0]);
      const F = [0, 1, 2].map((k) => ((ga[k]! + gb[k]!) / 2) * len);
      const Sq = [0, 1, 2].map((k) => (len * len * (ga[k]! + 2 * gb[k]!)) / 6);
      const m1 = cruz(A, F);
      const m2 = cruz(e, Sq);
      const escF = ((norma(ga) + norma(gb)) / 2) * len;
      sumarResultante(F, [m1[0] + m2[0], m1[1] + m2[1], m1[2] + m2[2]], escF, (norma(A) + len) * escF);
    } else if (c.tipo === "puntual") {
      const F0 = c.F ?? [0, 0, 0];
      const M0 = c.M ?? [0, 0, 0];
      if (!vec(c.punto) || !vec(F0) || !vec(M0)) {
        diag.error("carga/no-valida", `El caso ${idCaso} tiene una carga puntual no válida en la lámina ${la.id}.`, ids);
        continue;
      }
      const p = situar(pl, c.punto, tol);
      if (!p.dentro) {
        diag.error(
          "carga/fuera-de-lamina",
          `El caso ${idCaso} pone una carga puntual fuera de la lámina ${la.id} (a ${p.fuera.toExponential(2)} m de su plano o fuera de su contorno).`,
          ids,
        );
        continue;
      }
      const Fg = g(F0);
      const Mg = g(M0);
      funcionesForma(p.xi, p.eta, N);
      for (let a = 0; a < 4; a++) {
        for (let k = 0; k < 3; k++) {
          f[6 * a + k] += N[a]! * Fg[k]!;
          f[6 * a + 3 + k] += N[a]! * Mg[k]!;
        }
      }
      // Resultante en el punto proyectado sobre el plano
      const X = aGlobal(R, [p.x, p.y, 0]).map((v, k) => v + pl.origen[k]! - C[k]!);
      const m = cruz(X, Fg);
      sumarResultante(Fg, [m[0] + Mg[0], m[1] + Mg[1], m[2] + Mg[2]], norma(Fg), norma(X) * norma(Fg) + norma(Mg));
    } else {
      diag.error("carga/no-valida", `El caso ${idCaso} tiene una carga de lámina de un tipo desconocido en la lámina ${la.id}.`, ids);
      continue;
    }
    for (let a = 0; a < 4; a++) for (let k = 0; k < 6; k++) eq[6 * la.nudos[a]! + k] += f[6 * a + k]!;
  }
  return { equivalentes: eq, resultante: res };
}

// ---------------------------------------------------------------------------------------------
// Resultantes

const OP = new Float64Array(768);

/**
 * Operador de resultantes en ejes globales: 8 filas de 24 (GDL globales de los 4 nudos) que dan
 * [Nx, Ny, Nxy, Mx, My, Mxy, Qx, Qy] en los ejes de la lámina. `donde`: un punto de Gauss (0–3)
 * o "centroide" (la media de los cuatro). `out` (192).
 */
export function operadorGlobal(pl: LaminaPreparada, donde: number | "centroide", out: Float64Array = new Float64Array(192)): Float64Array {
  operadorResultantes(pl.xy, pl.seccion, OP);
  const R = pl.R;
  for (let r = 0; r < 8; r++) {
    for (let t = 0; t < 8; t++) {
      let l0: number, l1: number, l2: number;
      const c = 24 * r + 3 * t;
      if (donde === "centroide") {
        l0 = 0.25 * (OP[c]! + OP[192 + c]! + OP[384 + c]! + OP[576 + c]!);
        l1 = 0.25 * (OP[c + 1]! + OP[192 + c + 1]! + OP[384 + c + 1]! + OP[576 + c + 1]!);
        l2 = 0.25 * (OP[c + 2]! + OP[192 + c + 2]! + OP[384 + c + 2]! + OP[576 + c + 2]!);
      } else {
        const o = 192 * donde + c;
        l0 = OP[o]!;
        l1 = OP[o + 1]!;
        l2 = OP[o + 2]!;
      }
      // fila_global = fila_local·R
      out[c] = l0 * R[0]! + l1 * R[3]! + l2 * R[6]!;
      out[c + 1] = l0 * R[1]! + l1 * R[4]! + l2 * R[7]!;
      out[c + 2] = l0 * R[2]! + l1 * R[5]! + l2 * R[8]!;
    }
  }
  return out;
}

/** Aplica un operador global (8×24) a los desplazamientos `u` (6 por nudo) de los nudos de la lámina. */
function aplicar(op: Float64Array, nudos: readonly number[], u: ArrayLike<number>, destino: Float64Array, o: number): void {
  for (let r = 0; r < 8; r++) {
    let s = 0;
    for (let a = 0; a < 4; a++) {
      const b = 6 * nudos[a]!;
      const c = 24 * r + 6 * a;
      s += op[c]! * u[b]! + op[c + 1]! * u[b + 1]! + op[c + 2]! * u[b + 2]! + op[c + 3]! * u[b + 3]! + op[c + 4]! * u[b + 4]! + op[c + 5]! * u[b + 5]!;
    }
    destino[o + r] = s;
  }
}

/**
 * Resultantes en el centroide de las láminas para todos los casos: `destinos[k]` (8 por lámina,
 * en el orden de `laminas`) a partir de `us[k]`. El operador se calcula una vez por lámina.
 */
export function resultantesEnCentroides(
  laminas: readonly { nudos: readonly number[]; lamina?: LaminaPreparada }[],
  us: readonly ArrayLike<number>[],
  destinos: readonly Float64Array[],
): void {
  const op = new Float64Array(192);
  for (const e of laminas) {
    const pl = e.lamina;
    if (!pl) continue;
    operadorGlobal(pl, "centroide", op);
    for (let k = 0; k < us.length; k++) aplicar(op, e.nudos, us[k]!, destinos[k]!, 8 * pl.indice);
  }
}

/**
 * Resultantes de las láminas de un modelo calculado, en cualquier punto, a partir de unos
 * desplazamientos (los de un caso o cualquier combinación lineal de ellos: las resultantes son
 * lineales en u y no dependen de las cargas). Prepara las láminas una sola vez.
 */
export class ResultantesLaminas {
  private readonly laminas: (LaminaPreparada | undefined)[] = [];
  readonly modelo: ModeloAnalitico;
  private readonly op = new Float64Array(192);

  constructor(modelo: ModeloAnalitico) {
    this.modelo = modelo;
    const geo = geometria(modelo);
    const diag = new Diagnosticos();
    (modelo.laminas ?? []).forEach((l, k) => {
      this.laminas[k] = prepararLamina(l, k, geo, diag) ?? undefined;
    });
    if (diag.hayErrores) throw new Error(`ResultantesLaminas: el modelo tiene errores (${diag.lista[0]!.mensaje}); calcúlalo antes con calcular()`);
  }

  /** Lámina preparada: ejes (R, por filas e1, e2, e3), coordenadas locales, sección. */
  lamina(l: number): LaminaPreparada {
    const pl = this.laminas[l];
    if (!pl) throw new Error(`ResultantesLaminas: no hay lámina ${l}`);
    return pl;
  }

  /** [Nx, Ny, Nxy, Mx, My, Mxy, Qx, Qy] × 4 puntos de Gauss (en el orden de PUNTOS_GAUSS). */
  enGauss(l: number, u: ArrayLike<number>): Float64Array {
    const pl = this.lamina(l);
    const out = new Float64Array(32);
    for (let g = 0; g < 4; g++) {
      operadorGlobal(pl, g, this.op);
      aplicar(this.op, this.modelo.laminas![l]!.nudos, u, out, 8 * g);
    }
    return out;
  }

  /** En el centroide: la media de los 4 puntos de Gauss (el valor de `esfuerzosLaminas`). */
  centroide(l: number, u: ArrayLike<number>): Float64Array {
    const out = new Float64Array(8);
    operadorGlobal(this.lamina(l), "centroide", this.op);
    aplicar(this.op, this.modelo.laminas![l]!.nudos, u, out, 0);
    return out;
  }

  /**
   * En (ξ, η), por extrapolación bilineal desde los puntos de Gauss, como PyNite. Fuera de ellos
   * (en los nudos, por ejemplo) es una extrapolación por elemento, discontinua entre elementos:
   * sólo para dibujar (H01).
   */
  en(l: number, u: ArrayLike<number>, xi: number, eta: number): Float64Array {
    const vg = this.enGauss(l, u);
    const r = xi * Math.sqrt(3);
    const s = eta * Math.sqrt(3);
    const H = [0.25 * (1 - r) * (1 - s), 0.25 * (1 + r) * (1 - s), 0.25 * (1 + r) * (1 + s), 0.25 * (1 - r) * (1 + s)];
    const out = new Float64Array(8);
    for (let g = 0; g < 4; g++) for (let c = 0; c < 8; c++) out[c] += H[g]! * vg[8 * g + c]!;
    return out;
  }

  /** En los 4 nudos de la lámina (extrapolados; 4 × 8). */
  enNudos(l: number, u: ArrayLike<number>): Float64Array {
    const out = new Float64Array(32);
    for (let a = 0; a < 4; a++) out.set(this.en(l, u, XI[a]!, ETA[a]!), 8 * a);
    return out;
  }
}
