"""Experimento de escalado: tiempo por fase y memoria de analyze_linear de PyNite 3.2.0.
Uso: python exp_scaling.py nx ny storeys s sparse(0/1) check_stability(0/1) results(0/1)
Imprime una línea JSON. Funciona igual en CPython y en Pyodide (sin psutil).
"""
import sys, time, json, functools
import numpy as np
from Pynite import FEModel3D, Analysis
import modelo

args = [a for a in sys.argv[1:] if not a.startswith('-')]
nx, ny, st = int(args[0]), int(args[1]), int(args[2])
s = float(args[3]); sparse = args[4] == '1'; cs = args[5] == '1'; do_res = args[6] == '1'

T = {}


def timed(owner, name, label=None):
    f = getattr(owner, name)
    lab = label or name

    @functools.wraps(f)
    def w(*a, **k):
        t = time.perf_counter()
        try:
            return f(*a, **k)
        finally:
            T[lab] = T.get(lab, 0.0) + time.perf_counter() - t
    setattr(owner, name, w)


timed(Analysis, '_prepare_model', 'prepare(renumber+descritize)')
timed(FEModel3D, 'Ke', 'Ke(ensamblado, incl. check)')
timed(Analysis, '_check_stability', 'check_stability(nodal)')
timed(Analysis, '_partition', 'partition')
timed(FEModel3D, 'FER', 'FER')
timed(FEModel3D, 'P', 'P')
timed(Analysis, '_solve_unknown_disp', 'solve(+residuo)')
timed(Analysis, '_store_displacements', 'store(unpartition)')
timed(Analysis, '_calc_reactions', 'reactions')

t0 = time.perf_counter()
m, meta = modelo.build(FEModel3D, nx=nx, ny=ny, storeys=st, s=s, yup=True)
t_build = time.perf_counter() - t0
cnt = modelo.counts(m)
t1 = time.perf_counter()
m.analyze_linear(sparse=sparse, check_stability=cs)
t_an = time.perf_counter() - t1

# equilibrio vertical caso G
Rv = sum(n.RxnFY['G'] for n in m.nodes.values())
area = nx * meta['Lx'] * ny * meta['Ly']
W = sum(pm.material.rho * pm.section.A * pm.L() for pm in m.members.values()) - meta['q_G'] * area * st
eq = abs(Rv - W) / W

t_res = None
if do_res:
    t2 = time.perf_counter()
    nst = 11
    nvals = 0
    for c in ('G', 'Q', 'W'):
        for pm in m.members.values():
            L = pm.L(); x = np.linspace(0, L, nst)
            blk = [pm.axial_array(nst, c, x_array=x)[1], pm.shear_array('Fy', nst, c, x_array=x)[1],
                   pm.shear_array('Fz', nst, c, x_array=x)[1], pm.torque_array(nst, c, x_array=x)[1],
                   pm.moment_array('My', nst, c, x_array=x)[1], pm.moment_array('Mz', nst, c, x_array=x)[1]]
            nvals += 6 * nst
        for q in m.quads.values():
            v = np.concatenate([q.membrane(0, 0, True, c).flatten() * q.t, q.moment(0, 0, True, c).flatten(),
                                q.shear(0, 0, True, c).flatten()])
            nvals += 8
    t_res = time.perf_counter() - t2

out = dict(case=f'{nx}x{ny}x{st} s={s}', sparse=sparse, check_stability=cs, **cnt, build_s=round(t_build, 3),
           analyze_s=round(t_an, 3), results_s=None if t_res is None else round(t_res, 3),
           eq_rel_err=float(f'{eq:.2e}'), phases={k: round(v, 3) for k, v in sorted(T.items(), key=lambda x: -x[1])})
try:
    import psutil
    mi = psutil.Process().memory_info()
    out['peak_mem_MB'] = round(getattr(mi, 'peak_wset', mi.rss) / 2**20, 1)
except ImportError:
    pass
print(json.dumps(out, ensure_ascii=False))
