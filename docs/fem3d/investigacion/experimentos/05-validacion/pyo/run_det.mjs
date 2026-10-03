// EXP-09b — Mismo cálculo que exp09_determinismo.py pero dentro de Pyodide 314.0.0 (Node).
import { loadPyodide } from "pyodide";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const t0 = performance.now();
const py = await loadPyodide();
await py.loadPackage(["numpy", "scipy", "micropip"]);
const t1 = performance.now();
// instalar la rueda de PyNite sin dependencias (matplotlib/prettytable no hacen falta para el núcleo)
py.FS.mkdirTree("/wheels");
const whl = "pynitefea-3.2.0-py3-none-any.whl";
py.FS.writeFile(`/wheels/${whl}`, readFileSync(join(here, "wheels", whl)));
await py.runPythonAsync(`
import micropip
await micropip.install("emfs:/wheels/${whl}", deps=False)
`);
py.FS.mkdirTree("/exp");
for (const f of ["common.py", "exp06_metamorficas.py", "exp09_determinismo.py"]) {
  py.FS.writeFile(`/exp/${f}`, readFileSync(join(here, "..", f), "utf8"));
}
const t2 = performance.now();
py.runPython(`
import sys, types
sys.path.insert(0, "/exp")
class _Any(types.ModuleType):
    def __getattr__(self, k):
        return type(k, (), {})
for name in ("prettytable", "matplotlib", "matplotlib.pyplot", "matplotlib.patches", "matplotlib.colors", "matplotlib.cm"):
    mod = _Any(name); mod.__path__ = []; sys.modules[name] = mod
`);
py.runPython(`
import traceback, sys
try:
    exec(open("/exp/exp09_determinismo.py").read(), {"__name__": "__main__"})
except Exception:
    traceback.print_exc(file=sys.stdout)
`);
const t3 = performance.now();
console.log(JSON.stringify({ load_numpy_scipy_ms: Math.round(t1 - t0), install_pynite_ms: Math.round(t2 - t1), compute_ms: Math.round(t3 - t2) }));
