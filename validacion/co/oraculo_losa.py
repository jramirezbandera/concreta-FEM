"""
Fase CO3, criterio 11 (docs/fem3d/comprobaciones.md §7): el módulo de forjados frente a cuentas que no
son de Concreta.

    python3 validacion/co/oraculo_losa.py     escribe validacion/co/oraculo-losa.json

Sin dependencias. Para cada sección (un metro de losa maciza, o un nervio en T de un reticular), sin
armadura de compresión (el módulo no la cuenta en la flexión):

  - el momento resistente con la tracción abajo (MRd+) y con la tracción arriba (MRd-), con el
    integrador de la sección de `oraculo_seccion.py` (parábola-rectángulo por Simpson, sin límite de
    deformación del acero). En el nervio, MRd+ con la T (el ala de ancho eficaz comprimida) y MRd- con
    el alma sola. El ancho eficaz, con la fórmula del Código (Anejo 19 §5.3.2.1): bw + Σ mín(0,2·bi +
    0,1·l0; 0,2·l0; bi), con l0 = 0,7·L; el módulo toma mín(intereje; l0/5), que no es mayor;
  - el cortante sin armadura transversal (Anejo 19 §6.2.2): VRd,c = máx(CRd,c·k·(100·ρl·fck)^(1/3);
    vmín)·bw·d, con k = 1 + √(200/d) ≤ 2, ρl ≤ 0,02, CRd,c = 0,18/γc y vmín = 0,051/γc·k^(3/2)·√fck
    (la constante de vmín es la del módulo), con el menor canto útil y la menor armadura de las dos
    caras;
  - la abertura de fisura wk (§7.3.4) con el momento de servicio dado, en las dos caras: sección
    fisurada (en el nervio con la tracción abajo, comprimida el ala), hc,ef = mín(2,5·(h − d);
    (h − x)/3; h/2) sobre el ancho traccionado, sr,máx = 3,4·c + 0,425·0,8·0,5·Ø/ρp,ef y
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

GAMMA_C = 1.5


def geometria(c):
    """Anchos (mm) y armaduras (mm², Ø) de las dos caras: [inferior, superior]."""
    if c["tipo"] == "maciza":
        As = [area(d) * 1000 / s for d, s in (c["inferior"], c["superior"])]
        return {"bf": 1000.0, "bw": 1000.0, "hf": c["h"], "As": As, "diam": [c["inferior"][0], c["superior"][0]]}
    l0 = 0.7 * c["luz"]
    bi = (c["intereje"] - c["bw"]) / 2
    bf = c["bw"] + 2 * min(0.2 * bi + 0.1 * l0, 0.2 * l0, bi)
    As = [n * area(d) for n, d in (c["inferior"], c["superior"])]
    return {"bf": bf, "bw": float(c["bw"]), "hf": c["hf"], "As": As, "diam": [c["inferior"][1], c["superior"][1]]}


def flexion(c, cara):
    """MRd (kN·m) con la tracción en la cara 0 (inferior: comprime el ala) o 1 (superior: comprime el alma)."""
    g = geometria(c)
    h = c["h"]
    d = h - c["recubrimiento"] - g["diam"][cara] / 2
    ancho = (lambda y: g["bf"] if y <= g["hf"] else g["bw"]) if cara == 0 else (lambda y: g["bw"])
    return momento(0.0, h, ancho, [(d, g["As"][cara])], c["fck"], c["fyk"])


def cortante(c):
    g = geometria(c)
    fck = c["fck"]
    d = min(c["h"] - c["recubrimiento"] - x / 2 for x in g["diam"])
    As = min(g["As"])
    k = min(1 + math.sqrt(200 / d), 2.0)
    rho = min(As / (g["bw"] * d), 0.02)
    v = max(0.18 / GAMMA_C * k * (100 * rho * fck) ** (1 / 3), 0.051 / GAMMA_C * k**1.5 * math.sqrt(fck))
    return v * g["bw"] * d / 1e3


def fisura(c, cara, Ms):
    """wk (mm) con el momento de servicio Ms (kN·m) que tracciona la cara."""
    g = geometria(c)
    h, fck = c["h"], c["fck"]
    diam = g["diam"][cara]
    As = g["As"][cara]
    cl = c["recubrimiento"]
    d = h - cl - diam / 2
    Ecm = 22000 * ((fck + 8) / 10) ** 0.3
    fctm = 0.3 * fck ** (2 / 3) if fck <= 50 else 2.12 * math.log(1 + (fck + 8) / 10)
    ae = ES / Ecm
    # Ancho comprimido: el ala (tracción abajo) o el alma; la fibra neutra, dentro de él (se comprueba)
    b = g["bf"] if cara == 0 else g["bw"]
    x = (-ae * As + math.sqrt((ae * As) ** 2 + 2 * b * ae * As * d)) / b
    if cara == 0 and x > g["hf"]:
        raise ValueError("la fibra neutra de la sección fisurada sale del ala: " + c["id"])
    Icr = b * x**3 / 3 + ae * As * (d - x) ** 2
    ss = ae * Ms * 1e6 * (d - x) / Icr
    hcef = min(2.5 * (h - d), (h - x) / 3, h / 2)
    rho = As / (g["bw"] * hcef)
    srmax = 3.4 * cl + 0.425 * 0.8 * 0.5 * diam / rho
    eps = max((ss - 0.4 * fctm / rho * (1 + ae * rho)) / ES, 0.6 * ss / ES)
    return {"wk": srmax * eps, "sigmaS": ss, "x": x}


CASOS = [
    {"id": "maciza-20-d10a200", "tipo": "maciza", "h": 200, "fck": 25, "fyk": 500, "recubrimiento": 30, "inferior": [10, 200], "superior": [10, 200], "Ms": [12, 12]},
    {"id": "maciza-25-d12a150-d16a125", "tipo": "maciza", "h": 250, "fck": 25, "fyk": 500, "recubrimiento": 30, "inferior": [12, 150], "superior": [16, 125], "Ms": [30, 60]},
    {"id": "maciza-30-d16a100-d20a100-c30", "tipo": "maciza", "h": 300, "fck": 30, "fyk": 500, "recubrimiento": 35, "inferior": [16, 100], "superior": [20, 100], "Ms": [90, 130]},
    {"id": "maciza-60-cimentacion-d20a150", "tipo": "maciza", "h": 600, "fck": 25, "fyk": 500, "recubrimiento": 50, "inferior": [20, 150], "superior": [16, 200], "Ms": [180, 90]},
    {"id": "nervio-25+5-2d12-1d16", "tipo": "nervio", "h": 300, "hf": 50, "bw": 120, "intereje": 800, "luz": 6000, "fck": 25, "fyk": 500, "recubrimiento": 30, "inferior": [2, 12], "superior": [1, 16], "Ms": [12, 8]},
    {"id": "nervio-30+5-2d16-2d12-luz4", "tipo": "nervio", "h": 350, "hf": 50, "bw": 150, "intereje": 820, "luz": 4000, "fck": 25, "fyk": 500, "recubrimiento": 30, "inferior": [2, 16], "superior": [2, 12], "Ms": [30, 12]},
    {"id": "nervio-20+10-1d20-1d12-c30", "tipo": "nervio", "h": 300, "hf": 100, "bw": 120, "intereje": 700, "luz": 7000, "fck": 30, "fyk": 500, "recubrimiento": 30, "inferior": [1, 20], "superior": [1, 12], "Ms": [20, 6]},
]

if __name__ == "__main__":
    salida = []
    for c in CASOS:
        r = {
            "bEff": geometria(c)["bf"],
            "MRdPositivo": flexion(c, 0),
            "MRdNegativo": flexion(c, 1),
            "VRdc": cortante(c),
            "fisuraPositivo": fisura(c, 0, c["Ms"][0]),
            "fisuraNegativo": fisura(c, 1, c["Ms"][1]),
        }
        salida.append({**c, **r})
        print(c["id"], round(r["bEff"]), round(r["MRdPositivo"], 2), round(r["MRdNegativo"], 2), round(r["VRdc"], 2), round(r["fisuraPositivo"]["wk"], 4), round(r["fisuraNegativo"]["wk"], 4))
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "oraculo-losa.json")
    with io.open(ruta, "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps({"descripcion": "Oráculo de las losas (validacion/co/oraculo_losa.py)", "casos": salida}, indent=1, ensure_ascii=False) + "\n")
