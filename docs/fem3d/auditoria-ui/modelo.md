# Auditoría UX/UI · espacio Modelo (dibujar y editar)

- **Fecha:** 2026-11-01.
- **Cómo:** con el navegador sin interfaz de gstack (1600×900 y 1366×768) contra `http://localhost:5180`. Las pruebas:
  - un proyecto nuevo dibujado desde cero:
    - plantas con el gestor;
    - ejes tecleados;
    - sección nueva;
    - pilares con un clic y con ventana;
    - vigas con clics y tecleadas;
    - cuatro forjados por recuadro;
    - un hueco con zunchos;
    - un muro con un hueco;
    - «A plantas», estirar con cota, mover un pilar con su cota y pinzamientos;
    - Mover y Copiar;
    - borrar con Supr y con la herramienta;
    - Renumerar, el gestor de materiales, la hoja y el tema oscuro;
  - también `?ejemplo=vivienda`.
- **Errores provocados a propósito:**
  - unidades en cm donde van m;
  - texto en las coordenadas;
  - un punto a 1 km;
  - Esc y Retroceso a mitad de dibujo;
  - borrar algo que tiene referencias.
- **Capturas:** en esta misma carpeta (`C:/Users/javie/AppData/Local/Temp/claude/d--PROGRAMACION-Concreta-FEM/0145a65a-536f-4c1a-bd43-d6b6eb76a5bd/scratchpad/auditoria/modelo/`). Se citan por su nombre.
- **Qué significa cada marca de «Verificado»:**
  - «navegador»: lo hice y lo vi;
  - «código»: lo deduje leyendo la fuente.
- **Una salvedad:** los clics en el lienzo se simularon con `PointerEvent` sobre `.celda-superficie`, como hacen los bancos de `validacion/v2c`. El teclado y los botones, con eventos reales de Playwright.

---

## Alta

### M-01 · Mover un pilar deja atrás, sin avisar, las vigas que pasan por él
**Severidad:** alta

**Dónde:**
- Modelo, planta, con un pilar elegido: sus cotas temporales (CT3) y los campos x/y de Propiedades;
- `src/editor/estirar.ts:316-345` (`moverPilar`).

**Qué pasa:**
- Dibujé las vigas de los ejes B y 2 tecleando sólo sus extremos (`0;5` → `12;5`, `6;0` → `6;10`). Es lo natural para una viga continua, y no deja ningún vértice en los pilares intermedios.
- Elegí P6 (6; 5), Tab, `4,5` e Intro. El pilar se fue a x = 4,5 y la viga V5 siguió en x = 6, ahora sin apoyo a media luz.
- No salió ningún aviso de vigas: sólo tres `malla/pilar-tapado-sin-refinar`, muy técnicos.
- `moverPilar` sólo arrastra las vigas que tienen un vértice en el punto fijo, y sólo avisa de las que tienen un vértice en la huella. Una viga que *atraviesa* el pilar no cuenta.
- Lo mismo al cambiar x en Propiedades: P3 a x = 8 deja la viga del eje 2 donde estaba, sin ningún aviso.
- El modelo estructural cambia en silencio.

**Propuesta:**
- Tratar como «unidas al pilar» también las vigas cuyo eje pasa por la huella:
  - partirlas en el pilar al moverlo y arrastrar el vértice nuevo;
  - o, como mínimo, avisar: «V5 pasa por P6 y se queda donde estaba».
- Aplicar la misma regla al editar x/y en Propiedades o en la hoja, o avisar igual.
- Otra vía: que la herramienta Viga meta un vértice en cada pilar que cruza, como hacen los programas de pórticos.

**Captura:** `46-tab-cota.png` (antes), `47-mover-pilar.png` (después: P6 en 4,50 y la viga en el eje 2), `48-avisos-mover.png` (sólo avisos de malla), `89-blur.png` (P3 movido desde Propiedades)

**Verificado:** navegador (las dos vías); la causa, en el código

### M-02 · Unidades mezcladas (cm en el gestor, m en la hoja y en Propiedades): un 30 o un 25 en metros entra sin protesta
**Severidad:** alta

**Dónde:**
- el gestor de secciones (b y h en cm);
- la hoja Secciones (b y h en m);
- Propiedades del forjado (canto en m, y su croquis dice «Losa maciza de 2500 cm»);
- la plantilla de Muro (espesor en m).

**Qué pasa:**
- En el gestor escribí b = 30 (cm). En la hoja, sobre la misma celda b, escribí `30`: se aceptó como 30 m.
  - Todos los pilares y las vigas pasaron a medir 30 m de ancho.
  - El modelo pasó a «NO COMPILA» con dos errores crípticos (`topologia/tramo-degenerado … el encuentro es ambiguo`).
- En Propiedades de L1, canto `25` se aceptó como 25 m.
  - El modelo *compila*: sólo sale un aviso en la pestaña Diagnósticos.
  - Si se pulsa Calcular, se calcula una losa de 25 m.
- El campo no avisa nada al escribir.

**Propuesta:**
- Una sola unidad para las dimensiones de sección en toda la app, o mostrar siempre la unidad dentro de la celda (en la cabecera ya está, pero no basta).
- Validación en línea: borde ámbar y «¿25 m? ¿no serán 25 cm?», con un botón «Usar 0,25». Así se ataja en el campo y no tres paneles más allá.
- Aceptar sufijos («30cm», «25 cm») y convertirlos. Hoy «30cm» da «mayor que 0», que además confunde.

**Captura:** `10-gestor-seccion.png` (cm), `32-tabla-b30.png` (30 m en la hoja), `33-diag-30m.png`, `61-canto-25.png`

**Verificado:** navegador

### M-03 · Borrar una sección en uso propone por defecto borrar todo lo que la usa
**Severidad:** alta (se pierde la estructura de un Intro; se recupera con Ctrl+Z)

**Dónde:**
- Tablas › Secciones › Borrar;
- `app/src/editor/Dialogos.tsx:70` (`useState("borrar")`).

**Qué pasa:**
- Borré P30x30 desde la hoja. El diálogo «15 objetos usan lo que se borra» trae marcada la opción «Borrarlos también»: 16 objetos, es decir, todos los pilares y las vigas.
- «Borrar» es el botón primario, así que un Intro distraído deja la planta vacía.
- La lista habla con nombres de campo crudos (`seccion = P30x30`, sin tilde). La frase «los tramos de pilar sólo pierden el tramo» no se entiende.

**Propuesta:**
- Que por defecto esté marcada «Pasarlos a otro», con el desplegable de destino, o ninguna, con el botón desactivado hasta elegir.
- Si se borra en cascada, que el botón diga «Borrar 16 objetos».
- Redactar la lista en lenguaje de obra: «P1 · pilar (sección P30x30)».

**Captura:** `35-borrar-seccion.png`

**Verificado:** navegador y código

---

## Media

### M-04 · Borrar un forjado deja huérfanos los zunchos de su hueco, y el diálogo dice «Nada más usa este objeto»
**Severidad:** media

**Dónde:**
- herramienta Borrar sobre un forjado con un hueco hecho con «Con zunchos»;
- `app/src/editor/Dialogos.tsx:107`.

**Qué pasa:**
- Borré L1-N2. El diálogo asegura «Nada más usa este objeto».
- Tras borrar, las cuatro vigas Z-L1-1…4-N2 quedan flotando en el vacío, como un anillo de vigas sin forjado.
- Diagnósticos: 0.

**Propuesta:**
- Que los zunchos que creó «Con zunchos» se ofrezcan en el diálogo como dependientes («y sus 4 zunchos»), marcados por defecto.
- Avisar de vigas sin ningún apoyo ni losa.

**Captura:** `82-borrar-forjado.png`, `83-forjado-borrado.png`

**Verificado:** navegador

### M-05 · Supr borra en el acto y sin decir nada; la herramienta Borrar pide confirmación
**Severidad:** media

**Dónde:**
- Modelo, con algo elegido: tecla Supr;
- `app/src/espacios/Modelo.tsx:282-293`.

**Qué pasa:**
- Supr con P2 elegido lo borró al instante. No salió nada: ni un ✓ «P2 borrado · Ctrl+Z» ni un cambio en Propiedades (vuelve a la ficha de la planta).
- Las dos vigas de esa esquina quedaron en voladizo, y Diagnósticos seguía en 0.
- Con la herramienta Borrar, el mismo objeto pide un diálogo («Borrar L1-N2 · Nada más usa este objeto»). Son dos comportamientos para la misma acción.

**Propuesta:**
- Unificar. Lo más cómodo:
  - Supr y la herramienta borran en el acto lo que nada usa;
  - en ambos casos sale el mismo ✓ verde de las herramientas de dibujo («Borrado P2 · Ctrl+Z»).
- Avisar cuando un pilar borrado deja vigas sin apoyo.

**Captura:** `58-supr-pilar.png`

**Verificado:** navegador y código

### M-06 · Un clic sin enganche guarda coordenadas con 16 decimales
**Severidad:** media

**Dónde:** Pilar, Hueco y cualquier herramienta con clic libre; la hoja y Propiedades.

**Qué pasa:**
- Un pilar puesto en un punto sin enganche quedó en x = `5,130294802570366` e y = `6,420701479294933`. La barra de estado decía «x 5,13 · y 6,421».
- El contorno de un hueco dibujado a mano sale como `2 2,0000000000000001; 3,5000000000000018 …` en la hoja y en Propiedades.
- Lo enganchado de un DXF se redondea a 1 mm (V2c4-c), pero lo libre no se redondea nada.
- Las tablas se vuelven ilegibles y dos pilares puestos «a ojo» en la misma fila no quedan alineados.

**Propuesta:**
- Redondear el clic libre a un paso configurable, junto a «Rejilla»: 1 cm por defecto, o 1 mm. Lo enganchado sigue exacto.
- Mostrar en la hoja los números con un formato que no saque el ruido de la coma flotante (12 cifras significativas, como hace ya el gestor con `escrito`).

**Captura:** `26-tabla-forjados.png` (hueco), `56-croquis.png`

**Verificado:** navegador

### M-07 · La plantilla de Viga propone una sección de pilar
**Severidad:** media

**Dónde:** Modelo › Viga › Propiedades › sección.

**Qué pasa:**
- Con sólo la sección P30x30 creada para los pilares, la herramienta Viga la trae elegida. No ofrece «Nueva sección…», que sí hace Pilar cuando no hay ninguna.
- Dibujé seis vigas de 30×30 con un id «P…» sin darme cuenta.
- La ficha de la viga muestra luego «P30x30».

**Propuesta:** si no hay ninguna sección de uso «viga», que la plantilla diga «Nueva sección…», con V30x50 propuesta, como hace Pilar, en lugar de tomar la primera de la lista.

**Captura:** `15-viga.png`, `50-viga-ficha.png`

**Verificado:** navegador

### M-08 · Gestor de materiales: cambiar el fck no cambia el id, y Esc descarta los cambios sin preguntar
**Severidad:** media

**Dónde:** Materiales (gestor).

**Qué pasa:**
- En HA-30 cambié fck a 25. El id sigue siendo «HA-30». Si se pulsa «Aplicar a 2 secciones, 12 losas y 1 muro», todo el modelo dirá HA-30 con un hormigón de 25.
- Si en vez de aplicar se pulsa Esc o la X, el cambio se pierde sin aviso.

**Propuesta:**
- Si el id es el de un material típico (HA-xx, Sxxx) y deja de corresponder, proponer «Renombrar a HA-25» o avisar en la ficha.
- Al cerrar con cambios sin aplicar, preguntar «¿Aplicar o descartar?».

**Captura:** `62-materiales.png`, `63-material-fck25.png`

**Verificado:** navegador

### M-09 · La barra de herramientas no cabe a 1600 ni a 1366 px y esconde «Plantas» y «Materiales»
**Severidad:** media

**Dónde:** la barra de Modelo (`.herramientas`).

**Qué pasa:**
- A 1600 px, tras usar la disposición 2×2, la barra mide 1722 px (con 1600 visibles) y queda desplazada 122 px. «Plantas» y «Materiales» desaparecen por la izquierda («riales Secciones…»).
- A 1366×768 mide 1462 px y pasa lo mismo.
- No hay sombra, flecha ni barra de desplazamiento que diga que hay más. Son justo las dos primeras órdenes del flujo, las que dejó decidido el orden de la barra.
- A 1366×768 también se trunca el nombre del proyecto («Pr…»).

**Propuesta:**
- Etiquetas que se ocultan por debajo de cierto ancho (sólo icono, con la etiqueta en el título).
- O agrupar Mover…Renumerar en un menú «Editar ▾» y los cuatro botones de disposición en uno solo.
- Nunca recortar por la izquierda.

**Captura:** `59-2x2.png`, `60-1366.png`, `61-canto-25.png`

**Verificado:** navegador (`scrollWidth` 1722/1600 y 1462/1366)

### M-10 · Ctrl+A selecciona el texto de la página, no el modelo
**Severidad:** media

**Dónde:** Modelo, planta.

**Qué pasa:**
- Ctrl+A con el foco en el lienzo pinta de azul todo el texto de la interfaz, como en una web: barras, navegador, leyenda.
- No hay ninguna forma de elegir todo lo de la planta salvo una ventana a mano.
- La selección de texto se queda después encima de todo.

**Propuesta:**
- Ctrl+A elige lo visible de la vista activa, con los filtros de tipo.
- Que el lienzo no deje seleccionar texto: `user-select: none` en la zona de vistas.

**Captura:** `41-ctrl-a.png`, `42-ventana.png`

**Verificado:** navegador y código (no hay ningún atajo «a»)

### M-11 · Tras «Crear las plantas», el gestor sigue abierto proponiendo otra planta y deja la vista en la más alta
**Severidad:** media

**Dónde:**
- el gestor de plantas en un proyecto nuevo;
- `app/src/editor/GestorPlantas.tsx:110-120` y `:148-161`.

**Qué pasa:**
- Pulsé «Crear las plantas» (3 sobre la cimentación). El diálogo no se cierra: pasa a «Añadir plantas» con «N4 nueva» ya dibujada en el alzado.
- El único botón primario es «Añadir». No hay «Hecho» (sólo la X), así que parece que falta un paso o que N4 ya se ha añadido.
- Al cerrarlo, la vista está en N3 (la más alta). Todo lo que dibujé fue a N3, y en el alzado N1 y N2 salieron vacías.

**Propuesta:**
- Tras el primer paso, cerrar el gestor, o mostrar «Hecho» como primario y no dibujar ninguna planta «nueva» hasta que se toque algo.
- Dejar activa la primera planta sobre la cimentación (N1), que es por donde se empieza a dibujar.

**Captura:** `03-nuevo2.png`, `04-plantas-creadas.png`, `39-alzado.png`

**Verificado:** navegador y código

### M-12 · Diagnósticos: primero los errores crípticos y al final la causa; jerga de la CLI
**Severidad:** media

**Dónde:**
- panel inferior › Diagnósticos;
- `app/src/espacios/Modelo.tsx:450`.

**Qué pasa:**
- Con b = 30 m, la lista empieza por dos ERROR `topologia/tramo-degenerado`: «tiene dos nudos en el mismo punto de su tramo 1 … el encuentro es ambiguo».
- La explicación útil, el AVISO `sensatez/seccion` «b = 30 m … ¿está en cm?», está debajo y fuera de la vista.
- Cada entrada lleva su código interno (`malla/pilar-tapado-sin-refinar`).
- La cabecera dice «Los de `fem validar` y `fem calcular`»: una orden de consola que el ingeniero no usa en la web.

**Propuesta:**
- Cuando hay un aviso de sensatez sobre el mismo objeto que un error, ponerlo primero, como causa probable.
- El código, en pequeño o en el título del elemento.
- La cabecera, en el idioma de la app: «Errores y avisos del modelo».

**Captura:** `33-diag-30m.png`, `48-avisos-mover.png`

**Verificado:** navegador y código

### M-13 · «Nueva» en la hoja lleva el cursor a la fila nueva, pero no el foco: lo que se teclea se pierde
**Severidad:** media

**Dónde:**
- Tablas › Nueva;
- `app/src/editor/Hoja.tsx:662`.

**Qué pasa:**
- Pulsé «Nueva» en Pilares. La celda id de la fila «+» queda marcada, pero el foco sigue en el botón.
- Tecleé `P99` y no pasó nada: ni se escribió ni salió ningún aviso.

**Propuesta:** tras `mover(nBorrador, 0)`, dar el foco a la hoja, o abrir ya el editor de la primera celda obligatoria.

**Captura:** `64-nueva-fila.png`, `65-tras-nueva-teclear.png`

**Verificado:** navegador y código

### M-14 · Elegir en el dibujo no lleva la hoja a su fila; la fila elegida apenas se distingue
**Severidad:** media

**Dónde:** el panel inferior Tablas y la selección compartida.

**Qué pasa:**
- Elegí la viga V2 en el dibujo con la hoja en Forjados. La hoja sigue en Forjados.
- Al pasar a Vigas, el cursor de celda sigue en V1 (recuadro azul) y V2 sólo se marca con una franja fina en el número de fila.
- Llegué a ver la viga V2 resaltada en el dibujo y la sección V30x25 en Propiedades a la vez, porque el cursor de la hoja se había movido.

**Propuesta:**
- Al elegir un objeto, si la hoja está abierta, cambiar a su pestaña y llevar el cursor a su fila.
- Resaltar la fila entera de las elegidas.
- Que Propiedades siga a la última acción del usuario, con un único elegido visible.

**Captura:** `27-elegir-viga.png`, `28-tabla-vigas.png`, `34-deshacer.png`

**Verificado:** navegador

### M-15 · Una planta insertada entre dos se llama «N4», y Renumerar no la ordena
**Severidad:** media

**Dónde:** Plantas › Añadir plantas › Encima de N2.

**Qué pasa:**
- El gestor propone «N4 +9,00» entre N2 y N3, así que el edificio queda N1, N2, N4, N3.
- «Renumerar» sólo toca pilares, vigas, losas, paños y muros, y los listados quedarán desordenados para siempre salvo que se renombren a mano.
- Además, el gestor se abre desde la barra directamente en «Añadir», con el alzado ya modificado (N3 aparece a +12,00) antes de decidir nada.

**Propuesta:**
- Proponer renombrar las de encima (N3 → N4), o un nombre intermedio, o que Renumerar ofrezca también las plantas.
- Abrir el gestor en «Datos de la planta» y dejar «Añadir» para cuando se pulse.

**Captura:** `85-plantas-gestor.png`, `86-plantas-datos.png`

**Verificado:** navegador

### M-16 · Hueco: la plantilla mezcla lo del forjado y lo del muro, y z0/z1 no dicen respecto a qué
**Severidad:** media

**Dónde:** Modelo › Hueco › Propiedades.

**Qué pasa:**
- La plantilla muestra «en un forjado: Rectángulo | Polígono» y, justo debajo, z0 = 0 m y z1 = 2,1 m, que sólo valen para un hueco de muro, sin ningún encabezado que lo diga.
- Al dibujar un hueco en el muro desde la planta N2 (+6), quedó entre +3,00 y +5,10, en el piso de debajo. Es coherente con «lo que llega desde abajo», pero en la plantilla nada lo anticipa.

**Propuesta:**
- Dos grupos con título: «En un forjado» (rectángulo o polígono, con zunchos) y «En un muro» (z0 y z1 desde la cara superior del forjado de abajo…).
- Que en el hueco de muro se dibuje el rectángulo en el alzado al pasar.

**Captura:** `22-hueco.png`, `88-alzado-muro.png`

**Verificado:** navegador

### M-17 · El aviso de la herramienta tapa la parte baja del dibujo
**Severidad:** media

**Dónde:** el chip de ayuda de la herramienta, abajo y en el centro de la vista.

**Qué pasa:**
- Con Pilar, Forjado o en la cota de estirar, el chip llega a tres líneas (más el error en rojo) y tapa burbujas de ejes, cotas y la fila inferior de pilares.
- En `13-ventana-pilares.png` y `51-cota-cadena.png` tapa justo las cotas y burbujas con las que se trabaja.

**Propuesta:**
- Una sola línea: lo esencial («Pilar: clic o ventana · Tab cota · Esc»), con el resto en un «?» o en Propiedades.
- Que se aparte, o se vuelva translúcido, cuando el cursor se acerca.

**Captura:** `08-pilar.png`, `13-ventana-pilares.png`, `51-cota-cadena.png`

**Verificado:** navegador

### M-18 · Software comercial nombrado en la interfaz
**Severidad:** media (contra una regla explícita del usuario)

**Dónde:**
- `app/src/Inicio.tsx:26`: «Pórtico de acero de 7 plantas (**SAP2000** 1-022, A2)», en la pantalla de inicio;
- `app/src/editor/Gestores.tsx:398`: «Las que usa el cálculo (compilarSeccion), con las áreas de cortante de **CSI**», en el gestor de secciones.

**Qué pasa:** los textos de la app no deben nombrar software comercial. Además, la segunda frase expone el nombre de una función interna.

**Propuesta:**
- «Pórtico de acero de 7 plantas (caso de validación 1-022)».
- «Las que usa el cálculo, con las áreas de cortante habituales de los programas de pórticos».

**Captura:** `00-inicio.png`, `10-gestor-seccion.png`

**Verificado:** navegador y código

---

## Baja

### M-19 · Jerga interna en Modelo y en la barra de estado
**Severidad:** baja

**Dónde:**
- `app/src/espacios/Modelo.tsx:773`: «de `fem resumen`»;
- «HIPÓTESIS DEL COMPILADOR» en Propiedades de la planta;
- `app/src/App.tsx:289`: «resultados de .fem/64186d9b (CLI) · leídos en 0.02 s»;
- el título de Recalcular: «sin usar los resultados de .fem/»;
- «inserción: (plano)».

**Qué pasa:**
- En un proyecto del navegador, que no usa la CLI, la barra de estado dice que los resultados vienen de `.fem/ (CLI)`. Es la caché de IndexedDB.
- El resto son nombres de órdenes o de módulos internos.

**Propuesta:**
- «resultados guardados (huella 64186d9b)».
- «Hipótesis del cálculo».
- «inserción: en el plano del forjado».

**Captura:** `07-ejes-hechos.png`, `39-alzado.png`

**Verificado:** navegador y código

### M-20 · «El losa L1 tiene 25 m de espesor»
**Severidad:** baja

**Dónde:** `src/agente/sensatez.ts:267`.

**Qué pasa:** el artículo es fijo («El ${que}»), así que para una losa sale «El losa».

**Propuesta:** «La losa» o «El muro» según el tipo.

**Captura:** `61-canto-25.png`

**Verificado:** navegador y código

### M-21 · Controles segmentados y casillas recortados en Propiedades
**Severidad:** baja

**Dónde:**
- Forjado › tipo («Unidirecc.»);
- Apoyo lineal › coacciona («Solo uz» cortado por el borde);
- Copiar › plantas: las etiquetas «N3 · +9,00» partidas en dos líneas junto a casillas enormes.

**Qué pasa:** el panel de 300 px no da para esos controles.

**Propuesta:** en el panel estrecho, un desplegable o los segmentos en dos filas; las casillas de plantas como «fichas» en línea, como en «A plantas».

**Captura:** `19-forjado.png`, `76-apoyo-lineal.png`, `80-copiado.png`

**Verificado:** navegador

### M-22 · Rótulos de enganche y mensajes poco precisos
**Severidad:** baja

**Dónde:** barra de estado y avisos de herramienta (`src/editor/dibujo/enganches.ts:56`, `app/src/dibujo/controlador.ts:524`).

**Qué pasa:**
- En el cruce de los ejes A y 1 la barra dice «Cruce (A)», sin el otro eje.
- El punto medio de la viga V2-N2 se anuncia como «Punto medio (L1-N2)» (nombra la losa).
- El pinzamiento empieza en minúscula: «un vértice de V2-N2: el punto nuevo…».
- En el teclado, «@L<α: longitud y ángulo, desde el eje 1» se confunde con el eje de replanteo «1»; quiere decir +X.

**Propuesta:**
- «Cruce A-1».
- Que en el punto medio la viga gane a la losa.
- Mayúscula inicial.
- «ángulo desde +X (antihorario)».

**Captura:** `09-pilar-sin-seccion.png`, `81-pinzamiento.png`, `84-oscuro.png`, `69-teclado-error.png`

**Verificado:** navegador

### M-23 · El navegador esconde la lista de objetos bajo bloques informativos
**Severidad:** baja

**Dónde:** el panel izquierdo.

**Qué pasa:**
- «Proyecto» (con la descripción), «Vistas» y «Plantillas DXF» van encima, con párrafos de ayuda aunque estén vacíos.
- «Objetos», lo que más se usa, empieza a 500 px: a 900 px de alto sólo se ven Pilares, Vigas y Forjados, y desplegados, dos filas.

**Propuesta:** «Objetos» arriba, y Vistas y Plantillas plegadas por defecto cuando están vacías (una línea «Ninguna · añadir»).

**Captura:** `73-navegador.png`

**Verificado:** navegador

### M-24 · Sin respuesta visible tras «A plantas» y tras estirar
**Severidad:** baja

**Dónde:** «A plantas» (Copiar) y cota de estirar.

**Qué pasa:**
- Tras copiar 14 objetos a N1 y N2, el diálogo se cierra sin decir nada. Sólo cambian los contadores (Vigas 30, Forjados 12).
- Tras estirar la cota 1–2 a 7,00, el chip queda vacío.
- Las herramientas de dibujo sí muestran su ✓ verde con Ctrl+Z.

**Propuesta:** el mismo ✓: «Copiados 14 objetos a N2 y N1 · Ctrl+Z», «Estirado 1–2 a 7,00 m · 32 objetos · Ctrl+Z».

**Captura:** `44-copiado.png`, `54-estirado2.png`

**Verificado:** navegador

### M-25 · Tras estirar, la vista se queda gris unos segundos con el dibujo viejo
**Severidad:** baja

**Dónde:** cota de estirar (CT2).

**Qué pasa:**
- Al confirmar 7,00, la vista se atenúa con «Compilando la versión editada…» y sigue mostrando 6,00 durante 1–2 s.
- La barra superior muestra «LEYENDO LO EDITADO · RESULTADOS DESACTUALIZADOS».
- En las demás ediciones el dibujo nuevo sale enseguida (AL-4).

**Propuesta:** que estirar también dibuje el modelo físico sin esperar a la compilación, como el resto.

**Captura:** `53-estirado.png`, `54-estirado2.png`

**Verificado:** navegador (una vez)

### M-26 · Un pilar tecleado a 1 km entra sin aviso, y la vista se reencuadra sola
**Severidad:** baja

**Dónde:** Pilar con «1000;5».

**Qué pasa:**
- Se crea P10 a 1 km y la vista salta a un encuadre de 1 km: el edificio se queda en unos píxeles, con las cotas temporales viejas flotando.
- Diagnósticos: 0.
- Al deshacer, vuelve a reencuadrar.

**Propuesta:**
- Un aviso de sensatez cuando un objeto queda muy lejos del resto (fuera de 5 veces la extensión).
- No reencuadrar sin que el usuario lo pida; basta un indicador de «hay objetos fuera de la vista».

**Captura:** `70-pilar-1km.png`, `71-pilar-1km-b.png`

**Verificado:** navegador

### M-27 · Proyecto vacío «CALCULADO», y el error viejo de la hoja que no se va
**Severidad:** baja

**Dónde:** la barra superior y la línea de ayuda de la hoja.

**Qué pasa:**
- Un proyecto recién creado, sin nada, dice «CALCULADO» con el botón «Recalcular» y «Combinaciones 12».
- Tras un Retroceso que fue a la hoja, la línea de ayuda siguió diciendo «sección P30x30: el id no puede estar vacío» mucho después, con otras tablas y herramientas ya en uso.

**Propuesta:**
- En un modelo vacío, «Sin nada que calcular».
- Borrar el mensaje de la hoja al cambiar de celda o de tabla.

**Captura:** `02-creado.png`, `37-muro-hecho.png`, `44-copiado.png`

**Verificado:** navegador

### M-28 · Disposición 2×2: las dos vistas de abajo son el mismo alzado
**Severidad:** baja

**Dónde:** disposición 2×2.

**Qué pasa:** abajo salen dos «Alzado · Eje A» idénticos.

**Propuesta:** por defecto, un alzado por la primera alineación en X y otro por la primera en Y (eje A y eje 1).

**Captura:** `59-2x2.png`

**Verificado:** navegador

### M-29 · El 3D de Modelo no encuadra el edificio entero al entrar
**Severidad:** baja

**Dónde:** Modelo › 3D.

**Qué pasa:** al pasar a 3D, las bases de los pilares quedan cortadas por el borde inferior y la mitad superior de la vista está vacía.

**Propuesta:** encuadrar la caja del modelo con un margen la primera vez, y al cambiar de proyecto.

**Captura:** `40-3d.png`

**Verificado:** navegador

### M-30 · Elegido y planta activa desacoplados
**Severidad:** baja

**Dónde:** Propiedades al cambiar de planta.

**Qué pasa:** con V2 de N3 elegida, al bajar a N1 Propiedades sigue mostrando V2 (planta N3), que no está en la vista.

**Propuesta:** al cambiar de planta, soltar lo que no está en ella, o avisar en la ficha «(en N3)» con un botón «Ir».

**Captura:** `75-n2.png`

**Verificado:** navegador

### M-31 · Clics muy seguidos en Forjado chocan en el id
**Severidad:** baja (sólo lo vi con eventos sintéticos)

**Dónde:** Forjado por recuadro.

**Qué pasa:**
- Tres clics en tres recuadros dentro de la misma tarea de JavaScript dieron «El id «L2» ya es de losa…» y sólo se crearon dos forjados.
- Con 150 ms entre clics, bien.
- Un humano difícilmente lo provoca, pero indica que la herramienta calcula el id siguiente con el modelo del último render.

**Propuesta:** que el id se calcule sobre el proyecto de la edición en curso, no sobre el del render.

**Captura:** `20-forjados.png`

**Verificado:** navegador (sintético)

### M-32 · Pequeños detalles de los gestores y de la ficha
**Severidad:** baja

**Dónde:** gestor de secciones y ficha de forjado.

**Qué pasa:**
- En el gestor, «30cm» en b da «mayor que 0», cuando el problema es que no es un número.
- La ficha de la viga no dice su longitud ni sus vanos; «puntos» es un texto `0 5; 12 5`.
- El croquis del forjado no acota sus lados: la medida sale en una línea de texto debajo («7,00 × 5,00 m»).

**Propuesta:**
- «“30cm” no es un número (escriba 30)».
- Longitud y vanos en la cabecera de la ficha.
- Cotas en el croquis.

**Captura:** `11` (texto en `snapshot`), `50-viga-ficha.png`, `56-croquis.png`

**Verificado:** navegador

---

## Lo que funciona especialmente bien

- **Teclado de coordenadas:**
  - se abre al teclear, con su ayuda debajo;
  - acepta coma o punto decimal, `@dx;dy` y `@L<α`;
  - el error dice exactamente qué formatos valen (`69-teclado-error.png`).
- **Pilar con ventana:** un pilar en cada cruce, sin duplicar los que ya había («8 pilares en los cruces de ejes»).
- **Forjado por recuadro:**
  - el recuadro se resalta al pasar el ratón;
  - un clic donde ya hay forjado dice «Ya hay un forjado (L1) ahí»;
  - «Con zunchos» informa cuando no hace falta ninguno.
- **Cotas que estiran (CT2):**
  - la vista previa de lo que se mueve y se alarga, con la línea de corte y las flechas de lado, es muy clara (`52-cota-lado.png`);
  - el resultado, exacto (7,00 / 6,00).
- **Cotas temporales de un pilar elegido (CT3):** Tab y un número lo mueven exacto. El fallo de M-01 es de qué vigas siguen al pilar, no de la interacción.
- **Diálogos de Renumerar y «A plantas»:** dicen qué va a cambiar antes de hacerlo (lista de ids, qué se copia y qué no).
- **Gestor de plantas inicial:** alzado esquemático con las cotas, que se actualiza al escribir.
- **Gestor de secciones:** el croquis y las propiedades en vivo, y «Crear y usar» vuelve a la herramienta con la sección ya puesta.
- **Varios a la vez:** la ficha común con «(varios)».
- **Hoja:**
  - los desplegables con Alt+↓, que incluyen «Nueva sección…» y «Editar…»;
  - un clic en una fila elige el objeto en el dibujo con sus cotas.
- **Deshacer y rehacer:** fiables en todo lo probado (estirar, mover, borrar, sección de 30 m), y el modelo vuelve a compilar al momento.
- **Paleta Ctrl+K:** encuentra las órdenes que no están en la barra («zunch» → «Vigas de borde…»).
- **Vistas:**
  - Alzado y 3D sólidos;
  - el tema oscuro, legible;
  - los rótulos aparecen con el zoom (`74-zoom.png`).
