"""EXP-05 — Barras (Member3D) frente a soluciones cerradas de Euler-Bernoulli + St Venant.

1. Voladizo 3D (eje X) con cargas en punta: FY, FZ, FX, MX.
2. Viga biapoyada con carga uniforme: M centro, flecha centro y diagrama en estaciones.
3. Pórtico espacial de 1 vano x 1 vano (2 pórticos planos + vigas transversales), carga horizontal:
   desplome y momento en base (pendiente-desplazamiento, columnas y vigas inextensibles).
4. Voladizo en L (emparrillado) con carga vertical en punta: flexión + torsión acopladas.
5. Trípode (celosía espacial) con carga vertical.
6. Pilar «casi vertical» (ruido 1e-12 en X o Z): orientación de ejes locales.
7. Viga de gran canto: lo que se pierde al no tener deformación por cortante.
"""
import math
import numpy as np
from Pynite import FEModel3D
from common import quiet

E, G = 210e9, 81e9
A, Iy, Iz, J = 5e-3, 2e-5, 8e-5, 1e-6


def rel(a, b):
    return (a - b) / b


def cantilever():
    m = FEModel3D()
    m.add_material("S", E, G, 0.3, 0)
    m.add_section("S1", A, Iy, Iz, J)
    L = 4.0
    m.add_node("A", 0, 0, 0)
    m.add_node("B", L, 0, 0)
    m.add_member("M", "A", "B", "S", "S1")
    m.def_support("A", True, True, True, True, True, True)
    P, T = 1e3, 2e3
    m.add_node_load("B", "FY", P, "Y")
    m.add_node_load("B", "FZ", P, "Z")
    m.add_node_load("B", "FX", P, "X")
    m.add_node_load("B", "MX", T, "T")
    for c in "YZXT":
        m.add_load_combo(c, {c: 1.0})
    quiet(m.analyze_linear)
    B = m.nodes["B"]
    out = {
        "δy = PL³/3EIz": rel(B.DY["Y"], P * L**3 / (3 * E * Iz)),
        "θz = PL²/2EIz": rel(B.RZ["Y"], P * L**2 / (2 * E * Iz)),
        "δz = PL³/3EIy": rel(B.DZ["Z"], P * L**3 / (3 * E * Iy)),
        "δx = PL/EA": rel(B.DX["X"], P * L / (E * A)),
        "φx = TL/GJ": rel(B.RX["T"], T * L / (G * J)),
        "Mz(0) = PL": rel(abs(m.members["M"].moment("Mz", 0.0, "Y")), P * L),
        "My(0) = PL": rel(abs(m.members["M"].moment("My", 0.0, "Z")), P * L),
        "T(x) = T": rel(abs(m.members["M"].torque(1.0, "T")), T),
    }
    return out, {"Mz(0) bruto (carga +FY)": m.members["M"].moment("Mz", 0.0, "Y"),
                 "My(0) bruto (carga +FZ)": m.members["M"].moment("My", 0.0, "Z"),
                 "Fy(0) bruto (carga +FY)": m.members["M"].shear("Fy", 0.0, "Y"),
                 "Fz(0) bruto (carga +FZ)": m.members["M"].shear("Fz", 0.0, "Z"),
                 "N bruto (carga +FX, tracción)": m.members["M"].axial(1.0, "X"),
                 "T bruto (MX +)": m.members["M"].torque(1.0, "T")}


def ss_beam():
    m = FEModel3D()
    m.add_material("S", E, G, 0.3, 0)
    m.add_section("S1", A, Iy, Iz, J)
    L, w = 6.0, 10e3
    m.add_node("A", 0, 0, 0)
    m.add_node("B", L, 0, 0)
    m.add_member("M", "A", "B", "S", "S1")
    m.def_support("A", True, True, True, True, False, False)
    m.def_support("B", False, True, True, False, False, False)
    m.add_member_dist_load("M", "FY", -w, -w, case="D")
    m.add_load_combo("C", {"D": 1.0})
    quiet(m.analyze_linear)
    mem = m.members["M"]
    xs, Ms = mem.moment_array("Mz", 7, "C")
    exact = [w * x * (L - x) / 2 for x in xs]
    err = max(abs(abs(a) - b) for a, b in zip(Ms, exact)) / (w * L**2 / 8)
    return {"M(L/2) = wL²/8": rel(abs(mem.moment("Mz", L / 2, "C")), w * L**2 / 8),
            "δ(L/2) = 5wL⁴/384EI": rel(abs(mem.deflection("dy", L / 2, "C")), 5 * w * L**4 / (384 * E * Iz)),
            "max|M(x)-exacto|/Mmax en 7 estaciones": err,
            "ΣR = wL": rel(m.nodes["A"].RxnFY["C"] + m.nodes["B"].RxnFY["C"], w * L)}, mem.moment("Mz", L / 2, "C")


def portal3d(k=2.0):
    """Pórtico 1x1 vano en planta (Y vertical en PyNite). Carga H en X en cada pórtico."""
    h, Lb, Lt = 3.0, 5.0, 4.0
    Ic = 1e-4
    Ib = k * Ic * Lb / h  # k = (Ib/Lb)/(Ic/h)
    Abig = 10.0  # inextensible
    m = FEModel3D()
    m.add_material("C", 30e9, 12.5e9, 0.2, 0)
    m.add_section("COL", Abig, Ic, Ic, 1e-3)
    m.add_section("BEAM", Abig, Ib, Ib, 1e-3)
    for zi, z in enumerate((0.0, Lt)):
        for xi, x in enumerate((0.0, Lb)):
            m.add_node(f"B{xi}{zi}", x, 0, z)
            m.add_node(f"T{xi}{zi}", x, h, z)
            m.add_member(f"C{xi}{zi}", f"B{xi}{zi}", f"T{xi}{zi}", "C", "COL")
            m.def_support(f"B{xi}{zi}", True, True, True, True, True, True)
        m.add_member(f"BX{zi}", f"T0{zi}", f"T1{zi}", "C", "BEAM")
    for xi in (0, 1):
        m.add_member(f"BZ{xi}", f"T{xi}0", f"T{xi}1", "C", "BEAM")
    H = 100e3
    for zi in (0, 1):
        m.add_node_load(f"T0{zi}", "FX", H, "W")
    m.add_load_combo("C", {"W": 1.0})
    quiet(m.analyze_linear)
    EIc = 30e9 * Ic
    delta = H * h**3 * (2 + 3 * k) / (12 * EIc * (1 + 6 * k))
    ic = EIc / h
    theta = 3 * ic * delta / (h * (2 * ic + 3 * k * ic))
    M_base = 2 * ic * (theta - 3 * delta / h)
    d_fe = m.nodes["T000".replace("T000", "T00")].DX["C"]
    Mb_fe = m.nodes["B00"].RxnMZ["C"]
    sumF = sum(nd.RxnFX["C"] for nd in m.nodes.values())
    # momento global respecto al origen de reacciones + cargas (eje Z)
    momZ = 0.0
    for nd in m.nodes.values():
        momZ += nd.RxnMZ["C"] - nd.Y * nd.RxnFX["C"] + nd.X * nd.RxnFY["C"]
    momZ += -h * 2 * H
    return {"Δ (pendiente-desplazamiento)": rel(d_fe, delta),
            "|M base| (pendiente-desplazamiento)": rel(abs(Mb_fe), abs(M_base)),
            "ΣFx reacciones + cargas (rel)": (sumF + 2 * H) / (2 * H),
            "ΣMz global (rel a H·h)": momZ / (2 * H * h)}


def bent_cantilever():
    """Voladizo en L en el plano horizontal XZ (Y vertical): tramo 1 por X (a), tramo 2 por Z (b), carga -Y en punta."""
    a, b, P = 3.0, 2.0, 5e3
    m = FEModel3D()
    m.add_material("S", E, G, 0.3, 0)
    m.add_section("S1", A, Iy, Iz, J)
    m.add_node("O", 0, 0, 0)
    m.add_node("K", a, 0, 0)
    m.add_node("T", a, 0, b)
    m.add_member("M1", "O", "K", "S", "S1")
    m.add_member("M2", "K", "T", "S", "S1")
    m.def_support("O", True, True, True, True, True, True)
    m.add_node_load("T", "FY", -P, "P")
    m.add_load_combo("C", {"P": 1.0})
    quiet(m.analyze_linear)
    # Y vertical: flexión por la carga vertical en barras horizontales -> eje fuerte Iz (y local vertical)
    d = P * a**3 / (3 * E * Iz) + P * b**3 / (3 * E * Iz) + P * b**2 * a / (G * J)
    return {"δ punta = Pa³/3EI + Pb³/3EI + Pb²a/GJ": rel(-m.nodes["T"].DY["C"], d),
            "T en tramo 1 = P·b": rel(abs(m.members["M1"].torque(1.0, "C")), P * b)}


def tripod():
    """Tres barras articuladas desde la base a un vértice; carga vertical P en el vértice."""
    R, h, P = 2.0, 3.0, 30e3
    Ab = 1e-3
    m = FEModel3D()
    m.add_material("S", E, G, 0.3, 0)
    m.add_section("B", Ab, 1e-6, 1e-6, 1e-6)
    m.add_node("V", 0, h, 0)
    for k in range(3):
        ang = 2 * math.pi * k / 3
        m.add_node(f"S{k}", R * math.cos(ang), 0, R * math.sin(ang))
        m.add_member(f"B{k}", f"S{k}", "V", "S", "B")
        m.def_releases(f"B{k}", False, False, False, False, True, True, False, False, False, True, True, True)
        m.def_support(f"S{k}", True, True, True, True, True, True)
    # el vértice sólo tiene rigidez traslacional: coartar sus giros
    m.def_support("V", False, False, False, True, True, True)
    m.add_node_load("V", "FY", -P, "P")
    m.add_load_combo("C", {"P": 1.0})
    quiet(m.analyze_linear)
    L = math.hypot(R, h)
    cosb = h / L
    N = P / (3 * cosb)
    dv = P * L / (3 * E * Ab * cosb**2)
    return {"N = P/(3 cosβ)": rel(abs(m.members["B0"].axial(L / 2, "C")), N),
            "δv = PL/(3EA cos²β)": rel(-m.nodes["V"].DY["C"], dv)}


def near_vertical(noise_axis, noise=1e-12):
    """Pilar de sección rectangular (Iz >> Iy) y 3 m; carga horizontal en X en cabeza."""
    m = FEModel3D()
    m.add_material("C", 30e9, 12.5e9, 0.2, 0)
    m.add_section("R", 0.12, 0.3 * 0.4**3 / 12, 0.4 * 0.3**3 / 12, 1e-3)  # Iy = 1.6e-3, Iz = 0.9e-3
    dx = noise if noise_axis == "X" else 0.0
    dz = noise if noise_axis == "Z" else 0.0
    m.add_node("B", 0, 0, 0)
    m.add_node("T", dx, 3.0, dz)
    m.add_member("P", "B", "T", "C", "R")
    m.def_support("B", True, True, True, True, True, True)
    m.add_node_load("T", "FX", 10e3, "H")
    m.add_load_combo("C", {"H": 1.0})
    quiet(m.analyze_linear)
    T = m.members["P"].T()[:3, :3]
    return m.nodes["T"].DX["C"], T


def deep_beam_shear(L_over_h):
    """Pérdida por no modelar deformación por cortante: viga biempotrada con carga centrada."""
    b, h = 0.3, 0.6
    L = L_over_h * h
    Ec, nu = 30e9, 0.2
    Gc = Ec / (2 * (1 + nu))
    I = b * h**3 / 12
    Av = 5 / 6 * b * h
    P = 100e3
    db = P * L**3 / (192 * Ec * I)
    ds = P * L / (4 * Gc * Av)
    return ds / (db + ds)


if __name__ == "__main__":
    print("== 1. Voladizo: error relativo")
    o, raw = cantilever()
    for k, v in o.items():
        print(f"  {k:28s} {v:+.2e}")
    print("  signos brutos:", {k: round(v, 3) for k, v in raw.items()})
    print("== 2. Biapoyada")
    o, mraw = ss_beam()
    for k, v in o.items():
        print(f"  {k:40s} {v:+.2e}")
    print(f"  signo bruto de Mz(L/2) con carga gravitatoria (-Y): {mraw:+.1f}")
    for k in (0.1, 1.0, 10.0):
        print(f"== 3. Pórtico espacial k = {k}")
        for kk, v in portal3d(k).items():
            print(f"  {kk:40s} {v:+.2e}")
    print("== 4. Voladizo en L (flexión + torsión)")
    for k, v in bent_cantilever().items():
        print(f"  {k:40s} {v:+.2e}")
    print("== 5. Trípode")
    for k, v in tripod().items():
        print(f"  {k:40s} {v:+.2e}")
    print("== 6. Pilar 'vertical' con ruido numérico en la coordenada de cabeza (carga 10 kN en X)")
    for ax, nz in (("X", 0.0), ("X", 1e-12), ("Z", 1e-12), ("Z", 1e-9)):
        d, T = near_vertical(ax, nz)
        print(f"  ruido {nz:g} en {ax}: δx = {d*1e3:.4f} mm; eje local y = {np.round(T[1], 3)}, z = {np.round(T[2], 3)}")
    print("== 7. Fracción de la flecha debida al cortante (biempotrada, carga centrada, 30x60, nu=0.2)")
    for r in (2, 4, 8, 12, 20):
        print(f"  L/h = {r:2d}: {deep_beam_shear(r)*100:.1f} % de la flecha total no la ve Member3D")
