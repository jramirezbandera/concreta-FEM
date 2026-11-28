# Coherencia entre las vistas: planta, alzado y 3D

Revisión pedida por el usuario el 2026-11-28, tras la prueba de uso: «hemos ido desarrollando cosas y no pensando bien en la coherencia entre las diferentes formas de vista». Dos ejemplos suyos: en Comprobación, la pestaña Pilares sólo deja elegir pilares en la planta y en el 3D, pero no en el alzado; y la deformada no se ve en alzado, que es donde mejor se leen los desplomes.

Leído en el código (`app/src/vistas/Zona.tsx` y el bloque `fuentes` de cada espacio y modo). Sin cambios todavía.

## 1. Por qué pasa

Cada espacio o modo le da a `ZonaVistas` lo que quiere dibujar en cada tipo de vista (`FuentesVistas`, `Zona.tsx:99`): `planta`, `alzado`, `tresD` y sus cabeceras. **Lo que un modo no da cae, sin decirlo, en el modelo** (`Zona.tsx:287`). No hay un contrato: nada obliga a un modo a pensar los tres tipos, y las opciones que no son de dibujo (qué se elige, qué valor da el cursor) van dentro de cada fuente, así que el modo que se olvida de una vista se olvida también de ellas.

El caso de Comprobación es exactamente eso: la planta y el 3D llevan `elegibles={ELEGIBLES[tipo]}` (`pantallas/Comprobacion.tsx:1567`–`1569`), el modo no da `alzado` y el alzado por defecto es `FuenteEscena` del modelo sin `elegibles`. La sesión ya sabe filtrar lo elegido en cualquier escena, también en un alzado (`src/visor/sesion.ts:886`): sólo falta pasárselo.

## 2. Qué da cada modo a cada vista

«modelo» = cae en el dibujo del modelo, sin resultado. «aviso» = cae en el modelo con el chip «Este modo no se dibuja en alzado» (`Zona.tsx:344`).

| Espacio · modo | Planta | Alzado | 3D |
|---|---|---|---|
| Modelo | modelo, diagnósticos o malla; edita con todas las herramientas | modelo; **sólo dibuja con Barra** | modelo; no edita |
| Cargas | cargas del caso; edita | cargas del caso (con escala) | cargas del caso (con escala), elegibles |
| Resultados · Losas | mapa, clic con su valor | **aviso** (los mapas de los muros no se ven en su alzado) | mapa de losas, muros o todo, sonda |
| Resultados · Armado | mapa, clic con su valor | aviso (correcto: son franjas de losa) | mapa, sonda |
| Resultados · Diagramas | diagramas abatidos | M y V en el plano | diagramas, sonda |
| Resultados · Pilares | N de los tramos | **aviso** (N/ν por tramo sería lo natural en alzado) | N o ν, sonda |
| Resultados · Reacciones | flechas | flechas | flechas, sonda |
| Resultados · Deformada | **modelo, sin aviso** | **aviso** | deformada animada |
| Resultados · Modal | **modelo, sin aviso** | **aviso** | forma del modo animada |
| Comprobación · pilares, vigas | aprovechamiento o armado, elegibles | **modelo, sin aviso y se elige todo** | modelo, elegibles |
| Comprobación · losas | armado o aprovechamiento, elegibles | **modelo, sin aviso y se elige todo** | con «Armado», sus refuerzos; con «Aprovechamiento», **el modelo y se elige todo** |
| Comprobación · punzonamiento | perímetros, elegibles | **modelo, sin aviso y se elige todo** | perímetros |

Los modos que ya cumplen en los tres tipos son Cargas, Diagramas y Reacciones: son el patrón a seguir.

## 3. Qué hace cada herramienta en cada vista

| Función | Planta | Alzado | 3D |
|---|---|---|---|
| Elegir y ventana | sí | sí | sí |
| Filtrar lo elegible por pestaña | sólo si la fuente lo pasa | sólo si la fuente lo pasa (nadie lo hace) | sólo si la fuente lo pasa |
| Valor bajo el cursor (sonda) | no; clic en Losas y Armado | no | sí, en los modos de Resultados |
| Medir | sí | sí | no (decidido así) |
| Aislar, ocultar, mostrar (H, Ctrl+H, Mayús+H) | no | no | sí |
| Filtros (plantas, tipos) y caja de sección | no | profundidad ± | sí |
| Modo de dibujo | «Qué se dibuja» (modelo, diagnósticos, malla), sólo en Modelo | sólido, alámbrico, analítico | sólido, translúcido, alámbrico, analítico |
| Sólido en Resultados | — | se puede elegir | deshabilitado («taparía los resultados») |
| Malla encima del resultado | sí (interruptor) | no (sí con «Analítico», para los muros) | no (sí con «Analítico») |
| Ejes de replanteo | interruptor | interruptor | no |
| Dibujar y editar | todas las herramientas | sólo Barra; con otra herramienta activa, se elige sin decir nada | ninguna |
| Vistas guardadas | sí | sí | sí |

## 4. Los huecos

Por orden de lo que molesta en el uso.

- **CV-1 (fallo, el del usuario).** Comprobación: en el alzado se elige cualquier cosa, sea cual sea la pestaña; en el 3D de Losas con «Aprovechamiento», igual. Además el alzado no dibuja nada de la comprobación y no lo dice.
- **CV-2.** La deformada (Resultados · Deformada) y la forma de los modos (Modal) sólo existen en el 3D. En el alzado es donde se ven los desplomes de un pórtico, con su escala y sus cotas por planta; en la planta, el movimiento del diafragma (ux, uy y el giro). Hoy la planta enseña el modelo sin avisar.
- **CV-3.** La regla de «este modo no se dibuja aquí» sólo existe para el alzado, y sólo si el modo tiene cabecera de Resultados. La planta y el 3D caen en el modelo en silencio (Deformada y Modal en planta; Comprobación en alzado).
- **CV-4.** Comprobación en alzado: lo natural es el pórtico (las vigas del plano del color de su aprovechamiento o con su armado, y los pilares con el suyo), lo mismo que ya se dibuja en la planta y en el despiece del pórtico. Va con el color por aprovechamiento del 3D, que está pendiente desde CO6-d.
- **CV-5.** Pilares en alzado: N o ν de cada tramo, como en el 3D. Losas en alzado: el mapa de los muros del plano (F11…, M11…), que hoy sólo se ve en el 3D.
- **CV-6.** El valor bajo el cursor es del 3D. En la planta, Losas y Armado dan el valor con un clic; Diagramas, Pilares y Reacciones, nada; en el alzado, nada. Una regla común: pasar da el valor, el clic lo fija.
- **CV-7.** Dibujar en el alzado: sólo Barra. Con Pilar, Viga o Mover activos el alzado elige sin decir que esa herramienta es de la planta.
- **CV-8.** Aislar y ocultar (H) sólo en el 3D. En una planta o un alzado cargados, ocultar algo para ver lo de detrás también sirve.
- **CV-9 (detalle, descartado al hacer VC1).** El sólido se deshabilita en el 3D de Resultados pero se puede elegir en su alzado; la planta llama «Malla» a lo que el alzado y el 3D llaman «Analítico». No es una incoherencia: en el alzado los diagramas, las reacciones y las cargas se pintan encima del sólido (no los tapa, como en el 3D), y la «Malla» de la planta es la malla de verdad, no el modelo analítico con sus barras y enlaces.

Lo que está bien y se queda: medir sólo en las vistas planas, la caja de sección sólo en el 3D, Armado sin alzado (con su aviso).

## 5. Propuesta

**Un contrato en `ZonaVistas`, no un arreglo por modo.** Lo que hoy va dentro de cada fuente pasa a ser del modo y lo aplica la zona a los tres tipos, también a lo que cae por defecto:

- `elegibles` en `FuentesVistas`: la zona los pasa a la planta, al alzado y al 3D, sean del modo o los de por defecto. Así un modo no puede olvidarse de una vista (CV-1).
- Cada modo declara qué dibuja en cada tipo, y lo que no dibuja lleva el aviso en cualquiera de los tres, con un botón a la vista que sí lo tiene (CV-3).
- Una herramienta de dibujo que no va en ese tipo de vista lo dice en su cabecera (CV-7).
- Una prueba de DOM que monta cada modo con los tres tipos de vista y comprueba que cada uno dibuja lo suyo o avisa, y que lo elegible es el mismo en los tres.

**Tramos**, cada uno con su prueba y sin tocar el cálculo:

1. **VC1, el contrato** (CV-1, CV-3, CV-7). Pequeño; arregla lo del usuario. **Hecho el 2026-11-28** (§6).
2. **VC2, la deformada en el alzado y en la planta** (CV-2; **hecho el 2026-11-28**, §7): la deformada del analítico en el plano del pórtico, con su escala y los desplomes de cada planta rotulados (los de `fem consultar desplomes`), y en la planta el diafragma desplazado; lo mismo para los modos en Modal. Con el sismo del programa, como en el 3D: sin deformada de la combinación (VS-o).
3. **VC3, Comprobación en el alzado y el color en el 3D** (CV-4; **hecho el 2026-11-28**, §8).
4. **VC4, Pilares y muros en el alzado** (CV-5; **hecho el 2026-11-28**, §9).
5. **VC5, el valor bajo el cursor en las vistas planas** (CV-6; **hecho el 2026-11-28**, §10).
6. **VC6, aislar y ocultar en planta y alzado** (CV-8), si después de lo demás sigue haciendo falta.

## 6. VC1 hecho (2026-11-28)

- **`FuentesVistas.elegibles`** (`app/src/vistas/Zona.tsx`): la celda los pone en su contexto y `FuenteEscena` y `Fuente3D` los toman si no traen otros, así que valen en la planta, el alzado y el 3D, también en lo que cae en el modelo por defecto. Comprobación los da en su `fuentes` (sin pestaña, pilar, viga y losa; con ella, los suyos): en el alzado de la pestaña Pilares, un clic en una viga ya no elige nada y uno en un pilar elige su tramo (comprobado en la app con la vivienda).
- **`FuentesVistas.dibuja`** («La deformada», «El mapa», «La comprobación»…): un tipo de vista para el que el modo no da fuente lleva el chip «… no se dibuja en planta | alzado | 3D» con el botón «Ver en …» a la vista que sí (el 3D si lo tiene, si no la planta; `tipoQueDibuja`). Sustituye al chip de R-30, que sólo había en el alzado. Lo declaran Losas, Armado, Diagramas, Pilares, Reacciones, Deformada, Modal, Comprobación y Cargas (con un caso activo); Modelo no, porque allí el modelo es lo que se dibuja.
- **Comprobación, el 3D de pilares y vigas:** era el modelo con sus elegibles, para poder elegir; con los elegibles en la celda sobra, y ahora el 3D dice que la comprobación no se dibuja en él y lleva a la planta (el color por aprovechamiento en el 3D va con VC3). Mientras se propone el armado, el modelo, como antes.
- **`FuentesVistas.herramientaFuera`:** en Modelo y Cargas, con una herramienta de dibujo activa, el alzado y el 3D lo dicen («Esta herramienta dibuja en planta; aquí, un clic elige»; con Barra, sólo el 3D: «Barra dibuja en planta y en alzado…»).
- **Prueba:** `app/src/test/coherenciaVistas.test.tsx` (los avisos en los tipos sin fuente y el botón que cambia la vista, ninguno en un modo sin `dibuja`, la herramienta fuera sólo donde no va) y `comprobacion.test.tsx` sin cambios. Comprobado en la app: Deformada en 2 × 2, Comprobación · Pilares en alzado y en 3D, y Modelo con Pilar y con Barra.
- **No probado:** que en el 3D de Comprobación · Pilares un clic en una viga no la elija (va por el mismo contexto que el alzado, comprobado); los bancos de Chrome.

## 7. VC2 hecho (2026-11-28)

- **El worker** (`src/agente/render/deformada.ts`, puro): `vistaAlzadoDeformada` y `vistaPlantaDeformada`, como la deformada del 3D: los nudos del modelo analítico desplazados u·escala, cada barra de nudo a nudo (sin su curvatura ni el giro de las zonas rígidas), sobre el modelo sin deformar en gris.
  - **Alzado:** las barras y los muros del plano y el corte deformado de las losas que lo cruzan (la flecha a lo largo del eje). Con una combinación, cada pilar del plano rotula en cada planta su desplazamiento en el plano δ (mm; no en sus apoyos) y en cada tramo su desplome relativo d/h, el de `Consultas.desplomes` (con las dos componentes: el de la tabla). Lo normal al plano no se ve, y lo dice una nota.
  - **Planta:** las barras de la planta, el borde de sus losas (los lados de una sola lámina) y la cabeza de cada pilar que llega, con su d/h; en las notas, el maestro del diafragma (ux, uy y el giro). Sólo lo horizontal.
  - **Un modo** (Modal), igual pero sin rótulos (no tiene unidades).
  - Con el sismo del programa no hay deformada de la combinación (VS-o): sale el mismo error que en el 3D.
- **El pedido:** la vista de planta `{ vista: "deformada", deformada }` y `deformada` en el alzado, con `DeformadaPedido` = una combinación o un modo, y su escala (`src/visor/sesion.ts`, `deformadaDibujo`). Estilos nuevos `deformada`, `deformada-lamina` y `deformada-nudo`, en los dos temas.
- **La app:** Deformada y Modal dan planta y alzado (con la misma cabecera en las tres vistas y la malla encima en planta) y ya no pasan la vista a 3D al entrar. La animación sigue siendo sólo del 3D.
- **Prueba** (`src/visor/deformada.test.ts`, con el edificio de A2): con escala 0, la deformada del alzado es el modelo analítico sin deformar; en planta, las cabezas de los pilares se mueven como el diafragma de la consulta de la planta (u = u_m + rz × (r − r_m), a la precisión de Float32); el mayor d/h rotulado de cada planta es el de `deriva`. El caso del modo sólo comprueba el error, porque ese edificio no tiene modal (en la app, con la vivienda, sí se ve).
- **Comprobado en la app** con la vivienda: el alzado del eje 2 (la flecha de la losa entre D y G, δ y d/h), la planta CUB con el d/h de cada pilar y la planta de Modal con el diafragma girado.
- **Bancos de Chrome:** i1, i4 y vs4 piden ahora el 3D al entrar en Deformada y Modal (lo hacía la pantalla); no se han pasado.

## 8. VC3 hecho (2026-11-28)

- **Alzado** (`vistaAlzadoComprobacion`, `src/visor/comprobacionVistas.ts`): sobre el alzado del modelo en gris, lo que el plano ve de cada parte de la pestaña, con los colores de la planta (CO6-d) y su aprovechamiento rotulado:
  - un tramo de pilar, de su base a su cabeza, con el ancho que se ve de su huella;
  - un vano de viga, con su canto, entre las caras de sus apoyos (si la viga cruza el plano, su sección, cuando el cruce cae en el vano);
  - una losa, su corte;
  - una unión del punzonamiento, la losa cortada a 2·d de las caras del pilar.
- **El pedido:** `comprobacion` en el alzado (`ComprobacionAlzado`: el tipo, el armado y los datos de armado de la obra), que es una tarea como la planta de la comprobación (pone al día lo comprobado por pasos). Se elige en él lo de la pestaña, como en la planta.
- **3D** (`clasesSolido`, pedido `comprobacion-solido`): la clase de cada triángulo del sólido de la sesión: el de un tramo de pilar (por el pilar y la planta de su cabeza), el de un vano de viga (el vano más cercano a su centroide a lo largo de la viga: lo de sobre un apoyo va con el de al lado) o el de una losa; lo demás, 0. La app (`Vista3D.ponerClasesSolido`) lo pinta con los colores de la planta y lo demás, tenue; sólo se aplica al sólido del que sale (mismo número de triángulos). No pasa el 3D a alámbrico, y en alámbrico no se ve (lo dice la leyenda).
- **Comprobación:** pilares, vigas y losas (con «Aprovechamiento») dan este 3D; losas con «Armado» y el punzonamiento siguen con el suyo (los refuerzos y los perímetros). El alzado, en las cuatro pestañas; mientras se propone el armado, el modelo.
- **Prueba** (`src/visor/comprobacionVistas.test.ts`, edificio objetivo de losas de 2 × 2 × 2 con el armado propuesto): en el alzado de dos ejes, cada polígono coloreado es de una parte de la tabla y lleva el color de su clase, los aprovechamientos rotulados son los de la tabla y salen todos los tramos de los pilares del plano; en el 3D, cada triángulo de un pilar, una viga o una losa lleva la clase de su parte (cada tramo de pilar, entero de la de su ficha) y los demás, 0.
- **Comprobado en la app** con la vivienda: el alzado del eje 2 en las cuatro pestañas (P10 0,88 y P2 0,94; el vano de Z-CUB-8; P2 0,26 en el punzonamiento, que se elige con un clic) y el 3D de pilares, vigas y losas.
- **No probado:** los bancos de Chrome.

## 9. VC4 hecho (2026-11-28)

- **El worker** (`src/visor/alzadoResultados.ts`, puro), sobre el alzado del modelo en gris:
  - **Pilares** (`vistaAlzadoPilares`): cada tramo de un pilar del plano, de su base a su cabeza y con el ancho que se ve de su huella, del color de la banda de su N o su ν, rotulado con su valor. Los valores, las bandas, los colores y la leyenda son los de `pilares3D` con todos los tramos del edificio (el 3D de Pilares y el cuadro), así que el alzado y el 3D se leen con la misma escala. Los extremos rotulados, los de lo que se ve.
  - **Muros** (`vistaAlzadoMuros`): el mapa de un campo en las láminas de los muros paralelos al plano y a menos de su profundidad, en (u, z), con los valores de `valoresCampo` o, con varias combinaciones y envolvente, de `envolventeCampo` (los del 3D de Losas con «Muros»). Sin envolvente, la combinación del mayor |valor| en lo que se ve, como en una planta; los límites, la paleta, lo de fuera de la escala, los picos y los extremos, como `vistaCampo`. σ no tiene mapa en el alzado (sólo la tienen las losas de cimentación), y un plano sin muros paralelos lo dice.
  - `anchoPilarEnPlano`, compartido con el alzado de Comprobación (VC3).
- **El pedido:** `pilares` (`PilaresAlzado`: magnitud y combinaciones) y `muros` (`MurosAlzado`: campo, combinaciones, escala y envolvente) en el alzado (`ExtrasAlzado`). `TipoElegible` admite «muro».
- **La app:** Pilares da el alzado, con el selector N/ν y la combinación en su cabecera, y en él sólo se eligen pilares; Losas da en el alzado el mapa de los muros del plano con el campo, la envolvente y la escala de la planta (en él se eligen muros). El panel de la escala sigue siendo el de la planta: sus picos y su rango son los de la planta, no los del alzado.
- **Prueba** (`src/visor/alzadoResultados.test.ts`, la retícula con núcleo de C3): en cada eje, los tramos de los pilares del plano salen uno a uno con el color y el valor del 3D, y el extremo de N es la mayor compresión de lo que se ve; el mínimo y el máximo del mapa de uz, M11 y F22 son los de las láminas de los muros del plano en la combinación dibujada, calculados aparte, y un eje sin muros no tiene mapa; el pedido, por el atendedor.
- **Comprobado en la app** con el ejemplo del núcleo: el alzado del eje 1 en Pilares (N de cada tramo, P0-5 −273 kN) y el del eje 2 en Losas (la envolvente máxima de M11 en el muro del núcleo, 12,4 kN·m/m con su combinación).
- **No probado:** los bancos de Chrome.

## 10. VC5 hecho (2026-11-28)

- **La regla:** en las plantas y los alzados con resultados, como en el 3D, el cursor quieto (90 ms) da el valor de lo que hay debajo en una sonda (un punto y un recuadro con sus líneas); el clic sigue eligiendo y, en Losas y Armado, fija el punto en Propiedades. Mientras se mide o se dibuja, no hay sonda.
- **El worker** (`Sesion.objetivo`, pedido `objetivo`): lo que hay bajo un punto de una escena plana (`Objetivo2D`), lo mismo que dice el 3D (`Objetivo3D`):
  - Diagramas (la planta de las vigas y el alzado con diagramas): la pieza elegida y su estación, por la proyección del punto en el eje de sus tramos (`tramosEspacio`) en la vista;
  - Pilares: el pilar y la planta de la cabeza de su tramo (en planta, la de la vista; en el alzado, la de la cota del punto);
  - Reacciones: el objeto;
  - el mapa de los muros del alzado (VC4): la lámina del muro del plano bajo el punto (`laminaMuroEn`) y ese punto en el espacio.
- **La app:** `Vista2D` avisa con el cursor quieto (`Eventos2D.pasar`) y pinta la sonda (`ponerSonda`), con el dibujo de la del 3D; `Fuente2D` la conecta (`sonda`, `useSonda2D`) y `FuenteEscena` con el `objetivo` del worker (`useSondaObjetivo`). Cada modo da las líneas con la función de su sonda del 3D: `lineasEstacion` (la consulta `estacion`), `lineasTramo` (los tramos de `pilares3d`), `lineasReaccion`, `valor-lamina` y, en las plantas de Losas y Armado, el pedido de su clic (`valor-punto`, `valor-armado`).
- **Prueba** (`src/visor/alzadoResultados.test.ts`, la retícula con núcleo): una viga en planta da su pieza con el punto en su eje y su estación vale para `estacion`; un pilar, en planta y en el alzado, su tramo; una reacción, su objeto; un muro del alzado, su lámina con el punto en ella, y fuera de los muros, nada.
- **Comprobado en la app** con el ejemplo del núcleo: la planta de Pilares (P0-5, N −272,9 kN en la base, con su combinación), la de Diagramas (VX5 en s = 3,02 m: My máx. 69,7 kN·m, el rotulado) y la de Losas (↓ 1,87 mm junto a la flecha máxima).
- **Sin sonda todavía:** Deformada y Modal (no la tienen tampoco en el 3D) y Comprobación (su clic abre el armado de la pieza).
- **No probado:** los bancos de Chrome.
