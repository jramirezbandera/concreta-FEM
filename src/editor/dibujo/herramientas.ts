/**
 * Las herramientas de dibujo de V2c-1 (`docs/fem3d/dibujo.md` §2.1 y §2.4): Ejes, Pilar y Viga, cada
 * una una máquina de estados pura. Recibe los eventos de la vista ya en coordenadas del modelo y
 * enganchados (`enganches.ts`) y devuelve su estado nuevo y, cuando termina un objeto, la `Operacion`
 * que lo crea (una acción, un paso de deshacer), con lo mismo que daría su fila en la tabla.
 *
 * - **Ejes:** dos clics. El primero que se dibuja en un modelo sin ejes guarda también los propuestos,
 *   que son los que se ven (si no, desaparecerían). Su nombre, la letra o el número siguiente según
 *   vaya como los ejes con letra o como los numerados (`compilador/ejes.ts`).
 * - **Pilar:** un clic, con la plantilla (desde, hasta, sección, giro y punto fijo); el punto del clic
 *   es el punto fijo. Con una ventana, uno en cada cruce de ejes de dentro, por filas de arriba abajo
 *   y de izquierda a derecha. Donde ya hay un pilar en las mismas plantas no se pone otro.
 *   Cotas temporales (CT1, `docs/fem3d/cotas.md` §2.1, `cotas.ts`): Tab elige una de las cotas del
 *   cursor, un número la fija (esa dirección queda a esa distancia de su referencia; la otra sigue al
 *   cursor), e Intro o un clic coloca el pilar con lo fijado. Esc suelta lo fijado.
 * - **Viga:** polilínea a clics; doble clic o Intro termina, Retroceso quita el último punto. Eje a eje
 *   por defecto (el punto enganchado, el punto fijo de un pilar); con `alinear`, cada tramo que nace o
 *   acaba en un pilar se desplaza hasta que su cara izquierda o derecha (según el sentido del dibujo)
 *   queda en la de la huella del pilar (V2c-b).
 *
 * Esc anula lo que está en curso y, sin nada en curso, sale a Elegir.
 *
 * Las de V2c-2 están en `piezas.ts` (Forjado, Hueco, Muro, Apoyo y Apoyo lineal) y `cargas.ts`
 * (Puntual, Lineal, Superficie, En barra y Empuje); aquí, lo que las reparte.
 *
 * Puro: sin IO, sin React ni DOM.
 */
import { rotuloCota } from "../../agente/render/ejes.ts";
import { anchoViga, huellaSeccion, PlantaFisica } from "../../agente/render/modelo.ts";
import { direccionEjes, ejesDe, letraEje, proponerEjes } from "../../compilador/ejes.ts";
import type { EjeReplanteo, ModeloFisico, Pilar, PuntoFijo, Vec2, Viga } from "../../compilador/fisico.ts";
import type { Operacion } from "../operaciones.ts";
import { indiceIds, type Objeto } from "../referencias.ts";
import { idNuevo } from "../tablas.ts";
import { colocar, cotasEn, LADOS, ladosEn, nombreCota, referenciaEn, referenciasDe, type CotaTemporal, type Fijo, type Lado } from "./cotas.ts";
import { unitario, type Enganche, type IndiceEnganches } from "./enganches.ts";
import { ayudaCarga, borradorCarga, esCarga, pasoCarga, type NombreCarga, type PlantillaCargas } from "./cargas.ts";
import { ayudaPieza, borradorPieza, esPieza, pasoPieza, type NombrePieza, type PlantillaApoyo, type PlantillaForjado, type PlantillaHueco, type PlantillaMuro } from "./piezas.ts";

/** Las de V2c-1 (ejes, pilar, viga), las de las piezas de V2c-2 (`piezas.ts`) y las de las cargas (`cargas.ts`). */
export type NombreHerramienta = "elegir" | "ejes" | "pilar" | "viga" | NombrePieza | NombreCarga;

export interface PlantillaPilar {
  /** Planta de la base; por defecto, la más baja. */
  desde?: string;
  /** Planta de la cabeza; por defecto, la de la vista. */
  hasta?: string;
  seccion?: string;
  giro?: number;
  fijo?: PuntoFijo;
}

export type Alinear = "eje" | "izquierda" | "derecha";

export interface PlantillaViga {
  seccion?: string;
  /** Eje a eje (por defecto) o con una cara en la de los pilares (V2c-b). */
  alinear?: Alinear;
}

export interface Plantillas {
  pilar: PlantillaPilar;
  viga: PlantillaViga;
  /** V2c-2 (`piezas.ts`). */
  forjado?: PlantillaForjado;
  hueco?: PlantillaHueco;
  muro?: PlantillaMuro;
  apoyo?: PlantillaApoyo;
  apoyoLineal?: PlantillaApoyo;
  /** V2c-2 (`cargas.ts`): el caso activo y lo de cada tipo de carga. */
  cargas?: PlantillaCargas;
}

/** Un punto de lo que se dibuja; `pilar`, si se enganchó a uno. */
export interface PuntoDibujo {
  p: Vec2;
  pilar?: string;
}

export interface EstadoHerramienta {
  puntos: readonly PuntoDibujo[];
  /** Pilar: las cotas fijadas (a lo sumo una por dirección). */
  fijos?: readonly Fijo[];
  /** Pilar: la cota que fija el número que se teclee (Tab). */
  activa?: Lado;
  /** V2c-2: el objeto sobre el que se trabaja (el muro o el forjado de un hueco, la viga de una carga en un tramo). */
  objeto?: string;
  /** Hueco: el objeto es un muro. */
  enMuro?: boolean;
}

export const ESTADO_INICIAL: EstadoHerramienta = { puntos: [] };

export interface ContextoHerramienta {
  modelo: ModeloFisico;
  /** La planta de la vista en la que se dibuja. */
  planta: string;
  indice: IndiceEnganches;
  plantillas: Plantillas;
}

export type Evento =
  /**
   * Un clic, o un punto tecleado (sin enganche). `cursor`, el punto del ratón sin enganchar (lo que
   * se elige con un clic dentro o a un lado de algo: un recuadro, un forjado, el lado de un muro) y
   * `radio`, el de enganche en m (lo que se elige con un clic encima: una viga, un muro).
   */
  | { tipo: "punto"; p: Vec2; enganche?: Enganche | null; cursor?: Vec2; radio?: number }
  /** Doble clic o Intro; con el punto del cursor (ya enganchado), si lo hay. */
  | { tipo: "terminar"; p?: Vec2 | null; enganche?: Enganche | null }
  /** Tab (Mayús+Tab, `atras`): la cota siguiente del cursor. */
  | { tipo: "tab"; cursor: Vec2 | null; atras?: boolean }
  /** Un número tecleado: la distancia de la cota activa. */
  | { tipo: "fijar"; valor: number; cursor: Vec2 | null }
  /** Esc. */
  | { tipo: "anular" }
  | { tipo: "retroceso" }
  /** Una ventana, m: [x0, y0, x1, y1]. */
  | { tipo: "ventana"; caja: readonly [number, number, number, number] };

export interface Hecho {
  operacion: Operacion;
  etiqueta: string;
}

export interface Paso {
  estado: EstadoHerramienta;
  hecho?: Hecho;
  /** Por qué no se hizo lo que se pedía. */
  error?: string;
  /** Vuelve a Elegir. */
  salir?: boolean;
}

/** Lo que se pinta encima mientras se dibuja: líneas abiertas, contornos cerrados, puntos y cotas temporales. */
export interface Borrador {
  lineas: Vec2[][];
  anillos: Vec2[][];
  puntos: Vec2[];
  cotas: CotaTemporal[];
}

export const igual = (a: Vec2, b: Vec2) => a[0] === b[0] && a[1] === b[1];

// ─── Plantas y plantilla del pilar ──────────────────────────────────────────────────────────────

const indicePlanta = (m: ModeloFisico, id: string) => m.plantas.findIndex((p) => p.id === id);

/** Desde y hasta de un pilar (o un muro, `de`) nuevo, con los de por defecto. Las plantas van de arriba abajo. */
export function plantasPilar(m: ModeloFisico, planta: string, t: { desde?: string; hasta?: string }, de = "del pilar"): { ok: true; desde: string; hasta: string } | { ok: false; mensaje: string } {
  const desde = t.desde || m.plantas[m.plantas.length - 1]?.id;
  const hasta = t.hasta || planta;
  if (!desde || indicePlanta(m, desde) < 0) return { ok: false, mensaje: `Elija en Propiedades la planta de la base ${de}.` };
  if (indicePlanta(m, hasta) < 0) return { ok: false, mensaje: `No hay ninguna planta «${hasta}».` };
  if (indicePlanta(m, desde) <= indicePlanta(m, hasta)) return { ok: false, mensaje: `La base (${desde}) tiene que estar por debajo de la cabeza (${hasta}): elija otras en Propiedades o dibuje en una planta más alta.` };
  return { ok: true, desde, hasta };
}

export const seccionValida = (m: ModeloFisico, s: string | undefined) => !!s && m.secciones.some((x) => x.id === s);

/** Un pilar de la plantilla en p, sin id, o por qué no se puede. */
function pilarEn(ctx: ContextoHerramienta, p: Vec2): { ok: true; pilar: Omit<Pilar, "id"> } | { ok: false; mensaje: string } {
  const t = ctx.plantillas.pilar;
  const pl = plantasPilar(ctx.modelo, ctx.planta, t);
  if (!pl.ok) return pl;
  if (!seccionValida(ctx.modelo, t.seccion)) return { ok: false, mensaje: "Elija en Propiedades la sección del pilar (o cree una)." };
  return {
    ok: true,
    pilar: { x: p[0], y: p[1], desde: pl.desde, hasta: pl.hasta, seccion: t.seccion!, ...(t.giro ? { giro: t.giro } : {}), ...(t.fijo && t.fijo !== "centro" ? { fijo: t.fijo } : {}) },
  };
}

/** ¿Hay ya un pilar en p que comparta alguna planta con desde–hasta? */
function pilarRepetido(m: ModeloFisico, p: Vec2, desde: string, hasta: string): string | null {
  const [a, b] = [indicePlanta(m, hasta), indicePlanta(m, desde)];
  for (const x of m.pilares ?? []) {
    if (x.x !== p[0] || x.y !== p[1]) continue;
    const [c, d] = [indicePlanta(m, x.hasta), indicePlanta(m, x.desde)];
    // Tramos [cabeza, base) de arriba abajo: se solapan si comparten alguno
    if (a < d && c < b) return x.id;
  }
  return null;
}

// ─── Ejes ───────────────────────────────────────────────────────────────────────────────────────

/** La operación de guardar los ejes propuestos (sin ejes en el modelo), o null si no hay propuesta. */
export function operacionProponerEjes(m: ModeloFisico): Hecho | null {
  if (m.ejes?.length) return null;
  const { ejes } = proponerEjes(m);
  if (!ejes.length) return null;
  return { operacion: { op: "lote", operaciones: ejes.map((e) => ({ op: "crear", coleccion: "ejes", objeto: e as unknown as Objeto })) }, etiqueta: `Guardar los ${ejes.length} ejes propuestos` };
}

/** El eje de a a b, con el nombre siguiente: letra si va como los ejes con letra, número si no. */
export function ejeNuevo(m: ModeloFisico, a: Vec2, b: Vec2): Hecho {
  const { ejes: actuales, propuestos } = ejesDe(m);
  const antes: EjeReplanteo[] = propuestos ? [...actuales] : [];
  const usados = new Set(actuales.flatMap((e) => [e.id, e.nombre ?? e.id]));
  const ocupados = new Set([...indiceIds(m).keys(), ...antes.map((e) => e.id)]);
  const d = unitario(direccionEjes(m));
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const conLetra = Math.abs(((b[0] - a[0]) * d[0] + (b[1] - a[1]) * d[1]) / l) >= Math.SQRT1_2;
  let nombre = "";
  for (let i = 0; ; i++) {
    nombre = conLetra ? letraEje(i) : String(i + 1);
    if (!usados.has(nombre)) break;
  }
  const id = !ocupados.has(nombre) ? nombre : !ocupados.has(`eje-${nombre}`) ? `eje-${nombre}` : idNuevo(m, "E", ocupados);
  const eje: EjeReplanteo = { id, ...(id !== nombre ? { nombre } : {}), desde: a, hasta: b };
  const crear = (e: EjeReplanteo): Operacion => ({ op: "crear", coleccion: "ejes", objeto: e as unknown as Objeto });
  const etiqueta = `Eje ${nombre}`;
  if (!antes.length) return { operacion: crear(eje), etiqueta };
  return { operacion: { op: "lote", operaciones: [...antes.map(crear), crear(eje)] }, etiqueta: `${etiqueta} (y los ${antes.length} propuestos)` };
}

// ─── Vigas ──────────────────────────────────────────────────────────────────────────────────────

/** Cuánto sale la huella del pilar `id` en la dirección unitaria n (máx. c·n de su huella), o null. */
function salida(pl: PlantaFisica, id: string, n: Vec2): number | null {
  const x = pl.pilares().find((y) => y.p.id === id);
  const h = x && huellaSeccion(x.p, x.seccion);
  if (!h) return null;
  if ("anillo" in h) return Math.max(...h.anillo.map((c) => c[0] * n[0] + c[1] * n[1]));
  return h.centro[0] * n[0] + h.centro[1] * n[1] + h.radio;
}

/**
 * El eje de una viga alineada a la cara de sus pilares (V2c-b): cada tramo con un pilar en un extremo
 * se desplaza en perpendicular hasta que la cara de la viga del lado `lado` (según el sentido del
 * dibujo) queda en la de la huella del pilar; los vértices son los cruces de los tramos desplazados.
 * Un tramo sin pilar no se mueve.
 */
export function alinearACara(m: ModeloFisico, planta: string, puntos: readonly PuntoDibujo[], lado: "izquierda" | "derecha", ancho: number): Vec2[] {
  const pl = new PlantaFisica(m, planta);
  const s = lado === "izquierda" ? 1 : -1;
  const lineas = puntos.slice(0, -1).map((x, k) => {
    const a = x.p;
    const b = puntos[k + 1]!.p;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const n: Vec2 = [-s * t[1] + 0, s * t[0] + 0];
    const [id, ref] = x.pilar ? [x.pilar, a] : puntos[k + 1]!.pilar ? [puntos[k + 1]!.pilar!, b] : [null, a];
    const e = id ? salida(pl, id, n) : null;
    const delta = e === null ? 0 : e - ancho / 2 - (ref[0] * n[0] + ref[1] * n[1]);
    const mover = (p: Vec2): Vec2 => (delta === 0 ? p : [p[0] + delta * n[0], p[1] + delta * n[1]]);
    return { a: mover(a), b: mover(b), t };
  });
  if (!lineas.length) return puntos.map((x) => x.p);
  const r: Vec2[] = [lineas[0]!.a];
  for (let i = 1; i < lineas.length; i++) {
    const [u, v] = [lineas[i - 1]!, lineas[i]!];
    const den = u.t[0] * v.t[1] - u.t[1] * v.t[0];
    if (Math.abs(den) < 1e-12) r.push(v.a);
    else {
      const k = ((v.a[0] - u.a[0]) * v.t[1] - (v.a[1] - u.a[1]) * v.t[0]) / den;
      r.push([u.a[0] + k * u.t[0], u.a[1] + k * u.t[1]]);
    }
  }
  r.push(lineas[lineas.length - 1]!.b);
  return r;
}

/** Los puntos de la viga que se crea con la plantilla. */
function puntosViga(ctx: ContextoHerramienta, puntos: readonly PuntoDibujo[]): Vec2[] {
  const t = ctx.plantillas.viga;
  if (!t.alinear || t.alinear === "eje" || puntos.length < 2) return puntos.map((x) => x.p);
  const b = anchoViga(ctx.modelo.secciones.find((x) => x.id === t.seccion));
  return alinearACara(ctx.modelo, ctx.planta, puntos, t.alinear, b);
}

// ─── El paso de cada herramienta ────────────────────────────────────────────────────────────────

function pasoEjes(e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  if (ev.tipo !== "punto") return { estado: e };
  const a = e.puntos[0];
  if (!a) return { estado: { puntos: [{ p: ev.p }] } };
  // El segundo clic de un doble clic, en el mismo punto, no es un eje
  if (igual(a.p, ev.p)) return { estado: e };
  return { estado: ESTADO_INICIAL, hecho: ejeNuevo(ctx.modelo, a.p, ev.p) };
}

/** Los cruces de ejes de la caja, por filas de arriba abajo y de izquierda a derecha. */
const crucesEn = (ix: IndiceEnganches, [x0, y0, x1, y1]: readonly [number, number, number, number]) =>
  ix.crucesEjes.filter((c) => c[0] >= x0 && c[0] <= x1 && c[1] >= y0 && c[1] <= y1).sort((a, b) => b[1] - a[1] || a[0] - b[0]);

/** El pilar en el punto del cursor con lo fijado; lo fijado se suelta al colocarlo. */
function ponerPilar(e: EstadoHerramienta, cursor: Vec2, ctx: ContextoHerramienta): Paso {
  const m = ctx.modelo;
  const p = colocar(referenciasDe(m, ctx.indice), cursor, e.fijos);
  const r = pilarEn(ctx, p);
  if (!r.ok) return { estado: e, error: r.mensaje };
  const ya = pilarRepetido(m, p, r.pilar.desde, r.pilar.hasta);
  if (ya) return { estado: e, error: `Ya hay un pilar (${ya}) en ese punto en esas plantas.` };
  const id = idNuevo(m, "P");
  return { estado: ESTADO_INICIAL, hecho: { operacion: { op: "crear", coleccion: "pilares", objeto: { id, ...r.pilar } as unknown as Objeto }, etiqueta: `Pilar ${id}` } };
}

const SIN_CURSOR = "Lleve el cursor a la planta.";

/** ¿Van l y k por la misma dirección (izquierda y derecha, o abajo y arriba)? */
const mismaDireccion = (l: Lado, k: Lado) => (l === "izquierda" || l === "derecha") === (k === "izquierda" || k === "derecha");

function pasoPilar(e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  const m = ctx.modelo;
  if (ev.tipo === "punto") return ponerPilar(e, ev.p, ctx);
  if (ev.tipo === "terminar") {
    // Intro coloca con lo fijado; sin nada fijado, no hace nada (coloca el clic)
    if (!e.fijos?.length) return { estado: e };
    if (!ev.p) return { estado: e, error: SIN_CURSOR };
    return ponerPilar(e, ev.p, ctx);
  }
  if (ev.tipo === "tab") {
    if (!ev.cursor) return { estado: e, error: SIN_CURSOR };
    const R = referenciasDe(m, ctx.indice);
    const lados = ladosEn(R, colocar(R, ev.cursor, e.fijos), e.fijos);
    if (!lados.length) return { estado: e, error: "No hay ningún eje ni pilar al que acotar." };
    const orden = ev.atras ? [...LADOS].reverse() : LADOS;
    const k = e.activa ? orden.indexOf(e.activa) : -1;
    const sig = [...orden.slice(k + 1), ...orden.slice(0, k + 1)].find((l) => lados.includes(l))!;
    return { estado: { ...e, activa: sig } };
  }
  if (ev.tipo === "fijar") {
    const lado = e.activa;
    if (!lado) return { estado: e, error: "Pulse Tab para elegir la cota que fija el número." };
    if (!ev.cursor) return { estado: e, error: SIN_CURSOR };
    if (!(ev.valor >= 0)) return { estado: e, error: "La distancia no puede ser negativa: para el otro lado, elija con Tab la cota de ese lado." };
    const R = referenciasDe(m, ctx.indice);
    // La referencia: la de lo ya fijado en ese lado o la más cercana del cursor
    const ref = e.fijos?.find((f) => f.lado === lado)?.ref ?? referenciaEn(R, colocar(R, ev.cursor, e.fijos), lado);
    if (!ref) return { estado: e, error: `No hay ningún eje ni pilar a ese lado (${lado}).` };
    const fijos = [...(e.fijos ?? []).filter((f) => !mismaDireccion(f.lado, lado)), { lado, ref, valor: ev.valor }];
    // La cota activa pasa a la primera de la otra dirección, si no está fijada
    const otra = fijos.length < 2 ? ladosEn(R, colocar(R, ev.cursor, fijos), fijos).find((l) => !mismaDireccion(l, lado)) : undefined;
    return { estado: { puntos: e.puntos, fijos, ...(otra ? { activa: otra } : {}) } };
  }
  if (ev.tipo === "ventana") {
    const cs = crucesEn(ctx.indice, ev.caja);
    if (!cs.length) return { estado: e, error: "No hay cruces de ejes dentro de la ventana." };
    const ocupados = new Set<string>();
    const ops: Operacion[] = [];
    for (const c of cs) {
      const r = pilarEn(ctx, c);
      if (!r.ok) return { estado: e, error: r.mensaje };
      if (pilarRepetido(m, c, r.pilar.desde, r.pilar.hasta)) continue;
      const id = idNuevo(m, "P", ocupados);
      ocupados.add(id);
      ops.push({ op: "crear", coleccion: "pilares", objeto: { id, ...r.pilar } as unknown as Objeto });
    }
    if (!ops.length) return { estado: e, error: "Ya hay un pilar en todos los cruces de la ventana." };
    // La ventana no usa lo fijado, y lo suelta
    return { estado: ESTADO_INICIAL, hecho: { operacion: ops.length === 1 ? ops[0]! : { op: "lote", operaciones: ops }, etiqueta: ops.length === 1 ? `Pilar ${[...ocupados][0]}` : `${ops.length} pilares en los cruces de ejes` } };
  }
  return { estado: e };
}

function pasoViga(e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  switch (ev.tipo) {
    case "punto": {
      const u = e.puntos[e.puntos.length - 1];
      // Un clic en el mismo punto (el segundo de un doble clic) no añade nada
      if (u && igual(u.p, ev.p)) return { estado: e };
      const pilar = ev.enganche && ctx.indice.siluetas.some((s) => s.tipo === "pilar" && s.id === ev.enganche!.objeto) ? ev.enganche.objeto : undefined;
      return { estado: { puntos: [...e.puntos, { p: ev.p, ...(pilar ? { pilar } : {}) }] } };
    }
    case "retroceso":
      return { estado: { puntos: e.puntos.slice(0, -1) } };
    case "terminar": {
      if (e.puntos.length < 2) return { estado: e, ...(e.puntos.length ? { error: "Una viga necesita al menos dos puntos." } : {}) };
      const s = ctx.plantillas.viga.seccion;
      if (!seccionValida(ctx.modelo, s)) return { estado: e, error: "Elija en Propiedades la sección de la viga (o cree una)." };
      const id = idNuevo(ctx.modelo, "V");
      const viga: Viga = { id, planta: ctx.planta, puntos: puntosViga(ctx, e.puntos), seccion: s! };
      return { estado: ESTADO_INICIAL, hecho: { operacion: { op: "crear", coleccion: "vigas", objeto: viga as unknown as Objeto }, etiqueta: `Viga ${id}` } };
    }
    default:
      return { estado: e };
  }
}

/** El paso de la herramienta `h` con el evento `ev`. */
export function paso(h: NombreHerramienta, e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  if (ev.tipo === "anular") return e.puntos.length || e.fijos?.length || e.activa || e.objeto ? { estado: ESTADO_INICIAL } : { estado: e, salir: true };
  if (h === "ejes") return pasoEjes(e, ev, ctx);
  if (h === "pilar") return pasoPilar(e, ev, ctx);
  if (h === "viga") return pasoViga(e, ev, ctx);
  if (esPieza(h)) return pasoPieza(h, e, ev, ctx);
  if (esCarga(h)) return pasoCarga(h, e, ev, ctx);
  return { estado: e };
}

/** Lo que se pinta con el cursor en `cursor` (ya enganchado); `crudo`, el del ratón sin enganchar (el recuadro de Forjado, el lado de un empuje). */
export function borrador(h: NombreHerramienta, e: EstadoHerramienta, cursor: Vec2 | null, ctx: ContextoHerramienta, crudo: Vec2 | null = cursor): Borrador {
  const r: Borrador = { lineas: [], anillos: [], puntos: e.puntos.map((x) => x.p), cotas: [] };
  if (h === "ejes" && e.puntos[0] && cursor) r.lineas.push([e.puntos[0].p, cursor]);
  if (h === "pilar" && cursor) {
    const R = referenciasDe(ctx.modelo, ctx.indice);
    cursor = colocar(R, cursor, e.fijos);
    r.cotas = cotasEn(R, cursor, e.fijos, e.activa);
    const t = ctx.plantillas.pilar;
    const s = ctx.modelo.secciones.find((x) => x.id === t.seccion);
    const huella = huellaSeccion({ id: "", x: cursor[0], y: cursor[1], desde: "", hasta: "", seccion: t.seccion ?? "", ...(t.giro ? { giro: t.giro } : {}), ...(t.fijo ? { fijo: t.fijo } : {}) }, s);
    if (huella && "anillo" in huella) r.anillos.push(huella.anillo);
    else if (huella) r.anillos.push(Array.from({ length: 32 }, (_, i): Vec2 => [huella.centro[0] + huella.radio * Math.cos((i * Math.PI) / 16), huella.centro[1] + huella.radio * Math.sin((i * Math.PI) / 16)]));
  }
  if (h === "viga" && e.puntos.length) {
    const ps = cursor && !igual(cursor, e.puntos[e.puntos.length - 1]!.p) ? [...e.puntos, { p: cursor }] : [...e.puntos];
    r.lineas.push(ps.map((x) => x.p));
    const t = ctx.plantillas.viga;
    if (t.alinear && t.alinear !== "eje" && ps.length > 1) r.lineas.push(puntosViga(ctx, ps));
  }
  if (esPieza(h)) borradorPieza(h, e, cursor, ctx, r, crudo);
  if (esCarga(h)) borradorCarga(h, e, cursor, ctx, r, crudo);
  return r;
}

/** Lo que dice la herramienta que hay que hacer ahora; `t`, con lo que cambia según la plantilla (el modo). */
export function ayuda(h: NombreHerramienta, e: EstadoHerramienta, t: Plantillas = { pilar: {}, viga: {} }): string {
  if (esPieza(h)) return ayudaPieza(h, e, t);
  if (esCarga(h)) return ayudaCarga(h, e, t);
  if (h === "ejes") return e.puntos.length ? "Eje: el segundo punto. Esc anula." : "Eje: el primer punto (clic, o «x; y» e Intro). Esc vuelve a Elegir.";
  if (h === "pilar") {
    if (e.fijos?.length) return `Pilar: ${e.fijos.map((f) => `${rotuloCota(f.valor)} ${nombreCota(f)}`).join(" y ")}. Clic o Intro lo coloca; Tab y un número fijan otra cota; Esc suelta lo fijado.`;
    if (e.activa) return `Pilar: escriba la distancia de la cota ${e.activa} e Intro. Tab cambia de cota; Esc la suelta.`;
    return "Pilar: un clic donde va su punto fijo, o una ventana para uno en cada cruce de ejes. Tab elige una cota para escribir su distancia. Esc vuelve a Elegir.";
  }
  if (h === "viga")
    return e.puntos.length
      ? `Viga: el punto siguiente (${e.puntos.length} puesto${e.puntos.length > 1 ? "s" : ""}). Doble clic o Intro termina; Retroceso quita el último; Esc anula.`
      : "Viga: el primer punto. Esc vuelve a Elegir.";
  return "";
}

/** El último punto de lo que se dibuja (para la perpendicular, las relativas y el ortogonal). */
export const ultimoPunto = (e: EstadoHerramienta): Vec2 | null => e.puntos[e.puntos.length - 1]?.p ?? null;
