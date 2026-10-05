# Fase C2 — compilador de losas: resultado

> **Fecha:** 2026-10-05. **Plan:** `compilador.md` (alcance, decisiones C2-a…C2-h y criterios de C2), que concreta la fase C2: «mallador de losas, validador de malla, huella del pilar, vigas embebidas, `eje1`, peso propio desde `pp`, cargas de superficie y de línea, siembra de las caras y las bandas».
>
> **Veredicto: pasan los nueve criterios; el 8, desde la rejilla alineada de H52 (decisión C2-a, `rejilla.md`).**
> - La placa de Navier descrita como losa física converge a la serie con orden 2 y queda como la rejilla de E3: con h = 0,25, w a 0,17 % y M del centro a 0,46 %.
> - La losa plana de H25 descrita con pilares, huellas y bandas reproduce los cortes de E5 a ≤ 0,37 % con h = 0,15.
> - La malla es la misma al reordenar (bit a bit), al trasladar, al girar 90° o 37°, con un ruido de 1e-8 m y en V8 y JavaScriptCore.
> - El control «sin pérdidas» queda en ~1e-15, y 50 entradas no válidas dan su error con el id físico, sin lanzar.
> - **Criterio 8:** con la triangulación sola, el edificio objetivo tenía 79 649 nudos y 199 983 ecuaciones (×1,6 los ~50 000 nudos de D9). Con la rejilla alineada de H52 en las zonas regulares (2026-10-05, `rejilla.md`) tiene 34 737 nudos y 90 657 ecuaciones, y compila en 0,85 s.
>
> **Hallazgos principales:**
> - **C2-2:** el corte por «campos» de E5 contaba dos veces lo que pasa por los nudos de una malla no estructurada (+38 %), y nadie lo había visto porque E5 sólo usó rejillas. Está corregido en el motor y tiene su regresión.
> - **C2-3 y C2-4:** las metamórficas encontraron que la malla dependía del orden de barrido de delaunator, de un ulp y de un ruido de 1e-8 m, y cuatro fallos silenciosos. Todos están corregidos y tienen su test.
>
> **Cómo leerlo:** la tabla resume los criterios, que se fijaron al empezar la fase. Cada sección da el detalle y la evidencia. Lo que queda para el usuario está en «Decisiones por defecto» y en «Pendiente».

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Oráculo analítico: Navier (delgada y gruesa) como modelo físico; orden ≈ 2 y, con h = 0,25, ≤ 0,5 % en w y M como la rejilla de E3 | **Pasa.** Con h = 0,25: w ≤ 0,18 %; M por SPR en el centro −0,37 / −0,41 % (delgada) y −0,46 / −0,37 % (gruesa), frente a −0,44 / −0,33 y −0,50 / −0,40 de la rejilla. Orden de 0,25 a 0,125: w 1,87–1,90; M por SPR en el interior, 1,97–2,35 | `src/compilador/oraculos-c2.test.ts`; `validacion/c2/out_navier.txt` |
| 2 | Oráculo de E5: la losa plana de H25 como modelo físico, cara (fuerzas nodales) y vano (campos) a ≤ 1 % de la rejilla de E5 | **Pasa** con h = 0,15: los seis valores a ≤ 0,37 %. Con h = 0,3, dos llegan al 1,5 %; con 0,5, Vz de la banda en la cara, +8,7 % (en E5 ese cortante ya variaba un 4 % con la malla) | `oraculos-c2.test.ts`; `validacion/c2/out_losa_plana.txt` |
| 3 | Validador de malla en plantas al azar: todas sus comprobaciones, y la calidad medida | **Pasa.** 24 compilaciones (12 semillas, eje 1 en X y al azar) con losas con huecos y chaflanes, pilares girados y circulares, vigas oblicuas y secundarias, zonas, tabiques, puntuales y bandas. Áreas a 1e-9, normal +Z, jacobiano > 0 y sin nudos sueltos. Jacobiano mínimo 0,049, en «casi encuentros» que se avisan con sus objetos (C2-7) | `losas.test.ts`; `validacion/c2/out_resumen.txt` |
| 4 | Metamórficas: reordenar (bit a bit), trasladar y girar (misma malla), ruido < ε_geom (misma malla), ruido < ε_snap (misma topología) | **Pasa** en 6 semillas. Reordenar: idéntico en modelo, mapeo y diagnósticos. Traslación, giro de 90° y de 37°: la misma malla y u a 2,8e-12, 5,0e-12 y 9,9e-12. Ruido de 1e-8 m: la misma malla. Ruido de ±1,5 cm: la misma topología de C1 y las mismas huellas, con avisos | `metamorficas-c2.test.ts`; `out_resumen.txt` |
| 5 | Sin pérdidas (≤ 1e-9) con la resultante física calculada sin la malla, y equilibrio | **Pasa.** 32 modelos al azar: ≤ 2,9e-15. Equilibrio del motor ≤ 6,6e-13. Edificio objetivo, 1,2e-13 | `losas.test.ts`; `out_resumen.txt`; `out_banco.txt` |
| 6 | Entradas no válidas con su id físico, sin lanzar | **Pasa.** 50 entradas de losas, huecos, apoyos lineales, bandas, cargas de superficie y lineales y opciones; ninguna lanza ni llega a `compilador/error-interno` | `invalidos-c2.test.ts` |
| 7 | La misma malla en V8 y JSC; la huella no depende del orden | **Pasa.** 11 modelos: topología idéntica y coordenadas a ≤ 1e-12 entre Node y Bun. La huella de compilación no depende del orden de las listas y cambia con 1e-9 m en una losa o con h | `huella-c2.test.ts`; `validacion/c2/huellas.ts` |
| 8 | Rendimiento: el edificio objetivo con losa maciza compila en una fracción del cálculo y, con el h por defecto, cabe en D9 | **Pasa** desde la rejilla alineada (2026-10-05, `rejilla.md`): 34 737 nudos y 90 657 ecuaciones; compila en 0,85 s, el 22 % del cálculo (3,8 s). Con la triangulación sola estaba a medias: 79 649 nudos y 199 983 ecuaciones, ×1,6 los ~50 000 nudos de D9 | `validacion/c2/out_banco.txt`; `out_decisiones.txt` |
| 9 | Referencia congelada | **Pasa.** Losa plana, Navier y dos modelos al azar con losas, malla incluida: modelo a 1e-12 y resultados de barras y láminas a 1e-9 con los dos solvers. Generada con Bun y comprobada en Node | `congelado-c2.test.ts` |

---

## 1. Qué hay nuevo

| Fichero | Qué hace |
|---|---|
| `src/compilador/fisico.ts` | Losas (contorno, huecos, espesor, material, `pp`, `eje1`), apoyos lineales, bandas, cargas de superficie y lineales, opción `tamanoMalla` |
| `src/compilador/poligonos.ts` | Áreas y momentos, simplicidad y la integral sobre la intersección de dos regiones por triángulos en abanico: la resultante física sin la malla |
| `src/compilador/arreglo.ts` | Arreglo plano por planta con ε_geom y ε_snap: uniones, trazos doblados, cruces con predicados exactos |
| `src/compilador/mallado.ts` | Siembra graduada, retícula por losa, CDT con empates por perturbación simbólica, división en 3 cuadriláteros y validador de H23 |
| `src/compilador/losas.ts` | Por planta: C2-c, el arreglo, la malla y su unión con huellas, vigas embebidas, apoyos, zonas, líneas y puntos; el diafragma de C2-f |
| `src/compilador/validar.ts`, `piezas.ts`, `cargas.ts`, `compilar.ts`, `mapeo.ts` | Validación de C2; cabeza del pilar con el espesor de la losa, apoyos en losa y diafragma; peso propio y cargas de losa; láminas, enlaces de las huellas, mapeo y versión C2.0 |
| `src/motor/cortes.ts`, `campos.ts` | Corte mixto por campos (C2-2) |
| `src/pruebas/losasAleatorias.ts`, `metamorficasFisicas.ts` | Losas al azar sobre los modelos de C1 y relaciones metamórficas con losas |
| `validacion/c2/` | Navier y losa plana físicas, edificio objetivo con losas, banco, decisiones, huellas, resumen y referencia congelada |

**Uso:** el de C1. El mapeo trae además la losa de cada lámina (`mapeo.laminas`) y las láminas de cada losa (`mapeo.losas`), y las restricciones de las huellas, su pilar.

## 2. Cómo malla C2

- **Un arreglo plano por planta** con todo lo que la malla tiene que respetar, por prioridad: los nudos de C1 (fijos), los ejes de las vigas fuera de las huellas, las huellas, los contornos y huecos, las bandas, las zonas y líneas de carga, los apoyos lineales y los puntos.
  - Un vértice se une al punto o al segmento cercano a ≤ ε_snap. Un punto parte el segmento al que está a ≤ ε_geom, o a ≤ ε_snap si los dos trozos miden más de ε_snap. Los cruces crean puntos.
  - Lo que se mueve más de ε_geom se avisa: la losa, con el área que cambia (C2-b).
- **Siembra graduada:** el paso de cada lado empieza en el tamaño del rasgo más cercano a su extremo y crece con pendiente 2 hasta 2h.
- **Retícula triangular de Steiner por losa,** orientada con su `eje1` y anclada en su vértice canónico, a ≥ 0,45·2h de los lados.
- **CDT** de delaunator y constrainautor. Los empates de Delaunay se deshacen con una perturbación simbólica ligada a los ejes de la primera losa (C2-3).
- Se quedan los triángulos cuyo centroide cae en una losa (los de área de redondeo, no), y cada uno se divide en 3 cuadriláteros con la normal hacia +Z.
- **Validador (H23):**
  - área de cada losa a 1e-9, calculada sin la malla;
  - lados y puntos obligatorios en la malla;
  - jacobiano escalado: error si es ≤ 0, y aviso, con el sitio y los objetos, si baja de 0,2.
- **Unión:**
  - huella rígida de cada pilar (enlace rígido con maestro en su nudo, encadenado al diafragma), que no entra en la malla;
  - vigas partidas en los nudos de su eje fuera de las huellas;
  - diafragma con los nudos sobre las losas;
  - cargas: superficie por lámina, lineal a los nudos de sus aristas, puntual en su vértice.

## 3. Hallazgos de C2

| ID | Hallazgo | Consecuencia |
|---|---|---|
| C2-1 | **El valor bruto del centroide (la media de los 4 puntos de Gauss) converge con orden 1 en los cuadriláteros de C2,** que no son paralelogramos: el peor de la placa de Navier, 2,4 % con h = 0,25, frente al 1,1 % de la rejilla. Los campos recuperados por SPR, en cambio, convergen con orden 2 e igualan a la rejilla: 0,60 % frente a 0,63 % en el peor nudo del interior | En una malla de C2, el valor del centroide no es dato para comprobar. Se comprueba con los campos (`CamposLaminas`) y los cortes, como ya hacían los mapas y las bandas. `modelo.ts` lo dice. H29 había medido sólo el centro, donde ninguna malla lo nota |
| C2-2 | **El corte por «campos» de E5 contaba dos veces lo que pasa por los nudos de una malla no estructurada.** Si el corte atravesaba láminas y además pasaba por vértices (x = 3 en Navier, que cae en la retícula), sumaba las fuerzas nodales de las láminas del lado A que tocan el plano y la integral de las que lo atraviesan: +38 %. En la losa plana, el momento del vano salía un +33 %. E5 sólo lo validó en rejillas, donde no ocurre | Corregido en el motor: un corte que atraviesa alguna lámina va entero por campos, y uno que sigue la malla, por fuerzas nodales (exacto). Las pruebas y la referencia de E5 no cambian. Regresión en `cortes-mixtos.test.ts` |
| C2-3 | **Los empates de Delaunay son la norma en un edificio:** las esquinas de una huella dentro de la losa, la retícula frente a la siembra de un lado, y los 8 vértices de una huella circular. delaunator los resuelve según su orden de barrido, así que una traslación, un giro o un ruido de 1e-8 m cambiaban la malla | Una perturbación simbólica (pesos w = U² + (√2 − 1)·U·V en los ejes de la primera losa) da una triangulación única también con 5 o más puntos cocirculares. El umbral del empate y el de la regla de reserva van con ε_geom. La malla es la misma al trasladar, girar y con ruido |
| C2-4 | **Las metamórficas encontraron cuatro fallos silenciosos más:** el octógono de una huella circular iba en ejes globales y no giraba con el pilar; entre un borde sembrado en una dirección no alineada y la envolvente convexa quedaban triángulos de área de redondeo, que se conservaban como láminas de área nula; un borde que cortaba el eje de una viga a 1e-16 de su extremo daba un tramo de peso de longitud nula; y dos nudos con la misma x salvo un ulp se numeraban distinto en V8 y en JSC | Corregidos, con su test: octógono en los ejes de la huella; triángulos de área ≤ 1e-10·L² descartados; cortes agrupados a ε_geom; numeración por coordenadas cuantizadas a 1e-9 m |
| C2-5 | **Las vigas embebidas y los rasgos pequeños pesan más que la retícula.** El edificio objetivo pasa de los ~37 000 nudos estimados (H52 × 1,6) a 72 425 con siembra uniforme y 79 649 con la graduada. La uniforme dejaba triángulos de ~6° junto a las huellas (jacobiano 0,126; el 3 % de los cuadriláteros por debajo de 0,2) | La siembra graduada no deja ninguno por debajo de 0,2 (mínimo 0,252), con un 13 % más de nudos. El tamaño frente a D9 queda para el usuario (C2-a) |
| C2-6 | **Una huella del modelo analítico a 12 cifras no sirve con decenas de miles de números:** con un ulp de diferencia entre motores, cada número tiene ~2e-4 de probabilidad de caer en la frontera del redondeo | El criterio 7 compara la topología (enteros, exacta) y las coordenadas a 1e-12. La huella de compilación, sobre el modelo físico, no cambia |
| C2-7 | **Un «casi encuentro» (dos líneas casi paralelas a poco más de ε_snap, como el borde de una zona a 6 cm de una viga) deja una franja de elementos aplastados:** jacobiano de hasta 0,05 en los modelos al azar | Es válido (jacobiano > 0), y el aviso dice dónde y junto a qué objetos. Arreglarlo del todo pide refinado local (Ruppert) o unir también las zonas de carga a 3·ε_snap: pendiente |

## 4. Decisiones por defecto (de `compilador.md`), con sus medidas

Medidas en el edificio objetivo con losas reducido a 3 plantas (`validacion/c2/out_decisiones.txt`):

| Decisión | Por defecto | Medida | Para el usuario |
|---|---|---|---|
| C2-a, tamaño de malla | h = 0,75 m con la rejilla alineada de H52 (desde el 2026-10-05) | Con la triangulación sola, frente a h = 0,5: flecha de vano +0,3 % y My de la banda en la cara +0,7 %, con un 38 % menos de nudos; el edificio objetivo entero, 79 649 nudos. Con la rejilla: 34 737 nudos y la cara mejor que con la triangulación del mismo h (`rejilla.md`) | Decidida por el usuario el 2026-10-05; hecha la rejilla (`rejilla.md`) |
| C2-c, borde de losa dentro del ancho de una viga | Error | — | Confirmar el error (frente a un aviso). Obliga a dibujar las losas a ejes |
| C2-f, diafragma con losas | Rígido sobre las losas | El semirrígido da lo mismo en deriva, flecha y cara (+0,1 %), con el doble de ecuaciones y 1,7 veces el tiempo | Sin cambios |
| C1-a con losas | Factor 0,5 | Sigue pesando: entre 0 y 1, la deriva cambia ±20 % y la flecha ±10 %; la cara, ±1,2 % | Sin cambios (decidido en C1) |
| C2-g, peso de vigas bajo losa | Sólo el descuelgue | Evita contar dos veces el 8,6 % del caso G | Confirmar la regla |
| C2-b, C2-d, C2-e y C2-h | Como en el plan | Validadas por los criterios 1 a 5 | — |

## 5. Pendiente

- **Decididas por el usuario el 2026-10-05:** C2-a (h = 0,75 y la rejilla alineada de H52 en las zonas regulares, hecha el mismo día: `rejilla.md`), C2-c (error) y C2-g (sólo el descuelgue).
- **Para más adelante:**
  - refinado local (Ruppert) o unión de las zonas de carga a 3·ε_snap, para los «casi encuentros» (C2-7);
  - losas inclinadas y rampas;
  - cargas lineales variables y zonas con carga variable;
  - el solape del peso del pilar con la losa, y el de las vigas que no son rectangulares de hormigón.
- **De otras fases:** las bandas automáticas y su integración (C5), los muros (C3) y los forjados reticular y unidireccional (C4).
- **Validación externa:** la comparación de losas con un modelo del usuario en SAP2000 (puente de E6), en el periodo «en sombra».
- **Integración con Concreta:** las zonas de «Cargas por planta» todavía no tienen geometría (COM-17). C2 ya admite zonas poligonales; falta dibujarlas.

## Cómo reproducir

```sh
bun run test:run                                       # todos los tests (E0–E6, Fase 1, C1 y C2)
bun validacion/c2/navier.ts                            # criterio 1 → out_navier.txt
bun validacion/c2/losaPlana.ts                         # criterio 2 → out_losa_plana.txt
bun validacion/c2/resumen.ts                           # criterios 3, 4 y 5 → out_resumen.txt
node validacion/c2/banco.ts > validacion/c2/out_banco.txt            # criterio 8 (opcional: h)
node validacion/c2/decisiones.ts > validacion/c2/out_decisiones.txt  # decisiones C2-a, C2-f, C1-a y C2-g
bun validacion/c2/congelar.ts                          # SÓLO a sabiendas: regenera la referencia congelada de C2
```
