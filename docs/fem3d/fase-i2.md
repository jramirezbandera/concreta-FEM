# Fase I2: motor de vistas

> **Qué es.** La segunda fase de la interfaz v4 (`interfaz.md`): la planta pasa de SVG a WebGL con la escena de A4 como fuente, con el grafismo de §8 (ejes de replanteo con burbujas y cotas, huecos con aspa, rótulos por zoom); nuevas vistas de alzado por eje y 3D alámbrico del modelo físico, con ViewCube; 1, 2 o 4 vistas a la vez; navegación de CAD; y la selección compartida entre las vistas, el navegador y la tabla. Lo que se fijó al empezar está en `interfaz.md` §14. **Fecha:** 2026-10-12.
>
> **Estado:** pasan los cinco criterios de §14.1. El banco de V1 conserva su fallo conocido (V1-3, la primera magnitud SPR de una planta, alrededor de 500 ms). Falta la puerta de uso del usuario.

## 1. Criterios

| # | Criterio | Resultado |
|---|---|---|
| 1 | Las primitivas de la planta, iguales a las de `fem render` | **Pasa.** En Node, en los cuatro proyectos y en todas las vistas de planta (y en los alzados de todos los ejes), los búferes son, capa a capa y en orden, los vértices de las primitivas de A4 en Float32 respecto al centro, con su estilo, y no se pierde ningún glifo ni texto (`src/visor/visor.test.ts`). En Chrome, los búferes que pinta el motor tienen el sha256 de Node en la planta N3, su mapa de uz y el alzado del eje 3 del edificio objetivo (`validacion/i2/out_chrome.txt`) |
| 2 | Fluidez con el edificio objetivo | **Pasa.** Desplazar y acercar la planta, orbitar y desplazar el 3D (alámbrico y analítico): mediana de 8,3 ms entre fotogramas (el monitor del banco va a 120 Hz) y p95 de 8,4 ms. De 1 a 4 vistas, 40 ms. Ninguna tarea larga en el recorrido, ni en los bancos de I1, V1 y V2a |
| 3 | Elegir en una vista elige en todas y en la tabla | **Pasa.** Clic en la planta, Ctrl+clic, clic en el alzado, clic en el 3D, una ventana y Esc dan la misma lista en las cuatro vistas, en el navegador y en las filas de la tabla |
| 4 | Lo nuevo, validado en Node | **Pasa.** Ejes: los del edificio objetivo son 1–10 y A–H, y la propuesta no depende del orden, de una traslación ni de un giro; los ejes no cambian la huella ni el modelo analítico (`src/compilador/ejes.test.ts`). Alzado: pilares tramo a tramo con su posición, su ancho visto y sus cotas, vigas con su canto, losas con su espesor (`src/agente/render/alzado.test.ts`). 3D alámbrico: cada segmento es de su objeto y está en su cota (`visor.test.ts`) |
| 5 | No se pierde nada de I1 | **Pasa.** Los tests de DOM de V1 y V2a pasan (17 de 17 en `app/`). Los bancos de I1, V1 y V2a, adaptados (ya no hay SVG ni `<canvas>` en cada vista), dan lo mismo: mismos sha256 de resultados, misma huella de lo guardado, sin tareas largas. El único FALLA es el de siempre, V1-3 |

## 2. Lo que hay

- **Motor de vistas** (`app/src/vistas/`): un `WebGLRenderer` con stencil para toda la zona de vistas y un lienzo 2D encima (glifos, rótulos, ventana de elegir, ViewCube). Cada vista se pinta en su celda; se pinta sólo cuando algo cambia.
  - `Vista2D` (planta y alzado): cámara ortográfica, rellenos por stencil (par-impar y nonzero, la regla del SVG) y trazos con grosor en píxeles.
  - `Vista3D`: alámbrico del modelo físico o analítico (la malla de V1, con la deformada en Resultados), perspectiva u ortográfica, órbita alrededor del punto bajo el cursor y ViewCube con las seis vistas y las cuatro isométricas.
  - Sin WebGL (jsdom), cada vista lo dice y lo demás funciona.
- **Escena para la GPU** (`src/visor/escena.ts`): las capas de V1 con sus abanicos y sus segmentos en Float32 respecto al centro de la caja. Elegir en un punto, resaltar varios y elegir por ventana («dentro» y «toca»), sobre las primitivas exactas.
- **A4** (y por tanto `fem render`): ejes de replanteo con burbujas en todas las vistas de planta, cotas entre ejes paralelos en `modelo`, huecos de losa con aspa, vigas más claras y la clase de cada rótulo (`eje`, `cota`, `id`, `dato`). Vista nueva de alzado (`alzado.ts`).
- **Ejes de replanteo:** `ejes` en el modelo físico, fuera de la huella; propuesta con las alineaciones de las bandas (`src/compilador/ejes.ts`); décima tabla del editor, que sin ejes ofrece guardar los propuestos.
- **3D alámbrico** (`src/visor/alambrico.ts`): ejes de pilares y vigas y contornos de losas, paños y muros, con su objeto y su planta.
- **Vistas en la app:** 1, 1|1, 1/1 y 2×2 (barra y Ctrl+1…4); cada una con su tipo, su planta o su eje, su modo y su cámara, recordados por proyecto. Las vistas no cambian con el espacio de trabajo; los modos de Resultados ponen su contenido en cada planta (Losas, Diagramas, Pilares) y la deformada en el 3D.
- **Navegación:** rueda hacia el cursor, botón central o derecho para desplazar (con Mayús, orbitar), herramientas Desplazar y Orbitar para el panel táctil, F para encuadrar, clic, Ctrl+clic, ventana, Esc, y doble clic en un eje para abrir su alzado.
- **Selección compartida:** la del visor es una lista (`elegidos`), con la última como principal. Propiedades da la lista por tipo con varios; Borrar y A plantas trabajan con todos; Mayús en la tabla elige el rango.

## 3. Hallazgos

- **I2-1. Las rectas de los ejes pasan por todo.** Un clic en el centro de un pilar elegía el eje que pasa por él. Las rectas de los ejes y de los niveles van ahora detrás de todo al elegir; sus burbujas, no.
- **I2-2. Ids de ejes que ya existen.** En el edificio objetivo, «C» es la planta de cimentación y «G» un caso. El eje propuesto toma el id `eje-C` y el nombre «C», que es lo que dicen sus burbujas.
- **I2-3. Un pórtico no tiene alineaciones en la otra dirección.** En 1-022 (una sola fila de pilares) no salían ejes numerados. Si una dirección no tiene ninguna alineación de dos pilares, cada pilar da la suya.
- **I2-4. Tareas largas al cambiar de modo (70–160 ms).** El perfil de CPU de Chrome (`validacion/i2/perfil.ts`) encontró tres causas:
  - un material de Three.js por capa (los diagramas de vigas tienen decenas): cada uno calcula sus parámetros y copia sus uniformes;
  - comprobar los errores de cada shader espera a que el driver lo compile;
  - Three.js borra un programa cuando se liberan todos sus materiales, así que salir de un modo y entrar en otro recompilaba en mitad de un fotograma.

  Ahora los materiales son de la página (uno por clase y color) y no se liberan, la comprobación de shaders sólo se hace al desarrollar, los programas se precompilan en segundo plano al empezar, y el analítico (33 000 láminas) se construye una vez, en su propia tarea. Con eso, ningún banco da tareas largas.
- **I2-5. El banco de V1 medía el paso anterior.** `data-cargando` se ponía en un efecto, un fotograma tarde: M11 salía en 1 ms y M22 cargaba con su tiempo (725 ms). Ahora la marca sale en el mismo render que el pedido. Con eso y los pedidos idénticos compartidos (`usePedido`), M11 queda en 485–559 ms y M22 en 101 ms.
- **I2-6. Chrome headless usa la GPU de verdad.** En la máquina del banco, ANGLE sobre una RTX 4060 Ti, con los fotogramas a 120 Hz. El criterio de 60 fps se cumple con margen, pero no dice nada de una GPU integrada: queda por medir (§5).
- **I2-7. Una vista sin tocar se reencuadra.** Al abrir el panel inferior o pasar a 2×2, los alzados quedaban cortados. Ahora una vista cuya cámara nadie ha movido desde su último encuadre se encuadra de nuevo al cambiar de tamaño o de escena; una tocada, sólo si el cambio de tamaño es grande.
- **I2-8. La planta activa en 3D se confundía con lo elegido.** Las dos iban en azul. Ahora la planta activa va con sus colores y el resto, atenuado; por defecto, ninguna.

## 4. Validación

- `src/compilador/ejes.test.ts`, `src/agente/render/alzado.test.ts` y `src/visor/visor.test.ts` (búferes, alzados, ventana y alámbrico). `src/editor/editor.test.ts`: la tabla de ejes y guardar los propuestos. `src/agente/render/render.test.ts`: los ejes en la vista `modelo` y el SVG y el PNG congelados, nuevos.
- `validacion/i2/chrome.ts` (`out_chrome.txt`): criterios 1, 2 y 3. Con `--capturas <carpeta>`, una PNG por paso.
- `validacion/i2/perfil.ts` (`out_perfil.txt`): perfil de CPU de los cambios de modo.
- `validacion/i1/chrome.ts`, `validacion/v1/chrome.ts` y `validacion/v2a/chrome.ts`: adaptados; sus `out_chrome.txt`, de nuevo.

## 5. Pendiente

- **Del usuario:** la puerta de uso: usar las vistas con un proyecto suyo (planta, alzados, 3D, 2×2, elegir por ventana) y decir qué falta o sobra.
- **Medir en una GPU integrada** (un portátil sin gráfica dedicada): orbitar el analítico del edificio objetivo es lo más exigente.
- **Cambiar los ejes (o el nombre) obliga a recalcular en la app** aunque la huella no cambie: cada versión del proyecto abre otro worker. Se puede llevar el resultado de un worker al siguiente cuando la huella es la misma.
- **I3:** sólido, translúcido, filtros, rango de plantas, aislar y caja de sección; vistas guardadas en el proyecto.
- **Con V2b:** «Renumerar» (I-g); las plantas en las que se ve cada eje.
