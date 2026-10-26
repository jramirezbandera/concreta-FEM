/**
 * Las herramientas de editar con el ratón de V2c-3 (`docs/fem3d/dibujo.md` §2.5 y §9): Mover, Copiar,
 * Girar y Simetría, como las de dibujar (`herramientas.ts`): máquinas de estados puras que reciben los
 * eventos de la vista ya enganchados y dan, al terminar, la `Operacion` (`transformar.ts`).
 *
 * - **Lo que se transforma** es lo elegido. Sin nada elegido, la herramienta espera a que se elija:
 *   los clics y las ventanas eligen como con Elegir (quien la usa no se los pasa), y un clic sin Ctrl
 *   o Intro lo confirma (evento `elegidos`). Con algo elegido al activarla, empieza ya.
 * - **Mover y Copiar:** el punto base y el destino, con enganches y teclado («@dx; dy» es relativo al
 *   punto base). Copiar pone una copia en cada destino hasta Intro o Esc. Con plantas en la plantilla,
 *   las copias van a ellas; Intro sin punto base las copia allí en su sitio.
 * - **Girar:** el centro y el ángulo, desde +X: un clic (con el ortogonal, 0°, 90°…) o los grados
 *   escritos.
 * - **Simetría:** dos puntos del eje. Con «conservar» en la plantilla, queda también lo original.
 * - **Vigas unidas a los pilares** (V2c-d): por defecto lo siguen; con «conVigas» en false o Ctrl en el
 *   último clic, no. Copiar las deja donde están (lo original no se mueve).
 *
 * Mover, Girar y Simetría vuelven al punto base con lo mismo elegido (los ids no cambian). Esc anula el
 * punto en curso y, sin él, sale a Elegir.
 *
 * Puro: sin IO, sin React ni DOM.
 */
import { rotuloCota } from "../../agente/render/ejes.ts";
import type { Vec2 } from "../../compilador/fisico.ts";
import { indiceIds, lista } from "../referencias.ts";
import { anguloDe, listaIds, transformar, Transformador, type Transformacion } from "../transformar.ts";
import { igual, type Borrador, type ContextoHerramienta, type EstadoHerramienta, type Evento, type Paso, type Plantillas } from "./herramientas.ts";

export const EDITAR = ["mover", "copiar", "girar", "simetria"] as const;
export type NombreEditar = (typeof EDITAR)[number];
export const esEditar = (h: string): h is NombreEditar => (EDITAR as readonly string[]).includes(h);

export interface PlantillaEditar {
  /** Mover, Girar y Simetría: las vigas que acaban en el punto fijo de un pilar que se mueve lo siguen (V2c-d). Por defecto, sí. */
  conVigas?: boolean;
  /** Copiar: las plantas de las copias de lo que es de una planta (vacío: la suya). */
  plantas?: readonly string[];
  /** Simetría: conservar lo original (la simetría es una copia). */
  conservar?: boolean;
}

const NOMBRE: Record<NombreEditar, string> = { mover: "Mover", copiar: "Copiar", girar: "Girar", simetria: "Simetría" };

/** Los ids de lo elegido que tienen geometría (lo demás no se transforma). */
function conGeometria(ctx: ContextoHerramienta, ids: readonly string[]): string[] {
  const idx = indiceIds(ctx.modelo);
  return ids.filter((id) => {
    const c = idx.get(id)?.coleccion;
    return !!c && c !== "plantas" && c !== "materiales" && c !== "secciones" && c !== "casos";
  });
}

/** El ángulo de un giro con centro c hasta el punto p, grados en (−180, 180]. */
export function anguloGiro(c: Vec2, p: Vec2): number {
  const g = anguloDe([p[0] - c[0], p[1] - c[1]]);
  return g > 180 ? g - 360 : g;
}

/** La transformación de la herramienta con el primer punto `a` y el segundo `b`. */
export function transformacionDe(h: NombreEditar, a: Vec2, b: Vec2): Transformacion {
  if (h === "girar") return { tipo: "girar", centro: a, angulo: anguloGiro(a, b) };
  if (h === "simetria") return { tipo: "simetria", a, b };
  return { tipo: "mover", de: a, a: b };
}

const grados = (g: number) => `${rotuloCota(g)}°`;
/** Un número de la etiqueta de deshacer: los decimales que tenga, hasta la décima de mm. */
const numero = (x: number) => String(Math.round(x * 1e4) / 1e4 + 0).replace(".", ",");

/** Lo que dice deshacer de una transformación de `ids`. */
function etiqueta(ids: readonly string[], t: Transformacion, copia: boolean): string {
  const que = listaIds(ids, 3);
  if (t.tipo === "mover") return `${copia ? "Copiar" : "Mover"} ${que} (${numero(t.a[0] - t.de[0])}; ${numero(t.a[1] - t.de[1])} m)`;
  if (t.tipo === "girar") return `Girar ${que} ${numero(t.angulo)}°`;
  return `Simetría de ${que}${copia ? " (con lo original)" : ""}`;
}

/** Aplica la transformación de la herramienta; con `ctrl`, sin las vigas de los pilares. */
function hacer(h: NombreEditar, e: EstadoHerramienta, t: Transformacion, ctx: ContextoHerramienta, ctrl: boolean): Paso {
  const ids = e.elegidos!;
  const p = ctx.plantillas.editar ?? {};
  const copiar = h === "copiar" || (h === "simetria" && !!p.conservar);
  const r = transformar(ctx.modelo, ids, t, { copiar, ...(h === "copiar" && p.plantas?.length ? { plantas: p.plantas } : {}), conVigas: p.conVigas !== false && !ctrl });
  if (!r.ok) return { estado: e, error: r.mensaje };
  // Copiar sigue en el destino (otra copia); lo demás vuelve al punto base con lo mismo elegido
  const estado: EstadoHerramienta = h === "copiar" ? e : { puntos: [], elegidos: ids };
  return { estado, hecho: { operacion: r.operacion, etiqueta: etiqueta(ids, t, copiar), ...(r.avisos.length ? { avisos: r.avisos } : {}) } };
}

export function pasoEditar(h: NombreEditar, e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  // Sin lo elegido confirmado: se elige (los clics y las ventanas van a elegir) y se confirma
  if (!e.elegidos) {
    const confirmar = (ids: readonly string[]): Paso => {
      const g = conGeometria(ctx, ids);
      if (!g.length) return { estado: e, error: ids.length ? "Lo elegido no tiene geometría: elija pilares, vigas, forjados, muros, apoyos, cargas o ejes." : `${NOMBRE[h]}: elija primero lo que quiere ${h === "copiar" ? "copiar" : h === "girar" ? "girar" : h === "simetria" ? "reflejar" : "mover"}.` };
      return { estado: { puntos: [], elegidos: g } };
    };
    if (ev.tipo === "elegidos") return confirmar(ev.ids);
    if (ev.tipo === "terminar") return confirmar(ctx.elegidos ?? []);
    if (ev.tipo === "anular") return { estado: e, salir: true };
    if (ev.tipo === "punto") {
      // Con algo elegido (en la vista, el navegador o la tabla), el clic es el primer punto
      const g = conGeometria(ctx, ctx.elegidos ?? []);
      if (g.length) return pasoEditar(h, { puntos: [], elegidos: g }, ev, ctx);
      return { estado: e, error: `${NOMBRE[h]}: elija primero lo que quiere transformar.` };
    }
    return { estado: e };
  }
  switch (ev.tipo) {
    case "elegidos": {
      // Otra elección (en el navegador o la tabla): empieza con ella
      const g = conGeometria(ctx, ev.ids);
      return { estado: g.length ? { puntos: [], elegidos: g } : { puntos: [] } };
    }
    case "punto": {
      const a = e.puntos[0];
      if (!a) return { estado: { ...e, puntos: [{ p: ev.p }] } };
      // El segundo clic de un doble clic, en el mismo punto, no hace nada
      if (igual(a.p, ev.p)) return { estado: e };
      return hacer(h, e, transformacionDe(h, a.p, ev.p), ctx, !!ev.ctrl);
    }
    case "fijar": {
      // Girar: los grados escritos
      const a = e.puntos[0];
      if (h !== "girar" || !a) return { estado: e };
      return hacer(h, e, { tipo: "girar", centro: a.p, angulo: ev.valor }, ctx, false);
    }
    case "terminar":
      // Copiar: acaba de poner copias; sin punto base y con plantas en la plantilla, copia en su sitio a ellas
      if (h !== "copiar") return { estado: e };
      if (e.puntos.length) return { estado: { puntos: [], elegidos: e.elegidos } };
      if (ctx.plantillas.editar?.plantas?.length) return hacer(h, e, { tipo: "mover", de: [0, 0], a: [0, 0] }, ctx, false);
      return { estado: e };
    case "retroceso":
      return { estado: { ...e, puntos: e.puntos.slice(0, -1) } };
    case "anular":
      return e.puntos.length ? { estado: { puntos: [], elegidos: e.elegidos } } : { estado: e, salir: true };
    default:
      return { estado: e };
  }
}

/** Lo elegido como se dibuja en la planta: sus contornos, sus líneas y sus puntos (apoyos y cargas puntuales). */
function geometriaElegidos(ctx: ContextoHerramienta, ids: readonly string[]): { cerrados: Vec2[][]; abiertos: Vec2[][]; puntos: Vec2[] } {
  const r = { cerrados: [] as Vec2[][], abiertos: [] as Vec2[][], puntos: [] as Vec2[] };
  const en = new Set(ids);
  for (const s of ctx.indice.siluetas) {
    if (!en.has(s.id)) continue;
    r.cerrados.push(...s.cerrados);
    if (!s.cerrados.length) r.abiertos.push(...s.abiertos);
    en.delete(s.id);
  }
  // Lo que el índice no dibuja: apoyos, cargas y bandas
  const idx = indiceIds(ctx.modelo);
  for (const id of en) {
    const x = idx.get(id);
    if (!x) continue;
    const o = lista(ctx.modelo, x.coleccion)[x.indice]!;
    if (o.planta !== undefined && o.planta !== ctx.planta) continue;
    if (typeof o.x === "number" && typeof o.y === "number") r.puntos.push([o.x, o.y as number]);
    else if (Array.isArray(o.puntos)) r.abiertos.push(o.puntos as Vec2[]);
    else if (Array.isArray(o.zona)) r.cerrados.push(o.zona as Vec2[]);
  }
  return r;
}

export function borradorEditar(h: NombreEditar, e: EstadoHerramienta, cursor: Vec2 | null, ctx: ContextoHerramienta, r: Borrador): void {
  const a = e.puntos[0]?.p;
  if (!e.elegidos || !a || !cursor || igual(a, cursor)) return;
  const tr = new Transformador(transformacionDe(h, a, cursor));
  const g = geometriaElegidos(ctx, e.elegidos);
  const mover = (ps: readonly Vec2[]) => ps.map((p) => tr.punto(p));
  r.anillos.push(...g.cerrados.map(mover));
  r.lineas.push(...g.abiertos.map(mover));
  r.puntos.push(...g.puntos.map((p) => tr.punto(p)));
  if (h === "simetria") {
    // El eje, de lado a lado
    const d: Vec2 = [cursor[0] - a[0], cursor[1] - a[1]];
    const l = Math.hypot(d[0], d[1]);
    const k = 1e4 / l;
    r.lineas.push([
      [a[0] - k * d[0], a[1] - k * d[1]],
      [a[0] + k * d[0], a[1] + k * d[1]],
    ]);
  } else if (h === "girar") {
    // La referencia de 0° y el radio hasta el cursor
    const l = Math.hypot(cursor[0] - a[0], cursor[1] - a[1]);
    r.lineas.push([[a[0] + l, a[1]], a, cursor]);
  } else r.lineas.push([a, cursor]);
}

/** Lo que dice la barra del cursor: el desplazamiento o el ángulo. */
export function medidaEditar(h: NombreEditar, e: EstadoHerramienta, cursor: Vec2 | null): string | null {
  const a = e.puntos[0]?.p;
  if (!e.elegidos || !a || !cursor) return null;
  if (h === "girar") return `Ángulo ${grados(anguloGiro(a, cursor))}`;
  if (h === "simetria") return null;
  return `Δ ${rotuloCota(cursor[0] - a[0])}; ${rotuloCota(cursor[1] - a[1])} m`;
}

export function ayudaEditar(h: NombreEditar, e: EstadoHerramienta, t: Plantillas): string {
  const n = NOMBRE[h];
  if (!e.elegidos) return `${n}: elija lo que quiere transformar (clic o ventana; con Ctrl+clic, varios e Intro). Esc vuelve a Elegir.`;
  const que = e.elegidos.length === 1 ? e.elegidos[0]! : `${e.elegidos.length} objetos`;
  const vigas = t.editar?.conVigas === false ? "" : " Con Ctrl, los pilares sin sus vigas.";
  if (!e.puntos.length) {
    if (h === "girar") return `Girar ${que}: el centro del giro. Esc vuelve a Elegir.`;
    if (h === "simetria") return `Simetría de ${que}: el primer punto del eje. Esc vuelve a Elegir.`;
    if (h === "copiar" && t.editar?.plantas?.length) return `Copiar ${que} a ${t.editar.plantas.join(", ")}: el punto base, o Intro para copiarlo en su sitio. Esc vuelve a Elegir.`;
    return `${n} ${que}: el punto base. Esc vuelve a Elegir.`;
  }
  if (h === "girar") return `Girar ${que}: el ángulo, desde +X (un clic, o los grados e Intro).${vigas} Esc anula.`;
  if (h === "simetria") return `Simetría de ${que}: el segundo punto del eje.${t.editar?.conservar ? "" : vigas} Esc anula.`;
  if (h === "copiar") return `Copiar ${que}: el destino (clic, «x; y» o «@dx; dy»); una copia por clic. Intro o Esc acaba.`;
  return `Mover ${que}: el destino (clic, «x; y», «@dx; dy» o una distancia).${vigas} Esc anula.`;
}
