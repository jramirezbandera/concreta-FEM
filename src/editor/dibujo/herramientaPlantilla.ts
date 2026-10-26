/**
 * Colocar y Girar la plantilla DXF (V2c-4, `docs/fem3d/dibujo.md` §10.3), como las demás
 * herramientas (`herramientas.ts`): máquinas de estados puras que dan la operación `plantillas`.
 *
 * - **Colocar:** un punto de la plantilla y su destino; la plantilla se traslada (`moverPlantilla`).
 * - **Girar:** el centro, un punto de la plantilla y hacia dónde va; la plantilla gira el ángulo entre
 *   los dos alrededor del centro (`girarPlantilla`). Con el ortogonal, a 0° o 90° de los ejes.
 *
 * Las dos vuelven a Elegir al terminar. Lo que se mueve es la plantilla, no el modelo: no cambia la
 * huella.
 *
 * Puro: sin IO, sin React ni DOM.
 */
import type { PlantillaDxf } from "../../agente/proyecto.ts";
import type { Vec2 } from "../../compilador/fisico.ts";
import type { Borrador, ContextoHerramienta, EstadoHerramienta, Evento, Paso, Plantillas } from "./herramientas.ts";
import { girarPlantilla, moverPlantilla } from "./plantilla.ts";

export type NombrePlantillaDxf = "colocarPlantilla" | "girarPlantilla";

export const esPlantillaDxf = (h: string): h is NombrePlantillaDxf => h === "colocarPlantilla" || h === "girarPlantilla";

/** La plantilla que se coloca y la lista entera (la operación la sustituye). */
export interface PlantillaHerramientaDxf {
  nombre?: string;
  lista?: readonly PlantillaDxf[];
}

const ESTADO_INICIAL: EstadoHerramienta = { puntos: [] };
const igual = (a: Vec2, b: Vec2) => a[0] === b[0] && a[1] === b[1];

/** El ángulo de c→a a c→b, grados en (−180, 180]. */
export function anguloEntre(c: Vec2, a: Vec2, b: Vec2): number {
  const g = ((Math.atan2(b[1] - c[1], b[0] - c[0]) - Math.atan2(a[1] - c[1], a[0] - c[0])) * 180) / Math.PI;
  const r = ((((g + 180) % 360) + 360) % 360) - 180;
  // Lo que queda a 1e-9° de un entero es ese entero (el ortogonal da 90 con el ruido de atan2)
  const k = Math.round(r);
  return Math.abs(r - k) < 1e-9 ? k || 0 : r;
}

export function pasoPlantillaDxf(h: NombrePlantillaDxf, e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  const t = ctx.plantillas.dxf;
  const pl = t?.lista?.find((x) => x.nombre === t.nombre);
  if (!pl || !t?.lista) return { estado: e, error: "Elija en el navegador la plantilla DXF que quiere colocar." };
  if (ev.tipo === "retroceso") return { estado: { puntos: e.puntos.slice(0, -1) } };
  if (ev.tipo !== "punto") return { estado: e };
  const p = ev.p;
  const ps = e.puntos.map((x) => x.p);
  if (ps.some((x) => igual(x, p))) return { estado: e };
  const hecho = (nueva: PlantillaDxf, etiqueta: string): Paso => ({
    estado: ESTADO_INICIAL,
    hecho: { operacion: { op: "plantillas", plantillas: t.lista!.map((x) => (x.nombre === pl.nombre ? nueva : x)) }, etiqueta },
    salir: true,
  });
  if (h === "colocarPlantilla") {
    if (!ps.length) return { estado: { puntos: [{ p }] } };
    return hecho(moverPlantilla(pl, ps[0]!, p), `Colocar la plantilla «${pl.nombre}»`);
  }
  if (ps.length < 2) return { estado: { puntos: [...e.puntos, { p }] } };
  const g = anguloEntre(ps[0]!, ps[1]!, p);
  if (g === 0) return { estado: e, error: "Ese punto está en la misma dirección: la plantilla no gira." };
  return hecho(girarPlantilla(pl, ps[0]!, g), `Girar la plantilla «${pl.nombre}» ${String(Math.round(g * 1e6) / 1e6).replace(".", ",")}°`);
}

export function borradorPlantillaDxf(h: NombrePlantillaDxf, e: EstadoHerramienta, cursor: Vec2 | null, r: Borrador): void {
  const ps = e.puntos.map((x) => x.p);
  if (!cursor || !ps.length) return;
  if (h === "colocarPlantilla") r.lineas.push([ps[0]!, cursor]);
  else {
    if (ps[1]) r.lineas.push([ps[0]!, ps[1]]);
    r.lineas.push([ps[0]!, cursor]);
  }
}

export function ayudaPlantillaDxf(h: NombrePlantillaDxf, e: EstadoHerramienta, t: Plantillas): string {
  const n = t.dxf?.nombre ? `«${t.dxf.nombre}»` : "";
  if (h === "colocarPlantilla")
    return e.puntos.length ? `Colocar la plantilla ${n}: a dónde va ese punto (clic, o «x; y» e Intro). Esc anula.` : `Colocar la plantilla ${n}: un punto de la plantilla (un vértice, un cruce…). Esc vuelve a Elegir.`;
  if (!e.puntos.length) return `Girar la plantilla ${n}: el centro del giro. Esc vuelve a Elegir.`;
  if (e.puntos.length === 1) return `Girar la plantilla ${n}: un punto de la plantilla que marque la dirección que gira. Esc anula.`;
  return `Girar la plantilla ${n}: hacia dónde va esa dirección (F8, el ortogonal). Esc anula.`;
}
