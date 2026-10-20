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
   - Si faltan, deja los casos sin `accion`: las consultas irán por caso, sin combinaciones.
   - No te inventes cargas que no te han dado.
3. **No decides por el ingeniero.** Si la descripción es ambigua (una luz, una sección, un apoyo), pregunta o dilo; no elijas en silencio. Las opciones de compilación por defecto (`opciones`) ya están decididas: no las cambies si no te lo piden. Si te lo piden («sin modificadores de rigidez», «malla de 1 m»), búscalas en el esquema: `"modificadores": {}` quita los de por defecto.
4. **Ningún resultado vale si `ok` no es `true`.** Los errores se corrigen en el fichero, por el `id` que nombra cada diagnóstico. Los avisos se leen todos y se explican al usuario si afectan al modelo.
5. **Ningún resultado se da por bueno sin `fem revisar`.** Sus avisos de sensatez (`sensatez/…`) se corrigen si son un error del modelo o se explican al usuario si son legítimos. Nunca los silencies cambiando el modelo para que desaparezcan.
6. **Nunca ejecutas `fem firmar`.** Firmar es del ingeniero, después de leer el informe. Tú le dices dónde está el informe y qué avisos tiene.
7. **Un número nunca se lee de una imagen.** Las figuras de `fem render` sirven para ver el modelo y encontrar lo raro. El valor que cites sale del JSON de `render` (`extremos`) o de una consulta.

## Flujo

```bash
fem esquema                                  # ruta del JSON Schema (descripciones = convenios)
fem validar proyecto.json                    # esquema + compilación; corrige hasta ok: true
fem resumen proyecto.json                    # comprueba el modelo: plantas, piezas, cargas por planta y caso
fem calcular proyecto.json                   # calcula (o reutiliza los resultados de la misma huella)
fem consultar proyecto.json <consulta> …     # resultados acotados
fem render proyecto.json [--vista V] [--planta P]   # PNG y SVG de cada planta, para mirarlos
fem revisar proyecto.json                    # sensatez e informe de revisión (Markdown y HTML) de esta huella
```

- `fem` es `bun "<repo>/cli/fem.ts"`; dentro del repo, también `bun run fem`.
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

Son avisos de orden de magnitud, no comprobaciones de norma. Escribe el informe en `.fem/<huella>/informe.md` e `informe.html`, y dice si esa huella está firmada (`firma`). Un aviso legítimo (una transición, un voladizo) se explica; uno que delata un error del modelo, se corrige en el fichero.

### Render

`fem render` dibuja cada planta vista desde arriba (X a la derecha, Y hacia arriba). Escribe un PNG (de 1568 px de lado como mucho, para mirarlo con tu herramienta de lectura de imágenes) y un SVG por planta y vista en `.fem/<huella>/render/`, y devuelve la lista en `figuras`, con la carpeta en `carpeta`.

| Vista | Qué dibuja |
|---|---|
| `modelo` (por defecto) | Losas (sus huecos, con aspa), paños con la dirección de sus viguetas, vigas con su ancho, pilares con su sección orientada (rellenos los que llegan desde abajo; en blanco los que arrancan), muros con sus huecos del piso de debajo, apoyos y bandas, con sus ids; los ejes de replanteo con sus burbujas y las cotas entre ellos |
| `cargas` | Las cargas de cada caso (`--caso C` para uno) en la planta, con su valor |
| `diagnosticos` | Una marca numerada en cada objeto con un error o un aviso, con la lista al lado |
| `malla` | Láminas y barras de la planta |
| `uz`, `m11`, `m22`, `m12`, `v13`, `v23` | Isovalores en las losas, en la combinación que gobierna en la planta, con las isolíneas rotuladas con su valor (la del 0, más gruesa) |
| `f11`, `f22`, `f12` | Fuerzas de membrana de las losas (kN/m, tracción positiva). En una planta con diafragma rígido son nulas (las lleva el diafragma): el mapa sale de una sola banda y lo dice |
| `vigas-my`, `vigas-vz` | Diagramas envolventes de vigas y viguetas, con el máximo y el mínimo de cada vano |
| `pilares-n` | Axil de cada pilar que llega a la planta |
| `reacciones` | Reacciones de los pilares y muros que arrancan de la planta y de sus apoyos: Fz rotulada y (Fx, Fy) a escala; por defecto, cada objeto en el caso de su mayor \|Fz\| (como `consultar reacciones`) |
| `armado-x-inf`, `armado-x-sup`, `armado-y-inf`, `armado-y-sup` | Las franjas de armado de las losas, coloreadas por tramos según la demanda de Wood–Armer (kN·m/m) de su armadura inferior o superior en X (el eje 1 de cada losa) o en Y, de `consultar franja`; rotulados, los picos de cada franja. Con la armadura base del proyecto, lo cubierto en gris y las zonas de refuerzo con su máximo y el exceso |
| `bandas` | Las bandas de dimensionado del proyecto (si las tiene) con su My en cada estación, de `consultar banda` |

- `--vista` y `--planta` admiten varias, separadas por comas o repetidas; sin `--planta`, todas.
- `modelo`, `cargas` y `diagnosticos` se dibujan aunque el modelo no compile: así se ve dónde está el error.
- Todas las vistas llevan los ejes de replanteo (los de `ejes` o, sin ellos, los propuestos con las alineaciones de los pilares): úsalos para comprobar que cada pilar está en su eje.
- Las combinaciones son las de `consultar`; sin acciones en los casos, la suma de los gravitatorios (×1 en uz y ×1,4 en los esfuerzos). Con `--caso` y `--combinacion`, como en las consultas.
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
bun run visor proyecto.json            # escribe una URL local (127.0.0.1) que abre la app sobre ese fichero
bun run visor nuevo.json --nuevo       # crea un proyecto con la plantilla y lo abre
```

La app vigila el fichero: cada vez que lo editas, se recarga sola (o usa lo que dejó `fem calcular` en `.fem/`). El ingeniero también puede editar y guardar el mismo `proyecto.json` desde ella, así que:

- **Lee el fichero justo antes de cambiarlo**, nunca de memoria: puede que el ingeniero lo haya guardado desde la app.
- Si cambias el fichero mientras él tiene cambios sin guardar, la app no pisa nada: le avisa y elige él. Díselo cuando cambies algo que podría estar editando.
- Al guardar, la app escribe el fichero en su formato canónico (2 espacios y las claves en el orden de los tipos). El contenido y la huella no cambian.
- Las losas macizas y reticulares se arman con **franjas** de ancho fijo (1 m, o el intereje en un reticular) que cubren toda la losa en sus dos direcciones (X, el `eje1` de la losa, e Y). No se escriben: salen solas de la losa, y sus esfuerzos, de `consultar franjas` y `consultar franja`. La app ya no propone ni edita bandas; las `bandas` del proyecto, si las hay, son cortes de comprobación tuyos: no las quites ni las cambies sin que el ingeniero lo pida.
- La **armadura base** (`armado` del proyecto, fuera del `modelo`: no cambia la huella ni obliga a recalcular) es el momento en kN·m/m que cubre la armadura base de cada losa: `{ "base": { "x-sup": 20 }, "losas": { "<losa>": { "x-inf": 15 } } }` (la de la losa manda sobre la común; las armaduras son `x-inf`, `x-sup`, `y-inf` e `y-sup`). Es una decisión del ingeniero: léela y úsala, pero no la pongas ni la cambies si no te la da.

La app no firma. Tú no la necesitas: tus números salen de la CLI.

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
- **`id` únicos en todo el modelo** (plantas, materiales, secciones, piezas, casos y cargas).
- **Pilares:** se sitúan con `x`, `y`, `desde` (la planta de su base) y `hasta` (la de su cabeza). Una sección rectangular lleva `b` y `h`; el canto `h` va según X con `giro` 0. Si la sección cambia en altura, `tramos` da la de cada tramo por la planta de su cabeza.
- **Secciones y materiales dados por sus propiedades:**
  - Una sección `general` lleva A, Iy, Iz y J. Iy es la de My: en una viga, la flexión vertical; en un pilar, la del plano de su canto (el XZ con giro 0).
  - Un material `general` lleva E y G en kN/m² y su peso.
- **Vigas:** se dibujan con `puntos` en planta sobre su eje y con su planta. Se conectan solas a los pilares y a otras vigas que tocan (tolerancia de 5 cm, con aviso).
- **Losas y paños:** su contorno es un polígono simple y no repite el primer punto.
  - **Se dibujan a ejes:** el borde que apoya en una viga va sobre el eje de la viga.
  - **Todo borde de forjado lleva su zuncho** (viga de atado, de 20 a 40 cm de ancho; lo normal, 30, con el canto del forjado). No lo olvides aunque el plano de arquitectura no lo dibuje: pregunta su ancho y su canto. Donde el borde tiene pilares, el zuncho va por su eje (enrasado por fuera quedaría a pocos cm de sus caras y ensucia la malla); donde no, enrasado por fuera. Las cargas por m² de la banda entre el eje del zuncho y el borde real (y el peto) van como carga de viga sobre él. `fem validar` avisa (`sensatez/borde-sin-viga`) de cada tramo de borde sin viga, muro, apoyo lineal u otro forjado debajo.
  - El peso propio de una losa maciza se calcula solo (γ·espesor).
  - Un paño unidireccional necesita su `pp`, y un reticular, el `pp` (casetón perdido por defecto).
- **Muros:** verticales, de `desde` a `hasta`, sobre su eje en planta. Un muro cerrado (un núcleo) repite el primer punto al final.
- **Ejes de replanteo** (`ejes`, opcional): `id` (lo que dicen sus burbujas: «A», «1»), `nombre` si las burbujas tienen que decir otra cosa, y `desde` y `hasta` en planta. Son sólo del dibujo: no entran en el cálculo ni cambian la huella. Sin `ejes`, el dibujo usa los propuestos (números según la dirección de las losas, letras en la perpendicular). Pon los del plano si te los dan; si no, no los inventes.
- **Casos:** como mucho uno con `pesoPropio: true`.
  - Con `accion` en **todos** los casos, las consultas usan las combinaciones CTE/NCSE.
  - `accion` lleva: `tipo` G, Q, W, S, E…; `psi` por su nombre (`"uso-A"`, `"viento"`…, ver reglas) o como `{ psi0, psi1, psi2 }` si te dan los valores; y, en W y E, `direccion` y `signo`.
- **Cargas:**
  - `superficie`: sobre una `losa`, un `pano` o una `zona` (polígono) de su planta.
  - `lineal`: polilínea sobre una losa o el eje de un muro.
  - `puntual`: `F` y `M` en ejes globales, en un punto de una planta.
  - `viga` y `pilar`: repartidas a lo largo de la pieza; sin `desde` ni `hasta`, en toda ella. Es la forma de dar el viento sobre los pilares de una fachada.
  - `empuje`: sobre un muro.

  Lo que cae fuera de las losas no carga, y lo avisa.

## Consultas

| Consulta | Da |
|---|---|
| `envolventes [--tipo pilar\|viga\|vigueta] [--planta P]` | Por tipo de pieza y planta: máximos y mínimos de N, Vz y My (y Vy y Mz en pilares), con la pieza, la estación y la combinación |
| `flechas [--losa L]` | Por losa o paño: la flecha máxima absoluta y la relativa a las esquinas del recuadro o a los extremos de la vigueta |
| `deriva [--planta P]` | Por planta: el mayor desplome relativo (d/h) con su pilar, y el desplazamiento del maestro del diafragma |
| `reacciones [--objeto id] [--top N \| --todos]` | Totales por caso (ΣF y ΣM respecto al origen) y los apoyos con más carga |
| `pieza <id> [--estaciones]` | Una viga o vigueta, por vanos (de cara a cara de apoyo); o un pilar, por tramos (base y cabeza, con los esfuerzos concomitantes) |
| `franjas [--losa L \| --planta P]` | Las franjas de armado de las losas (ids `<losa>:X<i>` y `<losa>:Y<i>`), con su mayor demanda de Wood–Armer inferior y superior (kN·m/m), dónde está y su combinación |
| `franja <id>` | Una franja, estación a estación (caras de pilares y líneas de apoyo exactas; cada 0,25 m por campos): mx máximo y mínimo y Wood–Armer inferior y superior por metro |
| `refuerzos --armadura x-inf\|x-sup\|y-inf\|y-sup [--losa L \| --planta P]` | Las zonas de refuerzo: lo que supera la armadura base del proyecto, conexo, con sus franjas, su extensión (s, t, longitud, área, caja), su máximo con el exceso y su combinación; y las losas sin base. La extensión es la de las estaciones (±0,125 m), sin anclajes ni solapes |
| `banda <id>` | My máximo y mínimo en cada estación de una banda del proyecto (caras y vanos) |
| `combinaciones` | Las combinaciones en uso, con sus factores |

**Combinaciones:**
- Por defecto, ELU para los esfuerzos, ELS característica para los desplazamientos y los casos sueltos para las reacciones.
- Para cambiarlas: `--casos`, `--situacion ELU-PT,ELS-C`, `--combinacion "1.35*G+1.5*Q"` (repetible) o `--caso G`.
- `--estaciones` necesita una sola combinación.

**Signos:**
- Esfuerzos [N, Vy, Vz, T, My, Mz] en los ejes locales de la pieza. N > 0 es tracción.
- En una viga, My > 0 tracciona la cara inferior (momento de vano).
- Las flechas son positivas hacia abajo.
- Las estaciones `s` se miden en m desde el primer punto de la viga o desde la base del pilar.

## Cuándo pararte

- Si `validar` sigue dando el mismo error tras dos intentos, relee el mensaje y la descripción del campo en el esquema. Si sigue sin estar claro, pregunta.
- Si el equilibrio de un caso (`calcular` → `casos[].equilibrio`) pasa de 1e-9, o aparece un `motor/…` o un `compilador/error-interno`, es un fallo del programa: para y avisa.
