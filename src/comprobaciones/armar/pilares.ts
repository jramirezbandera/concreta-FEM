/**
 * Fase CO1 (`docs/fem3d/comprobaciones.md` §4.4): proponer el armado de un tramo de pilar.
 *
 * Proponer es elegir de una tabla: disposiciones ordenadas por cuantía, y la primera con la que no
 * falla ninguna fila con todas las demandas del tramo. El juez es `comprobarTramo` (el módulo de
 * Concreta, el cortante y la flexotracción); aquí no hay ninguna fórmula de armado. Determinista.
 *
 * La tabla: barras de esquina e intermedias del mismo diámetro (12, 16, 20 o 25), de 0 a 3
 * intermedias por cara en cada dirección; en circular, de 6 a 16 barras. Los cercos, Ø6 (Ø8 con
 * barras de 25, por Ø/4) a la separación que cumple también la zona densificada junto a los nudos,
 * 0,6·mín(15·Ø, la menor dimensión, 300 mm), en todo el tramo. Si lo que falla es sólo el cortante,
 * se prueban cercos más gruesos y más juntos antes de pasar a más barras.
 *
 * **Tres zonas de cercos (CO1-f):** elegido el armado (y aplicadas las reglas de obra), si al tramo le
 * queda centro entre sus dos zonas de extremo (`zonasCercosPilar`), los cercos de la tabla se quedan
 * junto al pie y junto a la cabeza y el centro lleva los más abiertos de `SEPARACIONES_CENTRO` que no
 * pasan de mín(15·Ø, la menor dimensión, 300 mm) con los que todo sigue cumpliendo (`aflojarCentro`).
 */
import { areaDe, armadoPilar, barrasDe, cercosExtremos, DATOS_ARMADO, DIAMETROS, type ArmadoTramoPilar, type Cercos, type DatosArmado } from "../armado.ts";
import { getFyd } from "../concreta/data/materials.ts";
import { computeAnchorage, fctmAdherencia } from "../concreta/lib/calculations/rcSlabs.ts";
import { zonasCercosPilar } from "../dibujoArmado.ts";
import { comprobarTramo, fallaCortanteCentro, type ComprobacionTramo, type Extremo } from "../comprobar/pilares.ts";
import { geometriaPilar } from "../comprobar/entradaPilar.ts";
import type { Demanda, DemandasTramo } from "../demandas/pilares.ts";

export const DIAMETROS_PILAR = [12, 16, 20, 25] as const;
export const INTERMEDIAS_MAXIMO = 3;
export const BARRAS_ANILLO = [6, 8, 10, 12, 14, 16] as const;

/** Los cercos de la tabla para barras de Ø en una sección de dimensión menor `lado` (mm). */
export function cercosDe(diametro: number, lado: number): Cercos {
  const separacion = Math.max(50, Math.floor((0.6 * Math.min(15 * diametro, lado, 300)) / 10) * 10);
  return { diametro: diametro >= 25 ? 8 : 6, separacion };
}

/** Los cercos que se prueban, en orden, cuando sólo falla el cortante. */
function cercosMasFuertes(c: Cercos): Cercos[] {
  const lista: Cercos[] = [
    { diametro: 8, separacion: c.separacion },
    { diametro: 8, separacion: Math.min(c.separacion, 100) },
    { diametro: 10, separacion: Math.min(c.separacion, 100) },
    { diametro: 10, separacion: Math.min(c.separacion, 70) },
  ];
  return lista.filter((x, i) => (x.diametro > c.diametro || x.separacion < c.separacion) && lista.findIndex((y) => y.diametro === x.diametro && y.separacion === x.separacion) === i);
}

/** La tabla de un tramo, de menos a más acero (y, a igual área, menos barras). Dimensiones en mm. */
export function tablaPilares(forma: "rectangular" | "circular", b: number, h: number): ArmadoTramoPilar[] {
  const tabla: ArmadoTramoPilar[] = [];
  const lado = Math.min(b, h);
  for (const d of DIAMETROS_PILAR) {
    const cercos = cercosDe(d, lado);
    if (forma === "circular") for (const n of BARRAS_ANILLO) tabla.push({ anillo: { n, diametro: d }, cercos });
    else
      for (let nb = 0; nb <= INTERMEDIAS_MAXIMO; nb++)
        for (let nh = 0; nh <= INTERMEDIAS_MAXIMO; nh++) tabla.push({ esquinas: d, caraB: { n: nb, diametro: d }, caraH: { n: nh, diametro: d }, cercos });
  }
  const orden = (t: ArmadoTramoPilar) => [areaDe(t), barrasDe(t), t.caraH?.n ?? 0] as const;
  return tabla
    .map((t, i) => ({ t, i, o: orden(t) }))
    .sort((p, q) => p.o[0] - q.o[0] || p.o[1] - q.o[1] || p.o[2] - q.o[2] || p.i - q.i)
    .map((x) => x.t);
}

export interface Propuesta {
  /** El primero de la tabla sin ninguna fila que falle; null si ninguno. */
  armado: ArmadoTramoPilar | null;
  /** La comprobación del propuesto con todas las demandas (o la del último probado, si ninguno vale). */
  comprobacion: ComprobacionTramo | null;
  /** Posición del propuesto en la tabla y cuántos armados se han probado (con los cercos de más). */
  posicion: number;
  probados: number;
  /** Por qué no hay propuesta. */
  motivo?: string;
}

const soloCortante = (c: ComprobacionTramo) => c.filas.filter((f) => f.estado === "fail").every((f) => f.id.startsWith("cortante"));
const sinFallos = (c: ComprobacionTramo) => c.filas.every((f) => f.estado !== "fail") && !c.pendientes.some((p) => p.motivo.startsWith("el módulo no admite"));

export function proponerTramo(t: DemandasTramo, datos?: DatosArmado, betaUno = true): Propuesta {
  const geo = geometriaPilar(t);
  if ("motivo" in geo) return { armado: null, comprobacion: null, posicion: -1, probados: 0, motivo: geo.motivo };
  if (t.base.demandas.length + t.cabeza.demandas.length === 0) return { armado: null, comprobacion: null, posicion: -1, probados: 0, motivo: "el tramo no tiene demandas: sin combinaciones de ELU no hay comprobación" };
  const tabla = tablaPilares(geo.sectionType, geo.b, geo.h);
  let probados = 0;
  let ultima: ComprobacionTramo | null = null;
  // La demanda con la que falló el anterior, primero y sola: casi siempre tumba también al siguiente
  let pista: { d: Demanda; extremo: Extremo } | undefined;
  const conSolo = (p: NonNullable<typeof pista>): DemandasTramo => ({
    ...t,
    base: { ...t.base, demandas: p.extremo === "base" ? [p.d] : [] },
    cabeza: { ...t.cabeza, demandas: p.extremo === "cabeza" ? [p.d] : [] },
    ...(t.centro ? { centro: { ...t.centro, demandas: p.extremo === "centro" ? [p.d] : [] } } : {}),
  });
  const demandaDe = (c: ComprobacionTramo) => {
    const f = c.filas.find((x) => x.estado === "fail");
    if (!f) return;
    const d = t[f.extremo]?.demandas.find((x) => x.comb === f.comb && (x.pesimos ?? false) === (f.pesimos ?? false));
    if (d) pista = { d, extremo: f.extremo };
  };
  const probar = (a: ArmadoTramoPilar): ComprobacionTramo | null => {
    probados++;
    const armado = armadoPilar(a, datos);
    if (pista) {
      const rapida = comprobarTramo(conSolo(pista), armado, betaUno, true);
      if (!sinFallos(rapida)) {
        ultima = rapida;
        return null;
      }
    }
    const c = comprobarTramo(t, armado, betaUno, true);
    ultima = c;
    if (sinFallos(c)) return c;
    demandaDe(c);
    return null;
  };
  for (let i = 0; i < tabla.length; i++) {
    const a = tabla[i]!;
    let vale: ArmadoTramoPilar | null = a;
    // La comprobación del que vale es la entera: sin ninguna fila que falle, `hastaFallo` no corta nada
    let c = probar(a);
    if (!c && ultima && soloCortante(ultima))
      for (const cercos of cercosMasFuertes(a.cercos)) {
        c = probar({ ...a, cercos });
        if (c) {
          vale = { ...a, cercos };
          break;
        }
      }
    if (c) return { armado: vale, comprobacion: c, posicion: i, probados };
  }
  const falla = (ultima as ComprobacionTramo | null)?.filas.find((f) => f.estado === "fail");
  return { armado: null, comprobacion: ultima, posicion: -1, probados, motivo: `ningún armado de la tabla cumple${falla ? ` (con el mayor falla «${falla.descripcion}», ${falla.comb})` : ""}: la sección no basta` };
}

/** Ø de las barras longitudinales (las de esquina en rectangular; las del anillo en circular). */
export const diametroDe = (t: ArmadoTramoPilar) => t.anillo?.diametro ?? t.esquinas ?? 0;

/**
 * `a` lleva al menos lo de `b`: la misma forma, no menos barras longitudinales, ni de menor diámetro,
 * ni cercos más finos o más separados. La regla de obra de CO1-e (continuidad y agrupar).
 */
export function domina(a: ArmadoTramoPilar, b: ArmadoTramoPilar): boolean {
  // Los cercos, los de los extremos (CO1-f: el centro puede ir más abierto)
  const [ca, cb] = [cercosExtremos(a), cercosExtremos(b)];
  return !!a.anillo === !!b.anillo && barrasDe(a) >= barrasDe(b) && diametroDe(a) >= diametroDe(b) && ca.diametro >= cb.diametro && ca.separacion <= cb.separacion;
}

/** Solape de las barras en el arranque de un tramo: α6·lb,rqd con todas solapadas en la misma sección (CE A19 §8.7.3). */
export const ALFA_SOLAPE = 1.5;

/**
 * El solape de cada diámetro en el pie de un pilar, m: α6·lb,rqd a fyd, con adherencia buena (barras
 * verticales), de `computeAnchorage` del módulo de forjados. Con Ø > 14, la zona densificada del pie
 * llega hasta ahí (§9.5.3(4)).
 */
export function solapesPilar(fck: number, datos?: DatosArmado): Record<number, number> {
  const fyd = getFyd(datos?.fyk ?? DATOS_ARMADO.fyk);
  const fctm = fctmAdherencia(fck);
  const r: Record<number, number> = {};
  for (const o of DIAMETROS) r[o] = (ALFA_SOLAPE * computeAnchorage(o, fctm, fyd, "inf", 300).lb_rqd) / 1000;
  return r;
}

/** Las separaciones que se prueban en el centro del tramo, de la más abierta a la más cerrada, mm. */
export const SEPARACIONES_CENTRO = [300, 250, 200, 180, 150, 125] as const;

/**
 * CO1-f: con un armado de cercos uniformes que cumple, el mismo con el centro del tramo más abierto.
 * Los cercos dados se quedan junto al pie y junto a la cabeza; el centro lleva la separación más
 * abierta de `SEPARACIONES_CENTRO` que no pasa de mín(15·Ø, la menor dimensión, 300 mm) y con la que
 * no falla nada (el cortante del centro). null si el tramo no tiene centro, si ya los lleva distintos o
 * si ninguna más abierta cumple.
 */
export function aflojarCentro(t: DemandasTramo, a: ArmadoTramoPilar, datos?: DatosArmado, betaUno = true): { armado: ArmadoTramoPilar; comprobacion: ComprobacionTramo } | null {
  const geo = geometriaPilar(t);
  if ("motivo" in geo || a.cercosPie || a.cercosCabeza || t.material.tipo !== "hormigon") return null;
  const seccion = geo.sectionType === "circular" ? { D: geo.D! } : { b: geo.b, h: geo.h };
  const diametros = a.anillo ? [a.anillo.diametro] : [a.esquinas ?? 0, ...(a.caraB?.n ? [a.caraB.diametro] : []), ...(a.caraH?.n ? [a.caraH.diametro] : [])];
  const z = zonasCercosPilar(seccion, t.longitudLibre, Math.max(...diametros), solapesPilar(t.material.fck, datos));
  if (!z.centro) return null;
  const lado = geo.sectionType === "circular" ? geo.D! : Math.min(geo.b, geo.h);
  const maxima = Math.min(15 * Math.min(...diametros), lado, 300);
  for (const separacion of SEPARACIONES_CENTRO) {
    if (separacion > maxima || separacion <= a.cercos.separacion) continue;
    const x: ArmadoTramoPilar = { ...a, cercos: { diametro: a.cercos.diametro, separacion }, cercosPie: a.cercos, cercosCabeza: a.cercos };
    // Primero, lo único que cambia: el cortante del centro; con él bien, la comprobación entera
    if (fallaCortanteCentro(t, armadoPilar(x, datos))) continue;
    const c = comprobarTramo(t, armadoPilar(x, datos), betaUno, true);
    if (sinFallos(c)) return { armado: x, comprobacion: c };
  }
  return null;
}

/**
 * Subir el armado de un tramo hasta uno que domine a `minimo` (CO1-e): el primero de la tabla del tramo
 * que lo domina en barras y diámetro y cumple, con los cercos de los dos más fuertes. Nunca baja: si
 * `actual` ya domina a `minimo`, se queda. null si ninguno cumple.
 */
export function subirTramo(t: DemandasTramo, actual: ArmadoTramoPilar, minimo: ArmadoTramoPilar, datos?: DatosArmado, betaUno = true): { armado: ArmadoTramoPilar; comprobacion: ComprobacionTramo; posicion: number } | null {
  const geo = geometriaPilar(t);
  if ("motivo" in geo) return null;
  const tabla = tablaPilares(geo.sectionType, geo.b, geo.h);
  if (domina(actual, minimo)) return null;
  const [cm, ca] = [cercosExtremos(minimo), cercosExtremos(actual)];
  const cercos = (x: Cercos): Cercos => ({ diametro: Math.max(x.diametro, cm.diametro, ca.diametro), separacion: Math.min(x.separacion, cm.separacion, ca.separacion) });
  for (let i = 0; i < tabla.length; i++) {
    const a = { ...tabla[i]!, cercos: cercos(tabla[i]!.cercos) };
    if (!domina(a, minimo) || !domina(a, actual)) continue;
    // (hasta el primer fallo: el que no falla sale entero)
    const c = comprobarTramo(t, armadoPilar(a, datos), betaUno, true);
    if (sinFallos(c)) return { armado: a, comprobacion: c, posicion: i };
  }
  return null;
}
