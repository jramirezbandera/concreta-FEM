# Fase LV — informe: la unión de la losa con las vigas, como CYPECAD

> **Fecha:** 2026-10-15. **Plan:** `union-losa-viga.md` (lo fijado al empezar y los criterios). **Origen:** CY-10 y la decisión del usuario CY-g: «vamos a seguir el criterio de CYPE, es mejor como lo hacen ellos».
>
> **Resultado:** hecha y por defecto (compilador LV1). La losa llega a las caras de las vigas de hormigón rectangulares, sus nudos de borde van al eje con un enlace rígido y lo que cae en el ancho de la viga pasa a la viga. Con `unionLosaViga: "eje"` todo es como antes, con los mismos bits. Pasan los criterios 1, 3, 4, 5 y 8; el 2, el 6 y el 7 quedan a medias:
> - **converge a CYPE y la de antes no:** en el recuadro de CY-10, con la malla fina, todo queda a ≤ 3 % del emparrillado de CYPE; la unión de antes se quedaba en 0,68–0,96;
> - **pero no con la malla por defecto (h = 0,75):** junto a las vigas, el momento de la viga en la cara de un pilar sale al 0,79 y algunas franjas de armado, hasta un 41 % lejos de la malla fina (LV-2, LV-3);
> - **la vivienda mejora en todo:** flechas y axiles ya pasan; los momentos de vano también, salvo el `my` de la cubierta (0,82), que no depende de la malla (LV-8).

## 1. Criterios

| # | Criterio | Resultado | Dónde |
|---|---|---|---|
| 1 | Con `unionLosaViga: "eje"`, las referencias congeladas y los resultados de antes, bit a bit | **Pasa.** Las 31 referencias congeladas de C2–C5 y F, idénticas. En 75 modelos (los congelados, aleatorios con losas y forjados, edificios objetivo, ejemplos y A2), el mismo modelo analítico y el mismo mapeo; los diagnósticos, iguales salvo un aviso (LV-6) | `validacion/lv/opciones.ts`, `out_opciones_antes.txt`, `out_opciones_eje.txt` |
| 2 | Recuadro de CY-10 frente al emparrillado de CYPE, a ≤ 5 %, sin separarse al refinar | **A medias.** Converge: con h = 0,12, momento de la viga en la cara 0,99, en el centro 1,00, cortante en la cara 1,03, flecha y momento de la losa 1,00. Con h = 0,75, 0,79 / 1,04 / 1,25 / 0,97 / 0,98 (LV-2). La unión de antes no converge: 0,68 / 0,94 / 0,76 / 0,95 / 0,96 | `validacion/lv/recuadro.ts`, `out_recuadro.txt` |
| 3 | No hay láminas en el ancho; cada nudo de la losa en él va con un enlace; láminas y piezas suman el área de cada losa a 1e-9 | **Pasa** (el validador del mallador lo exige en cada compilación) | `unionLosaViga.test.ts` |
| 4 | Lo que cae en el ancho llega a la viga sin pérdidas (1e-9) y con equilibrio | **Pasa** en todas las baterías (C2, C3, C4, aleatorias, geometrías) | Pruebas |
| 5 | La malla y los resultados no dependen del orden de las listas, de una traslación o de un giro | **Pasa** tras cuatro arreglos (LV-5): metamórficas de C2–C4 y de LV, Node y Bun con la misma malla, «Renumerar» con el mismo modelo y la variante equivalente de A2 a ≤ 1,2e-12 | Pruebas |
| 6 | La vivienda: momentos de vano ≥ 0,90 de CYPE, flechas ±10 %, axiles ±10 % salvo explicados | **A medias** (§2). Flechas 0,91 / 0,91 y axiles (sólo P5, como antes) pasan; momentos de vano 0,91, 0,91 y 0,95, pero el `my` de la cubierta da 0,82 | `validacion/sombra/vivienda/` |
| 7 | En la cara de una viga, la suma de las franjas es lo que pasa a la viga; las franjas, sin regresiones frente a la malla fina | **A medias.** La suma, exacta (1e-9). Frente a h = 0,25, con h = 0,75 la mediana queda en 0,8 % (apoyos) y 2,1 % (vano), pero el peor en 41 % y 34 %; con la unión de antes, 16 % y 7 % (LV-3) | `unionLosaViga.test.ts`, `validacion/lv/franjas.ts`, `out_franjas.txt` |
| 8 | El edificio objetivo con vigas sigue en la rejilla y en el perfil móvil | **Pasa.** 112 119 ecuaciones (antes, 90 783; el perfil móvil admite 200 000), el 82 % de las láminas en la rejilla, sin `malla/sin-rejilla`. Compila en 3,3 s (antes, 1,1 s) y calcula en 4,6 s (2,2 s) | `validacion/lv/banco.ts`, `out_banco.txt` |

## 2. La vivienda frente a CYPECAD

Las mismas comparaciones de la fase CY (`comparar.py`): mediana de nuestro/CYPE en los valores grandes, en los nudos del listado a más de 0,5 m de la cara de un pilar.

| Variante | mx P1 | my P1 | mx cub. | my cub. | Flecha P1 / cub. | Axiles fuera de ±10 % |
|---|---|---|---|---|---|---|
| Unión por el eje (fase CY) | 0,87 | 0,88 | 0,92 | 0,76 | 0,87 / 0,88 | P5, P13 (−11 %) |
| **Unión por las caras (LV, por defecto)** | **0,91** | **0,91** | **0,95** | **0,82** | **0,91 / 0,91** | P5 (+14 a +32 %) |
| Lo mismo con h = 0,375 | 0,92 | 0,91 | 0,96 | 0,82 | 0,92 / 0,92 | P5 |

El `my` de la cubierta no cambia al refinar. Lo que falta está entre P4, P13 y P5 (x de 4 a 8 m, y de 10 a 12 m, `zonas.py`), con el 0,65–0,81 de CYPE, y P5 sigue llevando entre un 14 y un 32 % más que en CYPE, según la hipótesis. Las dos cosas apuntan a lo mismo, y es lo siguiente que hay que mirar.

## 3. Hallazgos

| # | Hallazgo | Consecuencia |
|---|---|---|
| LV-1 | **CY-10 medía el momento de la viga a 2e del eje, no en la cara.** Con la estación en la cara, la unión de antes da 0,87 frente al emparrillado de CY-10, no 0,15, y 0,83 al refinar, no 0,00. El resto de CY-10 se mantiene: el cortante en la cara, 0,58 → 0,76, y no converge, porque la losa sobre media viga cuenta dos veces su rigidez | Corregido en `validacion/cy/borde.ts` y en `fase-cy.md` |
| LV-2 | **Con h = 0,75 la viga sale peor que con la malla fina.** En el recuadro, el momento en la cara del pilar da el 0,79 del emparrillado y el cortante el 1,25; con h = 0,5, 0,91 y 1,14; con 0,25, 0,97 y 1,07. Lo que entra en la viga por la cara va a puntos cada 0,75 m, y el primero junto al pilar se lleva un tramo entero. La unión de antes daba 0,71 y 0,58 con h = 0,75 | Decisión LV-a |
| LV-3 | **Algunas franjas junto a las vigas se separan de la malla fina con h = 0,75.** En la retícula de 4 × 4, la mediana es buena (0,8 % en los apoyos, 2,1 % en el vano), pero los peores son las franjas de borde y las de junto a una viga paralela: en los apoyos, 41 % (L-N1:Y1 en la cara de X5: 16,2 frente a 27,6 kN·m/m), en el vano 34 %. Con h = 0,5, 17 % y 7 %; con 0,375, 10 % y 6 % | Decisión LV-a |
| LV-4 | **La malla crece donde la rejilla no entra.** Una viga ya no es una línea de la rejilla, sino dos caras a b de distancia, y las huellas de los pilares que tapan los anchos de las vigas no llevan plantilla. En el edificio objetivo, la rejilla sigue cubriendo el 82 %. En la retícula enrasada, sólo el 17 %: de 1 254 a 5 574 ecuaciones. En el núcleo de A2, de 1 492 a 4 420 nudos. Con todo, la retícula enrasada queda a ≤ 0,11 % en reacciones, −0,73 % en flecha y 0,10 % en deriva de la malla fina (el mismo criterio que C2-a) | Decisión LV-b |
| LV-5 | **Cuatro dependencias que no debía haber, encontradas por las pruebas de propiedades:** (a) `Math.hypot` y `Math.cos` en el código nuevo daban distinta malla en Bun y en Node; (b) las piezas del ancho seguían el orden de la triangulación, que cambia con un ulp: ahora, orden canónico por su centroide; (c) en el cruce de dos vigas, el empate se deshacía por el id de la viga, y «Renumerar» cambiaba la malla (40 nudos): ahora, por un orden geométrico (la más ancha, la más paralela al eje 1 de la planta y luego su posición); (d) las proyecciones sobre el eje se agrupaban desde la primera, así que la viga dibujada al revés daba otra malla (un 1 % en el desplome del núcleo de A2): ahora, por enlace simple, con el nudo en el centro del grupo | Corregidos |
| LV-6 | **Un empate exacto a ε_snap ya no se une** (el arreglo une a ε_snap − 10·ε_geom). Con un pilar de 35 y una viga de 25, la cara de la viga queda a 5 cm justos de la huella, y un ruido de ε_geom decidía si se unían. Es un cambio para las dos uniones: con «eje», en los 75 modelos de antes sólo desaparece un aviso `losa/ajuste` de un ábaco a 5,0 cm, con el mismo modelo analítico | Medido (criterio 1) |
| LV-7 | **La triangulación restringida podía no acabar.** En un modelo al azar, una carga lineal llega a la cara de una viga con 2° (su extremo, a 4 cm dentro del ancho, se une a la cara). El refinamiento ponía puntos casi alineados junto a ese ángulo, el `inCircle` con tolerancia de los empates pedía girar la diagonal de un cuadrilátero no convexo y la estructura de constrainautor se corrompía: sus recorridos alrededor de un vértice no acababan. Ahora sólo se gira si el cuadrilátero es estrictamente convexo (predicado exacto), los predicados tienen un tope (200 por punto; los modelos de las pruebas hacen ≤ 14) con respaldo sin los empates, y un tramo de la cara sólo lo invade lo que está del lado de la losa | Corregido. El modelo compila en 0,26 s, con el aviso de calidad que corresponde a ese ángulo |
| LV-8 | **Calidad de malla junto a un pilar más ancho que la viga que lo atraviesa.** La huella asoma unos centímetros por fuera de la cara, y entre la cara y la plantilla del pilar quedan cuadriláteros con el jacobiano bajo: el aviso `malla/calidad` en 16 de las 24 retículas al azar, en la familia triangular y en el núcleo de A2 (el peor jacobiano, 0,109, en una retícula). Con la unión de antes, ninguno (G-4). La vivienda, el muestrario y el edificio objetivo no lo tienen | Decisión LV-c. La prueba de G exige ≥ 0,1 con las caras |
| LV-9 | **Un pilar en el extremo de una viga se quedaba con su metro en un lado del modelo y sin él en el otro:** su centro cae en el borde del ancho, y `puntoEnPoligono` lo daba dentro en un extremo y fuera en el otro. Ahora se mira en el ancho cerrado, con holgura | Corregido (la franja L-N1:Y22 recupera su estación en la cara de la viga) |

## 4. Cómo ha quedado frente al plan

Lo que cambia respecto a `union-losa-viga.md`:
- **§1.3, el pilar:** un nudo de la cara va con la huella del pilar si su proyección cae en la zona rígida de la viga en el pilar (C1-a: f·e desde su eje), no en toda la cuerda de la huella. Fuera de ella, la viga es flexible, y el nudo va a su eje.
- **§1.3, el cruce de dos anchos:** una regla discreta, la viga que pasa por el cruce (no la que acaba en él). Con el eje más cercano, el reparto dependía de una diagonal de la triangulación, y un giro de la planta cambiaba la carga. Los empates, por el orden geométrico de LV-5 (c), no por el primer tramo.
- **§1.3, la agrupación:** por enlace simple (LV-5 d).
- **§1.4, la torsión de las piezas:** a los nudos del eje con sus funciones lineales, integrada exacta (Simpson), en lugar de un momento en el centroide de cada pieza: lo que recibe cada nudo no depende de cómo se triangula el ancho.
- **§1.6, la rejilla:** las caras son líneas fuertes; las huellas que tapan los anchos de las vigas no se siembran, y esos pilares no tienen plantilla (LV-4).
- **§1.7, las franjas:** como estaba. Un pilar dentro del ancho de una viga que va según la transversal de la franja no tiene metro (SP-3, SP-4): su apoyo son las caras de la viga.
- **«Vigas de borde»:** no cambia. Lleva la losa al eje de la viga, y con LV lo que queda entre el eje y la cara interior es ancho de la viga, que ya va a la viga; lo de fuera lo pasa la orden como cargas de viga, sin contar nada dos veces.
- **`sensatez/borde-sin-viga`:** da por atado un borde que va dentro del ancho de una viga.

Las pruebas que miden un comportamiento de antes con vigas (las plantillas de SP-2, el metro de los pilares atravesados por vigas de SP-3, SP-4, SP-6 y F3.3, las huellas de C2-d, las regresiones de C2 y C2-a) se hacen con `unionLosaViga: "eje"`, y donde tiene sentido se añade la comprobación con las caras. Las referencias congeladas de antes llevan `"eje"` explícito (siguen idénticas) y hay cinco nuevas con las caras (`-lv`, en C2, C3, C4 y F).

## 5. Decisiones para el usuario

- **LV-a, la precisión con h = 0,75 junto a las vigas (LV-2, LV-3).** Propuesta: refinar la malla junto a las caras de las vigas, como F2 junto a las de los pilares (tercios del primer tramo junto a la cara), sin bajar h en toda la losa. Alternativa: aceptarlo y avisar en las franjas de borde, o bajar h por defecto (con 0,5, el edificio objetivo no cabría en el perfil móvil).
- **LV-b, el tamaño donde la rejilla no entra (LV-4).** Propuesta: aceptarlo por ahora (el edificio objetivo cabe y la precisión es la de la malla fina) y hacer que la rejilla entre con los anchos cuando se vuelva a tocar el mallador.
- **LV-c, la calidad junto a los pilares más anchos que la viga (LV-8).** Propuesta: mirarlo junto con LV-a, porque los dos tocan las plantillas de los pilares junto a las caras.
- **Lo que el plan dejaba fuera (§1.9):** la zona rígida 1 en la unión viga–pilar se midió en el recuadro (`out_recuadro.txt`, §2); las viguetas desde la cara, la losa hasta la cara de los muros y el peso de la viga entera en un reticular siguen sin medir.

**Decidido por el usuario el 2026-10-15:** LV-a y LV-c, juntas en una fase corta de refinamiento junto a las vigas (fase LV2, plan en `refinamiento-vigas.md`); LV-b se acepta por ahora y se retoma cuando se vuelva a tocar la rejilla; el `my` de la cubierta y P5, justo después de LV2. Al medir el plan de LV2, la primera fila partida a lo largo de toda la cara no cabe en el perfil móvil y se propone refinar sólo la esquina de cada paño (`refinamiento-vigas.md` §1–§4).

**Siguiente paso:** la fase LV2 y, después, el `my` de la cubierta y P5 (§2).

## 6. Para reproducir

```
bun validacion/lv/recuadro.ts > validacion/lv/out_recuadro.txt
bun validacion/lv/banco.ts > validacion/lv/out_banco.txt
bun validacion/lv/franjas.ts > validacion/lv/out_franjas.txt
bun validacion/lv/geometrias.ts > validacion/lv/out_geometrias.txt
bun validacion/lv/opciones.ts eje > validacion/lv/out_opciones_eje.txt    (y sin «eje» en un worktree del commit anterior)
bun validacion/sombra/vivienda/muestrear.ts validacion/sombra/vivienda/.datos/lv-cara
.venv/Scripts/python.exe validacion/sombra/vivienda/comparar.py validacion/sombra/vivienda/.datos/lv-cara
```
