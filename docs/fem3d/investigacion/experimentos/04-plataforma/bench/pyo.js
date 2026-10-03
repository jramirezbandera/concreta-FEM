// Hilo principal de los experimentos Pyodide. window.pyo(opciones) → resultados.
const now = () => performance.now();
function nuevoWorker() {
  const w = new Worker(new URL("./pyo.worker.js", import.meta.url), { type: "module" });
  const llamar = (cmd, arg) => new Promise((res) => {
    const f = (e) => { if (e.data.cmd === cmd) { w.removeEventListener("message", f); res(e.data); } };
    w.addEventListener("message", f); w.postMessage({ cmd, arg });
  });
  return { w, llamar };
}
async function memoriaUA() {
  if (!self.crossOriginIsolated || !performance.measureUserAgentSpecificMemory) return null;
  const m = await performance.measureUserAgentSpecificMemory();
  return +(m.bytes / 1048576).toFixed(0);
}

window.pyo = async function ({ solveN = [100, 200], techo = true, interrupcion = true } = {}) {
  const out = { crossOriginIsolated: self.crossOriginIsolated };
  // 1) arranque en frío (caché HTTP vacía en perfil nuevo)
  let t = now(); let a = nuevoWorker(); out.arranqueFrio = (await a.llamar("boot")).r; out.arranqueFrio.msDesdeMain = +(now() - t).toFixed(0);
  out.memUA_trasArranque = await memoriaUA();
  // 2) solves dispersos
  out.solves = [];
  for (const n of solveN) out.solves.push((await a.llamar("solve", n)).r ?? "error");
  // 3) cancelación: terminate() en mitad de un cálculo síncrono y re-arranque (caché HTTP caliente)
  a.llamar("ocupar");
  await new Promise((r) => setTimeout(r, 500));
  t = now(); a.w.terminate(); out.msTerminate = +(now() - t).toFixed(1);
  out.memUA_trasTerminate = await memoriaUA();
  t = now(); a = nuevoWorker(); out.arranqueTibio = (await a.llamar("boot")).r; out.arranqueTibio.msDesdeMain = +(now() - t).toFixed(0);
  // 4) techo de memoria y memoria que NO se devuelve
  if (techo) { out.techo = (await a.llamar("techo")).r ?? "error"; out.memUA_trasTecho = await memoriaUA(); }
  // 5) interrupción con SharedArrayBuffer (sólo si hay aislamiento de origen)
  if (interrupcion) {
    if (typeof SharedArrayBuffer === "undefined" || !self.crossOriginIsolated) out.interrupcion = "SharedArrayBuffer no disponible (sin COOP/COEP)";
    else {
      out.interrupcion = {};
      for (const [modo, n] of [["bucle", 0], ["splu", 1000]]) {
        const sab = new SharedArrayBuffer(4); const ia = new Int32Array(sab);
        const p = a.llamar("interrupcion", { sab, modo, n });
        await new Promise((r) => setTimeout(r, 400));
        const tI = now(); ia[0] = 2; // SIGINT
        const r = await p; out.interrupcion[modo] = { ...(r.r ?? r), msDesdeSenal: +(now() - tI).toFixed(0) };
      }
    }
  }
  a.w.terminate();
  return out;
};

// Pasos sueltos para medir la memoria del proceso desde fuera (PowerShell).
let _w = null;
window.pasoArrancar = async () => { _w = nuevoWorker(); return (await _w.llamar("boot")).r; };
window.pasoTecho = async () => (await _w.llamar("techo")).r;
window.pasoSolve = async (n) => (await _w.llamar("solve", n)).r;
window.pasoTerminar = () => { _w.w.terminate(); _w = null; return "terminado"; };
