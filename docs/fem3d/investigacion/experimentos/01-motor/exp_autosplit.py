"""PhysMember: ¿se conecta en silencio un nudo que cae sobre la barra?"""
from Pynite import FEModel3D
for off in (0.0, 1e-13, 1e-9, 1e-6):
    m = FEModel3D()
    m.add_material('S', 210e9, 81e9, 0.3, 0.0); m.add_section('S', 1e-2, 1e-5, 2e-5, 1e-6)
    m.add_node('a', 0, 0, 0); m.add_node('b', 6, 0, 0); m.add_node('c', 3, off, 0); m.add_node('d', 3, 3, 0)
    m.def_support('a', *[True]*6); m.def_support('b', *[True]*6); m.def_support('d', True, True, True, True, True, True)
    m.add_member('V', 'a', 'b', 'S', 'S'); m.add_member('P', 'c', 'd', 'S', 'S')  # barra que llega a 'c'
    m.add_node_load('c', 'FY', -1000)
    try:
        m.analyze_linear()
        print(f'desvío {off:g} m: sub-barras de V = {len(m.members["V"].sub_members)} -> ', 'CONECTADO' if len(m.members["V"].sub_members) > 1 else 'NO conectado', f'| DY(c) = {m.nodes["c"].DY["Combo 1"]:.3e}')
    except Exception as e:
        print(f'desvío {off:g} m: EXC {type(e).__name__}: {str(e)[:90]}')
