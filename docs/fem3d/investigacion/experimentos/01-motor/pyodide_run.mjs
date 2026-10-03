// Experimento (b): PyNite 3.2.0 sobre Pyodide 314.0.0 en Node.
// Uso: node pyodide_run.mjs <modo> [args...]
//   modo "boot"            -> mide arranque, carga de numpy/scipy, import de Pynite (vendorizado + stubs)
//   modo "minimo"          -> además ejecuta exp_a_minimo.py --yup
//   modo "scaling a b c s sparse cs res" -> además ejecuta exp_scaling.py con esos argumentos
//   modo "nostubs"         -> intenta importar Pynite SIN stubs (debe fallar por matplotlib/prettytable)
//   modo "noscipy"         -> import con scipy bloqueado (sólo numpy) y análisis denso
//   modo "memmax"          -> busca el máximo de memoria WASM reservando arrays numpy
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "pyodide-dist");
const [mode = "boot", ...rest] = process.argv.slice(2);

const t = {};
let t0 = performance.now();
const mark = (k) => { const n = performance.now(); t[k] = +(n - t0).toFixed(0); t0 = n; };

const { loadPyodide } = await import(join(DIST, "pyodide.mjs").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "file:///$1:"));
mark("import_pyodide_mjs_ms");
const out = [];
const py = await loadPyodide({ indexURL: DIST + "/", env: { HOME: "/home/pyodide", PYNITE_DIR: process.env.PYNITE_DIR ?? "src320" }, stdout: (s) => out.push(s), stderr: (s) => out.push("ERR " + s) });
mark("loadPyodide_ms");

const heapMB = () => +(py._module.HEAP8.buffer.byteLength / 2 ** 20).toFixed(1);
const info = { mode, pyodide: py.version };

if (mode === "memmax") {
  await py.loadPackage("numpy");
  const r = py.runPython(`
import numpy as np
blocks=[]; mb=0
try:
    while True:
        blocks.append(np.ones(64*2**20//8)); mb+=64
except MemoryError:
    pass
mb`);
  info.max_numpy_alloc_MB = r;
  info.heap_MB = heapMB();
  console.log(JSON.stringify(info));
  process.exit(0);
}

if (mode === "noscipy") {
  await py.loadPackage("numpy");
  mark("loadPackage_numpy_ms");
} else {
  await py.loadPackage(["numpy", "scipy"]);
  mark("loadPackage_numpy_scipy_ms");
}
info.heap_after_packages_MB = heapMB();

// Montamos la carpeta de trabajo (scripts + Pynite vendorizado del wheel 3.2.0)
py.FS.mkdirTree("/work");
py.FS.mount(py.FS.filesystems.NODEFS, { root: HERE }, "/work");
py.runPython(`import sys; sys.path.insert(0, '/work'); sys.path.insert(0, '/work/' + (__import__('os').environ.get('PYNITE_DIR','src320')))`);

const STUBS = `
import sys, types
class _Placeholder:
    def __init__(self, *a, **k): raise NotImplementedError('Concreta: dependencia de dibujo/informe no disponible en Pyodide')
    def __call__(self, *a, **k): raise NotImplementedError('Concreta: dependencia de dibujo/informe no disponible en Pyodide')
class _StubModule(types.ModuleType):
    def __getattr__(self, name):
        if name.startswith('__'): raise AttributeError(name)
        return _Placeholder
for _n in ('matplotlib', 'matplotlib.pyplot', 'matplotlib.patches', 'prettytable'):
    sys.modules[_n] = _StubModule(_n)
`;
if (mode === "noscipy") {
  py.runPython(`
import sys
class _Block:
    def find_spec(self, name, path=None, target=None):
        if name == 'scipy' or name.startswith('scipy.'):
            raise ModuleNotFoundError('scipy bloqueado en el experimento')
sys.meta_path.insert(0, _Block())
`);
}
if (mode !== "nostubs") py.runPython(STUBS);
try {
  py.runPython(`import Pynite; from Pynite import FEModel3D`);
  mark("import_Pynite_ms");
  info.import_ok = true;
} catch (e) {
  info.import_ok = false;
  info.import_error = String(e.message).split("\n").filter(Boolean).slice(-2).join(" | ");
}
info.heap_after_import_MB = heapMB();

async function runScript(path, argv) {
  py.globals.set("_argv", py.toPy([path, ...argv]));
  py.runPython(`import sys, runpy; sys.argv = list(_argv); runpy.run_path(sys.argv[0], run_name='__main__')`);
}

if (info.import_ok && mode === "minimo") {
  await runScript("/work/exp_a_minimo.py", ["--yup"]);
  mark("exp_a_minimo_ms");
}
if (info.import_ok && mode === "script") {
  await runScript("/work/" + rest[0], rest.slice(1));
  mark("script_ms");
}
if (info.import_ok && mode === "scaling") {
  await runScript("/work/exp_scaling.py", rest);
  mark("exp_scaling_ms");
}
if (info.import_ok && mode === "noscipy") {
  try {
    await runScript("/work/exp_scaling.py", rest.length ? rest : ["2", "2", "2", "1.5", "0", "1", "1"]);
    mark("exp_scaling_dense_ms");
  } catch (e) {
    info.run_error = String(e.message).split("\n").filter(Boolean).slice(-3).join(" | ");
  }
}
info.heap_final_MB = heapMB();
info.node_rss_MB = +(process.memoryUsage().rss / 2 ** 20).toFixed(1);
info.times = t;
console.log(out.join("\n"));
console.log("PYODIDE_INFO " + JSON.stringify(info));
