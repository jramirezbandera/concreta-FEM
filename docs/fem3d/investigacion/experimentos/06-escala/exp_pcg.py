"""CG precondicionado sobre una K11 de lámina (opcional 5).
Uso: python exp_pcg.py K.npz [maxiter=20000] [rtol=1e-8]
Precondicionadores: Jacobi, Jacobi por bloques 6x6 (nudo), ILU (spilu) y, de referencia, IC(0)~ILU sin relleno.
El lado derecho es el de una carga vertical uniforme aproximada (1 en GDL 1 de cada nudo) + aleatorio.
"""
import sys, time, json, os, threading
import numpy as np
try:
    import psutil
    _p = psutil.Process()
    def _watch():
        while True:
            r = _p.memory_info().rss
            if r > 3000 * 2**20:
                print(json.dumps({'abort': 'memlimit 3000 MB', 'rss_MB': round(r / 2**20)}), flush=True)
                os._exit(3)
            time.sleep(0.1)
    threading.Thread(target=_watch, daemon=True).start()
except ImportError:
    pass
import scipy.sparse as sp
import scipy.sparse.linalg as spla

argv = sys.argv[1:]
model = None
if '--model' in argv:
    k = argv.index('--model'); model = (argv[k + 1], float(argv[k + 2]), int(argv[k + 3])); del argv[k:k + 4]
path = argv[0]
maxiter = int(argv[1]) if len(argv) > 1 else 20000
rtol = float(argv[2]) if len(argv) > 2 else 1e-8
K = sp.load_npz(path).tocsr()
n = K.shape[0]
b = np.zeros(n); b[1::6] = -1.0
b += 1e-3 * np.random.default_rng(0).standard_normal(n)
# referencia directa
t = time.perf_counter()
lu = spla.splu(K.tocsc(), permc_spec='MMD_AT_PLUS_A', diag_pivot_thresh=0.0, options=dict(SymmetricMode=True))
x_ref = lu.solve(b)
t_dir = time.perf_counter() - t
del lu
res = dict(K=path.split('/')[-1], n=n, directo_s=round(t_dir, 3))
print(json.dumps(res), flush=True)
SKIP = os.environ.get('PCG_SKIP', '').split(',')


def run(name, M):
    it = [0]

    def cb(xk):
        it[0] += 1
    t = time.perf_counter()
    try:
        x, info = spla.cg(K, b, rtol=rtol, maxiter=maxiter, M=M, callback=cb)
    except TypeError:
        x, info = spla.cg(K, b, tol=rtol, maxiter=maxiter, M=M, callback=cb)
    dt = time.perf_counter() - t
    err = float(np.linalg.norm(x - x_ref) / np.linalg.norm(x_ref))
    res[name] = dict(iter=it[0], converge=(info == 0), s=round(dt, 2), err_rel_vs_directo=float(f'{err:.2e}'))
    print(name, res[name], flush=True)


# Jacobi
d = K.diagonal()
if 'jacobi' in SKIP:
    run = (lambda f: (lambda name, M: None if name.startswith('jacobi') else f(name, M)))(run)
run('jacobi', spla.LinearOperator((n, n), matvec=lambda v: v / d))
# Jacobi por bloques de nudo (6x6)
nb = n // 6
Kb = sp.bsr_matrix(K, blocksize=(6, 6))
blocks = np.zeros((nb, 6, 6))
for i in range(nb):
    s, e = Kb.indptr[i], Kb.indptr[i + 1]
    j = np.nonzero(Kb.indices[s:e] == i)[0][0]
    blocks[i] = Kb.data[s + j]
inv = np.linalg.inv(blocks)
run('jacobi_bloques6', spla.LinearOperator((n, n), matvec=lambda v: np.einsum('nij,nj->ni', inv, v.reshape(nb, 6)).reshape(-1)))
# ILU
for dt_, ff in ([] if 'ilu' in SKIP else ((1e-3, 5), (1e-4, 10))):
    t = time.perf_counter()
    try:
        il = spla.spilu(K.tocsc(), drop_tol=dt_, fill_factor=ff, permc_spec='MMD_AT_PLUS_A', diag_pivot_thresh=0.0,
                        options=dict(SymmetricMode=True))
        tf = time.perf_counter() - t
        res[f'ilu_{dt_}_{ff}_fact_s'] = round(tf, 2)
        res[f'ilu_{dt_}_{ff}_nnz'] = int(il.nnz)
        print(f'ilu_{dt_}_{ff}', 'fact_s', round(tf, 2), 'nnz', int(il.nnz), flush=True)
        run(f'ilu_{dt_}_{ff}', spla.LinearOperator((n, n), matvec=il.solve))
    except Exception as e:
        res[f'ilu_{dt_}_{ff}'] = 'error: ' + str(e)[:80]
# AMG por agregación suavizada con los 6 modos de sólido rígido (pyamg, sólo si está instalado)
if model:
    try:
        import pyamg
        import edificio as ed
        m = ed.build(model[0], h=model[1], storeys=model[2])
        X = m['xyz'][:, [1, 2, 0]][~m['fixed']]
        nn = len(X)
        Bm = np.zeros((nn, 6, 6))
        for a in range(3):
            Bm[:, a, a] = 1.0
        for a in range(3):
            w = np.zeros(3); w[a] = 1.0
            Bm[:, 0:3, 3 + a] = np.cross(w, X)
            Bm[:, 3 + a, 3 + a] = 1.0
        Bm = Bm.reshape(nn * 6, 6)
        t = time.perf_counter()
        ml = pyamg.smoothed_aggregation_solver(sp.bsr_matrix(K, blocksize=(6, 6)), B=Bm, max_coarse=2000, max_levels=15, coarse_solver='splu', strength=('symmetric', {'theta': 0.0}))
        res['amg_setup_s'] = round(time.perf_counter() - t, 2)
        res['amg_niveles'] = len(ml.levels)
        print('amg setup', res['amg_setup_s'], 'niveles', len(ml.levels), 'complejidad_op', round(ml.operator_complexity(), 2), flush=True)
        run('amg_sa_rbm', ml.aspreconditioner(cycle='V'))
    except Exception as e:
        res['amg'] = 'error: ' + str(e)[:120]
print(json.dumps(res), flush=True)
