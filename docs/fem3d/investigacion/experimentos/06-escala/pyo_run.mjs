// Runner de Pyodide 314.0.0 en Node para 06-escala.
// Uso: node pyo_run.mjs script <script.py> [args...]    -> ejecuta /work/<script.py> con sys.argv
//      node pyo_run.mjs memmax [empty|ones]              -> techo de memoria WASM (bloques de 64 MiB)
//      node pyo_run.mjs blas                             -> GFLOP/s de dgemm/cholesky densos en WASM
// Usa la distribución ya descargada en ../01-motor/pyodide-dist (numpy 2.4.3, scipy 1.17.1).
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "..", "01-motor", "pyodide-dist");
const [mode = "script", ...rest] = process.argv.slice(2);

const t = {};
let t0 = performance.now();
const mark = (k) => { const n = performance.now(); t[k] = +(n - t0).toFixed(0); t0 = n; };
const { loadPyodide } = await import("file:///" + join(DIST, "pyodide.mjs").replace(/\\/g, "/"));
const out = [];
const py = await loadPyodide({ indexURL: DIST + "/", env: { HOME: "/home/pyodide" },
  stdout: (s) => { out.push(s); console.log(s); }, stderr: (s) => out.push("ERR " + s) });
mark("loadPyodide_ms");
const heapMB = () => +(py._module.HEAP8.buffer.byteLength / 2 ** 20).toFixed(1);
const info = { mode, pyodide: py.version };
await py.loadPackage(["numpy", "scipy"]);
mark("loadPackage_ms");
info.heap_after_packages_MB = heapMB();

if (mode === "memmax") {
  const fill = rest[0] === "ones" ? "np.ones" : "np.empty";
  const r = py.runPython(`
import numpy as np
blocks=[]; mb=0
try:
    while True:
        blocks.append(${fill}(64*2**20//8)); mb+=64
except MemoryError:
    pass
n=len(blocks); del blocks
mb`);
  info.max_numpy_alloc_MB = r;
  info.heap_MB = heapMB();
  try { info.getHeapMax_MB = +(py._module.getHeapMax ? py._module.getHeapMax() / 2**20 : NaN).toFixed(1); } catch (e) {}
  info.node_rss_MB = +(process.memoryUsage().rss / 2 ** 20).toFixed(1);
  console.log("PYODIDE_INFO " + JSON.stringify(info));
  process.exit(0);
}

py.FS.mkdirTree("/work");
py.FS.mount(py.FS.filesystems.NODEFS, { root: HERE }, "/work");
py.runPython(`import sys, os; sys.path.insert(0, '/work'); sys.path.insert(0, '/work/src320'); os.chdir('/work')`);
py.runPython(`
import sys, types
class _P:
    def __init__(self, *a, **k): raise NotImplementedError('stub')
    def __call__(self, *a, **k): raise NotImplementedError('stub')
class _S(types.ModuleType):
    def __getattr__(self, name):
        if name.startswith('__'): raise AttributeError(name)
        return _P
for _n in ('matplotlib', 'matplotlib.pyplot', 'matplotlib.patches', 'prettytable'):
    sys.modules[_n] = _S(_n)
`);

if (mode === "blas") {
  py.runPython(`
import time, numpy as np, scipy.linalg as sl, json
from scipy.linalg import blas
res = {}
for n in (500, 1000, 2000):
    A = np.random.default_rng(0).standard_normal((n, n)); B = A.copy(order='F')
    t = time.perf_counter(); C = blas.dgemm(1.0, A, B); dt = time.perf_counter() - t
    res[f'dgemm_{n}_GFLOPs'] = round(2*n**3/dt/1e9, 2)
    S = A @ A.T + n*np.eye(n)
    t = time.perf_counter(); sl.cholesky(S, lower=True); dt = time.perf_counter() - t
    res[f'chol_{n}_GFLOPs'] = round(n**3/3/dt/1e9, 2)
    t = time.perf_counter(); C2 = A @ B; dt = time.perf_counter() - t
    res[f'np_matmul_{n}_GFLOPs'] = round(2*n**3/dt/1e9, 2)
print(json.dumps(res))
`);
  mark("blas_ms");
} else if (mode === "script") {
  py.globals.set("_argv", py.toPy(["/work/" + rest[0], ...rest.slice(1)]));
  try {
    py.runPython(`import sys, runpy; sys.argv = list(_argv); runpy.run_path(sys.argv[0], run_name='__main__')`);
  } catch (e) {
    info.error = String(e.message).split("\n").filter(Boolean).slice(-3).join(" | ");
  }
  mark("script_ms");
}
info.heap_final_MB = heapMB();
info.node_rss_MB = +(process.memoryUsage().rss / 2 ** 20).toFixed(1);
info.times = t;
console.log("PYODIDE_INFO " + JSON.stringify(info));
