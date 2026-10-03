> **Informe original del Área 3 — Resultados, combinaciones y comprobaciones**, generado por un subagente el 2026-10-03.
> El documento consolidado es `../investigacion-id.md`; esto es el detalle con toda la evidencia.
> Los scripts y salidas citados están ahora en `experimentos/03-resultados/`; las rutas absolutas
> del texto apuntan a la carpeta temporal de la sesión que los ejecutó.
> Los ficheros `.ts` se renombraron a `.mts` al copiarlos (el eslint del repo linta `**/*.ts`).

# Área 3 — Resultados, combinaciones, envolventes y paso a las comprobaciones

## Resumen (≤ 10 líneas)

1. El generador de combinaciones de `frame-core` no se puede reutilizar tal cual en 3D: con 11 casos base realistas (G, Q, S, viento ±X/±Y, sismo X/Y ±e) salen **176 combinaciones** (74 ELU persistentes, 64 sísmicas) frente a 4 de `buildLcCombinations`. Además le faltan la G favorable 0,80, la ausencia de variables y la situación sísmica.
2. La «envolvente con concomitantes» de §11.2 **no basta para los pilares**. Con el motor real `calcRCColumn`, en el 33 % de los extremos (58 % con sismo) la combinación pésima no está entre las 6 extremas, y η queda corto hasta un 32 %. Hay que iterar todas las combinaciones, como hacen CYPE y ETABS.
3. Almacenar sólo los casos base más un índice Uint16 de la combinación gobernante cuesta 2,5 MB y 0,1–0,35 s para 2 000 barras. El cuello de botella es `calcRCColumn`: unos 140 µs por llamada, es decir, 11–13 s en un edificio medio.
4. PyNite 3.2.0 da los esfuerzos de barra con el **signo opuesto al de CSI en las seis componentes** (axil + = compresión). En las láminas, `membrane()` devuelve **tensiones (Pa)**, no Nx, y su salida global (`local=False`) **revienta con NumPy 2.5 y su álgebra es errónea**.
5. Wood–Armer está implementado y validado contra LUSAS (error ≤ 0,01) y por fuerza bruta: hay que aplicarlo por combinación. Los picos sobre pilares dependen de la malla (+65 %), pero la integral por bandas converge (±1 %).
6. El αcr calculado con rigidez bruta (lo que hace `fem2d`) sobrestima la estabilidad del hormigón unas 3 veces (CE A19 Apéndice H). PyNite `Kg` ignora las placas.

## Hallazgos

### RES-01 · El generador de combinaciones de frame-core no puede expresar las combinaciones CTE/NCSE de un modelo 3D: con 11 casos base hacen falta 176 combinaciones y él produce 4
- **Soporte:** A — código leído y prototipo ejecutado (`combos3d.ts`); B para los criterios normativos (DB SE 4.2.2 y tabla 4.1, NCSE-02 §3.2 y §3.4).
- **Prioridad:** P0
- **Afecta a:** §11.1 (y §2.1, «según las reglas ya existentes en Concreta») — corrige
- **Hallazgo:**
  - **Tipo de casos cerrado.** `LoadCase` es la unión cerrada `'G'|'Q'|'W'|'S'|'E'`. Las combinaciones se construyen por *bucket* de hipótesis, con un caso representativo para los ψ, y no hay forma de expresar:
    - familias excluyentes: Wx+, Wx−, Wy+ y Wy− nunca son simultáneas. Con 4 casos de viento como variables independientes el generador los sumaría a la vez con ψ0;
    - la G favorable: γG es siempre 1,35. La tabla 4.1 del DB SE exige también 0,80 cuando G es favorable, evaluada globalmente;
    - la ausencia de una variable (γ = 0 si es favorable): toda variable no principal entra siempre con ψ0;
    - la situación sísmica: E se trata como una variable más, con 1,35·G + 1,5·E. El DB SE (4.5) exige ΣGk + Ad + Σψ2·Qk sin coeficientes, y la NCSE-02 §3.4 pide 100/30 en dos direcciones;
    - la excentricidad accidental ±1/20 (NCSE-02 §3.2).
  - **Recuento del prototipo** con G, Q (A), S (≤ 1000 m), Wx±, Wy± y EX±e, EY±e:

    | Situación | Combinaciones |
    |---|---|
    | ELU persistente | 74 (37 sin la G favorable) |
    | ELU sísmica | 64 |
    | ELS característica | 37 |
    | ELS casi permanente | 1 |
    | **Total** | **176** |

  - **Práctica española.** La memoria de cálculo de proyecto en formato CYPE de la carpeta de ejemplos usa la G favorable 0,80, el sismo con coeficientes −1/+1 y el 30 % ortogonal, y un juego aparte de «acciones características» para el terreno.
  - **Efecto en el 2D actual.** El hueco de la G favorable afecta también a `fem2d`: el levantamiento por viento de una cubierta ligera sólo se comprueba con 1,35·G.
- **Evidencia:**
  - `src/lib/frame-core/types.ts:14`: `export type LoadCase = 'G' | 'Q' | 'W' | 'S' | 'E'`.
  - `src/lib/frame-core/lcCombinations.ts:24-25` (`ELU_GAMMA_G = 1.35`), `:84-93` (toda variable no principal recibe `1.5·ψ0`, nunca 0) y `:318-328` (ψ del primer caso de cada hipótesis).
  - `src/lib/frame-core/combinations.ts:39` (`E: ψ0 = ψ1 = ψ2 = 0`, tratado como variable) y `:54`.
  - `fem2d/checks.ts`: no hay ningún factor 0,8 en G (grep). Usa `buildLcCombinations` (`checks.ts:103`).
  - DB SE tabla 4.1 (resistencia: permanente 1,35/0,80, variable 1,50/0) y expresiones (4.3) y (4.5) (`fuentes/dbse.txt:631-681, 719-735`).
  - NCSE-02 §3.2 (excentricidad adicional ≥ 1/20 de la mayor dimensión en planta, perpendicular al sismo) y §3.4 (situación accidental con γ = 1 en las desfavorables y 0 en las variables favorables; 100/30) (`fuentes/ncse02.txt:782-815`).
  - `ejemplos anejos de calculo/P2115_A_anexo A_ESTRUCTURA.pdf`, apartado A.3 (`fuentes/p2115.txt:349-470`).
  - CE Anejo 18, Apéndice A.1: «en edificación se adoptará lo establecido en el CTE» (`fuentes/ce.txt:36932`).
  - Experimento: `bun combos3d.ts` → `salida_combos3d.txt`.
- **Recomendación:**
  - Crear `results/combinations` propio del 3D.
  - Ampliar `LoadCase` de §11.1 con `kind` (G/Q/S/W/E/A), `family` (grupo excluyente), `signReversible` (sismo ±), `psi0/1/2` (desde `getPsiRow`, que sí se reutiliza), duración (kmod de madera, como `comboDuration` de `fem2d`) y `derivedFrom` (cargas nocionales, RES-17).
  - Sustituir `limitState` por `situation: 'ELU-PT'|'ELU-ACC'|'ELU-SIS'|'ELS-C'|'ELS-F'|'ELS-CP'|'GEO'` (ver RES-13 y RES-14).
  - Guardar cada combinación como `Float64Array` de factores alineado con los casos.
  - Abrir aparte el arreglo de la G favorable en `frame-core`/`fem2d`.

### RES-02 · Para pilares, la «envolvente con concomitantes» no contiene la combinación pésima en el 33–58 % de los casos: hay que iterar todas las combinaciones
- **Soporte:** A — experimento con el motor real `calcRCColumn` del repo (importado en sólo lectura), 600 extremos de pilar. La magnitud depende de los datos sintéticos.
- **Prioridad:** P0
- **Afecta a:** §11.2, §12.2, §13 — corrige (la concomitancia que define §11.2 vale para mostrar resultados, no para comprobar)
- **Hallazgo:**
  - **Planteamiento.** Por cada extremo de pilar se tomaron las 6 combinaciones que dan el máximo y el mínimo de N, My y Mz, con sus concomitantes, y se calculó el η máximo de esas 6. Se comparó con el η de iterar todas.
  - **Resultado:**

    | Conjunto de combinaciones | No contiene la pésima | Subestima η > 5 % | Peor cociente |
    |---|---|---|---|
    | 74 ELU persistentes | 33 % | 10 % | 0,76 |
    | 138 ELU (persistentes + sísmicas) | 58 % | 34 % | 0,68 |
    | 138 ELU, sólo pilares con 0,3 ≤ η ≤ 1,5 | 73 % | 40 % | — |

  - **Causa.** La flexión esviada la gobierna la pareja (My, Mz) simultánea, por ejemplo +EY +0,3·EX, y el extremo de un solo momento lleva el otro con el signo que favorece al primero.
  - **Mismo problema en otras comprobaciones con interacción:** zapata (N, Mx, My, H), punzonamiento (VEd, MEd → β), torsión-cortante y M+N en vigas.
- **Evidencia:**
  - `bun env_bench.ts` → `salida_env_bench.txt`, bloque [B].
  - Peor caso: pilar 33, η de todas = 1,334 con «ELU-S +EY+e +0.3EX-e», η de los extremos = 0,905.
  - `calcRCColumn` usa |MEdy| y |MEdz| con interacción esviada (`rcColumns.ts:475-512`).
  - La práctica coincide en dos memorias españolas independientes con el mismo texto tipo CYPE: «Para el dimensionado de los soportes se comprueban para todas las combinaciones definidas» (`fuentes/p2115.txt:193-195`; anexo 589353-VCEE de la Junta de Castilla y León).
  - ETABS muestra la comprobación PMM por combinación y estación (docs.csiamerica.com, `CF_Interactive_Concrete_Frame_Design.htm`).
- **Recomendación:**
  - El `DesignActionExtractor` de pilares, zapatas, encepados y punzonamiento debe pedir el vector completo por combinación, nunca la envolvente.
  - Añadir a §12.2 una consulta `getFrameForcesForCombos(physicalId, stations, comboIds) → Float64Array[combo][estación][6]`.
  - La envolvente con concomitantes queda para la UI (diagramas e identificación de la gobernante) y para mecanismos sin interacción (M y V de vigas por separado, como hace hoy `calcRCBeam`).

### RES-03 · PyNite 3.2.0 da los esfuerzos de barra con el signo opuesto al de SAP2000/ETABS en las seis componentes y supone el eje Y vertical
- **Soporte:** A — experimento `exp_pynite_signos_barras.py` y código fuente de PyNiteFEA 3.2.0 (`pip download`).
- **Prioridad:** P0
- **Afecta a:** §5.2, §9.1, §12.1 y §23 (preguntas 6 y 12) — añade
- **Hallazgo:**
  - **Ménsula de 2 m a lo largo de +X** (ejes locales = globales), carga en la punta:

    | Carga en la punta | Lectura de PyNite en el empotramiento | Convención CSI |
    |---|---|---|
    | FX = +1 (tracción) | `axial` = −1 | P = +1 |
    | FY = −1 | `shear('Fy')` = +1, `moment('Mz')` = +2 (tracción en la fibra +y) | V2 = −1, M3 = −2 |
    | FZ = −1 | `moment('My')` = +2 | M2 = −2 |
    | MX = +1 | `torque` = −1 | T = +1 |

    Es decir, PyNite = −CSI en las seis componentes, con ejes locales coincidentes.
  - **Ejes locales.** `Member3D.T()` toma Y como vertical:
    - pieza «vertical» si Xi = Xj y Zi = Zj;
    - en las horizontales, el eje y local es el Y global;
    - la orientación se da con un ángulo `rotation`, no con un vector.

    Un pilar de Concreta (Z arriba) cae en la rama «horizontal», con local y = (0, 1, 0) y z = (−1, 0, 0) medidos.
  - **Convenciones del resto de Concreta:**
    - `fem2d`: N + = tracción y M + = vano respecto a +y_local, como CSI P y M3; V = dM/dx (= −V2 de CSI);
    - módulos de pilares: Nd + = compresión;
    - madera: N + = tracción.
- **Evidencia:**
  - `salida_pynite_signos_barras.txt`.
  - `pynite/pynitefea-3.2.0/Pynite/Member3D.py:957` (rama vertical), `:973` (`y = [0, 1, 0]`) y `:1004` (`rotation`).
  - CSI Analysis Reference Manual, «Internal Force Output»: fuerzas positivas sobre la cara + en sentido +; «Positive bending moments cause compression at the positive 2 and 3 faces» (`fuentes/csiref.txt:6514-6522`).
  - `src/features/fem2d/types.ts:23-41` y `solver2d.ts:32-39`.
  - `data/defaults.ts:103` (`Nd … compression positive`), `:316` (`Ned … positive = compression`).
  - `timberFrameMember.ts:58-59` (`N con signo: + tracción`).
- **Recomendación:**
  - Fijar en el adaptador una tabla de conversión probada componente a componente: test de contrato con la misma ménsula en las tres orientaciones y un pilar Z-arriba.
  - Calcular el ángulo `rotation` a partir del vector de referencia de Concreta y comprobarlo en el test, sin fiarse de la rama «vertical» de PyNite.
  - El `ResultModel` usará la convención de RES-06, nunca la de PyNite.

### RES-04 · En las láminas de PyNite 3.2.0, `membrane()` devuelve tensiones y no Nx; la salida global revienta con NumPy 2.5 y es errónea: sólo vale `local=True`
- **Soporte:** A — experimentos `exp_pynite_signos_placas.py` y `exp_pynite_mx_significado.py`, y código de `Quad3D.py`.
- **Prioridad:** P0
- **Afecta a:** §12 (`ShellResultBlock` espera Nx, Ny, Nxy), §15.4 y §23 (pregunta 3) — corrige
- **Hallazgo:**
  - **Membrana.** Con Nx = 1,0·10⁶ N/m aplicado a una placa de t = 0,20 m, `membrane()` devuelve 5,0·10⁶: es σx = Nx/t (Pa). Hay que multiplicar por t.
  - **Flexión.** En una losa unidireccional (q = 10 kPa, luz 4 m), Mx = −19 754 N·m/m ≈ −q·a²/8 y My = −1 808:
    - Mx es el momento que produce σx (no el que actúa «alrededor de x»);
    - Mx es positivo con tracción en la cara +z local (∫ z·σx dz). Con la normal hacia arriba, el momento de vano sale negativo.
  - **Signo de la presión.** La presión positiva actúa según +z local.
  - **Salida global (`local=False`):**
    - con NumPy 2.5.3 lanza `TypeError: only 0-dimensional arrays can be converted to Python scalars` (`Quad3D.py:1159`);
    - aunque no reventara, su álgebra cambia el signo sólo de My (`:1160`) y aplica R·M·Rᵀ en vez de Rᵀ·M·R (`:1168`; lo mismo en membrana, `:1230`).

    En una placa girada 30°:

    | Cálculo | Mx | My | Mxy |
    |---|---|---|---|
    | Correcto | −5 765 | −2 394 | 656 |
    | Álgebra de PyNite | −767 | 217 | 4 427 |

    Sin girar, el álgebra de PyNite da My = +3 805 frente a −3 805 en local.
  - **Resultados locales.** Son invariantes frente al giro: coinciden al 1e-8 entre la placa girada y la sin girar.
  - **Cortante.** Qx extrapolado al borde apoyado vale 16 742 N/m frente a q·a/2 = 20 000 (−16 %).
- **Evidencia:** `salida_pynite_signos_placas.txt`, `salida_pynite_mx_significado.txt`; `pynite/pynitefea-3.2.0/Pynite/Quad3D.py:1095-1177` y `:1180-1239`.
- **Recomendación:**
  - El adaptador llama sólo a `moment/shear/membrane(local=True)` y hace Nx = t·Sx.
  - Concreta transforma tensores con su propio código y un test del caso girado 30° como fixture.
  - Registrar en ADR-009 la versión de NumPy: el fallo depende de ella. En el NumPy de Pyodide 314 puede no reventar, pero el error de álgebra sigue.
  - No usar Qx de lámina en bordes ni junto a apoyos para comprobar cortante: usar reacciones o integrar por bandas.
  - Avisar al área 1.

### RES-05 · Clasificar la estructura sin análisis de pandeo es viable con la fórmula de planta, pero con rigidez bruta el αcr del hormigón sale unas 3 veces optimista (fem2d ya lo hace así) y PyNite `Kg` ignora las placas
- **Soporte:** A — código de `fem2d` y de PyNite; B — CE Anejo 19 §5.8.2(6), §5.8.3.3 y Apéndice H, y CE Anejo 22 §5.2.1(4)B. La equivalencia αcr,nominal ≈ αcr,bruto/3 es una aproximación (C).
- **Prioridad:** P0
- **Afecta a:** §2.2 (P-Delta fuera del MVP) y §13 (pilares) — añade (el diseño no dice cómo clasificar la estructura)
- **Hallazgo:**
  - **Lo que hace hoy `fem2d`.** Calcula αcr = (H/V)·(h/δ) por planta con una sonda de carga lateral unitaria (método de la Anejo 22 §5.2.1(4)B, válido para «pórticos planos convencionales»).
    - Para el HA usa la rigidez bruta E = 8500·∛(fck+8) e I bruta, y el mismo umbral 10 que el acero.
    - El CE Anejo 19 exige otra cosa para el hormigón: el criterio H.1 (FV,Ed ≤ 0,1·FV,BB) con EI = 0,4·Ecd·Ic si está fisurado, o 0,8 si se demuestra que no lo está, con Ecd = Ecm/1,2 (H.1.2(3) y §5.8.6(3)). Las alternativas son §5.8.3.3 (5.18) o la amplificación H.2(3)/(H.8) a partir de la deformación de primer orden con rigidez nominal.
    - Si toda la rigidez lateral es de hormigón, αcr,nominal ≈ αcr,bruto·0,4/1,2 = αcr,bruto/3. Para despreciar los efectos globales hace falta entonces αcr,bruto ≳ 30 (≳ 15 sin fisurar). Una estructura de HA con 10 ≤ αcr,bruto < 30 sale hoy «intraslacional» cuando el CE pediría segundo orden.
  - **En 3D la fórmula de planta:**
    - sirve por dirección X e Y con dos casos laterales unitarios extra (reutilizan la factorización);
    - no capta el modo torsional.
  - **PyNite `Kg`.** «Geometric stiffness of plates is not considered». Un αcr por autovalores perdería el P-Δ de la carga que llevan los muros. La fórmula de planta usa la V total y no tiene ese problema.
- **Evidencia:**
  - `fem2d/checks.ts:82-96` y `:149` (`ALPHA_CR_FIRST_ORDER = 10`).
  - `lib/frame-core/sections.ts:72-84` (`rcStiffness`, I bruta).
  - CE A19 §5.8.2(6) (despreciable si < 10 %), §5.8.3.3 y sus condiciones (simetría, sin cortante global y otras), y Apéndice H.1.2(3) y H.2(3) (`fuentes/ce.txt:41690-41720, 41840-41890, 49300-49470`).
  - CE A22 §5.2.1(4)B y NOTA 2B (`fuentes/ce.txt:58629-58700`).
  - `pynite/.../FEModel3D.py:1803`.
- **Recomendación:**
  - MVP: αcr por planta y dirección con la fórmula de planta, con los desplazamientos de dos casos laterales unitarios y la V total de cada combinación.
  - Para el HA, escalar por la rigidez nominal (0,4·Ecd/Ecm) o resolver los dos casos con E reducido. Corregir `fem2d` de la misma forma.
  - Avisar si el desplome de los pilares de una planta varía mucho (giro en planta, modo torsional) y si se incumplen las condiciones de §5.8.3.3.
  - Mientras no haya P-Delta, emparejar los momentos amplificados con β = 1, como `fem2d`.
  - P2: pandeo por autovalores (`Ke`, `Kg`) sólo si se añade la `Kg` de las láminas.

### RES-06 · Convención de signos y nombres recomendada para Concreta: la regla CSI («momento positivo = tracción en la cara negativa») con los ejes del Eurocódigo
- **Soporte:** A — medido en PyNite (RES-03 y RES-04); B — manuales de CSI y RFEM; C — CYPE (sin documento de signos encontrado).
- **Prioridad:** P0
- **Afecta a:** §5.2, §2.1, §12.1, §15.3-4 y §23 (pregunta 12) — añade
- **Hallazgo:**

  *Barras* (x de i a j; tabla con ejes locales coincidentes)

  | Magnitud | PyNite 3.2.0 (medido) | SAP2000/ETABS | RFEM | CYPE 3D | fem2d | Módulos de comprobación | **Concreta 3D (propuesta)** |
  |---|---|---|---|---|---|---|---|
  | N | `axial` + = compresión | P + = tracción | N + = tracción | N | N + = tracción | Nd/Ned + = compresión (pilares); N + = tracción (madera) | **N + = tracción** |
  | Vy, Vz | −V2, −V3 | fuerza sobre la cara + en sentido + | — | Vy, Vz | V = dM/dx (= −V2) | \|V\| | **= V2/V3 de CSI** |
  | T | −T de CSI | vectorial sobre la cara + | — | Mt | — | ninguno lo usa | **= T de CSI** |
  | My | + = tracción en la fibra +z | M2: + = compresión en la cara +3 | My + = tracción en la fibra +z, con z local hacia abajo por defecto | My (giro respecto a Y local) | M + = vano | \|My\| (eje fuerte; rcColumns MEdy usa h) | **My + = tracción en la fibra −z** |
  | Mz | + = tracción en la fibra +y | M3: + = compresión en la cara +2 | — | Mz | — | \|Mz\| | **Mz + = tracción en la fibra −y** |
  | Ejes | Y global vertical; ángulo `rotation` | eje 2 hacia arriba | Z global hacia abajo | ejes locales | y = x girado 90° | — | **z = dirección del canto h (vector de referencia explícito), y = z × x** |

  *Láminas* (z local = normal; en forjados, hacia arriba)

  | Magnitud | PyNite Quad3D (medido) | SAP2000/ETABS | RFEM | CYPECAD | **Concreta (propuesta)** |
  |---|---|---|---|---|---|
  | Membrana | `membrane()` = σx, σy, τxy en Pa | F11 = ∫σ11 dx3 | nx | — (diafragma rígido) | **Nx, Ny, Nxy por unidad de longitud, tracción + (= t·σ)** |
  | Flexión | Mx produce σx; + = tracción en la cara +z | M11 = −∫x3·σ11: produce σ11, + = tracción en la cara −3 | mx produce σx («no alrededor de x»); + = tracción en la cara +z | emparrillado de barras ≤ 25 cm; momentos por metro según X e Y | **Mx produce σx; + = tracción en la cara −z (vano positivo)** |
  | Torsor | Mxy, se transforma como tensor con Mx y My | M12 = −∫x3·σ12 | mxy | implícito en la torsión de las barras | **Mxy = −∫ z·τxy dz** |
  | Cortante | Qx, Qy con el mismo signo que V13 en el ensayo | V13 = ∫σ13 | vx, vy | — | **Qx, Qy = V13/V23 de CSI** |

  Conversión desde PyNite con ejes locales coincidentes:
  - barras: N = −axial, Vy = −Fy, Vz = −Fz, T = −torque, My = −My, Mz = −Mz;
  - láminas: Nx = t·Sx, Mx = −Mx, My = −My, Mxy = −Mxy, Qx = +Qx.
- **Evidencia:**
  - RES-03 y RES-04.
  - CSI Analysis Reference Manual, «Internal Force and Stress Output» del Shell: M11 = −∫ x3·σ11 dx3, «Positive internal moments correspond to a state of stress … positive at the bottom» (`fuentes/csiref.txt:9270-9365`).
  - RFEM 6, manual 002714 («mx … generates bending stresses in the x-direction (not about the x-axis!)»; tracción en la cara +z con Z global hacia abajo; «if the global Z-axis is aligned upwards, the signs are reversed»).
  - CYPE: info.cype.com, losas macizas (barras ≤ 25 cm, rigidez a torsión considerada) y «momentos por metro de ancho en X e Y».
- **Recomendación:**
  - Adoptar la columna «Concreta» como contrato del `ResultModel`.
  - Es la misma regla para barras y láminas («positivo = vano» con z hacia arriba) y coincide con el lenguaje de los módulos (M+ vano, M− apoyo) y con SAP2000/ETABS, lo que facilita la validación de §10.2.
  - Renombrar `localYAxis` de §8 a un vector que diga lo que es (dirección del canto h = z local), para que My sea siempre el eje fuerte de una viga y coincida con MEdy de `rcColumns`/`steelColumns`.
  - En muros, fijar la normal (por ejemplo, a la izquierda del sentido de la línea base) y dibujarla (§15.4).

### RES-07 · La envolvente con índice de combinación gobernante cuesta 2,5 MB y 0,1–0,35 s para 2 000 barras; los concomitantes se recuperan bajo demanda en 0,3 µs. El caro es `calcRCColumn` (~140 µs por llamada)
- **Soporte:** A — `env_bench.ts` ejecutado con bun 1.3.14 en esta máquina.
- **Prioridad:** P1
- **Afecta a:** §11.2, §12 y §14.3 — confirma (combinar en Concreta) y añade (presupuesto)
- **Hallazgo:**
  - **Escenario:** 2 000 barras × 11 estaciones × 6 esfuerzos (132 000 valores por caso). Coste de la envolvente:

    | Casos → combinaciones | Resultados base | Tiempo (JIT caliente) |
    |---|---|---|
    | 8 → 60 | 8,1 MB | 97–151 ms |
    | 11 → 138 | 11,1 MB | 340 ms |
    | 11 → 176 | 11,1 MB | 219 ms |

  - **Memoria:**
    - materializar todas las combinaciones costaría 60–177 MB;
    - max/min + índice Uint16 de la combinación gobernante: 2,5 MB;
    - guardar además el vector concomitante completo: 14,6 MB.
  - **Concomitantes bajo demanda.** 200 000 consultas en 44–74 ms (0,22–0,37 µs cada una), con error 0 frente al extremo almacenado.
  - **Coste de las comprobaciones de pilar.** `calcRCColumn` tarda 129–156 µs por llamada. 300 pilares × 2 extremos × 138 combinaciones son 82 800 llamadas: 10,8–12,9 s.
- **Evidencia:** `salida_env_bench.txt`, bloques [A] y [B].
- **Recomendación:**
  - Guardar sólo los casos base (`Float64Array`, por caso), las definiciones de combinación (factores) y, por envolvente, max/min más `Uint16Array` de índices. Los concomitantes se calculan en la consulta.
  - Para las comprobaciones, un núcleo numérico rápido en `rcColumns` (sin `CheckRow` ni cadenas) que se ejecute en el Worker por combinación. Llamar al `calcRCColumn` completo sólo con la combinación gobernante, para el informe.
  - Optimización P2: si se usa un índice radial convexo (como el L1/L2 de ETABS), basta evaluar los vértices de la envolvente convexa de los puntos (N, My, Mz).

### RES-08 · Wood–Armer validado: hay que aplicarlo por combinación; aplicado a envolventes es siempre conservador (hasta +73 %) e ignorar Mxy es inseguro
- **Soporte:** A — `wood_armer.py` contra un ejemplo publicado de LUSAS, más una comprobación de optimalidad por fuerza bruta y la losa plana con PyNite.
- **Prioridad:** P1
- **Afecta a:** §13.2 y la fase 5 de §20 — confirma (capa de diseño separada) y añade (por combinación)
- **Hallazgo:**
  - **Validación contra LUSAS CSN/LUSAS/1029:**

    | Caso | Implementación | LUSAS |
    |---|---|---|
    | Combinado | 181,68 / 229,17 / −227,38 / −179,89 | 181,67 / 229,16 / −227,38 / −179,89 |
    | Suma por casos (incorrecta) | 184,97 / 238,14 / −229,90 / −182,41 | 184,96 / 238,14 / −229,91 / −182,41 |

  - **Optimalidad.** En 20 000 casos aleatorios, que cubren las cuatro ramas (8 615 principal, 4 045 con mx* = 0, 3 933 con my* = 0, 3 407 sin armadura), no hay ninguna violación del criterio de Johansen y el resultado no excede el óptimo hallado por búsqueda.
  - **Envolvente frente a Wood–Armer por combinación.** Wood–Armer es monótono en mx, my y |mxy|, así que aplicarlo a la envolvente componente a componente siempre queda del lado seguro, pero sobredimensiona. En la losa plana 12 × 12 m con 16 combinaciones de alternancia:
    - armadura inferior: +28 % / +59 % / +73 % (h = 1,0 / 0,5 / 0,25 m);
    - armadura superior: +52 % / +33 % / +43 %.
  - **Ignorar Mxy** deja a cero la armadura donde Wood–Armer la exige: cociente mínimo 0,19 en h = 1 m y 0 en las mallas finas.
  - **RFEM** advierte que sus esfuerzos de dimensionado «must not be combined».
- **Evidencia:** `salida_wood_armer.txt`, `salida_wa_bruteforce.txt`, `salida_losa_plana.txt`; `fuentes/lusas1029.txt` (CSN/LUSAS/1029, tablas 1-3); RFEM 6, manual 002714.
- **Recomendación:**
  - En la capa de diseño de láminas, calcular Wood–Armer en cada punto y para cada combinación ELU a partir de (Mx, My, Mxy) concomitantes. Guardar el máximo por cara y dirección más el índice de la combinación.
  - Usar `wood_armer.py` y los dos oráculos (LUSAS y fuerza bruta) como fixtures del port a TypeScript.
  - El método del sándwich (CE Anejo 21, Apéndice LL) y la membrana del Apéndice F del Anejo 19 quedan en P2 para muros con Nx, Ny, Nxy.

### RES-09 · El pico de momento sobre un pilar puntual crece con la malla (+65 %) y el de cara de pilar es errático, pero la integral por bandas converge (±1 %): la losa se dimensiona por bandas, no por valores puntuales
- **Soporte:** A — `exp_losa_plana.py`: PyNite, losa plana 12 × 12 m sobre 3 × 3 pilares, h = 0,25 m, mallas de 1,0 / 0,5 / 0,25 m. B — CE Anejo 19 §5.3.2.2 y Apéndice I.
- **Prioridad:** P1
- **Afecta a:** §13.2, §12.1 («el suavizado visual no sustituye al dato bruto») y §15.4 — corrige (ΔM = F·t/8 no es la herramienta aquí)
- **Hallazgo:** con la combinación de todos los paños cargados sobre el pilar central:

  | Malla | Mx en el nudo | Mx en la cara (x = 6,20) | ∫ banda de pilar (3 m) | ∫ pórtico virtual (6 m) |
  |---|---|---|---|---|
  | h = 1,0 m | 192,9 kN·m/m | 153 kN·m/m | 211 kN·m | 331 kN·m |
  | h = 0,5 m | 254,6 kN·m/m | 165 kN·m/m | 264 kN·m | 337 kN·m |
  | h = 0,25 m | 318,7 kN·m/m | 112 kN·m/m | 261 kN·m | 337 kN·m |

  - **Reparto.** La banda de pilar se lleva el 77 % del momento negativo, dentro del 60–80 % de la tabla A19.I.1.
  - **ΔM = F·t/8.** El §5.3.2.2(4) es para apoyos «supuestamente sin coacción al giro (por ejemplo sobre muros)», con la reacción por unidad de ancho. En un pilar puntual (F = 715 kN, t = 0,40 m) daría 35,7 kN·m en total, no por metro: dimensionalmente no aplica.
  - **Uniones monolíticas.** El §5.3.2.2(3) manda tomar el momento en la cara del apoyo, no menor que una fracción del de empotramiento perfecto (la NOTA del BOE: el factor no se extrajo del PDF).
  - **Coste en PyNite** (CPython de escritorio): 4,4 / 16,8 / 77 s de análisis para 1 014 / 3 750 / 14 406 GDL.
- **Evidencia:**
  - `salida_losa_plana.txt`.
  - CE A19 §5.3.2.2(3)-(4) (`fuentes/ce.txt:41363-41420`) y Apéndice I.1.1(2) (elementos finitos admitidos), I.1.2(3) y tabla A19.I.1, e I.1.3 (`fuentes/ce.txt:49476-49560`).
  - CSI SAFE, «Strip force integration» (web.wiki.csiamerica.com).
- **Recomendación:**
  - MVP de losas: bandas de dimensionado (de pilar e intermedias, Apéndice I) definidas sobre el modelo físico.
  - Integrar Mx, My y Mxy en las estaciones de la banda y, por combinación, aplicar Wood–Armer (RES-08) a los valores medios de la banda o a cada punto antes de integrar. Pasar el resultado a `rcSlabs`/forjados por metro o por nervio.
  - No dimensionar nunca con picos nodales; mostrarlos como dato bruto marcado.
  - Modelar la huella del pilar (zona rígida o varios nudos): coordinarlo con el área 2.
  - No implementar F·t/8 para pilares de losa plana.

### RES-10 · Los módulos de comprobación esperan magnitudes en kN, kN·m y mm/m con un solo juego de esfuerzos por llamada; ninguno lee signos, M01/M02, Mz de viga ni T
- **Soporte:** A — código leído.
- **Prioridad:** P1
- **Afecta a:** §13, §5.1 y §23 (pregunta 12) — contradice §5.1 (SI interno) en lo práctico y añade el contrato del extractor
- **Hallazgo:**

  | Módulo | Entradas | Signo | Unidades |
  |---|---|---|---|
  | `rcColumns` | `Nd` ≥ 1, `MEdy` (usa h), `MEdz` (usa b), `L`, `beta` | Nd + = compresión; usa \|M\|; λlím con C = 0,7 fijo, sin M01/M02 | kN, kN·m, mm, m |
  | `steelColumns` | `Ned`, `My_Ed`, `Mz_Ed`, `Ly`/`Lz`, `beta` | Ned + = compresión; \|M\|; Cm = 1 (método 2) | kN, kN·m, mm |
  | `rcBeams` | `vano_Md`, `apoyo_Md`, `VEd`, `M_G`/`M_Q` | \|M\|; la cara la decide la región | kN·m, kN, mm |
  | adaptador 1D (`fem-analysis`) | regiones fijas [0,25; 0,75] y [0; 0,15] ∪ [0,85; 1] | suma 1,35·G + 1,5·ΣVar | — |
  | `steelBeams` | `MEd`, `VEd`, `Lcr`, `Mser` | \|M\|; sólo eje fuerte | — |
  | `timberFrameMember` | `N`, `M`, `V` | N con signo (+ = tracción); \|M\| de eje fuerte | — |
  | `isolatedFooting` | un solo juego (N, Mx, My, H) | \|Mx\|, \|My\|; H sin dirección; ELU = γ·ELS con γ global | — |
  | `pileCap` | `N_Ed`, `Mx_Ed`, `My_Ed` | con signo (Navier) | — |
  | `punching` | `VEd`, β simplificado o manual | — | — |
  | forjados | `vano_Md`, `apoyo_Md` por metro o por nervio | — | — |

  Ninguno usa T. `lib/acciones`, `frame-core` y `fem2d` trabajan en kN y m.
- **Evidencia:**
  - `src/data/defaults.ts:15-129, 131-168, 286-341, 534-571, 675-731, 845-868, 1000-1030`.
  - `rcColumns.ts:465-488`, `steelColumns.ts:209-210, 367-400`, `rcBeams.ts:615-652`.
  - `fem-analysis/adapters/rcBeams.ts:38-45`, `isolatedFooting.ts:119-131`, `timberFrameMember.ts:45-63`.
  - `punching.ts:32-36, 143-149`, `pileCap.ts:628-636`.
- **Recomendación:**
  - Un único `DesignActionExtractor` por tipo de módulo, con conversión de unidades y signos en un solo sitio y tests.
  - Por pilar físico y combinación, exportar N, My y Mz en cabeza y pie (con signo), Vy, Vz, T, L de planta, sección, orientación (qué eje es h) y la clasificación traslacional de RES-05. Hoy el módulo usa max(|M|) por extremo, que es conservador. En P2, M01/M02 → rm → C = 1,7 − rm en pilares arriostrados y Cm = 0,6 + 0,4·ψ en acero.
  - Reutilizar la lógica de `fem2d/checks.ts` (por combinación, encaminamiento por mecanismo), no los adaptadores 1D.
  - Unidades: un sistema coherente kN–m (kN, kN·m, kN/m², E en kN/m²) evita factores 10³ en cada frontera con módulos, acciones y `fem2d`, y es tan inequívoco como el N–m–Pa de §5.1. Si se mantiene §5.1, la conversión vive sólo en el extractor.

### RES-11 · El torsor y la flexión de eje débil en vigas no tienen consumidor: hay que tratarlos como diagnóstico, no descartarlos en silencio
- **Soporte:** A — código (grep sin resultados de TEd en los módulos); B — CE A19 §6.3.1.
- **Prioridad:** P1
- **Afecta a:** §2.1 (mostrar T), §9.2 («nunca … se descartará una componente») y §13.1 — añade
- **Hallazgo:**
  - **Torsor.** Ningún módulo comprueba TEd: `rcBeams`, `steelBeams` y madera sólo leen M, V y N.
  - El CE A19 §6.3.1(2) permite no considerar la torsión en ELU cuando es de compatibilidad y la estabilidad no depende de ella, con armadura mínima. Con torsión de equilibrio (§6.3.1(1)) hace falta un cálculo completo.
  - **Flexión de eje débil.** Mz en vigas sólo la absorbe `steelColumns`, por interacción. `timberFrameMember` y `calcSteelBeam` sólo tratan el eje fuerte.
- **Evidencia:** `grep TEd|torsi` sobre `src/lib/calculations/*.ts` (sólo pandeo lateral y Mcr); `fuentes/ce.txt:43367-43380`; `timberFrameMember.ts:59-62`.
- **Recomendación:**
  - Fila «Torsión: pendiente / no comprobada» con el valor de TEd cuando |TEd| supere un umbral relativo, y diagnóstico en la viga física.
  - Opción de modelo para reducir GJ de las vigas de HA (torsión de compatibilidad): documentarla en la huella del modelo.
  - Encaminar las vigas de acero con Mz o N relevantes a `calcSteelColumn`, como ya hace `fem2d` con N.

### RES-12 · ResultModel: `fem2d` guarda `Record<LC, number[]>` con 41 muestras y envolventes de «máximo valor absoluto con signo» que pierden el signo contrario; en 3D conviene SoA en Float64 por caso, con max y min, y consultas por combinación
- **Soporte:** A — código y medidas de RES-07.
- **Prioridad:** P1
- **Afecta a:** §12 y §12.2 — confirma la estructura SoA y corrige detalles
- **Hallazgo:**
  - **Cómo guarda hoy `fem2d`:**
    - por elemento, `samples.{N,V,M,w,u}[lc]: number[]` con 41 muestras;
    - `reactionsByLc` como objetos;
    - las envolventes de cada vista de combinación se precalculan en cada edición y conservan sólo el valor de mayor |·| (`buildEnvelope`), perdiendo el signo contrario (vano y apoyo, inversión por viento). El 1D hace lo mismo (`solveDesignModel.ts`).
  - **Ese patrón en 3D.** 2 000 barras × 41 muestras × 5 campos × 11 casos = 36 MB, más el coste de los objetos. Con 11 estaciones y `Float64Array` por caso: 11 MB, transferibles.
  - **Precisión.** Float32 (ε ≈ 6e-8) no permite verificar el equilibrio a 1e-8 (§18.2).
  - **Identificadores.** `elementIds: Id[]` en el bloque no es transferible; el `AnalyticalModel` ya está en el hilo principal.
  - **Extracción en PyNite.** Por llamadas Python cuesta 0,44 ms por (quad, caso) en CPython (2 304 × 5 en 5,1 s): un dato para el área 1.
- **Evidencia:**
  - `fem2d/solver2d.ts:53-108`, `fem2d/checks.ts:784-814` (`if (Math.abs(m) > Math.abs(bM)) bM = m`) y `:415-440`.
  - `fem-analysis/solveDesignModel.ts:45-60` (`buildBarEnvelope`, línea 51).
  - `salida_env_bench.txt` y `salida_losa_plana.txt`.
- **Recomendación:**
  - **Estructura:**
    - por caso, un solo `Float64Array`, con barras por estación × 6 y láminas por punto de integración × 8;
    - `stationOffsets` como `Uint32Array` e índices densos;
    - envolventes con max y min por componente, más `Uint16Array` de la combinación gobernante;
    - estaciones por elemento analítico: extremos, cuartos, puntos de carga y extremos internos (V = 0).
  - **Consultas mínimas del MVP:**
    1. `getFrameDiagram(physicalId, comp, {case|combo|envelope})` → x físico, valores (max y min) y combinación gobernante;
    2. `getFrameForcesForCombos(physicalId, stations, comboIds)` (RES-02);
    3. `getConcomitant(physicalId, station, comp, 'max'|'min')`;
    4. `getSupportReactions(supportId, comboIds)` (RES-14);
    5. `getShellField(physicalId, comp, selector, 'gauss'|'nodes-unaveraged'|'nodes-averaged-visual')`;
    6. `getStripResultants(stripId, comboIds)` con Wood–Armer (RES-08, RES-09);
    7. `getStoreyDrifts(dir, combo)` (RES-05, RES-16).

### RES-13 · La situación sísmica exige su propio tipo de combinación y sus coeficientes de material (γc = 1,3; γs = 1,0), que los módulos no admiten hoy; el análisis espectral futuro perderá la concomitancia
- **Soporte:** B — DB SE 4.2.2(3), NCSE-02 §3.2 y §3.4, CE A19 tabla A19.2.1, manual de CSI; A para el código (`factors.ts`).
- **Prioridad:** P1
- **Afecta a:** §11.1 (`limitState`), §11.3 y la evolución (modal y sísmico) — corrige
- **Hallazgo:**
  - **Combinaciones.** En sísmica: Gk + Ad + Σψ2·Qk, sin γ (4.5), con 100/30 en dos direcciones y excentricidad accidental ≥ 1/20. Son 32 combinaciones direccionales, 64 con y sin ψ2·Q (RES-01).
  - **Coeficientes de material.** El CE A19 da γc = 1,3 y γs = 1,0 en situación accidental, y la NCSE-02 §3.4 asimila la sísmica a accidental si la norma del material no dice otra cosa.
  - **Los módulos tienen γc fijo** (`data/factors.ts:2`, `GAMMA_C = 1.5`): comprobar el sismo con 1,5 es conservador, pero no coincidirá con CYPE.
  - **Análisis espectral.** CSI no ofrece correspondencia (concomitancia) para casos de espectro de respuesta ni combos SRSS/CQC. Mientras el sismo venga del módulo NCSE-02 como fuerzas estáticas equivalentes con signo, la superposición vale.
- **Evidencia:** `fuentes/dbse.txt:660-681`; `fuentes/ncse02.txt:782-815, 1389-1409`; `fuentes/ce.txt:39632-39660`; `fuentes/csiref.txt:14947-14960`.
- **Recomendación:**
  - Etiquetar cada combinación con `situation`.
  - Añadir a los motores un parámetro de situación (γc, γs) o, en el MVP, documentar que el sismo se comprueba con los γ persistentes (lado seguro).
  - Cuando llegue el modal, diseñar desde el principio la envolvente sin signo o el método de signo del modo dominante.

### RES-14 · Para cimentaciones hacen falta dos familias de reacciones por combinación (geotécnica con γ = 1 y estructural ELU), sin envolvente; `isolatedFooting` no puede recibirlas hoy
- **Soporte:** B — DB SE-C §2.3.2.2 y tabla 2.1; A para el código del módulo.
- **Prioridad:** P1
- **Afecta a:** §13 y §2.1 («alimentar los módulos existentes») — añade
- **Hallazgo:**
  - **Familia geotécnica.** Para el terreno, el DB SE-C toma la (4.3) del DB SE con coeficiente 1 para las permanentes y las variables desfavorables y 0 para las favorables, y la (4.4)/(4.5) con γ = 1 en las extraordinarias y sísmicas.
  - **Tabla 2.1:** hundimiento γR = 3,0; deslizamiento 1,5; vuelco γE 0,9 (estabilizadoras) y 1,8 (desestabilizadoras). El armado y el punzonamiento de la zapata se hacen en ELU.
  - **Lo que admite hoy `isolatedFooting`:**
    - un solo juego (N, Mx, My, H) y deriva el otro con un γ global (`isolatedFooting.ts:119-131`);
    - usa |Mx| y |My|;
    - una H sin dirección, y el vuelco con |Mx| + |H|·h.
  - **`pileCap`** usa N, Mx y My de ELU con signo frente a `R_adm`.
  - **Volumen.** Las reacciones por apoyo y combinación son pocas: 50 apoyos × 176 combinaciones × 6 = 52 800 valores.
- **Evidencia:** `fuentes/dbsec.txt:285-295, 506-525`; `src/lib/calculations/isolatedFooting.ts:119-131, 364-395`; `pileCap.ts:628-636`; memoria P2115, «A.3.2 Acciones características para comprobar tensiones sobre el terreno».
- **Recomendación:**
  - Consulta `getSupportReactions(supportId, comboIds)` con el vector de 6 componentes con signo, sumado por zapata física según el mapping.
  - Extender `isolatedFooting`/`pileCap` para aceptar una lista de combinaciones etiquetadas (GEO/ELU), con Hx y Hy y momentos trasladados con signo a la base.
  - Iterar todas las combinaciones, nunca la envolvente.

### RES-15 · Del modelo 3D sale β de punzonamiento por combinación (MEd desequilibrado/VEd), que el β simplificado no permite fuera de estructuras arriostradas con luces regulares
- **Soporte:** B — CE A19 §6.4.3; A para el código de `punching.ts`.
- **Prioridad:** P1
- **Afecta a:** §13 (enlace con `punching.ts`) — añade
- **Hallazgo:**
  - `punching.ts` sólo admite β por posición (1,15 / 1,4 / 1,5) o un β manual. Él mismo avisa de que el simplificado sólo vale en estructura arriostrada con luces adyacentes que no difieren más del 25 %.
  - El modelo 3D da, por combinación:
    - VEd = N del pilar inferior − N del superior (la reacción transmitida);
    - MEd = suma de los momentos de pilar en la unión, en x y en y.

    Con ellos, β = 1 + k·(MEd/VEd)·(u1/W1), o bien la (6.43) biaxial.
  - **Concomitancia.** Manda max(β·VEd) por combinación, no max β × max VEd.
- **Evidencia:** `punching.ts:24-36, 143-149, 361-378`; CE A19 §6.4.3(3), (4) y (6).
- **Recomendación:** extractor de punzonamiento que calcule β por combinación (con u1 y W1 desde `punchingGeometria.ts`) y llame a `punching` con `betaMode: 'custom'` sólo en la gobernante; mostrar también el β simplificado como referencia.

### RES-16 · El desplome (H/500 total, h/250 local) es una comprobación del DB SE que sólo puede hacer el modelo 3D, y el diseño no la menciona
- **Soporte:** B — DB SE 4.3.3.2.
- **Prioridad:** P1
- **Afecta a:** §2.1 y §13 — añade
- **Hallazgo:**
  - **Integridad:** con cualquier combinación característica, el desplome total ≤ 1/500 de la altura y el local ≤ 1/250 de la planta.
  - **Apariencia:** desplome relativo ≤ 1/250 en casi permanente.
  - Basta en dos direcciones ortogonales.
  - Los mismos desplomes por planta alimentan el αcr de RES-05.
- **Evidencia:** `fuentes/dbse.txt:878-890`.
- **Recomendación:** consulta `getStoreyDrifts` (desplazamiento horizontal de los nudos de pilar por planta, desde `lib/edificio`) y una comprobación global «Desplomes» en la familia ELS-C/CP; con diafragma flexible, el desplome máximo por planta.

### RES-17 · Las imperfecciones globales exigen casos derivados de cada caso vertical, por dirección, con el signo emparejado al de la acción lateral
- **Soporte:** B — CE A19 §5.2 y A22 §5.3.2; A para el precedente de `fem2d`.
- **Prioridad:** P1
- **Afecta a:** §11.1 y §11.3 — añade
- **Hallazgo:**
  - Las cargas nocionales Hi = φ·Ni (φ = φ0·αh·αm, φ0 = 1/200; exención si HEd ≥ 0,15·VEd en acero) son proporcionales a las cargas verticales de cada combinación.
  - `fem2d` ya las resuelve como casos derivados `NG, NQ, NW, NS, NE` y las funde con la sonda de αcr.
  - En 3D son 2 direcciones × los casos verticales (G, Q, S): 6 casos extra que reutilizan la factorización. Cada combinación debe escoger el signo de la imperfección que agrava su acción lateral (Wx+ ↔ +NX).
- **Evidencia:** `fem2d/checks.ts:163-171, 541-548`; CE A22 §5.3.2 (`fuentes/ce.txt:84807`).
- **Recomendación:** soportar `derivedFrom` y reglas de emparejamiento de signo en el generador de RES-01; en el MVP, incluir las nocionales siempre (lado seguro) y aplicar la exención por planta como en `fem2d`.

### RES-18 · La práctica de referencia combina envolventes por esfuerzo para forjados y todas las combinaciones para soportes; CYPECAD no usa láminas sino emparrillados de barras, lo que condiciona la validación cruzada
- **Soporte:** B — dos memorias independientes con el mismo texto, documentación oficial de CYPE y manual de CSI.
- **Prioridad:** P1
- **Afecta a:** §11.2, §15.3 y §10.2 (CYPE como referencia) — confirma y añade
- **Hallazgo:**
  - **Memorias.** «Para la obtención de las solicitaciones determinantes … de los forjados (vigas, viguetas, losas, nervios) se obtendrán los diagramas envolventes para cada esfuerzo. Para el dimensionado de los soportes se comprueban para todas las combinaciones».
  - **CYPECAD:**
    - losas macizas: barras de 25 cm como máximo, con rigidez a torsión;
    - reticulares: barras a 1/3 del intereje, con inercia a torsión la mitad de la de la zona maciza;
    - momentos y cortantes por metro en X e Y.
  - **CSI «Correspondence».** Las tablas PMax/PMin, …, M3Min son exactamente el `signed-extreme-with-concomitants` de §11.2: 12 filas por estación, concomitancia sólo entre componentes del mismo tipo en la misma estación.
- **Evidencia:** `fuentes/p2115.txt:190-196`; anexo 589353-VCEE (educa.jcyl.es); info.cype.com (?p=185429, ?p=191363, «consulting forces in flat and waffle slabs»); `fuentes/csiref.txt:14848-14960`.
- **Recomendación:**
  - UI: envolventes max/min con «ver concomitantes» al estilo CSI (12 filas).
  - Comprobaciones: por combinación (RES-02).
  - Para validar contra CYPE, comparar integrales por banda o reacciones y momentos de vigas, no momentos puntuales de lámina contra momentos de barra del emparrillado.

## Contradicciones con el diseño técnico

1. **§11.2/§12.2/§13 — la concomitancia definida no basta para comprobar.**
   - «signed-extreme-with-concomitants» deja fuera la combinación pésima en el 33–58 % de los pilares (RES-02).
   - §12.2 no tiene ninguna consulta para obtener esfuerzos por combinación en una estación, que es lo que necesitan pilares, zapatas, encepados y punzonamiento (RES-02, RES-14, RES-15).
2. **§11.1 — el modelo de casos y combinaciones no puede expresar el CTE ni la NCSE-02.**
   - Faltan familias excluyentes, G favorable, variables ausentes, sismo ± con 100/30 y excentricidad, casos derivados y la situación sísmica o accidental (`limitState` sólo distingue ULS y SLS).
   - «Las reglas ya existentes en Concreta» (§2.1, `frame-core`) no sirven tal cual (RES-01, RES-13, RES-17).
3. **§2.2/§13 — los pilares sin pandeo global no son honestos si no se clasifica la estructura.**
   - Se puede hacer con desplomes por planta, pero con rigidez reducida para el HA: el αcr bruto es unas 3 veces optimista.
   - El precedente `fem2d` usa rigidez bruta, y PyNite `Kg` ignora las placas (RES-05).
4. **§5.2/§9.1/§12 — no se puede confiar en la salida «global» del solver ni en la tensión como resultante.**
   - PyNite da el axil + = compresión y signos opuestos a CSI.
   - `membrane()` devuelve tensión.
   - `local=False` falla y su álgebra es errónea (RES-03, RES-04).
5. **§13.2 — ΔM = F·t/8 no es el suavizado aplicable a pilares de losa plana.** Es por unidad de ancho y para apoyos sin coacción al giro. Lo robusto es integrar por bandas (RES-09).
6. **§5.1 — SI (N, Pa) frente a kN y kN·m en todos los módulos, acciones y `fem2d`.** Es una contradicción menor y de criterio (RES-10).

## Preguntas abiertas (lo que no pudiste cerrar y cómo se cerraría)

- **¿Cuánto falla la envolvente con concomitantes en edificios reales?** Mis esfuerzos son sintéticos. Se cerraría exportando de CYPE o ETABS los esfuerzos por combinación de 2 o 3 edificios del estudio y repitiendo `env_bench.ts` [B] con esos datos.
- **¿Cuánto acelera un núcleo numérico de `rcColumns`** sin `CheckRow` ni `dec()`? No lo medí. Se cerraría perfilando `calcRCColumn` (la parte de `computeAxis` frente al formato) y prototipando la ruta rápida.
- **Mapeo exacto de signos con los ejes de Concreta** (z = canto) y PyNite (y vertical, ángulo `rotation`). Medí la convención con ejes coincidentes; falta el test de contrato con la permutación de ejes, de las áreas 1 y 2.
- **Comportamiento en Pyodide.** Si el NumPy de Pyodide 314 también rompe `local=False` (el error de álgebra persiste en cualquier caso) y el coste de extraer resultados lámina a lámina allí. Lo cierra el área 1.
- **Criterio de CYPE para la rigidez a torsión de las vigas de HA** y para γ de material en sismo: hacen falta su memoria de cálculo o un listado. Condiciona cuánto coincidirán las comparaciones de §10.2.
- **Factor del §5.3.2.2(3) NOTA** («no inferior a … veces el momento de empotramiento»): el número es una imagen en el BOE. Se cerraría leyendo esa página renderizada (PyMuPDF).
- **Bandas de dimensionado:** quién las define (el usuario o una generación automática por ejes de pilares) y cómo se integra Wood–Armer (antes o después de promediar en la banda). Es una decisión de producto y UX.
- **Clasificación con el modo torsional:** a partir de qué variación de desplome en planta se exige análisis de pandeo real. Se cerraría con 2 o 3 casos comparando la fórmula de planta con autovalores (`Kg` de barras) en edificios con núcleo excéntrico.

## Experimentos (qué ejecutaste, dónde están los scripts y su salida resumida)

Carpeta: `C:\Users\javie\AppData\Local\Temp\claude\d--PROGRAMACION-Concreta-EST\b287d96a-8882-4d7d-800f-3c46ec2b77b4\scratchpad\fem3d\03-resultados`.

Entorno:
- Python: `venv/` con PyNiteFEA 3.2.0, NumPy 2.5.3 y SciPy 1.18.1 sobre CPython 3.14 de escritorio (no Pyodide), en Windows 11.
- TypeScript: bun 1.3.14. `env_bench.ts` importa en sólo lectura `rcColumns.ts` y `defaults.ts` del worktree.

| Id | Script | Comando | Salida | Resultado |
|---|---|---|---|---|
| E1a | `exp_pynite_signos_barras.py` | `PYTHONIOENCODING=utf-8 ./venv/Scripts/python exp_pynite_signos_barras.py` | `salida_pynite_signos_barras.txt` | axial = −1 con tracción; Mz = +2 y Vy = +1 con FY = −1; My = +2 con FZ = −1; T = −1 con MX = +1; ejes de un pilar Z-arriba: y = (0,1,0), z = (−1,0,0) |
| E1b | `exp_pynite_signos_placas.py` | ídem | `salida_pynite_signos_placas.txt` | losa simplemente apoyada 4 × 4 (16 × 16): w = −4,886e-4 m (Timoshenko 4,729e-4), Mx = My = −7 842 N·m/m (7 664); `membrane()` = 5,0e6 con Nx = 1e6 y t = 0,2; `local=False` lanza `TypeError`; placa girada 30°: álgebra de PyNite (−767 / 217 / 4 427) frente a la correcta (−5 765 / −2 394 / 656) |
| E1c | `exp_pynite_mx_significado.py` | ídem | `salida_pynite_mx_significado.txt` | losa unidireccional: Mx = −19 754 (q·a²/8 = 20 000), My = −1 808; Qx en el borde ±16 742 (q·a/2 = 20 000) |
| E2 | `combos3d.ts` | `bun combos3d.ts` | `salida_combos3d.txt` | 11 casos → 74 ELU-P + 64 ELU-S + 37 ELS-C + 1 ELS-CP = 176 |
| E3 | `env_bench.ts` | `bun env_bench.ts` | `salida_env_bench.txt` | [A] tiempos y memoria de RES-07; [B] concomitancia de RES-02: 44 400 / 82 800 llamadas a `calcRCColumn` a 129–143 µs |
| E4 | `wood_armer.py`, `wa_bruteforce.py` | `./venv/Scripts/python wood_armer.py`, `… wa_bruteforce.py` | `salida_wood_armer.txt`, `salida_wa_bruteforce.txt` | coincide con LUSAS CSN 1029 a 0,01; 0 violaciones del criterio en 20 000 casos, 4 ramas |
| E5 | `exp_losa_plana.py` | `./venv/Scripts/python exp_losa_plana.py 1.0 0.5 0.25` | `salida_losa_plana.txt` (y `salida_losa_plana_025.txt` de una pasada previa sin integrales) | picos 193 / 255 / 319; cara 153 / 165 / 112; banda 211 / 264 / 261; pórtico 331 / 337 / 337; Wood–Armer sobre envolvente frente a por combinación: hasta 1,73 |

Las fuentes descargadas y su texto extraído están en `fuentes/`: `ce.pdf`/`ce.txt` (BOE-A-2021-13681), `dbse.txt`, `dbsec.pdf`/`dbsec.txt`, `ncse02.txt`, `csiref.pdf`/`csiref.txt`, `lusas1029.pdf`/`lusas1029.txt`, `aspire_wa.pdf`/`aspire_wa.txt` y `p2115.txt`. El código fuente de PyNite está en `pynite/pynitefea-3.2.0/`.

## Fuentes

- **Repositorio** (worktree `feat/fem3d`, sólo lectura):
  - `src/lib/frame-core/{types,combinations,lcCombinations,sections}.ts`;
  - `src/features/fem2d/{types,analysis,solver2d,pipeline,checks}.ts`;
  - `src/features/fem-analysis/{solveDesignModel.ts, adapters/rcBeams.ts, adapters/units.ts}`;
  - `src/lib/calculations/{rcColumns,steelColumns,rcBeams,steelBeams,timberFrameMember,punching,isolatedFooting,pileCap,micropiles,rcSlabs}.ts`;
  - `src/data/{defaults,factors}.ts`, `src/lib/edificio/index.ts`, `src/lib/pub/index.ts`, `src/lib/pdf/fem2d.ts`, `docs/fem3d/diseno-tecnico.md`.
- **PyNiteFEA 3.2.0**, sdist de PyPI (`pip download --no-deps --no-binary :all: PyNiteFEA`): `Pynite/Member3D.py`, `Quad3D.py` y `FEModel3D.py`.
- **Código Estructural**, RD 470/2021, BOE-A-2021-13681 — https://www.boe.es/boe/dias/2021/08/10/pdfs/BOE-A-2021-13681.pdf:
  - Anejo 18, Apéndice A.1;
  - Anejo 19: §2.4.2.4 (tabla A19.2.1), §5.2, §5.3.2.2, §5.8.2-5.8.3.3, §6.3.1, §6.4.3, Apéndice F, Apéndice H y Apéndice I;
  - Anejo 21, Apéndice LL;
  - Anejo 22: §5.2.1(4)B y §5.3.2.
- **CTE DB SE** (copia local `ejemplos just DB SE/DBSE.pdf`): §4.2.2, tablas 4.1 y 4.2, §4.3.3.2.
- **CTE DB SE-C** — https://www.codigotecnico.org/pdf/Documentos/SE/DBSE-C.pdf: §2.3.2.2 y tabla 2.1.
- **NCSE-02** (copia local `sismo ejemplos/NCSE02 bonita.pdf`): §3.2, §3.4 y §3.7.5.
- **CSI Analysis Reference Manual** — https://docs.csiamerica.com/manuals/sap2000/CSiRefer.pdf: «Frame Internal Force Output», «Shell Internal Force and Stress Output» y «Load Combinations — Correspondence».
- **ETABS**, *Concrete Frame Design Information* — https://docs.csiamerica.com/help-files/etabs/Menus/Design/Concrete_Frame_Design/CF_Interactive_Concrete_Frame_Design.htm
- **CSI SAFE**, *Strip force integration* — https://web.wiki.csiamerica.com/wiki/spaces/safe/pages/1805720/Strip+force+integration
- **Dlubal RFEM 6**, manual en línea 002714 (convención de esfuerzos en superficies) — https://www.dlubal.com/en/downloads-and-information/documents/online-manuals/rfem-6/002714
- **LUSAS CSN/LUSAS/1029**, *Combinations and Wood-Armer Results* — https://www.lusas.com/user_area/documentation/1029_Combinations%20and%20Wood%20Armer%20Results.pdf
- **M. C. Wagner**, «Application of the Wood-Armer Method for Slab Design», ASPIRE, invierno de 2026 — https://aspirebridge.com/magazine/2026Winter/CBT-ApplicationOfWoodArmerMethodOfSlabDesign.pdf
- **R. H. Wood (1968)**, «The Reinforcement of Slabs in Accordance with a Pre-Determined Field of Moments», *Concrete* 2(2), 69-76. Citado por LUSAS; no consultado directamente.
- **CYPE:** losas macizas — https://info.cype.com/?p=185429; reticulares — https://info.cype.com/?p=191363; consulta de esfuerzos — https://info.cype.com/en/subject/cypecad-consulting-quantities-displacements-and-forces-in-flat-and-waffle-slabs/
- **Memorias de proyecto con texto tipo CYPE:** `ejemplos anejos de calculo/P2115_A_anexo A_ESTRUCTURA.pdf` (OREKARIestudio, 2022) y https://www.educa.jcyl.es/en/informacion/obras-equipamientos/direccion-facultativa-coordinacion-seguridad-salud-obra-con.files/589353-VCEE-PE-AnexoMEM-Estructura.doc
