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

## 10. PB-5: el pilar de esquina mayor que sus vigas (2026-11-08)

Encargo: quitar `malla/esquina-sin-refinar` de los pilares de esquina mayores que sus vigas (45, 50 o 30 × 50 bajo vigas de 30), llevando a las esquinas las tiras de LV-8. Medido con `validacion/pb5/` frente a h = 0,0625 con ε_snap = 0,025 (la misma malla con el código de antes y el de después, porque allí ninguna de las dos cosas entra) y antes con un árbol de trabajo en el commit 7f37e09 (HR-8).

**Lo que estorba.** Dentro de la esquina del paño, entre las caras de las dos vigas, asoma un rectángulo de la huella (7,5 × 7,5 cm con un 45 bajo vigas de 30), o sólo la esquina de la huella sobre la cara de una viga (un 30 × 50 con el lado largo a lo largo de ella). Esos rasgos dejan irregular la celda de la esquina, y la plantilla de esquina no entra.

**Las tiras de LV-8 en las esquinas: descartadas.** Partir la huella por los anchos que acaban en ella da justo ese rectángulo como tira (con su plantilla de pilar de 5). El aviso desaparece, pero la tira deja en la celda elementos de 7,5 cm × 1,4 m sin graduar hacia la esquina. Con h = 0,75, la viga en la cara del pilar de esquina pasa del −5,9 % al −23,6 % de la convergida, y con vigas en todos los ejes, la de borde llega al −74 % (`log_medir_tiras.txt`).

**La plantilla de esquina absorbiendo lo que asoma: medida, y no se queda** (`absorcion.patch`, sobre `rejilla.ts`). Los nudos (1, 0), (0, 1) y (1, 1) del elemento más fino de la graduada van a las esquinas de lo que asoma (con el 30 × 50, sólo el de la cara). Si lo que asoma pasa del doble del elemento fino, un nivel menos; si no cabe ninguno, la rejilla se rehace sin absorber ese pilar, por la triangulación y con su aviso. Con 0,125 o menos no entra nunca: las mallas finas no cambian. Sin avisos en los recuadros y en el ejemplo 11 con punto fijo.

| Con h = 0,75, frente a la convergida | Antes (triangulación) | Absorbiendo |
|---|---|---|
| 2 × 2, viga en la cara del pilar de esquina, 45 / 50 / 30 × 50 | −5,9 / −7,4 / +29,8 % | +1,2 / +2,1 / +14,2 % |
| 2 × 2 con vigas en todos los ejes, viga en la cara de los de borde | −13,0 % | +2,5 % |
| 2 × 2 con vigas en todos los ejes, metro de franja en los pilares interiores | +22,5 % | +3,6 % |
| 2 × 2, metro de la franja en la cara del pilar de esquina, 45 / 50 / 30 × 50 | −1,8 / +15,8 / −51,7 % | +1,4 / −0,5 / −12,6 % |
| 2 × 2, el mismo metro con h = 0,6 y 0,5 (45) | +0,6 / +2,0 % | **−10,2 / −9,9 %** |
| 2 × 2, armadura inferior en la cara de la viga junto a la esquina (45, con vigas interiores) | −7,0 % | **−21,6 %** |
| Ejemplo 11 con punto fijo, viga en la cara del pilar de esquina (mediana / máximo) | 1,8 / 6,0 % | 6,5 / 8,8 % (del lado seguro) |
| Ejemplo 11 con punto fijo, metro de la franja en la cara del pilar de esquina (F2 y F3) | −1…−11 % | **−6…−19 %** |

(`out_absorcion_recuadros.txt`, `out_absorcion_pf.txt`; la serie de h, con `serie.ts`.)

Mejora mucho la viga en la cara del pilar en los recuadros, pero el metro de la franja en la cara del pilar de esquina, la armadura superior que dimensiona, sale más bajo, del lado inseguro: en el ejemplo real, con el h por defecto. El mx de esa estación, que es un corte exacto por fuerzas nodales, salía antes siempre alto (+7…+10 % en el 2 × 2, por la triangulación junto a la huella rígida, como F3-8). Ahora queda a ±7 %, y lo que lo baja es sobre todo el mxy a un canto de la cara (LV2-h), que la plantilla resuelve peor. Exigir que el elemento fino no crezca (el nivel con el elemento al menos tan grande como lo que asoma) no lo cambia. Por la regla de oro 1 no se activa: el aviso se queda y la esquina va por la triangulación.

**Lo que sí se queda: la simetría del 40** (`losas.ts`, `tapada`). Un 40 bajo vigas de 30 asoma justo ε_snap. `tapada` no siembra una huella si todo lo que asoma queda a ≤ ε_snap de los anchos o fuera de la losa, y el lado de fuera del pilar de esquina queda a ε_snap justo del borde de la losa. Sin holgura, lo decidía el redondeo (0,05000000000000002 en P0-0 y 0,049999999999998934 en las otras): P0-0 salía tapado y las otras tres no. Tapada, la esquina del pilar sólo se une a la losa por un nudo: con 0,75, la viga en la cara de P0-0 salía un 31 % alta y el metro de su franja, un 17 % bajo, frente al 1 % y el −8 % de las otras tres. Ahora lo que queda a ε_snap + 10·ε_geom de la losa cuenta como losa, y ninguna sale tapada: las cuatro esquinas, a 0,9 / 1,3 % en la viga y 6,0 / −7,7 % en el metro, todas con el aviso, que es verdad (`out_p40.txt`). Hacerlas tapadas a las cuatro (la holgura al revés) dejaba las cuatro como P0-0. Lo mismo con el 40 × 60. Con h = 0,5, el 40 sale mal en todo (viga en la cara de esquina y de borde +23…+37 %): la referencia, con ε_snap = 2,5 cm, ya no lo trata como «asoma ε_snap». Es otro modelo, como PB-6. Prueba: `pilaresBorde.test.ts` (falla con el código de antes). Las referencias congeladas no cambian (1 260 pruebas del compilador y del agente).

**Hallazgos:**
- **PB-8 (grave, previo): con h ≥ 0,6, el metro de la franja en la cara del pilar de esquina de 40 × 40 con la esquina fija (planta F1 del ejemplo 11 con punto fijo) sale un 80–90 % bajo, sin aviso.** La estación es válida y por fuerzas nodales, pero da mx = −1,8 kN·m/m (caso Q) frente a −18,4 con la malla fina (−17,1 con 0,5): de 0,6 a 1 sale igual de mal. El pilar asoma 25 cm dentro de la esquina del paño; la recta de la cara (x = 0,4) cruza la huella rígida y sólo 16 cm de losa dentro de la ventana. No es de PB-5 (antes y ahora, igual). **Corregido en §11.**
- **PB-9: el metro de la franja en la cara del pilar de esquina es la medida menos fiable de la losa en las esquinas, con cualquier malla gruesa.** Con la triangulación, en el 30 × 50, −52 % (antes y ahora). Con lo que asoma pequeño sale bien, y con lo que asoma grande, mal. Lo que manda es cómo se mide (el corte por la recta de la cara, el escalón y el mxy a un canto) más que la malla. Antes de volver a la malla de las esquinas hay que mirar esto.
- **PB-10: en la F2 del ejemplo con punto fijo (30 × 30 con la esquina fija) avisan P3 y P7, pero no P1 ni P9:** otra asimetría de las esquinas, sin investigar.

**Para el usuario:**
- si se sigue, PB-8 primero: es un fallo silencioso del lado inseguro con el h por defecto (hecho, §11);
- la absorción (`absorcion.patch`) queda medida por si, tras PB-8 y PB-9, el metro de la esquina se mide de otra forma.

## 11. PB-8: el metro de un pilar con el eje más allá de la recta del escalón (2026-11-08)

**Dónde.** Un pilar sin cara de franja en una dirección (SP-3, SP-4: lo cruza una viga según la transversal) mide su metro por la recta de su cara si sigue la malla en la ventana y, si no, por el escalón desde una recta de la malla que cruce su huella: con la unión de la losa por las caras de las vigas (LV), la cara de la viga. El escalón es My(cara) = My(base) − dx·Vz, con la base cortada del lado del vano y con lo que transmite el enlace de la huella (F3). En el 40 × 40 de esquina con la esquina fija, con h ≥ 0,6, la recta de su cara (x = 0,4) no sigue la malla en los 16 cm de losa de la ventana que quedan más allá de la huella, y el metro va por el escalón desde la cara de la viga Y (x = 0,15, dx = 0,25).

**Por qué salía casi cero.** El motor cuenta una restricción en un corte si tiene nudos a los dos lados del plano, y suma las fuerzas de sus nudos del lado A, maestro incluido (`cortes.ts`). Con el pilar centrado, el maestro (su eje) queda detrás de la base, y lo sumado son los esclavos de delante: lo que la losa da al pilar por delante de la base, que es lo que el escalón necesita. Con el punto fijo en la esquina, el eje del pilar (0,2; 0,2) queda delante de la base. La suma del enlace, equilibrado, sobre casi todos sus nudos daba casi nada: en la F1, el resto del enlace era +0,17 kN·m frente a −3,2 y −4,6 en los casos que salían bien. Ni el campo SPR a δ de la cara sirve de respaldo: junto a la esquina rígida da −7,0 y −6,2 frente a −18.

**El arreglo** (motor y franjas, sin cambio de malla ni de versión del compilador): la opción `soloEsclavos` del corte (con `restricciones`, de cada una sólo sus esclavos; el maestro cuenta como del otro lado), que el escalón usa siempre. Con el maestro detrás o sobre la recta, el mismo resultado bit a bit.

| mx de Q (o Wood–Armer superior) en la cara del pilar de esquina, frente a la fina | h = 0,75 antes | h = 0,75 ahora | h = 0,5 (corte directo) |
|---|---|---|---|
| 2 × 2 con P0-0 de 40 × 40 y la esquina fija (`pb8min.ts`) | −43 % (−53 % con 0,6) | −5 % (−16 % con 0,6) | −13 % |
| Ejemplo 11 con punto fijo, F1, las ocho estaciones | −80…−85 % | −10…−14 % | −8…−11 % |

(`out_pb8_pf.txt`.) En el ejemplo 11 cambian 19 de 816 estaciones con 0,75, todas de la F1, y ninguna con 0,5; las vigas y la referencia fina, nada. Lo que queda (−10…−14 %) es del orden del error del escalón medido en SP-6 (±10–13 % en los momentos que dimensionan) y del corte directo con 0,5.

**Pruebas:** `src/motor/cortes.test.ts` (con el maestro al otro lado, bit a bit; del mismo lado, cambia) y `src/compilador/metroPuntoFijo.test.ts` (el metro con 0,75 y 0,6 a menos del 20 % del de 0,125; falla con el código de antes).

**Sigue abierto (PB-11):** el 30 × 50 de esquina con el lado largo a lo largo de una viga. Su cara en esa dirección queda entera dentro del ancho de la viga y no toca la losa, así que su «estación de cara» mide la losa junto a la esquina del pilar. Por el escalón sale mx = −0,57 frente a −5,25 de la fina (con 4,6 de mxy, el Wood–Armer superior a −52 %). No tiene enlace que contar (en la losa la huella no tiene esclavos delante de la base), así que esto no lo arregla. Lo natural sería que un pilar cuya cara no toca la losa no tenga estación de cara en esa dirección, y dejar que la franja tome ahí la de apoyo en la cara de la viga. **Medido en §12: no era eso.**

## 12. PB-11: lo que la tira del escalón da a la viga que llega al pilar (2026-11-08)

**Dónde.** El 2 × 2 de PB con pilares de 30 × 50, el lado largo según X. En P2-2 (esquina de (12, 12)), la huella va de x = 11,75 a 12,25 y de y = 11,85 a 12,15: según X asoma 10 cm de la viga Y (cara x = 11,85) y según Y queda entera en el ancho de la viga X (de 11,85 a 12,15). La franja X13 mide su metro en x = 11,75, con la ventana de y = 11,5 a 12,5 (losa hasta 11,85: 0,35 m). Con h ≥ 0,5 la recta no sigue la malla y va por el escalón desde la cara de la viga Y (x = 11,85, dx = 0,1); con h ≤ 0,25, por el corte directo.

**Lo que dice la malla fina** (`validacion/pb11/estacion.ts`, mx del caso Q, kN·m/m):

| h | 0,75 | 0,5 | 0,25 | 0,125 | 0,0625 |
|---|---|---|---|---|---|
| en x = 11,75 (la estación), antes | −0,57 (escalón) | −0,12 (escalón) | −5,50 | −6,11 | −5,25 |
| en x = 11,85 (la cara de la viga), corte directo en la ventana | −0,35 | −0,53 | −0,03 | −1,27 | −1,50 |

En 10 cm el momento de la franja cae de −5,3 a −1,5: casi todo entra entre las dos rectas. **La propuesta de §11 (quitar la estación y tomar la de apoyo en la cara de la viga) daba aún menos**, y además esa estación de apoyo deja fuera la ventana del pilar (LV2 §14), así que no habría ninguna.

**Por dónde entra.** Los nudos de la losa en y = 11,85 con x de 11,75 a 11,85 (el borde de la huella que da a la losa) no son de la huella: son de la cara de la viga X, enlazados (LV) a su nudo del eje en x = 11,8, a 7,5 cm de su zona rígida. La losa de la tira da el momento a esos nudos, la viga lo lleva al pilar por torsión en un tramo de centímetros, casi rígido. El escalón (F3, SP-3) cuenta la recta base y lo que la tira da a la huella del pilar (su enlace), pero no lo que da a la viga.

**El arreglo** (motor y franjas; sin cambio de malla ni de versión del compilador):
- en el motor, la opción `esclavos` del corte (con `restricciones` y `soloEsclavos`, sólo esos nudos de sus esclavos);
- en el escalón (`esfuerzosFranjas.ts`), además del enlace del pilar, los enlaces de las caras de las vigas con sus nudos en la tira (entre la recta base y la de la cara, incluida esta) y en la ventana, con tres condiciones:
  - **de una viga según la franja** (el enlace va de la cara al eje según n). Sin esto, en `aleatorio-3-lv` (LV1, con la cara de una viga inclinada unos mm) entraban los nudos de la cara de la viga de la recta base, con todo su apoyo: una estación de 3,6 pasaba a 86 kN·m/m;
  - **en la ventana**, no en todo el tramo cortado;
  - **con losa flexible al lado:** a 1 mm del nudo, hacia la losa y hacia la base, no está la huella (`SONDA_TIRA`). Bajo lo que asoma de un pilar mayor que su viga (el 45 o el 50 bajo vigas de 30, las esquinas del ejemplo 11 con punto fijo), la cara de la viga recibe lo que le da la huella, no la losa de la franja. Sin esta condición, en la F3 del ejemplo con punto fijo (25 × 25 con la esquina fija) el metro de las esquinas pasaba del −2…−4 % al −14…−22 % de la fina con h = 0,75, del lado inseguro.

Con eso el arreglo sólo actúa donde la viga que llega al pilar tiene losa flexible delante de la huella: el 30 × 50 de PB-11 y la punta de un pilar girado sobre su viga.

**Resultado en la estación de PB-11:**

| h | 0,75 | 0,5 | 0,25 | 0,125 | 0,0625 |
|---|---|---|---|---|---|
| mx, ahora | −4,62 | −4,12 | −5,50 | −6,11 | −5,25 |
| Wood–Armer superior, ahora (antes) | 8,81 (4,77) | 8,49 (4,49) | 9,32 | 10,66 | 9,88 |

**En el conjunto** (`validacion/pb11/out_comparar.txt`: `validacion/pb/medir.ts` con el código de antes, en un árbol de trabajo, y el de ahora, frente a h = 0,0625 de ahora; las vigas y los grupos de franjas de §6, en los 2 × 2 de 30, 30 con interiores, 45, 45 con interiores, 50 y 30 × 50, y en el ejemplo 11 con y sin punto fijo): sólo cambia el 30 × 50, las caras de las esquinas (superior, con h = 0,75, del −51,7 al −10,8 %; con 0,5, del −54,7 al −14,1 %; la inferior, que antes no era nula frente a una referencia nula, ahora lo es). Todo lo demás, igual.

**El escalón frente al corte directo en la misma malla** (`escalonDirecto.ts`, h = 0,125, todas las estaciones de cara de los pilares sin cara de franja, Wood–Armer superior): en el 30 × 50, la mediana de |escalón / directo − 1| pasa del 49,0 al 9,7 %; en los recuadros de 45 y 50 y en el ejemplo 11 con punto fijo, los mismos bits que antes.

**Lo que queda, PB-12:** en la estación de PB-11, el escalón sale un ~10 % por debajo del directo también con las mallas finas (−4,17 frente a −5,25 con h = 0,0625). Es lo que entra por los bordes laterales de la ventana en la tira, el torsor (mxy ≈ 4,6 × 0,1 m / 0,35 m ≈ 1,3 kN·m/m): el mismo ~5–13 % de SP-6. Se probó a sumarlo con un corte por campos según n por cada borde de la ventana: en las esquinas del 30 × 50 deja el escalón a 0,5–2,1 % del directo, pero en los pilares de borde (con los dos bordes en la losa) lo aleja (−14…−21 %, −41 % en el ejemplo con punto fijo), porque el reparto de las láminas en los bordes de la ventana no es una recta exacta y en una tira de 7,5–10 cm pesa tanto como el término. Descartado. **Corregido en §14:** no era el reparto sino el signo; con el signo bueno cierra la diferencia en las mallas finas, pero no en las de uso.

**Pruebas:** `src/motor/cortes.test.ts` (con todos los esclavos, lo de `soloEsclavos` bit a bit; sin ninguno, sin la restricción; dos grupos, la suma) y `src/compilador/metroCaraEnViga.test.ts` (el metro de P2-2 con 0,75 y 0,5: mx a menos del 35 % y Wood–Armer superior a menos del 25 % del de 0,125; falla con el código de antes, con mx a −91 %).

**Referencia congelada de F** (`validacion/f/out_cambiosPB11.txt`, regenerada a sabiendas): cambian sólo las estaciones del pilar girado 45° de `aleatorio-3-lv` (tres) y de `-lv2` (dos), la punta que asoma de su viga de borde; las otras 16, bit a bit. En Y5, con h = 0,75 / 0,5 / 0,25 / 0,125, mx pasa de −4,2 / −7,2 / −8,7 / −7,0 a −7,9 / −8,6 / −9,9 / −9,1: estable con la malla. En X1 (cara 4,867), de 0 en todas las mallas a −9,9 / −9,9 / −7,8 / −3,8 (−2,0 con 0,0625): del lado seguro, sin converger con la malla gruesa; es la punta de un pilar girado, singular.

## 14. PB-12: el torsor que entra en la tira del escalón (2026-11-08)

**Qué falta.** El escalón da My(cara) = My(base) − dx·Vz más lo que la tira da a la huella (F3, PB-8) y a la cara de una viga según la franja (PB-11). Del equilibrio de la tira (de la recta base a la cara, en la ventana) falta lo que entra por sus dos bordes laterales, t = los extremos de la ventana: el torsor ∫ mxy ds y el cortante por su brazo. En el corte, My(cara) = My(base) − dx·Vz + Σ T_l·(x_l·y_f), con T_l el T del corte por el borde (normal x_l, de fuera hacia la ventana, reducido en la recta de la cara) y y_f el eje y del corte de la franja. **El signo:** el My de los cortes va con el convenio de las barras (por eso el traslado es My − dx·Vz) y T es el vector. El intento de §12 que «empeoraba los pilares de borde» lo sumaba con el signo al revés.

**En la misma malla** (`validacion/pb12/lateral.ts`, mx de la suma de los casos frente al corte directo; `log_lateral_0125.txt`, `log_lateral_00625.txt`, que traen además una variante por fuerzas nodales, descartada: los nudos de las esquinas de la ventana pesan más que el término):

| Estaciones del escalón, frente al directo | h = 0,125, escalón | + bordes por campos | h = 0,0625, escalón | + bordes por campos |
|---|---|---|---|---|
| 30 × 50, esquina y borde | −17,0 / −12,6 % | +0,8 / +2,1 % | −20,6 / −14,0 % | 0,0 / +0,2 % |
| 45, esquina y borde | −5,2 / −6,4 % | −1,8 / +1,1 % | +1,1 / −6,9 % | +4,2 / −0,1 % |
| 45 con vigas interiores, borde y cruces | −3,6…+3,1 % | +4,5…+7,6 % | −6,4…+6,7 % | +3,9…+8,6 % |
| Ejemplo 11 con punto fijo, F1 (40 × 40) | −2,8…−6,0 % | −8,7…−16,0 % | −2,0…−6,3 % | +0,9…−3,0 % |
| F3 (25 × 25), bordes | −17…−18 % | +5,4…+6,2 % | −19…−20 % | +1,6…+2,0 % |
| F3, esquinas | −2,1…−6,3 % | +20…+21 % | −5,5…−6,1 % | +15,6…+16,1 % |

- **El término es real** y es lo que separa el escalón del directo (SP-6, §12): con h = 0,0625 sumarlo deja a ≤ 3 % la mayoría de las estaciones, también los bordes de la F3, que el escalón daba un 20 % bajos.
- **Se pasa, del lado seguro, donde la esquina de la huella asoma en la tira junto a la cara de una viga perpendicular** (las esquinas de 45 y de 25 × 25 bajo vigas de 30, los cruces de 45 bajo vigas en los dos sentidos): +4…+16 %. Allí la esquina de la huella cae en la recta de la cara, y el escalón tampoco es estable entre 0,125 y 0,0625 (±6 %).

**Con las mallas de uso** (`validacion/pb12/serie.ts`, Wood–Armer superior de la suma de los casos frente a h = 0,0625 por el directo; con h ≤ 0,25 casi todas van ya por el directo y no cambian; `out_serie_*.txt` por campos en la tira y `out_serieCanto_*.txt` con los bordes a un canto de la cara hacia el vano, fuera de la capa límite de la viga, como las muestras de LV2-h):

| Estaciones bajo −10 % / sobre +10 %, h = 0,75 | Escalón | + por campos en la tira | + a un canto |
|---|---|---|---|
| 30 × 50 (6) | 6 / 0 | 0 / 0 | 0 / 0 |
| 45 (12) y 50 (12) | 4 / 8 | 4 / 8 | 4 / 8 |
| 45 con vigas interiores (24) | 0 / 12 | 0 / 16 | 0 / 16 |
| Ejemplo 11 con punto fijo (36) | 11 / 0 | 18 / 10 | 10 / 6 |

Con h = 0,5, en el ejemplo con punto fijo, de 9 bajo −10 % a 5 (por campos) o 4 (a un canto), y el sesgo medio, de −7,7 a −1,7 / −1,9 %. **Pero ninguna variante es mejor en todas las estaciones:** con h = 0,75, las ocho caras de los 40 × 40 de esquina de la F1 (la esquina fija, PB-8) pasan del −10…−14 % al −16…−21 % (a un canto) o al −20…−24 % (por campos), del lado inseguro: en la malla gruesa el campo de la tira cambia hasta de signo entre mallas (en la F1, positivo con 0,125 y negativo con 0,0625). Y las esquinas de la F3 pasan del −2…−9 % al +4…+16 %.

**Decisión de Claude, pendiente del usuario: no se suma por defecto.** Queda la opción de medida `lateralEscalon` (`"campos"` o `"canto"`) en `EsfuerzosFranjas`, sin efecto si no se da; las referencias congeladas no cambian. Lo que queda abierto, para el usuario:
- **(a) Dejarlo como está** (recomendado mientras no haya otra cosa): el escalón sale un 5–10 % bajo de media frente a la fina en estas caras, del mismo orden que el error de malla de SP-3/SP-4, y lo peor (las esquinas de 40 × 40 con la esquina fija) no lo arregla ninguna variante.
- **(b) Sumarlo a un canto:** quita las estaciones bajas del 30 × 50 y la mitad de las del ejemplo con punto fijo con 0,5, a cambio de empeorar en 0,75 las esquinas de la F1 y de un +10–15 % de más en las esquinas que asoman.
- **(c) Sumarlo sólo donde la huella no asoma en la tira junto a una viga perpendicular** (el 30 × 50 y los bordes): ajusta la regla a tres configuraciones de dos modelos. Antes habría que medirlo en las retículas al azar de G.

## 15. Ficheros

- `src/compilador/rejilla.ts`: `islasJuntoAPilares`, los rasgos de una isla en `cerca` y la regla de §10; la cabecera, §8 y §10.
- `src/compilador/compilar.ts`: compilador PB1.
- `src/compilador/pilaresBorde.test.ts` (nueva), `precision.test.ts` (dos modelos), `asoma.test.ts` (el aviso, con P2-1 de la retícula 12; P1-1 de la 4 ya no avisa) y `src/agente/barras.test.ts` (el axil del tirante).
- `validacion/pb/`: `modelos.ts` (recuadros con vigas de borde), `medir.ts`, `comparar.ts`, `reticulas.ts` y las salidas `out_*.txt` (las de cada medida en bruto, `out_*.json`, no se versionan).
- `validacion/hr/congelar-fina.ts`: los dos modelos y regenerar sólo los que se nombran.
- PB-11 (§12): `src/motor/cortes.ts` (`esclavos`), `src/compilador/esfuerzosFranjas.ts` (los enlaces de las vigas en la tira del escalón), `cortes.test.ts`, `metroCaraEnViga.test.ts`, `validacion/f/cambiosPB11.ts` y `out_cambiosPB11.txt`, y `validacion/pb11/`: `estacion.ts` (las estaciones de las esquinas, por defecto y con el escalón), `escalonDirecto.ts` (el escalón frente al corte directo en la misma malla), `serieCongelado.ts` (una estación de la referencia congelada con varias mallas), `medir.sh` y `medirAhora.sh` (las medidas de `validacion/pb/medir.ts`, antes con un árbol de trabajo en el commit anterior; sus `out_pb11-*.json`, sin versionar) y las salidas `out_*.txt` y `log_*.txt`.
- PB-8 (§11): `src/motor/cortes.ts` (`soloEsclavos`), `src/compilador/esfuerzosFranjas.ts`, `cortes.test.ts`, `metroPuntoFijo.test.ts` y, en `validacion/pb5/`, `pb8min.ts` y `out_pb8_pf.txt`.
- PB-5 (§10): `src/compilador/losas.ts` (la holgura de `tapada`), `pilaresBorde.test.ts` y `validacion/pb5/`: `avisos.ts` y `ej11.ts` (avisos con el código de una carpeta), `medir.sh` (las medidas con `validacion/pb/medir.ts`; sus `out_pb5-*.json` en `validacion/pb/`, sin versionar), `serie.ts`, `lista.ts` y `valores.ts` (leerlas), `estacion.ts` (una estación de franja con mx, my y mxy), `absorcion.patch` y las salidas `out_*.txt` y `log_*.txt`.
- PB-12 (§14): `src/compilador/esfuerzosFranjas.ts` (la opción de medida `lateralEscalon`) y `validacion/pb12/`: `lateral.ts` (en la misma malla, frente al directo), `serie.ts` (con varias mallas frente a la fina; `PB12_VARIANTE=canto` para la variante a un canto) y sus salidas `log_*.txt` y `out_*.txt`.
