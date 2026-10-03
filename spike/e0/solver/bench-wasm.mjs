// Bench del núcleo WASM (faer, un hilo, SIMD128) sobre una K .kcsc. Spike E0, criterio 3.
//
//   node spike/e0/solver/bench-wasm.mjs spike/e0/datos/V1_h0.75.kcsc [nrhs=24] [modo=0|1|2]
//   bun  spike/e0/solver/bench-wasm.mjs ...
//
// Un proceso por K: la memoria WASM sólo crece, así que el «heap» medido es el pico de ese caso.
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import init, { Nucleo, memoria } from "../../../src/nucleo/pkg/nucleo.js";

const aqui = dirname(fileURLToPath(import.meta.url));
const wasmRuta = process.env.NUCLEO_WASM ?? join(aqui, "../../../src/nucleo/pkg/nucleo_bg.wasm");
const [ruta, nrhsArg, modoArg] = process.argv.slice(2);
const nrhs = Number(nrhsArg ?? 24);
const modo = Number(modoArg ?? 0);

const t00 = performance.now();
await init({ module_or_path: readFileSync(wasmRuta) });
const tInit = performance.now() - t00;
const heap = () => Math.round(memoria().buffer.byteLength / 1048576);

const buf = readFileSync(ruta);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const cab = new DataView(ab, 0, 16);
if (new TextDecoder().decode(new Uint8Array(ab, 0, 4)) !== "KCSC") throw new Error("no es .kcsc");
const n = cab.getUint32(8, true);
const nnz = cab.getUint32(12, true);
const val = new Float64Array(ab, 16, nnz);
const colPtr = new Uint32Array(ab, 16 + 8 * nnz, n + 1);
const rowIdx = new Uint32Array(ab, 16 + 8 * nnz + 4 * (n + 1), nnz);
const heap0 = heap();

let t = performance.now();
const nucleo = new Nucleo(n, colPtr, rowIdx, undefined, modo);
const tSim = performance.now() - t;
const heapSim = heap();

new Float64Array(memoria().buffer, nucleo.valoresPtr(), nnz).set(val);
t = performance.now();
nucleo.factorizar();
const tNum = performance.now() - t;
const heapNum = heap();

// Lados derechos pseudoaleatorios (xorshift), en orden de columnas.
let s = 0x2545f491n;
const b = new Float64Array(n * nrhs);
for (let i = 0; i < b.length; i++) {
  s ^= (s << 13n) & 0xffffffffn; s ^= s >> 17n; s ^= (s << 5n) & 0xffffffffn;
  b[i] = Number(s) / 4294967296 - 0.5;
}
const pLados = nucleo.ladosPtr(nrhs);
new Float64Array(memoria().buffer, pLados, n * nrhs).set(b);
t = performance.now();
nucleo.resolver(nrhs);
const tSol = performance.now() - t;
const x = new Float64Array(memoria().buffer, pLados, n * nrhs).slice();
const heapFin = heap();

// Residuo relativo con la K simétrica (triángulo superior).
let resMax = 0;
const ax = new Float64Array(n);
for (let k = 0; k < nrhs; k++) {
  ax.fill(0);
  const off = k * n;
  for (let j = 0; j < n; j++) {
    const xj = x[off + j];
    for (let p = colPtr[j]; p < colPtr[j + 1]; p++) {
      const i = rowIdx[p];
      ax[i] += val[p] * xj;
      if (i !== j) ax[j] += val[p] * x[off + i];
    }
  }
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (ax[i] - b[off + i]) ** 2; den += b[off + i] ** 2; }
  resMax = Math.max(resMax, Math.sqrt(num / den));
}
const [, nnzA, nnzL, sup, nSup] = nucleo.estadisticas();
const d = nucleo.diagonal();
let negativos = 0;
for (const v of d) if (v < 0) negativos++;
nucleo.free();

const motor = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
console.log(JSON.stringify({
  k: basename(ruta), plataforma: `wasm (${motor})`, n, nnz_a: nnzA, nnz_l: nnzL, supernodal: sup === 1,
  supernodos: nSup, nrhs, t_init_ms: Math.round(tInit), t_simbolico_s: +(tSim / 1000).toFixed(3),
  t_factor_s: +(tNum / 1000).toFixed(3), t_resolver_s: +(tSol / 1000).toFixed(3),
  t_total_s: +((tSim + tNum + tSol) / 1000).toFixed(3), residuo_rel_max: +resMax.toExponential(2),
  pivotes_negativos: negativos, heap_inicial_MB: heap0, heap_simbolico_MB: heapSim, heap_factor_MB: heapNum,
  heap_MB: heapFin,
}));
