/**
 * Masas y modos de vibración (fase VS2, `docs/fem3d/viento-sismo.md` §3.2 y §3.3).
 *
 * **La masa** sale de las cargas, no de un dato aparte: en cada nudo, m = −Σ fracción·Fz/g, con Fz
 * la componente vertical de las fuerzas nodales equivalentes de cada caso que hace de masa (las que
 * ensambla el cálculo), más las masas puestas a mano. Sólo tiene inercia horizontal: la del sismo
 * en un edificio con forjados rígidos en su plano (NCSE-02 3.6.2.1, tres GDL por planta).
 *
 * **Adónde va la masa de cada nudo:**
 * - si es de un diafragma rígido (su maestro, uno de sus esclavos o un esclavo de un enlace rígido
 *   a la misma cota que su maestro, que es del diafragma: las huellas de los pilares y las caras de
 *   las vigas), a ese diafragma, en su sitio;
 * - si no es de ninguno y tiene coartados ux y uy, al terreno: no vibra;
 * - si no es de ninguno (las filas intermedias de un muro, los nudos de una barra entre plantas, la
 *   planta más baja), se reparte por su cota entre el nivel de arriba y el de abajo, en proporción
 *   inversa a la distancia. Los niveles son las cotas de los diafragmas y las de los nudos con apoyo
 *   horizontal que no son de un diafragma (el terreno); lo que le toca a un nivel de apoyos va al
 *   terreno. En su misma cota, todo al diafragma de esa cota. Si en una cota hay varios diafragmas,
 *   al de la caja en planta más cercana.
 *
 * De cada diafragma salen su masa m, su centro de masas y su inercia de giro J respecto a él. El
 * maestro no tiene por qué estar en el centro de masas: la masa del diafragma en los GDL de su
 * maestro [ux, uy, rz] es el bloque 3 × 3 entero, M = L·Lᵀ con
 * L = [[√m, 0, 0], [0, √m, 0], [−dy·√m, dx·√m, √J]] y (dx, dy) del maestro al centro de masas.
 *
 * **Los modos**, por condensación exacta: toda la masa está en los GDL de los maestros (los GDL
 * dinámicos, D), así que los demás siguen estáticamente a ésos y la rigidez condensada a D es la
 * inversa de la flexibilidad F en D, que da el cálculo con una solución estática por GDL de D sobre
 * la misma factorización. K_c·φ = ω²·M·φ se resuelve sin invertir F: con y = Lᵀ·φ,
 *
 *     (Lᵀ·F·L)·y = λ·y,   λ = 1/ω²,
 *
 * simétrico y definido positivo, por Jacobi cíclico (es pequeño y denso: 3 por planta). De cada
 * (λ, y) salen las fuerzas de inercia del modo f = ω²·M·φ = L·y/λ y su forma φ = F·f: el modo es
 * la respuesta estática a sus propias fuerzas de inercia, así que su forma completa es la
 * combinación de las soluciones unitarias con f, y se comprueba con el equilibrio de f contra sus
 * reacciones (regla de oro 2). Los modos salen normalizados a la masa: φᵀ·M·φ = yᵀ·y = 1.
 *
 * Un GDL de un maestro sin masa (un diafragma sin cargas, o el giro de uno con toda la masa en un
 * punto) no es dinámico: sigue a los demás, y la condensación sigue siendo exacta. Un GDL de un
 * maestro coartado no se mueve: su masa no cuenta.
 */
import { Diagnosticos } from "./diagnosticos.ts";
import { TOL_GEOMETRICA, type Geometria } from "./geometria.ts";
import { TipoGdl, type Numeracion } from "./gdl.ts";
import { GRAVEDAD, type DiafragmaModal, type ModeloAnalitico, type ResultadoModal } from "./modelo.ts";

/** Por debajo de esta fracción de la masa total (en valor absoluto), un diafragma no tiene masa. */
const MASA_NULA = 1e-12;
/** Por debajo de esta fracción de m·L² (L, el tamaño del modelo), un diafragma no tiene inercia de giro. */
const INERCIA_NULA = 1e-14;
/** Un valor propio de Lᵀ·F·L por debajo de esta fracción del mayor no es un modo (ω = ∞). */
const LAMBDA_NULO = 1e-13;
/** Tolerancia del residuo del problema propio, ‖A·y − λ·y‖∞ / λ_máx. */
const TOL_PROPIO = 1e-11;
/** Asimetría relativa de la flexibilidad (Betti) a partir de la cual se avisa. */
const TOL_BETTI = 1e-7;

/** Fracción de cada caso que hace de masa (0 en los que no) y g, o null con sus errores en `diag`. */
export function definicionModal(modelo: ModeloAnalitico, diag: Diagnosticos): { fraccion: Float64Array; g: number } | null {
  const def = modelo.modal!;
  const nn = modelo.nudos.length;
  const g = def.g ?? GRAVEDAD;
  let bien = true;
  const mal = (mensaje: string, ids?: string[]) => {
    diag.error("modal/definicion-no-valida", mensaje, ids);
    bien = false;
  };
  if (!(Number.isFinite(g) && g > 0)) mal(`La gravedad del análisis modal tiene que ser un número positivo (es ${g}).`);
  const fraccion = new Float64Array(modelo.casos.length);
  const indice = new Map(modelo.casos.map((c, k) => [c.id, k] as const));
  const vistos = new Set<string>();
  for (const m of Array.isArray(def.masas) ? def.masas : []) {
    const k = indice.get(m.caso);
    if (k === undefined) mal(`Las masas del análisis modal nombran el caso ${m.caso}, que no existe.`, [String(m.caso)]);
    else if (vistos.has(m.caso)) mal(`Las masas del análisis modal nombran dos veces el caso ${m.caso}.`, [m.caso]);
    else if (!(Number.isFinite(m.fraccion) && m.fraccion >= 0)) mal(`La fracción de masa del caso ${m.caso} tiene que ser un número ≥ 0 (es ${m.fraccion}).`, [m.caso]);
    else fraccion[k] = m.fraccion;
    vistos.add(m.caso);
  }
  for (const m of Array.isArray(def.nodales) ? def.nodales : []) {
    if (!Number.isInteger(m.nudo) || m.nudo < 0 || m.nudo >= nn || !Number.isFinite(m.m)) mal(`El análisis modal tiene una masa sobre un nudo inexistente o con un valor no finito (nudo ${m.nudo}).`);
  }
  return bien ? { fraccion, g } : null;
}

/** Lo que el cálculo necesita para los modos: los GDL dinámicos y M = L·Lᵀ en ellos. */
export interface PlanModal {
  g: number;
  masas: ResultadoModal["masas"];
  cm: [number, number];
  diafragmas: DiafragmaModal[];
  /** GDL físico (6·nudo + c) de cada GDL dinámico: los libres de los maestros con masa. */
  gdl: Uint32Array;
  /** De cada GDL dinámico: su diafragma (índice en `diafragmas`) y su componente (0 = ux, 1 = uy, 2 = rz). */
  diafragma: Int32Array;
  componente: Uint8Array;
  /** M = L·Lᵀ en los GDL dinámicos: `gdl.length` × `columnas`, por filas. */
  L: Float64Array;
  columnas: number;
}

interface Nivel {
  z: number;
  diafragmas: number[];
}

/**
 * Reparte la masa de los nudos (`masa`, t por nudo) entre los diafragmas y arma el plan de los modos.
 * null si no se puede (sin diafragmas, sin masa en ellos, masa negativa…), con el error en `diag`.
 */
export function prepararModal(modelo: ModeloAnalitico, geo: Geometria, num: Numeracion, masa: Float64Array, g: number, diag: Diagnosticos): PlanModal | null {
  const nn = modelo.nudos.length;
  const { xyz } = geo;
  const tolZ = TOL_GEOMETRICA * geo.tamano;
  const restricciones = modelo.restricciones ?? [];

  // 1. Los diafragmas y los nudos de cada uno, con las cadenas de enlaces rígidos a su cota
  const indices: number[] = [];
  const de = new Int32Array(nn).fill(-1);
  restricciones.forEach((r, ir) => {
    if (r.tipo !== "diafragma") return;
    const d = indices.length;
    indices.push(ir);
    de[r.maestro] = d;
    for (const s of r.esclavos) de[s] = d;
  });
  const nd = indices.length;
  if (!nd) {
    diag.error("modal/sin-diafragmas", "El análisis modal necesita al menos un diafragma rígido: la masa se condensa a los tres GDL de cada uno.");
    return null;
  }
  const enlaces = restricciones.filter((r) => r.tipo === "enlace-rigido");
  for (let cambia = true; cambia; ) {
    cambia = false;
    for (const r of enlaces) {
      const d = de[r.maestro]!;
      if (d < 0) continue;
      const zm = xyz[3 * r.maestro + 2]!;
      for (const s of r.esclavos) {
        if (de[s]! < 0 && Math.abs(xyz[3 * s + 2]! - zm) <= tolZ) {
          de[s] = d;
          cambia = true;
        }
      }
    }
  }
  const maestro = indices.map((ir) => restricciones[ir]!.maestro);

  // 2. Niveles: las cotas de los diafragmas y las del terreno (apoyos horizontales fuera de ellos)
  const cotas: { z: number; d: number }[] = maestro.map((m, d) => ({ z: xyz[3 * m + 2]!, d }));
  for (const a of modelo.apoyos ?? []) if ((a.coartados[0] || a.coartados[1]) && de[a.nudo]! < 0) cotas.push({ z: xyz[3 * a.nudo + 2]!, d: -1 });
  cotas.sort((a, b) => a.z - b.z || a.d - b.d);
  const niveles: Nivel[] = [];
  for (const c of cotas) {
    let nivel = niveles[niveles.length - 1];
    if (!nivel || c.z - nivel.z > tolZ) niveles.push((nivel = { z: c.z, diafragmas: [] }));
    if (c.d >= 0) nivel.diafragmas.push(c.d);
  }
  // Cajas en planta de los diafragmas, sólo si en alguna cota hay más de uno
  let cajas: Float64Array | null = null;
  const caja = (): Float64Array => {
    if (cajas) return cajas;
    cajas = new Float64Array(4 * nd);
    for (let d = 0; d < nd; d++) cajas.set([Infinity, Infinity, -Infinity, -Infinity], 4 * d);
    for (let v = 0; v < nn; v++) {
      const d = de[v]!;
      if (d < 0) continue;
      const [x, y] = [xyz[3 * v]!, xyz[3 * v + 1]!];
      cajas[4 * d] = Math.min(cajas[4 * d]!, x);
      cajas[4 * d + 1] = Math.min(cajas[4 * d + 1]!, y);
      cajas[4 * d + 2] = Math.max(cajas[4 * d + 2]!, x);
      cajas[4 * d + 3] = Math.max(cajas[4 * d + 3]!, y);
    }
    return cajas;
  };
  /** El diafragma de un nivel que se lleva la masa de (x, y); −1 si el nivel es sólo de apoyos. */
  const elegir = (nivel: Nivel, x: number, y: number): number => {
    const ds = nivel.diafragmas;
    if (ds.length <= 1) return ds[0] ?? -1;
    const c = caja();
    let mejor = -1;
    let dMin = Infinity;
    for (const d of ds) {
      const dx = Math.max(c[4 * d]! - x, 0, x - c[4 * d + 2]!);
      const dy = Math.max(c[4 * d + 1]! - y, 0, y - c[4 * d + 3]!);
      const dist = Math.hypot(dx, dy);
      if (dist < dMin) {
        dMin = dist;
        mejor = d;
      }
    }
    return mejor;
  };

  // 3. La masa de cada nudo, a su diafragma, repartida por su cota o al terreno
  const aD: number[] = [];
  const aX: number[] = [];
  const aY: number[] = [];
  const aM: number[] = [];
  const mD = new Float64Array(nd);
  const repartida = new Float64Array(nd);
  let total = 0;
  let terreno = 0;
  let escala = 0;
  const aportar = (d: number, x: number, y: number, m: number, fuera: boolean): void => {
    aD.push(d);
    aX.push(x);
    aY.push(y);
    aM.push(m);
    mD[d]! += m;
    if (fuera) repartida[d]! += m;
  };
  const alNivel = (nivel: Nivel, x: number, y: number, m: number): void => {
    const d = elegir(nivel, x, y);
    if (d < 0) terreno += m;
    else aportar(d, x, y, m, true);
  };
  for (let v = 0; v < nn; v++) {
    const m = masa[v]!;
    if (m === 0) continue;
    total += m;
    escala += Math.abs(m);
    const [x, y, z] = [xyz[3 * v]!, xyz[3 * v + 1]!, xyz[3 * v + 2]!];
    const d = de[v]!;
    if (d >= 0) {
      aportar(d, x, y, m, false);
      continue;
    }
    if (num.tipo[6 * v] === TipoGdl.Coartado && num.tipo[6 * v + 1] === TipoGdl.Coartado) {
      terreno += m;
      continue;
    }
    // El primer nivel que no queda por debajo del nudo
    let [a, b] = [0, niveles.length];
    while (a < b) {
      const c = (a + b) >> 1;
      if (niveles[c]!.z < z - tolZ) a = c + 1;
      else b = c;
    }
    const arriba = niveles[a];
    const abajo = niveles[a - 1];
    if (arriba && Math.abs(arriba.z - z) <= tolZ) alNivel(arriba, x, y, m);
    else if (!abajo) alNivel(arriba!, x, y, m);
    else if (!arriba) alNivel(abajo, x, y, m);
    else {
      const w = (z - abajo.z) / (arriba.z - abajo.z);
      alNivel(arriba, x, y, m * w);
      alNivel(abajo, x, y, m * (1 - w));
    }
  }
  if (!(escala > 0)) {
    diag.error("modal/sin-masa", "El análisis modal no tiene masa: los casos que hacen de masa no tienen cargas verticales y no hay masas puestas en los nudos.");
    return null;
  }

  // 4. Centro de masas e inercia de giro de cada diafragma (respecto al maestro primero, para no perder cifras)
  const sx = new Float64Array(nd);
  const sy = new Float64Array(nd);
  for (let i = 0; i < aD.length; i++) {
    const d = aD[i]!;
    sx[d]! += aM[i]! * (aX[i]! - xyz[3 * maestro[d]!]!);
    sy[d]! += aM[i]! * (aY[i]! - xyz[3 * maestro[d]! + 1]!);
  }
  const diafragmas: DiafragmaModal[] = indices.map((ir, d) => {
    const m = maestro[d]!;
    const conMasa = Math.abs(mD[d]!) > MASA_NULA * escala;
    const [xm, ym] = [xyz[3 * m]!, xyz[3 * m + 1]!];
    return {
      restriccion: ir,
      id: restricciones[ir]!.id,
      maestro: m,
      z: xyz[3 * m + 2]!,
      masa: conMasa ? mD[d]! : 0,
      cm: conMasa ? [xm + sx[d]! / mD[d]!, ym + sy[d]! / mD[d]!] : [xm, ym],
      J: 0,
      repartida: conMasa ? repartida[d]! : 0,
    };
  });
  for (let i = 0; i < aD.length; i++) {
    const df = diafragmas[aD[i]!]!;
    if (df.masa !== 0) df.J += aM[i]! * ((aX[i]! - df.cm[0]) ** 2 + (aY[i]! - df.cm[1]) ** 2);
  }
  const negativos = diafragmas.filter((df) => df.masa < 0 || df.J < -1e-9 * Math.abs(df.masa) * geo.tamano ** 2);
  if (negativos.length) {
    diag.error(
      "modal/masa-no-positiva",
      `La masa o la inercia de giro de ${negativos.length === 1 ? "un diafragma sale negativa" : `${negativos.length} diafragmas salen negativas`} (${negativos.map((df) => `${df.id}: ${df.masa.toPrecision(4)} t`).join("; ")}): los casos que hacen de masa tienen cargas hacia arriba.`,
      negativos.map((df) => df.id),
    );
    return null;
  }
  for (const df of diafragmas) if (df.J <= INERCIA_NULA * df.masa * geo.tamano ** 2) df.J = 0;

  // 5. GDL dinámicos y M = L·Lᵀ
  const gdl: number[] = [];
  const deGdl: number[] = [];
  const comp: number[] = [];
  const columnas: [number, number][][] = [];
  let esclavos = false;
  diafragmas.forEach((df, d) => {
    if (!(df.masa > 0)) return;
    const filas = [-1, -1, -1];
    [0, 1, 5].forEach((c, a) => {
      const p = 6 * df.maestro + c;
      const tipo = num.tipo[p];
      if (tipo === TipoGdl.Esclavo) esclavos = true;
      if (tipo !== TipoGdl.Libre) return;
      filas[a] = gdl.length;
      gdl.push(p);
      deGdl.push(d);
      comp.push(a);
    });
    const [dx, dy] = [df.cm[0] - xyz[3 * df.maestro]!, df.cm[1] - xyz[3 * df.maestro + 1]!];
    const [rm, rj] = [Math.sqrt(df.masa), Math.sqrt(df.J)];
    // Las columnas de L en [ux, uy, rz] del maestro, sin las filas de los GDL que no son libres
    let cols = [
      [rm, 0, -dy * rm],
      [0, rm, dx * rm],
      [0, 0, rj],
    ];
    const libres = filas.filter((f) => f >= 0).length;
    const noNulas = () => cols.filter((col) => col.some((v, a) => filas[a]! >= 0 && v !== 0));
    if (noNulas().length > libres) cols = choleskySemidefinido(cols, filas);
    for (const col of noNulas()) columnas.push(col.flatMap((v, a): [number, number][] => (filas[a]! >= 0 && v !== 0 ? [[filas[a]!, v]] : [])));
  });
  if (esclavos) {
    diag.error("modal/maestro-esclavo", "El maestro de un diafragma con masa es esclavo de otra restricción: el análisis modal necesita sus tres GDL independientes.");
    return null;
  }
  if (!gdl.length || !columnas.length) {
    diag.error("modal/sin-masa", "Ningún diafragma rígido tiene masa que se pueda mover: la de los casos que hacen de masa va entera al terreno, o los maestros están coartados.");
    return null;
  }
  // Un GDL sin masa (su fila de L, nula: el giro de un maestro con toda la masa en él) no es dinámico
  const conMasa = new Uint8Array(gdl.length);
  for (const col of columnas) for (const [fila] of col) conMasa[fila] = 1;
  const filaDe = new Int32Array(gdl.length).fill(-1);
  let nFilas = 0;
  for (let i = 0; i < gdl.length; i++) if (conMasa[i]) filaDe[i] = nFilas++;
  const L = new Float64Array(nFilas * columnas.length);
  columnas.forEach((col, j) => {
    for (const [fila, v] of col) L[columnas.length * filaDe[fila]! + j] = v;
  });
  const dinamicos = (lista: number[]) => lista.filter((_, i) => conMasa[i]);

  let [mt, cx, cy, rep] = [0, 0, 0, 0];
  for (const df of diafragmas) {
    mt += df.masa;
    cx += df.masa * df.cm[0];
    cy += df.masa * df.cm[1];
    rep += df.repartida;
  }
  return {
    g,
    masas: { total, diafragmas: mt, terreno, repartida: rep },
    cm: [cx / mt, cy / mt],
    diafragmas,
    gdl: Uint32Array.from(dinamicos(gdl)),
    diafragma: Int32Array.from(dinamicos(deGdl)),
    componente: Uint8Array.from(dinamicos(comp)),
    L,
    columnas: columnas.length,
  };
}

/**
 * Con algún GDL del maestro coartado, las columnas de L sin sus filas pueden ser más que las filas
 * que quedan: el Cholesky (semidefinido) de M en los GDL libres, con las mismas tres componentes.
 */
function choleskySemidefinido(cols: number[][], filas: number[]): number[][] {
  const libres = [0, 1, 2].filter((a) => filas[a]! >= 0);
  const k = libres.length;
  const M = libres.map((a) => libres.map((b) => cols.reduce((s, col) => s + col[a]! * col[b]!, 0)));
  const C = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let j = 0; j < k; j++) {
    let d = M[j]![j]!;
    for (let p = 0; p < j; p++) d -= C[j]![p]! ** 2;
    if (!(d > 1e-12 * M[j]![j]!)) continue;
    C[j]![j] = Math.sqrt(d);
    for (let i = j + 1; i < k; i++) {
      let s = M[i]![j]!;
      for (let p = 0; p < j; p++) s -= C[i]![p]! * C[j]![p]!;
      C[i]![j] = s / C[j]![j]!;
    }
  }
  return Array.from({ length: k }, (_, j) => {
    const col = [0, 0, 0];
    libres.forEach((a, i) => (col[a] = C[i]![j]!));
    return col;
  });
}

/** Un modo en los GDL dinámicos. */
export interface ModoCondensado {
  omega2: number;
  /** Fuerzas de inercia f = ω²·M·φ y forma φ = F·f en los GDL dinámicos. */
  f: Float64Array;
  phi: Float64Array;
  participacion: [number, number, number];
  masaEfectiva: [number, number, number];
}

/**
 * Los modos del modelo condensado, de menor a mayor ω. `F` es la flexibilidad en los GDL dinámicos
 * (nd × nd, por filas): F[i][j], el desplazamiento del GDL i con una fuerza unidad en el j. `xy`
 * da el punto del maestro de cada GDL dinámico (2 por GDL). null si no sale, con el error en `diag`.
 */
export function modosCondensados(plan: PlanModal, F: Float64Array, xy: Float64Array, diag: Diagnosticos): ModoCondensado[] | null {
  const nd = plan.gdl.length;
  const r = plan.columnas;
  const { L } = plan;
  // Betti: F es simétrica salvo el redondeo de las soluciones
  let fMax = 0;
  let asim = 0;
  for (let i = 0; i < nd; i++) {
    for (let j = 0; j <= i; j++) {
      fMax = Math.max(fMax, Math.abs(F[nd * i + j]!));
      asim = Math.max(asim, Math.abs(F[nd * i + j]! - F[nd * j + i]!));
    }
  }
  if (!(fMax > 0) || !F.every(Number.isFinite)) {
    diag.error("modal/flexibilidad-no-valida", "Las soluciones unitarias del análisis modal no dan una flexibilidad válida.");
    return null;
  }
  if (asim > TOL_BETTI * fMax) {
    diag.aviso(
      "modal/flexibilidad-asimetrica",
      `La flexibilidad condensada del análisis modal no es simétrica a ${TOL_BETTI} (difiere ${(asim / fMax).toExponential(1)}): el sistema está mal condicionado y los modos pierden precisión.`,
      undefined,
      { asimetria: asim / fMax },
    );
  }
  const Fs = new Float64Array(nd * nd);
  for (let i = 0; i < nd; i++) for (let j = 0; j < nd; j++) Fs[nd * i + j] = 0.5 * (F[nd * i + j]! + F[nd * j + i]!);
  // G = F·L (nd × r) y A = Lᵀ·G (r × r)
  const G = new Float64Array(nd * r);
  for (let i = 0; i < nd; i++) {
    for (let k = 0; k < nd; k++) {
      const fik = Fs[nd * i + k]!;
      if (fik === 0) continue;
      for (let j = 0; j < r; j++) G[r * i + j]! += fik * L[r * k + j]!;
    }
  }
  const A = new Float64Array(r * r);
  for (let k = 0; k < nd; k++) {
    for (let i = 0; i < r; i++) {
      const lki = L[r * k + i]!;
      if (lki === 0) continue;
      for (let j = 0; j < r; j++) A[r * i + j]! += lki * G[r * k + j]!;
    }
  }
  for (let i = 0; i < r; i++) for (let j = 0; j < i; j++) A[r * i + j] = A[r * j + i] = 0.5 * (A[r * i + j]! + A[r * j + i]!);
  const { valores, vectores } = jacobi(A, r);
  let lMax = 0;
  for (let i = 0; i < r; i++) lMax = Math.max(lMax, valores[i]!);
  if (!(lMax > 0)) {
    diag.error("modal/flexibilidad-no-valida", "La flexibilidad condensada del análisis modal no es definida positiva.");
    return null;
  }
  // Residuo del problema propio, con la A de antes de girarla
  let residuo = 0;
  for (let k = 0; k < r; k++) {
    for (let i = 0; i < r; i++) {
      let s = -valores[k]! * vectores[r * i + k]!;
      for (let j = 0; j < r; j++) s += A[r * i + j]! * vectores[r * j + k]!;
      residuo = Math.max(residuo, Math.abs(s));
    }
  }
  if (!(residuo <= TOL_PROPIO * lMax)) {
    diag.error("modal/no-converge", `El problema de valores propios del análisis modal no converge (residuo ${(residuo / lMax).toExponential(1)}).`, undefined, { residuo: residuo / lMax });
    return null;
  }
  // Direcciones: X, Y y el giro alrededor del centro de masas; Lᵀ·r de cada una y su masa total
  const LtR = [new Float64Array(r), new Float64Array(r), new Float64Array(r)];
  for (let i = 0; i < nd; i++) {
    const c = plan.componente[i]!;
    const rk = [c === 0 ? 1 : 0, c === 1 ? 1 : 0, c === 0 ? -(xy[2 * i + 1]! - plan.cm[1]) : c === 1 ? xy[2 * i]! - plan.cm[0] : 1];
    for (let k = 0; k < 3; k++) if (rk[k] !== 0) for (let j = 0; j < r; j++) LtR[k]![j]! += L[r * i + j]! * rk[k]!;
  }
  const totales = LtR.map((v) => v.reduce((s, x) => s + x * x, 0));
  const modos: ModoCondensado[] = [];
  for (let k = 0; k < r; k++) {
    const lambda = valores[k]!;
    if (!(lambda > LAMBDA_NULO * lMax)) continue;
    const f = new Float64Array(nd);
    const phi = new Float64Array(nd);
    for (let i = 0; i < nd; i++) {
      let [sf, sp] = [0, 0];
      for (let j = 0; j < r; j++) {
        const y = vectores[r * j + k]!;
        sf += L[r * i + j]! * y;
        sp += G[r * i + j]! * y;
      }
      f[i] = sf / lambda;
      phi[i] = sp / lambda;
    }
    const gamma = LtR.map((v) => v.reduce((s, x, j) => s + x * vectores[r * j + k]!, 0)) as [number, number, number];
    const efectiva = gamma.map((gk, i) => (totales[i]! > 0 ? (gk * gk) / totales[i]! : 0)) as [number, number, number];
    // Signo: Γ ≥ 0 en la dirección de traslación con más masa efectiva; si no se traslada, en el giro
    const d = Math.max(efectiva[0], efectiva[1]) > 1e-12 ? (efectiva[0] >= efectiva[1] ? 0 : 1) : 2;
    if (gamma[d]! < 0) {
      for (let i = 0; i < nd; i++) {
        f[i] = -f[i]!;
        phi[i] = -phi[i]!;
      }
      for (let i = 0; i < 3; i++) gamma[i] = -gamma[i]!;
    }
    modos.push({ omega2: 1 / lambda, f, phi, participacion: gamma, masaEfectiva: efectiva });
  }
  return modos.sort((a, b) => a.omega2 - b.omega2);
}

/**
 * Valores y vectores propios de una matriz simétrica (n × n, por filas) por Jacobi cíclico. No toca
 * `A`. Los vectores van por columnas: `vectores[n·i + k]` es la componente i del vector k.
 */
export function jacobi(A: Float64Array, n: number): { valores: Float64Array; vectores: Float64Array } {
  const a = A.slice();
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[n * i + i] = 1;
  for (let barrido = 0; barrido < 100; barrido++) {
    let fuera = 0;
    let diagonal = 0;
    for (let p = 0; p < n; p++) for (let q = 0; q < n; q++) (p === q ? (diagonal += a[n * p + q]! ** 2) : (fuera += a[n * p + q]! ** 2));
    if (fuera <= 1e-32 * diagonal) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[n * p + q]!;
        if (apq === 0) continue;
        const theta = (a[n * q + q]! - a[n * p + p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[n * k + p]!;
          const akq = a[n * k + q]!;
          a[n * k + p] = c * akp - s * akq;
          a[n * k + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[n * p + k]!;
          const aqk = a[n * q + k]!;
          a[n * p + k] = c * apk - s * aqk;
          a[n * q + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[n * k + p]!;
          const vkq = v[n * k + q]!;
          v[n * k + p] = c * vkp - s * vkq;
          v[n * k + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const valores = new Float64Array(n);
  for (let i = 0; i < n; i++) valores[i] = a[n * i + i]!;
  return { valores, vectores: v };
}
