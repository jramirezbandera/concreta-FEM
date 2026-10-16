# Fase LV — la unión de la losa con las vigas, como CYPECAD

> **Fecha:** 2026-10-15. **Origen:** CY-10 (`fase-cy.md`), en la comparación de la vivienda con el modelo CYPECAD del usuario. **Decisión del usuario (CY-g, 2026-10-15):** «vamos a seguir el criterio de CYPE, es mejor como lo hacen ellos».
>
> **El problema:** hoy la losa llega hasta el eje de la viga (C2-c) y la viga se parte en los nudos de la malla sobre su eje (C2-e). La losa se solapa con media viga a cada lado, y la esquina de la losa dentro de la huella del pilar se lleva directamente al pilar la carga que en CYPE baja por la viga. En un recuadro de 4,32 m con vigas de 30×30 (`validacion/cy/borde.ts`), frente al emparrillado de CYPE: momento de la viga en la cara 0,15, cortante 0,58, flecha de la losa 0,90; refinando, 0,00 / 0,76 / 0,93 (el momento en la cara estaba mal medido, a 2e del eje: en la cara es 0,87 y 0,83, LV-1 en `fase-lv.md`). Con la topología de CYPE, la misma lámina da 1,02 / 0,97 / 1,00.
>
> **Objetivo:** unir la losa con las vigas como CYPECAD (memoria de cálculo, pp. 12–15): la losa sólo hasta las caras de la viga, con sus nudos de borde unidos al eje por un enlace rígido. Lo de hoy queda como opción, para comparar.
>
> **Este documento** fija, antes de empezar, cómo se hace y qué tiene que pasar. El resultado está en `fase-lv.md` (2026-10-15), con lo que cambió respecto a este plan (§4 del informe).

## 1. Cómo se hace

### 1.1 Qué vigas

Las de **hormigón con sección rectangular** de una planta con losas (macizas o reticulares). Su sección ya lleva el hormigón del espesor de la losa sobre su ancho: es lo que CYPE da como sección bruta de la viga.

Quedan como hoy:
- las metálicas y las de otras secciones: la losa pasa por encima, continua hasta el eje (C2-c, C2-e);
- el trozo de una viga que va por el eje de un muro (A-9, C3-e): la losa llega al eje del muro, como en C3;
- las viguetas de los paños (C4): no hay láminas.

### 1.2 El ancho de la viga

Por cada tramo de su polilínea, un rectángulo de ancho b a lo largo del eje, de un extremo del tramo al otro (del eje del pilar al eje del pilar). En un quiebro de la polilínea, a inglete si el giro es de 120° o menos; si es mayor, a escuadra. No cuenta el trozo que va por el eje de un muro.

En la malla, el ancho de la viga no es losa. Sus lados se siembran como cualquier borde, y las piezas que caen dentro (triángulos de la triangulación) no son láminas: llevan su carga a la viga (§1.4). El validador comprueba que láminas y piezas de las vigas suman el área de cada losa (1e-9).

### 1.3 La unión

- Cada nudo de una lámina de la losa que cae en el ancho cerrado de una viga y no en la huella de un pilar es **esclavo de un enlace rígido**. Su maestro es el nudo del eje de la viga en su proyección, que se crea si no está. La viga se parte en esos nudos.
- Si la proyección cae en la cuerda de la huella de un pilar del tramo, el nudo va con la huella del pilar (C2-d).
- Donde se cruzan dos anchos, el nudo va al eje más cercano; a igual distancia, al del primer tramo en orden canónico.
- Las proyecciones a ≤ ε_snap entre sí, o de un nudo que ya está en la cadena del tramo, dan un solo nudo del eje.
- Los nudos del eje entran en el diafragma de su planta (C2-f); los esclavos, por su cadena.

Así una viga embebida queda unida por sus dos caras y la pendiente de la losa pasa de un lado a otro por el giro de la viga, como una franja rígida de ancho b.

### 1.4 Las cargas en el ancho de la viga

Lo que cae dentro del ancho de la viga y en la losa pasa a la viga, exacto en fuerza y momento:
- el pp de la losa y sus cargas de superficie: cada pieza da una carga repartida sobre el eje (lineal a trozos, exacta) y su momento de transporte (la torsión) en el punto de su centroide;
- las cargas lineales: la fuerza repartida sobre su proyección y el momento de transporte;
- las puntuales: en su proyección, con su momento de transporte.

El peso de la viga sigue siendo el de C2-g (sólo su descuelgue): el peso total no cambia y A3-1 sigue valiendo. La resultante física de las cargas se sigue calculando sobre la losa dibujada, sin la malla, así que el control «sin pérdidas» comprueba también este paso.

~~Un apoyo (puntual o lineal) dentro del ancho de una viga y fuera de su eje es un error: el motor no admite apoyos en los esclavos.~~ Sustituido el 2026-10-16 (§1.4.1).

#### 1.4.1 Los apoyos que llegan a la viga (2026-10-16, decisión del usuario)

Un murete o un muro que no se modela y llega a una viga es muy habitual. El error dejaba sin salida un apoyo lineal que llegaba a la viga: tampoco valía acortarlo hasta la cara, porque los nudos de la cara son esclavos del enlace (`apoyo/en-cara-viga`). Ahora, como las cargas, lo que un apoyo coacciona dentro de la viga va a la viga (`losas.ts`):
- **los nudos de la cara** que apoya pasan a su maestro en el eje, con las mismas coacciones. Un murete perpendicular que llega a la cara o al eje es un apoyo puntual de la viga en el cruce;
- **sus lados en el ancho**, a los nudos del eje en su proyección: un punto si lo cruzan, y los nudos del trozo que recorren si van a lo largo (un apoyo por dentro del ancho y paralelo a la viga pierde su excentricidad);
- **un apoyo puntual en el ancho**, al eje en su proyección;
- **lo que cae en la huella de un pilar** (o en su borde, o en la zona rígida de una viga en él) es del pilar: el apoyo acaba en su cara, porque un murete que llega al pilar sostiene la losa, no el pilar. Vale también con `unionLosaViga: "eje"` (antes, `apoyo/en-huella`). Un apoyo lineal al que no le queda ningún nudo es un error (`apoyo/sin-destino`). Un apoyo puntual en el ancho, junto al pilar, apoya el pilar, como uno en su huella (C1).

Los diagnósticos son `info` (`apoyo/a-viga`, `apoyo/en-pilar`), con su hipótesis. La reacción del apoyo lineal cuenta los nudos del eje aunque no caigan en su polilínea (`mapeo.apoyosEnVigas`). Llegar al eje o a la cara da los mismos apoyos y los mismos resultados, y un apoyo puntual en el ancho, los de uno puesto en el eje (≤ 1e-12, `apoyosViga.test.ts`).

**Sólo uz, sin coartar la torsión de la viga.** Con la sección rígida del enlace, apoyar la cara y el eje equivaldría a coartar también el giro de torsión de la viga en el cruce. Medido en `validacion/lv/apoyosVigaTorsion.ts` (`out_apoyosVigaTorsion.txt`), con un murete que llega por un lado a una viga interior y la unión por el eje (la losa continua sobre la viga, sin sección rígida) como referencia:
- con sólo uz, las franjas de la cara junto al murete quedan a −5,6 y −2,1 %, y el torsor de la viga, a +7 %;
- con el giro coartado, las franjas quedan a +34 y +42 % (menos momento negativo, del lado inseguro), y el torsor, ×4,4.

Ese giro sale de la sección rígida del enlace, no de la estructura, así que se queda en sólo uz. En la viga de borde, el giro no cambia nada en la viga (≤ 0,1 %).

### 1.5 C2-c

Un borde de losa dentro del ancho de una de estas vigas deja de ser un error: lo que queda dentro no es losa. Se puede dibujar a ejes (como hoy y como la orden «Vigas de borde») o hasta la cara exterior. Lo que cambia es sólo la carga del ancho: la dibujada es la que cae en él. Para las demás vigas, C2-c sigue igual.

`sensatez/borde-sin-viga` da por atado un borde que va dentro del ancho de una viga, no sólo por su eje.

### 1.6 La rejilla alineada

Las dos caras del ancho de una viga son líneas de la rejilla aunque estén a menos de d_min (como las líneas largas): las celdas entre ellas no son losa. El eje de la viga ya no es una línea, y tampoco el de un pilar por el que pasa una de estas vigas en esa dirección.

### 1.7 Las franjas de armado

Las estaciones de apoyo de una de estas vigas van en sus dos caras, por fuerzas nodales y del lado de la losa: es lo que la losa transmite a la viga. Entre las caras no hay estaciones. Las rectas de las franjas cuentan como losa sólo lo que queda fuera de los anchos de las vigas.

### 1.8 Opción

`unionLosaViga: "cara" | "eje"`, por defecto `"cara"`. Con `"eje"`, todo es como antes bit a bit. Compilador LV1.

### 1.9 Fuera de esta fase

Se miden y se proponen, pero no cambian:
- **zona rígida 1 en la unión viga–pilar:** CYPE une la viga al pilar en su cara; nosotros, con 0,5 (C1-a);
- **viguetas desde la cara de la viga:** como CYPE, con un offset rígido de b/2;
- **la losa hasta la cara de los muros;**
- **el peso de la viga entera en un reticular:** hoy su ancho pesa como aligerado, con el pp de la losa.

## 2. Criterios

| # | Criterio | Cómo se mide |
|---|---|---|
| 1 | **Opción:** con `unionLosaViga: "eje"`, las referencias congeladas y los resultados de antes, bit a bit | Referencias congeladas, `validacion/lv/opciones.ts` |
| 2 | **Recuadro de CY-10:** el modelo físico por defecto, frente al emparrillado de CYPE: momento de la viga en la cara y en el centro, cortante en la cara, flecha y momento de la losa a ≤ 5 %; y no se separa al refinar la malla | `validacion/lv/recuadro.ts` |
| 3 | **Unión:** no hay láminas en el ancho de las vigas; cada nudo de la losa en él es esclavo de un enlace con maestro en el eje o en la huella; láminas y piezas de las vigas suman el área de cada losa a 1e-9 | Pruebas |
| 4 | **Cargas:** lo que cae en el ancho (pp, superficie, lineales, puntuales) llega a la viga sin pérdidas (1e-9) y el equilibrio cuadra en cada cálculo | Pruebas y modelos de validación |
| 5 | **Propiedades:** la malla y los resultados no dependen del orden de las listas ni de una traslación o un giro de la planta (metamórficas de C2) | Metamórficas |
| 6 | **La vivienda (sombra), criterio 7 de CY:** momentos de vano a ≥ 0,90 de CYPE (mediana), flechas a ±10 %, axiles a ±10 % salvo los pilares explicados | `validacion/sombra/vivienda/` |
| 7 | **Franjas:** en la cara de una viga, la suma de las franjas es lo que transmiten los enlaces de esa cara; la batería de franjas sin regresiones frente a la malla fina | Pruebas, `validacion/lv/` |
| 8 | **Tamaño:** el edificio objetivo con vigas (C2) sigue en la rejilla (cobertura ≥ 75 %, sin `malla/sin-rejilla`) y en el perfil móvil | `validacion/lv/banco.ts` |
