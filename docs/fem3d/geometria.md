# G: el compilador fuera de la retícula ortogonal

**2026-10-12.** Hasta ahora, los modelos de validación eran retículas ortogonales. Lo único oblicuo que se probaba era un chaflán, el `eje1` girado y la planta entera girada en las metamórficas. Este informe prueba plantas no ortogonales, que son habituales (rombo, planta circular, abanico, dos alas en ángulo, esquina aguda), y retículas al azar en las que entra de verdad la rejilla de H52. Además:
- añade un respaldo para que un fallo de la rejilla no pueda impedir el cálculo (G-1);
- añade un refinamiento de Delaunay al mallador, que quita los elementos degenerados junto a los pilares (G-4).

## 1. Qué hay nuevo

| Fichero | Qué hace |
|---|---|
| `src/compilador/mallado.ts` | `conRespaldo` (G-1): si la planta con rejilla lanza o no pasa el validador, se malla con la triangulación sola y se avisa con `malla/sin-rejilla`. Refinamiento de Delaunay tras la CDT (G-4, paso 3b) |
| `src/compilador/compilar.ts` | Versión del compilador C5.1 (la malla cambia, así que cambian las huellas) e hipótesis de la malla con el refinamiento |
| `src/pruebas/geometrias.ts` | Cinco familias de planta no ortogonal, cada una con 4 variantes: sin más, con hueco, girada 23° y con pilares circulares |
| `src/pruebas/reticulasAleatorias.ts` | Retículas al azar de 3–6 × 2–4 vanos de 4–7,5 m. Pilares de cinco secciones, a veces girados 90° o circulares. Vigas por algunos ejes. A veces, un hueco con una esquina a 0,3–0,9 m de un pilar, voladizo, fachada enrasada y chaflán |
| `src/compilador/geometrias.test.ts` | Las 20 variantes y las 24 retículas compilan, con y sin rejilla, sin errores, sin respaldo y sin el aviso `malla/calidad` |
| `validacion/geom/sondeo.ts` | Cada modelo con la rejilla (h = 0,75), con la triangulación sola (h = 0,75) y con la referencia (triangulación, h = 0,3) → `out_sondeo.txt` |
| `src/compilador/__fixtures__/congelado-c2…c5.json` | Regeneradas con el refinamiento (§4) |

**Lo que se compara con la referencia:**
- reacciones de los pilares (G + Q), relativas a la reacción media;
- flecha máxima de cada planta (G + Q);
- desplome medio de la planta de arriba (Vx);
- momento flector de los pilares (G + Q) en los extremos de cada tramo, relativo al mayor del modelo. Es lo que más depende de la malla de alrededor de cada pilar.

## 2. Resultados

Son 44 modelos con tres mallas cada uno: 132 compilaciones y cálculos, todos válidos, con equilibrio ≤ 2,1e-13 y sin ningún aviso de calidad de malla. Peores diferencias frente a la referencia, con el refinamiento (entre paréntesis, antes de G-4):

| Modelos | Malla | Rejilla en | Jacobiano mín. | Reacciones | Flechas | Desplome | M pilares |
|---|---|---|---|---|---|---|---|
| 20 no ortogonales | triangulación 0,75 | — | 0,289 (0,095) | 0,72 % (0,73) | 0,64 % (0,61) | 0,16 % (0,25) | 1,39 % (2,26) |
| 20 no ortogonales | rejilla 0,75 (por defecto) | 6 de 20, ≤ 35 % del área | 0,289 (0,095) | 0,90 % (0,88) | 1,04 % (1,04) | 0,59 % (0,57) | 1,71 % (2,26) |
| 24 retículas al azar | triangulación 0,75 | — | 0,281 (0,037) | 0,79 % (0,98) | 1,38 % (2,23) | 0,20 % (0,92) | 2,47 % (2,29) |
| 24 retículas al azar | rejilla 0,75 (por defecto) | 23 de 24, ≤ 85 % del área | 0,228 (0,037) | 1,77 % (1,43) | 2,91 % (3,09) | 3,73 % (3,72) | 4,63 % (4,65) |

La referencia también cambia con el refinamiento, porque es la misma triangulación más fina.

## 3. Hallazgos

| ID | Hallazgo | Consecuencia |
|---|---|---|
| G-1 | **Un fallo de la rejilla impedía calcular.** `mallarPlanta` sólo recurría a la triangulación sola cuando la rejilla cubría poco. Una excepción, o una malla que no pasaba el validador (conformidad, área, lados), dejaba el modelo sin compilar, aunque la triangulación sola habría funcionado | `conRespaldo`: la planta se malla con la triangulación sola y sale el aviso `malla/sin-rejilla`. Si la triangulación también falla, queda el fallo. No cambió ninguna referencia congelada (no había ningún caso) |
| G-2 | **Las plantas no ortogonales funcionan, por la triangulación.** La rejilla sólo sigue los ejes de la primera losa. En el rombo, la planta circular y el abanico no entra en ningún sitio, y en las dos alas y el triángulo sólo cubre el 22–35 %. Esas plantas se mallan con la triangulación de C2, que no depende de la geometría y queda a ≤ 1,4 % de la referencia en todo | Lo complejo (rejilla y plantillas) apenas interviene en estas plantas. El coste es de tamaño: sin rejilla, el edificio objetivo de 7 plantas tiene 81 091 nudos en vez de 34 779. Uno de 7 plantas no ortogonal rondaría las 200 000 ecuaciones, una estimación que no se ha medido: cabe en sobremesa (D9) y queda en el límite del perfil móvil |
| G-3 | **La rejilla cuesta precisión junto a los pilares.** En las retículas al azar ahorra un 32 % de nudos, pero el desplome sale siempre más rígido: entre −0,3 y −3,7 %, frente a ≤ 0,2 % con la triangulación del mismo h. Los momentos de los pilares se separan hasta un 4,63 % del mayor, frente a un 2,47 %. Las plantillas son más gruesas que la triangulación junto a los pilares. En el edificio objetivo, R-6 medía −0,75 % de deriva | **Para el usuario:** aceptarlo, como la deriva de §4 de `rejilla.md`, o afinar las plantillas. Un desplome más rígido va del lado de la inseguridad en las comprobaciones de desplome |
| G-4 | **Había elementos degenerados junto a los pilares.** El aviso `malla/calidad` saltaba en 34–40 de los 44 modelos, con un jacobiano de hasta 0,037: de 1 058 cuadriláteros con j < 0,2, sólo 59 estaban enteros en una huella rígida. En las retículas al azar caían junto a pilares circulares (89), de fachada enrasados (38) y rectangulares (27). La causa era el tamaño de la malla: (1) el tamaño de un rasgo era la distancia de un punto del arreglo al punto más cercano, no a los lados, así que el borde de una losa que pasa a 10 cm de la cara de un pilar no se refinaba; (2) dentro de la losa sólo estaba la retícula fija de 2h, a ≥ 0,45·2h de todo lado, y la CDT unía segmentos de 5–20 cm con puntos a 1–2,5 m (agujas de hasta 2 m). Bajar `CRECIMIENTO` y la holgura no lo arreglaba | **Refinamiento de Delaunay** (decisión del usuario, frente a un tamaño en 2D con anillos alrededor de las huellas o sólo cambiar el aviso). Ver §4. Ningún modelo de los 44 tiene ya el aviso, y la malla gruesa se acerca más a la fina. El edificio objetivo apenas cambia |
| G-5 | **El compilador cazó dos errores del generador.** Un contorno del abanico al que le faltaba un vértice, que daba un borde de losa que corría 1,55 m dentro del ancho de una viga, dio `losa/borde-en-viga` (C2-c). Un ángulo mal calculado dio coordenadas `NaN` en los pilares, que dio `fisico/valor-no-valido`. Las dos, con un mensaje que señalaba la pieza | Ninguno |
| G-6 | **Dos umbrales del refinamiento sin holgura rompían las metamórficas** (giro de 37° en C2, traslación en C3). Hubo dos causas. Las búsquedas por celdas miraban sólo las 3 × 3 vecinas, y un circunradio grande se salía de ellas: la respuesta dependía de cómo caían las celdas. Además, en un modelo, la media arista de un tramo coincidía exactamente con el suelo de refinamiento (0,1 × 0,574), y el redondeo del giro decidía | Búsquedas por radio, holgura en todos los umbrales (como R-7) y desempate de candidatos independiente del orden de los triángulos. Pasan todas las metamórficas (orden, traslación, giros de 90° y 37°, ruido < ε_geom) |

## 4. El refinamiento (G-4)

Se hace tras la CDT, con la siembra, la retícula y los centros de R-6 como puntos de partida (`mallado.ts`, paso 3b). En cada ronda:

1. Se parte por la mitad cada tramo sembrado con un punto dentro de su círculo diametral (Ruppert).
2. Cada triángulo que se queda, fuera de las huellas (rígidas), con algún cuadrilátero de jacobiano escalado < 0,3 (`JACOBIANO_OBJETIVO`) propone su circuncentro.
   - Si el circuncentro invade un tramo obligatorio, se parte ese tramo si es de la siembra.
   - Si no vale (invade la interfaz con la rejilla, un muro o una plantilla, o cae fuera de la losa), se prueba el «off-center» de Üngör.
3. Los candidatos entran en el orden de los ejes de la primera losa, separados 0,5·r entre sí (r, el circunradio o la media arista). Nunca entra nada por debajo de 0,1 del tamaño local (`PISO`), con el que el bucle acaba aunque haya ángulos pequeños en el arreglo.
4. Se vuelve a triangular. Como mucho, 40 rondas.

**Lo que no se toca:** los tramos de los muros (C3), de la rejilla, de la interfaz y de las plantillas.

**Lo que se descartó, medido:** el criterio de ángulo mínimo de 25°, el clásico, daba la misma calidad con el doble de nudos (60 000 en el edificio objetivo de 3 plantas, frente a 34 799). El criterio por el jacobiano de los 3 cuadriláteros de cada triángulo sólo refina donde hace falta.

**Tamaño y tiempo:**

| Modelo | Nudos antes → después | Compilación antes → después |
|---|---|---|
| Edificio objetivo con losas, 7 plantas | 34 737 → 34 779 | 1,09 → 1,07 s |
| Edificio objetivo con muros, 7 plantas (jac. 0,257 → 0,302) | 48 451 → 48 771 | 1,41 → 1,59 s |
| Edificio objetivo, triangulación sola (jac. 0,252 → 0,302) | 79 649 → 81 091 | 2,14 → 2,38 s |
| 20 no ortogonales, rejilla | +12 % | — |
| 24 retículas al azar, rejilla / triangulación | +7 % / +17 % | — |
| Modelos al azar congelados de C2, h = 1 | +40 a +70 % | — |

En los modelos pequeños con h = 1 el refinamiento pesa más: los rasgos son pocos centímetros y la malla, de 2 m.

**Referencias congeladas regeneradas** (C2–C5; C1 no tiene losas). Antes se comprobó que el cambio mejora la malla. En los modelos de C2, las reacciones cambian ≤ 0,5 %. La flecha máxima de `aleatorio-11-losas-sin-diafragma` cambia un 4,4 %, y es la malla vieja la que se equivocaba: frente a la misma triangulación con h = 0,2, la de h = 1 daba −6,1 % y ahora da −2,0 %. En `aleatorio-8-losas`, de −0,84 % a −0,22 %. Pasan los oráculos de C2–C5 (Navier, losa plana de H25, ETABS 15c…) sin tocarlos.

## 5. Límites de este informe

- **La referencia** es la misma triangulación con h = 0,3: mide la convergencia de la malla, no es un oráculo independiente. Lo independiente siguen siendo los casos de E6 y el periodo en sombra.
- **Sólo losa maciza con vigas,** de 1–2 plantas. Faltan muros curvos u oblicuos, reticulares y unidireccionales en planta no ortogonal (C4 ya probó paños oblicuos) y bandas oblicuas (`proponerBandas` con alineaciones que no son paralelas).
- **El visor** no se ha probado con estas plantas.
- **Las salidas `out_*.txt` de C2–C5** son de su fecha y no se han regenerado con el refinamiento. Los criterios que miden están en las pruebas, que pasan.

## 6. Pendiente

- **Del usuario:** G-3.
- **Técnico:**
  - ampliar las familias a muros, reticular, unidireccional y bandas;
  - la plantilla con la esquina de un hueco dentro de su bloque (`rejilla.md`, §5).

## Cómo reproducir

```sh
bunx vitest run src/compilador                                   # incluye geometrias.test.ts y las metamórficas
bun validacion/geom/sondeo.ts > validacion/geom/out_sondeo.txt   # ~1 min
bun validacion/c2/congelar.ts                                    # SÓLO a sabiendas (y c3, c4, c5)
```
