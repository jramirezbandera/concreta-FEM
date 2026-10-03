"""EXP-10 — Patch tests de MacNeal-Harder (1985) con Quad3D: membrana y flexión.

Parche 0.24 x 0.12 con nudos interiores (0.04,0.02), (0.18,0.03), (0.16,0.08), (0.08,0.08); 5 cuadriláteros.
E = 1e6, nu = 0.25, t = 0.001. Se imponen en los 4 nudos exteriores los movimientos del campo exacto.
Membrana: u = 1e-3 (x + y/2), v = 1e-3 (y + x/2) -> sx = sy = 1333.33, txy = 400.
Flexión:  w = 1e-3 (1 + x + y + x²/2 + xy/2 + y²/2)/2 -> |Mx| = |My| = D·0.625e-3, |Mxy| = D·(1-nu)·0.25e-3.
"""
import numpy as np
from Pynite import FEModel3D
from common import quiet

E, nu, t = 1e6, 0.25, 0.001
P = {1: (0, 0), 2: (0.24, 0), 3: (0.24, 0.12), 4: (0, 0.12), 5: (0.04, 0.02), 6: (0.18, 0.03), 7: (0.16, 0.08), 8: (0.08, 0.08)}
EL = {"A": (1, 2, 6, 5), "B": (2, 3, 7, 6), "C": (3, 4, 8, 7), "D": (4, 1, 5, 8), "E": (5, 6, 7, 8)}


def to_global(q, vec):
    """Gira un tensor plano [txx, tyy, txy] de los ejes del elemento (x = i->j) a los globales X, Y."""
    R = q.T()[:3, :3]
    loc = np.array([[vec[0], vec[2], 0], [vec[2], vec[1], 0], [0, 0, 0]])
    g = R.T @ loc @ R
    return np.array([g[0, 0], g[1, 1], g[0, 1]])


def model():
    m = FEModel3D()
    m.add_material("M", E, E / (2 * (1 + nu)), nu, 0)
    for k, (x, y) in P.items():
        m.add_node(f"N{k}", x, y, 0.0)
    for k, ns in EL.items():
        m.add_quad(k, *[f"N{n}" for n in ns], t, "M")
    return m


def membrane():
    m = model()
    u = lambda x, y: 1e-3 * (x + y / 2)
    v = lambda x, y: 1e-3 * (y + x / 2)
    for k, (x, y) in P.items():
        outer = k <= 4
        m.def_support(f"N{k}", outer, outer, True, True, True, outer)
        if outer:
            m.def_node_disp(f"N{k}", "DX", u(x, y))
            m.def_node_disp(f"N{k}", "DY", v(x, y))
    m.add_load_combo("C", {"Case 1": 1.0})
    quiet(m.analyze_linear)
    err_d = max(max(abs(m.nodes[f"N{k}"].DX["C"] - u(*P[k])), abs(m.nodes[f"N{k}"].DY["C"] - v(*P[k]))) for k in (5, 6, 7, 8)) / 1e-3 / 0.24
    s = np.array([to_global(m.quads[e], np.array(m.quads[e].membrane(xi, eta, True, "C")).flatten()) for e in EL for xi, eta in ((0, 0), (0.5, -0.3))])
    ref = np.array([1333.333333, 1333.333333, 400.0])
    err_s = np.max(np.abs(s - ref) / ref)
    return err_d, err_s, s[0]


def bending():
    m = model()
    w = lambda x, y: 1e-3 * (1 + x + y + x * x / 2 + x * y / 2 + y * y / 2) / 2
    rx = lambda x, y: 1e-3 * (1 + x / 2 + y) / 2       # dw/dy
    ry = lambda x, y: -1e-3 * (1 + x + y / 2) / 2      # -dw/dx
    for k, (x, y) in P.items():
        outer = k <= 4
        m.def_support(f"N{k}", True, True, outer, outer, outer, True)
        if outer:
            m.def_node_disp(f"N{k}", "DZ", w(x, y))
            m.def_node_disp(f"N{k}", "RX", rx(x, y))
            m.def_node_disp(f"N{k}", "RY", ry(x, y))
    m.add_load_combo("C", {"Case 1": 1.0})
    quiet(m.analyze_linear)
    err_d = max(abs(m.nodes[f"N{k}"].DZ["C"] - w(*P[k])) / w(*P[k]) for k in (5, 6, 7, 8))
    err_r = max(max(abs(m.nodes[f"N{k}"].RX["C"] - rx(*P[k])) / abs(rx(*P[k])), abs(m.nodes[f"N{k}"].RY["C"] - ry(*P[k])) / abs(ry(*P[k]))) for k in (5, 6, 7, 8))
    D = E * t**3 / (12 * (1 - nu**2))
    ref = np.array([D * 0.625e-3, D * 0.625e-3, D * (1 - nu) * 0.25e-3])
    M = np.array([to_global(m.quads[e], np.array(m.quads[e].moment(xi, eta, True, "C")).flatten()) for e in EL for xi, eta in ((0, 0), (0.5, -0.3))])
    err_m = np.max(np.abs(np.abs(M) - ref) / ref)
    Q = np.array([np.array(m.quads[e].shear(0, 0, True, "C")).flatten() for e in EL])
    return err_d, err_r, err_m, M[0], ref, np.max(np.abs(Q))


if __name__ == "__main__":
    ed, es, s0 = membrane()
    print(f"Membrana: error máx. desplazamientos interiores (rel. a 1e-3·0.24) = {ed:.2e}; error máx. tensiones = {es:.2e}; elemento A centroide [sx, sy, txy] = {np.round(s0, 4)}")
    ed, er, em, M0, ref, qmax = bending()
    print(f"Flexión:  error w interiores = {ed:.2e}; error giros = {er:.2e}; error momentos = {em:.2e}; M_A = {M0}, |ref| = {ref}; |Q|max espurio = {qmax:.2e}")
