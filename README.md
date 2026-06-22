# Concreta · Estructuras

Aplicación web de **cálculo estructural por elementos finitos para arquitectos**, con una interfaz **calcada a CYPECAD** (pestañas, grupos/plantas, introducción gráfica en planta) sobre el motor FEM **PyNite** (`PyNiteFEA`), que corre **íntegramente en el navegador** mediante Pyodide/WASM. Es un módulo de la marca **Concreta**.

> **Tesis de producto:** trasladar la complejidad del FEM a **elementos constructivos** (pilares, vigas, paños, muros) que el arquitecto introduce de forma natural. Fácil en la introducción, potente en el cálculo.

- **Público objetivo:** arquitectos y técnicos del mercado español.
- **Sin backend:** todo se ejecuta en el cliente. PyNite corre en un Web Worker con Pyodide; no hay servidor ni telemetría.
- **Privacidad por diseño:** los proyectos viven en el navegador (IndexedDB) y en ficheros `.json` que el usuario exporta.

---

## Arquitectura de dos capas

El usuario actúa siempre sobre el modelo constructivo (Capa 1); el sistema genera el modelo de cálculo (Capa 2) mediante el *discretizador*, que es el corazón del producto. La jerga FEM nunca se expone en la UI, salvo en el modo explícito «Ver modelo de cálculo».

```
CAPA 1 · MODELO CONSTRUCTIVO  (/src/dominio)
  Grupos · Plantas · Pilares · Vigas · Paños · Muros · Cargas por hipótesis
        │  discretizar()  (/src/discretizador)   ← PURO, sin React/IO
        ▼
CAPA 2 · MODELO DE CÁLCULO  (JSON contrato PyNite)
  nodes · materials · sections · members · supports · releases · loads · combos
        │  solver (/src/solver)  →  Web Worker · Pyodide · PyNite
        ▼
RESULTADOS  (esfuerzos, deformada, reacciones)  →  UI (/src/ui)
```

- **Capa 1** es lo único que se persiste: el modelo que el arquitecto entiende.
- **Capa 2** se **regenera** en cada cálculo desde la Capa 1 (es derivada, no se guarda).
- **PyNite es la única fuente de verdad del cálculo.** Nunca se reimplementa FEM en TypeScript: el TS construye datos y visualiza; el cálculo lo hace PyNite.

---

## Stack técnico

| Área | Elección |
|---|---|
| Lenguaje / build | TypeScript (`strict`) + Vite |
| Estado / undo-redo | Zustand + Immer · patrón Command |
| UI | React · Tailwind CSS · Radix UI |
| 3D / lienzo | three.js + React-Three-Fiber + drei |
| Diagramas | Plotly (`react-plotly.js`) |
| Motor FEM | PyNite (`PyNiteFEA`) sobre Pyodide en Web Worker (Comlink) |
| Persistencia | Dexie (IndexedDB) + export/import `.json` |
| Validación | Zod (bordes de Capa 1 y Capa 2) |
| Tests | Vitest + React Testing Library + Playwright · *golden tests* del cálculo |

El par de versiones confirmado del motor es **Pyodide 0.28.3 ↔ PyNiteFEA 2.0.2**. Los *wheels* necesarios están vendorizados en [`public/pyodide/`](public/pyodide/) y [`vendor/wheels/`](vendor/wheels/) para funcionar sin red.

---

## Estructura del repositorio

```
/src
  /dominio          Capa 1: tipos y funciones puras del modelo constructivo
  /discretizador    Capa 1 → Capa 2 (puro, sin React/IO). El corazón.
  /solver           Capa 2 → resultados (Pyodide/PyNite en Web Worker)
  /estado           Stores Zustand + comandos (undo/redo)
  /biblioteca       Catálogos (perfiles, hormigón, aceros)
  /persistencia     Dexie, export/import .json
  /ui               React, organizado por las 4 pestañas CYPECAD
  /unidades         Sistema de unidades y conversión en los bordes
/tests/golden       Casos de libro con solución analítica conocida
/public/pyodide     Runtime Pyodide + wheels del motor (offline)
/investigacion      Investigación por áreas y verificación
```

---

## Puesta en marcha

Requiere Node.js (con `npm`).

```bash
npm install          # instalar dependencias
npm run dev          # servidor de desarrollo (Vite)
npm run build        # build de producción
npm run preview      # previsualizar el build
```

### Calidad y tests

```bash
npm run test         # Vitest (unit / componente)
npm run test:golden  # tests de cálculo contra casos de libro
npm run e2e          # Playwright (E2E)
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
```

---

## Roadmap por fases

- **F1 (MVP):** plantas/grupos, pilares, vigas, empotramientos/articulaciones, cargas por hipótesis, combinaciones básicas, **Calcular = esfuerzos + deformada**, plantillas DXF.
- **F2:** 3D pleno, P-Δ y modal, peso propio automático, centro de masas/rigidez.
- **F3:** muros, pantallas, **paños** (uni/reticular/losa), mallado, pestaña de isovalores.
- **F4:** cimentación, **armados** y comprobación normativa (Código Estructural / Eurocódigos), separatas y memorias PDF.

Normativa de referencia (capa futura): CTE DB-SE, **Código Estructural (RD 470/2021)**, NCSE-02, Eurocódigos.

---

## Documentación

- [`CLAUDE.md`](CLAUDE.md) — contexto permanente y reglas de arquitectura del proyecto.
- [`Concreta_Estructuras_Spec_Frontend.md`](Concreta_Estructuras_Spec_Frontend.md) — especificación de diseño del frontend.
- [`Concreta_Estructuras_Spec_Diseno_UI.md`](Concreta_Estructuras_Spec_Diseno_UI.md) — sistema visual y de interacción.
- [`PyNite_Guia_Completa.md`](PyNite_Guia_Completa.md) — API y contrato de datos del motor.
- PyNite: <https://pynite.readthedocs.io> · <https://github.com/JWock82/PyNite>

---

## Licencia

Distribuido bajo la **[PolyForm Noncommercial License 1.0.0](LICENSE)**: se permite el uso, modificación y distribución **únicamente con fines no comerciales**. Cualquier uso comercial requiere una licencia aparte del titular.

Copyright © 2026 Javier Ramírez Bandera.
