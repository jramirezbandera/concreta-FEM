"""Utilidades comunes para los experimentos de validación de PyNite 3.2.0.

Unidades: SI coherente (m, N, Pa) salvo que el benchmark fije otras.
Convención de nombres: nudo N_i_j en la posición (i, j) de la malla estructurada.
"""
from __future__ import annotations

import io
import contextlib
import math
import random
import time

import numpy as np
from Pynite import FEModel3D


def quiet(fn, *a, **k):
    """Ejecuta fn silenciando stdout (PyNite imprime en el chequeo de estabilidad)."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        return fn(*a, **k)


def build_square_plate(n, a=1.0, t=0.01, E=1.0e9, nu=0.3, q=1.0, bc="ss_hard",
                       elem="Quad", distort=0.0, seed=1, b=None):
    """Placa a x b en el plano XY (normal +Z), malla n x n estructurada.

    bc: 'ss_hard'  -> w = 0 y giro tangencial = 0 en el borde (Kirchhoff/«duro»)
        'ss_soft'  -> sólo w = 0 en el borde
        'clamped'  -> w = 0 y ambos giros = 0
    En todos los casos se coartan u, v en todos los nudos (problema puramente de flexión)
    y el giro de taladro RZ (sólo existe el muelle débil de PyNite).
    distort: fracción de h con la que se desplazan aleatoriamente los nudos interiores.
    """
    b = a if b is None else b
    m = FEModel3D()
    G = E / (2 * (1 + nu))
    m.add_material("M", E, G, nu, 0.0)
    rng = random.Random(seed)
    hx, hy = a / n, b / n
    for i in range(n + 1):
        for j in range(n + 1):
            x, y = i * hx, j * hy
            interior = 0 < i < n and 0 < j < n
            # no distorsionar el nudo central ni sus líneas medias (para medir en el centro)
            if distort and interior and not (2 * i == n or 2 * j == n):
                x += distort * hx * (2 * rng.random() - 1)
                y += distort * hy * (2 * rng.random() - 1)
            m.add_node(f"N_{i}_{j}", x, y, 0.0)
    for i in range(n):
        for j in range(n):
            ni, nj, nm, nn = f"N_{i}_{j}", f"N_{i+1}_{j}", f"N_{i+1}_{j+1}", f"N_{i}_{j+1}"
            name = f"E_{i}_{j}"
            if elem == "Quad":
                m.add_quad(name, ni, nj, nm, nn, t, "M")
            else:
                m.add_plate(name, ni, nj, nm, nn, t, "M")
    for i in range(n + 1):
        for j in range(n + 1):
            nm_ = f"N_{i}_{j}"
            on_x = i in (0, n)  # bordes x = 0 y x = a (borde paralelo a Y)
            on_y = j in (0, n)  # bordes y = 0 y y = b (borde paralelo a X)
            edge = on_x or on_y
            sDZ = edge
            sRX = sRY = False
            if bc == "ss_hard":
                # giro tangencial: borde paralelo a Y (on_x) -> giro alrededor de Y es normal;
                # el tangencial es RX (dw/dy). Borde paralelo a X -> tangencial RY.
                sRX = on_x
                sRY = on_y
            elif bc == "clamped":
                sRX = sRY = edge
            m.def_support(nm_, True, True, sDZ, sRX, sRY, True)
    for i in range(n):
        for j in range(n):
            name = f"E_{i}_{j}"
            if elem == "Quad":
                m.add_quad_surface_pressure(name, q, "D")
            else:
                m.add_plate_surface_pressure(name, q, "D")
    m.add_load_combo("C", {"D": 1.0})
    return m


def solve(m, check_stability=True):
    t0 = time.perf_counter()
    quiet(m.analyze_linear, check_stability=check_stability)
    return time.perf_counter() - t0


def elem_moment(m, name, xi, eta, elem="Quad", combo="C"):
    """Momentos locales [Mx, My, Mxy] del elemento en coordenadas naturales (-1..1)."""
    if elem == "Quad":
        e = m.quads[name]
        return np.array(e.moment(xi, eta, local=True, combo_name=combo)).flatten()
    e = m.plates[name]
    x = (xi + 1) / 2 * e.width()
    y = (eta + 1) / 2 * e.height()
    return np.array(e.moment(x, y, local=True, combo_name=combo)).flatten()


def elem_shear(m, name, xi, eta, elem="Quad", combo="C"):
    if elem == "Quad":
        e = m.quads[name]
        return np.array(e.shear(xi, eta, local=True, combo_name=combo)).flatten()
    e = m.plates[name]
    x = (xi + 1) / 2 * e.width()
    y = (eta + 1) / 2 * e.height()
    return np.array(e.shear(x, y, local=True, combo_name=combo)).flatten()


def center_moment_nodal_avg(m, n, elem="Quad"):
    """Media de los 4 elementos que comparten el nudo central (extrapolado a la esquina)."""
    c = n // 2
    vals = [elem_moment(m, f"E_{c-1}_{c-1}", 1, 1, elem),
            elem_moment(m, f"E_{c}_{c-1}", -1, 1, elem),
            elem_moment(m, f"E_{c}_{c}", -1, -1, elem),
            elem_moment(m, f"E_{c-1}_{c}", 1, -1, elem)]
    return np.mean(vals, axis=0), vals


def center_moment_centroid(m, n, elem="Quad"):
    """Valor en el centroide del elemento adyacente al centro (lo que daría un ResultModel 'centroid')."""
    c = n // 2
    return elem_moment(m, f"E_{c}_{c}", 0, 0, elem)


def rel(x, ref):
    return (x - ref) / ref


def observed_order(f1, f2, f3, r=2.0):
    """f1 fina, f2 media, f3 gruesa (Roache). Devuelve p, extrapolado, GCI_fino."""
    e32 = f3 - f2
    e21 = f2 - f1
    if e21 == 0 or e32 / e21 <= 0:
        return float("nan"), float("nan"), float("nan")
    p = math.log(abs(e32 / e21)) / math.log(r)
    fext = f1 + (f1 - f2) / (r**p - 1)
    gci = 1.25 * abs((f1 - f2) / f1) / (r**p - 1)
    return p, fext, gci
