"""
Prueba en sombra de la vivienda (CY4): la réplica en nuestro motor del modelo CYPECAD del usuario,
a partir de `ejemplos/vivienda/proyecto.json` (losas, zunchos y pilares) con lo que es de CYPE:

- los nudos de las losas a media losa (3,35 y 4,25: las cotas 3,50 y 4,40 de CYPE menos 15 cm);
- HA-30 (Ecm = 32 837 MPa, el del listado);
- los pilares en los centros que da su punto fijo (P13 incluido, en (7,29; 8,64));
- la viga de la pérgola en x = 4,26 y la de x = 14,28;
- sus ábacos, medidos en las capturas de replanteo (±3 cm);
- sus cargas por hipótesis (PP, CM y Q, sin nieve ni lamas): CM 2,0 y Q 1,0 kN/m² en las losas,
  en la media viga de borde exterior a su eje y en las vigas de la pérgola, y los petos de 3,0 kN/m
  donde los tiene CYPE (todas las vigas de borde menos Z-CUB-2 de 1,87 a 15,67);
- el peso del aligerado de CYPE, 4,45 kN/m² (despejado de su PP total con sus ábacos y vigas), los
  ábacos a γ·h y la media viga interior, maciza.

  python validacion/sombra/vivienda/replica.py [<opciones JSON>] [<carpeta de salida>]
"""
import json, os, sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.join(AQUI, "..", "..", "..")
GAMMA, PP_ALIGERADO = 25.0, 4.45

CENTROS = {"P1": (-8.80, 15.05), "P2": (-5.75, 15.05), "P3": (-0.02, 14.56), "P4": (4.26, 14.56),
           "P5": (9.00, 14.56), "P6": (14.26, 14.56), "P7": (-8.80, 12.99), "P8": (9.00, 12.17),
           "P9": (14.26, 11.27), "P10": (-5.75, 8.80), "P11": (-0.02, 8.79), "P12": (4.28, 8.79),
           "P13": (7.29, 8.64), "P14": (-0.02, 5.79), "P15": (4.26, 5.79), "P16": (7.59, 5.78),
           "P17": (14.26, 5.79), "P18": (0.00, 1.87), "P19": (4.27, 1.87), "P20": (7.59, 1.87),
           "P21": (14.28, 1.87), "P22": (0.00, 0.00), "P23": (4.27, 0.00)}
R = lambda x0, y0, x1, y1: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
ABACOS = {
    "L-CUB": [R(-9.5, 12.5, -7.81, 15.5), R(-6.70, 13.78, -4.40, 15.5), R(-1.64, 13.05, 1.36, 16.2),
              R(3.21, 13.05, 4.8, 16.2), R(-6.3, 8.3, -4.40, 9.76), R(-1.11, 4.41, 1.36, 10.28),
              [[2.68, 4.41], [4.8, 4.41], [4.8, 9.76], [3.41, 9.76], [3.41, 7.41], [2.68, 7.41]],
              [[-0.5, -0.5], [1.36, -0.5], [1.36, 0.92], [1.03, 0.92], [1.03, 3.09], [-0.5, 3.09]],
              R(3.21, -0.5, 4.8, 3.09)],
    "L-CUB-S": [R(3.8, 13.32, 5.62, 15.0), [[8.00, 13.52], [8.19, 13.52], [8.19, 11.35], [10.17, 11.35], [10.17, 16.2], [8.00, 16.2]],
                R(13.25, 13.52, 14.8, 16.2), R(13.25, 9.91, 14.8, 12.17), R(3.8, 7.53, 5.62, 9.70),
                R(6.22, 7.73, 8.73, 10.03), R(3.8, 5.3, 5.31, 7.13), R(6.22, 5.3, 9.23, 6.82), R(12.72, 5.3, 14.8, 7.13)],
}


def en_poligono(q, poly):
    x, y = q
    dentro = False
    for (ax, ay), (bx, by) in zip(poly, poly[1:] + poly[:1]):
        if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
            dentro = not dentro
    return dentro


def replica(opciones=None):
    p = json.load(open(os.path.join(RAIZ, "ejemplos", "vivienda", "proyecto.json"), encoding="utf-8"))
    m = p["modelo"]
    p["nombre"] = "Vivienda: réplica del modelo CYPECAD (prueba en sombra)"
    for pl in m["plantas"]:
        if pl["id"] == "PB": pl["altura"] = 3.35
        if pl["id"] == "CUB": pl["altura"] = 0.90
    m["materiales"] = [{"id": "HA-30", "tipo": "hormigon", "fck": 30}]
    for pi in m["pilares"]:
        pi["x"], pi["y"] = CENTROS[pi["id"]]
    vigas = {v["id"]: v for v in m["vigas"]}
    vigas["VPG-1"]["puntos"] = [[4.26, 1.87], [14.28, 1.87]]
    vigas["VPG-2"]["puntos"] = [[14.28, 1.87], [14.28, 5.79]]
    if "VPG-3" not in vigas:
        m["vigas"].append({"id": "VPG-3", "planta": "CUB-S", "puntos": [[4.26, 1.87], [4.26, 5.79]], "seccion": "V30x30"})
    for l in m["losas"]:
        l["reticular"]["abacos"] = ABACOS[l["id"]]
        l["pp"] = PP_ALIGERADO
    m["casos"] = [{"id": "PP", "pesoPropio": True}, {"id": "CM"}, {"id": "Q"}]
    cargas = []
    for l in m["losas"]:
        for i, a in enumerate(l["reticular"]["abacos"]):
            cargas.append({"tipo": "superficie", "id": f"PPA-{l['id']}-{i+1}", "caso": "PP", "planta": l["planta"],
                           "q": [0, 0, -(GAMMA * l["espesor"] - PP_ALIGERADO)], "zona": a})
    borde = [v["id"] for v in m["vigas"] if v["id"].startswith("Z-")]
    pergola = ["VPG-1", "VPG-2", "VPG-3"]
    for caso, q in (("CM", 2.0), ("Q", 1.0)):
        for l in m["losas"]:
            cargas.append({"tipo": "superficie", "id": f"{caso}-{l['id']}", "caso": caso, "planta": l["planta"], "q": [0, 0, -q], "losa": l["id"]})
        for v in borde:
            cargas.append({"tipo": "viga", "id": f"{caso}-T-{v}", "caso": caso, "viga": v, "ejes": "global", "q": [0, 0, -q * 0.15]})
        for v in pergola:
            cargas.append({"tipo": "viga", "id": f"{caso}-T-{v}", "caso": caso, "viga": v, "ejes": "global", "q": [0, 0, -q * 0.30]})
    # La media viga de borde interior que no cae en un ábaco: la losa la pesa con el pp, CYPE con γ·h
    losa_de = {l["planta"]: l for l in m["losas"]}
    for v in borde:
        vv = next(x for x in m["vigas"] if x["id"] == v)
        l = losa_de[vv["planta"]]
        (ax, ay), (bx, by) = vv["puntos"]
        L = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
        ex, ey = (bx - ax) / L, (by - ay) / L
        n_in, N = 0, 400
        for k in range(N):
            s_ = (k + 0.5) / N * L
            for sg in (1, -1):
                q = (ax + s_ * ex + sg * 0.075 * -ey, ay + s_ * ey + sg * 0.075 * ex)
                if en_poligono(q, l["contorno"]) and not any(en_poligono(q, a) for a in l["reticular"]["abacos"]):
                    n_in += 1
        cargas.append({"tipo": "viga", "id": f"PP-T-{v}", "caso": "PP", "viga": v, "ejes": "global", "q": [0, 0, -0.15 * (GAMMA * 0.30 - PP_ALIGERADO) * n_in / N]})
    for v in borde:
        c = {"tipo": "viga", "id": f"PETO-{v}", "caso": "CM", "viga": v, "ejes": "global", "q": [0, 0, -3.0]}
        if v == "Z-CUB-2": c["desde"], c["hasta"] = 0, 1.87
        cargas.append(c)
    m["cargas"] = cargas
    if opciones:
        p["opciones"] = opciones
    return p


if __name__ == "__main__":
    opciones = json.loads(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] else None
    salida = sys.argv[2] if len(sys.argv) > 2 else os.path.join(AQUI, ".datos", "defecto")
    os.makedirs(salida, exist_ok=True)
    json.dump(replica(opciones), open(os.path.join(salida, "proyecto.json"), "w", encoding="utf-8", newline=""), ensure_ascii=False, indent=2)
    print("escrito", os.path.join(salida, "proyecto.json"))
