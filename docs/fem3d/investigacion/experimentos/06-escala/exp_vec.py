"""Vía (b): ensamblado vectorizado + SuperLU. Funciona en CPython y en Pyodide.
Uso: python exp_vec.py VAR h storeys [--permc COLAMD|MMD_AT_PLUS_A] [--sym] [--save K11.npz] [--irr 0.1]
       [--memlimit MB] [--chunk 4000]
"""
import sys, time, json, os, threading

args = sys.argv[1:]
flags, pos, i = {}, [], 0
while i < len(args):
    a = args[i]
    if a in ('--sym', '--noasm', '--lean'):
        flags[a[2:]] = True; i += 1
    elif a.startswith('--'):
        flags[a[2:]] = args[i + 1]; i += 2
    else:
        pos.append(a); i += 1
var, h, st = pos[0], float(pos[1]), int(pos[2])

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
            time.sleep(0.1)
    threading.Thread(target=_watch, daemon=True).start()
except ImportError:
    psutil = None

import numpy as np
import edificio as ed, vec_asm

T = {}
t0 = time.perf_counter()
m = ed.build(var, h=h, storeys=st, irr=float(flags.get('irr', 0)))
T['gen_neutro'] = time.perf_counter() - t0
cnt = ed.conteos(m, pattern=False)
info = {}
t0 = time.perf_counter()
if flags.get('lean'):
    X1, T = vec_asm.solve_lean(m, permc=flags.get('permc', 'MMD_AT_PLUS_A'), T=T, info=info,
                               symmetric=bool(flags.get('sym')), chunk=int(flags.get('chunk', 2000)))
else:
    D, Rx, T = vec_asm.solve(m, permc=flags.get('permc', 'COLAMD'), T=T, save_k11=flags.get('save'), info=info,
                             symmetric=bool(flags.get('sym')))
tt = time.perf_counter() - t0
asm = sum(T.get(k, 0) for k in ('pattern', 'ke_quads', 'ke_barras', 'scatter', 'bsr', 'cargas', 'particion'))
out = dict(case=f'{var} h={h} st={st}', lean=bool(flags.get('lean')), permc=flags.get('permc', 'COLAMD'), sym=bool(flags.get('sym')), **cnt,
           total_s=round(tt, 3), ensamblado_s=round(asm, 3), **info,
           phases={k: round(v, 3) for k, v in sorted(T.items(), key=lambda x: -x[1])})
if psutil:
    mi = _proc.memory_info()
    out['peak_mem_MB'] = round(max(getattr(mi, 'peak_wset', mi.rss), PEAK['rss']) / 2**20, 1)
print(json.dumps(out, ensure_ascii=False), flush=True)
