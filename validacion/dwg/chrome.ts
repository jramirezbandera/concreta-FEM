/**
 * Banco de DW4, la plantilla desde un DWG, en Chrome de verdad (`docs/fem3d/dwg.md` §5, criterios 5
 * y 6):
 *
 *   node validacion/dwg/chrome.ts          escribe validacion/dwg/out_chrome.txt
 *
 * Con el andamiaje del de V2c-4 (`validacion/v2c4/chrome.ts`): compila la app, la sirve con el
 * manejador del servidor local y la maneja con Chrome headless por el protocolo de depuración.
 *
 * - 6: en la retícula con núcleo de A2, «Plantilla DXF o DWG» con las muestras de AutoCAD de 2018, de
 *   2000 y de 2007 (DW5), leídas en el worker: la vista dibuja los segmentos que coloca Node, el fichero queda
 *   en el navegador con el sha256 de Node y la huella del proyecto no cambia. Si están (fuera de git),
 *   también el DWG de la vivienda (criterio 3 en Chrome).
 * - 5: importarlas no da tareas largas (> 50 ms) en el hilo de la página.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { manejadorCarpeta } from "../../app/servidor.ts";
import { huellaCompilacion } from "../../src/compilador/compilar.ts";
import { resolverOpciones } from "../../src/compilador/fisico.ts";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import { dibujoDxf } from "../../src/dxf/aplanar.ts";
import { colocar, nuevaPlantilla } from "../../src/editor/dibujo/plantilla.ts";
import { CARPETA_MUESTRAS, muestra } from "./muestras.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PUERTO = 8781;
const PUERTO_CDP = 9341;
const NUCLEO = "validacion/a2/agente/nucleo/proyecto.json";
const VIVIENDA = join(RAIZ, "ejemplos", "Proyectos", "modelo.dwg");
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
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// ─── 0. Las referencias, en Node ────────────────────────────────────────────────────────────────

const nucleo = leerProyecto(readFileSync(join(RAIZ, NUCLEO), "utf8"));
if (!nucleo.valido) throw new Error("la retícula con núcleo no se lee");
const HUELLA = huellaCompilacion(nucleo.proyecto.modelo, resolverOpciones(nucleo.proyecto.opciones ?? {}));

interface Caso {
  nombre: string;
  ruta: string;
  bytes: Uint8Array;
  segmentos: number;
}
const caso = (nombre: string, ruta: string, bytes: Uint8Array): Caso => {
  const d = dibujoDxf(bytes);
  const c = colocar(d, nuevaPlantilla(d, { nombre: "x", fichero: "x", sha256: "x", planta: "N1" }));
  return { nombre, ruta, bytes, segmentos: (c.lineas.length + c.curvas.length) / 4 };
};
muestra("sample_AC1032.dwg"); // comprueba que estén, con su sha256
const casos: Caso[] = [
  caso("la muestra de AutoCAD de 2018", join(CARPETA_MUESTRAS, "sample_AC1032.dwg"), muestra("sample_AC1032.dwg")),
  caso("la muestra de AutoCAD de 2000", join(CARPETA_MUESTRAS, "sample_AC1015.dwg"), muestra("sample_AC1015.dwg")),
  caso("la muestra de AutoCAD de 2007", join(CARPETA_MUESTRAS, "sample_AC1021.dwg"), muestra("sample_AC1021.dwg")),
];
if (existsSync(VIVIENDA)) casos.push(caso("el DWG de la vivienda (2018)", VIVIENDA, new Uint8Array(readFileSync(VIVIENDA))));

// ─── 1. La app compilada y el proyecto ──────────────────────────────────────────────────────────

execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
const datos = mkdtempSync(join(tmpdir(), "dw4-proyectos-"));
mkdirSync(join(datos, "nucleo"), { recursive: true });
writeFileSync(join(datos, "nucleo", "proyecto.json"), readFileSync(join(RAIZ, NUCLEO)));

const TIPOS: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2", ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml" };
const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const ruta = decodeURIComponent(url.pathname);
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

const perfil = mkdtempSync(join(tmpdir(), "dw4-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", `--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${perfil}`, "--window-size=1920,1080", "about:blank"], { stdio: "ignore" });
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

const AYUDAS = `
window.__largas = [];
new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__largas.push({ t: e.startTime, ms: e.duration }); }).observe({ type: "longtask", buffered: true });
window.__c = {
  esperar: async (f, ms = 120000) => { const t0 = performance.now(); for (;;) { const v = await f(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("tiempo agotado: " + f); await new Promise((r) => setTimeout(r, 10)); } },
  estado: () => document.querySelector("[data-estado]")?.dataset.estado ?? null,
  huella: () => document.querySelector("[data-estado]")?.dataset.huella ?? null,
  quieto: () => ["calculado", "sin-calcular", "no-compila"].includes(__c.estado()) && [...document.querySelectorAll(".lienzo[data-cargando]")].every((x) => x.dataset.cargando === "false"),
  vista: () => window.__motorVistas.vista(0),
  plantillas: () => [...document.querySelectorAll("section")].find((s) => s.querySelector("h2")?.textContent.startsWith("Plantillas DXF o DWG")),
  fotograma: () => new Promise((r) => requestAnimationFrame(() => r())),
  /** Los sha256 de los ficheros guardados en el navegador (el almacén «dxf» de IndexedDB). */
  guardados: () => new Promise((res, rej) => { const r = indexedDB.open("concreta-fem"); r.onerror = () => rej(r.error); r.onsuccess = () => { const t = r.result.transaction("dxf", "readonly").objectStore("dxf").getAllKeys(); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }; }),
};`;
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("DOM.enable");
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: AYUDAS });
await cdp("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

async function abrir(nombre: string): Promise<void> {
  const cargada = new Promise<void>((r) => (alCargar = r));
  await cdp("Page.navigate", { url: `http://127.0.0.1:${PUERTO}/?proyecto=/p/${nombre}/proyecto.json` });
  await cargada;
  await pagina(`await __c.esperar(() => __c.quieto());`);
}
const compilada = () => pagina(`await new Promise((r) => setTimeout(r, 60)); await __c.esperar(() => __c.quieto()); await __c.fotograma(); await __c.fotograma();`);

/** Elige un fichero en el campo de «Plantilla DXF o DWG», como el diálogo del navegador. */
async function elegir(ruta: string): Promise<void> {
  const doc = (await cdp("DOM.getDocument", { depth: 0 })) as { root: { nodeId: number } };
  const n = (await cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector: 'input[aria-label="Fichero DXF o DWG de la plantilla"]' })) as { nodeId: number };
  await cdp("DOM.setFileInputFiles", { nodeId: n.nodeId, files: [ruta] });
}

try {
  log("## Criterios 5 y 6: la plantilla desde un DWG, leída en el worker");
  for (const c of casos) {
    await abrir("nucleo");
    comprobar((await pagina<string>(`return __c.huella();`)) === HUELLA, `${c.nombre}: el proyecto de partida tiene la huella de Node`);
    await pagina(`window.__largas = [];`);
    const t0 = Date.now();
    await elegir(c.ruta);
    const fila = await pagina<string>(`return await __c.esperar(() => { const t = __c.plantillas()?.innerText ?? ""; return /[0-9]+ capas/.test(t) ? t : null; }, 60000);`);
    await compilada();
    const t = Date.now() - t0;
    const enVista = await pagina<number>(`return (await __c.vista().depuracion()).plantilla;`);
    comprobar(enVista === c.segmentos, `${c.nombre}: la vista dibuja los ${c.segmentos} segmentos de Node (${enVista}); su fila: «${fila.replace(/\s+/g, " ").slice(0, 90)}»`);
    const guardados = await pagina<string[]>(`return await __c.guardados();`);
    comprobar(guardados.includes(sha(c.bytes)), `${c.nombre}: el fichero queda en el navegador con el sha256 de Node (${sha(c.bytes).slice(0, 16)}…)`);
    comprobar((await pagina<string>(`return __c.huella();`)) === HUELLA, `${c.nombre}: con la plantilla, la huella del proyecto no cambia`);
    const largas = await pagina<{ ms: number }[]>(`return window.__largas;`);
    comprobar(!largas.some((x) => x.ms > 50), `${c.nombre}: leerlo (${(c.bytes.length / 1024).toFixed(0)} KB) y dibujarlo, en ${t} ms, con ${largas.length} tareas largas (> 50 ms) ${largas.length ? `(${largas.map((x) => x.ms.toFixed(0)).join(", ")} ms)` : ""}`);
  }
  if (!existsSync(VIVIENDA)) log("(el DWG de la vivienda no está: es del cliente y no está en git)");
} catch (e) {
  comprobar(false, `excepción: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  ws.close();
  chrome.kill();
  servidor.close();
  log(`\n${fallos ? `${fallos} FALLOS` : "Todo bien"}`);
  writeFileSync(join(import.meta.dirname, "out_chrome.txt"), salida.join("\n") + "\n");
  try {
    rmSync(perfil, { recursive: true, force: true });
    rmSync(datos, { recursive: true, force: true });
  } catch {
    // Chrome puede tener aún el perfil abierto
  }
  process.exit(fallos ? 1 : 0);
}
