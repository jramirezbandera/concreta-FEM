# =============================================================================
# pynite_glue.py - puente Capa 2 (ModeloFEM) -> PyNite -> ResultadosCalculo.
#
# Corre DENTRO de Pyodide (Python puro). Es la UNICA fuente de verdad del calculo
# (CLAUDE.md Reglas de oro #1): aqui no se reimplementa FEM, solo se traduce el
# JSON de contrato a llamadas FEModel3D, se analiza y se serializa la salida con
# la forma EXACTA de src/solver/resultados.ts (ResultadosCalculo).
#
# Contrato de ENTRADA  : src/discretizador/contratoFEM.ts (ModeloFEM)
# Contrato de SALIDA    : src/solver/resultados.ts        (ResultadosCalculo)
# API PyNite confirmada : PyNite_Guia_Completa.md (PyNiteFEA 2.0.2, import `Pynite`)
#
# Sin visualizacion: NO se importa Renderer/pyvista/vtk/matplotlib (CLAUDE.md #17).
# El worker (worker.ts via Comlink) llama a `calcular(payload)` y obtiene un dict
# JSON-serializable; los errores se devuelven como estructura legible, no excepcion.
# =============================================================================

import json
import math
import sys
import traceback
import types

# -----------------------------------------------------------------------------
# STUB de pip (hallazgo empirico T4.1): PyNiteFEA 2.0.2 hace, a nivel de modulo en
# Pynite/__init__.py, `from pip._vendor import pkg_resources` SOLO para calcular
# __version__. Pyodide NO incluye `pip`, asi que ese import revienta con
# ModuleNotFoundError y tumba TODO `import Pynite` (y por tanto FEModel3D). Lo
# neutralizamos inyectando un stub minimo ANTES de importar Pynite: working_set
# vacio -> get_version() devuelve "No match" (no usamos __version__ del runtime;
# la version la fija config.ts). Sin esto el motor no arranca. NO arrastra pip real.
if "pip._vendor.pkg_resources" not in sys.modules:
    _pip = sys.modules.setdefault("pip", types.ModuleType("pip"))
    _vendor = sys.modules.setdefault("pip._vendor", types.ModuleType("pip._vendor"))
    _pkg = sys.modules.setdefault(
        "pip._vendor.pkg_resources", types.ModuleType("pip._vendor.pkg_resources")
    )
    _pkg.working_set = []  # get_version() -> "No match" (inofensivo)
    _pip._vendor = _vendor
    _vendor.pkg_resources = _pkg

from Pynite import FEModel3D


# -----------------------------------------------------------------------------
# n_points por defecto al muestrear los diagramas *_array(). 20 es el valor
# sugerido en la guia (§13.4) - suficiente para dibujar y barato en WASM.
# -----------------------------------------------------------------------------
N_POINTS_DEFAULT = 20

# -----------------------------------------------------------------------------
# ANALISIS MODAL (F2b) - constantes de FABRICACION DE MASA y gravedad.
#
# La Capa 2 NO emite combo de masa (decision F2.2): el glue lo FABRICA aqui con
# add_member_self_weight (masa CONSISTENTE, no lumped) + un combo de masa propio.
# El spike F2b confirmo, ejecutando el motor real:
#   - El camino consistente (add_member_self_weight) reproduce la f1 analitica de una
#     biapoyada con error 0.002%; el camino lumped (reusar las dist loads de peso
#     propio de F2a) da -15%. Por eso modal FABRICA su propia masa consistente.
#   - La masa consistente = combo_factor * rho * L * A / gravity. Como nuestro `rho`
#     es PESO especifico (kN/m^3, NO masa), hay que DIVIDIR por g para obtener masa:
#     gravity = 9.81 m/s^2. Con gravity=1.0 las frecuencias salen *sqrt(g)
#     (plausibles pero erroneas: el "error sutil" del modal).
#
# Nombres con doble guion bajo para que NUNCA colisionen con hipotesis/combos de
# obra (que el discretizador genera con ids de dominio sin ese prefijo).
_CASO_MASA_MODAL = "__masa_modal__"   # case del self-weight que alimenta la masa
_COMBO_MASA_MODAL = "__MASA_MODAL__"  # combo de masa pasado a analyze_modal
_G_FISICO = 9.81  # m/s^2 - convierte PESO (rho) -> masa. NO usar 1.0 (daria *sqrt(g)).
_NUM_MODES_DEFAULT = 6  # si analysis.num_modes no viene (la UI usa 6 por defecto)

# Tolerancias de equilibrio para check_statics (residuo global ~0). En kN-m;
# valores holgados porque el residuo viene de redondeos de punto flotante del
# solver, no de un desbalance fisico real. Si se supera, equilibrio_ok=False.
TOL_FUERZA = 1.0e-3   # kN
TOL_MOMENTO = 1.0e-3  # kN*m


# =============================================================================
# 1) CONSTRUCCION DEL MODELO  (orden de dependencias, guia §4/§11.2)
#    materiales -> secciones -> nodos -> barras -> apoyos -> cargas -> combos
# =============================================================================
def build_model(payload):
    """Construye un FEModel3D desde el dict ModeloFEM (ya validado en TS con Zod).

    Respeta el orden de dependencias de PyNite: material/seccion deben existir
    antes que la barra que los referencia; nodos antes que barras/cargas.
    """
    m = FEModel3D()

    # --- Materiales: add_material(name, E, G, nu, rho, fy=None) ---------------
    # fy es opcional en el contrato; .get() devuelve None si no viene (PyNite lo
    # acepta como None, solo lo usa el pushover que aqui no aplica).
    for mat in payload.get("materials", []):
        m.add_material(
            mat["name"], mat["E"], mat["G"], mat["nu"], mat["rho"], mat.get("fy")
        )

    # --- Secciones: add_section(name, A, Iy, Iz, J) --------------------------
    for s in payload.get("sections", []):
        m.add_section(s["name"], s["A"], s["Iy"], s["Iz"], s["J"])

    # --- Nodos: add_node(name, X, Y, Z) --------------------------------------
    # OJO: el contrato usa x/y/z minuscula (coordenadas globales).
    for n in payload.get("nodes", []):
        m.add_node(n["name"], n["x"], n["y"], n["z"])

    # --- Barras: add_member(name, i, j, material, section, rotation, ...) -----
    for mb in payload.get("members", []):
        m.add_member(
            mb["name"],
            mb["i"],
            mb["j"],
            mb["material"],
            mb["section"],
            rotation=mb.get("rotation", 0.0),
            tension_only=mb.get("tension_only", False),
            comp_only=mb.get("comp_only", False),
        )
        # releases: null (=sin liberar) o lista de 12 bool en el orden EXACTO de
        # def_releases [Dxi,Dyi,Dzi,Rxi,Ryi,Rzi, Dxj,Dyj,Dzj,Rxj,Ryj,Rzj].
        # Solo se llama si hay lista; se desempaqueta con *.
        rel = mb.get("releases")
        if rel is not None:
            m.def_releases(mb["name"], *rel)

    # --- Apoyos: def_support(node, DX, DY, DZ, RX, RY, RZ) (True=restringido) -
    for sp in payload.get("supports", []):
        m.def_support(
            sp["node"],
            sp.get("DX", False),
            sp.get("DY", False),
            sp.get("DZ", False),
            sp.get("RX", False),
            sp.get("RY", False),
            sp.get("RZ", False),
        )

    # --- Cargas en nodo: add_node_load(node, direction, P, case) -------------
    # direction solo global (MAYUSCULAS): FX..MZ (ya restringido por Zod).
    for ld in payload.get("node_loads", []):
        m.add_node_load(ld["node"], ld["direction"], ld["P"], case=ld["case"])

    # --- Cargas distribuidas: add_member_dist_load(member, dir, w1, w2, x1, x2, case)
    # x1/x2 = None -> toda la barra. direction global (FX..) o local (Fx..).
    for ld in payload.get("dist_loads", []):
        m.add_member_dist_load(
            ld["member"],
            ld["direction"],
            ld["w1"],
            ld["w2"],
            ld.get("x1"),
            ld.get("x2"),
            case=ld["case"],
        )

    # --- Cargas puntuales en barra: add_member_pt_load(member, dir, P, x, case)
    for ld in payload.get("pt_loads", []):
        m.add_member_pt_load(
            ld["member"], ld["direction"], ld["P"], ld["x"], case=ld["case"]
        )

    # --- Combinaciones: add_load_combo(name, factors, combo_tags=None) -------
    for c in payload.get("combos", []):
        m.add_load_combo(c["name"], c["factors"], combo_tags=c.get("combo_tags"))

    return m


# -----------------------------------------------------------------------------
# Error de dominio: estructura INESTABLE / no convergente bajo P-Delta.
#
# analyze_PDelta(check_stability=True) lanza, en el camino de inestabilidad o
# no-convergencia (Pynite/Analysis.py, PyNiteFEA 2.0.2):
#   - ValueError("The stiffness matrix is singular, which indicates that the
#                 structure is unstable.")                       (pivote singular)
#   - ValueError("The structure is unstable. Unable to proceed any further ...")
#   - Exception("Unstable node(s). See console output for details.")  (GDL sin
#                 rigidez detectado por _check_stability)
#   - Exception("- Model diverged during tension/compression-only analysis")
# El detalle util (que nodo/direccion) lo IMPRIME a stdout, no lo expone. Aqui no
# parseamos stdout: detectamos el fallo por la EXCEPCION y lo elevamos a un error
# de obra legible. Lo envolvemos en una excepcion propia para que `calcular()` lo
# distinga del catch-all generico y emita el mensaje en lenguaje de obra correcto.
# -----------------------------------------------------------------------------
class MotorInestablePDelta(Exception):
    """La estructura no se sostiene bajo P-Delta (inestable o no convergente)."""


# -----------------------------------------------------------------------------
# Errores de dominio del analisis MODAL (F2b). Igual que MotorInestablePDelta,
# envuelven un fallo del solver para que `calcular()` lo distinga del catch-all y
# emita un mensaje en lenguaje de obra. El spike F2b confirmo los mensajes crudos:
#   - masa nula  -> Exception("...massless.") / Exception("No mass terms found...")
#   - inestable  -> RuntimeError("Factor is exactly singular") (marcador "singular")
#   - num_modes>=GDL -> TypeError("...eigh for sparse A with k >= N...") (lo EVITAMOS
#     acotando num_modes; no deberia llegar, pero si llegara se reclasifica aqui).
# -----------------------------------------------------------------------------
class MotorModalSinMasa(Exception):
    """El modelo no tiene masa para vibrar (sin peso propio ni material con rho)."""


class MotorInestableModal(Exception):
    """La estructura es inestable para el analisis modal (matriz singular)."""


# Marcadores (minuscula) del mensaje de "sin masa" del solver modal (spike F2b):
# "massless" (M() vacio) y "no mass terms" (M11.nnz==0 en analyze_modal).
_MARCADORES_SIN_MASA = ("massless", "no mass terms", "no mass")


# Marcadores (en minuscula) de los mensajes de inestabilidad/no-convergencia de
# PyNite. Detectamos por contenido porque PyNite usa ValueError y Exception
# genericas (no una clase propia). Cualquiera de estos en el camino P-Delta = la
# estructura no se sostiene de 2.º orden.
_MARCADORES_INESTABLE = ("singular", "unstable", "diverged", "diverge")


# =============================================================================
# 2) ANALISIS  (seleccion segun analysis.type, guia §6)
# =============================================================================
def run_analysis(m, analysis):
    """Ejecuta el analisis del tipo pedido. Devuelve (tipo_ejecutado, aviso|None).

    Soporta 'linear', 'analyze', 'PDelta' (F2a) y 'modal' (F2b). El camino modal
    es DISTINTO: no produce esfuerzos por combo, sino frecuencias propias + formas
    de vibracion. NO se serializa con serialize_results (por-combo) sino con
    serialize_results_modal; calcular() enruta segun el tipo.
    """
    tipo = analysis.get("type", "analyze")
    cs = analysis.get("check_statics", False)

    # sparse=True (default de PyNite) usa el solver disperso de scipy: la ruta
    # esperada (CLAUDE.md §8). check_statics solo IMPRIME el balance; el residuo
    # real lo calculamos nosotros en _check_statics() tras analizar.
    if tipo == "linear":
        m.analyze_linear(check_statics=cs, sparse=True)
    elif tipo == "PDelta":
        # P-Delta (2.º orden, balanceo a nivel nudo). analyze_PDelta NO admite
        # check_statics en su firma (guia §6): la comprobacion de equilibrio se
        # FUERZA a false en este camino (ver calcular(): no se ejecuta
        # _check_statics aunque el payload traiga el flag en true). check_stability
        # queda en su default True: si la estructura es inestable de 2.º orden
        # (pivote singular, GDL sin rigidez, no convergencia), PyNite lanza; lo
        # traducimos a un error de obra legible en vez de un traceback crudo.
        try:
            m.analyze_PDelta(sparse=True)
        except Exception as e:  # noqa: BLE001 - se reclasifica, no se traga.
            if _es_inestabilidad_pdelta(e):
                raise MotorInestablePDelta(str(e)) from e
            # Otro fallo del solver bajo P-Delta (p. ej. dato incoherente): se
            # propaga al catch-all generico de calcular() sin disfrazarlo.
            raise
    elif tipo == "modal":
        # Modal (F2b): frecuencias propias + formas de vibracion. Fabrica su propia
        # masa consistente y reclasifica los fallos del solver a errores de obra. La
        # serializacion la hace serialize_results_modal (NO la por-combo); calcular()
        # enruta segun el tipo, asi que aqui solo ejecutamos el analisis.
        _run_modal(m, analysis)
    else:  # "analyze" (general, itera no linealidades tension/comp-only)
        m.analyze(check_statics=cs, sparse=True)

    return tipo, None


# =============================================================================
# 2b) ANALISIS MODAL (F2b)  - fabricacion de masa + acotado de modos + reclasif.
# =============================================================================
def _contar_gdl_libres(m):
    """Cuenta los GDL LIBRES del modelo = 6*nudos - GDL restringidos por apoyo.

    Lee los flags support_DX..support_RZ que def_support fijo en cada Node3D (los
    pone build_model). Es el N de la matriz K11 particionada que ve eigsh: el numero
    de modos pedidos debe ser ESTRICTAMENTE menor que N (eigsh exige k < N), si no
    PyNite lanza TypeError("...eigh for sparse A with k >= N..."). Acotamos con esto.
    """
    restringidos = 0
    for nd in m.nodes.values():
        for flag in (
            nd.support_DX, nd.support_DY, nd.support_DZ,
            nd.support_RX, nd.support_RY, nd.support_RZ,
        ):
            if flag:
                restringidos += 1
    return len(m.nodes) * 6 - restringidos


def _run_modal(m, analysis):
    """Ejecuta analyze_modal sobre `m` con masa CONSISTENTE fabricada por el glue.

    Receta (confirmada por el spike F2b ejecutando el motor real):
      1) Fabricar masa CONSISTENTE: add_member_self_weight('FY', -1, case) crea las
         dist loads self_weight=True que el camino consistent_m suma como
         combo_factor*rho*L*A/gravity; add_load_combo(combo, {case: 1.0}) las activa.
         (El camino lumped -reusar dist loads normales- daria -15% en f1.)
      2) Acotar num_modes a (GDL_libres - 1) para no superar el k<N de eigsh.
      3) analyze_modal(num_modes, mass_combo_name=combo, gravity=9.81). NO se pasa
         `sparse` ni `check_statics`: la firma real de 2.0.2 no los acepta (siempre
         dispersa internamente). gravity=9.81 porque rho es PESO (kN/m^3): masa=peso/g.

    No devuelve nada: deja m.frequencies y los combos internos "Mode N". La lectura
    la hace serialize_results_modal. Reclasifica los fallos a errores de obra.
    """
    # Nº de modos pedido (la UI usa 6 por defecto; AnalisisFEM.num_modes es opcional).
    # OJO: distinguir AUSENTE (None -> default 6) de un 0/negativo explicito. Un
    # `or _NUM_MODES_DEFAULT` convertiria 0 en 6 silenciosamente (trampa falsy-cero);
    # el 0 es un payload invalido (Capa 1 ya lo bloquea con MODAL_NUM_MODOS) y aqui,
    # como defensa, lo acotamos a 1 en vez de inventar 6.
    pedido = analysis.get("num_modes")
    if pedido is None:
        pedido = _NUM_MODES_DEFAULT
    pedido = max(1, int(pedido))

    # 1) Masa consistente fabricada por el glue (la Capa 2 no emite combo de masa).
    m.add_member_self_weight("FY", -1.0, case=_CASO_MASA_MODAL)
    m.add_load_combo(_COMBO_MASA_MODAL, {_CASO_MASA_MODAL: 1.0})

    # 2) Acotar num_modes < GDL libres (eigsh exige k < N). Para calcular >=1 modo
    #    hacen falta >=2 GDL libres (k=1 < N=2). Con 0 o 1 la estructura esta total o
    #    casi totalmente coartada y no puede vibrar -> error de obra. (Antes el caso
    #    gdl_libres==1 forzaba num_modes=1 y eigsh lanzaba "k >= N", reclasificado a un
    #    "sin masa" enganoso; ahora se trata como falta de GDL, su causa real.)
    gdl_libres = _contar_gdl_libres(m)
    if gdl_libres < 2:
        raise MotorInestableModal(
            "La estructura no tiene grados de libertad suficientes para vibrar: "
            "revise los apoyos (nudos demasiado coartados)."
        )
    # eigsh requiere k < N: como mucho gdl_libres-1 modos. Tomamos el minimo entre lo
    # pedido y ese tope (nunca fallamos por pedir de mas; el nº real saldra de
    # len(m.frequencies)). Garantizado >=1 porque gdl_libres>=2.
    num_modes = min(pedido, gdl_libres - 1)

    # 3) Resolver el problema de autovalores. NO pasar sparse/check_statics (firma 2.0.2).
    try:
        m.analyze_modal(
            num_modes=num_modes,
            mass_combo_name=_COMBO_MASA_MODAL,
            mass_direction="Y",  # irrelevante para masa consistente (spike); default
            gravity=_G_FISICO,
        )
    except Exception as e:  # noqa: BLE001 - se reclasifica, no se traga.
        msg = str(e).lower()
        if any(marca in msg for marca in _MARCADORES_SIN_MASA):
            raise MotorModalSinMasa(str(e)) from e
        if any(marca in msg for marca in _MARCADORES_INESTABLE):
            raise MotorInestableModal(str(e)) from e
        # "k >= N": no deberia ocurrir (acotamos arriba), pero si la malla degenerase
        # lo tratamos como "se pidieron mas modos de los que la estructura admite".
        if "k >= n" in msg or ("eigh" in msg and "sparse" in msg):
            raise MotorModalSinMasa(
                "La estructura admite menos modos de vibracion de los solicitados."
            ) from e
        # Otro fallo (dato incoherente, bug): se propaga al catch-all sin disfrazarlo.
        raise


def _es_inestabilidad_pdelta(exc):
    """True si la excepcion de analyze_PDelta indica inestabilidad/no-convergencia.

    PyNite no usa una clase de excepcion propia: lanza ValueError/Exception con un
    mensaje. Reconocemos el fallo por sus marcadores ("singular"/"unstable"/
    "diverged"). Cualquier otra excepcion (bug, dato malo) NO se confunde con una
    estructura inestable: se deja propagar tal cual.
    """
    msg = str(exc).lower()
    return any(marca in msg for marca in _MARCADORES_INESTABLE)


# =============================================================================
# 3) COMPROBACION DE EQUILIBRIO  (rellena el campo check_statics del contrato)
#
# PyNite con check_statics=True SOLO imprime el balance a stdout; no expone el
# residuo. Para poblar CheckStatics (resultados.ts) calculamos NOSOTROS el
# residuo global por combo = (suma de reacciones en apoyos) + (suma de cargas
# aplicadas). En equilibrio debe dar ~0 en las 6 componentes globales.
#
# Sumamos:
#  - Reacciones: RxnFX/FY/FZ y RxnMX/MY/MZ de cada nodo (0 en GDL no apoyados).
#  - Cargas nodales globales (FX..MZ) por su factor de combo.
#  - Resultante global de cargas en barra (dist/pt): se obtiene de forma robusta
#    sumando las reacciones, que YA equilibran TODAS las cargas (incluidas las de
#    barra). Por eso el residuo de fuerza/momento se calcula como
#    |sum_reacciones + sum_cargas_nodales_externas + resultante_cargas_barra|.
#
# RESULTANTE DE CARGAS DE BARRA: se reconstruye analiticamente (area del trapecio
# y su centroide para dist; P y x para puntual). La proyeccion a globales es
# EXACTA en ambos sistemas: las direcciones GLOBALES (FX/FY/FZ) van directas; las
# LOCALES (Fx/Fy/Fz) se proyectan con la triada local real de PyNite (Member3D.T(),
# _ejes_locales_globales) en vez de aproximarlas con el vector axil. Esto corrige
# el falso negativo de equilibrio que daba una carga local transversal (Fy/Fz)
# sobre una barra (hallazgo feature-6 T1.2): el eje transversal es perpendicular al
# axil, asi que proyectarlo con el vector de la barra cancelaba mal las reacciones.
# =============================================================================
def _vector_barra(ctx, member_name):
    """Vector unitario local x (de i a j) de una barra, en ejes globales, y su
    longitud. Lee geometria del PAYLOAD (no de internals de PyNite) para no
    depender de atributos no documentados de PhysMember.

    Devuelve ((ux,uy,uz), L, (xi,yi,zi)) con el origen i incluido.
    """
    mb = ctx["members"][member_name]
    ni = ctx["nodes"][mb["i"]]
    nj = ctx["nodes"][mb["j"]]
    dx, dy, dz = nj["x"] - ni["x"], nj["y"] - ni["y"], nj["z"] - ni["z"]
    L = (dx * dx + dy * dy + dz * dz) ** 0.5
    origen = (ni["x"], ni["y"], ni["z"])
    if L == 0:
        return (0.0, 0.0, 0.0), 0.0, origen
    return (dx / L, dy / L, dz / L), L, origen


def _ejes_locales_globales(m, member_name):
    """Triada local (ejes x,y,z de la barra) expresada en componentes GLOBALES,
    leida de la PROPIA matriz de transformacion de PyNite (Member3D.T()), NO
    re-derivada a mano. T()[:3,:3] tiene por filas los cosenos directores de los
    ejes locales en globales: fila 0 = x local, fila 1 = y local, fila 2 = z local
    (Member3D.T(), PyNiteFEA 2.0.2). Asi la proyeccion local->global de una carga
    transversal (Fy/Fz) es EXACTA y consistente con como PyNite la integro, en vez
    de aproximarla con el vector axil (hallazgo feature-6 T1.2: el residuo de
    equilibrio daba falso negativo con cargas locales transversales).

    Devuelve ((xx,xy,xz),(yx,yy,yz),(zx,zy,zz)) con cada eje en globales.
    """
    Tm = m.members[member_name].T()
    ex = (float(Tm[0][0]), float(Tm[0][1]), float(Tm[0][2]))
    ey = (float(Tm[1][0]), float(Tm[1][1]), float(Tm[1][2]))
    ez = (float(Tm[2][0]), float(Tm[2][1]), float(Tm[2][2]))
    return ex, ey, ez


def _deformada_global(m, member_name, combo, n_points):
    """Desplazamiento GLOBAL de la barra por estacion uniforme a lo largo de su eje.

    Devuelve una lista (3, n) = [[DX_0..DX_{n-1}], [DY..], [DZ..]] en el MISMO
    sistema global que nodos[].disp (ejes FEM, Y-up). n = n_points (igual que los
    *_array). Sirve para que el render dibuje la flecha del vano (curva), no una
    recta entre nudos.

    COMO: PyNite expone la flecha LOCAL por estacion via
    member.deflection_array('dx'|'dy'|'dz', n_points, combo) -> (2, n): fila 1 son
    los valores. Esa flecha es el desplazamiento LOCAL TOTAL del punto (incluye el
    movimiento de cuerpo rigido de los nudos, NO la flecha relativa a la cuerda ->
    esa seria rel_deflection). Por tanto en x=0 vale el desplazamiento local del
    nudo i y en x=L el del nudo j. La pasamos a GLOBAL con la MISMA triada
    local->global que ya usa el glue para proyectar cargas (_ejes_locales_globales =
    Member3D.T()), consistente con como PyNite integra todo lo demas:
        disp_global = ex*dloc_x + ey*dloc_y + ez*dloc_z
    Invariante (verificado por el golden): estacion 0 == disp del nudo i,
    estacion n-1 == disp del nudo j (continuidad con nodos[].disp).

    Usamos deflection_array (vectorizado, 3 llamadas) en vez de deflection() escalar
    3*n veces: mismo muestreo uniforme [0, L] que defl_y y mucho mas barato en WASM.
    """
    member = m.members[member_name]
    ex, ey, ez = _ejes_locales_globales(m, member_name)

    # Flecha local por estacion (fila 1 del (2,n)); mismo grid que los demas *_array.
    dxl = member.deflection_array("dx", n_points, combo)[1]
    dyl = member.deflection_array("dy", n_points, combo)[1]
    dzl = member.deflection_array("dz", n_points, combo)[1]

    dxg, dyg, dzg = [], [], []
    for k in range(len(dxl)):
        lx, ly, lz = float(dxl[k]), float(dyl[k]), float(dzl[k])
        # Proyeccion local -> global con la triada REAL de PyNite (T()).
        dxg.append(ex[0] * lx + ey[0] * ly + ez[0] * lz)
        dyg.append(ex[1] * lx + ey[1] * ly + ez[1] * lz)
        dzg.append(ex[2] * lx + ey[2] * ly + ez[2] * lz)

    return [dxg, dyg, dzg]


def _resultante_carga_barra(m, ctx, ld, factor):
    """Resultante global (Fx,Fy,Fz, Mx,My,Mz respecto al origen) de una carga de
    barra (dist o pt) multiplicada por `factor` de combo.

    Exacta tanto para direccion GLOBAL (FX/FY/FZ) como LOCAL (Fx/Fy/Fz): las
    locales se proyectan a globales con la triada real de PyNite
    (_ejes_locales_globales), no con una aproximacion. Solo se usa para el residuo
    de equilibrio (check_statics).

    CARGAS DE MOMENTO (MX/MY/MZ global, Mx/My/Mz local): add_member_pt_load admite
    direcciones de momento (contrato DireccionPuntualSchema). Un momento aplicado es
    un PAR PURO: contribuye directo al momento del residuo (mx,my,mz) SIN r x F (es
    invariante respecto al punto de aplicacion). Las locales se proyectan a globales
    con la triada real de PyNite. El discretizador F1 no las emite, pero ignorarlas
    (como antes) caia silenciosamente del residuo -> equilibrio_ok espurio.
    """
    direction = ld["direction"]
    (ux, uy, uz), L, (ox, oy, oz) = _vector_barra(ctx, ld["member"])

    # Magnitud resultante (kN para fuerza, kN*m para momento) y su x local.
    if "w1" in ld:  # carga distribuida trapezoidal entre x1..x2
        x1 = ld.get("x1") if ld.get("x1") is not None else 0.0
        x2 = ld.get("x2") if ld.get("x2") is not None else L
        w1, w2 = ld["w1"], ld["w2"]
        seg = x2 - x1
        P = 0.5 * (w1 + w2) * seg  # area del trapecio = fuerza total
        # centroide del trapecio desde x1
        if (w1 + w2) != 0:
            xc = x1 + seg * (w1 + 2.0 * w2) / (3.0 * (w1 + w2))
        else:
            xc = x1 + seg / 2.0
    else:  # carga puntual
        P = ld["P"]
        xc = ld["x"]

    P *= factor

    # --- Direcciones de MOMENTO: par puro, sin r x F (invariante del punto) ------
    if direction in ("MX", "MY", "MZ"):
        # Global: suma directa a la componente de momento del residuo.
        mx = P if direction == "MX" else 0.0
        my = P if direction == "MY" else 0.0
        mz = P if direction == "MZ" else 0.0
        return (0.0, 0.0, 0.0, mx, my, mz)
    if direction in ("Mx", "My", "Mz"):
        # Local: proyectamos el eje local correspondiente a globales con la triada
        # REAL de PyNite (T()), igual que con Fx/Fy/Fz. El momento se reparte en
        # componentes globales; sigue siendo un par puro (sin r x F).
        ex, ey, ez = _ejes_locales_globales(m, ld["member"])
        eje = {"Mx": ex, "My": ey, "Mz": ez}[direction]
        return (0.0, 0.0, 0.0, P * eje[0], P * eje[1], P * eje[2])

    # --- Direcciones de FUERZA: componentes globales + momento r x F ------------
    fx = fy = fz = 0.0
    if direction == "FX":
        fx = P
    elif direction == "FY":
        fy = P
    elif direction == "FZ":
        fz = P
    elif direction in ("Fx", "Fy", "Fz"):
        # Local: proyectamos el eje local correspondiente sobre globales con la
        # triada REAL de PyNite (T()). Fx=eje axil, Fy/Fz=ejes transversales: para
        # estos ultimos el vector axil NO sirve (son perpendiculares al eje), de
        # ahi el falso negativo previo. Ahora es exacto para cualquier orientacion.
        ex, ey, ez = _ejes_locales_globales(m, ld["member"])
        eje = {"Fx": ex, "Fy": ey, "Fz": ez}[direction]
        fx, fy, fz = P * eje[0], P * eje[1], P * eje[2]

    # Punto de aplicacion global = nodo i + xc * vector_barra.
    px, py, pz = ox + xc * ux, oy + xc * uy, oz + xc * uz

    # Momento respecto al origen global: r x F.
    mx = py * fz - pz * fy
    my = pz * fx - px * fz
    mz = px * fy - py * fx
    return (fx, fy, fz, mx, my, mz)


def _check_statics(m, payload, combos):
    """Calcula el residuo global de equilibrio por combo y decide equilibrio_ok.

    residuo = | sum(reacciones) + sum(cargas externas aplicadas) |, que debe ser
    ~0. Devuelve la estructura CheckStatics de resultados.ts.
    """
    # Lookups por nombre desde el payload (geometria garantizada, sin internals).
    ctx = {
        "nodes": {n["name"]: n for n in payload.get("nodes", [])},
        "members": {mb["name"]: mb for mb in payload.get("members", [])},
    }
    node_loads = payload.get("node_loads", [])
    dist_loads = payload.get("dist_loads", [])
    pt_loads = payload.get("pt_loads", [])

    residuos = {}
    equilibrio_ok = True

    for c in combos:
        factors = m.load_combos[c].factors  # {case: factor}

        # Suma de reacciones en apoyos (ya equilibran el sistema). El balance de
        # MOMENTOS se toma respecto al ORIGEN global, igual que el de las cargas
        # (r x F). Por eso cada nodo aporta sus reacciones-PAR (RxnMX/MY/MZ) MAS el
        # momento de sus reacciones-FUERZA respecto al origen: r x Rxn, con
        # r = (X,Y,Z) del nodo. Omitir este termino daba un residuo espurio
        # (p. ej. 180 kN·m en una biapoyada con el apoyo movil a 6 m) aunque la
        # estructura SI equilibra (hallazgo T4.1).
        sfx = sfy = sfz = smx = smy = smz = 0.0
        for nd in m.nodes.values():
            rfx = float(nd.RxnFX[c]); rfy = float(nd.RxnFY[c]); rfz = float(nd.RxnFZ[c])
            sfx += rfx; sfy += rfy; sfz += rfz
            nx, ny, nz = nd.X, nd.Y, nd.Z
            smx += float(nd.RxnMX[c]) + (ny * rfz - nz * rfy)
            smy += float(nd.RxnMY[c]) + (nz * rfx - nx * rfz)
            smz += float(nd.RxnMZ[c]) + (nx * rfy - ny * rfx)

        # Suma de cargas externas aplicadas (con su factor de combo).
        lfx = lfy = lfz = lmx = lmy = lmz = 0.0

        # Cargas nodales (globales). Momento respecto al origen = r x F.
        for ld in node_loads:
            f = factors.get(ld["case"], 0.0)
            if f == 0.0:
                continue
            P = ld["P"] * f
            d = ld["direction"]
            nd = ctx["nodes"][ld["node"]]
            nx, ny, nz = nd["x"], nd["y"], nd["z"]
            fx = fy = fz = mxl = myl = mzl = 0.0
            if d == "FX": fx = P
            elif d == "FY": fy = P
            elif d == "FZ": fz = P
            elif d == "MX": mxl = P
            elif d == "MY": myl = P
            elif d == "MZ": mzl = P
            lfx += fx; lfy += fy; lfz += fz
            lmx += mxl + (ny * fz - nz * fy)
            lmy += myl + (nz * fx - nx * fz)
            lmz += mzl + (nx * fy - ny * fx)

        # Cargas en barra (dist + pt).
        for ld in dist_loads + pt_loads:
            f = factors.get(ld["case"], 0.0)
            if f == 0.0:
                continue
            rfx, rfy, rfz, rmx, rmy, rmz = _resultante_carga_barra(m, ctx, ld, f)
            lfx += rfx; lfy += rfy; lfz += rfz
            lmx += rmx; lmy += rmy; lmz += rmz

        # Residuo = reacciones + cargas (en equilibrio -> 0).
        res_fx, res_fy, res_fz = sfx + lfx, sfy + lfy, sfz + lfz
        res_mx, res_my, res_mz = smx + lmx, smy + lmy, smz + lmz

        max_f = max(abs(res_fx), abs(res_fy), abs(res_fz))
        max_m = max(abs(res_mx), abs(res_my), abs(res_mz))
        residuos[c] = {"max_fuerza": max_f, "max_momento": max_m}

        if max_f > TOL_FUERZA or max_m > TOL_MOMENTO:
            equilibrio_ok = False

    return {
        "ejecutado": True,
        "equilibrio_ok": equilibrio_ok,
        "residuos": residuos,
    }


# =============================================================================
# 4) SERIALIZACION  (forma EXACTA de ResultadosCalculo, resultados.ts §)
#
# CLAVE: TODO lo que viene de NumPy se convierte a tipos nativos JSON con
# float(...) (escalares) y .tolist() (arrays) ANTES de devolver (guia §11.3).
# Indexacion por combo SIEMPRE con corchetes: nd.DY[combo] (son dicts, guia §7).
# =============================================================================
def serialize_results(m, combos, n_points, tipo_analisis, check_statics):
    """Produce el dict ResultadosCalculo a partir del modelo ya analizado."""

    # Normaliza n_points UNA sola vez: todos los *_array, la deformada y la metadata
    # (`analysis.n_points`) comparten este valor, asi que no pueden divergir. Minimo 2
    # (un diagrama necesita 2 estaciones; solverClient ya fuerza >=2, esto es la red).
    n_points = max(int(n_points), 2)

    # --- Nodos: por combo, disp=[DX..RZ] (6) y rxn=[FX..MZ] (6) ---------------
    nodos = {}
    for name, nd in m.nodes.items():
        por_combo = {}
        for c in combos:
            por_combo[c] = {
                "disp": [
                    float(nd.DX[c]), float(nd.DY[c]), float(nd.DZ[c]),
                    float(nd.RX[c]), float(nd.RY[c]), float(nd.RZ[c]),
                ],
                "rxn": [
                    float(nd.RxnFX[c]), float(nd.RxnFY[c]), float(nd.RxnFZ[c]),
                    float(nd.RxnMX[c]), float(nd.RxnMY[c]), float(nd.RxnMZ[c]),
                ],
            }
        nodos[name] = por_combo

    # --- Barras: por combo, diagramas (2,n_points) + extremos ----------------
    barras = {}
    for name, mb in m.members.items():
        por_combo = {}
        for c in combos:
            por_combo[c] = {
                # *_array(direction, n_points, combo) -> ndarray (2, n_points).
                "axial": mb.axial_array(n_points, c).tolist(),
                "shear_y": mb.shear_array("Fy", n_points, c).tolist(),
                "moment_z": mb.moment_array("Mz", n_points, c).tolist(),
                "defl_y": mb.deflection_array("dy", n_points, c).tolist(),
                # Deformada GLOBAL (3, n_points): DX/DY/DZ por estacion a lo largo
                # de la barra, mismo sistema que nodos[].disp. La consume el render
                # para dibujar la flecha del vano (no una recta entre nudos).
                "deformada_global": _deformada_global(m, name, c, n_points),
                # Extremos para etiquetar picos sin recorrer el array en la UI.
                "max_moment_z": float(mb.max_moment("Mz", c)),
                "min_moment_z": float(mb.min_moment("Mz", c)),
                "max_shear_y": float(mb.max_shear("Fy", c)),
            }
        barras[name] = por_combo

    return {
        "units": "kN-m",
        "analysis": {"type": tipo_analisis, "n_points": n_points},
        "combos": combos,
        "nodos": nodos,
        "barras": barras,
        "check_statics": check_statics,
    }


# =============================================================================
# 4b) SERIALIZACION MODAL  (forma EXACTA de ResultadosModales, resultadosModales.ts)
#
# Camino INDEPENDIENTE del por-combo: el analisis modal no produce esfuerzos ni
# reacciones, sino frecuencias propias + formas de vibracion por nudo. El spike F2b
# confirmo (ejecutando el motor):
#   - m.frequencies es un ndarray YA en Hz (sqrt(lambda)/2pi), orden ascendente.
#   - cada modo i (1-indexado) queda como combo interno "Mode i"; los
#     desplazamientos por nudo se leen como cualquier combo: nd.DX["Mode 1"], etc.
#   - NO hay reacciones por modo (nd.RxnFY["Mode 1"] lanza KeyError) -> no se emiten.
# Se itera f"Mode {i+1}" (NO sobre m.load_combos, que incluye el combo de masa).
# =============================================================================
def serialize_results_modal(m):
    """Produce el dict ResultadosModales a partir del modelo ya analizado en modal.

    Materializa los ndarrays a tipos nativos (float(...)) antes de cruzar Comlink.
    `num_modes` es el nº REAL de modos resueltos (len(m.frequencies)), que puede ser
    menor que el pedido si la estructura tiene menos GDL.
    """
    brutas = [float(x) for x in m.frequencies]

    # Saneo de NO FINITOS (NaN/Inf): un autovalor negativo por redondeo (modo de
    # cuerpo rigido / cuasi-mecanismo) da sqrt(neg)=NaN, y un GDL con masa ~0 puede dar
    # Inf. float() los propaga sin lanzar y cruzarian Comlink: el borde Zod rechaza NaN
    # (-> "formato inesperado" opaco) y ACEPTA Inf (-> "infinito Hz" como modo espurio).
    # Filtramos esos modos AQUI, donde se conoce el contexto fisico. Se renumera 1..N
    # de forma contigua para conservar el invariante modos[k] <-> frecuencias[k] y
    # frecuencia == frecuencias[numero-1].
    modos = []
    frecuencias = []
    for i, f in enumerate(brutas):
        if not math.isfinite(f):
            continue
        combo = "Mode %d" % (i + 1)  # combo interno que PyNite creo por modo
        nodos = {}
        gdl_no_finito = False
        for name, nd in m.nodes.items():
            seis = [
                float(nd.DX[combo]), float(nd.DY[combo]), float(nd.DZ[combo]),
                float(nd.RX[combo]), float(nd.RY[combo]), float(nd.RZ[combo]),
            ]
            if not all(math.isfinite(v) for v in seis):
                gdl_no_finito = True
                break
            nodos[name] = seis
        if gdl_no_finito:
            continue
        frecuencias.append(f)
        modos.append({
            "numero": len(modos) + 1,         # 1-indexado contiguo tras el filtro
            "frecuencia": f,                  # Hz; == frecuencias[numero-1]
            "nodos": nodos,                   # nombre -> [DX,DY,DZ,RX,RY,RZ]
        })

    # Si NINGUN modo salio finito, el problema de autovalores esta mal condicionado
    # (mecanismo interno / GDL sin masa): error de obra, no una salida vacia muda.
    if not modos:
        raise MotorInestableModal(
            "No se pudo calcular ningun modo de vibracion valido: revise apoyos, "
            "rigidez y masa del modelo."
        )

    return {
        "units": "kN-m",
        "analysis": {"type": "modal", "num_modes": len(modos)},
        "frecuencias": frecuencias,
        "modos": modos,
    }


# =============================================================================
# 5) ORQUESTADOR  (entrada limpia que llama el worker via Comlink)
# =============================================================================
def calcular(payload, n_points=N_POINTS_DEFAULT):
    """Punto de entrada del glue: build -> analyze -> serialize.

    `payload` puede ser un dict (proxy de JS convertido) o un str JSON. Devuelve
    SIEMPRE un dict con una de dos formas:
      - exito: {"ok": True, "resultados": ResultadosCalculo}
      - error: {"ok": False, "error": {"mensaje": str, "detalle": str}}
    El worker traduce el caso de error al estado "error" / ErrorMotor (fase
    "calculo"); nunca propaga una excepcion Python cruda a traves de Comlink.
    """
    try:
        # Aceptar str JSON o dict/proxy. .to_py() si viene un JsProxy de Pyodide.
        if isinstance(payload, str):
            payload = json.loads(payload)
        elif hasattr(payload, "to_py"):
            payload = payload.to_py()

        m = build_model(payload)

        analysis = payload.get("analysis", {"type": "analyze", "check_statics": False})
        tipo, _aviso = run_analysis(m, analysis)

        # MODAL: camino INDEPENDIENTE. No produce esfuerzos/reacciones por combo, asi
        # que NO se serializa con serialize_results (por-combo) ni se calcula
        # check_statics: se devuelve la forma ResultadosModales y se sale aqui.
        if tipo == "modal":
            return {"ok": True, "resultados": serialize_results_modal(m)}

        # Combos realmente definidos; si el modelo no define ninguno PyNite usa
        # 'Combo 1' por defecto (guia §3.5). Filtramos a los existentes.
        combos = list(m.load_combos.keys()) or ["Combo 1"]

        # check_statics: solo si el analisis se pidio con la bandera Y el tipo lo
        # admite. Bajo P-Delta se FUERZA a false aunque el payload traiga el flag
        # en true (E6): analyze_PDelta no acepta check_statics y la comprobacion de
        # equilibrio de 1.º orden no aplica al estado deformado de 2.º orden. La UI
        # ya deshabilita el flag para P-Delta, pero un payload importado/obsoleto
        # podria traerlo en true; esta guardia en el glue es la red real (no basta
        # con la UI). Modal tampoco tiene reacciones coherentes -> tambien fuera.
        check = None
        if tipo not in ("PDelta", "modal") and analysis.get("check_statics", False):
            check = _check_statics(m, payload, combos)

        resultados = serialize_results(m, combos, n_points, tipo, check)
        return {"ok": True, "resultados": resultados}

    except MotorModalSinMasa as e:
        # El modelo no tiene masa para vibrar (sin peso propio ni material con rho, o
        # estructura totalmente coartada). Mensaje de obra; `detalle` guarda el crudo.
        return {
            "ok": False,
            "error": {
                "mensaje": (
                    "El modelo no tiene masa para calcular sus modos de vibracion: "
                    "active el peso propio o anada cargas permanentes."
                ),
                "detalle": "Modal: " + (str(e) or e.__class__.__name__)
                + "\n" + traceback.format_exc(),
            },
        }

    except MotorInestableModal as e:
        # Estructura inestable para el analisis modal (matriz singular). Mensaje de
        # obra distinto del de "sin masa"; mismo tono que el de P-Delta.
        return {
            "ok": False,
            "error": {
                "mensaje": (
                    "La estructura es inestable: revise apoyos, rigidez o "
                    "arriostramiento antes de calcular los modos."
                ),
                "detalle": "Modal: " + (str(e) or e.__class__.__name__)
                + "\n" + traceback.format_exc(),
            },
        }

    except MotorInestablePDelta as e:
        # Inestabilidad / no-convergencia bajo P-Delta -> mensaje de obra claro,
        # distinto de un fallo generico del solver. `detalle` conserva el mensaje
        # crudo de PyNite (que nodo/direccion lo imprime a stdout, no lo expone).
        return {
            "ok": False,
            "error": {
                "mensaje": (
                    "La estructura es inestable bajo P-Δ: revise rigidez o "
                    "arriostramiento."
                ),
                "detalle": "P-Delta: " + (str(e) or e.__class__.__name__)
                + "\n" + traceback.format_exc(),
            },
        }

    except Exception as e:  # noqa: BLE001 - frontera: todo error se vuelve dato.
        return {
            "ok": False,
            "error": {
                "mensaje": str(e) or e.__class__.__name__,
                "detalle": traceback.format_exc(),
            },
        }
