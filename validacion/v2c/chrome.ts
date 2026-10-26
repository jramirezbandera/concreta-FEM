/**
 * Banco de V2c-1, V2c-2 y V2c-3 en Chrome de verdad (`docs/fem3d/dibujo.md` §4 y §9):
 *
 *   node validacion/v2c/chrome.ts          escribe validacion/v2c/out_chrome.txt
 *
 * Como el de V2a (`validacion/v2a/chrome.ts`): compila la app, la sirve con el manejador del servidor
 * local (`app/servidor.ts`) y la maneja con Chrome headless por el protocolo de depuración.
 *
 * - 3: dibuja con eventos de ratón y teclado, desde los ejes, una planta del edificio objetivo de A2
 *   (ejes tecleados, pilares con un clic en cada cruce, vigas principales de pilar a pilar con el
 *   ratón y secundarias tecleadas, la losa como polígono y su hueco tecleados, y en Cargas sus cargas
 *   de superficie con un clic, la lineal y la zona tecleadas) y la retícula con núcleo de A2 (ejes,
 *   pilares, vigas, losa con hueco, el núcleo cerrado con su hueco de puerta, la sobrecarga con un
 *   clic y el viento en los pilares con un clic en cada uno). Tras «Renumerar», la huella de cada uno
 *   es la de su referencia renumerada.
 * - 4: deshacer todo vuelve a la huella de partida, una acción por paso.
 * - 5: en el edificio objetivo (80 pilares por planta, 7 plantas), el enganche al mover el ratón con
 *   la herramienta Viga tarda ≤ 2 ms, y pasar el ratón por la planta no da tareas largas; con Forjado
 *   en una planta con sus vigas y sin losa, lo mismo con el recuadro bajo el cursor; con Mover y la
 *   planta entera elegida, lo mismo con lo elegido movido bajo el cursor.
 * - V2c-3: en la retícula con núcleo ya dibujada, Mover (un pilar, con sus vigas), Copiar (una viga,
 *   dos veces), Girar (90°, tecleado), Simetría (conservando lo original) y un pinzamiento arrastrado
 *   con el ratón dan la huella de lo mismo hecho en Node con `transformar` y `moverAsa`; deshacerlos
 *   vuelve a la de antes, una acción por paso.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { leerProyecto, type Proyecto } from "../../src/agente/proyecto.ts";
import { huellaCompilacion } from "../../src/compilador/compilar.ts";
import { resolverOpciones, type CargaFisica, type ModeloFisico } from "../../src/compilador/fisico.ts";
import { aplicar } from "../../src/editor/operaciones.ts";
import { leerEntrada, resolverEntrada } from "../../src/editor/dibujo/teclado.ts";
import { asas, moverAsa, transformar, type ResultadoTransformar } from "../../src/editor/transformar.ts";
import type { Vec2 } from "../../src/compilador/fisico.ts";
import { serializar } from "../../src/editor/serializar.ts";
import { manejadorCarpeta } from "../../app/servidor.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CAPTURAS = process.env.CAPTURAS;
const PUERTO = 8778;
const PUERTO_CDP = 9338;
const EDIFICIO = "validacion/a2/agente/edificio/proyecto.json";
const NUCLEO = "validacion/a2/agente/nucleo/proyecto.json";
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

// ─── 0. La referencia: una planta del edificio objetivo, y el proyecto de partida ───────────────

const edificio = leerProyecto(readFileSync(join(RAIZ, EDIFICIO), "utf8"));
if (!edificio.valido) throw new Error("el edificio objetivo no se lee");
const E = edificio.proyecto;
const PLANTA = "N1";
const m0 = E.modelo;
const plantas: ModeloFisico["plantas"] = [{ id: PLANTA, altura: null }, m0.plantas.at(-1)!];
/** Las cargas de la planta con los ids que les da el dibujo, Q1, Q2…, en el orden en que se dibujan. */
const conIds = (cs: CargaFisica[]): CargaFisica[] => cs.map((c, i) => ({ ...c, id: `Q${i + 1}` }));
const cargasN1 = (["G-sup-N1", "G-tab-N1", "Q-sup-N1", "Q-zona-N1"] as const).map((id) => m0.cargas!.find((c) => c.id === id)!);
const referencia: Proyecto = {
  ...E,
  nombre: "V2c: una planta del edificio objetivo",
  modelo: {
    plantas,
    materiales: m0.materiales,
    secciones: m0.secciones,
    casos: m0.casos,
    pilares: m0.pilares!.map((p) => ({ ...p, hasta: PLANTA })),
    vigas: m0.vigas!.filter((v) => v.planta === PLANTA),
    losas: m0.losas!.filter((l) => l.planta === PLANTA),
    cargas: conIds(cargasN1),
  },
};
const partida: Proyecto = { ...referencia, modelo: { plantas, materiales: m0.materiales, secciones: m0.secciones, casos: m0.casos } };
const op = resolverOpciones(E.opciones ?? {});
const renumerada = aplicar(referencia, { op: "renumerar" });
if (!renumerada.ok) throw new Error("la referencia no se renumera");
const HUELLA_REF = huellaCompilacion(renumerada.proyecto.modelo, op);
const HUELLA_PARTIDA = huellaCompilacion(partida.modelo, op);
const XS = [...new Set(m0.pilares!.map((p) => p.x))].sort((a, b) => a - b);
const YS = [...new Set(m0.pilares!.map((p) => p.y))].sort((a, b) => a - b);

// La retícula con núcleo: el muro sin la base de por defecto escrita (`empotrado`) y las cargas con los ids del dibujo
const nucleo = leerProyecto(readFileSync(join(RAIZ, NUCLEO), "utf8"));
if (!nucleo.valido) throw new Error("la retícula con núcleo no se lee");
const N = nucleo.proyecto;
const n0 = N.modelo;
const refNucleo: Proyecto = { ...N, modelo: { ...n0, muros: n0.muros!.map(({ base, ...w }) => (base === "empotrado" ? w : { ...w, base })), cargas: conIds([...n0.cargas!]) } };
const partidaNucleo: Proyecto = { ...N, modelo: { plantas: n0.plantas, materiales: n0.materiales, secciones: n0.secciones, casos: n0.casos } };
const opN = resolverOpciones(N.opciones ?? {});
const renNucleo = aplicar(refNucleo, { op: "renumerar" });
if (!renNucleo.ok) throw new Error("la retícula con núcleo no se renumera");
const HUELLA_NUCLEO = huellaCompilacion(renNucleo.proyecto.modelo, opN);
const HUELLA_PARTIDA_NUCLEO = huellaCompilacion(partidaNucleo.modelo, opN);

// ─── 1. La app compilada y los proyectos ────────────────────────────────────────────────────────

execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
const datos = mkdtempSync(join(tmpdir(), "v2c-proyectos-"));
const poner = (nombre: string, texto: string) => {
  const d = join(datos, nombre);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "proyecto.json"), texto);
};
poner("partida", serializar(partida));
poner("nucleo", serializar(partidaNucleo));
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

const perfil = mkdtempSync(join(tmpdir(), "v2c-chrome-"));
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

const num = (x: number) => String(x).replace(".", ",");
const vector = (v: readonly number[]) => v.map(num).join(" ");
let comprobarFluidez = () => {};

/** Va a un espacio de trabajo (Modelo, Cargas…). */
const espacio = (nombre: string) => pagina(`[...document.querySelectorAll("nav.espacios button")].find((b) => b.textContent.trim() === "${nombre}").click(); await __c.esperar(() => __c.herramienta("${nombre === "Cargas" ? "Puntual" : "Pilar"}"), 10000); await __c.esperar(() => __c.quieto());`);

/** Una herramienta de carga con su caso y su valor q. */
async function herramientaCarga(nombre: string, caso: string, q: readonly number[], campo = "q"): Promise<void> {
  await pagina(`__c.elegir("Caso activo", "${caso}"); __c.herramienta("${nombre}").click(); await __c.esperar(() => document.querySelector('input[aria-label="${campo}"]'), 5000); await __c.escribir("${campo}", "${vector(q)}");`);
}

/** Las cuatro cargas de la planta del edificio, en el orden de la referencia. */
async function dibujarCargasEdificio(): Promise<void> {
  await espacio("Cargas");
  const [gs, gt, qs, qz] = cargasN1 as [Extract<CargaFisica, { tipo: "superficie" }>, Extract<CargaFisica, { tipo: "lineal" }>, Extract<CargaFisica, { tipo: "superficie" }>, Extract<CargaFisica, { tipo: "superficie" }>];
  // De superficie en toda la losa: un clic dentro
  await herramientaCarga("Superficie", gs.caso, gs.q);
  await pagina(`__c.clic([10, 10]);`);
  await herramientaCarga("Lineal", gt.caso, gt.q);
  for (const q of gt.puntos) await pagina(`await __c.teclear("${num(q[0])}; ${num(q[1])}");`);
  await pagina(`__c.tecla("Enter");`);
  await herramientaCarga("Superficie", qs.caso, qs.q);
  await pagina(`__c.clic([10, 10]);`);
  // La zona, tecleada (con la herramienta de antes: el modo, en Propiedades)
  await pagina(`__c.escribir("q", "${vector(qz.q)}"); __c.boton("Zona").click();`);
  for (const q of qz.zona!) await pagina(`await __c.teclear("${num(q[0])}; ${num(q[1])}");`);
  await pagina(`__c.tecla("Enter"); __c.boton("Forjado").click(); __c.tecla("Escape");`);
  await compilada();
  await captura("3d-cargas");
  const aviso = await pagina<string>(`return __c.aviso();`);
  comprobar(!/Elija|Escriba|Haga clic/.test(aviso), `las cuatro cargas de la planta, sin errores de la herramienta («${aviso.slice(0, 80)}»)`);
  await espacio("Modelo");
}

/** Compara lo guardado con una referencia, objeto a objeto, si las huellas no casan. */
async function diferencias(carpeta: string, ref: Proyecto): Promise<void> {
  await pagina(`__c.boton("Guardar")?.click(); await new Promise((r) => setTimeout(r, 800));`);
  const leido = leerProyecto(readFileSync(join(datos, carpeta, "proyecto.json"), "utf8"));
  if (!leido.valido) return log("  lo guardado no se lee");
  const a = leido.proyecto.modelo as unknown as Record<string, { id: string }[] | undefined>;
  const b = ref.modelo as unknown as Record<string, { id: string }[] | undefined>;
  for (const k of ["pilares", "vigas", "losas", "panos", "muros", "apoyos", "apoyosLineales", "cargas"]) {
    const [xa, xb] = [a[k] ?? [], b[k] ?? []];
    if (xa.length !== xb.length) log(`  ${k}: ${xa.length} dibujados / ${xb.length} en la referencia`);
    const pa = new Map(xa.map((x) => [x.id, JSON.stringify(x)]));
    let n = 0;
    for (const x of xb) if (pa.get(x.id) !== JSON.stringify(x) && n++ < 6) log(`  ${k} distinto: ${x.id} ${pa.get(x.id)} ≠ ${JSON.stringify(x)}`);
  }
}

try {
  // ─── Criterio 3 ───────────────────────────────────────────────────────────────────────────────
  log(`## Criterio 3: dibujar una planta del edificio objetivo desde los ejes (${XS.length} × ${YS.length} pilares, ${referencia.modelo.vigas!.length} vigas)`);
  await abrir("partida");
  comprobar((await pagina<string>(`return __c.huella();`)) === HUELLA_PARTIDA, "el proyecto de partida tiene la huella de Node");
  const t0 = Date.now();
  // Ejes tecleados, 2 m más allá de los pilares
  const [x0, x1, y0, y1] = [XS[0]! - 2, XS.at(-1)! + 2, YS[0]! - 2, YS.at(-1)! + 2];
  await pagina(`__c.herramienta("Ejes").click(); __c.ev("pointermove", [${(x0 + x1) / 2}, ${(y0 + y1) / 2}]);`);
  for (const y of YS) await pagina(`await __c.teclear("${num(x0)}; ${num(y)}"); await __c.teclear("${num(x1)}; ${num(y)}");`);
  for (const x of XS) await pagina(`await __c.teclear("${num(x)}; ${num(y0)}"); await __c.teclear("${num(x)}; ${num(y1)}");`);
  await compilada();
  await captura("1-ejes");

  // Pilares: un clic en cada cruce, con la plantilla de cada uno, en el orden de la referencia
  await pagina(`__c.herramienta("Pilar").click();`);
  await pagina(`await __c.esperar(() => document.querySelector('[aria-label="Planta de la base"]'));`);
  let actual = { seccion: "", giro: -1 };
  for (const p of referencia.modelo.pilares!) {
    if (p.seccion !== actual.seccion) await pagina(`__c.elegir("Sección", "${p.seccion}");`);
    if ((p.giro ?? 0) !== actual.giro) await pagina(`await __c.escribir("giro", "${p.giro ?? ""}");`);
    actual = { seccion: p.seccion, giro: p.giro ?? 0 };
    await pagina(`__c.clic([${p.x}, ${p.y}]);`);
  }
  await compilada();
  await captura("2-pilares");
  const aviso = await pagina<string>(`return __c.aviso();`);
  comprobar(!/Ya hay|Elija/.test(aviso), `${referencia.modelo.pilares!.length} pilares con un clic, sin errores de la herramienta («${aviso.slice(0, 80)}»)`);

  // Vigas: las principales, de pilar a pilar con el ratón y doble clic; las secundarias, tecleadas con Intro
  await pagina(`__c.herramienta("Viga").click();`);
  const principales = referencia.modelo.vigas!.filter((v) => v.seccion === "V30x60");
  const secundarias = referencia.modelo.vigas!.filter((v) => v.seccion !== "V30x60");
  await pagina(`__c.elegir("Sección", "V30x60");`);
  for (const v of principales) {
    const [a, b] = [v.puntos[0]!, v.puntos.at(-1)!];
    await pagina(`__c.clic([${a[0]}, ${a[1]}]); __c.clic([${b[0]}, ${b[1]}]); __c.sup().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 0, clientY: 0 }));`);
  }
  await pagina(`__c.elegir("Sección", "${secundarias[0]!.seccion}");`);
  for (const v of secundarias) {
    const [a, b] = [v.puntos[0]!, v.puntos.at(-1)!];
    await pagina(`await __c.teclear("${num(a[0])}; ${num(a[1])}"); await __c.teclear("@${num(b[0] - a[0])}; ${num(b[1] - a[1])}"); __c.tecla("Enter");`);
  }
  await pagina(`__c.tecla("Escape");`);
  await compilada();
  await captura("3-vigas");

  // Criterio 5 con Forjado: la planta con sus vigas y sin losa, el recuadro bajo el cursor
  await pagina(`__c.herramienta("Forjado").click();`);
  const mr = await pagina<{ primero: number; t: number[] }>(`
    // Pasar y pintar: el recuadro bajo el cursor sale al pintar el borrador
    const v = __c.vista(); const d = v.dibujo; const radio = 10 / v.escala;
    const ctx = document.createElement("canvas").getContext("2d");
    const col = { fondo: "#fff", texto: "#000", textoSuave: "#666", acento: "#06f", panel: "#fff", borde: "#ccc" };
    const uno = (p) => { d.pasar(p, radio, false, [0, 0]); d.pintar(ctx, (q) => v.aPx(q), col); };
    const t = []; let a = performance.now(); uno([2.5, 2.5]); const primero = performance.now() - a;
    for (let k = 0; k < 400; k++) { const p = [0.3 + (53.4 * ((k * 37) % 400)) / 400, 0.3 + (34.4 * ((k * 91) % 400)) / 400]; a = performance.now(); uno(p); t.push(performance.now() - a); }
    return { primero, t };`);
  const sr = [...mr.t].sort((a, b) => a - b);
  const p95r = sr[Math.floor(sr.length * 0.95)]!;
  comprobarFluidez = () => comprobar(p95r <= 2, `Forjado, pasar y pintar con el recuadro bajo el cursor (80 pilares, ${referencia.modelo.vigas!.length} vigas): mediana ${sr[sr.length >> 1]!.toFixed(3)} ms, p95 ${p95r.toFixed(3)} ms (≤ 2 ms); los recuadros de la planta, ${mr.primero.toFixed(1)} ms la primera vez`);
  await pagina(`__c.ev("pointermove", [2.5, 2.5]); await __c.fotograma(); await __c.fotograma();`);
  await captura("3b-recuadro");

  // La losa como polígono tecleado y su hueco
  const losa = referencia.modelo.losas![0]!;
  await pagina(`__c.boton("Polígono").click();`);
  for (const q of losa.contorno) await pagina(`await __c.teclear("${num(q[0])}; ${num(q[1])}");`);
  await pagina(`__c.tecla("Enter");`);
  await pagina(`__c.herramienta("Hueco").click();`);
  const h0 = losa.huecos![0]!;
  await pagina(`await __c.teclear("${num(h0[0]![0])}; ${num(h0[0]![1])}"); await __c.teclear("${num(h0[2]![0])}; ${num(h0[2]![1])}");`);
  await pagina(`__c.tecla("Escape");`);
  await compilada();
  await captura("3c-losa");
  const avisoLosa = await pagina<string>(`return __c.aviso();`);
  comprobar(!/Elija|Escriba|Ya hay|solapar|dentro/.test(avisoLosa), `la losa y su hueco, tecleados, sin errores de la herramienta («${avisoLosa.slice(0, 80)}»)`);

  // Las cargas, en el espacio Cargas
  await dibujarCargasEdificio();
  const dibujado = Date.now() - t0;

  // Renumerar y comparar
  await pagina(`__c.herramienta("Renumerar").click(); const d = await __c.esperar(() => document.querySelector("[role=dialog]")); __c.boton("Renumerar", d).click();`);
  await compilada();
  const h3 = await pagina<string>(`return __c.huella();`);
  comprobar(h3 === HUELLA_REF, `tras «Renumerar», la huella es la de la referencia renumerada (${h3.slice(0, 16)} = ${HUELLA_REF.slice(0, 16)}); dibujado en ${(dibujado / 1000).toFixed(1)} s de banco`);
  if (h3 !== HUELLA_REF) await diferencias("partida", renumerada.proyecto);

  // ─── Criterio 4 ───────────────────────────────────────────────────────────────────────────────
  log("\n## Criterio 4: una acción, un paso; deshacer todo deja el proyecto de partida");
  const pasos = XS.length + YS.length + referencia.modelo.pilares!.length + referencia.modelo.vigas!.length + 2 + cargasN1.length + 1;
  const n = await pagina<number>(`
    const b = () => document.querySelector('button[aria-label="Deshacer"]');
    let k = 0;
    for (; k < 400 && !b().disabled; k++) { const t = b().title; b().click(); await __c.esperar(() => b().disabled || b().title !== t, 2000).catch(() => null); }
    return k;`);
  await compilada();
  const h4 = await pagina<string>(`return __c.huella();`);
  comprobar(n === pasos, `${n} pasos de deshacer: ${XS.length + YS.length} ejes + ${referencia.modelo.pilares!.length} pilares + ${referencia.modelo.vigas!.length} vigas + losa y hueco + ${cargasN1.length} cargas + Renumerar = ${pasos}`);
  comprobar(h4 === HUELLA_PARTIDA, `deshecho todo, la huella es la de partida (${h4.slice(0, 16)})`);

  // ─── Criterio 3, la retícula con núcleo ───────────────────────────────────────────────────────
  log(`\n## Criterio 3: la retícula con núcleo de A2 (${n0.pilares!.length} pilares, ${n0.vigas!.length} vigas, losa con hueco, núcleo con puerta, ${n0.cargas!.length} cargas)`);
  await abrir("nucleo");
  comprobar((await pagina<string>(`return __c.huella();`)) === HUELLA_PARTIDA_NUCLEO, "el proyecto de partida tiene la huella de Node");
  const NX = [...new Set(n0.pilares!.map((p) => p.x))].sort((a, b) => a - b);
  const NY = [...new Set(n0.pilares!.map((p) => p.y))].sort((a, b) => a - b);
  await pagina(`__c.herramienta("Ejes").click(); __c.ev("pointermove", [9, 7.5]);`);
  for (const y of NY) await pagina(`await __c.teclear("-2; ${num(y)}"); await __c.teclear("20; ${num(y)}");`);
  for (const x of NX) await pagina(`await __c.teclear("${num(x)}; -2"); await __c.teclear("${num(x)}; 17");`);
  await pagina(`__c.herramienta("Pilar").click(); await __c.esperar(() => document.querySelector('[aria-label="Planta de la base"]')); __c.elegir("Sección", "${n0.pilares![0]!.seccion}");`);
  for (const p of n0.pilares!) await pagina(`__c.clic([${p.x}, ${p.y}]);`);
  await pagina(`__c.herramienta("Viga").click(); __c.elegir("Sección", "${n0.vigas![0]!.seccion}");`);
  for (const v of n0.vigas!) await pagina(`await __c.teclear("${num(v.puntos[0]![0])}; ${num(v.puntos[0]![1])}"); await __c.teclear("${num(v.puntos[1]![0])}; ${num(v.puntos[1]![1])}"); __c.tecla("Enter");`);
  // La losa, como polígono tecleado, con su canto; su hueco
  const ln = n0.losas![0]!;
  await pagina(`__c.herramienta("Forjado").click(); await __c.esperar(() => document.querySelector('input[aria-label="canto"]')); __c.boton("Polígono").click(); await __c.escribir("canto", "${num(ln.espesor)}");`);
  for (const q of ln.contorno) await pagina(`await __c.teclear("${num(q[0])}; ${num(q[1])}");`);
  await pagina(`__c.tecla("Enter"); __c.herramienta("Hueco").click();`);
  const hn = ln.huecos![0]!;
  await pagina(`await __c.teclear("${num(hn[0]![0])}; ${num(hn[0]![1])}"); await __c.teclear("${num(hn[2]![0])}; ${num(hn[2]![1])}");`);
  // El núcleo: cerrado con un clic (tecleado) en el primer punto; su puerta, dos puntos por el eje
  const w = n0.muros![0]!;
  await pagina(`__c.herramienta("Muro").click(); await __c.esperar(() => document.querySelector('input[aria-label="espesor"]')); await __c.escribir("espesor", "${num(w.espesor)}");`);
  for (const q of w.puntos) await pagina(`await __c.teclear("${num(q[0])}; ${num(q[1])}");`);
  const hw = w.huecos![0]!;
  const [a0, a1] = [w.puntos[0]!, w.puntos[1]!];
  const largo = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
  const u = [(a1[0] - a0[0]) / largo, (a1[1] - a0[1]) / largo];
  const enEje = (s: number) => [a0[0] + u[0]! * s, a0[1] + u[1]! * s];
  await pagina(`__c.herramienta("Hueco").click(); await __c.esperar(() => document.querySelector('input[aria-label="z0"]'), 5000); await __c.escribir("z0", "${num(hw.z0)}"); await __c.escribir("z1", "${num(hw.z1)}");`);
  for (const s of [hw.desde, hw.hasta]) await pagina(`await __c.teclear("${enEje(s).map(num).join("; ")}");`);
  await pagina(`__c.tecla("Escape");`);
  await compilada();
  await captura("6-nucleo");
  const avisoN = await pagina<string>(`return __c.aviso();`);
  comprobar(!/Elija|Escriba|Ya hay|solapar|dentro|tramo/.test(avisoN), `ejes, pilares, vigas, losa, hueco, núcleo y puerta, sin errores de la herramienta («${avisoN.slice(0, 80)}»)`);
  // Las cargas: la sobrecarga con un clic en la losa y el viento con un clic en cada pilar
  await espacio("Cargas");
  const [su, ...vs] = n0.cargas! as [Extract<CargaFisica, { tipo: "superficie" }>, ...Extract<CargaFisica, { tipo: "pilar" }>[]];
  await herramientaCarga("Superficie", su.caso, su.q);
  await pagina(`__c.clic([3, 3]);`);
  await herramientaCarga("En barra", vs[0]!.caso, vs[0]!.q);
  for (const c of vs) {
    const p = n0.pilares!.find((x) => x.id === c.pilar)!;
    await pagina(`__c.clic([${p.x + 0.04}, ${p.y + 0.03}]);`);
  }
  await pagina(`__c.tecla("Escape");`);
  await espacio("Modelo");
  await pagina(`__c.herramienta("Renumerar").click(); const d = await __c.esperar(() => document.querySelector("[role=dialog]")); __c.boton("Renumerar", d).click();`);
  await compilada();
  await captura("7-nucleo-cargas");
  const hn3 = await pagina<string>(`return __c.huella();`);
  comprobar(hn3 === HUELLA_NUCLEO, `tras «Renumerar», la huella es la de la referencia renumerada (${hn3.slice(0, 16)} = ${HUELLA_NUCLEO.slice(0, 16)})`);
  if (hn3 !== HUELLA_NUCLEO) await diferencias("nucleo", renNucleo.proyecto);

  // ─── V2c-3 ────────────────────────────────────────────────────────────────────────────────────
  log("\n## V2c-3: mover, copiar, girar, simetría y un pinzamiento en la retícula con núcleo");
  let esperado: Proyecto = renNucleo.proyecto;
  const etiquetas: string[] = [];
  const enNode = (r: ResultadoTransformar, etiqueta: string) => {
    if (!r.ok) throw new Error(`${etiqueta}: ${r.mensaje}`);
    const a = aplicar(esperado, r.operacion);
    if (!a.ok) throw new Error(`${etiqueta}: ${a.errores.map((x) => x.mensaje).join(" ")}`);
    esperado = a.proyecto;
    etiquetas.push(etiqueta);
  };
  /** El punto que da lo tecleado desde `ultimo`, como en la app. */
  const tecleado = (texto: string, ultimo: Vec2): Vec2 => {
    const l = leerEntrada(texto);
    if (!l.ok) throw new Error(l.mensaje);
    const r = resolverEntrada(l.valor, { ultimo, cursor: null, direccion: 0, orto: false, mayus: false });
    if (!r.ok) throw new Error(r.mensaje);
    return r.valor;
  };
  const huellaApp = () => pagina<string>(`return __c.huella();`);
  const P = esperado.modelo.pilares![0]!;
  // Mover: con nada elegido, un clic en el pilar lo elige (y lo confirma); el punto base, en él; el destino, tecleado
  await pagina(`__c.herramienta("Mover").click(); __c.clic([${P.x}, ${P.y}]); await __c.esperar(() => __c.aviso().startsWith("Mover ${P.id}: el punto base"), 10000); __c.clic([${P.x}, ${P.y}]); await __c.teclear("@0,4; -0,3"); __c.tecla("Escape"); __c.tecla("Escape");`);
  enNode(transformar(esperado.modelo, [P.id], { tipo: "mover", de: [P.x, P.y], a: tecleado("@0,4; -0,3", [P.x, P.y]) }), "mover");
  await compilada();
  comprobar((await huellaApp()) === huellaCompilacion(esperado.modelo, opN), `Mover ${P.id} (con sus vigas): la huella de Node`);
  // Copiar: una viga, dos veces
  const V = esperado.modelo.vigas![0]!;
  const [va, vb] = [V.puntos[0]!, V.puntos.at(-1)!];
  const medio: Vec2 = [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2];
  await pagina(`__c.herramienta("Copiar").click(); __c.clic([${medio[0]}, ${medio[1]}]); await __c.esperar(() => __c.aviso().startsWith("Copiar ${V.id}: el punto base"), 10000); __c.clic([${va[0]}, ${va[1]}]); await __c.teclear("@0; 1,5"); await __c.teclear("@0; 3"); __c.tecla("Escape"); __c.tecla("Escape"); __c.tecla("Escape");`);
  for (const d of ["@0; 1,5", "@0; 3"]) enNode(transformar(esperado.modelo, [V.id], { tipo: "mover", de: va, a: tecleado(d, va) }, { copiar: true }), "copiar");
  await compilada();
  comprobar((await huellaApp()) === huellaCompilacion(esperado.modelo, opN), `Copiar ${V.id} dos veces: la huella de Node`);
  // Girar 90° la última copia alrededor de su primer punto, con los grados tecleados
  const C = esperado.modelo.vigas!.at(-1)!;
  const c0 = C.puntos[0]!;
  const cm: Vec2 = [(c0[0] + C.puntos.at(-1)![0]) / 2, (c0[1] + C.puntos.at(-1)![1]) / 2];
  await pagina(`__c.herramienta("Girar").click(); __c.clic([${cm[0]}, ${cm[1]}]); await __c.esperar(() => __c.aviso().startsWith("Girar ${C.id}: el centro"), 10000); await __c.teclear("${num(c0[0])}; ${num(c0[1])}"); await __c.teclear("90"); __c.tecla("Escape"); __c.tecla("Escape");`);
  enNode(transformar(esperado.modelo, [C.id], { tipo: "girar", centro: c0, angulo: 90 }), "girar");
  await compilada();
  comprobar((await huellaApp()) === huellaCompilacion(esperado.modelo, opN), `Girar ${C.id} 90° (tecleado): la huella de Node`);
  // Simetría del pilar movido, conservando lo original, por el eje x = 9 (tecleado)
  const Pm = esperado.modelo.pilares!.find((x) => x.id === P.id)!;
  await pagina(`__c.herramienta("Simetría").click(); __c.clic([${Pm.x}, ${Pm.y}]); await __c.esperar(() => __c.aviso().startsWith("Simetría de ${P.id}"), 10000);
    [...document.querySelectorAll("label.chk")].find((l) => l.textContent.includes("Conservar lo original")).querySelector("input").click(); await __c.fotograma();
    await __c.teclear("9; 0"); await __c.teclear("9; 1"); __c.tecla("Escape"); __c.tecla("Escape");`);
  enNode(transformar(esperado.modelo, [P.id], { tipo: "simetria", a: [9, 0], b: [9, 1] }, { copiar: true }), "simetría");
  await compilada();
  comprobar((await huellaApp()) === huellaCompilacion(esperado.modelo, opN), `Simetría de ${P.id} conservándolo: la huella de Node`);
  // Un pinzamiento: con Elegir, un clic elige la viga y se arrastra su último vértice al cruce de ejes de al lado
  // La viga más lejos del núcleo (un clic en la de y = 5 elegiría el muro, que va por ella)
  const lejos = (v: (typeof esperado.modelo.vigas & {})[number]) => -Math.hypot((v.puntos[0]![0] + v.puntos.at(-1)![0]) / 2 - 9, (v.puntos[0]![1] + v.puntos.at(-1)![1]) / 2 - 7.5);
  const W = [...esperado.modelo.vigas!].sort((a, b) => lejos(a) - lejos(b))[0]!;
  const wa = W.puntos.at(-1)!;
  const wm: Vec2 = [(W.puntos[0]![0] + wa[0]) / 2, (W.puntos[0]![1] + wa[1]) / 2];
  const ejesX = [...new Set(n0.pilares!.map((x) => x.x))].sort((a, b) => a - b);
  const ejesY = [...new Set(n0.pilares!.map((x) => x.y))].sort((a, b) => a - b);
  const destino: Vec2 = [ejesX.find((x) => x > wa[0]) ?? ejesX[0]!, ejesY.find((y) => y > wa[1]) ?? ejesY[0]!];
  await pagina(`__c.clic([${wm[0]}, ${wm[1]}]); __c.ev("pointermove", [${wa[0]}, ${wa[1]}]);
    await __c.esperar(() => { __c.ev("pointermove", [${wa[0]}, ${wa[1]}]); return document.querySelector("[data-cursor]")?.textContent.includes("Vértice de ${W.id}"); }, 10000).catch(() => { throw new Error("cursor: " + document.querySelector("[data-cursor]")?.textContent + " | props: " + document.querySelector('[aria-label="Propiedades"], .props')?.innerText?.slice(0, 200)); });
    __c.ev("pointerdown", [${wa[0]}, ${wa[1]}]);
    for (let k = 1; k <= 10; k++) { __c.ev("pointermove", [${wa[0]} + (${destino[0] - wa[0]}) * k / 10, ${wa[1]} + (${destino[1] - wa[1]}) * k / 10]); await __c.fotograma(); }
    __c.ev("pointerup", [${destino[0]}, ${destino[1]}]);`);
  const asa = asas(esperado.modelo, [W.id], "N1").find((x) => x.ruta.join() === `puntos,${W.puntos.length - 1}`)!;
  enNode(moverAsa(esperado.modelo, asa, destino), "pinzamiento");
  await compilada();
  await captura("8-editar");
  comprobar((await huellaApp()) === huellaCompilacion(esperado.modelo, opN), `arrastrar el último vértice de ${W.id} hasta el cruce (${destino.map(num).join("; ")}): la huella de Node`);
  const pasosEditar = await pagina<number>(`
    const b = () => document.querySelector('button[aria-label="Deshacer"]');
    let k = 0;
    for (; k < ${etiquetas.length} && !b().disabled; k++) { const t = b().title; b().click(); await __c.esperar(() => b().disabled || b().title !== t, 2000).catch(() => null); }
    return k;`);
  await compilada();
  comprobar(pasosEditar === etiquetas.length && (await huellaApp()) === HUELLA_NUCLEO, `${pasosEditar} pasos de deshacer (${etiquetas.join(", ")}) vuelven a la huella de antes`);

  // ─── Criterio 5 ───────────────────────────────────────────────────────────────────────────────
  log("\n## Criterio 5: el enganche en el edificio objetivo (7 plantas, 80 pilares por planta)");
  await abrir("edificio");
  await pagina(`{ const s = document.querySelector('.celda[data-vista="0"] select[aria-label=Planta]'); s.value = "N3"; s.dispatchEvent(new Event("change", { bubbles: true })); }`);
  await compilada();
  await pagina(`__c.herramienta("Viga").click();`);
  // El primero construye el índice de la planta; luego, cada movimiento por separado
  const medidas = await pagina<{ primero: number; t: number[] }>(`
    const v = __c.vista(); const d = v.dibujo; const radio = 10 / v.escala;
    const t = []; let a = performance.now(); d.pasar([1, 1], radio, false, [0, 0]); const primero = performance.now() - a;
    for (let k = 0; k < 400; k++) { const p = [-1 + (56 * ((k * 37) % 400)) / 400, -1 + (37 * ((k * 91) % 400)) / 400]; a = performance.now(); d.pasar(p, radio, false, [0, 0]); t.push(performance.now() - a); }
    return { primero, t };`);
  const s = [...medidas.t].sort((a, b) => a - b);
  const p95 = s[Math.floor(s.length * 0.95)]!;
  comprobarFluidez();
  comprobar(p95 <= 2, `enganche al mover el ratón: mediana ${s[s.length >> 1]!.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, máx. ${s.at(-1)!.toFixed(3)} ms (≤ 2 ms); el índice de la planta, ${medidas.primero.toFixed(1)} ms la primera vez`);
  await pagina(`window.__largas = [];`);
  await pagina(`for (let k = 0; k <= 120; k++) { __c.ev("pointermove", [-1 + 56 * k / 120, -1 + 37 * ((k * 7) % 120) / 120]); await __c.fotograma(); }`);
  const largas = await pagina<{ ms: number }[]>(`return window.__largas;`);
  comprobar(!largas.some((x) => x.ms > 50), `120 movimientos con un fotograma cada uno: ${largas.length} tareas largas (> 50 ms) ${largas.length ? `(${largas.map((x) => x.ms.toFixed(0)).join(", ")} ms)` : ""}`);
  // Una viga a medio dibujar: el borrador, el marcador del centro del pilar y su resaltado
  await pagina(`__c.clic([0, 5]); __c.ev("pointermove", [18.08, 5.12]); await __c.fotograma(); await __c.fotograma();`);
  const pie = await pagina<string>(`return document.querySelector("[data-cursor]")?.textContent ?? "";`);
  comprobar(pie.includes("Centro (P-x18-y5)"), `con la viga en curso, el cursor junto al pilar dice su enganche: «${pie}»`);
  await captura("5-viga-en-curso");
  await pagina(`__c.tecla("Escape"); __c.tecla("Escape");`);
  // V2c-3: Mover con la planta entera elegida (una ventana), el punto base puesto y lo elegido movido bajo el cursor
  await pagina(`__c.herramienta("Mover").click(); __c.ev("pointermove", [-3, 40]); __c.ev("pointerdown", [-3, 40]); __c.ev("pointermove", [20, 20]); __c.ev("pointermove", [60, -3]); __c.ev("pointerup", [60, -3]);
    await __c.esperar(() => /^Mover [0-9]+ objetos: el punto base/.test(__c.aviso()), 10000); __c.clic([0, 0]);`);
  const elegidos = await pagina<string>(`return __c.aviso();`);
  const mm = await pagina<number[]>(`
    const v = __c.vista(); const d = v.dibujo; const radio = 10 / v.escala;
    const ctx = document.createElement("canvas").getContext("2d");
    const col = { fondo: "#fff", texto: "#000", textoSuave: "#666", acento: "#06f", panel: "#fff", borde: "#ccc" };
    const t = [];
    for (let k = 0; k < 400; k++) { const p = [-1 + (56 * ((k * 37) % 400)) / 400, -1 + (37 * ((k * 91) % 400)) / 400]; const a = performance.now(); d.pasar(p, radio, false, [0, 0]); d.pintar(ctx, (q) => v.aPx(q), col); t.push(performance.now() - a); }
    return t;`);
  const sm = [...mm].sort((a, b) => a - b);
  const p95m = sm[Math.floor(sm.length * 0.95)]!;
  comprobar(p95m <= 2, `Mover, pasar y pintar lo elegido movido bajo el cursor («${elegidos.slice(0, 22)}…»): mediana ${sm[sm.length >> 1]!.toFixed(3)} ms, p95 ${p95m.toFixed(3)} ms (≤ 2 ms)`);
  await pagina(`window.__largas = [];`);
  await pagina(`for (let k = 0; k <= 120; k++) { __c.ev("pointermove", [-1 + 56 * k / 120, -1 + 37 * ((k * 7) % 120) / 120]); await __c.fotograma(); }`);
  const largasM = await pagina<{ ms: number }[]>(`return window.__largas;`);
  comprobar(!largasM.some((x) => x.ms > 50), `Mover con la planta elegida, 120 movimientos con un fotograma cada uno: ${largasM.length} tareas largas (> 50 ms) ${largasM.length ? `(${largasM.map((x) => x.ms.toFixed(0)).join(", ")} ms)` : ""}`);
  await captura("9-mover-planta");
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
