# Comprobación de las ramas de Wood–Armer (cara inferior) contra la definición:
# minimizar mx*+my* con mx*≥max(mx,0), my*≥max(my,0) y (mx*-mx)(my*-my) ≥ mxy²
# (criterio de Johansen para armado ortogonal). Búsqueda densa, 20 000 casos aleatorios.
import numpy as np
from wood_armer import wood_armer
rng = np.random.default_rng(1)
n = 20000
mx = rng.uniform(-100, 100, n); my = rng.uniform(-100, 100, n); mxy = rng.uniform(-60, 60, n)
mxb, myb, _, _ = wood_armer(mx, my, mxy)
worst = 0.0; viol = 0; branches = {'principal': 0, 'mx*=0': 0, 'my*=0': 0, 'sin armadura': 0}
for i in range(n):
    a0 = max(mx[i], 0.0)
    if mx[i] <= 0 and my[i] <= 0 and mx[i] * my[i] >= mxy[i] ** 2:
        best = 0.0
    else:
        A = a0 + np.concatenate([np.linspace(1e-9, 1, 200), np.geomspace(1e-6, 2000, 4000)])
        B = my[i] + mxy[i] ** 2 / (A - mx[i])
        B = np.maximum(B, max(my[i], 0.0))
        best = float(np.min(A + B))
        # caso a = mx* = 0 exacto con mx<0
        if mx[i] < 0:
            b = max(my[i] + mxy[i] ** 2 / (0 - mx[i]), max(my[i], 0.0))
            best = min(best, b)
    got = mxb[i] + myb[i]
    worst = max(worst, (got - best) / max(1.0, best))
    if (mxb[i] - mx[i]) * (myb[i] - my[i]) < mxy[i] ** 2 - 1e-6 and not (mxb[i] == 0 and myb[i] == 0):
        viol += 1
    if mxb[i] == 0 and myb[i] == 0: branches['sin armadura'] += 1
    elif mxb[i] == 0: branches['mx*=0'] += 1
    elif myb[i] == 0: branches['my*=0'] += 1
    else: branches['principal'] += 1
print('ramas cubiertas:', branches)
print('violaciones del criterio de Johansen:', viol)
print(f'exceso relativo máx. de mx*+my* sobre el óptimo por búsqueda: {worst:.2e}')
# comprobación explícita de los casos «sin armadura inferior»: deben cumplir el criterio con mx*=my*=0
z = (mxb == 0) & (myb == 0)
bad = z & ~((mx <= 0) & (my <= 0) & (mx * my >= mxy ** 2 - 1e-9))
print('casos (0,0) que en realidad necesitan armadura inferior:', int(bad.sum()))
# y comprobación de que el diseño nunca queda por debajo del óptimo hallado por búsqueda
