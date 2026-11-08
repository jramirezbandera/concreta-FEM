"""
Prueba en sombra del ejemplo 11 (`modelo.ts`): lee un listado de CYPECAD 2027 de la carpeta
`ejemplos/ejemplo 1 6x6/ejemplo 11/` y escribe `.datos/<salida>.json`. El 1.pdf (999 páginas, el
modelo con los pilares centrados: `cype.json`) y el 2.pdf (72 páginas, con pilares de 40, 30 y 25 y
su punto fijo: `cype2.json`) no traen las mismas secciones; se lee lo que haya:

- `pilares`: los «esfuerzos pésimos» de las comprobaciones E.L.U. de cada pilar, por tramo y
  posición (Cabeza, Pie, Arranque y las intermedias), con la comprobación (Q o N,M), su combinación
  (la nota del pie de la tabla, como texto) y N, Mxx, Myy (kN·m) y Qx, Qy (kN). Las tablas se leen
  por la posición de cada palabra en la página (pymupdf), no del texto, que sale desordenado;
- `sismo`: periodos, coeficientes de participación y masa desplazada de cada modo, centro de masas
  por planta y cortante combinado y fuerza equivalente por planta;
- `viento`: la fuerza de cada planta;
- `nudos`: por planta y nudo de los reticulares, la envolvente de los desplazamientos (uz en mm y
  giros, máx. y mín.) y la de los esfuerzos mayorados (Qx, Qy en kN/m, Mx, My, Mxy en kN·m/m, máx. y
  mín.). Se comprueba que cada terna cumple máx − mín = dif. (Sólo el 1.pdf.)
- `hipotesis`: los esfuerzos de cada tramo de pilar por hipótesis, en su base y su cabeza (N, Mx, My,
  Qx, Qy, T en los ejes locales del pilar), también los de cada modo del sismo («Sismo X Modo 3»).
  (Sólo el 2.pdf.)
- `sumatorio`: la suma de los esfuerzos de los pilares de cada planta por hipótesis, referida al
  origen (N, Mx, My, Qx, Qy, T). (Sólo el 2.pdf.)
- `desplomes`: el desplome absoluto de cada planta con el sismo, en X y en Y (cm). (Sólo el 2.pdf.)

  .venv/Scripts/python.exe -I validacion/sombra/ejemplo11/leer_listado.py [1.pdf | 2.pdf] [salida]
"""
import json, os, re, sys
from collections import defaultdict

import pymupdf

sys.stdout.reconfigure(encoding="utf-8")
AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.join(AQUI, "..", "..", "..")
NOMBRE = sys.argv[1] if len(sys.argv) > 1 else "1.pdf"
SALIDA = sys.argv[2] if len(sys.argv) > 2 else ("cype" if NOMBRE == "1.pdf" else "cype" + NOMBRE.split(".")[0])
PDF = os.path.join(RAIZ, "ejemplos", "ejemplo 1 6x6", "ejemplo 11", NOMBRE)
doc = pymupdf.open(PDF)
paginas = [p.get_text("text", sort=True) for p in doc]
NUM = r"-?\d+(?:\.\d+)?"


def es_num(t):
    return re.fullmatch(NUM, t) is not None


# ─── Comprobaciones E.L.U. de los pilares: por la posición de las palabras ───────────────────────

def filas_de(pagina):
    """Las palabras de una página agrupadas por línea (y del centro, a 1,5 pt), de arriba abajo."""
    filas = defaultdict(list)
    for w in doc[pagina].get_text("words"):
        x0, y0, x1, y1, t = w[:5]
        filas[round((y0 + y1) / 2 / 1.5)].append((x0, t))
    return [(k * 1.5, sorted(v)) for k, v in sorted(filas.items())]


def pagina_de(patron, desde=2, obligatoria=True):
    """La primera página desde `desde` (sin el índice) cuyo texto casa con la expresión `patron`."""
    for i in range(desde, len(paginas)):
        if re.search(patron, paginas[i], re.M):
            return i
    if obligatoria:
        raise ValueError(patron)
    return None


# De «2.2.1. P1» (o «10.2.1. P1») a las vigas o al final
i_pil = pagina_de(r"^\s*\d+\.\d+\.1\.\s+P1\s*$", pagina_de(r"^\s*\d+\.\s+COMPROBACIONES E\.L\.U\.\s*$"))
i_vig = pagina_de(r"^\s*\d+\.\d+\.\s+Vigas\s*$", i_pil, False) or len(paginas) - 1
pilares = {}
pilar = None
for pg in range(i_pil, i_vig + 1):
    for y, ws in filas_de(pg):
        ts = [t for _, t in ws]
        if ts and re.match(r"\d+\.\d+\.\d+\.$", ts[0]) and len(ts) > 1 and re.fullmatch(r"P\d+", ts[1]):
            pilar = ts[1]
            pilares[pilar] = {"filas": [], "posiciones": [], "notas": {}, "tramos": []}
            continue
        if pilar is None:
            continue
        P = pilares[pilar]
        y = y + 10000 * pg  # las filas de un pilar pueden seguir en la página siguiente
        # Tramo: «Forjado 3 (6 - 9 m) 30x30» o «Cimentación 30x30 Arranque …»
        if ts and ts[0] == "Forjado" and len(ts) > 1:
            P["tramos"].append((y, "F" + ts[1]))
        if ts and ts[0].startswith("Cimentaci"):
            P["tramos"].append((y, "CIM"))
        # Posición
        for x, t in ws:
            if 140 <= x <= 175 and (t in ("Cabeza", "Pie", "Arranque") or (es_num(t) and any(u == "m" for _, u in ws))):
                P["posiciones"].append((y, t if not es_num(t) else f"{t} m"))
                break
        # Notas: «(3) PP+CM+…», en la misma línea o en la siguiente
        if ts and re.fullmatch(r"\(\d+\)", ts[0]) and ws[0][0] < 80:
            P["nota"] = ts[0].strip("()")
            ts, ws = ts[1:], ws[1:]
        if ts and ws[0][0] < 80 and "PP" in ts[0] and P.get("nota"):
            P["notas"][P.pop("nota")] = re.sub(r"[^0-9A-Za-z.+()\-]", "*", ts[0])
            continue
        # Fila de esfuerzos: los números a la derecha (x ≥ 405) y la comprobación
        nums = [(x, t) for x, t in ws if 405 <= x < 520 and es_num(t)]
        if len(nums) >= 2:
            # La comprobación («Q», «Q S.», «N,M», «N,M S.», «Q S.,N,M S.»), entre la naturaleza y N
            comp = " ".join(t for x, t in ws if 365 <= x < nums[0][0] and t in ("Q", "S.", "N,M", "S.,N,M"))
            P["filas"].append({"y": y, "nums": [float(t) for _, t in nums], "xs": [x for x, _ in nums], "comp": comp})
        # Referencia de la combinación «(n)» en la columna de la naturaleza (x 350–380)
        for x, t in ws:
            if 350 <= x <= 380 and re.fullmatch(r"\(\d+\)", t):
                P["filas"].append({"y": y, "ref": t.strip("()")})

salida_pilares = {}
for pid, P in pilares.items():
    # Une las filas partidas (dos líneas a < 2,5 pt con números) y asigna la referencia de encima
    datos = []
    ref = None
    filas = sorted(P["filas"], key=lambda f: f["y"])
    k = 0
    while k < len(filas):
        f = filas[k]
        if "ref" in f:
            ref = f["ref"]
            k += 1
            continue
        g = dict(f)
        if k + 1 < len(filas) and "nums" in filas[k + 1] and abs(filas[k + 1]["y"] - f["y"]) < 2.5 and len(f["nums"]) + len(filas[k + 1]["nums"]) == 5:
            h = filas[k + 1]
            pares = sorted(list(zip(f["xs"], f["nums"])) + list(zip(h["xs"], h["nums"])))
            g = {"y": f["y"], "nums": [n for _, n in pares], "comp": (f["comp"] + " " + h["comp"]).strip()}
            k += 1
        if len(g["nums"]) == 5:
            g["ref"] = ref
            datos.append(g)
        k += 1
    # Cada fila, a la posición más cercana; las posiciones van en grupos (Cabeza … Pie) y la cabecera
    # del tramo cae entre la primera y la última del grupo
    pos = P["posiciones"]
    tramos = sorted(P["tramos"])
    grupos = []
    for yp, pnom in pos:
        if pnom in ("Cabeza", "Arranque") or not grupos:
            grupos.append([])
        grupos[-1].append(yp)

    def tramo_de(yp):
        for gr in grupos:
            if gr[0] - 1 <= yp <= gr[-1] + 1:
                ys = [t for t in tramos if gr[0] - 30 <= t[0] <= gr[-1] + 30]
                return min(ys, key=lambda t: abs(t[0] - (gr[0] + gr[-1]) / 2))[1] if ys else None
        return None

    lista = []
    for g in datos:
        yp, pnom = min(pos, key=lambda q: abs(q[0] - g["y"]))
        N, Mxx, Myy, Qx, Qy = g["nums"]
        comb = P["notas"].get(g["ref"]) if g["ref"] else None
        lista.append({"tramo": tramo_de(yp), "posicion": pnom, "comprobacion": g["comp"], "combinacion": comb, "N": N, "Mxx": Mxx, "Myy": Myy, "Qx": Qx, "Qy": Qy})
    salida_pilares[pid] = lista

# ─── Sismo y viento ──────────────────────────────────────────────────────────────────────────────

# (sin el índice de las dos primeras páginas, que repite los títulos)
texto = "\n".join(paginas[2:])


def seccion(titulo, hasta):
    """El texto de la sección con ese título (tras su número) hasta la siguiente cuyo título empieza por `hasta`."""
    m = re.search(rf"^\s*[\d.]+\s+{titulo}", texto, re.M)
    if not m:
        return ""
    n = re.search(rf"^\s*[\d.]+\s+{hasta}", texto[m.end():], re.M)
    return texto[m.end():m.end() + n.start()] if n else texto[m.end():]


modos = []
for m in re.finditer(rf"Modo (\d)\s+({NUM})\s+({NUM})\s+({NUM})\s+({NUM})\s+({NUM})\s*%\s+({NUM})\s*%", seccion("Coeficientes de participación", "Centro de masas")):
    modos.append({"modo": int(m.group(1)), "T": float(m.group(2)), "Lx": float(m.group(3)), "Ly": float(m.group(4)), "Lgz": float(m.group(5)), "Mx": float(m.group(6)) / 100, "My": float(m.group(7)) / 100})
cdm = {}
for m in re.finditer(rf"Forjado (\d)\s+\(({NUM}), ({NUM})\)\s+\(({NUM}), ({NUM})\)", seccion("Centro de masas, centro de rigidez", "Cortante sísmico combinado")):
    cdm["F" + m.group(1)] = {"cm": [float(m.group(2)), float(m.group(3))], "cr": [float(m.group(4)), float(m.group(5))]}
cortantes = {}
s45 = seccion("Cortante sísmico combinado por planta", "CONSIDERACIÓN")
s45 = s45[:s45.index("Cortantes sísmicos máximos")] if "Cortantes sísmicos máximos" in s45 else s45
for nombre, bloque in re.findall(r"Hipótesis sísmica: (Sismo [XY]1)(.*?)(?=Hipótesis sísmica|\Z)", s45, re.S):
    cortantes[nombre] = {}
    for m in re.finditer(rf"Forjado (\d)\s+({NUM})\s+({NUM})\s+({NUM})\s+({NUM})", bloque):
        cortantes[nombre]["F" + m.group(1)] = {"Qx": float(m.group(2)), "Fx": float(m.group(3)), "Qy": float(m.group(4)), "Fy": float(m.group(5))}
viento = {}
for m in re.finditer(r"Viento a \d+\S* \(([+-][XY])\)(.*?)(?=Viento a|\Z)", seccion("Cargas de viento por planta", "JUSTIFICACIÓN DE LA ACCIÓN SÍSMICA"), re.S):
    viento[m.group(1)] = {("F" + q.group(1)): float(q.group(2)) for q in re.finditer(rf"Forjado (\d)\s+{NUM}\s+{NUM}\s+{NUM}\s+({NUM})", m.group(2))}

# ─── Esfuerzos de los pilares por hipótesis, sumatorio por planta y desplomes (2.pdf) ────────────

HIP = r"(Peso propio|Cargas muertas|Sobrecarga de uso|Viento [+-][XY] exc\.[+-]|Sismo [XY] Modo \d+)"
hipotesis = {}
actual = [None, None]
for linea in seccion("Esfuerzos de pilares, pantallas y muros por hipótesis", "Arranques de pilares").splitlines():
    m = re.match(rf"^\s*(P\d+)?\s*(?:Forjado (\d))?\s*(?:\d+x\d+)?\s*(?:{NUM}/{NUM})?\s*{HIP}((?:\s+{NUM}){{12}})\s*$", linea)
    if not m:
        continue
    if m.group(1):
        actual[0] = m.group(1)
    if m.group(2):
        actual[1] = "F" + m.group(2)
    v = [float(t) for t in m.group(4).split()]
    hipotesis.setdefault(actual[0], {}).setdefault(actual[1], {})[m.group(3)] = {"base": v[:6], "cabeza": v[6:]}
sumatorio = {}
planta = None
for linea in seccion("Sumatorio de esfuerzos de pilares", "DISTORSIONES").splitlines():
    m = re.match(rf"^\s*(?:(Forjado \d|Cimentaci\S*)\s+({NUM}))?\s*{HIP}((?:\s+{NUM}){{6}})\s*$", linea)
    if not m:
        continue
    if m.group(1):
        planta = "F" + m.group(1)[-1] if m.group(1).startswith("Forjado") else "CIM"
    sumatorio.setdefault(planta, {})[m.group(3)] = [float(t) for t in m.group(4).split()]
desplomes = {}
for nombre, bloque in re.findall(r"^\s*(Sismo [XY])\s*$(.*?)(?=^\s*Sismo [XY]\s*$|\Z)", seccion("Desplomes entre plantas", "CARGAS HORIZONTALES"), re.S | re.M):
    desplomes[nombre] = {"F" + q.group(1): [float(q.group(2)), float(q.group(3))] for q in re.finditer(rf"Forjado (\d)\s+{NUM}\s+{NUM}\s+({NUM})\s+\S+\s+\S+\s+({NUM})", bloque)}

# ─── Nudos de los reticulares (1.pdf) ────────────────────────────────────────────────────────────

# (las tildes de «Máx.» y «Mín.» salen mal de algunas páginas del PDF: su CMap está roto)
nodo = re.compile(rf"^[ \t]*({NUM})[ \t]+({NUM})[ \t]+M.x\.((?:[ \t]+{NUM})+)[ \t]*\n[ \t]*M.n\.((?:[ \t]+{NUM})+)[ \t]*\n[ \t]*Dif\.((?:[ \t]+{NUM})+)", re.M)


def nudos_de(s, campos):
    out = {}
    malos = 0
    partes = re.split(r"\n\s+Forjado (\d)\n", s)
    for k in range(1, len(partes), 2):
        f = "F" + partes[k]
        for m in nodo.finditer(partes[k + 1]):
            mx = [float(t) for t in m.group(3).split()]
            mn = [float(t) for t in m.group(4).split()]
            df = [float(t) for t in m.group(5).split()]
            if not (len(mx) == len(mn) == len(df) == len(campos)):
                malos += 1
                continue
            if any(abs((a - b) - c) > 2e-4 + 1e-6 * abs(c) for a, b, c in zip(mx, mn, df)):
                malos += 1
            n = {"x": float(m.group(1)), "y": float(m.group(2))}
            for c, a, b in zip(campos, mx, mn):
                n[c] = [b, a]
            out.setdefault(f, []).append(n)
    return out, malos


des, malos_d = nudos_de(seccion("DESPLAZAMIENTOS EN NUDOS DE LOSAS Y RETICULARES", "ESFUERZOS EN NUDOS"), ["uz", "gx", "gy"])
esf, malos_e = nudos_de(seccion("ESFUERZOS EN NUDOS DE LOSAS Y RETICULARES", "ARMADOS DE LOSAS"), ["qx", "qy", "mx", "my", "mxy"])
nudos = {}
for f in sorted(set(des) | set(esf)):
    por = {}
    for n in des.get(f, []):
        por[(n["x"], n["y"])] = dict(n)
    for n in esf.get(f, []):
        por.setdefault((n["x"], n["y"]), {"x": n["x"], "y": n["y"]}).update(n)
    nudos[f] = sorted(por.values(), key=lambda n: (n["x"], n["y"]))

os.makedirs(os.path.join(AQUI, ".datos"), exist_ok=True)
json.dump({"pilares": salida_pilares, "sismo": {"modos": modos, "plantas": cdm, "cortantes": cortantes}, "viento": viento, "nudos": nudos,
           "hipotesis": hipotesis, "sumatorio": sumatorio, "desplomes": desplomes},
          open(os.path.join(AQUI, ".datos", SALIDA + ".json"), "w", encoding="utf-8"), indent=0, ensure_ascii=False)
print(f"{NOMBRE} → .datos/{SALIDA}.json")
print(f"pilares: {', '.join(f'{p} ({len(v)} filas, {sum(1 for r in v if r['combinacion'] is None)} sin combinación, {sum(1 for r in v if r['tramo'] is None)} sin tramo)' for p, v in salida_pilares.items())}")
print(f"modos: {len(modos)}; plantas con c.d.m.: {len(cdm)}; cortantes: {json.dumps(cortantes)}")
print(f"viento: {json.dumps(viento)}")
print(f"nudos: {', '.join(f'{f} {len(v)}' for f, v in nudos.items()) or '—'}; ternas que no cuadran: {malos_d} (desplazamientos), {malos_e} (esfuerzos)")
print(f"hipótesis: {'; '.join(f'{p} ' + ' '.join(f'{t}:{len(h)}' for t, h in v.items()) for p, v in hipotesis.items()) or '—'}")
print(f"sumatorio: {', '.join(f'{p} {len(v)}' for p, v in sumatorio.items()) or '—'}; desplomes: {json.dumps(desplomes)}")
