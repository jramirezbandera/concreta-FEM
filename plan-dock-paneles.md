# Plan · Dock de paneles (gestión de paneles de fondo)

> Salida de `/plan-design-review` + `/plan-eng-review` (2026-06-30). Sucesor de
> **T-hud-layout**: los slots (feature-17) resolvieron el solape *dentro* de una
> zona; quedaron tres problemas que este plan cierra de raíz. Decisiones tomadas
> con el usuario en §2. Voz externa (Codex) plegada en §3 y §6.

---

## 1. Problema (causa raíz, no síntoma)

El HUD son 8 zonas ancladas a esquinas (`Slot` → `createPortal` → `.cx-zone`
flex-column). Tres fallos que las heurísticas de colocación solo mitigan
([Hud.tsx:214-223](src/ui/viewport/Hud.tsx#L214-L223)):

1. **Colisión inter-zona.** `top-left` crece hacia abajo y `bottom-left` hacia
   arriba; ambas ancladas a la izquierda, se encuentran en el centro. Por eso
   `mid-left` está "reservada". Ninguna zona conoce a las demás.
2. **Desbordamiento intra-zona.** Una columna (Resultados `bottom-left` =
   CentroMasa + CentroRigidez + ModeloCalculo + TablaReacciones) supera el alto
   del viewport. `.cx-zone` tiene `max-height` **sin scroll** → recorta.
3. **Datos sobre el modelo.** En Resultados ~6 paneles de datos flotan sobre la
   deformada/isocolores que el arquitecto intenta leer.

**La idea que lo cierra:** hay **dos clases de contenido** mezcladas en el HUD.
- **Controles de lienzo** (espaciales, pequeños): grupo/planta, 2D/3D, zoom,
  leyenda de escala. → siguen en **glass**.
- **Paneles de datos** (tabulares/altos): reacciones, diagramas, combinación,
  frecuencias, inspector, herramienta, plantillas, isovalores, lecturas CM/CR.
  → van a un **dock acoplado**.

Regla: **datos → dock, controles → lienzo.** Una columna gestionada con scroll
mata los tres fallos a la vez.

---

## 2. Decisiones tomadas

**Diseño (`/plan-design-review`):**
- **D1 · Dirección:** dock derecho + secciones colapsables (arreglo de fondo).
- **D2 · Anatomía:** controles fijos + scroll (opción C). Calcular + estado motor
  + Combinación *pinned*; contenido scrollea debajo en secciones colapsables.
- **D3 · Alcance:** unificado — todo el contenido de datos al dock en **todas**
  las pestañas.

**Ingeniería (`/plan-eng-review`):**
- **E1 · Secuencia:** **F3 corte 1 (losa maciza + Isovalores) ya mergeado a `main`**
  (#3, `3d333ca`): `PanelIsovalores`/`InspectorPano`/`PanelHerramientaPano`/
  `IsovaloresOverlay` están en main. El dock arranca como rama nueva off `main` y
  **alberga también los paneles de F3**. (Cortes posteriores de F3 que añadan
  paneles se absorben por la misma IA §3; no bloquean PR1.)
- **E2 · Invariante:** la regla "datos→dock, controles→lienzo" se sostiene por
  **convención + revisión de PR** (documentada en CLAUDE.md/§5), sin test-guardia.
  Riesgo asumido: una feature futura puede reabrir el solape; se atrapa en review.
- **E3 · Primer corte:** **faseado por capas** (no un PR grande). Ver §7.

---

## 3. Arquitectura

**El dock es una región del Shell que *empuja* el lienzo, no un overlay.** Hermano
flex en `.cx-body`, junto a sidebar (236px) y tools rail (52px):

```
.cx-body (flex row)
  .cx-sidebar  (236px · árbol de obra)        ── existe
  .cx-work     (flex 1 · Viewport: Canvas + HUD glass)
  .cx-tools    (52px · rail de iconos)         ── existe
  .cx-dock     (≥384px · paneles de datos)     ── NUEVO
```

El solape se vuelve **imposible por construcción**.

**Correcciones de la eng-review / Codex (plegadas):**

- **[E-arch] La recomposición de `App.tsx` es mayor de lo trivial.** El gating de
  pestaña, `enPleno`, `sceneOverlays` y `hudOverlays` están **fundidos** en un
  único árbol de props de `Viewport` ([App.tsx:328-440](src/App.tsx#L328-L440)).
  Sacar el dock fuera de `Viewport` exige **extraer la composición por pestaña**
  (un helper `composicionPestana(pestana, enPleno)` que devuelva `{sceneOverlays,
  hudOverlays, dock}`), no duplicar condiciones. Es trabajo real, no un mové-JSX.
- **[E-width] Ancho del dock ≥ 384px, no 312.** `TablaReacciones` mide 380px
  ([tablaReacciones.css:7](src/ui/resultados/tablaReacciones.css#L7)) y
  `PanelDiagramas` 360px ([panelDiagramas.css:6](src/ui/resultados/panelDiagramas.css#L6)).
  `--w-dock: 384px` (o el contenido se re-maqueta a ancho de dock). Sin esto:
  scroll horizontal feo.
- **[E-iso] F3 NO está "pendiente".** El árbol ya tiene `PanelIsovalores`,
  `IsovaloresOverlay`, `InspectorPano`, `PanelHerramientaPano`, `defaultsPano`,
  `magnitudIsovalores` cableados ([App.tsx:349](src/App.tsx#L349),
  [vistaStore.ts](src/estado/vistaStore.ts)). La tabla de IA de abajo los incluye.
- **[E-iso-null] `PanelIsovalores` devuelve `null` sin resultados de placa**
  ([PanelIsovalores.tsx:121](src/ui/resultados/PanelIsovalores.tsx#L121)). El dock
  quiere **secciones persistentes con estados** (§4), así que su contrato cambia
  (de "no renderizo nada" a "renderizo mi estado vacío"). Vale para todos los
  paneles que hoy se autoocultan devolviendo null.

### Contenido del dock por pestaña (IA · post-F3)

| Pestaña | Cabecera PINNED | Secciones colapsables (scroll) |
|---|---|---|
| **Entrada pilares** | Herramienta: defaults sección/material/vinculación | Inspector (al seleccionar) · Plantillas DXF · Ayudas (CM/CR) |
| **Entrada vigas** | Herramienta: defaults sección/material/extremos | Inspector · Plantillas DXF · Ayudas (CM/CR) |
| **Entrada paños** (F3) | Herramienta paños: defaults + carga superficial | InspectorPano · Plantillas DXF · Ayudas |
| **Resultados** | ▸ Calcular + ● estado · Combinación ▾ | Reacciones · Diagramas (barra sel.) · Frecuencias/Modal · Ayudas (CM/CR · Ver modelo de cálculo) |
| **Isovalores** (F3) | Magnitud ▾ + leyenda rampa | PanelIsovalores (controles del mapa) · Ayudas |

### Qué se queda en glass sobre el lienzo

- `GroupRibbon`, `SelectorModo` 2D/3D, `ControlesZoom`, `LeyendaEscala`/`LeyendaRampa`
  (leen contra los colores del modelo).
- **Marcadores** de escena (CM ⊕ / CR ◇ / deformada / modal / `IsovaloresOverlay`
  / "Ver modelo de cálculo") siguen siendo `sceneOverlays`.
- **[E-cm] Partir toggle/status de overlay.** `CentroMasa`/`CentroRigidez`/
  `ModeloCalculo` ([Hud.tsx:224](src/ui/viewport/Hud.tsx#L224)) hoy **mezclan** el
  panel-toggle con el comportamiento de visibilidad del overlay. Hay que separar
  el **control** (va al dock, sección Ayudas) del **marcador** (queda en escena).

El sistema de `Slot`/zonas se conserva para los controles de lienzo restantes; se
vacían las zonas que quedan sin uso.

---

## 4. Estados de interacción (datos = features)

| Feature | Vacío | Cargando | Error | Parcial |
|---|---|---|---|---|
| Dock Resultados | "Aún no has calculado. Pulsa ▸ Calcular." + botón | "Cargando motor…"/"Calculando…" ● ámbar | errores del discretizador en lenguaje de obra (rojo, arriba) | — |
| Diagramas | — | — | — | **sin barra → "Selecciona una barra para ver N/V/M"** |
| Frecuencias/Modal | "Calcula los modos…" + botón | "Calculando modos…" | mensaje de obra | modal sin estático (camino aparte, ya existe) |
| **PanelIsovalores** (F3) | "Calcula para ver el mapa" (hoy devuelve `null` → **cambiar a estado vacío**) | — | sin placa → guía | — |
| Inspector | "Selecciona un elemento…" | — | — | — |

> **[E-iso-null]** convertir los `return null` de auto-ocultación en estados de
> sección es parte del trabajo, no un detalle.

---

## 5. Anti "AI slop" + invariante (clasificador = APP UI)

- **Mata la metáfora "card" dentro del dock.** Secciones planas: cabecera + filete
  `--border`, mono tabular, **cero sombra interior**. Glass solo para controles de
  lienzo.
- **[Invariante E2 · por convención]** En CLAUDE.md (§11 o §17): *"Los paneles de
  datos van al dock (`DockSeccion`); solo los controles de lienzo de la lista
  blanca (ribbon, modo, zoom, leyenda) usan `Slot` glass. Un panel de datos nuevo
  en un `Slot` es un error de revisión."* Sin test-guardia (decisión E2); se hace
  cumplir en PR review.

---

## 6. Alineación con el sistema + correcciones

- **[E-primitivo] `SeccionColapsable` es un componente Radix, no CSS movido.**
  `Sidebar` usa un `Seccion` local con `useState` + Radix Collapsible
  ([Sidebar.tsx:16](src/ui/shell/Sidebar.tsx#L16)), **no** un primitivo
  reutilizable/persistido. Factorizarlo = crear el componente (aria-expanded,
  data-state, `prefers-reduced-motion`) y que Sidebar lo adopte. Más que CSS.
- **[E-flotante] Partir `PanelFlotante`.** Los paneles renderizan `PanelFlotante`
  por dentro, con glass/sombra/cabecera/ancho/padding horneados
  ([PanelFlotante.tsx:19](src/ui/primitivas/PanelFlotante.tsx#L19)). "Solo pierden
  el cromo" es falso: hay que **partir cuerpo/contenido** (un `PanelCuerpo` sin
  cromo que `PanelFlotante` y `DockSeccion` envuelvan distinto), no editar 8 sitios.
- **[E-scroll] Limpiar scroll anidado.** `TablaReacciones`
  ([tablaReacciones.css:39](src/ui/resultados/tablaReacciones.css#L39)) y
  `PanelFrecuencias` ([panelFrecuencias.css:70](src/ui/resultados/panelFrecuencias.css#L70))
  ya tienen scroll interno. "Un único scroll" del dock exige **quitar** esos
  scrolls internos; asignado a PR2.
- **[E-store] `vistaStore` necesita esquema tipado de dock.** Ya está cargado
  ([vistaStore.ts](src/estado/vistaStore.ts)) y sin forma de dock. El colapso "por
  pestaña" = un tipo `DockUIState` explícito (no booleanos sueltos) + reset al
  cambiar de obra. Transitorio (fuera de undo).
- **[E-tools] Botón de colapso en ToolsRail con semántica.** `ToolsRail`
  ([ToolsRail.tsx:68](src/ui/shell/ToolsRail.tsx#L68)) ya tiene capturas F3,
  plantillas F4, snap, toggles. Añadir colapso = icono + orden + estado activo,
  no solo un toggle de store.
- **Tokens:** `--w-dock: 384px`. Reusa `--surface`/`--border`/`--space-*`/`--font-mono`.
- **Estado del motor:** `calculoStore` (feature-17) — el dock lo consume, no duplica.

---

## 7. Entrega faseada por capas (decisión E3)

> "Make the change easy, then make the easy change." Cada PR es pequeño,
> revisable y reversible. El end-state es el dock pulido (anatomía C, unificado).

### PR1 (P1) — Arreglo de layout. *Mata el solape, libera el modelo.*
- Región `.cx-dock` en el Shell (prop `dock`); token `--w-dock: 384px`.
- Extraer `composicionPestana()` de `App.tsx` (sceneOverlays/hudOverlays/dock).
- **Mover los paneles de datos a la columna con su cromo y API ACTUALES** (sin
  rediseño): Resultados, Entrada (pilares/vigas/paños), Isovalores. Quedan apilados
  en el dock (con su glass actual, temporalmente), pero **ya fuera del lienzo**.
- Vaciar las zonas glass que quedan sin uso; conservar Slot para ribbon/modo/zoom/leyenda.
- **Test de regresión (CRÍTICO, obligatorio):** pulsar "Calcular" no lo intercepta
  ningún control del HUD (la clase de bug que motivó el `dispatchEvent` histórico,
  T-hud-layout). Volver a `.click()` donde aplique.
- **E2E:** actualizar selectores movidos — `tabla-reacciones`, `panel-diagramas`,
  combobox "Combinación activa" ([F1.pipeline.happy.spec.ts:188](e2e/F1.pipeline.happy.spec.ts#L188)).
- Files: `Shell.tsx`, `shell.css`, `tokens.css`, `App.tsx`, `e2e/*`.

### PR2 (P2) — Anatomía C + cromo plano.
- Primitivo `SeccionColapsable` (Radix; Sidebar lo adopta — DRY).
- `Dock`/`DockSeccion`: cabecera pinned + scroll de secciones; landmark `<aside>`.
- Partir `PanelFlotante` → `PanelCuerpo` sin cromo; el dock usa cuerpo plano
  (cero sombra/card), el lienzo sigue con glass.
- Quitar scroll interno de `TablaReacciones`/`PanelFrecuencias` (un solo scroll).
- Convertir `return null` de auto-ocultación en **estados de sección** (§4),
  incl. `PanelIsovalores`.
- Partir control(dock) / marcador(escena) de CM/CR/ModeloCalculo.
- Adaptar los `*.test.tsx` de cada panel re-alojado + tests de Dock/Seccion.

### PR3 (P3) — Estado y pulido.
- `DockUIState` tipado en `vistaStore` (colapso dock + secciones por pestaña; reset).
- Botón de colapso en `ToolsRail` (icono/orden/activo) + atajo de teclado.
- Pasada a11y: foco, contraste, reduced-motion en el colapso.
- (Follow-up) persistir colapso a IndexedDB (vistaStore→Dexie).

---

## 8. Rendimiento

- El dock es HTML/React: cero coste por frame. Overlays de escena intactos.
- **[perf]** En PR2/PR3: renderizar perezosamente las secciones colapsadas y **no
  suscribir** una sección oculta a `s.modelo` (si no, recalcula como
  `T-cm-overlay-recompute`). Lazy + suscripción acotada.

---

## 9. NO está en alcance

- **Móvil/tablet.** App de escritorio CAD; sin caso táctil en F1/F2.
- **Dock redimensionable por arrastre.** Ancho fijo + colapsar a rail por ahora.
- **Tear-off / paneles desacoplables.** Reintroduce el empaquetado.
- **Test-guardia del invariante.** Decisión E2: convención, no enforcement.
- **Persistir el colapso a IndexedDB.** Va al final de PR3 como follow-up.
- **Rediseño de datos para ancho menor.** Se elige `--w-dock: 384px` para no tocar
  el layout interno de tablas/diagramas en PR1.

---

## 10. Lo que ya existe (reutilizar)

- Regiones flex de `.cx-body` (sidebar/tools) → el dock es la tercera región.
- Radix Collapsible del `Seccion` de Sidebar → base de `SeccionColapsable`.
- Todos los componentes de resultados/inspector/herramienta/plantillas/isovalores
  → re-alojar (PR1 con su cromo, PR2 sin él).
- `calculoStore`, `resultadosStore`, tokens, Geist Mono, `prefers-reduced-motion`
  (commit 93d76f4).
- `Slot`/zonas → se conserva para los controles de lienzo.

---

## 11. Paralelización

`composicionPestana` + región Shell (PR1) son prerequisito de todo → **secuencial**
PR1 → PR2 → PR3. Dentro de PR2, `SeccionColapsable` y "partir PanelFlotante" son
módulos distintos (primitivas/ vs resultados/) y pueden ir en lanes paralelas antes
de ensamblar `DockSeccion`. PR3 es independiente una vez PR2 aterriza.

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | 12 hallazgos, todos plegados al plan |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 6 issues, 0 critical gaps; faseado E1/E2/E3 |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score 3/10 → 9/10, 5 decisiones |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CODEX:** 12 hallazgos fundados en código (F3 ya presente, contrato null de PanelIsovalores, tamaño real de App.tsx, cromo horneado de PanelFlotante, ancho ≥384, scroll anidado, split CM/CR, Radix en Sidebar, esquema de vistaStore, semántica de ToolsRail, recuento E2E, faseado). Todos aceptados y plegados; ninguno descartado.
- **CROSS-MODEL:** Claude y Codex coinciden en los riesgos grandes (handoff F3, recomposición de App.tsx, superficie de tests/E2E). Única tensión: tamaño del primer corte → resuelta a favor del faseado por capas (E3).
- **VERDICT:** ENG CLEARED (faseado, F3-first) — listo para implementar cuando F3 aterrice. Design CLEARED. Eng review es el gate requerido y está en verde.

NO UNRESOLVED DECISIONS
