"""
Prueba en sombra de la vivienda (CY4, `docs/fem3d/hipotesis-cype.md`): extrae los datos del modelo
CYPECAD del usuario.

- Del listado (`Listados.pdf`, con `pdftotext -raw`): los arranques y los esfuerzos de los pilares
  por hipótesis (apartados 24 y 25) y los nudos de las losas (22 y 23).
- De las capturas de isovalores: el valor en cada nudo de losa, por el color, con la escala de su
  leyenda. Cada captura se calibra con la caja de su zona coloreada (las caras interiores de las
  vigas de borde). Las capturas son de una combinación (1,35·PP + 1,35·CM + 1,5·Qa o PP + CM),
  así que sirven para comparar; las envolventes del listado llevan sismo sin ductilidad.

Los datos de CYPE son del cliente y no entran en el repositorio: se leen de
`ejemplos/Proyectos/pruebas/prueba vivienda/` y se escriben en `validacion/sombra/vivienda/.datos/`
(las dos carpetas, en .gitignore).

  .venv/Scripts/python.exe validacion/sombra/vivienda/extraer.py
"""
import json, os, re, subprocess, sys
import numpy as np
from PIL import Image

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")
CYPE = os.path.join(RAIZ, "ejemplos", "Proyectos", "pruebas", "prueba vivienda")
DATOS = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".datos")

# Capturas: fichero, extremos de la leyenda (leídos de su barra), campo y combinación, planta y caja
# de la zona coloreada (px) con la región que es: las caras interiores de las vigas de borde.
CAJA = {"Planta 1": (-8.65, 4.12, 0.15, 15.52), "Cubierta": (4.41, 14.11, 5.94, 15.52)}
CAPTURAS = [
    ("momento en x cubierta 1", -110.04, 37.4, "mx", "ELU", "Planta 1", (485, 1014, 229, 861)),
    ("momento en y cubierta 1", -102.3, 44.99, "my", "ELU", "Planta 1", (564, 1115, 232, 891)),
    ("momento en xy cubierta 1", -31.27, 29.15, "mxy", "ELU", "Planta 1", (566, 1117, 234, 892)),
    ("deformada cubierta 1", -3.53, 0.5, "uz", "PP+CM", "Planta 1", (563, 1091, 274, 905)),
    ("momento x en cubierta 2", -105.58, 41.8, "mx", "ELU", "Cubierta", (730, 1175, 235, 668)),
    ("momento en y cubierta 2", -110.0, 32.78, "my", "ELU", "Cubierta", (1124, 1543, 235, 644)),
    ("momento en xy cubierta 2", -37.32, 22.5, "mxy", "ELU", "Cubierta", (1130, 1549, 235, 643)),
    ("deformada cubierta 2", -3.01, 0.14, "uz", "PP+CM", "Cubierta", (738, 1183, 238, 671)),
]

NUM = r"(-?\d+\.\d+)"
HIP = r"(Peso propio|Cargas muertas|Sobrecarga de uso|Viento [+-][XY] exc\.[+-]|Sismo [XY] Modo \d)"


def texto_listado():
    t = subprocess.run(["pdftotext", "-raw", os.path.join(CYPE, "Listados.pdf"), "-"], capture_output=True).stdout
    return t.decode("latin1").replace("\r", "").split("\n")


def seccion(raw, ini, fin):
    i = [k for k, l in enumerate(raw) if l.startswith(ini)][-1]
    j = next(k for k in range(i + 1, len(raw)) if raw[k].startswith(fin))
    return raw[i:j]


def arranques(raw):
    out, cur = {}, None
    for l in seccion(raw, "25. ARRANQUES", "26. DESPLAZAMIENTOS"):
        m = re.match(r"^(P\d+) (.*)$", l)
        if m and re.match("^" + HIP, m.group(2)):
            cur, l = m.group(1), m.group(2)
        m = re.match("^" + HIP + (" " + NUM) * 6 + "$", l)
        if m and cur:
            out.setdefault(cur, {})[m.group(1)] = [float(x) for x in m.groups()[1:]]
    return out


def pilares(raw):
    out, cur, tramo = {}, None, None
    for l in seccion(raw, "24. ESFUERZOS DE PILARES", "25. ARRANQUES"):
        m = re.match(r"^(P\d+) (Planta 1|Cubierta) 30x30 (\d+\.\d+)/(\d+\.\d+) (.*)$", l)
        if m:
            cur, tramo, l = m.group(1), m.group(2), m.group(5)
            out.setdefault(cur, {})[tramo] = {"z": [float(m.group(3)), float(m.group(4))]}
        m2 = re.match(r"^(Planta 1|Cubierta) 30x30 (\d+\.\d+)/(\d+\.\d+) (.*)$", l)
        if m2 and cur:
            tramo, l = m2.group(1), m2.group(4)
            out[cur][tramo] = {"z": [float(m2.group(2)), float(m2.group(3))]}
        m = re.match("^" + HIP + (" " + NUM) * 12 + "$", l)
        if m and cur:
            v = [float(x) for x in m.groups()[1:]]
            out[cur][tramo][m.group(1)] = {"base": v[:6], "cabeza": v[6:]}
    return out


def nudos(lineas, n):
    out, planta, k = [], None, 0
    num = re.compile(r"^-?\d+\.\d+$")
    cab = re.compile(r"^(-?\d+\.\d+) (-?\d+\.\d+) Máx\.$")
    while k < len(lineas):
        l = lineas[k].strip()
        if l in ("Planta 1", "Cubierta"):
            planta = l
        m = cab.match(l)
        if m:
            x, y, vals = float(m.group(1)), float(m.group(2)), []
            k += 1
            while len(vals) < n and k < len(lineas):
                t = lineas[k].strip()
                if num.match(t):
                    vals.append(float(t))
                elif cab.match(t):
                    break
                k += 1
            if len(vals) == n:
                out.append({"planta": planta, "x": x, "y": y, "v": vals})
            continue
        k += 1
    return out


def leer_captura(fichero, vmin, vmax, caja_px, caja_m, puntos):
    im = np.asarray(Image.open(os.path.join(CYPE, fichero + ".png")).convert("RGB")).astype(float)
    H, W, _ = im.shape
    sat = im.max(axis=2) - im.min(axis=2)
    # Barra de la leyenda: la fila con más píxeles saturados en el 15 % de abajo
    fila = int(H * 0.85) + int(np.argmax((sat[int(H * 0.85):] > 80).sum(axis=1)))
    xs = np.where(sat[fila] > 80)[0]
    xa, xb = xs[0], xs[-1]
    tabla_v, tabla_c = [], []
    for x in range(xa, xb + 1):
        col = im[fila - 12: fila + 14, x]
        ok = (col.max(axis=1) - col.min(axis=1) > 80) & (col.min(axis=1) < 200)
        if ok.any():
            c, n = np.unique(col[ok], axis=0, return_counts=True)
            tabla_v.append(vmin + (x - xa) / (xb - xa) * (vmax - vmin))
            tabla_c.append(c[np.argmax(n)])
    tabla_v, tabla_c = np.array(tabla_v), np.array(tabla_c)
    (px0, px1, py0, py1), (x0, x1, y0, y1) = caja_px, caja_m
    sx, sy = (px1 - px0) / (x1 - x0), (py1 - py0) / (y1 - y0)
    out = []
    for (x, y) in puntos:
        X, Y = round(px0 + (x - x0) * sx), round(py1 - (y - y0) * sy)
        p = im[Y - 3: Y + 4, X - 3: X + 4].reshape(-1, 3)
        p = p[(p.max(axis=1) - p.min(axis=1) > 80) & (p.max(axis=1) > 120)]
        vs = []
        for c in p:
            d = ((tabla_c - c) ** 2).sum(axis=1)
            k = int(np.argmin(d))
            if d[k] < 600:
                vs.append(tabla_v[k])
        out.append(float(np.median(vs)) if vs else None)
    return out


def main():
    if not os.path.isdir(CYPE):
        print(f"Sin los datos de CYPE ({CYPE}): no hay nada que extraer.")
        sys.exit(0)
    os.makedirs(DATOS, exist_ok=True)
    raw = texto_listado()
    desp = nudos(seccion(raw, "22. DESPLAZAMIENTOS EN NUDOS", "23. ESFUERZOS EN NUDOS"), 9)
    esf = nudos(seccion(raw, "23. ESFUERZOS EN NUDOS", "24. ESFUERZOS DE PILARES"), 15)
    assert [(a["x"], a["y"]) for a in desp] == [(b["x"], b["y"]) for b in esf]
    capturas = {}
    for fichero, vmin, vmax, campo, comb, planta, caja in CAPTURAS:
        pts = [(n["x"], n["y"]) for n in esf if n["planta"] == planta]
        capturas[f"{campo}|{planta}"] = {"comb": comb, "valores": leer_captura(fichero, vmin, vmax, caja, CAJA[planta], pts)}
        print(f"{fichero}: {sum(v is not None for v in capturas[f'{campo}|{planta}']['valores'])} de {len(pts)} nudos")
    datos = {"arranques": arranques(raw), "pilares": pilares(raw), "desplazamientos": desp, "esfuerzos": esf, "capturas": capturas}
    json.dump(datos, open(os.path.join(DATOS, "cype.json"), "w"))
    print(f"{len(datos['arranques'])} pilares con arranques, {len(esf)} nudos de losa; escrito .datos/cype.json")


if __name__ == "__main__":
    main()
