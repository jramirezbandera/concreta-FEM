# P12: placa cuadrada 6 x 6 m simplemente apoyada (w = 0 en el contorno), t = 0,20,
# q = 10 kPa, ν = 0,3. Navier (Timoshenko, tabla 8): w = 0,00406·q·a⁴/D ; Mx = My = 0,0479·q·a².
# Compara Quad3D (DKMQ) con malla estructurada frente a quads de división tri -> 3 quads.
import json, time, warnings
import numpy as np
from Pynite import FEModel3D
warnings.filterwarnings("ignore")
E = 30e9; NU = 0.3; G = E / (2 * (1 + NU)); a = 6.0; t = 0.20; q = 10e3
D = E * t**3 / (12 * (1 - NU**2))
ref = {"w_mm": 0.00406 * q * a**4 / D * 1e3, "M_kNm_m": 0.0479 * q * a**2 / 1e3}


def resolver(nodos, quads, check=True):
    usados = sorted({i for qd in quads for i in qd})
    ren = {old: k for k, old in enumerate(usados)}
    nodos = [nodos[i] for i in usados]; quads = [[ren[i] for i in qd] for qd in quads]
    m = FEModel3D(); m.add_material("C", E, G, NU, 2500)
    for i, (x, z) in enumerate(nodos):
        m.add_node(f"N{i}", x, 0, z)
    for k, qd in enumerate(quads):
        m.add_quad(f"Q{k}", *[f"N{i}" for i in qd], t, "C")
        m.add_quad_surface_pressure(f"Q{k}", q, "D")
    centro = None
    for i, (x, z) in enumerate(nodos):
        if min(x, z, a - x, a - z) < 1e-9:
            m.def_support(f"N{i}", True, True, True, False, False, False)
        if abs(x - 3) < 1e-9 and abs(z - 3) < 1e-9:
            centro = f"N{i}"
    m.add_load_combo("C1", {"D": 1.0})
    t0 = time.perf_counter(); m.analyze_linear(check_statics=False, check_stability=check); dt = time.perf_counter() - t0
    w = abs(m.nodes[centro].DY["C1"]) * 1e3
    # momento en el centro: media de |Mx| y |My| locales extrapolados al nodo central
    Ms = []
    for k, qd in enumerate(quads):
        if centro in [f"N{i}" for i in qd]:
            el = m.quads[f"Q{k}"]
            pos = [f"N{i}" for i in qd].index(centro)
            xi, eta = [(-1, -1), (1, -1), (1, 1), (-1, 1)][pos]
            M = np.ravel(el.moment(xi, eta, True, "C1"))
            # invariante: media de momentos principales (Mx+My)/2 no depende de los ejes locales
            Ms.append((M[0] + M[1]) / 2)
    return {"w_centro_mm": w, "err_w_%": 100 * (w - ref["w_mm"]) / ref["w_mm"], "Mmedio_centro_kNm_m": abs(np.mean(Ms)) / 1e3,
            "err_M_%": 100 * (abs(np.mean(Ms)) / 1e3 - ref["M_kNm_m"]) / ref["M_kNm_m"], "nodos": len(nodos), "quads": len(quads), "t_s": round(dt, 2)}


res = {"referencia_Navier": ref}
mallas = json.load(open("py/mallas-placa.json"))
for k, v in mallas.items():
    res[k] = resolver(v["pts"], v["quads"])
    print(k, res[k], flush=True)
for hs in (0.5, 0.25):
    n = int(round(a / hs))
    nodos = [(i * hs, j * hs) for j in range(n + 1) for i in range(n + 1)]
    quads = [(j * (n + 1) + i, j * (n + 1) + i + 1, (j + 1) * (n + 1) + i + 1, (j + 1) * (n + 1) + i) for j in range(n) for i in range(n)]
    res[f"rejilla_h{hs}"] = resolver(nodos, quads)
    print(f"rejilla_h{hs}", res[f"rejilla_h{hs}"], flush=True)
    res[f"rejilla_h{hs} sin check_stability"] = resolver(nodos, quads, check=False)
    print(f"rejilla_h{hs} sin check", res[f"rejilla_h{hs} sin check_stability"], flush=True)
json.dump(res, open("py/salida-placa-mallas.json", "w"), indent=1, default=float)
