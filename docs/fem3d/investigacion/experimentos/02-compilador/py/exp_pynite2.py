# Experimentos E1-bis sobre PyNite 3.2.0: P5b (momentos con kx_mod) y P9
# (diafragma rígido por penalización vs losa shell). SI, Y vertical (PyNite).
import json, warnings, traceback
import numpy as np
from Pynite import FEModel3D
from Pynite import Analysis

warnings.filterwarnings("ignore")
E = 30e9; NU = 0.2; G = E / (2 * (1 + NU))
b, h = 0.30, 0.50
A = b * h; Iz = b * h**3 / 12; Iy = h * b**3 / 12; J = 0.0028
out = {}


def base():
    m = FEModel3D()
    m.add_material("C", E, G, NU, 2500)
    m.add_section("S", A, Iy, Iz, J)
    return m


def k11_cond(m):
    Analysis._prepare_model(m)
    D1, D2, _ = Analysis._partition_D(m)
    K = m.Ke(list(m.load_combos)[0], False, False, False)
    K11 = np.asarray(K)[np.ix_(D1, D1)]
    return float(np.linalg.cond(K11)), len(D1)


# ── P5b: momento de vano de una losa unidireccional 6 m, q = 10 kPa (teórico qL²/8 = 45 kN·m/m)
def p5b():
    res = {"teorico_kNm_m": 10e3 * 36 / 8 / 1e3}
    for et in ("Quad", "Rect"):
        for kx in (1.0, 0.1):
            m = base()
            m.add_rectangle_mesh("L", 0.5, 6.0, 3.0, 0.25, "C", kx_mod=kx, ky_mod=1.0, origin=(0, 0, 0), plane="XZ", element_type=et)
            m.meshes["L"].generate()
            for n in m.nodes.values():
                if abs(n.X) < 1e-9 or abs(n.X - 6) < 1e-9:
                    m.def_support(n.name, True, True, True, False, False, False)
            els = m.meshes["L"].elements
            for el in els:
                (m.add_quad_surface_pressure if et == "Quad" else m.add_plate_surface_pressure)(el, 10e3, "D")
            m.add_load_combo("C1", {"D": 1.0})
            m.analyze_linear(check_statics=False)
            # elemento cuyo centro está más cerca de (3, 1.5)
            best = None
            for name, el in els.items():
                xs = [el.i_node.X, el.j_node.X, el.m_node.X, el.n_node.X]
                zs = [el.i_node.Z, el.j_node.Z, el.m_node.Z, el.n_node.Z]
                d = (np.mean(xs) - 3.25) ** 2 + (np.mean(zs) - 1.25) ** 2
                if best is None or d < best[0]:
                    best = (d, name, el)
            el = best[2]
            if et == "Quad":
                M = el.moment(0.0, 0.0, True, "C1").flatten()
            else:
                M = el.moment(el.width() / 2, el.height() / 2, True, "C1").flatten()
            res[f"{et} kx_mod={kx}"] = {"Mx_centro_kNm_m": float(M[0]) / 1e3, "My": float(M[1]) / 1e3,
                                        "flecha_max_mm": max(abs(n.DY["C1"]) for n in m.nodes.values()) * 1e3}
    return res


# ── P9: diafragma rígido por penalización (dos diagonales "rígidas") vs losa shell
def p9():
    res = {}
    H, Lx = 3.0, 6.0
    modos = [("sin_diafragma", None)] + [("diagonales_rigidas", a) for a in (1e0, 1e2, 1e4, 1e6, 1e8, 1e10, 1e12)] + [("losa_shell_t25", None)]
    for modo, alpha in modos:
        key = modo if alpha is None else f"{modo} EA x{alpha:g}"
        try:
            m = base()
            corners = [(0, 0), (Lx, 0), (Lx, Lx), (0, Lx)]
            for i, (x, z) in enumerate(corners):
                m.add_node(f"B{i}", x, 0, z)
                m.def_support(f"B{i}", True, True, True, True, True, True)
            if modo.startswith("losa"):
                m.add_rectangle_mesh("L", 0.5, Lx, Lx, 0.25, "C", origin=(0, H, 0), plane="XZ")
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
            for i in range(4):
                if not modo.startswith("losa"):
                    m.add_member(f"V{i}", names[i], names[(i + 1) % 4], "C", "S")
            if modo.startswith("losa"):
                # vigas de borde sobre la malla: nudos de borde ya existen → PhysMember se trocea solo
                for i in range(4):
                    m.add_member(f"V{i}", names[i], names[(i + 1) % 4], "C", "S")
            if modo == "diagonales_rigidas":
                m.add_material("RIG", E * alpha, G * alpha, NU, 0)
                m.add_section("SR", 0.01, 1e-6, 1e-6, 1e-6)
                m.add_member("D0", names[0], names[2], "RIG", "SR")
                m.add_member("D1", names[1], names[3], "RIG", "SR")
                for d in ("D0", "D1"):
                    m.def_releases(d, Dxi=False, Ryi=True, Rzi=True, Ryj=True, Rzj=True)
            m.add_node_load(names[0], "FX", 100e3, "W")
            m.add_load_combo("C1", {"W": 1.0})
            m.analyze_linear(check_statics=False)
            ux = [m.nodes[n].DX["C1"] * 1e3 for n in names]
            Nv = []
            for i in range(4):
                mem = m.members[f"V{i}"]
                Nv.append(mem.axial(mem.L() * 0.5, "C1") / 1e3)
            cond, ndof = k11_cond(m)
            # residuo relativo del equilibrio global en X
            RX = sum(m.nodes[f"B{i}"].RxnFX["C1"] for i in range(4))
            res[key] = {"ux_esquinas_mm": [round(u, 5) for u in ux], "N_vigas_kN": [round(n, 4) for n in Nv],
                        "cond_K11": f"{cond:.3e}", "gdl_libres": ndof, "error_equilibrio_rel": abs(RX + 100e3) / 100e3}
        except Exception as e:
            res[key] = {"error": type(e).__name__ + ": " + str(e)[:200]}
    return res


for name, fn in [("P5b_momentos_kmod", p5b)]:
    try:
        out[name] = fn()
    except Exception as e:
        out[name] = {"error": str(e), "tb": traceback.format_exc()[-1500:]}
json.dump(out, open("py/salida-pynite2-p5b.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print(json.dumps(out, indent=2, ensure_ascii=False))
