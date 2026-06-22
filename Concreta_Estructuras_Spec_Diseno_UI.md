# Concreta · Estructuras — Especificación de Diseño Frontend (UI/UX)

> **Qué es esto.** Especificación de diseño de la interfaz, extraída del prototipo de `claude.ai/design` (proyecto *Concreta Estructuras*, fichero `Concreta Estructuras.html` + `concreta/*.jsx` + `tokens.css`). Recoge **las decisiones de diseño clave** —no el píxel exacto— para que el equipo implemente la UI real sobre el stack del proyecto (React+TS+Vite · R3F · Zustand · Radix/shadcn · Tailwind).
>
> **Relación con otros documentos:**
> - `Concreta_Estructuras_Spec_Frontend.md` → spec **funcional** (pantallas, flujos). Este documento es el **lenguaje visual y de interacción**.
> - `investigacion/areas/03-frontend-cad.md` → **cómo** implementarlo con buen rendimiento (R3F, estado, picking, instancing). Este documento dice **qué** construir; aquel, **cómo**.
> - `CLAUDE.md` → reglas de oro (dos capas, vocabulario CYPECAD, unidades kN-m).
>
> **Naturaleza del prototipo (leer antes de copiar nada):** el mockup renderiza el lienzo en **SVG estático** y usa datos de ejemplo (edificio "Marqués de Larios", "PyNiteFEA 0.0.9"). Son **placeholders**: en producción el viewport es **three.js/R3F** (ver área 4 y el doc de I+D) y la versión del motor es la fijada en la investigación (PyNiteFEA 2.0.2). Del prototipo se toman **rasgos generales**: tokens, layout, IA, componentes y patrones de interacción.

---

## Índice de áreas

1. **Fundamentos visuales** — paleta, tipografía, semántica de elementos, sombras, radios.
2. **Layout & scaffold** — la arquitectura de pantalla "híbrido CYPECAD".
3. **Navegación e Information Architecture** — 4 solapas, menús contextuales, árbol de obra.
4. **El viewport (lienzo CAD)** — el núcleo: render, rejilla, HUD glass, 2D/3D/mosaico, deformada.
5. **Inventario de componentes UI** — paneles, diálogos, campos, chips, botones, tablas.
6. **Patrones de interacción y estados** — selección, introducción gráfica, cálculo asíncrono, "Ver modelo de cálculo".
7. **Lenguaje de producto** — las dos capas en pantalla, vocabulario, datos numéricos.
8. **Mapa de implementación** — cómo trasladar el prototipo SVG al stack real.

---

## 1 · Fundamentos visuales (Design tokens)

**Decisión rectora:** *lienzo claro tipo papel CAD* (no oscuro). El prototipo resolvió la ambigüedad del CLAUDE.md §18 ("¿oscuro o claro?") hacia **claro/papel con acentos**, manteniendo la sensación técnica vía tipografía monoespaciada y densidad alta. Todo se define con **CSS custom properties** (design tokens semánticos) → encaja con Tailwind + tema y con el `--accent` de marca.

### 1.1 Color — superficies y lienzo
| Token | Valor | Uso |
|---|---|---|
| `--canvas` | `#eef1f6` | Fondo del área de trabajo (papel CAD) |
| `--canvas-2` | `#ffffff` | Relieve de cotas/ejes sobre lienzo |
| `--canvas-grid` / `--canvas-grid-2` | `#cdd6e2` / `#aab8d0` | Malla de puntos (0,5 m) y plantilla DXF |
| `--canvas-axis` | `#7a90b6` | Ejes de replanteo |
| `--surface` | `#ffffff` | Paneles, sidebar, barras |
| `--surface-muted` / `--surface-sunken` | `#f5f7fa` / `#eef1f5` | Fondos secundarios, pies de diálogo, segmented |
| `--border` / `--border-2` / `--border-strong` | `#e2e7ee` / `#d2d9e2` / `#b9c2cf` | Jerarquía de líneas divisorias |

### 1.2 Color — texto e identidad
| Token | Valor | Uso |
|---|---|---|
| `--text` / `--text-2` / `--text-3` | `#1b2533` / `#5a6678` / `#8b95a5` | Texto primario / secundario / terciario |
| `--accent` / `--accent-hover` / `--accent-soft` | `#2563eb` / `#1d4ed8` / `#eaf0fe` | **Azul Concreta** (acción, selección, foco) |
| `--accent-line` | `#4f86f0` | Acento sobre lienzo (etiquetas seleccionadas) |
| `--on-accent` | `#ffffff` | Texto sobre acento |

### 1.3 Color — **semántica de elementos estructurales** (clave del producto)
Cada elemento de obra y cada primitiva FEM tiene **un color fijo y consistente** en todo el producto (lienzo, leyendas, árbol, swatches). Es un sistema semántico, no decorativo.

| Token | Valor | Significado |
|---|---|---|
| `--pilar` / `--pilar-line` | `#9db2ce` / `#b6c7dd` | Pilares |
| `--viga` / `--viga-line` | `#c9a66b` / `#ddbd87` | Vigas (ocre) |
| `--muro` | `#7c8aa3` | Muros (F3) |
| `--support` | `#22c55e` | Apoyos / arranques |
| `--load` | `#f97316` | Cargas (naranja) |
| `--moment` | `#a855f7` | Releases / momentos |
| `--deformed` | `#38bdf8` | Deformada / flecha |
| `--node` | `#c07d12` | Nudos FEM (Capa 2) |
| Estados | `--danger #dc2626` · `--warning #f59e0b` · `--success #16a34a` | Validación, mensajes |

> **Regla:** este mapa color→elemento es **canónico**. Reutilizarlo en swatches del árbol, leyendas, diagramas y badges. No introducir colores nuevos por elemento sin ampliar este sistema.

### 1.4 Rampa de isovalores / deformada (5 paradas)
Azul→Cian→Verde→Ámbar→Rojo, interpolada (`cxRamp(t)`), para deformada 3D, isovalores y leyenda:
`0.00 #2563eb` → `0.28 #38bdf8` → `0.52 #22c55e` → `0.74 #f59e0b` → `1.00 #dc2626`.
Mínimo abajo (azul), máximo arriba (rojo) en la leyenda vertical.

### 1.5 Tipografía
- **Geist** (sans) — UI general. Pesos 400/500/600. Tamaños base 12–14 px (densidad alta tipo CAD).
- **Geist Mono** — **todo dato numérico/técnico**: coordenadas, cotas, secciones, esfuerzos, nombres de elementos, código FEM. Self-hosted (`woff2`, `font-display:swap`).
- Utilidades: `.mono` (+ `font-variant-numeric: tabular-nums`), `.caps` (uppercase + `letter-spacing:.085em`), `.tnum` (tabular).
- **Decisión clave:** las cifras siempre en mono tabular → columnas numéricas alineadas, lectura de ingeniería.

### 1.6 Sombras y radios
| Token | Valor | Uso |
|---|---|---|
| `--shadow-panel` | `0 1px 2px rgba(20,30,48,.04)` | Relieve sutil (segmented, celdas) |
| `--shadow-float` | `0 12px 32px -10px …, 0 2px 8px -2px …` | Paneles y HUD flotantes |
| `--shadow-dialog` | `0 24px 60px -16px …, 0 4px 14px -4px …` | Diálogos modales |
- Radios: chips de barra 5–7 px; paneles 10 px; diálogos 14 px; pills 5 px; toggles 11 px (cápsula).

---

## 2 · Layout & scaffold (arquitectura de pantalla)

**Decisión rectora:** scaffold **"híbrido CYPECAD"** de regiones fijas con el lienzo dominando el centro. Estructura vertical (`.cx-app`, flex column, `overflow:hidden`):

```
┌─ Brandbar (40px) ───────────────────────────────────── logo · obra · kN·m │ undo/redo · 2D/3D · [Calcular obra] ┐
├─ Menubar (34px) ──────────── menús contextuales según solapa activa ───────────────────────────────────────────┤
├─ Body (flex 1) ───────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌ Sidebar (236px) ┐ ┌──────── Work canvas (flex, var(--canvas)) ────────┐ ┌ Tools rail (52px) ┐                  │
│ │ árbol de obra   │ │  viewport + HUD flotante (glass)                  │ │ F4·F3 · snap/orto │                  │
│ └─────────────────┘ └───────────────────────────────────────────────────┘ └───────────────────┘                  │
├─ Status bar (26px) ── mensaje(acento) │ x/y coords │ escala │ ● SNAP │ … (todo mono) ──────────────────────────┤
├─ Bottom tabs (34px) ── [1 Pilares][2 Vigas][3 Resultados][4 Isovalores·F3] ───────── CTE DB-SE · EHE-08 ───────┘
```

**Dimensiones de referencia** (densidad CAD, no espaciar de más):
- Brandbar 40 · Menubar 34 · Sidebar **236** · Tools rail **52** · Status 26 · Tabs 34.
- Fuente base del shell **13 px**; menús 12,5; status 11; swatches 9 px.

**Claves de las barras:**
- **Brandbar:** marca "Concreta" (600) + "Estructuras" (caps, text-3) + nombre de obra + **pill de unidades `kN · m`** (siempre visible, mono) + a la derecha el bloque de acción global con el **botón primario `Calcular obra`** (icono play).
- **Menubar:** menús que **cambian por solapa** (ver §3.2); el activo en `--accent`/`--accent-soft`; uno puede ir `strong` (p. ej. "Calcular").
- **Status bar:** **firma de ingeniería** — mensaje de guía en acento + coordenadas vivas `x y m` + escala `1:100` + estado de snap (`● SNAP EXT`), todo en mono.
- **Bottom tabs:** la **firma CYPECAD**. Solapas tipo carpeta (radio superior, borde inferior del activo en acento `box-shadow inset`), con **número** en chip mono. La 4ª (Isovalores) aparece **deshabilitada con badge F3** (futura). A la derecha, badge normativo `CTE DB-SE · EHE-08`.

---

## 3 · Navegación e Information Architecture

### 3.1 Las 4 solapas (modo de trabajo) — eje vertebrador
`1 Entrada de pilares` · `2 Entrada de vigas` · `3 Resultados` · `4 Isovalores` (F3, futura). Cambian: menús, sidebar, herramientas activas y contenido del viewport. Es la navegación primaria (abajo-izquierda, como CYPECAD).

### 3.2 Menús contextuales por solapa
La menubar es **dependiente del contexto**. Ejemplos extraídos del prototipo:
- **Pilares:** Archivo · Obra · **Introducción** · Edición · Grupos · Vistas · Ayuda.
- **Vigas:** Archivo · Obra · **Vigas** · Muros · Paños · Cargas · Cimentación · **Calcular** · Grupos · Vistas · Ayuda.
- **Resultados:** Archivo · Obra · Pilares/Pantallas · **Vigas** · Forjados · Cimentación · Envolventes · Vistas · Ayuda.

### 3.3 Sidebar — árbol de obra (lenguaje de obra, nunca FEM en Capas 1)
Secciones colapsables (`cx-side-sec` con cabecera caps 10 px):
- **Plantas / Grupos** — árbol agrupado: *Grupo → plantas*, con **cota** a la derecha (mono); la planta activa resaltada en acento. (Acción `+`.)
- **Vistas** — Planta de grupo, Vista 3D, Alzados (gestor de vistas).
- **Elementos leídos** — plantillas DXF importadas (swatch tenue).
- **Elementos propios** — Pilares, Vigas, Cargas, Cotas/ejes, con **swatch semántico** y **contador** (mono).

En **Resultados** el sidebar muta a: *Magnitud* (Deformada/Axil/Cortante/Flector/Torsor-flecha) · *Plantas visibles* · *Reacciones* (mini-tabla).
En **Ver modelo de cálculo** muta a: *Modelo PyNite* (Nodes/Members/Releases/Supports/Combos con contadores) · *Motor* (estado del worker) · *Validaciones* (checklist verde).

### 3.4 Tools rail (derecha, 52px) — ayudas de dibujo CAD
Iconos 36×36 con **F-keys** en superíndice: `F4 Plantillas DXF/DWG`, `F3 Capturas`, separador, `snap` (captura a objetos, on), `orto`, `rejilla`, separador, `biblioteca de secciones`, `config`, `ayuda`. Activo en `--accent-soft`.

---

## 4 · El viewport (lienzo CAD) — el núcleo

El área de trabajo es el corazón del producto. Render en SVG en el prototipo; **en producción, escena R3F** (ver §8). Decisiones de diseño a preservar:

### 4.1 Capas de render (orden z, de fondo a frente)
1. **Fondo** `--canvas` + **malla de puntos** cada 0,5 m (`--canvas-grid`, opacidad ~0.6).
2. **Plantilla DXF** (F4): contorno de fachada, particiones (dasharray), escalera, ascensor — líneas tenues `--canvas-grid-2`, **calcables, no interactivas**.
3. **Ejes de replanteo** (A,B,C / 1,2,3): líneas eje-punto-eje (`dasharray 7 3 1 3`) con **burbujas** circulares etiquetadas (mono).
4. **Cotas** lineales: línea de acento con garras + caja blanca con valor (mono, acento). Horizontales y verticales (texto rotado).
5. **Elementos de obra** (Capa 1): vigas (doble línea ocre, etiqueta Vn), pilares (cuadrado relleno semántico con cruz de ejes y etiqueta Pn + sección).
6. **Cargas** (en su modo): flechas naranja sobre vigas, **paño con hatch 45°** + valor `kN/m²`.
7. **Discretización** (Capa 2, semitransparente, toggle): nudos (anillo `--node`), releases (círculos `--moment`), apoyos (triángulo `--support`).
8. **Overlay de introducción**: banda elástica + cursor en cruz + caja de longitud/ángulo en acento.

### 4.2 HUD flotante "glass" sobre el lienzo (no cromo fijo)
Los controles del viewport **flotan** sobre el lienzo con efecto vidrio claro (`--glass rgba(255,255,255,.82)`, `backdrop-filter: blur(6px)`, borde `--glass-bd`, `--shadow-float`). Posiciones canónicas:
- **Arriba-izq:** *GroupRibbon* — planta activa + grupo + cota, con flechas ↑/↓ para cambiar de planta. En Resultados: *ComboRibbon* (combinación activa + play de animación).
- **Arriba-der:** *segmented* **2D / 3D / Mosaico** (modo de vista).
- **Abajo-der:** zoom `+ / −` (y viewcube en 3D).
- **Resultados, der:** *RampLegend* — barra de gradiente vertical con valores (mono) + unidad.
- **Modelo:** *toggle "Ver modelo de cálculo"* (arriba-der) + *nota de discretización* (abajo-izq) con leyenda nudos/releases/apoyos.

### 4.3 Modos de vista
- **2D Planta** — cámara ortográfica cenital del grupo activo (estándar CAD; escala constante, medible). Es el modo de introducción.
- **3D** — isométrica/perspectiva del edificio; en Resultados, **deformada coloreada** por la rampa + **fantasma** de la geometría sin deformar (`--undeformed`, opacidad baja).
- **Mosaico** — varias vistas simultáneas.

### 4.4 Deformada y diagramas (Resultados)
- Deformada: cada barra coloreada por magnitud normalizada (rampa §1.4); amplificación visual controlable; animación (play en ComboRibbon).
- **Dock inferior de esfuerzos** por barra seleccionada: 3 diagramas lado a lado (Flector My `--moment`, Cortante Fy `--load`, Flecha `--deformed`) con valores máx (mono) y selector Envolvente / combinación. Convención de signo: sagging positivo bajo el eje (el diagrama "imita" la deformada).

---

## 5 · Inventario de componentes UI

Catálogo de primitivas (clases `cx-*`) a portar a componentes React (Radix/shadcn + Tailwind tokens):

| Componente | Clase | Notas de diseño |
|---|---|---|
| **Panel flotante** | `.cx-float` + `.cx-panel-head` | Props/herramienta sobre el lienzo; cabecera con icono acento + título + **tag mono** (p. ej. `V·nueva`, `auto`) |
| **Diálogo modal** | `.cx-scrim` + `.cx-dialog` | Scrim `rgba(11,16,28,.42)` + blur; cabecera (icono+título+subtítulo+✕), cuerpo, pie con acciones a la derecha |
| **Campo numérico** | `.cx-input` | Input mono alineado a la derecha + **caja de unidad** anexa (mono, `--surface-muted`). Densidad: alto 26 px |
| **Select** | `.cx-select` | Altura 26, chevron text-3 |
| **Segmented** | `.cx-seg` | Grupo exclusivo (Izq/Centro/Der, Empotr./Articul., 2D/3D/Mosaico); activo `--surface` + shadow-panel |
| **Chip / pill** | `.cx-chip` / `.cx-pill` | Chip = toggle (hipótesis G/Q/V/N/E), `on` en acento; pill = etiqueta informativa mono (ámbito, sección) |
| **Botón** | `.cx-btn` | `primary` (acento, 600), `ghost` (surface + borde). Alto 30 |
| **Toggle/switch** | inline | Cápsula 34×20; on en `--accent` |
| **Tabla** | `.cx-tab-grid` | Cabeceras caps 9,5 px text-3; celdas 30 px; **columnas numéricas mono a la derecha**; fila `sel` en `--accent-soft` |
| **Fila de árbol** | `.cx-row` | 26 px, swatch 9 px + label + (contador/eye); `sel` en acento |
| **Nota/callout** | `.cx-note` | Caja flotante explicativa (p. ej. discretización) |

**Iconografía:** set propio (`CXIcon`) lineal, tamaño 12–18, `currentColor`. Iconos de dominio: `pilar`, `viga`, `fem`/`cpu` (modelo de cálculo), `carga`, `layers`, `planta-2d`, `cubo-3d`, `magnet`/`crosshair`/`grid` (ayudas CAD).

---

## 6 · Patrones de interacción y estados

### 6.1 Introducción gráfica (CAD)
- **Banda elástica** al trazar (viga): origen marcado, cursor en cruz con cuadro de captura, **etiqueta viva longitud/ángulo** (`13.10 m · 0°`) en acento.
- **Snap/Osnap** activo por defecto (estado en status bar); orto y rejilla conmutables (tools rail).
- Al fijar la viga aparece su **panel flotante de propiedades** (sección, material, empotramientos i/j, tirante).

### 6.2 Selección
- Elemento seleccionado → relleno/trazo en `--accent` + **halo punteado** (pilar) o engrosado (viga) + etiqueta en `--accent-line`.
- La selección dirige el panel de propiedades y, en Resultados, el dock de esfuerzos.

### 6.3 Cálculo asíncrono (estados visibles — regla CLAUDE.md §2.7)
- Botón global **`Calcular obra`** (brandbar). Estados explícitos: *cargando motor* (Pyodide/WASM) y *calculando*. El panel "Motor" muestra **estado del worker** (`● PyNite · Pyodide listo`, verde) y datos (Web Worker · WASM · análisis lineal).
- "Calcular" se habilita **solo con el worker listo**; mensajes en status bar.

### 6.4 "Ver modelo de cálculo" — el diferenciador
Toggle que superpone la **Capa 2 (FEM)** semitransparente sobre la obra: nudos, releases, apoyos, ejes de cálculo. Acompañado de:
- **Sidebar de modelo**: contadores Nodes/Members/Releases/Supports/Combos.
- **Validaciones** en checklist verde (Conectividad, Sujeción suficiente, Sin mecanismos, Nombres únicos).
- **Inspector JSON Capa 2**: fragmento de código PyNite con *syntax highlight* (mono) — `add_node`, `add_member`, `def_support` — y tabla elemento→primitiva (`P6 member`, `V5 member releases`, `support`). Es el **único lugar donde se expone jerga FEM** (regla CLAUDE.md §2.2).

### 6.5 Mensajería
- Status bar lleva la **línea de guía** contextual en acento ("Pulse el segundo punto de la viga…", "Seleccione las vigas o el paño…").
- Resultados de validación con `--success/--warning/--danger`; errores en **lenguaje de obra** (no FEM).

---

## 7 · Lenguaje de producto (las dos capas en pantalla)

Principios de diseño que materializan el CLAUDE.md:
1. **Capa 1 visible siempre en lenguaje de obra.** Árbol, etiquetas, diálogos hablan de pilares, vigas, plantas, grupos, hipótesis, categorías de uso — nunca de nodos/members salvo en "Ver modelo de cálculo".
2. **Vocabulario CYPECAD literal.** "Entrada de pilares", "Entrada de vigas", "Grupos/Plantas", "Hipótesis", "Envolventes", "Categoría de uso (CTE DB-SE-AE)".
3. **Normativa presente pero discreta.** Badge `CTE DB-SE · EHE-08`; ayudas contextuales ("La categoría A rellena 2.0 kN/m²; sobrescrito a 5.0"); combinaciones nombradas (`ELU 1.35G+1.5Q`, `ELS car · 1.0G+1.0Q`).
4. **Datos numéricos = mono tabular.** Coordenadas, cotas, secciones (`HA 30×50`), materiales (`HA-25`), esfuerzos, reacciones. Refuerza la confianza técnica.
5. **Unidades siempre explícitas y en los bordes.** Pill `kN · m` global; unidad anexa en cada campo (`kN/m²`, `cm`, `mm`). La conversión vive en `/src/unidades`, nunca en la UI.

---

## 8 · Mapa de implementación (prototipo SVG → stack real)

Traducción de las decisiones anteriores al stack del proyecto. **Conecta con `investigacion/areas/03-frontend-cad.md`.**

| Decisión de diseño | Implementación recomendada |
|---|---|
| Design tokens (`tokens.css`) | Portar las CSS custom properties como **fuente de verdad** de tema; consumir desde Tailwind (`theme.extend.colors` → `var(--…)`). Soporta tema claro y futuro oscuro. |
| Scaffold de regiones fijas | Layout con CSS grid/flex; cada región un componente del `shell/`. Dimensiones del §2 como tokens de espaciado. |
| 4 solapas + menús contextuales | `vistaStore` (pestaña activa, grupo activo, modo de vista) en Zustand; menús derivados de la solapa. |
| Sidebar/árbol, diálogos, tabs, popovers | **Radix** (Tabs, Dialog, Popover, Collapsible) + **shadcn** copiado al repo; estilar con tokens. Accesibilidad (foco, teclado, ARIA) gratis. |
| **Viewport** (planta + 3D + deformada) | **three.js + R3F + drei**, NO SVG. Cámara **ortográfica** (planta) / perspectiva (3D) con `makeDefault`. Picking con `<Bvh>`. Barras/nudos con `InstancedMesh`. `frameloop="demand"` + `invalidate()`. Mutación de refs en `useFrame` para hover/selección/animación (no `setState`). |
| Malla, ejes, cotas, DXF de fondo | Capas no-raycasteables; DXF como plantilla pasiva (`raycast` desactivado). Snap a rejilla `round(v/step)*step`; osnap por consulta espacial. |
| HUD glass flotante | Componentes HTML posicionados (`position:absolute`) **sobre** el `<Canvas>`, no dentro de la escena 3D (DOM, no WebGL). |
| Rampa de color / leyenda | Función `cxRamp(t)` reutilizable para deformada (vertex colors / material) e isovalores (F3). |
| Diagramas N/V/M/flecha | Arrancar con **Plotly** aislado tras `<DiagramaBarra>`; migrar a **uPlot** si crece el nº de barras/combos (ver I+D área 3). Datos desde los `*_array()` de PyNite. |
| Estado del modelo + undo/redo | `modeloStore` (Capa 1, única persistente) + **patrón Command** (delta, no snapshots). `seleccionStore`/`resultadosStore` separados. Editar la obra **invalida resultados**. |
| Estado del motor / cálculo | `solverClient` (Comlink) → worker Pyodide. Estados "cargando motor"/"calculando" → UI (botón Calcular, panel Motor, status bar). |
| Fuentes Geist/Geist Mono | Self-host `woff2` con `font-display:swap` (ya en `public/fonts`). |

### Notas de no-literalidad (placeholders del prototipo)
- `PyNiteFEA 0.0.9` → usar **2.0.2** (par con Pyodide 0.28.x; ver I+D área 1).
- Datos "Marqués de Larios", contadores (60 nudos, 92 barras…) → demo; vienen del discretizador real.
- El render SVG del mockup es **solo para fijar el aspecto**; la escena real es WebGL/R3F.

---

## Resumen de decisiones clave (one-liner)
1. Lienzo **claro tipo papel CAD**, no oscuro; tecnicismo vía **mono tabular** + densidad.
2. **Azul Concreta `#2563eb`** como único acento; **sistema de color semántico por elemento** canónico.
3. Scaffold **híbrido CYPECAD**: 4 solapas abajo, menús contextuales, árbol de obra, status bar de ingeniería.
4. Viewport dominante con **HUD glass flotante**; 2D ortográfico / 3D / mosaico; deformada con **rampa de 5 paradas**.
5. **Dos capas en pantalla**: obra en lenguaje de arquitecto siempre; **jerga FEM solo en "Ver modelo de cálculo"** (el diferenciador).
6. Tipografía **Geist / Geist Mono**; tokens CSS como fuente de verdad del tema.
7. Implementar el viewport en **R3F** (no SVG) con las prácticas de rendimiento del I+D área 3.
