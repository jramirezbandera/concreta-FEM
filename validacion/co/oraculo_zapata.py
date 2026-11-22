"""
Fase CO5, criterio 11 (docs/fem3d/comprobaciones.md §7): el módulo de zapatas frente a cuentas que no
son de Concreta.

    python3 validacion/co/oraculo_zapata.py     escribe validacion/co/oraculo-zapata.json

Sin dependencias. Cada caso es una zapata en los ejes del módulo (x según B; en una medianera el
lindero en x = -B/2, en una de esquina además en y = -L/2, con el pilar enrasado) con una carga N, Mx
(excentricidad según y: ey = Mx/N) y My (ex = My/N) en la cara inferior, y su H para el
deslizamiento. Se calcula, por caminos propios:

  - el terreno, con la carga característica y el peso de la zapata (25 kN/m³) y de las tierras:
      * la ley de presiones lineal recortada a σ ≥ 0 que equilibra V, Mx y My, por Newton sobre la
        integral exacta en y de cada una de 400 franjas en x (sin las soluciones cerradas de la
        trapecial ni de Meyerhof), y su máximo en las esquinas;
      * la presión sobre el área equivalente del DB SE-C 4.3.1.3, qb = V/(B*·L*) con B* = B - 2·e
        (el lado real si e < B/20);
      * el vuelco, por la estática de cada borde: el momento de N, del peso y del momento aplicado
        respecto al borde, FS = estabilizador/volcador; y el deslizamiento, FS = μ·V/H;
  - el armado, con la carga de cálculo sin el peso (no flecta) y la presión uniforme sobre el área
    equivalente (B', L'), pegada al lado de la resultante:
      * el vuelo mayor frente a 2h decide si es rígida;
      * flexible: el momento en la cara del pilar de cada vuelo, integrando la presión, y el área de
        acero que lo resiste con el diagrama parábola-rectángulo (`oraculo_seccion.momento`, por
        bisección del área); el cortante a un canto útil de la cara;
      * rígida: la tracción del tirante de cada lado, R1·(x1 - 0,25·a)/(0,85·d) (EHE-08 58.4.1.1), con
        R1 la resultante de la presión del eje del pilar al borde y x1 su brazo;
      * el punzonamiento en los perímetros a una distancia a ≤ 2d del pilar (CE A19 §6.4.4(2)): el área
        dentro del contorno, de la zapata y del bloque de presiones, por franjas con su extensión
        exacta; VEd,red = R - σ·A; β = 1 + 1,8·√[(ex/(c2 + 2a))² + (ey/(c1 + 2a))²] (con 1,4 y 1,5 como
        mínimos en borde y esquina) con la excentricidad del momento; vEd = VEd,ef/(u·d), vRd =
        vRd,c·2d/a con ρl = √(ρx·ρy) (la del Código; el módulo toma la media aritmética) y se busca el
        peor a en 400 puntos.
"""

import io
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oraculo_seccion import area, momento  # noqa: E402

GAMMA_HA = 25.0


def posicion(c):
    """Eje del pilar respecto al centro de la zapata, m."""
    cx = 0.0 if c["tipo"] == "centrada" else -(c["B"] - c["bc"]) / 2
    cy = -(c["L"] - c["hc"]) / 2 if c["tipo"] == "esquina" else 0.0
    return cx, cy


def integrar(a, bx, by, B, L, n=400):
    """∫ σ, ∫ σ·y y ∫ σ·x de σ = máx(0, a + bx·x + by·y) en el rectángulo; exacto en y."""
    F = Mx = My = 0.0
    dx = B / n
    y0, y1 = -L / 2, L / 2
    for i in range(n):
        x = -B / 2 + (i + 0.5) * dx
        c0 = a + bx * x
        # f(y) = c0 + by·y en [y0, y1], su parte positiva
        if abs(by) < 1e-14:
            if c0 > 0:
                f, fy = c0 * (y1 - y0), 0.0
            else:
                f, fy = 0.0, 0.0
        else:
            yc = -c0 / by
            lo, hi = (max(y0, yc), y1) if by > 0 else (y0, min(y1, yc))
            if hi <= lo:
                f, fy = 0.0, 0.0
            else:
                f = c0 * (hi - lo) + by * (hi * hi - lo * lo) / 2
                fy = c0 * (hi * hi - lo * lo) / 2 + by * (hi ** 3 - lo ** 3) / 3
        F += f * dx
        Mx += fy * dx
        My += f * x * dx
    return F, Mx, My


def presiones(V, Mx, My, B, L):
    """La ley lineal que equilibra V y los momentos (V·e) respecto al centro; su máximo en las esquinas."""
    A = B * L
    p = [V / A, 12 * My / (A * B * B), 12 * Mx / (A * L * L)]
    for _ in range(80):
        F, mx, my = integrar(p[0], p[1], p[2], B, L)
        r = [F - V, mx - Mx, my - My]
        if max(abs(x) for x in r) < 1e-10 * V:
            break
        J = []
        for k in range(3):
            q = list(p)
            dq = max(abs(p[k]) * 1e-6, 1e-6)
            q[k] += dq
            Fq = integrar(q[0], q[1], q[2], B, L)
            J.append([(Fq[0] - F) / dq, (Fq[1] - mx) / dq, (Fq[2] - my) / dq])
        # J[k] es la columna k
        M = [[J[k][i] for k in range(3)] for i in range(3)]
        d = resolver(M, [-x for x in r])
        p = [p[i] + d[i] for i in range(3)]
    a, bx, by = p
    esquinas = [a + bx * sx * B / 2 + by * sy * L / 2 for sx in (-1, 1) for sy in (-1, 1)]
    return max(esquinas), min(esquinas)


def resolver(M, b):
    det = lambda m: m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    D = det(M)
    r = []
    for k in range(3):
        m = [row[:] for row in M]
        for i in range(3):
            m[i][k] = b[i]
        r.append(det(m) / D)
    return r


def terreno(c):
    B, L, h = c["B"], c["L"], c["h"]
    cx, cy = posicion(c)
    W = GAMMA_HA * B * L * h + c["gamma"] * max(c["Df"] - h, 0) * (B * L - c["bc"] * c["hc"])
    V = c["N"] + W
    My = c["N"] * cx + c["My"]
    Mx = c["N"] * cy + c["Mx"]
    ex, ey = My / V, Mx / V
    lado = lambda e, l: l if abs(e) < l / 20 else l - 2 * abs(e)
    qb = V / (lado(ex, B) * lado(ey, L))
    smax, smin = presiones(V, Mx, My, B, L)
    # Vuelco respecto a cada borde: estabilizan N (con su brazo hasta el borde) y el peso; vuelca el momento hacia ese borde
    def fs(M, cpos, semi):
        peor = math.inf
        for s in (1, -1):
            volcador = max(s * M, 0.0)
            if volcador <= 0:
                continue
            estab = c["N"] * (semi - s * cpos) + W * semi
            peor = min(peor, estab / volcador)
        return peor
    return {
        "qb": qb,
        "sigmaMax": smax,
        "sigmaMin": max(smin, 0.0),
        "FSvuelcoX": fs(c["My"], cx, B / 2),
        "FSvuelcoY": fs(c["Mx"], cy, L / 2),
        "FSdeslizamiento": c["mu"] * V / c["H"] if c["H"] > 0 else None,
    }


def as_flexion(MEd, h, d, fck, fyk):
    """Área (mm²/m) que da MRd = MEd en 1 m de ancho con el diagrama parábola-rectángulo."""
    if MEd <= 0:
        return 0.0
    lo, hi = 0.0, 1000.0 * d * 0.05
    for _ in range(60):
        mid = (lo + hi) / 2
        if momento(0.0, h, lambda y: 1000.0, [(d, mid)], fck, fyk) < MEd:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def armado(c):
    B, L, h = c["B"], c["L"], c["h"]
    bc, hc = c["bc"], c["hc"]
    cx, cy = posicion(c)
    R = c["N"]
    ex = (R * cx + c["My"]) / R
    ey = (R * cy + c["Mx"]) / R
    Bp, Lp = B - 2 * abs(ex), L - 2 * abs(ey)
    sigma = R / (Bp * Lp)
    bloque_x = (B / 2 - Bp, B / 2) if ex >= 0 else (-B / 2, -B / 2 + Bp)
    bloque_y = (L / 2 - Lp, L / 2) if ey >= 0 else (-L / 2, -L / 2 + Lp)
    cover = c["cover"]
    dx = h * 1000 - cover - c["phix"] / 2
    dy = h * 1000 - cover - c["phix"] - c["phiy"] / 2
    caras = {"x": (cx - bc / 2, cx + bc / 2, -B / 2, B / 2, bloque_x), "y": (cy - hc / 2, cy + hc / 2, -L / 2, L / 2, bloque_y)}

    def tramo(desde, hasta, blq):
        lo, hi = max(min(desde, hasta), blq[0]), min(max(desde, hasta), blq[1])
        return (lo, hi) if hi > lo else None

    def momento_vuelo(cara, borde, blq):
        t = tramo(cara, borde, blq)
        if not t:
            return 0.0
        # ∫ σ·|x - cara| dx en el tramo cargado
        a, b = sorted([abs(t[0] - cara), abs(t[1] - cara)])
        return sigma * (b * b - a * a) / 2

    def cortante_vuelo(cara, borde, blq, d):
        s = 1 if borde > cara else -1
        t = tramo(cara + s * d, borde, blq)
        return sigma * (t[1] - t[0]) if t else 0.0

    vuelos = {k: max(v[1] - v[2] if False else 0, 0) for k, v in caras.items()}
    vmax = max(abs(caras["x"][2] - caras["x"][0]), abs(caras["x"][3] - caras["x"][1]), abs(caras["y"][2] - caras["y"][0]), abs(caras["y"][3] - caras["y"][1]))
    rigida = vmax <= 2 * h
    fyd = c["fyk"] / 1.15
    r = {"rigida": rigida, "sigma": sigma}
    for k, (cn, cp, bn, bp, blq) in caras.items():
        d = dx if k == "x" else dy
        ancho_t = Lp if k == "x" else Bp
        largo_t = L if k == "x" else B
        eje = cx if k == "x" else cy
        a_pilar = bc if k == "x" else hc
        MEd = max(momento_vuelo(cn, bn, blq), momento_vuelo(cp, bp, blq))
        r[f"MEd{k}"] = MEd
        r[f"VEd{k}"] = max(cortante_vuelo(cn, bn, blq, d / 1000), cortante_vuelo(cp, bp, blq, d / 1000))
        r[f"AsFlexion{k}"] = as_flexion(MEd, h * 1000, d, c["fck"], c["fyk"])
        # Tirante de cada lado: la resultante del eje al borde y su brazo desde el eje
        T = 0.0
        for borde in (bn, bp):
            t = tramo(eje, borde, blq)
            if not t:
                continue
            R1 = sigma * ancho_t * (t[1] - t[0])
            x1 = abs((t[0] + t[1]) / 2 - eje)
            brazo = x1 - 0.25 * a_pilar
            if brazo > 0:
                T = max(T, R1 * brazo / (0.85 * d / 1000))
        r[f"Td{k}"] = T
        r[f"AsTirante{k}"] = T * 1000 / fyd / largo_t
    # Punzonamiento
    davg = (dx + dy) / 2
    dm = davg / 1000
    pos = {"centrada": "interior", "medianera": "borde", "esquina": "esquina"}[c["tipo"]]
    asx = area(c["phix"]) / c["sx"] * 1000
    asy = area(c["phiy"]) / c["sy"] * 1000
    rho = min(math.sqrt(asx / (1000 * dx) * asy / (1000 * dy)), 0.02)
    k = min(1 + math.sqrt(200 / davg), 2.0)
    vrdc = max(0.18 / 1.5 * k * (100 * rho * c["fck"]) ** (1 / 3), 0.035 * k ** 1.5 * math.sqrt(c["fck"]))
    ap_x = (max(-B / 2, bloque_x[0]), min(B / 2, bloque_x[1]))
    ap_y = (max(-L / 2, bloque_y[0]), min(L / 2, bloque_y[1]))

    def area_contorno(a, n=1500):
        x0, x1 = max(ap_x[0], cx - bc / 2 - a), min(ap_x[1], cx + bc / 2 + a)
        if x1 <= x0:
            return 0.0
        s = 0.0
        w = (x1 - x0) / n
        for i in range(n):
            x = x0 + (i + 0.5) * w
            fuera = max(cx - bc / 2 - x, x - cx - bc / 2, 0.0)
            g = math.sqrt(max(a * a - fuera * fuera, 0.0))
            lo, hi = max(ap_y[0], cy - hc / 2 - g), min(ap_y[1], cy + hc / 2 + g)
            s += max(hi - lo, 0.0) * w
        return s

    def perimetro(a):
        if pos == "borde":
            return hc + 2 * bc + math.pi * a
        if pos == "esquina":
            return bc + hc + math.pi * a / 2
        return 2 * (bc + hc) + 2 * math.pi * a

    eX, eY = abs(c["My"]) / R, abs(c["Mx"]) / R
    libres = [B / 2 - (cx + bc / 2), L / 2 - (cy + hc / 2)]
    if pos == "interior":
        libres.append((cx - bc / 2) + B / 2)
    if pos != "esquina":
        libres.append((cy - hc / 2) + L / 2)
    amax = min([2 * dm] + libres)
    peor = 0.0
    for i in range(1, 401):
        a = amax * i / 400
        beta = 1 + 1.8 * math.hypot(eX / (hc + 2 * a), eY / (bc + 2 * a))
        if pos != "interior":
            beta = max(beta, 1.4 if pos == "borde" else 1.5)
        Vred = max(0.0, R - sigma * area_contorno(a))
        Vef = Vred + (beta - 1) * R if pos == "interior" else beta * Vred
        vEd = Vef / (perimetro(a) * dm) / 1000
        vRd = vrdc * 2 * dm / a
        peor = max(peor, vEd / vRd)
    r["punzonamiento"] = peor
    r["rhoGeometrica"] = rho
    return r


# Casos, en los ejes del módulo
BASE = {"cover": 50, "fck": 25, "fyk": 500, "gamma": 18, "mu": 0.5, "phix": 16, "sx": 200, "phiy": 16, "sy": 200}
CASOS = [
    {"id": "centrada trapecial", "tipo": "centrada", "B": 2.4, "L": 2.0, "h": 0.6, "bc": 0.4, "hc": 0.4, "Df": 1.1, "N": 800, "Mx": 30, "My": 60, "H": 20},
    {"id": "centrada bitriangular según x", "tipo": "centrada", "B": 2.2, "L": 2.2, "h": 0.6, "bc": 0.4, "hc": 0.4, "Df": 0.6, "N": 500, "Mx": 0, "My": 260, "H": 40},
    {"id": "centrada bitriangular biaxial", "tipo": "centrada", "B": 2.5, "L": 2.0, "h": 0.7, "bc": 0.5, "hc": 0.3, "Df": 0.7, "N": 600, "Mx": 150, "My": 230, "H": 0},
    {"id": "centrada flexible", "tipo": "centrada", "B": 3.2, "L": 3.2, "h": 0.5, "bc": 0.4, "hc": 0.4, "Df": 1.0, "N": 1400, "Mx": 20, "My": 40, "H": 30, "phix": 20, "sx": 150, "phiy": 16, "sy": 125},
    {"id": "medianera", "tipo": "medianera", "B": 1.8, "L": 2.6, "h": 0.7, "bc": 0.4, "hc": 0.4, "Df": 0.7, "N": 500, "Mx": 20, "My": 40, "H": 10},
    {"id": "esquina", "tipo": "esquina", "B": 2.0, "L": 2.0, "h": 0.8, "bc": 0.4, "hc": 0.4, "Df": 0.8, "N": 300, "Mx": -10, "My": 25, "H": 8},
    {"id": "centrada flexible, ρ distinta", "tipo": "centrada", "B": 3.0, "L": 2.6, "h": 0.55, "bc": 0.5, "hc": 0.35, "Df": 0.9, "N": 1100, "Mx": -40, "My": 70, "H": 25, "phix": 20, "sx": 125, "phiy": 12, "sy": 200},
]


def main():
    casos = []
    for c0 in CASOS:
        c = {**BASE, **c0}
        casos.append({**c, "terreno": terreno(c), "armado": armado(c)})
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "oraculo-zapata.json")
    with io.open(ruta, "w", encoding="utf8", newline="") as f:
        json.dump({"casos": casos}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    for c in casos:
        t, a = c["terreno"], c["armado"]
        print(f"{c['id']}: qb {t['qb']:.2f}, σmax {t['sigmaMax']:.2f}, rígida {a['rigida']}, MEd {a['MEdx']:.2f}/{a['MEdy']:.2f}, punz {a['punzonamiento']:.4f}")


if __name__ == "__main__":
    main()
