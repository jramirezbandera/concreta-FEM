# feature-8 · Persistencia (Dexie/IndexedDB + export/import `.json`)

> Tier 2 · **Dependencias: feature-2, feature-7** · Bloquea: 16.

## Objetivo

Persistir la **Capa 1** de forma robusta en IndexedDB con autosave, y permitir **export/import** del proyecto como `.json` propio, siempre validado con Zod. La Capa 2 y los resultados **no** se guardan (se regeneran).

## Alcance

**Incluye** (`/src/persistencia`)
- **Dexie**: tabla `proyectos { id, nombre, updatedAt }` indexando **solo metadatos**; el `Modelo` se guarda como **blob**.
- **Autosave** con **debounce 500–1000 ms** (no throttle), `put()` atómico (hallazgo #14).
- Persistencia contra evicción: `navigator.storage.persist()` (HTTPS), manejar `QuotaExceededError`, `estimate()`.
- **Export/Import `.json`** (formato propio Concreta) con `schemaVersion` y **migración incremental** v1→v2→… (hallazgo #15, Área 5 §1-2).
- **Import siempre con Zod `safeParse`** (no `parse`); mapear `error.issues[].path` a **lenguaje de obra**. Importar **nunca rompe la app**.

**Excluye**: UI de gestión de proyectos avanzada (mínimo: nuevo/abrir/exportar/importar), Capa 2/resultados (no se guardan).

## Entradas de I+D

- Hallazgos #14 (Dexie/autosave/evicción), #15 (Zod en import, `.issues`).
- `CLAUDE.md §12`, Área 5 §1-3.

## Contrato (orientativo)

```ts
interface Persistencia {
  guardarAuto(modelo: Modelo): void;          // debounced put()
  cargar(id: string): Promise<Modelo | null>;
  exportar(modelo: Modelo): Blob;             // .json
  importar(file: File): Promise<ResultadoImport>; // safeParse + migración
}
type ResultadoImport = { ok: true; modelo: Modelo } | { ok: false; errores: string[] };
```

## Criterios de aceptación

- Editar la obra dispara autosave debounced; recargar la página restaura el proyecto.
- Exportar produce `.json` con `schemaVersion`; importarlo reconstruye el modelo.
- Importar un `.json` corrupto/incompleto ⇒ `{ ok:false, errores }` en lenguaje de obra, **sin** romper la app.
- Migración v(n-1)→v(n) probada con un fixture antiguo.
- `QuotaExceededError` se maneja con mensaje claro.
- Tests en proyecto `jsdom` (con fake-indexeddb o similar).

## Notas / riesgos

- Nunca persistir Capa 2 ni resultados como fuente de verdad.
- Debounce, no throttle (hallazgo #14, explícito).
