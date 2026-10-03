// Experimento de cancelación: (1) runPython síncrono + mensaje 'cancel' -> ¿cuándo se atiende?
// (2) Python asíncrono con puntos de cesión -> cancelación cooperativa sin SharedArrayBuffer;
// (3) worker.terminate() + re-arranque en frío; (4) memoria tras 5 ejecuciones repetidas.
import { Worker } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const spawn = () => new Worker(join(HERE, "cancel_worker.mjs"));
const next = (w, type) => new Promise((res) => {
  const h = (m) => { if (m.type === type) { w.off("message", h); res(m); } };
  w.on("message", h);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let t = performance.now();
let w = spawn();
const ready = await next(w, "ready");
console.log(`arranque en frío del worker (Pyodide+numpy+scipy+PyNite): ${(performance.now() - t).toFixed(0)} ms (interno ${ready.bootMs.toFixed(0)} ms)`);

// (1) síncrono
w.postMessage("run-sync");
await sleep(1500);
const tc = performance.now();
w.postMessage("cancel");
const [ack1, done1] = await Promise.all([next(w, "cancel-ack"), next(w, "done-sync")]);
console.log(`(1) síncrono: tarea ${done1.secs.toFixed(2)} s; 'cancel' enviado a +1.5 s se atendió ${(ack1.at - tc).toFixed(0)} ms después (tras terminar la tarea: ${ack1.at >= done1.at - 5})`);

// (2) asíncrono cooperativo
w.postMessage("run-async");
await sleep(1500);
const tc2 = performance.now();
w.postMessage("cancel");
const [ack2, done2] = await Promise.all([next(w, "cancel-ack"), next(w, "done-async")]);
console.log(`(2) asíncrono: estado=${done2.status} a los ${done2.secs.toFixed(2)} s; 'cancel' atendido a ${(ack2.at - tc2).toFixed(0)} ms, tarea parada ${(done2.at - tc2).toFixed(0)} ms después del envío`);

// (4) memoria tras repeticiones
for (let i = 0; i < 5; i++) {
  w.postMessage("run-sync"); await next(w, "done-sync");
  w.postMessage("mem"); const mm = await next(w, "mem");
  console.log(`(4) repetición ${i + 1}: heap WASM ${mm.heapMB.toFixed(1)} MB`);
}

// (3) terminate + re-arranque
w.postMessage("run-sync");
await sleep(1000);
t = performance.now();
await w.terminate();
const tTerm = performance.now() - t;
t = performance.now();
w = spawn();
await next(w, "ready");
console.log(`(3) terminate(): ${tTerm.toFixed(0)} ms; re-arranque completo: ${(performance.now() - t).toFixed(0)} ms`);
await w.terminate();
