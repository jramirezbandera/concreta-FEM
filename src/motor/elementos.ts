/**
 * Capa de elementos del motor: lista uniforme de barras, láminas y muelles, comprobaciones
 * geométricas previas al cálculo y rigidez de cada uno en ejes globales.
 *
 * El núcleo (numeración, restricciones, ensamblado) no sabe de tipos de elemento: sólo ve
 * nudos, una matriz (6m)×(6m) en ejes globales y qué GDL rigidiza cada elemento.
 */
import { prepararBarra, type BarraPreparada } from "./barras.ts";
import type { Diagnosticos } from "./diagnosticos.ts";
import { TOL_GEOMETRICA, type Geometria } from "./geometria.ts";
import { prepararLamina, rigidezLamina, type LaminaPreparada } from "./laminas.ts";
import type { ModeloAnalitico, Muelle } from "./modelo.ts";

export { geometria, TOL_GEOMETRICA, type Geometria } from "./geometria.ts";

export type TipoElemento = "barra" | "lamina" | "muelle";

export interface ElementoMotor {
  tipo: TipoElemento;
  /** Índice dentro de su lista del modelo (`barras`, `laminas` o `muelles`). */
  indice: number;
  id: string;
  nudos: readonly number[];
  /** Sólo barras: geometría, rigidez en los nudos y GDL que rigidiza. */
  barra?: BarraPreparada;
  /** Sólo láminas: ejes, coordenadas locales y sección. */
  lamina?: LaminaPreparada;
}

const finito = (...v: number[]) => v.every(Number.isFinite);

/** Comprueba índices de nudo de un objeto: en rango y sin repetir. */
function nudosValidos(nudos: readonly number[], nn: number): boolean {
  for (let a = 0; a < nudos.length; a++) {
    const v = nudos[a]!;
    if (!Number.isInteger(v) || v < 0 || v >= nn) return false;
    for (let b = 0; b < a; b++) if (nudos[b] === v) return false;
  }
  return true;
}

/** Rigidez 6×6 de un muelle en ejes globales (por filas). */
function rigidezMuelle6(m: Muelle): Float64Array {
  const k = new Float64Array(36);
  if (m.k.length === 6) for (let i = 0; i < 6; i++) k[7 * i] = m.k[i]!;
  else for (let i = 0; i < 36; i++) k[i] = m.k[i]!;
  if (!m.ejes) return k;
  // K_g = Tᵀ·k·T con T = diag(R, R) y u_muelle = R·u_global
  const R = m.ejes;
  const T = new Float64Array(36);
  for (let b = 0; b < 2; b++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) T[6 * (3 * b + i) + 3 * b + j] = R[3 * i + j]!;
  const kT = new Float64Array(36);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    let s = 0;
    for (let p = 0; p < 6; p++) s += k[6 * i + p]! * T[6 * p + j]!;
    kT[6 * i + j] = s;
  }
  const kg = new Float64Array(36);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    let s = 0;
    for (let p = 0; p < 6; p++) s += T[6 * p + i]! * kT[6 * p + j]!;
    kg[6 * i + j] = s;
  }
  // Simetría exacta frente al redondeo del giro
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
    const v = (kg[6 * i + j]! + kg[6 * j + i]!) / 2;
    kg[6 * i + j] = v;
    kg[6 * j + i] = v;
  }
  return kg;
}

/** ¿Es la matriz 6×6 simétrica y semidefinida positiva? (Cholesky con pivotes ≥ −ε). */
function semidefinidaPositiva(k: Float64Array): boolean {
  let escala = 0;
  for (let i = 0; i < 36; i++) escala = Math.max(escala, Math.abs(k[i]!));
  if (escala === 0) return true;
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (Math.abs(k[6 * i + j]! - k[6 * j + i]!) > 1e-12 * escala) return false;
  const a = Float64Array.from(k);
  for (let j = 0; j < 6; j++) {
    let d = a[7 * j]!;
    for (let p = 0; p < j; p++) d -= a[6 * j + p]! ** 2;
    if (d < -1e-12 * escala) return false;
    if (d <= 1e-14 * escala) {
      // pivote nulo: la columna tiene que ser nula para seguir siendo semidefinida
      for (let i = j + 1; i < 6; i++) {
        let s = a[6 * i + j]!;
        for (let p = 0; p < j; p++) s -= a[6 * i + p]! * a[6 * j + p]!;
        if (Math.abs(s) > 1e-12 * escala) return false;
        a[6 * i + j] = 0;
      }
      a[7 * j] = 0;
      continue;
    }
    const l = Math.sqrt(d);
    a[7 * j] = l;
    for (let i = j + 1; i < 6; i++) {
      let s = a[6 * i + j]!;
      for (let p = 0; p < j; p++) s -= a[6 * i + p]! * a[6 * j + p]!;
      a[6 * i + j] = s / l;
    }
  }
  return true;
}

function ortonormal(R: readonly number[]): boolean {
  if (R.length !== 9 || !finito(...R)) return false;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const p = R[3 * i]! * R[3 * j]! + R[3 * i + 1]! * R[3 * j + 1]! + R[3 * i + 2]! * R[3 * j + 2]!;
    if (Math.abs(p - (i === j ? 1 : 0)) > 1e-9) return false;
  }
  // dextrógira: det = +1
  const det =
    R[0]! * (R[4]! * R[8]! - R[5]! * R[7]!) - R[1]! * (R[3]! * R[8]! - R[5]! * R[6]!) + R[2]! * (R[3]! * R[7]! - R[4]! * R[6]!);
  return det > 0;
}

/**
 * Comprueba los elementos y devuelve la lista uniforme. Los defectos van a `diag` como errores
 * (el cálculo no sigue si hay alguno).
 */
export function elementosDelModelo(modelo: ModeloAnalitico, geo: Geometria, diag: Diagnosticos): ElementoMotor[] {
  const nn = modelo.nudos.length;
  const { xyz, tamano } = geo;
  const lista: ElementoMotor[] = [];
  const tol = TOL_GEOMETRICA * tamano;

  (modelo.barras ?? []).forEach((b, indice) => {
    if (!nudosValidos(b.nudos, nn)) {
      diag.error("modelo/nudo-no-valido", `La barra ${b.id} hace referencia a nudos inexistentes o repetidos.`, [b.id]);
      return;
    }
    const barra = prepararBarra(b, indice, modelo, geo, diag);
    if (barra) lista.push({ tipo: "barra", indice, id: b.id, nudos: b.nudos, barra });
  });

  (modelo.laminas ?? []).forEach((l, indice) => {
    if (l.nudos.length !== 4 || !nudosValidos(l.nudos, nn)) {
      diag.error("modelo/nudo-no-valido", `La lámina ${l.id} hace referencia a nudos inexistentes o repetidos.`, [l.id]);
      return;
    }
    const lamina = prepararLamina(l, indice, geo, diag);
    if (lamina) lista.push({ tipo: "lamina", indice, id: l.id, nudos: l.nudos, lamina });
  });

  (modelo.muelles ?? []).forEach((m, indice) => {
    if ((m.nudos.length !== 1 && m.nudos.length !== 2) || !nudosValidos(m.nudos, nn)) {
      diag.error("modelo/nudo-no-valido", `El muelle ${m.id} hace referencia a nudos inexistentes o repetidos.`, [m.id]);
      return;
    }
    if ((m.k.length !== 6 && m.k.length !== 36) || !finito(...m.k)) {
      diag.error("modelo/propiedad-no-valida", `El muelle ${m.id} tiene que dar 6 rigideces (diagonal) o 36 (matriz 6×6) finitas.`, [m.id]);
      return;
    }
    if (m.ejes && !ortonormal(m.ejes)) {
      diag.error("modelo/orientacion-no-valida", `Los ejes del muelle ${m.id} no forman un triedro ortonormal dextrógiro.`, [m.id]);
      return;
    }
    if (!semidefinidaPositiva(rigidezMuelle6(m))) {
      diag.error("modelo/propiedad-no-valida", `La rigidez del muelle ${m.id} no es simétrica y semidefinida positiva.`, [m.id]);
      return;
    }
    if (m.nudos.length === 2) {
      const [i, j] = m.nudos;
      const d = Math.hypot(xyz[3 * j] - xyz[3 * i], xyz[3 * j + 1] - xyz[3 * i + 1], xyz[3 * j + 2] - xyz[3 * i + 2]);
      if (d > tol) {
        diag.error(
          "modelo/muelle-no-nulo",
          `El muelle ${m.id} une nudos separados ${d.toExponential(2)} m: sólo se admiten muelles de longitud nula entre nudos coincidentes.`,
          [m.id, modelo.nudos[i]!.id, modelo.nudos[j]!.id],
        );
        return;
      }
    }
    lista.push({ tipo: "muelle", indice, id: m.id, nudos: m.nudos });
  });

  return lista;
}

/** Rigidez del elemento en ejes globales, (6m)×(6m) por filas. */
export function rigidezGlobal(modelo: ModeloAnalitico, e: ElementoMotor): Float64Array {
  if (e.tipo === "barra") return e.barra!.kNudos;
  if (e.tipo === "lamina") return rigidezLamina(e.lamina!);
  const m = modelo.muelles![e.indice]!;
  const k6 = rigidezMuelle6(m);
  if (m.nudos.length === 1) return k6;
  const k = new Float64Array(144);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    const v = k6[6 * i + j]!;
    k[12 * i + j] = v;
    k[12 * (i + 6) + j + 6] = v;
    k[12 * i + j + 6] = -v;
    k[12 * (i + 6) + j] = -v;
  }
  return k;
}

/**
 * GDL locales (0..6m−1) que el elemento rigidiza. Láminas, todos (tienen drilling real); una
 * barra, los de filas no nulas de su rigidez en los nudos (las liberaciones pueden dejar un nudo
 * sin rigidez a giro); un muelle, los de diagonal no nula en ejes globales.
 */
export function gdlRigidizados(modelo: ModeloAnalitico, e: ElementoMotor): boolean[] {
  const m = 6 * e.nudos.length;
  if (e.tipo === "barra") return e.barra!.rigidizados;
  if (e.tipo !== "muelle") return new Array<boolean>(m).fill(true);
  const k6 = rigidezMuelle6(modelo.muelles![e.indice]!);
  const r: boolean[] = [];
  for (let n = 0; n < e.nudos.length; n++) for (let c = 0; c < 6; c++) r.push(k6[7 * c] !== 0);
  return r;
}

/** Sólo los muelles a tierra aportan reacciones: ¿es `e` uno de ellos? */
export function esMuelleATierra(e: ElementoMotor): boolean {
  return e.tipo === "muelle" && e.nudos.length === 1;
}
