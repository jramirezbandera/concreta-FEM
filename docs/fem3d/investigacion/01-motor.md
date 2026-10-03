> **Informe original del Área 1 — Motor (PyNite sobre Pyodide)**, generado por un subagente el 2026-10-03.
> El documento consolidado es `../investigacion-id.md`; esto es el detalle con toda la evidencia.
> Los scripts y salidas citados están ahora en `experimentos/01-motor/`; las rutas absolutas
> del texto apuntan a la carpeta temporal de la sesión que los ejecutó.

# Área 1 — Motor de cálculo: PyNite sobre Pyodide

## Resumen (≤ 10 líneas)
La apuesta se sostiene **con condiciones**. PyNite 3.2.0 (paquete PyPI `PyNiteFEA`, no `PyNiteFEM`) corre en Pyodide 314.0.0 vendorizado con *stubs* de matplotlib/prettytable, con numpy 2.4.3 + scipy 1.17.1 del lock, y da en Node los mismos dígitos que CPython (equilibrio 1e-15, superposición 1e-13). Arranque en frío ≈ 4 s y ≈ 30,5 MB de descarga, de los que scipy es 14 MB. scipy es obligatorio.
Pero `analyze_linear` **no sirve tal cual**. Refactoriza y recalcula las FER de todos los elementos en cada combinación, y tiene dos bucles O(N²). Además, la API de resultados de PyNite trabaja elemento a elemento y caso a caso. Medido en Pyodide: 4 810 nudos tardan 55 s con 4 combinaciones; 928 nudos con 24 casos pasan de 50 s de extracción por la API a 4 s con un operador lineal. Un *driver* propio de ~100 líneas sobre los internos de PyNite deja 4 810 nudos y 24 casos en 24 s de cálculo + 9,5 s de extracción.
Hay tres límites que obligan a cambiar el diseño. PyNite supone Y vertical y no admite vector de referencia, solo un ángulo. El *drilling* de los quads es un muelle a tierra: rompe el equilibrio en la torsión de planta. Y no hay triángulos.

## Hallazgos

### MOT-01 · PyNite 3.2.0 se ejecuta en Pyodide 314.0.0 (vendorizado + stubs) y reproduce CPython dígito a dígito
- **Soporte:** A — experimento en esta máquina (Node 24.19 + `node_modules/pyodide` 314.0.0 del worktree + wheels del CDN pinneado, sha256 verificados contra el lock).
- **Prioridad:** P0
- **Afecta a:** §1, §10.3 (paso 2), §20 Fase 0, §23 P7 — confirma
- **Hallazgo:** Se monta el wheel `pynitefea-3.2.0-py3-none-any.whl` descomprimido en el FS de Pyodide y se registran en `sys.modules` módulos falsos para `matplotlib`, `matplotlib.pyplot`, `matplotlib.patches` y `prettytable`. Con eso, `from Pynite import FEModel3D` funciona y el pórtico de 2 plantas con losa de quads (88 nudos, 52 barras, 60 quads) da exactamente los mismos valores que en CPython: reacciones, esfuerzos de barra y resultantes de quad. Tiempos de arranque en Node (disco local, sin red):
  - `loadPyodide`: 1,3–1,75 s;
  - `loadPackage(["numpy","scipy"])`: 1,3–2,0 s;
  - `import Pynite`: 0,7–1,16 s;
  - total ≈ 3,4–4,9 s. El *worker* en frío completo tardó 3,96 s.

  Heap WASM: 62,4 MB tras cargar los paquetes y 74,9 MB tras el import.
- **Evidencia:**
  - `node pyodide_run.mjs boot` → `loadPyodide_ms 1549, loadPackage_numpy_scipy_ms 1538, import_Pynite_ms 827, heap_after_import_MB 74.9`.
  - `node pyodide_run.mjs minimo` (`out_pyodide_minimo.txt`): Σreacciones G = 399 000,000 N frente a una carga de 399 000,000 N (err 4,7e-15); los esfuerzos del pilar C0_0_1 y de la viga BX0_0_1 coinciden con `out_exp_a_yup.txt` (CPython).
  - `exp_version.py` en Pyodide → `Pynite.__version__ = '3.2.0' | numpy 2.4.3 | scipy 1.17.1 | python 3.14.2 | platform emscripten`.
- **Recomendación:** Adoptar el mismo patrón que PySlope: vendorizar los `.py` del wheel 3.2.0 junto con su `dist-info`, porque sin ella `__version__` devuelve `"dev"` (`Pynite/__init__.py:6-11`) y se pierde la huella exigida por ADR-009. Añadir un `STUBS_PY` equivalente al de taludes. La Fase 0 debe repetir la medición en navegador real (Chrome, Firefox, Safari).

### MOT-02 · scipy es obligatorio en 3.2.0 y el camino denso sin scipy no escala más allá de ~1 000 nudos
- **Soporte:** A — código (`FEModel3D.py:9` `import scipy as sp` a nivel de módulo) y experimento con scipy bloqueado.
- **Prioridad:** P0
- **Afecta a:** §1, §9.1, §10.1, §23 P7 — confirma (NumPy+SciPy) y corrige la idea de «resolver sin scipy con sparse=False»
- **Hallazgo:**
  - **Sin scipy no se importa.** Con scipy bloqueado, `import Pynite` falla (`ModuleNotFoundError`). El README lo confirma (v2.1.0: «Scipy has been a required dependency for some time now»).
  - **Parche probado.** Haciendo perezoso ese import, el camino `sparse=False` funciona solo con numpy. En Pyodide, 171 nudos tardan 0,90 s, pero 928 nudos (5 568 GDL) tardan 11,6 s y suben el heap a **836 MB**; con scipy sparse son 6,6 s y 224 MB.
  - **Techo del denso.** En CPython denso, 928 nudos alcanzan 773 MB de pico, frente a 105 MB en sparse. K densa ocupa (6N)²·8 B y `_partition` la copia: con 2 000 nudos ya pasaría de 1 GB por copia.
  - **scipy en el lock.** Está en `pyodide-lock.json` como `scipy-1.17.1-cp314-cp314-pyemscripten_2026_0_wasm32.whl`: 14,03 MB, 48,1 MB descomprimido, depende solo de `numpy` y no necesita `libopenblas` aparte.
  - **Usos de scipy.** `scipy.sparse.coo_matrix` para ensamblar (`FEModel3D.py:1791`), `spsolve` (`Analysis.py:217`) y `eigsh` para el modal (`FEModel3D.py:2533`).
- **Evidencia:**
  - `node pyodide_run.mjs noscipy` → `import_error: ... scipy bloqueado`.
  - `PYNITE_DIR=src320_noscipy node pyodide_run.mjs noscipy 3 3 3 1.0 0 1 0` → `analyze_s 11.575, heap_final_MB 836.4` (`out_pyodide_noscipy.txt`).
  - `exp_scaling.py 3 3 3 1.0 0 1 0` (CPython) → `peak_mem_MB 773.3`.
  - Tamaños medidos en `pyodide-dist/` (hash OK contra el lock).
- **Recomendación:** Cargar scipy siempre. No mantener un camino solo-numpy salvo como modo «modelo pequeño» (<300 nudos) si se quiere ahorrar 14 MB de descarga. Fijar `scipy 1.17.1` + `numpy 2.4.3` (lo que trae Pyodide 314.0.0) en la huella del run.

### MOT-03 · `analyze_linear` no reutiliza la factorización y tiene dos bucles O(N²): con 4 810 nudos tarda 55 s en Pyodide y la resolución lineal es solo el 2,6 %
- **Soporte:** A — código y experimentos de escalado en CPython y Pyodide.
- **Prioridad:** P0
- **Afecta a:** §9 (`multipleRightHandSides`), §11.1, §14.3, §23 P5 — contradice el supuesto de reutilización y corrige el presupuesto de tiempo
- **Hallazgo:**
  - **Qué hace `analyze_linear` por cada combinación.** Ensambla K una sola vez (`FEModel3D.py:2279`), pero dentro del bucle (`FEModel3D.py:2287`):
    - llama a `spsolve`, que refactoriza (`Analysis.py:217`);
    - recalcula `FER` de **todos** los elementos (`FEModel3D.py:2136`), tengan carga o no;
    - des-particiona con `list.index` y `in list`, que es O(N_gdl²) (`Analysis.py:836-841`).
  - **Comprobación nodal cuadrática.** `_check_stability` busca el nudo de cada gdl con una *list comprehension* sobre todos los nudos (`Analysis.py:123`), también O(N²).
  - **Mediciones de `analyze_linear`** (sparse, `check_stability=True`, 4 combinaciones):

    | Nudos | GDL | CPython | Pyodide |
    |---|---|---|---|
    | 171 | 1 026 | 0,58 s | 2,61 s |
    | 928 | 5 568 | 2,91 s | 6,59 s |
    | 2 650 | 15 900 | 14,3 s | 25,5 s |
    | 4 810 | 28 860 | 42,6 s | 54,8 s |

  - **Desglose de los 54,8 s de Pyodide con 4 810 nudos:** `check_stability` 16,8 s; des-partición 18,2 s; FER 7,7 s; ensamblado 9 s; `spsolve` + residuo 1,4 s.
  - **Driver propio** (`pynite_fast.solve_linear`): `splu` una vez, todos los casos como RHS múltiple, des-partición indexada, comprobación nodal vectorizada y FER solo de los elementos cargados en ese caso. Da los mismos resultados (desplazamientos 2,3e-13 relativos; reacciones 9e-9 N absolutos). Tiempos:
    - CPython: 928 nudos 1,96 s (4 casos) / 2,09 s (24); 4 810 nudos 9,5 s / 10,3 s;
    - Pyodide: 928 nudos 3,9 s / 4,3 s; 4 810 nudos 23,5 s / 23,6 s;
    - `analyze_linear` con 928 nudos y 24 casos: 14,05 s en CPython.
  - **Qué queda después.** El coste restante es Python puro en `Quad3D.ke()`/`Member3D` (≈11 s) y FER (≈7 s); factorizar 28 860 GDL cuesta 0,2–0,5 s.
- **Evidencia:**
  - `exp_scaling.py` → `out_scaling_cpython_small.txt`, `out_scaling_cpython_large.txt`, `out_scaling_pyodide_small.txt`, `out_scaling_pyodide_large.txt`.
  - `exp_fast.py` → `out_fast2_cpython.txt`, `out_fast_pyodide.txt` (p. ej. `4x4x5 s=0.75, combos 24, fast_s 23.606, factorize 0.425, solve_all 0.36`).
- **Recomendación:** El `PyNiteSolverAdapter` no debe llamar a `analyze_linear`. Debe usar un driver propio (patrón de `pynite_fast.py`) apoyado en `Analysis._prepare_model`, `_partition_D`, `FEModel3D.Ke`, `Member3D/Quad3D.FER` y `P`, y dejar el modelo en el mismo estado que `analyze_linear`. Esos internos deben cubrirse con tests contractuales, porque ADR-009 fija la versión. Declarar `multipleRightHandSides: true` solo para ese driver. Presupuesto §14.3: con este driver, ≤ ~1 500 nudos cumplen los 10 s en Pyodide sin contar el arranque; 5 000 nudos no.

### MOT-04 · La API de resultados de PyNite cuesta 12 veces más que el cálculo; un operador lineal por elemento la reduce a O(N_elem)
- **Soporte:** A — experimento con comparación de valores.
- **Prioridad:** P0
- **Afecta a:** §11.1, §12, §14.3, §23 P4 — añade
- **Hallazgo:**
  - **Por qué cuesta.** `Quad3D.moment/shear/membrane` recalculan `T()`, `J`, `B_b`, `B_s` y `B_m` en cada llamada y para cada caso. `Member3D.*_array` re-segmenta la barra por combinación (`Member3D.py:2836`).
  - **Medición (928 nudos, 444 barras, 810 quads, 24 casos)**, extrayendo 6 diagramas × 11 estaciones por barra y las 8 resultantes de quad en el centroide:
    - API de PyNite: 28,7 s en CPython y **50,2 s en Pyodide** (14,3 s barras + 35,9 s quads);
    - alternativa: **1,6 s en CPython y 4,0 s en Pyodide**;
    - con 4 810 nudos y 24 casos, la alternativa tarda 9,5 s en Pyodide.
  - **La alternativa:**
    - quads: matriz 8×24 por elemento, construida una vez con los `B` y `H` de PyNite (Gauss 2×2 + `T`), aplicada como `op @ D[gdl,:]` a todos los casos;
    - barras sin carga en el vano en ese caso: diagrama exacto a partir de los esfuerzos de extremo `f = ke·T·D` (N=f0, Vy=f1, Vz=f2, T=f3, My=−f4−f2·x, Mz=f5−f1·x);
    - barras con carga en el vano: la API de PyNite.
  - **Exactitud:** error máximo 2,6e-11 en quads y 1,5e-11 en barras.
- **Evidencia:**
  - `exp_results.py 3 3 3 1.0 20` → `out_results_cpython.txt`: `members_api_s 6.323, members_hybrid_s 0.927, quads_api_s 22.395, quads_vectorized_s 0.705`.
  - Pyodide → `out_results_pyodide.txt` (`members_api_s 14.305, quads_api_s 35.945, ...hybrid 2.336, vectorized 1.665`) y `out_results_pyodide_4810_fast.txt`.
- **Recomendación:** El adaptador devuelve, por caso, los desplazamientos (`Float64Array` 6N), los esfuerzos de extremo de barra (12 por barra) y las resultantes de shell con el operador precalculado. Los diagramas de barras con carga en el vano se reconstruyen en TypeScript a partir de los esfuerzos de extremo y de las cargas, que Concreta ya conoce porque las generó; son fórmulas cerradas, como `BeamSegZ` (`BeamSegZ.py:104-142`). Fijar con un test que el operador coincide con `Quad3D.moment/shear/membrane` en elementos aleatorios.

### MOT-05 · PyNite supone Y vertical, no acepta vector de referencia y su orientación por defecto es discontinua: el adaptador debe calcular `rotation`
- **Soporte:** A — código (`Member3D.py:933-1036`) y experimento.
- **Prioridad:** P0
- **Afecta a:** §5.2, §8 (`FrameElement.localYAxis`), §23 P6 — contradice («vector de referencia explícito»)
- **Hallazgo:**
  - **Supone Y vertical.** `Member3D.T()` considera «vertical» la barra con `isclose(Xi,Xj) and isclose(Zi,Zj)` (`Member3D.py:957`). Una viga con Z vertical, como en Concreta, toma por defecto eje local y = Y global (horizontal) y z = vertical. La flexión por gravedad pasa entonces a ser `My` sobre `Iy`, que en el convenio de PyNite es el eje débil.
  - **Efecto medido.** El mismo modelo da Mz = 13,2 kN·m (Y-up) o My = 11,8 kN·m sobre el eje débil (Z-up sin tratar).
  - **Orientación discontinua.** `isclose` usa tolerancia relativa y `abs_tol=0`. Un pilar casi vertical en Y-up con dx = ±1e-9 m invierte 180° sus ejes y y z; con dx = dz = 1e-12 m los gira 45°.
  - **Sin vector de referencia.** Solo existe `rotation` en grados alrededor de x local, aplicado con Rodrigues sobre el eje por defecto. Calcular el ángulo con `atan2((y0×yd)·x, y0·yd)` a partir de `member.T()` con rotación 0 deja el eje local y igual al vector de referencia proyectado, con error ≤ 1,2e-16, en pilares, vigas X/Y, barras inclinadas y pilares descendentes.
- **Evidencia:**
  - `exp_ejes.py` → `out_exp_ejes.txt` (`peor error 1.24e-16`).
  - `exp_ejes_signo.py` → `out_exp_ejes_signo.txt` (`dx=+1e-9: y=[-1,0,0]`; `dx=-1e-9: y=[1,0,0]`; `dx=+1e-12 dz=+1e-12: y=[-0.707,0,-0.707]`).
  - `out_exp_a_zup.txt` frente a `out_exp_a_yup.txt` (ejes y esfuerzos distintos para el mismo edificio).
- **Recomendación:**
  - Mapear Concreta (Z arriba) a PyNite con la permutación cíclica (Xp,Yp,Zp) = (Yc,Zc,Xc), que conserva la orientación dextrógira, para que los valores por defecto de PyNite (`mass_direction='Y'`, sus ejes) tengan sentido.
  - Calcular siempre `rotation` desde el `localYAxis` de Concreta con la fórmula anterior; no confiar nunca en el eje por defecto.
  - Añadir un test por barra que compruebe `T()[1,:3] ≈ localYAxis`, como exige el §5.2.

### MOT-06 · El *drilling* de Quad3D es un muelle a tierra sin acoplar: en torsión de planta las reacciones no equilibran la carga (−0,71 %)
- **Soporte:** A — código y experimento; corroborado por el issue #102, abierto desde 2021.
- **Prioridad:** P0
- **Afecta a:** §13.2, §18.2 (equilibrio ≤ 1e-8), §7.2 (conexión pilar/viga–losa), §23 P2 — contradice
- **Hallazgo:**
  - **Qué es.** La rigidez de giro sobre la normal es un término **diagonal** `ke_rz` = mín(rigideces de giro de flexión)/1000, sin acoplar con los desplazamientos de membrana (`Quad3D.py:565-623`; igual en `Plate3D.py:259-312`). Equivale a un muelle a tierra en cada nudo de losa o muro, y PyNite no lo contabiliza como reacción.
  - **Torsión de planta.** En el edificio 2×2×2 con un torsor de planta de 600 kN·m, Σ reacciones = −595,7 kN·m. Faltan **4 281 N·m (0,71 %)**, exactamente lo que absorben los muelles de drilling. Los casos G y W simétricos cuadran con 1e-15 porque los forjados no giran en planta.
  - **Torsor en un pilar que llega a la losa.** En una placa con un pilar en el nudo central, el pilar recibe solo 34 de 1 000 N·m y el resto va a tierra por el drilling (con J = 1e-6 m⁴; con un pilar de hormigón 30×30 la proporción bajaría a ≈ 14 %, estimación).
  - **Muro en voladizo.** Cuadra (0,000 %), porque allí el giro sobre la normal no se excita como sólido rígido.
- **Evidencia:**
  - `exp_drilling.py` → `out_exp_drilling.txt` (`TOR ... desequilibrio 4281.14 N·m (0.71 %) absorbido por drilling 4281.14`).
  - `exp_singular.py` caso 6 → `out_exp_singular.txt` (`torsor en pilar T = -34.09`).
  - `exp_muro.py` → `out_exp_muro.txt`.
  - https://github.com/JWock82/Pynite/issues/102: el mantenedor escribe que «the unbalanced forces are influenced strongly by the value I use for the drilling stiffness».
- **Recomendación:**
  - (a) No prometer equilibrio ≤ 1e-8 en modelos con shells que giren en planta. Calcular el desequilibrio en el adaptador, sumando Σ k_rz·θ_n, y emitir un diagnóstico si supera un umbral (p. ej. 0,1 %).
  - (b) Para el MVP, modelar la unión pilar–losa y viga–losa con barras que transmitan el momento por pares de fuerzas (técnica que sugiere el propio mantenedor en el #102), o evaluar parchear el drilling (formulación tipo Allman/Hughes–Brezzi) en la copia vendorizada.
  - (c) Pedir al área 5 un benchmark de torsión global frente a OOFEM.

### MOT-07 · PyNite 3.2.0 no admite triángulos: `Tri3D` existe pero no está conectado al modelo
- **Soporte:** A — código.
- **Prioridad:** P0
- **Afecta a:** §7.3 («el MVP puede utilizar triángulos»), §8 `ShellElement`, §23 P2/P10 — contradice
- **Hallazgo:**
  - **Sin triángulos.** `Pynite/Tri3D.py` se distribuye en el wheel, pero `FEModel3D` no tiene `add_tri`, no lo importa y `Ke()` solo ensambla `members`, `springs`, `quads` y `plates` (`FEModel3D.py:1551-1800`). Tampoco en HEAD (4afc9f1).
  - **Elementos de lámina disponibles:**
    - `Quad3D`: DKMQ (Katili) para flexión y cortante transversal + membrana Q4 bilineal isoparamétrica (Bathe, ej. 5.5) con Gauss 2×2 + drilling débil (`Quad3D.py:1-27, 450-700`). Admite cuadriláteros generales, gruesos y delgados.
    - `Plate3D`: placa rectangular de Kirchhoff de 12 términos, solo rectangular (`Plate3D.py:229-310`); ignora el argumento `local` en `moment/shear` (`Plate3D.py:590-655`). No apto para geometría general.
  - **Membrana de muro.** La membrana Q4 converge por el lado rígido: un muro en voladizo con 3, 6 y 12 elementos de ancho da 0,935, 0,980 y 0,992 de la flecha de Timoshenko.
  - **`kx_mod/ky_mod`** solo afectan a la membrana (`Quad3D.Cm`), no a la flexión (`Hb`).
  - **Historia del elemento.** Antes era MITC4 (README 2.4.0: «relic from the old MITC4 formulation»).
- **Evidencia:**
  - `grep -n "tri3d|add_tri|self.tris" FEModel3D.py` → sin resultados.
  - `exp_muro.py` → `out_exp_muro.txt`.
  - `Quad3D.py:1-3` (referencias Katili, Bathe).
- **Recomendación:** Que el mallador (área 2) produzca **solo cuadriláteros** (`formulationPreference: "quad"`) para PyNite, y que `supports()` rechace los triángulos con un diagnóstico explícito. Para muros, usar mallas de ≥ 6 elementos por ancho de paño o aceptar el error medido.

### MOT-08 · Member3D es Euler-Bernoulli con torsión de Saint-Venant y liberaciones por condensación; las cargas en barra se integran de forma exacta
- **Soporte:** A — código.
- **Prioridad:** P1
- **Afecta a:** §10.1, §23 P1, P6 — confirma y añade
- **Hallazgo:**
  - **Rigidez.** La matriz 12×12 es Euler-Bernoulli pura: términos 12EI/L³, sin factor Φ de cortante (`Member3D.py:176-208`). La sección solo tiene `A, Iy, Iz, J` (`FEModel3D.add_section`) y no hay áreas de cortante; los docs lo dicen: «Transverse shear deformations are not currently considered». La deformación por cortante existe en una rama aparte (issues #250 y #341, sin publicar).
  - **Torsión.** Uniforme GJ/L, sin alabeo.
  - **Liberaciones.** Se aplican con `def_releases` (12 booleanos Dxi..Rzj) por condensación estática con `inv(ke22)` (`Member3D.py:147-174`). Liberar Rxi y Rxj a la vez da `LinAlgError: Singular matrix` sin identificar la barra.
  - **Sin offsets ni zonas rígidas** (grep: ninguna coincidencia).
  - **Cargas en barra.** Puntuales, momentos y trapezoidales parciales, en ejes locales o globales. Las FER son de empotramiento perfecto en forma cerrada (`FixedEndReactions.py`) y los diagramas se calculan por segmentos analíticos (`BeamSegZ.py:104-142`), así que son exactos sin subdividir.
  - **Peso propio.** `add_member_self_weight` usa `rho·A` como carga lineal (`FEModel3D.py:1460`): `rho` es un peso específico (N/m³), no una densidad en kg/m³ como dice el §5.1.
- **Evidencia:**
  - Lectura de `src320/Pynite/Member3D.py`.
  - `exp_ejes.py` (3) → `EXCEPCIÓN: LinAlgError Singular matrix`.
  - `exp_a_minimo.py`: Σreacciones G = 399 000 N = 60 m² × 3 000 Pa + 219 000 N de peso de barras, que coincide con `rho·A·L`.
  - Docs: `docs/source/member.rst` («Transverse shear deformations are not currently considered»).
- **Recomendación:**
  - Declarar en `SolverCapabilities` que el elemento es Euler-Bernoulli (§10.1 ya lo prevé).
  - Pasar `rho = ρ·g`, o `factor = −g`, al peso propio.
  - Validar en TypeScript las liberaciones incompatibles (torsión o axil en ambos extremos) antes de llamar a PyNite.
  - Implementar los offsets, cuando lleguen (fase posterior), en el compilador mediante barras rígidas, no en PyNite.

### MOT-09 · Los quads devuelven M y Q por unidad de longitud y la membrana en tensiones, en cualquier (ξ,η) por extrapolación de Gauss; `local=False` lanza un error con numpy ≥ 2.4
- **Soporte:** A — código y experimento en CPython (numpy 2.5.3) y Pyodide (numpy 2.4.3).
- **Prioridad:** P1
- **Afecta a:** §12 `ShellResultBlock`, §13.2, §15.4, §23 P3 — corrige (hay que derivar N y rotar ejes)
- **Hallazgo:**
  - **Unidades.** `moment()` → [Mx, My, Mxy] en N·m/m (`Hb` incluye h³); `shear()` → [Qx, Qy] en N/m (`Hs` incluye h, k = 5/6, `Quad3D.py:488`); `membrane()` → [Sx, Sy, Txy] **en Pa** (`Cm` sin espesor). Por tanto Nx = Sx·t.
  - **Ubicación.** Cualquier (ξ,η) ∈ [−1,1]², extrapolando bilinealmente desde los 4 puntos de Gauss (`Quad3D.py:1017-1236`). El centroide (0,0) es la media de los 4 puntos; los nudos (±1,±1) son extrapolaciones por elemento, discontinuas entre elementos.
  - **Ejes locales.** x = i→j; z = x × (n − i) en `T()`; y = z × x. Ojo: `_local_coords()` usa i→m para la normal (`Quad3D.py:107-142` frente a `884-930`), lo que solo importa en quads alabeados.
  - **`local=False` no funciona.** Lanza `TypeError: only 0-dimensional arrays can be converted to Python scalars` en `moment`, `shear` y `membrane` (`Quad3D.py:1078, 1159, 1221`), con numpy 2.4.3 y 2.5.3. Ningún test del repositorio lo usa.
  - **Presión.** Solo normal y uniforme por elemento: positiva en +z local (`Quad3D.py:758`, comprobado: −3 000 Pa con normal +Z → carga hacia abajo). El vector de cargas es bilineal en w, sin términos de giro (`Quad3D.py:734`).
- **Evidencia:**
  - `exp_signos.py` → `out_exp_signos.txt` y `out_pyodide_signos.txt` (`moment(local=False) -> EXC TypeError ... (numpy 2.4.3)`).
  - `exp_a_minimo.py` (valores en centroide y en las 4 esquinas).
- **Recomendación:** Usar siempre `local=True` (mejor aún, el operador de MOT-04). Rotar el tensor de N y M y el vector de Q al `localXAxis` de Concreta en TypeScript, o bien ordenar los nudos del quad para que i→j coincida con ese eje. Guardar las resultantes en `locations: "centroid"` como dato bruto (§12.1) y las 4 extrapolaciones nodales solo para el suavizado visual.

### MOT-10 · El convenio de signos de PyNite mezcla caras: N, Vy, Vz, T y Mz salen con el signo de la cara negativa y My con el de la positiva
- **Soporte:** A — casos de solución conocida ejecutados en CPython y Pyodide.
- **Prioridad:** P1
- **Afecta a:** §5.2, §12, §15.3, §23 P3, P4 — añade
- **Hallazgo:** Barra en X con ejes locales iguales a los globales, en Y-up:
  - biapoyada con −w en y: Mz(L/2) = −wL²/8 (el momento positivo es el que tracciona la cara superior), Vy(0) = +wL/2;
  - con −w en z: My(L/2) = −wL²/8, Vz(0) = +wL/2;
  - tracción P: `axial` = −P;
  - torsor +T aplicado en j: `torque` = −T.

  De las fórmulas de segmento (`Member3D.py:2968-2975`) se deduce que N = f0, Vy = f1, Vz = f2, T = f3, Mz = f5 − f1·x y My = −f4 − f2·x, donde f es el esfuerzo de extremo i sobre la barra. Es decir: N, Vy, Vz, T y Mz son el esfuerzo sobre la cara negativa (= −cara positiva) y My es el de la cara positiva. En la losa (z local hacia arriba), la flexión positiva de un vano da Mx < 0 (−4 500 N·m/m = −wL²/8). Tabla §12 → PyNite → transformación, con ejes locales alineados vía MOT-05 y Concreta en convenio de cara positiva:

  | Componente §12 | Llamada PyNite 3.2.0 | Transformación |
  |---|---|---|
  | `nodeDisplacements` ux,uy,uz,rx,ry,rz | `node.DX/DY/DZ/RX/RY/RZ[combo]` o `model._D[combo]` (6N, orden `node.ID` = orden de inserción) | Permutación Y-up → Z-up: (ux,uy,uz) = (DZ,DX,DY); igual para los giros |
  | `nodeReactions` | `node.RxnFX…RxnMZ[combo]` (solo nudos con apoyo; incluye muelles −k·d) | Misma permutación; ojo con el drilling (MOT-06) |
  | Frame N | `pm.axial_array(n, combo, x_array)` o f0 | N = −axial (tracción +, como FEM 2D «+ tracción») |
  | Frame Vy, Vz | `pm.shear_array('Fy'/'Fz', …)` o f1, f2 | V = −valor (cara positiva) |
  | Frame T | `pm.torque_array(…)` o f3 | T = −valor |
  | Frame My | `pm.moment_array('My', …)` o −f4 − f2·x | My = +valor |
  | Frame Mz | `pm.moment_array('Mz', …)` o f5 − f1·x | Mz = −valor |
  | Estaciones | `x_array` en m ∈ [0, L] de la barra física | station = x/L |
  | Shell Nx, Ny, Nxy | `quad.membrane(ξ,η,True,c)·t` | Rotar el tensor al `localXAxis` |
  | Shell Mx, My, Mxy | `quad.moment(ξ,η,True,c)` | Rotar el tensor; signo según el convenio de cara de Concreta (Mx<0 = vano con z arriba) |
  | Shell Qx, Qy | `quad.shear(ξ,η,True,c)` | Rotar como vector; signo pendiente de un *patch test* (Qx = −2 750 N/m junto al apoyo izquierdo) |
- **Evidencia:**
  - `exp_signos.py` → `out_exp_signos.txt` (`Mz(L/2)=-4500.0`, `My(L/2)=-4500.0`, `axial(L/2)=-5000.0`, `torque(L/2)=-700.0`, `Mz(0)=30000.0` en voladizo).
  - `exp_results.py` → coincidencia de las fórmulas de extremo con 1,5e-11.
- **Recomendación:** Codificar esta tabla en `solvers/pynite` con tests «golden» de los 6 casos de `exp_signos.py` (§5.2: «antes de conectar cualquier solver…»). Fijar en el área 3 el signo de Mxy y de Qx/Qy con un *patch test* de placa.

### MOT-11 · Una combinación de factor 1 por caso simple permite a Concreta superponer exactamente
- **Soporte:** A — experimento.
- **Prioridad:** P1
- **Afecta a:** §11.1, ADR-006, §21 «Concreta combina…» — confirma
- **Hallazgo:** Con combinaciones `{'G':1}`, `{'Q':1}`, `{'W':1}` y una ELU `{'G':1.35,'Q':1.5,'W':0.9}`, la diferencia entre la ELU de PyNite y la Σ factor·caso es:
  - desplazamientos: 7,6e-16 relativo;
  - esfuerzos de barra en 5 estaciones: 6,2e-13;
  - resultantes de quad en el centroide: 3,3e-12.

  El equilibrio vertical por caso da un error de 6,7e-15. PyNite solo resuelve «combinaciones» (`load_combos`); los casos son etiquetas dentro de las cargas, y sin combinación no hay solución (`Analysis._prepare_model` crea `Combo 1` = `Case 1`).
- **Evidencia:** `exp_a_minimo.py` → `out_exp_a_zup.txt`, `out_exp_a_yup.txt` y `out_pyodide_minimo.txt` (mismas cifras en Pyodide).
- **Recomendación:** El adaptador crea exactamente una combinación de factor 1 por `LoadCase` de Concreta, con el mismo id. Nunca debe pasar a PyNite combinaciones normativas; las combinaciones y envolventes quedan en `CombinationEngine`.

### MOT-12 · Ante mecanismos, PyNite lanza excepciones genéricas o, con `check_stability=False`, devuelve NaN o desplazamientos de 1e12 sin avisar
- **Soporte:** A — experimento.
- **Prioridad:** P1
- **Afecta a:** §2.3 (principio 8), §16, §21 «Una singularidad produce un error comprensible», §23 — corrige (hay que construir el diagnóstico)
- **Hallazgo:** Con `check_stability=True`:
  - **nudo suelto o gdl sin rigidez:** `Exception('Unstable node(s). See console output for details.')`; los nombres solo aparecen en **stdout** («node suelto is unstable for translation in the global X direction»; `Analysis.py:163-166`);
  - **mecanismo global** (rótula interior en voladizo, estructura sin apoyos): `Exception('The stiffness matrix is singular…')`, sin nudo ni gdl; se detecta por residuo con tolerancia 1e-6 (`Analysis.py:176-241`);
  - **doble liberación de torsión:** `numpy LinAlgError: Singular matrix`.

  Con `check_stability=False`:
  - nudo suelto: el vector D contiene NaN y no hay excepción;
  - mecanismo: desplazamientos finitos de 6,4e12 m (sparse) u 8,6e12 m (denso), presentados como válidos.

  Además, `check_statics=True` imprime con `PrettyTable` (`Analysis.py:1331`) y falla con los stubs.
- **Evidencia:** `exp_singular.py` → `out_exp_singular.txt`.
- **Recomendación:**
  - Nunca usar `check_stability=False`.
  - Usar la comprobación nodal vectorizada de `pynite_fast.py`, que devuelve `[(nudo, gdl)]` (O(N) en lugar de O(N²)), y traducirla vía mapping a `PhysicalRef`.
  - Ante un mecanismo global, emitir el diagnóstico «matriz singular» y, como mejora, localizar el modo con un autovector de K11 de autovalor ≈ 0 (`eigsh` funciona en Pyodide, véase MOT-16).
  - Validar `isfinite` en el adaptador (§12.1) aunque PyNite no lance nada.

### MOT-13 · Sin SharedArrayBuffer, la cancelación puede ser cooperativa con Python asíncrono; `terminate()` cuesta 52 ms más 5,6 s de re-arranque
- **Soporte:** A — experimento con `node:worker_threads`, cuya semántica de bucle de eventos coincide con la del Worker del navegador.
- **Prioridad:** P1
- **Afecta a:** §14.1, §14.2, §21 «puede cancelarse», §23 P9 — confirma y añade
- **Hallazgo:**
  - **`runPython` síncrono.** Bloquea el bucle del *worker*: un mensaje `cancel` enviado a +1,5 s se atendió **4 976 ms después**, al terminar la tarea de 6,5 s.
  - **Python asíncrono (`runPythonAsync`) con `await asyncio.sleep(0)` entre fases.** El mensaje se procesa en el siguiente punto de cesión. La tarea paró 1,8 s después del envío; esa latencia es el tramo síncrono más largo (ensamblado + resolución).
  - **`worker.terminate()`.** Tarda 52 ms, pero re-arrancar Pyodide + scipy + PyNite cuesta 5,6 s.
  - **Memoria entre repeticiones.** Cinco ejecuciones seguidas de 928 nudos devolviendo solo números dejan el heap WASM estable en 228,2 MB: no hay crecimiento.
- **Evidencia:** `cancel_main.mjs` + `cancel_worker.mjs` → `out_cancel.txt`. Los «Error thrown in write» del log son mensajes de `loadPackage` a stdout dentro de `worker_threads`; son ruido sin efecto.
- **Recomendación:** Implementar el driver como corrutina con puntos de cesión (tras el ensamblado, tras FER por caso, cada ~200 elementos en la extracción) y un indicador `CANCEL` que pone el `onmessage` del worker. Mantener `terminate()` + re-arranque, el patrón de `geotech/client.ts`, como último recurso, por ejemplo si no hay respuesta a los 2 s.

### MOT-14 · Hay que vendorizar PyNite, no instalarlo con micropip: el import arrastra matplotlib y prettytable a través de ShearWall
- **Soporte:** A — código y experimento.
- **Prioridad:** P1
- **Afecta a:** §9.1 (offline, versiones fijadas, licencias), §23 P7 — confirma la vía PySlope
- **Hallazgo:**
  - **Por qué hacen falta los stubs.** `Pynite/__init__.py:3` importa `ShearWall`, y `FEModel3D.py:20` también. `ShearWall.py:8-11` importa `prettytable` y `matplotlib.pyplot` a nivel de módulo. Sin stubs, el import falla (`ModuleNotFoundError: prettytable`). Los imports de matplotlib de `Member3D` y `PhysMember` ya son perezosos. `Rendering`, `Visualization`, `VTKWriter` y `Reporting` (pyvista, vtk, IPython, jinja2) no se importan en el camino de cálculo.
  - **micropip.** `micropip.install('PyNiteFEA==3.2.0')` funciona, pero descarga matplotlib, contourpy, cycler, fonttools, kiwisolver, pillow, pyparsing, dateutil, pytz, six, packaging y wcwidth (10,3 MB más), necesita PyPI en tiempo de ejecución (rompe el uso offline) y el import sube a 3,3 s, frente a 0,7–1,1 s con stubs.
  - **Tamaño vendorizado.** El subconjunto de cálculo son 18 `.py`, 722 kB (126 kB en gzip).
  - **Licencia.** MIT (`LICENSE`: «Copyright (c) 2018 D. Craig Brinck»), compatible con PolyForm Noncommercial; basta con atribución.
- **Evidencia:**
  - `node pyodide_run.mjs nostubs` → `ModuleNotFoundError: No module named 'prettytable'`.
  - `node pyodide_micropip.mjs` → `out_pyodide_micropip.txt` (`install_ms 3516, import_ms 3293, installed [...]`).
  - Tamaños calculados con gzip -9.
- **Recomendación:**
  - Un script `vendor-pynite.mjs` análogo al de PySlope: extrae el wheel 3.2.0, copia los 18 `.py` y la `dist-info`, y añade `NOTICE`.
  - Stubs de `matplotlib*` y `prettytable` que lanzan una excepción si se usan.
  - Parche opcional: quitar `from Pynite.ShearWall import ShearWall` de `__init__.py` y `FEModel3D.py`, ya que Concreta no usará `ShearWall` porque no encaja con su compilador (MOT-16).
  - Ampliar `fetch-pyodide-assets.mjs` para que baje también scipy.

### MOT-15 · Cada barra se subdivide en silencio en cualquier nudo colineal a menos de 1e-12·(1+L) m
- **Soporte:** A — código y experimento.
- **Prioridad:** P1
- **Afecta a:** §7.2 («no se usarán uniones por proximidad opacas»), §9.2, §16 — contradice si no se controla
- **Hallazgo:**
  - **Subdivisión implícita.** Toda barra es un `PhysMember`. En cada análisis, `descritize()` recorre **todos** los nudos del modelo (`PhysMember.py:79`, O(barras × nudos), con filtro por caja) y parte la barra en cualquier nudo a menos de `1e-12·(1+L)` m de su eje (`PhysMember.py:66`). Un nudo a 0 o 1e-13 m de una viga queda conectado sin aviso y cambia la solución (DY = −1,421e-6 frente a −1,429e-6); a 1e-9 m ya no se conecta.
  - **Tolerancias.** La tolerancia es 10⁶ veces más estricta que la de Concreta (1e-6 m, §5.3).
  - **Duplicados.** `merge_duplicate_nodes` (O(N²)) no se llama automáticamente salvo dentro de `ShearWall`.
- **Evidencia:** `exp_autosplit.py` → `out_exp_autosplit.txt`.
- **Recomendación:**
  - El compilador debe crear las barras ya partidas en todos los nudos y ajustar las coordenadas (*snap*).
  - El adaptador debe comprobar tras `_prepare_model` que `len(pm.sub_members) == 1` para cada barra; si no, emitir un diagnóstico de unión implícita con los ids.
  - No llamar nunca a `merge_duplicate_nodes`.

### MOT-16 · Faltan diafragmas, MPC, offsets, peso propio de láminas, cargas en el plano y temperatura; sí hay muelles de apoyo, modal y P-Delta de barras
- **Soporte:** A — código y experimento (el modal funciona en Pyodide).
- **Prioridad:** P1
- **Afecta a:** §2.1, §7.1 (paso 8), §20 «Evolución posterior», §23 P6 — añade
- **Hallazgo:**
  - **Hay:**
    - apoyos rígidos por gdl global (`def_support`);
    - muelles de apoyo en gdl globales, bidireccionales o unidireccionales, estos últimos no lineales (`def_support_spring`, `FEModel3D.py:1177`);
    - desplazamientos impuestos;
    - muelles axiales entre nudos (`Spring3D`);
    - barras solo tracción o solo compresión, con `analyze()` iterativo;
    - cargas nodales globales; cargas en barra locales o globales; presión normal uniforme por quad;
    - `analyze_PDelta`, solo barras («P-Delta effects in plates/quads are not considered»);
    - `analyze_modal` con `eigsh` (en Pyodide da las mismas frecuencias que CPython, 4,687/4,748/5,362 Hz, en 2,2 s);
    - mallas `RectangleMesh` con huecos rectangulares (`Mesh.py:719, 1071`), anillos y cilindros;
    - `ShearWall` y `MatFoundation`, rectangulares, ligados a matplotlib.
  - **No hay:**
    - diafragma rígido, MPC ni *constraints* (issue #292 abierto);
    - offsets ni zonas rígidas;
    - peso propio de placas y quads (los docs: «self-weight is not supported for plate elements»);
    - cargas en el plano del shell, cargas lineales sobre shell y cargas térmicas (grep: ninguna).
- **Evidencia:**
  - `exp_modal.py` → `out_exp_modal.txt`.
  - `grep -i "diaphragm|rigid|constraint|thermal"` sin resultados útiles.
  - https://github.com/JWock82/Pynite/issues/292.
- **Recomendación:**
  - El compilador convierte el peso propio de las losas en presión (horizontales) y el de los muros en cargas nodales equivalentes.
  - Las cargas lineales sobre shell pasan a nodales, y las de muros en su plano también.
  - `supports()` debe rechazar el diafragma rígido. No usar `ShearWall` ni `RectangleMesh`: el mallador es de Concreta (área 2).

### MOT-17 · El heap WASM crece con el modelo y no vuelve a bajar: 230 MB con 928 nudos y 662 MB con 4 810 nudos y 24 casos
- **Soporte:** A — experimento (`HEAP8.buffer.byteLength`).
- **Prioridad:** P1
- **Afecta a:** §14.2 («se controla explícitamente el límite de memoria»), §19, §23 P8, P9 — añade
- **Hallazgo:** Heap WASM medido:
  - 62,4 MB con numpy + scipy; 74,9 MB tras el import;
  - 224–230 MB con 928 nudos;
  - 352–362 MB con 2 650 nudos;
  - 556–662 MB con 4 810 nudos (4 o 24 casos).

  La memoria WASM solo crece, así que un *worker* que resolvió un modelo grande conserva ese tamaño. En Node el máximo reservable es 4 032 MB (`memmax`). En CPython (psutil) el pico sparse es de 105 MB con 928 nudos y 287 MB con 4 810 nudos y 24 casos.
- **Evidencia:** `PYODIDE_INFO.heap_final_MB` en `out_fast_pyodide.txt`, `out_scaling_pyodide_*.txt` y `out_pyodide_modes.txt` (`max_numpy_alloc_MB 4032`).
- **Recomendación:**
  - Fijar el límite en nudos por número de GDL, no en MB, porque el heap no baja.
  - Si un cálculo superó ~500 MB, reciclar el *worker* cuando quede ocioso.
  - Medir el límite real en Safari para iOS y en Chrome para Android en la Fase 0.

### MOT-18 · El paquete es `PyNiteFEA` 3.2.0, MIT, con un mantenedor casi único y tres versiones mayores en 19 meses
- **Soporte:** A — consultas a PyPI JSON y `git log` del repositorio clonado.
- **Prioridad:** P1
- **Afecta a:** §9.1, §10.1, §20 Fase 0, ADR-009 — corrige el nombre y añade riesgo
- **Hallazgo:**
  - **Nombre.** `pip download PyNiteFEM` no encuentra nada (404 en PyPI). El paquete es **`PyNiteFEA`** 3.2.0 (2026-09-13, Python ≥ 3.11). Dependencias declaradas: `matplotlib`, `numpy>=2.4.0`, `prettytable` y `scipy`; los extras `all/vtk/pyvista/reporting/derivations` añaden ipython, vtk, pyvista, jinja2 y sympy. Ojo: `pynite` en PyPI es otro proyecto (cree-py, 2018).
  - **Ritmo y rupturas.** 74 versiones. Mayores: 1.0.0 (2025-02-01), 2.0.0 (2025-12-15) y 3.0.0 (2026-06-01, que renombró `K/k` a `Ke/ke`, internos que el driver de MOT-03 usa). Desde diciembre de 2024 publica ≈ 1,2 versiones al mes.
  - **Mantenedores.** Craig Brinck (JWock82) firma 2 015 de 2 198 commits (91,7 %) y 266 de los 300 desde octubre de 2025.
  - **Repositorio.** 751 estrellas, 151 forks y 21 issues abiertos, entre ellos #102 (estática con quads), #251/#269 (rendimiento), #292 (MPC) y #250/#341 (Timoshenko).
  - **HEAD posterior.** HEAD (4afc9f1, 2026-09-28) cambia 20 ficheros de `Pynite/` respecto a la etiqueta 3.2.0 (e98dfc8), sobre todo por pyupgrade y ruff.
- **Evidencia:**
  - `curl https://pypi.org/pypi/PyNiteFEA/json`.
  - `curl https://pypi.org/pypi/PyNiteFEM/json` → `{"message":"Not Found"}`.
  - `git log --format=%an | sort | uniq -c`.
  - `gh api repos/JWock82/Pynite`.
- **Recomendación:** Fijar `PyNiteFEA==3.2.0` por hash del wheel (sha256 del fichero vendorizado) y corregir el nombre en el diseño. Tratar cada subida de versión mayor como una migración con la batería contractual completa; el driver propio depende de internos. Vigilar la rama de deformación por cortante (#341), que cambiará `Section`.

### MOT-19 · Interrumpir Pyodide exige SharedArrayBuffer con COOP/COEP, que GitHub Pages no puede servir
- **Soporte:** B — documentación oficial de Pyodide + discusión oficial de GitHub; no se probó en navegador.
- **Prioridad:** P1
- **Afecta a:** §14.2, §21 — confirma la estrategia «terminar y recrear» y la matiza
- **Hallazgo:**
  - **Requisitos de la interrupción.** `pyodide.setInterruptBuffer` necesita un `SharedArrayBuffer`, y este, aislamiento entre orígenes mediante las cabeceras COOP/COEP. GitHub Pages no permite cabeceras propias.
  - **Alternativa y su coste.** La alternativa conocida es `coi-serviceworker`, que emula esas cabeceras desde un *service worker*. Recarga la página en la primera visita y convive mal con el SW de Workbox que ya tiene Concreta. Además, COEP exige CORP en recursos de terceros, como las fuentes de Google.
  - **Sin este canal**, solo quedan la cancelación cooperativa (MOT-13) o `terminate()`.
- **Evidencia:**
  - https://pyodide.org/en/stable/usage/keyboard-interrupts.html («you must be using Pyodide in a webworker… Your server must set appropriate security headers»).
  - https://github.com/orgs/community/discussions/13309.
  - `pyodide.d.ts:1866-1884` del worktree.
- **Recomendación:** No introducir COOP/COEP ni coi-serviceworker en el MVP. Cancelación cooperativa más `terminate()` de reserva. Si en el futuro hace falta, que lo decida el área 4 junto con el SW de Workbox.

### MOT-20 · No conviene persistir objetos de PyNite: guardar solo el AnalyticalModel y los resultados como datos
- **Soporte:** C — una sola fuente (comentario del mantenedor en el issue #102 sobre *pickles* rotos entre versiones) + inferencia.
- **Prioridad:** P2
- **Afecta a:** §17, §23 P13 — añade
- **Hallazgo:** En el #102 el mantenedor no pudo abrir un modelo *pickled* del usuario tras cambiar la clase `Node` («I changed the Node class in version 0.0.50, so I get errors when I run your pickled version»). Los objetos `FEModel3D` contienen además referencias cruzadas (nudo ↔ barra ↔ modelo) y estado de solución por combinación. Junto con MOT-18 (tres versiones mayores en 19 meses), persistirlos haría frágil el formato.
- **Evidencia:** https://github.com/JWock82/Pynite/issues/102 (comentario de JWock82, 2021-10-01).
- **Recomendación:** El `SolveArtifact` persiste el `AnalyticalModel` de Concreta, que es determinista, y `Float64Array` por caso, con la huella `{pyodide, numpy, scipy, PyNiteFEA, sha256 del vendor, versión del driver}`. Es el mismo criterio del proyecto: «el .concreta lleva sólo datos». El modelo PyNite se reconstruye en cada cálculo.

## Contradicciones con el diseño técnico
1. **§9/§11.1 (reutilizar factorización) y §9.1 («script del adaptador pequeño»).** `analyze_linear` refactoriza en cada combinación y escala O(N²) (MOT-03), y su API de resultados es O(elementos × casos) (MOT-04). Cumplir §11.1 y §14.3 exige un driver propio que use internos de PyNite (`Analysis._prepare_model`, `Ke`, `FER`, `B_b/B_s/B_m`). El adaptador será pequeño, pero estará acoplado a la versión: pasa a ser una dependencia fijada y con tests contractuales, no una «API estable».
2. **§18.2 (equilibrio global ≤ 1e-8).** Con `Quad3D` es inalcanzable en cuanto un forjado gira en planta: torsión global o torsores en uniones pilar–losa. El drilling es un muelle a tierra y su reacción no se contabiliza (MOT-06; 0,71 % en el ensayo; issue #102 abierto). Hay que definir la tolerancia por caso y diagnosticar la parte absorbida por el drilling.
3. **§5.2 / §8 (vector de referencia explícito; Z arriba).** PyNite tiene un convenio implícito Y-up, solo un ángulo `rotation` y una orientación por defecto discontinua ante ruido de 1e-9 m (MOT-05). El adaptador debe permutar ejes y calcular el ángulo.
4. **§7.3 (triángulos).** PyNite 3.2.0 no tiene triángulo utilizable (MOT-07); el mallador debe producir cuadriláteros.
5. **§7.2 / §9.2 (nada implícito ni silencioso).** PyNite conecta nudos colineales sin avisar (MOT-15). Además, `check_stability=False` devuelve NaN o 1e12 sin error y `local=False` en quads lanza `TypeError` (MOT-09, MOT-12).
6. **§14.3 (< 10 s para un modelo medio).** En Pyodide, y sin contar los ~4 s de arranque, solo se cumple hasta ~1 500 nudos con el driver propio y la extracción vectorizada. Con 4 810 nudos y 24 casos son ~33 s; con la API estándar, 928 nudos y 24 casos superan 60 s.
7. **§5.1 (densidad en kg/m³).** `add_member_self_weight` interpreta `rho` como peso específico (MOT-08).
8. **Nombre del paquete.** El encargo dice `PyNiteFEM`; el paquete real es `PyNiteFEA` (MOT-18).

## Preguntas abiertas (lo que no pudiste cerrar y cómo se cerraría)
1. **Rendimiento y memoria en navegadores reales** (Chrome, Firefox, Safari de escritorio; Safari iOS; Chrome Android). Node usa V8, como Chrome, pero JavaScriptCore y los límites de memoria móviles pueden diferir. Cierre: página de prueba con el mismo `pyodide_run` en un Worker, medida con `/browse` y en dispositivos reales durante la Fase 0.
2. **¿Cuánto pesa el error del drilling en edificios reales con muros, losas y torsión accidental?** ¿Basta con barras de borde o hay que parchear la formulación (Allman, Hughes–Brezzi)? Cierre: benchmark del área 5 frente a OOFEM con un núcleo de muros y forjados bajo torsión, variando el factor 1/1000.
3. **Convenio de signos de Mxy, Qx y Qy en quads con ejes no alineados**, y validez de la rotación tensorial en el centroide. Cierre: *patch tests* de placa (área 3/5) con solución de Timoshenko–Woinowsky-Krieger.
4. **Estabilidad de los internos que usa el driver propio entre 3.2.x y 3.3.** Cierre: fijar el hash del wheel y ejecutar la batería contractual en CI contra el HEAD de PyNite cada mes, como alerta.
5. **Cancelación cooperativa en un Worker de navegador.** ¿El `setTimeout(0)` del WebLoop de Pyodide deja pasar los `message` también en Safari? Cierre: el mismo `cancel_main` adaptado a un Worker del navegador.
6. **¿Merece la pena vectorizar `Quad3D.ke()` y FER, que suman ~70 % del tiempo restante?** Por ejemplo, con un ensamblado propio que reutilice `B_b/B_m` por elemento. Cierre: prototipo y medida; supone parchear más internos.
7. **Arranque con la caché del Service Worker** (descarga de ~30,5 MB solo la primera vez). Cierre: área 4, con Workbox `CacheFirst` y la ruta `/pyodide/` existente.

## Experimentos (qué ejecutaste, dónde están los scripts y su salida resumida)
Carpeta: `C:\Users\javie\AppData\Local\Temp\claude\d--PROGRAMACION-Concreta-EST\b287d96a-8882-4d7d-800f-3c46ec2b77b4\scratchpad\fem3d\01-motor\`.

Entorno:
- CPython 3.14.7 en `venv/`, con PyNiteFEA 3.2.0, numpy 2.5.3, scipy 1.18.1 y psutil.
- Pyodide 314.0.0 en `pyodide-dist/`: núcleo copiado de `node_modules/pyodide` del worktree; numpy 2.4.3 y scipy 1.17.1 bajados del CDN pinneado, con sha256 coincidentes con el lock.
- Node 24.19.0.
- Fuente: el wheel en `src320/` y el repositorio en `pynite-src/` (HEAD 4afc9f1, etiqueta 3.2.0 = e98dfc8).

| Script | Qué hace | Salida (resumen) |
|---|---|---|
| `modelo.py` | Generador de edificios nx×ny×plantas (pilares, vigas entre nudos consecutivos, losa de quads, casos G/Q/W + ELU); opción Y-up | — |
| `exp_a_minimo.py [--yup]` | Pórtico 2 plantas + losa: equilibrio, superposición y las 6 + 8 componentes | `out_exp_a_zup.txt`, `out_exp_a_yup.txt`: err 6,7e-15; superposición ≤ 3,3e-12 |
| `exp_ejes.py`, `exp_ejes_signo.py` | Ejes por defecto, ángulo `rotation` desde un vector de referencia, doble liberación de torsión | Error 1,2e-16; inversión de 180° con ±1e-9; `LinAlgError` |
| `exp_singular.py` | Nudo suelto, mecanismo, sin apoyos, celosía, quad aislado, torsor pilar–losa | `out_exp_singular.txt` (MOT-12, MOT-06) |
| `exp_scaling.py` | `analyze_linear` por fases, 171 → 4 810 nudos, sparse/denso | `out_scaling_cpython_*.txt`, `out_scaling_pyodide_*.txt` (MOT-03) |
| `pynite_fast.py` + `exp_fast.py` | Driver propio (`splu` + RHS múltiple + FER selectivo + O(N)) comparado con `analyze_linear` | `out_fast2_cpython.txt`, `out_fast_pyodide.txt`: dif. 2e-13; 4 810 nudos / 24 casos: 10,3 s CPython, 23,6 s Pyodide |
| `exp_results.py` | Extracción por la API frente a operador lineal (quads) y esfuerzos de extremo (barras) | `out_results_cpython.txt`, `out_results_pyodide.txt`, `out_results_pyodide_4810_fast.txt` (MOT-04) |
| `exp_signos.py` | 6 casos de solución conocida; `local=False` | `out_exp_signos.txt`, `out_pyodide_signos.txt` (MOT-09, MOT-10) |
| `exp_drilling.py` | ΣM vertical frente a momento absorbido por el drilling | `out_exp_drilling.txt`: 0,71 % |
| `exp_muro.py` | Muro en voladizo: equilibrio y flecha frente a Timoshenko | `out_exp_muro.txt`: 0,935 / 0,980 / 0,992 |
| `exp_autosplit.py` | Conexión implícita de nudos colineales | `out_exp_autosplit.txt` |
| `exp_modal.py` | `analyze_modal` en CPython y Pyodide | `out_exp_modal.txt`: mismas frecuencias |
| `exp_version.py` | Versiones en Pyodide | `out_exp_version.txt` |
| `pyodide_run.mjs` | Runner Node: modos `boot`, `minimo`, `scaling`, `script`, `nostubs`, `noscipy`, `memmax` (con `PYNITE_DIR=src320_noscipy` usa la copia con scipy perezoso) | `out_pyodide_*.txt`, `out_pyodide_modes.txt` |
| `pyodide_micropip.mjs` | `micropip.install('PyNiteFEA==3.2.0')` con dependencias | `out_pyodide_micropip.txt` |
| `cancel_main.mjs` + `cancel_worker.mjs` | Cancelación síncrona, cooperativa y `terminate`; memoria en repeticiones | `out_cancel.txt` |

Cifras clave de tamaño, medidas en `pyodide-dist/`:
- `pyodide.asm.wasm`: 9,61 MB (3,54 MB en gzip);
- `python_stdlib.zip`: 2,55 MB;
- `pyodide.asm.mjs`: 1,25 MB;
- numpy: 2,91 MB;
- scipy: 14,03 MB;
- total ≈ 30,5 MB (≈ 23 MB si el servidor comprime el wasm);
- PyNite vendorizado: 126 kB en gzip;
- matplotlib con sus dependencias, que se evita: 10,3 MB.

## Fuentes
- PyNite 3.2.0: wheel `pynitefea-3.2.0-py3-none-any.whl` (PyPI), leído en `src320/Pynite/*.py`. Repositorio https://github.com/JWock82/Pynite (etiqueta `3.2.0` = e98dfc8, HEAD 4afc9f1 de 2026-09-28): `README.md` (sección «What's New» 2.0–3.2.0), `docs/source/member.rst`, `docs/source/plate.rst`, `LICENSE` (MIT).
- PyPI JSON: https://pypi.org/pypi/PyNiteFEA/json, https://pypi.org/pypi/PyNiteFEM/json (404), https://pypi.org/pypi/pynite/json (otro proyecto).
- Issues: https://github.com/JWock82/Pynite/issues/102 (estática con quads y drilling), /251 y /269 (rendimiento), /292 (MPC), /250 y /341 (Timoshenko), /255, /275 y /320 (detección de inestabilidad, cambios de la 3.1.0).
- Pyodide 314.0.0: `node_modules/pyodide/pyodide-lock.json` y `pyodide.d.ts` del worktree; CDN https://cdn.jsdelivr.net/pyodide/v314.0.0/full/; https://pyodide.org/en/stable/usage/keyboard-interrupts.html.
- GitHub Pages y cabeceras: https://github.com/orgs/community/discussions/13309; coi-serviceworker https://github.com/gzuidhof/coi-serviceworker.
- Formulación DKMQ: Katili, «A Comparative Formulation of DKMQ, DSQ and MITC4 Quadrilateral Plate Elements…», y Katili, Batoz, Maknun y Hamdouni (2015); Bathe, *Finite Element Procedures*, 2.ª ed. (ej. 4.19 drilling y ej. 5.5 membrana), citados en `Quad3D.py:1-3, 217, 460, 565`.
- Precedente en Concreta: `docs/geotecnia-taludes-pyslope.md`, `scripts/fetch-pyodide-assets.mjs`, `src/lib/calculations/geotech/pyslope.worker.ts`, `client.ts`, `vite.config.ts:102-178`.
