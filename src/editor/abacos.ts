/**
 * «Ábacos en los pilares» (decisión del usuario, 2026-10-13): los ábacos de un forjado reticular,
 * generados como un rectángulo centrado en cada pilar que llega a él, orientado con sus nervios
 * (su `eje1`). Se quedan como polígonos en `reticular.abacos`, así que el proyecto.json y el
 * cálculo no cambian, y cada uno se puede retocar después en la tabla Forjados.
 *
 * - Llega al forjado un pilar que pasa por su planta (también si arranca o acaba en ella) y cuyo eje
 *   está en el forjado (dentro o en su borde, no en un hueco).
 * - Un pilar cuyo eje ya está en un ábaco se deja como está.
 * - Un ábaco nuevo que se solaparía con otro (nuevo o de antes) no se crea. (Desde MA2 el compilador
 *   une los que se tocan, y `reticular.abacosPilares` los pone él solo en cada pilar, sin esta orden.)
 * - Un ábaco puede salirse del forjado (cuenta su parte dentro): se dice, sin más.
 *
 * Puro: sin IO.
 */
import type { Losa, ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { pilaresEnLosa, rectanguloAbaco } from "../compilador/abacos.ts";
import { areaConSigno, areaInterseccionRegiones, puntoEnPoligono, type Region } from "../compilador/poligonos.ts";
import type { Operacion } from "./operaciones.ts";

export interface PropuestaAbacos {
  losa: string;
  /** Los ábacos nuevos, con el pilar de cada uno, en el orden de los pilares del modelo. */
  nuevos: { pilar: string; poligono: Vec2[] }[];
  /** Pilares que ya tienen un ábaco (su eje dentro de uno): se dejan. */
  conAbaco: string[];
  /** Pilares cuyo ábaco se solaparía con otro: no se crea. */
  solapados: string[];
  /** Pilares cuyo ábaco nuevo se sale del forjado (cuenta su parte dentro). */
  fuera: string[];
}

const region = (p: readonly Vec2[]): Region => ({ contorno: p, huecos: [] });

/** Los ábacos de `a` × `b` m (según los nervios y su perpendicular) en los pilares que llegan al reticular `losaId`. */
export function proponerAbacos(m: ModeloFisico, losaId: string, a: number, b: number): PropuestaAbacos | { error: string } {
  const l = (m.losas ?? []).find((x) => x.id === losaId) as Losa | undefined;
  if (!l) return { error: `No hay ninguna losa «${losaId}».` };
  if (!l.reticular) return { error: `${losaId} no es un forjado reticular: sólo los reticulares tienen ábacos.` };
  if (!(a > 0 && b > 0)) return { error: "El ábaco tiene que tener las dos medidas mayores que 0." };
  const R: Region = { contorno: l.contorno, huecos: l.huecos ?? [] };
  const g = ((l.eje1 ?? 0) * Math.PI) / 180;
  const d: Vec2 = [Math.cos(g), Math.sin(g)];
  const n: Vec2 = [-d[1], d[0]];
  const existentes = (l.reticular.abacos ?? []).map((p) => p as Vec2[]);
  const r: PropuestaAbacos = { losa: losaId, nuevos: [], conAbaco: [], solapados: [], fuera: [] };
  // Los pilares que llegan al forjado, con el eje del tramo que lo atraviesa (la regla de MA2)
  for (const { pilar, eje: c } of pilaresEnLosa(m, l)) {
    if (existentes.some((e) => puntoEnPoligono(c, e))) {
      r.conAbaco.push(pilar);
      continue;
    }
    const poligono = rectanguloAbaco(c, a, b, d, n);
    if ([...existentes, ...r.nuevos.map((x) => x.poligono)].some((e) => areaInterseccionRegiones(region(e), region(poligono)) > 1e-9)) {
      r.solapados.push(pilar);
      continue;
    }
    r.nuevos.push({ pilar, poligono });
    if (areaInterseccionRegiones(R, region(poligono)) < Math.abs(areaConSigno(poligono)) - 1e-9) r.fuera.push(pilar);
  }
  return r;
}

/** La operación que añade los ábacos de la propuesta a su losa (null si no hay ninguno nuevo). */
export function operacionAbacos(m: ModeloFisico, p: PropuestaAbacos): Operacion | null {
  const l = (m.losas ?? []).find((x) => x.id === p.losa);
  if (!l?.reticular || !p.nuevos.length) return null;
  const abacos = [...(l.reticular.abacos ?? []), ...p.nuevos.map((x) => x.poligono)];
  return { op: "cambiar", coleccion: "losas", id: l.id, objeto: { ...l, reticular: { ...l.reticular, abacos } } as never };
}
