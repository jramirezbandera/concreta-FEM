/**
 * Banco de I3 en Chrome (`docs/fem3d/interfaz.md` §16, criterios 2 y 3 de §16.1): la app compilada,
 * servida con el edificio objetivo y el reticular grande de C4 (V2), en Chrome headless con un perfil
 * temporal.
 *
 *   node validacion/i3/chrome.ts                      escribe out_chrome.txt
 *   node validacion/i3/chrome.ts --capturas <carpeta> además, una PNG por paso
 *
 * - Lo pintado es lo de Node: los triángulos y las aristas del sólido que llegan al motor tienen el
 *   sha256 de los de la sesión en Node; con un rango de plantas, un tipo oculto, aislar y ocultar, la
 *   lista de los triángulos que se pintan es la que da el filtro en Node.
 * - Un clic en el sólido elige la pieza que se ve (un pilar de la fachada que mira a la cámara).
 * - La caja de sección: se enciende alrededor de lo elegido y se mueve arrastrando un asa.
 * - Fluidez: orbitar el sólido y el translúcido a 60 fps (la mediana del intervalo entre fotogramas
 *   ≤ 17 ms); las tareas largas, contadas al llegar el sólido, al filtrar y al mover la caja.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { VERSION_ESQUEMA } from "../../src/agente/proyecto.ts";
import { cotasPlantas } from "../../src/compilador/cotas.ts";
import { sha256 } from "../../src/compilador/huella.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { Sesion } from "../../src/visor/sesion.ts";
import type { Solido } from "../../src/visor/solido.ts";
import { edificioReticular } from "../c4/modelos.ts";

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

interface Filtro {
  desde?: string | null;
  hasta?: string | null;
  sinTipos?: string[];
  aislados?: string[] | null;
  ocultos?: string[];
}
const shaDe = (a: ArrayBufferView) => createHash("sha256").update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest("hex");
/** Los triángulos que se ven con un filtro (§16: tipos, aislar, ocultar y el rango por la planta de cada triángulo). */
function visibles(s: Solido, f: Filtro): Uint32Array {
  const pl = s.plantas;
  const [a, b] = [f.hasta ? pl.indexOf(f.hasta) : 0, f.desde ? pl.indexOf(f.desde) : pl.length - 1];
  const sin = new Set(f.sinTipos ?? []);
  const ais = f.aislados ? new Set(f.aislados) : null;
  const oc = new Set(f.ocultos ?? []);
  const vo = s.objetos.map((o) => !sin.has(o.tipo) && !oc.has(o.id) && (!ais || ais.has(o.id)));
  const r: number[] = [];
  for (let t = 0; t < s.objeto.length; t++) if (vo[s.objeto[t]!] && s.planta[t]! >= a && s.planta[t]! <= b) r.push(t);
  return Uint32Array.from(r);
}

const EDIFICIO = "validacion/a2/agente/edificio/proyecto.json";
const wasm = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
await iniciarNucleo(wasm);
const MOTOR = sha256(new Uint8Array(wasm));
const ab = Sesion.abrir(readFileSync(join(RAIZ, EDIFICIO), "utf8"), MOTOR);
if (!ab.valido) throw new Error("el edificio no abre");
const ses = ab.sesion;
const sol = ses.solido();
const f = ses.proyecto.modelo;
const cotas = cotasPlantas(f.plantas);
// El pilar de la fachada que mira a la cámara por defecto (desde −x, −y), a media altura de su tramo de abajo
const pilar = [...f.pilares!].sort((p, q) => 0.55 * p.x + 0.85 * p.y - (0.55 * q.x + 0.85 * q.y))[0]!;
const kBase = f.plantas.findIndex((x) => x.id === pilar.desde);
const puntoPilar: [number, number, number] = [pilar.x, pilar.y, (cotas[kBase]! + cotas[kBase - 1]!) / 2];
const plantas = f.plantas.map((x) => x.id);
const RANGO: Filtro = { desde: plantas[plantas.length - 2]!, hasta: plantas[plantas.length - 4]! };
const ESPERADO = {
  triangulos: shaDe(sol.triangulos),
  aristas: shaDe(sol.aristas),
  todos: shaDe(visibles(sol, {})),
  nTodos: sol.objeto.length,
  aislado: shaDe(visibles(sol, { aislados: [pilar.id] })),
  rango: shaDe(visibles(sol, RANGO)),
  nRango: visibles(sol, RANGO).length,
  sinLosas: shaDe(visibles(sol, { ...RANGO, sinTipos: ["losa"] })),
  oculto: shaDe(visibles(sol, { ocultos: [pilar.id] })),
};
log(`Edificio objetivo: ${sol.objeto.length} triángulos y ${sol.aristas.length / 6} aristas en Node; pilar de prueba ${pilar.id}; rango ${RANGO.desde} → ${RANGO.hasta} (${ESPERADO.nRango} triángulos)`);

// El reticular grande (V2 de C4), como proyecto
const RETICULAR = edificioReticular();
const sesR = Sesion.abrir(JSON.stringify({ esquema: VERSION_ESQUEMA, nombre: "Reticular V2 (C4)", modelo: RETICULAR }), MOTOR);
if (!sesR.valido) throw new Error("el reticular no abre");
let t0 = performance.now();
const solR = sesR.sesion.solido();
log(`Reticular V2: ${solR.objeto.length} triángulos y ${solR.aristas.length / 6} aristas, ${(performance.now() - t0).toFixed(0)} ms en Node`);
const ESPERADO_R = { triangulos: shaDe(solR.triangulos), aristas: shaDe(solR.aristas) };

// ─── 1. La app compilada y los proyectos ────────────────────────────────────────────────────────

execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
const datos = mkdtempSync(join(tmpdir(), "i3-proyectos-"));
mkdirSync(join(datos, "edificio"), { recursive: true });
copyFileSync(join(RAIZ, EDIFICIO), join(datos, "edificio", "proyecto.json"));
mkdirSync(join(datos, "reticular"), { recursive: true });
writeFileSync(join(datos, "reticular", "proyecto.json"), JSON.stringify({ esquema: VERSION_ESQUEMA, nombre: "Reticular V2 (C4)", modelo: RETICULAR }));

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

const perfil = mkdtempSync(join(tmpdir(), "i3-chrome-"));
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
  dep: (i) => window.__motorVistas.vista(i).depuracion(),
  sup: (i) => document.querySelector('.celda[data-vista="' + i + '"] .celda-superficie'),
  ev: (i, tipo, x, y, o = {}) => { const s = __i2.sup(i); const r = s.getBoundingClientRect(); const E = tipo === "wheel" ? WheelEvent : PointerEvent; s.dispatchEvent(new E(tipo, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: o.boton ?? 0, buttons: tipo === "pointerup" ? 0 : 1 << (o.boton === 1 ? 2 : o.boton === 2 ? 1 : 0), clientX: r.left + x, clientY: r.top + y, shiftKey: !!o.mayus, ctrlKey: !!o.ctrl, deltaY: o.deltaY ?? 0 })); },
  clic: async (i, x, y, o = {}) => { __i2.ev(i, "pointerdown", x, y, o); __i2.ev(i, "pointerup", x, y, o); await new Promise((r) => setTimeout(r, 30)); },
  tecla: (key, o = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ctrlKey: !!o.ctrl, shiftKey: !!o.mayus })),
  fotograma: () => new Promise((r) => requestAnimationFrame(() => r())),
  arrastre: async (i, x0, y0, x1, y1, n, o = {}) => {
    const t = []; let vivo = true; const bucle = (ts) => { t.push(ts); if (vivo) requestAnimationFrame(bucle); }; requestAnimationFrame(bucle);
    __i2.ev(i, "pointerdown", x0, y0, o);
    for (let k = 1; k <= n; k++) { __i2.ev(i, "pointermove", x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, o); await __i2.fotograma(); }
    __i2.ev(i, "pointerup", x1, y1, o);
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
  await pagina(`await __i2.esperar(() => ["calculado", "sin-calcular"].includes(__i2.estado())); await __i2.esperar(() => __i2.quietos());`);
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
type Huella = { triangulos: string; aristas: string; visibles: string } | null;
const huella = () => pagina<Huella>(`return await window.__motorVistas.vista(0).huellaSolido();`);
const dep = () => pagina<{ elegidos: string[]; pintado: string; solido: { triangulos: number; aristas: number } | null; filtro: { caja?: number[] | null; aislados?: string[] | null; ocultos?: string[] } }>(`return await __i2.dep(0);`);

try {
  await abrir("edificio", 1920, 1080);
  const gpu = await pagina<string>(`const g = document.createElement("canvas").getContext("webgl2"); const d = g.getExtension("WEBGL_debug_renderer_info"); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : "?";`);
  log(`GPU de Chrome: ${gpu}`);
  const elegir = (etiqueta: string, v: string) => `{ const s = document.querySelector('.celda[data-vista="0"] select[aria-label="${etiqueta}"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, "${v}"); s.dispatchEvent(new Event("change", { bubbles: true })); }`;
  const orbitar = () => pagina<number[]>(`const s = __i2.sup(0).getBoundingClientRect(); return await __i2.arrastre(0, s.width * 0.4, s.height * 0.5, s.width * 0.7, s.height * 0.42, 120, { boton: 1, mayus: true });`);
  const fps = (que: string, t: number[]) => comprobar(mediana(t) <= 17, `${que}: mediana ${mediana(t).toFixed(1)} ms, p95 ${p95(t).toFixed(1)} ms entre fotogramas (${t.length})`);
  const largas = async (que: string) => {
    const l = await pagina<{ ms: number }[]>(`const x = window.__largas; window.__largas = []; return x;`);
    log(`     tareas largas ${que}: ${l.length}${l.length ? ` (la mayor, ${Math.max(...l.map((x) => x.ms)).toFixed(0)} ms)` : ""}`);
    return l;
  };
  const visiblesIgual = async (que: string, sha: string) => {
    await pagina(`await __i2.esperar(async () => (await window.__motorVistas.vista(0).huellaSolido())?.visibles === "${sha}", 20000).catch(() => null);`);
    const h = await huella();
    comprobar(h?.visibles === sha, `${que}: los triángulos que se pintan son los de Node (${(await dep()).solido?.triangulos ?? "?"})`);
  };

  log("\n## El sólido del edificio objetivo");
  await pagina(`__i2.boton("3D").click()`);
  await pagina(`window.__largas = [];`);
  const ti = await pagina<number>(`return performance.now();`);
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).pintado === "solido", 120000);`);
  await quietos();
  log(`     hasta verlo: ${((await pagina<number>(`return performance.now();`)) - ti).toFixed(0)} ms`);
  const l0 = await largas("al llegar el sólido");
  comprobar(!l0.some((x) => x.ms > 50), "ninguna tarea de más de 50 ms al llegar el sólido");
  await captura("1-solido");
  const h0 = await huella();
  comprobar(h0?.triangulos === ESPERADO.triangulos && h0?.aristas === ESPERADO.aristas, `los triángulos y las aristas tienen el sha256 de Node (${h0?.triangulos.slice(0, 12)}…, ${h0?.aristas.slice(0, 12)}…)`);
  comprobar(h0?.visibles === ESPERADO.todos, `sin filtros se pintan todos (${ESPERADO.nTodos})`);
  fps("orbitar el sólido", await orbitar());
  const l1 = await largas("al orbitar");
  comprobar(!l1.length, "ninguna tarea larga al orbitar el sólido");
  await captura("2-solido-orbitado");

  log("\n## Translúcido");
  await pagina(elegir("Modo del 3D", "translucido"));
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).pintado === "translucido");`);
  await quietos();
  await captura("3-translucido");
  fps("orbitar el translúcido", await orbitar());
  await largas("al orbitar");
  await pagina(elegir("Modo del 3D", "solido"));
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).pintado === "solido");`);

  log("\n## Elegir en el sólido");
  await pagina(`window.__motorVistas.vista(0).vistaEstandar("so"); window.__motorVistas.vista(0).encuadrar();`);
  await quietos();
  const q = await pagina<[number, number] | null>(`return window.__motorVistas.vista(0).aPantalla(${puntoPilar.join(", ")});`);
  if (q) await pagina(`await __i2.clic(0, ${q[0]}, ${q[1]});`);
  await quietos();
  const d1 = await dep();
  comprobar(d1.elegidos.length === 1 && d1.elegidos[0] === pilar.id, `un clic sobre el pilar de la fachada lo elige: ${d1.elegidos.join(", ") || "nada"} (${pilar.id})`);
  await captura("4-elegido");

  log("\n## Filtros");
  await pagina(`window.__largas = [];`);
  await pagina(`__i2.tecla("h");`);
  await visiblesIgual(`aislar ${pilar.id} (H)`, ESPERADO.aislado);
  await captura("5-aislado");
  await pagina(`__i2.tecla("H", { mayus: true });`);
  await visiblesIgual("mostrarlo todo (Mayús+H)", ESPERADO.todos);
  await pagina(`__i2.tecla("h", { ctrl: true });`);
  await visiblesIgual(`ocultar ${pilar.id} (Ctrl+H)`, ESPERADO.oculto);
  await pagina(`__i2.tecla("H", { mayus: true });`);
  await visiblesIgual("mostrarlo todo otra vez", ESPERADO.todos);
  await pagina(`__i2.boton("Opciones de la vista").click();`);
  await pagina(`await __i2.esperar(() => document.querySelector('.opciones-vista'));`);
  await pagina(elegir("Planta de abajo", RANGO.desde!));
  await pagina(elegir("Planta de arriba", RANGO.hasta!));
  await visiblesIgual(`plantas de ${RANGO.desde} a ${RANGO.hasta}`, ESPERADO.rango);
  await captura("6-rango");
  await pagina(`[...document.querySelectorAll('.opciones-vista label')].find((l) => l.textContent.trim() === "Losas").querySelector("input").click();`);
  await visiblesIgual("y sin las losas", ESPERADO.sinLosas);
  await captura("7-rango-sin-losas");
  const lf = await largas("al filtrar");
  comprobar(!lf.some((x) => x.ms > 50), "ninguna tarea de más de 50 ms al filtrar");
  await pagina(`__i2.boton("Mostrar todo").click(); __i2.boton("Opciones de la vista").click();`);
  await visiblesIgual("Mostrar todo", ESPERADO.todos);

  log("\n## Caja de sección");
  await pagina(`__i2.boton("Caja de sección").click();`);
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).filtro.caja);`);
  await quietos();
  const c0 = (await dep()).filtro.caja!;
  comprobar(c0[0]! <= pilar.x - 0.5 && c0[3]! >= pilar.x + 0.5 && c0[1]! <= pilar.y - 0.5 && c0[4]! >= pilar.y + 0.5, `empieza alrededor de lo elegido: x ${c0[0]!.toFixed(2)}…${c0[3]!.toFixed(2)}, y ${c0[1]!.toFixed(2)}…${c0[4]!.toFixed(2)}, z ${c0[2]!.toFixed(2)}…${c0[5]!.toFixed(2)}`);
  await captura("8-caja");
  // Lo elegido sigue: soltarlo y ver el edificio entero recortado; arrastrar el asa de la cara de mayor x hacia fuera
  await pagina(`__i2.tecla("Escape");`);
  await pagina(`window.__motorVistas.vista(0).encuadrar();`);
  await quietos();
  const asa = await pagina<[number, number] | null>(`return window.__motorVistas.vista(0).aPantalla(${c0[3]}, ${(c0[1]! + c0[4]!) / 2}, ${(c0[2]! + c0[5]!) / 2});`);
  const asaFuera = await pagina<[number, number] | null>(`return window.__motorVistas.vista(0).aPantalla(${c0[3]! + 10}, ${(c0[1]! + c0[4]!) / 2}, ${(c0[2]! + c0[5]!) / 2});`);
  await pagina(`window.__largas = [];`);
  if (asa && asaFuera) {
    const t = await pagina<number[]>(`return await __i2.arrastre(0, ${asa[0]}, ${asa[1]}, ${asaFuera[0]}, ${asaFuera[1]}, 60);`);
    fps("mover la caja", t);
  }
  await quietos();
  const c1 = (await dep()).filtro.caja!;
  comprobar(Math.abs(c1[3]! - (c0[3]! + 10)) < 0.5 && c1[0] === c0[0], `arrastrar el asa de la cara de mayor x mueve esa cara 10 m: ${c0[3]!.toFixed(2)} → ${c1[3]!.toFixed(2)}`);
  const lc = await largas("al mover la caja");
  comprobar(!lc.some((x) => x.ms > 50), "ninguna tarea de más de 50 ms al mover la caja");
  await captura("9-caja-movida");
  fps("orbitar con la caja", await orbitar());
  await largas("al orbitar con la caja");
  await pagina(`__i2.boton("Caja de sección").click();`);

  log("\n## El reticular grande (V2 de C4)");
  await abrir("reticular", 1920, 1080);
  // Con --perfil, el perfil de CPU de la página mientras llega el sólido
  const perfilar = process.argv.includes("--perfil");
  if (perfilar) {
    await cdp("Profiler.enable");
    await cdp("Profiler.setSamplingInterval", { interval: 200 });
    await cdp("Profiler.start");
  }
  await pagina(`__i2.boton("3D").click()`);
  await pagina(`window.__largas = [];`);
  const tr = await pagina<number>(`return performance.now();`);
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).pintado === "solido", 180000);`);
  await quietos();
  log(`     hasta verlo: ${((await pagina<number>(`return performance.now();`)) - tr).toFixed(0)} ms`);
  const lr = await largas("al llegar el sólido");
  if (perfilar) {
    const { profile } = (await cdp("Profiler.stop")) as { profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples: number[]; timeDeltas: number[] } };
    const propio = new Map<string, number>();
    const nodos = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, k) => {
      const n = nodos.get(id)!;
      const clave = `${n.callFrame.functionName || "(anónima)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`;
      propio.set(clave, (propio.get(clave) ?? 0) + (profile.timeDeltas[k] ?? 0) / 1000);
    });
    for (const [k, v] of [...propio].sort((a, b) => b[1] - a[1]).slice(0, 15)) log(`     perfil: ${v.toFixed(1)} ms ${k}`);
  }
  comprobar(!lr.some((x) => x.ms > 50), "ninguna tarea de más de 50 ms al llegar el sólido");
  const hr = await huella();
  comprobar(hr?.triangulos === ESPERADO_R.triangulos && hr?.aristas === ESPERADO_R.aristas, `los triángulos (${solR.objeto.length}) y las aristas del reticular tienen el sha256 de Node`);
  await captura("10-reticular");
  fps("orbitar el reticular", await orbitar());
  await largas("al orbitar el reticular");
  await pagina(`window.__motorVistas.vista(0).vistaEstandar("inferior");`);
  await quietos();
  await captura("11-reticular-desde-abajo");
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
