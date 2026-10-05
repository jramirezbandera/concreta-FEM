# Capa de agente: propuesta

> **Qué es.** Una capa para que un agente de IA (Claude Code u otro) pueda manejar el motor de punta a punta: crear y editar el modelo físico, compilar, calcular, consultar resultados, revisarlos y, más adelante, leer planos y exportar a CAD. **Fecha:** 2026-10-05.
>
> **Estado:** propuesta aceptada, sin empezar. Decisiones A-a…A-d tomadas el 2026-10-05; A-e, aplazada (§6). No cambia el motor ni el compilador y no adelanta ninguna fase. Lo natural es empezar tras C5, porque las consultas por objeto físico de C5 son la base de A1.
>
> **Veredicto.** Es viable, y el repositorio está mejor preparado de lo habitual (§1). El objetivo realista no es «todo con IA», sino que **la IA haga casi todo el tecleo y la iteración, y el ingeniero revise y firme** sobre un informe y un visor. Lo difícil no es la interfaz con el agente. Son los extremos de la cadena (leer planos en imagen y sacar planos de armado) y un riesgo nuevo: **el fallo silencioso pasa del motor al modelo**. El motor puede estar perfecto y el modelo tener una carga, un pilar o una unidad mal puestos (§4, regla A3).

## 1. Por qué el repositorio encaja

| Lo que necesita un agente | Lo que ya hay |
|---|---|
| Un modelo que pueda escribir y editar como texto | `ModeloFisico` (`fisico.ts`) es JSON puro: listas de objetos con `id` único en todo el modelo, sin funciones ni arrays tipados. Su cabecera documenta ejes, unidades, estaciones y convenios de losas, muros y forjados |
| Errores que le digan qué tocar | Los diagnósticos nombran el objeto físico (`traducirDiagnosticos`), y el compilador nunca lanza por un dato (regla 1 del compilador) |
| Saber qué ha supuesto el programa | `hipotesis` en texto de cada compilación (C1-a, D4, C4-k…) |
| Que un resultado no pueda ser un disparate numérico | Equilibrio ≤ 1e-9 en cada cálculo (regla de oro 2) y «sin pérdidas» en cada compilación |
| Comparar dos iteraciones | Determinismo: la malla no depende del orden, de una traslación ni del motor JS (C2-3, C3-5), y la `huella` (H13) identifica el modelo físico canónico |
| Ejecutarlo sin navegador | Motor y compilador puros; corren en Node y Bun (E4) |
| Resultados por pieza, no por nudo | `EsfuerzosPiezas`, `Cortes` y `CamposLaminas` (E5); en C5, consultas por objeto físico |
| Tolerar geometría imperfecta | Las dos tolerancias de H28 (ε_snap = 5 cm con aviso) y «la geometría dibujada no se mueve nunca» |

Lo que falta es una capa fina: un fichero de proyecto, una CLI, consultas compactas, comprobaciones de sensatez y un informe de revisión.

## 2. Reglas de la capa

- **A1. La IA no produce ningún número de cálculo.**
  - Todo valor que acabe en un resultado, un armado o una comprobación sale de una herramienta con tests. El agente orquesta: escribe el modelo, lanza las herramientas y lee lo que devuelven.
  - Lo mismo con la norma: el detalle del Código Estructural o del CTE va en código validado, nunca en la memoria del modelo de lenguaje.
- **A2. El proyecto es un fichero, y la única fuente de verdad.**
  - `proyecto.json` (modelo físico, opciones de compilación y versión del esquema) vive en una carpeta con git. Cualquier acción del agente es una edición de ese fichero, así que queda en el historial y se puede revisar con un diff.
  - Los resultados son derivados: se regeneran desde el fichero y se identifican por su huella.
- **A3. Ningún resultado se da por bueno sin informe de revisión.**
  - Calcular deja un informe ligado a la huella, con:
    - hipótesis;
    - resumen del modelo;
    - cargas por planta;
    - comprobaciones de sensatez (§3, A3);
    - avisos.
  - El ingeniero lo revisa y lo firma. Si después cambia el modelo, la huella cambia y el informe deja de valer.
  - Es la regla de oro 1 aplicada a la entrada: un error de modelado es un fallo silencioso como cualquier otro.
- **A4. Es un adaptador; el motor sigue puro.**
  - Las consultas, los resúmenes y las comprobaciones de sensatez son puros (`src/agente/`), para poder llevarlos a Concreta.
  - La CLI y, más adelante, el MCP son la única parte con IO (`cli/`), igual que el worker es un adaptador del motor.
- **A5. Nada de fuentes externas entra sin confirmar.**
  - La geometría leída de un plano (DXF, IFC o PDF) es una propuesta hasta que el ingeniero la confirma sobre una superposición visual.
  - Su procedencia (fichero, capa, página) va en un fichero aparte (`proyecto.origen.json`), para no cambiar el modelo físico ni su huella.
  - Las coordenadas leídas de una imagen nunca se aceptan sin esa superposición.
- **A6. Las licencias, como siempre** (regla de oro 6). Cada dependencia nueva (lector de DXF, de IFC o de PDF, SDK de MCP) se comprueba al adoptarla y se anota.
- **A7. La regla de oro 7 vale también para el agente.** El periodo «en sombra» incluye modelos hechos por el agente, comparados con los mismos proyectos modelados a mano en SAP2000 o CYPE.

## 3. Fases

| Fase | Contenido | Depende de |
|---|---|---|
| **A0 Esquema y CLI** | JSON Schema versionado de `proyecto.json`, generado desde los tipos de `fisico.ts` y con los convenios de la cabecera como descripciones. CLI `fem` con `validar`, `compilar`, `calcular` y `consultar`, salida JSON estable y códigos de salida. Una skill de Claude Code con el flujo y los convenios | C5 (consultas) |
| **A1 Consultas y resúmenes** | `resumen`: el modelo en unas líneas por planta, sin volcar el JSON. `consultar`: envolventes por tipo de pieza y planta (máximos de My, Vz y N; flechas por paño; deriva por planta; reacciones), esfuerzos de una pieza por estaciones y cortes de banda. Salida acotada en tamaño | C5 |
| **A2 Spike con agente (puerta)** | Dar a Claude la descripción en texto de tres modelos con referencia (1-022, `reticulaConNucleo`, el edificio objetivo) y medir si llega a un modelo válido, en cuántas vueltas y si es equivalente al de referencia | A0, A1 |
| **A3 Sensatez e informe** | Comprobaciones independientes del modelo (abajo) e informe de revisión en Markdown y HTML, ligado a la huella | A1 |
| **A4 Render y revisión visual** | `render`: PNG de cada planta con el modelo, los diagnósticos, diagramas e isovalores. El agente lo usa para detectar anomalías y el ingeniero, para revisar. Con un plano de fondo, la superposición de A5 | A1 |
| **A5 Entrada desde planos** | DXF (capas de ejes, pilares y muros), IFC del arquitecto y PDF vectorial. El agente propone y el ingeniero confirma sobre la superposición (A5). Ráster, sólo como referencia con visión y siempre confirmado | A4 |
| **A6 Salida a CAD** | DXF de plantas de forjado, replanteo de pilares, geometría de vigas y paños, y bandas. Los planos de armado quedan fuera mientras no haya dimensionado (Concreta) | C5, comprobaciones |
| **A7 MCP** | Servidor MCP como capa fina sobre las mismas funciones de la CLI, para usarlo desde clientes que no tienen terminal (Claude Desktop, claude.ai) | A0–A4 |

Para Claude Code basta la CLI con la skill: Claude edita el fichero con sus herramientas normales y lanza `fem`. El MCP no hace falta hasta A7.

### A0: criterios de paso

1. El esquema acepta todos los modelos de los fixtures y de las referencias congeladas de C1–C4.
2. Las entradas no válidas del compilador (`src/compilador/invalidos*.test.ts`) se rechazan, sea por el esquema o por `validar`, nombrando el id físico.
3. `fem calcular` da los mismos bits que llamar a `compilar` y `calcular` desde un test.
4. La salida no depende del orden del JSON ni de la máquina: la huella de C1–C4 se mantiene.

### A1: criterios de paso

1. Cada consulta coincide exactamente con lo que se obtiene de `EsfuerzosPiezas`, `Cortes` y `CamposLaminas` llamados a mano.
2. El resumen y las consultas del edificio objetivo no superan un tamaño fijado al empezar la fase (en tokens, medido), que les permita caber varias veces en el contexto de un agente.
3. Las envolventes no pierden el máximo: sobre la batería al azar de C1–C4, el máximo de la consulta es el máximo de todas las piezas y estaciones.

### A2: criterios de paso (puerta)

1. Con descripciones sin ambigüedad, el agente llega a un modelo válido en las tres pruebas.
2. Sus resultados globales coinciden con los de referencia a 1e-6: reacciones totales, deriva por planta, flecha máxima por paño y esfuerzos de cinco piezas elegidas. Los `id` pueden ser otros, así que se compara por resultantes y por posición.
3. Se registran las vueltas, el tiempo y los tokens.

Si esta puerta no pasa con texto sin ambigüedad, A5 no tiene sentido: hay que mejorar el esquema, los diagnósticos o la skill antes de seguir.

### A3: comprobaciones de sensatez

Son oráculos del **modelo**, no del motor. Se calculan desde el modelo físico, por un camino independiente del compilador, y dan avisos, no errores: un valor raro puede ser legítimo (una viga de transición, un voladizo).

| Comprobación | Qué detecta |
|---|---|
| Peso propio total = Σ volumen × γ, calculado sin malla | Losas sin `pp`, espesores mal puestos, elementos duplicados |
| Carga total por planta / área de planta, por caso, contra rangos por uso | Unidades (kN frente a N o kg), cargas olvidadas o duplicadas |
| Reacción de cada pilar frente a su área tributaria (Voronoi de los pilares en planta) × carga | Pilares sin conectar, apoyos que faltan, transiciones no buscadas |
| Pilares sin continuidad, plantas sin cargas, casos vacíos | Errores de entrada que el motor calcula sin quejarse |
| Ratios: canto/luz de vigas y losas, flecha/luz, deriva/altura, axil reducido de los pilares | Secciones fuera de lo normal y errores de orden de magnitud |

Los rangos se fijan con el usuario. Igual que las metamórficas, se validan con **mutaciones del modelo**: sobre los modelos de referencia se inyectan errores típicos y se mide cuántos se detectan. Por ejemplo:
- una carga en N en vez de kN;
- un pilar quitado;
- el pp omitido;
- un canto en cm;
- una planta con la altura de otra;
- una carga en el caso equivocado.

**Criterios:**
1. Detectar todas las mutaciones graves, con una lista fijada al empezar la fase.
2. No dar avisos falsos en los modelos de referencia sin mutar, o justificar cada uno.

## 4. Riesgos

| Riesgo | Mitigación |
|---|---|
| **Error de modelado silencioso:** el motor calcula bien un modelo equivocado | A3 (sensatez, informe y firma) y A7 (periodo en sombra con modelos del agente) |
| Coordenadas sacadas de una imagen | A5: DXF o IFC antes que PDF; ráster sólo como referencia y con superposición. Las tolerancias de H28 absorben el ruido de dibujo, no el de una lectura mala |
| El modelo de lenguaje «recuerda» mal la norma | A1: la norma va en código con tests. El agente cita lo que devuelve la herramienta |
| Modelos grandes que no caben en el contexto | A1: resúmenes y consultas acotadas; ediciones por planta o por objeto, no el fichero entero |
| Las comprobaciones viven en Concreta | La capa sólo depende de las consultas de C5. La versión completa (dimensionado, armado) se integra allí con el PR que decida el usuario |
| Depender de un proveedor de IA | La CLI y el esquema no dependen de ningún agente: cualquiera, o una persona, puede usarlos. La skill y el MCP son el único acoplamiento |
| **Confidencialidad:** los planos y modelos de clientes llegan al proveedor de la IA | Decidirlo por proyecto, con las condiciones del servicio que se use. El motor y la CLI corren en local; sólo sale lo que el agente lee |
| Trazabilidad de la firma | git registra cada edición del agente; el informe va ligado a la huella y anota qué partes del modelo vienen de un plano (`proyecto.origen.json`) |

## 5. Fuera del alcance

- **Planos de armado** (despieces, cuadros de pilares, solapes): necesitan el dimensionado y el detalle de armado, que son un proyecto propio y dependen de Concreta.
- **Decidir sin el ingeniero:** el agente propone variantes (tipología, predimensionado, posición de pilares) y el ingeniero elige. Ninguna decisión de la lista de «Decisiones del usuario» la toma el agente.
- **Calcular de verdad** antes de que pase la regla de oro 7.

## 6. Decisiones del usuario (2026-10-05)

- **A-a. Dónde vive:** A0–A4 aquí, en `src/agente/` y `cli/`, porque no dependen de Concreta. A6 y la parte de comprobaciones van con la integración en Concreta.
- **A-b. Formato del proyecto:** JSON con esquema versionado. Un fichero TS daría tipos, pero mezcla datos con código, y el agente y el visor lo leerían peor.
- **A-c. Procedencia:** en un fichero aparte (`proyecto.origen.json`), fuera del modelo físico y de su huella.
- **A-d. Cuándo:** A0–A2 justo después de C5, porque el spike A2 dice pronto si merece la pena seguir. A3 tiene que estar antes de usarlo con un proyecto real.
- **A-e. Confidencialidad: aplazada.** Se decidirá más adelante, y en todo caso antes de A5. Hasta entonces, el agente sólo trabaja con modelos de prueba y de validación, no con planos de clientes.
