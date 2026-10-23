/**
 * Banco de la fase AL en Chrome de verdad (`docs/fem3d/almacen-local.md` §5):
 *
 *   node validacion/al/chrome.ts          escribe validacion/al/out_chrome.txt
 *
 * Como el de V2c (`validacion/v2c/chrome.ts`): compila la app, la sirve y la maneja con Chrome
 * headless por el protocolo de depuración, con su IndexedDB y su worker de verdad.
 *
 * - 1: un proyecto nuevo y uno importado (el ejemplo de la skill, con el selector de ficheros) se
 *   guardan solos; un cambio (la descripción) también, y recargar la página lo abre tal cual.
 * - 2: lo importado se guarda con su texto canónico y su huella; exportar descarga ese texto.
 * - 4: lo calculado viaja del worker a IndexedDB (Transferable) y, al recargar, el proyecto sale
 *   calculado de la caché con el mismo sha256, sin recalcular.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import { huellaCompilacion } from "../../src/compilador/compilar.ts";
import { resolverOpciones } from "../../src/compilador/fisico.ts";
import { serializar } from "../../src/editor/serializar.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const APP = join(RAIZ, "app");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PUERTO = 8779;
const PUERTO_CDP = 9339;
const EJEMPLO = join(RAIZ, ".claude", "skills", "fem", "ejemplo.json");
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

const l = leerProyecto(readFileSync(EJEMPLO, "utf8"));
if (!l.valido) throw new Error("el ejemplo de la skill no se lee");
const CANONICO = serializar(l.proyecto);
const HUELLA = huellaCompilacion(l.proyecto.modelo, resolverOpciones(l.proyecto.opciones ?? {}));

// ─── 1. La app compilada ────────────────────────────────────────────────────────────────────────

execFileSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: APP, stdio: "inherit", shell: true });
const DIST = join(APP, "dist");
const TIPOS: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml" };
const servidor = createServer((req, res) => {
  const ruta = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const fichero = normalize(join(DIST, ruta === "/" ? "index.html" : ruta));
  if (!fichero.startsWith(DIST) || !existsSync(fichero) || !statSync(fichero).isFile()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": TIPOS[extname(fichero)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(fichero));
});
await new Promise<void>((r) => servidor.listen(PUERTO, "127.0.0.1", r));

// ─── 2. Chrome y su protocolo de depuración ─────────────────────────────────────────────────────

const perfil = mkdtempSync(join(tmpdir(), "al-chrome-"));
const descargas = mkdtempSync(join(tmpdir(), "al-descargas-"));
const chrome = spawn(CHROME, ["--headless=new", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${perfil}`, "--window-size=1600,1000", "about:blank"], { stdio: "ignore" });
let wsUrl = "";
for (let i = 0; i < 100 && !wsUrl; i++) {
  await new Promise((r) => setTimeout(r, 100));
  try {
    const t = (await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    wsUrl = t.find((x) => x.type === "page")?.webSocketDebuggerUrl ?? "";
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

// Ayudas de la página: esperar, el estado, botones y leer IndexedDB sin pasar por la app
const AYUDAS = `
window.__c = {
  esperar: async (f, ms = 120000) => { const t0 = performance.now(); for (;;) { const v = await f(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("tiempo agotado: " + f); await new Promise((r) => setTimeout(r, 20)); } },
  estado: () => document.querySelector("[data-estado]")?.dataset.estado ?? null,
  huella: () => document.querySelector("[data-estado]")?.dataset.huella ?? null,
  quieto: () => ["calculado", "sin-calcular", "no-compila"].includes(__c.estado()),
  boton: (texto) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === texto || b.textContent.trim().startsWith(texto)),
  guardado: () => document.querySelector('[aria-label="Estado del guardado"]')?.dataset.sinGuardar === "false",
  bd: (almacen, clave) => new Promise((res, rej) => {
    const r = indexedDB.open("concreta-fem");
    r.onsuccess = () => { const t = r.result.transaction(almacen).objectStore(almacen); const q = clave === undefined ? t.getAll() : t.get(clave); q.onsuccess = () => { res(q.result); r.result.close(); }; q.onerror = () => rej(q.error); };
    r.onerror = () => rej(r.error);
  }),
};`;
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("DOM.enable");
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: AYUDAS });
await cdp("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: descargas });

async function ir(url: string): Promise<void> {
  const cargada = new Promise<void>((r) => (alCargar = r));
  await cdp("Page.navigate", { url });
  await cargada;
}
const BASE = `http://127.0.0.1:${PUERTO}/`;

try {
  // ─── 3. Proyecto nuevo ──────────────────────────────────────────────────────────────────────
  await ir(BASE);
  await pagina(`await __c.esperar(() => __c.boton("Proyecto nuevo"));`);
  await pagina(`
    __c.boton("Proyecto nuevo").click();
    const i = await __c.esperar(() => document.querySelector('input[aria-label="Nombre del proyecto"]'));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "Nave AL");
    i.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    __c.boton("Crear").click();
    await __c.esperar(() => __c.quieto());`);
  const nuevo = await pagina<{ busqueda: string; fichas: { id: string; nombre: string }[] }>(`return { busqueda: location.search, fichas: await __c.bd("proyectos") };`);
  comprobar(nuevo.fichas.length === 1 && nuevo.fichas[0]!.nombre === "Nave AL", `proyecto nuevo en IndexedDB: ${JSON.stringify(nuevo.fichas.map((f) => f.nombre))}`);
  comprobar(nuevo.busqueda === `?local=${nuevo.fichas[0]?.id}`, `la URL lo nombra (${nuevo.busqueda})`);

  // ─── 4. Importar el ejemplo de la skill con el selector de ficheros ─────────────────────────
  await ir(BASE);
  await pagina(`await __c.esperar(() => document.querySelector('input[type=file]'));`);
  const doc = (await cdp("DOM.getDocument")) as { root: { nodeId: number } };
  const entrada = (await cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "input[type=file]" })) as { nodeId: number };
  await cdp("DOM.setFileInputFiles", { nodeId: entrada.nodeId, files: [EJEMPLO] });
  await pagina(`await __c.esperar(() => __c.quieto() && __c.huella());`);
  const imp = await pagina<{ huella: string; busqueda: string }>(`return { huella: __c.huella(), busqueda: location.search };`);
  const id = imp.busqueda.replace("?local=", "");
  const textoImp = await pagina<string>(`return await __c.bd("textos", ${JSON.stringify(id)});`);
  comprobar(imp.huella === HUELLA, `importado: la huella del fichero (${imp.huella.slice(0, 12)})`);
  comprobar(textoImp === CANONICO, `importado: guardado con el texto canónico (${textoImp.length} caracteres)`);

  // ─── 5. Calcular: los resultados viajan del worker a la caché ───────────────────────────────
  // Abrir un proyecto sin resultados lo calcula (como en V1)
  await pagina(`await __c.esperar(() => __c.estado() === "calculado");`);
  const sha = await pagina<string>(`return document.querySelector("[data-sha]").dataset.sha;`);
  const cache = await pagina<{ huella: string; bytes: number; sha: string | null }>(`
    const r = await __c.esperar(async () => (await __c.bd("resultados")).find((x) => x.huella === __c.huella()), 20000);
    return { huella: r.huella, bytes: r.bytes.byteLength, sha: JSON.parse(r.cabecera).sha256 ?? null };`);
  comprobar(cache.sha === sha && cache.bytes > 0, `calculado al abrir; en la caché: ${cache.bytes} bytes con el sha256 de la app (${sha.slice(0, 12)})`);

  // ─── 6. Un cambio se guarda solo ────────────────────────────────────────────────────────────
  await pagina(`
    const t = await __c.esperar(() => document.querySelector('textarea[aria-label="Descripción del proyecto"]'));
    t.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(t, "Descrito en el banco de AL");
    t.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    // Sin foco en la página (headless), blur() no avisa: el focusout que escucha React, a mano
    t.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    `);
  const g0 = performance.now();
  const tras = await pagina<boolean>(`
    try { await __c.esperar(async () => (await __c.bd("textos", ${JSON.stringify(id)})).includes("Descrito en el banco de AL") && __c.guardado() && __c.quieto(), 10000); return true; } catch { return false; }`);
  comprobar(tras, `la descripción se guardó sola en IndexedDB (en ${((performance.now() - g0) / 1000).toFixed(2)} s, con la pausa de 0,4 s)`);

  // ─── 7. Recargar la página: el mismo proyecto, calculado desde la caché ─────────────────────
  const r0 = performance.now();
  await ir(`${BASE}?local=${id}`);
  await pagina(`await __c.esperar(() => __c.estado() === "calculado");`);
  const tReabrir = performance.now() - r0;
  const re = await pagina<{ origen: string; sha: string; huella: string; desc: string }>(`
    return { origen: document.querySelector("[data-sha]").dataset.origen, sha: document.querySelector("[data-sha]").dataset.sha, huella: __c.huella(), desc: document.querySelector('textarea[aria-label="Descripción del proyecto"]')?.value ?? "" };`);
  comprobar(re.desc === "Descrito en el banco de AL", "recargar abre el proyecto con el cambio");
  comprobar(re.origen === "guardados" && re.sha === sha && re.huella === HUELLA, `recargar no recalcula: resultados de la caché con el mismo sha256 (${re.origen}, ${(tReabrir / 1000).toFixed(2)} s hasta calculado)`);
  const versiones = await pagina<number>(`return (await __c.bd("versiones")).filter((v) => v.proyecto === ${JSON.stringify(id)}).length;`);
  comprobar(versiones >= 1, `versiones del importado: ${versiones}`);

  // ─── 8. Exportar ────────────────────────────────────────────────────────────────────────────
  const final = await pagina<string>(`return await __c.bd("textos", ${JSON.stringify(id)});`);
  await pagina(`document.querySelector('[aria-label="Exportar el proyecto.json"]').click();`);
  let exportado = "";
  for (let i = 0; i < 100 && !exportado; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const f = readdirSync(descargas).find((x) => x.endsWith(".json"));
    if (f) exportado = readFileSync(join(descargas, f), "utf8");
  }
  comprobar(exportado === final, `exportar descarga el texto guardado byte a byte (${readdirSync(descargas).join(", ")})`);
  const le = leerProyecto(exportado);
  comprobar(le.valido && huellaCompilacion(le.proyecto.modelo, resolverOpciones(le.proyecto.opciones ?? {})) === HUELLA, "lo exportado pasa el esquema y tiene la huella del importado");
} finally {
  ws.close();
  chrome.kill();
  servidor.close();
}

log(fallos ? `\n${fallos} comprobaciones fallan` : "\nTodo bien");
writeFileSync(join(import.meta.dirname, "out_chrome.txt"), salida.join("\n") + "\n");
process.exit(fallos ? 1 : 0);
