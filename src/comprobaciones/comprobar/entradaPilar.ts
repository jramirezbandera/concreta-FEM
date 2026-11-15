/**
 * Fase CO1 (`docs/fem3d/comprobaciones.md` §4.2, puntos 4 a 6): de una demanda de pilar a la entrada
 * del módulo de pilares de hormigón de Concreta (`calcRCColumn`, `RCColumnInputs`), sin el armado.
 *
 * Las conversiones, en un solo sitio:
 *  - m → mm en la sección; kN y kN·m igual; la longitud, en m;
 *  - N > 0 tracciona aquí; en el módulo, Nd > 0 comprime. Con N ≥ −1 kN (el módulo pide Nd ≥ 1) la
 *    demanda no es de flexocompresión y va aparte (`traccion`);
 *  - el módulo toma |MEdy| con el canto h y |MEdz| con el ancho b. Aquí My flecta en el plano del
 *    canto h (z local, `fisico.ts`) y Mz en el del ancho b: MEdy = |My|, MEdz = |Mz|;
 *  - β = 1 sobre la longitud libre (SO y CO-g); el módulo le suma a cada extremo la excentricidad
 *    mínima, la imperfección del pilar aislado y la de segundo orden local.
 *
 * No depende de las copias: da un objeto plano con los campos del módulo.
 */
import type { DemandasTramo, Demanda } from "../demandas/pilares.ts";

/** Lo de `RCColumnInputs` que sale de la demanda (sin el armado ni el acero). */
export interface EntradaPilar {
  sectionType: "rectangular" | "circular";
  /** mm */
  b: number;
  h: number;
  D?: number;
  /** MPa */
  fck: number;
  /** kN, compresión positiva */
  Nd: number;
  /** kN·m, en valor absoluto */
  MEdy: number;
  MEdz: number;
  /** m */
  L: number;
  beta: 1;
}

export type EntradaDemandaPilar =
  | { tipo: "flexocompresion"; entrada: EntradaPilar }
  /** El pilar tracciona (o casi): la flexotracción, con los primitivos de fibras del módulo (§4.3). */
  | { tipo: "traccion"; N: number; My: number; Mz: number }
  /** Lo que el módulo no comprueba, con su motivo: cuenta como no cumplido (§4.2, punto 9). */
  | { tipo: "pendiente"; motivo: string };

/** Compresión mínima que admite el módulo de pilares, kN. */
export const ND_MINIMO = 1;

export function entradaPilar(t: DemandasTramo, d: Demanda): EntradaDemandaPilar {
  if (t.material.tipo !== "hormigon") return { tipo: "pendiente", motivo: `el material ${t.material.id} no es hormigón` };
  const [N, , , , My, Mz] = d.esfuerzos as [number, number, number, number, number, number];
  const s = t.seccion;
  let geom: Pick<EntradaPilar, "sectionType" | "b" | "h" | "D">;
  if (s.forma === "rectangular") geom = { sectionType: "rectangular", b: 1000 * s.b, h: 1000 * s.h };
  else if (s.forma === "circular") geom = { sectionType: "circular", b: 1000 * s.D, h: 1000 * s.D, D: 1000 * s.D };
  else return { tipo: "pendiente", motivo: `la sección ${s.id} (${s.forma}) no es rectangular ni circular` };
  if (-N < ND_MINIMO) return { tipo: "traccion", N, My, Mz };
  return { tipo: "flexocompresion", entrada: { ...geom, fck: t.material.fck, Nd: -N, MEdy: Math.abs(My), MEdz: Math.abs(Mz), L: t.longitudLibre, beta: 1 } };
}
