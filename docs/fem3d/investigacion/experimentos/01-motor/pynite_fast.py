"""Driver lineal alternativo a FEModel3D.analyze_linear (PyNite 3.2.0) para el spike.

Reutiliza las matrices de elemento de PyNite (Ke, FER, P) pero:
  * comprueba la estabilidad nodal vectorizada y DEVUELVE la lista (nudo, gdl) en vez de imprimirla;
  * factoriza K11 UNA vez (scipy.sparse.linalg.splu) y resuelve todos los casos como RHS múltiple;
  * des-particiona con indexado numpy (O(n)) en vez de list.index (O(n^2));
  * comprueba residuo y finitud por caso (mismo criterio que Analysis._solve_unknown_disp).
Deja el modelo en el mismo estado que analyze_linear (model._D, node.DX..., reacciones),
así que la API de resultados de PyNite (member.moment_array, quad.moment...) sigue sirviendo.
"""
from __future__ import annotations
import time
import numpy as np
from Pynite import Analysis

DOF_NAMES = ('DX', 'DY', 'DZ', 'RX', 'RY', 'RZ')


class PyNiteInstability(Exception):
    def __init__(self, kind, items=None, msg=''):
        super().__init__(msg or kind)
        self.kind = kind
        self.items = items or []


def sparse_FER(model, combo):
    """Como FEModel3D.FER pero sólo evalúa los elementos con cargas del combo (en un caso
    simple, la mayoría de elementos no tienen carga y PyNite calcula igualmente su FER)."""
    cases = set(combo.factors)
    FER = np.zeros((len(model.nodes) * 6, 1))
    for pm in model.members.values():
        for mb in pm.sub_members.values():
            if any(l[3] in cases for l in mb.PtLoads) or any(l[5] in cases for l in mb.DistLoads):
                dofs = model._build_dof_vector(mb.i_node, mb.j_node)
                FER[dofs, 0] += np.asarray(mb.FER(combo.name), dtype=float).reshape(-1)
    for coll in (model.plates, model.quads):
        for el in coll.values():
            if any(p[1] in cases for p in el.pressures):
                dofs = model._build_dof_vector(el.i_node, el.j_node, el.m_node, el.n_node)
                FER[dofs, 0] += np.asarray(el.FER(combo.name), dtype=float).reshape(-1)
    return FER


def solve_linear(model, check=True, tol=1e-6, timings=None, fer_skip=True):
    import scipy.sparse.linalg as spla
    T = timings if timings is not None else {}

    def tick(k, t0):
        T[k] = T.get(k, 0.0) + time.perf_counter() - t0
        return time.perf_counter()

    t = time.perf_counter()
    Analysis._prepare_model(model)
    t = tick('prepare', t)
    D1_idx, D2_idx, D2 = Analysis._partition_D(model)
    D1_idx = np.asarray(D1_idx, dtype=np.int64)
    D2_idx = np.asarray(D2_idx, dtype=np.int64)
    combos = list(model.load_combos.values())
    t = tick('partition_D', t)
    K = model.Ke(combos[0].name, check_stability=False, sparse=True).tocsr()
    t = tick('Ke', t)
    ndof = K.shape[0]
    nodes = list(model.nodes.values())
    if check:
        diag = K.diagonal()
        sup = np.zeros(ndof, dtype=bool)
        sup[D2_idx] = True
        bad = np.nonzero((diag == 0.0) & ~sup)[0]
        if bad.size:
            items = [(nodes[i // 6].name, DOF_NAMES[i % 6]) for i in bad]
            raise PyNiteInstability('nodal', items, f'{len(items)} gdl sin rigidez')
    t = tick('check_nodal', t)
    K11 = K[D1_idx, :][:, D1_idx].tocsc()
    K12 = K[D1_idx, :][:, D2_idx].tocsr()
    t = tick('partition_K', t)
    RHS = np.empty((D1_idx.size, len(combos)))
    for j, c in enumerate(combos):
        F = sparse_FER(model, c)[:, 0] if fer_skip else model.FER(c.name)[:, 0]
        P = model.P(c.name)[:, 0]
        RHS[:, j] = P[D1_idx] - F[D1_idx] - K12 @ D2[:, 0]
    t = tick('FER+P', t)
    lu = spla.splu(K11)
    t = tick('factorize', t)
    X = lu.solve(RHS)
    t = tick('solve_all', t)
    if check:
        R = K11 @ X - RHS
        rn = np.linalg.norm(R, axis=0)
        bn = np.linalg.norm(RHS, axis=0)
        bad = (~np.isfinite(X).all(axis=0)) | np.where(bn > 0, rn > tol * bn, np.linalg.norm(X, axis=0) > tol)
        if bad.any():
            raise PyNiteInstability('global', [combos[j].name for j in np.nonzero(bad)[0]],
                                    'matriz singular (mecanismo o apoyos insuficientes)')
    t = tick('residual', t)
    model._D = {}
    for j, c in enumerate(combos):
        D = np.zeros((ndof, 1))
        D[D1_idx, 0] = X[:, j]
        D[D2_idx, 0] = D2[:, 0]
        model._D[c.name] = D
        for n in nodes:
            b = n.ID * 6
            n.DX[c.name], n.DY[c.name], n.DZ[c.name] = D[b, 0], D[b + 1, 0], D[b + 2, 0]
            n.RX[c.name], n.RY[c.name], n.RZ[c.name] = D[b + 3, 0], D[b + 4, 0], D[b + 5, 0]
    t = tick('store', t)
    Analysis._calc_reactions(model)
    t = tick('reactions', t)
    model.solution = 'Linear'
    return T
