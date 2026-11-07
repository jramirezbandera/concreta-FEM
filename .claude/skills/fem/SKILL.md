---
name: fem
description: Modelar, calcular, consultar y revisar una estructura con el motor FEM 3D de Concreta mediante la CLI `fem` y un fichero proyecto.json. Úsala cuando haya que crear o editar un modelo estructural (plantas, pilares, vigas, losas, muros, forjados, cargas), validarlo, calcularlo, leer sus resultados (envolventes, flechas, deriva, reacciones, esfuerzos de una pieza, armado de las losas por franjas) o preparar su informe de revisión.
---

# fem: modelar y calcular con Concreta FEM 3D

Trabajas sobre **un único fichero `proyecto.json`**: es la única fuente de verdad. Cada cambio del modelo es una edición de ese fichero. Los resultados se derivan de él y se guardan en `.fem/<huella>/`, junto al fichero.

## Reglas

1. **No produces ningún número de cálculo.** Todo esfuerzo, flecha o reacción que des sale de una salida de `fem`; cítala, con su combinación. Si una consulta no da lo que necesitas, dilo; no lo estimes.
2. **La norma no sale de tu memoria.**
   - Los datos de la norma (la categoría de uso, las cargas, γ) los da quien describe el proyecto.
   - ψ va por su nombre, nunca por números sacados de memoria: `"uso-A"` … `"uso-G"` según la categoría de uso que te den, `"nieve-hasta-1000"` o `"nieve-mas-de-1000"` según la altitud, `"viento"` o `"temperatura"`. Números sólo si te los dan. Si no te dicen la categoría, pregunta.
   - **El emplazamiento sale de `fem emplazamiento <municipio>`, nunca de memoria:** el código INE del municipio (`ine`), su aceleración sísmica básica `ab` y su `K` (anejo 1 de la NCSE-02) y la zona eólica de su provincia. Si hay varios municipios con ese nombre, o la provincia tiene más de una zona eólica (`frontera`), pregunta cuál es. Si el municipio no figura, **no lo des por exento**: díselo al ingeniero con el mensaje de la orden.
   - Si faltan, deja los casos sin `accion`: las consultas irán por caso, sin combinaciones.
   - No te inventes cargas que no te han dado.
3. **No decides por el ingeniero.** Si la descripción es ambigua (una luz, una sección, un apoyo), pregunta o dilo; no elijas en silencio. Las opciones de compilación por defecto (`opciones`) ya están decididas: no las cambies si no te lo piden. Si te lo piden («sin modificadores de rigidez», «malla de 1 m»), búscalas en el esquema: `"modificadores": {}` quita los de por defecto.
4. **Ningún resultado vale si `ok` no es `true`.** Los errores se corrigen en el fichero, por el `id` que nombra cada diagnóstico. Los avisos se leen todos y se explican al usuario si afectan al modelo.
5. **Ningún resultado se da por bueno sin `fem revisar`.** Sus avisos de sensatez (`sensatez/…`) se corrigen si son un error del modelo o se explican al usuario si son legítimos. Nunca los silencies cambiando el modelo para que desaparezcan. Al acabar, dile al ingeniero dónde está el informe y qué avisos tiene: él lo revisa (no hay firma).
6. **Un número nunca se lee de una imagen.** Las figuras de `fem render` sirven para ver el modelo y encontrar lo raro. El valor que cites sale del JSON de `render` (`extremos`) o de una consulta.

## Antes de escribir el fichero: los datos del encargo

Reúne **todo lo que falta en una sola ronda de preguntas**, con tu propuesta en cada punto que la admite, para que el ingeniero conteste «sí» o corrija. No empieces a escribir el fichero con medio encargo ni preguntes en tres rondas lo que podías preguntar en una. Si tienes el plano en DXF o DWG, pásalo antes por `fem importar-dxf` (abajo): lo que el dibujo ya dice no se pregunta.

- **Siempre:**
  - las plantas, con su cota (la de la cara superior de cada forjado) y la de la cimentación;
  - el arranque de los pilares (empotrados, por defecto) y desde qué planta;
  - el material (el hormigón, HA-xx; el acero de los perfiles);
  - las secciones de los pilares, y si cambian en altura (y su punto fijo, si no es el centro).
- **Por forjado:**
  - macizo: el canto;
  - reticular: el canto (casetón + capa), el intereje, el nervio, el casetón (de hormigón, cerámica, poliestireno, perdido de otro material o recuperable) y, si lo dan, el peso del forjado del fabricante (es el de la zona aligerada); los ábacos (su tamaño, o propón el habitual alrededor de cada pilar y pregunta: van con `abacosPilares`);
  - unidireccional: la vigueta, el intereje, el canto, la bovedilla y su pp si lo dan.
  - el peso: si dan el del sistema entero, va en `pp` con `ppProcedencia` (`{ "origen": "fabricante", "fuente": "…" }`); si sólo el de la pieza de relleno, en `reticular.relleno` o en el `relleno` del paño, como `{ "pesoAparente": kN/m³ de hueco }` o `{ "pesoPieza": kg, "piezasM2": piezas/m² }` (nunca las dos), con su `procedencia`. Sin nada, sale del estimado del casetón o la bovedilla, que es de predimensionamiento: dilo en el resumen al ingeniero y no lo presentes como un peso certificado. Nunca pongas a la vez el `pp` y el `relleno` (manda el `pp`, avisa `forjado/relleno-sin-efecto`).
- **Bordes:**
  - **todo borde de forjado lleva su zuncho** (de 20 a 40 cm; propón 30 con el canto del forjado), aunque el plano de arquitectura no lo dibuje;
  - los vuelos;
  - los petos, en **kN/m** (si te dan kN/m², pide la altura), y por qué tramos del borde van (van con una carga `borde`);
  - en un escalón de cubierta (una cubierta poco por debajo de otra), **hasta dónde llega la baja bajo la alta**: la cara de los pilares del encuentro (lo habitual en el dibujo; propónlo), su eje o pasa por debajo de la alta. No es lo mismo: cambia los ábacos de esos pilares y lo que carga la baja.
- **Vigas:** las que no se ven en el plano (descolgadas o planas, su sección).
- **Cargas:**
  - las permanentes por zona (solado, tabiquería, instalaciones, cubierta);
  - el uso con su **categoría** (para ψ);
  - la nieve (su valor y la altitud, para ψ).
- **Viento y sismo del programa** (`acciones`; o que se dejan para después, y entonces no se ponen):
  - el **municipio** de la obra: pásalo por `fem emplazamiento` y propón lo que da (el código `ine`, `ab`, `K` y la zona eólica), para que el ingeniero lo confirme; si la orden avisa de `frontera`, pregunta la zona eólica del municipio;
  - viento: la **aspereza del entorno** (grado I a V del DB SE-AE: I, borde del mar o de un lago; II, rural llano; III, rural accidentado o con obstáculos; IV, urbana, industrial o forestal; V, centro de gran ciudad) y, si no es la ±0,00, la cota de la rasante;
  - sismo: el **tipo de terreno** de cimentación (I a IV, o los estratos de los 30 primeros metros, del geotécnico), el **sistema estructural y la ductilidad μ** (1, sin ductilidad; 2, baja; 3, alta; 4, muy alta: la decide el ingeniero con los detalles del capítulo 4 de la norma) y la **importancia** (normal o especial).
- **Lo dudoso del dibujo:** las piezas que pueden no ser estructurales (un muro de fábrica, un pilar de la pérgola, un rectángulo sin cruz), cada una con tu lectura propuesta.

Lo que no te den y tenga valor por defecto en el fichero, déjalo por defecto y dilo; lo que sea de norma, no lo pongas (regla 2).

### Desde un plano DXF

`fem importar-dxf` lee el plano (DXF o DWG, de R14 a 2018) y propone el proyecto: plantas, pilares (rectángulos y círculos de su capa, con su sección y su giro), contornos de losa (con sus huecos) y ejes de replanteo con el nombre de su burbuja. No pone cargas ni más casos que el del peso propio.

```bash
fem importar-dxf plano.dxf                     # sin --salida: qué capas hay, qué ve en cada una y qué propone
fem importar-dxf plano.dxf --salida proyecto.json --capa-pilares "PILARES" --capa-losas "FORJADO" \
    --capa-ejes "EJES" --planta Cim:0 --planta P1:3.40 --planta Cub:6.50 --planta-losas P1 --material HA-30 --espesor 0.30
```

- **Primero sin `--salida`:** mira `capas` (por capa, los pilares y contornos que vería y las líneas largas) y `propuesta`. Las capas que te proponga, confírmalas con el ingeniero en la ronda de preguntas si el nombre no lo deja claro.
- **`supuestos`** es lo que puso sin dato (capas, plantas, material, espesor, unidades): pregúntalo todo, en la misma ronda.
- **Unidades:** las del tamaño del dibujo (un DXF que dice mm y está en m se lee en m, con aviso); `--unidades` las fuerza.
- **Pilares:** si unos rectángulos tienen cruz o aspa en el centro y otros no, sólo cuentan los que la tienen; los demás van a `noReconocidos` como trozos de muro. Lo que no reconoce (un polígono raro, un rectángulo sin cruz), pregúntalo con su caja. Todos van desde la planta más baja hasta la de las losas: ajusta `desde` y `hasta` con lo que te digan.
- **Losas:** van hasta la línea de fuera del borde (con las líneas dobles de un peto o de una fachada, la de fuera); dos contornos que se tocan son dos losas. Todas en la planta de `--planta-losas`, macizas, con `--espesor`: pásalas a su planta y a su tipo de forjado (reticular, unidireccional) con lo que te digan. Con un DXF por planta, importa la primera y copia del resto sólo lo que haga falta.
- **Cotas:** `cotas.noCuadran` lista las cotas del plano cuyos puntos no caen en nada reconocido. Si no cuadra ninguna, las unidades o las capas están mal.
- Si el DXF está en la carpeta del proyecto, queda como plantilla de la planta de las losas: el ingeniero lo ve detrás del modelo en la app. Nunca escribe encima de un proyecto que ya existe.
- Después, como siempre: `fem validar` y `fem render --vista modelo` para comparar con el plano. Las coordenadas salen al mm del dibujo: un descuadre de 1 o 2 cm entre pilares de una alineación es del dibujo, y `validar` lo avisa (`sensatez/casi-alineados`). Pregunta si se alinean y, si te dicen que sí, usa `fem alinear` (abajo), no lo corrijas a mano ni con código propio.

### Alinear lo casi alineado

```bash
fem alinear proyecto.json                      # sólo propone: qué está casi alineado y adónde iría
fem alinear proyecto.json --escribir           # lo mueve y reescribe el fichero (el de antes, en proyecto.json.bak)
fem alinear proyecto.json --tolerancia 0.02    # otra tolerancia, en m (por defecto 0.03)
```

- **Qué mira:** según la dirección de los ejes, los pilares y los vértices (vigas, muros, losas, huecos, ábacos, paños, apoyos, cargas) que no coinciden por menos de la tolerancia, y los tramos casi rectos. Lo que comparte una cara no cuenta (un pilar de 35 enrasado con uno de 30, la losa en la cara de una viga), ni dos vértices de dos arcos que coinciden por casualidad.
- **Adónde lo lleva:** a un eje guardado si lo hay (no se mueve) y, si no, donde hay más piezas. Nada se mueve más que la tolerancia en cada coordenada; lo que estaba en el mismo punto sigue junto, y los huecos de muro y los tramos de las cargas de viga se vuelven a medir.
- **`grupos`** trae cada recta con sus valores, sus piezas, lo que les falta (`falta`, m) y el texto del aviso; **`movimientos`**, cada punto que se mueve (`id`, `punto` dentro del objeto, `de`, `a`); **`quedan`**, los casi alineados que quedarían.
- Enséñale al ingeniero la propuesta antes de escribir: dos cosas a 2 cm pueden ser distintas de verdad (una junta). Con `--escribir`, vuelve a `fem validar`.

## Flujo

```bash
fem esquema                                  # ruta del JSON Schema (descripciones = convenios)
fem emplazamiento <municipio | código INE>   # del municipio: ine, ab y K (sismo) y la zona eólica de su provincia (viento)
fem validar proyecto.json                    # esquema + compilación; corrige hasta ok: true
fem resumen proyecto.json                    # comprueba el modelo: plantas, piezas, cargas por planta y caso
fem calcular proyecto.json                   # calcula (o reutiliza los resultados de la misma huella)
fem consultar proyecto.json <consulta> …     # resultados acotados
fem render proyecto.json [--vista V] [--planta P]   # PNG y SVG de cada planta, para mirarlos
fem revisar proyecto.json                    # sensatez e informe de revisión (Markdown y HTML) de esta huella
```

- `fem` es la orden que deja `bun run instalar` en el repo del motor (lanza su `cli/fem.ts` con bun). Si `fem` no existe, díselo al ingeniero; mientras, `bun "<repo>/cli/fem.ts"` o, dentro del repo, `bun run fem`.
- **Trabajas en la carpeta de la obra**, con su `proyecto.json` y los `.fem/` que se generan, no dentro del repo del motor: los proyectos y planos de clientes no van en ese repo.
- Cada orden escribe **un objeto JSON** con `orden`, `ok` y `diagnosticos`. Los diagnósticos repetidos se resumen en `omitidos`.
- `calcular` puede añadir avisos del motor que `validar` no da (por ejemplo, `modelo/nudos-coincidentes`): léelos también.
- **Códigos de salida:** 0 bien; 1 errores del modelo o del cálculo; 2 orden mal dada; 3 error interno.
- **Números:** la salida va a 6 cifras significativas; con `--exacto`, completos.

**Tras validar, lee `fem resumen`** antes de calcular: la carga vertical de cada planta y caso (`cargas`, en kN, con el peso propio), la horizontal (`horizontales`, [ΣFx, ΣFy]) y el total por caso (`casos[].F`) delatan una carga olvidada, duplicada, en la planta equivocada o en otras unidades.

**`validar` ya da los avisos de sensatez que no necesitan el cálculo** (alturas, espesores, secciones, materiales, pp, cargas duplicadas o hacia arriba, arranques de pilares). Si un error del compilador no se entiende, mira si hay uno de esos avisos: un espesor o un canto en cm suele acabar en `pilar/tramo-flexible-nulo`.

### Revisión

`fem revisar` calcula (o reutiliza) y pasa las comprobaciones de sensatez del modelo:
- unidades y magnitudes de los datos;
- carga por m² de cada planta y por tipo de acción, y plantas a las que les falta la carga de un caso;
- peso propio del cálculo frente al esperado (Σ V·γ);
- axil de cada pilar frente a su bajada por áreas tributarias;
- luz/canto de vigas y losas, flechas, desplomes y axil reducido.

Son avisos de orden de magnitud, no comprobaciones de norma. Escribe el informe en `.fem/<huella>/informe.md` e `informe.html`. Un aviso legítimo (una transición, un voladizo) se explica; uno que delata un error del modelo, se corrige en el fichero.

### Render

`fem render` dibuja cada planta vista desde arriba (X a la derecha, Y hacia arriba). Escribe un PNG (de 1568 px de lado como mucho, para mirarlo con tu herramienta de lectura de imágenes) y un SVG por planta y vista en `.fem/<huella>/render/`, y devuelve la lista en `figuras`, con la carpeta en `carpeta`.

| Vista | Qué dibuja |
|---|---|
| `modelo` (por defecto) | Losas (sus huecos, con aspa), paños con la dirección de sus viguetas, vigas con su ancho, pilares con su sección orientada (rellenos los que llegan desde abajo; en blanco los que arrancan), muros con sus huecos del piso de debajo, apoyos y bandas, con sus ids; los ejes de replanteo con sus burbujas y las cotas entre ellos |
| `cargas` | Las cargas de cada caso (`--caso C` para uno) en la planta, con su valor |
| `diagnosticos` | Una marca numerada en cada objeto con un error o un aviso, con la lista al lado |
| `malla` | Láminas y barras de la planta |
| `uz`, `m11`, `m22`, `m12`, `v13`, `v23` | Isovalores en las losas, en la combinación que gobierna en la planta (con `--envolvente max\|min`, la envolvente en cada nudo), con las isolíneas rotuladas con su valor (la del 0, más gruesa). En uz se rotulan la flecha máxima (hacia abajo, en positivo) y, si lo hay, el levantamiento |
| `f11`, `f22`, `f12` | Fuerzas de membrana de las losas (kN/m, tracción positiva). En una planta con diafragma rígido son nulas (las lleva el diafragma): el mapa sale de una sola banda y lo dice |
| `vigas-my`, `vigas-mz`, `vigas-vz`, `vigas-vy`, `vigas-n`, `vigas-t` | Diagramas envolventes de vigas y viguetas, con el máximo y el mínimo de cada vano. My, Vz, N y T, abatidos sobre la planta; Mz y Vy, en su plano. En un diafragma rígido, Mz y Vy son nulos (no se dibujan, y la nota lo dice) y N no tiene valor |
| `pilares-n` | Axil de cada pilar que llega a la planta |
| `reacciones` | Reacciones de los pilares y muros que arrancan de la planta y de sus apoyos: Fz rotulada y (Fx, Fy) a escala; por defecto, cada objeto en la combinación de la ELS característica de su mayor \|Fz\| (sin acciones en los casos, en el caso de su mayor \|Fz\|) |
| `armado-x-inf`, `armado-x-sup`, `armado-y-inf`, `armado-y-sup` | Las franjas de armado de las losas, coloreadas por tramos según la demanda de Wood–Armer (kN·m/m) de su armadura inferior o superior en X (el eje 1 de cada losa) o en Y, de `consultar franja`; rotulados, los picos de cada franja. Con la armadura base del proyecto, lo cubierto en gris y las zonas de refuerzo con su máximo y el exceso |
| `bandas` | Las bandas de dimensionado del proyecto (si las tiene) con su My en cada estación, de `consultar banda` |

- `--vista` y `--planta` admiten varias, separadas por comas o repetidas; sin `--planta`, todas.
- `modelo`, `cargas` y `diagnosticos` se dibujan aunque el modelo no compile: así se ve dónde está el error.
- Todas las vistas llevan los ejes de replanteo (los de `ejes` o, sin ellos, los propuestos con las alineaciones de los pilares): úsalos para comprobar que cada pilar está en su eje.
- Las combinaciones son las de `consultar`; sin acciones en los casos, la suma de los gravitatorios (×1 en uz y ×1,4 en los esfuerzos). Con `--caso` y `--combinacion`, como en las consultas.
- `--envolvente` de los mapas con varias combinaciones: `max` o `min` dibuja en cada nudo la mayor o la menor de todas, y cada extremo de `extremos` lleva la suya en `comb`. Sin ella, el mapa es una sola combinación (la de mayor |valor| de la planta) y no es la envolvente: un punto puede valer más en otra.
- `--escala` de los mapas: `completa` (por defecto), `sin-picos` (sin el 1 % del área por cada lado) o `mín:máx:paso` (cualquiera vacío: `-40:20:`, `::5`). Lo que se sale va rayado en una banda «menos de…» o «más de…»; los `extremos` siguen siendo los reales. Cada figura de mapa trae su `escala` en el JSON; con `picos: true`, la escala completa la marcan picos locales y conviene mirarla también `sin-picos`.

**Mira `modelo` y `cargas` de cada planta antes de calcular, y compáralos con la descripción:**
- pilares fuera de su alineación o girados;
- vigas que no llegan a su apoyo;
- huecos que faltan o están fuera de sitio;
- cargas en la zona, la planta o el caso equivocados.

Lo que no cuadre, pregúntalo o corrígelo en el fichero, como un diagnóstico.

### La app (para el ingeniero)

El ingeniero mete y revisa el modelo en la app: tablas por tipo de objeto, vistas de planta, alzado por eje y 3D (una, dos o cuatro a la vez), el cálculo y los resultados. Si quiere verla, dile que la abra él con:

```
fem visor proyecto.json                # escribe una URL local (127.0.0.1) que abre la app sobre ese fichero
fem visor nuevo.json --nuevo           # crea un proyecto con la plantilla y lo abre
```

Si el ingeniero tiene el proyecto guardado en el navegador (en la app web, «Mis proyectos»), tú no lo ves: pídele que lo pase a la carpeta de la obra con **«Pasar a una carpeta»** (el icono de la carpeta con la flecha, en la barra de arriba, o Ctrl+K). Deja allí su `proyecto.json`, sus plantillas DXF y lo calculado en `.fem/`, y la app sigue abierta sobre ese fichero: desde entonces se guarda ahí y ve tus cambios. Si su navegador no tiene carpetas (Firefox, Safari), que lo exporte y lo abra con `fem visor`.

**Lo que el ingeniero tiene elegido en la app** («esta viga», «el pilar que tengo marcado», «mira lo que tengo seleccionado»):

```
fem seleccion proyecto.json            # la planta, el espacio y lo elegido, con cada objeto tal como está en el fichero
```

- `valor.elegidos` lleva cada objeto con su `coleccion` y el objeto entero del fichero, en el orden en que lo eligió (el último es el que tiene en Propiedades).
- Si `valor.alDia` es `false`, la app enseña otra versión que la del fichero (tiene cambios sin guardar, o aún no ha recargado los tuyos): los avisos lo dicen. Pídele que guarde antes de cambiar nada.
- Sólo funciona si la app tiene el proyecto abierto desde su carpeta (abierto con «Abrir carpeta» o tras «Pasar a una carpeta», en Chrome o Edge) o con `fem visor`. Con una carpeta abierta sólo para leer, la app no escribe hasta que el ingeniero guarde una vez (el navegador pide el permiso entonces).
- Es lo que tenía elegido la última vez que cambió algo (`valor.antiguedad`, en segundos): si hace mucho, pregúntale si sigue siendo eso.

La app vigila el fichero: cada vez que lo editas, se recarga sola (o usa lo que dejó `fem calcular` en `.fem/`). El ingeniero también puede editar y guardar el mismo `proyecto.json` desde ella, así que:

- **Lee el fichero justo antes de cambiarlo**, nunca de memoria: puede que el ingeniero lo haya guardado desde la app.
- Si cambias el fichero mientras él tiene cambios sin guardar, la app no pisa nada: le avisa y elige él. Díselo cuando cambies algo que podría estar editando.
- Al guardar, la app escribe el fichero en su formato canónico (2 espacios y las claves en el orden de los tipos). El contenido y la huella no cambian.
- Las losas macizas y reticulares se arman con **franjas** de ancho fijo (1 m, o el intereje en un reticular) que cubren toda la losa en sus dos direcciones (X, el `eje1` de la losa, e Y). No se escriben: salen solas de la losa, y sus esfuerzos, de `consultar franjas` y `consultar franja`. La app ya no propone ni edita bandas; las `bandas` del proyecto, si las hay, son cortes de comprobación tuyos: no las quites ni las cambies sin que el ingeniero lo pida.
- La **armadura base** (`armado` del proyecto, fuera del `modelo`: no cambia la huella ni obliga a recalcular) es el momento en kN·m/m que cubre la armadura base de cada losa: `{ "base": { "x-sup": 20 }, "losas": { "<losa>": { "x-inf": 15 } } }` (la de la losa manda sobre la común; las armaduras son `x-inf`, `x-sup`, `y-inf` e `y-sup`). Es una decisión del ingeniero: léela y úsala, pero no la pongas ni la cambies si no te la da.

Tú no necesitas la app: tus números salen de la CLI.

## El fichero

```json
{ "esquema": "concreta-fem/proyecto@1", "nombre": "…", "modelo": { … }, "opciones": { … } }
```

Hay un ejemplo completo y válido en `ejemplo.json`, junto a esta skill. El esquema (`fem esquema`) documenta cada campo. **Un campo que no existe es un error**: el validador propone el nombre más parecido.

### Convenios del modelo

- **Unidades:** kN y m; módulos en kN/m², salvo `fck` y `E` de los materiales, que van en MPa; pesos específicos en kN/m³; cargas de superficie en kN/m², lineales en kN/m.
- **Ejes:** globales X e Y en planta, **Z hacia arriba**. Una carga de gravedad es `q: [0, 0, -valor]`.
- **Plantas, de ARRIBA ABAJO.**
  - Cada una lleva su `altura` hasta la de encima; la primera de la lista (la de arriba) lleva `"altura": null`.
  - La cota de una planta es la **cara superior de su forjado**, como en CYPECAD y en los planos: la `altura` va de cara superior a cara superior (desde la cimentación, hasta la cara superior del primer forjado). El compilador pone ahí los nudos del forjado y hace rígido el pilar en todo el canto por debajo (RV-b); no restes medio canto.
  - El nivel de cimentación es la última planta: los pilares arrancan en él (`desde`) y se empotran por defecto.
  - Las cotas no se escriben; salen de las alturas. La cota 0 es la planta más baja que no es `"tipo": "sotano"`. Marcar la cimentación como sótano sólo mueve el origen de las cotas: el cálculo es el mismo, salvo el redondeo.
  - Un forjado a poca altura del de debajo (el escalón entre dos cubiertas, como una de 0,90 m sobre otra) lleva `"tipo": "escalon"`: la revisión no avisa de esa altura. En lo demás es una planta normal.
- **`id` únicos en todo el modelo** (plantas, materiales, secciones, piezas, casos y cargas).
- **Pilares:** se sitúan con `x`, `y`, `desde` (la planta de su base) y `hasta` (la de su cabeza). Una sección rectangular lleva `b` y `h`; el canto `h` va según X con `giro` 0. Si la sección cambia en altura, `tramos` da la de cada tramo por la planta de su cabeza.
  - **Punto fijo** (`fijo`, como en CYPECAD): el punto de la sección que está en (`x`, `y`) en todas las plantas: `"centro"` (por defecto), `"mitad-derecha"`, `"mitad-izquierda"`, `"mitad-superior"`, `"mitad-inferior"` o `"esquina-superior-derecha"` y las otras tres esquinas. «Derecha» va según el canto `h` y «superior», a 90°: con `giro` 0, +X y +Y. Con `fijo`, `x` e `y` **no** son el eje: son ese punto (la cara exterior de un pilar de fachada, la esquina de uno de esquina), y la sección de cada tramo crece desde él. Si el plano o el listado de CYPE dan el punto fijo, cópialo tal cual; si dan el centro, no pongas `fijo`. Donde la sección cambia, el compilador lleva la excentricidad entre tramos (N·e) con un brazo rígido.
- **Secciones y materiales dados por sus propiedades:**
  - Una sección `general` lleva A, Iy, Iz y J. Iy es la de My: en una viga, la flexión vertical; en un pilar, la del plano de su canto (el XZ con giro 0).
  - Un material `general` lleva E y G en kN/m² y su peso.
- **Vigas:** se dibujan con `puntos` en planta sobre su eje y con su planta. Se conectan solas a los pilares y a otras vigas que tocan (tolerancia de 5 cm, con aviso).
- **Barras entre dos niveles** (`barras`: vigas inclinadas, tornapuntas, zancas, diagonales de arriostramiento):
  - `inicio` y `fin` llevan cada uno `planta`, `x` e `y`; van a la cota de su planta (`dz` no se admite aún). Las dos en la misma planta es una barra en el plano del forjado.
  - Cada extremo se une a lo que encuentra en su planta: el pilar en cuya huella cae, un nudo a ≤ 5 cm, una viga (que se parte), una losa o el eje de un muro. Si no cae en nada, es un error.
  - Ejes locales: x del inicio al fin; z en el plano vertical que la contiene, hacia arriba (`giro` la gira alrededor de x); una vertical, como un pilar.
  - Zona rígida sólo hasta la cara de un pilar de hormigón; en acero, ninguna.
  - Una diagonal articulada: `liberaciones` `{ "inicio": [false, false, false, false, true, true], "fin": [false, false, false, true, true, true] }` (la torsión, en un solo extremo).
  - `soloTraccion: true` en una diagonal esbelta: se calcula lineal (en una cruz, las dos activas) y la revisión avisa (`barra/compresion`) si queda comprimida.
  - Con los dos extremos en el mismo diafragma rígido no recibe nada de las acciones horizontales en ese plano (aviso `barra/en-diafragma`): para arriostrar una cubierta, quita el diafragma de esa planta.
- **Losas y paños:** su contorno es un polígono simple y no repite el primer punto.
  - **Se dibujan a ejes:** el borde que apoya en una viga va sobre el eje de la viga.
  - **Todo borde de forjado lleva su zuncho** (viga de atado, de 20 a 40 cm de ancho; lo normal, 30, con el canto del forjado). No lo olvides aunque el plano de arquitectura no lo dibuje: pregunta su ancho y su canto. Donde el borde tiene pilares, el zuncho va por su eje (enrasado por fuera quedaría a pocos cm de sus caras y ensucia la malla); donde no, enrasado por fuera. Si la losa acaba en la cara de unos pilares (la cubierta baja de un escalón), el zuncho va también por su eje, fuera de la losa, y la losa llega a su cara. **La losa va hasta su borde real, como se hormigona:** no la recortes hasta el eje ni pases cargas a mano. El compilador lleva a la viga lo que cae en su ancho y en la franja de hasta b entre su cara de fuera y el borde (fase TB, `tirasBorde`), con sus cargas de superficie, petos y puntuales. La orden «Vigas de borde» del editor hace lo mismo. `fem validar` avisa (`sensatez/borde-sin-viga`) de cada tramo de borde sin viga, muro, apoyo lineal u otro forjado debajo.
  - **Ábacos de un reticular, obligatorios en cada pilar** (sin uno, `reticular/pilar-sin-abaco` y no se calcula): `"abacosPilares": { "lado": 2.0 }` (o `{ "lados": [a, b] }`, según los nervios y su perpendicular) pone uno centrado en cada pilar que llega a la losa y lo mueve con él; **no los dibujes a mano**. `abacos` (polígonos) queda para los que no son así (un ábaco de otra forma, el de un pilar que no está en el centro). Los que se solapan o quedan a menos de media malla (0,375 m) se unen solos en su rectángulo envolvente, con el aviso `reticular/abacos-unidos`: no los recortes ni los unas tú. Lo que se sale de la losa no cuenta.
  - **El peso propio se calcula solo si no das `pp`:** γ·espesor en una maciza; en un reticular, el hormigón de nervios y capa más el casetón en el hueco (`caseton`: `"hormigon"` por defecto, `"ceramica"`, `"poliestireno"` o `"recuperable"`) y los ábacos, γ·canto; en un unidireccional con una vigueta en T, la vigueta y la capa más la bovedilla (`bovedilla`: `"hormigon"` por defecto, `"ceramica"` o `"poliestireno"`). **Pregunta de qué es el casetón o la bovedilla** si el encargo no lo dice. Si te dan el peso del forjado (el del fabricante o el de la memoria), escríbelo en `pp`: manda (en un reticular, es el de la zona aligerada, el que da el fabricante: los ábacos pesan γ·canto aparte). Con `caseton: "perdido"` (de otro material) o una vigueta que no es una T, el `pp` es obligatorio.
- **Muros:** verticales, de `desde` a `hasta`, sobre su eje en planta. Un muro cerrado (un núcleo) repite el primer punto al final.
- **Ejes de replanteo** (`ejes`, opcional): `id` (lo que dicen sus burbujas: «A», «1»), `nombre` si las burbujas tienen que decir otra cosa, y `desde` y `hasta` en planta. Son sólo del dibujo: no entran en el cálculo ni cambian la huella. Sin `ejes`, el dibujo usa los propuestos (números según la dirección de las losas, letras en la perpendicular). Pon los del plano si te los dan; si no, no los inventes.
- **Casos:** como mucho uno con `pesoPropio: true`, y **ese caso sólo lleva el peso propio**, que calcula el programa: las cargas permanentes que des tú (solados, tabiquería, petos, fachadas) van en otro caso, `CM` («Cargas muertas»), con la misma `accion` que el del peso propio. Las combinaciones dan lo mismo (el CTE toma las permanentes globalmente) y así se distingue lo que pone el programa de lo que pone el usuario, también en los resultados por caso. `fem validar` avisa (`sensatez/cargas-en-peso-propio`) si hay cargas en el caso del peso propio.
  - Con `accion` en **todos** los casos, las consultas usan las combinaciones CTE/NCSE.
  - `accion` lleva: `tipo` G, Q, W, S, E…; `psi` por su nombre (`"uso-A"`, `"viento"`…, ver reglas) o como `{ psi0, psi1, psi2 }` si te dan los valores; y, en W y E, `direccion` y `signo`.
- **Acciones del programa** (`acciones`, opcional): el viento y el sismo que el programa genera desde la situación del edificio. Sus casos no se escriben ni llevan cargas tuyas, y entran solos en las combinaciones. Los datos, del encargo (arriba) y de `fem emplazamiento`.
  - `"viento": { "zona": "A", "aspereza": "IV" }` (CTE DB SE-AE): la `zona` eólica (A, B o C) y la `aspereza` (I a V); opcionales, `qb`, `altitud`, `rasante` y `fachadas` (el esquema los explica). Da ocho casos, `W+X+e`, `W+X-e`, `W-X+e`, `W-X-e` y los cuatro según Y.
  - `"sismo": { "ine": "29008", "municipio": "Alhaurín el Grande", "terreno": "II", "mu": 2 }` (NCSE-02): `ine` es el código INE del municipio (5 cifras, de `fem emplazamiento`), y de él salen `ab` y `K`; `municipio` es su nombre, para quien lee el fichero (si no es el de ese código, es un error). Un `ab` (en g: 0,11 es 0,11 g) o un `K` escritos mandan sobre los del municipio: escríbelos sólo si te los dan (un estudio del emplazamiento, o un municipio que no figura), y sin `ine` hacen falta los dos. Además, `terreno` (`"I"`…`"IV"`, su C o sus estratos) y `mu` (1 a 4; `{ "x": …, "y": … }` si no es la misma); opcionales, `importancia` (`"especial"`), `omega` (5 %), `regla` (`"cqc"`), `excentricidad` (0,05), `sistema`, `masas` y `nievePermanente`. Da cuatro casos, `EX+e`, `EX-e`, `EY+e` y `EY-e`. Con `"sismo": {}`, sólo las masas y los modos. La hipótesis de `fem compilar` dice de dónde salen `ab` y `K`.
- **Cargas:**
  - `superficie`: sobre una `losa`, un `pano` o una `zona` (polígono) de su planta.
  - `lineal`: polilínea sobre una losa o el eje de un muro.
  - `borde`: por el borde de una `losa` (un peto, una fachada), en kN/m: `{ "tipo": "borde", "id": "PETO", "caso": "CM", "losa": "L1", "q": [0, 0, -3] }`. Va por todo su contorno; con `"huecos": true`, también por el de sus huecos; `excepto` quita tramos: un segmento `[[x, y], [x, y]]` (lo del borde que va por él) o `{ "junto": "L2" }` (lo que toca en planta la losa L2, aunque esté en otra planta: el encuentro de dos cubiertas). **Úsala para los petos** en vez de polilíneas a mano: sigue al contorno y no ensucia la malla (una lineal a pocos cm del borde o de la cara de un pilar mete líneas casi paralelas: `losa/ajuste` y `malla/calidad`).
  - `puntual`: `F` y `M` en ejes globales, en un punto de una planta.
  - `viga`, `pilar` y `barra`: repartidas a lo largo de la pieza; sin `desde` ni `hasta`, en toda ella. Es la forma de dar el viento sobre los pilares de una fachada. En una barra van por metro de su longitud real, desde su inicio.
  - `empuje`: sobre un muro.

  Lo que cae fuera de las losas no carga, y lo avisa.

## Consultas

| Consulta | Da |
|---|---|
| `envolventes [--tipo pilar\|viga\|vigueta\|barra] [--planta P]` | Por tipo de pieza y planta: máximos y mínimos de N, Vz y My (y Vy y Mz en pilares y barras), con la pieza, la estación y la combinación. Una barra va con la planta de su inicio |
| `flechas [--losa L]` | Por losa o paño: la flecha máxima absoluta y la relativa a las esquinas del recuadro o a los extremos de la vigueta |
| `deriva [--planta P]` | Por planta: el mayor desplome relativo (d/h) con su pilar, y el desplazamiento del maestro del diafragma |
| `reacciones [--objeto id] [--top N \| --todos]` | Totales por caso (ΣF y ΣM respecto al origen) y los apoyos con más carga |
| `pieza <id> [--estaciones]` | Una viga o vigueta, por vanos (de cara a cara de apoyo); un pilar, por tramos (base y cabeza, con los esfuerzos concomitantes); o una barra, con sus extremos a lo largo de ella |
| `franjas [--losa L \| --planta P]` | Las franjas de armado de las losas (ids `<losa>:X<i>` y `<losa>:Y<i>`), con su mayor demanda de Wood–Armer inferior y superior (kN·m/m), dónde está y su combinación |
| `franja <id>` | Una franja, estación a estación (caras de pilares y líneas de apoyo exactas; cada 0,25 m por campos): mx máximo y mínimo y Wood–Armer inferior y superior por metro. En una cara o un apoyo con un borde rígido detrás, `distanciaMuestras` (m) dice a qué distancia se tomaron my y mxy (un canto de la losa) |
| `refuerzos --armadura x-inf\|x-sup\|y-inf\|y-sup [--losa L \| --planta P]` | Las zonas de refuerzo: lo que supera la armadura base del proyecto, conexo, con sus franjas, su extensión (s, t, longitud, área, caja), su máximo con el exceso y su combinación; y las losas sin base. La extensión es la de las estaciones (±0,125 m), sin anclajes ni solapes |
| `banda <id>` | My máximo y mínimo en cada estación de una banda del proyecto (caras y vanos) |
| `modos [--top N \| --todos]` | Masas y modos de vibración: por planta con diafragma rígido, su masa (t), su peso (kN), su centro de masas y su inercia de giro; y los modos de mayor periodo, con su masa efectiva en X, en Y y en giro (y la acumulada) y su forma por plantas. Necesita `"acciones": { "sismo": {} }` en el modelo: la masa sale de las cargas (G entero y de cada Q la fracción de la NCSE-02 según su ψ: 0,5 en `"uso-A"`, 0,6 en `"uso-B"`, `"uso-C"` y `"uso-D"`); la de un caso sin acción o sin ψ por su nombre se escribe en `acciones.sismo.masas` (`[{ "caso": "Q", "fraccion": 0.5 }]`, preguntando el uso: no la saques de memoria). No depende de las combinaciones |
| `sismo [--top N \| --todos]` | El sismo del programa por espectros de respuesta (NCSE-02, art. 3.6.2): el emplazamiento (S, ac, TA, TB) y, según X y según Y, el cortante en la base y entre el peso, los cortantes y las fuerzas de cada planta con su excentricidad, los desplazamientos (ya por μ), θ = P·d/(V·h) de los efectos de segundo orden (aviso por encima de 0,10) y el cortante del método simplificado, sólo para contrastar. Necesita en `acciones.sismo` el municipio por su código INE (`ine`, de `fem emplazamiento`: de él salen la aceleración básica `ab` y `K` del anejo 1 de la norma; escritos, mandan), el `terreno` (`"I"`…`"IV"`, su C o sus estratos) y la ductilidad `mu` (1 a 4; `{ "x": …, "y": … }` si no es la misma): **pregúntalos, no los saques de memoria**; opcionales, `importancia` (`"especial"`), `omega` (5 %), `regla` (`"cqc"`), `excentricidad` (0,05) y `sistema`. Con ellos hay cuatro casos más, `EX+e`, `EX-e`, `EY+e` y `EY-e` (no se escriben ni llevan cargas: cada resultado es la combinación de todos los modos, con la excentricidad accidental a un lado o al otro), que entran solos en las combinaciones sísmicas (`--situacion ELU-SIS`, y por defecto en los esfuerzos) con su ± y el 30 % de la otra dirección, y valen en `--caso EX+e` y en `--combinacion "G+0.3*Q+EX+e-0.3*EY-e"`. No depende de las combinaciones |
| `combinaciones` | Las combinaciones en uso, con sus factores |

**Combinaciones:**
- Por defecto, ELU para los esfuerzos, ELS característica para los desplazamientos y los casos sueltos para la consulta de reacciones (su dibujo, `fem render --vista reacciones`, en la ELS característica).
- Para cambiarlas: `--casos`, `--situacion ELU-PT,ELS-C`, `--combinacion "1.35*G+1.5*Q"` (repetible) o `--caso G`.
- `--estaciones` necesita una sola combinación.

**Signos:**
- Esfuerzos [N, Vy, Vz, T, My, Mz] en los ejes locales de la pieza. N > 0 es tracción.
- En una viga, My > 0 tracciona la cara inferior (momento de vano).
- Las flechas son positivas hacia abajo.
- Las estaciones `s` se miden en m desde el primer punto de la viga, desde la base del pilar o desde el inicio de la barra.

## Cuándo pararte

- Si `validar` sigue dando el mismo error tras dos intentos, relee el mensaje y la descripción del campo en el esquema. Si sigue sin estar claro, pregunta.
- Si el equilibrio de un caso (`calcular` → `casos[].equilibrio`) pasa de 1e-9, o aparece un `motor/…` o un `compilador/error-interno`, es un fallo del programa: para y avisa.
