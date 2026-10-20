"""
Prueba en sombra, modelos mínimos: lee el listado de CYPE del modelo A («EJEMPLO 6X6.pdf», en
`ejemplos/`) y escribe `.datos/cype-a.json` con, por nudo de la losa, el desplazamiento (uz en mm y
giros en rad·1000; las combinaciones de desplazamientos son el peso propio solo) y los esfuerzos del
peso propio (Qx, Qy, Mx, My, Mxy por metro). El listado da la envolvente de las combinaciones de
E.L.U. de hormigón, que con sólo peso propio son 0,80·PP y 1,35·PP, así que PP = (máx + mín) / 2,15,
sin depender del orden de las columnas. Se comprueba que cada terna cumple |máx − mín| = dif y que
máx/mín es 0,8/1,35 o al revés.

  .venv/Scripts/python.exe validacion/sombra/minimo/leer_listado.py
"""
import json, os, re, subprocess, sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.join(AQUI, "..", "..", "..")
PDF = os.path.join(RAIZ, "ejemplos", "EJEMPLO 6X6.pdf")
texto = subprocess.run(["pdftotext", "-raw", PDF, "-"], capture_output=True).stdout.decode("latin1").replace("\r\n", "\n")
i_des = texto.index("3. DESPLAZAMIENTOS EN NUDOS DE LOSAS Y RETICULARES\n")
i_esf = texto.index("4. ESFUERZOS EN NUDOS DE LOSAS Y RETICULARES\n")
NUM = r"-?\d+\.\d+"
nodo = re.compile(rf"^\s*({NUM}) ({NUM}) Máx\.\s*$", re.M)


def bloques(s, n):
    """Para cada «x y Máx.», los n números que siguen (saltando «Mín.», «Dif.» y cabeceras)."""
    out = []
    ms = list(nodo.finditer(s))
    for k, m in enumerate(ms):
        fin = ms[k + 1].start() if k + 1 < len(ms) else len(s)
        nums = [float(t) for t in re.findall(rf"(?<![\w.]){NUM}(?![\w.])", s[m.end():fin])]
        out.append((float(m.group(1)), float(m.group(2)), nums[:n]))
    return out


des = bloques(texto[i_des:i_esf], 9)
esf = bloques(texto[i_esf:], 15)
nudos = {}
for x, y, v in des:
    nudos[(x, y)] = {"x": x, "y": y, "uz": v[0], "gx": v[3], "gy": v[6]}
malos = 0
CAMPOS = ["qx", "qy", "mx", "my", "mxy"]
for x, y, v in esf:
    n = nudos.setdefault((x, y), {"x": x, "y": y})
    for k, campo in enumerate(CAMPOS):
        mx_, mn_, dif = v[3 * k:3 * k + 3]
        pp = (mx_ + mn_) / 2.15
        ok = abs(abs(mx_ - mn_) - dif) <= 2e-4 + 1e-3 * abs(dif) and (abs(pp) < 1e-3 or abs(abs(mx_ - mn_) - 0.55 * abs(pp)) <= 2e-3 + 2e-3 * abs(pp))
        if not ok:
            malos += 1
            pp = None
        n[campo] = pp
lista = sorted(nudos.values(), key=lambda n: (n["x"], n["y"]))
os.makedirs(os.path.join(AQUI, ".datos"), exist_ok=True)
json.dump({"nudos": lista}, open(os.path.join(AQUI, ".datos", "cype-a.json"), "w"), indent=0)
print(f"{len(des)} nudos con desplazamientos, {len(esf)} con esfuerzos, {malos} ternas que no cuadran")
