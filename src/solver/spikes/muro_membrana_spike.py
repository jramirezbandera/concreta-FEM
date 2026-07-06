# =============================================================================
# SPIKE F0 (corte T-f3-muros) — El Quad3D como PANTALLA (membrana en plano vertical).
#
# PUERTA go/no-go que gatea las Fases 1+ del corte de muros/pantallas. NO implementa
# la feature ni toca el glue: explora, mide y DECIDE.
#
# EL PROBLEMA: un muro/pantalla trabaja EN SU PLANO (membrana/cortante), al reves que
# la losa (flexion fuera de plano). El Quad3D de PyNite 2.0.2 ensambla flexion DKMQ
# Y membrana (tension plana) en K (verificado en la fuente del wheel vendorizado:
# Quad3D.k_m, Cm), asi que EN TEORIA un muro mallado con quads rigidiza lateralmente
# el edificio. Este spike lo verifica EMPIRICAMENTE antes de construir nada encima.
#
# PREGUNTAS QUE RESPONDE (los 5 riesgos del plan):
#   P1  Magnitud de la rigidez de membrana: muro voladizo (base empotrada, carga
#       lateral EN PLANO en coronacion) vs Timoshenko  d = PH^3/3EI + k*PH/GA (k=1.2).
#       Caso ESBELTO (flexion domina, Timoshenko fiable) y caso ACHAPARRADO (cortante
#       domina, el caso real de pantalla). Convergencia con 2 mallas.
#   P2  Ejes y UNIDADES de q.membrane(): con el orden i,j,m,n del plan
#       (i=(col,fila), j=(col+1,fila), m=(col+1,fila+1), n=(col,fila+1); col = eje s
#       del muro ascendente, fila = cota ascendente), la fuente de Quad3D da
#       x_local=i->j (horizontal) y y_local=z_x_x=+Y (VERTICAL) para muro segun X y
#       segun Y. => Sy debe ser la tension NORMAL VERTICAL en kN/m2 (Cm sin espesor).
#       Se pinna con: (a) compresion axil uniforme -> Sy ~= -N/(t*L), Sx ~= 0;
#       (b) flexion de voladizo -> Sy(esquinas de base) ~= +-6M/(t*L^2).
#   P3  Drilling: la base 6-GDL y los nudos interiores solo-quad NO producen
#       singularidad (PyNite mete un muelle rotacional debil, Quad3D linea ~562) ni
#       reacciones parasitas apreciables en el GDL de drilling.
#   P4  CR con quads: replica del mecanismo del glue (_rigidez_diafragma_planta:
#       def_support FUSIONADO + def_node_disp por campo, K 3x3 de reacciones,
#       x_cr = xm + K[1][2]/K[1][1], z_cr = zm - K[0][2]/K[0][0]) sobre un modelo
#       2 plantas con 2 pilares + pantalla excentrica: (a) el CR se desplaza HACIA el
#       muro; (b) cond(K) sano; (c) COSTE medido (3 campos x planta x rebuild).
#   P5  Peso propio NODAL (W/4 por quad, case propio): SumaV base = rho*t*L*H exacto.
#       (La presion de superficie NO vale para gravedad en un muro: su normal es
#       HORIZONTAL. El peso va como node_loads FY, separado del case __masa_modal__
#       del glue -> sin doble conteo por construccion.)
#
# Plan aprobado: corte T-f3-muros (plan de-f3-quedan-ahora-replicated-backus.md).
# Nota de diseno hermana (lee esto primero): ./muro_membrana_spike.md
#
# -----------------------------------------------------------------------------
# COMO EJECUTARLO  (identico a los spikes hermanos masa_placa_spike.py etc.)
#   - Necesita PyNiteFEA 2.0.2 (el par del proyecto, src/solver/config.ts) + numpy/scipy.
#     Instalable local:  pip install "PyNiteFEA==2.0.2" numpy scipy PrettyTable
#   - NO forma parte de `npm test` (es lento y exploratorio):
#         python src/solver/spikes/muro_membrana_spike.py
#   - El motor de PRODUCCION es PyNite sobre Pyodide/WASM. Este spike usa PyNite local:
#     el algoritmo es Python puro e IDENTICO al que correra en Pyodide.
#
# -----------------------------------------------------------------------------
# CONVENCION FEM Y-up (src/discretizador/geometria.ts): mapearEjes(x,y,cota)=[x,cota,y].
#   - Muro "segun X" (eje en obra-X): plano FEM X-Y, normal ~ +Z.
#   - Muro "segun Y" (eje en obra-Y): plano FEM Z-Y, normal ~ -X.
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
# Material: HA-25 del catalogo del proyecto (src/biblioteca/hormigon.ts, Codigo
# Estructural): Ecm = 22000*((fck+8)/10)^0.3 MPa. Sistema interno kN-m.
# -----------------------------------------------------------------------------
FCK_MPA = 25.0
ECM_MPA = 22000.0 * (((FCK_MPA + 8.0) / 10.0) ** 0.3)
E = ECM_MPA * 1.0e3        # kN/m^2
NU = 0.2
G = E / (2.0 * (1.0 + NU))
RHO = 25.0                 # kN/m^3 (PESO especifico, no masa)
KAPPA = 1.2                # factor de cortante de seccion rectangular (Timoshenko)


def nombre(col, fila):
    return "W_%d_%d" % (col, fila)


# =============================================================================
# Construye un muro rectangular de quads en un plano VERTICAL con el orden de nudos
# del PLAN (col = eje s ascendente, fila = cota ascendente):
#   i=(col,fila) j=(col+1,fila) m=(col+1,fila+1) n=(col,fila+1)
# eje="x": el eje s corre en FEM X (muro segun obra-X, plano X-Y).
# eje="z": el eje s corre en FEM Z (muro segun obra-Y, plano Z-Y).
# Base (fila 0) empotrada 6 GDL si base_empotrada (espejo del arranque de pilar).
# Devuelve (modelo, nx, ny, h) con h = tam de celda (malla cuadrada).
# =============================================================================
def construir_muro(L, H, t, h, eje="x", base_empotrada=True, modelo=None, prefijo=None):
    m = modelo if modelo is not None else FEModel3D()
    if "HA25" not in m.materials:
        m.add_material("HA25", E, G, NU, RHO)

    nx = max(1, round(L / h))
    ny = max(1, round(H / h))
    hx = L / nx
    hy = H / ny

    pref = prefijo if prefijo is not None else "W"

    def nom(col, fila):
        return "%s_%d_%d" % (pref, col, fila)

    for fila in range(ny + 1):
        for col in range(nx + 1):
            s = col * hx
            y = fila * hy
            if eje == "x":
                m.add_node(nom(col, fila), s, y, 0.0)
            else:
                m.add_node(nom(col, fila), 0.0, y, s)

    for fila in range(ny):
        for col in range(nx):
            qn = "%sQ_%d_%d" % (pref, col, fila)
            m.add_quad(
                qn,
                nom(col, fila),
                nom(col + 1, fila),
                nom(col + 1, fila + 1),
                nom(col, fila + 1),
                t,
                "HA25",
            )

    if base_empotrada:
        for col in range(nx + 1):
            m.def_support(nom(col, 0), True, True, True, True, True, True)

    return m, nx, ny, hx, hy, nom


# =============================================================================
# P1 — Voladizo de membrana vs Timoshenko.
# Carga lateral EN PLANO P repartida uniforme en la fila de coronacion.
# d_tip = media de los desplazamientos EN PLANO de la fila superior.
# =============================================================================
def voladizo(L, H, t, h, P, eje="x"):
    m, nx, ny, _hx, _hy, nom = construir_muro(L, H, t, h, eje=eje)
    n_top = nx + 1
    dir_carga = "FX" if eje == "x" else "FZ"
    for col in range(nx + 1):
        m.add_node_load(nom(col, ny), dir_carga, P / n_top, case="lat")
    m.add_load_combo("LAT", {"lat": 1.0})
    t0 = time.perf_counter()
    m.analyze_linear(check_statics=False, sparse=True)
    dt = time.perf_counter() - t0

    # desplazamiento en plano de la fila superior (media)
    if eje == "x":
        d_tip = sum(float(m.nodes[nom(c, ny)].DX["LAT"]) for c in range(nx + 1)) / n_top
    else:
        d_tip = sum(float(m.nodes[nom(c, ny)].DZ["LAT"]) for c in range(nx + 1)) / n_top

    I = t * L ** 3 / 12.0
    A = t * L
    d_flex = P * H ** 3 / (3.0 * E * I)
    d_cort = KAPPA * P * H / (G * A)
    d_ref = d_flex + d_cort
    return {
        "modelo": m, "nx": nx, "ny": ny, "nom": nom,
        "d_tip": d_tip, "d_ref": d_ref, "d_flex": d_flex, "d_cort": d_cort,
        "err": 100.0 * (d_tip - d_ref) / d_ref, "dt": dt, "n_quads": nx * ny,
    }


# =============================================================================
# P2a — Axil uniforme: Sy ~= -N/(t*L) a MEDIA ALTURA, Sx ~= 0.
# Pinna que y_local es la VERTICAL (y las unidades tension kN/m2) en ambos ejes.
# OJO (1a ejecucion del spike): en la fila de BASE el campo NO es uniaxial — el
# empotramiento coarta la contraccion de Poisson y aparece Sx ~= nu*Sy (medido
# -157 vs nu*ref=-167, coherente). La medida limpia es a media altura, lejos de
# la base coartada y de la fila cargada (Saint-Venant).
# =============================================================================
def axil(L, H, t, h, N_total, eje="x"):
    m, nx, ny, _hx, _hy, nom = construir_muro(L, H, t, h, eje=eje)
    n_top = nx + 1
    for col in range(nx + 1):
        m.add_node_load(nom(col, ny), "FY", -N_total / n_top, case="ax")
    m.add_load_combo("AX", {"ax": 1.0})
    m.analyze_linear(check_statics=False, sparse=True)

    # Quad central a MEDIA ALTURA; tension en su centro (xi=eta=0).
    col_c = nx // 2
    fila_c = ny // 2
    q = m.quads["%sQ_%d_%d" % ("W", col_c, fila_c)]
    sx, sy, txy = (float(v) for v in q.membrane(0.0, 0.0, local=True, combo_name="AX").flatten())
    sy_ref = -N_total / (t * L)
    return {"sx": sx, "sy": sy, "txy": txy, "sy_ref": sy_ref,
            "err": 100.0 * (sy - sy_ref) / abs(sy_ref)}


# =============================================================================
# P2b — Flexion de voladizo: Sy en las esquinas de base ~= +-6M/(t*L^2), M = P*H.
# (Se evalua en el muro ESBELTO, donde la teoria de viga es fiable; en la esquina
# empotrada hay concentracion local -> se pinna orden de magnitud y SIGNO.)
# =============================================================================
def flexion_esquinas(res, L, H, t, P, eje="x"):
    m, nx, ny, nom = res["modelo"], res["nx"], res["ny"], res["nom"]
    M = P * H
    sy_ref = 6.0 * M / (t * L ** 2)  # tension de borde por teoria de viga

    # esquina s=0 (borde "atras" segun +carga) y s=L, en la base (eta=-1)
    q0 = m.quads["WQ_%d_%d" % (0, 0)]
    qL = m.quads["WQ_%d_%d" % (nx - 1, 0)]
    sy_0 = float(q0.membrane(-1.0, -1.0, local=True, combo_name="LAT").flatten()[1])
    sy_L = float(qL.membrane(1.0, -1.0, local=True, combo_name="LAT").flatten()[1])
    return {"sy_0": sy_0, "sy_L": sy_L, "sy_ref": sy_ref}


# =============================================================================
# P3 — Drilling: reaccion en el GDL de drilling de la base ~ 0 y fuera de plano ~ 0.
# Para muro segun X (plano X-Y, normal Z): drilling = RZ; fuera de plano = FZ.
# =============================================================================
def drilling(res, eje="x"):
    m, nx, nom = res["modelo"], res["nx"], res["nom"]
    rxn_drill = 0.0
    rxn_fplano = 0.0
    rxn_flex_max = 0.0
    for col in range(nx + 1):
        nd = m.nodes[nom(col, 0)]
        # Reacciones de MOMENTO en PyNite: RxnMX/RxnMY/RxnMZ (no RxnR*).
        # Drilling = giro alrededor de la NORMAL del muro: MZ (muro segun X,
        # normal ~Z) / MX (muro segun Y, normal ~X).
        if eje == "x":
            rxn_drill = max(rxn_drill, abs(float(nd.RxnMZ["LAT"])))
            rxn_fplano = max(rxn_fplano, abs(float(nd.RxnFZ["LAT"])))
        else:
            rxn_drill = max(rxn_drill, abs(float(nd.RxnMX["LAT"])))
            rxn_fplano = max(rxn_fplano, abs(float(nd.RxnFX["LAT"])))
        rxn_flex_max = max(rxn_flex_max, abs(float(nd.RxnFY["LAT"])))
    return {"drill_max": rxn_drill, "fuera_plano_max": rxn_fplano,
            "fy_max": rxn_flex_max}


# =============================================================================
# P5 — Peso propio nodal: por quad W = rho*t*hx*hy; FY=-W/4 a sus 4 nudos (acumula).
# SumaV de reacciones de base == rho*t*L*H (peso total), al bit.
# =============================================================================
def peso_propio(L, H, t, h, eje="x"):
    m, nx, ny, hx, hy, nom = construir_muro(L, H, t, h, eje=eje)
    W_quad = RHO * t * hx * hy
    for fila in range(ny):
        for col in range(nx):
            for (cc, ff) in ((col, fila), (col + 1, fila), (col + 1, fila + 1), (col, fila + 1)):
                m.add_node_load(nom(cc, ff), "FY", -W_quad / 4.0, case="pp")
    m.add_load_combo("PP", {"pp": 1.0})
    m.analyze_linear(check_statics=False, sparse=True)
    suma_v = sum(float(m.nodes[nom(c, 0)].RxnFY["PP"]) for c in range(nx + 1))
    W_total = RHO * t * L * H
    return {"suma_v": suma_v, "w_total": W_total,
            "err": 100.0 * (suma_v - W_total) / W_total}


# =============================================================================
# P4 — CR con quads: replica FIEL de _rigidez_diafragma_planta del glue
# (src/solver/pynite_glue.py:1076): rebuild por campo, def_support FUSIONADO
# (forzar DX,DZ; conservar el resto), def_node_disp con el campo rigido, K 3x3 de
# reacciones, x_cr = xm + K[1][2]/K[1][1], z_cr = zm - K[0][2]/K[0][0].
#
# Modelo: 2 plantas (cotas 3 y 6), cimentacion en 0.
#   - 2 pilares 30x30 HA-25 en obra (6,0) y (6,4), empotrados en base, members por tramo.
#   - Pantalla t=0.30 segun obra-Y en x=0, de (0,0) a (0,4), de cota 0 a 6 (2 plantas),
#     malla h -> filas en cotas 0/3/6 garantizadas si h divide 3.
#   - Sin muro, el CR de una planta esta en el eje de los pilares (x=6); con muro,
#     debe moverse HACIA x=0 (la pantalla domina la rigidez en Y => K[1][1] crece y
#     el termino torsional se recentra en el muro).
# =============================================================================
_CAMPOS_CR = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
COND_MAX_CR = 1.0e12

L_MURO_CR = 4.0
T_MURO_CR = 0.30
X_PILARES = 6.0
COTAS = (0.0, 3.0, 6.0)

# seccion pilar 30x30 (m): A, Iy, Iz, J (valores como el discretizador: b*h^3/12 etc.)
B_PIL = 0.30
A_PIL = B_PIL * B_PIL
I_PIL = B_PIL * B_PIL ** 3 / 12.0
J_PIL = 0.141 * B_PIL ** 4


def construir_edificio_cr(h_muro, con_muro=True):
    """Devuelve (builder, plantas) donde builder() reconstruye el modelo desde cero
    (espejo de build_model(payload) del glue: el CR reconstruye POR CAMPO) y plantas =
    {cota: [nudos de esa planta]} (cabezas de pilar + fila del muro en esa cota)."""
    ny = round(6.0 / h_muro)
    nx = round(L_MURO_CR / h_muro)
    filas_planta = {c: round(c / h_muro) for c in COTAS[1:]}

    def nom_muro(col, fila):
        return "MU_%d_%d" % (col, fila)

    def builder():
        m = FEModel3D()
        m.add_material("HA25", E, G, NU, RHO)
        m.add_section("PIL30", A_PIL, I_PIL, I_PIL, J_PIL)
        # pilares en (6,0) y (6,4) obra -> FEM (6, y, 0) y (6, y, 4)
        for pi, z in enumerate((0.0, 4.0)):
            for ci, cota in enumerate(COTAS):
                m.add_node("P%d_%d" % (pi, ci), X_PILARES, cota, z)
            m.def_support("P%d_0" % pi, True, True, True, True, True, True)
            for ci in range(len(COTAS) - 1):
                m.add_member(
                    "MP%d_%d" % (pi, ci),
                    "P%d_%d" % (pi, ci),
                    "P%d_%d" % (pi, ci + 1),
                    "HA25",
                    "PIL30",
                )
        if con_muro:
            # pantalla segun obra-Y en x=0: plano FEM Z-Y
            for fila in range(ny + 1):
                for col in range(nx + 1):
                    m.add_node(nom_muro(col, fila), 0.0, fila * h_muro, col * h_muro)
            for fila in range(ny):
                for col in range(nx):
                    m.add_quad(
                        "MUQ_%d_%d" % (col, fila),
                        nom_muro(col, fila),
                        nom_muro(col + 1, fila),
                        nom_muro(col + 1, fila + 1),
                        nom_muro(col, fila + 1),
                        T_MURO_CR,
                        "HA25",
                    )
            for col in range(nx + 1):
                m.def_support(nom_muro(col, 0), True, True, True, True, True, True)
        return m

    plantas = {}
    for cota in COTAS[1:]:
        ci = COTAS.index(cota)
        nudos = ["P0_%d" % ci, "P1_%d" % ci]
        if con_muro:
            fila = filas_planta[cota]
            nudos += [nom_muro(col, fila) for col in range(nx + 1)]
        plantas[cota] = nudos

    return builder, plantas, nx * ny


def _apoyos_base_de(modelo):
    apoyos = {}
    for name, nd in modelo.nodes.items():
        apoyos[name] = (
            bool(nd.support_DX), bool(nd.support_DY), bool(nd.support_DZ),
            bool(nd.support_RX), bool(nd.support_RY), bool(nd.support_RZ),
        )
    return apoyos


def rigidez_diafragma(builder, coord, nodos, xm, zm, apoyos_base):
    """Copia fiel de _rigidez_diafragma_planta (glue:1076) sobre un builder local."""
    K = [[0.0] * 3 for _ in range(3)]
    dts = []
    for col, (ux, uz, th) in enumerate(_CAMPOS_CR):
        m = builder()
        for name in nodos:
            x, _y, z = coord[name]
            dx = ux - th * (z - zm)
            dz = uz + th * (x - xm)
            _bdx, bdy, _bdz, brx, bry, brz = apoyos_base.get(
                name, (False, False, False, False, False, False)
            )
            m.def_support(name, True, bdy, True, brx, bry, brz)
            m.def_node_disp(name, "DX", dx)
            m.def_node_disp(name, "DZ", dz)
        t0 = time.perf_counter()
        m.analyze_linear(check_statics=False, sparse=True)
        dts.append(time.perf_counter() - t0)
        fx = fz = my = 0.0
        for name in nodos:
            x, _y, z = coord[name]
            rfx = float(m.nodes[name].RxnFX["Combo 1"])
            rfz = float(m.nodes[name].RxnFZ["Combo 1"])
            fx += rfx
            fz += rfz
            my += (x - xm) * rfz - (z - zm) * rfx
        K[0][col] = fx
        K[1][col] = fz
        K[2][col] = my
    return K, dts


def cr_planta(builder, plantas, cota):
    m0 = builder()
    coord = {name: (nd.X, nd.Y, nd.Z) for name, nd in m0.nodes.items()}
    apoyos_base = _apoyos_base_de(m0)
    nodos = plantas[cota]
    xm = sum(coord[n][0] for n in nodos) / len(nodos)
    zm = sum(coord[n][2] for n in nodos) / len(nodos)
    K, dts = rigidez_diafragma(builder, coord, nodos, xm, zm, apoyos_base)
    cond = float(np.linalg.cond(np.asarray(K)))
    x_cr = xm + K[1][2] / K[1][1]
    z_cr = zm - K[0][2] / K[0][0]
    return {"x_cr": x_cr, "z_cr": z_cr, "cond": cond, "dts": dts, "xm": xm, "zm": zm}


# =============================================================================
# Informe.
# =============================================================================
def imprimir_informe():
    print("=" * 78)
    print("SPIKE F0 - Quad3D como PANTALLA (membrana vertical, drilling, CR, pp nodal)")
    print("=" * 78)
    print("numpy=%s scipy=%s (PyNiteFEA 2.0.2)  HA-25: E=%.4g kN/m2 nu=%.2f G=%.4g"
          % (np.__version__, __import__("scipy").__version__, E, NU, G))
    ok_todas = True

    # --- P1: voladizo esbelto y achaparrado, 2 mallas, ambos ejes -------------
    print()
    print("--- P1: voladizo en plano vs Timoshenko (d = PH^3/3EI + 1.2*PH/GA) ---")
    print("   caso            | eje | malla   | quads | d_FEM [mm] | d_ref [mm] | err%")
    print("   ----------------+-----+---------+-------+------------+------------+------")
    P = 100.0
    casos = [
        ("esbelto L1.5 H6", 1.5, 6.0, 0.30),
        ("achap.  L4  H3 ", 4.0, 3.0, 0.30),
    ]
    errores_p1 = {}
    for nombre_caso, L, H, t in casos:
        for h in (0.5, 0.25):
            for eje in ("x", "z"):
                r = voladizo(L, H, t, h, P, eje=eje)
                clave = (nombre_caso.strip(), h, eje)
                errores_p1[clave] = r
                print("   %s | %s  | h=%.2f  | %5d | %10.4f | %10.4f | %+6.2f"
                      % (nombre_caso, eje, h, r["n_quads"],
                         r["d_tip"] * 1e3, r["d_ref"] * 1e3, r["err"]))

    # criterio: el ESBELTO (teoria fiable) a malla fina debe caer dentro de +-10%
    # en ambos ejes; el achaparrado se reporta (la referencia de viga es aproximada
    # para H/L<1) pero debe estar en el mismo orden (+-25%) y CONVERGER al refinar.
    err_esb = max(abs(errores_p1[("esbelto L1.5 H6", 0.25, e)]["err"]) for e in ("x", "z"))
    err_ach_g = max(abs(errores_p1[("achap.  L4  H3", 0.5, e)]["err"]) for e in ("x", "z"))
    err_ach_f = max(abs(errores_p1[("achap.  L4  H3", 0.25, e)]["err"]) for e in ("x", "z"))
    p1_ok = err_esb <= 10.0 and err_ach_f <= 25.0
    print("   => esbelto(h=.25) err_max=%.2f%% (tol 10)  achap. %.2f%%->%.2f%% (tol 25): %s"
          % (err_esb, err_ach_g, err_ach_f, "OK" if p1_ok else "FALLA"))
    ok_todas = ok_todas and p1_ok

    # simetria entre ejes (la emision del discretizador debe ser equivalente):
    d_x = errores_p1[("esbelto L1.5 H6", 0.25, "x")]["d_tip"]
    d_z = errores_p1[("esbelto L1.5 H6", 0.25, "z")]["d_tip"]
    sim = abs(d_x - d_z) / abs(d_x)
    print("   => simetria eje X vs eje Y (mismo |d_tip|): dif relativa = %.2e  %s"
          % (sim, "OK" if sim < 1e-9 else "FALLA"))
    ok_todas = ok_todas and sim < 1e-9

    # --- P2a: axil uniforme -> Sy=-N/(t*L), Sx~0 (unidades y eje vertical) ----
    print()
    print("--- P2a: q.membrane() con axil uniforme (Sy = tension VERTICAL, kN/m2) ---")
    N_TOT = 1000.0
    for eje in ("x", "z"):
        r = axil(4.0, 3.0, 0.30, 0.25, N_TOT, eje=eje)
        ok = abs(r["err"]) < 5.0 and abs(r["sx"]) < 0.15 * abs(r["sy_ref"])
        print("   eje %s: Sy=%.2f (ref %.2f, err %+.2f%%)  Sx=%.2f  Txy=%.2f  %s"
              % (eje, r["sy"], r["sy_ref"], r["err"], r["sx"], r["txy"],
                 "OK" if ok else "FALLA"))
        ok_todas = ok_todas and ok

    # --- P2b: flexion -> Sy(esquinas base) ~ +-6M/(t*L^2), signos opuestos ----
    print()
    print("--- P2b: flexion de voladizo, Sy en esquinas de base vs 6M/(t*L^2) ---")
    r_esb = voladizo(1.5, 6.0, 0.30, 0.25, P, eje="x")
    fe = flexion_esquinas(r_esb, 1.5, 6.0, 0.30, P, eje="x")
    # carga +X: traccion en s=0 (borde de atras)? -> lo que importa: signos OPUESTOS
    # y magnitud ~ref (la esquina empotrada concentra; tol amplia x2)
    signos_ok = fe["sy_0"] * fe["sy_L"] < 0
    mag_ok = (0.5 < abs(fe["sy_0"]) / fe["sy_ref"] < 2.0
              and 0.5 < abs(fe["sy_L"]) / fe["sy_ref"] < 2.0)
    print("   Sy(s=0)=%.1f  Sy(s=L)=%.1f  ref=+-%.1f kN/m2  signos opuestos=%s mag=%s"
          % (fe["sy_0"], fe["sy_L"], fe["sy_ref"], signos_ok, mag_ok))
    ok_todas = ok_todas and signos_ok and mag_ok

    # --- P3: drilling y fuera de plano ----------------------------------------
    print()
    print("--- P3: estabilidad (drilling) y reacciones parasitas ---")
    for eje in ("x", "z"):
        r = voladizo(4.0, 3.0, 0.30, 0.25, P, eje=eje)
        d = drilling(r, eje=eje)
        # parasitas: fuera de plano y drilling << las reacciones de membrana (FY)
        ok = (d["fuera_plano_max"] < 1e-6 * max(d["fy_max"], 1.0)
              and d["drill_max"] < 1e-6 * max(d["fy_max"], 1.0))
        print("   eje %s: |Rxn drilling|max=%.3e  |Rxn fuera de plano|max=%.3e  "
              "|RxnFY|max=%.1f  %s"
              % (eje, d["drill_max"], d["fuera_plano_max"], d["fy_max"],
                 "OK" if ok else "FALLA"))
        ok_todas = ok_todas and ok

    # --- P5: peso propio nodal -------------------------------------------------
    print()
    print("--- P5: peso propio nodal (W/4 por quad) -> SumaV base = rho*t*L*H ---")
    r = peso_propio(4.0, 3.0, 0.30, 0.25)
    ok = abs(r["err"]) < 1e-9
    print("   SumaV=%.6f  W_total=%.6f  err=%.2e%%  %s"
          % (r["suma_v"], r["w_total"], r["err"], "OK" if ok else "FALLA"))
    ok_todas = ok_todas and ok

    # --- P4: CR con pantalla ---------------------------------------------------
    print()
    print("--- P4: CR (mecanismo del glue) con pantalla excentrica ---")
    print("   pilares en x=%.1f; pantalla segun obra-Y en x=0 (t=%.2f, L=%.1f, H=6, 2 plantas)"
          % (X_PILARES, T_MURO_CR, L_MURO_CR))

    # referencia SIN muro: CR en el eje de pilares (x=6) por simetria
    b0, p0, _ = construir_edificio_cr(0.5, con_muro=False)
    r0 = cr_planta(b0, p0, 3.0)
    print("   sin muro : planta cota 3 -> x_cr=%.3f (esperado %.1f)  cond=%.2e"
          % (r0["x_cr"], X_PILARES, r0["cond"]))

    resultados_cr = {}
    for h in (0.5, 0.25):
        b1, p1, n_quads = construir_edificio_cr(h, con_muro=True)
        t0 = time.perf_counter()
        r3 = cr_planta(b1, p1, 3.0)
        r6 = cr_planta(b1, p1, 6.0)
        dt_total = time.perf_counter() - t0
        resultados_cr[h] = (r3, r6, n_quads, dt_total)
        print("   con muro h=%.2f (%d quads): cota3 x_cr=%.3f z_cr=%.3f cond=%.2e |"
              " cota6 x_cr=%.3f cond=%.2e | coste 2 plantas x 3 campos = %.2f s"
              % (h, n_quads, r3["x_cr"], r3["z_cr"], r3["cond"],
                 r6["x_cr"], r6["cond"], dt_total))

    r3f, r6f, _, _ = resultados_cr[0.25]
    # criterios: se mueve HACIA el muro (x_cr < 3 = mas cerca de x=0 que del centro
    # geometrico entre muro y pilares), cond sano, estable entre mallas (<10% de L)
    hacia_muro = r3f["x_cr"] < 3.0 and r0["x_cr"] > 5.5
    cond_ok = r3f["cond"] < COND_MAX_CR and r6f["cond"] < COND_MAX_CR
    est_malla = abs(resultados_cr[0.5][0]["x_cr"] - r3f["x_cr"]) < 0.10 * X_PILARES
    print("   => CR hacia el muro: %s | cond<1e12: %s | estable entre mallas: %s"
          % (hacia_muro, cond_ok, est_malla))
    ok_todas = ok_todas and hacia_muro and cond_ok and est_malla

    # --- VEREDICTO --------------------------------------------------------------
    print()
    print("=" * 78)
    print("VEREDICTO: %s" % ("GO" if ok_todas else "STOP / NO-GO"))
    if ok_todas:
        print("  - P1 pinna la TOL del golden del voladizo (esbelto, malla h=L/6):")
        print("      err_esbelto=%.2f%% -> TOL_REL_MURO_VOLADIZO = %.1f%% (err + margen)"
              % (err_esb, math.ceil(max(err_esb * 1.6, 2.0) * 10) / 10.0))
        print("  - P2 pinna: membrane() = [Sx, Sy, Txy] TENSION kN/m2, Sy = VERTICAL")
        print("    con el orden i,j,m,n del plan (col=s asc, fila=cota asc), ambos ejes.")
        print("  - P4 pinna: CR con quads converge, cond sano, coste medido arriba.")
    print("=" * 78)
    return ok_todas


def main():
    ap = argparse.ArgumentParser(description="Spike F0 - muro pantalla de quads")
    ap.parse_args()
    go = imprimir_informe()
    sys.exit(0 if go else 1)


if __name__ == "__main__":
    main()
