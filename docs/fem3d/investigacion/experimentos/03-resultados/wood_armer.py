"""Wood–Armer para armado ortogonal (Wood 1968, con la discusión de Armer).

Convención de ENTRADA de esta función: momentos por unidad de longitud con
signo «positivo = tracción en la cara inferior» (flector positivo = sagging),
Mxy con el signo del tensor. Devuelve los momentos de dimensionado:
  mx_b, my_b ≥ 0  → armadura inferior en x, y
  mx_t, my_t ≤ 0  → armadura superior en x, y (valor negativo = momento negativo)
Sólo depende de |Mxy|: el signo de Mxy no cambia el resultado.
"""
import numpy as np


def wood_armer(mx, my, mxy):
    mx = np.asarray(mx, float); my = np.asarray(my, float); a = np.abs(np.asarray(mxy, float))
    # ── cara inferior ──
    mxb = mx + a
    myb = my + a
    with np.errstate(divide='ignore', invalid='ignore'):
        # si mx* < 0: mx* = 0, my* = my + |mxy²/mx|
        c1 = mxb < 0
        myb = np.where(c1, my + np.abs(a * a / np.where(mx == 0, np.nan, mx)), myb)
        mxb = np.where(c1, 0.0, mxb)
        # si my* < 0: my* = 0, mx* = mx + |mxy²/my|
        c2 = myb < 0
        mxb = np.where(c2, mx + np.abs(a * a / np.where(my == 0, np.nan, my)), mxb)
        myb = np.where(c2, 0.0, myb)
        # si ambos quedan negativos no hace falta armadura inferior
        both = (mxb < 0) | (myb < 0)
        mxb = np.where(both, 0.0, np.nan_to_num(mxb))
        myb = np.where(both, 0.0, np.nan_to_num(myb))
        # ── cara superior (momentos negativos) ──
        mxt = mx - a
        myt = my - a
        c3 = mxt > 0
        myt = np.where(c3, my - np.abs(a * a / np.where(mx == 0, np.nan, mx)), myt)
        mxt = np.where(c3, 0.0, mxt)
        c4 = myt > 0
        mxt = np.where(c4, mx - np.abs(a * a / np.where(my == 0, np.nan, my)), mxt)
        myt = np.where(c4, 0.0, myt)
        both_t = (mxt > 0) | (myt > 0)
        mxt = np.where(both_t, 0.0, np.nan_to_num(mxt))
        myt = np.where(both_t, 0.0, np.nan_to_num(myt))
    return mxb, myb, mxt, myt


if __name__ == '__main__':
    # Oráculo publicado: LUSAS CSN/LUSAS/1029 «Combinations and Wood-Armer Results» (2025).
    # LUSAS usa «positivo = tracción en la cara superior»: Mx(T) = (mx - |mxy|) con
    # nuestro criterio cambiado de signo. Se convierte cambiando el signo de mx, my.
    lus = {  # Mx, My, Mxy (LUSAS)
        'Point Load (fila sin nombre)': (-12.29, 13.52, 114.75),
        'UDL': (-7.68, 8.45, 71.72),
        'SW': (-2.03, -7.71, -1.26),
        'Patch': (-0.85, 10.38, 19.32),
        'Suma (combinación)': (-22.85, 24.64, 204.53),
    }
    print('caso | Mx(T) My(T) Mx(B) My(B)  [convención LUSAS]')
    acc = np.zeros(4)
    for k, (Mx, My, Mxy) in lus.items():
        mxb, myb, mxt, myt = wood_armer(-Mx, -My, Mxy)
        # Mx(T) LUSAS = -(momento superior nuestro) ; Mx(B) LUSAS = -(momento inferior nuestro)
        row = np.array([-mxt, -myt, -mxb, -myb], float)
        print(f'{k:30s} {row[0]:8.2f} {row[1]:8.2f} {row[2]:8.2f} {row[3]:8.2f}')
        if not k.startswith('Suma'):
            acc += row
    print(f'{"suma de W-A por caso":30s} {acc[0]:8.2f} {acc[1]:8.2f} {acc[2]:8.2f} {acc[3]:8.2f}')
    print('LUSAS tabla 2 (combinada):        181.67   229.16  -227.38  -179.89')
    print('LUSAS tabla 3 (suma por casos):   184.96   238.14  -229.91  -182.41')
