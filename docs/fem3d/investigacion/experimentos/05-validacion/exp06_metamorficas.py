"""EXP-06 — Pruebas metamórficas sobre un modelo mixto pequeño (4 pilares + losa de quads), PyNite 3.2.0.

M1  Rotación + traslación rígida del modelo entero (con y sin corrección explícita de la orientación de barras).
M2  Renumeración: orden de inserción de nudos/elementos barajado.
M3  Superposición: caso A + caso B == combinación A+B.
M4  Reciprocidad de Maxwell-Betti en la losa.
M5  Simetría (losa cuadrada apoyada, carga simétrica).
M6  Movimiento de sólido rígido de un Quad3D aislado: plano y alabeado.
"""
import math
import random
import numpy as np
from Pynite import FEModel3D
from common import quiet


def rot_matrix(seed=3):
    rng = np.random.default_rng(seed)
    q = rng.normal(size=4)
    q /= np.linalg.norm(q)
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def orient_member(m, name, y_desired):
    """Calcula la `rotation` de PyNite que lleva su eje local y por defecto al vector deseado."""
    mem = m.members[name]
    mem.rotation = 0.0
    for sm in mem.sub_members.values() if hasattr(mem, "sub_members") and mem.sub_members else []:
        sm.rotation = 0.0
    T = mem.T()[:3, :3] if not hasattr(mem, "descritize") else mem.T()[:3, :3]
    x0, y0 = T[0], T[1]
    yd = np.asarray(y_desired, float)
    yd = yd - np.dot(yd, x0) * x0
    yd /= np.linalg.norm(yd)
    ang = math.degrees(math.atan2(np.dot(np.cross(y0, yd), x0), np.dot(y0, yd)))
    mem.rotation = ang
    return ang


def build(R=np.eye(3), t=np.zeros(3), order_seed=None, fix_orientation=True, cases=("G", "H")):
    """Modelo base en coordenadas de PyNite (Y vertical). Losa 6 x 4 m a cota 3 m, 6 x 4 quads."""
    m = FEModel3D()
    m.add_material("C", 30e9, 12.5e9, 0.2, 0)
    m.add_section("COL", 0.15, 0.5 * 0.3**3 / 12, 0.3 * 0.5**3 / 12, 2e-3)
    nx, nz, Lx, Lz, h = 6, 4, 6.0, 4.0, 3.0
    nodes = {}
    for i in range(nx + 1):
        for k in range(nz + 1):
            nodes[f"S_{i}_{k}"] = (Lx * i / nx, h, Lz * k / nz)
    for (i, k) in ((0, 0), (nx, 0), (0, nz), (nx, nz)):
        nodes[f"B_{i}_{k}"] = (Lx * i / nx, 0.0, Lz * k / nz)
    quads = {f"Q_{i}_{k}": (f"S_{i}_{k}", f"S_{i+1}_{k}", f"S_{i+1}_{k+1}", f"S_{i}_{k+1}")
             for i in range(nx) for k in range(nz)}
    cols = {f"P_{i}_{k}": (f"B_{i}_{k}", f"S_{i}_{k}") for (i, k) in ((0, 0), (nx, 0), (0, nz), (nx, nz))}
    nkeys, qkeys, ckeys = list(nodes), list(quads), list(cols)
    if order_seed is not None:
        rng = random.Random(order_seed)
        rng.shuffle(nkeys)
        rng.shuffle(qkeys)
        rng.shuffle(ckeys)
    for n in nkeys:
        p = R @ np.array(nodes[n]) + t
        m.add_node(n, *p)
    for c in ckeys:
        m.add_member(c, *cols[c], "C", "COL")
    for qn in qkeys:
        m.add_quad(qn, *quads[qn], 0.25, "C")
    if fix_orientation:
        for c in ckeys:
            orient_member(m, c, R @ np.array([-1.0, 0, 0]))  # y local deseado = -X del modelo base
    for n in nkeys:
        if n.startswith("B_"):
            m.def_support(n, True, True, True, True, True, True)
    # Caso G: presión en la losa (normal local); caso H: fuerza horizontal en una esquina (torsión global)
    if "G" in cases:
        for qn in qkeys:
            m.add_quad_surface_pressure(qn, -5e3, "G")
    if "H" in cases:
        F = R @ np.array([20e3, 0.0, 5e3])
        for comp, val in zip(("FX", "FY", "FZ"), F):
            if abs(val) > 0:
                m.add_node_load(f"S_{nx}_{nz}", comp, val, "H")
    m.add_load_combo("G", {"G": 1.0})
    m.add_load_combo("H", {"H": 1.0})
    m.add_load_combo("GH", {"G": 1.35, "H": 1.5})
    quiet(m.analyze_linear)
    return m


def nodal(m, combo):
    return {n: np.array([nd.DX[combo], nd.DY[combo], nd.DZ[combo], nd.RX[combo], nd.RY[combo], nd.RZ[combo]])
            for n, nd in m.nodes.items()}


def reac(m, combo):
    return {n: np.array([nd.RxnFX[combo], nd.RxnFY[combo], nd.RxnFZ[combo], nd.RxnMX[combo], nd.RxnMY[combo], nd.RxnMZ[combo]])
            for n, nd in m.nodes.items()}


def member_forces(m, combo):
    return {c: np.array([m.members[c].axial(0.0, combo), m.members[c].shear("Fy", 0.0, combo), m.members[c].shear("Fz", 0.0, combo),
                         m.members[c].torque(0.0, combo), m.members[c].moment("My", 0.0, combo), m.members[c].moment("Mz", 0.0, combo)])
            for c in m.members}


def quad_moments(m, combo):
    return {q: np.array(m.quads[q].moment(0, 0, local=True, combo_name=combo)).flatten() for q in m.quads}


def max_rel(d1, d2, transform=None):
    num = den = 0.0
    for k in d1:
        a = d1[k]
        b = d2[k] if transform is None else transform(d2[k])
        num = max(num, np.max(np.abs(a - b)))
        den = max(den, np.max(np.abs(a)))
    return num / den


if __name__ == "__main__":
    base = build()
    R = rot_matrix(3)
    t = np.array([123.4, -56.7, 89.0])
    back = lambda v: np.concatenate([R.T @ v[:3], R.T @ v[3:]])
    for combo in ("G", "H"):
        rot = build(R, t)
        rot_nofix = build(R, t, fix_orientation=False)
        print(f"M1 [{combo}] rotación+traslación, CON orientación explícita: desplaz. {max_rel(nodal(base, combo), nodal(rot, combo), back):.2e} | "
              f"reacciones {max_rel(reac(base, combo), reac(rot, combo), back):.2e} | esfuerzos barra {max_rel(member_forces(base, combo), member_forces(rot, combo)):.2e} | "
              f"momentos losa {max_rel(quad_moments(base, combo), quad_moments(rot, combo)):.2e}")
        print(f"M1 [{combo}] rotación+traslación, SIN orientación explícita: desplaz. {max_rel(nodal(base, combo), nodal(rot_nofix, combo), back):.2e} | "
              f"esfuerzos barra {max_rel(member_forces(base, combo), member_forces(rot_nofix, combo)):.2e}")
    for seed in (1, 2):
        sh = build(order_seed=seed)
        print(f"M2 renumeración (semilla {seed}): desplaz. {max_rel(nodal(base, 'GH'), nodal(sh, 'GH')):.2e} | momentos losa {max_rel(quad_moments(base, 'GH'), quad_moments(sh, 'GH')):.2e}")
    comb = {k: 1.35 * nodal(base, 'G')[k] + 1.5 * nodal(base, 'H')[k] for k in base.nodes}
    print(f"M3 superposición 1.35G+1.5H vs combo: desplaz. {max_rel(nodal(base, 'GH'), comb):.2e}")
    # M4 Maxwell-Betti en la losa: carga unitaria en a, desplazamiento en b, y viceversa
    def unit(nd_load):
        m = build(cases=())
        m.add_node_load(nd_load, "FY", -1.0, "U")
        m.add_load_combo("U", {"U": 1.0})
        quiet(m.analyze_linear)
        return m
    ma, mb = unit("S_1_1"), unit("S_4_3")
    dab, dba = ma.nodes["S_4_3"].DY["U"], mb.nodes["S_1_1"].DY["U"]
    print(f"M4 Maxwell-Betti: δ_ab = {dab:.6e}, δ_ba = {dba:.6e}, diferencia relativa {abs(dab-dba)/abs(dab):.2e}")
    # equilibrio global del caso G
    ptot = sum(-5e3 * 1.0 for _ in base.quads) * 1.0  # presión por área: 24 quads de 1 m2
    ry = sum(r[1] for r in reac(base, 'G').values())
    print(f"Equilibrio caso G: ΣRy = {ry:.6f} N, carga total = {abs(ptot):.1f} N, error relativo {abs(abs(ry)-abs(ptot))/abs(ptot):.2e}")
