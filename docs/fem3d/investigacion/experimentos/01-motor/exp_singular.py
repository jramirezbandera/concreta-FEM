"""Experimento: qué hace PyNite 3.2.0 ante singularidades/mecanismos (§16).
Captura excepción, mensaje y lo que imprime por consola (stdout).
"""
import io, contextlib, warnings
import numpy as np
from Pynite import FEModel3D


def base():
    m = FEModel3D()
    m.add_material('S', 210e9, 81e9, 0.3, 78500)
    m.add_section('S', 1e-2, 1e-5, 2e-5, 1e-6)
    return m


def run(title, m, **kw):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), warnings.catch_warnings(record=True) as w:
        warnings.simplefilter('always')
        try:
            m.analyze_linear(**kw)
            res = 'OK'
            # desplazamientos finitos?
            D = np.concatenate([v.flatten() for v in m._D.values()])
            res += f' | D finito={np.isfinite(D).all()} max|D|={np.nanmax(np.abs(D)):.3e}'
        except Exception as e:
            res = f'EXC {type(e).__name__}: {e}'
    out = buf.getvalue().strip().replace('\n', ' || ')
    ws = '; '.join(sorted({f'{x.category.__name__}: {str(x.message)[:80]}' for x in w}))
    print(f'--- {title} {kw}\n    resultado: {res}\n    stdout: {out[:400]}\n    warnings: {ws[:300]}')


# 1) nudo suelto (sin elementos)
for cs in (True, False):
    m = base()
    m.add_node('a', 0, 0, 0); m.add_node('b', 3, 0, 0); m.add_node('suelto', 9, 9, 9)
    m.def_support('a', *[True] * 6)
    m.add_member('M', 'a', 'b', 'S', 'S'); m.add_node_load('b', 'FZ', -1000)
    run('nudo suelto', m, check_stability=cs)

# 2) mecanismo por liberaciones: voladizo con rótula (My, Mz) en el empotramiento
for cs in (True, False):
    for sp in (True, False):
        m = base()
        m.add_node('a', 0, 0, 0); m.add_node('b', 3, 0, 0); m.add_node('c', 6, 0, 0)
        m.def_support('a', *[True] * 6)
        m.add_member('M1', 'a', 'b', 'S', 'S'); m.add_member('M2', 'b', 'c', 'S', 'S')
        m.def_releases('M2', Ryi=True, Rzi=True)  # rótula en b -> mecanismo
        m.add_node_load('c', 'FZ', -1000)
        run('mecanismo por rótula interior', m, check_stability=cs, sparse=sp)

# 3) estructura sin apoyos
for cs in (True, False):
    m = base()
    m.add_node('a', 0, 0, 0); m.add_node('b', 3, 0, 0)
    m.add_member('M', 'a', 'b', 'S', 'S'); m.add_node_load('b', 'FZ', -1000)
    run('sin apoyos', m, check_stability=cs)

# 4) barra biarticulada (celosía) suelta en giro de nudo
m = base()
m.add_node('a', 0, 0, 0); m.add_node('b', 3, 0, 0); m.add_node('c', 3, 0, 3)
m.def_support('a', True, True, True, False, False, False); m.def_support('b', True, True, True, False, False, False)
m.add_member('T1', 'a', 'c', 'S', 'S'); m.add_member('T2', 'b', 'c', 'S', 'S')
for n in ('T1', 'T2'):
    m.def_releases(n, Ryi=True, Rzi=True, Ryj=True, Rzj=True)
m.add_node_load('c', 'FX', 1000)
run('cercha con giros libres en nudos', m)

# 5) placa (quad) sola apoyada en esquinas: drilling débil
m = base()
for i, (x, y) in enumerate([(0, 0), (2, 0), (2, 2), (0, 2)]):
    m.add_node(f'n{i}', x, y, 0); m.def_support(f'n{i}', True, True, True, False, False, False)
m.add_quad('Q', 'n0', 'n1', 'n2', 'n3', 0.2, 'S')
m.add_quad_surface_pressure('Q', -1000)
run('quad apoyado en esquinas', m)

# 6) pilar que acomete a una losa de quads: torsión del pilar sólo frenada por drilling
m = base()
m.add_node('p0', 1, 1, -3); m.def_support('p0', *[True] * 6)
k = 0
for i in range(3):
    for j in range(3):
        m.add_node(f'n{i}{j}', i, j, 0)
for i in range(2):
    for j in range(2):
        m.add_quad(f'Q{i}{j}', f'n{i}{j}', f'n{i+1}{j}', f'n{i+1}{j+1}', f'n{i}{j+1}', 0.2, 'S')
for n in ('n00', 'n20', 'n02', 'n22'):
    m.def_support(n, True, True, True, False, False, False)
m.add_member('P', 'p0', 'n11', 'S', 'S')
m.add_node_load('n11', 'MZ', 1000)  # torsor en cabeza de pilar (giro sobre la normal de la losa)
run('torsor en nudo pilar-losa', m)
print('    giro RZ n11 =', m.nodes['n11'].RZ.get('Combo 1'), ' torsor en pilar T =', m.members['P'].torque(1.5, 'Combo 1'))
