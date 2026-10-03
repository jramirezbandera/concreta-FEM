"""EXP-02 — Comportamiento de membrana del Quad3D (Q4 isoparamétrico, integración completa 2x2).

(a) Viga recta en voladizo de MacNeal & Harder (1985): L=6, b=0.2, t=0.1, E=1e7, nu=0.3, malla 6x1
    regular / trapezoidal / paralelogramo; cargas: extensión, cortante en el plano, cortante fuera del plano.
    Referencias MH: 3.0e-5, 0.1081, 0.4321.
(b) Muro en voladizo con carga horizontal en cabeza (edificio): H=9 m (3 plantas), B=3 m, t=0.25 m,
    E=30 GPa, nu=0.2, P=100 kN repartida en los nudos de cabeza. Referencia viga de Timoshenko
    (kappa=5/6) y extrapolación de Richardson de la propia malla.
(c) Muro bajo H=B=3 m.
"""
import numpy as np
from Pynite import FEModel3D
from common import quiet, observed_order


def cantilever_mh(shape, load):
    m = FEModel3D()
    E, nu = 1e7, 0.3
    m.add_material("M", E, E / 2.6, nu, 0)
    L, b, t = 6.0, 0.2, 0.1
    for i in range(7):
        if shape == "rect" or i in (0, 6):
            xb = xt = float(i)
        elif shape == "trap":
            d = 0.1 if i % 2 else -0.1
            xb, xt = i + d, i - d
        else:  # paralelogramo
            xb, xt = i - 0.1, i + 0.1
        m.add_node(f"B{i}", xb, 0.0, 0.0)
        m.add_node(f"T{i}", xt, b, 0.0)
    for i in range(6):
        m.add_quad(f"Q{i}", f"B{i}", f"B{i+1}", f"T{i+1}", f"T{i}", t, "M")
    m.def_support("B0", True, True, True, True, True, True)
    m.def_support("T0", True, True, True, True, True, True)
    if load == "ext":
        for nd in ("B6", "T6"):
            m.add_node_load(nd, "FX", 0.5, "L")
    elif load == "inplane":
        for nd in ("B6", "T6"):
            m.add_node_load(nd, "FY", 0.5, "L")
    elif load == "outplane":
        for nd in ("B6", "T6"):
            m.add_node_load(nd, "FZ", 0.5, "L")
    m.add_load_combo("C", {"L": 1.0})
    quiet(m.analyze_linear)
    comp = {"ext": "DX", "inplane": "DY", "outplane": "DZ"}[load]
    return 0.5 * (getattr(m.nodes["B6"], comp)["C"] + getattr(m.nodes["T6"], comp)["C"])


def wall(nx, ny, H, B, t=0.25, E=30e9, nu=0.2, P=100e3, drill_fix=False):
    """Muro en plano XY: X horizontal (longitud B), Y vertical (altura H). Base empotrada."""
    m = FEModel3D()
    m.add_material("C", E, E / (2 * (1 + nu)), nu, 0)
    for i in range(nx + 1):
        for j in range(ny + 1):
            m.add_node(f"N_{i}_{j}", B * i / nx, H * j / ny, 0.0)
    for i in range(nx):
        for j in range(ny):
            m.add_quad(f"Q_{i}_{j}", f"N_{i}_{j}", f"N_{i+1}_{j}", f"N_{i+1}_{j+1}", f"N_{i}_{j+1}", t, "C")
    for i in range(nx + 1):
        for j in range(ny + 1):
            base = j == 0
            # Problema de membrana pura: coartar DZ, RX, RY en todos los nudos
            m.def_support(f"N_{i}_{j}", base, base, True, True, True, base or drill_fix)
    for i in range(nx + 1):
        w = 0.5 if i in (0, nx) else 1.0
        m.add_node_load(f"N_{i}_{ny}", "FX", P * w / nx, "L")
    m.add_load_combo("C", {"L": 1.0})
    quiet(m.analyze_linear)
    return np.mean([m.nodes[f"N_{i}_{ny}"].DX["C"] for i in range(nx + 1)])


def timoshenko_cantilever(P, H, B, t, E, nu, kappa=5 / 6):
    I = t * B**3 / 12
    A = t * B
    G = E / (2 * (1 + nu))
    return P * H**3 / (3 * E * I), P * H / (kappa * G * A)


if __name__ == "__main__":
    print("== (a) Viga recta de MacNeal-Harder (malla 6x1), desplazamiento normalizado = FE/ref")
    refs = {"ext": 3.0e-5, "inplane": 0.1081, "outplane": 0.4321}
    for shape in ("rect", "trap", "para"):
        vals = {ld: cantilever_mh(shape, ld) / refs[ld] for ld in refs}
        print(f"  {shape:5s}: extensión {vals['ext']:.4f} | cortante plano {vals['inplane']:.4f} | cortante fuera plano {vals['outplane']:.4f}")

    for label, H, B, meshes in (("(b) muro H=9, B=3 (H/B=3)", 9.0, 3.0, [(1, 3), (2, 6), (4, 12), (8, 24), (16, 48)]),
                                ("(c) muro H=3, B=3 (H/B=1)", 3.0, 3.0, [(1, 1), (2, 2), (4, 4), (8, 8), (16, 16), (32, 32)])):
        db, ds = timoshenko_cantilever(100e3, H, B, 0.25, 30e9, 0.2)
        print(f"\n== {label}: Timoshenko flexión {db*1e3:.4f} mm + cortante {ds*1e3:.4f} mm = {(db+ds)*1e3:.4f} mm")
        res = []
        for nx, ny in meshes:
            d = wall(nx, ny, H, B)
            res.append(d)
            print(f"  malla {nx:2d}x{ny:2d}: δ = {d*1e3:.4f} mm  ({(d/(db+ds)-1)*100:+.2f} % vs Timoshenko)")
        p, fext, gci = observed_order(res[-1], res[-2], res[-3])
        print(f"  Richardson: p = {p:.2f}, δ_ext = {fext*1e3:.4f} mm ({(fext/(db+ds)-1)*100:+.2f} % vs Timoshenko); GCI = {gci*100:.3f} %")
        print("  error de cada malla frente al extrapolado: " + ", ".join(f"{(r/fext-1)*100:+.1f} %" for r in res))
