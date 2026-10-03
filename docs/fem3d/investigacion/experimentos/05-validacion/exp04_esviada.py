"""EXP-04 — Placa esviada de Morley (rombo 30°) y uso indebido de Plate3D con cuadriláteros no rectangulares.

Morley (1963): rombo de lado L, ángulo agudo 30°, apoyo simple en los 4 bordes, carga uniforme q, nu=0.3.
Referencia Kirchhoff: w_c = 4.455e-4 q L^4 / D (centro).
Apoyo: w = 0 en todo el borde (apoyo «blando»: PyNite no permite coartar el giro tangencial de un borde
oblicuo porque los apoyos sólo existen en ejes globales).
"""
import math
import warnings
import numpy as np
from Pynite import FEModel3D
from common import quiet


def morley(n, elem="Quad", Lt=1000.0):
    L = 100.0
    t = L / Lt
    E, nu, q = 1e7, 0.3, 1.0
    D = E * t**3 / (12 * (1 - nu**2))
    ang = math.radians(30)
    m = FEModel3D()
    m.add_material("M", E, E / 2.6, nu, 0)
    for i in range(n + 1):
        for j in range(n + 1):
            x = L * i / n + L * j / n * math.cos(ang)
            y = L * j / n * math.sin(ang)
            m.add_node(f"N_{i}_{j}", x, y, 0.0)
    for i in range(n):
        for j in range(n):
            args = (f"E_{i}_{j}", f"N_{i}_{j}", f"N_{i+1}_{j}", f"N_{i+1}_{j+1}", f"N_{i}_{j+1}", t, "M")
            (m.add_quad if elem == "Quad" else m.add_plate)(*args)
            (m.add_quad_surface_pressure if elem == "Quad" else m.add_plate_surface_pressure)(f"E_{i}_{j}", q, "D")
    for i in range(n + 1):
        for j in range(n + 1):
            edge = i in (0, n) or j in (0, n)
            m.def_support(f"N_{i}_{j}", True, True, edge, False, False, True)
    m.add_load_combo("C", {"D": 1.0})
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        quiet(m.analyze_linear)
    wc = m.nodes[f"N_{n//2}_{n//2}"].DZ["C"]
    return wc * D / (q * L**4) / 1e-4, len(w)


if __name__ == "__main__":
    print("Placa de Morley 30°, L/t = 1000. w_c en unidades de 1e-4 qL^4/D. Ref Kirchhoff 4.455")
    for elem in ("Quad", "Rect"):
        for n in (4, 8, 16, 32):
            val, nw = morley(n, elem)
            print(f"  {elem:4s} {n:2d}x{n:2d}: w_c = {val:.4f}  ({(val/4.455-1)*100:+.2f} %)  avisos={nw}")
    print("\nIdem con L/t = 100 (Quad)")
    for n in (8, 16, 32):
        val, nw = morley(n, "Quad", 100.0)
        print(f"  Quad {n:2d}x{n:2d}: w_c = {val:.4f}  ({(val/4.455-1)*100:+.2f} %)")
