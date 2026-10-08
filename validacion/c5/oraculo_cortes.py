"""Oráculo de C5 (criterio 4): machones y dinteles de ETABS 15c con OpenSeesPy ASDShellQ4.

Lee validacion/c5/etabs15c-modelos.json (bun validacion/c5/etabs15c-modelos.ts): por modelo, el modelo
analítico (como el oráculo de E6, `validacion/e6/oraculo_opensees.py`, del que se usa `resolver`) y
los cortes de sus machones y dinteles. Cada corte se calcula aquí aparte, con las fuerzas de los
elementos de OpenSees (eleResponse «forces», globales) y la misma definición que cortes.ts:
- lado de cada nudo: el signo de (X − O)·x, 0 a ≤ 1e-6 m;
- láminas que tocan el plano desde el lado A con el centroide dentro del rectángulo: la suma de sus
  fuerzas en sus nudos del plano (una que lo atraviese es un error);
- una restricción con nudos a los dos lados y alguno del lado A dentro del rectángulo no se puede
  calcular aquí: el corte se marca y no se compara.
Los esfuerzos son [N, Vy, Vz, T, My, Mz] con el convenio de las barras (My = −m_y); con `invertido`,
Vz y Mz cambian de signo, como en esfuerzosMuros.ts.

Uso: .venv312/Scripts/python.exe validacion/c5/oraculo_cortes.py
Escribe src/compilador/__fixtures__/opensees-c5.json: por modelo, corte y caso, los seis esfuerzos.
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


def cortar(modelo, corte, invertido, fuerzas):
    """Esfuerzos del corte con las fuerzas de los elementos (por lámina, 24 globales)."""
    O = corte["origen"]
    ex, ey, ez = ejes(corte)
    y0, y1 = corte.get("y", [0, 0])
    z0, z1 = corte.get("z", [0, 0])
    nudos = modelo["nudos"]

    def coord(p):
        d = [p[0] - O[0], p[1] - O[1], p[2] - O[2]]
        return [sum(d[i] * e[i] for i in range(3)) for e in (ex, ey, ez)]

    def dentro(p):
        _, cy, cz = coord(p)
        return y0 - TOL <= cy <= y1 + TOL and z0 - TOL <= cz <= z1 + TOL

    X = [(n["x"], n["y"], n["z"]) for n in nudos]
    lado = []
    for p in X:
        d = coord(p)[0]
        lado.append(0 if abs(d) <= TOL else (-1 if d < 0 else 1))
    F = [0.0] * 3
    M = [0.0] * 3
    for k, l in enumerate(modelo.get("laminas", [])):
        vs = l["nudos"]
        menos = sum(1 for v in vs if lado[v] < 0)
        mas = sum(1 for v in vs if lado[v] > 0)
        c = [sum(X[v][q] for v in vs) / 4 for q in range(3)]
        if menos == 0 or not dentro(c):
            continue
        if mas > 0:
            return None, "atraviesa"
        g = fuerzas[k]
        for a, v in enumerate(vs):
            if lado[v] != 0:
                continue
            f = g[6 * a : 6 * a + 3]
            m = g[6 * a + 3 : 6 * a + 6]
            r = [X[v][q] - O[q] for q in range(3)]
            for q in range(3):
                F[q] += f[q]
            M[0] += m[0] + r[1] * f[2] - r[2] * f[1]
            M[1] += m[1] + r[2] * f[0] - r[0] * f[2]
            M[2] += m[2] + r[0] * f[1] - r[1] * f[0]
    for r in modelo.get("restricciones", []):
        vs = [r["maestro"], *r["esclavos"]]
        en_a = [v for v in vs if lado[v] == -1]
        if not en_a or len(en_a) == len(vs):
            continue
        if any(dentro(X[v]) for v in en_a):
            return None, f"restricción {r['id']}"
    pr = lambda v, e: sum(v[i] * e[i] for i in range(3))  # noqa: E731
    s = [pr(F, ex), pr(F, ey), pr(F, ez), pr(M, ex), -pr(M, ey), pr(M, ez)]
    if invertido:
        s[2] = -s[2]
        s[5] = -s[5]
    return s, None


def main():
    entrada = json.load(open(os.path.join(AQUI, "etabs15c-modelos.json"), encoding="utf-8"))
    salida = {}
    for nombre, e in entrada.items():
        modelo = e["modelo"]
        t = time.perf_counter()
        res = {c["id"]: [] for c in e["cortes"]}
        notas = {}
        for caso in modelo["casos"]:
            resolver(modelo, caso)
            fuerzas = [ops.eleResponse(k + 1, "forces") for k in range(len(modelo.get("laminas", [])))]
            for c in e["cortes"]:
                s, nota = cortar(modelo, c["corte"], c["invertido"], fuerzas)
                if s is None:
                    notas[c["id"]] = nota
                    res[c["id"]].extend([None] * 6)
                else:
                    res[c["id"]].extend(s)
        salida[nombre] = {"esfuerzos": res, "notas": notas}
        print(nombre, f"{time.perf_counter() - t:.1f} s", f"{len(notas)} cortes sin comparar" if notas else "", flush=True)
    ruta = os.path.join(os.path.dirname(os.path.dirname(AQUI)), "src", "compilador", "__fixtures__", "opensees-c5.json")
    json.dump(salida, open(ruta, "w", encoding="utf-8"), indent=1)
    print("escrito", ruta)


if __name__ == "__main__":
    sys.exit(main())
