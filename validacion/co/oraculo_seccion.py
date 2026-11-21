"""
Fase CO, criterio 11 (docs/fem3d/comprobaciones.md §7): un integrador de la sección que no es de
Concreta, para la flexocompresión y la flexotracción de los pilares.

    python3 validacion/co/oraculo_seccion.py     escribe validacion/co/oraculo-seccion.json

Sin dependencias (sólo `math`). Lo que hace, escrito aparte del módulo de pilares:
  - hormigón, diagrama parábola-rectángulo del CE (Anejo 19 §3.1.7) con fcd = fck/1,5;
  - acero elastoplástico, fyd = fyk/1,15, Es = 200 000 MPa; a las barras comprimidas se les descuenta
    el hormigón que desplazan;
  - dominios de deformación por los pivotes B (εcu en la fibra más comprimida) y C (εc2 a (1 − εc2/εcu)
    del canto), sin limitar la deformación del acero (como el módulo; el pivote A se da aparte, como
    medida: `MRd_pivoteA`);
  - el hormigón se integra por Simpson en la zona comprimida (4 000 intervalos), no por tiras;
  - las áreas de barra, π·Ø²/4 (el módulo usa las tabuladas a la décima de mm²), y fcd sin redondear
    (el módulo, 16,7 con fck = 25): las diferencias de la comparación incluyen esos redondeos.

Para cada caso y cada axil N (kN, compresión positiva; negativo, tracción) da el momento resistente
según el canto h (MRdy) y según el ancho b (MRdz), o el de la sección circular en su orientación más
desfavorable, y los axiles de agotamiento NRd,máx (compresión) y Nt,Rd (tracción).
"""

import io
import json
import math
import os

ES = 200000.0


def hormigon(fck):
    if fck <= 50:
        return fck / 1.5, 0.002, 0.0035, 2.0
    ec2 = 0.002 + 0.000085 * (fck - 50) ** 0.53
    ecu = 0.0026 + 0.035 * ((90 - fck) / 100) ** 4
    n = 1.4 + 23.4 * ((90 - fck) / 100) ** 4
    return fck / 1.5, ec2, ecu, n


def sigma_c(eps, fcd, ec2, n):
    if eps <= 0:
        return 0.0
    if eps >= ec2:
        return fcd
    return fcd * (1 - (1 - eps / ec2) ** n)


def deformacion(y, x, canto, ec2, ecu, pivote_a=None):
    """Deformación a la profundidad y (desde la fibra más comprimida) con la fibra neutra en x."""
    if x <= canto:
        eps_top = ecu
        if pivote_a is not None:
            d, eud = pivote_a
            # Pivote A: el acero más traccionado, a εud; la fibra de arriba, la que resulte (≤ εcu)
            if x < d and ecu * (d - x) / x > eud:
                eps_top = eud * x / (d - x)
        return eps_top * (x - y) / x
    yc = canto * (1 - ec2 / ecu)
    return ec2 * (x - y) / (x - yc)


def simpson(f, a, b, n=4000):
    if b <= a:
        return 0.0
    h = (b - a) / n
    s = f(a) + f(b)
    for i in range(1, n):
        s += f(a + i * h) * (4 if i % 2 else 2)
    return s * h / 3


def esfuerzos(x, canto, ancho, barras, fck, fyk, pivote_a=None):
    """N (N) y M (N·mm, respecto al centro) con la fibra neutra en x. `ancho(y)`, mm."""
    fcd, ec2, ecu, n = hormigon(fck)
    fyd = fyk / 1.15
    eps = lambda y: deformacion(y, x, canto, ec2, ecu, pivote_a)
    hasta = min(x, canto)
    N = simpson(lambda y: sigma_c(eps(y), fcd, ec2, n) * ancho(y), 0.0, hasta)
    M = simpson(lambda y: sigma_c(eps(y), fcd, ec2, n) * ancho(y) * (canto / 2 - y), 0.0, hasta)
    for y, area in barras:
        e = eps(y)
        s = max(-fyd, min(fyd, ES * e)) - sigma_c(e, fcd, ec2, n)
        N += area * s
        M += area * s * (canto / 2 - y)
    return N, M


def momento(N, canto, ancho, barras, fck, fyk, pivote_a=None):
    """MRd (kN·m) con el axil N (kN, compresión positiva), por bisección de la fibra neutra."""
    lo, hi = 1e-4, 2.0 * canto
    for _ in range(40):
        if esfuerzos(hi, canto, ancho, barras, fck, fyk, pivote_a)[0] >= N * 1e3:
            break
        hi *= 2
    for _ in range(70):
        mid = (lo + hi) / 2
        if esfuerzos(mid, canto, ancho, barras, fck, fyk, pivote_a)[0] < N * 1e3:
            lo = mid
        else:
            hi = mid
    return esfuerzos((lo + hi) / 2, canto, ancho, barras, fck, fyk, pivote_a)[1] / 1e6


def area(d):
    return math.pi * d * d / 4


def capas_rectangular(c):
    """Las capas de barras para la flexión según h y según b: [(profundidad, área)]."""
    b, h = c["b"], c["h"]
    dp = c["recubrimiento"] + c["cercos"] + c["esquinas"] / 2
    nb, db = c["caraB"]
    nh, dh = c["caraH"]
    # Según h: las dos caras de ancho b (2 esquinas + sus intermedias) y las intermedias de las caras h
    y = [(dp, 2 * area(c["esquinas"]) + nb * area(db)), (h - dp, 2 * area(c["esquinas"]) + nb * area(db))]
    y += [(dp + i * (h - 2 * dp) / (nh + 1), 2 * area(dh)) for i in range(1, nh + 1)]
    z = [(dp, 2 * area(c["esquinas"]) + nh * area(dh)), (b - dp, 2 * area(c["esquinas"]) + nh * area(dh))]
    z += [(dp + i * (b - 2 * dp) / (nb + 1), 2 * area(db)) for i in range(1, nb + 1)]
    total = 4 * area(c["esquinas"]) + 2 * nb * area(db) + 2 * nh * area(dh)
    return y, z, total


def caso_rectangular(c):
    y, z, As = capas_rectangular(c)
    fcd = c["fck"] / 1.5
    fyd = c["fyk"] / 1.15
    b, h = c["b"], c["h"]
    dp = c["recubrimiento"] + c["cercos"] + c["esquinas"] / 2
    r = {"NRdMax": (fcd * (b * h - As) + min(fyd, ES * 0.002) * As) / 1e3, "NtRd": As * fyd / 1e3, "axiles": []}
    for N in c["N"]:
        r["axiles"].append(
            {
                "N": N,
                "MRdy": momento(N, h, lambda _: b, y, c["fck"], c["fyk"]),
                "MRdz": momento(N, b, lambda _: h, z, c["fck"], c["fyk"]),
                "MRdy_pivoteA": momento(N, h, lambda _: b, y, c["fck"], c["fyk"], (h - dp, 0.01)),
            }
        )
    return r


def caso_circular(c):
    D = c["D"]
    n, d = c["anillo"]
    rs = (D - 2 * c["recubrimiento"] - 2 * c["cercos"] - d) / 2
    As = n * area(d)
    fcd = c["fck"] / 1.5
    fyd = c["fyk"] / 1.15
    ancho = lambda y: 2 * math.sqrt(max(0.0, (D / 2) ** 2 - (y - D / 2) ** 2))
    r = {"NRdMax": (fcd * (math.pi * D * D / 4 - As) + min(fyd, ES * 0.002) * As) / 1e3, "NtRd": As * fyd / 1e3, "axiles": []}
    for N in c["N"]:
        peor = None
        # La orientación del anillo más desfavorable, en [0, π/n]
        for k in range(13):
            t0 = k * (math.pi / n) / 12
            barras = [(D / 2 - rs * math.cos(t0 + 2 * math.pi * i / n), area(d)) for i in range(n)]
            m = momento(N, D, ancho, barras, c["fck"], c["fyk"])
            peor = m if peor is None else min(peor, m)
        r["axiles"].append({"N": N, "MRd": peor})
    return r


CASOS = [
    {"id": "30x30-4d12", "forma": "rectangular", "b": 300, "h": 300, "fck": 25, "fyk": 500, "recubrimiento": 30, "cercos": 6, "esquinas": 12, "caraB": [0, 12], "caraH": [0, 12], "N": [-150, -60, 0.5, 100, 400, 800, 1200]},
    {"id": "40x40-4d16+4d12b", "forma": "rectangular", "b": 400, "h": 400, "fck": 25, "fyk": 500, "recubrimiento": 30, "cercos": 8, "esquinas": 16, "caraB": [2, 12], "caraH": [0, 12], "N": [-300, -100, 0.5, 200, 800, 1600, 2400]},
    {"id": "30x50-4d20+2d16b+4d16h", "forma": "rectangular", "b": 300, "h": 500, "fck": 30, "fyk": 500, "recubrimiento": 35, "cercos": 8, "esquinas": 20, "caraB": [1, 16], "caraH": [2, 16], "N": [-500, -200, 0.5, 300, 1000, 2000, 3000]},
    {"id": "60x40-4d25+6d25b+2d25h", "forma": "rectangular", "b": 600, "h": 400, "fck": 40, "fyk": 500, "recubrimiento": 40, "cercos": 8, "esquinas": 25, "caraB": [3, 25], "caraH": [1, 25], "N": [-1500, -500, 0.5, 500, 2000, 4000, 6500]},
    {"id": "25x25-4d12-fyk400", "forma": "rectangular", "b": 250, "h": 250, "fck": 25, "fyk": 400, "recubrimiento": 25, "cercos": 6, "esquinas": 12, "caraB": [0, 12], "caraH": [0, 12], "N": [-100, 0.5, 100, 400, 800]},
    {"id": "c40-8d16", "forma": "circular", "D": 400, "fck": 25, "fyk": 500, "recubrimiento": 30, "cercos": 8, "anillo": [8, 16], "N": [100, 500, 1000, 1800]},
    {"id": "c60-12d20", "forma": "circular", "D": 600, "fck": 30, "fyk": 500, "recubrimiento": 35, "cercos": 8, "anillo": [12, 20], "N": [200, 1500, 3000, 5000]},
]

if __name__ == "__main__":
    salida = []
    for c in CASOS:
        r = caso_rectangular(c) if c["forma"] == "rectangular" else caso_circular(c)
        salida.append({**c, **r})
        print(c["id"], round(r["NRdMax"], 1), round(r["NtRd"], 1), [round(a.get("MRdy", a.get("MRd")), 2) for a in r["axiles"]])
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "oraculo-seccion.json")
    with io.open(ruta, "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps({"descripcion": "Integrador independiente de la sección (validacion/co/oraculo_seccion.py)", "casos": salida}, indent=1, ensure_ascii=False) + "\n")
