# Rejilla alineada de H52 (decisión C2-a): resultado

> **Fecha:** 2026-10-05. **Plan:** la decisión C2-a del usuario (`compilador.md`, «Decisiones del usuario»): h = 0,75 con la rejilla alineada de H52 en las zonas regulares, «que es lo que baja los nudos sin perder precisión». H52 recomendaba «mallar en rejilla alineada las zonas regulares y con CDT sólo donde haga falta, para no pagar el ×1,6 en todo el edificio».
>
> **Veredicto: el criterio 8 de C2 pasa.**
> - **Edificio objetivo con losas** (7 plantas): 34 737 nudos y 90 657 ecuaciones, frente a 79 649 y 199 983 con la triangulación sola. Cabe en D9 (~50 000 nudos y 300 000 GDL).
>   - Compila en 0,85 s (antes, 2,7 s).
>   - Se calcula en 3,8 s (antes, 8,2 s).
> - **Edificio con núcleo y muro de sótano (C3):** 48 451 nudos y 151 905 ecuaciones, frente a 88 683 y 249 417. Vuelve a caber en el perfil móvil (200 000 ecuaciones).
> - **Sin perder precisión.** En el edificio objetivo de 3 plantas, frente a la triangulación fina (h = 0,3, 124 000 nudos):
>   - My y Vz de la banda en la cara del pilar: +1,2 % y +3,3 % con la rejilla, frente a +2,6 % y +6,4 % de la triangulación con el mismo h;
>   - la flecha del recuadro y la máxima, a ≤ 0,11 %;
>   - la deriva, −0,75 % (la triangulación daba −0,09 %).
> - **La malla es mejor:** jacobiano mínimo 0,302 frente a 0,252, y ningún aviso de calidad.
> - **Donde la rejilla no ahorra** (plantas pequeñas y llenas de rasgos), la planta se queda con la triangulación: nunca hay más nudos que sin ella.
>
> **Hallazgos principales:**
> - **R-1:** la rejilla sola apenas ahorraba un 5 %. Los parches de triangulación alrededor de cada pilar eran 2 × 2 celdas de abanicos densos, y se llevaban todo el ahorro. Lo resuelve una **plantilla de pilar**: el bloque de celdas de la huella se malla con una red estructurada que pasa por sus caras.
> - **R-2:** un pilar de fachada enrasado con el borde, y una viga de fachada a b/2 de él, dejaban sin rejilla toda la franja de la fachada. Lo resuelven la plantilla general (caras sobre una línea del borde, varias líneas dentro) y las «líneas largas».
> - **R-4:** las metamórficas encontraron triángulos de fuera de la losa que entraban en una celda regular por un borde de losa sin restringir. Está corregido.
>
> **Cómo leerlo:** la tabla resume los criterios de C2 que la rejilla tiene que seguir cumpliendo, más el suyo («sin perder precisión»). Cada sección da el detalle y la evidencia. Lo que queda para el usuario está en «Decisiones» y en «Pendiente».

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Oráculo analítico (Navier) | **Pasa.** La triangulación sola sigue validada como en C2 (`rejilla: false`). Con la rejilla, la placa de Navier es exactamente la malla de E3: mismos nudos y errores a ≤ 1e-6. Allí C2-1 deja de aplicar: el valor del centroide converge con orden 1,94–1,96 (con la triangulación, 0,73–0,86) | `oraculos-c2.test.ts`; `validacion/c2/out_navier.txt` |
| 2 | Oráculo de E5 (losa plana de H25) | **Pasa.** Rejilla con h = 0,15: a ≤ 0,33 % de la rejilla de E5 con el mismo h; con h = 0,1, los seis valores a ≤ 0,33 % de E5 con h = 0,075. La triangulación, como en C2 | `oraculos-c2.test.ts`; `out_losa_plana.txt`; `out_rejilla.txt` §3 |
| 3 | Validador de malla y conformidad | **Pasa.** El validador de C2 (área a 1e-9, lados y puntos en la malla, jacobiano) añade la conformidad: la rejilla y la triangulación parten igual cada arista de la interfaz. Las pruebas comprueban además que cada arista interior la comparten dos cuadriláteros, con h de 0,3 a 0,75 | `mallado.test.ts` |
| 4 | Metamórficas | **Pasa.** Las de C2 y C3 sobre modelos al azar: reordenar (bit a bit), trasladar, girar 90° y 37° con el eje 1, y ruido de 1e-8 m dan la misma malla. Y en una retícula con fachada enrasada (toda en rejilla y plantillas), traslación y giros de 90° y 37° | `metamorficas-c2.test.ts`, `metamorficas-c3.test.ts`, `mallado.test.ts` |
| 5 | Sin pérdidas y equilibrio | **Pasa.** Edificio objetivo: 4,8e-14; con muros, 2,4e-14; equilibrio del motor ≤ 5,1e-12 | `out_banco.txt` de C2 y C3 |
| 6 | Entradas no válidas | **Pasa.** Los catálogos de C2 y C3 dan su error con el id físico, como antes, y una opción `rejilla` que no es un booleano da `opciones/no-validas` | `invalidos-c2.test.ts`, `invalidos-c3.test.ts` |
| 7 | Determinismo y huella | **Pasa.** Topología idéntica y coordenadas a ≤ 1e-12 en V8 y JavaScriptCore, con la rejilla por defecto y con la retícula enrasada (toda en rejilla y plantillas) añadida al juego de modelos. La huella cambia sin la rejilla y lleva la versión del compilador (C3.1) | `huella-c2.test.ts`, `huella-c3.test.ts`; `validacion/c2/huellas.ts` |
| 8 | Rendimiento frente a D9 | **Pasa** (estaba a medias). Losas: 34 737 nudos y 90 657 ecuaciones; compila en 0,85 s, el 22 % del cálculo. Con muros: 48 451 nudos y 151 905 ecuaciones | `validacion/c2/out_banco.txt`, `validacion/c3/out_banco.txt` |
| 9 | Referencia congelada | **Pasa.** Las referencias de C2 y C3 quedan con `rejilla: false` y salen idénticas: la triangulación no ha cambiado ni un bit. Se añaden, con la rejilla, la losa plana, el modelo aleatorio 8, la retícula enrasada y la retícula con núcleo de muros | `congelado-c2.test.ts`, `congelado-c3.test.ts` |
| C2-a | Sin perder precisión frente a la triangulación con el mismo h | **Pasa.** Edificio objetivo, frente a h = 0,3: cara mejor (+1,2 / +3,3 % frente a +2,6 / +6,4 %), flechas iguales (≤ 0,11 %), deriva −0,75 % (frente a −0,09 %). Retícula enrasada (todas las huellas en plantilla), frente a h = 0,2: reacciones de los pilares a ≤ 0,54 % (triangulación, 0,30 %), flecha máxima −1,24 % (−0,73 %) y deriva −0,56 % (−0,15 %) | `oraculos-c2.test.ts` (criterio 3); `validacion/c2/out_rejilla.txt` |

---

## 1. Qué hay nuevo

| Fichero | Qué hace |
|---|---|
| `src/compilador/rejilla.ts` | La rejilla de una planta: ejes, líneas, nudos, rasgos ajenos, plantillas de pilar, estado de cada celda, interfaz y división |
| `src/compilador/mallado.ts` | La malla mixta: cadenas de los lados por los nudos de la rejilla, la interfaz como aristas obligatorias de la CDT, centros de las celdas irregulares, cuadriláteros de las celdas y de las plantillas, registro de aristas (conformidad) y comparación con la triangulación sola. Las piezas (triángulos o celdas) sustituyen a los triángulos para las cargas de superficie |
| `src/compilador/fisico.ts`, `validar.ts` | Opción `rejilla` (por defecto, sí) |
| `src/compilador/losas.ts`, `compilar.ts` | Estadísticas (`malla.laminasRejilla` y `malla.plantillas`), la hipótesis de la malla de las losas y la versión C3.1 |
| `validacion/c2/rejilla.ts` | Tamaño y precisión frente a la triangulación: edificio objetivo, retícula enrasada, losa plana y modelos al azar |
| `validacion/c2/modelos.ts`, `validacion/c3/modelos.ts` | `reticulaEnrasada` (losa enrasada con los pilares de fachada y vigas de fachada excéntricas) y `reticulaConNucleo` |

**Uso:** el de C2. La opción `rejilla: false` da la triangulación sola, la de C2, bit a bit.

## 2. Cómo malla

1. **Ejes.** Los ejes 1-2 de la primera losa de la planta, con origen en su vértice canónico, así que la rejilla se traslada y gira con la planta. Si el eje 1 no sigue la geometría, no hay rejilla (ver «Pendiente»).
2. **Líneas.** Cada lado del arreglo que toca una losa y va paralelo a un eje (a ≤ 10·ε_geom) propone su línea, con su longitud como prioridad. El eje de cada huella rectangular alineada propone la suya con el doble de su lado, para ganar a sus caras.
   - Dos líneas a menos de d_min = 0,4·h no caben: se queda la más larga y, a igual longitud, la de menor coordenada. Así un rasgo pequeño junto a uno largo no llena la planta de franjas finas.
   - Una línea que recorre al menos media planta (la de una viga de fachada) sólo cede ante otra a menos de d_min/4.
   - Entre líneas, el hueco se reparte en partes iguales de ≤ 2h, y se añade un anillo de celdas alrededor.
3. **Rasgos ajenos.** Son los puntos del arreglo que no son nudos de la rejilla y los lados que no van por una línea, también los de los ejes de los muros, que ya vienen sembrados. Una celda es **regular** si:
   - su centro cae en una losa;
   - no es del anillo;
   - no tiene ningún rasgo ajeno a menos de δ = 0,45·2h, salvo los de una huella con plantilla.

   Si no, es **irregular** (o está fuera de la losa). Los grupos de menos de 9 celdas regulares seguidas vuelven a la triangulación: ahorran poco y obligan a coserse a sus aristas.
4. **Plantillas de pilar.** Una huella rectangular alineada, sin más rasgos cerca que los suyos, se malla con una red de cuadriláteros.
   - **Red:** en cada dirección, las líneas de la rejilla del bloque que ocupa y, en cada celda, la cara que cae dentro (a no más del 70 % de la celda desde la línea interior) o su punto medio.
   - **Cara sobre una línea del borde del bloque:** necesita fuera de la losa al otro lado (el pilar de fachada enrasado).
   - **En el borde del bloque,** los nudos son los de la rejilla partida.
   - **Dentro:** las esquinas de la huella, los puntos de sus caras sobre las líneas que la cruzan (por donde llegan las vigas) y, en el interior rígido, lo que haga falta.
   - Cubre los pilares interiores, de fachada (a ejes o enrasados) y de esquina, también con la viga de fachada pegada a la cara.
5. **Interfaz y conformidad.** Las aristas entre una celda cubierta y una irregular, y los bordes de losa junto a una celda cubierta, son aristas obligatorias de la CDT. La CDT parte cada arista de un triángulo por su punto medio, y la rejilla parte sus celdas por los puntos medios de sus lados: el punto medio de una arista de la interfaz es el mismo nudo a los dos lados.
   - Una celda regular se parte en 4, 2 o 1 cuadriláteros. Un hueco de más de h se parte siempre.
   - Uno de ≤ h (una franja estrecha) sólo se parte en los tramos de celdas cubiertas seguidas que tocan la interfaz o tienen una plantilla con una cara dentro. Un cuadrilátero con un nudo de más en un lado no existe (paridad), así que la decisión es por tramo entero.
6. **CDT del resto,** la de C2 con la siembra graduada. Las cadenas de los lados pasan por los nudos de la rejilla que son esquina de una celda cubierta. En cada celda irregular se añade su centro si queda a ≥ 0,3·2h de todo segmento y de la retícula (R-6).
7. **Comparación.** Si las celdas cubiertas no llegan al 75 % del área de las losas de la planta, se malla también sin rejilla y se queda la malla con menos nudos (a igualdad, la de la rejilla).
8. **Validador:** el de C2 más la conformidad de la interfaz.

## 3. Hallazgos

| ID | Hallazgo | Consecuencia |
|---|---|---|
| R-1 | **La rejilla sola apenas ahorraba:** en el edificio objetivo de 3 plantas, 32 559 nudos frente a 34 231 (−5 %), con sólo el 13 % de las láminas en la rejilla. Con vigas por los ejes y pilares de tres tamaños, las caras no caben como líneas (están a 0,15–0,25 m del eje), así que cada pilar dejaba un parche de triangulación de 2 × 2 celdas (7,5 m², un tercio de la planta) lleno de abanicos de triángulos largos | Plantillas de pilar: el bloque se malla con una red estructurada que pasa por las caras. Con ellas, 15 385 nudos (−55 %) y el 94 % de las láminas en la rejilla |
| R-2 | **El pilar de fachada enrasado y la viga de fachada excéntrica** (eje a b/2 del borde) dejaban sin rejilla toda la franja de la fachada: la línea de la viga, a menos de d_min del borde, no cabía, y la plantilla de 3 casos (abrazar una línea o apoyarse en ella) no cubría una cara sobre el borde con una línea por dentro | La plantilla general (cualquier combinación de caras sobre líneas, dentro de celdas y líneas interiores) y las líneas largas (pueden ir a d_min/4). La retícula enrasada queda toda en rejilla: 538 nudos frente a 1 352 |
| R-3 | **La paridad manda en la conformidad.** Un cuadrilátero con un nudo de más en un lado no existe, así que una franja estrecha sin partir no puede tocar la triangulación (que parte todas sus aristas), ni la cara de una plantilla | La división se decide por tramos de celdas cubiertas seguidas. El registro de aristas comprueba en cada compilación que la rejilla y la CDT parten igual cada arista; si no, `malla/conformidad` (un error del compilador) |
| R-4 | **Las metamórficas encontraron un solape** (+0,3 % y +0,7 % de área) al girar 37° o con ruido. Un triángulo de fuera de la losa entraba en una celda regular por un borde de losa que no era arista obligatoria, y su centroide caía justo en el borde | Los bordes de la rejilla (celda cubierta junto a una que no lo es) son siempre aristas obligatorias |
| R-5 | **En una planta pequeña y llena de rasgos la rejilla no compensa:** en los modelos al azar cubría del 1 al 29 % y daba hasta un 9 % más de nudos (franjas finas por cada rasgo y una CDT más cosida) | Si cubre menos del 75 % de la planta, se compara con la triangulación sola y se queda la malla con menos nudos. En los 32 modelos al azar, nunca más nudos (`out_rejilla.txt` §4) |
| R-6 | **Un pilar sin plantilla junto a la esquina de un núcleo** dejaba un parche en el que no cabía ningún punto de la retícula de Steiner: la CDT unía la esquina de la interfaz con la siembra del pilar en abanico (jacobiano 0,189, avisos en cada planta) | El centro de cada celda irregular entra como punto de Steiner si queda libre a ≥ 0,3·2h. Jacobiano mínimo: 0,302 en el edificio objetivo y 0,257 con muros, sin avisos. Cuesta un 0,7 % de nudos con losas y un 5 % con el muro de sótano perimetral |
| R-7 | **Umbrales justos en una planta regular:** un centro de celda a exactamente 0,3·2h de un segmento dependía del redondeo de una traslación | Todos los umbrales de la rejilla llevan holgura (1e-4 relativa), como los de C2 |
| R-8 | **`decisiones.ts` medía la «flecha del vano» en el nudo más cercano a (27; 17,5), que cae dentro del hueco de la escalera:** era la flecha de su borde, y en la rejilla ese nudo quedaba a 0,7 m | Se mide en el centro del recuadro (25,5; 12,5), interpolada en su lámina |
| R-9 | **Posible falso positivo de C2-c:** un hueco dibujado a ejes con vigas en sus cuatro lados cruza el ancho de cada viga junto a sus esquinas y suma justo el umbral (2b): «el borde de la losa corre 0,60 m dentro del ancho de la viga» | No es de la rejilla (pasa igual sin ella). Para el usuario: ¿el hueco a ejes entre vigas debe ser válido? (ver «Pendiente») |
| R-10 | **Cortar por «campos» en la cara de un pilar no sirve en ninguna malla:** del −3 al −15 %, también con la rejilla fina, por la cercanía de la huella rígida. Ya lo decía E5: en la cara, por fuerzas nodales, con la línea de la cara en la malla | Una banda que acaba en la cara siembra esa línea y deja al pilar sin plantilla (va en un parche, y la cara se corta exacta). Con las bandas automáticas de C5, las líneas de las caras serán largas y entrarán en la rejilla |

## 4. Decisiones, con sus medidas

Medidas en `validacion/c2/out_rejilla.txt` y `out_decisiones.txt`.

| Decisión | Por defecto | Medida | Para el usuario |
|---|---|---|---|
| C2-a, rejilla y h | Rejilla con h = 0,75 | Edificio objetivo de 3 plantas, frente a la triangulación con h = 0,3: con la rejilla y h = 0,75, 15 385 nudos y cara +1,2 / +3,3 %; con h = 0,5, 41 942 nudos y −0,1 / +2,5 %; con h = 1, 13 727 nudos y −2,5 / −3,1 %. La triangulación con 0,75 daba 34 231 nudos y +2,6 / +6,4 % | Confirmar h = 0,75 con la rejilla |
| Deriva con la rejilla | — | −0,75 % frente a la triangulación fina (la triangulación con 0,75, −0,09 %): las plantillas, más gruesas junto a los pilares, rigidizan algo el pórtico | Aceptar (C1-a la mueve ±20 %) |
| Parámetros de la rejilla | d_min = 0,4·h; líneas largas ≥ 50 % de la planta, a d_min/4; δ = 0,45·2h; caras de la plantilla a ≤ 70 % de su celda; grupos de ≥ 9 celdas; centros a ≥ 0,3·2h; comparación por debajo del 75 % | Fijados midiendo el edificio objetivo, la retícula enrasada y los modelos al azar | Sin cambios (internos) |

## 5. Pendiente

- **Confirmadas por el usuario el 2026-10-08:** h = 0,75 con la rejilla y la deriva (§4). R-9: el hueco a ejes entre vigas es válido, y C2-c mide ahora el avance a lo largo de la viga (`losas.ts`, `dentroDelAncho`).
- **Para más adelante:**
  - estaciones de los muros en las líneas de la rejilla: hoy los ejes de los muros son rasgos ajenos y dejan una franja de triangulación a su lado (el muro de sótano perimetral cuesta un 5 % de nudos);
  - ejes de la rejilla cuando el eje 1 de la primera losa no sigue la geometría (un edificio girado con el eje 1 por defecto se queda sin rejilla), y losas de una misma planta con ejes distintos;
  - plantillas para huellas circulares (octógono) y para pilares girados respecto a la rejilla, que hoy van en un parche de triangulación;
  - las referencias congeladas pesan 3,4 MB (C2) y 3,9 MB (C3).
- **Validación externa:** la comparación «en sombra» con SAP2000 o CYPE de un edificio con la rejilla.

## Cómo reproducir

```sh
bun run test:run                                       # todos los tests
bun validacion/c2/rejilla.ts > validacion/c2/out_rejilla.txt         # tamaño y precisión (C2-a)
bun validacion/c2/navier.ts                            # criterio 1 → out_navier.txt
bun validacion/c2/losaPlana.ts                         # criterio 2 → out_losa_plana.txt
node validacion/c2/banco.ts > validacion/c2/out_banco.txt            # criterio 8 (losas)
node validacion/c3/banco.ts > validacion/c3/out_banco.txt            # criterio 8 (con muros)
node validacion/c2/decisiones.ts > validacion/c2/out_decisiones.txt  # decisiones de C2, ya con la rejilla
bun validacion/c2/congelar.ts && bun validacion/c3/congelar.ts       # SÓLO a sabiendas: regenera las referencias
```
