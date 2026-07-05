# =============================================================================
# SPIKE T-f3-masa-placa · T0.2 — P-Delta del motor real CON PLACAS (quads).
#
# PUERTA go/no-go de la Fase 3 (golden losa-plana-pdelta.golden.test.ts): explora
# si `analyze_PDelta(sparse=True)` CORRE con quads presentes en el modelo, cuanto
# amplifica frente a `analyze_linear` con el mismo combo, y si el equilibrio (ΣV,
# ΣH, axiles) sigue cuadrando. NO implementa la feature ni toca el glue.
#
# Plan: corte T-f3-masa-placa (aprobado). Nota de diseno: ./pdelta_placa_spike.md
#
# -----------------------------------------------------------------------------
# COMO EJECUTARLO  (identico al patron de cr_diafragma_spike.py)
#   - Necesita PyNiteFEA 2.0.2 (el par del proyecto, src/solver/config.ts) + numpy.
#     Instalable local:  pip install "PyNiteFEA==2.0.2" numpy scipy PrettyTable
#   - NO forma parte de `npm test`:
#         python src/solver/spikes/pdelta_placa_spike.py       # imprime el informe
#   - El motor de PRODUCCION es PyNite sobre Pyodide/WASM (worker.ts). Este spike usa
#     PyNite local: el algebra de la rigidez geometrica es Python puro e identica; la
#     unica diferencia es el build de numpy/scipy, irrelevante para la pregunta del
#     spike (¿corre P-Δ con quads? ¿amplifica? ¿cuadra?). El golden de Fase 3
#     re-asertara con el motor Pyodide real (par 0.28.3 / 2.0.2 / numpy 2.2.5).
#
# -----------------------------------------------------------------------------
# HECHO VERIFICADO (docstring oficial analyze_PDelta, PyNite 2.0.2; NO re-derivado):
#   "P-Delta effects in plates/quads are not considered" — los quads ensamblan
#   rigidez ELASTICA k() pero NO rigidez GEOMETRICA kg(). Por tanto el P-Δ con
#   placas amplifica el efecto de 2.º orden SOLO por el axil de las BARRAS (pilares):
#   la losa aporta rigidez elastica y transmite carga/masa, pero no se pandea ella.
#   Consecuencia esperada: la amplificacion la produce el axil de compresion en los
#   pilares bajo la deriva lateral; para un porticon robusto (pilares cortos y
#   gruesos) sera MODESTA. Con pilares esbeltos se hace visible.
#
# -----------------------------------------------------------------------------
# CONVENCION FEM Y-up (src/discretizador/geometria.ts: obra (x,y)+cota ->
# FEM [x, cota, y] = [X, Y, Z]):
#   - plano del forjado = X-Z ; vertical = Y (gravedad = FY NEGATIVA) ; deriva
#     lateral en el plano = FX / FZ.
#   - presion de quad POSITIVA = hacia ABAJO (gravedad), OPUESTA a la FY de barras
#     (signo canonico confirmado en pynite_glue.py:174-183 y el golden de losa).
# =============================================================================

import math
import sys

import numpy as np

# La consola de Windows (cp1252) no encodea Δ/ΣΔ; forzamos UTF-8 en stdout/stderr
# para que el informe salga limpio en cualquier terminal.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:  # pragma: no cover
    pass

try:
    from Pynite import FEModel3D
except ImportError:  # pragma: no cover
    sys.stderr.write(
        "ERROR: falta PyNiteFEA. Instala el par del proyecto:\n"
        '    pip install "PyNiteFEA==2.0.2" numpy scipy PrettyTable\n'
    )
    sys.exit(2)


# -----------------------------------------------------------------------------
# Material HA-25 (valores REALES del catalogo, src/biblioteca/hormigon.ts):
#   Ecm = 22000·(fcm/10)^0,3 [MPa], fcm = fck+8 = 33 MPa (Codigo Estructural).
#   -> Ecm ≈ 31476 MPa = 3.1476e7 kN/m². G = E/(2(1+nu)). rho = 25 kN/m³ (peso).
# -----------------------------------------------------------------------------
FCK = 25.0
FCM = FCK + 8.0
ECM_MPA = 22000.0 * (FCM / 10.0) ** 0.3          # ≈ 31476 MPa
E = ECM_MPA * 1000.0                              # MPa -> kN/m²  (1 MPa = 1e3 kN/m²)
NU = 0.2
G = E / (2.0 * (1.0 + NU))
RHO = 25.0                                        # kN/m³ (peso especifico)
GRAV_MASA = RHO / 9.81                            # densidad de MASA (t/m³) para add_*_self_weight
# (no se usa masa aqui: el P-Δ estatico aplica cargas explicitas, no masa modal.)

# Geometria de la losa de referencia (golden losa-plana, con t=0.25 como pide el
# prompt del spike; el golden de produccion usa 0.20 — el spike documenta ambos).
LADO = 6.0            # m
T_LOSA = 0.25         # m (espesor; el prompt del spike pide 0.25)
Q_SUP = 5.0           # kN/m² sobrecarga/permanente sobre la losa
H = 3.0               # altura de planta (m)
TAM = 1.0             # tamano de malla -> 6x6 quads


# Secciones de pilar: robusto (base de referencia) y esbelto (para ver P-Δ claro).
def sec_pilar(b):
    A = b * b
    I = b ** 4 / 12.0
    J = 2.25e-4 * (b / 0.30) ** 4    # torsion aprox (irrelevante para el axil/deriva)
    return A, I, J


# =============================================================================
# Construccion del modelo: losa LADOxLADO mallada NxN sobre 4 pilares de esquina.
#   - Nudos de malla en la rejilla (x,z) con paso TAM, en la cota H (Y=H).
#   - Quads en orden canonico i->j->m->n (X+ luego Z+), como emite el discretizador.
#   - Pilares de las 4 esquinas interiores (x,z en {off, LADO-off}) de cota 0 a H,
#     empotrados en base; cabeza compartiendo el nudo de malla de esa esquina.
#   - Cargas gravitatorias: peso propio losa (presion quad = rho*t POSITIVA) +
#     sobrecarga (presion quad = Q_SUP POSITIVA) + peso propio pilares (self weight).
#   - Cargas laterales FX en las 4 cabezas de pilar (deriva que P-Δ amplifica).
# =============================================================================
def construir(b_pilar, h_planta, off, fx_total, q_sup=Q_SUP, con_lateral=True):
    m = FEModel3D()
    m.add_material("HA25", E, G, NU, GRAV_MASA)   # 5.º arg = densidad de masa
    A, I, J = sec_pilar(b_pilar)
    m.add_section("PIL", A, I, I, J)

    n = int(round(LADO / TAM))                    # 6 divisiones -> 7x7 nudos
    def nombre(i, j):
        return "N_%d_%d" % (i, j)

    # Nudos de malla en la cota de la losa.
    for i in range(n + 1):
        for j in range(n + 1):
            m.add_node(nombre(i, j), i * TAM, h_planta, j * TAM)

    # Quads (orden canonico X+ luego Z+): i=(i,j) j=(i+1,j) mm=(i+1,j+1) nn=(i,j+1).
    q = 0
    quad_names = []
    for i in range(n):
        for j in range(n):
            qn = "Q%d" % q
            m.add_quad(qn, nombre(i, j), nombre(i + 1, j),
                       nombre(i + 1, j + 1), nombre(i, j + 1), T_LOSA, "HA25")
            quad_names.append(qn)
            q += 1

    # Presion gravitatoria sobre cada quad: peso propio losa + sobrecarga, POSITIVA
    # (hacia abajo, signo canonico del glue). Se acumulan en el mismo case "G".
    presion = RHO * T_LOSA + q_sup                # kN/m² (positiva = abajo)
    for qn in quad_names:
        m.add_quad_surface_pressure(qn, presion, case="G")

    # Pilares en las 4 esquinas interiores. Cabeza = nudo de malla de esa esquina.
    off_idx = int(round(off / TAM))
    esquinas_idx = [(off_idx, off_idx), (n - off_idx, off_idx),
                    (off_idx, n - off_idx), (n - off_idx, n - off_idx)]
    cabezas = []
    for k, (i, j) in enumerate(esquinas_idx):
        cab = nombre(i, j)                         # cabeza = nudo de malla (acople)
        pie = "P%db" % k
        m.add_node(pie, i * TAM, 0.0, j * TAM)
        m.def_support(pie, True, True, True, True, True, True)  # base empotrada
        m.add_member("C%d" % k, pie, cab, "HA25", "PIL")
        cabezas.append(cab)

    # Peso propio de las barras (pilares): densidad de masa * g. add_member_self_weight
    # aplica en la direccion global Y con factor gravedad; usamos -9.81 para que el
    # peso vaya hacia -Y (abajo). Se acumula en el case "G".
    m.add_member_self_weight("FY", -9.81, case="G")

    # Carga lateral en las cabezas (deriva). fx_total repartida en las 4 cabezas.
    if con_lateral and fx_total != 0.0:
        for cab in cabezas:
            m.add_node_load(cab, "FX", fx_total / len(cabezas), case="H")

    # Combo 1.0·G + 1.0·H (comparamos 1.º vs 2.º orden directamente, sin mayorar).
    m.add_load_combo("SERV", {"G": 1.0, "H": 1.0})

    return m, cabezas, quad_names, presion


# =============================================================================
# Utilidades de lectura.
# =============================================================================
def dx_max_cabezas(m, cabezas, combo):
    return max(abs(float(m.nodes[c].DX[combo])) for c in cabezas)


def dx_cabezas(m, cabezas, combo):
    return [float(m.nodes[c].DX[combo]) for c in cabezas]


def suma_reacciones(m, combo):
    """(ΣFX, ΣFY, ΣFZ) de las reacciones en TODOS los nudos con support."""
    sfx = sfy = sfz = 0.0
    for name, nd in m.nodes.items():
        if nd.support_DX or nd.support_DY or nd.support_DZ:
            sfx += float(nd.RxnFX[combo])
            sfy += float(nd.RxnFY[combo])
            sfz += float(nd.RxnFZ[combo])
    return sfx, sfy, sfz


def axiles_pilares(m, combo):
    """Pico de |axil| en cada member de pilar (nombres C0..C3)."""
    out = []
    for name in m.members:
        if name.startswith("C"):
            arr = m.members[name].axial_array(2, combo)   # (2, n): [x; N]
            out.append(float(np.max(np.abs(arr[1]))))
    return out


def carga_vertical_total(presion, b_pilar, h_planta):
    """ΣV teorica = peso losa (presion*area) + peso propio pilares."""
    area = LADO * LADO
    peso_losa = presion * area                   # incluye pp losa + sobrecarga (todo en G)
    A, _, _ = sec_pilar(b_pilar)
    peso_pilares = 4 * (A * RHO * h_planta)
    return peso_losa + peso_pilares


# =============================================================================
# Un caso completo: corre linear y PDelta con el MISMO combo, mide amplificacion,
# equilibrio y axiles. Devuelve dict de resultados.
# =============================================================================
def correr_caso(nombre, b_pilar, h_planta, off, fx_total):
    out = {"nombre": nombre, "b_pilar": b_pilar, "h_planta": h_planta,
           "off": off, "fx_total": fx_total}

    # --- LINEAR (1.º orden) ---
    m_lin, cab, quads, presion = construir(b_pilar, h_planta, off, fx_total)
    m_lin.analyze_linear(check_statics=False, sparse=True)
    dx_lin = dx_max_cabezas(m_lin, cab, "SERV")
    sfx_lin, sfy_lin, sfz_lin = suma_reacciones(m_lin, "SERV")
    ax_lin = axiles_pilares(m_lin, "SERV")

    # --- PDELTA (2.º orden) ---
    corrio = True
    err = None
    dx_pd = sfx_pd = sfy_pd = sfz_pd = float("nan")
    ax_pd = []
    try:
        m_pd, cab2, _, _ = construir(b_pilar, h_planta, off, fx_total)
        m_pd.analyze_PDelta(sparse=True)
        dx_pd = dx_max_cabezas(m_pd, cab2, "SERV")
        sfx_pd, sfy_pd, sfz_pd = suma_reacciones(m_pd, "SERV")
        ax_pd = axiles_pilares(m_pd, "SERV")
    except Exception as e:  # noqa: BLE001
        corrio = False
        err = "%s: %s" % (type(e).__name__, e)

    Vteor = carga_vertical_total(presion, b_pilar, h_planta)

    out.update({
        "presion": presion,
        "Vteor": Vteor,
        "corrio_pdelta": corrio,
        "error_pdelta": err,
        "dx_lin": dx_lin,
        "dx_pd": dx_pd,
        "amp_dx": (dx_pd / dx_lin) if (corrio and dx_lin != 0) else float("nan"),
        "sfx_lin": sfx_lin, "sfy_lin": sfy_lin, "sfz_lin": sfz_lin,
        "sfx_pd": sfx_pd, "sfy_pd": sfy_pd, "sfz_pd": sfz_pd,
        "ax_lin": ax_lin, "ax_pd": ax_pd,
        "fx_total": fx_total,
    })
    return out


def imprimir_caso(r):
    print("-" * 78)
    print("CASO: %s  (pilar %g×%g, H=%g, offset=%g, FX_total=%g kN)"
          % (r["nombre"], r["b_pilar"], r["b_pilar"], r["h_planta"],
             r["off"], r["fx_total"]))
    print("   presion quad (pp losa+sobrecarga) = %.4f kN/m²" % r["presion"])
    print("   (a) P-Δ CORRE con quads presentes: %s%s"
          % (r["corrio_pdelta"], "" if r["corrio_pdelta"] else "  ERROR: " + str(r["error_pdelta"])))
    if r["corrio_pdelta"]:
        print("   (b) DX max cabezas   linear=%.6e m   PDelta=%.6e m   amp=%.5f"
              % (r["dx_lin"], r["dx_pd"], r["amp_dx"]))
        print("   (c) EQUILIBRIO:")
        print("        ΣFY reacciones  linear=%.4f  PDelta=%.4f   (Vteor=%.4f)"
              % (r["sfy_lin"], r["sfy_pd"], r["Vteor"]))
        print("        errRel ΣV       linear=%.2e  PDelta=%.2e"
              % (abs(r["sfy_lin"] - r["Vteor"]) / r["Vteor"],
                 abs(r["sfy_pd"] - r["Vteor"]) / r["Vteor"]))
        print("        ΣFX reacciones  linear=%.4f  PDelta=%.4f   (=-FX_total=%.4f)"
              % (r["sfx_lin"], r["sfx_pd"], -r["fx_total"]))
        print("        ΣFZ reacciones  linear=%.4e  PDelta=%.4e   (≈0)"
              % (r["sfz_lin"], r["sfz_pd"]))
        print("   axiles pilar |N| linear=[%s]"
              % ", ".join("%.3f" % a for a in r["ax_lin"]))
        print("   axiles pilar |N| PDelta=[%s]"
              % ", ".join("%.3f" % a for a in r["ax_pd"]))


def main():
    print("=" * 78)
    print("SPIKE T-f3-masa-placa · T0.2 — P-Δ del motor real CON PLACAS (quads)")
    print("=" * 78)
    import scipy as _sp
    print("numpy=%s  scipy=%s  (PyNiteFEA 2.0.2)" % (np.__version__, _sp.__version__))
    print("E(HA-25)=%.1f kN/m²  G=%.1f  rho=%g kN/m³  losa %g×%g t=%g  q=%g kN/m²"
          % (E, G, RHO, LADO, LADO, T_LOSA, Q_SUP))
    print()

    casos = []
    # Caso A — portico ROBUSTO de referencia (30×30, H=3, pilares cerca de esquina,
    # offset 1 m). FX_total = 20 kN reparte deriva pequena. Amplificacion esperada
    # MODESTA (pilares cortos y rigidos + losa que no se pandea).
    casos.append(correr_caso("A_robusto_30x30_H3", 0.30, 3.0, 1.0, 20.0))

    # Caso B — pilares ESBELTOS (25×25, H=4) para ver el 2.º orden mas claro.
    casos.append(correr_caso("B_esbelto_25x25_H4", 0.25, 4.0, 1.0, 20.0))

    # Caso C — esbelto con MAS axil: sobrecarga alta (q=15) para cargar mas los
    # pilares y amplificar mas la deriva de 2.º orden.
    casos.append(_caso_q_alta("C_esbelto_25x25_H4_q15", 0.25, 4.0, 1.0, 20.0, 15.0))

    # Caso D — MUY esbelto (20×20, H=5) + sobrecarga muy alta (q=30): cota superior
    # de la amplificacion observada con este mecanismo (pilares que si sienten el 2.º
    # orden; la losa sigue sin pandearse). Sirve para acotar "amplificacion modesta".
    casos.append(_caso_q_alta("D_muy_esbelto_20x20_H5_q30", 0.20, 5.0, 1.0, 20.0, 30.0))

    for r in casos:
        imprimir_caso(r)

    # --- Veredicto (a) ---
    print()
    print("=" * 78)
    todos_corren = all(r["corrio_pdelta"] for r in casos)
    algo_amplifica = any(r["corrio_pdelta"] and r["amp_dx"] > 1.0 + 1e-9 for r in casos)
    print("VEREDICTO (a) P-Δ corre con quads:  %s" % ("SI (todos)" if todos_corren else "NO"))
    print("VEREDICTO (b) amplificacion > 1:    %s" % ("SI" if algo_amplifica else "NO"))
    print("=" * 78)
    return todos_corren


def _caso_q_alta(nombre, b, h, off, fx, q):
    """Variante de correr_caso con sobrecarga q distinta (sin tocar el global)."""
    out = {"nombre": nombre, "b_pilar": b, "h_planta": h, "off": off, "fx_total": fx}
    m_lin, cab, quads, presion = construir(b, h, off, fx, q_sup=q)
    m_lin.analyze_linear(check_statics=False, sparse=True)
    dx_lin = dx_max_cabezas(m_lin, cab, "SERV")
    sfx_lin, sfy_lin, sfz_lin = suma_reacciones(m_lin, "SERV")
    ax_lin = axiles_pilares(m_lin, "SERV")
    corrio, err = True, None
    dx_pd = sfx_pd = sfy_pd = sfz_pd = float("nan"); ax_pd = []
    try:
        m_pd, cab2, _, _ = construir(b, h, off, fx, q_sup=q)
        m_pd.analyze_PDelta(sparse=True)
        dx_pd = dx_max_cabezas(m_pd, cab2, "SERV")
        sfx_pd, sfy_pd, sfz_pd = suma_reacciones(m_pd, "SERV")
        ax_pd = axiles_pilares(m_pd, "SERV")
    except Exception as e:  # noqa: BLE001
        corrio, err = False, "%s: %s" % (type(e).__name__, e)
    Vteor = carga_vertical_total(presion, b, h)
    out.update({"presion": presion, "Vteor": Vteor, "corrio_pdelta": corrio,
                "error_pdelta": err, "dx_lin": dx_lin, "dx_pd": dx_pd,
                "amp_dx": (dx_pd / dx_lin) if (corrio and dx_lin != 0) else float("nan"),
                "sfx_lin": sfx_lin, "sfy_lin": sfy_lin, "sfz_lin": sfz_lin,
                "sfx_pd": sfx_pd, "sfy_pd": sfy_pd, "sfz_pd": sfz_pd,
                "ax_lin": ax_lin, "ax_pd": ax_pd, "fx_total": fx})
    return out


if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
