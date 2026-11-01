# Auditoría de UX: el primer uso de punta a punta

**Escenario.** Un ingeniero que conoce los programas comerciales de estructuras abre la app por primera vez y quiere meter un edificio sencillo y calcularlo: planta baja + 2 plantas, 3×3 pilares de 30×30 a 5 m, vigas entre pilares (puse 30×50), losa maciza de 25 cm, CM 2 kN/m² y SCU 2 kN/m². Después quiere ver la flecha, los momentos de la losa y el axil de un pilar.

**Cómo.** Usé el navegador sin interfaz de gstack a 1600×900 contra `http://localhost:5180/`, primero a ciegas. El ratón sobre el lienzo WebGL se hizo con `PointerEvent` en las coordenadas del modelo (`window.__motorVistas`), como en `validacion/v2c/chrome.ts`, y el teclado, con teclas reales. Leí los `docs/` después.

**Resultado.** Llegué a un modelo calculado y a los tres resultados en unas 110 acciones. Hubo dos atascos serios: las cargas no se pueden llevar a otras plantas, y la opción que parece hacerlo duplica el modelo. Encontré además una pérdida de datos silenciosa. Las capturas están en esta carpeta (`NN-*.png`).

## Tabla: tarea → pasos → atascos

| # | Tarea | Pasos (clics + entradas) | Atascos y observaciones |
|---|---|---|---|
| 1 | Pantalla de inicio: entender qué hacer | 0 | Clara, con «Proyecto nuevo…» destacado. Los ejemplos llevan jerga interna («A2», «ejemplo de la skill», «modelado por el agente») y un nombre comercial (P-05). El bloque «En el disco» habla de `bun run visor`. |
| 2 | Crear el proyecto con su nombre | 2 clics + nombre | Ninguno. Si se deja el nombre vacío, sale «Proyecto nuevo». |
| 3 | Plantas: PB + 2 | **1 clic** si se usa el asistente que se abre solo (3 plantas de 3 m por defecto, justo lo pedido). Por la barra: 4 clics + 1 número | Un clic fuera del asistente lo cierra y no vuelve (P-08). Tras «Añadir», el diálogo apunta a N2 con «Cuántas = 2»: un segundo clic intercalaría plantas (P-04). |
| 4 | Ejes 3×3 a 5 m | 1 clic + 12 puntos tecleados (24 acciones) | No hay «n ejes a separación s» (P-12). Con el ratón fuera del lienzo, lo tecleado da «Lleve el cursor a una planta» (P-14). |
| 5 | Pilares 30×30 en los 9 cruces | 4 (Pilar, Nueva sección, Crear y usar, una ventana) | Muy bien: la ventana pone uno en cada cruce. El error «Elija la sección» se queda en rojo después de crearla (P-21). |
| 6 | Vigas 30×50 en los 6 ejes | 4 (sección nueva) + 6 × (2 clics + Intro) = 22 | La plantilla de Viga toma en silencio la sección del pilar «P30x30» (P-11). |
| 7 | Losa maciza de 25 cm en los 4 recuadros | 5 (Forjado + 4 clics) | Muy bien: el canto 0,25 y el pp salen por defecto. «Sin zunchos: … ya tiene todos sus bordes sobre una viga» sale en rojo, como un error (P-20). |
| 8 | Llevar vigas y losas a N1 y N2 | 5 (ventana, A plantas, 2 casillas, Copiar) | Ctrl+A selecciona el texto de la página, no el modelo (P-13). La elección suma 25 objetos y Propiedades enseña «Datos · 6 ejes» (P-25). |
| 9 | Cargas G = 2 y Q = 2 en las 3 plantas | **≈ 35** (activar Superficie, q = 2, 24 clics en losas, 4 cambios de planta, 1 cambio de caso) | **Atasco 1:** «A plantas» con las cargas falla con «Q1 va sobre L1, que no se copia: copia también L1», algo imposible desde Cargas (P-01). **Atasco 2:** «Toda la planta N3» duplica vigas y losas encima de las que ya había: «NO COMPILA», 8 errores (P-02). Al final, a mano. |
| 10 | Calcular | 1 | Muy rápido (< 1 s). Nada lleva a Resultados al terminar (P-27). |
| 11 | Ver la flecha | 1 (Resultados) | El mapa uz sale por defecto, con la tabla de flechas. «Máximo −0,26 / mínimo −1,51» confunde (P-16). |
| 12 | Ver los momentos de la losa | 1 (M11) | Bien. Hay jerga en la nota (P-06). |
| 13 | Ver el axil de un pilar | 4 (Pilares, planta de debajo × 2, clic en P5) | Por defecto enseña la planta de arriba, con el axil más pequeño. «\|My\|» va con valores con signo (P-23). |
| 14 | Autoguardado | 0 | Lo que se escribe en un campo no se guarda hasta salir de él, aunque la barra diga «Guardado» (P-03). |
| 15 | Exportar el proyecto.json | 1 | Descarga «Edificio 3x3 prueba.json», no «proyecto.json» como dice el botón (P-28). |
| 16 | Volver al inicio y reabrir | 2 | Bien. La vista vuelve a la planta de arriba. |
| 17 | Versiones | 1 (+1 para volver a una) | Hay hora y tamaño, pero nada dice qué cambió (P-19). |
| 18 | Recargar a mitad del trabajo | 1 | Lo confirmado se conserva. Lo que se estaba escribiendo se pierde (P-03). |
| 19 | Dos pestañas | — | Bien: los cambios llegan a la otra pestaña sin pisarse. El título de las dos es «FEM 3D · Visor» (P-26). |
| 20 | Importar (roto y válido) | 1 | El válido abre bien. El roto enseña un error del analizador en inglés y un texto que no viene al caso (P-17). |
| 21 | Firmar la revisión | **imposible en la web** | Exige `bun run fem firmar proyecto.json`, y en el navegador no hay proyecto.json (P-07). |
| 22 | Aviso de versión nueva (PWA) | — | No se puede probar con el servidor de desarrollo: el código sólo lo activa en producción (`AvisoVersion.tsx`). |
| 23 | «Abrir una carpeta» | — | No se puede probar sin interfaz: el selector de File System Access necesita un usuario. |

**Total hasta el modelo calculado:** unas 95 acciones, más 15 para ver los tres resultados. Sin los atascos de P-01 y P-02, unas 80.

---

## Hallazgos

### P-01 · Las cargas no se pueden llevar a otras plantas
**Severidad:** alta
**Dónde:** Cargas → «A plantas», diálogo «Copiar a otras plantas». `src/editor/edicion.ts:201`.
**Qué pasa:** Puse en N3 las cuatro cargas de superficie y quise llevarlas a N2 y N1, donde ya estaban las losas copiadas (L1-N2…). El diálogo da, en rojo, «Q1 va sobre L1, que no se copia: copia también L1» para cada carga, y no copia nada. Desde Cargas no se puede elegir la losa (las herramientas sólo cogen cargas), y copiar la losa la duplicaría en la planta de destino (P-02). Si se pulsa Esc a la primera, ni se ve el mensaje: la carga simplemente no aparece. En un edificio de 7 plantas con tres casos, todo se carga a mano.
**Propuesta:** Si la planta de destino tiene la copia de la pieza (la misma geometría, o el id `<id>-<planta>` que pone «A plantas»), que la carga vaya a ella. Si no hay ninguna, que el mensaje lo diga y ofrezca «Copiar también las losas que falten». Con eso, un «copiar las cargas de esta planta a…» saldría en una sola acción.
**Captura:** `42-aplantas-cargas.png`, `43-tras-copiar-cargas.png`
**Verificado:** navegador y código

### P-02 · «Toda la planta» duplica en silencio lo que ya hay en la planta de destino
**Severidad:** alta
**Dónde:** «A plantas» → «Toda la planta N3», con plantas de destino que ya tienen sus vigas y losas.
**Qué pasa:** La única salida aparente a P-01 es la otra opción del diálogo. Copia otra vez las 12 vigas y las 8 losas encima de las que había (de 18 a 30 vigas y de 12 a 20 forjados), y el modelo pasa a «NO COMPILA» con 8 errores `losa/solapadas`. Las vigas duplicadas no salen en esa lista: sólo aparecen (`topologia/vigas-solapadas`) cuando no hay errores de losas. Deshacer lo arregla, pero un usuario nuevo no sabe qué ha pasado.
**Propuesta:** Antes de copiar, mirar el destino. Si una pieza igual ya está en el mismo sitio, saltarla (y copiar sólo sus cargas), o avisar en el diálogo: «N2 ya tiene 6 vigas y 4 losas en estas posiciones: se copiarán sólo las cargas». Que el botón diga cuántos objetos va a crear.
**Captura:** `44-toda-planta.png`, `45-toda-planta-copiada.png`, `46-diagnosticos.png`, `77-viga-duplicada.png`
**Verificado:** navegador

### P-03 · Lo que se escribe en un campo no se guarda hasta salir de él, aunque la barra diga «Guardado»
**Severidad:** alta
**Dónde:** Navegador → Proyecto → Descripción (y el nombre). `app/src/espacios/Modelo.tsx:683-684` (`onBlur={escribir}`). Es probable que pase en más campos de texto del inspector.
**Qué pasa:** Escribí en «Descripción» y recargué: el texto se perdió, también después de esperar 2 s con el foco en el campo. Durante todo ese tiempo la barra decía «✓ Guardado». No sale el aviso de `beforeunload`, porque el cambio aún no está en el historial. Con Tab antes de recargar, sí se guarda. Con el autoguardado, el usuario confía en que nunca tiene que «confirmar» nada.
**Propuesta:** Confirmar los textos libres al escribir, con el mismo retardo del autoguardado (400 ms), o al menos en `visibilitychange` / `pagehide`. Mientras haya un borrador sin confirmar, que la barra diga «Editando…» en vez de «Guardado».
**Captura:** `59-tras-recarga.png`
**Verificado:** navegador y código

### P-04 · Tras «Añadir» plantas, el diálogo se queda listo para intercalar plantas en medio
**Severidad:** alta
**Dónde:** Gestor de plantas, pestaña «Añadir plantas». `app/src/editor/GestorPlantas.tsx:111` (`setElegida(… r.ids[0])`).
**Qué pasa:** Añadí 2 plantas encima de N1, y salieron N2 y N3. El diálogo sigue abierto, con la referencia en «N2 · +6,00» (la primera nueva, no la de arriba), «Encima de» y «Cuántas = 2». El alzado ya enseña N4 y N5 «nuevas» entre N2 y N3, con N3 subida a +15,00. Un doble clic o un segundo «Añadir» por costumbre mete dos plantas en medio del edificio y sube lo de encima.
**Propuesta:** Tras añadir, que la referencia pase a la planta de arriba (o que el diálogo se cierre con «Hecho»), y volver a «Cuántas = 1». Que el botón diga lo que hará: «Añadir 2 plantas encima de N3».
**Captura:** `13-plantas-creadas.png`
**Verificado:** navegador y código

### P-05 · Nombres de programas comerciales en los textos de la app
**Severidad:** media
**Dónde:** Inicio, el ejemplo «Pórtico de acero de 7 plantas (**SAP2000** 1-022, A2)» (`app/src/Inicio.tsx:26`). Gestor de secciones: «…con las áreas de cortante de **CSI**» (`app/src/editor/Gestores.tsx:398`).
**Qué pasa:** La regla del proyecto es que los textos de la app no nombran software comercial, y CSI es el fabricante de SAP2000 y ETABS.
**Propuesta:** «Pórtico de acero de 7 plantas (caso de validación 1-022)» y «áreas de cortante de la sección (Avy, Avz)».
**Captura:** `01-inicio.png`, `23-nueva-seccion.png`
**Verificado:** navegador y código

### P-06 · Jerga interna y órdenes de la CLI en la interfaz
**Severidad:** media
**Dónde:**
- Resultados · Losas: «recuperados por SPR (E5)… sin interpolar el color (H43)… con «fem consultar flechas»» (`app/src/pantallas/Losas.tsx:192`);
- Diagnósticos: «Los de `fem validar` y `fem calcular`» (`Modelo.tsx:450`);
- Propiedades de planta: «−ΣFz de sus cargas, de `fem resumen`» (`Modelo.tsx:773`);
- Pilares: «el aviso de A3» (`Pilares.tsx:241`);
- Secciones: «(compilarSeccion)»;
- «Hipótesis del compilador»;
- Revisión: «`pesoPropio`»;
- Inicio: «ejemplo de la skill», «(A2)», «bun run visor».

**Qué pasa:** Para un ingeniero que no conoce el repositorio, «E5», «H43», «A3» o «compilador» no significan nada. Las órdenes `fem …` remiten a una CLI que en la web no existe. Es ruido justo donde busca explicaciones.
**Propuesta:** Que la app hable de lo que el usuario ve («momentos suavizados», «comprobaciones de orden de magnitud», «hipótesis del modelo de cálculo»), y dejar las referencias internas en un «Detalles técnicos» plegado o en la documentación.
**Captura:** `53-resultados.png`, `46-diagnosticos.png`, `55-pilares.png`, `23-nueva-seccion.png`
**Verificado:** navegador y código

### P-07 · Firmar la revisión es imposible desde la web
**Severidad:** media
**Dónde:** Revisión → «Firma». `app/src/pantallas/Revision.tsx:127,200`.
**Qué pasa:** «Firmar es sólo del ingeniero, en la línea de órdenes», con `bun run fem firmar proyecto.json --por "Nombre"`. Un proyecto de «Mis proyectos» vive en IndexedDB y no hay ningún proyecto.json en el disco, así que el ingeniero tendría que exportar, clonar el repo, instalar bun y volver a importar. Para el usuario de la web es un callejón sin salida.
**Propuesta:** Si es intencionado (la firma fuera del alcance del agente), explicarlo y dar el camino completo («Exporte el proyecto, firme con la CLI y vuelva a importarlo»). Mejor: firmar en la app tras una confirmación explícita (nombre y casilla «he leído el informe»), y que el agente no pueda hacerlo.
**Captura:** `71-revision.png`
**Verificado:** navegador

### P-08 · El asistente de la primera planta se pierde con un clic fuera y no vuelve
**Severidad:** media
**Dónde:** Diálogo «Plantas», que se abre solo al crear un proyecto. `app/src/editor/Dialogos.tsx:43` (`onMouseDown` en el fondo cierra).
**Qué pasa:** Un clic en el fondo oscuro lo cierra sin crear las plantas. Al reabrir el proyecto ya no sale, y el gestor de la barra no tiene el texto guía «Empiece por las plantas…» ni la cuenta «plantas sobre la cimentación». A un usuario que se despista le quedan una planta N1 y un lienzo vacío sin indicaciones (P-09).
**Propuesta:** Que el primer paso no se cierre con un clic en el fondo (sólo con la ✕ o Esc), y que vuelva a salir mientras el proyecto tenga sólo la planta de la plantilla y ningún objeto.
**Captura:** `04-proyecto.png`, `05-hover.png`, `11-reabrir.png`
**Verificado:** navegador

### P-09 · El lienzo vacío no orienta
**Severidad:** media
**Dónde:** Modelo, planta sin objetos.
**Qué pasa:** Una vez creadas las plantas, se ven la rejilla y los ejes X/Y, sin ninguna indicación del siguiente paso. Los estados vacíos del navegador sí explican («Sin vistas guardadas…», «Un plano DXF en gris…»), pero no el de la planta. Encima, un proyecto vacío sale «CALCULADO» en verde con 0 nudos, y un aviso «El caso Q no tiene ninguna carga».
**Propuesta:** En una planta vacía, un rótulo en el centro: «Empiece por los ejes (E) o ponga pilares (P); o calque un DXF», con los tres botones. Sin objetos, que el estado diga «vacío», no «calculado», y que no salgan avisos de casos.
**Captura:** `14-tras-plantas.png`, `76-vacio-diagnostico.png`
**Verificado:** navegador

### P-10 · Los diagnósticos dicen qué pasa, pero no cómo arreglarlo
**Severidad:** media
**Dónde:** Panel inferior → Diagnósticos.
**Qué pasa:** «Las losas L1-N1 y L1-N1-2 se solapan en 25.0 m² en la planta N1» y «Las vigas V3-N2 y V3-N2-2 se solapan a lo largo de 9.40 m» son claros, pero no proponen nada. El código `losa/solapadas` va delante del texto, y el decimal es un punto (25.0, 9.40) cuando el resto de la app usa coma. Con 8 errores iguales, el usuario los tiene que arreglar uno por uno sin saber que todo viene de una sola acción.
**Propuesta:** Una línea «Cómo arreglarlo» por tipo («Borre una de las dos; si viene de copiar a plantas, Deshacer»), con un botón cuando sea seguro («Borrar la copia»). Agrupar los diagnósticos iguales, con coma decimal. El código, en gris o en un tooltip.
**Captura:** `46-diagnosticos.png`
**Verificado:** navegador

### P-11 · La plantilla de Viga toma en silencio la sección del pilar
**Severidad:** media
**Dónde:** Herramienta Viga → Propiedades → sección.
**Qué pasa:** Con sólo la sección «P30x30» en el proyecto, la plantilla de Viga la pone sin preguntar. En Pilar, sin sección, hay un botón azul «Nueva sección…» y un aviso. Un usuario con prisa dibuja las vigas con la sección del pilar y no se entera hasta que mira las etiquetas.
**Propuesta:** No reutilizar una sección cuyo prefijo es de otra pieza (P frente a V). Que la plantilla de Viga se comporte como la de Pilar («Ninguna sección de viga: créela») o que proponga 30×50.
**Captura:** `26-viga.png`
**Verificado:** navegador

### P-12 · No hay forma de crear una retícula de ejes por luces
**Severidad:** media
**Dónde:** Herramienta Ejes.
**Qué pasa:** Para 6 ejes hacen falta 12 puntos tecleados (o 12 clics). Lo normal en los programas que conoce el usuario es «3 ejes en X a 5 m, 3 en Y a 5 m». «Proponer ejes» sólo sirve cuando ya hay pilares.
**Propuesta:** En la plantilla de Ejes, un «Retícula…» con las luces en X y en Y (`5 5` o `2×5`), su origen y su giro.
**Captura:** `15-ejes.png`, `20-ejes.png`
**Verificado:** navegador

### P-13 · Ctrl+A selecciona el texto de la página, no el modelo
**Severidad:** media
**Dónde:** Modelo, con Elegir y el cursor sobre la planta.
**Qué pasa:** Para llevar toda la planta a otras, pulsé Ctrl+A: se marcó en azul todo el texto de la interfaz y no se eligió ningún objeto. En el código no hay ningún atajo para «elegir todo».
**Propuesta:** Ctrl+A en la vista: elegir todo lo visible de la planta, respetando los filtros y, en Cargas, sólo las cargas. Y `user-select: none` en el armazón, para no seleccionar texto.
**Captura:** `33-aplantas.png`
**Verificado:** navegador y código (no hay manejador de Ctrl+A)

### P-14 · Las coordenadas tecleadas exigen el cursor sobre la planta
**Severidad:** media
**Dónde:** Cualquier herramienta de dibujo, con «x; y» e Intro. `app/src/dibujo/controlador.ts:352,376`.
**Qué pasa:** Al pulsar Ejes en la barra, el ratón queda en la barra. Tecleé «0; -1», pulsé Intro y salió «Lleve el cursor a una planta». Unas coordenadas absolutas no dependen del cursor, y con una sola vista no hay ambigüedad. El campo además se abre en la esquina superior izquierda, encima del logo. El primer Intro también pareció perderse: el campo se quedó con «0; -10; 11» después de teclear el segundo punto.
**Propuesta:** Sin cursor en una vista, usar la última vista activa (o la única). Abrir el campo junto a la barra de estado o en el centro de la vista activa, no en (0, 0).
**Captura:** `16-teclear.png`, `17-eje1.png`, `18-p1.png`
**Verificado:** navegador

### P-15 · Signos distintos al escribir y al dibujar las cargas
**Severidad:** media
**Dónde:** Cargas → Superficie (Propiedades frente al dibujo y la tabla).
**Qué pasa:** En Propiedades, «Gravedad, hacia abajo en positivo», y escribí 2. El dibujo rotula «Q1: -2 kN/m²» y la tabla, «q = 0 0 -2». Para quien acaba de escribir 2, parece que se ha guardado mal. A eso se suma que las cargas se llaman Q1, Q2… también en el caso G, y se confunden con el caso Q (de uso).
**Propuesta:** Rotular las cargas de gravedad como se escriben («2 kN/m² ↓»). Dar a las cargas un prefijo que no choque con los casos («C1», o el del caso: «G-1», «Q-1»).
**Captura:** `38-carga1.png`, `40-cargas-copiadas.png`
**Verificado:** navegador

### P-16 · «Máximo» y «mínimo» de uz al revés de lo que se espera de una flecha
**Severidad:** media
**Dónde:** Resultados · Losas · uz (mapa y Propiedades).
**Qué pasa:** El mapa rotula «máximo −0,263 mm» en el apoyo y «mínimo −1,51 mm» en el vano. En Propiedades, «uz máximo −0,26 / uz mínimo −1,51», pero la tabla de flechas dice «Máxima 1,51». El ingeniero busca la flecha máxima y la encuentra bajo «mínimo». Además, el chip de la vista enseña «52 ms», que no interesa.
**Propuesta:** En uz, rotular «flecha máxima 1,51 mm ↓» y, si hace falta, «levantamiento». Quitar los ms del chip, o dejarlos en un modo de depuración.
**Captura:** `53-resultados.png`
**Verificado:** navegador

### P-17 · Importar un fichero roto da un error técnico en inglés y una salida que no viene al caso
**Severidad:** media
**Dónde:** Inicio → Importar (fichero no válido). `app/src/App.tsx:464`.
**Qué pasa:** La pantalla dice «El fichero no es JSON válido: Expected ',' or '}' after property value in JSON at position 28 (line 1 column 29)», y debajo, «Corríjalo y la app lo recargará sola si lo abrió desde su carpeta», que no aplica a un fichero importado. Arriba siguen las pestañas Modelo y Cargas, y la barra dice «sin guardar en ningún sitio (Guardar en mis proyectos, o Exportar)» para algo que ni se ha abierto. Para salir hay que dar con «Proyectos».
**Propuesta:** «Este fichero no es un proyecto válido (línea 1, columna 29)», con un botón «Volver a Mis proyectos». Ocultar los espacios y el estado de guardado cuando no hay proyecto.
**Captura:** `74-importar-roto.png`
**Verificado:** navegador

### P-18 · La paleta (Ctrl+K) no entiende el vocabulario del ingeniero y no tiene ayuda
**Severidad:** media
**Dónde:** «Buscar u ordenar» (Ctrl+K).
**Qué pasa:** «flecha», «axil», «momento» y «ayuda» no dan nada; «deformada», «losa», «carga», «calcular» y «exportar», sí. La paleta sólo busca los nombres literales de las órdenes. La flecha está en «uz» o «Deformada», el axil en «Pilares» y los momentos en «M11»/«M22», que un usuario nuevo no conoce.
**Propuesta:** Sinónimos por orden (flecha → Losas uz / Deformada; axil → Pilares; momento → M11/M22, Diagramas; armadura → Armado). Una entrada «Ayuda: cómo empezar» que enseñe el orden de los pasos (plantas → ejes → pilares → vigas → forjados → cargas → calcular).
**Captura:** `68-paleta-flecha.png`
**Verificado:** navegador

### P-19 · Las versiones no dicen qué cambió
**Severidad:** media
**Dónde:** Barra → Versiones anteriores, y Mis proyectos → Versiones.
**Qué pasa:** Cada versión tiene la hora, el nombre y el tamaño (1 kB, 8 kB), y nada más. Para volver a «antes de copiar las plantas» hay que adivinar por la hora.
**Propuesta:** Un resumen por versión («4 plantas · 9 pilares · 18 vigas · 12 forjados · 24 cargas») o la última acción («A plantas: 10 objetos a N2, N1»). Con 30 versiones en la lista, eso decide.
**Captura:** `57-versiones.png`
**Verificado:** navegador

### P-20 · Un mensaje informativo sale en rojo, como un error
**Severidad:** baja
**Dónde:** Herramienta Forjado con «Con zunchos» (`src/editor/dibujo/piezas.ts:251`, como `avisos`).
**Qué pasa:** «Sin zunchos: L1 ya tiene todos sus bordes sobre una viga, un muro, un apoyo lineal u otro forjado» es una buena noticia, pero sale en rojo junto a la ayuda de la herramienta, y parece que algo ha fallado.
**Propuesta:** En gris o en verde, como información, o no decir nada si no hay zunchos que poner.
**Captura:** `31-losa1.png`, `32-losas.png`
**Verificado:** navegador

### P-21 · Un error de la herramienta se queda después de arreglarlo
**Severidad:** baja
**Dónde:** Herramienta Pilar, sin sección.
**Qué pasa:** «Elija en Propiedades la sección del pilar (o cree una)» sigue en rojo después de crear P30x30 y asignarlo, hasta el siguiente clic. Lo mismo en «A plantas»: el error de las cargas sigue allí tras cambiar a «Toda la planta».
**Propuesta:** Borrar el mensaje de error de la herramienta al cambiar su plantilla o la opción del diálogo.
**Captura:** `24-seccion-creada.png`, `44-toda-planta.png`
**Verificado:** navegador

### P-22 · El chip de ayuda de la herramienta tapa el dibujo
**Severidad:** baja
**Dónde:** Chip azul en la parte de abajo de la vista.
**Qué pasa:** Con tres frases y su segunda columna («O teclee las coordenadas», más un aviso en rojo), el chip ocupa tres o cuatro líneas y tapa las burbujas de los ejes de abajo y parte de la losa (con Forjado, la mitad del recuadro inferior). La vista además no se encuadra sola al crecer el modelo: los ejes quedan en una esquina.
**Propuesta:** Limitarlo a una línea, con la ayuda larga plegable («?»), o ponerlo en la barra de estado. Encuadrar la planta al poner los primeros ejes o pilares.
**Captura:** `25-pilares.png`, `32-losas.png`
**Verificado:** navegador

### P-23 · La cabecera «|My|» tiene valores con signo
**Severidad:** baja
**Dónde:** Resultados · Pilares, cuadro de la planta y tramos del pilar. `app/src/pantallas/Pilares.tsx:204-205,252-253`.
**Qué pasa:** La columna dice |My| y |Mz| (valor absoluto), pero enseña −12,6, 12,6, −11,0… Además, Pilares se abre en la planta de arriba (N3), con el axil más pequeño: el que interesa (P5 −1513 kN, ν = 0,84) está en N1, dos clics más abajo.
**Propuesta:** Quitar las barras o enseñar el valor absoluto. Que Pilares se abra en la planta más baja, o con un cuadro de «arranques».
**Captura:** `55-pilares.png`, `56-pilar-p5.png`
**Verificado:** navegador y código

### P-24 · La «altura» de una planta, al revés de la costumbre
**Severidad:** baja
**Dónde:** Tabla Plantas.
**Qué pasa:** La columna altura va «de forjado a forjado hasta la planta de encima; vacía en la de arriba»: Cim tiene 3 y N3 está vacía. En los programas que conoce el usuario, la altura de una planta es la distancia a la de debajo. La ayuda lo dice, pero sólo con la celda elegida, en la línea de abajo.
**Propuesta:** Llamar a la columna «altura hasta la de encima», o enseñar la altura de cada planta hasta la de debajo, que es lo que se lee en un alzado.
**Captura:** `14-tras-plantas.png`, `79-altura.png`
**Verificado:** navegador

### P-25 · Propiedades de una elección mezclada enseña sólo los ejes
**Severidad:** baja
**Dónde:** Elegir por ventana (25 objetos: ejes, pilares, vigas, losas) → Propiedades.
**Qué pasa:** Sale «Selección · 25 objetos» y debajo «Datos · 6 ejes», con campos editables x desde, y desde…, como si sólo se hubieran elegido los ejes. En Cargas, la misma ventana coge ejes y pilares, y Propiedades deja editar los datos de los pilares (en Cargas se supone que sólo se tocan cargas).
**Propuesta:** Con una elección mezclada, un resumen por tipo (6 ejes, 9 pilares, 6 vigas, 4 losas) en el que cada tipo se despliega. En Cargas, que la ventana coja sólo cargas, como las herramientas.
**Captura:** `34-aplantas-ventana.png`, `39-cargas-aplantas.png`
**Verificado:** navegador

### P-26 · El título de la pestaña no dice qué proyecto es
**Severidad:** baja
**Dónde:** `<title>` (`app/index.html:26`).
**Qué pasa:** Todas las pestañas se llaman «FEM 3D · Visor»: con dos proyectos (o el mismo dos veces) no se distinguen, y la app es un editor, no un visor. La barra de estado, además, siguió con el nombre antiguo del proyecto («Edificio 3x3 prueba») después de cambiarlo a «… B».
**Propuesta:** `document.title = "<proyecto> · Concreta FEM 3D"`, y la barra de estado con el nombre actual.
**Captura:** `67-conflicto-p1.png`
**Verificado:** navegador

### P-27 · Nada lleva a los resultados al acabar de calcular
**Severidad:** baja
**Dónde:** Botón Calcular (desde Cargas).
**Qué pasa:** El estado pasa a «CALCULADO» y Resultados deja de estar en gris, pero el usuario se queda en Cargas sin ninguna señal. Tampoco hay botón «Calcular» en Resultados mientras está en gris (sólo en la barra).
**Propuesta:** Un aviso breve, «Calculado en 0,5 s · Ver resultados →», o resaltar la pestaña Resultados la primera vez.
**Captura:** `52-calculado.png`
**Verificado:** navegador

### P-28 · «Exportar el proyecto.json» descarga «<nombre>.json»
**Severidad:** baja
**Dónde:** Barra y Mis proyectos → Exportar.
**Qué pasa:** El botón y la ayuda prometen «el proyecto.json», y el fichero se llama «Edificio 3x3 prueba.json». La CLI y la carpeta del agente esperan `proyecto.json` (Inicio: «El agente y la CLI leen el proyecto.json del disco»). Es menor, pero el usuario que siga las instrucciones tiene que renombrarlo.
**Propuesta:** O el botón dice «Exportar (.json)», o se descarga como `proyecto.json`, y el texto de «En el disco» dice que se puede renombrar.
**Captura:** `58-exportar.png` (el nombre lo dio el gancho de descarga)
**Verificado:** navegador

### P-29 · La barra de estado dice «(CLI)» con resultados de la caché del navegador
**Severidad:** baja
**Dónde:** Barra de estado. `app/src/App.tsx:289`.
**Qué pasa:** Al reabrir o recargar un proyecto del navegador sale «resultados de .fem/9becb57d (CLI) · leídos en 0.07 s», y no hay ni carpeta .fem ni CLI. El usuario se pregunta si algo se calculó fuera.
**Propuesta:** «resultados guardados (de este navegador) · 0,07 s». Usar «(CLI)» sólo cuando de verdad vienen de `.fem/` en el disco.
**Captura:** `59-tras-recarga.png`
**Verificado:** navegador y código

### P-30 · El «?» de ayuda sólo funciona con el ratón, y algunas ayudas sólo dicen el formato
**Severidad:** baja
**Dónde:** «?» de Propiedades y diálogos. `app/src/componentes/Ayuda.tsx:57-62`.
**Qué pasa:** El «?» es un `<i aria-hidden>` que sólo se abre con `mouseenter`: con el teclado, en una pantalla táctil o con un lector de pantalla no se llega a la ayuda. Algunos textos sólo dan la sintaxis: «huecos → polígonos separados por «|»», o «tipo → … cambiarlo cambia las columnas que tocan» (lenguaje de la tabla dentro del inspector). El interruptor «Ayudas» que cita `CLAUDE.md` ya no existe (lo quitó el commit 795bade): la documentación está desfasada.
**Propuesta:** Un `<button>` con foco y `aria-describedby`, que se abra también con clic o Enter. Que cada ayuda diga primero qué es y para qué sirve, y después el formato. Actualizar `CLAUDE.md`.
**Captura:** `70-ayuda-q.png`
**Verificado:** navegador y código

### P-31 · El texto de Revisión: «1 avisos» y la huella en primer plano
**Severidad:** baja
**Dónde:** Revisión → Veredicto. `src/agente/informe.ts:91`.
**Qué pasa:** «1 avisos de sensatez en 1 de 21 comprobaciones». El informe empieza por la huella sha256 y el núcleo, que no le dicen nada al ingeniero, antes del veredicto.
**Propuesta:** Concordar el singular («1 aviso»). Poner primero el veredicto y llevar las huellas a un pie de «Identidad».
**Captura:** `71-revision.png`
**Verificado:** navegador y código

---

## No se pudo verificar en el navegador sin interfaz
- **El aviso de versión nueva (PWA):** según `AvisoVersion.tsx` y `vite.config.ts` (`devOptions.enabled: false`), sólo funciona en producción.
- **«Abrir una carpeta»:** el selector de File System Access necesita un usuario real.
- **Salir de un ejemplo editado con «Proyectos»:** la navegación ocurrió sin ningún diálogo capturado. No sé si el `beforeunload` de `useProyecto.ts:594` no se dispara o si el navegador sin interfaz lo descarta. Conviene probarlo a mano: si se pierde lo editado en un ejemplo sin aviso, sería de severidad media.
- **Conflicto real entre dos pestañas:** con el autoguardado a 400 ms no conseguí que dos ediciones se cruzaran. Los cambios llegaron de una pestaña a la otra sin pérdida.

## Lo que funciona bien
- **Inicio claro:** un botón principal, la advertencia «El navegador no garantiza conservarlos: exporte los importantes», y Duplicar y Borrar con confirmación en la propia fila (sin diálogos).
- **El asistente de plantas al crear:** con sus valores por defecto (3 plantas de 3 m) deja el edificio pedido en un clic, con alzado previo y las nuevas en azul.
- **Gestor de secciones:** ids automáticos (P30x30, V30x50), propiedades calculadas al momento con su croquis y «Crear y usar» en un solo paso.
- **Pilar con ventana:** un pilar en cada cruce de ejes. Forjado con un clic por recuadro, con canto y pp por defecto, y «sale solo» para el pp.
- **Mensajes de la herramienta en lenguaje natural:** «Viga: el punto siguiente (2 puestos). Doble clic o Intro termina; Retroceso quita el último». «Escriba en Propiedades el valor de la carga» en vez de crear una carga nula.
- **Validación de la hoja:** «x: «abc» no es un número», sin dejar entrar el valor.
- **Cálculo:** en menos de un segundo, con el equilibrio por caso a la vista (ΣF/ΣM ~1e-15). Deshacer tras un error devuelve el estado «calculado» sin recalcular.
- **Resultados útiles a la primera:** el mapa uz con su tabla de flechas por losa, M11 con isolíneas rotuladas, y el axil por pilar con ν y el aviso de ν > 0,65 resaltado.
- **Persistencia:** lo confirmado sobrevive a recargar. Las dos pestañas se sincronizan solas. Importar un JSON válido lo guarda y lo abre.
