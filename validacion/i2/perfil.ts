/**
 * Perfil de CPU de unos pasos de la app en Chrome (I2): la app compilada sin minificar
 * (`app/dist-perfil/`), el edificio objetivo y el profiler de Chrome muestreando cada 0,1 ms. Para
 * cada paso, el tiempo propio y el total (con lo que llama) de las funciones que más cuestan, y sus
 * tareas largas. Es lo que encontró las de I2 (`docs/fem3d/fase-i2.md`, I2-4).
 *
 *   node validacion/i2/perfil.ts                      escribe out_perfil.txt
 */
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PUERTO = 8779;
const PUERTO_CDP = 9339;
const salida: string[] = [];
const log = (s: string) => {
  console.log(s);
  salida.push(s);
};

// ─── 1. La app compilada y los proyectos ────────────────────────────────────────────────────────

execFileSync("bunx", ["vite", "build", "--logLevel", "warn", "--outDir", "dist-perfil", "--minify", "false"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist-perfil");
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



const perfilar = async (que: string, js: string, cond = "true") => {
  await cdp("Profiler.enable");
  await cdp("Profiler.setSamplingInterval", { interval: 100 });
  await cdp("Profiler.start");
  const ms = await accion(js, cond);
  const { profile } = (await cdp("Profiler.stop")) as { profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[]; samples: number[]; timeDeltas: number[] } };
  const largas = await pagina<{ t: number; ms: number }[]>(`const l = window.__largas; window.__largas = []; return l;`);
  const porId = new Map(profile.nodes.map((n) => [n.id, n]));
  const padre = new Map<number, number>();
  for (const n of profile.nodes) for (const c of n.children ?? []) padre.set(c, n.id);
  const propio = new Map<string, number>();
  const total = new Map<string, number>();
  profile.samples.forEach((id, i) => {
    const dt = (profile.timeDeltas[i + 1] ?? 0) / 1000;
    const n = porId.get(id)!;
    const nombre = (x: typeof n) => `${x.callFrame.functionName || "(anónima)"} ${x.callFrame.url.split("/").pop()}:${x.callFrame.lineNumber}`;
    propio.set(nombre(n), (propio.get(nombre(n)) ?? 0) + dt);
    const vistos = new Set<string>();
    for (let k: number | undefined = id; k !== undefined; k = padre.get(k)) {
      const m = nombre(porId.get(k)!);
      if (vistos.has(m)) continue;
      vistos.add(m);
      total.set(m, (total.get(m) ?? 0) + dt);
    }
  });
  log(`
## ${que}: ${ms.toFixed(0)} ms · tareas largas: ${largas.map((l) => l.ms.toFixed(0)).join(", ") || "ninguna"}`);
  log("  propio:");
  for (const [k, v] of [...propio].sort((a, b) => b[1] - a[1]).slice(0, 15)) log(`    ${v.toFixed(1)} ms  ${k}`);
  log("  total (con lo que llama):");
  for (const [k, v] of [...total].sort((a, b) => b[1] - a[1]).filter(([k]) => !/^.(root|program|idle)/.test(k)).slice(0, 30)) log(`    ${v.toFixed(1)} ms  ${k}`);
};
try {
  await abrir("edificio", 1440, 900);
  await pagina(`window.__largas = [];`);
  const espacio = (n: string) => `__i1.boton("${n}", document.querySelector("nav")).click()`;
  await accion(`[...document.querySelectorAll('.carril [role=option]')].find((b) => b.firstChild.textContent === "N3").click()`);
  await accion(espacio("Resultados"), "document.querySelector('[data-extremo]')");
  await accion(`__i1.boton("M11").click()`);
  await pagina(`window.__largas = [];`);
  const antes = await pagina<string[]>(`return window.__motorVistas.programas();`);
  await perfilar("modo Diagramas", `__i1.boton("Diagramas").click()`, `document.querySelector("#estacion")`);
  const despues = await pagina<string[]>(`return window.__motorVistas.programas();`);
  log(`
Programas nuevos al entrar en Diagramas (de ${antes.length}):`);
  for (const x of despues.filter((y) => !antes.includes(y))) log(`  ${x}`);
  await perfilar("modo Pilares", `__i1.boton("Pilares").click()`, `document.querySelector("tr.clic")`);
  await perfilar("elegir un pilar (cuadro)", `document.querySelectorAll("tr.clic")[5].click()`, `document.querySelector(".panel.der svg")`);
  await perfilar("modo Deformada", `__i1.boton("Deformada").click()`, `document.querySelector('.celda[data-tipo="3d"]')`);
} finally {
  writeFileSync(join(import.meta.dirname, "out_perfil.txt"), salida.join("\n") + "\n");
  ws.close();
  chrome.kill();
  servidor.close();
  rmSync(datos, { recursive: true, force: true });
  setTimeout(() => rmSync(perfil, { recursive: true, force: true }), 500);
}
process.exit(0);
