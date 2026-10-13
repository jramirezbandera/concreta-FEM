/**
 * Banco de la fase AB en Chrome de verdad (`docs/fem3d/armado.md` §4, criterios 2, 5, 6 y 7):
 *
 *   node validacion/ab/chrome.ts          escribe validacion/ab/out_chrome.txt
 *
 * Como el de F (`validacion/f/chrome.ts`): compila la app, la sirve con copias del edificio objetivo
 * de A2 (sin base y con la base común de 20 kN·m/m en X superior) y la maneja con Chrome headless por
 * el protocolo de depuración:
 * - el mapa de armado con base sale en ≤ 0,2 s más que sin ella, sin tareas largas;
 * - las zonas de refuerzo de la pestaña son las de Node bit a bit;
 * - un clic en la planta da el valor del punto de Node bit a bit en ≤ 50 ms;
 * - el 3D tiene los triángulos de Node y su sonda dice el valor del punto;
 * - cambiar la base en Propiedades no recalcula (misma huella, sin pasar por «calculando») y las
 *   zonas cambian a las de Node con la base nueva.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import type { ArmadoProyecto } from "../../src/agente/armaduraBase.ts";
import { leerProyecto, type Proyecto } from "../../src/agente/proyecto.ts";
import { sha256 } from "../../src/compilador/huella.ts";
import { serializar } from "../../src/editor/serializar.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { datosArmado } from "../../src/visor/franjas.ts";
import { Sesion } from "../../src/visor/sesion.ts";
import { manejadorCarpeta } from "../../app/servidor.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PUERTO = 8778;
const PUERTO_CDP = 9338;
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

// ─── 1. La app compilada y los proyectos ────────────────────────────────────────────────────────

execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
const datos = mkdtempSync(join(tmpdir(), "ab-proyectos-"));
const escribirProyecto = (nombre: string, p: Proyecto) => {
  const d = join(datos, nombre);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "proyecto.json"), serializar(p));
};
const a2 = leerProyecto(readFileSync(join(RAIZ, "validacion/a2/agente/edificio/proyecto.json"), "utf8"));
if (!a2.valido) throw new Error("el edificio de A2 no es válido");
const sinBase: Proyecto = a2.proyecto;
const BASE: ArmadoProyecto = { base: { "x-sup": 20 } };
const conBase: Proyecto = { ...sinBase, armado: BASE };
escribirProyecto("sin-base", sinBase);
escribirProyecto("con-base", conBase);

const TIPOS: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2", ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml", ".png": "image/png" };
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

const perfil = mkdtempSync(join(tmpdir(), "ab-chrome-"));
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
async function pagina<T>(expr: string): Promise<T> {
  const r = (await cdp("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })) as { result: { value: T }; exceptionDetails?: { exception?: { description?: string }; text: string } };
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

const AYUDAS = `
window.__largas = [];
window.__estados = [];
new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__largas.push({ t: e.startTime, ms: e.duration }); }).observe({ type: "longtask", buffered: true });
window.__ab = {
  esperar: async (f, ms = 180000) => { const t0 = performance.now(); for (;;) { let v = null; try { v = await f(); } catch { v = null; } if (v) return v; if (performance.now() - t0 > ms) throw new Error("tiempo agotado: " + f); await new Promise((r) => setTimeout(r, 5)); } },
  estado: () => document.querySelector("[data-estado]")?.dataset.estado ?? null,
  huella: () => document.querySelector("[data-estado]")?.dataset.huella ?? null,
  boton: (texto) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === texto || b.textContent.trim().startsWith(texto)),
  motor: () => window.__motorVistas,
  dep: (i) => window.__motorVistas.vista(i).depuracion(),
  sup: (i) => document.querySelector('.celda[data-vista="' + i + '"] .celda-superficie'),
  ev: (i, tipo, x, y) => { const s = __ab.sup(i); const r = s.getBoundingClientRect(); s.dispatchEvent(new PointerEvent(tipo, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: tipo === "pointerup" ? 0 : 1, clientX: r.left + x, clientY: r.top + y })); },
  clic: (i, x, y) => { __ab.ev(i, "pointerdown", x, y); __ab.ev(i, "pointerup", x, y); },
  zonas: () => [...document.querySelectorAll("table[aria-label='Zonas de refuerzo'] tbody tr")].map((tr) => ({ id: tr.querySelector("td").firstChild.textContent, maximo: tr.querySelector("[data-maximo]").dataset.maximo, exceso: tr.querySelector("[data-exceso]").dataset.exceso })),
};
// Los estados por los que pasa la app (para ver que cambiar la base no recalcula)
new MutationObserver(() => { const e = __ab.estado(); if (e && e !== window.__estados.at(-1)) window.__estados.push(e); }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-estado"], childList: true });`;
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: AYUDAS });
await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

async function abrir(nombre: string): Promise<void> {
  const cargada = new Promise<void>((r) => (alCargar = r));
  await cdp("Page.navigate", { url: `http://127.0.0.1:${PUERTO}/?proyecto=/p/${nombre}/proyecto.json` });
  await cargada;
  await pagina(`await __ab.esperar(() => __ab.estado() === "calculado");`);
}

async function captura(nombre: string): Promise<void> {
  const dir = process.env.CAPTURAS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const r = (await cdp("Page.captureScreenshot", { format: "png" })) as { data: string };
  writeFileSync(join(dir, `${nombre}.png`), Buffer.from(r.data, "base64"));
}

const largasDesde = (t: number) => pagina<{ t: number; ms: number }[]>(`return __largas.filter((x) => x.t >= ${t});`);
const ahora = () => pagina<number>(`return performance.now();`);
const largas = (l: { ms: number }[]) => `${l.filter((x) => x.ms > 50).length} (máx. ${Math.max(0, ...l.map((x) => x.ms)).toFixed(0)} ms)`;

/** Abre un proyecto y entra en Resultados · Armado: lo que tarda el mapa y la tabla de las franjas en salir, y sus tareas largas. */
async function entrarArmado(nombre: string): Promise<{ ms: number; largas: { ms: number }[] }> {
  await abrir(nombre);
  await pagina(`__ab.boton("Resultados").click(); await __ab.esperar(() => __ab.boton("Armado"));`);
  const t = await ahora();
  const ms = await pagina<number>(`
    const t0 = performance.now();
    __ab.boton("Armado").click();
    await __ab.esperar(() => document.querySelectorAll("table[aria-label='Franjas de la planta'] tbody tr").length > 0);
    return performance.now() - t0;`);
  return { ms, largas: await largasDesde(t) };
}

try {
  // En Node, la misma sesión
  const wasm = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
  await iniciarNucleo(wasm);
  const sa = Sesion.abrir(serializar(conBase), sha256(new Uint8Array(wasm)));
  if (!sa.valido) throw new Error("no abre en Node");
  if (!(await sa.sesion.calcular()).ok) throw new Error("no calcula en Node");
  const ses = sa.sesion;

  // ─── 3. Criterio 7: el mapa con base frente al mapa sin ella ──────────────────────────────────
  log("Criterio 7 · Resultados · Armado en el edificio objetivo de A2, sin base y con base (X superior, 20 kN·m/m)");
  // Una vuelta en frío, para que las dos medidas tengan la app compilada en la caché de V8
  await entrarArmado("sin-base");
  const sin = await entrarArmado("sin-base");
  const con = await entrarArmado("con-base");
  comprobar(con.ms <= sin.ms + 200, `el mapa con base sale en ${(con.ms / 1000).toFixed(2)} s, sin base en ${(sin.ms / 1000).toFixed(2)} s (≤ 0,2 s más)`);
  comprobar(con.largas.every((x) => x.ms <= 50) && sin.largas.every((x) => x.ms <= 50), `tareas largas > 50 ms en el hilo principal: sin base ${largas(sin.largas)}, con base ${largas(con.largas)}`);
  await new Promise((r) => setTimeout(r, 500));
  await captura("armado-con-base");

  // ─── 4. Criterio 2: las zonas de refuerzo, bit a bit ──────────────────────────────────────────
  log("\nCriterio 2 · Zonas de refuerzo y valor de un punto, frente a Node");
  const planta = await pagina<string>(`return document.querySelector("table[aria-label='Franjas de la planta']").closest("section").querySelector("h2 span").textContent.replace("Franjas de ", "");`);
  await pagina(`[...document.querySelectorAll(".dock-tab")].find((b) => b.textContent.startsWith("Refuerzos")).click(); await __ab.esperar(() => document.querySelector("table[aria-label='Zonas de refuerzo']"));`);
  const zp = await pagina<{ id: string; maximo: string; exceso: string }[]>(`return __ab.zonas();`);
  const dn = datosArmado(ses, planta, { tipo: "defecto" }, "x-sup", { armado: BASE });
  if (!dn.valido) throw new Error(JSON.stringify(dn.diagnosticos));
  const zn = dn.valor.zonas;
  comprobar(zn.length > 0 && zn.length === zp.length && zn.every((z, i) => z.id === zp[i]!.id && String(z.maximo.v) === zp[i]!.maximo && String(z.maximo.exceso) === zp[i]!.exceso), `las ${zp.length} zonas de refuerzo de ${planta} (X superior, base 20) son las de Node bit a bit`);

  // Un clic en la planta, en el centro de la mayor zona: el valor de Node en el punto exacto del clic
  const mayor = [...zn].sort((a, b) => b.maximo.v - a.maximo.v)[0]!;
  const objetivo: [number, number] = [(mayor.caja[0] + mayor.caja[2]) / 2, (mayor.caja[1] + mayor.caja[3]) / 2];
  const clic = await pagina<{ ms: number; p: [number, number]; valor: string | null }>(`
    const v = __ab.motor().vista(0);
    const [x, y] = v.aPx(${JSON.stringify(objetivo)}).map(Math.round);
    const p = v.aModelo(x, y);
    const antes = document.querySelector("[data-valor-armado]")?.dataset.valorArmado ?? null;
    const t0 = performance.now();
    __ab.clic(0, x, y);
    const el = await __ab.esperar(() => { const e = document.querySelector("[data-valor-armado]"); return e && e.dataset.valorArmado !== antes ? e : null; }, 10000);
    return { ms: performance.now() - t0, p, valor: el.dataset.valorArmado };`);
  const vn = ses.valorArmado({ planta, armadura: "x-sup", combinaciones: { tipo: "defecto" }, x: clic.p[0], y: clic.p[1], armado: BASE });
  if (!vn.valido) throw new Error(JSON.stringify(vn.diagnosticos));
  comprobar(vn.valor !== null && String(vn.valor.valor) === clic.valor, `un clic en (${clic.p[0].toFixed(3)}; ${clic.p[1].toFixed(3)}) da ${clic.valor} kN·m/m: el de Node bit a bit (${vn.valor?.franja}, s = ${vn.valor?.s.toFixed(3)})`);
  comprobar(clic.ms <= 50, `el valor del punto sale en ${clic.ms.toFixed(0)} ms (≤ 50 ms)`);
  await captura("armado-clic");

  // ─── 5. Criterio 5: cambiar la base no recalcula ──────────────────────────────────────────────
  log("\nCriterio 5 · Cambiar la base en Propiedades");
  const huella0 = await pagina<string>(`return __ab.huella();`);
  const tb = await ahora();
  const ms5 = await pagina<number>(`
    // Sin nada elegido, Propiedades enseña la base
    __ab.boton("Armadura base…")?.click();
    window.__estados = [__ab.estado()];
    const antes = JSON.stringify(__ab.zonas());
    const input = await __ab.esperar(() => document.querySelector("input[aria-label='Base X superior de todas las losas']"), 10000);
    const t0 = performance.now();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "25");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await __ab.esperar(() => JSON.stringify(__ab.zonas()) !== antes, 20000);
    return performance.now() - t0;`);
  const estados = await pagina<string[]>(`return window.__estados;`);
  const huella1 = await pagina<string>(`return __ab.huella();`);
  comprobar(huella1 === huella0 && estados.every((e) => e === "calculado"), `la huella sigue (${huella1.slice(0, 12)}) y la app no pasa por otro estado que «calculado» (${estados.join(" → ")})`);
  const zp2 = await pagina<{ id: string; maximo: string; exceso: string }[]>(`return __ab.zonas();`);
  const dn2 = datosArmado(ses, planta, { tipo: "defecto" }, "x-sup", { armado: { base: { "x-sup": 25 } } });
  if (!dn2.valido) throw new Error(JSON.stringify(dn2.diagnosticos));
  comprobar(dn2.valor.zonas.length === zp2.length && dn2.valor.zonas.every((z, i) => z.id === zp2[i]!.id && String(z.maximo.v) === zp2[i]!.maximo && String(z.maximo.exceso) === zp2[i]!.exceso), `con la base en 25, las ${zp2.length} zonas son las de Node bit a bit; salen en ${(ms5 / 1000).toFixed(2)} s`);
  comprobar((await largasDesde(tb)).every((x) => x.ms <= 50), `cambiar la base, sin tareas largas > 50 ms`);
  await captura("armado-base-25");

  // ─── 6. Criterio 6: el 3D ─────────────────────────────────────────────────────────────────────
  log("\nCriterio 6 · El armado en 3D");
  // Al pasar la vista a 3D, enseña todas las plantas (como Losas): la escala común
  const n3 = ses.armado3D({ armadura: "x-sup", combinaciones: { tipo: "defecto" }, planta: null, armado: { base: { "x-sup": 25 } } });
  if (!n3.valido) throw new Error(JSON.stringify(n3.diagnosticos));
  const tri = n3.valor.triangulos.length / 9;
  const t6 = await ahora();
  const ms6 = await pagina<number>(`
    const t0 = performance.now();
    __ab.boton("3D").click();
    await __ab.esperar(async () => (await __ab.dep(0)).isovalores > 0, 60000);
    return performance.now() - t0;`);
  await new Promise((r) => setTimeout(r, 300));
  const d6 = await pagina<{ isovalores: number }>(`return await __ab.dep(0);`);
  comprobar(d6.isovalores === tri, `triángulos de las franjas de todas las plantas en el 3D: ${d6.isovalores} = Node ${tri}; salen en ${(ms6 / 1000).toFixed(2)} s`);
  comprobar((await largasDesde(t6)).every((x) => x.ms <= 50), `el 3D, sin tareas largas > 50 ms: ${largas(await largasDesde(t6))}`);
  // La sonda en el centro de la mayor zona, a la cota de la losa
  const z = n3.valor.extremos[0]!;
  const sonda = await pagina<string[] | null>(`
    const v = __ab.motor().vista(0);
    const q = v.aPantalla(${z.punto[0]}, ${z.punto[1]}, ${z.punto[2]});
    if (!q) return null;
    const s = __ab.sup(0); const r = s.getBoundingClientRect();
    s.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, pointerType: "mouse", buttons: 0, clientX: r.left + q[0], clientY: r.top + q[1] }));
    await new Promise((r) => setTimeout(r, 200));
    return (await __ab.esperar(async () => (await __ab.dep(0)).sonda, 20000).catch(() => null)) ?? null;`);
  const plantaZ = (conBase.modelo.losas ?? []).find((l) => z.objeto.startsWith(`${l.id}:`))!.planta;
  const vz = ses.valorArmado({ planta: plantaZ, armadura: "x-sup", combinaciones: { tipo: "defecto" }, x: z.punto[0], y: z.punto[1], armado: { base: { "x-sup": 25 } } });
  const esperado = vz.valido && vz.valor ? vz.valor.valor.toFixed(1).replace(".", ",") : "?";
  comprobar(!!sonda && sonda[0]!.startsWith(`${esperado} kN·m/m`), `la sonda en el máximo de ${z.objeto}: «${sonda?.join(" · ")}» (Node: ${esperado} kN·m/m)`);
  await captura("armado-3d");
} catch (e) {
  fallos++;
  log(`FALLA ${e instanceof Error ? e.stack : String(e)}`);
} finally {
  log(fallos ? `\n${fallos} comprobaciones fallan` : "\nTodo bien");
  writeFileSync(join(import.meta.dirname, "out_chrome.txt"), salida.join("\n") + "\n");
  ws.close();
  chrome.kill();
  servidor.close();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(perfil, { recursive: true, force: true });
  rmSync(datos, { recursive: true, force: true });
  process.exit(fallos ? 1 : 0);
}
