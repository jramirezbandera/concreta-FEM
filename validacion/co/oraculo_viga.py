"""
Fase CO2, criterio 11 (docs/fem3d/comprobaciones.md §7): el módulo de vigas frente a cuentas que no son
de Concreta.

    python3 validacion/co/oraculo_viga.py     escribe validacion/co/oraculo-viga.json

Sin dependencias. Para cada sección de viga (rectangular, con una capa de barras arriba y otra abajo):

  - el momento resistente con la tracción abajo (MRd+) y con la tracción arriba (MRd-), con el
    integrador de la sección de `oraculo_seccion.py` (parábola-rectángulo por Simpson, pivotes B y C,
    acero elastoplástico, áreas π·Ø²/4 y fcd sin redondear) y el axil nulo. De dos maneras: con la
    deformación del acero traccionado limitada al 10 por mil (el pivote A, como el módulo) y sin
    límite (la rama horizontal sin límite que también admite el CE, Anejo 19 §3.2.7(2)b);
  - el cortante con cercos, con las fórmulas del Código Estructural (Anejo 19 §6.2.3) escritas aquí:
    VRd,s = (Asw/s)·z·fywd·cot θ y VRd,máx = b·z·ν1·fcd/(cot θ + tan θ), con z = 0,9·d y cot θ = 2;
  - la abertura de fisura wk (§7.3.4) con el momento de servicio dado, en las dos caras: sección
    fisurada con la armadura traccionada, hc,ef = mín(2,5·(h − d); (h − x)/3; h/2),
    sr,máx = 3,4·c + 0,425·0,8·0,5·Ø/ρp,ef (o 1,3·(h − x) si las barras están a más de 5·(c + Ø/2)) y
    εsm − εcm = máx([σs − 0,4·fctm/ρp,ef·(1 + αe·ρp,ef)]/Es; 0,6·σs/Es), con Ecm y fctm de sus fórmulas
    (el módulo usa los tabulados).
"""

import io
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oraculo_seccion import ES, area, momento  # noqa: E402


EPS_UD = 0.010


def flexion(c, traccion, compresion, pivote_a=False):
    """MRd (kN·m) con `traccion` = (n, Ø) en la cara traccionada y `compresion` en la opuesta."""
    b, h = c["b"], c["h"]
    borde = c["recubrimiento"] + c["cercos"][0]
    nt, dt = traccion
    ncp, dcp = compresion
    barras = [(borde + dcp / 2, ncp * area(dcp)), (h - borde - dt / 2, nt * area(dt))]
    return momento(0.0, h, lambda _: b, barras, c["fck"], c["fyk"], (h - borde - dt / 2, EPS_UD) if pivote_a else None)


def cortante(c, traccion):
    b, h, fck = c["b"], c["h"], c["fck"]
    diam, sep, ramas = c["cercos"]
    d = h - c["recubrimiento"] - diam - traccion[1] / 2
    z = 0.9 * d
    cot = 2.0
    fyd = c["fyk"] / 1.15
    fcd = fck / 1.5
    VRds = ramas * area(diam) / sep * z * fyd * cot / 1e3
    nu1 = 0.6 * (1 - fck / 250)
    VRdmax = b * z * nu1 * fcd / (cot + 1 / cot) / 1e3
    return {"VRds": VRds, "VRdmax": VRdmax}


def fisura(c, traccion, Ms):
    """wk (mm) con el momento de servicio Ms (kN·m)."""
    b, h, fck = c["b"], c["h"], c["fck"]
    n, diam = traccion
    cl = c["recubrimiento"] + c["cercos"][0]
    d = h - cl - diam / 2
    As = n * area(diam)
    Ecm = 22000 * ((fck + 8) / 10) ** 0.3
    fctm = 0.3 * fck ** (2 / 3) if fck <= 50 else 2.12 * math.log(1 + (fck + 8) / 10)
    ae = ES / Ecm
    # Fibra neutra de la sección fisurada: b·x²/2 = αe·As·(d − x)
    x = (-ae * As + math.sqrt((ae * As) ** 2 + 2 * b * ae * As * d)) / b
    Icr = b * x**3 / 3 + ae * As * (d - x) ** 2
    ss = ae * Ms * 1e6 * (d - x) / Icr
    hcef = min(2.5 * (h - d), (h - x) / 3, h / 2)
    rho = As / (b * hcef)
    ejes = (b - 2 * cl - diam) / (n - 1) if n > 1 else float("inf")
    srmax = 1.3 * (h - x) if ejes > 5 * (cl + diam / 2) else 3.4 * cl + 0.425 * 0.8 * 0.5 * diam / rho
    eps = max((ss - 0.4 * fctm / rho * (1 + ae * rho)) / ES, 0.6 * ss / ES)
    return {"wk": srmax * eps, "sigmaS": ss, "x": x}


CASOS = [
    {"id": "30x50-3d16-2d12", "b": 300, "h": 500, "fck": 25, "fyk": 500, "recubrimiento": 30, "cercos": [8, 150, 2], "inferior": [3, 16], "superior": [2, 12], "Ms": [45, 20]},
    {"id": "30x50-4d20-3d16-c30", "b": 300, "h": 500, "fck": 30, "fyk": 500, "recubrimiento": 30, "cercos": [8, 100, 2], "inferior": [4, 20], "superior": [3, 16], "Ms": [110, 80]},
    {"id": "50x30-plana-5d16-5d12", "b": 500, "h": 300, "fck": 25, "fyk": 500, "recubrimiento": 30, "cercos": [6, 150, 4], "inferior": [5, 16], "superior": [5, 12], "Ms": [30, 20]},
    {"id": "40x70-5d25-3d20-c35", "b": 400, "h": 700, "fck": 35, "fyk": 500, "recubrimiento": 35, "cercos": [10, 100, 4], "inferior": [5, 25], "superior": [3, 20], "Ms": [350, 200]},
    {"id": "25x40-2d12-2d12-fyk400", "b": 250, "h": 400, "fck": 25, "fyk": 400, "recubrimiento": 25, "cercos": [6, 200, 2], "inferior": [2, 12], "superior": [2, 12], "Ms": [15, 10]},
    {"id": "30x40-sobrearmada-6d25", "b": 300, "h": 400, "fck": 25, "fyk": 500, "recubrimiento": 30, "cercos": [8, 100, 2], "inferior": [6, 25], "superior": [2, 12], "Ms": [150, 20]},
]

if __name__ == "__main__":
    salida = []
    for c in CASOS:
        inf, sup = c["inferior"], c["superior"]
        r = {
            "MRdPositivo": flexion(c, inf, sup, True),
            "MRdNegativo": flexion(c, sup, inf, True),
            "MRdPositivoSinLimite": flexion(c, inf, sup),
            "MRdNegativoSinLimite": flexion(c, sup, inf),
            "cortantePositivo": cortante(c, inf),
            "cortanteNegativo": cortante(c, sup),
            "fisuraPositivo": fisura(c, inf, c["Ms"][0]),
            "fisuraNegativo": fisura(c, sup, c["Ms"][1]),
        }
        salida.append({**c, **r})
        print(c["id"], round(r["MRdPositivo"], 2), round(r["MRdNegativo"], 2), round(r["MRdPositivoSinLimite"], 2), round(r["MRdNegativoSinLimite"], 2), round(r["cortantePositivo"]["VRds"], 1), round(r["cortantePositivo"]["VRdmax"], 1), round(r["fisuraPositivo"]["wk"], 4), round(r["fisuraNegativo"]["wk"], 4))
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "oraculo-viga.json")
    with io.open(ruta, "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps({"descripcion": "Oráculo de las vigas (validacion/co/oraculo_viga.py)", "casos": salida}, indent=1, ensure_ascii=False) + "\n")
