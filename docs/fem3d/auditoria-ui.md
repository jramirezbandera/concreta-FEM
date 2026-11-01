# Auditoría de la interfaz: lo visual, la UX y los textos (2026-11-01)

## 1. Alcance y método

- **Qué se auditó:** la app web entera (`app/src/` y los textos que le llegan de `src/editor/`, `src/agente/`, `src/visor/` y `src/compilador/`), de cara al usuario: lo que falla, lo que confunde, lo que cuesta pasos de más, lo que se lee mal y lo que es incoherente. No la exactitud del motor, que tiene su propia auditoría (`auditoria.md`).
- **Cinco auditores en paralelo**, cada uno con su navegador sin interfaz (gstack) contra el servidor de desarrollo:
  - **Modelo:** dibujar y editar (herramientas, enganches, cotas, Propiedades, Tablas, gestores);
  - **Resultados:** Cargas, Resultados con todos sus modos, Revisión, panel inferior y barra de estado;
  - **Primer uso:** un ingeniero que no conoce la app crea desde cero PB + 2 plantas, 3 × 3 pilares a 5 m, vigas, losa de 25 cm y dos cargas, calcula y busca la flecha, M11 y un axil;
  - **Visual:** tipografía, color y contraste medidos (`getComputedStyle`, WCAG), áreas de clic y desbordes, en los dos temas y a 1920, 1600, 1366, 1280 y 1024 px;
  - **Código:** lectura de `app/src/` (errores tragados, acciones destructivas, accesibilidad, textos, coherencia de componentes, rendimiento percibido).
- **Ejemplos:** `vivienda`, `muestrario`, `nucleo`, `1022` y `edificio`, y un proyecto nuevo dibujado con ratón y teclado (eventos de puntero sobre el lienzo, como los bancos de `validacion/v2c`).
- **Entorno:** HEAD `09815ba`. El servidor de desarrollo se recargaba solo por las ediciones de otra sesión en `src/compilador/`, así que el auditor de Resultados verificó casi todo en GitHub Pages (compilado desde `c65b28b`; hasta HEAD sólo cambia la documentación).
- **Verificación:** cada hallazgo dice si se vio en el navegador o se dedujo del código. Los altos se comprobaron además a mano en el código (UI-1, UI-2, UI-3, UI-5, UI-6) o en las capturas (UI-7). Ningún auditor tocó el repositorio.
- **Informes completos**, con los pasos para reproducir cada hallazgo: `auditoria-ui/modelo.md` (M-n), `resultados.md` (R-n), `primer-uso.md` (P-n, con la tabla de pasos por tarea), `visual.md` (D-n) y `codigo.md` (C-n). Las 301 capturas que citan quedaron en la carpeta temporal de la sesión y no están en el repositorio.
- **Severidad:**
  - **alta:** engaña al leer un resultado, cambia el modelo sin decirlo, pierde trabajo o deja al usuario sin salida;
  - **media:** confunde o molesta a menudo;
  - **baja:** pulido.

## 2. Veredicto

La app ya sirve para meter un edificio y calcularlo. El primer uso llega a un 3 × 3 de tres plantas calculado, y a sus tres resultados, en unas 110 acciones. El teclado de coordenadas, el pilar con ventana, el forjado por recuadro, las cotas que estiran y el tema oscuro funcionan muy bien. También se mantiene la regla de no presentar como válido un resultado de otra versión.

Los fallos que importan son de tres clases:

1. **Lectura de resultados y de cargas que engaña** (UI-1, UI-2, UI-10, UI-11). La «envolvente» de los mapas es una sola combinación. Una carga se dibuja con un signo y se edita con el contrario. El cuadro de pilares mezcla extremos que no son concomitantes.
2. **El modelo cambia o se rompe sin decirlo** (UI-3 a UI-6, UI-8):
   - mover un pilar deja atrás la viga que pasa por él;
   - un «30» en la hoja son 30 m;
   - borrar algo usado arranca en cascada;
   - las cargas no se pueden llevar a otras plantas, y la única salida que parece hacerlo duplica el modelo.
3. **No cabe por debajo de 1600 px** (UI-7). En un portátil de 1366 se salen de la pantalla botones de la barra superior y de la de herramientas.

Entre los cinco informes hay unos 170 hallazgos; quitados los repetidos, quedan **8 altos, unos 60 medios y unos 55 bajos**. Lo más repetido, en cuatro de los cinco informes, son los **códigos internos y las órdenes de la CLI en los textos** (UI-43) y los **nombres de software comercial**, que la regla del proyecto prohíbe (UI-42).

## 3. Hallazgos

Entre corchetes, los ids de los informes completos.

### 3.1 Altos

**UI-1 · La «Envolvente de una situación» de los mapas de losas no es una envolvente.** [R-01]
- **Qué pasa:** el mapa pinta, entera, la combinación con mayor |valor| de la planta, como dice `fase-v1.md:70` (`componentes/comunes.tsx:80`, el grupo «Envolvente de una situación»). Pero el selector dice «Envolvente».
  - En el muestrario (PL1, M22, ELU-SIS), el clic en un punto da −43,6 kN·m/m con la «envolvente» y −50,3 con ELU-SIS-5: un 13 % menos, del lado inseguro.
  - En Diagramas, en cambio, la misma palabra sí es la envolvente.
- **Propuesta:** la envolvente punto a punto (máximo y mínimo, con la combinación de cada punto en el clic). Si no, que la opción se llame «La pésima de ELU-SIS (una combinación)» y que el clic dé además el máximo y el mínimo de la situación en ese punto.
- **Decide el usuario:** cambia una decisión de V1.

**UI-2 · Una carga se dibuja con un signo y se edita con el contrario.** [R-02, P-15]
- **Qué pasa:** el dibujo rotula «CM-CUB-S: −2 kN/m²» (la componente z) y Propiedades pide «↓ Gravedad, q = 2, en positivo hacia abajo». Quien teclee lo que ve mete una carga hacia arriba, y sólo la frena el aviso de sensatez, y sólo en G, Q y S.
  - Además, las cargas se llaman Q1, Q2… también en el caso G, y se confunden con el caso Q.
- **Propuesta:** las cargas de gravedad, rotuladas como se escriben («↓ 2 kN/m²»), y el signo sólo en las componentes globales, diciendo cuál es («Fz = −2»). Para los ids, un prefijo que no choque con los casos (`C1`, o `G-1`).

**UI-3 · Mover un pilar deja atrás, sin avisar, la viga que pasa por él.** [M-01]
- **Qué pasa:** `moverPilar` (`src/editor/estirar.ts:361-369`) sólo arrastra las vigas que tienen un vértice en el punto fijo, y sólo avisa de las que tienen un vértice dentro de la huella. Una viga continua dibujada de extremo a extremo (`0;5` → `12;5`) no tiene vértice en los pilares intermedios. Al mover P6 a x = 4,5, la viga sigue en x = 6, sin apoyo a media luz, y sólo salen avisos de malla.
  - Lo mismo al cambiar x o y en Propiedades o en la hoja.
- **Propuesta:** tratar también como unidas las vigas cuyo eje pasa por la huella: partirlas en el pilar y arrastrar el vértice nuevo, o al menos avisar («V5 pasa por P6 y se queda donde estaba»). Otra vía: que la herramienta Viga meta un vértice en cada pilar que cruza.

**UI-4 · Unidades mezcladas: un «30» o un «25» en metros entra sin protesta.** [M-02]
- **Qué pasa:**
  - El gestor de secciones pide b y h en cm; la hoja Secciones y Propiedades, en m. Un `30` en la hoja deja todas las vigas y los pilares de 30 m y el modelo «NO COMPILA» con `topologia/tramo-degenerado`, que no dice la causa.
  - En la ficha del forjado, un canto `25` compila y calcula una losa de 25 m, con sólo un aviso en Diagnósticos (que además dice «El losa», M-20). El croquis dice «Losa maciza de 2500 cm».
- **Propuesta:** la unidad dentro de la celda y validación en el propio campo: borde ámbar con «¿25 m? ¿No serán 25 cm?» y el botón «Usar 0,25». Aceptar sufijos («30 cm»). A la larga, una sola unidad para las dimensiones de sección en toda la app.

**UI-5 · Borrar algo que otros usan arranca en «Borrarlos también», con el foco en «Borrar».** [M-03, C-08, C-34]
- **Qué pasa:** `DialogoBorrar` arranca con `useState("borrar")` y el botón primario lleva `autoFocus` (`editor/Dialogos.tsx:70, 99`). Borrar la sección P30x30 propone borrar 16 objetos, es decir, todos los pilares y las vigas, y un Intro reflejo deja la planta vacía. Con una planta, borra todo lo que hay en ella.
  - Se deshace con Ctrl+Z, pero en el navegador ya se ha autoguardado.
  - El botón destructivo tiene el estilo primario azul. «Borrar» tiene tres aspectos en la app.
- **Propuesta:** por defecto «Pasarlos a otro» si hay candidatos (o ninguna opción, con el botón desactivado hasta elegir), foco en «Cancelar», botón «Borrar 16 objetos» y una clase `btn-peligro` común. La lista, en lenguaje de obra («P1 · pilar, sección P30x30»), no `seccion = P30x30`.

**UI-6 · Las cargas no se pueden llevar a otras plantas, y la salida que parece hacerlo duplica el modelo.** [P-01, P-02]
- **Qué pasa:**
  - «A plantas» con cargas da «Q1 va sobre L1, que no se copia: copia también L1» (`src/editor/edicion.ts:201`), y desde Cargas no se puede elegir la losa. Si se cierra con Esc, ni se ve el mensaje.
  - «Toda la planta N3» copia otra vez las vigas y las losas encima de las que ya había: «NO COMPILA», con 8 errores `losa/solapadas`. Las vigas duplicadas no aparecen hasta que se arreglan las losas.
  - En el primer uso, cargar G y Q en tres plantas costó ~35 acciones a mano.
- **Propuesta:** si la planta de destino tiene la copia de la pieza (la misma geometría, o el id `<id>-<planta>` que pone «A plantas»), que la carga vaya a ella. Si no la hay, que el diálogo lo diga y ofrezca «Copiar también las losas que falten». «Toda la planta» debe mirar el destino: saltar lo que ya hay en el mismo sitio (o avisar «N2 ya tiene 6 vigas y 4 losas aquí: sólo se copian las cargas») y decir en el botón cuántos objetos crea.

**UI-7 · Por debajo de 1600 px no cabe la barra superior ni la de herramientas.** [D-01, D-12, M-09]
- **Qué pasa:**
  - **Barra superior:** `.barra-sup` mide 1 403 px a cualquier ancho y la página entera gana scroll horizontal (`index.css:567`). A 1366 quedan fuera el tema y medio «Proyectos»; a 1024, también «Recalcular» y «Buscar». El nombre del proyecto se queda en un trazo («Concreta \»).
  - **Barra de herramientas:** mide 1 722 px a 1600 y 1 462 a 1366. Con 2×2 se desplaza y esconde por la izquierda Plantas y Materiales, las dos primeras órdenes del flujo, sin ninguna señal de que hay más. En otros casos esconde por la derecha las disposiciones.
- **Propuesta:**
  - barra superior: `min-width: 0` en el nombre (con un mínimo de 160 px y «…»), los botones sólo con icono por debajo de 1500 px, un menú «⋯» por debajo de 1100 px y nunca scroll de página;
  - barra de herramientas: quitar Planta, Alzado y 3D (ya están en el chip de cada vista), las cuatro disposiciones en un solo desplegable, Mover…Renumerar en «Editar ▾» por debajo de 1500 px y nunca recortar por la izquierda.

**UI-8 · El gestor de plantas, después de añadir, queda listo para intercalar plantas en medio.** [P-04, M-11, M-15]
- **Qué pasa:**
  - **Tras «Añadir»:** la referencia pasa a la primera planta nueva, con «Encima de» y «Cuántas = 2» (`editor/GestorPlantas.tsx:111`). El alzado ya enseña dos plantas «nuevas» entre N2 y N3, y un segundo clic por costumbre las mete en medio del edificio.
  - **Tras «Crear las plantas»** de un proyecto nuevo: el diálogo sigue abierto con «N4 nueva» dibujada y sin un botón «Hecho», y la vista se queda en la planta más alta, así que lo dibujado va a N3.
  - **Una planta insertada entre N2 y N3 se llama «N4»,** y Renumerar no ordena las plantas.
- **Propuesta:** tras añadir, cerrar el diálogo o dejar «Hecho» como primario, volver a «Cuántas = 1» con la referencia arriba, y que el botón diga lo que hará («Añadir 2 plantas encima de N3»). Abrir el proyecto nuevo en N1. Proponer renombrar las de encima o que Renumerar ofrezca también las plantas.

### 3.2 Medios

#### Lectura de resultados

**UI-9 · Deshacer o editar saca de Resultados, y lo elegido en cada modo se pierde.** [R-09, C-10]
- `App.tsx:117`: sin cálculo, el espacio cae a Modelo. Ctrl+Z en Resultados lleva a Modelo sin decir qué se deshizo, y «Recalcular» pasa un momento por Modelo.
- La combinación, la magnitud, la escala y la armadura de cada modo, y el caso activo de Cargas, son estado local: cambiar de modo o de espacio los reinicia.
- Volver por deshacer a una huella ya calculada en la sesión obliga a recalcular.
- **Propuesta:** quedarse en Resultados con un velo «Resultados de otra versión · Calcular», con el modo, la planta y la cámara intactos; guardar las elecciones por proyecto; reutilizar los resultados en memoria de una huella ya calculada; un aviso breve de lo que deshizo Ctrl+Z.

**UI-10 · El cuadro de pilares mezcla extremos de combinaciones distintas.** [R-06]
- N, |My| y |Mz| de P1 salen de ELU-PT-30, -6 y -52 (`pantallas/Pilares.tsx:204, 252`). No son concomitantes, y un pilar se dimensiona por ternas.
- **Propuesta:** las ternas concomitantes de las combinaciones pésimas (N máx., N mín., My máx., Mz máx., cada una con sus concomitantes); como mínimo, el rótulo «extremos de combinaciones distintas».

**UI-11 · Las reacciones salen por defecto por casos sueltos.** [R-05]
- «Por defecto» es la envolvente de casos, que siempre es G. «Mayor hacia arriba 202,1 kN» no dice que es sólo G, y «Totales por combinación» lista casos (`pantallas/Reacciones.tsx:174`).
- **Propuesta:** por defecto, la ELS característica (como los desplomes) o una tabla con un caso por columna, como «Cargas en cimentación» del informe. Los rótulos, «por caso».

**UI-12 · «Por defecto» no dice qué combinación pinta, y en cada modo es otra.** [R-20]
- Es ELS-C en uz, ELU-PT o ELU-PT+ELU-SIS en M y Armado, y casos sueltos en Reacciones. La cuenta de la pestaña «Combinaciones» cambia con el modo (19, 8, 4). El selector no tiene `aria-label`.
- **Propuesta:** «Por defecto (ELU-PT, 8)», y la pestaña, «Combinaciones de esta vista».

**UI-13 · Tras cualquier cambio, «Combinaciones 0» con un mensaje falso.** [R-03]
- Sin calcular, la pestaña dice «Sin combinaciones: los casos no llevan su acción…» (`espacios/Modelo.tsx:798`, `src/visor/sesion.ts:431`). Es falso: vuelven al calcular.
- **Propuesta:** generarlas desde los casos, que es puro, o decir «Se verán al calcular».

**UI-14 · En uz, la flecha máxima sale como «mínimo».** [P-16]
- El mapa rotula «máximo −0,263 mm» en el apoyo y «mínimo −1,51» en el vano; la tabla de flechas dice «Máxima 1,51».
- **Propuesta:** en uz, «flecha máxima 1,51 mm ↓» y, si lo hay, «levantamiento».

**UI-15 · La altura de planta significa dos cosas.** [R-04, P-24]
- El modelo guarda la altura hasta la planta de encima (`fisico.ts:11`).
  - El informe y el aviso de sensatez dicen «CUB · 0,9 m» y acusan a la planta equivocada.
  - La tabla de desplomes dice «CUB · h 3,40», que es la altura del tramo de debajo.
  - En la tabla Plantas, Cim lleva 3 y la de arriba va vacía.
- **Propuesta:** en todos los textos, la altura del tramo bajo la planta (lo que se lee en un alzado), o rotular «altura hasta la de encima». El aviso, por tramos («entre CUB y CUB-S: 0,9 m»).

**UI-16 · Columnas «|My|», «|Mz|» y «|Vz|» con valores con signo, y sin unidades.** [R-07, P-23, C-32]
- `Pilares.tsx:204-205, 252-253` y `Vigas.tsx:466`. El cuadro de la planta, además, no lleva kN·m. Pilares se abre en la planta de arriba, con el axil más pequeño.
- **Propuesta:** «My kN·m» (el máximo con su signo) o valores sin signo. Abrir Pilares en la planta más baja.

**UI-17 · La leyenda de los mapas manda a «las bandas», que ya no existen.** [R-11]
- `src/agente/render/resultados.ts:434`: «Para dimensionar, las bandas». Las bandas se quitaron en la fase F. En el clic, «interpolado en la lámina 2460, como las bandas» [R-26].
- **Propuesta:** «Para dimensionar, el modo Armado», con un enlace al modo.

**UI-18 · Sensatez: «lo peor» no es lo que avisa.** [R-15]
- Dice «lo peor: P15, 0,525», que está dentro del rango. El aviso real es P1 (−0,201), y P1 tampoco sale en la tabla de la bajada.
- **Propuesta:** «lo peor» y la tabla deben incluir el tramo que avisa, con el motivo si queda fuera de la comparación.

**UI-19 · Mapa de armado: colores que no se distinguen, rótulos apilados y zonas de refuerzo que casi no se ven.** [R-19]
- La leyenda tiene diez azules de un solo tono. Los picos, de ~9 px, se apilan en columna sobre un eje. Con base, el refuerzo es un contorno negro fino sin el «máximo (+exceso)» de `fase-ab.md`. El encuadre usa todo el edificio.
- **Propuesta:** una rampa con más contraste, los rótulos con prioridad y separación, el contorno de refuerzo grueso y de color con «93,4 (+73,4)», y encuadrar la planta activa.

**UI-20 · Las gráficas pequeñas no tienen ejes ni valores.** [R-18, D-27]
- El diagrama de la franja (Armado) y el perfil del maestro (Deformada) no rotulan ni el 0 ni los máximos. La tabla «Caras y apoyos» se aprieta en 360 px y parte los ids.
- **Propuesta:** llevar el diagrama de la franja al panel inferior, como el alzado de una viga, con el eje s, los valores extremos y el cursor de estación.

**UI-21 · Rótulos de los diagramas, uno encima de otro.** [D-10]
- «−27,7» con «−19,5» y «−22,8» con «−21,1» junto a P16 y P17. En el alzado, la curva tacha el signo.
- **Propuesta:** pasarlos por la resolución de colisiones de `vistas/rotulos.ts`.

**UI-22 · La selección y el negativo de los diagramas van en el mismo azul.** [D-09]
- `--color-env-min` es igual a `--color-accent` (`index.css:128`). En el 3D, el forjado elegido se pinta entero de acento y tapa los casetones.
- **Propuesta:** la selección como contorno con halo, en un color propio que no use ningún dato (ámbar), o `--color-env-min` en otro azul.

**UI-23 · En el 3D de muros, Propiedades habla de otra planta y otra combinación.** [R-16]
- Con «Muros» y «Todas», Propiedades sigue en «Losas · CUB · Se dibuja —», y la cabecera del 3D no dice la combinación.
- **Propuesta:** que Propiedades siga a lo que se dibuja, y la combinación en la cabecera.

**UI-24 · Losas en una planta sin losas: una vista vacía, sin el «Ir a…» que tienen Armado y Reacciones.** [R-17]

#### Estado, guardado y errores

**UI-25 · «Guardando…» cuando no se guarda.** [C-05]
- Con un error o un conflicto, el autoguardado se para y la cabecera sigue con «Guardando…» (`App.tsx:321-331`) mientras la banda roja dice «No se guardó».
- **Propuesta:** tres estados: «Guardando…» sólo mientras se guarda, «Sin guardar · error» y «Conflicto».

**UI-26 · Lo que se escribe en un campo no se guarda hasta salir de él.** [P-03]
- El nombre y la descripción del proyecto (`Modelo.tsx:683-684`, `onBlur`) se pierden al recargar, aunque la barra dijera «Guardado». Tampoco salta el aviso de `beforeunload`. Probablemente pasa en más campos.
- **Propuesta:** confirmar los textos libres con el retardo del autoguardado o en `pagehide`, y «Editando…» mientras haya un borrador.

**UI-27 · Por qué falló el cálculo sólo se ve en una nota del navegador.** [C-03, C-02]
- Un mecanismo, el equilibrio o la memoria van a `proyecto.errores`, y eso sólo se pinta en un `<p>` de la sección «Proyecto» del navegador (`Modelo.tsx:539`). No sale en Diagnósticos ni lleva ids que se puedan pulsar.
- Si falla el pedido `compilar`, la app dice a la vez «Compilando…» y «NO SE PUEDE ABRIR», sin el motivo (`useProyecto.ts:230-238`; el camino es cierto y que se dispare está por confirmar).
- **Propuesta:** una banda `role="alert"` con los mensajes y sus ids, y esos errores también en Diagnósticos.

**UI-28 · La pantalla de error culpa al fichero de cualquier fallo.** [C-04, P-17]
- Dice «El fichero no es un proyecto válido… Corríjalo y la app lo recargará sola» también si falla la red, el worker o el núcleo (`App.tsx:465`). Con un JSON roto, enseña el error del analizador en inglés.
- Un fallo al descargar el núcleo queda guardado como promesa rechazada (`sesion/cliente.ts:24-27`) y todo lo que se abra después falla hasta recargar la página.
- No hay botón para volver, y siguen a la vista las pestañas y el estado de guardado.
- **Propuesta:** el texto según el código de error, `wasm = null` si falla, y «Volver a Mis proyectos».

**UI-29 · «Recargar lo guardado» puede dejar la app bloqueada en «RESULTADOS DESACTUALIZADOS».** [C-01]
- Si el proyecto o el fichero ya no existe, `recargarDisco` (`useProyecto.ts:466-479`) sale sin volver a poner `desactualizado` a false, y «Recalcular» queda deshabilitado.

**UI-30 · Los gestores tiran sin avisar lo que se ha escrito.** [C-09, M-08]
- En Secciones y Materiales, con la ficha cambiada, lo escrito se pierde sin aviso con un clic en otra fila, con «Nueva», con Esc (también con el foco en un campo) o con un clic fuera (`Gestores.tsx:225-230`).
- Cambiar el fck de «HA-30» deja el id con un hormigón de 25.
- **Propuesta:** «Hay cambios sin aplicar: Aplicar · Descartar»; Esc en un campo deshace sólo el campo; un clic en el fondo no cierra un gestor; si el id de un material típico deja de corresponder, proponer renombrarlo.

**UI-31 · «Sobrescribir el del disco» pisa los cambios de fuera de un clic.** [C-07]
- «Recargar del disco» avisa de lo que se pierde; «Sobrescribir» no, y en una carpeta no queda copia (`App.tsx:387-398`).
- **Propuesta:** una etiqueta simétrica, una confirmación en la banda y `proyecto.json.bak` antes de pisar.

**UI-32 · En la web no se puede firmar, y Revisión da instrucciones que no funcionan.** [C-06, P-07, R-14]
- En un proyecto del navegador, Revisión propone `bun run fem firmar proyecto.json` y promete releer las firmas, pero ese fichero no existe y `origenNavegador` no lo lee (`Revision.tsx:199-203`). Saldrá siempre «SIN FIRMAR».
- **Propuesta:** como mínimo, decir el camino real (exportar, firmar con la CLI y volver a abrir la carpeta). Mejor: firmar en la app con una confirmación humana explícita (el nombre tecleado y «he leído el informe»), fuera del alcance del agente.
- **Decide el usuario:** la firma sólo por la CLI es una decisión de A3.

#### Dibujar y editar

**UI-33 · Supr borra en el acto y sin decir nada; la herramienta Borrar pide confirmación.** [M-05]
- `Modelo.tsx:282-293`. Un pilar borrado deja vigas en voladizo, sin ningún aviso.
- **Propuesta:** el mismo comportamiento en los dos, con el ✓ de las herramientas («Borrado P2 · Ctrl+Z»), y un aviso de vigas sin apoyo.

**UI-34 · Borrar un forjado deja flotando los zunchos de su hueco, y el diálogo dice «Nada más usa este objeto».** [M-04]
- **Propuesta:** ofrecer como dependientes los zunchos que puso «Con zunchos».

**UI-35 · La plantilla de Viga toma en silencio una sección de pilar.** [M-07, P-11]
- Con sólo P30x30 creada, Viga la trae elegida, sin el «Nueva sección…» que sí ofrece Pilar.
- **Propuesta:** si no hay ninguna sección usada en vigas, «Nueva sección…» con V30x50 propuesta.

**UI-36 · Un clic sin enganche guarda 16 decimales.** [M-06]
- Un pilar queda en x = 5,130294802570366, y un hueco a mano en `2,0000000000000001`.
- **Propuesta:** redondear el clic libre a un paso configurable (1 cm por defecto; lo enganchado sigue exacto) y mostrar los números de la hoja sin el ruido de la coma flotante.

**UI-37 · Ctrl+A selecciona el texto de la página y no hay forma de elegir todo.** [M-10, P-13]
- **Propuesta:** Ctrl+A elige lo visible de la vista activa (en Cargas, sólo las cargas) y `user-select: none` en el armazón.

**UI-38 · Diagnósticos: dicen qué pasa pero no cómo arreglarlo, y la causa sale la última.** [M-12, P-10]
- Con b = 30 m, primero dos `topologia/tramo-degenerado` y al final, fuera de la vista, el aviso que da la causa («¿está en cm?»). Ocho errores iguales que vienen de una sola acción no se agrupan.
- **Propuesta:** el aviso de sensatez sobre el mismo objeto, primero; agrupar los iguales; una línea «Cómo arreglarlo» por tipo, con un botón cuando sea seguro; el código, en gris o en el título.

**UI-39 · El asistente de la primera planta se cierra con un clic fuera y no vuelve; el lienzo vacío no orienta.** [P-08, P-09, M-27]
- Tras el clic fuera, quedan una planta N1 y un lienzo vacío sin ninguna indicación. Un proyecto vacío sale «CALCULADO», con avisos de casos sin cargas.
- **Propuesta:** el primer paso no se cierra con un clic en el fondo, y vuelve mientras el proyecto esté vacío. En una planta vacía, «Empiece por los ejes o los pilares, o calque un DXF», con sus botones. Sin objetos, «sin nada que calcular».

**UI-40 · Lo tecleado exige el cursor sobre la planta.** [P-14]
- «x; y» e Intro con el ratón en la barra da «Lleve el cursor a una planta» (`dibujo/controlador.ts:352, 376`), y el campo se abre en la esquina superior izquierda, encima del logo.
- **Propuesta:** sin cursor, usar la última vista activa, y abrir el campo junto a la vista.

**UI-41 · Más mediones de Modelo:**
- elegir en el dibujo no lleva la hoja a su pestaña ni a su fila, y la fila elegida apenas se distingue [M-14];
- «Nueva» en la hoja no da el foco a la hoja, y lo tecleado se pierde (`Hoja.tsx:662`) [M-13];
- la plantilla de Hueco mezcla lo del forjado y lo del muro, y z0/z1 no dicen respecto a qué [M-16];
- el chip de ayuda de la herramienta llega a tres o cuatro líneas y tapa cotas y burbujas [M-17, P-22];
- no hay retícula de ejes por luces («3 ejes a 5 m»): un 3 × 3 son 12 puntos tecleados [P-12];
- Ctrl+K no entiende «flecha», «axil» ni «momento», y no tiene una entrada de ayuda [P-18];
- las versiones no dicen qué cambió [P-19].

#### Textos

**UI-42 · Software comercial en textos que se ven, contra la regla del proyecto.** [C-24, M-18, P-05, D-30, R-31]
- `app/src/Inicio.tsx:26`: «Pórtico de acero de 7 plantas (SAP2000 1-022, A2)». Sale también en el nombre del proyecto (`validacion/a2/agente/1022/proyecto.json`).
- `app/src/editor/Gestores.tsx:398`: «…las áreas de cortante de CSI», con el nombre de una función interna (`compilarSeccion`).
- `src/compilador/compilar.ts:468`: «…en ETABS 15…», en un aviso de Diagnósticos.
- **Propuesta:** «(caso de validación 1-022)», «las áreas de cortante de la sección» y «en los modelos de contraste». Una prueba que busque esos nombres en los literales que llegan a pantalla.

**UI-43 · Códigos internos y órdenes de la CLI en los textos para el ingeniero.** [C-25, C-26, R-10, P-06, M-19]
- Códigos de la investigación: «SPR (E5)… (H43)» (`Losas.tsx:192`), «(GE2)», «(GE3)» en los títulos de la barra, «(CY3)», «(RV-a)», «(D4)», «(C1-d)», «(A3)», «(A2)», «ε_snap… (C2-b)». Las hipótesis del compilador dicen «fase LV, CY-g», «H52, C2-a, G-4», «AU-4».
- Órdenes que en la web no existen: «Los de `fem validar` y `fem calcular`», «de `fem resumen`», «con `fem consultar flechas`».
- La huella en la píldora y «resultados de .fem/… (CLI)» en un proyecto del navegador.
- «El fichero cambió» cuando lo que cambió es una edición, en 15 sitios copiados [C-27].
- **Propuesta:** lenguaje de ingeniero en la app («momentos suavizados», «comprobaciones de orden de magnitud», «hipótesis del cálculo»); las referencias internas, en los comentarios o en un «Detalles técnicos» plegado; la huella y el sha256, sólo en Revisión; un componente `AvisoDesactualizado` con tres textos (editado, recalculando, cambiado fuera). Las notas de `fem render` son para el agente: separarlas de las de la app.

**UI-44 · Coma y punto decimal mezclados, notación científica y JSON crudo.** [D-16, C-28, R-22]
- «0,08» junto a «0.8·G + 1.5·Q», «4.0 cm» en Diagnósticos, «compilado en 1.86 s». En el informe, «4,724e-4» y `modificadores {"pilares":…}`.
- **Propuesta:** `fmt` o `coma` también en las combinaciones, los diagnósticos y el pie; los modificadores en palabras.

#### Visual

**UI-45 · Las mayúsculas automáticas cambian las unidades y los ids.** [D-02, R-08]
- `index.css:203, 291, 519`: «MÁXIMA MM», «N KN», «KN·M/M», «S = 1,67 M», y el id P30x30 sale como «P30X30». El propio CSS ya lo corrige para ν (`:304`).
- **Propuesta:** la unidad y el id en un `<span>` con `text-transform: none`, como `.sec > span + span`.

**UI-46 · La vista no se vuelve a encuadrar, y la leyenda tapa lo dibujado.** [D-03, R-12, R-13, D-14]
- **Encuadre:** al abrir el panel inferior, cambiar de modo o de tamaño, la cámara se queda donde estaba. En Diagramas y Pilares quedan valores bajo la cabecera y bajo la leyenda; a 1024 la planta sale cortada; a 1366, los diagramas en planta no se leen.
- **Leyenda:** mide 196 × ~380 px a 11 px. Una sola entrada ocupa siete líneas. Es documentación, no leyenda.
- **Propuesta:**
  - con `ResizeObserver`, volver a encuadrar si el usuario no ha movido la cámara, contra la caja útil (sin la cabecera ni la leyenda);
  - la leyenda, cada entrada con su muestra y dos o tres palabras, y plegada por debajo de 1600 px;
  - no abrir el panel inferior en Diagramas hasta que se elija una pieza.

**UI-47 · El dibujo no está en Geist: los rótulos del lienzo salen en Segoe UI.** [D-04]
- `fuente()` (`vistas/motor.ts:436`, y `fondo.ts:192, 301`, `controlador.ts:1198`) pide «Geist», pero la `@font-face` declara «Geist Sans». Medido con `measureText`: 141,17 px, el de Segoe, frente a 154,77. Las colisiones de rótulos dan distinto en cada sistema.
- **Propuesta:** `"Geist Sans"` en los cuatro sitios, y esperar a `document.fonts.load` antes del primer fotograma.

**UI-48 · Contraste del tema claro por debajo de 4,5:1, y la escala de grises al revés.** [D-05, D-06, D-23, D-33]
- **Por debajo de 4,5:1** (medido):
  - el terciario `#6b778a`, de 4,14 a 4,33;
  - las pastillas de estado, de 4,14 a 4,39;
  - la herramienta activa, 4,43.
- **Grises al revés:** `--color-text-disabled` (5,67:1) es más oscuro que el terciario. Lo deshabilitado de verdad va por opacidad: deshacer da 1,9:1.
- **Tema oscuro:** el diagrama de la franja tiene colores fijos (`Armado.tsx:134-140`) que dan 2,85–3,31:1.
- **Propuesta:**
  - `--color-text-tertiary: #5f6b7e`;
  - las pastillas en los tonos 800;
  - la herramienta activa en `--color-accent-hover`;
  - un token `--color-text-muted` para lo que hoy usa `disabled`, y `disabled` sólo para lo deshabilitado, sin opacidad;
  - los tokens `--color-env-*` en la franja.

**UI-49 · Once tamaños de letra, y el 71 % del texto por debajo de 12 px.** [D-07, D-22]
- Se usan 9, 10, 10,5, 11, 11,5, 12, 12,5, 13, 14, 15 y 18 px, contra la base de 13 decidida en I-h. Geist Mono sale en texto corrido (la barra de estado y los desplegables `.sel`).
- **Propuesta:** una escala de cinco pasos (11, 12, 13, 15 y 18) y el mono sólo para números e ids.

**UI-50 · Los paneles tienen ancho fijo: con algo elegido, la vista baja del 61 % a 1920 y del 48 % a 1366.** [D-13]
- El navegador mide 248 px y Propiedades 300 a cualquier ancho. El criterio de I1 se midió con nada elegido.
- **Propuesta:** `clamp()` en los anchos; por debajo de 1440 px, abrir Propiedades pliega el navegador.

**UI-51 · Los modos de Resultados cambian de sitio con el modo.** [D-08]
- El campo de Armado o Deformada se mete delante y desplaza la barra hasta 126 px: el cursor queda sobre otro modo.
- **Propuesta:** el campo de cada modo, detrás de los modos.

**UI-52 · Iconos repetidos o que dicen otra cosa.** [D-11]
- Materiales y 3D tienen el mismo trazado; Planta y la disposición «1» parecen el mismo botón; Plantas es una hamburguesa; Losas es un ojo (`armazon/iconos.tsx`).

**UI-53 · Más mediones visuales:**
- los ejes del origen tiñen el eje de replanteo que pasa por x = 0 o y = 0: el eje A sale rojo (`vistas/fondo.ts:32`) [D-18];
- los ids se parten por el guion en columnas estrechas («ELU-PT-» y «3» en otra línea) [D-17];
- las tablas del panel inferior se reparten en 1920 px, con 380 px entre columnas [D-15];
- los cuatro gestores no se parecen: cabeceras distintas, «Aplicar» frente a «Cerrar» y desplegables nativos en Plantas [D-19];
- hay áreas de clic por debajo de 24 px: subir/bajar planta 22 × 24, el «?» de 13 px, los puntos fijos de 13 × 13 [D-21].

#### Accesibilidad

**UI-54 · Los diálogos no llevan el foco dentro, no lo atrapan y no lo devuelven.** [C-15]
- `editor/Dialogos.tsx:26-56` y la paleta.
- **Propuesta:** en `Dialogo`, guardar el foco al abrir y devolverlo al cerrar, enfocar el primer control y atrapar Tab.

**UI-55 · La ayuda «?» sólo sale con el ratón.** [C-16, P-30]
- Es un `<i aria-hidden>` con `mouseenter` (`componentes/Ayuda.tsx:53-65`): con teclado, con lector de pantalla o en pantalla táctil no hay ayuda.
- CLAUDE.md cita un interruptor «Ayudas» que el commit `795bade` quitó.
- **Propuesta:** un `<button>` con `aria-describedby`, que se abra con foco o clic.

**UI-56 · El foco de teclado de la barra, los segmentados y las pestañas es el anillo negro del navegador**, distinto del anillo del acento de los botones [D-20].

### 3.3 Bajos

Uno por línea; el detalle, en los informes completos.

- **Resultados:**
  - el mismo número sale con precisiones distintas (0,0985 en el mapa y 0,10 en el panel), y hay dos «máximos» en Deformada sin decir cuál es cuál [R-21];
  - el tiempo en ms en el chip de la vista [R-23, P-16];
  - la barra de estado guarda texto de otra vista y se trunca [R-24];
  - un cálculo largo no tiene progreso ni se puede cancelar, aunque el motor da `alProgreso` y `terminate` [R-25];
  - el valor del clic no tiene halo [R-26];
  - en Cargas, los rótulos se pisan y repiten el id largo [R-27];
  - en oscuro, las bandas más oscuras se pierden [R-28];
  - las cuentas de avisos no cuadran entre Diagnósticos y Revisión [R-29];
  - en 2×2 salen dos 3D iguales y alzados vacíos [R-30, M-28];
  - los casos llevan códigos repetidos («G · G · peso propio») [R-32];
  - las figuras del informe salen en otra fuente, ilegibles y sin ampliar [R-33];
  - Propiedades de Losas repite Flechas y el equilibrio con cualquier magnitud [R-34];
  - «1 avisos» y la huella antes del veredicto [P-31];
  - el estado de cada comprobación del informe, sin color [D-34];
  - nada lleva a Resultados al acabar de calcular [P-27].
- **Modelo:**
  - controles recortados en el panel de 300 px [M-21];
  - rótulos de enganche imprecisos («Cruce (A)»; el punto medio de una viga nombra la losa) [M-22];
  - el navegador esconde «Objetos» bajo bloques vacíos [M-23];
  - «A plantas» y estirar no dan respuesta [M-24];
  - estirar deja el dibujo viejo atenuado 1–2 s [M-25];
  - un pilar a 1 km entra sin aviso y reencuadra [M-26];
  - el 3D no encuadra al entrar [M-29];
  - lo elegido sigue en Propiedades al cambiar de planta [M-30];
  - clics muy seguidos chocan en el id (sintético) [M-31];
  - «30cm» da «mayor que 0», y la ficha de la viga no dice su longitud [M-32];
  - un mensaje informativo sale en rojo [P-20];
  - el error de la herramienta sigue después de arreglarlo [P-21];
  - Propiedades de una elección mezclada sólo enseña los ejes [P-25];
  - el título de la pestaña es siempre «FEM 3D · Visor» [P-26];
  - «Exportar el proyecto.json» descarga «<nombre>.json» [P-28].
- **Código y accesibilidad:**
  - promesas sin `catch` en Inicio, `abrirOrigen` y `mirar` [C-11, C-12];
  - doble envío al crear o guardar en el navegador [C-13];
  - los diagnósticos `info` se pintan como AVISO y cuentan como avisos [C-14];
  - la hoja no anuncia la celda activa [C-17];
  - los roles de pestaña y de radio no tienen teclado [C-18, C-23];
  - las filas y los diagramas sólo responden al ratón [C-19];
  - el asa del panel inferior no se mueve con el teclado [C-20];
  - el `input type="file"` queda fuera de Tab o no se vacía [C-21, C-37];
  - el color como única señal (equilibrio, ν) [C-22].
- **Textos:**
  - desplegables con los valores del JSON sin tildes («sotano», «rigido», «hormigon») [C-29];
  - forjado/losa/paño, caso/hipótesis y planta/nivel como sinónimos [C-30];
  - plurales sin concordancia [C-31];
  - E en MPa o en kN/m² según el tipo de material [C-32].
- **Componentes:**
  - los menús flotantes se cierran de formas distintas [C-33];
  - cinco campos numéricos con su propia lectura, y un campo vacío vale 0 en Ábacos y Vigas de borde [C-35];
  - Intro confirma en unos diálogos y en otros no [C-36];
  - estilos en línea fuera del tema [C-37];
  - `.fichas`, definida dos veces en el CSS [D-31];
  - el velo de los diálogos, de un azul marino fijo fuera de los tokens [D-32];
  - el croquis del forjado, con letra de 9–10 px [D-24];
  - la muestra de «Isolínea» con el fondo de una banda [D-25];
  - el rótulo del paño encima de una viga [D-26];
  - gestores de 900 × 680 con media ficha vacía [D-28];
  - el inicio, un muro de enlaces azules [D-29].
- **Rendimiento percibido:**
  - arrastrar el panel inferior escribe en `localStorage` y repinta en cada movimiento [C-38];
  - una tecla en la hoja puede repintar todas sus filas [C-39];
  - efectos sin dependencias en Modelo [C-40].

## 4. Lo que funciona bien

- **Dibujar:**
  - el teclado de coordenadas (coma o punto, `@dx;dy`, `@L<α`, con el error que dice qué formatos valen);
  - el pilar con ventana en los cruces;
  - el forjado por recuadro con un clic, que avisa si ya hay uno;
  - las cotas que estiran, con la vista previa de lo que se mueve;
  - las cotas temporales del pilar.
- **Gestores:** el de secciones (croquis y propiedades en vivo, «Crear y usar»), el alzado esquemático de Plantas con lo nuevo en azul y el gestor de casos con su ψ.
- **Rigor visible:**
  - ningún resultado de otra versión se presenta como válido;
  - el equilibrio por caso, siempre a la vista;
  - la escala del mapa avisa de los picos («ver sin picos»);
  - los diagnósticos dicen la consecuencia («el momento en la cara puede salir un 20 % bajo»).
- **Resultados:** el alzado de una viga en el panel inferior, con la estación deslizante y los extremos con su combinación; la sonda del 3D; las reacciones en planta; la deformada animada.
- **Armazón:**
  - el tema oscuro está completo (ningún fondo claro en ninguna pantalla);
  - los tokens, limpios;
  - el texto principal y el secundario, muy por encima de AA;
  - deshacer y rehacer, fiables en todo lo probado;
  - dos pestañas que se sincronizan sin pisarse;
  - el `localStorage` siempre con try/catch, y las respuestas viejas, descartadas.

## 5. Decisiones del usuario

- **UI-1:** ¿envolvente punto a punto en los mapas, o renombrar la opción? Cambia lo decidido en V1 (`fase-v1.md:70`).
- **UI-2:** un solo convenio de signos para las cargas de cara al usuario (la propuesta: como se escriben, con flecha).
- **UI-10 y UI-11:** el cuadro de pilares con ternas concomitantes, y la combinación por defecto de las reacciones.
- **UI-15:** la altura de una planta en los textos (la del tramo de debajo o hasta la de encima).
- **UI-32:** firmar en la web con una confirmación humana, o sólo por la CLI como en A3.
- **UI-4:** una sola unidad para las dimensiones de sección (cm o m) o validación en el campo con las dos.

**Decididas el 2026-11-01, como se recomendaban:**
- **UI-1:** la envolvente punto a punto, con dos mapas (máximo y mínimo), y en el clic la combinación que manda en ese punto. Mientras tanto, la opción se llama «La pésima de…».
- **UI-2:** las cargas de gravedad, rotuladas como se escriben («↓ 2 kN/m²»); el signo sólo en las componentes globales, diciendo cuál es; los ids, con el prefijo del caso (`G-1`).
- **UI-10:** ternas concomitantes por tramo (N máx., N mín., My máx. y Mz máx., cada una con sus concomitantes), en cabeza y pie.
- **UI-11:** las reacciones, en una tabla con un caso por columna, y el dibujo en la ELS característica, diciendo cuál.
- **UI-15:** en la interfaz, la altura del tramo bajo la planta; el campo del JSON no cambia (la tabla traduce).
- **UI-32:** firmar también en la web, con el nombre tecleado y «He revisado el informe», y la huella y el sha256 del informe como en la CLI; mientras dure el periodo en sombra, la firma dice que la herramienta está en validación. Mientras tanto, Revisión da el camino real.
- **UI-4:** cm para las dimensiones de sección, cantos, espesores e intereje; m para coordenadas, luces y cotas; el JSON, en m (D1). Antes que eso, sufijos («25 cm») y aviso en el propio campo de lo absurdo.

## 6. Orden propuesto

1. **Arreglos de una línea, sin decisión:**
   - UI-42 (software comercial);
   - UI-47 (`"Geist Sans"` en el lienzo);
   - UI-45 (unidades e ids sin mayúsculas);
   - UI-5 (borrar: por defecto, reasignar; foco en Cancelar; botón de peligro);
   - UI-17 (las bandas en la leyenda);
   - UI-35 (Viga sin sección de pilar);
   - el singular «1 aviso» y el «El losa»;
   - UI-48 (los tokens de contraste).
2. **Lo que cambia el modelo sin decirlo:** UI-3 (mover un pilar), UI-4 (unidades en el campo), UI-6 (cargas a otras plantas y «Toda la planta»), UI-8 (gestor de plantas), UI-33 y UI-34 (borrar).
3. **Lectura de resultados**, tras las decisiones de §5: UI-1, UI-2, UI-10, UI-11, UI-12, UI-14 y UI-16.
4. **Pantallas por debajo de 1600 px:** UI-7, UI-50 y UI-46 (barras, paneles, encuadre y leyenda).
5. **Estado y errores:** UI-25 a UI-31 y UI-9 (no perder el sitio en Resultados).
6. **Textos sin jerga:** UI-43 y UI-44, con una prueba que busque códigos `[A-Z]\d+(-\d+)?` entre paréntesis y `fem ` en los literales de la app.
7. **El resto de medios**, y los bajos según se toque cada pantalla.

## 7. Correcciones (2026-11-01)

El punto 1 de §6 y los dos «mientras tanto» de §5:
- **UI-42:** fuera «SAP2000» del título del ejemplo 1022, «CSI» y `compilarSeccion` del gestor de secciones y «ETABS 15» del aviso `muro/dintel-en-diafragma`; de paso, los «(A2)» y «de la skill» de los ejemplos. Prueba nueva, `src/pruebas/textos.test.ts`: quita los comentarios de `app/src` y `src` y busca los nombres en lo que queda. El nombre del proyecto 1022 (`validacion/a2/agente/1022/proyecto.json`) se queda: es lo que escribió el agente en A2.
- **UI-47:** el lienzo pide «Geist Sans» (`FAMILIA_LIENZO` en `vistas/motor.ts`, y en `fondo.ts` y `controlador.ts`), y el motor de vistas vuelve a medir y pintar cuando llega la fuente.
- **UI-45:** `.sec`, `.tb th` y `.dlg-et` sin mayúsculas automáticas: los títulos y cabeceras salen como están escritos («Cuadro bajo CUB-S», «Máxima mm», «P30x30»).
- **UI-48 (en parte):** el terciario a #5f6b7e (#8b909b en oscuro) y tokens de texto sobre tinte (`--color-accent-text`, `--color-state-*-text`) para las pastillas, la herramienta activa y las fichas. Queda el token `disabled` (D-06) y el diagrama de la franja en oscuro (D-23).
- **UI-5:** el diálogo de borrar arranca en «Pasarlos a otro» si se puede (si no, sin opción y con el botón desactivado), con el foco en «Cancelar» y el botón «Borrar N objetos» en la cascada; `.btn-peligro` en este diálogo y en Inicio.
- **UI-17:** la leyenda de los mapas manda a las franjas de armado, y el valor del clic ya no habla de «la lámina 2460, como las bandas».
- **UI-35:** sin una sección de viga, la plantilla de Viga no coge la del pilar: pide una nueva, como Pilar.
- **UI-1 (mientras tanto):** en Losas, la opción es «La pésima de ELU-SIS (de 16)», en el grupo «La pésima de una situación (una combinación)»; en los demás modos, que sí hacen la envolvente, sigue «Envolvente de una situación».
- **UI-32 (mientras tanto):** en un proyecto del navegador, Revisión dice que hay que exportarlo, firmarlo en su carpeta y abrirlo desde ella.
- **Textos:** «1 aviso» en el veredicto del informe y «La losa» en el aviso de espesor.
- **Pruebas:** `app/` (92) y `src/agente` con `compilar` (173) en verde; una prueba de la app buscaba el ejemplo por su título viejo. Comprobado en el navegador: Losas y el diálogo de borrar.

El punto 2 de §6 (lo que cambia el modelo sin decirlo):
- **UI-3** (`5d6bf42`): una viga que pasa por el punto fijo de un pilar sin un vértice en él gana ese vértice y lo sigue al moverlo; con Ctrl se queda, y se avisa; también de la que cruza su huella sin pasar por el punto. La x o la y del pilar en Propiedades lo mueven igual que sus cotas. La prueba de ida y vuelta espera, en las vigas que pasaban por el pilar, el vértice nuevo.
- **UI-4** (`5d6bf42`): las medidas de sección, los espesores, el intereje, el nervio y la capa admiten la unidad escrita («25 cm») en la hoja, en Propiedades y en la plantilla; sin ella, lo que pasa de `LONGITUD_MAXIMA` (`celdas.ts`) no entra y el mensaje dice la causa. El gestor de secciones admite «0,3 m» y avisa de un «0,3» que serán metros. Queda la unidad única de §5 (cm para lo de sección).
- **UI-6** (`a36584f`): «A plantas» no copia la pieza que ya tiene su igual en el mismo sitio del destino, lleva las cargas a esa pieza y no duplica una carga igual; una carga sola va a la pieza igual del destino. El diálogo dice antes de pulsar cuántos objetos crea y lo que se salta. La prueba de antes daba por buenas las vigas duplicadas.
- **UI-8:** tras crear o añadir plantas, el gestor pasa a los datos de una (la primera sobre la cimentación, que queda activa en la vista; o la del extremo de lo añadido) con «Hecho», y el botón dice lo que hará («Añadir 2 plantas encima de N1»). Queda M-15: una planta intercalada se llama N4.
- **UI-33:** Supr, los diálogos de Borrar y «A plantas» y estirar dejan unos segundos en la vista lo que hicieron («✓ Borrado P2 · Ctrl+Z»); `cerrarDialogo` tiraba ese mensaje. La herramienta Borrar sigue pidiendo confirmación (lo fija la prueba de la app), y Supr borra en el acto lo que nada usa.
- **UI-34:** al borrar un forjado, el diálogo ofrece, marcadas, las vigas de su borde que se quedan sin forjado (`vigasDelBorde`, por la geometría: las de «Con zunchos» aunque se hayan renombrado); las que también son borde de otro forjado se quedan.
