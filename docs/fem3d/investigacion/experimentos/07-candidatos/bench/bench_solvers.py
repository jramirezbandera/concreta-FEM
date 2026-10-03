# Benchmark de solvers dispersos sobre una matriz sintética con el patrón de un edificio
# de 7 plantas (losas como malla de quads n×n, 80 pilares por planta, dos núcleos de muros),
# 6 GDL por nudo con acoplamiento completo entre nudos vecinos (como láminas + barras).
# Los valores son sintéticos (Laplaciano del grafo ⊗ bloque 6×6 SPD): sólo importan
# el patrón y que sea SPD. Mide SuperLU (scipy) y CHOLMOD (SuiteSparse 5.11 de Pyodide).
import sys, time, json, ctypes, os
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla

n = int(sys.argv[1])            # nudos por lado de la losa
which = sys.argv[2]             # "superlu", "cholmod" o "both"
nrhs = int(sys.argv[3]) if len(sys.argv) > 3 else 24
F = 7
L_planta = 45.0                 # ~2 000 m² por planta
h = L_planta / (n - 1)

def build_graph():
    nid = lambda f, i, j: f * n * n + i * n + j
    quads = []
    # losas
    I, J = np.meshgrid(np.arange(n - 1), np.arange(n - 1), indexing="ij")
    I = I.ravel(); J = J.ravel()
    for f in range(F):
        base = f * n * n
        quads.append(np.stack([base + I * n + J, base + (I + 1) * n + J,
                               base + (I + 1) * n + J + 1, base + I * n + J + 1], 1))
    quads = np.concatenate(quads)
    nnodes = F * n * n
    # pilares: 10 x 8 = 80 por planta, un elemento por planta
    pi = np.linspace(0, n - 1, 10).round().astype(int)
    pj = np.linspace(0, n - 1, 8).round().astype(int)
    PI, PJ = np.meshgrid(pi, pj, indexing="ij")
    bars = []
    for f in range(1, F):
        bars.append(np.stack([f * n * n + PI.ravel() * n + PJ.ravel(),
                              (f - 1) * n * n + PI.ravel() * n + PJ.ravel()], 1))
    bars = np.concatenate(bars)
    # dos núcleos de muros (8 x 6 m) con filas intermedias de nudos entre plantas
    ni = max(2, round(8.0 / h)); nj = max(2, round(6.0 / h)); m = max(0, round(3.0 / h) - 1)
    wq = []
    for (ci, cj) in [(n // 3, n // 3), (2 * n // 3 - ni, 2 * n // 3 - nj)]:
        per = [(ci + a, cj) for a in range(ni)] + [(ci + ni, cj + b) for b in range(nj)] + \
              [(ci + ni - a, cj + nj) for a in range(ni)] + [(ci, cj + nj - b) for b in range(nj)]
        P = len(per)
        for f in range(1, F):
            rows = [[nid(f - 1, i, j) for (i, j) in per]]
            for k in range(m):
                rows.append(list(range(nnodes, nnodes + P))); nnodes += P
            rows.append([nid(f, i, j) for (i, j) in per])
            for r in range(len(rows) - 1):
                a, b = rows[r], rows[r + 1]
                for p in range(P):
                    q = (p + 1) % P
                    wq.append((a[p], a[q], b[q], b[p]))
    quads = np.concatenate([quads, np.array(wq, dtype=quads.dtype)])
    # Laplaciano del grafo de conectividad (+ diagonal) => SPD
    rows, cols = [], []
    for E in (quads, bars):
        k = E.shape[1]
        for a in range(k):
            for b in range(k):
                if a != b:
                    rows.append(E[:, a]); cols.append(E[:, b])
    rows = np.concatenate(rows); cols = np.concatenate(cols)
    A = sp.coo_matrix((-np.ones(rows.size), (rows, cols)), shape=(nnodes, nnodes)).tocsr()
    A.sum_duplicates()
    A.data[:] = -1.0
    deg = -np.asarray(A.sum(axis=1)).ravel()
    G = (A + sp.diags(deg + 0.05)).tocsc()
    return G, quads.shape[0], bars.shape[0]

rng = np.random.default_rng(0)
R = rng.standard_normal((6, 6)); B6 = R @ R.T + 6 * np.eye(6)

t0 = time.perf_counter()
G, nq, nb = build_graph()
N = G.shape[0]
info = {"n": n, "nodes": int(N), "dof": int(6 * N), "quads": int(nq), "bars": int(nb), "nnzG": int(G.nnz)}
info["t_graph_s"] = round(time.perf_counter() - t0, 2)

def lower_K():
    Gl = sp.tril(G, -1, format="csc")
    D = sp.diags(G.diagonal())
    Kl = sp.kron(Gl, B6, format="csc") + sp.kron(D, np.tril(B6), format="csc")
    Kl = Kl.tocsc(); Kl.sort_indices()
    return Kl

if which in ("superlu", "both"):
    t0 = time.perf_counter()
    K = sp.kron(G, B6, format="csc").tocsc()
    info["nnzK"] = int(K.nnz); info["t_buildK_s"] = round(time.perf_counter() - t0, 2)
    t0 = time.perf_counter()
    lu = spla.splu(K, permc_spec="MMD_AT_PLUS_A", diag_pivot_thresh=0.0,
                   options=dict(SymmetricMode=True))
    info["superlu_factor_s"] = round(time.perf_counter() - t0, 2)
    info["superlu_nnzLU"] = int(lu.nnz)
    b = rng.standard_normal((K.shape[0], nrhs))
    t0 = time.perf_counter(); x = lu.solve(b); info["superlu_solve_%drhs_s" % nrhs] = round(time.perf_counter() - t0, 2)
    info["superlu_relres"] = float(np.linalg.norm(K @ x - b) / np.linalg.norm(b))
    del lu, K, x

if which in ("cholmod", "both", "simplicial"):
    Kl = lower_K()
    nK = Kl.shape[0]
    info["nnzKlower"] = int(Kl.nnz)
    libdir = None
    for d in ("/usr/lib", "/lib", "/lib/python3.14/site-packages"):
        if os.path.exists(os.path.join(d, "libcholmod.so")): libdir = d
    chol = ctypes.CDLL(os.path.join(libdir, "libcholmod.so"), mode=os.RTLD_LAZY | os.RTLD_GLOBAL)
    class Sparse(ctypes.Structure):
        _fields_ = [("nrow", ctypes.c_size_t), ("ncol", ctypes.c_size_t), ("nzmax", ctypes.c_size_t),
                    ("p", ctypes.c_void_p), ("i", ctypes.c_void_p), ("nz", ctypes.c_void_p),
                    ("x", ctypes.c_void_p), ("z", ctypes.c_void_p),
                    ("stype", ctypes.c_int), ("itype", ctypes.c_int), ("xtype", ctypes.c_int),
                    ("dtype", ctypes.c_int), ("sorted", ctypes.c_int), ("packed", ctypes.c_int)]
    class Dense(ctypes.Structure):
        _fields_ = [("nrow", ctypes.c_size_t), ("ncol", ctypes.c_size_t), ("nzmax", ctypes.c_size_t),
                    ("d", ctypes.c_size_t), ("x", ctypes.c_void_p), ("z", ctypes.c_void_p),
                    ("xtype", ctypes.c_int), ("dtype", ctypes.c_int)]
    class Factor(ctypes.Structure):
        _fields_ = [("n", ctypes.c_size_t), ("minor", ctypes.c_size_t), ("Perm", ctypes.c_void_p),
                    ("ColCount", ctypes.c_void_p), ("IPerm", ctypes.c_void_p), ("nzmax", ctypes.c_size_t),
                    ("p", ctypes.c_void_p), ("i", ctypes.c_void_p), ("x", ctypes.c_void_p),
                    ("z", ctypes.c_void_p), ("nz", ctypes.c_void_p), ("next", ctypes.c_void_p),
                    ("prev", ctypes.c_void_p), ("nsuper", ctypes.c_size_t), ("ssize", ctypes.c_size_t),
                    ("xsize", ctypes.c_size_t), ("maxcsize", ctypes.c_size_t), ("maxesize", ctypes.c_size_t),
                    ("super", ctypes.c_void_p), ("pi", ctypes.c_void_p), ("px", ctypes.c_void_p),
                    ("s", ctypes.c_void_p), ("ordering", ctypes.c_int), ("is_ll", ctypes.c_int),
                    ("is_super", ctypes.c_int), ("is_monotonic", ctypes.c_int), ("itype", ctypes.c_int),
                    ("xtype", ctypes.c_int), ("dtype", ctypes.c_int), ("useGPU", ctypes.c_int)]
    common = ctypes.create_string_buffer(1 << 16)
    chol.cholmod_start.argtypes = [ctypes.c_void_p]
    chol.cholmod_analyze.restype = ctypes.POINTER(Factor)
    chol.cholmod_analyze.argtypes = [ctypes.POINTER(Sparse), ctypes.c_void_p]
    chol.cholmod_factorize.argtypes = [ctypes.POINTER(Sparse), ctypes.POINTER(Factor), ctypes.c_void_p]
    chol.cholmod_solve.restype = ctypes.POINTER(Dense)
    chol.cholmod_solve.argtypes = [ctypes.c_int, ctypes.POINTER(Factor), ctypes.POINTER(Dense), ctypes.c_void_p]
    chol.cholmod_start(common)
    info["chk_supernodal_switch"] = ctypes.c_double.from_buffer(common, 32).value
    info["chk_supernodal_default"] = ctypes.c_int.from_buffer(common, 40).value
    if which == "simplicial":
        ctypes.c_int.from_buffer(common, 40).value = 0   # CHOLMOD_SIMPLICIAL (LDL' up-looking, como Eigen SimplicialLDLT/QDLDL)
    indptr = Kl.indptr.astype(np.int32); indices = Kl.indices.astype(np.int32); data = Kl.data.astype(np.float64)
    A = Sparse(nK, nK, data.size, indptr.ctypes.data, indices.ctypes.data, None, data.ctypes.data, None,
               -1, 0, 1, 0, 1, 1)
    t0 = time.perf_counter(); Lf = chol.cholmod_analyze(ctypes.byref(A), common)
    info["cholmod_analyze_s"] = round(time.perf_counter() - t0, 2)
    t0 = time.perf_counter(); ok = chol.cholmod_factorize(ctypes.byref(A), Lf, common)
    info["cholmod_factor_s"] = round(time.perf_counter() - t0, 2)
    Fc = Lf.contents
    cc = np.ctypeslib.as_array(ctypes.cast(Fc.ColCount, ctypes.POINTER(ctypes.c_int32)), shape=(nK,)).astype(np.float64)
    info["nnzL_colcount"] = int(cc.sum()); info["flops_LLt_approx"] = float((cc ** 2).sum())
    info["cholmod_minor_eq_n"] = bool(Fc.minor == nK)
    info["cholmod_is_super"] = int(Fc.is_super); info["cholmod_ordering"] = int(Fc.ordering)
    info["cholmod_xsize"] = int(Fc.xsize) if Fc.is_super else int(Fc.nzmax)
    b = np.asfortranarray(rng.standard_normal((nK, nrhs)))
    Bd = Dense(nK, nrhs, nK * nrhs, nK, b.ctypes.data, None, 1, 0)
    t0 = time.perf_counter(); X = chol.cholmod_solve(0, Lf, ctypes.byref(Bd), common)
    info["cholmod_solve_%drhs_s" % nrhs] = round(time.perf_counter() - t0, 2)
    xs = np.ctypeslib.as_array(ctypes.cast(X.contents.x, ctypes.POINTER(ctypes.c_double)), shape=(nK * nrhs,)).reshape((nrhs, nK)).T
    Kfull = Kl + sp.tril(Kl, -1, format="csc").T
    info["cholmod_relres"] = float(np.linalg.norm(Kfull @ xs - b) / np.linalg.norm(b))

print("BENCH " + json.dumps(info))
