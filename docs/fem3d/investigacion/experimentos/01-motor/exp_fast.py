"""Compara analyze_linear (PyNite 3.2.0) con el driver pynite_fast.solve_linear.
Uso: python exp_fast.py nx ny storeys s compare(0/1) ncases_extra
  ncases_extra: añade N casos simples extra (cargas nodales) para medir el coste por caso.
"""
import sys, time, json
import numpy as np
from Pynite import FEModel3D
import modelo, pynite_fast

nx, ny, st = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
s = float(sys.argv[4]); compare = sys.argv[5] == '1'; extra = int(sys.argv[6]) if len(sys.argv) > 6 else 0


def build():
    m, meta = modelo.build(FEModel3D, nx=nx, ny=ny, storeys=st, s=s, yup=True)
    # casos extra: fuerzas horizontales en nudos de cabeza de pilares con distintas direcciones
    names = list(m.nodes)
    for k in range(extra):
        c = f'X{k}'
        for n in names[k::max(1, len(names) // 20)][:20]:
            m.add_node_load(n, 'FX' if k % 2 else 'FZ', 1000.0 * (k + 1), c)
        m.add_load_combo(c, {c: 1.0})
    return m, meta


m, meta = build()
cnt = modelo.counts(m)
T = {}
t0 = time.perf_counter()
pynite_fast.solve_linear(m, timings=T)
t_fast = time.perf_counter() - t0
out = dict(case=f'{nx}x{ny}x{st} s={s}', combos=len(m.load_combos), **cnt, fast_s=round(t_fast, 3),
           fast_phases={k: round(v, 3) for k, v in sorted(T.items(), key=lambda x: -x[1])})
if compare:
    m2, _ = build()
    t0 = time.perf_counter()
    m2.analyze_linear()
    out['analyze_linear_s'] = round(time.perf_counter() - t0, 3)
    dmax = max(float(np.max(np.abs(m._D[c] - m2._D[c])) / max(1e-30, np.max(np.abs(m2._D[c])))) for c in m.load_combos)
    rmax = 0.0
    for c in m.load_combos:
        for n1 in m.nodes.values():
            n2 = m2.nodes[n1.name]
            for a in ('RxnFX', 'RxnFY', 'RxnFZ', 'RxnMX', 'RxnMY', 'RxnMZ'):
                rmax = max(rmax, abs(getattr(n1, a)[c] - getattr(n2, a)[c]))
    out['max_rel_diff_D'] = float(f'{dmax:.2e}')
    out['max_abs_diff_reac_N'] = float(f'{rmax:.2e}')
try:
    import psutil
    mi = psutil.Process().memory_info(); out['peak_mem_MB'] = round(getattr(mi, 'peak_wset', mi.rss) / 2**20, 1)
except ImportError:
    pass
print(json.dumps(out, ensure_ascii=False))
