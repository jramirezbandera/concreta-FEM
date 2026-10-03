// Worker (node:worker_threads) que imita el Worker del navegador: Pyodide + scipy + PyNite.
import { parentPort } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "pyodide-dist");
const t0 = performance.now();
const { loadPyodide } = await import("file:///" + join(DIST, "pyodide.mjs").replace(/\\/g, "/"));
const py = await loadPyodide({ indexURL: DIST + "/" });
await py.loadPackage(["numpy", "scipy"]);
py.FS.mkdirTree("/work");
py.FS.mount(py.FS.filesystems.NODEFS, { root: HERE }, "/work");
py.runPython(`
import sys, types
sys.path.insert(0, '/work'); sys.path.insert(0, '/work/src320')
class _P:
    def __init__(self, *a, **k): raise NotImplementedError
class _S(types.ModuleType):
    def __getattr__(self, n):
        if n.startswith('__'): raise AttributeError(n)
        return _P
for _n in ('matplotlib', 'matplotlib.pyplot', 'matplotlib.patches', 'prettytable'):
    sys.modules[_n] = _S(_n)
from Pynite import FEModel3D
import modelo, pynite_fast, asyncio, time
CANCEL = False

def build():
    m, _ = modelo.build(FEModel3D, nx=3, ny=3, storeys=3, s=1.0, yup=True)
    return m

def run_sync():
    t = time.perf_counter(); m = build(); pynite_fast.solve_linear(m)
    # extracción con la API de PyNite (lenta) para alargar la tarea
    for c in m.load_combos:
        for q in m.quads.values():
            q.moment(0, 0, True, c)
    return time.perf_counter() - t

async def run_async():
    # misma tarea, con puntos de cesión (await asyncio.sleep(0)) cada 50 quads
    global CANCEL
    CANCEL = False
    t = time.perf_counter(); m = build(); pynite_fast.solve_linear(m)
    await asyncio.sleep(0)
    if CANCEL: return ('cancelado', time.perf_counter() - t)
    for c in m.load_combos:
        for i, q in enumerate(m.quads.values()):
            q.moment(0, 0, True, c)
            if i % 50 == 0:
                await asyncio.sleep(0)
                if CANCEL: return ('cancelado', time.perf_counter() - t)
    return ('completo', time.perf_counter() - t)
`);
const bootMs = performance.now() - t0;
parentPort.on("message", async (msg) => {
  const tr = performance.now();
  if (msg === "cancel") {
    py.runPython("CANCEL = True");
    parentPort.postMessage({ type: "cancel-ack", at: tr });
    return;
  }
  if (msg === "run-sync") {
    const s = py.runPython("run_sync()");
    parentPort.postMessage({ type: "done-sync", secs: s, at: performance.now() });
  }
  if (msg === "run-async") {
    const r = await py.runPythonAsync("await run_async()");
    const [status, secs] = r.toJs(); r.destroy();
    parentPort.postMessage({ type: "done-async", status, secs, at: performance.now() });
  }
  if (msg === "mem") {
    parentPort.postMessage({ type: "mem", heapMB: py._module.HEAP8.buffer.byteLength / 2 ** 20 });
  }
});
parentPort.postMessage({ type: "ready", bootMs });
