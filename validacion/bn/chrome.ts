/**
 * Banco de la fase BN2 (`docs/fem3d/barras.md` §5): las barras entre dos niveles en la app compilada,
 * servida con el pórtico arriostrado de `src/pruebas/barras.ts`, en Chrome headless con un perfil
 * temporal.
 *
 *   node validacion/bn/chrome.ts                      escribe out_chrome.txt
 *   node validacion/bn/chrome.ts --capturas <carpeta> además, una PNG por paso
 *
 * - La planta P1 (las barras en discontinua con su flecha) tiene los búferes de Node (sha256).
 * - La tabla Barras tiene sus cuatro filas.
 * - El 3D sólido tiene los triángulos de Node (las barras barridas).
 * - El alzado del eje B (el tornapuntas) tiene los búferes de Node.
 * - En Resultados · Diagramas, el 3D de My tiene los triángulos de Node (con las barras), y elegir la
 *   barra T1 en la lista da su detalle de barra.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { VERSION_ESQUEMA } from "../../src/agente/proyecto.ts";
import { sha256 } from "../../src/compilador/huella.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { porticoArriostrado } from "../../src/pruebas/barras.ts";
import type { EscenaPreparada } from "../../src/visor/escena.ts";
import { Sesion } from "../../src/visor/sesion.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PUERTO = 8783;
const PUERTO_CDP = 9343;
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

// ─── 0. Lo esperado, en Node ────────────────────────────────────────────────────────────────────

const PROYECTO = JSON.stringify({ esquema: VERSION_ESQUEMA, modelo: porticoArriostrado() }, null, 1);
const wasm = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
await iniciarNucleo(wasm);
const ab = Sesion.abrir(PROYECTO, sha256(new Uint8Array(wasm)));
if (!ab.valido) throw new Error("el pórtico no abre");
const ses = ab.sesion;
if (!(await ses.calcular()).ok) throw new Error("el pórtico no calcula");
const valor = <T>(r: { valido: true; valor: T } | { valido: false }): T => {
  if (!r.valido) throw new Error("no válido");
  return r.valor;
};
const shaBuferes = (e: EscenaPreparada) => {
  const h = createHash("sha256");
  for (const c of e.capas) {
    h.update(new Uint8Array(c.segmentos.buffer, c.segmentos.byteOffset, c.segmentos.byteLength));
    h.update(new Uint8Array(c.abanicos.buffer, c.abanicos.byteOffset, c.abanicos.byteLength));
  }
  return h.digest("hex");
};
const shaDe = (a: ArrayBufferView) => createHash("sha256").update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest("hex");
const D = { tipo: "defecto" } as const;
const dMy = valor(ses.diagramas3D({ esfuerzo: "My", combinaciones: D, planta: null, piezas: "todas", escala: 1 }));
const ESPERADO = {
  planta: shaBuferes(valor(ses.escena("P1", { vista: "modelo" }))),
  alzado: shaBuferes(valor(ses.alzado({ eje: "eje-B" }))),
  triangulos: shaDe(ses.solido().triangulos),
  diagramas: (dMy.positivo.length + dMy.negativo.length) / 9,
  conBarras: dMy.piezas.filter((p) => p.tipo === "barra").length,
};

// ─── 1. La app compilada y el proyecto ──────────────────────────────────────────────────────────

execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
const datos = mkdtempSync(join(tmpdir(), "bn-proyectos-"));
mkdirSync(join(datos, "portico"), { recursive: true });
writeFileSync(join(datos, "portico", "proyecto.json"), PROYECTO);

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

const perfil = mkdtempSync(join(tmpdir(), "bn-chrome-"));
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
window.__i2 = {
  esperar: async (f, ms = 120000) => { const t0 = performance.now(); for (;;) { let v = null; try { v = await f(); } catch { v = null; } if (v) return v; if (performance.now() - t0 > ms) throw new Error("tiempo agotado: " + f); await new Promise((r) => setTimeout(r, 15)); } },
  estado: () => document.querySelector("[data-estado]")?.dataset.estado ?? null,
  boton: (texto, raiz = document) => [...raiz.querySelectorAll("button")].find((b) => b.textContent.trim() === texto || b.textContent.trim().startsWith(texto + " ") || b.getAttribute("aria-label") === texto),
  quietos: () => [...document.querySelectorAll(".lienzo[data-cargando]")].every((x) => x.dataset.cargando === "false"),
  motor: () => window.__motorVistas,
  dep: (i) => window.__motorVistas.vista(i).depuracion(),
  sup: (i) => document.querySelector('.celda[data-vista="' + i + '"] .celda-superficie'),
  ev: (i, tipo, x, y, o = {}) => { const s = __i2.sup(i); const r = s.getBoundingClientRect(); const E = tipo === "wheel" ? WheelEvent : PointerEvent; s.dispatchEvent(new E(tipo, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: o.boton ?? 0, buttons: tipo === "pointerup" ? 0 : 1 << (o.boton === 1 ? 2 : o.boton === 2 ? 1 : 0), clientX: r.left + x, clientY: r.top + y, shiftKey: !!o.mayus, ctrlKey: !!o.ctrl, deltaY: o.deltaY ?? 0 })); },
  clic: async (i, x, y, o = {}) => { __i2.ev(i, "pointerdown", x, y, o); __i2.ev(i, "pointerup", x, y, o); await new Promise((r) => setTimeout(r, 30)); },
  fotograma: () => new Promise((r) => requestAnimationFrame(() => r())),
  /** El cursor quieto sobre un punto del modelo (m) en la vista i; espera a que la vista diga qué hay debajo. */
  pasarSobre: async (i, x, y, z) => {
    const q = window.__motorVistas.vista(i).aPantalla(x, y, z);
    if (!q) return null;
    const s = __i2.sup(i); const r = s.getBoundingClientRect();
    s.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, pointerType: "mouse", buttons: 0, clientX: r.left + q[0], clientY: r.top + q[1] }));
    await new Promise((r) => setTimeout(r, 200));
    await __i2.esperar(async () => (await __i2.dep(i)).sonda, 20000).catch(() => null);
    return await __i2.dep(i);
  },
  /** Un arrastre de (x0, y0) a (x1, y1) en n pasos, uno por fotograma, midiendo los intervalos entre fotogramas. */
  arrastre: async (i, x0, y0, x1, y1, n, o = {}) => {
    const t = []; let vivo = true; const bucle = (ts) => { t.push(ts); if (vivo) requestAnimationFrame(bucle); }; requestAnimationFrame(bucle);
    __i2.ev(i, "pointerdown", x0, y0, o);
    for (let k = 1; k <= n; k++) { __i2.ev(i, "pointermove", x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, o); await __i2.fotograma(); }
    __i2.ev(i, "pointerup", x1, y1, o);
    await __i2.fotograma(); vivo = false;
    return t.slice(1).map((x, k) => x - t[k]);
  },
  tecla: (key, o = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ctrlKey: !!o.ctrl, shiftKey: !!o.mayus })),
  rueda: async (i, x, y, n, deltaY) => {
    const t = []; let vivo = true; const bucle = (ts) => { t.push(ts); if (vivo) requestAnimationFrame(bucle); }; requestAnimationFrame(bucle);
    for (let k = 0; k < n; k++) { __i2.ev(i, "wheel", x, y, { deltaY }); await __i2.fotograma(); }
    await __i2.fotograma(); vivo = false;
    return t.slice(1).map((x, k) => x - t[k]);
  },
};`;
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: AYUDAS });
await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

async function abrir(nombre: string, w: number, h: number) {
  await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const cargada = new Promise<void>((r) => (alCargar = r));
  await cdp("Page.navigate", { url: `http://127.0.0.1:${PUERTO}/?proyecto=/p/${nombre}/proyecto.json` });
  await cargada;
  await pagina(`await __i2.esperar(() => __i2.estado() === "calculado"); await __i2.esperar(() => __i2.quietos());`);
}

const quietos = () => pagina(`await new Promise((r) => setTimeout(r, 60)); await __i2.esperar(() => __i2.quietos()); await __i2.fotograma(); await __i2.fotograma();`);

async function captura(nombre: string) {
  if (!CAPTURAS) return;
  mkdirSync(CAPTURAS, { recursive: true });
  await pagina(`await new Promise((r) => setTimeout(r, 300));`);
  const r = (await cdp("Page.captureScreenshot", { format: "png" })) as { data: string };
  writeFileSync(join(CAPTURAS, `${nombre}.png`), Buffer.from(r.data, "base64"));
}

try {
  await abrir("portico", 1920, 1080);
  const elegirEn = (sel: string, v: string) => `{ const s = document.querySelector('${sel}'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, "${v}"); s.dispatchEvent(new Event("change", { bubbles: true })); }`;
  const elegir = (etiqueta: string, v: string) => elegirEn(`.celda[data-vista="0"] select[aria-label="${etiqueta}"]`, v);

  log("## La planta P1 y la tabla Barras");
  await pagina(elegir("Planta", "P1"));
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).sha256 === "${ESPERADO.planta}", 60000).catch(() => null);`);
  await quietos();
  await captura("1-planta-P1");
  const d1 = await pagina<{ sha256?: string; capas?: number }>(`return await __i2.dep(0);`);
  comprobar(d1.sha256 === ESPERADO.planta, `planta P1: ${d1.capas} capas, sha256 ${d1.sha256?.slice(0, 16)} = Node ${ESPERADO.planta.slice(0, 16)}`);
  await pagina(`if (!document.querySelector("[role=grid]")) [...document.querySelectorAll(".dock-tab")].find((b) => b.textContent.startsWith("Tablas")).click();`);
  await pagina(`const t = await __i2.esperar(() => [...document.querySelectorAll("[role=tab]")].find((b) => b.textContent.trim().startsWith("Barras"))); t.click();`);
  await pagina(`await __i2.esperar(() => document.querySelector("[role=grid]")?.getAttribute("aria-label") === "Tabla de barras", 20000).catch(() => null);`);
  await captura("2-tabla-barras");
  const filas = await pagina<string[]>(`return [...(document.querySelector("[role=grid]")?.querySelectorAll("tbody tr") ?? [])].map((tr) => tr.textContent);`);
  const ids = ["X1", "X2", "T1", "T2"].filter((id) => filas.some((t) => t.includes(id)));
  comprobar(ids.length === 4, `la tabla Barras tiene las cuatro barras: ${ids.join(", ")} (${filas.length} filas, con la nueva)`);

  log("\n## El 3D sólido y el alzado del eje B");
  await pagina(`__i2.boton("3D").click()`);
  await pagina(`await __i2.esperar(async () => (await window.__motorVistas.vista(0).huellaSolido())?.triangulos === "${ESPERADO.triangulos}", 60000).catch(() => null);`);
  await quietos();
  await captura("3-3d-solido");
  const h = await pagina<{ triangulos: string } | null>(`return await window.__motorVistas.vista(0).huellaSolido();`);
  comprobar(h?.triangulos === ESPERADO.triangulos, `los triángulos del sólido son los de Node: ${h?.triangulos.slice(0, 16)} = ${ESPERADO.triangulos.slice(0, 16)}`);
  await pagina(`__i2.boton("Alzado").click()`);
  await pagina(`await __i2.esperar(() => document.querySelector('.celda[data-vista="0"][data-tipo="alzado"] select[aria-label="Eje del alzado"]'));`);
  await pagina(elegir("Eje del alzado", "eje-B"));
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).sha256 === "${ESPERADO.alzado}", 60000).catch(() => null);`);
  await quietos();
  await captura("4-alzado-B");
  const d2 = await pagina<{ sha256?: string; capas?: number }>(`return await __i2.dep(0);`);
  comprobar(d2.sha256 === ESPERADO.alzado, `alzado del eje B: ${d2.capas} capas, sha256 ${d2.sha256?.slice(0, 16)} = Node ${ESPERADO.alzado.slice(0, 16)}`);

  log("\n## Resultados · Diagramas");
  await pagina(`__i2.boton("Resultados", document.querySelector("nav")).click()`);
  await pagina(`await __i2.esperar(() => __i2.boton("Diagramas")); __i2.boton("Diagramas").click()`);
  await quietos();
  await pagina(`__i2.boton("3D").click()`);
  // Todas las plantas (la vista se quedó en P1 al principio)
  await pagina(`await __i2.esperar(() => document.querySelector('.celda[data-vista="0"] select[aria-label="Planta"]'), 30000).catch(() => null);`);
  await pagina(elegir("Planta", ""));
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).diagramas === ${ESPERADO.diagramas}, 120000).catch(() => null);`);
  await quietos();
  await captura("5-3d-diagramas");
  const d3 = await pagina<{ diagramas: number }>(`return await __i2.dep(0);`);
  comprobar(d3.diagramas === ESPERADO.diagramas, `triángulos de los diagramas de My: ${d3.diagramas} = Node ${ESPERADO.diagramas} (${ESPERADO.conBarras} barras con diagrama)`);
  await pagina(`await __i2.esperar(() => [...document.querySelectorAll(".lista-fila")].find((b) => b.textContent.trim().startsWith("T1")), 30000).catch(() => null);`);
  await pagina(`[...document.querySelectorAll(".lista-fila")].find((b) => b.textContent.trim().startsWith("T1"))?.click();`);
  const detalle = await pagina<boolean>(`await __i2.esperar(() => document.body.textContent.includes("de P1 a P2"), 60000).catch(() => null); return document.body.textContent.includes("de P1 a P2");`);
  await captura("6-detalle-T1");
  comprobar(detalle, "elegir el tornapuntas T1 en la lista (Barras que llegan a P2) da su detalle de barra (de P1 a P2)");
} catch (e) {
  comprobar(false, `excepción: ${e instanceof Error ? e.message : String(e)}`);
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
