/**
 * Fase CO (`docs/fem3d/comprobaciones.md` §4.4): el armado en barras, como dato.
 *
 * Va en el `proyecto.json` fuera del modelo (`armado.pilares`, `armado.vigas`, y los datos comunes en `obra.armado`):
 * no entra en la huella ni en el cálculo, así que cambiarlo no recalcula.
 *
 * Sólo tipos y cuentas de barras: sin las copias de Concreta, para que lo use también el proyecto.
 * Unidades: mm y MPa.
 */

/** Barras intermedias de una cara, entre las de esquina; o las del anillo de un pilar circular. */
export interface BarrasCara {
  n: number;
  /** Ø, mm. */
  diametro: number;
}

export interface Cercos {
  /** Ø, mm. */
  diametro: number;
  /** Separación, mm. */
  separacion: number;
}

/** El armado de un tramo de pilar. Rectangular: `esquinas`, `caraB` y `caraH`; circular: `anillo`. */
export interface ArmadoTramoPilar {
  /** Ø de las cuatro barras de esquina, mm. */
  esquinas?: number;
  /** Intermedias en cada una de las dos caras de ancho b (las que trabajan con My, el canto h). */
  caraB?: BarrasCara;
  /** Intermedias en cada una de las dos caras de canto h (las que trabajan con Mz). */
  caraH?: BarrasCara;
  /** Barras repartidas en el anillo de una sección circular. */
  anillo?: BarrasCara;
  cercos: Cercos;
}

/** Clases de exposición del módulo de vigas: fijan la abertura de fisura admisible (CE A19 tabla 7.1N). */
export const EXPOSICIONES = ["XC1", "XC2", "XC3", "XC4"] as const;
export type Exposicion = (typeof EXPOSICIONES)[number];

/** Los límites de la flecha activa del DB SE 4.3.3.1(1): L/500 (tabiques frágiles), L/400 (ordinarios) o L/300. */
export const FLECHAS_ACTIVAS = [300, 400, 500] as const;

/** Lo común a todas las piezas de hormigón de la obra (`obra.armado`). Lo que falta, `DATOS_ARMADO`. */
export interface DatosArmado {
  /** Límite elástico del acero de las armaduras, MPa. */
  fyk?: number;
  /** Recubrimiento geométrico hasta el cerco, mm. */
  recubrimiento?: number;
  /** Coeficiente de fluencia efectivo φef: el de los pilares (CE A19 5.37) y el de la flecha diferida de las vigas (§7.4.3). */
  phiEf?: number;
  /** CO2: clase de exposición, para la abertura de fisura admisible de las vigas (XC1, 0,4 mm; las demás, 0,3 mm). */
  exposicion?: Exposicion;
  /** CO2: el denominador del límite de la flecha activa de las vigas, L/… (DB SE 4.3.3.1(1)): 300, 400 o 500. */
  flechaActiva?: number;
}

export const DATOS_ARMADO: Required<DatosArmado> = { fyk: 500, recubrimiento: 30, phiEf: 2, exposicion: "XC2", flechaActiva: 400 };

/** El armado de un tramo con los datos de la obra: lo que se le da a la comprobación. */
export interface ArmadoPilar extends ArmadoTramoPilar {
  recubrimiento: number;
  fyk: number;
  /** Sin él, el 2 del módulo. */
  phiEf?: number;
}

export function armadoPilar(t: ArmadoTramoPilar, d?: DatosArmado): ArmadoPilar {
  return { ...t, recubrimiento: d?.recubrimiento ?? DATOS_ARMADO.recubrimiento, fyk: d?.fyk ?? DATOS_ARMADO.fyk, phiEf: d?.phiEf ?? DATOS_ARMADO.phiEf };
}

const area = (d: number) => (Math.PI * d * d) / 4;

/** Barras longitudinales de un tramo. */
export function barrasDe(t: ArmadoTramoPilar): number {
  return t.anillo ? t.anillo.n : 4 + 2 * (t.caraB?.n ?? 0) + 2 * (t.caraH?.n ?? 0);
}

/** Área de la armadura longitudinal, mm² (nominal: π·Ø²/4). */
export function areaDe(t: ArmadoTramoPilar): number {
  if (t.anillo) return t.anillo.n * area(t.anillo.diametro);
  return 4 * area(t.esquinas ?? 0) + 2 * (t.caraB?.n ?? 0) * area(t.caraB?.diametro ?? 0) + 2 * (t.caraH?.n ?? 0) * area(t.caraH?.diametro ?? 0);
}

/** «4Ø16 + 4Ø12 (caras b) · cØ6/100», para una tabla o un texto. */
export function textoArmado(t: ArmadoTramoPilar): string {
  const partes: string[] = [];
  if (t.anillo) partes.push(`${t.anillo.n}Ø${t.anillo.diametro}`);
  else {
    partes.push(`4Ø${t.esquinas ?? 0}`);
    if (t.caraB?.n) partes.push(`${2 * t.caraB.n}Ø${t.caraB.diametro} (caras b)`);
    if (t.caraH?.n) partes.push(`${2 * t.caraH.n}Ø${t.caraH.diametro} (caras h)`);
  }
  return `${partes.join(" + ")} · cØ${t.cercos.diametro}/${t.cercos.separacion}`;
}

const DIAMETROS = [6, 8, 10, 12, 16, 20, 25, 32];

/** Lo que no vale de un armado de tramo, en palabras; vacío si es un dato admisible. */
export function erroresArmado(t: ArmadoTramoPilar): string[] {
  const r: string[] = [];
  const diam = (d: number | undefined, que: string) => {
    if (d === undefined || !DIAMETROS.includes(d)) r.push(`${que}: Ø${String(d)} no es un diámetro de barra (${DIAMETROS.join(", ")})`);
  };
  const cara = (c: BarrasCara | undefined, que: string, minimo: number) => {
    if (!c) return;
    if (!(Number.isInteger(c.n) && c.n >= minimo)) r.push(`${que}: ${String(c.n)} barras no vale (un entero ≥ ${minimo})`);
    if (c.n > 0 || minimo > 0) diam(c.diametro, que);
  };
  if (t.anillo) {
    cara(t.anillo, "el anillo", 1);
    if (t.esquinas !== undefined || t.caraB || t.caraH) r.push("un anillo (sección circular) no lleva esquinas ni caras");
  } else {
    diam(t.esquinas, "las esquinas");
    cara(t.caraB, "las caras b", 0);
    cara(t.caraH, "las caras h", 0);
  }
  if (!t.cercos) r.push("faltan los cercos");
  else {
    diam(t.cercos.diametro, "los cercos");
    if (!(Number.isFinite(t.cercos.separacion) && t.cercos.separacion > 0)) r.push(`los cercos: la separación ${String(t.cercos.separacion)} no vale (mm, > 0)`);
  }
  return r;
}

// ─── Vigas (CO2) ────────────────────────────────────────────────────────────────────────────────

/** Los cercos de una viga: con sus ramas verticales (por defecto, 2). */
export interface CercosViga extends Cercos {
  ramas?: number;
}

/**
 * El armado de un vano de viga (CO2). El módulo de vigas toma, en cada cara, n barras de un mismo
 * diámetro: no se mezclan diámetros en una cara.
 *
 * El vano va en tres zonas: el cuarto de su luz junto a cada apoyo (`inicio` y `fin`, en el sentido
 * de la viga) y el centro. La armadura inferior y la superior son corridas en todo el vano; en los
 * apoyos, la superior puede ser otra (`superiorInicio`, `superiorFin`: el total de esa zona, no un
 * refuerzo que se suma), y los cercos, otros.
 */
export interface ArmadoVanoViga {
  /** Cara inferior, en todo el vano. */
  inferior: BarrasCara;
  /** Cara superior, corrida: la de la zona central (el montaje). */
  superior: BarrasCara;
  /** Cara superior en el cuarto del vano junto a su apoyo de inicio; sin ella, `superior`. */
  superiorInicio?: BarrasCara;
  /** Cara superior en el cuarto junto al apoyo del fin; sin ella, `superior`. */
  superiorFin?: BarrasCara;
  /** Cercos de la zona central (y de todo el vano, si no se dan los de los apoyos). */
  cercos: CercosViga;
  cercosInicio?: CercosViga;
  cercosFin?: CercosViga;
  /**
   * Barras en cada cara lateral, entre la armadura superior y la inferior (n por cara). Sólo cuentan
   * para la separación de las barras de una viga con torsión de equilibrio (CE A19 §9.2.3(4)).
   */
  piel?: BarrasCara;
}

/** El armado de un vano con los datos de la obra: lo que se le da a la comprobación. */
export interface ArmadoViga extends ArmadoVanoViga {
  recubrimiento: number;
  fyk: number;
  phiEf: number;
  exposicion: Exposicion;
  flechaActiva: number;
}

export function armadoViga(t: ArmadoVanoViga, d?: DatosArmado): ArmadoViga {
  return {
    ...t,
    recubrimiento: d?.recubrimiento ?? DATOS_ARMADO.recubrimiento,
    fyk: d?.fyk ?? DATOS_ARMADO.fyk,
    phiEf: d?.phiEf ?? DATOS_ARMADO.phiEf,
    exposicion: d?.exposicion ?? DATOS_ARMADO.exposicion,
    flechaActiva: d?.flechaActiva ?? DATOS_ARMADO.flechaActiva,
  };
}

export const ramasDe = (c: CercosViga): number => c.ramas ?? 2;

const textoBarras = (b: BarrasCara) => `${b.n}Ø${b.diametro}`;
const textoCercos = (c: CercosViga) => `cØ${c.diametro}/${c.separacion}${ramasDe(c) !== 2 ? ` (${ramasDe(c)}R)` : ""}`;

/** «inf 3Ø16 · sup 2Ø12 (inicio 4Ø16, fin 3Ø16) · cØ8/200 (inicio cØ8/100)», para una tabla o un texto. */
export function textoArmadoViga(t: ArmadoVanoViga): string {
  const apoyos = (i: string | undefined, f: string | undefined) => {
    const p = [...(i ? [`inicio ${i}`] : []), ...(f ? [`fin ${f}`] : [])];
    return p.length ? ` (${p.join(", ")})` : "";
  };
  return [
    `inf ${textoBarras(t.inferior)}`,
    `sup ${textoBarras(t.superior)}${apoyos(t.superiorInicio && textoBarras(t.superiorInicio), t.superiorFin && textoBarras(t.superiorFin))}`,
    `${textoCercos(t.cercos)}${apoyos(t.cercosInicio && textoCercos(t.cercosInicio), t.cercosFin && textoCercos(t.cercosFin))}`,
    ...(t.piel?.n ? [`piel ${textoBarras(t.piel)} por cara`] : []),
  ].join(" · ");
}

/** Acero longitudinal de un vano, mm² (nominal), para ordenar: el corrido más lo que añaden los apoyos, a un cuarto de la luz cada uno. */
export function areaVano(t: ArmadoVanoViga): number {
  const A = (b: BarrasCara) => b.n * area(b.diametro);
  return A(t.inferior) + 0.5 * A(t.superior) + 0.25 * A(t.superiorInicio ?? t.superior) + 0.25 * A(t.superiorFin ?? t.superior) + (t.piel ? 2 * A(t.piel) : 0);
}

/** Lo que no vale del armado de un vano de viga, en palabras; vacío si es un dato admisible. */
export function erroresArmadoViga(t: ArmadoVanoViga): string[] {
  const r: string[] = [];
  const barras = (c: BarrasCara | undefined, que: string, obligatoria: boolean) => {
    if (!c) {
      if (obligatoria) r.push(`falta ${que}`);
      return;
    }
    if (!(Number.isInteger(c.n) && c.n >= 2)) r.push(`${que}: ${String(c.n)} barras no vale (un entero ≥ 2: una en cada esquina del cerco)`);
    if (!DIAMETROS.includes(c.diametro)) r.push(`${que}: Ø${String(c.diametro)} no es un diámetro de barra (${DIAMETROS.join(", ")})`);
  };
  const cercos = (c: CercosViga | undefined, que: string, obligatorios: boolean) => {
    if (!c) {
      if (obligatorios) r.push(`faltan ${que}`);
      return;
    }
    if (!DIAMETROS.includes(c.diametro)) r.push(`${que}: Ø${String(c.diametro)} no es un diámetro de barra (${DIAMETROS.join(", ")})`);
    if (!(Number.isFinite(c.separacion) && c.separacion > 0)) r.push(`${que}: la separación ${String(c.separacion)} no vale (mm, > 0)`);
    if (c.ramas !== undefined && !(Number.isInteger(c.ramas) && c.ramas >= 2)) r.push(`${que}: ${String(c.ramas)} ramas no vale (un entero ≥ 2)`);
  };
  barras(t.inferior, "la armadura inferior", true);
  barras(t.superior, "la armadura superior", true);
  barras(t.superiorInicio, "la armadura superior del inicio", false);
  barras(t.superiorFin, "la armadura superior del fin", false);
  cercos(t.cercos, "los cercos", true);
  cercos(t.cercosInicio, "los cercos del inicio", false);
  cercos(t.cercosFin, "los cercos del fin", false);
  if (t.piel) {
    if (!(Number.isInteger(t.piel.n) && t.piel.n >= 0)) r.push(`las barras de piel: ${String(t.piel.n)} por cara no vale (un entero ≥ 0)`);
    if (t.piel.n > 0 && !DIAMETROS.includes(t.piel.diametro)) r.push(`las barras de piel: Ø${String(t.piel.diametro)} no es un diámetro de barra (${DIAMETROS.join(", ")})`);
  }
  return r;
}
