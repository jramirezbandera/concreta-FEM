/**
 * Una retícula de ejes por sus luces (UI-41, P-12 de la auditoría de la interfaz): «5 5 5» o «3×5»
 * en X y en Y, con su origen y su giro, de una vez. Para un 3 × 3 eran doce puntos tecleados.
 *
 * - Los ejes que cortan X (paralelos a Y) se numeran 1, 2… de izquierda a derecha, y los que cortan
 *   Y (paralelos a X), A, B… de abajo arriba, como los propuestos (`compilador/ejes.ts`).
 * - Cada eje sobresale MARGEN_EJES de los extremos de la retícula, para que sus burbujas queden fuera.
 * - Sustituye a los ejes que tuviera el proyecto (un paso de deshacer). Un id que ya usa otro objeto
 *   pasa a `eje-<id>`, con el nombre de siempre.
 * - Sin giro, las coordenadas son las sumas de las luces redondeadas a 1e-9 m (lo que se teclea).
 *
 * Puro: sin IO.
 */
import { letraEje, MARGEN_EJES } from "../../compilador/ejes.ts";
import type { EjeReplanteo, ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import { leerNumero } from "../celdas.ts";
import type { Operacion } from "../operaciones.ts";
import { indiceIds, type Objeto } from "../referencias.ts";

/** Lo más que se pide de una vez (por dirección). */
export const MAX_LUCES = 60;

/**
 * Las luces escritas: números separados por espacios o «;» y repeticiones «n×L» (o «nxL», «n*L»).
 * «5 5,5 5» o «3×5 6». Vacío, ninguna (sólo el eje del origen).
 */
export function leerLuces(t: string): { ok: true; luces: number[] } | { ok: false; mensaje: string } {
  const luces: number[] = [];
  for (const parte of t.trim().split(/[\s;]+/).filter(Boolean)) {
    const m = /^(\d+)\s*[x×*]\s*(.+)$/i.exec(parte);
    const n = m ? Number(m[1]) : 1;
    const v = leerNumero(m ? m[2]! : parte);
    if (typeof v === "string" || !(v > 0)) return { ok: false, mensaje: `«${parte}» no es una luz (un número mayor que 0, o «3×5»)` };
    if (!(n >= 1) || luces.length + n > MAX_LUCES) return { ok: false, mensaje: `como mucho ${MAX_LUCES} luces por dirección` };
    for (let i = 0; i < n; i++) luces.push(v);
  }
  return { ok: true, luces };
}

const r9 = (v: number) => Math.round(v * 1e9) / 1e9 + 0;

export interface Reticula {
  lucesX: readonly number[];
  lucesY: readonly number[];
  origen?: Vec2;
  /** Grados desde +X, alrededor del origen. */
  giro?: number;
}

/** Los ejes de una retícula y la operación que los guarda (sustituyendo a los que hubiera). */
export function operacionReticula(m: ModeloFisico, o: Reticula): { ok: true; operacion: Operacion; etiqueta: string; ejes: EjeReplanteo[] } | { ok: false; mensaje: string } {
  if (!o.lucesX.length && !o.lucesY.length) return { ok: false, mensaje: "Dé las luces en X, en Y o en las dos." };
  const [ox, oy] = o.origen ?? [0, 0];
  const giro = o.giro ?? 0;
  const acumular = (l: readonly number[]) => l.reduce<number[]>((a, v) => [...a, r9(a[a.length - 1]! + v)], [0]);
  const xs = acumular(o.lucesX);
  const ys = acumular(o.lucesY);
  const [x0, x1, y0, y1] = [-MARGEN_EJES, xs[xs.length - 1]! + MARGEN_EJES, -MARGEN_EJES, ys[ys.length - 1]! + MARGEN_EJES];
  const [c, s] = [Math.cos((giro * Math.PI) / 180), Math.sin((giro * Math.PI) / 180)];
  const p = (u: number, v: number): Vec2 => (giro === 0 ? [r9(ox + u), r9(oy + v)] : [ox + u * c - v * s, oy + u * s + v * c]);
  // Los ids que ya usan otros objetos (sin contar los ejes, que se sustituyen)
  const viejos = new Set((m.ejes ?? []).map((e) => e.id));
  const ocupados = new Set([...indiceIds(m).keys()].filter((id) => !viejos.has(id)));
  const eje = (nombre: string, desde: Vec2, hasta: Vec2): EjeReplanteo => {
    const id = ocupados.has(nombre) ? `eje-${nombre}` : nombre;
    return { id, ...(id !== nombre ? { nombre } : {}), desde, hasta };
  };
  const ejes = [...(o.lucesX.length ? xs.map((x, i) => eje(String(i + 1), p(x, y0), p(x, y1))) : []), ...(o.lucesY.length ? ys.map((y, i) => eje(letraEje(i), p(x0, y), p(x1, y))) : [])];
  const operaciones: Operacion[] = [...(viejos.size ? [{ op: "borrar", ids: [...viejos] } as Operacion] : []), ...ejes.map((e) => ({ op: "crear", coleccion: "ejes", objeto: e as unknown as Objeto }) as Operacion)];
  const n = (l: readonly number[]) => (l.length ? `${l.length + 1}` : "0");
  return { ok: true, operacion: { op: "lote", operaciones }, etiqueta: `Retícula de ejes (${n(o.lucesX)} × ${n(o.lucesY)})`, ejes };
}
