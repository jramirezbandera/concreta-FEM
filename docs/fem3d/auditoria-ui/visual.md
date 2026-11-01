# Auditoría visual · Concreta FEM 3D (app)

- **Fecha:** 2026-11-01.
- **Cómo:** navegador sin interfaz de gstack sobre `http://localhost:5180`, con los ejemplos `vivienda` y `muestrario`.
- **Qué se recorrió:** los cuatro espacios (Resultados con sus seis modos), el inicio, Propiedades con un forjado elegido, el panel inferior (Tablas, Diagnósticos, Alzado de viga, Franjas, Reacciones), la paleta, los gestores (Secciones, Materiales, Plantas, Casos), Versiones, planta, alzado, 3D y 2×2.
- **Temas y tamaños:** los dos temas, en 1920×1080, 1600×900, 1366×768, 1280×720 y 1024×768.
- **Cómo se midió:**
  - contraste WCAG con los colores reales: `getComputedStyle` y el fondo efectivo compuesto, con `audit.js`; los tokens, con `contraste.py`;
  - tamaños de letra y áreas de clic, con `audit.js`;
  - desbordes, con `scrollWidth` frente a `clientWidth`;
  - la fuente del lienzo, con `measureText`.

  Los scripts y los JSON de cada medida están junto a este informe.
- **Lo medido y lo opinado:** «**Medido:**» va con su número; «**Opinión:**» es criterio de diseño.

Rutas de las capturas: todas en `C:/Users/javie/AppData/Local/Temp/claude/d--PROGRAMACION-Concreta-FEM/0145a65a-536f-4c1a-bd43-d6b6eb76a5bd/scratchpad/auditoria/visual/` (abajo se da sólo el nombre del fichero dentro de esa carpeta).

---

## Severidad alta

### D-01 · La barra superior se sale de la ventana por debajo de 1600 px y hay scroll horizontal
**Severidad:** alta (roto)
**Dónde:** todas las pantallas, a 1366×768, 1280×720 y 1024×768, en los dos temas; `app/src/index.css:567` (`.barra-sup`, sin `min-width: 0` ni regla para lo que no cabe).

**Qué pasa** (medido):
- `.barra-sup` mide 1403 px de `scrollWidth` a cualquier ancho menor y el documento entero pasa a 1403 px: aparece scroll horizontal de página.
- **A 1366:** quedan fuera el botón del tema y media «Proyectos».
- **A 1280:** quedan fuera «Proyectos» y el tema.
- **A 1024:** quedan fuera «Recalcular», «Buscar u ordenar», «Proyectos» y el tema.
- El nombre del proyecto se encoge a ~8 px y sólo se ve un trazo («Concreta \»).

**Propuesta:**
- `min-width: 0` en el grupo del nombre, con un mínimo de 160 px y «…».
- Por debajo de 1500 px, «Guardar en mis proyectos» y «Recalcular» sólo con icono y título, y «Buscar u ordenar» como icono de lupa (Ctrl+K sigue).
- Por debajo de 1100 px, un menú «⋯» con Exportar, Proyectos y Tema.
- `overflow: hidden` en `.barra-sup` para que nunca dé scroll a la página.

**Captura:** `20-modelo-1366x768.png`, `20-modelo-1280x720.png`, `20-modelo-1024x768.png`, `27-Resultados-1024.png`.

### D-02 · Las mayúsculas automáticas cambian las unidades y los ids
**Severidad:** alta (engañoso)
**Dónde:** las cabeceras de las tablas `.tb th`, `.sec` y `.dlg-et` en Resultados (Flechas, Pilares, Reacciones, Franjas, Caras y apoyos), en el panel inferior y en el gestor de Secciones; `app/src/index.css:291` (`.tb th`), `:203` (`.sec`) y `:519` (`.dlg-et`).

**Qué pasa** (medido en pantalla):
- «MÁXIMA MM» y «RELATIVA MM»: MM es megámetro.
- «N KN», «MY+ KN·M», «INFERIOR KN·M/M», «FX KN», «MX KN·M», «S M».
- El id `P30x30` sale como «P30X30 · RECTANGULAR» en la cabecera de su ficha. Los ids distinguen mayúsculas, así que lo que se lee no es lo que hay que escribir.
- El propio CSS ya lo había visto con ν (`index.css:304`: «Sin mayúsculas: ν pasaría a Ν»), pero sólo lo corrige en una clase.

**Propuesta:**
- Partir cada cabecera en `<span>nombre</span> <span class="u">unidad</span>`, con `.u { text-transform: none; letter-spacing: 0; font-family: var(--font-mono) }`, como ya hace `.sec > span + span`.
- Lo mismo para los ids en `.sec` y `.dlg-et`.
- Otra opción: quitar `text-transform: uppercase` de las cabeceras de tabla y dejarlas en versalitas con `font-variant-caps: all-small-caps`, que tampoco toca las unidades si van en su span.

**Captura:** `05-resultados-claro.png` (Flechas), `07-Pilares-claro.png` y `07-Reacciones-claro.png` (tablas), `07-Armado-claro.png`, `13-gestor-secciones.png`.

### D-03 · El dibujo no se vuelve a encuadrar al abrir el panel inferior, al cambiar de modo o de tamaño: lo dibujado queda bajo la cabecera y la leyenda
**Severidad:** alta (resultados tapados)
**Dónde:** Resultados · Diagramas y Pilares a 1920, en los dos temas; Resultados · Losas a 1024.

**Qué pasa** (medido en las capturas):
- **En Diagramas,** con el alzado de la viga abierto abajo:
  - la fila de arriba de la planta queda cortada por el borde (el «6,92» de la viga superior y las burbujas 1–7 no se ven);
  - «-19,7» queda bajo los chips de la cabecera;
  - el diagrama de la columna derecha corre por debajo de la leyenda.
- **En Pilares,** las burbujas de los ejes desaparecen y «P4 -85,6» queda pegado a los chips.
- **A 1024,** la planta de Resultados sale cortada por la izquierda (el eje A, fuera).
- El encuadre no reserva sitio ni para la leyenda (196 px) ni para la cabecera (30 px más 10 px de margen).

**Propuesta:**
- Encuadrar de nuevo al cambiar el tamaño de la celda: con `ResizeObserver` en `.celda`, si el usuario no ha movido la cámara desde el último encuadre automático.
- Encuadrar contra la caja útil: la celda menos 50 px arriba (la cabecera), menos el ancho de la leyenda abierta a la derecha y menos 56 px abajo (la barra de la vista).

**Captura:** `06-diagramas-claro.png`, `06b-diagramas-zoom.png`, `07-Pilares-claro.png`, `27-Resultados-1024.png`.

---

## Severidad media

### D-04 · El dibujo no está en Geist: los rótulos de planta, alzado y 3D salen en Segoe UI
**Severidad:** media (incoherente, y distinto en cada sistema)
**Dónde:** todas las vistas, en los dos temas; `app/src/vistas/motor.ts:436` (`fuente()` pide `Geist`), `app/src/vistas/fondo.ts:192` y `:301`, `app/src/dibujo/controlador.ts:1198`. La `@font-face` declara la familia «Geist Sans» (`index.css:9`).

**Qué pasa** (medido):
- `measureText("Z-CUB-S-5 30x30 P4 reticular")` a 11 px da 141,17 px con la pila del motor, igual que con «Segoe UI» (141,17); con «Geist Sans», 154,77.
- La familia «Geist» no existe en la página, así que todo el dibujo cae a Segoe UI en Windows y a la del sistema en macOS.
- Con otra letra en cada sistema, el ancho de los rótulos cambia y la resolución de colisiones no da lo mismo de un equipo a otro.
- La interfaz (Geist) y el dibujo (Segoe) no casan: se ve en la leyenda, que es DOM, junto a los rótulos del lienzo.

**Propuesta:** `fuente = … \`${tam}px "Geist Sans", system-ui, sans-serif\`` en los cuatro sitios, o un alias `@font-face { font-family: "Geist"; src: … }`. Antes de pintar el primer fotograma, esperar a `document.fonts.load('11px "Geist Sans"')`.

**Captura:** `01b-planta-zoom.png` (rótulos en Segoe), comparada con la leyenda de `01-modelo-1920.png`.

### D-05 · El texto terciario, las pastillas de estado y la herramienta activa no llegan a 4,5:1 en el tema claro
**Severidad:** media
**Dónde:** el tema claro, en todas las pantallas; los tokens están en `index.css:104-105`, y los tintes y `.pill` en `index.css:278`.

**Qué pasa** (medido; tamaños de 10–11,5 px, así que la exigencia es 4,5:1):

| Qué | Dónde se ve | Contraste |
|---|---|---|
| `--color-text-tertiary` #6b778a | sobre superficie | 4,33 |
| | sobre `elevated` | 4,14 |
| | sobre el lienzo | 4,16 |
| Etiquetas en mayúsculas de 10 px del terciario sobre `bg-surface` | «COMBINACIONES · DESPLAZAMIENTOS», «MAGNITUD» de la barra | 4,33 |
| `.leyenda-cab` | | 4,45 |
| `.dock-tab .insignia` | | 4,14 |
| `.ges-n` sobre la fila elegida | | 3,89 |
| Pastillas sobre su tinte | ok («CALCULADO · f612c89d», «BIEN») | 4,39 |
| | warn («AVISOS», «AVISO») | 4,38 |
| | fail | 4,14 |
| Herramienta activa (acento sobre `tint-accent` y superficie) | «Planta», «1», «Losas» | 4,43 |

**Propuesta:**
- `--color-text-tertiary: #5f6b7e`: 5,16 sobre superficie, 4,93 sobre `elevated` y 4,95 sobre el lienzo.
- El texto de las pastillas en el tono de 800: ok `#166534` (6,23), warn `#92400e` (6,19), fail `#b91c1c` (5,54).
- La herramienta activa con `--color-accent-hover` #1d4ed8 (5,75).
- En el oscuro, el terciario sobre `elevated` da 4,21: `#8b909b` (5,07).

**Captura:** `05-resultados-claro.png`, `13-gestor-secciones.png`, `08-revision-claro.png`; las cifras, en `audit-*.json`.

### D-06 · La escala de grises está al revés: «disabled» es más oscuro que «tertiary» y los deshabilitados de verdad van por opacidad
**Severidad:** media (incoherente)
**Dónde:** los tokens de `index.css:104-105` y `:157-158`, en los dos temas.

**Qué pasa** (medido):
- `--color-text-disabled` #586880 da 5,67:1 y `--color-text-tertiary` #6b778a, 4,53:1: el que se llama «deshabilitado» destaca más que el terciario.
- `disabled` se usa para cosas activas: las cabeceras de la hoja (`index.css:406`), el número de fila, `.kbd`, las celdas calculadas, el `placeholder` de los campos y los ejes de los gráficos SVG.
- Los controles deshabilitados de verdad van con `opacity: .4`–`.45`: deshacer y rehacer dan 1,9:1, y «Aplicar a 23 pilares», 2,2:1. El primario deshabilitado se queda en un azul claro que parece un estado activo más suave.

**Propuesta:**
- Renombrar el token a `--color-text-muted`, entre el secundario y el terciario.
- Dejar `--color-text-disabled` para lo deshabilitado: #9aa4b2 en claro y #5b5f69 en oscuro, sin opacidad en el texto.
- El primario deshabilitado: `bg-elevated` con texto `text-disabled`, sin sombra.

**Captura:** `13-gestor-secciones.png` (Aplicar deshabilitado), `10-tablas.png` (cabeceras de la hoja).

### D-07 · Once tamaños de letra, y casi todo por debajo de los 13 px decididos
**Severidad:** media (incoherente; contra I-h)
**Dónde:** toda la app; `index.css` entero.

**Qué pasa** (medido en el DOM visible):
- Tamaños distintos: 9, 10, 10,5, 11, 11,5, 12, 12,5, 13, 14, 15 y 18 px, más 9, 10, 10,5, 11, 12 y 13 en el lienzo.
- En Modelo, 60 de 84 nodos de texto (71 %) miden menos de 12 px, y 11 y 11,5 son los tamaños más usados (24 y 27 nodos); 13 px sólo hay 12.
- `interfaz.md` §13 fijó 13 px de base justo porque «hoy, 11 y 12».

**Propuesta:** una escala de cinco pasos, sin medios píxeles.

| Tamaño | Para qué |
|---|---|
| 11 px | sólo etiquetas en mayúsculas y unidades |
| 12 px | secundario, celdas de la hoja, rótulos de la barra |
| 13 px | base: filas, campos, botones, tablas |
| 15 px | títulos de panel y de diálogo |
| 18 px | título del informe |

En concreto: `.herr` de 11,5 a 12; `.tb` de 12,5 a 13; `.btn`, `.sel` y `.seg` de 12,5 y 12 a 13; los «?» de 9 a 11. El lienzo, con mínimo de 11 y rótulos de pieza a 12.

**Captura:** `01-modelo-1920.png`; los recuentos, en `audit-modelo-claro.json`.

### D-08 · Los botones de modo de Resultados cambian de sitio con el modo
**Severidad:** media (molesto a diario)
**Dónde:** la barra de Resultados, en todos los tamaños y temas; `app/src/pantallas/Armado.tsx:527` y `app/src/pantallas/Desplomes.tsx:92` meten su campo delante de los modos.

**Qué pasa** (medido):
- El borde izquierdo de «Losas» está en x = 304 en Losas, en 394 en Deformada y Reacciones (campo «Escala») y en 430 en Armado (campo «Armadura»).
- Al pulsar «Armado» la barra se desplaza 124 px y el cursor queda encima de «Diagramas»: se ve en la captura, con Diagramas resaltado tras pulsar Armado.

**Propuesta:** fijar los modos justo después del selector de combinaciones y poner el campo de cada modo detrás, tras un separador, junto a «Magnitud» o «Esfuerzo». Otra opción: reservarle un ancho fijo (p. ej. 140 px) aunque esté vacío.

**Captura:** `07-Armado-claro.png` (hover en Diagramas), `05-resultados-claro.png`.

### D-09 · El mismo azul para la selección y para el negativo de los diagramas
**Severidad:** media (confunde dato con estado)
**Dónde:** Resultados · Diagramas en planta, y Modelo en 3D con una pieza elegida; `index.css:128` (`--color-env-min: #2563eb`, igual a `--color-accent`).

**Qué pasa:**
- **Medido:** la viga elegida (Z-CUB-S-1) va contorneada en #2563eb y su momento negativo, relleno en el mismo azul: no se sabe dónde acaba la selección y empieza el diagrama.
- **Medido:** en el 3D, el forjado elegido se pinta entero en azul acento saturado y tapa los casetones.

**Propuesta:**
- La selección como contorno con halo y no como relleno, en un tono propio: `--color-select: #f59e0b` en claro y `#fbbf24` en oscuro, que no se usa en los datos.
- O llevar `--color-env-min` a #1e40af o #0e7490, distinto del acento.
- En el 3D, el elegido con su color y una arista de 2 px del color de selección, más un 20 % de tinte como mucho.

**Captura:** `06b-diagramas-zoom.png`, `09-propiedades-forjado.png`.

### D-10 · Rótulos de diagramas uno encima de otro
**Severidad:** media
**Dónde:** Resultados · Diagramas, en planta y en el alzado de la viga del panel inferior, en los dos temas.

**Qué pasa** (medido en la captura):
- «-27,7» y «-19,5», y «-22,8» y «-21,1», se pisan junto a P16 y P17.
- En el alzado, la curva tacha el signo de «-27,7».
- Son de 10–11 px, en Segoe (D-04).

**Propuesta:**
- Pasar los valores de los diagramas por la misma resolución de colisiones por prioridad que los demás rótulos (`app/src/vistas/rotulos.ts`).
- Entre dos extremos a menos de una altura de texto, rotular el de mayor |valor| y desplazar el otro en perpendicular a la barra.
- En el alzado, el rótulo fuera de la curva, con su halo.

**Captura:** `06b-diagramas-zoom.png`, `06c-alzado-viga-zoom.png`.

### D-11 · Iconos repetidos o que dicen otra cosa
**Severidad:** media (iconografía)
**Dónde:** la barra de Modelo y la de Resultados; `app/src/armazon/iconos.tsx:101-120`, `:159-166` y `:210`.

**Qué pasa** (medido en el código):
- `IcMateriales` e `Ic3D` tienen el mismo trazado (el cubo), y los dos están en la barra de Modelo.
- `IcPlanta` (cuadrado redondeado) e `IcDisp1` (rectángulo redondeado) van uno al lado del otro y los dos se encienden en azul: «Planta» y «1» parecen el mismo botón.
- `IcPlantas` son tres rayas de menú «hamburguesa» y se parece a `IcCasos`.
- Losas es un ojo, que en todas partes quiere decir «visibilidad».

**Propuesta:**
- Materiales, un muestrario (`swatch-book` de lucide); el 3D se queda el cubo.
- Plantas, niveles apilados en alzado: tres rayas horizontales con un pilar que las cruza.
- Losas, un cuadrado con bandas de isovalores.
- Las disposiciones, en un solo botón desplegable (ver D-12).

**Captura:** `01c-barra-izq.png`, `01d-barra-der.png`.

### D-12 · La barra de herramientas no cabe desde 1600 px y esconde las disposiciones; el tipo de vista está dos veces
**Severidad:** media
**Dónde:** Modelo, a 1600×900 y menos; `index.css:577` y `:604`.

**Qué pasa** (medido):
- `.herramientas` mide 1722 px de `scrollWidth` frente a 1600 px de `clientWidth` a 1600 px, y 1462 frente a 1366 a 1366 px.
- «1|1», «1/1» y «2×2» quedan fuera (a 1280, también «3D» y «1»), y la única pista es una barra de desplazamiento fina.
- Planta, Alzado y 3D también se eligen en el chip de la cabecera de cada vista: el control está repetido.

**Propuesta:**
- Quitar Planta, Alzado y 3D de la barra (ya están en el chip de la vista).
- Las cuatro disposiciones, en un solo botón con desplegable y Ctrl+1…4.
- Por debajo de 1500 px, las herramientas de editar (Mover…Renumerar) en un grupo plegable «Editar ▾».

**Captura:** `20-modelo-1600x900.png`, `20-modelo-1366x768.png`.

### D-13 · Los paneles tienen el mismo ancho fijo en cualquier ventana: con algo elegido la vista baja del 61 %
**Severidad:** media (contra «el dibujo manda»)
**Dónde:** Modelo con un objeto elegido (Propiedades se abre); el panel inferior con su alto por defecto.

**Qué pasa** (medido, con el panel inferior cerrado y los dos paneles abiertos):

| Ventana | Vista |
|---|---|
| 1920 | 60,9 % |
| 1600 | 54,1 % |
| 1366 | 47,5 % |
| 1280 | 44,6 % |
| 1024 | 36,9 % |

- El navegador mide 248 px y Propiedades 300 px a cualquier ancho.
- El panel inferior se queda en ~280 px: a 1280×720, con él abierto, la vista mide 318 px de alto (25 %).
- El criterio de I1 (≥ 70 % y ≥ 60 %) se mide con nada elegido, pero en el uso diario casi siempre hay algo elegido.

**Propuesta:**
- Anchos con `clamp()`: navegador `clamp(200px, 14vw, 260px)` y Propiedades `clamp(260px, 17vw, 320px)`.
- Por debajo de 1440 px, abrir Propiedades pliega el navegador a su carril.
- El alto por defecto del panel inferior, `min(280px, 30vh)`.

**Captura:** `21-modelo-sin-dock-1920.png`, `20-modelo-1280x720.png`, `09-propiedades-forjado.png`.

### D-14 · La leyenda es un párrafo encima del dibujo
**Severidad:** media (densidad; «el dibujo manda»)
**Dónde:** todas las vistas en planta, en los dos temas; `index.css:376` (`.leyenda-vista`, 196 px de ancho).

**Qué pasa:**
- **Medido:** en Modelo la leyenda mide 196 × ~380 px, en 11 px; sólo la entrada «Pilar que llega desde la planta de abajo…» ocupa siete líneas, y debajo van dos notas más.
- **Medido:** a 1024 tapa el 41 % del ancho de la vista; en Diagramas tapa valores (D-03).
- **Opinión:** es documentación, no leyenda.

**Propuesta:**
- Cada entrada, con su muestra y dos o tres palabras («Pilar (b×h, cm)», «Viga (ancho y sección)»).
- La explicación, en el globo del «?» de cada entrada o en Propiedades.
- Plegada por defecto por debajo de 1600 px.

**Captura:** `01-modelo-1920.png`, `20-modelo-1024x768.png`.

### D-15 · Las tablas del panel inferior se reparten en 1920 px
**Severidad:** media
**Dónde:** Resultados · Pilares, Reacciones, Desplomes y Franjas, en el panel inferior a 1920.

**Qué pasa:**
- **Medido:** en «Cuadro bajo CUB-S» las columnas N, |My|, |Mz| y ν están en x ≈ 700, 1100, 1480 y 1900: unos 380 px entre valores de la misma fila, sin cebreado ni resalte al pasar el ratón.
- **Opinión:** se pierde la fila al leer de izquierda a derecha.

**Propuesta:** `.dock .tb { width: auto; min-width: 640px; max-width: 1100px }`, con las columnas numéricas de ~110 px; resalte de la fila al pasar el ratón; cebreado tenue (`bg-surface` en las pares).

**Captura:** `07-Pilares-claro.png`, `07-Reacciones-claro.png`.

### D-16 · Coma y punto decimal mezclados en la misma pantalla
**Severidad:** media (lectura de números)
**Dónde:** Propiedades de Diagramas, panel de Diagnósticos y alzado.

**Qué pasa** (medido en pantalla):
- «0,08» junto a «ELU-PT-7 · 0.8·G + 1.5·Q + 0.75·N» y «1.35·G».
- «su borde se mueve hasta 4.0 cm (C2-b)» en Diagnósticos.
- En el alzado, las cotas de planta salen con un decimal («CUB-S +4,3») y en planta con dos («+4,30»).

**Propuesta:**
- Pasar por `fmt.ts` también la descripción de las combinaciones (en la app, «0,8·G + 1,5·Q + 0,75·N») y los números de los mensajes de diagnóstico, guardando el texto original para la CLI.
- Cotas de nivel siempre con dos decimales.

**Captura:** `06-diagramas-claro.png`, `11-diagnosticos.png`, `22-alzado-claro.png`.

### D-17 · Ids partidos por el guion en las columnas estrechas
**Severidad:** media
**Dónde:** Propiedades · Armado («Caras y apoyos») y Propiedades de planta («Forjado L-CUB-S»), en los dos temas; `index.css:301` (`.tb td small { white-space: normal }`).

**Qué pasa** (medido en las capturas):
- La combinación sale como «ELU-PT-» en una línea y «3» en la siguiente, y otra como «ELU-» y «PT-1».
- En Propiedades se lee «Forjado L-» y debajo «CUB-S».
- Un id roto por el guion se confunde con dos.

**Propuesta:**
- Los ids en `white-space: nowrap` (con `text-overflow: ellipsis` si no caben).
- En la tabla de caras, la combinación en una sola línea bajo la fila, que ocupe todo el ancho, en vez de una por celda.

**Captura:** `29b-franja-oscuro.png`, `20-modelo-1366x768.png`.

### D-18 · Los ejes del origen tiñen el eje de replanteo que pasa por x = 0 o y = 0
**Severidad:** media (parece una selección o un error)
**Dónde:** planta y alzado, en los dos temas; `app/src/vistas/fondo.ts:32` (`ALFA_2D.eje = 0.45`, de borde a borde de la vista).

**Qué pasa:**
- **Medido:** en la vivienda, el eje A sale rojo y el 3, verde; en el muestrario, el eje A sale verde.
- **Medido:** en el alzado, la línea de PB +0 sale roja.
- Las rayas del eje de replanteo dejan ver la línea de color entre trazo y trazo.

**Propuesta:** dejar los ejes del origen sólo en el icono, que ya se dibuja, o recortarlos a un tramo de 1 m desde el origen. Si se quieren a lo largo de toda la vista, alfa 0,15 y sin pintarlos donde coinciden con un eje de replanteo.

**Captura:** `02c-cotas-oscuro.png`, `01-modelo-1920.png`, `22-alzado-claro.png`.

### D-19 · Los gestores no se parecen entre sí
**Severidad:** media (incoherente)
**Dónde:** los diálogos Secciones, Materiales, Casos y Plantas, en los dos temas; `index.css` `.gp-campo select`.

**Qué pasa** (medido en las capturas):

| | Materiales | Secciones | Casos | Plantas |
|---|---|---|---|---|
| Cabecera de la ficha | «HA-30» en 10,5 px y mayúsculas | «P30X30 · RECTANGULAR», en mayúsculas | «DATOS · CASOS», ~14 px con raya encima | — |
| Botón principal | «Aplicar a …» | «Aplicar a …» | «Cerrar» (se aplica al momento) | — |
| Desplegables | personalizados | personalizados | personalizados | nativos (`appearance: auto`, flecha negra de Windows) |
| Elemento de la lista | — | — | la insignia en una línea y el texto en otra | — |

**Propuesta:**
- Una sola plantilla de ficha: el id en 15 px y el tipo en 12 px secundario.
- El mismo modelo de confirmar en todos: «Aplicar» o al momento, pero uno.
- Clase `sel` en los `select` de `.gp-campo`.
- La insignia de los casos en la misma fila que su texto.

**Captura:** `13-gestor-secciones.png`, `14-gestor-materiales.png`, `16-gestor-casos.png`, `15b-plantas-selects.png`.

### D-20 · Foco de teclado: el anillo por defecto del navegador en la barra, los segmentados y las pestañas
**Severidad:** media (teclado; incoherente)
**Dónde:** `.herr`, `.ib`, `.espacios > button`, `.seg > button`, `.dock-tab`, `.ib-chip` y `.lista-fila` (`index.css:559`, `:582` y siguientes); tema claro.

**Qué pasa** (medido): con Tab, el foco de «Ejes» es `outline: auto 1px rgb(16,16,16)`, el anillo negro del navegador. En `.btn` y `.campo` el foco es un anillo de 3 px del acento (`--color-ring`). Son dos lenguajes distintos para lo mismo.

**Propuesta:** `:where(.herr,.ib,.ib-chip,.espacios>button,.seg>button,.dock-tab,.lista-fila):focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }`.

**Captura:** `28-foco-herr.png`.

### D-21 · Áreas de clic por debajo de 24 px en una herramienta de uso diario
**Severidad:** media
**Dónde:** Modelo y gestores; `index.css:723` (`.ib-chip`), `:348` (`.eng-flecha`), `:624` (`.panel-carril-tit`), `:974` (`.campo-q`), `:435` (`.desplegar`) y `:663` (`.dib-pf-sec > button`).

**Qué pasa** (medido):

| Control | Medida |
|---|---|
| Planta de encima y de debajo (`.ib-chip`) | 22 × 24 |
| Flecha de la lista de enganches | 16 × 28 |
| Título del carril de Propiedades | 16 px de ancho, dentro de un carril de 36 |
| «?» de ayuda | 13 px (21 px con `::after`) |
| Flecha de la celda de la hoja | 17 × 17 |
| Puntos fijos del pilar | 13 × 13 |
| Ids de Diagnósticos | 22 px de alto |
| «Qué es cada una» | 17 px de alto |

**Propuesta:**
- `.ib-chip` 26 × 26 y `.eng-flecha` 20 px de ancho.
- El título del carril, a todo el ancho del carril (36 px).
- `.campo-q::after { inset: -6px }` y `.desplegar` 22 × 22.
- Los puntos fijos a 16 px, con `::after` de 24.
- Los ids de Diagnósticos con `.btn` de 26 px.

**Captura:** `01-modelo-1920.png` (cabecera de la vista), `09b-croquis.png`.

### D-22 · Geist Mono en texto corrido
**Severidad:** media (contra §13: «Geist Mono sólo para números y ids»)
**Dónde:** la barra de estado (`index.css:745`, toda en mono) y los desplegables `.sel` (`index.css:269`: `font: 12.5px var(--font-mono)`).

**Qué pasa** (medido):
- La barra de estado pone en mono frases como «sin guardar en ningún sitio (Guardar en mis proyectos, o Exportar)» o «compilado en 2.81 s y calculado en el visor en 1.26 s».
- Salen en mono los desplegables de texto: «Por defecto», «X superior», «G · con peso propio».

**Propuesta:** `.sel` en `var(--font-sans)` y `.sel.mono` sólo donde el valor es un número o un id. La barra de estado en sans, con `<span class="mono">` para las cifras y los hashes.

**Captura:** `05-resultados-claro.png`, `03-cargas-oscuro.png`.

### D-23 · Tema oscuro: los gráficos con colores fijos no se adaptan
**Severidad:** media
**Dónde:** Propiedades · Armado (diagrama de la franja) y leyendas de isovalores en oscuro; `app/src/pantallas/Armado.tsx:134-140`.

**Qué pasa** (medido sobre #0c0c0e):
- Las líneas del diagrama de la franja, #2166ac y #b2182b de 1,2 px, dan 3,31:1 y 2,85:1.
- Los rellenos al 25 % quedan pardos.
- La muestra de la banda más oscura de los mapas (#053061) da 1,49:1 contra el fondo de la leyenda: sin su borde no se distingue.

**Propuesta:**
- Usar los tokens que ya tienen variante oscura: `--color-env-max` (#f87171 en oscuro) y `--color-env-min` (#38bdf8).
- Las muestras de la leyenda con un borde de 1 px en `--color-border-strong`.

**Captura:** `29b-franja-oscuro.png`, `04c-leyenda-oscuro.png`.

---

## Severidad baja

### D-24 · Croquis del forjado con letra de 9–10 px y rótulos encima del dibujo
**Severidad:** baja
**Dónde:** Propiedades de un forjado, en los dos temas.

**Qué pasa** (medido): «intereje 72», «capa 5», «canto 30», «nervio 12» y «nervios 0°» van en mono de 10 px, y X e Y en 9 px. «nervios 0°» va encima de los ábacos y «capa 5» queda pegado al borde derecho.

**Propuesta:** 11 px como mínimo; la flecha de dirección y su rótulo fuera del contorno, o con halo `paint-order: stroke` en el color de la superficie.

**Captura:** `09b-croquis.png`.

### D-25 · La muestra de «Isolínea» lleva el fondo de la banda positiva
**Severidad:** baja
**Dónde:** la leyenda de los mapas (Losas); `app/src/vistas/Zona.tsx:837` (`FONDO_BANDA = "#fddbc7"`).

**Qué pasa:** la muestra de línea va sobre un rectángulo #fddbc7 (melocotón), casi el color de «0 a 0,5» (#f8bca0), así que se lee como otra banda.

**Propuesta:** fondo `--color-bg-surface` en las muestras de línea, o sólo la línea, sin rectángulo.

**Captura:** `05c-leyenda-claro.png`.

### D-26 · El rótulo del paño cae encima de una viga
**Severidad:** baja
**Dónde:** Modelo, planta del muestrario, en los dos temas.

**Qué pasa:** «F1 · viguetas a 70 cm, 90°, pp 3,5 kN/m²» se rotula sobre el eje de V9, entre P6 y P7, y su halo tapa la viga.

**Propuesta:** colocar el rótulo de un forjado en el centro del mayor rectángulo libre del paño, lejos de las barras, o desplazarlo media altura de texto fuera de la barra que pisa.

**Captura:** `31b-muestrario-claro-zoom.png`.

### D-27 · Diagrama de la franja sin escala ni valores
**Severidad:** baja
**Dónde:** Propiedades · Armado, con una franja elegida.

**Qué pasa:** el gráfico tiene curvas y verticales sin ningún número: ni el 0, ni marcas, ni los máximos. Lo explica una nota en prosa debajo («Líneas: mx máximo (rojo)…»).

**Propuesta:** el eje con 0 y dos o tres marcas en kN·m/m, los máximos rotulados como en el alzado de vigas, y una leyenda de dos muestras en lugar del párrafo.

**Captura:** `29b-franja-oscuro.png`.

### D-28 · Diálogos de gestores fijos de 900 × 680 con más de la mitad vacía
**Severidad:** baja
**Dónde:** Materiales y Secciones; `index.css` `.dialogo.gestor { height: min(680px, …) }`.

**Qué pasa** (medido): en Materiales, cinco campos ocupan hasta y ≈ 320 de una ficha de 570 px de alto; en Secciones, el formulario acaba en y ≈ 440 de 680.

**Propuesta:** `height: auto; min-height: 420px; max-height: min(680px, calc(100vh - 64px))`.

**Captura:** `14-gestor-materiales.png`, `13-gestor-secciones.png`.

### D-29 · Inicio: un muro de enlaces azules sobre una página vacía
**Severidad:** baja (opinión)
**Dónde:** «Mis proyectos», en los dos temas.

**Qué pasa:**
- **Medido:** la tarjeta de 720 px ocupa el 55 % superior de la página.
- **Medido:** todos los proyectos y los seis ejemplos van en color de enlace.
- **Medido:** las acciones de cada proyecto son iconos grises sin rótulo.
- **Opinión:** no hay nada visual que ayude a reconocer un proyecto.

**Propuesta:**
- Cada proyecto, en una fila de 40 px: miniatura de la planta (la escena de A4 ya da el SVG), el nombre en `text-primary`, la fecha y el tamaño.
- El azul sólo al pasar el ratón.
- Los ejemplos, como tarjetas pequeñas con miniatura.

**Captura:** `00-inicio.png`, `25-inicio-oscuro.png`.

### D-30 · Los textos de la app nombran software comercial
**Severidad:** baja (texto; regla del usuario: «los textos de la app no nombran CYPECAD ni SAP2000»)
**Dónde:** `app/src/Inicio.tsx:26` («Pórtico de acero de 7 plantas (SAP2000 1-022, A2)») y `app/src/editor/Gestores.tsx:398` («…áreas de cortante de CSI»).

**Propuesta:** «Pórtico de acero de 7 plantas (caso de validación 1-022)» y «…con las áreas de cortante de la sección».

**Captura:** `00-inicio.png`, `13-gestor-secciones.png`.

### D-31 · `.fichas` definida dos veces en el CSS
**Severidad:** baja (mantenimiento)
**Dónde:** `index.css:534` (`gap: 6px`) y `:671` (`gap: 5px; padding: 4px 14px 12px`).

**Qué pasa** (deducido de la cascada, sin verlo en pantalla): con la misma especificidad gana la segunda, así que las fichas de las plantas de destino del diálogo «A plantas» heredan el relleno de 14 px pensado para Propiedades.

**Propuesta:** renombrar una de las dos (`.fichas-plantas` para la del diálogo).

**Captura:** — (en el código).

### D-32 · El fondo de diálogos y paleta lleva un azul marino fijo y no está en los tokens
**Severidad:** baja
**Dónde:** `index.css:502` (`rgb(15 23 42 / .30)`), `:778` (`.paleta-fondo`, `/ .22`) y `:551` (`.aviso-version`, sombra `rgb(0 0 0 / .2)` en lugar de `--shadow-pop`).

**Qué pasa:** en oscuro, el velo tiñe de azul el fondo casi negro y separa poco el diálogo; el aviso de versión no sigue las sombras del tema.

**Propuesta:** `--color-velo: rgb(15 23 42 / .30)` en claro y `rgb(0 0 0 / .55)` en oscuro, y `box-shadow: var(--shadow-pop)` en `.aviso-version`.

**Captura:** `26-versiones-oscuro.png`, `33-secciones-oscuro.png`.

### D-33 · Bordes de los campos a 1,42:1
**Severidad:** baja (WCAG 1.4.11; estilo actual muy extendido)
**Dónde:** `.sel`, `.campo input` y `.gp-campo input` sobre blanco, en el tema claro.

**Qué pasa** (medido): `--color-border-main` #d3d9e1 da 1,42:1 sobre blanco (1.4.11 pide 3:1 para el límite de un control). En Propiedades y en los gestores, el campo sólo se distingue por su borde.

**Propuesta:** para los campos, `--color-border-strong` (1,88:1) y `bg-surface` dentro, o un borde inferior de 1 px en #8e99a8 (2,89:1), sin tocar el resto de las rayas.

**Captura:** `09-propiedades-forjado.png`.

### D-34 · El estado de cada comprobación del informe no tiene color
**Severidad:** baja
**Dónde:** Revisión, tabla «Comprobaciones de sensatez».

**Qué pasa:**
- **Medido:** la columna «Estado» es texto plano: «AVISOS (1)» entre una veintena de «bien».
- **Medido:** el panel derecho sí usa pastillas BIEN y AVISOS.
- **Opinión:** el único aviso cuesta encontrarlo en la página central.

**Propuesta:** las mismas pastillas en la tabla del informe, o al menos `color: var(--color-state-warn); font-weight: 600` en las filas con aviso.

**Captura:** `08-revision-claro.png`.

---

## Lo que funciona bien

- **El tema oscuro está completo:** no queda ningún fondo claro en Modelo, Resultados, Propiedades, gestores ni Versiones (`claros.js` devuelve 0 elementos). La planta invierte bien los neutros (pilares blancos, vigas gris azulado) y el ViewCube también es oscuro.
- **Tokens limpios en el armazón:** sin colores de Tailwind sueltos en los componentes, y el texto principal y secundario muy por encima de AA (17,9:1 y 7,6:1 en claro; 18,7:1 y 7,3:1 en oscuro). El botón primario da 5,17:1 y 6,42:1.
- **Jerarquía de la planta:** las burbujas de los ejes, las cotas de la cadena, el halo de los rótulos sobre el lienzo y la paleta divergente RdBu de los isovalores se leen bien en los dos temas.
- **Escalas con buen criterio:** la escala de colores con los límites rotulados en mono y el resto de la escala de Resultados es clara y coherente.
- **Paleta, panel inferior y desplegables:** la paleta (Ctrl+K) está bien proporcionada (620 px, filas de 34 px, pie con las teclas). Las pestañas del panel inferior, con subrayado e insignias, y los desplegables personalizados (`appearance: base-select`) se ven modernos y coherentes.
- **Gestores:** la columna de propiedades con su dibujo de la sección a escala y el alzado esquemático de Plantas, con lo nuevo en azul, son de lo mejor de la app.
- **Áreas de clic de la barra:** con la excepción de D-21, todo es de 28–30 px como mínimo. A 1024 px los diálogos caben enteros.
