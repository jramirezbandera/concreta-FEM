"""Vía (b): ensamblado propio vectorizado (numpy) que reproduce las matrices de PyNite 3.2.0
(Quad3D DKMQ + Q4 con muelle de drilling; Member3D Euler-Bernoulli; barras biarticuladas con la
torsión liberada) y solución con SuperLU de scipy (splu una vez, varios lados derechos).

Trabaja en el sistema Y-up de PyNite: (Xp, Yp, Zp) = (Yc, Zc, Xc).
Ensambla por bloques 6x6 de pares de nudos (BSR) con np.bincount: memoria ~ nnz_nodal*288 B.
"""
from __future__ import annotations
import time
import numpy as np
import scipy.sparse as sp

import edificio as ed

GP = 1 / 3**0.5
GPTS = ((-GP, -GP), (GP, -GP), (GP, GP), (-GP, GP))


def yup(xyz):
    return np.ascontiguousarray(xyz[:, [1, 2, 0]])


def _unit(v):
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


# --------------------------------------------------------------------------- quads
def quad_local(X):
    """Coordenadas locales (como Quad3D._local_coords) y matriz de giro R (como Quad3D.T)."""
    X1, X2, X3, X4 = X[:, 0], X[:, 1], X[:, 2], X[:, 3]
    v12, v13, v14 = X2 - X1, X3 - X1, X4 - X1
    xa = _unit(v12)
    za = np.cross(v12, v13)
    ya = _unit(np.cross(za, v12))
    ne = len(X)
    x = np.zeros((ne, 4)); y = np.zeros((ne, 4))
    for k, v in ((1, v12), (2, v13), (3, v14)):
        x[:, k] = np.einsum('ei,ei->e', v, xa)
        y[:, k] = np.einsum('ei,ei->e', v, ya)
    # T(): eje x de i a j, z = x × (n - i), y = z × x
    rx = xa
    rz = _unit(np.cross(rx, X4 - X1))
    ry = _unit(np.cross(rz, rx))
    R = np.stack([rx, ry, rz], axis=1)  # (ne,3,3) filas = ejes locales
    return x, y, R


def _jac(x, y, xi, eta):
    dNxi = 0.25 * np.array([eta - 1, -(eta - 1), eta + 1, -(eta + 1)])
    dNeta = 0.25 * np.array([xi - 1, -(xi + 1), xi + 1, -(xi - 1)])
    J11 = x @ dNxi; J12 = y @ dNxi; J21 = x @ dNeta; J22 = y @ dNeta
    det = J11 * J22 - J12 * J21
    j11, j12, j21, j22 = J22 / det, -J12 / det, -J21 / det, J11 / det
    return dNxi, dNeta, det, j11, j12, j21, j22


# permutación final de Quad3D.ke_b: signo en 4,10,16,22 y cambio 3<->4, 9<->10, ...
_PERM = np.arange(24)
for _a in (3, 9, 15, 21):
    _PERM[_a], _PERM[_a + 1] = _a + 1, _a
_SIGN = np.ones(24)
_SIGN[[4, 10, 16, 22]] = -1
_MAP12 = np.array([2, 3, 4, 8, 9, 10, 14, 15, 16, 20, 21, 22])
_MAP8 = np.array([0, 1, 6, 7, 12, 13, 18, 19])


def quad_Ke(X, t, E, nu):
    """Matrices de rigidez globales (ne,24,24) idénticas a Quad3D.Ke() de PyNite 3.2.0."""
    ne = len(X)
    x, y, R = quad_local(X)
    dx = np.roll(x, -1, axis=1) - x
    dy = np.roll(y, -1, axis=1) - y
    L = np.sqrt(dx**2 + dy**2)
    C, S = dx / L, dy / L
    kap = 5 / 6
    phi = 2 / (kap * (1 - nu)) * (t[:, None] / L) ** 2
    Au = np.zeros((ne, 4, 12))
    for k in range(4):
        a, b = k, (k + 1) % 4
        Au[:, k, 3 * a] = -1 / L[:, k]; Au[:, k, 3 * a + 1] = C[:, k] / 2; Au[:, k, 3 * a + 2] = S[:, k] / 2
        Au[:, k, 3 * b] = 1 / L[:, k]; Au[:, k, 3 * b + 1] = C[:, k] / 2; Au[:, k, 3 * b + 2] = S[:, k] / 2
    ADinv = -1.5 / (1 + phi)                       # (ne,4)
    Ags = np.stack([L[:, 0] / 2, L[:, 1] / 2, -L[:, 2] / 2, -L[:, 3] / 2], axis=1) * (phi / (1 + phi))
    Db = E * t**3 / (12 * (1 - nu**2))
    Ds = E * t * kap / (2 * (1 + nu))
    Hb = np.array([[1, nu, 0], [nu, 1, 0], [0, 0, (1 - nu) / 2]])
    G = E / (2 * (1 + nu))
    Cm = 1 / (1 - nu**2) * np.array([[E, nu * E, 0], [nu * E, E, 0], [0, 0, (1 - nu**2) * G]])
    kb = np.zeros((ne, 12, 12)); km = np.zeros((ne, 8, 8))
    for xi, eta in GPTS:
        dNxi, dNeta, det, j11, j12, j21, j22 = _jac(x, y, xi, eta)
        Nx = j11[:, None] * dNxi + j12[:, None] * dNeta     # (ne,4)
        Ny = j21[:, None] * dNxi + j22[:, None] * dNeta
        Bbb = np.zeros((ne, 3, 12))
        Bbb[:, 0, 1::3] = Nx; Bbb[:, 1, 2::3] = Ny; Bbb[:, 2, 1::3] = Ny; Bbb[:, 2, 2::3] = Nx
        Pxi = np.array([xi * (eta - 1), -0.5 * (eta - 1) * (eta + 1), -xi * (eta + 1), 0.5 * (eta - 1) * (eta + 1)])
        Peta = np.array([0.5 * (xi - 1) * (xi + 1), -eta * (xi + 1), -0.5 * (xi - 1) * (xi + 1), eta * (xi - 1)])
        Px = j11[:, None] * Pxi + j12[:, None] * Peta
        Py = j21[:, None] * Pxi + j22[:, None] * Peta
        BD = np.stack([Px * C, Py * S, Py * C + Px * S], axis=1)          # (ne,3,4)
        Bb = Bbb + np.einsum('eik,ek,ekj->eij', BD, ADinv, Au)
        Ng = np.array([[0.5 * (1 - eta), 0, 0.5 * (1 + eta), 0], [0, 0.5 * (1 + xi), 0, 0.5 * (1 - xi)]])
        Jinv = np.stack([np.stack([j11, j12], -1), np.stack([j21, j22], -1)], 1)  # (ne,2,2)
        Bs = np.einsum('eab,bk,ek,ekj->eaj', Jinv, Ng, Ags, Au)             # (ne,2,12)
        w = det
        kb += np.einsum('eki,kl,elj,e->eij', Bb, Hb, Bb, Db * w, optimize=True)
        kb += np.einsum('eki,ekj,e->eij', Bs, Bs, Ds * w, optimize=True)
        Bm = np.zeros((ne, 3, 8))
        Bm[:, 0, 0::2] = Nx; Bm[:, 1, 1::2] = Ny; Bm[:, 2, 0::2] = Ny; Bm[:, 2, 1::2] = Nx
        km += np.einsum('eki,kl,elj,e->eij', Bm, Cm, Bm, t * w, optimize=True)
    rz = np.min(np.abs(kb[:, [1, 2, 4, 5, 7, 8, 10, 11], [1, 2, 4, 5, 7, 8, 10, 11]]), axis=1) / 1000
    ke = np.zeros((ne, 24, 24))
    ke[:, _MAP12[:, None], _MAP12[None, :]] = kb
    for d in (5, 11, 17, 23):
        ke[:, d, d] = rz
    ke *= _SIGN[None, :, None] * _SIGN[None, None, :]
    ke = ke[:, _PERM][:, :, _PERM]
    ke[:, _MAP8[:, None], _MAP8[None, :]] += km
    K5 = ke.reshape(ne, 8, 3, 8, 3)
    Kg = np.einsum('eip,eaibj,ejq->eapbq', R, K5, R, optimize=True)
    return Kg.reshape(ne, 24, 24), R


def quad_FER_w(X, p):
    """Fuerza nodal equivalente (fer local en w) por presión p (como Quad3D.fer, combo factor 1).
    Devuelve (ne,4) = componente local z por nudo; el global es fw * R[2,:]."""
    x, y, R = quad_local(X)
    pp = -p
    f = np.zeros((len(X), 4))
    for xi, eta in GPTS:
        _, _, det, *_ = _jac(x, y, xi, eta)
        N = 0.25 * np.array([(1 - xi) * (1 - eta), (1 + xi) * (1 - eta), (1 + xi) * (1 + eta), (1 - xi) * (1 + eta)])
        f += (pp * det)[:, None] * N[None, :]
    return f, R


# --------------------------------------------------------------------------- barras
def member_R(Xi, Xj):
    v = Xj - Xi
    L = np.linalg.norm(v, axis=1)
    x = v / L[:, None]
    ne = len(Xi)
    y = np.zeros((ne, 3)); z = np.zeros((ne, 3))
    vert = np.isclose(Xi[:, 0], Xj[:, 0], rtol=1e-9, atol=0) & np.isclose(Xi[:, 2], Xj[:, 2], rtol=1e-9, atol=0)
    hor = (~vert) & np.isclose(Xi[:, 1], Xj[:, 1], rtol=1e-9, atol=0)
    up = Xj[:, 1] > Xi[:, 1]
    y[vert & up] = (-1, 0, 0); y[vert & ~up] = (1, 0, 0); z[vert] = (0, 0, 1)
    y[hor] = (0, 1, 0)
    z[hor] = _unit(np.cross(x[hor], y[hor]))
    oth = ~(vert | hor)
    if oth.any():
        proj = v[oth].copy(); proj[:, 1] = 0
        zz = np.where(up[oth][:, None], np.cross(proj, x[oth]), np.cross(x[oth], proj))
        z[oth] = _unit(zz)
        y[oth] = _unit(np.cross(z[oth], x[oth]))
    R = np.stack([x, y, z], axis=1)
    return R, L


def member_Ke(Xi, Xj, E, G, A, Iy, Iz, J, truss):
    R, L = member_R(Xi, Xj)
    ne = len(L)
    k = np.zeros((ne, 12, 12))
    EA = E * A / L
    k[:, 0, 0] = k[:, 6, 6] = EA; k[:, 0, 6] = k[:, 6, 0] = -EA
    fr = ~truss
    L_, E_, Iz_, Iy_, G_, J_ = L[fr], E[fr], Iz[fr], Iy[fr], G[fr], J[fr]
    a = 12 * E_ * Iz_ / L_**3; b = 6 * E_ * Iz_ / L_**2; c = 4 * E_ * Iz_ / L_; d = 2 * E_ * Iz_ / L_
    kf = k[fr]
    for (i, j, v) in ((1, 1, a), (1, 5, b), (1, 7, -a), (1, 11, b), (5, 5, c), (5, 7, -b), (5, 11, d),
                      (7, 7, a), (7, 11, -b), (11, 11, c)):
        kf[:, i, j] = v; kf[:, j, i] = v
    a = 12 * E_ * Iy_ / L_**3; b = 6 * E_ * Iy_ / L_**2; c = 4 * E_ * Iy_ / L_; d = 2 * E_ * Iy_ / L_
    for (i, j, v) in ((2, 2, a), (2, 4, -b), (2, 8, -a), (2, 10, -b), (4, 4, c), (4, 8, b), (4, 10, d),
                      (8, 8, a), (8, 10, b), (10, 10, c)):
        kf[:, i, j] = v; kf[:, j, i] = v
    gj = G_ * J_ / L_
    kf[:, 3, 3] = kf[:, 9, 9] = gj; kf[:, 3, 9] = kf[:, 9, 3] = -gj
    k[fr] = kf
    K4 = k.reshape(ne, 4, 3, 4, 3)
    Kg = np.einsum('eip,eaibj,ejq->eapbq', R, K4, R, optimize=True)
    return Kg.reshape(ne, 12, 12), R, L


def member_FER_unifY(R, L, w):
    """FER global de una carga uniforme w (N/m) en FY global en toda la barra (como PyNite)."""
    wl = R[:, :, 1] * w[:, None]       # componentes locales (x,y,z) de [0,w,0]
    wx, wy, wz = wl[:, 0], wl[:, 1], wl[:, 2]
    f = np.zeros((len(L), 12))
    f[:, 0] = f[:, 6] = -wx * L / 2
    f[:, 1] = f[:, 7] = -wy * L / 2
    f[:, 2] = f[:, 8] = -wz * L / 2
    f[:, 4] = wz * L**2 / 12; f[:, 10] = -wz * L**2 / 12
    f[:, 5] = -wy * L**2 / 12; f[:, 11] = wy * L**2 / 12
    fg = np.einsum('eip,eai->eap', R, f.reshape(-1, 4, 3))
    return fg.reshape(-1, 12)


# --------------------------------------------------------------------------- ensamblado
def node_pattern(N, conns):
    """Patrón nodal (CSR ordenado) de pares de nudos; conns = lista de arrays (ne, nn)."""
    keys = []
    for c in conns:
        nn = c.shape[1]
        keys.append((c[:, :, None].astype(np.int64) * N + c[:, None, :]).reshape(-1))
    keys = np.unique(np.concatenate(keys))
    rows = keys // N; cols = keys % N
    indptr = np.zeros(N + 1, dtype=np.int64)
    cnt = np.bincount(rows, minlength=N)
    indptr[1:] = np.cumsum(cnt)
    return keys, cols, indptr


def assemble(m, chunk=4000, T=None):
    T = T if T is not None else {}
    tick = time.perf_counter
    t = tick()
    X = yup(m['xyz'])
    N = len(X)
    E, nu = ed.E_C, ed.NU_C
    G = E / (2 * (1 + nu))
    qd = m['quads']; mem = m['mem']
    keys, bcols, indptr = node_pattern(N, [mem[:, :2], qd])
    nb = len(keys)
    data = np.zeros((nb, 36))
    T['pattern'] = tick() - t; t = tick()

    def scatter(conn, Ke):
        nn = conn.shape[1]
        ne = len(conn)
        k = (conn[:, :, None].astype(np.int64) * N + conn[:, None, :]).reshape(-1)
        pos = np.searchsorted(keys, k)
        blk = Ke.reshape(ne, nn, 6, nn, 6).transpose(0, 1, 3, 2, 4).reshape(-1)
        idx = (pos[:, None] * 36 + np.arange(36)).reshape(-1)
        data.reshape(-1)[:] += np.bincount(idx, weights=blk, minlength=nb * 36)

    for s in range(0, len(qd), chunk):
        c = qd[s:s + chunk]
        Ke, _ = quad_Ke(X[c], m['qt'][s:s + chunk], E, nu)
        T['ke_quads'] = T.get('ke_quads', 0) + tick() - t; t = tick()
        scatter(c, Ke)
        T['scatter'] = T.get('scatter', 0) + tick() - t; t = tick()
    sec = m['sec'][mem[:, 3]]
    mat = mem[:, 4]
    Em = np.where(mat == 1, ed.ALPHA_PEN * E, E); Gm = np.where(mat == 1, ed.ALPHA_PEN * G, G)
    for s in range(0, len(mem), chunk * 3):
        sl = slice(s, s + chunk * 3)
        c = mem[sl, :2]
        Ke, _, _ = member_Ke(X[c[:, 0]], X[c[:, 1]], Em[sl], Gm[sl], sec[sl, 0], sec[sl, 1], sec[sl, 2], sec[sl, 3], m['rel'][sl])
        T['ke_barras'] = T.get('ke_barras', 0) + tick() - t; t = tick()
        scatter(c, Ke)
        T['scatter'] = T.get('scatter', 0) + tick() - t; t = tick()
    K = sp.bsr_matrix((data.reshape(nb, 6, 6), bcols, indptr), shape=(6 * N, 6 * N))
    T['bsr'] = tick() - t
    return K, T


def loads(m, cases=None, T=None):
    T = T if T is not None else {}
    t = time.perf_counter()
    X = yup(m['xyz'])
    N = len(X)
    cases = cases or list(m['cargas'])
    F = np.zeros((6 * N, len(cases)))   # P - FER
    dirp = {0: 2, 1: 0, 2: 1}            # Concreta -> índice global PyNite
    for j, c in enumerate(cases):
        Lc = m['cargas'][c]
        if 'quad_p' in Lc:
            idx = Lc['quad_p'].nonzero()[0]
            if idx.size:
                conn = m['quads'][idx]
                fw, R = quad_FER_w(X[conn], Lc['quad_p'][idx])
                fg = fw[:, :, None] * R[:, None, 2, :]          # (ne,4,3)
                for a in range(4):
                    for d in range(3):
                        F[:, j] -= np.bincount(6 * conn[:, a] + d, weights=fg[:, a, d], minlength=6 * N)
        if 'mem_w' in Lc:
            idx = Lc['mem_w'].nonzero()[0]
            if idx.size:
                conn = m['mem'][idx, :2]
                R, L = member_R(X[conn[:, 0]], X[conn[:, 1]])
                fg = member_FER_unifY(R, L, Lc['mem_w'][idx])
                for a in range(2):
                    for d in range(6):
                        F[:, j] -= np.bincount(6 * conn[:, a] + d, weights=fg[:, 6 * a + d], minlength=6 * N)
        if 'nodal' in Lc:
            nodes, d, val = Lc['nodal']
            np.add.at(F[:, j], 6 * nodes + dirp[d], val)
    T['cargas'] = time.perf_counter() - t
    return F, cases


def solve(m, permc='COLAMD', T=None, save_k11=None, info=None, symmetric=False):
    import scipy.sparse.linalg as spla
    T = T if T is not None else {}
    K, T = assemble(m, T=T)
    F, cases = loads(m, T=T)
    t = time.perf_counter()
    fixed = m['fixed']
    freeN = np.nonzero(~fixed)[0]
    dof = (6 * freeN[:, None] + np.arange(6)).reshape(-1)
    Kc = K.tocsr()
    Kc.eliminate_zeros()
    K11 = Kc[dof][:, dof].tocsc()
    K11.sort_indices()
    T['particion'] = time.perf_counter() - t; t = time.perf_counter()
    if save_k11:
        sp.save_npz(save_k11, K11, compressed=False)
        t = time.perf_counter()
    if symmetric:
        lu = spla.splu(K11, permc_spec=permc, diag_pivot_thresh=0.0, options=dict(SymmetricMode=True))
    else:
        lu = spla.splu(K11, permc_spec=permc)
    T['factoriza'] = time.perf_counter() - t; t = time.perf_counter()
    RHS = F[dof]
    X1 = lu.solve(RHS)
    T['resuelve'] = time.perf_counter() - t; t = time.perf_counter()
    r = K11 @ X1 - RHS
    rel = np.linalg.norm(r, axis=0) / np.maximum(np.linalg.norm(RHS, axis=0), 1e-300)
    D = np.zeros_like(F)
    D[dof] = X1
    Rx = Kc @ D - F                       # reacciones en GDL coaccionados
    T['residuo+reacc'] = time.perf_counter() - t
    if info is not None:
        info.update(n=int(K11.shape[0]), nnz_K11=int(K11.nnz), nnz_LU=int(lu.nnz),
                    res_rel_max=float(rel.max()), RyG_kN=float(Rx[1::6, cases.index('G')].sum() / 1e3))
    return D, Rx, T


# --------------------------------------------------------------------------- variante con poca memoria
def heap_mb():
    """Tamaño del heap WASM en Pyodide (MB); None en CPython."""
    try:
        import pyodide_js
        return round(pyodide_js._module.HEAP8.buffer.byteLength / 2**20, 1)
    except Exception:
        return None


def solve_lean(m, permc='MMD_AT_PLUS_A', symmetric=True, T=None, info=None, chunk=2000, save_k11=None):
    """Igual que solve() pero construye K11 (GDL libres) directamente desde los bloques, en CSC con
    índices int32, libera todo lo intermedio antes de factorizar y traza el heap WASM por fase."""
    import gc
    import scipy.sparse.linalg as spla
    T = T if T is not None else {}
    H = {}
    H['inicio'] = heap_mb()
    F, cases = loads(m, T=T)
    t = time.perf_counter()
    X = yup(m['xyz'])
    N = len(X)
    E, nu = ed.E_C, ed.NU_C
    G = E / (2 * (1 + nu))
    qd = m['quads']; mem = m['mem']
    keys, bcols, indptr = node_pattern(N, [mem[:, :2], qd])
    nb = len(keys)
    data = np.zeros(nb * 36)
    T['pattern'] = time.perf_counter() - t; t = time.perf_counter()

    def scatter(conn, Ke):
        nn = conn.shape[1]
        ne = len(conn)
        k = (conn[:, :, None].astype(np.int64) * N + conn[:, None, :]).reshape(-1)
        pos = np.searchsorted(keys, k)
        blk = Ke.reshape(ne, nn, 6, nn, 6).transpose(0, 1, 3, 2, 4).reshape(-1)
        idx = (pos[:, None] * 36 + np.arange(36)).reshape(-1)
        data[:] += np.bincount(idx, weights=blk, minlength=nb * 36)

    for s in range(0, len(qd), chunk):
        c = qd[s:s + chunk]
        Ke, _ = quad_Ke(X[c], m['qt'][s:s + chunk], E, nu)
        T['ke_quads'] = T.get('ke_quads', 0) + time.perf_counter() - t; t = time.perf_counter()
        scatter(c, Ke); del Ke
        T['scatter'] = T.get('scatter', 0) + time.perf_counter() - t; t = time.perf_counter()
    sec = m['sec'][mem[:, 3]]
    mat = mem[:, 4]
    Em = np.where(mat == 1, ed.ALPHA_PEN * E, E); Gm = np.where(mat == 1, ed.ALPHA_PEN * G, G)
    for s in range(0, len(mem), chunk * 3):
        sl = slice(s, s + chunk * 3)
        c = mem[sl, :2]
        Ke, _, _ = member_Ke(X[c[:, 0]], X[c[:, 1]], Em[sl], Gm[sl], sec[sl, 0], sec[sl, 1], sec[sl, 2], sec[sl, 3], m['rel'][sl])
        T['ke_barras'] = T.get('ke_barras', 0) + time.perf_counter() - t; t = time.perf_counter()
        scatter(c, Ke); del Ke
        T['scatter'] = T.get('scatter', 0) + time.perf_counter() - t; t = time.perf_counter()
    H['tras_ensamblar'] = heap_mb()
    # K11 directamente de los bloques: filas y columnas de nudos libres, sin ceros
    rowsN = keys // N
    del keys
    free = ~m['fixed']
    newid = np.full(N, -1, dtype=np.int64)
    newid[free] = np.arange(int(free.sum()))
    keep = free[rowsN] & free[bcols]
    D = data.reshape(nb, 36)
    rr = newid[rowsN[keep]]; cc = newid[bcols[keep]]
    Dk = D[keep]
    # reacciones: bloques con fila coaccionada y columna libre (pocos)
    kr = (~free[rowsN]) & free[bcols]
    R_rows, R_cols, R_D = rowsN[kr], newid[bcols[kr]], D[kr]
    del D, data, rowsN, keep, kr
    nz = Dk != 0.0
    loc = np.nonzero(nz)
    vals = Dk[loc]
    I = (6 * rr[loc[0]] + loc[1] // 6).astype(np.int32)
    J = (6 * cc[loc[0]] + loc[1] % 6).astype(np.int32)
    del Dk, nz, loc, rr, cc
    nfree = 6 * int(free.sum())
    K11 = sp.csc_matrix((vals, (I, J)), shape=(nfree, nfree))
    del vals, I, J
    gc.collect()
    K11.sort_indices()
    T['particion'] = time.perf_counter() - t; t = time.perf_counter()
    H['K11'] = heap_mb()
    if save_k11:
        sp.save_npz(save_k11, K11, compressed=False)
        t = time.perf_counter()
    freeN = np.nonzero(free)[0]
    dof = (6 * freeN[:, None] + np.arange(6)).reshape(-1)
    RHS = np.ascontiguousarray(F[dof])
    if symmetric:
        lu = spla.splu(K11, permc_spec=permc, diag_pivot_thresh=0.0, options=dict(SymmetricMode=True))
    else:
        lu = spla.splu(K11, permc_spec=permc)
    T['factoriza'] = time.perf_counter() - t; t = time.perf_counter()
    H['tras_factorizar'] = heap_mb()
    X1 = lu.solve(RHS)
    T['resuelve'] = time.perf_counter() - t; t = time.perf_counter()
    r = K11 @ X1 - RHS
    rel = np.linalg.norm(r, axis=0) / np.maximum(np.linalg.norm(RHS, axis=0), 1e-300)
    # reacción vertical total del caso G (suma de filas FY de los nudos coaccionados)
    jG = cases.index('G')
    Xb = X1[:, jG].reshape(-1, 6)
    fy = np.einsum('bj,bj->b', R_D.reshape(-1, 6, 6)[:, 1, :], Xb[R_cols])
    RyG = float(fy.sum() - F[6 * np.nonzero(~free)[0] + 1, jG].sum())
    T['residuo+reacc'] = time.perf_counter() - t
    if info is not None:
        info.update(n=int(K11.shape[0]), nnz_K11=int(K11.nnz), nnz_LU=int(lu.nnz),
                    res_rel_max=float(rel.max()), RyG_kN=RyG / 1e3, heap=H)
    return X1, T
