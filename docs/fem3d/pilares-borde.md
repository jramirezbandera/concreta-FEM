# Fase PB: la malla de LV2 en los pilares de borde (2026-11-08)

## 1. El encargo

De VS5 (`viento-sismo.md` §14): con la configuración más común en obra, pilares de 30 × 30 en el eje de vigas de borde de 30 y la losa hasta la cara de fuera de la viga, los refinamientos de LV2 no entraban en ningún pilar de borde:
- `malla/esquina-sin-refinar` en los cuatro pilares de esquina;
- `malla/pilar-tapado-sin-refinar` en los cuatro de borde.

Pasaba en las tres plantas, también con una maciza y sin cargas, y no sin las vigas. VS5 anotó además que, con 0,75, el momento de la viga en la cara de P2 salía un 16 % por debajo del de 0,25. El usuario pidió afinar la malla ahí, como fallo de precisión del lado inseguro.

## 2. Por qué no entraban

Hay dos rasgos del arreglo que dejaban irregulares las celdas junto a esos pilares (`rejilla.ts`, paso 6: una celda con un rasgo ajeno a menos de δ = 0,675 m va por la triangulación).

- **En las esquinas, una isla de losa.** Las dos vigas de borde acaban en el eje del pilar de esquina, así que sus anchos dejan fuera, entre ellos y el borde, un cuadrado de losa de b/2 de lado. Cae dentro de la huella del pilar, así que es rígido con él, y no toca el resto de la losa. Sus vértices quedaban a 0,21 m de la esquina del paño, al otro lado de los anchos, y la celda de esa esquina iba siempre por la triangulación. La plantilla de esquina (§8) no entraba nunca: «una esquina de su cruce cae en la triangulación».
- **En los bordes, la junta de los anchos.** Las dos vigas de vano acaban en el eje del pilar de borde, y sus anchos dejan un punto en la cara, delante del pilar. Ese punto no cae en ninguna línea de la rejilla: con las franjas (por defecto), las caras comunes de los pilares (x = 5,85 y 6,15) ganan al eje (x = 6), a 0,15 m. Las tres celdas de delante del pilar quedaban irregulares, y la plantilla de cara (§10) no entraba.

## 3. Lo medido: el 16 % no era de la malla de 0,75

`validacion/pb/medir.ts` mide, con el código de una carpeta del repositorio (el de ahora, o un árbol de trabajo en el commit de antes, HR-8), la envolvente ELU de:
- las vigas en las caras de los pilares y en el vano;
- el Wood–Armer de las estaciones de cara y de apoyo de las franjas.

`comparar.ts` lo compara con una malla fina.

**La referencia tiene que estar convergida.** Con h = 0,125 y con 0,0625 (ε_snap = 0,025), el código de antes y el de ahora dan la misma malla (32 568 nudos en el ejemplo 11, 38 136 en el recuadro de 2 × 2) y los mismos valores. Con 0,25 no: en las caras de los pilares de borde sale un 5–10 % alto.

En la planta 1 del ejemplo 11, con viento (ELU persistentes, `out_ej11pt.txt`), con 0,75 y 0,25 y el código de antes salen los números de VS5:

| Cara | h = 0,125 | 0,75 (antes) | 0,25 (antes) | 0,75 (ahora) |
|---|---|---|---|---|
| P1 (esquina), mínimo | −60,8 | −57,7 (−5 %) | −60,2 (−1 %) | −61,0 (0 %) |
| P2 (borde), mínimo | −49,2 | −48,3 (−2 %) | −52,1 (+6 %) | −48,3 (−2 %) |
| P2 (borde), máximo | 8,1 | 7,4 (−8 %) | 8,8 (+8 %) | 7,4 (−9 %) |
| P2, la otra cara, máximo | 8,0 | 7,7 (−4 %) | 8,8 (+10 %) | 7,7 (−4 %) |

**El «16 %» era 7,4 frente a 8,8:** el máximo positivo en la cara de P2, un momento pequeño (8 kN·m, del viento). De ese 16 %, la mitad era la referencia de 0,25 por encima de la convergida. Frente a la convergida, con 0,75 la cara de P2 sale a −2 % en el negativo y a −4…−9 % en el máximo positivo. Lo que fallaba de verdad eran las esquinas.

## 4. La plantilla de cara, sólo donde la huella cruza la cara (PB-a)

La plantilla de cara (`rejilla.ts` §10, LV2 §14) se midió en P3-1 de la retícula 1, un 40 × 40 bajo una viga de 30. Allí la huella cruza la cara de la viga, el pilar tiene un metro perpendicular a ella y la plantilla lo acercaba a la malla fina (de −8,6 % a +2,8 % de la de 0,125).

En el 30 × 30 bajo una viga de 30, la huella no cruza la cara: está enrasada con ella. Hasta ahora la plantilla no entraba nunca ahí por la junta de §2. Pero entra:
- si se quita la junta (como se probó primero en esta fase);
- o con `franjas: false`, donde la junta cae en la línea del eje del pilar.

Y donde entra, aleja la malla de la fina. En el recuadro de 2 × 2 frente a h = 0,0625 (`out_2x2.txt`):

| Pilar de borde (30 × 30 en viga de 30) | h = 0,75 | h = 0,5 |
|---|---|---|
| Viga en la cara, sin plantilla de cara | +0,6 % | +0,8 % |
| Viga en la cara, con ella (sin la junta) | +2,9 % | +4,5 % |
| Viga en la cara, con ella (`franjas: false`) | +9,4 % | +8,8 % |
| Metro de la franja en la cara del pilar, sin ella | +7,4 % | +1,3 % |
| Metro de la franja, con ella | **−19,3 %** | −11,5 % |

Las dos familias de mallas convergen al mismo valor (117,8 kN·m/m en el metro). La de sin plantilla llega por arriba y deprisa; la de con plantilla llega por abajo, del lado inseguro, y despacio (−5 % aún con 0,25).

**Decisión PB-a** (tomada por Claude con estas medidas; el usuario la puede revertir): la plantilla de cara sólo va en las caras de viga que pasan por dentro de la huella. El pilar que las cruza (un 40 bajo una de 30, un circular de 40) la lleva como antes, con su aviso si no cabe. El enrasado (30 en 30) y el que queda dentro del ancho (25 en 30, o un 25 × 60 a lo largo de la viga) ni la llevan ni avisan. Al último ya le faltaba el metro (§14: «ése sí apoya en ella»), así que su aviso no tenía sentido.

Con eso no hace falta tocar la junta: la de un pilar que cruza la cara cae dentro de su huella. La junta delante de un pilar enrasado deja por la triangulación las tres celdas de delante, que es lo que mejor converge (la tabla de arriba, «sin plantilla de cara»).

## 5. Las islas (esquinas)

En `rejilla.ts` (`islasJuntoAPilares`, sólo con las esquinas de LV2), una isla es un componente de los lados que tocan losa, unidos por sus extremos, que cumple todo esto:
- **encierra losa:** toda la losa a los lados de sus lados cae en su caja; un hueco la tiene fuera;
- **toca la huella de un pilar y cabe en su caja ampliada en h:** un bloque de losa aparte, o un paño entre vigas, no;
- **tiene algún punto fuera de los nudos de la rejilla:** si no, no estorba.

Sus rasgos (puntos y lados) siguen siendo ajenos, pero sólo para las celdas que tocan (a ≤ tol), no para las que tienen a menos de δ. Al otro lado de los anchos de las vigas no hay láminas, sólo piezas de carga, así que lo que une la triangulación entre la isla y la celda regular de la esquina del paño no es losa.

Dos versiones intermedias fallaron, y por eso es así:
- quitar los rasgos de la isla del todo dejaba regular la celda que la contiene: con la losa 20 cm más allá de la viga (tira de borde), el área de la malla salía mal;
- marcar como irregulares las celdas que tocan la caja de la isla quitaba la plantilla a la retícula con núcleo. Y, en la retícula al azar 23, un punto de una isla sobre el lado de una celda regular hacía fallar la triangulación restringida («Constraining edge intersects point»), así que el refinamiento de la planta se perdía con el respaldo.

## 6. Resultados

**Avisos** (`validacion/pb/modelos.ts`, `src/compilador/pilaresBorde.test.ts`): ninguno de la malla junto a los pilares en el recuadro de 2 × 2 con:
- maciza y reticular;
- 20 cm de losa más allá de la viga;
- vigas de 50 con pilares de 30, pilares de 25 en vigas de 30;
- vigas de borde de esquina a esquina, vigas en todos los ejes;
- 3 × 2 vanos de 5 m.

Antes, en todos. En el ejemplo 11, ninguno en las tres plantas (antes, los de las esquinas y los de borde en las tres).

**Precisión, con h = 0,75 frente a la malla convergida** (mediana / máximo de |error|; `out_2x2.txt`, `out_ej11.txt`, `out_ej11acc.txt`):

| | Antes | Ahora |
|---|---|---|
| 2 × 2 maciza, viga en la cara de los pilares de esquina | 11,0 / 17,3 % | 4,9 / 8,0 % |
| 2 × 2 maciza, con h = 0,5 | 9,0 / 13,8 % | 2,7 / 4,3 % |
| Ejemplo 11 (gravitatorias), viga en las esquinas | 2,9 / 7,3 % | 0,6 / 1,2 % |
| Ejemplo 11 (con viento y sismo), viga en las esquinas | 1,1 / 4,1 % | 0,5 / 0,8 % |
| Ejemplo 11 (con viento y sismo), su máximo | 2,6 / 8,5 % | 0,3 / 2,8 % |
| Ejemplo 11, franjas: apoyo, armadura superior | 13,6 / 59,3 % | 13,2 / 14,9 % |
| Viga en la cara de los pilares de borde, metros de franja, vanos | — | igual |

Con la regresión de precisión local de HR (`precision.test.ts`, escalada al máximo de cada viga o franja), dos modelos nuevos, `recuadros-borde` y `recuadros-borde-reticular`, frente a h = 0,0625 congelado. Los dos fallan con el código de antes:
- la maciza, por el máximo de las vigas (2,6 % frente al umbral de 1,8 %; ahora 1,2 %);
- el reticular, por la mediana de las franjas junto a pilares con viga (5,2 % frente a 3 %; ahora 1,9 %).

**Lo que empeora: la armadura inferior en la cara de la viga junto a las esquinas** (PB-3). En el ejemplo 11 sin acciones, en la segunda franja desde la esquina, la armadura inferior en la cara de la viga pasa de +13…+18 % a −40…−50 % con 0,75, y una de 3,85 kN·m/m a 0,04. Son valores de 4–7 kN·m/m, muy por debajo de la armadura mínima, frente a 117 kN·m/m en las caras de los pilares. Es Wood–Armer con el torsor junto a la esquina, y con 0,5 el código de antes ya daba −30…−35 % en las mismas estaciones. Es de la plantilla de esquina de LV2, la misma de todas las esquinas de paño que la llevan, no de este cambio.

**Mallas:**
- las 48 retículas al azar de G, sin y con muros (`out_reticulas.txt`): 37 con menos nudos, ninguna con más, ninguna con el jacobiano mínimo más bajo y ningún aviso de calidad;
- los dos edificios objetivo de 7 plantas (con vigas en todos los ejes): la misma malla bit a bit, así que el coste en ecuaciones es nulo.

**Referencias congeladas:**
- sólo cambia la de BN1 (`portico-arriostrado` y `-h1`), regenerada a sabiendas. Sus pilares de esquina, de 30 en vigas de 30 con la losa hasta el eje, llevaban la plantilla de cara y ya no (213 frente a 237 nudos). El axil del tirante con viento, de 3,7060 a 3,7066 (`src/agente/barras.test.ts`);
- las de C1–C5, F, la de precisión de HR y las demás, idénticas;
- `precision-fina.json` lleva los dos modelos nuevos; los de antes, al byte.

**Compilador PB1.** Con `refinoEsquinas: false`, la malla de LV1, como siempre.

## 7. Hallazgos

- **PB-1: con h = 0,25, la viga en la cara de un pilar de borde enrasado sale un 5–10 % alta.** Delante del pilar hay ahí celdas regulares sin la plantilla. VS5 tomó 0,25 como referencia; para medir una malla hay que bajar a 0,125 o a 0,0625, donde las dos familias coinciden.
- **PB-2: la plantilla de cara de LV2 (§10) empeoraba la malla donde la huella no cruza la cara.** §14 la midió sólo con pilares que la cruzan. Hasta ahora casi nunca entraba en un enrasado (la junta de §2 lo impedía), salvo con `franjas: false` o con la losa hasta el eje (BN1).
- **PB-3: la armadura inferior en la cara de la viga junto a las esquinas es inestable con la malla** (§6), con o sin la plantilla de esquina.
- **PB-4: con `franjas: false`, la viga en la cara de un pilar de borde enrasado sale un 7 % alta con 0,75 y 0,5** (antes de PB, un 9 %, con la plantilla de cara). Sin las caras comunes de las franjas, la línea del eje del pilar pasa por la junta y las celdas de delante son regulares.
- **PB-5: el pilar de esquina mayor que su viga (45, 50 o 30 × 50 bajo vigas de 30) sigue sin la plantilla de esquina.** Asoma dentro de la esquina del paño, y sus vértices no son una isla: tocan el paño. Ya pasaba antes. Lo natural sería llevar a las esquinas las tiras de LV-8 (hoy sólo para un ancho que atraviesa la huella de lado a lado, no para dos que acaban en ella).
- **PB-6: un pilar que sobresale menos de ε_snap del borde de la losa** (35 bajo una viga de 30, con la losa hasta la cara de la viga) deja una tira de 2,5 cm de losa a lo largo de toda la fachada: unos 3 000 nudos y aviso de calidad. El arreglo lleva el contorno a la cara del pilar. Ya pasaba antes, y `losa/ajuste` lo avisa («su borde se mueve hasta 2,5 cm»): es el modelo, no la malla.
- **PB-7: el máximo positivo de la viga en la cara de un pilar de borde, con viento, sale con 0,75 un 4–9 % bajo** (8 kN·m en el ejemplo 11; con 0,5, a ±1 %). No cambia con PB.

## 8. Para el usuario

- **PB-a:** confirmar que la plantilla de cara se queda sólo para los pilares que cruzan la cara de su viga (§4).
- **PB-5 y PB-7:** si se sigue, el pilar de esquina mayor que su viga (las tiras de LV-8 en las esquinas) es lo siguiente en las esquinas. El −4…−9 % de PB-7 está en un momento pequeño y baja con 0,5.

## 9. Ficheros

- `src/compilador/rejilla.ts`: `islasJuntoAPilares`, los rasgos de una isla en `cerca` y la regla de §10; la cabecera, §8 y §10.
- `src/compilador/compilar.ts`: compilador PB1.
- `src/compilador/pilaresBorde.test.ts` (nueva), `precision.test.ts` (dos modelos), `asoma.test.ts` (el aviso, con P2-1 de la retícula 12; P1-1 de la 4 ya no avisa) y `src/agente/barras.test.ts` (el axil del tirante).
- `validacion/pb/`: `modelos.ts` (recuadros con vigas de borde), `medir.ts`, `comparar.ts`, `reticulas.ts` y las salidas `out_*.txt` (las de cada medida en bruto, `out_*.json`, no se versionan).
- `validacion/hr/congelar-fina.ts`: los dos modelos y regenerar sólo los que se nombran.
