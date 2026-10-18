# Fase LV2 — la malla junto a las vigas (LV-a y LV-c)

> **Fecha:** 2026-10-15. **Origen:** LV-a y LV-c (`fase-lv.md` §5). **Decisión del usuario (2026-10-15):** LV-a y LV-c juntas, en una fase corta de refinamiento junto a las caras de las vigas, como F2 junto a las de los pilares; LV-b se acepta por ahora; el `my` de la cubierta y P5 van justo después.
>
> **El problema:** con el h por defecto (0,75 m) y la unión por las caras (LV1), el momento negativo de la viga en la cara del pilar sale al 0,79 del emparrillado de CYPE y algunas franjas, hasta un 41 % bajas (LV-2, LV-3), las dos cosas del lado inseguro. Y junto a los pilares más anchos que la viga y a las vigas curvas, la malla tiene cuadriláteros de mala calidad (LV-8).
>
> **Objetivo:** con h = 0,75, la viga en la cara de los pilares y las franjas junto a las vigas como con la malla fina, sin avisos de calidad y dentro del perfil móvil.
>
> **Este documento** fija, antes de empezar, lo medido, cómo se hace y qué tiene que pasar. **Cambia la propuesta:** refinar la primera fila a lo largo de toda la cara de cada viga no cabe en el perfil móvil (§1.2), y no hace falta: basta la esquina de cada paño (§1.3). Lo que decide el usuario antes de seguir está en §4.

## 1. Lo medido antes de empezar

Exploración con scripts provisionales, con ganchos temporales en la rejilla y en un árbol aparte; no se guardan. Todo con la unión por las caras y h = 0,75 salvo que se diga.

### 1.1 Qué refinamiento arregla la viga (LV-2)

Recuadro de CY-10 (`validacion/lv/recuadro.ts`): momento y cortante de la viga en la cara del pilar frente al emparrillado de CYPECAD. Las variantes añaden líneas de rejilla en fracciones del primer elemento junto a las caras.

| Malla | M cara | V cara |
|---|---|---|
| Hoy (LV1) | 0,79 | 1,25 |
| Tercios del primer elemento junto a todas las caras | 0,95 | 1,07 |
| Tercios sólo a través de la viga medida (líneas paralelas a ella) | 0,97 | 1,02 |
| Tercios sólo a lo largo de ella, junto al pilar | 0,80 | 1,27 |
| Mitades, en todas | 0,92 | 1,11 |
| 1/6, 1/3 y 2/3 (F2-a), en todas | 0,96 | 1,03 |
| La triangulación sola, sin rejilla | 0,97 | 1,04 |
| h = 0,5 / 0,25 / 0,12, uniforme | 0,91 / 0,97 / 0,99 | 1,14 / 1,07 / 1,03 |

- **Lo que manda es el ancho de la fila a través de la cara,** como en F2-2 con los pilares. Refinar a lo largo de la cara no cambia nada. LV-2 lo atribuía al reparto a lo largo de la cara («puntos cada 0,75 m»): no es eso.
- **La triangulación sola ya da el 0,97 con h = 0,75.** Su siembra se gradúa desde la esquina del paño, con elementos de 5–10 cm junto al pilar. La rejilla pone allí un cuadrado de 0,72 m.

### 1.2 El coste de refinar la cara entera

| Edificio objetivo, 7 plantas | Hoy (LV1) | Tercios en toda la cara | 1/6, 1/3, 2/3 | Triangulación junto a los pilares |
|---|---|---|---|---|
| Con vigas (C2) | 112 119 ecuaciones | 310 800 | 436 590 | 172 725 |
| Reticular con vigas | 161 049 | 323 799 | 330 435 | 253 449 |

El perfil móvil admite 200 000. El edificio objetivo tiene vigas en todos los ejes y zunchos a mitad de vano: por planta, 50 caras de lado a lado. Partir la primera fila de todas ellas triplica la malla.

### 1.3 Basta la esquina del paño

Para separar lo local de lo de toda la cara: 3 × 3 recuadros de 7,2 m (reticular 25+5, vigas y pilares de 30 × 30 en todos los ejes, 10 kN/m²). Error de la viga frente a la malla de 0,1 (49 722 nudos):

| Malla (nudos) | Viga de borde, cara del pilar interior: M / V | Viga interior, cara del pilar interior (lado del vano central): M / V | Viga interior, lado del vano extremo: M / V | Viga de borde, M en el centro del vano |
|---|---|---|---|---|
| h = 0,75 (1 362) | +41,8 / +36,1 % | +72,9 / +39,0 % | +1,0 / −43,6 % | +10,9 % |
| Tercios en toda la cara (2 394) | +11,3 / +10,7 % | +20,5 / +9,5 % | +3,2 / −12,3 % | +8,5 % |
| Triangulación sólo en las celdas junto a los pilares (2 034) | +5,4 / +4,3 % | +9,1 / +3,9 % | +1,8 / −5,6 % | +8,4 % |
| h = 0,5 (3 018) | +26,7 / +23,8 % | +46,9 / +24,0 % | +4,7 / −27,7 % | +5,3 % |
| h = 0,25 (9 402) | +12,1 / +11,0 % | +21,6 / +9,7 % | +4,1 / −12,2 % | +1,6 % |

- **Refinar sólo junto a los pilares da en sus caras lo mismo o mejor que la malla uniforme de 0,25,** con la quinta parte de nudos, y mejor que los tercios en toda la cara.
- **En las caras de los pilares interiores, la malla uniforme converge muy despacio:** +73 %, +47 % y +22 % con 0,75, 0,5 y 0,25, y la malla de 0,1 no es aún el límite (§1.6).
- **El momento en el centro del vano de la viga de borde** queda un 8–11 % alto con cualquier variante de 0,75. Depende de la malla de todo el paño, no de la esquina, y es del lado seguro.

### 1.4 Las franjas (LV-3)

Retícula de 4 × 4 de `validacion/lv/franjas.ts`: superior de ELU en las estaciones de las caras de las vigas (respecto al máximo de la franja, como en LV) y máximo inferior de vano.

| Malla | Frente a h = 0,25: apoyos / vano (máximo) | Frente a h = 0,125 |
|---|---|---|
| Unión de antes («eje»), h = 0,75 | 16,3 / 6,9 % | 11,7 / 4,5 % |
| Hoy (LV1), h = 0,75 | 41,3 / 33,6 % | 44,1 / 27,2 % |
| Tercios en toda la cara | 17,9 / 29,6 % | 20,7 / 17,5 % |
| Triangulación junto a los pilares | 56,1 / 32,9 % | 53,1 / 27,3 % |
| h = 0,5 uniforme | 16,7 / 7,2 % | 21,5 / 17,6 % |

La mediana es pequeña en todas: ≤ 1,2 % en apoyos y ≤ 3,5 % en vano. Los peores:
- **en la esquina de un pilar:** la franja de borde Y1 en la cara de la viga junto a un pilar de fachada, 16,2 frente a 28,9 kN·m/m (−44 %). Con tercios, 29,0;
- **en la esquina de un paño sin pilar,** donde un zuncho a mitad de vano llega a la viga (Y4, Y19: −34…−41 %, con valores pequeños, de 8 a 12 kN·m/m);
- **en la cara de un zuncho junto al cruce con la viga** (X7) **o en la tira de 25 cm entre la viga y el hueco de la escalera** (X14): no convergen (33,9 / 36,3 / 41,0 y 26,7 / 27,5 / 32,4 kN·m/m con h = 0,5 / 0,25 / 0,125).

**La triangulación junto a los pilares empeora las caras de los pilares interiores** (Y15: 22,5 frente a 51,3; con la malla de hoy, 51,0): su siembra graduada pone nudos a menos de ε_snap de la huella de un pilar de 40 que asoma 5 cm de la viga de 30, que se hacen rígidos (F2-9). La plantilla tiene que ser estructurada y no acercarse a la huella (F2-e).

**El criterio del usuario para las franjas («no peor que la unión de antes, 16 %») no lo cumple ni la malla uniforme de 0,5.** La unión por las caras tiene estaciones que la de antes no tenía (en las caras de los zunchos, en las esquinas de los paños), y algunas no convergen. Propuesta en §3 (criterio 3) y §4.

### 1.5 Dónde están los cuadriláteros malos (LV-8)

- **Pilar que asoma de la viga** (las retículas al azar, la triangular, el núcleo de A2): un pilar de 30 × 50 o 40 × 40 bajo una viga de 30 sobresale 5–10 cm de la cara, y la triangulación une los nudos de la cara con la esquina de la huella por astillas (jacobiano 0,109–0,19).
- **Vigas curvas** (la familia circular, 42 cuadriláteros): junto a la cara de las vigas del perímetro, una poligonal con nudos muy juntos, la triangulación une un punto interior con muchos de ellos en abanico (0,134). Están a más de 2 m de los pilares. Con la unión por el eje no salían.

### 1.6 La viga en la cara de un pilar interior no converge como el resto

El 3 × 3 de §1.3 con malla uniforme, hasta h = 0,055 (con ε_snap = 0,025: con 0,05, h no baja de 0,1; la malla de 0,1 da lo mismo con los dos):

| h (nudos) | Viga interior, lado del vano central: M / V (kN·m, kN) | Viga interior, lado del vano extremo: M / V | Viga de borde, cara del pilar interior: M |
|---|---|---|---|
| 0,25 (9 402) | −82,1 / −185,1 | −68,0 / 139,2 | −51,1 |
| 0,15 (22 794) | −73,2 / −174,5 | −66,7 / 151,2 | −47,7 |
| 0,1 (49 722) | −67,5 / −168,8 | −65,4 / 158,6 | −45,6 |
| 0,07 (101 754) | −63,3 / −165,4 | −64,0 / 163,4 | −44,1 |
| 0,055 (162 402) | −61,1 / −163,9 | −63,0 / 165,9 | −43,2 |

- **Converge más despacio que con orden 1:** las diferencias entre mallas seguidas no bajan con el paso (5,7, 4,1 y 2,3 kN·m para Δh de 0,05, 0,03 y 0,015). El límite del momento del lado del vano central queda por debajo de 61 kN·m, quizá hacia 45–53. En el recuadro de CY-10, con pilares de esquina, sí converge (−3,36 / −3,42 / −3,43 con 0,25 / 0,12 / 0,10).
- **La causa probable es la reacción de esquina de la losa** (la fuerza de esquina de las placas): llega a la viga en el primer elemento junto a la cara, con un brazo hasta ella del orden de ese elemento. Por eso basta refinar la esquina, y por eso cuanto más fino el elemento de la esquina, mejor.
- **Con h = 0,75, del lado inseguro, el cortante:** del lado del vano extremo, 89 kN frente a 166 con 0,055 (−46 %). Del lado del vano central el momento y el cortante salen altos (lado seguro).
- **Para el usuario:** en el periodo en sombra, el momento de las vigas en la cara de un pilar interior dependerá de la malla de cada programa (el emparrillado de CYPE tiene su primer cruce a 12 cm de la cara).

## 2. Cómo se hace

### 2.1 La plantilla de esquina

En cada **esquina de un paño de losa en la que se encuentran dos caras de viga** (o una cara de viga y la huella de un pilar), la celda de la rejilla de esa esquina se rehace con una red estructurada:
- **graduada hacia las dos caras:** tercios del primer tramo junto a cada una (F2-a), con la transición de 3 a 1 dentro de la misma celda (las plantillas de F2). Si en el paso 1 (§2.5) la viga interior no llega al criterio 2, un nivel más en el elemento de la esquina;
- **el borde de la celda hacia la losa no cambia** (sus esquinas y, si va partida, su punto medio), así que la costura con la rejilla y la triangulación es la de hoy. Por las caras puede llevar nudos de más: al otro lado está el ancho de la viga, que no tiene láminas;
- **los lados de la huella que asoma son ejes de la red** (LV-c): el trozo del pilar que sobresale de la cara entra en la plantilla y no deja astillas;
- **ningún nudo nuevo a menos de 2·ε_snap de una huella** salvo los suyos (F2-e), para no crear nudos rígidos;
- **guarda de calidad:** convexo y jacobiano ≥ 0,2 (F2-d). Si no la pasa, la celda queda como hoy, con el aviso `malla/esquina-sin-refinar`.

Si la esquina cae en la triangulación (hay rasgos cerca), se le da un tamaño local en la siembra junto a la esquina, con la misma distancia mínima a la huella.

### 2.2 Qué esquinas

- **Las de los pilares,** siempre.
- **Las de los cruces de vigas sin pilar** (un zuncho que llega a una viga), según §1.4 y el tamaño (decisión LV2-c).
- Las vigas de otras secciones y las de los muros quedan como hoy (con la losa por el eje).

### 2.3 Las vigas curvas (LV-c)

Se mira por qué el refinamiento de Delaunay (G-4) no quita los abanicos junto a las caras de las vigas curvas y se corrige allí. Si no se puede sin cambiar la malla de C2–C5, el aviso se queda y se explica.

### 2.4 Opción y versión

- Opción **`refinoEsquinas`**, por defecto sí. Con `false`, la malla de LV1 bit a bit.
- Con `unionLosaViga: "eje"` no cambia nada.
- Compilador **LV2**.

### 2.5 Orden, con una puerta

1. **La plantilla de esquina en la rejilla,** sólo para medir: criterios 1, 2 y 5. **Puerta:** si el reticular objetivo pasa de 200 000 ecuaciones o la viga interior no llega, se para y se decide (§4, LV2-d).
2. Las huellas que asoman (LV-c) y las esquinas en la triangulación.
3. Las vigas curvas.
4. Franjas, determinismo, respaldo, referencias congeladas, banco y la vivienda.

## 3. Criterios

| # | Criterio | Cómo se mide |
|---|---|---|
| 1 | **Recuadro de CY-10:** momento y cortante de la viga en la cara del pilar a ≤ 5 % del emparrillado de CYPE con h = 0,75 (hoy, 0,79 y 1,25) | `validacion/lv/recuadro.ts` |
| 2 | **Vigas interiores:** en el 3 × 3 de §1.3, con h = 0,75, el momento y el cortante de cada viga en la cara de cada pilar a no más distancia de la malla de 0,055 que con la malla uniforme de 0,25 (hoy, el momento del lado del vano central a +91 % y el cortante del lado del vano extremo a −46 %; con 0,25, +34 % y −16 %) | Script nuevo en `validacion/lv2/` |
| 3 | **Franjas** (la retícula de 4 × 4, con h = 0,75, frente a h = 0,125): no más estaciones de apoyo por encima del 20 % que con la malla uniforme de 0,5, y las que no convergen, listadas con su causa. *Cambiado el 2026-10-16:* antes pedía además ≤ 5 % en las caras junto a un pilar, que no cumple ni h = 0,5 uniforme (16,4 %) | `validacion/lv2/franjas.ts` |
| 4 | **Calidad:** ningún aviso `malla/calidad` ni `malla/esquina-sin-refinar` en las 44 geometrías de G, el núcleo de A2, los edificios objetivo y los modelos de validación (hoy: 16 retículas, la circular, la triangular y el núcleo) | `geometrias.test.ts`, pruebas nuevas |
| 5 | **Tamaño:** el edificio objetivo con vigas y el reticular objetivo, ≤ 200 000 ecuaciones (hoy, 112 119 y 161 049) | Banco |
| 6 | **Determinismo:** la misma malla al trasladar, girar, reordenar, con ruido < ε_geom, en V8 y JavaScriptCore y con «Renumerar». Con `refinoEsquinas: false` o `unionLosaViga: "eje"`, bit a bit | Metamórficas, huellas |
| 7 | **Respaldo:** con un fallo forzado en una esquina o en la planta, compila, avisa y da la malla sin refinar | Pruebas |
| 8 | **La vivienda:** no empeora frente a LV1 (momentos de vano, flechas y axiles frente a CYPE) | `validacion/sombra/vivienda/` |
| 9 | **Referencias congeladas:** las cinco de LV (`-lv`), regeneradas a sabiendas; las de antes, idénticas | `congelado-*.test.ts` |
| 10 | **Coste:** compilar y calcular el edificio objetivo con vigas, ≤ +25 % frente a LV1 | Banco |

## 4. Para el usuario, antes de seguir

| # | Decisión | Propuesta | Por qué |
|---|---|---|---|
| LV2-a | Dónde se refina | En la esquina de cada paño, no a lo largo de toda la cara | La cara entera no cabe (§1.2); la esquina da lo mismo que h = 0,25 (§1.3) |
| LV2-b | Criterio de las vigas interiores | Además del recuadro (criterio 1, frente a CYPE), el 3 × 3: no peor que la malla uniforme de 0,25, frente a la de 0,055 (criterio 2) | En la cara de un pilar interior la viga no converge como el resto: un 5 % frente a la malla fina no lo da ni h = 0,1 (§1.6) |
| LV2-c | Las esquinas sin pilar (cruces de vigas) | Sí, si caben en el perfil móvil. Con las cuentas de LV2-d caben en el edificio con vigas, pero no en el reticular objetivo | Allí están dos de los tres peores apoyos de LV-3 (§1.4) |
| LV2-d | Si el reticular objetivo no cabe | Primero la plantilla ligera (la de esquina de F2, sólo en el elemento de la esquina); si tampoco, sólo las esquinas de los pilares; y si tampoco, aceptar que el reticular objetivo pase del perfil móvil | Está en 161 049: quedan unas 39 000 ecuaciones, unas 22 por esquina con sólo las de los pilares (1 764) y unas 11 con los cruces sin pilar (3 528). La plantilla con tercios y transiciones cuesta unas 40 (estimado) y la ligera, unas 15. En el edificio con vigas (112 119) quedan 88 000: 50 y 25 por esquina |
| LV2-e | Criterio de las franjas | El criterio 3 en lugar de «no peor que la unión de antes» | Ni la malla uniforme de 0,5 lo cumple (§1.4) |

**Decidido por el usuario el 2026-10-15:** las cinco como se proponen, con un cambio en LV2-d: **manda la precisión, no el tamaño.** La plantilla se elige por los criterios 1 a 3; la ligera, sólo si los cumple. Si sólo los cumple la de tercios y el reticular objetivo pasa de 200 000 ecuaciones, se acepta que pase del perfil móvil (es un caso extremo: reticular con ábacos y vigas en todos los ejes; en sobremesa calcula sin problema, y «aun en el edificio objetivo vamos bastante bien de tiempo: CYPECAD o SAP2000 tardan mucho en calcular»). El primer paso es el prototipo de la plantilla de tercios en las esquinas de pilares y cruces, y sus números (criterios 1, 2, 3 y 5) antes de rematar.

## 5. Fuera de esta fase

- **LV-b** (el tamaño donde la rejilla no entra): aceptado por ahora.
- **El momento de vano de las vigas** con h = 0,75 (+8–11 %, del lado seguro): sólo baja con h.
- **Las estaciones que no convergen** (la cara de un zuncho junto al cruce y la tira junto al hueco): se listan. Si hace falta, un aviso como `franja/esquina-entrante`.
- **El `my` de la cubierta y P5** de la vivienda: justo después.

## 6. Paso 1: el prototipo (2026-10-15)

En `rejilla.ts` (§8 de su cabecera), con la opción `refinoEsquinas`, **por defecto desactivada hasta rematar la fase**: con ella desactivada pasan las 710 pruebas del compilador y las referencias congeladas no cambian. Se probaron dos plantillas en la celda de la esquina (partida en 4):
- **de tercios:** el elemento de la esquina en 3 × 3 con transiciones de 3 a 1, y con dos niveles otra vez en su subelemento;
- **graduada:** el elemento de la esquina partido en 3 hacia ella (un cuarto y dos trapecios), varias veces. Cada nivel cuesta un nudo interior y dos en las caras.

Los nudos nuevos quedan a ≥ 1,5·ε_snap de la huella de cualquier pilar (también las tapadas por las vigas), para no hacerse rígidos (C2-d): con 2·ε_snap se perdía el nivel más fino incluso con una huella que sólo toca la esquina. Si no caben todos los niveles, se usan los que quepan.

| | Criterio 1: recuadro, M / V en la cara frente a CYPE | Criterio 2: 3 × 3, peor cara frente a h = 0,055 (nudos) | Criterio 5: con vigas / reticular (ecuaciones) |
|---|---|---|---|
| LV1 | 0,79 / 1,25 | +91,1 % (1 362) | 112 119 / 161 049 |
| Tercios, dos niveles | 0,97 / 1,02 | +5,5 % (2 706) | 365 379 / 340 998 |
| **Graduada, tres niveles** | **0,96 / 1,02** | **+7,7 % (1 830)** | **156 177 / 204 750** |
| h = 0,25 uniforme | 0,97 / 1,07 | +34,4 % (9 402) | — |

- **La graduada de tres niveles pasa los criterios 1 y 2, y el 5 en el edificio con vigas.** El reticular objetivo pasa del perfil móvil un 2 % (204 750), lo que LV2-d acepta. Es la propuesta: casi la precisión de la de tercios con un tercio de su coste. Con cuatro niveles el último elemento ya no cabe.
- **En el 3 × 3 sólo queda peor que h = 0,25 el momento de centro de vano** (+9 %, fuera de esta fase, §5) y un cortante a 0,6 % frente a 0,2 %.
- **El criterio 3 (franjas) no pasa.** En la retícula de 4 × 4 (`out_franjas.txt`), el peor de los apoyos baja del 44,1 al 39,7 % y el de vano, del 28,2 al 20,3 %; junto a un pilar sigue hasta el 39,7 %. Todos los peores están en caras junto a pilares que asoman de la viga (40 × 40 y 30 × 50 bajo vigas de 30): allí lo que asoma es rígido (C2-d), la plantilla se queda en uno o dos niveles y la estación depende de esos nudos rígidos (F2-9). Es el paso 2 (§2.1, LV-c).
- **El tiempo:** compilar y calcular el edificio con vigas pasa de 7,3 a 10,6 s (+45 %; el criterio 10 pide ≤ +25 %, a mirar al final). *Corregido en §10: medido con la máquina cargada; con el paso 2 y en limpio, +72 %.*

Medido con `validacion/lv2/recuadro.ts`, `vigas.ts`, `banco.ts` y `franjas.ts` (salidas `out_*.txt`).

## 7. Paso 2: la plantilla a los dos lados de cada viga (2026-10-16)

**Lo que estropeaba las franjas no era lo que asoma de los pilares.** El paso 1 lo atribuía a las huellas que asoman de la viga (§6). Medido en la retícula de 4 × 4:
- **con todos los pilares de 30 × 30** (nada asoma), la plantilla quitaba lo mismo;
- **sumando toda la cara de Y6 en un paño** (5,15 a 9,85 m), todas las mallas uniformes (de 0,75 a 0,0625) y LV1 dan −135 kN·m, y la plantilla daba −123,5: faltaba un 9 % del momento total, no se repartía distinto;
- **la causa:** la plantilla iba sólo a un lado de la viga. La celda del otro lado no llevaba la suya por tres motivos:
  - no estaba partida en u (0,65 m: la corta la línea de la zona de carga Qz en x = 6,8);
  - el grupo mínimo la había devuelto a la triangulación;
  - la celda del ancho de la viga junto a ella era «irregular» por un rasgo cercano, no «fuera».

  La losa refinada toma menos momento que la del otro lado, y la viga, con la torsión ×0,1 de D4, se tuerce: torsor de 1,2 kN·m junto al pilar frente a 0,05 en la malla fina, y giro de −0,117‰ a 0,27 m del pilar frente a −0,077‰. La losa del lado refinado pierde hasta un 30 % en la cara;
- **lo que asoma sí cortaba niveles sin motivo:** la guarda del paso 1 rechazaba todo nudo a menos de 1,5·ε_snap de una huella, también los de la cara, que van a la viga aunque toquen la huella (`unirCaras`).

**Cambios en `rejilla.ts`** (detrás de `refinoEsquinas`, que sigue desactivada; §8 de su cabecera):
1. **La guarda sigue la regla de `losas.ts`:** un nudo de la cara se rechaza sólo si cae dentro de una huella; uno de dentro de la losa, a menos de 1,2·ε_snap (antes, todos a 1,5·ε_snap).
2. **Plantilla también en celdas partidas en 2 o en 1:** el elemento de la esquina es la mitad de la celda o la celda entera.
3. **Por cruces:** las esquinas en diagonal con la celda de un cruce de vigas llevan todas la plantilla, con los mismos niveles, o ninguna.
4. **Fuera de las losas, por el centro de la celda,** no por su estado.
5. **El grupo mínimo no devuelve a la triangulación un grupo con una esquina.**
6. **Una esquina de la triangulación no se refina.** Junto a un pilar deja su cruce sin refinar; lejos de los pilares (el cruce de un zuncho), no impide refinar las demás.
   - Se probó a darle en la siembra el tamaño del elemento más fino de la plantilla. Salen cuadriláteros malos (0,17 en el reticular objetivo) y nudos rígidos junto a lo que asoma. Con el tamaño del primer nivel, la siembra ya no actúa.

**En `mallado.ts`:** una arista de la interfaz que la plantilla parte en más de dos se restringe por sus nudos. Pasa cuando el ancho de la viga, al otro lado de la cara, es irregular; antes la triangulación fallaba con «Constraining edge intersects point».

**En `validacion/lv2/franjas.ts`:** `junto` tomaba el giro de los pilares de 30 × 50 al revés (con giro 0, el canto h va según X). Ahora también cuenta las estaciones de apoyo por encima del 10 % y del 20 %.

| Retícula de 4 × 4, frente a h = 0,125 | Apoyos: mediana / máx | Vano: mediana / máx | Apoyos > 10 % / > 20 % (de 352) |
|---|---|---|---|
| LV1, h = 0,75 | 1,2 / 44,1 % | 3,0 / 28,2 % | 58 / 13 |
| Paso 1, h = 0,75 | 1,2 / 39,7 % | 3,0 / 20,3 % | — |
| **Paso 2, h = 0,75** | **0,9 / 39,3 %** | **3,0 / 23,1 %** | **53 / 6** |
| LV1, h = 0,5 uniforme | 0,8 / 25,7 % | 1,0 / 27,7 % | 33 / 6 |

- **El peor que queda,** X13 en la cara derecha de P12-10 (−39 %), está en un cruce sin refinar: su esquina de arriba a la derecha cae en la triangulación por la esquina del hueco de la escalera. Converge (37 / 50 / 53 / 61 / 61 kN·m/m con h = 0,75 / 0,5 / 0,25 / 0,125 / 0,0625) y LV1 da lo mismo (37).
- **Los siguientes, entre −24 y −25 %:**
  - Y20, en la zona de triangulación que dejan la carga lineal T y la zona Qz;
  - X18, en la cara de Y12 lejos de los pilares, que converge despacio (8,6 / 10,3 / 12,7 / 13,2 / 14,0);
  - Y7, en la cara de X5 a 0,1 m de la esquina de P6-5 sin tocarlo. Empeora con la plantilla: −24 %, frente al −7 % de LV1.
- **El máximo de vano,** del lado seguro (X2, +23 %), está también en esa zona. Allí LV1 da −14 % en X2 y −28 % en X6.
- **Las estaciones de las caras de Y6, junto a P6-0 y P6-10, ya no están entre las peores.** Antes llegaban al −40 %.

**Los otros criterios:**
- **1 y 2:** como en el paso 1 (0,96 / 1,02 de CYPE; +7,7 % frente a h = 0,055). Esos modelos ya eran simétricos.
- **5:** el edificio con vigas, 163 695 ecuaciones; el reticular, 213 675 (antes, 156 177 y 204 750; con LV2-f, 213 801: menos esclavos). Ningún cuadrilátero bajo en los dos. Los dos edificios llevan el aviso `malla/esquina-sin-refinar` (§8): su hueco de escalera deja cruces sin refinar.
- **8:** la vivienda, igual que con LV1 (`.datos/out_lv2_esquinas.txt`: axiles, momentos y flechas frente a CYPE a ±0,01).
- **4:** en las 44 geometrías de G, 21 con el aviso de calidad (20 con LV1; el peor, 0,109 en las dos). Son los de LV-8: las esquinas de la huella que asoma 5–10 cm de la cara quedan como puntos sueltos de la triangulación, que une con astillas y cuyos nudos cercanos se hacen rígidos.
- **Pruebas:** las 710 del compilador, sin cambios.

**Para el usuario:**
- **LV2-f, lo que asoma (LV-8):** no es lo que estropeaba las franjas, pero deja el criterio 4 sin cumplir. Propuesta: el trozo de la huella que asoma dentro del ancho de la viga se quita de la losa, como el ancho, y su borde se une al pilar. La cara de la losa sigue el contorno del pilar sin puntos sueltos. Lo que cae en él pasa al pilar, exacto, como hoy lo de la huella.
- **LV2-g, los cruces que no se pueden refinar a la vez:** junto a un hueco o a rasgos de cargas, un cruce con pilar se queda como en LV1. Para refinarlo haría falta una versión de la plantilla para la triangulación, con la misma geometría que la de la rejilla y lejos de las huellas. Propuesta: aceptarlo y avisar (`malla/esquina-sin-refinar`, ya previsto en §2.1) en las caras de esos pilares.
- **El criterio 3 tal como está escrito no se cumple:** máximo de apoyos 39,3 % frente al 25,7 % de h = 0,5, y junto a un pilar ≤ 5 %. El siguiente junto a un pilar es X19 junto a P12-15 (−20,9 %). Ni h = 0,5 uniforme baja de 16 %.

**Decidido por el usuario el 2026-10-16:**
- **LV2-g: sí, aceptarlo y avisar.** En esos cruces queda la malla de LV1, que da lo mismo que hoy; sólo pasa cuando una esquina de un cruce con pilar cae en la triangulación (junto a un hueco o a una línea de carga), y refinarlos exige una plantilla propia para la triangulación, que en la prueba dio cuadriláteros malos y nudos rígidos. El aviso dice al ingeniero dónde mirar. Hecho en §8.
- **LV2-f: sí, pero como paso propio y midiendo antes.** No es sólo un aviso de calidad: junto a las astillas la triangulación pone nudos que se hacen rígidos con el pilar (una docena en la retícula de 4 × 4) y rigidiza la losa junto a él, como en F2-9. Un pilar de 40 × 40 bajo una viga de 30 es lo más corriente en obra. Como toca losas, cargas y mallador, primero se mide en las retículas al azar cuánto se mueven los momentos junto a esos pilares; si es poco, se deja para más adelante.
- **El criterio 3 cambia** (§3): no más estaciones de apoyo por encima del 20 % que con h = 0,5 uniforme, y las que no convergen, listadas.
- **Orden:** LV2-g y el criterio 3; LV2-f con la medida previa; los pasos 3 y 4 (vigas curvas, determinismo, referencias congeladas). Antes de activar `refinoEsquinas` por defecto se mira Y7, la única estación que empeora frente a LV1 (−24 % frente a −7 %).

Medido con `validacion/lv2/franjas.ts`, `recuadro.ts`, `vigas.ts` y `banco.ts` (salidas `out_*.txt`), y la variante `lv2-esquinas` de la vivienda.

## 8. LV2-g y el criterio 3 nuevo (2026-10-16)

**El aviso `malla/esquina-sin-refinar`.** Cuando ningún nivel de la plantilla cabe en todas las esquinas de un cruce, la rejilla anota los pilares del cruce (`esquinasSinRefinar` de `rejilla.ts`): los que la triangulación tomaría como «junto a un pilar», a menos de 2·`separacionRefino` más el elemento de un nivel de alguna de sus esquinas. El mallador da un aviso por causa:
- **una esquina cae en la triangulación** (junto a un hueco, una carga u otro rasgo que no sigue la rejilla), lo de LV2-g;
- **la plantilla no cabe o no tiene calidad,** lo previsto en §2.1.

El aviso nombra los pilares en el mensaje y en sus objetos (para que la app los señale), y no cambia ninguna malla. Un cruce sin pilar (el de un zuncho) no avisa. Prueba: `src/compilador/esquinas.test.ts`.

**En la retícula de 4 × 4** con h = 0,75 avisa de P12-10, P12-15, P18-10 y P18-15, las cuatro esquinas del hueco de la escalera. Con h = 0,5 o con `refinoEsquinas: false`, de ninguno.

**Criterio 3** (`validacion/lv2/franjas.ts`, `out_franjas.txt`): estaciones de apoyo por encima del 20 %, **6 con LV2 frente a 6 con h = 0,5 uniforme: pasa.** Las seis, al refinar (kN·m/m):

| Estación | 0,75 | 0,5 | 0,25 | 0,125 | Causa |
|---|---|---|---|---|---|
| X13, cara derecha de P12-10 | 37,0 | 49,9 | 53,1 | 61,0 | Cruce sin refinar (con aviso). Converge: 61 también con 0,0625 (§7) |
| Y20, en x = 4,85 | 9,1 | 12,4 | 12,4 | 12,4 | Triangulación por la carga lineal T y la zona Qz; converge desde 0,5 |
| X18, cara de Y12 | 8,6 | 10,3 | 12,7 | 13,2 | Cara de la viga lejos de los pilares; converge despacio (14,0 con 0,0625, §7) |
| Y7, cara de X5 junto a P6-5 | 25,5 | 29,0 | 31,7 | 33,4 | La capa límite de mxy en la cara (§11): su mx está a −7 %, y el −7 % de LV1 eran dos errores compensados |
| X19, cara de P12-15 | 16,1 | 24,7 | 21,9 | 22,5 | Cruce sin refinar (con aviso) |
| X19, cara de P18-15 | 6,3 | 6,9 | 11,4 | 12,6 | Cruce sin refinar (con aviso) |

Ninguna deja de converger: tres están en los cruces del aviso, y las otras tres son la triangulación junto a las cargas, una cara de viga lejos de los pilares y Y7.

**Pruebas:** las 712 del compilador (710 y las dos nuevas).

## 9. LV2-f: los nudos rígidos junto a lo que asoma (2026-10-16)

**Medida previa** (`validacion/lv2/asoma.ts`, `out_asoma.txt`). Lo que asoma un pilar de la viga que lo atraviesa (un 40 × 40, 30 × 50 o 25 × 60 bajo una viga de 30) deja junto a la huella nudos a unos centímetros de ella, y C2-d los hace rígidos con el pilar (los de fuera a ≤ ε_snap). Quitar de la losa la tira que asoma no cambia nada por sí solo: sus nudos ya eran todos rígidos. Lo que pesa son los de fuera. En las 24 retículas al azar de G, con LV2 y h = 0,75, frente a la malla de 0,25 con sólo la huella rígida (599 caras de viga y 536 estaciones de apoyo de franjas junto a los pilares que asoman, 255 entre todas las plantas; diferencias respecto al máximo de la viga o de la franja):

| | Vigas en la cara: mediana / máx | > 10 % | Franjas junto al pilar: mediana / máx | > 20 % | Jacobiano mínimo |
|---|---|---|---|---|---|
| A: hoy (los de fuera a ≤ ε_snap, rígidos) | 1,2 / 21,1 % | 34 | 6,0 / 78,0 % | 66 | 0,11–0,50 |
| **B: sólo la huella y su borde, rígidos** | **0,9 / 12,7 %** | **1** | **5,1 / 53,1 %** | **36** | igual que A |
| C: la huella que asoma ≤ 0,3 m no se siembra (como las tapadas) | 1,5 / 20,8 % | 35 | 7,2 / 171,9 % | 104 | 0,12–0,50 |
| D: C con la regla de B | 1,2 / 20,6 % | 8 | 6,5 / 171,9 % | 89 | 0,12–0,50 |
| A con h = 0,25 | 0,1 / 15,6 % | 10 | 0,1 / 86,9 % | 22 | — |

- **Los nudos rígidos de fuera importan, y no se van al refinar.** Con ellos, la viga sale en la cara del pilar hasta un 21 % alta, y las franjas, hasta un 78 % bajas (del lado inseguro: X20 de la retícula 18, en la cara de un pilar de fachada). Sin ellos, esas estaciones quedan a ±3–11 %. Con h = 0,25 el efecto sigue (87 %), como en F2-9.
- **C y D mejoran la malla** (en las retículas con astillas, el jacobiano mínimo pasa de 0,12–0,13 a 0,23–0,32, y hay hasta un 20 % menos de nudos), **pero las franjas empeoran:** sin la huella sembrada se pierden estaciones de cara que hoy salen bien (hasta un 172 % en la retícula 23). Descartadas.
- La columna «rígidos fuera» de la salida cuenta también los nudos de las caras de las vigas en su zona rígida en el pilar, que `unirCaras` une a la huella a propósito (C1-a). Con B, sólo quedan ésos.

**Hecho (B), detrás de `refinoEsquinas` como el resto de LV2:** en un pilar con el ancho de una viga sobre su centro (también en su borde: el extremo de una viga o una losa que acaba en su eje), sólo son esclavos de la huella los nudos dentro de ella o en su borde (a 10·ε_geom), no los de fuera a ≤ ε_snap (`losas.ts`, C2-d). Los demás pilares siguen como estaban (F2-9 queda aparcado). La malla no cambia. (`MEDIDA_LV2F`, el interruptor con el que se reprodujeron A, C y D, se quitó en §10: la tabla de arriba y el commit `1f46a20` son el registro.)

**Los criterios, con LV2-f:**
- **1 y 2:** sin cambios (en el recuadro y en el 3 × 3 no asoma ningún pilar).
- **3:** 4 estaciones de apoyo por encima del 20 %, frente a 6 con h = 0,5 uniforme (antes de LV2-f, 6): pasa. Sale de la lista X19 junto a P12-15.
- **4 (calidad):** sin cambios; LV-8 sigue abierto. El jacobiano bajo junto a lo que asoma sólo lo arreglan C y D, a costa de las franjas.
- **8 (la vivienda):** igual (dos axiles se mueven 0,1 kN; `.datos/out_lv2_f.txt`).
- **Pruebas:** las 714 del compilador; `src/compilador/esquinas.test.ts` comprueba que con LV2 no queda ningún nudo rígido fuera de la huella de un pilar con viga, salvo los de las caras, y que con la regla de antes quedan más de 100.

## 10. Auditoría del diagnóstico de la fase (2026-10-16)

Tras LV2-f se revisó contra el repo el diagnóstico de la fase y del mallador. Lo que no se sostenía tal cual:
- **El coste no era +45 %, sino +70 %.** El +45 % era del paso 1, y el banco del paso 2 estaba medido con la máquina cargada (el reticular LV2 «calculaba» más rápido que LV1 con 50 000 ecuaciones más). En limpio (`out_banco.txt`): el edificio con vigas, de 3,2 + 3,9 s a 6,6 + 5,7 s (+72 %); el reticular, de 5,3 + 4,7 s a 10,3 + 6,8 s (+70 %). La compilación se duplica; el cálculo sube un 45 %. El criterio 10 (≤ +25 %) no se cumple.
- **«LV2-f resuelto» era demasiado:** con la regla nueva quedan 36 de 536 estaciones de franja junto a pilares por encima del 20 % con h = 0,75 (124 por encima del 10 %).
- **La referencia de `asoma.ts` lleva la regla que evalúa** (B con h = 0,25): «no converge» significa que A y B convergen a soluciones distintas. Que B sea la física correcta (5 cm fuera de la cara no es pilar; CYPE y SAP no rigidizan fuera de la huella) es razonable, pero no está contrastado con un oráculo externo.
- **LV-8 no está agotado:** C y D eran atajos; la plantilla de §2.1 (los lados de lo que asoma como ejes de la red) no se ha probado. Y que C y D pierdan estaciones es en parte del medidor: el escalón (SP-3, SP-4) necesita la huella sembrada.
- **LV2-g no es poco habitual:** el aviso salta en los dos edificios objetivo.
- **Extender la regla de LV2-f a todos los pilares (F2-9) interactúa con el escalón de F3 y F3-d,** que cuenta lo que transmite la huella por los nudos rígidos de delante de la cara (`esfuerzosFranjas.ts`). Cambia la medida de las franjas en todos los pilares y la referencia congelada de F: es una fase con su medida, no un ajuste.

Lo que faltaba:
- **LV2-f activa los elementos malos de LV-8.** Un cuadrilátero con los cuatro nudos a ≤ ε_snap de la huella era rígido entero, inerte; ahora sus nudos de fuera son libres y ese elemento de jacobiano 0,11 trabaja. El cálculo es válido, pero LV-8 pasa de aviso de calidad a asunto de precisión.
- **Nada de LV2 llega al usuario:** `refinoEsquinas` sigue en `false` y las referencias congeladas no lo cubren.
- **`MEDIDA_LV2F` era un global mutable del compilador** fuera de las opciones y de la huella (misma huella, resultados distintos). Quitado. `UMBRAL_REFINO` y `PLANTILLA_ESQUINA` (`rejilla.ts`) tienen el mismo problema y quedan anotados.
- Los criterios 2, 3 y 8 no tienen oráculo externo; sólo el 1.
- **El aviso de respaldo salía vacío** en una planta que sólo refinaba esquinas («junto a las caras de  no se ha refinado»). Arreglado: sin pilares, el aviso es `malla/esquina-sin-refinar` y dice que son las esquinas de los paños.

**Orden acordado con el usuario:**
1. Antes de activar `refinoEsquinas` por defecto: entender Y7 (hecho, §11; LV2-h, hecha, §12); LV-8 con la plantilla de §2.1, medida con `asoma.ts`; decidir el coste (+70 %; la compilación duplicada tiene margen, el cálculo no); el aviso vacío y `MEDIDA_LV2F` (hechos); referencias congeladas `-lv2`.
2. C2-d a todos los pilares como fase propia (reabrir F2-9): `asoma.ts` ampliado a los pilares sin viga, decidir el escalón de F3-d, regenerar la referencia de F a sabiendas, y quitar la cota h ≥ 2·ε_snap si ya no hace falta.
3. Un oráculo externo para la rigidez de la huella: un recuadro en OpenSeesPy ASDShellQ4 con `rigidLink` sólo en los nudos de la huella.
4. Regresión de precisión local con umbrales: `asoma.ts` en CI aparte, o tres retículas en vitest con la referencia fina congelada.
5. Mientras LV-8 no esté, avisar también en los pilares que asoman de su viga.

## 11. Y7: la estación que empeoraba con la plantilla (2026-10-16)

**Qué es.** `L-N1:Y7` es la franja de 0,82 m (el intereje) de x = 4,91 a 5,73, y su estación de apoyo en la cara sur de la viga X5 (y = 4,85): a 0,07 m de la huella de P6-5 (un 40 × 40 bajo la viga Y6, de 30, que asoma 5 cm de su cara) y a 0,12 m de la esquina del paño, toda ella en el ábaco. El superior de ELU con h = 0,75: LV1 31,2, LV2 25,5, la fina (0,125) 33,4 kN·m/m (−7 % y −24 %). Medido con `validacion/lv2/y7.ts` (`out_y7.txt`), que además dibuja la malla junto al pilar.

**La plantilla sólo mete un nivel ahí.** Con dos o tres niveles, el nudo interior del elemento de la esquina (a 1/8 y 1/16 de la celda de 0,55 m) cae a menos de 1,2·ε_snap de la huella que asoma y `lejosDeHuellas` lo rechaza: el elemento de la esquina es de 0,14 m, no de 0,034, y el cruce entero va con un nivel. P6-5 no sale en el aviso de §8 porque la plantilla entra, aunque corta.

**El superior son dos cosas, y la plantilla sólo toca una** (kN·m/m; el error, frente a la fina):

| h = 0,75 | mx (fuerzas nodales) | my | mxy (campos a δ) | superior = \|mx\| + \|mxy\| |
|---|---|---|---|---|
| LV1 | −29,44 (+7,6 %) | −19,0 | −1,76 | 31,20 (−6,6 %) |
| LV2 | −25,48 (−6,9 %) | −11,3 | −0,00 | 25,48 (−23,7 %) |
| LV2, h = 0,5 / 0,25 | −26,89 / −27,57 | −15,4 / −17,2 | 2,11 / 4,17 | 29,01 / 31,74 |
| h = 0,125 (la referencia) | −27,37 | −16,5 | 6,04 | 33,41 |

Con my negativo y |mxy| < |my|, Wood–Armer da en la cara superior |mx| + |mxy|.

1. **El mx de LV2 es el bueno.** La cara entera del paño (de la cara del zuncho a la de Y6) por un solo corte da −49,8 kN·m con LV2, −50,8 con LV1 y −50,8 con la fina: el total no se mueve, cambia dónde cae a lo largo de la cara. Con LV1 los nudos de la cara van cada 0,55 m, y el reparto por mitades del lado de cada lámina (F-6) lleva a Y7 el 55 % de lo que entra por el nudo de la esquina (−11,3 kN·m, en x = 5,85, rígido con el pilar) aunque la franja acaba 0,12 m antes: +7,6 %. Con LV2 la plantilla pone nudos en 5,575 y 5,71, al de la esquina le quedan −3,5, y lo que entra por el tramo de Y7 es el de la fina (−20,8 frente a −20,6 kN·m; LV1, −15,4). Los −7 % que quedan son también el reparto por mitades: el nudo de 5,71 da el 78 % de su segunda mitad a Y8.

2. **Lo que falta es el término de mxy de Wood–Armer, y es una capa límite.** my y mxy de la estación salen del campo SPR a δ = 1 mm de la cara (F). En la fina, el mxy medio de Y7 cambia de signo a 0,12 m de la cara: −2,85 kN·m/m en el interior (d ≥ 0,3 m) y +6,04 pegado a ella, con el pico (7,5) en x ≈ 5,4, a 0,45 m de la esquina. En la cara converge despacio: 2,1 / 4,2 / 6,0 / 6,5 con h = 0,5 / 0,25 / 0,125 / 0,0625 (la última con ε_snap = 0,025, que siembra la huella que asoma y cambia Y8: sólo vale para este perfil; `--fino`, `out_y7_fino.txt`); el del interior está convergido en todas las mallas (−2,0…−2,85). LV1 con 0,75 da en todas las distancias el valor del interior (−1,8 a −2,2: su primera fila de láminas es de 0,55 m y no ve la capa); LV2 da 0,0 en la cara y −2,2 a 0,55 m (ve el arranque). El −7 % de LV1 eran dos errores compensados: el mx alto por el reparto y un mxy que no es el de la cara, pero entra en Wood–Armer en valor absoluto.

   La capa es la de un borde «duro» de Mindlin: los nudos de la cara van al eje de la viga con un enlace rígido que ata sus dos rotaciones (la torsión de la viga, con el ×0,1 de D4, y su giro de flexión), y el torsor junto a un borde así se concentra en una franja del orden de medio canto (losa de 0,35 m; capa de 0,15 m). No es cosa de la esquina ni de la huella que asoma: con todos los pilares de 30 × 30 (nada asoma y la plantilla entra con tres niveles, elemento de la esquina de 0,034 m) Y7 queda a −16,5 % con LV2 (mx −7 %; |mxy| 1,3 frente a 4,7) y LV1, otra vez por compensación, a −4,6 %. La plantilla refina la esquina del paño y la capa corre a lo largo de toda la cara.

3. **Es la causa de casi todas las estaciones de apoyo que fallan, no sólo de Y7.** En las 352 estaciones de apoyo de la retícula, LV2 con 0,75 frente a la fina (respecto al máximo de cada franja, como en el criterio 3): mediana del error del superior, 1,0 %; del |mx|, 1,4 %. Por encima del 10 % en el superior, 52, y sólo 6 de ellas también en |mx|: las otras 46 son el mxy a δ. Por encima del 20 %, 4: X13 y Y20 por el mx (el cruce sin refinar y la triangulación de las cargas, §8), X18 y Y7 por el mxy. En la fina, el término de mxy añade al superior de las estaciones de apoyo una mediana del 6 % (96 de 205 por encima del 10 %, muchas con superiores de 1,5–4 kN·m/m donde mx ≈ 0).

**Para Y7:** no es la plantilla. La plantilla arregla su mx (de +8 % a −7 %) y deja al descubierto un término que la malla gruesa nunca había tenido. Sale de los pendientes de §10 como entendida, y en la tabla de §8 su causa es la capa límite. El criterio 3 no cambia (4 frente a 6).

**Para el usuario, LV2-h: el mxy de Wood–Armer en las estaciones de apoyo y de cara.** Hoy se toma a 1 mm de la cara, dentro de una capa de ~0,15 m que la malla fina resuelve a duras penas (0,125 se queda un 7 % por debajo de 0,0625) y que ni el emparrillado de CYPE (sin torsor) ni las bandas de SAFE (integran la flexión) cuentan; en un apoyo lineal de Navier, en cambio, el torsor del borde es físico y está validado (F). Tres opciones, que no se excluyen:
- **(a) dejarlo:** la fina lo da y la gruesa no, del lado inseguro en la capa (con h = 0,75, hasta un 20 % del superior en las caras de viga; mediana, 1 %);
- **(b) tomar my y mxy de la estación fuera de la capa,** a una distancia fija de la cara (medio canto de la losa, por ejemplo: en Y7, la fina da ahí −2,8 y las tres mallas gruesas −2,0…−2,8, convergido). Toca lo que dimensiona: cambia la referencia congelada de F y las comparaciones con OpenSees en todas las caras y apoyos, y en Navier perdería el torsor del borde si no se distingue el apoyo lineal de la viga. Antes de decidirlo habría que medirlo en H25 y en Navier;
- **(c) medir el criterio 3 también con |mx|** y listar cada estación por su causa (mx o mxy), que es lo que ya hace `y7.ts`. Cambia sólo el medidor.

Propuesta: (c) ahora, y (b) como decisión aparte con su medida.

## 12. LV2-h: my y mxy de las estaciones de cara y de apoyo, a un canto del borde (2026-10-16)

**Decidido por el usuario el 2026-10-16:** la (c) de §11 ya (el criterio 3 dice también el error del superior sin el término de mxy y la causa de cada estación: `validacion/lv2/franjas.ts`, `out_franjas.txt`), y la (b) como paso propio midiendo antes. Hecho lo segundo; es lo de esta sección.

**La regla** (`esfuerzosFranjas.ts`, cabecera). my y mxy de una estación de cara o de apoyo siguen saliendo del campo SPR a δ = 1 mm de la cara, salvo donde detrás de la recta, en el ancho de la franja o de la ventana, hay un **borde rígido** de la losa: el ancho de una viga que se une por sus caras (LV), la huella de un pilar (la ventana de su metro) o un apoyo lineal con algún giro coartado. Ahí van por una recta a **un canto de la losa** de la cara (`CANTOS_MUESTRAS`), o a la mitad de lo que hay libre hasta el siguiente apoyo, y si allí no hay losa en la franja, a δ. Donde la losa sigue al otro lado de la recta (la cara de franja lejos del pilar, una viga por su eje, un muro, un apoyo lineal articulado) no hay capa límite y el campo a δ es el de siempre. Cada estación dice a qué distancia se tomaron (`distanciaMuestras`); las opciones `muestrasEnCara` y `cantosMuestras` del constructor son sólo para medir. El mx por fuerzas nodales no cambia en ninguna estación, ni nada en las de paso.

**Por qué la huella sí y la cara de franja no** (`validacion/f/muestras.ts`, `out_muestras.txt`, y una sonda en H25). La primera versión tomaba a un canto en todas las caras y apoyos, y en H25 subía el superior de las franjas vecinas de los pilares un 8 % (Y5 junto a P6-6: 33,5 → 36,3 con h = 0,75) sin que hubiera capa: por esa recta la losa sigue, y mxy crece suavemente al alejarse de ella igual en las tres mallas (a δ, 3,3 / 3,5 / 3,7 con 0,75 / 0,375 / 0,1875; a 0,25 m, 6,1 / 6,4 / 6,6). Allí δ ya era consistente, y a un canto sólo cambiaba la definición. La capa es cosa del borde rígido.

**Medido antes de cambiar** (`out_muestras.txt`, con 1, 1,5 y 2 cantos; `out_cambiosMuestras.txt`, lo que cambia en la referencia de F):
1. **Oráculo analítico:** una losa continua de dos vanos (L = 5 m, t = 0,3, ν = 0,2) en flexión cilíndrica, con los bordes largos y el apoyo interior con θx coartado (en w = w(x) no reaccionan). En las estaciones del apoyo interior, mx es −qL²/8 (0,52 % con h = 0,25) con cualquier regla; my es ν·M(L ∓ d) en el punto donde cada regla lo toma: a 1,96 % / 0,99 % (h = 0,25 / 0,125) a δ y a **0,24 % / 0,04 % a un canto** (con 1,5 y 2 cantos, 0,07 y 0,02 %); mxy, 0. La regla mide lo que dice medir, y dentro de la losa el SPR es mejor que extrapolado a la cara. Está en `franjas.test.ts`.
2. **La retícula de 4 × 4 de LV2** (criterio 3, el superior de ELU frente a h = 0,125 con la misma regla): LV2 con 0,75, de 52 a 18 estaciones de apoyo por encima del 10 % y de 4 a 2 por encima del 20 % (las dos de mx: el cruce sin refinar y la triangulación de §8); h = 0,5 uniforme, de 33 a 13 y de 6 a 6. Con 1,5 y 2 cantos, lo mismo (17 / 3 y 16 / 2). Y7 queda a −10 % en vez de −24 % (26,9 frente a 30,0 kN·m/m; LV1, +4,8 %).
3. **H25** (la losa plana y su reticular con ábacos, h = 0,75 y 0,375 frente a 0,1875): sólo cambian las ventanas de los pilares de borde y de esquina (la mitad de las estaciones de cara, 32 de 64 y 48 de 72, se quedan a δ): el superior sube hasta un 3,6 % en la plana y un 9,7 % en el reticular con h = 0,75, y la diferencia entre 0,75 y 0,1875 pasa de 4,4 / 7,1 % (media / máx) a 6,0 / 12,1 % en la plana y de 7,1 / 9,0 a 7,5 / 10,3 % en el reticular. En las ventanas de los pilares interiores mxy es nulo por simetría y nada cambia. Es un poco menos consistente entre mallas que a δ en esos pilares, y del lado seguro (la gruesa da más); se acepta y se mira en el periodo en sombra.
4. **La referencia congelada de F:** cambian 392 de 1 062 estaciones de cara y apoyo (ninguna de paso; ningún mx). Fuera de las caras de las vigas, la mediana del cambio del superior es del 1 al 4 % y el máximo, 9,7 % (las ventanas de borde del reticular de H25) y −12 % (una esquina de `pilares-mezclados`). En las caras de las vigas (`-lv`), todo lo que valía algo cambia poco (±8 %), y lo que cambia mucho (−72 … +23 %) son estaciones de 1–9 kN·m/m donde el superior era sólo el mxy de la capa. Regenerada con `congelar.ts`; `cambiosMuestras.ts` es el registro. De la batería sólo se movió el suelo de cordura de `carasBorde.test.ts` (el metro fino de P14 en Y13 de la vivienda pasa de algo más de 20 a 19,7 kN·m/m: su |mxy| ya no es el de la capa): baja de 20 a 15, y la gruesa sigue a ≤ 10 % de la fina.

**Los cantos:** con 1,5 y 2 cantos el oráculo y la retícula dan lo mismo, y H25 se mueve poco en los dos sentidos. Se queda **un canto**: lo más cerca de la cara que está fuera de la capa en la malla fina (en Y7, con t = 0,35, el interior se alcanza a 0,3 m). La malla gruesa aún no da ahí todo el torsor del interior (en Y7, el 60 %), pero es una cantidad que converge con h en vez de huir.

**No cambia:** `fem consultar franja` y la app no muestran aún `distanciaMuestras`; los muros y los apoyos lineales articulados siguen a δ (no se ha medido si tienen capa). El `my` de la cubierta de la vivienda y P5 no dependen de esto (son vigas).

**De paso, un artefacto de `validacion/f/validar.ts` que no es de LV2-h:** al refrescar `out_validacion.txt` (era del 13 de octubre, anterior a F2, F3 y LV), la columna «posición» del criterio 4 da −100 % en la losa plana de H25: al correr las franjas media franja, la ventana de los pilares de borde (P0-6, P0-0, P0-12 en la dirección Y) se queda sin muestras de campos (my y mxy NaN, la estación no vale) y su demanda cuenta como 0. Pasa igual con la regla de antes (sondeado). Pendiente de mirar en el medidor.

## 13. LV-8: la malla junto a los pilares que asoman de su viga (2026-10-16)

**Dónde estaban las astillas.** Ninguna en la rejilla: los pilares con el aviso iban todos por la triangulación. Un pilar atravesado por el ancho de una viga no llevaba plantilla (el ancho parte su huella), y según lo que asoma pasaba una de tres cosas:
- **asoma más de ε_snap** (un 30 × 50 bajo una viga de 30): la huella se siembra, sus esquinas sueltas a 10 cm de la cara dejan irregulares las celdas de alrededor y la triangulación une la tira con los nudos de la cara por astillas (jacobiano 0,11–0,19);
- **asoma ≤ ε_snap** (un 40 × 40 bajo una de 30, lo más corriente): la huella es «tapada» y no se siembra, pero la cara de franja que pasa por dentro de ella (la cara común de C5-g) se cortaba en la cara de la huella, 5 cm antes de la cara del ancho: un extremo suelto que la triangulación cosía en abanico. Con un pilar más estrecho que la viga (un 25 × 60 dentro de una de 30), el corte dejaba un trozo de 2,5 cm de cara dentro del ancho, con el mismo efecto;
- **la viga acaba dentro de la huella** (un pilar circular de 40, o uno mayor que la viga con losa por el otro lado): el vértice del extremo del ancho se unía a lo que tenía a ≤ ε_snap (la huella: regla 1 del arreglo), y una esquina de huella a 2,5 cm de la cara la doblaba (regla 2). Como el arreglo dobla el segmento entero, **la cara de la viga quedaba inclinada hasta 5 cm a lo largo de toda ella** (en la retícula 9, de 0,20 a 0,15 en 18 m): no era una línea de la rejilla (ninguna esquina de paño se refinaba por esa viga) y las caras de las franjas no acababan en ella. Era de LV1, no de LV2.

**Qué se hace** (compilador sin cambio de versión: todo detrás de `refinoEsquinas`; con `false`, las referencias congeladas siguen idénticas):
1. **Tiras** (`mallado.ts`, `rejilla.ts` §9): la huella que un ancho atraviesa de lado a lado llega a la rejilla en tiras, una por lado del ancho, todas del mismo grupo (el pilar). Cada tira es una huella de pilar de fachada enrasado contra el ancho (su cara sobre la línea fuerte de la viga, con el ancho, que no es losa, al otro lado) y lleva la plantilla de pilar de F2/F3 con el refinamiento de sus caras. Los rasgos de una tira no son ajenos para las celdas de las otras; un pilar lleva plantilla en todas sus tiras o en ninguna; la celda de una tira cuenta como esquina refinada para su cruce; los lados de la tira sobre la cara son obligatorios para la triangulación del ancho. Una tira fuera de las losas (lo que asoma hacia fuera de un pilar de borde) no cuenta. Es la plantilla de §2.1 («los lados de la huella que asoma son ejes de la red»), sin red nueva: la de F2/F3 ya sirve.
2. **La cara de franja de una huella tapada acaba en la cara del ancho** (`losas.ts`, `hastaElAncho`): ni extremo suelto ni trozo dentro del ancho. Lo que gana la cara cae en la huella, rígido con el pilar como su extremo en la cara (C2-d, `unirCaras`).
3. **El ancho es un trazo exacto y las huellas sembradas siguen sus caras** (`losas.ts`, `aLasCaras`): lo que una huella tiene a ≤ ε_snap de la recta de una cara de un ancho que pasa por su pilar va sobre ella, proyectado (las dos esquinas de cada lado, para que siga paralelo), y los ejes de las vigas se cortan en esa huella sembrada. Es lo que el arreglo hace con un vértice que llega después (regla 1) y lo que `tapada` hace con lo que asoma ≤ ε_snap. Lo rígido sigue siendo la huella de verdad. Probado y descartado: sólo anclar los vértices de los extremos del ancho (la cara se seguía doblando hacia la esquina a 2,5 cm), y el ancho exacto sin proyectar las huellas (lo que quedaba a unos centímetros de la cara sin unirse a ella dejaba más astillas de las que quitaba).
4. **Aviso `malla/pilar-asoma-sin-plantilla`** cuando las tiras de un pilar no caben en la rejilla (un hueco, una carga u otro rasgo cerca): queda la malla de antes, con sus astillas, y el aviso nombra el pilar.

**Calidad** (`validacion/lv2/calidad.ts`, `out_calidad.txt`: las 24 retículas al azar y las 20 geometrías de G): modelos con `malla/calidad`, de 20 con LV1 a 14 con LV2. En las retículas, de 10 (LV1) a 2: la 6 (dos pilares cuyas tiras no caben por el hueco de la escalera, con el aviso nuevo) y la 10 (una carga lineal a unos centímetros de la cara de X0, ajena a LV-8). Las 12 geometrías que quedan no son pilares que asoman: la familia circular (las vigas curvas, §2.3: paso 3) y las alas y la triangular, donde dos vigas se juntan a 30° y 25° y la losa queda en cuña entre sus caras. El jacobiano mínimo de las retículas sin aviso pasa de 0,11–0,25 a 0,22–0,73, con menos nudos (la retícula 1, de 5 102 a 3 176: lo que era triangulación es rejilla). Prueba: `src/compilador/asoma.test.ts`. La prueba de G (`geometrias.test.ts`) sigue pidiendo ≥ 0,1 con las caras.

**Precisión** (`asoma.ts`, `out_asoma.txt`; h = 0,75 frente a LV2 con h = 0,25, que ahora lleva también LV-8, así que la referencia y el conjunto de estaciones cambian respecto a §9: 711 estaciones de apoyo, antes 536):

| | Vigas en la cara: mediana / máx | > 10 % / > 20 % | Franjas junto al pilar: mediana / máx | > 10 % / > 20 % |
|---|---|---|---|---|
| LV1 | 2,3 / 27,7 % | 74 / 17 | 6,4 / 94,7 % | 181 / 94 |
| **LV2 con LV-8** | **1,2 / 11,7 %** | **4 / 0** | **4,8 / 90,9 %** | **108 / 23** |

- **Las vigas en las caras de los pilares que asoman quedan a ≤ 12 %,** y ninguna por encima del 20 % (LV1, 17).
- **Dos estaciones de apoyo empeoran mucho, y es lo que queda de LV-8.** Las dos están en la cara de una viga, delante de un pilar tapado: X7 de la retícula 1 en la cara de Y3 delante de P3-1 (un 40 × 40 bajo una viga de 30), +91 % (−44,7 frente a −13,7 kN·m/m de la fina; LV1, −11,7), y Y5 en la cara de X4 delante de P1-4 (un 60 × 25 dentro de la viga), −46 % y −33 % en las dos plantas (LV1 no tenía allí estación). En LV1 la estación tomaba 0,75 m de ancho: las astillas de la triangulación junto a lo que asoma eran láminas rígidas enteras, que el corte deja fuera, y de paso graduaban la malla junto a la cara rígida. Ahora la celda de 0,75 de la rejilla apoya entera en el tramo de cara que va al pilar (0,4–0,6 m de nudos rígidos) sin ningún tercio: un pilar tapado no tiene plantilla ni tercios, y la lámina grande contra el borde rígido da un momento que no converge (es el efecto de F2-9, al revés según el caso). **Probado:** sembrar como tiras también lo que asoma ≤ ε_snap (para que el 40 × 40 lleve plantilla y tercios) deja las franjas > 20 % en 14 y el máximo en 64 %, pero vuelve a meter astillas donde la tira de 5 cm no cabe en la rejilla (23 modelos con el aviso en vez de 14); descartado tal cual. **Propuesta:** tercios en la primera fila de celdas a lo largo de la cara de la viga donde un pilar tapado tiene nudos rígidos (la misma graduación de F2, sin huella sembrada), medido con `asoma.ts` sobre estas dos estaciones y las 23 que pasan del 20 %.

**Los demás criterios no cambian:** el recuadro (1) y el 3 × 3 (2) no tienen pilares que asomen; las franjas de la retícula de 4 × 4 (3) siguen en 2 estaciones de apoyo por encima del 20 % frente a 6 con h = 0,5; los edificios objetivo (5, 10) tienen pilares de 40 bajo vigas de 30, tapados, y quedan en 163 695 y 213 801 ecuaciones; la vivienda (8) se mueve ≤ 1,5 kN en los axiles y nada en momentos ni flechas (`.datos/out_lv2_lv8.txt`: 0,92 / 0,95 / 0,91 / 0,82 y 0,91 / 0,91).

**Queda** para antes de activar `refinoEsquinas`: la propuesta de arriba para las estaciones delante de un pilar tapado; las tiras que no caben (retícula 6); el coste (+70 %, §10) y las referencias `-lv2`; después, las vigas curvas (paso 3) y, aparte, las cuñas entre vigas que se juntan a menos de 45° (alas, triangular).


## 14. Las estaciones delante de un pilar tapado: eran las estaciones, no la malla (2026-10-18)

**Lo que se iba a hacer** (§13): tercios en la primera fila de celdas a lo largo de la cara de la viga donde un pilar tapado tiene nudos rígidos, para las dos estaciones de apoyo que empeoraban con LV-8 (X7 de la retícula 1 delante de P3-1, +91 %; Y5 delante de P1-4, −46 %).

**Lo que había.** La plantilla de cara se hizo y se midió, y no las arreglaba: X7 pasaba de +91 % a +103 %. Descompuesta la estación (`validacion/lv2`, con las mallas de 0,75, 0,25 y 0,125):

| X7 en la cara de Y3 (x = 15,55), N1 | mx (kN·m/m) | ancho en losa |
|---|---|---|
| LV1, h = 0,75 | −11,7 | 0,75 |
| LV2, h = 0,75 | −44,7 | 0,98 |
| referencia, h = 0,25 | −13,7 | 0,68 |
| h = 0,125 | −53,3 | 0,98 |

La referencia no convergía: con h = 0,25 cae una línea de nudos justo en el borde de la huella (x = 15,50, a 5 cm de la cara), las dos láminas entre esa línea y la cara quedan rígidas enteras y el corte las deja fuera (F-g); con 0,125 y con 0,75 las láminas pegadas a la cara tienen los nudos de dentro libres, cuentan, y meten en la estación de apoyo lo que la losa transmite al pilar por los nudos rígidos de la cara. El +91 % era una comparación entre dos definiciones distintas, no un error de malla. Y la de LV1 salía «bien» por lo mismo: sus astillas eran láminas rígidas enteras.

La causa estaba en la fase LV: un pilar dentro del ancho de una viga según la transversal se saltaba en las caras de franja («se apoya en la viga: el apoyo de la franja son las caras de la viga»), así que P3-1 no tenía metro perpendicular a la viga y la estación de apoyo cargaba, según la malla, con la parte de la losa empotrada en él. En un pilar de fachada bajo el zuncho de borde, el caso más corriente, era la única estación de la franja en ese apoyo.

Y5 no era de LV-8: P1-4 (60 × 25 dentro de la viga de 30) no tiene nudos rígidos en la cara; su estación es la de una esquina de paño junto a un cruce, con la plantilla de esquina de §7.

**Qué se hace** (`esfuerzosFranjas.ts`; compilador sin cambio de versión, es una consulta):
1. **El pilar cuya huella cruza las caras de la viga tiene su metro,** como cualquier pilar sin cara de franja (SP-3, SP-4): por el escalón desde la cara de la viga (una recta de la malla por su huella) hasta su cara propia, con la ventana del ancho nominal centrada en él (F-h). Sólo se salta el que queda entero dentro del ancho (un 25 × 60 según la viga): ése sí apoya en ella. Un pilar circular o girado que cruza las caras va igual, por la recta de la viga (antes, «girado» era sin estación). Un enlace sin nudos detrás de la recta no transmite nada (resto 0; antes el escalón exigía que el enlace cruzara el plano).
2. **La estación de apoyo en la cara de una viga va sin las ventanas de esos pilares:** lo que cae en ellas es del metro. Es geométrico (los tramos de cada franja fuera de las ventanas), no por nudos, así que no depende de la malla. Si a la franja le queda menos de la mitad de su ancho, no tiene estación de apoyo ahí: apoya en el pilar, y su estación es el metro. Sólo en las caras de los anchos; las líneas de apoyo de muros, apoyos lineales y vigas por el eje no cambian.

Con eso, el metro de P3-1 en X7 (cara x = 15,50, ventana 5,75–6,75, ancho 1,00): −42,6 con h = 0,75, −51,5 con 0,25 y −46,6 con 0,125. Converge dentro de un ±5 % entre las dos finas; la de 0,75 queda un 17 % por debajo de la de 0,25.

**La plantilla de cara** (`rejilla.ts` §10, detrás de `refinoEsquinas`): delante de la huella de un pilar tapado, la primera fila de celdas junto a cada cara de la viga en tercios hacia ella, con la transición de 3 a 1 en los extremos (una sola celda sin partir a lo largo de la cara no se cierra con cuadriláteros: el tramo crece una celda a cada lado). Las celdas de esquina de un cruce van por §8, así que sólo actúa en los pilares sobre una viga sin otra que la cruce (los de fachada bajo un zuncho de borde en una losa sin vigas interiores). Con ella, el metro de P3-1 pasa de −42,6 a −47,9 (a un 7 % de la de 0,25 y un 3 % de la de 0,125). Aviso `malla/pilar-tapado-sin-refinar` si alguna celda no sigue la rejilla (retícula 4, P1-1 junto al hueco).

**Medida** (`asoma.ts`, que desde ahora mide también las estaciones de cara junto a los pilares que asoman: 913 estaciones, 652 de cara y 261 de apoyo; `out_asoma.txt`):

| h = 0,75 frente a 0,25 | Franjas: mediana / máx | > 10 % / > 20 % | caras > 10 % / > 20 % | apoyos > 10 % / > 20 % | vigas > 10 % / > 20 % |
|---|---|---|---|---|---|
| LV1 | 6,6 / 100 % | 239 / 130 | 212 / 125 | 27 / 5 | 77 / 17 |
| LV2 sin la plantilla de cara | 4,3 / 62 % | 116 / 10 | 107 / 10 | 9 / 0 | 4 / 0 |
| **LV2 con la plantilla de cara** | **3,9 / 62 %** | **114 / 13** | 105 / 13 | 9 / 0 | **2 / 0** |

Las diez peores son las mismas con y sin ella, y vienen de antes: los metros de los pilares de esquina y de borde (Y1 en s = 0,2 de las retículas 18, 20 y 16: −62, −39 y −32 %), que son los de SP-3/SP-4 con la malla de 0,75 en la esquina. En los edificios objetivo (vigas en todos los ejes) la plantilla no cambia ni un nudo (`out_banco.txt`); en las retículas al azar añade del 1 al 7 % de nudos, sin ningún aviso de calidad nuevo (`out_calidad.txt`). Se queda, porque manda la precisión (LV2-d) donde actúa y no cuesta donde no.

**Referencia congelada de F** (`validacion/f/cambiosTapados.ts`, `out_cambiosTapados.txt`), regenerada a sabiendas: sólo cambian las dos de la unión por las caras con pilares que cruzan las caras de su viga. En `aleatorio-3-lv`, 8 estaciones de cara nuevas (P1-0, girado 45°, y P1-2, circular, bajo sus vigas) por 8 de apoyo y de paso que desaparecen; en `reticular-2x2-abacos-lv`, 10 caras nuevas por 10 apoyos, y 12 apoyos que cambian hasta un 8,4 % (sin las ventanas). Las de la unión por el eje, idénticas; la malla, idéntica en todas.

**Criterio 3** (`out_franjas.txt`): las estaciones de apoyo de la retícula de 4 × 4 son ahora 328 (las de las ventanas de los pilares son metros); con LV2 y h = 0,75, 11 por encima del 10 % y 2 del 20 % (antes 18 y 2) frente a 16 y 6 con h = 0,5 uniforme: sigue pasando.

**Pruebas:** `pilarTapado.test.ts` (el metro de P3-1 y su convergencia; P1-2 circular), `asoma.test.ts` (la plantilla de cara y su aviso) y el criterio 7 de LV en `unionLosaViga.test.ts`, que con pilares que no cruzan las caras sigue siendo la identidad exacta y, con los que las cruzan, comprueba que los apoyos suman exactamente lo de fuera de las ventanas y los metros lo de dentro (salvo el traslado de 5 cm).

**Queda:** el coste (+70 %, §10) y las referencias `-lv2` antes de activar `refinoEsquinas`; los metros de los pilares de esquina y de borde con h = 0,75 (las diez peores), que son de SP-3/SP-4 y no de LV2.

## 15. El coste: perfil de la compilación y la graduada de 2 niveles en los cruces sin pilar (2026-10-18)

**Lo que se iba a mirar** (§10, orden acordado): la compilación del edificio objetivo con vigas se duplicaba con LV2 (de 3,4 a 8,7 s) para una malla sólo 1,6 veces mayor, y antes de aceptar el +70 % total había que perfilarla y probar la plantilla graduada de 2 niveles en los cruces sin pilar.

### 15.1 El perfil

Con `bun --cpu-prof` sobre `compilar` del edificio objetivo con vigas (7 plantas), LV1 frente a LV2. Por fases (`estadisticas.tiempos`): `losas` pasaba de 2,0 a 4,0 s, `cargas` de 0,86 a 2,25 s y `sinPerdidas` de 0,21 a 0,44 s, con los nudos ×1,58 y las cargas de barra ×2,35 (las piezas del ancho de las vigas, muchas más con las caras partidas por la plantilla). Lo que crecía más que la malla eran cuatro bucles cuadráticos:

| Dónde | Qué hacía | Coste en LV2 (de 6,9 s) |
|---|---|---|
| `rejilla.ts`, `lejosDeHuellas` | cada nudo nuevo de cada plantilla de esquina contra **todas** las huellas de la planta (`bordePoligono`) | ~1,1 s (la mitad de la rejilla) |
| `losas.ts`, esclavos de cada huella (C2-d) | cada huella contra **todos** los nudos de la planta (`puntoEnPoligono` + `distanciaABorde`) | ~0,7 s |
| `losas.ts`, espesor de la huella | `esclavos.includes` por cada nudo de cada cuadrilátero de la planta | ~0,45 s |
| `cargas.ts`, `piezaAViga` y `aplicarLineal` | cada pieza del ancho recorría **todos** los trozos de la recta de su viga, y toda la cadena del tramo, dos veces | ~1,0 s |

**Qué se hace** (sin cambiar un bit: la caja de un polígono acota su distancia por debajo, y los trozos y la cadena van en orden por construcción, lo que se comprueba una vez por recta y por tramo con respaldo al recorrido completo):
- `lejosDeHuellas` filtra las huellas por la caja de los nudos nuevos de la plantilla más la separación, y cada nudo por la caja de la huella;
- los esclavos de una huella se buscan sólo entre los nudos de su caja más la tolerancia, y el espesor usa un `Set`;
- `aplicarLineal` empieza en el primer trozo con `hasta > σa` (búsqueda binaria) y para en el primero con `desde ≥ σb`; `piezaAViga` toma los cortes de la cadena y el nudo de cada trozo por búsqueda binaria sobre las σ del tramo, y la recta de cada ancho se busca una vez.

**Medido** (sha256 del modelo analítico y de los diagnósticos de 8 modelos, LV1 y LV2, antes y después: idénticos; las 738 pruebas del compilador y las referencias congeladas, sin cambio):

| Edificio objetivo con vigas, 7 plantas (en caliente) | compilación | losas | cargas | sinPerdidas |
|---|---|---|---|---|
| LV1, antes | 3,24 s | 1,98 | 0,86 | 0,21 |
| LV1, ahora | **2,84 s** | 1,67 | 0,69 | 0,30 |
| LV2, antes | 6,90 s | 3,98 | 2,25 | 0,44 |
| LV2, ahora | **4,54 s** | 2,39 | 1,36 | 0,55 |

La compilación de LV2 ya no se duplica: es ×1,6 la de LV1, lo que crece la malla (nudos ×1,58). Lo que queda es lineal en el tamaño: las piezas del ancho (×2,35 cargas de barra, que pesan también en `sinPerdidas` y en `resultanteAnalitica`) y la triangulación. Reducir las piezas del ancho (unir las cargas por barra) cambiaría los bits de todas las referencias con la unión por las caras, y no se toca.

### 15.2 La graduada de 2 niveles en los cruces sin pilar

`PLANTILLA_ESQUINA.nivelesSinPilar` (opcional; sin él, los mismos niveles en todos los cruces): un cruce es «con pilar» si alguna huella está a menos de `lejos` de una de sus esquinas, el mismo criterio que el aviso de LV2-g. **No es sólo cosa de zunchos:** el edificio objetivo tiene vigas secundarias a mitad de cada vano de 6 m (`S<i>-<j>`, 25 × 40), y de sus 152 cruces por planta 72 son sin pilar (248 esquinas de 500). Los modelos de los criterios 1 y 2 (el recuadro y el 3 × 3) tienen todos los cruces con pilar, así que no cambian ni un nudo.

| Retícula de 4 × 4 con zunchos, frente a h = 0,125 (`out_franjas.txt`) | apoyos > 10 % / > 20 % (de 328) | \|mx\| > 10 % / > 20 % | máx apoyos | máx vano |
|---|---|---|---|---|
| LV2, 3 niveles | 11 / 2 | 7 / 2 | 38,2 % | 17,3 % |
| **LV2, 2 niveles sin pilar** | **10 / 2** | **5 / 2** | 38,2 % | 17,2 % |
| LV2, 1 nivel sin pilar | 15 / 2 | 11 / 2 | 38,2 % | 17,3 % |
| LV1, h = 0,5 uniforme | 16 / 6 | 8 / 6 | 24,3 % | 27,6 % |

En las caras de los zunchos, el tercer nivel no aporta nada medible (las mismas dos estaciones por encima del 20 %, una de ellas junto a un pilar; una menos por encima del 10 %); con un solo nivel empiezan a perderse estaciones por encima del 10 %. En la vivienda cambia 5 nudos de 3 389.

| 7 plantas (`out_banco.txt`; tiempos en caliente de un script aparte) | ecuaciones | compilación + cálculo | frente a LV1 |
|---|---|---|---|
| Edificio con vigas, LV1 | 112 119 | 2,8 + 4,6 = 7,5 s | — |
| Edificio con vigas, LV2, 3 niveles | 163 695 | 4,5 + 5,5 = 10,0 s | +34 % (antes del perfil, +72 %) |
| **Edificio con vigas, LV2, 2 niveles sin pilar** | **153 132** | **4,2 + 4,7 = 8,9 s** | **+19 %** |
| Reticular, LV1 | 161 049 | 5,1 + 4,5 = 9,6 s | — |
| Reticular, LV2, 3 niveles | 213 801 | 8,2 + 6,0 = 14,2 s | +48 % |
| **Reticular, LV2, 2 niveles sin pilar** | **203 406** | **6,7 + 5,7 = 12,4 s** | **+29 %** |

**Para el usuario, LV2-i:** la propuesta es la graduada de 3 niveles en los cruces con pilar y de 2 en los cruces sin pilar, por defecto. Da lo mismo en las franjas (criterio 3), no toca los criterios 1 y 2, y deja el edificio con vigas en +19 % (el criterio 10 pide ≤ +25 %: pasa) y el reticular en +29 % y 203 406 ecuaciones, un 1,7 % por encima del perfil móvil (LV2-d lo acepta). Si se decide, `nivelesSinPilar: 2` pasa a ser el valor por defecto de `PLANTILLA_ESQUINA`, y se regeneran `out_asoma.txt` y `out_calidad.txt` (las 24 retículas al azar, medidas con 3 niveles en todos los cruces) antes de las referencias `-lv2`. Queda, por fin, activar `refinoEsquinas`.

## 16. LV2-i hecha y las referencias congeladas `-lv2` (2026-10-18)

**Decidido por el usuario el 2026-10-18:** LV2-i como se proponía. `PLANTILLA_ESQUINA` queda en `{ tipo: "graduada", niveles: 3, nivelesSinPilar: 2 }`: 3 niveles en los cruces con pilar y 2 en los cruces sin pilar. `refinoEsquinas` sigue desactivada por defecto, así que ninguna malla de C1–C5, F ni LV cambia (sha256 de los modelos LV1: idénticos; las referencias congeladas de antes, idénticas al byte en el fixture regenerado).

**Lo medido con el valor nuevo:**
- `out_asoma.txt` y `out_calidad.txt`, regenerados: **idénticos** a los de 3 niveles en todo. En las 24 retículas al azar y las 20 geometrías no ortogonales no hay cruces sin pilar (sus vigas van de pilar a pilar), así que LV2-i no las toca.
- `out_franjas.txt` (criterio 3, con la variante «3 niv. en todo» para comparar): LV2 por defecto, 10 / 2 estaciones de apoyo por encima del 10 % / 20 % frente a 16 / 6 con h = 0,5 uniforme: pasa. Las mismas dos de siempre (X13 junto a P12-10, en un cruce sin refinar por el hueco; Y20, en la triangulación de la carga lineal).
- `out_banco.txt`: el edificio con vigas, 153 132 ecuaciones; el reticular, 203 406 (§15).

**Referencias congeladas `-lv2`** (`validacion/f/congelar.ts`, fixture `congelado-f.json`, de 15,6 a 23,9 MB), con `refinoEsquinas: true` y lo demás por defecto:
- `aleatorio-3-lv2` (1 188 nudos, 21 franjas, 905 estaciones): el modelo al azar de `-lv`; sin cruces de rejilla, cubre LV2-f y las tiras de LV-8 en una planta cualquiera;
- `reticular-2x2-abacos-lv2` (1 802 nudos, 28 franjas, 1 141 estaciones): el reticular con ábacos y vigas por todos los ejes, con 17 plantillas de esquina, el aviso `malla/esquina-sin-refinar` y cruces sin pilar (las vigas secundarias);
- `edificio-2x2-lv2` (1 491 nudos, 22 franjas, 896 estaciones), nuevo: el edificio objetivo de una planta y 2 × 2 vanos con su hueco, su carga lineal, su zona y sus vigas secundarias, con acciones; 17 plantillas, también con cruces sin pilar. Con LV2 su jacobiano mínimo sube de 0,123 a 0,257 y pierde el aviso de calidad.

Las diez entradas de antes salen idénticas al byte, y el test `congelado-f.test.ts` comprueba las trece.

**Visto de paso, para el criterio 4** (no cambia nada hoy): con `refinoEsquinas` la calidad empeora en dos modelos pequeños que no están en las medidas de §13: el edificio objetivo de 1 × 3 × 2 vanos (jacobiano mínimo de 0,257 a 0,161, con `malla/calidad`) y `aleatorio-3-muros-lv` (de 0,091 a 0,052, con `rejilla: false`: no es la plantilla, sino LV2-f o las tiras). Va a la lista del paso 3 junto con las vigas curvas y las cuñas.
