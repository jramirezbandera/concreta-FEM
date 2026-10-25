# GE: crear secciones, materiales y demás listas sin ir a las tablas (plan)

> **Fecha:** 2026-10-25. **Estado:** decidido por el usuario el 2026-10-25 (§6.1). **GE1 hecho el 2026-10-25** (§7); GE2 y GE3, por hacer.
>
> **Origen:** el usuario, al dibujar un pilar en un proyecto nuevo (captura del 2026-10-25): «crear una sección o material es horrible, tienes que hacerlo por tablas». Pide ventanas contextuales que creen los casos típicos, como en CYPECAD o SAP2000, y que el desplegable «sección» tenga «Crear nueva…» y lleve a ese menú. «Todo este tipo de cosas tenemos que revisarlas»: el plan repasa todos los campos que eligen un objeto de otra lista, no sólo la sección.

## 1. Lo que hay hoy

Repaso del código del 2026-10-25.

### 1.1 Dónde se elige un objeto de otra lista

| Campo | Dónde aparece | Cómo se crea lo que se elige |
|---|---|---|
| **sección** de pilares y vigas | Tabla, inspector y plantilla de Pilar y de Viga | Tabla Secciones. En la plantilla, un «+» que sólo crea una rectangular de hormigón (b × h en cm) con el primer hormigón del proyecto |
| **vigueta** de un unidireccional | Tabla e inspector de Forjados | Tabla Secciones |
| **material** de secciones, forjados y muros | Tabla e inspector | Tabla Materiales |
| **caso** de una carga y **deriva de** de un caso | Tabla e inspector de Cargas y Casos | Tabla Casos |
| **planta** (desde, hasta, planta) | Tabla, inspector, plantilla de Pilar y carril de plantas | Tabla Plantas |

Las listas salen de `ids(...)` y `opcionesPlantas` en `src/editor/tablas.ts`. La hoja las da como desplegable (`app/src/editor/Hoja.tsx`) y el inspector como `<select>` (`app/src/editor/Formulario.tsx`). Ninguno de los dos crea nada.

### 1.2 Lo que falla

- **No se puede crear desde donde se elige.** Ni el inspector ni la hoja tienen «Nueva…». La plantilla de dibujo sí, pero sólo rectangulares de hormigón.
- **El desplegable sólo dice el id.** «P30x30» se entiende; «S1» o «HEB» no. No dice forma, medidas ni material.
- **Formas que no se pueden crear en la app:**
  - los perfiles I y H existen en el modelo (`forma: "I"` con `PerfilCatalogo`), pero sólo se pueden escribir en el JSON (la ayuda de la tabla lo dice);
  - no hay catálogo: hay que teclear A, Iy, Iz, It, h, b, tf y tw.
- **Los materiales, sólo por tabla,** con columnas que no aplican a cada tipo (fck, E acero, E y G general, ν, γ) y sin ver el E que resulta del fck (CY-a).
- **No hay sitio para ver una sección:** no se ve su dibujo, sus propiedades (A, Iy, Iz, J), quién la usa ni qué pasa si se cambia.
- **Casos y plantas,** también sólo por tabla. Las hipótesis típicas (G, Q de uso, viento ±X ±Y, sismo X e Y) hay que escribirlas una a una con su acción, ψ, dirección y signo.

### 1.3 Lo que ya sirve

- `Dialogo` (`app/src/editor/Dialogos.tsx`): modal con cabecera, cuerpo y pie, que ya usan Borrar, Copiar a plantas, Renumerar, Ábacos y Vigas de borde.
- `DialogoBorrar` ya resuelve borrar algo que se usa (en cascada o reasignando).
- Las operaciones del editor (`crear`, `cambiar` con renombrado, `lote`) validan contra el esquema y se deshacen en un paso.
- `seccion3D.ts` da las propiedades de cada forma, y `medidasSeccion` la huella.
- Concreta tiene el catálogo de perfiles IPE, HEA, HEB e IPN de ArcelorMittal, con su historial de cotejos (`../Concreta EST/concreta-v2/src/data/steelProfiles.ts`). Se copia citando el fichero, como dice la regla de independencia.

## 2. Cómo lo hacen CYPECAD y SAP2000

- **SAP2000:** «Define > Section Properties > Frame Sections» abre un gestor. A la izquierda va la lista y a la derecha «Add New», «Modify», «Copy» y «Delete». «Add New» pregunta primero el tipo (hormigón rectangular, circular o en T; acero I, tubo o de catálogo; «general») y luego da un formulario con el dibujo de la sección y «Section Properties». Los materiales siguen el mismo patrón, con «Add New Material» por región, norma y grado (C30/37…). En los diálogos de asignación, junto al desplegable, está el acceso al gestor.
- **CYPECAD:** al introducir un pilar o una viga, el diálogo de la pieza actual pide el tipo (hormigón rectangular o circular; metálica con su serie y perfil de la biblioteca) y las dimensiones, y lo que se crea se queda como «actual» para las siguientes. Los materiales (HA-25, HA-30…, B 500 S, S275) se eligen de una lista en los datos generales de la obra, no se definen.

Lo común: **primero el tipo, luego un formulario corto con el dibujo**, catálogo para el acero y un gestor de la lista con nueva, duplicar, cambiar y borrar.

## 3. Qué se propone

### 3.1 «Nueva…» y «Editar…» en todos los desplegables de referencia

- Al final de cada desplegable que elige de otra lista, una línea separada: **«Nueva sección…»** (o material, caso, planta). Esto vale para el inspector, la hoja y la plantilla de dibujo.
- Abre el diálogo de §3.2 o §3.3 con el tipo que sugiere el campo: en un pilar, rectangular de hormigón 30 × 30; en una viga, 30 × 50; en la vigueta de un unidireccional, la T.
- Al crear, la nueva queda elegida en ese campo. Todo es un solo paso de deshacer: crear y asignar van en un `lote`.
- Con algo elegido, también **«Editar “P30x30”…»**, que abre el gestor sobre ella.
- **La línea de cada opción dice qué es:** `P30x30 · rect. 30 × 30 · HA-30`, `IPE300 · perfil I · S275`, `HA-30 · hormigón fck 30`. El valor sigue siendo el id, así que pegar desde Excel no cambia.

Para hacerlo, la columna declara qué lista referencia (`referencia: "secciones"` junto a `opciones` en `tablas.ts`, puro) y la app añade las dos líneas. No se mete ninguna acción de la interfaz en `src/editor/`.

### 3.2 Gestor de secciones

Es un diálogo que abre el botón «Secciones» de la barra (hoy abre la tabla) y «Nueva / Editar…». La tabla sigue existiendo, para editar muchas a la vez y pegar de Excel; el gestor lleva a ella con «Abrir la tabla».

- **A la izquierda, la lista:** id, descripción corta, material y cuántos objetos la usan.
- **A la derecha, la ficha de la elegida:**
  - su dibujo a escala, con los ejes locales y el canto h señalado;
  - sus datos, que se editan;
  - sus propiedades calculadas con `seccion3D`, de sólo lectura: A, Iy, Iz, J, Avy, Avz y el peso por metro;
  - **«Se usa en 24 pilares y 3 vigas»**, porque cambiarla cambia todos los objetos que la usan.
- **Botones:** Nueva, Duplicar (para variar sólo algunos objetos), Renombrar (la operación `cambiar` ya arrastra las referencias) y Borrar (`DialogoBorrar`, que ya ofrece reasignar).
- **«Nueva» pide primero el tipo,** en tarjetas con su dibujo:
  - **Hormigón:** rectangular (b × h), circular (Ø) y en T (bf, hf, bw, h);
  - **Acero:** perfil de catálogo, con la serie (IPE, HEA, HEB, IPN) y el tamaño en dos desplegables, y sus datos a la vista sin editar;
  - **General:** A, Iy, Iz y J dados, con b y h opcionales para la huella.
- **El id se propone solo** y se puede cambiar: `P30x30` y `V30x50` como hoy, `Ø40` en circular, `T60x30` en T, `IPE300` y `HEB200` en perfiles, `S<n>` en general. Si ya existe uno igual con los mismos datos, se elige ese y no se duplica.
- **El material sale del tipo:** el hormigón más usado del proyecto para hormigón y el acero para perfiles. Si no hay ninguno, se crea el típico (HA-30 o S275) y se dice en la ficha.

### 3.3 Gestor de materiales

Es el mismo patrón, desde el botón «Materiales» y desde «Nuevo material…».

- **«Nuevo» da la lista de los típicos,** con un clic:
  - hormigones HA-25, HA-30, HA-35, HA-40, HA-45 y HA-50 (fck con ν = 0,2 y γ = 25);
  - aceros S235, S275 y S355 (E = 210 000 MPa y γ = 78,5). El grado sólo da el nombre: el cálculo es elástico y el motor no lo usa;
  - general, con E, G y γ.
- **La ficha muestra lo que el motor va a usar:** el Ecm que sale del fck (CY-a), G, ν y γ. Las columnas que no aplican al tipo no aparecen.

### 3.4 Casos de carga típicos (GE2)

- «Nuevo caso…» ofrece los habituales del CTE con su acción, ψ, dirección y signo ya puestos: peso propio, cargas muertas, uso A…G, nieve, viento +X, −X, +Y y −Y, y sismo X e Y.
- Además, **«Hipótesis típicas»** crea en un paso el juego completo que se elija (por ejemplo, G + Q uso A + viento en las cuatro direcciones).

### 3.5 Plantas (GE3)

Un diálogo como la introducción de plantas de CYPECAD: añadir n plantas de altura h encima o debajo de una, con nombre y tipo, y ver la lista con sus cotas. Hoy hay que hacerlo fila a fila.

### 3.6 Lo que queda para más adelante

- **Biblioteca de forjados:** reticulares típicos (25 + 5 con intereje 80 y nervio 12…) y viguetas del unidireccional. Toca `reticular.ts` y la decisión D3/CY-c, así que va en su propia fase.
- **Tubos, cajones y UPN:** son formas nuevas en `seccion3D`, cada una con su oráculo (regla de oro 1), y también van en su propia fase.

## 4. Tramos

| Tramo | Qué | Por qué en ese orden |
|---|---|---|
| **GE1** | §3.1 en sección y material, y §3.2 y §3.3 (con el catálogo de perfiles) | Es lo que bloquea hoy dibujar un proyecto desde cero |
| **GE2** | §3.1 en casos y §3.4 | Las cargas de V2c-2 necesitan elegir un caso |
| **GE3** | §3.1 en plantas y §3.5 | El carril de plantas ya ayuda, así que corre menos prisa |

## 5. Criterios de paso (GE1)

1. **Sin tablas:** las cinco formas (rectangular, circular, T, perfil de catálogo y general) y los tres tipos de material se crean, se cambian, se duplican, se renombran y se borran desde el gestor, y el proyecto resultante es igual al hecho con la tabla (vitest y DOM).
2. **Desde cualquier desplegable:** en el inspector, la hoja y la plantilla, «Nueva…» crea y deja elegida la sección o el material. Es un paso de deshacer, y deshacer deja el proyecto byte a byte.
3. **Catálogo exacto:** los perfiles copiados tienen los mismos A, Iy, Iz, It, h, b, tf y tw que los de Concreta (test contra una copia congelada, con el fichero de origen citado), y calcular un pórtico con `IPE300` del catálogo da los mismos bits que con el perfil escrito en el JSON.
4. **Lo mostrado es lo calculado:** las propiedades de la ficha son las de `seccion3D` bit a bit, y el Ecm, el de `hormigon(fck)`.
5. **Nada se rompe:** los bancos de I1–I4, V1, V2a, V2b y V2c, con los mismos bits, y el formato canónico del fichero sin cambios. La huella sólo cambia si cambia el modelo.
6. **Puerta de uso (del usuario):** empezar un proyecto nuevo y dibujar pilares de dos secciones de hormigón y una viga metálica sin abrir ninguna tabla.

## 6. Decisiones del usuario

| # | Decisión | Propuesta |
|---|---|---|
| **GE-a** | ¿Gestor en un diálogo modal o en el panel de Propiedades? | Diálogo modal, como SAP2000: la ficha con el dibujo y las propiedades necesita sitio, y Propiedades ya lleva la plantilla |
| **GE-b** | ¿Qué abre el botón «Secciones» de la barra? | El gestor; la tabla, desde «Abrir la tabla» dentro de él |
| **GE-c** | Ids automáticos | `P30x30`, `V30x50`, `Ø40`, `T60x30`, `IPE300`, `HEB200`, `S<n>`; materiales `HA-30` y `S275`. Si ya hay uno con los mismos datos, se reutiliza |
| **GE-d** | Catálogo de acero en GE1 | IPE, HEA, HEB e IPN copiados de Concreta. Tubos, cajones y UPN, en su propia fase con oráculo |
| **GE-e** | Materiales típicos | HA-25…HA-50 y S235, S275 y S355. Sin el grado del acero en el modelo: sólo va en el nombre |
| **GE-f** | Cambiar una sección que se usa | Se permite, como en SAP2000, diciendo cuántos objetos la usan y ofreciendo «Duplicar» al lado |
| **GE-g** | Orden frente a V2c | GE1 ya, antes de V2c-2 (losas y muros también eligen material); GE2 con las cargas de V2c-2; GE3 después |

### 6.1 Decidido por el usuario (2026-10-25)

Todas como se proponían, con dos matices:

- **GE-a:** diálogo modal.
- **GE-b:** el botón «Secciones» (y «Materiales») abre el gestor; la tabla, desde «Abrir la tabla».
- **GE-c:** ids automáticos y editables, y si ya hay una sección con los mismos datos se reutiliza. **Matiz:** la circular es `C40`, no `Ø40` (el «Ø» es incómodo de teclear y de pegar desde Excel).
- **GE-d:** IPE, HEA, HEB e IPN; tubos, cajones y UPN, en su propia fase con oráculo.
- **GE-e:** HA-25…HA-50 y S235, S275 y S355, con el grado del acero sólo en el nombre.
- **GE-f:** se permite cambiar una sección que se usa. **Matiz:** el botón dice a cuántos objetos se aplica («Aplicar a 24 pilares y 3 vigas»), con «Duplicar» al lado.
- **GE-g:** GE1 ya, antes de V2c-2; GE2 con las cargas de V2c-2; GE3 después.

## 7. GE1 hecho (2026-10-25)

### 7.1 Qué hay

- **`src/secciones/perfiles.ts`:** el catálogo IPE (18), HEA (24), HEB (24) e IPN (21), copiado de Concreta (`src/data/steelProfiles.ts`, commit 3e24851) por un script que lee sus filas tal cual, con las columnas de `PerfilCatalogo`. Está citado en `NOTICE`.
- **`src/editor/gestores.ts`** (puro):
  - ids propuestos (`idSeccion`) y textos de los desplegables (`describirSeccion`, `describirMaterial`);
  - materiales típicos y el propuesto por familia (el más usado, o el típico);
  - `crearSeccion`, `cambiarSeccion` y `crearMaterial`, que dan las operaciones (un material típico que no está se crea con la sección; una sección igual se reutiliza);
  - usos por colección (`usosDe`, `textoUsos`);
  - propiedades con `compilarSeccion` y `materialElastico`.
- **`src/editor/tablas.ts`:**
  - las seis columnas que eligen sección o material llevan `referencia`;
  - sus opciones dicen qué es cada una (`P30x30 · rect. 30 × 30 · HA-30`);
  - el valor sigue siendo el id, así que pegar de Excel no cambia.
- **En la app:**
  - `app/src/editor/Gestores.tsx`: los dos gestores, con la lista y los usos, la ficha con el dibujo a escala y los ejes locales, las propiedades del compilador, «Nueva» por tipo, Duplicar, Borrar (con `DialogoBorrar`) y «Abrir la tabla»;
  - `app/src/editor/referencia.tsx`: «Nueva…» y «Editar…» al final de cada desplegable, y el pedido que abre el gestor desde cualquier sitio;
  - el inspector, la hoja y la plantilla de Pilar y de Viga los usan: crear y asignar van en un `lote`. En la plantilla, que no es del modelo, crear es el único paso.
  - El «+» de la plantilla abre el gestor en lugar del formulario b × h en línea.
  - La barra (Materiales, Secciones) y la paleta («Nueva sección…», «Nuevo material…») abren los gestores.

### 7.2 Criterios

| # | Criterio | Resultado |
|---|---|---|
| 1 | Sin tablas | **Pasa.** Las cinco formas y los tres tipos de material se crean, cambian, duplican, renombran y borran desde el gestor. El resultado es lo escrito a mano en el JSON (`gestores.test.ts`, `app/src/test/gestores.test.tsx`) |
| 2 | Desde cualquier desplegable | **Pasa.** El inspector, la hoja (filas del modelo) y la plantilla crean y eligen en un paso, y deshacer quita la sección y su material típico. En la fila nueva de la hoja son dos pasos: crear, y la fila cuando se completa |
| 3 | Catálogo exacto | **Pasa.** Las 87 filas cuadran con la geometría de su sección (`perfiles.test.ts`). Un pórtico con `IPE300` del gestor es el mismo modelo que con el perfil escrito a mano, y compila y calcula |
| 4 | Lo mostrado es lo calculado | **Pasa.** Las propiedades de la ficha son las de `compilarSeccion` en las cinco formas, y el Ecm, el de `hormigon(fck)` |
| 5 | Nada se rompe | **Pasa en las pruebas** (raíz 2101 y app 60). Los bancos de Chrome no se han pasado: GE no toca las vistas ni el worker |
| 6 | Puerta de uso | **Del usuario** |

### 7.3 Hallazgos

- **GE1-1:** el Esc de un diálogo sólo funcionaba con el foco dentro. Tras «Crear», el botón cambia y el foco se va al `body`. El gestor escucha el Esc en la ventana, salvo que haya otro diálogo encima. Los demás diálogos de la app tienen el mismo defecto.
- **GE1-2:** la columna «forma» de la tabla de secciones sigue sin admitir `I` en una fila nueva (no tiene columnas para el perfil). Ahora la ayuda manda a «Nueva sección…».

### 7.4 Pendiente

- La puerta de uso (criterio 6).
- GE2 (casos típicos) y GE3 (plantas).
- El Esc de los demás diálogos (GE1-1).
