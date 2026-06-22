# Área 5 — Persistencia, validación y estrategia de testing (app web cliente-only de cálculo estructural)

> Investigación de mejores prácticas para Concreta · Estructuras (React + TS + Vite, sin backend, Dexie/IndexedDB, Zod, Vitest + RTL + Playwright + golden tests, Pyodide/PyNite en Web Worker).
> Fecha: 2026-06-20. Cada finding incluye: **claim** (verificable), **rationale**, **sources** (URLs reales) y **confidence** (alta/media/baja).

---

## Resumen ejecutivo

- **Persistencia (Dexie/IndexedDB).** El versionado declarativo de Dexie (`version(n).stores({...})` + `upgrade()`) es la base correcta: declaras el historial y Dexie decide crear/migrar/saltar. Para autosave continuo de la Capa 1, usar **debounce** (no throttle) sobre el snapshot del modelo, escribiendo en una transacción `readwrite`. Solicitar **persistencia** (`navigator.storage.persist()`) para evitar la evicción LRU bajo presión de almacenamiento, y monitorizar cuota con `navigator.storage.estimate()`. Manejar `QuotaExceededError` siempre.
- **Export/Import .json.** Diseñar un **formato propio versionado** con campo `schemaVersion` explícito; al importar: parse → detectar versión → validar contra esa versión → **migrar incrementalmente** (v1→v2→v3) → validar contra el esquema actual → entregar a la app. Toda la importación pasa por `safeParse` de Zod y nunca lanza sin capturar: importar un fichero corrupto debe degradar con un error legible, no romper la app.
- **Zod.** Definir esquemas una sola vez a nivel de módulo; derivar tipos TS con `z.infer` (única fuente de verdad). En los **bordes** (importar, salida del discretizador) usar `safeParse` (discriminated union, sin try/catch, más barato que excepciones en bucle). `parse` solo en código interno donde un fallo es un bug.
- **Testing por capas.** Discretizador y dominio: unit + **golden tests** en **Node puro** (sin Pyodide, sin jsdom), comparando contra casos de libro. Inspector/diálogos: RTL en jsdom. Flujo completo: Playwright E2E con aislamiento por contexto de navegador y fixtures.
- **Solver/Pyodide.** Recomendado: **dos niveles**. (1) Tests rápidos del pipeline TS mockeando `solverClient` (sin Pyodide). (2) Un conjunto pequeño de tests de integración con **Pyodide real** (lento, en navegador/CI) que validan que `pynite_glue.py` produce los esfuerzos correctos de los golden cases. No meter Pyodide en la suite unitaria por defecto.
- **Vitest.** Usar `test.projects` para separar entornos: proyecto `node` (dominio/discretizador/golden) y proyecto `jsdom` (componentes). Coverage es global al proceso, no per-project.
- **Robustez.** Worker con timeouts, propagación de errores tipados a la UI, estados de carga visibles ("cargando motor", "calculando"), y recuperación: autosave que sobrevive a un fallo del solver (los resultados se invalidan, la obra no se pierde).

---

## 1. Dexie / IndexedDB: autosave, versionado, transacciones, cuota y persistencia

### 1.1 Versionado declarativo con `version(n).stores()`
**Claim:** Dexie usa un modelo declarativo: declaras cada versión de esquema con `db.version(n).stores({...})`; para un usuario nuevo aplica el esquema más reciente, y para uno con BD antigua ejecuta secuencialmente los `upgrade()` necesarios. El orden de declaración no es crítico (Dexie ordena por número de versión antes de abrir).
**Rationale:** Evita lógica manual de comparación de versiones y `onupgradeneeded` crudo de IndexedDB; la historia queda legible y la migración correcta por construcción.
**Sources:**
- https://dexie.org/docs/Tutorial/Design
- https://dexie.org/docs/Version/Version.stores()
- https://dexie.org/docs/Tutorial/Understanding-the-basics
**Confidence:** alta

### 1.2 Reglas de retención de versiones antiguas (Dexie ≥ 3.0)
**Claim:** En Dexie ≥ 3.0 solo necesitas conservar en el código las declaraciones de versión que tengan un `upgrade()` adjunto, y solo mientras existan clientes con una versión inferior a la del upgrader. Una versión con upgrader **nunca debe alterarse**: cambios posteriores se hacen añadiendo una nueva `version()`.
**Rationale:** Minimiza el ruido en el código de schema y previene corromper migraciones ya desplegadas. Crítico aquí porque la Capa 1 evolucionará (F1→F4) y la BD acumulará campos.
**Sources:**
- https://dexie.org/docs/Tutorial/Design
- https://dexie.org/docs/Version/Version.upgrade()
**Confidence:** alta

### 1.3 Reglas de índices y tablas en cambios de esquema
**Claim:** Solo hace falta especificar en una nueva versión las tablas que cambian (las no mencionadas se heredan). Los **índices se eliminan** si no se re-especifican en la nueva versión. Las **tablas no se borran** salvo que pongas `null` como spec de stores para esa tabla.
**Rationale:** Comportamiento contraintuitivo que provoca pérdida silenciosa de índices si se omite una tabla creyendo que se hereda intacta.
**Sources:**
- https://dexie.org/docs/Tutorial/Design
- https://dexie.org/docs/Version/Version.stores()
**Confidence:** alta

### 1.4 Solo indexar lo que se consulta; no indexar el blob del modelo
**Claim:** En `stores()` solo se declaran las **claves primarias e índices**, no todas las propiedades. Para Concreta, donde la Capa 1 es un único documento `Modelo` serializable, conviene una tabla tipo `proyectos` con `id` como PK (y quizá `nombre`, `updatedAt` indexados) y el `Modelo` completo como valor no indexado.
**Rationale:** Indexar propiedades anidadas grandes infla la BD y ralentiza escrituras. El modelo se lee/escribe entero; no se consulta por sus campos internos.
**Sources:**
- https://dexie.org/docs/Tutorial/Design
- https://app.studyraid.com/en/read/11356/355143/optimizing-database-schema-design
**Confidence:** media

### 1.5 Autosave: debounce (no throttle) del snapshot
**Claim:** Para autosave de un editor, el patrón correcto es **debounce**: persistir solo tras X ms sin cambios (p. ej. 500–1000 ms), no en cada keystroke ni a intervalos fijos. En React, crear la función debounced una sola vez (`useMemo`/`useRef`), no en cada render.
**Rationale:** Debounce coalesce ráfagas de ediciones CAD (arrastrar un pilar genera decenas de eventos) en una sola escritura; throttle escribiría a mitad de una operación. Recrear el debounce en cada render rompe la coalescencia.
**Sources:**
- https://www.developerway.com/posts/debouncing-in-react
- https://www.freecodecamp.org/news/debounce-and-throttle-in-react-with-hooks/
**Confidence:** alta

### 1.6 Transacciones `readwrite` y atomicidad
**Claim:** Escribir el snapshot dentro de una transacción Dexie (`db.transaction('rw', db.proyectos, ...)` o un simple `db.proyectos.put()` que ya es transaccional) garantiza atomicidad; si la escritura falla, no deja la BD en estado parcial.
**Rationale:** Un autosave interrumpido (cierre de pestaña, fallo) no debe corromper el proyecto persistido. `put()` reemplaza el documento entero de forma atómica.
**Sources:**
- https://dexie.org/docs/Dexie/Dexie.transaction()
- https://dexie.org/docs/Table/Table.put()
**Confidence:** alta

### 1.7 Solicitar almacenamiento persistente (`navigator.storage.persist()`)
**Claim:** Por defecto IndexedDB es **best-effort** y puede ser desalojado bajo presión de disco (política LRU por origen). Llamar a `navigator.storage.persist()` solicita modo **persistente**, que queda exento de la evicción automática (solo el usuario lo borra). Disponible solo en contexto seguro (HTTPS). El navegador puede pedir permiso y el usuario puede negarlo.
**Rationale:** Para una app sin backend donde el proyecto vive en el navegador, perder la BD por evicción sería catastrófico. Pedir persistencia tras la primera acción significativa reduce ese riesgo.
**Sources:**
- https://dexie.org/docs/StorageManager
- https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
- https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
**Confidence:** alta

### 1.8 Persistir sin prompt cuando ya hay permiso
**Claim:** Dexie documenta `tryPersistWithoutPromtingUser()`, que vía Permissions API devuelve `"never"`, `"persisted"` o `"prompt"`, permitiendo activar persistencia silenciosamente cuando el permiso ya está concedido y evitando diálogos no deseados.
**Rationale:** Mejor UX: no interrumpir al usuario con un diálogo de permiso al arrancar; pedirlo solo cuando aporta valor.
**Sources:**
- https://dexie.org/docs/StorageManager
**Confidence:** alta

### 1.9 Monitorizar cuota con `navigator.storage.estimate()`
**Claim:** `navigator.storage.estimate()` devuelve `{ usage, quota }` (valores estimados, con padding anti-fingerprinting). Permite avisar al usuario antes de quedarse sin espacio.
**Rationale:** Aunque los proyectos FEM de F1 son pequeños (JSON de pocos KB/MB), conviene una comprobación defensiva y un mensaje claro si se acerca al límite.
**Sources:**
- https://dexie.org/docs/StorageManager
- https://developer.chrome.com/blog/estimating-available-storage-space
- https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate
**Confidence:** alta

### 1.10 Límites de cuota por navegador
**Claim:** Los límites son generosos y dependen del disco: Chrome/Edge hasta ~60% del disco total por origen; Firefox best-effort el menor de 10% del disco o 10 GiB (límite de grupo por site), y persistente hasta 50% (cap 8 TiB); Safari ~60% en navegador. `localStorage`/`sessionStorage` están limitados a ~5 MiB cada uno (por eso **no** son adecuados para el modelo, solo IndexedDB lo es).
**Rationale:** Confirma que IndexedDB es el almacén correcto y que la cuota no es una restricción real para proyectos estructurales típicos; el riesgo real es la **evicción**, no el tamaño.
**Sources:**
- https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- https://rxdb.info/articles/indexeddb-max-storage-limit.html
**Confidence:** alta

### 1.11 Manejar `QuotaExceededError` y evicción Safari
**Claim:** Las operaciones de escritura deben envolverse para detectar `QuotaExceededError` (`e.name === 'QuotaExceededError'`). Safari, con prevención de tracking activa, puede borrar datos de orígenes **sin interacción del usuario en 7 días** (otra razón para `persist()`). Bajo presión, la evicción borra **todo el origen de golpe**, no parcialmente.
**Rationale:** El autosave debe fallar de forma controlada (avisar, ofrecer export) en lugar de lanzar excepción no capturada.
**Sources:**
- https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- https://dexie.org/docs/StorageManager
**Confidence:** alta

---

## 2. Export/Import .json: formato propio versionado, validación y migración

### 2.1 Campo `schemaVersion` explícito en el documento
**Claim:** El fichero `.json` propio debe incluir un campo de versión explícito (p. ej. `schemaVersion: 3` o `formatVersion`) en la raíz del documento, junto a metadatos (app, fecha). El loader: parse → detectar versión → validar contra esa versión → migrar paso a paso → validar contra la actual → entregar normalizado.
**Rationale:** Sin versión explícita no se puede migrar de forma fiable; con ella, el pipeline es predecible y mantenible a largo plazo (F1→F4 cambiarán el formato).
**Sources:**
- https://offlinetools.org/a/json-formatter/schema-versioning-for-json-configuration-files
- https://developer.couchbase.com/tutorial-schema-versioning
**Confidence:** alta

### 2.2 Migración incremental v1→v2→v3 (no conversiones directas)
**Claim:** Preferir funciones de migración **encadenadas** (`v1→v2`, `v2→v3`, …) sobre un conjunto creciente de conversores especializados de cada versión antigua a la última. Aplicar en secuencia hasta alcanzar la versión actual.
**Rationale:** O(n) funciones de migración en lugar de O(n²); cada paso es pequeño, testeable y compone. Reduce el coste de añadir nuevas versiones.
**Sources:**
- https://offlinetools.org/a/json-formatter/schema-versioning-for-json-configuration-files
- https://jsonic.io/guides/json-schema-versioning
**Confidence:** alta

### 2.3 Cuándo incrementar la versión de formato
**Claim:** Bump de versión cuando se: elimina/renombra/mueve un campo requerido, cambia el tipo o significado de un campo, o se endurece la validación lo suficiente para rechazar ficheros antiguos válidos. Añadir un campo **opcional** que los lectores antiguos ignoran sin cambio de comportamiento **no** requiere bump.
**Rationale:** Disciplina clara para decidir versiones; evita romper ficheros de usuarios existentes innecesariamente.
**Sources:**
- https://offlinetools.org/a/json-formatter/schema-versioning-for-json-configuration-files
**Confidence:** alta

### 2.4 Importar nunca rompe la app (degradación controlada con `safeParse`)
**Claim:** Toda importación pasa por `safeParse` de Zod (no `parse`). Un fichero corrupto, de versión desconocida no migrable, o que falla la validación final, debe producir un **error legible en lenguaje de usuario** y abortar la importación sin tocar el estado actual, nunca una excepción no capturada que tumbe la UI.
**Rationale:** Regla de oro del proyecto ("importar un proyecto nunca debe poder romper la app"). `safeParse` devuelve un discriminated union manejable sin try/catch.
**Sources:**
- https://zod.dev/basics
- https://github.com/colinhacks/zod
**Confidence:** alta

### 2.5 Política explícita de versiones soportadas
**Claim:** Ser explícito sobre cuántas versiones antiguas acepta el loader y cuándo dejan de soportarse; idealmente, desplegar soporte de lectura de una nueva versión **antes** de empezar a escribirla.
**Rationale:** Evita ficheros "del futuro" que un cliente viejo no entiende; documenta la ventana de compatibilidad.
**Sources:**
- https://offlinetools.org/a/json-formatter/schema-versioning-for-json-configuration-files
**Confidence:** media

---

## 3. Zod: esquemas Capa 1 / Capa 2, inferencia, rendimiento y errores

### 3.1 `safeParse` en los bordes; discriminated union
**Claim:** `safeParse` devuelve `{ success: true, data }` o `{ success: false, error }` (discriminated union) en lugar de lanzar. Es el método correcto en los **bordes** (importar fichero, recibir salida del discretizador/solver) donde el dato es menos fiable. `parse` lanza `ZodError` y se reserva para invariantes internas donde un fallo es un bug.
**Rationale:** Manejo de errores explícito sin try/catch; alineado con "todo dato que entra se valida".
**Sources:**
- https://zod.dev/basics
- https://github.com/colinhacks/zod
**Confidence:** alta

### 3.2 `z.infer` como única fuente de verdad de tipos
**Claim:** Derivar los tipos TS de los esquemas con `z.infer<typeof schema>`; si el esquema cambia, el tipo se actualiza solo. Para esquemas con `transform` (entrada/salida divergen), usar `z.input<>` y `z.output<>` por separado.
**Rationale:** Elimina duplicación esquema↔tipo y deriva (drift) entre validación runtime y tipos. Relevante para Capa 1 (modelo de dominio) y Capa 2 (contrato FEM), que ya tienen tipos explícitos: conviene que el esquema Zod sea la fuente y el tipo se infiera.
**Sources:**
- https://zod.dev/basics
- https://github.com/colinhacks/zod
- https://dev.to/safal_bhandari/zod-inference-2m86
**Confidence:** alta

### 3.3 Definir esquemas una vez a nivel de módulo (rendimiento)
**Claim:** Instanciar los esquemas una sola vez (en init de módulo) y reutilizarlos; no recrearlos por validación. En código crítico, `safeParse` puede ser **más rápido** que `parse` dentro de try/catch porque lanzar excepciones es caro.
**Rationale:** Pequeña ganancia de rendimiento y claridad; importante si se valida la Capa 2 (que puede tener muchos nodos/barras) en cada cálculo.
**Sources:**
- https://stevekinney.com/courses/full-stack-typescript/zod-best-practices
- https://medium.com/@weidagang/zod-schema-validation-made-easy-195f86d82d44
**Confidence:** media

### 3.4 Mensajes de error útiles en lenguaje de obra
**Claim:** `ZodError.issues` es un array con `code`, `path`, `expected` y `message` por problema. Permite mapear el `path` al elemento de dominio culpable y traducir a lenguaje de obra ("El pilar P3...") en lugar de mostrar el error crudo de Zod.
**Rationale:** Coherente con la regla del proyecto de devolver errores que apuntan al elemento culpable. La validación de import/discretizador debe transformar `issues` en mensajes de usuario.
**Sources:**
- https://zod.dev/basics
- https://testdouble.com/insights/type-safety-at-runtime-with-zod
**Confidence:** alta

### 3.5 Validar la salida del discretizador (Capa 2) con Zod
**Claim:** El JSON de contrato FEM (Capa 2: `nodes`, `materials`, `members`, `supports`, `releases`, `loads`, `combos`) debe validarse con un esquema Zod antes de enviarlo al worker, usando `safeParse`.
**Rationale:** El discretizador es código crítico; validar su salida atrapa bugs de generación antes de que lleguen a PyNite (donde el error sería opaco). Es un borde según la regla de oro.
**Sources:**
- https://zod.dev/basics
- https://github.com/colinhacks/zod
**Confidence:** alta

---

## 4. Estrategia de testing por capas

### 4.1 Dominio y discretizador: unit + golden en Node puro
**Claim:** Los tests del discretizador y del dominio corren en entorno **Node** (sin jsdom, sin Pyodide), porque son puros. Los **golden tests** comparan la salida del discretizador (y, donde aplique, del pipeline) contra casos de libro con solución analítica conocida (viga biapoyada con carga uniforme, voladizo con puntual, pórtico simple, celosía).
**Rationale:** Máxima velocidad y determinismo; el discretizador es "el producto" y necesita la red de seguridad más densa. Node puro porque no toca DOM ni Python.
**Sources:**
- https://vitest.dev/guide/environment
- https://vitest.dev/guide/projects
**Confidence:** alta

### 4.2 Componentes (inspector/diálogos): RTL en jsdom, queries por rol
**Claim:** Inspector, diálogos y formularios se testean con React Testing Library en entorno **jsdom**, consultando por rol/etiqueta/texto accesible (`getByRole`, `getByLabel`) en vez de selectores CSS, y simulando interacción de usuario.
**Rationale:** Tests resilientes al refactor y centrados en comportamiento observable por el usuario, no en estructura interna.
**Sources:**
- https://vitest.dev/guide/environment
- https://testing-library.com/docs/queries/about/#priority
**Confidence:** alta

### 4.3 E2E con Playwright: aislamiento por contexto y fixtures
**Claim:** El flujo F1 (definir plantas → pilares → vigas → cargas → calcular → resultados) se cubre con Playwright. Cada test corre en un **contexto de navegador fresco** (sin estado compartido entre specs), usando **fixtures** para setup/teardown en lugar de estado global, y locators por rol/`getByTestId` con esperas integradas (no `sleep` arbitrarios).
**Rationale:** Playwright paraleliza por defecto; el aislamiento previene flakiness. Para esta app, además hay que esperar a que el motor (Pyodide) esté listo antes de "Calcular".
**Sources:**
- https://playwright.dev/docs/best-practices
- https://www.deviqa.com/blog/guide-to-playwright-end-to-end-testing-in-2025/
- https://momentic.ai/blog/playwright-e2e-testing-best-practices
**Confidence:** alta

### 4.4 Pirámide de tests adaptada
**Claim:** Mayoría de cobertura en unit + golden (rápidos, Node); capa media de componentes (jsdom); pocos E2E (lentos, navegador real con Pyodide). Los golden del pipeline completo pueden mockear el solver o usar Pyodide según coste de CI.
**Rationale:** Equilibra confianza y velocidad; concentra el esfuerzo donde está el riesgo (cálculo) sin pagar el coste de Pyodide en cada commit.
**Sources:**
- https://vitest.dev/guide/projects
- https://playwright.dev/docs/best-practices
**Confidence:** media

---

## 5. Testing del solver / Pyodide: mock vs real

### 5.1 Dos niveles: mock del `solverClient` + integración real reducida
**Claim:** Estrategia recomendada en dos niveles. **(1)** Tests del pipeline TS (obra → discretizar → enviar) mockeando `solverClient` (Comlink) para no cargar Pyodide: rápidos, deterministas, en la suite normal. **(2)** Un conjunto **pequeño** de tests de integración con **Pyodide real** que cargan PyNite y verifican que `pynite_glue.py` devuelve los esfuerzos correctos de los golden cases; lentos, ejecutados aparte (navegador/CI dedicado), no en cada cambio.
**Rationale:** Pyodide tarda en arrancar (descarga ~15–30 MB + init de numpy/scipy); meterlo en la suite unitaria la haría inviable. Pero hace falta al menos una validación end-to-end de que el glue Python produce los números correctos.
**Sources:**
- https://pyodide-components.readthedocs.io/en/latest/faster_pyodide_testing.html
- https://github.com/pyodide/pytest-pyodide
- https://vitest.dev/guide/browser/component-testing
**Confidence:** media

### 5.2 Reutilizar una sola instancia de Pyodide entre tests
**Claim:** Cuando se usa Pyodide real, **reutilizar una única instancia** de Pyodide a lo largo de muchos tests (en lugar de reinicializar por test) acelera drásticamente la suite de integración.
**Rationale:** El coste dominante es el arranque del intérprete y la carga de paquetes; amortizarlo entre tests es la optimización principal documentada.
**Sources:**
- https://pyodide-components.readthedocs.io/en/latest/faster_pyodide_testing.html
- https://pyodide-components.readthedocs.io/en/latest/TODO.html
**Confidence:** media

### 5.3 `pytest-pyodide` y matriz de navegadores en CI
**Claim:** Existe `pytest-pyodide` (plugin oficial) que permite testear código que corre bajo Pyodide en una matriz de navegador/OS vía GitHub Actions. Es una opción para validar el glue Python directamente, complementaria a los tests Vitest.
**Rationale:** Si la lógica crítica del solver vive en `pynite_glue.py`, testearla en su entorno real (Pyodide en navegador) da la confianza más alta, aunque a coste elevado de CI.
**Sources:**
- https://github.com/pyodide/pytest-pyodide
**Confidence:** media

### 5.4 Golden cases como contrato compartido mock↔real
**Claim:** Los mismos golden cases (entrada de obra + resultados esperados) sirven tanto para el test mockeado (verificando la forma del JSON que se envía) como para el test real (verificando los números que devuelve PyNite). El mock devuelve los resultados golden precomputados.
**Rationale:** Una sola fuente de verdad de casos de prueba; el mock no inventa resultados, reproduce los validados por el test real.
**Sources:**
- https://pyodide-components.readthedocs.io/en/latest/faster_pyodide_testing.html
- https://vitest.dev/guide/mocking
**Confidence:** media

---

## 6. Configuración Vitest + Vite

### 6.1 `test.projects` para separar entornos node/jsdom
**Claim:** Definir múltiples proyectos en `vitest.config.ts` con `test.projects: [...]`, cada uno con su `name`, `include` (patrón de ficheros) y `environment` (`node` para dominio/discretizador/golden, `jsdom` para componentes). Usar `extends: true` para heredar plugins y config del root.
**Rationale:** Permite correr en un solo comando los tests puros en Node (rápidos) y los de componentes en jsdom, cada uno en el entorno correcto, sin configs separadas.
**Sources:**
- https://vitest.dev/guide/projects
- https://deepwiki.com/vitest-dev/vitest/4.6-multi-project-and-workspace-support
**Confidence:** alta

**Ejemplo:**
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: 'dominio', environment: 'node',  include: ['src/{dominio,discretizador,unidades}/**/*.test.ts'] } },
      { extends: true, test: { name: 'golden',  environment: 'node',  include: ['tests/golden/**/*.test.ts'] } },
      { extends: true, test: { name: 'ui',      environment: 'jsdom', include: ['src/ui/**/*.test.tsx'] } },
    ],
  },
})
```

### 6.2 Coverage es global al proceso (no per-project)
**Claim:** En Vitest (v3/v4), la cobertura se calcula para todo el proceso y se **comparte** entre proyectos en un informe unificado; no se puede configurar coverage por proyecto de forma type-safe (hay feature request abierta).
**Rationale:** Configurar `coverage` una vez a nivel root; no intentar overrides por proyecto. El informe combina todas las suites.
**Sources:**
- https://vitest.dev/guide/projects
- https://github.com/vitest-dev/vitest/issues/9470
**Confidence:** alta

### 6.3 Ejecutar proyectos selectivamente
**Claim:** Se puede correr un subconjunto con `vitest --project dominio` (o varios `--project`), útil para iterar rápido solo sobre el discretizador o solo sobre la UI.
**Rationale:** Acelera el ciclo de desarrollo enfocado; el CI corre todos.
**Sources:**
- https://vitest.dev/guide/projects
**Confidence:** alta

### 6.4 jsdom vs happy-dom
**Claim:** Para entornos tipo navegador, Vitest soporta `jsdom` o `happy-dom`; `happy-dom` suele ser más rápido pero con menor cobertura de API. Para RTL, jsdom es la opción más compatible y por defecto recomendada.
**Rationale:** Empezar con jsdom (compatibilidad) y considerar happy-dom solo si la suite de UI se vuelve lenta.
**Sources:**
- https://vitest.dev/guide/environment
- https://vitest.dev/guide/features
**Confidence:** media

---

## 7. Robustez general (worker, estados de carga, recuperación)

### 7.1 Estados de carga del motor visibles
**Claim:** Exponer estados explícitos: "cargando motor" (mientras Pyodide + numpy + scipy se descargan/inicializan, ~15–30 MB, se cachea tras la primera vez) y "calculando". Habilitar "Calcular" solo cuando el worker reporta listo; precargar Pyodide en segundo plano mientras el usuario modela.
**Rationale:** Regla del proyecto (cálculo asíncrono, estados visibles). La primera carga es lenta; ocultarla degrada la percepción de fiabilidad.
**Sources:**
- https://pyodide.org/en/stable/usage/loading-packages.html
- https://dexie.org/docs/StorageManager
**Confidence:** alta

### 7.2 Errores del worker tipados y propagados a la UI
**Claim:** Los errores del solver (fallo de carga de Pyodide, error de PyNite, modelo no resoluble/mecanismo) deben capturarse en el worker, serializarse como un resultado de error tipado y propagarse vía Comlink a la UI como un estado manejable, no como un crash del worker.
**Rationale:** El usuario debe ver "no se pudo calcular: la estructura no está sujeta" en lenguaje de obra; el aislamiento de Pyodide en `/solver` exige traducir errores Python a errores de dominio.
**Sources:**
- https://github.com/colinhacks/zod (validación de resultados antes de consumirlos)
- https://playwright.dev/docs/best-practices (verificar estos estados en E2E)
**Confidence:** media

### 7.3 Timeouts y cancelación del cálculo
**Claim:** Aplicar un timeout al cálculo en el worker (un modelo patológico podría no converger) y permitir cancelar/reintentar sin recargar la app, manteniendo la obra intacta.
**Rationale:** Evita que la UI quede colgada en "calculando" indefinidamente; recuperación sin pérdida de datos.
**Sources:**
- https://pyodide.org/en/stable/usage/webworker.html
**Confidence:** baja

### 7.4 Recuperación tras fallo: la obra sobrevive, los resultados se invalidan
**Claim:** Un fallo del solver no debe afectar a la persistencia de la Capa 1. Los resultados (Capa 2 / esfuerzos / deformada) son **derivados** y se invalidan al fallar o al editar; el autosave de la obra es independiente y continúa. Tras recargar, la obra se restaura desde IndexedDB.
**Rationale:** Coherente con el modelo de dos capas: solo la Capa 1 se persiste; resultados se recalculan. El usuario nunca pierde su modelo por un error de cálculo.
**Sources:**
- https://dexie.org/docs/Table/Table.put()
- https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
**Confidence:** alta

### 7.5 Validar resultados del worker antes de consumirlos
**Claim:** Aplicar `safeParse` (Zod) también a la **salida** del worker (resultados de PyNite) antes de pasarla al `resultadosStore`/UI.
**Rationale:** El JSON que vuelve del Python es otro borde; validarlo atrapa cambios de formato del glue y evita que un resultado malformado rompa la visualización.
**Sources:**
- https://zod.dev/basics
**Confidence:** media

---

## Recomendaciones accionables

1. **BD Dexie con un documento por proyecto.** Tabla `proyectos { id (PK), nombre, updatedAt }` indexando solo metadatos; el `Modelo` (Capa 1) completo como valor no indexado. Versionar con `version(n).stores()` y conservar solo las versiones con `upgrade()`.
2. **Autosave debounced (500–1000 ms).** Función debounced creada una vez (ref/useMemo), persiste el snapshot del `modeloStore` en un `put()` transaccional. Invalidar resultados al editar.
3. **Pedir persistencia.** Llamar a `tryPersistWithoutPromtingUser()` al cargar; tras la primera acción significativa, ofrecer/solicitar `navigator.storage.persist()`. Monitorizar con `navigator.storage.estimate()` y manejar `QuotaExceededError` con aviso + sugerencia de export.
4. **Formato .json versionado.** Raíz con `{ app, schemaVersion, createdAt, modelo }`. Loader: parse → detectar `schemaVersion` → migrar v1→v2→… → `safeParse` contra esquema actual → entregar. Errores de import siempre legibles, nunca excepción no capturada.
5. **Zod como fuente de verdad.** Un esquema por Capa 1 y Capa 2; tipos vía `z.infer`. `safeParse` en todos los bordes (import, salida del discretizador, salida del worker). Mapear `ZodError.issues[].path` a mensajes en lenguaje de obra.
6. **Validar la salida del discretizador.** El JSON de contrato FEM se valida con Zod antes de ir al worker; atrapa bugs del corazón del producto antes de PyNite.
7. **Vitest con `test.projects`.** Proyectos `dominio`/`golden` en `node`, `ui` en `jsdom`. Coverage global a nivel root. Permitir `--project` para iterar.
8. **Golden tests como red de seguridad principal.** Casos de libro (biapoyada, voladizo, pórtico, celosía) con solución analítica; comparar salida del discretizador y, en integración, los esfuerzos de PyNite.
9. **Solver en dos niveles.** Suite normal: mock de `solverClient` con resultados golden precomputados. Suite de integración (aparte, CI dedicado): Pyodide real reutilizando una sola instancia, validando `pynite_glue.py` contra los mismos golden cases.
10. **E2E Playwright del flujo F1** con contexto fresco por test, fixtures, locators por rol/testid, esperando a que el motor esté listo antes de "Calcular".
11. **Robustez del worker.** Estados visibles ("cargando motor"/"calculando"), precarga de Pyodide en background, errores Python traducidos a errores de dominio, timeout + cancelación, y validación Zod de los resultados.
12. **Recuperación.** Garantizar que un fallo del solver nunca corrompe ni pierde la Capa 1 persistida; los resultados son derivados y se recalculan.

---

### Fuentes (índice)
- Dexie: https://dexie.org/docs/Tutorial/Design · https://dexie.org/docs/Version/Version.stores() · https://dexie.org/docs/Version/Version.upgrade() · https://dexie.org/docs/StorageManager · https://dexie.org/docs/Table/Table.put()
- Storage/cuota: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria · https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist · https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate · https://developer.chrome.com/blog/estimating-available-storage-space · https://rxdb.info/articles/indexeddb-max-storage-limit.html
- Zod: https://zod.dev/basics · https://github.com/colinhacks/zod · https://stevekinney.com/courses/full-stack-typescript/zod-best-practices · https://testdouble.com/insights/type-safety-at-runtime-with-zod
- Versionado JSON: https://offlinetools.org/a/json-formatter/schema-versioning-for-json-configuration-files · https://jsonic.io/guides/json-schema-versioning · https://developer.couchbase.com/tutorial-schema-versioning
- Autosave/debounce: https://www.developerway.com/posts/debouncing-in-react · https://www.freecodecamp.org/news/debounce-and-throttle-in-react-with-hooks/
- Vitest: https://vitest.dev/guide/projects · https://vitest.dev/guide/environment · https://vitest.dev/guide/features · https://github.com/vitest-dev/vitest/issues/9470
- Playwright: https://playwright.dev/docs/best-practices · https://www.deviqa.com/blog/guide-to-playwright-end-to-end-testing-in-2025/ · https://momentic.ai/blog/playwright-e2e-testing-best-practices
- Pyodide testing: https://pyodide-components.readthedocs.io/en/latest/faster_pyodide_testing.html · https://github.com/pyodide/pytest-pyodide · https://pyodide.org/en/stable/usage/webworker.html
- RTL: https://testing-library.com/docs/queries/about/#priority
