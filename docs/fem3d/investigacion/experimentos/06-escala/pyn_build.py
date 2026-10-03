"""Modelo neutro (edificio.py) -> PyNite FEModel3D, en Y-up (Xp, Yp, Zp) = (Yc, Zc, Xc) (H08)."""
from __future__ import annotations
import edificio as ed

# dirección global Concreta -> nombre de carga global PyNite
DIRC = {0: 'FZ', 1: 'FX', 2: 'FY'}


def to_pynite(m, FEModel3D, cases=None):
    M = FEModel3D()
    G = ed.E_C / (2 * (1 + ed.NU_C))
    M.add_material('HA', ed.E_C, G, ed.NU_C, ed.GAMMA_C)
    M.add_material('RIG', ed.ALPHA_PEN * ed.E_C, ed.ALPHA_PEN * G, ed.NU_C, 0.0)
    mats = ('HA', 'RIG')
    for s, (A, Iy, Iz, J) in enumerate(m['sec']):
        M.add_section(f'S{s}', float(A), float(Iy), float(Iz), float(J))
    xyz = m['xyz']
    names = [f'N{i}' for i in range(len(xyz))]
    for i, (x, y, z) in enumerate(xyz.tolist()):
        M.add_node(names[i], y, z, x)
    for i in m['fixed'].nonzero()[0].tolist():
        M.def_support(names[i], True, True, True, True, True, True)
    mem = m['mem'].tolist()
    rel = m['rel'].tolist()
    mnames = []
    for k, (i, j, tipo, s, mat) in enumerate(mem):
        nm = f'M{k}'
        M.add_member(nm, names[i], names[j], mats[mat], f'S{s}')
        if rel[k]:
            M.def_releases(nm, Rxi=True, Ryi=True, Rzi=True, Ryj=True, Rzj=True)
        mnames.append(nm)
    qn = []
    for k, ((a, b, c, d), t) in enumerate(zip(m['quads'].tolist(), m['qt'].tolist())):
        nm = f'Q{k}'
        M.add_quad(nm, names[a], names[b], names[c], names[d], t, 'HA')
        qn.append(nm)
    cases = cases or list(m['cargas'])
    for c in cases:
        L = m['cargas'][c]
        if 'quad_p' in L:
            p = L['quad_p']
            for k in p.nonzero()[0].tolist():
                M.add_quad_surface_pressure(qn[k], float(p[k]), c)
        if 'mem_w' in L:
            w = L['mem_w']
            for k in w.nonzero()[0].tolist():
                M.add_member_dist_load(mnames[k], 'FY', float(w[k]), float(w[k]), case=c)
        if 'nodal' in L:
            nodes, d, val = L['nodal']
            for i in nodes.tolist():
                M.add_node_load(names[i], DIRC[d], float(val), c)
        M.add_load_combo(c, {c: 1.0})
    return M
