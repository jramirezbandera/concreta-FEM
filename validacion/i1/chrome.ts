/**
 * Banco de I1 en Chrome (`docs/fem3d/interfaz.md` §13.1): la app compilada, servida con los
 * proyectos de A2, en Chrome headless con un perfil temporal (sin paneles recordados).
 *
 *   node validacion/i1/chrome.ts                      escribe out_chrome.txt
 *   node validacion/i1/chrome.ts --capturas <carpeta> además, una PNG por espacio y modo
 *
 * - Criterio 1: en Modelo, con los paneles por defecto y nada elegido, la vista ocupa ≥ 70 % de la
 *   ventana en 1920×1080 y ≥ 60 % en 1366×768 (el rectángulo de `.vista` frente a la ventana).
 * - Criterio 4: el recorrido por los espacios, los modos, los paneles y la paleta en el edificio
 *   objetivo ya calculado, sin tareas largas de más de 50 ms en el hilo principal.
 */
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PUERTO = 8777;
const PUERTO_CDP = 9337;
const iCap = process.argv.indexOf("--capturas");
const CAPTURAS = iCap > 0 ? resolve(process.argv[iCap + 1] ?? "capturas") : null;
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
const datos = mkdtempSync(join(tmpdir(), "i1-proyectos-"));
for (const [nombre, ruta] of [
  ["edificio", "validacion/a2/agente/edificio/proyecto.json"],
  ["1022", "validacion/a2/agente/1022/proyecto.json"],
] as const) {
  mkdirSync(join(datos, nombre), { recursive: true });
  copyFileSync(join(RAIZ, ruta), join(datos, nombre, "proyecto.json"));
}

const TIPOS: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2", ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml" };
const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const ruta = decodeURIComponent(url.pathname);
  const fichero = ruta.startsWith("/p/") ? normalize(join(datos, ruta.slice(3))) : normalize(join(DIST, ruta === "/" ? "index.html" : ruta));
  if (!(fichero.startsWith(datos) || fichero.startsWith(DIST)) || !existsSync(fichero) || !statSync(fichero).isFile()) {
    res.writeHead(req.method === "HEAD" ? 204 : 404, req.method === "HEAD" ? { "x-existe": "no" } : {}).end();
    return;
  }
  const st = statSync(fichero);
  res.writeHead(200, { "content-type": TIPOS[extname(fichero)] ?? "application/octet-stream", "cache-control": "no-store", etag: `"${st.mtimeMs}-${st.size}"`, "content-length": st.size });
  res.end(req.method === "HEAD" ? undefined : readFileSync(fichero));
});
await new Promise<void>((r) => servidor.listen(PUERTO, "127.0.0.1", r));

// ─── 2. Chrome y su protocolo de depuración ─────────────────────────────────────────────────────

const perfil = mkdtempSync(join(tmpdir(), "i1-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${perfil}`, "--window-size=1920,1080", "about:blank"], { stdio: "ignore" });
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
window.__i1 = {
  esperar: async (f, ms = 120000) => { const t0 = performance.now(); for (;;) { const v = f(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("tiempo agotado: " + f); await new Promise((r) => setTimeout(r, 15)); } },
  estado: () => document.querySelector("[data-estado]")?.dataset.estado ?? null,
  boton: (texto, raiz = document) => [...raiz.querySelectorAll("button")].find((b) => b.textContent.trim() === texto || b.textContent.trim().startsWith(texto + " ") || b.getAttribute("aria-label") === texto),
  quietos: () => [...document.querySelectorAll(".lienzo[data-cargando]")].every((x) => x.dataset.cargando === "false"),
  area: () => { const r = document.querySelector(".vista").getBoundingClientRect(); return (r.width * r.height) / (innerWidth * innerHeight); },
};`;
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: AYUDAS });
// Tema claro, como lo verá casi siempre el usuario (el oscuro se pasa en el recorrido)
await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

async function abrir(nombre: string, w: number, h: number) {
  await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const cargada = new Promise<void>((r) => (alCargar = r));
  await cdp("Page.navigate", { url: `http://127.0.0.1:${PUERTO}/?proyecto=/p/${nombre}/proyecto.json` });
  await cargada;
  await pagina(`await __i1.esperar(() => __i1.estado() === "calculado"); await __i1.esperar(() => __i1.quietos());`);
}

const accion = (js: string, cond = "true") => pagina<number>(`const t0 = performance.now(); ${js}; await new Promise((r) => requestAnimationFrame(() => r())); await new Promise((r) => setTimeout(r, 30)); await __i1.esperar(() => __i1.quietos() && (${cond})); return performance.now() - t0;`);

async function captura(nombre: string) {
  if (!CAPTURAS) return;
  mkdirSync(CAPTURAS, { recursive: true });
  await pagina(`await new Promise((r) => setTimeout(r, 400));`);
  const r = (await cdp("Page.captureScreenshot", { format: "png" })) as { data: string };
  writeFileSync(join(CAPTURAS, `${nombre}.png`), Buffer.from(r.data, "base64"));
}

try {
  // ─── Criterio 1 ───────────────────────────────────────────────────────────────────────────────
  log("## Criterio 1: el dibujo manda (Modelo, paneles por defecto, nada elegido)");
  for (const [w, h, min] of [
    [1920, 1080, 0.7],
    [1366, 768, 0.6],
  ] as const) {
    await abrir("edificio", w, h);
    const a = await pagina<number>(`return __i1.area();`);
    comprobar(a >= min, `${w}×${h}: la vista ocupa el ${(a * 100).toFixed(1)} % de la ventana (≥ ${min * 100} %)`);
    await captura(`modelo-${w}x${h}`);
  }

  // ─── Criterio 4 y capturas ────────────────────────────────────────────────────────────────────
  log("\n## Criterio 4: espacios, modos, paneles y paleta en el edificio objetivo (1440×900)");
  await abrir("edificio", 1440, 900);
  await pagina(`window.__largas = [];`);
  const pasos: [string, number, number][] = [];
  const medir = async (que: string, js: string, cond = "true", cap?: string) => {
    const t = await pagina<number>(`return performance.now();`);
    pasos.push([que, t, await accion(js, cond)]);
    if (cap) await captura(cap);
  };
  const espacio = (n: string) => `__i1.boton("${n}", document.querySelector("nav")).click()`;
  const planta = (id: string) => `[...document.querySelectorAll('.carril [role=option]')].find((b) => b.firstChild.textContent === "${id}").click()`;
  await medir("planta N3", planta("N3"), "true", "1-modelo");
  await medir("3D", `__i1.boton("3D").click()`, `document.querySelector(".lienzo canvas")`, "2-modelo-3d");
  await medir("planta", `__i1.boton("Planta").click()`);
  await medir("elegir un pilar (navegador)", `[...document.querySelectorAll(".arbol-fila")].find((b) => b.textContent.includes("Pilares")).click(); await new Promise((r) => setTimeout(r, 50)); document.querySelector(".arbol-fila.sub").click()`, `document.querySelector(".panel.der")`, "3-modelo-elegido");
  await medir("Esc", `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await medir("tablas", `[...document.querySelectorAll(".dock-tab")].find((b) => b.textContent.startsWith("Tablas")).click()`, `document.querySelector("[role=grid]")`, "4-modelo-tablas");
  await medir("plegar el panel inferior", `__i1.boton("Plegar el panel inferior").click()`);
  await medir("espacio Cargas", espacio("Cargas"), "true", "5-cargas");
  await medir("espacio Resultados (losas)", espacio("Resultados"), "document.querySelector('[data-extremo]')", "6-resultados-losas");
  await medir("M11", `__i1.boton("M11").click()`);
  await medir("modo Diagramas", `__i1.boton("Diagramas").click()`, `document.querySelector("#estacion")`, "7-resultados-diagramas");
  await medir("modo Pilares", `__i1.boton("Pilares").click()`, `document.querySelector("tr.clic")`, "8-resultados-pilares");
  await medir("elegir un pilar (cuadro)", `document.querySelectorAll("tr.clic")[5].click()`, `document.querySelector(".panel.der svg")`, "9-resultados-pilar");
  await medir("modo Deformada", `__i1.boton("Deformada").click()`, `document.querySelector(".lienzo canvas")`, "10-resultados-deformada");
  await medir("plegar las propiedades", `__i1.boton("Plegar propiedades").click()`);
  await medir("abrir las propiedades", `__i1.boton("Abrir propiedades").click()`);
  await medir("espacio Revisión", espacio("Revisión"), `document.querySelector("article")`, "11-revision");
  await medir("paleta", `document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))`, `document.querySelector(".paleta")`);
  await medir("buscar en la paleta", `const i = document.querySelector(".paleta input"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, "P-x24"); i.dispatchEvent(new Event("input", { bubbles: true }))`, `document.querySelector(".paleta li")`, "12-paleta");
  await medir("elegir desde la paleta", `document.querySelector(".paleta input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`, `!document.querySelector(".paleta")`);
  await medir("espacio Modelo", espacio("Modelo"));
  await medir("tema oscuro", `__i1.boton("Tema oscuro").click()`, "true", "13-modelo-oscuro");
  await medir("tema claro", `__i1.boton("Tema claro").click()`);
  const largas = await pagina<{ t: number; ms: number }[]>(`return window.__largas;`);
  for (const [que, t0, ms] of pasos) log(`  ${que}: ${ms.toFixed(0)} ms${largas.some((l) => l.t >= t0 && l.t < t0 + ms + 50) ? ` · tareas largas: ${largas.filter((l) => l.t >= t0 && l.t < t0 + ms + 50).map((l) => l.ms.toFixed(0)).join(", ")} ms` : ""}`);
  const peor = Math.max(0, ...largas.map((l) => l.ms));
  comprobar(peor <= 50, `ninguna tarea larga de más de 50 ms en el recorrido (la peor, ${peor.toFixed(0)} ms; ${largas.length} en total)`);
} finally {
  writeFileSync(join(import.meta.dirname, "out_chrome.txt"), `${salida.join("\n")}\n\n${fallos ? `${fallos} FALLOS` : "TODO BIEN"}\n`);
  ws.close();
  chrome.kill();
  servidor.close();
  rmSync(datos, { recursive: true, force: true });
  setTimeout(() => rmSync(perfil, { recursive: true, force: true }), 500);
}
log(fallos ? `\n${fallos} FALLOS` : "\nTODO BIEN");
process.exit(fallos ? 1 : 0);
