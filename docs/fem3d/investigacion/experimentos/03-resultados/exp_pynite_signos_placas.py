# Experimento RES-E1b: convenciones y unidades de resultantes de lámina en PyNite 3.2.0
#  (1) Placa cuadrada simplemente apoyada a=4 m, q uniforme: signo de Mx, My en el centro,
#      comparación con Timoshenko (nu=0.3: Mx=My=0.0479 q a^2, w=0.00406 q a^4/D).
#  (2) membrane(): ¿devuelve tensión (Pa) o esfuerzo por unidad de longitud (N/m)?
#  (3) Placa girada 30° en su plano: ¿la salida local=False rota bien el tensor de momentos?
import math
import numpy as np
from Pynite import FEModel3D

a, t = 4.0, 0.20
E, nu = 30e9, 0.3
G = E / (2 * (1 + nu))
q = 10e3  # Pa
n = 16  # elementos por lado


def build(theta_deg=0.0, pressure=-q, inplane=False):
    th = math.radians(theta_deg)
    c, s = math.cos(th), math.sin(th)
    m = FEModel3D()
    m.add_material('C', E, G, nu, 2500)
    h = a / n
    def nid(i, j):
        return f'N{i}_{j}'
    for i in range(n + 1):
        for j in range(n + 1):
            x, y = i * h, j * h
            m.add_node(nid(i, j), c * x - s * y, s * x + c * y, 0.0)
    for i in range(n):
        for j in range(n):
            # i,j,m,n antihorario visto desde +Z → normal local +Z
            m.add_quad(f'Q{i}_{j}', nid(i, j), nid(i + 1, j), nid(i + 1, j + 1), nid(i, j + 1), t, 'C')
            if not inplane:
                m.add_quad_surface_pressure(f'Q{i}_{j}', pressure, case='C1')
    for i in range(n + 1):
        for j in range(n + 1):
            edge = i in (0, n) or j in (0, n)
            if inplane:
                # membrana: borde x=0 coaccionado en x, una esquina en y; flexión bloqueada
                m.def_support(nid(i, j), i == 0, i == 0 and j == 0, True, True, True, True)
            else:
                m.def_support(nid(i, j), (i == 0 and j == 0), (i == 0 and j == 0) or (i == n and j == 0), edge, False, False, True)
    if inplane:
        # tracción total F = 1000 kN/m * a en el borde x=a (en ejes del modelo, girado si procede)
        Nx_target = 1.0e6  # N/m
        for j in range(n + 1):
            w = h if 0 < j < n else h / 2
            F = Nx_target * w
            m.add_node_load(nid(n, j), 'FX', F * c, case='C1')
            m.add_node_load(nid(n, j), 'FY', F * s, case='C1')
    m.add_load_combo('K', {'C1': 1.0})
    m.analyze_linear()
    return m


def at_point(m, i, j, xi=0.0, eta=0.0, local=True):
    qd = m.quads[f'Q{i}_{j}']
    mom = qd.moment(xi, eta, local=local, combo_name='K').flatten()
    she = qd.shear(xi, eta, local=local, combo_name='K').flatten()
    mem = qd.membrane(xi, eta, local=local, combo_name='K').flatten()
    return mom, she, mem


D = E * t**3 / (12 * (1 - nu**2))
print('=== (1) placa SS, presión add_quad_surface_pressure = -q (q=10 kPa) ===')
m0 = build(0.0)
c = n // 2
mom, she, mem = at_point(m0, c, c, -1, -1)  # esquina inferior-izq del elemento c,c = centro de la placa
wc = m0.nodes[f'N{c}_{c}'].DZ['K']
print(f'w_centro = {wc:.6e} m   (Timoshenko {0.00406*q*a**4/D:.6e}, signo esperado si -q es hacia -Z: negativo)')
print(f'Mx,My,Mxy centro (local) = {mom}  N·m/m   (Timoshenko |M| = {0.0479*q*a*a:.1f})')
# reacción total
Rz = sum(nd.RxnFZ['K'] for nd in m0.nodes.values())
print(f'sum Rz = {Rz:.1f} N  (carga total {q*a*a:.1f})')
# misma placa con presión +q
m0p = build(0.0, pressure=+q)
print(f'con presión +q: w_centro = {m0p.nodes[f"N{c}_{c}"].DZ["K"]:.6e}, Mx_centro = {at_point(m0p, c, c, -1, -1)[0][0]:.1f}')
# esquina: Mxy
momc, shec, _ = at_point(m0, 0, 0, -1, -1)
print(f'esquina (0,0): Mx,My,Mxy = {momc}; Qx,Qy={shec}')
mom_mid_edge, she_mid_edge, _ = at_point(m0, 0, c, -1, -1)
print(f'borde x=0, y=a/2: Qx,Qy = {she_mid_edge} N/m  (Timoshenko |Qx| borde = {0.338*q*a:.0f}; Vx Kirchhoff 0.420qa)')

print('\n=== (2) membrane(): tracción uniforme Nx = 1,0e6 N/m en placa t=0,20 ===')
mm = build(0.0, inplane=True)
_, _, memb = at_point(mm, c, c, 0, 0)
print(f'membrane(local) en el centro = {memb}  → si es tensión: Nx/t = {1e6/t:.3e} Pa; si es esfuerzo: 1,0e6 N/m')

print('\n=== (3) placa girada 30°: transformación local→global de momentos ===')
# local=False revienta con numpy 2.5 (float() de un array 1-D); se reproduce su álgebra a mano.
try:
    at_point(m0, 2, 5, 0, 0, local=False)
    print('local=False: OK')
except Exception as e:
    print('local=False lanza:', type(e).__name__, e)
th = 30.0
mr = build(th)
pt = (2, 5)  # elemento con Mxy apreciable
mom_l0, _, _ = at_point(m0, *pt, 0, 0, local=True)
mom_lr, _, _ = at_point(mr, *pt, 0, 0, local=True)
print(f'sin girar  local (= global, ejes alineados) = {mom_l0}')
print(f'girada 30° local                            = {mom_lr}  (debe coincidir: mismo problema físico)')
c30, s30 = math.cos(math.radians(th)), math.sin(math.radians(th))
Rz = np.array([[c30, -s30, 0], [s30, c30, 0], [0, 0, 1]])
T0 = np.array([[mom_l0[0], mom_l0[2], 0], [mom_l0[2], mom_l0[1], 0], [0, 0, 0]])
ref = Rz @ T0 @ Rz.T
print(f'REFERENCIA global girada = Rz·T0·Rzᵀ → Mx={ref[0,0]:.2f} My={ref[1,1]:.2f} Mxy={ref[0,1]:.2f}')
R = mr.quads[f'Q{pt[0]}_{pt[1]}'].T()[:3, :3]
Ml_pynite = np.array([[mom_lr[0], mom_lr[2], 0], [mom_lr[2], -mom_lr[1], 0], [0, 0, 0]])  # PyNite: My = -My
G_pyn = R @ Ml_pynite @ R.T
print(f'álgebra de PyNite (My→-My; R·M·Rᵀ)  → Mx={G_pyn[0,0]:.2f} My={G_pyn[1,1]:.2f} Mxy={G_pyn[0,1]:.2f}')
Ml = np.array([[mom_lr[0], mom_lr[2], 0], [mom_lr[2], mom_lr[1], 0], [0, 0, 0]])
G_ok = R.T @ Ml @ R
print(f'álgebra correcta (Rᵀ·M·R, sin cambio)  → Mx={G_ok[0,0]:.2f} My={G_ok[1,1]:.2f} Mxy={G_ok[0,1]:.2f}')
G0_pyn = np.array([[mom_l0[0], mom_l0[2]], [mom_l0[2], -mom_l0[1]]])
print(f'placa SIN girar con el álgebra de PyNite → Mx={G0_pyn[0,0]:.2f} My={G0_pyn[1,1]:.2f} (local Mx={mom_l0[0]:.2f}, My={mom_l0[1]:.2f})')
