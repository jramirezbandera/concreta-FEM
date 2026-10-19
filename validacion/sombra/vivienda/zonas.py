"""
Prueba en sombra de la vivienda (fase LV): dónde se separan nuestros momentos de vano de los de
CYPE. Para un campo y una planta, la razón nuestro/CYPE de los «grandes positivos» (más del 40 % del
máximo de CYPE) por casillas de la planta, con su número de nudos.

  .venv/Scripts/python.exe validacion/sombra/vivienda/zonas.py <carpeta de la variante> [<campo> <planta>]
  p. ej.: ... zonas.py validacion/sombra/vivienda/.datos/lv-cara my Cubierta
  Con un cuarto argumento `negativos`, los «grandes negativos» (apoyos, o la flecha en uz).
"""
import json, os, sys
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
AQUI = os.path.dirname(os.path.abspath(__file__))
dir_ = sys.argv[1]
campo = sys.argv[2] if len(sys.argv) > 2 else "my"
planta = sys.argv[3] if len(sys.argv) > 3 else "Cubierta"
negativos = len(sys.argv) > 4 and sys.argv[4] == "negativos"
cy = json.load(open(os.path.join(AQUI, ".datos", "cype.json")))
us = json.load(open(os.path.join(dir_, "nuestro.json")))
proyecto = json.load(open(os.path.join(dir_, "proyecto.json"), encoding="utf-8"))
PL = {"Planta 1": "CUB", "Cubierta": "CUB-S"}
F = {"ELU": {"PP": 1.35, "CM": 1.35, "Q": 1.5}, "PP+CM": {"PP": 1, "CM": 1}}
Q = {"mx": "m11", "my": "m22", "mxy": "m12", "uz": "uz"}
cap = cy["capturas"][f"{campo}|{planta}"]
ps = [p for p in proyecto["modelo"]["pilares"] if PL[planta] == "CUB" or p["hasta"] == "CUB-S"]
nod = [n for n in us["nudos"] if n["planta"] == planta]
X, Y, a, b = [], [], [], []
for n, c in zip(nod, cap["valores"]):
    v = n["v"][Q[campo]]
    if c is None or any(v[k] is None for k in F[cap["comb"]]): continue
    if min(max(abs(n["x"] - p["x"]), abs(n["y"] - p["y"])) for p in ps) - 0.15 < 0.5: continue
    X.append(n["x"]); Y.append(n["y"]); a.append(c); b.append(sum(f * v[k] for k, f in F[cap["comb"]].items()))
X, Y, a, b = map(np.array, (X, Y, a, b))
if negativos: a, b = -a, -b
g = a > 0.4 * a.max()
print(f"{planta} {campo}: {g.sum()} nudos grandes {'negativos' if negativos else 'positivos'}, mediana {np.median(b[g] / a[g]):.2f}")
paso = 1.0
xs = np.arange(np.floor(X[g].min()), X[g].max() + paso, paso)
ys = np.arange(np.floor(Y[g].min()), Y[g].max() + paso, paso)
print("y \\ x " + "".join(f"{x:7.1f}" for x in xs))
for y in ys[::-1]:
    fila = f"{y:5.1f} "
    for x in xs:
        s = g & (X >= x) & (X < x + paso) & (Y >= y) & (Y < y + paso)
        fila += f"{np.median(b[s] / a[s]):7.2f}" if s.sum() >= 3 else "      ·"
    print(fila)
