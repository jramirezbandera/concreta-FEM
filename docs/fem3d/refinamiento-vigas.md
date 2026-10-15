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
| 3 | **Franjas** (la retícula de 4 × 4, con h = 0,75): no peores que la malla uniforme de 0,5, frente a h = 0,125 (21,5 % en apoyos y 17,6 % en vano); en las caras junto a un pilar, ≤ 5 %; las estaciones que no convergen, listadas con su causa | `validacion/lv2/` |
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
- **El tiempo:** compilar y calcular el edificio con vigas pasa de 7,3 a 10,6 s (+45 %; el criterio 10 pide ≤ +25 %, a mirar al final).

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
- **5:** el edificio con vigas, 163 695 ecuaciones; el reticular, 213 675 (antes, 156 177 y 204 750). Ningún cuadrilátero bajo en los dos.
- **8:** la vivienda, igual que con LV1 (`.datos/out_lv2_esquinas.txt`: axiles, momentos y flechas frente a CYPE a ±0,01).
- **4:** en las 44 geometrías de G, 21 con el aviso de calidad (20 con LV1; el peor, 0,109 en las dos). Son los de LV-8: las esquinas de la huella que asoma 5–10 cm de la cara quedan como puntos sueltos de la triangulación, que une con astillas y cuyos nudos cercanos se hacen rígidos.
- **Pruebas:** las 710 del compilador, sin cambios.

**Para el usuario:**
- **LV2-f, lo que asoma (LV-8):** no es lo que estropeaba las franjas, pero deja el criterio 4 sin cumplir. Propuesta: el trozo de la huella que asoma dentro del ancho de la viga se quita de la losa, como el ancho, y su borde se une al pilar. La cara de la losa sigue el contorno del pilar sin puntos sueltos. Lo que cae en él pasa al pilar, exacto, como hoy lo de la huella.
- **LV2-g, los cruces que no se pueden refinar a la vez:** junto a un hueco o a rasgos de cargas, un cruce con pilar se queda como en LV1. Para refinarlo haría falta una versión de la plantilla para la triangulación, con la misma geometría que la de la rejilla y lejos de las huellas. Propuesta: aceptarlo y avisar (`malla/esquina-sin-refinar`, ya previsto en §2.1) en las caras de esos pilares.
- **El criterio 3 tal como está escrito no se cumple:** máximo de apoyos 39,3 % frente al 25,7 % de h = 0,5, y junto a un pilar ≤ 5 %. El siguiente junto a un pilar es X19 junto a P12-15 (−20,9 %). Ni h = 0,5 uniforme baja de 16 %.

Medido con `validacion/lv2/franjas.ts`, `recuadro.ts`, `vigas.ts` y `banco.ts` (salidas `out_*.txt`), y la variante `lv2-esquinas` de la vivienda.
