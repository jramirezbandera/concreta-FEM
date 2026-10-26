/**
 * Banco de las cargas en el alzado y en el 3D (tras I4, `docs/fem3d/interfaz.md` §17): la app
 * compilada, servida con el edificio objetivo, en Chrome headless con un perfil temporal.
 *
 *   node validacion/cargas/chrome.ts                      escribe out_chrome.txt
 *   node validacion/cargas/chrome.ts --capturas <carpeta> además, una PNG por paso
 *
 * - En Cargas, el 3D pinta las flechas y los bloques de `cargas3D` de Node (los mismos segmentos), en
 *   sólido y con cada caso; la escala de la barra los cambia.
 * - El alzado del eje 3 con las cargas de G tiene los búferes de Node (sha256).
 * - Orbitar el 3D con las cargas a 60 fps.
 * - Elegir una carga con un clic y por ventana; ocultarla (Ctrl+H); el rango de plantas deja las de
 *   Node con ese rango (lo de los pilares, por la planta de la cabeza de cada tramo).
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { sha256 } from "../../src/compilador/huella.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import type { EscenaPreparada } from "../../src/visor/escena.ts";
import { Sesion } from "../../src/visor/sesion.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PUERTO = 8781;
const PUERTO_CDP = 9341;
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

const EDIFICIO = "validacion/a2/agente/edificio/proyecto.json";
const wasm = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
await iniciarNucleo(wasm);
const ab = Sesion.abrir(readFileSync(join(RAIZ, EDIFICIO), "utf8"), sha256(new Uint8Array(wasm)));
if (!ab.valido) throw new Error("el edificio no abre");
const ses = ab.sesion;
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
const shaSeg = (x: Float32Array) => createHash("sha256").update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength)).digest("hex");
const g3 = valor(ses.cargas3D("G"));
const TAB = g3.objetos.findIndex((o) => o.id === "G-tab-N7");
if (TAB < 0) throw new Error("no está G-tab-N7");
const RANGO = { desde: "N3", hasta: "N4" };
const ESPERADO = {
  G: g3.segmentos.length / 6,
  sinTab: [...g3.objetoSegmento].filter((k) => k !== TAB).length,
  rango: [...g3.plantaSegmento].filter((k) => k === g3.plantas.indexOf(RANGO.desde) || k === g3.plantas.indexOf(RANGO.hasta)).length,
  tab: g3.objetos[TAB]!.punto,
  Vx: valor(ses.cargas3D("Vx")).segmentos.length / 6,
  G2: shaSeg(valor(ses.cargas3D("G", 2)).segmentos),
  alzado: shaBuferes(valor(ses.alzado({ eje: "3" }, undefined, undefined, { caso: "G" }))),
};

// ─── 1. La app compilada y el proyecto ──────────────────────────────────────────────────────────

execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
const datos = mkdtempSync(join(tmpdir(), "cargas-proyectos-"));
mkdirSync(join(datos, "edificio"), { recursive: true });
copyFileSync(join(RAIZ, EDIFICIO), join(datos, "edificio", "proyecto.json"));

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

const perfil = mkdtempSync(join(tmpdir(), "cargas-chrome-"));
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

const mediana = (x: number[]) => {
  const s = [...x].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};

try {
  await abrir("edificio", 1920, 1080);
  const elegirEn = (sel: string, v: string) => `{ const s = document.querySelector('${sel}'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, "${v}"); s.dispatchEvent(new Event("change", { bubbles: true })); }`;
  const elegir = (etiqueta: string, v: string) => elegirEn(`.celda[data-vista="0"] select[aria-label="${etiqueta}"]`, v);

  log("## Cargas de G en el 3D (sólido)");
  await pagina(`__i2.boton("Cargas", document.querySelector("nav")).click()`);
  await quietos();
  await pagina(`__i2.boton("3D").click()`);
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).cargas > 0, 120000);`);
  await quietos();
  await captura("1-3d-G-solido");
  const d1 = await pagina<{ cargas: number; pintado: string }>(`return await __i2.dep(0);`);
  comprobar(d1.cargas === ESPERADO.G, `segmentos de las cargas de G: ${d1.cargas} = Node ${ESPERADO.G}`);
  comprobar(d1.pintado === "solido", `el 3D sigue en sólido con las cargas: ${d1.pintado}`);
  const t = await pagina<number[]>(`const s = __i2.sup(0).getBoundingClientRect(); return await __i2.arrastre(0, s.width * 0.4, s.height * 0.5, s.width * 0.7, s.height * 0.42, 120, { boton: 1, mayus: true });`);
  comprobar(mediana(t) <= 17, `orbitar con las cargas: mediana ${mediana(t).toFixed(1)} ms entre fotogramas (${t.length})`);
  await captura("2-3d-G-orbitado");
  await pagina(elegir("Planta", "N4"));
  await pagina(`__i2.motor().vista(0).encuadrar()`);
  await quietos();
  await captura("2b-3d-G-N4");
  await pagina(elegir("Planta", ""));

  log("\n## Elegir, ocultar y filtrar las cargas");
  await pagina(`__i2.motor().vista(0).vistaEstandar("so"); __i2.motor().vista(0).encuadrar();`);
  await quietos();
  const q = await pagina<[number, number] | null>(`return __i2.motor().vista(0).aPantalla(${ESPERADO.tab.join(", ")});`);
  if (q) await pagina(`await __i2.clic(0, ${q[0]}, ${q[1]});`);
  await quietos();
  const e1 = await pagina<{ elegidos: string[] }>(`return await __i2.dep(0);`);
  comprobar(e1.elegidos.length === 1 && e1.elegidos[0] === "G-tab-N7", `un clic sobre la tabiquería de N7 la elige: ${e1.elegidos.join(", ") || "nada"}`);
  await captura("2c-3d-G-elegida");
  await pagina(`__i2.tecla("h", { ctrl: true });`);
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).cargasVisibles === ${ESPERADO.sinTab}, 30000).catch(() => null);`);
  const e2 = await pagina<{ cargasVisibles: number }>(`return await __i2.dep(0);`);
  comprobar(e2.cargasVisibles === ESPERADO.sinTab, `ocultarla (Ctrl+H) quita sus segmentos: ${e2.cargasVisibles} = Node ${ESPERADO.sinTab}`);
  await pagina(`__i2.tecla("H", { mayus: true });`);
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).cargasVisibles === ${ESPERADO.G}, 30000).catch(() => null);`);
  // De derecha a izquierda: «toca» (mostrarlo todo reencuadra: el punto, otra vez)
  await quietos();
  const q2 = await pagina<[number, number] | null>(`return __i2.motor().vista(0).aPantalla(${ESPERADO.tab.join(", ")});`);
  if (q2) await pagina(`const [x0, y0, x1, y1] = [${q2[0] + 6}, ${q2[1] + 6}, ${q2[0] - 6}, ${q2[1] - 6}]; __i2.ev(0, "pointerdown", x0, y0); for (let k = 1; k <= 8; k++) { __i2.ev(0, "pointermove", x0 + (x1 - x0) * k / 8, y0 + (y1 - y0) * k / 8); await __i2.fotograma(); } __i2.ev(0, "pointerup", x1, y1); await new Promise((r) => setTimeout(r, 200));`);
  await quietos();
  const e3 = await pagina<{ elegidos: string[] }>(`return await __i2.dep(0);`);
  comprobar(e3.elegidos.includes("G-tab-N7"), `una ventana que la toca la elige: ${e3.elegidos.join(", ") || "nada"}`);
  await pagina(`__i2.tecla("Escape");`);
  await pagina(`__i2.boton("Opciones de la vista").click();`);
  await pagina(`await __i2.esperar(() => document.querySelector('.opciones-vista'));`);
  await pagina(elegir("Planta de abajo", RANGO.desde));
  await pagina(elegir("Planta de arriba", RANGO.hasta));
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).cargasVisibles === ${ESPERADO.rango}, 30000).catch(() => null);`);
  await quietos();
  await captura("2d-3d-G-N3-N4");
  const e4 = await pagina<{ cargasVisibles: number }>(`return await __i2.dep(0);`);
  comprobar(e4.cargasVisibles === ESPERADO.rango, `con las plantas de ${RANGO.desde} a ${RANGO.hasta}, las de Node: ${e4.cargasVisibles} = ${ESPERADO.rango}`);
  await pagina(`__i2.boton("Mostrar todo").click(); __i2.boton("Opciones de la vista").click();`);
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).cargasVisibles === ${ESPERADO.G}, 30000).catch(() => null);`);

  log("\n## Otro caso y otra escala");
  await pagina(elegirEn('select[aria-label="Caso activo"]', "Vx"));
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).cargas === ${ESPERADO.Vx}, 60000).catch(() => null);`);
  await pagina(elegir("Planta", ""));
  // Desde el suroeste: la fachada x = 0, la del viento
  await pagina(`__i2.motor().vista(0).vistaEstandar("so"); __i2.motor().vista(0).encuadrar()`);
  await quietos();
  await captura("3-3d-Vx");
  const d2 = await pagina<{ cargas: number }>(`return await __i2.dep(0);`);
  comprobar(d2.cargas === ESPERADO.Vx, `segmentos de las cargas de Vx: ${d2.cargas} = Node ${ESPERADO.Vx}`);
  await pagina(elegirEn('select[aria-label="Caso activo"]', "G"));
  await pagina(elegirEn('select[aria-label="Escala de las cargas en el alzado y el 3D"]', "2"));
  await pagina(elegir("Modo del 3D", "translucido"));
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).cargas === ${ESPERADO.G}, 60000).catch(() => null);`);
  await quietos();
  await captura("4-3d-G-x2-translucido");
  const sha2 = await pagina<string>(`const c = __i2.motor().vista(0).carg; const b = new Uint8Array(c.segmentos.buffer, c.segmentos.byteOffset, c.segmentos.byteLength); const h = await crypto.subtle.digest("SHA-256", b); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");`);
  comprobar(sha2 === ESPERADO.G2, `los segmentos de G a escala ×2 son los de Node: ${sha2.slice(0, 16)} = ${ESPERADO.G2.slice(0, 16)}`);

  log("\n## Alzado del eje 3 con las cargas de G");
  await pagina(elegirEn('select[aria-label="Escala de las cargas en el alzado y el 3D"]', "1"));
  await pagina(`__i2.boton("Alzado").click()`);
  await pagina(`await __i2.esperar(() => document.querySelector('.celda[data-vista="0"][data-tipo="alzado"] select[aria-label="Eje del alzado"]'));`);
  await pagina(elegir("Eje del alzado", "3"));
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).sha256 === "${ESPERADO.alzado}", 60000).catch(() => null);`);
  await quietos();
  await captura("5-alzado-3-G");
  const d3 = await pagina<{ sha256?: string; capas?: number }>(`return await __i2.dep(0);`);
  comprobar(d3.sha256 === ESPERADO.alzado, `alzado del eje 3 con G: ${d3.capas} capas, sha256 ${d3.sha256?.slice(0, 16)} = Node ${ESPERADO.alzado.slice(0, 16)}`);
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
