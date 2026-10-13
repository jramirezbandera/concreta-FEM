/**
 * Banco de V2b en Chrome de verdad (`docs/fem3d/visor.md` §7.3, criterios 5 y 7):
 *
 *   node validacion/v2b/chrome.ts          escribe validacion/v2b/out_chrome.txt
 *
 * Como el de V2a (`validacion/v2a/chrome.ts`): compila la app, la sirve con copias de los proyectos
 * y la maneja con Chrome headless por el protocolo de depuración.
 *
 * - 5, en el edificio reticular de V2 (C4, 7 plantas, 52 125 nudos): escribir en la tabla de losas y
 *   pegar 80 filas no dan tareas largas de más de 50 ms en el hilo principal; los diagnósticos de un
 *   cambio salen en ≤ 1,5 s.
 *
 * Desde la fase F (`docs/fem3d/franjas.md`), «Proponer bandas» y Resultados · Bandas ya no están en
 * la app: su parte del banco la sustituye Resultados · Armado, en `validacion/f/chrome.ts`.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { VERSION_ESQUEMA, type Proyecto } from "../../src/agente/proyecto.ts";
import { serializar } from "../../src/editor/serializar.ts";
import { manejadorCarpeta } from "../../app/servidor.ts";
import { edificioReticular } from "../c4/modelos.ts";

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
const datos = mkdtempSync(join(tmpdir(), "v2b-proyectos-"));
const escribirProyecto = (nombre: string, p: Proyecto) => {
  const d = join(datos, nombre);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "proyecto.json"), serializar(p));
  return join(d, "proyecto.json");
};
const reticular: Proyecto = { esquema: VERSION_ESQUEMA, nombre: "Edificio reticular (V2 de C4)", modelo: edificioReticular() };
escribirProyecto("reticular", reticular);

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

const perfil = mkdtempSync(join(tmpdir(), "v2b-chrome-"));
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
  // ─── 3. Criterio 5: el edificio reticular de V2 ──────────────────────────────────────────────
  log("Criterio 5 · edificio reticular de V2 (C4: 7 plantas, 80 pilares, reticular con ábacos)");
  const t0 = Date.now();
  await abrir("reticular");
  log(`  abierto y calculado en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const h0 = await pagina<string>(`return __v2.huella();`);

  // Escribir en una celda: el intereje del reticular de la primera losa de la planta activa
  await pagina(`await __v2.tabla("Losas"); await __v2.esperar(() => __v2.hoja()?.getAttribute("aria-label") === "Tabla de losas");`);
  const col = await pagina<number>(`return [...__v2.hoja().querySelectorAll("thead th")].findIndex((th) => th.textContent.trim().startsWith("intereje")) - 1;`);
  const t1 = await ahora();
  const ms1 = await pagina<number>(`
    const t0 = performance.now();
    await __v2.escribir(0, ${col}, "0,8");
    await __v2.esperar(() => __v2.estado() === "desactualizado");
    await __v2.esperar(() => __v2.estado() !== "desactualizado" && __v2.huella() !== ${JSON.stringify(h0)});
    return performance.now() - t0;`);
  const l1 = await largasDesde(t1);
  comprobar(ms1 <= 1500, `escribir el intereje de una losa: los diagnósticos de la versión nueva salen en ${(ms1 / 1000).toFixed(2)} s (≤ 1,5 s)`);
  comprobar(l1.every((x) => x.ms <= 50), `escribir una celda: tareas largas > 50 ms en el hilo principal: ${largas(l1)}`);

  // Pegar 80 filas: el giro de los 80 pilares, por su id
  await pagina(`await __v2.tabla("Pilares"); await __v2.esperar(() => __v2.hoja()?.getAttribute("aria-label") === "Tabla de pilares");`);
  const ids = await pagina<string[]>(`return [...__v2.hoja().querySelectorAll("tbody tr[data-id]")].map((tr) => tr.dataset.id);`);
  const tsv = `id\tgiro\n${ids.map((id) => `${id}\t90`).join("\n")}\n`;
  const h1 = await pagina<string>(`return __v2.huella();`);
  const t2 = await ahora();
  const ms2 = await pagina<number>(`
    const t0 = performance.now();
    __v2.pegar(${JSON.stringify(tsv)});
    await __v2.esperar(() => __v2.estado() === "desactualizado");
    await __v2.esperar(() => __v2.estado() !== "desactualizado" && __v2.huella() !== ${JSON.stringify(h1)});
    return performance.now() - t0;`);
  const l2 = await largasDesde(t2);
  comprobar((await pagina<string>(`return __v2.mensaje();`)).startsWith(`Pegadas ${ids.length} filas`), `pegar ${ids.length} filas: entran todas`);
  comprobar(ms2 <= 1500, `pegar ${ids.length} filas: los diagnósticos salen en ${(ms2 / 1000).toFixed(2)} s (≤ 1,5 s)`);
  comprobar(l2.every((x) => x.ms <= 50), `pegar ${ids.length} filas: tareas largas > 50 ms: ${largas(l2)}`);
  await captura("reticular-pegar");

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
