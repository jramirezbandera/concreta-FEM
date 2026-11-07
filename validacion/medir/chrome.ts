/**
 * Banco de la herramienta Medir de la barra de las vistas planas en Chrome de verdad:
 *
 *   node validacion/medir/chrome.ts          escribe validacion/medir/out_chrome.txt
 *   CAPTURAS=<carpeta> node …                 y las capturas de cada paso
 *
 * Con el andamiaje del de CT (`validacion/ct/chrome.ts`), en el edificio objetivo con dos ejes de
 * replanteo (A por y = 0 y 1 por x = 0):
 *
 * - planta N3 de Modelo: «Medir distancias», dos clics a unos cm de dos pilares enganchan a sus
 *   puntos fijos y la medida es la de esos puntos, bit a bit; Intro la termina. «Medir áreas», cuatro
 *   pilares y un clic en el primero cierran el contorno; el área es la de `medir` en Node. Esc borra
 *   lo medido y, sin nada, vuelve a Elegir;
 * - el alzado del eje A en Modelo (con el índice de enganches del alzado) y en Cargas (sin el editor
 *   del alzado: se engancha a lo dibujado): los dos clics enganchan a puntos que no son el cursor;
 * - mover el ratón con Medir y pintar no da tareas largas.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { leerProyecto, type Proyecto } from "../../src/agente/proyecto.ts";
import { serializar } from "../../src/editor/serializar.ts";
import { medir } from "../../src/visor/medir.ts";
import type { Vec2 } from "../../src/compilador/fisico.ts";
import { manejadorCarpeta } from "../../app/servidor.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CAPTURAS = process.env.CAPTURAS;
const PUERTO = 8791;
const PUERTO_CDP = 9351;
const EDIFICIO = "validacion/a2/agente/edificio/proyecto.json";
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

// ─── 0. El proyecto: el edificio objetivo con dos ejes ──────────────────────────────────────────

const edificio = leerProyecto(readFileSync(join(RAIZ, EDIFICIO), "utf8"));
if (!edificio.valido) throw new Error("el edificio objetivo no se lee");
const m0 = edificio.proyecto.modelo;
const proyecto: Proyecto = {
  ...edificio.proyecto,
  nombre: "Medir",
  modelo: {
    ...m0,
    ejes: [
      { id: "A", desde: [-2, 0], hasta: [56, 0] },
      { id: "1", desde: [0, -2], hasta: [0, 37] },
    ],
  },
};

// ─── 1. La app compilada y el proyecto ──────────────────────────────────────────────────────────

if (!process.env.SIN_COMPILAR) execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
const datos = mkdtempSync(join(tmpdir(), "medir-proyectos-"));
mkdirSync(join(datos, "medir"), { recursive: true });
writeFileSync(join(datos, "medir", "proyecto.json"), serializar(proyecto));

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

const perfil = mkdtempSync(join(tmpdir(), "medir-chrome-"));
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
  quieto: () => ["calculado", "sin-calcular", "no-compila"].includes(__c.estado()) && [...document.querySelectorAll(".lienzo[data-cargando]")].every((x) => x.dataset.cargando === "false"),
  vista: () => window.__motorVistas.vista(0),
  sup: () => document.querySelector('.celda[data-vista="0"] .celda-superficie'),
  barra: (etiqueta) => document.querySelector('.celda[data-vista="0"] .vista-barra [aria-label="' + etiqueta + '"]'),
  pulsado: (etiqueta) => __c.barra(etiqueta)?.getAttribute("aria-pressed") === "true",
  ev: (tipo, p, o = {}) => {
    const s = __c.sup(); const r = s.getBoundingClientRect(); const [x, y] = __c.vista().aPx(p);
    s.dispatchEvent(new PointerEvent(tipo, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: tipo === "pointerup" || tipo === "pointermove" ? 0 : 1, clientX: r.left + x, clientY: r.top + y, shiftKey: !!o.mayus }));
  },
  clic: (p) => { __c.ev("pointermove", p); __c.ev("pointerdown", p); __c.ev("pointerup", p); },
  tecla: (key) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
  pie: () => document.querySelector("[data-cursor]")?.textContent ?? "",
  elegir: (etiqueta, valor) => { const s = document.querySelector('.celda[data-vista="0"] select[aria-label="' + etiqueta + '"]'); s.value = valor; s.dispatchEvent(new Event("change", { bubbles: true })); },
  fotograma: () => new Promise((r) => requestAnimationFrame(() => r())),
};`;
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: AYUDAS });
await cdp("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

async function captura(nombre: string): Promise<void> {
  if (!CAPTURAS) return;
  mkdirSync(CAPTURAS, { recursive: true });
  await pagina(`await new Promise((r) => setTimeout(r, 300));`);
  const r = (await cdp("Page.captureScreenshot", { format: "png" })) as { data: string };
  writeFileSync(join(CAPTURAS, `${nombre}.png`), Buffer.from(r.data, "base64"));
}
const quieta = () => pagina(`await new Promise((r) => setTimeout(r, 60)); await __c.esperar(() => __c.quieto()); await __c.fotograma(); await __c.fotograma();`);
const medicion = () => pagina<{ modo: string | null; puntos: Vec2[]; terminada: boolean }>(`const m = __c.vista().medicion; return { modo: m.modo, puntos: m.puntos.map((p) => [p[0], p[1]]), terminada: m.terminada };`);
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

try {
  const cargada = new Promise<void>((r) => (alCargar = r));
  await cdp("Page.navigate", { url: `http://127.0.0.1:${PUERTO}/?proyecto=/p/medir/proyecto.json` });
  await cargada;
  await pagina(`await __c.esperar(() => __c.quieto());`);
  await pagina(`__c.elegir("Planta", "N3");`);
  await quieta();

  // ─── Distancia en planta ─────────────────────────────────────────────────────────────────────
  log("## Planta N3 de Modelo, con los enganches del modelo");
  await pagina(`__c.barra("Medir distancias").click(); await __c.fotograma();`);
  comprobar(await pagina<boolean>(`return __c.pulsado("Medir distancias") && !__c.pulsado("Elegir");`), "«Medir distancias» queda pulsado en la barra de la vista");
  await pagina(`__c.clic([0.06, 0.04]); await __c.fotograma(); __c.ev("pointermove", [6.04, 4.97]); await __c.fotograma();`);
  const pieVivo = await pagina<string>(`return __c.pie();`);
  comprobar(/7,810 m/.test(pieVivo) && /Δx 6,000 · Δy 5,000/.test(pieVivo), `con el cursor en el segundo pilar, la barra de estado da la distancia viva: «${pieVivo}»`);
  await pagina(`__c.clic([6.04, 4.97]); __c.tecla("Enter"); await __c.fotograma();`);
  const d = await medicion();
  comprobar(igual(d.puntos, [[0, 0], [6, 5]]) && d.terminada, `dos clics a unos cm de P-x0-y0 y P-x6-y5 enganchan a sus puntos fijos, e Intro termina: ${JSON.stringify(d)}`);
  await captura("1-distancia");

  // ─── Área en planta ──────────────────────────────────────────────────────────────────────────
  await pagina(`__c.barra("Medir áreas").click(); await __c.fotograma();`);
  const vacia = await medicion();
  comprobar(vacia.modo === "area" && !vacia.puntos.length, "«Medir áreas» empieza sin puntos");
  await pagina(`for (const p of [[0.05, -0.04], [12.03, 0.05], [11.96, 10.04], [-0.05, 9.97]]) { __c.clic(p); await __c.fotograma(); } __c.clic([0.04, 0.03]); await __c.fotograma();`);
  const a = await medicion();
  const ra = medir("area", a.puntos);
  comprobar(igual(a.puntos, [[0, 0], [12, 0], [12, 10], [0, 10]]) && a.terminada && ra.area === 120 && ra.total === 44, `cuatro pilares y un clic en el primero cierran el contorno: ${JSON.stringify(a.puntos)}, área ${ra.area} m², perímetro ${ra.total} m`);
  await pagina(`__c.ev("pointermove", [20, 20]); await __c.fotograma();`);
  await captura("2-area");

  // Retroceso, Esc
  await pagina(`__c.clic([24.04, 0.02]); __c.clic([30.03, 0.01]); __c.clic([30.02, 4.98]); __c.tecla("Backspace"); await __c.fotograma();`);
  const ret = await medicion();
  comprobar(igual(ret.puntos, [[24, 0], [30, 0]]) && !ret.terminada, `el clic tras una medida terminada empieza otra, y Retroceso quita su último punto: ${JSON.stringify(ret.puntos)}`);
  await pagina(`__c.tecla("Escape"); await __c.fotograma();`);
  const esc1 = await medicion();
  const sigue = await pagina<boolean>(`return __c.pulsado("Medir áreas");`);
  await pagina(`__c.tecla("Escape"); await __c.fotograma();`);
  const fuera = await pagina<boolean>(`return __c.pulsado("Elegir") && !__c.pulsado("Medir áreas");`);
  comprobar(!esc1.puntos.length && sigue && fuera, `Esc borra lo medido y sigue en Medir (${sigue}); el segundo vuelve a Elegir (${fuera})`);

  // ─── Tareas largas al mover el ratón ─────────────────────────────────────────────────────────
  await pagina(`__c.barra("Medir distancias").click(); __c.clic([0, 0]); await __c.fotograma(); window.__largas = [];`);
  const tiempos = await pagina<number[]>(`
    const ms = [];
    for (let k = 0; k < 60; k++) { const t0 = performance.now(); __c.ev("pointermove", [k * 0.9 + 0.13, (k % 8) * 4.7 + 0.21]); await __c.fotograma(); ms.push(performance.now() - t0); }
    return ms;`);
  const largas = await pagina<{ ms: number }[]>(`return window.__largas;`);
  tiempos.sort((x, y) => x - y);
  comprobar(!largas.length, `60 movimientos del ratón con Medir por el edificio objetivo: sin tareas largas (${largas.length}); fotograma p95 ${tiempos[Math.floor(0.95 * tiempos.length)]!.toFixed(1)} ms`);
  await pagina(`__c.tecla("Escape"); __c.tecla("Escape"); await __c.fotograma();`);

  // ─── Alzado en Modelo ────────────────────────────────────────────────────────────────────────
  log("\n## Alzado del eje A");
  await pagina(`__c.elegir("Tipo de vista", "alzado");`);
  await quieta();
  await pagina(`await __c.esperar(() => __c.barra("Medir distancias"));`);
  await pagina(`__c.barra("Medir distancias").click(); await __c.fotograma();`);
  const caja = await pagina<number[]>(`const v = __c.vista(); const r = v.rect; const a = v.aModelo(0, r.h); const b = v.aModelo(r.w, 0); return [a[0], a[1], b[0], b[1]];`);
  log(`  la vista ve u ${caja[0]!.toFixed(2)}…${caja[2]!.toFixed(2)}, z ${caja[1]!.toFixed(2)}…${caja[3]!.toFixed(2)}`);
  // Dos clics a unos cm de la cabeza de dos pilares de la fila A en N3 (cota +9,00)
  const alz = async (espacio: string) => {
    await pagina(`__c.clic([0.07, 9.04]); await __c.fotograma(); __c.clic([6.06, 8.97]); __c.tecla("Enter"); await __c.fotograma();`);
    const m = await medicion();
    const crudos: Vec2[] = [
      [0.07, 9.04],
      [6.06, 8.97],
    ];
    const enganchados = m.puntos.length === 2 && m.puntos.every((p, k) => p[0] !== crudos[k]![0] || p[1] !== crudos[k]![1]);
    comprobar(m.terminada && enganchados, `${espacio}: los dos clics enganchan (${JSON.stringify(m.puntos)}), ${m.puntos.length === 2 ? medir("distancia", m.puntos).total.toFixed(4) : "—"} m`);
  };
  await alz("Modelo");
  await captura("3-alzado-modelo");
  await pagina(`__c.tecla("Escape"); __c.tecla("Escape"); await __c.fotograma();`);

  // ─── Alzado en Cargas: sin el editor del alzado, a lo dibujado ───────────────────────────────
  await pagina(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cargas").click();`);
  await quieta();
  await pagina(`await __c.esperar(() => __c.barra("Medir distancias"));`);
  await pagina(`__c.barra("Medir distancias").click(); await __c.fotograma();`);
  await alz("Cargas");
  await captura("4-alzado-cargas");
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
