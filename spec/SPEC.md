# SPEC · Concreta · Estructuras — Especificación F1 (MVP)

> **Qué es esto.** Especificación ejecutable del **MVP (Fase 1)** de Concreta · Estructuras: app web de cálculo estructural por elementos finitos para arquitectos, interfaz calcada a CYPECAD, motor PyNite sobre Pyodide/WASM, modelo de dos capas. Destila el documento de I+D (`/investigacion/ID-Concreta-Estructuras.md`) y el `CLAUDE.md` del proyecto en un plan de trabajo troceado.
>
> **Fecha:** 2026-06-20 · **Alcance:** solo F1. F2–F4 quedan fuera (solo mencionadas como futuro).
>
> **Cómo usar este documento.** Cada `feature-N.md` está dimensionada para ser **una única tarea de Modo Planificación** (Plan Mode): autocontenida, con objetivo, entradas de I+D, archivos a tocar, contrato y criterios de aceptación. Carga **solo** la feature que vayas a planificar, más este índice. El orden del **índice por prioridad** es el orden recomendado de ejecución: respeta dependencias (de cimientos hacia arriba).

---

## 0. Decisiones tomadas para esta spec

| Tema | Decisión | Origen |
| --- | --- | --- |
| **Alcance** | Solo **F1 (MVP)**. Pórticos de pilares + vigas por plantas → calcular esfuerzos y deformada. Sin armado ni comprobación normativa. | Usuario |
| **Materiales del MVP** | **Hormigón y acero, ambos** desde F1. | Usuario |
| **Normativa de hormigón** | **Código Estructural (RD 470/2021)**, no EHE-08 (derogada). EAE también queda subsumida en el Código Estructural para acero. | Usuario ⚠️ |
| **Ubicación** | `/spec` en la raíz del proyecto. | Usuario |
| **Granularidad** | **Híbrida**: núcleo (dominio, discretizador, solver, estado, persistencia) por capa; UI por pestaña/flujo. Minimiza superficie por tarea → menor riesgo de alucinación. | Decisión propia |

> ⚠️ **Cambio de normativa respecto a la I+D (por derogación, no por error de la I+D).** La I+D **eligió deliberadamente EHE-08** para las propiedades del hormigón (p. ej. `Ecm = 8500·fcm^(1/3)`, hallazgo #13), por coherencia con la tradición normativa española; su único *error de cálculo* corregido fue un valor numérico espurio de Ecm, no la fórmula. **Decisión del proyecto:** como **EHE-08 está derogada** (RD 470/2021), F1 usa el **Código Estructural**, alineado con Eurocódigo 2, cuyo módulo secante es del tipo `Ecm = 22000·(fcm/10)^0,3` (MPa). **El valor exacto y la nomenclatura (HA-25 vs C25/30) quedan _a verificar_ contra el texto del Código Estructural antes de cablear**; las propiedades de materiales se implementan como tabla de configuración aislada y fácilmente corregible. Ver `feature-3`. Lo mismo aplica a los coeficientes de combinación: confirmar contra el Código Estructural / CTE vigente.

---

## 1. Tesis y arquitectura (resumen operativo)

- **Dos capas.** El arquitecto edita la **Capa 1 (obra)**: grupos, plantas, pilares, vigas, cargas por hipótesis. El **discretizador** (puro) genera la **Capa 2 (FEM)**: nodos, barras, apoyos, releases, cargas, combos. PyNite resuelve. La UI visualiza.
- **PyNite es la única fuente de verdad del cálculo.** Nunca se reimplementa FEM en TS.
- **Capa 1 se persiste; Capa 2 y resultados se regeneran** en cada cálculo.
- **Unidades internas kN-m**; conversión solo en los bordes (`/src/unidades`).
- **Python aislado en `/src/solver`** (Web Worker + Comlink). El resto de la app no sabe que existe Python.
- **Red de seguridad = golden tests** del discretizador y del pipeline contra casos de libro con fórmula cerrada.

Diagrama de flujo:

```
CAPA 1 (obra) ──discretizar()──▶ CAPA 2 (JSON FEM) ──worker/Pyodide/PyNite──▶ RESULTADOS ──▶ UI
   /src/dominio    /src/discretizador (PURO)        /src/solver                      /src/ui
```

---

## 2. Índice ordenado por prioridad (orden de ejecución recomendado)

> De cimientos a acabados. Cada feature declara sus **dependencias**; no empieces una hasta tener listas las suyas. Las marcadas 🧱 son núcleo (bloquean a casi todo); 🎨 son UI.

### Tier 0 — Cimientos (bloquean todo)

| # | Feature | Archivo | Dep. | Núcleo de la tarea |
| --- | --- | --- | --- | --- |
| **1** | 🧱 Andamiaje del proyecto, stack y sistema de unidades | [feature-1.md](feature-1.md) | — | Vite+React+TS `strict`, Tailwind+tokens, Zustand, estructura de carpetas, scripts `package.json`, `/src/unidades` con conversión solo-en-bordes. |
| **2** | 🧱 Modelo de dominio (Capa 1) + validación Zod | [feature-2.md](feature-2.md) | 1 | Tipos español/ASCII (`Pilar`, `Viga`, `Grupo`, `Planta`, `Carga`, `Hipotesis`, `Seccion`, `Material`), esquemas Zod (`safeParse`, `z.infer`), `CategoriaUso` como enum que deriva qk/ψ. |

### Tier 1 — El motor de cálculo (corazón del producto)

| # | Feature | Archivo | Dep. | Núcleo de la tarea |
| --- | --- | --- | --- | --- |
| **3** | 🧱 Biblioteca de materiales y secciones (hormigón CE + acero EC3) | [feature-3.md](feature-3.md) | 2 | Materiales bajo **Código Estructural** (Ecm a verificar), acero S235/S275/S355, perfiles metálicos tabulados (J por coef. β, no polar), secciones de hormigón paramétricas. Tabla aislada y corregible. |
| **4** | 🧱 El discretizador (Capa 1 → Capa 2) + contrato FEM + validaciones | [feature-4.md](feature-4.md) | 2, 3 | `discretizar()` puro: snapping de nodos (`1e-3`), Y vertical, releases canónicos, supports, cargas (MAYÚS=global), combos CTE/CE, áreas tributarias 45°. Validaciones en lenguaje de obra. |
| **5** | 🧱 El solver (Pyodide + PyNite en Web Worker) | [feature-5.md](feature-5.md) | 4 | Par **Pyodide 0.28.x + PyNiteFEA 2.0.2** pineado, install sin matplotlib (`deps=False`), `pynite_glue.py`, `solverClient` (Comlink), tipos de resultados, typed arrays cruzando el worker. |
| **6** | 🧱 Golden tests del discretizador y del pipeline | [feature-6.md](feature-6.md) | 4, 5 | 7 casos de libro con fórmula cerrada, tolerancias (<0,1 % esfuerzos/reacciones, <1 % flechas), Vitest `test.projects` (Node), test de dirección de carga (global/local) y de ejes locales de pilar. |

### Tier 2 — Estado, persistencia y armazón de UI

| # | Feature | Archivo | Dep. | Núcleo de la tarea |
| --- | --- | --- | --- | --- |
| **7** | 🧱 Estado (Zustand stores + undo/redo Command) | [feature-7.md](feature-7.md) | 2 | `modeloStore` / `seleccionStore` / `vistaStore` / `resultadosStore`; undo/redo por patrón Command con delta; invalidación de resultados al editar; `subscribeWithSelector`. |
| **8** | 🧱 Persistencia (Dexie/IndexedDB + export/import `.json`) | [feature-8.md](feature-8.md) | 2, 7 | Autosave debounced 500–1000 ms, `put()` atómico, `schemaVersion` + migración, persistencia contra evicción, `QuotaExceededError`, import validado con Zod. |
| **9** | 🎨 Shell de UI + viewport R3F base | [feature-9.md](feature-9.md) | 7 | 4 pestañas, barra de menús por pestaña, barra lateral, barra de estado; escena R3F (planta orto / 3D persp.), `frameloop="demand"`, instancing, picking `<Bvh>`, mutación de refs en `useFrame`. |

### Tier 3 — Flujo de introducción (UI por pestaña)

| # | Feature | Archivo | Dep. | Núcleo de la tarea |
| --- | --- | --- | --- | --- |
| **10** | 🎨 Diálogo de Grupos/Plantas | [feature-10.md](feature-10.md) | 7, 9 | Crear/editar grupos y plantas (cota, altura, categoría de uso, sobrecarga, cargas muertas); grupo activo en `vistaStore`. |
| **11** | 🎨 Entrada de pilares | [feature-11.md](feature-11.md) | 9, 10 | Introducción gráfica en planta de pilares; inspector (sección, material, ángulo, arranque, vinculación exterior); comandos undo/redo. |
| **12** | 🎨 Entrada de vigas | [feature-12.md](feature-12.md) | 9, 11 | Introducción gráfica de vigas entre nudos; extremos empotrado/articulado, tirante; inspector. |
| **13** | 🎨 Cargas, hipótesis y combinaciones | [feature-13.md](feature-13.md) | 10, 11, 12 | Hipótesis, cargas lineales/superficiales por ámbito, edición; combinaciones F1 (ELU persistente + ELS característica) derivadas de categoría de uso. |

### Tier 4 — Resultados y salidas

| # | Feature | Archivo | Dep. | Núcleo de la tarea |
| --- | --- | --- | --- | --- |
| **14** | 🎨 Resultados (deformada + diagramas + reacciones) | [feature-14.md](feature-14.md) | 5, 6, 9, 13 | Disparar cálculo asíncrono (estados motor/calculando), deformada 3D con escala de color + animación, diagramas N/V/M/flecha (Plotly aislado), tabla de reacciones, selector de combinación. |
| **15** | 🎨 Plantillas DXF y capturas | [feature-15.md](feature-15.md) | 9 | Importar plantilla DXF como fondo de planta (escala/origen), gestión por planta, capturas del viewport. (F1 incluye plantillas DXF.) |

### Tier 5 — Verificación de extremo a extremo

| # | Feature | Archivo | Dep. | Núcleo de la tarea |
| --- | --- | --- | --- | --- |
| **16** | E2E del flujo F1 (Playwright) | [feature-16.md](feature-16.md) | 10–14 | Flujo completo: definir plantas → pilares → vigas → cargas → calcular → ver resultados. Solver real (Pyodide, instancia única) o mock según coste de CI. |

---

## 3. Definición de hecho (Definition of Done) global de F1

El MVP está "hecho" cuando, partiendo de cero en el navegador:

1. Se pueden definir **grupos y plantas**, introducir **pilares y vigas** gráficamente en planta, y **cargas por hipótesis**.
2. **Calcular** genera la Capa 2 vía `discretizar()`, la resuelve PyNite en el worker, y devuelve **esfuerzos y deformada** sin bloquear la UI.
3. Los **golden tests** (7 casos de libro) pasan dentro de tolerancia.
4. El proyecto **se autoguarda** en IndexedDB y se puede **exportar/importar** `.json` validado.
5. Importar un proyecto corrupto **nunca rompe la app** (Zod `safeParse` en todos los bordes).
6. El E2E del flujo F1 pasa.

---

## 4. Invariantes que toda feature debe respetar

Extraídos de `CLAUDE.md §2` y de la I+D. Cualquier feature que los viole está mal aunque "funcione".

1. **No reimplementar FEM en TS.** El TS construye datos y visualiza; calcula PyNite.
2. **No exponer jerga FEM en la UI.** El modo "Ver modelo de cálculo" (única excepción, que muestra la Capa 2) **no entra en F1: es F2.** En F1 la jerga FEM queda íntegramente oculta.
3. **Discretizador puro** (sin React/IO/Pyodide), testeable en Node.
4. **Identificadores de dominio en español ASCII**; etiquetas de UI en español con tildes.
5. **Unidades internas kN-m**; conversión solo en `/src/unidades`.
6. **Cálculo siempre asíncrono** vía worker.
7. **Validar con Zod** todo dato que entra (import) y la salida del discretizador y del worker (`safeParse`, `.issues`).
8. **MAYÚSCULAS = global / minúsculas = local** en cargas y direcciones (error nº1 documentado).
9. **Nunca `PyNiteFEA[all]`**; instalar sin matplotlib/vtk/pyvista.
10. **Pinear versiones exactas** del par Pyodide↔PyNite; nunca "latest".

---

## 5. Hallazgos de I+D referenciados (mapa rápido)

Cada feature cita los hallazgos por su número del índice de I+D. Resumen del mapeo:

- **#1, #2, #10, #20** → feature-5 (solver/versiones/instalación).
- **#3, #8, #16, #18, #19** → feature-4 (discretizador).
- **#4, #9** → feature-6 (golden tests).
- **#5, #7, #13** → feature-3 y feature-13 (normativa/materiales/combinaciones). ⚠️ revisar bajo Código Estructural.
- **#6** → feature-5.
- **#11, #21, #22** → feature-9 y feature-14 (viewport, diagramas, UI accesible).
- **#12** → feature-7 (estado/undo).
- **#14, #15** → feature-8 (persistencia/validación) y feature-2 (Zod).
- **#17** → feature-6 y feature-16 (testing por capas).

---

## 6. Riesgos transversales (vigilar en todas las features)

| Riesgo | Mitigación | Dónde |
| --- | --- | --- |
| Par Pyodide↔PyNite incompatible (`numpy>=2.4`) | Pinear 0.28.x + 2.0.2; medir empíricamente | feature-5 |
| Dirección de carga global/local equivocada (resultados plausibles pero erróneos) | Golden test específico de dirección | feature-4, feature-6 |
| Propiedades de materiales según norma derogada (EHE-08) | Tabla aislada bajo Código Estructural, verificada | feature-3 |
| Ejes locales de pilar vertical (web-vector degenera) | Golden test de carga lateral en X y en Z | feature-4, feature-6 |
| Render de alta frecuencia por `setState` | Mutación de refs en `useFrame` + transient updates | feature-9 |
| Importar proyecto rompe la app | `safeParse` siempre, mapear `.issues` a lenguaje de obra | feature-8 |
