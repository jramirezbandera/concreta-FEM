/**
 * Fase DN (`docs/fem3d/desniveles.md`, DN-c): «Enrasar con…», que escribe el desnivel de un forjado para
 * que quede a ras de otro de su planta:
 * - **por arriba**: la misma cara superior (el desnivel del otro);
 * - **por abajo**: la misma cara inferior (Δ = Δ_otro − t_otro + t_este), como una losa de 20 junto a un
 *   reticular de 30, 10 cm más baja.
 * Es una orden, no un modo: escribe el número con los cantos de ahora, y si luego cambia un canto, el
 * desnivel se queda (el fichero tiene lo que se calcula, como AC-b). Un desnivel nulo no se escribe.
 * El número se redondea a 1e-9 m (V2c2-1), para que 0,3 − 0,2 no deje 0,09999999999999998.
 */
import { cantoSeccion } from "../agente/sensatez.ts";
import type { Losa, ModeloFisico, PanoUnidireccional, Vec2 } from "../compilador/fisico.ts";
import { distanciaEntreSegmentos } from "../compilador/poligonos.ts";
import type { Operacion } from "./operaciones.ts";
import type { Objeto } from "./referencias.ts";

export type Enrase = "arriba" | "abajo";

interface ForjadoE {
  coleccion: "losas" | "panos";
  objeto: Losa | PanoUnidireccional;
  canto: number | null;
}

function forjado(m: ModeloFisico, id: string): ForjadoE | null {
  const l = (m.losas ?? []).find((x) => x.id === id);
  if (l) return { coleccion: "losas", objeto: l, canto: l.espesor };
  const p = (m.panos ?? []).find((x) => x.id === id);
  if (!p) return null;
  const s = m.secciones.find((x) => x.id === p.seccion);
  return { coleccion: "panos", objeto: p, canto: s ? cantoSeccion(s) : null };
}

const redondo = (v: number) => Math.round(v * 1e9) / 1e9 + 0;

/** Desnivel de un forjado (0 si no lo tiene). */
export const desnivelDe = (f: { desnivel?: number }): number => f.desnivel ?? 0;

/** El desnivel que lo enrasa con el otro, o por qué no se puede. */
export function desnivelEnrasado(m: ModeloFisico, id: string, con: string, como: Enrase): { ok: true; desnivel: number } | { ok: false; mensaje: string } {
  const a = forjado(m, id);
  const b = forjado(m, con);
  if (!a || !b) return { ok: false, mensaje: `No hay un forjado ${!a ? id : con}.` };
  if (id === con) return { ok: false, mensaje: "Elija otro forjado: no se enrasa consigo mismo." };
  if (a.objeto.planta !== b.objeto.planta) return { ok: false, mensaje: `${con} está en otra planta (${b.objeto.planta}).` };
  if (como === "arriba") return { ok: true, desnivel: redondo(desnivelDe(b.objeto)) };
  if (a.canto === null || b.canto === null) return { ok: false, mensaje: `No se sabe el canto de ${a.canto === null ? id : con}: dé su sección con el canto.` };
  return { ok: true, desnivel: redondo(desnivelDe(b.objeto) - b.canto + a.canto) };
}

/** La operación de «Enrasar con…»: el forjado con su desnivel nuevo (sin el campo si es 0). */
export function enrasar(m: ModeloFisico, id: string, con: string, como: Enrase): { ok: true; operacion: Operacion; desnivel: number; etiqueta: string } | { ok: false; mensaje: string } {
  const r = desnivelEnrasado(m, id, con, como);
  if (!r.ok) return r;
  const f = forjado(m, id)!;
  const { desnivel: _, ...resto } = f.objeto;
  const objeto = (r.desnivel === 0 ? resto : { ...resto, desnivel: r.desnivel }) as unknown as Objeto;
  return { ok: true, operacion: { op: "cambiar", coleccion: f.coleccion, id, objeto }, desnivel: r.desnivel, etiqueta: `${id} enrasado por ${como} con ${con}` };
}

/**
 * Los otros forjados de su planta, los que tocan su borde primero (a menos de `tol`), y cada grupo por id:
 * con los que se puede enrasar.
 */
export function forjadosParaEnrasar(m: ModeloFisico, id: string, tol = 0.05): { id: string; toca: boolean }[] {
  const a = forjado(m, id);
  if (!a) return [];
  const anillos = (x: { contorno: readonly Vec2[]; huecos?: readonly (readonly Vec2[])[] }) => [x.contorno, ...(x.huecos ?? [])];
  const distancia = (x: Losa | PanoUnidireccional, y: Losa | PanoUnidireccional) => {
    let d = Infinity;
    for (const p of anillos(x))
      for (const q of anillos(y))
        for (let i = 0; i < p.length; i++)
          for (let j = 0; j < q.length; j++) d = Math.min(d, distanciaEntreSegmentos(p[i]!, p[(i + 1) % p.length]!, q[j]!, q[(j + 1) % q.length]!));
    return d;
  };
  return [...(m.losas ?? []), ...(m.panos ?? [])]
    .filter((x) => x.id !== id && x.planta === a.objeto.planta)
    .map((x) => ({ id: x.id, toca: distancia(a.objeto, x) <= tol }))
    .sort((x, y) => Number(y.toca) - Number(x.toca) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}
