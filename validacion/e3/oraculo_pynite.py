"""Oráculo de E3 con PyNite 3.2.0: placas planas en cualquier orientación (modelos-oraculo.json).

PyNite tiene la misma flexión DKMQ isótropa y la misma presión (funciones bilineales): con cargas
normales al plano y momentos en el plano, la membrana queda descargada y PyNite es un oráculo bit
a bit de la flexión.

Correspondencias:
- lámina → Quad3D (add_quad) con sus nudos en el mismo orden;
- carga de superficie [0, 0, p] en ejes locales → add_quad_surface_pressure(p) (positiva según
  +z local en los dos programas, H01);
- un caso → una combinación de factor 1.

Resultantes: PyNite da Mx, My, Mxy y Qx, Qy en sus ejes (x = i→j, z = x × (i→n)) y con Mx, My y
Mxy con el signo contrario al del motor (H02). Este oráculo los gira a los ejes de usuario del
motor con su propia implementación de la regla (eje 3 normal por el orden de los nudos; eje 1 =
eje1 proyectado o regla de CSI) y les cambia el signo. Salida por lámina: las 8 resultantes
[Nx, Ny, Nxy, Mx, My, Mxy, Qx, Qy] (N = 0: membrana descargada) en el centroide y en los 4 puntos
de Gauss, en el orden de los del motor.

Uso: .venv/Scripts/python.exe validacion/e3/oraculo_pynite.py
Escribe src/motor/__fixtures__/pynite-e3.json.
"""
import contextlib
import io
import json
import math
import os

import numpy as np
from Pynite import FEModel3D

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
GLOBALES = ["FX", "FY", "FZ", "MX", "MY", "MZ"]
GP = 1 / math.sqrt(3)
PUNTOS = [(-GP, -GP), (GP, -GP), (GP, GP), (-GP, GP)]


def ejes_usuario(X, eje1):
    """Ejes (e1, e2, e3) de la lámina con la regla del motor, escrita aquí de forma independiente."""
    X = np.asarray(X, dtype=float).reshape(4, 3)
    n = np.cross(X[2] - X[0], X[3] - X[1])
    e3 = n / np.linalg.norm(n)
    if eje1 is not None:
        v = np.asarray(eje1, dtype=float)
        v = v - np.dot(v, e3) * e3
        e1 = v / np.linalg.norm(v)
        e2 = np.cross(e3, e1)
    else:
        horizontal = math.hypot(e3[0], e3[1]) < 1e-3
        ref = np.array([0.0, 1.0, 0.0]) if horizontal else np.array([0.0, 0.0, 1.0])
        v = ref - np.dot(ref, e3) * e3
        e2 = v / np.linalg.norm(v)
        e1 = np.cross(e2, e3)
    return e1, e2, e3


def resolver(modelo):
    m = FEModel3D()
    nudos = modelo["nudos"]
    for k, n in enumerate(nudos):
        m.add_node(f"N{k}", n["x"], n["y"], n["z"])
    for a in modelo.get("apoyos", []):
        m.def_support(f"N{a['nudo']}", *a["coartados"])
    materiales = {}
    for l, lam in enumerate(modelo["laminas"]):
        mat = lam["material"]
        assert not lam.get("multiplicadores"), "PyNite no tiene multiplicadores de flexión (H55)"
        clave = (mat["E"], mat["nu"])
        if clave not in materiales:
            materiales[clave] = f"M{len(materiales)}"
            m.add_material(materiales[clave], mat["E"], mat["E"] / (2 * (1 + mat["nu"])), mat["nu"], 0.0)
        i, j, k2, n = (f"N{v}" for v in lam["nudos"])
        m.add_quad(f"Q{l}", i, j, k2, n, mat["t"], materiales[clave])
    for caso in modelo["casos"]:
        nombre = caso["id"]
        for c in caso.get("nodales", []):
            for g, v in enumerate(c["f"]):
                if v != 0:
                    m.add_node_load(f"N{c['nudo']}", GLOBALES[g], v, nombre)
        for c in caso.get("laminas", []):
            q = c["q"]
            assert c["tipo"] == "superficie" and c["ejes"] == "local" and not isinstance(q[0], list) and q[0] == 0 and q[1] == 0, "PyNite: sólo presión normal uniforme"
            m.add_quad_surface_pressure(f"Q{c['lamina']}", q[2], nombre)
        m.add_load_combo(f"C:{nombre}", {nombre: 1.0})

    with contextlib.redirect_stdout(io.StringIO()):
        m.analyze_linear(check_statics=False)

    salida = {}
    for caso in modelo["casos"]:
        combo = f"C:{caso['id']}"
        u, r = [], []
        for k in range(len(nudos)):
            n = m.nodes[f"N{k}"]
            u.extend([n.DX[combo], n.DY[combo], n.DZ[combo], n.RX[combo], n.RY[combo], n.RZ[combo]])
            r.extend([n.RxnFX[combo], n.RxnFY[combo], n.RxnFZ[combo], n.RxnMX[combo], n.RxnMY[combo], n.RxnMZ[combo]])
        centroide, gauss = [], []
        for l, lam in enumerate(modelo["laminas"]):
            q = m.quads[f"Q{l}"]
            Tp = q.T()[0:3, 0:3]  # filas: x, y, z de PyNite
            X = [c for v in lam["nudos"] for c in (nudos[v]["x"], nudos[v]["y"], nudos[v]["z"])]
            e1, e2, e3 = ejes_usuario(X, lam.get("eje1"))
            assert np.dot(e3, Tp[2]) > 1 - 1e-12, f"normal de Q{l}"
            # Q[a][b] = e_a · (eje b de PyNite), en el plano
            Q = np.array([[np.dot(e1, Tp[0]), np.dot(e1, Tp[1])], [np.dot(e2, Tp[0]), np.dot(e2, Tp[1])]])

            def girar(xi, eta):
                Mx, My, Mxy = np.asarray(q.moment(xi, eta, True, combo), dtype=float).ravel()
                Qx, Qy = np.asarray(q.shear(xi, eta, True, combo), dtype=float).ravel()
                Mu = Q @ np.array([[Mx, Mxy], [Mxy, My]]) @ Q.T
                Vu = Q @ np.array([Qx, Qy])
                # convenio del motor: M con el signo cambiado; Q igual (H02)
                return [0.0, 0.0, 0.0, -Mu[0, 0], -Mu[1, 1], -Mu[0, 1], Vu[0], Vu[1]]

            centroide.append(girar(0.0, 0.0))
            gauss.append([girar(xi, eta) for xi, eta in PUNTOS])
        salida[caso["id"]] = {"u": u, "reacciones": r, "centroide": centroide, "gauss": gauss}
    return salida


def main():
    with open(os.path.join(AQUI, "modelos-oraculo.json"), encoding="utf-8") as f:
        datos = json.load(f)
    import Pynite

    resultado = {"pynite": getattr(Pynite, "__version__", "3.2.0"), "modelos": {}}
    for nombre, modelo in datos.items():
        resultado["modelos"][nombre] = resolver(modelo)
        print(f"{nombre}: {len(modelo['laminas'])} láminas, {len(modelo['casos'])} casos")
    ruta = os.path.join(RAIZ, "src", "motor", "__fixtures__", "pynite-e3.json")
    with open(ruta, "w", encoding="utf-8", newline="\n") as f:
        json.dump(resultado, f)
    print(f"escrito {ruta}")


if __name__ == "__main__":
    main()
