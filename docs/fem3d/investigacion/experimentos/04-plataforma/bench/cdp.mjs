// Conductor CDP mínimo (WebSocket global de Node 24, sin puppeteer).
// Uso: node cdp.mjs <url> <expresión-js> [salida.json] [--gpu|--swiftshader]
// Lanza Chrome headless con perfil y puerto propios, navega, evalúa la expresión
// (await) y escribe el resultado JSON. Mata Chrome al terminar.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, expr, out] = process.argv.slice(2);
const modo = process.argv.includes("--swiftshader") ? "swiftshader" : "gpu";
const PORT = 9384 + Math.floor(Math.random() * 50);
const perfil = join(tmpdir(), `fem3d-plat-chrome-${PORT}`);
mkdirSync(perfil, { recursive: true });
const flags = [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${perfil}`, "--no-first-run", "--no-default-browser-check",
  "--window-size=1280,800", "--enable-precise-memory-info", "--js-flags=--expose-gc",
  ...(modo === "gpu" ? ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
  "about:blank",
];
const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", flags, { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = l.find((t) => t.type === "page");
    if (target) break;
  } catch {}
  await sleep(250);
}
if (!target) { console.error("Chrome no respondió"); chrome.kill(); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const consola = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") consola.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Runtime.exceptionThrown") consola.push("EXC " + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable"); await send("Page.enable");
const thr = process.argv.find((a) => a.startsWith("--throttle="));
if (thr) await send("Emulation.setCPUThrottlingRate", { rate: Number(thr.split("=")[1]) });
await send("Page.navigate", { url });
await sleep(2500);
const t0 = Date.now();
const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, timeout: 600000 });
const res = { modo, throttle: thr ? Number(thr.split("=")[1]) : 1, url, ms: Date.now() - t0, value: r.result?.result?.value, error: r.result?.exceptionDetails ? JSON.stringify(r.result.exceptionDetails).slice(0, 1500) : undefined, consola };
const txt = JSON.stringify(res, null, 1);
if (out) writeFileSync(out, txt);
console.log(txt.length > 6000 ? txt.slice(0, 6000) + "\n…(truncado; ver " + out + ")" : txt);
ws.close(); chrome.kill();
process.exit(0);
