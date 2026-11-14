"""
Fase LC, CB-b: muelles por nudo frente a matriz consistente, aislando lo que es del reparto del
balasto. Viga de Euler-Bernoulli con elementos de Hermite (exactos sin terreno) sobre Winkler, con
una carga puntual en el centro de una viga larga (40/β, extremos libres), frente a Hetényi (viga
infinita): w0 = P·β/(2·kb), M0 = P/(4·β), β = (kb/(4·EI))^¼.

- «nudo»: kb·(área tributaria) en el w de cada nudo (lo que cabe en el motor sin cambiarlo).
- «consistente»: kb·∫NᵀN dx con las funciones de Hermite (acopla w y θ de los dos nudos).

No es código del motor: es la medida para decidir CB-b.

Uso: .venv/Scripts/python validacion/lc/hetenyi.py > validacion/lc/out_hetenyi.txt
"""
import numpy as np

EI = 1.0
KB = 1.0
P = 1.0
BETA = (KB / (4 * EI)) ** 0.25
LC = 1 / BETA


def hetenyi(x):
    bx = BETA * abs(x)
    w = P * BETA / (2 * KB) * np.exp(-bx) * (np.cos(bx) + np.sin(bx))
    m = P / (4 * BETA) * np.exp(-bx) * (np.cos(bx) - np.sin(bx))
    return w, m


def resolver(h, variante):
    n = int(round(40 * LC / h))
    if n % 2:
        n += 1
    L = n * h
    ndof = 2 * (n + 1)
    K = np.zeros((ndof, ndof))
    ke = EI / h**3 * np.array([[12, 6 * h, -12, 6 * h], [6 * h, 4 * h * h, -6 * h, 2 * h * h], [-12, -6 * h, 12, -6 * h], [6 * h, 2 * h * h, -6 * h, 4 * h * h]])
    kc = KB * h / 420 * np.array([[156, 22 * h, 54, -13 * h], [22 * h, 4 * h * h, 13 * h, -3 * h * h], [54, 13 * h, 156, -22 * h], [-13 * h, -3 * h * h, -22 * h, 4 * h * h]])
    for e in range(n):
        idx = [2 * e, 2 * e + 1, 2 * e + 2, 2 * e + 3]
        K[np.ix_(idx, idx)] += ke
        if variante == "consistente":
            K[np.ix_(idx, idx)] += kc
        else:
            K[2 * e, 2 * e] += KB * h / 2
            K[2 * e + 2, 2 * e + 2] += KB * h / 2
    f = np.zeros(ndof)
    c = n // 2
    f[2 * c] = P
    u = np.linalg.solve(K, f)
    # momento en el nudo de la carga, desde el elemento de su izquierda (esfuerzo de extremo)
    e = c - 1
    idx = [2 * e, 2 * e + 1, 2 * e + 2, 2 * e + 3]
    fe = ke @ u[idx] + (kc @ u[idx] if variante == "consistente" else 0)
    m0 = -fe[3]  # el esfuerzo de extremo j del elemento de la izquierda, con el signo de la flexión
    # momento a 2·l y a 3·l (a 1·l está junto al cero de M: βx = π/4), por la curvatura de Hermite en el nudo más cercano (elemento de la derecha)
    def m_en(d):
        j = c + int(round(d / h))
        idx = [2 * j, 2 * j + 1, 2 * j + 2, 2 * j + 3]
        a = u[idx]
        # curvatura en ξ = 0 del elemento j: (−6/h², −4/h, 6/h², −2/h)
        kap = np.dot([-6 / h**2, -4 / h, 6 / h**2, -2 / h], a)
        return -EI * kap, j * h - c * h
    return u[2 * c], m0, m_en(2 * LC), m_en(3 * LC)


print("# validacion/lc/hetenyi.py: viga sobre Winkler, carga puntual; errores frente a Hetényi")
print("h/l   | variante     | w0        | M0        | M a ~2 l  | M a ~3 l")
for hl in [1.0, 0.71, 0.5, 0.4, 0.27, 0.2, 0.1]:
    h = hl * LC
    for v in ["nudo", "consistente"]:
        w0, m0, (m1, x1), (m2, x2) = resolver(h, v)
        we, me = hetenyi(0)
        _, me1 = hetenyi(x1)
        _, me2 = hetenyi(x2)
        print(f"{hl:5.2f} | {v:12s} | {100*(w0/we-1):+7.2f} % | {100*(m0/me-1):+7.2f} % | {100*(m1/me1-1):+7.2f} % | {100*(m2/me2-1):+7.2f} %")
