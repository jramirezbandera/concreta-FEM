"""Oráculo de E2 con OpenSeesPy 3.8: los modelos `opensees` de modelos-oraculo.json.

Correspondencias:
- barra con áreas de cortante → ElasticTimoshenkoBeam (Timoshenko exacta); sin ellas →
  elasticBeamColumn (Euler–Bernoulli); modificadores aplicados a la sección; geomTransf Linear
  con vecxz = vz (el mismo triedro local que el motor);
- OpenSees no admite cargas puntuales en ElasticTimoshenkoBeam ni trapeciales parciales: cada
  barra se trocea en las posiciones de sus cargas puntuales (en el eje del tramo flexible) y las
  puntuales se aplican en esos nudos; las distribuidas tienen que ser uniformes en toda la barra
  (beamUniform en ejes locales, en cada trozo);
- offsets, dos variantes independientes:
  · 'jnt': `-jntOffset` de geomTransf en el primer y el último trozo;
  · 'rigid': nudos auxiliares en i' y j' unidos al nudo con rigidLink('beam');
- liberaciones: nudo duplicado en el extremo del tramo flexible unido con equalDOF en los GDL no
  liberados (sólo barras alineadas con los ejes globales, para que cada GDL local sea uno global);
- restricciones con 'Lagrange' (rigidLink + equalDOF forman cadenas, y el 'Transformation' de
  OpenSees 3.8 las resuelve mal, hallazgo E1-1); sin restricciones, 'Plain'.

Salida, por modelo, variante y caso: u y reacciones de los nudos del modelo y, por trozo, las
fuerzas de extremo sobre el trozo en ejes locales (eleResponse 'localForce'), con su barra y su
tramo [x0, x1] desde i'.

Uso: .venv312/Scripts/python.exe validacion/e2/oraculo_opensees.py
Escribe src/motor/__fixtures__/opensees-e2.json.
"""
import json
import os

import numpy as np
import openseespy.opensees as ops

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))

# 'jnt' sólo con barras de Euler–Bernoulli: la ElasticTimoshenkoBeam de OpenSees 3.8 acorta la
# longitud con -jntOffset pero ignora la cinemática del brazo rígido (hallazgo E2-1).
VARIANTES = {"timoshenko": ["simple"], "offsets": ["rigid"], "offsets-eb": ["jnt", "rigid"], "liberaciones": ["rigid"]}


def ejes(ip, jp, vz):
    x = jp - ip
    x = x / np.linalg.norm(x)
    vz = np.asarray(vz, dtype=float)
    z = vz - np.dot(vz, x) * x
    z = z / np.linalg.norm(z)
    return np.array([x, np.cross(z, x), z])


def gdl_conservados(R, lib6):
    """GDL globales (1..6) que no libera un extremo; la barra tiene que estar alineada con los ejes."""
    liberados = set()
    for c, libre in enumerate(lib6):
        if not libre:
            continue
        fila = R[c % 3]
        g = int(np.argmax(np.abs(fila)))
        assert abs(abs(fila[g]) - 1) < 1e-12, "liberación en una barra no alineada con los ejes globales"
        liberados.add(g + 3 * (c // 3))
    return [g + 1 for g in range(6) if g not in liberados]


def construir(modelo, variante):
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    nudos = modelo["nudos"]
    X = [np.array([n["x"], n["y"], n["z"]], dtype=float) for n in nudos]
    for k, p in enumerate(X):
        ops.node(k + 1, *p)
    for a in modelo.get("apoyos", []):
        if any(a["coartados"]):
            ops.fix(a["nudo"] + 1, *[1 if c else 0 for c in a["coartados"]])
    siguiente = [len(nudos) + 100]
    restricciones = [False]
    # apoyos que son maestros de una restricción: OpenSees no les suma la fuerza de la restricción
    # en nodeReaction (con Lagrange), así que su reacción no se compara
    sin_reaccion = set()

    def nudo_nuevo(p):
        siguiente[0] += 1
        ops.node(siguiente[0], *p)
        return siguiente[0]

    cortes_por_barra = {}
    for caso in modelo["casos"]:
        for c in caso.get("barras", []):
            if c["tipo"] == "puntual":
                cortes_por_barra.setdefault(c["barra"], set()).add(c["x"])

    trozos = []
    nudo_en = {}
    barras = []
    ele = 0
    for b, barra in enumerate(modelo["barras"]):
        i, j = barra["nudos"]
        off = barra.get("offsets") or {}
        di = np.array(off.get("i") or [0, 0, 0], dtype=float)
        dj = np.array(off.get("j") or [0, 0, 0], dtype=float)
        ip = X[i] + di
        jp = X[j] + dj
        L = float(np.linalg.norm(jp - ip))
        R = ejes(ip, jp, barra["vz"])
        lib = barra.get("liberaciones") or {}
        li = lib.get("i") or [False] * 6
        lj = lib.get("j") or [False] * 6
        con_offsets = bool(np.any(di) or np.any(dj))
        if variante == "jnt":
            assert not (any(li) or any(lj)), "la variante jnt no representa liberaciones"

        def extremo(nudo, d, p, libs):
            ini = nudo + 1
            if variante == "rigid" and np.any(d):
                aux = nudo_nuevo(p)
                ops.rigidLink("beam", ini, aux)
                restricciones[0] = True
                sin_reaccion.add(nudo)
                ini = aux
            if any(libs):
                dup = nudo_nuevo(p if variante == "rigid" else X[nudo])
                ops.equalDOF(ini, dup, *gdl_conservados(R, libs))
                restricciones[0] = True
                sin_reaccion.add(nudo)
                ini = dup
            return ini

        a = extremo(i, di, ip, li)
        z = extremo(j, dj, jp, lj)
        cortes = [0.0] + sorted(cortes_por_barra.get(b, set())) + [L]
        puntos = [a] + [nudo_nuevo(ip + c * R[0]) for c in cortes[1:-1]] + [z]
        for k, c in enumerate(cortes[1:-1]):
            nudo_en[(b, c)] = puntos[k + 1]
        s = barra["seccion"]
        md = barra.get("modificadores") or {}
        A = s["A"] * md.get("A", 1)
        Iy = s["Iy"] * md.get("Iy", 1)
        Iz = s["Iz"] * md.get("Iz", 1)
        J = s["J"] * md.get("J", 1)
        n = len(puntos) - 1
        eles = []
        for k in range(n):
            ele += 1
            args = ["Linear", ele, *barra["vz"]]
            if variante == "jnt" and con_offsets:
                oi = di if k == 0 else np.zeros(3)
                oj = dj if k == n - 1 else np.zeros(3)
                args += ["-jntOffset", *oi, *oj]
            ops.geomTransf(*args)
            if "Avy" in s:
                Avy = s["Avy"] * md.get("Avy", 1)
                Avz = s["Avz"] * md.get("Avz", 1)
                ops.element("ElasticTimoshenkoBeam", ele, puntos[k], puntos[k + 1], s["E"], s["G"], A, J, Iy, Iz, Avy, Avz, ele)
            else:
                ops.element("elasticBeamColumn", ele, puntos[k], puntos[k + 1], A, s["E"], s["G"], J, Iy, Iz, ele)
            trozos.append({"barra": b, "x0": cortes[k], "x1": cortes[k + 1], "ele": ele})
            eles.append(ele)
        barras.append({"R": R, "L": L, "eles": eles})
    apoyos = {a["nudo"] for a in modelo.get("apoyos", [])}
    return trozos, nudo_en, barras, restricciones[0], sorted(sin_reaccion & apoyos)


def resolver(modelo, variante):
    resultado = {}
    trozos_salida = None
    for caso in modelo["casos"]:
        trozos, nudo_en, barras, con_restricciones, sin_reaccion = construir(modelo, variante)
        ops.timeSeries("Linear", 1)
        ops.pattern("Plain", 1, 1)
        for c in caso.get("nodales", []):
            ops.load(c["nudo"] + 1, *c["f"])
        for c in caso.get("barras", []):
            info = barras[c["barra"]]
            R = info["R"]
            if c["tipo"] == "puntual":
                F = np.array(c.get("F") or [0, 0, 0], dtype=float)
                M = np.array(c.get("M") or [0, 0, 0], dtype=float)
                if c["ejes"] == "local":
                    F = R.T @ F
                    M = R.T @ M
                ops.load(nudo_en[(c["barra"], c["x"])], *F, *M)
            else:
                qa = np.array(c["qa"], dtype=float)
                qb = np.array(c.get("qb") or c["qa"], dtype=float)
                assert np.allclose(qa, qb) and c.get("a", 0) == 0 and c.get("b", info["L"]) == info["L"], "sólo uniformes en toda la barra"
                q = qa if c["ejes"] == "local" else R @ qa
                ops.eleLoad("-ele", *info["eles"], "-type", "-beamUniform", q[1], q[2], q[0])
        ops.constraints("Lagrange" if con_restricciones else "Plain")
        ops.numberer("RCM")
        ops.system("UmfPack")
        ops.test("NormDispIncr", 1e-14, 3, 0)
        ops.algorithm("Linear")
        ops.integrator("LoadControl", 1.0)
        ops.analysis("Static")
        if ops.analyze(1) != 0:
            raise RuntimeError(f"OpenSees no converge ({variante}, {caso['id']})")
        ops.reactions()
        u = []
        r = []
        for k in range(len(modelo["nudos"])):
            u.extend(ops.nodeDisp(k + 1))
            r.extend(ops.nodeReaction(k + 1))
        fuerzas = [list(ops.eleResponse(t["ele"], "localForce")) for t in trozos]
        resultado[caso["id"]] = {"u": u, "reacciones": r, "fuerzasTrozos": fuerzas}
        trozos_salida = [{"barra": t["barra"], "x0": t["x0"], "x1": t["x1"]} for t in trozos]
    return {"trozos": trozos_salida, "sinReaccion": sin_reaccion, "casos": resultado}


def main():
    with open(os.path.join(AQUI, "modelos-oraculo.json"), encoding="utf-8") as f:
        datos = json.load(f)
    salida = {"opensees": ops.version() if hasattr(ops, "version") else "3.8", "modelos": {}}
    for nombre, modelo in datos["opensees"].items():
        salida["modelos"][nombre] = {}
        for variante in VARIANTES[nombre]:
            salida["modelos"][nombre][variante] = resolver(modelo, variante)
            print(f"{nombre} [{variante}]: {len(modelo['casos'])} casos")
    ruta = os.path.join(RAIZ, "src", "motor", "__fixtures__", "opensees-e2.json")
    with open(ruta, "w", encoding="utf-8", newline="\n") as f:
        json.dump(salida, f)
    print(f"escrito {ruta}")


if __name__ == "__main__":
    main()
