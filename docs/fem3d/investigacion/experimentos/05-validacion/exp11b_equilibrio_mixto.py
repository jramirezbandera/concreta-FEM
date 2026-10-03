"""EXP-11b — Equilibrio de momentos en el modelo mixto de EXP-06 (4 pilares + losa) para G y H."""
import numpy as np
from exp06_metamorficas import build
from exp11_equilibrio import statics
m = build()
nx, nz = 6, 4
# G: presión -5e3 en 24 quads de 1 m2 (normal local); se reconstruye como fuerzas nodales equivalentes no disponibles -> usar sólo H
nd = m.nodes[f"S_{nx}_{nz}"]
f, mo = statics(m, "H", [(nd.X, nd.Y, nd.Z, 20e3, 0, 5e3, 0, 0, 0)])
print(f"Modelo mixto, caso H (fuerza horizontal excéntrica): |ΣF|/Σ|F| = {f:.2e}  |ΣM|/(Σ|F|·L) = {mo:.2e}")
# torsión en pilares (giro alrededor del eje vertical Y = taladro de la losa)
for c in m.members:
    print(c, "torsor en cabeza =", round(m.members[c].torque(2.9, "H"), 2), "N·m;  Mz base =", round(m.members[c].moment("Mz", 0.0, "H"), 1))
