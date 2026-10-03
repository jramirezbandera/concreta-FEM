"""Prepara las K del spike E0 en formato .kcsc (triángulo superior CSC, índices u32).

Formato .kcsc (little-endian, todo alineado a 8 bytes):
  cabecera 16 B: b'KCSC', u32 versión (1), u32 n, u32 nnz
  f64[nnz] valores · u32[n+1] col_ptr · u32[nnz] row_idx

Uso:
  python preparar_k.py npz K11.npz salida.kcsc       K reales del edificio objetivo (vec_asm.py, H51/H52)
  python preparar_k.py sintetico 90 salida.kcsc       K sintética de 07-candidatos (n=90 -> 360 360 GDL)
"""
import sys, struct
import numpy as np
import scipy.sparse as sp


def escribir(K, ruta):
    U = sp.triu(K, format="csc")
    U.sum_duplicates()
    U.sort_indices()
    n, nnz = U.shape[0], U.nnz
    assert nnz < 2**32 and n < 2**32
    with open(ruta, "wb") as f:
        f.write(b"KCSC" + struct.pack("<III", 1, n, nnz))
        f.write(U.data.astype("<f8").tobytes())
        f.write(U.indptr.astype("<u4").tobytes())
        f.write(U.indices.astype("<u4").tobytes())
    print(f"{ruta}: n={n} nnz(sup)={nnz}")


def sintetico(n):
    """Copia literal del grafo de 07-candidatos/bench/bench_solvers.py (build_graph) y K = G ⊗ B6."""
    F = 7
    L_planta = 45.0
    h = L_planta / (n - 1)
    nid = lambda f, i, j: f * n * n + i * n + j
    quads = []
    I, J = np.meshgrid(np.arange(n - 1), np.arange(n - 1), indexing="ij")
    I = I.ravel(); J = J.ravel()
    for f in range(F):
        base = f * n * n
        quads.append(np.stack([base + I * n + J, base + (I + 1) * n + J,
                               base + (I + 1) * n + J + 1, base + I * n + J + 1], 1))
    quads = np.concatenate(quads)
    nnodes = F * n * n
    pi = np.linspace(0, n - 1, 10).round().astype(int)
    pj = np.linspace(0, n - 1, 8).round().astype(int)
    PI, PJ = np.meshgrid(pi, pj, indexing="ij")
    bars = []
    for f in range(1, F):
        bars.append(np.stack([f * n * n + PI.ravel() * n + PJ.ravel(),
                              (f - 1) * n * n + PI.ravel() * n + PJ.ravel()], 1))
    bars = np.concatenate(bars)
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
    rng = np.random.default_rng(0)
    R = rng.standard_normal((6, 6)); B6 = R @ R.T + 6 * np.eye(6)
    return sp.kron(G, B6, format="csc")


if __name__ == "__main__":
    modo = sys.argv[1]
    if modo == "npz":
        escribir(sp.load_npz(sys.argv[2]).tocsc(), sys.argv[3])
    elif modo == "sintetico":
        escribir(sintetico(int(sys.argv[2])), sys.argv[3])
    else:
        sys.exit(__doc__)
