"""EXP-01c — Salida global (local=False) de Quad3D: ¿funciona y con qué signos? Corre con el numpy del venv."""
import warnings, numpy as np
warnings.simplefilter("always")
from common import build_square_plate, solve
E, nu, q, a = 30e9, 0.3, 10e3, 1.0
m = build_square_plate(8, a, a/100, E, nu, q, "ss_hard", "Quad")
solve(m)
print("numpy", np.__version__)
for nm in ("E_4_4", "E_1_4", "E_4_1"):
    e = m.quads[nm]
    print(nm, "local  M =", np.round(np.array(e.moment(0, 0, local=True, combo_name="C")).flatten()/(q*a*a), 5),
          " Q =", np.round(np.array(e.shear(0, 0, local=True, combo_name="C")).flatten()/(q*a), 5),
          " S =", np.round(np.array(e.membrane(0, 0, local=True, combo_name="C")).flatten(), 3))
    for fn in ("moment", "shear", "membrane"):
        try:
            v = np.array(getattr(e, fn)(0, 0, local=False, combo_name="C")).flatten()
            print("   global", fn, np.round(v/(q*a*a) if fn=="moment" else v/(q*a) if fn=="shear" else v, 5))
        except Exception as ex:
            print("   global", fn, "ERROR:", type(ex).__name__, ex)
