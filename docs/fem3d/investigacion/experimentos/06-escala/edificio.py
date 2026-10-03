"""Generador paramétrico del edificio de referencia (H-escala) en un modelo NEUTRO (arrays numpy).

Convenio de Concreta: Z vertical hacia arriba, SI (N, m, Pa). Los consumidores (PyNite y el
ensamblador vectorizado) permutan a Y-up con (Xp, Yp, Zp) = (Yc, Zc, Xc), como modelo.py (H08).

Edificio por defecto: 7 plantas (PB 4,0 m y el resto 3,0 m), retícula 10x8 pilares con luces
5,5 (X) y 5,0 (Y), dos núcleos de muros de 25 cm (ascensor 2,0x2,0 y escalera 2,5x5,0).

Variantes de forjado:
  V1  losa maciza 25 cm como lámina; rejilla de quads alineada a ejes, tamaño h.
  V2  reticular como lámina con ábacos 2,5x2,5 por pilar (líneas de control extra a +-1,25 m).
  V3  unidireccional: viguetas como barras cada ~0,70 m (dirección Y) entre vigas planas en X,
      zunchos en Y por las líneas de pilares, diafragma por barras de penalización
      biarticuladas con la torsión liberada (H07: 6 barras por cada 4 nudos maestros).

Los muros se mallan en rejilla por paño, con >= 8 elementos por altura de planta.
"""
from __future__ import annotations
import math
import numpy as np

E_C = 30e9
NU_C = 0.2
GAMMA_C = 25000.0
ALPHA_PEN = 1e3  # E de las barras de penalización = ALPHA_PEN * E_C (H07: 1e3-1e4)

# tipos
PILAR, VIGA, VIGUETA, ZUNCHO, PENAL = 0, 1, 2, 3, 4
LOSA, ABACO, MURO = 0, 1, 2


def _spans(n, L, irr, rng):
    if irr <= 0:
        return [L] * n
    return [L * (1.0 + irr * rng.uniform(-1, 1)) for _ in range(n)]


def _cum(spans):
    out = [0.0]
    for s in spans:
        out.append(out[-1] + s)
    return out


def _lines(base, extra, h, snap=0.05):
    """Líneas de control (base = ejes, se conservan) + extra; funde las extra a < snap de otra
    línea; subdivide cada intervalo en ceil(L/h) partes iguales."""
    pts = sorted(set(round(v, 6) for v in base))
    for v in sorted(set(round(v, 6) for v in extra)):
        if min(abs(v - p) for p in pts) >= snap and pts[0] < v < pts[-1]:
            pts.append(v)
            pts.sort()
    out = []
    for a, b in zip(pts[:-1], pts[1:]):
        n = max(1, math.ceil((b - a) / h - 1e-9))
        out += [a + (b - a) * k / n for k in range(n)]
    out.append(pts[-1])
    return np.round(np.array(out), 6)


def _subdiv(a, b, h):
    n = max(1, math.ceil((b - a) / h - 1e-9))
    return [a + (b - a) * k / n for k in range(n + 1)]


class Builder:
    def __init__(self):
        self.key = {}
        self.xyz = []
        self.fixed = []
        self.mem = []      # (i, j, tipo, sec, mat, rel)
        self.quads = []    # (i, j, m, n, t, tipo)

    def node(self, x, y, z, fixed=False):
        k = (round(x * 1e5), round(y * 1e5), round(z * 1e5))
        i = self.key.get(k)
        if i is None:
            i = len(self.xyz)
            self.key[k] = i
            self.xyz.append((x, y, z))
            self.fixed.append(fixed)
        elif fixed:
            self.fixed[i] = True
        return i

    def get(self, x, y, z):
        return self.key.get((round(x * 1e5), round(y * 1e5), round(z * 1e5)))

    def member(self, i, j, tipo, sec, mat=0, rel=False):
        if i != j:
            self.mem.append((i, j, tipo, sec, mat, rel))

    def quad(self, a, b, c, d, t, tipo):
        self.quads.append((a, b, c, d, t, tipo))


def build(variante='V1', h=0.5, storeys=7, nx=10, ny=8, Lx=5.5, Ly=5.0, h_pb=4.0, h_pl=3.0,
          irr=0.0, seed=1, cores=True, t_losa=0.25, t_muro=0.25, t_abaco=0.40, t_ret=0.233,
          s_vig=0.70, h_muro=None, nz_min=8, beams_all=True):
    """Devuelve dict con arrays del modelo neutro + metadatos.
    nx, ny = número de pilares por dirección (10x8 por defecto)."""
    rng = np.random.default_rng(seed)
    gx = _cum(_spans(nx - 1, Lx, irr, rng))
    gy = _cum(_spans(ny - 1, Ly, irr, rng))
    zs = [0.0]
    for k in range(storeys):
        zs.append(zs[-1] + (h_pb if k == 0 else h_pl))
    hw = h if h_muro is None else h_muro
    if variante == 'V3' and h_muro is None:
        hw = 0.5

    # núcleos (x0, x1, y0, y1) dentro de vanos interiores
    core_list = []
    if cores and nx >= 7 and ny >= 5:
        ia, ja = 3, 3      # ascensor 2,0 x 2,0 centrado en el vano (3,3)
        cx, cy = (gx[ia] + gx[ia + 1]) / 2, (gy[ja] + gy[ja + 1]) / 2
        core_list.append(('ascensor', cx - 1.0, cx + 1.0, cy - 1.0, cy + 1.0))
        ie, je = 5, 3      # escalera 2,5 x 5,0 en el vano (5,3), largo en Y
        cx, cy = (gx[ie] + gx[ie + 1]) / 2, (gy[je] + gy[je + 1]) / 2
        core_list.append(('escalera', cx - 1.25, cx + 1.25, cy - 2.5, cy + 2.5))

    def in_core(x, y, strict=True):
        for _, x0, x1, y0, y1 in core_list:
            if strict:
                if x0 + 1e-6 < x < x1 - 1e-6 and y0 + 1e-6 < y < y1 - 1e-6:
                    return True
            else:
                if x0 - 1e-6 <= x <= x1 + 1e-6 and y0 - 1e-6 <= y <= y1 + 1e-6:
                    return True
        return False

    B = Builder()
    # secciones: (A, Iy, Iz, J) en convenio PyNite (Iz = flexión "fuerte" con eje local y vertical)
    def rect(b, hh):  # b horizontal, hh vertical (canto)
        a, c = max(b, hh), min(b, hh)
        J = a * c**3 * (1 / 3 - 0.21 * c / a * (1 - c**4 / (12 * a**4)))
        return (b * hh, hh * b**3 / 12, b * hh**3 / 12, J)
    secs = [rect(0.40, 0.40), rect(0.30, 0.30), rect(0.30, 0.50), rect(0.60, 0.25),
            rect(0.12, 0.30), rect(0.30, 0.30)]
    S_P40, S_P30, S_V3050, S_VP, S_VIG, S_PEN = range(6)

    # ---------- líneas de la planta ----------
    if variante in ('V1', 'V2'):
        ex, ey = [], []
        for _, x0, x1, y0, y1 in core_list:
            ex += [x0, x1]; ey += [y0, y1]
        if variante == 'V2':
            for x in gx:
                ex += [x - 1.25, x + 1.25]
            for y in gy:
                ey += [y - 1.25, y + 1.25]
        xs = _lines(gx, ex, h)
        ys = _lines(gy, ey, h)
    else:
        # V3: estaciones en X = ejes + viguetas (paso L/round(L/s)) + bordes de núcleos
        xv = []
        for a, b in zip(gx[:-1], gx[1:]):
            n = max(1, round((b - a) / s_vig))
            xv += [a + (b - a) * k / n for k in range(1, n)]
        ex = []
        for _, x0, x1, y0, y1 in core_list:
            ex += [x0, x1]
        xs = np.round(np.array(sorted(set(round(v, 6) for v in list(gx) + xv + ex))), 6)
        ys = np.round(np.array(gy), 6)
        xjoist = set(round(v, 6) for v in xv)

    # ---------- base ----------
    for x in gx:
        for y in gy:
            B.node(x, y, 0.0, fixed=True)

    def wall_stations_side(a, b, along):  # estaciones horizontales de un paño
        if variante in ('V1', 'V2'):
            arr = xs if along == 'x' else ys
            st = [v for v in arr if a - 1e-6 <= v <= b + 1e-6]
            # refina si la rejilla de la losa es más gruesa que hw (no ocurre con hw = h)
            out = []
            for p, q in zip(st[:-1], st[1:]):
                out += _subdiv(p, q, hw)[:-1]
            out.append(st[-1])
            return out
        else:
            if along == 'x':
                st = [v for v in xs if a - 1e-6 <= v <= b + 1e-6]
            else:
                st = [a, b]
            out = []
            for p, q in zip(st[:-1], st[1:]):
                out += _subdiv(p, q, hw)[:-1]
            out.append(st[-1])
            return out

    nz_list = []
    for k in range(1, storeys + 1):
        z0, z1 = zs[k - 1], zs[k]
        z = z1
        nz = max(nz_min, math.ceil((z1 - z0) / hw - 1e-9))
        nz_list.append(nz)
        zz = [z0 + (z1 - z0) * m / nz for m in range(nz + 1)]
        # ---- muros (rejilla por paño) ----
        for _, x0, x1, y0, y1 in core_list:
            sides = [('x', x0, x1, y0), ('y', y0, y1, x1), ('x', x0, x1, y1), ('y', y0, y1, x0)]
            for along, a, b, c in sides:
                st = wall_stations_side(a, b, along)
                for m in range(nz):
                    for p in range(len(st) - 1):
                        pts = []
                        for (s_, zz_) in ((st[p], zz[m]), (st[p + 1], zz[m]), (st[p + 1], zz[m + 1]), (st[p], zz[m + 1])):
                            X, Y = (s_, c) if along == 'x' else (c, s_)
                            pts.append(B.node(X, Y, zz_, fixed=(zz_ == 0.0)))
                        B.quad(*pts, t_muro, MURO)
        # ---- forjado ----
        if variante in ('V1', 'V2'):
            nxl, nyl = len(xs), len(ys)
            for i in range(nxl - 1):
                for j in range(nyl - 1):
                    xc, yc = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
                    if in_core(xc, yc):
                        continue
                    a = B.node(xs[i], ys[j], z); b = B.node(xs[i + 1], ys[j], z)
                    c = B.node(xs[i + 1], ys[j + 1], z); d = B.node(xs[i], ys[j + 1], z)
                    t, tipo = t_losa, LOSA
                    if variante == 'V2':
                        t, tipo = t_ret, LOSA
                        if any(abs(xc - gxx) < 1.25 for gxx in gx) and any(abs(yc - gyy) < 1.25 for gyy in gy):
                            t, tipo = t_abaco, ABACO
                    B.quad(a, b, c, d, t, tipo)
            # vigas embebidas por todas las líneas de ejes (o sólo perímetro)
            gxs = gx if beams_all else [gx[0], gx[-1]]
            gys = gy if beams_all else [gy[0], gy[-1]]
            for y in gys:
                for i in range(nxl - 1):
                    p, q = B.get(xs[i], y, z), B.get(xs[i + 1], y, z)
                    if p is not None and q is not None and not in_core((xs[i] + xs[i + 1]) / 2, y):
                        per = y in (gy[0], gy[-1])
                        B.member(p, q, VIGA, S_V3050 if per else S_VP)
            for x in gxs:
                for j in range(nyl - 1):
                    p, q = B.get(x, ys[j], z), B.get(x, ys[j + 1], z)
                    if p is not None and q is not None and not in_core(x, (ys[j] + ys[j + 1]) / 2):
                        per = x in (gx[0], gx[-1])
                        B.member(p, q, VIGA, S_V3050 if per else S_VP)
        else:
            # V3: vigas planas en X por cada línea gy, partidas en cada vigueta
            for y in gy:
                for i in range(len(xs) - 1):
                    if in_core((xs[i] + xs[i + 1]) / 2, y):
                        continue
                    p = B.node(xs[i], y, z); q = B.node(xs[i + 1], y, z)
                    per = y in (gy[0], gy[-1])
                    B.member(p, q, VIGA, S_V3050 if per else S_VP)
            # zunchos en Y por las líneas de pilares (una barra por vano)
            for x in gx:
                for j in range(len(gy) - 1):
                    if in_core(x, (gy[j] + gy[j + 1]) / 2):
                        continue
                    B.member(B.node(x, gy[j], z), B.node(x, gy[j + 1], z), ZUNCHO, S_V3050)
            # viguetas en Y entre vigas (interrumpidas por los núcleos)
            for x in xs:
                if round(float(x), 6) not in xjoist:
                    continue
                for j in range(len(gy) - 1):
                    ya, yb = gy[j], gy[j + 1]
                    cuts = [ya]
                    void = False
                    for _, x0, x1, y0, y1 in core_list:
                        if x0 - 1e-6 <= x <= x1 + 1e-6 and y0 < yb - 1e-6 and y1 > ya + 1e-6:
                            if x0 + 1e-6 < x < x1 - 1e-6:
                                cuts += [y0, y1]
                                void = True
                    cuts.append(yb)
                    cuts = sorted(set(round(c, 6) for c in cuts))
                    segs = list(zip(cuts[:-1], cuts[1:]))
                    for (p_, q_) in segs:
                        if void and in_core(x, (p_ + q_) / 2):
                            continue
                        if q_ - p_ < 1e-6:
                            continue
                        B.member(B.node(x, p_, z), B.node(x, q_, z), VIGUETA, S_VIG)
            # diafragma: 6 barras por cada 4 nudos maestros (pilares) + líneas X partidas en cada nudo
            for i in range(len(gx) - 1):
                for j in range(len(gy) - 1):
                    a = B.get(gx[i], gy[j], z); b = B.get(gx[i + 1], gy[j], z)
                    c = B.get(gx[i + 1], gy[j + 1], z); d = B.get(gx[i], gy[j + 1], z)
                    B.member(a, c, PENAL, S_PEN, 1, True)
                    B.member(b, d, PENAL, S_PEN, 1, True)
            for y in gy:
                for i in range(len(xs) - 1):
                    p, q = B.get(xs[i], y, z), B.get(xs[i + 1], y, z)
                    if p is not None and q is not None:
                        B.member(p, q, PENAL, S_PEN, 1, True)
            for x in gx:
                for j in range(len(gy) - 1):
                    p, q = B.get(x, gy[j], z), B.get(x, gy[j + 1], z)
                    if p is not None and q is not None:
                        B.member(p, q, PENAL, S_PEN, 1, True)
            # núcleos al diafragma: esquinas del núcleo a las 4 esquinas del vano + diagonales
            for _, x0, x1, y0, y1 in core_list:
                corners = [B.get(x0, y0, z), B.get(x1, y0, z), B.get(x1, y1, z), B.get(x0, y1, z)]
                ib = max(i for i in range(len(gx) - 1) if gx[i] <= x0)
                jb = max(j for j in range(len(gy) - 1) if gy[j] <= y0 + 1e-6)
                cols = [B.get(gx[ib], gy[jb], z), B.get(gx[ib + 1], gy[jb], z),
                        B.get(gx[ib + 1], gy[jb + 1], z), B.get(gx[ib], gy[jb + 1], z)]
                for cn, cc in zip(corners, cols):
                    if cn is not None and cc is not None and cn != cc:
                        B.member(cn, cc, PENAL, S_PEN, 1, True)
                if None not in corners:
                    B.member(corners[0], corners[2], PENAL, S_PEN, 1, True)
                    B.member(corners[1], corners[3], PENAL, S_PEN, 1, True)
        # ---- pilares ----
        for x in gx:
            for y in gy:
                p = B.node(x, y, z0); q = B.node(x, y, z)
                B.member(p, q, PILAR, S_P40 if k <= 3 else S_P30)

    xyz = np.array(B.xyz, dtype=float)
    mem = np.array([m[:5] for m in B.mem], dtype=np.int64).reshape(-1, 5)
    rel = np.array([m[5] for m in B.mem], dtype=bool)
    qd = np.array([q[:4] for q in B.quads], dtype=np.int64).reshape(-1, 4)
    qt = np.array([q[4] for q in B.quads], dtype=float)
    qtipo = np.array([q[5] for q in B.quads], dtype=np.int64)
    sec = np.array(secs, dtype=float)

    # ---------- cargas (casos simples) ----------
    # G: peso propio de barras (gamma*A, salvo penalización) + presión en losas (pp + 2 kPa)
    #    en V3, la carga de forjado va como carga lineal en viguetas (q * intereje).
    # Q: 3 kPa.  WX, WY, EX, EY: fuerzas nodales en cabeza de pilares.
    nq = len(qd)
    pG = np.zeros(nq); pQ = np.zeros(nq)
    slab = qtipo != MURO
    pG[slab] = -(GAMMA_C * qt[slab] + 2000.0)
    pQ[slab] = -3000.0
    nm = len(mem)
    wG = np.zeros(nm); wQ = np.zeros(nm)
    real = mem[:, 2] != PENAL
    wG[real] = -GAMMA_C * sec[mem[real, 3], 0]
    if variante == 'V3':
        sj = np.where(mem[:, 2] == VIGUETA)[0]
        # intereje real de cada vigueta (≈ 0,69 m)
        pas = (gx[1] - gx[0]) / max(1, round((gx[1] - gx[0]) / s_vig))
        wG[sj] += -(3500.0 + 2000.0) * pas
        wQ[sj] += -3000.0 * pas
    heads = []
    for k in range(1, storeys + 1):
        for x in gx:
            for y in gy:
                heads.append(B.get(x, y, zs[k]))
    heads = np.array(heads, dtype=np.int64)
    nod = {
        'WX': (heads, 0, 5000.0), 'WY': (heads, 1, 5000.0),
        'EX': (heads, 0, 8000.0), 'EY': (heads, 1, 8000.0),
    }
    cargas = {'G': dict(quad_p=pG, mem_w=wG), 'Q': dict(quad_p=pQ, mem_w=wQ)}
    for c, v in nod.items():
        cargas[c] = dict(nodal=v)
    meta = dict(variante=variante, h=h, storeys=storeys, nx=nx, ny=ny, irr=irr, gx=gx, gy=gy, zs=zs,
                nxl=len(xs), nyl=len(ys), nz=nz_list, cores=core_list, hw=hw)
    return dict(xyz=xyz, fixed=np.array(B.fixed, dtype=bool), mem=mem, rel=rel, quads=qd, qt=qt,
                qtipo=qtipo, sec=sec, cargas=cargas, meta=meta)


def conteos(m, pattern=True):
    """Nudos, GDL, GDL libres, barras, quads y nnz del patrón por bloques de K (6x6 por par de nudos)."""
    N = len(m['xyz'])
    nfix = int(m['fixed'].sum())
    out = dict(nudos=N, gdl=6 * N, gdl_libres=6 * (N - nfix), barras=len(m['mem']),
               barras_penal=int((m['mem'][:, 2] == PENAL).sum()) if len(m['mem']) else 0,
               quads=len(m['quads']), quads_muro=int((m['qtipo'] == MURO).sum()))
    if pattern:
        import scipy.sparse as sp
        free = ~m['fixed']
        rows, cols = [], []
        e = m['mem'][:, :2]
        for a in range(2):
            for b in range(2):
                rows.append(e[:, a]); cols.append(e[:, b])
        q = m['quads']
        for a in range(4):
            for b in range(4):
                rows.append(q[:, a]); cols.append(q[:, b])
        r = np.concatenate(rows); c = np.concatenate(cols)
        A = sp.coo_matrix((np.ones(r.size, dtype=np.int8), (r, c)), shape=(N, N)).tocsr()
        A.data[:] = 1
        Af = A[free][:, free]
        out['nnz_K_bloques'] = int(Af.nnz) * 36           # K11 completa, bloques 6x6 densos
        out['nnz_nodal'] = int(Af.nnz)
    return out


if __name__ == '__main__':
    import sys, json, time
    v = sys.argv[1] if len(sys.argv) > 1 else 'V1'
    h = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5
    st = int(sys.argv[3]) if len(sys.argv) > 3 else 7
    irr = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
    t0 = time.perf_counter()
    m = build(v, h=h, storeys=st, irr=irr)
    t1 = time.perf_counter()
    c = conteos(m)
    print(json.dumps(dict(variante=v, h=h, storeys=st, irr=irr, gen_s=round(t1 - t0, 3), **c,
                          nxl=m['meta']['nxl'], nyl=m['meta']['nyl'], nz=m['meta']['nz'][:2])))
