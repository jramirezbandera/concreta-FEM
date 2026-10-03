// Experimento: instalar PyNiteFEA==3.2.0 con micropip (con dependencias, como haría un
// usuario normal) en Pyodide 314.0.0 bajo Node. Mide qué paquetes arrastra y cuánto tarda.
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, readdirSync, statSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "pyodide-dist");
const CACHE = join(HERE, "pkgcache-micropip");
mkdirSync(CACHE, { recursive: true });
const { loadPyodide } = await import("file:///" + join(DIST, "pyodide.mjs").replace(/\\/g, "/"));
const msgs = [];
let t = performance.now();
const py = await loadPyodide({ indexURL: DIST + "/", packageCacheDir: CACHE + "/", stdout: (s) => msgs.push(s), stderr: (s) => msgs.push("ERR " + s) });
const tBoot = performance.now() - t;
t = performance.now();
await py.loadPackage("micropip", { messageCallback: (m) => msgs.push(m) });
let err = null;
try {
  await py.runPythonAsync(`
import micropip
await micropip.install('PyNiteFEA==3.2.0')
`);
} catch (e) {
  err = String(e.message).split("\n").filter(Boolean).slice(-3).join(" | ");
}
const tInstall = performance.now() - t;
t = performance.now();
let importOk = true;
try {
  py.runPython("import Pynite; from Pynite import FEModel3D; import sys; print('mods', sorted(k for k in sys.modules if k.split('.')[0] in ('matplotlib','scipy','prettytable','PIL','fontTools','kiwisolver','contourpy')).__len__())");
} catch (e) { importOk = false; err = (err ?? "") + " IMPORT: " + String(e.message).split("\n").slice(-2).join(" | "); }
const tImport = performance.now() - t;
const installed = py.runPython("import micropip, json; json.dumps(sorted(f'{k}=={v.version}' for k, v in micropip.list().items()))");
let cached = 0;
for (const f of readdirSync(CACHE)) cached += statSync(join(CACHE, f)).size;
console.log(msgs.filter((m) => /Loading|Loaded|mods|ERR/.test(m)).join("\n"));
console.log("MICROPIP_INFO " + JSON.stringify({
  boot_ms: +tBoot.toFixed(0), install_ms: +tInstall.toFixed(0), import_ms: +tImport.toFixed(0), import_ok: importOk, error: err,
  installed: JSON.parse(installed), cdn_packages_downloaded_MB: +(cached / 1e6).toFixed(1),
  heap_MB: +(py._module.HEAP8.buffer.byteLength / 2 ** 20).toFixed(1),
}));
