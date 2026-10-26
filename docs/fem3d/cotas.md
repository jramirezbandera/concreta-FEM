# CT: cotas que mandan (plan)

> **Fecha:** 2026-10-25. **Estado:** decidido por el usuario el 2026-10-25 (§6). **CT1 hecho el 2026-10-25** (§7); **CT2, el 2026-10-26** (§8); CT3, por hacer.
>
> **Origen:** el usuario, al dibujar pilares con V2c-1: «al meter pilares se ponen las cotas automáticas entre los pilares; estaría bien que pudieras confirmar la distancia de la cota para que sea lo que quieras, y que pudieras cambiar las cotas después y se cambiara la posición».

## 1. Lo que hay hoy

- **Las cotas no son de los pilares,** sino las cadenas entre ejes de replanteo paralelos (`capaEjes` → `cotas`, `src/agente/render/ejes.ts`), sólo en la vista `modelo`.
  - Sin `ejes` en el modelo, los ejes son los propuestos (`proponerEjes`, `src/compilador/ejes.ts`), que pasan por la media de cada alineación de pilares. Por eso cada pilar nuevo mueve las cotas.
- **Sólo se dibujan:** son primitivas de A4 (`clase: "cota"`) y no se pueden elegir ni editar.
- **El rótulo redondea al centímetro** (`toFixed(2)`). Un pilar a 5,397 sale «5,40», sin aviso, y una alineación con un pilar descolocado 3 mm también.
- **La herramienta Pilar** (`src/editor/dibujo/herramientas.ts`) acepta `x; y`, pero `@dx; dy` no sirve, porque un pilar no tiene punto anterior. No hay manera de decir «a 5,40 del eje 2».
- **No hay mover ni estirar** (V2c-3, `dibujo.md` §2.5): una posición sólo se cambia en la tabla.

## 2. Qué se propone

### 2.1 Cotas temporales al poner un pilar (CT1)

Con la herramienta Pilar, junto al pilar fantasma se dibujan **cuatro cotas temporales**: del punto fijo del fantasma a la referencia más cercana a cada lado, en las dos direcciones de los ejes (`direccionEjes`; con la planta sin girar, X e Y).

- **Referencias:** los ejes de replanteo de la planta (guardados o propuestos) y el punto fijo de los pilares que llegan o arrancan en ella. Gana la más cercana; un eje y un pilar en la misma recta son la misma referencia, y se nombra el eje.
- **Tab** salta de una cota a otra. Lo que se escribe (`5,40`) **fija esa dirección**: la otra sigue al ratón o al enganche. Con las dos fijas, el fantasma no se mueve. **Intro** coloca el pilar; Esc suelta lo fijado.
- **Exacto:** la coordenada fijada es la de la referencia más el valor, con una sola operación de coma flotante. Con ejes paralelos a X o Y es la suma tal cual, como en V2c1-1.
- Lo tecleado de siempre (`x; y`) sigue igual.
- **Ventana** (un pilar en cada cruce): sin cotas temporales.

### 2.2 Estirar desde la cadena de cotas (CT2)

Cambiar el número de una cota de la cadena entre ejes **estira** el modelo:

1. Clic en el número de una cota: aparece **una flecha en cada extremo**.
2. Clic en la flecha del lado que se mueve (decisión CT-b). Se abre el campo con el valor actual, y lo que se va a mover sale resaltado en las vistas. ← y → cambian de lado mientras se escribe.
3. Intro aplica; Esc anula.

**Qué se mueve (decisión CT-a, estirar):** todo lo del lado elegido se desplaza Δ = valor nuevo − valor actual, en perpendicular a los ejes. Las demás cotas de la cadena no cambian.

- **La línea de corte** no es el eje que se mueve, sino una paralela dentro del vano, a min(L/4; 0,5 m) de él. Así lo pegado al eje va con él: la huella de sus pilares, una viga alineada a la cara interior (V2c-b) y el borde de una losa en la cara de una viga. Lo que está más allá de la línea se mueve entero, y lo que la cruza se alarga.
- **En todas las plantas** (decisión CT-c): los pilares las atraviesan, y moverlos en una sola despegaría las vigas de las demás.
- **Cada tipo de objeto:**
  - pilares, apoyos y cargas puntuales: su punto;
  - polilíneas y polígonos (vigas, muros, apoyos lineales, contornos y huecos de losas y paños, ábacos, cargas lineales y zonas de carga): cada vértice por su lado;
  - ejes de replanteo guardados: los paralelos, por su lado; los perpendiculares se alargan;
  - estaciones a lo largo de una pieza (cargas de viga con `desde`/`hasta`, huecos de muro y tramos de banda): cada estación se lleva a su punto, se estira ese punto y se vuelve a medir sobre la pieza estirada. Una carga parcial que cruza la línea se alarga. **Un hueco de muro que la cruza cambia de ancho y se avisa.**
- **Los puntos que estaban en el eje** acaban exactamente en la referencia más el valor, no en su coordenada más Δ, que no siempre da los mismos bits.
- **Con los ejes propuestos** no hay ejes que mover: se mueven los pilares, y los ejes se vuelven a proponer por ellos.
- **Un paso de deshacer:** es un `lote` de `cambiar` que se valida como cualquier otro.
- Lo que no es geometría (secciones, cargas por pieza sin estación, plantas) no se toca.

### 2.3 Las cotas de un pilar elegido (CT3)

Con Elegir y un solo pilar elegido, se dibujan sus cuatro cotas temporales, como en CT1 y sin el propio pilar entre las referencias. Cambiar una mueve **sólo ese pilar**, en todas sus plantas.

- **Las vigas que acaban en su punto fijo lo siguen** (decisión CT-d, que es la V2c-d de `dibujo.md`): el vértice de cada viga que coincide bit a bit con el punto del pilar, en las plantas del pilar. Con Ctrl al aceptar, el pilar solo.
- Una viga alineada a la cara (V2c-b) no acaba en el punto del pilar, así que no lo sigue: se avisa con su nombre.
- Los ejes guardados no se mueven. Si el pilar se sale de su eje, la cota lo dirá (§2.4).

### 2.4 Rótulos que no engañan (CT1)

- Una cota que no es un número entero de centímetros (a más de 0,5 mm) se rotula en milímetros: «5,397».
- **Un eje propuesto cuyos pilares no están alineados** (a más de 1 mm de su recta) lleva la marca «≈» en su burbuja, con su dispersión en la leyenda.
- Cambia el SVG de `fem render` en esos casos. Las referencias de render afectadas se regeneran a sabiendas.

## 3. Arquitectura

```
src/editor/dibujo/cotas.ts      las referencias de una planta y las cuatro cotas temporales de un punto (puro)
src/editor/estirar.ts           estirar(modelo, recta, lado, Δ) → Operacion; moverPilar(modelo, id, p, conVigas) → Operacion
src/agente/render/ejes.ts       la cadena de cotas: cada cota con sus dos ejes (para elegirla) y el rótulo en mm
app/src/dibujo/                 Tab, campo y valores fijados en la herramienta Pilar; flechas y campo de la cota editada
app/src/vistas/vista2d.ts       cotas temporales y resaltado de lo que se moverá, en el lienzo 2D
```

Todo lo que decide qué se mueve está en `src/editor/` y se prueba en vitest con secuencias de eventos, como V2c-1.

## 4. Criterios de paso

1. **CT1 exacto:** en vitest, un pilar puesto con una cota fijada queda a la distancia tecleada de su referencia, bit a bit con ejes paralelos a X o Y; con los dos valores fijados, igual a la fila de la tabla con esas coordenadas.
2. **Estirar con un oráculo:** un edificio de retícula generado con las luces L₁…Lₙ y estirado en un vano hasta L′ da la misma huella que el generado directamente con L′, en planta ortogonal y en una girada (sin los bits, con los nudos emparejados a 1e-9 en la girada).
3. **Estirar no pierde nada:** en las referencias de C1–C5, F y la vivienda, estirar un vano y deshacerlo devuelve el proyecto byte a byte. Estirado, compila sin avisos nuevos de ε_snap, ajustes ni fusiones, y la carga total de cada caso cambia sólo por el área nueva (exacta en las cargas de superficie, y cero en las puntuales).
4. **CT3:** mover un pilar arrastra los vértices de sus vigas en todas sus plantas, y con Ctrl no. Moverlo y volverlo a su sitio deja el proyecto byte a byte.
5. **Fluidez:** en el edificio objetivo, las cotas temporales tardan ≤ 2 ms al mover el ratón y el resaltado del estirado ≤ 16 ms, sin tareas largas (banco de Chrome).
6. **Nada se rompe:** los bancos de V2c-1, I1–I4, V1, V2a y V2b, con los mismos bits salvo los rótulos de §2.4.
7. **Puerta de uso (del usuario):** dibujar una planta suya con las cotas temporales y corregir dos luces después.

## 5. Tramos

| Tramo | Qué |
|---|---|
| **CT1** | Cotas temporales y Tab en la herramienta Pilar; rótulos en mm y «≈» |
| **CT2** | Estirar desde la cadena de cotas, con las flechas y el resaltado |
| **CT3** | Cotas del pilar elegido y mover un pilar con sus vigas (V2c-d) |

CT2 y CT3 adelantan parte de V2c-3 (mover y pinzamientos). Su `estirar.ts` es la base del Mover de V2c-3.

## 6. Decisiones del usuario (2026-10-25)

| # | Decisión | Elegido |
|---|---|---|
| **CT-a** | Qué se mueve al cambiar una cota entre ejes | **Estirar:** todo lo de un lado del vano se desplaza y las demás luces no cambian (no sólo el eje y lo que hay en él) |
| **CT-b** | Qué lado se mueve | **Se elige con una flecha** en cada extremo de la cota (no por defecto la derecha o arriba, ni el lado con menos objetos) |
| **CT-c** | En qué plantas | **Todas** |
| **CT-d** (= V2c-d) | Mover un pilar arrastra las vigas que acaban en él | **Sí, como CYPECAD;** con Ctrl, el pilar solo |

Los detalles de §2 que no estaban en las preguntas los propone Claude, y se pueden cambiar en la puerta de uso: la línea de corte a min(L/4; 0,5 m), las cuatro referencias (eje o pilar más cercano a cada lado), los rótulos en mm y el aviso del hueco de muro que cambia de ancho.

## 7. CT1 hecho (2026-10-25)

Las cotas temporales de la herramienta Pilar y los rótulos de la cadena.

### 7.1 Qué hay

- **`src/editor/dibujo/cotas.ts`** (puro): las referencias de una planta (`referenciasCotas`, guardadas por índice de enganches), las cuatro cotas de un punto (`cotasEn`), la colocación con lo fijado (`colocar`) y `limpio`, que quita el ruido de una suma (3 + 2,4 es el 5,4 de la tabla).
- **`herramientas.ts`:** el estado de Pilar lleva `fijos` y `activa`, y hay tres eventos nuevos: `tab`, `fijar` y `terminar` con el punto del cursor.
  - Tab recorre izquierda, derecha, abajo y arriba (Mayús+Tab, al revés), saltándose los lados sin referencia.
  - Un número fija la activa, y la activa pasa a la primera de la otra dirección: «Tab, 5,40, Intro, 3,00, Intro, Intro».
  - Un clic o Intro coloca el pilar con lo fijado, y lo fijado se suelta.
  - Esc suelta lo fijado sin salir de la herramienta; un número sin cota activa o negativo da su mensaje.
- **App:** `controlador.ts` pinta las cotas encima de la vista:
  - con la línea de referencia de trazos desde el pilar o el eje;
  - la fijada, con el número relleno, y la activa, con borde grueso;
  - un número que no cabe en su cota, por fuera de la referencia;
  - una cota nula fijada, junto al punto.

  El pie dice la cota activa y se rehace con las teclas, sin mover el ratón (`Motor.refrescarCursor`). En el campo de teclado, Tab cambia de cota, y Propiedades lo explica.
- **Rótulos (§2.4):**
  - `rotuloCota` en `render/ejes.ts`: mm si no son cm redondos;
  - `proponerEjes` da la dispersión de cada eje, y las cotas junto a un eje con los pilares a más de 1 mm llevan «≈», con una nota.
  - Ninguna referencia de render cambia.

### 7.2 Criterios

| # | Resultado |
|---|---|
| 1 | **Pasa.** `cotas.test.ts`: la x tecleada desde el eje 2 es, bit a bit, la que da la tabla, para 0,1, 0,2, 2,4, 2,45, 3,3, 5,4 y 0,7; con las dos fijadas, el proyecto es byte a byte el de la fila de la tabla; con ejes a 30°, la distancia fijada se mide en perpendicular a 1e-12 y la otra coordenada es la del cursor. En Chrome (`validacion/ct/chrome.ts`), cuatro pilares puestos sólo con Tab y distancias, desde un pilar y desde los ejes propuestos que salen de ellos; guardados, en (0; 0), (5,4; 0), (5,4; 6,25) y (0; 6,25) exactos |
| 5 | **Pasa en lo de CT1.** Edificio objetivo, planta N3, con Pilar: mover el ratón y pintar las cotas, 0,2 ms de mediana y 0,3–0,4 ms p95; 120 movimientos sin tareas largas |
| 6 | **Pasa.** El banco de V2c-1 da lo mismo; `src` (2 145 pruebas) y la app (65) en verde |

### 7.3 Hallazgos

- **CT1-1, Esc.** El controlador volvía a Elegir con Esc sin preguntar a la herramienta cuando no había puntos, así que el primer Esc no soltaba lo fijado. Lo encontró el banco; ahora sale sólo sin puntos, sin nada fijado y sin cota activa.
- **CT1-2, la tolerancia de las alineaciones.** Un pilar entra en una alineación de los ejes propuestos hasta máx(ε_snap, una fracción de la menor separación), así que el eje puede pasar a centímetros de un pilar sin que se viera. Ahora lo dice el «≈».

## 8. CT2 hecho (2026-10-26)

Estirar el modelo desde la cadena de cotas entre ejes, como en §2.2.

### 8.1 Qué hay

- **`src/editor/estirar.ts`** (puro):
  - `estirar(modelo, { n, fijo, movil }, valor)` da el `lote` de `cambiar` (un paso de deshacer) y los avisos;
  - `afectados` dice lo que se mueve entero y lo que se alarga, para resaltarlo;
  - `corte` da la línea de corte, a min(L/4; 0,5 m) del eje que se mueve.

  Va vértice a vértice por todo lo de §2.2, en todas las plantas. Las estaciones (cargas de viga con `desde`/`hasta`, huecos de muro y apoyos de banda) se llevan a su punto, se estiran y se vuelven a medir. En un tramo que cruza el corte, el punto va a su t estirado sobre el tramo nuevo.
- **Exacto:** con ejes paralelos a X o a Y, un punto del eje que se mueve acaba en la coordenada del fijo más el valor, y los demás en la suya más Δ, con `limpio` (el double de la tabla). En una planta girada, p + Δ·n.
- **Errores:**
  - un valor que no es positivo, o que es el de ahora;
  - acortar tanto que lo que se mueve pase por encima de lo que se queda: «La cota tiene que medir más de 0,90 m: con menos, L-N2 pasaría por encima de L-N2», con el vértice que se mueve y el que se queda más cerca del corte, en todo el modelo.
- **Aviso:** un hueco de muro que cruza el corte cambia de ancho («pasa de 0,90 a 1,40 m de ancho»).
- **`render/ejes.ts`:** la geometría de las cadenas sale a `cadenasCotas` y `cotasCadena` (cada cota con sus dos ejes, sus extremos y el centro del rótulo), y `cadenasDe(modelo)` da las de la vista `modelo`. El SVG no cambia.
- **App** (`controlador.ts`, con Elegir, sólo en las vistas de planta que dibujan la cadena):
  - al pasar por el número de una cota, se engrosa y la barra dice «Cota 3–4: 6,00 m · clic para cambiarla»;
  - un clic la elige y pinta una flecha por fuera de cada extremo;
  - un clic en una flecha elige el lado que se mueve y abre el campo encima, con el valor elegido;
  - mientras, en todas las plantas, lo que se mueve va lleno, lo que se alarga de trazos, y se ve la línea de corte;
  - ← y → cambian de lado, también con el campo abierto; Intro aplica («Estirar 3–4 a 6,35 m» en deshacer); Esc, o un clic fuera de las cotas, la deja;
  - los avisos quedan en la barra.

### 8.2 Criterios

| # | Resultado |
|---|---|
| 2 | **Pasa.** `estirar.test.ts`: una retícula de 3 × 2 vanos con dos plantas (pilares, vigas por los ejes y una alineada a una cara, losa con un hueco, reticular con ábacos, muro con un hueco, ejes guardados y cargas de superficie, de zona, lineales, puntuales y de viga parciales), estirada en cada vano, a +0,35, −0,8 y +1,2 m y moviendo cada uno de los dos ejes, es byte a byte la generada con esa luz: 30 casos. Girada 30°, la geometría a ≤ 1e-9 y los nudos al compilar, emparejados a ≤ 1e-9 |
| 3 | **Pasa.** En 1-022, la retícula enrasada (C2), la retícula con núcleo (C3), el reticular y el unidireccional (C4) y la vivienda, deshacer da los bytes. Estirado, compila sin avisos nuevos de ajustes, casi encuentros, losas casi juntas ni fusiones, y la carga de cada caso es lineal en Δ (estirar 0,8 cambia el doble que 0,4, a 1e-9): sólo cambia por el área nueva. Un caso sólo con puntuales no cambia |
| 5 | **Pasa.** En el edificio objetivo (`validacion/ct/chrome.ts`), pintar lo que se mueve en una planta tarda 0,5 ms la primera vez y 0,2 ms de mediana, sin tareas largas |
| 6 | **Pasa.** El banco de V2c-1 y el de CT1 dan lo mismo; `src` (2 193 pruebas) y la app (68) en verde |

Además, en Chrome, con el edificio objetivo: el número de la cota 3–4 se ofrece al pasar, la flecha del 4 abre el campo con «6,00» y ← y → cambian de lado. Con 6,35 e Intro, el proyecto guardado es el de `estirar` en Node byte a byte (469 objetos cambiados); deshecho y guardado, el de partida. La prueba del controlador (`app/src/test/estirar.test.ts`) recorre la misma secuencia y los errores.

### 8.3 Hallazgos

- **CT2-1, lo que hay dentro del vano se queda.** Al estirar 3–4 del edificio objetivo a 6,35, la viga secundaria a media luz sigue en x = 15, a 0,175 del centro nuevo. Es lo decidido en CT-a (sólo se mueve lo que está más allá del corte), pero quizá se espere otra cosa al probarlo. Si se quiere, la otra regla sería repartir lo de dentro del vano en proporción, para la puerta de uso.
- **CT2-2, los nombres al revés.** Con los ejes paralelos a Y, la cadena mide t = −x (n = d girado 90°), así que el primer eje de una cota es el de la derecha. La barra, el campo y deshacer nombran la cota en el orden de lectura («3–4»), y el lado, por el eje que se mueve.
- **CT2-3, el formato del edificio objetivo.** El `proyecto.json` de `validacion/a2/agente/edificio/` no está en el formato canónico: guardarlo sin cambios ya cambia sus bytes. El banco compara lo deshecho con el formato canónico.
