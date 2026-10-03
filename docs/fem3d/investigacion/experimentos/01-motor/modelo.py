"""Generador de edificios de prueba para PyNite (FEModel3D), en SI (N, m, Pa).

Convención de entrada: la de Concreta (Z vertical hacia arriba, dextrógiro).
Opción `yup=True`: se mapea a Y-up de PyNite con la permutación cíclica
(Xp, Yp, Zp) = (Yc, Zc, Xc), que conserva la orientación (dextrógira).

Malla: cada planta tiene una retícula de nudos con paso <= `s` que incluye las
líneas de pórtico; las vigas se crean ENTRE NUDOS CONSECUTIVOS (como haría el
compilador de Concreta), así que ningún PhysMember se subdivide.
"""
from __future__ import annotations
import math

E_C = 30e9
NU_C = 0.2
G_C = E_C / (2 * (1 + NU_C))
GAMMA_C = 25000.0  # N/m3 (peso específico: PyNite usa rho*A como carga lineal)


def axis_coords(n_bays: int, L: float, s: float) -> list[float]:
    nsub = max(1, math.ceil(L / s - 1e-9))
    out = []
    for b in range(n_bays):
        for k in range(nsub):
            out.append(round(b * L + k * L / nsub, 9))
    out.append(round(n_bays * L, 9))
    return out


def build(model_cls, nx=2, ny=2, storeys=2, Lx=6.0, Ly=5.0, h=3.0, s=1.0,
          slabs=True, t=0.25, q_G=-3000.0, q_Q=-2000.0, F_W=10000.0,
          yup=False, member_self_weight=True):
    m = model_cls()
    m.add_material('HA', E_C, G_C, NU_C, GAMMA_C)
    # pilar 30x30, viga 30x50 (b x h); Iz fuerte en el convenio "Y-up" de PyNite
    b, hh = 0.30, 0.30
    m.add_section('P30', b * hh, b * hh**3 / 12, hh * b**3 / 12, 0.141 * b**4)
    b, hh = 0.30, 0.50
    J = 0.229 * b**3 * hh  # aprox. torsión rectangular h/b=1.67
    m.add_section('V3050', b * hh, hh * b**3 / 12, b * hh**3 / 12, J)

    xs = axis_coords(nx, Lx, s)
    ys = axis_coords(ny, Ly, s)
    gx = [i * Lx for i in range(nx + 1)]
    gy = [j * Ly for j in range(ny + 1)]

    def P(x, y, z):  # Concreta -> PyNite
        return (y, z, x) if yup else (x, y, z)

    def nid(i, j, k):
        return f'N{i}_{j}_{k}'

    vdir = 'FY' if yup else 'FZ'
    hdirX = 'FZ' if yup else 'FX'

    # nudos de base (solo pilares)
    for x in gx:
        for y in gy:
            i, j = xs.index(x), ys.index(y)
            m.add_node(nid(i, j, 0), *P(x, y, 0.0))
            m.def_support(nid(i, j, 0), True, True, True, True, True, True)
    # plantas
    for k in range(1, storeys + 1):
        z = k * h
        for i, x in enumerate(xs):
            for j, y in enumerate(ys):
                on_line = (x in gx) or (y in gy)
                if slabs or on_line:
                    if (not slabs) and not ((x in gx and y in gy) or (x in gx) or (y in gy)):
                        continue
                    m.add_node(nid(i, j, k), *P(x, y, z))
        # pilares
        for x in gx:
            for y in gy:
                i, j = xs.index(x), ys.index(y)
                m.add_member(f'C{i}_{j}_{k}', nid(i, j, k - 1), nid(i, j, k), 'HA', 'P30')
        # vigas en X (sobre líneas y = gy)
        for y in gy:
            j = ys.index(y)
            for i in range(len(xs) - 1):
                m.add_member(f'BX{i}_{j}_{k}', nid(i, j, k), nid(i + 1, j, k), 'HA', 'V3050')
        # vigas en Y (sobre líneas x = gx)
        for x in gx:
            i = xs.index(x)
            for j in range(len(ys) - 1):
                m.add_member(f'BY{i}_{j}_{k}', nid(i, j, k), nid(i, j + 1, k), 'HA', 'V3050')
        # losa
        if slabs:
            for i in range(len(xs) - 1):
                for j in range(len(ys) - 1):
                    q = f'Q{i}_{j}_{k}'
                    # orden antihorario visto desde +Z -> normal local +Z (Concreta)
                    m.add_quad(q, nid(i, j, k), nid(i + 1, j, k), nid(i + 1, j + 1, k), nid(i, j + 1, k), t, 'HA')
                    m.add_quad_surface_pressure(q, q_G, 'G')
                    m.add_quad_surface_pressure(q, q_Q, 'Q')
        # viento: fuerza en X en cabeza de pilares
        for x in gx:
            for y in gy:
                i, j = xs.index(x), ys.index(y)
                m.add_node_load(nid(i, j, k), hdirX, F_W, 'W')
    if member_self_weight:
        m.add_member_self_weight(vdir, -1.0, 'G')
    for c in ('G', 'Q', 'W'):
        m.add_load_combo(c, {c: 1.0})
    m.add_load_combo('ELU', {'G': 1.35, 'Q': 1.5, 'W': 0.9})
    meta = dict(xs=xs, ys=ys, gx=gx, gy=gy, nx=nx, ny=ny, storeys=storeys, Lx=Lx, Ly=Ly, h=h,
                t=t, q_G=q_G, q_Q=q_Q, F_W=F_W, yup=yup)
    return m, meta


def counts(m):
    return dict(nodes=len(m.nodes), members=len(m.members), quads=len(m.quads), plates=len(m.plates),
                dof=6 * len(m.nodes))
