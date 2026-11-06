/**
 * La herramienta «Ábaco» (fase AC, `docs/fem3d/abacos.md` §3.5): un ábaco macizo en un forjado
 * reticular.
 *
 * - **En un pilar** (por defecto): un clic en un pilar que llega a un reticular pone un a × b según
 *   los nervios centrado en el eje del tramo que lo atraviesa (la regla de MA2).
 * - **Rectángulo:** dos esquinas opuestas, según los nervios del reticular del primer clic. Puede
 *   salirse del forjado (cuenta lo de dentro).
 *
 * Lo que solapa con otro ábaco (o queda a menos de h/2) se une con él en el mismo paso (AC-b).
 *
 * Puro: sin IO.
 */
import { huellaSeccion, PlantaFisica } from "../../agente/render/modelo.ts";
import type { Losa, Vec2 } from "../../compilador/fisico.ts";
import { distanciaABorde, puntoEnPoligono } from "../../compilador/poligonos.ts";
import { crearAbaco, idAbaco, nombreAbaco, poligonoRectangulo, rectanguloEsquinas, reticularDelPilar, reticularEn } from "../abacos.ts";
import { ESTADO_INICIAL, igual, type Borrador, type ContextoHerramienta, type EstadoHerramienta, type Evento, type Paso } from "./herramientas.ts";

export interface PlantillaAbaco {
  /** Un clic en un pilar (por defecto) o un rectángulo de dos esquinas. */
  modo?: "pilar" | "rectangulo";
  /** En un pilar: según los nervios y en perpendicular, m (por defecto, `LADO_ABACO`). */
  a?: number;
  b?: number;
}

/** El lado por defecto de un ábaco en un pilar, m (el de «Ábacos en los pilares»). */
export const LADO_ABACO = 2.4;

/** El pilar de la planta bajo q (en su huella, o con su eje a menos de `radio`), con el reticular al que llega. */
function pilarEn(ctx: ContextoHerramienta, q: Vec2, radio: number): { pilar: string; losa: Losa; eje: Vec2 } | null {
  let mejor: { pilar: string; losa: Losa; eje: Vec2; d: number } | null = null;
  for (const { p, seccion } of new PlantaFisica(ctx.modelo, ctx.planta).pilares()) {
    const h = huellaSeccion(p, seccion);
    const dentro = h ? ("anillo" in h ? puntoEnPoligono(q, h.anillo) || distanciaABorde(q, h.anillo) <= radio : Math.hypot(q[0] - h.centro[0], q[1] - h.centro[1]) <= h.radio + radio) : false;
    const r = reticularDelPilar(ctx.modelo, ctx.planta, p.id);
    if (!r) continue;
    const d = Math.hypot(q[0] - r.eje[0], q[1] - r.eje[1]);
    if (!dentro && d > radio) continue;
    if (!mejor || d < mejor.d) mejor = { pilar: p.id, losa: r.losa, eje: r.eje, d };
  }
  return mejor;
}

const lados = (ctx: ContextoHerramienta): [number, number] | string => {
  const t = ctx.plantillas.abaco ?? {};
  const [a, b] = [t.a ?? LADO_ABACO, t.b ?? t.a ?? LADO_ABACO];
  return a > 0 && b > 0 ? [a, b] : "Escriba en Propiedades las dos medidas del ábaco, mayores que 0.";
};

/** El ábaco que pondría un clic en q con la plantilla «en un pilar» (null si no hay pilar). */
function enPilar(ctx: ContextoHerramienta, q: Vec2, radio: number): { pilar: string; losa: Losa; poligono: Vec2[]; ya: number } | string | null {
  const p = pilarEn(ctx, q, radio);
  if (!p) return null;
  const ab = lados(ctx);
  if (typeof ab === "string") return ab;
  const ya = (p.losa.reticular!.abacos ?? []).findIndex((x) => puntoEnPoligono(p.eje, x as Vec2[]));
  return { pilar: p.pilar, losa: p.losa, poligono: poligonoRectangulo(p.losa, { centro: p.eje, a: ab[0], b: ab[1] }), ya };
}

const conTolerancia = (ctx: ContextoHerramienta) => (ctx.toleranciaAbacos !== undefined ? [ctx.toleranciaAbacos] : []) as [number?];

export function pasoAbaco(e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  const m = ctx.modelo;
  const modo = ctx.plantillas.abaco?.modo ?? "pilar";
  if (ev.tipo === "retroceso") return { estado: ESTADO_INICIAL };
  if (ev.tipo !== "punto") return { estado: e };
  if (modo === "pilar") {
    const r = enPilar(ctx, ev.cursor ?? ev.p, ev.radio ?? 0);
    if (!r) return { estado: e, error: "Un clic en un pilar que llegue a un forjado reticular de la planta (o «Rectángulo», en Propiedades)." };
    if (typeof r === "string") return { estado: e, error: r };
    if (r.ya >= 0) return { estado: e, error: `${r.pilar} ya tiene ábaco (${nombreAbaco(idAbaco(r.losa.id, r.ya))}): elíjalo para cambiarlo.` };
    const c = crearAbaco(m, r.losa.id, r.poligono, ...conTolerancia(ctx));
    if (!c.ok) return { estado: e, error: c.mensaje };
    return { estado: ESTADO_INICIAL, hecho: { operacion: c.operacion, etiqueta: `Ábaco en ${r.pilar}`, ...(c.avisos.length ? { avisos: c.avisos } : {}) } };
  }
  // Rectángulo: la primera esquina, en un reticular; la segunda, donde sea
  if (!e.puntos.length) {
    const l = reticularEn(m, ctx.planta, ev.cursor ?? ev.p);
    if (!l) return { estado: e, error: "La primera esquina del ábaco, dentro de un forjado reticular de la planta." };
    return { estado: { puntos: [{ p: ev.p }], objeto: l.id } };
  }
  if (igual(ev.p, e.puntos[0]!.p)) return { estado: e };
  const l = m.losas?.find((x) => x.id === e.objeto);
  if (!l?.reticular) return { estado: ESTADO_INICIAL };
  const p = rectanguloEsquinas(l, e.puntos[0]!.p, ev.p);
  if (!p) return { estado: e, error: "Las dos esquinas están en una misma recta de los nervios: el ábaco no tendría área." };
  const c = crearAbaco(m, l.id, p, ...conTolerancia(ctx));
  if (!c.ok) return { estado: e, error: c.mensaje };
  return { estado: ESTADO_INICIAL, hecho: { operacion: c.operacion, etiqueta: `Ábaco en ${l.id}`, ...(c.avisos.length ? { avisos: c.avisos } : {}) } };
}

export function borradorAbaco(e: EstadoHerramienta, cursor: Vec2 | null, ctx: ContextoHerramienta, r: Borrador, crudo: Vec2 | null, radio = 0): void {
  if ((ctx.plantillas.abaco?.modo ?? "pilar") === "pilar") {
    const q = crudo ?? cursor;
    const x = q ? enPilar(ctx, q, radio) : null;
    if (x && typeof x !== "string" && x.ya < 0) r.anillos.push(x.poligono);
    return;
  }
  const l = e.objeto ? ctx.modelo.losas?.find((x) => x.id === e.objeto) : undefined;
  if (!l?.reticular || !cursor || !e.puntos.length) return;
  const p = rectanguloEsquinas(l, e.puntos[0]!.p, cursor);
  if (p) r.anillos.push(p);
}

export function ayudaAbaco(e: EstadoHerramienta, modo: PlantillaAbaco["modo"]): string {
  if ((modo ?? "pilar") === "pilar") return "Ábaco: un clic en un pilar de un forjado reticular (el tamaño, en Propiedades). Si solapa con otro, se unen. Esc vuelve a Elegir.";
  return e.puntos.length ? `Ábaco en ${e.objeto}: la otra esquina (según sus nervios). Esc anula.` : "Ábaco: la primera esquina, dentro de un forjado reticular. Si solapa con otro, se unen. Esc vuelve a Elegir.";
}
