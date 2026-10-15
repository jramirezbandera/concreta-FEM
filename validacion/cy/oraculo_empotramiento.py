"""
Oráculo del criterio 4 de CY (`docs/fem3d/hipotesis-cype.md`): la rigidez local de una barra con
empotramiento parcial α en un extremo es α·K_biempotrada + (1 − α)·K_empotrada-articulada, con las
dos matrices de PyNite 3.2 (Euler–Bernoulli; los dos giros de flexión liberados en ese extremo).
Escribe las dos matrices en JSON para `empotramiento.ts`.

  .venv/Scripts/python.exe validacion/cy/oraculo_empotramiento.py > validacion/cy/oraculo_empotramiento.json
"""
import json
from Pynite import FEModel3D

E, G = 32837e3, 32837e3 / 2.4
A, Iy, Iz, J = 0.09, 0.3 * 0.4**3 / 12, 0.4 * 0.3**3 / 12, 1.5e-3
L = 3.2


def k_local(lib_i, lib_j):
    m = FEModel3D()
    m.add_node("a", 0, 0, 0)
    m.add_node("b", L, 0, 0)
    m.add_material("H", E, G, 0.2, 25)
    m.add_section("S", A, Iy, Iz, J)
    m.add_member("M", "a", "b", "H", "S")
    m.def_releases("M", Ryi=lib_i, Rzi=lib_i, Ryj=lib_j, Rzj=lib_j)
    m.def_support("a", True, True, True, True, True, True)
    m.def_support("b", True, True, True, True, True, True)
    m.analyze(check_statics=False)
    sub = m.members["M"].sub_members
    mm = list(sub.values())[0] if sub else m.members["M"]
    return [[float(x) for x in fila] for fila in mm.ke()]


print(json.dumps({"E": E, "G": G, "A": A, "Iy": Iy, "Iz": Iz, "J": J, "L": L,
                  "biempotrada": k_local(False, False), "articulada_i": k_local(True, False),
                  "articulada_j": k_local(False, True), "articulada_ij": k_local(True, True)}))
