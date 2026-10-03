"""Oráculo de E2 con PyNite 3.2.0: los modelos `pynite` de modelos-oraculo.json.

PyNite es Euler–Bernoulli, condensa las liberaciones e integra las cargas de barra en forma
cerrada (H11): sirve de oráculo para las barras sin cortante ni offsets, con todas las cargas.

Correspondencias:
- barra → Member3D con su `rotation` calculada para que el z local de PyNite sea el nuestro (PyNite
  gira y y z alrededor de x con la fórmula de Rodrigues); se comprueba a 1e-12;
- modificadores → aplicados a la sección; liberaciones → def_releases;
- cargas de barra → add_member_pt_load / add_member_dist_load por componente, en ejes locales
  ('Fx'…'Mz') o globales ('FX'…'MZ'), con las posiciones desde el nudo i (no hay offsets);
- un caso → una combinación de factor 1.

Salida, por modelo y caso: u y reacciones (6 por nudo) y, por barra, los esfuerzos de PyNite en
las estaciones x = fracción·L: [axial, Fy, Fz, torque, My, Mz] tal como los da PyNite (el test les
cambia el signo: con los mismos ejes, PyNite = −CSI, H02).

Uso: .venv/Scripts/python.exe validacion/e2/oraculo_pynite.py
Escribe src/motor/__fixtures__/pynite-e2.json.
"""
import json
import math
import os

import numpy as np
from Pynite import FEModel3D

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))

LOCALES = ["Fx", "Fy", "Fz", "Mx", "My", "Mz"]
GLOBALES = ["FX", "FY", "FZ", "MX", "MY", "MZ"]


def ejes_nuestros(Xi, Xj, vz):
    x = np.subtract(Xj, Xi)
    x = x / np.linalg.norm(x)
    vz = np.asarray(vz, dtype=float)
    z = vz - np.dot(vz, x) * x
    z = z / np.linalg.norm(z)
    y = np.cross(z, x)
    return x, y, z


def resolver(modelo, fracciones):
    m = FEModel3D()
    nudos = modelo["nudos"]
    for k, n in enumerate(nudos):
        m.add_node(f"N{k}", n["x"], n["y"], n["z"])
    for a in modelo.get("apoyos", []):
        m.def_support(f"N{a['nudo']}", *a["coartados"])

    for b, barra in enumerate(modelo["barras"]):
        assert not barra.get("offsets"), "PyNite no tiene offsets"
        s = barra["seccion"]
        assert "Avy" not in s and "Avz" not in s, "PyNite es Euler–Bernoulli"
        md = barra.get("modificadores") or {}
        m.add_material(f"M{b}", s["E"], s["G"], 0.3, 0.0)
        m.add_section(f"S{b}", s["A"] * md.get("A", 1), s["Iy"] * md.get("Iy", 1), s["Iz"] * md.get("Iz", 1), s["J"] * md.get("J", 1))
        i, j = barra["nudos"]
        m.add_member(f"B{b}", f"N{i}", f"N{j}", f"M{b}", f"S{b}")
        miembro = m.members[f"B{b}"]
        # rotación para que el z local de PyNite sea el nuestro
        Xi = [nudos[i]["x"], nudos[i]["y"], nudos[i]["z"]]
        Xj = [nudos[j]["x"], nudos[j]["y"], nudos[j]["z"]]
        x, y, z = ejes_nuestros(Xi, Xj, barra["vz"])
        z0 = miembro.T()[2, 0:3]
        theta = math.atan2(np.dot(np.cross(z0, z), x), np.dot(z0, z))
        miembro.rotation = math.degrees(theta)
        T = miembro.T()
        assert np.allclose(T[0, 0:3], x, atol=1e-12) and np.allclose(T[1, 0:3], y, atol=1e-12) and np.allclose(T[2, 0:3], z, atol=1e-12), f"ejes de B{b}"
        lib = barra.get("liberaciones") or {}
        li = lib.get("i") or [False] * 6
        lj = lib.get("j") or [False] * 6
        if any(li) or any(lj):
            m.def_releases(f"B{b}", *li, *lj)

    for caso in modelo["casos"]:
        nombre = caso["id"]
        for c in caso.get("nodales", []):
            for g, v in enumerate(c["f"]):
                if v != 0:
                    m.add_node_load(f"N{c['nudo']}", GLOBALES[g], v, nombre)
        for c in caso.get("barras", []):
            dirs = LOCALES if c["ejes"] == "local" else GLOBALES
            miembro = f"B{c['barra']}"
            L = m.members[miembro].L()
            if c["tipo"] == "puntual":
                for k, v in enumerate((c.get("F") or [0, 0, 0]) + (c.get("M") or [0, 0, 0])):
                    if v != 0:
                        m.add_member_pt_load(miembro, dirs[k], v, c["x"], nombre)
            else:
                qa = c["qa"]
                qb = c.get("qb") or qa
                a = c.get("a", 0.0)
                b = c.get("b", L)
                for k in range(3):
                    if qa[k] != 0 or qb[k] != 0:
                        m.add_member_dist_load(miembro, dirs[k], qa[k], qb[k], a, b, nombre)
        m.add_load_combo(f"C:{nombre}", {nombre: 1.0})

    m.analyze_linear(check_statics=False)

    salida = {}
    for caso in modelo["casos"]:
        combo = f"C:{caso['id']}"
        u = []
        r = []
        for k in range(len(nudos)):
            n = m.nodes[f"N{k}"]
            u.extend([n.DX[combo], n.DY[combo], n.DZ[combo], n.RX[combo], n.RY[combo], n.RZ[combo]])
            r.extend([n.RxnFX[combo], n.RxnFY[combo], n.RxnFZ[combo], n.RxnMX[combo], n.RxnMY[combo], n.RxnMZ[combo]])
        esfuerzos = []
        for b in range(len(modelo["barras"])):
            miembro = m.members[f"B{b}"]
            L = miembro.L()
            filas = []
            for f in fracciones:
                xx = f * L
                filas.append([
                    miembro.axial(xx, combo),
                    miembro.shear("Fy", xx, combo),
                    miembro.shear("Fz", xx, combo),
                    miembro.torque(xx, combo),
                    miembro.moment("My", xx, combo),
                    miembro.moment("Mz", xx, combo),
                ])
            esfuerzos.append(filas)
        salida[caso["id"]] = {"u": u, "reacciones": r, "esfuerzos": esfuerzos}
    return salida


def main():
    with open(os.path.join(AQUI, "modelos-oraculo.json"), encoding="utf-8") as f:
        datos = json.load(f)
    import Pynite

    resultado = {"pynite": getattr(Pynite, "__version__", "3.2.0"), "fracciones": datos["fracciones"], "modelos": {}}
    for nombre, modelo in datos["pynite"].items():
        resultado["modelos"][nombre] = resolver(modelo, datos["fracciones"])
        print(f"{nombre}: {len(modelo['casos'])} casos")
    ruta = os.path.join(RAIZ, "src", "motor", "__fixtures__", "pynite-e2.json")
    with open(ruta, "w", encoding="utf-8", newline="\n") as f:
        json.dump(resultado, f)
    print(f"escrito {ruta}")


if __name__ == "__main__":
    main()
