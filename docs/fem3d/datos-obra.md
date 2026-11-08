# DO: los datos de la obra en una pantalla (plan)

> **Fecha:** 2026-11-08. **Estado:** propuesta, sin decidir (§6).
>
> **Origen:** el usuario, con capturas de los «Datos generales» de CYPECAD (2026-11-08): «nosotros todavía no tenemos nada de esto, pero cosas como municipio, nombre proyecto y descripción, e información necesaria de configurar podrían estar en una pantalla inicial como esta, o ver si nos interesa y es más cómodo o no». Lo que se propone: una pantalla con los datos que decide la obra y no el dibujo, que sea el primer paso de una obra nueva y que se pueda abrir después. Sólo lo que cambia el cálculo FEM o lo que hace falta para modelar; lo que es de las comprobaciones se queda para Concreta (§3.7).

## 1. Lo que hay hoy

Repaso del código del 2026-11-08.

### 1.1 Obra nueva

- **La plantilla** (`src/editor/plantilla.ts`, `proyectoNuevo`): plantas `N1` y `Cim` (3 m), el material `HA-30`, ninguna sección, y los casos G (peso propio), CM y Q (uso-A). Sin `acciones` ni `opciones`.
- **En la app** (`app/src/Inicio.tsx`, `crearNuevo`): la ficha «Proyecto nuevo» pide un nombre en la misma ficha, crea el proyecto y abre el gestor de plantas en su modo de inicio (`GestorPlantas`, `inicio`: cuántas plantas sobre la cimentación, la primera y las demás, con el alzado esquemático). No se puede cerrar con un clic fuera.
- **Con `fem visor --nuevo`** (`app/visor.ts`, y el MCP), el proyecto se crea igual pero el gestor de plantas **no** se abre: sólo `Inicio.tsx` lo pide.

### 1.2 Dónde está cada dato

| Dato | Dónde se guarda | Dónde se escribe en la app |
|---|---|---|
| Nombre y descripción | `nombre`, `descripcion` del `proyecto.json` (fuera de la huella) | Sección «Proyecto» del navegador de Modelo y de Cargas (`DatosProyecto`, operación `datos`). El nombre sale en la barra de título, en la pestaña y en «Mis proyectos» |
| Emplazamiento | `modelo.acciones.emplazamiento` (provincia, ine, municipio, altitud) | Cabecera común de la ficha «Viento, nieve y sismo» (`FichaAcciones`), que sólo se abre desde los botones Viento, Nieve y Sismo de la barra de **Cargas** |
| Viento, nieve, sismo | `modelo.acciones.viento`, `.nieve`, `.sismo` | Pestañas de esa ficha (operación `acciones`) |
| Plantas | `modelo.plantas` | Gestor de plantas (barra de Modelo, primer botón) |
| Materiales | `modelo.materiales` | Gestor de materiales; los típicos (HA-25…HA-50, S235, S275, S355) se crean con la sección que los usa |
| Material de lo nuevo | En ningún sitio | Lo deduce el código: `materialPropuesto` (`src/editor/gestores.ts`), el más usado de su familia, y si no, el primero o el típico (HA-30, S275); `materialPorDefecto` (`app/src/dibujo/Plantilla.tsx`), el más usado de todos, para forjados y muros |
| Casos | `modelo.casos` | Gestor de casos (barra de Cargas) |
| Opciones de cálculo | `opciones` del `proyecto.json` | Ninguno: la app sólo las lee |

### 1.3 Lo que falla

- **Los datos de la obra están repartidos.** El emplazamiento sólo se encuentra desde Cargas, aunque decide el viento, el sismo y la nieve; el nombre, en el navegador.
- **El material de lo nuevo no se elige:** sale del «más usado». En una obra nueva, el primer pilar va con HA-30 aunque la obra sea de HA-25, y hay que cambiarlo pieza a pieza o sección a sección.
- **Una obra nueva no pregunta nada de la obra:** sólo las plantas. El emplazamiento se acuerda uno cuando va a meter el viento.

## 2. Los «Datos generales» de CYPECAD

Lo que pide CYPECAD al empezar una obra (capturas del usuario), y a quién le toca aquí:

| Dato de CYPECAD | ¿Cambia el cálculo FEM? | Aquí |
|---|---|---|
| Clave y descripción | No | **Pantalla** (nombre y descripción, ya en el fichero) |
| Normas (CTE – Código Estructural) | Sí (combinaciones, Ecm) | Fija: no hay otra. Se dice, no se elige |
| Hormigón de forjados, cimentación, pilares y muros | Sí (E, γ) | **Pantalla** (materiales de la obra, §3.2). Cimentación, cuando haya cimentación (CB-a) |
| Acero de barras y pernos, árido | No | Concreta (comprobación) |
| Acero de perfiles laminados y conformados | Sí (E, γ de las barras de acero) | **Pantalla**: el acero de perfiles |
| Madera, aluminio | Sí, si hubiera piezas de esos materiales | Fuera: el motor no tiene piezas de madera ni de aluminio con su norma |
| Con acción de viento, con acción sísmica | Sí | **Pantalla**: casillas con su resumen, que llevan a la ficha que ya existe |
| Criterio de armado por ductilidad | No (es armado) | Concreta. La ductilidad μ del espectro sí está, en la ficha del sismo |
| Elementos constructivos | No | Fuera |
| Resistencia al fuego | No | Concreta (módulo de incendio) |
| Estados límite (combinaciones), cota de nieve | Sí | Salen solas del CTE y la NCSE-02 (`src/combinaciones/`); la cota de nieve, de la altitud del emplazamiento. **Pantalla**: el resumen de los casos, con el acceso al gestor |
| Hipótesis adicionales (cargas especiales) | Sí | Ya son casos: gestor de casos |
| Coeficientes de pandeo β | No (es comprobación) | Concreta. Pero ver el P-Δ en `viento-sismo.md` §9: β = 1 sólo vale con el segundo orden global en los esfuerzos |
| Ambiente de las vigas (fisura) | No | Concreta |

Lo que CYPECAD hace distinto: **el material va por tipo de elemento, no por sección**. Cambiar el hormigón de los pilares en los datos generales cambia todos los pilares. Aquí cada sección, losa y muro lleva su material (el modelo físico es así desde C1, y permite un pilar de hormigón abajo y de acero arriba). La pantalla no cambia eso: da el material **por defecto** de cada tipo, y ofrece cambiar lo existente (§3.2).

## 3. Qué se propone

### 3.1 La pantalla «Datos de la obra»

Un diálogo amplio, de una sola página con bloques (no un asistente de pasos), con «Aplicar» en un paso de deshacer y la pregunta antes de tirar lo escrito, como los gestores (D-19):

1. **Proyecto:** nombre y descripción (lo de `DatosProyecto`, que sale del navegador o queda como resumen con el acceso, DO-g); el uso del edificio, si se decide (DO-b).
2. **Emplazamiento:** provincia, municipio (el buscador de la ficha de acciones) y altitud, y a su lado lo que sale de ellos al momento: la zona eólica y qb, ab y K, la zona de clima invernal y sk. Es el mismo componente que la cabecera de `FichaAcciones` (se saca a `CampoEmplazamiento`), y escribe lo mismo (`acciones.emplazamiento`).
3. **Materiales de la obra** (§3.2): el hormigón de forjados y vigas, el de pilares y el de muros, y el acero de perfiles, con los desplegables de material (con «Nuevo material…»).
4. **Acciones:** «Con viento», «Con sismo» y «Con nieve», cada una con su resumen en cifras («Zona B, IV · 8 casos», «ab 0,11 g · μ 2 · 4 casos») y «Configurar…», que abre la ficha de acciones en su pestaña. Desmarcar una quita su bloque de `acciones` (preguntando, si tenía datos).
5. **Plantas:** el resumen («4 plantas sobre la cimentación, 3,00 m; ±0,00 en la cimentación») y «Plantas…».
6. **Casos:** el resumen («G, CM, Q uso A») y «Casos…».
7. **Normas:** una línea, sin elegir: «CTE DB SE-AE, Código Estructural y NCSE-02».

Lo que la pantalla no hace: dibujar ni calcular. Los bloques 4 a 6 son resúmenes con acceso, para no duplicar las fichas y gestores que ya existen.

### 3.2 Los materiales por defecto

- **En el fichero:** `obra.materiales` del `proyecto.json`, fuera del modelo y de la huella (como `armado` y `vistas`): `{ forjados?, pilares?, muros?, perfiles? }`, cada uno el id de un material del modelo. Sólo deciden el material de lo que se cree; no cambian el cálculo.
- **Quién los usa:** `materialPropuesto` y `materialPorDefecto` miran primero el de su tipo (el pilar, la sección de pilar; la viga y el forjado, `forjados`; el muro, `muros`; la sección de acero, `perfiles`) y, si no hay, siguen como hoy. Así un proyecto sin `obra` se comporta igual que ahora.
- **Elegir un típico que no está** (HA-25 en una obra que sólo tiene HA-30) lo crea en el mismo paso, como `asegurarMaterial`.
- **Cambiar uno con piezas ya hechas** (DO-c): la pantalla dice cuántas piezas de ese tipo llevan el anterior y ofrece «Cambiar también las N existentes». Como el material va en la sección, y una sección puede ser de pilares y vigas a la vez, se hace con una operación pura (`cambiarMaterialObra`, en `src/editor/`): las secciones que sólo usan piezas de ese tipo cambian de material; las compartidas se duplican con el material nuevo (id según `idSeccion`, que no choque) y las piezas de ese tipo pasan a la copia; las losas y muros cambian directamente. Un paso de deshacer, con el recuento de lo que cambia.
- **Proyecto nuevo:** `proyectoNuevo` deja `obra.materiales` con el HA-30 que ya trae en los tres de hormigón, para que la pantalla los enseñe elegidos.

### 3.3 Obra nueva

1. «Proyecto nuevo» → el nombre (como hoy).
2. **Datos de la obra**, con «Siguiente: plantas» en lugar de «Aplicar» y «Más tarde», que salta el paso (DO-f). Todo es opcional: con el nombre basta.
3. El gestor de plantas en su modo de inicio (como hoy).
4. A dibujar.

Con `fem visor --nuevo` (y el MCP) se abre la misma secuencia: hoy no abre ni el gestor de plantas. El servidor lo pide con un parámetro de la URL (`?nuevo=1`) que la app lee al abrir.

### 3.4 Dónde se abre después

- **Barra de Modelo:** un botón «Obra», el primero, antes de Plantas, Materiales y Secciones (el orden de meter un edificio, 2026-10-28).
- **Un clic en el nombre del proyecto** de la barra de título.
- **La paleta** (Ctrl+K): «Datos de la obra».
- **Los botones Viento, Nieve y Sismo de Cargas** siguen abriendo la ficha de acciones, que sigue teniendo el emplazamiento arriba: es el mismo dato con el mismo componente, editable desde los dos sitios (DO-d).

### 3.5 El agente y la CLI

- `obra` entra en el esquema del proyecto (`bun run esquema`) y en el validador: un material que no existe es error (`obra/material-inexistente`), como cualquier referencia rota del editor.
- El MCP edita la obra con la operación `obra` del editor, como las demás.
- La skill: en la lista de datos del encargo (MA1), los materiales por tipo de elemento van con el emplazamiento, y el agente escribe `obra.materiales` en lugar de deducirlos.
- `fem resumen` dice el emplazamiento y los materiales de la obra.

### 3.6 Textos

Los de la app no nombran ningún programa comercial (como siempre). La línea de normas dice las normas, no «como …».

### 3.7 Lo que no va, y por qué

El árido, los aceros de armar y de pernos, la clase de exposición y el ambiente, la resistencia al fuego, el criterio de ductilidad y los coeficientes de pandeo **no cambian ni un número del cálculo FEM**: son de los módulos de comprobación de Concreta, que ya tienen su sitio (`features/materiales`, `features/incendio`…). Ponerlos aquí sería mantenerlos dos veces y que no casaran al integrarse. Tampoco las opciones de cálculo (`opciones`: zona rígida, unión losa–viga, plano del forjado…), que tienen sus valores decididos y sus hipótesis en el informe (DO-e).

### 3.8 Para la integración con Concreta

La obra de Concreta (`lib/obra`, `concreta-obra`) tiene cinco campos: `denominacion`, `municipio`, `provincia`, `altitud` y `uso`. Casan con `nombre`, `acciones.emplazamiento` (`municipio`, `provincia`, `altitud`) y, si se decide, `obra.uso`. Los materiales de Concreta (`PubMateriales`) van por elemento con su fck: al integrarse, `obra.materiales` se puede rellenar desde ellos. Nada de esto se importa ahora (regla de independencia); los nombres de los campos se eligen para que el paso sea directo.

## 4. Tramos

| Tramo | Qué | Depende de |
|---|---|---|
| **DO1** | Puro: `obra` en el proyecto (esquema, validador, formato canónico), la operación `obra`, `materialPropuesto` y `materialPorDefecto` con el de su tipo, `cambiarMaterialObra`, `proyectoNuevo` con los materiales de la obra, `fem resumen` y la skill | — |
| **DO2** | La app: la pantalla, `CampoEmplazamiento` compartido con la ficha de acciones, la secuencia de obra nueva (también con `--nuevo`), el botón «Obra», el clic en el nombre y la paleta | DO1 |

## 5. Criterios de paso

1. **Sin cambios para lo de antes:** un proyecto sin `obra` se abre, se edita y se guarda con los mismos bytes; la huella no cambia al tocar sólo `nombre`, `descripcion` u `obra`.
2. **Los materiales por defecto mandan:** con `obra.materiales.pilares = "HA-25"`, un pilar dibujado y una sección de pilar nueva van con HA-25 aunque el más usado sea HA-30 (vitest, puro y en el DOM).
3. **Cambiar lo existente:** `cambiarMaterialObra` en las seis referencias de A2/A3 deja sin tocar las piezas de los otros tipos (comparadas campo a campo), duplica sólo las secciones compartidas, y deshacer da los bytes de partida.
4. **El emplazamiento, un solo dato:** escrito desde la pantalla o desde la ficha de acciones, el fichero sale byte a byte igual.
5. **Obra nueva:** desde «Mis proyectos» y desde `fem visor --nuevo`, nombre → datos de la obra → plantas, y con «Más tarde» se llega a las plantas sin escribir nada más (prueba de DOM y banco de Chrome).
6. **La puerta de uso del usuario:** empezar una obra suya desde cero con la pantalla.

## 6. Decisiones del usuario

Con la recomendación de Claude:

- **DO-a, la forma:** un diálogo de una página con bloques (recomendado), o un asistente de pasos, o un espacio de trabajo propio. El diálogo es lo que se reabre cómodo; el asistente sólo sirve la primera vez.
- **DO-b, el uso del edificio** (texto libre o la categoría de uso del DB SE-AE): recomendado **sí, como categoría**, fuera de la huella, para que el gestor de casos proponga el ψ de la Q de la obra (hoy siempre uso-A) y para casar con `uso` de Concreta.
- **DO-c, cambiar el material por defecto con piezas ya hechas:** sólo para lo nuevo, u ofrecer cambiar también lo existente (§3.2). Recomendado **ofrecerlo**, siempre preguntando y con el recuento: es lo que el usuario espera viniendo de CYPECAD, y sin ello cambiar el hormigón de una obra es ir sección a sección.
- **DO-d, el emplazamiento en dos sitios:** editable en la pantalla y en la ficha de acciones (recomendado: el mismo componente), o sólo en la pantalla con un resumen en la ficha.
- **DO-e, las opciones de cálculo en la pantalla:** recomendado **no** por ahora. Si se quiere, un enlace a «Supuestos del cálculo», de sólo lectura.
- **DO-f, el paso en una obra nueva:** recomendado **saltable** («Más tarde»), con todo opcional salvo el nombre.
- **DO-g, nombre y descripción en el navegador:** quitarlos de allí y dejar sólo un resumen de la obra con el acceso a la pantalla (recomendado), o mantenerlos en los dos sitios.
- **DO-h, los tipos de elemento:** forjados y vigas juntos, pilares, muros y acero de perfiles (recomendado, como los datos generales de CYPECAD sin la cimentación, que no hay todavía). La alternativa es separar vigas de forjados.
