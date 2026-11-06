"""VS2, criterio 4 (docs/fem3d/viento-sismo.md §5): los periodos de los modelos de
validacion/vs2/opensees-modelos.json (bun validacion/vs2/modelos-oraculo.ts) con OpenSeesPy 3.8.

Cada modelo es el modelo analítico del motor (nudos, barras con sus offsets y modificadores, láminas,
apoyos y restricciones) y la masa de cada diafragma rígido (m, centro de masas y J, las del motor).
Aquí se monta con los elementos de OpenSees y se calculan sus modos con `eigen`:

- barras: `elasticBeamColumn` (Euler–Bernoulli) o `ElasticTimoshenkoBeam`, con geomTransf Linear y
  vecxz = vz (el triedro del motor) y los modificadores en la sección. Los offsets, con
  `-jntOffset` si el modelo va con 'Transformation' (sólo Euler–Bernoulli, hallazgo E2-1) y con
  nudos auxiliares y `rigidLink('beam')` si va con 'Lagrange';
- láminas: ASDShellQ4 con ElasticMembranePlateSection (no es la DKMQ24 del motor);
- diafragma rígido: un nudo nuevo en su centro de masas, con su masa (m, m, J) y sólo ux, uy y rz
  libres, como nudo retenido de `rigidDiaphragm(3, …)` con el maestro y los esclavos del motor;
- enlaces rígidos (huellas de pilares, caras de vigas): `rigidLink('beam')`, sólo con 'Lagrange'
  (hacen cadena con el diafragma, y el 'Transformation' de OpenSees las resuelve mal, E1-1).

Dos caminos, según las restricciones del modelo:
- 'Transformation' (pórticos, sin cadenas): `eigen` de OpenSees con el solver denso
  (`-fullGenLapack`), todos los modos;
- 'Lagrange' (con losas y muros, con cadenas): `eigen` no sirve. Con multiplicadores, K no es
  definida; con penalización, ARPACK no arma más vectores de Lanczos que GDL con masa (3 por planta)
  y el solver denso no cabe. Como toda la masa está en los centros de masas, la rigidez condensada a
  esos GDL es exacta: OpenSees da la flexibilidad con una solución estática por GDL con masa, y los
  valores propios de K_c·φ = ω²·M·φ salen de LAPACK (numpy), con K_c = F⁻¹.

Uso: .venv312/Scripts/python.exe validacion/vs2/oraculo_opensees.py
Escribe src/motor/__fixtures__/opensees-vs2.json (los periodos de OpenSees de los modelos de la
batería) y validacion/vs2/out_opensees.txt (la comparación con el motor, también de los grandes).
"""
import contextlib
import io
import json
import os
import sys
import time

import numpy as np
import openseespy.opensees as ops

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))


def construir(entrada):
    modelo = entrada["modelo"]
    handler = entrada["handler"]
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    nudos = modelo["nudos"]
    X = [np.array([n["x"], n["y"], n["z"]], dtype=float) for n in nudos]
    for k, p in enumerate(X):
        ops.node(k + 1, *p)
    for a in modelo.get("apoyos", []):
        if any(a["coartados"]):
            ops.fix(a["nudo"] + 1, *[1 if c else 0 for c in a["coartados"]])
    siguiente = [len(nudos)]

    def nudo_nuevo(p):
        siguiente[0] += 1
        ops.node(siguiente[0], *p)
        return siguiente[0]

    con_elementos = set()
    ele = 0
    secciones = {}
    for l in modelo.get("laminas", []):
        m = l["material"]
        assert not l.get("multiplicadores"), "las láminas con multiplicadores no tienen sección en OpenSees"
        clave = (m["E"], m["nu"], m["t"])
        if clave not in secciones:
            secciones[clave] = len(secciones) + 1
            ops.section("ElasticMembranePlateSection", secciones[clave], m["E"], m["nu"], m["t"], 0.0)
        ele += 1
        ops.element("ASDShellQ4", ele, *[v + 1 for v in l["nudos"]], secciones[clave])
        con_elementos.update(l["nudos"])
    for barra in modelo.get("barras", []):
        assert not barra.get("liberaciones") and not barra.get("empotramiento"), "barras con liberaciones o empotramiento parcial"
        i, j = barra["nudos"]
        con_elementos.update((i, j))
        off = barra.get("offsets") or {}
        di = np.array(off.get("i") or [0, 0, 0], dtype=float)
        dj = np.array(off.get("j") or [0, 0, 0], dtype=float)
        s = barra["seccion"]
        md = barra.get("modificadores") or {}
        A = s["A"] * md.get("A", 1)
        Iy = s["Iy"] * md.get("Iy", 1)
        Iz = s["Iz"] * md.get("Iz", 1)
        J = s["J"] * md.get("J", 1)
        ele += 1
        args = ["Linear", ele, *barra["vz"]]
        a, z = i + 1, j + 1
        if handler == "Transformation":
            assert "Avy" not in s, "con Transformation, sólo barras de Euler–Bernoulli (E2-1)"
            if np.any(di) or np.any(dj):
                args += ["-jntOffset", *di, *dj]
        else:
            if np.any(di):
                a = nudo_nuevo(X[i] + di)
                ops.rigidLink("beam", i + 1, a)
            if np.any(dj):
                z = nudo_nuevo(X[j] + dj)
                ops.rigidLink("beam", j + 1, z)
        ops.geomTransf(*args)
        if "Avy" in s:
            ops.element("ElasticTimoshenkoBeam", ele, a, z, s["E"], s["G"], A, J, Iy, Iz, s["Avy"] * md.get("Avy", 1), s["Avz"] * md.get("Avz", 1), ele)
        else:
            ops.element("elasticBeamColumn", ele, a, z, A, s["E"], s["G"], J, Iy, Iz, ele)
    masas = {d["restriccion"]: d for d in entrada["diafragmas"]}
    centros = []
    for ir, r in enumerate(modelo.get("restricciones", [])):
        if r["tipo"] == "diafragma":
            d = masas[ir]
            cm = nudo_nuevo([d["cm"][0], d["cm"][1], d["z"]])
            ops.fix(cm, 0, 0, 1, 1, 1, 0)
            if d["m"] > 0:
                ops.mass(cm, d["m"], d["m"], 0.0, 0.0, 0.0, d["J"])
            ops.rigidDiaphragm(3, cm, r["maestro"] + 1, *[v + 1 for v in r["esclavos"]])
            if r["maestro"] not in con_elementos:
                ops.fix(r["maestro"] + 1, 0, 0, 1, 1, 1, 0)
            centros.append(cm)
        else:
            assert handler == "Lagrange", "los enlaces rígidos hacen cadena con el diafragma: sólo con Lagrange"
            for v in r["esclavos"]:
                ops.rigidLink("beam", r["maestro"] + 1, v + 1)
    ops.constraints(handler)
    ops.numberer("RCM")
    ops.system("UmfPack")
    ops.algorithm("Linear")
    ops.integrator("LoadControl", 1.0)
    ops.analysis("Static")
    # GDL con masa: (nudo del centro de masas, GDL de OpenSees, masa)
    gdl = []
    for cm, d in zip(centros, [masas[ir] for ir, r in enumerate(modelo.get("restricciones", [])) if r["tipo"] == "diafragma"]):
        if d["m"] > 0:
            gdl += [(cm, 1, d["m"]), (cm, 2, d["m"])] + ([(cm, 6, d["J"])] if d["J"] > 0 else [])
    return gdl


def periodos(entrada):
    gdl = construir(entrada)
    n = len(gdl)
    if entrada["handler"] == "Transformation":
        with contextlib.redirect_stdout(io.StringIO()):
            valores = ops.eigen("-fullGenLapack", n)
        return [2 * np.pi / np.sqrt(v) for v in valores]
    # Flexibilidad en los GDL con masa: una carga unidad en cada uno (serie constante: el modelo es
    # lineal, y cada paso deja la solución de la carga que hay)
    ops.timeSeries("Constant", 1)
    F = np.zeros((n, n))
    for j, (nudo, g, _) in enumerate(gdl):
        ops.pattern("Plain", j + 1, 1)
        carga = [0.0] * 6
        carga[g - 1] = 1.0
        ops.load(nudo, *carga)
        with contextlib.redirect_stdout(io.StringIO()):
            if ops.analyze(1) != 0:
                raise RuntimeError("OpenSees no converge")
        F[:, j] = [ops.nodeDisp(v, h) for v, h, _ in gdl]
        ops.remove("loadPattern", j + 1)
    asimetria = np.abs(F - F.T).max() / np.abs(F).max()
    assert asimetria < 1e-8, f"la flexibilidad de OpenSees no es simétrica ({asimetria:.1e})"
    K = np.linalg.inv(0.5 * (F + F.T))
    d = 1 / np.sqrt(np.array([m for _, _, m in gdl]))
    valores = np.linalg.eigvalsh(d[:, None] * (0.5 * (K + K.T)) * d[None, :])
    return [2 * np.pi / np.sqrt(v) for v in valores]


def main():
    entrada = json.load(open(os.path.join(AQUI, "opensees-modelos.json"), encoding="utf-8"))
    lineas = ["# VS2, criterio 4: periodos del motor frente a OpenSeesPy 3.8 (rigidDiaphragm, la masa de cada diafragma en su centro de masas)", ""]
    lineas.append("Transformation: `eigen` de OpenSees (-fullGenLapack). Lagrange: flexibilidad estática de OpenSees en los centros de masas y valores propios con LAPACK (los modelos con cadenas de restricciones; sus láminas son ASDShellQ4, no la DKMQ24 del motor).")
    lineas.append("")
    lineas.append("modelo | nudos | restricciones | modos comparados (de) | T1 motor, s | T1 OpenSees, s | diferencia relativa máxima | media")
    fixture = {}
    detalle = []
    for nombre, x in entrada.items():
        t = time.perf_counter()
        T = periodos(x)
        motor = x["periodos"]
        dif = [abs(a - b) / b for a, b in zip(motor, T)]
        lineas.append(f"{nombre} | {len(x['modelo']['nudos'])} | {x['handler']} | {len(T)} de {len(motor)} | {motor[0]:.6f} | {T[0]:.6f} | {max(dif):.2e} | {sum(dif) / len(dif):.2e}")
        detalle.append(f"{nombre}: " + "; ".join(f"{i + 1}: {a:.5f} / {b:.5f}" for i, (a, b) in enumerate(zip(motor, T))))
        fixture[nombre] = {"handler": x["handler"], "periodos": T}
        print(nombre, f"{time.perf_counter() - t:.1f} s", lineas[-1], flush=True)
        if x["handler"] == "Transformation" and len(x["modelo"]["nudos"]) < 200:
            # El mismo pórtico por el otro camino (las zonas rígidas con rigidLink, encadenadas con el
            # diafragma): con los mismos elementos, lo que separa los dos caminos es sólo el redondeo
            T2 = periodos({**x, "handler": "Lagrange"})
            dif2 = [abs(a - b) / b for a, b in zip(motor, T2)]
            lineas.append(f"{nombre}, por el camino de Lagrange | {len(x['modelo']['nudos'])} | Lagrange | {len(T2)} de {len(motor)} | {motor[0]:.6f} | {T2[0]:.6f} | {max(dif2):.2e} | {sum(dif2) / len(dif2):.2e}")
            print(lineas[-1], flush=True)
    lineas += ["", "Periodos, motor / OpenSees (s):", *detalle]
    open(os.path.join(AQUI, "out_opensees.txt"), "w", encoding="utf-8", newline="").write("\n".join(lineas) + "\n")
    ruta = os.path.join(RAIZ, "src", "motor", "__fixtures__", "opensees-vs2.json")
    # Los grandes (sólo con --grande) no van a la batería
    grandes = {"losas-7x3x2"}
    json.dump({k: v for k, v in fixture.items() if k not in grandes}, open(ruta, "w", encoding="utf-8", newline=""), indent=1)
    print("escrito", ruta)


if __name__ == "__main__":
    sys.exit(main())
