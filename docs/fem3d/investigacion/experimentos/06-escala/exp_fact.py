"""Factorización de K11 (.npz) con varios métodos. Un método por proceso (para medir memoria).
Uso: python exp_fact.py K.npz METODO [nrhs=6] [--memlimit MB]
METODO:
  colamd      splu(permc_spec='COLAMD')                  (lo que usa PyNite / spsolve)
  mmd         splu(permc_spec='MMD_AT_PLUS_A')           (pivoteo parcial por defecto)
  mmd_sym     splu(MMD_AT_PLUS_A, diag_pivot_thresh=0, SymmetricMode=True)
  colamd_sym  splu(COLAMD, diag_pivot_thresh=0, SymmetricMode=True)
  qdldl       QDLDL (LDL^T con AMD), sólo CPython
  cholmod     CHOLMOD supernodal LL^T (cvxopt, AMD), sólo CPython; BLAS a 1 hilo
  cholmod_s   CHOLMOD simplicial LDL^T (cvxopt, AMD)
Funciona en CPython y en Pyodide (sin psutil: la memoria la mide el runner).
"""
import sys, os, time, json, threading
args = [a for a in sys.argv[1:]]
memlimit = 7000
if '--memlimit' in args:
    k = args.index('--memlimit'); memlimit = float(args[k + 1]); del args[k:k + 2]
path, method = args[0], args[1]
nrhs = int(args[2]) if len(args) > 2 else 6

PEAK = {'rss': 0}
try:
    import psutil
    _p = psutil.Process()

    def _watch():
        while True:
            r = _p.memory_info().rss
            PEAK['rss'] = max(PEAK['rss'], r)
            if r > memlimit * 2**20:
                print(json.dumps({'abort': 'memlimit', 'method': method, 'rss_MB': round(r / 2**20)}), flush=True)
                os._exit(3)
            time.sleep(0.05)
    threading.Thread(target=_watch, daemon=True).start()
except ImportError:
    psutil = None

import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla

K = sp.load_npz(path).tocsc()
K.sort_indices()
n = K.shape[0]
rng = np.random.default_rng(0)
B = rng.standard_normal((n, nrhs))
base = None
if psutil:
    base = _p.memory_info().rss
out = dict(K=os.path.basename(path), method=method, coretype=os.environ.get('OPENBLAS_CORETYPE') or 'auto', n=n, nnz_K=int(K.nnz))
t0 = time.perf_counter()
if method in ('colamd', 'mmd', 'mmd_sym', 'colamd_sym'):
    pc = 'COLAMD' if method.startswith('colamd') else 'MMD_AT_PLUS_A'
    if method.endswith('_sym'):
        lu = spla.splu(K, permc_spec=pc, diag_pivot_thresh=0.0, options=dict(SymmetricMode=True))
    else:
        lu = spla.splu(K, permc_spec=pc)
    t1 = time.perf_counter()
    X = lu.solve(B)
    t2 = time.perf_counter()
    out['nnz_factor'] = int(lu.nnz)
    if method.endswith('_sym') and psutil is not None:
        cc = np.diff(lu.L.indptr).astype(np.float64)
        out['flops_chol_est'] = float((cc**2).sum())
    del lu
elif method == 'qdldl':
    import qdldl
    Ku = sp.triu(K, format='csc')
    s = qdldl.Solver(Ku, upper=True)
    t1 = time.perf_counter()
    X = np.column_stack([s.solve(B[:, j]) for j in range(nrhs)])
    t2 = time.perf_counter()
    L, d, p = s.factors()
    cc = np.diff(L.tocsc().indptr).astype(np.float64) + 1.0
    out['nnz_factor'] = int(L.nnz + n)
    out['flops_chol_est'] = float((cc**2).sum())
    del s, L
elif method in ('cholmod', 'cholmod_s'):
    from cvxopt import spmatrix, matrix, cholmod
    Kl = sp.tril(K, format='coo')
    A = spmatrix(Kl.data.tolist(), Kl.row.tolist(), Kl.col.tolist(), (n, n))
    del Kl
    t0 = time.perf_counter()
    cholmod.options['supernodal'] = 2 if method == 'cholmod' else 0
    F = cholmod.symbolic(A, uplo='L')
    ts = time.perf_counter()
    cholmod.numeric(A, F)
    t1 = time.perf_counter()
    out['t_symbolic_s'] = round(ts - t0, 3)
    Bm = matrix(B)
    cholmod.solve(F, Bm)
    X = np.array(Bm)
    t2 = time.perf_counter()
    try:
        Lf = cholmod.getfactor(F)
        out['nnz_factor'] = int(len(Lf))
    except Exception as e:
        out['getfactor_err'] = str(e)[:80]
else:
    raise SystemExit('método desconocido')
out['t_factor_s'] = round(t1 - t0, 3)
out['t_solve_s'] = round(t2 - t1, 3)
r = K @ X - B
out['res_rel_max'] = float((np.linalg.norm(r, axis=0) / np.linalg.norm(B, axis=0)).max())
if psutil:
    mi = _p.memory_info()
    pk = max(getattr(mi, 'peak_wset', mi.rss), PEAK['rss'])
    out['peak_mem_MB'] = round(pk / 2**20, 1)
    out['delta_mem_MB'] = round((pk - base) / 2**20, 1)
print(json.dumps(out), flush=True)
