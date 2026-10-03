"""PyNite 3.2.0 + driver propio (pynite_fast) sobre el edificio de referencia.
Uso: python exp_pynite.py VAR h storeys [--nodesc] [--save K11.npz] [--nx 10 --ny 8] [--permc COLAMD]
       [--memlimit MB]
Imprime una línea JSON con tamaños, tiempos por fase y pico de memoria.
  --nodesc : sustituye PhysMember.descritize (búsqueda O(barras x nudos) de nudos intermedios)
             por la misma función sin la búsqueda (el compilador garantiza que no hay nudos
             intermedios, H19).
"""
import sys, time, json, os, threading, inspect, textwrap

args = sys.argv[1:]
flags = {}
pos = []
i = 0
while i < len(args):
    a = args[i]
    if a in ('--nodesc',):
        flags[a[2:]] = True; i += 1
    elif a.startswith('--'):
        flags[a[2:]] = args[i + 1]; i += 2
    else:
        pos.append(a); i += 1
var, h, st = pos[0], float(pos[1]), int(pos[2])
nx = int(flags.get('nx', 10)); ny = int(flags.get('ny', 8))

PEAK = {'rss': 0}
try:
    import psutil
    _proc = psutil.Process()
    LIMIT = float(flags.get('memlimit', 7000)) * 2**20

    def _watch():
        while True:
            r = _proc.memory_info().rss
            PEAK['rss'] = max(PEAK['rss'], r)
            if r > LIMIT:
                print(json.dumps({'abort': 'memlimit', 'rss_MB': round(r / 2**20)}), flush=True)
                os._exit(3)
            time.sleep(0.2)
    threading.Thread(target=_watch, daemon=True).start()
except ImportError:
    psutil = None

import numpy as np
from Pynite import FEModel3D
import Pynite.PhysMember as PM
import edificio as ed, pyn_build, pynite_fast

if flags.get('nodesc'):
    src = textwrap.dedent(inspect.getsource(PM.PhysMember.descritize))
    src = src.replace('for node in self.model.nodes.values():', 'for node in ():')
    ns = {}
    exec(src, PM.__dict__, ns)
    PM.PhysMember.descritize = ns['descritize']

T = {}
t0 = time.perf_counter()
m = ed.build(var, h=h, storeys=st, nx=nx, ny=ny, irr=float(flags.get('irr', 0)))
T['gen_neutro'] = time.perf_counter() - t0
cnt = ed.conteos(m, pattern=False)
t0 = time.perf_counter()
M = pyn_build.to_pynite(m, FEModel3D)
T['build_pynite'] = time.perf_counter() - t0
info = {}
t0 = time.perf_counter()
pynite_fast.solve_linear(M, timings=T, permc=flags.get('permc', 'COLAMD'), save_k11=flags.get('save'), info=info)
t_solve = time.perf_counter() - t0
out = dict(case=f'{var} h={h} st={st} {nx}x{ny}', nodesc=bool(flags.get('nodesc')), **cnt, combos=len(M.load_combos),
           solve_total_s=round(t_solve, 3), **info,
           phases={k: round(v, 3) for k, v in sorted(T.items(), key=lambda x: -x[1])})
# sanity: equilibrio vertical del caso G (reacciones FY = carga total)
try:
    Ry = sum(n.RxnFY['G'] for n in M.nodes.values())
    Wq = float(-(m['cargas']['G']['quad_p'] * 0).sum())
    out['RxnFY_G_kN'] = round(Ry / 1e3, 1)
except Exception as e:
    out['eq_err'] = str(e)
if psutil:
    mi = _proc.memory_info()
    out['peak_mem_MB'] = round(max(getattr(mi, 'peak_wset', mi.rss), PEAK['rss']) / 2**20, 1)
print(json.dumps(out, ensure_ascii=False), flush=True)
