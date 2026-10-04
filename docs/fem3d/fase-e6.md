# Fase E6 — endurecimiento: resultado

> **Fecha:** 2026-10-04. **Plan:** S7 de `investigacion-id.md`, fase E6: «ETABS 15, SAP 1-024, modelos SAP2000 del usuario, pruebas metamórficas y rendimiento». También cuentan §5 de `investigacion/08-motor-propio.md` (niveles de validación 4, 6, 7 y 8) y los pendientes de E0–E5 (casos de CSI de barras, memoria JS de E4-1, S5 #1 y #18).
>
> **Veredicto: pasan los cinco criterios; el 2, con la referencia corregida.**
> - Los ejemplos de barras de CSI dan sus 34 valores publicados dentro del redondeo: estática, signos de los esfuerzos de SAP2000, periodos y espectro.
> - Los muros de ETABS 15 coinciden con OpenSeesPy `ASDShellQ4` a ≤ 0,5 % con la misma malla. La membrana con drilling no necesita parche: **S5 #1 queda cerrada.**
> - La referencia de SAP2000 en 15b, 15c y 15d no es la geometría que describe su PDF (**E6-2**). Con el modelado que SAP2000 usó de verdad, el motor reproduce sus 33 cifras a ≤ 1,2 % o dentro de su redondeo.
> - La batería metamórfica pasa sobre 2 000 modelos aleatorios con todos los objetos del motor. En las pruebas de mutación detecta 8 de 9 fallos inyectados, y la suite completa, los 9.
> - De 83 entradas no válidas, ninguna lanza ni da un resultado válido falso. Han aparecido y se han corregido dos fallos silenciosos.
> - La memoria JS de un cálculo baja un 41–45 % sin cambiar un bit, y el motor calcula 88 000 nudos en sobremesa.
>
> **Hallazgo principal (E6-2, E6-3 y E6-4):** una referencia «código contra código» no es una solución convergida. Las tres discrepancias de ETABS 15 salen de decisiones de modelado de SAP2000: una malla gruesa, el diafragma fuera de los dinteles y muros sólo de membrana. Dos de esas decisiones cambian los desplazamientos entre un 20 y un 35 %, y el compilador tendrá que tomarlas a sabiendas.
>
> **Cómo leerlo:** la tabla resume los criterios, que se fijaron al empezar la fase. Cada sección da el detalle y la evidencia. Los hallazgos que cambian algo del plan están en «Hallazgos de E6».

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Barras de CSI (H48): SAP2000 1-004, 1-018 (A–D), 1-022 y 1-024 dentro del redondeo de sus valores publicados; las soluciones cerradas, a ≤ 1e-10 | **Pasa.** 34 de 34 valores dentro del redondeo (en el espectro, ≤ 0,02 %, por la interpolación de la tabla). Cerradas: 1-004, ≤ 2,5e-15; 1-018, ≤ 6,2e-12, salvo B con 1,9e-9, que es su penalización de axil (E6-1) | `src/motor/csi.test.ts`; `validacion/e6/out_csi.txt` |
| 2 | Muros de ETABS 15 (a–f; 1, 3 y 6 plantas): extrapolada a ≤ 2 % de SAP2000 en 6 plantas y ≤ 5 % en 1 y 3; con la misma malla, a ≤ 2 % de `ASDShellQ4` | **Pasa con la referencia corregida.** `ASDShellQ4`: ≤ 0,46 %, y ≤ 1,03 % en los de una planta. Con la geometría del PDF, 15a, 15e y 15f cumplen (≤ 0,9 % en 6 plantas). 15b (+7…+10 %), 15c con dinteles de 240 in (−32 %) y la torsión de 15d (−19…−26 %) no cumplen, porque SAP2000 los calculó con otro modelado. Con ese modelado, las 33 cifras quedan a ≤ 1,2 % o dentro de su redondeo (E6-2) | `src/motor/etabs15.test.ts`; `validacion/e6/out_etabs15.txt` |
| 3 | Metamórficas (H38) sobre modelos aleatorios con todos los objetos: solvers, giro, renumeración, inversiones, superposición, Betti y unidades a ≤ 1e-9; determinismo exacto | **Pasa.** 2 000 modelos, ningún fallo; el peor error, 2,8e-11. Pruebas de mutación: la batería detecta 8 de 9 fallos inyectados y la suite completa, los 9 | `src/motor/aleatorios.test.ts`; `out_aleatorios.txt`, `out_mutaciones.txt` |
| 4 | Entradas no válidas: `calcular` nunca lanza ni da un resultado válido con no finitos; siempre un diagnóstico con código | **Pasa.** 83 entradas (10 rompen el contrato de tipos) sobre hasta 40 modelos cada una: ninguna incumple. Se corrigen dos fallos silenciosos y dos excepciones (E6-7) | `src/motor/entradas.test.ts`; `out_entradas.txt` |
| 5 | Memoria JS (E4-1) un 40 % menor sin cambiar un bit; edificios de ~20 000, 40 000 y 90 000 nudos con tiempos casi lineales fuera de la factorización | **Pasa.** Pico de ArrayBuffer: 271 → 150 MB (−45 %) con diafragma y 313 → 185 MB (−41 %) semirrígido; mismas huellas. 88 000 nudos: 11,4 s (diafragma) y 22,9 s (semirrígido); fuera del solver, exponentes ≤ 1,25 | `out_memoria.txt`, `out_escalado_*.txt` |

Además:
- **Referencia congelada** (regla de oro 1): la de los modelos de E6, con los dos solvers (`src/motor/congelado-e6.test.ts`).
- **Modelos SAP2000 del usuario:** el puente está hecho: importador, comparador y la placa de Navier de S5 #21 lista para importar (`validacion/e6/sap2000/LEEME.md`). Cerrar la comparación necesita que el usuario los calcule en SAP2000.

---

## 1. Qué hay nuevo

| Fichero | Qué hace |
|---|---|
| `src/motor/calcular.ts` | Los vectores de 6 por nudo de cada caso se construyen caso a caso y se sueltan (E6-8). Comprueba las listas que faltan, y cualquier excepción de JavaScript es el error `motor/error-interno`: sólo se propaga una trampa del WASM |
| `src/motor/solucion.ts`, `ensamblado.ts` | El residuo calcula \|K\|·\|x\| sin copiar K (`productoSimetricoAbsoluto`) y sólo guarda R si hay que refinar |
| `src/motor/elementos.ts`, `barras.ts`, `gdl.ts` | Simetría de la matriz de muelle dada, antes de girarla; tipo de carga de barra desconocido; sección, vector de canto y listas que faltan (E6-7) |
| `src/pruebas/aleatorio.ts` | Generador reproducible de edificios irregulares con todos los objetos del motor |
| `src/pruebas/metamorficas.ts` | Batería de 9 relaciones sobre un modelo |
| `src/pruebas/invalidos.ts` | Catálogo de 83 entradas no válidas |
| `src/pruebas/modal.ts` | Periodos por condensación exacta a los GDL con masa y combinaciones espectrales: sólo para validar con los ejemplos de CSI |
| `src/pruebas/transformar.ts` | `escalarModelo` (cambio de unidades) y `fijarEjes`, movido aquí desde la validación de E3 |
| `validacion/e6/` | Ejemplos de CSI, ETABS 15 con su oráculo, batería, mutaciones, entradas, memoria, escalado y referencia congelada |
| `validacion/e6/sap2000/` | Lector y escritor del formato $2k, importador de modelos de SAP2000, comparador de resultados y la placa de Navier (LEEME.md) |

**Cambio de contrato:** un modelo mal formado (un campo obligatorio que falta) ya no lanza. Devuelve el error `motor/error-interno`, y el worker no se recicla. El test de E4 que esperaba `ErrorWorker` se ha actualizado. Las excepciones del worker son ya sólo las trampas del WASM.

## 2. Criterio 1: ejemplos de barras de CSI

Los modelos están en `validacion/e6/csi.ts`, en kN–m (D1), con las fuentes citadas por página.

| Ejemplo | Qué valida | Resultado |
|---|---|---|
| 1-004: voladizo W12X106 con el eje 2 girado 30° | Ejes locales girados, cargas distribuida, puntual y momento | Los 6 valores; solución cerrada (Roark, en ejes principales) a ≤ 2,5e-15 |
| 1-018: pórtico con articulación y deslizadera, modelos A–D | Flexión, cortante (Timoshenko) y axil por separado | Los 4 valores; cerrada (carga unidad) a ≤ 6,2e-12 (D, con I ×1e7), B a 1,9e-9 (E6-1) |
| 1-022: pórtico plano de 7 plantas con diafragmas | Caso LAT: Ux de cubierta, y P y M3 del pilar 1 **con los signos de SAP2000**; 7 periodos; espectro SRSS y CQC | Los 16 valores (el espectro, ≤ 0,02 %) |
| 1-024: pórtico 3D con diafragma rígido y masa excéntrica | 4 periodos acoplados en flexión y torsión; flecha con CQC, SRSS, ABS y NRC 10 % | Los 8 valores |

- **Periodos sin análisis modal.** Las masas sólo están en GDL de los diafragmas, así que condensar la rigidez a esos GDL es exacto. Sale de una solución estática por GDL con masa (`src/pruebas/modal.ts`), y su simetría (Betti) se comprueba a 1e-12. No es el modal de E7: es una forma de validar ya la rigidez con los periodos publicados.
- **La J de 1-024 no está en el PDF.** Con J ≤ 0,5 ft⁴ los 8 valores no se mueven en sus cifras; con 10 ft⁴, cuatro se salen. Peterson (1981) la despreciaría: se usa 1e-6 ft⁴.
- **El espectro necesita g = 386,4 in/s².** Es la de CSI en unidades inglesas; con 9,80665 m/s² todo sale un 0,08 % bajo. El Ux SRSS de 1-022 queda a 0,013 % (1,4 unidades de su última cifra). Su modo 1 (T = 1,2732 s) cae justo después del punto 1,2730 de la tabla y SAP2000 no documenta cómo interpola ahí.

## 3. Criterio 2: muros de ETABS 15

Con el PDF completo (ETABS, «Example 15», rev. 2) se confirma la carga de 100 k, y **S5 #18 queda cerrada**. Los 20 muros están en `validacion/e6/etabs15.ts`:

- tres mallas cada uno (lados de 20, 10 y 5 in, o los que dividen su geometría) y Richardson;
- la variante «modelado de SAP2000»;
- `ASDShellQ4` de OpenSeesPy (`oraculo_opensees.py`) con la malla gruesa.

| Muro | SAP2000 (in) | Motor, extrapolado | Dif. | Modelado de SAP2000 | Dif. | `ASDShellQ4`, misma malla |
|---|---|---|---|---|---|---|
| 15a, 6 plantas (L = 120 / 360 / 720) | 2,4287 / 0,1031 / 0,0186 | 2,4352 / 0,10327 / 0,018670 | +0,27 / +0,16 / +0,38 % | (geometría del PDF) | | −0,20 / −0,09 / −0,09 % |
| 15a, 1 planta | 0,0185 / 0,0029 / 0,0013 | 0,018812 / 0,0029211 / 0,0012617 | +1,7 / +0,7 / −2,9 % | | | −0,10 / −0,82 / −1,03 % |
| 15b, plantas 3 / 2 / 1 | 0,0671 / 0,0530 / 0,0412 | 0,07188 / 0,05756 / 0,04549 | +7,1 / +8,6 / +10,4 % | 0,06721 / 0,05314 / 0,04126 (malla de 20 in) | +0,2 / +0,3 / +0,2 % | ≤ −0,39 % |
| 15c, 6 plantas, Lb = 60 / 240 | 0,0869 / 0,1505 | 0,08604 / 0,10285 | −1,0 / **−31,7 %** | 0,08742 / 0,15154 (20 in, diafragma sin dinteles) | +0,6 / +0,7 % | −0,18 / −0,29 % |
| 15d, 6 plantas: X / RZ / Y | 0,8936 / 0,0191 / 1,1882 | 0,72004 / 0,014159 / 1,1864 | **−19,4 / −25,9** / −0,15 % | 0,89453 / 0,019107 / 1,1895 (muros de membrana) | +0,10 / +0,04 / +0,11 % | −0,34 / −0,46 / −0,06 % |
| 15e, 6 / 3 plantas | 0,2899 / 0,0480 | 0,29124 / 0,048379 | +0,46 / +0,79 % | | | −0,09 / −0,14 % |
| 15f, 6 plantas: X / RZ / Y | 0,3655 / 0,0039 / 0,7490 | 0,36701 / 0,0039296 / 0,75210 | +0,41 / +0,76 / +0,41 % | | | ≤ −0,17 % |

La tabla completa, con los muros de 3 plantas, está en `out_etabs15.txt`.

**Lectura:**

- **Las láminas están bien.** Dos formulaciones independientes, la DKMQ24 con drilling de Hughes–Brezzi y `ASDShellQ4`, dan lo mismo con la geometría del PDF: ≤ 0,46 % en todos los muros de varias plantas, ≤ 1,03 % en los de una.
  - En particular, en el núcleo en C (15d) y el muro en E (15f), que son los que preguntaba S5 #1 («¿cuánto error mete el drilling en núcleos reales de muros y en la torsión de planta?»): el drilling no necesita parche.
- **Las discrepancias con SAP2000 son de modelado y se reproducen todas** (E6-2):
  - 15b se calculó con 2 elementos en el ancho de cada pilar, como se ve en su figura;
  - 15c, con esa malla y con el desplazamiento lateral igualado sólo en los machones;
  - 15d, con muros sólo de membrana.
- **15d y 15f no se modelaron igual en SAP2000.** El muro en E sólo cuadra con lámina completa (+0,2 %); con membrana, X sale +4,7 %.

## 4. Criterio 3: metamórficas sobre modelos aleatorios

**El generador** (`src/pruebas/aleatorio.ts`) fabrica edificios de 1 a 3 plantas y de 2 × 2 a 3 × 3 pilares, con luces y alturas al azar, sobre los que pone al azar:

- **Barras:** secciones, Timoshenko o Euler–Bernoulli, ejes, offsets, liberaciones y modificadores.
- **Base:** empotramientos, muelles a tierra con ejes, y muelles 6 × 6 entre nudos coincidentes contra un nudo empotrado.
- **Forjados de láminas:** malla conforme, cuadriláteros distorsionados, normal arriba o abajo, eje 1, multiplicadores y opciones de membrana.
- **Muros:** paños de 2 × 2.
- **Restricciones:** diafragmas con maestro auxiliar o en un pilar, y huellas encadenadas al diafragma.
- **Cargas:** todos los tipos, e impuestos.

Los modelos son estables por construcción: los 2 000 salen válidos y sin ningún aviso.

**La batería** (`src/pruebas/metamorficas.ts`): en cada modelo se comparan nueve relaciones.

| Relación | Peor error en 2 000 modelos |
|---|---|
| Núcleo (faer) = solver de perfil | 7,3e-12 |
| Determinismo (dos cálculos seguidos) | 0 (bit a bit) |
| Giro + traslación (alrededor de Z con diafragmas o impuestos) | 1,8e-11 |
| Renumeración de nudos, elementos y nudo inicial de las láminas | 2,4e-11 |
| Inversión de las barras (i ↔ j) | 2,0e-12 |
| Inversión del orden de nudos de las láminas | 2,8e-11 |
| Superposición de todos los tipos de carga e impuestos | 2,6e-12 |
| Betti con cargas nodales | 1,9e-15 |
| Unidades: kN–m → N–mm (busca tolerancias absolutas escondidas) | 2,0e-11 |

**Pruebas de mutación** (`validacion/e6/mutaciones.ts`): se inyectan 9 fallos plausibles en el código del motor, uno a uno, y se pasan 200 modelos aleatorios y la suite.

| Mutación | Batería | Suite |
|---|---|---|
| M1: signo del término de giro del diafragma | La rechaza el motor (equilibrio) en 138/200 | 50 tests fallan |
| M2: signo de θ × r en el enlace rígido | Motor, 130/200 | 58 |
| M3: Φ de Timoshenko a la mitad | **No la detecta** | 25 |
| M4: θ × d mal en la recuperación con offsets | Giro, 198/200 | 26 |
| M5: cargas globales de barra pasadas a locales con Rᵀ | Motor, 183/200 | 24 |
| M6: ley lineal al revés en una carga de línea de lámina | Motor, 119/200 | 43 |
| M7: ejes de muelle traspuestos | Giro, 195/200 | 9 |
| M8: esfuerzos de barra con las cargas del primer caso | Superposición, 193/200 | 21 |
| M9: ejes 1 y 2 intercambiados en las cargas locales de lámina | Inversión de láminas, 184/200 | 10 |

La batería caza los fallos de cinemática, transformación y combinación. Un error de formulación coherente (M3) cumple todas las simetrías: lo cazan los oráculos (E6-6).

## 5. Criterio 4: entradas no válidas

El catálogo (`src/pruebas/invalidos.ts`, 83 entradas) estropea un dato de un modelo aleatorio válido:

- **Nudos:** NaN, infinito, coordenada que falta.
- **Barras:** índices fuera de rango, negativos, repetidos o decimales; propiedades nulas, negativas o NaN; vector de canto nulo, paralelo o corto; offsets que se comen la barra; liberaciones inestables; modificadores nulos.
- **Láminas:** 3 nudos, nudo repetido, ν = 0,5, orden cruzado, alabeo, eje 1 normal o NaN, multiplicador negativo.
- **Muelles:** k corta, negativa, asimétrica o NaN; ejes zurdos o no ortonormales; muelle entre nudos separados.
- **Apoyos y restricciones:** apoyos fuera de rango; sin apoyos; apoyo en un esclavo; restricciones con maestro inexistente, esclavo doble, otra cota, tipo desconocido o ciclo.
- **Cargas:** fuera de su objeto, NaN, de otra longitud, de tipo o ejes desconocidos; impuestos sin apoyo o en un GDL inexistente; carga en un GDL sin rigidez.
- **Modelo:** vacío o sin casos.

Cada entrada se aplica a todos los modelos 1…40 que tienen el objeto. Ninguna lanza. Todas dan su error con código, y las inocuas, como el modelo vacío o un caso sin cargas, dan un resultado válido en equilibrio.

## 6. Criterio 5: memoria y escalado

**Memoria JS** (`validacion/e4/memoria-js.ts`, edificio objetivo, 24 casos, `gc()` antes de medir cada fase):

| Variante | Fase | ArrayBuffer antes → después | RSS antes → después |
|---|---|---|---|
| Diafragma | cargas | 163 → 65 MB | 481 → 414 MB |
| | residuo | 209 → 59 MB | 653 → 531 MB |
| | recuperación (pico) | 271 → 150 MB | 752 → 642 MB |
| | resultado vivo | 243 → 125 MB (el resultado ocupa 111) | 725 → 609 MB |
| Semirrígido | residuo | 313 → 120 MB | 993 → 828 MB |
| | recuperación (pico) | 279 → 185 MB | 1 018 → 923 MB |

Las huellas de los resultados del edificio objetivo no cambian (`697c0376dc704188` con diafragma y `210f09f58fe8a595` semirrígido). Los tiempos tampoco.

**Escalado** (`validacion/e6/escalado.ts`, el edificio objetivo con 7 a 14 elementos por vano, un proceso por tamaño):

| Nudos | Diafragma: ecuaciones, tiempo, maxRSS | Semirrígido: ecuaciones, tiempo, maxRSS |
|---|---|---|
| 22 500 | 56 000; 2,4 s; 0,56 GB | 112 000; 3,7 s; 0,74 GB |
| 29 200 (objetivo) | 76 000; 3,1 s; 0,68 GB | 152 000; 5,5 s; 0,93 GB |
| 45 300 | 124 000; 4,8 s; 0,95 GB | 249 000; 9,0 s; 1,38 GB |
| 65 000 | 183 000; 8,0 s; 1,26 GB | 367 000; 15,7 s; 2,01 GB |
| 88 100 | 253 000; 11,4 s; 1,69 GB | 506 000; 22,9 s; 2,65 GB |

Exponentes del tiempo frente a los nudos (diafragma; semirrígido):

- **fases del motor:** numeración 0,96; 0,93 · cargas 0,89; 0,79 · patrón 0,91; 1,10 · ensamblado 1,07; 1,12 · recuperación 1,25; 1,22;
- **solver:** análisis simbólico 1,75; 1,21 · factorización 1,49; 1,69 · resolución 1,25; 1,38;
- **total:** 1,16; 1,32.

Ninguna fase del motor en TypeScript es cuadrática.

## Hallazgos de E6

| ID | Hallazgo | Consecuencia |
|---|---|---|
| E6-1 | **Los modificadores enormes con que SAP2000 «ignora» una deformación son penalizaciones.** En 1-018 B, el axil ×1e5 pierde 8,2 cifras en la deslizadera y el motor rechaza el cálculo por equilibrio (1,1e-9) con el núcleo; con el solver de perfil queda en 8,5e-10. El motor no admite modificadores nulos (el 0 de SAP2000 para el cortante) | El compilador nunca traduce «ignorar» como un modificador enorme: el cortante ignorado es Av ausente, y lo rígido, un enlace rígido o un diafragma (H07, regla de oro 4) |
| E6-2 | **La referencia de SAP2000 de ETABS 15 no es la geometría que describe el PDF:** malla de 20 in en 15b (la convergida es un 7–10 % más flexible) y en 15c; desplazamiento lateral igualado sólo en los machones en 15c; muros sólo de membrana en 15d. Además, los pies de las figuras 15-8 y 15-9 están cambiados | Una referencia «código contra código» se reproduce con su modelado antes de usarla; si no, no es referencia. S5 #1 queda cerrada por el oráculo independiente |
| E6-3 | **Un diafragma rígido sobre el canto superior de los dinteles rigidiza mucho el muro acoplado:** el desplazamiento de cabeza baja un 35 % (rigidez ×1,5) con dinteles de 240 in y un 7 % con los de 60 in, porque el diafragma impide que su fibra superior se alargue | Nueva decisión del compilador: qué nudos de un muro entran en el diafragma de la planta (o diafragma semirrígido en esas plantas). Hay que documentarla al comparar con ETABS o CYPE |
| E6-4 | **En los núcleos abiertos, la torsión de Saint-Venant de la flexión de placa pesa:** el 26 % de la rigidez a torsión de 15d de 6 plantas (X un 19 % menor). Los muros sólo de membrana la pierden | Las láminas del motor la tienen; al comparar con un programa que modela los muros como membrana, la torsión de planta saldrá distinta |
| E6-5 | **La membrana con drilling coincide con `ASDShellQ4` a ≤ 0,5 % en muros, muros con huecos y núcleos** | S5 #1 cerrada: no hace falta el parche de D10 |
| E6-6 | **La batería metamórfica no ve los errores de formulación coherentes** (M3), y sí los de cinemática, transformación y combinación | Los oráculos (PyNite, OpenSees, cerradas, CSI) siguen siendo imprescindibles para todo elemento nuevo; las metamórficas, para todo lo demás |
| E6-7 | **Dos fallos silenciosos corregidos:** una matriz de muelle no simétrica con ejes se daba por buena (al girarla se simetrizaba antes de comprobarla) y una carga de barra de tipo desconocido se aplicaba como distribuida. Además, una barra sin sección o sin vector de canto lanzaba un `TypeError` | Las entradas no válidas se prueban con un catálogo, no caso a caso |
| E6-8 | **La memoria JS evitable eran los vectores por caso y la copia de \|K\|.** Pico de un 41–45 % menor con los mismos bits; lo que queda vivo tras el cálculo baja de 243 a 125 MB | Más margen en los móviles con menos memoria (el iPhone 13 Pro ya calcula el semirrígido, E4-9); lo que queda es el resultado (111 MB) y el modelo |
| E6-9 | **El motor calcula 88 000 nudos en sobremesa** (11,4 s con diafragma; 22,9 s y 2,65 GB semirrígido). Fuera del solver, todo es casi lineal | El edificio objetivo (D9) tiene un margen de ×3 en sobremesa; en el móvil, el perfil medido queda en 200 000 ecuaciones (E4-9) |
| E6-10 | **Erratas de las fuentes:** en 1-004, el momento del caso 3 es alrededor de +Y (el texto dice Z); en 1-022, el A de W24X110 es 2,5 in² (no influye); los espectros de CSI usan g = 386,4 in/s² | Citadas en `validacion/e6/csi.ts` |
| E6-11 | **SAP2000 v21 aplica los multiplicadores de flexión como el motor** (D' = S·D·S, con el término de Poisson por √(m11·m22)), **pero su Shell-Thick da cortantes y reparto de reacciones lejos de la solución exacta.** En la placa de Navier ortótropa (2026-10-04), frente a Navier: momentos de los centroides, motor ≤ 0,17 % y SAP2000 ≤ 1,0 %; w del centro, 0,01 % y 0,27 %; V13 y V23, motor ≤ 0,9 % y SAP2000 hasta un 21 % (también en el interior); reacción de los lados x, exacta 108,2 kN, motor 108,9 y SAP2000 134,0. La hipótesis contraria (Poisson sin escalar) daría ~9 % en los momentos | D3 queda validada en flexión. Falta saber si lo del cortante viene de v13 y v23 o es propio del Shell-Thick: se separa con tres variantes de la placa (isótropa, sólo flexión, sólo cortante; `validacion/e6/sap2000/navier.ts`). Hasta entonces, el cortante de las losas no se compara con el de SAP2000 en el periodo en sombra, sino con el corte por fuerzas nodales (E5-3) |

## Pendiente

- **Del usuario:**
  - La placa ortótropa de Navier ya está calculada en SAP2000 (E6-11, `validacion/e6/sap2000/out_navier_sap.txt`). Faltan las tres variantes que separan el cortante (isótropa, sólo flexión, sólo cortante) y, después, el reticular con ábacos y el unidireccional con viguetas (LEEME.md).
  - Medir un móvil con menos memoria que el iPhone 13 Pro (E4-9).
- **El importador de SAP2000** ya lee un fichero exportado por SAP2000 v21 (el de la placa de Navier: hubo que ignorar los materiales por defecto no isótropos que no se usan). No traduce:
  - puntos de inserción distintos del centroide;
  - cargas «uniform to frame»;
  - áreas de 3 nudos y malla automática de áreas.

  Si alguno de los modelos del usuario los usa, se añaden.
- **Para el compilador:** E6-1 (nada de penalizaciones) y E6-3 (diafragma y dinteles).
- **E7 (opcional):** modal, temperatura y triángulos. Las comprobaciones de 1-022 y 1-024 con espectro ya están, sobre periodos condensados.
- **Membrana ortótropa frente a un oráculo** (pendiente de E3): `ASDShellQ4` con un material ortótropo equivalente (E1 = f11·E, E2 = f22·E, ν12 = ν·√(f11/f22), G12 = f12·G) lo cerraría.
- **Ordenación por plantas** (pendiente de E1): el escalado no la pide.

## Cómo reproducir

```sh
bun run test:run                                      # todos los tests (E0–E6 y Fase 1): 571
bun validacion/e6/resumen-csi.ts                      # criterio 1 → out_csi.txt
bun validacion/e6/modelos-oraculo.ts                  # exporta los muros de ETABS 15 para el oráculo
.venv312/Scripts/python.exe validacion/e6/oraculo_opensees.py   # → src/motor/__fixtures__/opensees-e6.json
bun validacion/e6/resumen-etabs15.ts                  # criterio 2 → out_etabs15.txt (~1 min)
bun validacion/e6/aleatorios.ts 2000                  # criterio 3 → out_aleatorios.txt
bun validacion/e6/mutaciones.ts                       # pruebas de mutación → out_mutaciones.txt (~4 min; árbol limpio)
bun validacion/e6/entradas.ts                         # criterio 4 → out_entradas.txt
node --expose-gc validacion/e4/memoria-js.ts 0.75 diafragma 24  # memoria JS por fase (criterio 5)
node validacion/e6/escalado.ts diafragma              # escalado → out_escalado_diafragma.txt (también «semirrigido»)
bun validacion/e6/sap2000/navier.ts                   # placa de Navier para SAP2000 (LEEME.md)
bun validacion/e6/congelar.ts                         # SÓLO a sabiendas: regenera la referencia congelada de E6
```
