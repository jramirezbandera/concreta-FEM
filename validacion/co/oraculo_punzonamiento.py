"""
Fase CO4, criterio 11 (docs/fem3d/comprobaciones.md §7): el punzonamiento frente a cuentas que no son
de Concreta ni del adaptador.

    python3 validacion/co/oraculo_punzonamiento.py     escribe validacion/co/oraculo-punzonamiento.json

Sin dependencias. Cada caso es un pilar rectangular (o circular) en una losa maciza, interior, de borde
o de esquina (enrasado o retranqueado `a` del borde), con una malla superior Øx/sx y Øy/sy, una carga V
y sus excentricidades, y, si los lleva, cercos de punzonamiento. Con las fórmulas del Código
Estructural, Anejo 19 §6.4 (las del Eurocódigo 2, EN 1992-1-1 §6.4), escritas aquí:

  - d = (dx + dy)/2, con dx = h − r − Øx/2 y dy = h − r − Øx − Øy/2 (la Y, por dentro de la X);
  - u1 a 2·d del área cargada (§6.4.2): interior 2·(c1 + c2) + 4·π·d; circular π·(D + 4·d); borde
    c2 + 2·c1 + 2·π·d; esquina c1 + c2 + π·d, con c1 la dimensión perpendicular al borde, prolongada
    hasta él si el pilar está retranqueado (figura 6.15);
  - β (§6.4.3): interior, 1 + k·(M/V)·u1/W1 en cada dirección, sumadas, con
    W1 = c1²/2 + c1·c2 + 4·c2·d + 16·d² + 2·π·d·c1 (6.41) y k de la tabla 6.1; circular,
    1 + 0,6·π·e/(D + 4·d) (6.42); borde, u1/u1* + k·(u1/W1)·e_par (6.44), con
    u1* = c2 + 2·mín(1,5·d; 0,5·c1) + 2·π·d, W1 = c2²/4 + c1·c2 + 4·c1·d + 8·d² + π·d·c2 (6.45) y k con
    c1/(2·c2); esquina, u1/u1* (6.46), con u1* = mín(1,5·d; 0,5·c1) + mín(1,5·d; 0,5·c2) + π·d;
  - vEd = β·V/(u1·d) (6.38);
  - vRd,c = máx(CRd,c·k·(100·ρl·fck)^(1/3); vmín) (6.47), con CRd,c = 0,18/γc, k = 1 + √(200/d) ≤ 2,
    ρl = √(ρx·ρy) ≤ 0,02 y vmín = 0,035·k^(3/2)·√fck;
  - vRd,máx = 0,4·ν·fcd en u0 (§6.4.5(3)), con ν = 0,6·(1 − fck/250): u0 = 2·(c1 + c2) interior, π·D
    circular, c2 + 3·d ≤ c2 + 2·c1 borde y 3·d ≤ c1 + c2 esquina;
  - con cercos verticales, vRd,cs = 0,75·vRd,c + 1,5·(d/sr)·Asw·fywd,ef/(u1·d) ≤ 1,5·vRd,c (6.52), con
    fywd,ef = 250 + 0,25·d ≤ fywd y Asw el de un perímetro (ramas por cara con losa × caras);
  - uout = β·V/(vRd,c·d) (6.54).
"""

import io
import json
import math
import os

GAMMA_C = 1.5
GAMMA_S = 1.15


def area(diam):
    return math.pi * diam * diam / 4


def k_tabla(r):
    t = [(0.5, 0.45), (1.0, 0.6), (2.0, 0.7), (3.0, 0.8)]
    if r <= t[0][0]:
        return t[0][1]
    for (r0, k0), (r1, k1) in zip(t, t[1:]):
        if r <= r1:
            return k0 + (k1 - k0) * (r - r0) / (r1 - r0)
    return t[-1][1]


def calcular(c):
    ox, sx = c["x"]
    oy, sy = c["y"]
    h, r = c["h"], c["recubrimiento"]
    d = ((h - r - ox / 2) + (h - r - ox - oy / 2)) / 2
    pos = c["posicion"]
    V = c["V"]
    # c1: la dimensión según la que va e1 (en borde, la perpendicular al borde); c2, la otra
    c1 = c["c1"] + (c.get("a", 0) if pos != "interior" else 0)
    c2 = c["c2"] + (c.get("a2", 0) if pos == "esquina" else 0)
    e1, e2 = c.get("e1", 0), c.get("e2", 0)
    if c.get("circular"):
        D = c["c1"]
        u1 = math.pi * (D + 4 * d)
        u0 = math.pi * D
        beta = 1 + 0.6 * math.pi * math.hypot(e1, e2) / (D + 4 * d)
        caras = 4
    elif pos == "interior":
        u1 = 2 * (c1 + c2) + 4 * math.pi * d
        u0 = 2 * (c1 + c2)
        W = lambda a, b: a * a / 2 + a * b + 4 * b * d + 16 * d * d + 2 * math.pi * d * a
        beta = 1 + k_tabla(c1 / c2) * abs(e1) * u1 / W(c1, c2) + k_tabla(c2 / c1) * abs(e2) * u1 / W(c2, c1)
        caras = 4
    elif pos == "borde":
        # e1, hacia dentro (no cuenta más que en u1*); e2, paralela al borde
        u1 = c2 + 2 * c1 + 2 * math.pi * d
        u0 = min(c2 + 3 * d, c2 + 2 * c1)
        u1s = c2 + 2 * min(1.5 * d, 0.5 * c1) + 2 * math.pi * d
        W1 = c2 * c2 / 4 + c1 * c2 + 4 * c1 * d + 8 * d * d + math.pi * d * c2
        beta = u1 / u1s + k_tabla(c1 / (2 * c2)) * (u1 / W1) * abs(e2)
        caras = 3
    else:
        u1 = c1 + c2 + math.pi * d
        u0 = min(3 * d, c1 + c2)
        u1s = min(1.5 * d, 0.5 * c1) + min(1.5 * d, 0.5 * c2) + math.pi * d
        beta = u1 / u1s
        caras = 2
    fck = c["fck"]
    k = min(1 + math.sqrt(200 / d), 2)
    rho = min(math.sqrt((area(ox) / sx / d) * (area(oy) / sy / d)), 0.02)
    vmin = 0.035 * k**1.5 * math.sqrt(fck)
    vRdc = max(0.18 / GAMMA_C * k * (100 * rho * fck) ** (1 / 3), vmin)
    vRdmax = 0.4 * 0.6 * (1 - fck / 250) * fck / GAMMA_C
    vEd = beta * V * 1000 / (u1 * d)
    vEd0 = beta * V * 1000 / (u0 * d)
    s = {"d": d, "u1": u1, "u0": u0, "beta": beta, "vEd": vEd, "vEd0": vEd0, "vRdc": vRdc, "vRdmax": vRdmax, "uout": beta * V * 1000 / (vRdc * d)}
    if "cercos" in c:
        diam, ramas, sr = c["cercos"]
        fywd = min(250 + 0.25 * d, c["fyk"] / GAMMA_S)
        bruto = 0.75 * vRdc + 1.5 * (d / sr) * caras * ramas * area(diam) * fywd / (u1 * d)
        s["vRdcs"] = min(bruto, 1.5 * vRdc)
    return s


BASE = {"h": 250, "recubrimiento": 30, "fck": 25, "fyk": 500, "c1": 400, "c2": 400, "x": [12, 150], "y": [12, 150], "V": 400}

CASOS = [
    {"id": "interior-centrado", "posicion": "interior"},
    {"id": "interior-excentrico", "posicion": "interior", "e1": 120, "e2": 60},
    {"id": "interior-rectangular", "posicion": "interior", "c1": 600, "c2": 300, "e1": 200, "x": [16, 150], "y": [12, 200]},
    {"id": "interior-cercos", "posicion": "interior", "V": 650, "e1": 80, "cercos": [8, 2, 150]},
    {"id": "interior-cercos-topados", "posicion": "interior", "V": 650, "cercos": [12, 4, 75]},
    {"id": "interior-circular", "posicion": "interior", "circular": True, "c1": 450, "e1": 100, "e2": 100, "h": 300, "fck": 30},
    {"id": "borde-enrasado", "posicion": "borde", "V": 200, "e1": 150, "e2": 90},
    {"id": "borde-retranqueado", "posicion": "borde", "V": 200, "a": 150, "e2": 50, "h": 300},
    {"id": "borde-cercos", "posicion": "borde", "V": 320, "e2": 40, "cercos": [8, 2, 125]},
    {"id": "esquina-enrasada", "posicion": "esquina", "V": 100, "e1": 100},
    {"id": "esquina-retranqueada", "posicion": "esquina", "V": 110, "a": 100, "a2": 200, "c1": 300, "c2": 500, "h": 280, "x": [16, 200], "y": [16, 200]},
    {"id": "interior-hormigon-alto", "posicion": "interior", "fck": 40, "h": 350, "x": [20, 125], "y": [20, 125], "V": 1200, "e2": 150},
]


def main():
    casos = []
    for c in CASOS:
        c = {**BASE, **c}
        casos.append({**c, **calcular(c)})
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "oraculo-punzonamiento.json")
    with io.open(ruta, "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps({"casos": casos}, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(casos)} casos en {ruta}")


if __name__ == "__main__":
    main()
