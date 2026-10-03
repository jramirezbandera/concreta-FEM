// Mide la memoria privada de los procesos de Chrome (perfil propio) en cada paso:
// arrancar Pyodide+scipy, techo de 4 GiB, liberar en Python, terminate().
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const PORT = 9500 + Math.floor(Math.random() * 40);
const perfil = join(tmpdir(), `fem3d-plat-mem-${PORT}`); mkdirSync(perfil, { recursive: true });
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${perfil}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function memoria() {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*fem3d-plat-mem-${PORT}*' } | ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p) { [string]$p.PrivateMemorySize64 } }`;
  const out = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
  const v = out.split(/\s+/).filter(Boolean).map(Number);
  return { procesos: v.length, privadaMB: Math.round(v.reduce((a, b) => a + b, 0) / 1048576), mayorMB: Math.round(Math.max(...v) / 1048576) };
}
let target; for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch {} await sleep(250); }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout: 300000 })).result?.result?.value;
await send("Runtime.enable");
await send("Page.navigate", { url: "http://127.0.0.1:8794/bench/pyo.html" }); await sleep(2500);
const r = {};
r.m0_pagina = memoria();
r.arranque = await ev("window.pasoArrancar()"); await sleep(1000); r.m1_trasArranque = memoria();
r.solve300 = await ev("window.pasoSolve(300)"); await sleep(1000); r.m2_trasSolve90k = memoria();
r.techo = await ev("window.pasoTecho()"); await sleep(1500); r.m3_trasTechoYLiberarEnPython = memoria();
await ev("window.pasoTerminar()"); await sleep(3000); r.m4_trasTerminate = memoria();
writeFileSync("memoria_procesos.json", JSON.stringify(r, null, 1)); console.log(JSON.stringify(r, null, 1));
ws.close(); chrome.kill(); process.exit(0);
