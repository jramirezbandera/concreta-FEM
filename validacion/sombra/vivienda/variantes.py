"""
Prueba en sombra de la vivienda: las variantes del diagnóstico del `my` de la cubierta y de P5
(`docs/fem3d/fase-lv.md` §2.1). Cada una escribe `.datos/<nombre>/proyecto.json` a partir de la
réplica (`replica.py`); después se muestrea y se compara con

  bun validacion/sombra/vivienda/muestrear.ts .datos/<nombre>
  .venv/Scripts/python.exe validacion/sombra/vivienda/comparar.py .datos/<nombre>
  .venv/Scripts/python.exe validacion/sombra/vivienda/zonas.py .datos/<nombre> my Cubierta
  bun validacion/sombra/vivienda/viga.ts .datos/<nombre>
  bun validacion/sombra/vivienda/tramos.ts .datos/<nombre>

Las vigas «más flexibles» se hacen con una sección rectangular del mismo ancho y menos canto
(Iy ∝ h³; con h ≤ el canto de la losa la viga sigue embebida y no pesa de más), porque el
modificador de Iy de las opciones es por material, no por viga, y una sección «general» no entra
en la unión por las caras (LV).

  .venv/Scripts/python.exe validacion/sombra/vivienda/variantes.py [<nombre> ...]
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from replica import replica  # noqa: E402

DATOS = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".datos")
# Canto que deja la flexión de una viga de 30 × 30 en la fracción dada
CANTO = {1.0: 0.30, 0.6: 0.3 * 0.6 ** (1 / 3), 0.5: 0.3 / 2 ** (1 / 3), 0.25: 0.3 / 4 ** (1 / 3), 0.1: 0.139, 0.001: 0.03}


def vigas_flexibles(p, ids, fraccion):
    m = p["modelo"]
    sid = f"V30xI{fraccion}"
    m["secciones"].append({"id": sid, "material": "HA-30", "forma": "rectangular", "b": 0.3, "h": CANTO[fraccion]})
    for v in m["vigas"]:
        if v["id"] in ids:
            v["seccion"] = sid


SUPERIOR = lambda p: {f"Z-CUB-S-{i}" for i in range(1, 7)}
INFERIOR = lambda p: {v["id"] for v in p["modelo"]["vigas"] if v["id"].startswith("Z-CUB-") and not v["id"].startswith("Z-CUB-S")}
TODAS = lambda p: {v["id"] for v in p["modelo"]["vigas"] if v["id"].startswith("Z-")}


def dosis(ids_fn, fraccion):
    def g():
        p = replica({})
        vigas_flexibles(p, ids_fn(p), fraccion)
        return p
    return g


def cabeza_solo(pilar, valor):
    """El empotramiento de la cabeza del último tramo a `valor` en un pilar y 0,3 en los demás."""
    def g():
        p = replica({"empotramientoCabeza": 1})
        for q in p["modelo"]["pilares"]:
            q["empotramiento"] = {"cabeza": valor if q["id"] == pilar else 0.3}
        return p
    return g


def z2_zuncho():
    """El borde x = 4,26 de la cubierta baja entre P19 y P4 (hueco en la captura de CYPE) sin flexión."""
    p = replica({})
    m = p["modelo"]
    z2 = next(v for v in m["vigas"] if v["id"] == "Z-CUB-2")
    m["vigas"].remove(z2)
    m["secciones"].append({"id": "V30xNULA", "material": "HA-30", "forma": "rectangular", "b": 0.3, "h": CANTO[0.001]})
    m["vigas"] += [{"id": "Z-CUB-2a", "planta": "CUB", "puntos": [[4.26, 0], [4.26, 1.87]], "seccion": "V30x30"},
                   {"id": "Z-CUB-2b", "planta": "CUB", "puntos": [[4.26, 1.87], [4.26, 14.56]], "seccion": "V30xNULA"},
                   {"id": "Z-CUB-2c", "planta": "CUB", "puntos": [[4.26, 14.56], [4.26, 15.67]], "seccion": "V30x30"}]
    nuevas = []
    for c in list(m["cargas"]):
        if c.get("viga") == "Z-CUB-2":
            m["cargas"].remove(c)
            if c["id"].startswith("PETO"):
                nuevas.append({**c, "id": c["id"] + "a", "viga": "Z-CUB-2a", "desde": 0, "hasta": 1.87})
            else:
                for s in ("a", "b", "c"):
                    nuevas.append({**c, "id": c["id"] + s, "viga": "Z-CUB-2" + s})
    m["cargas"] += nuevas
    return p


# La huella del pilar como un punto: sección general con las propiedades de 30 × 30 y b = h = 5 cm
PUNTO = {"material": "HA-30", "forma": "general", "A": 0.09, "Iy": 0.3 ** 4 / 12, "Iz": 0.3 ** 4 / 12, "J": 0.1406 * 0.3 ** 4, "b": 0.05, "h": 0.05}


def huella_punto(ids_fn):
    def g():
        p = replica({})
        m = p["modelo"]
        m["secciones"].append({"id": "P-PUNTO", **PUNTO})
        for q in m["pilares"]:
            if q["id"] in ids_fn(p):
                q["seccion"] = "P-PUNTO"
        return p
    return g


def tramo_corto(altura):
    """La altura de CUB: con 0,75, el tramo corto queda con los 0,60 m libres de CYPE (3,50/4,10)."""
    def g():
        p = replica({})
        for pl in p["modelo"]["plantas"]:
            if pl["id"] == "CUB":
                pl["altura"] = altura
        return p
    return g


def losa_flexible(losa, fraccion):
    """La losa con E × fracción (material general con el Ecm de HA-30, ν = 0,2): aligerado y ábacos."""
    def g():
        p = replica({})
        m = p["modelo"]
        E = 22000e3 * (38 / 10) ** 0.3 * fraccion
        m["materiales"].append({"id": "HA-30-flex", "tipo": "general", "E": E, "G": E / 2.4, "peso": 25})
        for l in m["losas"]:
            if l["id"] == losa:
                l["material"] = "HA-30-flex"
        return p
    return g


def vigas_cubren():
    """Las vigas de la cubierta superior que acaban en P4 y P5, hasta la cara del pilar: la esquina
    de la huella que no tapaba ninguna (las vigas acababan en el eje) queda dentro de un ancho."""
    p = replica({})
    v = {x["id"]: x for x in p["modelo"]["vigas"]}
    v["Z-CUB-S-5"]["puntos"] = [[9.15, 14.56], [4.11, 14.56]]
    v["Z-CUB-S-6"]["puntos"][0] = [4.26, 14.71]
    v["Z-CUB-S-4"]["puntos"][-1] = [9, 14.41]
    return p


VARIANTES = {
    "d-base": lambda: replica({}),
    "d-cabeza1": lambda: replica({"empotramientoCabeza": 1}),
    "d-cabeza0": lambda: replica({"empotramientoCabeza": 0}),
    "d-p5-cabeza1": cabeza_solo("P5", 1),
    "d-z5-baja": dosis(lambda p: {"Z-CUB-S-5"}, 0.1),
    "d-z6-baja": dosis(lambda p: {"Z-CUB-S-6"}, 0.1),
    "d-zcubs-05": dosis(SUPERIOR, 0.5),
    "d-zcubs-025": dosis(SUPERIOR, 0.25),
    "d-zcubs-baja": dosis(SUPERIOR, 0.1),
    "d-zcub-baja": dosis(INFERIOR, 0.1),
    "d-todos-05": dosis(TODAS, 0.5),
    "d-todos-025": dosis(TODAS, 0.25),
    # La rigidez de viga con la que el modelo mínimo A de CYPE cuadra (validacion/sombra/minimo)
    "d-todos-06": dosis(TODAS, 0.6),
    "d-z2-nula": z2_zuncho,
    "d-huella-punto": huella_punto(lambda p: {q["id"] for q in p["modelo"]["pilares"]}),
    "d-p5-punto": huella_punto(lambda p: {"P5"}),
    "d-stub060": tramo_corto(0.75),
    "d-losa-s-05": losa_flexible("L-CUB-S", 0.5),
    "d-losa-s-025": losa_flexible("L-CUB-S", 0.25),
    "d-vigas-cubren": vigas_cubren,
    # La torsión de CYPE de la obra del usuario (coeficiente de rigidez a torsión 0,16; el nuestro, 0,1)
    "d-tors016": lambda: replica({"modificadores": {"pilares": {"todos": {"A": 2}}, "vigas": {"hormigon": {"J": 0.16}}}}),
}

if __name__ == "__main__":
    for nombre in sys.argv[1:] or VARIANTES:
        d = os.path.join(DATOS, nombre)
        os.makedirs(d, exist_ok=True)
        json.dump(VARIANTES[nombre](), open(os.path.join(d, "proyecto.json"), "w", encoding="utf-8", newline=""), ensure_ascii=False, indent=2)
        print("escrito", nombre)
