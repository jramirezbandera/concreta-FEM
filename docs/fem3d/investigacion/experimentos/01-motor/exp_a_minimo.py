"""Experimento (a): modelo mínimo (pórtico 2 plantas, 4 pilares, vigas, losa de quads).

Comprueba: equilibrio por caso, superposición (combo = suma de casos), extracción de
todas las componentes del ResultModel (§12), ejes locales con Z vertical, signo de
la presión en quads y convenio de giro `rotation`.
Uso: python exp_a_minimo.py [--yup]
"""
import sys, json, time, math
import numpy as np
from Pynite import FEModel3D
import modelo

YUP = '--yup' in sys.argv
t0 = time.perf_counter()
m, meta = modelo.build(FEModel3D, nx=1, ny=1, storeys=2, s=1.0, yup=YUP)
print('modelo', modelo.counts(m), 'yup' if YUP else 'zup')
m.analyze_linear(check_statics=False)
print(f'analyze_linear {time.perf_counter()-t0:.3f}s')

vert = 1 if YUP else 2  # índice de la vertical en coords PyNite
names = ['DX', 'DY', 'DZ']

# ---------- 1) Equilibrio por caso ----------
area = meta['nx'] * meta['Lx'] * meta['ny'] * meta['Ly']
st = meta['storeys']
Wmembers = 0.0
for pm in m.members.values():
    Wmembers += pm.material.rho * pm.section.A * pm.L()
applied = {
    'G': (-meta['q_G'] * area * st + Wmembers),  # peso (positivo hacia abajo) -> reacción vertical +
    'Q': (-meta['q_Q'] * area * st),
    'W': None,
}
for c in ('G', 'Q', 'W', 'ELU'):
    R = np.zeros(6)
    for n in m.nodes.values():
        R += [n.RxnFX[c], n.RxnFY[c], n.RxnFZ[c], n.RxnMX[c], n.RxnMY[c], n.RxnMZ[c]]
    print(f'Σreacciones[{c}] F=({R[0]:.3f}, {R[1]:.3f}, {R[2]:.3f}) N')
    if applied.get(c):
        Rv = R[vert]
        print(f'   vertical: reacción {Rv:.4f} vs carga {applied[c]:.4f}  err rel {abs(Rv-applied[c])/applied[c]:.2e}')
FW_tot = meta['F_W'] * 4 * st
hx = 2 if YUP else 0
Rw = sum(n.RxnFX[c] if not YUP else n.RxnFZ[c] for n in m.nodes.values() for c in ['W'])
print(f'   W horizontal: reacción {Rw:.4f} vs carga {-FW_tot:.4f}  err rel {abs(Rw+FW_tot)/FW_tot:.2e}')

# ---------- 2) Superposición ----------
fac = {'G': 1.35, 'Q': 1.5, 'W': 0.9}
D = {c: m._D[c].copy() for c in m.load_combos}
Dsup = sum(f * D[c] for c, f in fac.items())
print('superposición desplazamientos: max|ELU - Σ| / max|ELU| =', float(np.max(np.abs(D['ELU'] - Dsup)) / np.max(np.abs(D['ELU']))))

# ---------- 3) Extracción de esfuerzos de barra (N, Vy, Vz, T, My, Mz) ----------
def frame_block(pm, combo, n=5):
    L = pm.L()
    x = np.linspace(0, L, n)
    N = pm.axial_array(n, combo, x_array=x)[1]
    Vy = pm.shear_array('Fy', n, combo, x_array=x)[1]
    Vz = pm.shear_array('Fz', n, combo, x_array=x)[1]
    T = pm.torque_array(n, combo, x_array=x)[1]
    My = pm.moment_array('My', n, combo, x_array=x)[1]
    Mz = pm.moment_array('Mz', n, combo, x_array=x)[1]
    return np.vstack([N, Vy, Vz, T, My, Mz]).T  # (n,6)

maxerr = 0.0
for name, pm in m.members.items():
    B = {c: frame_block(pm, c) for c in m.load_combos}
    sup = sum(f * B[c] for c, f in fac.items())
    scale = max(1.0, np.max(np.abs(B['ELU'])))
    maxerr = max(maxerr, float(np.max(np.abs(B['ELU'] - sup)) / scale))
print('superposición esfuerzos de barra: max err rel =', maxerr)

# muestra: pilar de planta baja y viga X central
c0 = [k for k in m.members if k.startswith('C')][0]
bx = [k for k in m.members if k.startswith('BX')][0]
for k in (c0, bx):
    pm = m.members[k]
    print(k, 'L=%.3f' % pm.L(), 'subs', len(pm.sub_members))
    np.set_printoptions(precision=1, suppress=True, linewidth=140)
    print('  [N, Vy, Vz, T, My, Mz] caso G:\n', frame_block(pm, 'G'))
    print('  ejes locales (filas x,y,z) con rotation=0:\n', np.round(pm.T()[:3, :3], 6))

# ---------- 4) Quads: Mx,My,Mxy,Qx,Qy,Sx,Sy,Txy ----------
q = m.quads[next(iter(m.quads))]
loc = [(0, 0), (-1, -1), (1, -1), (1, 1), (-1, 1)]
for c in ('G',):
    for (xi, eta) in loc:
        M = q.moment(xi, eta, local=True, combo_name=c).flatten()
        Q = q.shear(xi, eta, local=True, combo_name=c).flatten()
        S = q.membrane(xi, eta, local=True, combo_name=c).flatten()
        print(f'quad {q.name} ({xi:+d},{eta:+d}) M={M} Q={Q} S={S} -> Nx,Ny,Nxy = {S*q.t}')
    print('quad ejes locales:\n', np.round(q.T()[:3, :3], 6))

# superposición quads
qerr = 0.0
for q in m.quads.values():
    vals = {}
    for c in m.load_combos:
        vals[c] = np.concatenate([q.moment(0, 0, True, c).flatten(), q.shear(0, 0, True, c).flatten(), q.membrane(0, 0, True, c).flatten()])
    sup = sum(f * vals[c] for c, f in fac.items())
    qerr = max(qerr, float(np.max(np.abs(vals['ELU'] - sup)) / max(1.0, np.max(np.abs(vals['ELU'])))))
print('superposición quads (centroide): max err rel =', qerr)

# ---------- 5) Losa: comprobación grosera del momento total en el vano ----------
# franja central de la losa en dirección X a x = Lx/2 : suma Mx*dy de los quads cortados
print('done', f'{time.perf_counter()-t0:.2f}s')
