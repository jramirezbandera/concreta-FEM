/**
 * La carpeta del proyecto en el servidor local del visor (`bun run visor`), en `/proyecto/`:
 *
 * - GET y HEAD de sus ficheros, y nada fuera de ella (V1);
 * - PUT del proyecto abierto, y de ningún otro fichero (V2a, `docs/fem3d/visor.md` §6.1, V-d):
 *   · sólo desde la propia página del visor: `Host` tiene que ser 127.0.0.1 o localhost y `Origin`,
 *     el mismo servidor, para que otra web abierta en el navegador no pueda escribir;
 *   · con `If-Match` (el sello leído): si el fichero cambió en el disco desde entonces, 412 y no se
 *     escribe (conflicto, criterio 4). `x-forzar: si` es «sobrescribir» después de avisar;
 *   · el texto tiene que pasar `leerProyecto` (el esquema): si no, 422 y no se escribe;
 *   · se escribe en un temporal de la misma carpeta y se renombra, así que nunca queda medio
 *     escrito.
 */
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, normalize, sep } from "node:path";
import { leerProyecto } from "../src/agente/proyecto.ts";

/** Tamaño máximo de un proyecto que se acepta por PUT. */
export const MAX_BYTES = 64 * 1024 * 1024;

export const sello = (f: string): string => {
  const st = statSync(f);
  return `"${st.mtimeMs}-${st.size}"`;
};

function leerCuerpo(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let n = 0;
    req.on("data", (c: Buffer) => {
      n += c.length;
      if (n > MAX_BYTES) {
        resolve(null);
        req.destroy();
      } else partes.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(partes)));
    req.on("error", reject);
  });
}

const HOSTS = /^(127\.0\.0\.1|localhost)(:\d+)?$/;

/** Manejador de `/proyecto/` (la URL ya sin ese prefijo): `carpeta`, la del proyecto; `fichero`, el único que se puede escribir. */
export function manejadorCarpeta(carpeta: string, fichero: string) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const nombre = decodeURIComponent((req.url ?? "").split("?")[0]!).replace(/^\/+/, "");
    const f = normalize(join(carpeta, nombre));
    const dentro = f.startsWith(carpeta + sep);
    const responder = (codigo: number, cuerpo?: unknown, cabeceras: Record<string, string> = {}) => {
      res.writeHead(codigo, { "cache-control": "no-store", ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}), ...cabeceras });
      res.end(cuerpo === undefined ? undefined : JSON.stringify(cuerpo));
    };
    if (req.method === "PUT") {
      void (async () => {
        const host = req.headers.host ?? "";
        if (!HOSTS.test(host) || req.headers.origin !== `http://${host}`) return responder(403, { mensaje: "Sólo la página del visor puede guardar el proyecto." });
        if (nombre !== fichero || !dentro) return responder(403, { mensaje: `Sólo se puede escribir ${fichero}.` });
        const actual = existsSync(f) ? sello(f) : null;
        if (req.headers["x-forzar"] !== "si" && (req.headers["if-match"] ?? null) !== actual) return responder(412, { mensaje: "El fichero cambió en el disco desde que se leyó.", sello: actual }, actual ? { etag: actual } : {});
        const cuerpo = await leerCuerpo(req);
        if (!cuerpo) return responder(413, { mensaje: `El proyecto pasa de ${MAX_BYTES / 1024 / 1024} MB.` });
        const texto = cuerpo.toString("utf8");
        const l = leerProyecto(texto);
        if (!l.valido) return responder(422, { mensaje: "El texto no es un proyecto válido: no se guarda.", diagnosticos: l.diagnosticos });
        const tmp = join(carpeta, `.${fichero}.${process.pid}.tmp`);
        try {
          writeFileSync(tmp, texto, "utf8");
          renameSync(tmp, f);
        } catch (e) {
          if (existsSync(tmp)) unlinkSync(tmp);
          return responder(500, { mensaje: `No se pudo escribir: ${e instanceof Error ? e.message : String(e)}` });
        }
        const s = sello(f);
        responder(200, { sello: s }, { etag: s });
      })().catch((e: unknown) => responder(500, { mensaje: String(e) }));
      return;
    }
    const valido = (req.method === "GET" || req.method === "HEAD") && dentro && existsSync(f) && statSync(f).isFile();
    if (!valido) {
      // Un HEAD de lo que no existe es la vigilancia (las firmas aún sin firmar): 204, sin error en la consola
      if (req.method === "HEAD") res.setHeader("x-existe", "no");
      res.statusCode = req.method === "HEAD" ? 204 : req.method === "GET" ? 404 : 405;
      res.end();
      return;
    }
    const st = statSync(f);
    res.writeHead(200, { "content-type": f.endsWith(".json") ? "application/json" : "application/octet-stream", "cache-control": "no-store", etag: sello(f), "content-length": st.size });
    res.end(req.method === "HEAD" ? undefined : readFileSync(f));
  };
}
