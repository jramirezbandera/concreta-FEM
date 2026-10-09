# Genera proyecto.json del pórtico de acero de 7 plantas (encargo de Luis).
# Conversión de unidades americanas a kN y m (factores exactos por definición).
import json

IN = 0.0254              # m
FT = 0.3048              # m
KIP = 4.4482216152605    # kN
KSI_MPA = 6.894757293168361  # MPa

# --- Datos pendientes de confirmar por el ingeniero (ver PREGUNTAS) ---
E_KSI = 29500.0          # Luis: 29 500 ksi, el del ejemplo de verificación
A_W24X110 = 2.5          # Luis: 2,5 in² tal cual, como el ejemplo publicado de SAP
IZ_FACTOR = None         # P3: propiedades fuera del plano (Iz, J)

perfiles = {  # A in², I in⁴ (flexión en el plano del pórtico)
    "W14X176": (51.7, 2150),
    "W14X211": (62.1, 2670),
    "W14X246": (72.3, 3230),
    "W14X287": (84.4, 3910),
    "W24X110": (A_W24X110, 3330),
    "W24X130": (38.3, 4020),
    "W24X160": (47.1, 5120),
}
# Fuera del plano (provisional): Iz y J
fuera = {k: (v[1] / 3.0, 10.0) for k, v in perfiles.items()}  # Luis: Iz = I/3, J = 10 in⁴

def sec(nombre):
    A, I = perfiles[nombre]
    Iz, J = fuera[nombre]
    return {
        "id": nombre, "material": "ACERO", "forma": "general",
        "A": A * IN**2, "Iy": I * IN**4, "Iz": Iz * IN**4, "J": J * IN**4,
    }

plantas = [
    {"id": "N7", "altura": None},
    {"id": "N6", "altura": 13 * FT},
    {"id": "N5", "altura": 13 * FT},
    {"id": "N4", "altura": 13 * FT},
    {"id": "N3", "altura": 13 * FT},
    {"id": "N2", "altura": 13 * FT},
    {"id": "N1", "altura": 13.5 * FT},
    {"id": "B", "altura": 13.5 * FT},
]

xs = {"izquierda": 0.0, "centro": 30 * FT, "derecha": 60 * FT}

def tramos(n13, n45, n67):
    t = []
    for n in ("N1", "N2", "N3"): t.append({"planta": n, "seccion": n13})
    for n in ("N4", "N5"): t.append({"planta": n, "seccion": n45})
    for n in ("N6", "N7"): t.append({"planta": n, "seccion": n67})
    return t

pilares = []
for nombre, x in xs.items():
    if nombre == "centro":
        tr = tramos("W14X287", "W14X246", "W14X211")
    else:
        tr = tramos("W14X246", "W14X211", "W14X176")
    pilares.append({
        "id": nombre, "x": x, "y": 0.0, "desde": "B", "hasta": "N7",
        "seccion": tr[0]["seccion"], "tramos": tr,
    })

vigas_sec = {"N1": "W24X160", "N2": "W24X160", "N3": "W24X130", "N4": "W24X130",
             "N5": "W24X110", "N6": "W24X110", "N7": "W24X110"}
vigas = [{"id": f"V-{n}", "planta": n, "puntos": [[0.0, 0.0], [60 * FT, 0.0]], "seccion": s}
         for n, s in vigas_sec.items()]

kips = {"N1": 2.5, "N2": 5, "N3": 7.5, "N4": 10, "N5": 12.5, "N6": 15, "N7": 20}
cargas = [{"tipo": "puntual", "id": f"LAT-{n}", "caso": "LAT", "planta": n,
           "x": 0.0, "y": 0.0, "F": [k * KIP, 0.0, 0.0]} for n, k in kips.items()]

proyecto = {
    "esquema": "concreta-fem/proyecto@1",
    "nombre": "Pórtico de acero de 7 plantas (verificación SAP2000)",
    "descripcion": "Encargo de Luis: pórtico plano de 3 pilares a 30 ft, base empotrada, "
                   "carga lateral LAT. Datos convertidos de unidades americanas a kN y m.",
    "modelo": {
        "plantas": plantas,
        "materiales": [{"id": "ACERO", "tipo": "acero", "E": E_KSI * KSI_MPA, "peso": 0}],
        "secciones": [sec(k) for k in perfiles],
        "pilares": pilares,
        "vigas": vigas,
        "casos": [{"id": "LAT", "nombre": "Cargas laterales"}],
        "cargas": cargas,
    },
    "opciones": {"modificadores": {}, "cortante": False, "factorZonaRigida": 0},
}

with open("proyecto.json", "w", encoding="utf-8", newline="") as f:
    json.dump(proyecto, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("escrito proyecto.json")
