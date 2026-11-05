# Fase MA — modelado por agentes

> **Fecha:** 2026-10-15. **Origen:** la primera puerta de uso con un proyecto real (la vivienda de Alhaurín el Grande, `ejemplos/vivienda/proyecto.json`). El agente la modeló desde el DXF y las respuestas del usuario, y el usuario preguntó qué mejorar, porque el objetivo es que estos modelos los hagan agentes y ponérselo lo más fácil posible.
>
> **Objetivo:** un agente con sólo la skill, la CLI y el DXF de un proyecto llega al `proyecto.json` en **una** ronda de preguntas y **sin escribir código propio**. Lo que hoy hace a mano (leer el dibujo, ábacos, pesos por zonas, petos, alinear) lo hace una orden o un campo del modelo, validado como el resto.
>
> **Este documento** fija, antes de empezar, lo medido, cómo se hace, qué tiene que pasar y lo que decide el usuario. El resultado irá en `fase-ma.md`.

## 1. Lo medido en la vivienda

Una planta, dos cubiertas reticulares 25+5 a 3,40 y 4,30, 23 pilares y una pérgola. El trabajo del agente, en orden:

| Paso | Cómo lo hizo | Coste |
|---|---|---|
| Leer el dibujo | DWG sin conversor; el PDF vectorial tiene los textos en trazos. Con el DXF, un script propio de `ezdxf` (Python): los pilares como rectángulos de 0,30, los contornos de cubierta como `LINE` sueltas (dobles, por los petos), las cotas para comprobar | ~150 líneas, y una ronda de preguntas que el DXF habría ahorrado |
| Preguntar | Tres rondas: geometría (lo que el DXF ya decía), forjado, y luego el nervio, el casetón, su peso, los ábacos, la pérgola, los petos | Tres idas y vueltas con el usuario |
| Ábacos | 21 rectángulos a mano, y los que se pisaban, unidos (el validador rechaza ábacos solapados) | Código propio |
| Peso del reticular | Con casetón perdido el `pp` se aplica igual en toda la losa, ábacos incluidos: 21 cargas de superficie de +3,0 kN/m² sobre los ábacos recortados a la losa (con un recorte de polígonos propio) | 21 cargas y código propio |
| Petos | Dos polilíneas a mano. La primera, sobre el eje del peto a 7,5 cm del borde, metió en la malla líneas casi paralelas a las caras de los pilares y a los ábacos: `losa/ajuste` de 6 cm y `malla/calidad`, sin decir que la causa era la carga | Un intento fallido y dos avisos difíciles de leer |
| Alinear | El dibujo tiene descuadres de 2 cm (x = 4,26 / 4,28 / 4,2821): `losa/ajuste` y `malla/calidad`. El usuario pidió «ponerlo bien»; el agente agrupó las coordenadas a mano | Código propio |
| Escalón de cubiertas | Una «planta» de 0,90 m entre las dos cubiertas: `sensatez/altura` en cada validación, falso | Un aviso que hay que explicar siempre |

Lo que salió bien y se queda: `validar` → `resumen` → `render` → `calcular` → `revisar` (el resumen de cargas por planta y caso cuadró con la cuenta a mano; los avisos de bajada tributaria señalaron dos pilares que había que entender); la regla de no inventar datos de norma.

## 2. Cómo se hace

Seis piezas, de la más barata a la más cara. Cada una es opcional para el modelo (un proyecto que no la usa sale bit a bit).

### 2.1 MA1 — la lista de datos del encargo (skill)

`SKILL.md` gana una sección «Antes de escribir el fichero»: lo que hay que tener para cada tipo de proyecto, para preguntarlo **todo en una ronda**, con la propuesta por defecto de cada punto que admite una.

- Siempre: plantas y cotas, cota de cimentación y arranque (empotrado), material, secciones de pilares.
- Por forjado:
  - macizo: canto;
  - reticular: canto (casetón + capa), intereje, nervio, casetón (perdido o recuperable) y, si es perdido, su peso de la zona aligerada; ábacos (tamaño);
  - unidireccional: tipo de vigueta, intereje, canto, pp.
- Bordes: **todo borde de forjado lleva zuncho** (viga de atado de 20–40 cm, lo normal 30 con el canto del forjado; corrección del usuario en la vivienda, 2026-10-15: el agente no lo puso porque el plano de arquitectura no lo dibuja); vuelos y petos (en **kN/m**: si dan kN/m², pedir la altura).
- Cargas: permanentes por zona, uso con su categoría (para ψ), nieve (valor), y si se dejan viento y sismo para después.
- Lo dudoso del dibujo (piezas que pueden no ser estructurales): preguntarlo con su lectura propuesta.

Además, en la skill: cómo leer un DXF con `fem importar-dxf` (MA6) y qué hacer con lo que no reconoce.

### 2.2 MA2 — ábacos automáticos y unidos

En `Losa.reticular.abacos`, además de la lista de polígonos, `{ "lado": 2.0 }` (o `{ "lados": [2.0, 1.6] }`): un ábaco rectangular centrado en cada pilar que llega a la losa, con sus lados según los de la losa (`eje1`).

- Los ábacos (dados o automáticos) que se solapan o quedan a menos de una tolerancia (propuesta: h/2) **se unen** en su envolvente rectangular, con el aviso `reticular/abacos-unidos` que dice cuáles. Hoy es un error.
- Lo que cae fuera de la losa no cuenta, como ahora.
- La envolvente de dos ábacos unidos puede cubrir zona que no es de ninguno (en diagonal). Con ábacos alineados (lo normal), no.

### 2.3 MA3 — el peso del reticular por zonas con casetón perdido

**Cambia el significado de `pp`** en una losa reticular con casetón perdido (decisión MA-b): pasa a ser el peso de la zona aligerada (el dato que da el ingeniero o el fabricante), y los ábacos pesan γ·h, como ya hace el casetón recuperable (C4-i). Hasta ahora era el peso medio de toda la losa con los ábacos.

- La sensatez de A3 (peso esperado frente al calculado), el informe, la descripción del campo en el esquema y la skill lo dicen así.
- Rompe los proyectos guardados con reticular de casetón perdido; no hay usuarios, así que sólo se actualizan los ejemplos: el muestrario (L2, `pp` 4,6, que pasa a ser el de su zona aligerada: el usuario confirma el valor) y la vivienda (sin sus 21 cargas de los ábacos). Las referencias congeladas con ese caso se regeneran, con su diferencia medida.

### 2.4 MA4 — la carga de borde de losa

Carga `lineal` con `losa` y `borde` en lugar de `puntos`: a lo largo del contorno de esa losa (y de sus huecos, si se pide), con `excepto` para los tramos que no la llevan (dados como segmentos del contorno o como «junto a la losa X»: el encuentro de dos cubiertas). Va sobre el borde, que ya está en la malla: no siembra nada.

- `resumen` la cuenta por planta, y `render cargas` la dibuja como las demás.
- Y el aviso `losa/ajuste` de una carga dice que una carga lineal cerca de un borde o de una cara de pilar ensucia la malla, y propone `borde`.

### 2.5 MA5 — escalones de cubierta y `fem alinear`

- **Escalón:** `"tipo": "escalon"` en una planta. La sensatez no avisa de su altura (sí de una negativa o nula); en todo lo demás es una planta normal.
- **`fem alinear proyecto.json [--tolerancia 0.03] [--escribir]`:** agrupa las coordenadas de pilares, vigas, losas y cargas que difieren menos de la tolerancia (por ejes propuestos o, si los hay, por los `ejes` del modelo), y da en JSON lo que movería (pieza, de dónde a dónde). Con `--escribir`, reescribe el fichero en el formato canónico. Nunca mueve más que la tolerancia.

### 2.6 MA6 — `fem importar-dxf`

`fem importar-dxf plano.dxf --salida proyecto.json --capa-pilares <capa> [--capa-losas <capa>] [--capa-ejes <capa>] [--planta <id>:<cota>…]`. Escribe un `proyecto.json` **sin cargas ni casos** (eso lo pone el agente con lo que le digan) y un informe en JSON de lo reconocido y lo no reconocido.

- **Lector:** `dxf-parser` (MIT) o uno propio de las entidades que hacen falta (`LINE`, `LWPOLYLINE`, `CIRCLE`, `TEXT`/`MTEXT`, `DIMENSION`, `INSERT` de bloques). Se mide en MA6 cuál; ninguno con licencia fuera de la regla 6. DWG no: el usuario exporta a DXF.
- **Unidades:** `$INSUNITS`, y si no cuadra con la extensión del dibujo (como en la vivienda: dice mm y está en m), se avisa y se pide `--unidades`.
- **Pilares:** rectángulos y círculos cerrados de la capa, con su sección por el tamaño (`P30x30`, `P30x50` con su giro, `C40`); los de bloques, por la caja del bloque.
- **Contornos de losa:** polilíneas cerradas o, si son `LINE` sueltas (como en la vivienda), los ciclos del grafo de segmentos; con líneas dobles (petos, fachadas), el ciclo exterior de cada par. Cada contorno, una losa propuesta que el agente asigna a su planta.
- **Ejes:** las líneas de la capa de ejes, con el texto de su burbuja si lo hay.
- **Cotas (`DIMENSION`):** se comprueban contra las distancias reconocidas y se informa de las que no cuadran (en la vivienda cuadraban a < 1 cm: es la prueba de que la escala y los pilares son los buenos).
- **Lo no reconocido** (rectángulos de otro tamaño en la capa de pilares, contornos abiertos) va al informe, para que el agente lo pregunte.

## 3. Criterios

| # | Criterio |
|---|---|
| 1 | **Puerta de la fase (como A2):** tres subagentes con sólo la skill, la CLI, el DXF de la vivienda y las respuestas del usuario por escrito (las de esta conversación, en un solo texto) llegan a un proyecto equivalente al de `ejemplos/vivienda`: pilares a ≤ 1 cm, las mismas losas y ábacos, y el resumen de cargas por planta y caso a ≤ 0,5 %. **En una ronda de preguntas como mucho y sin escribir código propio** (sólo órdenes `fem`). |
| 2 | MA2: la vivienda con `"abacos": { "lado": 2.0 }` da los mismos ábacos que a mano (los unidos incluidos) y el mismo modelo analítico. Los ábacos solapados de un modelo al azar se unen y el modelo calcula; los proyectos que ya validaban salen bit a bit. |
| 3 | MA3: la vivienda con `pp` 4,5 como peso de la zona aligerada y sin las 21 cargas de los ábacos da las mismas fuerzas nodales de peso propio + carga que hoy (a 1e-9) y la sensatez de peso sin aviso. |
| 4 | MA4: los petos de la vivienda como `borde` dan el mismo vector de cargas que las polilíneas a mano (a 1e-9), y la malla no cambia. |
| 5 | MA5: la vivienda con `escalon` no da `sensatez/altura`; `fem alinear` sobre las coordenadas crudas del DXF da las del ejemplo y no mueve nada más que la tolerancia (test con ruido al azar). |
| 6 | MA6: **ida y vuelta** con los proyectos de ejemplo: exportar sus pilares, losas y ejes a un DXF (un exportador de prueba, sólo para los tests) e importarlo da los mismos pilares, contornos y ejes. Con el DXF real de la vivienda (que no se sube: datos del cliente; el test usa un DXF sintético con sus mismas entidades: líneas dobles, cotas, `$INSUNITS` erróneo), los 23 pilares y los dos contornos. |
| 7 | Sin regresión: las referencias congeladas de C1–C5 y F, idénticas salvo las de reticulares con casetón perdido y `pp` (MA3), regeneradas con su diferencia medida; el esquema de `proyecto.json` sólo gana campos opcionales. |

## 4. Lo que decide el usuario

**Decidido el 2026-10-15:** todo como se proponía, salvo MA-b: se cambia el significado de `pp` (no hay usuarios; se actualizan los ejemplos).

- **MA-a, orden:** MA1 → MA3 → MA2 → MA4 → MA5 → MA6, y la puerta (criterio 1) al final. MA1–MA3 son pequeñas y quitan los errores más fáciles de cometer; MA6 es la que más cambia las cosas y la más larga.
- **MA-b, peso del reticular:** ~~campo nuevo `ppAligerado`~~. **Decidido: con casetón perdido, `pp` es el peso de la zona aligerada.**
- **MA-c, ábacos unidos:** unirlos con aviso (propuesto) o seguir rechazándolos y que lo haga el agente.
- **MA-d, tolerancia de unión de ábacos:** h/2 (propuesta).
- **MA-e, `fem alinear`:** sólo propone por defecto y escribe con `--escribir` (propuesto), con tolerancia de 3 cm por defecto.
- **MA-f, lector de DXF:** dependencia `dxf-parser` (MIT) o lector propio; se decide en MA6 tras medir con el DXF de la vivienda.
- **MA-g, cuándo:** antes o después de la puerta de uso de F y AB, que ya se puede hacer con la vivienda (`?ejemplo=vivienda`). Propuesta: la puerta primero (no necesita nada de esta fase), y MA después, con lo que salga de ella.

## 5. Fuera de esta fase

- DWG directo.
- Dibujar con el ratón en la app (V2c): `importar-dxf` cubre el caso de un plano ya hecho, no el de un modelo desde cero.
- Generar viento y sismo desde la situación (CTE DB-SE-AE y NCSE): necesita las tablas de norma en el programa, con su propia validación.
- Lo que la vivienda enseñó del cálculo, que no es del agente: los pilares de borde del encuentro de dos cubiertas sin cara de franja (`franja/pilar-sin-cara` en P4, P15 y P23) (resuelto en el compilador F3.3, `spr-abacos.md` §14) y la esquina de la sala de instalaciones (P1, casi sin carga). Se miran en la puerta de uso.

## 6. MA1 y MA6, hechas (2026-11-05)

A petición del usuario, MA1 y MA6 van antes que MA2–MA5 (y antes de la puerta de uso de F y AB, que cambia MA-g).

- **MA1** (`.claude/skills/fem/SKILL.md`, «Antes de escribir el fichero»): la lista de datos del encargo de §2.1, para preguntarlo todo en una ronda con la propuesta de cada punto, y cómo usar `fem importar-dxf`.
- **MA6** (`src/agente/importarDxf.ts`, orden `fem importar-dxf`). **MA-f, decidida por V2c4-a:** el lector propio de `src/dxf/`, con la colocación de la plantilla (las mismas unidades propuestas, la traslación si está lejos del origen y todo al mm). Lo que hace, en la cabecera del módulo:
  - **sin `--salida`** sólo dice lo que ve: cada capa con los pilares, contornos y líneas largas que tendría, y las capas que propone (por lo que tienen y por su nombre); con `--salida`, escribe el proyecto (nunca encima de otro) y lo compila;
  - **pilares:** los rectángulos del grafo de segmentos de su capa (cuatro esquinas unidas por cadenas rectas de aristas, de 0,15 m al lado máximo) que no caen dentro de otro, y los círculos sueltos. Así valen el pilar de cuatro `LINE`, el de su cruz y el que cruza un muro de la misma capa. Si alguno tiene un nudo en el centro (cruz o aspa), sólo cuentan los que lo tienen;
  - **losas:** las caras del grafo; las «delgadas» (2·A/P ≤ 0,5 m: el hueco entre las dos líneas de un peto, un pilar en la capa) se unen a la losa vecina con la que comparten más borde, y las gruesas son losa o hueco alternando de fuera adentro;
  - **ejes:** las líneas de ≥ 2 m de su capa, unidas las colineales, con el texto corto más cercano a un extremo;
  - **cotas:** las `DIMENSION` lineales cuyos dos puntos no caen en algo reconocido se listan;
  - `supuestos` dice lo que se puso sin dato (capas, plantas, material, espesor, unidades), para preguntarlo.
- **Criterio 6:** `src/agente/importarDxf.test.ts`. Ida y vuelta con el muestrario (las dos plantas, en LWPOLYLINE, con sus huecos y sus ejes con burbuja) y la vivienda (en `LINE` sueltas, con las dos cubiertas que se tocan y los pilares con su cruz), y un DXF sintético como el de la vivienda (`$INSUNITS` en mm con el dibujo en m, contorno doble por el peto, aspas, un pilar circular y otro girado, un trozo de muro sin cruz, un triángulo y tres cotas). En mm da lo mismo que en m.
- **Con el DXF real de la vivienda** (fuera del repo): los 23 pilares de 30 × 30 (a ≤ 2,4 cm de los del ejemplo, que el agente alineó a 2 cm), los dos contornos de cubierta (hasta su borde real, con los vuelos) y 16 de las 18 cotas cuadran, en 1,3 s. Las capas las propone solas («00 0 PLANTA BAJA» para los pilares, por sus cruces, y «00 1 PLANTA CUBIERTA» para las losas).
- **Falta:** la puerta de la fase (criterio 1) y MA2–MA5 (la parte de alinear de MA5, hecha: §7).

## 7. MA5, la parte de alinear: el aviso de casi alineados y «Alinear», hechos (2026-11-05)

**Origen:** el proyecto «51» del usuario (un reticular calcado de un DXF) salía con racimos de miles de láminas de 0,1 mm: las caras de franja y los anchos de las vigas son trazos exactos y quedaban a 0,2–20 mm por pilares casi alineados (x = 4,26 / 4,28 / 4,282) y tramos de viga girados 0,1°. Recortar o deslizar las caras junto a esos casi contactos se probó y se descartó (el metro de los pilares de borde cambiaba un 10–30 %, del lado inseguro); alinear la geometría a 3 cm dejaba la malla limpia con el compilador de siempre. **El arreglo es en el dibujo** (decisión del usuario, «opción 2»): un aviso al validar y la orden «Alinear» de MA-e. El escalón de cubierta de MA5 sigue pendiente.

**Ya en el repo:**

- **`src/editor/alinear.ts`** (puro): `casiAlineados(modelo, tolerancia)` y `proponerAlinear(modelo, tolerancia)`, con la regla en su cabecera:
  - según las dos direcciones de los ejes (`direccionEjes`), las coordenadas de pilares, vértices (vigas, muros, apoyos lineales, losas con huecos y ábacos, paños, bandas, cargas), apoyos, extremos de barras y ejes guardados, agrupadas si van seguidas a ≤ la tolerancia;
  - **cuenta** un pilar, un punto suelto, el vértice con un tramo casi según esa dirección (≤ 10°, y que no sea un trozo de curva) y el extremo de una polilínea abierta que acaba junto a algo (un pilar, un vértice de otra pieza o un tramo según la dirección que pasa por su lado). Así no avisan dos vértices de dos arcos que coinciden por casualidad en una coordenada (las plantas circular y en abanico de G);
  - **coincide** lo que tiene la misma coordenada (a 1e-9 m) o comparte una cara: la de un pilar (con cada sección de sus tramos) o la de un tramo de viga o muro (eje ± b/2). Un pilar de 35 enrasado con uno de 30 no avisa, ni la losa en la cara de una viga;
  - es un casi alineado si dos clases que no coinciden están en una misma planta;
  - **destino:** el eje guardado del grupo (no se mueve) o la clase que recoge más piezas a ≤ la tolerancia (luego más puntos, el número más redondo y el menor); con lo que sobra, otra vez. Cada otra clase se traslada entera hasta su valor más cercano al del destino, así que nada se mueve más que la tolerancia en cada coordenada y lo enrasado sigue enrasado. Lo que está en el mismo punto que algo que se mueve, va con ello (una viga oblicua que acaba en un pilar). Con los ejes según X e Y queda el mismo double;
  - los huecos de los muros y los tramos de las cargas de viga se vuelven a medir en su tramo (`reestacionar`, ahora en `src/editor/estaciones.ts`, compartido con los pinzamientos), y dos vértices seguidos que acaban en el mismo punto quedan en uno.
- **El aviso `sensatez/casi-alineados`** (`src/agente/sensatez.ts`, «Pilares y vértices alineados», umbral `UMBRALES.casiAlineados` = 3 cm): uno por recta, con sus valores, sus piezas, lo que les falta y los tramos casi rectos con su desvío y su ángulo. Lo dan `fem validar` (aunque no compile), `fem revisar`, el informe y Diagnósticos de la app.
- **`fem alinear proyecto.json [--tolerancia 0.03] [--escribir]`** (MA-e): sólo propone (`grupos`, `movimientos`, `quedan`); con `--escribir`, aplica la propuesta como el editor, deja el fichero de antes en `proyecto.json.bak`, escribe el formato canónico y compila.
- **En la app:** «Alinear» en Modelo · Editar (junto a Renumerar) y en la paleta (Ctrl+K). El diálogo dice qué rectas y cuántos puntos, con la tolerancia en cm; un clic en una recta elige sus piezas; aplica en un paso de deshacer.
- La skill dice cuándo usarlo (tras `importar-dxf`, si el ingeniero quiere alinear) y que se enseña la propuesta antes de escribir.

**Medido:**

- **Sin avisos en falso:** los cinco modelos de A3, los seis ejemplos (muestrario, vivienda, los de A2 y el de la skill), las 5 familias de G con cuatro variantes cada una (giro de 30°, pilares circulares, hueco) y las 24 retículas al azar dan 0 casi alineados. Antes de la regla de «cuenta», la circular y el abanico daban 4 avisos falsos cada una, y la triangular con hueco, 1.
- **Con el DXF crudo de la vivienda** (`fem importar-dxf` sin alinear, fuera del repo): 7 rectas, todas de pilares (x = 4,26 / 4,28 / 4,282; 7,568 / 7,591 / 7,611…). «Alinear» mueve 10 puntos, no queda ninguna y el proyecto valida. Frente al ejemplo que el agente alineó a mano, los pilares quedan a ≤ 0,4 cm salvo la fila de x = 0, que va a −0,02 (tres pilares) en vez de a 0 (dos): manda la mayoría, no el número redondo.
- **Ruido al azar** (criterio 5, `alinear.test.ts`; fuera de la batería, 1 372 casos en siete modelos): con 2–12 mm en pilares y extremos de vigas, «Alinear» deja el modelo como estaba bit a bit, sin mover nada más que la tolerancia y sin que quede ningún casi alineado.
- **Coste:** ≤ 3 ms en los modelos de A3 y en los ejemplos.

**Pruebas:** `src/editor/alinear.test.ts` (lo anterior, más enrasados, tramo casi recto, eje guardado, estaciones de muro, vértices que se juntan y la tolerancia), `src/agente/cli.test.ts` («MA5: alinear», la CLI en un proceso aparte) y `app/src/test/editor.test.tsx` («Alinear (MA5)»). El sondeo de los modelos de referencia, en `validacion/ma/sondeo.ts`.

**Queda de MA5:** el escalón de cubierta (`"tipo": "escalon"`). **Para la puerta de uso:** con el proyecto «51», ver que tras «Alinear» la malla queda sin racimos.


## 8. MA2, MA3, MA4 y el escalón de MA5, hechos (2026-11-05)

En el orden de MA-a (MA3, MA2, MA4, MA5). Lo que cambia de lo que decía §2, y por qué, va marcado **(cambio)**.

### 8.1 MA3 — el `pp` escrito de un reticular es el de su zona aligerada

- **Regla** (`pesoForjado.ts`, `validar.ts`): en un reticular, el `pp` escrito es el de la zona aligerada y los ábacos pesan γ·canto. **(cambio)** MA-b lo decía «con casetón perdido»; se aplica a todos los casetones, porque desde el 2026-10-28 el pp calculado (el que sale sin `pp`) ya es el de la zona aligerada con cualquier casetón, y Propiedades compara el escrito con él («Usar el calculado»): con dos significados según el casetón, esa comparación no tendría sentido. Con casetón recuperable y `pp` escrito, antes los ábacos pesaban el `pp`; ahora γ·h.
- Lo dicen el comentario del campo (y con él el esquema), la tabla Forjados, la plantilla de Forjado, Propiedades, la hipótesis del compilador, el error `reticular/sin-pp` y la skill. La sensatez de A3 y la tributaria usan las mismas funciones.
- **La vivienda**, sin sus 21 cargas de +3 kN/m² en los ábacos (`PPA-*`). **Criterio 3, medido** (`validacion/ma/volcar.ts` y `comparar.ts`, el «antes» con un worktree en el commit anterior, HR-8): la misma malla; Q y N, idénticos (7e-15); **G, −19,37 kN (−0,88 %)**, no a 1e-9. Es un error del modelo de antes, no de MA3: esas cargas caían también en el ancho de las vigas, que desde AU-4 ya pesa macizo (la viga se descuenta (b/2)·pp por lado, hasta γ·(b/2)·min(h, t)), así que el ancho de viga dentro de los ábacos pesaba 3 kN/m² de más. Comprobado: el área de las bandas de las vigas dentro de los ábacos y de la losa es 6,4525 m², × 3 = 19,36 kN (a 0,06 %).
- **El muestrario** (L2, `pp` 4,6 con 12 ábacos y sin cargas en ellos): sus ábacos pasan de pesar 4,6 a 7,5 kN/m². **El usuario tiene que confirmar** que 4,6 es el peso de su zona aligerada (MA-b ya lo pedía).
- **Referencias congeladas** (`validacion/ma/cambiosPeso.ts`, `out_cambiosPeso.txt`): de C3, C5 y F, ninguna cambia; de C4, las cuatro con reticular, `pp` escrito y ábacos (`aleatorio-6-reticular` +6,51 % de peso propio, `aleatorio-5-mixto` y sus `-lv` y `-lv2` +4,09 %), regeneradas a sabiendas. Sólo cambia el peso de los ábacos.

### 8.2 MA2 — ábacos en los pilares y unidos

- **`reticular.abacosPilares`: `{ "lado": 2 }` o `{ "lados": [a, b] }`** (`src/compilador/abacos.ts`). **(cambio)** §2.2 lo ponía en `abacos` como alternativa a la lista; va en un campo propio para que los dos convivan (los de los pilares y alguno dado a mano, como el de un pilar que no está en el centro), para que `abacos` siga siendo una lista de polígonos en todo lo que la lee (dibujo, alinear, estirar, girar, tablas) y para que los ábacos de los pilares no se muevan con «Alinear» ni con «Mover»: siguen a su pilar.
  - Un rectángulo a × b (a según el `eje1`) centrado en el eje del tramo que atraviesa el forjado, en cada pilar que llega a la losa (la regla de «Ábacos» del editor, que ahora usa la misma función, `pilaresEnLosa`). Un pilar con el eje en un ábaco dado no lleva otro.
- **Unión** (MA-c, MA-d): los que se solapan o quedan a menos de h/2 (0,375 m por defecto; la mitad de `tamanoMalla`) van en su envolvente rectangular según los nervios, hasta que no quede ninguno así (el resultado no depende del orden: las envolventes sólo crecen). Aviso `reticular/abacos-unidos` con lo unido y su tamaño. Antes, dos ábacos solapados eran un error; la entrada del catálogo de no válidos de C4 pasa a ser dos de `abacosPilares` mal formado.
- `resolverAbacos` se aplica antes de validar y en lo que pesa o dibuja sin compilar (peso esperado de A3, tributaria, planta, sólido). Sin `abacosPilares` y sin nada que unir, devuelve el mismo objeto: los proyectos de antes salen bit a bit (las referencias congeladas no cambian por MA2). En la tabla Forjados, la columna «ábacos en pilares» («2» o «2 x 1,6»). **Queda:** el croquis de Propiedades dibuja sólo los dados.
- **Criterio 2** (`abacosPilares.test.ts`): la vivienda con `{ "lado": 2 }` en lugar de sus 21 ábacos a mano da los mismos ábacos (los tres pares unidos: P1+P7, P18+P22 y P19+P23) y **el mismo modelo analítico, bit a bit**. Además: los solapados dados dan el modelo de su envolvente dada a mano; la tolerancia (a 0,374 se unen, a 0,376 no; con h = 0,5, a la mitad); ejes girados; el orden de los pilares; la sensatez pesa lo del compilador; los mal formados, error.
- La vivienda conserva sus ábacos a mano (dan lo mismo).

### 8.3 MA4 — la carga de borde

- **`{ "tipo": "borde", "losa", "q", "huecos"?, "excepto"? }`** (`src/compilador/bordes.ts`). **(cambio)** §2.4 la ponía como variante de `lineal` (con `losa` y `borde` en lugar de `puntos`); va como tipo propio, por lo mismo que los ábacos: `puntos` sigue siendo obligatorio en las lineales para todo lo que las lee, y la de borde sigue a su losa sin que Mover o Alinear la toquen.
  - Va por el contorno (y, con `huecos: true`, por los huecos). `excepto`: un segmento `[[x, y], [x, y]]` quita lo del borde que va por él (a ≤ ε_snap); `{ "junto": "L2" }` quita lo que toca en planta otra losa o cae sobre ella, aunque esté en otra planta (el encuentro de dos cubiertas).
  - Se resuelve antes de validar en cargas lineales por los tramos que la llevan (`<id>`, o `<id>:1`, `<id>:2`… si son varios), con los puntos en los vértices del contorno salvo donde empieza o acaba una excepción. La rechaza el validador, diciendo por qué, si su losa no existe, una excepción está mal o se queda sin tramos.
  - En el dibujo (planta, alzado, 3D), las tablas (tipo «borde», columnas «huecos» y «excepto»), las cargas de una pieza y la tributaria.
- **Criterio 4** (`bordes.test.ts`): los petos de la vivienda como dos cargas de borde (`L-CUB` sin el tramo de x = 4,26 de y = 1,87 arriba, `L-CUB-S` entera) dan **los mismos desplazamientos que sus 16 cargas de viga a mano (a 6e-16)** y la misma malla. «La misma malla» es a un ulp: sembrar otra vez el contorno cambia el orden de creación de los puntos del arreglo y un nudo se mueve 5e-17 m, como con «Renumerar» (LV2 §17). Además: los tramos de cada excepción, el modelo bit a bit igual que el de las mismas lineales escritas a mano, y los errores.
- La vivienda conserva sus petos como cargas de viga (dan lo mismo).
- **No está:** que el aviso `losa/ajuste` de una lineal proponga `borde` (§2.4, último punto); la skill lo dice.

### 8.4 MA5 — el escalón

- **`"tipo": "escalon"`** en la planta de encima de un tramo corto (la cubierta superior de la vivienda, a 0,90 m de la otra): la sensatez no avisa de la altura de ese tramo salvo si es menor de 1 cm. En lo demás, como una planta. En el validador, la tabla Plantas y el gestor de plantas.
- **Criterio 5** (`src/agente/escalon.test.ts`): la vivienda lleva ya `CUB-S` como escalón y no da `sensatez/altura` (sin el tipo, sí); el modelo analítico no cambia. La parte de alinear del criterio, en §7.

### 8.5 Fuera del plan: `fem vigas-borde`

Para la puerta: sin ella, un agente tiene que escribir a mano cada zuncho (16 en la vivienda), y eso es lo que MA quiere quitar. `fem vigas-borde proyecto.json [--losa L]… [--ancho 0.30] [--canto …] [--escribir]` es «Vigas de borde» del editor (`proponerVigasBorde`) en la CLI: como `fem alinear`, sólo propone, y con `--escribir` pone las vigas, deja el `.bak` y compila. Prueba en `cli.test.ts`. Con el DXF crudo de la vivienda, una de las dos cubiertas da su error de geometría («los ejes de las vigas de borde no forman un polígono»: un lado más corto que su retranqueo), que el agente tiene que resolver en el contorno.

### 8.6 Lo que decide el usuario

- **MA3:** el 4,6 del muestrario como peso de su zona aligerada; y que la regla valga para todos los casetones, no sólo los perdidos.
- **MA2 y MA4:** los campos propios (`abacosPilares`, `tipo: "borde"`) en lugar de las variantes de §2.2 y §2.4.
- **`fem vigas-borde`**, que no estaba en el plan.

## 9. La puerta de la fase (criterio 1): el plan, fijado antes de lanzarla (2026-11-05)

- **El encargo** (`validacion/ma/puerta/encargo.md`) y **las respuestas** (`respuestas.md`), en git antes de lanzar los agentes. Las respuestas están reconstruidas de lo que dijo el usuario el 2026-10-15 y de lo que quedó en el ejemplo (la conversación no se guardó): no son sus palabras.
- **Tres subagentes**, cada uno en su carpeta con una copia del DXF real (fuera del repositorio), con sólo la skill y la orden `fem`. Reglas: sin código propio (el proyecto sólo lo cambian órdenes `fem` y sus ediciones directas del fichero), nada del repositorio fuera de la skill y una ronda de preguntas. A su ronda se le contesta con `respuestas.md` entero, una vez.
- **La comparación** (`validacion/ma/puerta/comparar.ts`, frente a `ejemplos/vivienda`): pilares a ≤ 1 cm con su sección y sus plantas; por cubierta, una losa con los datos del reticular y los mismos ábacos (los que usa el cálculo) a ≤ 1 cm; las cargas por planta y caso del resumen (con el peso propio) a ≤ 0,5 %. Además se registra, de cada agente, las rondas, las órdenes, si escribió código y lo que supuso.
- **Lo que ya se sabe que puede separarse del ejemplo, y no es un fallo del agente:**
  - el ejemplo es de antes de TB: sus losas van a ejes de los zunchos, con la banda hasta el borde real como cargas de viga (`TIRA-*`); un agente con la skill de hoy las lleva hasta el borde real. Las áreas no se comparan; las cargas por planta, sí (la banda pesa lo mismo de las dos maneras si el agente pone los mismos pesos);
  - «Alinear» lleva la fila de x = 0 a −0,02 m (la mayoría del dibujo, §7), y el agente de 2026-10-15 la llevó a 0 a mano: tres pilares a 2 cm del ejemplo.

## 10. La puerta: resultado (2026-11-05)

**Veredicto: el criterio 1, tal como está escrito, no pasa con ninguno de los tres; lo que mide del agente (una ronda, sin código propio, el modelo que piden las respuestas) pasa con los tres.** Lo que separa sus modelos del ejemplo son dos cosas del dibujo que el ejemplo resolvió de otra manera, no errores de modelado. Y la puerta destapó un fallo grave del programa, ya corregido (§10.3).

### 10.1 Cómo trabajaron

| Agente | Rondas | Preguntas | Código propio | Órdenes `fem` (las nuevas) | Fin |
|---|---|---|---|---|---|
| 1 | 1 | 16 | No (Grep y sed para leer el DXF) | importar-dxf, alinear --escribir, vigas-borde --escribir, validar, resumen, render, calcular, revisar | Revisó, rodeando el fallo de §10.3 (ábacos y petos escritos a mano, el mismo modelo compilado) |
| 2 | 1 | 20 | No (Grep para leer el DXF) | las mismas, con `abacosPilares` y `borde` | Se paró en el fallo, como dice la skill; revisó tras el arreglo |
| 3 | 1 | 16 | No (Grep para leer el DXF) | las mismas | Revisó, rodeando el fallo (como el 1) |

- Los tres preguntaron **todo en una ronda**, con propuesta en cada punto, y no sacaron de memoria ningún dato de norma (uso, nieve, permanentes).
- Los tres encontraron y preguntaron lo mismo del dibujo: la pestaña de 32 cm al sur de la cubierta baja (que hace fallar `fem vigas-borde`), el saliente de 0,50 × 0,70 m junto a P6 (una chimenea), los pilares del encuentro de las dos cubiertas, los 24 rectángulos sin cruz y la pérgola. Las respuestas no decían nada de la pestaña ni del saliente: los tres los quitaron y lo dijeron.
- Dos (1 y 2) corrigieron a mano la propuesta de `fem vigas-borde` en el encuentro: la orden ponía el zuncho de la cubierta baja enrasado por dentro (x = 3,96), lejos de P4, P12 y P15, y lo llevaron al eje de los pilares. **Es un hallazgo de la orden** (§10.4).
- Los tres avisaron de P1 (`sensatez/tributaria`): con el ábaco unido de P1 y P7, la esquina tiende a levantarse con Q. Es del modelo que pide el ingeniero; lo dejaron para él.

### 10.2 Frente al ejemplo (`validacion/ma/puerta/comparar.ts`, `out_comparar.txt`; los proyectos, en `proyectos/`)

| | Agente 1 | Agente 2 | Agente 3 |
|---|---|---|---|
| Pilares (≤ 1 cm) | 18 a 0; 5 a 2,0 cm | igual | igual |
| Cubierta alta: datos, ábacos (10) | iguales, a 0,4 cm | iguales, a 0,4 cm | iguales, a 1,0 cm |
| Cubierta alta: G, Q, S | +0,10 / +0,16 / +0,16 % | igual | igual |
| Cubierta baja: ábacos (11) | 8 | 8 | 11, a 2,0 cm |
| Cubierta baja: G, Q, S | −1,24 / −0,06 / −0,06 % | −0,99 / −0,06 / −0,06 % | +0,73 / +2,27 / +2,27 % |

- **Los 5 pilares a 2 cm** son la fila de x = 0, que «Alinear» lleva a −0,02 (la mayoría del dibujo) y el agente de 2026-10-15 llevó a 0 a mano: lo que §7 y §9 ya decían. Las respuestas sólo decían «ponlo bien».
- **La cubierta baja junto a la alta** es lo único que de verdad se separa. El DXF dibuja la cubierta baja hasta x = 4,11, la cara de los pilares P4, P12 y P15 (en x = 4,26); el ejemplo la llevó hasta su eje y le puso los ábacos de esos tres pilares.
  - Los agentes 1 y 2 siguieron el dibujo: los ejes quedan fuera de la losa, no hay ábaco (−3 ábacos) y la cubierta baja pesa un 1 % menos (lo que no es losa ni ábaco en esa franja).
  - El 3 la llevó a la cara de fuera del zuncho (x = 4,41), 30 cm por debajo de la alta: tiene los 11 ábacos, pero cuenta uso y nieve en 2,7 m² que tapa la cubierta alta (+2,27 %).
  - Las dos lecturas son defendibles y las respuestas no decían nada: es una pregunta que falta en la lista de MA1 («en un escalón de cubierta, ¿hasta dónde llega la baja: la cara de los pilares, su eje o pasa por debajo?»).
- Con esas dos cosas aparte, **los tres modelos son el del ejemplo**: el mismo forjado, los mismos ábacos donde hay losa, las mismas cargas por m², los mismos petos (con `borde` o escritos a mano en el contorno) y la misma pérgola; la cubierta alta, a ≤ 0,16 %.

### 10.3 El fallo que destapó: las consultas con `abacosPilares` o `borde`

`Consultas` (y `EsfuerzosMuros` y las bandas) validaba el modelo físico tal como se guarda, sin resolver antes los ábacos de los pilares ni las cargas de borde, y acababa en `cli/error-interno`: `fem validar`, `resumen` y `calcular` funcionaban, pero `fem revisar` y todo `fem consultar` no. Las pruebas de §8 compilaban y calculaban, pero no consultaban. **Corregido:** `validar` resuelve las dos cosas al empezar (`fisicoResuelto`; idempotente, así que el compilador da los mismos bits), y `bordes.test.ts` lleva la prueba con `Consultas` (la vivienda con `abacosPilares`, un ábaco unido y una carga de borde).

### 10.4 Lo que sale para MA

- **MA1:** añadir a la lista la pregunta del escalón (hasta dónde llega la cubierta baja bajo la alta).
- **`fem vigas-borde`:** en el lado de una losa que da a otra losa en otra planta, propone el zuncho enrasado por dentro aunque haya pilares en el eje del lado (no los cuenta porque su huella no pisa la banda del enrasado). Dos agentes lo corrigieron a mano.
- **`fem vigas-borde` con la pestaña de 32 cm:** el error («los ejes no forman un polígono») no dice qué lado sobra; los agentes lo encontraron mirando el render.
- **Alinear:** «la mayoría» frente a «el número redondo» (§7) sigue abierto: es lo que pone a 2 cm la fila de x = 0.

**Para el usuario:** decidir si el criterio 1 se da por cumplido con estas dos diferencias explicadas o se repite tras añadir la pregunta del escalón a MA1.
