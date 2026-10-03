"""EXP-06b — Modos de sólido rígido de un Quad3D aislado (plano y alabeado) y simetría de Ke."""
import numpy as np
from Pynite import FEModel3D

def quad_K(warp=0.0, t=0.2):
    m = FEModel3D()
    m.add_material("C", 30e9, 12.5e9, 0.2, 0)
    pts = [(0, 0, 0), (1.0, 0, 0), (1.1, 0.9, warp), (0.1, 1.0, 0)]
    for i, p in enumerate(pts):
        m.add_node(f"N{i}", *p)
    m.add_quad("Q", "N0", "N1", "N2", "N3", t, "C")
    q = m.quads["Q"]
    return q.Ke(), np.array(pts, float), q

for warp in (0.0, 0.01, 0.1):
    K, P, q = quad_K(warp)
    c = P.mean(axis=0)
    sym = np.linalg.norm(K - K.T) / np.linalg.norm(K)
    out = []
    for name, vec in (("Tx", (1, 0, 0, 0, 0, 0)), ("Ty", (0, 1, 0, 0, 0, 0)), ("Tz", (0, 0, 1, 0, 0, 0)),
                      ("Rx", "r0"), ("Ry", "r1"), ("Rz", "r2")):
        u = np.zeros(24)
        for k in range(4):
            if isinstance(vec, tuple):
                u[6*k:6*k+6] = vec
            else:
                w = np.zeros(3); w[int(vec[1])] = 1.0
                u[6*k:6*k+3] = np.cross(w, P[k] - c)
                u[6*k+3:6*k+6] = w
        f = K @ u
        # fuerza espuria relativa: |K u| / (|K| |u|)
        out.append(f"{name}: {np.linalg.norm(f)/(np.linalg.norm(K, 2)*np.linalg.norm(u)):.1e}")
    print(f"alabeo {warp:4.2f} m: asimetría ||K-K^T||/||K|| = {sym:.1e} | " + "  ".join(out))
