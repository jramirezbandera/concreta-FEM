/**
 * Abre el visor (V1) sobre un proyecto, desde la línea de órdenes:
 *
 *   bun run visor <proyecto.json>     (desde la raíz del repo)
 *
 * Levanta el servidor local del visor (sólo en 127.0.0.1), que sirve además la carpeta del proyecto
 * en `/proyecto/` (sólo lectura, sólo esa carpeta), y escribe la URL que lo abre: el visor lo vigila y
 * se recarga cuando el fichero cambia (lo edite el agente o el ingeniero), y usa los resultados que
 * dejó `fem calcular` en `.fem/`. El visor no escribe nada.
 *
 * No se usa `/@fs/` de Vite: en Windows, una ruta de otra unidad que la del repo devuelve el
 * index.html en vez del fichero (Vite 8.3).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";
import { createServer, type Plugin } from "vite";

const APP = import.meta.dirname;
const RAIZ = join(APP, "..");
const arg = process.argv[2];
if (!arg) {
  console.error("Uso: bun run visor <proyecto.json>");
  process.exit(2);
}
const ruta = resolve(process.cwd(), arg);
if (!existsSync(ruta) || !statSync(ruta).isFile()) {
  console.error(`No existe el fichero ${ruta}.`);
  process.exit(2);
}
const carpeta = dirname(ruta);

/** La carpeta del proyecto en /proyecto/: GET y HEAD de sus ficheros, nada fuera de ella. */
const servirCarpeta: Plugin = {
  name: "carpeta-del-proyecto",
  configureServer(s) {
    s.middlewares.use("/proyecto/", (req, res) => {
      const f = normalize(join(carpeta, decodeURIComponent((req.url ?? "").split("?")[0]!)));
      const valido = (req.method === "GET" || req.method === "HEAD") && f.startsWith(carpeta + sep) && existsSync(f) && statSync(f).isFile();
      if (!valido) {
        // Un HEAD de lo que no existe es la vigilancia (las firmas aún sin firmar): 204, sin error en la consola
        if (req.method === "HEAD") res.setHeader("x-existe", "no");
        res.statusCode = req.method === "HEAD" ? 204 : req.method === "GET" ? 404 : 405;
        res.end();
        return;
      }
      const st = statSync(f);
      res.writeHead(200, { "content-type": f.endsWith(".json") ? "application/json" : "application/octet-stream", "cache-control": "no-store", etag: `"${st.mtimeMs}-${st.size}"`, "content-length": st.size });
      res.end(req.method === "HEAD" ? undefined : readFileSync(f));
    });
  },
};

const servidor = await createServer({
  configFile: join(APP, "vite.config.ts"),
  root: APP,
  plugins: [servirCarpeta],
  server: { host: "127.0.0.1", strictPort: false },
});
await servidor.listen();
const puerto = (servidor.httpServer?.address() as { port: number } | null)?.port ?? 5180;
const url = `http://127.0.0.1:${puerto}/?proyecto=${encodeURIComponent(`/proyecto/${basename(ruta)}`)}`;
console.log(`Visor de ${ruta}\n  ${url}\n(Ctrl+C para cerrarlo)`);
