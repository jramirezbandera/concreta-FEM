# Fase I4: resultados en 3D

> **Qué es.** La cuarta fase de la interfaz v4 (`interfaz.md`): los resultados sobre el 3D. La primera parte (diagramas de las barras en el 3D y en el alzado, e isovalores de las losas en el 3D) se adelantó el 2026-10-12 y está en `interfaz.md` §7.1. Este informe cubre el resto, fijado al empezar en `interfaz.md` §15: la deformada con la original y animada, los pilares por colores (N o ν), las reacciones, los muros con mapa (y las fuerzas de membrana F11, F22 y F12), el valor bajo el cursor y el detalle de cualquier pieza en Propiedades. **Fecha:** 2026-10-12.
>
> **Estado:** pasan los cinco criterios de §15.1. Falta la puerta de uso del usuario, que también tiene que revisar las propuestas de §15 (sobre todo, cómo se dibujan las reacciones y la regla del campo nulo, I4-1).

## 1. Criterios

| # | Criterio | Resultado |
|---|---|---|
| 1 | Cada número, de su consulta, bit a bit | **Pasa.** En los cuatro proyectos de V1 (`src/visor/i4.test.ts`): el valor de cada tramo de pilar es el del cuadro (`filasPilarQ`, la misma función que la pantalla Pilares), en N y en ν; cada flecha es la resultante de `fem consultar reacciones` de su objeto en la combinación de su mayor \|Fz\|, y con cada caso la suma de las Fz es el total de la consulta a ≤ 1e-9 relativo; los valores de los muros son los del SPR en sus ejes (a 1e-9); los rótulos de la deformada son el nudo del mayor \|u\| y el del menor uz de sus desplazamientos; `valor-lamina` da en las losas lo que `valor-punto`, bit a bit, en uz, M22 y F11. Las sondas del DOM y de Chrome dicen, con su formato, lo que su consulta da en Node para el mismo objetivo |
| 2 | Convenio | **Pasa.** La flecha vertical acaba en el apoyo y va en el sentido de Fz (hacia arriba si Fz > 0); F22 medio en la base del núcleo, con el peso propio: negativo (compresión); ν sólo en los tramos de hormigón (los de 1-022, de sección general, sin ν y en gris) |
| 3 | Validez | **Pasa.** Sin el cálculo, `pilares3d`, `reacciones3d`, `isovalores3d` con muros y `valor-lamina` contestan `visor/sin-resultados`; con el fichero cambiado, las fuentes del 3D no piden nada y la vista lo dice (como en el adelanto). Una lámina o una combinación que no existen, error |
| 4 | Chrome, con el edificio objetivo y el núcleo | **Pasa** (`validacion/i4/out_chrome.txt`): los tramos de pilar (560), los segmentos de las flechas (800) y los triángulos de las bandas de los muros del núcleo (2 614) son los de Node; las cuatro sondas (un punto de uz, una estación de My, un tramo de pilar y una flecha) dicen lo que su consulta da en Node para el objetivo que la vista encontró; orbitar con los pilares, las reacciones, los muros y la deformada animada, a una mediana de 8,3 ms entre fotogramas (120 Hz), y ninguna tarea larga, tampoco al pasar el ratón |
| 5 | No se pierde nada | **Pasa.** Los 1 449 tests del repo y los 26 de DOM de `app/` pasan; los bancos de I1, I2 y el adelanto de I4 dan lo mismo (sólo cambian los tiempos, dentro del ruido) |

## 2. Lo que hay

- **Puro, en `src/visor/`:**
  - `pilares3d.ts`: cada tramo, de cota a cota en el eje del pilar, con su N (la mayor compresión de la base y la cabeza) o su ν; bandas con los límites y la paleta de los mapas (en ν, de 0 en pasos de 0,05, así que 0,65 es un límite); rótulos de la mayor compresión, la mayor ν y los tramos que pasan el límite.
  - `reacciones3d.ts`: una flecha vertical (Fz) y una horizontal (Fx, Fy) por objeto con reacciones, en el centro de sus nudos coartados y con una escala común; con varias combinaciones, la de mayor \|Fz\| de cada objeto; los totales de la consulta.
  - `isovalores3d.ts`: superficies «losas» (por defecto), «muros» o «todas»; cada lámina en su plano (x, y en las losas; a lo largo del muro y z en los muros); la lámina de cada triángulo, y `valorEnLamina` para el valor bajo el cursor.
  - `datos.ts`: la deformada con sus extremos; el alzado de un pilar (`datosViga` con un pilar: su envolvente y las plantas que atraviesa); `filasPilarQ` y `compresionTramo`, compartidas por el cuadro y el 3D.
  - `diagramas3d.ts`: el eje de cada tramo con su pieza y sus estaciones, para la sonda.
  - Pedidos nuevos: `pilares3d`, `reacciones3d` y `valor-lamina`; `isovalores3d` admite `superficies`.
- **A4 (y `fem render`):** los campos F11, F22 y F12 (`resultados.ts`), las láminas de los muros por planta (`laminas(planta, "muros")`) y la regla del campo nulo (I4-1). La escala de un mapa lleva su combinación (I4-3).
- **En la app:**
  - un modo nuevo, **Reacciones** (`pantallas/Reacciones.tsx`): flechas en el 3D con su escala, la tabla de la consulta, los totales por combinación y, en Propiedades, el objeto elegido;
  - **Pilares:** el 3D por colores con el selector N/ν, y el cuadro de cualquier pilar elegido, aunque no llegue a la planta activa;
  - **Losas:** F11, F22 y F12, y en el 3D el selector de superficies;
  - **Diagramas:** se puede elegir cualquier viga, vigueta o pilar de cualquier planta; el de un pilar da su alzado con la envolvente (las plantas, a trazos) y su cuadro por tramos;
  - **Deformada:** «Animar» (de 0 a la escala y vuelta, en 1,5 s), la original en gris (las barras y el alámbrico) y los rótulos de sus extremos;
  - **la sonda** (`vistas/sonda.ts` y `Vista3D`): con el cursor quieto ~0,1 s, la vista busca lo que hay debajo (una flecha, un tramo de pilar, el eje de una barra con diagrama o, por un rayo, un triángulo de un mapa) y la pantalla pide su consulta (`estacion`, `valor-lamina`) o usa la que ya tiene (pilares y reacciones). Una respuesta tardía, o de lo que ya no se ve, no se enseña;
  - en la cabecera de cada 3D, la magnitud y la combinación («envolvente de … (n)» o su nombre).
- **Tiempos en el worker, con el edificio objetivo:** pilares por colores, 0,23 s la primera vez (luego 15 ms); reacciones, 12 ms; deformada, 9 ms; una sonda, ≤ 1 ms con el SPR ya hecho (la primera estación de una pieza, 0,18 s). M11 de losas y muros de todas las plantas del núcleo, 62 ms.

## 3. Hallazgos

- **I4-1. Las fuerzas de membrana de las losas con diafragma rígido son ruido.** En el edificio objetivo y en el núcleo, F11, F22 y F12 de las losas salen de 1e-16 a 1e-12 kN/m: el diafragma impide el alargamiento de la losa y el atado lo lleva él (C1-d). Pintarlas con la escala completa daba diez bandas de ruido y el aviso de picos («de 0,0 a 0,0»). Regla nueva, en A4 y en el 3D: si el mayor \|valor\| de lo que se ve es menor que 1e-9 (`CAMPO_NULO`), el mapa es de una sola banda neutra, sin extremos rotulados ni aviso de picos, y la nota lo dice con el valor. `fem render` lo marca con `nulo` en la escala del JSON.
- **I4-2. Los ejes de los muros son siempre los mismos.** El compilador numera los nudos de cada lámina de muro a lo largo del eje y hacia arriba con `eje1` a lo largo del eje: eje 1 a lo largo del muro desde su primer punto, eje 2 hacia arriba y eje 3 a su derecha, en todas sus láminas. Así M11, M22 y F12 de un muro tienen un signo que se puede explicar (la nota lo hace), sin tener que reorientar nada.
- **I4-3. `valor-punto` sacaba la combinación dibujada del extremo rotulado.** Con un campo nulo no hay extremos y el valor del punto salía «sin mapa». La escala del mapa (`EscalaDibujada.combinacion`) lleva ahora la combinación, en la planta y en el 3D.
- **I4-4. Una flecha de reacción puede no tener longitud.** 1-022 tiene un solo caso, la carga lateral, y la Fz del pilar central sale 1e-15 kN (cero por antisimetría) frente a 311 kN en los extremos: su flecha mide 5e-18 m y en Float32 no tiene sentido. Sus valores están en la tabla y bajo el cursor; el test comprueba el sentido de las flechas de más de 1 mm.
- **I4-5. Las reacciones por defecto son los casos sueltos.** Como `fem consultar reacciones` (propósito «lineal»), por defecto se ven los casos y cada objeto con el de su mayor \|Fz\|; en el edificio objetivo, G en todos. Para una combinación, el selector.
- **I4-6. Con la sonda, la vista avisa sólo si cambia lo de debajo.** Cada movimiento quieto busca de nuevo, pero sólo se pide la consulta si el objetivo cambia (la pieza y la estación al milímetro, la lámina y el punto al centímetro, el tramo o la flecha). En el banco, la búsqueda en el mapa de N3 (29 408 triángulos) no hizo ninguna tarea larga; con el de todas las plantas (207 318) no se ha medido.

## 3.1 Después de I4: reacciones en planta y en alzado (2026-10-12)

A petición del usuario, que veía las reacciones sólo en el 3D (`interfaz.md` §15, la viñeta de Reacciones):

- **`src/agente/render/reacciones.ts`:** `reaccionesObjetos` (la combinación de cada objeto, la que usa también `reacciones3d`), `vistaReacciones` (planta; la vista `reacciones` de `fem render`) y `vistaAlzadoReacciones` (alzado). `vistaAlzado` admite `abajo`, el sitio libre bajo la planta más baja antes de las burbujas de los ejes.
- **En la sesión:** la vista de planta `reacciones` y el alzado con `reacciones` (como con `diagramas`). En la app, el modo Reacciones ya no pasa una vista al 3D al entrar: la planta y el alzado tienen las suyas, la escala de las flechas va en la barra, la tabla dice la planta de cada objeto y una planta sin apoyos ofrece ir a las que los tienen.
- **Selector de combinaciones:** sin combinaciones del generador, `EstadoSesion.sinCombinaciones` dice por qué (el mensaje de la consulta y los casos sin acción), y el selector lo enseña como una opción desactivada.
- **Validación:** en `src/visor/i4.test.ts`, en los cuatro proyectos de V1, cada Fz y cada (Fx, Fy) de la planta, y Fz y la componente en el plano del alzado, son los de las flechas del 3D, bit a bit; cada objeto sale en una sola planta; con cada caso, la suma de las Fz de todas las plantas es el total de la consulta a 1e-9; las verticales del alzado acaban en la cota de su objeto. En `visor.test.ts`, la escena de planta da el SVG de `fem render` byte a byte. En la app, la tabla con la planta y el aviso del selector.
- **No medido:** el banco de Chrome (`validacion/i4/chrome.ts`) no se ha vuelto a pasar con las vistas nuevas.

## 4. Validación

- `src/visor/i4.test.ts` (37 tests en los cuatro proyectos de V1): pilares, reacciones, muros, sonda, deformada, alzado de un pilar, ejes de los diagramas, F11…F12 en la planta y el protocolo sin resultados.
- `src/visor/resultados3d.test.ts` (el adelanto) sigue pasando con la escala que lleva su combinación.
- `app/src/test/pantallas.test.tsx`: la tabla de Reacciones y las sondas de un tramo de pilar y de una estación, con el formato de la pantalla.
- `validacion/i4/chrome.ts` (`out_chrome.txt`), ampliado: el edificio objetivo y el núcleo.

## 5. Pendiente

- **Del usuario:** la puerta de uso de I4 y las propuestas de §15: las flechas de las reacciones (en el centro de los nudos coartados, la vertical y la horizontal con la misma escala), la combinación de cada objeto con varias, el campo nulo (I4-1) y las bandas de ν.
- **Fuera de I4 (§15):** el valor bajo el cursor en la planta y en el alzado (allí sigue siendo el clic); isolíneas rotuladas en el 3D; las reacciones de los muros nudo a nudo; la deformada en el alzado.
- **Técnico:** la primera M11 de todas las plantas del edificio sigue costando ~3,5 s (la recuperación SPR, C5-4); medir la sonda sobre el mapa de todas las plantas (I4-6).
