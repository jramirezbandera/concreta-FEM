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

// ─── Forjados (CO3) ─────────────────────────────────────────────────────────────────────────────

/** Las cuatro armaduras de una losa: X (su dirección 1) o Y (la 2), inferior o superior (las de `agente/armaduraBase.ts`). */
export type ArmaduraForjado = "x-inf" | "x-sup" | "y-inf" | "y-sup";
export const ARMADURAS_FORJADO: readonly ArmaduraForjado[] = ["x-inf", "x-sup", "y-inf", "y-sup"];

/**
 * Barras de una armadura de un forjado: en una losa maciza y en los ábacos de un reticular, un
 * diámetro a una separación (mm); en los nervios de un reticular, `n` barras por nervio.
 */
export interface BarrasForjado {
  /** Ø, mm. */
  diametro: number;
  /** Separación entre barras, mm (maciza y ábacos). */
  separacion?: number;
  /** Barras por nervio (reticular). */
  n?: number;
}

/**
 * Un refuerzo: barras que se suman a la base en un rectángulo de la losa, en los ejes de su armadura
 * (s a lo largo de las barras y t en transversal: s = p·d y t = p·n, con d según el eje 1 de la losa
 * en las armaduras X y según el 2 en las Y; m). Cubre las estaciones de las franjas de esa dirección
 * con s en [s0, s1] y el centro de la franja en [t0, t1].
 */
export interface RefuerzoForjado {
  armadura: ArmaduraForjado;
  s: [number, number];
  t: [number, number];
  barras: BarrasForjado;
  /** En un reticular (obligatorio): el refuerzo es de los ábacos (Ø y separación) o de los nervios (n por nervio). */
  en?: "abacos" | "nervios";
}

/**
 * Cercos de los nervios de un reticular en un rectángulo de la losa, en los ejes de los nervios de su
 * dirección (como un refuerzo: s a lo largo de los nervios X o Y, t en transversal; m). Fuera de
 * ellos, los nervios van sin armadura transversal.
 */
export interface CercosForjado {
  direccion: "x" | "y";
  s: [number, number];
  t: [number, number];
  cercos: CercosViga;
}

/** El armado de una losa maciza o reticular (CO3). */
export interface ArmadoForjado {
  /** La armadura base de cada cara y dirección, en toda la losa: la parrilla de una maciza (Ø y separación) o el montaje de los nervios de un reticular (n por nervio). */
  base: Record<ArmaduraForjado, BarrasForjado>;
  /** En un reticular: la parrilla de los ábacos (Ø y separación). En ellos no se cuentan las barras de los nervios. */
  abacos?: Record<ArmaduraForjado, BarrasForjado>;
  refuerzos?: RefuerzoForjado[];
  /** En un reticular: los cercos de los nervios, por zonas. */
  cercos?: CercosForjado[];
}

export const areaBarra = area;

/** mm² por metro (con separación) o por nervio (con n). */
export function areaBarrasForjado(b: BarrasForjado): number {
  return b.n !== undefined ? b.n * area(b.diametro) : (area(b.diametro) * 1000) / (b.separacion ?? Infinity);
}

/** «Ø12/200» o «2Ø12». */
export const textoBarrasForjado = (b: BarrasForjado): string => (b.n !== undefined ? `${b.n}Ø${b.diametro}` : `Ø${b.diametro}/${b.separacion}`);

/** «x-inf Ø10/200 · x-sup Ø10/200 · … · 6 refuerzos», para una tabla o un texto. */
export function textoArmadoForjado(a: ArmadoForjado): string {
  const cuatro = (r: Record<ArmaduraForjado, BarrasForjado>) => ARMADURAS_FORJADO.map((k) => `${k} ${r[k] ? textoBarrasForjado(r[k]) : "—"}`).join(" · ");
  const n = a.refuerzos?.length ?? 0;
  const c = a.cercos?.length ?? 0;
  return [cuatro(a.base), ...(a.abacos ? [`ábacos: ${cuatro(a.abacos)}`] : []), ...(n ? [`${n} refuerzo${n > 1 ? "s" : ""}`] : []), ...(c ? [`${c} zona${c > 1 ? "s" : ""} de cercos`] : [])].join(" · ");
}

/** Lo que no vale del armado de una losa, en palabras; vacío si es un dato admisible. */
export function erroresArmadoForjado(a: ArmadoForjado, reticular: boolean): string[] {
  const r: string[] = [];
  const barras = (b: BarrasForjado | undefined, que: string, porNervio: boolean) => {
    if (!b || typeof b !== "object") return void r.push(`falta ${que}`);
    if (!DIAMETROS.includes(b.diametro)) r.push(`${que}: Ø${String(b.diametro)} no es un diámetro de barra (${DIAMETROS.join(", ")})`);
    if (porNervio) {
      if (!(Number.isInteger(b.n) && b.n! >= 1)) r.push(`${que}: ${String(b.n)} barras por nervio no vale (un entero ≥ 1)`);
      if (b.separacion !== undefined) r.push(`${que}: en los nervios van n barras por nervio, no una separación`);
    } else {
      if (!(Number.isFinite(b.separacion) && b.separacion! > 0)) r.push(`${que}: la separación ${String(b.separacion)} no vale (mm, > 0)`);
      if (b.n !== undefined) r.push(`${que}: lleva una separación, no n barras por nervio`);
    }
  };
  if (!a.base || typeof a.base !== "object") r.push("falta la armadura base");
  else for (const k of ARMADURAS_FORJADO) barras(a.base[k], `la base ${k}`, reticular);
  if (a.abacos !== undefined) {
    if (!reticular) r.push("la parrilla de los ábacos es de un reticular");
    else for (const k of ARMADURAS_FORJADO) barras(a.abacos[k], `la parrilla ${k} de los ábacos`, false);
  }
  (a.refuerzos ?? []).forEach((x, i) => {
    const que = `el refuerzo ${i + 1}`;
    if (!ARMADURAS_FORJADO.includes(x.armadura)) return void r.push(`${que}: «${String(x.armadura)}» no es una armadura (${ARMADURAS_FORJADO.join(", ")})`);
    for (const [k, v] of [["s", x.s], ["t", x.t]] as const) if (!(Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) && v[1] > v[0])) r.push(`${que}: ${k} tiene que ser [desde, hasta] en m, con hasta > desde`);
    if (reticular && x.en !== "abacos" && x.en !== "nervios") r.push(`${que}: en un reticular hay que decir si es de los ábacos o de los nervios (en)`);
    if (!reticular && x.en !== undefined) r.push(`${que}: «en» es de los reticulares`);
    barras(x.barras, `${que} (${x.armadura})`, reticular && x.en === "nervios");
  });
  if (a.cercos !== undefined && !reticular) r.push("los cercos son de los nervios de un reticular");
  (a.cercos ?? []).forEach((x, i) => {
    const que = `los cercos ${i + 1}`;
    if (x.direccion !== "x" && x.direccion !== "y") r.push(`${que}: la dirección tiene que ser x o y`);
    for (const [k, v] of [["s", x.s], ["t", x.t]] as const) if (!(Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) && v[1] > v[0])) r.push(`${que}: ${k} tiene que ser [desde, hasta] en m, con hasta > desde`);
    const c = x.cercos;
    if (!c || typeof c !== "object") return void r.push(`${que}: faltan el diámetro y la separación`);
    if (!DIAMETROS.includes(c.diametro)) r.push(`${que}: Ø${String(c.diametro)} no es un diámetro de barra (${DIAMETROS.join(", ")})`);
    if (!(Number.isFinite(c.separacion) && c.separacion > 0)) r.push(`${que}: la separación ${String(c.separacion)} no vale (mm, > 0)`);
    if (c.ramas !== undefined && !(Number.isInteger(c.ramas) && c.ramas >= 2)) r.push(`${que}: ${String(c.ramas)} ramas no vale (un entero ≥ 2)`);
  });
  return r;
}

// ─── Punzonamiento (CO4) ────────────────────────────────────────────────────────────────────────

/**
 * La armadura de punzonamiento de una losa junto a un pilar (CO4): cercos verticales en perímetros
 * alrededor del pilar, como los toma el módulo de punzonamiento (tipo viga, α = 90°). En cada
 * perímetro, `ramas` ramas por cada cara del pilar que tiene losa delante (4 en un pilar interior, 3
 * en uno de borde y 2 en uno de esquina); los perímetros, cada `separacion` (sr), el primero a no más
 * de medio canto útil de la cara y hasta donde ya no hacen falta.
 */
export interface ArmaduraPunzonamiento {
  /** Ø de las ramas, mm. */
  diametro: number;
  /** Ramas por cara del pilar con losa, en cada perímetro. */
  ramas: number;
  /** Separación radial entre perímetros, mm. */
  separacion: number;
}

/** «Ø8 4R/150», para una tabla o un texto. */
export const textoPunzonamiento = (a: ArmaduraPunzonamiento): string => `Ø${a.diametro} ${a.ramas}R/${a.separacion}`;

/** Lo que no vale de una armadura de punzonamiento, en palabras; vacío si es un dato admisible. */
export function erroresPunzonamiento(a: ArmaduraPunzonamiento): string[] {
  const r: string[] = [];
  if (!a || typeof a !== "object") return ["faltan el diámetro, las ramas y la separación"];
  if (!DIAMETROS.includes(a.diametro)) r.push(`Ø${String(a.diametro)} no es un diámetro de barra (${DIAMETROS.join(", ")})`);
  if (!(Number.isInteger(a.ramas) && a.ramas >= 1)) r.push(`${String(a.ramas)} ramas por cara no vale (un entero ≥ 1)`);
  if (!(Number.isFinite(a.separacion) && a.separacion > 0)) r.push(`la separación ${String(a.separacion)} no vale (mm, > 0)`);
  return r;
}
