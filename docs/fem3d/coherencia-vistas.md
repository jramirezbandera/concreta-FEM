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
3. **VC3, Comprobación en el alzado y el color en el 3D** (CV-4).
4. **VC4, Pilares y muros en el alzado** (CV-5).
5. **VC5, el valor bajo el cursor en las vistas planas** (CV-6).
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
