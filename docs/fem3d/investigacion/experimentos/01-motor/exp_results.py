"""Coste de extracción de resultados (§12) y alternativa vectorizada para quads.
Uso: python exp_results.py nx ny storeys s ncases_extra
Mide: (1) barras con la API de PyNite (6 diagramas x 11 estaciones x caso);
      (2) quads con la API de PyNite (moment/shear/membrane en centroide x caso);
      (3) quads con operador lineal precalculado por elemento (8x24) aplicado a todos los casos.
"""
import sys, time, json
import numpy as np
from Pynite import FEModel3D
import modelo, pynite_fast

nx, ny, st = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]); s = float(sys.argv[4])
extra = int(sys.argv[5]) if len(sys.argv) > 5 else 0
FAST_ONLY = len(sys.argv) > 6 and sys.argv[6] == 'fast'
m, meta = modelo.build(FEModel3D, nx=nx, ny=ny, storeys=st, s=s, yup=True)
names = list(m.nodes)
for k in range(extra):
    c = f'X{k}'
    for n in names[k::max(1, len(names) // 20)][:20]:
        m.add_node_load(n, 'FX' if k % 2 else 'FZ', 1000.0 * (k + 1), c)
    m.add_load_combo(c, {c: 1.0})
pynite_fast.solve_linear(m)
combos = list(m.load_combos)
out = dict(case=f'{nx}x{ny}x{st} s={s}', combos=len(combos), **modelo.counts(m))

# (1) barras API PyNite
t = time.perf_counter()
nst = 11
mref = {}
for c in ([] if FAST_ONLY else combos):
    for pm in m.members.values():
        x = np.linspace(0, pm.L(), nst)
        mref[(pm.name, c)] = np.vstack([pm.axial_array(nst, c, x_array=x)[1], pm.shear_array('Fy', nst, c, x_array=x)[1], pm.shear_array('Fz', nst, c, x_array=x)[1],
        pm.torque_array(nst, c, x_array=x)[1], pm.moment_array('My', nst, c, x_array=x)[1], pm.moment_array('Mz', nst, c, x_array=x)[1]])
out['members_api_s'] = round(time.perf_counter() - t, 3)

# (4) barras híbrido: sin carga en el vano -> diagrama desde esfuerzos de extremo (vectorizado);
#     con carga en el vano -> API de PyNite
t = time.perf_counter()
Dmat0 = np.hstack([m._D[c] for c in combos])
mfast = {}
nloaded = 0
for pm in m.members.values():
    mb = next(iter(pm.sub_members.values()))
    ke, T = mb.ke(), mb.T()
    dofs = m._build_dof_vector(mb.i_node, mb.j_node)
    F = ke @ (T @ Dmat0[dofs, :])  # 12 x ncases (sin FER)
    x = np.linspace(0, pm.L(), nst)
    for j, c in enumerate(combos):
        cases = set(m.load_combos[c].factors)
        if any(l[3] in cases for l in mb.PtLoads) or any(l[5] in cases for l in mb.DistLoads):
            nloaded += 1
            mfast[(pm.name, c)] = np.vstack([pm.axial_array(nst, c, x_array=x)[1], pm.shear_array('Fy', nst, c, x_array=x)[1], pm.shear_array('Fz', nst, c, x_array=x)[1],
                pm.torque_array(nst, c, x_array=x)[1], pm.moment_array('My', nst, c, x_array=x)[1], pm.moment_array('Mz', nst, c, x_array=x)[1]])
        else:
            f = F[:, j]
            one = np.ones_like(x)
            mfast[(pm.name, c)] = np.vstack([f[0] * one, f[1] * one, f[2] * one, f[3] * one, -f[4] - f[2] * x, f[5] - f[1] * x])
out['members_hybrid_s'] = round(time.perf_counter() - t, 3)
out['members_hybrid_loaded_fraction'] = round(nloaded / (len(m.members) * len(combos)), 3)
errs = [0.0] + [float(np.max(np.abs(mfast[k] - mref[k])) / max(1.0, np.max(np.abs(mref[k])))) for k in mref]
out['members_hybrid_max_rel_err'] = float(f'{max(errs):.2e}')
rowerr = np.zeros(6) if FAST_ONLY else np.max([np.max(np.abs(mfast[k] - mref[k]), axis=1) / max(1.0, np.max(np.abs(mref[k]))) for k in mref], axis=0)
out['members_hybrid_rowerr[N,Vy,Vz,T,My,Mz]'] = [float(f'{e:.1e}') for e in rowerr]

# (2) quads API PyNite (centroide)
t = time.perf_counter()
ref = {}
for c in ([] if FAST_ONLY else combos):
    for q in m.quads.values():
        ref[(q.name, c)] = np.concatenate([q.membrane(0, 0, True, c).flatten() * q.t, q.moment(0, 0, True, c).flatten(),
                                           q.shear(0, 0, True, c).flatten()])
out['quads_api_s'] = round(time.perf_counter() - t, 3)

# (3) quads con operador lineal precalculado
t = time.perf_counter()
ndof = 6 * len(m.nodes)
Dmat = np.hstack([m._D[c] for c in combos])  # ndof x ncases
gp = 1 / 3 ** 0.5
pts = [(-gp, -gp), (gp, -gp), (gp, gp), (-gp, gp)]
Sb = np.zeros((12, 24))
for r, cidx in enumerate([2, 4, 3, 8, 10, 9, 14, 16, 15, 20, 22, 21]):
    Sb[r, cidx] = 1.0
Sb[:, [3, 9, 15, 21]] *= -1  # mismo cambio de signo que Quad3D.moment/shear
Sm = np.zeros((8, 24))
for r, cidx in enumerate([0, 1, 6, 7, 12, 13, 18, 19]):
    Sm[r, cidx] = 1.0
fast = {}
for q in m.quads.values():
    q._local_coords()
    T = q.T()
    Hb, Hs, Cm = q.Hb(), q.Hs(), q.Cm()
    op = np.zeros((8, 24))
    for p in pts:
        op[0:3] += q.t * Cm @ q.B_m(*p) @ Sm
        op[3:6] += Hb @ q.B_b(*p) @ Sb
        op[6:8] += Hs @ q.B_s(*p) @ Sb
    op = 0.25 * op @ T  # centroide = media de los 4 puntos de Gauss; global D -> local
    dofs = m._build_dof_vector(q.i_node, q.j_node, q.m_node, q.n_node)
    R = op @ Dmat[dofs, :]  # 8 x ncases
    for j, c in enumerate(combos):
        fast[(q.name, c)] = R[:, j]
out['quads_vectorized_s'] = round(time.perf_counter() - t, 3)
err = max([0.0] + [float(np.max(np.abs(fast[k] - ref[k])) / max(1.0, np.max(np.abs(ref[k])))) for k in ref])
out['quads_vectorized_max_rel_err'] = float(f'{err:.2e}')
print(json.dumps(out, ensure_ascii=False))
