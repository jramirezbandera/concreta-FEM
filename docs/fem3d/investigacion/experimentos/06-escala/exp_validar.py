"""Valida el ensamblado vectorizado (vec_asm) contra PyNite 3.2.0: K global, P-FER y desplazamientos.
Uso: python exp_validar.py VAR h storeys [irr]
"""
import sys, json, time
import numpy as np
import scipy.sparse as sp
from Pynite import FEModel3D, Analysis
import edificio as ed, pyn_build, vec_asm, pynite_fast

var, h, st = sys.argv[1], float(sys.argv[2]), int(sys.argv[3])
irr = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
m = ed.build(var, h=h, storeys=st, irr=irr)
M = pyn_build.to_pynite(m, FEModel3D)
Analysis._prepare_model(M)
Kp = M.Ke(list(M.load_combos)[0], check_stability=False, sparse=True).tocsr()
Kv, _ = vec_asm.assemble(m)
Kv = Kv.tocsr()
Kv.eliminate_zeros()
dK = (Kp - Kv)
scale = abs(Kp).max()
out = dict(case=f'{var} h={h} st={st} irr={irr}', nudos=len(m['xyz']), quads=len(m['quads']), barras=len(m['mem']),
           nnz_K_pynite=int(Kp.nnz), nnz_K_vec=int(Kv.nnz),
           K_maxabs_diff_rel=float(abs(dK).max() / scale) if dK.nnz else 0.0)
Fv, cases = vec_asm.loads(m)
errF = 0.0
for j, c in enumerate(cases):
    Fp = (M.P(c) - M.FER(c))[:, 0]
    errF = max(errF, float(np.abs(Fp - Fv[:, j]).max() / max(np.abs(Fp).max(), 1e-30)))
out['F_maxabs_diff_rel'] = errF
pynite_fast.solve_linear(M)
D, Rx, T = vec_asm.solve(m, info=out)
errD = 0.0
for j, c in enumerate(cases):
    Dp = M._D[c][:, 0]
    errD = max(errD, float(np.abs(Dp - D[:, j]).max() / np.abs(Dp).max()))
out['D_maxabs_diff_rel'] = errD
print(json.dumps(out))
