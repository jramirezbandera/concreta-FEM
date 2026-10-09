# Genera proyecto.json del residencial de la calle Mayor (encargo.md).
# Los parámetros marcados PENDIENTE dependen de las respuestas del ingeniero.
import json

# ---------------------------------------------------------------- parámetros
ESPESOR_LOSA = 0.25          # Respuesta 1: 25 cm (el cuadro está mal)
Q_VIVIENDA = 2.0             # Respuesta 3: 2 kN/m²
Q_BIBLIOTECA = 3.0           # Respuesta 4: 3,00 kN/m², sumada a la de vivienda, en Q
PSI_Q = None                 # Respuesta 3: todos los casos sin acción
HUECO = (24.6, 29.4, 15.4, 19.6)   # Respuesta 7: 4,80 según X y 4,20 según Y
ATADO_EN_HUECO = True        # Respuesta 8: se mantiene, sin brochales
VIENTO = 3.0                 # Respuesta 5: 3 kN/m por pilar de barlovento, de C a N7
GIRO_INICIAL_X = True        # Respuesta 6: ejes impares canto según X; pares girados 90 (también los cuadrados)

PLANTAS = ["N7", "N6", "N5", "N4", "N3", "N2", "N1"]
EJES_X = [6.0 * i for i in range(10)]           # ejes 1..10
LETRAS = "ABCDEFGH"
EJES_Y = [5.0 * j for j in range(8)]            # ejes A..H

modelo = {
    "plantas": (
        [{"id": "N7", "altura": None}]
        + [{"id": p, "altura": 3.0} for p in PLANTAS[1:]]
        + [{"id": "C", "nombre": "Cimentación", "tipo": "sotano", "altura": 1.5}]
    ),
    "materiales": [{"id": "HA-30", "tipo": "hormigon", "fck": 30}],
    "secciones": [
        {"id": "P30x50", "material": "HA-30", "forma": "rectangular", "b": 0.30, "h": 0.50},
        {"id": "P40x40", "material": "HA-30", "forma": "rectangular", "b": 0.40, "h": 0.40},
        {"id": "V30x60", "material": "HA-30", "forma": "rectangular", "b": 0.30, "h": 0.60},
        {"id": "V25x40", "material": "HA-30", "forma": "rectangular", "b": 0.25, "h": 0.40},
    ],
    "pilares": [],
    "vigas": [],
    "losas": [],
    "casos": [],
    "cargas": [],
}

# ---------------------------------------------------------------- pilares
for j, (letra, y) in enumerate(zip(LETRAS, EJES_Y)):
    rectangular = letra in "ACEG"
    for i, x in enumerate(EJES_X):
        p = {"id": f"{letra}{i + 1}", "x": x, "y": y, "desde": "C", "hasta": "N7"}
        if rectangular:
            p["seccion"] = "P30x50"
            canto_x = (i % 2 == 0) == GIRO_INICIAL_X
            p["giro"] = 0 if canto_x else 90
        else:
            p["seccion"] = "P40x40"
            p["giro"] = 0 if (i % 2 == 0) == GIRO_INICIAL_X else 90
        modelo["pilares"].append(p)

x0, x1 = EJES_X[0], EJES_X[-1]
y0, y1 = EJES_Y[0], EJES_Y[-1]
hx0, hx1, hy0, hy1 = HUECO

for planta in PLANTAS:
    # vigas de 30x60 por todos los ejes, de fachada a fachada
    for letra, y in zip(LETRAS, EJES_Y):
        modelo["vigas"].append({"id": f"V{letra}-{planta}", "planta": planta,
                                "puntos": [[x0, y], [x1, y]], "seccion": "V30x60"})
    for i, x in enumerate(EJES_X):
        modelo["vigas"].append({"id": f"V{i + 1}-{planta}", "planta": planta,
                                "puntos": [[x, y0], [x, y1]], "seccion": "V30x60"})
    # vigas de atado 25x40 en el centro de cada vano en X, de eje a eje en Y
    for i in range(9):
        xa = (EJES_X[i] + EJES_X[i + 1]) / 2
        for j in range(7):
            ya, yb = EJES_Y[j], EJES_Y[j + 1]
            en_hueco = hx0 < xa < hx1 and ya < hy1 and yb > hy0
            if en_hueco and not ATADO_EN_HUECO:
                continue
            modelo["vigas"].append({
                "id": f"VT{i + 1}{i + 2}-{LETRAS[j]}{LETRAS[j + 1]}-{planta}", "planta": planta,
                "puntos": [[xa, ya], [xa, yb]], "seccion": "V25x40"})
    # losa maciza
    modelo["losas"].append({
        "id": f"L-{planta}", "planta": planta,
        "contorno": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
        "huecos": [[[hx0, hy0], [hx1, hy0], [hx1, hy1], [hx0, hy1]]],
        "espesor": ESPESOR_LOSA, "material": "HA-30"})

# ---------------------------------------------------------------- casos
caso_q = {"id": "Q"}
if PSI_Q:
    caso_q["accion"] = {"tipo": "Q", "psi": PSI_Q}
modelo["casos"] = [{"id": "G", "pesoPropio": True}, caso_q, {"id": "Vx"}, {"id": "Vy"}]

# ---------------------------------------------------------------- cargas
for planta in PLANTAS:
    L = f"L-{planta}"
    modelo["cargas"].append({"tipo": "superficie", "id": f"SOL-{planta}", "caso": "G",
                             "planta": planta, "losa": L, "q": [0, 0, -2.0]})
    modelo["cargas"].append({"tipo": "lineal", "id": f"TAB-{planta}", "caso": "G", "planta": planta,
                             "puntos": [[1.5, 7.5], [22.5, 7.5], [22.5, 21.5]], "q": [0, 0, -7.0]})
    if Q_VIVIENDA is not None:
        modelo["cargas"].append({"tipo": "superficie", "id": f"SU-{planta}", "caso": "Q",
                                 "planta": planta, "losa": L, "q": [0, 0, -Q_VIVIENDA]})
    if Q_BIBLIOTECA is not None:
        modelo["cargas"].append({"tipo": "superficie", "id": f"BIB-{planta}", "caso": "Q",
                                 "planta": planta, "losa": L,
                                 "zona": [[6.8, 2.6], [17.2, 2.6], [17.2, 12.4], [6.8, 12.4]],
                                 "q": [0, 0, -Q_BIBLIOTECA]})

# viento: carga repartida en los pilares de la fachada de barlovento, en toda su altura
for p in modelo["pilares"]:
    if p["x"] == 0.0:
        modelo["cargas"].append({"tipo": "pilar", "id": f"VX-{p['id']}", "caso": "Vx",
                                 "pilar": p["id"], "ejes": "global", "q": [VIENTO, 0, 0]})
for p in modelo["pilares"]:
    if p["y"] == 0.0:
        modelo["cargas"].append({"tipo": "pilar", "id": f"VY-{p['id']}", "caso": "Vy",
                                 "pilar": p["id"], "ejes": "global", "q": [0, VIENTO, 0]})

proyecto = {
    "$schema": "D:/PROGRAMACION/Concreta FEM/src/agente/proyecto.schema.json",
    "esquema": "concreta-fem/proyecto@1",
    "nombre": "Residencial calle Mayor",
    "descripcion": "7 plantas de vivienda, 80 pilares, losa maciza con vigas. Modelo para predimensionar.",
    "modelo": modelo,
}
with open("proyecto.json", "w", encoding="utf-8", newline="") as f:
    json.dump(proyecto, f, ensure_ascii=False, indent=1)
print(len(modelo["pilares"]), "pilares,", len(modelo["vigas"]), "vigas,", len(modelo["cargas"]), "cargas")
