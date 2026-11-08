"""Fase SO, criterio 7 (docs/fem3d/segundo-orden.md §9): el segundo orden geométrico de OpenSeesPy 3.8
(geomTransf PDelta) frente al coeficiente de estabilidad global del motor.

Monta el modelo analítico de validacion/so/opensees-modelos.json (bun validacion/so/modelos.ts): el
edificio de 3 plantas de las pruebas, compilado sin empotramiento parcial y sin áreas de cortante,
con elasticBeamColumn y -jntOffset (las zonas rígidas), rigidDiaphragm con el maestro del motor (un
nudo auxiliar: se fijan uz, rx y ry) y las restricciones por transformación.

Para cada nivel de carga gravitatoria g (γ_G = 1,35·g, γ_Q = 1,05·g; el viento a 1,5):
- lineal (geomTransf Linear): la gravedad y luego el viento; el efecto del viento es la diferencia;
- P-Δ (geomTransf PDelta): lo mismo, con la gravedad puesta antes (Newton, carga constante), de modo
  que el viento actúa con la rigidez geométrica de los axiles gravitatorios.
De cada uno: el desplazamiento del maestro de la planta alta y el momento en la base de cada pilar
(el módulo del vector de momentos en el extremo inferior de su tramo flexible), y su suma.

Uso: .venv312/Scripts/python.exe validacion/so/oraculo_pdelta.py
Escribe src/compilador/__fixtures__/opensees-so.json y validacion/so/out_opensees.txt.
"""
import json
import math
import os

import openseespy.opensees as ops

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))


def construir(m, transf):
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    for k, n in enumerate(m["nudos"]):
        ops.node(k + 1, n["x"], n["y"], n["z"])
    for a in m.get("apoyos", []):
        if any(a["coartados"]):
            ops.fix(a["nudo"] + 1, *[1 if c else 0 for c in a["coartados"]])
    for r in m.get("restricciones", []):
        if r["tipo"] == "diafragma":
            # el maestro es un nudo auxiliar sin rigidez: lo que no es del diafragma, fijo
            ops.fix(r["maestro"] + 1, 0, 0, 1, 1, 1, 0)
            ops.rigidDiaphragm(3, r["maestro"] + 1, *[s + 1 for s in r["esclavos"]])
        else:
            for s in r["esclavos"]:
                ops.rigidLink("beam", r["maestro"] + 1, s + 1)
    for ele, b in enumerate(m["barras"], start=1):
        assert not b.get("liberaciones") and not b.get("empotramiento"), "barras con liberaciones o empotramiento parcial"
        i, j = b["nudos"]
        off = b.get("offsets") or {}
        di = off.get("i") or [0, 0, 0]
        dj = off.get("j") or [0, 0, 0]
        s = b["seccion"]
        assert "Avy" not in s, "sólo barras de Euler–Bernoulli (E2-1)"
        md = b.get("modificadores") or {}
        A = s["A"] * md.get("A", 1)
        Iy = s["Iy"] * md.get("Iy", 1)
        Iz = s["Iz"] * md.get("Iz", 1)
        J = s["J"] * md.get("J", 1)
        args = [transf, ele, *b["vz"]]
        if any(di) or any(dj):
            args += ["-jntOffset", *di, *dj]
        ops.geomTransf(*args)
        ops.element("elasticBeamColumn", ele, i + 1, j + 1, A, s["E"], s["G"], J, Iy, Iz, ele)
    ops.constraints("Transformation")
    ops.numberer("RCM")
    ops.system("UmfPack")
    ops.test("NormDispIncr", 1e-12, 100)
    ops.algorithm("Newton")
    ops.integrator("LoadControl", 1.0)
    ops.analysis("Static")


def cargar(m, tag, factores):
    ops.timeSeries("Constant", tag)
    ops.pattern("Plain", tag, tag)
    for c in m["casos"]:
        g = factores.get(c["id"], 0)
        if not g:
            continue
        for n in c.get("nodales", []):
            ops.load(n["nudo"] + 1, *[g * v for v in n["f"]])


def medir(m, bases, maestro):
    u = ops.nodeDisp(maestro + 1, 1)
    M = {}
    for b in bases:
        f = ops.eleResponse(b["indice"] + 1, "localForce")
        # [N, Vy, Vz, T, My, Mz] en i (la base): el vector de momentos flectores
        M[b["id"]] = (f[4], f[5])
    return u, M


def analizar(m, bases, maestro, transf, gravedad, viento):
    """El efecto del viento: lo de (gravedad + viento) menos lo de la gravedad sola."""
    construir(m, transf)
    cargar(m, 1, gravedad)
    assert ops.analyze(1) == 0, "la gravedad no converge"
    u0, M0 = medir(m, bases, maestro)
    ops.loadConst("-time", 0.0)
    cargar(m, 2, viento)
    assert ops.analyze(1) == 0, "el viento no converge"
    u1, M1 = medir(m, bases, maestro)
    Mb = {k: math.hypot(M1[k][0] - M0[k][0], M1[k][1] - M0[k][1]) for k in M0}
    return {"uTop": u1 - u0, "Mbase": Mb, "sumaM": sum(Mb.values())}


def main():
    entrada = json.load(open(os.path.join(AQUI, "opensees-modelos.json"), encoding="utf-8"))
    m = entrada["modelo"]
    bases = entrada["bases"]
    maestro = entrada["maestroAlto"]
    salida = {"bases": [b["id"] for b in bases], "niveles": []}
    lineas = ["# SO, criterio 7: el segundo orden geométrico de OpenSeesPy 3.8 (geomTransf PDelta) frente al γz del motor", "", "| g | u alto lineal (mm) | u alto P-Δ (mm) | cociente u | ΣM base lineal (kN·m) | ΣM base P-Δ | cociente M | cociente M por pilar (mín … máx) |", "|---|---|---|---|---|---|---|---|"]
    for nivel in entrada["niveles"]:
        g = nivel["g"]
        gravedad = {k: v for k, v in nivel["factores"].items() if k in ("G", "Q")}
        viento = {k: v for k, v in nivel["factores"].items() if k not in ("G", "Q")}
        lineal = analizar(m, bases, maestro, "Linear", gravedad, viento)
        pdelta = analizar(m, bases, maestro, "PDelta", gravedad, viento)
        salida["niveles"].append({"g": g, "factores": nivel["factores"], "lineal": lineal, "pdelta": pdelta})
        cocientes = [pdelta["Mbase"][k] / lineal["Mbase"][k] for k in lineal["Mbase"]]
        lineas.append(f"| {g} | {1000 * lineal['uTop']:.3f} | {1000 * pdelta['uTop']:.3f} | {pdelta['uTop'] / lineal['uTop']:.4f} | {lineal['sumaM']:.2f} | {pdelta['sumaM']:.2f} | {pdelta['sumaM'] / lineal['sumaM']:.4f} | {min(cocientes):.4f} … {max(cocientes):.4f} |")
    os.makedirs(os.path.join(RAIZ, "src", "compilador", "__fixtures__"), exist_ok=True)
    with open(os.path.join(RAIZ, "src", "compilador", "__fixtures__", "opensees-so.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(salida, f, indent=1)
    with open(os.path.join(AQUI, "out_opensees.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lineas) + "\n")
    print("\n".join(lineas))


if __name__ == "__main__":
    main()
