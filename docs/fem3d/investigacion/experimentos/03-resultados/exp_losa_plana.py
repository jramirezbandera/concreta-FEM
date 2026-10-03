# Experimento RES-E3: losa plana 12×12 m sobre 3×3 pilares (luces 6 m), h = 0,25 m, PyNite 3.2.0 Quad3D.
#  (a) pico de momento negativo sobre el pilar central frente al tamaño de malla
#      (valor en el nudo, media nodal, valor en la cara del pilar 0,40×0,40);
#  (b) Wood–Armer por combinación (correcto) frente a Wood–Armer aplicado a la envolvente
#      componente a componente de Mx, My, Mxy (incorrecto), con 16 combinaciones de alternancia.
import json, sys, time, itertools
import numpy as np
from Pynite import FEModel3D
from wood_armer import wood_armer

L, span, t = 12.0, 6.0, 0.25
E, nu = 30e9, 0.2
G = E / (2 * (1 + nu))
gk, qk = 7.25e3, 2.0e3  # Pa (peso propio 6,25 + solado 1,0; uso 2,0)
c_col = 0.40


def run(h):
    n = int(round(L / h))
    m = FEModel3D()
    m.add_material('C', E, G, nu, 2500)
    nid = lambda i, j: f'N{i}_{j}'
    for i in range(n + 1):
        for j in range(n + 1):
            m.add_node(nid(i, j), i * h, j * h, 0.0)
    panels = {}
    for i in range(n):
        for j in range(n):
            q = f'Q{i}_{j}'
            m.add_quad(q, nid(i, j), nid(i + 1, j), nid(i + 1, j + 1), nid(i, j + 1), t, 'C')
            xc, yc = (i + 0.5) * h, (j + 0.5) * h
            p = f'P{int(xc // span)}{int(yc // span)}'
            panels[q] = p
            m.add_quad_surface_pressure(q, -gk, case='G')
            m.add_quad_surface_pressure(q, -qk, case=p)
    step = int(round(span / h))
    cols = [(a * step, b * step) for a in range(3) for b in range(3)]
    for i in range(n + 1):
        for j in range(n + 1):
            iscol = (i, j) in cols
            m.def_support(nid(i, j), (i, j) == (0, 0), (i, j) in ((0, 0), (n, 0)), iscol, False, False, True)
    cases = ['G', 'P00', 'P01', 'P10', 'P11']
    for c in cases:
        m.add_load_combo(c, {c: 1.0})
    t0 = time.time()
    m.analyze_linear()
    t_solve = time.time() - t0
    # resultados en el centro de cada elemento, por caso (convención PyNite: + = tracción en la cara +z, la superior)
    t0 = time.time()
    names = [f'Q{i}_{j}' for i in range(n) for j in range(n)]
    R = {c: np.array([m.quads[q].moment(0, 0, True, c).flatten() for q in names]) for c in cases}
    t_extract = time.time() - t0
    # pilar central: nudo (n/2, n/2); elementos que lo tocan y su valor en la esquina compartida
    ic = n // 2
    around = [(ic - 1, ic - 1, 1, 1), (ic, ic - 1, -1, 1), (ic, ic, -1, -1), (ic - 1, ic, 1, -1)]
    nodal = {c: [m.quads[f'Q{i}_{j}'].moment(xi, eta, True, c).flatten() for (i, j, xi, eta) in around] for c in cases}
    # cara del pilar: x = 6 + 0,20, y = 6 (lado derecho), interpolando dentro del elemento con ξ
    xf = span + c_col / 2
    ie = int(xf // h); xi = 2 * (xf - (ie + 0.5) * h) / h
    face = {c: 0.5 * (m.quads[f'Q{ie}_{ic}'].moment(xi, -1, True, c).flatten() + m.quads[f'Q{ie}_{ic-1}'].moment(xi, 1, True, c).flatten()) for c in cases}
    reac = {c: m.nodes[f'N{ic}_{ic}'].RxnFZ[c] for c in cases}
    # integral de Mx a lo largo de la cara x = 6,20: banda de pilar (|y-6| ≤ 1,5) y ancho del pórtico virtual (3 ≤ y ≤ 9)
    def strip(y0, y1):
        out = {}
        for c in cases:
            tot = 0.0
            for j in range(n):
                yc = (j + 0.5) * h
                if y0 - 1e-9 <= yc - h / 2 and yc + h / 2 <= y1 + 1e-9:
                    tot += m.quads[f'Q{ie}_{j}'].moment(xi, 0, True, c).flatten()[0] * h
            out[c] = tot
        return out
    strip_col = strip(span - 1.5, span + 1.5)
    strip_full = strip(span - 3.0, span + 3.0)
    return dict(strip_col=strip_col, strip_full=strip_full, n=n, h=h, t_solve=t_solve, t_extract=t_extract, R=R, nodal=nodal, face=face, reac=reac, cases=cases,
                ndof=6 * (n + 1) ** 2, nquads=n * n)


results = {}
for h in [float(a) for a in sys.argv[1:]] or [1.0, 0.5]:
    r = run(h)
    results[h] = r
    print(f'\n### malla h = {h} m: {r["nquads"]} quads, {r["ndof"]} GDL; análisis {r["t_solve"]:.1f} s; extracción {r["t_extract"]:.1f} s')
    # Combinaciones ELU: 1,35 G + 1,5 Q en paños alternados (16 = 2^4)
    combos = []
    for pat in itertools.product([0, 1], repeat=4):
        f = {'G': 1.35, 'P00': 1.5 * pat[0], 'P01': 1.5 * pat[1], 'P10': 1.5 * pat[2], 'P11': 1.5 * pat[3]}
        combos.append(f)
    comb = lambda store, f: sum(f[c] * np.asarray(store[c]) for c in r['cases'])
    # (a) pico sobre el pilar central, combinación con todos los paños cargados
    fall = combos[-1]
    nod = comb(r['nodal'], fall)  # 4 × [Mx, My, Mxy]
    fac = comb(r['face'], fall)
    F = sum(fall[c] * r['reac'][c] for c in r['cases'])
    print(f'  pilar central, todo cargado: Mx en el nudo (4 elementos): {np.round(nod[:,0]/1e3,1)} kN·m/m; media nodal {nod[:,0].mean()/1e3:.1f}')
    print(f'  Mx en la cara del pilar (x = 6,20): {fac[0]/1e3:.1f} kN·m/m ; reacción del pilar {F/1e3:.0f} kN; F·t/8 = {F*c_col/8/1e3:.1f} kN·m (¡no es por metro!)')
    sc = sum(fall[c] * r['strip_col'][c] for c in r['cases']); sf = sum(fall[c] * r['strip_full'][c] for c in r['cases'])
    print(f'  ∫Mx dy en la cara: banda de pilar 3 m = {sc/1e3:.1f} kN·m ; pórtico virtual 6 m = {sf/1e3:.1f} kN·m')
    # (b) Wood–Armer por combinación vs sobre la envolvente de componentes
    Ms = np.stack([comb(r['R'], f) for f in combos])  # (16, nel, 3) convención PyNite
    sag = -Ms  # → positivo = tracción inferior (convención de wood_armer.py)
    mxb, myb, mxt, myt = wood_armer(sag[..., 0], sag[..., 1], sag[..., 2])
    env_correct = np.stack([mxb.max(0), myb.max(0), mxt.min(0), myt.min(0)])
    # incorrecto: WA de (max Mx, max My, max |Mxy|) para inferior y (min Mx, min My, max |Mxy|) para superior
    a = np.abs(sag[..., 2]).max(0)
    b1 = wood_armer(sag[..., 0].max(0), sag[..., 1].max(0), a)
    b2 = wood_armer(sag[..., 0].min(0), sag[..., 1].min(0), a)
    env_wrong = np.stack([b1[0], b1[1], b2[2], b2[3]])
    # sin Mxy (sólo Mx, My): lo que haría quien ignore el torsor
    env_nomxy = np.stack([np.maximum(sag[..., 0].max(0), 0), np.maximum(sag[..., 1].max(0), 0), np.minimum(sag[..., 0].min(0), 0), np.minimum(sag[..., 1].min(0), 0)])
    for k, lab in enumerate(['mx inf', 'my inf', 'mx sup', 'my sup']):
        ok = env_correct[k]; wr = env_wrong[k]; nm = env_nomxy[k]
        mask = np.abs(ok) > 0.05 * np.abs(ok).max()
        ratio = np.abs(wr[mask]) / np.abs(ok[mask])
        r2 = np.abs(nm[mask]) / np.abs(ok[mask])
        print(f'  {lab}: WA(envolvente)/envolvente(WA) mín {ratio.min():.3f} máx {ratio.max():.3f} | sin Mxy / WA: mín {r2.min():.3f} (elementos con |M| > 5 % del máx: {mask.sum()})')
    print(f'  máx. global WA inferior x: {env_correct[0].max()/1e3:.1f} kN·m/m; superior x: {env_correct[2].min()/1e3:.1f} kN·m/m')
