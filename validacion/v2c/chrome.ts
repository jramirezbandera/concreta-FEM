/**
 * Banco de V2c-1 en Chrome de verdad (`docs/fem3d/dibujo.md` §4):
 *
 *   node validacion/v2c/chrome.ts          escribe validacion/v2c/out_chrome.txt
 *
 * Como el de V2a (`validacion/v2a/chrome.ts`): compila la app, la sirve con el manejador del servidor
 * local (`app/servidor.ts`) y la maneja con Chrome headless por el protocolo de depuración.
 *
 * - 3 (lo de V2c-1): dibuja con eventos de ratón y teclado, desde los ejes, los pilares y las vigas
 *   de una planta del edificio objetivo de A2 (ejes tecleados, pilares con un clic en cada cruce,
 *   vigas principales de pilar a pilar con el ratón y secundarias tecleadas). Tras «Renumerar», la
 *   huella es la de la referencia renumerada: la misma planta, con sus pilares y vigas. Las losas y
 *   los muros, con V2c-2.
 * - 4: deshacer todo vuelve a la huella de partida, una acción por paso.
 * - 5: en el edificio objetivo (80 pilares por planta, 7 plantas), el enganche al mover el ratón con
 *   la herramienta Viga tarda ≤ 2 ms, y pasar el ratón por la planta no da tareas largas.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { leerProyecto, type Proyecto } from "../../src/agente/proyecto.ts";
import { huellaCompilacion } from "../../src/compilador/compilar.ts";
import { resolverOpciones, type ModeloFisico } from "../../src/compilador/fisico.ts";
import { aplicar } from "../../src/editor/operaciones.ts";
import { serializar } from "../../src/editor/serializar.ts";
import { manejadorCarpeta } from "../../app/servidor.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CAPTURAS = process.env.CAPTURAS;
const PUERTO = 8778;
const PUERTO_CDP = 9338;
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

// ─── 0. La referencia: una planta del edificio objetivo, y el proyecto de partida ───────────────

const edificio = leerProyecto(readFileSync(join(RAIZ, EDIFICIO), "utf8"));
if (!edificio.valido) throw new Error("el edificio objetivo no se lee");
const E = edificio.proyecto;
const PLANTA = "N1";
const m0 = E.modelo;
const plantas: ModeloFisico["plantas"] = [{ id: PLANTA, altura: null }, m0.plantas.at(-1)!];
const referencia: Proyecto = {
  ...E,
  nombre: "V2c-1: una planta del edificio objetivo",
  modelo: {
    plantas,
    materiales: m0.materiales,
    secciones: m0.secciones,
    casos: m0.casos,
    pilares: m0.pilares!.map((p) => ({ ...p, hasta: PLANTA })),
    vigas: m0.vigas!.filter((v) => v.planta === PLANTA),
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
  const dibujado = Date.now() - t0;

  // Renumerar y comparar
  await pagina(`__c.herramienta("Renumerar").click(); const d = await __c.esperar(() => document.querySelector("[role=dialog]")); __c.boton("Renumerar", d).click();`);
  await compilada();
  const h3 = await pagina<string>(`return __c.huella();`);
  comprobar(h3 === HUELLA_REF, `tras «Renumerar», la huella es la de la referencia renumerada (${h3.slice(0, 16)} = ${HUELLA_REF.slice(0, 16)}); dibujado en ${(dibujado / 1000).toFixed(1)} s de banco`);
  if (h3 !== HUELLA_REF) {
    await pagina(`__c.boton("Guardar")?.click(); await new Promise((r) => setTimeout(r, 800));`);
    const leido = leerProyecto(readFileSync(join(datos, "partida", "proyecto.json"), "utf8"));
    if (leido.valido) {
      const a = leido.proyecto.modelo;
      const b = renumerada.proyecto.modelo;
      log(`  pilares ${a.pilares?.length} / ${b.pilares?.length}, vigas ${a.vigas?.length} / ${b.vigas?.length}`);
      const pa = new Map((a.pilares ?? []).map((p) => [p.id, JSON.stringify(p)]));
      for (const p of b.pilares ?? []) if (pa.get(p.id) !== JSON.stringify(p)) log(`  pilar distinto: ${p.id} ${pa.get(p.id)} ≠ ${JSON.stringify(p)}`);
      const va = new Map((a.vigas ?? []).map((v) => [v.id, JSON.stringify(v)]));
      let n = 0;
      for (const v of b.vigas ?? []) if (va.get(v.id) !== JSON.stringify(v) && n++ < 8) log(`  viga distinta: ${v.id} ${va.get(v.id)} ≠ ${JSON.stringify(v)}`);
    }
  }

  // ─── Criterio 4 ───────────────────────────────────────────────────────────────────────────────
  log("\n## Criterio 4: una acción, un paso; deshacer todo deja el proyecto de partida");
  const pasos = XS.length + YS.length + referencia.modelo.pilares!.length + referencia.modelo.vigas!.length + 1;
  const n = await pagina<number>(`
    const b = () => document.querySelector('button[aria-label="Deshacer"]');
    let k = 0;
    for (; k < 400 && !b().disabled; k++) { const t = b().title; b().click(); await __c.esperar(() => b().disabled || b().title !== t, 2000).catch(() => null); }
    return k;`);
  await compilada();
  const h4 = await pagina<string>(`return __c.huella();`);
  comprobar(n === pasos, `${n} pasos de deshacer: ${XS.length + YS.length} ejes + ${referencia.modelo.pilares!.length} pilares + ${referencia.modelo.vigas!.length} vigas + Renumerar = ${pasos}`);
  comprobar(h4 === HUELLA_PARTIDA, `deshecho todo, la huella es la de partida (${h4.slice(0, 16)})`);

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
