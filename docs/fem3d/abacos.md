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
