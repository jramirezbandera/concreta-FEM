"""Oráculo externo de BN1 (criterio 8, `docs/fem3d/barras.md`) con PyNite 3.2.0.

Monta en PyNite, desde su modelo FÍSICO y sin pasar por el compilador, el pórtico de acero de
`src/pruebas/barras.ts` (`porticoAcero`, exportado por `oraculo.ts` a `oraculo-entrada.json`):

- cotas: las plantas van de arriba abajo y la más baja está en 0;
- nudos: los de los pilares en cada planta, los extremos de las vigas y los de las barras; una viga se
  parte en los nudos que caen sobre su eje;
- ejes locales, calculados aquí con numpy: pilar, z = el canto girado `giro` desde +X; viga, z = +Z;
  barra, z en el plano vertical que la contiene y hacia arriba, girado `giro` alrededor de x (vertical,
  +X girado); y = z × x. La `rotation` de cada miembro de PyNite se elige para que sus ejes sean ésos;
- cargas: el peso propio γ·A por metro real en −Z; las de viga y de barra, por componente, en locales
  ('Fx'…) o globales ('FX'…), partidas por los tramos de la viga; las puntuales, al nudo;
- PyNite es Euler–Bernoulli: el compilador va con `cortante: false`.

Salida, por caso: por nudo, sus coordenadas, u y reacciones; por barra, el axil de PyNite en el centro
(PyNite = −CSI, H02).

Uso: .venv/Scripts/python.exe validacion/bn/oraculo_pynite.py
Escribe src/compilador/__fixtures__/pynite-bn.json.
"""
import json
import math
import os

import numpy as np
from Pynite import FEModel3D

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
LOCALES = ["Fx", "Fy", "Fz"]
GLOBALES = ["FX", "FY", "FZ"]
MOMENTOS = ["MX", "MY", "MZ"]


def unit(v):
    v = np.asarray(v, dtype=float)
    return v / np.linalg.norm(v)


def girar(z0, x, grados):
    t = math.radians(grados)
    return math.cos(t) * z0 + math.sin(t) * np.cross(x, z0)


def main():
    with open(os.path.join(AQUI, "oraculo-entrada.json"), encoding="utf-8") as f:
        fisico = json.load(f)

    # Cotas: de abajo arriba, cada planta su altura hasta la de encima
    plantas = fisico["plantas"]
    cota = {plantas[-1]["id"]: 0.0}
    for k in range(len(plantas) - 2, -1, -1):
        cota[plantas[k]["id"]] = cota[plantas[k + 1]["id"]] + plantas[k + 1]["altura"]
    orden = [p["id"] for p in plantas]

    mat = fisico["materiales"][0]
    E = mat.get("E", 210000) * 1e3
    G = E / (2 * 1.3)
    gamma = mat.get("peso", 78.5)
    secciones = {s["id"]: s for s in fisico["secciones"]}

    m = FEModel3D()
    nudos = {}

    def nudo(x, y, z):
        clave = (round(x, 9), round(y, 9), round(z, 9))
        if clave not in nudos:
            nombre = f"N{len(nudos)}"
            nudos[clave] = nombre
            m.add_node(nombre, x, y, z)
        return nudos[clave]

    for s in secciones.values():
        m.add_section(s["id"], s["A"], s["Iy"], s["Iz"], s["J"])
    m.add_material("S", E, G, 0.3, 0.0)

    miembros = []  # (nombre, Xi, Xj, z local, seccion)

    def miembro(nombre, Xi, Xj, z, seccion, liberaciones=None):
        ni, nj = nudo(*Xi), nudo(*Xj)
        m.add_member(nombre, ni, nj, "S", seccion)
        mb = m.members[nombre]
        x = unit(np.subtract(Xj, Xi))
        z = unit(np.asarray(z) - np.dot(z, x) * x)
        y = np.cross(z, x)
        z0 = mb.T()[2, 0:3]
        mb.rotation = math.degrees(math.atan2(np.dot(np.cross(z0, z), x), np.dot(z0, z)))
        T = mb.T()
        assert np.allclose(T[0, 0:3], x, atol=1e-12) and np.allclose(T[1, 0:3], y, atol=1e-12) and np.allclose(T[2, 0:3], z, atol=1e-12), nombre
        if liberaciones:
            li = liberaciones.get("inicio") or [False] * 6
            lj = liberaciones.get("fin") or [False] * 6
            m.def_releases(nombre, *li, *lj)
        miembros.append((nombre, np.asarray(Xi, float), np.asarray(Xj, float), seccion))
        return nombre

    # Pilares: un tramo por planta, empotrados en su base
    for p in fisico["pilares"]:
        kb, kh = orden.index(p["desde"]), orden.index(p["hasta"])
        t = math.radians(p.get("giro", 0))
        z = [math.cos(t), math.sin(t), 0.0]
        for k in range(kb, kh, -1):
            miembro(f"{p['id']}:{orden[k - 1]}", (p["x"], p["y"], cota[orden[k]]), (p["x"], p["y"], cota[orden[k - 1]]), z, p["seccion"])
        m.def_support(nudo(p["x"], p["y"], cota[p["desde"]]), True, True, True, True, True, True)

    # Barras: su eje y sus ejes
    extremos = []
    barras = {}
    for b in fisico["barras"]:
        Xi = np.array([b["inicio"]["x"], b["inicio"]["y"], cota[b["inicio"]["planta"]]])
        Xj = np.array([b["fin"]["x"], b["fin"]["y"], cota[b["fin"]["planta"]]])
        x = unit(Xj - Xi)
        h = math.hypot(x[0], x[1])
        z0 = unit(np.array([0, 0, 1.0]) - x[2] * x) if h > 1e-9 else np.array([1.0, 0, 0])
        z = girar(z0, x, b.get("giro", 0))
        barras[b["id"]] = (Xi, Xj, z, b)
        extremos += [(b["inicio"]["planta"], Xi), (b["fin"]["planta"], Xj)]

    # Vigas: partidas por los extremos de barra y los pilares que caen sobre su eje
    tramos_viga = {}
    for v in fisico["vigas"]:
        z = cota[v["planta"]]
        A, B = np.array([*v["puntos"][0], z]), np.array([*v["puntos"][1], z])
        L = np.linalg.norm(B - A)
        u = (B - A) / L
        sigmas = {0.0, L}
        puntos = [np.array([p["x"], p["y"], z]) for p in fisico["pilares"]] + [X for pl, X in extremos if pl == v["planta"]]
        for X in puntos:
            s = float(np.dot(X - A, u))
            if 1e-9 < s < L - 1e-9 and np.linalg.norm(A + s * u - X) < 1e-9:
                sigmas.add(s)
        ss = sorted(sigmas)
        tramos_viga[v["id"]] = []
        for k in range(len(ss) - 1):
            nombre = miembro(f"{v['id']}:{k}", tuple(A + ss[k] * u), tuple(A + ss[k + 1] * u), [0, 0, 1.0], v["seccion"])
            tramos_viga[v["id"]].append((nombre, ss[k], ss[k + 1]))

    for bid, (Xi, Xj, z, b) in barras.items():
        miembro(bid, tuple(Xi), tuple(Xj), z, b["seccion"], b.get("liberaciones"))
        tramos_viga[bid] = [(bid, 0.0, float(np.linalg.norm(Xj - Xi)))]

    # Cargas
    for caso in fisico["casos"]:
        c = caso["id"]
        if caso.get("pesoPropio"):
            for nombre, Xi, Xj, s in miembros:
                w = gamma * secciones[s]["A"]
                m.add_member_dist_load(nombre, "FZ", -w, -w, 0, m.members[nombre].L(), c)
        for g in fisico["cargas"]:
            if g["caso"] != c:
                continue
            if g["tipo"] == "puntual":
                n = nudo(g["x"], g["y"], cota[g["planta"]])
                for k, v in enumerate(g.get("F", [0, 0, 0])):
                    if v:
                        m.add_node_load(n, GLOBALES[k], v, c)
                for k, v in enumerate(g.get("M", [0, 0, 0])):
                    if v:
                        m.add_node_load(n, MOMENTOS[k], v, c)
                continue
            pieza = g["viga"] if g["tipo"] == "viga" else g["barra"]
            ts = tramos_viga[pieza]
            total = ts[-1][2]
            a, b = g.get("desde", 0.0), g.get("hasta", total)
            qa = np.array(g["q"], float)
            qb = np.array(g.get("qb", g["q"]), float)
            q = lambda s: qa + (qb - qa) * (s - a) / (b - a)
            dirs = LOCALES if g["ejes"] == "local" else GLOBALES
            for nombre, s0, s1 in ts:
                lo, hi = max(a, s0), min(b, s1)
                if hi <= lo:
                    continue
                for k in range(3):
                    if q(lo)[k] or q(hi)[k]:
                        m.add_member_dist_load(nombre, dirs[k], q(lo)[k], q(hi)[k], lo - s0, hi - s0, c)
        m.add_load_combo(f"C:{c}", {c: 1.0})

    m.analyze_linear(check_statics=False)

    salida = {"casos": {}}
    for caso in fisico["casos"]:
        combo = f"C:{caso['id']}"
        filas = []
        for (x, y, z), nombre in nudos.items():
            n = m.nodes[nombre]
            filas.append({
                "X": [x, y, z],
                "u": [n.DX[combo], n.DY[combo], n.DZ[combo], n.RX[combo], n.RY[combo], n.RZ[combo]],
                "r": [n.RxnFX[combo], n.RxnFY[combo], n.RxnFZ[combo], n.RxnMX[combo], n.RxnMY[combo], n.RxnMZ[combo]],
            })
        axiles = {bid: m.members[bid].axial(m.members[bid].L() / 2, combo) for bid in barras}
        salida["casos"][caso["id"]] = {"nudos": filas, "axiles": axiles}
    import Pynite

    salida["pynite"] = getattr(Pynite, "__version__", "3.2.0")
    ruta = os.path.join(RAIZ, "src", "compilador", "__fixtures__", "pynite-bn.json")
    with open(ruta, "w", encoding="utf-8", newline="") as f:
        json.dump(salida, f)
    print(f"Escrito {ruta}")


if __name__ == "__main__":
    main()
