"""Oráculo del criterio 2 del spike E0: membrana con drilling frente a OpenSeesPy ASDShellQ4.

Genera src/elementos/__fixtures__/membrana-opensees.json con:
  - muro: voladizo H = 9, B = 3, t = 0,25, P = 100 kN repartida en la cabeza (H17), mallas
    1×3 … 16×48, desplazamiento medio de la cabeza;
  - viga_en_muro: muro 3×3×0,25 con la base empotrada y una viga 30×50 de 3 m en voladizo desde
    el borde a media altura, P = 50 kN en punta (H05), unida en un nudo o embebida;
  - macneal_harder: viga recta 6×0,2 de MacNeal–Harder con cortante y momento en el plano,
    mallas rectangular, trapezoidal y en paralelogramo.

Uso:  .venv312/Scripts/python.exe spike/e0/membrana/oraculo_opensees.py   (OpenSeesPy 3.8 sólo carga con Python 3.12 en Windows, H39)
Unidades kN–m (D1).
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import sys
from pathlib import Path

import openseespy.opensees as ops

RAIZ = Path(__file__).resolve().parents[3]
SALIDA = RAIZ / "src" / "elementos" / "__fixtures__" / "membrana-opensees.json"
ELEMENTOS = ("ASDShellQ4", "ShellDKGQ", "ShellMITC4")


@contextlib.contextmanager
def silencio():
    with contextlib.redirect_stdout(io.StringIO()):
        yield


def analizar():
    ops.system("UmfPack")
    ops.numberer("RCM")
    ops.constraints("Plain")
    ops.integrator("LoadControl", 1.0)
    ops.algorithm("Linear")
    ops.analysis("Static")
    assert ops.analyze(1) == 0


# ---------------------------------------------------------------- muro en voladizo (H17)
MURO = dict(H=9.0, B=3.0, t=0.25, E=3.0e7, nu=0.2, P=100.0)


def muro(nx, ny, elem):
    H, B, t, E, nu, P = (MURO[k] for k in ("H", "B", "t", "E", "nu", "P"))
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    ops.section("ElasticMembranePlateSection", 1, E, nu, t, 0.0)
    tag = lambda i, j: i * (ny + 1) + j + 1
    for i in range(nx + 1):
        for j in range(ny + 1):
            ops.node(tag(i, j), B * i / nx, H * j / ny, 0.0)
            base = 1 if j == 0 else 0
            ops.fix(tag(i, j), base, base, 1, 1, 1, base)
    e = 1
    for i in range(nx):
        for j in range(ny):
            ops.element(elem, e, tag(i, j), tag(i + 1, j), tag(i + 1, j + 1), tag(i, j + 1), 1)
            e += 1
    ops.timeSeries("Linear", 1)
    ops.pattern("Plain", 1, 1)
    for i in range(nx + 1):
        ops.load(tag(i, ny), P * (0.5 if i in (0, nx) else 1) / nx, 0, 0, 0, 0, 0)
    analizar()
    return sum(ops.nodeDisp(tag(i, ny), 1) for i in range(nx + 1)) / (nx + 1)


# ---------------------------------------------------------------- viga en el plano del muro (H05)
VIGA = dict(W=3.0, Hm=3.0, t=0.25, E=3.0e7, nu=0.2, b=0.30, h=0.50, L=3.0, P=50.0)


def viga_en_muro(n, embebida, elem="ASDShellQ4"):
    """embebida: nº de elementos que la viga se prolonga dentro del muro por la fila de nudos (0 = un nudo)."""
    W, Hm, t, E, nu, b, h, L, P = (VIGA[k] for k in ("W", "Hm", "t", "E", "nu", "b", "h", "L", "P"))
    G = E / (2 * (1 + nu))
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    ops.section("ElasticMembranePlateSection", 1, E, nu, t, 0.0)
    tag = lambda i, j: i * (n + 1) + j + 1
    for i in range(n + 1):
        for j in range(n + 1):
            ops.node(tag(i, j), W * i / n, Hm * j / n, 0.0)
            if j == 0:
                ops.fix(tag(i, j), 1, 1, 1, 1, 1, 1)
    e = 1
    for i in range(n):
        for j in range(n):
            ops.element(elem, e, tag(i, j), tag(i + 1, j), tag(i + 1, j + 1), tag(i, j + 1), 1)
            e += 1
    jm = n // 2
    punta = 100000
    ops.node(punta, W + L, Hm / 2, 0.0)
    # Barra: eje local x según +X, z local = Z global → flexión en el plano XY con Iz = b·h³/12
    ops.geomTransf("Linear", 1, 0.0, 0.0, 1.0)
    A, Iz, Iy, J = b * h, b * h**3 / 12, h * b**3 / 12, 3e-3
    ops.element("elasticBeamColumn", 50000, tag(n, jm), punta, A, E, G, J, Iy, Iz, 1)
    for k in range(embebida):
        ops.element("elasticBeamColumn", 50001 + k, tag(n - k - 1, jm), tag(n - k, jm), A, E, G, J, Iy, Iz, 1)
    ops.timeSeries("Linear", 1)
    ops.pattern("Plain", 1, 1)
    ops.load(punta, 0, -P, 0, 0, 0, 0)
    analizar()
    return dict(punta=-ops.nodeDisp(punta, 2), raiz=-ops.nodeDisp(tag(n, jm), 2), giro_raiz=ops.nodeDisp(tag(n, jm), 6))


# ---------------------------------------------------------------- MacNeal–Harder, viga recta
MH = dict(E=1.0e7, nu=0.3, t=0.1)


def mh_nudos(forma):
    """6 elementos de 1 × 0,2; forma: rectangular, trapezoidal (lados ±45°) o paralelogramo (45°)."""
    abajo = [(float(i), 0.0) for i in range(7)]
    if forma == "rectangular":
        arriba = [(float(i), 0.2) for i in range(7)]
    elif forma == "trapezoidal":
        arriba = [(0.0, 0.2)] + [(i + (0.1 if i % 2 else -0.1), 0.2) for i in range(1, 6)] + [(6.0, 0.2)]
        abajo = [(0.0, 0.0)] + [(i + (-0.1 if i % 2 else 0.1), 0.0) for i in range(1, 6)] + [(6.0, 0.0)]
    elif forma == "paralelogramo":
        arriba = [(0.0, 0.2)] + [(i + 0.2, 0.2) for i in range(1, 6)] + [(6.0, 0.2)]
    else:
        raise ValueError(forma)
    return abajo, arriba


def macneal_harder(forma, carga, elem):
    """carga: 'cortante' (P = 1 en punta, ref 0.1081) o 'momento' (M = 1 en punta, ref M·L²/(2EI) = 0.027)."""
    E, nu, t = MH["E"], MH["nu"], MH["t"]
    abajo, arriba = mh_nudos(forma)
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    ops.section("ElasticMembranePlateSection", 1, E, nu, t, 0.0)
    for i, ((xa, ya), (xb, yb)) in enumerate(zip(abajo, arriba)):
        ops.node(i + 1, xa, ya, 0.0)
        ops.node(i + 101, xb, yb, 0.0)
        empotr = 1 if i == 0 else 0
        ops.fix(i + 1, empotr, empotr, 1, 1, 1, empotr)
        ops.fix(i + 101, empotr, empotr, 1, 1, 1, empotr)
    for i in range(6):
        ops.element(elem, i + 1, i + 1, i + 2, i + 102, i + 101, 1)
    ops.timeSeries("Linear", 1)
    ops.pattern("Plain", 1, 1)
    if carga == "cortante":
        ops.load(7, 0, 0.5, 0, 0, 0, 0)
        ops.load(107, 0, 0.5, 0, 0, 0, 0)
    else:  # par de fuerzas axiales en punta: M = 1 (brazo 0,2)
        ops.load(7, 5.0, 0, 0, 0, 0, 0)
        ops.load(107, -5.0, 0, 0, 0, 0, 0)
    analizar()
    return 0.5 * (ops.nodeDisp(7, 2) + ops.nodeDisp(107, 2))


if __name__ == "__main__":
    with silencio():
        datos = dict(
            generador="spike/e0/membrana/oraculo_opensees.py",
            versiones=dict(opensees=str(ops.version()) if hasattr(ops, "version") else "3.8.0", python=sys.version.split()[0]),
            muro=dict(**MURO, timoshenko_mm=None, mallas=[]),
            viga_en_muro=dict(**VIGA, casos=[]),
            macneal_harder=dict(**MH, referencia=dict(cortante=0.1081, momento=36 / (2 * 1.0e7 * 0.1 * 0.2**3 / 12)), casos=[]),
        )
        H, B, t, E, nu, P = (MURO[k] for k in ("H", "B", "t", "E", "nu", "P"))
        G = E / (2 * (1 + nu))
        I = t * B**3 / 12
        datos["muro"]["timoshenko_mm"] = 1e3 * (P * H**3 / (3 * E * I) + P * H / (5 / 6 * G * B * t))
        for nx, ny in ((1, 3), (2, 6), (4, 12), (8, 24), (16, 48)):
            datos["muro"]["mallas"].append(dict(nx=nx, ny=ny, **{el: muro(nx, ny, el) for el in ELEMENTOS}))
        for n in (6, 12):
            for emb in (0, 1, 2, n) if n > 6 else (0, 1, n):
                datos["viga_en_muro"]["casos"].append(dict(n=n, embebida=emb, ASDShellQ4=viga_en_muro(n, emb)))
        for forma in ("rectangular", "trapezoidal", "paralelogramo"):
            for carga in ("cortante", "momento"):
                datos["macneal_harder"]["casos"].append(dict(forma=forma, carga=carga, **{el: macneal_harder(forma, carga, el) for el in ELEMENTOS}))
    SALIDA.write_text(json.dumps(datos, indent=1) + "\n", encoding="utf8", newline="\n")
    print(json.dumps(datos, indent=1))
