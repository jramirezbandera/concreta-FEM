"""
Prueba en sombra de la vivienda (CY4, criterio 7 de `docs/fem3d/hipotesis-cype.md`): nuestros
resultados de la réplica frente a los de CYPECAD.

- Totales y axil de cada arranque por hipótesis (PP, CM, Q), y momentos y cortantes en la base.
  Signos: los de CYPE son esfuerzos en el arranque; (Qx, Qy) = −(Fx, Fy) de nuestra reacción,
  Mx = −My y My = +Mx.
- Losas, frente a las capturas (la misma combinación): momentos 1,35·PP + 1,35·CM + 1,5·Q y flecha
  PP + CM, en los nudos del listado a más de 0,5 m de la cara de un pilar (junto a ellos los dos
  dan picos que dependen de la malla). «Grandes» son los de más del 40 % del extremo de CYPE.

Criterio 7: momentos de vano grandes a ≥ 0,90 de CYPE (mediana), flechas grandes a ±10 % y
axiles a ±10 % salvo los pilares explicados.

  .venv/Scripts/python.exe validacion/sombra/vivienda/comparar.py [<carpeta de la variante>]
"""
import json, os, sys
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

AQUI = os.path.dirname(os.path.abspath(__file__))
dir_ = sys.argv[1] if len(sys.argv) > 1 else os.path.join(AQUI, ".datos", "defecto")
cy = json.load(open(os.path.join(AQUI, ".datos", "cype.json")))
us = json.load(open(os.path.join(dir_, "nuestro.json")))
proyecto = json.load(open(os.path.join(dir_, "proyecto.json"), encoding="utf-8"))
print(f"Prueba en sombra de la vivienda: {os.path.basename(dir_)}, opciones {json.dumps(proyecto.get('opciones', {}))}\n")

H = {"PP": "Peso propio", "CM": "Cargas muertas", "Q": "Sobrecarga de uso"}
IC = {"PP": 0, "CM": 1, "Q": 2}
pil = [f"P{i}" for i in range(1, 24)]

# 1. Totales y arranques
print("1. Arranques (kN, kN·m)")
print("   Totales: " + "; ".join(f"{h} CYPE {sum(cy['arranques'][p][H[h]][0] for p in pil):.1f}, nuestro {sum(us['reacciones'][p][IC[h]][2] for p in pil):.1f}" for h in H))
fuera = []
print(f"   {'':5}" + "".join(f"{h:>22}" for h in H) + f"{'|M| base PP: CYPE / nuestro':>32}")
for p in pil:
    fila = f"   {p:5}"
    for h in H:
        nc, nu = cy["arranques"][p][H[h]][0], us["reacciones"][p][IC[h]][2]
        d = nu / nc - 1 if abs(nc) > 5 else float("nan")
        if abs(nc) > 5 and abs(d) > 0.10: fuera.append((p, h, d))
        fila += f"{nc:8.1f} {nu:7.1f} {d * 100 if abs(nc) > 5 else float('nan'):5.0f}%"
    c = cy["arranques"][p]["Peso propio"]; r = us["reacciones"][p][0]
    fila += f"{max(abs(c[1]), abs(c[2])):16.1f} / {max(abs(r[3]), abs(r[4])):5.1f}"
    print(fila)
print(f"   Fuera de ±10 % (con N > 5 kN): {', '.join(f'{p} {h} {d * 100:+.0f} %' for p, h, d in fuera) or 'ninguno'}\n")

# 2. Losas frente a las capturas
print("2. Losas frente a las capturas (nudos a más de 0,5 m de la cara de un pilar)")
PL = {"Planta 1": "CUB", "Cubierta": "CUB-S"}
F = {"ELU": {"PP": 1.35, "CM": 1.35, "Q": 1.5}, "PP+CM": {"PP": 1, "CM": 1}}
Q = {"mx": "m11", "my": "m22", "mxy": "m12", "uz": "uz"}
pilares = proyecto["modelo"]["pilares"]
resumen = {}
for clave, cap in cy["capturas"].items():
    campo, planta = clave.split("|")
    ps = [p for p in pilares if PL[planta] == "CUB" or p["hasta"] == "CUB-S"]
    nod = [n for n in us["nudos"] if n["planta"] == planta]
    a, b = [], []
    for n, c in zip(nod, cap["valores"]):
        v = n["v"][Q[campo]]
        if c is None or any(v[k] is None for k in F[cap["comb"]]): continue
        if min(max(abs(n["x"] - p["x"]), abs(n["y"] - p["y"])) for p in ps) - 0.15 < 0.5: continue
        a.append(c); b.append(sum(f * v[k] for k, f in F[cap["comb"]].items()) * (-1 if campo == "mxy" else 1))
    a, b = np.array(a), np.array(b)
    pos, neg = a > 0.4 * a.max(), a < 0.4 * a.min()
    r = {"n": len(a), "corr": np.corrcoef(a, b)[0, 1], "pend": (a @ b) / (a @ a),
         "pos": np.median(b[pos] / a[pos]) if pos.sum() > 5 else float("nan"),
         "neg": np.median(b[neg] / a[neg]) if neg.sum() > 5 else float("nan")}
    resumen[(campo, planta)] = r
    print(f"   {planta:9}{campo:4}({cap['comb']:5}) n = {r['n']:4d}  correlación {r['corr']:.3f}  pendiente {r['pend']:.3f}  grandes positivos {r['pos']:.2f}  grandes negativos {r['neg']:.2f}")
print("   (mxy con el signo cambiado: el convenio de CYPE es el opuesto al de CSI)\n")

# 3. Criterio 7
vano = [resumen[(c, p)]["pos"] for c in ("mx", "my") for p in ("Planta 1", "Cubierta")]
flecha = [resumen[("uz", p)]["neg"] for p in ("Planta 1", "Cubierta")]
ok_vano = all(v >= 0.90 for v in vano)
ok_flecha = all(abs(f - 1) <= 0.10 for f in flecha)
print("3. Criterio 7")
print(f"   Momentos de vano (mediana nuestro/CYPE): {', '.join(f'{v:.2f}' for v in vano)} → {'pasa' if ok_vano else 'NO pasa'} (≥ 0,90)")
print(f"   Flechas (mediana nuestro/CYPE): {', '.join(f'{f:.2f}' for f in flecha)} → {'pasa' if ok_flecha else 'NO pasa'} (±10 %)")
print(f"   Axiles fuera de ±10 %: {len(fuera)} ({', '.join(sorted(set(p for p, _, _ in fuera))) or '—'}): a explicar uno a uno")
