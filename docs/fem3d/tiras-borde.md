# Fase TB — Las tiras de borde (2026-10-28)

## 0. Por qué

De la prueba de uso del dibujo. «Vigas de borde» (y «Con zunchos», que la usa) pone el zuncho por el eje de los pilares de fachada. Luego retranqueaba la losa hasta ese eje y pasaba a la viga, como cargas de viga, lo que cargaba la banda que quedaba fuera. Al usuario no le gusta que la orden le cambie la geometría del forjado: el borde dibujado es donde se hormigona, y la viga no tiene por qué quedar entera dentro del borde.

El recorte venía del 2026-10-15. Entonces un borde de losa dentro del ancho de una viga era un error (C2-c). Ese mismo día llegó la fase LV, y con ella lo que cae en el ancho pasa solo a la viga. Así que el recorte ya sólo hacía falta para la franja de losa que queda **más allá de la cara de fuera** de la viga: en la vivienda, 12 cm.

Antes de cambiar nada se midió en la vivienda sin zunchos (`src/editor/vigasBorde.vivienda.json`, las dos cubiertas). Se compararon la orden de entonces (A: losa al eje y la banda como cargas de viga) y las mismas vigas con el contorno dibujado (B, con el compilador de entonces):

| | A (losa al eje) | B (contorno dibujado) |
|---|---|---|
| Carga total G / Q | 2082,7 / 225,1 kN | 2083,3 / 225,1 kN |
| Axiles de pilares | — | ≤ 4–5 % de A |
| Nudos | 3 420 | **6 265 (+83 %)** |

Sin los petos, porque con ellos B no compilaba (§2.3). Los resultados no cambiaban; lo que costaba era mallar la franja de 12 cm.

**Decidido por el usuario (2026-10-28):** el forjado se queda como se dibuja. La franja entre la cara de fuera de una viga y el borde, de hasta el ancho b de la viga, va con la viga en el compilador. La orden sólo pone las vigas.

## 1. Cómo se hace

### 1.1 La tira (`anchosVigas.ts`, `tirasBorde`)

Las tiras se buscan en cada planta, tras los anchos de LV. Un lado del borde de una losa (contorno o hueco) da tiras si cumple cuatro condiciones:
- es paralelo al eje del ancho de una viga;
- la losa queda entre el lado y la viga;
- está a más de ε_snap de la cara de fuera de la viga (si no, el arreglo lo une a la cara: es el zuncho enrasado de LV);
- está a no más de `TIRA_MAXIMA`·b = b de esa cara.

Cada trozo del ancho que recorre el lado da una tira: el cuadrilátero entre la cara y el lado. Si hay varias vigas paralelas, manda la más cercana.

**Los extremos:**
- La primera y la última tira de la línea llegan hasta los vértices del lado si les quedan a no más de b/2 + b + ε_snap. Son las esquinas: la viga acaba en el eje del pilar de esquina.
- En el vértice, la tira cierra a inglete con la del lado vecino si la tiene: la diagonal hasta el corte de las dos caras, también en una esquina entrante. Si el vecino no la tiene, cierra contra el lado vecino, o en perpendicular si la cara no lo corta.

**No se pone** una tira que no sea un cuadrilátero simple dentro de la losa, que tenga dentro vértices de la losa o que pise un muro. Esa franja se malla como antes.

### 1.2 Lo que es la tira

Es una entrada más de los anchos de la planta (`AnchoViga.tira`, el lado del eje), detrás de los de LV: sin tiras, los índices y la malla de antes. Va al arreglo como un trazo cerrado, igual que el ancho, así que:
- no es losa: sus piezas son las del ancho;
- lo que cae en ella pasa a la viga con su momento de transporte, por el mismo camino que el ancho: el pp de la losa, las cargas de superficie (las zonas están sembradas), los lados de las lineales y las puntuales;
- los nudos y el diafragma son los de su viga.

**Diferencias con el ancho de LV:**
- No tiene caras. Sus lados no unen nudos de la losa a la viga (`unirCaras`). El lado corto de una tira que acaba a media arista (la viga termina en un pilar y la losa sigue en voladizo, retícula al azar 11) caía en la zona rígida del pilar: dejaba nudos rígidos fuera de su huella, lo que la fase HR prohíbe.
- No da caras a las huellas de pilar (`aLasCaras`, `hastaElAncho`).
- No da estaciones de apoyo a las franjas. En el mapeo va con `tira: true`: las franjas la quitan de la losa, pero no le ponen caras.

### 1.3 El peto por la cara de fuera (arreglado)

Una carga lineal por la cara de fuera del ancho de una viga (el peto de un zuncho enrasado), o por el borde de una tira, no toca ninguna lámina. Antes daba `carga/fuera-de-losa` y el modelo no compilaba, aunque el peto se moviera 1 mm hacia dentro, porque el arreglo lo devuelve a la cara. Ahora un lado sin nudos de la malla en el polígono del ancho, o a ≤ ε_geom de su borde, va a la viga. Lo mismo vale para un apoyo lineal. Los modelos válidos de antes no cambian: esos lados eran un error.

### 1.4 Opción

`tirasBorde`, por defecto sí (compilador **TB1**). Con `false`, la franja se malla como losa, con los bits de antes. Sólo actúa con `unionLosaViga: "cara"`. La hipótesis nombra las vigas con tira.

### 1.5 La sensatez y la orden

`libresTramo` da por atado, como el compilador:
- el borde a no más de b de la cara de fuera de una viga del lado del forjado;
- el trozo hasta el vértice que queda a no más de b/2 + b del extremo de la viga;
- un tramo que cae entero en esa franja (el escalón de 12 cm del contorno de la vivienda).

«Vigas de borde» y «Con zunchos» ya no tocan la losa ni las cargas: sólo crean la sección (si es nueva) y las vigas, con el eje de siempre (por el de los pilares, o enrasado por fuera). Un lado se salta si ya está atado como lo ve el compilador. Los demás se trazan con lo que los ata por su eje o su ancho, como antes: en L-CUB-S, la viga de la pérgola a 0,27 m que llega a la esquina no convierte el lado en uno «libre en parte». En la vivienda salen las mismas vigas que los zunchos hechos a mano.

## 2. Lo medido

### 2.1 La vivienda (`validacion/tb/out_medir.txt`)

Con «Vigas de borde» en las dos cubiertas, con tiras frente a la franja mallada:
- **Nudos:** 3 648 con tiras (14 tiras) frente a 6 265.
- **ΣFz:** la misma al 1e-6 en G, Q y N.
- **Pilares:** ningún pilar con más de 5 kN cambia más del 4,6 % (P7 en Q; en G, −3,0 %).

Frente a la orden de antes (A, medido con el código de antes en esta sesión):
- **Peso total:** +0,03 %.
- **Momento de las cargas (My):** 0,3 %, porque la orden de antes repartía la carga de la banda por toda la viga y ahora va donde cae.
- **Pilares:** P22 +10,6 % y P23 +6,8 % en G, los pequeños de la pérgola; los demás, ≤ 3 %.

El equilibrio y el control «sin pérdidas» cuadran.

### 2.2 La retícula 16 (precisión local de HR)

| | Vigas: mediana / máximo | Franjas: mediana / máximo / > 10 % |
|---|---|---|
| Gruesa frente a fina, sin tiras | 0,64 / 6,7 % | 2,64 / 31,6 % / 11 |
| Gruesa frente a fina, con tiras | 0,61 / 6,8 % | 1,74 / 31,5 % / 6 |
| Fina con frente a fina sin (el modelo) | 0,22 / 11,4 % | 0,21 / 38,3 % / 8 |

- **La malla:** las tiras no la empeoran; en las franjas, la mejoran.
- **El modelo:** en las vigas, pequeño salvo en una cara: Y1-N2 en P1-2, −11,4 %.
- **Las franjas:** ocho estaciones de cara pasan del 10 %, todas junto a un borde con tira. La peor es X11/X12 en s = 4,150 (+38 %). **No se han analizado una a una.** Lo probable es que la franja tenga ahora menos ancho de losa (la tira es viga) y que la franja de 12 cm ya no reparta momento con la viga.

### 2.3 Pruebas

- **`src/compilador/tirasBorde.test.ts`:** el forjado de 2 × 1 vanos con el borde a 0,27 m del eje en tres lados y enrasado en el cuarto, con peto, una zona que cruza la tira y una puntual en ella. Comprueba:
  - que salen tres tiras, a inglete en las esquinas, sin láminas dentro;
  - que las reacciones suman lo mismo que con la franja mallada en fuerza y en momento (1e-9), con cada pilar a ≤ 3 %;
  - que el peto compila;
  - que la malla es menor y no hay nudos rígidos fuera de una huella;
  - que la misma malla sale bit a bit con el contorno empezado en otro vértice y al revés;
  - que no salen tiras con 0,35 m de franja (> b) ni con el borde en el ancho.
- **`src/editor/vigasBorde.test.ts` y `dibujo2.test.ts`:** las vigas de siempre, la losa y las cargas intactas, y ningún borde sin viga.
- **Referencias congeladas:** las de antes que se unen por las caras llevan `tirasBorde: false`. Salen idénticas: 10 de C3 y 16 de F. Hay tres nuevas con las tiras: `reticula-nucleo-tb` (C3), `edificio-2x2-tb` y `reticular-2x2-abacos-tb` (F).
- **Con `tirasBorde: false`:**
  - **La regresión de precisión de HR (`validacion/hr/congelar-fina.ts`):** su referencia fina es del modelo de antes.
  - **La prueba LV2-g de `esquinas.test.ts`:** en la retícula de 4 × 4, el hueco de la escalera queda a 0,40 m del eje de X10 y X15, y sus tiras de 25 cm llevan su lado corto a 0,45 m de la esquina del paño de P12-10 y P18-10. Con h = 0,5 la plantilla de esquina ya no cabe, y sale `malla/esquina-sin-refinar`, como con 0,75.

## 3. Pendiente

- **Las ocho estaciones de franja de §2.2:** mirarlas una a una.
- **Otras tiras:** una franja que no llega a un vértice del lado (la viga acaba antes de la esquina, más allá de b/2 + b) se queda mallada, y también una tira en planta no ortogonal que no es un cuadrilátero simple. Ninguna se avisa.
- **La regla de la skill** (el zuncho por el eje de los pilares y la carga de la banda como carga de viga) cambia: el agente ya no pasa cargas a mano.
