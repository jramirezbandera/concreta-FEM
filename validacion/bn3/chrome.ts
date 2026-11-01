/**
 * Banco de BN3 (`docs/fem3d/barras.md` §6) en Chrome de verdad: la herramienta Barra en la app
 * compilada, servida con el manejador del servidor local (`app/servidor.ts`), en Chrome headless.
 *
 *   node validacion/bn3/chrome.ts          escribe validacion/bn3/out_chrome.txt
 *
 * - Criterio: el pórtico arriostrado de `src/pruebas/barras.ts` sin sus barras se dibuja con el ratón
 *   y el teclado: la cruz en el alzado del eje A (dos clics en los nudos de los pilares, con la
 *   plantilla «r», articulada y «sólo tracción»), el tornapuntas en el del eje B (un clic en el nudo
 *   de C1 en P1 y «@1,5; 3» tecleado) y la diagonal en la planta C (un clic en D y «3,5; 3» con la
 *   planta del fin P1 y el giro de 30° en la plantilla). La huella es la del pórtico (con los ids de
 *   lo dibujado), lo guardado tiene sus barras byte a byte, y cuatro pasos de deshacer vuelven a la de
 *   partida.
 * - La barra de estado dice dónde queda el extremo («→ P1 (5; 0)»).
 * - En el alzado del edificio objetivo de 7 plantas, pasar y pintar con Barra y un primer extremo
 *   tarda ≤ 2 ms (p95), y 120 movimientos no dan tareas largas.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { leerProyecto, VERSION_ESQUEMA, type Proyecto } from "../../src/agente/proyecto.ts";
import { huellaCompilacion } from "../../src/compilador/compilar.ts";
import { cotasPlantas } from "../../src/compilador/cotas.ts";
import { ejesDe } from "../../src/compilador/ejes.ts";
import { resolverOpciones } from "../../src/compilador/fisico.ts";
import { serializar } from "../../src/editor/serializar.ts";
import { porticoArriostrado } from "../../src/pruebas/barras.ts";
import { manejadorCarpeta } from "../../app/servidor.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CAPTURAS = process.env.CAPTURAS;
const PUERTO = 8791;
const PUERTO_CDP = 9351;
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

// ─── 0. Lo esperado, en Node ────────────────────────────────────────────────────────────────────

const f = porticoArriostrado();
/** Lo de partida: el pórtico sin sus barras ni la carga de T1. */
const partida: Proyecto = { esquema: VERSION_ESQUEMA, nombre: "BN3: el pórtico arriostrado sin barras", modelo: { ...f, barras: [], cargas: f.cargas!.filter((c) => c.tipo !== "barra") } };
/** Lo dibujado: sus cuatro barras, con los ids que les da la herramienta en el orden en que se dibujan. */
const referencia: Proyecto = { ...partida, modelo: { ...partida.modelo, barras: f.barras!.map((b, i) => ({ ...b, id: `B${i + 1}` })) } };
const op = resolverOpciones({});
const HUELLA_PARTIDA = huellaCompilacion(partida.modelo, op);
const HUELLA_REF = huellaCompilacion(referencia.modelo, op);
// u a lo largo de los alzados de los ejes A (y = 0) y B (y = 4): los dos, desde x = −2
const ejes = ejesDe(partida.modelo).ejes;
const eA = ejes.find((e) => e.id === "eje-A")!;
const eB = ejes.find((e) => e.id === "eje-B")!;
if (eA.desde[0] !== -2 || eA.desde[1] !== 0 || eB.desde[0] !== -2 || eB.desde[1] !== 4) throw new Error("los ejes propuestos del pórtico han cambiado");
const u = (x: number) => x + 2;
const COTA = { C: 0, P1: 3, P2: 6 } as const;

const edificio = leerProyecto(readFileSync(join(RAIZ, EDIFICIO), "utf8"));
if (!edificio.valido) throw new Error("el edificio objetivo no se lee");
const ejeEdificio = ejesDe(edificio.proyecto.modelo).ejes[0]!;
/** La cota de la segunda planta del edificio desde arriba: donde se pone el primer extremo. */
const zEdificio = cotasPlantas(edificio.proyecto.modelo.plantas)[1]!;

// ─── 1. La app compilada y los proyectos ────────────────────────────────────────────────────────

execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
const datos = mkdtempSync(join(tmpdir(), "bn3-proyectos-"));
const poner = (nombre: string, texto: string) => {
  const d = join(datos, nombre);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "proyecto.json"), texto);
};
poner("portico", serializar(partida));
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

const perfil = mkdtempSync(join(tmpdir(), "bn3-chrome-"));
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
window.__c = {
  esperar: async (f, ms = 120000) => { const t0 = performance.now(); for (;;) { const v = await f(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("tiempo agotado: " + f); await new Promise((r) => setTimeout(r, 10)); } },
  estado: () => document.querySelector("[data-estado]")?.dataset.estado ?? null,
  huella: () => document.querySelector("[data-estado]")?.dataset.huella ?? null,
  quieto: () => ["calculado", "sin-calcular", "no-compila"].includes(__c.estado()) && [...document.querySelectorAll(".lienzo[data-cargando]")].every((x) => x.dataset.cargando === "false"),
  boton: (texto, raiz = document) => [...raiz.querySelectorAll("button")].find((b) => b.textContent.trim() === texto || b.textContent.trim().startsWith(texto + " ")),
  herramienta: (nombre) => [...document.querySelectorAll("button.herr")].find((b) => b.textContent.trim() === nombre),
  vista: () => window.__motorVistas.vista(0),
  sup: () => document.querySelector('.celda[data-vista="0"] .celda-superficie'),
  ev: (tipo, p) => {
    const s = __c.sup(); const r = s.getBoundingClientRect(); const [x, y] = __c.vista().aPx(p);
    s.dispatchEvent(new PointerEvent(tipo, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: tipo === "pointerup" || tipo === "pointermove" ? 0 : 1, clientX: r.left + x, clientY: r.top + y }));
  },
  /** Un clic en el punto p de la vista 0 (en un alzado, (u, z)), con el cursor que llega antes. */
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
  },
  /** Un desplegable por su aria-label (en Propiedades o en la cabecera de la vista 0). */
  elegir: (etiqueta, valor) => { const s = document.querySelector('.celda[data-vista="0"] select[aria-label="' + etiqueta + '"]') ?? document.querySelector('select[aria-label="' + etiqueta + '"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, valor); s.dispatchEvent(new Event("change", { bubbles: true })); },
  escribir: async (etiqueta, valor) => {
    const i = document.querySelector('input[aria-label="' + etiqueta + '"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, valor);
    i.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  },
  casilla: (texto, valor) => { const c = [...document.querySelectorAll("label.chk")].find((l) => l.textContent.trim() === texto)?.querySelector("input"); if (c && c.checked !== valor) c.click(); },
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
const quieta = () => pagina(`await new Promise((r) => setTimeout(r, 60)); await __c.esperar(() => __c.quieto()); await __c.fotograma(); await __c.fotograma();`);
/** La vista 0, de alzado por el eje `eje` (o de planta, en la planta `planta`). */
const alzado = (eje: string) => pagina(`__c.boton("Alzado").click(); await __c.esperar(() => document.querySelector('.celda[data-vista="0"][data-tipo="alzado"] select[aria-label="Eje del alzado"]'), 20000); __c.elegir("Eje del alzado", "${eje}"); await new Promise((r) => setTimeout(r, 60)); await __c.esperar(() => __c.quieto()); await __c.fotograma(); await __c.fotograma();`);
const planta = (id: string) => pagina(`__c.boton("Planta").click(); await __c.esperar(() => document.querySelector('.celda[data-vista="0"][data-tipo="planta"] select[aria-label="Planta"]'), 20000); __c.elegir("Planta", "${id}"); await new Promise((r) => setTimeout(r, 60)); await __c.esperar(() => __c.quieto()); await __c.fotograma(); await __c.fotograma();`);
/** Un punto (planta, x) de un alzado de los ejes A o B, en (u, z). */
const enAlzado = (p: keyof typeof COTA, x: number) => `[${u(x)}, ${COTA[p]}]`;

try {
  // ─── El criterio: el pórtico arriostrado dibujado ─────────────────────────────────────────────
  log("## El pórtico arriostrado, dibujado: la cruz y el tornapuntas en sus alzados, la diagonal en planta");
  await abrir("portico");
  comprobar((await pagina<string>(`return __c.huella();`)) === HUELLA_PARTIDA, "el proyecto de partida tiene la huella de Node");

  // La cruz, en el alzado del eje A: redondos, articulada y sólo a tracción
  await alzado("eje-A");
  await pagina(`__c.herramienta("Barra").click(); await __c.esperar(() => document.querySelector('[role=region][aria-label="Dibujar · Barra"]'), 10000);`);
  await pagina(`__c.elegir("Sección", "r"); await __c.fotograma(); __c.boton("Articuladas").click(); await __c.fotograma(); __c.casilla("Sólo tracción", true); await __c.fotograma();`);
  await pagina(`__c.clic(${enAlzado("C", 0)});`);
  await pagina(`__c.ev("pointermove", ${enAlzado("P1", 5)}); await __c.fotograma(); await __c.fotograma();`);
  const pie = await pagina<string>(`return document.querySelector("[data-cursor]")?.textContent ?? "";`);
  comprobar(pie.includes("Centro (B)") && pie.includes("→ P1 (5; 0)"), `con el primer extremo puesto, el cursor en el nudo de B en P1 dice su enganche y dónde queda: «${pie}»`);
  await captura("1-cruz-en-curso");
  await pagina(`__c.clic(${enAlzado("P1", 5)});`);
  await pagina(`__c.clic(${enAlzado("C", 5)}); __c.clic(${enAlzado("P1", 0)});`);
  await quieta();
  await captura("2-cruz");

  // El tornapuntas, en el del eje B: el tubo, empotrado; del nudo de C1 en P1, 1,5 m a lo largo y 3 arriba
  await alzado("eje-B");
  await pagina(`__c.elegir("Sección", "t"); await __c.fotograma(); __c.boton("Empotradas").click(); await __c.fotograma(); __c.casilla("Sólo tracción", false); await __c.fotograma();`);
  await pagina(`__c.clic(${enAlzado("P1", 0)}); await __c.teclear("@1,5; 3");`);
  await quieta();
  await captura("3-tornapuntas");

  // La diagonal, en la planta C: del nudo de D a un punto de la losa de P1, con el giro de 30°
  await planta("C");
  await pagina(`await __c.escribir("giro", "30"); __c.elegir("Planta del fin", "P1"); await __c.fotograma();`);
  await pagina(`__c.clic([5, 4]); await __c.teclear("3,5; 3");`);
  await pagina(`__c.tecla("Escape"); __c.tecla("Escape");`);
  await quieta();
  await captura("4-diagonal");
  const aviso = await pagina<string>(`return __c.aviso();`);
  comprobar(!/Elija|lleve el punto|No hay/.test(aviso), `las cuatro barras, sin errores de la herramienta («${aviso.slice(0, 80)}»)`);

  const h = await pagina<string>(`return __c.huella();`);
  comprobar(h === HUELLA_REF, `la huella es la del pórtico arriostrado con los ids de lo dibujado: ${h?.slice(0, 16)} = Node ${HUELLA_REF.slice(0, 16)}`);
  // «Guardar●» con cambios sin guardar; se espera a que deje de estarlo
  await pagina(`const g = () => [...document.querySelectorAll("button[data-sin-guardar]")].find((b) => b.textContent.trim().startsWith("Guardar")); g().click(); await __c.esperar(() => g()?.dataset.sinGuardar === "false", 10000);`);
  const leido = leerProyecto(readFileSync(join(datos, "portico", "proyecto.json"), "utf8"));
  // Las dos en el formato canónico del fichero (`serializar`)
  const canonica = leerProyecto(serializar(referencia));
  const [guardadas, esperadas] = [leido, canonica].map((x) => (x.valido ? JSON.stringify(x.proyecto.modelo.barras) : "no se lee")) as [string, string];
  comprobar(guardadas === esperadas, `lo guardado tiene las cuatro barras del pórtico, byte a byte (${guardadas.length} caracteres)`);
  if (guardadas !== esperadas) log(`  guardado:   ${guardadas}\n  referencia: ${esperadas}`);

  // Una acción, un paso
  const n = await pagina<number>(`
    const b = () => document.querySelector('button[aria-label="Deshacer"]');
    let k = 0;
    for (; k < 20 && !b().disabled; k++) { const t = b().title; b().click(); await __c.esperar(() => b().disabled || b().title !== t, 2000).catch(() => null); }
    return k;`);
  await quieta();
  const h0 = await pagina<string>(`return __c.huella();`);
  comprobar(n === 4 && h0 === HUELLA_PARTIDA, `${n} pasos de deshacer (uno por barra) vuelven a la huella de partida (${h0?.slice(0, 16)})`);

  // ─── Fluidez: el alzado del edificio objetivo ─────────────────────────────────────────────────
  log(`\n## Pasar y pintar en el alzado del edificio objetivo (${edificio.proyecto.modelo.plantas.length} plantas, eje ${ejeEdificio.nombre ?? ejeEdificio.id})`);
  await abrir("edificio");
  await alzado(ejeEdificio.id);
  await pagina(`__c.herramienta("Barra").click(); await __c.esperar(() => document.querySelector('[role=region][aria-label="Dibujar · Barra"]'), 10000);`);
  const caja = await pagina<number[]>(`const v = __c.vista(); const r = __c.sup().getBoundingClientRect(); const a = v.aModelo(0, r.height); const b = v.aModelo(r.width, 0); return [a[0], a[1], b[0], b[1]];`);
  const mr = await pagina<{ primero: number; t: number[] }>(`
    const v = __c.vista(); const d = v.dibujo; const radio = 10 / v.escala;
    const ctx = document.createElement("canvas").getContext("2d");
    const col = { fondo: "#fff", texto: "#000", textoSuave: "#666", acento: "#06f", panel: "#fff", borde: "#ccc" };
    const [x0, y0, x1, y1] = ${JSON.stringify(caja)};
    const uno = (p) => { d.pasar(p, radio, false, [0, 0]); d.pintar(ctx, (q) => v.aPx(q), col); };
    let a = performance.now(); uno([(x0 + x1) / 2, (y0 + y1) / 2]); const primero = performance.now() - a;
    // El primer extremo, en un nivel, para que se pinte la línea hasta el cursor
    d.clic([(x0 + x1) / 2, ${zEdificio}], radio, false, false);
    const t = [];
    for (let k = 0; k < 400; k++) { const p = [x0 + ((x1 - x0) * ((k * 37) % 400)) / 400, y0 + ((y1 - y0) * ((k * 91) % 400)) / 400]; a = performance.now(); uno(p); t.push(performance.now() - a); }
    return { primero, t };`);
  const s = [...mr.t].sort((a, b) => a - b);
  const p95 = s[Math.floor(s.length * 0.95)]!;
  comprobar(p95 <= 2, `Barra en el alzado, pasar y pintar con el primer extremo puesto: mediana ${s[s.length >> 1]!.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms (≤ 2 ms); el índice del alzado, ${mr.primero.toFixed(1)} ms la primera vez`);
  await pagina(`window.__largas = [];`);
  await pagina(`const [x0, y0, x1, y1] = ${JSON.stringify(caja)}; for (let k = 0; k <= 120; k++) { __c.ev("pointermove", [x0 + ((x1 - x0) * k) / 120, y0 + ((y1 - y0) * ((k * 7) % 120)) / 120]); await __c.fotograma(); }`);
  const largas = await pagina<{ ms: number }[]>(`return window.__largas;`);
  comprobar(!largas.some((x) => x.ms > 50), `120 movimientos en el alzado con un fotograma cada uno: ${largas.length} tareas largas (> 50 ms)${largas.length ? ` (${largas.map((x) => x.ms.toFixed(0)).join(", ")} ms)` : ""}`);
  await captura("5-edificio");
  await pagina(`__c.tecla("Escape"); __c.tecla("Escape");`);
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
