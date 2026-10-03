// Comprueba con el dist/ real si los ficheros de Pyodide que pide el WORKER
// pasan por el Service Worker (regla runtimeCaching CacheFirst /pyodide/) y
// quedan en Cache Storage; luego recarga y mira si el servidor vuelve a recibir
// peticiones de /pyodide/. Uso: node cdp_pwa.mjs <origen>
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const ORIGEN = process.argv[2] || "http://127.0.0.1:8796";
const PORT = 9440 + Math.floor(Math.random() * 40);
const perfil = join(tmpdir(), `fem3d-plat-pwa-${PORT}`); mkdirSync(perfil, { recursive: true });
const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${perfil}`, "--no-first-run", "--window-size=1280,800", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target; for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch {} await sleep(250); }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout: 120000 })).result?.result?.value;
const informe = {};
await send("Runtime.enable"); await send("Page.enable");
const marca = (t) => { informe[t] = new Date().toISOString().slice(11, 23); console.log("== " + t, informe[t]); };
const DIRECTO = process.argv.includes("--directo");
marca("1-navegar-raiz");
await send("Page.navigate", { url: ORIGEN + (DIRECTO ? "/geotec/taludes" : "/") }); await sleep(3000);
informe.swTrasRaiz = await ev(`navigator.serviceWorker.ready.then(r => ({ activo: !!r.active, scope: r.scope, controla: !!navigator.serviceWorker.controller }))`);
await sleep(4000); // precache
informe.cachesTrasRaiz = await ev(`caches.keys()`);
marca("2-navegar-taludes");
if (!DIRECTO) await send("Page.navigate", { url: ORIGEN + "/geotec/taludes" });
await sleep(20000); // prewarm de Pyodide en idle
informe.controlaEnTaludes = await ev(`!!navigator.serviceWorker.controller`);
informe.cachesTrasTaludes = await ev(`caches.keys()`);
informe.entradasPyodide = await ev(`(async () => { const ks = await caches.keys(); const k = ks.find(x => x.startsWith('pyodide')); if (!k) return null; const c = await caches.open(k); return (await c.keys()).map(r => new URL(r.url).pathname); })()`);
marca("3-recargar-taludes");
await send("Page.reload", { ignoreCache: false }); await sleep(15000);
marca("4-fin");
const est = await ev(`navigator.storage.estimate().then(e => ({ usoMB: +(e.usage/1048576).toFixed(1), detalle: e.usageDetails }))`);
informe.estimacion = est;
writeFileSync(DIRECTO ? "pwa_pyodide_directo.json" : "pwa_pyodide.json", JSON.stringify(informe, null, 1));
console.log(JSON.stringify(informe, null, 1));
ws.close(); chrome.kill(); process.exit(0);
