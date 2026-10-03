# P9 v2: diafragma rígido sin constraints en el solver.
# Planta 6 x 6 m, 4 pilares HA 30x50 de 3 m empotrados, 4 vigas de borde, 100 kN
# horizontales (X) en una esquina (excéntricos -> torsión de planta).
# Modos: sin diafragma · barras rígidas por penalización (6 barras biarticuladas paralelas)
#        · maestro-esclavo exacto (transformación T sobre la K de PyNite, en numpy)
#        · losa shell t=0,25 · "membrana equivalente" (capa 5 cm con E·k y t/k).
import json, warnings, traceback
import numpy as np
from Pynite import FEModel3D, Analysis

warnings.filterwarnings("ignore")
E = 30e9; NU = 0.2; G = E / (2 * (1 + NU))
b, h = 0.30, 0.50
A = b * h; Iz = b * h**3 / 12; Iy = h * b**3 / 12; J = 0.0028
H, Lx = 3.0, 6.0
corners = [(0, 0), (Lx, 0), (Lx, Lx), (0, Lx)]
import sys
RX_LIBRE = len(sys.argv) > 1 and sys.argv[1] == "torsion_liberada"


def modelo(modo, alpha=None, k=None):
    m = FEModel3D()
    m.add_material("C", E, G, NU, 2500)
    m.add_section("S", A, Iy, Iz, J)
    for i, (x, z) in enumerate(corners):
        m.add_node(f"B{i}", x, 0, z)
        m.def_support(f"B{i}", True, True, True, True, True, True)
    if modo in ("losa_shell", "membrana_equivalente"):
        if modo == "losa_shell":
            t, Em = 0.25, E
        else:
            t, Em = 0.05 / k, E * k
            m.add_material("Cm", Em, Em / (2 * (1 + NU)), NU, 0)
        m.add_rectangle_mesh("L", 0.5, Lx, Lx, t, "C" if modo == "losa_shell" else "Cm", origin=(0, H, 0), plane="XZ")
        m.meshes["L"].generate()
        top = {}
        for n in m.nodes.values():
            for i, (x, z) in enumerate(corners):
                if abs(n.X - x) < 1e-9 and abs(n.Y - H) < 1e-9 and abs(n.Z - z) < 1e-9:
                    top[i] = n.name
        names = [top[i] for i in range(4)]
    else:
        for i, (x, z) in enumerate(corners):
            m.add_node(f"T{i}", x, H, z)
        names = [f"T{i}" for i in range(4)]
    for i in range(4):
        m.add_member(f"P{i}", f"B{i}", names[i], "C", "S")
        m.add_member(f"V{i}", names[i], names[(i + 1) % 4], "C", "S")
    if modo == "barras_rigidas":
        m.add_material("RIG", E * alpha, G * alpha, NU, 0)
        m.add_section("SR", A, 1e-6, 1e-6, 1e-6)
        pares = [(0, 1), (1, 2), (2, 3), (3, 0), (0, 2), (1, 3)]
        for j, (a, c) in enumerate(pares):
            m.add_member(f"R{j}", names[a], names[c], "RIG", "SR")
            m.def_releases(f"R{j}", Rxi=RX_LIBRE, Ryi=True, Rzi=True, Ryj=True, Rzj=True)
    m.add_node_load(names[0], "FX", 100e3, "W")
    m.add_load_combo("C1", {"W": 1.0})
    return m, names


def resultados(m, names):
    ux = [m.nodes[n].DX["C1"] * 1e3 for n in names]
    Nv = [m.members[f"V{i}"].axial(m.members[f"V{i}"].L() * 0.5, "C1") / 1e3 for i in range(4)]
    RX = sum(m.nodes[f"B{i}"].RxnFX["C1"] for i in range(4))
    return ux, Nv, abs(RX + 100e3) / 100e3


def cond_k11(m):
    Analysis._prepare_model(m)
    D1, D2, _ = Analysis._partition_D(m)
    K = np.asarray(m.Ke("C1", False, False, False))
    return float(np.linalg.cond(K[np.ix_(D1, D1)])), len(D1)


def maestro_esclavo():
    """Diafragma exacto: DX, DZ, RY de los 4 nudos de planta -> (Ux, Uz, θ) en el c.d.g."""
    m, names = modelo("sin_diafragma")
    Analysis._prepare_model(m)
    D1, D2, _ = Analysis._partition_D(m)
    K = np.asarray(m.Ke("C1", False, False, False))[np.ix_(D1, D1)]
    P = np.asarray(m.P("C1")).flatten()[D1]
    pos = {g: i for i, g in enumerate(D1)}
    xc, zc = Lx / 2, Lx / 2
    esclavos = {}
    for n in names:
        nd = m.nodes[n]
        esclavos[pos[nd.ID * 6 + 0]] = ("x", nd.Z - zc)
        esclavos[pos[nd.ID * 6 + 2]] = ("z", nd.X - xc)
        esclavos[pos[nd.ID * 6 + 4]] = ("ry", 0)
    libres = [i for i in range(len(D1)) if i not in esclavos]
    nr = len(libres) + 3
    T = np.zeros((len(D1), nr))
    for c, i in enumerate(libres):
        T[i, c] = 1
    iU, iW, iT = nr - 3, nr - 2, nr - 1
    for i, (tipo, d) in esclavos.items():
        if tipo == "x":
            T[i, iU] = 1; T[i, iT] = d        # ux = Ux + θ·dz
        elif tipo == "z":
            T[i, iW] = 1; T[i, iT] = -d       # uz = Uz − θ·dx
        else:
            T[i, iT] = 1                      # ry = θ
    Kr = T.T @ K @ T
    q = np.linalg.solve(Kr, T.T @ P)
    u = T @ q
    ux = [u[pos[m.nodes[n].ID * 6 + 0]] * 1e3 for n in names]
    # axil de las vigas: EA/L·Δu a lo largo del eje = 0 por construcción
    Nv = []
    for i in range(4):
        a, c = m.nodes[names[i]], m.nodes[names[(i + 1) % 4]]
        L = np.hypot(c.X - a.X, c.Z - a.Z); ex, ez = (c.X - a.X) / L, (c.Z - a.Z) / L
        ua = np.array([u[pos[a.ID * 6 + 0]], u[pos[a.ID * 6 + 2]]]); uc = np.array([u[pos[c.ID * 6 + 0]], u[pos[c.ID * 6 + 2]]])
        Nv.append(E * A / L * ((uc - ua) @ np.array([ex, ez])) / 1e3)
    return {"ux_esquinas_mm": [round(v, 5) for v in ux], "N_vigas_kN": [round(v, 6) for v in Nv],
            "cond_Kr": f"{np.linalg.cond(Kr):.3e}", "gdl": nr}


res = {}
casos = [("sin_diafragma", None, None)] + [("barras_rigidas", a, None) for a in (1e2, 1e4, 1e6, 1e8, 1e10)] + \
        [("losa_shell", None, None), ("membrana_equivalente", None, 20)]
for modo, alpha, k in casos:
    key = modo + (f" EA x{alpha:g}" if alpha else "") + (f" k={k}" if k else "")
    try:
        m, names = modelo(modo, alpha, k)
        cond, nd = cond_k11(m)
        m2, names = modelo(modo, alpha, k)
        m2.analyze_linear(check_statics=False)
        ux, Nv, err = resultados(m2, names)
        res[key] = {"ux_esquinas_mm": [round(v, 5) for v in ux], "N_vigas_kN": [round(v, 4) for v in Nv],
                    "cond_K11": f"{cond:.3e}", "gdl": nd, "err_equilibrio_rel": f"{err:.1e}"}
    except Exception as e:
        res[key] = {"error": type(e).__name__ + ": " + str(e)[:160]}
    print(key, res[key], flush=True)
try:
    res["maestro_esclavo_exacto"] = maestro_esclavo()
except Exception:
    res["maestro_esclavo_exacto"] = {"error": traceback.format_exc()[-600:]}
print("maestro_esclavo_exacto", res["maestro_esclavo_exacto"])
json.dump(res, open("py/salida-diafragma" + ("-torsion-liberada" if RX_LIBRE else "") + ".json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)
