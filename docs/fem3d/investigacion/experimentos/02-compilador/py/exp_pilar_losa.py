# P10: pilar como PUNTO de la malla de losa vs pilar con su sección (zona rígida).
# Losa 6 x 6 m, t = 0,25 m, apoyada en sus 4 bordes (sólo vertical) y en un pilar
# central 0,40 x 0,40 m; q = 10 kPa. Momento Mx en el nudo del pilar y en la cara
# (x = 0,20 m del eje) frente al tamaño de malla. PyNite 3.2.0 (Quad3D, DKMQ).
import json, time, warnings
import numpy as np
from Pynite import FEModel3D

warnings.filterwarnings("ignore")
E = 30e9; NU = 0.2; G = E / (2 * (1 + NU))
L, T, Q, C = 6.0, 0.25, 10e3, 0.40


def run(hm, modo):
    m = FEModel3D()
    m.add_material("C", E, G, NU, 2500)
    xc = [L / 2 - C / 2, L / 2 + C / 2]
    m.add_rectangle_mesh("L", hm, L, L, T, "C", origin=(0, 0, 0), plane="XZ", x_control=(list(xc) if modo != "punto" else []) + [L / 2], y_control=(list(xc) if modo != "punto" else []) + [L / 2])
    t0 = time.perf_counter(); m.meshes["L"].generate(); tgen = time.perf_counter() - t0
    centro = None
    for n in m.nodes.values():
        if abs(n.X) < 1e-9 or abs(n.X - L) < 1e-9 or abs(n.Z) < 1e-9 or abs(n.Z - L) < 1e-9:
            m.def_support(n.name, True, True, True, False, False, False)
        if abs(n.X - L / 2) < 1e-9 and abs(n.Z - L / 2) < 1e-9:
            centro = n.name
    if modo == "punto":
        m.def_support(centro, False, True, False, False, False, False)
    else:  # sección del pilar: todos los nudos de la huella apoyados en vertical (aprox. de zona rígida)
        for n in m.nodes.values():
            if xc[0] - 1e-9 <= n.X <= xc[1] + 1e-9 and xc[0] - 1e-9 <= n.Z <= xc[1] + 1e-9:
                m.def_support(n.name, False, True, False, False, False, False)
    for q in m.meshes["L"].elements:
        m.add_quad_surface_pressure(q, Q, "D")
    m.add_load_combo("C1", {"D": 1.0})
    t0 = time.perf_counter(); m.analyze_linear(check_statics=False); tsol = time.perf_counter() - t0
    # Mx promediado en el nudo central (elementos que lo tocan) y en la cara x = 2,8+0,4 = 3,2
    def mx_en(x, z):
        vals = []
        for el in m.meshes["L"].elements.values():
            ns = [el.i_node, el.j_node, el.m_node, el.n_node]
            for k, nd in enumerate(ns):
                if abs(nd.X - x) < 1e-9 and abs(nd.Z - z) < 1e-9:
                    xi, eta = [(-1, -1), (1, -1), (1, 1), (-1, 1)][k]
                    vals.append(float(np.ravel(el.moment(xi, eta, True, "C1"))[0]))
        return np.mean(vals) / 1e3 if vals else None
    R = sum(nd.RxnFY["C1"] for nd in m.nodes.values() if xc[0] - 1e-9 <= nd.X <= xc[1] + 1e-9 and xc[0] - 1e-9 <= nd.Z <= xc[1] + 1e-9)
    return {"nodos": len(m.nodes), "quads": len(m.meshes["L"].elements), "t_generar_s": round(tgen, 2), "t_resolver_s": round(tsol, 2),
            "Mx_eje_kNm_m": mx_en(L / 2, L / 2), "Mx_cara_kNm_m": mx_en(xc[1], L / 2) if modo != "punto" else None, "R_pilar_kN": R / 1e3}


res = {}
for hm in (1.0, 0.5, 0.25, 0.125):
    for modo in ("punto", "seccion"):
        res[f"h={hm} {modo}"] = run(hm, modo)
        print(hm, modo, res[f"h={hm} {modo}"], flush=True)
json.dump(res, open("py/salida-pilar-losa.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)
