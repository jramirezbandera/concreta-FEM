/**
 * Banco de V2c-4, la plantilla DXF, en Chrome de verdad (`docs/fem3d/dibujo.md` §10.4):
 *
 *   node validacion/v2c4/chrome.ts          escribe validacion/v2c4/out_chrome.txt
 *
 * Con el andamiaje del de V2c (`validacion/v2c/chrome.ts`): compila la app, la sirve con el manejador
 * del servidor local y la maneja con Chrome headless por el protocolo de depuración.
 *
 * - 2 y 5: en la retícula con núcleo de A2 vacía, «Plantilla DXF» con su plano en mm y con ruido
 *   (`dxfDeModelo`), leído en el worker; la vista dibuja lo que coloca Node y la huella no cambia.
 *   Con el ratón, enganchando a la plantilla: las vigas (antes que los pilares, para que ninguna
 *   esquina de un pilar ya dibujado gane a su extremo), los pilares en el centro de su rectángulo, la
 *   losa como polígono y su hueco, el núcleo y su puerta entre las jambas. Tras «Renumerar», la huella
 *   es la de la referencia sin cargas, renumerada. Quitar la plantilla no cambia la huella.
 * - Junto al proyecto: una plantilla en el `proyecto.json` con su DXF al lado se lee del servidor; la
 *   que no tiene el fichero dice que falta.
 * - 4: en el edificio objetivo, en N3, un DXF de 100 000 segmentos importado no da tareas largas, y
 *   con Viga el enganche (con la plantilla) tarda ≤ 2 ms; pasar el ratón no da tareas largas.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { createHash } from "node:crypto";
import { leerProyecto, type PlantillaDxf, type Proyecto } from "../../src/agente/proyecto.ts";
import { huellaCompilacion } from "../../src/compilador/compilar.ts";
import { resolverOpciones } from "../../src/compilador/fisico.ts";
import { dibujoDxf } from "../../src/dxf/aplanar.ts";
import { colocar, nuevaPlantilla } from "../../src/editor/dibujo/plantilla.ts";
import { aplicar } from "../../src/editor/operaciones.ts";
import { serializar } from "../../src/editor/serializar.ts";
import { dxfDeModelo, escribirDxf, type EntidadPrueba } from "../../src/pruebas/dxfPrueba.ts";
import { manejadorCarpeta } from "../../app/servidor.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CAPTURAS = process.env.CAPTURAS;
const PUERTO = 8779;
const PUERTO_CDP = 9339;
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
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// ─── 0. Las referencias ─────────────────────────────────────────────────────────────────────────

const nucleo = leerProyecto(readFileSync(join(RAIZ, NUCLEO), "utf8"));
if (!nucleo.valido) throw new Error("la retícula con núcleo no se lee");
const N = nucleo.proyecto;
const n0 = N.modelo;
const opN = resolverOpciones(N.opciones ?? {});
const { cargas: _c, ...sinCargas } = n0;
const refNucleo: Proyecto = { ...N, modelo: { ...sinCargas, muros: n0.muros!.map(({ base, ...w }) => (base === "empotrado" ? w : { ...w, base })) } };
const partida: Proyecto = { ...N, modelo: { plantas: n0.plantas, materiales: n0.materiales, secciones: n0.secciones, casos: n0.casos } };
const ren = aplicar(refNucleo, { op: "renumerar" });
if (!ren.ok) throw new Error("la referencia no se renumera");
const HUELLA_NUCLEO = huellaCompilacion(ren.proyecto.modelo, opN);
const HUELLA_PARTIDA = huellaCompilacion(partida.modelo, opN);

// El plano del arquitecto de la retícula: en mm, con ruido de 1e-9 m
const DXF_NUCLEO = escribirDxf(dxfDeModelo(refNucleo.modelo, "N1"), { escala: 1000, ruido: 1e-6, insunits: 4 });
const dNucleo = dibujoDxf(DXF_NUCLEO);
const segNucleo = (() => {
  const c = colocar(dNucleo, nuevaPlantilla(dNucleo, { nombre: "x", fichero: "x", sha256: "x", planta: "N1" }));
  return (c.lineas.length + c.curvas.length) / 4;
})();

// Una plantilla junto al proyecto (el mismo plano en m, sin ruido: otro sha256) y otra sin su fichero
const DXF_JUNTO = escribirDxf(dxfDeModelo(refNucleo.modelo, "N1"));
const dJunto = dibujoDxf(DXF_JUNTO);
const plJunto: PlantillaDxf = nuevaPlantilla(dJunto, { nombre: "Arquitectura", fichero: "planta.dxf", sha256: sha(DXF_JUNTO), planta: "N1" });
const plFalta: PlantillaDxf = { ...plJunto, nombre: "Estructura", fichero: "estructura.dxf", sha256: "0".repeat(64) };
const segJunto = (() => {
  const c = colocar(dJunto, plJunto);
  return (c.lineas.length + c.curvas.length) / 4;
})();

// Un plano grande para el edificio objetivo: 100 000 segmentos (muebles, sombreados explotados…) en 60 × 40 m
const grande: EntidadPrueba[] = [];
{
  let s = 12345;
  const azar = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 100_000; i++) {
    const a: [number, number] = [-3 + 60 * azar(), -3 + 40 * azar()];
    const l = 0.05 + 0.9 * azar();
    const g = 2 * Math.PI * azar();
    grande.push({ capa: i % 10 ? "MOBILIARIO" : "TABIQUES", linea: [a, [a[0] + l * Math.cos(g), a[1] + l * Math.sin(g)]] });
  }
}
const DXF_GRANDE = escribirDxf(grande, { insunits: 6 });

// ─── 1. La app compilada y los proyectos ────────────────────────────────────────────────────────

execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
const datos = mkdtempSync(join(tmpdir(), "v2c4-proyectos-"));
const poner = (nombre: string, texto: string, ficheros: Record<string, Uint8Array> = {}) => {
  const d = join(datos, nombre);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "proyecto.json"), texto);
  for (const [f, b] of Object.entries(ficheros)) writeFileSync(join(d, f), b);
};
poner("nucleo", serializar(partida));
poner("junto", serializar({ ...partida, plantillas: [plJunto, plFalta] }), { "planta.dxf": DXF_JUNTO });
poner("edificio", readFileSync(join(RAIZ, EDIFICIO), "utf8"));
const ficheroNucleo = join(datos, "arquitectura-nucleo.dxf");
writeFileSync(ficheroNucleo, DXF_NUCLEO);
const ficheroGrande = join(datos, "arquitectura-edificio.dxf");
writeFileSync(ficheroGrande, DXF_GRANDE);

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

const perfil = mkdtempSync(join(tmpdir(), "v2c4-chrome-"));
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
  clic: (p) => { __c.ev("pointermove", p); __c.ev("pointerdown", p); __c.ev("pointerup", p); },
  /** Un clic en p con la vista acercada a 3 m alrededor (a unos 230 px/m: el radio de enganche, unos 4 cm). */
  clicCerca: (p) => { __c.vista().encuadrar([p[0] - 1.5, p[1] - 1.5, p[0] + 1.5, p[1] + 1.5]); __c.clic(p); },
  tecla: (key, destino = document.body) => destino.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
  elegir: (etiqueta, valor) => { const s = document.querySelector('select[aria-label="' + etiqueta + '"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, valor); s.dispatchEvent(new Event("change", { bubbles: true })); },
  escribir: async (etiqueta, valor) => {
    const i = document.querySelector('input[aria-label="' + etiqueta + '"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, valor);
    i.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  },
  aviso: () => document.querySelector(".chip.aviso-herr")?.innerText ?? "",
  pie: () => document.querySelector("[data-cursor]")?.textContent ?? "",
  plantillas: () => [...document.querySelectorAll("section")].find((s) => s.querySelector("h2")?.textContent.startsWith("Plantillas DXF")),
  fotograma: () => new Promise((r) => requestAnimationFrame(() => r())),
};`;
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("DOM.enable");
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

const compilada = () => pagina(`await new Promise((r) => setTimeout(r, 60)); await __c.esperar(() => __c.quieto()); await __c.fotograma(); await __c.fotograma();`);
const num = (x: number) => String(x).replace(".", ",");

/** Elige un fichero en el campo de «Plantilla DXF», como el diálogo del navegador. */
async function elegirDxf(ruta: string): Promise<void> {
  const doc = (await cdp("DOM.getDocument", { depth: 0 })) as { root: { nodeId: number } };
  const n = (await cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector: 'input[aria-label="Fichero DXF de la plantilla"]' })) as { nodeId: number };
  await cdp("DOM.setFileInputFiles", { nodeId: n.nodeId, files: [ruta] });
}

/** Espera a que la plantilla esté leída: lo que dice su fila en el navegador. */
const leida = (ms = 60000) => pagina<string>(`return await __c.esperar(() => { const t = __c.plantillas()?.innerText ?? ""; return /[0-9 ]+ entidades/.test(t) ? t : null; }, ${ms});`);

try {
  // ─── Criterios 2 y 5 ──────────────────────────────────────────────────────────────────────────
  log(`## Criterios 2 y 5: calcar la retícula con núcleo de A2 desde su plano en mm (${dNucleo.lineas.length / 4} segmentos rectos)`);
  await abrir("nucleo");
  comprobar((await pagina<string>(`return __c.huella();`)) === HUELLA_PARTIDA, "el proyecto de partida tiene la huella de Node");
  await elegirDxf(ficheroNucleo);
  const fila = await leida();
  await compilada();
  const enVista = await pagina<number>(`return (await __c.vista().depuracion()).plantilla;`);
  comprobar(enVista === segNucleo, `la plantilla, leída en el worker, se dibuja con los ${segNucleo} segmentos de Node (${enVista}); su fila: «${fila.replace(/\s+/g, " ").slice(0, 80)}»`);
  comprobar((await pagina<string>(`return __c.huella();`)) === HUELLA_PARTIDA, "con la plantilla, la huella no cambia");
  await captura("1-plantilla");

  // Las vigas, de extremo a extremo del plano. Antes, el pie dice el enganche a la plantilla; después, en
  // el mismo punto gana el extremo de la viga dibujada (el modelo, a igual nivel y distancia)
  const [qx, qy] = n0.vigas![0]!.puntos[0]!;
  const pieEn = () => pagina<string>(`__c.vista().encuadrar([${qx - 1.5}, ${qy - 1.5}, ${qx + 1.5}, ${qy + 1.5}]); __c.ev("pointermove", [${qx}, ${qy}]); await __c.fotograma(); return __c.pie();`);
  await pagina(`__c.herramienta("Viga").click(); await __c.esperar(() => document.querySelector('select[aria-label="Sección"]')); __c.elegir("Sección", "${n0.vigas![0]!.seccion}");`);
  const pieAntes = await pieEn();
  comprobar(/x −?0,25 · y 0,1 m · Extremo \(DXF arquitectura-nucleo\)/.test(pieAntes.replace("-", "−")), `el pie dice el enganche a la plantilla, redondeado: «${pieAntes}»`);
  for (const v of n0.vigas!) await pagina(`${v.puntos.map((q) => `__c.clicCerca([${q[0]}, ${q[1]}]);`).join(" ")} __c.tecla("Enter");`);
  const pieDespues = await pieEn();
  comprobar(/Extremo \(V/.test(pieDespues), `dibujada la viga, en ese punto gana su extremo: «${pieDespues}»`);
  // Los pilares, en el centro de su rectángulo
  await pagina(`__c.tecla("Escape"); __c.herramienta("Pilar").click(); await __c.esperar(() => document.querySelector('[aria-label="Planta de la base"]')); __c.elegir("Sección", "${n0.pilares![0]!.seccion}");`);
  for (const p of n0.pilares!) await pagina(`__c.clicCerca([${p.x}, ${p.y}]);`);
  // La losa como polígono y su hueco
  const ln = n0.losas![0]!;
  await pagina(`__c.herramienta("Forjado").click(); await __c.esperar(() => document.querySelector('input[aria-label="canto"]')); __c.boton("Polígono").click(); await __c.escribir("canto", "${num(ln.espesor)}");`);
  await pagina(`${ln.contorno.map((q) => `__c.clicCerca([${q[0]}, ${q[1]}]);`).join(" ")} __c.tecla("Enter");`);
  const hn = ln.huecos![0]!;
  await pagina(`__c.herramienta("Hueco").click(); __c.clicCerca([${hn[0]![0]}, ${hn[0]![1]}]); __c.clicCerca([${hn[2]![0]}, ${hn[2]![1]}]);`);
  // El núcleo, cerrado en su primer punto, y la puerta entre las jambas
  const w = n0.muros![0]!;
  await pagina(`__c.herramienta("Muro").click(); await __c.esperar(() => document.querySelector('input[aria-label="espesor"]')); await __c.escribir("espesor", "${num(w.espesor)}");`);
  await pagina(w.puntos.map((q) => `__c.clicCerca([${q[0]}, ${q[1]}]);`).join(" "));
  const hw = w.huecos![0]!;
  const [a0] = [w.puntos[0]!];
  await pagina(`__c.herramienta("Hueco").click(); await __c.esperar(() => document.querySelector('input[aria-label="z0"]'), 5000); await __c.escribir("z0", "${num(hw.z0)}"); await __c.escribir("z1", "${num(hw.z1)}");`);
  await pagina(`__c.clicCerca([${a0[0] + hw.desde}, ${a0[1]}]); __c.clicCerca([${a0[0] + hw.hasta}, ${a0[1]}]); __c.tecla("Escape"); __c.vista().encuadrar();`);
  await compilada();
  await captura("2-calcado");
  const aviso = await pagina<string>(`return __c.aviso();`);
  comprobar(!/Elija|Escriba|Ya hay|solapar|dentro|tramo|Haga clic/.test(aviso), `vigas, pilares, losa, hueco, núcleo y puerta, sin errores de la herramienta («${aviso.slice(0, 80)}»)`);
  await pagina(`__c.herramienta("Renumerar").click(); const d = await __c.esperar(() => document.querySelector("[role=dialog]")); __c.boton("Renumerar", d).click();`);
  await compilada();
  const h = await pagina<string>(`return __c.huella();`);
  comprobar(h === HUELLA_NUCLEO, `tras «Renumerar», la huella es la de la referencia sin cargas, renumerada (${h.slice(0, 16)} = ${HUELLA_NUCLEO.slice(0, 16)})`);
  // Quitar la plantilla no cambia la huella
  await pagina(`__c.plantillas().querySelector('button[aria-label^="Quitar la plantilla"]').click();`);
  await compilada();
  comprobar((await pagina<string>(`return __c.huella();`)) === HUELLA_NUCLEO && (await pagina<number>(`return (await __c.vista().depuracion()).plantilla;`)) === 0, "quitada la plantilla, la vista no la dibuja y la huella no cambia");

  // ─── Junto al proyecto ────────────────────────────────────────────────────────────────────────
  log("\n## Una plantilla con su DXF junto al proyecto, y otra sin el suyo");
  await abrir("junto");
  const filaJ = await leida();
  await compilada();
  const enVistaJ = await pagina<number>(`return (await __c.vista().depuracion()).plantilla;`);
  comprobar(enVistaJ === segJunto, `la de planta.dxf se lee del servidor y se dibuja con los ${segJunto} segmentos de Node (${enVistaJ})`);
  comprobar(/Falta el fichero/.test(filaJ), `la de estructura.dxf dice que falta: «${filaJ.replace(/\s+/g, " ").slice(0, 90)}»`);

  // ─── Criterio 4 ───────────────────────────────────────────────────────────────────────────────
  log("\n## Criterio 4: un plano de 100 000 segmentos en el edificio objetivo (N3)");
  await abrir("edificio");
  await pagina(`{ const s = document.querySelector('.celda[data-vista="0"] select[aria-label=Planta]'); s.value = "N3"; s.dispatchEvent(new Event("change", { bubbles: true })); }`);
  await compilada();
  await pagina(`window.__largas = [];`);
  const t0 = Date.now();
  await elegirDxf(ficheroGrande);
  await leida(120000);
  await pagina(`await __c.esperar(async () => (await __c.vista().depuracion()).plantilla > 0); await __c.fotograma(); await __c.fotograma();`);
  const tCarga = Date.now() - t0;
  const largasC = await pagina<{ ms: number }[]>(`return window.__largas;`);
  comprobar(!largasC.some((x) => x.ms > 50), `leerlo (${(DXF_GRANDE.length / 1048576).toFixed(1)} MB, en el worker), colocarlo y dibujarlo, en ${tCarga} ms: ${largasC.length} tareas largas (> 50 ms) ${largasC.length ? `(${largasC.map((x) => x.ms.toFixed(0)).join(", ")} ms)` : ""}`);
  await captura("3-edificio");
  await pagina(`__c.herramienta("Viga").click();`);
  const medidas = await pagina<{ primero: number; t: number[]; dxf: number }>(`
    const v = __c.vista(); const d = v.dibujo; const radio = 10 / v.escala;
    const t = []; let a = performance.now(); d.pasar([1, 1], radio, false, [0, 0]); const primero = performance.now() - a;
    let dxf = 0;
    for (let k = 0; k < 400; k++) { const p = [-1 + (56 * ((k * 37) % 400)) / 400, -1 + (37 * ((k * 91) % 400)) / 400]; a = performance.now(); d.pasar(p, radio, false, [0, 0]); t.push(performance.now() - a); if (/DXF/.test(d.cursor()?.texto ?? "")) dxf++; }
    return { primero, t, dxf };`);
  const s = [...medidas.t].sort((a, b) => a - b);
  const p95 = s[Math.floor(s.length * 0.95)]!;
  comprobar(p95 <= 2 && medidas.dxf > 0, `enganche con la plantilla al mover el ratón: mediana ${s[s.length >> 1]!.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, máx. ${s.at(-1)!.toFixed(3)} ms (≤ 2 ms); ${medidas.dxf} de 400 a la plantilla; el índice de la planta, ${medidas.primero.toFixed(1)} ms la primera vez`);
  await pagina(`window.__largas = [];`);
  await pagina(`for (let k = 0; k <= 120; k++) { __c.ev("pointermove", [-1 + 56 * k / 120, -1 + 37 * ((k * 7) % 120) / 120]); await __c.fotograma(); }`);
  const largas = await pagina<{ ms: number }[]>(`return window.__largas;`);
  comprobar(!largas.some((x) => x.ms > 50), `120 movimientos con un fotograma cada uno: ${largas.length} tareas largas (> 50 ms) ${largas.length ? `(${largas.map((x) => x.ms.toFixed(0)).join(", ")} ms)` : ""}`);
  await pagina(`__c.tecla("Escape");`);
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
