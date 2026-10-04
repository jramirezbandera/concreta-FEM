"""Oráculo de E6: los muros de ETABS 15 (modelos-oraculo.json) con OpenSeesPy ASDShellQ4.

Correspondencias (las de E1 y E0):
- lámina → ASDShellQ4 con ElasticMembranePlateSection (E, ν, t);
- diafragma → rigidDiaphragm(3, maestro, *esclavos); enlace rígido → rigidLink('beam');
- apoyo → fix; carga nodal → load.
Los GDL uz, rx, ry de un maestro de diafragma sin elementos se fijan (el motor los restringe solo).

Uso: .venv312/Scripts/python.exe validacion/e6/oraculo_opensees.py
Escribe src/motor/__fixtures__/opensees-e6.json: por modelo y caso, los desplazamientos de los nudos pedidos.
"""
import contextlib
import io
import json
import os
import sys
import time

import openseespy.opensees as ops

AQUI = os.path.dirname(os.path.abspath(__file__))


def resolver(modelo, caso, handler="Transformation"):
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    nudos = modelo["nudos"]
    for i, n in enumerate(nudos):
        ops.node(i + 1, n["x"], n["y"], n["z"])
    for a in modelo.get("apoyos", []):
        flags = [1 if c else 0 for c in a["coartados"]]
        if any(flags):
            ops.fix(a["nudo"] + 1, *flags)
    secciones = {}
    con_elementos = set()
    for k, l in enumerate(modelo.get("laminas", [])):
        m = l["material"]
        clave = (m["E"], m["nu"], m["t"])
        if clave not in secciones:
            secciones[clave] = len(secciones) + 1
            ops.section("ElasticMembranePlateSection", secciones[clave], m["E"], m["nu"], m["t"], 0.0)
        ops.element("ASDShellQ4", k + 1, *[v + 1 for v in l["nudos"]], secciones[clave])
        con_elementos.update(l["nudos"])
    for r in modelo.get("restricciones", []):
        if r["tipo"] == "diafragma":
            ops.rigidDiaphragm(3, r["maestro"] + 1, *[s + 1 for s in r["esclavos"]])
        else:
            for s in r["esclavos"]:
                ops.rigidLink("beam", r["maestro"] + 1, s + 1)
    for r in modelo.get("restricciones", []):
        if r["tipo"] == "diafragma" and r["maestro"] not in con_elementos:
            ops.fix(r["maestro"] + 1, 0, 0, 1, 1, 1, 0)
    ops.timeSeries("Linear", 1)
    ops.pattern("Plain", 1, 1)
    for c in caso.get("nodales", []):
        ops.load(c["nudo"] + 1, *c["f"])
    ops.constraints(handler)
    ops.numberer("RCM")
    ops.system("UmfPack")
    ops.algorithm("Linear")
    ops.integrator("LoadControl", 1.0)
    ops.analysis("Static")
    with contextlib.redirect_stdout(io.StringIO()):
        if ops.analyze(1) != 0:
            raise RuntimeError("OpenSees no converge")


def main():
    modelos = json.load(open(os.path.join(AQUI, "modelos-oraculo.json"), encoding="utf-8"))
    salida = {}
    for nombre, entrada in modelos.items():
        modelo = entrada["modelo"]
        res = {}
        t = time.perf_counter()
        for caso in modelo["casos"]:
            resolver(modelo, caso)
            res[caso["id"]] = {str(v): ops.nodeDisp(v + 1) for v in entrada["nudos"]}
        salida[nombre] = res
        print(nombre, f"{time.perf_counter() - t:.1f} s", flush=True)
    ruta = os.path.join(os.path.dirname(os.path.dirname(AQUI)), "src", "motor", "__fixtures__", "opensees-e6.json")
    json.dump(salida, open(ruta, "w", encoding="utf-8"), indent=1)
    print("escrito", ruta)


if __name__ == "__main__":
    sys.exit(main())
