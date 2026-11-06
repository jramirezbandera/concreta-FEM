/**
 * Análisis por espectros de respuesta (fase VS3, `docs/fem3d/viento-sismo.md` §3.4; NCSE-02, 3.6.2).
 *
 * **Casos base y casos lógicos.** Todo lo que da el motor es lineal en sus casos, y cada modo de
 * vibración es un caso más: la respuesta estática a sus fuerzas de inercia (`ModoVibracion`), con
 * sus desplazamientos, reacciones y esfuerzos. Ésos son los **casos base**. El sismo en una
 * dirección no lo es: su valor en cada variable es la combinación de los valores de los modos
 * (3.6.2.4: «para toda variable asociada a cada grado de libertad»), que no es lineal. Es un **caso
 * lógico**: lo que el usuario y el generador de combinaciones llaman un caso (`EX+e`), con su factor.
 * `Superposicion` lleva los factores de los casos lógicos a los valores de los casos base:
 *
 *     valor = Σ_estáticos fₖ·vₖ + Σ_espectrales f_c·[ s·√(Σ xᵢ² + 2·Σ_pares w·(xᵢ·xⱼ)) + Σ tᵢ·vᵢ ],   xᵢ = cᵢ·vᵢ
 *
 * - vᵢ, el valor de la variable en el modo i (normalizado a la masa); cᵢ = Γᵢ·Sa(Tᵢ)/ωᵢ², lo que el
 *   espectro le pide a ese modo en esa dirección (3.6.2.2), de modo que xᵢ es su respuesta;
 * - la regla, la de la norma: raíz de la suma de los cuadrados, y los modos con periodos a menos del
 *   10 % se suman antes en valor absoluto. Aquí, par a par: cada par de modos próximos añade
 *   2·|xᵢ·xⱼ|, que es lo mismo cuando los próximos lo son todos entre sí y no depende de cómo se
 *   agrupen cuando no. O la combinación cuadrática completa del comentario C.3.6.2.4, con w = ρᵢⱼ y
 *   el producto con su signo;
 * - s, el signo de la respuesta del modo de más masa efectiva en la dirección (el mismo para todas
 *   las variables: N, My y Mz de un pilar salen con signos coherentes). El ± del sismo lo dan las
 *   combinaciones;
 * - tᵢ, la parte lineal: el torsor de la excentricidad accidental (art. 3.2), que es un caso estático
 *   y, con todos los modos, se escribe exacto en ellos (un caso estático con fuerzas sólo en los GDL
 *   con masa es Σᵢ modoᵢ·(φᵢᵀ·f)/ωᵢ²);
 * - en los desplazamientos, el valor del caso espectral va multiplicado por μ (3.6.2.2).
 *
 * **Quién resuelve.** Nadie aplica factores a mano: quien tiene un valor por caso base llama a
 * `Superposicion`. Lo que es lineal se hace antes, por caso base (el esfuerzo de una barra, un corte,
 * la media de un campo en una franja, la diferencia de dos desplazamientos), y la combinación de los
 * modos, al final, en la variable que se da: combinar primero los desplazamientos y sacar de ahí los
 * esfuerzos está mal. Sin casos espectrales, `Superposicion` suma en el orden de siempre y da los
 * mismos bits que la suma a mano.
 *
 * Puro: sin la norma (la aceleración de cada modo entra como una función) y sin el modelo físico.
 */
import type { CasoCarga, ModeloAnalitico, ResultadoCaso, ResultadoModal } from "./modelo.ts";

/** Fracción del periodo mayor por debajo de la cual dos modos son próximos (3.6.2.4: «menos del 10 %»). */
export const PROXIMIDAD_PERIODOS = 0.1;

/**
 * Coeficiente de correlación de dos modos de periodos Ti y Tj con el mismo amortiguamiento ζ (en
 * tanto por uno del crítico): la πᵢⱼ del comentario C.3.6.2.4, con f = Ti/Tj. Es simétrica en los dos
 * modos y vale 1 con Ti = Tj.
 */
export function correlacionCqc(Ti: number, Tj: number, zeta: number): number {
  const f = Ti / Tj;
  return (8 * zeta * zeta * (1 + f) * f ** 1.5) / ((1 - f * f) ** 2 + 4 * zeta * zeta * f * (1 + f) ** 2);
}

/** ¿Difieren los dos periodos menos del 10 % (del mayor)? */
export const periodosProximos = (Ti: number, Tj: number): boolean => Math.min(Ti, Tj) > (1 - PROXIMIDAD_PERIODOS) * Math.max(Ti, Tj);

export interface OpcionesRegla {
  /**
   * "srss" (por defecto): la regla del articulado, con los pares de modos próximos sumados en valor
   * absoluto. "cqc": la combinación cuadrática completa, con el amortiguamiento `zeta`.
   */
  tipo?: "srss" | "cqc";
  /** Amortiguamiento, en tanto por uno del crítico (cqc). Por defecto, 0,05. */
  zeta?: number;
  /** srss: cuándo dos modos son próximos. Por defecto, `periodosProximos`. */
  proximos?: (Ti: number, Tj: number) => boolean;
}

/** Los términos cruzados de una regla de combinación: los pares (i < j) con su peso. */
export interface ReglaModal {
  tipo: "srss" | "cqc";
  /** Dos índices de modo por par. */
  pares: Int32Array;
  /** Peso w del par: su término es 2·w·|xᵢ·xⱼ| (srss) o 2·w·xᵢ·xⱼ (cqc). */
  pesos: Float64Array;
}

/** La regla de combinación de unos modos de periodos dados. */
export function reglaModal(periodos: ArrayLike<number>, o: OpcionesRegla = {}): ReglaModal {
  const tipo = o.tipo ?? "srss";
  const pares: number[] = [];
  const pesos: number[] = [];
  const n = periodos.length;
  const proximos = o.proximos ?? periodosProximos;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const w = tipo === "cqc" ? correlacionCqc(periodos[i]!, periodos[j]!, o.zeta ?? 0.05) : proximos(periodos[i]!, periodos[j]!) ? 1 : 0;
      if (w !== 0) {
        pares.push(i, j);
        pesos.push(w);
      }
    }
  return { tipo, pares: Int32Array.from(pares), pesos: Float64Array.from(pesos) };
}

/** La combinación (sin signo, ≥ 0) de las respuestas `x` de los modos con la regla. */
export function combinarModos(x: ArrayLike<number>, regla: ReglaModal): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  const { pares, pesos } = regla;
  if (regla.tipo === "cqc") for (let p = 0; p < pesos.length; p++) s += 2 * pesos[p]! * x[pares[2 * p]!]! * x[pares[2 * p + 1]!]!;
  else for (let p = 0; p < pesos.length; p++) s += 2 * pesos[p]! * Math.abs(x[pares[2 * p]!]! * x[pares[2 * p + 1]!]!);
  // La forma cuadrática de la cqc es semidefinida positiva: un negativo es redondeo
  return s > 0 ? Math.sqrt(s) : s === 0 ? 0 : Number.isNaN(s) ? Number.NaN : 0;
}

// ─── La respuesta en una dirección ──────────────────────────────────────────────────────────────

export interface DireccionEspectral {
  /** Dirección del sismo en planta (unitaria). */
  direccion: readonly [number, number];
  /**
   * Aceleración de cálculo de un modo de periodo T, m/s²: la ordenada del espectro ya reducida por la
   * ductilidad y el amortiguamiento (en la NCSE-02, αᵢ·ac de 3.6.2.2).
   */
  aceleracion: (T: number) => number;
  /** μ: los desplazamientos son μ veces los del espectro reducido (3.6.2.2). Por defecto, 1. */
  ductilidad?: number;
  regla?: OpcionesRegla;
  /**
   * Excentricidad accidental de cada diafragma, m ≥ 0 (en el orden de `modal.diafragmas`). Con ella,
   * el torsor de planta: un par Mz = +F·e en cada diafragma, con F su fuerza equivalente.
   */
  excentricidades?: ArrayLike<number>;
}

/** Un nivel: los diafragmas de una cota, de arriba abajo. */
export interface NivelEspectral {
  z: number;
  /** Sus diafragmas (índices en `modal.diafragmas`). */
  diafragmas: number[];
  /** Masa del nivel, t. */
  masa: number;
  /** Cortante combinado bajo el nivel (el de todo lo que hay en él y por encima), kN. */
  cortante: number;
  /** Fuerza equivalente del nivel, kN: la diferencia de los cortantes combinados (puede salir negativa: la combinación destruye el signo). */
  fuerza: number;
  /** Desplazamiento combinado del nivel en la dirección (el de su centro de masas), m, ya con μ. */
  desplazamiento: number;
  /** Desplazamiento combinado respecto al nivel de debajo (el del más bajo, absoluto), m, ya con μ. */
  deriva: number;
}

export interface RespuestaEspectral {
  direccion: readonly [number, number];
  ductilidad: number;
  /** Por modo: la aceleración de cálculo Sa(Tᵢ), m/s², y cᵢ = Γᵢ·Sa/ωᵢ². */
  aceleraciones: Float64Array;
  coeficientes: Float64Array;
  regla: ReglaModal;
  /** El modo de más masa efectiva en la dirección: el que da el signo. */
  dominante: number;
  /** Fracción de la masa en la dirección de cada modo (suman 1 con todos los modos). */
  masaEfectiva: Float64Array;
  /** Cortante basal de cada modo (con signo) y el combinado, kN. */
  basalModos: Float64Array;
  basal: number;
  niveles: NivelEspectral[];
  /** Fuerza equivalente y par del torsor de cada diafragma (en el orden de `modal.diafragmas`), kN y kN·m. */
  fuerzas: Float64Array;
  pares: Float64Array | null;
  /**
   * El torsor en los modos: tᵢ, con torsor = Σ tᵢ·modoᵢ. null sin excentricidades o si los modos no lo
   * representan (`residuoTorsor`: lo que le falta a Σ tᵢ·fuerzasᵢ para ser los pares, relativo).
   */
  torsor: Float64Array | null;
  residuoTorsor: number;
}

/** Lo que le puede faltar a la reconstrucción del torsor con los modos para darlo por exacto. */
export const TOL_TORSOR = 1e-8;

const TOL_NIVEL = 1e-6;

/** La respuesta espectral del edificio (sus modos) en una dirección. */
export function respuestaEspectral(modal: ResultadoModal, d: DireccionEspectral): RespuestaEspectral {
  const { modos, diafragmas } = modal;
  const nm = modos.length;
  const nd = diafragmas.length;
  const [dx, dy] = d.direccion;
  const mu = d.ductilidad ?? 1;
  const aceleraciones = new Float64Array(nm);
  const coeficientes = new Float64Array(nm);
  const masaEfectiva = new Float64Array(nm);
  let gamma2 = 0;
  for (let i = 0; i < nm; i++) {
    const m = modos[i]!;
    const gamma = dx * m.participacion[0] + dy * m.participacion[1];
    aceleraciones[i] = d.aceleracion(m.periodo);
    coeficientes[i] = (gamma * aceleraciones[i]!) / m.omega2;
    masaEfectiva[i] = gamma * gamma;
    gamma2 += gamma * gamma;
  }
  let dominante = 0;
  for (let i = 0; i < nm; i++) {
    if (gamma2 > 0) masaEfectiva[i]! /= gamma2;
    if (masaEfectiva[i]! > masaEfectiva[dominante]!) dominante = i;
  }
  const regla = reglaModal(
    modos.map((m) => m.periodo),
    d.regla,
  );

  // Niveles, de arriba abajo
  const orden = diafragmas.map((_, k) => k).sort((a, b) => diafragmas[b]!.z - diafragmas[a]!.z || a - b);
  const niveles: NivelEspectral[] = [];
  for (const k of orden) {
    const z = diafragmas[k]!.z;
    let nivel = niveles[niveles.length - 1];
    if (!nivel || nivel.z - z > TOL_NIVEL * Math.max(1, Math.abs(z))) niveles.push((nivel = { z, diafragmas: [], masa: 0, cortante: 0, fuerza: 0, desplazamiento: 0, deriva: 0 }));
    nivel.diafragmas.push(k);
    nivel.masa += diafragmas[k]!.masa;
  }
  // Por modo: la fuerza de cada diafragma en la dirección y el desplazamiento de su centro de masas
  const fuerzaModo = (i: number, k: number) => coeficientes[i]! * (dx * modos[i]!.fuerzas[3 * k]! + dy * modos[i]!.fuerzas[3 * k + 1]!);
  const despModo = (i: number, k: number) => coeficientes[i]! * (dx * modos[i]!.forma[3 * k]! + dy * modos[i]!.forma[3 * k + 1]!);
  /** Desplazamiento del nivel en el modo i: la media de sus diafragmas, con su masa. */
  const despNivel = (i: number, nivel: NivelEspectral) => {
    if (nivel.diafragmas.length === 1) return despModo(i, nivel.diafragmas[0]!);
    let [s, m] = [0, 0];
    for (const k of nivel.diafragmas) {
      const w = diafragmas[k]!.masa;
      s += w * despModo(i, k);
      m += w;
    }
    return m > 0 ? s / m : 0;
  };
  const x = new Float64Array(nm);
  const acumulado = new Float64Array(nm);
  niveles.forEach((nivel, n) => {
    for (let i = 0; i < nm; i++) for (const k of nivel.diafragmas) acumulado[i]! += fuerzaModo(i, k);
    nivel.cortante = combinarModos(acumulado, regla);
    nivel.fuerza = nivel.cortante - (n > 0 ? niveles[n - 1]!.cortante : 0);
    for (let i = 0; i < nm; i++) x[i] = despNivel(i, nivel);
    nivel.desplazamiento = mu * combinarModos(x, regla);
    const debajo = niveles[n + 1];
    if (debajo) for (let i = 0; i < nm; i++) x[i]! -= despNivel(i, debajo);
    nivel.deriva = mu * combinarModos(x, regla);
  });
  const basalModos = Float64Array.from(acumulado);
  const basal = niveles.length ? niveles[niveles.length - 1]!.cortante : 0;

  // Fuerza equivalente de cada diafragma: la de su nivel; con varios en una cota, en proporción a la suya combinada
  const fuerzas = new Float64Array(nd);
  for (const nivel of niveles) {
    if (nivel.diafragmas.length === 1) {
      fuerzas[nivel.diafragmas[0]!] = nivel.fuerza;
      continue;
    }
    const propias = nivel.diafragmas.map((k) => {
      for (let i = 0; i < nm; i++) x[i] = fuerzaModo(i, k);
      return combinarModos(x, regla);
    });
    const suma = propias.reduce((s, v) => s + v, 0);
    nivel.diafragmas.forEach((k, j) => (fuerzas[k] = suma > 0 ? (nivel.fuerza * propias[j]!) / suma : nivel.fuerza / nivel.diafragmas.length));
  }

  // El torsor de la excentricidad accidental, en los modos
  let pares: Float64Array | null = null;
  let torsor: Float64Array | null = null;
  let residuoTorsor = 0;
  if (d.excentricidades) {
    if (d.excentricidades.length !== nd) throw new Error(`respuestaEspectral: ${d.excentricidades.length} excentricidades para ${nd} diafragmas`);
    pares = new Float64Array(nd);
    let escala = 0;
    for (let k = 0; k < nd; k++) {
      pares[k] = fuerzas[k]! * d.excentricidades[k]!;
      escala = Math.max(escala, Math.abs(pares[k]!));
    }
    torsor = new Float64Array(nm);
    if (escala > 0) {
      for (let i = 0; i < nm; i++) {
        let s = 0;
        for (let k = 0; k < nd; k++) s += modos[i]!.forma[3 * k + 2]! * pares[k]!;
        torsor[i] = s / modos[i]!.omega2;
      }
      // Lo que reconstruyen los modos: Σ tᵢ·fuerzasᵢ tiene que ser [0, 0, par] en cada diafragma
      const longitud = Math.max(1, ...diafragmas.map((df) => (df.masa > 0 ? Math.sqrt(df.J / df.masa) : 0)));
      for (let k = 0; k < nd; k++) {
        let [fx, fy, mz] = [0, 0, 0];
        for (let i = 0; i < nm; i++) {
          const t = torsor[i]!;
          fx += t * modos[i]!.fuerzas[3 * k]!;
          fy += t * modos[i]!.fuerzas[3 * k + 1]!;
          mz += t * modos[i]!.fuerzas[3 * k + 2]!;
        }
        residuoTorsor = Math.max(residuoTorsor, (Math.abs(fx) * longitud) / escala, (Math.abs(fy) * longitud) / escala, Math.abs(mz - pares[k]!) / escala);
      }
      if (!(residuoTorsor <= TOL_TORSOR)) torsor = null;
    }
  }
  return { direccion: [dx, dy], ductilidad: mu, aceleraciones, coeficientes, regla, dominante, masaEfectiva, basalModos, basal, niveles, fuerzas, pares, torsor, residuoTorsor };
}

// ─── Casos base y casos lógicos ─────────────────────────────────────────────────────────────────

/** Un caso espectral: la combinación de unos casos base (los modos). */
export interface CasoEspectral {
  /** Índice del caso base de cada modo. */
  modos: Int32Array;
  /** cᵢ de cada modo: su respuesta es cᵢ·(su caso base). */
  coeficientes: Float64Array;
  regla: ReglaModal;
  /** El modo que da el signo (índice en `modos`). */
  dominante: number;
  /** Parte lineal: Σ tᵢ·(caso base del modo i). El torsor de la excentricidad accidental, con su signo. */
  lineal: Float64Array | null;
  /** μ: factor de los desplazamientos. */
  ductilidad: number;
}

/** Una combinación partida: los factores de los casos base de su parte lineal y sus casos espectrales. */
export interface PartesCombinacion {
  lineal: Float64Array;
  espectrales: { factor: number; caso: CasoEspectral }[];
}

/** Un caso lógico: un caso base (estático) o uno espectral. */
export type CasoLogico = { id: string; base: number; espectral?: undefined } | { id: string; base?: undefined; espectral: CasoEspectral };

/**
 * El valor de un caso espectral con los valores `v` de sus modos (en el orden de `c.modos`). `x` es
 * memoria de trabajo (al menos un número por modo). `dominante`: la respuesta del modo dominante de la
 * que se toma el signo, si no es la suya en `v` (en un diagrama, la de un poco al lado del punto).
 */
export function valorEspectral(c: CasoEspectral, v: ArrayLike<number>, x: Float64Array, desplazamiento = false, dominante?: number): number {
  const n = c.modos.length;
  for (let i = 0; i < n; i++) x[i] = c.coeficientes[i]! * v[i]!;
  let r = combinarModos(x.length === n ? x : x.subarray(0, n), c.regla);
  if ((dominante ?? x[c.dominante]!) < 0) r = -r;
  if (c.lineal) for (let i = 0; i < n; i++) if (c.lineal[i]) r += c.lineal[i]! * v[i]!;
  return desplazamiento ? c.ductilidad * r : r;
}

/**
 * La superposición de los casos lógicos sobre los casos base (cabecera). Los `factores` de todos sus
 * métodos son los de los casos lógicos, en su orden: uno por caso, los del generador de
 * combinaciones o los de un caso suelto.
 */
export class Superposicion {
  /** Casos base: los resultados que hay, lineales. */
  readonly nb: number;
  readonly logicos: readonly CasoLogico[];
  /** ¿Hay algún caso espectral? */
  readonly conEspectrales: boolean;
  private readonly x: Float64Array;
  private readonly v: Float64Array;

  constructor(nb: number, logicos: readonly CasoLogico[]) {
    this.nb = nb;
    this.logicos = logicos;
    let maxModos = 0;
    for (const c of logicos) {
      if (c.espectral) {
        const e = c.espectral;
        maxModos = Math.max(maxModos, e.modos.length);
        if (e.coeficientes.length !== e.modos.length || (e.lineal && e.lineal.length !== e.modos.length) || !(e.dominante >= 0 && e.dominante < e.modos.length)) throw new Error(`Superposicion: el caso espectral ${c.id} no es coherente`);
        for (const b of e.modos) if (!(b >= 0 && b < nb)) throw new Error(`Superposicion: el caso espectral ${c.id} nombra el caso base ${b} y hay ${nb}`);
      } else if (!(Number.isInteger(c.base) && c.base >= 0 && c.base < nb)) throw new Error(`Superposicion: el caso ${c.id} nombra el caso base ${c.base} y hay ${nb}`);
    }
    this.conEspectrales = maxModos > 0;
    this.x = new Float64Array(maxModos);
    this.v = new Float64Array(maxModos);
  }

  /** Sin casos espectrales: cada caso lógico es su caso base. */
  static directa(ids: readonly string[]): Superposicion {
    return new Superposicion(
      ids.length,
      ids.map((id, base) => ({ id, base })),
    );
  }

  /** Casos lógicos: los que llevan factor. */
  get nl(): number {
    return this.logicos.length;
  }

  /** null si los factores valen (uno finito por caso lógico); si no, por qué no. */
  defecto(factores: ArrayLike<number>): string | null {
    if (factores.length !== this.nl) return `hay ${factores.length} factores para ${this.nl} casos`;
    for (let k = 0; k < this.nl; k++) if (!Number.isFinite(factores[k])) return `el factor del caso ${this.logicos[k]!.id} no es un número finito`;
    return null;
  }

  private comprobar(factores: ArrayLike<number>): void {
    if (factores.length !== this.nl) throw new Error(`Superposicion: ${factores.length} factores para ${this.nl} casos (${this.logicos.map((c) => c.id).join(", ")})`);
  }

  /** ¿Es lineal la combinación: ningún caso espectral con factor? */
  esLineal(factores: ArrayLike<number>): boolean {
    this.comprobar(factores);
    if (!this.conEspectrales) return true;
    for (let k = 0; k < this.nl; k++) if (factores[k] && this.logicos[k]!.espectral) return false;
    return true;
  }

  /** Los casos base que hacen falta para la combinación, en orden. */
  bases(factores: ArrayLike<number>): number[] {
    this.comprobar(factores);
    const usa = new Uint8Array(this.nb);
    for (let k = 0; k < this.nl; k++) {
      if (!factores[k]) continue;
      const c = this.logicos[k]!;
      if (c.espectral) for (const b of c.espectral.modos) usa[b] = 1;
      else usa[c.base] = 1;
    }
    const r: number[] = [];
    for (let b = 0; b < this.nb; b++) if (usa[b]) r.push(b);
    return r;
  }

  /**
   * La parte lineal de la combinación como factores de los casos base (los de sus casos estáticos), y
   * sus casos espectrales con su factor. Quien ya suma por caso con sus factores sigue igual con
   * `lineal` (uno por caso base; los mismos bits sin espectrales) y añade `deEspectrales`.
   */
  partes(factores: ArrayLike<number>): PartesCombinacion {
    this.comprobar(factores);
    const lineal = new Float64Array(this.nb);
    const espectrales: { factor: number; caso: CasoEspectral }[] = [];
    for (let k = 0; k < this.nl; k++) {
      const f = factores[k]!;
      if (!f) continue;
      const c = this.logicos[k]!;
      if (c.espectral) espectrales.push({ factor: f, caso: c.espectral });
      else lineal[c.base]! += f;
    }
    return { lineal, espectrales };
  }

  /**
   * Lo que los casos espectrales de una combinación (`partes`) añaden al valor de una variable:
   * `base(b)` da su valor en el caso base b. 0 si no lleva ninguno.
   */
  deEspectrales(p: PartesCombinacion, base: (b: number) => number, desplazamiento = false): number {
    let s = 0;
    for (const { factor, caso } of p.espectrales) {
      const v = this.v;
      for (let i = 0; i < caso.modos.length; i++) v[i] = base(caso.modos[i]!);
      s += factor * valorEspectral(caso, v, this.x, desplazamiento);
    }
    return s;
  }

  /**
   * `deEspectrales`, elemento a elemento, de un vector de N valores por caso base: `base(b)` da el del
   * caso base b. Con `desde` y `paso`, de cada vector sólo los elementos desde + paso·j (j < N).
   */
  deEspectralesVector(p: PartesCombinacion, base: (b: number) => ArrayLike<number>, N: number, desplazamiento = false, desde = 0, paso = 1): Float64Array {
    const r = new Float64Array(N);
    for (const { factor, caso } of p.espectrales) {
      const as = Array.from(caso.modos, (b) => base(b));
      const v = this.v;
      for (let j = 0; j < N; j++) {
        const q = desde + paso * j;
        for (let i = 0; i < as.length; i++) v[i] = as[i]![q]!;
        r[j]! += factor * valorEspectral(caso, v, this.x, desplazamiento);
      }
    }
    return r;
  }

  /**
   * El valor de la combinación de una variable: `base(b)` da su valor en el caso base b (se llama sólo
   * con los que hacen falta). `desplazamiento`: la variable es un desplazamiento o un giro (los de los
   * casos espectrales van por μ).
   */
  valor(factores: ArrayLike<number>, base: (b: number) => number, desplazamiento = false): number {
    this.comprobar(factores);
    let s = 0;
    for (let k = 0; k < this.nl; k++) {
      const f = factores[k]!;
      if (!f) continue;
      const c = this.logicos[k]!;
      if (!c.espectral) {
        s += f * base(c.base);
        continue;
      }
      const e = c.espectral;
      const v = this.v;
      for (let i = 0; i < e.modos.length; i++) v[i] = base(e.modos[i]!);
      s += f * valorEspectral(e, v, this.x, desplazamiento);
    }
    return s;
  }

  /**
   * La combinación de un vector por caso base (n valores del caso base 0, n del 1…), como el
   * `combinar` de siempre: n valores.
   */
  combinar(porBase: ArrayLike<number>, n: number, factores: ArrayLike<number>, desplazamiento = false): Float64Array {
    this.comprobar(factores);
    if (porBase.length !== n * this.nb) throw new Error(`Superposicion.combinar: ${porBase.length} valores no son ${n} por cada uno de los ${this.nb} casos base`);
    const r = new Float64Array(n);
    for (let k = 0; k < this.nl; k++) {
      const f = factores[k]!;
      if (!f) continue;
      const c = this.logicos[k]!;
      if (!c.espectral) {
        const o = n * c.base;
        for (let q = 0; q < n; q++) r[q]! += f * porBase[o + q]!;
        continue;
      }
      const e = c.espectral;
      const v = this.v;
      for (let q = 0; q < n; q++) {
        for (let i = 0; i < e.modos.length; i++) v[i] = porBase[n * e.modos[i]! + q]!;
        r[q]! += f * valorEspectral(e, v, this.x, desplazamiento);
      }
    }
    return r;
  }

  /**
   * La combinación, elemento a elemento, de un vector de N valores por caso base: `base(b)` da el del
   * caso base b (sólo se piden los que hacen falta). Con `paso` y `desde`, de cada vector sólo los
   * elementos desde + paso·j (j < N).
   */
  vector(factores: ArrayLike<number>, base: (b: number) => ArrayLike<number>, N: number, desplazamiento = false, desde = 0, paso = 1): Float64Array {
    this.comprobar(factores);
    const r = new Float64Array(N);
    for (let k = 0; k < this.nl; k++) {
      const f = factores[k]!;
      if (!f) continue;
      const c = this.logicos[k]!;
      if (!c.espectral) {
        const a = base(c.base);
        for (let j = 0; j < N; j++) r[j]! += f * a[desde + paso * j]!;
        continue;
      }
      const e = c.espectral;
      const as = Array.from(e.modos, (b) => base(b));
      const v = this.v;
      for (let j = 0; j < N; j++) {
        const p = desde + paso * j;
        for (let i = 0; i < as.length; i++) v[i] = as[i]![p]!;
        r[j]! += f * valorEspectral(e, v, this.x, desplazamiento);
      }
    }
    return r;
  }

  /** Factores de un caso lógico suelto. */
  factoresCaso(k: number): Float64Array {
    const f = new Float64Array(this.nl);
    f[k] = 1;
    return f;
  }

  /**
   * Los valores por caso lógico de un vector por caso base (n por caso): cada caso espectral, ya
   * combinado. Con ellos, una combinación es lineal: Σ factor·valor.
   */
  porLogico(porBase: ArrayLike<number>, n: number, desplazamiento = false): Float64Array {
    if (porBase.length !== n * this.nb) throw new Error(`Superposicion.porLogico: ${porBase.length} valores no son ${n} por cada uno de los ${this.nb} casos base`);
    const r = new Float64Array(n * this.nl);
    this.logicos.forEach((c, k) => {
      if (!c.espectral) {
        for (let q = 0; q < n; q++) r[n * k + q] = porBase[n * c.base + q]!;
        return;
      }
      const e = c.espectral;
      const v = this.v;
      for (let q = 0; q < n; q++) {
        for (let i = 0; i < e.modos.length; i++) v[i] = porBase[n * e.modos[i]! + q]!;
        r[n * k + q] = valorEspectral(e, v, this.x, desplazamiento);
      }
    });
    return r;
  }
}

// ─── Los modos como casos ───────────────────────────────────────────────────────────────────────

/** Id del caso base de un modo (1 es el de mayor periodo). */
export const idCasoModal = (i: number): string => `modo-${i + 1}`;

/**
 * Los modos como casos: las cargas de cada uno (sus fuerzas de inercia sobre el maestro de cada
 * diafragma) y sus resultados. Detrás de los casos del modelo, todo lo que trabaja por caso
 * (diagramas, campos, cortes) los trata como a los demás.
 */
export function casosModales(modal: ResultadoModal): { casos: CasoCarga[]; resultados: ResultadoCaso[] } {
  const casos: CasoCarga[] = [];
  const resultados: ResultadoCaso[] = [];
  modal.modos.forEach((m, i) => {
    const nodales: { nudo: number; f: readonly [number, number, number, number, number, number] }[] = [];
    modal.diafragmas.forEach((df, k) => {
      const [fx, fy, mz] = [m.fuerzas[3 * k]!, m.fuerzas[3 * k + 1]!, m.fuerzas[3 * k + 2]!];
      if (fx !== 0 || fy !== 0 || mz !== 0) nodales.push({ nudo: df.maestro, f: [fx, fy, 0, 0, 0, mz] });
    });
    casos.push({ id: idCasoModal(i), nodales });
    resultados.push({ id: idCasoModal(i), u: m.u, reacciones: m.reacciones, esfuerzosBarras: m.esfuerzosBarras, esfuerzosLaminas: m.esfuerzosLaminas, equilibrio: m.equilibrio, residuo: modal.residuo });
  });
  return { casos, resultados };
}

/** El modelo con los casos de los modos detrás de los suyos, y sin `modal` (ya está calculado). */
export function modeloConModos(modelo: ModeloAnalitico, casos: readonly CasoCarga[]): ModeloAnalitico {
  const { modal: _m, ...resto } = modelo;
  void _m;
  return { ...resto, casos: [...modelo.casos, ...casos] };
}
