/**
 * Banco de AL2, la PWA, en Chrome de verdad (`docs/fem3d/almacen-local.md` §4 y criterio 7):
 *
 *   node validacion/al/pwa.ts          escribe validacion/al/out_pwa.txt
 *
 * Compila la app dos veces (dos versiones, como dos despliegues), sirve la primera y la maneja con
 * Chrome headless por el protocolo de depuración:
 * - el manifest es válido y la página lo enlaza; tras la primera visita, el service worker controla
 *   la página y tiene en el precache todo lo que la app necesita;
 * - sin red (el servidor corta cada conexión), la app abre, abre un ejemplo y lo calcula: el worker y
 *   el núcleo WASM salen de la caché;
 * - con la segunda versión publicada, la página avisa y sigue con la primera hasta que se pulsa
 *   «Actualizar»; entonces carga la segunda.
 */
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PUERTO = 8780;
const PUERTO_CDP = 9340;
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

// ─── 1. Dos versiones de la app ─────────────────────────────────────────────────────────────────

const versiones = mkdtempSync(join(tmpdir(), "al-pwa-"));
const compilar = (v: string) => {
  execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true, env: { ...process.env, GITHUB_SHA: v } });
  cpSync(join(APP, "dist"), join(versiones, v), { recursive: true });
  return /src="\.\/assets\/(index-[^"]+\.js)"/.exec(readFileSync(join(versiones, v, "index.html"), "utf8"))![1]!;
};
const PRINCIPAL = { v1: compilar("al-v1"), v2: compilar("al-v2") };
log(`principal de v1: ${PRINCIPAL.v1}; de v2: ${PRINCIPAL.v2}`);

let publicada: "al-v1" | "al-v2" = "al-v1";
let sinRed = false;
const TIPOS: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain" };
const servidor = createServer((req, res) => {
  // Sin red: la conexión se corta, como sin cobertura
  if (sinRed) return void req.socket.destroy();
  const dist = join(versiones, publicada);
  const ruta = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const fichero = normalize(join(dist, ruta === "/" ? "index.html" : ruta));
  if (!fichero.startsWith(dist) || !existsSync(fichero) || !statSync(fichero).isFile()) return void res.writeHead(404).end();
  // Como GitHub Pages: caché corta (el service worker manda)
  res.writeHead(200, { "content-type": TIPOS[extname(fichero)] ?? "application/octet-stream", "cache-control": "max-age=0" });
  res.end(readFileSync(fichero));
});
await new Promise<void>((r) => servidor.listen(PUERTO, "127.0.0.1", r));

// ─── 2. Chrome ──────────────────────────────────────────────────────────────────────────────────

const perfil = mkdtempSync(join(tmpdir(), "al-pwa-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${perfil}`, "--window-size=1600,1000", "about:blank"], { stdio: "ignore" });
let wsUrl = "";
for (let i = 0; i < 100 && !wsUrl; i++) {
  await new Promise((r) => setTimeout(r, 100));
  try {
    const t = (await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    wsUrl = t.find((x) => x.type === "page")?.webSocketDebuggerUrl ?? "";
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
let cargas = 0;
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data)) as { id?: number; method?: string; result?: unknown; error?: { message: string } };
  if (m.id !== undefined) pendientes.get(m.id)?.(m);
  if (m.method === "Page.loadEventFired") {
    cargas++;
    alCargar?.();
  }
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
window.__c = {
  esperar: async (f, ms = 120000) => { const t0 = performance.now(); for (;;) { const v = await f(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("tiempo agotado: " + f); await new Promise((r) => setTimeout(r, 50)); } },
  estado: () => document.querySelector("[data-estado]")?.dataset.estado ?? null,
  boton: (texto) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(texto) || b.textContent.includes(texto)),
  principal: () => (document.querySelector('script[type=module][src*="assets/index-"]')?.getAttribute("src") ?? "").replace("./assets/", ""),
};`;
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: AYUDAS });
const BASE = `http://127.0.0.1:${PUERTO}/`;
async function cargar(f: () => Promise<unknown>): Promise<void> {
  const c = new Promise<void>((r) => (alCargar = r));
  await f();
  await c;
}

try {
  // ─── 3. Primera visita: manifest y service worker ───────────────────────────────────────────
  await cargar(() => cdp("Page.navigate", { url: BASE }));
  const man = await pagina<{ enlace: string | null; m: { name: string; start_url: string; scope: string; display: string; icons: { sizes: string; purpose: string }[] } }>(`
    const enlace = document.querySelector('link[rel=manifest]')?.getAttribute("href") ?? null;
    return { enlace, m: await (await fetch(enlace)).json() };`);
  const tamanos = man.m.icons.map((i) => `${i.sizes}/${i.purpose}`);
  comprobar(man.enlace === "./manifest.webmanifest" && man.m.display === "standalone" && man.m.start_url === "./" && man.m.scope === "./" && tamanos.includes("192x192/any") && tamanos.includes("512x512/any") && tamanos.includes("512x512/maskable"), `manifest: «${man.m.name}», ${man.m.display}, start_url ${man.m.start_url}, iconos ${tamanos.join(", ")}`);
  const errores = (await cdp("Page.getAppManifest")) as { errors: { message: string }[]; url: string };
  comprobar(errores.errors.length === 0, `Chrome lee el manifest sin errores (${errores.errors.map((e) => e.message).join("; ") || "ninguno"})`);
  await pagina(`await __c.esperar(async () => (await navigator.serviceWorker.getRegistration())?.active, 60000);`);
  await cargar(() => cdp("Page.reload"));
  const control = await pagina<{ controla: boolean; entradas: string[] }>(`
    await __c.esperar(() => navigator.serviceWorker.controller, 10000);
    const entradas = [];
    for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) entradas.push(new URL(r.url).pathname);
    return { controla: !!navigator.serviceWorker.controller, entradas };`);
  const tiene = (re: RegExp) => control.entradas.some((x) => re.test(x));
  comprobar(control.controla, "tras la primera visita, el service worker controla la página");
  comprobar(tiene(/\/index\.html$/) && tiene(/nucleo_bg-.*\.wasm$/) && tiene(/worker-.*\.js$/) && tiene(/Geist-Regular\.woff2$/) && tiene(/manifest\.webmanifest$/), `en el precache: index.html, el núcleo WASM, el worker, las fuentes y el manifest (${control.entradas.length} entradas)`);
  comprobar(!tiene(/version\.json$/), "version.json no está en el precache (es lo que se pregunta)");

  // ─── 4. Sin red: abre y calcula ─────────────────────────────────────────────────────────────
  sinRed = true;
  await cargar(() => cdp("Page.navigate", { url: `${BASE}?ejemplo=ejemplo` }));
  const sinRedOk = await pagina<{ red: boolean; estado: string | null }>(`
    let red = true;
    try { await fetch("./version.json", { cache: "no-store" }); } catch { red = false; }
    try { await __c.esperar(() => __c.estado() === "calculado", 60000); } catch {}
    return { red, estado: __c.estado() };`);
  comprobar(!sinRedOk.red, "sin red: version.json no llega");
  comprobar(sinRedOk.estado === "calculado", `sin red: la app abre el ejemplo de la skill y lo calcula (estado: ${sinRedOk.estado})`);
  sinRed = false;

  // ─── 5. Una versión nueva: aviso, y sólo al pulsar ──────────────────────────────────────────
  await cargar(() => cdp("Page.navigate", { url: BASE }));
  comprobar((await pagina<string>(`return __c.principal();`)) === PRINCIPAL.v1, "antes de publicar: la página es v1");
  publicada = "al-v2";
  const cargasAntes = cargas;
  await pagina(`(await navigator.serviceWorker.getRegistration()).update();`);
  const aviso = await pagina<boolean>(`try { await __c.esperar(() => document.body.innerText.includes("Hay una nueva versión"), 30000); return true; } catch { return false; }`);
  comprobar(aviso, "con v2 publicada, la página avisa de la versión nueva");
  await new Promise((r) => setTimeout(r, 3000));
  comprobar(cargas === cargasAntes && (await pagina<string>(`return __c.principal();`)) === PRINCIPAL.v1, "y no se aplica sola: 3 s después sigue en v1, sin recargar");
  await cargar(() => pagina(`__c.boton("Actualizar").click();`));
  await pagina(`await __c.esperar(() => __c.principal());`);
  const tras = await pagina<{ principal: string; controla: boolean }>(`return { principal: __c.principal(), controla: !!navigator.serviceWorker.controller };`);
  comprobar(tras.principal === PRINCIPAL.v2 && tras.controla, `al pulsar «Actualizar», recarga con v2 (${tras.principal})`);
} catch (e) {
  comprobar(false, `excepción: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  ws.close();
  chrome.kill();
  servidor.close();
}

log(fallos ? `\n${fallos} comprobaciones fallan` : "\nTodo bien");
writeFileSync(join(import.meta.dirname, "out_pwa.txt"), salida.join("\n") + "\n");
process.exit(fallos ? 1 : 0);
