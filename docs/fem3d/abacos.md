# Fase AC: los ábacos, uno a uno

A petición del usuario (2026-11-06): «ahora mismo no se pueden editar y si se solapan no se dibujan, por lo que es difícil. Tampoco se pueden unir dos».

## 1. Cómo estaban

- **En el fichero**, los ábacos son polígonos sueltos de la losa (`reticular.abacos`) o la regla `abacosPilares` (MA2). No tienen id ni se eligen: un clic en uno elige la losa.
- **Para crearlos** sólo estaba el diálogo «Ábacos» (`editor/abacos.ts`), uno en cada pilar. **El que solaparía con otro no se creaba**: eso es el «no se dibujan». No estaba y no se veía; sólo lo nombraba la lista del diálogo.
- **Para editarlos**, el texto de la celda «ábacos» de la tabla Forjados, o arrastrar un vértice con la losa elegida, que deforma el rectángulo.
- **La unión ya existía, pero oculta.** El compilador une los que se solapan o quedan a menos de h/2 en su rectángulo envolvente según los nervios (MA-c, `compilador/abacos.ts`), con el aviso `reticular/abacos-unidos`. El dibujo enseña ese rectángulo, pero el fichero conserva los de antes: lo que se ve no es lo que se edita, y no hay manera de pedir «une estos dos».

## 2. Decidido por el usuario (2026-11-06)

- **AC-a, la forma de la unión: el rectángulo envolvente** según los nervios, la regla del compilador (MA-c). Ningún cálculo de hoy cambia.
- **AC-b, al solapar: se unen en el acto.** Al crear, mover, copiar o estirar un ábaco que solapa con otro (o queda a menos de h/2), en el mismo paso de deshacer queda uno solo en el fichero, y se dice con cuál se unió. Lo que se ve es lo que hay.
- **AC-c, en el fichero: dentro de la losa, como hasta ahora** (`reticular.abacos`). La app los trata como objetos, sin cambiar el formato ni la huella.
- **AC-d (2026-11-07): un reticular lleva siempre un ábaco en cada pilar.** Antes nada impedía calcular un reticular sin ellos. Ahora un pilar que llega a un reticular (el eje del tramo que lo atraviesa, en la losa; la regla de `abacosPilares`) sin un ábaco en el que caiga su eje (dentro o en su borde) es el error `reticular/pilar-sin-abaco`, con la losa y los pilares, y no se calcula (§6).
- **AC-e (2026-11-07): los ábacos que pone el programa, según las luces.** Desde el eje del pilar, a cada lado y en cada dirección de los nervios, el 15 % de la luz de ese lado, redondeado a casetones enteros, y al menos hasta el perímetro crítico (2d desde la cara del pilar). Hacia un borde sin vano, hasta el borde (§7).

## 3. Lo que se hace

1. **Cada ábaco se elige solo.** Su id de selección es `<losa>/A<n>`, por su orden en `reticular.abacos`. No es un id del modelo: no se guarda ni lo usa el agente. Un clic lo elige antes que a la losa (el polígono menor gana), y la ventana también lo coge.
   - Los de `abacosPilares` siguen siendo de la losa. Su ficha ofrece «Fijar como polígonos», que los deja en `reticular.abacos` tal como los calcula el compilador; a partir de ahí se editan uno a uno.
   - Uno que el compilador une a otros (datos del agente a menos de h/2) se elige por el primero de los suyos, y su ficha lo dice con «Unir».
2. **Propiedades de un ábaco:** su forjado. Si es un rectángulo según los nervios, a × b y su centro; si no, sus vértices. Se puede escribir en cada campo. Tiene los botones «Unir» (con dos o más elegidos del mismo forjado) y «Borrar».
3. **Supr, Mover, Copiar, Girar y Simetría** sobre los ábacos elegidos. Un ábaco se queda siempre en su forjado: copiar a otras plantas no lo lleva.
4. **Pinzamientos.** En un rectángulo según los nervios, un vértice se arrastra con el opuesto fijo y un lado se mueve en paralelo, así que sigue siendo un rectángulo. En otro polígono, el vértice se mueve solo, como hasta ahora. La losa elegida ya no enseña los vértices de sus ábacos.
5. **La herramienta «Ábaco»** en la barra de Modelo, en lugar del diálogo. Un clic en un pilar pone un a × b centrado en el eje de su tramo; dos clics hacen un rectángulo según los nervios. «En todos los pilares» queda en su plantilla y los solapados se unen (AC-b), en vez de saltarse.
6. **«Unir»**, con dos o más elegidos: su rectángulo envolvente. Si toca a otros, se unen también.

## 4. Criterios

1. Lo dibujado de un ábaco elegido es lo de su polígono del fichero, y tras cada operación el fichero no tiene dos ábacos que el compilador uniría: `resolverAbacos` lo deja igual.
2. Crear con solape, unir, mover, estirar y borrar dan byte a byte lo que se escribiría a mano en la tabla, y deshacer da los bytes de antes.
3. Los proyectos que no se tocan no cambian: ni la huella, ni el SVG de `fem render`, ni las referencias congeladas.
4. La puerta de uso, del usuario: crear, unir y retocar los ábacos de la vivienda con el ratón.

## 5. Hecho (2026-11-06)

Pasan los criterios 1 a 3; el 4 (puerta de uso) es del usuario.

- **Núcleo** (`src/editor/abacos.ts`, puro):
  - `idAbaco` y `leerIdAbaco`, que no casa con un id del modelo;
  - `rectanguloDe`, que reconoce un rectángulo según los nervios;
  - `unirComoCompilador` y `escribirAbacos`, la regla de `abacosLosa` aplicada al fichero;
  - `crearAbaco`, `cambiarAbaco`, `cambiarAbacos`, `borrarAbacos`, `unirAbacos` y `fijarAbacosPilares`;
  - `asasAbaco` y `moverAsaAbaco`.

  Cada operación dice lo que hay que dejar elegido, porque un ábaco unido cambia de id. «Ábacos en los pilares» ya no se salta los solapados: los une.
- **Mover, Copiar, Girar, Simetría y los pinzamientos** (`transformar.ts`, `dibujo/editar.ts`): con ábacos elegidos, salvo los de una losa que también se elige. Copiar no los lleva a otras plantas, y se avisa. La losa elegida ya no enseña los vértices de sus ábacos.
- **La herramienta Ábaco** (`dibujo/abaco.ts`): en un pilar, a × b (2,40 por defecto) centrado en el eje del tramo que atraviesa el reticular; o un rectángulo de dos esquinas según los nervios del reticular del primer clic. Un pilar que ya tiene ábaco da error y dice cuál es.
- **El dibujo** (`render/modelo.ts`): cada ábaco lleva su id de selección. Uno que el compilador une a otros lleva el del primero de los suyos, y los de `abacosPilares`, el de la losa. El SVG de `fem render` no cambia, porque no escribe el objeto.
- **En la app:**
  - «Ábaco» en la barra de Modelo, con su plantilla y «En todos los pilares…» (el diálogo de antes);
  - Propiedades de uno: a × b y centro, editables; de un polígono, sus vértices. De varios: «Unir». Con todos: «Borrar»; Supr también borra;
  - la ficha del forjado tiene «Fijar como polígonos» si lleva ábacos en los pilares;
  - al cambiar de planta se sueltan los ábacos de otra.
- **Validación:**
  - `src/editor/abacosAC.test.ts`: cada operación deja el fichero como lo resuelve el compilador, sale byte a byte lo escrito a mano y el clic en la escena elige el ábaco antes que la losa;
  - `src/editor/abacos.test.ts`, con los solapados unidos;
  - `app/src/test/fichaAbaco.test.tsx` y `editor.test.tsx`;
  - la batería de `src/editor`, `src/agente/render` y `src/visor` (811 pruebas) y la de la app (122);
  - a mano en la app con el muestrario: un clic en el ábaco de P6 lo elige con sus ocho asas, y ensancharlo a 9,5 m lo une con los de P5 y P7 en uno de 14,4 × 2,4 m.

## 6. AC-d, el ábaco obligatorio (2026-11-07)

- **`pilaresSinAbaco` y `errorPilaresSinAbaco`** (`src/compilador/abacos.ts`): por cada reticular, los pilares de `pilaresEnLosa` cuyo eje no cae en ninguno de los ábacos resueltos (los dados, los de `abacosPilares` y los unidos). El compilador da el error detrás de la validación, para que los errores de datos vayan antes. Un pilar en un hueco o fuera de la losa no lo necesita; una maciza, tampoco.
- **No cambia ningún modelo válido:** los edificios objetivo, la vivienda, el muestrario, los generadores de `src/pruebas` y las referencias congeladas ya llevaban un ábaco en cada pilar (sus pruebas pasan igual). Sólo cambian modelos hechos a mano en las pruebas: el de las entradas no válidas de C4 (ábacos también en los pilares de esquina, y una entrada nueva sin el de C0-0), el recuadro de `pesoAncho.test.ts` (`abacosPilares` de 1 × 1, que no llegan a la viga plana) y uno de `abacosPilares.test.ts`.
- **Prueba:** `src/compilador/pilarSinAbaco.test.ts`.
- **Hecho después** (§7): la herramienta Forjado los pone al dibujar un reticular.

## 7. AC-e, los ábacos según las luces (2026-11-07)

Decidido por el usuario: «0,15·L por lado», «casetones enteros» y, al ver los de luces cortas, «el perímetro crítico» como mínimo.

- **La regla** (`proponerAbacosLuces`, `src/editor/abacos.ts`). En cada una de las cuatro direcciones de los nervios (±eje 1, ±su perpendicular), desde el eje del tramo del pilar que atraviesa el forjado:
  - con un vano, 0,15·L. L es el avance hasta el pilar más cercano de la planta en esa dirección: de los que caen en su cono de ±45°, el de menor avance; vale también uno de otro forjado de la planta. Con vanos distintos a los dos lados, el ábaco sale asimétrico;
  - al menos 2d desde la cara del pilar, con d = canto − 3 cm (`RECUBRIMIENTO_MECANICO`): el perímetro de control del punzonamiento (Código Estructural 6.4.2). En un 30 de canto y un pilar de 30, 0,69 m desde el eje;
  - sin vano (pilar de borde o de esquina, voladizo), hasta el borde del forjado, exacto y sin redondear; si el borde queda más lejos, lo del lado contrario. Sin vano a ningún lado, 1,2 m como mucho;
  - lo demás crece hasta la cara del siguiente casetón de la retícula del sólido (`reticulaCasetones`, ahora compartida con `visor/solido.ts`, que da los mismos bits). Así el ábaco no corta ningún casetón y el nervio de su borde queda dentro;
  - los que se solapan o quedan a menos de h/2 se unen, como siempre (AC-b).
- **Dónde se usa:**
  - en la herramienta Forjado, la casilla «Con ábacos» (en un reticular, marcada por defecto). En el mismo paso, los ábacos de los pilares que llegan al forjado; sin pilares, sale sin ábacos y lo avisa;
  - en «En todos los pilares…» de la herramienta Ábaco, «Según las luces» por defecto, o «De una medida» como antes;
  - `abacosPilares` del fichero y el clic en un pilar con la herramienta Ábaco siguen con su medida fija.
- **Medido** (`validacion/ac/lucesMuestrario.ts`, `out_lucesMuestrario.txt`):
  - en el muestrario (luces de 6 a 8 m e intereje de 0,80), los interiores salen de 2,52 × 2,52 m, frente a los 2,40 × 2,40 dibujados a mano;
  - en la vivienda, la cubierta L-CUB sale con 11 ábacos, como la suya, con las tres parejas que se unieron a mano (P1+P7, P18+P22, P19+P23). Sin el mínimo del perímetro crítico, P22 y P18, a 1,87 m, daban 0,67 × 0,34 m cada uno. En L-CUB-S salen 9 en lugar de 10, porque P5 y P8 se unen;
  - los de borde quedan más estrechos que los dibujados (0,83 m frente a 2,00), porque acaban en el borde en lugar de salirse de la losa. Lo que se salía no contaba.
- **Pruebas:** `src/editor/abacosLuces.test.ts` (los mínimos y el redondeo, los lados en la cara de un casetón, el borde y el voladizo, la regla girada 30° y que compila) y `dibujo2.test.ts` («Con ábacos» da lo mismo que dibujar sin ellos y añadir los de «Según las luces» después, y avisa sin pilares).
- **Sin contrastar:** la regla frente a los ábacos que pone CYPECAD en el mismo modelo.
