// Worker de experimentos Pyodide 314.0.0 + numpy + scipy (copias locales en
// ../pyodide-local/). Mide arranque, memoria WASM, techo de memoria, un solve
// disperso y la interrupción por SharedArrayBuffer (si hay aislamiento).
const BASE = new URL("../pyodide-local/", self.location.href).href;
let py = null;
const now = () => performance.now();
const heapMB = () => +(py._module.HEAP8.buffer.byteLength / 1048576).toFixed(1);

async function boot() {
  const t0 = now();
  const { loadPyodide } = await import(BASE + "pyodide.mjs");
  py = await loadPyodide({ indexURL: BASE });
  const tBoot = now() - t0;
  const h0 = heapMB();
  let t = now(); await py.loadPackage("numpy"); const tNumpy = now() - t;
  t = now(); await py.loadPackage("scipy"); const tScipy = now() - t;
  t = now(); py.runPython("import numpy as np, scipy.sparse as sp, scipy.sparse.linalg as spla"); const tImport = now() - t;
  return { msBoot: +tBoot.toFixed(0), heapTrasBootMB: h0, msNumpy: +tNumpy.toFixed(0), msScipy: +tScipy.toFixed(0), msImportScipySparse: +tImport.toFixed(0), heapTrasScipyMB: heapMB(), msTotal: +(now() - t0).toFixed(0), crossOriginIsolated: self.crossOriginIsolated };
}

const PY_SOLVE = `
import time
def lap2d(n):
    import scipy.sparse as sp
    I = sp.identity(n, format='csr')
    T = sp.diags([-1, 4, -1], [-1, 0, 1], shape=(n, n), format='csr')
    E = sp.diags([-1, -1], [-1, 1], shape=(n, n), format='csr')
    return (sp.kron(I, T) + sp.kron(E, I)).tocsc()
def resolver(n):
    A = lap2d(n); b = np.ones(A.shape[0])
    t = time.perf_counter(); lu = spla.splu(A); tf = time.perf_counter() - t
    t = time.perf_counter(); x = lu.solve(b); ts = time.perf_counter() - t
    return {"gdl": A.shape[0], "nnz": int(A.nnz), "sFactorizar": round(tf, 3), "sResolver1": round(ts, 4), "nnzLU": int(lu.L.nnz + lu.U.nnz)}
def bucle(seg):
    t = time.perf_counter(); i = 0
    while time.perf_counter() - t < seg: i += 1
    return i
`;

self.onmessage = async (e) => {
  const { cmd, arg } = e.data;
  try {
    if (cmd === "boot") return self.postMessage({ cmd, r: await boot() });
    if (cmd === "solve") {
      py.runPython(PY_SOLVE);
      const r = py.runPython(`resolver(${arg})`).toJs({ dict_converter: Object.fromEntries });
      return self.postMessage({ cmd, r: { ...r, heapMB: heapMB() } });
    }
    if (cmd === "techo") {
      // Reserva bloques de 128 MiB (tocados) hasta MemoryError; luego libera y mide.
      const r = py.runPython(`
import numpy as np, gc
bloques = []; err = None
try:
    while True:
        a = np.ones(16 * 1024 * 1024)  # 128 MiB
        bloques.append(a)
except MemoryError as ex:
    err = 'MemoryError'
except Exception as ex:
    err = type(ex).__name__ + ': ' + str(ex)[:120]
n = len(bloques)
del bloques; gc.collect()
(n, err)`).toJs();
      return self.postMessage({ cmd, r: { bloques128MiB: r[0], reservadoMiB: r[0] * 128, error: r[1], heapTrasLiberarMB: heapMB() } });
    }
    if (cmd === "interrupcion") {
      // arg = { sab, modo:'bucle'|'splu', n }
      py.setInterruptBuffer(new Int32Array(arg.sab));
      py.runPython(PY_SOLVE);
      const t = now(); let res;
      try {
        res = arg.modo === "bucle" ? py.runPython("bucle(20)") : py.runPython(`resolver(${arg.n})`).toJs({ dict_converter: Object.fromEntries });
        res = { termino: true, r: res };
      } catch (ex) {
        res = { termino: false, excepcion: String(ex.message || ex).split("\n").filter(Boolean).pop() };
      }
      return self.postMessage({ cmd, r: { ...res, msHastaVolver: +(now() - t).toFixed(0) } });
    }
    if (cmd === "ocupar") {
      // trabajo síncrono largo (para probar terminate())
      py.runPython(PY_SOLVE);
      py.runPython("bucle(30)");
      return self.postMessage({ cmd, r: "terminó (no debería)" });
    }
  } catch (ex) {
    self.postMessage({ cmd, error: String(ex.message || ex).slice(0, 500) });
  }
};
