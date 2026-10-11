/**
 * De dónde lee el visor un proyecto (V1, §3.1): el `proyecto.json`, los resultados que guardó la CLI
 * en `.fem/<huella>/` y el fichero de firmas `<proyecto>.revision.json`. Sólo se lee: el visor no
 * escribe nada.
 *
 * - Carpeta: la File System Access API (Chrome y Edge), elegida por el usuario.
 * - URL: un fichero que sirve el servidor local del visor (`?proyecto=<ruta>`), para abrirlo desde la
 *   línea de órdenes y para el banco de Chrome, que no puede elegir una carpeta.
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
  getFileHandle(nombre: string): Promise<Fichero>;
  getDirectoryHandle(nombre: string): Promise<Directorio>;
  values(): AsyncIterable<Entrada>;
}
interface Fichero extends Entrada {
  kind: "file";
  getFile(): Promise<File>;
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
}

/** Fichero de firmas de un proyecto: `<nombre>.revision.json`, junto a él (como `rutaFirmas` de la CLI). */
export const nombreFirmas = (proyecto: string): string => `${proyecto.replace(/\.json$/i, "")}.revision.json`;

// ─── Carpeta ────────────────────────────────────────────────────────────────────────────────────

export const hayCarpetas = (): boolean => typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

export async function elegirCarpeta(): Promise<Directorio | null> {
  try {
    return (await window.showDirectoryPicker!({ mode: "read", id: "concreta-fem" })) ?? null;
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
    async guardados(huella) {
      const cab = await pedir(`.fem/${huella}/resultados.json`, "GET");
      const bin = cab && (await pedir(`.fem/${huella}/resultados.bin`, "GET"));
      return cab && bin ? { cabecera: await cab.text(), bytes: new Uint8Array(await bin.arrayBuffer()) } : null;
    },
  };
}
