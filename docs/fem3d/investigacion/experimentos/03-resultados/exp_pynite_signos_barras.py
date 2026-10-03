# Experimento RES-E1a: convenciones de signo de esfuerzos en barras de PyNite 3.2.0
# Ménsula a lo largo de +X, empotrada en i (x=0), libre en j (x=L).
# Se aplican cargas unitarias en el extremo libre y se leen N, Vy, Vz, T, My, Mz
# en x=0 (empotramiento) y x=L/2 para deducir el criterio de signos.
import json
from Pynite import FEModel3D

L = 2.0
E, G, nu, rho = 30e9, 12.5e9, 0.2, 2500.0
A, Iy, Iz, J = 0.09, 6.75e-4, 6.75e-4, 1.14e-3


def cantilever(load_dir, P, axis_end=(L, 0.0, 0.0)):
    m = FEModel3D()
    m.add_node('i', 0, 0, 0)
    m.add_node('j', *axis_end)
    m.add_material('C', E, G, nu, rho)
    m.add_section('S', A, Iy, Iz, J)
    m.add_member('M', 'i', 'j', 'C', 'S')
    m.def_support('i', True, True, True, True, True, True)
    m.add_node_load('j', load_dir, P, case='C1')
    m.add_load_combo('K', {'C1': 1.0})
    m.analyze_linear()
    mem = m.members['M']
    out = {}
    for x in (0.0, L / 2):
        out[f'x={x}'] = {
            'N(axial)': mem.axial(x, 'K'),
            'Vy(shear Fy)': mem.shear('Fy', x, 'K'),
            'Vz(shear Fz)': mem.shear('Fz', x, 'K'),
            'T(torque)': mem.torque(x, 'K'),
            'My(moment My)': mem.moment('My', x, 'K'),
            'Mz(moment Mz)': mem.moment('Mz', x, 'K'),
        }
    T = mem.T()[:3, :3]
    R = m.nodes['i'].RxnFX['K'], m.nodes['i'].RxnFY['K'], m.nodes['i'].RxnFZ['K'], \
        m.nodes['i'].RxnMX['K'], m.nodes['i'].RxnMY['K'], m.nodes['i'].RxnMZ['K']
    return {'local_axes_rows_xyz': T.round(6).tolist(), 'results': out,
            'reaction_i[FX,FY,FZ,MX,MY,MZ]': [round(v, 6) for v in R]}


cases = {
    'FX=+1 (tracción)': ('FX', 1.0),
    'FY=-1 (hacia -Y, «gravedad» en PyNite)': ('FY', -1.0),
    'FZ=-1 (hacia -Z)': ('FZ', -1.0),
    'MX=+1 (torsor)': ('MX', 1.0),
}
res = {k: cantilever(*v) for k, v in cases.items()}

# Pilar vertical en convención Concreta (Z arriba): i=(0,0,0) → j=(0,0,3)
def column_zup(load_dir, P):
    m = FEModel3D()
    m.add_node('i', 0, 0, 0)
    m.add_node('j', 0, 0, 3.0)
    m.add_material('C', E, G, nu, rho)
    m.add_section('S', A, Iy, Iz, J)
    m.add_member('M', 'i', 'j', 'C', 'S')
    m.def_support('i', True, True, True, True, True, True)
    m.add_node_load('j', load_dir, P, case='C1')
    m.add_load_combo('K', {'C1': 1.0})
    m.analyze_linear()
    mem = m.members['M']
    return {'local_axes_rows_xyz': mem.T()[:3, :3].round(6).tolist(),
            'N(x=0)': mem.axial(0, 'K'), 'My(x=0)': mem.moment('My', 0, 'K'),
            'Mz(x=0)': mem.moment('Mz', 0, 'K')}

res['PILAR Z-arriba, FZ=-1 (compresión)'] = column_zup('FZ', -1.0)
res['PILAR Z-arriba, FX=+1 en cabeza'] = column_zup('FX', 1.0)
res['PILAR Z-arriba, FY=+1 en cabeza'] = column_zup('FY', 1.0)

for k, v in res.items():
    print("##", k)
    for kk, vv in v.items():
        print("  ", kk, json.dumps(vv, ensure_ascii=False))
