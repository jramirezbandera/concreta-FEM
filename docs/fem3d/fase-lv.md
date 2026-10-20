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

### 2.1 Diagnóstico del `my` de la cubierta y de P5 (2026-10-19, tras HR)

Con el compilador HR1 (`.datos/hr`, `out_hr.txt`): momentos de vano 0,92 / 0,95 / 0,91 / 0,82, flechas 0,91 / 0,91, P5 +24 / +15 / +33 % (PP / CM / Q). Lo medido, con los scripts `variantes.py`, `tramos.ts`, `zonas.py … negativos` y `viga.ts` (las variantes en `.datos/d-*`, fuera de git):

**Qué es lo que falta.** Es un solo recuadro, el de P4–P5–P8–P13–P12 (x 4,3–9, y 8,7–14,6), y en él todo sale a 0,6–0,8 de CYPE: la flecha en el centro (0,66–0,77), a lo largo de la viga P4–P5 (0,55–0,88) y de la de x = 4,26 (0,75–0,85), el `my` positivo del vano (0,65–0,81) y el negativo sobre los ábacos de P8 (0,42–0,76) y de P13 (0,73–0,80). El `mx` coincide (0,95). La carga total de la cubierta superior es la misma (ΣN en la base de sus tramos: CYPE 613,6 kN, nuestro 625,0, +1,9 % de PP, el cruce pilar–losa de A-9): lo que CYPE manda a P13 (+9,6 kN) y a P4 (+3,1), nosotros lo mandamos a P5 (+12,6). El recuadro trabaja menos en Y y descarga más en P5.

**Lo que no es** (cada variante cambia una cosa sobre `hr`; `my` cub. / P5 PP):
- el empotramiento de la cabeza de los pilares: con 1, 0,80 / +23 %; con 0, 0,86 / +25 %; sólo P5 rígido, 0,82 / +23 %;
- la huella rígida: P5 como un punto, 0,82 / +22 %; todos los pilares como un punto, 0,84 / +26 % (sólo sube las flechas de 0,91 a 0,94–0,95);
- las vigas de la cubierta baja: con ×0,1 de flexión, la baja pasa a 1,00–1,08 y la superior no se mueve (0,82 / +23 %); el borde x = 4,26 de la baja entre P19 y P4 sin flexión (en la captura de CYPE va dibujado hueco y sin número de pórtico, a diferencia de las demás vigas), 0,82 / +23 %;
- la zona rígida 1 (`lv-zr1`): 0,79 / +25 %;
- la longitud libre del tramo corto (abajo).

**Lo que lo mueve: la flexión de las seis vigas de la cubierta superior.** Dosis (canto menor con el mismo ancho, sección embebida):

| Vigas de la superior | mx cub. | my cub. | Flecha cub. | P4 PP | P5 PP | P13 PP |
|---|---|---|---|---|---|---|
| ×1 (hr) | 0,95 | 0,82 | 0,91 | −5 % | +24 % | −7 % |
| ×0,5 | 0,99 | 0,92 | 0,98 | −6 % | +18 % | −7 % |
| ×0,25 | 1,01 | 0,98 | 1,02 | −8 % | +13 % | −6 % |
| ×0,1 | 1,02 | 1,03 | 1,06 | −9 % | +9 % | −5 % |

Sólo la de x = 4,26 (P4–P12–P15) a ×0,1: 0,86 / +23 %; sólo la P4–P5: 0,82 / +17 %. Las dos juntas no bastan: hace falta todo el contorno. En la cubierta baja pasa lo mismo a menor escala: con sus vigas a ×0,5 queda a 0,96–0,98 en momentos y flechas, y la viga P22–P23 da +7,63 kN·m de vano frente a los +7,40 de CYPE (con ×1, +13,2); a ×0,25 se pasa (1,04). Los negativos de esa viga en las caras siguen por debajo (−3,7 / −1,5 frente a −5,45 / −4,96 de CYPE) con el mismo cortante (22,8 / 19,6 frente a 20,8): en CYPE la viga está más empotrada en relación con su vano, que es lo que se espera de una viga más flexible frente a los mismos pilares.

**Lo que dice CYPE.** La tabla de rigideces de su memoria (ccadmc01, p. 20, imagen) da a las vigas de hormigón la sección bruta en EIy, ∞ en EIz y x·S.B. en torsión; sólo el «zuncho de borde» lleva EIy·10⁻¹⁵. Nada en la memoria explica que una viga plana de 30 × 30 dentro de un reticular de 30 trabaje a un cuarto o a la mitad de su inercia bruta. El modelo del usuario (listado, §12) lleva 0,3 en cabeza y 2,0 de rigidez axil, como nosotros.

**De paso, el tramo corto de 0,90 m entre las dos cubiertas.** En CYPE los pilares que pasan de una cubierta a otra llevan en ese tramo cortantes horizontales grandes con peso propio (P4 35,3 kN, P12 27,0, P19 9,0; momento en la base 16,2 kN·m en P4): los dos forjados se ayudan por ahí. Nosotros tenemos el mismo mecanismo pero más flojo (27,2 / 18,5 / 8,0), porque CYPE descuenta como rígido el medio canto del forjado inferior en la base del tramo (listado: tramo 3,50/4,10, 0,60 m libres) y nosotros sólo el medio canto en la cabeza (0,75 m libres; `piezas.ts`, C1). Con 0,60 m libres (`d-stub060`) salen 34,8 / 24,5 / 9,8 kN, pero el `my` y P5 no se mueven (0,82 / +23 %). Queda como diferencia de modelado conocida: poner el offset rígido también en la base del tramo cuando hay un forjado debajo (decisión LV-d, abajo).

**Para el usuario.** Lo que queda no se explica con ninguna hipótesis de modelado nuestra: el modelo de CYPE se comporta como si sus vigas de borde tuvieran un cuarto (superior) o la mitad (baja) de su rigidez a flexión. Para cerrarlo hace falta mirar en CYPECAD:
1. los diagramas de las vigas de la cubierta superior, sobre todo la P4–P5 (Z-CUB-S-5) y la P4–P12–P15 (Z-CUB-S-6), en 1,35·PP + 1,35·CM + 1,5·Q: los nuestros son `fem consultar viga` o `viga.ts <variante> Z-CUB-S-5`. Si CYPE da momentos y cortantes mucho menores que los nuestros, es la viga; si da los mismos, es la unión;
2. qué tipo de viga son las tres huecas de x = 4,26 en la planta 1 (P4–P12–P15–P19), y si las de la superior son «planas» o «descolgadas» de 30 × 30;
3. si los paños tienen algún coeficiente de empotramiento en bordes distinto de 1 (memoria, p. 19).

**Capturas de CYPE de las dos vigas (2026-10-20).** El usuario mandó los diagramas de CYPECAD del grupo 2 (cubierta superior), pórticos 3 (P4–P5) y 5 (P19–P15–P12–P4), envolvente persistente, con «decalar las leyes» marcado. Frente a los nuestros (`hr`, 1,35·PP + 1,35·CM + 1,5·Q, en las caras; kN·m y kN):

| Viga y punto | CYPE | Nuestro | Vigas ×0,25 | Losa superior ×0,5 |
|---|---|---|---|---|
| P4–P5, cara de P4 | −9,42 | −5,1 | −3,5 | −7,2 |
| P4–P5, vano | +7,13 | +8,9 | +4,4 | +12,1 |
| P4–P5, cara de P5 | −14,82 | −26,0 | −12,2 | −31,1 |
| P4–P5, V en P4 / P5 | 21,6 / 22,1 | 20,2 / 12,5 | 17,2 / 10,0 | 20,6 / 15,4 |
| P4–P12, cara de P4 | −23,83 | −17,2 | −11,5 | −23,5 |
| P4–P12, vano | +10,36 | +12,2 | +5,1 | +17,7 |
| P4–P12, en P12 | −14,99 | −20,3 | −9,0 | −28,5 |
| P4–P12, V en P4 / P12 | 63,1 / 25,8 | 47,4 / 32,3 | 48,8 / 24,5 | 49,1 / 36,9 |
| P12–P15, vano / cara de P15 | +1,39 / −4,32 | +1,4 / −2,4 | | |
| P12–P15, V en P12 / P15 | 16,1 / 9,65 | 17,8 / 6,7 | | |

- **Las vigas flexibles no explican los cortantes.** Las vigas de CYPE llevan más carga que las nuestras (la P4–P5, 43,7 kN entre las dos caras frente a 32,7; la P4–P12, 88,9 frente a 79,7), y con ×0,25 llevarían menos. Ninguna dosis de rigidez da a la vez los momentos y los cortantes de CYPE (pero véase la segunda tanda: los cortantes junto a P4 y P5 no son una buena prueba).
- **La losa más flexible, tampoco** (`d-losa-s-05`, `d-losa-s-025` en `variantes.py`): las vigas toman más momento y se alejan de CYPE.
- **Lo que difiere es el reparto entre los extremos.** CYPE empotra más las vigas en P4, la esquina convexa (−9,4 y −23,8 frente a −5,1 y −17,2), y mete por ella mucha más carga (63 kN de cortante en P4, con la ley muy empinada en el último metro, dentro del ábaco de P4). Nosotros empotramos más en P5 y en P12 (−26,0 y −20,3 frente a −14,8 y −15,0). Junto a P5 la viga casi no recibe carga de la losa en su primer metro (el cortante pasa de −12,5 a −11,5): lo que cae ahí va al pilar por el ábaco.
- **P5 está en una esquina entrante.** La losa superior sigue al este de P5 sin viga (la Z-CUB-S-4 va al norte y la Z-CUB-S-5 al oeste), y el ábaco de P5–P8 la rodea por tres lados. En nuestro modelo, la losa que sigue más allá de P5 da continuidad a la viga P4–P5 (−26 kN·m en su cara sin momento en la cabeza del pilar: 2,3 / 0,6 en CYPE, −0,3 / 3,4 nuestro, con peso propio) y lleva carga directa al pilar. CYPE no hace eso, o lo hace menos.
- **Lo que queda por mirar es cómo une CYPE ese ábaco con el pilar y con el extremo de la viga en P5** (y en P12). Las variantes de la cabeza, de la huella como un punto y de las vigas no lo cambian (la P4–P5 a 0,15 m del eje de P5: −24,6 con la cabeza a 1, −20,7 con las huellas como un punto y −18,4 con las vigas ×0,5).

**Segunda tanda de capturas (2026-10-20):** la planta de la cubierta superior en la entrada de vigas, la viga corta al norte de P5 (pórtico 7) y los isovalores de Momento X y Momento Y en 1,35·PP + 1,35·CM + 1,5·Q.
- **La geometría es la nuestra.** Los ábacos de la planta (medidos sobre la imagen) y los pilares del listado coinciden con la réplica a pocos centímetros. Los isovalores son los de `cype.json`.
- **La viga corta P5–norte da en la cara de P5 el mismo momento** (CYPE −10,66, nuestro −10,64 kN·m), **con mucho más cortante en CYPE** (19,2 frente a 5,7 kN, casi todo en los primeros 30 cm junto a P5). Igual que en P4–P5 junto a P5 y en P4–P12 junto a P4: en CYPE, la carga del ábaco entra en la viga junto al pilar. En el nuestro llega al pilar sin pasar por la cara de la viga.
- **No es la esquina de la huella que no tapa ninguna viga** (nuestras vigas acaban en el eje del pilar). Con las vigas de P4 y P5 hasta la cara del pilar (`d-vigas-cubren`), nada cambia: `my` 0,82 y P5 57,5 kN con peso propio (antes 57,8; CYPE 45,2).
- **Los cortantes junto a los pilares no sirven para medir la rigidez de la viga.** Dicen por dónde entra la carga en el nudo, no cuánto lleva la viga en el vano. En la baja, el cortante de la P22–P23 no se mueve con la rigidez de las vigas (22,7 / 22,8 / 23,8 kN con ×1 / ×0,5 / ×0,25; CYPE 20,8).
- **Lo que sí mide la rigidez relativa es el momento de vano de la viga frente al de la losa junto a ella**, porque las dos tienen la misma curvatura a lo largo de la cara: my/M ≈ D/EI. En la P4–P12, la losa a 0,15–0,40 m de la cara da 21,4 kN·m/m en CYPE y 17,5 en el nuestro, y la viga, +10,36 y +12,2: la razón es 2,07 en CYPE y 1,43 en el nuestro (×1,44). En la P22–P23 de la baja, mx de 23,3 y 21,4 frente a +7,40 y +13,2: 3,15 y 1,62 (×1,94). En el modelo de CYPE la viga es más flexible respecto a la losa que en el nuestro: la mitad en la baja (con ×0,5 la P22–P23 da +7,63) y algo menos en la superior (la P4–P5, +7,13 en CYPE frente a +8,9 con ×1 y +6,0 con ×0,5; la P4–P12, +10,36 frente a +12,2 y +7,7).
- **Pendiente del usuario:** qué es la línea roja a lo largo de la viga P4–P12 en la planta de CYPE (de P4 hasta encima de P12), y la captura de los datos generales de la obra (coeficientes de rigidez, redistribución) que no ha llegado.

**Decisión para el usuario, LV-d:** el offset rígido en la base de un tramo de pilar sobre un forjado (el medio canto del forjado inferior, como CYPE). Cambia los cortantes de los tramos cortos (aquí, de 27 a 35 kN en P4) y endurece ligeramente todos los pilares (3,20 m libres se quedan igual, porque el arranque no tiene forjado debajo). Propuesta: hacerlo, por coherencia con la cabeza (C1), y medir las referencias. **Decidida y hecha el 2026-10-20 (§2.2).**

### 2.2 LV-d: la zona rígida en la base de los tramos de pilar (2026-10-20; compilador LVD1)

**Qué cambia.** Hasta HR1, el tramo de un pilar era rígido sólo en su cabeza, a lo largo de `factorZonaRigida` veces el canto de la viga más alta o de la losa que le llega (C1), y su base empezaba en el nudo, en el plano medio del forjado: la mitad del nudo que queda por encima de ese plano trabajaba como pilar flexible. Ahora (`piezas.ts`, opción `zonaRigidaBase`, por defecto sí) la base de un tramo cuyo nudo inferior está en un forjado es rígida igual que la cabeza del tramo de debajo: `f` veces el canto de lo que ese nudo tiene encima, que es el espesor de la losa en la huella del pilar o el canto de la viga más alta que le llega en el plano del forjado (una viga con `insercion: "superior"` queda entera por debajo del nudo y no cuenta en la base, aunque sí en la cabeza del tramo de debajo, como en C1). Con `f` = 0,5 es el medio canto de CYPECAD en los dos extremos; con `f` = 1, el canto entero en los dos. El arranque no cambia si no tiene forjado debajo, y un pilar apeado sobre una losa o una viga lleva la zona de su huella. Los esfuerzos de la base se dan en la cara del forjado (`i'`), como los de la cabeza (`j'`), y la estación `s[1]` del mapeo lo lleva; los diagramas, las consultas y la app ya trabajaban con `s[1]…s[2]`. Un tramo que no cabe entre sus dos zonas es `pilar/tramo-flexible-nulo`, con los dos cantos en el mensaje. La malla no cambia ni un nudo y las ecuaciones son las mismas. Con `zonaRigidaBase: false`, el modelo de antes bit a bit: las referencias congeladas de C1–C5 y F lo llevan y siguen idénticas, y hay cuatro nuevas con el valor por defecto (`edificio-2x3x2-lvd`, `aleatorio-13-lvd`, `reticula-nucleo-lvd` y `edificio-2x2-lvd`). La regresión de precisión local de HR (`precision.test.ts`) se queda sin la base, porque su referencia fina es anterior y mide la malla, y el axil congelado del apeo realista (`apeo.test.ts`) se compara sin ella. Pruebas: `src/compilador/zonaRigidaBase.test.ts`, y el oráculo a mano del pórtico 3D de dos plantas (`validacion/c1/mano.ts`, criterio 2 de C1), que lleva ahora la base rígida del segundo tramo con su peso propio y el viento repartidos entre el nudo y el tramo flexible: el compilador lo da a 1e-10.

**La vivienda** (`.datos/lvd`, `out_lvd.txt`, `lvd/tramos.txt`; `.datos/lvd-sin` reproduce `hr`): lo que estaba cuadrado no se mueve: momentos de vano 0,92 / 0,95 / 0,91 / 0,82, flechas 0,91 / 0,91, P5 +23 / +15 / +33 %, carga total +1,0 %. Los cortantes de los tramos cortos de 0,90 m con peso propio pasan de 27,2 / 18,5 / 8,0 kN (P4 / P12 / P19) a 32,7 / 23,0 / 9,6, frente a 35,3 / 27,0 / 9,0 de CYPE: de −23 / −31 / −11 % a −7 / −15 / +7 %. Quedan por debajo de los 34,8 / 24,5 / 9,8 de la variante `d-stub060` de §2.1, que daba los 0,60 m libres de otra forma; lo que queda es dónde está el tramo flexible dentro de los 0,90 m, y no se persigue más.

**Los edificios objetivo** (`validacion/lvd/medir.ts`, `out_medir.txt`; con la base frente a sólo la cabeza):
- el de barras de C1 (7 plantas, 80 pilares; vigas de 0,60, así que cada tramo intermedio pierde 0,30 m flexibles en la base): la deriva de cabeza con Vx baja un 14,4 % y el desplome relativo máximo, un 15,7 %; el momento de la viga X5-N3 en la cara del pilar con G, un 1,9 %; en el tramo de N3 del pilar interior, el cortante con Vx baja de 4,8 a 4,7 kN y el momento de la base, de 6,1 a 5,2 kN·m (se da 0,30 m más arriba); en el de esquina, el cortante con G sube de 20,0 a 21,0 kN;
- el reducido con losas de C2 (2 plantas, 3 × 2 vanos): deriva −17,6 %, desplome −22,1 %, flecha máxima de la losa −1,6 %; en el pilar de esquina, el cortante con G sube de 11,8 a 14,5 kN y el momento de la base, de 16,2 a 17,8 kN·m.

Es lo esperado de un tramo flexible más corto: los pilares toman algo más del momento de las vigas y la estructura es más rígida frente a lo horizontal. Para la comprobación, el momento de la base de un tramo intermedio es ahora el de la cara del forjado, no el del eje: menor, y el que se comprueba.

**Pendiente para la integración:** los módulos de Concreta tienen que saber que los esfuerzos de los dos extremos de un tramo de pilar van en las caras (`s[1]` y `s[2]` del mapeo). **Visto de paso, sin tocar:** la cabeza de un tramo bajo una viga con `insercion: "superior"` lleva `f · canto` cuando el pilar ocupa el canto entero por debajo del nudo, así que se queda corta a la mitad; es de C1 y va con todas las vigas `"superior"`.

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

**Siguiente paso:** la fase LV2 (hecha el 2026-10-19) y, después, el `my` de la cubierta y P5 (§2.1: diagnosticado el 2026-10-19; lo que queda es de CYPE y lo tiene que mirar el usuario en su modelo). LV-d, decidida y hecha el 2026-10-20 (§2.2).

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

El diagnóstico de §2.1 (las variantes se escriben en `.datos/d-*`):

```
.venv/Scripts/python.exe validacion/sombra/vivienda/variantes.py            (todas, o las que se nombren)
bun validacion/sombra/vivienda/muestrear.ts validacion/sombra/vivienda/.datos/d-zcubs-025
.venv/Scripts/python.exe validacion/sombra/vivienda/comparar.py validacion/sombra/vivienda/.datos/d-zcubs-025
.venv/Scripts/python.exe validacion/sombra/vivienda/zonas.py validacion/sombra/vivienda/.datos/d-zcubs-025 my Cubierta [negativos]
bun validacion/sombra/vivienda/viga.ts validacion/sombra/vivienda/.datos/d-zcubs-025 [Z-CUB-S-5]
bun validacion/sombra/vivienda/tramos.ts validacion/sombra/vivienda/.datos/d-stub060
```

LV-d (§2.2):

```
bun validacion/lvd/medir.ts > validacion/lvd/out_medir.txt
.venv/Scripts/python.exe validacion/sombra/vivienda/replica.py '{}' validacion/sombra/vivienda/.datos/lvd
.venv/Scripts/python.exe validacion/sombra/vivienda/replica.py '{"zonaRigidaBase": false}' validacion/sombra/vivienda/.datos/lvd-sin
bun validacion/sombra/vivienda/muestrear.ts validacion/sombra/vivienda/.datos/lvd   (y lvd-sin, que reproduce hr)
.venv/Scripts/python.exe validacion/sombra/vivienda/comparar.py validacion/sombra/vivienda/.datos/lvd > validacion/sombra/vivienda/.datos/out_lvd.txt
bun validacion/sombra/vivienda/tramos.ts validacion/sombra/vivienda/.datos/lvd "Peso propio"
```
