"""Oráculo de E1: los modelos de modelos-oraculo.json resueltos con OpenSeesPy.

Cada modelo y caso se resuelve con dos tratamientos de las restricciones de OpenSees:
- 'Transformation': la misma idea que el motor (u = T·û), implementada por otros;
- 'Lagrange': multiplicadores de Lagrange, una formulación independiente.

Correspondencias:
- barra → elasticBeamColumn (Euler–Bernoulli) con geomTransf Linear y vecxz = vz;
- diafragma → rigidDiaphragm(3, maestro, *esclavos); enlace rígido → rigidLink('beam');
- muelle a tierra → zeroLength contra un nudo auxiliar empotrado (su reacción se suma al nudo
  del muelle); muelle entre nudos → zeroLength; ejes del muelle → -orient e1 e2;
- desplazamiento impuesto → sp() en el patrón (y ese GDL no se fija con fix);
- los GDL uz, rx, ry de un maestro de diafragma sin elementos se fijan (el motor los
  restringe solo).

Uso: .venv312/Scripts/python.exe validacion/e1/oraculo_opensees.py
Escribe src/motor/__fixtures__/opensees-e1.json.
"""
import json
import os
import sys

import openseespy.opensees as ops

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))


def resolver(modelo, caso, handler):
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    nudos = modelo["nudos"]
    for i, n in enumerate(nudos):
        ops.node(i + 1, n["x"], n["y"], n["z"])

    impuestos = {(d["nudo"], d["gdl"]): d["valor"] for d in caso.get("impuestos", [])}
    for a in modelo.get("apoyos", []):
        flags = [1 if (c and (a["nudo"], g) not in impuestos) else 0 for g, c in enumerate(a["coartados"])]
        if any(flags):
            ops.fix(a["nudo"] + 1, *flags)

    con_elementos = set()
    for k, b in enumerate(modelo.get("barras", [])):
        s = b["seccion"]
        ops.geomTransf("Linear", k + 1, *b["vz"])
        i, j = b["nudos"]
        ops.element("elasticBeamColumn", k + 1, i + 1, j + 1, s["A"], s["E"], s["G"], s["J"], s["Iy"], s["Iz"], k + 1)
        con_elementos.update((i, j))

    aux = {}  # nudo auxiliar empotrado de cada muelle a tierra -> nudo del muelle
    etiqueta = 100000
    mat = 1
    for m in modelo.get("muelles", []):
        k = m["k"]
        if len(k) != 6:
            raise ValueError("el oráculo sólo admite muelles diagonales")
        mats, dirs = [], []
        for d in range(6):
            if k[d] != 0:
                ops.uniaxialMaterial("Elastic", mat, k[d])
                mats.append(mat)
                dirs.append(d + 1)
                mat += 1
        if len(m["nudos"]) == 1:
            v = m["nudos"][0]
            etiqueta += 1
            n = nudos[v]
            ops.node(etiqueta, n["x"], n["y"], n["z"])
            ops.fix(etiqueta, 1, 1, 1, 1, 1, 1)
            aux[etiqueta] = v
            i_tag, j_tag = etiqueta, v + 1
        else:
            i_tag, j_tag = m["nudos"][0] + 1, m["nudos"][1] + 1
            con_elementos.update(m["nudos"])
        con_elementos.update(m["nudos"])
        etiqueta += 1
        orient = []
        if m.get("ejes"):
            R = m["ejes"]
            orient = ["-orient", *R[0:3], *R[3:6]]
        ops.element("zeroLength", etiqueta, i_tag, j_tag, "-mat", *mats, "-dir", *dirs, *orient)

    for r in modelo.get("restricciones", []):
        if r["tipo"] == "diafragma":
            ops.rigidDiaphragm(3, r["maestro"] + 1, *[s + 1 for s in r["esclavos"]])
        else:
            for s in r["esclavos"]:
                ops.rigidLink("beam", r["maestro"] + 1, s + 1)

    # GDL sin rigidez de los maestros de diafragma sin elementos
    maestros_diafragma = {r["maestro"] for r in modelo.get("restricciones", []) if r["tipo"] == "diafragma"}
    esclavos_enlace = {s for r in modelo.get("restricciones", []) if r["tipo"] != "diafragma" for s in r["esclavos"]}
    for v in maestros_diafragma:
        if v not in con_elementos and v not in esclavos_enlace:
            ops.fix(v + 1, 0, 0, 1, 1, 1, 0)

    ops.timeSeries("Linear", 1)
    ops.pattern("Plain", 1, 1)
    for c in caso.get("nodales", []):
        ops.load(c["nudo"] + 1, *c["f"])
    for (v, g), valor in impuestos.items():
        ops.sp(v + 1, g + 1, valor)

    ops.constraints(handler)
    ops.numberer("RCM")
    ops.system("UmfPack")
    ops.test("NormDispIncr", 1e-14, 3, 0)
    ops.algorithm("Linear")
    ops.integrator("LoadControl", 1.0)
    ops.analysis("Static")
    if ops.analyze(1) != 0:
        raise RuntimeError(f"OpenSees no converge ({handler})")
    ops.reactions()
    u = []
    r = []
    for i in range(len(nudos)):
        u.extend(ops.nodeDisp(i + 1))
        r.extend(ops.nodeReaction(i + 1))
    for t, v in aux.items():
        rr = ops.nodeReaction(t)
        for d in range(6):
            r[6 * v + d] += rr[d]
    return u, r


def main():
    modelos = json.load(open(os.path.join(AQUI, "modelos-oraculo.json"), encoding="utf-8"))
    salida = {"version_opensees": ops.version() if hasattr(ops, "version") else "3.8", "modelos": {}}
    for nombre, modelo in modelos.items():
        res = {}
        for caso in modelo["casos"]:
            fila = {}
            for handler in ("Transformation", "Lagrange"):
                try:
                    u, r = resolver(modelo, caso, handler)
                    fila[handler] = {"u": u, "reacciones": r}
                except Exception as e:  # noqa: BLE001
                    fila[handler] = {"error": f"{type(e).__name__}: {e}"}
            res[caso["id"]] = fila
            print(nombre, caso["id"], {h: ("error" if "error" in v else "ok") for h, v in fila.items()}, flush=True)
        salida["modelos"][nombre] = res
    ruta = os.path.join(RAIZ, "src", "motor", "__fixtures__", "opensees-e1.json")
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    json.dump(salida, open(ruta, "w", encoding="utf-8"), indent=1)
    print("escrito", ruta)


if __name__ == "__main__":
    sys.exit(main())
