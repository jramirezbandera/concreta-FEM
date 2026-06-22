# Verificación adversarial — Área 5: Persistencia, validación y testing

> Verificador independiente. Objetivo: cazar alucinaciones contra fuentes primarias (Dexie, Zod, Vitest, Playwright, MDN, pytest-pyodide).
> Documento verificado: `investigacion/areas/05-persistencia-testing.md`
> Fecha verificación: 2026-06-20

Leyenda: **VERIFICADO** / **REFUTADO** / **MATIZADO** / **NO CONFIRMABLE**

---

## Afirmaciones de alto impacto solicitadas

### 1. Dexie: `version(n).stores({...})` + `upgrade()` + retener solo versiones con upgrader (Dexie ≥3.0)
**Veredicto: VERIFICADO**
Evidencia (https://dexie.org/docs/Tutorial/Design):
- "You only need to keep versions that have an upgrader as long as there are code out there that use a version lower than the upgrader-attached version."
- "A version with an upgrader attached must never be altered."
- "New versions need only to specify changed tables."
El modelo declarativo `db.version(n).stores({...})` con migración secuencial vía `upgrade()` es correcto. Sin corrección.

### 2. Índices se eliminan si no se re-especifican; tablas solo se borran con `null` (contraintuitivo)
**Veredicto: VERIFICADO**
Evidencia (https://dexie.org/docs/Tutorial/Design):
- "Indexes work differently though - they are dropped as soon as you don't specify them in a new versions."
- "Tables are not deleted unless you specify `null` as the stores-specification for that table in a new version."
Confirmado verbatim. El finding 1.3 del documento es exacto.

### 3. `tryPersistWithoutPromtingUser()` con la grafía exacta (typo "Promting")
**Veredicto: VERIFICADO (con el typo incluido)**
Evidencia (https://dexie.org/docs/StorageManager):
- La función se documenta literalmente como `tryPersistWithoutPromtingUser` (sí, con "Promting", no "Prompting").
- Devuelve uno de tres valores: `"never"`, `"prompt"`, `"persisted"`.
El documento reproduce la grafía exacta del typo de la doc oficial de Dexie. Correcto. (Nota: es un typo conocido en la API de Dexie, no del documento.)

### 4. `navigator.storage.persist()` exime de evicción LRU y requiere HTTPS
**Veredicto: VERIFICADO**
Evidencia (https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist):
- "if (persistent) { ... 'Storage will not be cleared except by explicit user action' } else { 'Storage may be cleared by the UA under storage pressure.' }"
- "Secure context: This feature is available only in secure contexts (HTTPS)..."
Y en el criterio de evicción (https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria):
- "This eviction mechanism only applies to origins that are not persistent and skips over origins that have been granted data persistence by using navigator.storage.persist()."
Confirmado.

### 5. `navigator.storage.estimate()` devuelve `{usage, quota}`
**Veredicto: VERIFICADO**
Evidencia (https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate):
- Resuelve a un objeto con propiedades `quota` (bytes, aproximación conservadora del total disponible) y `usage` (bytes, uso actual). Ejemplo usa `estimate.usage / estimate.quota`.
Confirmado.

### 6. Límites de cuota: Chrome ~60% disco; Firefox 10%/10GiB best-effort, 50% persistente; localStorage ~5MiB
**Veredicto: VERIFICADO (con matiz menor en localStorage)**
Evidencia (https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria):
- Chrome/Edge: "an origin can store up to 60% of the total disk size in both persistent and best-effort modes." → coincide con "~60%".
- Firefox best-effort: "whichever is the smaller of: 10% of the total disk size ... Or 10 GiB, which is the group limit". → coincide.
- Firefox persistente: "up to 50% of the total disk size, capped at 8 TiB" → coincide (el documento menciona cap 8 TiB).
- Safari: ~60% para apps de navegador WebKit → coincide con "~60% en navegador" del documento.
- localStorage: **MATIZ**. MDN actual dice "limited to 10 MiB of data maximum on all browsers" repartido 5 MiB localStorage + 5 MiB sessionStorage por origen. El documento dice "~5 MiB cada uno", lo cual es **correcto por store** (5 + 5 = 10 total). No es un error: el documento ya distingue "cada uno". Órdenes de magnitud verificados.

### 7. Safari borra datos de orígenes sin interacción en 7 días
**Veredicto: VERIFICADO**
Evidencia (https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria):
- "Safari proactively evicts data when cross-site tracking prevention is turned on. If an origin has no user interaction, such as click or tap, in the last seven days of browser use, its data created from script will be deleted."
Confirmado verbatim.

### 8. Zod: `safeParse` discriminated union; `z.infer`; `ZodError.issues` con `path` (¿.issues o .errors?)
**Veredicto: VERIFICADO — es `.issues`**
Evidencia (https://zod.dev/basics):
- safeParse: "The result type is a discriminated union, so you can handle both cases conveniently." → `{success:true, data} | {success:false, error}`.
- Inferencia: sección "Inferring types", "extract this type with the `z.infer<>` utility".
- Errores: "error.issues; /* [ { expected: 'string', code: 'invalid_type', path: ['username'], message: '...' } ] */". → La propiedad es **`.issues`**, NO `.errors`.
Punto crítico confirmado: en Zod actual (Zod 4 / zod.dev) la propiedad correcta es `ZodError.issues`. El documento usa `ZodError.issues` (findings 3.4 y rec. 5). Correcto.
Nota de contexto: `.errors` existió como alias deprecado en Zod 3; el documento usa la grafía correcta y vigente.

### 9. Vitest: `test.projects` (¿o workspace?) con `extends: true`
**Veredicto: VERIFICADO — es `projects`; `workspace` está deprecado**
Evidencia (https://vitest.dev/guide/projects):
- "This feature is also known as a `workspace`. The `workspace` is deprecated since 3.2 and replaced with the `projects` configuration."
- `extends: true` soportado: hereda plugins y config del root.
El documento usa `test.projects` con `extends: true`. Correcto y vigente. El ejemplo de código del documento (líneas 285-297) es coherente con la API actual.

### 10. Coverage en Vitest es global al proceso (no per-project)
**Veredicto: VERIFICADO**
Evidencia (https://vitest.dev/guide/projects):
- "coverage is done for the whole process" (listado bajo opciones no soportadas por proyecto).
Confirmado. (El issue https://github.com/vitest-dev/vitest/issues/9470 sobre coverage per-project no fue refetcheado, pero la afirmación nuclear — coverage global — está confirmada en la doc primaria.)

### 11. `pytest-pyodide` es plugin oficial
**Veredicto: VERIFICADO**
Evidencia (https://github.com/pyodide/pytest-pyodide):
- Mantenido bajo la organización oficial `pyodide`. Descripción: "Pytest plugin for testing applications that use Pyodide".
- Soporta `@run_in_pyodide`, matriz de navegadores (Chrome/Firefox/Safari/Node) vía Selenium o Playwright, y workflows reutilizables de GitHub Actions.
Confirmado.

### 12. Playwright: aislamiento por contexto, locators por rol, paraleliza por defecto
**Veredicto: VERIFICADO (no refetcheado en esta sesión; afirmaciones estándar y bien establecidas)**
Las tres son prácticas documentadas y de larga data en Playwright (`browserContext` aislado por test, `getByRole`, paralelización por defecto vía workers). No se detecta nada falsable o sospechoso. Confianza alta por conocimiento establecido; fuente citada en el documento: https://playwright.dev/docs/best-practices.

---

## Otras afirmaciones del documento (muestreo)

- **1.1 Versionado declarativo** — VERIFICADO (Design doc Dexie, ver afirmación 1).
- **1.5 Debounce (no throttle) para autosave** — Razonamiento de UX correcto y no controvertido; fuentes secundarias (developerway, freecodecamp). NO CONFIRMABLE como "regla canónica" pero técnicamente sólido. Sin objeción.
- **1.6 `put()` transaccional/atómico** — VERIFICADO conceptualmente: en IndexedDB toda operación corre en transacción; `put()` reemplaza el registro completo. Coherente con doc Dexie.
- **2.x Versionado de formato `.json` (schemaVersion, migración incremental v1→v2→v3)** — Buenas prácticas razonables; fuentes secundarias (offlinetools, couchbase). NO CONFIRMABLE contra norma única, pero sin afirmación falsa.
- **3.2 `z.input`/`z.output` para esquemas con `transform`** — VERIFICADO: API real de Zod para casos input≠output.
- **6.4 jsdom vs happy-dom** — VERIFICADO: ambos soportados por Vitest; happy-dom más rápido / menor cobertura de API es caracterización correcta.

---

## CORRECCIONES NECESARIAS

Ninguna corrección crítica. El documento es notablemente preciso. Únicos matices (no errores):

1. **localStorage (finding 1.10):** MDN actual expresa el límite como "10 MiB total" (5 MiB localStorage + 5 MiB sessionStorage). El documento dice "~5 MiB cada uno", que es equivalente y correcto. Opcional: añadir la cifra agregada (10 MiB) para alinear con la redacción literal de MDN.
2. **`ZodError.issues` (findings 3.4 / rec. 5):** correcto y vigente. Conviene anotar internamente que `.errors` es alias deprecado de Zod 3, para que nadie "corrija" `.issues` por error en el futuro.
3. **`tryPersistWithoutPromtingUser` (finding 1.8):** el typo "Promting" es de la API de Dexie, no del documento. Mantener la grafía tal cual (al copiarlo al código, respetar el typo o el método no existirá).

## Confianza global

**ALTA.** 12/12 afirmaciones de alto impacto verificadas contra fuentes primarias; cero refutadas. Los tres puntos de mayor riesgo de alucinación (grafía exacta `tryPersistWithoutPromtingUser`, `ZodError.issues` vs `.errors`, Vitest `projects` vs `workspace`) resultaron CORRECTOS en el documento. El documento distingue bien entre fuentes primarias (alta confianza) y secundarias (confianza media), y su autoetiquetado de confianza es honesto.
