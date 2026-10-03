"""EXP-07b — Dependencia de malla de la conexión puntual viga ⟂ muro (momento por flexión de placa)."""
from exp07_conexion import case_perp, P, L, Ec, Iz
d_ref = P * L**3 / (3 * Ec * Iz)
for n in (6, 12, 24):
    dt, dr, th, M = case_perp(n)
    print(f"malla {n:2d}x{n:2d} (h = {3/n:.3f} m): δ punta = {dt*1e3:.3f} mm ({dt/d_ref:.2f}·ref), giro del nudo = {th:.3e} rad")
