// Uso: node run.mjs <n> <superlu|cholmod|both> [nrhs]
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "dist");
const args = process.argv.slice(2);
const t0 = performance.now();
const { loadPyodide } = await import(pathToFileURL(join(DIST, "pyodide.mjs")).href);
const out = [];
const py = await loadPyodide({ indexURL: DIST + "/", stdout: (s) => out.push(s), stderr: (s) => out.push("ERR " + s) });
const M = py._module; const W = M.__wasmImports;
if (W) {
  const gt = M._malloc(16); M.HEAP32[gt >> 2] = 0; M.HEAP32[(gt >> 2) + 1] = 0;
  W.__kmpc_global_thread_num = () => 0;
  W.__kmpc_push_num_threads = () => {};
  W.__kmpc_serialized_parallel = () => {};
  W.__kmpc_end_serialized_parallel = () => {};
  W.__kmpc_for_static_fini = () => {};
  const sinit = (loc, gtid, sched, plast, plower, pupper, pstride, incr, chunk) => { const h = M.HEAP32; h[plast >> 2] = 1; h[pstride >> 2] = h[pupper >> 2] - h[plower >> 2] + 1; };
  W.__kmpc_for_static_init_4 = sinit; W.__kmpc_for_static_init_4u = sinit;
  globalThis.__forkCalls = 0;
  W.__kmpc_fork_call = (loc, argc, microtask, varargs) => { globalThis.__forkCalls++; const f = M.wasmTable.get(microtask); const h = M.HEAP32; const a = []; for (let k = 0; k < argc; k++) a.push(h[(varargs >> 2) + k]); f(gt, gt + 4, ...a); };
}
const pk = ["numpy", "scipy"];
if (args[1] !== "superlu") pk.push("libsuitesparse");
await py.loadPackage(pk);
const tBoot = performance.now() - t0;
py.FS.mkdirTree("/work");
py.FS.mount(py.FS.filesystems.NODEFS, { root: HERE }, "/work");
py.globals.set("_argv", py.toPy(["/work/bench_solvers.py", ...args]));
let err = null;
try {
  py.runPython(`import sys, runpy; sys.argv = list(_argv); runpy.run_path(sys.argv[0], run_name='__main__')`);
} catch (e) { err = String(e.message).split("\n").filter(Boolean).slice(-3).join(" | "); }
console.log(out.join("\n"));
console.log("RUNINFO " + JSON.stringify({ args, boot_ms: Math.round(tBoot), total_ms: Math.round(performance.now() - t0),
  forkCalls: globalThis.__forkCalls, heap_MB: +(py._module.HEAP8.buffer.byteLength / 2 ** 20).toFixed(0), rss_MB: +(process.memoryUsage().rss / 2 ** 20).toFixed(0), err }));
