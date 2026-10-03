"""EXP-08 — OpenSeesPy 3.8.0 (Python 3.12) como referencia FEM independiente en Windows.

(1) Placa cuadrada apoyada «dura» a/t=100, nu=0.3: w_c y M en el centroide del elemento adyacente al centro
    con ShellMITC4, ShellDKGQ y ASDShellQ4. Mismas mallas que EXP-01.
(2) Viga de MacNeal-Harder (6x1) cortante en el plano: ShellMITC4 / ShellDKGQ / ASDShellQ4 frente a 0.1081.
(3) Muro 3x9 m malla 1x3 y 4x12: comparación con Quad3D.
"""
import sys
import time
import openseespy.opensees as ops
from refs import navier_ss

ELEMS = ("ShellMITC4", "ShellDKGQ", "ASDShellQ4")


def plate(n, elem, a=1.0, t=0.01, E=30e9, nu=0.3, q=10e3):
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    ops.section("ElasticMembranePlateSection", 1, E, nu, t, 0.0)
    tag = lambda i, j: i * (n + 1) + j + 1
    h = a / n
    for i in range(n + 1):
        for j in range(n + 1):
            ops.node(tag(i, j), i * h, j * h, 0.0)
            on_x, on_y = i in (0, n), j in (0, n)
            edge = on_x or on_y
            ops.fix(tag(i, j), 1, 1, 1 if edge else 0, 1 if on_x else 0, 1 if on_y else 0, 1)
    e = 1
    for i in range(n):
        for j in range(n):
            ops.element(elem, e, tag(i, j), tag(i + 1, j), tag(i + 1, j + 1), tag(i, j + 1), 1)
            e += 1
    ops.timeSeries("Linear", 1)
    ops.pattern("Plain", 1, 1)
    for i in range(n + 1):
        for j in range(n + 1):
            f = q * h * h * (0.5 if i in (0, n) else 1) * (0.5 if j in (0, n) else 1)
            ops.load(tag(i, j), 0, 0, f, 0, 0, 0)
    ops.system("UmfPack")
    ops.numberer("RCM")
    ops.constraints("Plain")
    ops.integrator("LoadControl", 1.0)
    ops.algorithm("Linear")
    ops.analysis("Static")
    ops.analyze(1)
    D = E * t**3 / (12 * (1 - nu**2))
    c = n // 2
    w = ops.nodeDisp(tag(c, c), 3) * D / (q * a**4)
    # elemento adyacente al centro (i=c, j=c): media de los 4 puntos de Gauss de M11
    etag = c * n + c + 1
    s = ops.eleResponse(etag, "stresses")
    m11 = sum(s[3 + 8 * k] for k in range(4)) / 4 / (q * a * a)
    return w, m11


def mh_cantilever(elem):
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    ops.section("ElasticMembranePlateSection", 1, 1e7, 0.3, 0.1, 0.0)
    for i in range(7):
        ops.node(i + 1, float(i), 0.0, 0.0)
        ops.node(i + 101, float(i), 0.2, 0.0)
    for i in range(6):
        ops.element(elem, i + 1, i + 1, i + 2, i + 102, i + 101, 1)
    ops.fix(1, 1, 1, 1, 1, 1, 1)
    ops.fix(101, 1, 1, 1, 1, 1, 1)
    ops.timeSeries("Linear", 1)
    ops.pattern("Plain", 1, 1)
    ops.load(7, 0, 0.5, 0, 0, 0, 0)
    ops.load(107, 0, 0.5, 0, 0, 0, 0)
    ops.system("UmfPack"); ops.numberer("RCM"); ops.constraints("Plain")
    ops.integrator("LoadControl", 1.0); ops.algorithm("Linear"); ops.analysis("Static"); ops.analyze(1)
    return 0.5 * (ops.nodeDisp(7, 2) + ops.nodeDisp(107, 2)) / 0.1081


def wall(nx, ny, elem, H=9.0, B=3.0, t=0.25, E=30e9, nu=0.2, P=100e3):
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    ops.section("ElasticMembranePlateSection", 1, E, nu, t, 0.0)
    tag = lambda i, j: i * (ny + 1) + j + 1
    for i in range(nx + 1):
        for j in range(ny + 1):
            ops.node(tag(i, j), B * i / nx, H * j / ny, 0.0)
            base = 1 if j == 0 else 0
            ops.fix(tag(i, j), base, base, 1, 1, 1, base)
    e = 1
    for i in range(nx):
        for j in range(ny):
            ops.element(elem, e, tag(i, j), tag(i + 1, j), tag(i + 1, j + 1), tag(i, j + 1), 1)
            e += 1
    ops.timeSeries("Linear", 1)
    ops.pattern("Plain", 1, 1)
    for i in range(nx + 1):
        ops.load(tag(i, ny), P * (0.5 if i in (0, nx) else 1) / nx, 0, 0, 0, 0, 0)
    ops.system("UmfPack"); ops.numberer("RCM"); ops.constraints("Plain")
    ops.integrator("LoadControl", 1.0); ops.algorithm("Linear"); ops.analysis("Static"); ops.analyze(1)
    return sum(ops.nodeDisp(tag(i, ny), 1) for i in range(nx + 1)) / (nx + 1)


if __name__ == "__main__":
    print("OpenSees version:", ops.version() if hasattr(ops, "version") else "?")
    alpha = navier_ss(1, 1, .5, .5, 0.3)[0]
    for elem in ELEMS:
        print(f"\n== Placa apoyada a/t=100 con {elem}: w/ref-1 y M centroide/ref_loc-1")
        for n in (4, 8, 16, 32):
            t0 = time.perf_counter()
            w, m11 = plate(n, elem)
            h = 1 / n
            mref = navier_ss(1, 1, .5 + h / 2, .5 + h / 2, 0.3, 201)[1]
            print(f"  n={n:2d}: w {(w/alpha-1)*100:+.3f} % | M11 {(abs(m11)/mref-1)*100:+.3f} % (signo {'+' if m11 > 0 else '-'}) | {time.perf_counter()-t0:.2f} s")
    print("\n== Viga de MacNeal-Harder, cortante en el plano (malla 6x1 rectangular), normalizado a 0.1081")
    for elem in ELEMS:
        print(f"  {elem}: {mh_cantilever(elem):.4f}")
    print("\n== Muro H=9, B=3 (Timoshenko 1.5552 mm)")
    for elem in ELEMS:
        print(f"  {elem}: 1x3 {wall(1,3,elem)*1e3:.4f} mm | 4x12 {wall(4,12,elem)*1e3:.4f} mm | 16x48 {wall(16,48,elem)*1e3:.4f} mm")
