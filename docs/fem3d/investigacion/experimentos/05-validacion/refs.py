"""Valores de referencia analíticos para los benchmarks (sin PyNite).

- Placa rectangular simplemente apoyada (Kirchhoff), carga uniforme: serie de Navier
  (Timoshenko & Woinowsky-Krieger, 1959, §30, ec. 137-139; Tabla 8).
- Mindlin, placa poligonal simplemente apoyada (apoyo «duro»): relación exacta
  w_M = w_K + M_K/(kappa*G*h), M_K = (Mx+My)/(1+nu) (Wang, Reddy & Lee 2000, cap. 9).
"""
from math import pi, sin


def navier_ss(a, b, x, y, nu, terms=401):
    """Devuelve (w*D/q, Mx/q, My/q) en (x,y) de una placa a x b apoyada con q uniforme."""
    w = mx = my = 0.0
    for m in range(1, terms, 2):
        for n in range(1, terms, 2):
            am = m * pi / a
            bn = n * pi / b
            qmn = 16.0 / (pi**2 * m * n)
            den = (am**2 + bn**2) ** 2
            s = sin(am * x) * sin(bn * y)
            w += qmn / den * s
            mx += qmn / den * (am**2 + nu * bn**2) * s
            my += qmn / den * (nu * am**2 + bn**2) * s
    return w, mx, my


if __name__ == "__main__":
    a = b = 1.0
    for nu in (0.3, 0.0, 0.2):
        w, mx, my = navier_ss(a, b, a / 2, b / 2, nu)
        print(f"nu={nu}: alpha=w*D/(q a^4)={w:.8f}  beta=Mx/(q a^2)={mx:.8f}  My={my:.8f}")
    # Mindlin (kappa=5/6), a/h = 10 y 100, nu = 0.3
    nu = 0.3
    w, mx, my = navier_ss(1, 1, 0.5, 0.5, nu)
    for ah in (10, 100, 5):
        h = 1 / ah
        E = 1.0
        D = E * h**3 / (12 * (1 - nu**2))
        G = E / (2 * (1 + nu))
        MK = (mx + my) / (1 + nu)
        wM = w / D + MK / (5 / 6 * G * h)  # para q = 1, a = 1
        print(f"a/h={ah}: w_Mindlin*D/(q a^4) = {wM*D:.8f}  (Kirchhoff {w:.8f}, +{(wM*D/w-1)*100:.3f} %)")


def navier_ss_shear_twist(a, b, x, y, nu, terms=2001):
    """(Qx/q, Mxy/q) en (x, y): Qx = -D d(lap w)/dx ; Mxy = -D (1-nu) w_xy (convención T&WK)."""
    qx = mxy = 0.0
    for m in range(1, terms, 2):
        for n in range(1, terms, 2):
            am = m * pi / a
            bn = n * pi / b
            qmn = 16.0 / (pi**2 * m * n)
            lam = am**2 + bn**2
            qx += qmn * am / lam * __import__("math").cos(am * x) * sin(bn * y)
            mxy += -(1 - nu) * qmn / lam**2 * am * bn * __import__("math").cos(am * x) * __import__("math").cos(bn * y)
    return qx, mxy


if __name__ == "__main__":
    qx, _ = navier_ss_shear_twist(1, 1, 0.0, 0.5, 0.3, terms=801)
    _, mxy = navier_ss_shear_twist(1, 1, 0.0, 0.0, 0.3, terms=801)
    print(f"Qx(0, b/2)/(q a) = {qx:.5f}  (T&WK Tabla 8: 0.338)   Mxy(0,0)/(q a^2) = {mxy:.5f} (R esquina = 2Mxy = {2*abs(mxy):.4f}; T&WK 0.065)")
