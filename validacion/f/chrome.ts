/**
 * Banco de la fase F en Chrome de verdad (`docs/fem3d/franjas.md` §4, criterios 7 y 8):
 *
 *   node validacion/f/chrome.ts          escribe validacion/f/out_chrome.txt
 *
 * Como el de V2b (`validacion/v2b/chrome.ts`): compila la app, la sirve con una copia del proyecto y
 * la maneja con Chrome headless por el protocolo de depuración. En el edificio objetivo de A2:
 * - Resultados · Armado: el mapa y la tabla de las franjas de la planta salen en ≤ 2 s, sin tareas
 *   largas, con las demandas de Node bit a bit;
 * - el detalle de una franja sale en ≤ 1 s, con los valores de Node bit a bit.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { leerProyecto, type Proyecto } from "../../src/agente/proyecto.ts";
import { sha256 } from "../../src/compilador/huella.ts";
import { serializar } from "../../src/editor/serializar.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { datosArmado, datosFranja } from "../../src/visor/franjas.ts";
import { Sesion } from "../../src/visor/sesion.ts";
import { manejadorCarpeta } from "../../app/servidor.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PUERTO = 8777;
const PUERTO_CDP = 9337;
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
const datos = mkdtempSync(join(tmpdir(), "f-proyectos-"));
const escribirProyecto = (nombre: string, p: Proyecto) => {
  const d = join(datos, nombre);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "proyecto.json"), serializar(p));
  return join(d, "proyecto.json");
};
const a2 = leerProyecto(readFileSync(join(RAIZ, "validacion/a2/agente/edificio/proyecto.json"), "utf8"));
if (!a2.valido) throw new Error("el edificio de A2 no es válido");
const edificio: Proyecto = a2.proyecto;
escribirProyecto("edificio", edificio);

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

const perfil = mkdtempSync(join(tmpdir(), "f-chrome-"));
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

const AYUDAS = `
window.__largas = [];
new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__largas.push({ t: e.startTime, ms: e.duration }); }).observe({ type: "longtask", buffered: true });
window.__v2 = {
  esperar: async (f, ms = 180000) => { const t0 = performance.now(); for (;;) { const v = f(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("tiempo agotado: " + f); await new Promise((r) => setTimeout(r, 10)); } },
  estado: () => document.querySelector("[data-estado]")?.dataset.estado ?? null,
  huella: () => document.querySelector("[data-estado]")?.dataset.huella ?? null,
  boton: (texto) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(texto)),
  tabla: async (titulo) => {
    if (!document.querySelector("[role=grid]")) [...document.querySelectorAll(".dock-tab")].find((b) => b.textContent.startsWith("Tablas")).click();
    const t = await __v2.esperar(() => [...document.querySelectorAll("[role=tab]")].find((b) => new RegExp("^" + titulo + "\\\\s*\\\\d").test(b.textContent.trim())));
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
  mensaje: () => document.querySelector("[data-mensaje-hoja]")?.innerText ?? "",
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

async function captura(nombre: string): Promise<void> {
  const dir = process.env.CAPTURAS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const r = (await cdp("Page.captureScreenshot", { format: "png" })) as { data: string };
  writeFileSync(join(dir, `${nombre}.png`), Buffer.from(r.data, "base64"));
}

const largasDesde = (t: number) => pagina<{ t: number; ms: number }[]>(`return __largas.filter((x) => x.t >= ${t});`);
const ahora = () => pagina<number>(`return performance.now();`);
const largas = (l: { ms: number }[]) => `${l.filter((x) => x.ms > 50).length} (máx. ${Math.max(0, ...l.map((x) => x.ms)).toFixed(0)} ms)`;

try {
  // ─── 3. Criterios 7 y 8: Resultados · Armado en el edificio objetivo ────────────────────────
  log("Criterios 7 y 8 · Resultados · Armado en el edificio objetivo de A2 (losa maciza con vigas)");
  await abrir("edificio");
  await pagina(`__v2.boton("Resultados").click(); await __v2.esperar(() => __v2.boton("Armado"));`);
  const t4 = await ahora();
  const ms4 = await pagina<number>(`
    const t0 = performance.now();
    __v2.boton("Armado").click();
    await __v2.esperar(() => document.querySelectorAll("table[aria-label='Franjas de la planta'] tbody tr").length > 0);
    return performance.now() - t0;`);
  const l4 = await largasDesde(t4);
  comprobar(ms4 <= 2000, `el mapa y la tabla de las franjas de la planta salen en ${(ms4 / 1000).toFixed(2)} s (≤ 2 s)`);
  comprobar(l4.every((x) => x.ms <= 50), `tareas largas > 50 ms en el hilo principal: ${largas(l4)}`);
  await new Promise((r) => setTimeout(r, 500));
  await captura("edificio-armado");
  const enPagina = await pagina<{ planta: string; filas: { id: string; inferior: string; superior: string }[] }>(`
    const t = document.querySelector("table[aria-label='Franjas de la planta']");
    const planta = t.closest("section").querySelector("h2 span").textContent.replace("Franjas de ", "");
    return { planta, filas: [...t.querySelectorAll("tbody tr")].map((tr) => ({ id: tr.querySelector("td").firstChild.textContent, inferior: tr.querySelector("[data-inferior]").dataset.inferior, superior: tr.querySelector("[data-superior]").dataset.superior })) };`);
  // En Node, la misma sesión
  const wasm = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
  await iniciarNucleo(wasm);
  const sa = Sesion.abrir(serializar(edificio), sha256(new Uint8Array(wasm)));
  if (!sa.valido) throw new Error("no abre en Node");
  if (!(await sa.sesion.calcular()).ok) throw new Error("no calcula en Node");
  const dn = datosArmado(sa.sesion, enPagina.planta, { tipo: "defecto" }, "x-sup");
  if (!dn.valido) throw new Error(JSON.stringify(dn.diagnosticos));
  const iguales = dn.valor.filas.length === enPagina.filas.length && dn.valor.filas.every((f, i) => f.id === enPagina.filas[i]!.id && String(f.inferior?.v ?? 0) === enPagina.filas[i]!.inferior && String(f.superior?.v ?? 0) === enPagina.filas[i]!.superior);
  comprobar(iguales, `las demandas de las ${enPagina.filas.length} franjas X de ${enPagina.planta} son las de Node bit a bit`);
  // El detalle de una franja
  const id = enPagina.filas[Math.floor(enPagina.filas.length / 2)]!.id;
  const t5 = await ahora();
  const ms5 = await pagina<number>(`
    const t0 = performance.now();
    [...document.querySelectorAll("table[aria-label='Franjas de la planta'] tbody tr")].find((tr) => tr.querySelector("td").firstChild.textContent === ${JSON.stringify(id)}).click();
    await __v2.esperar(() => document.querySelector("table[aria-label='Estaciones de ${id}']"));
    return performance.now() - t0;`);
  comprobar(ms5 <= 1000, `el detalle de ${id} (diagrama y estaciones) sale en ${(ms5 / 1000).toFixed(2)} s (≤ 1 s)`);
  comprobar((await largasDesde(t5)).every((x) => x.ms <= 50), `el detalle, sin tareas largas > 50 ms`);
  const fn = datosFranja(sa.sesion, id, { tipo: "defecto" });
  if (!fn.valido) throw new Error(JSON.stringify(fn.diagnosticos));
  const sup = await pagina<string[]>(`return [...document.querySelectorAll("table[aria-label='Caras y apoyos de ${id}'] [data-superior]")].map((td) => td.dataset.superior);`);
  const supNode = fn.valor.estaciones.filter((x) => x.tipo !== "paso").map((x) => String(x.superior[0]));
  comprobar(sup.join() === supNode.join(), `las ${sup.length} caras y apoyos de ${id}: la demanda superior de la página es la de Node bit a bit`);
  await captura("edificio-franja");
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
