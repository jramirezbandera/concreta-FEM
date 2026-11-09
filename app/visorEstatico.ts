/**
 * El visor sin Vite: la app ya construida (`app/dist`, la de GitHub Pages) servida en 127.0.0.1 con
 * la carpeta del proyecto en `/proyecto/` (`servidor.ts`, las mismas reglas de lectura y escritura
 * que `visor.ts`). Es lo que usa la herramienta `visor` del servidor MCP empaquetado para Claude
 * Desktop (`scripts/paquete-mcpb.ts`, `docs/fem3d/agente.md` §13.4), que no lleva el código fuente
 * de la app ni sus dependencias de desarrollo.
 *
 * - Sólo GET y HEAD de lo que hay dentro de `dist` (nada fuera).
 * - `sw.js` no se sirve: un service worker en 127.0.0.1:<puerto> precargaría la app de esa versión
 *   para un origen que cambia de puerto en cada arranque. La app ya funciona sin él (AL2).
 * - Escucha en un puerto libre que elige el sistema.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { basename, dirname, extname, join, normalize, sep } from "node:path";
import { manejadorCarpeta } from "./servidor.ts";

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

export interface VisorEstatico {
  url: string;
  servidor: Server;
  cerrar(): void;
}

/** Sirve `dist` con el proyecto `ruta` (que tiene que existir) y da la URL que lo abre. */
export function abrirVisorEstatico(dist: string, ruta: string, nuevo = false): Promise<VisorEstatico> {
  if (!existsSync(join(dist, "index.html"))) return Promise.reject(new Error(`No está la app construida en ${dist}.`));
  const raiz = normalize(dist);
  const carpeta = manejadorCarpeta(dirname(ruta), basename(ruta));
  const servidor = createServer((req, res) => {
    const camino = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    if (camino.startsWith("/proyecto/")) {
      req.url = (req.url ?? "").slice("/proyecto".length);
      carpeta(req, res);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    const nombre = camino === "/" ? "index.html" : camino.replace(/^\/+/, "");
    const f = normalize(join(raiz, nombre));
    if (nombre === "sw.js" || !f.startsWith(raiz + sep) || !existsSync(f) || !statSync(f).isFile()) {
      res.writeHead(404, { "cache-control": "no-store" }).end();
      return;
    }
    const cuerpo = readFileSync(f);
    res.writeHead(200, { "content-type": TIPOS[extname(f).toLowerCase()] ?? "application/octet-stream", "content-length": cuerpo.length, "cache-control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : cuerpo);
  });
  return new Promise((resolver, rechazar) => {
    servidor.once("error", rechazar);
    servidor.listen(0, "127.0.0.1", () => {
      const { port } = servidor.address() as { port: number };
      const url = `http://127.0.0.1:${port}/?proyecto=${encodeURIComponent(`/proyecto/${basename(ruta)}`)}${nuevo ? "&nuevo=1" : ""}`;
      resolver({ url, servidor, cerrar: () => servidor.close() });
    });
  });
}
