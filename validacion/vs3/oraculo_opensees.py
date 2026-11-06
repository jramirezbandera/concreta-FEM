"""VS3, criterio 3 (docs/fem3d/viento-sismo.md §5): el análisis por espectros de respuesta de los
modelos de validacion/vs3/opensees-modelos.json (bun validacion/vs3/modelos-oraculo.ts) con
OpenSeesPy 3.8.

Cada modelo es un pórtico compilado (el modelo analítico del motor y la masa de cada diafragma), que
se monta como en VS2 (`validacion/vs2/oraculo_opensees.py`: elasticBeamColumn con -jntOffset,
rigidDiaphragm con la masa en el centro de masas, restricciones por transformación). Aquí:

- los modos, con `eigen` (-fullGenLapack) y `modalProperties`;
- el espectro de la NCSE-02, programado aquí aparte del texto de la norma (art. 2.2, 2.3, 2.5 y
  3.6.2.2): Sa(T) = αᵢ·ac·g, con αᵢ = α(T)·β si T ≥ TA y 1 + (2,5·β − 1)·T/TA si no. Va a OpenSees
  como una serie con un punto en el periodo de cada modo (entre puntos interpola, y así no interpola);
- la respuesta de cada modo en cada dirección, con `responseSpectrumAnalysis(serie, dirección,
  '-mode', i)`: los desplazamientos de unos nudos, las fuerzas de extremo de unas barras en sus ejes
  locales y la suma de las reacciones;
- y sus combinaciones, en Python: la raíz de la suma de los cuadrados con los pares de modos de
  periodos a menos del 10 % sumados en valor absoluto (art. 3.6.2.4), y la cuadrática completa del
  comentario C.3.6.2.4.

La respuesta de un modo no depende del signo con el que salga su forma (φ·Γ no cambia): se compara
con su signo, modo a modo.

Uso: .venv312/Scripts/python.exe validacion/vs3/oraculo_opensees.py
Escribe src/motor/__fixtures__/opensees-vs3.json (lo de OpenSees del modelo de la batería) y
validacion/vs3/out_opensees.txt (el resumen, también del grande).
"""
import contextlib
import io
import json
import math
import os
import sys
import time

import numpy as np
import openseespy.opensees as ops

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), "vs2"))
from oraculo_opensees import construir  # noqa: E402

# El que va a la batería de pruebas (el otro, sólo al informe)
EN_PRUEBAS = {"portico-3x3x2"}


def espectro_ncse02(e, mu):
    """Sa(T), m/s², del análisis por espectros de la NCSE-02 (del texto de la norma)."""
    ab, K, rho, C, omega = e["ab"], e["K"], e["rho"], e["C"], e["omega"]
    rab = rho * ab
    # art. 2.2: coeficiente de amplificación del terreno
    if rab <= 0.1:
        S = C / 1.25
    elif rab < 0.4:
        S = C / 1.25 + 3.33 * (rab - 0.1) * (1 - C / 1.25)
    else:
        S = 1.0
    ac = S * rho * ab
    TA, TB = K * C / 10, K * C / 2.5
    nu = (5 / omega) ** 0.4
    beta = nu / mu

    def alfa(T):
        # art. 3.6.2.2, con el espectro del art. 2.3
        if T < TA:
            return 1 + (2.5 * beta - 1) * T / TA
        return (2.5 if T <= TB else K * C / T) * beta

    return ac, TA, TB, beta, alfa


def proximos(Ti, Tj):
    return min(Ti, Tj) > 0.9 * max(Ti, Tj)


def srss(x, T):
    """Art. 3.6.2.4: raíz de la suma de los cuadrados; cada par de modos próximos, 2·|xi·xj| más."""
    s = sum(v * v for v in x)
    for i in range(len(x)):
        for j in range(i + 1, len(x)):
            if proximos(T[i], T[j]):
                s += 2 * abs(x[i] * x[j])
    return math.sqrt(s)


def cqc(x, T, omega):
    """C.3.6.2.4: S² = ΣΣ Si·Sj·πij, πij = 8·z²·(1 + f)·f^1,5 / [(1 − f²)² + 4·z²·f·(1 + f)²], f = Ti/Tj, z = Ω/100."""
    z = omega / 100
    s = 0.0
    for i in range(len(x)):
        for j in range(len(x)):
            f = T[i] / T[j]
            s += x[i] * x[j] * 8 * z * z * (1 + f) * f**1.5 / ((1 - f * f) ** 2 + 4 * z * z * f * (1 + f) ** 2)
    return math.sqrt(max(s, 0.0))


def analizar(entrada):
    gdl = construir(entrada)
    n = len(gdl)
    with contextlib.redirect_stdout(io.StringIO()):
        valores = ops.eigen("-fullGenLapack", n)
        ops.modalProperties("-unorm")
    T = [2 * math.pi / math.sqrt(v) for v in valores]
    v = entrada["variables"]
    ops.test("NormUnbalance", 1e-9, 10)
    ops.algorithm("Linear")
    ops.integrator("LoadControl", 0.0)
    ops.analysis("Static")
    g = entrada["g"]
    direcciones = []
    for eje in (0, 1):
        mu = entrada["espectro"]["mu"][eje]
        ac, TA, TB, beta, alfa = espectro_ncse02(entrada["espectro"], mu)
        # Una serie con un punto en cada periodo (más uno antes y otro después)
        ts = sorted(set(T))
        tiempos = [0.0, *ts, 2 * ts[-1] + 1]
        Sa = [alfa(t) * ac * g for t in tiempos]
        ops.timeSeries("Path", eje + 1, "-time", *tiempos, "-values", *Sa)
        modos = []
        for i in range(n):
            with contextlib.redirect_stdout(io.StringIO()):
                ops.responseSpectrumAnalysis(eje + 1, eje + 1, "-mode", i + 1)
                ops.reactions()
            modos.append(
                {
                    "u": [[ops.nodeDisp(k + 1, c + 1) for c in range(6)] for k in v["nudos"]],
                    "barras": [list(ops.eleResponse(b + 1, "localForce")) for b in v["barras"]],
                    "reaccion": [sum(ops.nodeReaction(k + 1, c + 1) for k in v["apoyos"]) for c in range(2)],
                }
            )

        def combinadas(regla):
            x = lambda sel: regla([sel(m) for m in modos])  # noqa: E731
            return {
                "u": [[x(lambda m, a=a, c=c: m["u"][a][c]) for c in range(6)] for a in range(len(v["nudos"]))],
                "barras": [[x(lambda m, a=a, c=c: m["barras"][a][c]) for c in range(12)] for a in range(len(v["barras"]))],
                "reaccion": [x(lambda m, c=c: m["reaccion"][c]) for c in range(2)],
            }

        direcciones.append(
            {
                "mu": mu,
                "ac": ac,
                "TA": TA,
                "TB": TB,
                "beta": beta,
                "Sa": [alfa(t) * ac * g for t in T],
                "modos": modos,
                "srss": combinadas(lambda x: srss(x, T)),
                "cqc": combinadas(lambda x: cqc(x, T, entrada["espectro"]["omega"])),
            }
        )
    return {"periodos": T, "direcciones": direcciones}


def main():
    entrada = json.load(open(os.path.join(AQUI, "opensees-modelos.json"), encoding="utf-8"))
    lineas = [
        "# VS3, criterio 3: el análisis por espectros de respuesta del motor frente a OpenSeesPy 3.8 (responseSpectrumAnalysis, modo a modo)",
        "",
        "El cortante en la base de OpenSees es la suma de sus reacciones en cada modo, combinada aquí (art. 3.6.2.4); el del motor, el de `respuestaEspectral`. Los valores, uno a uno, en `src/motor/oraculo-vs3.test.ts`.",
        "",
        "modelo | nudos | modos | modos por debajo de TA | pares de modos a menos del 10 % | cortante en la base X, kN (motor / OpenSees) | Y, kN (motor / OpenSees) | diferencia relativa",
    ]
    fixture = {}
    for nombre, x in entrada.items():
        t = time.perf_counter()
        r = analizar(x)
        T = r["periodos"]
        pares = sum(1 for i in range(len(T)) for j in range(i + 1, len(T)) if proximos(T[i], T[j]))
        bajos = sum(1 for p in T if p < r["direcciones"][0]["TA"])
        V = [abs(r["direcciones"][eje]["srss"]["reaccion"][eje]) for eje in (0, 1)]
        dif = max(abs(V[eje] - x["basal"][eje]) / V[eje] for eje in (0, 1))
        lineas.append(f"{nombre} | {len(x['modelo']['nudos'])} | {len(T)} | {bajos} | {pares} | {x['basal'][0]:.4f} / {V[0]:.4f} | {x['basal'][1]:.4f} / {V[1]:.4f} | {dif:.1e}")
        print(nombre, f"{time.perf_counter() - t:.1f} s", lineas[-1], flush=True)
        if nombre in EN_PRUEBAS:
            fixture[nombre] = {"variables": x["variables"], "espectro": x["espectro"], **r}
    open(os.path.join(AQUI, "out_opensees.txt"), "w", encoding="utf-8", newline="").write("\n".join(lineas) + "\n")
    ruta = os.path.join(RAIZ, "src", "motor", "__fixtures__", "opensees-vs3.json")
    json.dump(fixture, open(ruta, "w", encoding="utf-8", newline=""), indent=1)
    print("escrito", ruta)


if __name__ == "__main__":
    sys.exit(main())
