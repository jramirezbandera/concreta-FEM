"""EXP-01 — Convergencia de placa cuadrada (Quad3D = DKMQ y Plate3D = rectangular) en PyNite 3.2.0.

Casos:
  A  apoyada «dura», delgada a/t=100   (Quad, Rect)
  B  apoyada «blanda», delgada          (Quad)
  C  empotrada, delgada                 (Quad, Rect)
  D  apoyada dura, gruesa a/t=10        (Quad, Rect)  -> referencia Mindlin exacta
  E  apoyada dura, muy delgada a/t=1000 y 10000 (Quad) -> bloqueo por cortante
  F  apoyada dura, delgada, malla distorsionada 20 % y 40 % de h (Quad)

Salida: tabla por caso con error relativo de w_c, M_c (media nodal), M en centroide adyacente,
Qx en el centro del borde y Mxy en la esquina, + orden observado y GCI (Roache) con las 3 mallas finas.
"""
import sys
import json
import numpy as np
from common import (build_square_plate, solve, elem_moment, elem_shear, center_moment_nodal_avg,
                    center_moment_centroid, observed_order)
from refs import navier_ss, navier_ss_shear_twist

a = 1.0
E = 30e9
nu = 0.3
q = 10e3  # N/m2

ALPHA_SS = navier_ss(1, 1, .5, .5, nu)[0]          # 0.00406235
BETA_SS = navier_ss(1, 1, .5, .5, nu)[1]           # 0.04788638
QX_EDGE = navier_ss_shear_twist(1, 1, 0, .5, nu, 801)[0]   # 0.3374
MXY_CORNER = navier_ss_shear_twist(1, 1, 0, 0, nu, 801)[1]  # -0.03248
# Empotrada: Taylor & Govindjee (2004) / T&WK Tabla 35 (nu = 0.3)
ALPHA_CC = 0.00126532
BETA_CC_C = 0.0229051
BETA_CC_E = -0.0513338

MESHES = [int(x) for x in (sys.argv[1].split(",") if len(sys.argv) > 1 else "2,4,8,16,32".split(","))]


def mindlin_alpha(ah):
    w, mx, my = navier_ss(1, 1, .5, .5, nu)
    h = 1 / ah
    D = h**3 / (12 * (1 - nu**2))
    G = 1 / (2 * (1 + nu))
    return w + D * (mx + my) / (1 + nu) / (5 / 6 * G * h)


def run_case(label, bc, elem, ah, distort=0.0, ref_w=None, ref_m=None, ref_edge=None):
    t = a / ah
    D = E * t**3 / (12 * (1 - nu**2))
    rows = []
    for n in MESHES:
        if n < 2:
            continue
        m = build_square_plate(n, a, t, E, nu, q, bc, elem, distort=distort)
        dt = solve(m)
        c = n // 2
        w = m.nodes[f"N_{c}_{c}"].DZ["C"] * D / (q * a**4)
        Mavg, _ = center_moment_nodal_avg(m, n, elem)
        Mc = Mavg[0] / (q * a * a)
        Mcen = center_moment_centroid(m, n, elem)[0] / (q * a * a)
        h = a / n
        # referencia en el centroide del elemento E_c_c (sólo malla regular, apoyada)
        mcen_ref = navier_ss(1, 1, .5 + h / 2, .5 + h / 2, nu, 201)[1] if bc.startswith("ss") else None
        # Qx en el centro del borde x = 0 (media de los dos elementos que comparten el nudo)
        q1 = elem_shear(m, f"E_0_{c-1}", -1, 1, elem)[0]
        q2 = elem_shear(m, f"E_0_{c}", -1, -1, elem)[0]
        Qx = 0.5 * (q1 + q2) / (q * a)
        Mxy_corner = elem_moment(m, "E_0_0", -1, -1, elem)[2] / (q * a * a)
        # momento en el centro del borde (empotrada)
        me1 = elem_moment(m, f"E_0_{c-1}", -1, 1, elem)[0]
        me2 = elem_moment(m, f"E_0_{c}", -1, -1, elem)[0]
        Medge = 0.5 * (me1 + me2) / (q * a * a)
        rows.append(dict(n=n, w=w, Mc=Mc, Mcen=Mcen, mcen_ref=mcen_ref, Qx=Qx, Mxy=Mxy_corner,
                         Medge=Medge, t=dt, ndof=6 * (n + 1) ** 2))
    print(f"\n### {label}  (bc={bc}, elem={elem}, a/t={ah}, distorsión={distort})")
    print(f"ref w*D/(q a^4) = {ref_w:.6f}   ref M = {ref_m}   ref borde = {ref_edge}")
    print(" n  | w/ref-1 %  | Mc(nodal) | Mc/ref-1 % | Mcentroide/ref_loc-1 % | Qx_borde (ref 0.3374) | Mxy_esq (ref ±0.0325) | M_borde | t[s]")
    for r in rows:
        ew = (abs(r["w"]) / ref_w - 1) * 100
        em = (abs(r["Mc"]) / abs(ref_m) - 1) * 100 if ref_m else float("nan")
        ecen = (abs(r["Mcen"]) / abs(r["mcen_ref"]) - 1) * 100 if r["mcen_ref"] else float("nan")
        print(f"{r['n']:3d} | {ew:+9.3f} | {r['Mc']:+.5f} | {em:+9.3f} | {ecen:+9.3f} | {r['Qx']:+.4f} | {r['Mxy']:+.5f} | {r['Medge']:+.5f} | {r['t']:.2f}")
    if len(rows) >= 3:
        f1, f2, f3 = (abs(rows[-1]["w"]), abs(rows[-2]["w"]), abs(rows[-3]["w"]))
        p, fext, gci = observed_order(f1, f2, f3)
        print(f"  w: orden observado p = {p:.2f}; Richardson = {fext:.7f} ({(fext/ref_w-1)*100:+.4f} % vs ref); GCI_fino = {gci*100:.4f} %")
        f1, f2, f3 = (abs(rows[-1]["Mc"]), abs(rows[-2]["Mc"]), abs(rows[-3]["Mc"]))
        p, fext, gci = observed_order(f1, f2, f3)
        if ref_m:
            print(f"  Mc: orden observado p = {p:.2f}; Richardson = {fext:.7f} ({(fext/abs(ref_m)-1)*100:+.4f} % vs ref); GCI_fino = {gci*100:.4f} %")
    sys.stdout.flush()
    return rows


if __name__ == "__main__":
    which = sys.argv[2] if len(sys.argv) > 2 else "ABCDEF"
    out = {}
    if "A" in which:
        out["A_quad"] = run_case("A. Apoyada dura, a/t=100, Quad3D", "ss_hard", "Quad", 100, ref_w=mindlin_alpha(100), ref_m=BETA_SS)
        out["A_rect"] = run_case("A. Apoyada dura, a/t=100, Plate3D", "ss_hard", "Rect", 100, ref_w=ALPHA_SS, ref_m=BETA_SS)
    if "B" in which:
        out["B_quad"] = run_case("B. Apoyada blanda, a/t=100, Quad3D", "ss_soft", "Quad", 100, ref_w=mindlin_alpha(100), ref_m=BETA_SS)
        out["B_rect"] = run_case("B. Apoyada blanda, a/t=100, Plate3D", "ss_soft", "Rect", 100, ref_w=ALPHA_SS, ref_m=BETA_SS)
    if "C" in which:
        out["C_quad"] = run_case("C. Empotrada, a/t=100, Quad3D", "clamped", "Quad", 100, ref_w=ALPHA_CC, ref_m=BETA_CC_C, ref_edge=BETA_CC_E)
        out["C_rect"] = run_case("C. Empotrada, a/t=100, Plate3D", "clamped", "Rect", 100, ref_w=ALPHA_CC, ref_m=BETA_CC_C, ref_edge=BETA_CC_E)
    if "D" in which:
        out["D_quad"] = run_case("D. Apoyada dura, a/t=10, Quad3D (ref Mindlin)", "ss_hard", "Quad", 10, ref_w=mindlin_alpha(10), ref_m=BETA_SS)
        out["D_rect"] = run_case("D. Apoyada dura, a/t=10, Plate3D (ref Mindlin)", "ss_hard", "Rect", 10, ref_w=mindlin_alpha(10), ref_m=BETA_SS)
    if "E" in which:
        out["E_quad_1000"] = run_case("E. Apoyada dura, a/t=1000, Quad3D", "ss_hard", "Quad", 1000, ref_w=mindlin_alpha(1000), ref_m=BETA_SS)
        out["E_quad_10000"] = run_case("E. Apoyada dura, a/t=10000, Quad3D", "ss_hard", "Quad", 10000, ref_w=mindlin_alpha(10000), ref_m=BETA_SS)
    if "F" in which:
        out["F_quad_20"] = run_case("F. Apoyada dura, a/t=100, Quad3D, distorsión 0.2h", "ss_hard", "Quad", 100, distort=0.2, ref_w=mindlin_alpha(100), ref_m=BETA_SS)
        out["F_quad_40"] = run_case("F. Apoyada dura, a/t=100, Quad3D, distorsión 0.4h", "ss_hard", "Quad", 100, distort=0.4, ref_w=mindlin_alpha(100), ref_m=BETA_SS)
    json.dump(out, open(f"out_exp01_{which}.json", "w"), indent=1, default=float)
