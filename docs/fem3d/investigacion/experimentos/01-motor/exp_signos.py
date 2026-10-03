"""Convenio de signos de PyNite 3.2.0 con casos de solución conocida.
Barra en el eje X global (PyNite Y-up): ejes locales x=X, y=Y, z=Z (identidad).
"""
import numpy as np
from Pynite import FEModel3D

L, w, P, Tq = 6.0, 1000.0, 5000.0, 700.0


def beam():
    m = FEModel3D()
    m.add_material('S', 210e9, 81e9, 0.3, 0.0)
    m.add_section('S', 1e-2, 2e-5, 3e-5, 1e-6)
    m.add_node('a', 0, 0, 0); m.add_node('b', L, 0, 0)
    m.add_member('M', 'a', 'b', 'S', 'S')
    print('   ejes locales:', m.members['M'].T()[:3, :3].round(3).tolist())
    return m


print('1) biapoyada, carga uniforme -w en local y (gravedad Y-up): Mz(L/2) y Vy(0)')
m = beam()
m.def_support('a', True, True, True, True, False, False); m.def_support('b', False, True, True, False, False, False)
m.add_member_dist_load('M', 'Fy', -w, -w)
m.analyze_linear()
M = m.members['M']
print(f'   Mz(L/2)={M.moment("Mz", L/2):.1f} (wL²/8={w*L*L/8:.1f}); Vy(0)={M.shear("Fy", 0):.1f}; Vy(L)={M.shear("Fy", L):.1f}; flecha dy(L/2)={M.deflection("dy", L/2):.3e}')

print('2) misma con carga -w en local z: My(L/2), Vz(0)')
m = beam()
m.def_support('a', True, True, True, True, False, False); m.def_support('b', False, True, True, False, False, False)
m.add_member_dist_load('M', 'Fz', -w, -w)
m.analyze_linear()
M = m.members['M']
print(f'   My(L/2)={M.moment("My", L/2):.1f}; Vz(0)={M.shear("Fz", 0):.1f}; Vz(L)={M.shear("Fz", L):.1f}; dz(L/2)={M.deflection("dz", L/2):.3e}')

print('3) tracción: empotrada en a, fuerza +P en X en b')
m = beam()
m.def_support('a', *[True] * 6)
m.add_node_load('b', 'FX', P)
m.analyze_linear()
M = m.members['M']
print(f'   axial(L/2)={M.axial(L/2):.1f} (tracción de {P})  reacción RxnFX(a)={m.nodes["a"].RxnFX["Combo 1"]:.1f}')

print('4) torsor +T sobre X en b (empotrada en a)')
m = beam()
m.def_support('a', *[True] * 6)
m.add_node_load('b', 'MX', Tq)
m.analyze_linear()
print(f'   torque(L/2)={m.members["M"].torque(L/2):.1f}  (aplicado +{Tq} en el extremo j)')

print('5) voladizo, carga -P en Y en b: Mz(0) (momento de empotramiento, fibras superiores traccionadas)')
m = beam()
m.def_support('a', *[True] * 6)
m.add_node_load('b', 'FY', -P)
m.analyze_linear()
M = m.members['M']
print(f'   Mz(0)={M.moment("Mz", 0):.1f} (|PL|={P*L:.1f}); Vy(0)={M.shear("Fy", 0):.1f}; RxnMZ(a)={m.nodes["a"].RxnMZ["Combo 1"]:.1f}')

print('6) losa: franja biapoyada 6 x 1 m de quads (Y-up -> losa en plano XZ), presión hacia abajo')
m = FEModel3D()
m.add_material('C', 30e9, 12.5e9, 0.0, 0.0)
nxq = 12
for i in range(nxq + 1):
    for j in range(2):
        m.add_node(f'n{i}_{j}', i * L / nxq, 0, j * 1.0)
# orden i->j->m->n: x local = +X, segundo lado hacia -Z?  elegimos normal local +Y (hacia arriba)
for i in range(nxq):
    m.add_quad(f'q{i}', f'n{i}_1', f'n{i+1}_1', f'n{i+1}_0', f'n{i}_0', 0.2, 'C')
    m.add_quad_surface_pressure(f'q{i}', -w)  # negativa = contra la normal local (+Y) -> hacia abajo
for j in range(2):
    m.def_support(f'n0_{j}', True, True, True, False, False, False)
    m.def_support(f'n{nxq}_{j}', False, True, False, False, False, False)
m.analyze_linear()
q = m.quads[f'q{nxq//2}']
print('   ejes locales quad:', q.T()[:3, :3].round(3).tolist())
print(f'   reacción vertical total = {sum(n.RxnFY["Combo 1"] for n in m.nodes.values()):.1f} (w·L·1 = {w*L:.1f})')
print('   en x≈L/2 (nodo i del quad central, xi=-1): Mx,My,Mxy =', q.moment(-1, 0, True).flatten().round(1), ' wL²/8 =', w * L * L / 8)
print('   centroide: Mx,My,Mxy =', q.moment(0, 0, True).flatten().round(1))
import numpy as _np
for _f in ('moment', 'shear', 'membrane'):
    try:
        print(f'   {_f}(local=False) =', getattr(q, _f)(0, 0, False).flatten().round(1), ' numpy', _np.__version__)
    except Exception as e:
        print(f'   {_f}(local=False) -> EXC {type(e).__name__}: {e}  (numpy {_np.__version__})')
q0 = m.quads['q0']
print('   cerca del apoyo (q0, xi=-1): Qx,Qy =', q0.shear(-1, 0, True).flatten().round(1), ' (wL/2 =', w * L / 2, ')')
