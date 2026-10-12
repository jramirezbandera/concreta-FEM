/**
 * Banco de I2 en Chrome (`docs/fem3d/interfaz.md` §14.1): la app compilada, servida con el
 * edificio objetivo, en Chrome headless con un perfil temporal (sin vistas ni paneles recordados).
 *
 *   node validacion/i2/chrome.ts                      escribe out_chrome.txt
 *   node validacion/i2/chrome.ts --capturas <carpeta> además, una PNG por paso
 *
 * - Criterio 1: los búferes que pinta el motor (la planta N3, su mapa de uz y el alzado del eje 3)
 *   tienen el mismo sha256 que los de la escena de `fem render` preparada en Node.
 * - Criterio 2: desplazar y acercar la planta y orbitar el 3D a 60 fps (la mediana del intervalo
 *   entre fotogramas ≤ 17 ms), sin tareas largas de más de 50 ms; pasar de 1 a 4 vistas en ≤ 0,3 s.
 * - Criterio 3: un clic en la planta, en el alzado y en el 3D, una ventana y Ctrl+clic dan la misma
 *   lista en las cuatro vistas, en el navegador y en las filas de la tabla.
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
const PUERTO = 8778;
const PUERTO_CDP = 9338;
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
if (!(await ses.calcular()).ok) throw new Error("el edificio no calcula");
const shaBuferes = (e: EscenaPreparada) => {
  const h = createHash("sha256");
  for (const c of e.capas) {
    h.update(new Uint8Array(c.segmentos.buffer, c.segmentos.byteOffset, c.segmentos.byteLength));
    h.update(new Uint8Array(c.abanicos.buffer, c.abanicos.byteOffset, c.abanicos.byteLength));
  }
  return h.digest("hex");
};
const valor = <T>(r: { valido: true; valor: T } | { valido: false }): T => {
  if (!r.valido) throw new Error("escena no válida");
  return r.valor;
};
const ESPERADO = {
  modelo: shaBuferes(valor(ses.escena("N3", { vista: "modelo" }))),
  uz: shaBuferes(valor(ses.escena("N3", { vista: "campo", campo: "uz", combinaciones: { tipo: "defecto" } }))),
  alzado: shaBuferes(valor(ses.alzado({ eje: "3" }))),
};

// ─── 1. La app compilada y el proyecto ──────────────────────────────────────────────────────────

execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
const datos = mkdtempSync(join(tmpdir(), "i2-proyectos-"));
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

const perfil = mkdtempSync(join(tmpdir(), "i2-chrome-"));
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
  esperar: async (f, ms = 120000) => { const t0 = performance.now(); for (;;) { const v = await f(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("tiempo agotado: " + f); await new Promise((r) => setTimeout(r, 15)); } },
  estado: () => document.querySelector("[data-estado]")?.dataset.estado ?? null,
  boton: (texto, raiz = document) => [...raiz.querySelectorAll("button")].find((b) => b.textContent.trim() === texto || b.textContent.trim().startsWith(texto + " ") || b.getAttribute("aria-label") === texto),
  quietos: () => [...document.querySelectorAll(".lienzo[data-cargando]")].every((x) => x.dataset.cargando === "false"),
  motor: () => window.__motorVistas,
  dep: (i) => window.__motorVistas.vista(i).depuracion(),
  sup: (i) => document.querySelector('.celda[data-vista="' + i + '"] .celda-superficie'),
  ev: (i, tipo, x, y, o = {}) => { const s = __i2.sup(i); const r = s.getBoundingClientRect(); const E = tipo === "wheel" ? WheelEvent : PointerEvent; s.dispatchEvent(new E(tipo, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: o.boton ?? 0, buttons: tipo === "pointerup" ? 0 : 1 << (o.boton === 1 ? 2 : o.boton === 2 ? 1 : 0), clientX: r.left + x, clientY: r.top + y, shiftKey: !!o.mayus, ctrlKey: !!o.ctrl, deltaY: o.deltaY ?? 0 })); },
  clic: async (i, x, y, o = {}) => { __i2.ev(i, "pointerdown", x, y, o); __i2.ev(i, "pointerup", x, y, o); await new Promise((r) => setTimeout(r, 30)); },
  fotograma: () => new Promise((r) => requestAnimationFrame(() => r())),
  /** Un arrastre de (x0, y0) a (x1, y1) en n pasos, uno por fotograma, midiendo los intervalos entre fotogramas. */
  arrastre: async (i, x0, y0, x1, y1, n, o = {}) => {
    const t = []; let vivo = true; const bucle = (ts) => { t.push(ts); if (vivo) requestAnimationFrame(bucle); }; requestAnimationFrame(bucle);
    __i2.ev(i, "pointerdown", x0, y0, o);
    for (let k = 1; k <= n; k++) { __i2.ev(i, "pointermove", x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, o); await __i2.fotograma(); }
    __i2.ev(i, "pointerup", x1, y1, o);
    await __i2.fotograma(); vivo = false;
    return t.slice(1).map((x, k) => x - t[k]);
  },
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
const p95 = (x: number[]) => {
  const s = [...x].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]! : NaN;
};

try {
  await abrir("edificio", 1920, 1080);
  const gpu = await pagina<string>(`const g = document.createElement("canvas").getContext("webgl2"); const d = g.getExtension("WEBGL_debug_renderer_info"); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : "?";`);
  log(`GPU de Chrome: ${gpu}`);
  const planta = (id: string) => `{ const s = document.querySelector('.celda[data-vista="0"] select[aria-label=Planta]'); s.value = "${id}"; s.dispatchEvent(new Event("change", { bubbles: true })); }`;

  // ─── Criterio 1 ───────────────────────────────────────────────────────────────────────────────
  log("\n## Criterio 1: los búferes que pinta el motor, los de la escena de fem render");
  await pagina(planta("N3"));
  await quietos();
  await captura("1-modelo-N3");
  const d1 = await pagina<{ sha256: string; capas: number }>(`return await __i2.dep(0);`);
  comprobar(d1.sha256 === ESPERADO.modelo, `planta N3, modelo: ${d1.capas} capas, sha256 ${d1.sha256?.slice(0, 16)} = Node ${ESPERADO.modelo.slice(0, 16)}`);
  await pagina(`__i2.boton("Alzado").click()`);
  await pagina(`await __i2.esperar(() => document.querySelector('.celda[data-vista="0"][data-tipo="alzado"] select[aria-label="Eje del alzado"]')); const s = document.querySelector('.celda[data-vista="0"] select[aria-label="Eje del alzado"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, "3"); s.dispatchEvent(new Event("change", { bubbles: true }));`);
  await quietos();
  await captura("2-alzado-3");
  const d2 = await pagina<{ sha256: string; capas: number }>(`return await __i2.dep(0);`);
  comprobar(d2.sha256 === ESPERADO.alzado, `alzado del eje 3: ${d2.capas} capas, sha256 ${d2.sha256?.slice(0, 16)} = Node ${ESPERADO.alzado.slice(0, 16)}`);
  await pagina(`__i2.boton("Planta").click()`);
  await quietos();
  await pagina(`__i2.boton("Resultados", document.querySelector("nav")).click()`);
  await pagina(`await __i2.esperar(() => document.querySelector("[data-extremo]"));`);
  await quietos();
  await captura("3-losas-uz-N3");
  const d3 = await pagina<{ sha256: string; capas: number }>(`return await __i2.dep(0);`);
  comprobar(d3.sha256 === ESPERADO.uz, `mapa de uz de N3: ${d3.capas} capas, sha256 ${d3.sha256?.slice(0, 16)} = Node ${ESPERADO.uz.slice(0, 16)}`);
  await pagina(`__i2.boton("Modelo", document.querySelector("nav")).click()`);
  await quietos();

  // ─── Criterio 2 ───────────────────────────────────────────────────────────────────────────────
  log("\n## Criterio 2: fluidez con el edificio objetivo (1920×1080)");
  await pagina(`window.__largas = [];`);
  const t0 = await pagina<number>(`return performance.now();`);
  // Cada paso, con su comienzo en el reloj de la página, para atribuirle sus tareas largas
  const pasos: [string, number][] = [];
  const marca = async (que: string) => pasos.push([que, await pagina<number>(`return performance.now();`)]);
  await marca("desplazar la planta");
  const pan = await pagina<number[]>(`const s = __i2.sup(0).getBoundingClientRect(); return await __i2.arrastre(0, s.width * 0.4, s.height * 0.5, s.width * 0.6, s.height * 0.45, 90, { boton: 1 });`);
  await marca("acercar");
  const zoom = await pagina<number[]>(`const s = __i2.sup(0).getBoundingClientRect(); const a = await __i2.rueda(0, s.width * 0.5, s.height * 0.5, 30, -100); const b = await __i2.rueda(0, s.width * 0.5, s.height * 0.5, 30, 100); return [...a, ...b];`);
  await captura("4-planta-tras-desplazar");
  await marca("pasar a 3D");
  await pagina(`__i2.boton("3D").click()`);
  // I3: el 3D nace en sólido; este banco mide el alámbrico de I2
  await pagina(`await __i2.esperar(() => document.querySelector('.celda[data-vista="0"] select[aria-label="Modo del 3D"]')); { const s = document.querySelector('.celda[data-vista="0"] select[aria-label="Modo del 3D"]'); s.value = "alambrico"; s.dispatchEvent(new Event("change", { bubbles: true })); }`);
  await quietos();
  await captura("5-3d");
  await marca("orbitar");
  const orbita = await pagina<number[]>(`const s = __i2.sup(0).getBoundingClientRect(); return await __i2.arrastre(0, s.width * 0.4, s.height * 0.5, s.width * 0.75, s.height * 0.4, 120, { boton: 1, mayus: true });`);
  await captura("6-3d-orbitado");
  await marca("desplazar 3D");
  const pan3 = await pagina<number[]>(`const s = __i2.sup(0).getBoundingClientRect(); return await __i2.arrastre(0, s.width * 0.5, s.height * 0.5, s.width * 0.4, s.height * 0.55, 60, { boton: 1 });`);
  await marca("pasar a analítico");
  await pagina(`{ const s = document.querySelector('.celda[data-vista="0"] select[aria-label="Modo del 3D"]'); s.value = "analitico"; s.dispatchEvent(new Event("change", { bubbles: true })); }`);
  await quietos();
  await captura("7-3d-analitico");
  await marca("orbitar analítico");
  const orbitaA = await pagina<number[]>(`const s = __i2.sup(0).getBoundingClientRect(); return await __i2.arrastre(0, s.width * 0.4, s.height * 0.5, s.width * 0.6, s.height * 0.45, 90, { boton: 1, mayus: true });`);
  await marca("volver a planta");
  await pagina(`{ const s = document.querySelector('.celda[data-vista="0"] select[aria-label="Modo del 3D"]'); s.value = "alambrico"; s.dispatchEvent(new Event("change", { bubbles: true })); }`);
  await pagina(`__i2.boton("Planta").click()`);
  await quietos();
  for (const [que, t] of [
    ["desplazar la planta", pan],
    ["acercar y alejar la planta", zoom],
    ["orbitar el 3D alámbrico", orbita],
    ["desplazar el 3D", pan3],
    ["orbitar el 3D analítico", orbitaA],
  ] as const)
    comprobar(mediana(t) <= 17, `${que}: mediana ${mediana(t).toFixed(1)} ms entre fotogramas (p95 ${p95(t).toFixed(1)} ms, ${t.length} fotogramas)`);
  const t1 = performance.now();
  await marca("cuatro vistas");
  const ms14 = await pagina<number>(`const t0 = performance.now(); __i2.boton("2 × 2").click(); await __i2.esperar(() => document.querySelectorAll(".celda").length === 4); await new Promise((r) => setTimeout(r, 20)); await __i2.esperar(() => __i2.quietos(), 10000); await __i2.fotograma(); return performance.now() - t0;`);
  comprobar(ms14 <= 300, `pasar de 1 a 4 vistas: ${ms14.toFixed(0)} ms (≤ 300)`);
  void t1;
  await captura("8-cuatro-vistas");
  const largas = await pagina<{ t: number; ms: number }[]>(`return window.__largas;`);
  await marca("fin");
  for (let k = 0; k + 1 < pasos.length; k++) {
    const l = largas.filter((x) => x.t >= pasos[k]![1] && x.t < pasos[k + 1]![1]);
    if (l.length) log(`  tareas largas al ${pasos[k]![0]}: ${l.map((x) => x.ms.toFixed(0)).join(", ")} ms`);
  }
  const peor = Math.max(0, ...largas.filter((l) => l.t >= t0).map((l) => l.ms));
  comprobar(peor <= 50, `ninguna tarea larga de más de 50 ms (la peor, ${peor.toFixed(0)} ms; ${largas.filter((l) => l.t >= t0).length} en total)`);

  // ─── Criterio 3 ───────────────────────────────────────────────────────────────────────────────
  log("\n## Criterio 3: elegir en una vista elige en todas, en el navegador y en la tabla");
  // Las cuatro vistas: planta N3, 3D, alzado del eje 3 y alzado del eje C
  const elegidos = () =>
    pagina<{ vistas: string[][]; nav: string[]; tabla: string[] }>(`
      const m = __i2.motor();
      const vistas = [];
      for (const i of m.indices()) vistas.push((await m.vista(i).depuracion()).elegidos.sort());
      const nav = [...document.querySelectorAll(".arbol-fila.sub[data-on=true]")].map((b) => b.firstChild.textContent).sort();
      const tabla = [...document.querySelectorAll("tr[data-elegido=true]")].map((t) => t.dataset.id).sort();
      return { vistas, nav, tabla };`);
  const ponerSelect = (i: number, v: string) => `{ const s = document.querySelector('.celda[data-vista="${i}"] select[aria-label="Eje del alzado"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, "${v}"); s.dispatchEvent(new Event("change", { bubbles: true })); }`;
  await pagina(`await __i2.esperar(() => document.querySelector('.celda[data-vista="2"] select[aria-label="Eje del alzado"]')); ${ponerSelect(2, "3")} ${ponerSelect(3, "eje-C")}`);
  // La tabla de pilares abierta, sin el filtro de la planta, y los pilares del navegador desplegados
  await pagina(`[...document.querySelectorAll(".dock-tab")].find((b) => b.textContent.startsWith("Tablas")).click(); await __i2.esperar(() => document.querySelector("[role=grid]")); [...document.querySelectorAll("[role=tab]")].find((b) => b.textContent.trim().startsWith("Pilares")).click(); const c = [...document.querySelectorAll("label.chk input")].find((x) => x.checked); if (c) c.click(); [...document.querySelectorAll(".arbol-fila")].find((b) => b.textContent.includes("Pilares")).click();`);
  await quietos();
  const igual = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  const comprobarTodas = async (que: string, esperado: string[]) => {
    await pagina(`await new Promise((r) => setTimeout(r, 150)); await __i2.esperar(() => __i2.quietos());`);
    const r = await elegidos();
    const e = [...esperado].sort();
    comprobar(
      r.vistas.length === 4 && r.vistas.every((v) => igual(v, e)) && igual(r.tabla, e.filter((x) => x.startsWith("P-"))) && igual(r.nav, e.filter((x) => x.startsWith("P-"))),
      `${que}: [${e.join(", ")}] en las 4 vistas (${r.vistas.map((v) => v.length).join("/")}), en el navegador (${r.nav.length}) y en la tabla (${r.tabla.length})`,
    );
  };
  // 1. Un clic en el pilar P-x12-y5 de la planta
  await pagina(`const v = __i2.motor().vista(0); const [x, y] = v.aPx([12, 5]); await __i2.clic(0, x, y);`);
  await comprobarTodas("clic en la planta", ["P-x12-y5"]);
  await captura("9-elegido-en-planta");
  // 2. Ctrl+clic en otro pilar de la planta
  await pagina(`const v = __i2.motor().vista(0); const [x, y] = v.aPx([18, 5]); await __i2.clic(0, x, y, { ctrl: true });`);
  await comprobarTodas("Ctrl+clic en la planta", ["P-x12-y5", "P-x18-y5"]);
  // 3. Un clic en el alzado del eje 3: el pilar P-x12-y20 (u = y + 2), a media altura de su tramo de N3
  await pagina(`const v = __i2.motor().vista(2); const [x, y] = v.aPx([22, 4.5]); await __i2.clic(2, x, y);`);
  await comprobarTodas("clic en el alzado", ["P-x12-y20"]);
  // 4. Un clic en el 3D sobre el pilar P-x0-y0 (a media altura de N2–N3)
  await pagina(`const v = __i2.motor().vista(1); const p = v.aPantalla(0, 0, 4.5); await __i2.clic(1, p[0], p[1]);`);
  await comprobarTodas("clic en el 3D", ["P-x0-y0"]);
  // 5. Una ventana de izquierda a derecha en la planta, que deja dentro sólo los pilares de x = 24 e y = 10…20
  await pagina(`const v = __i2.motor().vista(0); const [x0, y0] = v.aPx([23.5, 20.5]); const [x1, y1] = v.aPx([24.5, 9.5]); __i2.ev(0, "pointerdown", x0, y0); for (let k = 1; k <= 8; k++) { __i2.ev(0, "pointermove", x0 + (x1 - x0) * k / 8, y0 + (y1 - y0) * k / 8); await __i2.fotograma(); } __i2.ev(0, "pointerup", x1, y1); await new Promise((r) => setTimeout(r, 200));`);
  await comprobarTodas("ventana en la planta", ["P-x24-y10", "P-x24-y15", "P-x24-y20"]);
  await captura("10-ventana");
  // 6. Esc suelta todo
  await pagina(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));`);
  await comprobarTodas("Esc", []);
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
