// Intento: instantánea de memoria de Pyodide (API privada _makeSnapshot/_loadSnapshot).
const BASE = new URL("../pyodide-local/", self.location.href).href;
self.onmessage = async (e) => {
  const t0 = performance.now();
  try {
    const { loadPyodide } = await import(BASE + "pyodide.mjs");
    if (e.data.cmd === "hacer") {
      const py = await loadPyodide({ indexURL: BASE, _makeSnapshot: true });
      const snap = py.makeMemorySnapshot();
      self.postMessage({ ok: true, ms: Math.round(performance.now() - t0), MB: +(snap.byteLength / 1048576).toFixed(1), snap }, [snap.buffer]);
    } else {
      const py = await loadPyodide({ indexURL: BASE, _loadSnapshot: e.data.snap });
      const tBoot = performance.now() - t0;
      const r = py.runPython("import scipy.sparse.linalg as spla, numpy as np\nfloat(spla.spsolve(__import__('scipy').sparse.identity(3, format='csc')*2.0, np.ones(3))[0])");
      self.postMessage({ ok: true, msArranqueDesdeInstantanea: Math.round(tBoot), msTotal: Math.round(performance.now() - t0), prueba: r });
    }
  } catch (ex) { self.postMessage({ ok: false, error: String(ex.message || ex).split("\n").slice(-3).join(" | ").slice(0, 400), ms: Math.round(performance.now() - t0) }); }
};
