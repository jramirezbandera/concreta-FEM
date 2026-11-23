/**
 * Fase CO6 (`docs/fem3d/comprobaciones.md` §8.11): el armado en barras, dibujado. De un armado (el
 * dato del proyecto) y la geometría de su pieza, dónde va cada barra: la sección de un tramo de pilar
 * o de un vano de viga, el alzado de un vano con sus tres zonas y sus cercos, y los refuerzos y las
 * zonas de cercos de una losa en planta.
 *
 * Puro y sin números de cálculo: sólo coloca lo que dice el armado, con los mismos recubrimientos que
 * toman las comprobaciones (hasta el cerco). Lo usan los croquis de la ficha de Resultados ·
 * Comprobación y la planta con el armado dibujado.
 *
 * Unidades: las secciones, en mm, con el origen en su centro (x a la derecha, y hacia arriba); el
 * alzado de un vano y las losas, en m.
 */
import type { Vec2 } from "../compilador/fisico.ts";
import { ramasDe, textoBarrasForjado, type ArmadoForjado, type ArmadoTramoPilar, type ArmadoVanoViga, type ArmaduraForjado, type BarrasCara, type Cercos, type CercosViga } from "./armado.ts";

/** A qué grupo del armado pertenece una barra dibujada (el de su campo en el formulario). */
export type GrupoBarras = "esquinas" | "caraB" | "caraH" | "anillo" | "inferior" | "superior" | "piel";

export interface BarraSeccion {
  x: number;
  y: number;
  /** Ø, mm. */
  diametro: number;
  grupo: GrupoBarras;
}

export interface SeccionArmada {
  forma: "rectangular" | "circular";
  /** Lo que mide en x y en y, mm (en una circular, el diámetro en las dos). */
  ancho: number;
  alto: number;
  /** El nombre de cada dimensión: en un pilar, x es el canto h e y el ancho b (como en planta con giro 0); en una viga, x es b e y es h. */
  cotas: { x: string; y: string };
  /** El cerco: su Ø y lo que mide su eje, mm (a recubrimiento + Ø/2 de las caras). */
  cerco: { diametro: number; ancho: number; alto: number } | null;
  /** Las ramas interiores de los cercos de una viga con más de dos: la x de cada una, mm. */
  ramas: number[];
  barras: BarraSeccion[];
  /** Lo que el dibujo enseña que no va bien (barras que se tocan), en palabras. */
  avisos: string[];
}

const positivo = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const entero = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;

/** n puntos repartidos entre a y b, sin los extremos. */
const entre = (a: number, b: number, n: number): number[] => Array.from({ length: n }, (_, i) => a + ((b - a) * (i + 1)) / (n + 1));
/** n puntos repartidos de a a b, con los extremos (n ≥ 2); uno solo, en el medio. */
const deAHasta = (a: number, b: number, n: number): number[] => (n <= 1 ? (n === 1 ? [(a + b) / 2] : []) : Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1)));

/** Pares de barras que se pisan o quedan a menos de `libre` mm (CE A19 §8.2: la mayor de Ø y 20 mm). */
function demasiadoJuntas(barras: readonly BarraSeccion[]): boolean {
  for (let i = 0; i < barras.length; i++)
    for (let j = i + 1; j < barras.length; j++) {
      const [a, b] = [barras[i]!, barras[j]!];
      const libre = Math.hypot(a.x - b.x, a.y - b.y) - (a.diametro + b.diametro) / 2;
      if (libre < Math.max(a.diametro, b.diametro, 20) - 1e-6) return true;
    }
  return false;
}

/**
 * La sección de un tramo de pilar con su armado. Rectangular: `h` (el canto, en x) y `b` (en y), mm;
 * circular: `D`. Las barras, con el recubrimiento hasta el cerco (`recubrimiento`, mm). Lo que le
 * falta al armado (un borrador a medias) no se dibuja.
 */
export function seccionPilarArmada(g: { b: number; h: number } | { D: number }, a: Partial<ArmadoTramoPilar> | undefined, recubrimiento: number): SeccionArmada {
  const oc = positivo(a?.cercos?.diametro) ? a!.cercos!.diametro : 0;
  const avisos: string[] = [];
  const barras: BarraSeccion[] = [];
  if ("D" in g) {
    const n = a?.anillo;
    if (n && entero(n.n) && positivo(n.diametro)) {
      const r = g.D / 2 - recubrimiento - oc - n.diametro / 2;
      for (let i = 0; i < n.n; i++) {
        const t = Math.PI / 2 + (2 * Math.PI * i) / n.n;
        barras.push({ x: r * Math.cos(t), y: r * Math.sin(t), diametro: n.diametro, grupo: "anillo" });
      }
    }
    if (demasiadoJuntas(barras)) avisos.push("Las barras del anillo no caben con su separación mínima.");
    const eje = g.D - 2 * recubrimiento - oc;
    return { forma: "circular", ancho: g.D, alto: g.D, cotas: { x: "D", y: "D" }, cerco: oc ? { diametro: oc, ancho: eje, alto: eje } : null, ramas: [], barras, avisos };
  }
  const { b, h } = g;
  const hasta = (o: number) => recubrimiento + oc + o / 2;
  const oe = positivo(a?.esquinas) ? a!.esquinas! : 0;
  const [xe, ye] = [h / 2 - hasta(oe), b / 2 - hasta(oe)];
  if (oe) for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) barras.push({ x: sx * xe, y: sy * ye, diametro: oe, grupo: "esquinas" });
  // Caras de ancho b: las dos perpendiculares al canto (x = ±h/2), con sus intermedias repartidas en y
  const cb = a?.caraB;
  if (cb && entero(cb.n) && cb.n > 0 && positivo(cb.diametro)) for (const sx of [-1, 1]) for (const y of entre(-ye, ye, cb.n)) barras.push({ x: sx * (h / 2 - hasta(cb.diametro)), y, diametro: cb.diametro, grupo: "caraB" });
  // Caras de canto h: las dos de y = ±b/2, con sus intermedias repartidas en x
  const ch = a?.caraH;
  if (ch && entero(ch.n) && ch.n > 0 && positivo(ch.diametro)) for (const sy of [-1, 1]) for (const x of entre(-xe, xe, ch.n)) barras.push({ x, y: sy * (b / 2 - hasta(ch.diametro)), diametro: ch.diametro, grupo: "caraH" });
  if (demasiadoJuntas(barras)) avisos.push("Hay barras a menos de su separación mínima (la mayor de Ø y 20 mm).");
  return { forma: "rectangular", ancho: h, alto: b, cotas: { x: "h", y: "b" }, cerco: oc ? { diametro: oc, ancho: h - 2 * recubrimiento - oc, alto: b - 2 * recubrimiento - oc } : null, ramas: [], barras, avisos };
}

/** Las tres zonas de un vano de viga (CO2-a): el cuarto de la luz junto a cada apoyo y el centro. */
export type ZonaVano = "inicio" | "centro" | "fin";
export const ZONAS_VANO: readonly ZonaVano[] = ["inicio", "centro", "fin"];

export const barrasValidas = (c: Partial<BarrasCara> | undefined): c is BarrasCara => !!c && entero(c.n) && c.n > 0 && positivo(c.diametro);
export const cercosValidos = (c: Partial<CercosViga> | undefined): c is CercosViga => !!c && positivo(c.diametro) && positivo(c.separacion);

/** La armadura superior y los cercos que trabajan en una zona del vano (los de la zona, o los corridos). */
export function armadoDeZona(a: Partial<ArmadoVanoViga> | undefined, zona: ZonaVano): { superior: BarrasCara | undefined; cercos: CercosViga | undefined; superiorPropia: boolean; cercosPropios: boolean } {
  const sup = zona === "inicio" ? a?.superiorInicio : zona === "fin" ? a?.superiorFin : undefined;
  const cer = zona === "inicio" ? a?.cercosInicio : zona === "fin" ? a?.cercosFin : undefined;
  const superiorPropia = barrasValidas(sup);
  const cercosPropios = cercosValidos(cer);
  return {
    superior: superiorPropia ? sup : barrasValidas(a?.superior) ? a!.superior : undefined,
    cercos: cercosPropios ? cer : cercosValidos(a?.cercos) ? a!.cercos : undefined,
    superiorPropia,
    cercosPropios,
  };
}

/** La sección de un vano de viga rectangular (b × h, mm) en una de sus zonas, con su armado. */
export function seccionVigaArmada(g: { b: number; h: number }, a: Partial<ArmadoVanoViga> | undefined, zona: ZonaVano, recubrimiento: number): SeccionArmada {
  const { b, h } = g;
  const z = armadoDeZona(a, zona);
  const oc = z.cercos?.diametro ?? 0;
  const hasta = (o: number) => recubrimiento + oc + o / 2;
  const barras: BarraSeccion[] = [];
  const avisos: string[] = [];
  const fila = (c: BarrasCara | undefined, y: number, grupo: GrupoBarras) => {
    if (!c) return;
    const x = b / 2 - hasta(c.diametro);
    for (const xi of deAHasta(-x, x, c.n)) barras.push({ x: xi, y, diametro: c.diametro, grupo });
  };
  const inf = barrasValidas(a?.inferior) ? a!.inferior : undefined;
  fila(inf, -h / 2 + hasta(inf?.diametro ?? 0), "inferior");
  fila(z.superior, h / 2 - hasta(z.superior?.diametro ?? 0), "superior");
  const piel = a?.piel;
  if (barrasValidas(piel)) {
    const [y0, y1] = [-h / 2 + hasta(inf?.diametro ?? piel.diametro), h / 2 - hasta(z.superior?.diametro ?? piel.diametro)];
    for (const sx of [-1, 1]) for (const y of entre(y0, y1, piel.n)) barras.push({ x: sx * (b / 2 - hasta(piel.diametro)), y, diametro: piel.diametro, grupo: "piel" });
  }
  const ejeX = b - 2 * recubrimiento - oc;
  const ramas = z.cercos ? entre(-ejeX / 2, ejeX / 2, Math.max(0, ramasDe(z.cercos) - 2)) : [];
  if (demasiadoJuntas(barras)) avisos.push("Hay barras a menos de su separación mínima (la mayor de Ø y 20 mm): no caben en una capa.");
  return { forma: "rectangular", ancho: b, alto: h, cotas: { x: "b", y: "h" }, cerco: oc ? { diametro: oc, ancho: ejeX, alto: h - 2 * recubrimiento - oc } : null, ramas, barras, avisos };
}

// ─── El tramo de un pilar, en alzado ────────────────────────────────────────────────────────────

/** Las zonas de cercos de un tramo de pilar (CO1-f): lo que mide cada una a lo largo del tramo libre, m. */
export interface ZonasCercosPilar {
  /** El tramo flexible, entre las caras de sus nudos, m. */
  libre: number;
  /** La zona junto al pie y la de junto a la cabeza, m. Sin centro, la mitad del tramo cada una. */
  pie: number;
  cabeza: number;
  /** Queda centro entre las dos (al menos `CENTRO_MINIMO`). */
  centro: boolean;
}

/** Las zonas van a este módulo, m. */
export const MODULO_ZONA_PILAR = 0.05;
/** Con menos centro que esto, el tramo no tiene zona central: sus dos extremos se reparten el tramo, m. */
export const CENTRO_MINIMO = 0.3;

/**
 * Las zonas de cercos de un tramo de pilar (CE A19 §9.5.3(4)): junto a cada nudo, la mayor dimensión de
 * la sección; junto al pie, además, el solape de las barras si son de más de 14 mm (`solape`: el de cada
 * diámetro, m; `armar/pilares.ts`, `solapesPilar`). Al módulo, hacia arriba.
 */
export function zonasCercosPilar(seccion: { b: number; h: number } | { D: number }, libre: number, diametroMaximo: number, solape: Readonly<Record<number, number>> | undefined): ZonasCercosPilar {
  const lado = ("D" in seccion ? seccion.D : Math.max(seccion.b, seccion.h)) / 1000;
  const alModulo = (x: number) => Math.ceil(x / MODULO_ZONA_PILAR - 1e-9) * MODULO_ZONA_PILAR;
  const pie = alModulo(Math.max(lado, diametroMaximo > 14 ? (solape?.[diametroMaximo] ?? 0) : 0));
  const cabeza = alModulo(lado);
  if (!(libre - pie - cabeza >= CENTRO_MINIMO - 1e-9)) return { libre, pie: libre / 2, cabeza: libre / 2, centro: false };
  return { libre, pie, cabeza, centro: true };
}

export interface ZonaPilarAlzado {
  zona: "pie" | "centro" | "cabeza";
  /** Desde la cara del nudo de abajo, m. */
  desde: number;
  hasta: number;
  cercos: Cercos | undefined;
  /** La zona lleva sus propios cercos (no los del centro). */
  propios: boolean;
  /** Dónde va cada cerco, m. */
  posiciones: number[];
}

export interface AlzadoPilar extends ZonasCercosPilar {
  /** De abajo arriba; sin centro, sólo el pie y la cabeza. */
  zonas: ZonaPilarAlzado[];
  /** Cercos del tramo. */
  cercos: number;
}

/**
 * El alzado de un tramo de pilar: sus zonas de cercos con la posición de cada cerco. El primero, a
 * 50 mm de la cara del nudo de abajo; cada zona sigue desde el último de la anterior a su separación
 * (al entrar en una más densa, a la suya, sin adelantarse a su arranque), y el último queda a 50 mm o
 * más de la cara de arriba.
 */
export function alzadoPilar(seccion: { b: number; h: number } | { D: number }, libre: number, a: Partial<ArmadoTramoPilar> | undefined, solape: Readonly<Record<number, number>> | undefined): AlzadoPilar {
  const diametros = [a?.anillo?.diametro, a?.esquinas, a?.caraB?.n ? a.caraB.diametro : undefined, a?.caraH?.n ? a.caraH.diametro : undefined].filter((x): x is number => typeof x === "number" && x > 0);
  const z = zonasCercosPilar(seccion, libre, Math.max(0, ...diametros), solape);
  const de = (c: Partial<Cercos> | undefined) => (cercosValidos(c) ? (c as Cercos) : undefined);
  const centro = de(a?.cercos);
  const partes: [ZonaPilarAlzado["zona"], number, number, Cercos | undefined, boolean][] = [
    ["pie", 0, z.pie, de(a?.cercosPie) ?? centro, !!de(a?.cercosPie)],
    ...(z.centro ? [["centro", z.pie, libre - z.cabeza, centro, false] as [ZonaPilarAlzado["zona"], number, number, Cercos | undefined, boolean]] : []),
    ["cabeza", libre - z.cabeza, libre, de(a?.cercosCabeza) ?? centro, !!de(a?.cercosCabeza)],
  ];
  let x = PRIMER_CERCO;
  let ultimo: number | null = null;
  let total = 0;
  const zonas = partes.map(([zona, desde, hasta, cercos, propios], i): ZonaPilarAlzado => {
    const posiciones: number[] = [];
    if (cercos) {
      const s = cercos.separacion / 1000;
      const fin = i === partes.length - 1 ? hasta - PRIMER_CERCO : hasta;
      // Al entrar en una zona más densa, su primer cerco no queda a más de su separación del anterior (ni antes de su arranque)
      if (ultimo !== null) x = Math.min(x, Math.max(ultimo + s, desde));
      // Tope: un dato disparatado (1 mm) no dibuja decenas de miles
      for (let k = 0; x <= fin + 1e-9 && k < 2000; k++) {
        if (x >= desde - 1e-9) {
          posiciones.push(x);
          ultimo = x;
        }
        x += s;
      }
      total += posiciones.length;
    } else x = Math.max(x, hasta);
    return { zona, desde, hasta, cercos, propios, posiciones };
  });
  return { ...z, zonas, cercos: total };
}

export interface ZonaAlzado {
  zona: ZonaVano;
  /** A lo largo del vano, desde la cara de su apoyo de inicio, m. */
  desde: number;
  hasta: number;
  superior: BarrasCara | undefined;
  cercos: CercosViga | undefined;
  /** La zona lleva su propia armadura superior o sus propios cercos (no los corridos). */
  superiorPropia: boolean;
  cercosPropios: boolean;
  /** Dónde va cada cerco de la zona, m. */
  posiciones: number[];
}

export interface AlzadoVano {
  /** La luz entre las caras de los apoyos, m. */
  luz: number;
  zonas: [ZonaAlzado, ZonaAlzado, ZonaAlzado];
  inferior: BarrasCara | undefined;
  piel: BarrasCara | undefined;
}

/** El primer cerco, a 50 mm de la cara del apoyo. */
export const PRIMER_CERCO = 0.05;

/**
 * El alzado de un vano de viga: sus tres zonas (los cuartos de la luz junto a los apoyos y el centro,
 * como las toma la comprobación), con la armadura superior y los cercos de cada una y la posición de
 * cada cerco: el primero a 50 mm de la cara del apoyo y los demás a su separación, hasta el fin de su
 * zona.
 */
export function alzadoVano(luz: number, a: Partial<ArmadoVanoViga> | undefined): AlzadoVano {
  const cortes = [0, luz / 4, (3 * luz) / 4, luz];
  const zonas = ZONAS_VANO.map((zona, i): ZonaAlzado => {
    const z = armadoDeZona(a, zona);
    const [desde, hasta] = [cortes[i]!, cortes[i + 1]!];
    const posiciones: number[] = [];
    if (z.cercos) {
      const s = z.cercos.separacion / 1000;
      const fin = i === 2 ? hasta - PRIMER_CERCO : hasta;
      // Tope: un dato disparatado (1 mm) no dibuja decenas de miles
      for (let x = i === 0 ? PRIMER_CERCO : desde, k = 0; x <= fin + 1e-9 && k < 2000; x += s, k++) posiciones.push(x);
    }
    return { zona, desde, hasta, ...z, posiciones };
  }) as [ZonaAlzado, ZonaAlzado, ZonaAlzado];
  return { luz, zonas, inferior: barrasValidas(a?.inferior) ? a!.inferior : undefined, piel: barrasValidas(a?.piel) ? a!.piel : undefined };
}

// ─── Losas, en planta ───────────────────────────────────────────────────────────────────────────

/** Los ejes (d, n) de una armadura de una losa: d a lo largo de sus barras (como `ejesArmado` del compilador). */
export function ejesArmadura(eje1: number | undefined, armadura: ArmaduraForjado | "x" | "y"): { d: Vec2; n: Vec2 } {
  const e1 = direccion(eje1 ?? 0);
  const e2 = direccion((eje1 ?? 0) + 90);
  return armadura[0] === "x" ? { d: e1, n: e2 } : { d: e2, n: e1 };
}

/** La dirección a unos grados desde +X; los múltiplos de 90°, exactos (la misma cuenta que `direccionEje1` del compilador). */
function direccion(grados: number): Vec2 {
  const g = (((grados % 360) + 360) % 360) / 90;
  if (Number.isInteger(g)) return ([[1, 0], [0, 1], [-1, 0], [0, -1]] as const)[g as 0 | 1 | 2 | 3].slice() as unknown as Vec2;
  return [Math.cos((grados * Math.PI) / 180), Math.sin((grados * Math.PI) / 180)];
}

export interface RefuerzoDibujado {
  /** Su índice en `refuerzos` (o en `cercos`) del armado de la losa. */
  indice: number;
  armadura: ArmaduraForjado;
  cara: "inferior" | "superior";
  /** El rectángulo que cubre, en planta. */
  zona: [Vec2, Vec2, Vec2, Vec2];
  /** Una barra, a lo largo de las suyas, por el medio de la zona. */
  barra: [Vec2, Vec2];
  /** La línea de reparto: de lado a lado de la zona, en transversal, por el medio de la barra. */
  reparto: [Vec2, Vec2];
  centro: Vec2;
  /** Grados de la barra desde +X, para rotular a lo largo. */
  giro: number;
  /** «Ø12/200» o «2Ø12 por nervio». */
  texto: string;
  /** Largo de las barras y ancho que cubren, m. */
  largo: number;
  ancho: number;
  en?: "abacos" | "nervios";
  /** Los ejes de su armadura (a lo largo de las barras y en transversal) y su rectángulo en ellos, m. */
  d: Vec2;
  n: Vec2;
  s: [number, number];
  t: [number, number];
}

/** Hasta dónde se busca una referencia por fuera de la punta de un refuerzo para acotarla, m. */
export const ALCANCE_COTAS = 2;
/** Con más referencias dentro que éstas, un refuerzo no se acota por tramos (un vano entero: se lee su largo). */
export const MAXIMO_COTAS = 3;

/** Las cotas de un refuerzo a lo largo de sus barras, respecto a unas referencias (ejes de pilares y de vigas, en su s). */
export interface CotasRefuerzo {
  /** Las referencias que caen dentro: lo parten en tramos (de la punta a la referencia y entre referencias). */
  dentro: number[];
  /** Sin ninguna dentro: la referencia más cercana por fuera de cada punta, si la hay dentro del alcance. */
  fuera: [number | null, number | null];
}

/**
 * Cómo se acota un refuerzo de `s[0]` a `s[1]`: si alguna referencia cae dentro (a más de 5 cm de las
 * puntas), por tramos desde ella (un refuerzo superior sobre un pilar: lo que sale a cada lado de su
 * eje); si no, cada punta a la referencia más cercana por fuera (un refuerzo de vano: lo que le falta
 * hasta el eje del apoyo). Las referencias a menos de 5 cm entre sí son la misma.
 */
export function cotasRefuerzo(s: readonly [number, number], referencias: readonly number[], alcance = ALCANCE_COTAS): CotasRefuerzo {
  const refs: number[] = [];
  for (const x of [...referencias].filter(Number.isFinite).sort((a, b) => a - b)) if (!refs.length || x - refs[refs.length - 1]! > 0.05) refs.push(x);
  const dentro = refs.filter((x) => x > s[0] + 0.05 && x < s[1] - 0.05);
  if (dentro.length) return { dentro: dentro.length <= MAXIMO_COTAS ? dentro : [], fuera: [null, null] };
  const antes = refs.filter((x) => x <= s[0] + 0.05 && x >= s[0] - alcance).pop() ?? null;
  const despues = refs.find((x) => x >= s[1] - 0.05 && x <= s[1] + alcance) ?? null;
  return { dentro: [], fuera: [antes !== null && s[0] - antes > 0.005 ? antes : null, despues !== null && despues - s[1] > 0.005 ? despues : null] };
}

export interface CercosDibujados {
  indice: number;
  direccion: "x" | "y";
  zona: [Vec2, Vec2, Vec2, Vec2];
  centro: Vec2;
  /** La dirección de los nervios que los llevan y su perpendicular. */
  d: Vec2;
  n: Vec2;
  /** La zona en esos ejes, m: a lo largo de los nervios (s) y a través (t). */
  s: [number, number];
  t: [number, number];
  giro: number;
  /** «cØ6/150 (2R)»: siempre con sus ramas. */
  texto: string;
  /** Separación entre cercos, m, y ramas de cada uno. */
  separacion: number;
  ramas: number;
  largo: number;
  ancho: number;
}

const enPlanta = (d: Vec2, n: Vec2, s: number, t: number): Vec2 => [s * d[0] + t * n[0], s * d[1] + t * n[1]];
const rectangulo = (d: Vec2, n: Vec2, s: readonly [number, number], t: readonly [number, number]): [Vec2, Vec2, Vec2, Vec2] => [enPlanta(d, n, s[0], t[0]), enPlanta(d, n, s[1], t[0]), enPlanta(d, n, s[1], t[1]), enPlanta(d, n, s[0], t[1])];
const grados = (d: Vec2) => (Math.atan2(d[1], d[0]) * 180) / Math.PI;
const rango = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number" && Number.isFinite(x)) && v[1] > v[0];

/** Los refuerzos de una losa, en planta: la zona de cada uno, una barra y su línea de reparto. Los que no valen (un dato a medias) no se dibujan. */
export function refuerzosDibujados(eje1: number | undefined, a: Pick<ArmadoForjado, "refuerzos"> | undefined): RefuerzoDibujado[] {
  const r: RefuerzoDibujado[] = [];
  (a?.refuerzos ?? []).forEach((x, indice) => {
    if (!x || !rango(x.s) || !rango(x.t) || !x.barras || typeof x.armadura !== "string" || !/^[xy]-(inf|sup)$/.test(x.armadura)) return;
    const { d, n } = ejesArmadura(eje1, x.armadura);
    const [sm, tm] = [(x.s[0] + x.s[1]) / 2, (x.t[0] + x.t[1]) / 2];
    r.push({
      indice,
      armadura: x.armadura,
      cara: x.armadura.endsWith("inf") ? "inferior" : "superior",
      zona: rectangulo(d, n, x.s, x.t),
      barra: [enPlanta(d, n, x.s[0], tm), enPlanta(d, n, x.s[1], tm)],
      reparto: [enPlanta(d, n, sm, x.t[0]), enPlanta(d, n, sm, x.t[1])],
      centro: enPlanta(d, n, sm, tm),
      giro: grados(d),
      texto: x.barras.n !== undefined ? `${textoBarrasForjado(x.barras)} por nervio` : textoBarrasForjado(x.barras),
      largo: x.s[1] - x.s[0],
      ancho: x.t[1] - x.t[0],
      ...(x.en ? { en: x.en } : {}),
      d,
      n,
      s: [x.s[0], x.s[1]],
      t: [x.t[0], x.t[1]],
    });
  });
  return r;
}

/** Las zonas de cercos de los nervios de un reticular, en planta. */
export function cercosDibujados(eje1: number | undefined, a: Pick<ArmadoForjado, "cercos"> | undefined): CercosDibujados[] {
  const r: CercosDibujados[] = [];
  (a?.cercos ?? []).forEach((x, indice) => {
    if (!x || !rango(x.s) || !rango(x.t) || !cercosValidos(x.cercos) || (x.direccion !== "x" && x.direccion !== "y")) return;
    const { d, n } = ejesArmadura(eje1, x.direccion);
    r.push({
      indice,
      direccion: x.direccion,
      zona: rectangulo(d, n, x.s, x.t),
      centro: enPlanta(d, n, (x.s[0] + x.s[1]) / 2, (x.t[0] + x.t[1]) / 2),
      d,
      n,
      s: [x.s[0], x.s[1]],
      t: [x.t[0], x.t[1]],
      giro: grados(d),
      texto: `cØ${x.cercos.diametro}/${x.cercos.separacion} (${ramasDe(x.cercos)}R)`,
      separacion: x.cercos.separacion / 1000,
      ramas: ramasDe(x.cercos),
      largo: x.s[1] - x.s[0],
      ancho: x.t[1] - x.t[0],
    });
  });
  return r;
}

/** Tope de cercos dibujados en una zona: con más, se dibuja uno de cada k. */
export const MAXIMO_PUNTOS_CERCOS = 1500;

/**
 * Los cercos de una zona, uno a uno: un punto por cerco sobre el eje de cada nervio que la cruza
 * (`nervios`: los ejes de los nervios de la losa, de las dos familias; cuentan los paralelos a los de la
 * zona). El primero, a media separación del principio de la zona; todos los nervios, con los cercos a
 * la misma altura. Sin ningún nervio que la cruce (una zona fuera de la retícula), sobre su eje.
 */
export function puntosCercos(z: Pick<CercosDibujados, "d" | "n" | "s" | "t" | "separacion">, nervios: readonly (readonly [Vec2, Vec2])[]): Vec2[] {
  if (!(z.separacion > 0)) return [];
  const st = (p: Vec2): [number, number] => [p[0] * z.d[0] + p[1] * z.d[1], p[0] * z.n[0] + p[1] * z.n[1]];
  /** Los tramos de nervio dentro de la zona: su t y de dónde a dónde en s. */
  const tramos: { t: number; a: number; b: number }[] = [];
  for (const [p, q] of nervios) {
    const [[sa, ta], [sb, tb]] = [st(p), st(q)];
    if (Math.abs(tb - ta) > 1e-6 * Math.max(1, Math.abs(sb - sa))) continue;
    const t = (ta + tb) / 2;
    if (t < z.t[0] - 1e-6 || t > z.t[1] + 1e-6) continue;
    const [a, b] = [Math.max(Math.min(sa, sb), z.s[0]), Math.min(Math.max(sa, sb), z.s[1])];
    if (b > a + 1e-9) tramos.push({ t, a, b });
  }
  if (!tramos.length) tramos.push({ t: (z.t[0] + z.t[1]) / 2, a: z.s[0], b: z.s[1] });
  const n = Math.max(0, Math.floor((z.s[1] - z.s[0]) / z.separacion + 0.5 + 1e-9));
  const paso = Math.max(1, Math.ceil((n * tramos.length) / MAXIMO_PUNTOS_CERCOS));
  const r: Vec2[] = [];
  for (const x of tramos)
    for (let k = 0; k < n; k += paso) {
      const s = z.s[0] + (k + 0.5) * z.separacion;
      if (s >= x.a - 1e-9 && s <= x.b + 1e-9) r.push([s * z.d[0] + x.t * z.n[0], s * z.d[1] + x.t * z.n[1]]);
    }
  return r;
}
