/**
 * De dónde lee el visor un proyecto (V1, §3.1): el `proyecto.json`, los resultados que guardó la CLI
 * en `.fem/<huella>/` y el fichero de firmas `<proyecto>.revision.json`. Desde V2a (V-d) se escribe
 * también el proyecto, y sólo él: nunca `.fem/` ni las firmas.
 *
 * Al escribir se compara el sello del fichero con el que tenía al leerlo: si cambió (el agente, o el
 * ingeniero a mano), no se escribe y se dice (conflicto, criterio 4 de V2a); «sobrescribir» es
 * escribir con `forzar` después de avisar.
 *
 * - Carpeta: la File System Access API (Chrome y Edge), elegida por el usuario.
 * - URL: un fichero que sirve el servidor local del visor (`?proyecto=<ruta>`), para abrirlo desde la
 *   línea de órdenes y para el banco de Chrome, que no puede elegir una carpeta.
 * - Navegador (fase AL): IndexedDB, en `almacen.ts`.
 *
 * Los dos se vigilan con un sello (fecha y tamaño, o ETag) que se mira cada segundo.
 */

/** Lo mínimo de la File System Access API que se usa (no está en lib.dom de TypeScript 5.9). */
interface Entrada {
  kind: "file" | "directory";
  name: string;
}
export interface Directorio extends Entrada {
  kind: "directory";
  getFileHandle(nombre: string, o?: { create?: boolean }): Promise<Fichero>;
  queryPermission?(o: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  getDirectoryHandle(nombre: string): Promise<Directorio>;
  values(): AsyncIterable<Entrada>;
}
interface Fichero extends Entrada {
  kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(d: string | Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (o?: { mode?: "read" | "readwrite"; id?: string }) => Promise<Directorio>;
  }
}

export interface Leido {
  texto: string;
  sello: string;
}

/** Resultado de escribir el proyecto. */
export type Escritura =
  | { ok: true; sello: string }
  /** El fichero cambió en el disco desde que se leyó: no se escribió. */
  | { ok: false; conflicto: true; mensaje: string }
  | { ok: false; conflicto: false; mensaje: string };

export interface Origen {
  /** Lo que se enseña al pie («carpeta Edificio / proyecto.json»). */
  descripcion: string;
  /** Nombre del fichero del proyecto. */
  fichero: string;
  leer(nombre: string): Promise<Leido | null>;
  /** Sello de un fichero sin leerlo entero (null si no existe). */
  sello(nombre: string): Promise<string | null>;
  /** Los resultados guardados de una huella, si la CLI los dejó. */
  guardados(huella: string): Promise<{ cabecera: string; bytes: Uint8Array } | null>;
  /** Escribe el proyecto si su sello sigue siendo `sello` (o siempre, con `forzar`). */
  escribir(texto: string, o: { sello: string | null; forzar?: boolean }): Promise<Escritura>;
  /**
   * AL: el id de un proyecto del navegador (`almacen.ts`). Se guarda solo (AL-b), tiene versiones y
   * su sello cambia por otra pestaña, no por el disco.
   */
  navegador?: string;
  /** AL: guarda lo calculado para no recalcular al reabrir (sólo el navegador; la CLI escribe `.fem/`). */
  guardarResultados?(huella: string, cabecera: string, bytes: Uint8Array): Promise<void>;
  /** V2c-4: los bytes de un fichero junto al proyecto (una plantilla DXF), o null si no está. */
  leerBytes?(nombre: string): Promise<Uint8Array | null>;
  /** V2c-4: deja un fichero junto al proyecto si aún no está (la carpeta); true si quedó. */
  dejarFichero?(nombre: string, bytes: Uint8Array): Promise<boolean>;
}

/** Fichero de firmas de un proyecto: `<nombre>.revision.json`, junto a él (como `rutaFirmas` de la CLI). */
export const nombreFirmas = (proyecto: string): string => `${proyecto.replace(/\.json$/i, "")}.revision.json`;

// ─── Carpeta ────────────────────────────────────────────────────────────────────────────────────

export const hayCarpetas = (): boolean => typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

/** Elegir una carpeta: para leer (abrir; la escritura se pide al guardar) o para escribir (proyecto nuevo). */
export async function elegirCarpeta(modo: "read" | "readwrite" = "read"): Promise<Directorio | null> {
  try {
    return (await window.showDirectoryPicker!({ mode: modo, id: "concreta-fem" })) ?? null;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

const ESQUEMA = "concreta-fem/proyecto@1";

/** Ficheros de proyecto de una carpeta: los .json con el esquema del proyecto («proyecto.json» primero). */
export async function proyectosEn(dir: Directorio): Promise<string[]> {
  const r: string[] = [];
  for await (const e of dir.values()) {
    const n = e.name.toLowerCase();
    if (e.kind !== "file" || !n.endsWith(".json") || n.endsWith(".revision.json")) continue;
    const f = await (await dir.getFileHandle(e.name)).getFile();
    if (f.size < 64 * 1024 * 1024 && (await f.text()).includes(ESQUEMA)) r.push(e.name);
  }
  return r.sort((a, b) => (a === "proyecto.json" ? -1 : b === "proyecto.json" ? 1 : a.localeCompare(b)));
}

export function origenCarpeta(dir: Directorio, fichero: string): Origen {
  const archivo = async (nombre: string) => {
    try {
      return await (await dir.getFileHandle(nombre)).getFile();
    } catch {
      return null;
    }
  };
  return {
    descripcion: `carpeta ${dir.name} / ${fichero}`,
    fichero,
    async leer(nombre) {
      const f = await archivo(nombre);
      return f ? { texto: await f.text(), sello: `${f.lastModified}/${f.size}` } : null;
    },
    async sello(nombre) {
      const f = await archivo(nombre);
      return f ? `${f.lastModified}/${f.size}` : null;
    },
    async escribir(texto, o) {
      try {
        // El permiso de escritura se pide al guardar por primera vez (con el clic del usuario)
        const permiso = (await dir.queryPermission?.({ mode: "readwrite" })) ?? "granted";
        if (permiso !== "granted" && (await dir.requestPermission?.({ mode: "readwrite" })) !== "granted") return { ok: false, conflicto: false, mensaje: `No hay permiso para escribir en la carpeta ${dir.name}.` };
        const antes = await archivo(fichero);
        const actual = antes ? `${antes.lastModified}/${antes.size}` : null;
        if (!o.forzar && actual !== o.sello) return { ok: false, conflicto: true, mensaje: `${fichero} cambió en el disco desde que se leyó.` };
        const h = await dir.getFileHandle(fichero, { create: true });
        // createWritable escribe en un temporal y lo cambia por el fichero al cerrar: nunca queda medio escrito
        const w = await h.createWritable();
        try {
          await w.write(texto);
          await w.close();
        } catch (e) {
          await w.abort().catch(() => {});
          throw e;
        }
        const f = await h.getFile();
        return { ok: true, sello: `${f.lastModified}/${f.size}` };
      } catch (e) {
        return { ok: false, conflicto: false, mensaje: `No se pudo escribir ${fichero}: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
    async leerBytes(nombre) {
      const f = await archivo(nombre);
      return f ? new Uint8Array(await f.arrayBuffer()) : null;
    },
    async dejarFichero(nombre, bytes) {
      try {
        if (await archivo(nombre)) return true;
        const permiso = (await dir.queryPermission?.({ mode: "readwrite" })) ?? "granted";
        if (permiso !== "granted" && (await dir.requestPermission?.({ mode: "readwrite" })) !== "granted") return false;
        const w = await (await dir.getFileHandle(nombre, { create: true })).createWritable();
        try {
          await w.write(bytes);
          await w.close();
        } catch (e) {
          await w.abort().catch(() => {});
          throw e;
        }
        return true;
      } catch {
        return false;
      }
    },
    async guardados(huella) {
      try {
        const d = await (await dir.getDirectoryHandle(".fem")).getDirectoryHandle(huella);
        const cab = await (await d.getFileHandle("resultados.json")).getFile();
        const bin = await (await d.getFileHandle("resultados.bin")).getFile();
        return { cabecera: await cab.text(), bytes: new Uint8Array(await bin.arrayBuffer()) };
      } catch {
        return null;
      }
    },
  };
}

// ─── URL del servidor local ─────────────────────────────────────────────────────────────────────

/** `url`: la del proyecto («/@fs/D:/…/proyecto.json» en el servidor de Vite). */
export function origenUrl(url: string): Origen {
  const corte = url.lastIndexOf("/");
  const base = url.slice(0, corte + 1);
  const fichero = decodeURIComponent(url.slice(corte + 1));
  const pedir = async (nombre: string, metodo: "GET" | "HEAD") => {
    try {
      const r = await fetch(base + nombre.split("/").map(encodeURIComponent).join("/"), { method: metodo, cache: "no-store" });
      // El servidor del visor contesta a un HEAD de un fichero que no existe con 204 y «x-existe: no»
      // (un 404 por segundo, al vigilar las firmas, llenaría la consola de errores)
      return r.ok && r.headers.get("x-existe") !== "no" ? r : null;
    } catch {
      return null;
    }
  };
  const selloDe = (r: Response) => r.headers.get("etag") ?? `${r.headers.get("last-modified") ?? ""}/${r.headers.get("content-length") ?? ""}`;
  return {
    descripcion: `servidor local / ${decodeURIComponent(url).replace(/^\/(@fs|proyecto)\//, "")}`,
    fichero,
    async leer(nombre) {
      const r = await pedir(nombre, "GET");
      return r ? { texto: await r.text(), sello: selloDe(r) } : null;
    },
    async sello(nombre) {
      const r = await pedir(nombre, "HEAD");
      return r ? selloDe(r) : null;
    },
    async leerBytes(nombre) {
      const r = await pedir(nombre, "GET");
      return r ? new Uint8Array(await r.arrayBuffer()) : null;
    },
    async guardados(huella) {
      const cab = await pedir(`.fem/${huella}/resultados.json`, "GET");
      const bin = cab && (await pedir(`.fem/${huella}/resultados.bin`, "GET"));
      return cab && bin ? { cabecera: await cab.text(), bytes: new Uint8Array(await bin.arrayBuffer()) } : null;
    },
    async escribir(texto, o) {
      try {
        const cab: Record<string, string> = { "content-type": "application/json" };
        if (o.forzar) cab["x-forzar"] = "si";
        else if (o.sello) cab["if-match"] = o.sello;
        const r = await fetch(base + encodeURIComponent(fichero), { method: "PUT", body: texto, headers: cab, cache: "no-store" });
        const j = (await r.json().catch(() => ({}))) as { mensaje?: string; sello?: string };
        if (r.ok && j.sello) return { ok: true, sello: r.headers.get("etag") ?? j.sello };
        if (r.status === 412) return { ok: false, conflicto: true, mensaje: j.mensaje ?? `${fichero} cambió en el disco desde que se leyó.` };
        return { ok: false, conflicto: false, mensaje: j.mensaje ?? `El servidor no guardó ${fichero} (${r.status}).` };
      } catch (e) {
        return { ok: false, conflicto: false, mensaje: `No se pudo hablar con el servidor del visor: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  };
}

/** Guardar sin carpeta (un proyecto arrastrado, o en Firefox y Safari): se descarga el fichero. */
export function descargar(texto: string, nombre: string): void {
  const url = URL.createObjectURL(new Blob([texto], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
