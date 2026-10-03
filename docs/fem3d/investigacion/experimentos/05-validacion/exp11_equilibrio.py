"""EXP-11 — Equilibrio global (fuerzas Y momentos) con láminas no coplanarias y conexiones barra–lámina.

Reproduce el escenario del issue #102 de PyNite («Model Fails Statics Checks», abierto desde 2021):
(a) muro + viga en su plano unida en un nudo (EXP-07a)
(b) muro en L (dos paños a 90°, quads no coplanarios) con carga horizontal oblicua y torsor
(c) cajón: 4 muros + losa de cubierta con carga vertical excéntrica
Mide |ΣF| y |ΣM| (respecto al origen) de reacciones + cargas, relativos a Σ|F| y Σ|F|·L.
"""
import numpy as np
from Pynite import FEModel3D
from common import quiet
import exp07_conexion as e7


def statics(m, combo, loads):
    """loads: lista de (x, y, z, Fx, Fy, Fz, Mx, My, Mz) aplicadas."""
    F = np.zeros(3)
    M = np.zeros(3)
    scaleF = 0.0
    Lref = 0.0
    for nd in m.nodes.values():
        r = np.array([nd.X, nd.Y, nd.Z])
        f = np.array([nd.RxnFX[combo], nd.RxnFY[combo], nd.RxnFZ[combo]])
        mm = np.array([nd.RxnMX[combo], nd.RxnMY[combo], nd.RxnMZ[combo]])
        F += f
        M += mm + np.cross(r, f)
        Lref = max(Lref, np.linalg.norm(r))
    for (x, y, z, fx, fy, fz, mx, my, mz) in loads:
        r = np.array([x, y, z])
        f = np.array([fx, fy, fz])
        F += f
        M += np.array([mx, my, mz]) + np.cross(r, f)
        scaleF += np.linalg.norm(f) + np.linalg.norm([mx, my, mz]) / max(Lref, 1)
    return np.linalg.norm(F) / scaleF, np.linalg.norm(M) / (scaleF * Lref)


def wall_L(n=6):
    m = FEModel3D()
    m.add_material("C", 30e9, 12.5e9, 0.2, 0)
    H, B = 3.0, 3.0
    # paño 1 en el plano XY (z = 0), paño 2 en el plano YZ (x = 0); arista común x = z = 0
    for i in range(n + 1):
        for j in range(n + 1):
            m.add_node(f"A_{i}_{j}", B * i / n, H * j / n, 0.0)
            if i > 0:
                m.add_node(f"B_{i}_{j}", 0.0, H * j / n, B * i / n)
    nameB = lambda i, j: f"A_0_{j}" if i == 0 else f"B_{i}_{j}"
    for i in range(n):
        for j in range(n):
            m.add_quad(f"QA_{i}_{j}", f"A_{i}_{j}", f"A_{i+1}_{j}", f"A_{i+1}_{j+1}", f"A_{i}_{j+1}", 0.25, "C")
            m.add_quad(f"QB_{i}_{j}", nameB(i, j), nameB(i + 1, j), nameB(i + 1, j + 1), nameB(i, j + 1), 0.25, "C")
    for nd in list(m.nodes):
        if m.nodes[nd].Y == 0:
            m.def_support(nd, True, True, True, True, True, True)
    loads = []
    tip = f"A_{n}_{n}"
    m.add_node_load(tip, "FX", 50e3, "L"); m.add_node_load(tip, "FZ", 30e3, "L")
    nd = m.nodes[tip]; loads.append((nd.X, nd.Y, nd.Z, 50e3, 0, 30e3, 0, 0, 0))
    tipB = f"B_{n}_{n}"
    m.add_node_load(tipB, "FX", -20e3, "L"); m.add_node_load(tipB, "MY", 10e3, "L")
    nd = m.nodes[tipB]; loads.append((nd.X, nd.Y, nd.Z, -20e3, 0, 0, 0, 10e3, 0))
    m.add_load_combo("C", {"L": 1.0})
    quiet(m.analyze_linear)
    return statics(m, "C", loads)


if __name__ == "__main__":
    for emb, lab in ((0, "(a) viga en el plano del muro, 1 nudo"), (6, "(a') viga embebida")):
        m = e7.wall_model(6)
        m.add_node("TIP", 3.0 + e7.L, 1.5, 0.0)
        m.add_member("VIGA", "W_6_3", "TIP", "C", "V")
        for k in range(emb):
            m.add_member(f"EMB{k}", f"W_{5-k}_3", f"W_{6-k}_3", "C", "V")
        m.add_node_load("TIP", "FY", -e7.P, "P")
        m.add_load_combo("C", {"P": 1.0})
        quiet(m.analyze_linear)
        f, mo = statics(m, "C", [(3.0 + e7.L, 1.5, 0.0, 0, -e7.P, 0, 0, 0, 0)])
        print(f"{lab:40s}: |ΣF|/Σ|F| = {f:.2e}   |ΣM|/(Σ|F|·L) = {mo:.2e}")
    f, mo = wall_L()
    print(f"{'(b) muro en L (quads no coplanarios)':40s}: |ΣF|/Σ|F| = {f:.2e}   |ΣM|/(Σ|F|·L) = {mo:.2e}")
