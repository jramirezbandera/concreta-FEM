/**
 * Banco de V2a en Chrome de verdad (`docs/fem3d/visor.md` §6.3, criterios 4 y 5):
 *
 *   node validacion/v2a/chrome.ts          escribe validacion/v2a/out_chrome.txt
 *
 * Como el de V1 (`validacion/v1/chrome.ts`): compila la app, la sirve con copias de los proyectos de
 * ejemplo y la maneja con Chrome headless (perfil temporal) por el protocolo de depuración. Los
 * proyectos se sirven con el manejador del servidor local (`app/servidor.ts`), así que guardar
 * escribe de verdad en la copia, con su comprobación de sello y de origen.
 *
 * - 5, en el edificio objetivo: escribir en una celda y pegar 80 filas no dan tareas largas de más
 *   de 50 ms en el hilo principal (PerformanceObserver, «longtask»); el dibujo de la versión nueva
 *   sale en ≤ 1,5 s; guardar tarda ≤ 0,5 s. Hasta el 2026-10-24 el criterio era el de los
 *   diagnósticos, que esperan a la compilación (en el edificio con vigas, ~3 s desde LV2); desde
 *   entonces el worker dibuja sin compilar y el tiempo de los diagnósticos se da como información.
 * - 4, en el navegador: un cambio en el disco con cambios sin guardar avisa y no se pisa; guardar
 *   escribe el proyecto que se ve (la misma huella) y lo canónico.
 */
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import { huellaCompilacion } from "../../src/compilador/compilar.ts";
import { resolverOpciones } from "../../src/compilador/fisico.ts";
import { serializar } from "../../src/editor/serializar.ts";
import { manejadorCarpeta } from "../../app/servidor.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PUERTO = 8776;
const PUERTO_CDP = 9336;
const salida: string[] = [];
const log = (s: string) => {
  console.log(s);
  salida.push(s);
};
let fallos = 0;
const comprobar = (ok: boolean, que: string) => {
  if (!ok) fallos++;
  log(`${ok ? "BIEN " : "FALLA"} ${que}`);
};

// ─── 1. La app compilada y los proyectos ────────────────────────────────────────────────────────

execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
const datos = mkdtempSync(join(tmpdir(), "v2a-proyectos-"));
const copiar = (nombre: string, ruta: string) => {
  const d = join(datos, nombre);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  copyFileSync(join(RAIZ, ruta), join(d, "proyecto.json"));
  return join(d, "proyecto.json");
};

const TIPOS: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2", ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml" };
const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const ruta = decodeURIComponent(url.pathname);
  // /p/<nombre>/…: la carpeta de ese proyecto, con el manejador del servidor local (lee y guarda)
  const m = /^\/p\/([^/]+)(\/.*)$/.exec(ruta);
  if (m) {
    req.url = m[2]!;
    manejadorCarpeta(join(datos, m[1]!), "proyecto.json")(req, res);
    return;
  }
  const fichero = normalize(join(DIST, ruta === "/" ? "index.html" : ruta));
  if (!fichero.startsWith(DIST) || !existsSync(fichero) || !statSync(fichero).isFile()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": TIPOS[extname(fichero)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(fichero));
});
await new Promise<void>((r) => servidor.listen(PUERTO, "127.0.0.1", r));

// ─── 2. Chrome y su protocolo de depuración ─────────────────────────────────────────────────────

const perfil = mkdtempSync(join(tmpdir(), "v2a-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${perfil}`, "--window-size=1440,900", "about:blank"], { stdio: "ignore" });
let wsUrl = "";
for (let i = 0; i < 100 && !wsUrl; i++) {
  await new Promise((r) => setTimeout(r, 100));
  try {
    const l = (await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    wsUrl = l.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "";
  } catch {
    // aún arrancando
  }
}
if (!wsUrl) throw new Error("Chrome no abrió su puerto de depuración");
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let nId = 0;
const pendientes = new Map<number, (r: { result?: unknown; error?: { message: string } }) => void>();
let alCargar: (() => void) | null = null;
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data)) as { id?: number; method?: string; result?: unknown; error?: { message: string } };
  if (m.id !== undefined) pendientes.get(m.id)?.(m);
  if (m.method === "Page.loadEventFired") alCargar?.();
};
const cdp = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<unknown>((res, rej) => {
    const id = ++nId;
    pendientes.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
async function pagina<T>(expr: string): Promise<T> {
  const r = (await cdp("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })) as { result: { value: T }; exceptionDetails?: { exception?: { description?: string }; text: string } };
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

// Ayudas de la página: tareas largas, esperas, y escribir y pegar en la hoja como el usuario
const AYUDAS = `
window.__largas = [];
new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__largas.push({ t: e.startTime, ms: e.duration }); }).observe({ type: "longtask", buffered: true });
window.__v2 = {
  esperar: async (f, ms = 120000) => { const t0 = performance.now(); for (;;) { const v = f(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("tiempo agotado: " + f); await new Promise((r) => setTimeout(r, 10)); } },
  estado: () => document.querySelector("[data-estado]")?.dataset.estado ?? null,
  huella: () => document.querySelector("[data-estado]")?.dataset.huella ?? null,
  // Todas las vistas con su escena (de la versión que tienen: las de otra se descartan, criterio 3 de V1)
  dibujado: () => { const ls = [...document.querySelectorAll(".lienzo[data-cargando]")]; return ls.length > 0 && ls.every((x) => x.dataset.cargando === "false"); },
  pie: () => document.querySelector("footer")?.innerText ?? "",
  boton: (texto) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(texto)),
  // Desde I1, las tablas están en el panel inferior, plegado si el proyecto ya tiene pilares
  tabla: async (titulo) => {
    if (!document.querySelector("[role=grid]")) [...document.querySelectorAll(".dock-tab")].find((b) => b.textContent.startsWith("Tablas")).click();
    const t = await __v2.esperar(() => [...document.querySelectorAll("[role=tab]")].find((b) => b.textContent.trim().startsWith(titulo)));
    t.click();
  },
  hoja: () => document.querySelector("[role=grid]"),
  celda: (fila, col) => __v2.hoja().querySelectorAll("tbody tr")[fila].querySelectorAll("td")[col + 1],
  escribir: async (fila, col, valor) => {
    const td = __v2.celda(fila, col);
    td.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    td.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = await __v2.esperar(() => __v2.celda(fila, col).querySelector("input"), 5000);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  },
  pegar: (texto) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", texto);
    __v2.hoja().dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  },
  estado2: () => document.querySelector("[data-mensaje-hoja]")?.innerText ?? "",
};`;
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: AYUDAS });
await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

async function abrir(nombre: string): Promise<void> {
  const cargada = new Promise<void>((r) => (alCargar = r));
  await cdp("Page.navigate", { url: `http://127.0.0.1:${PUERTO}/?proyecto=/p/${nombre}/proyecto.json` });
  await cargada;
  await pagina(`await __v2.esperar(() => __v2.estado() === "calculado");`);
}

/** Con CAPTURAS=<carpeta>, guarda una PNG de la página (para mirar la interfaz). */
async function captura(nombre: string): Promise<void> {
  const dir = process.env.CAPTURAS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const r = (await cdp("Page.captureScreenshot", { format: "png" })) as { data: string };
  writeFileSync(join(dir, `${nombre}.png`), Buffer.from(r.data, "base64"));
}

const largasDesde = (t: number) => pagina<{ t: number; ms: number }[]>(`return __largas.filter((x) => x.t >= ${t});`);
const ahora = () => pagina<number>(`return performance.now();`);
const huellaDe = (texto: string) => {
  const l = leerProyecto(texto);
  if (!l.valido) throw new Error("no es un proyecto válido");
  return { proyecto: l.proyecto, huella: huellaCompilacion(l.proyecto.modelo, resolverOpciones(l.proyecto.opciones)) };
};

try {
  // ─── 3. Criterio 5: edificio objetivo ────────────────────────────────────────────────────────
  log("Criterio 5 · edificio objetivo (7 plantas, 80 pilares)");
  const ruta = copiar("edificio", "validacion/a2/agente/edificio/proyecto.json");
  await abrir("edificio");
  const h0 = await pagina<string>(`return __v2.huella();`);
  await pagina(`await __v2.tabla("Pilares"); await __v2.esperar(() => __v2.hoja()?.getAttribute("aria-label") === "Tabla de pilares");`);
  const nPilares = await pagina<number>(`return __v2.hoja().querySelectorAll("tbody tr").length - 1;`);
  log(`  pilares en la tabla de la planta activa: ${nPilares}`);
  await new Promise((r) => setTimeout(r, 500));
  await captura("edificio-pilares");

  // Escribir en una celda (la x del primer pilar)
  const t1 = await ahora();
  const [ms1, md1] = await pagina<[number, number]>(`
    const t0 = performance.now();
    const x = __v2.celda(0, 2).textContent;
    await __v2.escribir(0, 2, String(Number(x.replace(",", ".")) + 0.05).replace(".", ","));
    await __v2.esperar(() => __v2.estado() === "desactualizado");
    await __v2.esperar(() => __v2.estado() !== "desactualizado" && __v2.huella() !== ${JSON.stringify(h0)} && __v2.dibujado());
    const dibujo = performance.now() - t0;
    await __v2.esperar(() => !["desactualizado", "compilando"].includes(__v2.estado()));
    return [dibujo, performance.now() - t0];`);
  const l1 = await largasDesde(t1);
  comprobar(ms1 <= 1500, `escribir una celda: el dibujo de la versión nueva sale en ${(ms1 / 1000).toFixed(2)} s (≤ 1,5 s)`);
  log(`  escribir una celda: los diagnósticos, tras compilar, en ${(md1 / 1000).toFixed(2)} s (información)`);
  comprobar(l1.every((x) => x.ms <= 50), `escribir una celda: tareas largas > 50 ms en el hilo principal: ${l1.filter((x) => x.ms > 50).length} (máx. ${Math.max(0, ...l1.map((x) => x.ms)).toFixed(0)} ms)`);

  // Pegar 80 filas (el giro de los 80 pilares, por su id)
  const ids = await pagina<string[]>(`return [...__v2.hoja().querySelectorAll("tbody tr[data-id]")].map((tr) => tr.dataset.id);`);
  const tsv = `id\tgiro\n${ids.map((id) => `${id}\t90`).join("\n")}\n`;
  const t2 = await ahora();
  const h1 = await pagina<string>(`return __v2.huella();`);
  const [ms2, md2] = await pagina<[number, number]>(`
    const t0 = performance.now();
    __v2.pegar(${JSON.stringify(tsv)});
    await __v2.esperar(() => __v2.estado() === "desactualizado");
    await __v2.esperar(() => __v2.estado() !== "desactualizado" && __v2.huella() !== ${JSON.stringify(h1)} && __v2.dibujado());
    const dibujo = performance.now() - t0;
    await __v2.esperar(() => !["desactualizado", "compilando"].includes(__v2.estado()));
    return [dibujo, performance.now() - t0];`);
  const l2 = await largasDesde(t2);
  const msg2 = await pagina<string>(`return __v2.estado2();`);
  comprobar(msg2.startsWith(`Pegadas ${ids.length} filas`), `pegar ${ids.length} filas: «${msg2}»`);
  comprobar(ms2 <= 1500, `pegar ${ids.length} filas: el dibujo sale en ${(ms2 / 1000).toFixed(2)} s (≤ 1,5 s)`);
  log(`  pegar ${ids.length} filas: los diagnósticos, tras compilar, en ${(md2 / 1000).toFixed(2)} s (información)`);
  comprobar(l2.every((x) => x.ms <= 50), `pegar ${ids.length} filas: tareas largas > 50 ms: ${l2.filter((x) => x.ms > 50).length} (máx. ${Math.max(0, ...l2.map((x) => x.ms)).toFixed(0)} ms)`);

  // Guardar
  const t3 = await ahora();
  const ms3 = await pagina<number>(`
    const t0 = performance.now();
    __v2.boton("Guardar").click();
    await __v2.esperar(() => __v2.pie().includes("guardado en"));
    return performance.now() - t0;`);
  const l3 = await largasDesde(t3);
  const hPagina = await pagina<string>(`return __v2.huella();`);
  const enDisco = readFileSync(ruta, "utf8");
  const d = huellaDe(enDisco);
  comprobar(ms3 <= 500, `guardar: ${ms3.toFixed(0)} ms (≤ 0,5 s)`);
  comprobar(l3.every((x) => x.ms <= 50), `guardar: tareas largas > 50 ms: ${l3.filter((x) => x.ms > 50).length} (máx. ${Math.max(0, ...l3.map((x) => x.ms)).toFixed(0)} ms)`);
  comprobar(d.huella === hPagina, `lo guardado tiene la huella que enseña la página (${hPagina.slice(0, 8)})`);
  comprobar(enDisco === serializar(d.proyecto), "lo guardado está en el formato canónico");
  comprobar(d.proyecto.modelo.pilares!.every((p) => p.giro === 90), "lo guardado lleva lo pegado (giro 90 en los 80 pilares)");

  // ─── 4. Criterio 4 en el navegador: conflicto ────────────────────────────────────────────────
  log("Criterio 4 · cambio en el disco con cambios sin guardar (ejemplo)");
  const rutaE = copiar("ejemplo", ".claude/skills/fem/ejemplo.json");
  await abrir("ejemplo");
  await pagina(`await __v2.tabla("Pilares"); await __v2.esperar(() => __v2.hoja()?.getAttribute("aria-label") === "Tabla de pilares"); await __v2.escribir(0, 2, "0,25");`);
  await pagina(`await __v2.esperar(() => __v2.boton("Guardar")?.dataset.sinGuardar === "true");`);
  const fuera = readFileSync(rutaE, "utf8").replace("Ejemplo: pórtico", "Cambiado fuera: pórtico");
  writeFileSync(rutaE, fuera);
  const t4 = Date.now();
  await pagina(`await __v2.esperar(() => document.querySelector("[role=alert]")?.innerText.includes("cambió en el disco"), 5000);`);
  comprobar(Date.now() - t4 <= 2500, `el aviso de conflicto sale en ${((Date.now() - t4) / 1000).toFixed(1)} s`);
  comprobar(readFileSync(rutaE, "utf8") === fuera, "el fichero del disco no se ha tocado");
  const x0 = await pagina<string>(`return __v2.celda(0, 2).textContent;`);
  comprobar(x0 === "0,25", `lo editado sigue en la tabla (x = ${x0})`);
  await captura("ejemplo-conflicto");
  await pagina(`__v2.boton("Guardar").click(); await new Promise((r) => setTimeout(r, 500));`);
  comprobar(readFileSync(rutaE, "utf8") === fuera, "Guardar con el conflicto abierto no pisa el fichero");
  await pagina(`__v2.boton("Sobrescribir").click(); await __v2.esperar(() => !document.querySelector("[role=alert]"), 5000);`);
  const e2 = huellaDe(readFileSync(rutaE, "utf8"));
  comprobar(e2.proyecto.modelo.pilares![0]!.x === 0.25 && !e2.proyecto.nombre?.startsWith("Cambiado"), "«Sobrescribir» escribe lo de la página");
} catch (e) {
  fallos++;
  log(`FALLA ${e instanceof Error ? e.stack : String(e)}`);
} finally {
  log(fallos ? `\n${fallos} comprobaciones fallan` : "\nTodo bien");
  writeFileSync(join(import.meta.dirname, "out_chrome.txt"), salida.join("\n") + "\n");
  ws.close();
  chrome.kill();
  servidor.close();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(perfil, { recursive: true, force: true });
  rmSync(datos, { recursive: true, force: true });
  process.exit(fallos ? 1 : 0);
}
