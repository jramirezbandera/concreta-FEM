> **Informe original del Área 6 — Escala del edificio objetivo**, generado por un subagente el 2026-10-03.
> El documento consolidado es `../investigacion-id.md`; esto es el detalle con toda la evidencia.
> Los scripts y salidas citados están ahora en `experimentos/06-escala/`; las rutas absolutas
> del texto apuntan a la carpeta temporal de la sesión que los ejecutó.

# FEM 3D · Escala: ¿cabe un edificio de 7 plantas y 80 pilares por planta en el navegador?

> **Qué es.** Experimento de I+D sobre el tamaño de modelo que admite el módulo FEM 3D de Concreta, con tres vías de motor: **(a)** PyNite 3.2.0 con el driver propio de H04; **(b)** ensamblado propio vectorizado en numpy + SuperLU de scipy, en Pyodide; **(c)** motor nativo en WASM (Rust o C++), donde sólo cuenta el solver.
>
> - **Fecha:** 2026-10-03. **Máquina:** AMD Ryzen 9 5900X (12 núcleos), 32 GB, Windows 11; Node 24.19 como sustituto de V8/Chrome; Pyodide 314.0.0 (numpy 2.4.3, scipy 1.17.1); CPython 3.14.7 con las mismas versiones de numpy y scipy, BLAS a 1 hilo.
> - **Máquina compartida.** Durante las mediciones había otras sesiones con carga (otro proceso Node de 8 GB, un Chrome sin cabeza, servidores Vite). Las fases en Python de PyNite variaron hasta un ±30 % entre repeticiones; se dan los valores medidos y, cuando hay dos, ambos.
> - **Soporte de cada cifra:** **A** medido aquí · **B** extrapolado de medidas propias con una regla explícita · **C** estimado (modelo de coste o fuente externa sin verificar en esta sesión).
> - **Carpeta:** scripts, salidas `out_*.txt` y matrices `K/*.npz` en esta misma carpeta (`06-escala`). Lista al final.

## 0 · Veredicto

**El edificio objetivo cabe en el navegador, pero no con PyNite.** Con la densidad de malla de H10 (8 elementos por vano, h ≈ 0,75 m), la losa maciza son 27 500 nudos y 165 000 GDL; el reticular, 32 600 nudos; el unidireccional con viguetas como barras, 7 500 nudos.

| Vía | Edificio objetivo (V1, h 0,75) | V3 unidireccional | Techo práctico en sobremesa | ¿Cabe? |
|---|---|---|---|---|
| **(a)** PyNite + driver de H04 | 105–110 s y 3,2 GB de heap (A) | 22–37 s (A/B) | ≈ 2 500–3 000 nudos en 10 s; ≈ 50 000 por memoria | **No** (sólo V3, y lento) |
| **(b)** ensamblado vectorizado + SuperLU simétrico en Pyodide | **6,0 s** (9–10 s con la máquina cargada) y 2,3–2,8 GB (A) | **1,7 s** (A) | ≈ 30 000 nudos / 180–200 k GDL, por memoria (A/B) | **Sí**, sin margen para h 0,5 ni CDT |
| **(c)** motor nativo en WASM con Cholesky supernodal | **1,7–2,5 s** y ~0,25 GB (C) | 0,5–0,7 s (C) | ≈ 100 000 nudos en 10 s (C) | **Sí**, con margen; única vía para móvil |

**Por qué.**
1. **En PyNite manda Python por elemento.** `Quad3D.Ke` (~2 ms por quad en Pyodide), FER (~0,65 ms por quad y caso) y reacciones se llevan más del 90 % del tiempo. Además, `PhysMember.descritize` busca nudos intermedios en O(barras × nudos): 135 s con 52 000 nudos. Con `SYM`, la factorización es el 1–6 % (con COLAMD, hasta el 16 %).
2. **El ensamblado vectorizado reproduce PyNite exactamente** (K a 2,4e-16; desplazamientos a 3,1e-13) y lo hace 35–65 veces más rápido. A partir de ahí manda la factorización.
3. **COLAMD, lo que usan PyNite y el driver, es la peor ordenación para una K simétrica.** `splu` con `MMD_AT_PLUS_A` + `SymmetricMode` + `diag_pivot_thresh=0` es 3–6 veces más rápido y deja 2–3 veces menos relleno, con los mismos residuos.
4. **En Pyodide el límite de (b) es la memoria, no el tiempo.** El techo medido de wasm32 es 4 GiB, no 2. SuperLU reserva de más, y como el heap no baja, de 300 000 GDL en adelante se toca el techo y falla de forma intermitente.
5. **Un Cholesky supernodal nativo** (CHOLMOD, medido en nativo con núcleos SSE3 como sustituto de WASM SIMD) es 3–4 veces más rápido que SuperLU y guarda la mitad. De ahí sale la estimación de (c).

**Qué hacer ya (A, cambios pequeños).**
- En el driver: `SYM` en vez de COLAMD.
- Quitar la búsqueda de `descritize`.
- Reacciones vectorizadas.
- **Sustituir `Quad3D.Ke`/`fer` y `Member3D.Ke`/FER por el ensamblado vectorizado** (`vec_asm.py`). PyNite queda como oráculo de validación y como API de resultados del MVP (con el operador de H15).

**Recomendación de arquitectura.**
- **MVP con (b):** tope de ≈ 180 k GDL en sobremesa y ≈ 45 k en móvil; worker reciclado tras cada cálculo grande.
- **Siguiente paso, el híbrido:** el solver sale a un módulo WASM propio (Cholesky supernodal; faer, MIT, es candidato, C). Tiene su propia memoria, así que quita el techo de 4 GiB sin reescribir el elemento.
- **(c) completo** sólo si hace falta el móvil o el mallado fino (16 por vano, ≈ 114 000 nudos).

## 1 · Edificio de referencia y cómo se ha modelado

- **Geometría** (`edificio.py`, parametrizable): 7 plantas (PB de 4,0 m y 6 de 3,0 m, 22 m en total); retícula de 10×8 pilares con luces de 5,5 m (X) y 5,0 m (Y), 49,5×35 m; pilares de 40×40 en P1–P3 y 30×30 en P4–P7; dos núcleos cerrados de muros de 25 cm (ascensor 2,0×2,0 m y escalera 2,5×5,0 m) con el forjado hueco dentro; muros en rejilla por paño con 8 elementos por altura de planta (H17). Irregularidad opcional: cada luz × (1 ± 0,10) aleatorio (semilla fija), con la rejilla todavía alineada a ejes.
- **V1 – losa maciza de 25 cm** como lámina `Quad3D`: rejilla alineada con los ejes, los bordes de los núcleos como líneas de control y cada intervalo en ⌈L/h⌉ partes. Pilares unidos al nudo de la losa (sin huella, H09) y vigas embebidas por todas las líneas de ejes (30×50 en el perímetro y 60×25 planas en el interior).
- **V2 – reticular** como lámina de 0,233 m (T bruta, H46) con ábacos de 0,40 m de 2,5×2,5 m en cada pilar. Los bordes de ábaco (±1,25 m del eje) son líneas de control. **Sí cambia el tamaño:** con h = 1,0 parte cada luz en 1,25 + 3,0 + 1,25 → 7 elementos en vez de 6 (X) o 5 (Y), +61 % de nudos; con h = 0,75, +19 %; con h = 0,5, +21 %.
- **V3 – unidireccional** como CYPECAD: viguetas de 12×30 cada 0,6875 m (8 intervalos por vano de 5,5 m) en dirección Y, de viga a viga y de una sola barra; vigas planas en X por las 8 líneas de ejes, partidas en cada vigueta; zunchos en Y por las líneas de pilares. Diafragma por penalización (H07): barras biarticuladas con la torsión liberada, E = 10³·E_c, por los 4 lados y las 2 diagonales de cada recuadro de pilares, más 6 barras por núcleo. Muros con h = 0,5 m en horizontal.
- **Cargas** (6 casos simples, H21): G (peso propio de barras + pp de losa + 2 kPa; en V3 la carga de forjado va como carga lineal en viguetas), Q (3 kPa), WX, WY, EX, EY (fuerzas en cabeza de los 80 pilares de cada planta). Cada caso es una combinación de factor 1.
- **Unidades y ejes:** SI y Y-up de PyNite con la permutación (Yc, Zc, Xc) de H08.
- **Precisión a la que corresponde cada h** (H10): 8 elementos por vano dan h ≈ 0,69 m en la luz de 5,5 m (≈ la fila h = 0,75); 16 por vano en momentos negativos dan h ≈ 0,34 m (≈ la fila h = 0,35). La fila h = 1,0 (5,5 elementos por vano) queda por debajo de lo que pide H10.
- **CDT del compilador.** El mallador recomendado en H29 (CDT a 2h dividida en 3 quads) produce del orden de 1,6 veces los nudos de una rejilla del mismo h (702 quads frente a 443 en la losa de H29). Para pasar de estas tablas a un modelo real, cuente los nudos, no h.

### 1.1 Validación del ensamblado vectorizado frente a PyNite (A)

`vec_asm.py` reescribe en numpy, por lotes, `Quad3D.ke()`/`Ke()`/`fer()` (DKMQ + Q4 con el muelle de drilling de 1/1000) y `Member3D.ke()`/`T()`/FER de carga uniforme global, y ensambla por bloques 6×6 de pares de nudos con `np.bincount`. En el edificio V1 de una planta (2 349 nudos, 2 166 quads, 880 barras; `exp_validar.py`):

| Magnitud | Diferencia máxima relativa con PyNite |
|---|---|
| K global | 2,4e-16 |
| P − FER de los 6 casos | 1,6e-16 |
| Desplazamientos | 3,1e-13 |

Las reacciones verticales de G coinciden en todos los modelos medidos (p. ej. 124 041,5 kN en el edificio de 7 plantas por las dos vías). El ensamblado vectorizado deja menos «no ceros» que PyNite (1,69 M frente a 1,88 M en V1 h = 1,0): PyNite usa `inv(T)` y arrastra términos de 1e-17 que su filtro `!= 0` no quita.

## 2 · Tamaños (A)

nnz(K11) = no ceros numéricos de la matriz de GDL libres, las dos mitades (ensamblado vectorizado, sin ceros exactos). «Bloques» = 36 × pares de nudos conectados, que es lo que guardaría un motor que almacene bloques 6×6 densos. Las barras incluyen las de penalización (entre paréntesis); los quads, los de muro (entre paréntesis).

| Var. | h (m) | Irreg. | Nudos | GDL | GDL libres | Barras (penal.) | Quads (muro) | nnz(K11) | nnz bloques | Líneas X×Y |
|---|---|---|---|---|---|---|---|---|---|---|
| V1 | 1,0 | – | 15 807 | 94 842 | 94 206 | 6 160 | 15 162 (1 456) | 1,69 M | 5,0 M | 56×37 |
| V1 | 0,75 | – | 27 526 | 165 156 | 164 472 | 8 078 | 26 684 (1 904) | 2,94 M | 8,8 M | 74×50 |
| V1 | 0,5 | – | 52 262 | 313 572 | 312 816 | 11 060 | 51 114 (2 576) | 5,08 M | 16,7 M | 101×71 |
| V1 | 0,35 | – | 113 593 | 681 558 | 680 646 | 16 156 | 111 936 (4 752) | 12,28 M | 36,4 M | 147×107 |
| V1 | 1,0 | 10 % | 17 547 | 105 282 | 104 622 | 6 398 | 16 884 (1 680) | 2,04 M | 5,6 M | 56×41 |
| V1 | 0,75 | 10 % | 28 867 | 173 202 | 172 494 | 8 176 | 28 021 (2 128) | 3,30 M | 9,2 M | 73×53 |
| V1 | 0,5 | 10 % | 57 334 | 344 004 | 343 224 | 11 494 | 56 140 (2 800) | 6,44 M | 18,3 M | 105×75 |
| V2 | 1,0 | – | 25 394 | 152 364 | 151 704 | 7 756 | 24 584 (1 680) | 2,66 M | 8,1 M | 67×51 |
| V2 | 0,75 | – | 32 640 | 195 840 | 195 132 | 8 750 | 31 738 (2 128) | 3,37 M | 10,4 M | 76×58 |
| V2 | 0,5 | – | 63 039 | 378 234 | 377 454 | 12 124 | 61 782 (2 800) | 6,69 M | 20,2 M | 110×79 |
| V3 | viguetas 0,69; muros 0,5 | – | 7 514 | 45 084 | 44 268 | 14 105 (5 712) | 3 136 (3 136) | 0,53 M | 1,8 M | 77 estaciones × 8 vigas |
| V3 | íd. | 10 % | 7 826 | 46 956 | 46 116 | 14 161 (5 712) | 3 360 (3 360) | 0,63 M | 1,9 M | 78 × 8 |

Lectura rápida:
- **El edificio objetivo con la densidad de H10 (≈ h = 0,75) son ~28 000 nudos y ~165 000 GDL en losa maciza**, ~33 000 nudos en reticular y ~7 500 nudos en unidireccional. Con 16 elementos por vano (h ≈ 0,35) se va a 114 000 nudos y 680 000 GDL.
- V3 tiene 4–7 veces menos nudos que V1, pero más barras que V1 a h = 0,5 (14 105 frente a 11 060), y 5 712 de ellas (40 %) son de penalización.
- La irregularidad del 10 % añade un 5–11 % de nudos en rejilla; con CDT el factor sería ~1,6 (H29).

## 3 · Vía (a): PyNite 3.2.0 + driver propio

`exp_pynite.py` construye el `FEModel3D` desde el modelo neutro y llama a `pynite_fast.solve_linear` (el driver de H04: `splu` una vez, 6 lados derechos, FER sólo de los elementos cargados). Dos opciones nuevas del driver, medidas por separado:
- **`SYM`**: `splu(permc_spec='MMD_AT_PLUS_A', diag_pivot_thresh=0, SymmetricMode=True)` en vez de COLAMD (ver §5).
- **`nodesc`**: sustituye `PhysMember.descritize` por la misma función sin la búsqueda de nudos intermedios. Esa búsqueda recorre **todos los nudos para cada barra** en cada análisis (`Analysis._renumber` → `PhysMember.py:79`): es O(barras × nudos), unos 0,2 µs por par. El compilador ya garantiza que no hay nudos intermedios (H19), así que la búsqueda sobra.

Columnas en segundos; «prep.» es `_prepare_model` (casi todo `descritize`); «Ke» es el ensamblado de PyNite (`Quad3D.Ke` y `Member3D.Ke` en Python, elemento a elemento); «FER+P», las cargas; «reacc.», `Analysis._calc_reactions`. Memoria: pico del conjunto de trabajo en CPython; heap WASM final (= máximo, nunca baja) en Pyodide.

**CPython 3.14 (A)**

| Modelo | Nudos | Driver | Total | Prep. | Ke | FER+P | Reacc. | Factoriza | Pico |
|---|---|---|---|---|---|---|---|---|---|
| V1 h 1,0, 2 plantas | 4 592 | COLAMD | 12,7 | 0,9 | 5,5 | 3,3 | 1,5 | 1,0 | 409 MB |
| V1 h 1,0, 4 plantas | 9 078 | COLAMD | 23,7 / 33,1 | 3,6 / 4,7 | 9,8 / 15,9 | 5,1 / 6,5 | 1,8 / 2,2 | 2,9 / 3,2 | 798 MB |
| V1 h 1,0 | 15 807 | COLAMD | 49,7 | 13,6 | 17,9 | 9,4 | 2,9 | 5,1 | 1 349 MB |
| V1 h 1,0 | 15 807 | COLAMD + nodesc | 35,1 | 0,1 | 17,2 | 9,1 | 2,9 | 5,0 | 1 351 MB |
| V1 h 1,0 | 15 807 | SYM | 40,4 | 16,2 | 13,4 | 6,9 | 2,4 | 0,9 | 689 MB |
| V1 h 0,75 | 27 526 | SYM | 105,5 | 44,5 | 34,6 | 17,5 | 5,1 | 2,9 | 1 121 MB |
| V1 h 0,5 | 52 262 | SYM | 240,3 | 135,2 | 60,0 | 29,4 | 10,9 | 3,3 | 2 033 MB |
| V3 | 7 514 | COLAMD | 31,2 | 13,6 | 7,0 | 3,4 | 3,9 | 2,8 | 778 MB |
| V3 | 7 514 | COLAMD + nodesc | 17,5 | 0,2 | 6,2 | 3,4 | 4,0 | 3,2 | 805 MB |

**Pyodide 314 en Node 24 (A)** — sin contar el arranque de Pyodide + numpy + scipy (≈ 2,9 s) ni el `import Pynite` (≈ 0,7 s).

| Modelo | Nudos | Driver | Total | Prep. | Ke | FER+P | Reacc. | Factoriza | Heap |
|---|---|---|---|---|---|---|---|---|---|
| V1 h 1,0, 4 plantas | 9 078 | COLAMD | 35,9 | 4,8 | 13,5 | 7,1 | 3,7 | 5,0 | 1 388 MB |
| V1 h 1,0 | 15 807 | **COLAMD (driver H04 tal cual)** | **126,8** | 26,8 | 42,2 | 23,9 | 9,3 | 20,3 | 2 289 MB |
| V1 h 1,0 | 15 807 | SYM | 91,7 | 25,2 | 35,7 | 18,4 | 6,9 | 3,3 | 1 873 MB |
| V1 h 1,0 | 15 807 | SYM + nodesc | 50,4 / 51,9 | 0,2 | 29,8 / 28,7 | 11,3 / 14,6 | 5,1 / 4,6 | 1,7 / 2,0 | 1 867–1 872 MB |
| V1 h 0,75 | 27 526 | SYM | 109,8 | 28,4 | 41,8 | 24,4 | 8,5 | 4,3 | 3 223 MB |
| V1 h 0,75 | 27 526 | SYM + nodesc | 104,5 | 0,3 | 55,6 | 29,4 | 11,8 | 4,8 | 3 223 MB |
| V1 h 0,5 | 52 262 | SYM + nodesc | 220,9 | 0,3 | 100,1 | 66,0 | 34,7 | 13,7 | 3 885 MB |
| V3 | 7 514 | SYM | 37,1 | 14,7 | 8,9 | 4,4 | 6,9 | 1,0 | 745 MB |

**Extrapolado (B)**
- V1 h 0,5 en Pyodide **con** `descritize`: 220,9 s + 86–250 s de preparación (los 135 s de CPython × la razón Pyodide/CPython de esa fase, que salió entre 0,64 y 1,85) ≈ **5–8 min**, con el heap ya en 3,9 GB.
- El driver de H04 tal cual (COLAMD + `descritize`) en V1 h 0,75: la factorización COLAMD de esa K tarda 10,8–50,6 s en Pyodide (§4–§5; con la K de PyNite, algo más), así que el total pasa de 105–110 s a ≈ 120–160 s, con más heap.
- V2 h 0,75 (32 640 nudos, +19 %): ≈ 130 s. V1 h 0,35 (114 000 nudos): no cabe; el heap ya roza los 4 GiB con 52 000 nudos.

**Razón Pyodide/CPython.** La variabilidad entre repeticiones en Pyodide es grande (Ke 41,8 frente a 55,6 s en V1 h 0,75), por la carga de la máquina. La razón sale entre 1,0 y 2,3 en el total (2,3 con 15 807 nudos; 1,04 con 27 526, donde la preparación fue más rápida en Pyodide que en CPython; 2,1 con 52 262 sin `descritize`). Por fases: Ke 1,2–2,7; FER 1,4–2,2; reacciones 1,7–3,2; factorización 2,5–4,1. La regla de H04 (≈ 2,3 en las partes Python) sigue siendo una cota razonable; aquí se usan las medidas de Pyodide directamente.

**Dónde se va el tiempo.** En Pyodide, con 52 000 nudos: Ke 45 %, FER 30 %, reacciones 16 %, factorización 6 %. Ke cuesta ≈ 2 ms por quad, FER ≈ 0,65 ms por quad y caso cargado, y las reacciones (que el driver delega en `Analysis._calc_reactions`, elemento a elemento y caso a caso) ≈ 0,1 ms por elemento y caso. Todo eso es Python por elemento, y la vía (b) lo elimina.

**Conclusión de (a).** El edificio objetivo no es interactivo con PyNite:
- **V1 con la malla de H10 (h ≈ 0,75):** 105–110 s y 3,2 GB de heap.
- **V1 con h = 1,0,** que ya es más gruesa de lo que pide H10: 50–52 s con el driver mejorado y 127 s con el de H04 tal cual.
- **V1 con h = 0,5:** 3,7 min sin `descritize` (A) y 5–8 min con él (B), al borde de los 4 GiB.
- **V3:** 37 s, o ≈ 22 s con `nodesc` (B: 37,1 − 14,7).

Con PyNite, el techo práctico son ≈ 2 500–3 000 nudos en 10 s (§7).

## 4 · Vía (b): ensamblado vectorizado + SuperLU (scipy) en Pyodide

`exp_vec.py` → `vec_asm.solve` (o `solve_lean`): ensamblado vectorizado (§1.1), cargas, partición, `splu` simétrico (`SYM`), 6 lados derechos, residuo y reacción vertical de comprobación. «Ens.» suma patrón, `ke`, dispersión, cargas y partición. `solve_lean` construye K11 directamente desde los bloques en CSC con índices int32 y libera todo lo intermedio antes de factorizar; en Pyodide traza el heap por fases. Cuando hay dos cifras, son dos ejecuciones (normal / `lean`) o dos repeticiones. «Con carga» son las tandas que coincidieron con otras sesiones pesadas en la máquina; «tranquila», la repetición posterior.

| Modelo | GDL libres | CPython: total (ens. / fact.) | Pico CPython | Pyodide, máquina tranquila: total (ens. / fact.) | Pyodide, con carga | Heap Pyodide |
|---|---|---|---|---|---|---|
| V3 | 44 268 | 0,74 (0,18 / 0,43) | 281 MB | **1,69** (0,28 / 1,03) | 1,87 / 2,21 | 577–621 MB |
| V1 h 1,0 | 94 206 | 2,10 (0,59 / 1,29) | 589 MB | **4,42** (0,78 / 3,02) | 5,94 / 5,79 | 1 407–1 734 MB |
| V1 h 0,75 | 164 472 | 3,16 (1,09 / 1,70) | 876 MB | **5,98 / 5,97** (1,38–1,63 / 3,61–3,74) | 9,07 / 10,16 | 2 311–2 808 MB |
| V1 h 0,5 | 312 816 | 7,45 (2,43 / 4,35) | 1 754 MB | `lean`: **13,1** (3,42 / 8,41) · normal: **falla** en `splu` con el heap en 4 096 MB | `lean`: 18,6 | 3 965 MB |
| V1 h 0,5, irreg. 10 % | 343 224 | 8,43 (2,81 / 4,77) | 1 958 MB | – | 19,6 (3,7 / 13,2) | 3 840 MB |
| V2 h 0,5 | 377 454 | 9,06 (3,28 / 5,00) | 2 097 MB | – | 21,5 / 22,0 (4,3–6,3 / 13,6–13,8) | 4 026–4 077 MB |
| V1 h 0,35 | 680 646 | 17,8 (6,6 / 9,4) | 4 012 MB | ≈ 27–30 (B: factorización aislada de 17,1 s, §5, + ensamblado y resolución) | `lean`: 49,1 (12,1 / 31,8) · normal: factoriza y resuelve y falla después al copiar L | 3 717–3 838 MB |

Con el COLAMD de PyNite en vez de `SYM` (A): V1 h 1,0 factoriza en 4,0 s en CPython y 7,8–11,1 s en Pyodide (heap 2,0 GB); V1 h 0,75, en 5,3 s y 10,8–50,6 s (aislada con la máquina tranquila, §5 / dentro de la tanda con carga).

**El heap no lo llena el modelo, lo llena SuperLU.** Traza de `solve_lean` en Pyodide (A):

| Modelo | Tras cargar paquetes | Tras ensamblar | Con K11 | Tras factorizar | nnz(L+U) | L+U nominal (8+4 B) |
|---|---|---|---|---|---|---|
| V3 | 90 MB | 155 MB | 155 MB | 577 MB | 8,4 M | 100 MB |
| V1 h 1,0 | 90 MB | 224 MB | 224 MB | 1 407 MB | 20,4 M | 244 MB |
| V1 h 0,75 | 90 MB | 297 MB | 356 MB | 2 312 MB | 31,2 M | 374 MB |
| V1 h 0,5 | 108 MB | 398 MB | 574 MB | 3 965 MB | 64,8 M | 778 MB |
| V2 h 0,5 | 108 MB | 552 MB | 658 MB | 4 077 MB | 80,4 M | 965 MB |
| V1 h 0,35 | 130 MB | 759 MB | 1 041 MB | 3 838 MB | 153,7 M | 1 844 MB |

SuperLU reserva de entrada un múltiplo fijo de nnz(A) para L y U y luego amplía por realloc con copia. En nativo esas reservas son memoria virtual que no se llega a tocar (el pico de CPython es menos de la mitad del heap de Pyodide). En wasm32, en cambio, cada `malloc` hace crecer el heap, que no vuelve a bajar. El efecto es errático: V1 h 0,5 falló en la ruta normal y pasó en la `lean`; V1 h 0,35, con el doble de GDL, cupo. El RSS real de Node fue mucho menor (1,3 GB con V1 h 0,5 `lean`; 2,4 GB con h 0,35). El error de SuperLU al quedarse sin memoria llega como `SystemError: gstrf was called with invalid arguments`, que engaña: es el código de memoria desbordado a negativo en un `int` de 32 bits (C).

**Razón Pyodide/CPython de (b).** Con la máquina tranquila: factorización 1,9–2,3 y ensamblado vectorizado 1,3–1,4. Con la máquina cargada: 2,6–3,4 y 1,4–2,5.

**Conclusión de (b).**
- **El edificio objetivo cabe**: V1 con la malla de H10 (h 0,75) se calcula en **6 s** en Pyodide (9–10 s con la máquina cargada; ≈ 3,7 s de factorización), con 2,3–2,8 GB de heap. V3 en **1,7 s**. V1 h 1,0 en 4,4 s.
- **V1 h 0,5** (313 000 GDL) **y V2 h 0,5** tardan **13–22 s**, pero tocan el techo de 4 GiB y fallan de forma intermitente: no es un tamaño utilizable en producción.
- **El ensamblado deja de ser el problema:** 1–6 s en Pyodide, frente a 40–170 s de PyNite. Lo que manda ahora es la factorización.

## 5 · Factorización a escala objetivo

Las K11 se guardaron en `K/K11_*.npz` desde la vía (b) (CSC, sin ceros exactos). `exp_fact.py` factoriza cada una con un método por proceso y resuelve 6 lados derechos aleatorios; todos los residuos quedaron por debajo de 1e-9. BLAS a 1 hilo. Esta tanda corrió con la máquina más tranquila que las de §3–§4.

**Métodos**
- `colamd`: `splu(permc_spec='COLAMD')`, que es lo que usan `spsolve` y PyNite.
- `mmd`: `splu('MMD_AT_PLUS_A')` con el pivoteo parcial por defecto.
- **`mmd_sym`**: `splu('MMD_AT_PLUS_A', diag_pivot_thresh=0, options={'SymmetricMode': True})`.
- `colamd_sym`: lo mismo con COLAMD.
- `qdldl`: QDLDL 0.1.9 (LDLᵀ simplicial con AMD, Apache-2.0).
- `cholmod`: CHOLMOD supernodal LLᵀ con AMD, vía cvxopt 1.3.3. La columna «Prescott» repite la medida forzando los núcleos BLAS SSE3 de 128 bits (`OPENBLAS_CORETYPE=Prescott`), que es lo más parecido en nativo a WASM SIMD128.
- `cholmod_s`: CHOLMOD simplicial LDLᵀ.

**Columnas.** Tiempo de factorización en segundos (en CHOLMOD incluye el análisis simbólico, entre paréntesis). nnz del factor: L+U en SuperLU; L en QDLDL y CHOLMOD, donde el supernodal incluye el relleno de los bloques. Gflop = Σ cⱼ² del factor de Cholesky con esa ordenación (convención n³/3), calculado de las columnas de L.

| K (GDL libres; nnz K) | Método | CPython (s) | nnz factor | Gflop | Pyodide (s) | Heap Pyodide |
|---|---|---|---|---|---|---|
| **V3** (44 268; 0,53 M) | colamd | 2,69 | 26,8 M | – | 5,88 | 566 MB |
| | mmd | > 300 (abortado) | – | – | – | – |
| | **mmd_sym** | **0,44** | 8,4 M | 1,7 | **1,01** | 567 MB |
| | colamd_sym | 1,99 | 20,9 M | 9,3 | 4,34 | 566 MB |
| | qdldl | 0,61 | 4,1 M | 1,7 | – | – |
| | cholmod (Prescott) | 0,12 (0,04) · 0,16 | 4,7 M | – | – | – |
| | cholmod_s | 0,69 | 4,2 M | – | – | – |
| **V1 h 1,0** (94 206; 1,69 M) | colamd | 4,03 | 42,4 M | – | 7,78 | 1 386 MB |
| | mmd | 23,1 | 113,0 M | – | – | – |
| | **mmd_sym** | **1,33** | 21,3 M | 3,6 | **2,90** | 1 385 MB |
| | colamd_sym | 3,38 | 38,9 M | 13,6 | 6,77 | 1 385 MB |
| | qdldl | 1,42 | 9,1 M | 3,5 | – | – |
| | cholmod (Prescott) | 0,24 (0,08) · 0,37 | 10,1 M | – | – | – |
| | cholmod_s | 1,54 | 9,1 M | – | – | – |
| **V1 h 0,75** (164 472; 2,94 M) | colamd | 5,26 | 66,5 M | – | 10,81 | 2 263 MB |
| | **mmd_sym** | **1,65** | 29,7 M | 5,0 | **3,39** | 2 263 MB |
| | colamd_sym | 3,53 | 50,9 M | 13,0 | 7,11 | 2 263 MB |
| | qdldl | 2,24 | 15,0 M | 5,1 | – | – |
| | cholmod (Prescott) | 0,41 (0,16) · 0,54 | 16,2 M | – | – | – |
| | cholmod_s | 2,32 | 14,7 M | – | – | – |
| **V1 h 0,5** (312 816; 5,08 M) | colamd | 14,29 | 151,1 M | – | 28,78 | 3 800 MB |
| | **mmd_sym** | **3,90** | 66,6 M | 11,2 | **7,83** | 3 800 MB |
| | colamd_sym | 9,95 | 117,7 M | 42,4 | – | – |
| | qdldl | 5,69 | 34,6 M | 13,0 | – | – |
| | cholmod (Prescott) | 0,90 (0,34) · 1,18 | 35,2 M | – | – | – |
| | cholmod_s | 5,64 | 31,7 M | – | – | – |
| **V2 h 0,5** (377 454; 6,69 M) | colamd | 16,56 | 176,7 M | – | 32,46 | 4 011 MB |
| | **mmd_sym** | **4,40** | 76,6 M | 14,3 | **8,61** | 4 011 MB |
| | colamd_sym | 11,59 | 135,2 M | 45,5 | – | – |
| | qdldl | 6,78 | 37,4 M | 14,6 | – | – |
| | cholmod (Prescott) | 1,09 (0,41) · 1,60 | 43,5 M | – | – | – |
| | cholmod_s | 7,72 | 40,2 M | – | – | – |
| **V1 h 0,35** (680 646; 12,28 M) | **mmd_sym** | **9,07** | 150,1 M | 30,5 | **17,10** | 3 787 MB |
| | qdldl | 13,50 | 73,7 M | 29,8 | – | – |
| | cholmod (Prescott) | 2,06 (0,82) · 3,16 | 75,6 M | – | – | – |

**Memoria en CPython** (pico menos la línea base tras cargar K; A): con V1 h 0,5, colamd 1 666 MB, mmd_sym 1 368 MB y colamd_sym 2 545 MB; con V1 h 0,35, mmd_sym 3 216 MB. En QDLDL y CHOLMOD el delta incluye las copias de conversión (CHOLMOD pasa por listas de Python en cvxopt) y no mide el factor. El factor puro es nnz × 8 B más los índices: ≈ 280 MB en CHOLMOD con V1 h 0,5 y ≈ 600 MB con h 0,35.

**Lecturas**
1. **COLAMD es la peor elección para una K simétrica.** Ordena AᵀA para pivoteo parcial y produce 2,0–3,2 veces el relleno de `mmd_sym`, y 3–6 veces su tiempo. Es lo que usan hoy PyNite y el driver de H04. Cambiar a `mmd_sym` es una línea y no cuesta precisión: los residuos son iguales.
2. **MMD sin modo simétrico es aún peor**: el pivoteo destruye la ordenación. Con V1 h 1,0 tardó 23 s y dejó 113 M de no ceros; con V3 (barras de penalización) no acabó en 5 min.
3. **La razón WASM/nativo de SuperLU es 1,9–2,3** con la máquina tranquila. Las tandas de §4, con carga, dieron 2,6–3,4.
4. **El relleno de Cholesky con AMD es la mitad que el L+U de SuperLU** (SuperLU guarda L y U). Las Gflop son las mismas: AMD y MMD ordenan igual de bien estas K.
5. **CHOLMOD supernodal es 3,6–5,5 veces más rápido que `mmd_sym` en nativo**, y 2,8–3,6 veces con núcleos SSE3. Rinde 20–24 Gflop/s con AVX2 y 12–15 Gflop/s con Prescott, el 35–40 % y el 75–90 % del dgemm de cada configuración (55–60 y 16,7 Gflop/s). Los simpliciales (QDLDL, CHOLMOD simplicial) no ganan a `mmd_sym`.

## 6 · Vía (c): motor nativo en WASM

No se ha compilado nada a WASM (sin toolchains, por la restricción del encargo). La estimación se apoya en tres medidas propias:
- **BLAS denso en Pyodide** (A, `pyo_run.mjs blas`): dgemm 6,5 Gflop/s y Cholesky denso (`potrf`) 5,9–6,3 Gflop/s con n = 1 000–2 000. El matmul propio de numpy da 2,7–2,9 Gflop/s. En nativo, a 1 hilo: dgemm 58 Gflop/s y potrf 30–55 con AVX2; dgemm 16,7 y potrf 15,2–15,6 forzando `OPENBLAS_CORETYPE=Prescott`.
- **Razón WASM/nativo de un solver escalar en C** (A): SuperLU `mmd_sym` 1,9–2,3 (§5).
- **CHOLMOD supernodal con núcleos SSE3** (A, columna Prescott de §5).

**Regla (C).** Tiempo en WASM ≈ (factorización + resolución de 6 casos con CHOLMOD-Prescott) × 2,0–2,6, más un ensamblado compilado de 0,2–0,5 veces el ensamblado numpy medido en Pyodide. El factor 2,0–2,6 cubre la parte escalar (razón de SuperLU) y la parte BLAS (dgemm de Pyodide frente a Prescott: 16,7 / 6,5 = 2,6).

**Contraste.** Gflop / (4,5–5,8 Gflop/s), que es el 70–90 % del dgemm de Pyodide (la eficiencia que CHOLMOD alcanza con Prescott), da la misma parte numérica: 0,9–1,1 s con V1 h 0,75 y 2,2–2,9 s con V1 h 0,5.

**Memoria (C).** nnz(L) supernodal × 8 B, más índices, K (media matriz) y la mayor matriz frontal. Esa matriz frontal la pone el separador superior: ~ una línea de nudos de losa × 6 GDL × 7 plantas, entre 3 000 y 4 500 GDL, que son 70–160 MB.

| Modelo | Nudos | GDL libres | Factoriza | Resuelve 6 casos | Ensambla | **Total (c)** | L (valores) | Memoria total |
|---|---|---|---|---|---|---|---|---|
| V3 | 7 514 | 44 268 | 0,32–0,41 | 0,08–0,10 | 0,06–0,14 | **0,5–0,7 s** | 36 MB | ~0,1 GB |
| V1 h 1,0 | 15 807 | 94 206 | 0,74–0,96 | 0,19–0,25 | 0,16–0,39 | **1,1–1,6 s** | 77 MB | ~0,15 GB |
| V1 h 0,75 | 27 526 | 164 472 | 1,08–1,41 | 0,33–0,43 | 0,28–0,69 | **1,7–2,5 s** | 124 MB | ~0,25 GB |
| V1 h 0,5 | 52 262 | 312 816 | 2,4–3,1 | 0,70–0,91 | 0,7–1,7 | **3,8–5,7 s** | 269 MB | ~0,45 GB |
| V2 h 0,5 | 63 039 | 377 454 | 3,2–4,2 | 0,85–1,11 | 0,8–1,9 | **4,8–7,2 s** | 332 MB | ~0,5 GB |
| V1 h 0,35 | 113 593 | 680 646 | 6,3–8,2 | 1,6–2,1 | 1,4–3,5 | **9,3–13,8 s** | 577 MB | ~0,9 GB |

**Qué hace falta para (c), y qué no sirve**
- **Solver supernodal o multifrontal.** QDLDL o un LDLᵀ simplicial no bastan: en nativo ya son 1,1–1,8 veces más lentos que `mmd_sym`, y en WASM no mejorarían la vía (b). Con QDLDL × 2,0 saldrían 4,5 s con V1 h 0,75 y 11,4 s con h 0,5, frente a 3,4 y 7,8 s de SuperLU en Pyodide.
- **Licencias** (C: de memoria, sin verificar en esta sesión). La ordenación AMD de SuiteSparse es BSD-3; el módulo `Supernodal` de CHOLMOD es GPL-2.0+, así que no vale para un producto cerrado. faer (Rust, MIT) tiene Cholesky disperso supernodal con AMD y compila a wasm32. Eigen (MPL-2.0) sólo trae factorizaciones simpliciales propias. QDLDL es Apache-2.0. SuperLU (BSD) ya va dentro de scipy.
- **Ensamblado compilado.** El DKMQ de PyNite reescrito en Rust o C++. `vec_asm.py` ya es una referencia vectorizada que coincide con PyNite al 1e-16 y sirve de oráculo.
- **Híbrido posible (b + c).** Ensamblado en Pyodide y solver en un módulo WASM aparte que recibe K por `Float64Array`. Un módulo aparte tiene su propia memoria, así que el factor deja de competir con el heap de Pyodide por los 4 GiB. Es la forma más barata de quitar el techo de memoria de (b) sin reescribir el elemento.
- **Hilos.** No se cuentan: los hilos WASM piden `SharedArrayBuffer` y aislamiento entre orígenes, que H20 descartó en esta app.

## 7 · Tamaño máximo por vía

Referencia: edificio de láminas tipo V1 (≈ 6 GDL por nudo, ≈ 17 no ceros por fila), sobremesa (Ryzen 9 5900X), Pyodide o WASM a un hilo y worker ya arrancado. Los tamaños se dan en nudos y en GDL; para un mallado CDT, cuente nudos (≈ 1,6 veces los de la rejilla del mismo h).

| Vía | < 10 s | < 30 s | < 60 s | Límite de memoria | Soporte |
|---|---|---|---|---|---|
| (a) PyNite + driver de H04 tal cual (COLAMD, `descritize`) | ≈ 2 500 nudos (15 k GDL) | ≈ 7 500 (45 k) | ≈ 11 000 (66 k) | heap 2,3 GB con 15 800 nudos | B (entre 9 078 → 35,9 s y 15 807 → 126,8 s, A) |
| (a') PyNite + driver con `SYM` y sin `descritize` | ≈ 3 000 (18 k) | ≈ 9 000 (54 k) | ≈ 17 000 (100 k) | heap 3,2 GB con 27 500 nudos y 3,9 GB con 52 000 | B (15 807 → 51 s; 27 526 → 104 s; 52 262 → 221 s, A) |
| (b) ensamblado vectorizado + SuperLU `SYM` en Pyodide | ≈ 40 000 nudos (240 k GDL) por tiempo; **≈ 30 000 (180 k GDL) por memoria** | por tiempo, ≈ 110 000 (V1 h 0,35 ≈ 27–30 s), pero con el heap a 3,8–4,1 GB y fallos intermitentes desde 300 k GDL | íd. | **fiable hasta ≈ 180–200 k GDL** (heap 2,3–2,8 GB); de 300 k GDL en adelante, techo de 4 GiB | A en los puntos medidos; B entre ellos |
| (c) ensamblado compilado + Cholesky supernodal en WASM | ≈ 100 000 nudos (600 k GDL) | ≈ 250 000 (1,5 M GDL; ~2 GB) | ≈ 400 000 (2,4 M GDL), ya limitado por los 4 GiB (~3,5 GB) | ≈ 1 GB con 114 000 nudos | C (§6; potencia ≈ N^1,2) |

**El edificio objetivo en cada vía**

| Caso | (a) PyNite | (b) Pyodide + SuperLU | (c) WASM nativo |
|---|---|---|---|
| V1 h 1,0 (15 807 nudos) | 51–127 s (A) | 4,4 s (A) | 1,1–1,6 s (C) |
| **V1 h 0,75, densidad de H10** (27 526) | 105–110 s, 3,2 GB (A) | **6,0 s, 2,3–2,8 GB (A)** | **1,7–2,5 s, ~0,25 GB (C)** |
| V1 h 0,75 con CDT (≈ 44 000 nudos, ≈ 265 k GDL) | ≈ 3 min (B) | ≈ 10–11 s, heap ≈ 3,5–4 GB, al borde (B) | ≈ 3–4 s (C) |
| V1 h 0,5 (52 262) | 3,7 min sin `descritize` (A), 5–8 min con él (B) | 13,1 s y 4,0 GB; falla a veces (A) | 3,8–5,7 s, ~0,45 GB (C) |
| V2 h 0,5 (63 039) | ≈ 4,5 min sin `descritize` (B) | 21–22 s y 4,0–4,1 GB (A, con carga) | 4,8–7,2 s (C) |
| V1 h 0,35, 16 por vano (113 593) | no cabe (B) | ≈ 27–30 s (B) y 3,8 GB; 49 s con carga (A) | 9,3–13,8 s, ~0,9 GB (C) |
| **V3 unidireccional** (7 514) | 37 s; ≈ 22 s sin `descritize` (A/B) | **1,7 s (A)** | 0,5–0,7 s (C) |

**Portátil y móvil (C: sin medir).**
- **Portátil.** Un procesador de portátil normal (Core i5/i7 serie U/P, Ryzen 5 U) rinde en un hilo un 60–80 % de un 5900X: multiplique los tiempos por 1,3–1,7. Con 8 GB de RAM, una pestaña con 3–4 GB de heap WASM pagina o la mata el navegador. En la vía (b), conviene bajar el tope a ≈ 100 k GDL en equipos de 8 GB.
- **Móvil Android de gama media.** Un hilo rinde un 30–40 % de un 5900X: × 2,5–3,5. Además, el sistema mata pestañas que pasan de 1–2 GB.
- **iPhone reciente.** Un hilo comparable al sobremesa, pero el límite de memoria fiable de Safari es de 0,3–1 GB (H16).
- **En móvil, el edificio objetivo sólo cabe por la vía (c)** (~0,25 GB, 2–8 s). La vía (b) llega a modelos de ≈ 45 k GDL (V3: heap ≈ 0,6 GB), y la (a), a ≈ 1 000–1 500 nudos.

## 8 · Memoria y techo de wasm32

- **Techo medido (A).** `getHeapMax()` = 4 096 MB en Pyodide 314 sobre Node 24, y numpy llega a reservar 3 968 MB en bloques de 64 MiB antes del `MemoryError`. El techo es **4 GiB**, no 2 GiB (`pyo_run.mjs memmax` → `out_pyodide_memmax.txt`). Chrome y Firefox de escritorio admiten memorias wasm32 de 4 GiB (C); Safari en iOS, mucho menos (H16).
- **El heap no baja (A, confirma H16)** y en (b) lo dominan las reservas de SuperLU (§4): 0,6 GB (V3), 1,4–1,7 GB (V1 h 1,0), 2,3–2,8 GB (V1 h 0,75), 3,8–4,1 GB (≥ 300 k GDL).
- **RSS frente a heap.** El RSS real de Node es mucho menor que el heap: 1,3 GB con V1 h 0,5 frente a 4,0 GB de heap. Para el navegador cuenta el heap (espacio de direcciones del módulo), no sólo el RSS.
- **PyNite** mete además los objetos Python: 1,4 GB (9 078 nudos), 1,9 GB (15 807), 3,2 GB (27 526) y 3,9 GB (52 262, sin `descritize`).
- **Conclusión:** el límite de tamaño de (b) es la memoria, no el tiempo. Hay que fijar un tope en GDL (≈ 180–200 k en sobremesa) y reciclar el worker tras cada cálculo grande (H16). Si se quiere pasar de ahí sin reescribir el elemento, el solver tiene que salir a un módulo WASM propio (§6, híbrido).

## 9 · Iterativo: CG precondicionado (opcional, A en CPython)

`exp_pcg.py`, con 1 lado derecho (carga vertical + ruido) y rtol = 1e-8, contra el directo `mmd_sym`. pyamg 5.3 en un venv de Python 3.12 (`venv312`), porque no hay rueda para 3.14.

| K | Método | Iteraciones | Tiempo | Error frente al directo |
|---|---|---|---|---|
| V1 h 1,0 (94 206 GDL) | directo `mmd_sym` (factoriza + resuelve) | – | 1,36 s | – |
| | Jacobi | 2 673 | 5,0 s | 3,8e-10 |
| | Jacobi por bloques 6×6 de nudo | 2 671 | 7,0 s | 3,8e-10 |
| | ILU (drop 1e-3, fill 5), factorización 0,97 s, 6,6 M nnz | no converge en 5 000 | 94 s | 1,6e-3 |
| | ILU (drop 1e-4, fill 10), factorización 1,81 s, 9,7 M nnz | 24 | 0,6 s (+1,8 s) | 4,2e-9 |
| | AMG de agregación suavizada con los 6 modos de sólido rígido y grueso con `splu` (2 niveles) | 30 | 2,5 s (+0,5 s) | 5,0e-10 |
| | Íd. con el grueso por defecto (pseudoinversa densa) | – | abortado al pasar de 3 GB (5,8 GB en el primer intento) | – |
| V1 h 0,5 (312 816 GDL) | directo `mmd_sym` | – | 3,79 s | – |
| | Jacobi | 5 574 | 39,4 s | 3,2e-10 |
| | Jacobi por bloques 6×6 | 5 505 | 47,8 s | 3,2e-10 |

**Lectura.**
- Las láminas del edificio sí convergen con Jacobi, pero en miles de iteraciones, que se duplican al dividir h entre 2. Con un solo caso, Jacobi ya es 4–10 veces más lento que el directo.
- El mejor iterativo (ILU 1e-4 o AMG) iguala al directo con un caso y pierde con 6 o más, porque el directo factoriza una vez y cada caso extra cuesta décimas.
- Un iterativo sólo tendría sentido para salir del techo de memoria, y la vía (c) lo resuelve mejor.
- **No se recomienda** para el MVP.

## 10 · Qué cambia en la investigación previa

| Hallazgo | Cambio |
|---|---|
| **H04** (driver; «~1 500 nudos en < 10 s») | Sigue valiendo para PyNite: con el driver tal cual, ≈ 2 500 nudos en 10 s (con 6 casos). Se añaden tres mejoras medidas: (1) `splu` simétrico (`MMD_AT_PLUS_A`, `diag_pivot_thresh=0`, `SymmetricMode`) en vez de COLAMD, de 3 a 6 veces más rápido con 2–3 veces menos relleno; (2) quitar la búsqueda O(barras × nudos) de `PhysMember.descritize`, que son 135 s con 52 000 nudos; (3) reacciones vectorizadas (K21·D). La recomendación P2 «vectorizar Ke y FER» pasa a **P0**: es la diferencia entre 110 s y 6 s en el edificio objetivo. |
| **H14** (scipy obligatorio) | Se mantiene: la vía (b) vive de `scipy.sparse.linalg.splu`. |
| **H15** (operador lineal de resultados) | Encaja con (b): el mismo ensamblado vectorizado puede construir las matrices 8×24 por quad. |
| **H16** (heap; límite en GDL) | Cifras nuevas: en (b), el heap lo pone SuperLU y no el modelo; tope recomendado ≈ 180–200 k GDL en sobremesa. El techo es de 4 GiB (medido). |
| **H29** (CDT ×1,6 nudos) | El edificio objetivo con CDT a la densidad de H10 son ≈ 44 000 nudos y ≈ 265 k GDL: por encima del tope de (b). O se usa la rejilla alineada en las regiones regulares (vía rápida de H29), o se necesita (c). |
| **H46** (unidireccional como paño de reparto; «más adelante, viguetas como barras») | Las viguetas como barras son **baratas**: 7 500 nudos y 1,7 s en (b). El diafragma por penalización (α = 10³) no estropea la factorización simétrica (residuo 7e-9), pero hunde la MMD con pivoteo (> 5 min). Se puede adelantar al MVP si se usa (b). |
| **S0** (tamaño realista del MVP) | «< 10 s hasta ~1 500 nudos» pasa a **≈ 30 000 nudos / 180 k GDL con la vía (b)**, y a ≈ 100 000 nudos con la (c). El drilling, la dependencia de un solo mantenedor y la memoria en iOS siguen siendo los riesgos. |

## 11 · Ficheros

Todo en `C:\Users\javie\AppData\Local\Temp\claude\d--PROGRAMACION-Concreta-EST\b287d96a-8882-4d7d-800f-3c46ec2b77b4\scratchpad\fem3d\06-escala\`.

| Fichero | Qué es |
|---|---|
| `edificio.py` | Generador paramétrico del edificio (V1/V2/V3, h, plantas, retícula, irregularidad) en un modelo neutro de arrays; `conteos()` |
| `pyn_build.py` | Modelo neutro → `FEModel3D` de PyNite (Y-up, releases de penalización, cargas) |
| `pynite_fast.py` | Driver de H04 con dos opciones añadidas: `permc='SYM'` y guardar K11 |
| `vec_asm.py` | Vía (b): `quad_Ke`, `member_Ke`, FER, ensamblado BSR por `bincount`, `solve` y `solve_lean` (traza del heap) |
| `exp_tamanos.py` → `out_tamanos.txt` | Tabla de tamaños |
| `exp_validar.py` | Ensamblado vectorizado frente a PyNite (K, P−FER, D) |
| `exp_pynite.py` → `out_pynite_cpython.txt`, `out_pynite_pyodide.txt`, `out_pynite_pyodide_rep.txt` | Vía (a) |
| `exp_vec.py` → `out_vec_cpython.txt`, `out_vec_pyodide.txt`, `out_vec_pyodide_lean.txt`, `out_vec_pyodide_rep.txt` | Vía (b) |
| `exp_fact.py` + `run_fact_cpython.sh`, `run_fact_pyodide.sh` → `out_fact_cpython.txt`, `out_fact_pyodide.txt` | Factorización (SuperLU ×4, QDLDL, CHOLMOD supernodal y simplicial, CHOLMOD con BLAS Prescott) |
| `exp_pcg.py` → `out_pcg_V1_h1.0_parcial.txt`, `out_pcg_V1_h1.0_b.txt`, `out_pcg_V1_h1.0_amg.txt`, `out_pcg_V1_h0.5_jacobi.txt` | CG precondicionado |
| `pyo_run.mjs` → `out_pyodide_memmax.txt`, `out_pyodide_blas.txt` | Runner de Pyodide (usa `../01-motor/pyodide-dist`), techo de memoria y BLAS en WASM |
| `blas_core.py` | dgemm/potrf nativos con `OPENBLAS_CORETYPE` |
| `run_pyodide_a.sh`, `run_pyodide_b.sh`, `run_pyodide_lean.sh` | Tandas de Pyodide |
| `resumen.py` | Resume las salidas JSON |
| `K/K11_*.npz` | K11 de V3, V1 h 1,0/0,75/0,5/0,35 y V2 h 0,5 (7–150 MB, CSC sin comprimir) |
| `venv/` (3.14) y `venv312/` (3.12, pyamg) | Entornos; `src320/`, el PyNite 3.2.0 que se monta en Pyodide |

**Reproducir.** `venv/Scripts/python.exe exp_vec.py V1 0.75 7 --sym --permc MMD_AT_PLUS_A` (CPython) o `node pyo_run.mjs script exp_vec.py V1 0.75 7 --sym --lean` (Pyodide). Para la vía (a): `exp_pynite.py V1 0.75 7 --permc SYM --nodesc`.
