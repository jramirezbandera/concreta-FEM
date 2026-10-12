# Interfaz v4: propuesta

> **Qué es.** Rehacer la interfaz de la app (V1 + V2a) para que se parezca a CYPECAD y SAP2000, pero como una aplicación actual: el dibujo manda, hay barra de herramientas, varias vistas de la estructura (planta, alzados por eje y 3D), un 3D con las secciones extruidas y los resultados dibujados sobre el 3D alámbrico. **Fecha:** 2026-10-11.
>
> **Estado:** decisiones I-a…I-h tomadas por el usuario el 2026-10-12, todas como se proponían (§12). Lo que se fija para I1, en §13. **I1 hecha el 2026-10-12:** pasan sus cuatro criterios; el informe está en `fase-i1.md`. Lo que se fija para I2, en §14. **I2 hecha el 2026-10-12:** pasan sus cinco criterios; el informe está en `fase-i2.md`.
>
> **Prototipo:** lienzo «FEM 3D · Interfaz v4» (https://claude.ai/artifact/EhCxgYTvYMsfKzcLph4Wsp), con cinco pantallas. Los dibujos 3D, la planta y el alzado salen del edificio objetivo (`validacion/a2/agente/edificio`) con sus resultados reales (envolvente de My, ν por tramo), dibujados con Three.js en Chrome: son también un primer spike de I3 e I4.
>
> **Cambio de criterio.** La v3 de los prototipos y V1 seguían «denso, con todo a la vista y nada tras pestañas». Con la app en uso, el usuario la ve ultradensa, con el dibujo pequeño y mal grafiada (2026-10-11). Esta propuesta cambia «todo a la vista» por **«todo a un clic, y el dibujo siempre a la vista»**, y conserva lo que sí funcionaba: cada número sale de una consulta, cada valor lleva su combinación y nunca se enseña un resultado que no vale.

## 1. Qué falla ahora

Medido sobre la captura de la pantalla Modelo (1920×1080, 1-022):

- **El dibujo ocupa un 30 % de la pantalla** (1290×480 px). El resto son paneles fijos: 275 px a la izquierda, 340 a la derecha (diagnósticos, casi siempre vacío) y 320 abajo (la hoja, siempre abierta).
- **El panel izquierdo mezcla cinco niveles:** proyecto, recuentos, plantas, vista, datos de la planta y casos, todo con el mismo peso.
- **La cabecera hace de todo:** seis pantallas, deshacer, rehacer, guardar, estado, recalcular, abrir y tema en una línea. No hay barra de herramientas.
- **Grafismo:** la viga es una línea de 1 px, el pilar un cuadrado de 6 px sin su sección a escala, los rótulos se pisan, no hay ejes de replanteo ni cotas y la leyenda es un párrafo.
- **Vistas:** sólo planta y un 3D alámbrico. No hay alzados, vistas estándar ni sólido.
- **Resultados repartidos en cuatro pantallas** (Losas, Vigas, Pilares, Desplomes), cada una con su disposición. Para pasar de My en vigas a N en pilares hay que cambiar de pantalla.
- **Jerarquía plana:** casi todo es texto de 11 px, con mucha monoespaciada y el mismo gris.

## 2. Principios

1. **El dibujo manda:** las vistas ocupan al menos el 70 % de la ventana en 1920×1080 (60 % en 1366×768). Los paneles se pliegan y recuerdan cómo se dejaron.
2. **Un modelo, muchas vistas:** planta, alzado y 3D, en 1, 2 o 4 vistas a la vez, con la selección y el resultado activo compartidos (como ETABS y SAP2000).
3. **Espacios de trabajo con su barra de herramientas** (como las pestañas de CYPECAD): lo que se hace en cada fase está a la vista, y lo que no toca, no.
4. **Información por capas:**
   - sin hacer nada: el dibujo, los extremos rotulados y la leyenda;
   - al pasar el ratón: el valor en ese punto, de una consulta;
   - al elegir: el inspector y el detalle de la pieza;
   - a demanda: tablas, combinaciones e informe.

   Nada queda escondido: todo está a un clic, pero no todo a la vez.
5. **Nunca un resultado que no vale presentado como válido** (regla de oro 2, criterio 3 de V1): con el modelo cambiado, la capa de resultados se vacía al instante y la vista lo dice.
6. **Cada número rotulado sale de una consulta** (A4), también en 3D: nunca se lee del color ni de la geometría.
7. **Teclado primero:** atajos para todo lo frecuente, paleta de órdenes (Ctrl+K) y Esc para soltar.
8. **Grafismo técnico:** jerarquía de grosores, secciones a escala real, ejes con burbujas, cotas y rótulos que no se pisan (§8).

## 3. La ventana

```
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│ ● Concreta  Proyecto ▾ │ Modelo · Cargas · Resultados · Revisión │ ↶ ↷ 💾 │ ● Calculado │ ▶ │⌘K│ 44
├───────────────────────────────────────────────────────────────────────────────────────────────┤
│ [Elegir] │ Ejes Pilar Viga Losa Muro Hueco Forjado Apoyo │ Copiar Mover Girar Borrar │ ▣ ◫ ⊞  │ 56
├──────────┬─────────────────────────────────────────────────────────────────────┬──────────────┤
│Navegador │ ┌ Planta N3 +6,00 ▾ · Sólido ▾ ─────────────────────────── ViewCube ┐│ Propiedades  │
│ árbol del│ │N7                                                                ││ de lo elegido│
│ proyecto │ │N6   carril                                                       ││ o, sin nada, │
│ y vistas │ │N5   de plantas                     vista                         ││ de la vista  │
│ 240 px   │ │N4                                                                ││ 300 px       │
│ plegable │ │N3 ●                                                              ││ plegable     │
│ a 44 px  │ │N2                         [⤢ ✥ ⟳ ▢ ◩ ✂ ◐]   barra de la vista    ││              │
├──────────┴─────────────────────────────────────────────────────────────────────┴──────────────┤
│ Tablas · Diagnósticos 0 · Combinaciones 42 · Registro                    (plegado, 32 px)     │
├───────────────────────────────────────────────────────────────────────────────────────────────┤
│ X 24,00  Y 0,00  Z 6,00 │ enganches │ kN·m │ huella 04932146 │ 34 737 nudos │ núcleo 3cc4d3c8  │ 24
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Barra superior (44 px):**
  - marca y proyecto, con el menú de fichero (nuevo, abrir, guardar, descargar, exportar);
  - los espacios de trabajo;
  - deshacer, rehacer y guardar, con la marca «sin guardar»;
  - el estado del cálculo, que es la única pastilla de color de la barra;
  - Calcular, la paleta de órdenes y el tema.
- **Barra de herramientas (56 px):** cambia con el espacio de trabajo (§4). Son iconos de 20 px con su nombre debajo, en grupos separados. En pantallas estrechas el nombre se va y queda en el título.
- **Navegador (izquierda, 240 px, plegable a un carril de 44 px):**
  - el árbol del proyecto: plantas, ejes, materiales, secciones, pilares, vigas, losas, muros, casos y combinaciones, cada uno con su número y sus diagnósticos;
  - debajo, las vistas guardadas;
  - elegir en el árbol elige en las vistas, y al revés.
- **Vistas (centro):** una, dos o cuatro (§5). Cada una tiene su cabecera flotante con desplegables: el tipo, la planta (con flechas a la de encima y la de debajo) o el eje, y el modo. Las 3D llevan además el ViewCube. Hasta el 2026-10-12 la planta se elegía con un carril a la izquierda de la vista; el usuario lo vio como demasiados botones y pasó a un desplegable.
- **Propiedades (derecha, 300 px, plegable):**
  - **con algo elegido:** sus datos editables (lo que hoy hacen el inspector y el formulario de V2a), lo que le llega, sus diagnósticos y, si hay cálculo, su resultado: el detalle de la pieza (§7);
  - **sin nada elegido:** las opciones de la vista (capas, rótulos, escala y filtros).
- **Panel inferior (plegado por defecto):** Tablas (las nueve de V2a), Diagnósticos, Combinaciones y Registro.
  - Se abre con su pestaña, al pegar desde Excel o con la herramienta de un tipo de objeto, y entonces ya enseña su tabla.
  - Su altura se puede ajustar.
- **Barra de estado (24 px):** las coordenadas del cursor (en la planta, con la cota), los enganches (V2c), las unidades, la huella, el tamaño del modelo y el núcleo. Lo que hoy dice el pie, más corto.

## 4. Espacios de trabajo y herramientas

| Espacio | Barra de herramientas | Corresponde a |
|---|---|---|
| **Modelo** | Elegir · Ejes, Pilar, Viga, Losa, Muro, Hueco, Forjado, Apoyo, Banda · Copiar a plantas, Mover, Girar, Simetría, Borrar · Plantas, Materiales, Secciones · disposición de vistas | Entrada de pilares y de vigas de CYPECAD; pantalla Modelo de V1/V2a |
| **Cargas** | Caso activo ▾ · Puntual, En barra, Superficie, Lineal, Empuje · Ver: valores, todas o sólo el caso activo · Casos, Combinaciones (sólo lectura) | Cargas de CYPECAD; Define › Load Patterns de SAP2000 |
| **Resultados** | Combinación ▾ (caso, combinación, envolvente, situación) · Deformada, Diagramas (N, Vy, Vz, T, My, Mz), Losas (uz, M11, M22, M12, V13, V23), Pilares (N, ν), Reacciones, Desplomes, Bandas · Escala, Valores, Isolíneas, Animar | Resultados, Isovalores y Deformada de CYPECAD; Display de SAP2000; pantallas Losas, Vigas, Pilares y Desplomes de V1 |
| **Revisión** | Informe · Sensatez · Equilibrio · Firmas · Exportar | Pantalla Revisión de V1; `fem revisar` |

- **Las cuatro pantallas de resultados de V1 pasan a ser modos de Resultados.** El modo se elige en la barra y se ve en cualquier vista. El detalle que daba cada pantalla (el alzado de la viga con su envolvente y sus vanos, el cuadro del pilar por tramos, el perfil de desplomes) pasa a Propiedades al elegir la pieza.
- **Las herramientas de dibujo de Modelo y Cargas** son de V2c. Hasta entonces, cada una abre la tabla de su tipo de objeto en el panel inferior, con una fila nueva: lo mismo que hoy, pero desde donde estará.
- **Lo que no cambia con el espacio de trabajo:** la selección, las vistas abiertas y sus cámaras.

## 5. Vistas

### 5.1 Tipos

- **Planta:** ortográfica desde arriba, con una planta activa.
  - La planta de abajo se puede ver en gris, como la «planta de referencia» de CYPECAD.
  - Se cambia con el desplegable de la cabecera, sus flechas o AvPág y RePág.
- **Alzado:** el plano vertical de un eje de replanteo (o el que pasa por dos puntos), con una profundidad ±d.
  - Es la vista natural de un pórtico: la de SAP2000.
  - Se elige en la cabecera («Alzado · eje A ▾») o pulsando una burbuja de eje en la planta.
- **3D:** en perspectiva o en ortográfica, con órbita.
  - El ViewCube lleva a las vistas estándar: superior, frente, atrás, izquierda, derecha y las cuatro isométricas.
  - Tiene el mismo desplegable de plantas, que resalta una planta (o ninguna) y limitará el rango de plantas que se ven.

### 5.2 Modos de representación

| Modo | Qué dibuja |
|---|---|
| **Alámbrico** | El eje de cada barra y el contorno de cada lámina. Es el modo de los resultados |
| **Sólido** | Las secciones extruidas (§6), con aristas |
| **Translúcido** | El sólido al 35 %, con el alámbrico encima, para ver qué hay dentro |
| **Analítico** | El modelo que se calcula: nudos, malla de láminas, zonas rígidas, diafragmas y enlaces. Es lo que hoy son la vista «malla» y `fem render`. Para quien firma, «ver lo que se calcula» es tan importante como ver el edificio |

### 5.3 Filtros

- **Rango de plantas:** por ejemplo, de N1 a N3, desde la cabecera de la vista.
- **Tipos de objeto:** en las opciones de la vista.
- **Aislar lo elegido (H) y ocultar (Ctrl+H):** como en CYPECAD y en Revit.
- **Caja de sección en 3D** y profundidad del corte en un alzado.

### 5.4 Varias vistas

- **Disposiciones:** 1, 1|1, 1/1 y 2×2, con un clic en la barra o con Ctrl+1…4.
- **Lo que comparten:** la selección, el espacio de trabajo y el resultado activo.
- **Lo que no:** cada vista tiene su cámara, su planta, su modo y su rango.
- **Vista activa:** la del último clic, con el borde resaltado. Las herramientas trabajan en ella.
- **Vistas guardadas:** en el navegador («Alzado eje A», «3D desde el SO»). Se guardan con el proyecto.

### 5.5 Navegación

- **Rueda:** acerca o aleja hacia el cursor.
- **Botón central:** desplaza; con Mayús, orbita alrededor del punto bajo el cursor.
- **Clic:** elige. Arrastrar en vacío elige por ventana, como en CYPECAD y AutoCAD: de izquierda a derecha, lo que queda dentro; de derecha a izquierda, lo que toca.
- **F:** encuadra; Esc suelta.
- **Táctil (V3):** dos dedos para desplazar y acercar, y un dedo para orbitar.
- **Decisión I-e:** se propone esta convención (la de SAP2000, Revit y la mayoría de CAD), no la de CYPECAD.

## 6. El 3D sólido

| Pieza | Cómo se extruye |
|---|---|
| **Pilar** | La sección de cada tramo (rectangular, circular, I del catálogo, T; la `general`, con su b×h si lo tiene), con su giro, desde la cota de su base hasta la cara inferior de la losa de su cabeza |
| **Viga** | Su sección a lo largo de la polilínea, con la cara superior en la del forjado (C1-c). Bajo una losa se dibuja sólo el descuelgue, como pesa (C2-g) |
| **Losa** | El contorno, con sus huecos, extruido con su espesor. El reticular, con nervios y ábacos (antes, la losa con una trama), y el unidireccional, con sus viguetas a su intereje |
| **Muro** | El eje con su espesor y sus huecos |
| **Apoyos** | Un símbolo, no una zapata: la cimentación no está en el modelo y no se dibuja lo que no hay |

- **Una `general` sin b ni h** se dibuja como barra fina con la marca «sección sin forma», nunca con una forma inventada.
- **Color:** por material (hormigón y acero), como en CYPECAD. Opcionalmente, por sección o por planta. La selección va en el color de acento y el resto se atenúa si se aísla.
- **Dónde se calcula:** en el worker, puro (`src/visor/solido.ts`).
  - Da un `Float32Array` por tipo de pieza, las aristas de contorno ya calculadas y un id por triángulo, que lleva al objeto físico.
  - Va por Transferable y nunca hay un objeto de Three.js por pieza (H42).
  - El edificio objetivo son unas 650 piezas y menos de 200 000 triángulos.
- **Validación:** el volumen de cada pieza extruida es A·L de su sección (con el descuelgue en las vigas bajo losa), y la suma por planta coincide con el peso propio esperado de A3 dividido por el peso específico. Es el mismo contraste que A3-1, ahora sobre el dibujo.

## 7. Resultados en 3D

- **Diagramas de barras:**
  - My en el plano local 1-3 (vertical en las vigas) y Mz en el 1-2. Se dibujan del lado de la tracción, con el convenio de H02 escrito en la leyenda;
  - relleno translúcido por signo: azul el positivo y naranja el negativo, que se distinguen también en luminosidad;
  - con una envolvente, las dos curvas;
  - escala automática: el mayor valor visible ocupa 1,5 m, y se puede ajustar;
  - los vértices son los de la consulta (`Consultas.diagrama` para una combinación y `envolventePieza` para una envolvente), nunca una curva suavizada;
  - en la planta (A4 y el visor, desde el 2026-10-12), como en el alzado de la pieza: con la pieza leída en X creciente (o en Y creciente si va más en Y), My > 0 a su derecha (abajo en las vigas en X, a la derecha en las vigas en Y) y My < 0 al otro lado; Vz > 0 a su izquierda. Antes el lado dependía del sentido en que se dibujó la pieza y los positivos de las vigas en X salían arriba.
- **Láminas:** isovalores por bandas sobre losas y muros en 3D, con los colores y los límites de la planta (H43, E5-7), e isolíneas opcionales.
- **Pilares:** N o ν por tramo, como color por bandas, como un mapa de calor (en el prototipo, ν), o como diagrama.
- **Deformada:** con escala, la original en gris y animación opcional.
- **Reacciones:** flechas con su valor en cada apoyo.
- **Rótulos:**
  - sin hacer nada, sólo los extremos de lo que se ve (máximo y mínimo, con su pieza y su combinación);
  - al pasar el ratón, el valor en la estación más cercana, que es una consulta;
  - al elegir una pieza, todos sus valores por vano;
  - con prioridad y sin pisarse (§8).
- **Detalle:** al elegir una viga, Propiedades enseña su alzado con la envolvente, el cursor por estaciones y la tabla por vanos (la pantalla Vigas de V1). Al elegir un pilar, su cuadro por tramos (la pantalla Pilares).
- **Cabecera de la vista:** dice siempre qué se ve: «Gravedad · 1,4·(G + Q) · My en vigas · N1–N3». La leyenda flota en la vista, con bandas y valores.
- **Validez:**
  - si los resultados están desactualizados, la capa de resultados no se pinta: la vista enseña «Resultados desactualizados · Calcular»;
  - si el equilibrio no cuadra o el modelo no compila, se ven el error y los diagnósticos, como en V1.

### 7.1 Adelantado de I4 (2026-10-12)

A petición del usuario, los diagramas de las barras en el 3D y en el alzado, y los isovalores de las losas en el 3D. El resto de I4 (deformada con escala y original, N y ν por tramo como color, reacciones, valor bajo el cursor, detalle en Propiedades y muros con mapa) sigue pendiente.

- **Diagramas en el 3D** (`src/visor/diagramas3d.ts`, sobre `src/agente/render/diagramas.ts`), en Resultados · Diagramas:
  - todas las barras (vigas, viguetas y pilares) o las de la planta de la cabecera, y en la cabecera, «Vigas y pilares», «Vigas» o «Pilares» y la escala (×0,25 a ×4);
  - en los ejes locales de cada tramo: My en el plano x-z y Mz en el x-y, del lado de las tracciones; Vz, N y T hacia +z y Vy hacia +y, con la pieza leída en Z, X o Y crecientes. El selector de esfuerzo gana Mz y Vy (para los pilares);
  - **relleno por signo** (§7): lo positivo de la curva máxima y lo negativo de la mínima; lo de dentro de la envolvente, sólo como línea. La planta de A4 sigue coloreando por curva (máxima y mínima);
  - los valores son los de `envolventeTramo` (la parte de un tramo de `envolventePieza`, A4): los mismos de la planta y del alzado de la pieza, bit a bit;
  - rótulos: el máximo y el mínimo de lo que se ve, con su pieza y su combinación, y los de las piezas elegidas;
  - en N no se dibujan las vigas de un diafragma rígido: su axil no tiene valor (C1-d).
- **Diagramas en el alzado** (`src/agente/render/alzadoDiagramas.ts`, una escena de A4): las barras con sus dos extremos a menos de d del plano y paralelas a él, con el esfuerzo **en el plano**:
  - M, el momento de eje normal al plano (My en las vigas del pórtico, bit a bit; My o Mz en los pilares, según su giro), del lado de las tracciones;
  - V, el cortante en el plano (Vz en las vigas); N y T, como en la pieza;
  - My y Mz del selector dan M; Vz y Vy, V. Rotulados, el máximo y el mínimo de cada pieza.
- **Isovalores en el 3D** (`src/visor/isovalores3d.ts`), en Resultados · Losas:
  - con una planta en la cabecera, su mapa en planta: la misma combinación, los mismos límites, colores y extremos;
  - con todas, una escala común y la combinación del mayor |valor| en todas;
  - bandas sin sombrear, para que el color sea el de la leyenda, con sus isolíneas. Los muros, todavía sin mapa.
- **Validación:**
  - `src/visor/resultados3d.test.ts` en los cuatro proyectos de V1: extremos de cada pieza y de lo que se ve, iguales a los de `envolventePieza`; My > 0 bajo las vigas en el 3D y en el alzado; M del alzado = My de las vigas del pórtico, bit a bit; el 3D de una planta es su mapa (combinación, límites, colores, extremos y área); sin resultados, nada;
  - `validacion/i4/chrome.ts` (`out_chrome.txt`): con el edificio objetivo, Chrome pinta los mismos triángulos y el mismo alzado (sha256) que Node, se orbita a 120 fps con los diagramas o los isovalores y ninguna tarea larga.
- **Tiempos en el worker, con el edificio objetivo:** los diagramas de todas las barras, ~1,2 s la primera vez (luego ~0,2 s, guardados); uz en todas las plantas, ~0,9 s, y M11, ~3,5 s (la recuperación SPR de las siete plantas). Con una planta, la séptima parte.

## 8. Grafismo de la planta y el alzado

- **Jerarquía de líneas:**
  - lo cortado (pilares y muros en planta) va relleno y oscuro;
  - las vigas, con su ancho real: doble línea fina y relleno claro;
  - la losa, con borde de 1,2 px y su fondo, y los huecos con aspa;
  - los ejes, en trazo y punto finos;
  - las cotas, finas, en cadena.
- **Ejes de replanteo:** con burbujas en los dos extremos y cadenas de cotas entre ejes, en la planta y en el alzado (§9).
- **Secciones a escala real** y con su giro. En el alzado, el pilar con el ancho que se ve desde ese lado, la viga con su canto y los empotramientos con su símbolo.
- **Rótulos por nivel de zoom:**
  - con la planta entera, sólo los ejes y lo elegido;
  - al acercarse, ids y secciones;
  - prioridad: lo elegido, luego los extremos y luego los ids;
  - con halo y sin que se pisen: el que no cabe no se dibuja.
- **Color:**
  - divergente azul/naranja para lo que tiene signo, y secuencial de un solo tono para las magnitudes;
  - bandas con sus valores (H43);
  - las dos parejas se distinguen también en luminosidad, para quien no ve bien los colores.
- **Tipografía:**
  - Geist de 13 px de base en la interfaz (hoy, 11 y 12);
  - Geist Mono sólo para números y ids;
  - cuatro tamaños (11, 12, 13 y 15) y coma decimal.
- **Temas:** el lienzo tiene un fondo propio, distinto del de los paneles: gris muy claro en el tema claro y casi negro en el oscuro.

## 9. Ejes de replanteo

Hoy el modelo no tiene ejes de replanteo, y hacen falta para:

- los alzados por eje;
- las burbujas y las cotas;
- los enganches de V2c;
- nombrar posiciones («pilar A-5») en la interfaz y en el informe.

**Propuesta (decisión I-a):**

- `ejes` opcional en `proyecto.json`: id, dos puntos y, si se quiere, las plantas en las que se ven;
- si no hay, el compilador los propone a partir de las alineaciones de los pilares, como `proponerBandas` (D5), y el usuario los acepta o los cambia;
- no entran en el cálculo, así que no cambian la huella del modelo analítico;
- en el prototipo, los ejes son las alineaciones del edificio objetivo: 1–10 según X y A–H según Y.

## 10. Arquitectura técnica

- **Un motor de vistas** (`app/src/vistas/`):
  - el `WebGLRenderer` compartido de hoy (H41) y un solo `<canvas>` para toda la zona de vistas, con cada vista dibujada en su rectángulo (`setViewport` y `setScissor`). Así no se pasa del límite de contextos de Chrome (16);
  - la planta y el alzado, con cámara ortográfica;
  - los rótulos, en un lienzo 2D por encima, recalculado cuando cambia la cámara, con su prioridad y sus colisiones.
- **La planta, en WebGL (decisión I-b):**
  - las primitivas siguen saliendo de la escena de A4, que sigue siendo la fuente;
  - cambia sólo quién las pinta: líneas con grosor (`LineSegments2`, MIT), rellenos y aspas;
  - el criterio de fidelidad de V1 (primitiva a primitiva igual que `fem render`) se mantiene;
  - la alternativa es seguir con SVG en la planta y WebGL en el resto: el grafismo y la selección quedarían distintos en cada tipo de vista.
- **Datos puros en `src/visor/`**, probados en Node como hoy:
  - `solido.ts`: la geometría extruida;
  - `diagramas3d.ts`: los diagramas por barra en coordenadas globales, desde las estaciones de `Consultas`;
  - `ejes.ts`: los ejes propuestos.
- **Elegir:** con una pasada por GPU con ids, sólo al hacer clic o al pasar el ratón, que lleva al objeto físico por el mapeo del compilador.
- **Estado de la interfaz:** paneles, disposición y cámaras en el navegador (localStorage), por proyecto. Las vistas guardadas, en el proyecto.
- **Presupuestos, en el edificio objetivo y en sobremesa:**
  - orbitar el sólido a 60 fps;
  - ninguna tarea larga de más de 50 ms;
  - cambiar de combinación o de esfuerzo en ≤ 0,5 s;
  - pasar de 1 a 4 vistas en ≤ 0,3 s.
- **Accesibilidad:** todo con teclado, contraste AA en los paneles, `aria` en los botones de icono y la selección anunciada.

## 11. Fases

| Fase | Contenido | Criterios de paso |
|---|---|---|
| **I1 Armazón** | Barra superior, espacios de trabajo, barra de herramientas, navegador, propiedades, panel inferior plegable, barra de estado y paleta de órdenes. Todo lo de V1 y V2a, reubicado | Vistas ≥ 70 % de la ventana en 1920×1080 y ≥ 60 % en 1366×768. Ninguna función de V1 ni de V2a perdida: sus tests de DOM, adaptados, siguen pasando |
| **I2 Motor de vistas** | Planta y alzado en WebGL con el grafismo de §8, 3D alámbrico, ViewCube y vistas estándar, 1/2/4 vistas, selección compartida, rótulos por zoom, ejes de replanteo (§9) | Las primitivas de la planta, iguales a las de `fem render`. Orbitar y desplazar a 60 fps y ninguna tarea de más de 50 ms con el edificio objetivo. Elegir en una vista elige en todas y en la tabla |
| **I3 Sólido** | Extrusión de todas las secciones y piezas, modos sólido, translúcido y analítico, filtros y caja de sección | Volumen por pieza = A·L, y por planta, el peso propio esperado de A3. Rendimiento, como en I2 |
| **I4 Resultados en 3D** | Diagramas de barras, isovalores en 3D, deformada, N y ν por tramo, reacciones, detalle de la pieza en Propiedades | Los vértices de cada diagrama son los de su consulta, bit a bit, y cada rótulo, una consulta. Con el modelo cambiado, no se pinta ningún resultado (criterio 3 de V1) |

- **Orden propuesto (decisión I-f):** I1 → I2 → I3, y después V2b (muros, forjados y bandas en tablas) y V2c (dibujo con el ratón). V2c necesita la barra de herramientas, los ejes y el motor de vistas con enganches. I4 puede ir en paralelo con V2b.
- **Cada fase deja la app usable** y desplegada en GitHub Pages, como hoy.

## 12. Decisiones del usuario

| | Pregunta | Propuesta |
|---|---|---|
| **I-a** | Ejes de replanteo | **Decidido (2026-10-12):** objeto del modelo, opcional, y propuestos desde los pilares si no los hay (§9) |
| **I-b** | ¿Quién pinta la planta? | **Decidido (2026-10-12):** WebGL, como el 3D y el alzado; la escena de A4 sigue siendo la fuente (§10) |
| **I-c** | Espacios de trabajo | **Decidido (2026-10-12):** Cuatro: Modelo, Cargas, Resultados y Revisión (§4) |
| **I-d** | Fondo del lienzo | **Decidido (2026-10-12):** Claro por defecto, con tema oscuro, y no negro siempre como en CYPECAD |
| **I-e** | Navegación con el ratón | **Decidido (2026-10-12):** La de SAP2000, Revit y la mayoría de CAD (§5.5) |
| **I-f** | Orden | **Decidido (2026-10-12):** I1–I3 antes de V2b y V2c (§11) |
| **I-g** | Nombres de las piezas | **Decidido (2026-10-12):** se numera como CYPECAD (§12.1) |
| **I-h** | Densidad | **Decidido (2026-10-12):** 13 px de base y paneles plegables, sin modo compacto por ahora |

### 12.1 Numeración como CYPECAD (I-g)

- **Los ids nuevos ya son cortos:** el editor de V2a da `P1`, `V1`, `L1`… al crear (`idNuevo`). Se mantiene.
- **Orden «Renumerar»** (`src/editor/`, pura, con su inversa y un solo deshacer), como la de CYPECAD:
  - los pilares quedan `P1…Pn` por su posición en planta: por filas de arriba abajo y, en cada fila, de izquierda a derecha, con la tolerancia de las alineaciones (la misma que propone los ejes);
  - las vigas, `V1…Vn`, por plantas de abajo arriba y en cada planta por la misma regla, con el punto medio de cada una;
  - losas, muros y paños, igual, con su centroide.
- **Integridad:** renombrar ya cambia todas las referencias (V2a). Si un objeto tiene `nombre`, no se toca: el rótulo enseña el `nombre` si lo hay y, si no, el id.
- **Nunca de forma automática:** sólo cuando el usuario lo pide, porque cambia el proyecto y su huella, y los resultados guardados dejan de valer. Los proyectos de validación conservan sus ids (`P-x24-y0`), que son los de sus referencias congeladas.
- **Copiar a plantas** sigue dando ids nuevos con la planta de destino. Después, «Renumerar» los deja cortos.
- **Hecho el 2026-10-12** (adelantado a petición del usuario): `src/editor/renumerar.ts` y la operación `{ op: "renumerar" }`, con el botón «Renumerar» en la barra de Modelo, que enseña qué cambia antes de hacerlo. Prefijos: `P`, `V`, `L`, `F` (paños) y `M` (muros); un número que ya es el id de otro objeto se salta. En el edificio objetivo da la misma malla (las barras sólo cambian de orden, porque van por el id de su pieza, y algún nudo se mueve un ulp): `renumerar.test.ts`.
- **Axiles de pilares (`pilares-n`)**, en el mismo cambio: la huella del pilar a escala, del color del signo, en vez de un círculo en píxeles proporcional a |N|, y el rótulo con el pilar y su mayor |N| (el mínimo y el máximo, en el cuadro de la planta).

## 13. I1: lo que se fija al empezar

El armazón de §3 y §4 con el lienzo de hoy: la planta sigue en SVG y el 3D sigue siendo el de V1 hasta I2. Lo que cambia es dónde está cada cosa, no qué se calcula ni qué se enseña.

- **Disposición común** (`app/src/armazon/`): barra superior, barra de herramientas del espacio, navegador, vista, propiedades, panel inferior y barra de estado.
  - Cada espacio de trabajo da el contenido de cada hueco.
  - El navegador y las propiedades se pliegan a un carril. El panel inferior se pliega a sus pestañas y su altura se ajusta.
  - Cómo se dejan se recuerda en el navegador (localStorage), por espacio y por modo.
- **Por defecto:**
  - **Modelo y Cargas:** el navegador abierto y las propiedades plegadas. Se abren solas al elegir un objeto.
  - **Resultados y Revisión:** las propiedades abiertas.
  - **Panel inferior:** plegado, salvo en un proyecto sin pilares, que abre las tablas.
- **Qué va en cada sitio:**

| Espacio | Barra | Navegador | Vista | Propiedades | Panel inferior |
|---|---|---|---|---|---|
| **Modelo** | Pilar, Viga, Losa y Apoyo (abren su tabla en la fila nueva) · A plantas y Borrar (lo elegido) · Plantas, Materiales y Secciones · Planta o 3D | Proyecto, plantas y objetos por tipo (los de la planta activa) | Planta (modelo, diagnósticos o malla) o 3D | Lo elegido (formulario o datos) o, sin nada, la planta: resumen, cargas por caso, equilibrio e hipótesis | Tablas, Diagnósticos y Combinaciones |
| **Cargas** | Caso activo · Nueva carga · Casos | Proyecto, plantas y casos | Planta con las cargas del caso activo | Como en Modelo | Como en Modelo |
| **Resultados** | Combinación · Losas, Diagramas, Pilares, Deformada · magnitud o esfuerzo del modo · escala | Plantas y, en Diagramas, las vigas de la planta | Lo de las pantallas de V1 | Losas: valor en el punto, extremos y flechas. Diagramas: la pieza, la estación y los vanos. Pilares: el pilar elegido por tramos. Deformada: desplomes y perfil | Combinaciones. Diagramas: el alzado de la pieza con su cursor. Pilares: el cuadro de la planta |
| **Revisión** | Estado de la firma · copiar la orden de firmar | Índice del informe | El informe | Firma, identidad y comprobaciones | — |

- **Cambio respecto a §7:** el alzado de la viga elegida va en el panel inferior y no en Propiedades. Con 300 px de ancho no se lee un diagrama de 50 m.
- **Sin botones que no hacen nada:**
  - las herramientas de V2b y V2c (Ejes, Muro, Hueco, Forjado, Banda, Mover, Girar y Simetría) no salen hasta que existan;
  - Reacciones y Bandas no salen en Resultados hasta I4;
  - las disposiciones de 2 y 4 vistas, hasta I2.
- **Teclado:**
  - Ctrl+K abre la paleta de órdenes: espacios, modos, plantas, tablas, cualquier objeto por su id, calcular, guardar, deshacer, tema y paneles;
  - AvPág y RePág cambian de planta;
  - Esc suelta lo elegido;
  - Ctrl+S, Ctrl+Z y Ctrl+Y, como en V2a.
- **Estilo:**
  - 13 px de base, con las clases de paneles y tablas un punto más grandes;
  - el acento, azul (#2563eb en claro, #5b9bff en oscuro);
  - el lienzo, con un fondo propio, distinto del de los paneles.

  El grafismo del dibujo no cambia: es de I2.

### 13.1 Criterios de paso de I1

1. **El dibujo manda.** En Modelo, con los paneles por defecto y nada elegido, la vista ocupa ≥ 70 % de la ventana en 1920×1080 y ≥ 60 % en 1366×768. Se mide en Chrome (`validacion/i1/chrome.ts`).
2. **No se pierde nada de V1 ni de V2a:**
   - los tests de DOM de V1 y V2a (criterios 1 y 3) pasan, cambiando sólo cómo se llega a cada pantalla o tabla;
   - los bancos de Chrome de V1 y V2a se adaptan a los nuevos sitios y dan los mismos resultados (los mismos bits, huellas y sha256);
   - hay una lista, en el informe, de cada función de las pantallas de V1 y V2a y de dónde está ahora.
3. **Lo que no vale nunca se enseña como válido:** las mismas reglas que en V1 (resultados desactualizados al primer cambio, respuestas viejas descartadas por su huella). Resultados y Revisión no se abren sin un cálculo de esta huella.
4. **Fluidez:** cambiar de espacio, de modo o de panel no da tareas largas de más de 50 ms en el edificio objetivo.

## 14. I2: lo que se fija al empezar

El motor de vistas de §5 y §10 con el grafismo de §8 y los ejes de §9. Lo que se dibuja de la planta sigue saliendo de la escena de A4; cambia quién lo pinta (WebGL en vez de SVG) y se añaden el alzado, el 3D alámbrico del modelo físico y las vistas múltiples.

- **Motor de vistas** (`app/src/vistas/`), fuera de React (H41) y alimentado por efectos:
  - un `WebGLRenderer` con stencil y antialias y un solo `<canvas>` para toda la zona de vistas; cada vista se pinta en su rectángulo (`setViewport` y `setScissor`);
  - encima, un lienzo 2D para lo que tiene tamaño en píxeles: glifos, rótulos, la ventana de elegir y el ViewCube;
  - se pinta sólo cuando algo cambia;
  - sin WebGL (jsdom, un navegador sin él) la vista lo dice y todo lo demás sigue funcionando.
- **La planta en WebGL** (I-b):
  - el worker pasa la escena de A4 a búferes (`src/visor/escena.ts`, puro): por capa (las mismas de V1: primitivas seguidas con el mismo estilo), los abanicos de triángulos de sus anillos y los segmentos de sus contornos y líneas; glifos y textos, tal cual;
  - los rellenos van por stencil (par-impar en las áreas y «nonzero» en las bandas de isovalores): la misma regla que el SVG, sin triangular, así que no puede fallar con un polígono raro;
  - las coordenadas, en Float32 respecto al centro de la caja de la escena, para no perder precisión;
  - las líneas, con grosor en píxeles (`LineSegments2` de Three.js, MIT).
- **Grafismo de §8, en la escena de A4** (y por tanto también en `fem render`):
  - ejes de replanteo con burbujas en los dos extremos, en todas las vistas de planta, y cadenas de cotas entre ejes paralelos en la vista `modelo`;
  - huecos de losa con aspa;
  - vigas con relleno claro y borde fino, y losas con borde de 1,2 px; lo cortado (pilares y muros que llegan) sigue relleno y oscuro;
  - cada rótulo lleva su clase (`eje`, `cota`, `id` o `dato`) para el zoom. `fem render` no la usa.
- **Rótulos por zoom:**
  - los de los ejes y los datos (cargas, diagnósticos, extremos, valores), siempre;
  - las cotas, desde 10 px/m; los ids y las secciones, desde 40 px/m o si su objeto está elegido;
  - prioridad: lo elegido, después la de A4; con halo y sin pisarse, con la misma regla de A4 (el que no cabe no se dibuja), medidos con la fuente de verdad.
- **Ejes de replanteo** (§9, I-a):
  - `ejes` opcional en el modelo físico: id, nombre opcional y dos puntos (`desde` y `hasta`). Las plantas en las que se ven, más adelante;
  - no entran en la huella ni en el cálculo: el compilador los ignora;
  - si no hay, se proponen (`src/compilador/ejes.ts`) con las alineaciones de pilares de las bandas (C5-b), en la dirección del eje 1 de la primera losa (X si no hay losas) y en la perpendicular: números a lo largo de la primera y letras a lo largo de la segunda, de menor a mayor coordenada, y de lado a lado de los pilares con 2 m de más;
  - el editor tiene una tabla Ejes (la décima). Sin ejes en el proyecto, se ven los propuestos y la tabla ofrece guardarlos (un solo deshacer).
- **Alzado** (`src/agente/render/alzado.ts`, una escena de A4 en coordenadas u, z):
  - el plano vertical de un eje, con una profundidad ±d (0,5 m por defecto);
  - las cotas de las plantas, los ejes que lo cruzan con sus burbujas, los pilares y muros a menos de d con el ancho que se ve desde ese lado, las vigas paralelas con su canto (cara superior en la planta), las que lo cruzan cortadas, las losas cortadas con su espesor y los apoyos;
  - se elige con el ratón como en la planta.
- **3D alámbrico del modelo físico** (`src/visor/alambrico.ts`, puro): el eje de cada pilar, viga y muro y el contorno de cada losa, paño y muro, con el objeto de cada segmento. Se dibuja aunque el modelo no compile, como la planta.
  - Modos de I2: alámbrico y analítico (la malla de V1, para no perder lo que daba el 3D de Modelo). Sólido y translúcido son de I3.
  - La deformada de Resultados pasa a este motor, sobre el analítico.
  - Perspectiva u ortográfica, y ViewCube con las seis vistas y las cuatro isométricas.
- **Vistas:**
  - planta, alzado y 3D, en 1, 1|1, 1/1 o 2×2 (barra de Modelo y Ctrl+1…4);
  - cada vista tiene su tipo, su planta o su eje, su modo y su cámara; la activa (la del último clic) va con el borde de acento y es la que siguen AvPág y RePág y la barra de estado;
  - las vistas no cambian con el espacio de trabajo. En Resultados, una planta enseña lo del modo (Losas, Diagramas o Pilares) y un 3D, la deformada en su modo; un alzado, el modelo. Si el modo no tiene dónde verse, la vista activa cambia de tipo;
  - disposición, vistas y cámaras se recuerdan en el navegador, por proyecto.
- **Navegación** (§5.5, I-e):
  - la rueda hacia delante acerca hacia el cursor, y hacia atrás aleja (como en AutoCAD y SAP2000); el botón central (o el derecho) desplaza y, con Mayús, orbita alrededor del punto bajo el cursor;
  - la barra de la vista tiene Encuadrar (F), Desplazar y Orbitar con el botón izquierdo (para el panel táctil), y en 3D, la proyección;
  - clic elige; Ctrl+clic añade o quita; arrastrar elige por ventana (de izquierda a derecha, lo que queda dentro; de derecha a izquierda, lo que toca); Esc suelta;
  - doble clic en un eje abre su alzado en otra vista.
- **Selección compartida:**
  - la del visor pasa a ser una lista; la última elegida es la principal (la del inspector);
  - elegir en una vista elige en todas, en el navegador y en la tabla;
  - con varias, Propiedades da la lista por tipo, y Borrar y A plantas trabajan con todas;
  - en Resultados, el clic sigue siendo el de cada modo (el valor del punto, la viga o el pilar).
- **Fuera de I2:** sólido, translúcido, filtros, rango de plantas, aislar y caja de sección (I3); resultados en 3D y en el alzado, y el valor bajo el cursor (I4); vistas guardadas en el proyecto (I3); táctil (V3); la planta de abajo en gris.

### 14.1 Criterios de paso de I2

1. **Las primitivas de la planta, iguales a las de `fem render`.** En los cuatro proyectos de V1 y en todas las vistas de planta, los búferes que pinta el visor son, capa a capa y en orden, los vértices de las primitivas de la escena de `fem render` (en Float32 respecto al centro), con su estilo, y ningún glifo ni texto se pierde. En Chrome, los búferes que llegan al motor tienen el mismo sha256 que en Node.
2. **Fluidez, con el edificio objetivo en sobremesa:** orbitar el 3D y desplazar y acercar la planta a 60 fps (la mediana del intervalo entre fotogramas ≤ 17 ms) y ninguna tarea larga de más de 50 ms; pasar de 1 a 4 vistas en ≤ 0,3 s.
3. **Elegir en una vista elige en todas y en la tabla:** un clic en la planta, en el alzado y en el 3D, una ventana y Ctrl+clic dan la misma lista en las cuatro vistas, en el navegador y en las filas de la tabla.
4. **Lo nuevo, validado en Node:**
   - ejes: la propuesta no depende del orden de las listas ni de una traslación o un giro de la planta, y los ejes no cambian la huella;
   - alzado: lo dibujado es lo del modelo (pilares con su posición, su ancho visto y sus cotas; vigas con su canto; losas con su espesor);
   - 3D alámbrico: cada segmento es de su objeto, con su cota.
5. **No se pierde nada de I1:** los tests de DOM de V1 y V2a pasan, y los bancos de Chrome de V1, V2a e I1, adaptados, dan los mismos resultados.
