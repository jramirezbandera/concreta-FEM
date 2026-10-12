# G: el compilador fuera de la retícula ortogonal

**2026-10-12.** Hasta ahora, los modelos de validación eran retículas ortogonales. Lo único oblicuo que se probaba era un chaflán, el `eje1` girado y la planta entera girada en las metamórficas. Este informe prueba plantas no ortogonales, que son habituales (rombo, planta circular, abanico, dos alas en ángulo, esquina aguda), y retículas al azar en las que entra de verdad la rejilla de H52. También añade un respaldo para que un fallo de la rejilla no pueda impedir el cálculo.

## 1. Qué hay nuevo

| Fichero | Qué hace |
|---|---|
| `src/compilador/mallado.ts` | `conRespaldo` (G-1): si la planta con rejilla lanza o no pasa el validador, se malla con la triangulación sola y se avisa con `malla/sin-rejilla` |
| `src/pruebas/geometrias.ts` | Cinco familias de planta no ortogonal, cada una con 4 variantes: sin más, con hueco, girada 23° y con pilares circulares |
| `src/pruebas/reticulasAleatorias.ts` | Retículas al azar de 3–6 × 2–4 vanos de 4–7,5 m. Pilares de cinco secciones, a veces girados 90° o circulares. Vigas por algunos ejes. A veces, un hueco con una esquina a 0,3–0,9 m de un pilar, voladizo, fachada enrasada y chaflán |
| `src/compilador/geometrias.test.ts` | Las 20 variantes y las 24 retículas compilan, con y sin rejilla, sin errores ni respaldo |
| `validacion/geom/sondeo.ts` | Cada modelo con la rejilla (h = 0,75), con la triangulación sola (h = 0,75) y con la referencia (triangulación, h = 0,3) → `out_sondeo.txt` |

**Lo que se compara con la referencia:**
- reacciones de los pilares (G + Q), relativas a la reacción media;
- flecha máxima de cada planta (G + Q);
- desplome medio de la planta de arriba (Vx);
- momento flector de los pilares (G + Q) en los extremos de cada tramo, relativo al mayor del modelo. Es lo que más depende de la malla de alrededor de cada pilar.

## 2. Resultados

Son 44 modelos con tres mallas cada uno: 132 compilaciones y cálculos, todos válidos, con equilibrio ≤ 1,8e-13. Peores diferencias frente a la referencia:

| Modelos | Malla | Rejilla en | Reacciones | Flechas | Desplome | M pilares |
|---|---|---|---|---|---|---|
| 20 no ortogonales | triangulación 0,75 | — | 0,73 % | 0,61 % | 0,25 % | 2,26 % |
| 20 no ortogonales | rejilla 0,75 (por defecto) | 6 de 20, ≤ 37 % del área | 0,88 % | 1,04 % | 0,57 % | 2,26 % |
| 24 retículas al azar | triangulación 0,75 | — | 0,98 % | 2,23 % | 0,92 % | 2,29 % |
| 24 retículas al azar | rejilla 0,75 (por defecto) | 23 de 24, ≤ 85 % del área | 1,43 % | 3,09 % | 3,72 % | 4,65 % |

## 3. Hallazgos

| ID | Hallazgo | Consecuencia |
|---|---|---|
| G-1 | **Un fallo de la rejilla impedía calcular.** `mallarPlanta` sólo recurría a la triangulación sola cuando la rejilla cubría poco. Una excepción, o una malla que no pasaba el validador (conformidad, área, lados), dejaba el modelo sin compilar, aunque la triangulación sola habría funcionado | `conRespaldo`: la planta se malla con la triangulación sola y sale el aviso `malla/sin-rejilla`. Si la triangulación también falla, queda el fallo. No cambia ninguna referencia congelada (no había ningún caso) |
| G-2 | **Las plantas no ortogonales funcionan, por la triangulación.** La rejilla sólo sigue los ejes de la primera losa. En el rombo, la planta circular y el abanico no entra en ningún sitio, y en las dos alas y el triángulo sólo cubre el 22–37 %. Esas plantas se mallan con la triangulación de C2, que no depende de la geometría y queda a ≤ 2,3 % de la referencia en todo | Lo complejo (rejilla y plantillas) apenas interviene en estas plantas. El coste es de tamaño: sin rejilla, el edificio objetivo de 3 plantas tenía 34 231 nudos en vez de 15 385. Uno de 7 plantas no ortogonal rondaría las 200 000 ecuaciones, una estimación que no se ha medido: cabe en sobremesa (D9) y queda en el límite del perfil móvil |
| G-3 | **La rejilla cuesta precisión junto a los pilares.** En las retículas al azar ahorra un 26 % de nudos, pero el desplome sale siempre más rígido (−0,3 a −3,7 %, frente a ≤ 0,9 % de la triangulación del mismo h). Los momentos de los pilares se separan hasta un 4,65 % del mayor, el doble que con la triangulación. Las plantillas son más gruesas que la triangulación junto a los pilares. En el edificio objetivo, R-6 medía −0,75 % de deriva | **Para el usuario:** aceptarlo, como la deriva de §4 de `rejilla.md`, o afinar las plantillas. Un desplome más rígido va del lado de la inseguridad en las comprobaciones de desplome |
| G-4 | **El aviso `malla/calidad` salta en 34–40 de los 44 modelos,** con un jacobiano de hasta 0,037. Siempre es junto a un pilar al que llegan vigas en ángulo o junto a un pilar circular (octógono): el punto por donde el eje de la viga cruza la huella queda a pocos centímetros de una esquina de la huella. Los resultados no se resienten (≤ 2,3 %), pero un aviso que sale en casi todos los edificios reales deja de leerse. Además, su texto («dos líneas casi paralelas…») no describe este caso | **Pendiente:** no sembrar el cruce de la viga con la cara si cae a menos de una fracción de h de una esquina de la huella (dentro de la huella todo es rígido), o explicar este caso en el aviso. Antes, medir qué cambia |
| G-5 | **El compilador cazó dos errores del generador.** Un contorno del abanico al que le faltaba un vértice, que daba un borde de losa que corría 1,55 m dentro del ancho de una viga, dio `losa/borde-en-viga` (C2-c). Un ángulo mal calculado dio coordenadas `NaN` en los pilares, que dio `fisico/valor-no-valido`. Las dos, con un mensaje que señalaba la pieza | Ninguno |

## 4. Límites de este informe

- **La referencia** es la misma triangulación con h = 0,3: mide la convergencia de la malla, no es un oráculo independiente. Lo independiente siguen siendo los casos de E6 y el periodo en sombra.
- **Sólo losa maciza con vigas,** de 1–2 plantas. Faltan muros curvos u oblicuos, reticulares y unidireccionales en planta no ortogonal (C4 ya probó paños oblicuos) y bandas oblicuas (`proponerBandas` con alineaciones que no son paralelas).
- **El visor** no se ha probado con estas plantas.

## 5. Pendiente

- **Del usuario:** G-3.
- **Técnico:**
  - G-4: el aviso de calidad junto a pilares con vigas en ángulo y pilares circulares;
  - ampliar las familias a muros, reticular, unidireccional y bandas;
  - la plantilla con la esquina de un hueco dentro de su bloque (`rejilla.md`, §5).

## Cómo reproducir

```sh
bunx vitest run src/compilador/geometrias.test.ts src/compilador/mallado.test.ts
bun validacion/geom/sondeo.ts > validacion/geom/out_sondeo.txt   # ~1 min
```
