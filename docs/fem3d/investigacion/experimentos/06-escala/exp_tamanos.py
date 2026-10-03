"""Tabla de tamaños: nudos, GDL, barras, quads, nnz(K11) (numérico, ambas mitades) y nnz por bloques 6x6.
Uso: python exp_tamanos.py  -> una línea JSON por variante
"""
import json, time
import numpy as np
import edificio as ed, vec_asm

CASOS = [('V1', 1.0, 0.0), ('V1', 0.75, 0.0), ('V1', 0.5, 0.0), ('V1', 0.35, 0.0),
         ('V1', 1.0, 0.1), ('V1', 0.75, 0.1), ('V1', 0.5, 0.1),
         ('V2', 1.0, 0.0), ('V2', 0.75, 0.0), ('V2', 0.5, 0.0),
         ('V3', 0.5, 0.0), ('V3', 0.5, 0.1)]
for var, h, irr in CASOS:
    t = time.perf_counter()
    m = ed.build(var, h=h, irr=irr)
    c = ed.conteos(m)
    K, _ = vec_asm.assemble(m)
    Kc = K.tocsr(); Kc.eliminate_zeros()
    freeN = np.nonzero(~m['fixed'])[0]
    dof = (6 * freeN[:, None] + np.arange(6)).reshape(-1)
    K11 = Kc[dof][:, dof]
    c['nnz_K11'] = int(K11.nnz)
    c['nnz_K11_por_fila'] = round(K11.nnz / K11.shape[0], 1)
    print(json.dumps(dict(variante=var, h=h, irr=irr, **c, plantas_x_y=[m['meta']['nxl'], m['meta']['nyl']],
                          nz_muro=m['meta']['nz'][:2], s=round(time.perf_counter() - t, 2))), flush=True)
