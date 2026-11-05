/**
 * Lo que hace el ingeniero en las tablas del editor (V2a, `docs/fem3d/visor.md` §6.2), traducido a
 * operaciones (`operaciones.ts`): escribir una fila, pegar un bloque de Excel, copiar una tabla a
 * Excel y copiar objetos a otras plantas.
 *
 * Pegar es todo o nada: si una fila no vale, no entra ninguna y se dice qué fila falla y por qué.
 *
 * Puro: sin IO.
 */
import type { Proyecto } from "../agente/proyecto.ts";
import type { ModeloFisico } from "../compilador/fisico.ts";
import { canonico } from "../compilador/huella.ts";
import { escribirTsv, leerTsv, type ErrorCelda, type Fila } from "./celdas.ts";
import { aplicar, nombreColeccion, type Aplicacion, type Operacion } from "./operaciones.ts";
import { indiceIds, lista, type Coleccion, type Objeto } from "./referencias.ts";
import { contexto, DEF_TABLAS, idNuevo, objetosTabla, TABLAS, type NombreTabla } from "./tablas.ts";

export interface ErrorFila {
  /** Fila del bloque pegado, desde 1 (sin contar la cabecera), o null en una sola fila. */
  fila: number | null;
  id?: string;
  columna?: string;
  mensaje: string;
}

/** `ademas` (UI-15): lo que la fila cambia en otros objetos de su tabla (ya incluido en `operacion`). */
export type Traduccion = { ok: true; operacion: Operacion; ademas?: readonly CambioOtro[] } | { ok: false; errores: ErrorFila[] };

/** Un campo de otro objeto de la tabla que cambia una fila (Plantas: la altura de la de debajo). */
export interface CambioOtro {
  coleccion: Coleccion;
  id: string;
  campo: string;
  valor: unknown;
}

/** Las operaciones de unos cambios de campo sobre el modelo `m`. */
function operacionesCambios(m: ModeloFisico, cambios: readonly CambioOtro[]): Operacion[] {
  return cambios.map((c) => ({ op: "cambiar", coleccion: c.coleccion, id: c.id, objeto: { ...lista(m, c.coleccion).find((o) => o.id === c.id)!, [c.campo]: c.valor } }));
}

const deCeldas = (fila: number | null, id: string | undefined, es: readonly ErrorCelda[]): ErrorFila[] => es.map((e) => ({ fila, ...(id ? { id } : {}), columna: e.columna, mensaje: e.mensaje }));

/**
 * La operación de escribir una fila de una tabla: cambiar el objeto `id` (con sus campos que la
 * tabla no edita) o, con `id` null, crear uno nuevo (con id propio si la celda está vacía).
 */
export function operacionFila(m: ModeloFisico, tabla: NombreTabla, id: string | null, fila: Fila, ocupados: ReadonlySet<string> = new Set(), numero: number | null = null): Traduccion {
  const def = DEF_TABLAS[tabla];
  const ctx = contexto(m);
  const base = id === null ? undefined : objetosTabla(m, tabla).find((o) => o.id === id);
  if (id !== null && !base) return { ok: false, errores: [{ fila: numero, id, mensaje: `No hay ningún objeto «${id}» en ${def.titulo.toLowerCase()}.` }] };
  const f = id === null && (fila.id ?? "").trim() === "" ? { ...fila, id: idNuevo(m, def.prefijoDe?.(fila) ?? def.prefijo, ocupados) } : fila;
  const l = def.objeto(f, ctx, base);
  if (!l.ok) return { ok: false, errores: deCeldas(numero, f.id || id || undefined, l.errores) };
  const coleccion = l.coleccion ?? def.colecciones[0]!;
  if (id === null) return { ok: true, operacion: { op: "crear", coleccion, objeto: l.objeto } };
  const x = def.ademas ? def.ademas(f, ctx, base) : { ok: true as const, cambios: [] };
  if (!x.ok) return { ok: false, errores: deCeldas(numero, f.id || id || undefined, x.errores) };
  const ademas = x.cambios.map((c) => ({ ...c, coleccion }));
  // En Forjados, un cambio de tipo pasa el objeto de las losas a los paños o al revés
  const de = ctx.coleccionDe(id)!;
  const propia: Operacion = de === coleccion ? { op: "cambiar", coleccion, id, objeto: l.objeto } : { op: "convertir", de, coleccion, id, objeto: l.objeto };
  if (!ademas.length) return { ok: true, operacion: propia };
  return { ok: true, operacion: { op: "lote", operaciones: [propia, ...operacionesCambios(m, ademas)] }, ademas };
}

/** Escribe una fila y aplica la operación. */
export function escribirFila(p: Proyecto, tabla: NombreTabla, id: string | null, fila: Fila): Aplicacion {
  const t = operacionFila(p.modelo, tabla, id, fila);
  if (!t.ok) return { ok: false, errores: t.errores.map((e) => ({ codigo: "editor/celda", severidad: "error" as const, mensaje: `${e.columna ? `${e.columna}: ` : ""}${e.mensaje}`, ...(e.id ? { ids: [e.id] } : {}), detalles: { columna: e.columna } })) };
  return aplicar(p, t.operacion);
}

/** Las filas de una tabla (las de una planta, si se da), en el orden del modelo. */
export function filas(m: ModeloFisico, tabla: NombreTabla, planta?: string): { id: string; fila: Fila }[] {
  const def = DEF_TABLAS[tabla];
  const ctx = contexto(m);
  return objetosTabla(m, tabla)
    .filter((o) => {
      if (planta === undefined) return true;
      const ps = def.plantas(o, ctx);
      return ps === null || ps.includes(planta);
    })
    .map((o) => ({ id: o.id, fila: def.fila(o, ctx) }));
}

/** Una tabla como texto para pegar en una hoja de cálculo, con su cabecera (las claves de las columnas). */
export function exportar(m: ModeloFisico, tabla: NombreTabla, planta?: string): string {
  const cols = DEF_TABLAS[tabla].columnas;
  return escribirTsv([cols.map((c) => c.clave), ...filas(m, tabla, planta).map((f) => cols.map((c) => f.fila[c.clave] ?? ""))]);
}

/**
 * Pega un bloque de una hoja de cálculo en una tabla.
 *
 * - Con cabecera (la primera fila son los nombres de las columnas, por su clave o su título): una
 *   fila con un id de la tabla la cambia (lo que no se pega se queda como estaba); una con un id
 *   nuevo, o sin id, crea un objeto.
 * - Sin cabecera, las columnas van en el orden de la tabla desde la columna `desde`. Con `destino`
 *   (las filas que se ven, por su id, y la fila donde se pega), como en Excel: cada fila pegada
 *   sobrescribe la fila de la tabla que le toca y, pasada la última, crea una nueva. Sin `destino`,
 *   por el id, como con cabecera.
 *
 * Todo o nada: si una fila no vale, no entra ninguna.
 */
export function pegar(m: ModeloFisico, tabla: NombreTabla, texto: string, desde = 0, destino?: { ids: readonly string[]; fila: number }): Traduccion {
  const def = DEF_TABLAS[tabla];
  const ctx = contexto(m);
  const celdas = leerTsv(texto);
  if (celdas.length === 0) return { ok: false, errores: [{ fila: null, mensaje: "No hay nada que pegar." }] };
  const norm = (x: string) => x.trim().toLowerCase();
  const porNombre = (x: string) => def.columnas.findIndex((c) => norm(c.clave) === norm(x) || norm(c.titulo) === norm(x));
  const cabecera = celdas[0]!.every((x) => x.trim() === "" || porNombre(x) >= 0) && celdas[0]!.some((x) => x.trim() !== "");
  const columnas = cabecera ? celdas[0]!.map((x) => (x.trim() === "" ? null : def.columnas[porNombre(x)]!.clave)) : celdas[0]!.map((_, i) => def.columnas[desde + i]?.clave ?? null);
  const datos = cabecera ? celdas.slice(1) : celdas;
  const errores: ErrorFila[] = [];
  const ancho = Math.max(...datos.map((f) => f.length));
  if (!cabecera && desde + ancho > def.columnas.length) errores.push({ fila: null, mensaje: `El bloque tiene ${ancho} columnas y desde «${def.columnas[desde]?.titulo}» la tabla sólo tiene ${def.columnas.length - desde}.` });
  const idx = indiceIds(m);
  const ops: Operacion[] = [];
  const otros: CambioOtro[] = [];
  const vistos = new Set<string>();
  const enPosicion = !cabecera && destino !== undefined;
  datos.forEach((celdasFila, i) => {
    const num = i + 1;
    const pegada: Record<string, string> = {};
    celdasFila.forEach((v, j) => {
      const c = columnas[j];
      const col = def.columnas.find((x) => x.clave === c);
      if (c && !col?.calculada && !col?.derivada) pegada[c] = v;
    });
    // La fila de la tabla que se cambia: la de su posición o la de su id
    let baseId: string | undefined;
    if (enPosicion) baseId = destino.ids[destino.fila + i];
    else {
      const id = (pegada.id ?? "").trim();
      const ya = id === "" ? undefined : idx.get(id);
      if (ya && !def.colecciones.includes(ya.coleccion)) return errores.push({ fila: num, id, columna: "id", mensaje: `«${id}» ya es un id de ${ya.coleccion}` });
      if (ya) baseId = id;
    }
    const base = baseId === undefined ? undefined : objetosTabla(m, tabla).find((o) => o.id === baseId);
    const fila = base ? { ...def.fila(base, ctx), ...pegada } : pegada;
    const id = (fila.id ?? "").trim();
    if (id !== "") {
      if (vistos.has(id)) return errores.push({ fila: num, id, columna: "id", mensaje: `el id «${id}» está repetido en lo pegado` });
      vistos.add(id);
    }
    const t = operacionFila(m, tabla, base ? base.id : null, fila, vistos, num);
    if (!t.ok) return errores.push(...t.errores);
    if (t.operacion.op === "crear") vistos.add(t.operacion.objeto.id);
    // Lo que la fila cambia en otras (UI-15) va al final, sobre la operación de esas filas si las hay
    ops.push(t.ademas ? t.operacion.op === "lote" ? t.operacion.operaciones[0]! : t.operacion : t.operacion);
    if (t.ademas) otros.push(...t.ademas);
  });
  if (errores.length) return { ok: false, errores };
  // UI-15: pegada en un proyecto sin plantas, la tabla es el edificio entero, y la celda de cada fila
  // es la altura de su tramo de debajo, que el modelo guarda en la fila siguiente
  if (tabla === "plantas" && m.plantas.length === 0) {
    const nuevas = ops.filter((o): o is Extract<Operacion, { op: "crear" }> => o.op === "crear");
    const celdas = nuevas.map((o) => (o.objeto as { altura?: number | null }).altura ?? null);
    nuevas.forEach((o, k) => ((o.objeto as { altura?: number | null }).altura = k === 0 ? null : celdas[k - 1]!));
  }
  for (const c of otros) {
    const k = ops.findIndex((o) => (o.op === "cambiar" || o.op === "convertir") && o.id === c.id);
    if (k >= 0) {
      const o = ops[k] as Extract<Operacion, { op: "cambiar" }>;
      ops[k] = { ...o, objeto: { ...o.objeto, [c.campo]: c.valor } };
    } else ops.push(...operacionesCambios(m, [c]));
  }
  return { ok: true, operacion: { op: "lote", operaciones: ops } };
}

// ─── Copiar a otras plantas ─────────────────────────────────────────────────────────────────────

/** Las colecciones que se copian de planta a planta: las que están en una sola planta. */
const COPIABLES: readonly Coleccion[] = ["vigas", "losas", "apoyos", "apoyosLineales", "panos", "cargas"];

/** El id de la copia en otra planta: el id con la planta de origen cambiada por la de destino, o «<id>-<destino>». */
function idCopia(id: string, origen: string, destino: string, usado: (x: string) => boolean): string {
  const sep = /[-_.:]/;
  let x = id.endsWith(origen) && id.length > origen.length && sep.test(id[id.length - origen.length - 1]!) ? id.slice(0, id.length - origen.length) + destino : `${id}-${destino}`;
  if (usado(x)) {
    const raiz = x;
    for (let i = 2; usado(x); i++) x = `${raiz}-${i}`;
  }
  return x;
}

/** Los objetos de una sola planta (los que «copiar la planta entera» copia): no los pilares ni lo que cuelga de ellos. */
/**
 * UI-37: lo que se ve en una planta, para Ctrl+A: los objetos de las tablas que van por plantas y
 * pasan por ella (los pilares y muros de varias, también); con `soloCargas`, sólo sus cargas (en
 * Cargas), y con `caso`, sólo las de ese caso.
 */
export function objetosVisibles(m: ModeloFisico, planta: string, o: { soloCargas?: boolean; caso?: string } = {}): string[] {
  const ctx = contexto(m);
  const r: string[] = [];
  for (const t of o.soloCargas ? (["cargas"] as const) : TABLAS) {
    for (const x of objetosTabla(m, t)) {
      if (o.caso && t === "cargas" && x.caso !== o.caso) continue;
      if (DEF_TABLAS[t].plantas(x, ctx)?.includes(planta)) r.push(x.id);
    }
  }
  return r;
}

export function objetosDePlanta(m: ModeloFisico, planta: string): string[] {
  const ctx = contexto(m);
  const r: string[] = [];
  for (const c of COPIABLES)
    for (const o of lista(m, c)) {
      if (c === "cargas") {
        const ps = DEF_TABLAS.cargas.plantas(o, ctx);
        if (o.tipo === "pilar" || o.tipo === "empuje" || ps?.length !== 1 || ps[0] !== planta) continue;
      } else if (o.planta !== planta) continue;
      r.push(o.id);
    }
  return r;
}

/** Dónde está una pieza de planta (su geometría), para reconocer su igual en otra; null en una carga. */
function sitio(c: Coleccion, o: Objeto): string | null {
  const g = c === "losas" || c === "panos" ? o.contorno : c === "apoyos" ? [o.x, o.y] : c === "vigas" || c === "apoyosLineales" ? o.puntos : undefined;
  return g === undefined ? null : `${c}|${JSON.stringify(g)}`;
}

/**
 * Copia unos objetos a otras plantas. Los ids nuevos llevan la planta de destino. Las cargas que se
 * copian con la viga, la losa o el paño en que van pasan a la copia.
 *
 * Lo que ya está (`auditoria-ui.md`, UI-6): una pieza con otra del mismo tipo en el mismo sitio en la
 * planta de destino no se copia (antes se duplicaba y el modelo dejaba de compilar), y sus cargas van
 * a esa; una carga sobre una pieza que no se copia va a su igual del destino (antes no se podía
 * copiar), y si el destino no la tiene, no se copia y se dice; una carga igual a otra que ya está no se
 * duplica. Lo que se salta va en `avisos`.
 */
export function copiarAPlantas(m: ModeloFisico, ids: readonly string[], destinos: readonly string[]): Traduccion & { avisos?: string[] } {
  const idx = indiceIds(m);
  const errores: ErrorFila[] = [];
  const objetos: { coleccion: Coleccion; o: Objeto; origen: string }[] = [];
  const plantas = new Set(m.plantas.map((p) => p.id));
  for (const d of destinos) if (!plantas.has(d)) errores.push({ fila: null, mensaje: `No hay ninguna planta «${d}».` });
  const ctx = contexto(m);
  for (const id of ids) {
    const x = idx.get(id);
    if (!x) {
      errores.push({ fila: null, id, mensaje: `No hay ningún objeto «${id}».` });
      continue;
    }
    if (!COPIABLES.includes(x.coleccion)) {
      errores.push({ fila: null, id, mensaje: x.coleccion === "pilares" ? `${id} es un pilar: para llevarlo a otras plantas se cambian su «desde» y su «hasta».` : `${id} no está en una planta: no se copia.` });
      continue;
    }
    const o = lista(m, x.coleccion)[x.indice]!;
    const ps = x.coleccion === "cargas" ? DEF_TABLAS.cargas.plantas(o, ctx) : [o.planta as string];
    if (x.coleccion === "cargas" && (o.tipo === "pilar" || o.tipo === "empuje" || ps?.length !== 1)) {
      errores.push({ fila: null, id, mensaje: `${id} va sobre un pilar o un muro, que no son de una planta: no se copia.` });
      continue;
    }
    objetos.push({ coleccion: x.coleccion, o, origen: ps![0]! });
  }
  if (errores.length) return { ok: false, errores };
  const copiados = new Set(objetos.map((x) => x.o.id));
  // Lo que ya hay en cada planta, por su sitio; y las cargas que ya hay, sin su id
  const yaHay = new Map<string, string>();
  for (const c of COPIABLES)
    if (c !== "cargas")
      for (const o of lista(m, c)) {
        const s = sitio(c, o);
        const k = `${o.planta as string}|${s}`;
        if (s && !yaHay.has(k)) yaHay.set(k, o.id);
      }
  const sinId = (o: Objeto) => canonico({ ...o, id: "" });
  const cargasYa = new Set(lista(m, "cargas").map(sinId));
  const piezaDe = (id: string) => {
    const x = idx.get(id);
    return x ? sitio(x.coleccion, lista(m, x.coleccion)[x.indice]!) : null;
  };
  const ops: Operacion[] = [];
  const avisos: string[] = [];
  const nuevos = new Set<string>();
  const usado = (x: string) => idx.has(x) || nuevos.has(x);
  for (const destino of destinos) {
    const mapa = new Map<string, string>();
    const saltados = new Set<string>();
    const saltadas = new Map<Coleccion, number>();
    const sinPieza: string[] = [];
    let cargasIguales = 0;
    for (const { coleccion, o, origen } of objetos) {
      if (origen === destino) continue;
      const s = sitio(coleccion, o);
      const igual = s && yaHay.get(`${destino}|${s}`);
      if (igual) {
        mapa.set(o.id, igual);
        saltados.add(o.id);
        saltadas.set(coleccion, (saltadas.get(coleccion) ?? 0) + 1);
        continue;
      }
      const n = idCopia(o.id, origen, destino, usado);
      nuevos.add(n);
      mapa.set(o.id, n);
    }
    // Primero lo que no es carga (las cargas apuntan a ello)
    for (const { coleccion, o, origen } of [...objetos].sort((a, b) => Number(a.coleccion === "cargas") - Number(b.coleccion === "cargas"))) {
      if (origen === destino || saltados.has(o.id)) continue;
      const c: Record<string, unknown> = { ...o, id: mapa.get(o.id)! };
      if ("planta" in c) c.planta = destino;
      let falta = false;
      for (const k of ["viga", "losa", "pano"]) {
        if (typeof c[k] !== "string") continue;
        const ref = c[k] as string;
        // La pieza que se copia, o su igual en el destino
        const otra = mapa.get(ref) ?? (copiados.has(ref) ? undefined : yaHay.get(`${destino}|${piezaDe(ref)}`));
        if (otra) c[k] = otra;
        else falta = true;
      }
      if (falta) {
        sinPieza.push(o.id);
        continue;
      }
      if (coleccion === "cargas" && cargasYa.has(sinId(c as Objeto))) {
        cargasIguales++;
        continue;
      }
      ops.push({ op: "crear", coleccion, objeto: c as Objeto });
    }
    const ya = [...saltadas].map(([c, n]) => `${n} ${n > 1 ? nombreColeccion(c).replace(/ (\S+)$/, " $1es").replace(/^(\S+)/, "$1s") : nombreColeccion(c)}`);
    const una = saltados.size === 1;
    if (ya.length) avisos.push(`${destino} ya tiene en el mismo sitio ${ya.join(", ")}: no se ${una ? "copia" : "copian"}, y sus cargas van a ${una ? "esa pieza" : "esas piezas"}.`);
    if (cargasIguales) avisos.push(`${destino} ya tiene ${cargasIguales === 1 ? "una carga igual" : `${cargasIguales} cargas iguales`}: no se ${cargasIguales === 1 ? "duplica" : "duplican"}.`);
    if (sinPieza.length) avisos.push(`${destino} no tiene en el mismo sitio la pieza de ${sinPieza.join(", ")}: no se ${sinPieza.length === 1 ? "copia" : "copian"} (copie también su pieza).`);
  }
  if (!ops.length) return { ok: false, errores: [{ fila: null, mensaje: avisos.length ? `No hay nada que copiar. ${avisos.join(" ")}` : "No hay nada que copiar." }] };
  return { ok: true, operacion: { op: "lote", operaciones: ops }, ...(avisos.length ? { avisos } : {}) };
}
