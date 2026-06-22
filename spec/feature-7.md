# feature-7 · Estado (Zustand stores + undo/redo Command)

> Tier 2 · **Dependencias: feature-2** · Bloquea: 8, 9, 10–14.

## Objetivo

Gestionar el estado de la app con **cuatro ámbitos separados** y un sistema de **undo/redo por patrón Command** (delta, no snapshots), invalidando resultados al editar la obra.

## Alcance

**Incluye** (`/src/estado`)
- `modeloStore` (Zustand + Immer): el `Modelo` (Capa 1). **Único origen de la obra** y único en la pila de undo. Persistente (la persistencia real la hace feature-8).
- `seleccionStore`: elementos seleccionados, hover.
- `vistaStore`: pestaña activa (pilares/vigas/resultados/isovalores), grupo activo, modo de vista (planta/3D/mosaico), combinación activa, plantillas/capturas.
- `resultadosStore`: resultados del último cálculo (**derivados**; se **limpian al editar** la obra).
- **Undo/redo (patrón Command)** en `comandos/`: cada edición de obra (crear pilar, mover viga, asignar sección) es un comando con `aplicar()`/`revertir()` que guarda el **delta**, no snapshots completos. Composite/transacción para acciones multiparte; **coalescing** en arrastres.
- Middleware `subscribeWithSelector` para **transient updates** (suscripción fuera del ciclo de render; lo consume el viewport en feature-9).
- Al modificar Capa 1 ⇒ **invalidar** `resultadosStore`.

**Excluye**: persistencia IndexedDB (feature-8), render (feature-9), comandos concretos de cada pestaña (se añaden en feature-10–13, pero la infraestructura Command vive aquí).

## Entradas de I+D

- Hallazgos #11 (transient updates, `subscribeWithSelector`), #12 (tres+un ámbitos, Command con delta).
- `CLAUDE.md §10`, Área 3 §1-2.

## Contrato (orientativo)

```ts
interface Comando { aplicar(): void; revertir(): void; etiqueta: string; }
interface PilaUndo { ejecutar(c: Comando): void; deshacer(): void; rehacer(): void; }
```

## Criterios de aceptación

- Los cuatro stores existen y están separados; solo `modeloStore` participa en undo.
- `ejecutar`/`deshacer`/`rehacer` funcionan con comandos que guardan delta (test: crear pilar → deshacer → estado idéntico al previo).
- Editar la Capa 1 limpia `resultadosStore`.
- `subscribe(selector, cb)` funciona (middleware `subscribeWithSelector` presente — corrección de verificación de la I+D).
- Coalescing de arrastres: una ráfaga de movimientos = un solo paso de undo.
- Unit tests de stores y de la pila de comandos (proyecto `node`/`jsdom`).

## Notas / riesgos

- No usar snapshots completos del modelo salvo para acciones masivas (coste de memoria/undo).
- No meter lógica de cálculo en los stores.
