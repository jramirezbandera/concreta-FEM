// Criterio 3 del spike E0 en Chrome de verdad: el núcleo WASM dentro de un Worker de Chrome
// headless (perfil temporal propio, sin tocar la sesión del usuario).
//
//   node spike/e0/solver/bench-chrome.mjs V1_h0.75 sint_n90 ...   (nombres de spike/e0/datos/*.kcsc)
//
// Un Worker nuevo por K: la memoria WASM sólo crece, así que se mide el pico de cada caso.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const casos = process.argv.slice(2);
const NRHS = 24;

const pagina = `<!doctype html><meta charset="utf-8"><title>bench</title><script type="module">
const casos = ${JSON.stringify(casos)};
const enviar = (r) => fetch("/resultado", { method: "POST", body: JSON.stringify(r) });
for (const k of casos) {
  const r = await new Promise((ok) => {
    const w = new Worker("/worker.js", { type: "module" });
    w.onmessage = (e) => { w.terminate(); ok(e.data); };
    w.onerror = (e) => { w.terminate(); ok({ k, error: String(e.message) }); };
    w.postMessage({ k, nrhs: ${NRHS} });
  });
  await enviar(r);
}
await enviar({ fin: true, ua: navigator.userAgent });
</script>`;

const worker = `import init, { Nucleo, memoria } from "/pkg/nucleo.js";
onmessage = async ({ data: { k, nrhs } }) => {
  try {
    await init({ module_or_path: fetch("/pkg/nucleo_bg.wasm") });
    const heap = () => Math.round(memoria().buffer.byteLength / 1048576);
    const ab = await (await fetch("/datos/" + k + ".kcsc")).arrayBuffer();
    const cab = new DataView(ab, 0, 16);
    const n = cab.getUint32(8, true), nnz = cab.getUint32(12, true);
    const val = new Float64Array(ab, 16, nnz);
    const colPtr = new Uint32Array(ab, 16 + 8 * nnz, n + 1);
    const rowIdx = new Uint32Array(ab, 16 + 8 * nnz + 4 * (n + 1), nnz);
    let t = performance.now();
    const nucleo = new Nucleo(n, colPtr, rowIdx, undefined, 0);
    const tSim = performance.now() - t;
    new Float64Array(memoria().buffer, nucleo.valoresPtr(), nnz).set(val);
    t = performance.now();
    nucleo.factorizar();
    const tNum = performance.now() - t;
    const b = new Float64Array(n * nrhs);
    for (let i = 0; i < b.length; i++) b[i] = Math.sin(i * 0.37) + 0.1;
    const p = nucleo.ladosPtr(nrhs);
    new Float64Array(memoria().buffer, p, b.length).set(b);
    t = performance.now();
    nucleo.resolver(nrhs);
    const tSol = performance.now() - t;
    const x = new Float64Array(memoria().buffer, p, b.length).slice();
    // residuo relativo de la primera columna
    const ax = new Float64Array(n);
    for (let j = 0; j < n; j++) for (let q = colPtr[j]; q < colPtr[j + 1]; q++) {
      const i = rowIdx[q]; ax[i] += val[q] * x[j]; if (i !== j) ax[j] += val[q] * x[i];
    }
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (ax[i] - b[i]) ** 2; den += b[i] ** 2; }
    const [, , nnzL] = nucleo.estadisticas();
    postMessage({ k, plataforma: "wasm (Chrome, Worker)", n, nnz_l: nnzL, nrhs,
      t_simbolico_s: +(tSim / 1000).toFixed(3), t_factor_s: +(tNum / 1000).toFixed(3),
      t_resolver_s: +(tSol / 1000).toFixed(3), t_total_s: +((tSim + tNum + tSol) / 1000).toFixed(3),
      residuo_rel: +Math.sqrt(num / den).toExponential(2), heap_MB: heap() });
  } catch (e) { postMessage({ k, error: String(e && e.message || e) }); }
};`;

const tipos = { ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html" };
let chrome;
const perfil = mkdtempSync(join(tmpdir(), "chrome-bench-"));
const servidor = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "POST" && url.pathname === "/resultado") {
    let cuerpo = "";
    req.on("data", (c) => (cuerpo += c));
    req.on("end", () => {
      res.end("ok");
      const r = JSON.parse(cuerpo);
      if (r.fin) {
        console.log(JSON.stringify({ navegador: r.ua }));
        chrome.kill();
        servidor.close();
        setTimeout(() => rmSync(perfil, { recursive: true, force: true }), 2000);
      } else console.log(JSON.stringify(r));
    });
    return;
  }
  let cuerpo;
  let tipo = "text/html";
  if (url.pathname === "/") cuerpo = pagina;
  else if (url.pathname === "/worker.js") [cuerpo, tipo] = [worker, tipos[".js"]];
  else if (url.pathname.startsWith("/pkg/")) {
    const f = url.pathname.slice(5);
    cuerpo = readFileSync(join(raiz, "src/nucleo/pkg", f));
    tipo = tipos[f.slice(f.lastIndexOf("."))] ?? "application/octet-stream";
  } else if (url.pathname.startsWith("/datos/")) {
    cuerpo = readFileSync(join(raiz, "spike/e0/datos", url.pathname.slice(7)));
    tipo = "application/octet-stream";
  } else {
    res.statusCode = 404;
    return res.end();
  }
  res.setHeader("Content-Type", tipo);
  res.end(cuerpo);
});
servidor.listen(0, "127.0.0.1", () => {
  const { port } = servidor.address();
  chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${perfil}`, `http://127.0.0.1:${port}/`,
  ], { stdio: "ignore" });
});
