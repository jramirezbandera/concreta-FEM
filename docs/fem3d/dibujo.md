# V2c: dibujar el modelo con el ratón (plan)

> **Fecha:** 2026-10-23. **Estado:** decidido por el usuario el 2026-10-23 (§6.1), salvo V2c-d, que se decide al empezar V2c-3.
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
- Después de dibujar, la compilación sin cálculo de siempre (150 ms) da los diagnósticos, como al editar una tabla.

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
