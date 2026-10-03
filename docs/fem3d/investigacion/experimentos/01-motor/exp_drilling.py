"""El muelle 'drilling' de Quad3D (rigidez diagonal sin acoplar = muelle a tierra) y el
equilibrio global de momentos. Edificio de modelo.py (Y-up), casos:
  W  : fuerzas en X_concreta en cabeza de pilares (sin torsión global);
  TOR: par torsor en planta (fuerzas opuestas en X en las fachadas y=0 e y=Ly·ny).
Se calcula ΣM respecto al eje vertical de reacciones + cargas aplicadas (debe ser 0) y el
momento absorbido por los muelles drilling: Σ k_rz·θ_normal en nudos de losa.
"""
import sys
import numpy as np
from Pynite import FEModel3D
import modelo, pynite_fast

nx, ny, st, s = 2, 2, 2, 1.0
m, meta = modelo.build(FEModel3D, nx=nx, ny=ny, storeys=st, s=s, yup=True)
F = 10000.0
xs, ys = meta['xs'], meta['ys']
for k in range(1, st + 1):
    # Concreta: fuerza +X en y=0 y -X en y=Ly·ny  -> par torsor alrededor de Z_concreta
    for i, x in enumerate(meta['gx']):
        ii = xs.index(x)
        m.add_node_load(f'N{ii}_0_{k}', 'FZ', +F, 'TOR')                 # X_c -> Z_p
        m.add_node_load(f'N{ii}_{len(ys)-1}_{k}', 'FZ', -F, 'TOR')
m.add_load_combo('TOR', {'TOR': 1.0})
pynite_fast.solve_linear(m)


def torque_balance(c):
    Mapp = 0.0
    Mr = 0.0
    for n in m.nodes.values():
        for d, v, case in n.NodeLoads:
            f = m.load_combos[c].factors.get(case)
            if f is None:
                continue
            Fv = np.zeros(3); Mv = np.zeros(3)
            idx = 'XYZ'.index(d[1])
            (Fv if d[0] == 'F' else Mv)[idx] = f * v
            r = np.array([n.X, n.Y, n.Z])
            Mapp += np.cross(r, Fv)[1] + Mv[1]  # eje vertical = Y_p
        Rf = np.array([n.RxnFX[c], n.RxnFY[c], n.RxnFZ[c]]); Rm = np.array([n.RxnMX[c], n.RxnMY[c], n.RxnMZ[c]])
        Mr += np.cross(np.array([n.X, n.Y, n.Z]), Rf)[1] + Rm[1]
    return Mapp, Mr


# momento absorbido por los muelles drilling (nudos no apoyados)
def drilling_moment(c):
    tot = 0.0
    for q in m.quads.values():
        q._local_coords()
        kb = q.ke_b()
        krz = kb[5, 5]
        Tm = q.T()[:3, :3]
        for nd in (q.i_node, q.j_node, q.m_node, q.n_node):
            th = Tm @ np.array([nd.RX[c], nd.RY[c], nd.RZ[c]])  # giro en ejes locales
            mloc = np.array([0, 0, krz * th[2]])
            tot += (Tm.T @ mloc)[1]
    return tot


for c in ('W', 'TOR', 'G'):
    Mapp, Mr = torque_balance(c)
    Md = drilling_moment(c)
    print(f'{c:4s} ΣM_vert: aplicado={Mapp:12.2f}  reacciones={Mr:12.2f}  desequilibrio={Mapp+Mr:10.2f} N·m '
          f'({abs(Mapp+Mr)/max(1, abs(Mapp))*100:.2f} % del aplicado)  absorbido por drilling={Md:10.2f}')
