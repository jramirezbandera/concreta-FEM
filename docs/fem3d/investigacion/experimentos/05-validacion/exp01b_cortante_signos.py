"""EXP-01b — Cortantes Qx de Quad3D/Plate3D en puntos interiores y signos local/global de momentos."""
import numpy as np
from common import build_square_plate, solve, elem_moment, elem_shear
from refs import navier_ss_shear_twist, navier_ss
E, nu, q, a = 30e9, 0.3, 10e3, 1.0
t = a / 100
for elem in ("Quad", "Rect"):
    print(f"\n== {elem}: Qx en centroides de elementos de la fila y=a/2 (encima de la línea media)")
    for n in (8, 16, 32):
        m = build_square_plate(n, a, t, E, nu, q, "ss_hard", elem)
        solve(m)
        h = a / n
        c = n // 2
        out = []
        for i in (0, 1, n // 4):
            xc, yc = (i + .5) * h, (c + .5) * h
            Q = elem_shear(m, f"E_{i}_{c}", 0, 0, elem)[0] / (q * a)
            ref = navier_ss_shear_twist(1, 1, xc, yc, nu, 401)[0]
            out.append(f"x={xc:.4f}: Qx={Q:+.4f} ref={ref:+.4f} ({(abs(Q)/abs(ref)-1)*100:+.1f} %)")
        print(f" n={n}: " + " | ".join(out))
# signos local vs global (Quad): placa en XY, ejes locales = globales
m = build_square_plate(8, a, t, E, nu, q, "ss_hard", "Quad")
solve(m)
e = m.quads["E_4_4"]
print("\nQuad E_4_4 local  [Mx,My,Mxy] =", np.array(e.moment(0, 0, local=True, combo_name="C")).flatten() / (q * a * a))
print("Quad E_4_4 global [Mx,My,Mxy] =", np.array(e.moment(0, 0, local=False, combo_name="C")).flatten() / (q * a * a))
print("Quad E_4_4 local  [Qx,Qy] =", np.array(e.shear(0, 0, local=True, combo_name="C")).flatten() / (q * a))
print("Quad E_4_4 global [Qx,Qy,Qz] =", np.array(e.shear(0, 0, local=False, combo_name="C")).flatten() / (q * a))
print("Quad E_1_4 local  [Qx,Qy] =", np.array(m.quads["E_1_4"].shear(0, 0, local=True, combo_name="C")).flatten() / (q * a))
print("Quad E_1_4 global [Qx,Qy,Qz] =", np.array(m.quads["E_1_4"].shear(0, 0, local=False, combo_name="C")).flatten() / (q * a))
print("Quad E_4_1 local  [Qx,Qy] =", np.array(m.quads["E_4_1"].shear(0, 0, local=True, combo_name="C")).flatten() / (q * a))
print("Quad E_4_1 global [Qx,Qy,Qz] =", np.array(m.quads["E_4_1"].shear(0, 0, local=False, combo_name="C")).flatten() / (q * a))
