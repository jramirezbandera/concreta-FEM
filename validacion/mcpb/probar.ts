#!/usr/bin/env bun
/**
 * Prueba del paquete de Claude Desktop (`scripts/paquete-mcpb.ts`, `docs/fem3d/agente.md` §13.4),
 * como lo arranca Claude Desktop: el .mcpb desempaquetado en una carpeta temporal fuera del repo
 * (sin node_modules a la vista), con `node` y por stdio.
 *
 *   bun scripts/paquete-mcpb.ts && bun validacion/mcpb/probar.ts [--node <ejecutable>]
 *
 * Comprueba initialize (la guía), tools/list, los recursos, validar, calcular y consultar la
 * vivienda, render con sus PNG, leer_proyecto y visor (la app construida y el proyecto por HTTP,
 * el WASM con su tipo). Sale con 1 si algo falla.
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const RAIZ = resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const NODE = args.includes("--node") ? args[args.indexOf("--node") + 1]! : "node";
const MCPB = join(RAIZ, "dist", "mcpb", "concreta-fem.mcpb");

const tmp = mkdtempSync(join(tmpdir(), "concreta-mcpb-"));
const ext = join(tmp, "extension");
const obra = join(tmp, "obra con espacios");
let fallos = 0;
const comprobar = (ok: boolean, que: string) => {
  console.log(`${ok ? "bien " : "FALLA"}  ${que}`);
  if (!ok) fallos++;
};
const CAPTURA = args.includes("--captura") ? args[args.indexOf("--captura") + 1] : undefined;

/** Abre la URL del visor en Chrome headless (por CDP, como validacion/al/pwa.ts) y espera a que la app abra el proyecto. */
async function enChrome(url: string): Promise<void> {
  const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const puerto = 9350;
  const perfil = mkdtempSync(join(tmpdir(), "concreta-mcpb-chrome-"));
  const chrome = spawn(CHROME, ["--headless=new", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${puerto}`, `--user-data-dir=${perfil}`, "--window-size=1600,1000", "about:blank"], { stdio: "ignore" });
  try {
    let wsUrl = "";
    for (let i = 0; i < 100 && !wsUrl; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        const t = (await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        wsUrl = t.find((x) => x.type === "page")?.webSocketDebuggerUrl ?? "";
      } catch {
        // aún arrancando
      }
    }
    if (!wsUrl) throw new Error("Chrome no abrió su puerto de depuración");
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => (ws.onopen = r));
    let nId = 0;
    const pend = new Map<number, (m: { result?: any; error?: { message: string } }) => void>();
    const consola: string[] = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as { id?: number; method?: string; params?: any; result?: unknown; error?: { message: string } };
      if (m.id !== undefined) pend.get(m.id)?.(m);
      if (m.method === "Runtime.exceptionThrown") consola.push(m.params?.exceptionDetails?.exception?.description ?? m.params?.exceptionDetails?.text);
      if (m.method === "Runtime.consoleAPICalled" && m.params?.type === "error") consola.push(m.params.args?.map((x: any) => x.value ?? x.description).join(" "));
    };
    const cdp = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<any>((res, rej) => {
        const id = ++nId;
        pend.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
        ws.send(JSON.stringify({ id, method, params }));
      });
    await cdp("Runtime.enable");
    await cdp("Page.enable");
    await cdp("Page.navigate", { url });
    const t0 = Date.now();
    let texto = "";
    let estado: string | null = null;
    while (Date.now() - t0 < 120_000) {
      await new Promise((r) => setTimeout(r, 250));
      const r = await cdp("Runtime.evaluate", { expression: `JSON.stringify({ t: document.body?.innerText ?? "", e: document.querySelector("[data-estado]")?.dataset.estado ?? null })`, returnByValue: true });
      const v = JSON.parse(r.result.value as string) as { t: string; e: string | null };
      texto = v.t;
      estado = v.e;
      if (texto.includes("CUB-S") && estado && estado !== "compilando") break;
    }
    comprobar(texto.includes("CUB-S"), `Chrome: la app abre el proyecto (estado ${estado}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    comprobar(estado !== null && !/error/i.test(estado), `Chrome: sin error en la sesión (${estado})`);
    comprobar(consola.length === 0, `Chrome: sin errores en la consola${consola.length ? `: ${consola.slice(0, 3).join(" | ")}` : ""}`);
    if (CAPTURA) {
      const c = await cdp("Page.captureScreenshot", { format: "png" });
      writeFileSync(CAPTURA, Buffer.from(c.data as string, "base64"));
      console.log(`       captura: ${CAPTURA}`);
    }
    ws.close();
  } finally {
    chrome.kill();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

try {
  const u = spawnSync(process.execPath, ["x", "@anthropic-ai/mcpb@2.1.2", "unpack", MCPB, ext], { stdio: "inherit" });
  if (u.status !== 0) throw new Error("No se pudo desempaquetar el .mcpb");
  mkdirSync(obra);
  const proyecto = join(obra, "proyecto.json");
  copyFileSync(join(RAIZ, "ejemplos", "vivienda", "proyecto.json"), proyecto);

  const v = spawnSync(NODE, ["--version"], { encoding: "utf8" });
  console.log(`Node ${v.stdout.trim()} · ${ext}`);

  const p = spawn(NODE, [join(ext, "server", "cli", "mcp.js")], { cwd: tmp, stdio: ["pipe", "pipe", "pipe"] });
  let errores = "";
  p.stderr.on("data", (d: Buffer) => (errores += d.toString()));
  const pendientes = new Map<number, (r: Record<string, unknown>) => void>();
  let resto = "";
  p.stdout.on("data", (d: Buffer) => {
    resto += d.toString();
    let i: number;
    while ((i = resto.indexOf("\n")) >= 0) {
      const m = JSON.parse(resto.slice(0, i)) as { id: number };
      resto = resto.slice(i + 1);
      pendientes.get(m.id)?.(m as unknown as Record<string, unknown>);
    }
  });
  let n = 0;
  const pedir = (method: string, params: unknown = {}) =>
    new Promise<Record<string, any>>((res, rej) => {
      const id = ++n;
      const t = setTimeout(() => rej(new Error(`${method}: sin respuesta en 300 s. ${errores.slice(-800)}`)), 300_000);
      pendientes.set(id, (r) => {
        clearTimeout(t);
        res(r as Record<string, any>);
      });
      p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const herramienta = async (name: string, a: Record<string, unknown>) => {
    const r = await pedir("tools/call", { name, arguments: a });
    const c = r.result?.content as { type: string; text?: string }[] | undefined;
    const json = c?.[0]?.text ? (JSON.parse(c[0].text) as Record<string, any>) : null;
    return { r, c: c ?? [], json, error: r.result?.isError === true || !!r.error };
  };

  const ini = await pedir("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prueba", version: "0" } });
  comprobar(typeof ini.result?.instructions === "string" && ini.result.instructions.includes("fem validar"), "initialize, con la guía");
  comprobar(/^0\.1\.\d+$/.test(ini.result?.serverInfo?.version ?? ""), `versión ${ini.result?.serverInfo?.version}`);
  const lista = await pedir("tools/list");
  comprobar((lista.result?.tools?.length ?? 0) >= 10, `${lista.result?.tools?.length} herramientas`);
  const esq = await pedir("resources/read", { uri: "fem://esquema" });
  comprobar((esq.result?.contents?.[0]?.text?.length ?? 0) > 1000, "recurso fem://esquema");
  const ej = await pedir("resources/read", { uri: "fem://ejemplo" });
  comprobar(!!ej.result?.contents?.[0]?.text, "recurso fem://ejemplo");

  const val = await herramienta("validar", { proyecto });
  comprobar(val.json?.ok === true, "validar la vivienda");
  const cal = await herramienta("calcular", { proyecto });
  comprobar(cal.json?.ok === true, `calcular la vivienda${cal.json?.ok ? "" : `: ${JSON.stringify(cal.json).slice(0, 500)}`}`);
  const con = await herramienta("consultar", { proyecto, consulta: "reacciones" });
  comprobar(con.json?.ok === true, "consultar reacciones");
  const ren = await herramienta("render", { proyecto, vista: ["modelo"], imagenes: 1 });
  comprobar(ren.json?.ok === true && ren.c.some((x) => x.type === "image"), "render con PNG (resvg y las fuentes)");
  const lee = await herramienta("leer_proyecto", { proyecto });
  comprobar(!lee.error && !!lee.json, "leer_proyecto");

  const vis = await herramienta("visor", { proyecto, abrir: false });
  const url = vis.json?.url as string | undefined;
  comprobar(!!url, `visor: ${url ?? JSON.stringify(vis.json)}`);
  if (url) {
    const base = new URL(url);
    const html = await fetch(base.origin + "/");
    comprobar(html.ok && (await html.text()).includes("<div"), "visor: index.html");
    const pj = await fetch(`${base.origin}/proyecto/proyecto.json`);
    comprobar(pj.ok && ((await pj.json()) as { modelo?: unknown }).modelo !== undefined, "visor: /proyecto/proyecto.json");
    const sw = await fetch(`${base.origin}/sw.js`);
    comprobar(sw.status === 404, "visor: sin service worker");
    const fuera = await fetch(`${base.origin}/..%2F..%2Fpackage.json`);
    comprobar(fuera.status === 404, "visor: nada fuera de la app");
    const wasms = readdirSync(join(ext, "server", "app", "dist", "assets")).filter((f) => f.endsWith(".wasm"));
    for (const w of wasms) {
      const r = await fetch(`${base.origin}/assets/${w}`);
      comprobar(r.ok && r.headers.get("content-type") === "application/wasm", `visor: assets/${w} como application/wasm`);
    }
    comprobar(wasms.length > 0, `visor: ${wasms.length} WASM en la app`);
    if (args.includes("--chrome")) await enChrome(url);
  }
  p.stdin.end();
  const codigo = await new Promise<number | null>((res) => p.on("exit", res));
  comprobar(codigo === 0, `el servidor se cierra al cerrar la entrada (código ${codigo})`);
  if (errores.trim()) console.log(`\nSalida de errores del servidor:\n${errores.slice(-2000)}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fallos ? `\n${fallos} comprobaciones fallan` : "\nTodo bien");
process.exitCode = fallos ? 1 : 0;
