# V2c: dibujar el modelo con el ratón (plan)

> **Fecha:** 2026-10-23. **Estado:** decidido por el usuario el 2026-10-23 (§6.1), salvo V2c-d, que se decide al empezar V2c-3. **V2c-1 hecho el 2026-10-23** (§7). **V2c-2 hecho el 2026-10-26** (§8). **V2c-3 hecho el 2026-10-26** (§9). **V2c-4 hecho el 2026-10-26** (§10 y §11).
>
> **Origen:** el usuario pide adelantar V2c a la puerta de uso de F y AB. Con las tablas sólo se modela bien si ya se tienen las coordenadas: «no sé cómo modelarlo yo si no». Se sustituye así el orden de `visor.md` (V-e: primero tablas y luego el ratón) y el de `CLAUDE.md` («con lo que salga, V2c»). La puerta de uso de F y AB va después de V2c, y con ella la fase MA.

## 1. Lo que hay hoy

Repaso del código del 2026-10-23.

- **Barra de Modelo y de Cargas** (`app/src/espacios/Modelo.tsx`):
  - Pilar, Viga, Muro, Apoyo, Apoyo lineal, Forjado, Ejes y Nueva carga abren su tabla con una fila nueva (`abrirTabla`).
  - No existe la idea de herramienta activa. Lo más parecido es el pseudomodo `eligiendo: "copiar" | "borrar"`.
- **Vistas** (`app/src/vistas/`):
  - `Motor.poner` reparte pointerdown, move, up, dblclick y wheel a cada `Vista`.
  - La planta convierte las coordenadas con `aModelo`/`aPx` (`vista2d.ts`).
  - Elegir es una consulta al worker sobre la escena de A4 (`elegir`, `ventana`).
  - En 2D no hay nada al pasar el ratón (`pasar` no hace nada) y no hay enganches.
  - Hay un lienzo 2D encima, que se repinta en cada fotograma (`superponer`), y las coordenadas del cursor salen en el pie.
- **Editor** (`src/editor/`):
  - Operaciones puras: `crear`, `cambiar`, `borrar`, `convertir`, `lote`, `renumerar`, `copiarAPlantas`, `vigasBorde` y `abacos`. Se validan con el esquema y sin referencias rotas, y se deshacen por instantáneas.
  - Los ids nuevos salen de `idNuevo` (P, V, L, F, M…).
  - `mover` reordena listas; no desplaza geometría. No hay mover, girar ni simetría geométricos.
- **El modelo en edición está en el hilo principal** (`proyecto.edicion.proyecto.modelo`): los enganches se pueden calcular allí, sin ir al worker.
- **Pruebas:**
  - Los tests de DOM no montan las vistas (jsdom no tiene WebGL).
  - Los bancos de Chrome (`validacion/i2/chrome.ts`) ya simulan el ratón sobre la vista con `PointerEvent` y `aPx`.

## 2. Qué se propone

Se dibuja en la **planta** (la vista de trabajo, como en CYPECAD) y en cualquier vista de planta abierta. El alzado y el 3D siguen para ver y elegir.

### 2.1 La herramienta activa

- Una herramienta activa por espacio de trabajo: **Elegir** por defecto; Esc vuelve a ella.
- Cada herramienta de dibujo lleva su **plantilla** en Propiedades, mientras está activa:
  - planta: la de la vista;
  - sección, material, espesor;
  - desde y hasta (pilares y muros);
  - caso y valor (cargas).
  - Es lo que en CYPECAD pide el diálogo antes de colocar, pero sin diálogo: se cambia en el panel y vale para los siguientes.
- **Una acción, un paso de deshacer.** Cada objeto colocado es una operación `crear`, o un `lote`.
- Después de dibujar, la compilación sin cálculo de siempre da los diagnósticos, como al editar una tabla. (El «150 ms» de este plan era la pausa antes de compilar: compilar el edificio objetivo con vigas tarda ~3,3 s. Desde el 2026-10-24 lo dibujado sale en ~0,3 s sin esperar a la compilación: `visor.md` §6.1.)

### 2.2 Los enganches

Se calculan en el hilo principal desde el modelo físico de la planta activa. Son puros (`src/editor/dibujo/enganches.ts`) y se prueban sin DOM.

- **Puntos**, de más a menos prioridad:
  1. Punto fijo y centro de los pilares, esquinas de su huella.
  2. Extremos y vértices de vigas, muros, apoyos lineales, contornos de losas, paños y huecos.
  3. Cruces de ejes de replanteo entre sí y con vigas y muros.
  4. Puntos medios.
  5. El punto de una cara de pilar en la prolongación del cursor.
  6. Perpendicular a una recta.
  7. El más cercano sobre una recta.
- **Radio:** 10 px en pantalla, que no depende del zoom.
- **El punto enganchado es el del rasgo exactamente**, bit a bit. Así el compilador une sin tolerancias, y no hay ajustes ni avisos de ε_snap por dibujar.
- **Ortogonal (F8)** y **ángulos de los ejes:**
  - el segmento en curso se fija a 0°/90° de los ejes de la losa (o de los de replanteo), y a 45° con Mayús;
  - la longitud se teclea.
- **Marcador:** un símbolo por tipo de enganche (cuadrado, triángulo, cruz…), con su nombre en la barra de estado. Se pueden desactivar por tipo, como el «referencia a objetos» de los CAD.
- **Al pasar el ratón**, se resalta lo que hay debajo (también con Elegir). Hoy esto sólo existe en el 3D.

### 2.3 Lo que se teclea

Mientras una herramienta pide un punto, teclear abre un campo junto al cursor:

| Se teclea | Significa |
|---|---|
| `x, y` | Coordenadas absolutas |
| `@dx, dy` | Relativas al último punto |
| `@L<ángulo` | Polares, en grados desde el eje 1 de la losa |
| `L` | Longitud en la dirección del cursor, con el ortogonal |

Intro acepta, Esc anula el punto en curso y Retroceso quita el último vértice.

### 2.4 Herramientas

| Herramienta | Cómo se dibuja | Qué crea |
|---|---|---|
| **Ejes** | Dos clics; o «Proponer ejes» (los de `compilador/ejes.ts`, que ya existen) | `ejes` (fuera de la huella) |
| **Pilar** | Un clic. Con ventana, uno en cada cruce de ejes de dentro. El punto fijo y el giro, en la plantilla | `pilares` |
| **Viga** | Polilínea: clic a clic, y doble clic o Intro termina. Si nace o acaba en un pilar, en su punto fijo, o en la cara (V2c-b) | `vigas` |
| **Losa / Forjado** | Polígono a clics; o **un clic dentro de un recuadro cerrado** por vigas, muros o bordes (V2c-c), que da el contorno hasta los ejes | `losas` o `panos` |
| **Hueco** | Polígono o rectángulo dentro de una losa, un paño o un muro (en alzado) | `huecos` de su objeto |
| **Muro** | Polilínea, como una viga, con el espesor centrado o a una cara | `muros` |
| **Apoyo / Apoyo lineal** | Un clic / polilínea | `apoyos`, `apoyosLineales` |
| **Puntual** | Un clic | `cargas` |
| **Lineal** | Polilínea | `cargas` |
| **Superficie** | Un clic en una losa (toda); o un polígono (zona) | `cargas` |
| **En barra** | Un clic en una viga (toda); o dos (desde, hasta) | `cargas` |
| **Empuje** | Un clic en un muro y su lado | `cargas` |

Las tablas siguen, y lo dibujado sale en ellas al momento.

### 2.5 Editar con el ratón

- **Mover, Copiar, Girar y Simetría**, sobre lo elegido:
  - punto base y destino (o ángulo, o eje de simetría), con enganches y teclado;
  - con sus cargas;
  - en la planta activa o en las que se elijan.
- **Pinzamientos:** al elegir un objeto, sus vértices se pueden arrastrar con enganches (extremo de una viga, vértice de una losa, posición de un pilar).
- **Vigas unidas a un pilar** (V2c-d): al mover un pilar, los extremos de las vigas que acaban en su punto se mueven con él, como en CYPECAD.
- Todo son operaciones puras nuevas (`src/editor/transformar.ts`): un `lote` de `cambiar` y `crear` que se valida como cualquier otro.

### 2.6 Arquitectura

```
src/editor/dibujo/            (puro, sin DOM)
  enganches.ts   el índice de rasgos de una planta, el enganche de un punto
  herramientas.ts  una máquina de estados por herramienta: eventos → borrador → Operacion
  recuadros.ts   el recuadro cerrado alrededor de un punto (para Losa y Superficie)
src/editor/transformar.ts     mover, copiar, girar, simetría y pinzamientos → Operacion
app/src/dibujo/               la herramienta activa, la plantilla en Propiedades, el campo de teclado
app/src/vistas/vista2d.ts     pasar → enganche → marcador y borrador en el lienzo 2D
```

- La herramienta recibe los eventos de la vista ya en coordenadas del modelo y enganchados.
- Devuelve el borrador (lo que se pinta en el lienzo 2D) y, al terminar, una `Operacion`.
- Así **todo lo que decide qué se crea se prueba en vitest con secuencias de eventos**, sin navegador. Chrome sólo prueba que la vista entrega los eventos y pinta lo que la herramienta dice.

## 3. Tramos

| Tramo | Qué | Por qué en ese orden |
|---|---|---|
| **V2c-1** | Herramienta activa, enganches, marcador, al pasar el ratón, ortogonal, teclado, barra de estado. Herramientas Ejes, Pilar y Viga | Con ejes, pilares y vigas ya se puede dibujar el esqueleto de un edificio |
| **V2c-2** | Losa y Forjado (con el recuadro cerrado), Hueco, Muro, Apoyos y las cinco cargas | Completa la entrada del modelo |
| **V2c-3** | Mover, Copiar, Girar, Simetría, pinzamientos y vigas unidas a los pilares | Corregir sin borrar y volver a dibujar |
| **V2c-4** (si se decide, V2c-e) | Un DXF de fondo, en gris, con enganches a sus líneas y vértices | Calcar la planta del arquitecto, como las plantillas DXF de CYPECAD |

La puerta de uso de V2c va al final de V2c-3 (o de V2c-4), y se puede juntar con la de F y AB: el mismo proyecto real, dibujado desde cero y calculado.

## 4. Criterios de paso

1. **Las herramientas son puras y dan lo que daría la tabla.** Por cada herramienta, secuencias de eventos de prueba dan la `Operacion` esperada, y el proyecto resultante es igual al hecho con las tablas (vitest).
2. **El enganche es exacto.**
   - El punto devuelto es, bit a bit, el del rasgo.
   - La prioridad es la de §2.2.
   - El radio en px no depende del zoom.
   - Lo dibujado sobre lo enganchado compila sin avisos de ε_snap ni ajustes (C2-b).
3. **Rehacer los modelos de A2 dibujándolos.** Un banco de Chrome dibuja con eventos de ratón y teclado la retícula con núcleo y el edificio objetivo de una planta, desde los ejes. Tras «Renumerar» en los dos, la huella es la del proyecto de referencia (también renumerado).
4. **Deshacer:** una acción, un paso. Deshacer todo deja el proyecto de partida byte a byte.
5. **Fluidez:** en el edificio objetivo (80 pilares por planta, 7 plantas), el enganche al mover el ratón tarda ≤ 2 ms en Chrome y el banco no tiene tareas largas.
6. **Nada se rompe:** los bancos de I1–I4, V1, V2a y V2b, con los mismos bits.
7. **Puerta de uso (del usuario):** dibujar desde cero un proyecto suyo real, calcularlo y revisarlo.

## 5. Lo que queda fuera

- Dibujar en el alzado (salvo los huecos de muro) y en el 3D. Las plantas de un pilar van en su plantilla.
- Cotas y textos del usuario, capas, impresión.
- Arriostramientos (la «Cruz» de `cimentacion-y-arriostramientos.md`), con su fase.
- Móvil y táctil (V3).

## 6. Decisiones del usuario

| # | Decisión | Propuesta |
|---|---|---|
| **V2c-a** | Tramos y orden (§3), y si la puerta de uso va al final | V2c-1 → V2c-2 → V2c-3, la puerta de uso al final y junto con la de F y AB |
| **V2c-b** | Vigas que llegan a un pilar | Por defecto, eje a eje (el punto fijo, como hoy), con la opción en la plantilla de alinearla a una cara del pilar (el eje se desplaza b/2), como «ajustar a cara» de CYPECAD |
| **V2c-c** | Losas por clic en un recuadro cerrado | Sí, además del polígono: el contorno por los ejes de las vigas y muros que lo cierran, y por los bordes enrasados |
| **V2c-d** | Mover un pilar arrastra las vigas que acaban en él | Sí, como CYPECAD; con Ctrl, el pilar solo |
| **V2c-e** | DXF de fondo para calcar (V2c-4) | Por decidir: necesita un lector de DXF con licencia admitida, que se iba a elegir en MA6 |

### 6.1 Decidido por el usuario (2026-10-23)

- **V2c-a:** V2c-1 → V2c-2 → V2c-3, con la puerta de uso al final, junto con la de F y AB.
- **V2c-b:** eje a eje por defecto, con la opción de alinear la viga a una cara del pilar en la plantilla.
- **V2c-c:** recuadro cerrado y polígono.
- **V2c-e:** sí, el DXF de fondo como V2c-4, después de V2c-3. El lector de DXF se elige al empezar V2c-4 (lo que se iba a decidir en MA6).
- **V2c-d** (mover un pilar arrastra sus vigas): **decidida el 2026-10-25 con la fase CT** (`cotas.md`, CT-d): sí, como CYPECAD, y con Ctrl el pilar solo.

## 7. V2c-1 hecho (2026-10-23)

La herramienta activa, los enganches, el marcador, lo que hay bajo el cursor, el ortogonal, el teclado y la barra de estado, con las herramientas Ejes, Pilar y Viga.

### 7.1 Qué hay

- **`src/editor/dibujo/`** (puro, sin DOM):
  - `enganches.ts`: el índice de rasgos de una planta (lo que dibuja la vista `modelo`: pilares que llegan o arrancan, vigas, muros, apoyos lineales, losas, paños y los ejes del modelo o los propuestos), `enganchar` con la prioridad de §2.2, `ortogonal` (0°/90° de los ejes de la losa de la planta o, sin losas, del primer eje de replanteo; 45° con Mayús), `apuntar` (un enganche gana al ortogonal) y `bajoCursor`.
  - `teclado.ts`: `x; y`, `@dx; dy`, `@L<ángulo` y una longitud. Los dos números se separan con «;», espacios o «, »; la coma sin espacio es la decimal, como en las tablas, y «3.5,4.2» también vale.
  - `herramientas.ts`: Ejes, Pilar y Viga como máquinas de estados (`paso`, `borrador`, `ayuda`). Lo terminado es una `Operacion` (una acción, un paso de deshacer).
- **`app/src/dibujo/`**: `controlador.ts` (la herramienta activa fuera de React: mover el ratón no pasa por un render) y `Plantilla.tsx` (la plantilla en Propiedades y el campo de teclado junto al cursor).
- **Vistas:** `Vista2D.dibujo` recibe el cursor, los clics y la ventana en m y pinta encima el resaltado, el borrador y el marcador; un clic o una ventana que no usa (con Elegir) va a elegir, como antes. La barra de estado dice el enganche («Centro (P-x18-y5)», «Cruce (H)», «Ortogonal»).
- **Barra de Modelo:** Ejes, Pilar y Viga son herramientas (antes abrían su tabla); un segundo clic o Esc sin nada en curso vuelve a Elegir. La tabla, desde la plantilla.

Cómo se comporta cada herramienta:

- **Ejes:** dos clics. Se llama con la letra o el número siguiente según vaya como los ejes con letra o como los numerados de `compilador/ejes.ts`. **El primero que se dibuja sin ejes en el modelo guarda también los propuestos** (V2c1-3); «Proponer ejes» los guarda sin dibujar.
- **Pilar:** un clic pone su punto fijo donde se hace clic; una ventana, uno en cada cruce de ejes de dentro, por filas de arriba abajo y de izquierda a derecha. Plantilla: desde (por defecto, la planta más baja), hasta (por defecto, la de la vista), sección, giro y punto fijo. Donde ya hay un pilar que comparte plantas, no pone otro (el doble clic no duplica).
- **Viga:** polilínea; doble clic o Intro termina, Retroceso quita el último punto, Esc anula. Plantilla: sección y alinear (V2c-b): eje a eje (por defecto) o con la cara izquierda o derecha, según el sentido del dibujo, en la de los pilares de sus extremos.
- **Sección nueva** desde la plantilla, rectangular b × h en cm («P30x30», «V30x50»), sin ir a la tabla. La de por defecto es la más usada por su tipo de objeto.

### 7.2 Criterios

| # | Criterio | Resultado |
|---|---|---|
| 1 | Las herramientas dan lo que daría la tabla | **Pasa.** `dibujo.test.ts`: pilar con giro y punto fijo, y viga de tres puntos, iguales byte a byte a la fila de la tabla con esos valores |
| 2 | El enganche es exacto | **Pasa.** El punto de un rasgo es el del modelo (los mismos doubles); los cruces y las proyecciones sobre rectas paralelas a X o a Y, con sus números (V2c1-1); prioridad por niveles; radio de 10 px a 5, 50 y 500 px/m; una retícula dibujada (ventana de pilares, vigas por los pilares, una viga en T por el punto medio y la perpendicular) compila sin `losa/ajuste`, `topologia/casi-encuentro`, `topologia/fusion` ni `topologia/nudos-proximos` |
| 3 | Rehacer los modelos de A2 dibujándolos | **A medias, como estaba previsto:** lo de V2c-1. El banco (`validacion/v2c/chrome.ts`) dibuja con eventos de ratón y teclado una planta del edificio objetivo desde los ejes (18 ejes tecleados, 80 pilares con un clic, 18 vigas de pilar a pilar con el ratón y 63 secundarias tecleadas) y, tras «Renumerar», su huella es la de la referencia renumerada. Las losas y la retícula con núcleo (muros), con V2c-2 |
| 4 | Deshacer | **Pasa.** En el banco, 180 pasos (18 ejes + 80 pilares + 81 vigas + Renumerar) y, deshecho todo, la huella de partida; en vitest, deshacer todo devuelve el mismo objeto |
| 5 | Fluidez | **Pasa.** Edificio objetivo, planta N3, Viga: enganche de 0,1 ms de mediana y 0,2 ms p95 (máx. ≤ 1,2 ms); el índice de la planta, 3,7 ms la primera vez; 120 movimientos sin tareas largas |
| 6 | Nada se rompe | **Pasa.** I1, I2, I3, I4, V1 y V2a dan los mismos bits. Sus fallos son de tiempo y salen igual en el commit anterior, medido en un worktree alternando con este (I2: una tarea larga de 83 / 76 ms al pasar a cuatro vistas; V1: abrir con `.fem/` 3,39 / 3,46 s y M11 1,16 / 1,12 s; V2a: diagnósticos 3,4 / 3,3 s, desde que el edificio compila en ~3 s). El banco de V2b se para antes y después porque busca la pestaña «Losas», que es «Forjados» |
| 7 | Puerta de uso | Del usuario, al final de V2c |

### 7.3 Hallazgos

- **V2c1-1, el cruce de dos ejes no daba sus números.** El cruce de un eje según X con uno según Y, por el parámetro de la recta, sale 6,000000000000001 en vez de 6. Con una recta paralela a X o a Y se toma su coordenada tal cual (también en la proyección del punto más cercano y de la perpendicular). Sin esto, los pilares dibujados en los cruces no tendrían los números de la tabla y el criterio 3 no pasaría.
- **V2c1-2, el orden de la lista de pilares (corregido el 2026-10-23).** El informe decía que el orden de los pilares cuenta en la huella; no es así: la huella ordena por id también los pilares (`fisicoCanonico`), y con la lista invertida la huella y el modelo analítico salen idénticos en la vivienda, el muestrario y el edificio objetivo. Lo que sí pasaba es que, tras «Renumerar», la tabla de pilares quedaba en el orden en que se dibujaron. **Decidido por el usuario:** «Renumerar» deja también la lista de pilares en el orden de sus números, P1…Pn (`renumerar` en `renumerar.ts`; las demás listas no se reordenan). Si los ids ya son los cortos y sólo está revuelta la lista, el diálogo ofrece ordenarla, sin cambiar la huella. Prueba en `renumerar.test.ts`.
- **V2c1-3, el primer eje.** Sin ejes en el modelo, se ven los propuestos; si el primer eje dibujado se guardara solo, los propuestos desaparecerían. Se guardan con él, en el mismo paso.
- **V2c1-4, el velo de «Compilando».** Tras cada objeto dibujado la planta se velaba mientras compilaba. Con una herramienta de dibujo activa, ya no; con Elegir y al editar en las tablas, como antes.

### 7.4 Pendiente

- **Al pasar el ratón** se resalta lo del índice local (pilares, vigas, muros, apoyos lineales, ejes, losas y paños), no lo que elegiría el worker: los apoyos puntuales y las cargas no se resaltan.
- **«La cara de un pilar en la prolongación del cursor»** (§2.2, nivel 5) se ha hecho como el punto de la cara más cercano al cursor.
- Los bancos de V1, V2a y V2b tienen umbrales de tiempo y nombres de pestaña de antes de LV2 y de Forjados: hay que ponerlos al día (no es de V2c).
- La puerta de uso, al final de V2c (V2c-a).

## 8. V2c-2 hecho (2026-10-26)

Forjado (recuadro y polígono), Hueco, Muro, Apoyo y Apoyo lineal en Modelo, y las cinco cargas en Cargas, con su plantilla en Propiedades.

### 8.1 Qué hay

- **`src/editor/dibujo/`** (puro, sin DOM):
  - `recuadros.ts`: el grafo plano de los ejes de las vigas, muros y apoyos lineales de la planta y de los bordes de sus forjados, cortado en los cruces (con `cruce`: los extremos y los cruces de rectas paralelas a X o a Y tienen sus números), sin lo que cuelga; cada cara acotada es un recuadro. El de un punto es el menor que lo contiene; su contorno, sin vértices colineales y desde el vértice más cercano al clic.
  - `piezas.ts`: Forjado, Hueco, Muro, Apoyo y Apoyo lineal, y lo común (`pasoPolilinea`, `desplazar`, `estacion`, `forjadoEn`).
  - `cargas.ts`: Puntual, Lineal, Superficie, En barra y Empuje.
  - `herramientas.ts` las reparte. El evento de un clic lleva además el cursor sin enganchar y el radio (V2c2-2).
- **En la app:**
  - las herramientas, en las barras de Modelo (Forjado, Hueco, Muro, Apoyo y Apoyo lineal, que antes abrían su tabla) y de Cargas (Puntual, Lineal, Superficie, En barra, Empuje y Tabla);
  - sus plantillas en Propiedades (`Plantilla.tsx`);
  - el borrador de cada una: el recuadro bajo el cursor, el rectángulo del hueco, la huella del muro, la cara del muro del lado del empuje;
  - iconos nuevos: Hueco, Puntual, Lineal, Superficie y En barra.

Cómo se comporta cada herramienta:

- **Forjado:** maciza, reticular o unidireccional, como las columnas de la tabla.
  - Con «Recuadro» (por defecto), un clic dentro de un recuadro cerrado; el borrador lo enseña bajo el cursor. Con «Polígono», clic a clic; Intro, doble clic o un clic en el primero lo cierra. No crea uno que pise otro forjado.
  - En un unidireccional, las viguetas empiezan en el lado más cercano al primer vértice (C4-a.1): con el recuadro, el clic cerca de una esquina la elige.
  - Lo que la plantilla no dice sale del último forjado de su tipo (o de lo típico: maciza de 25 cm; reticular 25+5 con 0,80 / 0,12 / 0,05). El pp del reticular con casetón perdido y del unidireccional, sólo del último: si no hay, la plantilla lo pide en rojo.
- **Hueco:** el primer clic dice dónde va.
  - En un forjado, un rectángulo de dos esquinas en los ejes del ortogonal (por defecto) o un polígono, dentro de su contorno y sin tocarlo ni tocar otros huecos.
  - En un muro, dos clics por su eje y en un tramo dan las estaciones. Las alturas de la plantilla (por defecto, una puerta: 0 y 2,1 m) son sobre el suelo de la planta de abajo; en un muro de varias plantas, se suman las de las que quedan debajo.
- **Muro:** polilínea, como la viga; un clic en el primer punto lo cierra (un núcleo, que repite el primero). Desde y hasta, como el pilar. Lo dibujado es el eje o una cara (el eje, medio espesor más allá; con tramos paralelos a X o a Y, los números se suman tal cual).
- **Apoyo y Apoyo lineal:** un clic o una polilínea. Lo que coaccionan: empotrado (apoyo), sólo uz (apoyo lineal), articulado o los seis GDL uno a uno.
- **Cargas,** en el caso activo de la barra. Sus valores no tienen nunca uno por defecto: sin ellos, la herramienta lo pide.
  - Puntual: un clic, con F y M.
  - Lineal: una polilínea (cerrable).
  - Superficie: un clic en una losa o un paño (todo él), o una zona. La zona lleva su forjado si cae entera en uno, como la de la tabla («la parte de esa losa en la zona»).
  - En barra: un clic en una viga o un pilar (la pieza entera) o, con «Tramo», dos clics en una viga.
  - Empuje: un clic en un muro, del lado del terreno.

### 8.2 Criterios

| # | Criterio | Resultado |
|---|---|---|
| 1 | Las herramientas dan lo que daría la tabla | **Pasa.** `dibujo2.test.ts`: forjado por recuadro (maciza, reticular y un paño cerrado por el borde de otro forjado), por polígono, hueco rectangular y poligonal, muro cerrado y a una cara, hueco de muro, apoyo, apoyo lineal y las cinco cargas (con zona y con tramo), cada uno byte a byte igual a su fila de la tabla |
| 2 | El enganche es exacto | **Pasa.** El contorno de un recuadro son los números de los ejes; las estaciones, redondeadas a 1e-9 m (V2c2-1). Una retícula con núcleo, dos forjados por recuadros, un hueco de losa, un muro con su hueco, un apoyo lineal y cargas compila sin `losa/ajuste`, `muro/ajuste`, `topologia/casi-encuentro`, `topologia/fusion`, `topologia/nudos-proximos` ni errores |
| 3 | Rehacer los modelos de A2 dibujándolos | **Pasa.** El banco (`validacion/v2c/chrome.ts`) dibuja con ratón y teclado la planta del edificio objetivo entera (la de V2c-1, su losa con el hueco, tecleados, y sus cuatro cargas: dos de superficie con un clic, la lineal y la zona tecleadas) y la retícula con núcleo (ejes, 16 pilares, 8 vigas, losa con hueco, núcleo cerrado con su puerta, la sobrecarga con un clic y el viento con un clic en cada pilar). Tras «Renumerar», las dos huellas son las de sus referencias renumeradas. Las cargas de la referencia llevan los ids que les da el dibujo (Q1, Q2…) y el núcleo, sin la base `empotrado` escrita (V2c2-3) |
| 4 | Deshacer | **Pasa.** En el banco, 186 pasos en el edificio (18 ejes, 80 pilares, 81 vigas, losa, hueco, 4 cargas y Renumerar) y, deshecho todo, la huella de partida; en vitest, deshacer los 9 pasos de la retícula con núcleo da los bytes de partida |
| 5 | Fluidez | **Pasa.** Con Forjado en la planta del edificio con sus vigas y sin losa, pasar y pintar con el recuadro bajo el cursor: 0,1 ms de mediana y 0,2 ms p95; los recuadros de la planta, 3,3 ms la primera vez. El enganche con Viga, como en V2c-1 |
| 6 | Nada se rompe | **Pasa.** vitest en verde: 2 214 pruebas de la raíz y 72 de la app. La prueba de DOM de Forjados abre ahora la tabla desde la plantilla («Tabla»), porque Forjado ya es una herramienta. Ningún otro banco de Chrome usa los botones que cambian; los de CT e I2 dan lo mismo que antes salvo los tiempos (ruido) |
| 7 | Puerta de uso | Del usuario, al final de V2c |

### 8.3 Hallazgos

- **V2c2-1, las estaciones no son puntos.** Las de un hueco de muro y las de una carga en un tramo de viga son distancias a lo largo de la pieza: 8,4 − 6 da 2,4000000000000004. Se redondean a 1e-9 m. No hay unión que dependa de ellas: el compilador las vuelve a medir.
- **V2c2-2, lo que se elige con un clic dentro necesita el cursor sin enganchar.** El enganche «más cercano» deja el punto en el borde de dos recuadros, y el punto en polígono decide entonces por redondeo. Por eso el clic lleva también el cursor del ratón y el radio. Con ellos se eligen el recuadro, el forjado de una carga de superficie, el lado de un empuje y la viga o el pilar de una carga en barra. Un punto tecleado no los lleva: vale el punto tecleado.
- **V2c2-3, un valor por defecto escrito cambia la huella.** El núcleo de A2 lleva `base: "empotrado"`. Muro no lo escribe, como la tabla con la celda vacía. El modelo analítico es el mismo, pero la huella es la del modelo físico tal como está escrito, así que no coincide. La referencia del banco se compara sin él.
- **V2c2-4, un núcleo dentro de un recuadro.** Un muro cerrado suelto dentro de un recuadro es una isla del grafo: el recuadro es el de fuera, y el forjado lo cubre entero. El hueco de la escalera se dibuja después, con Hueco. Si el núcleo se une al borde con una viga, el contorno pasa dos veces por ella: no es un polígono simple, y la herramienta pide dibujarlo como polígono.

### 8.4 Pendiente

- **Forjado con ventana:** un forjado en cada recuadro de dentro, como el pilar en cada cruce.
- **Hueco de muro en el alzado** (§5 lo dejaba allí). Aquí se dibuja en la planta, con las alturas en la plantilla.
- **Carga en un tramo de pilar.** Sigue en la tabla: En barra pone la carga en todo el pilar.
- **Al pasar el ratón** siguen sin resaltarse los apoyos puntuales y las cargas (§7.4).
- La puerta de uso, al final de V2c (V2c-a).

## 9. V2c-3 hecho (2026-10-26)

Mover, Copiar, Girar y Simetría sobre lo elegido, los pinzamientos con Elegir y las vigas unidas a los pilares (V2c-d).

### 9.1 Qué hay

- **`src/editor/transformar.ts`** (puro):
  - `Transformador`: lo que hace una transformación con un punto, una dirección, un vector (fuerza) y un pseudovector (momento).
  - `transformar(modelo, ids, t, { copiar, plantas, conVigas })`: lo elegido movido o copiado, como un `lote` de `cambiar` o de `crear`.
  - `asas` y `moverAsa`: los vértices de lo elegido en una planta y uno de ellos llevado a otro punto.
- **`src/editor/dibujo/editar.ts`** (puro): las cuatro herramientas como máquinas de estados, como las de V2c-1 y V2c-2, con su borrador (lo elegido transformado bajo el cursor) y lo que dice la barra (Δ o el ángulo).
- **En la app:**
  - Mover, Copiar, Girar y Simetría en las barras de Modelo y de Cargas, con su plantilla en Propiedades: lo elegido; si las vigas siguen a los pilares; conservar lo original (Simetría); las plantas de las copias (Copiar).
  - El antiguo «Copiar» (a otras plantas, con su diálogo) pasa a llamarse «A plantas».
  - Los pinzamientos con Elegir (`controlador.ts`, y `Vista2D.agarrar` para arrastrar).

Cómo se comporta:

- **Lo que se transforma** es lo elegido. Con algo elegido al activar la herramienta, empieza ya. Si no, los clics y las ventanas eligen como con Elegir: un clic sin Ctrl confirma, y con Ctrl se suma e Intro confirma.
- **Mover y Copiar:** el punto base y el destino, enganchados o tecleados («@dx; dy» es relativo al punto base).
  - Copiar pone una copia por clic hasta Intro o Esc.
  - Con plantas marcadas en la plantilla, las copias de lo que es de una planta van a ellas, y los pilares, muros y ejes se copian una vez. Intro sin punto base (o «Copiar en su sitio») las copia allí sin moverlas: el «A plantas» de siempre.
- **Girar:** el centro y el ángulo desde +X, con un clic (con el ortogonal, 0°, 90°…) o los grados tecleados.
- **Simetría:** dos puntos del eje; con «Conservar lo original», es una copia.
- **Después de una acción,** Mover, Girar y Simetría vuelven al punto base con lo mismo elegido (los ids no cambian). Esc anula el punto en curso y lo elegido se queda; otro Esc vuelve a Elegir.
- **Con sus cargas:** las que van sobre lo elegido por su id (en barra, empujes, superficie sobre una losa o un paño) lo acompañan: al mover, giran con ello; al copiar, se copian con la copia y apuntan a ella. Las sueltas (puntual, lineal, zona sin forjado), sólo si se eligen. Una carga en barra elegida sin su pieza va con la pieza, y se avisa.
- **Vigas unidas a los pilares** (V2c-d): al mover, girar o hacer la simetría sin conservar, el vértice de cada viga no elegida que está bit a bit en el punto fijo de un pilar que se transforma (en sus plantas) va con él. Con la casilla quitada, o con Ctrl en el último clic, no, y se avisa. Una viga alineada a una cara (V2c-b) no lo sigue, y se avisa, como en CT3.
- **Lo que no es un punto:**
  - al girar, cambian el giro de los pilares, el eje 1 de las losas, la dirección de los paños, las componentes horizontales de las fuerzas en ejes globales y las coacciones de los apoyos (ux ↔ uy y rx ↔ ry a 90°; a otro ángulo, si son distintas, se quedan y se avisa);
  - en la simetría, además, el punto fijo de los pilares cambia de lado, la componente y de las cargas en ejes locales cambia de signo, los momentos se reflejan con el signo cambiado (son pseudovectores) y el empuje pasa al otro lado del muro;
  - un pilar girado 180° o más con una sección simétrica respecto a su centro (todas salvo la T) se deja con el giro en [0°, 180°) y el punto fijo al otro lado: es la misma pieza.
- **Exacto,** como en CT2: al mover, la coordenada igual a la del punto base acaba en la del destino y las demás, en la suya más el desplazamiento sin el ruido de la suma; los giros de 90°, 180° y 270° y la simetría por un eje paralelo a X, a Y o a 45° no usan senos. Un valor por defecto (giro 0, eje 1 0) no se escribe, salvo si ya estaba escrito y no cambia.
- **Pinzamientos** (con Elegir y hasta 60 objetos elegidos): un cuadrado en cada vértice de lo elegido de la planta (el punto de un pilar, un apoyo o una puntual; los de vigas, muros, apoyos lineales, contornos, huecos y ábacos, zonas de carga y extremos de los ejes).
  - Un clic en uno lo coge y el clic siguiente, enganchado o tecleado («@dx; dy» desde donde estaba), lo deja; también se puede arrastrar. Esc lo suelta.
  - El de un pilar lo mueve con sus vigas (`moverPilar`, como CT3) y con Ctrl, solo.
  - En un muro cerrado, el primer punto y el último van juntos. Los huecos del muro y los tramos de las cargas de la viga se vuelven a medir en su tramo, a 1e-9 m.

### 9.2 Criterios

| # | Criterio | Resultado |
|---|---|---|
| 1 | Las herramientas dan lo que daría la tabla | **Pasa.** `editar.test.ts`: mover un pilar con el destino tecleado es byte a byte lo de escribir en la tabla el pilar y el extremo de sus tres vigas; copiar un pilar y una viga con sus cargas, girar y la simetría con sus cargas, puntos fijos, coacciones y ejes de losa (`transformar.test.ts`), con la huella del pilar transformado igual a la huella transformada |
| 2 | El enganche es exacto | **Pasa.** Los números de la tabla salen tal cual al mover, girar 90°, 180° y 270° y en la simetría por ejes paralelos a X, a Y o a 45°. **Metamórfica:** la retícula con núcleo y el unidireccional de C4, trasladados y girados 90° y 180° enteros, dan la misma malla y los desplazamientos y reacciones transformados a ≤ 3,2e-13 por caso (la prueba, a 1e-9); reflejados, las reacciones de los apoyos a 1,6e-14 sin losas y a 6,1e-4 con ellas (V2c3-2) |
| 3 | Rehacer los modelos de A2 | Hecho en V2c-2. El banco (`validacion/v2c/chrome.ts`) sigue en la retícula con núcleo ya dibujada: mover un pilar, copiar una viga dos veces, girarla 90° (tecleado), la simetría de un pilar conservándolo y arrastrar con el ratón el vértice de una viga hasta un cruce dan, cada uno, la huella de lo mismo hecho en Node |
| 4 | Deshacer | **Pasa.** En el banco, 6 pasos de deshacer (las seis acciones) vuelven a la huella de antes. En vitest, en los seis modelos de referencia (1-022, C2, C3, los dos de C4 y la vivienda), mover y volver, girar cuatro veces 90° y dos simetrías iguales dejan los bytes, y deshacer, también |
| 5 | Fluidez | **Pasa.** Edificio objetivo, planta N3, Mover con la planta entera elegida (162 objetos) y el punto base puesto: pasar y pintar lo elegido movido bajo el cursor, 0,2 ms de mediana y 0,3 ms p95; 120 movimientos sin tareas largas. Lo de V2c-1 y V2c-2, igual que antes |
| 6 | Nada se rompe | **Pasa.** vitest en verde: 2 263 pruebas de la raíz y 79 de la app (la de «A plantas», con su nombre nuevo). Bancos de Chrome: V2c y CT, todo bien; I2 elige en las cuatro vistas y Esc suelta como antes, con el único fallo que ya tenía (una tarea larga de 66 ms al pasar a cuatro vistas, §7.2). El paso de CT3 que elige un pilar falló una vez con vitest corriendo a la vez (espera dos fotogramas a que llegue la elección del worker) y pasa solo |
| 7 | Puerta de uso | Del usuario, al final de V2c |

### 9.3 Hallazgos

- **V2c3-1, un valor por defecto escrito no vuelve.** Los modelos de C4 llevan `giro: 0` escrito. Girarlos 90° cuatro veces lo deja sin escribir (un giro que vuelve a 0 no se escribe, como la tabla con la celda vacía), así que la ida y vuelta sólo deja los bytes sin esos valores escritos. Es V2c2-3 otra vez; la prueba los quita antes.
- **V2c3-2, la malla de una losa no es simétrica.** El mismo modelo reflejado da otra malla: los empates de Delaunay se deshacen con una perturbación ligada a los ejes de la losa (C2-3), que la simetría cambia de orientación. Las reacciones de la retícula con núcleo quedan a 6,1e-4 de las reflejadas; sin losas, a 1,6e-14. Girado o trasladado, la malla es la misma, como prometía C2.
- **V2c3-3, comparar resultados sin limpiar.** La primera versión de la prueba metamórfica comparaba los desplazamientos pasados por `vector3`, que limpia el ruido de los números del modelo (redondea lo que está a 1e-9 de la rejilla de 1e-6). Con desplazamientos de 1e-9 m daba un error de 8,6e-4 que no era del motor; sin limpiar, ≤ 3,2e-13, como las metamórficas de C2–C4. Lo de comparar va ahora sin limpiar (`vector3(v, false)`).
- **V2c3-4, Esc soltaba lo elegido en mitad de una acción.** El Esc de la app (`App.tsx`) suelta lo elegido siempre. Con un punto en curso de Mover, Copiar, Girar o Simetría, o con un vértice cogido, Esc es de la herramienta: anula el punto y lo elegido se queda. Una tecla que ya usó una herramienta (`defaultPrevented`) no es un atajo.
- **V2c3-5, una viga por el eje de un muro.** Un clic en ella elige el muro. Para moverla, se elige en el navegador o con una ventana.

### 9.4 Decisiones tomadas al hacerlo (para revisar en la puerta de uso)

- Las vigas siguen a los pilares también al girar y en la simetría, no sólo al mover (V2c-d decía «mover»). Al copiar, no: lo original no se mueve.
- Las cargas que van por su id acompañan siempre; las sueltas, sólo elegidas. No se buscan las puntuales o lineales que caen sobre una losa movida.
- Las copias llevan ids nuevos con el prefijo de su tabla (P, V, L, F, M, A, AL, Q; los ejes, la letra o el número siguiente). «A plantas» sigue poniendo la planta en el id.
- El ángulo de Girar se mide desde +X, sin una dirección de referencia.

### 9.5 Pendiente

- Girar con un ángulo de referencia (dos puntos), como en los CAD.
- Pinzamientos en el punto medio de un tramo (mover el tramo entero), en las estaciones de un hueco de muro y en el alzado.
- Mover lo mismo en varias plantas a la vez (las vigas de una planta tipo): hoy se eligen en cada una, o se copia con «A plantas».
- Las vigas que llegan a una viga que se mueve no la siguen (sólo a los pilares).
- Al pasar el ratón siguen sin resaltarse los apoyos puntuales y las cargas (§7.4), aunque ya tienen asas.
- La puerta de uso, al final de V2c (V2c-a).


## 10. V2c-4: la plantilla DXF (plan, 2026-10-26)

Un DXF de fondo en la planta, en gris, con enganches a sus líneas y vértices, para calcar la planta del arquitecto como con las plantillas de CYPECAD (V2c-e).

### 10.1 Lo medido antes de empezar

- **El DXF de la vivienda** (`ejemplos/Proyectos/modelo.dxf`, fuera de git: datos del cliente): AutoCAD 2018 (AC1032), ASCII, 872 kB. En ENTITIES, 1 401 `LINE`, 82 `LWPOLYLINE`, 71 `ARC`, 61 `SPLINE`, 32 `TEXT` y 18 `DIMENSION`; 21 bloques (los de las cotas, con `LINE`, `SOLID`, `MTEXT` y `POINT`); capas `00 0 PLANTA BAJA`, `00 1 PLANTA CUBIERTA`, `0 PILARES` y `Defpoints`.
- **`$INSUNITS` = 4 (mm), pero las coordenadas están en metros** (extensión de 26,6 × 18,4). Las unidades no se pueden tomar de la cabecera: se proponen por el tamaño y se pueden cambiar.
- **Las coordenadas llevan ruido:** −5,750000000007275 donde el arquitecto quiso −5,75.
- **`dxf-parser` 1.1.2 (MIT)** lo lee en 16 ms y reconoce todo, pero sólo convierte los pares de código y valor en objetos: los bloques anidados con giro, escala y simetría, el OCS (extrusión −Z), los bulges, los splines, el texto de `MTEXT` y la codificación quedan por hacer.

### 10.2 Decidido por el usuario (2026-10-26)

- **V2c4-a, lector propio** en `src/dxf/` (puro, sin dependencias), que servirá también para `fem importar-dxf` (MA6). Se valida contra ezdxf 1.4.5 (MIT, en `.venv`) como oráculo.
- **V2c4-b, en el proyecto y fuera de la huella:** un campo `plantillas` en `proyecto.json`, como `vistas`, con el nombre del fichero, su sha256, las unidades, la colocación, las plantas, las capas ocultas y el redondeo. El DXF va junto al proyecto en el disco y en IndexedDB en el navegador; si no se encuentra, se avisa y se pide.
- **V2c4-c, lo enganchado del DXF se redondea a 1 mm** (en la plantilla: 1 mm, 1 cm o nada). Lo enganchado del modelo sigue exacto, bit a bit.
- **V2c4-d, en las vistas de planta de Modelo y Cargas:** en gris, detrás de todo, en las plantas a las que está asignada, y con un botón para ocultarla. No se ve en Resultados, el alzado ni el 3D.

### 10.3 Qué se propone

- **`src/dxf/`** (puro):
  - `lector.ts`: los bytes del fichero (UTF-8 desde AC1021; antes, la página de `$DWGCODEPAGE`) a cabecera, capas (color, apagada, congelada), bloques y entidades. El DXF binario y el DWG se rechazan con un mensaje.
  - `aplanar.ts`: las entidades a geometría en el plano, con los bloques expandidos (`INSERT` anidados, con `MINSERT`; las cotas, por su bloque) y el OCS. Sale una lista de trazos (polilíneas; los arcos, círculos, elipses, splines y bulges, discretizados), los puntos para enganchar (extremos y vértices de verdad, centros de arcos y círculos, puntos medios de los arcos) y los textos. Lo que no se lee (`HATCH`, sólidos 3D, imágenes…) se cuenta.
  - Las unidades se proponen por la extensión; mm y cm se pasan a m dividiendo (el double más cercano, como al teclear).
- **La colocación:** p = d + R(giro)·(u·p_dxf). Al importar, si la extensión está a más de 1 km del origen, d lleva su esquina al origen (redondeada al metro). Herramientas **Colocar** (un punto de la plantilla y su destino) y **Girar plantilla** (centro y ángulo).
- **En la app:** «Plantilla DXF» en la barra de Modelo (elegir el fichero; queda en la planta activa); su sección en el navegador; en Propiedades, el fichero, las unidades, el redondeo, las plantas, las capas con su número de entidades, la colocación y «Quitar». Se lee en un worker propio, sin bloquear la página.
- **Dibujo:** las líneas, en un `LineSegments` de 1 px en gris detrás del modelo y delante de la rejilla; los textos, en el lienzo 2D cuando miden ≥ 5 px.
- **Enganches:** los de §2.2 también en la plantilla (extremo, vértice, centro, medio, cruce entre sus líneas y con las del modelo, perpendicular y cercano), con un índice por celdas. A igual nivel y distancia gana el modelo. La barra dice «(DXF)». Ocultar la plantilla quita sus enganches.

### 10.4 Criterios de paso

1. **El lector coincide con ezdxf.** En DXF sintéticos escritos con ezdxf (cada entidad; `INSERT` anidados con giro, escala negativa y `MINSERT`; extrusión −Z; bulges; R12 con `POLYLINE`; R2000 con «ñ» en ANSI_1252; `MTEXT` con formato) y en el de la vivienda (sólo en local), los extremos, vértices y centros salen a ≤ 1e-9 de los de ezdxf, y los puntos de las curvas, sobre la curva de ezdxf. Los sintéticos y lo que dice ezdxf, congelados en el repositorio.
2. **Calcar.** La retícula con núcleo de A2 exportada a DXF (en mm, con ruido de 1e-9) e importada como plantilla: dibujar sus pilares, vigas, muros y losas enganchando sólo a la plantilla da, tras «Renumerar», la huella de la referencia (vitest con las herramientas y banco de Chrome con el ratón).
3. **Redondeo.** Lo enganchado del DXF de la vivienda sale en mm redondos, y con «nada», con los doubles del DXF transformados.
4. **Fluidez.** Con un DXF sintético de 100 000 segmentos, el enganche tarda ≤ 2 ms en Chrome y la página no tiene tareas largas al cargarlo (se lee en el worker).
5. **Nada se rompe.** Añadir, colocar o quitar una plantilla no cambia la huella; los bancos de V2c, CT e I2, como antes.
6. **Puerta de uso** (del usuario): calcar un proyecto suyo real, al final de V2c, junto con la de F y AB.

## 11. V2c-4 hecho (2026-10-26)

La plantilla DXF: un plano en gris detrás de las plantas de Modelo y Cargas, con enganches a sus líneas y vértices, para calcar (§10).

### 11.1 Qué hay

- **`src/dxf/`** (puro, sin dependencias, V2c4-a): `lector.ts` (cabecera, capas, bloques y entidades; UTF-8 desde AC1021 o la página de `$DWGCODEPAGE`; rechaza el DXF binario y el DWG) y `aplanar.ts` (bloques anidados con escala, giro, simetría y `MINSERT`; las cotas por su bloque en su OCS; el OCS; arcos, círculos, elipses, splines racionales y bulges en cuerdas de 5° como mucho con los extremos de verdad; `TEXT`, `MTEXT` y atributos; lo que no lee, contado). Puntos para enganchar: extremos, vértices, centros, puntos medios de los arcos y **el centro geométrico de las polilíneas cerradas sin arcos**: un pilar dibujado como rectángulo se pone con un clic (en la vivienda, sus 23 pilares son 23 polilíneas cerradas). `comparar.ts` lo contrasta con ezdxf.
- **En el proyecto** (V2c4-b): `plantillas` (`PlantillaDxf`: nombre, fichero, sha256, unidades, traslación, giro, plantas, capas ocultas y redondeo), fuera de la huella, con la operación `plantillas` del editor. Sus plantas siguen a una planta renombrada o borrada.
- **`src/editor/dibujo/plantilla.ts`** (puro): unidades propuestas (las de `$INSUNITS` si dan un edificio de 3 a 500 m; si no, la primera de m, mm y cm que lo dé), la traslación al importar un plano a más de 1 km del origen, `colocar` (los doubles del DXF tal cual sin giro ni traslación; mm y cm, dividiendo), mover y girar la plantilla, el redondeo y un índice por celdas (recorrido de Amanatides y Woo). `enganches.ts` engancha también a ella (§10.3); lo enganchado sale redondeado (V2c4-c) y con `objeto` vacío, para que ninguna herramienta lo tome por un id del modelo.
- **`herramientaPlantilla.ts`** (puro): Colocar (un punto de la plantilla y su destino) y Girar (centro, un punto de la plantilla y hacia dónde va).
- **En la app:**
  - «Plantilla DXF» en la barra de Modelo: el fichero se lee en un worker propio (`app/src/plantilla/lector.worker.ts`) y queda en la planta activa;
  - el fichero se busca por su sha256 en la memoria de la página, en IndexedDB (almacén `dxf`, base en su versión 2) y junto al proyecto (carpeta o servidor local; si allí tiene otro sha256, se dice); importado con una carpeta del disco, se deja a su lado;
  - la sección «Plantillas DXF» del navegador: el estado del fichero (leyendo, entidades, falta, error) y, desplegada, «Elegir…», unidades (con el aviso si `$INSUNITS` dice otras), redondeo, colocación (x, y, giro), Colocar y Girar, plantas, capas con su número de entidades, lo que no se leyó y Quitar;
  - la vista de planta la dibuja en gris (WebGL, con el material de la rejilla) y sus textos de ≥ 5 px; el botón de la barra de la vista la oculta (`EstadoVista.plantilla`), y oculta no engancha;
  - el pie dice «Extremo (DXF nombre)».

### 11.2 Criterios

| # | Criterio | Resultado |
|---|---|---|
| 1 | El lector coincide con ezdxf | **Pasa.** Cinco DXF sintéticos escritos con ezdxf (`src/dxf/__fixtures__/`, con lo que dice ezdxf al lado) y el de la vivienda (`validacion/v2c4/vivienda.ts`, sólo en local): segmentos, puntos para enganchar, curvas, splines, textos, capas y lo que no se lee, a ≤ 1e-9 (la vivienda, a 2,7e-11; se lee en 50 ms) |
| 2 | Calcar | **Pasa.** La retícula con núcleo de A2 exportada a DXF en mm con ruido de 1e-9 m (`src/pruebas/dxfPrueba.ts`): en vitest con las herramientas (`plantilla.test.ts`) y en Chrome con el ratón (`validacion/v2c4/chrome.ts`), las vigas, los pilares en el centro de su rectángulo, la losa y su hueco, el núcleo y su puerta entre las jambas dan, tras «Renumerar», la huella de la referencia |
| 3 | Redondeo | **Pasa.** Lo enganchado de la plantilla sale en mm redondos (−5,750000000007275 → −5,75), en cm con 0,01 y con los doubles del DXF con «nada»; nunca −0 |
| 4 | Fluidez | **Pasa.** Edificio objetivo, N3, con un DXF de 100 000 segmentos (12,6 MB): leerlo en el worker, colocarlo y dibujarlo, 0,5 s sin tareas largas; el enganche con Viga, 0,1 ms de mediana y 0,3 ms p95 (368 de 400 posiciones enganchan a la plantilla); 120 movimientos sin tareas largas |
| 5 | Nada se rompe | **Pasa.** Añadir, colocar o quitar una plantilla no cambia la huella (vitest y Chrome). vitest en verde en la raíz y en la app (con `app/src/test/plantilla.test.tsx`); los bancos de V2c y CT, como antes |
| 6 | Puerta de uso | Del usuario, al final de V2c |

### 11.3 Hallazgos

- **V2c4-1, `$INSUNITS` no sirve.** El DXF de la vivienda dice mm y está en m. Las unidades se proponen por el tamaño, se avisa si la cabecera dice otras y se cambian en el navegador.
- **V2c4-2, ezdxf se equivoca en dos cosas, y el oráculo las evita.** `virtual_entities` de un `INSERT` girado 90° dentro de otro con escala (2, 1) pone la escala en el eje que no es (un pilar de 30 × 30 sale de 30 × 60 en vez de 60 × 30): el oráculo compone las `matrix44()` de ezdxf, y entonces coincide con el lector. Y `plain_text` de un MTEXT convierte `\S3^4;` en «3r» y no resuelve `\U+00E1`: esos dos casos van en la prueba unitaria, con lo que escribe AutoCAD.
- **V2c4-3, el giro de un MTEXT va en grados** (código 50), aunque la referencia de DXF diga radianes: es lo que escriben AutoCAD y ezdxf.
- **V2c4-4, el índice de un plano grande.** Con 100 000 segmentos, el índice por celdas tardaba 60 ms (creaba un array por celda y por punto); sin crear nada, 26 ms. Aun así, colocar, indexar y dibujar en la misma tarea pasaban de 50 ms: el índice se hace en una tarea aparte, justo después de dibujar (o al primer enganche).
- **V2c4-5, calcar pide acercarse.** El radio de enganche es de 10 px: con la planta entera a la vista y los paneles abiertos (unos 35 px/m), son 0,28 m, y el centro del rectángulo de un pilar (nivel 1) gana al extremo de una viga a 0,27 m. Como en un CAD, se calca acercado (el banco, a unos 230 px/m).
- **V2c4-6, la plantilla detrás queda tapada por las losas.** Va detrás de todo (V2c4-d) y el relleno de las losas es opaco: dibujado un forjado, el plano de debajo deja de verse (y de ayudar a calcar lo que falta encima). Ver §11.4.

### 11.4 Pendiente

- **Del usuario, V2c4-6:** dejarla detrás de todo, o dibujarla encima del relleno de las losas (debajo de las líneas del modelo) o encima de todo, tenue.
- Las `MLINE` y los `HATCH` no se leen: se cuentan y se dice que se descompongan en el CAD.
- Colocar con dos pares de puntos (mover, girar y escalar de una vez), y un factor de escala libre (hoy, sólo las unidades).
- Una plantilla por planta en el 3D o en el alzado (§5 los deja fuera).
- La puerta de uso, al final de V2c (V2c-a), con un plano real del usuario: la vivienda tiene sus pilares como rectángulos cerrados, así que se calcan con un clic en su centro.
