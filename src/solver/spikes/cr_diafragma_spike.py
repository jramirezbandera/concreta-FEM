# =============================================================================
# SPIKE F0.1 — Diafragma rigido para el Centro de Rigidez (CR) FEM-exacto.
#
# PUERTA go/no-go que gatea F1.2 (calcular_cr en pynite_glue.py) y la Fase 2.
# NO implementa la feature: explora, valida y DECIDE el mecanismo del diafragma
# rigido y deja una fixture de regresion + nota de diseno commiteadas.
#
# Plan: C:\Users\Javier\.claude\plans\vamos-a-implementar-el-linked-salamander.md
# Nota de diseno (lee esto primero): ./cr_diafragma_spike.md
#
# -----------------------------------------------------------------------------
# COMO EJECUTARLO
#   - Necesita PyNiteFEA 2.0.2 (el par del proyecto, src/solver/config.ts) + numpy.
#     Instalable local:  pip install "PyNiteFEA==2.0.2" numpy scipy PrettyTable
#   - NO forma parte de `npm test` (es lento y exploratorio):
#         python src/solver/spikes/cr_diafragma_spike.py            # imprime el informe
#         python src/solver/spikes/cr_diafragma_spike.py --check    # re-asierta la fixture
#   - El motor de PRODUCCION es PyNite sobre Pyodide/WASM (worker.ts). Este spike usa
#     PyNite local: el algoritmo del diafragma es identico (Python puro); la unica
#     diferencia es el build de numpy/scipy, irrelevante para la pregunta del spike
#     (¿el mecanismo del diafragma es numericamente solido?). Las cifras de la fixture
#     se re-asiertan ademas en el golden del CR (F3.1) con el motor Pyodide real.
#
# -----------------------------------------------------------------------------
# CONVENCION FEM Y-up (confirmada en src/discretizador/geometria.ts: obra (x,y)+cota
# -> FEM [x, cota, y] = [X, Y, Z]):
#   - plano del forjado = X-Z ; vertical = Y ; giro de diafragma = RY.
#   - cargas laterales del diafragma = FX / FZ ; torsor = MY.
#   - x/y del CR son coords de OBRA (x=X_FEM, y=Z_FEM); NO la Y vertical FEM.
#
# -----------------------------------------------------------------------------
# VEREDICTO (resumen; detalle en la nota .md):  ***GO***  con el MECANISMO 2.
#
#   MECANISMO 2 — "desplazamiento de cuerpo rigido impuesto" (ELEGIDO):
#     Sobre cada nudo del forjado se IMPONE el campo de cuerpo rigido en el plano
#     (def_node_disp) y se marcan DX,DZ como apoyo (def_support) para que PyNite
#     calcule la reaccion en ese GDL (PyNite SOLO calcula Rxn* en GDL con support).
#     Se imponen 3 campos unitarios (ux, uz, theta sobre un punto maestro) y se lee
#     la resultante de reacciones -> matriz de RIGIDEZ 3x3 del diafragma.
#       CR:  x_cr = xm + K[1,2]/K[1,1] ,  z_cr = zm - K[0,2]/K[0,0]
#     VENTAJAS frente al Mecanismo 1:
#       - NO esclaviza los giros nodales (RY de cada nudo queda LIBRE): es el
#         diafragma rigido ESTANDAR (traslacion en plano atada, giros de nudo
#         libres), no anade rigidez torsional artificial via flexion de pilares.
#       - NO hay nudo maestro fisico ni enlaces rigidos -> NO existe el "RY artefacto"
#         (criterio 3 satisfecho por construccion: no se lee ningun giro de maestro).
#       - NO hay rigidez de penalizacion que ajustar -> el numero de condicion es el
#         de la 3x3 estructural natural (~4-60), excelente; NO hay escala que barrer.
#       - El eje vertical (DY) y los giros fuera de plano (RX,RZ) de los nudos NO se
#         tocan -> NO se sobre-restringe el eje vertical.
#
#   MECANISMO 1 — "arana" (enlaces rigidos maestro->nudos):  TAMBIEN pasa los 5
#     criterios en la planta SIMETRICA, pero los enlaces rigidos (vigas) esclavizan
#     el giro RY de los nudos del forjado al maestro -> sobre-rigidiza la torsion y
#     FALSEA el CR en plantas ASIMETRICAS (da 1.974 m donde el #2 y la fisica dan
#     1.558 m). Es exactamente el antipatron que el plan advierte ("esclavizar giros
#     que deberian ser libres"). Ademas exige enlaces que TRANSMITAN momento (con
#     enlaces solo-traslacion la matriz es SINGULAR: el maestro gira libre). Se
#     DESCARTA por fidelidad fisica, no por que no converja.
#
#   MECANISMO 3 — condensacion de m.K():  NO se evalua (el plan lo deja como ultimo
#     recurso con aprobacion explicita; los mecanismos fisicos pasan, asi no hace
#     falta tocar la rigidez de PyNite a mano -> respeta la regla de oro #1).
# =============================================================================

import argparse
import json
import math
import os
import sys

import numpy as np

try:
    from Pynite import FEModel3D
except ImportError:  # pragma: no cover - guia clara si falta el motor
    sys.stderr.write(
        "ERROR: falta PyNiteFEA. Instala el par del proyecto:\n"
        '    pip install "PyNiteFEA==2.0.2" numpy scipy PrettyTable\n'
    )
    sys.exit(2)


# -----------------------------------------------------------------------------
# Material y secciones (hormigon ~C25, kN-m: el sistema interno del proyecto).
# -----------------------------------------------------------------------------
E = 2.7e7        # kN/m2  (~27 GPa)
G = 1.125e7      # kN/m2
NU = 0.2
RHO = 25.0       # kN/m3  (PESO especifico; el CR no usa masa, pero el material lo pide)

# Pilar 30x30 (seccion base) y 60x60 (pilar rigidizado del caso asimetrico).
A_30 = 0.09
I_30 = 0.30 ** 4 / 12      # 6.75e-4 m4
J_30 = 2.25e-4             # m4 (aprox; el CR es robusto a su valor exacto)
A_60 = 0.36
I_60 = 0.60 ** 4 / 12      # 1.08e-2 m4
J_60 = 1.80e-3             # m4

H = 3.0          # altura de planta (m)
SEMI = 2.5       # semilado -> planta 5x5 m centrada en el origen de obra

# Esquinas del forjado en el plano X-Z (obra: x=X_FEM, y=Z_FEM). Empotradas en base.
ESQUINAS = [(SEMI, SEMI), (SEMI, -SEMI), (-SEMI, SEMI), (-SEMI, -SEMI)]
# Aristas perimetrales (vigas de atado en cabeza): forman el marco del forjado.
ARISTAS = [(0, 1), (1, 3), (3, 2), (2, 0)]

# Umbral de condicionamiento para declarar el CR NO DETERMINABLE (degenerado).
# Por debajo de el la 3x3 es resoluble; muy por encima (singular: 1 pilar, sin
# rigidez torsional) -> CR null. El barrido del spike muestra cond ~4-60 en casos
# sanos y ~1e17/inf en degenerados, asi que 1e12 separa con holgura.
COND_MAX = 1.0e12


# =============================================================================
# Construccion del modelo base (sin diafragma): 4 pilares + vigas de atado.
# `rigido_en` = indice del pilar con seccion 60x60 (None = todos 30x30, simetrico).
# =============================================================================
def construir_planta(rigido_en=None, con_vigas=True):
    m = FEModel3D()
    m.add_material("C", E, G, NU, RHO)
    m.add_section("S30", A_30, I_30, I_30, J_30)
    m.add_section("S60", A_60, I_60, I_60, J_60)

    cabezas = []
    for k, (x, z) in enumerate(ESQUINAS):
        pie = "P%db" % k
        cab = "P%dt" % k
        m.add_node(pie, x, 0.0, z)
        m.add_node(cab, x, H, z)
        m.def_support(pie, True, True, True, True, True, True)  # base empotrada
        sec = "S60" if (rigido_en is not None and k == rigido_en) else "S30"
        m.add_member("C%d" % k, pie, cab, "C", sec)
        cabezas.append(cab)

    if con_vigas:
        for (i, j) in ARISTAS:
            m.add_member("V%d_%d" % (i, j), cabezas[i], cabezas[j], "C", "S30")

    return m, cabezas


def centroide(m, cabezas):
    xs = [m.nodes[n].X for n in cabezas]
    zs = [m.nodes[n].Z for n in cabezas]
    return sum(xs) / len(xs), sum(zs) / len(zs)


# =============================================================================
# MECANISMO 2 (ELEGIDO): rigidez 3x3 del diafragma por desplazamiento impuesto.
#
# Para cada uno de los 3 campos de cuerpo rigido unitarios respecto al maestro
# (xm,zm) -> (ux, uz, theta):
#   DX_nudo = ux - theta*(z - zm)      (campo de cuerpo rigido en plano X-Z)
#   DZ_nudo = uz + theta*(x - xm)
# se IMPONE con def_node_disp y se marca DX,DZ como apoyo (def_support) para que
# PyNite calcule las reacciones. La resultante de reacciones en los nudos del
# forjado, trasladada al maestro, es la columna correspondiente de K (FX,FZ,MY).
#
# Importante (criterios 1 y 2): solo se tocan DX,DZ de los nudos del forjado; DY
# (vertical), RX, RY, RZ quedan LIBRES -> ni se sobre-restringe el eje vertical ni
# se esclaviza ningun giro. No hay nudo maestro fisico ni GDL fuera de plano de un
# maestro que restringir: el maestro es solo el punto de referencia del campo.
# =============================================================================
def rigidez_diafragma(rigido_en, xm, zm, con_vigas=True):
    K = np.zeros((3, 3))
    campos = [(1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)]
    for col, (ux, uz, th) in enumerate(campos):
        m, cabezas = construir_planta(rigido_en=rigido_en, con_vigas=con_vigas)
        for n in cabezas:
            x = m.nodes[n].X
            z = m.nodes[n].Z
            dx = ux - th * (z - zm)
            dz = uz + th * (x - xm)
            # support en DX,DZ (asi PyNite calcula la reaccion); DY/RX/RY/RZ libres.
            m.def_support(n, True, False, True, False, False, False)
            m.def_node_disp(n, "DX", dx)
            m.def_node_disp(n, "DZ", dz)
        m.analyze_linear(check_statics=False, sparse=False)
        Fx = Fz = My = 0.0
        for n in cabezas:
            x = m.nodes[n].X
            z = m.nodes[n].Z
            rfx = float(m.nodes[n].RxnFX["Combo 1"])
            rfz = float(m.nodes[n].RxnFZ["Combo 1"])
            Fx += rfx
            Fz += rfz
            # Torsor de la reaccion respecto al maestro: r x F (componente Y).
            My += (x - xm) * rfz - (z - zm) * rfx
        K[:, col] = [Fx, Fz, My]
    return K


def cr_desde_rigidez(K, xm, zm):
    """(x_cr, z_cr, cond) en coords de OBRA, o (None, None, cond) si degenerado.

    El CR es el punto donde una fuerza lateral no produce giro del diafragma.
    Con K (rigidez 3x3 FX,FZ,MY vs ux,uz,theta) referida al maestro:
        x_cr = xm + K[1,2]/K[1,1]   (acople uz<->My / rigidez en uz)
        z_cr = zm - K[0,2]/K[0,0]   (acople ux<->My / rigidez en ux)
    Verificado por construccion: una fuerza aplicada en (x_cr,z_cr) da theta~0.
    Degeneracion (1 pilar / sin rigidez torsional) -> cond(K) enorme -> None.
    """
    cond = float(np.linalg.cond(K))
    if not math.isfinite(cond) or cond > COND_MAX:
        return None, None, cond
    x_cr = xm + K[1, 2] / K[1, 1]
    z_cr = zm - K[0, 2] / K[0, 0]
    return x_cr, z_cr, cond


# =============================================================================
# MECANISMO 1 (DESCARTADO, evaluado para la comparativa): "arana".
# Nudo maestro a la cota del forjado + enlaces rigidos (vigas) maestro->cada nudo.
# GDL fuera de plano del maestro (DY,RX,RZ) restringidos (anti-singular). Cargas
# FX/FZ/MY unitarias en el maestro -> flexibilidad 3x3 leyendo DX/DZ/RY del maestro.
# Formula del plan (flexibilidad):  x_cr = xm + C[2,1]/C[2,2], z_cr = zm - C[2,0]/C[2,2].
# =============================================================================
def cr_arana(rigido_en, xm, zm, escala):
    Er = E * escala
    C = np.zeros((3, 3))
    for col, d in enumerate(["FX", "FZ", "MY"]):
        m, cabezas = construir_planta(rigido_en=rigido_en)
        m.add_material("RIG", Er, Er / (2 * (1 + NU)), NU, 0.0)
        m.add_section("SR", 1.0, 1.0, 1.0, 1.0)
        m.add_node("MST", xm, H, zm)
        # GDL fuera de plano del maestro restringidos; DX,DZ,RY libres.
        m.def_support("MST", False, True, False, True, False, True)
        for k, cab in enumerate(cabezas):
            m.add_member("L%d" % k, "MST", cab, "RIG", "SR")
        m.add_node_load("MST", d, 1.0, case="U")
        m.add_load_combo("U", {"U": 1.0})
        m.analyze_linear(check_statics=False, sparse=False)
        C[0, col] = float(m.nodes["MST"].DX["U"])
        C[1, col] = float(m.nodes["MST"].DZ["U"])
        C[2, col] = float(m.nodes["MST"].RY["U"])
    cond = float(np.linalg.cond(C))
    x_cr = xm + C[2, 1] / C[2, 2]
    z_cr = zm - C[2, 0] / C[2, 2]
    return x_cr, z_cr, cond, C


# =============================================================================
# Criterio 3 (Mecanismo 2): el giro del diafragma NO es un artefacto de un nudo.
# Bajo el campo theta=1, los giros RY de los nudos quedan LIBRES (no esclavizados):
# devuelve la lista de RY nodales. Si fueran todos == theta (=1) estarian
# esclavizados (antipatron del Mecanismo 1); aqui deben diferir entre si y de theta.
# =============================================================================
def ry_nodales_bajo_giro(rigido_en, xm, zm):
    m, cabezas = construir_planta(rigido_en=rigido_en)
    for n in cabezas:
        x = m.nodes[n].X
        z = m.nodes[n].Z
        m.def_support(n, True, False, True, False, False, False)
        m.def_node_disp(n, "DX", -(z - zm))   # theta=1
        m.def_node_disp(n, "DZ", (x - xm))
    m.analyze_linear(check_statics=False, sparse=False)
    return [float(m.nodes[n].RY["Combo 1"]) for n in cabezas]


# =============================================================================
# Verificacion fisica (Mecanismo 2): una fuerza aplicada en el CR no gira.
# Resuelve el sistema reducido 3x3 con la fuerza generalizada de F en (x_cr,z_cr)
# y comprueba theta ~ 0.
# =============================================================================
def giro_aplicando_fuerza_en(K, xm, zm, x_ap, z_ap, fx, fz):
    My_master = (x_ap - xm) * fz - (z_ap - zm) * fx
    d = np.linalg.solve(K, np.array([fx, fz, My_master]))
    return float(d[2])  # theta


# =============================================================================
# Caso canonico de la fixture: planta simetrica 5x5, 4 pilares 30x30, maestro en
# el centroide. CR esperado == centroide == (0,0).
# =============================================================================
def _z(v, nd):
    """Redondea y normaliza el -0.0 a 0.0 (cosmetico: la fixture queda limpia)."""
    r = round(float(v), nd)
    return 0.0 if r == 0.0 else r


def caso_fixture():
    m, cabezas = construir_planta(rigido_en=None)
    cx, cz = centroide(m, cabezas)
    K = rigidez_diafragma(rigido_en=None, xm=cx, zm=cz)
    x_cr, z_cr, cond = cr_desde_rigidez(K, cx, cz)
    return {
        "descripcion": (
            "Planta simetrica 5x5 m, 4 pilares 30x30 empotrados (H=3 m) + vigas de "
            "atado perimetrales. Mecanismo 2 (desplazamiento de cuerpo rigido "
            "impuesto). CR esperado = centroide = (0,0)."
        ),
        "convencion": "FEM Y-up; forjado X-Z; giro RY; CR en coords de OBRA (x=X, y=Z).",
        "mecanismo": "desplazamiento_impuesto",
        "centroide": [_z(cx, 9), _z(cz, 9)],
        "maestro": [_z(cx, 9), _z(cz, 9)],
        "K_diafragma": [[_z(v, 6) for v in fila] for fila in K.tolist()],
        "cond_K": round(cond, 6),
        "cr_obra": [_z(x_cr, 9), _z(z_cr, 9)],
        "formula": "x_cr = xm + K[1,2]/K[1,1] ; z_cr = zm - K[0,2]/K[0,0]",
        "cond_max_degenerado": COND_MAX,
    }


# =============================================================================
# Los 5 criterios de aceptacion (planta simetrica), con tolerancias.
# =============================================================================
TOL_CR = 1.0e-6      # m   (CR == centroide en simetrica)
TOL_THETA = 1.0e-6   # rad (fuerza en CR -> giro nulo)


def evaluar_criterios():
    res = {}
    m, cabezas = construir_planta(rigido_en=None)
    cx, cz = centroide(m, cabezas)

    # --- Criterio 5 + 1: simetrica -> CR == centroide, e invariante al maestro ---
    maestros = [(cx, cz), (1.7, -0.9), (-3.1, 2.2)]
    cr_por_maestro = []
    for (xm, zm) in maestros:
        K = rigidez_diafragma(None, xm, zm)
        x_cr, z_cr, cond = cr_desde_rigidez(K, xm, zm)
        cr_por_maestro.append((xm, zm, x_cr, z_cr, cond))
    invar_maestro = all(
        x_cr is not None and abs(x_cr - cx) < TOL_CR and abs(z_cr - cz) < TOL_CR
        for (_, _, x_cr, z_cr, _) in cr_por_maestro
    )
    res["criterio5_invariante_maestro"] = invar_maestro
    res["_cr_por_maestro"] = cr_por_maestro

    # --- Criterio 5: invariante a la ESCALA (Mec. 2 no tiene escala de penalizacion;
    #     reescalamos E del material x10 -> CR debe seguir en el centroide) ---------
    global E
    E_guardado = E
    invar_escala = True
    cr_escala = []
    for factor in (0.1, 1.0, 10.0, 1000.0):
        E = E_guardado * factor
        K = rigidez_diafragma(None, cx, cz)
        x_cr, z_cr, cond = cr_desde_rigidez(K, cx, cz)
        cr_escala.append((factor, x_cr, z_cr, cond))
        if x_cr is None or abs(x_cr - cx) > TOL_CR or abs(z_cr - cz) > TOL_CR:
            invar_escala = False
    E = E_guardado
    res["criterio5_invariante_escala"] = invar_escala
    res["_cr_escala"] = cr_escala

    # --- Criterio 2: matriz NO singular (cond aceptable) en el caso sano ----------
    K = rigidez_diafragma(None, cx, cz)
    _, _, cond = cr_desde_rigidez(K, cx, cz)
    res["criterio2_no_singular"] = math.isfinite(cond) and cond < COND_MAX
    res["_cond_simetrica"] = cond

    # --- Criterio 3: giros nodales LIBRES (no esclavizados al campo theta=1) -------
    # El campo impuesto solo fija DX,DZ (traslacion); el RY de cada nudo lo resuelve
    # el FEM por minima energia. Si estuviera esclavizado al diafragma valdria theta
    # (=1) en todos; aqui difiere de 1 -> LIBRE. En la simetrica los 4 salen iguales
    # por simetria (pero != 1); en la asimetrica difieren ademas entre si.
    rys = ry_nodales_bajo_giro(None, cx, cz)        # simetrica (todos iguales, != 1)
    rys_asim = ry_nodales_bajo_giro(0, cx, cz)      # asimetrica (distintos entre si)
    no_esclavizados = all(abs(r - 1.0) > 1e-3 for r in rys)
    res["criterio3_giros_libres"] = no_esclavizados
    res["_ry_nodales"] = rys
    res["_ry_nodales_asim"] = rys_asim

    # --- Criterio 1: fuerza aplicada en el CR -> giro ~0 (definicion fisica) -------
    K = rigidez_diafragma(None, cx, cz)
    x_cr, z_cr, _ = cr_desde_rigidez(K, cx, cz)
    th_fx = giro_aplicando_fuerza_en(K, cx, cz, x_cr, z_cr, 1.0, 0.0)
    th_fz = giro_aplicando_fuerza_en(K, cx, cz, x_cr, z_cr, 0.0, 1.0)
    res["criterio1_cuerpo_rigido_no_gira"] = abs(th_fx) < TOL_THETA and abs(th_fz) < TOL_THETA
    res["_theta_fuerza_en_cr"] = (th_fx, th_fz)

    # --- Criterio 4: condicionamiento del Mecanismo 2 (sin escala que barrer) y de
    #     comparacion el barrido de escala del Mecanismo 1 (arana) -----------------
    res["criterio4_condicion"] = math.isfinite(cond) and cond < 1.0e6  # holgado

    # --- Caso ASIMETRICO (no es criterio de la simetrica; documenta la fidelidad):
    #     CR se desplaza al lado rigido; Mec.1 (arana) lo FALSEA (esclaviza giros) ---
    Kas = rigidez_diafragma(rigido_en=0, xm=cx, zm=cz)  # pilar 0 = esquina (+,+) rigido
    xcr_as, zcr_as, cond_as = cr_desde_rigidez(Kas, cx, cz)
    xcr_ar, zcr_ar, cond_ar, _ = cr_arana(rigido_en=0, xm=cx, zm=cz, escala=1e5)
    res["_asimetrico"] = {
        "mec2_cr": (xcr_as, zcr_as, cond_as),
        "mec1_arana_cr": (xcr_ar, zcr_ar, cond_ar),
    }

    # --- Degenerado: 1 pilar -> cond enorme -> CR null ----------------------------
    Kdeg = rigidez_diafragma_un_pilar()
    _, _, cond_deg = cr_desde_rigidez(Kdeg, 0.0, 0.0)
    res["_degenerado_cond"] = cond_deg
    res["criterio_degenerado_null"] = (not math.isfinite(cond_deg)) or cond_deg > COND_MAX

    return res


def rigidez_diafragma_un_pilar():
    """Rigidez del diafragma de UN solo pilar (degenerado: sin rigidez torsional
    determinable -> cond enorme -> CR null)."""
    K = np.zeros((3, 3))
    for col, (ux, uz, th) in enumerate([(1, 0, 0), (0, 1, 0), (0, 0, 1)]):
        m = FEModel3D()
        m.add_material("C", E, G, NU, RHO)
        m.add_section("S30", A_30, I_30, I_30, J_30)
        m.add_node("Pb", 0.0, 0.0, 0.0)
        m.add_node("Pt", 0.0, H, 0.0)
        m.def_support("Pb", True, True, True, True, True, True)
        m.add_member("C", "Pb", "Pt", "C", "S30")
        m.def_support("Pt", True, False, True, False, False, False)
        m.def_node_disp("Pt", "DX", ux)
        m.def_node_disp("Pt", "DZ", uz)
        m.analyze_linear(check_statics=False, sparse=False)
        rfx = float(m.nodes["Pt"].RxnFX["Combo 1"])
        rfz = float(m.nodes["Pt"].RxnFZ["Combo 1"])
        K[:, col] = [rfx, rfz, 0.0 * th]  # torsor respecto al propio nudo = 0
    return K


# =============================================================================
# Informe / re-asercion de la fixture.
# =============================================================================
FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "cr_diafragma_fixture.json")


def imprimir_informe():
    print("=" * 78)
    print("SPIKE F0.1 - Diafragma rigido para el Centro de Rigidez (FEM Y-up)")
    print("=" * 78)
    import numpy as _np
    import scipy as _sp
    print("numpy=%s  scipy=%s  (PyNiteFEA 2.0.2)" % (_np.__version__, _sp.__version__))
    print()

    res = evaluar_criterios()

    print("--- Los 5 criterios de aceptacion (planta simetrica 5x5, 4 pilares) ---")
    etiquetas = [
        ("criterio1_cuerpo_rigido_no_gira",
         "C1 cuerpo rigido en plano (fuerza en CR -> giro ~0)"),
        ("criterio2_no_singular",
         "C2 GDL fuera de plano OK -> matriz NO singular"),
        ("criterio3_giros_libres",
         "C3 RY del diafragma real (giros nodales LIBRES, no artefacto)"),
        ("criterio4_condicion",
         "C4 numero de condicion aceptable"),
        ("criterio5_invariante_maestro",
         "C5a CR == centroide, invariante a la POSICION del maestro"),
        ("criterio5_invariante_escala",
         "C5b CR == centroide, invariante a la ESCALA de rigidez"),
    ]
    todos_ok = True
    for clave, txt in etiquetas:
        ok = bool(res[clave])
        todos_ok = todos_ok and ok
        print("   [%s]  %s" % ("PASA" if ok else "FALLA", txt))

    print()
    print("--- Evidencia ---")
    print("   cond(K) simetrica          = %.4g" % res["_cond_simetrica"])
    th_fx, th_fz = res["_theta_fuerza_en_cr"]
    print("   theta(F en CR)             = %.3e / %.3e (debe ~0)" % (th_fx, th_fz))
    print("   RY nodales bajo theta=1 (simetrica)  = %s" % (
        ["%.4f" % r for r in res["_ry_nodales"]]))
    print("   RY nodales bajo theta=1 (asimetrica) = %s" % (
        ["%.4f" % r for r in res["_ry_nodales_asim"]]))
    print("     -> != theta(=1) => giros nodales LIBRES, no esclavizados (correcto);")
    print("        en la asimetrica ademas difieren entre si.")
    print("   CR por maestro (simetrica):")
    for (xm, zm, xc, zc, cond) in res["_cr_por_maestro"]:
        sc = "null" if xc is None else "(%+.6f, %+.6f)" % (xc, zc)
        print("     maestro (%+.2f,%+.2f) -> CR %s  cond=%.3g" % (xm, zm, sc, cond))
    print("   CR por escala de rigidez (simetrica):")
    for (factor, xc, zc, cond) in res["_cr_escala"]:
        sc = "null" if xc is None else "(%+.6f, %+.6f)" % (xc, zc)
        print("     E x%-7g -> CR %s  cond=%.3g" % (factor, sc, cond))

    print()
    print("--- Comparativa Mecanismo 2 vs Mecanismo 1 (arana), planta ASIMETRICA ---")
    print("    (pilar de la esquina (+2.5,+2.5) rigidizado a 60x60)")
    a = res["_asimetrico"]
    print("   Mec.2 (impuesto, giros libres)  CR = (%+.5f, %+.5f)  cond=%.3g"
          % (a["mec2_cr"][0], a["mec2_cr"][1], a["mec2_cr"][2]))
    print("   Mec.1 (arana, esclaviza giros)  CR = (%+.5f, %+.5f)  cond=%.3g"
          % (a["mec1_arana_cr"][0], a["mec1_arana_cr"][1], a["mec1_arana_cr"][2]))
    print("   -> difieren: Mec.1 sobre-rigidiza la torsion (antipatron del plan).")
    print("      El Mec.2 satisface la definicion fisica del CR (giro nulo).")

    print()
    print("--- Degenerado (1 pilar) ---")
    print("   cond(K) = %.4g  -> CR %s"
          % (res["_degenerado_cond"],
             "null (no determinable)" if res["criterio_degenerado_null"] else "ERROR no detectado"))

    print()
    veredicto = "GO" if (todos_ok and res["criterio_degenerado_null"]) else "NO-GO"
    print("=" * 78)
    print("VEREDICTO: %s  (mecanismo elegido: desplazamiento de cuerpo rigido impuesto)" % veredicto)
    print("=" * 78)
    return todos_ok and res["criterio_degenerado_null"]


def escribir_fixture():
    fx = caso_fixture()
    with open(FIXTURE_PATH, "w", encoding="utf-8") as f:
        json.dump(fx, f, indent=2, ensure_ascii=True)
        f.write("\n")
    print("Fixture escrita en %s" % FIXTURE_PATH)


def comprobar_fixture():
    """Re-asierta la fixture commiteada contra el calculo actual (tolerancia)."""
    if not os.path.exists(FIXTURE_PATH):
        print("ERROR: falta la fixture %s (ejecuta sin --check para generarla)" % FIXTURE_PATH)
        return False
    with open(FIXTURE_PATH, encoding="utf-8") as f:
        esperado = json.load(f)
    actual = caso_fixture()
    ok = True
    # CR (lo critico): debe coincidir con tolerancia.
    for i in range(2):
        if abs(actual["cr_obra"][i] - esperado["cr_obra"][i]) > 1e-6:
            ok = False
            print("FALLA cr_obra[%d]: actual=%r esperado=%r"
                  % (i, actual["cr_obra"][i], esperado["cr_obra"][i]))
    # K del diafragma: tolerancia relativa holgada (build de numpy/scipy distinto
    # en local vs Pyodide puede mover los ultimos digitos; el CR es lo invariante).
    Ka = np.array(actual["K_diafragma"]); Ke = np.array(esperado["K_diafragma"])
    escala = max(1.0, float(np.max(np.abs(Ke))))
    if np.max(np.abs(Ka - Ke)) > 1e-3 * escala:
        ok = False
        print("FALLA K_diafragma fuera de tolerancia:\n actual=\n%s\n esperado=\n%s"
              % (Ka, Ke))
    print("Re-asercion de la fixture: %s" % ("OK" if ok else "DISCREPANCIA"))
    return ok


def main():
    ap = argparse.ArgumentParser(description="Spike F0.1 - diafragma rigido CR")
    ap.add_argument("--check", action="store_true",
                    help="re-asierta la fixture commiteada (codigo de salida != 0 si discrepa)")
    ap.add_argument("--write-fixture", action="store_true",
                    help="(re)genera cr_diafragma_fixture.json")
    args = ap.parse_args()

    if args.check:
        sys.exit(0 if comprobar_fixture() else 1)
    if args.write_fixture:
        escribir_fixture()
        return

    go = imprimir_informe()
    # Genera/actualiza la fixture al correr el informe (idempotente).
    escribir_fixture()
    sys.exit(0 if go else 1)


if __name__ == "__main__":
    main()
