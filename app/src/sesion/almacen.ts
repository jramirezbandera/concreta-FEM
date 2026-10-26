/**
 * Los proyectos del navegador (fase AL, `docs/fem3d/almacen-local.md` §3): IndexedDB, sin carpetas
 * ni permisos. Cada proyecto es el texto canónico de su `proyecto.json` (exportar lo descarga tal
 * cual), con una ficha pequeña aparte (lo que se lee cada segundo y lo que lista el inicio), sus
 * versiones anteriores (§3.3) y la caché de sus resultados por huella (§3.4, H44).
 *
 * El sello es un contador de revisión: `escribir` lo compara y lo sube en la misma transacción, así
 * que otra pestaña que escribió antes da conflicto, como el disco (nunca se pisa nada en silencio).
 */
import type { Escritura, Origen } from "./origen.ts";

export interface Ficha {
  id: string;
  nombre: string;
  /** Revisión: sube con cada escritura. */
  sello: number;
  creado: number;
  modificado: number;
  /** Caracteres del texto. */
  tamano: number;
}

export interface FichaVersion {
  n: number;
  proyecto: string;
  fecha: number;
  tamano: number;
  nombre: string;
}

interface Version extends FichaVersion {
  texto: string;
}

interface Resultados {
  huella: string;
  proyecto: string;
  cabecera: string;
  bytes: Uint8Array;
  fecha: number;
  tamano: number;
}

const BD = "concreta-fem";
/** §3.3: una versión cada 10 minutos de edición como mucho; las 30 últimas y una por día durante 90 días. */
export const VERSIONES = { cadaMs: 10 * 60_000, recientes: 30, dias: 90 };
/** §3.4: tope de la caché de resultados (se purga la más antigua). */
export const TOPE_RESULTADOS = 512 * 1024 * 1024;

let bd: Promise<IDBDatabase> | null = null;

function abrirBD(): Promise<IDBDatabase> {
  return (bd ??= new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(BD, 2);
    r.onupgradeneeded = (ev) => {
      const d = r.result;
      if (ev.oldVersion < 1) {
        d.createObjectStore("proyectos", { keyPath: "id" });
        d.createObjectStore("textos");
        d.createObjectStore("versiones", { keyPath: "n", autoIncrement: true }).createIndex("proyecto", "proyecto");
        d.createObjectStore("resultados", { keyPath: "huella" }).createIndex("proyecto", "proyecto");
      }
      // V2c-4: los ficheros de las plantillas DXF, por su sha256
      if (ev.oldVersion < 2) d.createObjectStore("dxf");
    };
    r.onsuccess = () => {
      // Otra pestaña con una versión nueva de la base: ésta se cierra y la siguiente operación la reabre
      r.result.onversionchange = () => {
        r.result.close();
        bd = null;
      };
      res(r.result);
    };
    r.onerror = () => {
      bd = null;
      rej(r.error ?? new Error("No se pudo abrir la base de datos del navegador."));
    };
  }));
}

/** Para las pruebas: olvida la conexión (después de cambiar el `indexedDB` global). */
export function olvidarBD(): void {
  void bd?.then((d) => d.close()).catch(() => {});
  bd = null;
}

const pedido = <T>(r: IDBRequest<T>) =>
  new Promise<T>((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

/** Una transacción: `f` hace los pedidos y su resultado vale cuando la transacción termina. */
async function tx<T>(almacenes: string[], modo: IDBTransactionMode, f: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  const d = await abrirBD();
  const t = d.transaction(almacenes, modo);
  const fin = new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onabort = t.onerror = () => rej(t.error ?? new Error("La transacción se abortó."));
  });
  try {
    const r = await f(t);
    await fin;
    return r;
  } catch (e) {
    try {
      t.abort();
    } catch {
      // Ya había terminado
    }
    await fin.catch(() => {});
    throw e;
  }
}

/** El nombre del proyecto, o el de reserva. */
export function nombreDe(texto: string, reserva = "Proyecto sin nombre"): string {
  try {
    const n = (JSON.parse(texto) as { nombre?: unknown }).nombre;
    return typeof n === "string" && n.trim() ? n.trim() : reserva;
  } catch {
    return reserva;
  }
}

const nuevoId = (): string => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

// ─── Proyectos ──────────────────────────────────────────────────────────────────────────────────

/** Los proyectos, del modificado más reciente al más antiguo. */
export async function listar(): Promise<Ficha[]> {
  const r = await tx(["proyectos"], "readonly", (t) => pedido(t.objectStore("proyectos").getAll() as IDBRequest<Ficha[]>));
  return r.sort((a, b) => b.modificado - a.modificado || a.nombre.localeCompare(b.nombre));
}

export async function ficha(id: string): Promise<Ficha | null> {
  return (await tx(["proyectos"], "readonly", (t) => pedido(t.objectStore("proyectos").get(id) as IDBRequest<Ficha | undefined>))) ?? null;
}

/** Crea un proyecto con `texto` (que ya pasó `leerProyecto`). */
export async function crear(texto: string, reserva?: string): Promise<Ficha> {
  const ahora = Date.now();
  const f: Ficha = { id: nuevoId(), nombre: nombreDe(texto, reserva), sello: 1, creado: ahora, modificado: ahora, tamano: texto.length };
  await tx(["proyectos", "textos"], "readwrite", (t) => {
    t.objectStore("proyectos").add(f);
    t.objectStore("textos").add(texto, f.id);
  });
  void pedirPersistencia();
  return f;
}

export async function leer(id: string): Promise<{ texto: string; ficha: Ficha } | null> {
  return tx(["proyectos", "textos"], "readonly", async (t) => {
    const [f, texto] = await Promise.all([pedido(t.objectStore("proyectos").get(id) as IDBRequest<Ficha | undefined>), pedido(t.objectStore("textos").get(id) as IDBRequest<string | undefined>)]);
    return f && texto !== undefined ? { texto, ficha: f } : null;
  });
}

/**
 * Escribe el proyecto si su sello sigue siendo `sello` (o siempre, con `forzar`). Antes de pisar el
 * texto anterior, lo guarda como versión si la última tiene más de `VERSIONES.cadaMs` (§3.3).
 */
export async function escribir(id: string, texto: string, o: { sello: number | null; forzar?: boolean; ahora?: number }): Promise<Escritura> {
  const ahora = o.ahora ?? Date.now();
  try {
    return await tx(["proyectos", "textos", "versiones"], "readwrite", async (t) => {
      const pr = t.objectStore("proyectos");
      const f = await pedido(pr.get(id) as IDBRequest<Ficha | undefined>);
      if (!f) return { ok: false, conflicto: false, mensaje: "El proyecto ya no está en este navegador (¿se borró en otra pestaña?). Expórtelo para no perderlo." } as const;
      if (!o.forzar && f.sello !== o.sello) return { ok: false, conflicto: true, mensaje: `«${f.nombre}» cambió en otra pestaña desde que se leyó.` } as const;
      const anterior = await pedido(t.objectStore("textos").get(id) as IDBRequest<string | undefined>);
      if (anterior !== undefined && anterior !== texto) {
        const vs = await pedido(t.objectStore("versiones").index("proyecto").getAll(id) as IDBRequest<Version[]>);
        const ultima = vs.reduce((m, v) => Math.max(m, v.fecha), -Infinity);
        if (ahora - ultima >= VERSIONES.cadaMs) await ponerVersion(t, vs, { proyecto: id, fecha: f.modificado, tamano: anterior.length, nombre: f.nombre, texto: anterior }, ahora);
      }
      const n: Ficha = { ...f, nombre: nombreDe(texto, f.nombre), sello: f.sello + 1, modificado: ahora, tamano: texto.length };
      pr.put(n);
      t.objectStore("textos").put(texto, id);
      return { ok: true, sello: String(n.sello) } as const;
    });
  } catch (e) {
    return { ok: false, conflicto: false, mensaje: `No se pudo guardar en el navegador: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function borrar(id: string): Promise<void> {
  await tx(["proyectos", "textos", "versiones", "resultados"], "readwrite", async (t) => {
    t.objectStore("proyectos").delete(id);
    t.objectStore("textos").delete(id);
    for (const almacen of ["versiones", "resultados"]) {
      const s = t.objectStore(almacen);
      for (const k of await pedido(s.index("proyecto").getAllKeys(id))) s.delete(k);
    }
  });
}

export async function duplicar(id: string): Promise<Ficha | null> {
  const l = await leer(id);
  if (!l) return null;
  const f = await crear(l.texto);
  // El nombre de la copia sólo va en la ficha: el texto es el mismo (y la huella también)
  const n = { ...f, nombre: `${l.ficha.nombre} (copia)` };
  await tx(["proyectos"], "readwrite", (t) => void t.objectStore("proyectos").put(n));
  return n;
}

// ─── Versiones (§3.3) ───────────────────────────────────────────────────────────────────────────

/**
 * Qué versiones se borran: se quedan las `recientes` más nuevas y, de las demás, la última de cada
 * día (hora local) de los `dias` anteriores a `ahora`.
 */
export function aPurgar(vs: readonly { n: number; fecha: number }[], ahora: number, r = VERSIONES): number[] {
  const orden = [...vs].sort((a, b) => b.fecha - a.fecha || b.n - a.n);
  const dias = new Set<string>();
  const fuera: number[] = [];
  orden.forEach((v, i) => {
    if (i < r.recientes) return;
    const d = new Date(v.fecha);
    const dia = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (ahora - v.fecha <= r.dias * 86_400_000 && !dias.has(dia)) dias.add(dia);
    else fuera.push(v.n);
  });
  return fuera;
}

async function ponerVersion(t: IDBTransaction, previas: readonly Version[], v: Omit<Version, "n">, ahora: number): Promise<void> {
  const s = t.objectStore("versiones");
  const n = await pedido(s.add(v) as IDBRequest<number>);
  for (const x of aPurgar([...previas, { ...v, n }], ahora)) s.delete(x);
}

/** Las versiones de un proyecto, de la más nueva a la más antigua (sin el texto). */
export async function versiones(id: string): Promise<FichaVersion[]> {
  const vs = await tx(["versiones"], "readonly", (t) => pedido(t.objectStore("versiones").index("proyecto").getAll(id) as IDBRequest<Version[]>));
  return vs.sort((a, b) => b.fecha - a.fecha || b.n - a.n).map(({ texto: _t, ...f }) => f);
}

export async function textoVersion(n: number): Promise<string | null> {
  return (await tx(["versiones"], "readonly", (t) => pedido(t.objectStore("versiones").get(n) as IDBRequest<Version | undefined>)))?.texto ?? null;
}

/** Guarda el texto actual como versión si no es igual al de la última (al abrir, §3.3). */
export async function versionar(id: string, ahora = Date.now()): Promise<void> {
  await tx(["proyectos", "textos", "versiones"], "readwrite", async (t) => {
    const f = await pedido(t.objectStore("proyectos").get(id) as IDBRequest<Ficha | undefined>);
    const texto = await pedido(t.objectStore("textos").get(id) as IDBRequest<string | undefined>);
    if (!f || texto === undefined) return;
    const vs = await pedido(t.objectStore("versiones").index("proyecto").getAll(id) as IDBRequest<Version[]>);
    const ultima = vs.reduce<Version | null>((m, v) => (!m || v.fecha > m.fecha || (v.fecha === m.fecha && v.n > m.n) ? v : m), null);
    if (ultima?.texto !== texto) await ponerVersion(t, vs, { proyecto: id, fecha: f.modificado, tamano: texto.length, nombre: f.nombre, texto }, ahora);
  });
}

/** La versión `n` pasa a ser el proyecto; el texto de ahora queda antes como versión. */
export async function restaurar(id: string, n: number, ahora = Date.now()): Promise<Escritura> {
  const texto = await textoVersion(n);
  if (texto === null) return { ok: false, conflicto: false, mensaje: "Esa versión ya no existe." };
  await versionar(id, ahora);
  const f = await ficha(id);
  return escribir(id, texto, { sello: f?.sello ?? null, forzar: true, ahora });
}

// ─── Caché de resultados (§3.4) ─────────────────────────────────────────────────────────────────

/** Guarda los resultados de una huella; del proyecto sólo queda ésta, y la caché no pasa del tope. */
export async function guardarResultados(proyecto: string, huella: string, cabecera: string, bytes: Uint8Array, tope = TOPE_RESULTADOS): Promise<void> {
  await tx(["resultados"], "readwrite", async (t) => {
    const s = t.objectStore("resultados");
    for (const k of await pedido(s.index("proyecto").getAllKeys(proyecto))) if (k !== huella) s.delete(k);
    s.put({ huella, proyecto, cabecera, bytes, fecha: Date.now(), tamano: bytes.byteLength + cabecera.length } satisfies Resultados);
    // Las demás, de la más antigua a la más nueva, hasta caber
    const todas = (await pedido(s.getAll() as IDBRequest<Resultados[]>)).filter((x) => x.huella !== huella).sort((a, b) => a.fecha - b.fecha);
    let total = bytes.byteLength + cabecera.length + todas.reduce((n, x) => n + x.tamano, 0);
    for (const x of todas) {
      if (total <= tope) break;
      s.delete(x.huella);
      total -= x.tamano;
    }
  });
}

export async function leerResultados(huella: string): Promise<{ cabecera: string; bytes: Uint8Array } | null> {
  const r = await tx(["resultados"], "readonly", (t) => pedido(t.objectStore("resultados").get(huella) as IDBRequest<Resultados | undefined>));
  return r ? { cabecera: r.cabecera, bytes: r.bytes } : null;
}

// ─── Persistencia ───────────────────────────────────────────────────────────────────────────────

/** Pide que el navegador no desaloje los proyectos (H44: IndexedDB es desalojable). */
export async function pedirPersistencia(): Promise<boolean | null> {
  try {
    const s = navigator.storage;
    if (!s?.persist) return null;
    return (await s.persisted()) || (await s.persist());
  } catch {
    return null;
  }
}

export async function persistente(): Promise<boolean | null> {
  try {
    return navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    return null;
  }
}

/** ¿Hay IndexedDB? (no, en algunos modos privados) */
export const hayAlmacen = (): boolean => typeof indexedDB !== "undefined";

// ─── Plantillas DXF (V2c-4) ─────────────────────────────────────────────────────────────────────

/** Guarda el fichero de una plantilla por su sha256 (lo comparten todos los proyectos del navegador). */
export async function guardarDxf(sha256: string, bytes: Uint8Array): Promise<void> {
  await tx(["dxf"], "readwrite", (t) => pedido(t.objectStore("dxf").put(bytes, sha256)));
}

/** El fichero de una plantilla, o null si este navegador no lo tiene. */
export async function leerDxfGuardado(sha256: string): Promise<Uint8Array | null> {
  const r = await tx(["dxf"], "readonly", (t) => pedido(t.objectStore("dxf").get(sha256)));
  return r instanceof Uint8Array ? r : r ? new Uint8Array(r as ArrayBuffer) : null;
}

// ─── El origen ──────────────────────────────────────────────────────────────────────────────────

/** El proyecto `id` del navegador como origen de la sesión: se guarda solo y guarda lo calculado. */
export function origenNavegador(id: string, nombre: string): Origen {
  const fichero = "proyecto.json";
  return {
    descripcion: `en este navegador / ${nombre}`,
    fichero,
    navegador: id,
    async leer(n) {
      if (n !== fichero) return null;
      const l = await leer(id);
      return l ? { texto: l.texto, sello: String(l.ficha.sello) } : null;
    },
    async sello(n) {
      if (n !== fichero) return null;
      const f = await ficha(id);
      return f ? String(f.sello) : null;
    },
    guardados: (huella) => leerResultados(huella).catch(() => null),
    escribir: (texto, o) => escribir(id, texto, { sello: o.sello === null ? null : Number(o.sello), ...(o.forzar ? { forzar: true } : {}) }),
    guardarResultados: (huella, cabecera, bytes) => guardarResultados(id, huella, cabecera, bytes),
  };
}
