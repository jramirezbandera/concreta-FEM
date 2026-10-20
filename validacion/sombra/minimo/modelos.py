"""
Prueba en sombra, modelos mínimos de CYPECAD del usuario (`docs/fem3d/fase-lv.md` §2.1): un recuadro
para separar la rigidez de la viga junto a la losa del efecto de nudo de la vivienda.

Modelo A (CYPE, «prueba concreta.c3e», 2026-10-20): un recuadro de reticular 25+5 de 6 × 6 m a
ejes en x y 5,85 m en y (el listado, «EJEMPLO 6X6.pdf»: P1 y P2 con el punto fijo en la mitad
inferior, en y = 0, así que su centro está en y = 0,15), cuatro pilares de 30 × 30 en las esquinas
(3 m hasta la cara superior del forjado, pie empotrado, cabeza 0,3; la losa, a media altura: 2,85), vigas planas de 30 × 30 en los cuatro bordes y sólo peso propio.
Reticular 25+5 de casetón perdido, intereje 82, nervio 12, 4,335 kN/m² (listado). Los ábacos, por los
nudos del listado: x ≤ 1,42 y x ≥ 4,58; y ≤ 1,2835 y y ≥ 4,7965. Las cargas, como en la réplica de
la vivienda: el aligerado con su peso, los ábacos a γ·h y la media viga interior que no cae en un
ábaco, maciza.

  .venv/Scripts/python.exe validacion/sombra/minimo/modelos.py [<variante> ...]
"""
import json, os, sys

AQUI = os.path.dirname(os.path.abspath(__file__))
GAMMA, H, PP_ALIGERADO = 25.0, 0.30, 4.335
LX, Y0, Y1 = 6.0, 0.15, 6.0
AX0, AX1, AY0, AY1 = 1.42, 4.58, 1.2835, 4.7965


def R(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def modelo_a(opciones=None, fraccion_vigas=1.0):
    abacos = [R(-0.5, -0.5, AX0, AY0), R(AX1, -0.5, LX + 0.5, AY0),
              R(-0.5, AY1, AX0, Y1 + 0.5), R(AX1, AY1, LX + 0.5, Y1 + 0.5)]
    hv = 0.30 * fraccion_vigas ** (1 / 3)
    m = {
        "plantas": [{"id": "F1", "nombre": "Forjado 1", "altura": None}, {"id": "PB", "nombre": "Cimentación", "altura": 2.85}],
        "materiales": [{"id": "HA-30", "tipo": "hormigon", "fck": 30}],
        "secciones": [{"id": "P30x30", "material": "HA-30", "forma": "rectangular", "b": 0.3, "h": 0.3},
                      {"id": "V30", "material": "HA-30", "forma": "rectangular", "b": 0.3, "h": hv}],
        "pilares": [{"id": f"P{i + 1}", "x": x, "y": y, "desde": "PB", "hasta": "F1", "seccion": "P30x30"}
                    for i, (x, y) in enumerate([(0, Y0), (LX, Y0), (0, Y1), (LX, Y1)])],
        "vigas": [{"id": "V-P1-P2", "planta": "F1", "puntos": [[0, Y0], [LX, Y0]], "seccion": "V30"},
                  {"id": "V-P3-P4", "planta": "F1", "puntos": [[0, Y1], [LX, Y1]], "seccion": "V30"},
                  {"id": "V-P1-P3", "planta": "F1", "puntos": [[0, Y0], [0, Y1]], "seccion": "V30"},
                  {"id": "V-P2-P4", "planta": "F1", "puntos": [[LX, Y0], [LX, Y1]], "seccion": "V30"}],
        "losas": [{"id": "L1", "planta": "F1", "contorno": R(0, Y0, LX, Y1), "espesor": H, "material": "HA-30", "pp": PP_ALIGERADO,
                   "reticular": {"intereje": 0.82, "nervio": 0.12, "capa": 0.05, "caseton": "perdido", "abacos": abacos}}],
        "casos": [{"id": "PP", "pesoPropio": True}],
        "cargas": [],
    }
    for i, a in enumerate(abacos):
        m["cargas"].append({"tipo": "superficie", "id": f"PPA-{i + 1}", "caso": "PP", "planta": "F1", "q": [0, 0, -(GAMMA * H - PP_ALIGERADO)], "zona": a})
    # La media viga interior fuera de los ábacos: la losa la pesa con el pp, CYPE con γ·h
    fuera = {"x": (AX1 - AX0) / LX, "y": (AY1 - AY0) / (Y1 - Y0)}
    for v in m["vigas"]:
        (ax, ay), (bx, by) = v["puntos"]
        f = fuera["x"] if ay == by else fuera["y"]
        m["cargas"].append({"tipo": "viga", "id": f"PP-T-{v['id']}", "caso": "PP", "viga": v["id"], "ejes": "global", "q": [0, 0, -0.15 * (GAMMA * H - PP_ALIGERADO) * f]})
    p = {"esquema": "concreta-fem/proyecto@1", "nombre": "Modelo mínimo A (recuadro de reticular con vigas planas)", "modelo": m}
    if opciones:
        p["opciones"] = opciones
    return p


VARIANTES = {
    "a": lambda: modelo_a(),
    "a-vigas-05": lambda: modelo_a(fraccion_vigas=0.5),
    "a-vigas-025": lambda: modelo_a(fraccion_vigas=0.25),
    "a-vigas-06": lambda: modelo_a(fraccion_vigas=0.6),
    "a-vigas-07": lambda: modelo_a(fraccion_vigas=0.7),
    "a-eje": lambda: modelo_a({"unionLosaViga": "eje"}),
}

if __name__ == "__main__":
    for nombre in sys.argv[1:] or VARIANTES:
        d = os.path.join(AQUI, ".datos", nombre)
        os.makedirs(d, exist_ok=True)
        json.dump(VARIANTES[nombre](), open(os.path.join(d, "proyecto.json"), "w", encoding="utf-8", newline=""), ensure_ascii=False, indent=2)
        print("escrito", nombre)
