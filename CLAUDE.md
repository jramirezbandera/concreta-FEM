# CLAUDE.md — Concreta · Estructuras

> Contexto permanente del proyecto. Léelo al inicio de cada sesión. Si una decisión contradice este archivo, **gana este archivo**; si crees que debe cambiar, dilo explícitamente antes de actuar.

---

## 1. Qué es este proyecto

**Concreta · Estructuras** es una aplicación web de **cálculo estructural por elementos finitos para arquitectos**, con una interfaz **calcada a CYPECAD** (pestañas, grupos/plantas, introducción gráfica en planta) sobre el motor FEM **PyNite** (`PyNiteFEA`), que corre **en el navegador** vía Pyodide/WASM. Es un módulo de la marca **Concreta**.

- **Público:** arquitectos y técnicos del mercado español.
- **Tesis de producto:** trasladar la complejidad del FEM a **elementos constructivos** (pilares, vigas, paños, muros) que el arquitecto introduce de forma natural. Fácil en la introducción, potente en el cálculo.
- **MVP (Fase 1):** introducir pórticos de pilares y vigas por plantas, calcular y devolver **esfuerzos y deformada**. Sin armado ni comprobación normativa todavía.
- **Repo:** greenfield, independiente.
- **Sin backend:** todo en el cliente. PyNite corre en un Web Worker con Pyodide.

Documento de diseño de la interfaz: `Concreta_Estructuras_Spec_Frontend.md` (referencia para pantallas, pestañas y sistema gráfico). Guía del motor: `PyNite_Guia_Completa.md` (contrato de datos y API del solver).

---

## 2. Reglas de oro (innegociables)

1. **PyNite es la única fuente de verdad del cálculo.** Nunca se reimplementa FEM, ni rigidez, ni resolución de sistemas en JavaScript/TypeScript. El TS construye datos y visualiza; el cálculo lo hace PyNite.
2. **Modelo de dos capas.** El usuario actúa sobre la **Capa 1 (obra)**; el sistema genera la **Capa 2 (FEM)** mediante el *discretizador*. Jamás se expone jerga FEM en la UI (nada de "release", "nodo N12", "member M7") salvo en el modo explícito "Ver modelo de cálculo".
3. **El discretizador es el producto.** Es el código más crítico y más testeado. Cualquier cambio en él exige *golden tests* que comparen contra resultados conocidos. Es **puro** (sin React, sin I/O, sin Pyodide).
4. **Vocabulario CYPECAD.** Pestañas y elementos se nombran como en CYPECAD: *Entrada de pilares, Entrada de vigas, Resultados, Isovalores; grupos y plantas; paños; hipótesis*.
5. **Identificadores de dominio en español y ASCII.** `Pilar`, `Viga`, `Pano`, `Grupo`, `Planta`, `Seccion`, `Hipotesis` (sin tildes ni ñ en el código). Las **etiquetas de UI** sí van en español correcto con tildes ("Sección", "Paño", "Hipótesis").
6. **Unidades consistentes internas.** Todo el modelo interno y el solver trabajan en un sistema único (**kN, m**). La conversión a unidades de presentación (mm para secciones, N/mm² para E) ocurre **una sola vez en los bordes** (entrada/salida).
7. **Cálculo siempre asíncrono.** Toda llamada al solver pasa por el worker; nunca se bloquea el hilo principal. Hay estados visibles de "cargando motor" y "calculando".
8. **Todo dato que entra se valida.** El JSON de proyecto (Capa 1) y la salida del discretizador (Capa 2) se validan con Zod antes de usarse. Importar un proyecto nunca debe poder romper la app.
9. **Privacidad por diseño.** Sin servidor, sin telemetría del modelo. Los proyectos viven en el navegador (IndexedDB) y en ficheros que el usuario exporta.

---

## 3. Arquitectura de dos capas

```
CAPA 1 · MODELO CONSTRUCTIVO  (/src/dominio)
  Grupos · Plantas · Pilares · Vigas · Paños · Muros · Cargas por hipótesis
        │  discretizar()  (/src/discretizador)   ← PURO, el corazón
        ▼
CAPA 2 · MODELO DE CÁLCULO  (JSON contrato PyNite)
  nodes · materials · sections · members · supports · releases · loads · combos
        │  solver (/src/solver)  →  Web Worker · Pyodide · PyNite
        ▼
RESULTADOS  (esfuerzos, deformada, reacciones)  →  UI (/src/ui)
```

- **Capa 1** es lo único que se persiste. Es el modelo que el arquitecto entiende.
- **Capa 2** se **regenera** en cada cálculo desde la Capa 1. No se guarda (es derivada).
- El **discretizador** traduce 1→2 respetando dependencias (materiales/secciones → nodos → barras → apoyos → cargas → combinaciones) y aplica validaciones previas.
- "Ver modelo de cálculo" es un modo de UI que muestra la Capa 2 generada (nudos, barras, releases) semitransparente sobre la obra. Diferenciador frente a la caja negra de CYPECAD; útil además para docencia.

---

## 4. Stack técnico (decisiones cerradas)

Base fijada por el usuario: **React + TypeScript + Vite**. El resto se elige así:

| Área | Elección | Por qué |
|---|---|---|
| Lenguaje | **TypeScript** (modo `strict`) | Modelo de dominio complejo; los tipos son documentación viva. |
| Build | **Vite** | Rápido, ESM, buen soporte de workers y WASM. |
| Estado | **Zustand + Immer** | Store de modelo CAD con selección y estado transitorio; sin boilerplate; fácil de snapshotear para undo/redo. |
| Undo/redo | **Patrón Command** sobre el store | Imprescindible en una app tipo CAD; cada acción de obra es un comando reversible. |
| Estilos | **Tailwind CSS + variables CSS** (design tokens) | Encaja con los tokens del spec; rápido y consistente. |
| Primitivas UI | **Radix UI** (o shadcn/ui) | Diálogos, menús, pestañas y popovers accesibles sin reinventar. |
| 3D / lienzo | **three.js + React-Three-Fiber + drei** | Integra la escena 3D/2D con el estado React; el viewport es el núcleo. |
| Diagramas | **Plotly** (`react-plotly.js`) | Diagramas N/V/M/flecha desde los `*_array()` de PyNite. (uPlot como alternativa si hace falta rendimiento.) |
| Worker ↔ UI | **Pyodide en Web Worker + Comlink** | RPC ergonómico; mantiene la UI fluida durante el cálculo. |
| Persistencia | **Dexie (IndexedDB)** | Autosave + export/import de proyecto `.json`. |
| Validación | **Zod** | Esquemas de Capa 1 y Capa 2; seguridad al importar. |
| Tests | **Vitest + React Testing Library + Playwright** | Unit/componente + E2E. |
| Tests de cálculo | **Golden tests** del discretizador y del pipeline completo | Contra casos de libro con solución conocida (como hace el propio PyNite). |
| Lint/format | **ESLint + Prettier** | Estilo consistente. |

> No añadir dependencias pesadas sin justificar. Antes de meter una librería, comprobar que no se resuelve con lo ya elegido.

---

## 5. Estructura de carpetas

```
/src
  /dominio          # CAPA 1: tipos y funciones puras del modelo constructivo
    modelo.ts       #   Modelo, Grupo, Planta
    pilar.ts        #   Pilar
    viga.ts         #   Viga
    pano.ts         #   Pano (F3)
    muro.ts         #   Muro (F3)
    carga.ts        #   Carga, Hipotesis
    seccion.ts      #   Seccion (geometría/propiedades)
    material.ts     #   Material
    index.ts
  /discretizador    # CAPA 1 → CAPA 2 (PURO, sin React/IO). El corazón.
    discretizar.ts
    validaciones.ts #   nombres únicos, referencias, sujeción suficiente…
    contratoFEM.ts  #   tipos del JSON que consume PyNite (Capa 2)
  /solver           # CAPA 2 → resultados (Pyodide/PyNite)
    worker.ts       #   Web Worker: arranca Pyodide, micropip, ejecuta cálculo
    pynite_glue.py  #   construye FEModel3D desde el JSON y devuelve resultados
    solverClient.ts #   API Comlink hacia la UI (calcular, estado del motor)
    resultados.ts   #   tipos de resultados (esfuerzos, deformada, reacciones)
  /estado           # Zustand stores + comandos (undo/redo)
    modeloStore.ts
    seleccionStore.ts
    vistaStore.ts   #   pestaña activa, grupo activo, vista 2D/3D/mosaico
    resultadosStore.ts
    comandos/
  /biblioteca       # catálogos
    perfiles.ts     #   IPE/HEA/HEB/HEM/UPN/L/tubos (A, Iy, Iz, J)
    hormigon.ts     #   secciones paramétricas + materiales EHE
    aceros.ts       #   S235/S275/S355 (EC3)
  /persistencia     # Dexie, export/import .json
  /ui               # React, organizado por las 4 pestañas
    /shell          #   barra de menús, pestañas, barra de estado, paneles
    /entradaPilares
    /entradaVigas
    /resultados
    /isovalores     #   (F3)
    /viewport       #   escena R3F (planta/3D), gizmo, plantillas DXF, capturas
    /inspector
    /dialogos       #   Plantas/Grupos, biblioteca de secciones, cargas
  /unidades         # sistema de unidades y conversión en los bordes
  main.tsx
/tests
  /golden           # casos de libro con solución conocida
/public
```

---

## 6. Modelo de dominio (Capa 1)

Tipos en español, ASCII, sin tildes. Bosquejo (no exhaustivo):

```ts
type Modelo = {
  unidades: "kN-m";
  grupos: Grupo[];
  plantas: Planta[];
  pilares: Pilar[];
  vigas: Viga[];
  panos: Pano[];        // F3
  muros: Muro[];        // F3
  cargas: Carga[];
  hipotesis: Hipotesis[];
  analisis: OpcionesAnalisis;
};

type Grupo  = { id: string; nombre: string; categoriaUso: CategoriaUso; sobrecargaUso: number; cargasMuertas: number };
type Planta = { id: string; nombre: string; cota: number; altura: number; grupoId: string };
type Pilar  = { id: string; nombre: string; x: number; y: number; plantaInicial: string; plantaFinal: string;
                seccionId: string; materialId: string; angulo: number;
                vinculacionExterior: boolean; arranque: "empotrado" | "articulado" | "elastico" };
type Viga   = { id: string; nombre: string; plantaId: string; nudoI: string; nudoJ: string;
                seccionId: string; materialId: string;
                extremoI: "empotrado" | "articulado"; extremoJ: "empotrado" | "articulado";
                tirante: boolean };
type Carga  = { id: string; tipo: "puntual" | "lineal" | "superficial"; ambito: string;
                valor: number; hipotesisId: string };
```

Reglas: el dominio es **puro y serializable** (sin clases con lógica de UI, sin referencias a three.js ni a Pyodide). Las relaciones se hacen por `id`.

---

## 7. El discretizador (Capa 1 → Capa 2)

Función central: `discretizar(modelo: Modelo): ModeloFEM`. Produce el JSON que consume PyNite (ver `PyNite_Guia_Completa.md` §11.1):

```jsonc
{
  "units": "kN-m",
  "nodes": [...], "materials": [...], "sections": [...],
  "members": [...], "supports": [...], "releases": [...],
  "loads": [...], "combos": [...]
}
```

Responsabilidades:
- Generar **nodos** en intersecciones (cabezas/pies de pilar, encuentros de viga), compartiendo nudos donde la geometría coincide.
- **Pilar** → `member` vertical; si `vinculacionExterior` y arranque empotrado → `support` en el nudo de arranque.
- **Viga** → `member`; `extremoI/J = articulado` → `releases` en ese extremo.
- **Cargas por hipótesis** → `add_*_load(case=...)`; **categorías de uso** → valor de `Q`; **combinaciones CTE** (1.35·G + 1.5·Q, ELU/ELS) → `combos`.
- Aplicar **direcciones** correctas (global MAYÚSCULAS / local minúsculas) — error común, vigilar.

Validaciones previas (en `validaciones.ts`): nombres únicos; referencias válidas (barra→nodos/material/sección); al menos sujeción suficiente (no mecanismo); combinaciones que referencian hipótesis con cargas. Los errores se devuelven **en lenguaje de obra** ("El pilar P3 no tiene arranque ni conexión: la estructura no está sujeta") y apuntan al elemento culpable.

**Nunca** mezclar discretización con I/O, React o Pyodide. Debe poder ejecutarse y testearse en Node puro.

---

## 8. El solver (Pyodide + PyNite) — restricciones

PyNite es **Python puro**; sus dependencias de cálculo (numpy, scipy) están en Pyodide. Restricciones que hay que respetar siempre:

- **Instalar sin extras de visualización.** Usar `micropip.install("PyNiteFEA")` **sin `[all]`**. Evitar vtk, pyvista, pdfkit, jinja2 (no existen/no se necesitan en el navegador). Nosotros renderizamos con Plotly/three.js a partir de los **arrays numéricos** de PyNite, no con su renderizador.
- **Fijar versiones compatibles.** Las versiones recientes de PyNite exigen numpy ≥ 2.4 y han abandonado Python 3.10. Hay que **pinear una versión de `PyNiteFEA` cuyo requisito de numpy/scipy coincida con el que trae la versión de Pyodide en uso**. No instalar "la última" a ciegas. Documentar el par (versión Pyodide ↔ versión PyNite) que funcione.
- **scipy como solver disperso.** PyNite usa scipy para el solver disperso (más rápido y con menos memoria). Mantenerlo; es la ruta esperada.
- **Arranque del motor.** Primera carga ~15–30 MB (Pyodide + numpy + scipy), se cachea. Precargar en segundo plano mientras el usuario modela; habilitar "Calcular" cuando el worker esté listo.
- **Aislamiento.** Toda la interacción con Pyodide vive en `/src/solver`. El resto de la app no sabe que existe Python; habla con `solverClient` (Comlink).
- **`pynite_glue.py`** recibe el JSON de Capa 2, construye `FEModel3D`, llama a `analyze()` / `analyze_PDelta()` y devuelve un JSON de resultados (esfuerzos por barra vía `*_array()`, deformada, reacciones). Validar con `check_statics` cuando proceda.

---

## 9. Convenciones de código

- **Idioma:** dominio en **español ASCII** (`Pilar`, `Pano`, `Seccion`, `Hipotesis`). Infraestructura (hooks, utils, tipos técnicos, stores) en **inglés** (`useViewport`, `workerClient`). Componentes que representan dominio pueden mezclar (`InspectorPilar`, `EntradaVigas`). **Etiquetas de UI**: español correcto con tildes.
- **TypeScript `strict`**, sin `any` salvo justificación. Tipos de dominio explícitos y serializables.
- **Funciones puras** en dominio y discretizador; efectos sólo en `/solver`, `/persistencia` y `/ui`.
- **Sin estado oculto en módulos.** El estado vive en los stores de Zustand.
- **Comentarios** en español, breves y sobre el *porqué*, no el *qué*.
- **Commits**: convencionales y en español o inglés consistente (elige uno y mantenlo).

---

## 10. Estado y undo/redo

- `modeloStore` (Zustand + Immer): el `Modelo` (Capa 1). Único origen de la obra.
- `seleccionStore`: elementos seleccionados, hover.
- `vistaStore`: pestaña activa (pilares/vigas/resultados/isovalores), grupo activo, modo de vista (planta/3D/mosaico), combinación activa, plantillas/capturas.
- `resultadosStore`: resultados del último cálculo (derivados; se limpian al editar la obra).
- **Undo/redo por patrón Command**: cada edición de obra (crear pilar, mover viga, asignar sección) es un comando con `aplicar()`/`revertir()`. La pila de comandos permite deshacer; evitar snapshots completos del modelo salvo para acciones masivas.
- Al modificar la Capa 1, **invalidar** los resultados (la deformada/esfuerzos dejan de ser válidos hasta recalcular).

---

## 11. UI: las 4 pestañas y el sistema gráfico

Resumen (detalle en el spec): pestañas **Entrada de pilares · Entrada de vigas · Resultados · Isovalores** abajo a la izquierda; barra de menús superior que cambia por pestaña; barra lateral izquierda (gestión de vistas, elementos, árbol de obra); herramientas arriba a la derecha (plantillas DXF F4, capturas F3, ayudas); barra de estado inferior con línea de mensajes. Viewport central en planta del grupo activo, conmutable a 3D o mosaico. En "Resultados": deformada 3D con escala de colores + animación, diagramas por barra, tablas de reacciones. Estilo: lienzo oscuro tipo CAD, paneles neutros, datos numéricos en monoespaciada, color = semántica.

---

## 12. Persistencia

- **Autosave** continuo a IndexedDB (Dexie) de la Capa 1.
- **Export/Import** del proyecto como `.json` (formato propio Concreta). Validar siempre al importar con Zod.
- La Capa 2 y los resultados **no** se guardan (se regeneran/recalculan).

---

## 13. Testing (prioridad alta en el cálculo)

- **Golden tests** del discretizador y del pipeline completo (obra → discretizar → PyNite → resultados) contra **casos de libro** con solución analítica conocida: viga biapoyada con carga uniforme, voladizo con carga puntual, pórtico simple, celosía. Es la red de seguridad del producto.
- Unit tests de `dominio` y `validaciones`.
- Component tests (RTL) de inspector y diálogos.
- E2E (Playwright) del flujo F1: definir plantas → pilares → vigas → cargas → calcular → ver resultados.
- Los tests del discretizador corren en **Node puro** (sin Pyodide); los del pipeline pueden mockear el solver o usar Pyodide en CI según coste.

---

## 14. Unidades

Sistema interno **kN-m**. Conversión sólo en los bordes:
- Geometría: m. Secciones: mm (UI) → m (interno). Fuerzas: kN. Momentos: kN·m. Cargas: kN/m, kN/m². Módulo E y tensiones: N/mm² (MPa) (UI) → consistente (interno).
- Una única capa de conversión en `/src/unidades`. La UI nunca expone la conversión.

---

## 15. Roadmap por fases

- **F1 (MVP):** plantas/grupos, pilares, vigas, empotramientos/articulaciones, cargas lineales/superficiales por hipótesis, combinaciones básicas, **Calcular = esfuerzos + deformada**, plantillas DXF, análisis lineal/general.
- **F2:** 3D pleno, P-Δ y modal, peso propio automático, centro de masas/rigidez.
- **F3:** muros, pantallas, **paños** (uni/reticular/losa), mallado, **pestaña Isovalores**.
- **F4:** cimentación, **armados** y comprobación normativa (EHE-08/EC), separatas/memorias PDF.

> Cerrar primero un corte vertical fino en F1 (pórticos de pilares+vigas, extremo a extremo) antes de ensanchar el catálogo.

---

## 16. Comandos

```bash
npm install          # instalar dependencias
npm run dev          # servidor de desarrollo (Vite)
npm run build        # build de producción
npm run preview      # previsualizar build
npm run test         # Vitest (unit/componente)
npm run test:golden  # tests de cálculo contra casos de libro
npm run e2e          # Playwright
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
```

(Crear estos scripts en `package.json` al inicializar el repo.)

---

## 17. Antipatrones — qué NO hacer

- ❌ Reimplementar FEM, rigidez o resolución de sistemas en TS.
- ❌ Exponer jerga FEM en la UI fuera de "Ver modelo de cálculo".
- ❌ Llamar a PyNite desde el hilo principal o de forma síncrona.
- ❌ Instalar `PyNiteFEA[all]` o depender de vtk/pyvista/matplotlib en el navegador.
- ❌ Convertir unidades en mitad de la lógica (sólo en los bordes).
- ❌ Guardar la Capa 2 o los resultados como si fueran fuente de verdad.
- ❌ Identificadores de dominio con tildes/ñ.
- ❌ Meter lógica de cálculo o de UI dentro del discretizador.
- ❌ Importar un proyecto sin validarlo con Zod.

---

## 18. Decisiones pendientes (placeholders a confirmar)

- **Paleta de acento Concreta** y tipografías de marca (hoy `--accent` provisional azul).
- **Nombre del módulo** (Concreta · Estructuras / Concreta CAD…).
- **Material del MVP:** ¿hormigón, acero o ambos? (define bibliotecas y pantallas).
- **Estética:** ¿lienzo oscuro + paneles claros, o modo oscuro completo?
- **Pestañas:** ¿mantener literal las 4 de CYPECAD o fusionar "Entrada de pilares/vigas" en un único modo por capas?
- **Versión Pyodide ↔ PyNiteFEA** compatible (a fijar empíricamente al montar el worker).

---

## 19. Referencias del proyecto

- `Concreta_Estructuras_Spec_Frontend.md` — especificación de diseño del frontend (pestañas, sistema gráfico, pantallas).
- `PyNite_Guia_Completa.md` — API y contrato de datos del motor PyNite.
- PyNite: https://pynite.readthedocs.io · https://github.com/JWock82/PyNite
- Normativa de referencia (capa futura): CTE DB-SE, EHE-08, NCSE-02, Eurocódigos.
