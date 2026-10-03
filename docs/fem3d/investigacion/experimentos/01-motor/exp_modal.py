import time, numpy as np
from Pynite import FEModel3D
import modelo
m, meta = modelo.build(FEModel3D, nx=2, ny=2, storeys=2, s=1.5, yup=True)
t = time.perf_counter()
try:
    m.analyze_modal(num_modes=6, mass_combo_name='G', mass_direction='Y', gravity=9.81)
    fr = [round(f, 3) for f in getattr(m, 'frequencies', [])] if hasattr(m, 'frequencies') else None
    print('modal OK', round(time.perf_counter() - t, 2), 's; frecuencias', fr if fr else [k for k in vars(m) if 'freq' in k.lower() or 'mode' in k.lower()])
except Exception as e:
    print('modal EXC', type(e).__name__, str(e)[:300])
