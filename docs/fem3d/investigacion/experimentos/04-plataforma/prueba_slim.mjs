// Node: Pyodide 314 + numpy + scipy (completo o ADELGAZADO) + PyNite 3.2.0
// vendorizado (sin matplotlib ni prettytable). ¿Importa y resuelve un pórtico 3D?
// Uso: node prueba_slim.mjs pyodide-slim
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = process.argv[2] || "pyodide-slim";
const BASE = join(process.cwd(), dir) + "/";
const { loadPyodide } = await import(pathToFileURL(BASE + "pyodide.mjs").href);
const t0 = performance.now();
const py = await loadPyodide({ indexURL: BASE, stdout: () => {}, stderr: () => {} });
await py.loadPackage(["numpy", "scipy"], { messageCallback: () => {} });
const tPk = performance.now() - t0;
py.FS.mkdirTree("/vendor/Pynite");
for (const f of readdirSync(join(BASE, "Pynite"))) py.FS.writeFile(`/vendor/Pynite/${f}`, readFileSync(join(BASE, "Pynite", f)));
py.runPython("import sys; sys.path.insert(0, '/vendor')");
// Stubs (como PySlope): ShearWall.py importa prettytable y matplotlib.pyplot en el nivel superior.
py.runPython([
  "import sys, types",
  "for _n in ('prettytable', 'matplotlib', 'matplotlib.pyplot', 'matplotlib.patches', 'matplotlib.figure'):",
  "    _m = types.ModuleType(_n); _m.__stub__ = True; sys.modules[_n] = _m",
  "sys.modules['prettytable'].PrettyTable = object",
  "sys.modules['matplotlib.patches'].Rectangle = object",
  "sys.modules['matplotlib'].pyplot = sys.modules['matplotlib.pyplot']",
].join(String.fromCharCode(10)));
const PY = [
  "from Pynite import FEModel3D",
  "m = FEModel3D()",
  "m.add_node('N1', 0, 0, 0); m.add_node('N2', 0, 3, 0); m.add_node('N3', 5, 3, 0); m.add_node('N4', 5, 0, 0)",
  "m.add_material('HA30', E=28.6e9, G=11.9e9, nu=0.2, rho=2500)",
  "m.add_section('R30', A=0.09, Iy=6.75e-4, Iz=6.75e-4, J=1.14e-3)",
  "for a, b, c in [('P1','N1','N2'), ('V1','N2','N3'), ('P2','N4','N3')]: m.add_member(a, b, c, 'HA30', 'R30')",
  "for n in ('N1', 'N4'): m.def_support(n, True, True, True, True, True, True)",
  "m.add_member_dist_load('V1', 'Fy', -20e3, -20e3, case='G')",
  "m.add_load_combo('ELU', {'G': 1.35})",
  "m.add_node('S1', 10, 0, 0); m.add_node('S2', 12, 0, 0); m.add_node('S3', 12, 2, 0); m.add_node('S4', 10, 2, 0)",
  "m.add_quad('Q1', 'S1', 'S2', 'S3', 'S4', 0.2, 'HA30')",
  "for n in ('S1', 'S2', 'S3', 'S4'): m.def_support(n, True, True, True, True, True, True)",
  "m.add_quad_surface_pressure('Q1', 5e3, case='G')",
  "m.analyze(check_statics=False)",
  "_q = m.quads['Q1']; _mq = _q.moment(0, 0, combo_name='ELU')",
  "import sys",
  "(round(m.members['V1'].max_moment('Mz', 'ELU'), 1), round(m.nodes['N1'].RxnFY['ELU'], 1), getattr(sys.modules.get('matplotlib'), '__stub__', False), getattr(sys.modules.get('prettytable'), '__stub__', False), sorted(k for k in sys.modules if k.startswith('scipy.') and k.count('.') == 1), [round(float(x), 2) for x in _mq.flatten()])",
].join("\n");
const t1 = performance.now();
try {
  const r = py.runPython(PY).toJs();
  console.log(JSON.stringify({ dir, msPaquetes: Math.round(tPk), msImportYAnalisis: Math.round(performance.now() - t1), MzMaxV1: r[0], RyN1: r[1], matplotlibEsStub: r[2], prettytableEsStub: r[3], subpaquetesScipyCargados: r[4], momentosQuadQ1: r[5] }));
} catch (e) {
  const lineas = String(e.message).split("\n");
  console.log("ERROR PYTHON:\n" + lineas.slice(-10).join("\n"));
  process.exit(1);
}
