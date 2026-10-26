/**
 * Banco de CT1, CT2 y CT3 en Chrome de verdad (`docs/fem3d/cotas.md` §4):
 *
 *   node validacion/ct/chrome.ts          escribe validacion/ct/out_chrome.txt
 *
 * Con el andamiaje del de V2c-1 (`validacion/v2c/chrome.ts`): compila la app, la sirve con el
 * manejador del servidor local y la maneja con Chrome headless por el protocolo de depuración.
 *
 * - 1: en una planta vacía, cuatro pilares puestos sólo con Tab y distancias tecleadas (izquierda,
 *   derecha, abajo y arriba; Intro y clic), desde un pilar y desde los ejes propuestos que salen de
 *   ellos. Guardado el proyecto, sus coordenadas son las tecleadas, bit a bit. Esc suelta lo fijado.
 * - 5: en el edificio objetivo (80 pilares por planta, 7 plantas), con la herramienta Pilar, mover el
 *   ratón y pintar las cotas temporales tarda ≤ 2 ms y no da tareas largas.
 * - CT2 (2, 5 y 6): en el edificio objetivo, con Elegir, el número de la cota 3–4 se ofrece al pasar
 *   por él; un clic lo elige, otro en la flecha del 4 abre el campo con «6,00», y pintar lo que se
 *   mueve en una planta tarda ≤ 16 ms sin tareas largas. Con 6,35 e Intro, el proyecto guardado es el
 *   de `estirar` en Node, byte a byte; deshecho y guardado otra vez, el de partida.
 * - CT3 (4 y 5): en el edificio objetivo, con el pilar de N3 al que llegan más vigas elegido, mover
 *   el ratón y pintar sus cotas tarda ≤ 2 ms; un clic en el número de la izquierda abre el campo con
 *   su valor y, con 0,35 más e Intro, el proyecto guardado es el de `moverPilar` en Node, byte a byte;
 *   deshecho y guardado, el de partida.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { leerProyecto, type Proyecto } from "../../src/agente/proyecto.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { serializar } from "../../src/editor/serializar.ts";
import { cadenasDe, cotasCadena } from "../../src/agente/render/ejes.ts";
import { estirar, moverPilar } from "../../src/editor/estirar.ts";
import { colocar, cotasEn, limpio, referenciasCotas } from "../../src/editor/dibujo/cotas.ts";
import { PlantaFisica } from "../../src/agente/render/modelo.ts";
import { aplicar } from "../../src/editor/operaciones.ts";
import { manejadorCarpeta } from "../../app/servidor.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CAPTURAS = process.env.CAPTURAS;
const PUERTO = 8781;
const PUERTO_CDP = 9341;
const EDIFICIO = "validacion/a2/agente/edificio/proyecto.json";
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

// ─── 0. El proyecto de partida: dos plantas del edificio objetivo, sin pilares ni ejes ──────────

const edificio = leerProyecto(readFileSync(join(RAIZ, EDIFICIO), "utf8"));
if (!edificio.valido) throw new Error("el edificio objetivo no se lee");
const m0 = edificio.proyecto.modelo;
const plantas: ModeloFisico["plantas"] = [{ id: "N1", altura: null }, m0.plantas.at(-1)!];
const partida: Proyecto = { ...edificio.proyecto, nombre: "CT1: pilares con cotas", modelo: { plantas, materiales: m0.materiales, secciones: m0.secciones, casos: m0.casos } };

// ─── 1. La app compilada y los proyectos ────────────────────────────────────────────────────────

execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
const datos = mkdtempSync(join(tmpdir(), "ct-proyectos-"));
const poner = (nombre: string, texto: string) => {
  const d = join(datos, nombre);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "proyecto.json"), texto);
};
poner("partida", serializar(partida));
poner("edificio", readFileSync(join(RAIZ, EDIFICIO), "utf8"));

const TIPOS: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2", ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml" };
const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const ruta = decodeURIComponent(url.pathname);
  const m = /^\/p\/([^/]+)(\/.*)$/.exec(ruta);
  if (m) {
    req.url = m[2]!;
    manejadorCarpeta(join(datos, m[1]!), "proyecto.json")(req, res);
    return;
  }
  const fichero = normalize(join(DIST, ruta === "/" ? "index.html" : ruta));
  if (!fichero.startsWith(DIST) || !existsSync(fichero) || !statSync(fichero).isFile()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": TIPOS[extname(fichero)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(fichero));
});
await new Promise<void>((r) => servidor.listen(PUERTO, "127.0.0.1", r));

// ─── 2. Chrome y su protocolo de depuración ─────────────────────────────────────────────────────

const perfil = mkdtempSync(join(tmpdir(), "ct-chrome-"));
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

// Ayudas de la página: el ratón sobre la vista 0 en coordenadas del modelo, el teclado y la plantilla
const AYUDAS = `
window.__largas = [];
new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__largas.push({ t: e.startTime, ms: e.duration }); }).observe({ type: "longtask", buffered: true });
window.__c = {
  esperar: async (f, ms = 120000) => { const t0 = performance.now(); for (;;) { const v = await f(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("tiempo agotado: " + f); await new Promise((r) => setTimeout(r, 10)); } },
  estado: () => document.querySelector("[data-estado]")?.dataset.estado ?? null,
  huella: () => document.querySelector("[data-estado]")?.dataset.huella ?? null,
  quieto: () => ["calculado", "sin-calcular", "no-compila"].includes(__c.estado()) && [...document.querySelectorAll(".lienzo[data-cargando]")].every((x) => x.dataset.cargando === "false"),
  boton: (texto, raiz = document) => [...raiz.querySelectorAll("button")].find((b) => b.textContent.trim() === texto || b.textContent.trim().startsWith(texto + " ")),
  herramienta: (nombre) => [...document.querySelectorAll("button.herr")].find((b) => b.textContent.trim() === nombre),
  vista: () => window.__motorVistas.vista(0),
  sup: () => document.querySelector('.celda[data-vista="0"] .celda-superficie'),
  ev: (tipo, p, o = {}) => {
    const s = __c.sup(); const r = s.getBoundingClientRect(); const [x, y] = __c.vista().aPx(p);
    s.dispatchEvent(new PointerEvent(tipo, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: tipo === "pointerup" || tipo === "pointermove" ? 0 : 1, clientX: r.left + x, clientY: r.top + y, shiftKey: !!o.mayus }));
  },
  /** Un clic en el punto p del modelo, con el cursor que llega antes. */
  clic: (p) => { __c.ev("pointermove", p); __c.ev("pointerdown", p); __c.ev("pointerup", p); },
  tecla: (key, destino = document.body) => destino.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
  /** Teclea un punto: la primera tecla abre el campo; el texto entero e Intro. */
  teclear: async (texto) => {
    __c.tecla(texto[0]);
    const i = await __c.esperar(() => document.querySelector(".campo-teclado input"), 5000);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, texto);
    i.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await __c.esperar(() => !document.querySelector(".campo-teclado input"), 5000);
    const e = document.querySelector(".campo-teclado .error");
    if (e) throw new Error("el campo de teclado no aceptó «" + texto + "»: " + e.textContent);
  },
  /** Un desplegable o un campo de Propiedades por su aria-label. */
  elegir: (etiqueta, valor) => { const s = document.querySelector('[aria-label="' + etiqueta + '"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, valor); s.dispatchEvent(new Event("change", { bubbles: true })); },
  escribir: async (etiqueta, valor) => {
    const i = document.querySelector('input[aria-label="' + etiqueta + '"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, valor);
    i.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  },
  aviso: () => document.querySelector(".chip.aviso-herr")?.innerText ?? "",
  fotograma: () => new Promise((r) => requestAnimationFrame(() => r())),
};`;
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: AYUDAS });
await cdp("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

async function abrir(nombre: string): Promise<void> {
  const cargada = new Promise<void>((r) => (alCargar = r));
  await cdp("Page.navigate", { url: `http://127.0.0.1:${PUERTO}/?proyecto=/p/${nombre}/proyecto.json` });
  await cargada;
  await pagina(`await __c.esperar(() => __c.quieto());`);
}

async function captura(nombre: string): Promise<void> {
  if (!CAPTURAS) return;
  mkdirSync(CAPTURAS, { recursive: true });
  await pagina(`await new Promise((r) => setTimeout(r, 300));`);
  const r = (await cdp("Page.captureScreenshot", { format: "png" })) as { data: string };
  writeFileSync(join(CAPTURAS, `${nombre}.png`), Buffer.from(r.data, "base64"));
}

/** Espera a que la versión editada esté compilada y la vista, quieta. */
const compilada = () => pagina(`await new Promise((r) => setTimeout(r, 60)); await __c.esperar(() => __c.quieto()); await __c.fotograma(); await __c.fotograma();`);

try {
  // ─── Criterio 1 ───────────────────────────────────────────────────────────────────────────────
  log("## Criterio 1: pilares puestos con Tab y distancias tecleadas");
  // Los errores de la herramienta, tras cada paso
  const errores: string[] = [];
  const error = async () => {
    const e = await pagina<string>(`return document.querySelector(".aviso-herr strong")?.textContent ?? "";`);
    if (e) errores.push(e.trim());
  };
  await abrir("partida");
  await pagina(`__c.herramienta("Pilar").click();`);
  await pagina(`await __c.esperar(() => document.querySelector('[aria-label="Planta de la base"]'));`);
  // P1 tecleado; P2 a 5,40 a la derecha de P1 y a 0 por encima (Intro)
  await pagina(`__c.ev("pointermove", [0.3, 0.2]); await __c.teclear("0; 0");`);
  await pagina(`__c.ev("pointermove", [5.2, 0.3]); __c.tecla("Tab"); await __c.fotograma();`);
  const pie1 = await pagina<string>(`return document.querySelector("[data-cursor]")?.textContent ?? "";`);
  comprobar(/Cota izquierda, desde P1/.test(pie1), `Tab elige la cota de la izquierda, desde P1: «${pie1}»`);
  await pagina(`await __c.teclear("5,4"); await __c.teclear("0"); await __c.fotograma();`);
  await captura("1-dos-fijadas");
  await pagina(`__c.tecla("Enter"); await __c.fotograma();`);
  await error();
  // P3: Tab dos veces (derecha, el eje propuesto por P2) a 0 y abajo a 6,25; un clic en otro sitio
  await pagina(`__c.ev("pointermove", [5.1, 6.2]); __c.tecla("Tab"); __c.tecla("Tab"); await __c.teclear("0"); await __c.teclear("6,25"); __c.clic([3, 3]); await __c.fotograma();`);
  await error();
  // P4: Tab cuatro veces (arriba, desde P3) a 0 y, ya activa la de la izquierda, a 0 del eje 1
  await pagina(`__c.ev("pointermove", [0.2, 6]); for (let k = 0; k < 4; k++) __c.tecla("Tab"); await __c.fotograma();`);
  const pie4 = await pagina<string>(`return document.querySelector("[data-cursor]")?.textContent ?? "";`);
  comprobar(/Cota arriba, desde P3/.test(pie4), `cuatro Tab llegan a la de arriba, desde P3: «${pie4}»`);
  await pagina(`await __c.teclear("0"); __c.ev("pointermove", [0.4, 5.5]); await __c.fotograma();`);
  await captura("2-una-fijada");
  await pagina(`await __c.teclear("0"); __c.tecla("Enter"); await __c.fotograma();`);
  await error();
  // Esc suelta lo fijado sin salir; el segundo sale a Elegir
  await pagina(`__c.ev("pointermove", [2, 2]); __c.tecla("Tab"); await __c.teclear("1"); __c.tecla("Escape"); await __c.fotograma();`);
  const sigue = await pagina<boolean>(`return __c.herramienta("Pilar").getAttribute("aria-pressed") === "true" || __c.herramienta("Pilar").dataset.on === "true";`);
  await pagina(`__c.tecla("Escape"); await __c.fotograma();`);
  const fuera = await pagina<boolean>(`return __c.herramienta("Pilar").getAttribute("aria-pressed") === "true" || __c.herramienta("Pilar").dataset.on === "true";`);
  comprobar(sigue && !fuera, `Esc suelta lo fijado y sigue en Pilar (${sigue}); el segundo vuelve a Elegir (${!fuera})`);
  await compilada();
  await captura("3-cuatro-pilares");
  comprobar(!errores.length, `sin errores de la herramienta${errores.length ? ` («${errores.join("», «")}»)` : ""}`);
  await pagina(`document.querySelector("button[data-sin-guardar=true]").click(); await __c.esperar(() => document.querySelector("button[data-sin-guardar=false]") && !/Guardando/.test(document.body.textContent), 10000);`);
  const leido = leerProyecto(readFileSync(join(datos, "partida", "proyecto.json"), "utf8"));
  const pilares = leido.valido ? (leido.proyecto.modelo.pilares ?? []).map((p) => [p.x, p.y]) : [];
  if (!leido.valido) log(`  el proyecto guardado no se lee: ${JSON.stringify(leido).slice(0, 300)}`);
  const esperado = [
    [0, 0],
    [5.4, 0],
    [5.4, 6.25],
    [0, 6.25],
  ];
  comprobar(JSON.stringify(pilares) === JSON.stringify(esperado), `guardados, los pilares están donde se tecleó, bit a bit: ${JSON.stringify(pilares)}`);

  // ─── Criterio 5 ───────────────────────────────────────────────────────────────────────────────
  log("\n## Criterio 5: las cotas temporales en el edificio objetivo (7 plantas, 80 pilares por planta)");
  await abrir("edificio");
  await pagina(`{ const s = document.querySelector('.celda[data-vista="0"] select[aria-label=Planta]'); s.value = "N3"; s.dispatchEvent(new Event("change", { bubbles: true })); }`);
  await compilada();
  await pagina(`__c.herramienta("Pilar").click(); await __c.esperar(() => document.querySelector('[aria-label="Planta de la base"]'));`);
  // Mover el ratón (enganche) y pintar lo de encima (borrador con sus cotas), cada movimiento por separado
  const medidas = await pagina<{ primero: number; t: number[]; cotas: number }>(`
    const v = __c.vista(); const d = v.dibujo; const radio = 10 / v.escala;
    const lienzo = document.createElement("canvas"); lienzo.width = 1600; lienzo.height = 900; const ctx = lienzo.getContext("2d");
    const col = { fondo: "#fff", texto: "#000", textoSuave: "#666", acento: "#0a64d8", panel: "#fff", borde: "#ccc" };
    const aPx = (q) => v.aPx(q);
    let a = performance.now(); d.pasar([1, 1], radio, false, [0, 0]); d.pintar(ctx, aPx, col); const primero = performance.now() - a;
    const t = [];
    for (let k = 0; k < 400; k++) { const p = [-1 + (56 * ((k * 37) % 400)) / 400, -1 + (37 * ((k * 91) % 400)) / 400]; a = performance.now(); d.pasar(p, radio, false, [0, 0]); d.pintar(ctx, aPx, col); t.push(performance.now() - a); }
    __c.tecla("Tab");
    return { primero, t, cotas: document.querySelector("[data-cursor]")?.textContent ?? "" };`);
  const s = [...medidas.t].sort((a, b) => a - b);
  const p95 = s[Math.floor(s.length * 0.95)]!;
  comprobar(p95 <= 2, `mover el ratón y pintar las cotas: mediana ${s[s.length >> 1]!.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, máx. ${s.at(-1)!.toFixed(3)} ms (≤ 2 ms); la primera vez (índice y referencias), ${medidas.primero.toFixed(1)} ms`);
  await pagina(`window.__largas = [];`);
  await pagina(`for (let k = 0; k <= 120; k++) { __c.ev("pointermove", [-1 + 56 * k / 120, -1 + 37 * ((k * 7) % 120) / 120]); await __c.fotograma(); }`);
  const largas = await pagina<{ ms: number }[]>(`return window.__largas;`);
  comprobar(!largas.some((x) => x.ms > 50), `120 movimientos con un fotograma cada uno: ${largas.length} tareas largas (> 50 ms) ${largas.length ? `(${largas.map((x) => x.ms.toFixed(0)).join(", ")} ms)` : ""}`);
  await pagina(`__c.ev("pointermove", [14.1, 9.3]); __c.tecla("Tab"); await __c.fotograma(); await __c.fotograma();`);
  await captura("5-edificio");
  await pagina(`__c.tecla("Escape"); __c.tecla("Escape");`);

  // ─── CT2 ──────────────────────────────────────────────────────────────────────────────────────
  log("\n## CT2: estirar el edificio objetivo desde la cota 3–4");
  const m = edificio.proyecto.modelo;
  const k = cadenasDe(m).flatMap(cotasCadena).find((x) => x.cadena.ejes[x.i - 1]!.includes("4") && x.cadena.ejes[x.i]!.includes("3"))!;
  // Se mueve el 4 (el extremo de t menor: con los ejes paralelos a Y, t = −x) y todo lo que hay a su derecha
  const lado = 0;
  const e = { n: k.cadena.n, fijo: k.cadena.ts[k.i]!, movil: k.cadena.ts[k.i - 1]! };
  const r = estirar(m, e, 6.35);
  const estirado = r.ok ? aplicar(edificio.proyecto, r.operacion) : null;
  if (!estirado?.ok) throw new Error("estirar en Node no se aplica");
  await pagina(`await __c.esperar(() => !__c.herramienta("Pilar").getAttribute("aria-pressed") || __c.herramienta("Pilar").getAttribute("aria-pressed") === "false");`);
  const K = JSON.stringify({ p: k.p, a: k.a, b: k.b, n: k.cadena.n, lado });
  const pieCota = await pagina<string>(`const k = ${K}; __c.ev("pointermove", k.p); await __c.fotograma(); return document.querySelector("[data-cursor]")?.textContent ?? "";`);
  comprobar(/Cota 3–4: 6,00 m · clic para cambiarla/.test(pieCota), `al pasar por el número, la barra lo ofrece: «${pieCota}»`);
  await pagina(`const k = ${K}; __c.clic(k.p); await __c.fotograma();`);
  const chip1 = await pagina<string>(`return __c.aviso();`);
  comprobar(/Cota 3–4 \(6,00 m\): elija la flecha/.test(chip1), `un clic en el número elige la cota: «${chip1}»`);
  await captura("6-cota-elegida");
  await pagina(`window.__largas = []; const k = ${K}; const px = 1 / __c.vista().escala; const [e, s] = k.lado ? [k.b, 1] : [k.a, -1]; __c.clic([e[0] + s * k.n[0] * 16 * px, e[1] + s * k.n[1] * 16 * px]); await __c.fotograma(); await __c.fotograma();`);
  const campo = await pagina<{ valor: string; cota: string; chip: string }>(`const i = await __c.esperar(() => document.querySelector(".campo-teclado input"), 5000); return { valor: i.value, cota: document.querySelector(".campo-cota")?.textContent ?? "", chip: __c.aviso() };`);
  comprobar(campo.valor === "6,00" && /3–4, se mueve el 4/.test(campo.cota) && /se mueve el eje 4/.test(campo.chip), `la flecha del 4 abre el campo con el valor: «${campo.valor}», «${campo.cota}»`);
  await captura("7-lo-que-se-mueve");
  // Pintar lo de estirar en una planta (lo que se mueve y se alarga, el corte y las flechas)
  const tiempos = await pagina<{ primero: number; t: number[] }>(`
    const v = __c.vista(); const d = v.dibujo;
    const lienzo = document.createElement("canvas"); lienzo.width = 1600; lienzo.height = 900; const ctx = lienzo.getContext("2d");
    const col = { fondo: "#fff", texto: "#000", textoSuave: "#666", acento: "#0a64d8", panel: "#fff", borde: "#ccc" };
    const aPx = (q) => v.aPx(q);
    let a = performance.now(); d.pintar(ctx, aPx, col); const primero = performance.now() - a;
    const t = [];
    for (let k = 0; k < 60; k++) { a = performance.now(); d.pintar(ctx, aPx, col); t.push(performance.now() - a); }
    return { primero, t };`);
  const ts = [...tiempos.t].sort((a, b) => a - b);
  const largasCT2 = await pagina<{ ms: number }[]>(`return window.__largas;`);
  comprobar(ts.at(-1)! <= 16 && tiempos.primero <= 16 && !largasCT2.some((x) => x.ms > 50), `pintar lo que se mueve en una planta: la primera vez ${tiempos.primero.toFixed(1)} ms, luego mediana ${ts[ts.length >> 1]!.toFixed(2)} ms y máx. ${ts.at(-1)!.toFixed(2)} ms (≤ 16 ms); ${largasCT2.length} tareas largas`);
  // ← cambia de lado y → vuelve
  const lados = await pagina<string[]>(`const i = document.querySelector(".campo-teclado input"); const r = [];
    for (const key of ["ArrowLeft", "ArrowRight"]) { i.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); await __c.fotograma(); r.push(document.querySelector(".campo-cota")?.textContent ?? ""); }
    return r;`);
  comprobar(/se mueve el 3/.test(lados[0]!) && /se mueve el 4/.test(lados[1]!), `← y → cambian de lado: «${lados.join("», «")}»`);
  await pagina(`const i = document.querySelector(".campo-teclado input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "6,35"); i.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0)); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await __c.esperar(() => !document.querySelector(".campo-teclado input"), 5000);`);
  await compilada();
  await captura("8-estirado");
  const guardar = () => pagina(`document.querySelector("button[data-sin-guardar=true]").click(); await __c.esperar(() => document.querySelector("button[data-sin-guardar=false]") && !/Guardando/.test(document.body.textContent), 10000);`);
  await guardar();
  const tras = readFileSync(join(datos, "edificio", "proyecto.json"), "utf8");
  comprobar(tras === serializar(estirado.proyecto), `guardado, el proyecto es el de \`estirar\` en Node, byte a byte (${r.ok ? r.operacion.op === "lote" ? r.operacion.operaciones.length : 0 : 0} objetos cambiados)`);
  await pagina(`[...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Deshacer" || b.textContent.trim() === "Deshacer").click(); await __c.fotograma();`);
  await compilada();
  await guardar();
  const deshecho = readFileSync(join(datos, "edificio", "proyecto.json"), "utf8");
  comprobar(deshecho === serializar(edificio.proyecto), `deshecho y guardado, los bytes del de partida (en el formato canónico)`);

  // ─── CT3 ──────────────────────────────────────────────────────────────────────────────────────
  log("\n## CT3: mover un pilar del edificio objetivo desde sus cotas");
  // El pilar de N3 con cota a la izquierda al que llegan más vigas de N3 por su punto fijo
  const enN3 = new PlantaFisica(m, "N3").pilares().map((x) => x.p);
  const vigasDe = (p: (typeof enN3)[number]) => (m.vigas ?? []).filter((v) => v.planta === "N3" && v.puntos.some((q) => q[0] === p.x && q[1] === p.y)).length;
  const conIzq = enN3.filter((p) => cotasEn(referenciasCotas(m, "N3", 0, p.id), [p.x, p.y]).some((x) => x.lado === "izquierda"));
  const pil = [...conIzq].sort((a, b) => vigasDe(b) - vigasDe(a) || (a.id < b.id ? -1 : 1))[0]!;
  const R = referenciasCotas(m, "N3", 0, pil.id);
  const izq = cotasEn(R, [pil.x, pil.y]).find((x) => x.lado === "izquierda")!;
  const valor = limpio(izq.distancia + 0.35);
  const mv = moverPilar(m, pil.id, colocar(R, [pil.x, pil.y], [{ lado: "izquierda", ref: izq.ref, valor }]));
  const movidoNode = mv.ok ? aplicar(edificio.proyecto, mv.operacion) : null;
  if (!movidoNode?.ok) throw new Error("mover el pilar en Node no se aplica");
  await pagina(`__c.clic(${JSON.stringify([pil.x, pil.y])}); await __c.fotograma(); await __c.fotograma();`);
  const chipPilar = await pagina<string>(`return __c.aviso();`);
  comprobar(chipPilar.startsWith(`${pil.id}: un clic en el número de una cota`), `elegido ${pil.id} (${vigasDe(pil)} vigas de N3 por su punto fijo), la barra ofrece sus cotas: «${chipPilar}»`);
  // Mover el ratón y pintar con sus cotas, cada movimiento por separado
  const tPilar = await pagina<number[]>(`
    const v = __c.vista(); const d = v.dibujo; const radio = 10 / v.escala;
    const lienzo = document.createElement("canvas"); lienzo.width = 1600; lienzo.height = 900; const ctx = lienzo.getContext("2d");
    const col = { fondo: "#fff", texto: "#000", textoSuave: "#666", acento: "#0a64d8", panel: "#fff", borde: "#ccc" };
    const aPx = (q) => v.aPx(q);
    const t = [];
    for (let k = 0; k < 400; k++) { const p = [-1 + (56 * ((k * 37) % 400)) / 400, -1 + (37 * ((k * 91) % 400)) / 400]; const a = performance.now(); d.pasar(p, radio, false, [0, 0]); d.pintar(ctx, aPx, col); t.push(performance.now() - a); }
    return t;`);
  const sp = [...tPilar].sort((a, b) => a - b);
  const p95p = sp[Math.floor(sp.length * 0.95)]!;
  comprobar(p95p <= 2, `mover el ratón y pintar las cotas del pilar: mediana ${sp[sp.length >> 1]!.toFixed(3)} ms, p95 ${p95p.toFixed(3)} ms, máx. ${sp.at(-1)!.toFixed(3)} ms (≤ 2 ms)`);
  const centro = [(izq.a[0] + izq.b[0]) / 2, (izq.a[1] + izq.b[1]) / 2];
  const pieP = await pagina<string>(`__c.ev("pointermove", ${JSON.stringify(centro)}); await __c.fotograma(); return document.querySelector("[data-cursor]")?.textContent ?? "";`);
  comprobar(pieP.includes(`Cota izquierda, desde ${izq.ref.nombre}: ${izq.texto} m · clic para cambiarla`), `al pasar por el número de la izquierda, la barra lo ofrece: «${pieP}»`);
  await captura("9-cotas-pilar");
  await pagina(`__c.clic(${JSON.stringify(centro)}); await __c.fotograma();`);
  const campoP = await pagina<{ valor: string; cota: string }>(`const i = await __c.esperar(() => document.querySelector(".campo-teclado input"), 5000); return { valor: i.value, cota: document.querySelector(".campo-cota")?.textContent ?? "" };`);
  comprobar(campoP.valor === izq.texto && campoP.cota.includes(`izquierda, desde ${izq.ref.nombre} · ${pil.id}`), `un clic abre el campo con el valor: «${campoP.valor}», «${campoP.cota}»`);
  await pagina(`const i = document.querySelector(".campo-teclado input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(String(valor).replace(".", ","))}); i.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0)); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await __c.esperar(() => !document.querySelector(".campo-teclado input"), 5000);`);
  await compilada();
  await captura("10-pilar-movido");
  await guardar();
  const trasP = readFileSync(join(datos, "edificio", "proyecto.json"), "utf8");
  comprobar(trasP === serializar(movidoNode.proyecto), `con ${String(valor).replace(".", ",")} e Intro, guardado, el proyecto es el de \`moverPilar\` en Node, byte a byte (${pil.id} y ${mv.ok ? mv.vigas.length : 0} vigas)`);
  await pagina(`[...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Deshacer" || b.textContent.trim() === "Deshacer").click(); await __c.fotograma();`);
  await compilada();
  await guardar();
  comprobar(readFileSync(join(datos, "edificio", "proyecto.json"), "utf8") === serializar(edificio.proyecto), `deshecho y guardado, los bytes del de partida`);
} catch (e) {
  comprobar(false, `excepción: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  ws.close();
  chrome.kill();
  servidor.close();
  log(`\n${fallos ? `${fallos} FALLOS` : "Todo bien"}`);
  writeFileSync(join(import.meta.dirname, "out_chrome.txt"), salida.join("\n") + "\n");
  try {
    rmSync(perfil, { recursive: true, force: true });
    rmSync(datos, { recursive: true, force: true });
  } catch {
    // Chrome puede tener aún el perfil abierto
  }
  process.exit(fallos ? 1 : 0);
}
