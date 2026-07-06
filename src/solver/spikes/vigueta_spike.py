# =============================================================================
# SPIKE T0.2 (corte "forjado unidireccional") — ESTABILIDAD de una VIGUETA
# biapoyada AISLADA sobre el motor real (PyNiteFEA 2.0.2, el par del proyecto).
#
# PUERTA go/no-go que gatea la Fase 1+ del corte. NO implementa la feature ni toca
# produccion: explora, mide y DECIDE el ApoyoFEM exacto por extremo para una vigueta
# biarticulada cuyo borde de apoyo NO tiene viga de contorno (apoya en un NUDO con
# apoyo nodal, no en un member).
#
# EL PROBLEMA (sospecha del plan, CONFIRMADA con numeros):
#   El corte modela la vigueta como member BIARTICULADO. Los releases del proyecto
#   (src/discretizador/discretizar.ts:105-125, releasesDeExtremo("articulado",
#   "articulado", false)) liberan SOLO Ry,Rz de cada extremo (rotula de flexion) y
#   JAMAS Rx (torsion). Un apoyo puramente DY (vertical) deja SIN RIGIDEZ varios GDL
#   de la vigueta aislada:
#     - DZ  (traslacion perpendicular al eje, horizontal): ninguna barra la coarta.
#     - RX  (torsion propia): el member no aporta GJ porque J=0 (rectangular, decision
#           F1); ademas el release no la libera pero tampoco la rigidiza.
#     - RY, RZ: los releases del member ponen a 0 su rigidez rotacional en el nudo.
#
# EL CHEQUEO DE PyNite 2.0.2 (verificado en el fuente, Pynite/Analysis._check_stability):
#   Recorre CADA termino DIAGONAL de la matriz de rigidez K. Si K[i,i] ~ 0 y ese GDL
#   NO esta soportado por un apoyo -> marca "Nodal instability" y LANZA una excepcion.
#   Es un chequeo POR GDL y POR NUDO (no global). CONSECUENCIA: todo GDL rotacional sin
#   rigidez (rotula liberada, o torsion con J=0) DEBE estar soportado por def_support,
#   aunque fisicamente sea "inofensivo" (una rotula no transmite momento; el apoyo
#   nodal retiene el giro del NUDO, no del member — el release sigue vivo).
#
# EL GOTCHA (basura silenciosa, como la basculacion colineal de losa plana):
#   _check_stability solo mira la DIAGONAL. Un GDL con K[i,i] != 0 pero cuya submatriz
#   reducida es SINGULAR por acoplamiento (caso de DZ aqui) NO se caza: spsolve emite
#   un MatrixRankWarning y devuelve NaN, SIN lanzar. El spike lo caza midiendo M/flecha.
#
# CONVENCION FEM Y-up (src/discretizador/geometria.ts, mapearEjes):
#   FEM (X,Y,Z) = (x_obra, cota_vertical, y_obra). Vertical = Y.
#   Vigueta HORIZONTAL a lo largo del eje X global (i en x=0, j en x=L, misma Y,Z).
#   -> eje local x = X global; para barra horizontal PyNite pone eje local y = Y global.
#      Carga w=-5 kN/m en FY flecta en el plano local x-y => la gobierna el campo Iz
#      local (Member3D 2.0.2): momento Mz local, flecha dy local. Torsion = Rx local = X.
#
# SWAP C-1 (src/discretizador/propiedadesBarra.ts, seccionFEMParaPyNite): la app tabula
#   Iy=eje FUERTE (b·h^3/12, canto gobierna) e Iz=eje debil, y al emitir la Capa 2
#   INTERCAMBIA: FEM Iy := Iz_app, FEM Iz := Iy_app. Asi la flexion vertical (campo Iz
#   de PyNite) usa el eje FUERTE. Este spike monta la seccion FEM YA con el swap, tal
#   como el discretizador, para que la analitica con I=b·h^3/12 case con Mz/dy.
#
# -----------------------------------------------------------------------------
# COMO EJECUTARLO  (identico a los spikes hermanos de esta carpeta)
#   pip install "PyNiteFEA==2.0.2" numpy scipy PrettyTable
#     (o el wheel vendorizado:
#        pip install vendor/wheels/pynitefea-2.0.2-py3-none-any.whl \
#                    vendor/wheels/prettytable-3.17.0-py3-none-any.whl)
#   NO forma parte de `npm test` (lento y exploratorio):
#        python src/solver/spikes/vigueta_spike.py
#   El motor de PRODUCCION es PyNite sobre Pyodide/WASM; el algoritmo (FEModel3D +
#   analyze_linear sparse) es Python puro e IDENTICO al que correra en Pyodide.
#
# Nota de diseno hermana (leela primero): ./vigueta_spike.md
# =============================================================================

import math
import sys

try:
    from Pynite import FEModel3D
except ImportError:  # pragma: no cover
    sys.stderr.write(
        "ERROR: falta PyNiteFEA. Instala el par del proyecto:\n"
        '    pip install "PyNiteFEA==2.0.2" numpy scipy PrettyTable\n'
    )
    sys.exit(2)


# -----------------------------------------------------------------------------
# Datos del enunciado (sistema interno kN-m del proyecto).
# HA-25 REAL del catalogo (src/biblioteca/hormigon.ts, Codigo Estructural):
#   Ecm = 22000*((fck+8)/10)^0.3 MPa con fck=25 -> ~31476 MPa -> 31476e3 kN/m^2.
#   (NO la EHE-08 derogada 8500*fcm^(1/3). nu=0.2, G=E/(2(1+nu)), rho=25 kN/m^3.)
# Seccion rectangular 0.12 (b, ancho) x 0.30 (h, canto). J=0 (decision F1).
# -----------------------------------------------------------------------------
FCK_MPA = 25.0
ECM_MPA = 22000.0 * (((FCK_MPA + 8.0) / 10.0) ** 0.3)  # Codigo Estructural / EC2
E = ECM_MPA * 1.0e3          # kN/m^2  (1 MPa = 1e3 kN/m^2)
NU = 0.2
G = E / (2.0 * (1.0 + NU))   # kN/m^2
RHO = 25.0                   # kN/m^3 (PESO especifico; sin peso propio en el spike)

B = 0.12                     # m  ancho de la vigueta
H = 0.30                     # m  canto de la vigueta
L = 5.0                      # m  luz
W = -5.0                     # kN/m  carga gravitatoria (FY global, hacia abajo)

# --- Propiedades de seccion en la convencion de la APP (catalogo) ------------
A = B * H
IY_APP = B * H ** 3 / 12.0                 # eje FUERTE (canto gobierna)  m^4
IZ_APP = H * B ** 3 / 12.0                 # eje debil                    m^4
J = 0.0                                    # rectangular: J=0 (decision F1 del proyecto)

# --- Seccion FEM CON el swap C-1 aplicado (lo que emite el discretizador) -----
IY_FEM = IZ_APP     # FEM Iy := Iz_app
IZ_FEM = IY_APP     # FEM Iz := Iy_app
I_FLEXION = IZ_FEM  # gobierna la flexion vertical == IY_APP == b·h^3/12 (eje fuerte)


# -----------------------------------------------------------------------------
# Analitica de referencia (viga biapoyada, carga uniforme q=|W|).
# -----------------------------------------------------------------------------
Q = abs(W)
M_MAX_TEO = Q * L ** 2 / 8.0                          # kN·m
DELTA_TEO = 5.0 * Q * L ** 4 / (384.0 * E * I_FLEXION)  # m (I = eje fuerte)


# =============================================================================
# Construye la vigueta AISLADA horizontal (a lo largo de X) con releases
# biarticulados EXACTOS del proyecto y un patron de apoyo por extremo.
#   apoyo_i, apoyo_j: dicts {DX,DY,DZ,RX,RY,RZ} (True = restringido).
#   jval: constante de torsion (0.0 = realista del proyecto; parametro para el
#         diagnostico de que RX solo se estabiliza con GJ o con apoyo RX).
# =============================================================================
def construir_vigueta(apoyo_i, apoyo_j, jval=J):
    m = FEModel3D()
    m.add_material("HA25", E, G, NU, RHO)
    m.add_section("SEC", A, IY_FEM, IZ_FEM, jval)  # seccion FEM con swap C-1
    m.add_node("Ni", 0.0, 0.0, 0.0)
    m.add_node("Nj", L, 0.0, 0.0)
    m.add_member("Vig", "Ni", "Nj", "HA25", "SEC")
    # Releases EXACTOS del proyecto (art/art): libera Ryi,Rzi,Ryj,Rzj ; NUNCA Rx.
    #   [Dxi,Dyi,Dzi,Rxi,Ryi,Rzi, Dxj,Dyj,Dzj,Rxj,Ryj,Rzj]
    m.def_releases(
        "Vig",
        False, False, False, False, True, True,
        False, False, False, False, True, True,
    )
    for nombre, ap in (("Ni", apoyo_i), ("Nj", apoyo_j)):
        m.def_support(
            nombre,
            ap.get("DX", False), ap.get("DY", False), ap.get("DZ", False),
            ap.get("RX", False), ap.get("RY", False), ap.get("RZ", False),
        )
    m.add_member_dist_load("Vig", "FY", W, W, case="Case 1")
    m.add_load_combo("ELU", {"Case 1": 1.0})
    return m


# =============================================================================
# Corre analyze_linear (sparse=True, como el glue) y diagnostica.
#   - unstable: True si PyNite LANZA (mecanismo cazado por _check_stability).
#   - Si resuelve: M_max de moment_array("Mz"), flecha de deflection_array("dy"),
#     y si algun valor es NaN (basura silenciosa: singular no cazada por la diagonal).
# =============================================================================
def correr(apoyo_i, apoyo_j, jval=J, n_points=21):
    m = construir_vigueta(apoyo_i, apoyo_j, jval)
    try:
        m.analyze_linear(check_statics=False, sparse=True)
    except Exception as exc:  # noqa: BLE001 - queremos el texto
        return {"unstable": True, "error": type(exc).__name__ + ": " + str(exc)}
    combo = "ELU"
    mz = m.members["Vig"].moment_array("Mz", n_points, combo)[1]
    dy = m.members["Vig"].deflection_array("dy", n_points, combo)[1]
    m_max = float(max(abs(v) for v in mz))
    flecha = float(min(dy))
    flecha_abs = float(max(abs(v) for v in dy))
    hay_nan = any(math.isnan(float(v)) for v in mz) or any(math.isnan(float(v)) for v in dy)
    return {
        "unstable": False, "nan": hay_nan,
        "m_max": m_max, "flecha": flecha, "flecha_abs": flecha_abs,
    }


# =============================================================================
# Pregunta 3: vigueta ANCLADA al portico. Mini-modelo (4 pilares + 2 vigas de
# contorno paralelas a X + 1 vigueta paralela a Z, biarticulada, compartiendo
# nudos con las vigas). Sin apoyos nodales extra en la vigueta.
#   jval: J de TODAS las barras. Con J=0 (realista) las vigas de contorno no dan
#   rigidez RX al nudo compartido -> se comprueba si la vigueta anclada tambien
#   necesita RX. carga total sobre la vigueta = |W|·LZ.
# =============================================================================
def construir_portico(jval=J):
    m = FEModel3D()
    m.add_material("HA25", E, G, NU, RHO)
    m.add_section("SEC_VIG", A, IY_FEM, IZ_FEM, jval)
    ap = 0.30 * 0.30
    ai = 0.30 * 0.30 ** 3 / 12.0
    m.add_section("SEC_PIL", ap, ai, ai, jval)

    LX, LZ, HT = 4.0, 5.0, 3.0
    for nombre, x, z in (("A", 0.0, 0.0), ("B", LX, 0.0), ("C", 0.0, LZ), ("D", LX, LZ)):
        m.add_node("base_" + nombre, x, 0.0, z)
        m.add_node("cab_" + nombre, x, HT, z)
        m.def_support("base_" + nombre, True, True, True, True, True, True)
        m.add_member("pil_" + nombre, "base_" + nombre, "cab_" + nombre, "HA25", "SEC_PIL")

    # Nudos de la vigueta a media luz de cada viga de contorno.
    m.add_node("vig_i", LX / 2.0, HT, 0.0)
    m.add_node("vig_j", LX / 2.0, HT, LZ)
    # Vigas de contorno partidas en dos tramos por esos nudos (para que la vigueta
    # descargue EN la viga, no en el aire).
    for nombre, a, b in (
        ("viga_AB_1", "cab_A", "vig_i"), ("viga_AB_2", "vig_i", "cab_B"),
        ("viga_CD_1", "cab_C", "vig_j"), ("viga_CD_2", "vig_j", "cab_D"),
    ):
        m.add_member(nombre, a, b, "HA25", "SEC_VIG")

    m.add_member("vigueta", "vig_i", "vig_j", "HA25", "SEC_VIG")
    m.def_releases(
        "vigueta",
        False, False, False, False, True, True,
        False, False, False, False, True, True,
    )
    m.add_member_dist_load("vigueta", "FY", W, W, case="Case 1")
    m.add_load_combo("ELU", {"Case 1": 1.0})
    return m, LZ


def correr_portico(jval=J):
    m, LZ = construir_portico(jval)
    try:
        m.analyze_linear(check_statics=False, sparse=True)
    except Exception as exc:  # noqa: BLE001
        return {"unstable": True, "error": type(exc).__name__ + ": " + str(exc)}
    combo = "ELU"
    carga_total = abs(W) * LZ
    suma_v = sum(float(m.nodes["base_" + n].RxnFY[combo]) for n in ("A", "B", "C", "D"))
    vy = m.members["vigueta"].shear_array("Fy", 3, combo)[1]
    return {
        "unstable": False, "carga_total": carga_total, "suma_reacciones_v": suma_v,
        "residuo": suma_v - carga_total,
        "cortante_i": float(vy[0]), "cortante_j": float(vy[-1]),
    }


# =============================================================================
# ApoyoFEM RECOMENDADO para la vigueta AISLADA (borde sin viga de contorno).
# Cada extremo restringe TODO menos DX; DX se ancla SOLO en el extremo i (fija el
# eje longitudinal sin generar reaccion axil espuria; un member biarticulado con
# carga transversal no tiene axil, asi que un solo DX basta).
# =============================================================================
APOYO_I = {"DX": True, "DY": True, "DZ": True, "RX": True, "RY": True, "RZ": True}
APOYO_J = {"DX": False, "DY": True, "DZ": True, "RX": True, "RY": True, "RZ": True}


def imprimir_informe():
    import numpy as _np
    import scipy as _sp

    print("=" * 78)
    print("SPIKE T0.2 - ESTABILIDAD de una VIGUETA biapoyada AISLADA (FEM Y-up)")
    print("=" * 78)
    print("numpy=%s  scipy=%s  (PyNiteFEA 2.0.2)" % (_np.__version__, _sp.__version__))
    print()
    print("Vigueta: L=%.1f m  seccion %.2fx%.2f m (b x h)  HA-25" % (L, B, H))
    print("  E(HA-25 Codigo Estructural) = %.0f MPa = %.6g kN/m2" % (ECM_MPA, E))
    print("  nu=%.2f  G=%.6g kN/m2  carga w=%.1f kN/m (FY)" % (NU, G, W))
    print("  Iy_app(fuerte)=%.6e  Iz_app(debil)=%.6e  ->  swap C-1  ->  FEM Iz=%.6e (flexion vertical)"
          % (IY_APP, IZ_APP, IZ_FEM))
    print("  ANALITICA: M_max=qL^2/8=%.6f kN·m   delta=5qL^4/(384EI)=%.6e m"
          % (M_MAX_TEO, DELTA_TEO))
    print()

    # ---- (1) Patron de apoyo escalonado -------------------------------------
    print("--- (1) PATRON DE APOYO escalonado (vigueta AISLADA, J=0) ------------------")
    escalones = [
        ("(a) i:DY              j:DY",
         {"DY": 1}, {"DY": 1}),
        ("(b) i:DY+DX+DZ        j:DY+DZ            (candidato del plan)",
         {"DY": 1, "DX": 1, "DZ": 1}, {"DY": 1, "DZ": 1}),
        ("(c) i:DY+DX+DZ+RX     j:DY+DZ            (a nade RX en i)",
         {"DY": 1, "DX": 1, "DZ": 1, "RX": 1}, {"DY": 1, "DZ": 1}),
        ("(d) i:DX+DY+DZ+RX+RY+RZ  j:DY+DZ+RX+RY+RZ  (RECOMENDADO: todo salvo DX en j)",
         APOYO_I, APOYO_J),
    ]
    res1 = []
    for etiqueta, ai_, aj_ in escalones:
        r = correr(ai_, aj_)
        res1.append((etiqueta, r))
        print("  " + etiqueta)
        if r["unstable"]:
            print("     -> PyNite LANZA (mecanismo nodal cazado).")
        elif r["nan"]:
            print("     -> resuelve pero M/flecha = NaN  <<< BASURA SILENCIOSA (singular no cazada)")
        else:
            em = 100.0 * (r["m_max"] - M_MAX_TEO) / M_MAX_TEO
            ed = 100.0 * (r["flecha_abs"] - DELTA_TEO) / DELTA_TEO
            print("     -> OK  M_max=%.6f kN·m (err %+.4f%%)  flecha=%.6e m (err %+.4f%%)"
                  % (r["m_max"], em, r["flecha_abs"], ed))
        print()

    # ---- Gotcha DEDICADO: SOLO falta DZ (los rotacionales SI estan) ----------
    # Este es el caso de BASURA SILENCIOSA del proyecto: con RX,RY,RZ soportados,
    # K[DZ,DZ] NO es exactamente 0 (esta acoplado), asi que _check_stability (que
    # solo mira la DIAGONAL) NO lo caza; pero la submatriz reducida es SINGULAR ->
    # spsolve emite MatrixRankWarning y devuelve NaN, sin lanzar. Solo se detecta
    # midiendo el resultado (aqui: M/flecha = NaN).
    print("--- Gotcha DEDICADO: falta DZ en AMBOS (rotacionales presentes) ------------")
    # DZ ausente en LOS DOS extremos con RX,RY,RZ presentes: la diagonal K[DZ,DZ] NO
    # es 0 (se acopla con la rotacion), asi que _check_stability NO lo caza; pero la
    # matriz global es SINGULAR -> NaN silencioso. (Si DZ falta en UN solo extremo, el
    # otro lo ancla y SI resuelve: por eso el patron recomendado pone DZ en AMBOS.)
    ai_solo_sin_dz = {"DX": 1, "DY": 1, "RX": 1, "RY": 1, "RZ": 1}   # sin DZ
    aj_solo_sin_dz = {"DX": 1, "DY": 1, "RX": 1, "RY": 1, "RZ": 1}   # sin DZ (ambos)
    rg = correr(ai_solo_sin_dz, aj_solo_sin_dz)
    if rg["unstable"]:
        print("  -> LANZA (lo caza la diagonal).")
    elif rg["nan"]:
        print("  -> resuelve SIN lanzar pero M/flecha = NaN  <<< BASURA SILENCIOSA")
        print("     (MatrixRankWarning arriba: singular no vista por _check_stability)")
    else:
        print("  -> OK (inesperado): M_max=%.6f flecha=%.6e" % (rg["m_max"], rg["flecha_abs"]))
    print()

    # ---- Diagnostico: quitar-de-a-uno del patron recomendado ----------------
    print("--- Diagnostico: cada GDL del patron recomendado es NECESARIO --------------")
    print("    (se quita UNO de ambos extremos del patron RECOMENDADO y se observa)")
    for quitar in ("DZ", "RX", "RY", "RZ"):
        ai_ = {k: v for k, v in APOYO_I.items() if not (k == quitar and v)}
        aj_ = {k: v for k, v in APOYO_J.items() if not (k == quitar and v)}
        r = correr(ai_, aj_)
        if r["unstable"]:
            estado = "LANZA (nodal)"
        elif r["nan"]:
            estado = "NaN  <<< BASURA SILENCIOSA (singular no cazada por la diagonal)"
        else:
            estado = "OK (no imprescindible)"
        print("  sin %s en ambos -> %s" % (quitar, estado))
    print()

    # ---- (2) Analitica clavada con el patron recomendado --------------------
    print("--- (2) ANALITICA CLAVADA con el patron RECOMENDADO ------------------------")
    r = correr(APOYO_I, APOYO_J)
    tol_m = tol_d = None
    if r["unstable"] or r["nan"]:
        print("  El patron recomendado no dio solucion limpia (revisar).")
    else:
        em = abs(100.0 * (r["m_max"] - M_MAX_TEO) / M_MAX_TEO)
        ed = abs(100.0 * (r["flecha_abs"] - DELTA_TEO) / DELTA_TEO)
        print("  M_max  motor=%.6f  teoria=%.6f  err=%.6f%%" % (r["m_max"], M_MAX_TEO, em))
        print("  flecha motor=%.6e  teoria=%.6e  err=%.6f%%" % (r["flecha_abs"], DELTA_TEO, ed))
        tol_m = max(math.ceil(max(em, 1e-6) * 1.5 * 1000) / 1000.0, 0.001)
        tol_d = max(math.ceil(max(ed, 1e-6) * 1.5 * 1000) / 1000.0, 0.001)
        print("  TOL sugerida golden Fase 3 (err x1.5, piso 0.001%%): M<=%.3f%%  flecha<=%.3f%%"
              % (tol_m, tol_d))
    print()

    # ---- (3) Vigueta anclada al portico -------------------------------------
    print("--- (3) VIGUETA ANCLADA al portico (sin apoyos nodales extra) --------------")
    rp0 = correr_portico(jval=0.0)
    print("  Caso REALISTA (J=0 en todo, como el proyecto):")
    if rp0["unstable"]:
        print("     -> INESTABLE: nudos compartidos vig_i/vig_j inestables (torsion RX;")
        print("        las vigas de contorno van en X y con J=0 no dan rigidez RX al nudo).")
    else:
        print("     -> ESTABLE. SV=%.4f  carga=%.4f  residuo=%.2e kN"
              % (rp0["suma_reacciones_v"], rp0["carga_total"], rp0["residuo"]))
    rpj = correr_portico(jval=1e-5)
    print("  Contraste (J=1e-5 ficticio, solo para aislar la causa RX):")
    if rpj["unstable"]:
        print("     -> INESTABLE.")
    else:
        pct = 100.0 * rpj["residuo"] / rpj["carga_total"]
        print("     -> ESTABLE. SV=%.4f  carga=%.4f  residuo=%.2e kN (%.4f%%)  cortantes=%.4f/%.4f"
              % (rpj["suma_reacciones_v"], rpj["carga_total"], rpj["residuo"], pct,
                 rpj["cortante_i"], rpj["cortante_j"]))
    print()

    # ---- Veredicto ----------------------------------------------------------
    print("=" * 78)
    a_lanza = res1[0][1]["unstable"]
    b_limpio = (not res1[1][1]["unstable"]) and not res1[1][1].get("nan", False)
    d_limpio = (not res1[3][1]["unstable"]) and not res1[3][1].get("nan", False)
    portico_j0_estable = not rp0["unstable"]
    go = d_limpio and (tol_m is not None)
    print("VEREDICTO: %s" % ("GO" if go else "STOP / revisar"))
    print("  (a) DY+DY LANZA:                              %s" % a_lanza)
    print("  (b) candidato del plan LIMPIO:                %s   (esperado False)" % b_limpio)
    print("  (d) RECOMENDADO (todo salvo DX en j) LIMPIO:  %s" % d_limpio)
    print("  (3) vigueta anclada estable con J=0:          %s   (esperado False)" % portico_j0_estable)
    print("  ApoyoFEM AISLADA recomendado por extremo:")
    print("     i = DX,DY,DZ,RX,RY,RZ = True (todo)")
    print("     j = DY,DZ,RX,RY,RZ = True ; DX = False")
    print("=" * 78)
    return go


def main():
    go = imprimir_informe()
    sys.exit(0 if go else 1)


if __name__ == "__main__":
    main()
