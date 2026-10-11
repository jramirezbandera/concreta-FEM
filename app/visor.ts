/**
 * Abre el visor sobre un proyecto, desde la línea de órdenes:
 *
 *   bun run visor <proyecto.json>            (desde la raíz del repo)
 *   bun run visor <nuevo.json> --nuevo       (crea el proyecto con la plantilla de V2a y lo abre)
 *
 * Levanta el servidor local del visor (sólo en 127.0.0.1), que sirve además la carpeta del proyecto
 * en `/proyecto/` (`servidor.ts`): se leen sus ficheros y se escribe sólo el proyecto abierto, desde
 * la página del visor (V2a, V-d). El visor lo vigila y se recarga cuando el fichero cambia (lo
 * edite el agente o el ingeniero), y usa los resultados que dejó `fem calcular` en `.fem/`.
 *
 * No se usa `/@fs/` de Vite: en Windows, una ruta de otra unidad que la del repo devuelve el
 * index.html en vez del fichero (Vite 8.3).
 */
import { existsSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createServer, type Plugin } from "vite";
import { proyectoNuevo } from "../src/editor/plantilla.ts";
import { serializar } from "../src/editor/serializar.ts";
import { manejadorCarpeta } from "./servidor.ts";

const APP = import.meta.dirname;
const args = process.argv.slice(2);
const nuevo = args.includes("--nuevo");
const arg = args.find((x) => !x.startsWith("--"));
if (!arg) {
  console.error("Uso: bun run visor <proyecto.json> [--nuevo]");
  process.exit(2);
}
const ruta = resolve(process.cwd(), arg);
if (nuevo) {
  if (existsSync(ruta)) {
    console.error(`Ya existe ${ruta}: no se sobrescribe. Ábralo sin --nuevo.`);
    process.exit(2);
  }
  if (!existsSync(dirname(ruta))) {
    console.error(`No existe la carpeta ${dirname(ruta)}.`);
    process.exit(2);
  }
  writeFileSync(ruta, serializar(proyectoNuevo(basename(ruta).replace(/\.json$/i, ""))), "utf8");
  console.log(`Creado ${ruta} con la plantilla de un proyecto nuevo.`);
}
if (!existsSync(ruta) || !statSync(ruta).isFile()) {
  console.error(`No existe el fichero ${ruta}. Para empezar uno: bun run visor ${arg} --nuevo`);
  process.exit(2);
}
const carpeta = dirname(ruta);

/** La carpeta del proyecto en /proyecto/ (`servidor.ts`). */
const servirCarpeta: Plugin = {
  name: "carpeta-del-proyecto",
  configureServer(s) {
    s.middlewares.use("/proyecto/", manejadorCarpeta(carpeta, basename(ruta)));
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
