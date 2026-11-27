# Auditoría de la interfaz 2: lectura del código (2026-11-27)

Anejo de `../auditoria-ui-2.md`. Lectura estática de `app/src/` (sin ejecutar la app ni las pruebas), hecha por un agente aparte mientras se recorría la app en el navegador.

- **[V]:** verificado leyendo el código o el CSS.
- **[S]:** sospecha que hay que mirar en el navegador.
- **[N]:** comprobado después en el navegador, en el recorrido.
- Las rutas son relativas a `app/src/`. Los números de línea son los del 2026-11-27 (`5480d1b`).

## Escalas (`index.css` y `editor/gestores.css`)

| Escala | Valores → recuento | Razonable | Se sale |
|---|---|---|---|
| **Tamaño de letra** (con `font:`) | 12→66 · 11→55 · 13→32 · 11,5→6 · 15→5 · 10,5→5 · 10→3 · 9,5→2 · 12,5→2 · 14→1 · 16→1 · 7→1. En TSX: `text-[12px]` 69, `[11px]` 28, `[13px]` 17, `[18px]` 5, `[15px]` 3, `[11.5px]` 3 | 11, 12, 13, 15 y 18 (UI-49) | 11,5, 10,5, 12,5, 10, 9,5, 14 y 16 |
| **Radio** | 8→26 · 6→23 · 4→9 · 10→7 · 50 %→6 · 5→5 · 3→5 · 7→4 · 2→3 · 12→3 · 999→2 · 9, 15 y 1→1 | 4, 6, 8, 12 y píldora | 5, 7, 9, 10 y 15 |
| **Alto de control** | 28→10 · 30→9 · 24→8 · 26→5 · 22→3 · 34→3 · 32→3 · 36→2; en línea, además, 18, 22, 24, 26 y 28 | 24, 28 y 32 | 18, 22, 26, 30 y 34 |
| **Relleno (`padding`)** | 97 valores distintos (67 de un solo uso) | pasos de 2, 4, 6, 8, 12 y 16 | casi todo |
| **Separación (`gap`)** | 6→24 · 8→21 · 2→14 · 10→11 · 5→8 · 4→8 · 7→4 · 3→4 · 12→3 · 9, 14, 16, 18 y 28→1 | 2, 4, 6, 8, 12 y 16 | 3, 5, 7, 9, 10, 14, 18 y 28 |
| **Sombra** | tokens: pop 9, sm 3, diálogo 3, xs 3; anillo de 3 px ×10; `rgb(16 24 40/…)` suelto ×3; `rgb(0 0 0/.35)` ×1 | sólo tokens | líneas 294, 670, 696 y 861 |
| **`z-index`** | 1, 2, 3, 5, 6, 14, 15, 16, 20, 30, 44, 45, 50, 60 (×2) y 70 | 6 capas con nombre | 15 valores sin token |
| **Transición** | `.12s` en 12 reglas (7 combinaciones de propiedades) · `.15s` ×3 · `0.15s linear` ×1 | un token | falta en media app (E-13) |
| **Opacidad de lo deshabilitado** | .45 ×4 · .4 ×4 · .5 ×3 · .35 ×1 | una | cuatro |
| **Espaciado de los rótulos en mayúsculas** | .07em ×6 · .04em ×5 | uno | dos |

## 1. Controles nativos o sin trabajar

**E-1 · alta · [V] El `title=` es el único tooltip de la app.**
- Hay 260 en 41 ficheros: `espacios/Modelo.tsx` 44, `App.tsx` 31, `vistas/Zona.tsx` 19, `armazon/Disposicion.tsx` 19, `pantallas/Comprobacion.tsx` 17.
- 24 pasan de 110 caracteres y hacen de manual: `Modelo.tsx:454–516` (15; el de `:498`, 234 caracteres), `Zona.tsx:388, 391`.
- Por debajo de 1500 px la barra superior va sólo con iconos (`index.css:636–639`), así que el `title` es su única etiqueta: tarda cerca de 1 s, sale en la letra del sistema, sin tema, y no aparece con el foco.
- El único tooltip propio es `componentes/Ayuda.tsx`, que sólo se usa en los «?» (27 usos).
- **Propuesta:** un componente `Pista` (el globo y el posicionado de `Ayuda.tsx:31–39`) con nombre y atajo en `kbd`; lo largo, a Propiedades.

**E-2 · media · [V] Casillas y radios nativos sin el acento en 20 sitios.**
- Sólo `.chk`, `.opcion` y `.ficha` ponen `accent-color` (`index.css:310, 574, 586`).
- Sin él, con etiquetas de Tailwind hechas a mano (`gap-1`, `gap-1.5`, `gap-2`, `mt-[3px]`, `mt-0.5`): `dibujo/Enganches.tsx:75, 89`; `editor/DatosObra.tsx:255, 277, 289`; `editor/DespiecePortico.tsx:296, 300`; `editor/Dialogos.tsx:391`; `editor/FichaAcciones.tsx:319, 337, 359, 518, 621`; `editor/GestorCasos.tsx:187`; `Comprobacion.tsx:717, 1420`; `plantilla/NavPlantillas.tsx:187, 296`; `Zona.tsx:634, 645`.
- **Propuesta:** la regla global `input[type=checkbox], input[type=radio] { accent-color }` y un componente `Casilla`.

**E-3 · media · [V]/[S] 56 `<select>`; la lista con estilo sólo existe en Chrome y Edge ≥ 135.**
- Va dentro de `@supports (appearance: base-select)` (`index.css:949`); en Firefox o Safari sale la del sistema [S].
- Fuera del patrón: `editor/FichaForjado.tsx:105` (clases de Tailwind sueltas, sin `.sel`) y `Comprobacion.tsx:217` (24 × 62 en línea).
- **Propuesta:** `.sel` en los dos, y decidir si importan los navegadores sin `base-select`.

**E-4 · baja · [V] Cinco `<details>` con tres aspectos, más dos chevrones.**
- Marcador nativo: `Inicio.tsx:425, 435`, `editor/Gestores.tsx:640`.
- «▸» que gira: `editor/Formulario.tsx:173` (`index.css:1158`).
- «▸ »/«▾ » por `content`: `componentes/comunes.tsx:312` (`index.css:1163–1164`).
- Chevrón `.giro` (`index.css:429, 912`) y otro con `transform` en línea (`Modelo.tsx:960`).
- **Propuesta:** un `Plegable` con el chevrón `.giro`.

**E-5 · baja · [V] Restos sueltos.**
- `type="number"` con las flechas nativas sólo en `pantallas/Modal.tsx:83` y `pantallas/Desplomes.tsx:114`; el resto usa texto con `inputMode`.
- `type="range"` nativo en `pantallas/Vigas.tsx:311`.
- Glifos de texto como iconos: «‹ ›» (`Modal.tsx:66, 76`), «×» (`Comprobacion.tsx:255`), «●» (`App.tsx:469`), «→» (`App.tsx:617`).

## 2. Estilos en línea

**E-6 · media · [V] 100 `style={{}}` en 31 ficheros; lo malo es que redefinen componentes genéricos.**
- Recuento: `Comprobacion.tsx` 21, `CargasPieza.tsx` 8; `comunes.tsx`, `Modal.tsx`, `Armado.tsx`, `GraficaEnvolvente.tsx` y `FichaPilar.tsx`, 5 cada uno.
- `.btn` a 22 px y 11 px a mano, cuando `.btn-sm` es eso mismo (`index.css:280`) y sólo se usa en `App.tsx:644`: `comunes.tsx:247`, `pantallas/CargasPieza.tsx:116, 345`.
- `.btn` a 18 o 24 (`componentes/AvanceTareas.tsx:75`), a 24 (`Comprobacion.tsx:1277–1286`), a 26 (`Comprobacion.tsx:678, 681, 684, 813`).
- `.ib` a 24, 26 o 28: `Disposicion.tsx:313, 457, 476`; `Dialogos.tsx:103`; `CargasPieza.tsx:80, 83`; `pantallas/Inspector.tsx:91`.
- `.pill` deformada: `comunes.tsx:220, 265`.
- `height: 28` sobre lo que ya mide 28: `Modal.tsx:65–89`, `Desplomes.tsx:116, 120`, `Comprobacion.tsx:1252, 1261`.
- `textAlign: "left"` en 13 celdas: `comunes.tsx:150, 157`; `CargasPieza.tsx:94, 120, 269, 277`; `Comprobacion.tsx:494–496`; `Modelo.tsx:1054, 1062`; `GestorCasos.tsx:242`; `Inspector.tsx:109`.
- **Propuesta:** `.btn-xs/.btn-sm`, `.ib-sm/.ib-md` y `.tb .izq`.

## 3. Colores fijos

**E-7 · alta · [V] Clases y variables de tokens que no existen.**
- `text-state-bad` (`FichaAcciones.tsx:720`, `Modal.tsx:334`): los errores del segundo orden salen sin rojo.
- `text-state-pass` (`FichaAcciones.tsx:510`) y `bg-accent-subtle` (`pantallas/Armado.tsx:391`): la celda activa de la armadura base no se resalta.
- En el CSS: `var(--color-bg-sub, rgba(127,127,127,.08))` (`index.css:1451`), `--color-bg-main` (`:1563`) y `--color-bg-hover, rgba(0,0,0,.06)` (`:1565`: en oscuro el hover no se ve).
- Contrastado con el `@theme` (`index.css:95–153`): ninguno está definido. Los estados que existen son `ok`, `warn`, `fail` y `neutral`.
- **Propuesta:** `text-state-fail`, `text-state-ok`, `bg-tint-accent`, `--color-bg-elevated`, y una prueba que cruce las clases con los tokens.

**E-8 · media · [V] Hex fuera de tokens y sin variante oscura en el CSS.**
- `.barra-aprov`: #16a34a, #d97706 y #dc2626 (`index.css:1418–1420`), cuando existen `--color-state-*`.
- Caras del armado: #2563eb, #dc2626 y #0f766e (`:1433–1435`), cuando `--ca-inferior` y `--ca-superior` ya tienen oscuro (`:1242–1243`).
- Cortante #0d9488 ×4 (`:1342, 1362, 1365, 1369`); `#fff` (`:868`); sombras `rgb(16 24 40…)` (`:294, 670, 696`).
- `bg-white` en las figuras del informe (`pantallas/Revision.tsx:39, 53`).
- En los `.tsx` no hay hex; sólo en el lienzo (`lienzo/pintura.ts`, `vistas/vista3d.ts`).

## 4. Escalas

**E-9 · alta · [V] UI-49 («cinco tamaños») se dio por hecha y hay otra vez doce.**
- 11,5: `index.css:1449, 1452, 1485`; `gestores.css:18, 51, 63`; `Comprobacion.tsx:214, 1276`.
- 10,5: `gestores.css:30, 39, 41, 58`; `index.css:1349`.
- 12,5: `index.css:1464`; `gestores.css:49`. 10: `:1067, 1297, 1366`. 9,5: `:1310, 1317`. 14: `:1508`. 16: `gestores.css:25`.
- Todo es de Comprobación y de los gestores, posterior a UI-49.
- **Propuesta:** tokens `--texto-11…18` y una prueba que rechace otros valores.

**E-10 · media · [V] Radios distintos en lo que flota.**
- 8: `.menu-flotante` (`:650`), `.globo-ayuda` (`:1181`), avisos (`:598, 606`).
- 10: `.eng-menu` (`:389`), `.opciones-vista` (`:406`), leyenda (`:415`), `::picker` (`:967`), `.confirma` (`:1505`).
- 12: diálogo y paleta. Segmentados, 7 y 5.

**E-11 · media · [V] El mismo campo, con tres altos y dos letras.**
- `.sel`: 28 px, 13 mono (`:300–303`). `.campo input`: 28 px, 12 mono (`:500–502`). `.gp-campo`: 30 px, 13 (`:1100–1102`). Teclado: 26 (`:756`). Armado: 24 en línea (`Comprobacion.tsx:217, 226`).

**E-12 · baja · [V]** `z-index` sin capas con nombre; `.menu-flotante` y `.paleta-fondo` comparten el 60 (`:649, 926`).

**E-13 · media · [V] Estados desiguales entre controles iguales.**
- **Foco, tres recetas:** anillo de 3 px (`:264, 307, 506`), `outline` de 2 px (`:345, 629, 838, 909`), sombra de 2 px (`:1523`).
- **Foco, ninguna (el anillo del navegador):** `.seg > button` (`:285–297`), `.chip.seg-chip > button` (`:827`), `.ib-chip` (`:847`), `.lista-fila` (`:242`), `.opcion`, `.ficha`, `.ges-tipo` (`:1019`), `.leyenda-cab` (`:420`), `.enlace` (`:1493`), `.pestanas-lista` y `.filtro-lista` (`:1442–1447`).
- UI-56 dio por hechos «los segmentados», pero la regla de `:1523` sólo cubre `.herr-seg`.
- **Transición:** la tienen `.btn`, `.seg` y `.dock-tab`; no `.ib` (`:612`), `.herr` (`:678`), `.arbol-fila` (`:901`), `.menu-flotante > button` (`:653`), `.espacios` (`:665`) ni `.herr-seg` (`:692`).

## 5. El mismo componente, varias veces

**E-14 · alta · [V] Ocho segmentados.**
- `.seg` (`:285`): 24 px, sin serifa, lo elegido en relieve blanco.
- `.herr-seg` (`:690–697`, `Disposicion.tsx:101`): igual, pero en mono y lo elegido en azul.
- `.chip.seg-chip` (`:826–832`): 13 px, lo elegido con tinte.
- `.espacios` (`:664`): 28 px. `.gp-seg` (`:1113`): 26 px.
- `.fichas` y `.dib-gdl` (`:789`): píldoras. `.filtro-lista` (`:1445`). `.pestanas-lista` (`:1441`).
- **Propuesta:** un `Segmentado` con tamaño.

**E-15 · alta · [V] Cinco formas de pestaña.**
- `.dock-tab` con `Grupo` (`Disposicion.tsx:456`).
- La misma clase sin `Grupo`, sin flechas (`FichaAcciones.tsx:309–315`).
- `.seg` como `tablist` (`GestorPlantas.tsx:220`; `editor/Hoja.tsx:743`: 13 tablas en un segmentado con `overflowX` en línea).
- `.pestanas-lista` en mayúsculas, sin teclado (`Comprobacion.tsx:309`).
- Botones de herramienta haciendo de pestañas (`Comprobacion.tsx:1229–1243`).

**E-16 · media · [V] Seis disposiciones de campo y tres maneras de poner la unidad.**
- Disposiciones: `.campo` (`:495`, etiqueta de 96 px), `.acc-form` (`:1569`), `.gp-campo` (`:1094`, etiqueta encima), `.herr-campo` (`:688`), rejillas de Tailwind (`Dialogos.tsx:502`; `FichaAcciones.tsx:326, 344`), en línea (`Comprobacion.tsx:210–228`).
- Unidad: sufijo en el campo (`:766`), «(m)» en la etiqueta (`Dialogos.tsx:514, 516`; `Modal.tsx:81`), `.gp-unidad` (`:1110`).
- **Propuesta:** un `Campo` y un `CampoNumero` (C-35 de la auditoría anterior quedó a medias).

**E-17 · media · [V] Diez títulos de sección.** `.sec` (`:223`), `.campo-grupo` (`:1152`), `.dlg-et` (`:562`), `.acc-titulo` (`:1582`), `.acc-grupo legend` (`:1568`), `.gp-sec h3` (`:1092`), `.banco-armado h4` (`:1396`), `.titulo-lista` (`:1444`), `.eng-cab` (`:392`), `.ayuda-panel h4` (`gestores.css:30`): con y sin mayúsculas, a 10,5, 11 y 12 px.

**E-18 · media · [V] Insignias y teclas.**
- Insignias: `.pill` (`:312`), `.insignia` (`:888`), Tailwind suelto (`Inicio.tsx:296, 405`), `.acc-letra` (`gestores.css:15`), `.ayuda-pide span` (`gestores.css:45`), `.gp-nuevas li` (`:1116`).
- Teclas, cinco: `.kbd` (`:352`), `.dib-tecla` (`:762`), `.paleta .atajo` (`:939`), `.paleta-pie kbd` (`:942`), `.campo-formas dt` (`:812`).
- Estados en mayúsculas y mono («CALCULADO», «SÓLO LECTURA»): `App.tsx:115–129, 488`.

**E-19 · media · [V] Nueve avisos y cuatro confirmaciones.**
- Avisos: `.banda` (`:589`), `.aviso-version` (`:596`), `.aviso-calculado` (`:603`), `Aviso` (una `.pill` deformada, `comunes.tsx:265`), `.ges-aviso/.ges-error` (`:1016–1017`), `.aviso-proponer` (`:1451`), `.dib-hecho` (`:760`), `.ayuda-sin` (`gestores.css:34`), Tailwind suelto (`Inicio.tsx:281`; `Dialogos.tsx:522, 534`; `FichaAcciones.tsx:296`).
- Confirmaciones: `.confirma` (`Dialogos.tsx:126`), `.ges-pregunta` (`Gestores.tsx:660`), la fila roja (`Inicio.tsx:321–333`), la banda en dos pasos (`App.tsx:572–585`).

**E-20 · media · [V] La espera se dice de cinco maneras.**
- Barra: `.avance-barra` (`:1459`). Texto en píldora para el cálculo, sin barra: `App.tsx:121`.
- Rueda de espera sólo en `Inicio.tsx:287`.
- `Aviso` en el lienzo: aquí sí es coherente entre pantallas.
- `<p class="nota">` en el panel inferior: `Comprobacion.tsx:1352, 1437, 1464`; `Armado.tsx:800`. Texto suelto: `Revision.tsx:149`.
- **Propuesta:** un `Cargando`, y la `.avance-barra` también para calcular.

**E-21 · media · [V] Estados vacíos: más de 20 párrafos `.nota`, cada uno con su fórmula.**
- «Nada aún:», «Ninguna:», «Sin…», «Un clic… elige»: `dibujo/Plantilla.tsx:507`, `armazon/VistasGuardadas.tsx:34`, `NavPlantillas.tsx:53`, `Modelo.tsx:1030`, `Vigas.tsx:316`, `Gestores.tsx:679`, `armazon/Situacion.tsx:151`.
- El único diseñado (icono, título y acción) es `Inicio.tsx:309–315`. `componentes/Proceso.tsx:38` tiene 60 palabras.
- **Propuesta:** `Vacio({ icono, titulo, accion })`.

**E-22 · baja · [V] Filas elegibles, cinco.** `.lista-fila` (`:242`, con rejilla en línea en `Vigas.tsx:259`, `Losas.tsx:400`, `Inicio.tsx:448`), `.arbol-fila` (`:901`), `.ges-lista` (`:1004`), `.paleta li` (`:935`), `.lista-candidatos` (`:1564`); altos de 30, 28, 26 y 34. `.tb tr.clic` existe, pero se usa `cursor` en línea (`Comprobacion.tsx:1394`, `Modal.tsx:146`).

## 6. Comportamiento

**E-24 · alta · [V] y [N] En las tablas del panel inferior la fila elegida no se resalta.**
- El cebreado `.dock-cuerpo .tb tbody tr:nth-child(even) td` (`:1544`; especificidad 0,3,3) y el hover `.tb tbody tr:hover td` (`:1545`; 0,2,3) ganan a `.tb tr[data-on="true"] td`, `tr.max` y `tr.grupo` (`:340–341`; 0,2,2), a `.elemento-armado[data-on]` (`:1487`) y a `.despiece-tabla tr[data-on]` (`:1325`).
- Efecto: las filas pares elegidas (`Comprobacion.tsx:1393`) se ven cebreadas, cualquier fila pierde el tinte al pasar el ratón, y el hover sale también en tablas que no se eligen.
- **En el navegador:** con la segunda fila de Comprobación · Pilares elegida, su celda tiene el fondo del cebreado y no el tinte.
- **Propuesta:** `.tb tbody tr[data-on="true"] td` después del cebreado, y el hover sólo en `.clic`.

**E-25 · media · [V] y [N] `.tb th` no es fija** (`:323`; sólo `.hoja th`, `:443`): las tablas largas pierden la cabecera al desplazar. En el navegador, con la tabla de pilares desplazada 400 px, la cabecera queda 330 px por encima de la caja. **Propuesta:** `position: sticky; top: 0` con fondo.

**E-26 · media · [V]/[S] Menús y listas sin teclado.**
- `MenuFlotante` (`Disposicion.tsx:35–68`) lleva `role="menu"`, pero sin flechas y sin llevar el foco dentro; `componentes/desplegado.ts:18–27` sólo atiende Esc y el clic fuera.
- Se coloca con `min(r.left, innerWidth − 240)` (`:44`): da por hecho 240 px y no limita en vertical. **[N]:** el menú «Vistas» mide 260 px y a 1920 px se sale 20 px por la derecha.
- El buscador de municipios (`editor/Emplazamiento.tsx:166–177`) no tiene flechas y lleva `aria-selected={false}` fijo; la paleta sí las tiene (`armazon/Paleta.tsx:75–88`).

**E-27 · media · [S] Paneles flotantes recortados por su celda.** `.opciones-vista` (`:404–408`) y `.eng-menu` (`:387–391`) van en `absolute`, sin `max-height`, dentro de `.celda { overflow: hidden }` (`:365`). Miden unos 390 px; en 2×2 o 1/1 a 1366×768 la celda tiene unos 300. **Propuesta:** un portal con posición fija y límites, como `Ayuda.tsx`.

**E-28 · media · [V] y [N] Propiedades cambia de ancho con el modo, y la vista salta.** 300 (`Disposicion.tsx:291`), 320 (`Desplomes.tsx:256`), 330 (`Comprobacion.tsx:1580`), 340 (`Losas.tsx:466`, `Modal.tsx:355`), 360 (`Armado.tsx:822`), 380 (`Reacciones.tsx:365`), 400 (`Pilares.tsx:261`, `Vigas.tsx:385`). **Propuesta:** dos anchos, o uno que el usuario ajuste y se recuerde.

**E-29 · media · [V] Textos cortados con «…» sin `title`.**
- Etiquetas de campo en 96 px: `.campo-nombre` (`:495, 1166`; `Formulario.tsx:131`). **[N]:** se cortan «ábacos en pilares» y «punto de paso».
- El título de Propiedades (`comunes.tsx:43`); nombres de proyecto (`Inicio.tsx:349`), de versión (`armazon/Versiones.tsx:116`) y de vista (`VistasGuardadas.tsx:43`, `Zona.tsx:582`); `.ges-texto` (`Gestores.tsx:686`).

**E-30 · media · [V] `.btn` no tiene estado pulsado.** `Modal.tsx:89` y `Desplomes.tsx:120` pasan `data-on` y `aria-pressed`, y no hay regla. `.ib[data-on]` sólo existe dentro de `.vista-barra` y `.eng-barra` (`:377, 382`). **Propuesta:** `[aria-pressed="true"]` común.

**E-31 · baja · [V]** `.dock-tabs` y `.herramientas` desbordan con `scrollbar-width: none` (`:875, 676`), sin pista de que hay más.

## 7. Textos

**E-32 · media · [V] Tratamiento.** Todo va de usted (unas 160 formas) salvo `Zona.tsx:452`: «Dibuja uno… o propónlos». Los `title` mezclan el infinitivo (`Disposicion.tsx:457`), la tercera persona («Guarda en el proyecto…», `Comprobacion.tsx:678`; «Deja de proponer…», `AvanceTareas.tsx:75`) y la forma nominal. **Propuesta:** nombre y atajo, en infinitivo.

**E-33 · media · [V] UI-43 a medias: mensajes del motor sin pasar por `textoApp()`.** `Losas.tsx:74, 82`; `Vigas.tsx:58, 83`; `Pilares.tsx:53, 75`; `Reacciones.tsx:141, 177`; `Armado.tsx:88, 97, 675`; `Zona.tsx:821`; `App.tsx:124, 639`. `Comprobacion.tsx:1348` sí lo pasa.

**E-34 · baja · [V] Mayúsculas.**
- Botones y opciones en minúscula: «auto» (`Modal.tsx:86`, `Desplomes.tsx:117`), «encima» (`FichaPilar.tsx:150`), «en los nervios» (`Comprobacion.tsx:1262`), «sólo…» (`Hoja.tsx:752`).
- Etiquetas en minúscula en Propiedades (`Plantilla.tsx:905, 929, 954`) y con mayúscula en los diálogos (`Dialogos.tsx:503`, `DatosObra.tsx:203`).
- Dos puntos finales, sólo en `Comprobacion.tsx:1276`.

**E-35 · baja · [V] Un concepto, dos nombres.**
- Caso e hipótesis: `FichaAcciones.tsx:691, 697`; `Modal.tsx:318, 340`.
- «Hipótesis de partida» (`Comprobacion.tsx:764, 831`) frente a «Supuestos del cálculo».
- Diagnósticos (`Modelo.tsx:617`) frente a Avisos (`Comprobacion.tsx:1592`).
- «Navegador», que en Resultados sólo contiene Situación (`Losas.tsx:465` y los demás modos).
- Miles sin separador en el pie (`App.tsx:690`).

## Comprobado y bien [V]

- No hay `window.confirm`, `alert` ni `prompt`.
- «…» siempre, nunca «...».
- Barras de desplazamiento con estilo global (`index.css:82–87`).
- Todos los diálogos se limitan a la ventana (`:552, 993–997, 1328, 1562`): caben en 1366×768.
- `Dialogo` atrapa y devuelve el foco, y sus pies son coherentes (Cancelar, Aplicar, Crear).
