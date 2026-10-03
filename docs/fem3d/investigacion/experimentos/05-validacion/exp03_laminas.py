"""EXP-03 — Benchmarks de lámina con Quad3D (facetas planas DKMQ + Q4 de membrana + taladro débil).

(1) Cubierta de Scordelis-Lo (MacNeal & Harder 1985): R=25, L=50, t=0.25, E=4.32e8, nu=0, peso 90/área,
    diafragmas rígidos en los extremos, bordes longitudinales libres, semiángulo 40°.
    Modelo de un cuarto con simetría. Magnitud: desplazamiento vertical en el centro del borde libre.
    Referencias: 0.3024 (MacNeal-Harder) y 0.3086 (Scordelis & Lo 1964).
(2) Cilindro pellizcado con diafragmas: R=300, L=600, t=3, E=3e6, nu=0.3, P=1 (dos cargas opuestas).
    Modelo de un octante. Magnitud: desplazamiento radial bajo la carga. Referencia 1.8248e-5.
Variantes: diafragma con y sin coacción del giro alrededor del eje del cilindro (θx).
"""
import sys
import math
import numpy as np
from Pynite import FEModel3D
from common import quiet


def cyl_model(n_ax, n_circ, R, x_len, phi_max_deg, t, E, nu, sym_x_at_end, bc_phi0, bc_phimax, theta_x_diaphragm):
    """Cilindro de eje X. Nudos (x_i, phi_j); y = R sin phi, z = R cos phi.
    x = 0: diafragma (u_y = u_z = 0 [+ θx]); x = x_len: plano de simetría (u_x = θy = θz = 0)."""
    m = FEModel3D()
    m.add_material("M", E, E / (2 * (1 + nu)), nu, 0)
    phis = [math.radians(phi_max_deg) * j / n_circ for j in range(n_circ + 1)]
    for i in range(n_ax + 1):
        x = x_len * i / n_ax
        for j, ph in enumerate(phis):
            m.add_node(f"N_{i}_{j}", x, R * math.sin(ph), R * math.cos(ph))
    for i in range(n_ax):
        for j in range(n_circ):
            m.add_quad(f"Q_{i}_{j}", f"N_{i}_{j}", f"N_{i+1}_{j}", f"N_{i+1}_{j+1}", f"N_{i}_{j+1}", t, "M")
    for i in range(n_ax + 1):
        for j in range(n_circ + 1):
            s = [False] * 6  # DX DY DZ RX RY RZ
            if i == 0:  # diafragma
                s[1] = s[2] = True
                if theta_x_diaphragm:
                    s[3] = True
            if i == n_ax:  # simetría plano x = x_len
                s[0] = s[4] = s[5] = True
            if j == 0 and bc_phi0 == "sym":  # plano y = 0
                s[1] = s[3] = s[5] = True
            if j == n_circ and bc_phimax == "sym_z":  # plano z = 0
                s[2] = s[3] = s[4] = True
            if any(s):
                m.def_support(f"N_{i}_{j}", *s)
    return m, phis


def scordelis_lo(n, theta_x_diaphragm=True):
    R, L, t, E, nu, g = 25.0, 50.0, 0.25, 4.32e8, 0.0, 90.0
    m, phis = cyl_model(n, n, R, L / 2, 40.0, t, E, nu, True, "sym", "free", theta_x_diaphragm)
    # carga de peso por área de cada elemento, repartida a partes iguales en sus 4 nudos
    loads = {}
    for name, q in m.quads.items():
        p = [np.array([nd.X, nd.Y, nd.Z]) for nd in (q.i_node, q.j_node, q.m_node, q.n_node)]
        area = 0.5 * np.linalg.norm(np.cross(p[2] - p[0], p[3] - p[1]))
        for nd in (q.i_node, q.j_node, q.m_node, q.n_node):
            loads[nd.name] = loads.get(nd.name, 0.0) - g * area / 4
    for nd, f in loads.items():
        m.add_node_load(nd, "FZ", f, "G")
    m.add_load_combo("C", {"G": 1.0})
    quiet(m.analyze_linear)
    return -m.nodes[f"N_{n}_{n}"].DZ["C"], sum(nd.RxnFZ["C"] for nd in m.nodes.values()), -sum(loads.values())


def pinched_cylinder(n, theta_x_diaphragm=True):
    R, L, t, E, nu, P = 300.0, 600.0, 3.0, 3e6, 0.3, 1.0
    # octante: x = 0 diafragma, x = 300 plano medio (simetría), phi 0..90
    m, phis = cyl_model(n, n, R, L / 2, 90.0, t, E, nu, True, "sym", "sym_z", theta_x_diaphragm)
    m.add_node_load(f"N_{n}_0", "FZ", -P / 4, "P")
    m.add_load_combo("C", {"P": 1.0})
    quiet(m.analyze_linear)
    return -m.nodes[f"N_{n}_0"].DZ["C"]


if __name__ == "__main__":
    meshes = [int(x) for x in (sys.argv[1].split(",") if len(sys.argv) > 1 else "4,8,16,32".split(","))]
    print("== Scordelis-Lo (u_z en el centro del borde libre). Ref 0.3024 (MH 1985) / 0.3086 (S&L 1964)")
    for thx in (True, False):
        for n in meshes:
            w, rz, ptot = scordelis_lo(n, thx)
            print(f"  θx diafragma={'fijo ' if thx else 'libre'} malla {n:2d}x{n:2d}: w = {w:.5f}  -> /0.3024 = {w/0.3024:.4f}  /0.3086 = {w/0.3086:.4f}   (ΣRz={rz:.2f}, carga={ptot:.2f})")
        sys.stdout.flush()
    print("\n== Cilindro pellizcado con diafragmas (desplazamiento radial bajo carga). Ref 1.8248e-5")
    for thx in (True, False):
        for n in meshes:
            w = pinched_cylinder(n, thx)
            print(f"  θx diafragma={'fijo ' if thx else 'libre'} malla {n:2d}x{n:2d}: w = {w:.5e}  -> normalizado {w/1.8248e-5:.4f}")
        sys.stdout.flush()
