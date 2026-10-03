"""Muro en voladizo (3 m x 6 m, e=0.25) con carga lateral en cabeza: equilibrio de momentos
en el plano del muro (eje = normal del muro = eje del drilling) y flecha vs Timoshenko."""
import numpy as np
from Pynite import FEModel3D
import pynite_fast
E, nu, t, B, H, P = 30e9, 0.2, 0.25, 3.0, 6.0, 100e3
for h in (1.0, 0.5, 0.25):
    m = FEModel3D(); m.add_material('C', E, E/(2*(1+nu)), nu, 0.0)
    nxe, nye = int(round(B/h)), int(round(H/h))
    for i in range(nxe+1):
        for j in range(nye+1):
            m.add_node(f'n{i}_{j}', i*h, j*h, 0.0)   # muro en el plano XY (Y vertical, PyNite Y-up)
    for i in range(nxe):
        for j in range(nye):
            m.add_quad(f'q{i}_{j}', f'n{i}_{j}', f'n{i+1}_{j}', f'n{i+1}_{j+1}', f'n{i}_{j+1}', t, 'C')
    for i in range(nxe+1):
        m.def_support(f'n{i}_0', *[True]*6)
        m.add_node_load(f'n{i}_{nye}', 'FX', P/(nxe+1))
    pynite_fast.solve_linear(m)
    c = 'Combo 1'
    Mapp = sum(-(n.Y)*l[1] for n in m.nodes.values() for l in n.NodeLoads)          # (r x F)_z = x*Fy - y*Fx
    Mr = sum(n.X*n.RxnFY[c] - n.Y*n.RxnFX[c] + n.RxnMZ[c] for n in m.nodes.values())
    ux = np.mean([m.nodes[f'n{i}_{nye}'].DX[c] for i in range(nxe+1)])
    I = t*B**3/12; G = E/(2*(1+nu)); As = 5/6*t*B
    u_ref = P*H**3/(3*E*I) + P*H/(G*As)
    print(f'h={h:5.2f} m: ux={ux*1e3:.4f} mm  (Timoshenko {u_ref*1e3:.4f} mm, ratio {ux/u_ref:.3f})  '
          f'ΣM: aplicado={Mapp:.1f} reacc={Mr:.1f} desequilibrio={(Mapp+Mr)/abs(Mapp)*100:.3f} %')
