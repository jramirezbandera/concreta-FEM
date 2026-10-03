"""Oráculo del criterio 1 del spike E0: la DKMQ en TypeScript frente a Quad3D de PyNite 3.2.0.

Genera el fixture congelado src/elementos/__fixtures__/dkmq-pynite.json con:
  - elementos: rigidez de flexión 12×12 (GDL [w, θx, θy] por nudo, ejes locales de PyNite) y
    carga nodal de una presión unitaria, para cuadriláteros de formas y espesores variados;
  - modelos: placas completas en el plano XY (flexión pura) con sus desplazamientos nodales y
    los momentos y cortantes en el centroide y en un punto de Gauss de cada elemento.

Uso:  .venv/Scripts/python.exe spike/e0/dkmq/oraculo_pynite.py
Unidades kN–m (D1): E en kN/m², presión en kN/m².
"""
from __future__ import annotations

import contextlib
import io
import json
import math
import random
import sys
from pathlib import Path

import numpy as np
import Pynite
from Pynite import FEModel3D

RAIZ = Path(__file__).resolve().parents[3]
SALIDA = RAIZ / "src" / "elementos" / "__fixtures__" / "dkmq-pynite.json"

# Posiciones de los GDL de flexión (w = DZ, θx = RX, θy = RY) en el vector de 24 de Quad3D.
IDX_FLEXION = [2, 3, 4, 8, 9, 10, 14, 15, 16, 20, 21, 22]
GP = 1 / math.sqrt(3)


def silencio(fn, *a, **k):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*a, **k)


def lista(a) -> list[float]:
    return [float(v) for v in np.asarray(a, dtype=float).ravel()]


# ---------------------------------------------------------------- elementos
def elemento(nombre, X, t, E, nu):
    """X: 4 nudos 3D (en orden antihorario visto desde +z local)."""
    m = FEModel3D()
    m.add_material("M", E, E / (2 * (1 + nu)), nu, 0.0)
    for k, (x, y, z) in enumerate(X):
        m.add_node(f"N{k}", x, y, z)
    m.add_quad("Q", "N0", "N1", "N2", "N3", t, "M")
    m.add_quad_surface_pressure("Q", 1.0, "P")
    m.add_load_combo("C", {"P": 1.0})
    q = m.quads["Q"]
    ke = q.ke()  # recalcula los ejes locales
    kb = ke[np.ix_(IDX_FLEXION, IDX_FLEXION)]
    fer = q.fer("C")[IDX_FLEXION, 0]
    xy = [q.x1, q.y1, q.x2, q.y2, q.x3, q.y3, q.x4, q.y4]
    return dict(nombre=nombre, X=lista(X), xy=lista(xy), t=t, E=E, nu=nu,
                kb=lista(kb), f_presion_unitaria=lista(-fer))


def elementos():
    out = []
    E, nu = 3.0e7, 0.2
    base = {
        "cuadrado": [(0, 0), (1, 0), (1, 1), (0, 1)],
        "rectangulo_4a1": [(0, 0), (2, 0), (2, 0.5), (0, 0.5)],
        "paralelogramo": [(0, 0), (2, 0), (2.6, 1), (0.6, 1)],
        "trapecio": [(0, 0), (2, 0), (1.5, 1), (0.5, 1)],
        "distorsionado": [(0, 0), (1.3, 0), (1.5, 1.1), (-0.2, 0.8)],
    }
    for nombre, P in base.items():
        for t in (0.001, 0.02, 0.25, 0.6):
            out.append(elemento(f"{nombre}_t{t}", [(x, y, 0.0) for x, y in P], t, E, nu))
    # Cuadriláteros convexos aleatorios, girados en su plano (nudo 2 fuera del eje x).
    rng = random.Random(20261003)
    for k in range(12):
        while True:
            ang = sorted(rng.uniform(0, 2 * math.pi) for _ in range(4))
            r = [rng.uniform(0.6, 1.6) for _ in range(4)]
            P = [(ri * math.cos(a), ri * math.sin(a)) for ri, a in zip(r, ang)]
            # convexo y antihorario
            ok = True
            for i in range(4):
                (x0, y0), (x1, y1), (x2, y2) = P[i], P[(i + 1) % 4], P[(i + 2) % 4]
                if (x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1) <= 0.05:
                    ok = False
            if ok:
                break
        t = rng.choice([0.004, 0.05, 0.3, 0.9])
        nu_k = rng.choice([0.0, 0.2, 0.3, 0.45])
        out.append(elemento(f"aleatorio_{k}", [(x + 3.0, y - 1.0, 0.0) for x, y in P], t, E, nu_k))
    # Elementos fuera del plano XY: la rigidez local no depende de la orientación.
    c, s = math.cos(0.7), math.sin(0.7)
    for k, (nombre, P) in enumerate(list(base.items())[2:]):
        X = []
        for x, y in P:
            # giro de 0.7 rad alrededor de X y luego de 0.4 rad alrededor de Z
            p = np.array([x, y * c, y * s])
            g = np.array([[math.cos(0.4), -math.sin(0.4), 0], [math.sin(0.4), math.cos(0.4), 0], [0, 0, 1]]) @ p
            X.append(tuple(g + np.array([1.0, 2.0, 3.0])))
        out.append(elemento(f"{nombre}_inclinado", X, 0.2, E, 0.3))
    return out


# ---------------------------------------------------------------- modelos
def placa(nombre, nx, ny, a, b, t, E, nu, p, bordes, distorsion=0.0, semilla=1):
    """Placa a×b en XY, malla nx×ny. bordes: 'apoyada' (w = 0 y giro tangente = 0) o 'empotrada'.
    u, v y el drilling se coartan en todos los nudos: flexión pura."""
    m = FEModel3D()
    m.add_material("M", E, E / (2 * (1 + nu)), nu, 0.0)
    rng = random.Random(semilla)
    nudos = []
    for j in range(ny + 1):
        for i in range(nx + 1):
            x, y = a * i / nx, b * j / ny
            if distorsion and 0 < i < nx and 0 < j < ny:
                x += distorsion * a / nx * (2 * rng.random() - 1)
                y += distorsion * b / ny * (2 * rng.random() - 1)
            nudos.append((x, y, 0.0))
    nid = lambda i, j: j * (nx + 1) + i
    for k, (x, y, z) in enumerate(nudos):
        m.add_node(f"N{k}", x, y, z)
    quads = []
    for j in range(ny):
        for i in range(nx):
            q = [nid(i, j), nid(i + 1, j), nid(i + 1, j + 1), nid(i, j + 1)]
            quads.append(q)
            m.add_quad(f"Q{len(quads) - 1}", *(f"N{v}" for v in q), t, "M")
            m.add_quad_surface_pressure(f"Q{len(quads) - 1}", p, "P")
    apoyos = []
    for j in range(ny + 1):
        for i in range(nx + 1):
            bx, by = i in (0, nx), j in (0, ny)
            if bordes == "empotrada":
                rx = ry = bx or by
            else:
                # Apoyada «dura»: w = 0 y se coarta el giro de la normal en la dirección del borde.
                # En un borde x = cte (tangente y) es el giro alrededor de x, y viceversa.
                rx, ry = bx, by
            dz = bx or by
            mascara = [True, True, dz, rx, ry, True]
            m.def_support(f"N{nid(i, j)}", *mascara)
            apoyos.append(mascara)
    m.add_load_combo("C", {"P": 1.0})
    silencio(m.analyze_linear, check_statics=False)
    D = [[m.nodes[f"N{k}"].__dict__[g]["C"] for g in ("DX", "DY", "DZ", "RX", "RY", "RZ")] for k in range(len(nudos))]
    momentos, cortantes, momentos_gp, cortantes_gp = [], [], [], []
    for k in range(len(quads)):
        q = m.quads[f"Q{k}"]
        momentos.append(lista(q.moment(0.0, 0.0, True, "C")))
        cortantes.append(lista(q.shear(0.0, 0.0, True, "C")))
        momentos_gp.append(lista(q.moment(GP, -GP, True, "C")))
        cortantes_gp.append(lista(q.shear(GP, -GP, True, "C")))
    return dict(nombre=nombre, t=t, E=E, nu=nu, presion=p, nudos=[list(v) for v in nudos], quads=quads,
                apoyos=apoyos, desplazamientos=D, momentos_centroide=momentos, cortantes_centroide=cortantes,
                punto_gauss=[GP, -GP], momentos_gauss=momentos_gp, cortantes_gauss=cortantes_gp)


def modelos():
    E, nu = 3.0e7, 0.2
    return [
        placa("apoyada_8x8_delgada", 8, 8, 6.0, 6.0, 0.06, E, nu, -10.0, "apoyada"),
        placa("apoyada_8x8_gruesa", 8, 8, 6.0, 6.0, 1.2, E, nu, -10.0, "apoyada"),
        placa("apoyada_8x8_distorsionada", 8, 8, 6.0, 6.0, 0.25, E, nu, -10.0, "apoyada", distorsion=0.3),
        placa("empotrada_12x6_rectangular", 12, 6, 8.0, 4.0, 0.25, E, 0.3, -7.5, "empotrada"),
        placa("empotrada_10x10_distorsionada_delgada", 10, 10, 5.0, 5.0, 0.02, E, nu, -5.0, "empotrada",
              distorsion=0.35, semilla=7),
    ]


if __name__ == "__main__":
    datos = dict(
        generador="spike/e0/dkmq/oraculo_pynite.py",
        versiones=dict(pynite=getattr(Pynite, "__version__", "3.2.0"), numpy=np.__version__, python=sys.version.split()[0]),
        convenio=("kb: 12×12 por filas, GDL [w, θx, θy] por nudo en ejes locales de PyNite (x = 1→2, "
                  "z = x × (1→3)); f_presion_unitaria = −fer (fuerza nodal en +z local por p = 1). "
                  "Momentos y cortantes: Quad3D.moment/shear(local=True), convenio de PyNite (H02)."),
        elementos=elementos(),
        modelos=modelos(),
    )
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text(json.dumps(datos, indent=None, separators=(",", ":")) + "\n", encoding="utf8", newline="\n")
    print(f"{SALIDA.relative_to(RAIZ)}: {len(datos['elementos'])} elementos, {len(datos['modelos'])} modelos, "
          f"{SALIDA.stat().st_size / 1024:.0f} KiB")
