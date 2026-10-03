# Experimento RES-E1c: ¿qué es «Mx» en Quad3D de PyNite 3.2.0?
# Losa unidireccional: apoyada (DZ=0) sólo en los bordes x=0 y x=a, bordes y libres.
# Flexión cilíndrica en la dirección x: el momento que produce σx vale q·a²/8 en el centro
# y el cortante transversal en el apoyo vale q·a/2. Si PyNite llama Mx a ese momento,
# Mx ≈ ±q a²/8 y My ≈ ν·Mx (por el efecto Poisson en flexión cilíndrica).
from Pynite import FEModel3D

a, b, t = 4.0, 2.0, 0.20
E, nu = 30e9, 0.3
G = E / (2 * (1 + nu))
q = 10e3
nx, ny = 16, 8
m = FEModel3D()
m.add_material('C', E, G, nu, 2500)
hx, hy = a / nx, b / ny
nid = lambda i, j: f'N{i}_{j}'
for i in range(nx + 1):
    for j in range(ny + 1):
        m.add_node(nid(i, j), i * hx, j * hy, 0.0)
for i in range(nx):
    for j in range(ny):
        m.add_quad(f'Q{i}_{j}', nid(i, j), nid(i + 1, j), nid(i + 1, j + 1), nid(i, j + 1), t, 'C')
        m.add_quad_surface_pressure(f'Q{i}_{j}', -q, case='C1')
for i in range(nx + 1):
    for j in range(ny + 1):
        sup = i in (0, nx)
        m.def_support(nid(i, j), i == 0 and j == 0, i == 0 and j == 0 or (i == nx and j == 0), sup, False, False, True)
m.add_load_combo('K', {'C1': 1.0})
m.analyze_linear()
qc = m.quads[f'Q{nx//2}_{ny//2}']
Mx, My, Mxy = qc.moment(-1, -1, local=True, combo_name='K').flatten()
print(f'centro de la luz: Mx={Mx:.1f}  My={My:.1f}  Mxy={Mxy:.2f}  N·m/m ; q·a²/8 = {q*a*a/8:.1f}')
qe = m.quads['Q0_4']
Qx, Qy = qe.shear(-1, 0, local=True, combo_name='K').flatten()
print(f'junto al apoyo x=0: Qx={Qx:.1f}  Qy={Qy:.1f}  N/m ; q·a/2 = {q*a/2:.1f}')
Qx2, Qy2 = m.quads[f'Q{nx-1}_4'].shear(1, 0, local=True, combo_name='K').flatten()
print(f'junto al apoyo x=a: Qx={Qx2:.1f}  Qy={Qy2:.1f}  N/m')
