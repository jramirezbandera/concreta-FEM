/**
 * Banco de I4 en Chrome (`docs/fem3d/interfaz.md` §7): la app compilada, servida con el edificio
 * objetivo, en Chrome headless con un perfil temporal.
 *
 *   node validacion/i4/chrome.ts                      escribe out_chrome.txt
 *   node validacion/i4/chrome.ts --capturas <carpeta> además, una PNG por paso
 *
 * - Lo que pinta el motor es lo de Node: los triángulos de los diagramas en el 3D (My de todas las
 *   barras), los de los isovalores (uz de todas las plantas y de N3) y los búferes del alzado del
 *   eje 3 con M en el plano (sha256).
 * - Fluidez con los resultados puestos: orbitar el 3D con los diagramas y con los isovalores a 60 fps
 *   (la mediana del intervalo entre fotogramas ≤ 17 ms); las tareas largas, contadas.
 * - El resto de I4 (§15): los pilares por colores, las flechas de las reacciones y las bandas de los
 *   muros (el núcleo) son los de Node; la sonda bajo el cursor (un tramo, una flecha, una estación de
 *   un diagrama y un punto de un mapa) dice lo que su consulta da en Node para ese mismo objetivo;
 *   orbitar con cada capa y con la deformada animada a 60 fps, sin tareas largas, tampoco al pasar el
 *   ratón.
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
import { estacionViga } from "../../src/visor/datos.ts";
import { fmt } from "../../app/src/fmt.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PUERTO = 8779;
const PUERTO_CDP = 9339;
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
const D = { tipo: "defecto" } as const;
const dMy = valor(ses.diagramas3D({ esfuerzo: "My", combinaciones: D, planta: null, piezas: "todas", escala: 1 }));
const isoTodas = valor(ses.isovalores3D({ campo: "uz", combinaciones: D, planta: null }));
const isoN3 = valor(ses.isovalores3D({ campo: "uz", combinaciones: D, planta: "N3" }));
const pilN = valor(ses.pilares3D({ magnitud: "N", combinaciones: D, planta: null }));
const reac = valor(ses.reacciones3D(D, 1));
const NUCLEO = "validacion/a2/agente/nucleo/proyecto.json";
const abN = Sesion.abrir(readFileSync(join(RAIZ, NUCLEO), "utf8"), sha256(new Uint8Array(wasm)));
if (!abN.valido) throw new Error("el núcleo no abre");
const sesN = abN.sesion;
if (!(await sesN.calcular()).ok) throw new Error("el núcleo no calcula");
const isoMuros = valor(sesN.isovalores3D({ campo: "f22", combinaciones: D, planta: null, superficies: "muros" }));
const ESPERADO = {
  pilares: pilN.tramos.length,
  reacciones: reac.segmentos.length / 6,
  muros: isoMuros.triangulos.length / 9,
  diagramas: (dMy.positivo.length + dMy.negativo.length) / 9,
  isoTodas: isoTodas.triangulos.length / 9,
  isoN3: isoN3.triangulos.length / 9,
  alzado: shaBuferes(valor(ses.alzado({ eje: "3" }, { esfuerzo: "M", combinaciones: D, escala: 1 }))),
};

// ─── 1. La app compilada y el proyecto ──────────────────────────────────────────────────────────

execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
const datos = mkdtempSync(join(tmpdir(), "i4-proyectos-"));
mkdirSync(join(datos, "edificio"), { recursive: true });
copyFileSync(join(RAIZ, EDIFICIO), join(datos, "edificio", "proyecto.json"));
mkdirSync(join(datos, "nucleo"), { recursive: true });
copyFileSync(join(RAIZ, NUCLEO), join(datos, "nucleo", "proyecto.json"));

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

const perfil = mkdtempSync(join(tmpdir(), "i4-chrome-"));
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
  const elegir = (etiqueta: string, v: string) => `{ const s = document.querySelector('.celda[data-vista="0"] select[aria-label="${etiqueta}"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, "${v}"); s.dispatchEvent(new Event("change", { bubbles: true })); }`;
  const orbitar = () => pagina<number[]>(`const s = __i2.sup(0).getBoundingClientRect(); return await __i2.arrastre(0, s.width * 0.4, s.height * 0.5, s.width * 0.7, s.height * 0.42, 120, { boton: 1, mayus: true });`);
  const fps = (que: string, t: number[]) => comprobar(mediana(t) <= 17, `${que}: mediana ${mediana(t).toFixed(1)} ms, p95 ${p95(t).toFixed(1)} ms entre fotogramas (${t.length})`);
  const largas = async (que: string) => {
    const l = await pagina<{ ms: number }[]>(`const x = window.__largas; window.__largas = []; return x;`);
    log(`     tareas largas ${que}: ${l.length}${l.length ? ` (la mayor, ${Math.max(...l.map((x) => x.ms)).toFixed(0)} ms)` : ""}`);
  };

  log("\n## Diagramas en el 3D: My de todas las barras");
  await pagina(`__i2.boton("Resultados", document.querySelector("nav")).click()`);
  await pagina(`await __i2.esperar(() => __i2.boton("Diagramas")); __i2.boton("Diagramas").click()`);
  await quietos();
  await pagina(`__i2.boton("3D").click()`);
  await pagina(`window.__largas = [];`);
  const t0 = await pagina<number>(`return performance.now();`);
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).diagramas > 0, 120000);`);
  await quietos();
  log(`     hasta verlos: ${((await pagina<number>(`return performance.now();`)) - t0).toFixed(0)} ms`);
  await largas("al cargarlos");
  await captura("1-3d-my");
  const d1 = await pagina<{ diagramas: number }>(`return await __i2.dep(0);`);
  comprobar(d1.diagramas === ESPERADO.diagramas, `triángulos de los diagramas: ${d1.diagramas} = Node ${ESPERADO.diagramas}`);
  fps("orbitar el 3D con los diagramas", await orbitar());
  await largas("al orbitar");
  await captura("2-3d-my-orbitado");
  await pagina(elegir("Planta", "N3"));
  await quietos();
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).diagramas < ${ESPERADO.diagramas}, 60000);`);
  await captura("3-3d-my-N3");
  await pagina(elegir("Planta", ""));
  await quietos();

  log("\n## Diagramas en el alzado del eje 3: M en el plano");
  await pagina(`__i2.boton("Alzado").click()`);
  await pagina(`await __i2.esperar(() => document.querySelector('.celda[data-vista="0"][data-tipo="alzado"] select[aria-label="Eje del alzado"]'));`);
  await pagina(elegir("Eje del alzado", "3"));
  await quietos();
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).sha256 === "${ESPERADO.alzado}", 60000).catch(() => null);`);
  await captura("4-alzado-3-M");
  const d2 = await pagina<{ sha256: string; capas: number }>(`return await __i2.dep(0);`);
  comprobar(d2.sha256 === ESPERADO.alzado, `alzado del eje 3 con M: ${d2.capas} capas, sha256 ${d2.sha256?.slice(0, 16)} = Node ${ESPERADO.alzado.slice(0, 16)}`);

  log("\n## Isovalores en el 3D: uz");
  await pagina(`__i2.boton("Losas").click()`);
  await quietos();
  await pagina(`__i2.boton("3D").click()`);
  await pagina(`window.__largas = [];`);
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).isovalores > 0, 120000);`);
  await quietos();
  await largas("al cargarlos");
  await captura("5-3d-uz");
  const d3 = await pagina<{ isovalores: number }>(`return await __i2.dep(0);`);
  comprobar(d3.isovalores === ESPERADO.isoTodas, `triángulos de las bandas, todas las plantas: ${d3.isovalores} = Node ${ESPERADO.isoTodas}`);
  fps("orbitar el 3D con los isovalores", await orbitar());
  await largas("al orbitar");
  await pagina(elegir("Planta", "N3"));
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).isovalores === ${ESPERADO.isoN3}, 60000).catch(() => null);`);
  await quietos();
  await captura("6-3d-uz-N3");
  const d4 = await pagina<{ isovalores: number }>(`return await __i2.dep(0);`);
  comprobar(d4.isovalores === ESPERADO.isoN3, `triángulos de las bandas de N3: ${d4.isovalores} = Node ${ESPERADO.isoN3}`);
  await pagina(`__i2.boton("M11").click()`);
  await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).isovalores !== ${ESPERADO.isoN3}, 60000).catch(() => null);`);
  await quietos();
  await captura("7-3d-m11-N3");

  // ─── El resto de I4 (§15) ───────────────────────────────────────────────────────────────────
  type Dep = { sonda: string[] | null; objetivo: { tipo: string; pieza?: string; s?: number; lamina?: number; k?: number; p: [number, number, number] } | null; pilares: number; reacciones: number; isovalores: number; animada: boolean };
  const sondaIgual = (que: string, d: Dep | null, esperado: (o: NonNullable<Dep["objetivo"]>) => string[] | null, lineas: number[]) => {
    const o = d?.objetivo ?? null;
    const e = o ? esperado(o) : null;
    const bien = !!d?.sonda && !!e && lineas.every((k) => d.sonda![k] === e[k]);
    comprobar(bien, `sonda ${que}: «${d?.sonda?.join(" | ") ?? "—"}»${bien ? "" : ` (Node: «${e?.join(" | ") ?? "—"}»)`}`);
  };

  log("\n## Sonda sobre los isovalores (uz de N3)");
  {
    // El centro de una lámina de N3 en la vista que ya enseña su mapa
    const c = ses.compilado!;
    const l = ses.rr!.laminas("N3").laminas[Math.floor(ses.rr!.laminas("N3").laminas.length / 3)]!;
    const P = c.modelo.laminas![l]!.nudos.map((n) => c.modelo.nudos[n]!);
    await pagina(`__i2.boton("uz").click()`);
    await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).isovalores === ${ESPERADO.isoN3}, 60000).catch(() => null);`);
    await quietos();
    await pagina(`window.__largas = [];`);
    const d = await pagina<Dep>(`return await __i2.pasarSobre(0, ${(P[0]!.x + P[2]!.x) / 2}, ${(P[0]!.y + P[2]!.y) / 2}, ${P[0]!.z});`);
    await captura("8-sonda-uz");
    sondaIgual("de uz en N3", d, (o) => {
      if (o.tipo !== "lamina") return null;
      const v = valor(ses.valorLamina({ campo: "uz", combinaciones: D, nombre: isoN3.combinacion!.nombre, lamina: o.lamina!, punto: o.p }));
      return v ? [`${fmt(v.valor, 2)} ${v.unidad}`, `${v.objeto} · ${v.planta} · ${v.comb}`] : null;
    }, [0, 1]);
    await largas("al pasar el ratón");
  }

  log("\n## Sonda sobre los diagramas (My)");
  {
    await pagina(`__i2.boton("Diagramas").click()`);
    await quietos();
    await pagina(elegir("Planta", ""));
    await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).diagramas === ${ESPERADO.diagramas}, 120000).catch(() => null);`);
    await quietos();
    // El punto del eje en la estación del máximo
    const ex = dMy.extremos.find((x) => x.que === "máximo")!;
    const k = dMy.piezas.findIndex((x) => x.id === ex.pieza);
    let q: [number, number, number] | null = null;
    for (let i = 0; i < dMy.ejePieza.length && !q; i++) {
      const [s0, s1] = [dMy.ejeS[2 * i]!, dMy.ejeS[2 * i + 1]!];
      if (dMy.ejePieza[i] !== k || ex.s < s0 - 1e-9 || ex.s > s1 + 1e-9) continue;
      const t = s1 > s0 ? (ex.s - s0) / (s1 - s0) : 0;
      q = [0, 1, 2].map((a) => dMy.origen[a]! + dMy.ejes[6 * i + a]! + t * (dMy.ejes[6 * i + 3 + a]! - dMy.ejes[6 * i + a]!)) as [number, number, number];
    }
    await pagina(`window.__largas = [];`);
    const d = await pagina<Dep>(`return await __i2.pasarSobre(0, ${q![0]}, ${q![1]}, ${q![2]});`);
    await captura("9-sonda-my");
    sondaIgual("de My", d, (o) => {
      if (o.tipo !== "barra") return null;
      const e = valor(estacionViga(ses, o.pieza!, "My", D, o.s!));
      if (e.rigida) return [`${o.pieza} · s = ${fmt(e.s, 2)} m`, "En un apoyo (zona rígida): sin esfuerzos de la barra"];
      // La primera línea de valores: la del lado derecho o, si salta, la del izquierdo
      const iguales = JSON.stringify(e.izquierda) === JSON.stringify(e.derecha);
      const x = iguales ? e.derecha! : e.izquierda!;
      return [`${o.pieza} · s = ${fmt(e.s, 2)} m`, `${iguales ? "" : "izq. "}My máx. ${fmt(x.max.v, 1)} kN·m · ${x.max.comb}`];
    }, [0, 1]);
    await largas("al pasar el ratón");
  }

  log("\n## Pilares por colores: N");
  {
    await pagina(`__i2.boton("Pilares").click()`);
    await quietos();
    await pagina(`__i2.boton("3D").click()`);
    await pagina(`window.__largas = [];`);
    await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).pilares > 0, 120000);`);
    await quietos();
    await largas("al cargarlos");
    await captura("10-3d-pilares-n");
    const d = await pagina<Dep>(`return await __i2.dep(0);`);
    comprobar(d.pilares === ESPERADO.pilares, `tramos de pilar: ${d.pilares} = Node ${ESPERADO.pilares}`);
    fps("orbitar el 3D con los pilares", await orbitar());
    await largas("al orbitar");
    const ex = pilN.extremos[0]!;
    await pagina(`window.__largas = [];`);
    const h = await pagina<Dep>(`return await __i2.pasarSobre(0, ${ex.punto[0]}, ${ex.punto[1]}, ${ex.punto[2]});`);
    await captura("11-sonda-pilar");
    sondaIgual("de un tramo", h, (o) => {
      if (o.tipo !== "pilar") return null;
      const t = pilN.tramos[o.k!]!;
      return [`${t.pilar} · de ${t.plantaBase} a ${t.planta}`, `N ${fmt(t.valor, 1)} kN · ${t.comb}${t.donde ? ` (en la ${t.donde})` : ""}`];
    }, [0, 1]);
    await largas("al pasar el ratón");
  }

  log("\n## Reacciones");
  {
    await pagina(`__i2.boton("Reacciones").click()`);
    await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).reacciones > 0, 120000);`);
    await quietos();
    await captura("12-3d-reacciones");
    const d = await pagina<Dep>(`return await __i2.dep(0);`);
    comprobar(d.reacciones === ESPERADO.reacciones, `segmentos de las flechas: ${d.reacciones} = Node ${ESPERADO.reacciones}`);
    fps("orbitar el 3D con las reacciones", await orbitar());
    await largas("al orbitar");
    // La punta de la mayor
    const ex = reac.extremos[0]!;
    const o = reac.objetos.find((x) => x.id === ex.id)!;
    const k = reac.escala.m / reac.escala.valor;
    await pagina(`window.__largas = [];`);
    const h = await pagina<Dep>(`return await __i2.pasarSobre(0, ${o.punto[0]}, ${o.punto[1]}, ${o.punto[2] - 0.5 * o.R[2]! * k});`);
    await captura("13-sonda-reaccion");
    sondaIgual("de una flecha", h, (x) => {
      if (x.tipo !== "reaccion") return null;
      const r = reac.objetos[x.k!]!;
      return [`${r.id} · ${r.tipo} · ${r.comb}`, `Fz ${fmt(r.R[2], 1)} kN · Fx ${fmt(r.R[0], 1)} · Fy ${fmt(r.R[1], 1)}`, `Mx ${fmt(r.R[3], 1)} · My ${fmt(r.R[4], 1)} · Mz ${fmt(r.R[5], 1)} kN·m`];
    }, [0, 1, 2]);
    await largas("al pasar el ratón");
  }

  log("\n## Deformada animada");
  {
    await pagina(`__i2.boton("Deformada").click()`);
    await pagina(`await __i2.esperar(() => __i2.boton("Animar"), 60000);`);
    await quietos();
    await pagina(`__i2.boton("Animar").click()`);
    await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).animada, 20000);`);
    await pagina(`await new Promise((r) => setTimeout(r, 800)); window.__largas = [];`);
    await captura("14-deformada-animada");
    fps("orbitar el 3D con la deformada animada", await orbitar());
    await largas("animando y orbitando");
    await pagina(`__i2.boton("Parar").click()`);
  }

  log("\n## Muros: F22 del núcleo");
  {
    await abrir("nucleo", 1920, 1080);
    await pagina(`__i2.boton("Resultados", document.querySelector("nav")).click()`);
    await pagina(`await __i2.esperar(() => __i2.boton("Losas")); __i2.boton("Losas").click()`);
    await quietos();
    await pagina(`__i2.boton("3D").click()`);
    await pagina(`await __i2.esperar(() => document.querySelector('.celda[data-vista="0"] select[aria-label="Superficies del mapa"]'), 60000);`);
    await pagina(`__i2.boton("F22").click()`);
    await pagina(elegir("Superficies del mapa", "muros"));
    await pagina(elegir("Planta", ""));
    await pagina(`await __i2.esperar(async () => (await __i2.dep(0)).isovalores === ${ESPERADO.muros}, 120000).catch(() => null);`);
    await quietos();
    await captura("15-3d-f22-muros");
    const d = await pagina<Dep>(`return await __i2.dep(0);`);
    comprobar(d.isovalores === ESPERADO.muros, `triángulos de las bandas de los muros: ${d.isovalores} = Node ${ESPERADO.muros}`);
    fps("orbitar el 3D con los muros", await orbitar());
    await largas("al orbitar");
  }
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
