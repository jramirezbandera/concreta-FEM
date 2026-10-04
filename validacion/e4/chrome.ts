/**
 * Banco de E4 en Chrome de verdad: empaqueta `validacion/e4/pagina.ts` y el worker
 * (`src/worker/worker.ts`) con `bun build`, los sirve y los mide.
 *
 *   node validacion/e4/chrome.ts                 Chrome headless (perfil temporal, sin tocar la
 *                                                sesión del usuario); escribe out_chrome.txt
 *   node validacion/e4/chrome.ts --dispositivos  sirve la página en la red local para medir en un
 *                                                móvil o un portátil: abrir http://<IP>:8765/?manual
 *                                                y pulsar «Medir»; añade a out_dispositivos.jsonl
 *   node validacion/e4/chrome.ts --dispositivos --local
 *                                                lo mismo en esta máquina, con Chrome headless y sólo
 *                                                en 127.0.0.1 (sin aviso del cortafuegos)
 *
 * En el modo automático, el servidor mide la memoria de los procesos de esa instancia de Chrome
 * (privada y de trabajo, por tipo de proceso) cada vez que la página se lo pide, y al terminar
 * calcula en Node la huella de los mismos modelos: si coincide, Chrome y Node han dado los mismos
 * bits. Sólo Windows (la memoria se lee con PowerShell).
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { calidad, edificioObjetivo, huellaResultado, nombreVariante, type Variante } from "./modelos.ts";

const raiz = join(import.meta.dirname, "..", "..");
const dispositivos = process.argv.includes("--dispositivos");
const local = process.argv.includes("--local");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PUERTO = 8765;

// 1. Paquetes para el navegador
const paquete = mkdtempSync(join(tmpdir(), "e4-paquete-"));
for (const [entrada, salida] of [
  ["validacion/e4/pagina.ts", "pagina.js"],
  ["src/worker/worker.ts", "worker.js"],
]) {
  execFileSync("bun", ["build", entrada, "--target=browser", "--format=esm", `--outfile=${join(paquete, salida)}`], { cwd: raiz, stdio: ["ignore", "ignore", "inherit"] });
}
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Banco E4</title>
<style>body{font:15px system-ui;margin:16px}button{font-size:18px;padding:8px 24px}pre{white-space:pre-wrap;word-break:break-all;font-size:11px}</style>
<h1>Banco E4 del motor</h1><button id="medir" hidden>Medir</button><pre id="salida"></pre>
<script type="module" src="pagina.js"></script>`;
const ficheros: Record<string, [string | Buffer, string]> = {
  "/": [html, "text/html; charset=utf-8"],
  "/pagina.js": [readFileSync(join(paquete, "pagina.js")), "text/javascript"],
  "/worker.js": [readFileSync(join(paquete, "worker.js")), "text/javascript"],
  "/nucleo_bg.wasm": [readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")), "application/wasm"],
};

// 2. Memoria de los procesos de esta instancia de Chrome (por su carpeta de perfil)
const perfil = mkdtempSync(join(tmpdir(), "e4-chrome-"));
function memoriaChrome(): Record<string, unknown> {
  const ps = `$p = '${perfil.replace(/'/g, "''")}'
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like "*$p*" } | ForEach-Object {
  $g = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  if ($g) {
    $t = if ($_.CommandLine -match '--type=([a-z-]+)') { $Matches[1] } else { 'browser' }
    if ($_.CommandLine -match '--utility-sub-type=([a-zA-Z.]+)') { $t = $t + ':' + $Matches[1] }
    [pscustomobject]@{ tipo = $t; privada = $g.PrivateMemorySize64; ws = $g.WorkingSet64 }
  }
} | ConvertTo-Json -Compress`;
  const procesos = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", ps]).toString() || "[]") as { tipo: string; privada: number; ws: number }[];
  const lista = Array.isArray(procesos) ? procesos : [procesos];
  const MB = (b: number) => Math.round(b / 2 ** 20);
  const renderer = lista.filter((p) => p.tipo === "renderer");
  return {
    privadaTotalMB: MB(lista.reduce((s, p) => s + p.privada, 0)),
    privadaRendererMB: MB(renderer.reduce((s, p) => s + p.privada, 0)),
    trabajoRendererMB: MB(renderer.reduce((s, p) => s + p.ws, 0)),
    procesos: lista.length,
  };
}

// 3. Servidor
const salidaAuto: string[] = [];
let chrome: ChildProcess | undefined;
const servidor = createServer((req, res) => {
  const url = new URL(req.url!, "http://x");
  if (req.method === "POST" && url.pathname === "/resultado") {
    let cuerpo = "";
    req.on("data", (c) => (cuerpo += c));
    req.on("end", () => {
      res.end("ok");
      if (dispositivos) {
        const r = JSON.parse(cuerpo);
        appendFileSync(join(import.meta.dirname, "out_dispositivos.jsonl"), JSON.stringify({ fecha: new Date().toISOString(), ip: req.socket.remoteAddress, ...r }) + "\n");
        console.log(cuerpo);
        if (local && r.evento === "fin") {
          chrome?.kill();
          servidor.close();
          setTimeout(() => rmSync(perfil, { recursive: true, force: true }), 2000);
          rmSync(paquete, { recursive: true, force: true });
        }
        return;
      }
      const r = JSON.parse(cuerpo);
      if (r.fin) void terminar(r.ua);
      else {
        salidaAuto.push(cuerpo);
        console.log(cuerpo);
      }
    });
    return;
  }
  if (url.pathname === "/memoria") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ etiqueta: url.searchParams.get("etiqueta"), ...memoriaChrome() }));
    return;
  }
  const f = ficheros[url.pathname];
  if (!f) {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader("Content-Type", f[1]);
  res.setHeader("Cache-Control", "no-store");
  res.end(f[0]);
});

async function terminar(ua: string): Promise<void> {
  chrome?.kill();
  servidor.close();
  // Huella de los mismos modelos en Node, con calcular() directo
  await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const variantes: Variante[] = [
    { malla: 0.75, diafragma: true },
    { malla: 0.75, diafragma: false },
  ];
  for (const v of variantes) {
    const r = calcular(edificioObjetivo(v));
    const linea = JSON.stringify({ evento: "node", motor: `node ${process.version}`, variante: nombreVariante(v), valido: r.valido, ...calidad(r), huella: huellaResultado(r) });
    salidaAuto.push(linea);
    console.log(linea);
  }
  const cabecera = `# validacion/e4/chrome.ts — ${new Date().toISOString().slice(0, 10)}, Ryzen 9 5900X, Windows 11; ${ua}`;
  writeFileSync(join(import.meta.dirname, "out_chrome.txt"), [cabecera, ...salidaAuto].join("\n") + "\n");
  setTimeout(() => rmSync(perfil, { recursive: true, force: true }), 2000);
  rmSync(paquete, { recursive: true, force: true });
}

if (dispositivos && local) {
  servidor.listen(PUERTO, "127.0.0.1", () => {
    chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${perfil}`, `http://127.0.0.1:${PUERTO}/?manual&iniciar`], {
      stdio: "ignore",
    });
  });
} else if (dispositivos) {
  servidor.listen(PUERTO, "0.0.0.0", () => {
    const ips = Object.values(networkInterfaces())
      .flat()
      .filter((i) => i && i.family === "IPv4" && !i.internal)
      .map((i) => `http://${i!.address}:${PUERTO}/?manual`);
    console.log(`Abre en el dispositivo (misma red):\n  ${ips.join("\n  ")}\nResultados en validacion/e4/out_dispositivos.jsonl. Ctrl+C para terminar.`);
  });
} else {
  servidor.listen(0, "127.0.0.1", () => {
    const { port } = servidor.address() as { port: number };
    chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${perfil}`, `http://127.0.0.1:${port}/`], { stdio: "ignore" });
  });
}
