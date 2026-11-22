/**
 * Fase CO4 (`docs/fem3d/comprobaciones.md` §8.7): proponer la armadura de punzonamiento de una losa
 * junto a un pilar.
 *
 * Como en lo demás, proponer es elegir de una tabla y el juez es la comprobación
 * (`comprobarPunzonamiento`: el módulo de punzonamiento de Concreta). Determinista.
 *
 *  1. Sin armadura de punzonamiento: si no falla nada, no se propone ninguna.
 *  2. Si falla sólo lo que arreglan unos cercos (vEd > vRd,c), los primeros de la tabla con los que no
 *     falla ninguna fila.
 *  3. Si falla lo que los cercos no arreglan (vRd,max en la cara del pilar, la cuantía mínima de la
 *     losa, el ábaco) o ninguno de la tabla basta (vRd,cs no pasa de 1,5·vRd,c), no hay propuesta: hay
 *     que cambiar la sección (el canto, el pilar, el ábaco) o la armadura de flexión de la losa.
 *
 * La tabla: cercos verticales de Ø8, Ø10 o Ø12, con 2, 3 o 4 ramas por cara del pilar, en perímetros
 * cada 200, 150, 125, 100 o 75 mm; de menos a más acero por metro radial (a igual acero, los más
 * separados y los de menos ramas).
 */
import { areaBarra, type ArmaduraPunzonamiento } from "../armado.ts";
import { comprobarPunzonamiento, type ArmadoPunzonamiento, type ComprobacionPunzonamiento } from "../comprobar/punzonamiento.ts";
import type { DemandaPunzonamiento } from "../demandas/punzonamiento.ts";

export const DIAMETROS_PUNZONAMIENTO = [8, 10, 12] as const;
export const RAMAS_PUNZONAMIENTO = [2, 3, 4] as const;
export const SEPARACIONES_PUNZONAMIENTO = [200, 150, 125, 100, 75] as const;

export function tablaPunzonamiento(): ArmaduraPunzonamiento[] {
  return DIAMETROS_PUNZONAMIENTO.flatMap((diametro) => RAMAS_PUNZONAMIENTO.flatMap((ramas) => SEPARACIONES_PUNZONAMIENTO.map((separacion) => ({ diametro, ramas, separacion }))))
    .map((c, i) => ({ c, i, a: (c.ramas * areaBarra(c.diametro)) / c.separacion }))
    .sort((p, q) => p.a - q.a || q.c.separacion - p.c.separacion || p.c.ramas - q.c.ramas || p.i - q.i)
    .map((x) => x.c);
}

export interface PropuestaPunzonamiento {
  /** null: no hace falta (si `comprobacion.cumple`) o no hay propuesta (`motivo`). */
  armadura: ArmaduraPunzonamiento | null;
  /** La comprobación con lo propuesto (o sin armadura). */
  comprobacion: ComprobacionPunzonamiento;
  /** Armaduras probadas (0: basta sin ella). */
  probados: number;
  /** Por qué no hay propuesta. */
  motivo?: string;
}

/** Propone la armadura de punzonamiento con el armado de la losa dado (`a.cercos` no cuenta). */
export function proponerPunzonamiento(D: DemandaPunzonamiento, a: ArmadoPunzonamiento): PropuestaPunzonamiento {
  const { cercos: _c, ...sin } = a;
  const c0 = comprobarPunzonamiento(D, sin);
  if (c0.cumple) return { armadura: null, comprobacion: c0, probados: 0 };
  const fallan = c0.filas.filter((f) => f.estado === "fail");
  if (c0.pendientes.length) return { armadura: null, comprobacion: c0, probados: 0, motivo: c0.pendientes.map((p) => p.motivo).join("; ") };
  const ajenas = fallan.filter((f) => f.grupo !== "cercos");
  const texto = (g: string) => (g === "losa" ? "falta armadura de flexión en la losa junto al pilar (cuantía mínima)" : "no basta la sección: hay que aumentar el canto de la losa, el pilar o el ábaco");
  // (el ábaco puede fallar sólo por uout: con cercos sigue fallando, y se dice abajo)
  const fijas = ajenas.filter((f) => !f.id.endsWith("/abaco-uout"));
  if (fijas.length) return { armadura: null, comprobacion: c0, probados: 0, motivo: [...new Set(fijas.map((f) => texto(f.grupo)))].join("; ") };
  let probados = 0;
  let ultima = c0;
  for (const cercos of tablaPunzonamiento()) {
    probados++;
    const c = comprobarPunzonamiento(D, { ...sin, cercos });
    ultima = c;
    if (c.cumple) return { armadura: cercos, comprobacion: c, probados };
    // Lo que los cercos no arreglan ya no va a cambiar con más cercos
    if (c.filas.some((f) => f.estado === "fail" && f.grupo !== "cercos" && !f.id.endsWith("/punz-sr-max"))) break;
  }
  const quedan = ultima.filas.filter((f) => f.estado === "fail");
  const motivo = quedan.some((f) => f.id.endsWith("/abaco-uout"))
    ? "con armadura de punzonamiento, el perímetro a partir del que ya no hace falta se sale del ábaco: hay que agrandar el ábaco"
    : "ninguna armadura de la tabla basta (con cercos, la resistencia no pasa de 1,5 veces la de la losa sin ellos): hay que aumentar el canto de la losa, el pilar, el ábaco o la armadura de flexión";
  return { armadura: null, comprobacion: c0, probados, motivo };
}
