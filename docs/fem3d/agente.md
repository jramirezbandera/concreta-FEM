# Capa de agente: propuesta

> **Qué es.** Una capa para que un agente de IA (Claude Code u otro) pueda manejar el motor de punta a punta: crear y editar el modelo físico, compilar, calcular, consultar resultados, revisarlos y, más adelante, leer planos y exportar a CAD. **Fecha:** 2026-10-05.
>
> **Estado:** A0–A2 superadas el 2026-10-09; el informe está en `fase-a0-a2.md`. Decisiones A-a…A-d tomadas el 2026-10-05; A-e, aplazada (§6). A3 superada el 2026-10-09; el informe está en `fase-a3.md` y lo fijado al empezar, en §8. A4 en curso: lo fijado al empezar está en §10.
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

## 7. A0–A2: lo que se fija al empezar (2026-10-09)

El usuario arranca A0–A2 tras C5 y deja la recuperación SPR (C5-4, criterio 8 de C5) como pendiente técnico. Lo que sigue se fija antes de escribir código, como los criterios.

**`proyecto.json`.** Un objeto con:
- `esquema`: `"concreta-fem/proyecto@1"`, la versión del esquema. Un cambio incompatible sube el número.
- `nombre` y `descripcion`, opcionales.
- `modelo`: el `ModeloFisico` tal cual.
- `opciones`: las `OpcionesCompilacion`, opcionales.
- `$schema`, opcional, sólo para que el editor encuentre el esquema.

La huella es la del compilador (modelo y opciones); `nombre` y `descripcion` no entran.

**Esquema.**
- JSON Schema 2020-12 generado desde el tipo `Proyecto` con la API del compilador de TypeScript, que ya es dependencia de desarrollo (Apache-2.0): no entra ninguna dependencia nueva.
- Las descripciones salen de los comentarios de los tipos, y la del modelo es la cabecera de `fisico.ts` con sus convenios.
- El esquema va versionado en `src/agente/proyecto.schema.json`, y un test comprueba que es el que sale de los tipos.
- **`additionalProperties: false` en todos los objetos.** Un campo opcional mal escrito (`"insercon"`) se ignoraría y sería un fallo silencioso; así es un error.
- Lo valida un validador propio del subconjunto que se genera (`src/agente/esquema.ts`), no Ajv: da los mensajes en español con la ruta y el id del objeto, y no hay que llevar otra dependencia a Concreta.

**CLI `fem`** (`cli/fem.ts`, con Bun). Órdenes:

| Orden | Hace |
|---|---|
| `validar <proyecto>` | Esquema y compilación; diagnósticos con el id físico |
| `compilar <proyecto>` | Además, huella, estadísticas e hipótesis |
| `calcular <proyecto>` | Además, calcula y guarda los resultados |
| `resumen <proyecto>` | A1: el modelo en unas líneas por planta |
| `consultar <proyecto> <consulta> …` | A1: envolventes, piezas, bandas, reacciones… |
| `esquema` | La ruta del esquema |

- Cada orden escribe un único JSON por la salida estándar, con `orden`, `ok` y `diagnosticos` siempre presentes.
- **Códigos de salida:** 0 si todo va bien; 1 si el modelo o el cálculo tienen errores; 2 si la orden está mal dada (argumentos, fichero que no existe, JSON roto); 3 si hay un error interno.
- **Resultados:** se guardan junto al proyecto, en `.fem/<huella>/`, y se reutilizan mientras la huella no cambie. Son derivados y no van a git.
- **Números:** la capa pura (`src/agente/`) los da completos. La CLI los redondea a 6 cifras significativas para el agente, y `--exacto` los da completos.

**Tope de tamaño de A1 (criterio 2).** En el edificio objetivo de 7 plantas, el resumen y cada consulta con sus opciones por defecto caben en **4 000 tokens**. No hay un tokenizador oficial en local, así que se estima como bytes / 2,5, que es conservador para JSON con números (cuenta de más). Las listas van acotadas (los 10 mayores por defecto) y lo dicen cuando cortan.

**Spike A2.**
- **Agentes:** subagentes de Claude Code, cada uno con la descripción en texto, la skill y la CLI. No pueden leer `src/`, `validacion/` ni `docs/`, para no copiar el modelo de referencia, y al acabar dicen qué ficheros han leído.
- **Los tres modelos:** 1-022, `reticulaConNucleo` y el edificio objetivo con losa maciza y vigas (`edificioObjetivoLosas`).
- **Ids:** los de los casos se dan en la descripción; los demás son libres.
- **Comparación** con la referencia, a 1e-6:
  - reacciones totales por caso;
  - desplazamiento del maestro de cada planta (las plantas se emparejan por su cota);
  - flecha máxima de cada losa;
  - esfuerzos de cinco piezas elegidas, localizadas por su posición.

## 8. A3: lo que se fija al empezar (2026-10-09)

Lo propuso el agente y el usuario lo aceptó el 2026-10-09, antes de escribir código: los umbrales, la lista de mutaciones, la firma y el reparto de la bajada por áreas tributarias.

**Qué es.**
- `src/agente/sensatez.ts` (puro): las comprobaciones. Dan avisos (`sensatez/…`), nunca errores. Se calculan desde el modelo físico, sin la malla, con la geometría de `poligonos.ts`.
- `src/agente/informe.ts` (puro): el informe en Markdown y HTML. Es determinista (sin fecha), así que su sha256 se puede reproducir.
- `fem revisar <proyecto>`: calcula (o reutiliza lo guardado), comprueba y escribe `informe.md` e `informe.html` en `.fem/<huella>/`.
- `fem firmar <proyecto> --por "<nombre>"`: añade a `<proyecto>.revision.json`, junto al proyecto y en git, la huella, quién firma, la fecha y el sha256 del informe.
  - `fem revisar` dice si la huella actual está firmada y si el informe sigue siendo el mismo.
  - El agente nunca firma (lo dice la skill).

**Umbrales de aviso.**

| Comprobación | Avisa si |
|---|---|
| Altura de planta | Fuera de [2,2; 8] m. En la planta más baja, la de los arranques, sólo si pasa de 8 m |
| Espesor de losa o muro | Fuera de [0,08; 2] m |
| b, h o D de una sección | Fuera de [0,10; 3] m. En una T, h y bf; su bw y su hf, fuera de [0,03; 3] m |
| fck; E de un material general; peso específico | Fuera de [12; 100] MPa; de [1e6; 4e8] kN/m²; de [1; 100] kN/m³ |
| pp dado / (γ·espesor) | Fuera de [0,3; 1,3] en una losa maciza y de [0,3; 1] en un reticular. En un paño, pp fuera de [1,5; 8] kN/m² |
| Carga vertical de la planta por m² de losas y paños, sumando los casos G (el de peso propio, si no lleva acción, cuenta como G) | Fuera de [3; 20] kN/m² |
| Lo mismo con los casos Q y con los S | Fuera de [0,5; 10] y de [0,1; 3] kN/m² |
| Cada caso sin acción (salvo el de peso propio) | Más de 25 kN/m² en una planta |
| Carga vertical hacia arriba en un caso G, Q o S, o sin acción | Siempre |
| Sin caso de peso propio; caso vacío; carga duplicada (igual a otra salvo el id, en el mismo caso) | Siempre |
| Planta con losas o paños sin carga de un caso que carga al menos dos plantas y la mitad de las que tienen losas. No se aplica a la planta más alta con losas ni a las de tipo `cubierta` | Siempre |
| Pilar con vínculo en la base que arranca en una planta que no es la más baja | Siempre |
| Pilar que acaba bajo una losa o un paño de la planta de encima que cubre su eje | Siempre |
| Peso propio del cálculo frente al esperado: Σ V·γ por tipo de pieza, menos los solapes que descuenta el compilador (C2-g, C3-g), estimados aparte | Difieren más de un 10 % |
| Axil de cada tramo de pilar frente a la bajada por áreas tributarias, con la suma de los casos gravitatorios | Cociente fuera de [0,5; 2], salvo en tramos con una bajada menor que el 10 % de la mediana de su planta |
| Luz libre / canto de cada vano de viga | > 18 si es descolgada; > 25 si es plana (b ≥ h). Un voladizo cuenta con el doble de su luz |
| Mayor lado del recuadro / espesor | > 35 en una losa maciza y > 30 en un reticular |
| Flecha relativa elástica / luz, del recuadro (su mayor lado) o del vano de viga o vigueta | > 1/500 |
| Desplome por planta | > 1/250 |
| Axil reducido ν = Nd/(Ac·fcd), con fcd = fck/1,5 | > 0,65 |

**Combinaciones de las comprobaciones con resultados.**
- Si todos los casos llevan su acción: ELS característica para las flechas y el desplome, ELU para ν.
- Si no, «gravedad»: la suma de los casos gravitatorios (todos menos W, E, T, N y A, y menos los que no tienen carga vertical), con factor 1 para flechas y 1,4 para ν. El desplome, caso a caso.

**Bajada por áreas tributarias.**
- En cada planta, Voronoi de los pilares que la sostienen (los que tienen un tramo debajo) y de puntos cada 0,5 m de los ejes de los muros, recortado a las losas y los paños.
- Cada carga va donde cae:
  - las de superficie y los pp, por el área de cada celda;
  - las lineales, las de viga y el peso de las vigas, muestreados por su eje;
  - las puntuales, a su celda.
- La bajada de un tramo acumula las plantas que el pilar sostiene por encima, más el peso de sus tramos superiores.
- Lo que va a los muros no se comprueba: sólo hacen de generadores.

**Mutaciones graves (criterio 1).**
- Se inyectan en 1-022, la retícula con núcleo y los edificios objetivo con losas, unidireccional y reticular (en tamaño reducido), cada una donde aplica:
  1. carga de superficie en N/m² (×1000);
  2. carga vertical con el signo cambiado;
  3. pilar interior quitado;
  4. ningún caso de peso propio;
  5. espesor de losa en cm;
  6. canto de viga en cm;
  7. altura de planta en cm;
  8. las cargas de uso de una planta, en el caso G;
  9. carga duplicada;
  10. fck en kN/m²;
  11. pp de losa en kN/m³.
- Se detecta si aparece algún aviso de sensatez que el modelo sin mutar no da, o si el compilador la rechaza.
- **Fuera de la lista:** «una planta con la altura de otra» cuando la altura sigue siendo plausible. Sin la descripción, ninguna comprobación lo puede saber; el informe da las alturas por planta para que las revise el ingeniero.

**Falsos avisos (criterio 2).** Se miden en los modelos de referencia a tamaño completo y en los tres proyectos de los agentes de A2. Cada aviso que quede se justifica en el informe de la fase.

## 9. Spike realista: lo que se fija al empezar (2026-10-09)

El primer spike (A2) usó descripciones sin ambigüedad, escritas conociendo las referencias. Este mide lo que aquel no medía: si el agente pregunta en vez de decidir (reglas 2 y 3 de la skill) y si `fem revisar` entra en su flujo. Lo pidió el usuario tras A3.

**Qué se le da al agente.**
- Los mismos tres modelos (1-022, la retícula con núcleo y el edificio objetivo), descritos como un encargo real: un correo, con unidades mezcladas (mm, cm, pies y pulgadas, kg/m²) y con **trampas plantadas**.
- **Las trampas, de tres tipos:**
  - un dato que falta (F);
  - dos datos que se contradicen, o una errata evidente (C);
  - un dato que habría que sacar de la norma y no se da (N): una sobrecarga «de vivienda» sin su valor, o «el viento del CTE».
- Cada descripción tiene su **clave** (`validacion/a2r/claves/`), que el agente no ve: las trampas y lo que responde el ingeniero.

**Protocolo.**
- El agente tiene la skill, el esquema y la CLI, igual que en A2.
- Cuando necesita un dato, acaba su turno con «PREGUNTAS AL INGENIERO:» y no sigue hasta tener respuesta.
- Responde el ingeniero, que en el spike hace este agente, **sólo con la clave**. Lo que se pregunte fuera de ella se contesta con el modelo de referencia, y queda anotado.
- Al acabar, el agente entrega su informe con sus supuestos. El ingeniero lo lee y, si un supuesto declarado es erróneo, se lo corrige, como en una revisión real.
- Como mucho, cuatro rondas.

**Cómo se clasifica cada trampa.**

| Clase | Qué es |
|---|---|
| Preguntada | El agente la pregunta antes de decidir |
| Declarada | Decide, pero lo dice como supuesto en su informe |
| Silenciosa | Decide sin decirlo |

Una trampa N **sólo cuenta si se pregunta** (o el agente deja la carga fuera y lo dice): usar el valor de la norma de memoria, aunque se declare, incumple la regla 2.

**Criterios de paso:**
1. Ninguna trampa silenciosa.
2. Ninguna trampa N resuelta con un valor de memoria.
3. Tras las respuestas, cada modelo coincide con la referencia a 1e-6 (`validacion/a2/comparar.ts`).
4. El agente ejecuta `fem revisar`, explica sus avisos y no ejecuta `fem firmar`.
5. Se registran las rondas, las preguntas (pertinentes o no), el tiempo y los tokens.

## 10. A4: lo que se fija al empezar (2026-10-09)

Lo propuso el agente y el usuario lo aceptó el 2026-10-09, antes de escribir código: el rasterizado, las vistas, la puerta de detección visual y las figuras del informe. La axonometría del edificio queda fuera (decisión del usuario).

**Qué es.**
- `src/agente/render/` (puro): una **escena** por planta y vista, con primitivas (polígonos con huecos, polilíneas, marcas y textos) en coordenadas del modelo, y su SVG. Todo número rotulado sale de las consultas de A1 o de las de C5, nunca de la imagen.
- `fem render <proyecto> [--planta P] [--vista V]… [--caso C | --combinacion E | --situacion S]`: escribe `.fem/<huella>/render/<planta>-<vista>.svg` y `.png`, y devuelve un JSON con las rutas, la combinación, la escala y los extremos rotulados.
  - Las vistas del modelo no necesitan el cálculo, y `modelo` y `diagnosticos` se dibujan también si el modelo no compila.
  - La skill dice que un número se cita del JSON o de una consulta, nunca leído de la imagen.
- **PNG:** sólo en la CLI, con `@resvg/resvg-wasm` 2.6.2 (MPL-2.0, ya admitida) y Roboto 2.138 regular y negrita (Apache-2.0, de `googlefonts/roboto`). Las fuentes van versionadas en `cli/fuentes/` con su sha256, sin fuentes del sistema, así que el PNG es determinista. Medido: los mismos bytes en Bun y en Node.

**Vistas** (en planta, vistas desde arriba, con X a la derecha e Y hacia arriba):

| Vista | Qué dibuja |
|---|---|
| `modelo` | Losas (con huecos; reticular con sus ábacos), paños con la dirección de las viguetas, vigas con su ancho, pilares con su sección orientada, muros con su espesor y sus huecos, apoyos y bandas, con los ids. Los pilares y muros que llegan desde abajo, rellenos; los que sólo arrancan hacia arriba, en contorno |
| `cargas` | Las cargas de un caso en la planta: de superficie (su zona o su losa), lineales, de viga, de pilar y puntuales, con su valor. Si el caso lleva el peso propio, lo dice |
| `diagnosticos` | El modelo atenuado y una marca numerada en cada objeto con un error o un aviso (compilación y sensatez previa), con la lista al lado. Lo que no tiene sitio en planta va sólo en la lista |
| `malla` | Las láminas y barras de la planta; ábacos y huellas rígidas, sombreados |
| `uz`, `m11`, `m22`, `m12`, `v13`, `v23` | Isovalores en bandas sobre las losas y los paños de la planta (uz también en las viguetas, por sus nudos), en una combinación. Con varias, la que da el mayor valor absoluto en la planta, y se dice cuál. Con los extremos rotulados |
| `vigas-my`, `vigas-vz` | Diagrama de cada viga y vigueta de la planta, en su envolvente sobre las combinaciones, con el máximo y el mínimo de cada vano rotulados |
| `pilares-n` | Axil de cada tramo de pilar que llega a la planta, en su envolvente (máximo y mínimo) |

Combinaciones por defecto: las de las consultas de A1 (`combinaciones.ts`); si los casos no llevan su acción, la «gravedad» de A3 (factor 1 en uz, 1,4 en los esfuerzos).

**Isovalores.**
- Bandas por triángulos (cada lámina en dos), con los valores nodales: uz de los desplazamientos, y los momentos y cortantes de los campos SPR (`CamposLaminas`, E5) en los ejes de la lámina.
- Las bandas iguales se funden en un solo contorno por banda, sin las costuras del antialias entre triángulos.
- Diez bandas con límites redondos. Paleta secuencial para uz y divergente, centrada en 0, para los esfuerzos.

**Criterios de paso.**
1. **Fidelidad.** Lo dibujado es exactamente lo de las consultas:
   - las losas, pilares, vigas, muros y cargas de la escena son los del modelo físico de la planta, ni uno más;
   - las bandas cubren cada losa sin huecos ni solapes (suma de áreas a 1e-9), y un punto al azar cae en la banda de su valor interpolado;
   - los extremos rotulados coinciden con `flechas`, `pieza` y `Consultas.pilar`; las ordenadas de los diagramas, con `Consultas.diagrama`.
2. **Determinismo.** El mismo proyecto da el mismo SVG byte a byte, aunque se reordene su JSON, y el mismo sha256 del PNG en Bun, en Node y en el CI. Un PNG queda congelado en un test.
3. **Tamaño.**
   - El lado mayor del PNG mide ≤ 1568 px y ningún texto baja de 11 px.
   - En el edificio objetivo: ≤ 2 s por planta y vista (con el cálculo hecho) e `informe.html` ≤ 8 MB.
4. **Puerta: detección visual.** Un subagente recibe la descripción de A2 y sólo las PNG del modelo (`modelo` y `cargas` de cada caso, de cada planta), sin el JSON ni la CLI, y lista lo que no cuadra.
   - Ocho mutaciones, cada una en un proyecto aparte, que el compilador acepta y A3 no avisa (se comprueba). Tiene que encontrar al menos seis:
     - edificio objetivo con losas:
       1. un pilar interior desplazado 1 m en X en toda su altura;
       2. el hueco de la escalera olvidado en una planta;
       3. una viga secundaria que acaba 0,6 m antes de la principal;
       4. la zona de 3 kN/m² de Q de una planta, desplazada un vano en X;
       5. un pilar de 30 × 50 de una columna girada con giro 0;
       6. la tabiquería de una planta con un vértice errado (22,5, 21,5 → 22,5, 15,5);
     - retícula con núcleo:
       7. el hueco de la losa fuera del núcleo (desplazado 6 m en X);
       8. la puerta del núcleo en el tercer lado.
   - En los dos proyectos sin mutar, ninguna discrepancia falsa, o cada una justificada.
   - Se registran los tokens y el tiempo.
5. **Informe.**
   - `informe.html` lleva, por planta, el SVG de `modelo` y el de `uz` de la combinación de flechas de A3.
   - `informe.md` lista cada figura con el sha256 de su SVG, así que la firma también cubre las figuras.

**Fuera de A4:** la axonometría; el plano de fondo, que va con A5; las vistas en alzado de muros y pórticos.
