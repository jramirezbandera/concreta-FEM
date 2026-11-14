"""Fase LC, criterio 3 (docs/fem3d/losa-cimentacion.md §6): la losa de cimentación de
validacion/lc/opensees-lc.json (bun validacion/lc/oraculo.ts) en OpenSeesPy 3.8.

El modelo es el analítico del motor (nudos, láminas, barras con sus offsets y modificadores, muelles a
tierra, apoyos y enlaces rígidos) con sus cargas nodales. Aquí se monta con los elementos de OpenSees:

- láminas: ASDShellQ4 con ElasticMembranePlateSection (no es la DKMQ24 del motor);
- barras: elasticBeamColumn (Euler–Bernoulli; el modelo va sin cortante) con geomTransf Linear y
  vecxz = vz, los modificadores en la sección y los offsets con nudos auxiliares y rigidLink('beam');
- muelles a tierra: un nudo nuevo en el mismo sitio, empotrado, y un zeroLength con un material
  Elastic por cada dirección con rigidez (las del motor, en ejes globales);
- apoyos: fix; enlaces rígidos (las huellas de los pilares): rigidLink('beam'), con Lagrange.

Escribe src/compilador/__fixtures__/opensees-lc.json: por caso, el asiento uz de los nudos con muelle
(en el orden de `cimentacion.L.nudos`) y la suma de las reacciones de los muelles en Z.

Uso: .venv312/Scripts/python.exe validacion/lc/oraculo_balasto.py
"""
import contextlib
import io
import json
import os

import numpy as np
import openseespy.opensees as ops

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))


def calcular(entrada, k):
    modelo = entrada["modelo"]
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    nudos = modelo["nudos"]
    X = [np.array([n["x"], n["y"], n["z"]], dtype=float) for n in nudos]
    for i, p in enumerate(X):
        ops.node(i + 1, *p)
    siguiente = [len(nudos)]

    def nudo_nuevo(p):
        siguiente[0] += 1
        ops.node(siguiente[0], *p)
        return siguiente[0]

    for a in modelo.get("apoyos", []):
        ops.fix(a["nudo"] + 1, *[1 if c else 0 for c in a["coartados"]])
    ele = 0
    secciones = {}
    for l in modelo.get("laminas", []):
        m = l["material"]
        assert not l.get("multiplicadores")
        clave = (m["E"], m["nu"], m["t"])
        if clave not in secciones:
            secciones[clave] = len(secciones) + 1
            ops.section("ElasticMembranePlateSection", secciones[clave], m["E"], m["nu"], m["t"], 0.0)
        ele += 1
        ops.element("ASDShellQ4", ele, *[v + 1 for v in l["nudos"]], secciones[clave])
    for barra in modelo.get("barras", []):
        assert not barra.get("liberaciones") and not barra.get("empotramiento"), "barras con liberaciones o empotramiento parcial"
        i, j = barra["nudos"]
        off = barra.get("offsets") or {}
        s = barra["seccion"]
        assert "Avy" not in s, "el oráculo va con barras de Euler–Bernoulli"
        md = barra.get("modificadores") or {}
        a, z = i + 1, j + 1
        if off.get("i"):
            a = nudo_nuevo(X[i] + np.array(off["i"], dtype=float))
            ops.rigidLink("beam", i + 1, a)
        if off.get("j"):
            z = nudo_nuevo(X[j] + np.array(off["j"], dtype=float))
            ops.rigidLink("beam", j + 1, z)
        ele += 1
        ops.geomTransf("Linear", ele, *barra["vz"])
        ops.element("elasticBeamColumn", ele, a, z, s["A"] * md.get("A", 1), s["E"], s["G"], s["J"] * md.get("J", 1), s["Iy"] * md.get("Iy", 1), s["Iz"] * md.get("Iz", 1), ele)
    mat = 0
    for m in modelo.get("muelles", []):
        assert len(m["nudos"]) == 1 and not m.get("ejes") and len(m["k"]) == 6
        n = m["nudos"][0]
        t = nudo_nuevo(X[n])
        ops.fix(t, 1, 1, 1, 1, 1, 1)
        mats, dirs = [], []
        for d, kd in enumerate(m["k"]):
            if kd > 0:
                mat += 1
                ops.uniaxialMaterial("Elastic", mat, kd)
                mats.append(mat)
                dirs.append(d + 1)
        ele += 1
        ops.element("zeroLength", ele, t, n + 1, "-mat", *mats, "-dir", *dirs)
    for r in modelo.get("restricciones", []):
        assert r["tipo"] == "enlace-rigido", "el oráculo va sin diafragmas"
        for v in r["esclavos"]:
            ops.rigidLink("beam", r["maestro"] + 1, v + 1)
    ops.constraints("Lagrange")
    ops.numberer("RCM")
    ops.system("UmfPack")
    ops.algorithm("Linear")
    ops.integrator("LoadControl", 1.0)
    ops.analysis("Static")
    ops.timeSeries("Constant", 1)
    ops.pattern("Plain", 1, 1)
    caso = modelo["casos"][k]
    assert not caso.get("laminas") and not caso.get("barras"), "el oráculo sólo lleva cargas nodales"
    for c in caso.get("nodales", []):
        ops.load(c["nudo"] + 1, *c["f"])
    with contextlib.redirect_stdout(io.StringIO()):
        if ops.analyze(1) != 0:
            raise RuntimeError("OpenSees no converge")
    cim = entrada["cimentacion"]["L"]
    uz = [ops.nodeDisp(v + 1, 3) for v in cim["nudos"]]
    fz = sum(cim["balasto"] * a * -w for a, w in zip(cim["areas"], uz))
    return {"uz": uz, "fz": fz}


def main():
    entrada = json.load(open(os.path.join(AQUI, "opensees-lc.json"), encoding="utf-8"))
    r = {c["id"]: calcular(entrada, k) for k, c in enumerate(entrada["modelo"]["casos"])}
    ruta = os.path.join(RAIZ, "src", "compilador", "__fixtures__", "opensees-lc.json")
    json.dump(r, open(ruta, "w", encoding="utf-8", newline=""), indent=1)
    for k, v in r.items():
        print(k, f"uz min {min(v['uz']):.6e}", f"suma de Fz de los muelles {v['fz']:.6f}")
    print("escrito", ruta)


if __name__ == "__main__":
    main()
