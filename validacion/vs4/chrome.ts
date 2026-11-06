/**
 * VS4: la memoria de la app en Chrome con el sismo del programa (`docs/fem3d/viento-sismo.md` §13):
 *
 *   node validacion/vs4/chrome.ts            escribe validacion/vs4/out_memoria.txt
 *   node validacion/vs4/chrome.ts --rapido   el edificio de 3 plantas (para probar el banco)
 *
 * VS3 midió en Bun que, tras calcular, la memoria de JavaScript del edificio de losas de 7 plantas
 * pasaba de 886 a 1 709 MiB con el sismo, y sólo 270 eran los vectores de los modos. Aquí se mide
 * donde cuenta, en Chrome: el edificio objetivo con y sin `acciones` (viento y sismo), abierto en la
 * app compilada (`vite build`) y servido en local, manejado por el protocolo de depuración.
 *
 * Lo que se mide, tras recoger la basura:
 * - el montón de JavaScript del worker de sesión (donde viven los resultados y las consultas), el de
 *   la página y el de los demás workers (`Runtime.getHeapUsage` en cada destino);
 * - la memoria privada de los procesos de este Chrome (el renderer entre ellos), por el sistema.
 *
 * En cuatro pasos: tras calcular; en Resultados · Modal (la forma de un modo); en Losas con la
 * envolvente de M11 (los campos de los 25 casos base); en Armado (las franjas). El tiempo de cada
 * paso, sólo como información.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { VERSION_ESQUEMA } from "../../src/agente/proyecto.ts";
import type { AccionCaso, ModeloFisico } from "../../src/compilador/fisico.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PUERTO = 8781;
const PUERTO_CDP = 9341;
const rapido = process.argv.includes("--rapido");
const MiB = (b: number) => (b / 2 ** 20).toFixed(0);
const salida: string[] = [];
const log = (s: string) => {
  console.log(s);
  salida.push(s);
};

// ─── 1. Los proyectos y la app ──────────────────────────────────────────────────────────────────

const ACCIONES: Record<string, AccionCaso> = {
  G: { tipo: "G" },
  Q: { tipo: "Q", psi: "uso-A" },
  Vx: { tipo: "W", psi: "viento", direccion: "X", signo: 1, familia: "viento" },
  Vy: { tipo: "W", psi: "viento", direccion: "Y", signo: 1, familia: "viento" },
};
const base = rapido ? edificioObjetivoLosas(3, 3, 2) : edificioObjetivoLosas(7);
const sin: ModeloFisico = { ...base, casos: base.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })) };
const con: ModeloFisico = { ...sin, acciones: { viento: { zona: "A", aspereza: "IV" }, sismo: { ab: 0.16, K: 1.0, terreno: "III", mu: 2, sistema: "porticos-ha" } } };
const datos = mkdtempSync(join(tmpdir(), "vs4-proyectos-"));
for (const [nombre, m] of [
  ["sin", sin],
  ["con", con],
] as const) {
  mkdirSync(join(datos, nombre), { recursive: true });
  writeFileSync(join(datos, nombre, "proyecto.json"), JSON.stringify({ esquema: VERSION_ESQUEMA, nombre: `Edificio de losas (${nombre} sismo)`, modelo: m }));
}
execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
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

// ─── 2. Chrome y su protocolo de depuración (con los workers como destinos) ─────────────────────

const perfil = mkdtempSync(join(tmpdir(), "vs4-chrome-"));
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
/** Los workers que se han unido (protocolo plano): su sessionId y su URL. */
const sesiones = new Map<string, { url: string; tipo: string }>();
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data)) as { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string } };
  if (m.id !== undefined) pendientes.get(m.id)?.(m);
  if (m.method === "Page.loadEventFired") alCargar?.();
  if (m.method === "Target.attachedToTarget") {
    const p = m.params as { sessionId: string; targetInfo: { url: string; type: string } };
    sesiones.set(p.sessionId, { url: p.targetInfo.url, tipo: p.targetInfo.type });
    // Un worker recién unido arranca en pausa: que siga
    void cdp("Runtime.runIfWaitingForDebugger", {}, p.sessionId).catch(() => undefined);
  }
  if (m.method === "Target.detachedFromTarget") sesiones.delete((m.params as { sessionId: string }).sessionId);
};
const cdp = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
  new Promise<unknown>((res, rej) => {
    const id = ++nId;
    pendientes.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
async function pagina<T>(expr: string): Promise<T> {
  const r = (await cdp("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })) as { result: { value: T }; exceptionDetails?: { exception?: { description?: string }; text: string } };
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
const AYUDAS = `
window.__v1 = {
  esperar: async (f, ms = 300000) => { const t0 = performance.now(); for (;;) { const v = f(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("tiempo agotado: " + f); await new Promise((r) => setTimeout(r, 15)); } },
  estado: () => document.querySelector("[data-estado]")?.dataset.estado ?? null,
  boton: (texto, raiz = document) => [...raiz.querySelectorAll("button")].find((b) => b.textContent.trim() === texto || b.textContent.trim().startsWith(texto + " ") || b.getAttribute("aria-label") === texto),
  quietos: () => { const ls = [...document.querySelectorAll(".lienzo[data-cargando]")]; return ls.length > 0 && ls.every((x) => x.dataset.cargando === "false"); },
};`;
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: AYUDAS });
await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
// Los workers (de sesión, del peso propio, de la plantilla DXF) como destinos propios, en el protocolo plano
await cdp("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

/** La memoria de JavaScript de la página y de cada worker (MiB), tras recoger la basura en cada uno: el montón de V8 más los búferes de los arrays tipados. */
async function montones(): Promise<{ pagina: number; worker: number; otros: number; detalle: string }> {
  const uso = async (sessionId?: string) => {
    await cdp("HeapProfiler.collectGarbage", {}, sessionId).catch(() => undefined);
    // `usedSize` es el montón de V8; los Float64Array de los resultados viven fuera, en `backingStorageSize` (Chrome ≥ 133)
    const h = (await cdp("Runtime.getHeapUsage", {}, sessionId)) as { usedSize: number; totalSize: number; backingStorageSize?: number; embedderHeapUsedSize?: number };
    return h.usedSize + (h.backingStorageSize ?? 0);
  };
  const p = await uso();
  let worker = 0;
  let otros = 0;
  const partes: string[] = [`página ${MiB(p)}`];
  for (const [id, s] of sesiones) {
    if (s.tipo !== "worker") continue;
    let u = 0;
    try {
      u = await uso(id);
    } catch {
      continue;
    }
    const nombre = s.url.split("/").pop()?.split("?")[0] ?? s.url;
    partes.push(`${nombre} ${MiB(u)}`);
    if (/worker/.test(nombre) && !/peso|dxf|plantilla/i.test(nombre)) worker += u;
    else otros += u;
  }
  return { pagina: p, worker, otros, detalle: partes.join(", ") };
}

/** La memoria privada (MiB) de los procesos de este Chrome, por el sistema: el total y el mayor (el renderer de la pestaña). */
function procesos(): { total: number; mayor: number; n: number } {
  const salidaPs = execFileSync("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${perfil.replaceAll("'", "''")}*' } | ForEach-Object { $_.PrivatePageCount }`], { encoding: "utf8" });
  const bytes = salidaPs
    .split(/\r?\n/)
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x > 0);
  return { total: bytes.reduce((a, b) => a + b, 0), mayor: Math.max(0, ...bytes), n: bytes.length };
}

async function abrir(nombre: string): Promise<number> {
  const cargada = new Promise<void>((r) => (alCargar = r));
  await cdp("Page.navigate", { url: `http://127.0.0.1:${PUERTO}/?proyecto=/p/${nombre}/proyecto.json` });
  await cargada;
  return pagina<number>(`await __v1.esperar(() => __v1.estado() === "calculado" && __v1.quietos()); return performance.now();`);
}
const accion = (js: string, cond = "true") => pagina<number>(`const t0 = performance.now(); ${js}; await new Promise((r) => requestAnimationFrame(() => r())); await __v1.esperar(() => __v1.quietos() && (${cond})); return performance.now() - t0;`);

const filas: string[] = [];
try {
  for (const nombre of ["sin", "con"] as const) {
    log(`## Edificio ${nombre} sismo`);
    const tCalculo = await abrir(nombre);
    const medir = async (paso: string, ms: number) => {
      const h = await montones();
      const pr = procesos();
      const fila = `${nombre} | ${paso} | ${(ms / 1000).toFixed(1)} | ${MiB(h.worker)} | ${MiB(h.pagina)} | ${MiB(h.otros)} | ${MiB(pr.mayor)} | ${MiB(pr.total)} (${pr.n})`;
      filas.push(fila);
      log(`${fila}   [${h.detalle}]`);
    };
    await medir("abrir y calcular", tCalculo);
    // Resultados · Modal (con sismo, la forma del modo 1 animada; sin él, la pantalla lo dice)
    const irA = (modo: string) => `__v1.boton("Resultados", document.querySelector("nav")).click(); await __v1.esperar(() => __v1.boton("${modo}", document.querySelector("[role=toolbar]"))); __v1.boton("${modo}", document.querySelector("[role=toolbar]")).click()`;
    await medir("Resultados · Modal", await accion(irA("Modal"), `document.querySelector('.celda[data-tipo="3d"]')`));
    // Losas: la envolvente de M11 en la planta activa (los campos SPR de los 25 casos base)
    await medir("Resultados · Losas, M11", await accion(`${irA("Losas")}; await __v1.esperar(() => __v1.boton("M11")); __v1.boton("M11").click()`));
    // Armado: las franjas de la planta activa
    await medir("Resultados · Armado", await accion(irA("Armado")));
    // Pilares: las envolventes de los tramos de la planta
    await medir("Resultados · Pilares", await accion(irA("Pilares")));
  }
} finally {
  ws.close();
  const cerrado = new Promise<void>((r) => chrome.once("exit", () => r()));
  chrome.kill();
  servidor.close();
  await Promise.race([cerrado, new Promise((r) => setTimeout(r, 5000))]);
  for (const d of [perfil, datos])
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // el perfil de Chrome puede tardar en soltarse
    }
}
const cabecera = [
  `# VS4: la memoria de la app en Chrome con el sismo del programa (${new Date().toISOString().slice(0, 10)}; ${rapido ? "edificio de losas de 3 plantas" : "edificio objetivo de losas, 7 plantas"})`,
  "",
  "Tras recoger la basura en cada destino. «Worker»: el montón de JavaScript del worker de sesión (los resultados y las consultas); «página», el del hilo principal; «otros», los demás workers. «Proceso mayor», la memoria privada del renderer de la pestaña, y «todos», la de los procesos de este Chrome (cuántos). El tiempo de cada paso, desde la navegación (abrir y calcular) o desde el clic, sólo como información.",
  "",
  "Edificio | Paso | s | Worker MiB | Página MiB | Otros MiB | Proceso mayor MiB | Todos MiB",
  "---|---|---|---|---|---|---|---",
  ...filas,
  "",
];
writeFileSync(join(import.meta.dirname, "out_memoria.txt"), [...cabecera, "", ...salida].join("\n") + "\n");
