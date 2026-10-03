import numpy as np
from exp_ejes import default_axes
for dx in (1e-9, -1e-9, 1e-12, -1e-12):
    for dz in (0.0, 1e-12, -1e-12):
        R = default_axes((0,0,0),(dx,3,dz))
        print(f'pilar Y-up dx={dx:+g} dz={dz:+g}: y={np.round(R[1],6)} z={np.round(R[2],6)}')
