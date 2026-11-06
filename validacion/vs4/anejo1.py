# -*- coding: utf-8 -*-
"""
El Anejo 1 de la NCSE-02 como oráculo de la tabla de peligrosidad (VS-l, docs/fem3d/viento-sismo.md).

Lee el texto de la edición del Ministerio de Fomento (el PDF no se versiona) y escribe la lista de
municipios con su ab y su K, en el orden del texto:

    src/normas/__fixtures__/ncse02-anejo1.json   [{ comunidad, provincia, municipio, ab, K }]
    validacion/vs4/out_anejo1.txt                los recuentos por provincia y lo que se ha corregido

Uso (desde la raíz del repositorio):

    python3 validacion/vs4/anejo1.py "<ruta>/NCSE02 bonita.pdf"

El texto sale de `pdftotext -layout -enc UTF-8` (xpdf; en Git Bash, /mingw64/bin/pdftotext). Con un
fichero .txt en lugar del PDF, se lee ese texto.

Cómo está el anejo en el texto. Cada página va en dos columnas, bajo la cabecera
«Municipio ab /g K   Municipio ab /g K». En cada columna, los valores («0,14 (1,0)») **no** van en la
línea de su municipio: van seguidos desde arriba, y los nombres de comunidad (en mayúsculas) y
«Provincia de X» ocupan una línea de la columna de nombres sin tener valor. Así que el valor k-ésimo de
la columna es el del k-ésimo municipio de esa columna. Se exige que en cada columna de cada página haya
tantos valores como municipios; si no, el script falla y dice dónde.

Un nombre partido en dos líneas lleva la segunda sangrada. Lo que el texto trae roto (un trozo de
nombre en otra línea) se corrige con la tabla ARREGLOS, a la vista y con su motivo.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

RAIZ = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SALIDA = os.path.join(RAIZ, "src", "normas", "__fixtures__", "ncse02-anejo1.json")
INFORME = os.path.join(RAIZ, "validacion", "vs4", "out_anejo1.txt")

VALOR = re.compile(r"(\d,\d\d) \((\d,\d)\)")
CABECERA = re.compile(r"Municipio\s+ab /g K\s+Municipio\s+ab /g K")

# Lo que el texto del PDF trae roto. (línea tal cual, sin espacios a los lados) → la línea corregida
# (o None para quitarla) y el motivo. Cada arreglo tiene que aplicarse exactamente una vez.
ARREGLOS = [
    (
        "Abaltzisketa  Sebastián  0,04 (1,0)  Lasarte Oria             0,04 (1,0)",
        "Abaltzisketa             0,04 (1,0)  Lasarte Oria             0,04 (1,0)",
        "«Sebastián» es la segunda línea de «Donosita San Sebastián» (26 líneas más abajo), que el texto deja aquí",
    ),
    (
        "Donosita San             0,04 (1,0)  Zestoa                   0,04 (1,0)",
        "Donosita San Sebastián   0,04 (1,0)  Zestoa                   0,04 (1,0)",
        "con su segunda línea («Donosita» es errata de la edición: Donostia)",
    ),
]


def texto_del_pdf(ruta):
    """El texto del PDF con pdftotext -layout, y la versión del programa."""
    exe = shutil.which("pdftotext")
    if exe is None:
        for c in (r"C:\Program Files\Git\mingw64\bin\pdftotext.exe", "/mingw64/bin/pdftotext"):
            if os.path.exists(c):
                exe = c
                break
    if exe is None:
        sys.exit("No se encuentra pdftotext (xpdf): en Git Bash está en /mingw64/bin/pdftotext.")
    v = subprocess.run([exe, "-v"], capture_output=True)
    version = ((v.stdout + v.stderr).decode("utf-8", "replace").strip().splitlines() or ["pdftotext"])[0].strip()
    r = subprocess.run([exe, "-layout", "-enc", "UTF-8", ruta, "-"], capture_output=True, check=True)
    return r.stdout.decode("utf-8"), version


def fichas(linea):
    """Los trozos de una línea con su columna: ("valor", col, (ab, K)) y ("nombre", col, texto)."""
    out = []
    resto = []
    ultimo = 0
    for m in VALOR.finditer(linea):
        resto.append((ultimo, linea[ultimo:m.start()]))
        out.append(("valor", m.start(), (m.group(1), m.group(2))))
        ultimo = m.end()
    resto.append((ultimo, linea[ultimo:]))
    for base, trozo in resto:
        for m in re.finditer(r"\S+(?: \S+)*", trozo):
            out.append(("nombre", base + m.start(), m.group(0)))
    out.sort(key=lambda f: f[1])
    return out


def es_mayusculas(s):
    letras = [c for c in s if c.isalpha()]
    return len(letras) >= 3 and all(c == c.upper() for c in letras)


def leer(texto):
    lineas = texto.replace("\f", "\n").split("\n")
    ini = next(i for i, l in enumerate(lineas) if l.strip() == "ANEJO 1")
    fin = next(i for i in range(ini, len(lineas)) if lineas[i].strip() == "Índice")
    lineas = lineas[ini:fin]
    # Los arreglos, a la vista
    usados = [0] * len(ARREGLOS)
    for i, l in enumerate(lineas):
        for k, (antes, despues, _motivo) in enumerate(ARREGLOS):
            if l.strip() == antes.strip():
                lineas[i] = l[:len(l) - len(l.lstrip())] + despues.strip() if despues is not None else ""
                usados[k] += 1
    for k, n in enumerate(usados):
        if n != 1:
            sys.exit(f"El arreglo {k} («{ARREGLOS[k][0].strip()}») se aplica {n} veces, no una: el texto ha cambiado.")
    # Páginas: de cabecera a cabecera
    cabeceras = [i for i, l in enumerate(lineas) if CABECERA.search(l)]
    if not cabeceras:
        sys.exit("No se encuentra la cabecera «Municipio ab /g K» del anejo 1.")
    filas = []
    comunidad = provincia = None
    informe_columnas = []
    continuaciones = []
    for p, c in enumerate(cabeceras):
        cab = lineas[c]
        a1 = cab.index("ab /g K")
        a2 = cab.index("ab /g K", a1 + 1)
        cuerpo = lineas[c + 1:(cabeceras[p + 1] if p + 1 < len(cabeceras) else len(lineas))]
        # Por columna: los nombres (con su sangría) y los valores, en su orden
        nombres = ([], [])
        valores = ([], [])
        for l in cuerpo:
            for tipo, col, dato in fichas(l):
                if tipo == "valor":
                    valores[0 if col < (a1 + a2) / 2 else 1].append(dato)
                elif re.fullmatch(r"\d+", dato):
                    continue  # el número de la página
                else:
                    nombres[0 if col < a1 else 1].append((col, dato))
        for lado in (0, 1):
            if not nombres[lado]:
                if valores[lado]:
                    sys.exit(f"Página {p + 1} del anejo, columna {lado + 1}: {len(valores[lado])} valores y ningún nombre.")
                continue
            base = min(col for col, _ in nombres[lado])
            municipios = []
            for col, nombre in nombres[lado]:
                if col >= base + 2:
                    # Segunda línea de un nombre partido
                    if municipios:
                        municipios[-1][2] = municipios[-1][2] + " " + nombre
                        continuaciones.append(municipios[-1][2])
                    elif filas:
                        filas[-1]["municipio"] += " " + nombre
                        continuaciones.append(filas[-1]["municipio"])
                    else:
                        sys.exit(f"Página {p + 1}: «{nombre}» va sangrado y no hay nombre antes.")
                elif es_mayusculas(nombre):
                    comunidad, provincia = nombre, None
                elif nombre.startswith("Provincia de "):
                    provincia = nombre[len("Provincia de "):]
                elif nombre.startswith("Ciudad de "):
                    # Ceuta y Melilla, al final del anejo: ni comunidad ni provincia
                    comunidad = provincia = nombre
                    municipios.append([comunidad, provincia, nombre[len("Ciudad de "):]])
                else:
                    if comunidad is None or provincia is None:
                        sys.exit(f"Página {p + 1}, columna {lado + 1}: «{nombre}» sin comunidad o sin provincia antes.")
                    municipios.append([comunidad, provincia, nombre])
            informe_columnas.append((p + 1, lado + 1, len(municipios), len(valores[lado])))
            if len(municipios) != len(valores[lado]):
                sys.stderr.write(f"Página {p + 1} del anejo, columna {lado + 1}: {len(municipios)} municipios y {len(valores[lado])} valores.\n")
                sys.stderr.write("  municipios: " + "; ".join(m[2] for m in municipios) + "\n")
                sys.exit(1)
            for (com, prov, nombre), (ab, k) in zip(municipios, valores[lado]):
                filas.append({"comunidad": com, "provincia": prov, "municipio": nombre, "ab": float(ab.replace(",", ".")), "K": float(k.replace(",", "."))})
    return filas, informe_columnas, continuaciones


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    ruta = sys.argv[1]
    if ruta.lower().endswith(".txt"):
        with open(ruta, encoding="utf-8") as f:
            texto = f.read()
        origen = f"texto {os.path.basename(ruta)}"
    else:
        texto, version = texto_del_pdf(ruta)
        with open(ruta, "rb") as f:
            sha = hashlib.sha256(f.read()).hexdigest()
        origen = f"{os.path.basename(ruta)} (sha256 {sha}), con {version} -layout -enc UTF-8"
    filas, columnas, continuaciones = leer(texto)
    os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
    with open(SALIDA, "w", encoding="utf-8", newline="") as f:
        f.write("[\n" + ",\n".join(json.dumps(x, ensure_ascii=False) for x in filas) + "\n]\n")
    # El informe
    out = []
    out.append("Anejo 1 de la NCSE-02: municipios con su ab y su K, leídos del texto")
    out.append(f"Origen: {origen}")
    out.append("")
    out.append(f"Municipios: {len(filas)}")
    out.append("")
    out.append("Por provincia (en el orden del texto):")
    orden = []
    cuenta = {}
    for x in filas:
        k = (x["comunidad"], x["provincia"])
        if k not in cuenta:
            orden.append(k)
            cuenta[k] = 0
        cuenta[k] += 1
    for com, prov in orden:
        out.append(f"  {cuenta[(com, prov)]:5d}  {prov}  ({com})")
    out.append("")
    out.append("Por valor de ab:")
    por_ab = {}
    for x in filas:
        por_ab[x["ab"]] = por_ab.get(x["ab"], 0) + 1
    for ab in sorted(por_ab):
        out.append(f"  {ab:.2f}  {por_ab[ab]:5d}")
    out.append("")
    out.append("Por valor de K:")
    por_k = {}
    for x in filas:
        por_k[x["K"]] = por_k.get(x["K"], 0) + 1
    for k in sorted(por_k):
        out.append(f"  {k:.1f}  {por_k[k]:5d}")
    out.append("")
    out.append("Columnas (página del anejo, columna, municipios = valores):")
    for p, lado, n, v in columnas:
        out.append(f"  {p:3d} {lado}  {n:3d} = {v:3d}")
    out.append("")
    out.append("Nombres partidos en dos líneas, unidos:")
    for c in continuaciones:
        out.append(f"  {c}")
    out.append("")
    out.append("Arreglos del texto del PDF:")
    for antes, despues, motivo in ARREGLOS:
        out.append(f"  «{antes.strip()}» → {'(quitada)' if despues is None else '«' + despues.strip() + '»'}: {motivo}")
    with open(INFORME, "w", encoding="utf-8", newline="") as f:
        f.write("\n".join(out) + "\n")
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"{len(filas)} municipios en {os.path.relpath(SALIDA, RAIZ)}; informe en {os.path.relpath(INFORME, RAIZ)}")


if __name__ == "__main__":
    main()
