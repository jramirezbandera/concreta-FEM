"""Oráculo externo de la fase F (criterio 3): las franjas de la losa plana de H25 con OpenSeesPy ASDShellQ4.

Lee validacion/f/opensees-modelos.json (bun validacion/f/opensees-modelos.ts): por modelo, el modelo
analítico (pilares como apoyos en su cabeza, cargas nodales) y las estaciones de sus franjas. Cada
estación se calcula aquí aparte, con las fuerzas de los elementos de OpenSees (eleResponse «forces»,
globales) y la misma definición que cortes.ts y esfuerzosFranjas.ts:
- lado de cada nudo: el signo de (X − O)·x, 0 a ≤ 1e-6 m;
- láminas no rígidas (no todos sus nudos en un mismo enlace) que tocan el plano desde el lado A con
  el centroide dentro del rectángulo de la recta entera; una que lo atraviese hace que la estación no
  se compare (una de paso que no cae en una recta de la malla);
- lo de cada lámina (el My de sus fuerzas en sus nudos del plano, My = −m·y) se reparte en el
  intervalo de la estación por la parte de su lado sobre la recta que cae en él.

Uso: .venv312/Scripts/python.exe validacion/f/oraculo_franjas.py → validacion/f/out_opensees.txt
"""
import json
import math
import os
import sys
import time

import openseespy.opensees as ops

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), "e6"))
from oraculo_opensees import resolver  # noqa: E402

TOL = 1e-6


def ejes(corte):
    x = corte["x"]
    nx = math.sqrt(sum(c * c for c in x))
    ex = [c / nx for c in x]
    vz = corte["vz"]
    p = sum(vz[i] * ex[i] for i in range(3))
    zp = [vz[i] - p * ex[i] for i in range(3)]
    nz = math.sqrt(sum(c * c for c in zp))
    ez = [c / nz for c in zp]
    ey = [ez[1] * ex[2] - ez[2] * ex[1], ez[2] * ex[0] - ez[0] * ex[2], ez[0] * ex[1] - ez[1] * ex[0]]
    return ex, ey, ez


def estacion(modelo, rigidas, e, fuerzas):
    """My del intervalo de la estación, o None si la recta atraviesa láminas."""
    c = e["corte"]
    O = c["origen"]
    ex, ey, ez = ejes(c)
    y0, y1 = c["y"]
    a0, a1 = e["intervalo"]
    X = [(n["x"], n["y"], n["z"]) for n in modelo["nudos"]]

    def coord(p):
        d = [p[0] - O[0], p[1] - O[1], p[2] - O[2]]
        return [sum(d[i] * v[i] for i in range(3)) for v in (ex, ey, ez)]

    lado = {}

    def ladoDe(v):
        if v not in lado:
            d = coord(X[v])[0]
            lado[v] = 0 if abs(d) <= TOL else (-1 if d < 0 else 1)
        return lado[v]

    my = 0.0
    for k, l in enumerate(modelo["laminas"]):
        if k in rigidas:
            continue
        vs = l["nudos"]
        ls = [ladoDe(v) for v in vs]
        menos = sum(1 for s in ls if s < 0)
        mas = sum(1 for s in ls if s > 0)
        cen = [sum(X[v][q] for v in vs) / 4 for q in range(3)]
        _, cy, cz = coord(cen)
        if menos == 0 or not (y0 - TOL <= cy <= y1 + TOL and -TOL <= cz <= TOL):
            continue
        if mas > 0:
            return None
        g = fuerzas[k]
        M = [0.0, 0.0, 0.0]
        ys = []
        for a, v in enumerate(vs):
            if ls[a] != 0:
                continue
            f = g[6 * a: 6 * a + 3]
            m = g[6 * a + 3: 6 * a + 6]
            r = [X[v][q] - O[q] for q in range(3)]
            M[0] += m[0] + r[1] * f[2] - r[2] * f[1]
            M[1] += m[1] + r[2] * f[0] - r[0] * f[2]
            M[2] += m[2] + r[0] * f[1] - r[1] * f[0]
            ys.append(coord(X[v])[1])
        if not ys:
            continue
        myl = -sum(M[i] * ey[i] for i in range(3))
        ya, yb = min(ys), max(ys)
        largo = yb - ya
        if largo > TOL:
            my += myl * max(0.0, min(yb, a1) - max(ya, a0)) / largo
        elif a0 < (ya + yb) / 2 < a1:
            my += myl
    return my


def main():
    entrada = json.load(open(os.path.join(AQUI, "opensees-modelos.json"), encoding="utf-8"))
    lineas = ["# Fase F, criterio 3: franjas de la losa plana de H25 frente a OpenSeesPy ASDShellQ4", ""]
    lineas.append("Mismo modelo en los dos (pilares como apoyos articulados en su cabeza, cargas nodales consistentes). Diferencia del My de cada estación sobre el mayor |My| de las estaciones del mismo tipo de la losa.")
    lineas.append("")
    lineas.append("modelo | tipo | estaciones comparadas (de) | diferencia media | máxima | máxima sobre su propio valor (|My| > 20 % del máx.)")
    for nombre, x in entrada.items():
        if "reticular" in nombre:
            continue  # el resolutor de E6 no sabe de multiplicadores
        modelo = x["modelo"]
        t = time.perf_counter()
        restr = modelo.get("restricciones", [])
        enlace = {}
        for i, r in enumerate(restr):
            if r["tipo"] == "enlace-rigido":
                for v in [r["maestro"], *r["esclavos"]]:
                    enlace[v] = i
        rigidas = {k for k, l in enumerate(modelo["laminas"]) if all(v in enlace for v in l["nudos"]) and len({enlace[v] for v in l["nudos"]}) == 1}
        caso = modelo["casos"][0]
        resolver(modelo, caso)
        fuerzas = [ops.eleResponse(k + 1, "forces") for k in range(len(modelo["laminas"]))]
        por_tipo = {}
        for e in x["estaciones"]:
            v = estacion(modelo, rigidas, e, fuerzas)
            por_tipo.setdefault(e["tipo"], []).append((e, v))
        for tipo, lista in por_tipo.items():
            comp = [(e["my"][0], v) for e, v in lista if v is not None]
            if not comp:
                lineas.append(f"{nombre} | {tipo} | 0 de {len(lista)} | — | — | —")
                continue
            mx = max(abs(m) for m, _ in comp)
            ds = [abs(m - v) / mx for m, v in comp]
            rel = [abs(m - v) / abs(v) for m, v in comp if abs(v) > 0.2 * mx]
            lineas.append(f"{nombre} | {tipo} | {len(comp)} de {len(lista)} | {100 * sum(ds) / len(ds):.2f} % | {100 * max(ds):.2f} % | {100 * max(rel or [0]):.2f} %")
            if tipo == "paso":
                # Las mismas estaciones con el motor por fuerzas nodales: el elemento (frente a OpenSees) y el método (campos frente a nodales)
                nod = [(e["myNodal"][0], v, e["my"][0]) for e, v in lista if v is not None and "myNodal" in e]
                if nod:
                    d1 = [abs(n - v) / mx for n, v, _ in nod]
                    d2 = [abs(c - n) / mx for n, _, c in nod]
                    lineas.append(f"{nombre} | paso, motor por fuerzas nodales frente a OpenSees | {len(nod)} | {100 * sum(d1) / len(d1):.2f} % | {100 * max(d1):.2f} % | —")
                    lineas.append(f"{nombre} | paso, motor por campos frente a por fuerzas nodales | {len(nod)} | {100 * sum(d2) / len(d2):.2f} % | {100 * max(d2):.2f} % | —")
        print(nombre, f"{time.perf_counter() - t:.1f} s", flush=True)
    open(os.path.join(AQUI, "out_opensees.txt"), "w", encoding="utf-8", newline="").write("\n".join(lineas) + "\n")
    print("\n".join(lineas))


if __name__ == "__main__":
    sys.exit(main())
