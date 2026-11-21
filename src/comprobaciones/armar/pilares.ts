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
 */
import { areaDe, armadoPilar, barrasDe, type ArmadoTramoPilar, type Cercos, type DatosArmado } from "../armado.ts";
import { comprobarTramo, type ComprobacionTramo } from "../comprobar/pilares.ts";
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
  let pista: { d: Demanda; extremo: "base" | "cabeza" } | undefined;
  const conSolo = (p: NonNullable<typeof pista>): DemandasTramo => ({
    ...t,
    base: { ...t.base, demandas: p.extremo === "base" ? [p.d] : [] },
    cabeza: { ...t.cabeza, demandas: p.extremo === "cabeza" ? [p.d] : [] },
  });
  const demandaDe = (c: ComprobacionTramo) => {
    const f = c.filas.find((x) => x.estado === "fail");
    if (!f) return;
    const d = t[f.extremo].demandas.find((x) => x.comb === f.comb && (x.pesimos ?? false) === (f.pesimos ?? false));
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
    let vale = probar(a) ? a : null;
    if (!vale && ultima && soloCortante(ultima)) for (const cercos of cercosMasFuertes(a.cercos)) if (probar({ ...a, cercos })) { vale = { ...a, cercos }; break; }
    if (vale) return { armado: vale, comprobacion: comprobarTramo(t, armadoPilar(vale, datos), betaUno), posicion: i, probados };
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
  return (
    !!a.anillo === !!b.anillo &&
    barrasDe(a) >= barrasDe(b) &&
    diametroDe(a) >= diametroDe(b) &&
    a.cercos.diametro >= b.cercos.diametro &&
    a.cercos.separacion <= b.cercos.separacion
  );
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
  const cercos = (x: Cercos): Cercos => ({ diametro: Math.max(x.diametro, minimo.cercos.diametro, actual.cercos.diametro), separacion: Math.min(x.separacion, minimo.cercos.separacion, actual.cercos.separacion) });
  for (let i = 0; i < tabla.length; i++) {
    const a = { ...tabla[i]!, cercos: cercos(tabla[i]!.cercos) };
    if (!domina(a, minimo) || !domina(a, actual)) continue;
    const c = comprobarTramo(t, armadoPilar(a, datos), betaUno);
    if (sinFallos(c)) return { armado: a, comprobacion: c, posicion: i };
  }
  return null;
}
