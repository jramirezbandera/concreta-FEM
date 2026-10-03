> **Informe original del Área 5 — Validación**, generado por un subagente el 2026-10-03.
> El documento consolidado es `../investigacion-id.md`; esto es el detalle con toda la evidencia.
> Los scripts y salidas citados están ahora en `experimentos/05-validacion/`; las rutas absolutas
> del texto apuntan a la carpeta temporal de la sesión que los ejecutó.

# Área 5 — Validación: benchmarks, oráculos, tolerancias y precisión real de PyNite

## Resumen (≤ 10 líneas)

- PyNiteFEA 3.2.0 (en PyPI no existe «PyNiteFEM»): unos 200 modelos medidos en CPython, con contraste en Pyodide 314.0.0 y OpenSeesPy 3.8.0.
- Barras exactas (≤ 1e-11 frente a soluciones cerradas), pero sin cortante ni offsets. La flexión de placa del `Quad3D` (DKMQ) converge con orden 2, no bloquea y pasa los patch tests: 8×8 por vano da w ≤ 0,1 % y M ≈ 1 %.
- Fallos que condicionan el plan:
  - el taladro es un muelle a tierra: una viga unida en el plano de un muro queda articulada (1 205× la flecha) y el 48 % del momento sale del equilibrio, sin error;
  - la membrana Q4 bloquea: un muro con 1 elemento por planta es un 32 % demasiado rígido;
  - Qx/Qy de losa se infravaloran un 30–50 %;
  - `Plate3D` está mal (Mxy, signo, geometría) y no hay triángulos;
  - la salida global de los quads falla con numpy ≥ 2.4.
- Lo útil: pruebas metamórficas (1e-12…1e-15), equilibrio de momentos como diagnóstico y OpenSeesPy o Kratos como oráculo en lugar de OOFEM.

## Hallazgos

### VAL-01 · Una viga unida en un solo nudo a un muro, en el plano del muro, queda prácticamente articulada: 1 205× la flecha de empotramiento, sin error ni aviso
- **Soporte:** A — experimento `exp07_conexion.py` y código `Quad3D.py:565-621` (PyNite 3.2.0).
- **Prioridad:** P0
- **Afecta a:** §7.2, §23.10–11 — **contradice** que basten «nudos comunes» para conectar barras y láminas, y que «nunca se degradará silenciosamente» una unión (§9.2).
- **Hallazgo:**
  - **Causa.** `Quad3D` y `Plate3D` no tienen grado de libertad de taladro real. Ponen un muelle de valor `min(diag. rotacional)/1000` sólo en la diagonal local RZ (`ke_exp[5,5] = ke_rz`, `Quad3D.py:618-621`). Es un resorte **a tierra**: no se acopla con las traslaciones. Por eso el giro nodal alrededor de la normal no sigue al giro de la lámina en su plano.
  - **Ensayo.** Muro de 3×3 m y 25 cm, empotrado en la base. Viga de 30×50 en voladizo de 3 m desde su borde, en el mismo plano, con 50 kN en punta.

    | Unión | Flecha en punta | Giro del nudo | Momento en la raíz |
    |---|---|---|---|
    | 1 nudo, malla 6×6 | 5 786 mm (1 205× ref.) | 1,93 rad | 150 kN·m |
    | 1 nudo, malla 12×12 | 8 222 mm (1 713× ref.) | — | — |
    | Viga embebida a lo largo de una fila de nudos del muro | 1,30–1,32× ref. | — | — |

    La referencia es la viga empotrada, 4,80 mm. Al refinar la malla la unión de 1 nudo empeora, porque el muelle se debilita.
  - **El cálculo no protesta.** `_check_stability` sólo mira diagonales nulas. El control de residuo de `_solve_unknown_disp` pasa porque K no es singular.
  - **Efecto lateral.** En un forjado los nudos no giran alrededor de la vertical con la planta: los pilares del modelo mixto de EXP-11b salen con torsión exactamente 0.
- **Evidencia:**
  - `out_exp07.txt`, `out_exp11b.txt`.
  - Docstring de `Quad3D` («Minor errors are introduced into the solution due to the drilling approximation»).
  - Issue #102 «Model Fails Statics Checks», abierto desde 2021-09-27 con la etiqueta *program limitation* (https://github.com/JWock82/Pynite/issues/102).
- **Recomendación:**
  - El compilador (§7.2) nunca debe conectar una barra a una lámina sólo por un nudo cuando el momento entra en el giro de taladro (vigas en el plano de muros, dinteles, vigas de acoplamiento). Hay dos opciones:
    - embeber la barra a lo largo de una fila de nudos de la lámina (al menos el canto de la viga o un elemento);
    - o rechazarlo con un diagnóstico.
  - Añadir un benchmark «viga en el plano del muro» a la batería de nivel 2.
  - Documentar que la torsión de pilares por giro de planta no se modela.

### VAL-02 · La membrana del `Quad3D` bloquea a flexión en el plano: un muro con 1 elemento por planta es un 32 % demasiado rígido; hacen falta ≥ 8 elementos a lo largo del muro
- **Soporte:** A — `exp02_membrana.py` y `exp08_opensees.py`; código `Quad3D.py:450-465, 635-668` (Q4 isoparamétrico con 2×2 puntos de Gauss, sin modos incompatibles).
- **Prioridad:** P0
- **Afecta a:** §7.3, §23.2 y §23.10 — **corrige**. El tamaño de malla de los muros no puede ser libre, y `targetSize` debe depender de la longitud del muro.
- **Hallazgo:**
  - **Viga recta de MacNeal–Harder** (malla 6×1, cortante en el plano, normalizado a 0,1081): 0,093 rectangular, 0,027 trapezoidal y 0,034 en paralelogramo. Extensión y flexión fuera del plano salen bien: 0,995 y 0,987.
  - **Muro en voladizo de 3 plantas** (H = 9 m, B = 3 m, 25 cm), frente a la viga de Timoshenko:

    | Malla | Error |
    |---|---|
    | 1×3 | −32,1 % |
    | 2×6 | −11,7 % |
    | 4×12 | −3,6 % |
    | 8×24 | −1,2 % |
    | 16×48 | −0,5 % |

    Richardson da p = 1,89 y el extrapolado queda a −0,28 % de Timoshenko.
  - **Muro bajo** (3×3 m): 1×1 −35 %, 4×4 −5,8 %, 8×8 −1,8 %.
  - **Comparación con OpenSees** (mismo muro de 3 plantas):

    | Elemento | 1×3 | 4×12 | Viga de MacNeal–Harder |
    |---|---|---|---|
    | `ShellDKGQ` | −7,4 % | −0,9 % | 0,904 |
    | `ASDShellQ4` | −3,8 % | −0,9 % | 0,987 |

    Ambos tienen membrana con taladro.
  - **Consecuencia en un edificio:** muros demasiado rígidos atraen más cortante horizontal y descargan los pórticos.
- **Evidencia:** `out_exp02.txt`, `out_exp08.txt`.
- **Recomendación:**
  - Mínimo de 8 elementos a lo largo de cada paño de muro y relación de aspecto ≤ 2.
  - Diagnóstico de §16 si no se cumple.
  - Incluir la viga de MacNeal–Harder y el muro 1×3 como pruebas de regresión que fijen el comportamiento (y su error) del motor.

### VAL-03 · Los cortantes Qx/Qy del `Quad3D` infravaloran el exacto un 30–50 % con mallas habituales de losa; sólo convergen cuando el elemento es más pequeño que el espesor
- **Soporte:** A — `exp01_placas.py`, `exp01b_cortante_signos.py` y `exp01d_cortante_losa.py`; código `Quad3D.py:1017-1072` (Q = Hs·B_s·d con el factor φ/(1+φ) del DKMQ).
- **Prioridad:** P0
- **Afecta a:** §2.1, §13.2 y §23.3 — **contradice** que Qx y Qy sean «resultado primario» utilizable para comprobaciones (cortante y punzonamiento del CE).
- **Hallazgo:** losa apoyada (ν = 0,2), Qx en el centroide de elementos a x ≈ 0 y a x ≈ a/4, frente a Navier.

  | a/t | 16×16 | 32×32 |
  |---|---|---|
  | 10 | −4 % / −7 % | −1 % / −2 % |
  | 25 | −17 % / −28 % | −6 % / −10 % |
  | 40 | −26 % / −42 % | −13 % / −21 % |
  | 100 | −35 % / −57 % | −28 % / −46 % |

  - El error depende de h/t. Una losa de 25 cm mallada a 0,5 m (h/t = 2) queda entre −30 % y −50 %, siempre del lado inseguro.
  - El Qx extrapolado al borde de una placa delgada vale 0,235 frente a 0,337 con 32×32.
  - `Plate3D` da +2,5…+4 %, pero no converge (VAL-06).
- **Evidencia:**
  - `out_exp01_A.txt` (columna Qx_borde) y `out_exp01d.txt`.
  - Referencia Qx(0, a/2) = 0,3374·q·a, serie propia (`refs.py`), que coincide con 0,338 de T&WK, Tabla 8.
- **Recomendación:**
  - No usar `shear()` de PyNite como dato de comprobación. Hay dos alternativas:
    - recuperar Q por equilibrio en Concreta, a partir de las derivadas de M sobre parches de elementos;
    - o usar fuerzas nodales y reacciones en las líneas de apoyo.
  - Hasta validar una de ellas, marcar Qx/Qy como «sólo visualización» en el `ResultModel` y excluirlos de los extractores de §13.

### VAL-04 · El equilibrio de fuerzas se cumple a 1e-13, pero el de momentos falla en cuanto el taladro trabaja; el umbral de 1e-8 de §18.2 sólo vale para modelos sin taladro
- **Soporte:** A — `exp11_equilibrio.py`, `exp06_metamorficas.py` y `exp05_barras.py`.
- **Prioridad:** P0
- **Afecta a:** §18.2 (primer punto) y §16 — **corrige**.
- **Hallazgo:** se mide |ΣF| y |ΣM| (respecto al origen) de reacciones más cargas.

  | Modelo | |ΣF| relativo | |ΣM| relativo |
  |---|---|---|
  | Modelos sin taladro activo (pórtico espacial, losa con pilares) | 8e-15 … 1,5e-11 | 3,5e-13 … 1,5e-11 |
  | Muro en L (quads no coplanarios) | 9,5e-14 | **3,5e-5** |
  | Viga embebida en muro | 1,4e-13 | **1,4e-4** |
  | Viga unida en 1 nudo | 6e-15 | **0,49** |

  La causa son los muelles a tierra de VAL-01. Es el mismo síntoma del issue #102.
  - Los solvers 2D y 1D actuales de Concreta (`solver2d.ts:117,277-283`, `femSolver.ts:196-203`) sólo comprueban fuerzas, con una tolerancia de 1e-3.
- **Evidencia:** `out_exp11.txt`, `out_exp11b.txt`, `out_exp06.txt`, `out_exp05.txt`.
- **Recomendación:**
  - Calcular en cada caso el residuo de fuerzas **y de momentos** respecto a un punto, relativo a Σ|F| y a Σ|F|·L.
  - Error si el residuo de fuerzas supera 1e-9. Aviso de «momento absorbido por taladro» si el de momentos supera 1e-6, señalando los nudos con mayor RZ·k_drill.
  - Tolerancias por magnitud a partir de lo medido:
    - equilibrio y pruebas metamórficas: 1e-9;
    - barras frente a solución cerrada: 1e-6 (la propuesta de §18.2 de 0,1 % y 0,5 % es 1e8 veces más laxa de lo necesario y escondería errores de signo pequeños);
    - láminas: según la tabla de VAL-05;
    - referencias congeladas: 1e-9 (VAL-13).

### VAL-05 · La flexión DKMQ del `Quad3D` converge con orden ≈ 2, sin bloqueo y pasa los patch tests; 8×8 por vano da w ≤ 0,1 % y M ≤ 1,1 % en losa apoyada, pero las empotradas piden 16×16
- **Soporte:** A — `exp01_placas.py` (casos A–F), `exp10_patch.py` y `exp08_opensees.py`.
- **Prioridad:** P1
- **Afecta a:** §23.1–2 — **confirma** `Quad3D` como único elemento de lámina y **añade** densidades mínimas.
- **Hallazgo:** placa cuadrada con q uniforme y ν = 0,3. Referencias: Navier α = 0,00406235 y β = 0,0478864; Mindlin exacto para placas apoyadas, w_M = w_K + M_K/(κGh); empotrada α = 0,00126532, β_c = 0,0229051, β_borde = −0,0513338.

  | Caso | 4×4 | 8×8 | 16×16 | 32×32 | p obs. |
  |---|---|---|---|---|---|
  | Apoyada a/t = 100, w | −0,42 % | −0,07 % | −0,03 % | −0,01 % | 1,99 |
  | ídem, M centro (media nodal) | +4,7 % | +1,1 % | +0,32 % | +0,11 % | 1,96 |
  | ídem, M en centroide frente a M exacto allí | −7,6 % | −1,7 % | −0,43 % | −0,11 % | 2 |
  | Empotrada a/t = 100, w | +15,6 % | +4,5 % | +1,3 % | +0,46 % | 1,97 |
  | ídem, M centro | +26 % | +6,3 % | +1,7 % | +0,48 % | 1,99 |
  | ídem, M centro de borde | −5,3 % | −1,2 % | −0,3 % | −0,04 % | — |
  | Gruesa a/t = 10 frente a Mindlin, w | −1,0 % | −0,41 % | −0,13 % | −0,04 % | 1,5 |
  | a/t = 10 000 (bloqueo), w | −0,41 % | −0,06 % | −0,01 % | −0,003 % | 2,3 |

  - Mxy en la esquina: −0,0323 frente a −0,0325.
  - Los patch tests de MacNeal–Harder pasan. En membrana, error de desplazamientos 1e-16 y de tensiones 2,5e-10. En flexión, w 9e-16, giros 2e-14 y momentos 5e-13 (los resultados hay que girarlos a ejes globales, VAL-07).
  - OpenSees `ShellDKGQ` en la misma placa da w −0,058 % con 8×8, el mismo orden que PyNite.
  - Con a/t = 100 la diferencia de Mindlin frente a Kirchhoff es de +0,05 %. Con a/t = 10 es de +5,2 %, y `Quad3D` la reproduce.
- **Evidencia:** `out_exp01_A.txt`, `out_exp01_BCDEF.txt`, `out_exp10.txt`, `out_exp08.txt`, `refs.py`.
- **Recomendación:**
  - Densidad mínima por defecto: 8 elementos por vano entre apoyos. Para momentos de empotramiento o negativos sobre apoyo y para las flechas de losas empotradas, 16 elementos por vano.
  - Tolerancias de benchmark: apoyada 16×16, w ≤ 0,1 % y M ≤ 0,5 %; empotrada 16×16, w ≤ 1,5 %, M_c ≤ 2 % y M_borde ≤ 0,5 %.
  - Usar el resultado en centroide (convergencia O(h²) en su propio punto) como dato de comprobación. La media nodal sólo para representación (§12.1).

### VAL-06 · `Plate3D` no es apto y no hay triángulos: rectángulo sin comprobar (10 veces la flecha en Morley, sin aviso), Mxy multiplicado por 1/(1−ν²), signo opuesto a `Quad3D` y teoría de Kirchhoff; `Tri3D` es una copia sin conectar
- **Soporte:** A — `exp04_esviada.py` y `exp01_placas.py`; código `Plate3D.py:77-87, 129-131, 607-609`; `Tri3D.py` no se importa en ningún módulo (`grep Tri3D`).
- **Prioridad:** P1
- **Afecta a:** §7.3 («el MVP puede utilizar triángulos»), §9.2 y §23.2 — **contradice**.
- **Hallazgo:**
  1. **No comprueba la geometría.** `Plate3D` calcula anchura y altura como distancias i→j e i→n, y trata cualquier cuadrilátero como rectángulo. En la placa de Morley (rombo de 30°) da w_c = 40,7·10⁻⁴ frente a 4,08·10⁻⁴: unas 10 veces la referencia (+897 %), sin aviso. El 4,455 que aparece en `exp04_esviada.py` era una referencia errónea mía; la corrección está en VAL-18.
  2. **Mxy mal calculado.** `Db` divide el término de torsión por (1−ν²) (`Plate3D.py:129-131`, comparar con `Dm`, l. 110). Mxy sale ×1/(1−ν²): +9,9 % con ν = 0,3 y +4,2 % con ν = 0,2. Medido en la esquina: 0,0357 frente a 0,0325 (+10 %), y no converge al refinar. Los cortantes, derivados de Db, arrastran +2,5–4 %.
  3. **Signo invertido.** Todos los momentos de `Plate3D` tienen signo contrario a los de `Quad3D` con la misma carga (−0,0489 frente a +0,0484), aunque el comentario del código diga que coinciden (l. 607-608).
  4. **Sin cortante.** Es Kirchhoff: −4,9 % frente a Mindlin con a/t = 10.
  5. **No hay triángulos.** `Tri3D.py` es una copia de `Plate3D` que nadie importa (issue #267). PyNite 3.2.0 no tiene ningún triángulo utilizable.
- **Evidencia:** `out_exp04.txt` y `out_exp01_*.txt` (columna Mxy_esq).
- **Recomendación:**
  - El adaptador sólo emitirá `Quad3D`, y `supports()` rechazará `ShellElement` de 3 nudos con un diagnóstico explícito.
  - El mallador de §7.3 tiene que ser sólo de cuadriláteros (con pavimentación o transición quad-dominante y sin triángulos). Eso condiciona el mallado de huecos y contornos irregulares: hay que coordinarlo con el área 2.
  - Si en el futuro se usa `Plate3D`, corregir `Db` y el signo en un fork auditado.

### VAL-07 · Los resultados del `Quad3D` están en los ejes de cada elemento (x de i a j), `membrane()` da tensiones y no esfuerzos, y la salida global falla con numpy 2.4.3 y 2.5.3 (y además su fórmula es errónea)
- **Soporte:** A — `exp01c_global.py` y `exp10_patch.py`; código `Quad3D.py:884-950` (T), 1068-1093, 1147-1177 y 1180-1239.
- **Prioridad:** P1
- **Afecta a:** §5.2, §8 (`ShellElement.localXAxis`), §12 (`ShellResultBlock`) y §23.3 — **corrige**.
- **Hallazgo:**
  - **Ejes locales.** El eje x local es i→j y z = x × (i→n). Con mallas irregulares cada elemento tiene su propio x. Sin girar los tensores, el patch test de membrana parece fallar (1 390/1 276/396 frente a 1 333/1 333/400 en el elemento interior). Girándolos a ejes globales el error es de 2,5e-10.
  - **Unidades.** `moment()` y `shear()` devuelven valores por unidad de longitud. `membrane()` devuelve **tensiones** Sx, Sy, Txy, porque Cm no lleva t: Nx = t·Sx.
  - **Convenio.** Mx = −D(w,xx + ν·w,yy) y Mxy = −D(1−ν)·w,xy con w según +z local. Un M positivo tracciona la cara +z. En una losa con z hacia arriba, el momento de vano bajo gravedad sale negativo.
  - **Salida global rota.** `moment/shear/membrane(local=False)` lanza `TypeError: only 0-dimensional arrays can be converted to Python scalars` con numpy 2.4.3, la versión de Pyodide 314, y con 2.5.3. PyNite exige numpy ≥ 2.4. Aun sin ese error, la fórmula está mal: calcula R·M·Rᵀ (gira −θ) e invierte My (l. 1160, 1168). El «cortante global» no es una transformación vectorial (l. 1081-1093).
  - **Puntos de evaluación.** Los valores en (ξ, η) son extrapolación bilineal desde los 2×2 puntos de Gauss.
- **Evidencia:** `out_exp01c.txt`, `out_exp10.txt`; issues #192 y #198 (cerrados) sobre resultados globales y quads esviados.
- **Recomendación:**
  - El adaptador pedirá siempre `local=True`.
  - Girará los tensores de membrana, flexión y cortante con `T()` a los ejes `localXAxis` de Concreta en TypeScript (§9.1, conversión explícita) y multiplicará la membrana por t.
  - Una prueba de contrato debe exigir que el patch test con elementos girados pase a 1e-9.

### VAL-08 · `Member3D` reproduce las soluciones cerradas a ≤ 1e-11, pero es Euler-Bernoulli sin offsets y el axil de tracción sale negativo
- **Soporte:** A — `exp05_barras.py`; código `Member3D.py:176-207` (matriz sin término φ de cortante).
- **Prioridad:** P1
- **Afecta a:** §10.1, §18.1 (nivel 2), §18.2 y §20 («offsets» en evolución) — **confirma con matices**.
- **Hallazgo:**
  - **Ensayos frente a solución cerrada:**

    | Caso | Error |
    |---|---|
    | Voladizo 3D (δy, δz, δx, φx y momentos) | ≤ 5e-16 |
    | Biapoyada con carga uniforme (M y δ en el centro, M en 7 estaciones) | 0 |
    | Pórtico espacial 1×1 vano, k = 0,1/1/10 frente a la fórmula de pendiente-desplazamiento | 4e-6 … 1,5e-5 (por EA finito) |
    | Voladizo en L, flexión + torsión | 1e-12 |
    | Trípode articulado | 5e-16 |

  - **Sin deformación por cortante.** Su ausencia supone esta parte de la flecha en una viga biempotrada de 30×60 con carga centrada:

    | L/h | Parte de la flecha no vista |
    |---|---|
    | 2 | 74 % |
    | 4 | 42 % |
    | 8 | 15 % |
    | 20 | 3 % |

    La rama `shear_deformation` (PR #289) no está en main. El PR #341 (abierto, 2026-09-25) muestra que `deflection()` entre nudos omite el término de cortante.
  - **Convenio de signos de barra en PyNite:**
    - axil de tracción **negativo** (issue #271), al contrario que el «N tracción +» del FEM 2D de Concreta (`src/test/fem2d/solver2d.test.ts:9-10`);
    - Mz en el vano de una biapoyada con gravedad: −45 kN·m.
- **Evidencia:** `out_exp05.txt`; https://pynite.readthedocs.io/en/latest/member.html («Transverse shear deformations are not currently considered»).
- **Recomendación:**
  - Tolerancia de barras frente a solución cerrada: 1e-6.
  - En comparaciones con SAP2000 o CYPE, desactivar sus áreas de cortante o declarar la diferencia esperada caso a caso (§18.2, último punto).
  - Diagnóstico para barras con L/h < 6 (vigas de acoplamiento, vigas de gran canto).
  - Pruebas de signo en las fronteras (N, V, T, M) antes de conectar ningún extractor.

### VAL-09 · La orientación por defecto de las barras depende de `math.isclose` sin tolerancia absoluta: un ruido de 1e-12 en un pilar sobre la coordenada 0 gira sus ejes 90°; con orientación explícita el modelo es invariante a 1e-12
- **Soporte:** A — `exp05_barras.py` (caso 6) y `exp06_metamorficas.py` (M1); código `Member3D.py:3, 959-1000`.
- **Prioridad:** P1
- **Afecta a:** §5.2 («nunca se inferirá silenciosamente una orientación ambigua») y §23.6 — **confirma el riesgo y lo concreta**.
- **Hallazgo:**
  - **Regla de PyNite.** Decide los ejes locales con Y global vertical y `isclose(Xi, Xj) and isclose(Zi, Zj)` de `math`, que sólo tiene tolerancia relativa.
  - **Ensayo.** Pilar de 30×40, 3 m, 10 kN en X. Ruido de 1e-12 en Z de cabeza con base en Z = 0: los ejes locales giran 90° y la flecha pasa de 3,333 mm a 1,875 mm (Iy e Iz intercambiados). El mismo ruido en X no cambia nada.
  - **Prueba metamórfica.** Rotación y traslación rígidas de un modelo de 4 pilares más losa:
    - dejando que PyNite oriente las barras: el desplazamiento difiere un 13–75 % y los esfuerzos un 31–99 %;
    - calculando `rotation` a partir de `member.T()` para llevar el y local por defecto al vector de referencia deseado (`orient_member`): 7,8e-13 en desplazamientos y 1,1e-13 en esfuerzos.
  - **Antecedente.** El issue #284 recoge que las barras giradas daban esfuerzos erróneos desde la 1.0.0 hasta la 1.5.0.
- **Evidencia:** `out_exp05.txt` y `out_exp06.txt`.
- **Recomendación:**
  - El adaptador no dependerá nunca de la orientación por defecto. Tras `add_member` leerá `T()`, calculará el ángulo hasta `localYAxis` (§8) y fijará `rotation`. Después comprobará que `T()[1]` coincide con el vector pedido a 1e-12.
  - Prueba metamórfica de rotación del modelo completo, con secciones rectangulares, en la batería contractual.

### VAL-10 · Las pruebas metamórficas son oráculos exactos y baratos con PyNite: rotación más traslación 1e-12, renumeración 6e-14, superposición 5e-16 y Maxwell–Betti 7e-15
- **Soporte:** A — `exp06_metamorficas.py` y `exp06b_solido_rigido.py`.
- **Prioridad:** P1
- **Afecta a:** §18.1 (nivel 3, cuerpo rígido) y §18.3 — **añade**.
- **Hallazgo:** en el modelo mixto (4 pilares de 30×50 y losa de 6×4 m de 25 cm con 24 quads):

  | Prueba | Diferencia relativa |
  |---|---|
  | Rotación + traslación (con VAL-09) | 1e-13 … 8e-13 |
  | Barajar el orden de nudos y elementos | 3e-14 … 6e-14 |
  | 1,35·G + 1,5·H frente a la combinación | 4,7e-16 |
  | Maxwell–Betti en losa | 6,9e-15 |
  | Equilibrio de fuerzas (caso G) | 8e-15 |

  - **Sólido rígido de un quad aislado.** Traslaciones ≤ 1e-16. El giro alrededor de la normal da fuerza espuria de 2,6e-6, por el taladro. Con alabeo del 1 % del lado, los giros en el plano dan 2,3e-3, y con el 10 % llegan a 2,2e-2 (VAL-11). K es simétrica a 1e-16.
- **Evidencia:** `out_exp06.txt` y `out_exp06b.txt`.
- **Recomendación:**
  - Batería metamórfica obligatoria sobre cada modelo de regresión de nivel 5: rotación y traslación aleatoria con semilla fija, renumeración, superposición y reciprocidad, con tolerancia de 1e-9.
  - Ejecutarla también en el `MockSolverAdapter` como prueba contractual.
  - Es la forma de validar edificios sin referencia exacta.

### VAL-11 · PyNite acepta elementos con jacobiano negativo (sólo un `UserWarning`) y quads alabeados sin aviso: con distorsión de 0,4h el resultado sale un 60 % mal
- **Soporte:** A — `exp01_placas.py` (caso F) y `exp06b_solido_rigido.py`; código `Quad3D.py:661-662` (el aviso sólo está en `ke_m`) y 107-141 frente a 884-931 (plano de i, j, m frente a i, j, n).
- **Prioridad:** P1
- **Afecta a:** §7.3 («una malla inválida… será un error») — **confirma** que la validación tiene que hacerla Concreta.
- **Hallazgo:**
  - **Distorsión aleatoria de 0,2h** en los nudos interiores (placa apoyada): w −0,19 % y M +1,27 % con 8×8; p ≈ 1,6 para w y 1,2 para M.
  - **Distorsión de 0,4h:** con 32×32 aparecen 4 elementos con jacobiano ≤ 0. PyNite emite un aviso de Python y devuelve w −60,6 % y M −55 %.
  - **Alabeo.** No hay corrección ni aviso. Los planos locales de `_local_coords` (i, j, m) y de `T()` (i, j, n) son distintos.
- **Evidencia:** `out_exp01_BCDEF.txt` (caso F) y `out_exp06b.txt`.
- **Recomendación:**
  - El mallador o validador de Concreta calculará el jacobiano en los 4 puntos de Gauss, con error si es ≤ 0, y métricas de calidad: relación de aspecto, ángulo interior entre 45° y 135° y alabeo relativo.
  - Error si el alabeo supera 1e-3 del lado y aviso por encima de 1e-4.
  - No pasar nunca a PyNite un elemento que dependa de sus `warnings`.

### VAL-12 · Una conexión puntual de viga perpendicular a una lámina (pilar a losa, viga a muro) tiene un giro que crece al refinar la malla: no converge
- **Soporte:** A — `exp07b_perp_malla.py`.
- **Prioridad:** P1
- **Afecta a:** §7.2, §23.11 y §20 («zonas rígidas» en evolución) — **corrige**. La zona rígida no puede esperar a después del MVP.
- **Hallazgo:**
  - **Ensayo.** Viga de 30×50 perpendicular a un muro de 25 cm, unida en un nudo; el momento entra por flexión de placa. Flecha en punta frente a empotramiento rígido:

    | Tamaño de malla | Flecha / empotramiento | Giro del nudo |
    |---|---|---|
    | 0,5 m | 2,88× | 3,0e-3 rad |
    | 0,25 m | 3,17× | — |
    | 0,125 m | 3,53× | 4,0e-3 rad |

    Es una singularidad logarítmica de momento puntual en una placa, así que no converge.
  - **Sin enlaces rígidos.** PyNite no tiene restricciones multipunto ni enlaces rígidos ni offsets (verificado: no hay `offset` en `Member3D.py`; discusión #261, donde el autor recomienda «spread the column load with stiff members»).
- **Evidencia:** `out_exp07b.txt`.
- **Recomendación:**
  - El compilador generará una «zona rígida» en el ancho y el canto de la sección: barras muy rígidas o nudos esclavos en estrella sobre los nudos de la lámina dentro de la huella del pilar o de la viga.
  - Validar el valor de rigidez (penalización frente a condicionamiento) con un benchmark propio de unión pilar-losa con malla de 0,5, 0,25 y 0,125 m. Criterio: variación inferior al 5 % entre mallas.

### VAL-13 · Los resultados son bit a bit idénticos entre entornos CPython, pero Pyodide 314 difiere hasta 6e-13: las referencias congeladas necesitan tolerancia, no hash
- **Soporte:** A — `exp09_determinismo.py` y `pyo/run_det.mjs`.
- **Prioridad:** P1
- **Afecta a:** §9.1, §17, §18.3 y ADR-009 — **añade**.
- **Hallazgo:**
  - **Entre entornos CPython.** CPython 3.14.7 con numpy 2.5.3 y scipy 1.18.1, CPython 3.14.7 con numpy 2.4.3 y scipy 1.17.1, y CPython 3.12.15 dan los mismos 17 dígitos en una placa de 16×16 y en el modelo mixto.
  - **Pyodide.** Pyodide 314.0.0 (Node 24, numpy 2.4.3 y scipy 1.17.1 de su lock) difiere en los últimos dígitos: 5e-17 en un desplazamiento del modelo mixto, 1e-14 en un axil y 5,6e-13 en w y Mx de la placa. Es estable entre ejecuciones.
  - **Importación.** PyNite 3.2.0 importa matplotlib (`ShearWall.py:10-11`) y prettytable (`Analysis.py:1331`) al cargar. Con módulos stub funciona en Pyodide sin esas dependencias.
  - **Tiempos medidos:**

    | Paso | Pyodide | CPython |
    |---|---|---|
    | Carga de numpy y scipy | 2,9–4,4 s | — |
    | Instalación de la rueda | 0,4 s | — |
    | Cálculo (placa 16×16 + modelo mixto) | 4,7–5,5 s | 2,6 s en total |

  - **Nombre del paquete.** En PyPI se llama **PyNiteFEA**; «PyNiteFEM» no existe (HTTP 404).
- **Evidencia:** `out_exp09.txt`, `out_exp09b_pyodide.txt`; https://pypi.org/pypi/PyNiteFEA/json.
- **Recomendación:**
  - Congelar las referencias del motor con su huella de entorno: PyNiteFEA, Pyodide, numpy, scipy y el hash del vendor.
  - Compararlas con una tolerancia relativa de 1e-9 (o absoluta escalada a la magnitud máxima del campo). Nunca por hash de resultados.
  - El fingerprint de ADR-009 debe identificar el modelo y la versión, no el resultado numérico.

### VAL-14 · OpenSeesPy 3.8.0 sirve como oráculo FEM independiente en Windows en minutos, pero sólo con Python 3.12
- **Soporte:** A — `exp08_opensees.py` (venv con Python 3.12.15 vía `uv`).
- **Prioridad:** P1
- **Afecta a:** §10.2 y §10.3 (paso 4) — **corrige**: OOFEM no es la referencia más práctica (véase VAL-20).
- **Hallazgo:**
  - **Instalación.** `pip install openseespy` se instala en Python 3.14 pero falla al importar: `opensees.pyd` está enlazado a `python312.dll` y a las librerías de Intel Fortran. Con Python 3.12 funciona.
  - **Placa delgada (a/t = 100) y viga de MacNeal–Harder:**

    | Elemento | w con 8×8 | w con 32×32 | M en centroide con 32×32 | Viga MH en el plano |
    |---|---|---|---|---|
    | `ShellDKGQ` | −0,058 % | −0,003 % | — | 0,904 |
    | `ASDShellQ4` | −0,46 % | +0,02 % | −0,064 % | 0,987 |
    | `ShellMITC4` | — | — | — | 0,076 |

  - **Muro de 3 plantas** con malla 1×3: −7,4 % con `ShellDKGQ` y −3,8 % con `ASDShellQ4`.
  - **Rendimiento:** 0,15 s para 32×32.
  - **Limitación:** `eleResponse('stresses')` de MITC4 y DKGQ no devolvió los momentos con el índice usado. Hay que revisar el orden de salida por elemento.
- **Evidencia:** `out_exp08.txt`; enlace a `python312.dll` leído del binario (`openseespywin/opensees.pyd`).
- **Recomendación:**
  - Usar OpenSeesPy (`ShellDKGQ` o `ASDShellQ4`, `elasticBeamColumn`) como primer oráculo de nivel 4 en `solvers/reference/` (offline, sin bundle).
  - Fijar Python 3.12 en un venv aislado.

### VAL-15 · La batería de pruebas de PyNite no protege a Concreta: tolerancias del 15 %, 35 % y 70 % y ninguna prueba de cortantes, distorsión, malla gruesa de membrana ni salida global
- **Soporte:** A — lectura de `Testing/` en la etiqueta 3.2.0, más el informe del investigador auxiliar sobre issues.
- **Prioridad:** P1
- **Afecta a:** §10.1 («antes de la beta se fijará y auditará una versión») y §21 — **añade**.
- **Hallazgo:**
  - **Pruebas de placas** (`test_plates&quads.py`):
    - Logan 12.1 al 1 % (sólo w);
    - placa hidrostática frente a T&WK Tabla 45 al **15 %** con una sola malla;
    - tolva circular sin ninguna aserción numérica.
  - **Otras pruebas:**
    - `test_meshes.py`: depósito PCA al 3 % (Quad) y al 8 % (Rect), más una rigidez de malla congelada (`round(k) == 1369`);
    - `test_shear_wall.py`: muro de quads 10×20 al 0,1 %, que no detecta el bloqueo de mallas gruesas, y muro frente a barras al **35 %**;
    - `test_2D_frames.py`: reacción de Kassimali 3.35 al **70 %**.
  - **Lo que no cubre:**
    - ninguna prueba llama a `shear()` de un quad ni a `local=False`;
    - no hay Scordelis-Lo, cilindro pellizcado, patch tests, mallas distorsionadas ni conexión barra–lámina.
  - **Issues relevantes:**
    - abierto: #102 (equilibrio con láminas);
    - corregidos tarde: #78 y #198 (quads esviados), #104 (membrana a ¼ de su rigidez hasta la v0.0.52), #284 (barras giradas mal desde la 1.0.0 hasta la 1.5.0).
- **Evidencia:** `pynite-3.2.0/Testing/*.py` (líneas citadas en el texto); https://github.com/JWock82/Pynite/issues/102, /78, /104, /198, /284.
- **Recomendación:**
  - Concreta tiene que tener su propia batería sobre la versión vendorizada. No delegar en la de PyNite.
  - Revisar el changelog de PyNite antes de cada actualización: hay historial de regresiones en orientación y en quads esviados.
  - Valorar un fork mínimo que corrija `local=False` y el `Db` de `Plate3D`, o no usarlos (VAL-06 y VAL-07).

### VAL-16 · Propuesta de fixtures: referencias congeladas y analíticas en el proyecto `unit` (rápido, sin Pyodide) y la batería del motor en un proyecto `engine` fuera de pre-push; sólo un humo de unos 6 s en `golden`
- **Soporte:** A — lectura de `vite.config.ts` (proyectos `unit` y `golden`), `.husky/pre-push`, `pyslope.golden.test.ts` y `src/test/fem2d/solver2d.test.ts`, más los tiempos de VAL-13.
- **Prioridad:** P1
- **Afecta a:** §18.3 y §21 — **añade**.
- **Hallazgo:**
  - **Situación actual.** `bun run test:run` (pre-push, unas 7 700 pruebas en ~78 s) ejecuta los proyectos `unit` (jsdom) y `golden` (node, Pyodide). Cada fichero `*.golden.test.ts` arranca su propio Pyodide.
  - **Coste.** Un golden de FEM 3D costaría unos 3–4 s de carga de numpy y scipy, 0,4 s de PyNite y 2–3 veces el tiempo de CPython en el cálculo. La batería de VAL-05, VAL-17 y VAL-02 completa en Pyodide supera holgadamente el minuto.
  - **Precedente.** El FEM 2D ya usa oráculos cerrados calculados dentro de la propia prueba, con el convenio de signos fijado en la cabecera.
- **Recomendación:** estructura propuesta.
  ```
  src/modules/fem3d/validation/
    benchmarks/<id>.bench.json      # caso: generador + parámetros, magnitudes, referencia y fuente, tolerancia, notas
    generators/*.ts                 # mallas paramétricas deterministas (placa n×n, muro, Scordelis-Lo…)
    reference/*.ts                  # soluciones cerradas en TS (Navier, Mindlin, pendiente-desplazamiento…)
    frozen/pynite-3.2.0_pyodide-314.0.0/<id>.n<k>.json   # salida bruta del motor + huella de entorno
  scripts/fem3d-freeze.mjs          # corre la batería en Pyodide (Node) y regenera frozen/; diff revisado en el PR
  ```
  - **Campos de cada `bench.json`:**
    - `id`, `family` y `source` (cita exacta con URL, página o tabla);
    - `model.generator` y `params`;
    - `quantities[]` con `where` (nudo, centroide o estación), `component` (en convenio Concreta), `reference.value` y su escala (p. ej. `q·a⁴/D`), `tolerance.rel/abs` y `expectedEngineError`, que documenta el error conocido del motor con esa malla (p. ej. −0,07 %);
    - `invariants`: equilibrio de fuerzas y momentos, simetría y metamórficas;
    - `engine`: PyNiteFEA, Pyodide, numpy, scipy y hash del vendor;
    - `notes` de modelado.
  - **Tres niveles de ejecución:**
    1. `unit`, siempre y por debajo de 1 s:
       - las referencias analíticas frente a la tabla publicada;
       - y el **adaptador sobre `frozen/`**. Un `ReplaySolverAdapter` alimenta la normalización (signos, giros de tensor, ×t de membrana) con la salida bruta congelada y compara con la referencia del benchmark con su tolerancia. Así se prueban VAL-07 y VAL-09 sin Pyodide.
    2. `golden`, en pre-push, unos 6 s: un único humo `fem3d.golden.test.ts` (pórtico más placa 4×4) contra `frozen/` con tolerancia de 1e-9.
    3. Nuevo proyecto `engine`, con `include **/*.engine.test.ts`, **excluido** de `test:run` mediante `vitest run --project unit --project golden`. Se ejecuta en CI y a mano antes de actualizar PyNite o Pyodide: batería completa de convergencia y metamórficas.
  - Las referencias externas (OpenSeesPy, Kratos o Code_Aster) se generan offline con scripts en `solvers/reference/` y se versionan como JSON. Nunca se ejecutan en CI.

### VAL-17 · En láminas, el `Quad3D` converge a la referencia de MacNeal–Harder en Scordelis-Lo (0,3024, no 0,3086) y a +1,8 % en el cilindro pellizcado, con convergencia no monótona
- **Soporte:** A — `exp03_laminas.py` y `exp04_esviada.py`; para las referencias, véase VAL-18.
- **Prioridad:** P2 (el MVP es de edificación plana, pero estas pruebas detectan regresiones de membrana, flexión y taladro)
- **Afecta a:** §18.1 (nivel 3) y §23.2 — **añade**.
- **Hallazgo:**
  - **Scordelis-Lo** (cuarto de modelo, n×n; diafragma u_y = u_z = 0 como en MacNeal–Harder): 4×4 0,944; 8×8 0,972; 16×16 0,988; 32×32 0,995 (normalizado a 0,3024). Richardson da 0,30226 (−0,05 %) con p = 1,29 y GCI = 0,58 %.
    - El valor queda entre 0,3024, la convergida de Reissner–Mindlin, y 0,3006, la de Kirchhoff–Love.
    - Frente a 0,3086, la solución analítica de lámina profunda de Scordelis & Lo (1964), quedaría en −2,5 %.
    - Fijar o no θx en el diafragma no cambia nada (< 2e-4).
  - **Cilindro pellizcado** (octante): 0,617, 0,945, 1,019 y 1,018. No es monótono, así que no se puede aplicar Richardson; hay que tratarlo como banda de ±2 %.
  - **Placa esviada de Morley** (30°, L/t = 1000, sólo w = 0 en el borde, porque PyNite no admite apoyos en ejes oblicuos). w_c en unidades de 10⁻⁴·qL⁴/D:

    | Malla | 4×4 | 8×8 | 16×16 | 24×24 | 32×32 | 48×48 | 64×64 |
    |---|---|---|---|---|---|---|---|
    | w_c | 7,60 | 5,07 | 4,43 | 4,30 | 4,25 | 4,20 | 4,18 |

    Richardson con 16, 32 y 64 da 4,145 (p = 1,49). Frente a Kirchhoff, 4,08 (VAL-18), queda en +1,6 % (+2,5 % con 64×64), coherente con un apoyo «blando» de Mindlin. Converge lentamente por la singularidad de la esquina obtusa: con 8×8 todavía hay un +24 %.
- **Evidencia:** `out_exp03.txt`, `out_exp04.txt` y `out_exp04b.txt`.
- **Recomendación:**
  - Incluir Scordelis-Lo 16×16 (banda de −1,5 %), el cilindro pellizcado 16×16 (±2,5 %) y la viga de MacNeal–Harder como regresión del motor (lentas, VAL-16).
  - En el informe de validación, comparar Scordelis-Lo siempre con 0,3024 y citar 0,3086 como solución de teoría de láminas profundas.

### VAL-18 · Catálogo de benchmarks con referencias verificadas en la fuente primaria; tres valores habituales están mal citados (Scordelis-Lo 0,3086/0,3024, Mc empotrada 0,0231, mxy del patch de MacNeal–Harder)
- **Soporte:** B — fuentes primarias leídas: MacNeal–Harder (1985), el informe UCB/SEMM-2002/09 de Taylor–Govindjee, Batista (2010) y los manuales de verificación de CSI, Code_Aster, SOFiSTiK, Robot y COMSOL. Los valores marcados (S) sólo se han visto en fuente secundaria. Las referencias de Navier las he recalculado yo (`refs.py`, soporte A).
- **Prioridad:** P1
- **Afecta a:** §18.1 (niveles 2 y 3) y §18.3 — **añade**.
- **Hallazgo:** catálogo mínimo para el MVP. «MH» es MacNeal & Harder, FEAD 1 (1985) 3-20.

  | Grupo | Benchmark (datos) | Magnitud | Referencia | Fuente |
  |---|---|---|---|---|
  | Barra | Voladizo, biapoyada, pórtico de pendiente-desplazamiento, L con torsión, trípode | δ, M, N, T | Fórmula cerrada (exp05) | Euler-Bernoulli y St Venant |
  | Barra | SAP2000 1-004: W12X106 con ejes girados 30°, L = 144 in | (Uy, Uz) en punta con P = 1 k | (−0,03345; −0,05610) in | CSI, Problem 1-004 (Roark) |
  | Barra | SAP2000 1-018: pórtico de 1 vano, W8X31, 0,1 k/in | Uz en centro de vano | −2,77076 in (−2,72361 sólo flexión) | CSI 1-018 |
  | Barra | SAP 1-022 / ETABS Ej. 7: pórtico 2D de 7 plantas | Ux de cubierta; N y M del pilar C1 | 1,45076 in; 69,99 k; 2 324,68 kip·in | CSI (Wilson & Habibullah 1992) |
  | Celosía | Megson 11.1 / COMSOL «space truss», L = 2 m, E = 70 GPa, F = 100 kN | u_d, u_c, N | −5,15e-4 m; −2,13e-4 m; 25,0 / −10,4 / 14,6 kN | COMSOL 6.4 (el texto dice «radio» 0,05 m; es diámetro) |
  | Placa | Cuadrada apoyada, ν = 0,3 | w_c·D/(qa⁴); M_c/(qa²); Q_max/(qa); R_esquina/(qa²) | 0,00406235; 0,0478864; 0,337657; 0,0650 | T&WK, Tabla 8; Batista 2010, Tabla 2; Navier propio |
  | Placa | Cuadrada empotrada, ν = 0,3 | w_c; M_c; M en centro de borde; Q en borde | 1,265319e-3; **0,0229051** (T&WK da 0,0231, «error in the third digit»); −0,0513338; 0,441301 | Taylor & Govindjee 2002/2004, Tabla I; Batista, Tabla 5 |
  | Placa | MH, rectángulo a = 2, b = 2 o 10, t = 1e-4, E = 1,7472e7 (D = 1,6e-6) | w_c·10³ (q o P central) | Apoyada 4,062 / 11,60; empotrada 1,26 / 5,60; empotrada b/a = 5: 2,56 (preciso: **2,604**) | MH, Tabla 4; Batista 2010 |
  | Placa | Morley, rombo de 30°, apoyado, q | w_c·D/(qL⁴); M_max; M_min | **0,408e-3**; 1,91e-2; 1,08e-2 (S) | Abaqus Benchmarks 2.3.4 (S) |
  | Placa | NAFEMS LE6 (rombo de 30°, L = 1 m, t = 0,01, E = 210 GPa, p = 0,7 kPa) | σ1 en la cara inferior del centro | 0,802 MPa | Robot, manual NAFEMS IC13 |
  | Placa | Circular empotrada / apoyada | w_c | qa⁴/(64D) y (5+ν)qa⁴/(64(1+ν)D) | Kirchhoff, cerrada |
  | Membrana | Patch de MH: 0,24×0,12 con 4 nudos interiores, E = 1e6, ν = 0,25, t = 0,001 | σx, σy, τxy | 1333, 1333, 400 | MH, Fig. 2 y Tabla 2a |
  | Flexión | Patch de MH, w = 1e-3(x²+xy+y²)/2 | mx, my, mxy | 1,111e-7, 1,111e-7, **3,333e-8** (la tabla imprime 1e-7; es una errata) | MH, Tabla 2b, corregida |
  | Viga | Viga recta de MH (L = 6, sección 0,2×0,1, E = 1e7, ν = 0,3, malla 6×1 rectangular / trapezoidal / paralelogramo) | Flecha en punta | Extensión 3,0e-5; cortante en el plano 0,1081; fuera del plano 0,4321; torsión 0,03208 | MH, Tabla 3 |
  | Viga | Viga curva de MH; viga alabeada de MH (12×2) | Flecha en punta | 0,08734 / 0,5022; 0,005424 / 0,001754 | MH, Tabla 3 |
  | Lámina | Scordelis-Lo (R = 25, L = 50, t = 0,25, E = 4,32e8, ν = 0, 90/área; u_x = u_z = 0 en los diafragmas) | Flecha en el centro del borde libre | **0,3024** (Mindlin convergida, usada por MH para normalizar). 0,3086 es la analítica de lámina profunda (Scordelis & Lo, J. ACI 61, 1964). 0,3006 es la convergida de Kirchhoff–Love (S) | MH, pp. 11-12 y Tabla 5a; arXiv 2201.11491 (S) |
  | Lámina | Cilindro pellizcado con diafragmas (R = 300, L = 600, t = 3, E = 3e6, ν = 0,3, P = 1) | Flecha radial bajo la carga | 1,8248e-5 | Code_Aster SSLS104; SOFiSTiK BE41 |
  | Lámina | Hemisferio pellizcado (R = 10, t = 0,04, E = 6,825e7, ν = 0,3, agujero de 18°) | Flecha radial | 0,0940 (F = 1 por punto en el cuadrante); 0,0924 sin agujero | MH, Tabla 5b; SAP2000 2-007; NAFEMS LE3: 0,185 m |
  | Muro | ETABS Ej. 15a: muros en voladizo de 6 plantas, t = 12 in, E = 3000 ksi, ν = 0,2 (carga de 100 k inferida) | Desplazamiento de cabeza | L = 120 → 2,4287 in; L = 360 → 0,1031 in. Ej. 15c (muro acoplado), 15d (núcleo en C, 0,8936 in) | CSI ETABS, Example 15. La referencia es SAP2000 con malla fina, es decir, código contra código |

  No existe un benchmark público con solución analítica de «muro con hueco». El más cercano es ETABS 15c, que compara código contra código.
- **Evidencia:**
  - https://x2go-cdm.ing.unimo.it/_shared/Irons_patch_test/macneal1985proposed.pdf (pp. 5-12);
  - https://escholarship.org/uc/item/4bj7133z (Taylor–Govindjee);
  - arXiv:1001.3016 (Batista);
  - https://docs.csiamerica.com/manuals/sap2000/Verification/Analysis/ ;
  - Code_Aster V3.03.104, 105 y 107 (https://codeaster.gitlab.io/doc/docaster/manuals/man_v/);
  - https://docs.sofistik.com/2024/en/verification/ ;
  - https://doc.comsol.com/6.4/doc/com.comsol.help.models.sme.inplane_and_space_truss/models.sme.inplane_and_space_truss.pdf
- **Recomendación:**
  - Cada `bench.json` debe citar la fuente primaria con la página o la tabla.
  - Usar 0,3024 (Scordelis-Lo con `Quad3D`, que es Mindlin), 0,0229051 (empotrada) y 3,333e-8 (patch de flexión). No usar 0,3086, 0,0231 ni 1e-7.

### VAL-19 · Hay manuales públicos de verificación útiles para edificación (CSI, Dlubal, Robot, SOFiSTiK, Code_Aster), pero CYPE no publica ninguno y NAFEMS es de pago
- **Soporte:** B — los PDF de CSI, Robot, SOFiSTiK y Code_Aster se han abierto; los de Dlubal sólo como índice.
- **Prioridad:** P1
- **Afecta a:** §10.2, §18.1 (niveles 4 y 5) y §24 — **corrige**: el contraste con CYPE será siempre de modelo contra modelo.
- **Hallazgo:**
  - **CSI.** Los PDF de SAP2000 (`Verification/Analysis/Frames/Problem 1-0NN.pdf`, `Shells/Problem 2-0NN.pdf`), ETABS (`Software Verification.pdf`, 859 páginas) y SAFE (ejemplos 1-7 contra T&WK) son públicos.
  - **Dlubal.** Publica casos VE: 000070-73 (placas apoyadas, placa triangular, elipse empotrada), 000091 (ortótropa) y 009016 (placa de Mindlin).
  - **Robot.** Publica los manuales NAFEMS y AFNOR VPCS. El SSLL04 es un pórtico 3D sobre apoyos elásticos.
  - **SOFiSTiK.** BE1, BE41, BE42 y BE43.
  - **SCIA.** No tiene un conjunto público de verificación FEM.
  - **CYPE.** No se ha encontrado ningún documento público de verificación de CYPECAD ni de CYPE 3D, buscando en español y en inglés.
  - **NAFEMS.** «The Standard NAFEMS Benchmarks» (P18) cuesta 45 £ (15 £ para socios); sus casos LE1-LE11 aparecen reproducidos en manuales públicos (Code_Aster, Robot, Abaqus).
  - **Cinco ejemplos de edificio propuestos para regresión:**
    1. SAP 1-022 / ETABS 7: pórtico de 7 plantas con estática y periodos.
    2. SAP 1-024: pórtico 3D de 2 plantas y 2×2 vanos con diafragma y excentricidad (modal, para cuando lo haya).
    3. ETABS 15a/15c/15d: muros, muro acoplado y núcleo en C.
    4. SAFE 1-7 o SAP 2-005 con los valores de Taylor–Govindjee y Batista: losas.
    5. SAP 1-004: ejes locales girados, que comprueba VAL-09.
- **Evidencia:**
  - https://docs.csiamerica.com/manuals/etabs/Software%20Verification.pdf ; https://docs.csiamerica.com/manuals/etabs/Verification/Analysis/Example%2015.pdf
  - https://www.dlubal.com/en/downloads-and-information/examples-and-tutorials/verification-examples
  - https://help.autodesk.com/sfdcarticles/attachments/RSA_Verification_Manual_NAFEMS_enu.pdf
  - https://www.nafems.org/publications/resource_center/p18/
- **Recomendación:**
  - El nivel 5 debe empezar por estos ejemplos de CSI, que son públicos, citables y reproducibles.
  - Para CYPE, el estudio tiene que fabricar sus propios modelos espejo y documentar las diferencias de formulación: CYPE incluye deformación por cortante y zonas rígidas (VAL-08 y VAL-12).
  - Las comparaciones con códigos comerciales no son «referencia»: llevan la tolerancia explicada de §18.2.

### VAL-20 · OOFEM 3.0 tiene binarios para Windows, pero Kratos (con pip) y OpenSeesPy son referencias más realistas para un equipo de 1–2 personas; Code_Aster aporta los valores publicados
- **Soporte:** B — releases y documentación oficiales (informe auxiliar), más el experimento propio con OpenSeesPy (VAL-14).
- **Prioridad:** P2
- **Afecta a:** §10.2 («OOFEM como referencia FEM independiente») — **corrige** la elección.
- **Hallazgo:**
  - **OOFEM** (LGPL-2.1):
    - v3.0 del 29-12-2025 con `oofem-windows-zip`; los bindings pybind/nanobind exigen compilar;
    - el paquete de PyPI `oofem` es la 2.6.0.dev1 (solo cp311) y no hay conda;
    - entrada en texto `.in`; el `mitc4shell` no tiene rigidez de taladro, salvo una penalización opcional;
    - esfuerzo estimado: medio día de instalación más 2-4 días de exportador y lector de resultados.
  - **Kratos:** wheels para Windows de cp38 a cp314, versión 10.4.4 del 28-09-2026. Tiene DKQ con membrana ANDES y MITC4 con EAS. Su repositorio incluye Scordelis-Lo, el cilindro pellizcado y el hemisferio.
  - **Code_Aster:** los documentos de validación SSLS104, 105 y 107 son una referencia publicada citable. Su build nativo de Windows en conda-forge es de septiembre de 2026 y tiene 38 tests fallidos conocidos.
  - **CalculiX:** expande las láminas a sólidos y no da Mx/My de lámina, así que no sirve para momentos.
- **Evidencia:**
  - https://github.com/oofem/oofem/releases/tag/v3.0 ; https://pypi.org/project/oofem/
  - https://pypi.org/project/KratosMultiphysics/
  - https://codeaster.gitlab.io/doc/docaster/manuals/man_v/ ; https://www.dhondt.de/ (CalculiX 2.23)
- **Recomendación:**
  - Orden: OpenSeesPy, ya probado (VAL-14), y Kratos como oráculos automáticos offline en `solvers/reference/`; valores de Code_Aster y MacNeal–Harder como referencias publicadas; OOFEM sólo si hace falta un tercer código.
  - No crear adaptadores de producción para ninguno (§10.2 se mantiene).

## Contradicciones con el diseño técnico

1. **§7.2, §23.11 y §20: los nudos comunes no conectan bien barras con láminas.**
   - El giro de taladro de PyNite es un muelle a tierra de rigidez 1/1000. Una viga en el plano de un muro unida en un nudo queda casi articulada (1 205×) y se pierde el 48 % del momento (VAL-01).
   - La unión puntual perpendicular no converge (VAL-12).
   - Las «zonas rígidas y offsets» que §20 deja para después tienen que entrar en el MVP como embebido o enlace rígido generado por el compilador. PyNite no tiene restricciones multipunto ni offsets.
2. **§2.1 y §13.2: Qx/Qy no son un dato primario fiable con PyNite.** Infravaloran entre un 30 % y un 50 % con mallas de obra (VAL-03). Hay que recuperarlos por equilibrio en Concreta o excluirlos de las comprobaciones.
3. **§7.3: «el MVP puede utilizar triángulos» no es posible.** PyNite 3.2.0 no tiene ningún triángulo operativo y `Plate3D` es inutilizable (VAL-06). El mallador tiene que ser sólo de cuadriláteros. Además, la membrana bloquea, así que los muros necesitan al menos 8 elementos a lo largo (VAL-02).
4. **§18.2: las tolerancias no se ajustan a lo medido.**
   - El equilibrio a 1e-8 se cumple en fuerzas, pero no en momentos cuando trabaja el taladro (3,5e-5 en un muro en L, 0,49 en una viga en el plano; VAL-04).
   - El 0,1 % y el 0,5 % para barras son unas 10⁸ veces más laxos que la precisión real del motor (1e-11; VAL-08).
   - Las tolerancias de láminas tienen que ir ligadas a la malla (VAL-05).
5. **§10.2 y §18.1: los programas de referencia elegidos no son los adecuados.**
   - OOFEM no es el oráculo independiente más práctico: OpenSeesPy (probado) y Kratos se instalan con pip (VAL-14, VAL-20).
   - CYPE no publica verificaciones (VAL-19).
6. **§9.1 y §12: el contrato de resultados no puede apoyarse en la salida global de PyNite.**
   - Está rota con numpy ≥ 2.4 y su fórmula es errónea.
   - Los resultados vienen en los ejes de cada elemento.
   - La membrana sale en tensiones.
   - El axil de tracción es negativo.
   - La orientación por defecto de las barras depende del ruido numérico (VAL-07, VAL-08, VAL-09).
7. **§10.1 y §18.1 (nivel 4): las barras no tienen deformación por cortante.** Las comparaciones con SAP2000 o CYPE en vigas de canto (L/h < 8) tendrán diferencias del 15 % al 74 % en flechas si no se igualan las hipótesis (VAL-08).
8. **ADR-009 y §18.3: los resultados no son reproducibles bit a bit** entre CPython y Pyodide. Difieren hasta 6e-13, así que la huella identifica el modelo y la versión, y las referencias congeladas se comparan con tolerancia (VAL-13).

## Preguntas abiertas (lo que no pudiste cerrar y cómo se cerraría)

1. **¿Qué precisión tiene un Qx/Qy recuperado por equilibrio?** Por ejemplo, ajustando por mínimos cuadrados M sobre parches de 2×2 elementos y derivando, o integrando fuerzas nodales en líneas de apoyo. Se cerraría implementándolo en un script sobre las mismas placas de EXP-01d (a/t = 25 y 40, mallas 8, 16 y 32) con un objetivo de error ≤ 5 % con h/t ≈ 2. Hay que hacerlo antes de prometer comprobaciones de cortante o punzonamiento con láminas.
2. **¿Cómo modelar la zona rígida sin MPC?** Hay que decidir la rigidez de penalización (barras rígidas o nudo maestro) que no degrade el condicionamiento con `spsolve`. Se cerraría con un barrido EI_rígido = 10²…10⁸·EI_viga sobre EXP-07/07b, midiendo el residuo de `_solve_unknown_disp` y la convergencia de la unión pilar-losa con mallas de 0,5, 0,25 y 0,125 m.
3. **¿Cuánto pesa el taladro en núcleos reales?** El muro en L ya da un desequilibrio de momentos de 3,5e-5. Se cerraría modelando ETABS 15d (núcleo en C) y 15c (muro acoplado) en PyNite y comparando con SAP2000 y con OpenSees `ASDShellQ4`. Si el error supera el 2 %, hay que valorar con el área 1 un fork con taladro de Allman o Hughes–Brezzi, o membrana con modos incompatibles.
4. **Hemisferio pellizcado y viga alabeada de MacNeal–Harder:** no los ejecuté. Son la prueba más dura de taladro y alabeo para facetas planas. Se cerraría con un mallado del cuadrante en n×n quads; la referencia es 0,0940.
5. **Concentraciones en esquinas de huecos de losas y muros:** la solución es singular, así que Richardson no converge. Falta definir qué magnitud se publica (por ejemplo, la media en una banda de ancho t) y con qué malla. Se cerraría con un muro con hueco (ETABS 15c) y una losa con hueco refinando 3 niveles.
6. **Parámetros exactos de ETABS 15 y valores de Dlubal VE:** la carga de 100 k es inferida y los PDF de Dlubal no se abrieron. Se cerraría leyendo los PDF completos antes de fijar los fixtures.
7. **Morley con apoyo duro:** PyNite no admite apoyos en ejes oblicuos, así que no se puede comparar exactamente con Kirchhoff. Tampoco se ha visto Morley (1963) en primaria. Se cerraría con NAFEMS LE6 (σ1 = 0,802 MPa, Robot) como referencia publicada alternativa.
8. **Rendimiento de la batería en Pyodide a escala de edificio** para dimensionar el proyecto `engine`: lo mide el área 1. Aquí sólo hay 4,7–5,5 s para una placa de 16×16 más un modelo mixto pequeño.

## Experimentos (qué ejecutaste, dónde están los scripts y su salida resumida)

Carpeta: `C:\Users\javie\AppData\Local\Temp\claude\d--PROGRAMACION-Concreta-EST\b287d96a-8882-4d7d-800f-3c46ec2b77b4\scratchpad\fem3d\05-validacion\`

**Entornos:**
- `venv`: CPython 3.14.7 con PyNiteFEA 3.2.0, numpy 2.5.3 y scipy 1.18.1.
- `venv_pyo`: numpy 2.4.3 y scipy 1.17.1, las versiones de Pyodide 314.
- `venv312`: CPython 3.12.15 instalado con `uv`, con openseespy 3.8.0 y PyNiteFEA 3.2.0.
- `pyo/`: pyodide@314.0.0 de npm en Node 24.
- Código fuente: `pynite-3.2.0/` (worktree de la etiqueta 3.2.0) y `pynite-src/` (main 4afc9f1). Fuera de lo cosmético, los cambios posteriores a 3.2.0 no tocan `Quad3D` ni `Plate3D`.

| Script | Qué hace | Salida | Resultado resumido |
|---|---|---|---|
| `refs.py` | Navier (w, M, Qx, Mxy) y Mindlin exacto | consola | α = 0,00406235; β = 0,0478864; Qx = 0,3374; Mxy esquina = −0,03248; Mindlin a/t = 10: +5,18 % |
| `common.py` | Generador de placa n×n (apoyo duro, blando o empotrado; distorsión), extracción, Richardson y GCI | — | — |
| `exp01_placas.py` | Convergencia de placas, casos A–F, Quad y Rect, mallas 2–32 | `out_exp01_A.txt`, `out_exp01_BCDEF.txt` (+ json) | VAL-05, VAL-06, VAL-11 |
| `exp01b_cortante_signos.py`, `exp01d_cortante_losa.py` | Qx en centroides frente a Navier según a/t | `out_exp01b.txt`, `out_exp01d.txt` | VAL-03 |
| `exp01c_global.py` | `local=False` con numpy 2.4.3 y 2.5.3 | `out_exp01c.txt` | `TypeError` (VAL-07) |
| `exp02_membrana.py` | Viga de MacNeal–Harder 6×1 y muros H/B = 3 y 1 | `out_exp02.txt` | 0,093/0,027/0,034; muro 1×3 −32 % (VAL-02) |
| `exp03_laminas.py` | Scordelis-Lo y cilindro pellizcado, 4–32 | `out_exp03.txt` | 0,995 con 32×32; 1,018 (VAL-17) |
| `exp04_esviada.py`, `exp04b_morley_fino.py` | Morley con Quad (hasta 64×64) y Rect | `out_exp04.txt`, `out_exp04b.txt` | Quad converge a ≈ 4,15 (Kirchhoff 4,08); Rect ≈ 40,7 (VAL-06, VAL-17) |
| `exp05_barras.py` | 7 casos de barra con solución cerrada, orientación y cortante | `out_exp05.txt` | ≤ 1e-11; giro de 90° por ruido (VAL-08, VAL-09) |
| `exp06_metamorficas.py` | M1–M4, equilibrio | `out_exp06.txt` | 1e-12 … 5e-16 (VAL-10) |
| `exp06b_solido_rigido.py` | Modos rígidos y alabeo de un quad | `out_exp06b.txt` | Rz 2,6e-6; alabeo del 1 % → 2,3e-3 (VAL-10, VAL-11) |
| `exp07_conexion.py`, `exp07b_perp_malla.py` | Unión viga–muro en el plano y perpendicular | `out_exp07.txt`, `out_exp07b.txt` | 1 205× y 1 713×; 2,88 → 3,53× (VAL-01, VAL-12) |
| `exp08_opensees.py` | OpenSeesPy: MITC4, DKGQ y ASDShellQ4 en placa, viga de MacNeal–Harder y muro | `out_exp08.txt` | DKGQ 0,904 y ASD 0,987 en la viga de MacNeal–Harder (VAL-14) |
| `exp09_determinismo.py`, `pyo/run_det.mjs` | 17 dígitos en 3 entornos CPython y en Pyodide | `out_exp09.txt`, `out_exp09b_pyodide.txt` | CPython idéntico; Pyodide ≤ 6e-13 (VAL-13) |
| `exp10_patch.py` | Patch tests de MacNeal–Harder de membrana y flexión | `out_exp10.txt` | Pasa a 2,5e-10 y 5e-13 en ejes globales (VAL-05, VAL-07) |
| `exp11_equilibrio.py`, `exp11b_equilibrio_mixto.py` | Residuo de fuerzas y momentos con taladro | `out_exp11.txt`, `out_exp11b.txt` | |ΣM| de 0,49, 1,4e-4 y 3,5e-5 frente a 3,5e-13 sin taladro (VAL-04) |

Investigación documental delegada: `agentA/` (PDF de MacNeal–Harder, Taylor–Govindjee, CSI, Code_Aster, SOFiSTiK y COMSOL, con sus scripts de comprobación) y `agentB/` (issues y PR de PyNite en JSON, OOFEM y Kratos).

## Fuentes

- **Diseño técnico de Concreta:** `docs/fem3d/diseno-tecnico.md` (§2.1, §2.3, §5.2, §7.2-7.3, §9, §10, §12, §13.2, §18, §20, §21, §23).
- **Repositorio de Concreta:**
  - `vite.config.ts` (proyectos `unit` y `golden`), `.husky/pre-push`, `.husky/pre-commit`;
  - `src/lib/calculations/geotech/pyslope.golden.test.ts`;
  - `src/test/fem2d/solver2d.test.ts:1-12`;
  - `src/features/fem2d/solver2d.ts:117, 277-283`; `src/features/fem-analysis/femSolver.ts:196-203`;
  - `public/pyodide/pyodide-lock.json` (numpy 2.4.3, scipy 1.17.1).
- **PyNiteFEA 3.2.0** (PyPI, 13-09-2026, MIT):
  - https://pypi.org/project/PyNiteFEA/3.2.0/ ; repositorio https://github.com/JWock82/Pynite (etiqueta 3.2.0 y main 4afc9f1);
  - código: `Quad3D.py` (l. 1-5 referencias; 23-28 docstring; 107-141; 450-465; 523-633; 635-700; 884-950; 1017-1239);
  - `Plate3D.py` (77-87, 108-110, 115-134, 590-609); `Tri3D.py`;
  - `Member3D.py` (3, 176-207, 933-1036); `Analysis.py` (111-168, 175-240, 1331);
  - `FEModel3D.py` (2250-2332); `ShearWall.py` (10-11);
  - `Testing/test_plates&quads.py`, `test_meshes.py`, `test_shear_wall.py`, `test_2D_frames.py`.
- **Issues de PyNite:** #78, #102 (abierto), #104, #192, #198, #250 (abierto), #267, #271, #284; PR #289 y #341; discusión #261 (https://github.com/JWock82/Pynite/issues/N).
- **Documentación de PyNite:** https://pynite.readthedocs.io/en/latest/member.html y …/plate.html
- **Referencias técnicas:**
  - MacNeal R.H. & Harder R.L. (1985), *A proposed standard set of problems to test finite element accuracy*, Finite Elements in Analysis and Design 1:3-20 (PDF: https://x2go-cdm.ing.unimo.it/_shared/Irons_patch_test/macneal1985proposed.pdf).
  - Timoshenko S. & Woinowsky-Krieger S. (1959), *Theory of Plates and Shells*, Tablas 8 y 35 (valores reproducidos con serie propia y por Batista).
  - Taylor R.L. & Govindjee S. (2002/2004), *Solution of clamped rectangular plate problems*, UCB/SEMM-2002/09 y CNME 20:757-765 (https://escholarship.org/uc/item/4bj7133z).
  - Batista M. (2010), arXiv:1001.3016.
  - Wang C.M., Reddy J.N. & Lee K.H. (2000), *Shear Deformable Beams and Plates* (relación Mindlin–Kirchhoff para placas poligonales apoyadas).
  - Katili I. (1993), DKMQ, IJNME 36 (referencia del propio `Quad3D.py`).
  - Roache P.J. (1994/1998), GCI con Fs = 1,25 para tres mallas.
  - Scordelis A.C. & Lo K.S. (1964), J. ACI 61:539-561.
- **Manuales de verificación:**
  - CSI: https://docs.csiamerica.com/manuals/sap2000/Verification/Analysis/ ; https://docs.csiamerica.com/manuals/etabs/Software%20Verification.pdf ; https://docs.csiamerica.com/manuals/etabs/Verification/Analysis/Example%2015.pdf
  - Dlubal: https://www.dlubal.com/en/downloads-and-information/examples-and-tutorials/verification-examples
  - Robot: https://help.autodesk.com/sfdcarticles/attachments/RSA_Verification_Manual_NAFEMS_enu.pdf
  - SOFiSTiK: https://docs.sofistik.com/2024/en/verification/
  - Code_Aster: https://codeaster.gitlab.io/doc/docaster/manuals/man_v/ (V3.03.104, 105, 107)
  - NAFEMS P18: https://www.nafems.org/publications/resource_center/p18/
  - COMSOL: https://doc.comsol.com/6.4/doc/com.comsol.help.models.sme.inplane_and_space_truss/models.sme.inplane_and_space_truss.pdf
- **Solvers de referencia:**
  - OpenSeesPy 3.8.0 (https://pypi.org/project/openseespy/, `openseespywin` enlazado a `python312.dll`);
  - OOFEM v3.0 (https://github.com/oofem/oofem/releases/tag/v3.0);
  - Kratos 10.4.4 (https://pypi.org/project/KratosMultiphysics/);
  - CalculiX 2.23 (https://www.dhondt.de/).
- **Pyodide 314.0.0:** npm `pyodide@314.0.0`, lock con numpy 2.4.3 y scipy 1.17.1.
