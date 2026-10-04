# FEM 3D — Documento de I+D

> **Qué es.** La investigación previa al módulo FEM 3D de Concreta, contrastada con el diseño técnico (`docs/fem3d/diseno-tecnico.md`, citado como «§N»). Cada sección es un hallazgo con su soporte y lo que hay que hacer en Concreta.
>
> - **Repositorio:** `jramirezbandera/concreta-FEM` (público desde el 2026-10-04, rama `main`). Se empezó el 2026-10-03 en la rama `feat/fem3d` de Concreta y se trasladó aquí ese mismo día. **Fecha:** 2026-10-03.
> - **Rutas:** las de código (`src/lib/frame-core/…`, `src/features/fem2d/…`, `scripts/vendor-pyslope.mjs`…) son de **Concreta** (`wh0am1-dev/concreta`), el destino final del módulo. Las de `docs/fem3d/…` son de este repositorio.
> - **Motor estudiado:** PyNiteFEA 3.2.0 sobre Pyodide 314.0.0 (numpy 2.4.3, scipy 1.17.1). La revisión tras D9 recomienda un motor propio: ver S0 y S7.
> - **Áreas:** 1 Motor (MOT) · 2 Compilador y mallado (COM) · 3 Resultados y comprobaciones (RES) · 4 Plataforma web (PLA) · 5 Validación (VAL). Revisión del motor: 6 Escala del edificio objetivo (ESC) · 7 Candidatos y licencias (CAN) · 8 Motor propio (MPR).
> - **Soporte:**
>   - **A** = experimento propio en esta máquina, o lectura del código fuente de la versión concreta;
>   - **B** = documentación oficial, norma o ≥ 2 fuentes independientes;
>   - **C** = una sola fuente secundaria o inferencia.
> - **Prioridad:** **P0** condiciona la arquitectura o el spike · **P1** necesario para el MVP · **P2** posterior.
> - **Detalle:** cada ID original (MOT-03, VAL-12…) está en `investigacion/0N-<área>.md`. Los scripts y sus salidas, en `investigacion/experimentos/0N-<área>/`; sus rutas absolutas apuntan a la carpeta temporal de la sesión que los ejecutó.
>
> **Cómo usarlo en una sesión futura:** no cargues el documento entero. Lee el índice (líneas 1–100), elige la sección y léela con su rango de líneas.

## Índice

Hallazgos ordenados por **soporte** (A antes que B), luego por **número de áreas que lo
corroboran por separado** y luego por **prioridad** (P0 antes que P1). Los ID son estables:
H49–H57 se añadieron con la revisión del motor (áreas 6–8) y se intercalan por soporte. Para
leer una sola sección: `Read` con `offset` = primera línea y `limit` = nº de líneas; si las
líneas se han movido, `grep -n "^## H07 " docs/fem3d/investigacion-id.md`.

| ID | Hallazgo | Sop. | Prio. | Áreas | Líneas |
|---|---|---|---|---|---|
| H01 | Láminas: ejes por elemento, membrana en Pa, `local=False` roto y mal; usar local y girar en Concreta | A | P0 | 1, 2, 3, 5 | 153–182 |
| H02 | PyNite = −CSI en barras y el signo de lámina sigue al orden de nudos: convenio propio tipo CSI | A | P0 | 1, 2, 3, 5 | 183–235 |
| H49 | PyNite no llega al edificio objetivo: 105–110 s y 3,2 GB; su techo son ≈ 2 500–3 000 nudos en 10 s | A | P0 | 6, 7, 8 | 236–267 |
| H03 | PyNite corre en el navegador con el patrón de PySlope y da los mismos números que CPython | A | P0 | 1, 4, 5 | 268–287 |
| H04 | analyze_linear no reutiliza la factorización; un driver propio deja 4 810 nudos en 24 s | A | P0 | 1, 2, 3 | 288–327 |
| H05 | El drilling es un muelle a tierra: viga en el plano del muro articulada (×1 200) y ΣM ≠ 0 | A | P0 | 1, 2, 5 | 328–374 |
| H06 | Sólo Quad3D (DKMQ + Q4): no hay triángulos y Plate3D da momentos y flechas erróneos | A | P0 | 1, 2, 5 | 375–406 |
| H07 | Sin MPC ni diafragmas: el diafragma lo da la losa o barras de penalización con α 1e3–1e4 | A | P0 | 1, 2, 5 | 407–456 |
| H08 | PyNite es Y-arriba y su orientación por defecto salta con 1e-12: permutar ejes y fijar `rotation` | A | P0 | 1, 3, 5 | 457–483 |
| H09 | Unión puntual pilar–losa o viga–muro diverge al refinar: modelar la huella ya en el MVP | A | P1 | 2, 3, 5 | 484–509 |
| H10 | La flexión de placa converge con orden 2: 8 elementos por vano (16 en empotramientos) | A | P1 | 2, 3, 5 | 510–541 |
| H11 | Barras exactas (1e-11) y cargas sin trocear, pero sin deformación por cortante ni offsets | A | P1 | 1, 2, 5 | 542–572 |
| H12 | PyNite falla con mensajes genéricos o NaN silenciosos: los diagnósticos los construye Concreta | A | P1 | 1, 2, 5 | 573–601 |
| H13 | Huella = modelo cuantizado + versiones (SHA-256), nunca resultados; las referencias se comparan con tolerancia | A | P1 | 2, 4, 5 | 602–641 |
| H50 | Al tamaño objetivo sólo cabe un Cholesky supernodal: SuperLU llena los 4 GiB, el simplicial es ~10× más lento y el CG no compite | A | P0 | 6, 7 | 642–684 |
| H14 | scipy es obligatorio (14 MB); el solver denso sólo con numpy revienta la memoria | A | P0 | 1, 4 | 685–701 |
| H15 | Extraer resultados con la API de PyNite cuesta 12× el cálculo; un operador lineal lo arregla | A | P0 | 1, 3 | 702–728 |
| H16 | El heap de Pyodide crece y no baja (662 MB con 4 810 nudos; techo 4 GiB): limitar por GDL y reciclar el worker | A | P0 | 1, 4 | 729–768 |
| H17 | Los muros bloquean: con 1 elemento por planta son un 32 % más rígidos; ≥ 8 elementos por paño | A | P0 | 1, 5 | 769–794 |
| H18 | Qx/Qy de lámina salen un 30–50 % bajos (lado inseguro): sólo para visualizar | A | P0 | 3, 5 | 795–819 |
| H19 | PyNite une nudos colineales en silencio y su merge pierde cargas: fusiona el compilador | A | P0 | 1, 2 | 820–837 |
| H20 | Cancelar = terminate() (+5 s de re-arranque); ni `cancel`, ni SAB, ni coi-serviceworker sirven | A | P0 | 1, 4 | 838–875 |
| H21 | Superponer casos simples en Concreta es exacto; PyNite sólo ve una combinación de factor 1 por caso | A | P1 | 1, 5 | 876–888 |
| H22 | Riesgo de proveedor: un mantenedor, rupturas frecuentes y tests laxos; batería propia y vendor por hash | A | P1 | 1, 5 | 889–917 |
| H23 | Duplicados, orden, orientación, jacobiano y alabeo pasan sin error: normalizar antes y validar después | A | P1 | 2, 5 | 918–952 |
| H24 | Peso propio desde el `pp` de Cargas por planta, no ρ·t; vigas planas contarían doble | A | P1 | 1, 2 | 953–976 |
| H25 | Losas por bandas (la integral converge ±1 %); picos nodales +65 % al refinar; F·t/8 no aplica | A | P1 | 2, 3 | 977–1004 |
| H26 | Offline: el motor pasa a 29 MiB (scipy adelgazable a 7 MiB) y falta clientsClaim para cachearlo al primer uso | A | P1 | 1, 4 | 1005–1037 |
| H27 | Resultados por Transferable (3,7 ms), no JSON (0,4–1,8 s); ids como tabla densa enviada una vez | A | P1 | 3, 4 | 1038–1065 |
| H51 | El ensamblado vectorizado da lo mismo que PyNite (2,4e-16) y va 35–65× más rápido: el objetivo en 6 s en Pyodide, con techo ≈ 180 000 GDL | A | P0 | 6 | 1066–1107 |
| H52 | Tamaño del edificio objetivo: 27 500 nudos (maciza), 32 600 (reticular) y 7 500 (viguetas como barras); ×1,6 con CDT | A | P0 | 6 | 1108–1140 |
| H54 | Qué motores y solvers admite una app cerrada: OpenSees, stabileo, CHOLMOD supernodal y Triangle no; faer, AMD y METIS sí | A | P0 | 7 | 1141–1178 |
| H55 | PyNite HEAD: sin MPC a la vista, Tri3D sin conectar y kx_mod/ky_mod sólo de membrana (no sirve para D3) | A | P0 | 7 | 1179–1203 |
| H28 | Dos tolerancias (1e-6 m numérica y ~5 cm de modelado): con 2 cm de ruido el 83 % de cruces no se tocan | A | P0 | 2 | 1204–1227 |
| H29 | Losas: CDT a 2h dividida en 3 quads (ISC, 1–2 ms, = rejilla al 0,2 %); muros: rejilla por paño | A | P0 | 2 | 1228–1275 |
| H30 | frame-core no expresa CTE/NCSE en 3D (176 combinaciones frente a 4): generador nuevo con familias y situaciones | A | P0 | 3 | 1276–1316 |
| H31 | La envolvente con concomitantes falla en pilares (33–58 %): las comprobaciones con interacción iteran todas las combinaciones | A | P0 | 3 | 1317–1356 |
| H32 | Clasificar traslacional/intraslacional por desplomes con rigidez nominal: con bruta, αcr ×3 optimista | A | P0 | 3 | 1357–1389 |
| H33 | Reutilizar lib/edificio (z derivadas) y el patrón decompose de fem2d; las cargas por planta no tienen geometría | A | P1 | 2 | 1390–1422 |
| H34 | Wood–Armer validado (LUSAS): por combinación; sobre envolventes +73 %, sin Mxy inseguro | A | P1 | 3 | 1423–1452 |
| H35 | Los módulos esperan kN y kN·m, un juego por llamada, sin T ni M01/M02: extractor único por módulo | A | P1 | 3 | 1453–1489 |
| H36 | ResultModel en Float64Array por caso + envolventes max/min/índice (2,5 MB); el cuello es calcRCColumn | A | P1 | 3 | 1490–1535 |
| H37 | Tolerancias recalibradas: fuerzas 1e-9, barras 1e-6, láminas por malla; ΣM como aviso de drilling | A | P1 | 5 | 1536–1564 |
| H38 | Pruebas metamórficas como oráculo de edificios: giro 1e-12, renumeración 6e-14, Betti 7e-15 | A | P1 | 5 | 1565–1592 |
| H39 | Oráculos externos: OpenSeesPy (probado, Python 3.12) y Kratos antes que OOFEM | A | P1 | 5 | 1593–1625 |
| H40 | Fixtures en 3 niveles (unit sin Pyodide, humo de 6 s en golden, `engine` fuera del pre-push) | A | P1 | 5 | 1626–1661 |
| H41 | Three.js directo (131–170 KiB gz) en un motor imperativo, renderer único y WebGL2; R3F no compensa | A | P1 | 4 | 1662–1695 |
| H42 | Geometría fusionada/instanciada y preparada en el worker; BVH con `indirect` o el picking falla 7 de cada 8 | A | P1 | 4 | 1696–1729 |
| H43 | Mapas sin interpolar color (73 % fuera de leyenda); cividis; THREE.Color no entiende var() | A | P1 | 4 | 1730–1763 |
| H44 | Modelo físico en localStorage (12,7 % un modelo medio); analítico y resultados en IndexedDB por huella | A | P1 | 4 | 1764–1789 |
| H53 | COLAMD es la peor ordenación: splu simétrico (MMD_AT_PLUS_A) es 3–6× más rápido y deja 2–3× menos relleno | A | P1 | 6 | 1790–1812 |
| H56 | hekatan-struct-lineal (MIT): buena fuente de formulaciones tipo CSI y mala base (simplicial, 2 GB, un autor) | A | P1 | 7 | 1813–1843 |
| H45 | Numeración masiva: CSS2D no escala y troika pide fuentes a jsDelivr sin `font` explícita | A | P2 | 4 | 1844–1860 |
| H46 | Unidireccional, alveolar y chapa no son shells: paño de reparto; reticular con t equivalente | B | P0 | 2, 3 | 1861–1893 |
| H47 | Modificadores de rigidez trazables (axil de pilares ×2, torsión de HA reducida) como CYPECAD | B | P1 | 2, 3 | 1894–1910 |
| H48 | Catálogo de benchmarks verificado y 5 ejemplos CSI de edificio; CYPE no publica verificaciones | B | P1 | 3, 5 | 1911–1971 |
| H57 | SkyCiv, Dlubal y ClearCalcs calculan en servidor; Concreta sería de las pocas que calculan en el cliente | B | P2 | 7 | 1972–1985 |

**Síntesis** (no son hallazgos: decisiones, plan y pendientes construidos sobre ellos)

| ID | Sección | Líneas |
|---|---|---|
| S0 | Veredicto en una página: motor propio para el tamaño de D9, qué sigue valiendo del veredicto original y tamaños realistas | 101–152 |
| S1 | Plan por fases (0–5) con entregables, rutas reales del repo y estrategia de ramas y PR | 1986–2092 |
| S2 | Decisiones: D1–D5, D9 y D11 (motor propio) tomadas | 2093–2119 |
| S3 | Qué apartados del diseño técnico cambian y por qué (tabla § → hallazgo → cambio) | 2120–2158 |
| S4 | Fallos en código ya desplegado (fem2d: G favorable y αcr del HA), para PR aparte | 2159–2175 |
| S5 | Lo que la investigación no pudo cerrar, con el experimento que lo cerraría y su fase | 2176–2206 |
| S6 | Dónde está cada informe original y cada experimento, y cómo se hizo la investigación | 2207–2237 |
| S7 | Motor revisado: motor propio (TS + faer en WASM), spike con criterios de paso, plan B medido y esfuerzo por fases | 2238–2330 |

---

## S0 · Veredicto (revisado tras D9): PyNite no llega al edificio objetivo; el motor recomendado es propio, con solver supernodal en WASM, previo spike de 2–3 semanas

**Revisión del 2026-10-03, tras las decisiones D1–D3 y D9 (S2).** El veredicto original era «PyNite sí, con siete condiciones» y valía para modelos de hasta ~1 500 nudos. El usuario ha fijado un tope del orden de **7 plantas con 80 pilares por planta**, que con la malla recomendada son ~27 500 nudos en losa maciza y ~44 000 con CDT (H52). A ese tamaño:
- **PyNite no llega:** tarda 105–110 s y llena 3,2 GB de heap (H49).
- **PyNite no cubre D3:** no hace flexión ortótropa ni MPC, ni lo tiene previsto (H55).
- **Sólo cabe un Cholesky supernodal:** SuperLU llena los 4 GiB de wasm32 (H50).
- **Las licencias descartan los motores maduros:** OpenSees, xara, stabileo y CHOLMOD supernodal (H54).

**Recomendación: motor propio** (S7):
- elementos, restricciones y ensamblado en TypeScript;
- factorización LDLᵀ supernodal con faer (Rust → WASM);
- PyNite, OpenSeesPy y Kratos como oráculos.

Antes de comprometerse, un **spike de 2–3 semanas con criterios de paso medibles**. Si falla, hay un plan B ya medido: ensamblado vectorizado en numpy más SuperLU en Pyodide. Calcula el edificio objetivo en 6 s en sobremesa, pero no sirve en móvil (H51).

**Lo que sigue valiendo del veredicto original con cualquier motor:**
1. **El compilador hace todas las fusiones, con dos tolerancias** (H19, H28). El mallado es de cuadriláteros: CDT dividida en quads, y rejilla en muros y zonas regulares (H29).
2. **Convenio propio de ejes y signos, tipo CSI** (H02, H01). Con motor propio, es el convenio nativo y deja de ser una conversión.
3. **Forjados.** El unidireccional se modela con viguetas como barras (D2), que son baratas: 7 500 nudos en el edificio objetivo. El reticular va como lámina con multiplicadores y ábacos macizos (D3) (H46, H52).
4. **Las comprobaciones con interacción iteran todas las combinaciones.** Hace falta un generador CTE/NCSE nuevo (H31, H30). La clasificación traslacional se hace por desplomes con rigidez nominal (H32).
5. **No fiarse de los cortantes de lámina ni de los picos puntuales.** El dimensionado se hace por bandas, con Wood–Armer por combinación (H18, H25, H34).
6. **Batería de validación propia,** con oráculos externos (H39, H40, H38).

**Ya no aplican si se aprueba el motor propio:**
- driver y extracción de PyNite (H04, H15);
- permutación de ejes de PyNite (H08);
- drilling como muelle y barras de penalización (H05, H07, H09);
- scipy y la descarga de 29 MiB (H14, H26);
- cancelación con 5 s de re-arranque (H20).

**Tamaños realistas** (sobremesa rápido; portátil y móvil sin medir):

| Concepto | PyNite (a) | numpy + SuperLU (b) | Motor propio (c), estimado |
|---|---|---|---|
| Edificio objetivo, losa maciza con la malla de H10 | 105–110 s, 3,2 GB | 6 s, 2,3–2,8 GB | 1,7–2,5 s, ~0,25 GB |
| Unidireccional con viguetas | 22–37 s | 1,7 s | 0,5–0,7 s |
| Techo práctico | ≈ 3 000 nudos en 10 s | ≈ 180 000 GDL por memoria | ≈ 600 000 GDL en 10 s |
| Arranque y descarga | 4–6 s, 23–29 MiB | 4–6 s, 23–29 MiB | < 0,2 s, 0,3–1,5 MB |

**Riesgos principales:**
- errores silenciosos de formulación en el motor propio;
- rendimiento real de faer en WASM, sin medir;
- memoria en iOS;
- semántica de los multiplicadores del reticular frente a SAP2000 (S7, S5).

**Fuera del FEM 3D:** se encontraron dos fallos inseguros en `fem2d` (S4).

**Siguiente paso:**
- D11 está decidida: motor propio (S2);
- se instala el toolchain de Rust y se hace el spike E0 (S7);
- en paralelo, la Fase 1 independiente del motor (S1).

## H01 · Los resultados de `Quad3D` vienen en los ejes de cada elemento, la membrana en tensiones (Pa) y la salida global (`local=False`) está rota y además es errónea

> **Soporte A** · **P0** · áreas 1, 2, 3, 5 (MOT-09, RES-04, VAL-07, COM-04) · afecta a §12 (`ShellResultBlock`), §13.2, §15.4, §23.3 — corrige

**Hallazgo.** Lo encontraron las cuatro áreas que tocaron láminas.
- **Unidades.**
  - `moment()` → [Mx, My, Mxy] en N·m/m.
  - `shear()` → [Qx, Qy] en N/m (k = 5/6).
  - `membrane()` → [Sx, Sy, Txy] **en Pa**: con Nx = 1,0·10⁶ N/m y t = 0,20 m devuelve 5,0·10⁶. Hay que hacer Nx = t·Sx.
- **Ejes locales por elemento.** x = i→j; z = x × (i→n); y = z × x. Con mallas irregulares cada elemento tiene su propio x. Sin girar los tensores, el patch test de membrana parece fallar (1 390 / 1 276 / 396 frente a 1 333 / 1 333 / 400); girándolos pasa a 2,5e-10. `_local_coords()` usa i→m para la normal, y `T()` usa i→n: sólo importa en quads alabeados.
- **Dónde se evalúa.** En cualquier (ξ, η) por extrapolación bilineal desde los 2×2 puntos de Gauss. El centroide es la media de los cuatro; los valores nodales son extrapolaciones por elemento, discontinuas entre elementos.
- **Salida global rota.** `moment/shear/membrane(local=False)` lanzan `TypeError: only 0-dimensional arrays can be converted to Python scalars` con numpy 2.4.3 (el de Pyodide 314) y 2.5.3 (`Quad3D.py:1078, 1159, 1221`).
- **Y además errónea.** Calcula R·M·Rᵀ en lugar de Rᵀ·M·R e invierte sólo My (`:1160, :1168`; igual en membrana, `:1230`). El «cortante global» no es una transformación vectorial (`:1081-1093`). Placa girada 30°:

  | | Mx | My | Mxy |
  |---|---|---|---|
  | Correcto | −5 765 | −2 394 | 656 |
  | Álgebra de PyNite | −767 | 217 | 4 427 |

  Los resultados locales sí son invariantes ante el giro (1e-8).
- **Presión.** Sólo normal y uniforme por elemento; positiva según +z local.

**Recomendación.**
- Pedir siempre `local=True`, o mejor el operador de H15.
- Hacer Nx = t·Sx y girar en TypeScript los tensores de membrana y flexión, y el vector de cortante, al `localXAxis` de Concreta.
- Guardar como dato bruto el valor en el centroide (`locations: "centroid"`, §12.1). Las cuatro extrapolaciones nodales, sólo para el suavizado visual.
- Tests de contrato: patch test con elementos girados a 1e-9 y la placa girada 30° como fixture.

**Evidencia.** `investigacion/experimentos/01-motor/exp_signos.py` → `out_exp_signos.txt`, `out_pyodide_signos.txt`; `investigacion/experimentos/03-resultados/exp_pynite_signos_placas.py`; `investigacion/experimentos/05-validacion/exp01c_global.py`, `exp10_patch.py`.

## H02 · PyNite da los esfuerzos de barra con el signo opuesto a CSI en las seis componentes y el signo de la lámina depende del orden de nudos: Concreta fija su propio convenio (regla CSI con ejes del Eurocódigo, positivo = vano)

> **Soporte A** · **P0** · áreas 1, 2, 3, 5 (MOT-10, RES-03, RES-06, VAL-07, VAL-08, COM-11) · afecta a §5.2, §8 (`localYAxis`), §12.1, §15.3-4, §23.12 — añade

**Hallazgo.**
- **Barras.** Ménsula de 2 m según +X, con ejes locales iguales a los globales y carga en la punta (área 3):

  | Carga en la punta | PyNite en el empotramiento | CSI |
  |---|---|---|
  | FX = +1 (tracción) | `axial` = −1 | P = +1 |
  | FY = −1 | `shear('Fy')` = +1; `moment('Mz')` = +2 | V2 = −1; M3 = −2 |
  | FZ = −1 | `moment('My')` = +2 | M2 = −2 |
  | MX = +1 | `torque` = −1 | T = +1 |

  PyNite = −CSI en las seis componentes. El área 1 llega a lo mismo con otro marco: según ella, N, Vy, Vz, T y Mz son los esfuerzos de la cara negativa y My el de la positiva. Es equivalente, porque en CSI M3 es el vector sobre la cara positiva y M2 su opuesto. Las áreas 1 y 5 lo confirman con biapoyadas (Mz en el vano = −wL²/8, axil de tracción negativo, issue #271).
- **Láminas:**
  - Mx es el momento que produce σx (no el que actúa «alrededor de x»), y es positivo con tracción en la cara +z local. En una losa con z hacia arriba, el momento de vano sale negativo (−19 754 N·m/m ≈ −q·a²/8).
  - Como z local sigue al orden de nudos (i→j, i→n), invertir el orden invierte el signo: una misma losa dio +44,0 en un área y −44,2 en otra.
- **Convenciones que ya conviven en Concreta:**
  - `fem2d`: N positivo a tracción y M positivo en el vano;
  - `rcColumns`/`steelColumns`: `Nd` positivo a compresión;
  - madera: N positivo a tracción;
  - todos los módulos usan |M|.
- **Convenio propuesto para el `ResultModel`** (área 3):

  | Magnitud | Concreta 3D |
  |---|---|
  | N | Positivo a tracción |
  | Vy, Vz | = V2, V3 de CSI |
  | T | = T de CSI |
  | My | Positivo con tracción en la fibra −z (vano positivo; = M2 de CSI) |
  | Mz | Positivo con tracción en la fibra −y (= M3 de CSI) |
  | Ejes de barra | z = dirección del canto h (vector de referencia explícito), y = z × x |
  | Nx, Ny, Nxy | Por unidad de longitud, tracción positiva (= t·σ) |
  | Mx, My | Mx produce σx; positivo con tracción en la cara −z (vano positivo) |
  | Mxy | = −∫ z·τxy dz |
  | Qx, Qy | = V13, V23 de CSI |

- **Conversión desde PyNite,** con ejes locales coincidentes:
  - barras, todas las componentes cambian de signo: N = −axial, Vy = −Fy, Vz = −Fz, T = −torque, My = −My, Mz = −Mz;
  - láminas: Nx = t·Sx, Mx = −Mx, My = −My, Mxy = −Mxy, Qx = +Qx. El signo de Qx está pendiente de un patch test.

  La tabla del área 1 (MOT-10) suponía un convenio de vector sobre la cara positiva y daba My = +valor. Con el convenio adoptado aquí (CSI), My = −valor.
- **Coincidencias.** Es la misma regla para barras y láminas («positivo = vano» con z hacia arriba). Coincide con el lenguaje de los módulos (M+ en vano, M− en apoyo) y con SAP2000/ETABS, lo que facilita la validación cruzada.

**Recomendación.**
- **Contrato.** Adoptar la tabla como contrato del `ResultModel`. Renombrar `localYAxis` (§8) a un vector que diga lo que es: la dirección del canto h (z local). Así My es siempre el eje fuerte de una viga y coincide con `MEdy` de `rcColumns`/`steelColumns`.
- **Muros.** Fijar la normal (por ejemplo, a la izquierda del sentido de la línea base) y dibujarla (§15.4). En losas, normal +Z (H23).
- **Tests.** Codificar la conversión en `solvers/pynite` con tests golden: los 6 casos de `exp_signos.py`, la ménsula en tres orientaciones y un pilar con Z hacia arriba.
- **Signos de los módulos.** Los cambios de signo hacia los módulos (`Nd` positivo a compresión) se hacen sólo en los extractores (ver H35).

**Evidencia.** `investigacion/experimentos/03-resultados/exp_pynite_signos_barras.py`, `exp_pynite_signos_placas.py`, `exp_pynite_mx_significado.py`; `investigacion/experimentos/01-motor/exp_signos.py` → `out_exp_signos.txt`; `investigacion/experimentos/05-validacion/exp05_barras.py`; CSI Analysis Reference Manual («Frame/Shell Internal Force Output»); Dlubal RFEM 6, manual 002714.

## H49 · Con el tope de D9 (7 plantas y 80 pilares por planta) PyNite no llega: el edificio objetivo tarda 105–110 s y ocupa 3,2 GB en Pyodide, y su techo es de unos 2 500–3 000 nudos en 10 s

> **Soporte A** · **P0** · áreas 6, 7, 8 (ESC §3 §7, CAN §1 §4.1, MPR §6) · afecta a §1, §9.1, §14.3, ADR-010, D9, D10 — contradice el veredicto original de S0

**Hallazgo.**
- **El nuevo tope.** D9 fija el tope en unas 7 plantas con 80 pilares por planta. Con la densidad de malla de H10 salen unos 27 500 nudos en losa maciza (H52).
- **Medido en Pyodide** (sobre Node 24), con PyNite 3.2.0 y el driver de H04 más las mejoras de H53:

  | Modelo | Nudos | Tiempo | Heap |
  |---|---|---|---|
  | V1 maciza, h = 1,0 | 15 807 | 50–52 s (127 s con el driver de H04 tal cual) | 1,9–2,3 GB |
  | **V1 maciza, h = 0,75** (densidad de H10) | 27 526 | **105–110 s** | **3,2 GB** |
  | V1 maciza, h = 0,5 | 52 262 | 221 s sin `descritize`; 5–8 min con él (B) | 3,9 GB |
  | V3 unidireccional con viguetas | 7 514 | 37 s (≈ 22 s sin `descritize`, B) | 0,75 GB |

- **Dónde se va el tiempo.** Más del 90 % es Python, elemento a elemento:
  - `Quad3D.Ke` ≈ 2 ms por quad;
  - FER ≈ 0,65 ms por quad y caso;
  - reacciones ≈ 0,1 ms por elemento y caso.

  Además, `PhysMember.descritize` recorre todos los nudos por cada barra en cada análisis (O(barras × nudos)): 135 s con 52 000 nudos en CPython.
- **Techo práctico** (B, interpolado entre medidas A): unos 2 500–3 000 nudos en 10 s y unos 9 000 en 30 s. La memoria se agota hacia los 50 000 nudos.
- **HEAD no lo cambia:** la rama principal de PyNite no trae nada que mejore esto (H55).
- **El área 7 llega a lo mismo por otro camino.** SuperLU, el solver de PyNite, ya lleva el heap a 3,5 GB con 89 000 GDL en un modelo sintético (H50).

**Recomendación.**
- PyNite deja de ser el motor de producción para el tamaño de D9. Pasa a ser **oráculo** de DKMQ y de barras en la batería (H39).
- Si se mantuviera para un MVP de edificios pequeños, el driver necesita ya tres cambios: ordenación simétrica, quitar la búsqueda de `descritize` y reacciones vectorizadas. Con ellos llega a unos 3 000 nudos en 10 s.
- La alternativa está en S7.

**Evidencia.** `investigacion/experimentos/06-escala/`: `exp_pynite.py`, `pyn_build.py` y `pynite_fast.py` → `out_pynite_cpython.txt`, `out_pynite_pyodide.txt` y `out_pynite_pyodide_rep.txt`. Informe en `investigacion/06-escala.md`, §3 y §7.

## H03 · PyNite 3.2.0 corre en Pyodide 314 vendorizado con stubs y reproduce CPython a ≤ 6e-13; el paquete es `PyNiteFEA`, no `PyNiteFEM`

> **Soporte A** · **P0** · áreas 1, 4, 5 (MOT-01, MOT-14, MOT-18, VAL-13, PLA-07) · afecta a §1, §9.1, §10, §20 Fase 0, §23.7 — confirma (con correcciones)

**Hallazgo.**
- El paquete de PyPI es **`PyNiteFEA` 3.2.0** (2026-09-13, MIT, Python ≥ 3.11). `PyNiteFEM` no existe (404) y `pynite` es otro proyecto.
- Montando los `.py` del wheel en el sistema de ficheros de Pyodide 314.0.0, con numpy 2.4.3 y scipy 1.17.1 del lock y *stubs* de `matplotlib*` y `prettytable`, `from Pynite import FEModel3D` funciona. Pórtico de 2 plantas con losa (88 nudos, 52 barras, 60 quads): mismas reacciones, esfuerzos y resultantes que CPython; equilibrio 4,7e-15.
- Lo reprodujeron por separado tres áreas (la 4, además, con un scipy adelgazado). Pyodide difiere de CPython de forma estable entre ejecuciones: 5e-17 en desplazamientos, 1e-14 en axiles y 5,6e-13 en w y Mx de placa. Entre entornos CPython (3.12/3.14, numpy 2.4/2.5) los resultados son idénticos bit a bit.
- Arranque en frío en Node: `loadPyodide` 1,3–1,75 s + numpy/scipy 1,3–2,0 s + `import Pynite` 0,7–1,2 s ≈ **4 s**. Heap WASM de 75 MB tras el import.
- **Por qué stubs y no micropip.** `Pynite/__init__.py` importa `ShearWall`, que importa `prettytable` y `matplotlib.pyplot` al cargar. `micropip.install('PyNiteFEA==3.2.0')` funciona, pero arrastra 10,3 MB de matplotlib y otras 11 dependencias, necesita PyPI en tiempo de ejecución (rompe el uso offline) y sube el import a 3,3 s. El subconjunto de cálculo vendorizado son 18 `.py`: 722 kB, 126 kB en gzip.
- Sin la `dist-info`, `Pynite.__version__` devuelve `"dev"` (`Pynite/__init__.py:6-11`) y se pierde la huella de ADR-009.

**Recomendación.**
1. `scripts/vendor-pynite.mjs`, análogo al de PySlope: extrae el wheel 3.2.0 fijado por sha256, copia los 18 `.py` y la `dist-info` y añade el aviso MIT («Copyright (c) 2018 D. Craig Brinck») a `NOTICE`. Parche opcional: quitar el import de `ShearWall` de `__init__.py` y `FEModel3D.py`.
2. `STUBS_PY` como el de taludes, pero que lance una excepción si algo usa matplotlib o prettytable.
3. Corregir el nombre del paquete en §9.1 y §10 del diseño.
4. Pendiente de la Fase 0: repetir las medidas en navegadores reales (Chrome, Firefox y Safari de escritorio; Safari iOS; Chrome Android).

**Evidencia.** `investigacion/experimentos/01-motor/pyodide_run.mjs` (modos `boot`, `minimo`, `nostubs`) → `out_pyodide_minimo.txt`; `pyodide_micropip.mjs` → `out_pyodide_micropip.txt`; `investigacion/experimentos/05-validacion/exp09_determinismo.py` y `pyo/run_det.mjs` → `out_exp09*.txt`.

## H04 · `analyze_linear` refactoriza la matriz en cada combinación y escala O(N²): hace falta un driver propio con `splu` y varios lados derechos

> **Soporte A** · **P0** · áreas 1, 2, 3 (MOT-03, COM-06, RES-09) · afecta a §9 (`multipleRightHandSides`), §11.1, §14.3, §23.5 — contradice el supuesto de reutilización y corrige el presupuesto de tiempo

**Hallazgo.**
- **Qué hace `analyze_linear` en cada combinación.** Ensambla K una sola vez (`FEModel3D.py:2279`), pero dentro del bucle (`:2287`):
  - llama a `spsolve`, que vuelve a factorizar (`Analysis.py:217`);
  - recalcula las FER de **todos** los elementos, tengan carga o no (`FEModel3D.py:2136`);
  - des-particiona con `list.index` e `in list`, que es O(GDL²) (`Analysis.py:836-841`).
- **Comprobación nodal cuadrática.** `_check_stability` busca el nudo de cada GDL recorriendo todos los nudos (`Analysis.py:123`), también O(N²).
- **Tiempos de `analyze_linear`** (sparse, `check_stability=True`, 4 combinaciones):

  | Nudos | GDL | CPython | Pyodide |
  |---|---|---|---|
  | 171 | 1 026 | 0,58 s | 2,61 s |
  | 928 | 5 568 | 2,91 s | 6,59 s |
  | 2 650 | 15 900 | 14,3 s | 25,5 s |
  | 4 810 | 28 860 | 42,6 s | 54,8 s |

  De los 54,8 s de Pyodide con 4 810 nudos: `check_stability` 16,8 s, des-partición 18,2 s, FER 7,7 s, ensamblado 9 s. Factorizar y resolver es sólo el 2,6 % (1,4 s).
- **Driver propio** (`pynite_fast.solve_linear`, unas 100 líneas): `splu` una vez, todos los casos como lados derechos, des-partición indexada, comprobación nodal vectorizada y FER sólo de los elementos cargados en cada caso. Mismos resultados (desplazamientos a 2,3e-13 relativo; reacciones a 9e-9 N). Tiempos:

  | Modelo | CPython | Pyodide |
  |---|---|---|
  | 928 nudos, 4 / 24 casos | 1,96 / 2,09 s | 3,9 / 4,3 s |
  | 4 810 nudos, 4 / 24 casos | 9,5 / 10,3 s | 23,5 / 23,6 s |

  Como comparación, `analyze_linear` con 928 nudos y 24 casos tarda 14 s en CPython.
- Lo que queda es Python puro en `Quad3D.ke()` y `Member3D` (≈ 11 s) y FER (≈ 7 s). Factorizar 28 860 GDL cuesta 0,2–0,5 s.
- Las otras áreas lo confirman por su lado: `check_stability` se come el 26 % del tiempo con 625 nudos (área 2), y una losa plana de 14 406 GDL tarda 77 s en CPython con la API estándar (área 3).

**Recomendación.**
- El `PyNiteSolverAdapter` no llama a `analyze_linear`. Usa un driver propio con el patrón de `pynite_fast.py`, apoyado en `Analysis._prepare_model`, `_partition_D`, `FEModel3D.Ke`, `Member3D/Quad3D.FER` y `P`, que deja el modelo en el mismo estado que `analyze_linear`.
- Esos internos quedan cubiertos por tests contractuales: la 3.0.0 renombró `K/k` a `Ke/ke` (ver H22).
- `multipleRightHandSides: true` sólo para ese driver.
- Presupuesto del §14.3: en Pyodide, y sin contar los ~4 s de arranque, sólo hasta **~1 500 nudos** se resuelven en menos de 10 s; con 5 000 nudos no se cumple. El límite de tamaño se fija en GDL (ver H16).
- P2: vectorizar `Quad3D.ke()` y FER, que suman ~70 % del tiempo restante.

**Evidencia.** `investigacion/experimentos/01-motor/exp_scaling.py` → `out_scaling_{cpython,pyodide}_{small,large}.txt`; `pynite_fast.py` + `exp_fast.py` → `out_fast2_cpython.txt`, `out_fast_pyodide.txt`.

## H05 · El giro de perforación (drilling) de las láminas es un muelle a tierra: deja casi articulada una barra unida en el plano y rompe el equilibrio de momentos sin avisar

> **Soporte A** · **P0** · áreas 1, 2, 5 (MOT-06, COM-02, VAL-01, VAL-04) · afecta a §7.2, §9.2, §18.2, §23.11 — contradice

**Hallazgo.**
- **Mecanismo.** `Quad3D` (y `Plate3D`) ponen un término **diagonal** `ke_rz` = mín(rigideces de giro de flexión)/1000 en el GDL de giro alrededor de la normal, sin acoplarlo a la membrana (`Quad3D.py:565-623`). Equivale a un muelle a tierra en cada nudo de losa o muro, y PyNite no lo contabiliza como reacción. Es el issue #102, abierto desde 2021 con la etiqueta «program limitation».
- **Tres áreas lo midieron por separado:**

  | Ensayo | Resultado | Referencia |
  |---|---|---|
  | Viga HA 30×50 de 2 m en el plano de un muro 3×3×0,25, unida en la esquina, 20 kN (área 2) | 2 056 mm | 0,569 mm empotrada; 1,02 mm embebida un elemento |
  | Viga 30×50 de 3 m en el plano de un muro, 50 kN (área 5) | 5 786 mm (×1 205) con malla 6×6; 8 222 mm (×1 713) con 12×12: **empeora al refinar** | 4,80 mm; embebida en una fila de nudos, ×1,30–1,32 |
  | Torsor de planta de 600 kN·m, edificio 2×2×2 (área 1) | Σ reacciones = 595,7: falta el 0,71 % | Lo absorben exactamente los muelles |
  | Torsor en un pilar que llega a una losa (área 1) | El pilar recibe 34 de 1 000 N·m | — |

- **Residuo de equilibrio** de reacciones más cargas (área 5):

  | Modelo | ΣF relativo | ΣM relativo |
  |---|---|---|
  | Sin drilling activo | ≤ 1,5e-11 | ≤ 1,5e-11 |
  | Muro en L | 9,5e-14 | **3,5e-5** |
  | Viga embebida en muro | 1,4e-13 | **1,4e-4** |
  | Viga unida en 1 nudo | 6e-15 | **0,49** |

- **No protesta.** `_check_stability` sólo mira diagonales nulas y el control de residuo pasa porque K no es singular.
- **Efectos laterales:**
  - los pilares no reciben torsión por el giro en planta del forjado (sale exactamente 0);
  - el muro en voladizo cuadra (0,000 %), porque allí ese giro no se excita.

**Recomendación.**
1. **Regla del compilador.** Toda barra cuyo momento actúe alrededor de la normal de una lámina (vigas en el plano de muros, dinteles, vigas de acoplamiento, apeos sobre muro) se prolonga como **barra embebida auxiliar**:
   - por una fila de nudos de la lámina, al menos un lado de elemento o el canto de la viga;
   - con canto ≤ espesor y el momento liberado en el extremo lejano;
   - con el rol `auxiliar` en el mapping (ver H07).

   Test de regresión: el voladizo del área 2 debe dar ≤ 2× la solución rígida.
2. **Diagnóstico por caso.** Residuo de fuerzas (error si supera 1e-9) y de momentos (aviso de «momento absorbido por el drilling» si supera 1e-6), señalando los nudos con mayor k_rz·θ.
3. **Documentar** que no se modela la torsión de pilares por giro de planta.
4. **Si el núcleo de prueba (ETABS 15d) da más del 2 % de error,** valorar un parche de drilling tipo Allman o Hughes–Brezzi en la copia vendorizada (ver S5).

**Evidencia.**
- `investigacion/experimentos/01-motor/exp_drilling.py` → `out_exp_drilling.txt`.
- `investigacion/experimentos/02-compilador/py/exp_pynite.py` (P7).
- `investigacion/experimentos/05-validacion/exp07_conexion.py`, `exp11_equilibrio.py`, `exp11b_equilibrio_mixto.py`.
- https://github.com/JWock82/Pynite/issues/102
- CSI, «Connecting frames to shells»: *«run the frame element into the shell mesh by at least one shell element length»*.

## H06 · PyNite 3.2.0 sólo tiene un elemento de lámina utilizable, `Quad3D` (DKMQ + membrana Q4): no hay triángulos y `Plate3D` no sirve

> **Soporte A** · **P0** · áreas 1, 2, 5 (MOT-07, COM-01, VAL-06, COM-04) · afecta a §7.3 («el MVP puede utilizar triángulos»), §8 `ShellElement`, §9.2, §23.2, §23.10 — contradice

**Hallazgo.**
- **No hay triángulos.** `Tri3D.py` viene en el wheel, pero es una copia a medio hacer de `Plate3D`:
  - usa `self.n_node`, que no existe, y nadie lo importa;
  - `FEModel3D` no tiene `add_tri` (issue #267);
  - un quad degenerado, con un nudo repetido para imitar un triángulo, da una `ke` no finita.
- **`Quad3D`, el único utilizable.**
  - Flexión y cortante con la DKMQ de Katili.
  - Membrana Q4 bilineal isoparamétrica con Gauss 2×2.
  - Drilling débil: ver H05.
  - Admite cuadriláteros generales, finos y gruesos. Sustituyó al MITC4 en la 2.4.
- **`Plate3D` no sirve:**
  - **Trata cualquier cuadrilátero como rectángulo**, sin aviso: en la placa esviada de Morley da 10 veces la flecha (+897 %).
  - **Mxy mal calculado:** `Db` divide el término de torsión por (1−ν²) (`Plate3D.py:129-131`). Mxy sale un +9,9 % alto con ν = 0,3 y no converge al refinar.
  - **Signo opuesto** al de `Quad3D` en todos los momentos, aunque el comentario del código diga lo contrario.
  - **Modificadores incoherentes:** `ke_b` ignora `kx_mod`, pero `moment()` lo aplica. Con kx_mod = 0,1 la flecha no cambia y Mx sale 4,42 en lugar de 44,2 kN·m/m: el equilibrio se rompe sin aviso.
- **Cuadriláteros alabeados.** `Quad3D._local_coords` proyecta los 4 nudos sobre el plano i-j-m sin comprobar el alabeo: el elemento se aplana en silencio.

**Recomendación.**
- El mallador del MVP produce **sólo cuadriláteros**, convexos y planos (alabeo < 1e-6·L en losas y muros planos).
- `supports()` rechaza los `ShellElement` de 3 nudos con un diagnóstico explícito. El contrato puede seguir admitiéndolos para otro solver.
- No usar nunca `Plate3D`. No usar `kx_mod/ky_mod` ≠ 1 (ver H46).
- Abrir un issue en PyNite con los ensayos de `Plate3D`.

**Evidencia.**
- `investigacion/experimentos/02-compilador/py/exp_pynite.py` (P4 y P8), `exp_pynite2.py` (P5b).
- `investigacion/experimentos/05-validacion/exp04_esviada.py`, `exp01_placas.py`.
- `Quad3D.py:1-27, 450-700`; `Plate3D.py:77-87, 129-131, 237-238, 607-609`.

## H07 · PyNite no tiene restricciones, diafragmas, offsets ni brazos rígidos: el diafragma sale de la losa *shell* o de barras de penalización (α 1e3–1e4, con la torsión liberada)

> **Soporte A** · **P0** · áreas 1, 2, 5 (MOT-16, COM-03, VAL-12) · afecta a §7.1 paso 8, §8 (`constraints`), §13.1, §20 — corrige

**Hallazgo.**
- **Lo que no hay:**
  - restricciones multipunto, diafragma rígido ni nudos maestro/esclavo (issue #292, abierto);
  - offsets ni brazos rígidos;
  - peso propio de placas;
  - cargas en el plano de la lámina, cargas lineales sobre lámina y temperatura.

  Un `grep -i "diaphragm|rigid|constraint|offset|master|slave"` no encuentra nada.
- **Lo que sí hay:**
  - apoyos por GDL global;
  - muelles de apoyo, también unidireccionales y no lineales;
  - desplazamientos impuestos;
  - muelles entre nudos (`Spring3D`);
  - barras que sólo trabajan a tracción o a compresión;
  - presión normal uniforme por quad;
  - P-Delta, sólo en barras;
  - análisis modal con `eigsh`, que en Pyodide da las mismas frecuencias que CPython en 2,2 s;
  - `RectangleMesh` con huecos rectangulares;
  - `ShearWall` y `MatFoundation`, ligados a matplotlib.
- **Diafragma por penalización** (área 2). Planta de 6×6 m, 4 pilares de 3 m y 4 vigas, con 100 kN en X en una esquina:

  | Modelo | u_x en las esquinas (mm) | cond(K11) |
  |---|---|---|
  | Maestro-esclavo exacto (numpy sobre la K de PyNite) | 1,7166 / 0,3881 | 55 |
  | 6 barras de penalización biarticuladas con la torsión liberada, α = 1e2 | 1,7204 / 0,3847 | 2,3e4 |
  | Íd., α = 1e4 | 1,72001 | 2,3e6 |
  | Íd., α = 1e10 | PyNite: «stiffness matrix is singular» | — |
  | Íd., **sin liberar la torsión** | 1,485 (−13,7 %): rigidiza las cabezas de pilar | — |
  | Sin diafragma | 2,02 / 0,11 (49 kN de axil en una viga) | — |
  | Losa *shell* de 25 cm | 1,55 / 0,31 (semirrígido) | — |

  Con diafragma rígido, el axil de las vigas de esa planta es un artefacto: CYPECAD las calcula con 3 GDL dentro del diafragma.
- PyNite tampoco tiene enlaces rígidos para las zonas de pilar: ver H09.

**Recomendación.**
1. No implementar restricciones en el MVP. Las plantas con losa *shell* no llevan diafragma: lo da la membrana.
2. Las plantas sin *shell* (unidireccional, ver H46) llevan un diafragma de penalización:
   - 6 barras por cada 4 nudos maestros, o una triangulación de la planta;
   - α = 1e3–1e4 relativo al EA de las vigas, con la torsión liberada en un extremo;
   - rol `auxiliar` en el mapping (sin comprobación ni diagrama);
   - aviso «axil de vigas no representativo» en el `ResultModel`.
3. Registrar la sustitución de restricción por penalización en los metadatos del adaptador. `supports()` rechaza las restricciones de diafragma rígido.
4. El §21 («todo frame/shell analítico tiene trazabilidad a un elemento físico») necesita el rol `auxiliar` en `PhysicalRef`.

**Evidencia.** `investigacion/experimentos/02-compilador/py/exp_diafragma.py` → `salida-diafragma*.json`; `investigacion/experimentos/01-motor/exp_modal.py`; https://github.com/JWock82/Pynite/issues/292; CYPE ccadmc01, pp. 11-12 y 243.

## H08 · PyNite supone Y vertical, sólo admite un ángulo `rotation` y su orientación por defecto salta con 1e-12 de ruido: el adaptador permuta ejes y calcula el ángulo de cada barra

> **Soporte A** · **P0** · áreas 1, 3, 5 (MOT-05, RES-03, VAL-09) · afecta a §5.2 («vector de referencia explícito»), §8 (`localYAxis`), §23.6 — contradice

**Hallazgo.**
- **Y vertical.** `Member3D.T()` considera vertical la barra con `isclose(Xi, Xj) and isclose(Zi, Zj)`, usando el `math.isclose` sin tolerancia absoluta (`Member3D.py:957`).
  - Una viga de Concreta, con Z hacia arriba, toma por defecto el eje local y = Y global (horizontal). La flexión por gravedad pasa a My sobre Iy, que en PyNite es el eje débil.
  - El mismo edificio da Mz = 13,2 kN·m en Y-arriba y My = 11,8 kN·m en Z-arriba sin tratar.
  - Un pilar de Concreta cae en la rama «horizontal» de esa regla, con y local = (0, 1, 0) y z = (−1, 0, 0).
- **Orientación discontinua:**
  - dx = ±1e-9 m invierte 180° los ejes de un pilar casi vertical;
  - dx = dz = 1e-12 m los gira 45°;
  - un ruido de 1e-12 en la Z de la cabeza de un pilar con base en Z = 0 los gira 90°: la flecha pasa de 3,333 a 1,875 mm, con Iy e Iz intercambiados.
- **Prueba metamórfica de giro rígido** del modelo completo:
  - dejando que PyNite oriente las barras, los desplazamientos cambian un 13–75 % y los esfuerzos un 31–99 %;
  - con orientación explícita, 7,8e-13 y 1,1e-13.

  El issue #284 recoge que las barras giradas daban esfuerzos erróneos de la 1.0.0 a la 1.5.0.
- **Sin vector de referencia.** Sólo hay `rotation`, en grados alrededor de x local. Calculando `rotation = atan2((y0×yd)·x, y0·yd)` desde `member.T()` con rotación 0, el eje y local queda igual al vector pedido con error ≤ 1,2e-16, en todas las orientaciones probadas.

**Recomendación.**
- **Permutar ejes.** Mapear Concreta (Z arriba) a PyNite con la permutación cíclica (Xp, Yp, Zp) = (Yc, Zc, Xc). Conserva la orientación dextrógira y da sentido a los valores por defecto de PyNite (`mass_direction='Y'`).
- **Fijar el ángulo** de cada barra desde el vector de referencia de Concreta, sin confiar nunca en el eje por defecto. Comprobar después que `T()[1,:3]` coincide con lo pedido a 1e-12.
- **Batería contractual.** Incluir la prueba metamórfica de giro del modelo completo, y SAP2000 1-004 (W12X106 con ejes girados 30°) como regresión.

**Evidencia.** `investigacion/experimentos/01-motor/exp_ejes.py`, `exp_ejes_signo.py` → `out_exp_ejes*.txt`; `investigacion/experimentos/05-validacion/exp05_barras.py` (caso 6), `exp06_metamorficas.py` (M1); `investigacion/experimentos/03-resultados/exp_pynite_signos_barras.py`.

## H09 · Las uniones puntuales pilar–losa y viga perpendicular–lámina no convergen al refinar: la huella del pilar (zona rígida) tiene que entrar ya en el MVP

> **Soporte A** · **P1** · áreas 2, 3, 5 (COM-15, VAL-12, RES-09) · afecta a §7.2, §13.2, §20 (las zonas rígidas estaban en «evolución posterior») — corrige

**Hallazgo.** Una carga o un momento puntual sobre una placa es una singularidad logarítmica: refinar la malla no converge, empeora.
- **Pilar como punto frente a huella apoyada** (área 2). Losa de 6×6 m y 25 cm, apoyada en el contorno y en un pilar central de 40×40, con q = 10 kPa:

  | h (m) | Mx en el nudo, pilar como punto (kN·m/m) | Mx en la cara, huella del pilar apoyada (kN·m/m) |
  |---|---|---|
  | 1 | −22,7 | −11,9 |
  | 0,5 | −34,1 | −14,1 |
  | 0,25 | −45,5 | −14,8 |
  | 0,125 | −55,4 | −16,2 |

- **Viga perpendicular a un muro, unida en un nudo** (área 5). Flecha en punta respecto a la empotrada: 2,88× con malla de 0,5 m, 3,17× con 0,25 y 3,53× con 0,125.
- **Losa plana 12×12 m** sobre 3×3 pilares (área 3). El pico en el nudo del pilar pasa de 193 a 319 kN·m/m (+65 %) al refinar. La integral en banda converge: ver H25.
- **Cómo lo resuelven otros.** PyNite no tiene enlaces rígidos ni offsets; su autor recomienda «spread the column load with stiff members» (discusión #261). CYPECAD usa «nudos de dimensión finita»: barras infinitamente rígidas del eje del pilar a sus caras.

**Recomendación.**
- Embeber la huella del pilar en la malla de la losa como contorno restringido.
- Unir el nudo de cabeza del pilar con los nudos de la huella mediante barras rígidas de penalización (α ≈ 1e3, rol `auxiliar`).
- Calibrar α frente al condicionamiento con un barrido EI_rígida = 10²…10⁸·EI_viga. Criterio: menos del 5 % de variación entre mallas de 0,5, 0,25 y 0,125 m.
- Exponer al dimensionado el valor en la cara, nunca el del nudo. Lo mismo en las esquinas muro–losa.

**Evidencia.** `investigacion/experimentos/02-compilador/py/exp_pilar_losa.py` → `salida-pilar-losa.log`; `investigacion/experimentos/05-validacion/exp07b_perp_malla.py` → `out_exp07b.txt`; `investigacion/experimentos/03-resultados/exp_losa_plana.py`; CYPE, *CYPECAD – Memoria de cálculo* (ccadmc01), p. 15.

## H10 · La flexión de `Quad3D` es fiable: converge con orden 2, no bloquea y pasa los patch tests; bastan 8 elementos por vano en losas apoyadas y 16 en empotramientos

> **Soporte A** · **P1** · áreas 2, 3, 5 (VAL-05, COM-07, VAL-11, RES-04) · afecta a §7.3, §18.2, §23.1, §23.2 — confirma `Quad3D` y añade densidades mínimas

**Hallazgo.**
- **Placa cuadrada con q uniforme y ν = 0,3** (área 5). Referencias:
  - Navier: α = 0,00406235; β = 0,0478864;
  - empotrada: α = 0,00126532; β_c = 0,0229051; β_borde = −0,0513338.

  | Caso | 4×4 | 8×8 | 16×16 | 32×32 | p obs. |
  |---|---|---|---|---|---|
  | Apoyada a/t = 100, w | −0,42 % | −0,07 % | −0,03 % | −0,01 % | 1,99 |
  | Apoyada, M en centroide frente a M exacto allí | −7,6 % | −1,7 % | −0,43 % | −0,11 % | 2 |
  | Empotrada a/t = 100, w | +15,6 % | +4,5 % | +1,3 % | +0,46 % | 1,97 |
  | Empotrada, M en el centro | +26 % | +6,3 % | +1,7 % | +0,48 % | 1,99 |
  | Empotrada, M en el centro del borde | −5,3 % | −1,2 % | −0,3 % | −0,04 % | — |
  | a/t = 10 frente a Mindlin, w | −1,0 % | −0,41 % | −0,13 % | −0,04 % | 1,5 |
  | a/t = 10 000 (bloqueo), w | −0,41 % | −0,06 % | −0,01 % | −0,003 % | 2,3 |

- **Patch tests de MacNeal–Harder.** Pasan: membrana a 2,5e-10 y flexión a 5e-13, una vez girados los resultados a ejes globales. OpenSees `ShellDKGQ` da el mismo orden de error con 8×8 (−0,058 %).
- **Tipo de malla.** La de triángulos divididos en quads del área 2 y una rejilla regular difieren un 0,2 % en la placa de Navier. El +1,7 % que ambas dan frente a Kirchhoff es la deformación por cortante de Mindlin, no error de malla.
- **Losa gruesa** (área 3). Una losa de 4×4 m con 16×16 da w +3,3 % y M +2,3 % frente a Kirchhoff: es la deformación por cortante de Mindlin, coherente con lo anterior, no error de malla.
- **Distorsión.** Con 0,2h aleatoria: w −0,19 % y M +1,27 % con 8×8. Con 0,4h aparecen jacobianos ≤ 0: PyNite sólo emite un `UserWarning` y devuelve w un −60 %. Ver H23.

**Recomendación.**
- Densidad por defecto: **8 elementos por vano** entre apoyos.
- **16 por vano** para momentos negativos sobre apoyos y flechas de losas empotradas.
- Usar como dato de comprobación el valor en el centroide, que converge O(h²) en su propio punto. La media nodal, sólo para representar.
- Tolerancias de benchmark: ver H37.

**Evidencia.** `investigacion/experimentos/05-validacion/exp01_placas.py` → `out_exp01_A.txt`, `out_exp01_BCDEF.txt`; `exp10_patch.py`; `exp08_opensees.py`; `refs.py`; `investigacion/experimentos/02-compilador/py/exp_placa_mallas.py`.

## H11 · `Member3D` es exacto frente a soluciones cerradas (≤ 1e-11) e integra las cargas de barra en forma cerrada, pero es Euler-Bernoulli, sin cortante ni offsets

> **Soporte A** · **P1** · áreas 1, 2, 5 (MOT-08, COM-13, VAL-08) · afecta a §7.2 («cargas puntuales fuerzan subdivisiones»), §10.1, §18.2, §23.1, §23.6 — confirma y corrige

**Hallazgo.**
- **Formulación.** Matriz 12×12 de Euler-Bernoulli (12EI/L³, sin factor de cortante; `Member3D.py:176-208`) y torsión de Saint-Venant (GJ/L).
  - Las liberaciones se aplican por condensación estática. Liberar el giro de torsión en los dos extremos da `LinAlgError: Singular matrix`, sin decir qué barra.
  - La sección sólo tiene A, Iy, Iz y J: no hay áreas de cortante, offsets ni zonas rígidas.
- **Exactitud** frente a solución cerrada:
  - voladizo 3D, biapoyada, voladizo en L con torsión y trípode: ≤ 1e-11;
  - pórtico espacial frente a pendiente-desplazamiento: 4e-6 a 1,5e-5, por el EA finito.
- **Cargas de barra exactas.** Puntuales, momentos y trapezoidales parciales, en ejes locales o globales, con FER de empotramiento perfecto en forma cerrada (`FixedEndReactions.py:97-135`) y diagramas por tramos analíticos. Una viga de 6 m con carga uniforme, trapecial parcial y puntual da lo mismo con 1 que con 10 elementos: 1,3e-14 en flecha y 1,5e-14 en momento.
- **Peso propio.** `add_member_self_weight` usa `rho·A`: `rho` es un peso específico (N/m³), no la densidad en kg/m³ del §5.1.
- **Lo que no ve la ausencia de cortante.** Fracción de la flecha que se pierde en una viga biempotrada de 30×60 con carga centrada:

  | L/h | 2 | 4 | 8 | 20 |
  |---|---|---|---|---|
  | Flecha no vista | 74 % | 42 % | 15 % | 3 % |

  La rama de deformación por cortante (PR #289) no está publicada, y el PR #341 sigue abierto.

**Recomendación.**
- **No trocear por cargas.** Las cargas puntuales y parciales viajan como `FrameLoad` con su posición (x1, x2), y las estaciones de resultado salen de las cargas. Quitar «cargas puntuales» de las causas de troceado del §7.2.
- **Validar en TypeScript** las liberaciones incompatibles (torsión o axil liberados en los dos extremos) antes de llamar a PyNite.
- **Peso propio** como carga explícita, nunca a través de `rho` (ver H24).
- **Declarar** «Euler-Bernoulli» en `SolverCapabilities`. Diagnóstico para barras con L/h < 6 (vigas de acoplamiento o de gran canto).
- **Comparaciones con SAP2000 o CYPE:** desactivar sus áreas de cortante o declarar la diferencia esperada.
- **Offsets,** cuando lleguen, en el compilador mediante barras rígidas.

**Evidencia.** `investigacion/experimentos/05-validacion/exp05_barras.py` → `out_exp05.txt`; `investigacion/experimentos/02-compilador/py/exp_pynite.py` (P1); `investigacion/experimentos/01-motor/exp_a_minimo.py`; https://pynite.readthedocs.io/en/latest/member.html («Transverse shear deformations are not currently considered»).

## H12 · Ante mecanismos y elementos defectuosos PyNite lanza excepciones genéricas, avisos de Python o resultados absurdos sin error: los diagnósticos del §16 los construye Concreta

> **Soporte A** · **P1** · áreas 1, 2, 5 (MOT-12, COM-06, COM-10, VAL-11) · afecta a §2.3 (principio 8), §16, §21 («una singularidad produce un error comprensible») — corrige

**Hallazgo.**
- **Con `check_stability=True`:**
  - nudo suelto: `Exception('Unstable node(s). See console output for details.')`, con los nombres sólo en stdout (`Analysis.py:163-166`);
  - mecanismo global: «The stiffness matrix is singular», sin nudo ni GDL;
  - doble liberación de torsión: `LinAlgError: Singular matrix`;
  - nudo huérfano de la malla: «Nodal instability… node N24», sin referencia física.
- **Con `check_stability=False`:** NaN en los desplazamientos (nudo suelto) o desplazamientos finitos de 6,4e12 m (mecanismo), sin excepción.
- **`check_statics=True`** imprime con `PrettyTable` (`Analysis.py:1331`) y falla con los stubs.
- **Elementos defectuosos:** un jacobiano negativo sólo produce un `UserWarning`, con resultados un 60 % erróneos, y el alabeo no se avisa.
- **Coste:** la comprobación de estabilidad es O(N²): un 26 % del tiempo con 625 nudos y 16,8 s con 4 810 nudos en Pyodide.

**Recomendación.**
- Las áreas 1 y 2 discrepaban: no apagar nunca la comprobación (área 1) frente a apagarla por su coste (área 2). La solución es no correr nunca sin comprobación, pero sustituir la de PyNite por la del driver propio (`pynite_fast.py`), vectorizada y O(N). Devuelve `[(nudo, gdl)]`, que el mapping traduce a `PhysicalRef`.
- **Antes de resolver,** en TypeScript:
  - conectividad y nudos huérfanos;
  - liberaciones incompatibles;
  - validación de malla (ver H23).
- **Después de resolver:**
  - `isFinite` en todos los arrays (§12.1);
  - residuo de fuerzas y de momentos (ver H05).
- **Mecanismo global:** diagnóstico «matriz singular». Más adelante, localizar el modo con el autovector de K11 de autovalor ≈ 0 (`eigsh` funciona en Pyodide).
- No pasar nunca a PyNite un elemento que dependa de sus `warnings`.

**Evidencia.** `investigacion/experimentos/01-motor/exp_singular.py` → `out_exp_singular.txt`; `investigacion/experimentos/02-compilador/js/salida-mallado-resumen.txt` (variante D); `investigacion/experimentos/05-validacion/exp01_placas.py` (caso F), `exp06b_solido_rigido.py`.

## H13 · La huella reproducible se calcula sobre datos cuantizados y versiones, nunca sobre resultados: V8 y JavaScriptCore difieren en `Math.*` y Pyodide difiere de CPython en 6e-13

> **Soporte A** · **P1** · áreas 2, 4, 5 (COM-12, VAL-13, PLA-15) · afecta a §7.1 paso 12, §17, §18.3, ADR-009 — añade

**Hallazgo.**
- **V8 y JavaScriptCore** (Node frente a Bun, 200 000 muestras) dan bits distintos en estas funciones; `sqrt` y `pow` coinciden.

  | Función | Muestras distintas |
  |---|---|
  | `hypot` | 35,7 % (hasta 2 ulp) |
  | `cbrt` | 27,2 % |
  | `exp` | 9,3 % |
  | `atan2` | 7,3 % |
  | `log` | 4,9 % |
  | `sin` | 2,5 % |
  | `cos` | 2,35 % |

  ECMA-262 las declara «implementation-approximated». `rcElasticModulusMPa` usa `Math.cbrt`. Una huella sobre dobles derivados cambiaría entre Chrome y Safari.
- **Huella actual.** El `inputsFingerprint` del repo (`src/lib/pdf/utils.ts:791`) es un FNV-1a de 32 bits: hay un 1 % de probabilidad de colisión hacia las 9 300 huellas. Es corto para clave de caché.
- **Motor.** Pyodide y CPython difieren hasta 6e-13, de forma estable (ver H03).
- **Coste** (área 4). Modelo analítico de 20 000 nudos, 25 000 barras y 40 000 láminas (12,5 MB de JSON canónico):

  | Paso | ×1 | CPU ×4 |
  |---|---|---|
  | Canonicalizar | 146 ms | 546 ms |
  | `TextEncoder` | 24 ms | 80 ms |
  | `crypto.subtle.digest` | 9 ms | 37 ms |
  | **Total** | **179 ms** | **663 ms** |

  Hashear directamente los buffers tipados (posiciones Float64 + conectividad Int32, 1,1 MB) cuesta 12–23 ms. Un `JSON.stringify` a secas no es canónico.

**Recomendación.**
- **Qué entra en la huella:** el modelo físico canónico, las opciones y las versiones {Pyodide, numpy, scipy, PyNiteFEA, sha256 del vendor, versión del driver, versión del mallador}. O el analítico con coordenadas cuantizadas (`Math.round(x/1e-9)`).
- **En la topología:** `Math.sqrt(dx*dx+dy*dy)`, no `Math.hypot`, y sin trigonometría para situar nudos.
- **SHA-256** con `crypto.subtle`, calculado **en el worker de compilación** sobre los buffers densos y una cabecera canónica pequeña (esquema, unidades, versiones, opciones). Normalizar `-0` y rechazar `NaN` antes de hashear.
- **Respuestas del worker:** aceptar una respuesta si su `modelFingerprint` coincide con el modelo actual, no sólo por `requestId`. Así se reaprovecha el resultado tras deshacer.
- **Referencias congeladas del motor:** se comparan con tolerancia relativa de 1e-9, nunca por hash.

**Evidencia.** `investigacion/experimentos/02-compilador/js/trig-huella.mjs`, `trig-dump.mjs` → `salida-trig-v8-vs-jsc.json`; `investigacion/experimentos/05-validacion/out_exp09*.txt`.

## H50 · Al tamaño objetivo sólo cabe en wasm32 un Cholesky supernodal: SuperLU llena el heap de 4 GiB, los simpliciales son ~10 veces más lentos y el gradiente conjugado no compite

> **Soporte A** · **P0** · áreas 6, 7 (CAN E1 (§2), ESC §5 §8 §9) · afecta a §9 (solver), §14, H16 — cambia el solver

**Hallazgo.**
- **Dos experimentos independientes en WASM.**
  - **Área 7 (E1).**
    - **Montaje:** Pyodide 314 en Node, con un modelo sintético de 7 plantas, 80 pilares por planta y 2 núcleos (K con el patrón de un edificio, SPD) y 24 lados derechos.
    - **Proxy de rendimiento:** CHOLMOD supernodal de la propia distribución de Pyodide (SuiteSparse 5.11 + OpenBLAS), llamado por ctypes. Sólo sirve de proxy porque es GPL (H54).

    | GDL | 39 096 | 89 082 | 180 240 | 360 360 | 566 538 |
    |---|---|---|---|---|---|
    | CHOLMOD supernodal: factorización | 0,82 s | 1,65 s | 4,17 s | 11,18 s | 21,96 s |
    | — heap | 304 MB | 535 MB | 1 035 MB | 1 920 MB | 2 814 MB |
    | CHOLMOD simplicial (= Eigen `SimplicialLDLT`, QDLDL) | 7,57 s | 16,32 s | 44,13 s | 114,06 s | — |
    | SuperLU (scipy, MMD simétrico) | 2,3–2,6 s | 8,0–10,4 s | 11,5 s | 24,9 s | **falla** |
    | — heap | 1 686 MB | **3 545 MB** | 3 745 MB | **4 096 MB (techo)** | — |

  - **Área 6.** Usa las K reales del edificio objetivo, ensambladas en vectorizado (H51).
    - SuperLU simétrico en Pyodide: 3,4 s con 164 000 GDL y 7,8 s con 313 000. El heap tras factorizar queda en 2,3 GB y en 4,0 GB.
    - CHOLMOD supernodal en nativo con núcleos SSE3 (lo más parecido a SIMD128): de 3 a 4 veces más rápido que SuperLU y con la mitad de factor.
- **El techo de wasm32 en Pyodide es 4 GiB, no 2** (medido con `getHeapMax()`).
  - El heap lo llena SuperLU, no el modelo. SuperLU reserva de más, y en wasm32 cada reserva hace crecer un heap que no baja (H16).
  - Cuando se queda sin memoria, el error que da es `gstrf was called with invalid arguments`.
- **Simpliciales** (QDLDL, Eigen `SimplicialLDLT`, CHOLMOD simplicial): son unas 10 veces más lentos que el supernodal en WASM y no mejoran a SuperLU.
- **Iterativos** (área 6, en CPython):
  - Jacobi converge, pero tras miles de iteraciones: 39 s frente a 3,8 s del directo con 313 000 GDL.
  - ILU 1e-4 y AMG empatan con el directo con un caso de carga y pierden con 6 o más.

**Recomendación.**
- El solver del motor es un **LDLᵀ/LLᵀ supernodal con AMD** en un módulo WASM propio.
- El candidato es **faer** (Rust, MIT). En su código está verificado que tiene factorización supernodal y kernels SIMD128 para wasm32. No hay ningún benchmark disperso publicado de faer, así que su rendimiento en WASM es **C** hasta medirlo en el spike (S7).
- Un módulo WASM aparte tiene su propia memoria, así que el factor no compite con nada más.
- Objetivo de referencia (según el proxy CHOLMOD): 360 000 GDL en ≤ 15 s y con ≤ 2,5 GB.
- En iOS, con 0,3–1 GB fiables (sin medir), el tope práctico rondaría los 90 000–180 000 GDL.

**Evidencia.**
- `investigacion/experimentos/07-candidatos/bench/`: `bench_solvers.py` y `run.mjs` → `out_bench.txt`, `out_simp.txt` y `out_slu2.txt`.
- `investigacion/experimentos/06-escala/`:
  - `exp_fact.py` → `out_fact_cpython.txt` y `out_fact_pyodide.txt`;
  - `exp_pcg.py` → `out_pcg_*.txt`;
  - `pyo_run.mjs memmax` → `out_pyodide_memmax.txt`.

## H14 · scipy es obligatorio: sin él PyNite no se importa y el camino denso solo con numpy no pasa de ~1 000 nudos

> **Soporte A** · **P0** · áreas 1, 4 (MOT-02, PLA-07) · afecta a §1, §9.1, §10.1, §14.2 — confirma (NumPy + SciPy) y descarta un camino «sólo numpy»

**Hallazgo.**
- `FEModel3D.py:9` importa scipy a nivel de módulo: con scipy bloqueado, `import Pynite` falla. El README lo confirma («Scipy has been a required dependency for some time now»).
- Haciendo perezoso ese import, el camino `sparse=False` funciona sólo con numpy, pero no escala. En Pyodide, 928 nudos (5 568 GDL) tardan 11,6 s y llevan el heap a **836 MB**, frente a 6,6 s y 224 MB con scipy sparse. La K densa ocupa (6N)²·8 B y `_partition` la copia: con 2 000 nudos cada copia pasaría de 1 GB.
- scipy 1.17.1 está en el lock de Pyodide 314: wheel de 14,03 MB (13,38 MiB; 48,1 MB descomprimido, 110 `.so`), depende sólo de numpy y no necesita `libopenblas` aparte. Un wheel adelgazado a `_lib` + `linalg` + `sparse` (7,1 MiB) basta para PyNite 3.2.0 y carga 0,6 s antes (área 4).
- PyNite usa scipy para ensamblar (`coo_matrix`, `FEModel3D.py:1791`), resolver (`spsolve`, `Analysis.py:217`) y el análisis modal (`eigsh`, `FEModel3D.py:2533`).

**Recomendación.**
- Cargar scipy siempre. Ampliar `scripts/fetch-pyodide-assets.mjs`, que hoy sólo baja numpy, para que baje también scipy desde el CDN fijado a v314.0.0.
- Registrar numpy 2.4.3 y scipy 1.17.1 en la huella de cada cálculo.
- Descarga total del runtime: ≈ 30,5 MB (≈ 23 MB si se sirve el wasm comprimido). La estrategia de caché está en H26.

**Evidencia.** `investigacion/experimentos/01-motor/pyodide_run.mjs noscipy` → `out_pyodide_noscipy.txt`; `exp_scaling.py` (CPython denso: pico de 773 MB con 928 nudos).

## H15 · La API de resultados de PyNite cuesta 12 veces el cálculo: un operador lineal por elemento la deja en O(elementos)

> **Soporte A** · **P0** · áreas 1, 3 (MOT-04, RES-12) · afecta a §11.1, §12, §14.3, §23.4 — añade

**Hallazgo.**
- `Quad3D.moment/shear/membrane` recalculan `T()`, `J`, `B_b`, `B_s` y `B_m` en cada llamada y para cada caso. `Member3D.*_array` re-segmenta la barra en cada combinación (`Member3D.py:2836`). El área 3 midió 0,44 ms por (quad, caso) en CPython.
- Medición con 928 nudos, 444 barras, 810 quads y 24 casos, extrayendo 6 diagramas × 11 estaciones por barra y las 8 resultantes de quad en el centroide:

  | Método | CPython | Pyodide |
  |---|---|---|
  | API de PyNite | 28,7 s | **50,2 s** (14,3 barras + 35,9 quads) |
  | Operador lineal | 1,6 s | **4,0 s** |

  Con 4 810 nudos y 24 casos, el operador tarda 9,5 s en Pyodide.
- El operador:
  - **quads:** una matriz 8×24 por elemento, construida una vez con las `B` y `H` de PyNite (Gauss 2×2 + `T`) y aplicada como `op @ D[gdl,:]` a todos los casos a la vez;
  - **barras sin carga en el vano:** diagrama exacto desde los esfuerzos de extremo `f = ke·T·D` (N = f0, Vy = f1, Vz = f2, T = f3, My = −f4 − f2·x, Mz = f5 − f1·x);
  - **barras con carga en el vano:** la API de PyNite, o la reconstrucción en TypeScript de la recomendación.
- Exactitud frente a la API: 2,6e-11 en quads y 1,5e-11 en barras.

**Recomendación.**
- El adaptador devuelve, por caso: desplazamientos (`Float64Array` de 6N), esfuerzos de extremo de barra (12 por barra) y resultantes de lámina con el operador precalculado.
- Los diagramas de barras con carga en el vano se reconstruyen en TypeScript a partir de los esfuerzos de extremo y de las cargas, que Concreta ya conoce porque las generó. Son fórmulas cerradas, como `BeamSegZ.py:104-142`.
- Un test fija que el operador coincide con `Quad3D.moment/shear/membrane` en elementos aleatorios.

**Evidencia.** `investigacion/experimentos/01-motor/exp_results.py` → `out_results_cpython.txt`, `out_results_pyodide.txt`, `out_results_pyodide_4810_fast.txt`.

## H16 · El heap WASM crece con el modelo y nunca vuelve a bajar (hasta 4 GiB); un worker caliente cuesta ~335 MB de proceso: el límite se fija en GDL y el worker se recicla

> **Soporte A** · **P0** · áreas 1, 4 (MOT-17, MOT-02, MOT-13, PLA-05) · afecta a §14.2, §14.3 («WASM una vez por sesión»), §19, §21, §23.8, §23.9 — corrige

**Hallazgo.**
- Heap WASM medido (`HEAP8.buffer.byteLength`):

  | Momento | Heap |
  |---|---|
  | numpy + scipy cargados | 62,4 MB |
  | Tras `import Pynite` | 74,9 MB |
  | 928 nudos | 224–230 MB |
  | 2 650 nudos | 352–362 MB |
  | 4 810 nudos (4 o 24 casos) | 556–662 MB |

- **La memoria WASM sólo crece.** Un worker que resolvió un modelo grande conserva ese tamaño. Cinco ejecuciones seguidas de 928 nudos, devolviendo sólo números, dejan el heap estable en 228 MB: no hay fuga, se queda en el pico.
- **Medido como memoria de proceso** en Chrome 153 (área 4):

  | Momento | Memoria privada |
  |---|---|
  | Página base | 335 MB |
  | Worker con Pyodide + scipy arrancado | 670 MB (+335) |
  | Tras un laplaciano de 90 000 GDL | 1 166 MB |
  | Tras llenar el heap hasta `MemoryError` y liberar en Python | 4 617 MB (heap WASM aún en 4 096 MB) |
  | 3 s después de `terminate()` | 335 MB |

- **Techos.** El techo del heap es de 4 GiB (`getHeapMax` en `pyodide.asm.mjs`); en Node se reservaron 4 032 MB. En iOS 17 la memoria fiable estaría entre ~300 MB y 1 GB (WebKit, bug 269777; soporte C).
- **CPython como contraste:** pico con sparse de 105 MB con 928 nudos y de 287 MB con 4 810 nudos y 24 casos.
- **Contradice §14.3** («inicialización de WASM una vez por sesión»): un worker de sesión conservaría su pico de memoria.

**Recomendación.** Política de vida del worker:
1. Arrancarlo en reposo al entrar en el módulo, como `useSlopeSolver`.
2. Informar del heap (`HEAP8.buffer.byteLength`) en cada `progress` y al terminar.
3. Si tras un cálculo el heap supera un umbral (≈ 0,5–1 GiB), o el usuario lleva N minutos fuera del módulo, hacer `terminate()` y volver a arrancar cuando haga falta.
4. Límite previo del modelo en GDL, no en MB, por tipo de dispositivo (§19).
5. El test del §21 («no aumenta la memoria») mide el heap WASM, no el de JS.
6. Medir el techo real en Safari iOS y Chrome Android en la Fase 0.

**Evidencia.** `investigacion/experimentos/01-motor/out_fast_pyodide.txt`, `out_scaling_pyodide_*.txt`, `out_pyodide_modes.txt`, `out_cancel.txt`; `investigacion/experimentos/04-plataforma/bench/memoria_procesos.json`, `pyodide_sin_coi.json`.

## H17 · La membrana Q4 bloquea a flexión en el plano: un muro con un elemento por planta es un 32 % demasiado rígido; hacen falta ≥ 8 elementos a lo largo de cada paño

> **Soporte A** · **P0** · áreas 1, 5 (VAL-02, MOT-07) · afecta a §7.3, §23.2, §23.10 — corrige (el tamaño de malla de los muros no puede ser libre)

**Hallazgo.**
- **Muro en voladizo de 3 plantas** (H = 9 m, B = 3 m, 25 cm) frente a una viga de Timoshenko (área 5):

  | Malla | 1×3 | 2×6 | 4×12 | 8×24 | 16×48 |
  |---|---|---|---|---|---|
  | Error | **−32,1 %** | −11,7 % | −3,6 % | −1,2 % | −0,5 % |

  Richardson da p = 1,89 y el valor extrapolado queda a −0,28 %.
- **Muro bajo de 3×3 m:** 1×1 −35 %, 4×4 −5,8 %, 8×8 −1,8 %.
- **Área 1, por su lado:** muro en voladizo con 3, 6 y 12 elementos de ancho da 0,935, 0,980 y 0,992 de la flecha de Timoshenko.
- **Viga recta de MacNeal–Harder** (6×1, cortante en el plano, referencia 0,1081): 0,093 con elementos rectangulares, **0,027** trapezoidales y 0,034 en paralelogramo. La membrana distorsionada bloquea mucho más.
- **OpenSees, mismo muro 1×3:** `ShellDKGQ` −7,4 % y `ASDShellQ4` −3,8 %, porque ambos tienen membrana con drilling.
- **Consecuencia:** muros demasiado rígidos atraen más cortante horizontal y descargan los pórticos, que quedan del lado inseguro.

**Recomendación.**
- Mínimo **8 elementos a lo largo de cada paño de muro** y relación de aspecto ≤ 2. El tamaño de malla del muro depende de su longitud, no de un `targetSize` libre.
- Mallar los muros con rejilla estructurada por paño (ver H29), no con cuadriláteros irregulares.
- Diagnóstico (§16) si no se cumple.
- Regresión: la viga de MacNeal–Harder y el muro 1×3 fijan el comportamiento actual, y su error, del motor.

**Evidencia.** `investigacion/experimentos/05-validacion/exp02_membrana.py` → `out_exp02.txt`; `exp08_opensees.py` → `out_exp08.txt`; `investigacion/experimentos/01-motor/exp_muro.py` → `out_exp_muro.txt`.

## H18 · Los cortantes Qx/Qy de `Quad3D` infravaloran el exacto un 30–50 % con mallas de obra: no pueden ser dato de comprobación

> **Soporte A** · **P0** · áreas 3, 5 (VAL-03, RES-04) · afecta a §2.1, §13.2, §23.3 — contradice que Qx/Qy sean «resultado primario» para comprobar

**Hallazgo.**
- **Losa apoyada** (ν = 0,2): Qx en el centroide de los elementos junto al apoyo y a a/4, frente a Navier (área 5):

  | a/t | 16×16 | 32×32 |
  |---|---|---|
  | 10 | −4 % / −7 % | −1 % / −2 % |
  | 25 | −17 % / −28 % | −6 % / −10 % |
  | 40 | −26 % / −42 % | −13 % / −21 % |
  | 100 | −35 % / −57 % | −28 % / −46 % |

- El error depende de h/t. Una losa de 25 cm mallada a 0,5 m (h/t = 2) queda entre −30 % y −50 %, siempre del lado inseguro. Sólo converge cuando el elemento es más pequeño que el espesor.
- **Losa unidireccional de 4 m** (área 3): Qx extrapolado al borde apoyado da 16 742 N/m, frente a q·a/2 = 20 000 (−16 %).
- **Causa:** Q = Hs·B_s·d con el factor φ/(1+φ) de la DKMQ (`Quad3D.py:1017-1072`).

**Recomendación.**
- Marcar Qx/Qy como «sólo visualización» en el `ResultModel` y excluirlos de los extractores de §13.
- Para cortante y punzonamiento, usar reacciones o fuerzas nodales en las líneas de apoyo.
- O recuperar Q por equilibrio en Concreta, derivando M sobre parches de elementos. Objetivo: ≤ 5 % con h/t ≈ 2. Está abierto: ver S5.

**Evidencia.** `investigacion/experimentos/05-validacion/exp01_placas.py`, `exp01b_cortante_signos.py`, `exp01d_cortante_losa.py` → `out_exp01d.txt`; `investigacion/experimentos/03-resultados/exp_pynite_mx_significado.py`.

## H19 · PyNite une nudos y trocea barras en silencio a 1e-12·L, y su `merge_duplicate_nodes` pierde cargas: todas las fusiones las hace el compilador

> **Soporte A** · **P0** · áreas 1, 2 (MOT-15, COM-06) · afecta a §7.2 («no se usarán uniones por proximidad opacas»), §8.1, §9.1, §9.2 — contradice si no se controla

**Hallazgo.**
- **Troceado implícito.** Toda barra es un `PhysMember`. En cada análisis, `descritize()` recorre todos los nudos del modelo (O(barras × nudos)) y parte la barra en cualquier nudo a menos de **1e-12·(1+L) m** de su eje (`PhysMember.py:64-66, 79`). Las sub-barras se llaman `nombre+chr(97+i)`.
  - Un nudo a 0 o a 1e-13 m de una viga queda conectado sin aviso y cambia la solución (DY = −1,421e-6 frente a −1,429e-6).
  - A 1e-9 o 1e-6 m ya no conecta, y el análisis aborta con «stiffness matrix is singular» sin decir dónde. Eso está dentro de la tolerancia de 1e-6 m del §5.3.
- **Fusión de duplicados.** `merge_duplicate_nodes(1e-3)` es O(n²) y depende del orden del diccionario. Reasigna los apoyos, pero **no las cargas nodales**: en el ensayo, una carga de 50 kN en el nudo fundido desaparece (ΣRx = 0).

**Recomendación.**
- El compilador trocea cada barra en todos sus nudos y emite coordenadas idénticas bit a bit para los nudos compartidos.
- No llamar nunca a `merge_duplicate_nodes`.
- Tras `_prepare_model`, el adaptador comprueba `len(pm.sub_members) == 1` en cada barra. Si no, error «unión implícita no prevista» con los IDs físicos.
- La fusión con tolerancia de modelado es del compilador: ver H28.

**Evidencia.** `investigacion/experimentos/01-motor/exp_autosplit.py` → `out_exp_autosplit.txt`; `investigacion/experimentos/02-compilador/py/exp_pynite.py` (P2 y P3); `FEModel3D.py:475, 953-1058`.

## H20 · Cancelar un cálculo es `terminate()` y cuesta ~5 s de re-arranque: el mensaje `cancel` no llega a un worker ocupado, el interrupt por SharedArrayBuffer no corta SuperLU y `coi-serviceworker` choca con la PWA

> **Soporte A** · **P0** · áreas 1, 4 (PLA-01, PLA-02, PLA-03, PLA-04, MOT-13, MOT-19) · afecta a §9 (`SolverContext.signal`), §14.1, §14.2, §21 («puede cancelarse»), §23.9 — corrige

**Hallazgo.**
- **El `cancel` por mensaje no llega a tiempo.** Un worker atiende una tarea cada vez, y `runPython` y `spsolve` son síncronos. En Chrome, un `cancel` enviado a los 100 ms de un cálculo de 2 s se atendió a los 2 000 ms, cuando el worker ya había enviado `success`. En la otra dirección sí funciona: los `progress` del worker llegan con 4 ms de retraso. En Node (`worker_threads`) el área 1 midió lo mismo: 4 976 ms de espera.
- **Cancelación cooperativa** (área 1, en Node). Con `runPythonAsync` y `await asyncio.sleep(0)` entre fases, el mensaje se atiende en el siguiente punto de cesión: el cálculo paró 1,8 s después del envío. Esa latencia es el tramo síncrono más largo (ensamblado + factorización). Falta probarlo en un Worker de navegador.
- **SharedArrayBuffer no basta** (área 4, servidor local con COOP/COEP). `setInterruptBuffer` corta un bucle Python en 4 ms, pero no `splu`: con 10⁶ GDL la señal no tuvo efecto y siguió 21 s hasta un `MemoryError`. El código C sólo se interrumpe si llama a `PyErr_CheckSignals()`.
- **COOP/COEP no es viable en GitHub Pages.**
  - Pages no los envía (`curl -I https://concreta.tools/`) ni admite cabeceras propias.
  - `coi-serviceworker` 0.1.7 se registra con scope `/`, el mismo que `/sw.js` de Workbox, así que cada SW reemplazaría al otro.
  - Hace `skipWaiting()` + `clients.claim()` incondicionales (anula el `registerType: "prompt"` y su toast).
  - Reenvía todo a la red sin caché (adiós al offline), recarga la página en la primera visita y usa `sessionStorage` sin pasar por `seguro.ts`.
- **Coste de `terminate()`:** 52 ms. Re-arrancar después:
  - Pyodide + numpy + scipy, en Chrome: 5,7 s en frío y 5,2 s con la caché HTTP caliente, porque el coste es CPU (instanciar 110 `.so` e importar), no red;
  - importar PyNite y resolver suma 1,5 s más en Node;
  - en portátil o móvil, bastante más.
- **Instantánea de memoria de Pyodide** (`_makeSnapshot`): falla en cuanto hay numpy o scipy cargados.

**Recomendación.**
- **Protocolo.** Quitar `cancel` del protocolo hacia el worker de Pyodide, y el `AbortSignal` del contrato dentro de ese worker.
- **Cancelar,** en el cliente del hilo principal:
  1. `terminate()`;
  2. rechazar las promesas pendientes (Comlink no tiene timeout);
  3. recrear el worker en segundo plano, mostrando «preparando motor».

  Es lo que ya hace `src/lib/calculations/geotech/client.ts` (`cancelAndRewarm`).
- **Driver como corrutina.** Puntos de cesión tras el ensamblado, tras cada caso y cada ~200 elementos en la extracción. Así los `progress` y una futura cancelación cooperativa tienen dónde entrar. `terminate()` es la reserva si no hay respuesta en ~2 s.
- **Worker de compilación y mallado** (TypeScript): si trocea su trabajo con `await`, a ese sí le sirve un `cancel` por mensaje.
- **No introducir COOP/COEP ni `coi-serviceworker`.** Si algún día hace falta SharedArrayBuffer, es un proyecto aparte: proxy con cabeceras o SW propio con `injectManifest` y pruebas offline.
- **P2:** un worker de reserva caliente sólo mientras dura un cálculo largo. Cancelar sería cambiar de worker, a cambio de ~335 MB.

**Evidencia.**
- `investigacion/experimentos/04-plataforma/bench/cancel_msg.js` → `cancel_msg.json`, `progreso.json`.
- `bench/pyo.js` + `bench/server.mjs --coi` → `pyodide_con_coi.json`, `pyodide_sin_coi.json`.
- `investigacion/experimentos/01-motor/cancel_main.mjs` + `cancel_worker.mjs` → `out_cancel.txt`.
- https://pyodide.org/en/stable/usage/keyboard-interrupts.html; https://github.com/orgs/community/discussions/13309

## H21 · Una combinación de factor 1 por caso simple permite a Concreta superponer con error ≤ 6e-13: las combinaciones normativas nunca llegan a PyNite

> **Soporte A** · **P1** · áreas 1, 5 (MOT-11, VAL-10) · afecta a §11.1, ADR-006, §21 («Concreta combina…») — confirma

**Hallazgo.**
- PyNite sólo resuelve «combinaciones» (`load_combos`). Los casos son etiquetas dentro de las cargas, y sin combinación no hay solución: `Analysis._prepare_model` crea `Combo 1` = `Case 1`.
- Con las combinaciones `{'G':1}`, `{'Q':1}`, `{'W':1}` y una ELU `{'G':1.35,'Q':1.5,'W':0.9}`, la ELU de PyNite y la Σ factor·caso difieren en 7,6e-16 en desplazamientos, 6,2e-13 en esfuerzos de barra y 3,3e-12 en resultantes de quad. Mismas cifras en Pyodide.
- El área 5 lo midió por su lado: 1,35·G + 1,5·H frente a la combinación da 4,7e-16.

**Recomendación.** El adaptador crea exactamente una combinación de factor 1 por `LoadCase` de Concreta, con el mismo id. Las combinaciones y envolventes viven en `CombinationEngine` (ver H30).

**Evidencia.** `investigacion/experimentos/01-motor/exp_a_minimo.py` → `out_exp_a_zup.txt`, `out_pyodide_minimo.txt`; `investigacion/experimentos/05-validacion/exp06_metamorficas.py` → `out_exp06.txt`.

## H22 · PyNite tiene un mantenedor casi único, tres versiones mayores en 19 meses y tests con tolerancias del 15–70 %: Concreta necesita su propia batería y fijar el vendor por hash

> **Soporte A** · **P1** · áreas 1, 5 (MOT-18, VAL-15, MOT-20) · afecta a §9.1, §10.1, §17, ADR-009 — añade riesgo

**Hallazgo.**
- **Mantenimiento.** Craig Brinck (JWock82) firma el 91,7 % de los 2 198 commits y 266 de los 300 desde octubre de 2025. 751 estrellas, 151 forks y 21 issues abiertos, entre ellos #102 (estática con quads), #251/#269 (rendimiento), #292 (MPC) y #250/#341 (Timoshenko).
- **Ritmo de rupturas.** 74 versiones publicadas, ≈ 1,2 al mes desde diciembre de 2024. Versiones mayores: 1.0.0 (2025-02-01), 2.0.0 (2025-12-15) y 3.0.0 (2026-06-01), que renombró `K/k` a `Ke/ke`, internos que usa el driver de H04. HEAD (4afc9f1, 2026-09-28) cambia 20 ficheros respecto a la etiqueta 3.2.0, sobre todo por estilo.
- **Batería de tests de PyNite** (etiqueta 3.2.0):

  | Test | Tolerancia |
  |---|---|
  | Placa hidrostática frente a T&WK, una sola malla | 15 % |
  | Muro frente a barras | 35 % |
  | Reacción de Kassimali 3.35 | 70 % |
  | Muro de quads 10×20 | 0,1 %, sin detectar el bloqueo en mallas gruesas |

  Ninguna prueba llama a `shear()` de un quad ni a `local=False`. Tampoco hay patch tests, Scordelis-Lo, mallas distorsionadas ni uniones barra–lámina.
- **Regresiones pasadas:** la membrana valía ¼ de su rigidez hasta la v0.0.52 (#104), las barras giradas daban esfuerzos erróneos de la 1.0.0 a la 1.5.0 (#284) y los quads esviados se corrigieron tarde (#78, #198).
- **Persistencia** (soporte C). El mantenedor no pudo abrir un modelo serializado con *pickle* tras cambiar la clase `Node` (#102). Los objetos `FEModel3D` tienen referencias cruzadas y estado por combinación.

**Recomendación.**
- Fijar `PyNiteFEA==3.2.0` por el sha256 del wheel. Tratar cada subida de versión mayor como una migración con la batería contractual completa.
- Pasar cada mes la batería contra el HEAD de PyNite en CI, como alerta temprana.
- No delegar en los tests de PyNite: Concreta tiene su propia batería (ver H40).
- Valorar un fork mínimo que corrija `local=False` y el `Db` de `Plate3D`, o simplemente no usarlos (ver H01 y H06).
- Persistir sólo el `AnalyticalModel` de Concreta y `Float64Array` por caso; nunca objetos de PyNite.

**Evidencia.** `curl https://pypi.org/pypi/PyNiteFEA/json`; `git log` del repositorio clonado; `pynite-3.2.0/Testing/*.py`; issues #78, #102, #104, #198, #284.

## H23 · Las CDT y PyNite aceptan entradas malas sin error (duplicados, orden, orientación, jacobiano negativo, alabeo): la malla se normaliza antes y se valida después

> **Soporte A** · **P1** · áreas 2, 5 (COM-10, COM-11, VAL-11, COM-01) · afecta a §5.2 (normal coherente), §7.3 («malla inválida = error»), §16, §21 (compilación determinista) — añade

**Hallazgo.**
- **Puntos duplicados exactos:**
  - `cdt2d` devuelve un área de 5 m² sobre 103;
  - `cdt-js` lanza una excepción WASM numérica sin mensaje;
  - `poly2tri` da triángulos con ángulos NaN;
  - Delaunator ignora el duplicado, pero el índice que guarda el compilador para el pilar queda huérfano: el pilar no se uniría a la losa.
- **Determinismo.** Con puntos cocirculares (retícula cuadrada de Steiner) la malla depende del orden de entrada, y cada biblioteca da una distinta. Con retícula triangular todas coinciden y son invariantes al orden. Para una misma entrada en el mismo orden, todas son deterministas.
- **Orientación.** Delaunator documenta triángulos «counterclockwise», pero en ejes y-arriba el área con signo sale **negativa**. En PyNite, el signo de la presión sigue al orden de nudos (±0,083 mm), y con él el de Mx.
- **PyNite no valida.** Un jacobiano ≤ 0 sólo produce un `UserWarning` (resultados un −60 %). El alabeo no se avisa, y los planos locales de `_local_coords` (i, j, m) y de `T()` (i, j, n) no coinciden.

**Recomendación.**
- **Antes de mallar:**
  - fusionar con ε_geom/ε_snap usando un `Map` de clave cuantizada;
  - ordenar canónicamente (lexicográfico sobre coordenadas cuantizadas, luego ID físico);
  - sembrar con retícula triangular;
  - fijar la versión de la biblioteca en la huella del compilador.
- **Después de mallar,** validador obligatorio:
  1. Σ áreas = área del polígono menos huecos, a 1e-9 relativo.
  2. Ninguna orientación invertida; normal +Z en losas y normal exterior documentada en muros.
  3. Cada subsegmento restringido es arista de la malla.
  4. Cada punto obligatorio es un vértice usado.
  5. Sin nudos huérfanos.
  6. Jacobiano escalado en los 4 puntos de Gauss: error si es ≤ 0.
  7. Alabeo: error si supera 1e-3 del lado, aviso por encima de 1e-4.

  Si falla, error con el `PhysicalRef` de la losa o del muro.
- **Umbrales de calidad.** El área 5 propone ángulos interiores entre 45° y 135°. Esa ventana rechazaría las mallas de triángulos divididos en quads (máximo 151°), que dan buena flexión (H10). Hay que calibrar el umbral sobre el jacobiano escalado con los benchmarks, no por ángulo.
- **Test:** la misma losa barajada tres veces da la misma huella geométrica.

**Evidencia.** `investigacion/experimentos/02-compilador/js/salida-mallado-resumen.txt` (variantes D y S); `py/exp_pynite.py` (P6); `investigacion/experimentos/05-validacion/exp01_placas.py` (caso F), `exp06b_solido_rigido.py`.

## H24 · El peso propio no puede salir de ρ·t: Cargas por planta ya publica `pp`, en vigas planas se contaría dos veces y PyNite no tiene peso propio de láminas

> **Soporte A** · **P1** · áreas 1, 2 (COM-16, COM-14, MOT-08, MOT-16) · afecta a §5.1, §6, §7.1 paso 9, §11 (`selfWeightFactor`) — corrige

**Hallazgo.**
- **De dónde sale hoy el peso propio.** `PubZonaCargas` publica por zona `pp`, `resto` y `G` en kN/m² (`src/features/cargas-planta/state.ts:761-792`). El `pp` viene de la tabla C.5 del CTE: unidireccional 3–4 kN/m², reticular 4–5 kN/m², maciza ρ·h.
- **ρ·t no vale para el reticular.** Un 30+5 equivalente en rigidez es una placa de 233 mm. Su ρ·t daría 5,8 kN/m²; la T sola, 2,35; la norma pide 4–5, porque incluye ábacos y bovedillas.
- **Vigas planas** (canto = forjado, muy habituales en España): el peso b·h de la barra se solapa al 100 % con el `pp` de la losa. En una descolgada de 30×50 bajo losa de 25 cm, se solapa al 50 %.
- **Lo que admite PyNite:**
  - no tiene peso propio de láminas (`add_member_self_weight` ignora placas y quads);
  - en barras, `rho` es un peso específico;
  - presión uniforme por elemento y fuerzas nodales equivalentes (p·A/4) dan resultados idénticos: Mx = 44,035, Qx = −2,416, w = 4,3953 mm y R = 180 kN.

**Recomendación.**
- **Separar** en el modelo analítico `stiffnessThickness` (rigidez) y `selfWeightPressure` (peso, del `pp` de la zona o de la tipología).
- **Vigas:** sólo pesa su descuelgue, b·(h − t_losa), o se descuenta la losa bajo la viga. Elegir una regla y documentarla como hipótesis visible.
- **El compilador emite el peso propio** como carga explícita del caso G, nunca a través de `rho` en el solver.
- **`ShellLoad` con dos formas:**
  - presión constante por elemento;
  - fuerzas nodales consistentes, para el empuje de tierras trapecial de los muros de sótano, la tabiquería lineal sobre losa (línea embebida) y las puntuales.
- **Trazabilidad.** Cada fuerza conserva el `loadId` físico, para el control «sin pérdidas» del §21: Σ fuerzas analíticas = Σ físicas, por caso, a 1e-9.

**Evidencia.** `src/lib/acciones/cargas.ts:278-296`, `tablasCargas.ts:101-115`; `investigacion/experimentos/02-compilador/py/espesor_equivalente.py` → `salida-espesor-equivalente.txt`; `py/exp_presion_vs_nodal.py` → `salida-presion-vs-nodal.json`.

## H25 · Las losas se dimensionan por bandas, no por valores puntuales: el pico sobre el pilar crece un 65 % al refinar y el de la cara es errático, pero la integral de banda converge (±1 %)

> **Soporte A** · **P1** · áreas 2, 3 (RES-09, COM-15) · afecta a §12.1, §13.2 (suavizado ΔM = F·t/8), §15.4 — corrige

**Hallazgo.**
- **Losa plana** de 12×12 m sobre 3×3 pilares, h = 0,25 m, con todos los paños cargados alrededor del pilar central:

  | Malla | Mx en el nudo | Mx en la cara (x = 6,20) | ∫ banda de pilar (3 m) | ∫ pórtico virtual (6 m) |
  |---|---|---|---|---|
  | h = 1,0 m | 192,9 kN·m/m | 153 kN·m/m | 211 kN·m | 331 kN·m |
  | h = 0,5 m | 254,6 kN·m/m | 165 kN·m/m | 264 kN·m | 337 kN·m |
  | h = 0,25 m | 318,7 kN·m/m | 112 kN·m/m | 261 kN·m | 337 kN·m |

- **Reparto entre bandas.** La banda de pilar se lleva el 77 % del momento negativo, dentro del 60–80 % de la tabla A19.I.1.
- **ΔM = F·t/8 no sirve aquí.** El §5.3.2.2(4) del CE A19 es para apoyos «supuestamente sin coacción al giro (por ejemplo, sobre muros)» y con la reacción por unidad de ancho. Para un pilar puntual (F = 715 kN, t = 0,40 m) daría 35,7 kN·m en total, no por metro: no aplica dimensionalmente.
- **Uniones monolíticas.** El §5.3.2.2(3) manda tomar el momento en la cara del apoyo, no menor que una fracción del de empotramiento perfecto. El factor está en una imagen del BOE y queda por leer.
- **Coste en PyNite** (CPython, API estándar): 4,4 / 16,8 / 77 s para 1 014 / 3 750 / 14 406 GDL.

**Recomendación.**
- **Bandas de dimensionado** en el MVP de losas: de pilar e intermedias, según el Ap. I, definidas sobre el modelo físico.
- **Integración por combinación:** Mx, My y Mxy en las estaciones de la banda. Wood–Armer (H34) se aplica a los valores medios de la banda o a cada punto antes de integrar.
- **Salida:** pasar el resultado a `rcSlabs`/forjados por metro o por nervio.
- **Picos nodales:** no dimensionar nunca con ellos; se muestran como dato bruto marcado.
- **Huella del pilar:** modelarla (ver H09). No implementar F·t/8 para pilares de losa plana.
- **Pendiente de decidir:** quién define las bandas (ver S2).

**Evidencia.** `investigacion/experimentos/03-resultados/exp_losa_plana.py` → `salida_losa_plana.txt`; CE A19 §5.3.2.2(3)-(4), Ap. I (I.1.1(2), I.1.2(3), tabla A19.I.1); CSI SAFE, «Strip force integration».

## H26 · Con scipy, la caché offline del motor pasa de 15,7 a 29,3 MiB (7,1 MiB de scipy si se adelgaza) y el primer uso por enlace directo no queda en caché porque falta `clientsClaim`

> **Soporte A** · **P1** · áreas 1, 4 (PLA-06, PLA-07, MOT-02, MOT-14) · afecta a §1, §2.3-1, §9.1 («funcionamiento offline… empaquetando los recursos»), §20 Fase 0, §23.7 — corrige

**Hallazgo.**
- **Tamaños:**

  | Concepto | MiB |
  |---|---|
  | `public/pyodide/` actual (núcleo 12,92 + numpy 2,78) | 15,70 |
  | + scipy 1.17.1 completo | 29,3 |
  | + matplotlib real (lo que evitan los stubs) | 39,1 |
  | scipy adelgazado a `_lib` + `linalg` + `sparse` | 7,10 (en lugar de 13,38) |
  | PyNite vendorizado | 0,12 (gzip) |

  - **scipy adelgazado.** Quitando 16 subpaquetes de scipy (stats, optimize, spatial, io, interpolate, signal…), el pórtico de prueba da el mismo resultado, un `Quad3D` se ensambla y resuelve, y la carga es 0,6 s más rápida.
  - **Descarga del primer uso.** GitHub Pages comprime el `.wasm` con gzip, pero no los `.zip` ni los `.whl`: ≈ 23,3 MB con scipy completo, frente a ≈ 9,3 MB de taludes hoy.
  - **Ancho de banda** (soporte C). Con el límite blando de 100 GB/mes de Pages, salen ~4 300 primeras cargas al mes.
- **El primer uso por enlace directo no se cachea.** Con `registerType: "prompt"`, vite-plugin-pwa no pone `clientsClaim` (`dist/index.js:874-877`).
  - En un perfil nuevo que entra directamente en `/geotec/taludes`, el worker bajó los 6 ficheros de `/pyodide/`, pero no quedaron en caché: al recargar los volvió a bajar.
  - Entrando por `/` y navegando al módulo sí se llena `pyodide-runtime-v314_0_0`.
  - En Chrome 153, `clients.claim()` toma el control incluso de un worker dedicado creado antes.
- **El precache no sirve para esto:** tiene un tope de 4 MiB por fichero, y sólo scipy pesa 13,38 MiB.

**Recomendación.**
1. **Bajar scipy en el build.** Extender `scripts/fetch-pyodide-assets.mjs` con scipy, comprobando su sha256 contra el lock.
2. **Vendorizar PyNite** con stubs (ver H03).
3. **Caché del motor en tiempo de ejecución,** no en el precache: `CacheFirst` con el nombre de la caché ligado a la versión de Pyodide. El repo fija la 314.0.0 y ya hay 314.0.7 publicada: decidir cuál.
4. **Arreglar el primer uso.** Añadir `clientsClaim: true` a `workbox`; el SW nuevo sigue esperando al toast porque no hay `skipWaiting`. O, más explícito, un botón «Preparar para usar sin conexión» que llame a `caches.open(...).addAll([...ficheros del lock])` y muestre «motor disponible sin conexión». Verificarlo en Safari y Firefox.
5. **scipy adelgazado:** estudiarlo como artefacto propio versionado, con su sha256, su aviso BSD-3 y un golden test que ejercite `Quad3D`, P-Delta y `eigsh` en Pyodide.

**Evidencia.** `investigacion/experimentos/04-plataforma/tamanos_pyodide.out.txt`, `scipy_subpaquetes.out.txt`, `prueba_slim.out.txt`, `medir_dist.out.txt`; `bench/cdp_pwa.mjs` → `pwa_pyodide.json`, `pwa_pyodide_directo.json`, `server_dist.log`; `bench/claim/` → `claim.json`.

## H27 · La frontera worker → UI no puede ser JSON: 46 MB de resultados se transfieren en 3,7 ms, mientras que `stringify` + `parse` cuestan 436 ms (1,8 s con la CPU ×4) y bloquean el hilo principal

> **Soporte A** · **P1** · áreas 3, 4 (PLA-14, RES-12) · afecta a §12 (`elementIds: Id[]`), §14.2 («Transferable»), ADR-008 — confirma y corrige el precedente de taludes

**Hallazgo.**
- **6 M de doubles** (45,8 MB):

  | Operación | ×1 | CPU ×4 |
  |---|---|---|
  | Copia por *structured clone* | 49 ms | 155 ms |
  | Transferencia | 3,7 ms | 2,8 ms |
  | `JSON.stringify` (57,5 MB de texto) | 272 ms | 1 095 ms |
  | `JSON.parse` en el hilo principal | 164 ms | 709 ms |

- **Detalles de la transferencia:**
  - tras transferir, el buffer del emisor queda con `byteLength = 0`;
  - Comlink sólo adjunta los transferibles si se marca el objeto de primer nivel que se devuelve (`transferCache` es un `WeakMap` por identidad);
  - las cadenas de `Id[]` no se pueden transferir.
- **Precedente de taludes.** Devuelve el resultado como cadena JSON (`json.dumps`). Sirve para metadatos y diagnósticos, no para el `BaseCaseResultSet`.
- **Precisión.** Float32 no permite verificar el equilibrio a 1e-9 (área 3): los resultados van en Float64. La geometría de dibujo puede ir en Float32.

**Recomendación.**
- Devolver `Comlink.transfer(artifact, [todos los .buffer])` con los `Float64Array` del §12.
- Enviar los ids una sola vez, como tabla densa; en los bloques, índices.
- Si el worker necesita conservar los resultados (p. ej. para combinar), copiarlos antes de transferir, o hacer las combinaciones en el worker de TypeScript.

**Evidencia.** `investigacion/experimentos/04-plataforma/bench/platform.js` → `bench/plataforma_x1.json`, `plataforma_x4.json`; `node_modules/comlink/dist/esm/comlink.mjs:295-332`.

## H51 · Un ensamblado propio vectorizado en numpy reproduce a PyNite a 2,4e-16 y es entre 35 y 65 veces más rápido: con SuperLU en Pyodide, el edificio objetivo se calcula en 6 s, con un techo de unos 180 000 GDL por memoria

> **Soporte A** · **P0** · áreas 6 (ESC §1.1 §4 §7) · afecta a §9.1, §14.3, H04, H16 — abre una vía intermedia

**Hallazgo.**
- **Qué hace `vec_asm.py`.** Reescribe en numpy, por lotes:
  - `Quad3D.ke`, `Ke` y `fer` (DKMQ + Q4 con el muelle de drilling);
  - `Member3D.ke`, `T` y FER.

  Ensambla por bloques 6×6 con `np.bincount`.
- **Coincide con PyNite.** En un edificio de una planta (2 349 nudos):
  - K, a 2,4e-16;
  - P − FER, a 1,6e-16;
  - desplazamientos, a 3,1e-13.
- **Tiempos en Pyodide** (con la máquina tranquila; con carga, × 1,5):

  | Modelo | GDL libres | Total | Ensamblado | Factorización | Heap |
  |---|---|---|---|---|---|
  | V3 unidireccional | 44 268 | 1,7 s | 0,3 s | 1,0 s | 0,6 GB |
  | V1 maciza, h = 1,0 | 94 206 | 4,4 s | 0,8 s | 3,0 s | 1,4–1,7 GB |
  | **V1 maciza, h = 0,75** (densidad de H10) | 164 472 | **6,0 s** | 1,4–1,6 s | 3,6–3,7 s | 2,3–2,8 GB |
  | V1 maciza, h = 0,5 | 312 816 | 13,1 s en modo `lean`; si no, falla | 3,4 s | 8,4 s | 4,0 GB |

- **Es una vía intermedia:** un motor propio en Python dentro de Pyodide, con PyNite sólo como oráculo. Arrastra dos tipos de límites:
  - los del elemento de PyNite, mientras no se reescriban: drilling a tierra, sin MPC y flexión isótropa;
  - los de Pyodide: 23–29 MiB de descarga, 4–6 s de arranque y un heap que no baja (H26, H16).
- **Techo.**
  - En sobremesa, unos 30 000 nudos / 180 000–200 000 GDL, limitado por memoria. A partir de 300 000 GDL falla de forma intermitente.
  - Con el mallador CDT de H29, el edificio objetivo sale con unos 44 000 nudos / 265 000 GDL (H52): queda al borde.
  - En móvil, unos 45 000 GDL.

**Recomendación.**
- Es el **plan B ya medido** si el spike del motor propio falla (S7): el edificio objetivo cabe en sobremesa con una malla de rejilla alineada.
- `vec_asm.py` sirve además de oráculo vectorizado para el motor propio, porque coincide con PyNite a 1e-16.
- Si se sigue con Pyodide, la recomendación P2 de H04 («vectorizar `Quad3D.ke()` y FER») pasa a P0.

**Evidencia.** En `investigacion/experimentos/06-escala/`:
- `vec_asm.py` y `exp_validar.py`;
- `exp_vec.py` → `out_vec_cpython.txt`, `out_vec_pyodide.txt`, `out_vec_pyodide_lean.txt` y `out_vec_pyodide_rep.txt`.

Informe: §1.1, §4 y §7.

## H52 · El edificio objetivo (7 plantas, 10×8 pilares, 2 núcleos) tiene ~27 500 nudos y 165 000 GDL en losa maciza con la malla de H10, ~33 000 nudos en reticular con ábacos y ~7 500 en unidireccional con viguetas como barras

> **Soporte A** · **P0** · áreas 6 (ESC §1 §2) · afecta a §14.3, D2, D9, H29, H46 — dimensiona el motor

**Hallazgo.** Edificio paramétrico (`edificio.py`):
- 7 plantas: la baja de 4,0 m y el resto de 3,0 m;
- retícula de 10×8 pilares con luces de 5,5 × 5,0 m (49,5 × 35 m en total);
- pilares de 40×40 y 30×30;
- núcleos de ascensor (2,0×2,0) y escalera (2,5×5,0) con muros de 25 cm, mallados con 8 elementos por altura.

| Variante | Malla | Nudos | GDL libres | Barras (de penalización) | Quads |
|---|---|---|---|---|---|
| V1, maciza de 25 cm | h = 1,0 | 15 807 | 94 206 | 6 160 | 15 162 |
| V1 | h = 0,75 (≈ 8 elementos por vano, H10) | 27 526 | 164 472 | 8 078 | 26 684 |
| V1 | h = 0,5 | 52 262 | 312 816 | 11 060 | 51 114 |
| V1 | h = 0,35 (16 por vano) | 113 593 | 680 646 | 16 156 | 111 936 |
| V2, reticular con ábacos de 2,5×2,5 | h = 0,75 | 32 640 | 195 132 | 8 750 | 31 738 |
| V2 | h = 0,5 | 63 039 | 377 454 | 12 124 | 61 782 |
| V3, unidireccional con viguetas cada 0,69 m | — | 7 514 | 44 268 | 14 105 (5 712) | 3 136 (sólo muros) |

- **Ábacos.** Añaden líneas de control a la malla: entre un 19 % y un 61 % más de nudos que la maciza.
- **CDT.** El de H29 da unas 1,6 veces los nudos de una rejilla con el mismo h. Con CDT, el edificio objetivo pasa a unos 44 000 nudos y 265 000 GDL.
- **Las viguetas como barras son baratas** (D2): el modelo tiene entre 4 y 7 veces menos nudos que con losa maciza.
  - El 40 % de sus barras son de penalización, para hacer el diafragma, porque PyNite no tiene MPC.
  - Con un diafragma por transformación esas barras desaparecen y cada nudo de forjado se queda en 3 GDL (S7).

**Recomendación.**
- Dimensionar el motor para unos **50 000 nudos / 300 000 GDL** en sobremesa, que es el objetivo con CDT y un margen. El límite se fija en GDL según el dispositivo (H16).
- Mallar en rejilla alineada las zonas regulares y con CDT sólo donde haga falta, para no pagar el ×1,6 en todo el edificio.
- D2 (viguetas como barras) cabe en el MVP sin problemas de tamaño.

**Evidencia.** `investigacion/experimentos/06-escala/edificio.py` y `exp_tamanos.py` → `out_tamanos.txt`; informe, §1 y §2.

## H54 · Licencias: OpenSees y xara (UC Regents), stabileo (AGPL), CHOLMOD Supernodal y Code_Aster (GPL) y el mallador Triangle no se pueden distribuir en una app cerrada; faer, AMD, METIS, Eigen, QDLDL y SuperLU, sí

> **Soporte A** · **P0** · áreas 7 (CAN §3–§6) · afecta a §9.1, §10.1, ADR-010 — descarta candidatos

**Hallazgo.** Servir un `.wasm` al navegador del cliente es distribuirlo. Licencias leídas en el LICENSE o COPYRIGHT de cada proyecto (A):

| Proyecto | Licencia | ¿Cabe en una app cerrada comercial? |
|---|---|---|
| OpenSees | UC Regents: uso no comercial o interno; la distribución comercial requiere licencia de la Office of Technology Licensing | No, sin licencia de UC |
| xara / OpenSeesRT | `LICENSE.txt` BSD-2, pero conserva el `about/COPYRIGHT` de UC Regents para el código heredado | No (C: mismo bloqueo que OpenSees) |
| stabileo (LambdaClass) | AGPL-3.0, sin oferta comercial publicada | No |
| Code_Aster | GPL-3.0 | No |
| CHOLMOD: Supernodal, Modify, MatrixOps | GPL-2+ | No |
| CHOLMOD: Core, Cholesky, Partition | LGPL-2.1+ | Sólo como módulo sustituible; mejor evitarlo |
| Triangle (el mallador de awatif) | Distribución comercial sólo con acuerdo del autor | No |
| OOFEM | LGPL-2.1 | Con condiciones |
| Kratos | BSD con cláusula de publicidad | Sí, con el aviso |
| faer | MIT | Sí |
| AMD, COLAMD | BSD-3 | Sí |
| METIS 5 | Apache-2.0 | Sí |
| Eigen | MPL-2.0 (copyleft por fichero) | Sí |
| QDLDL | Apache-2.0 | Sí |
| SuperLU | BSD-3 (LBNL) | Sí |
| PyNite, awatif, hekatan-struct-lineal | MIT | Sí |

- **Builds en navegador.** De los candidatos con láminas, sólo awatif, hekatan y stabileo tienen hoy un build WASM usable.
  - OpenSees, xara y Kratos no tienen ninguno.
  - OOFEM tiene un job de CI para Pyodide, pero sin publicar y sin solver supernodal.

**Recomendación.**
- No usar ni copiar código de OpenSees, xara, stabileo ni Triangle.
- OpenSeesPy y Kratos siguen valiendo como **oráculos offline** (H39), porque no se distribuyen.
- El motor se construye sólo con piezas MIT, BSD, Apache o MPL.

**Evidencia.**
- `investigacion/07-candidatos.md`, §3–§6 y §10, con las fuentes, sus URL y la fecha de consulta.
- Comprobado además con `gh api` en esta sesión: hekatan es MIT, stabileo es AGPL-3.0, y el texto del `COPYRIGHT` de OpenSees es el que se cita.

## H55 · PyNite HEAD no cambia el panorama: no hay versión posterior a la 3.2.0, el MPC exige «a significant rewiring», `Tri3D` sigue sin conectar y `kx_mod/ky_mod` sólo modifican la membrana, así que no sirve para el reticular de D3

> **Soporte A** · **P0** · áreas 7 (CAN §4.1) · afecta a D3, D10, H06, H07, H46 — descarta esperar a PyNite

**Hallazgo.**
- **Versiones.** La 3.2.0 (2026-09-13) sigue siendo la última. Lo que HEAD ha añadido desde entonces:
  - cambios en el README;
  - un ajuste del *pushover*;
  - la opción de dibujo `member_csys`;
  - el rechazo de cargas de longitud cero (#340).
- **MPC (#292).** La issue sigue abierta. El mantenedor dice que exigiría «a significant rewiring» y recomienda usar barras muy rígidas (H07).
- **Triángulos.** `Pynite/Tri3D.py` existe (688 líneas), pero `FEModel3D` no lo importa (H06).
- **Modificadores.**
  - `add_quad` y `add_plate` aceptan `kx_mod`/`ky_mod`, pero sólo escalan la membrana (`Cm`).
  - La flexión (`Hb`) sigue siendo isótropa: **no hay forma de dar m11 ≠ m22 ni de reducir la torsión**, que es lo que pide D3.
- **Drilling.** Sigue siendo `min(diagonal rotacional)/1000`, sin cambios (H05).
- **Rendimiento.** El mantenedor anuncia mejoras del ensamblado (#251, #269), pero no la vectorización de `Quad3D.ke()`.
- **Bus factor.** El mantenedor tiene 1 432 commits; el segundo contribuidor, 50 (H22).

**Recomendación.**
- No esperar a que PyNite traiga MPC, ortotropía ni rendimiento.
- D10 (fork mínimo) deja de ser la pregunta: para cumplir D3 habría que reescribir el elemento.

**Evidencia.** `investigacion/07-candidatos.md`, §4.1: código de HEAD 4afc9f1 e issues #251, #267, #269, #292 y #340.

## H28 · Hacen falta dos tolerancias, no una: con 2 cm de desalineación de obra el 83 % de los encuentros viga–viga no se tocan

> **Soporte A** · **P0** · áreas 2 (COM-05) · afecta a §5.3 (tolerancia única de 1e-6 m), §7.2 — corrige

**Hallazgo.**
- **Retícula de 10×8 vanos** (178 vigas). Con coordenadas exactas, los 478 encuentros se tocan. Con ±2 cm de ruido, lo normal en un plano dibujado o en un DXF, se cruzan 80, se tocan 0 y **398 quedan a ≤ 5 cm sin tocarse**.
- **Los predicados exactos no expresan la intención.** De 999 puntos calculados como `a + t·(b−a)` sobre una viga oblicua, `orient2d` exacto dice que ninguno está sobre la recta y el producto vectorial ingenuo dice que 645 sí. La distancia real es ≤ 1,3e-15 m.
- **Coste de detectar cruces y casi-cruces:**

  | Vigas | Fuerza bruta | Hash de rejilla |
  |---|---|---|
  | 178 | 2,5–3,5 ms | 0,6–1,1 ms |
  | 2 470 (3 M de pares) | 44–63 ms | 3–12 ms |

  El resultado es el mismo con los dos métodos. No hace falta un R-tree.

**Recomendación.** Dos tolerancias registradas en `AnalysisSettings`:
- **ε_geom = 1e-6 m:** fusión numérica silenciosa (diagnóstico `info`).
- **ε_snap ≈ 0,05 m, configurable:** fusión con diagnóstico `warning`, que guarda el desplazamiento y la excentricidad resultante (por ejemplo, un pilar a 3 cm del eje de la viga).
- **Entre ε_snap y ~3·ε_snap:** diagnóstico de «casi encuentro», sin unir.
- **Orden de las operaciones:** primero el *snapping* y después predicados exactos (`robust-predicates`, Unlicense) sobre las coordenadas ya fusionadas. Basta un hash de rejilla con la caja ampliada en ε_snap.

**Evidencia.** `investigacion/experimentos/02-compilador/js/run-topologia.mjs` → `salida-topologia.json`.

## H29 · Mallador del MVP: triangulación restringida (Delaunator + Constrainautor) a tamaño 2h dividida en 3 quads por triángulo, conforme con vigas, huecos y pilares y tan precisa como una rejilla; los muros, en rejilla por paño

> **Soporte A** · **P0** · áreas 2 (COM-07, COM-08, COM-09) · afecta a §7.3, §9.1 (licencias), §23.10 — añade y corrige

**Hallazgo.**
- **Rejilla de líneas de control** (estilo `RectangleMesh` de PyNite).
  - Es perfecta en plantas alineadas: losa de 12×9 m con hueco, h = 0,5 → 443 quads.
  - Es frágil en plantas reales: con pilares desalineados ±5 cm en 20×15 m aparecen franjas de 0,5 mm (relación de aspecto 941). Fundiendo líneas a 5 cm baja a 9,5.
  - No puede embeber vigas oblicuas.
- **CDT a 2h + división de cada triángulo en 3 quads** (puntos medios y centroide). Misma losa: 702 quads y 754 nudos, ángulo mínimo 32,8° y máximo 151°, jacobiano escalado mínimo 0,485. Preserva bordes, hueco, viga embebida y pilares.
- **Precisión en PyNite.** Placa de 6×6 m simplemente apoyada (Navier):

  | Malla | Nudos | w | M |
  |---|---|---|---|
  | Triángulos → quads | 979 | +1,74 % | +1,15 % |
  | Rejilla, h = 0,25 | 625 | +1,97 % | +1,36 % |

  Las dos mallas difieren un 0,2 %. El sesgo de ~+2 % es la deformación por cortante de Mindlin frente a la referencia de Kirchhoff.
- **Bibliotecas JS.** Losa con hueco, viga y 4 pilares: 122 puntos, 120 segmentos y 385 puntos de Steiner.

  | Biblioteca | Mediana | Notas |
  |---|---|---|
  | `@kninnug/constrainautor` 4.1.0 sobre `delaunator` 5.1.0 (ISC) | 1,1–1,7 ms | Preserva 120/120 segmentos y 4/4 pilares |
  | `cdt-js` 0.1.7 (WASM de artem-ogre/CDT) | 3–4 ms | Misma malla |
  | `poly2tri` 1.5.0 | 1–4 ms | Perdió 1 de 23 subsegmentos de una viga oblicua |
  | `cdt2d` 1.0.0 | 40–95 ms | README «WORK IN PROGRESS» |
  | `earcut` 3.2.4 | — | Triángulos de 4,6°: inservible |

  Ninguna refina (no hay Ruppert/Chew): la calidad depende de la siembra. Un pilar a 3 cm del eje de una viga deja triángulos de 3,4°, que tras dividirlos dan jacobianos de 0,06. Por eso ε_snap (H28) es parte del mallado.
- **Licencias:**
  - **Triangle (Shewchuk):** prohíbe la distribución comercial sin acuerdo con el autor. `triangle-wasm@1.0.0` lo empaqueta declarando `"license": "MIT"`.
  - **`cdt-js`:** dice MIT, pero envuelve artem-ogre/CDT, que es MPL-2.0 (compatible, conservando el aviso).
  - **Gmsh y la malla 2D de CGAL:** GPL.
  - **Permisivas:** delaunator, earcut y constrainautor (ISC), cdt2d (MIT), poly2tri (BSD-3), robust-predicates (Unlicense), clipper2-js (Boost) y PyNiteFEA (MIT).

**Recomendación.**
1. **Losas:** mallador en TypeScript, dentro del Worker y antes de cargar Pyodide.
   1. Sembrar una vez cada arista compartida (borde de losa, línea muro–losa, ejes de viga, aristas verticales muro–muro, contornos de zona de carga), con el mismo paso en las mallas que se generan por separado.
   2. CDT con Delaunator + Constrainautor sobre ese grafo, con una retícula **triangular** de puntos de Steiner a 2h, separada ≥ 0,45·(2h) de las restricciones.
   3. Dividir cada triángulo en 3 quads.
   4. Validar (ver H23).
2. **Muros:** rejilla estructurada por paño, con los niveles de planta y de hueco unificados en las aristas compartidas. La membrana distorsionada bloquea (ver H17).
3. **Vía rápida opcional:** rejilla para regiones rectangulares alineadas, con las mismas costuras.
4. **Licencias** admitidas: MIT, ISC, BSD, Boost, Unlicense y MPL-2.0 con aviso. Excluir Triangle (`triangle-wasm`, `meshpy`, `triangle` de pip), Gmsh y CGAL-Mesh_2. Avisos en `public/`, como con PySlope.
5. Ruppert/Chew no hace falta en el MVP; podría venir después sobre `cdt-js`.

**Evidencia.** `investigacion/experimentos/02-compilador/js/run-mallado.mjs` + `geom.mjs` → `salida-mallado-resumen.txt`; `run-triquad-2h.mjs` → `salida-triquad-2h.json`; `run-rejilla-planta.mjs`; `gen-placa.mjs` + `py/exp_placa_mallas.py` → `salida-placa-mallas.json`.

## H30 · El generador de combinaciones de `frame-core` no expresa las combinaciones CTE/NCSE de un modelo 3D: con 11 casos hacen falta 176 combinaciones y produce 4

> **Soporte A** · **P0** · áreas 3 (RES-01, RES-13, RES-17) · afecta a §2.1 («según las reglas ya existentes»), §11.1 (`limitState`) — corrige

**Hallazgo.**
- **El tipo de caso está cerrado.** `LoadCase` es la unión `'G' | 'Q' | 'W' | 'S' | 'E'` (`src/lib/frame-core/types.ts:14`). Las combinaciones se construyen por *bucket* de hipótesis, con un caso representativo para los ψ. No se puede expresar:
  - **familias excluyentes:** Wx+, Wx−, Wy+ y Wy− nunca son simultáneas, y el generador las sumaría a la vez con ψ0;
  - **la G favorable:** γG es siempre 1,35, y la tabla 4.1 del DB SE exige también 0,80 cuando G es favorable (`lcCombinations.ts:24-25`);
  - **la ausencia de una variable** favorable (γ = 0): toda variable no principal entra con ψ0 (`:84-93`);
  - **la situación sísmica:** E se trata como una variable con 1,35·G + 1,5·E. El DB SE (4.5) pide Gk + Ad + Σψ2·Qk sin coeficientes, y la NCSE-02 §3.4, 100/30 en dos direcciones;
  - **la excentricidad accidental** de ±1/20 (NCSE-02 §3.2);
  - **casos derivados:** cargas nocionales por imperfección global, φ·N por dirección y con el signo emparejado al de la acción lateral (CE A22 §5.3.2).
- **Recuento** del prototipo con G, Q, S, Wx±, Wy±, EX±e y EY±e:

  | Situación | Combinaciones |
  |---|---|
  | ELU persistente | 74 (37 sin la G favorable) |
  | ELU sísmica | 64 |
  | ELS característica | 37 |
  | ELS casi permanente | 1 |
  | **Total** | **176** |

  `buildLcCombinations` produce 4.
- **Práctica española.** La memoria de proyecto en formato CYPE de los ejemplos del estudio usa la G favorable 0,80, el sismo con −1/+1 y el 30 % ortogonal, y un juego aparte de acciones características para el terreno.
- **Coeficientes en sismo.** La situación sísmica pide además γc = 1,3 y γs = 1,0 (CE A19, tabla A19.2.1). Los módulos tienen γc = 1,5 fijo (`data/factors.ts:2`), que es conservador pero no coincidirá con CYPE.
- El hueco de la G favorable afecta también al `fem2d` actual (ver S4).

**Recomendación.**
- **Generador propio en `results/combinations`**, con el prototipo `combos3d.mts` como semilla.
- **`LoadCase` ampliado:**
  - `kind` (G/Q/S/W/E/A) y `family` (grupo excluyente);
  - `signReversible` (sismo ±);
  - `psi0/1/2`, desde `getPsiRow`, que sí se reutiliza;
  - duración (kmod de la madera, como `comboDuration` de `fem2d`);
  - `derivedFrom`, para las cargas nocionales.
- **`situation`** en lugar de `limitState`: `'ELU-PT' | 'ELU-ACC' | 'ELU-SIS' | 'ELS-C' | 'ELS-F' | 'ELS-CP' | 'GEO'`. Cada combinación es un `Float64Array` de factores alineado con los casos.
- **Sismo en el MVP:** se comprueba con los γ persistentes (lado seguro) y se documenta. Más adelante, γ por situación en los motores.
- **Cargas nocionales:** 6 casos extra (2 direcciones × G, Q, S) que reutilizan la factorización. En el MVP entran siempre (lado seguro), con la exención por planta como en `fem2d`.

**Evidencia.** `investigacion/experimentos/03-resultados/combos3d.mts` → `salida_combos3d.txt`; DB SE tabla 4.1 y expresiones (4.3)-(4.5); NCSE-02 §3.2 y §3.4; CE A18 Ap. A.1, A19 tabla A19.2.1, A22 §5.3.2; `ejemplos anejos de calculo/P2115_A_anexo A_ESTRUCTURA.pdf`, apdo. A.3.

## H31 · La envolvente con concomitantes no contiene la combinación pésima del pilar en el 33–58 % de los casos: pilares, zapatas, encepados y punzonamiento iteran todas las combinaciones

> **Soporte A** · **P0** · áreas 3 (RES-02, RES-14, RES-15, RES-18) · afecta a §11.2, §12.2, §13 — corrige (la concomitancia sirve para mostrar, no para comprobar)

**Hallazgo.**
- **Ensayo** con el motor real `calcRCColumn` sobre 600 extremos de pilar con esfuerzos sintéticos (la magnitud depende de los datos). Por cada extremo se tomaron las 6 combinaciones extremas de N, My y Mz con sus concomitantes, y se compararon con iterar todas:

  | Conjunto | No contiene la pésima | Subestima η > 5 % | Peor cociente |
  |---|---|---|---|
  | 74 ELU persistentes | 33 % | 10 % | 0,76 |
  | 138 ELU (persistentes + sísmicas) | 58 % | 34 % | 0,68 |
  | 138 ELU, pilares con 0,3 ≤ η ≤ 1,5 | 73 % | 40 % | — |

- **Causa:** la flexión esviada la gobierna la pareja (My, Mz) simultánea, por ejemplo +EY +0,3·EX. El extremo de un solo momento lleva el otro con el signo que favorece al primero.
- **Pasa igual en todo lo que tiene interacción:** zapatas (N, Mx, My, H), punzonamiento (VEd y MEd → β), torsión–cortante y M+N en vigas.
- **Práctica de referencia.** Dos memorias españolas independientes, con texto tipo CYPE: «para los forjados se obtendrán los diagramas envolventes para cada esfuerzo; para el dimensionado de los soportes se comprueban para todas las combinaciones». ETABS hace la comprobación PMM por combinación y estación. La «Correspondence» de CSI (12 filas por estación) es exactamente el `signed-extreme-with-concomitants` del §11.2.
- **Cimentaciones.** Necesitan dos familias por combinación: geotécnica, con γ = 1 (DB SE-C §2.3.2.2, tabla 2.1: hundimiento γR = 3,0, deslizamiento 1,5, vuelco 0,9/1,8), y estructural ELU.
  - `isolatedFooting` recibe un solo juego (N, Mx, My, H), deriva el otro con un γ global, usa |M| y una H sin dirección.
  - `pileCap` usa N, Mx y My de ELU con signo.
- **Punzonamiento.** `punching.ts` sólo admite β por posición (1,15 / 1,4 / 1,5) o manual, y él mismo avisa de que el simplificado sólo vale en estructura arriostrada con luces regulares. El modelo 3D da por combinación:
  - VEd = N del pilar inferior − N del superior;
  - MEd = suma de los momentos de pilar en la unión;
  - β = 1 + k·(MEd/VEd)·(u1/W1).

  Manda el máximo de β·VEd por combinación, no β máximo por VEd máximo.

**Recomendación.**
- **Iterar todas las combinaciones.** El `DesignActionExtractor` de pilares, zapatas, encepados y punzonamiento pide el vector completo por combinación, nunca la envolvente.
- **Consultas nuevas en el §12.2:**
  - `getFrameForcesForCombos(physicalId, stations, comboIds) → Float64Array[combo][estación][6]`;
  - `getSupportReactions(supportId, comboIds)`.
- **La envolvente con concomitantes queda para:**
  - la UI: diagramas, combinación gobernante y «ver concomitantes» al estilo CSI;
  - los mecanismos sin interacción: M y V de vigas por separado, como `calcRCBeam`.
- **Cimentaciones.** Extender `isolatedFooting` y `pileCap` para aceptar una lista de combinaciones etiquetadas (GEO/ELU), con Hx, Hy y momentos con signo trasladados a la base.
- **Punzonamiento.** Extractor que calcula β por combinación con u1 y W1 de `punchingGeometria.ts` y llama a `punching` con `betaMode: 'custom'` sólo en la gobernante. El β simplificado se muestra como referencia.
- **Pendiente:** repetir el ensayo con esfuerzos reales exportados de CYPE o ETABS.

**Evidencia.** `investigacion/experimentos/03-resultados/env_bench.mts` → `salida_env_bench.txt` [B] (peor caso: pilar 33, η = 1,334 con «ELU-S +EY+e +0.3EX-e», frente a 0,905 con los extremos); `rcColumns.ts:475-512`; `isolatedFooting.ts:119-131`; `punching.ts:24-36, 143-149`; CE A19 §6.4.3; CSI Analysis Reference Manual, «Load Combinations — Correspondence».

## H32 · Sin análisis de pandeo, la estructura se clasifica por desplomes de planta, pero con rigidez nominal: con rigidez bruta (lo que hace hoy `fem2d`) el αcr del hormigón sale unas 3 veces optimista

> **Soporte A** · **P0** · áreas 3 (RES-05, RES-16) · afecta a §2.2 (P-Delta fuera del MVP), §13 — añade (el diseño no dice cómo clasificar la estructura)

**Hallazgo.** Soporte A para el código y B para la norma; la equivalencia ≈ 1/3 es una aproximación (C).
- **Lo que hace hoy `fem2d`.** Calcula αcr = (H/V)·(h/δ) por planta con una sonda lateral unitaria (CE A22 §5.2.1(4)B). En el HA usa rigidez bruta (E = 8500·∛(fck+8), I bruta) y el mismo umbral 10 que en acero (`fem2d/checks.ts:82-96, 149`; `frame-core/sections.ts:72-84`).
- **Lo que exige el CE A19 para el hormigón:**
  - el criterio H.1, con EI = 0,4·Ecd·Ic si está fisurado (0,8 si se demuestra que no) y Ecd = Ecm/1,2;
  - o, como alternativas, §5.8.3.3 (5.18) o la amplificación H.2(3)/(H.8).
- **Consecuencia.** Si toda la rigidez lateral es de hormigón, αcr,nominal ≈ αcr,bruto·0,4/1,2 = αcr,bruto/3. Para despreciar los efectos globales hace falta αcr,bruto ≳ 30 (≳ 15 sin fisurar). Una estructura de HA con 10 ≤ αcr,bruto < 30 sale hoy «intraslacional» cuando el CE pediría segundo orden.
- **La fórmula de planta en 3D:**
  - sirve por dirección (X e Y) con dos casos laterales unitarios extra, que reutilizan la factorización;
  - no capta el modo torsional;
  - la `Kg` de PyNite ignora las placas («Geometric stiffness of plates is not considered»), así que un αcr por autovalores perdería el P-Δ de la carga de los muros. La fórmula de planta usa la V total y no tiene ese problema.
- **Desplomes, que el diseño no menciona** (DB SE 4.3.3.2):
  - integridad: total ≤ H/500 y local ≤ h/250 con cualquier combinación característica;
  - apariencia: ≤ 1/250 en casi permanente;
  - en dos direcciones ortogonales.

  Sólo el modelo 3D puede hacer esta comprobación, y los mismos desplomes alimentan αcr.

**Recomendación.**
- **αcr en el MVP:** por planta y dirección con la fórmula de planta, a partir de los desplazamientos de dos casos laterales unitarios y la V total de cada combinación.
- **Para el HA,** escalar por la rigidez nominal (0,4·Ecd/Ecm) o resolver esos dos casos con E reducido. Corregir `fem2d` igual (ver S4).
- **Avisos:**
  - si el desplome de los pilares de una planta varía mucho (giro en planta, modo torsional);
  - si se incumplen las condiciones del §5.8.3.3.
- **Sin P-Delta,** emparejar los momentos amplificados con β = 1, como `fem2d`.
- **Desplomes:** consulta `getStoreyDrifts(dir, combo)` y comprobación global «Desplomes» en las familias ELS-C y ELS-CP.
- **P2:** pandeo por autovalores sólo si se añade la `Kg` de las láminas.

**Evidencia.** CE A19 §5.8.2(6), §5.8.3.3, Ap. H.1.2(3) y H.2(3); CE A22 §5.2.1(4)B; DB SE 4.3.3.2; `FEModel3D.py:1803`.

## H33 · El `PhysicalModel` del §6 duplica el edificio que Concreta ya tiene: las cotas se derivan de `lib/edificio`, las cargas por planta no tienen geometría y el patrón `decompose` de fem2d escala a 3D

> **Soporte A** · **P1** · áreas 2 (COM-17, COM-18) · afecta a §6 (`Storey.elevation`, z en `Vec3`, `Slab.elevation`), §6.1, §8, §22.1 — contradice

**Hallazgo.**
- **El edificio ya existe.** `lib/edificio` guarda las plantas de arriba abajo, con la `altura` de forjado a forjado, que puede ser `null`.
  - Las cotas se derivan con `cotasEdificio()`, con ±0,00 en la planta sobre rasante más baja, y `alturasQueFaltan()` dice cuáles faltan.
  - Sólo Cargas por planta escribe ahí.
  - Los IDs de planta son opacos y estables.
- **El §6 guarda tres veces la misma cota:** `Storey.elevation` absoluta, la z de los `Vec3` de vigas y pilares, y `Slab.elevation`. Se desincronizan al cambiar una altura.
- **Las cargas por planta no tienen geometría.** Las zonas de Cargas por planta (`ZonaUI`) no tienen polígono, y las cargas `lineales` no tienen posición.
- **`decompose2D` ya hace bien:**
  - IDs derivados (`${m.id}_e${k}`, `${m.id}_s${k}`);
  - troceado por fracción t con `T_EPS = 1e-6`;
  - liberaciones en el primer y último sub-elemento;
  - giro de las cargas a ejes locales en el compilador;
  - `designMemberId` como referencia de vuelta.
- **Le falta para 3D:**
  - detectar cruces (hoy comparte nudos por ID, con *snap* de 0,1 m);
  - rangos de estación;
  - un `LoadCase` abierto (hoy G/Q/W/S/E);
  - secciones 3D: `frame-core/sections` sólo da EA y EI en kN, y el HA no tiene J.

**Recomendación.**
- **Coordenadas en planta** más `storeyId` (y un desfase opcional); las z se calculan al compilar con `cotasEdificio()`. Si falta una altura, error `MISSING_STOREY_HEIGHT` con el nombre de la planta.
- **`Slab`** lleva `zonaId` y `tipoForjado`.
- **Cargas lineales** con polilínea propia. Las de Cargas por planta sin posición se ofrecen como plantilla, no como carga.
- **Copiar el patrón de `decompose2D`** y añadir `physicalStationRange`. Los IDs de nudo, por clave geométrica cuantizada y ordenada.
- **`seccion3D()`,** que amplíe `frame-core/sections` con A, Iy, Iz y J sin duplicar catálogos.
- **Unidades:** conversión en un único punto (ver S2).

**Evidencia.** `src/lib/edificio/index.ts:15-41, 145-167`; `src/features/cargas-planta/state.ts:129-147, 247-257, 761-826`; `src/features/fem2d/decompose.ts:46-207`; `src/lib/frame-core/sections.ts:62-104`, `types.ts:14`.

## H34 · Wood–Armer está validado contra LUSAS y debe aplicarse por combinación: aplicado a envolventes sobredimensiona hasta un 73 %, e ignorar Mxy es inseguro

> **Soporte A** · **P1** · áreas 3 (RES-08) · afecta a §13.2, §20 fase 5 — confirma (capa de diseño separada) y añade (por combinación)

**Hallazgo.**
- **Validación contra LUSAS CSN/LUSAS/1029:**

  | Caso | Implementación | LUSAS |
  |---|---|---|
  | Combinado | 181,68 / 229,17 / −227,38 / −179,89 | 181,67 / 229,16 / −227,38 / −179,89 |
  | Suma por casos (incorrecta) | 184,97 / 238,14 / −229,90 / −182,41 | 184,96 / 238,14 / −229,91 / −182,41 |

- **Optimalidad.** En 20 000 casos aleatorios, cubriendo las cuatro ramas, ninguna violación del criterio de Johansen y ningún exceso sobre el óptimo hallado por búsqueda.
- **Envolvente frente a combinación.** Wood–Armer es monótono en mx, my y |mxy|, así que sobre la envolvente componente a componente siempre queda del lado seguro, pero sobredimensiona. Losa plana de 12×12 m con 16 combinaciones de alternancia:

  | Armadura | h = 1,0 m | h = 0,5 m | h = 0,25 m |
  |---|---|---|---|
  | Inferior | +28 % | +59 % | +73 % |
  | Superior | +52 % | +33 % | +43 % |

- **Ignorar Mxy** deja a cero armadura que Wood–Armer exige: cociente mínimo de 0,19 con h = 1 m y de 0 en las mallas finas.
- **RFEM** advierte que sus esfuerzos de dimensionado «must not be combined».

**Recomendación.**
- En la capa de diseño de láminas, calcular Wood–Armer en cada punto y en cada combinación ELU con (Mx, My, Mxy) concomitantes. Guardar el máximo por cara y dirección y el índice de la combinación.
- Portar `wood_armer.py` a TypeScript con sus dos oráculos (LUSAS y fuerza bruta) como fixtures.
- Método del sándwich (CE A21, Ap. LL) y membrana (CE A19, Ap. F) para muros: P2.

**Evidencia.** `investigacion/experimentos/03-resultados/wood_armer.py`, `wa_bruteforce.py`, `exp_losa_plana.py` → `salida_wood_armer.txt`, `salida_wa_bruteforce.txt`, `salida_losa_plana.txt`; https://www.lusas.com/user_area/documentation/1029_Combinations%20and%20Wood%20Armer%20Results.pdf

## H35 · Los módulos de comprobación esperan kN y kN·m con un solo juego de esfuerzos por llamada y no leen signos, M01/M02, T ni el Mz de las vigas: hace falta un extractor por tipo de módulo

> **Soporte A** · **P1** · áreas 3 (RES-10, RES-11) · afecta a §5.1 (SI interno), §9.2, §13, §23.12 — añade y matiza §5.1

**Hallazgo.**

| Módulo | Entradas | Signo | Unidades |
|---|---|---|---|
| `rcColumns` | `Nd` ≥ 1, `MEdy` (con h), `MEdz` (con b), `L`, `beta` | `Nd` + = compresión; usa \|M\|; λlím con C = 0,7 fijo, sin M01/M02 | kN, kN·m, mm, m |
| `steelColumns` | `Ned`, `My_Ed`, `Mz_Ed`, `Ly`/`Lz`, `beta` | `Ned` + = compresión; \|M\|; Cm = 1 | kN, kN·m, mm |
| `rcBeams` | `vano_Md`, `apoyo_Md`, `VEd`, `M_G`/`M_Q` | \|M\|; la cara la decide la región | kN·m, kN, mm |
| `steelBeams` | `MEd`, `VEd`, `Lcr`, `Mser` | \|M\|; sólo eje fuerte | — |
| `timberFrameMember` | `N`, `M`, `V` | N con signo (+ = tracción); \|M\| de eje fuerte | — |
| `isolatedFooting` | Un juego (N, Mx, My, H) | \|M\|; H sin dirección | — |
| `pileCap` | `N_Ed`, `Mx_Ed`, `My_Ed` | Con signo | — |
| `punching` | `VEd`, β simplificado o manual | — | — |
| Forjados | `vano_Md`, `apoyo_Md` por metro o por nervio | — | — |

- **Nadie consume T ni el Mz de las vigas.** Ningún módulo comprueba TEd (sólo aparece en pandeo lateral). La flexión de eje débil de las vigas sólo la absorbe `steelColumns`, por interacción. El CE A19 §6.3.1(2) permite despreciar la torsión de compatibilidad con armadura mínima; la de equilibrio exige un cálculo completo.
- **Unidades.** `lib/acciones`, `frame-core` y `fem2d` trabajan en kN y m.

**Recomendación.**
- **Un `DesignActionExtractor` por tipo de módulo,** con la conversión de unidades y signos en un solo sitio y con tests.
- **Por pilar físico y combinación, exportar:**
  - N, My y Mz con signo, en cabeza y en pie;
  - Vy, Vz y T;
  - L de planta, sección y orientación (qué eje es h);
  - la clasificación traslacional de H32.

  Hoy se usa max(|M|) por extremo, que es conservador. P2: M01/M02 → rm → C = 1,7 − rm en pilares arriostrados, y Cm = 0,6 + 0,4·ψ en acero.
- **Reutilizar la lógica de `fem2d/checks.ts`** (por combinación, encaminando por mecanismo), no los adaptadores 1D.
- **Torsión:** fila «Torsión: no comprobada» con el valor de TEd cuando supere un umbral, más un diagnóstico en la viga física. Opción de reducir la GJ de las vigas de HA (ver H47).
- **Vigas de acero** con Mz o N relevantes: encaminarlas a `calcSteelColumn`.
- **Unidades** (SI frente a kN–m): decisión del usuario, ver S2.

**Evidencia.** `src/data/defaults.ts:15-129, 131-168, 286-341, 534-571, 675-731, 845-868, 1000-1030`; `rcColumns.ts:465-488`; `steelColumns.ts:209-210, 367-400`; `rcBeams.ts:615-652`; `isolatedFooting.ts:119-131`; `punching.ts:32-36, 143-149`; `pileCap.ts:628-636`; CE A19 §6.3.1.

## H36 · `ResultModel`: casos base en `Float64Array`, envolventes max/min con un índice `Uint16` de la combinación gobernante y siete consultas; cuesta 2,5 MB y 0,1–0,35 s para 2 000 barras, y el cuello de botella está en `calcRCColumn`

> **Soporte A** · **P1** · áreas 3 (RES-12, RES-07) · afecta a §11.2, §12, §12.2, §14.3 — confirma la estructura y corrige detalles

**Hallazgo.**
- **Cómo guarda hoy `fem2d`.** Por elemento, `samples.{N,V,M,w,u}[lc]: number[]` con 41 muestras. Las envolventes conservan sólo el valor de mayor |·| y pierden el signo contrario (vano y apoyo, inversión por viento); el 1D hace lo mismo.
- **Ese patrón en 3D:** 2 000 barras × 41 muestras × 5 campos × 11 casos = 36 MB, más el coste de los objetos. Con 11 estaciones y un `Float64Array` por caso son 11 MB, transferibles.
- **Restricciones de formato:**
  - Float32 (ε ≈ 6e-8) no permite verificar el equilibrio a 1e-9;
  - un `elementIds: Id[]` dentro del bloque no es transferible (el `AnalyticalModel` ya está en el hilo principal).
- **Coste de la envolvente** (2 000 barras × 11 estaciones × 6 esfuerzos, JIT caliente):

  | Casos → combinaciones | Resultados base | Tiempo |
  |---|---|---|
  | 8 → 60 | 8,1 MB | 97–151 ms |
  | 11 → 138 | 11,1 MB | 340 ms |
  | 11 → 176 | 11,1 MB | 219 ms |

- **Memoria según lo que se guarde:**

  | Qué se guarda | Memoria |
  |---|---|
  | Todas las combinaciones materializadas | 60–177 MB |
  | max/min + `Uint16Array` de la gobernante | **2,5 MB** |
  | Además, el vector concomitante completo | 14,6 MB |

  Los concomitantes bajo demanda cuestan 0,22–0,37 µs por consulta, con error 0.
- **El cuello de botella son las comprobaciones.** `calcRCColumn` tarda 129–156 µs por llamada: 300 pilares × 2 extremos × 138 combinaciones = 82 800 llamadas = **10,8–12,9 s**.

**Recomendación.**
- **Estructura:**
  - por caso, un `Float64Array`: barras por estación × 6 y láminas por punto × 8, con `stationOffsets` (`Uint32Array`) e índices densos;
  - envolventes con max y min por componente y un `Uint16Array` de la combinación gobernante;
  - estaciones: extremos, cuartos, puntos de carga y extremos internos (V = 0).
- **Consultas mínimas del MVP:**
  1. `getFrameDiagram(physicalId, comp, {case | combo | envelope})`;
  2. `getFrameForcesForCombos(physicalId, stations, comboIds)` (H31);
  3. `getConcomitant(physicalId, station, comp, 'max' | 'min')`;
  4. `getSupportReactions(supportId, comboIds)`;
  5. `getShellField(physicalId, comp, selector, 'gauss' | 'nodes-unaveraged' | 'nodes-averaged-visual')`;
  6. `getStripResultants(stripId, comboIds)` (H25);
  7. `getStoreyDrifts(dir, combo)` (H32).
- **Comprobaciones en el Worker,** con un núcleo numérico rápido de `rcColumns` (sin `CheckRow` ni cadenas) por combinación. El `calcRCColumn` completo, sólo con la gobernante, para el informe.

**Evidencia.** `investigacion/experimentos/03-resultados/env_bench.mts` → `salida_env_bench.txt` [A] y [B]; `fem2d/solver2d.ts:53-108`, `checks.ts:784-814`; `fem-analysis/solveDesignModel.ts:45-60`.

## H37 · Las tolerancias del §18.2 no se ajustan al motor: equilibrio de fuerzas a 1e-9, barras a 1e-6, láminas según la malla, y el equilibrio de momentos como diagnóstico del drilling

> **Soporte A** · **P1** · áreas 5 (VAL-04, VAL-05, VAL-08, VAL-13) · afecta a §18.2 — corrige

**Hallazgo.**
- **Precisión medida:**
  - equilibrio de fuerzas: 8e-15 a 1,5e-11;
  - barras frente a solución cerrada: ≤ 1e-11;
  - Pyodide frente a CPython: ≤ 6e-13.
- **Las tolerancias propuestas para barras son 10⁸ veces más laxas de lo necesario.** El 0,1 % y el 0,5 % del §18.2 esconderían errores de signo pequeños.
- **El equilibrio de momentos no llega a 1e-8** cuando trabaja el drilling (ver H05).
- **Los solvers 1D y 2D actuales** de Concreta sólo comprueban el equilibrio de fuerzas, y con una tolerancia de 1e-3 (`solver2d.ts:117, 277-283`; `femSolver.ts:196-203`).

**Recomendación.**

| Magnitud | Tolerancia |
|---|---|
| Equilibrio de fuerzas por caso | 1e-9 relativo a Σ\|F\| (error) |
| Equilibrio de momentos | 1e-6 relativo a Σ\|F\|·L (aviso «drilling») |
| Pruebas metamórficas | 1e-9 |
| Barras frente a solución cerrada | 1e-6 |
| Placa apoyada 16×16 | w ≤ 0,1 %; M ≤ 0,5 % |
| Placa empotrada 16×16 | w ≤ 1,5 %; M centro ≤ 2 %; M borde ≤ 0,5 % |
| Referencias congeladas del motor | 1e-9 relativo, o absoluto escalado al máximo del campo |

Cada benchmark documenta además `expectedEngineError`, el error conocido del motor con esa malla (ver H40).

**Evidencia.** `investigacion/experimentos/05-validacion/exp11_equilibrio.py`, `exp05_barras.py`, `exp01_placas.py`, `exp09_determinismo.py`.

## H38 · Las pruebas metamórficas son oráculos exactos y baratos para edificios sin solución conocida: rotación 1e-12, renumeración 6e-14, superposición 5e-16 y Maxwell–Betti 7e-15

> **Soporte A** · **P1** · áreas 5 (VAL-10, VAL-09) · afecta a §18.1 (nivel 3), §18.3 — añade

**Hallazgo.** Modelo mixto de 4 pilares de 30×50 y losa de 6×4 m de 25 cm con 24 quads:

| Prueba | Diferencia relativa |
|---|---|
| Rotación + traslación rígida del modelo (con orientación explícita, H08) | 1e-13 … 8e-13 |
| Barajar el orden de nudos y elementos | 3e-14 … 6e-14 |
| 1,35·G + 1,5·H frente a la combinación | 4,7e-16 |
| Reciprocidad de Maxwell–Betti en la losa | 6,9e-15 |
| Equilibrio de fuerzas (caso G) | 8e-15 |

- **Sólido rígido de un quad aislado:**
  - traslaciones ≤ 1e-16;
  - el giro alrededor de la normal da una fuerza espuria de 2,6e-6, por el drilling;
  - con un alabeo del 1 % del lado, los giros en el plano dan 2,3e-3, y con el 10 %, 2,2e-2;
  - K es simétrica a 1e-16.
- **Sin orientación explícita** la rotación rígida falla: un 13–75 % en desplazamientos.

**Recomendación.**
- Batería metamórfica obligatoria sobre cada modelo de regresión de edificio: rotación y traslación aleatorias con semilla fija, renumeración, superposición y reciprocidad, con tolerancia 1e-9.
- Ejecutarla también con el `MockSolverAdapter`, como prueba contractual.
- Es la forma de validar edificios que no tienen referencia exacta.

**Evidencia.** `investigacion/experimentos/05-validacion/exp06_metamorficas.py` → `out_exp06.txt`; `exp06b_solido_rigido.py` → `out_exp06b.txt`.

## H39 · OpenSeesPy (con Python 3.12) funciona como oráculo FEM independiente en minutos; con Kratos son referencias más prácticas que OOFEM para un equipo de una o dos personas

> **Soporte A** · **P1** · áreas 5 (VAL-14, VAL-20) · afecta a §10.2, §10.3 (paso 4), §18.1 nivel 4 — corrige la elección de OOFEM

**Hallazgo.**
- **OpenSeesPy 3.8.0:**
  - `pip install openseespy` se instala en Python 3.14, pero no importa: `opensees.pyd` está enlazado a `python312.dll` y a las librerías de Intel Fortran;
  - en un venv con Python 3.12 (vía `uv`) funciona y resuelve 32×32 en 0,15 s.

  | Elemento | w con 8×8 | Viga de MacNeal–Harder en el plano | Muro de 3 plantas 1×3 |
  |---|---|---|---|
  | `ShellDKGQ` | −0,058 % | 0,904 | −7,4 % |
  | `ASDShellQ4` | −0,46 % | 0,987 | −3,8 % |
  | `ShellMITC4` | — | 0,076 | — |

  `eleResponse('stresses')` de MITC4/DKGQ no devolvió los momentos con el índice usado: hay que revisar el orden de salida.
- **OOFEM 3.0** (LGPL-2.1, 29-12-2025):
  - tiene zip para Windows, pero sus bindings de Python exigen compilar, el paquete de PyPI es la 2.6.0.dev1 (sólo cp311) y no hay conda;
  - su `mitc4shell` no tiene rigidez de drilling;
  - esfuerzo estimado: medio día de instalación y 2–4 días de exportador.
- **Kratos 10.4.4** (28-09-2026): wheels para Windows de cp38 a cp314, DKQ con membrana ANDES y MITC4 con EAS. Su repositorio incluye Scordelis-Lo, el cilindro pellizcado y el hemisferio.
- **Code_Aster** aporta valores publicados citables (SSLS104, 105 y 107).
- **CalculiX** expande las láminas a sólidos y no da Mx/My: no sirve para momentos.

**Recomendación.**
- **Orden de uso:**
  1. OpenSeesPy, ya probado, y Kratos como oráculos automáticos offline en `solvers/reference/`, con Python 3.12 en un venv aislado.
  2. Code_Aster y MacNeal–Harder como referencias publicadas.
  3. OOFEM sólo si hace falta un tercer código.
- **Sin adaptadores de producción** para ninguno: §10.2 se mantiene.

**Evidencia.** `investigacion/experimentos/05-validacion/exp08_opensees.py` → `out_exp08.txt`; https://github.com/oofem/oofem/releases/tag/v3.0; https://pypi.org/project/KratosMultiphysics/; https://codeaster.gitlab.io/doc/docaster/manuals/man_v/

## H40 · La batería de validación va en tres niveles: referencias congeladas en `unit` (< 1 s, sin Pyodide), un humo de ~6 s en `golden` y la batería completa del motor en un proyecto `engine` fuera del pre-push

> **Soporte A** · **P1** · áreas 5 (VAL-16) · afecta a §18.3, §21 — añade

**Hallazgo.**
- **Cómo corren hoy las pruebas.** `bun run test:run` (pre-push, ~7 700 pruebas en ~78 s) ejecuta los proyectos `unit` (jsdom) y `golden` (node, con Pyodide). Cada fichero `*.golden.test.ts` arranca su propio Pyodide.
- **Coste de un golden de FEM 3D:** 3–4 s para cargar numpy y scipy, 0,4 s para PyNite y 2–3 veces el tiempo de CPython en el cálculo. La batería completa de convergencia en Pyodide supera holgadamente el minuto.
- **Precedente.** El FEM 2D ya usa oráculos cerrados calculados dentro de la propia prueba, con el convenio de signos fijado en la cabecera (`src/test/fem2d/solver2d.test.ts`).

**Recomendación.**
- **Estructura** (la ruta se adapta a `src/features/fem3d` + `src/lib/fem3d`, ver S1):

  ```
  validation/
    benchmarks/<id>.bench.json   # generador + parámetros, magnitudes, referencia y fuente, tolerancia, notas
    generators/*.ts              # mallas paramétricas deterministas (placa n×n, muro, Scordelis-Lo…)
    reference/*.ts               # soluciones cerradas en TS (Navier, Mindlin, pendiente-desplazamiento…)
    frozen/pynite-3.2.0_pyodide-314.0.0/<id>.n<k>.json   # salida bruta del motor + huella de entorno
  scripts/fem3d-freeze.mjs       # corre la batería en Pyodide (Node) y regenera frozen/; el diff se revisa en el PR
  ```

- **Campos de cada `bench.json`:**
  - `id`, `family` y `source` (cita exacta con URL, página o tabla);
  - `model.generator` y sus parámetros;
  - `quantities[]`, con `where`, `component` (en el convenio de Concreta), `reference`, `tolerance` y `expectedEngineError`;
  - `invariants` (equilibrio, simetría, metamórficas), `engine` (versiones y hash del vendor) y `notes`.
- **Tres niveles de ejecución:**
  1. **`unit`,** siempre y en menos de 1 s:
     - las referencias analíticas frente a la tabla publicada;
     - el adaptador sobre `frozen/`, mediante un `ReplaySolverAdapter` que pasa la salida bruta congelada por la normalización (signos, giro de tensores, ×t de la membrana). Así se prueban H01 y H08 sin Pyodide.
  2. **`golden`,** en el pre-push: un único humo `fem3d.golden.test.ts` (pórtico + placa 4×4) contra `frozen/` a 1e-9, unos 6 s.
  3. **`engine`,** proyecto nuevo con `**/*.engine.test.ts`, excluido de `test:run` (`vitest run --project unit --project golden`): la batería completa de convergencia y metamórficas. Se ejecuta en CI y a mano antes de actualizar PyNite o Pyodide.
- **Referencias externas** (OpenSeesPy, Kratos): se generan offline y se versionan como JSON; nunca corren en CI.

**Evidencia.** `vite.config.ts` (proyectos `unit` y `golden`), `.husky/pre-push`, `src/lib/calculations/geotech/pyslope.golden.test.ts`; tiempos de `investigacion/experimentos/05-validacion/out_exp09b_pyodide.txt`.

## H41 · El visor va con Three.js directo (131–170 KiB gz) en un motor imperativo fuera de React, con un único renderer y WebGL2: R3F+drei pesa 318–333 KiB y ata las subidas de React a pmndrs

> **Soporte A** · **P1** · áreas 4 (PLA-08, PLA-09, PLA-17, PLA-20) · afecta a §4.1 (`visualization/`), §15, §22.9 — añade

**Hallazgo.**
- **Peso** (minificado + gzip-9, React externo; esbuild y rolldown):

  | Import | KiB gz |
  |---|---|
  | Núcleo típico (renderer, InstancedMesh, materiales, Raycaster) | 131–135 |
  | + OrbitControls + LineSegments2 + three-mesh-bvh | 163–170 |
  | + camera-controls + troika + ViewHelper + CSS2D | 216–226 |
  | Sólo `@react-three/fiber` (incluye three entero) | 236–245 |
  | R3F + drei típico | 318–333 |
  | `WebGPURenderer` | 216–220 |

  - **Por qué pesa R3F.** Hace `extend(THREE)` sobre `import * as THREE`, y además añade su reconciliador, zustand e its-fine.
  - **Ata las versiones de React.** Fiber 9.8.1 exige `react >=19 <19.4` como peer: las subidas de React de Concreta irían al ritmo de pmndrs.
- **React Compiler 1.0** (versiones del repo):
  - compila sin aviso, y correctamente, un visor directo con refs y efectos, `useFrame` mutando `ref.current` y `setMatrixAt` en `useLayoutEffect`;
  - estado con un `Vector3` mutado o leer `ref.current` durante el render: el compilador los salta y el ESLint del repo los bloquea;
  - **compila sin aviso pero está mal:** `camera.position.set()` y `material.color.set()` durante el render.
- **Contextos WebGL.** Chrome mantiene 16 por página. Al crear 24 sin liberarlos, perdió los 8 más antiguos. `dispose()` no libera el contexto; hace falta `forceContextLoss()`.
- **WebGPURenderer** cae a WebGL2 por sí solo, pero no acepta `ShaderMaterial` ni `onBeforeCompile`: `LineMaterial` (líneas gruesas) y troika no funcionan con él. 550 k triángulos se pintan en 0,9 ms con WebGL2: el tamaño del modelo no pide WebGPU.

**Recomendación.**
- **Motor `Visor3D` imperativo** fuera de React: el componente lo monta en un `<div>` y lo alimenta por efectos. Es la misma lógica que `useCanvasView2D`, dueño único del gesto de cámara.
- **Regla de código:** los objetos de Three viven en el motor o en refs, y sólo se mutan en efectos, en el bucle propio o en manejadores, nunca durante el render. Los singletons de módulo se crean con funciones `get…()` perezosas, no en inicializadores (trampa del compilador ya conocida en el proyecto).
- **Un único renderer** de larga vida, que se vuelve a enganchar al montar el visor. Las capturas para el PDF, con ese mismo renderer a un `WebGLRenderTarget` + `readRenderTargetPixels`. Atender `webglcontextlost`/`restored`.
- **`WebGLRenderer` (WebGL2)** en el MVP. WebGPU sólo si hacen falta compute shaders.
- **Empaquetado.** three en un grupo `three-vendor` de `codeSplitting.groups`, precacheado (sacarlo reintroduce el 404 tras deploy que documenta `vite.config.ts`). Cuesta +0,65 MiB brutos sobre el precache actual (6,97 MiB).

**Evidencia.** `investigacion/experimentos/04-plataforma/bundle/medir.mjs`, `medir2.mjs` → `bundle.out.txt`, `bundle_incrementos.out.txt`; `bundle/compilador/probar.mjs` → `compilador.out.txt`; `bench/contextos.html` → `contextos.json`.

## H42 · Nunca un objeto Three por elemento (14–54 ms por frame frente a 0,5–1 ms), y la geometría, el BVH y el picking se preparan fuera del hilo principal; con BVH, `indirect: true` o se pierde el elemento seleccionado

> **Soporte A** · **P1** · áreas 4 (PLA-10, PLA-11, PLA-12) · afecta a §2.3-2, §2.3-4, §14.3, §15.1, §21 — corrige (los 50 ms no se cumplen sin sacar trabajo del hilo principal)

**Hallazgo.** Chrome 153 con GPU real (RTX 4060 Ti). La CPU se limita a ×4 para aproximar un portátil.
- **Edificio de 15 plantas** (5 115 barras y 20 280 triángulos de lámina), mediana por frame:

  | Método | ×1 | CPU ×4 |
  |---|---|---|
  | Un `Mesh` por barra (5 115 draw calls) | 14,2 ms | 54,4 ms |
  | InstancedMesh, fusionada, LineSegments(2) o lámina | 0,5 ms | 0,7–1,0 ms |
  | Mixto (3 draw calls) | 0,7 ms | — |

  Con 19 350 barras y 201 840 triángulos, el mixto sigue en 0,9 ms. Sin GPU (SwiftShader), las barras como líneas dan 9,7 ms y como cajas 28–62 ms.
- **Preparación en el hilo principal** (modelo grande, CPU ×4):
  - geometría mixta: 484 ms; `computeBoundsTree`: 314–406 ms;
  - escena de ids para GPU picking: 212 ms; primer frame: 242 ms;
  - con CPU ×1 también se pasan de 50 ms: mixto 116 ms, BVH 79–84 ms.
- **Picking** por consulta: sin BVH, 11–14 ms (54–58 con ×4); con BVH, 0,02–0,2 ms; por GPU, 0,8–1,5 ms.
- **El BVH reordena el índice.** Con `computeBoundsTree()`, el `faceIndex` sólo identifica el triángulo original en 16 de 128. Con `indirect: true`, en 128 de 128. Además, `Raycaster` ignora los planos de corte: un elemento recortado se sigue pudiendo seleccionar.

**Recomendación.**
- **Barras como `LineSegments` por defecto** (una draw call, picking con `LineSegmentsBVH`, lo más barato sin buena GPU). La sección extruida, como capa opcional instanciada o fusionada.
- **Renderizar bajo demanda,** en el `change` de los controles, no en bucle continuo.
- **El worker devuelve ya preparados** los `Float32Array` de posiciones, colores e ids de cada capa, transferidos.
- **BVH** con `GenerateMeshBVHWorker`, o GPU picking por id; `renderer.compileAsync()` al preparar cada capa.
- **De triángulo a elemento físico,** con un atributo `elementIndex` por vértice, que sobrevive a cualquier reordenación, o con `indirect: true`.
- **Filtrar los impactos** por planos de corte y por planta visible.
- **Tests:**
  - de contrato: picking en todos los centroides;
  - de rendimiento: con `PerformanceObserver` de tipo `long-animation-frame`/`longtask`.

**Evidencia.** `investigacion/experimentos/04-plataforma/bench/scene.src.js` + `cdp.mjs` → `bench/escena_*.json`, `escenas_resumen.out.txt`; `bench/prueba_indice.json`.

## H43 · Los mapas de lámina no pueden interpolar el color por vértice (73 % de píxeles fuera de la leyenda), y los colores de Concreta son `var()`/`color-mix()`, que `THREE.Color` pinta en blanco sin avisar

> **Soporte A** · **P1** · áreas 4 (PLA-13, PLA-18) · afecta a §12.1 («el suavizado no sustituye al dato»), §15.4 (paleta y suavizado) — añade y corrige

**Hallazgo.**
- **Losa** de 72 triángulos con un campo que cambia de signo y una rampa de 10 bandas:

  | Método | Colores distintos | Píxeles fuera de la leyenda |
  |---|---|---|
  | Color plano por elemento (dato bruto) | 10 | 0 % |
  | Valor nodal en `uv.x` + textura 1D con `NearestFilter` | 8 | 0 % |
  | Color de banda por vértice (lo intuitivo) | 1 863 | **73,2 %** |

  El coste por frame es el mismo: 0,5 ms. Los bytes de una textura sRGB tienen que estar en sRGB, porque `THREE.Color` guarda valores lineales desde la r152.
- **Paletas:**
  - viridis empieza en violeta (#440154), y `DESIGN.md:134` prohíbe los violetas;
  - cividis es perceptualmente uniforme y de luminancia monótona, así que sobrevive al PDF en grises;
  - los extremos de cividis dan un contraste de 1,22:1 con el lienzo Ónice (#0c0c0e) y de 1,23:1 con el claro (#fff).
- **Colores de la app en Three.** `paleta.ts` define los colores como `var(--color-…)` y `mezcla()` devuelve `color-mix(in srgb, …)`. `new THREE.Color('var(--color-accent)')` da `#ffffff` con un simple `console.warn`. El tema cambia con `html[data-theme]`. La tabla de colores de `DESIGN.md` todavía tiene los valores oscuros antiguos.

**Recomendación.**
- **Dos modos de mapa,** ninguno interpolando el color:
  - «por elemento»: el dato bruto, por defecto;
  - «suavizado»: valor nodal + rampa en textura, rotulado como representación visual.
- **Paletas:**
  - magnitudes: cividis;
  - resultados con signo: una divergente sin rojo, verde ni ámbar, que son colores de estado (p. ej. azul–crema–ocre, tipo `vik`/`broc` de Crameri);
  - dibujar aristas o el contorno de la losa;
  - en el PDF en grises, el signo va con isolíneas rotuladas.
- **`paleta3d.ts`** que resuelva los tokens con `getComputedStyle(document.documentElement)`, se recalcule al cambiar de tema (`useTheme`) y repinte la escena.
- **Los colores de estado,** sólo para estado (diagnósticos, η), nunca en mapas.

**Evidencia.** `investigacion/experimentos/04-plataforma/bench/scene.src.js` (`bandas`) → `bench/bandas.out.txt`, `bench/bandas_*.png`; `three_color_var.out.txt`, `contraste_rampas.out.txt`; `src/components/canvas/paleta.ts`, `src/index.css`.

## H44 · El modelo físico cabe en localStorage (un modelo medio ocupa el 12,7 % de los 5,24 M caracteres, contando su copia archivada), pero el analítico y los resultados van a IndexedDB como caché regenerable por huella

> **Soporte A** · **P1** · áreas 4 (PLA-16, MOT-20) · afecta a §5.3 (UUID), §17, §23.13 — añade y corrige (el `SolveArtifact` no cabe en el `.concreta`)

**Hallazgo.**
- **Cuota de localStorage** en Chrome 153: 5 242 880 caracteres (claves + valores), igual con «a» que con «ñ». Es más holgada que los «~2,5 M» que da el comentario de `seguro.ts:236-238`. Firefox y Safari no se midieron.
- **El modelo físico del §6 con UUID:**

  | Modelo | Pilares / vigas | JSON | Clave viva + archivo |
  |---|---|---|---|
  | Pequeño | 48 / 72 | 46 Ki car | 96 Ki car (1,9 %) |
  | Medio (8 forjados, 4 muros) | 320 / 560 | 311 Ki car | 650 Ki car (12,7 %) |
  | Grande | 1 200 / 2 100 | 1 148 Ki car | 2 401 Ki car (46,9 %) |

  El contenedor de proyectos guarda cada obra como `ProyectoFile` en `concreta-proyecto-<id>`, con las claves como cadenas crudas. Por eso el modelo vive dos veces (clave viva y archivo), y el escapado añade un 9 %.
- **Enlaces.** Copiar el modelo en la URL con lz-string, como hace fem2d, daría 89 Ki caracteres en el modelo medio: inviable.
- **IndexedDB.** Ya se usa (`src/lib/anejo/blobs.ts`, BD `concreta-anejo`). 45,8 MB se escriben en 107 ms y se leen en 35 ms. `navigator.storage.persisted()` devuelve `false`: es desalojable.
- **Objetos de PyNite.** No se persisten: los *pickles* se rompen entre versiones (ver H22).

**Recomendación.**
1. **`PhysicalModel`** en una clave de proyecto vía `seguro.ts`, registrada en `src/data/proyectoKeys.ts`. Hidrata de forma síncrona y viaja en el `.concreta.json`. Ids cortos y opacos por proyecto en vez de UUID, y aviso a partir de un tamaño (p. ej. 500 Ki caracteres).
2. **`AnalyticalModel` y `SolveArtifact`** en una BD IndexedDB propia (`concreta-fem3d`, con el patrón de `blobs.ts`), indexada por huella (H13) y con purga LRU por tamaño. Es caché regenerable: no viaja en el fichero y puede desaparecer. Coincide con el criterio del proyecto: «el `.concreta` lleva sólo datos; los PDF se rehacen al abrir».
3. **Compartir modelos por fichero,** no por URL.

**Evidencia.** `investigacion/experimentos/04-plataforma/bench/platform.js` → `plataforma_x1.json` (`localStorageAscii`, `idb`); `tamano_modelo_fisico.mjs` → `tamano_modelo_fisico.out.txt`; `src/lib/proyecto/index.ts:297-300`, `src/lib/anejo/blobs.ts`.

## H53 · COLAMD, la ordenación que usan PyNite y el driver de H04, es la peor para una K simétrica: `splu` con MMD_AT_PLUS_A en modo simétrico es de 3 a 6 veces más rápido y deja entre 2 y 3 veces menos relleno

> **Soporte A** · **P1** · áreas 6 (ESC §5) · afecta a H04, H51 — corrige el driver

**Hallazgo.**
- `splu(permc_spec='COLAMD')` ordena AᵀA porque está pensado para pivoteo parcial.
- `mmd_sym` es `splu(permc_spec='MMD_AT_PLUS_A', diag_pivot_thresh=0, options={'SymmetricMode': True})`. Con las K del edificio da los mismos residuos que COLAMD y es mucho más rápido:

  | K | COLAMD (CPython) | `mmd_sym` (CPython) | COLAMD (Pyodide) | `mmd_sym` (Pyodide) |
  |---|---|---|---|---|
  | V1, h = 1,0 | 4,03 s; nnz(L+U) 42 M | 1,33 s; 21 M | 7,8 s | 2,9 s |
  | V1, h = 0,75 | 5,26 s; 67 M | 1,65 s; 30 M | 10,8 s | 3,4 s |
  | V1, h = 0,5 | 14,3 s; 151 M | 3,9 s; 67 M | 28,8 s | 7,8 s |

- MMD **sin** modo simétrico es todavía peor, porque el pivoteo deshace la ordenación:
  - con V1 y h = 1,0 tardó 23 s y dejó 113 M de nnz;
  - con V3 y barras de penalización no terminó en 5 min.
- Pyodide tarda entre 1,9 y 2,3 veces lo que CPython con SuperLU.

**Recomendación.** Toda ruta que use SuperLU tiene que usar `mmd_sym`: el driver de PyNite y la vía de H51. En `pynite_fast.py` es un cambio de una línea.

**Evidencia.** `investigacion/experimentos/06-escala/exp_fact.py` → `out_fact_cpython.txt`, `out_fact_pyodide.txt`; informe, §5.

## H56 · hekatan-struct-lineal (MIT) ya tiene las formulaciones tipo CSI que necesita Concreta (DKQ, MITC4, membrana ITW con drilling, Timoshenko con offsets y diafragma por transformación), pero no sirve de base: solver simplicial, techo de 2 GB y un solo autor

> **Soporte A** · **P1** · áreas 7 (CAN §4.5–§4.8) · afecta a motor propio, oráculos — fuente de referencia

**Hallazgo.**
- **hekatan-struct-lineal** (`GiorgioBurbanelli89/hekatan-struct-lineal`, MIT; deriva de awatif): C++ con Eigen compilado a un WASM de 1,4 MB.
  - **Lo que está en el código (A):**
    - el diafragma rígido como transformación `u = T·u_red`, con un maestro virtual en el centro de masas (`utils/rigidDiaphragm.h`);
    - el solver es `SimplicialLDLT`; por encima de 150 000 GDL pasa a gradiente conjugado con Cholesky incompleto;
    - `MAXIMUM_MEMORY` de 2 GB;
    - un caso de carga por llamada.
  - **Lo que dice su README (B):**
    - DKQ, MITC4 con modos incompatibles y membrana ITW con drilling;
    - Timoshenko 3D con *rigid end offsets* y convenio CSI;
    - validado frente a ETABS 22, SAP2000 24 y SAFE 20, con diferencias del 0 al 1,9 %.
  - **Riesgos (A):** un solo autor, creado el 2026-04-01, y copias `.wasm.bak` dentro del repositorio.
- **awatif** (MIT):
  - sólo triángulos (membrana con drilling + placa DSG3);
  - `Eigen::SparseLU` con un solo lado derecho;
  - sin MPC ni offsets;
  - el cálculo no lineal lo manda a su servidor;
  - su mallador es Triangle (H54).
- **xshell** (MIT, TypeScript): MITC4 y DKT + Allman, con LDLᵀ y AMD, pero sin barras.
- **RustFEA** (Apache-2.0): sólidos con faer en WASM. Confirma que faer funciona en WASM dentro de una app de elementos finitos.

**Recomendación.**
- Usar hekatan (y xshell) como **referencia de formulaciones** y como oráculo adicional, no como base del motor.
- Citarlo en `NOTICE` si se porta código.

**Evidencia.** `investigacion/07-candidatos.md`, §4.5–§4.8.

## H45 · Las etiquetas CSS2D aguantan 500 pero no 3 000 (31 ms por frame), y troika no carga las woff2 de Concreta y, sin fuente explícita, pide glifos a jsDelivr

> **Soporte A** · **P2** · áreas 4 (PLA-19) · afecta a §15.1 (capa 2, numeración), §15.3 (valores en estaciones) — añade

**Hallazgo.**
- **CSS2DRenderer** (un `div` por etiqueta): 500 etiquetas cuestan 4,4 ms por frame (p95 7,8 ms); 3 000 cuestan 30,7 ms (p95 84,9 ms).
- **troika con una TTF local:** un `BatchedText` de 500 etiquetas sincroniza en 148 ms, con 1–2 draw calls.
- **troika con `GeistMono-Regular.woff2`,** la fuente que sirve Concreta: no sincroniza en 30 s, en dos intentos. La sospecha es que no soporta WOFF2, sin confirmar en el código.
- **troika sin `font`:** resuelve los glifos contra `cdn.jsdelivr.net` (`troika-three-text.esm.js:453`). Rompe el offline y hace una petición a terceros.

**Recomendación.**
- Rótulos de interacción (valor bajo el cursor, selección, leyenda) en el DOM o en React, con las fuentes de la app.
- Numeración masiva sólo filtrada por planta o por selección: `BatchedText` con una TTF propia (Geist o Arimo, OFL) en `public/fonts` y siempre con `font` explícita.
- Decidir si la numeración entra en el MVP (ver S2).

**Evidencia.** `investigacion/experimentos/04-plataforma/bench/etiquetas.src.js` → `bench/etiquetas_css2d.json`, `etiquetas_troika*.json`.

## H46 · Los forjados mayoritarios en España (unidireccional, alveolar, chapa) no son losas isótropas y PyNite no puede hacerlos ortótropos: van como paño de reparto, y el reticular como *shell* de espesor equivalente

> **Soporte B** · **P0** · áreas 2, 3 (COM-19, RES-18, COM-04, COM-16) · afecta a §2.1, §6 (`Slab` isótropa), §7.3, §13.2 — contradice («toda losa es un shell»)

**Hallazgo.** Soporte B: documentación de cuatro programas comerciales, que coinciden. Lo de PyNite está verificado (A).
- **CYPECAD** (memoria de cálculo):
  - viguetas como barras con nudos en las intersecciones, con la sección en T bruta;
  - placas aligeradas y losas mixtas: barras unidireccionales cada 40 cm;
  - losa maciza: emparrillado de barras ≤ 25 cm;
  - reticular: emparrillado a intereje/3, con la inercia a flexión mitad de la maciza y la torsión doble de la de flexión;
  - todo con diafragma rígido por planta, y muros con triángulos de 6 nudos.
- **Otros programas:**
  - **ETABS:** *deck* o losa «membrane» con reparto unidireccional por anchos tributarios, sin flexión.
  - **RFEM 6:** superficie «Load Transfer», sin espesor ni efecto estructural.
  - **Tekla Structural Designer:** reparto en 1 o 2 direcciones; las losas unidireccionales se vuelven ortótropas con un factor de 0,01.
- **PyNite no admite ortotropía a flexión.** `kx_mod/ky_mod` sólo entran en la membrana de `Quad3D`: con kx_mod = 1 y kx_mod = 0,1 salen la misma flecha (4,395 mm) y el mismo Mx (44,03 kN·m/m). En `Plate3D` falsean los momentos (ver H06).
- **Concreta ya distingue** `TipoForjado` = `losa | solera | reticular | unidireccional | chapa | madera | otro`. El módulo Forjados comprueba reticular (nervio en T por intereje, 25+5 a 35+10) y maciza, con Md y VEd tecleados.
- **La rigidez del reticular no tiene un valor único.** La T bruta da I = 0,29–0,31 de la maciza (espesor equivalente: 30+5 → 233 mm); CYPECAD usa 0,5.
- **El reparto isostático no basta.** Infravalora la viga central de dos vanos un 25 % (1,0·qL frente a 1,25·qL), así que hacen falta franjas continuas.

**Recomendación.** En el MVP, según `tipoForjado`:
- **Maciza:** *shell* `Quad3D` con su espesor real.
- **Reticular:** *shell* con espesor equivalente de rigidez (T bruta o ½ maciza, configurable y decidido en un ADR) y los ábacos como regiones de espesor real. El peso propio sale de la zona (ver H24), y Mx·intereje alimenta `calcForjados` por nervio.
- **Unidireccional, alveolar, chapa y madera:** «paño de reparto» sin rigidez, con la dirección de las viguetas como dato. Las cargas bajan a vigas y muros mediante franjas continuas resueltas con el `solveAnalysisModel` del FEM 1D. El diafragma, según H07.
- **Más adelante:** viguetas como barras, como hace CYPECAD.
- **Validación contra CYPE:** comparar integrales de banda, reacciones y momentos de viga, no momentos puntuales de lámina contra momentos de barra del emparrillado.

**Evidencia.**
- CYPE, *CYPECAD – Memoria de cálculo* (https://downloads2.cype.com/documentos_es/manuales/ccadmc01.pdf), pp. 11-14 y 124.
- Tekla SD 2026, «Overview of the slab model»; Dlubal, manual de RFEM 6, 000040.
- `src/lib/acciones/cargas.ts:42`, `src/data/forjadoTipologias.ts:18-24`.
- `investigacion/experimentos/02-compilador/py/exp_pynite2.py`, `espesor_equivalente.py`.

## H47 · El modelo analítico necesita modificadores de rigidez trazables (axil de pilares ×2, torsión del HA reducida), o la comparación con CYPE fallará por hipótesis y no por el solver

> **Soporte B** · **P1** · áreas 2, 3 (COM-20, RES-11) · afecta a §8 (`AnalyticalSection`), §18.1 nivel 4 — añade

**Hallazgo.**
- **Axil.** CYPECAD considera *«el acortamiento por esfuerzo axil en pilares, muros y pantallas… afectado por un coeficiente de rigidez axil variable entre 1 y 99,99… El valor aconsejable es entre 2 y 3, siendo 2 el valor por defecto»*, para simular el proceso constructivo.
- **Torsión.** Aplica además un coeficiente reductor de la rigidez a torsión en los elementos de hormigón, y en el plano de planta toma EA = ∞ por el diafragma.
- **Sin modificadores,** un cálculo lineal 3D da momentos de viga por el acortamiento diferencial entre muros y pilares, y torsiones en las vigas de borde que CYPE no da.
- **La torsión no tiene consumidor** en los módulos de Concreta (ver H35). El CE A19 §6.3.1(2) permite despreciar la torsión de compatibilidad.

**Recomendación.**
- `AnalyticalSection.modifiers = { axial, torsion, bendingY, bendingZ }`, con valores por defecto declarados que se registran en la huella y en la memoria.
- Los valores por defecto son una decisión del usuario (ver S2).
- Los fixtures de comparación con CYPE usan los mismos valores.

**Evidencia.** CYPE ccadmc01, p. 20 (§1.4.2–1.4.4).

## H48 · Catálogo de benchmarks verificado en fuente primaria (tres valores que suelen citarse mal) y cinco ejemplos públicos de CSI para la regresión de edificios; CYPE no publica verificaciones

> **Soporte B** · **P1** · áreas 3, 5 (VAL-18, VAL-19, VAL-17, RES-18) · afecta a §10.2, §18.1 (niveles 2–5), §18.3, §24 — añade y corrige

**Hallazgo.** Soporte B: fuentes primarias. Los resultados de `Quad3D` en láminas son A.
- **Catálogo mínimo.** «MH» es MacNeal & Harder, FEAD 1 (1985) 3-20; «T&WK» es Timoshenko & Woinowsky-Krieger.

  | Grupo | Benchmark | Referencia | Fuente |
  |---|---|---|---|
  | Barra | SAP2000 1-004: W12X106 con ejes girados 30° | (Uy, Uz) = (−0,03345; −0,05610) in | CSI 1-004 |
  | Barra | SAP2000 1-018: pórtico de 1 vano | Uz = −2,77076 in (−2,72361 sólo flexión) | CSI 1-018 |
  | Barra | SAP 1-022 / ETABS 7: pórtico 2D de 7 plantas | Ux de cubierta 1,45076 in; N = 69,99 k | CSI |
  | Celosía | Megson 11.1 / COMSOL «space truss» | u_d = −5,15e-4 m; N = 25,0 / −10,4 / 14,6 kN | COMSOL 6.4 |
  | Placa | Cuadrada apoyada, ν = 0,3 | α = 0,00406235; β = 0,0478864; Q = 0,337657 | T&WK, tabla 8; Batista 2010 |
  | Placa | Cuadrada empotrada, ν = 0,3 | α = 1,265319e-3; M_c = **0,0229051**; M_borde = −0,0513338 | Taylor & Govindjee 2002 |
  | Placa | Morley, rombo de 30° | w_c = **0,408e-3**·qL⁴/D | Abaqus Benchmarks 2.3.4 (secundaria) |
  | Placa | NAFEMS LE6 | σ1 = 0,802 MPa | Robot, manual NAFEMS |
  | Membrana | Patch de MH | σx = σy = 1 333; τxy = 400 | MH, tabla 2a |
  | Flexión | Patch de MH | mx = my = 1,111e-7; mxy = **3,333e-8** | MH, tabla 2b (corregida) |
  | Viga | Viga recta de MH (6×1) | Cortante en el plano 0,1081; fuera del plano 0,4321 | MH, tabla 3 |
  | Lámina | Scordelis-Lo | **0,3024** (Mindlin convergida) | MH, tabla 5a |
  | Lámina | Cilindro pellizcado con diafragmas | 1,8248e-5 | Code_Aster SSLS104 |
  | Lámina | Hemisferio pellizcado | 0,0940 | MH, tabla 5b |
  | Muro | ETABS 15a/15c/15d: voladizo, acoplado y núcleo en C | L = 120 in → 2,4287 in; núcleo 0,8936 in | ETABS, ej. 15 (código contra código) |

- **Tres valores mal citados con frecuencia:**
  - **0,3086** en Scordelis-Lo es la solución analítica de lámina profunda; con `Quad3D`, que es Mindlin, la referencia es **0,3024**;
  - **0,0231** de T&WK para M_c de la placa empotrada tiene un error en la tercera cifra: es **0,0229051**;
  - **mxy = 1e-7** del patch de MH es una errata: es **3,333e-8**.
- **`Quad3D` en láminas** (P2 para el MVP, pero detecta regresiones):
  - Scordelis-Lo, con 32×32: 0,995 de la referencia; Richardson da 0,30226 (−0,05 %);
  - cilindro pellizcado: 1,018, no monótono, banda de ±2 %;
  - Morley: 4,145 frente a 4,08 de Kirchhoff (+1,6 %), con convergencia lenta por la esquina obtusa.
- **Manuales públicos:**
  - **CSI:** SAP2000 (frames y shells), ETABS (`Software Verification.pdf`, 859 páginas) y SAFE (ejemplos 1-7 contra T&WK);
  - **Dlubal:** casos VE (000070-73, 000091, 009016);
  - **Robot:** NAFEMS y AFNOR VPCS;
  - **SOFiSTiK:** BE1, BE41-43;
  - **Code_Aster:** SSLS104-107;
  - **SCIA:** no tiene un conjunto público;
  - **CYPE:** no se encontró ninguno, buscando en español y en inglés;
  - **NAFEMS:** P18 cuesta 45 £.
- **Ningún benchmark público** da una solución analítica de «muro con hueco»: lo más cercano es ETABS 15c, código contra código.

**Recomendación.**
- **Regresión de edificios** empezando por cinco ejemplos públicos:
  1. SAP 1-022 / ETABS 7;
  2. SAP 1-024 (pórtico 3D con diafragma, para cuando haya modal);
  3. ETABS 15a/15c/15d;
  4. SAFE 1-7 o SAP 2-005 con los valores de Taylor–Govindjee;
  5. SAP 1-004.
- **CYPE:** el estudio fabrica modelos espejo y documenta las diferencias de formulación (CYPE incluye deformación por cortante, zonas rígidas y modificadores; ver H47). Se comparan integrales de banda, reacciones y momentos de viga, no momentos puntuales (CYPE usa emparrillados).
- **Cada `bench.json`** cita la fuente primaria con página o tabla.

**Evidencia.**
- `investigacion/experimentos/05-validacion/exp03_laminas.py`, `exp04_esviada.py`, `exp04b_morley_fino.py`.
- https://x2go-cdm.ing.unimo.it/_shared/Irons_patch_test/macneal1985proposed.pdf
- https://escholarship.org/uc/item/4bj7133z
- https://docs.csiamerica.com/manuals/etabs/Software%20Verification.pdf
- https://www.dlubal.com/en/downloads-and-information/examples-and-tutorials/verification-examples

## H57 · Las apps web comerciales de cálculo (SkyCiv, Dlubal, ClearCalcs) resuelven en servidor; el cálculo en el cliente sólo aparece en proyectos abiertos recientes

> **Soporte B** · **P2** · áreas 7 (CAN §7) · afecta a §1, §14 — contexto de producto

**Hallazgo.**
- **SkyCiv:** se anuncia como «100 % cloud-based» y cobra un crédito de API por cada cálculo FEM.
- **Dlubal:** RFEM manda el modelo a sus servidores en la nube (*Cloud Calculations*, *WebServices*).
- **ClearCalcs:** resuelve su FEA 2D «in the cloud».
- **En el cliente, con WASM,** sólo calculan stabileo, hekatan y awatif. awatif, además, manda el cálculo no lineal a su servidor.

**Recomendación.** Calcular en el navegador diferencia a Concreta: funciona sin conexión y el modelo no sale del equipo. Pero ningún producto comercial demuestra que la escala objetivo quepa en el cliente. Por eso el spike del motor tiene criterios de paso medibles (S7).

**Evidencia.** `investigacion/07-candidatos.md`, §7.

## S1 · Plan revisado por fases, adaptado al repositorio real

Sustituye a los §20 y §22 del diseño técnico. Las duraciones son las del diseño, salvo donde la investigación las mueve.

> **Revisión tras D9 y D11 (2026-10-03).** Este plan se escribió con PyNite como motor. Con D11 = (c), el motor propio de S7, cambian dos cosas:
> - la Fase 0 y todo lo que es específico de PyNite (vendor, driver, scipy, barras de penalización) se sustituye por el spike E0 y las fases E1–E6 de S7;
> - `solvers/pynite/` pasa a `solvers/propio/` + `kernel/`.
>
> **Cambia también dónde se trabaja.** Por decisión del usuario, el desarrollo es personal y se hace en su repositorio personal `jramirezbandera/concreta-FEM`, en `main`. No se mezcla con el repositorio de producción ni con sus PR.
> - El motor se construye como paquete independiente, sin React ni dependencias de la app.
> - Cuando el módulo esté maduro, se integra en Concreta con un PR revisado por wh0am1.
> - Lo que se dice abajo sobre ramas y PR de Concreta vale para esa integración final.
>
> El resto del plan se mantiene: rutas destino, Fase 1 independiente del motor, resultados, visor y validación.

**Dónde vive el código.** No existe `src/modules/`: el diseño (§4.1) se adapta a la convención del repo.

| Pieza | Ruta | Contenido |
|---|---|---|
| Motor y dominio, sin React | `src/lib/fem3d/` | `domain/`, `analytical/`, `compiler/`, `solvers/{contract,pynite,mock,replay}/`, `results/`, `validation/`, y los workers junto a su cliente (patrón de `lib/calculations/geotech/`) |
| Interfaz | `src/features/fem3d/` | Visor, editor por plantas y paneles |
| Registro | `src/data/moduleRegistry.ts`, `routeLoaders.ts`, `proyectoKeys.ts` | Con `shipped: false` hasta validar, como micropilotes |
| Vendor | `scripts/vendor-pynite.mjs` + `src/lib/fem3d/solvers/pynite/vendor/` | Patrón de `scripts/vendor-pyslope.mjs` |

**Fase 0 — Cerrar el spike** (1–2 semanas; la mitad ya la hizo esta investigación)
1. Decisiones del usuario (S2).
2. Vendor: `vendor-pynite.mjs` (wheel 3.2.0 por sha256, 18 `.py` + `dist-info`, stubs, `NOTICE`) y scipy en `fetch-pyodide-assets.mjs` (H03, H26).
3. Pasar `investigacion/experimentos/01-motor/pynite_fast.py` a driver del adaptador (corrutina con puntos de cesión), junto con el operador de resultados y los tests contractuales sobre los internos de PyNite (H04, H15, H20).
4. Medir en dispositivos reales (portátil con gráfica integrada, Android medio, iPhone; Safari y Firefox) con `investigacion/experimentos/04-plataforma/bench/` publicados en una rama de preview (H16).
5. Benchmarks que pueden cambiar el plan:
   - núcleo de muros ETABS 15d frente a OpenSees `ASDShellQ4` (drilling);
   - cortante de lámina recuperado por equilibrio;
   - barrido de α para la zona rígida y el diafragma en Pyodide;
   - cancelación cooperativa en un Worker de navegador.

   Ver S5.
6. Diseño técnico v0.2 con la tabla de S3 y los ADR nuevos (rol `auxiliar`, convenio de signos, dos tolerancias, tipologías de forjado).

*Salida:* decisión de seguir o no, vendor y driver en la rama, y diseño v0.2.

**Fase 1 — Núcleo agnóstico** (2–4 semanas)
- Tipos:
  - `PhysicalModel` sobre `lib/edificio`: coordenadas en planta + `storeyId`, `tipoForjado`, `zonaId` (H33);
  - `AnalyticalModel` con el rol `auxiliar` y los `modifiers` (H07, H47);
  - `ResultModel` en arrays tipados, con el convenio de H02 (H36).
- `SolverAdapter` + `MockSolverAdapter` + `ReplaySolverAdapter`, con tests contractuales y metamórficos (H38).
- Dos workers:
  - compilación y mallado en TypeScript, que admite `cancel` por mensaje;
  - motor Pyodide, que se cancela con `terminate()`.

  Protocolo versionado y resultados transferidos (H27).
- Huella SHA-256 cuantizada (H13).
- Fixtures en tres niveles y proyecto `engine` de vitest (H40).
- Visor mínimo con Three.js directo: barras como `LineSegments` y deformada simulada (H41).

*Salida:* la primera vertical del §22 (pórtico 3D, Mock, worker, visor), con tests de unidades, ejes, trazabilidad, cancelación y respuestas obsoletas.

**Fase 2 — Barras 3D** (3–5 semanas)
- Compilador de barras (H28, H19, H11):
  - dos tolerancias y hash de rejilla;
  - troceado sólo topológico;
  - `seccion3D()`;
  - orientación explícita;
  - validación de liberaciones.
- Adaptador PyNite real para barras: permutación de ejes, `rotation`, signos, driver y esfuerzos de extremo → diagramas en TypeScript (H08).
- Generador de combinaciones 3D (H30).
- Envolventes y consultas del `ResultModel` (H36).
- Extractores: pilares por combinación, con un núcleo rápido de `rcColumns`; vigas por envolvente; zapatas GEO/ELU (H31, H35).
- αcr por desplomes con rigidez nominal y comprobación de desplomes (H32).
- Regresión: CSI 1-004, 1-018 y 1-022, y referencias de OpenSeesPy (H48, H39).

**Fase 3 — Láminas y modelo mixto** (5–8 semanas; crece porque entran las zonas rígidas)
- Mallado y validación (H29, H23, H17):
  - CDT dividida en quads para losas;
  - rejilla por paño para muros (≥ 8 elementos);
  - validador de malla.
- Tipologías de forjado (H46):
  - maciza y reticular como *shell*;
  - unidireccional como paño de reparto, con franjas resueltas por el FEM 1D;
  - diafragma por penalización (H07).
- Uniones: barras embebidas y zona rígida pilar–losa (H05, H09).
- Cargas en láminas como fuerzas nodales consistentes y peso propio desde `pp` (H24).
- Resultados de lámina (H01, H18):
  - en ejes locales, girados en TypeScript;
  - N = t·S;
  - Qx/Qy sólo para visualizar.
- Dimensionado (H25, H34, H31):
  - bandas con Wood–Armer por combinación;
  - β de punzonamiento por combinación.
- Mapas de color cividis y divergente con rampa en textura (H43).
- Regresión: placas de Timoshenko/Taylor–Govindjee, patch tests de MacNeal–Harder, ETABS 15 y SAFE (H48).

**Fase 4 — Flujo de edificio y UX** (3–5 semanas)
- Edición por plantas y diagnósticos gráficos sobre el objeto físico (H12).
- Persistencia: el modelo físico en localStorage y la caché en IndexedDB (H44).
- Offline del motor (H26) y política de vida del worker (H16).
- Picking con BVH (`indirect`), capas preparadas en el worker (H42) y etiquetas (H45).

**Fase 5 — Integración de diseño y endurecimiento** (4–8 semanas)
- Regresión completa con los ejemplos de CSI y modelos espejo de CYPE con los mismos modificadores (H48, H47).
- Situación sísmica con sus γ.
- Medidas en los dispositivos objetivo y auditoría numérica antes de la beta.

**Ramas y PR.** `feat/fem3d` lleva esta investigación. Cada fase sale de ella como `feat/fem3d-<fase>`, con su PR y su revisión. No se mergea nada sin que el usuario lo pruebe. Los fallos de S4 van en ramas `fix/…` desde `main`, aparte.

**Fuera del MVP** (confirmado o nuevo): P-Delta (sólo existe para barras), modal (existe `eigsh`, pero falta la concomitancia espectral), WebGPU, triángulos, `Plate3D`, viguetas como barras, método del sándwich en muros y COOP/COEP.

## S2 · Decisiones del usuario: las tomadas el 2026-10-03 (D11: motor propio) y las pendientes

Ninguna se cierra sólo con la investigación: son decisiones de criterio profesional o de producto. Cada una lleva una recomendación razonada.

**Tomadas por el usuario (2026-10-03):** D1, D2, D3 y D9, y después D11. **El 2026-10-04:** D5 y D4.

| # | Decisión | Respuesta del usuario | Consecuencia | Base |
|---|---|---|---|---|
| D1 | Unidades internas del modelo y de los resultados | **kN–m, como el resto de Concreta.** Los resultados tienen que entrar en cada módulo de comprobación, así que manda la compatibilidad | Coincide con la recomendación. Las secciones y acciones se reutilizan sin convertir; la única frontera es la de las unidades de la UI | H35, H33 |
| D2 | Forjado unidireccional | **Se introduce como paño con reparto de cargas, pero se discretiza en viguetas como barras y se ven los esfuerzos por vigueta** | Sustituye la recomendación (a), la del paño de reparto. Es barato: 7 500 nudos en el edificio objetivo. Exige un diafragma rígido real (MPC), que PyNite no tiene | H46, H52, S7 |
| D3 | Rigidez del reticular | **Se distingue la zona aligerada de los ábacos, que van con la inercia completa. A la zona aligerada se le aplican multiplicadores por dirección sobre la sección maciza** (inercia, peso, etc., calculados a partir de nervios y casetones), como hace el usuario en SAP2000. Lo que importa es que sea lógico y fiable | Sustituye el «½ maciza» de CYPE. Hace falta flexión ortótropa (m11 ≠ m22, m12 reducido), que PyNite no tiene (H55). Los multiplicadores se documentan en un ADR y en la memoria, y se validan contra un modelo SAP2000 del usuario | H46, H24, S7 |
| D9 | Tamaño máximo del modelo | **Del orden de 7 plantas con 80 pilares por planta.** El límite real lo marca el rendimiento | Son ~27 500–44 000 nudos y 165 000–265 000 GDL. Deja fuera a PyNite y obliga a un solver supernodal. El límite se fija en GDL según el dispositivo | H52, H49, H50 |
| **D11** | **Motor de cálculo** | **Motor propio, la vía (c),** después de ver los riesgos y la validación propuesta. Se trabaja en el repo personal `jramirezbandera/concreta-FEM`, desde cero: la app anterior con PyNite se descarta | Spike E0 con criterios de paso como puerta. La vía (b) queda como plan B medido. PyNite pasa a ser oráculo. La validación va primero: equilibrio en cada cálculo, oráculos, módulo oculto hasta pasar la batería y un periodo «en sombra» frente a SAP2000 o CYPE | S7, H49, H50 |
| D5 | Quién define las bandas de dimensionado de las losas | **(c) Automáticas y editables** (2026-10-04): el compilador propone las bandas del Ap. I del CE A19 a partir de los ejes de los pilares, y el usuario puede moverlas, cambiar su anchura, partirlas o añadir otras | Coincide con la recomendación. El compilador siembra en la malla los bordes de las bandas y las caras de los apoyos (E5-5), así que editar una banda cambia la malla y obliga a recalcular. Las bandas editadas se guardan en el modelo físico y se marcan como tales en la memoria | H25, E5-5 |
| D4 | Modificadores de rigidez por defecto | **(b), por material** (2026-10-04, con las medidas de `validacion/c1/out_decisiones.txt`): axil de todos los pilares ×2 y torsión de las vigas de hormigón ×0,1. La flexión no se toca: la rigidez nominal de H32 va en la comprobación de estabilidad | Coincide con la recomendación. Sin la torsión reducida, el vano de una secundaria que acomete a una viga de borde sale un 27 % corto; sin el axil ×2, la cara de una viga interior pierde un 6 %. Se aplican por defecto (`MODIFICADORES_D4`), se cambian con una opción y quedan en las hipótesis de la compilación | H47, C1 |

**Pendientes:**

| # | Decisión | Opciones | Recomendación | Base |
|---|---|---|---|---|
| D6–D8, D10 | scipy, offline con Pyodide, versión de Pyodide y fork de PyNite | — | **Obsoletas con D11 = (c).** Sólo volverían si el spike falla y se pasa al plan B, la vía (b) | H26, H03, H55 |

Decisiones menores, con un valor por defecto que se puede cambiar después:
- **Sismo en el MVP** con los γ persistentes, del lado seguro (H30).
- **Numeración masiva** de elementos fuera del MVP (H45).
- **Paleta:** cividis para magnitudes y una divergente sin colores de estado para los resultados con signo (H43).

## S3 · Contradicciones con el diseño técnico, apartado por apartado

Lista para editar `diseno-tecnico.md` (v0.1 → v0.2). Sólo recoge lo que cambia; lo que la investigación confirma está en cada hallazgo.

| § del diseño | Dice | La investigación encontró | Cambio propuesto | Hallazgo |
|---|---|---|---|---|
| §1, §9.1, §10 | `PyNiteFEM` | El paquete es `PyNiteFEA` 3.2.0 | Corregir el nombre; fijar por sha256 | H03 |
| §5.1 | Densidad en kg/m³; SI en todo | `rho` de PyNite es un peso específico (N/m³); todos los módulos y `frame-core` trabajan en kN y m | Peso propio como carga explícita; elegir el sistema de unidades | H11, H24, S2 |
| §5.2, §8 | Vector de referencia explícito `localYAxis`; Z arriba | PyNite es Y-arriba, sólo admite un ángulo y su orientación por defecto salta con 1e-12 de ruido | Permutar ejes y calcular `rotation` por barra; el vector de referencia indica el canto h (z local) | H08, H02 |
| §5.3 | Una tolerancia de 1e-6 m | El 83 % de los encuentros con 2 cm de ruido no se tocan | Dos tolerancias: ε_geom = 1e-6 y ε_snap ≈ 5 cm | H28 |
| §6 | `Storey.elevation`, z en `Vec3` y `Slab.elevation` | `lib/edificio` ya guarda alturas relativas y deriva las cotas | Coordenadas en planta + `storeyId`; las z se derivan | H33 |
| §6, §7.3, §13.2 | Toda losa es un *shell* isótropo | El unidireccional, la alveolar y la chapa no lo son; PyNite no hace ortotropía | Según `tipoForjado`: *shell*, *shell* equivalente o paño de reparto | H46 |
| §7.2 | Las cargas puntuales fuerzan subdivisiones | PyNite integra las cargas de barra de forma exacta | Trocear sólo por topología | H11 |
| §7.2, §23.11 | Nudos conformes o «constraint explícita» | No hay constraints; la unión en el plano queda articulada y la puntual no converge | Barra embebida auxiliar + zona rígida en el MVP; rol `auxiliar` en el mapping | H05, H09, H07 |
| §7.1 paso 8, §8 | `constraints`, diafragmas | Ni MPC ni diafragma | Diafragma por la losa *shell* o por penalización | H07 |
| §7.3 | El MVP puede usar triángulos | No hay triángulo operativo y `Plate3D` es erróneo | Mallador sólo de quads; muros con ≥ 8 elementos por paño | H06, H29, H17 |
| §9, §11.1 | El adaptador aprovecha la factorización para varios casos | `analyze_linear` refactoriza y escala O(N²) | Driver propio sobre internos de PyNite, con tests contractuales | H04 |
| §9.1 | «Script del adaptador pequeño» | Es pequeño, pero depende de internos de la versión | Fijar la versión y pasar la batería contractual en cada subida | H22 |
| §11.1 | `limitState` ULS/SLS; «reglas existentes en Concreta» | `frame-core` no expresa familias, G favorable, sismo, excentricidad ni casos derivados | Generador 3D propio con `situation` y `family` | H30 |
| §11.2, §12.2, §13 | La envolvente con concomitantes alimenta las comprobaciones | Deja fuera la pésima del pilar en el 33–58 % de los casos | Iterar todas las combinaciones en pilares, zapatas y punzonamiento; consulta por combinación | H31 |
| §2.2, §13 | P-Delta y pandeo fuera del MVP, sin más | Hay que clasificar la estructura; el αcr con rigidez bruta es optimista ×3 en HA | αcr por desplomes con rigidez nominal; comprobación de desplomes | H32 |
| §12, §23.3 | `ShellResultBlock` con Nx…Qy en ejes del usuario | Ejes por elemento, membrana en Pa y salida global rota | `local=True`, N = t·S y giro en TypeScript | H01 |
| §2.1, §13.2 | Qx/Qy son resultado primario | Salen un 30–50 % bajos con mallas de obra | Sólo visualización; el cortante sale de reacciones o de Q recuperado | H18 |
| §13.2 | Suavizado del pico con ΔM = F·t/8 | No aplica a pilares de losa plana; el pico diverge | Dimensionar por bandas | H25 |
| §14.3 | Modelo medio en menos de 10 s | En Pyodide sólo hasta ~1 500 nudos, sin contar ~4 s de arranque | Límite por GDL; presupuesto revisado | H04, H16 |
| §18.2 | Equilibrio ≤ 1e-8; barras al 0,1–0,5 % | Momentos 3,5e-5–0,49 con drilling; barras exactas a 1e-11 | Fuerzas 1e-9, ΣM como aviso, barras 1e-6 | H37 |
| §10.2 | OOFEM como referencia independiente; CYPE/SAP2000 | OpenSeesPy y Kratos se instalan con pip; CYPE no publica verificaciones | OpenSeesPy + Kratos; CSI como regresión pública; CYPE con modelos espejo | H39, H48 |
| §17, ADR-009 | Huella reproducible | V8 y JSC difieren en `Math.*`; Pyodide y CPython en 6e-13 | Huella sobre datos cuantizados y versiones; referencias con tolerancia | H13 |
| §20 | Zonas rígidas y offsets en «evolución posterior» | Sin ellas las uniones pilar–losa y viga–muro no convergen | Adelantarlas al MVP (fase de láminas) | H09 |
| §21 | Todo elemento analítico tiene trazabilidad física | Hacen falta barras auxiliares (embebidas, diafragma, zona rígida) | Rol `auxiliar` en `PhysicalRef`, sin comprobación ni diagrama | H07 |
| §4.1 | `src/modules/fem3d/...` | En el repo no existe `src/modules/`: UI en `src/features/<módulo>`, motores en `src/lib/…` con el worker junto a su cliente, registro en `moduleRegistry.ts` y `routeLoaders.ts` | Adaptar las rutas (ver S1) | S1 |
| §9 (`SolverContext.signal`), §14.1 | Cancelar con un mensaje `cancel` y un `AbortSignal` | Un worker ocupado en Pyodide no lee mensajes; el interrupt por SAB no corta SuperLU; COOP/COEP es inviable en Pages | Cancelar = `terminate()` + re-arranque (~5 s); cesiones cooperativas en el driver | H20 |
| §14.3 | «WASM una vez por sesión»; ≤ 50 ms en el hilo principal | El heap nunca baja (hasta 4 GiB); geometría, BVH, huella y `JSON.parse` dan 116–709 ms en el hilo principal | Política de reciclado del worker; preparar y transferir todo desde el worker | H16, H42, H27 |
| §9.1, §2.3-1 | Offline «empaquetando los recursos» | 29,3 MiB con scipy; el precache tiene un tope de 4 MiB por fichero; el primer uso directo no se cachea | Caché en runtime + `clientsClaim` o botón «preparar sin conexión»; scipy adelgazado | H26 |
| §12 | `elementIds: Id[]` en bloques que cruzan el worker | Las cadenas no se transfieren; el JSON bloquea 0,4–1,8 s | Índices densos y tabla de ids enviada una vez | H27 |
| §15.4 | Paleta perceptualmente uniforme; suavizado nodal | Viridis choca con `DESIGN.md` (sin violetas); interpolar el color pinta un 73 % fuera de la leyenda | cividis / divergente sin colores de estado; rampa en textura | H43 |
| §1, §9.1, §10, ADR-010 | PyNite como motor único | Con el tope de D9 no llega (105–110 s, 3,2 GB), no hace flexión ortótropa (D3) ni MPC (D2), y SuperLU no cabe en wasm32 | Motor propio: TypeScript con solver supernodal en WASM (faer), si el spike pasa; ADR nuevo | H49, H55, H50, S7 |
| §17 | Guardar por separado `AnalyticalModel` y `SolveArtifact` | El contenedor de proyectos sólo transporta cadenas de localStorage | Físico en localStorage; analítico y resultados en IndexedDB como caché por huella | H44 |

## S4 · Fallos encontrados de paso en código que ya está en producción (fuera del FEM 3D)

La investigación tocó código existente y encontró estos problemas. No son del FEM 3D: cada uno merece su propia rama y su propio PR, con la revisión del usuario.

| # | Dónde | Qué pasa | Gravedad | Origen |
|---|---|---|---|---|
| 1 | `src/lib/frame-core/lcCombinations.ts:24-25, 84-93`; `src/features/fem2d/checks.ts` | γG = 1,35 siempre: falta la G favorable 0,80 de la tabla 4.1 del DB SE. El levantamiento por viento de una cubierta ligera sólo se comprueba con 1,35·G, que sobrestima el peso estabilizador | **Del lado inseguro** en cubiertas ligeras con succión | RES-01 |
| 2 | `src/features/fem2d/checks.ts:82-96, 149`; `src/lib/frame-core/sections.ts:72-84` | αcr del HA con rigidez bruta y umbral 10, como en acero. El CE A19 pide rigidez nominal (0,4·Ecd·Ic), unas 3 veces menor. Pórticos de HA con 10 ≤ αcr,bruto < 30 salen intraslacionales | **Del lado inseguro** en pórticos de HA flexibles | RES-05 |
| 3 | `src/features/fem2d/checks.ts:784-814`; `src/features/fem-analysis/solveDesignModel.ts:51` | Las envolventes guardan sólo el valor de mayor \|·\| y pierden el de signo contrario (vano y apoyo, inversión por viento) | Medio: depende de cómo se use la envolvente aguas abajo | RES-12 |
| 4 | `src/features/fem2d/solver2d.ts:117, 277-283`; `src/features/fem-analysis/femSolver.ts:196-203` | El control de equilibrio sólo mira fuerzas y con tolerancia 1e-3 | Bajo: control laxo, no un error de cálculo | VAL-04 |
| 5 | `src/lib/pdf/utils.ts:791` | `inputsFingerprint` es un FNV-1a de 32 bits: 1 % de colisiones hacia las 9 300 huellas | Bajo hoy; alto si se usa como clave de caché | COM-12 |
| 6 | `src/data/factors.ts:2` | γc = 1,5 fijo: no hay situación accidental ni sísmica (γc = 1,3, γs = 1,0) | Conservador, no inseguro | RES-13 |

**Aguas arriba (PyNite):** `Plate3D` (Mxy ×1/(1−ν²), signo opuesto, `kx_mod` incoherente) y `Quad3D(local=False)` (`TypeError` con numpy ≥ 2.4 y álgebra errónea). Conviene abrir issues con los ensayos de `investigacion/experimentos/02-compilador/py/exp_pynite2.py` y `investigacion/experimentos/05-validacion/exp01c_global.py`.

**Recomendación:** atender primero el #1 y el #2, cada uno en su rama `fix/…` con test de regresión, porque están en producción y son inseguros.

## S5 · Preguntas abiertas y cómo cerrar cada una

Ordenadas por la capacidad de cambiar el plan. Las preguntas 20–24 se añadieron con la revisión del motor (S7). Las 4, 5, 15 y 19 sólo aplican si se sigue con PyNite o Pyodide (D11 = a o b). Las 1, 3 y 18 siguen abiertas con cualquier motor.

| # | Pregunta | Cómo se cierra | Fase | Origen |
|---|---|---|---|---|
| 1 | ¿Cuánto error mete el drilling en núcleos reales de muros y en la torsión de planta? | Modelar ETABS 15c/15d en PyNite y comparar con SAP2000 y OpenSees `ASDShellQ4`. Si supera el 2 %, parchear el drilling (Allman/Hughes–Brezzi) en el vendor o usar membrana con modos incompatibles | 0 | MOT-06, VAL-01, VAL-04 |
| 2 | ¿Rendimiento y memoria en portátil con gráfica integrada, Android medio e iPhone? ¿Techo WASM en iOS 26? | Publicar `investigacion/experimentos/04-plataforma/bench/` en una rama de preview y recoger los JSON en esos dispositivos | 0 | PLA, MOT |
| 3 | ¿Qué precisión tiene un Qx/Qy recuperado por equilibrio (derivando M sobre parches) o por fuerzas nodales en las líneas de apoyo? | Script sobre las placas de `exp01d` (a/t = 25 y 40; mallas 8, 16 y 32), con objetivo ≤ 5 % con h/t ≈ 2 | 0 | VAL-03 |
| 4 | ¿Qué α de penalización usar en la zona rígida pilar–losa y en el diafragma sin degradar el condicionamiento, también en Pyodide? | Barrido EI = 10²…10⁸ sobre `exp07`/`exp07b` y `exp_diafragma.py`, midiendo el residuo y la convergencia con mallas de 0,5, 0,25 y 0,125 m | 0 | COM-03, COM-15, VAL-12 |
| 5 | ¿La cancelación cooperativa (`runPythonAsync` + `asyncio.sleep(0)`) funciona en un Worker de navegador, Safari incluido? | Adaptar `cancel_main.mjs` a un Worker de navegador | 0 | MOT-13, PLA-01 |
| 6 | ¿Cuánto falla la envolvente con concomitantes con esfuerzos reales? | Exportar de CYPE o ETABS los esfuerzos por combinación de 2 o 3 edificios del estudio y repetir `env_bench.mts` [B] | 2 | RES-02 |
| 7 | ¿Cuánto acelera un núcleo numérico de `rcColumns` sin `CheckRow` ni cadenas? | Perfilar `calcRCColumn` y prototipar la ruta rápida | 2 | RES-07 |
| 8 | ¿Merece la pena vectorizar `Quad3D.ke()` y las FER (~70 % del tiempo restante)? | Prototipo de ensamblado propio con `B_b`/`B_m` por elemento, comparado con el driver | 2–3 | MOT-03 |
| 9 | Calidad de los quads de triángulos divididos en membrana y en muros con huecos | Patch test de membrana y muro con hueco (ETABS 15c) frente a rejilla y OpenSees | 3 | COM-07, VAL-02 |
| 10 | ¿Qué magnitud se publica en las esquinas de huecos (soluciones singulares)? | Losa y muro con hueco refinando 3 niveles; definir una media en banda de ancho t | 3 | VAL |
| 11 | Signos de Mxy y Qx/Qy con ejes no alineados | Patch test de placa girado, con solución de T&WK | 1 | MOT-10, RES-06 |
| 12 | Rigidez del reticular: ½ maciza o T bruta frente a un modelo CYPECAD | Una planta reticular modelada en los dos programas, comparando flechas y momentos de nervio | 3 | COM-19 |
| 13 | Clasificación traslacional con modo torsional: ¿a partir de qué variación de desplome hace falta pandeo real? | 2–3 edificios con núcleo excéntrico, comparando la fórmula de planta con autovalores de barras | 2 | RES-05 |
| 14 | Factor de la NOTA del §5.3.2.2(3) del CE A19 (está en una imagen del BOE) | Renderizar esa página con PyMuPDF | 3 | RES-09 |
| 15 | ¿Ninguna opción de PyNite importa un subpaquete quitado del scipy adelgazado? | Pasar la batería de PyNite dentro de Pyodide con el wheel adelgazado | 4 | PLA-07 |
| 16 | Safari y Firefox: `clients.claim()` con workers, cuota de localStorage y contextos WebGL | Repetir `bench/claim/`, `cdp_pwa.mjs` y `platform.js` en esos navegadores | 4 | PLA-06, PLA-16, PLA-17 |
| 17 | ¿troika admite WOFF2? | Changelog e issues de troika; probar una WOFF1 de Geist | 4 | PLA-19 |
| 18 | Parámetros exactos de ETABS 15 (la carga de 100 k es inferida) y valores de Dlubal VE | Leer los PDF completos antes de fijar los fixtures | 2 | VAL-18 |
| 19 | ¿Aceptaría PyNite la corrección de `Plate3D`, la de `local=False` y la ortotropía a flexión de `Quad3D`? | Abrir issues con los ensayos | — | COM-04, VAL-06, VAL-07 |
| 20 | ¿Cuánto rinde faer (supernodal, AMD, un hilo, SIMD128) en wasm32 con las K del edificio objetivo? | Spike E0: las mismas K de `investigacion/experimentos/06-escala/` y el modelo E1 del área 7. Pasa con 360 000 GDL en ≤ 15 s y ≤ 2,5 GB | E0 | CAN §9, ESC §6 |
| 21 | ¿Los multiplicadores por dirección (f, m, v, peso) tienen la misma semántica que en SAP2000? | Un reticular con ábacos modelado por el usuario en SAP2000 y en el motor propio: reacciones, momentos de nervio e integrales de banda | E3 | MPR §2.4 |
| 22 | ¿METIS reduce el relleno frente a AMD en modelos reales, con huellas, ábacos y núcleos? | Forzar la ordenación en E1 con un modelo compilado real | E0–E4 | CAN §9 |
| 23 | ¿Funciona el toolchain de Rust (rustup, wasm-bindgen, wasm-opt) en las dos máquinas de desarrollo y en CI de GitHub? | Instalarlo en el spike, con el `.wasm` versionado por sha256 | E0 | MPR §3 |
| 24 | ¿La membrana ITW con drilling de Hughes–Brezzi deja un modo espurio con integración reducida? | Test de los 6 modos rígidos del elemento libre y barrido de γ entre 1e-3·G y G | E0 | MPR §2.2 |

## S6 · Anejos: informes completos, experimentos y método

**Método.** Cinco subagentes trabajaron en paralelo el 2026-10-03, uno por área. Ese mismo día, tras las decisiones D1–D3 y D9, otros tres revisaron el motor: escala (área 6), candidatos y licencias (área 7) y alcance de un motor propio (área 8). Cada uno leyó el diseño técnico y el código del repositorio y consultó fuentes primarias (código fuente de PyNite 3.2.0, normas, manuales de verificación, documentación oficial). También ejecutaron experimentos propios en esta máquina: Windows 11, Ryzen 9 5900X, RTX 4060 Ti, CPython 3.14.7, Node 24.19, Chrome 153 y Pyodide 314.0.0.

La agregación unió los hallazgos que se repetían entre áreas y resolvió dos discrepancias:
- la comprobación de estabilidad en H12;
- el convenio de signos de My en H02.

Dos fallos de producción de S4 (el 1 y el 2) se comprobaron otra vez a mano en el código.

**Informes originales** (todo el detalle y la evidencia de cada ID):

| Fichero | Área | IDs | Experimentos |
|---|---|---|---|
| `investigacion/01-motor.md` | Motor: PyNite sobre Pyodide | MOT-01…20 | `investigacion/experimentos/01-motor/`: `pyodide_run.mjs` (runner de Node con modos `boot`, `minimo`, `scaling`, `noscipy`…), `pynite_fast.py` (driver propio), `exp_*.py` |
| `investigacion/02-compilador.md` | Compilador y mallado | COM-01…20 | `investigacion/experimentos/02-compilador/js/` (mallado, topología, ulp V8/JSC) y `py/` (ensayos sobre PyNite) |
| `investigacion/03-resultados.md` | Resultados y comprobaciones | RES-01…18 | `investigacion/experimentos/03-resultados/`: `combos3d.mts`, `env_bench.mts` (importa `rcColumns.ts` del worktree), `wood_armer.py`, `exp_losa_plana.py` |
| `investigacion/04-plataforma.md` | Plataforma web | PLA-01…20 | `investigacion/experimentos/04-plataforma/`: `bench/` (escenas, Pyodide en Chrome, PWA, memoria, cancelación) y `bundle/` (pesos y React Compiler) |
| `investigacion/05-validacion.md` | Validación | VAL-01…20 | `investigacion/experimentos/05-validacion/`: `common.py` (generador de placas, Richardson/GCI), `refs.py` (Navier/Mindlin), `exp01`…`exp11`, `pyo/run_det.mjs` |
| `investigacion/06-escala.md` | Escala del edificio objetivo (revisión del motor) | ESC §1–§11 | `investigacion/experimentos/06-escala/`: `edificio.py` (generador V1/V2/V3), `vec_asm.py` (ensamblado vectorizado), `exp_pynite.py`, `exp_vec.py`, `exp_fact.py`, `exp_pcg.py`, `pyo_run.mjs`. No se copiaron las matrices `K/*.npz` (341 MB) ni los venvs |
| `investigacion/07-candidatos.md` | Candidatos a motor, solvers y licencias | CAN §0–§10 | `investigacion/experimentos/07-candidatos/bench/`: `bench_solvers.py` y `run.mjs` (CHOLMOD y SuperLU en Pyodide). No se copiaron el dist de Pyodide parcheado ni las fuentes de terceros (incluido código AGPL) |
| `investigacion/08-motor-propio.md` | Alcance de un motor propio (estudio de sólo lectura) | MPR §1–§6 | — |

**Para reproducir un experimento:**
- **Python:** crear un venv con `pip install PyNiteFEA==3.2.0 numpy scipy`; para OpenSeesPy, Python 3.12.
- **Pyodide:** los runners de Node esperan `node_modules/pyodide` del repositorio y los wheels de numpy y scipy del CDN fijado (`https://cdn.jsdelivr.net/pyodide/v314.0.0/full/`).
- **Rutas:** las absolutas de los scripts apuntan a la carpeta temporal de la sesión original y hay que ajustarlas.
- **Qué no se copió:** los venvs, `node_modules`, el código fuente de terceros ni los PDF descargados (CE, CTE, manuales de CSI y CYPE). Sus URL están en los informes.

**Documento de partida:** `docs/fem3d/diseno-tecnico.md`, copia sin cambios de `MODULO FEM 3D/diseno-tecnico-modulo-fem-3d-concreta.md` (v0.1).

## S7 · Revisión del motor tras D9: motor propio en TypeScript con solver supernodal en WASM, con un spike de 2–3 semanas como puerta

**Por qué se revisa.** D9 sube el tope a unas 7 plantas con 80 pilares por planta, y D2 y D3 piden viguetas como barras con diafragma y multiplicadores por dirección. Con eso, todos los candidatos existentes caen:
- PyNite no llega al tamaño (H49) ni hace flexión ortótropa o MPC (H55);
- su solver no cabe en la memoria del navegador (H50);
- las licencias descartan OpenSees, xara, stabileo y CHOLMOD supernodal (H54).

Queda un motor propio.

**Las tres vías,** en sobremesa. La (c) es una estimación hasta que se haga el spike:

| Vía | Edificio objetivo (V1, h = 0,75) | Unidireccional (V3) | Techo en sobremesa | Móvil | Descarga y arranque |
|---|---|---|---|---|---|
| (a) PyNite + driver | 105–110 s y 3,2 GB (A) | 22–37 s | ≈ 3 000 nudos en 10 s | ≈ 1 500 nudos | 23–29 MiB y 4–6 s |
| (b) numpy vectorizado + SuperLU en Pyodide | 6,0 s y 2,3–2,8 GB (A) | 1,7 s | ≈ 180 000 GDL, limitado por memoria | ≈ 45 000 GDL | 23–29 MiB y 4–6 s |
| (c) motor propio + solver supernodal en WASM | 1,7–2,5 s y ~0,25 GB (C) | 0,5–0,7 s | ≈ 600 000 GDL en 10 s (C) | El objetivo cabe (C) | 0,3–1,5 MB y < 0,2 s |

**Recomendación: la vía (c), con una arquitectura híbrida** (informe del área 8):
- **En TypeScript:**
  - elementos, restricciones, ensamblado y recuperación de esfuerzos. Es donde se cuelan los errores de un motor FEM (formulación, signos, restricciones), y así quedan en el lenguaje del repo y bajo vitest;
  - un solver de perfil (~300 líneas, con RCM), como referencia diferencial y como reserva para modelos de hasta 30 000 GDL.
- **En Rust con faer, compilado a WASM:** sólo la factorización LDLᵀ supernodal con AMD y la resolución por bloques de lados derechos.
  - La API son unas 5 funciones.
  - El `.wasm` se versiona con su sha256, con el patrón de `scripts/vendor-pyslope.mjs`, para que husky y `test:run` no necesiten Rust.
- **Plan B, ya medido:** si faer no cumple, la vía (b) (H51) ya calcula el edificio objetivo en sobremesa con rejilla alineada.
- **Plan C:** METIS como ordenación, o MUMPS (CeCILL-C) en un módulo aparte.

**Especificación mínima.** El detalle está en `investigacion/08-motor-propio.md` §2.
- **Convenios:** unidades kN–m (D1) y signos tipo CSI nativos (H02).
- **Lámina DKMQ24:**
  - la flexión DKMQ de Katili, la misma de PyNite, que así queda como oráculo bit a bit;
  - la membrana ITW con el drilling de Hughes–Brezzi, que resuelve H05 y H17;
  - φ anisótropa, para que m11 ≠ m22 entre de verdad.

  Sin triángulos en el MVP (H29).
- **Barra de Timoshenko 3D** con offsets rígidos, punto de inserción, liberaciones por condensación y modificadores (H47).
- **Restricciones por transformación maestro-esclavo** (u = T·û):
  - diafragma por planta: rígido, semirrígido o ninguno;
  - enlaces rígidos para la huella del pilar (H09) y para el brazo de una viga en el plano de un muro.

  Al no haber penalización, desaparecen los barridos de α, y con diafragma rígido cada nudo de losa se queda en 3 GDL.
- **Forjados (D2 y D3):**
  - **Unidireccional:** el paño lleva dirección e intereje y se convierte en una vigueta-barra por intereje, con la T bruta. Lleva nudos en los cruces con vigas, carga q·intereje y diafragma rígido obligatorio. Da los esfuerzos por vigueta.
  - **Reticular:** lámina con el canto total y multiplicadores por dirección sobre la maciza (f11, f22, f12, m11, m22, m12, v13, v23 y peso). Salen de nervios y casetones (`src/data/forjadoTipologias.ts`). Los ábacos son regiones con multiplicador 1. Falta confirmar con un modelo SAP2000 del usuario que la semántica coincide.
- **Cortantes de lámina:** por fuerzas nodales a lo largo de una línea, que cierra el equilibrio, y SPR para los mapas (H18).
- **Solver:**
  - matriz CSC (triángulo superior), con el patrón simbólico calculado una sola vez;
  - ordenación AMD o disección anidada por plantas;
  - LDLᵀ supernodal, con 24 o más casos por bloque;
  - un pivote nulo se traduce al objeto físico que lo causa (H12).

**Spike E0 (2–3 semanas), como puerta antes de comprometer la Fase 1.** Criterios de paso:
1. La DKMQ en TypeScript coincide con `Quad3D` de PyNite a 1e-10 en flexión pura.
2. La viga en el plano de un muro y el muro 1×3 dan un error ≤ 5 % frente a OpenSeesPy `ASDShellQ4` (H05, H17).
3. faer en WASM (un hilo, SIMD128) factoriza las K del edificio objetivo: 360 000 GDL en ≤ 15 s con un heap ≤ 2,5 GB, y 165 000 GDL en ≤ 5 s.
4. El `.wasm` del núcleo pesa ≤ 1,5 MB y el toolchain de Rust funciona en Windows y en CI.

Requisito previo: instalar Rust (`rustup`, el target `wasm32-unknown-unknown`, `wasm-bindgen-cli` y `wasm-opt`). Hoy no está en la máquina.

**Esfuerzo** (estimación C del área 8, en semanas-persona):

| Fase | Contenido | Semanas |
|---|---|---|
| E0 Spike | DKMQ en TypeScript, membrana ITW en un muro, faer-WASM frente al solver de perfil, Rust en Windows y en CI | 2–3 |
| E1 Núcleo | GDL, restricciones con cadenas, apoyos, muelles, CSC, solver de perfil, ΣF/ΣM y diagnósticos | 2–4 |
| E2 Barras | Timoshenko, offsets, punto de inserción, liberaciones, FER, diagramas y `seccion3D()` | 2–3 |
| E3 Láminas | DKMQ24 con multiplicadores, cargas, resultantes y giro a ejes de usuario | 3–5 |
| E4 Núcleo WASM | Crate, API, artefacto versionado, CI, worker y memoria | 2–3, en paralelo con E2–E3 |
| E5 Q y bandas | SPR y corte por fuerzas nodales (hacen falta con cualquier motor) | 1–2 |
| E6 Endurecimiento | ETABS 15, SAP 1-024, modelos SAP2000 del usuario, pruebas metamórficas y rendimiento | 2–4 |
| E7 Opcional | Modal, temperatura y triángulos | 2–6 |

- **Coste.** El núcleo (E0–E6) son 14–24 semanas. Frente al plan con PyNite (S1) son 6–12 semanas netas más, porque desaparecen 5–13 semanas de *workarounds* de PyNite: driver, ejes y signos, penalizaciones, scipy sin conexión y vendor.
- **Qué no cambia:**
  - el compilador y el mallador (H28, H29);
  - las combinaciones (H30, H31);
  - los resultados y el visor (H36, H41);
  - la batería de validación (H40).

  La Fase 1 de S1 (el núcleo independiente del motor: modelo físico, compilador y combinaciones) puede empezar a la vez que el spike.
- **Qué desaparece o se simplifica:**
  - desaparecen H04, H15, H08, H14 y H26;
  - se simplifica H20: cancelar pasa a ser `terminate` + ~0,1 s;
  - desaparecen los *workarounds* de H05, H07 y H09;
  - se mitiga H16.
- **Riesgos:**
  - **Errores silenciosos de formulación.** Mitigación: PyNite y `vec_asm.py` como oráculos diferenciales, OpenSeesPy, MacNeal–Harder y los casos de CSI.
  - **Rendimiento real de faer en WASM,** sin medir.
  - **El toolchain de Rust en Windows.**
  - **La memoria en iOS.**
  - **La semántica de los multiplicadores frente a SAP2000.**
  - **El mantenimiento pasa a ser propio:** unas 10 000–15 000 líneas de TypeScript y unas 500 de Rust.
