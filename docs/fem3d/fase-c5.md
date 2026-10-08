# Fase C5 — compilador: bandas, machones, dinteles y consultas: resultado

> **Fecha:** 2026-10-08. **Plan:** `compilador.md` (alcance, decisiones C5-a…C5-g y criterios de C5), que cierra el compilador: «las bandas de dimensionado de las losas pasan de sembrarse a proponerse e integrarse; los machones y dinteles de los muros salen como cortes; y los resultados se consultan por objeto físico».
>
> **Veredicto: pasan ocho de los nueve criterios; el 8 (rendimiento) queda a medias.**
> - **Bandas.** La propuesta del Anejo I da los anchos y las bandas que faltan en las retículas de prueba, con pilares desplazados, voladizos, ábacos y huecos, y respeta las bandas editadas. En la losa plana de H25, la banda de pilares lleva el 78,2 % del momento en la cara (la rejilla fina de E5, el 78,3 %) y converge a −0,4 %. En una línea de caras, la suma de las bandas es el corte de toda la losa a ≤ 1e-9, también con pilares de tamaños distintos y con un hueco.
> - **Caras de los apoyos (C5-g, decidida por el usuario: opción A).** En un edificio real, sembrar la cara de cada pilar rompía la malla (C5-1). Ahora cada línea de pilares tiene una cara común, que se siembra entera y sin moverla. En el edificio objetivo con losa plana, las 536 caras dan corte exacto con 8 998 nudos por planta (C5.2 daba 19 611 y 32 caras sin corte). El corte de un pilar mayor cae dentro de su huella, del lado seguro: un 5,7 % más de momento con 5 cm y un 14 % con 10 cm.
> - **Machones y dinteles.** Los del muro acoplado de ETABS 15c coinciden con OpenSeesPy ASDShellQ4 a ≤ 1,4 % con h = 10 in, y en cada planta suman la carga a ≤ 3e-12.
> - **Consultas.** Por objeto físico, con las combinaciones del generador CTE/NCSE y envolventes que guardan la combinación que gobierna. Dan lo mismo que llamar a mano a `EsfuerzosPiezas`, `Cortes` o `CamposLaminas`.
> - **Robustez.** Las bandas no válidas dan su diagnóstico con el id físico. La propuesta y la malla con sus caras son las mismas en V8 y en JavaScriptCore, también con la planta girada 37°. Sin caras de banda, la malla de C1–C4 no cambia ni un bit.
> - **Rendimiento (a medias).** En el edificio objetivo de 7 plantas, proponer cuesta 0,03 s y las consultas 0,3–0,4 s. Integrar las 5 628 estaciones con Wood–Armer en las 26 combinaciones ELU cuesta 5,5 s con losa plana y 8,5 s con vigas, frente a 4,6 y 7,1 s del cálculo: lo de C5 es ~1,26 veces el cálculo, no una fracción. Lo que queda es la recuperación SPR de los campos (C5-4).
>
> **Hallazgos principales:**
> - **C5-1:** con pilares que cambian de tamaño de 5 en 5 cm (lo habitual), las caras de C5.2 quedaban a ε_snap de las esquinas de los pilares vecinos y el arreglo las doblaba. Además mataban las plantillas de la rejilla.
> - **C5-3:** el momento en la cara de un pilar depende de la malla bastante más que el resto: ±1 % de media entre h = 0,75 y 0,375, y hasta un 14 % en alguna cara.
> - **C5-4:** cada corte recorría todo el modelo. Con un índice espacial y reutilizando lo calculado, una estación pasa de 13 ms (una planta) a ~1 ms (siete), con el mismo resultado bit a bit. Lo que queda es recuperar los campos SPR en casi toda la losa, caso a caso.
>
> **Cómo leerlo:** la tabla resume los criterios, que se fijaron al empezar la fase. Cada sección da el detalle y la evidencia. Lo que queda para el usuario está en «Decisiones por defecto» y en «Pendiente».

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Bandas propuestas frente a un cálculo a mano: retícula regular, pilares desplazados (≤ τ y > τ), voladizo, reticular con ábacos > lx/3, hueco que corta una banda, bandas editadas | **Pasa.** Anchos lx/4 por lado y centrales; un pilar a 0,2 m sigue en su alineación y a 0,8 m forma otra; el voladizo llega al borde; los ábacos dan el ancho. Un hueco que tapa una central entera y 0,25 m de las de pilares: cada estación da su ancho en losa, y la que cae entera en el hueco no vale (aviso). Una banda movida y ensanchada y otra nueva quedan tal cual en la malla y en sus estaciones. Caras comunes con pilares de 30, 40 y 70 cm y uno desplazado | `bandas.test.ts`, `esfuerzosBandas.test.ts` |
| 2 | Integración exacta: una línea de caras suma el corte de toda la losa (≤ 1e-9); el trozo entre caras en equilibrio (≤ 1e-9); H25, reparto y convergencia | **Pasa.** Suma de las bandas en una línea de caras = corte de toda la losa a ≤ 1e-9, con pilares iguales, mezclados (30 y 40, las 84 caras válidas, 16 plantillas) y con un hueco. El trozo de losa entre las caras de un vano, en equilibrio con su carga a ≤ 1e-9 (ΣFz y ΣMy). H25: −204,7 kN·m en la banda de pilares frente a −205,58 de la rejilla fina (−0,4 %), 78,2 % del pórtico virtual | `esfuerzosBandas.test.ts`; `validacion/c5/out_bandas.txt` |
| 3 | Wood–Armer: por combinación, envolvente, (a) frente a (b) en H25 y en un reticular | **Pasa.** (a) por combinación es `woodArmer` de su combinación de casos y la envolvente guarda el máximo y su combinación. En la cara del pilar central, (a) es estable al refinar (68,0 → 68,2 kN·m/m en H25; 115,7 → 115,6 en el reticular 30+5 con ábacos) y (b) crece (88,7 → 91,4; 159,6 → 162,6): el pico junto al pilar es singular (C5-c). En el vano coinciden | `esfuerzosBandas.test.ts`; `out_bandas.txt` |
| 4 | Machones y dinteles: suma = corte de la planta; muro en voladizo con hueco frente a la estática; ETABS 15c | **Pasa.** Suma de los machones = corte de todo el muro y = estática a ≤ 1e-9. ETABS 15c (3 y 6 plantas, dinteles de 60 y 240 in) frente a OpenSeesPy ASDShellQ4 con los mismos cortes calculados en Python: con h = 10 in, todas las componentes a ≤ 1,4 % (machones ≤ 0,73 %); con h = 20 in, hasta un 5,9 % en el axil de la cabeza del machón junto a la esquina del hueco. En cada planta, los machones suman la carga a ≤ 3e-12 | `esfuerzosMuros.test.ts`, `etabs15c.test.ts`; `validacion/c5/out_etabs15c.txt` |
| 5 | Consultas: lo mismo que a mano (≤ 1e-12), combinaciones, envolventes, unidades y signos | **Pasa.** Pilar y ménsula a mano, vigas por vanos con sus caras, máximos exactos del diagrama combinado, reacciones en equilibrio, plantas y desplomes, flechas por recuadro, viguetas, combinaciones del generador | `consultas.test.ts` |
| 6 | Entradas no válidas con su id físico, sin lanzar | **Pasa.** Banda en una planta sin losa (`banda/sin-losa`) o entera fuera (`banda/fuera-de-losa`): error; con menos de la mitad dentro: aviso. Ancho nulo y planta inexistente (catálogo de C2). Consultas a objetos que no existen, factores mal dados, casos sin acción, acciones no válidas | `bandas.test.ts`, `consultas.test.ts`, `invalidos-c2.test.ts` |
| 7 | Determinismo y huella | **Pasa.** La propuesta no depende del orden; trasladar y girar 90° o 37° da la misma malla transformada, con sus plantillas; la huella incluye las bandas (ancho, apoyos, origen) y no su orden; V8 y JSC dan la misma propuesta y la misma malla (cinco modelos, uno girado 37°) | `huella-c5.test.ts`; `validacion/c5/huellas.ts` |
| 8 | Rendimiento: proponer, integrar las bandas en todas las combinaciones y consultar cuesta una fracción del cálculo | **A medias.** Proponer 0,03 s y consultas 0,3–0,4 s (fracciones). Integrar las 5 628 estaciones de 238 bandas con Wood–Armer en 26 combinaciones: 5,5 s con losa plana (cálculo, 4,6 s) y 8,5 s con vigas (7,1 s). En total, ~1,26 veces el cálculo (C5-4) | `validacion/c5/out_banco.txt` |
| 9 | Referencia congelada | **Pasa.** Pilares mezclados con hueco y acciones, reticular de H25 con ábacos, ETABS 15c-3-60 y un modelo al azar: bandas, modelo con sus caras a 1e-12, resultados y estaciones, Wood–Armer, machones, dinteles y consultas a 1e-9 | `congelado-c5.test.ts` |

---

## 1. Qué hay nuevo

| Fichero | Qué hace |
|---|---|
| `src/compilador/fisico.ts`, `validar.ts` | `Banda.tipo`, `origen` y `apoyos`; `CasoFisico.accion`; validación de bandas (esquema, planta sin losa, fuera de la losa) y de acciones; `FRACCION_MINIMA_BANDA` |
| `src/compilador/bandas.ts` | `proponerBandas` (C5.1) y las caras comunes de cada línea de pilares (`carasComunes`, C5-g) |
| `src/compilador/estaciones.ts`, `esfuerzosBandas.ts` | Estaciones de una banda (caras y vanos) y sus esfuerzos: corte exacto en las caras, por campos en los vanos; ancho en losa, momentos medios, momento por nervio en un reticular, Wood–Armer (a) y (b) por combinación, y el reparto entre bandas (C5-d) |
| `src/compilador/arreglo.ts`, `rejilla.ts`, `mallado.ts`, `losas.ts` | Trazos exactos (las caras de las bandas); plantillas de pilar que crecen una celda por una cara de banda; sin caras de banda, la malla de C2–C4 no cambia |
| `src/compilador/esfuerzosMuros.ts` | Machones y dinteles como cortes (C5.3), con la definición de cada corte |
| `src/compilador/consultas.ts`, `envolventes.ts` | Consultas por objeto físico (C5.4), combinaciones (C5-f), `combinar` y `envolvente` |
| `src/compilador/poligonos.ts` | La parte de un segmento dentro de unas regiones |
| `src/motor/indice.ts`, `cortes.ts`, `campos.ts` | Índice espacial de los cortes, lado de los nudos al pedirlo y fuerzas guardadas por casos; campos SPR reutilizados entre cortes (C5-4). Mismo resultado bit a bit |
| `validacion/c5/` | Bandas en H25 y en el reticular, caras comunes frente a la cara de cada pilar, tamaño de la malla, ETABS 15c con su oráculo de OpenSees, huellas, banco y referencia congelada |

**Uso:**
- `proponerBandas(fisico)` da las bandas, que se guardan en el modelo físico (C5-a) y luego se compilan como cualquier otra.
- `new Consultas(fisico, compilado, casos)` responde por objeto: `pilar`, `viga`, `vano`, `diagrama`, `banda`, `reparto`, `machones`, `dinteles`, `reacciones`, `planta`, `desplomes`, `flechas` y `combinaciones`.
- Lo lineal se da por caso y se combina con `combinar` y `envolvente`; lo que es un máximo sobre una región se pide para una combinación.

## 2. Cómo se hacen

**Bandas** (D5, Anejo I del EC2): las del plan (`compilador.md`, C5.1).
- **Caras comunes (C5-g).** Los pilares de una misma línea transversal (sus huellas se solapan a lo largo de la banda) comparten sus dos caras, la más interior de cada lado. Un pilar entra en el grupo mientras la cara común quede, a cada lado, a no menos de la mitad de su semiextensión desde su eje: con los ejes alineados, mientras no pase del doble del menor.
- **Trazos exactos.** Las caras se siembran como trazos exactos del arreglo: sus vértices sólo se unen a lo que está a ≤ ε_geom, y no parten ni se parten más allá. Así una cara no se dobla hacia la esquina de un pilar a 5 cm. El cruce de dos trazos normales tampoco se une a un punto exacto a más de ε_geom, para no doblar la huella de un pilar.
- **En la rejilla,** las caras son líneas (largas, de toda la planta). Una cara sobre una línea del borde del bloque de una plantilla hace crecer el bloque una celda, y la cara va por dentro. El punto medio de una celda ganada así, o el de una arista que recorre un lado dentro de la huella, es el de la arista de la rejilla, para que el lado siga entero por la red.

**Estaciones e integración** (C5.2):
- En las caras, corte por fuerzas nodales (exacto); en los vanos, por campos.
- mx = My/b, con b el ancho de la banda en losa en esa estación (sin huecos ni lo que se sale). my y mxy son medias de muestras: en un vano, las de su corte; en una cara, las de un corte a 1 mm.
- En un reticular, el momento por nervio My·s/b y la parte del ancho en ábacos.
- El reparto (C5-d) suma, en cada línea de caras y de vanos, los momentos de las bandas de pilares y de las centrales. Avisa si la parte de las de pilares sale de la tabla I.1, sólo cuando las dos sumas tienen el signo de la tabla.

**Machones y dinteles** (C5.3) y **consultas** (C5.4): las del plan, ya descritas en `compilador.md`.

## 3. Hallazgos de C5

| ID | Hallazgo | Consecuencia |
|---|---|---|
| C5-1 | **La cara de cada pilar (C5.2) rompía la malla de un edificio real.** En la losa plana del edificio objetivo (80 pilares de 30 × 50 girados y 40 × 40): 19 611 nudos frente a 6 409 con sólo los bordes de las bandas, ninguna plantilla de pilar, jacobiano mínimo 0,134 y 32 de 536 caras sin corte. Dos causas. Las semiextensiones de los pilares de una línea difieren en 5 cm (ε_snap), y el arreglo unía la cara de uno con la esquina del vecino y la doblaba. Y una cara sobre una línea del borde del bloque de una plantilla la anulaba. En H25 no se veía: sus pilares son iguales | C5-g, opción A del usuario: cara común por línea, trazos exactos y plantillas que crecen. 8 998 nudos, 75 de 80 plantillas, 536 caras válidas |
| C5-2 | **Cortar las caras por campos no vale.** −5 a −17 % en la maciza y más del 100 % en el reticular junto a las vigas (E5-5 ya lo avisaba) | Las caras se siembran; los campos, sólo en los vanos |
| C5-3 | **La cara común es conservadora, y el momento en una cara depende de la malla.** Frente a la cara de cada pilar: con la cara común 5 cm dentro de la huella, el momento de apoyo sale un 5,7 % mayor de media (3,3–12,3 %); con 10 cm, un 14,6 % (11,2–23,9 %). Ninguna cara queda del lado inseguro. En las caras donde coinciden, la malla de h = 0,75 queda a +0,6 % de media de la de h = 0,375, de −3,8 a +14 % según la cara | `CARA_COMUN` = 0,5 (pendiente del usuario, §4). La convergencia en las caras va al informe de la validación «en sombra» |
| C5-4 | **Cada corte recorría todo el modelo**, y los campos SPR se recalculaban en cada corte: 13 ms por estación en una planta, 13 veces el cálculo, y con 7 plantas el coste crecía con el cuadrado | Índice espacial (`indice.ts`), lado de los nudos al pedirlo, fuerzas de elementos y restricciones guardadas, evaluador SPR y operador de resultantes reutilizados, y sin crear arrays en lo que se pide para todas las barras. Mismo resultado bit a bit en 1 740 estaciones de bandas, machones y dinteles. ~1 ms por estación con 7 plantas. Lo que queda: los cortes de las estaciones tocan el 93 % de las láminas, así que recuperan los campos SPR de casi toda la losa en cada caso. Con 4 casos, ~1,26 veces el cálculo |
| C5-5 | **mxy no es T/b.** El plan lo decía, pero el T del corte lleva también el momento del cortante por su brazo, ∫(mxy + y·Qx) dy. El código ya usaba la media de las muestras | Corregido el plan |
| C5-6 | **Una banda que cruza un hueco usaba su ancho entero en mx.** En el edificio objetivo, el hueco de la escalera tapa entera la estación de vano de una central | Ancho en losa por estación; una estación sin losa no vale y avisa (`banda/estacion-sin-losa`) |
| C5-7 | **En el muro acoplado, la cabeza del machón junto a la esquina del hueco es lo más sensible a la malla:** con h = 20 in, su axil difiere un 5,9 % de ASDShellQ4; con 10 in, ≤ 0,4 % | Con h = 10 in (el test), todas las componentes quedan a ≤ 1,4 % |
| C5-8 | **El índice espacial fallaba con muelles** (elementos sin caja): sus NaN entraban en los límites de la rejilla. Lo pararon los tests del motor (E5) | Corregido, con un test del índice frente a la búsqueda exhaustiva |
| C5-9 | **Una banda editada a menos de ε_snap de otra línea se une a ella,** como cualquier geometría (C2-b): un borde movido a 5 cm del de la central vecina queda en el de la central | Es la regla de C2; se dice en el test de las bandas editadas |
| C5-10 | **El reparto de la tabla I.1 sólo tiene sentido con negativos en las caras y positivos en los vanos.** En las caras de los pilares de borde de H25 (articulados en cabeza) no hay negativo, y junto a una fachada las centrales van en positivo: la «fracción» salía de 59 a 108 % | Sólo se compara cuando las dos sumas tienen el signo de la tabla. H25: 79–80 % en las caras y 55–56 % en los vanos. Pilares mezclados: un aviso (82,8 %) |

## 4. Decisiones por defecto (de `compilador.md`), con sus medidas

| Decisión | Por defecto | Medida | Del usuario |
|---|---|---|---|
| C5-a, bandas automáticas | Una propuesta que se guarda en el modelo físico | Las C2–C4 sin bandas no cambian | — |
| C5-b, τ | máx(ε_snap, 0,1·S) | Pilar a 0,2 m dentro de la alineación, a 0,8 m fuera | — |
| C5-c, Wood–Armer | (a) con los momentos medios | (a) estable al refinar; (b) crece en la cara (H25 y reticular) | — |
| C5-d, reparto | El del cálculo, con aviso fuera de la tabla I.1 | H25 dentro; un aviso en la losa de pilares mezclados (C5-10) | — |
| C5-e, machones con pilar | El pilar va aparte | — | — |
| C5-f, combinaciones | Del generador CTE/NCSE con la acción de los casos | 26 ELU-PT y 13 ELS-C en el banco | — |
| C5-g, caras de los apoyos | Cara común por línea, `CARA_COMUN` = 0,5 | +5,7 % con 5 cm dentro, +14 % con 10 cm; malla ×1,40 (losa plana) y ×1,63 (con vigas) frente a sólo los bordes de las bandas | **Opción A, 2026-10-08.** Queda por decidir `CARA_COMUN`: con 0,75 el sobrecoste quedaría por debajo del 6–7 %, a cambio de más líneas cuando los tamaños son muy distintos |

**Tamaño de la malla con las bandas** (`validacion/c5/out_malla.txt`, h = 0,75):

| Edificio objetivo | Sin bandas | Sólo bordes de bandas | Con caras (C5-g) |
|---|---|---|---|
| Losa plana, 1 planta | 4 995 nudos | 6 409 | 8 998 (75 plantillas, 536 caras válidas) |
| Con vigas, 1 planta | 5 031 | 7 623 | 12 449 |
| Losa plana, 7 plantas | 34 485 nudos, 90 237 ecuaciones | 44 383, 119 847 | **62 506, 166 320** (cabe en el perfil móvil) |
| Con vigas, 7 plantas | 34 737, 90 657 | 52 881, 144 333 | **86 663, 227 703** (sólo sobremesa) |

Las caras añaden, por línea de pilares, dos líneas de la rejilla en lugar de la del eje; con vigas en los ejes, tres. El resto es la CDT alrededor de los pocos pilares sin plantilla (junto al hueco y a una línea de tabiquería), con rasgos de 5 cm.

## 5. Pendiente

- **Del usuario:** `CARA_COMUN` (0,5 o 0,75), §4.
- **Rendimiento (criterio 8):** evaluar SPR para todos los casos a la vez. Hoy cada caso repite el recorrido de parches y láminas, y con más casos la integración de las bandas crece más que el cálculo.
- **D9 con vigas en todos los ejes:** 227 703 ecuaciones, por encima del perfil móvil (200 000). Con vigas en los ejes las bandas del Anejo I son discutibles; se podría no proponerlas, o proponer sólo los bordes.
- **E5:** una barra con offsets que cruza el plano infinito de un corte, aunque esté lejos de su rectángulo, lo hace no válido (`corte/barra-ambigua`). Es la semántica de E5, que no se ha cambiado; convendría limitarla al rectángulo.
- **Del plan, fuera de C5:** el punzonamiento a 2d; el límite de I.1.2(5); los extractores de cada módulo de Concreta; las bandas de losas sobre muros o vigas sin pilares.
- **Avisos de calidad:** con las caras, 28 cuadriláteros con el jacobiano bajo en el edificio de 7 plantas con losa plana y 140 con vigas, junto al hueco de la escalera y a la línea de tabiquería.
- **Validación externa:** el periodo «en sombra» con proyectos reales de losa plana y reticular calculados también en CYPE o SAP2000, comparando el reparto y los momentos de las bandas.

## Cómo reproducir

```sh
bun run test:run                                   # todos los tests (E0–E6, fase 1 y C1–C5)
bun validacion/c5/bandas.ts                        # criterios 2 y 3, y el reparto → out_bandas.txt
bun validacion/c5/malla.ts --plantas 7             # tamaño de la malla con las bandas → out_malla.txt
bun validacion/c5/caras.ts                         # caras comunes frente a la de cada pilar → out_caras.txt
bun validacion/c5/etabs15c-modelos.ts              # exporta ETABS 15c para el oráculo
.venv312/Scripts/python.exe validacion/c5/oraculo_cortes.py   # OpenSees → src/compilador/__fixtures__/opensees-c5.json
bun validacion/c5/etabs15c.ts                      # criterio 4 → out_etabs15c.txt
bun validacion/c5/banco.ts                         # criterio 8 → out_banco.txt
bun validacion/c5/congelar.ts                      # SÓLO a sabiendas: regenera la referencia congelada de C5
```
