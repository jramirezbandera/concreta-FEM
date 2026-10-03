/**
 * Barras en el motor (E2): preparación (geometría, offsets, liberaciones, rigidez en los nudos),
 * cargas de barra por caso, resultantes reales para el equilibrio, esfuerzos en los extremos del
 * tramo flexible y diagramas completos.
 *
 * Cadena de transformaciones de una barra: nudos (globales) → offsets rígidos → extremos i', j'
 * del tramo flexible (globales) → ejes locales (R) → rigidez de Timoshenko con las liberaciones
 * condensadas. Las cargas de barra entran como fuerzas nodales equivalentes −Aᵀ·Rᵀ·r₀, con r₀ las
 * FER condensadas.
 */
import {
  aGlobales,
  aLocales,
  aplicarOffsets,
  condensarFer,
  condensarLiberaciones,
  desplazamientosExtremos,
  fuerzasANudos,
  liberacionInestable,
  marcoBarra,
  recuperarLiberados,
  rigidezBarraGlobal,
  rigidezBarraLocal,
  seccionEfectiva,
  type RigidezCondensada,
  type SeccionBarra,
} from "../elementos/barra.ts";
import { arranqueDeFuerzas, DiagramaBarra, diagramaDeCargas, ferBarra, type CargaLocal, type DiagramaCargas, type V3 } from "../elementos/cargasBarra.ts";
import { Diagnosticos } from "./diagnosticos.ts";
import { geometria, TOL_GEOMETRICA, type Geometria } from "./geometria.ts";
import type { BarraAnalitica, CargaBarra, ModeloAnalitico, ResultadoCaso } from "./modelo.ts";

export interface BarraPreparada {
  indice: number;
  /** Longitud del tramo flexible. */
  L: number;
  /** Ejes locales del tramo flexible (por filas): u_local = R·u_global. */
  R: Float64Array;
  /** Extremos del tramo flexible (globales). */
  ip: Float64Array;
  jp: Float64Array;
  /** Offsets (null si son nulos). */
  di: Float64Array | null;
  dj: Float64Array | null;
  /** Sección con los modificadores aplicados. */
  seccion: SeccionBarra;
  /** Rigidez local sin liberaciones. */
  kLocal: Float64Array;
  /** Rigidez local condensada (null si no hay liberaciones: es kLocal). */
  cond: RigidezCondensada | null;
  /** Rigidez en ejes globales en los nudos (12×12). */
  kNudos: Float64Array;
  /** GDL de los nudos (12) que la barra rigidiza: filas no nulas de kNudos. */
  rigidizados: boolean[];
}

const finito = (...v: number[]) => v.every(Number.isFinite);
const norma = (v: ArrayLike<number>) => Math.hypot(v[0]!, v[1]!, v[2]!);

/**
 * Comprueba y prepara una barra. Los defectos van a `diag` como errores y devuelve null. Los
 * nudos ya se han comprobado (en rango y distintos).
 */
export function prepararBarra(b: BarraAnalitica, indice: number, modelo: ModeloAnalitico, geo: Geometria, diag: Diagnosticos): BarraPreparada | null {
  const { xyz, tamano } = geo;
  const tol = TOL_GEOMETRICA * tamano;
  const s = b.seccion;
  const ids = [b.id];
  const avValida = (v: number | undefined) => v === undefined || (Number.isFinite(v) && v > 0);
  if (
    !finito(s.E, s.G, s.A, s.Iy, s.Iz, s.J) ||
    !(s.E > 0 && s.G > 0 && s.A > 0 && s.Iy > 0 && s.Iz > 0 && s.J > 0) ||
    !avValida(s.Avy) ||
    !avValida(s.Avz)
  ) {
    diag.error(
      "modelo/propiedad-no-valida",
      `La barra ${b.id} tiene una sección o un material no válidos (E, G, A, Iy, Iz y J tienen que ser positivos; Avy y Avz, positivas o ausentes).`,
      ids,
    );
    return null;
  }
  const m = b.modificadores;
  if (m) {
    const valores = [m.A, m.Avy, m.Avz, m.J, m.Iy, m.Iz].filter((v) => v !== undefined) as number[];
    if (!valores.every((v) => Number.isFinite(v) && v > 0)) {
      diag.error("modelo/propiedad-no-valida", `La barra ${b.id} tiene modificadores no válidos (tienen que ser positivos).`, ids);
      return null;
    }
  }
  const di = b.offsets?.i ?? null;
  const dj = b.offsets?.j ?? null;
  for (const d of [di, dj]) {
    if (d && (d.length !== 3 || !finito(...d))) {
      diag.error("modelo/offset-no-valido", `La barra ${b.id} tiene un offset no válido (tres componentes finitas).`, ids);
      return null;
    }
  }
  const [i, j] = b.nudos;
  const ip = Float64Array.from([0, 1, 2], (c) => xyz[3 * i + c]! + (di?.[c] ?? 0));
  const jp = Float64Array.from([0, 1, 2], (c) => xyz[3 * j + c]! + (dj?.[c] ?? 0));
  const d = [jp[0]! - ip[0]!, jp[1]! - ip[1]!, jp[2]! - ip[2]!];
  const L = norma(d);
  const nudos = [b.id, modelo.nudos[i]!.id, modelo.nudos[j]!.id];
  if (!(L > tol)) {
    diag.error(
      "modelo/elemento-degenerado",
      di || dj ? `El tramo flexible de la barra ${b.id} tiene longitud nula: los offsets se comen la barra.` : `La barra ${b.id} tiene longitud nula.`,
      nudos,
    );
    return null;
  }
  if (di || dj) {
    const dn = [xyz[3 * j]! - xyz[3 * i]!, xyz[3 * j + 1]! - xyz[3 * i + 1]!, xyz[3 * j + 2]! - xyz[3 * i + 2]!];
    if (norma(dn) > tol && d[0]! * dn[0]! + d[1]! * dn[1]! + d[2]! * dn[2]! <= 0) {
      diag.error("modelo/offset-no-valido", `Los offsets de la barra ${b.id} se solapan: el tramo flexible queda invertido respecto a sus nudos.`, nudos);
      return null;
    }
  }
  if (b.vz.length !== 3 || !finito(...b.vz)) {
    diag.error("modelo/propiedad-no-valida", `La barra ${b.id} tiene un vector de canto no válido.`, ids);
    return null;
  }
  let R: Float64Array;
  try {
    R = marcoBarra(ip, jp, b.vz).R;
  } catch {
    diag.error("modelo/orientacion-no-valida", `El vector de canto de la barra ${b.id} es paralelo a su tramo flexible.`, ids);
    return null;
  }
  let lib: boolean[] | null = null;
  const li = b.liberaciones?.i;
  const lj = b.liberaciones?.j;
  if (li || lj) {
    if ((li && li.length !== 6) || (lj && lj.length !== 6)) {
      diag.error("modelo/propiedad-no-valida", `Las liberaciones de la barra ${b.id} tienen que dar 6 valores por extremo.`, ids);
      return null;
    }
    lib = [...(li ?? new Array(6).fill(false)), ...(lj ?? new Array(6).fill(false))].map((v) => v === true);
    if (!lib.some(Boolean)) lib = null;
  }
  if (lib) {
    const porque = liberacionInestable(lib);
    if (porque) {
      diag.error(
        "modelo/liberacion-inestable",
        `La barra ${b.id} ${porque}: sería un mecanismo dentro de la propia barra. Quita una de esas liberaciones.`,
        ids,
        { liberaciones: lib },
      );
      return null;
    }
  }
  const seccion = seccionEfectiva(s, m);
  const kLocal = rigidezBarraLocal(L, seccion);
  const cond = lib ? condensarLiberaciones(kLocal, lib) : null;
  const kNudos = aplicarOffsets(rigidezBarraGlobal(cond ? cond.k : kLocal, R), di, dj);
  const rigidizados: boolean[] = [];
  for (let a = 0; a < 12; a++) {
    let alguno = false;
    for (let c = 0; c < 12 && !alguno; c++) alguno = kNudos[12 * a + c] !== 0;
    rigidizados.push(alguno);
  }
  return {
    indice,
    L,
    R,
    ip,
    jp,
    di: di ? Float64Array.from(di) : null,
    dj: dj ? Float64Array.from(dj) : null,
    seccion,
    kLocal,
    cond,
    kNudos,
    rigidizados,
  };
}

// ---------------------------------------------------------------------------------------------
// Cargas

/** Cargas locales de una barra en un caso, con sus FER y la resultante real. */
export interface CargasDeBarra {
  cargas: CargaLocal[];
  dc: DiagramaCargas;
  /** FER locales sin condensar (para recuperar los GDL liberados). */
  fer: Float64Array;
  /** FER locales condensadas. */
  ferC: Float64Array;
}

/** Resultante real de las cargas de barra de un caso, respecto al centro del modelo. */
export interface Resultante {
  F: [number, number, number];
  M: [number, number, number];
  /** Escalas para el equilibrio: Σ|F| y Σ(|r|·|F| + |M|). */
  escalaF: number;
  escalaM: number;
}

const local = (R: ArrayLike<number>, v: V3): [number, number, number] => [
  R[0]! * v[0] + R[1]! * v[1] + R[2]! * v[2],
  R[3]! * v[0] + R[4]! * v[1] + R[5]! * v[2],
  R[6]! * v[0] + R[7]! * v[1] + R[8]! * v[2],
];
const global = (R: ArrayLike<number>, v: ArrayLike<number>): [number, number, number] => [
  R[0]! * v[0]! + R[3]! * v[1]! + R[6]! * v[2]!,
  R[1]! * v[0]! + R[4]! * v[1]! + R[7]! * v[2]!,
  R[2]! * v[0]! + R[5]! * v[1]! + R[8]! * v[2]!,
];
const cruz = (a: ArrayLike<number>, b: ArrayLike<number>): [number, number, number] => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];

/**
 * Convierte y comprueba las cargas de barra de un caso. Devuelve, por barra cargada, sus cargas
 * locales con las FER; y la resultante real de todas ellas. Los defectos van a `diag`.
 */
export function cargasDeBarrasDelCaso(
  idCaso: string,
  cargas: readonly CargaBarra[],
  barras: readonly (BarraPreparada | undefined)[],
  modelo: ModeloAnalitico,
  geo: Geometria,
  diag: Diagnosticos,
): { porBarra: Map<number, CargasDeBarra>; resultante: Resultante } {
  const tol = TOL_GEOMETRICA * geo.tamano;
  const locales = new Map<number, CargaLocal[]>();
  const res: Resultante = { F: [0, 0, 0], M: [0, 0, 0], escalaF: 0, escalaM: 0 };
  const C = geo.centro;
  const sumar = (Fg: readonly number[], Mg: readonly number[], brazoF: readonly number[], escF: number, escR: number, escM: number) => {
    // brazoF = ∫ (X − C) × q, ya calculado; Fg = ∫q
    for (let c = 0; c < 3; c++) {
      res.F[c]! += Fg[c]!;
      res.M[c]! += brazoF[c]! + Mg[c]!;
    }
    res.escalaF += escF;
    res.escalaM += escR * escF + escM;
  };
  const vec = (v: unknown): v is V3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));
  for (const c of cargas) {
    const pb = Number.isInteger(c.barra) ? barras[c.barra] : undefined;
    const idBarra = Number.isInteger(c.barra) && modelo.barras?.[c.barra] ? modelo.barras[c.barra]!.id : undefined;
    if (!pb || (c.ejes !== "local" && c.ejes !== "global")) {
      diag.error("carga/no-valida", `El caso ${idCaso} tiene una carga de barra sobre una barra inexistente o con unos ejes no válidos.`, [idCaso, ...(idBarra ? [idBarra] : [])]);
      continue;
    }
    const ids = [idCaso, idBarra!];
    const { L, R, ip } = pb;
    const enRango = (x: number) => x >= -tol && x <= L + tol;
    const acotar = (x: number) => Math.min(L, Math.max(0, x));
    const aLocal = (v: V3): V3 => (c.ejes === "local" ? v : local(R, v));
    const aGlobal = (v: V3): V3 => (c.ejes === "global" ? v : global(R, v));
    if (c.tipo === "puntual") {
      const F = c.F ?? [0, 0, 0];
      const M = c.M ?? [0, 0, 0];
      if (!Number.isFinite(c.x) || !vec(F) || !vec(M)) {
        diag.error("carga/no-valida", `El caso ${idCaso} tiene una carga puntual no válida en la barra ${idBarra}.`, ids);
        continue;
      }
      if (!enRango(c.x)) {
        diag.error("carga/fuera-de-barra", `El caso ${idCaso} pone una carga puntual en x = ${c.x} m de la barra ${idBarra}, fuera de su tramo flexible [0, ${L.toPrecision(6)}] m.`, ids);
        continue;
      }
      const x = acotar(c.x);
      let l = locales.get(pb.indice);
      if (!l) locales.set(pb.indice, (l = []));
      l.push({ tipo: "puntual", x, F: aLocal(F), M: aLocal(M) });
      const Fg = aGlobal(F);
      const Mg = aGlobal(M);
      const X = [ip[0]! + x * R[0]! - C[0], ip[1]! + x * R[1]! - C[1], ip[2]! + x * R[2]! - C[2]];
      sumar(Fg, Mg, cruz(X, Fg), norma(Fg), norma(X), norma(Mg));
      continue;
    }
    const qa = c.qa;
    const qb = c.qb ?? c.qa;
    const a = c.a ?? 0;
    const b = c.b ?? L;
    if (!vec(qa) || !vec(qb) || !Number.isFinite(a) || !Number.isFinite(b)) {
      diag.error("carga/no-valida", `El caso ${idCaso} tiene una carga distribuida no válida en la barra ${idBarra}.`, ids);
      continue;
    }
    if (!enRango(a) || !enRango(b)) {
      diag.error(
        "carga/fuera-de-barra",
        `El caso ${idCaso} pone una carga distribuida en [${a}, ${b}] m de la barra ${idBarra}, fuera de su tramo flexible [0, ${L.toPrecision(6)}] m.`,
        ids,
      );
      continue;
    }
    const xa = acotar(a);
    const xb = acotar(b);
    if (!(xb - xa > tol)) {
      diag.error("carga/no-valida", `El caso ${idCaso} tiene una carga distribuida en la barra ${idBarra} con un tramo vacío o invertido ([${a}, ${b}] m).`, ids);
      continue;
    }
    let l = locales.get(pb.indice);
    if (!l) locales.set(pb.indice, (l = []));
    l.push({ tipo: "distribuida", a: xa, b: xb, qa: aLocal(qa), qb: aLocal(qb) });
    // Resultante: ∫q = (qa + qb)/2·(b − a); ∫ s·q ds = (b − a)·[qa·(2a + b) + qb·(a + 2b)]/6
    const ga = aGlobal(qa);
    const gb = aGlobal(qb);
    const len = xb - xa;
    const Fg = [0, 1, 2].map((k) => ((ga[k]! + gb[k]!) / 2) * len);
    const Sg = [0, 1, 2].map((k) => (len * (ga[k]! * (2 * xa + xb) + gb[k]! * (xa + 2 * xb))) / 6);
    // ∫ (ip − C + s·e1) × q = (ip − C) × ∫q + e1 × ∫ s·q
    const base = [ip[0]! - C[0], ip[1]! - C[1], ip[2]! - C[2]];
    const e1 = [R[0]!, R[1]!, R[2]!];
    const m1 = cruz(base, Fg);
    const m2 = cruz(e1, Sg);
    const brazo = Math.max(norma([base[0]! + xa * e1[0]!, base[1]! + xa * e1[1]!, base[2]! + xa * e1[2]!]), norma([base[0]! + xb * e1[0]!, base[1]! + xb * e1[1]!, base[2]! + xb * e1[2]!]));
    sumar(Fg, [0, 0, 0], [m1[0] + m2[0], m1[1] + m2[1], m1[2] + m2[2]], ((norma(ga) + norma(gb)) / 2) * len, brazo, 0);
  }
  const porBarra = new Map<number, CargasDeBarra>();
  for (const [ib, l] of locales) {
    const pb = barras[ib]!;
    const dc = diagramaDeCargas(pb.L, l);
    const fer = ferBarra(pb.seccion, dc);
    porBarra.set(ib, { cargas: l, dc, fer, ferC: pb.cond ? condensarFer(fer, pb.cond.condensaciones) : fer });
  }
  return { porBarra, resultante: res };
}

/** Fuerzas nodales equivalentes (globales, 12: nudo i y nudo j) de unas FER condensadas: −Aᵀ·Rᵀ·r₀. */
export function equivalentesEnNudos(pb: BarraPreparada, ferC: Float64Array): Float64Array {
  const f = fuerzasANudos(aGlobales(ferC, pb.R), pb.di, pb.dj);
  for (let c = 0; c < 12; c++) f[c] = -f[c]!;
  return f;
}

// ---------------------------------------------------------------------------------------------
// Recuperación

/** Desplazamientos locales de los extremos del tramo flexible (12), con los GDL liberados recuperados. */
export function desplazamientosLocales(pb: BarraPreparada, u: ArrayLike<number>, i: number, j: number, cargas?: CargasDeBarra): Float64Array {
  const un = new Float64Array(12);
  for (let c = 0; c < 6; c++) {
    un[c] = u[6 * i + c]!;
    un[6 + c] = u[6 * j + c]!;
  }
  const ul = aLocales(desplazamientosExtremos(un, pb.di, pb.dj), pb.R);
  if (pb.cond) recuperarLiberados(ul, cargas ? cargas.fer : null, pb.cond.condensaciones);
  return ul;
}

/** Fuerzas de los extremos sobre el tramo flexible (12, locales): k_c·u_l + r₀. */
export function fuerzasLocales(pb: BarraPreparada, ul: Float64Array, cargas?: CargasDeBarra): Float64Array {
  const k = pb.cond ? pb.cond.k : pb.kLocal;
  const f = new Float64Array(12);
  for (let a = 0; a < 12; a++) {
    let s = cargas ? cargas.ferC[a]! : 0;
    for (let b = 0; b < 12; b++) s += k[12 * a + b]! * ul[b]!;
    f[a] = s;
  }
  return f;
}

/**
 * Esfuerzos [N, Vy, Vz, T, My, Mz] en i' (0⁺) y en j' (L'⁻), escritos en `destino` desde `o`.
 * En j' salen de las fuerzas de ese extremo, sin propagar s₀ a lo largo de la barra.
 */
export function esfuerzosDeExtremo(f: Float64Array, cargas: CargasDeBarra | undefined, destino: Float64Array, o: number): void {
  const s0 = arranqueDeFuerzas(f);
  const sL = [f[6]!, f[7]!, f[8]!, f[9]!, -f[10]!, f[11]!];
  for (let c = 0; c < 6; c++) {
    let v0 = s0[c]!;
    let vL = sL[c]!;
    if (cargas) {
      const t = cargas.dc.s[c]!;
      v0 += t.en(0, 1); // saltos en 0
      vL -= t.final() - t.en(cargas.dc.L, -1); // saltos en L
    }
    destino[o + c] = v0;
    destino[o + 6 + c] = vL;
  }
}

// ---------------------------------------------------------------------------------------------
// Diagramas

/**
 * Diagramas exactos de las barras de un modelo calculado: esfuerzos y desplazamientos a lo largo
 * del tramo flexible, por caso o combinando casos (`DiagramaBarra.combinar`). Prepara las barras y
 * las cargas una sola vez.
 */
export class DiagramasBarras {
  private readonly barras: (BarraPreparada | undefined)[] = [];
  private readonly cargas: Map<number, CargasDeBarra>[];
  readonly modelo: ModeloAnalitico;

  constructor(modelo: ModeloAnalitico) {
    this.modelo = modelo;
    const geo = geometria(modelo);
    // Los diagramas suponen un modelo ya calculado y válido: un error aquí es un mal uso
    const diag = new Diagnosticos();
    (modelo.barras ?? []).forEach((b, k) => {
      this.barras[k] = prepararBarra(b, k, modelo, geo, diag) ?? undefined;
    });
    this.cargas = modelo.casos.map((caso) => cargasDeBarrasDelCaso(caso.id, caso.barras ?? [], this.barras, modelo, geo, diag).porBarra);
    if (diag.hayErrores) throw new Error(`DiagramasBarras: el modelo tiene errores (${diag.lista[0]!.mensaje}); calcúlalo antes con calcular()`);
  }

  /** Barra preparada (ejes locales, tramo flexible…). */
  barra(b: number): BarraPreparada {
    const pb = this.barras[b];
    if (!pb) throw new Error(`DiagramasBarras: no hay barra ${b}`);
    return pb;
  }

  /** Diagrama de la barra `b` en el caso `k`, con el resultado de ese caso (de un cálculo válido). */
  diagrama(b: number, k: number, resultado: ResultadoCaso): DiagramaBarra {
    const pb = this.barra(b);
    const [i, j] = this.modelo.barras![b]!.nudos;
    const cargas = this.cargas[k]!.get(b);
    const ul = desplazamientosLocales(pb, resultado.u, i, j, cargas);
    const f = fuerzasLocales(pb, ul, cargas);
    const dc = cargas ? cargas.dc : diagramaDeCargas(pb.L, []);
    return DiagramaBarra.desde(pb.seccion, dc, arranqueDeFuerzas(f), ul.subarray(0, 6));
  }

  /** Punto del eje deformado en x (globales): i' + x·e₁ + Rᵀ·u_local(x)·escala. */
  posicion(b: number, d: DiagramaBarra, x: number, escala = 1): [number, number, number] {
    const pb = this.barra(b);
    const u = d.desplazamientosEn(x);
    const ug = global(pb.R, u);
    return [0, 1, 2].map((c) => pb.ip[c]! + x * pb.R[c]! + escala * ug[c]!) as [number, number, number];
  }
}
