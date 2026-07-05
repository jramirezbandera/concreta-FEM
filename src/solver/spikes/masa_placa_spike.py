# =============================================================================
# SPIKE T0.1 (corte T-f3-masa-placa) — Masa de PLACA en el analisis modal.
#
# PUERTA go/no-go que gatea la Fase 1+ del corte T-f3-masa-placa (dar masa a los
# quads en modal). NO implementa la feature ni toca el glue: explora, mide y DECIDE.
#
# EL PROBLEMA (hecho verificado en el codigo de PyNite 2.0.2, no re-derivar):
#   - `FEModel3D.M()` (la matriz de masa que ve analyze_modal) ensambla la masa de
#     los MEMBERS (add_member_self_weight, camino consistente) y la masa de las
#     cargas NODALES del combo de masa (m = F/g, SOLO traslacion; Node3D.M).
#   - Quad3D NO tiene m() ni kg() y NO guarda rho (solo E/nu). add_member_self_weight
#     IGNORA los quads. => una losa maciza modelada con quads entra en el modal con
#     masa CERO: sus modos de flexion de placa NO aparecen. Es el bug del corte.
#
# LA SOLUCION QUE SE PRUEBA (masa nodal tributaria):
#   Para cada quad: W_quad = rho * t * area  (rho = PESO especifico kN/m^3).
#   Cada uno de sus 4 nudos recibe add_node_load(FY, -W_quad/4, case=_CASO_MASA_MODAL),
#   acumulando entre quads vecinos. El combo _COMBO_MASA_MODAL activa ese case y
#   analyze_modal(mass_combo_name=combo, mass_direction="Y", gravity=9.81) convierte
#   esas fuerzas en masa W/g repartida en las traslaciones nodales. Es el mismo patron
#   que el glue ya usa para las BARRAS (peso->masa/g), extendido a la placa a mano
#   porque PyNite no da masa al quad.
#
# Plan aprobado: corte T-f3-masa-placa (memoria f3-corte1-losa-isovalores.md, deuda
#   T-f3-masa-placa). Constantes del glue: src/solver/pynite_glue.py:60-70
#   (_CASO_MASA_MODAL, _COMBO_MASA_MODAL="__MASA_MODAL__", _G_FISICO=9.81; rho=PESO).
# Nota de diseno hermana (lee esto primero): ./masa_placa_spike.md
#
# -----------------------------------------------------------------------------
# COMO EJECUTARLO  (identico al spike hermano cr_diafragma_spike.py)
#   - Necesita PyNiteFEA 2.0.2 (el par del proyecto, src/solver/config.ts) + numpy/scipy.
#     Instalable local:  pip install "PyNiteFEA==2.0.2" numpy scipy PrettyTable
#     (o el wheel vendorizado: pip install vendor/wheels/pynitefea-2.0.2-py3-none-any.whl)
#   - NO forma parte de `npm test` (es lento y exploratorio):
#         python src/solver/spikes/masa_placa_spike.py            # imprime el informe
#   - El motor de PRODUCCION es PyNite sobre Pyodide/WASM. Este spike usa PyNite local:
#     el algoritmo (masa nodal + analyze_modal) es Python puro e IDENTICO al que correra
#     en Pyodide; solo cambia el build de numpy/scipy, irrelevante para las preguntas
#     del spike (viabilidad del eigen, precision vs Leissa, coste).
#
# -----------------------------------------------------------------------------
# CONVENCION FEM Y-up (confirmada en src/discretizador/geometria.ts y en el golden
# de placa tests/golden/placa.golden.test.ts):
#   - plano de la placa = X-Z ; vertical (flexion fuera de plano) = Y.
#   - masa vertical => mass_direction="Y"; el 1.er modo de flexion tiene DY dominante.
# =============================================================================

import argparse
import math
import sys
import time

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
# Parametros de la placa (sistema interno kN-m del proyecto).
#
# Hormigon HA-25 REALISTA segun el catalogo del proyecto (src/biblioteca/hormigon.ts,
# Codigo Estructural): Ecm = 22000*((fck+8)/10)^0.3 MPa con fck=25 => ~31477 MPa =>
# 31.477e6 kN/m^2. (El enunciado del corte citaba ~27.26e6, que es la formula EHE-08
# DEROGADA 8500*fcm^(1/3); el proyecto usa la del Codigo Estructural. La eleccion de E
# NO afecta la CONVERGENCIA hacia Leissa —es adimensional en el cociente D/mu—; solo
# escala f1 con sqrt(E). Usamos el E real del proyecto para que las cifras sean las que
# vera la app. La analitica de abajo usa EXACTAMENTE este E, asi que el error % es limpio.)
# -----------------------------------------------------------------------------
FCK_MPA = 25.0
ECM_MPA = 22000.0 * (((FCK_MPA + 8.0) / 10.0) ** 0.3)   # Codigo Estructural / EC2
E = ECM_MPA * 1.0e3        # kN/m^2  (MPa -> interno; 1 MPa = 1e3 kN/m^2)
NU = 0.2
G = E / (2.0 * (1.0 + NU))
RHO = 25.0                 # kN/m^3  PESO especifico del hormigon armado (NO masa)

LADO = 6.0                 # m  (placa cuadrada a x a)
ESPESOR = 0.25             # m
G_FISICO = 9.81            # m/s^2  (peso -> masa: masa = peso/g). El _G_FISICO del glue.

# Constantes de nombres del glue (src/solver/pynite_glue.py:67-68): doble guion bajo
# para NUNCA colisionar con hipotesis/combos de obra.
CASO_MASA_MODAL = "__masa_modal__"
COMBO_MASA_MODAL = "__MASA_MODAL__"


# =============================================================================
# Analitica de Leissa: placa cuadrada SSSS (simplemente apoyada en los 4 bordes),
# teoria de placa DELGADA (Kirchhoff). Modo fundamental (1,1):
#
#   f_11 = (pi/2) * (1/a^2 + 1/b^2) * sqrt(D / mu)   [Hz]
#     D  = E*t^3 / (12*(1-nu^2))     rigidez a flexion  [kN*m]
#     mu = rho*t / g                 masa por unidad de AREA  [ (kN/m^2)/(m/s^2) ]
#
# (mu con rho=PESO: rho*t es peso/area [kN/m^2], /g da masa/area, consistente con la
#  conversion peso->masa del glue.) Para a=b: f_11 = pi * (1/a^2) * sqrt(D/mu).
# =============================================================================
def f1_leissa(a, b, E, nu, t, rho, g):
    D = E * t ** 3 / (12.0 * (1.0 - nu ** 2))
    mu = rho * t / g
    return (math.pi / 2.0) * (1.0 / a ** 2 + 1.0 / b ** 2) * math.sqrt(D / mu)


# =============================================================================
# Construye la placa cuadrada SSSS con malla n x n de quads en el plano X-Z.
#   - Nudos (n+1)x(n+1); orden de quad i,j,m,n = (ix,iz),(ix+1,iz),(ix+1,iz+1),(ix,iz+1)
#     (mismo recorrido que el discretizador y el golden de placa: CCW visto desde +Y).
#   - Apoyo SIMPLE de borde: DY restringido en todo el perimetro.
#   - Estabilizacion en plano IDENTICA al discretizador (src/discretizador/mallado.ts:540):
#       esquina (0,0)  -> DX+DZ ;  esquina (nx,0) -> DZ.
#     Fija las 2 traslaciones de plano + el giro RY de cuerpo rigido sin coartar la flexion.
#   - Masa de placa: add_node_load(FY, -W_quad/4, case) por cada nudo de cada quad,
#     ACUMULANDO entre quads vecinos (asi los nudos interiores reciben ~4 aportes y los
#     de esquina ~1). Suma total = rho*t*area_total = peso de la losa. El combo activa el case.
# =============================================================================
def construir_placa(n, con_masa=True):
    m = FEModel3D()
    m.add_material("HA25", E, G, NU, RHO)

    h = LADO / n

    def nombre(ix, iz):
        return "N_%d_%d" % (ix, iz)

    for iz in range(n + 1):
        for ix in range(n + 1):
            m.add_node(nombre(ix, iz), ix * h, 0.0, iz * h)

    area_quad = h * h
    W_quad = RHO * ESPESOR * area_quad          # peso del quad (kN)
    aporte = W_quad / 4.0                        # a cada uno de sus 4 nudos

    for iz in range(n):
        for ix in range(n):
            qn = "Q_%d_%d" % (ix, iz)
            i = nombre(ix, iz)
            j = nombre(ix + 1, iz)
            mm = nombre(ix + 1, iz + 1)
            nn = nombre(ix, iz + 1)
            m.add_quad(qn, i, j, mm, nn, ESPESOR, "HA25")
            if con_masa:
                for nd in (i, j, mm, nn):
                    # FY negativa (gravitatoria): mass_direction="Y" la cuenta por
                    # valor absoluto -> masa W/g. Acumula entre quads vecinos.
                    m.add_node_load(nd, "FY", -aporte, case=CASO_MASA_MODAL)

    # Apoyo simple de borde (DY) en todo el perimetro.
    def es_borde(ix, iz):
        return ix == 0 or ix == n or iz == 0 or iz == n

    for iz in range(n + 1):
        for ix in range(n + 1):
            if es_borde(ix, iz):
                m.def_support(nombre(ix, iz), False, True, False, False, False, False)

    # Estabilizacion en plano (identica a mallado.ts): DX+DZ en (0,0), DZ en (n,0).
    n00 = nombre(0, 0)
    nN0 = nombre(n, 0)
    # (0,0) ya tiene DY de borde; anadimos DX+DZ. def_support reemplaza todos los flags,
    # asi que re-declaramos con DY tambien True.
    m.def_support(n00, True, True, True, False, False, False)
    m.def_support(nN0, False, True, True, False, False, False)

    if con_masa:
        m.add_load_combo(COMBO_MASA_MODAL, {CASO_MASA_MODAL: 1.0})

    return m


def contar_gdl_libres(m):
    """GDL libres = 6*nudos - GDL restringidos por apoyo (igual que el glue)."""
    restringidos = 0
    for nd in m.nodes.values():
        for flag in (
            nd.support_DX, nd.support_DY, nd.support_DZ,
            nd.support_RX, nd.support_RY, nd.support_RZ,
        ):
            if flag:
                restringidos += 1
    return len(m.nodes) * 6 - restringidos


# =============================================================================
# Corre analyze_modal y devuelve (frecuencias, forma_del_modo_1, gdl_libres, dt).
# forma_del_modo_1: para cada nudo, (X, Z, DY, |DX|+|DZ|) del modo fundamental, para
# inspeccionar que es la flexion (1,1) con DY dominante (no un modo espurio en plano).
# =============================================================================
def correr_modal(n, num_modes):
    m = construir_placa(n, con_masa=True)
    gdl = contar_gdl_libres(m)
    # acotar como el glue: eigsh exige k < N.
    k = min(num_modes, gdl - 1)
    t0 = time.perf_counter()
    m.analyze_modal(
        num_modes=k,
        mass_combo_name=COMBO_MASA_MODAL,
        mass_direction="Y",
        gravity=G_FISICO,
    )
    dt = time.perf_counter() - t0
    freqs = [float(f) for f in m.frequencies]

    # Forma del 1.er modo: leer el desplazamiento modal por nudo del combo "Mode 1".
    combo_modo1 = "Mode 1" if "Mode 1" in m.load_combos else None
    forma = []
    dy_max = 0.0
    plano_max = 0.0
    if combo_modo1 is not None:
        for nd in m.nodes.values():
            try:
                dy = float(nd.DY[combo_modo1])
                dx = float(nd.DX[combo_modo1])
                dz = float(nd.DZ[combo_modo1])
            except (KeyError, TypeError):
                continue
            plano = abs(dx) + abs(dz)
            forma.append((nd.X, nd.Z, dy, plano))
            dy_max = max(dy_max, abs(dy))
            plano_max = max(plano_max, plano)

    return freqs, forma, gdl, dt, dy_max, plano_max


# =============================================================================
# Analisis de la forma del modo 1: ¿es la flexion (1,1)?  Comprueba:
#   - DY domina sobre el movimiento en plano (dy_max >> plano_max) -> es flexion, no
#     un modo espurio de traslacion/giro en el plano ni drilling del quad.
#   - El maximo de DY esta cerca del CENTRO de la placa (media onda en X y en Z), no en
#     un borde ni una esquina -> es el modo (1,1), no un modo de orden superior.
# =============================================================================
def diagnosticar_forma(forma, dy_max, plano_max):
    if not forma:
        return {"ok": False, "motivo": "sin forma modal legible"}
    # nudo de |DY| maximo
    nudo_pico = max(forma, key=lambda t: abs(t[2]))
    xc, zc = LADO / 2.0, LADO / 2.0
    dist_centro = math.hypot(nudo_pico[0] - xc, nudo_pico[1] - zc)
    dy_domina = dy_max > 5.0 * plano_max if plano_max > 0 else dy_max > 0
    pico_central = dist_centro < 0.30 * LADO  # el pico esta en el tercio central
    return {
        "ok": dy_domina and pico_central,
        "dy_max": dy_max,
        "plano_max": plano_max,
        "ratio_dy_plano": (dy_max / plano_max) if plano_max > 0 else float("inf"),
        "pico_xz": (nudo_pico[0], nudo_pico[1]),
        "dist_centro": dist_centro,
        "dy_domina": dy_domina,
        "pico_central": pico_central,
    }


# =============================================================================
# Informe.
# =============================================================================
def imprimir_informe():
    import numpy as _np
    import scipy as _sp

    print("=" * 78)
    print("SPIKE T0.1 - Masa de PLACA en el analisis modal (FEM Y-up, placa SSSS)")
    print("=" * 78)
    print("numpy=%s  scipy=%s  (PyNiteFEA 2.0.2)" % (_np.__version__, _sp.__version__))
    print()
    print("Placa cuadrada SSSS:  a=%.1f m  t=%.3f m  HA-25 (Ecm=%.0f MPa => E=%.4g kN/m2)"
          % (LADO, ESPESOR, ECM_MPA, E))
    print("  nu=%.2f  rho=%.1f kN/m3 (PESO)  g=%.2f m/s2  t/a=%.4f" %
          (NU, RHO, G_FISICO, ESPESOR / LADO))

    f1_ref = f1_leissa(LADO, LADO, E, NU, ESPESOR, RHO, G_FISICO)
    D = E * ESPESOR ** 3 / (12.0 * (1.0 - NU ** 2))
    mu = RHO * ESPESOR / G_FISICO
    print("  D=%.4g kN*m   mu=%.5g (masa/area)   f1_Leissa(delgada) = %.5f Hz"
          % (D, mu, f1_ref))
    print()

    # --- (a)+(b) Viabilidad, forma modal y convergencia -----------------------
    print("--- (a) Viabilidad + (b) Convergencia: f1 vs Leissa por malla ---")
    print("   malla | nudos | GDL_lib | num_modes | f1 [Hz] | error%% vs Leissa | 1er modo")
    print("   ------+-------+---------+-----------+---------+------------------+---------")

    resultados = {}
    NUM_MODES_INSPECCION = 6
    for n in (4, 8, 16):
        freqs, forma, gdl, dt, dy_max, plano_max = correr_modal(n, NUM_MODES_INSPECCION)
        f1 = freqs[0] if freqs else float("nan")
        err = 100.0 * (f1 - f1_ref) / f1_ref
        diag = diagnosticar_forma(forma, dy_max, plano_max)
        etiqueta = "flex(1,1) OK" if diag["ok"] else "REVISAR"
        n_nudos = (n + 1) ** 2
        print("   %2dx%-2d | %5d | %7d | %9d | %7.4f | %+15.3f  | %s"
              % (n, n, n_nudos, gdl, len(freqs), f1, err, etiqueta))
        resultados[n] = {
            "freqs": freqs, "f1": f1, "err": err, "gdl": gdl, "dt": dt, "diag": diag,
            "n_nudos": n_nudos,
        }

    print()
    print("--- Inspeccion del eigen (malla 8x8): primeras frecuencias y sanidad ---")
    freqs8 = resultados[8]["freqs"]
    print("   f[1..%d] Hz = %s" % (len(freqs8), ["%.4f" % f for f in freqs8]))
    # sanidad: sin frecuencias no finitas ni absurdamente altas (modo espurio rotacional)
    finitas = all(math.isfinite(f) and f > 0 for f in freqs8)
    salto = (max(freqs8) / freqs8[0]) if freqs8 else float("inf")
    print("   todas finitas y > 0: %s" % finitas)
    print("   ratio f_max/f_1 = %.1f  (un salto enorme delataria un modo espurio por"
          " GDL rotacional/drilling sin masa)" % salto)
    d8 = resultados[8]["diag"]
    print("   1er modo: DY_max=%.4g  plano_max=%.4g  ratio DY/plano=%.4g"
          % (d8["dy_max"], d8["plano_max"], d8["ratio_dy_plano"]))
    print("      pico |DY| en (x,z)=(%.2f,%.2f)  dist al centro=%.3f m (centro=%.2f)"
          % (d8["pico_xz"][0], d8["pico_xz"][1], d8["dist_centro"], LADO / 2.0))

    # --- (c) Coste: analyze_modal 16x16, num_modes 6 y 30 ---------------------
    print()
    print("--- (c) Coste: analyze_modal con malla 16x16 ---")
    for nm in (6, 30):
        freqs, _, gdl, dt, _, _ = correr_modal(16, nm)
        print("   16x16  GDL_lib=%d  num_modes(pedido)=%2d  obtenidos=%2d  ->  %.2f s"
              % (gdl, nm, len(freqs), dt))

    # --- DECISION de TOL_REL para el golden de Fase 3 -------------------------
    print()
    print("=" * 78)
    err8 = abs(resultados[8]["err"])
    err16 = abs(resultados[16]["err"])
    converge = err16 <= err8 + 1e-6  # el error no crece al refinar
    # criterio del corte: si el error a malla razonable (8x8/16x16) supera ~3% o no
    # converge -> STOP. Si converge y es <~3%, TOL_REL = error_16x16 redondeado + margen.
    if not converge or min(err8, err16) > 3.0:
        veredicto = "STOP / NO-GO"
        tol = None
    else:
        veredicto = "GO"
        # margen: cubre el error real a 16x16 + holgura para el cambio de build
        # numpy/scipy local<->Pyodide y la variacion de malla del golden.
        base = max(err16, 1.0)
        tol = math.ceil((base * 1.6) * 10) / 10.0  # +60% de margen, redondeo a 0.1%
    print("VEREDICTO: %s" % veredicto)
    print("  error |8x8| = %.3f%%   error |16x16| = %.3f%%   converge = %s"
          % (err8, err16, converge))
    if tol is not None:
        print("  DECISION TOL_REL (golden Fase 3) = %.3f  (=%.1f%%)  [error_16x16 + margen]"
              % (tol / 100.0, tol))
    print("=" * 78)

    return veredicto == "GO"


def main():
    ap = argparse.ArgumentParser(description="Spike T0.1 - masa de placa en modal")
    ap.parse_args()
    go = imprimir_informe()
    sys.exit(0 if go else 1)


if __name__ == "__main__":
    main()
