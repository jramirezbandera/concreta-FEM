# =============================================================================
# SPIKE T0.1 (corte "F3 forjado reticular") - PUERTA go/no-go sobre el modelo de
# PLACA ISOTROPA de espesor equivalente para el forjado reticular (casetones).
#
# La pregunta que decide: ¿basta reutilizar el pipeline de quads existente montando
# una placa ISOTROPA de espesor equivalente t_eq (con densidad sintetica rho_eq para
# la masa modal), o el forjado reticular es demasiado ORTOTROPO (torsion baja de los
# nervios) para que la isotropia sea defendible en un golden? NO implementa la feature
# ni toca produccion: explora, mide contra el motor REAL y DECIDE.
#
# CONTEXTO (verificado leyendo el repo, no re-derivado):
#   - Elemento de placa de PyNite 2.0.2 = cuadrilatero de placa GRUESA (Mindlin/DKMQ):
#     converge a ~-2% de la placa DELGADA de Kirchhoff, no monotono (spike
#     masa_placa_spike.md). El golden de losa maciza documenta +1.5% flecha / +2.5% Mx
#     a malla 8x8 vs Navier (tests/golden/placa.golden.test.ts). => el ELEMENTO en si
#     es fiel; lo que este spike interroga es el MODELO (isotropo vs ortotropo), no el
#     elemento.
#   - Presion de quad POSITIVA = hacia ABAJO (gravedad), signo OPUESTO a FY de barras
#     (pynite_glue.py:174-183, confirmado con el motor real). El spike lo respeta.
#   - Masa modal de quad: el glue fabrica W = rho * t * area repartida en 4 nudos
#     (_agregar_masa_quads); rho se re-lee del payload (kN/m^3, PESO especifico) porque
#     Quad3D 2.0.2 no guarda rho. => con rho_eq = pesoPropio/t_eq y espesor t_eq, la masa
#     lumped reproduce el peso tabulado SIN tocar el glue.
#   - Material HA-25 REAL del catalogo (src/biblioteca/hormigon.ts, Codigo Estructural):
#     Ecm = 22000*((fck+8)/10)^0.3 MPa con fck=25 -> ~31476 MPa. nu=0.2.
#
# EL CORAZON (lo que decide GO/NO-GO): la placa isotropa de PyNite asume rigidez
# torsional H = D (como una losa maciza). Un forjado reticular tiene la torsion
# REPARTIDA en nervios rectangulares abiertos "torsionalmente blandos" (Timoshenko:
# ribbed plate; los nervios abiertos aportan poca torsion) => su H fisico es MUCHO
# menor que D. La banda de flecha entre H=D (isotropia) y el H real del reticular ES
# el error sistematico de asumir isotropia. Ese numero decide.
#
# -----------------------------------------------------------------------------
# COMO EJECUTARLO  (identico a los spikes hermanos de esta carpeta)
#   pip install "PyNiteFEA==2.0.2" numpy scipy PrettyTable
#     (o los wheels vendorizados:
#        pip install vendor/wheels/pynitefea-2.0.2-py3-none-any.whl
#                    vendor/wheels/prettytable-3.17.0-py3-none-any.whl)
#   NO forma parte de `npm test` (lento y exploratorio):
#        python src/solver/spikes/reticular_spike.py
#   El motor de PRODUCCION es PyNite sobre Pyodide/WASM; el algoritmo (FEModel3D +
#   analyze_linear/analyze_modal sparse) es Python puro e IDENTICO al que correra en
#   Pyodide. Solo cambia el build de numpy/scipy (local 2.4.4/1.18.0 vs Pyodide
#   2.2.5/1.14.1), irrelevante para las preguntas del spike.
#
#   ENCODING: se fuerza stdout a UTF-8 abajo porque la consola de Windows (cp1252) no
#   imprime rho/delta y tumbaria el informe. (Aprendizaje del spike: el codigo de
#   PRODUCCION que emita mensajes debe ser ASCII o forzar utf-8 igual.)
#
# Nota de diseno hermana (leela primero): ./reticular_spike.md
# =============================================================================

import math
import sys
import time

# La consola de Windows es cp1252 y revienta con caracteres no-ASCII (rho, delta,
# superindices). Forzamos UTF-8 en stdout/stderr para que el informe no se corte.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:  # pragma: no cover - entornos sin reconfigure
    pass

try:
    from Pynite import FEModel3D
except ImportError:  # pragma: no cover
    sys.stderr.write(
        "ERROR: falta PyNiteFEA. Instala el par del proyecto:\n"
        '    pip install "PyNiteFEA==2.0.2" numpy scipy PrettyTable\n'
    )
    sys.exit(2)


# =============================================================================
# 1) GEOMETRIA CANONICA del forjado reticular (provisional; el contrato de F1 la
#    reconciliara con normativa). Forjado reticular espanol tipico.
# =============================================================================
S = 0.80          # m  intereje en AMBAS direcciones
B_NERVIO = 0.12   # m  ancho de nervio
H_TOTAL = 0.30    # m  canto total
E_COMP = 0.05     # m  capa de compresion (0.25 caseton + 0.05 compresion)
PESO_PROPIO = 5.0  # kN/m^2  TABULADO CTE DB-SE-AE C.5 (bidireccional, grueso < 0.35 m)

# Material HA-25 REAL del proyecto (Codigo Estructural). Ver src/biblioteca/hormigon.ts.
FCK_MPA = 25.0
ECM_MPA = 22000.0 * (((FCK_MPA + 8.0) / 10.0) ** 0.3)
E = ECM_MPA * 1.0e3          # kN/m^2  (1 MPa = 1e3 kN/m^2)
NU = 0.2
G = E / (2.0 * (1.0 + NU))   # kN/m^2

# Placa de trabajo: cuadrada, lado multiplo del intereje.
LADO = 6.4        # m  (= 8 * intereje 0.80)
Q_SUP = 5.0       # kN/m^2  carga uniforme de servicio para la flexion (a)
G_FISICO = 9.81   # m/s^2  peso -> masa (masa = peso/g), el _G_FISICO del glue

# Nombres del combo de masa (glue): doble guion bajo, no colisionan con obra.
CASO_MASA = "__masa_modal__"
COMBO_MASA = "__MASA_MODAL__"


# =============================================================================
# 2) FORMULAS A VALIDAR (el corazon del spike). Todo derivado, citado, sin magia.
# =============================================================================
def propiedades_reticular():
    """Inercia por metro I_m (seccion en T por nervio / intereje), espesor equivalente
    t_eq = (12*I_m)^(1/3) y densidad sintetica rho_eq = pesoPropio / t_eq.

    Seccion en T por nervio:
      - alma  = nervio de ancho b y altura (h - e_comp), por debajo de la cabeza.
      - cabeza = capa de compresion de ancho eficaz = intereje s y espesor e_comp.
    Eje neutro REAL de la T (no el centro geometrico) y su inercia por Steiner. I_m =
    I_T / s (reparte la inercia del nervio en su ancho tributario = intereje).
    """
    a_alma = B_NERVIO * (H_TOTAL - E_COMP)
    a_cab = S * E_COMP
    a_total = a_alma + a_cab
    # y desde la fibra SUPERIOR (cabeza arriba), positivo hacia abajo.
    yc_cab = E_COMP / 2.0
    yc_alma = E_COMP + (H_TOTAL - E_COMP) / 2.0
    y_na = (a_cab * yc_cab + a_alma * yc_alma) / a_total
    i_cab = S * E_COMP ** 3 / 12.0 + a_cab * (y_na - yc_cab) ** 2
    i_alma = B_NERVIO * (H_TOTAL - E_COMP) ** 3 / 12.0 + a_alma * (yc_alma - y_na) ** 2
    i_t = i_cab + i_alma
    i_m = i_t / S
    t_eq = (12.0 * i_m) ** (1.0 / 3.0)
    rho_eq = PESO_PROPIO / t_eq
    return {
        "A_T": a_total, "y_na": y_na, "I_T": i_t, "I_m": i_m,
        "t_eq": t_eq, "rho_eq": rho_eq,
    }


def rigidez_torsional_reticular(i_m):
    """Estima el H (rigidez torsional efectiva) FISICO del reticular como grillage de
    nervios torsionalmente blandos (Timoshenko/Woinowsky-Krieger, ribbed plate).

    2H = C_x + C_y (nervios) + termino de la capa de compresion, con:
      - C_rib = G * J_rib / s por direccion; J_rib = constante de St. Venant de la
        seccion rectangular del nervio (abierta -> torsionalmente BLANDA).
      - capa de compresion: H_topping = D_topping*(1-nu) (placa delgada isotropa e_comp).
    Devuelve H/D_orto, la fraccion clave. D_orto = E*I_m (Dx=Dy del reticular).
    """
    def j_rectangulo(a_corto, a_largo):
        # St. Venant de rectangulo solido (Roark/Timoshenko), serie truncada.
        r = a_corto / a_largo
        return a_largo * a_corto ** 3 * (1.0 / 3.0 - 0.21 * r * (1 - r ** 4 / 12.0))

    d_orto = E * i_m
    j_rib = j_rectangulo(min(B_NERVIO, H_TOTAL), max(B_NERVIO, H_TOTAL))
    c_rib = G * j_rib / S              # por direccion, por unidad de ancho
    h_ribs = c_rib                     # 2H_ribs = 2*C_rib -> H_ribs = C_rib
    d_topping = E * E_COMP ** 3 / (12.0 * (1.0 - NU ** 2))
    h_topping = d_topping * (1.0 - NU)
    h_total = h_ribs + h_topping
    return {
        "D_orto": d_orto, "J_rib": j_rib,
        "H_ribs": h_ribs, "H_topping": h_topping, "H_total": h_total,
        "frac_ribs": h_ribs / d_orto, "frac_topping": h_topping / d_orto,
        "frac_total": h_total / d_orto,
    }


# =============================================================================
# 3) REFERENCIAS ANALITICAS (serie de Navier, placa rectangular SSSS, carga uniforme).
#    Convergen rapido (19 terminos bastan; lo verifico en el informe).
# =============================================================================
def navier_flecha_central(dx, dy, hh, lado, q, nterms=39):
    """Flecha central de una placa ORTOTROPA SSSS (Huber) con carga uniforme q.

    Ecuacion de Huber: Dx w,xxxx + 2H w,xxyy + Dy w,yyyy = q. Con w = sum a_mn
    sin(m pi x/L) sin(n pi y/L) y q_mn = 16 q/(pi^2 m n) (m,n impares):
      a_mn = q_mn / [ Dx (m pi/L)^4 + 2H (m pi/L)^2 (n pi/L)^2 + Dy (n pi/L)^4 ].
    ISOTROPA es el caso Dx=Dy=D, H=D (2H = 2D). El caso RETICULAR usa Dx=Dy=E*I_m con H
    reducido. La flecha central es sum a_mn sin(m pi/2) sin(n pi/2).
    """
    w = 0.0
    xc = lado / 2.0
    yc = lado / 2.0
    for m in range(1, nterms + 1, 2):
        for n in range(1, nterms + 1, 2):
            am = m * math.pi / lado
            an = n * math.pi / lado
            qmn = 16.0 * q / (math.pi ** 2 * m * n)
            denom = dx * am ** 4 + 2.0 * hh * am ** 2 * an ** 2 + dy * an ** 4
            w += (qmn / denom) * math.sin(am * xc) * math.sin(an * yc)
    return w


def navier_mx_central(d_iso, nu, lado, q, nterms=39):
    """Mx central (kN*m/m) de una placa ISOTROPA delgada SSSS, carga uniforme.

    Mx = -(D w,xx + nu D w,yy). Solo para la referencia isotropa (medir el elemento).
    """
    mx = 0.0
    xc = lado / 2.0
    yc = lado / 2.0
    for m in range(1, nterms + 1, 2):
        for n in range(1, nterms + 1, 2):
            am = m * math.pi / lado
            an = n * math.pi / lado
            qmn = 16.0 * q / (math.pi ** 2 * m * n)
            denom = d_iso * (am ** 2 + an ** 2) ** 2
            amn = qmn / denom
            sx = math.sin(am * xc)
            sy = math.sin(an * yc)
            # w,xx = -am^2 amn sinsin ; w,yy = -an^2 amn sinsin
            mx += d_iso * (am ** 2 + nu * an ** 2) * amn * sx * sy
    return mx


# =============================================================================
# 4) MODELO PyNite: placa isotropa de espesor t_eq (reutiliza el pipeline de quads).
#    Malla n x n en el plano FEM X-Z (vertical Y), orden de nudos i,j,m,n canonico.
# =============================================================================
def _nombre(ix, iz):
    return "N_%d_%d" % (ix, iz)


def construir_placa(n, t, apoyo, con_carga=True, con_masa=False, rho=NU):
    """Construye la placa isotropa. `apoyo`:
      - "ssss": simple apoyo (DY) en todo el borde + estabilizacion en plano (para (a)/(c)).
      - "losa_plana": apoyo SOLO en 4 nudos interiores (pilares), sin borde (para (b)).
    `rho` alimenta el material (peso especifico). con_carga = presion positiva (abajo)
    del case Q. con_masa = masa lumped por quad en el combo de masa (para el modal).
    """
    m = FEModel3D()
    m.add_material("HA", E, G, NU, rho)
    h = LADO / n

    for iz in range(n + 1):
        for ix in range(n + 1):
            m.add_node(_nombre(ix, iz), ix * h, 0.0, iz * h)

    area_quad = h * h
    w_quad = rho * t * area_quad  # peso del quad (kN) si con_masa
    for iz in range(n):
        for ix in range(n):
            qn = "Q_%d_%d" % (ix, iz)
            i = _nombre(ix, iz)
            j = _nombre(ix + 1, iz)
            mm = _nombre(ix + 1, iz + 1)
            nn = _nombre(ix, iz + 1)
            m.add_quad(qn, i, j, mm, nn, t, "HA")
            if con_carga:
                # presion POSITIVA = gravedad (hacia abajo), signo del glue.
                m.add_quad_surface_pressure(qn, Q_SUP, case="Q")
            if con_masa:
                for nd in (i, j, mm, nn):
                    m.add_node_load(nd, "FY", -w_quad / 4.0, case=CASO_MASA)

    if apoyo == "ssss":
        _apoyo_ssss(m, n)
    elif apoyo == "losa_plana":
        _apoyo_losa_plana(m, n)
    else:
        raise ValueError("apoyo desconocido: %s" % apoyo)

    if con_carga:
        m.add_load_combo("Q", {"Q": 1.0})
    if con_masa:
        m.add_load_combo(COMBO_MASA, {CASO_MASA: 1.0})
    return m


def _apoyo_ssss(m, n):
    """Apoyo simple (DY) en todo el borde + estabilizacion en plano IDENTICA al
    discretizador (mallado.ts): esquina (0,0)->DX+DZ, esquina (n,0)->DZ.
    """
    def es_borde(ix, iz):
        return ix == 0 or ix == n or iz == 0 or iz == n

    for iz in range(n + 1):
        for ix in range(n + 1):
            if es_borde(ix, iz):
                m.def_support(_nombre(ix, iz), False, True, False, False, False, False)
    m.def_support(_nombre(0, 0), True, True, True, False, False, False)
    m.def_support(_nombre(n, 0), False, True, True, False, False, False)


def _apoyo_losa_plana(m, n):
    """Apoyo SOLO en 4 nudos interiores (patron losa plana: pilares interiores). Para
    que sea estable en plano y en flexion: los 4 nudos restringen DY; ademas se fija
    DX/DZ en 2 de ellos (2 traslaciones + giro RY de cuerpo rigido), igual que la
    estabilizacion de la malla. Nudos a 1/4 y 3/4 del lado (cuadrado de pilares).
    """
    c1 = n // 4
    c2 = 3 * n // 4
    pilares = [(c1, c1), (c2, c1), (c1, c2), (c2, c2)]
    # Los 4 sostienen DY; 2 opuestos fijan el plano (DX+DZ y DZ), como la malla.
    for k, (ix, iz) in enumerate(pilares):
        dx = k == 0
        dz = k in (0, 1)
        m.def_support(_nombre(ix, iz), dx, True, dz, False, False, False)
    return pilares


def _contar_gdl_libres(m):
    restringidos = 0
    for nd in m.nodes.values():
        for flag in (nd.support_DX, nd.support_DY, nd.support_DZ,
                     nd.support_RX, nd.support_RY, nd.support_RZ):
            if flag:
                restringidos += 1
    return len(m.nodes) * 6 - restringidos


# =============================================================================
# 5) MEDICIONES
# =============================================================================
def medir_flexion(n, t):
    """(a) Placa SSSS con t_eq, carga uniforme. Devuelve flecha central y Mx central."""
    m = construir_placa(n, t, apoyo="ssss", con_carga=True)
    m.analyze_linear(check_statics=False, sparse=True)
    centro = _nombre(n // 2, n // 2)
    dy = float(m.nodes[centro].DY["Q"])
    # Mx central: esquina m (xi=+1,eta=+1) del quad inferior-izq al centro (como el golden).
    q_centro = "Q_%d_%d" % (n // 2 - 1, n // 2 - 1)
    mom = m.quads[q_centro].moment(1.0, 1.0, local=True, combo_name="Q").flatten()
    mx = float(mom[0])
    my = float(mom[1])
    return {"flecha": dy, "mx": mx, "my": my}


def medir_losa_plana(n, t):
    """(b) Misma malla apoyada SOLO en 4 nudos interiores. Estable? DY<0? SumV==SumCargas?"""
    m = construir_placa(n, t, apoyo="losa_plana", con_carga=True)
    pilares = _apoyo_losa_plana_nombres(n)
    try:
        m.analyze_linear(check_statics=False, sparse=True)
    except Exception as exc:  # noqa: BLE001
        return {"estable": False, "error": type(exc).__name__ + ": " + str(exc)}
    # Flecha en un nudo de vano (centro de la placa, entre pilares).
    centro = _nombre(n // 2, n // 2)
    dy_centro = float(m.nodes[centro].DY["Q"])
    # DY minimo (mas negativo) de todo el modelo.
    dy_min = min(float(nd.DY["Q"]) for nd in m.nodes.values())
    nan = any(math.isnan(float(nd.DY["Q"])) for nd in m.nodes.values())
    # Suma de reacciones verticales vs carga total (presion * area).
    sum_v = sum(float(nd.RxnFY["Q"]) for nd in m.nodes.values())
    carga_total = Q_SUP * LADO * LADO
    return {
        "estable": True, "nan": nan,
        "dy_centro": dy_centro, "dy_min": dy_min,
        "sum_reacciones_v": sum_v, "carga_total": carga_total,
        "residuo_v": sum_v - carga_total,
        "pilares": pilares,
    }


def _apoyo_losa_plana_nombres(n):
    c1 = n // 4
    c2 = 3 * n // 4
    return [(c1, c1), (c2, c1), (c1, c2), (c2, c2)]


def medir_modal(n, t, rho_eq, num_modes=6):
    """(c) Placa SSSS con rho_eq y masa lumped por quad. f1 medida (Hz)."""
    m = construir_placa(n, t, apoyo="ssss", con_carga=False, con_masa=True, rho=rho_eq)
    gdl = _contar_gdl_libres(m)
    k = min(num_modes, gdl - 1)
    t0 = time.perf_counter()
    m.analyze_modal(
        num_modes=k,
        mass_combo_name=COMBO_MASA,
        mass_direction="Y",
        gravity=G_FISICO,
    )
    dt = time.perf_counter() - t0
    freqs = [float(f) for f in m.frequencies]
    # Forma del 1er modo: DY dominante y pico central?
    combo1 = "Mode 1" if "Mode 1" in m.load_combos else None
    dy_max = plano_max = 0.0
    pico = (0.0, 0.0)
    if combo1:
        for nd in m.nodes.values():
            dy = abs(float(nd.DY[combo1]))
            plano = abs(float(nd.DX[combo1])) + abs(float(nd.DZ[combo1]))
            if dy > dy_max:
                dy_max = dy
                pico = (nd.X, nd.Z)
            plano_max = max(plano_max, plano)
    return {
        "freqs": freqs, "f1": freqs[0] if freqs else float("nan"),
        "dt": dt, "gdl": gdl, "dy_max": dy_max, "plano_max": plano_max, "pico": pico,
    }


def f1_placa_delgada(lado, e, nu, t, peso_propio, g):
    """f1 de placa DELGADA (Kirchhoff/Leissa) SSSS cuadrada con D = E*I_m equivalente.

    La masa por area mu = pesoPropio/g (pesoPropio ya es peso/area tabulado, kN/m^2).
    Para la referencia usamos D = E*t^3/(12(1-nu^2)) con el t_eq de flexion, que por
    construccion == E*I_m. f1 = (pi/2)(1/a^2+1/b^2) sqrt(D/mu). a=b.
    """
    d = e * t ** 3 / (12.0 * (1.0 - nu ** 2))
    mu = peso_propio / g
    return (math.pi / 2.0) * (2.0 / lado ** 2) * math.sqrt(d / mu)


# =============================================================================
# 5b) EXPERIMENTO (d) - EMPARRILLADO EXPLICITO DE NERVIOS (plan B).
#
# Grillage en dos direcciones: lineas de nervio en X y en Z a intereje s. Como
# L = 6.4 = 8*s EXACTO, las lineas de nervio PASAN POR LOS BORDES (x,z en
# 0,0.8,...,6.4): 9 lineas por direccion, 8 vanos. Elegido asi (no s*(k+1/2))
# porque para SSSS los extremos de TODOS los nervios caen sobre el borde apoyado,
# que es justo lo que sostiene el perimetro sin nudos "en el aire".
#
# Cada tramo de nervio entre cruces = member con la seccion en T por nervio:
#   A_T, Iy_fuerte = I_T (flexion vertical, cabeza eficaz = s), Iz_debil = I_inplane, J.
# NERVIOS CONTINUOS a traves de los cruces (SIN releases interiores): la continuidad
# es la que da la rigidez del emparrillado. Cada direccion cuenta la cabeza de
# compresion COMPLETA por nervio (doble conteo de la membrana; practica estandar de
# emparrillado y coherente con la referencia Dx=Dy=E*I_m que ya se monto en (a)).
#
# SWAP C-1 del proyecto (propiedadesBarra.ts): la app tabula Iy=fuerte, Iz=debil y al
# emitir la Capa 2 INTERCAMBIA (FEM Iy:=Iz_app, FEM Iz:=Iy_app) para que la flexion
# vertical use el campo Iz de PyNite (eje fuerte). Aqui montamos la seccion FEM YA con
# el swap: FEM_Iy = I_inplane (debil), FEM_Iz = I_T (fuerte, gobierna la flexion vertical).
# =============================================================================

# Propiedades de la seccion en T del nervio (se calculan una vez).
def _seccion_nervio():
    a_alma = B_NERVIO * (H_TOTAL - E_COMP)
    a_cab = S * E_COMP
    a_total = a_alma + a_cab
    yc_cab = E_COMP / 2.0
    yc_alma = E_COMP + (H_TOTAL - E_COMP) / 2.0
    y_na = (a_cab * yc_cab + a_alma * yc_alma) / a_total
    i_cab = S * E_COMP ** 3 / 12.0 + a_cab * (y_na - yc_cab) ** 2
    i_alma = B_NERVIO * (H_TOTAL - E_COMP) ** 3 / 12.0 + a_alma * (yc_alma - y_na) ** 2
    i_t = i_cab + i_alma  # flexion vertical (eje fuerte), cabeza eficaz = s
    # Inercia en el plano (eje debil): alma (h-e_comp) de canto x b de ancho + cabeza.
    i_inplane = (H_TOTAL - E_COMP) * B_NERVIO ** 3 / 12.0 + E_COMP * S ** 3 / 12.0
    r = min(B_NERVIO, H_TOTAL) / max(B_NERVIO, H_TOTAL)
    j_rib = max(B_NERVIO, H_TOTAL) * min(B_NERVIO, H_TOTAL) ** 3 * (
        1.0 / 3.0 - 0.21 * r * (1 - r ** 4 / 12.0)
    )
    return {"A": a_total, "I_T": i_t, "I_inplane": i_inplane, "J": j_rib}


def construir_emparrillado(apoyo, jval, con_masa=False):
    """Emparrillado de nervios en X y Z a intereje s. `apoyo`:
      - "ssss": extremos de todos los nervios del perimetro con DY + anclaje de plano.
      - "losa_plana": apoyo SOLO en 4 cruces interiores (pilares).
    `jval` = J de la seccion (parametro para (d2)). con_masa alimenta masas nodales.
    Devuelve (modelo, nlin, cargas_info).
    """
    nlin = int(round(LADO / S)) + 1  # nudos por direccion (lineas de nervio)
    sec = _seccion_nervio()
    m = FEModel3D()
    m.add_material("HA", E, G, NU, 0.0)  # rho=0: peso propio se mete a mano donde toca
    # Seccion FEM CON swap C-1: FEM Iy=debil (I_inplane), FEM Iz=fuerte (I_T).
    m.add_section("NerT", sec["A"], sec["I_inplane"], sec["I_T"], jval)

    for iz in range(nlin):
        for ix in range(nlin):
            m.add_node(_nombre(ix, iz), ix * S, 0.0, iz * S)

    # Nervios en X (a lo largo de +X, iz fijo) y en Z (a lo largo de +Z, ix fijo).
    for iz in range(nlin):
        for ix in range(nlin - 1):
            m.add_member("MX_%d_%d" % (ix, iz), _nombre(ix, iz), _nombre(ix + 1, iz),
                         "HA", "NerT")
    for ix in range(nlin):
        for iz in range(nlin - 1):
            m.add_member("MZ_%d_%d" % (ix, iz), _nombre(ix, iz), _nombre(ix, iz + 1),
                         "HA", "NerT")
    # SIN def_releases: nervios continuos a traves de los cruces.

    # Cargas nodales tributarias en los cruces: P = q * area_tributaria. Interior s^2,
    # borde s^2/2, esquina s^2/4 -> Sum = q*L^2 EXACTO por construccion.
    carga_total = 0.0
    for iz in range(nlin):
        for ix in range(nlin):
            fx_borde = (ix == 0 or ix == nlin - 1)
            fz_borde = (iz == 0 or iz == nlin - 1)
            factor = (0.5 if fx_borde else 1.0) * (0.5 if fz_borde else 1.0)
            area = S * S * factor
            p = Q_SUP * area
            carga_total += p
            if not con_masa:
                m.add_node_load(_nombre(ix, iz), "FY", -p, case="Q")
            else:
                # masa: peso tributario del peso propio TABULADO (5 kN/m2), NO Q_SUP.
                pm = PESO_PROPIO * area
                m.add_node_load(_nombre(ix, iz), "FY", -pm, case=CASO_MASA)

    if apoyo == "ssss":
        pilares = _emparrillado_ssss(m, nlin)
    elif apoyo == "losa_plana":
        pilares = _emparrillado_losa_plana(m, nlin)
    else:
        raise ValueError("apoyo desconocido: %s" % apoyo)

    if not con_masa:
        m.add_load_combo("Q", {"Q": 1.0})
    else:
        m.add_load_combo(COMBO_MASA, {CASO_MASA: 1.0})
    return m, nlin, sec, carga_total, pilares


def _emparrillado_ssss(m, nlin):
    """SSSS VERDADERO del emparrillado: TODO el perimetro solo con DY (apoyo SIMPLE de
    los extremos de nervio; los giros de borde LIBRES, si no se clampan estariamos
    empotrando y sobre-rigidizando) + anclaje MINIMO de los 3 modos rigidos de plano en
    2 esquinas (DX+DZ y DZ), como la estabilizacion de la malla de placa.

    HALLAZGO CLAVE del spike (medido): clampar los giros RX/RY/RZ en TODO el borde
    (primer intento) EMPOTRA los nervios en el apoyo -> flecha 4.4x menor (basura
    optimista, insegura). Con giros LIBRES en el borde la flecha del grillage clava la
    ortotropa de Huber con el H fisico (~-3% vs H=0.11D). El apoyo del nervio de borde
    debe ser SIMPLE (solo DY), no empotrado. Devuelve None.
    """
    def es_borde(ix, iz):
        return ix == 0 or ix == nlin - 1 or iz == 0 or iz == nlin - 1

    for iz in range(nlin):
        for ix in range(nlin):
            if es_borde(ix, iz):
                # Apoyo SIMPLE: solo DY. Giros y DX/DZ libres (los fijan las esquinas).
                m.def_support(_nombre(ix, iz), False, True, False, False, False, False)
    # Anclaje de plano en 2 esquinas: (0,0) fija DX+DZ, (n,0) fija DZ (mata las 2
    # traslaciones + el giro RY de cuerpo rigido en el plano, sin coartar la flexion).
    m.def_support(_nombre(0, 0), True, True, True, False, False, False)
    m.def_support(_nombre(nlin - 1, 0), False, True, True, False, False, False)
    return None


def _emparrillado_losa_plana(m, nlin):
    """Apoyo SOLO en 4 cruces interiores (pilares). Nudos a ~1/4 y 3/4. Los 4 sostienen
    DY; 2 opuestos fijan el plano (DX+DZ, DZ). Devuelve la lista de cruces-pilar.
    """
    c1 = nlin // 4
    c2 = 3 * nlin // 4
    pilares = [(c1, c1), (c2, c1), (c1, c2), (c2, c2)]
    for k, (ix, iz) in enumerate(pilares):
        dx = k == 0
        dz = k in (0, 1)
        m.def_support(_nombre(ix, iz), dx, True, dz, False, False, False)
    return pilares


def medir_emparrillado_flexion(jval):
    """(d1)/(d2) Emparrillado SSSS con J=jval. Flecha central, Mx del nervio central,
    estabilidad, NaN, equilibrio."""
    m, nlin, sec, carga_total, _ = construir_emparrillado("ssss", jval)
    try:
        m.analyze_linear(check_statics=False, sparse=True)
    except Exception as exc:  # noqa: BLE001
        return {"estable": False, "error": type(exc).__name__ + ": " + str(exc),
                "nlin": nlin, "sec": sec, "carga_total": carga_total}
    centro = _nombre(nlin // 2, nlin // 2)
    dy = float(m.nodes[centro].DY["Q"])
    dy_min = min(float(nd.DY["Q"]) for nd in m.nodes.values())
    nan = any(math.isnan(float(nd.DY["Q"])) for nd in m.nodes.values())
    # Momento maximo del nervio CENTRAL en X (linea iz = nlin//2): Mz local (flexion
    # vertical con el swap). Recorremos sus tramos y tomamos el pico de |Mz|.
    iz_c = nlin // 2
    mmax = 0.0
    for ix in range(nlin - 1):
        nombre = "MX_%d_%d" % (ix, iz_c)
        if nombre in m.members:
            mz = m.members[nombre].moment_array("Mz", 5, "Q")[1]
            mmax = max(mmax, max(abs(float(v)) for v in mz))
    # Equilibrio: suma de reacciones verticales vs carga total.
    sum_v = sum(float(nd.RxnFY["Q"]) for nd in m.nodes.values())
    n_members = len(m.members)
    n_nodes = len(m.nodes)
    return {
        "estable": True, "nan": nan, "flecha": dy, "dy_min": dy_min,
        "m_nervio_max": mmax, "sum_v": sum_v, "carga_total": carga_total,
        "residuo_v": sum_v - carga_total, "nlin": nlin, "sec": sec,
        "n_members": n_members, "n_nodes": n_nodes,
    }


def medir_emparrillado_losa_plana(jval):
    """(d3) Emparrillado apoyado SOLO en 4 cruces interiores."""
    m, nlin, sec, carga_total, pilares = construir_emparrillado("losa_plana", jval)
    try:
        m.analyze_linear(check_statics=False, sparse=True)
    except Exception as exc:  # noqa: BLE001
        return {"estable": False, "error": type(exc).__name__ + ": " + str(exc)}
    dy_min = min(float(nd.DY["Q"]) for nd in m.nodes.values())
    nan = any(math.isnan(float(nd.DY["Q"])) for nd in m.nodes.values())
    sum_v = sum(float(nd.RxnFY["Q"]) for nd in m.nodes.values())
    return {
        "estable": True, "nan": nan, "dy_min": dy_min,
        "sum_v": sum_v, "carga_total": carga_total, "residuo_v": sum_v - carga_total,
        "pilares": pilares,
    }


def medir_emparrillado_modal(jval, num_modes=6):
    """(d4) Emparrillado SSSS con masas nodales tributarias del peso TABULADO (sin
    add_member_self_weight para no doble contar). f1 medida."""
    m, nlin, sec, _, _ = construir_emparrillado("ssss", jval, con_masa=True)
    gdl = _contar_gdl_libres(m)
    k = min(num_modes, gdl - 1)
    t0 = time.perf_counter()
    m.analyze_modal(num_modes=k, mass_combo_name=COMBO_MASA,
                    mass_direction="Y", gravity=G_FISICO)
    dt = time.perf_counter() - t0
    freqs = [float(f) for f in m.frequencies]
    combo1 = "Mode 1" if "Mode 1" in m.load_combos else None
    dy_max = plano_max = 0.0
    pico = (0.0, 0.0)
    if combo1:
        for nd in m.nodes.values():
            dyv = abs(float(nd.DY[combo1]))
            plano = abs(float(nd.DX[combo1])) + abs(float(nd.DZ[combo1]))
            if dyv > dy_max:
                dy_max = dyv
                pico = (nd.X, nd.Z)
            plano_max = max(plano_max, plano)
    return {"freqs": freqs, "f1": freqs[0] if freqs else float("nan"),
            "dt": dt, "gdl": gdl, "dy_max": dy_max, "plano_max": plano_max, "pico": pico}


def navier_ortho(dx, dy, hh, lado, q, nterms=79):
    """Flecha central Y Mx-por-metro central de placa ortotropa SSSS (Huber), carga q.
    Mx = -Dx w,xx (acoplamiento poisson D1~0 entre direcciones de nervio independientes,
    la referencia correcta para un GRILLAGE)."""
    w = 0.0
    mx = 0.0
    xc = lado / 2.0
    yc = lado / 2.0
    for mm in range(1, nterms + 1, 2):
        for nn in range(1, nterms + 1, 2):
            am = mm * math.pi / lado
            an = nn * math.pi / lado
            qmn = 16.0 * q / (math.pi ** 2 * mm * nn)
            denom = dx * am ** 4 + 2.0 * hh * am ** 2 * an ** 2 + dy * an ** 4
            amn = qmn / denom
            sx = math.sin(am * xc)
            sy = math.sin(an * yc)
            w += amn * sx * sy
            mx += dx * am ** 2 * amn * sx * sy
    return w, mx


def f1_ortho_ssss(dx, dy, hh, a, b, peso_propio, g):
    """f1 (Hz) de placa ORTOTROPA SSSS: omega_11^2 = pi^4/mu * (Dx/a^4 + 2H/(a^2 b^2) +
    Dy/b^4), mu = pesoPropio/g. f = omega/(2 pi)."""
    mu = peso_propio / g
    om2 = (math.pi ** 4 / mu) * (dx / a ** 4 + 2.0 * hh / (a ** 2 * b ** 2) + dy / b ** 4)
    return math.sqrt(om2) / (2.0 * math.pi)


# =============================================================================
# 6) INFORME
# =============================================================================
def imprimir_informe():
    import numpy as _np
    import scipy as _sp

    print("=" * 78)
    print("SPIKE T0.1 - Placa ISOTROPA de espesor equivalente para FORJADO RETICULAR")
    print("=" * 78)
    print("numpy=%s  scipy=%s  (PyNiteFEA 2.0.2)" % (_np.__version__, _sp.__version__))
    print()
    print("Geometria reticular: intereje s=%.2f m  nervio b=%.2f m  canto h=%.2f m  "
          "capa comp=%.2f m" % (S, B_NERVIO, H_TOTAL, E_COMP))
    print("  HA-25 (Codigo Estructural): Ecm=%.0f MPa -> E=%.6g kN/m2  nu=%.2f" %
          (ECM_MPA, E, NU))
    print("  peso propio tabulado (CTE C.5) = %.1f kN/m2 ; placa %.1fx%.1f m" %
          (PESO_PROPIO, LADO, LADO))
    print()

    # ---- Propiedades derivadas (t_eq, rho_eq) --------------------------------
    props = propiedades_reticular()
    t_eq = props["t_eq"]
    rho_eq = props["rho_eq"]
    print("--- FORMULAS DERIVADAS (seccion en T por nervio) --------------------------")
    print("  A_T=%.5f m2  y_na=%.5f m (desde fibra sup)  I_T=%.6e m4"
          % (props["A_T"], props["y_na"], props["I_T"]))
    print("  I_m = I_T/s = %.6e m4/m" % props["I_m"])
    print("  t_eq = (12*I_m)^(1/3) = %.5f m" % t_eq)
    print("  rho_eq = pesoPropio/t_eq = %.4f kN/m3  (masa modal rho*t_eq = %.4f = pp)"
          % (rho_eq, rho_eq * t_eq))
    losa_maciza_equiv = PESO_PROPIO / 25.0
    print("  (contexto: losa maciza del mismo PESO = pp/25 = %.3f m; t_eq flexion=%.3f m)"
          % (losa_maciza_equiv, t_eq))
    print()

    # ---- Rigidez torsional fisica del reticular ------------------------------
    tor = rigidez_torsional_reticular(props["I_m"])
    print("--- RIGIDEZ TORSIONAL FISICA del reticular (grillage nervios blandos) -----")
    print("  D_orto = E*I_m = %.6e kN*m  (Dx=Dy del reticular)" % tor["D_orto"])
    print("  J_rib (nervio %.2fx%.2f, St.Venant) = %.6e m4" % (B_NERVIO, H_TOTAL, tor["J_rib"]))
    print("  H_nervios/D = %.4f   H_capa/D = %.4f   H_total/D = %.4f"
          % (tor["frac_ribs"], tor["frac_topping"], tor["frac_total"]))
    print("  => el reticular tiene H ~= %.2f*D (torsion BAJA); la placa isotropa asume H=D."
          % tor["frac_total"])
    print()

    # ---- Referencias de Navier + convergencia --------------------------------
    d_orto = tor["D_orto"]
    d_iso = E * t_eq ** 3 / (12.0 * (1.0 - NU ** 2))
    print("--- (a1) REFERENCIAS Navier (convergencia de la serie) --------------------")
    for nt in (9, 19, 39):
        w_iso = navier_flecha_central(d_iso, d_iso, d_iso, LADO, Q_SUP, nt)
        w_hd = navier_flecha_central(d_orto, d_orto, d_orto, LADO, Q_SUP, nt)
        print("  nterms=%2d: w_iso(t_eq)=%.6e  w_ortho(H=D)=%.6e" % (nt, w_iso, w_hd))
    NT = 39
    w_iso = navier_flecha_central(d_iso, d_iso, d_iso, LADO, Q_SUP, NT)
    mx_iso = navier_mx_central(d_iso, NU, LADO, Q_SUP, NT)
    print("  Ref ISOTROPA (D_iso=%.4e): w=%.6e m  Mx=%.5f kN*m/m" % (d_iso, w_iso, mx_iso))
    print()

    # ---- (a2) Motor real: placa isotropa PyNite vs referencia isotropa (ELEMENTO)
    print("--- (a2) MOTOR REAL: placa isotropa PyNite (t_eq) vs Navier isotropa -------")
    N_MALLA = 8
    fx = medir_flexion(N_MALLA, t_eq)
    flecha_motor = abs(fx["flecha"])
    err_w = 100.0 * (flecha_motor - w_iso) / w_iso
    err_mx = 100.0 * (abs(fx["mx"]) - mx_iso) / mx_iso
    signo_ok = fx["flecha"] < 0
    print("  malla %dx%d  flecha_motor=%.6e m (Navier %.6e)  err=%+.2f%%  DY<0=%s"
          % (N_MALLA, N_MALLA, flecha_motor, w_iso, err_w, signo_ok))
    print("  Mx_motor=%.5f (Navier %.5f) err=%+.2f%%  My=%.5f (Mx~My=%s)"
          % (abs(fx["mx"]), mx_iso, err_mx, fx["my"],
             abs(abs(fx["mx"]) - abs(fx["my"])) / abs(fx["mx"]) < 0.05))
    print("  => el ELEMENTO es fiel (~pocos % por placa gruesa/malla); el modelo NO.")
    print()

    # ---- (a3) BANDA DE ERROR por H: el numero que decide -----------------------
    print("--- (a3) BANDA de error de ISOTROPIA (motor isotropo vs ortotropo por H) ---")
    print("    referencia = w_ortho(Dx=Dy=E*I_m, H = frac*D_orto), Navier NT=%d." % NT)
    print("    'iso vs ortho' = cuanto SUBESTIMA la placa isotropa (t_eq) la flecha real.")
    print("    H     | w_ortho (m)  | iso vs ortho | interpretacion")
    print("    ------+--------------+--------------+----------------------------------")
    banda = []
    etiquetas = {
        1.00: "isotropia total (H=D): losa maciza",
        0.70: "ortotropia leve",
        0.50: "ortotropia media (referencia comun)",
        0.30: "ortotropia fuerte",
    }
    for frac in (1.00, 0.70, 0.50, 0.30):
        w_o = navier_flecha_central(d_orto, d_orto, frac * d_orto, LADO, Q_SUP, NT)
        err = 100.0 * (w_iso - w_o) / w_o
        banda.append((frac, w_o, err))
        print("    %.2fD | %.6e | %+10.1f%% | %s" % (frac, w_o, err, etiquetas[frac]))
    # El H FISICO del reticular:
    frac_real = tor["frac_total"]
    w_real = navier_flecha_central(d_orto, d_orto, frac_real * d_orto, LADO, Q_SUP, NT)
    err_real = 100.0 * (w_iso - w_real) / w_real
    print("    %.2fD | %.6e | %+10.1f%% | H FISICO del reticular (nervios blandos)"
          % (frac_real, w_real, err_real))
    print()

    # ---- (b) Losa plana ------------------------------------------------------
    print("--- (b) LOSA PLANA: placa isotropa apoyada SOLO en 4 nudos interiores ------")
    lp = medir_losa_plana(N_MALLA, t_eq)
    if not lp["estable"]:
        print("  -> INESTABLE / LANZA: %s" % lp["error"])
        b_ok = False
    else:
        pct = 100.0 * lp["residuo_v"] / lp["carga_total"]
        dy_ok = lp["dy_min"] < 0 and not lp["nan"]
        v_ok = abs(pct) < 0.5
        b_ok = dy_ok and v_ok and not lp["nan"]
        print("  -> ESTABLE. DY_min=%.6e m (vano flecta abajo=%s ; NaN=%s)"
              % (lp["dy_min"], lp["dy_min"] < 0, lp["nan"]))
        print("     SumV=%.4f kN  carga=%.4f kN  residuo=%.3e kN (%.4f%%)"
              % (lp["sum_reacciones_v"], lp["carga_total"], lp["residuo_v"], pct))
    print()

    # ---- (c) Modal -----------------------------------------------------------
    print("--- (c) MODAL: f1 con rho_eq vs f1 placa delgada (D=E*I_m) -----------------")
    md = medir_modal(N_MALLA, t_eq, rho_eq, num_modes=6)
    f1_teo = f1_placa_delgada(LADO, E, NU, t_eq, PESO_PROPIO, G_FISICO)
    err_f1 = 100.0 * (md["f1"] - f1_teo) / f1_teo
    ratio = (md["dy_max"] / md["plano_max"]) if md["plano_max"] > 0 else float("inf")
    dist_centro = math.hypot(md["pico"][0] - LADO / 2, md["pico"][1] - LADO / 2)
    print("  f1_motor=%.4f Hz  f1_teorica(delgada)=%.4f Hz  err=%+.2f%%  (%.2f s, %d GDL)"
          % (md["f1"], f1_teo, err_f1, md["dt"], md["gdl"]))
    print("  1er modo: DY_max=%.4g  plano_max=%.4g  ratio=%.3g  pico dist centro=%.3f m"
          % (md["dy_max"], md["plano_max"], ratio, dist_centro))
    c_ok = abs(err_f1) <= 5.0 and md["f1"] > 0
    print("  frecuencias: %s" % ["%.3f" % f for f in md["freqs"]])
    print()

    # =========================================================================
    # EXPERIMENTO (d) - EMPARRILLADO EXPLICITO DE NERVIOS (plan B).
    # =========================================================================
    print("#" * 78)
    print("# (d) EMPARRILLADO EXPLICITO DE NERVIOS (plan B)")
    print("#" * 78)
    sec = _seccion_nervio()
    print("  Seccion en T por nervio (cabeza eficaz = intereje s):")
    print("    A=%.5f m2  I_T(fuerte,vertical)=%.6e m4  I_inplane(debil)=%.6e m4  J=%.6e m4"
          % (sec["A"], sec["I_T"], sec["I_inplane"], sec["J"]))
    print("  Grid: L/s=%.1f EXACTO -> lineas de nervio PASAN POR LOS BORDES; nervios continuos."
          % (LADO / S))
    print("  Apoyo SSSS: todo el perimetro DY + giros anclados; esquina (0,0)=6GDL,"
          " esquina (n,0) fija DZ (mata RY residual). Cargas nodales tributarias q*s^2.")
    print()

    # Referencias ortotropas (Navier + f1) con el H FISICO y con H=D (contraste).
    frac_real = tor["frac_total"]
    w_ref_ortho, mx_ref_perm = navier_ortho(d_orto, d_orto, frac_real * d_orto, LADO, Q_SUP)
    mx_ref_nervio = mx_ref_perm * S  # per metro -> per NERVIO (ancho tributario s)
    w_ref_iso, _ = navier_ortho(d_orto, d_orto, d_orto, LADO, Q_SUP)  # H=D

    # ---- (d1) Flexion SSSS con J de St. Venant -------------------------------
    print("--- (d1) FLEXION SSSS del emparrillado (J = St. Venant real) --------------")
    d1 = medir_emparrillado_flexion(sec["J"])
    d1_ok = False
    err_vs_ortho = float("nan")
    if not d1["estable"]:
        print("  -> INESTABLE / LANZA: %s" % d1["error"])
    elif d1["nan"]:
        print("  -> resuelve pero NaN (basura silenciosa).")
    else:
        flecha = abs(d1["flecha"])
        err_vs_ortho = 100.0 * (flecha - w_ref_ortho) / w_ref_ortho
        err_vs_iso = 100.0 * (flecha - w_ref_iso) / w_ref_iso
        pctv = 100.0 * d1["residuo_v"] / d1["carga_total"]
        print("  modelo: %d nudos, %d members (nervios)" % (d1["n_nodes"], d1["n_members"]))
        print("  flecha central=%.6e m" % flecha)
        print("    vs ortho H=%.2fD (%.6e m): %+.1f%%   vs iso H=D (%.6e m): %+.1f%%"
              % (frac_real, w_ref_ortho, err_vs_ortho, w_ref_iso, err_vs_iso))
        print("  Mmax nervio central=%.5f kN*m  vs ortho ref(=Mx_perm*s=%.5f): %+.1f%%"
              % (d1["m_nervio_max"], mx_ref_nervio,
                 100.0 * (d1["m_nervio_max"] - mx_ref_nervio) / mx_ref_nervio))
        print("  equilibrio: SumV=%.4f carga=%.4f residuo=%.3e kN (%.4f%%)"
              % (d1["sum_v"], d1["carga_total"], d1["residuo_v"], pctv))
        d1_ok = abs(err_vs_ortho) <= 10.0 and abs(pctv) < 0.01
    print()

    # ---- (d2) Sensibilidad a J -----------------------------------------------
    print("--- (d2) SENSIBILIDAD a J (J~0): bloqueante o solo distinto? --------------")
    d2 = medir_emparrillado_flexion(1e-9)
    d2_estable = False
    if not d2["estable"]:
        print("  J~0 -> INESTABLE / LANZA: %s" % d2["error"])
        print("     => la J de St. Venant es BLOQUEANTE (como el corte unidireccional).")
    elif d2["nan"]:
        print("  J~0 -> resuelve pero NaN <<< BASURA SILENCIOSA (singular no cazada).")
        print("     => J BLOQUEANTE: el discretizador DEBE emitir J!=0 o coartar RX.")
    else:
        d2_estable = True
        flecha2 = abs(d2["flecha"])
        cambio = 100.0 * (flecha2 - abs(d1["flecha"])) / abs(d1["flecha"]) if d1.get("estable") else float("nan")
        err2_ortho = 100.0 * (flecha2 - w_ref_ortho) / w_ref_ortho
        print("  J~0 -> ESTABLE. flecha=%.6e m  (cambio vs J real: %+.2f%%)"
              % (flecha2, cambio))
        print("     vs ortho H=%.2fD: %+.1f%%  (con J~0 el H del grillage baja a ~0)"
              % (frac_real, err2_ortho))
        print("     => J no es bloqueante para la ESTABILIDAD, pero SI cambia la flecha:"
              " decidir en el discretizador.")
    print()

    # ---- (d3) Losa plana del emparrillado ------------------------------------
    print("--- (d3) LOSA PLANA: emparrillado apoyado SOLO en 4 cruces interiores ------")
    d3 = medir_emparrillado_losa_plana(sec["J"])
    d3_ok = False
    if not d3["estable"]:
        print("  -> INESTABLE / LANZA: %s" % d3["error"])
    else:
        pct3 = 100.0 * d3["residuo_v"] / d3["carga_total"]
        d3_ok = d3["dy_min"] < 0 and not d3["nan"] and abs(pct3) < 0.01
        print("  -> ESTABLE. DY_min=%.6e m (vano abajo=%s; NaN=%s)"
              % (d3["dy_min"], d3["dy_min"] < 0, d3["nan"]))
        print("     SumV=%.4f carga=%.4f residuo=%.3e kN (%.4f%%)"
              % (d3["sum_v"], d3["carga_total"], d3["residuo_v"], pct3))
    print()

    # ---- (d4) Modal del emparrillado -----------------------------------------
    print("--- (d4) MODAL: emparrillado, masas nodales tributarias (peso tabulado) ----")
    d4 = medir_emparrillado_modal(sec["J"], num_modes=6)
    f1_ortho_teo = f1_ortho_ssss(d_orto, d_orto, frac_real * d_orto, LADO, LADO,
                                 PESO_PROPIO, G_FISICO)
    err_f1_d = 100.0 * (d4["f1"] - f1_ortho_teo) / f1_ortho_teo
    ratio_d = (d4["dy_max"] / d4["plano_max"]) if d4["plano_max"] > 0 else float("inf")
    dist_d = math.hypot(d4["pico"][0] - LADO / 2, d4["pico"][1] - LADO / 2)
    d4_ok = abs(err_f1_d) <= 10.0 and d4["f1"] > 0
    print("  f1_motor=%.4f Hz  f1_ortho_teo(H=%.2fD)=%.4f Hz  err=%+.2f%%  (%.2f s, %d GDL)"
          % (d4["f1"], frac_real, f1_ortho_teo, err_f1_d, d4["dt"], d4["gdl"]))
    print("  1er modo: DY_max=%.4g  plano_max=%.4g  ratio=%.3g  pico dist centro=%.3f m"
          % (d4["dy_max"], d4["plano_max"], ratio_d, dist_d))
    print("  frecuencias: %s" % ["%.3f" % f for f in d4["freqs"]])
    print()

    d_go = d1_ok and d3_ok and d4_ok  # (d2) informa la condicion de J, no bloquea el GO
    print("  --- Sub-veredicto (d) EMPARRILLADO ---")
    print("    (d1) flecha vs ortho H fisico dentro de +-10%%: %s (err %.1f%%)"
          % (d1_ok, err_vs_ortho))
    print("    (d2) estable con J~0: %s (J %s para estabilidad)"
          % (d2_estable, "NO bloqueante" if d2_estable else "BLOQUEANTE"))
    print("    (d3) losa plana estable + equilibrio: %s" % d3_ok)
    print("    (d4) modal f1 vs ortho teorica dentro de +-10%%: %s (err %.1f%%)"
          % (d4_ok, err_f1_d))
    print("    => EMPARRILLADO: %s" % ("GO" if d_go else "NO-GO"))
    print()

    # ---- VEREDICTO -----------------------------------------------------------
    print("=" * 78)
    # Criterio: GO si el error de isotropia sobre una referencia ortotropa razonable
    # queda dentro de una tolerancia defendible en un golden (estilo <=10% con H=0.5D).
    err_H05 = abs(next(e for f, w, e in banda if abs(f - 0.5) < 1e-9))
    err_Hfisico = abs(err_real)
    criterio_go = err_H05 <= 10.0
    iso_go = criterio_go and b_ok and c_ok
    print("VEREDICTO DEL CORTE (dos modelos):")
    print()
    print(" MODELO A - PLACA ISOTROPA de t_eq: %s" % ("GO" if iso_go else "NO-GO"))
    print("  Criterio: GO si |error isotropia con H=0.5D| <= 10% (defendible en golden).")
    print("  |error iso vs ortho H=0.5D| = %.1f%%   -> criterio %s"
          % (err_H05, "CUMPLE" if criterio_go else "NO CUMPLE"))
    print("  |error iso vs ortho H FISICO (%.2fD)| = %.1f%%   (la realidad del reticular)"
          % (frac_real, err_Hfisico))
    print("  (b) losa plana estable + equilibrio: %s ; (c) modal +-5%%: %s (err %.2f%%)"
          % (b_ok, c_ok, err_f1))
    print()
    print(" MODELO B - EMPARRILLADO DE NERVIOS: %s" % ("GO" if d_go else "NO-GO"))
    print("  Criterio: GO si |flecha vs ortho H fisico| <= 10%% y estable en (d2)-(d3).")
    print("  (d1) flecha %+.1f%%  (d3) losa plana %s  (d4) modal %+.1f%%"
          % (err_vs_ortho, d3_ok, err_f1_d))
    print("  CONDICION del GO: J = St. Venant del nervio (%.3e m4). Con J~0 %s."
          % (sec["J"], "estable pero flecha distinta" if d2_estable else "INESTABLE/NaN"))
    print()
    print("  t_eq=%.5f m  rho_eq=%.4f kN/m3  |  nervio: A=%.4f I_T=%.4e J=%.3e"
          % (t_eq, rho_eq, sec["A"], sec["I_T"], sec["J"]))
    print("=" * 78)
    # exit 0 si el CORTE tiene un camino GO (el emparrillado); NO-GO solo si ninguno sirve.
    go = d_go
    return go


def main():
    go = imprimir_informe()
    sys.exit(0 if go else 1)


if __name__ == "__main__":
    main()
