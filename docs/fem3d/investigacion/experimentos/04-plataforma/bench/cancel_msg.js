// ¿Puede un worker ocupado en trabajo SÍNCRONO (como runPython) atender un mensaje "cancel"?
window.cancelMsg = async function () {
  const src = `let t0; self.onmessage = (e) => {
    if (e.data.type === 'solve') { t0 = performance.now(); const fin = t0 + 2000; while (performance.now() < fin) {} self.postMessage({ type: 'success', ms: performance.now() - t0 }); }
    else if (e.data.type === 'cancel') self.postMessage({ type: 'cancel-recibido', msDesdeInicioSolve: performance.now() - t0 });
  };`;
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
  const log = []; const t0 = performance.now();
  w.onmessage = (e) => log.push({ ...e.data, msMain: Math.round(performance.now() - t0) });
  w.postMessage({ type: "solve" });
  setTimeout(() => w.postMessage({ type: "cancel" }), 100);
  await new Promise((r) => setTimeout(r, 2600));
  w.terminate();
  return log;
};
// ¿Llegan al hilo principal los mensajes de PROGRESO que el worker envía en mitad de un trabajo síncrono?
window.progreso = async function () {
  const src = `self.onmessage = () => { const t0 = performance.now(); let k = 0;
    while (performance.now() - t0 < 2000) { if (performance.now() - t0 > (k + 1) * 500) { k++; self.postMessage({ type: 'progress', etapa: k, msWorker: Math.round(performance.now() - t0) }); } }
    self.postMessage({ type: 'success' }); };`;
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
  const log = []; const t0 = performance.now();
  w.onmessage = (e) => log.push({ ...e.data, msMain: Math.round(performance.now() - t0) });
  w.postMessage("go");
  await new Promise((r) => setTimeout(r, 2500)); w.terminate();
  return log;
};
