# Fase V2b — muros, forjados y bandas en la app: resultado

> **Fecha:** 2026-10-13. **Plan:** `visor.md` §7 (lo que se fijó al empezar, aceptado por el usuario con sus decisiones de §7.4).
>
> **Veredicto: V2b pasa los criterios 1 a 4, y el 7 en sus valores. Los tiempos de los criterios 5 y 7 quedan a medias, y el 6 (puerta de uso) es del usuario.**
> - **Todo el modelo físico se edita ya en la app.** Sólo quedan fuera las opciones de compilación y los perfiles I del catálogo.
>   - Hay tablas de muros (con sus huecos), paños, apoyos lineales y bandas.
>   - El reticular va en columnas de la tabla de losas, y los empujes, en la de cargas.
>   - La barra tiene Forjado, Muro, Apoyo lineal, Banda, «Proponer bandas» y, en Cargas, Empuje.
> - **Bandas (decisiones a y b).**
>   - Al cambiar una banda, pasa a ser del usuario y sus apoyos se recalculan. En una banda propuesta sin tocar, el recálculo da sus apoyos bit a bit.
>   - «Proponer bandas» rehace las propuestas y deja las del usuario. Una propuesta que se solapa con una del usuario no entra, y el diálogo lo dice.
>   - Si un pilar cambia después, el compilador avisa con `banda/apoyos-desfasados`.
> - **Resultados · Bandas (decisión d).**
>   - En planta, el My de cada estación de cada banda. Es la vista `bandas` de A4, que también sale con `fem render`.
>   - Una tabla por planta y, para la banda elegida, sus estaciones, Wood–Armer y el momento por nervio, más el reparto pilares/central.
>   - Todo coincide con las consultas bit a bit, en Node y en Chrome.
> - **Tiempos, en Chrome.**
>   - Ninguna tarea larga en el hilo principal.
>   - «Proponer bandas» tarda 0,10 s.
>   - En el reticular de V2 (52 125 nudos), los diagnósticos de un cambio salen en 2,0 s, por encima de 1,5 s: es lo que tarda en compilar (V2b-4).
>   - La tabla de bandas de la primera planta tarda 2,17 s, por encima de 1 s. El detalle de una banda, 0,05 s.

## Criterios

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Ida y vuelta: mismo modelo, misma huella y mismos bytes; cada objeto sale igual de su fila, sin nada a escondidas | **Pasa.** Seis proyectos: muros y empujes, núcleo, reticular, unidireccional, bandas propuestas y uno variado (reticular con multiplicadores, paño con hueco, apoyo lineal y banda del usuario). Cada objeto sale igual de su fila sin `base`; las bandas, con el origen «usuario» y los apoyos recalculados, que son los suyos | `src/editor/v2b.test.ts` |
| 2 | Las operaciones nunca rompen el fichero | **Pasa.** 13 sucesiones más de 40 pasos sobre los seis proyectos, con las tablas nuevas entre las editables | `src/editor/editor.test.ts` |
| 3 | Los modelos de C3, C4 y C5 se reconstruyen desde vacío; un muro con hueco y empuje y un paño con su carga, tecleados en el DOM | **Pasa.** Los seis, pegando sus tablas (las bandas propuestas, con «Proponer bandas»), con su huella; el test de DOM da la huella del modelo escrito a mano | `v2b.test.ts`; `app/src/test/editor.test.tsx` |
| 4 | Las bandas del usuario nunca se pierden en silencio; proponer dos veces no cambia nada | **Pasa.** Proponer otra vez rehace las propuestas, deja las del usuario y no añade la que se solapa con una suya; por plantas no toca las demás; un modelo que no vale no propone nada y lo dice | `v2b.test.ts` |
| 5 | Reticular de V2: sin tareas largas; diagnósticos ≤ 1,5 s; proponer ≤ 1 s | **A medias.** 0 tareas largas al escribir y al pegar 80 filas; proponer, 0,10 s, con la huella de Node; los diagnósticos, 2,0 s (V2b-4) | `validacion/v2b/chrome.ts`, `out_chrome.txt` |
| 6 | Puerta de uso | **Pendiente del usuario** | — |
| 7 | Resultados · Bandas: los valores de la pantalla, los de `fem consultar banda` bit a bit; la primera banda de una planta en ≤ 1 s | **Valores: pasa. Tiempo: a medias.** En Node y en Chrome, los My de las filas, las estaciones, Wood–Armer, la escena y el reparto son los de las consultas bit a bit. La tabla de la primera planta tarda 2,17 s en Chrome, y el detalle de una banda, 0,05 s (V2b-3) | `src/visor/bandas.test.ts`; `app/src/test/bandas.test.tsx`; `out_chrome.txt` |

Las baterías completas pasan: 1 626 tests en la raíz y 31 en la app, con las referencias congeladas de C2–C5 sin cambiar.

## 1. Qué hay nuevo

- **`src/editor/tablas.ts`:**
  - **Muros:** el eje con «x y; …», desde, hasta, espesor, material, base y huecos como «desde hasta z0 z1 | …».
  - **Paños:** contorno, huecos, dirección, intereje, sección y pp.
  - **Apoyos lineales:** planta, puntos y GDL coartados.
  - **Bandas:** planta, extremos, ancho y tipo. El origen y los apoyos son de sólo lectura.
  - **Losas:** el reticular en columnas. Una losa es reticular si tiene intereje; si no, las demás columnas del reticular tienen que ir vacías. Los multiplicadores se escriben por su nombre: `m11=0,32 m22=0,27`.
  - **Cargas:** la variante empuje, con el muro en «sobre», el lado y z0, z1, p0 y p1.
- **`src/editor/celdas.ts`:** dos formatos nuevos.
  - Grupos de números separados por «|» (los huecos de un muro).
  - Valores con nombre (los multiplicadores), en (0, 100] y sin repetir.
- **`src/compilador/bandas.ts`:**
  - `apoyosBanda` / `apoyosBandaEn` (V2b-a): las alineaciones de pilares de la losa de la banda que caen en su ancho o, si no cae ninguna, la más cercana a cada lado, con las caras comunes de C5-g.
  - `avisarApoyosBandas`, que se llama al compilar.
- **`src/editor/bandas.ts`:** `propuestaBandas`, lo que cambia por planta y que se enseña antes de aplicarlo, y la operación `proponerBandas`.
- **Copiar a plantas:** copiar una banda a otra planta la hace del usuario, con los apoyos de los pilares de esa planta.
- **App:**
  - herramientas nuevas en la barra;
  - las tablas nuevas se filtran por planta;
  - las pestañas de las tablas se desplazan en horizontal;
  - diálogo «Proponer bandas»;
  - el inspector es un formulario para todos los objetos;
  - la fila nueva puede venir con celdas puestas: Empuje pone el tipo y el caso activo.
- **Resultados · Bandas:**
  - `src/agente/render/bandas.ts` (vista `bandas` de A4 y de `fem render`): un palo por estación, perpendicular al eje, con el máximo a un lado y el mínimo al otro, y rotulado el que gobierna (el mínimo en una cara, el máximo en un vano). Las estaciones son discretas, así que no se dibuja una curva continua.
  - `src/visor/bandas.ts` (pedidos `bandas` y `banda`).
  - `app/src/pantallas/Bandas.tsx`: dirección 1, 2 o las dos.

## 2. Hallazgos

| # | Hallazgo | Consecuencia |
|---|---|---|
| V2b-1 | La propuesta medía los apoyos desde el extremo sin redondear, y la banda guarda el redondeado a 1e-9. Recalcular desde el guardado difería en 1e-9 en la geometría circular de G | La propuesta mide ahora desde el `desde` que guarda. Ninguna referencia congelada cambia |
| V2b-2 | En la fila nueva, el objeto se crea en cuanto tiene sus datos obligatorios. Al teclear un muro, los huecos escritos después del material iban a una fila nueva vacía (lo encontró el test de DOM) | Es el comportamiento de V2a. Las columnas opcionales se escriben antes que la última obligatoria, o después en la fila ya creada. Ver «Pendiente» |
| V2b-3 | La primera banda de la planta del edificio objetivo tardaba 2,6 s en Bun. Las bandas rehacían lo que el render ya tenía: su propio SPR, su propio `DiagramasBarras` y las cargas equivalentes de todas las láminas del modelo para unas pocas caras | `Consultas.campos` y `Consultas.cortes`, compartidos con los mapas de A4. `CamposLaminas.evaluadorCompartido`. Las equivalentes de cada lámina se preparan cuando se piden (`FuerzasNodales`). Los mismos bits. En Bun, la primera banda baja a 0,96 s, la primera de otra planta a 0,43 s y las demás a ~35 ms. En Chrome, la tabla de la primera planta baja de 2,54 a 2,17 s |
| V2b-4 | En el reticular de V2, compilar tarda 1,9–2,5 s, así que los diagnósticos de un cambio no bajan de 2 s. Es el riesgo que dejó abierto V2a-3; ninguna de sus dos salidas lo arregla, porque el tiempo es del compilador | Criterio 5 a medias. Ver «Pendiente» |
| V2b-5 | Dos bandas perpendiculares siempre se cruzan, así que el solape que impide añadir una propuesta sólo cuenta entre bandas de la misma dirección, con más de un 0,1 % del área de la menor | `solapan` en `src/editor/bandas.ts` |

## 3. Pendiente

- **Del usuario:**
  - el criterio 6: meter un proyecto suyo con muros y un forjado reticular o unidireccional, proponer y retocar las bandas, calcularlo y revisarlo;
  - decidir sobre los tiempos de los criterios 5 y 7: aceptarlos, o abrir una de las salidas técnicas de abajo.
- **Técnico, si el usuario lo pide:**
  - **Diagnósticos en modelos grandes (V2b-4):** perfilar el compilador en el reticular de V2 (malla y huellas de los ábacos) o compilar por plantas lo que cambia. Es trabajo del compilador, no de la app.
  - **Primera banda de una planta (V2b-3):** lo que queda es el SPR de la planta (~0,8 s) y preparar los cortes del modelo (~0,5 s, una vez). Se arregla con C5-4 (el SPR de todos los casos a la vez), aplazado por el usuario, o adelantando el SPR al entrar en Resultados, como hace Losas con `precalentar`.
  - **Fila nueva (V2b-2):** crear el objeto al salir de la fila en vez de al completar lo obligatorio, si en la puerta de uso molesta.
- **Siguen:** V2c (dibujar con el ratón), las puertas de uso de V1, V2a e I1–I4, y E4-9.
