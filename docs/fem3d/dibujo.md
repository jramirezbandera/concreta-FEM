# V2c: dibujar el modelo con el ratón (plan)

> **Fecha:** 2026-10-23. **Estado:** decidido por el usuario el 2026-10-23 (§6.1), salvo V2c-d, que se decide al empezar V2c-3. **V2c-1 hecho el 2026-10-23** (§7).
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
- **V2c-d** (mover un pilar arrastra sus vigas): se decide al empezar V2c-3.

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
