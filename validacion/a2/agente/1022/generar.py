"""Genera proyecto.json para el pórtico SAP2000 1-022 (unidades kN y m)."""
import json

IN = 0.0254            # m
KIP = 4.4482216152605  # kN
KSI = KIP / IN**2      # kN/m²

E = 29500 * KSI
G = E / 2.6

perfiles = {  # A (in²), I (in⁴)
    "W14X176": (51.7, 2150),
    "W14X211": (62.1, 2670),
    "W14X246": (72.3, 3230),
    "W14X287": (84.4, 3910),
    "W24X110": (2.5, 3330),
    "W24X130": (38.3, 4020),
    "W24X160": (47.1, 5120),
}
J_IN4 = 10.0

secciones = []
for nombre, (A, I) in perfiles.items():
    secciones.append({
        "id": nombre,
        "material": "ACERO",
        "forma": "general",
        "A": A * IN**2,
        "Iy": I * IN**4,        # en el plano XZ (eje fuerte, canto según z local)
        "Iz": I / 3 * IN**4,    # fuera del plano
        "J": J_IN4 * IN**4,
    })

# Plantas de arriba abajo; altura = hasta la de encima.
plantas = [
    {"id": "N7", "altura": None},
    {"id": "N6", "altura": 156 * IN},
    {"id": "N5", "altura": 156 * IN},
    {"id": "N4", "altura": 156 * IN},
    {"id": "N3", "altura": 156 * IN},
    {"id": "N2", "altura": 156 * IN},
    {"id": "N1", "altura": 162 * IN},
    {"id": "B", "altura": 162 * IN},
]

def pilar(pid, x, s123, s45, s67):
    return {
        "id": pid, "x": x * IN, "y": 0.0, "desde": "B", "hasta": "N7",
        "seccion": s123,
        "tramos": [
            {"planta": "N4", "seccion": s45},
            {"planta": "N5", "seccion": s45},
            {"planta": "N6", "seccion": s67},
            {"planta": "N7", "seccion": s67},
        ],
    }

pilares = [
    pilar("izquierda", 0, "W14X246", "W14X211", "W14X176"),
    pilar("centro", 360, "W14X287", "W14X246", "W14X211"),
    pilar("derecha", 720, "W14X246", "W14X211", "W14X176"),
]

secc_viga = {"N1": "W24X160", "N2": "W24X160", "N3": "W24X130", "N4": "W24X130",
             "N5": "W24X110", "N6": "W24X110", "N7": "W24X110"}
vigas = [{"id": f"V-{p}", "planta": p, "puntos": [[0.0, 0.0], [720 * IN, 0.0]],
          "seccion": s} for p, s in secc_viga.items()]

fuerzas = {"N1": 2.5, "N2": 5, "N3": 7.5, "N4": 10, "N5": 12.5, "N6": 15, "N7": 20}
cargas = [{"tipo": "puntual", "id": f"LAT-{p}", "caso": "LAT", "planta": p,
           "x": 0.0, "y": 0.0, "F": [f * KIP, 0.0, 0.0]} for p, f in fuerzas.items()]

proyecto = {
    "esquema": "concreta-fem/proyecto@1",
    "nombre": "Pórtico de acero de siete plantas (SAP2000 1-022)",
    "modelo": {
        "plantas": plantas,
        "materiales": [{"id": "ACERO", "tipo": "general", "E": E, "G": G, "peso": 0.0}],
        "secciones": secciones,
        "pilares": pilares,
        "vigas": vigas,
        "casos": [{"id": "LAT", "nombre": "Fuerzas laterales"}],
        "cargas": cargas,
    },
    "opciones": {"modificadores": {}},
}

with open("proyecto.json", "w", encoding="utf-8", newline="") as f:
    json.dump(proyecto, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("E =", E, "kN/m2; G =", G)
