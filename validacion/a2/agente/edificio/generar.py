import json

XS = [6 * i for i in range(10)]   # 0..54
YS = [5 * j for j in range(8)]    # 0..35
PLANTAS = [f"N{k}" for k in range(1, 8)]  # N1..N7

plantas = [{"id": "N7", "altura": None}]
for k in range(6, 0, -1):
    plantas.append({"id": f"N{k}", "altura": 3})
plantas.append({"id": "C", "tipo": "sotano", "altura": 1.5})

materiales = [{"id": "HA-30", "tipo": "hormigon", "fck": 30}]
secciones = [
    {"id": "P30x50", "material": "HA-30", "forma": "rectangular", "b": 0.30, "h": 0.50},
    {"id": "P40x40", "material": "HA-30", "forma": "rectangular", "b": 0.40, "h": 0.40},
    {"id": "V30x60", "material": "HA-30", "forma": "rectangular", "b": 0.30, "h": 0.60},
    {"id": "V25x40", "material": "HA-30", "forma": "rectangular", "b": 0.25, "h": 0.40},
]


def pid(x, y):
    return f"P-x{x}-y{y}"


pilares = []
for y in YS:
    for x in XS:
        p = {
            "id": pid(x, y),
            "x": x,
            "y": y,
            "desde": "C",
            "hasta": "N7",
            "seccion": "P30x50" if y % 10 == 0 else "P40x40",
        }
        if x % 12 == 6:
            p["giro"] = 90
        pilares.append(p)

vigas = []
losas = []
cargas = []
HUECO = [[24.6, 15.4], [29.4, 15.4], [29.4, 19.6], [24.6, 19.6]]
for n in PLANTAS:
    for y in YS:
        vigas.append({"id": f"VX-y{y}-{n}", "planta": n, "puntos": [[0, y], [54, y]], "seccion": "V30x60"})
    for x in XS:
        vigas.append({"id": f"VY-x{x}-{n}", "planta": n, "puntos": [[x, 0], [x, 35]], "seccion": "V30x60"})
    for i in range(9):
        x = 3 + 6 * i
        for j in range(7):
            vigas.append({
                "id": f"VS-x{x}-y{5 * j}-{n}",
                "planta": n,
                "puntos": [[x, 5 * j], [x, 5 * (j + 1)]],
                "seccion": "V25x40",
            })
    losa = f"L-{n}"
    losas.append({
        "id": losa,
        "planta": n,
        "contorno": [[0, 0], [54, 0], [54, 35], [0, 35]],
        "huecos": [HUECO],
        "espesor": 0.25,
        "material": "HA-30",
    })
    cargas.append({"tipo": "superficie", "id": f"G-sup-{n}", "caso": "G", "planta": n, "losa": losa, "q": [0, 0, -2]})
    cargas.append({"tipo": "lineal", "id": f"G-tab-{n}", "caso": "G", "planta": n,
                   "puntos": [[1.5, 7.5], [22.5, 7.5], [22.5, 21.5]], "q": [0, 0, -7]})
    cargas.append({"tipo": "superficie", "id": f"Q-sup-{n}", "caso": "Q", "planta": n, "losa": losa, "q": [0, 0, -2]})
    cargas.append({"tipo": "superficie", "id": f"Q-zona-{n}", "caso": "Q", "planta": n, "losa": losa,
                   "zona": [[6.8, 2.6], [17.2, 2.6], [17.2, 12.4], [6.8, 12.4]], "q": [0, 0, -3]})

for y in YS:
    cargas.append({"tipo": "pilar", "id": f"Vx-{pid(0, y)}", "caso": "Vx", "pilar": pid(0, y),
                   "ejes": "global", "q": [3, 0, 0]})
for x in XS:
    cargas.append({"tipo": "pilar", "id": f"Vy-{pid(x, 0)}", "caso": "Vy", "pilar": pid(x, 0),
                   "ejes": "global", "q": [0, 3, 0]})

casos = [
    {"id": "G", "nombre": "Permanentes", "pesoPropio": True},
    {"id": "Q", "nombre": "Sobrecarga de uso"},
    {"id": "Vx", "nombre": "Viento en X"},
    {"id": "Vy", "nombre": "Viento en Y"},
]

proyecto = {
    "esquema": "concreta-fem/proyecto@1",
    "nombre": "Edificio objetivo: siete plantas con losa maciza y vigas",
    "modelo": {
        "plantas": plantas,
        "materiales": materiales,
        "secciones": secciones,
        "pilares": pilares,
        "vigas": vigas,
        "losas": losas,
        "casos": casos,
        "cargas": cargas,
    },
}

with open("proyecto.json", "w", encoding="utf-8", newline="") as f:
    json.dump(proyecto, f, ensure_ascii=False, indent=1)

print(len(pilares), "pilares,", len(vigas), "vigas,", len(losas), "losas,", len(cargas), "cargas")
