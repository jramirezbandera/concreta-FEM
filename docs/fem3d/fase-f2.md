# Fase F2 — refinamiento de la malla junto a los pilares con cara: resultado

> **Fecha:** 2026-10-13. **Plan:** `refinamiento.md` (lo que se fijó al empezar, con los criterios que propuso el usuario).
>
> **Veredicto: pasan los criterios 1, 2, 3, 4, 6, 7 y 8. El 5 pasa en el metro del pilar y queda a medias en el resto de la recta de la cara.**
> - **Con el h por defecto (0,75 m), el metro centrado en un pilar queda a ~1 % de la malla fina.** En la losa de 3 × 3 vanos (44 caras), la media es 0,86 % y el máximo 1,35 % (antes, 5,4 y 10,8 %). En H25, 0,89 / 1,25 % en la losa plana y 0,78 % en el reticular (antes, ~11 %).
> - **El edificio objetivo de 7 plantas con losa plana se queda en 167 118 ecuaciones,** por debajo de las 183 876 de F. Lo paga R0: las caras ya no dejan los pilares de borde en la triangulación.
> - **La costura no se toca.** El refinamiento va dentro del bloque de la plantilla de cada pilar, y el borde del bloque es el de siempre. Fuera, la malla es la misma nudo a nudo.
> - **Ningún aviso de malla** en las 44 geometrías de G ni en los modelos de validación. El respaldo existe y está probado, por pilar y por planta.
> - **Dos hallazgos graves, previos a F2 y para el usuario** (§4):
>   - **F2-8:** en una alineación con pilares de dos tamaños, la cara común (C5-g) es la del menor, y la estación del mayor cae dentro de su huella. Subestima el momento de su cara en torno a un 45 %, del lado inseguro, y no converge con la malla.
>   - **F2-9:** los nudos a menos de ε_snap de una huella se hacen rígidos. Junto al hueco del edificio, el metro de la cara sale hasta un −44 %.
>
> **Cómo leerlo:** la tabla resume los criterios del plan, y cada sección da el detalle. Lo que decide el usuario está en §4.

## Criterios

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Convergencia: con h = 0,75, el metro centrado en el pilar a ≤ 2 % de la malla fina en cada cara con demanda, y la media ≈ 1 %, en la 3 × 3 y en H25 | **Pasa.** Frente a h = 0,125 (que difiere de 0,1 un 0,31 % de media):<br>• 3 × 3: 0,86 % de media y 1,35 % de máximo;<br>• H25 plana: 0,89 / 1,25 %;<br>• H25 reticular: 0,78 %.<br>Sin refinar: 5,36 / 10,82 %, 11,8 / 11,9 % y 11,2 %. Con h = 0,5 sin refinar: 1,16 / 3,79 % y 2,09 / 2,82 % | `validacion/f2/out_convergencia.txt` |
| 2 | Edificio objetivo de 7 plantas con losa plana, ≤ 200 000 ecuaciones | **Pasa:** 61 323 nudos y 167 118 ecuaciones, con 308 plantillas refinadas. F1.1 tenía 70 647 y 183 876. Con vigas y el reticular, sin cambios (sus pilares no tienen caras, F-3) | `validacion/f2/out_banco.txt` |
| 3 | Ningún aviso de malla en las 5 familias no ortogonales, las 24 retículas al azar y los modelos de validación | **Pasa.** Los 44 modelos de G, sin avisos, con 98 plantillas refinadas; jacobiano mínimo 0,214 (F1.1: 0,228). En el edificio objetivo, ninguno | `geometrias.test.ts`; `refino.test.ts` |
| 4 | Determinismo: la misma malla al trasladar, girar 90° y 37°, reordenar y con ruido, y en V8 y JavaScriptCore; las referencias de C2–C5 no cambian | **Pasa.** Las metamórficas de C2–C5 y las de `refino.test.ts`. La huella de C5 en Bun y en Node con la losa de pilares mezclados, que se refina. Las referencias congeladas de C2–C5 (`franjas: false`), idénticas | toda la batería |
| 5 | H25 frente a OpenSeesPy ASDShellQ4 en las caras, ≤ 2 % con h = 0,75 | **A medias.**<br>• En el metro centrado en el pilar (las 8 estaciones con ventana): 0,35 % (sin refinar, 1,60 %).<br>• En las demás franjas que cruzan la recta de la cara, lejos del pilar y con la malla gruesa: 2,88 / 7,00 % sobre su máximo, como sin refinar (3,33 / 6,68 %).<br>• Todas juntas, como en F: 1,25 / 3,47 % (antes, 1,83 / 3,77 %) | `validacion/f2/out_opensees.txt` |
| 6 | Respaldo: con un fallo forzado, el modelo compila, avisa y da la malla sin refinar | **Pasa,** por pilar (umbral de calidad forzado) y por planta (validador o excepción) | `refino.test.ts` |
| 7 | Compilar y calcular el edificio objetivo, ≤ +25 % frente a F1.1 | **Pasa.**<br>• Losa plana: 2,8 + 3,5 s, frente a 3,1 + 4,2 s (más rápido: la malla es menor).<br>• Con vigas y reticular: lo mismo, dentro del ruido de la máquina (0,87–1,04 s al compilar, en los dos árboles) | `out_banco.txt` |
| 8 | Referencia congelada: la de F, regenerada a sabiendas, y un caso nuevo | **Pasa.** La de F regenerada, más la 3 × 3 refinada y H25 con `refinoCaras: false` | `congelado-f.test.ts` |

Pasan las baterías completas: 1 693 tests en la raíz y 34 en la app.

## 1. Qué hay

| Fichero | Qué hace |
|---|---|
| `src/compilador/franjas.ts` | **R0.** Junto a un pilar ajeno con los lados según los ejes, la cara común:<br>• que va por un lado de su huella, sigue por él;<br>• que pasa por dentro, se corta en la huella.<br>Antes se cortaba siempre a h de él |
| `src/compilador/rejilla.ts` | **La plantilla refinada:**<br>• tercios del primer tramo junto a cada cara, en la cruz y, si cabe, en la esquina;<br>• las transiciones de esquina (5 cuadriláteros) y de 3 a 1 (4);<br>• nudos nuevos por interpolación bilineal en su cuadrilátero de la red;<br>• tramos de línea subdivididos (`subdivididas`).<br>**La guarda de calidad:** convexidad estricta y jacobiano ≥ 0,2. Una plantilla refinada que no la pasa se queda sin refinar (`sinRefinar`); una sin refinar que no la pasa no se usa, y su pilar va por la triangulación. **Todos los umbrales, con holgura** |
| `src/compilador/mallado.ts` | Entrada `refino` (las caras de cada pilar), cadenas de los lados por las aristas subdivididas, respaldo por planta (`conRespaldoRefino`) y aviso `malla/cara-sin-refinar`. **El validador** exige además que cada cuadrilátero sea estrictamente convexo, como el motor (F2-5) |
| `src/compilador/losas.ts`, `fisico.ts`, `validar.ts`, `compilar.ts` | Opción `refinoCaras` (por defecto, sí), estadística `plantillasRefinadas` y versión del compilador F2 |
| `src/compilador/poligonos.ts` | `jacobianoEscalado`, movido desde `mallado.ts` (lo usan los dos) |
| `src/compilador/refino.test.ts` | R0, estructura de la plantilla refinada (la malla sin refinar está entera dentro, conforme, convexa), h pequeño, respaldo, metamórficas y el criterio 1 en P6-5 |
| `validacion/f2/` | `convergencia.ts` (criterio 1), `banco.ts` (2 y 7), `opensees-modelos.ts` (5, con `validacion/f/oraculo_franjas.py validacion/f2`) |

## 2. Cómo es la malla

En un pilar con caras en u y en v y una celda entera a cada lado:
- **la cruz:** a lo largo de la huella, el primer tramo de la red junto a cada cara se parte en tercios. Con h = 0,75 y celdas de 1,425 m, quedan tramos de 0,24 m junto a la cara;
- **las cuatro esquinas:** el cuadrilátero que toca la cruz por sus dos lados va también en tercios (3 × 3);
- **la transición:** de 3 a 1, en el cuadrilátero siguiente hacia fuera;
- **el borde del bloque:** el de siempre.

Cuando no cabe, la transición va en el propio cuadrilátero de esquina: con la plantilla de esquina (dos lados finos) o con la de 3 a 1 (uno). Pasa cuando la cara cae dentro de una celda o el tramo lateral es una sola arista. Si fuera del bloque sólo hay celdas fuera de las losas (un vuelo corto), la esquina va fina hasta el borde, sin transición.

Coste: unos 37 nudos por pilar interior con las cuatro caras.

## 3. Hallazgos

| ID | Hallazgo | Consecuencia |
|---|---|---|
| F2-1 | **El ×2,04 de F era de la triangulación, no de las caras.** En el edificio objetivo, el 43 % de las láminas de cada planta salían de la CDT: 333 celdas irregulares, 9–12 por pilar de borde. La cara común se cortaba a h del pilar de borde aunque fuera por su lado, y su extremo suelto dejaba la plantilla en la triangulación | **R0** (§1): 10 161 → 7 037 nudos por planta, 28 plantillas recuperadas, jacobiano mínimo 0,302 → 0,310. Es lo que paga el refinamiento |
| F2-2 | **Lo que manda es el ancho de la fila de elementos a través de la cara.** Refinar a lo largo de la cara no ayuda. Con elementos de ~0,3 m el error oscila ±3 %, según dónde caigan los nudos respecto a los bordes de la ventana; con 0,18 m, ±0,4 % (emulado con líneas de lado a lado) | Tercios del primer tramo, graduados hacia la cara. El reparto de F-6 no es la causa: una recuperación consistente M·m = g y otra lineal por lámina oscilan igual o más |
| F2-3 | **Con h pequeño, el primer tercio quedaba a menos de ε_snap de la huella** y la compilación lo hacía rígido (C2-d). Con h = 0,125, el metro de la cara salía un −30 %, sin aviso | Un lado sólo se refina si el primer tercio mide ≥ 2·ε_snap (0,1 m); por debajo, el tramo ya mide < 0,3 m. Así la referencia (h = 0,125) no se refina |
| F2-4 | **La transición en la esquina ensanchaba la columna pegada a la cara** justo donde cae el borde de la ventana del otro sentido: mx −2,9 % en P6-5, frente al −1,5 % emulado | La esquina va fina y la transición, en el cuadrilátero siguiente: −1,32 / −1,12 %. Por el lado de un vuelo corto, la esquina llega fina hasta el borde de la losa: los pilares de borde de la 3 × 3 pasan de −3,8 a −1 % |
| F2-5 | **Con la cara dentro de una celda, el cuadrilátero no es un rectángulo:** su nudo del borde del bloque es el punto medio de la arista de la rejilla. Los nudos puestos como en un rectángulo dieron 4 láminas no convexas en el edificio. Las rechazó el motor; el validador del mallador las dejó pasar, porque el jacobiano en los puntos de Gauss era positivo | Interpolación bilineal en el cuadrilátero, y convexidad estricta en la guarda y en el validador (un error ahí activa el respaldo) |
| F2-6 | **Un lado de cara que nace en la esquina de una huella** (un punto del arreglo, no un nudo de la rejilla) se perdía en la red refinada (`malla/lado-perdido`). El respaldo por planta lo cubrió: 48 avisos, ningún fallo | Los tramos subdivididos se anclan también en puntos del arreglo |
| F2-7 | **Umbral sin holgura** (el tramo mínimo para refinar): en la losa de pilares mezclados, trasladar la planta cambiaba 22 nudos | Holgura de 1e-4, como R-7 |
| F2-8 | **Grave, de F (C5-g).** En una alineación con pilares de dos tamaños, la cara común es la del menor. La estación del mayor cae 5 cm dentro de su huella, donde sólo cuentan las láminas de los lados (ancho en losa 0,6 en vez de 1):<br>• en el edificio objetivo, P42-15 (40 × 40 en una alineación de 30) da −21,9 kN·m/m con F2 (−17,4 sin refinar), y su cara propia, −40,5. Es un 45 % menos, del lado inseguro;<br>• además no converge: −26,4 con h = 0,15;<br>• las 88 caras así del edificio están a 10,1 / 17,3 % de su referencia con F2 (27,7 / 42,7 % sin refinar) | **Para el usuario** (§4). La plantilla de F2 ya tiene la cara propia en la malla, a lo ancho de la ventana. Probado con un atajo: medir ahí cambia el valor, pero con h ≤ 0,5 la cara propia ya no siempre va por la malla, así que hay que decidir cómo se valida |
| F2-9 | **De C2-d.** Un nudo a ≤ ε_snap del borde de una huella se hace rígido, aunque sea de la siembra:<br>• el corte de la cara excluye esas láminas;<br>• junto al hueco del edificio, P30-15 y P24-20 tienen 42 y 81 nudos rígidos fuera de su huella, y el metro sale hasta un −44 %;<br>• con `franjas: false` hay 99 en el edificio: las franjas de 5 cm entre caras de pilares distintos;<br>• con h ≤ 0,125 y tamaños mezclados, también en la 3 × 3 (−45 % en una cara de P6-5, sin aviso; con h ≥ 0,15 no pasa).<br>Probado con un atajo, esclavizar sólo lo que está sobre la huella baja la media de esas caras de 17,9 a 8,8 %, con un máximo del 48,7 % | **Para el usuario** (§4): cambiarlo mueve las referencias de C2–C5 |
| F2-10 | **El umbral de 0,3 del plan para la plantilla refinada dejaba 3 pilares sin refinar** en las retículas al azar (0,214–0,281): caras dentro de celdas junto a un vuelo | Se exige lo mismo que al resto de la malla: no bajar de 0,2 (el aviso de calidad). Las retículas al azar ya tenían cuadriláteros de 0,228 |

## 4. Para el usuario

- **F2-8, la cara común dentro del pilar mayor.** Es lo más importante: es del lado inseguro y no avisa. Propuesta: en la cara de un pilar cuya cara propia no es la común, la franja que lo toca mide la ventana en su cara propia (`porNodales` en esa recta, sólo a lo ancho de la ventana); sólo donde no se pueda, la común, con un aviso. Hace falta:
  - validarlo con una referencia que siembre las caras propias (la triangulación sola admite trazos parciales);
  - que la cara propia esté en la malla también con h ≤ 0,5 (hoy, sólo en la plantilla con el h por defecto).

  Sería la fase siguiente. **Hecho en F3** (`fase-f3.md`, 2026-10-14): el metro se mide en la cara propia por un contorno en escalón, sin sembrar nada en la malla.
- **F2-9, los nudos rígidos a ε_snap de la huella.** **Aparcada por el usuario el 2026-10-14**, tras F3-d (sólo queda la rigidez, F3-8, del lado seguro): se retoma cuando se vuelva a tocar el mallador, preferiblemente por la segunda salida. Hay dos salidas:
  - esclavizar sólo los nudos sobre la huella (cambia C2–C5, y por sí solo no basta junto al hueco);
  - o que el mallador no ponga nudos a menos de ε_snap de una huella.

  Hasta decidirlo: las referencias de validación con tamaños mezclados, con h ≥ 0,15.

  **La parte de la estación, hecha en F3-d** (`fase-f3.md` §7, 2026-10-14): el metro cuenta lo que pasa por esos nudos. Junto al hueco, con h = 0,75, las caras pasan de −25…−43 % a −6,3…+3,5 %. Queda la rigidez: donde hay nudos rígidos delante, la cara sale un 6–8,5 % alta (F3-8).
- **Los pilares junto al hueco van por la triangulación** (§2.3 del plan). F2 no los refina: 8,8–17,9 % de media según F2-9. Lo que domina ahí es F2-9, no el tamaño de la triangulación.
- **El criterio 5 en las demás franjas de la recta de la cara.** Lejos del pilar, la malla sigue gruesa, y F2 no las mejora (7 % de su máximo). Es lo que se pidió: refinar sólo junto a los pilares.
- **La puerta de uso:** armar una losa propia con el h por defecto y comparar el metro en la cara con el de antes (`refinoCaras: false`).

## 5. Decisiones por defecto, con sus medidas

| # | Decisión | Por defecto | Medida |
|---|---|---|---|
| F2-a | Partición junto a la cara | Tercios del primer tramo de la red. Con la celda partida, w/6, w/6, w/6, w/2 | Emulada igual que la del plan (w/6, w/6, w/3, w/3): −1,50 / −1,33 % frente a −1,45 / −1,24 %. Real, en la 3 × 3: 0,86 / 1,35 % |
| F2-b | R0 | Sin corte por el lado de un pilar ajeno; corte en la huella si pasa por dentro | −31 % de nudos en el edificio |
| F2-c | Qué pilares | Los que tienen cara de franja y van en una plantilla | 308 de los 336 interiores del edificio; los 28 restantes, junto al hueco (en la CDT) |
| F2-d | Calidad mínima de la plantilla refinada | Convexa y jacobiano ≥ 0,2 (el aviso de calidad) | F2-10 |
| F2-e | Distancia mínima del primer nudo nuevo a la cara | 2·ε_snap (0,1 m) | F2-3 |

## 6. Pendiente

- Lo de §4.
- **En el compilador:** caras para los pilares circulares, girados y de borde (F-4), y los pilares con cara en la triangulación.
- **Las salidas de F** (`validacion/f/out_*.txt`) son de su fecha, sin regenerar con F2. Las de F2 están en `validacion/f2/`.

## Cómo reproducir

```sh
bunx vitest run src/compilador/refino.test.ts                     # F2: R0, plantilla, respaldo, metamórficas, criterio 1 en P6-5
bun validacion/f2/convergencia.ts                                # criterio 1 (y el edificio por grupos) → out_convergencia.txt (~8 min)
node validacion/f2/banco.ts                                      # criterios 2 y 7 → out_banco.txt
bun validacion/f2/opensees-modelos.ts && .venv312/Scripts/python.exe validacion/f/oraculo_franjas.py validacion/f2   # criterio 5
bun validacion/f/congelar.ts                                     # SÓLO a sabiendas: la referencia congelada de F
```
