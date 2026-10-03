"""Fixture congelado de Wood–Armer: la implementación de la investigación (wood_armer.py, validada
contra LUSAS y contra el criterio de Johansen, H34) sobre puntos aleatorios que cubren las cuatro
ramas de cada cara.

Convenio de wood_armer.py: positivo = tracción en la cara inferior (= cara −z del motor, H02);
devuelve la cara superior con signo negativo. El fixture guarda la superior en valor absoluto.

Uso:  .venv/Scripts/python.exe validacion/dimensionado/oraculo_wood_armer.py
"""
import json
import sys
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "docs/fem3d/investigacion/experimentos/03-resultados"))
from wood_armer import wood_armer  # noqa: E402

rng = np.random.default_rng(20261003)
n = 2000
mx = rng.uniform(-100, 100, n)
my = rng.uniform(-100, 100, n)
mxy = rng.uniform(-60, 60, n)
# casos frontera: momentos nulos, Mxy nulo, ramas límite
extra = np.array([[0, 0, 0], [0, 0, 10], [10, 0, 0], [-10, -10, 10], [-10, -10, 9.99], [5, -20, 10], [-20, 5, 10], [0, -5, 3]], float)
mx, my, mxy = (np.concatenate([v, extra[:, k]]) for k, v in enumerate((mx, my, mxy)))
ib, jb, it, jt = wood_armer(mx, my, mxy)
filas = [[float(a), float(b), float(c), float(d), float(e), float(-f), float(-g)] for a, b, c, d, e, f, g in zip(mx, my, mxy, ib, jb, it, jt)]
salida = RAIZ / "src/dimensionado/__fixtures__/wood-armer-python.json"
salida.write_text(json.dumps({
    "generador": "validacion/dimensionado/oraculo_wood_armer.py",
    "columnas": ["mx", "my", "mxy", "inferiorX", "inferiorY", "superiorX", "superiorY"],
    "filas": filas,
}) + "\n", encoding="utf8", newline="\n")
print(f"{salida.relative_to(RAIZ)}: {len(filas)} puntos")
