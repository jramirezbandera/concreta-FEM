# Auditoría de la interfaz 2: el aspecto y el acabado (2026-11-27)

## 1. Alcance y método

- **Qué se pidió:** una auditoría de cómo se ve la app: lo que queda sin centrar o con espacio de más, los menús y controles genéricos que no se han trabajado, lo que parece hecho deprisa y cómo se comportan los componentes. La app tiene que verse profesional.
- **Qué no es:** la auditoría del 2026-11-01 (`auditoria-ui.md`) miró el uso, los textos y lo que engaña al leer un resultado. Ésta mira el acabado. Lo que aquella dio por corregido no se repite, salvo donde ha vuelto.
- **Recorrido en el navegador** (el de gstack, sin interfaz, contra el servidor de desarrollo; HEAD `5480d1b`), con el ejemplo de la vivienda:
  - a 1920 × 1080: Inicio; Modelo (planta, 3D, cuatro vistas, un pilar y un forjado elegidos, la herramienta Pilar, los cinco gestores, la paleta y el panel inferior); Cargas (con sus casos y la ficha de viento, nieve y sismo); los siete modos de Resultados; las cuatro pestañas de Comprobación con el banco de armado y el despiece de un pórtico; Revisión;
  - a 1366 × 768: Modelo, Resultados y Comprobación;
  - en tema oscuro: Modelo, un gestor, Losas y el banco de armado.
- **Medidas con un script** en cada pantalla: tamaño y familia de letra de cada texto visible, textos cortados, altos de los controles y lo que se sale de la ventana.
- **Lectura del código** de `app/src/` por un agente aparte, en `auditoria-ui-2/codigo.md` (hallazgos E-n, con fichero y línea). Lo que de allí se comprobó después en el navegador va marcado.
- **Lo que no se ha mirado:**
  - los tooltips nativos y las listas de los desplegables, que el navegador sin interfaz no pinta;
  - los estados al pasar el ratón y los arrastres (dibujar, estirar el panel, pinzamientos);
  - Firefox y Safari, los anchos por debajo de 1366 px y el edificio de 7 plantas;
  - los diálogos de Borrar, «A plantas», Renumerar, Alinear y Versiones.
- **Severidad:**
  - **alta:** se ve a la primera y parece roto, o afea toda la app;
  - **media:** incoherencia o descuido que se nota al usarla;
  - **baja:** pulido.
- **Capturas:** las que prueban un hallazgo están en `auditoria-ui-2/`. Las demás (unas 60) quedaron en la carpeta temporal de la sesión.

## 2. Veredicto

La app no se ve mal de lejos: los tokens de color, el tema oscuro, los diálogos y el dibujo técnico están cuidados. De cerca se nota que cada fase añadió su pantalla con sus propios controles. Los problemas son de tres clases:

1. **Cosas rotas a la vista** (UI2-1 a UI2-10): una lista con las filas pisadas, una gráfica descuadrada, menús que se salen de la ventana, campos con el texto cortado y la fila elegida que no se resalta. Son pocas líneas cada una y es lo que más resta.
2. **No hay un juego único de componentes** (UI2-11 a UI2-20): ocho segmentados, cinco pestañas, seis disposiciones de campo, diez títulos de sección, doce tamaños de letra y un panel de Propiedades que cambia de ancho en cada modo. Es lo que hace que parezca hecha a trozos, y lo que hace que cada pantalla nueva vuelva a desviarse.
3. **Paneles que parecen documentación** (UI2-21 a UI2-26): párrafos de cien palabras en un panel de 300 px, etiquetas con el nombre del campo del fichero, un «?» por campo y letra monoespaciada para texto corriente.

En total, **38 hallazgos: 12 altos, 20 medios y 6 bajos**, más los 34 de la lectura del código, que en buena parte son la causa de los del segundo grupo.

## 3. Hallazgos

Entre corchetes, el hallazgo de `auditoria-ui-2/codigo.md` que da el fichero y la línea.

### 3.1 Roto a la vista

**UI2-1 · alta · En Cargas, la lista de casos del navegador sale con las filas pisadas.**
- Los ids con guion se parten en dos y tres líneas («W+X-» / «e», «IMP-» / «X(G)») y cada fila invade la siguiente; los nombres se cortan («Viento +X, excentri…»). Con viento, sismo e imperfección la vivienda tiene 24 casos; de los 16 que caben en la pantalla, salen así los ocho de la imperfección y seis de los ocho del viento.
- La fila es un `.arbol-fila` con el id en un `span.mono` que se puede partir.
- **Propuesta:** el id sin partir, y los casos del programa agrupados y plegados («Viento · 8», «Imperfección · 8», «Sismo · 4»): el usuario no los edita.
- Captura: `01-casos-navegador.png`.

**UI2-2 · alta · En Deformada, la gráfica «Perfil del maestro» está descuadrada.**
- Los rótulos de cota y de valor se pisan arriba a la izquierda, la curva de |uy| se corta por la derecha del panel y tres cuartas partes de la caja quedan vacías (`pantallas/Desplomes.tsx:233`).
- **Propuesta:** márgenes para los rótulos, la escala al rango de las dos curvas y el eje de cotas a la altura del edificio.
- Captura: `02-perfil-maestro.png`.

**UI2-3 · alta · En las tablas del panel inferior, la fila elegida no se resalta, y la cabecera se pierde al desplazar.** [E-24, E-25]
- Comprobado en el navegador: con la segunda fila de Comprobación · Pilares elegida, su fondo es el del cebreado. El hover, además, le quita el tinte a cualquier fila.
- La cabecera no es fija: con la tabla desplazada 400 px queda fuera de la vista.
- Captura: `03-fila-elegida.png` (la fila elegida es P2).

**UI2-4 · alta · Menús y paneles flotantes que se salen o se pisan.** [E-26, E-27]
- El menú «Vistas» se sale 20 px por la derecha a 1920 px (medido: de 1680 a 1940) y corta sus atajos.
- En «Opciones de la vista», «Unidireccionales» toca la casilla de «Muros».
- Capturas: `04-menu-vistas.png`, `05-opciones-vista.png`.

**UI2-5 · alta · Campos y desplegables con el texto cortado, sin «…» y sin flecha.**
- En un pilar, «desde», «hasta» y «sección» («PB · Planta Baja (cimentació»); en un forjado, «planta», «material» (la flecha encima del texto) y «pp» («4,46 = hormigón + ‹»).
- «contorno» y «ábacos» enseñan las coordenadas crudas: 737 y 3 401 px de texto en un campo de 163 px.
- En la ficha de viento, «Entorno (aspereza)» se sale del diálogo por la derecha.
- **Propuesta:** en los desplegables de Propiedades, sólo el id («PB», «P30x40») con el resto en la lista; las coordenadas, fuera del campo («6 vértices · Editar…»), que ya están en el croquis y en la tabla.
- Capturas: `06-propiedades-pilar.png`, `07-ficha-forjado.png`.

**UI2-6 · media · Etiquetas y títulos cortados.** [E-29]
- «ábacos en p…» y «punto de pa…» (96 y 78 px en una columna de 74).
- El título de Propiedades en Comprobación: «Z-CUB-2 · vano 1 · P2…».
- El nombre del proyecto a 1366 px, «Vivienda u…», junto a un buscador de 270 px.

**UI2-7 · alta · Textos sin tildes y con «>=» en Comprobación · Vigas.**
- «Separacion maxima entre estribos», «Armadura minima traccion», «Momento resistente MRd >= Md». Vienen de los módulos copiados (`src/comprobaciones/concreta/lib/calculations/rcBeams.ts:361, 388, 460`), que no se editan. Una búsqueda de palabras sin tilde da 25 cadenas en seis de esos módulos, sin revisar una a una.
- También en el adaptador propio: «Flexion con traccion: MEd <= MRd(N)» y «Momento minimo en la cara del apoyo…» (`src/comprobaciones/comprobar/vigas.ts:345, 358`).
- **Propuesta:** las del adaptador, corregidas en su sitio; las de los módulos, por una tabla de textos al presentarlas (por el `id` de la fila), con ≥ y ≤.
- Captura: `13-comprobacion-vigas.png`.

**UI2-8 · alta · Clases de color que no existen.** [E-7]
- `text-state-bad`, `text-state-pass` y `bg-accent-subtle` no están en los tokens: los errores del segundo orden salen sin rojo y la celda activa de la armadura base no se resalta. Comprobado en el código; los estados que existen son `ok`, `warn` y `fail`.

**UI2-9 · alta · Lo que se dibuja queda tapado o cortado por lo que flota encima.**
- La pista de la herramienta activa (unos 670 px con Pilar) tapa las burbujas de los ejes de abajo, y la barrita de herramientas de la vista corta la del eje 7.
- En Resultados · Armado, las burbujas de arriba salen cortadas por el borde de la vista; en Pilares, quedan debajo de los chips.
- El rótulo «flecha máxima…» cae sobre el borde de la losa.
- **Propuesta:** que el encuadre descuente lo que flota (los chips arriba, la barrita y la pista abajo, la leyenda a la derecha), y la pista, en la barra de estado.
- Capturas: `09-pista-herramienta.png`, `14-armado-encuadre.png`.

**UI2-10 · media · Reacciones: cuatro descuidos juntos.**
- La leyenda corta deja «(Fx» como entrada.
- En Extremos, «P11ELS-C-14»: el pilar y la combinación, pegados.
- En la tabla, «pilar · PB» parte en tres líneas bajo cada objeto.
- El selector de componente es una pista gris a todo lo ancho con las seis opciones a la izquierda.
- Capturas: `10-reacciones-leyenda.png`, `11-reacciones-tabla.png`.

### 3.2 Un solo juego de componentes

**UI2-11 · alta · Las etiquetas de Propiedades y de los gestores son los nombres de campo del fichero.**
- «id», «nombre», «lib. base», «pp», «fck MPa», «b cm», en minúscula. Los diálogos de la obra y de las acciones dicen «Nombre», «Provincia», «Altitud».
- **Propuesta:** mayúscula inicial y nombre de obra («Liberaciones en la base», «Peso propio»), con la unidad en el sufijo del campo y no en la etiqueta.
- Captura: `06-propiedades-pilar.png`.

**UI2-12 · media · Un «?» por campo.**
- 12 en la ficha de un pilar y más de 15 en la de un forjado, en columna. Es ruido, y el ojo deja de verlos.
- **Propuesta:** la ayuda, al pasar por la etiqueta (subrayado de puntos), o una por grupo.

**UI2-13 · alta · El tooltip es el `title` del navegador.** [E-1]
- 260 en el código; entre 72 y 90 por pantalla, medidos. Los de la barra de herramientas son párrafos de hasta 234 caracteres, y por debajo de 1500 px son la única etiqueta de los botones de la barra superior.
- **Propuesta:** un componente `Pista` con el nombre, el atajo y una línea; lo largo, a Propiedades, que ya lo dice al activar la herramienta.

**UI2-14 · media · Letra monoespaciada para texto corriente.**
- «para los siguientes», «en CUB-S», «13 de 23», «permanente», los segmentados de la barra («Flecha», «Hacia arriba», «Aprovechamiento»), los botones «Animar» y «Parar», «Cumple» en las tablas y el nombre de la obra en su diálogo.
- Medido: del 9 al 41 % de los caracteres visibles, según la pantalla (Reacciones, 41 %).
- **Propuesta:** mono sólo para los números en columna y los ids, como decidió UI-49; nunca para palabras.

**UI2-15 · alta · El mismo control, hecho varias veces.** [E-14 a E-19]
- Ocho segmentados, cinco formas de pestaña, seis disposiciones de campo, diez títulos de sección, seis insignias, cinco teclas, nueve avisos.
- Lo que se ve: títulos en mayúsculas («QUÉ PLANTAS», «COLOR DEL SÓLIDO», «CASO ACTIVO») junto a otros en negrita normal («General», «Posición») y a cajas con leyenda (Obra, Acciones); y «Base: No | Sí» junto a «Retícula: Sí | No».
- **Propuesta:** `Segmentado`, `Pestanas`, `Campo`, `Seccion`, `Insignia` y `Aviso` únicos, y migrar pantalla a pantalla.

**UI2-16 · media · Las escalas han vuelto a abrirse.** [E-9 a E-11]
- Doce tamaños de letra (medidos en pantalla: 9,6, 10, 10,7 y 11,5 px además de los cinco de UI-49), catorce radios, ocho altos de control (botones de 14 a 45 px) y 97 rellenos distintos.
- **Propuesta:** tokens de letra, radio, alto y espacio, y una prueba que rechace otros valores, como la de textos.

**UI2-17 · media · Propiedades cambia de ancho con cada modo.** [E-28]
- 300, 320, 330, 340, 360, 380 y 400 px: en las capturas, su borde va de x = 1520 a x = 1620, y el dibujo salta al cambiar de modo.
- **Propuesta:** un ancho, ajustable y recordado.

**UI2-18 · media · El mismo estado, de tres maneras.**
- «Cumple»: píldora verde en Propiedades y en el banco, texto en mono en la tabla y «✓» en la pestaña.
- «CALCULADO», «BIEN» y «AVISO», en mayúsculas y mono.
- El foco tiene tres recetas, y los segmentados y las filas, ninguna; `.btn` no tiene estado pulsado. [E-13, E-30]

**UI2-19 · media · Cada diálogo, a su manera.**
- Altos de 420 a 930 px, así que el título cambia de sitio de un gestor a otro.
- Pies distintos: «Cancelar | Aplicar», «Abrir la tabla … Añadir», «Borrar | Aplicar».
- Secciones con tres estilos; en Casos, los títulos de grupo van 14 px más adentro que sus campos.
- En «Materiales de la obra», desplegables estrechos a la izquierda con 400 px vacíos a su derecha.

**UI2-20 · media · Lo elegido tiñe demasiado.**
- Un forjado elegido sale con la retícula en naranja grueso en planta y como una losa naranja maciza en el 3D, y sigue elegido al cambiar de espacio.
- **Propuesta:** contorno y asas, con el relleno al 15 %.

### 3.3 Paneles que parecen documentación

**UI2-21 · alta · Párrafos largos en paneles de 300 px.**
- «Material y peso» de un forjado: tres párrafos y unas 110 palabras. La nota de la rigidez «uniforme», la de la armadura base y la línea de 60 palabras bajo las tablas de Comprobación.
- «Supuestos del cálculo»: 19 hipótesis en prosa en Propiedades, con listas de 16 ids.
- **Propuesta:** una línea y «Más…»; los supuestos, en Revisión, donde ya están.
- Captura: `08-ficha-forjado-textos.png`.

**UI2-22 · media · Estados vacíos en prosa, cada uno con su fórmula.** [E-21]
- «Ninguna. Un plano DXF o DWG en gris detrás de la planta, para calcar: «Plantilla» en la barra.»
- **Propuesta:** un componente `Vacio` con una frase corta y su acción.

**UI2-23 · media · Jerga que queda.** [E-33]
- La huella («f33e21a6332d») en el navegador; `losa/ajuste` junto al aviso en Propiedades; «el aviso de A3» y «el módulo de pilares de Concreta» en Pilares.

**UI2-24 · baja · La barra de estado, en prosa.** «vivienda.json · sin guardar en ningún sitio (Guardar en mis proyectos, o Exportar) · compilado en 2,17 s y calculado en 0,67 s».

**UI2-25 · media · Líneas de más de 200 caracteres en Diagnósticos.** El texto va a todo el ancho del panel (1 900 px). Con un máximo de unos 90 caracteres se lee de un golpe.

**UI2-26 · media · En las tablas de Comprobación, texto alineado a la derecha y partido.**
- «Armado» y «Manda» van a la derecha y en dos o tres líneas, con 740 px libres al lado: la tabla se queda en 1 180 px.
- En Punzonamiento, el motivo de «No se comprueba» es un párrafo de tres líneas alineado a la derecha.
- **Propuesta:** el texto, a la izquierda; a la derecha, sólo los números; la tabla, al ancho del panel.
- Captura: `13-comprobacion-vigas.png`.

### 3.4 Espacio y composición

**UI2-27 · media · El navegador, casi vacío en Resultados y en Comprobación.**
- 248 px de ancho y toda la altura (el 13 % de la pantalla) para el alzado de «Situación», de 150 px.
- **Propuesta:** plegado por defecto en esos espacios, o con contenido propio (las piezas de la planta con su aprovechamiento, las vistas guardadas).

**UI2-28 · baja · Revisión.** Una barra de herramientas de 54 px para una sola píldora; «Índice» dos veces; las comprobaciones, repetidas en el panel derecho.

**UI2-29 · media · Comprobación deja poco dibujo.** El panel de abajo se lleva el 45 % del alto a 1080 px y la mitad a 768; y la lista de comprobaciones de la pieza sale dos veces, en Propiedades y en el banco.

**UI2-30 · baja · Inicio.** Una columna de 1 072 px con media pantalla vacía debajo; `details` del navegador; tarjetas y píldoras de plantilla. Es lo menos propio de la app.

**UI2-31 · media · La barra superior mezcla cinco estilos de botón.**
- Icono suelto, primario grande («Guardar en mis proyectos»), píldora de estado, dos de contorno e icono.
- «Ctrl  K» con dos espacios.

**UI2-32 · media · La barra de herramientas.**
- El rótulo «VISTA» sobre tres iconos y, al lado, «Vistas ▾»: dos cosas con casi el mismo nombre.
- Viento, Nieve y Sismo, con el aspecto de herramienta activa los tres a la vez.
- Iconos que no se distinguen: Pilar, Muro, Hueco y Ábaco.

**UI2-33 · baja · La barrita de herramientas de cada vista.** Diez iconos seguidos sin rótulo ni grupos; su única pista es el `title`.

### 3.5 El dibujo

**UI2-34 · media · El 3D sólido.**
- Todo en el mismo gris: «por material» da un solo color en una obra de hormigón.
- La cara de arriba de los reticulares deja ver la retícula de casetones, como si fuera translúcida.
- El cubo de vistas es un cubo alámbrico con puntos azules.
- **Propuesta:** color por tipo de pieza por defecto, cara superior lisa y cubo con las caras rellenas.
- Captura: `12-3d-solido.png`.

**UI2-35 · media · Rótulos del armado en planta.**
- Pilares: sólo 7 de 23 llevan rótulo; los demás desaparecen al chocar, sin señal.
- Vigas: «sup 2Ø12» e «inf 2Ø12 · cØ6/150 (3R)» se pisan en los nudos.
- **Propuesta:** rótulo corto con una referencia al cuadro, o el cuadro de pilares que ya está previsto.

**UI2-36 · baja · Tema oscuro.** Los rótulos sobre el 3D llevan el halo blanco del tema claro, y los mapas, la paleta clara.

**UI2-37 · baja · Los chips de cada vista tienen tres estilos:** negrita, fino más negrita («Eje 1 (propuesto)») y contorno azul para lo que se dibuja.

### 3.6 Teclado

**UI2-38 · media · Menús sin flechas y sin el foco dentro; el buscador de municipios, sin teclado.** [E-26] Además, casillas sin el color de acento en 20 sitios [E-2] y `details` con tres aspectos [E-4].

## 4. Lo que está bien

- El banco de armado de un pilar (sección a escala, alzado con los cercos, esfuerzos y comprobaciones con su barra) y el despiece de un pórtico: son lo mejor acabado de la app.
- El gestor de secciones, el alzado del gestor de plantas y el selector de punto fijo.
- El dibujo en planta: ejes con burbujas, cotas y leyenda.
- El tema oscuro, completo en todo lo recorrido.
- La paleta de órdenes y el registro de «Proceso» con su avance.
- No hay `alert` ni `confirm`, los diálogos caben en 1366 × 768 y las barras de desplazamiento tienen estilo.

## 5. Decisiones del usuario

- **UI2-a (UI2-11):** etiquetas con mayúscula inicial y nombre de obra en Propiedades y gestores. Se recomienda; cambia el aspecto de todas las fichas.
- **UI2-b (UI2-17):** un ancho único de Propiedades (se propone 340 px, ajustable y recordado).
- **UI2-c (UI2-27):** el navegador en Resultados y Comprobación: plegado por defecto o con contenido propio.
- **UI2-d (UI2-14):** mono sólo para números e ids.
- **UI2-e (UI2-34):** el 3D, por tipo de pieza por defecto.
- **UI2-f (UI2-21):** sacar de Propiedades los «Supuestos del cálculo» y dejar los textos largos tras un «Más…».

## 6. Orden propuesto

1. **Lo roto** (UI2-1 a UI2-10): una tanda, de pocas líneas cada arreglo.
2. **Los cimientos:** los tokens de escala con su prueba (UI2-16) y los componentes únicos (`Segmentado`, `Pestanas`, `Campo`, `Seccion`, `Pista`, `Insignia`, `Vacio`; UI2-13, UI2-15, UI2-18, UI2-22). Sin esto, lo demás vuelve a desviarse.
3. **Propiedades:** etiquetas, ayudas, ancho y textos (UI2-11, UI2-12, UI2-17, UI2-21, UI2-23).
4. **Las tablas del panel inferior:** alineación, ancho y estados (UI2-26, UI2-25, UI2-14).
5. **El lienzo:** encuadre, selección y rótulos (UI2-9, UI2-20, UI2-35, UI2-37).
6. **Diálogos y gestores,** con una plantilla común (UI2-19).
7. **El 3D** (UI2-34, UI2-36).
8. **Barras, Inicio y Revisión** (UI2-27 a UI2-33).

## 7. Correcciones (2026-11-27)

El punto 1 de §6, lo roto a la vista.

- **UI2-1:** en Cargas, los casos del usuario van uno por fila con el id sin partir, y los del programa, en tres grupos plegados («Viento», «Imperfección», «Sismo · del programa · n») que se abren con un clic o al estar activo uno de sus casos (`NavCargas`, `espacios/Modelo.tsx`).
- **UI2-2:** el «Perfil del maestro» tiene márgenes para sus rótulos y arranca en la base, que no se mueve (`pantallas/Desplomes.tsx`).
- **UI2-3:** lo elegido gana al cebreado y al hover; el hover, sólo en las filas que se eligen (`.clic`, que faltaba en Comprobación y en Modal); la cabecera de las tablas del panel inferior se queda al desplazar.
- **UI2-4:** `MenuFlotante` se mide antes de colocarse y queda entero dentro de la ventana; en «Opciones de la vista», las dos columnas de casillas al ancho de su texto.
- **UI2-5:** en los desplegables de Propiedades y de la ficha de acciones, el texto se recorta antes de la flecha, que va de fondo; un campo de texto que no cabe acaba en «…» mientras no se escribe en él. **Queda** enseñar sólo el id en esos desplegables y sacar las coordenadas de «contorno» y «ábacos» del campo.
- **UI2-6:** la columna de etiquetas de Propiedades pasa de 96 a 120 px; la etiqueta y el título de Propiedades llevan su texto entero en el `title`; en la barra superior cede antes la paleta que el nombre de la obra.
- **UI2-7:** `textoApp()` pone las tildes de las descripciones que llegan sin ellas y cambia «>=» y «<=» por «≥» y «≤» (no dentro de un código). Los módulos copiados y las referencias congeladas no cambian.
- **UI2-8:** `text-state-fail`, `text-state-ok` y `bg-tint-accent` en lugar de las clases que no existían, y `--color-bg-elevated` y `--color-tint-accent` en las tres variables sin definir.
- **UI2-9 (en parte):** los márgenes del encuadre de plantas y alzados suben a 60 px arriba y 62 abajo, y las burbujas de los ejes ya no quedan bajo la pista ni bajo la barrita. **Queda** el encuadre de Armado (su caja es la de las franjas, sin los ejes) y el rótulo sobre el borde de la losa.
- **UI2-10:** la leyenda corta deja entero un paréntesis inicial («(Fx, Fy)»); el extremo, «P11 · ELS-C-14»; «pilar · PB», en una línea; el selector de componente, a su ancho.
- **Pruebas:** las de `app/` (177) y `src/pruebas/textos.test.ts`, con tres casos nuevos de UI2-7, en verde; `tsc` sin errores.
- **Comprobado en el navegador** con la vivienda, a 1920 × 1080: la lista de casos, el menú «Vistas» (de 1652 a 1912), Propiedades de un pilar, la pista de Pilar con las burbujas a la vista, el perfil del maestro, Reacciones, y en Comprobación · Vigas la fila par elegida con su tinte, la cabecera fija y «MRd ≥ Md».
- **Sin comprobar:** el encuadre de Armado en planta, la ficha de viento, el tema oscuro y 1366 px tras los cambios, y los bancos de Chrome, que pulsan en el lienzo y pueden notar los márgenes nuevos.

### 7.1 Los cimientos (2026-11-27)

El punto 2 de §6, en parte.

- **UI2-16, las escalas, con su prueba** (`src/pruebas/estilos.test.ts`):
  - letra: 11, 12, 13, 15 y 18 px. Lo que se salía pasa al paso más cercano (11,5 → 12; 10,5, 10 y 9,5 → 11; 12,5 → 13; 14 y 16 → 15), en las hojas de estilo y en las clases de los `.tsx`;
  - radios: 2, 4, 6, 8 y 12 px, y la píldora (3 → 4; 5 → 6; 7, 9 y 10 → 8; 15 → 999). Lo que flota (menús, leyenda, opciones) queda todo a 8;
  - la prueba lee las hojas y los `.tsx` de `app/src` y falla con cualquier otro valor. No entra lo que se dibuja en un SVG (el despiece, «Situación», los croquis), que va con la escala de su dibujo.
  - **Quedan** los altos de control, los rellenos y las separaciones, sin escala ni prueba.
- **UI2-13, la pista** (`app/src/componentes/Pistas.tsx`, montada en `main.tsx`): el tooltip de la app, para todo elemento con `title`, sin tocar ninguno. Al entrar el ratón o el foco del teclado se le quita el `title` mientras dura (así el navegador no pinta el suyo) y se le devuelve al salir. «Nombre: explicación» sale con el nombre en negrita y la explicación debajo, y un atajo final entre paréntesis, como tecla. Tarda 450 ms la primera y nada las siguientes al recorrer una barra.
  - **Quedan** los `title` que hacen de manual (24 de más de 110 caracteres): caben en el globo, pero su sitio es Propiedades.
- **UI2-15 y UI2-14, los segmentados:** el de la barra (`.herr-seg`) es ya como el de los paneles (`.seg`): palabras en la letra de la interfaz, lo elegido en relieve y la misma transición. La monoespaciada, sólo si todas sus opciones son ids («uz», «M11», «Fz»). El de los gestores, al mismo alto. «Base» y «Retícula», las dos «Sí | No».
- **UI2-18:** el anillo de foco de la app en los segmentados, las filas, la cabecera de la leyenda y los filtros; `.btn[aria-pressed="true"]` tiene estado («Animar», «Parar»).
- **Pruebas:** las de `app/` (177), `estilos.test.ts` y `textos.test.ts`, en verde; `tsc` sin errores.
- **Comprobado en el navegador** con la vivienda, a 1920 × 1080: la pista de «Viga» y la de «Encuadrar» con su tecla F, el `title` devuelto al salir, y las barras de Resultados y de Comprobación · Losas con los segmentados nuevos; sin errores en la consola.
- **Sin comprobar:** la pista con el teclado y en los diálogos, el tema oscuro, 1366 px y los bancos de Chrome.
- **Lo que queda del punto 2:** `Pestanas`, `Campo`, `Seccion`, `Insignia`, `Aviso` y `Vacio` únicos (UI2-15, UI2-22), los segmentados sueltos (`.chip.seg-chip`, `.fichas`, `.filtro-lista`, `.pestanas-lista`) y las escalas de alto y de espacio.

### 7.2 Estados, teclas, vacíos y pestañas (2026-11-27)

Otra tanda del punto 2 de §6.

- **UI2-18, los estados:** la píldora (`.pill`) va en la letra de la interfaz y sus textos, con mayúscula inicial: «Calculado», «Sin calcular», «No compila», «Calculando · …» en la barra; «Error», «Aviso» y «Nota» en Diagnósticos; «Bien», «Avisos» y «No aplica» en Revisión. En las tablas de Comprobación el estado es la misma píldora que en Propiedades y en el banco.
- **UI2-26 (en parte):** en esas tablas, «Armado» y «Manda» van a la izquierda, con su cabecera. **Queda** el ancho de la tabla.
- **UI2-15, las teclas:** una sola (`.kbd`, `.dib-tecla`, el pie y los atajos de la paleta, la pista). Los rótulos en mayúsculas, con un solo espaciado; los títulos de grupo de Propiedades, a 12 px como los de los diálogos.
- **UI2-22, los vacíos:** `app/src/componentes/Vacio.tsx` (lo que no hay y, más tenue, cómo se consigue; con un botón si el camino es un clic), en nueve sitios: las vistas guardadas, las plantillas, «Situación», Diagnósticos, los avisos de Comprobación, la viga sin elegir, lo elegido de una herramienta, el perfil sin diafragmas y las listas de los gestores. **Quedan** los demás párrafos `.nota` que hacen de vacío.
- **UI2-15, las pestañas:** las de la ficha de acciones y las de «Refuerzos | Cercos» usan el `Grupo` de las del panel inferior (flechas, Inicio y Fin); las segundas, sin mayúsculas.
- **Pruebas:** las de `app/` (177; dos puestas al día por los textos nuevos), `estilos.test.ts` y `textos.test.ts`, en verde; `tsc` sin errores.
- **Comprobado en el navegador** con la vivienda, a 1920 × 1080: «Calculado» y la tecla de la paleta en la barra, los vacíos del navegador y «Bien» en Revisión; sin errores en la consola.
- **Sin comprobar en el navegador:** la tabla de Comprobación con su píldora y su texto a la izquierda, las pestañas con el teclado, el tema oscuro, 1366 px y los bancos de Chrome.
- **Lo que queda del punto 2:** `Campo` y `Seccion` únicos (seis disposiciones de campo y los títulos en cajas con leyenda), los nueve avisos, los segmentados sueltos y las escalas de alto y de espacio.

### 7.3 Propiedades y títulos (2026-11-28)

Lo que quedaba a mano del punto 2 y el arranque del punto 3. Tres de estos cambios aplican una recomendación de §5 (UI2-b con 360 px en vez de 340, UI2-a sólo en la mayúscula inicial y UI2-f); el usuario las confirmó el 2026-11-28.

- **UI2-17 (decisión UI2-b, recomendada):** Propiedades mide 360 px en todos los espacios y modos (`ANCHO_PROPIEDADES`, `armazon/Disposicion.tsx`); antes, de 300 a 400. Se propusieron 340; con 360 caben sin apretar las tablas de vanos de Diagramas y las ternas de Pilares. No es ajustable todavía.
- **UI2-11 (decisión UI2-a, a medias):** las etiquetas de Propiedades y de las plantillas, con mayúscula inicial («Nombre», «Giro», «Punto fijo»), por CSS: el texto del DOM no cambia y las pruebas leen lo mismo. Un símbolo o una sigla se queda como está («x», «q», «z0», «id», «pp», «fck MPa»; `esSimbolo`, `fmt.ts`). **Queda** dar nombre de obra a las abreviadas («lib. base», «pp»), que sí cambia el texto.
- **UI2-21 (decisión UI2-f, en parte):** los «Supuestos del cálculo» de Propiedades, plegados, como el equilibrio. **Quedan** los párrafos largos de la ficha del forjado y de Armado.
- **UI2-15:** un solo título de sección (12 px, seminegrita, sin mayúsculas) en los gestores, el banco de armado, las listas, la ayuda de los casos y los menús de enganches y de opciones; las mayúsculas quedan sólo para los rótulos de la barra de herramientas. Los campos, a 28 px en todas partes.
- **UI2-23 (en parte):** fuera «el aviso de A3» y «el módulo de pilares de Concreta» de Pilares.
- **Pruebas:** las de `app/` (177) y `estilos.test.ts`, en verde; `tsc` sin errores.
- **Comprobado en el navegador** con la vivienda, a 1920 × 1080: la ficha de un forjado con sus etiquetas («Ábacos en pilares» y «Punto de paso» enteras, «id» sin tocar), y Propiedades a 360 px en Diagramas y en Pilares, con sus tablas enteras; sin errores en la consola.
- **Sin comprobar:** los gestores y el banco de armado con los títulos nuevos, Armado y Reacciones a 360 px, el tema oscuro, 1366 px y los bancos de Chrome.
- **Lo que queda del punto 2:** el `Campo` único (seis disposiciones), las cajas con leyenda de Obra y Acciones, los nueve avisos, los segmentados sueltos y la escala de espacios.

### 7.4 Avisos y campos (2026-11-28)

- **UI2-15, los avisos (E-19):** de nueve maneras a cuatro, cada una con su sitio:
  - `.msj` con su tono (`ok`, `warn`, `fail` o `neu`): el aviso dentro de un panel o de un diálogo, una caja con el fondo de su tono. Sustituye a `.ges-aviso`, `.ges-error`, `.ayuda-sin`, `.aviso-proponer`, el de Inicio hecho con utilidades y los 50 párrafos `.nota` o sueltos que sólo cambiaban el color del texto (57 sitios en 23 ficheros);
  - `.banda`: lo de toda la app, bajo la barra (no cambia);
  - `.aviso-flota`: los dos flotantes (versión nueva y «Calculado»), con la misma caja;
  - el error de un campo, bajo él (no cambia).
- **UI2-15, los campos (E-11, E-16):**
  - un solo control de texto, esté suelto (`.sel`), en un `.campo` o en un `.gp-campo`: 28 px, 13 px, el mismo borde, foco y error en una sola regla (antes, tres copias con 12 y 13 px y dos rellenos);
  - `.sel.denso` (24 px), sólo en una tabla o en una fila de varios campos: el armado del banco y los multiplicadores del forjado, que llevaban estilos en línea;
  - `.campos-lado`: la rejilla de etiqueta al lado en un diálogo, en lugar de las rejillas de utilidades de Ábacos, Alinear y Acciones, con la etiqueta como la de un `.campo`.
- **Quedan tres disposiciones, con su sitio:** etiqueta al lado (`.campo` en los paneles; `.campos-lado` y `.acc-form` en los diálogos), etiqueta encima (`.gp-campo`, en los gestores) y en fila (`.herr-campo` en la barra y el armado del banco).
- **Pruebas:** las de `app/` (177), `estilos.test.ts` y `textos.test.ts`, en verde; `tsc` sin errores.
- **Comprobado en el navegador** con la vivienda, a 1920 × 1080: el gestor de secciones, el diálogo de ábacos con un valor mal escrito (su aviso en caja roja), el flotante «Calculado» y el banco de armado de un pilar; sin errores en la consola.
- **Sin comprobar:** los avisos en los paneles (Cargas, Modal, Losas, Plantillas), la ficha de acciones, el tema oscuro, 1366 px y los bancos de Chrome.
- **Sin hacer:** la unidad «(m)» en la etiqueta de tres campos (dos pruebas los buscan por ese texto), `.acc-form` y `.campos-lado` siguen siendo dos clases, y las etiquetas de un `.campo` dentro de un gestor no llevan la mayúscula inicial.
- **Lo que queda del punto 2:** las cajas con leyenda de Obra y Acciones, los segmentados sueltos y la escala de espacios.
