# Experimentos E1 sobre PyNite 3.2.0 (CPython 3.14, venv propio) para el área 2
# (compilador y mallado). Unidades SI: N, m, Pa. Eje vertical de PyNite = Y.
# Uso: PYTHONIOENCODING=utf-8 venv/Scripts/python.exe py/exp_pynite.py
import math, warnings, json, traceback
import numpy as np
from Pynite import FEModel3D
import Pynite

warnings.filterwarnings("ignore")
out = {"pynite": getattr(Pynite, "__version__", "3.2.0 (pip show)")}

E = 30e9; NU = 0.2; G = E / (2 * (1 + NU)); RHO = 2500
b, h = 0.30, 0.50
A = b * h; Iz = b * h**3 / 12; Iy = h * b**3 / 12; J = 0.0028


def base():
    m = FEModel3D()
    m.add_material("C", E, G, NU, RHO)
    m.add_section("S", A, Iy, Iz, J)
    return m


# ── P1: ¿integra PyNite exactamente la carga de barra? 1 elemento vs 10 ─────
def p1():
    L, w, P, a = 6.0, -10e3, -20e3, 2.2
    res = {}
    for n in (1, 10):
        m = base()
        for k in range(n + 1):
            m.add_node(f"N{k}", L * k / n, 0, 0)
        for k in range(n):
            m.add_member(f"M{k}", f"N{k}", f"N{k+1}", "C", "S")
        m.def_support("N0", True, True, True, True, False, False)
        m.def_support(f"N{n}", False, True, True, False, False, False)
        # UDL total + carga trapecial parcial 1,0–4,5 m + puntual a 2,2 m, repartidas por tramo
        for k in range(n):
            x0, x1 = L * k / n, L * (k + 1) / n
            m.add_member_dist_load(f"M{k}", "FY", w, w, case="D")
            lo, hi = max(1.0, x0), min(4.5, x1)
            if hi > lo:
                f = lambda x: -5e3 - 3e3 * (x - 1.0) / 3.5
                m.add_member_dist_load(f"M{k}", "FY", f(lo), f(hi), lo - x0, hi - x0, case="D")
            if x0 <= a < x1:
                m.add_member_pt_load(f"M{k}", "FY", P, a - x0, case="D")
        m.add_load_combo("C1", {"D": 1.0})
        m.analyze_linear(check_statics=False)
        # flecha en 3,0 m y momento en 3,0 m
        mid = n // 2
        if n == 1:
            mem = m.members["M0"]
            d3 = mem.deflection("dy", 3.0, "C1"); M3 = mem.moment("Mz", 3.0, "C1")
        else:
            d3 = m.nodes[f"N{mid}"].DY["C1"]
            mem = m.members[f"M{mid}"]; M3 = mem.moment("Mz", 0.0, "C1")
        res[f"{n} elemento(s)"] = {"flecha_3m_mm": d3 * 1e3, "Mz_3m_kNm": M3 / 1e3,
                                   "giro_apoyo_mrad": m.nodes["N0"].RZ["C1"] * 1e3}
    a1, a10 = res["1 elemento(s)"], res["10 elemento(s)"]
    res["dif_rel_flecha"] = abs(a1["flecha_3m_mm"] - a10["flecha_3m_mm"]) / abs(a10["flecha_3m_mm"])
    res["dif_rel_M"] = abs(a1["Mz_3m_kNm"] - a10["Mz_3m_kNm"]) / abs(a10["Mz_3m_kNm"])
    # solución analítica solo UDL+puntual+trapecio por superposición numérica (integración exacta de la elástica)
    xs = np.linspace(0, L, 600001)
    q = np.full_like(xs, w) + np.where((xs >= 1.0) & (xs <= 4.5), -5e3 - 3e3 * (xs - 1.0) / 3.5, 0)
    # reacciones
    Wq = np.trapezoid(q, xs); Mq = np.trapezoid(q * xs, xs)
    RB = -(Mq + P * a) / L; RA = -(Wq + P) - RB
    # M(3) analítico (convención: momento positivo = fibra inferior traccionada)
    sel = xs <= 3.0
    M3 = RA * 3.0 + np.trapezoid(q[sel] * (3.0 - xs[sel]), xs[sel]) + P * (3.0 - a)
    res["Mz_3m_analitico_kNm"] = M3 / 1e3
    return res


# ── P2: PhysMember se trocea solo en CUALQUIER nudo sobre su eje (tol 1e-12·(1+L)) ──
def p2():
    res = {}
    for off in (0.0, 1e-9, 1e-6):
        m = base()
        m.add_node("A", 0, 0, 0); m.add_node("B", 6, 0, 0)
        m.add_node("X", 3, off, 0)          # nudo de OTRO elemento (p. ej. arranque de un pilar)
        m.add_node("T", 3, 3, 0)
        m.add_member("VIGA", "A", "B", "C", "S")
        m.add_member("PILAR", "X", "T", "C", "S")
        for n in ("A", "B"):
            m.def_support(n, True, True, True, True, True, True)
        m.add_node_load("T", "FY", -100e3, "D")
        m.add_load_combo("C1", {"D": 1.0})
        try:
            m.analyze_linear(check_statics=False)
            res[f"desvio {off:g} m"] = {"submiembros_VIGA": len(m.members["VIGA"].sub_members),
                                         "DY_T_mm": m.nodes["T"].DY["C1"] * 1e3}
        except Exception as e:
            res[f"desvio {off:g} m"] = {"error": type(e).__name__ + ": " + str(e)[:160]}
    return res


# ── P3: merge_duplicate_nodes pierde las cargas del nudo eliminado ──────────────
def p3():
    m = base()
    m.add_node("A", 0, 0, 0); m.add_node("B", 0, 3, 0); m.add_node("B2", 0, 3, 0)
    m.add_node("C", 4, 3, 0)
    m.add_member("P", "A", "B", "C", "S"); m.add_member("V", "B2", "C", "C", "S")
    m.def_support("A", True, True, True, True, True, True)
    m.def_support("C", False, True, False, False, False, False)
    m.add_node_load("B2", "FX", 50e3, "D")   # la carga está en el duplicado
    removed = m.merge_duplicate_nodes(1e-3)
    m.add_load_combo("C1", {"D": 1.0})
    m.analyze_linear(check_statics=False)
    RX = m.nodes["A"].RxnFX["C1"] + m.nodes["C"].RxnFX["C1"]
    return {"nudos_eliminados": removed, "suma_reacciones_FX_kN": RX / 1e3,
            "carga_aplicada_kN": 50.0, "carga_perdida": abs(RX) < 1e-6}


# ── P4: Tri3D existe en el paquete pero no es utilizable ───────────────────────
def p4():
    from Pynite.Tri3D import Tri3D
    res = {"FEModel3D_tiene_add_tri": hasattr(FEModel3D, "add_tri"),
           "FEModel3D_tiene_tris": hasattr(FEModel3D(), "tris")}
    m = base()
    for n, xyz in (("a", (0, 0, 0)), ("b", (1, 0, 0)), ("c", (0, 0, 1))):
        m.add_node(n, *xyz)
    t = Tri3D("T1", m.nodes["a"], m.nodes["b"], m.nodes["c"], 0.2, "C", m)
    try:
        k = t.ke(); res["ke_shape"] = list(k.shape)
    except Exception as e:
        res["ke_error"] = type(e).__name__ + ": " + str(e)[:120]
    return res


# ── P5: kx_mod/ky_mod en Quad3D sólo tocan la membrana; en Plate3D, la flexión ──
def p5():
    res = {}
    for et in ("Quad", "Rect"):
        for kx in (1.0, 0.1):
            m = base()
            # losa 6 x 3 m en plano XZ (PyNite: Y vertical), luz en X, apoyos en x=0 y x=6
            m.add_rectangle_mesh("L", 0.5, 6.0, 3.0, 0.25, "C", kx_mod=kx, ky_mod=1.0,
                                 origin=(0, 0, 0), plane="XZ", element_type=et)
            m.meshes["L"].generate()
            for n in m.nodes.values():
                if abs(n.X) < 1e-9 or abs(n.X - 6) < 1e-9:
                    m.def_support(n.name, True, True, True, False, False, False)
            # restricción membrana mínima para que no haya mecanismo en el plano
            for el in list(m.meshes["L"].elements):
                (m.add_quad_surface_pressure if et == "Quad" else m.add_plate_surface_pressure)(el, 10e3, "D")
            m.add_load_combo("C1", {"D": 1.0})
            m.analyze_linear(check_statics=False)
            dmax = max(abs(n.DY["C1"]) for n in m.nodes.values())
            res[f"{et} kx_mod={kx}"] = {"flecha_max_mm": dmax * 1e3}
    return res


# ── P6: el signo de la presión depende del orden de nodos (normal local) ─────
def p6():
    res = {}
    for orden in ("antihorario", "horario"):
        m = base()
        pts = {"n1": (0, 0, 0), "n2": (1, 0, 0), "n3": (1, 0, 1), "n4": (0, 0, 1)}
        for k, v in pts.items():
            m.add_node(k, *v)
        nodes = ["n1", "n2", "n3", "n4"] if orden == "antihorario" else ["n1", "n4", "n3", "n2"]
        m.add_quad("Q", *nodes, 0.2, "C")
        for k in ("n1", "n2"):
            m.def_support(k, True, True, True, True, True, True)
        m.add_quad_surface_pressure("Q", 10e3, "D")
        m.add_load_combo("C1", {"D": 1.0})
        m.analyze_linear(check_statics=False)
        res[orden] = {"DY_n3_mm": m.nodes["n3"].DY["C1"] * 1e3}
    return res


# ── P7: viga que acomete EN EL PLANO de un muro (giro de perforación) ─────────
def p7():
    res = {}
    P = -20e3; Lb = 2.0
    ref = Lb**3 / (3 * E * Iz) * abs(P)
    res["voladizo_empotrado_teorico_mm"] = ref * 1e3
    for caso in ("rigido", "muro_directo", "muro_viga_embebida_1elem", "muro_viga_embebida_todo"):
        m = base()
        if caso == "rigido":
            m.add_node("R", 3, 3, 0); m.add_node("Tp", 3 + Lb, 3, 0)
            m.def_support("R", True, True, True, True, True, True)
            m.add_member("V", "R", "Tp", "C", "S")
        else:
            # muro 3 x 3 m, t = 0,25, en plano XY (vertical en PyNite), base empotrada
            m.add_rectangle_mesh("W", 0.5, 3.0, 3.0, 0.25, "C", origin=(0, 0, 0), plane="XY")
            m.meshes["W"].generate()
            corner = None
            for n in list(m.nodes.values()):
                if abs(n.Y) < 1e-9:
                    m.def_support(n.name, True, True, True, True, True, True)
                if abs(n.X - 3) < 1e-9 and abs(n.Y - 3) < 1e-9:
                    corner = n.name
            m.add_node("Tp", 3 + Lb, 3, 0)
            m.add_member("V", corner, "Tp", "C", "S")
            if caso.startswith("muro_viga_embebida"):
                x0 = 2.5 if caso.endswith("1elem") else 0.0
                tops = sorted([n for n in m.nodes.values() if abs(n.Y - 3) < 1e-9 and x0 - 1e-9 <= n.X <= 3 + 1e-9 and n.name != "Tp"], key=lambda n: n.X)
                for i in range(len(tops) - 1):
                    m.add_member(f"E{i}", tops[i].name, tops[i + 1].name, "C", "S")
        m.add_node_load("Tp", "FY", P, "D")
        m.add_load_combo("C1", {"D": 1.0})
        m.analyze_linear(check_statics=False)
        res[caso] = {"flecha_punta_mm": abs(m.nodes["Tp"].DY["C1"]) * 1e3,
                     "M_empotramiento_kNm": m.members["V"].moment("Mz", 0.0, "C1") / 1e3}
    # control: viga PERPENDICULAR al muro (flexión fuera del plano del muro, no perforación)
    m = base()
    m.add_rectangle_mesh("W", 0.5, 3.0, 3.0, 0.25, "C", origin=(0, 0, 0), plane="XY")
    m.meshes["W"].generate()
    for n in list(m.nodes.values()):
        if abs(n.Y) < 1e-9:
            m.def_support(n.name, True, True, True, True, True, True)
    mid = [n for n in m.nodes.values() if abs(n.X - 1.5) < 1e-9 and abs(n.Y - 3) < 1e-9][0]
    m.add_node("Tp", 1.5, 3, Lb)
    m.add_member("V", mid.name, "Tp", "C", "S")
    m.add_node_load("Tp", "FY", P, "D")
    m.add_load_combo("C1", {"D": 1.0})
    m.analyze_linear(check_statics=False)
    res["control_viga_perpendicular_al_muro"] = {"flecha_punta_mm": abs(m.nodes["Tp"].DY["C1"]) * 1e3}
    return res


# ── P8: ¿admite Quad3D un cuadrilátero degenerado (triángulo con nodo repetido)? ──
def p8():
    res = {}
    m = base()
    for k, v in {"a": (0, 0, 0), "b": (1, 0, 0), "c": (0, 0, 1)}.items():
        m.add_node(k, *v)
    try:
        m.add_quad("Q", "a", "b", "c", "c", 0.2, "C")
        k = m.quads["Q"].ke()
        res["ke_finita"] = bool(np.all(np.isfinite(k)))
    except Exception as e:
        res["error"] = type(e).__name__ + ": " + str(e)[:160]
    return res


# ── P9: diafragma rígido por penalización (barras muy rígidas) vs losa shell ──
def p9():
    res = {}
    H, Lx = 3.0, 6.0
    for modo, alpha in [("sin_diafragma", None)] + [("barras_rigidas", a) for a in (1e0, 1e2, 1e4, 1e6, 1e8, 1e10)] + [("losa_shell", None)]:
        m = base()
        m.add_material("RIG", E * (alpha or 1), G * (alpha or 1), NU, 0)
        corners = [(0, 0), (Lx, 0), (Lx, Lx), (0, Lx)]
        for i, (x, z) in enumerate(corners):
            m.add_node(f"B{i}", x, 0, z); m.add_node(f"T{i}", x, H, z)
            m.def_support(f"B{i}", True, True, True, True, True, True)
            m.add_member(f"P{i}", f"B{i}", f"T{i}", "C", "S")
        if modo == "losa_shell":
            m.add_rectangle_mesh("L", 0.5, Lx, Lx, 0.25, "C", origin=(0, H, 0), plane="XZ")
            m.meshes["L"].generate()
            m.merge_duplicate_nodes(1e-6)
            top = {}
            for n in m.nodes.values():
                for i, (x, z) in enumerate(corners):
                    if abs(n.X - x) < 1e-9 and abs(n.Y - H) < 1e-9 and abs(n.Z - z) < 1e-9:
                        top[i] = n.name
            names = [top[i] for i in range(4)]
        else:
            names = [f"T{i}" for i in range(4)]
        for i in range(4):
            m.add_member(f"V{i}", names[i], names[(i + 1) % 4], "C", "S")
        if modo == "barras_rigidas":
            m.add_section("SR", 0.01, 1e-6, 1e-6, 1e-6)
            m.add_member("D0", names[0], names[2], "RIG", "SR"); m.add_member("D1", names[1], names[3], "RIG", "SR")
            for d in ("D0", "D1"):
                m.def_releases(d, Ryi=True, Rzi=True, Ryj=True, Rzj=True)
        m.add_node_load(names[0], "FX", 100e3, "W")   # viento excéntrico en una esquina
        m.add_load_combo("C1", {"W": 1.0})
        m.analyze_linear(check_statics=False)
        ux = [m.nodes[n].DX["C1"] * 1e3 for n in names]
        Nv = [m.members[f"V{i}"].axial(0.5 * m.members[f"V{i}"].L(), "C1") / 1e3 for i in range(4)]
        K = m.K("C1") if hasattr(m, "K") else None
        try:
            Kd = m.Ke("C1", sparse=False) if K is None else K
        except Exception:
            Kd = None
        cond = None
        if Kd is not None:
            Kd = np.asarray(Kd.todense() if hasattr(Kd, "todense") else Kd)
            free = [i for i in range(Kd.shape[0]) if Kd[i, i] != 0]
            cond = float(np.linalg.cond(Kd))
        key = modo if alpha is None else f"{modo} x{alpha:g}"
        res[key] = {"ux_esquinas_mm": [round(u, 4) for u in ux], "N_vigas_kN": [round(n, 3) for n in Nv],
                    "cond_K": cond}
    return res


for name, fn in [("P1_carga_barra_exacta", p1), ("P2_physmember_autotroceo", p2), ("P3_merge_pierde_cargas", p3),
                 ("P4_tri3d", p4), ("P5_kmod_quad_vs_rect", p5), ("P6_signo_presion_orden", p6),
                 ("P7_perforacion_viga_muro", p7), ("P8_quad_degenerado", p8), ("P9_diafragma_penalizacion", p9)]:
    try:
        out[name] = fn()
    except Exception as e:
        out[name] = {"error": type(e).__name__ + ": " + str(e)[:300], "tb": traceback.format_exc()[-800:]}
    print(name, "hecho", flush=True)

json.dump(out, open("py/salida-pynite.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False, default=float)
print(json.dumps(out, indent=2, ensure_ascii=False, default=float))
