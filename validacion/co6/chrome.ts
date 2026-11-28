/**
 * Banco de Resultados · Comprobación en Chrome de verdad (CO6, criterio 15 de
 * `docs/fem3d/comprobaciones.md`: en la app, lo de Node):
 *
 *   node validacion/co6/chrome.ts          escribe validacion/co6/out_chrome.txt
 *   CAPTURAS=<carpeta> node …               y las capturas de cada paso
 *   SIN_COMPILAR=1 node …                   con el `app/dist` que haya
 *
 * Con la vivienda de `ejemplos/vivienda` (dos cubiertas reticulares, vigas planas, 23 pilares):
 *
 * - sin armado, ningún tramo cumple;
 * - «Toda la obra» propone y escribe el armado: guardado, el proyecto es el de `datosArmar` en Node
 *   con la operación `armado`, byte a byte;
 * - las tablas de pilares, vigas, losas y punzonamiento son las de `datosComprobaciones` en Node:
 *   pieza, armado y estado idénticos, y el aprovechamiento a la centésima que se enseña;
 * - la ficha de una parte tiene las filas del módulo; cambiarle los cercos y aplicar la deja sin
 *   cumplir sin recalcular (la huella no cambia), y deshacer la devuelve;
 * - sin tareas largas en el hilo principal.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import type { ArmadoProyecto } from "../../src/agente/armaduraBase.ts";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import { sha256 } from "../../src/compilador/huella.ts";
import { aplicar } from "../../src/editor/operaciones.ts";
import { serializar } from "../../src/editor/serializar.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { claseAprovechamiento, datosArmar, datosComprobacion, datosComprobaciones, TEXTO_CLASE, TIPOS_COMPROBACION, type ParteComprobada, type TipoComprobacion } from "../../src/visor/comprobaciones.ts";
import { Sesion } from "../../src/visor/sesion.ts";
import { manejadorCarpeta } from "../../app/servidor.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CAPTURAS = process.env.CAPTURAS;
const PUERTO = 8797;
const PUERTO_CDP = 9357;
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

// ─── 0. El proyecto: la vivienda, sin armado en barras ──────────────────────────────────────────

const leida = leerProyecto(readFileSync(join(RAIZ, "ejemplos", "vivienda", "proyecto.json"), "utf8"));
if (!leida.valido) throw new Error("la vivienda no se lee");
const { pilares: _p, vigas: _v, forjados: _f, punzonamiento: _z, ...resto } = (leida.proyecto.armado ?? {}) as ArmadoProyecto & Record<string, unknown>;
const partida = aplicar(leida.proyecto, { op: "armado", armado: Object.keys(resto).length ? (resto as ArmadoProyecto) : null });
if (!partida.ok) throw new Error("la vivienda sin armado no vale");
const proyecto = partida.proyecto;

// ─── 1. La app compilada y el proyecto ──────────────────────────────────────────────────────────

if (!process.env.SIN_COMPILAR) execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
const datos = mkdtempSync(join(tmpdir(), "co6-proyectos-"));
mkdirSync(join(datos, "co6"), { recursive: true });
const FICHERO = join(datos, "co6", "proyecto.json");
writeFileSync(FICHERO, serializar(proyecto));

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

const perfil = mkdtempSync(join(tmpdir(), "co6-chrome-"));
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
  esperar: async (f, ms = 180000) => { const t0 = performance.now(); for (;;) { const v = await f(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("tiempo agotado: " + f); await new Promise((r) => setTimeout(r, 10)); } },
  estado: () => document.querySelector("[data-estado]")?.dataset.estado ?? null,
  huella: () => document.querySelector("[data-estado]")?.dataset.huella ?? null,
  boton: (texto) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === texto),
  tipo: (nombre) => [...document.querySelectorAll('[aria-label="Qué se comprueba"] button')].find((b) => b.textContent.trim() === nombre),
  filas: () => [...document.querySelectorAll("[data-tabla-comprobacion] tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.firstChild?.textContent ?? "")),
  resumen: () => document.querySelector("[data-resumen-comprobacion]")?.textContent ?? "",
  fotograma: () => new Promise((r) => requestAnimationFrame(() => r())),
  poner: (el, valor) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, valor); el.dispatchEvent(new Event("input", { bubbles: true })); },
};`;
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: AYUDAS });
await cdp("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

async function captura(nombre: string): Promise<void> {
  if (!CAPTURAS) return;
  mkdirSync(CAPTURAS, { recursive: true });
  await pagina(`await new Promise((r) => setTimeout(r, 300));`);
  const r = (await cdp("Page.captureScreenshot", { format: "png" })) as { data: string };
  writeFileSync(join(CAPTURAS, `${nombre}.png`), Buffer.from(r.data, "base64"));
}
const guardar = () => pagina(`document.querySelector("button[data-sin-guardar=true]").click(); await __c.esperar(() => document.querySelector("button[data-sin-guardar=false]") && !/Guardando/.test(document.body.textContent), 10000);`);
const largasDesde = (t: number) => pagina<{ t: number; ms: number }[]>(`return __largas.filter((x) => x.t >= ${t});`);
const ahora = () => pagina<number>(`return performance.now();`);

/** El estado de una parte, como lo dice la tabla. */
const estadoDe = (p: ParteComprobada) => (p.origen === "sin-armado" ? "Sin armado" : p.cumple ? "Cumple" : !p.fallan && p.pendientes.length ? "Sin comprobar" : "No cumple");
const NOMBRE: Record<TipoComprobacion, string> = { pilares: "Pilares", vigas: "Vigas", losas: "Losas", punzonamiento: "Punzonamiento" };
const armadoDe = (tipo: TipoComprobacion, a: ArmadoProyecto | undefined): ArmadoProyecto | undefined =>
  tipo === "pilares" ? (a?.pilares ? { pilares: a.pilares } : undefined) : tipo === "vigas" ? (a?.vigas ? { vigas: a.vigas } : undefined) : tipo === "losas" ? (a?.forjados ? { forjados: a.forjados } : undefined) : { ...(a?.forjados ? { forjados: a.forjados } : {}), ...(a?.punzonamiento ? { punzonamiento: a.punzonamiento } : {}) };

try {
  // ─── En Node, la misma sesión ────────────────────────────────────────────────────────────────
  const wasm = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
  await iniciarNucleo(wasm);
  const sa = Sesion.abrir(serializar(proyecto), sha256(new Uint8Array(wasm)));
  if (!sa.valido) throw new Error("no abre en Node");
  if (!(await sa.sesion.calcular()).ok) throw new Error("no calcula en Node");
  const s = sa.sesion;

  const cargada = new Promise<void>((r) => (alCargar = r));
  await cdp("Page.navigate", { url: `http://127.0.0.1:${PUERTO}/?proyecto=/p/co6/proyecto.json` });
  await cargada;
  await pagina(`await __c.esperar(() => __c.estado() === "calculado");`);
  const huella = await pagina<string>(`return __c.huella();`);
  comprobar(huella === s.huella, `la vivienda, calculada en Chrome con la huella de Node (${huella.slice(0, 12)})`);

  // ─── Sin armado ──────────────────────────────────────────────────────────────────────────────
  log("\n## Resultados · Comprobación, sin armado");
  // PENDIENTE (§8.14): Comprobación es ya un espacio propio y propone solo lo que falta al entrar; este
  // banco se escribió para el modo de Resultados sin propuesta automática y no se ha vuelto a pasar
  await pagina(`__c.boton("Comprobación").click(); await __c.esperar(() => __c.filas().length);`);
  const sin = datosComprobaciones(s, "pilares", undefined);
  if (!sin.valido) throw new Error("no comprueba en Node");
  const filasSin = await pagina<string[][]>(`return __c.filas();`);
  comprobar(filasSin.length === sin.valor.partes.length && filasSin.every((f) => f.at(-1) === "Sin armado"), `${filasSin.length} tramos de pilar, todos «Sin armado» (${await pagina<string>(`return __c.resumen();`)})`);
  await captura("1-sin-armado");

  // ─── «Toda la obra» ──────────────────────────────────────────────────────────────────────────
  log("\n## «Toda la obra»: el armado de las tablas en lo que falta");
  const t0 = await ahora();
  const ms = await pagina<number>(`const t0 = performance.now(); __c.boton("Toda la obra").click(); await __c.esperar(() => document.querySelector("[data-propuesta]")); return performance.now() - t0;`);
  const propuesta = await pagina<string>(`return document.querySelector("[data-propuesta]").textContent;`);
  log(`  ${propuesta.trim()}`);
  log(`  (información: ${(ms / 1000).toFixed(1)} s en el worker)`);
  const an = datosArmar(s, { tipos: TIPOS_COMPROBACION, ...(proyecto.armado ? { armado: proyecto.armado } : {}), soloSinArmado: true });
  if (!an.valido) throw new Error("no propone en Node");
  const esperado = aplicar(proyecto, { op: "armado", armado: an.valor.armado });
  if (!esperado.ok) throw new Error("lo propuesto en Node no vale");
  await guardar();
  const guardado = readFileSync(FICHERO, "utf8");
  comprobar(guardado === serializar(esperado.proyecto), `guardado, el proyecto es el de \`datosArmar\` en Node con la operación \`armado\`, byte a byte (${Object.keys(an.valor.armado.pilares ?? {}).length} pilares, ${Object.keys(an.valor.armado.vigas ?? {}).length} vigas, ${Object.keys(an.valor.armado.forjados ?? {}).length} losas, ${Object.keys(an.valor.armado.punzonamiento ?? {}).length} pilares con armadura de punzonamiento)`);
  comprobar((await pagina<string>(`return __c.huella();`)) === huella && (await pagina<string>(`return __c.estado();`)) === "calculado", "el armado no cambia la huella: sigue calculado, sin recalcular");
  const armado = esperado.proyecto.armado;

  // ─── Las cuatro tablas ───────────────────────────────────────────────────────────────────────
  log("\n## Las tablas, frente a Node");
  for (const tipo of TIPOS_COMPROBACION) {
    const n = datosComprobaciones(s, tipo, armadoDe(tipo, armado));
    if (!n.valido) throw new Error(`no comprueba ${tipo} en Node`);
    const partes = n.valor.partes;
    const ms2 = await pagina<number>(`const t0 = performance.now(); __c.tipo(${JSON.stringify(NOMBRE[tipo])}).click(); await __c.esperar(() => { const f = __c.filas(); return ${partes.length} === 0 ? !document.querySelector("[data-tabla-comprobacion]") && /No hay|Ninguna/.test(document.body.textContent) : f.length === ${partes.length} && f[0][0] === ${JSON.stringify(partes[0]?.pieza ?? "")} && !/comprobando/.test(__c.resumen()); }); return performance.now() - t0;`);
    const filas = await pagina<string[][]>(`return __c.filas();`);
    const col = tipo === "punzonamiento" ? 2 : 3;
    const difieren: string[] = [];
    let mayor = 0;
    filas.forEach((f, i) => {
      const p = partes[i]!;
      const u = f[col + 1] === "—" ? null : Number(f[col + 1]!.replace(",", "."));
      const du = u === null || p.aprovechamiento === null ? (u === p.aprovechamiento ? 0 : Infinity) : Math.abs(u - p.aprovechamiento);
      mayor = Math.max(mayor, du);
      // UI2-26: en la tabla, «—» en el armado de lo que no se comprueba (lo dice su estado)
      const texto = p.origen === "no-aplica" ? "—" : (p.texto ?? "—");
      if (f[0] !== p.pieza || f[col] !== texto || f.at(-1) !== estadoDe(p) || du > 0.0051) difieren.push(`${p.clave}: «${f[col]}» ${f[col + 1]} ${f.at(-1)} / «${texto}» ${p.aprovechamiento} ${estadoDe(p)}`);
    });
    comprobar(filas.length === partes.length && !difieren.length, `${NOMBRE[tipo]}: ${filas.length} filas, las de Node (pieza, armado y estado idénticos; el aprovechamiento, a ${mayor.toExponential(1)} de lo que se enseña); ${n.valor.resumen.cumplen} cumplen y ${n.valor.resumen.noCumplen} no${difieren.length ? `\n    ${difieren.slice(0, 5).join("\n    ")}` : ""} · ${(ms2 / 1000).toFixed(2)} s`);
    // CO6-d: la planta, con la leyenda del aprovechamiento
    const leyenda = await pagina<string>(`await __c.esperar(() => /Aprovechamiento/.test(document.querySelector(".celda")?.textContent ?? "") && [...document.querySelectorAll(".lienzo[data-cargando]")].every((x) => x.dataset.cargando === "false")); return document.querySelector(".celda").textContent;`);
    // Las clases de lo que hay en la planta de la vista (la leyenda sólo lista las que se ven)
    const enPlanta = await pagina<string>(`return document.querySelector('.celda[data-vista="0"] select[aria-label="Planta"]')?.value ?? "";`);
    const suyas = partes.filter((p) => (tipo === "vigas" ? proyecto.modelo.vigas?.find((v) => v.id === p.pieza)?.planta : p.planta) === enPlanta);
    const clases = [...new Set(suyas.map((p) => TEXTO_CLASE[claseAprovechamiento(p)]))];
    comprobar(/Aprovechamiento/.test(leyenda) && clases.every((c) => leyenda.includes(c)), `${NOMBRE[tipo]}: la planta ${enPlanta}, por colores, con «${clases.join("», «")}» en la leyenda (${suyas.length} partes en ella)`);
    await captura(`2-${tipo}`);
  }

  // ─── La ficha ────────────────────────────────────────────────────────────────────────────────
  log("\n## La ficha de un tramo de pilar");
  await pagina(`__c.tipo("Pilares").click(); await __c.esperar(() => __c.filas().length && !/comprobando/.test(__c.resumen()));`);
  const np = datosComprobaciones(s, "pilares", armadoDe("pilares", armado));
  if (!np.valido) throw new Error("no comprueba en Node");
  const parte = np.valor.partes.find((p) => p.cumple) ?? np.valor.partes[0]!;
  const k = np.valor.partes.indexOf(parte);
  const fn = datosComprobacion(s, "pilares", parte.clave, armadoDe("pilares", armado));
  if (!fn.valido) throw new Error("no hay ficha en Node");
  const tF = await ahora();
  const nFilas = await pagina<number>(`document.querySelectorAll("[data-tabla-comprobacion] tbody tr")[${k}].click(); await __c.esperar(() => document.querySelector("[data-filas-modulo]")); return document.querySelectorAll("[data-filas-modulo] tbody tr").length;`);
  comprobar(nFilas === fn.valor.filas.length && (await pagina<string>(`return document.querySelector("[data-estado-ficha]").textContent;`)) === estadoDe(parte), `${parte.clave}: ${nFilas} filas del módulo, las de Node; «${estadoDe(parte)}»`);
  await captura("3-ficha");
  // Los cercos, a 400 mm
  await pagina(`__c.poner(document.querySelector('[aria-label="Cercos: cada (mm)"]'), "400"); await __c.fotograma(); __c.boton("Aplicar").click(); await __c.esperar(() => document.querySelector("[data-estado-ficha]").textContent === "No cumple");`);
  const trasCambio = await pagina<{ fila: string; huella: string; estado: string }>(`await __c.esperar(() => __c.filas()[${k}].at(-1) === "No cumple"); return { fila: __c.filas()[${k}].at(-1), huella: __c.huella(), estado: __c.estado() };`);
  comprobar(trasCambio.huella === huella && trasCambio.estado === "calculado", `con los cercos cada 400 mm deja de cumplir, en la ficha y en la tabla, sin recalcular`);
  await captura("4-no-cumple");
  await pagina(`[...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Deshacer" || b.textContent.trim() === "Deshacer").click(); await __c.esperar(() => __c.filas()[${k}].at(-1) === ${JSON.stringify(estadoDe(parte))});`);
  // Deshecho, el proyecto vuelve a ser el guardado: la app ya no lo da por cambiado
  const sinCambios = await pagina<boolean>(`await __c.fotograma(); return !!document.querySelector("button[data-sin-guardar=false]");`);
  comprobar(sinCambios && readFileSync(FICHERO, "utf8") === guardado, "deshecho, el proyecto es otra vez el guardado (sin cambios que guardar)");
  const largas = (await largasDesde(t0)).filter((x) => x.ms > 50);
  const enFicha = largas.filter((x) => x.t >= tF);
  comprobar(!largas.length, `sin tareas largas en el hilo principal desde «Toda la obra» (${largas.map((x) => `${x.ms.toFixed(0)} ms`).join(", ") || "ninguna"}${enFicha.length ? `; ${enFicha.length} en la ficha` : ""})`);
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
