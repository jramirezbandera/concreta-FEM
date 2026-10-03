"""EXP-07 — Conexión barra–lámina en PyNite 3.2.0: ¿se transmite el momento?

Muro 3 x 3 m (plano XY, Y vertical en PyNite), e = 0.25 m, base empotrada, malla 6x6.
Viga 0.30 x 0.50 m de 3 m, en voladizo desde el borde derecho del muro a media altura, carga P = 50 kN (-Y) en punta.
  (a) EN EL PLANO del muro: el momento de empotramiento de la viga es un giro alrededor de Z = giro de TALADRO
      del muro (sólo existe el muelle débil de PyNite, 1/1000 de la rigidez rotacional mínima).
  (b) Igual, pero con la viga «embebida»: se prolonga dentro del muro sobre la fila de nudos (1 elemento y todo el ancho).
  (c) PERPENDICULAR al muro (viga en Z): el momento entra por flexión de placa (giro alrededor de X).
Referencia: viga empotrada en apoyo rígido δ = PL³/3EI (+ la flexibilidad del muro, pequeña).
"""
import numpy as np
from Pynite import FEModel3D
from common import quiet

Ec, nu = 30e9, 0.2
b, h, L, P = 0.30, 0.50, 3.0, 50e3
Iz = b * h**3 / 12   # flexión vertical (eje local z de PyNite horizontal)
Iy = h * b**3 / 12


def wall_model(n=6, W=3.0, H=3.0, t=0.25):
    m = FEModel3D()
    m.add_material("C", Ec, Ec / (2 * (1 + nu)), nu, 0)
    m.add_section("V", b * h, Iy, Iz, 3e-3)
    for i in range(n + 1):
        for j in range(n + 1):
            m.add_node(f"W_{i}_{j}", W * i / n, H * j / n, 0.0)
    for i in range(n):
        for j in range(n):
            m.add_quad(f"Q_{i}_{j}", f"W_{i}_{j}", f"W_{i+1}_{j}", f"W_{i+1}_{j+1}", f"W_{i}_{j+1}", t, "C")
    for i in range(n + 1):
        m.def_support(f"W_{i}_0", True, True, True, True, True, True)
    return m


def case_inplane(embed=0, n=6):
    m = wall_model(n)
    j = n // 2
    m.add_node("TIP", 3.0 + L, 1.5, 0.0)
    m.add_member("VIGA", f"W_{n}_{j}", "TIP", "C", "V")
    for k in range(embed):  # prolongación dentro del muro sobre nudos existentes
        m.add_member(f"EMB{k}", f"W_{n-k-1}_{j}", f"W_{n-k}_{j}", "C", "V")
    m.add_node_load("TIP", "FY", -P, "P")
    m.add_load_combo("C", {"P": 1.0})
    quiet(m.analyze_linear)
    d_tip = -m.nodes["TIP"].DY["C"]
    d_root = -m.nodes[f"W_{n}_{j}"].DY["C"]
    th_root = m.nodes[f"W_{n}_{j}"].RZ["C"]
    M_root = m.members["VIGA"].moment("Mz", 0.0, "C")
    return d_tip, d_root, th_root, M_root


def case_perp(n=6):
    m = wall_model(n)
    j = n // 2
    i = n // 2
    m.add_node("TIP", 1.5, 1.5, L)
    m.add_member("VIGA", f"W_{i}_{j}", "TIP", "C", "V")
    m.add_node_load("TIP", "FY", -P, "P")
    m.add_load_combo("C", {"P": 1.0})
    quiet(m.analyze_linear)
    return -m.nodes["TIP"].DY["C"], -m.nodes[f"W_{i}_{j}"].DY["C"], m.nodes[f"W_{i}_{j}"].RX["C"], m.members["VIGA"].moment("Mz", 0.0, "C")


if __name__ == "__main__":
    d_ref = P * L**3 / (3 * Ec * Iz)
    print(f"Referencia viga empotrada en apoyo rígido: δ = {d_ref*1e3:.3f} mm, M_emp = {P*L/1e3:.1f} kN·m")
    for emb, lab in ((0, "(a) en el plano, conexión en 1 nudo (taladro)"), (1, "(b1) en el plano, embebida 1 elemento"), (6, "(b2) en el plano, embebida todo el ancho")):
        for n in (6, 12):
            if emb == 6 and n == 12:
                emb_n = 12
            else:
                emb_n = emb
            dt, dr, th, M = case_inplane(emb_n, n)
            print(f"{lab:48s} malla {n:2d}: δ punta = {dt*1e3:9.3f} mm ({dt/d_ref:7.2f}·ref); δ raíz = {dr*1e3:.3f} mm; giro raíz = {th:.2e} rad; M raíz viga = {M/1e3:+.2f} kN·m")
    dt, dr, th, M = case_perp()
    print(f"{'(c) perpendicular al muro (flexión de placa)':48s} malla  6: δ punta = {dt*1e3:9.3f} mm ({dt/d_ref:7.2f}·ref); δ raíz = {dr*1e3:.3f} mm; giro raíz = {th:.2e} rad; M raíz viga = {M/1e3:+.2f} kN·m")
