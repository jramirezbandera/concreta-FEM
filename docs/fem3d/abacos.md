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
