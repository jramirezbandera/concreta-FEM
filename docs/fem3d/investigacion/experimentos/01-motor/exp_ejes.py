"""Ejes locales de Member3D: (1) discontinuidad del eje por defecto ante ruido numérico,
(2) cálculo del ángulo `rotation` que alinea el eje local y con un vector de referencia
explícito (§5.2), (3) liberaciones dobles de torsión -> error.
"""
import numpy as np
from Pynite import FEModel3D

np.set_printoptions(precision=6, suppress=True)


def default_axes(p1, p2, rotation=0.0):
    m = FEModel3D()
    m.add_material('S', 210e9, 81e9, 0.3, 78500)
    m.add_section('S', 1e-2, 1e-5, 2e-5, 1e-6)
    m.add_node('a', *p1); m.add_node('b', *p2)
    m.add_member('M', 'a', 'b', 'S', 'S', rotation=rotation)
    return m.members['M'].T()[:3, :3]


print('== (1) sensibilidad del eje por defecto (Y-up de PyNite) ==')
for dx in (0.0, 1e-15, 1e-12, 1e-9):
    R = default_axes((0, 0, 0), (dx, 3, 0))  # pilar casi vertical en Y-up
    print(f'pilar Y-up dx={dx:g}: y_local={R[1]}, z_local={R[2]}')
for dz in (0.0, 1e-15, 1e-12):
    R = default_axes((0, 0, 0), (0, 0, 3 + 0 * dz))
    R2 = default_axes((0, 0, 0), (dz, 1e-14, 3))
    print(f'pilar Z-up exacto: y={R[1]} | con ruido (dx={dz:g}, dy=1e-14): y={R2[1]}')
for dy in (0.0, 1e-15, 1e-12):
    R = default_axes((0, 0, 0), (6, dy, 0))  # viga en X, Y-up
    print(f'viga X Y-up dy={dy:g}: y_local={R[1]}')


def rotation_for(p1, p2, yref):
    """Ángulo (grados) que hay que pasar a add_member para que el eje local y de PyNite
    sea la proyección de `yref` sobre el plano normal al eje x."""
    R0 = default_axes(p1, p2, 0.0)
    x, y0, z0 = R0
    yd = np.asarray(yref, float)
    yd = yd - x * np.dot(yd, x)
    yd /= np.linalg.norm(yd)
    ang = np.degrees(np.arctan2(np.dot(np.cross(y0, yd), x), np.dot(y0, yd)))
    return ang


print('\n== (2) rotation a partir de vector de referencia ==')
cases = [((0, 0, 0), (0, 0, 3), (1, 0, 0)),      # pilar Z-up, y local -> X global
         ((0, 0, 0), (6, 0, 0), (0, 0, 1)),      # viga X Z-up, y local -> vertical
         ((0, 0, 0), (0, 5, 0), (0, 0, 1)),      # viga Y Z-up
         ((0, 0, 0), (4, 3, 2), (0, 0, 1)),      # barra inclinada
         ((1, 2, 3), (1, 2, 0), (0, 1, 0))]      # pilar descendente
worst = 0
for p1, p2, yref in cases:
    ang = rotation_for(p1, p2, yref)
    R = default_axes(p1, p2, ang)
    x = R[0]
    yd = np.asarray(yref, float); yd = yd - x * np.dot(yd, x); yd /= np.linalg.norm(yd)
    err = np.linalg.norm(R[1] - yd)
    worst = max(worst, err)
    print(f'{p1}->{p2} yref={yref}: rotation={ang:8.3f}°  y={R[1]}  z={R[2]}  |y-yd|={err:.1e}')
print('peor error', worst)

print('\n== (3) liberación Rxi y Rxj simultánea ==')
m = FEModel3D()
m.add_material('S', 210e9, 81e9, 0.3, 78500)
m.add_section('S', 1e-2, 1e-5, 2e-5, 1e-6)
m.add_node('a', 0, 0, 0); m.add_node('b', 6, 0, 0); m.add_node('c', 0, 0, 3); m.add_node('d', 6, 0, 3)
m.def_support('a', *[True] * 6); m.def_support('b', *[True] * 6)
m.add_member('C1', 'a', 'c', 'S', 'S'); m.add_member('C2', 'b', 'd', 'S', 'S'); m.add_member('B', 'c', 'd', 'S', 'S')
m.def_releases('B', Rxi=True, Rxj=True)
m.add_node_load('c', 'FZ', -1000)
try:
    m.analyze_linear()
    print('resolvió sin error')
except Exception as e:
    print('EXCEPCIÓN:', type(e).__name__, e)
