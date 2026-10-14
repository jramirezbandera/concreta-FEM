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
- Bordes: vuelos y petos (en **kN/m**: si dan kN/m², pedir la altura).
- Cargas: permanentes por zona, uso con su categoría (para ψ), nieve (valor), y si se dejan viento y sismo para después.
- Lo dudoso del dibujo (piezas que pueden no ser estructurales): preguntarlo con su lectura propuesta.

Además, en la skill: cómo leer un DXF con `fem importar-dxf` (MA6) y qué hacer con lo que no reconoce.

### 2.2 MA2 — ábacos automáticos y unidos

En `Losa.reticular.abacos`, además de la lista de polígonos, `{ "lado": 2.0 }` (o `{ "lados": [2.0, 1.6] }`): un ábaco rectangular centrado en cada pilar que llega a la losa, con sus lados según los de la losa (`eje1`).

- Los ábacos (dados o automáticos) que se solapan o quedan a menos de una tolerancia (propuesta: h/2) **se unen** en su envolvente rectangular, con el aviso `reticular/abacos-unidos` que dice cuáles. Hoy es un error.
- Lo que cae fuera de la losa no cuenta, como ahora.
- La envolvente de dos ábacos unidos puede cubrir zona que no es de ninguno (en diagonal). Con ábacos alineados (lo normal), no.

### 2.3 MA3 — el peso del reticular por zonas con casetón perdido

Campo nuevo `ppAligerado` en la losa reticular: el peso de la zona aligerada (el dato que da el ingeniero o el fabricante). Los ábacos pesan γ·h, como ya hace el casetón recuperable (C4-i). El `pp` actual (medio de toda la losa) sigue valiendo; dar los dos es error.

- La sensatez de A3 (peso esperado frente al calculado) y el informe lo reconocen.

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
| 3 | MA3: la vivienda con `ppAligerado: 4.5` y sin las 21 cargas de los ábacos da las mismas fuerzas nodales de peso propio + carga que hoy (a 1e-9) y la sensatez de peso sin aviso. |
| 4 | MA4: los petos de la vivienda como `borde` dan el mismo vector de cargas que las polilíneas a mano (a 1e-9), y la malla no cambia. |
| 5 | MA5: la vivienda con `escalon` no da `sensatez/altura`; `fem alinear` sobre las coordenadas crudas del DXF da las del ejemplo y no mueve nada más que la tolerancia (test con ruido al azar). |
| 6 | MA6: **ida y vuelta** con los proyectos de ejemplo: exportar sus pilares, losas y ejes a un DXF (un exportador de prueba, sólo para los tests) e importarlo da los mismos pilares, contornos y ejes. Con el DXF real de la vivienda (que no se sube: datos del cliente; el test usa un DXF sintético con sus mismas entidades: líneas dobles, cotas, `$INSUNITS` erróneo), los 23 pilares y los dos contornos. |
| 7 | Sin regresión: las referencias congeladas de C1–C5 y F, idénticas; el esquema de `proyecto.json` sólo gana campos opcionales. |

## 4. Lo que decide el usuario (propuestas por defecto)

- **MA-a, orden:** MA1 → MA3 → MA2 → MA4 → MA5 → MA6, y la puerta (criterio 1) al final. MA1–MA3 son pequeñas y quitan los errores más fáciles de cometer; MA6 es la que más cambia las cosas y la más larga.
- **MA-b, peso del reticular:** campo nuevo `ppAligerado` (propuesto) o cambiar el significado de `pp` con casetón perdido (rompe proyectos guardados: no).
- **MA-c, ábacos unidos:** unirlos con aviso (propuesto) o seguir rechazándolos y que lo haga el agente.
- **MA-d, tolerancia de unión de ábacos:** h/2 (propuesta).
- **MA-e, `fem alinear`:** sólo propone por defecto y escribe con `--escribir` (propuesto), con tolerancia de 3 cm por defecto.
- **MA-f, lector de DXF:** dependencia `dxf-parser` (MIT) o lector propio; se decide en MA6 tras medir con el DXF de la vivienda.
- **MA-g, cuándo:** antes o después de la puerta de uso de F y AB, que ya se puede hacer con la vivienda (`?ejemplo=vivienda`). Propuesta: la puerta primero (no necesita nada de esta fase), y MA después, con lo que salga de ella.

## 5. Fuera de esta fase

- DWG directo.
- Dibujar con el ratón en la app (V2c): `importar-dxf` cubre el caso de un plano ya hecho, no el de un modelo desde cero.
- Generar viento y sismo desde la situación (CTE DB-SE-AE y NCSE): necesita las tablas de norma en el programa, con su propia validación.
- Lo que la vivienda enseñó del cálculo, que no es del agente: los pilares de borde del encuentro de dos cubiertas sin cara de franja (`franja/pilar-sin-cara` en P4, P15 y P23) y la esquina de la sala de instalaciones (P1, casi sin carga). Se miran en la puerta de uso.
