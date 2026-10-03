"""EXP-09 — Reproducibilidad entre entornos: mismo modelo, distintos numpy/scipy/Python. Imprime valores con 17 cifras."""
import sys, numpy, scipy, json
from common import build_square_plate, solve
from exp06_metamorficas import build
out = {"py": sys.version.split()[0], "numpy": numpy.__version__, "scipy": scipy.__version__}
m = build_square_plate(16, 1.0, 0.01, 30e9, 0.3, 10e3, "ss_hard", "Quad")
solve(m)
out["plate_w"] = repr(m.nodes["N_8_8"].DZ["C"])
out["plate_Mx"] = repr(float(m.quads["E_8_8"].moment(0, 0, True, "C")[0][0]))
mm = build()
out["mixed_DX"] = repr(mm.nodes["S_6_4"].DX["H"])
out["mixed_N"] = repr(float(mm.members["P_0_0"].axial(0.0, "GH")))
print(json.dumps(out))
