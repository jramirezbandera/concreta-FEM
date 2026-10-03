"""EXP-01d — Error de Qx del Quad3D en losas de esbeltez real (a/t = 10, 25, 40, 100), centroide del elemento junto al borde
(y = a/2) y a x = a/4. Referencia: Qx de Kirchhoff (Navier); para a/t=10 la de Mindlin coincide en placas apoyadas (Qx no depende de la teoría para SS duro)."""
from common import build_square_plate, solve, elem_shear
from refs import navier_ss_shear_twist
E, nu, q, a = 30e9, 0.2, 10e3, 1.0
for ah in (10, 25, 40, 100):
    for n in (8, 16, 32):
        m = build_square_plate(n, a, a/ah, E, nu, q, "ss_hard", "Quad")
        solve(m)
        h = a/n; c = n//2
        res = []
        for i in (0, n//4):
            xc, yc = (i+.5)*h, (c+.5)*h
            Q = elem_shear(m, f"E_{i}_{c}", 0, 0, "Quad")[0]/(q*a)
            ref = navier_ss_shear_twist(1, 1, xc, yc, nu, 401)[0]
            res.append(f"x={xc:.3f}: {(Q/ref-1)*100:+6.1f} %")
        print(f"a/t={ah:3d} malla {n:2d}: " + " | ".join(res), flush=True)
