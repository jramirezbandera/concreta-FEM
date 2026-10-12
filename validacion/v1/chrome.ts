/**
 * Banco de V1 en Chrome de verdad (`docs/fem3d/visor.md` §3.3, criterios 2 a 5):
 *
 *   node validacion/v1/chrome.ts          escribe validacion/v1/out_chrome.txt
 *
 * Compila el visor (`vite build`), lo sirve junto con copias de los proyectos de ejemplo (que el banco
 * cambia en disco) y lo maneja con Chrome headless (perfil temporal, sin tocar la sesión del usuario)
 * por el protocolo de depuración, sin dependencias. El visor abre cada proyecto por URL
 * (`?proyecto=/p/<n>/proyecto.json`), que vigila igual que una carpeta.
 *
 * - 2: el sha256 de los resultados calculados en Chrome es el de `fem calcular` (en Node); abrir con
 *   los de `.fem/` da ese mismo sha256.
 * - 3: un `resultados.bin` alterado no se usa: se recalcula y se dice por qué.
 * - 4: en un recorrido del edificio objetivo (abrir, calcular, plantas, magnitudes, combinaciones, el
 *   cursor de una viga, girar el 3D…) ninguna tarea larga del hilo principal (PerformanceObserver,
 *   «longtask», > 50 ms); los cambios de planta, magnitud y combinación, ≤ 0,5 s; abrir con `.fem/`,
 *   ≤ 2 s; abrir y calcular, el cálculo más ≤ 1 s.
 * - 5: al cambiar el fichero en disco, el visor lo ve en ≤ 2 s y conserva planta, pantalla y selección.
 */
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { ejecutar } from "../../cli/ordenes.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PUERTO = 8775;
const PUERTO_CDP = 9335;
const PROYECTOS: [string, string][] = [
  ["ejemplo", ".claude/skills/fem/ejemplo.json"],
  ["1022", "validacion/a2/agente/1022/proyecto.json"],
  ["nucleo", "validacion/a2/agente/nucleo/proyecto.json"],
  ["edificio", "validacion/a2/agente/edificio/proyecto.json"],
];
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

// ─── 1. El visor compilado y los proyectos ──────────────────────────────────────────────────────

execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
const datos = mkdtempSync(join(tmpdir(), "v1-proyectos-"));
const copiar = (nombre: string, ruta: string) => {
  const d = join(datos, nombre);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  copyFileSync(join(RAIZ, ruta), join(d, "proyecto.json"));
  return join(d, "proyecto.json");
};

const TIPOS: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2", ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml" };
const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const ruta = decodeURIComponent(url.pathname);
  const fichero = ruta.startsWith("/p/") ? normalize(join(datos, ruta.slice(3))) : normalize(join(DIST, ruta === "/" ? "index.html" : ruta));
  if (!(fichero.startsWith(datos) || fichero.startsWith(DIST)) || !existsSync(fichero) || !statSync(fichero).isFile()) {
    // Como el servidor del visor (app/visor.ts): un HEAD de lo que no existe, 204 con «x-existe: no»
    res.writeHead(req.method === "HEAD" ? 204 : 404, req.method === "HEAD" ? { "x-existe": "no" } : {}).end();
    return;
  }
  const st = statSync(fichero);
  res.writeHead(200, { "content-type": TIPOS[extname(fichero)] ?? "application/octet-stream", "cache-control": "no-store", etag: `"${st.mtimeMs}-${st.size}"`, "content-length": st.size });
  res.end(req.method === "HEAD" ? undefined : readFileSync(fichero));
});
await new Promise<void>((r) => servidor.listen(PUERTO, "127.0.0.1", r));

// ─── 2. Chrome y su protocolo de depuración ─────────────────────────────────────────────────────

const perfil = mkdtempSync(join(tmpdir(), "v1-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${perfil}`, "--window-size=1440,900", "about:blank"], { stdio: "ignore" });
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
/** Evalúa una expresión (asíncrona) en la página y devuelve su valor. */
async function pagina<T>(expr: string): Promise<T> {
  const r = (await cdp("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })) as { result: { value: T }; exceptionDetails?: { exception?: { description?: string }; text: string } };
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

// Ayudas de la página: tareas largas desde el primer momento, esperas y clics por texto
const AYUDAS = `
window.__largas = [];
new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__largas.push({ t: e.startTime, ms: e.duration }); }).observe({ type: "longtask", buffered: true });
window.__v1 = {
  esperar: async (f, ms = 120000) => { const t0 = performance.now(); for (;;) { const v = f(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("tiempo agotado: " + f); await new Promise((r) => setTimeout(r, 15)); } },
  estado: () => document.querySelector("[data-estado]")?.dataset.estado ?? null,
  huella: () => document.querySelector("[data-estado]")?.dataset.huella ?? null,
  sha: () => document.querySelector("[data-sha]")?.dataset.sha ?? null,
  origen: () => document.querySelector("[data-sha]")?.dataset.origen ?? null,
  pie: () => document.querySelector("footer")?.innerText ?? "",
  boton: (texto, raiz = document) => [...raiz.querySelectorAll("button")].find((b) => b.textContent.trim() === texto || b.textContent.trim().startsWith(texto + " ")),
  quietos: () => [...document.querySelectorAll(".lienzo[data-cargando]")].every((x) => x.dataset.cargando === "false"),
};`;
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: AYUDAS });
await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

async function abrir(nombre: string): Promise<{ ms: number }> {
  const cargada = new Promise<void>((r) => (alCargar = r));
  await cdp("Page.navigate", { url: `http://127.0.0.1:${PUERTO}/?proyecto=/p/${nombre}/proyecto.json` });
  await cargada;
  return pagina<{ ms: number }>(`await __v1.esperar(() => __v1.estado() === "calculado"); return { ms: performance.now() };`);
}

/** Pulsa y espera a que los lienzos estén quietos con `cond` cierta; devuelve los ms. */
const accion = (js: string, cond = "true") => pagina<number>(`const t0 = performance.now(); ${js}; await new Promise((r) => requestAnimationFrame(() => r())); await __v1.esperar(() => __v1.quietos() && (${cond})); return performance.now() - t0;`);

try {
  // ─── Criterios 2 y 3 ──────────────────────────────────────────────────────────────────────────
  log("## Criterios 2 y 3: los bits de la CLI y los resultados guardados");
  const tiempos: Record<string, { calculo: number; abrirCalcular: number; abrirFem: number }> = {};
  for (const [nombre, ruta] of PROYECTOS) {
    const p = copiar(nombre, ruta);
    const a = await abrir(nombre);
    const shaChrome = await pagina<string>(`return __v1.sha();`);
    const pie = await pagina<string>(`return __v1.pie();`);
    // «El cálculo» es lo que hace `fem calcular`: compilar y calcular (los dos en el worker)
    const calculo = Number(/compilado en ([\d.]+) s/.exec(pie)?.[1] ?? NaN) + Number(/calculado en el visor en ([\d.]+) s/.exec(pie)?.[1] ?? NaN);
    const c = await ejecutar(["calcular", p]);
    const cab = JSON.parse(readFileSync(join(datos, nombre, ".fem", String(c.json.huella), "resultados.json"), "utf8")) as { sha256: string };
    comprobar(shaChrome === cab.sha256, `${nombre}: sha256 en Chrome ${shaChrome?.slice(0, 16)} = fem calcular ${cab.sha256.slice(0, 16)}`);
    const b = await abrir(nombre);
    const [shaFem, origen] = await pagina<[string, string]>(`return [__v1.sha(), __v1.origen()];`);
    comprobar(shaFem === cab.sha256 && origen === "guardados", `${nombre}: abierto con .fem/ (${origen}), mismo sha256`);
    tiempos[nombre] = { calculo, abrirCalcular: a.ms / 1000, abrirFem: b.ms / 1000 };
  }
  // Un resultados.bin alterado
  const pa = copiar("alterado", "validacion/a2/agente/nucleo/proyecto.json");
  const ca = await ejecutar(["calcular", pa]);
  const bin = join(datos, "alterado", ".fem", String(ca.json.huella), "resultados.bin");
  const bytes = readFileSync(bin);
  bytes[bytes.length >> 1] ^= 1;
  writeFileSync(bin, bytes);
  await abrir("alterado");
  const [origenA, pieA] = await pagina<[string, string]>(`return [__v1.origen(), __v1.pie()];`);
  comprobar(origenA === "calculo" && pieA.includes("no es el que se guardó"), `alterado: no se usa y se dice por qué («${/\.fem no se usó: [^·\n]*/.exec(pieA)?.[0] ?? pieA}»)`);

  // ─── Criterio 4 ───────────────────────────────────────────────────────────────────────────────
  log("\n## Criterio 4: fluidez en el edificio objetivo");
  for (const [n, t] of Object.entries(tiempos)) log(`${n}: abrir y calcular ${t.abrirCalcular.toFixed(2)} s (compilar y calcular en el worker ${t.calculo.toFixed(2)} s, resto ${(t.abrirCalcular - t.calculo).toFixed(2)} s); abrir con .fem ${t.abrirFem.toFixed(2)} s`);
  const te = tiempos.edificio!;
  comprobar(te.abrirFem <= 2, `abrir con .fem/ ${te.abrirFem.toFixed(2)} s ≤ 2 s`);
  comprobar(te.abrirCalcular - te.calculo <= 1, `abrir y calcular: el cálculo (${te.calculo.toFixed(2)} s) más ${(te.abrirCalcular - te.calculo).toFixed(2)} s ≤ 1 s`);

  // El recorrido: se abre calculando (sin .fem) y se cuentan las tareas largas desde la navegación
  rmSync(join(datos, "edificio", ".fem"), { recursive: true, force: true });
  await abrir("edificio");
  const cambios: [string, number][] = [];
  const pasos: [string, number][] = [];
  const medir = async (que: string, js: string, cond = "true") => {
    pasos.push([que, await pagina<number>(`return performance.now();`)]);
    cambios.push([que, await accion(js, cond)]);
  };
  const planta = (id: string) => `[...document.querySelectorAll('[role=option]')].find((b) => b.firstChild.textContent === "${id}").click()`;
  // Desde I1 (docs/fem3d/interfaz.md §13), las pantallas de resultados de V1 son modos de Resultados
  const MODO: Record<string, string> = { Losas: "Losas", Vigas: "Diagramas", Pilares: "Pilares", Desplomes: "Deformada" };
  const pantalla = (n: string) =>
    MODO[n]
      ? `__v1.boton("Resultados", document.querySelector("nav")).click(); await __v1.esperar(() => __v1.boton("${MODO[n]}", document.querySelector("[role=toolbar]"))); __v1.boton("${MODO[n]}", document.querySelector("[role=toolbar]")).click()`
      : `__v1.boton("${n}", document.querySelector("nav")).click()`;
  await medir("planta N3 (modelo)", planta("N3"));
  await medir("planta N5 (modelo)", planta("N5"));
  await medir("vista cargas", `__v1.boton("Cargas").click()`);
  await medir("vista malla", `__v1.boton("Modelo", document.querySelector("nav")).click(); await __v1.esperar(() => __v1.boton("Malla")); __v1.boton("Malla").click()`);
  await medir("pantalla losas", pantalla("Losas"));
  await medir("magnitud M11", `__v1.boton("M11").click()`);
  await medir("magnitud M22", `__v1.boton("M22").click()`);
  await medir("planta N2 (losas)", planta("N2"));
  const elegirComb = (i: number) => `const s = document.querySelector("select"); const o = s.options[${i}]; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, o.value); s.dispatchEvent(new Event("change", { bubbles: true }))`;
  await medir("combinación: un caso (losas)", elegirComb(-1).replace("[-1]", "[s.options.length - 1]"));
  await medir("combinación: por defecto (losas)", elegirComb(0));
  await medir("clic en el mapa (valor del punto)", `const s = document.querySelector(".celda-superficie"); const r = s.getBoundingClientRect(); for (const t of ["pointerdown", "pointerup"]) s.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: t === "pointerup" ? 0 : 1, clientX: r.left + r.width * 0.4, clientY: r.top + r.height * 0.5 }))`, `document.querySelector("[data-valor-punto]")`);
  await medir("pantalla vigas", pantalla("Vigas"));
  await medir("otra viga", `[...document.querySelectorAll(".lista-fila")].filter((b) => !b.getAttribute("role"))[3].click()`);
  await medir("esfuerzo Vz", `__v1.boton("Vz").click()`);
  // El cursor de la viga: 30 movimientos seguidos
  pasos.push(["cursor de la viga", await pagina<number>(`return performance.now();`)]);
  cambios.push([
    "cursor de la viga (30 pasos)",
    await pagina<number>(`const t0 = performance.now(); const r = document.querySelector("#estacion"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; for (let i = 1; i <= 30; i++) { set.call(r, String(Number(r.max) * i / 31)); r.dispatchEvent(new Event("input", { bubbles: true })); await new Promise((x) => requestAnimationFrame(() => x())); } await new Promise((x) => setTimeout(x, 200)); return performance.now() - t0;`),
  ]);
  await medir("pantalla pilares", pantalla("Pilares"));
  await medir("planta N1 (pilares)", planta("N1"));
  await medir("elegir un pilar", `document.querySelectorAll("tr.clic")[5].click()`);
  const girar = `const c = document.querySelector('.celda[data-tipo="3d"] .celda-superficie'); const r = c.getBoundingClientRect(); const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 1, pointerType: "mouse", button: 1, buttons: t === "pointerup" ? 0 : 4, shiftKey: true, clientX: r.left + x, clientY: r.top + y })); ev("pointerdown", 300, 300); for (let i = 0; i < 40; i++) { ev("pointermove", 300 + i * 6, 300 + i * 2); await new Promise((x) => requestAnimationFrame(() => x())); } ev("pointerup", 540, 380);`;
  await medir("pantalla desplomes (3D y deformada)", pantalla("Desplomes"), `document.querySelector('.celda[data-tipo="3d"]')`);
  pasos.push(["girar el 3D", await pagina<number>(`return performance.now();`)]);
  cambios.push(["girar el 3D (40 pasos)", await pagina<number>(`const t0 = performance.now(); ${girar} return performance.now() - t0;`)]);
  await medir("pantalla revisión", pantalla("Revisión"), `document.querySelector("article")`);
  await medir("pantalla modelo", pantalla("Modelo"));
  await medir("3D del modelo", `__v1.boton("3D").click()`, `document.querySelector('.celda[data-tipo="3d"]')`);
  cambios.push(["girar el 3D del modelo (40 pasos)", await pagina<number>(`const t0 = performance.now(); ${girar} return performance.now() - t0;`)]);
  for (const [que, ms] of cambios) log(`  ${que}: ${ms.toFixed(0)} ms`);
  const limite = new Set(["planta N3 (modelo)", "planta N5 (modelo)", "magnitud M11", "magnitud M22", "planta N2 (losas)", "combinación: un caso (losas)", "combinación: por defecto (losas)", "planta N1 (pilares)"]);
  for (const [que, ms] of cambios.filter(([q]) => limite.has(q))) comprobar(ms <= 500, `${que}: ${ms.toFixed(0)} ms ≤ 500 ms`);
  const largas = await pagina<{ t: number; ms: number }[]>(`return window.__largas;`);
  const paso = (t: number) => [...pasos].reverse().find(([, t0]) => t0 <= t)?.[0] ?? "abrir y calcular";
  log(`Tareas largas del hilo principal en todo el recorrido (desde la navegación): ${largas.length}${largas.length ? ` (${largas.map((x) => `${x.ms.toFixed(0)} ms a los ${(x.t / 1000).toFixed(2)} s, en «${paso(x.t)}»`).join("; ")})` : ""}`);
  comprobar(largas.length === 0, "ninguna tarea larga (> 50 ms) en el hilo principal");

  // ─── Criterio 5 ───────────────────────────────────────────────────────────────────────────────
  log("\n## Criterio 5: recarga al cambiar el fichero");
  const pr = copiar("recarga", "validacion/a2/agente/edificio/proyecto.json");
  await abrir("recarga");
  const huella0 = await pagina<string>(`return __v1.huella();`);
  await accion(pantalla("Pilares"));
  await accion(planta("N3"));
  await accion(`document.querySelectorAll("tr.clic")[3].click()`);
  const elegido = await pagina<string>(`return document.querySelector("tr.clic[data-on=true] td").firstChild.textContent;`);
  // El cambio: una carga un 10 % mayor, como lo haría el agente
  const p = JSON.parse(readFileSync(pr, "utf8")) as { modelo: { cargas: { q: number[] }[] } };
  const carga = p.modelo.cargas[0]!;
  carga.q = carga.q.map((x) => x * 1.1);
  await pagina(`window.__t0 = performance.now();`);
  writeFileSync(pr, JSON.stringify(p, null, 2));
  const visto = await pagina<number>(`await __v1.esperar(() => __v1.estado() === "desactualizado", 10000); return performance.now() - window.__t0;`);
  const recargado = await pagina<number>(`await __v1.esperar(() => __v1.estado() === "calculado" && __v1.huella() !== "${huella0}"); await __v1.esperar(() => __v1.quietos() && document.querySelector("tr.clic")); return performance.now() - window.__t0;`);
  comprobar(visto <= 2000, `cambio visto en ${visto.toFixed(0)} ms ≤ 2 s (recalculado en ${recargado.toFixed(0)} ms)`);
  const [pant, plantaSel, sel] = await pagina<[string, string, string | null]>(`return [document.querySelector("nav [aria-current=page]").textContent, document.querySelector("[role=option][aria-selected=true]").firstChild.textContent, document.querySelector("tr.clic[data-on=true] td")?.firstChild.textContent ?? null];`);
  const modo = await pagina<string | null>(`return document.querySelector("[role=toolbar] .herr[data-on=true]")?.textContent ?? null;`);
  comprobar(pant === "Resultados" && modo === "Pilares" && plantaSel === "N3" && sel === elegido, `conserva espacio y modo (${pant} · ${modo}), planta (${plantaSel}) y selección (${sel}, era ${elegido})`);
} finally {
  const ua = (await cdp("Browser.getVersion").catch(() => ({ product: "?" }))) as { product: string };
  ws.close();
  chrome.kill();
  servidor.close();
  rmSync(datos, { recursive: true, force: true });
  try {
    rmSync(perfil, { recursive: true, force: true });
  } catch {
    // Chrome aún suelta el perfil
  }
  const cabecera = `# validacion/v1/chrome.ts — ${new Date().toISOString().slice(0, 10)}, Ryzen 9 5900X, Windows 11; ${ua.product} headless; ${fallos ? `${fallos} FALLOS` : "todo BIEN"}`;
  writeFileSync(join(import.meta.dirname, "out_chrome.txt"), [cabecera, ...salida].join("\n") + "\n");
  process.exitCode = fallos ? 1 : 0;
}
