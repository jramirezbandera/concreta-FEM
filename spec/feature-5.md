# feature-5 · El solver (Pyodide + PyNite en Web Worker)

> Tier 1 · Motor · **Dependencias: feature-4** · Bloquea: 6, 14, 16.

## Objetivo

Resolver la Capa 2 con **PyNite sobre Pyodide/WASM en un Web Worker**, exponiendo a la app una API asíncrona limpia (`solverClient` vía Comlink) que oculta por completo que existe Python. Todo el Python vive en `/src/solver`.

## ⚠️ Versiones (pinear exactas, nunca "latest")

- **Par recomendado MVP:** **Pyodide 0.28.x + PyNiteFEA 2.0.2** (numpy 2.2.5 / scipy 1.14.1 / Py 3.13). Estable, sin el pin `numpy>=2.4` (hallazgos #1, #2).
- **No** instalar PyNite ≥2.1.0 / 3.0.0 en Pyodide <314: exigen `numpy>=2.4` y la resolución **falla**.
- **Confirmar el par empíricamente** extremo a extremo al montar (decisión abierta del `CLAUDE.md §18`, Tier B #20).

## Alcance

**Incluye** (`/src/solver`)
- `worker.ts`: arranca Pyodide, carga paquetes, ejecuta cálculo. Self-host del runtime para control de versión/caché (hallazgo #20).
- **Instalación sin matplotlib** (hallazgo #10): `loadPackage(["numpy","scipy"])` → `micropip.install("PrettyTable")` → `micropip.install("PyNiteFEA==2.0.2", deps=False)`. **Verificar import a import** que PyNite no haga `import matplotlib` a nivel de módulo. **Nunca `[all]`.**
- `pynite_glue.py`: recibe el JSON de Capa 2, construye `FEModel3D` (`add_material/add_section/add_node/add_member/def_support/def_releases/add_load_combo/add_*_load`), llama `analyze()`/`analyze_linear()` (PDelta reservado F2), y devuelve JSON de resultados: esfuerzos por barra vía `*_array()`, deformada, reacciones (`Node.Rxn*[combo]`, `Node.D*[combo]`). `check_statics` cuando proceda. `sparse=True` (scipy).
- `solverClient.ts`: API Comlink (`expose`/`wrap`) hacia la UI: `cargarMotor()`, `estadoMotor`, `calcular(modeloFEM)`. Precarga en background.
- `resultados.ts`: tipos de resultados (esfuerzos, deformada, reacciones). **Materializar ndarrays a typed arrays antes de cruzar Comlink.**
- Estados visibles "cargando motor" / "calculando"; timeout y cancelación; los errores Python se mapean a errores de dominio.

**Excluye**: render de resultados (feature-14), discretización (feature-4), reimplementar nada de FEM.

## Entradas de I+D

- Hallazgos #1, #2, #6, #10, #20; Área 1 completa (`areas/01-motor-fem.md`) y su verificación.
- `CLAUDE.md §8` (restricciones del solver), `PyNite_Guia_Completa.md`.

## API esperada (Comlink)

```ts
interface SolverClient {
  cargarMotor(): Promise<void>;
  estadoMotor(): Promise<"frio"|"cargando"|"listo"|"error">;
  calcular(fem: ModeloFEM): Promise<Resultados>;  // valida salida con Zod
}
```

## Criterios de aceptación

- El worker arranca Pyodide, instala PyNite **sin matplotlib/vtk/pyvista**, y resuelve un caso trivial (biapoyada UDL) devolviendo M/δ correctos.
- La UI nunca llama a Python directamente; solo a `solverClient`.
- La salida del worker valida con Zod (`safeParse`) antes de llegar a la app.
- Toda llamada es asíncrona; el hilo principal no se bloquea.
- Versiones pineadas exactas y documentado el par Pyodide↔PyNite que funciona.

## Notas / riesgos

- Primera carga decenas de MB (cacheada); instanciación WASM ~4–5 s aun con caché; techo memoria WASM ~2 GB. Cifras orientativas: **medir el par elegido**.
- Aislamiento total: ningún otro módulo importa nada de Pyodide.
