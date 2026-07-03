# Plan · Auditoría de UI/UX — Concreta · Estructuras

> **Qué es esto.** Plan detallado y **autocontenido** para auditar la UI/UX de la app y
> proponer/aplicar mejoras. Está escrito para **ejecutarse en una sesión nueva con
> FABLE 5**: contiene el mapa del estado actual (para no re-descubrirlo), el método,
> las áreas a revisar con checklist concreto, y el formato de entregable.
>
> **Origen.** Encargo del usuario (arquitecto, autor del producto): *"no estoy seguro de
> algunas decisiones — paneles, forma de introducir parámetros, cómo se muestran los
> resultados, cómo se dibuja, el visor del modelo…"*. No es una auditoría de correctitud
> del cálculo (esa ya se hizo en `audit/fable5`); es una auditoría de **experiencia**.
>
> **Decisiones ya tomadas con el usuario (vinculantes para la ejecución):**
> 1. **Salida = Informe + fixes seguros.** Auditar, entregar informe con severidades y
>    recomendaciones; **aplicar directamente solo arreglos objetivos y de bajo riesgo**
>    (rojo→verde, con test). Las decisiones de UX **opinables** se dejan como
>    **propuestas** en un registro para que el usuario decida — NO se aplican solas.
> 2. **Método = híbrido.** Levantar la app y recorrerla en navegador real (gstack
>    `/browse`) **además** de leer código y contrastar con los specs de diseño.
> 3. **Alcance = todo lo alcanzable en la UI.** F1 (pilares/vigas/cargas/resultados) +
>    F2 (modal, centro de masas/rigidez) + F3 (losas, isovalores). **Prioridad al flujo F1.**

---

## 0 · Cómo usar este plan (arranque de la sesión Fable 5)

1. **Lee primero, en este orden:**
   - `CLAUDE.md` §2 (reglas de oro), §3 (dos capas), §11 (UI), §14 (unidades), §17 (antipatrones).
   - `Concreta_Estructuras_Spec_Diseno_UI.md` — **el lenguaje visual/interacción PREVISTO** (tokens exactos, colores semánticos, HUD glass, dock, tipografía). Es la vara de medir "conformidad con el diseño".
   - `Concreta_Estructuras_Spec_Frontend.md` — spec funcional (pantallas/flujos).
   - `plan-dock-paneles.md` — historia del refactor del dock (ya implementado, commit `b4a423d`). Explica la regla **"datos → dock, controles → lienzo"**.
   - Este archivo (§1 mapa del estado actual te ahorra el re-mapeo).
2. **Apóyate en los agentes especializados del proyecto** (ya existen, úsalos):
   - `experto-frontend-cad` para diagnosticar viewport, picking, re-render, R3F, estado.
   - `guardian-arquitectura` (read-only) para validar que cualquier fix respeta las reglas de oro **antes** de aplicarlo.
   - gstack: `/browse` (recorrer la app), `/design-review` o `/qa-only` (ojo de diseñador / QA sin arreglar). Nunca `mcp__claude-in-chrome__*`.
3. **No re-litigues arquitectura ya decidida** (dos capas, vocabulario CYPECAD, kN-m, sin backend, sin jerga FEM salvo "Ver modelo de cálculo", dock implementado). Auditas la **experiencia sobre** esa arquitectura, no la arquitectura.
4. **Trabaja en rama.** `git checkout -b audit/uiux` desde `main` (o desde la rama vigente que indique el usuario). No trabajes sobre `main`.

---

## 1 · Estado actual de la UI (mapa condensado — no re-descubrir)

> Extraído del código a fecha de este plan. Verifícalo si el árbol cambió, pero úsalo
> como punto de partida. Todas las referencias son `archivo:línea` aproximadas.

### 1.1 Shell (layout de regiones fijas — desktop only)
```
Brandbar (logo · obra · pill kN·m | undo/redo · estado motor · [Calcular obra])
Menubar  (menús que cambian por pestaña)
Body:  Sidebar(236px, árbol de obra) | Work(Viewport+HUD glass) | ToolsRail(52px) | Dock(≥384px, datos)
StatusBar (mensaje acento · coords x/y · escala · ● Snap)
BottomTabs (1 Pilares · 2 Vigas · 3 Resultados · 4 Isovalores | badge normativo)
```
- Ficheros: `src/ui/shell/{Shell,Brandbar,Menubar,Sidebar,StatusBar,BottomTabs,ToolsRail}.tsx`, `menus.ts`, `resolverVistaActiva.ts`, `shell.css`.
- Estado de vista: `src/estado/vistaStore.ts` (pestaña, grupo/planta activos, modoVista, herramienta, combinación, defaults por herramienta, toggles CM/CR/modelo-cálculo, escalas/animación, plantillas). **NO participa en undo.**
- **Dock ya implementado** (`Shell.tsx` `<aside className="cx-dock">`; `App.tsx` `composicionPestana`/`dockDePestana`, cromo plano `ProveedorModoPanel modo="plano"`). Regla: paneles de **datos** → dock; **controles de lienzo** (ribbon, 2D/3D, zoom, leyenda) → HUD glass.

### 1.2 Pestañas y menús
- 4 pestañas CYPECAD; **pilares y vigas SEPARADAS** (no fusionadas). `entradaVigas` alberga también paños, cargas, hipótesis y **Calcular**.
- Menús contextuales por pestaña (`menus.ts`). Muchos ítems son **placeholders sin acción** (Archivo/Abrir/Guardar/Exportar, Vistas, Ayuda, Materiales…). Acciones reales: herramientas (pilar/viga/paño), abrir diálogos (grupos, hipótesis, opciones), calcular, calcular modos, eliminar selección.
- **Calcular** aparece como menú solo en pestaña Vigas; el **botón primario "Calcular obra"** vive siempre en Brandbar (duplicado deliberado).

### 1.3 Sidebar
- Sección "Plantas/Grupos" (árbol, cota a la derecha, planta activa resaltada, botón "Gestionar…"). Sección "Vistas" (**placeholders no accionables**; el toggle real 2D/3D está en el HUD). Sección "Elementos propios" (Pilares/Vigas con **contador**, no accionable).

### 1.4 ToolsRail (52px)
- F4 Plantillas DXF (toggle, cableado), F3 Capturas PNG (acción). Snap (toggle **cableado** a `snapActivo`). **Orto y Rejilla = toggles cosméticos con estado LOCAL, sin efecto real.** Biblioteca de secciones / Config / Ayuda = placeholders.

### 1.5 Introducción de parámetros
- **Pilar**: panel-herramienta (Sección, Material, Ángulo `°`, Arranque Empotrado/Articulado/Elástico, Vinculación exterior Sí/No) + **1 clic** en planta (snap: DXF>rejilla 0.5m). Edición en **Inspector** (X/Y, sección, material, ángulo, plantas inicial/final, arranque, vinculación) con **commit en vivo** y validación campo-a-campo inline (`role="alert"`).
- **Viga**: panel (Sección, Material, Extremo I/J Empotrado/Articulado — deshabilitados si Tirante, Tirante Sí/No) + **2 clics** con **imán** a nudos/cabezas de pilar (criterio = clave de rejilla, no distancia euclídea) > DXF > rejilla. Inspector **solo-propiedades** (no edita geometría).
- **Paño/losa**: panel (Espesor mm, Material, Tamaño malla mm, Apoyo borde Apoyado/Empotrado/Libre) + **2 clics** (rectángulo, **solo snap rejilla**, sin imán a obra — corte aislado). Inspector solo-propiedades + carga superficial.
- **Grupos/Plantas**: diálogo maestro-detalle, commit en vivo. Grupo: nombre, categoría de uso (SelectUso CTE, auto-rellena qk), sobrecarga kN/m², cargas muertas kN/m². Planta: nombre, cota m. Borrado con conteo de cascada.
- **Cargas**: en el Inspector del elemento. **Solo lineal (viga/pilar) y superficial (paño) desde UI**; **puntual NO expuesta** (existe en dominio). Valor + hipótesis; "Añadir carga" deshabilitado si valor ≤ 0.
- **Hipótesis**: diálogo maestro-detalle. Siembra "Peso propio" (automática, read-only) y "Sobrecarga de uso". Nombre + tipo Permanente/Variable.
- **Secciones/Materiales**: `SelectSeccion` (catálogo perfiles + secciones de obra; dimensiones en mm en etiqueta) y `SelectMaterial` (catálogo inmutable). **No hay UI visible para crear/editar sección o material** ni preview de geometría/propiedades (fck, E, ρ).
- **Opciones de análisis**: diálogo (tipo Lineal/General/P-Δ, peso propio ON, comprobar estática — se auto-desmarca y deshabilita bajo P-Δ).

### 1.6 Viewport y dibujo
- Lienzo **claro** (`--canvas #eef1f6`), rejilla de 0.5 m, ejes en origen, gizmo de orientación en esquina.
- Colores semánticos centralizados (`colores.ts` ← tokens CSS): Pilar `--pilar` gris, Viga `--viga` ocre, hover `--accent-line`, selección `--accent` azul, halo punteado azul para pilar único. Paño semitransparente.
- Modos: **2D planta** (ortográfica, MapControls pan/zoom), **3D** (perspectiva iso, OrbitControls, encuadre automático al entrar + botón "Encuadrar"), **Mosaico** (placeholder → cae a 3D).
- HUD (8 zonas `Slot`+`createPortal`): GroupRibbon (grupo/planta/cota + flechas ↑↓) top-left, Selector 2D/3D top-right, Zoom +/−/Encuadrar bottom-right.
- Rendimiento cuidado: `frameloop="demand"`, InstancedMesh, BVH picking, hover/selección/animación por mutación de refs (sin setState por frame).

### 1.7 Resultados
- **Deformada**: solo 3D; lineSegments color por vértice (rampa 5 paradas); animación (1−cos)/2; **LeyendaEscala** con slider amplificación **[1x, 500x] manual** + toggle animar + rótulos min/max en mm + tag "obsoleta" si el cálculo es anterior a una edición.
- **ComboSelector**: ELU/ELS (Radix Select). **Diagramas N/V/M/flecha** (Plotly por barra seleccionada); segmentado de magnitud; **sin anotación de picos máx/mín**. Pilar trocado → muestra "Primer tramo".
- **TablaReacciones**: FX/FY/FZ/MX/MY/MZ por apoyo (nombre de pilar vía trazabilidad); apoyos de borde de losa agregados en fila "Losa (borde)" con momentos "—".
- **Isovalores** (paños): malla color por vértice, magnitud Flecha/Mx/My, `LeyendaRampa`. `PanelIsovalores` (selector magnitud + combo).
- **Frecuencias/modal**: `PanelFrecuencias` (nº modos [1,30], calcular modos, lista f en Hz, aviso si acotado, slider amplificación **[0.1, 5] m**, animar). `ModoOverlay` espejo de deformada, solo 3D.
- **Ver modelo de cálculo** (único sitio con jerga FEM): solo 3D; toggle + "ocultar obra"; conteos nudos/barras/apoyos; glifos de apoyo por forma (cuadrado/triángulo/círculo, colorblind-safe).
- **Centro de masas ⊕** (cerise, solo planta) y **Centro de rigidez ◇** (teal, solo planta): toggles + panel con coords/peso; controles en dock "Ayudas", marcadores en escena.

### 1.8 Estado del motor / asíncrono
- Estado del worker en Brandbar (rótulo en lenguaje de obra: Listo/Calculando/Error). "Calcular" deshabilitado hasta motor listo. Mensajes en StatusBar. `calculoStore` compartido botón/menú/brandbar.

### 1.9 "Olores" ya detectados (hipótesis a verificar, NO hallazgos confirmados)
> Semillas para arrancar. Cada una hay que **verificarla en la app en marcha** y contra la **intención del usuario** antes de clasificarla. No las des por ciertas.
- Orto/Rejilla son toggles que **no hacen nada** (confunden: parecen activos y no cambian nada).
- Sidebar "Vistas" muestra opciones no accionables; el 2D/3D real está en otro sitio (HUD).
- Muchos ítems de menú son placeholders sin acción ni "próximamente" visible.
- No se puede introducir **carga puntual** desde la UI.
- No hay **biblioteca visible** para crear/editar secciones ni materiales; ni preview de la sección elegida.
- Para cambiar la sección de un elemento ya colocado hay que abrir el Inspector (no hay atajo).
- Deformada solo en 3D (no hay proyección de flecha en planta); escala **manual** (estructuras rígidas se ven planas a 1x).
- Diagramas sin **valores máximos/mínimos** anotados.
- Terminología de amplificación inconsistente: deformada = factor adimensional `×`; modal = cota `m`.
- Posible falta de feedback visual de "calculando" en el propio viewport (spinner/overlay).
- "Eliminar" existe en el menú Edición incluso en pestañas donde no se edita (Resultados/Isovalores).

---

## 2 · Objetivos y principios de medida

**Objetivo:** que un arquitecto español acostumbrado a CYPECAD pueda **introducir una obra,
calcularla y leer resultados** con el menor esfuerzo, menor tasa de error y mayor confianza,
sin que la potencia FEM se filtre como complejidad.

**Vara de medir (aplica estas lentes a cada pantalla):**
1. **Conformidad con el spec de diseño** (`Spec_Diseno_UI.md`): ¿los tokens, colores semánticos, tipografía mono tabular, densidad, HUD glass, dock, estados se implementaron como se decidió? Anota **desviaciones**.
2. **Coherencia interna**: mismos patrones para tareas análogas (commit en vivo, segmentados, unidades anexas, mensajes de error, iconografía, radios/sombras). Toda inconsistencia es candidata.
3. **Heurísticas de usabilidad** (Nielsen, adaptadas a CAD):
   - Visibilidad del estado (motor, cálculo, snap, herramienta activa, selección).
   - Correspondencia con el mundo real / **vocabulario CYPECAD**, cero jerga FEM fuera de "Ver modelo de cálculo".
   - Control y libertad (undo/redo, Esc, cancelar colocación).
   - Prevención de errores > mensajes de error; y errores en **lenguaje de obra**, apuntando al culpable.
   - Reconocer > recordar (defaults, valores recordados, ayudas contextuales).
   - Flexibilidad y eficiencia (atajos de teclado, encadenar elementos, F-keys).
   - Diseño minimalista (regla de sustracción: nada siempre-visible sin motivo).
   - Feedback y estados (vacío/cargando/error/parcial en cada panel de datos).
4. **Fricción del flujo real** (medida en dogfooding): número de clics/cambios de contexto para tareas frecuentes; callejones sin salida; sorpresas.
5. **Accesibilidad básica de escritorio**: foco visible, navegación por teclado, `aria-*`, contraste, `prefers-reduced-motion`, tamaños de target (26–30px es la postura del proyecto).

**Fuera de alcance (no gastes esfuerzo aquí):** móvil/táctil; reescribir la arquitectura de dos
capas; reimplementar cálculo; features de fases futuras (armado, cimentación, memorias PDF);
rediseño de marca (paleta/tipografías definitivas son placeholders del §18 del CLAUDE.md — puedes
señalarlo pero no resolverlo).

---

## 3 · Método (híbrido) — fases de ejecución

### Fase 0 · Preparación del entorno (una vez)
1. `npm install` si hace falta; `npm run dev` (Vite). Anota la URL local.
2. Abre la app con gstack `/browse`. **Pyodide/WASM tarda** en la primera carga (~15–30 MB): para auditar navegación/entrada/diálogos NO necesitas el motor; deja que caliente en segundo plano y audita el motor solo cuando vayas a Resultados.
3. **Semilla de datos para probar resultados:** construye a mano una obra mínima **como parte de la auditoría de entrada** (2 plantas, 4 pilares, vigas de cierre, una carga, opcional un paño) — esto ya te da material del §5.C. Como alternativa/complemento, revisa `e2e/fixtures.ts` y los specs E2E (`e2e/F1.*.spec.ts`) para reproducir un modelo válido conocido. Calcula (deja cargar el motor una vez) para tener deformada/diagramas/reacciones/isovalores.
4. Prepara carpeta de evidencias en el scratchpad para capturas: usa el directorio de scratchpad de la sesión. Nombra las capturas por área (`shell-menubar.png`, `inspector-pilar.png`…).

### Fase 1 · Estático + conformidad con el spec (rápido, determinista)
- Recorre `src/ui/**` por áreas (§5). Para cada una: lee el componente + su `.css`, compara con el spec de diseño y con el resto de la app (coherencia).
- Verifica **tokens** (`src/styles/tokens.css`, `fonts.css`) contra `Spec_Diseno_UI.md` §1 (valores exactos de color, la rampa de 5 paradas, Geist/Geist Mono, sombras/radios). Lista desviaciones.
- Revisa los `.test.tsx` existentes para entender el contrato de cada componente (no rompas esos contratos con tus fixes).

### Fase 2 · Dogfooding interactivo (lo importante para UX)
- Ejecuta los **recorridos de usuario** (§4) en el navegador real. En cada uno: captura pantalla, cuenta clics/cambios de pestaña, anota fricción, sorpresas, estados que faltan, feedback ausente.
- Prueba a **equivocarte a propósito** (valores negativos, plantas incoherentes, borrar algo con cargas, calcular sin sujeción, colocar viga degenerada) y evalúa la calidad y el lenguaje de los errores.
- Prueba **teclado**: Tab por diálogos e inspectores, Esc, atajos anunciados (F3/F4), foco visible.
- Opcional: lanza `/design-review` o `/qa-only` de gstack sobre pantallas concretas para una segunda opinión de "ojo de diseñador".

### Fase 3 · Síntesis, clasificación y decisión
- Consolida hallazgos, dedup, clasifica por severidad (§6) y por tipo (**objetivo/bajo-riesgo** vs **opinable**).
- **Aplica** los objetivos/bajo-riesgo (rojo→verde, §7). **Registra** los opinables como propuestas para el usuario.
- Escribe el informe (§6) y el registro de decisiones (§7.3).

---

## 4 · Recorridos de usuario a ejecutar (dogfooding)

Ejecuta cada uno en el navegador; captura y anota. Son la fuente principal de hallazgos UX.

1. **Arranque en frío**: primera carga. ¿Qué ve el usuario sin obra? ¿Hay onboarding/estado vacío/guía? ¿Se entiende qué hacer primero? ¿El estado del motor es legible?
2. **Definir estructura**: crear grupo(s) y plantas (diálogo Grupos/Plantas). ¿Categoría de uso clara? ¿La auto-sincronización de sobrecarga se entiende? ¿Cotas coherentes? ¿Feedback al borrar?
3. **Introducir pilares**: activar herramienta, elegir sección/material, colocar varios (encadenar). ¿Snap predecible? ¿Marcador claro? ¿Cómo cambio la sección de uno ya puesto? ¿Ángulo/vinculación se entienden?
4. **Introducir vigas**: 2 clics con imán a pilares. ¿El imán engancha lo que espero? ¿Se ve el punto de origen y la banda elástica y la longitud/ángulo en vivo? ¿Extremos/tirante claros? ¿Se puede cancelar a media viga (Esc)?
5. **Introducir un paño (losa)** y su carga superficial. ¿Rectángulo claro? ¿Espesor/malla/apoyo comprensibles? ¿Por qué no engancha a la obra (aislado) se comunica?
6. **Cargas e hipótesis**: añadir cargas lineales a viga/pilar, gestionar hipótesis. ¿Se entiende que no hay puntual? ¿La hipótesis "Peso propio" protegida se explica? ¿Combinaciones visibles?
7. **Calcular**: pulsar Calcular. ¿Feedback de "cargando motor"/"calculando"? ¿Cuánto tarda percibido? ¿Qué pasa si la estructura no está sujeta (provoca el error a propósito)? ¿El mensaje es de obra y apunta al culpable?
8. **Leer resultados**: cambiar a Resultados/3D. Deformada (escala, animación, combinación), diagramas por barra (seleccionar barra, cambiar N/V/M/flecha), tabla de reacciones. ¿Leo el máximo de un diagrama fácil? ¿La deformada se ve a 1x? ¿Entiendo la leyenda?
9. **Isovalores** del paño: Flecha/Mx/My, leyenda. ¿Escala/unidades claras? ¿Rango legible?
10. **Modal**: calcular modos, animar, cambiar de modo. ¿Amplificación clara? ¿Aviso de acotado?
11. **Ver modelo de cálculo** (3D): activar, ocultar obra, leer conteos y glifos. ¿Se entiende la Capa 2 sin ser ingeniero FEM? ¿Es útil como docencia?
12. **Centro de masas / rigidez** (planta): activar toggles, leer paneles. ¿Marcadores distinguibles? ¿Datos claros?
13. **Ayudas de dibujo**: DXF (F4) importar/mover/escalar plantilla; captura PNG (F3); snap on/off; **probar Orto/Rejilla** (¿hacen algo?).
14. **Editar y recalcular**: modificar la obra tras calcular. ¿Se marca resultado "obsoleto"? ¿Se invalida bien? Undo/redo de varias acciones.
15. **Navegación general**: recorrer las 4 pestañas, los menús (¿cuántos ítems no hacen nada?), la sidebar, la statusbar. Cambiar grupo/planta activos.

---

## 5 · Áreas de auditoría (checklist por área)

> Para cada área: **inspecciona** los ficheros, **ejecuta** los recorridos relevantes, y responde
> el checklist. Anota cada respuesta problemática como hallazgo candidato con evidencia.

### A. Shell, navegación e IA
Ficheros: `src/ui/shell/*`, `App.tsx` (composición por pestaña), `vistaStore.ts`.
- [ ] ¿El layout coincide con el spec (dimensiones, regiones, densidad)? ¿La jerarquía visual guía la vista al lienzo?
- [ ] Menús: ¿qué proporción de ítems son placeholders sin acción? ¿Se marca lo no disponible (deshabilitado/badge "próximamente") o parece roto?
- [ ] ¿La separación pilares/vigas en pestañas distintas ayuda o estorba al flujo? (contrástalo con el recorrido 3–4; es una **decisión opinable** clave para el usuario).
- [ ] Sidebar "Vistas": opciones no accionables — ¿confunden? "Elementos propios" no accionable — ¿debería seleccionar/aislar?
- [ ] StatusBar: ¿el mensaje contextual es útil y correcto por pestaña/herramienta? ¿Refleja la selección?
- [ ] ¿Redundancia Brandbar "Calcular" vs menú "Calcular" — intencionada y clara, o confusa?
- [ ] Duplicidad/ubicación del toggle 2D/3D (HUD vs sidebar "Vistas").

### B. Dock de paneles (refactor reciente)
Ficheros: `Shell.tsx` (`cx-dock`), `App.tsx` (`composicionPestana`/`dockDePestana`), `PanelFlotante.tsx` (modos glass/plano), `shell.css`.
- [ ] ¿Se respeta "datos → dock, controles → lienzo"? ¿Algún panel de datos sigue flotando sobre el modelo?
- [ ] ¿El dock se lee como **un** panel con secciones (cromo plano, cero card/sombra interior) según el plan? ¿Anchura ≥384 sin scroll horizontal?
- [ ] Estados de cada sección del dock: vacío/cargando/error/parcial (p. ej. Diagramas sin barra seleccionada, Isovalores sin placa, Resultados sin calcular). ¿Existen o hay `return null` que "desaparece" el panel?
- [ ] ¿El dock aparece/desaparece de forma predecible por pestaña? ¿Se puede colapsar? ¿Hay scroll único (no anidado)?
- [ ] Coherencia con el spec de "secciones colapsables" y con la sidebar (¿mismo primitivo?).

### C. Introducción de parámetros y entrada gráfica
Ficheros: `src/ui/entradaPilares/*`, `entradaVigas/*`, `entradaPanos/*`, `src/ui/viewport/{ColocacionPilar,ColocacionViga,ColocacionPano,snap,imanViga}.*`.
- [ ] **Descubribilidad**: ¿cómo sabe el usuario que debe elegir sección/material antes de colocar? ¿El panel-herramienta guía?
- [ ] **Snap/imán**: ¿predecible? ¿feedback visual del punto de enganche? ¿se puede forzar rejilla frente a imán? ¿radio (0.6m) vs paso (0.5m) genera conflictos?
- [ ] **Banda elástica y cotas vivas** (viga): ¿se muestran longitud/ángulo como pide el spec §6.1? ¿origen marcado?
- [ ] **Editar tras colocar**: cambiar sección/material/plantas — ¿número de pasos razonable? ¿inconsistencia pilar (edita geometría) vs viga/paño (solo-propiedades)?
- [ ] **Unidades en campos**: ¿unidad anexa siempre visible (mm/m/°/kN·)? ¿mm↔m solo en el borde? ¿algún campo sin unidad o con conversión dudosa?
- [ ] **Commit en vivo vs blur**: coherente entre inspectores y diálogos.
- [ ] **Carga puntual ausente**: ¿es un vacío que frustra? (opinable — decisión de alcance).
- [ ] **Colocación de paño**: ¿se comunica que es aislado (no engancha a la obra)? ¿confunde?
- [ ] Estado vacío del inspector ("Selecciona un elemento…") y del panel-herramienta.

### D. Diálogos
Ficheros: `src/ui/dialogos/{DialogoGruposYPlantas,DialogoHipotesis,DialogoOpcionesAnalisis,SeccionCargas}.tsx`, `Dialogo.tsx`, `*.css`.
- [ ] Patrón maestro-detalle coherente entre diálogos; foco inicial; cierre con Esc/✕; scrim.
- [ ] Grupos/Plantas: ¿categoría de uso y auto-relleno de qk comprensibles? ¿ayuda contextual ("categoría A → 2.0 kN/m²; sobrescrito a X")? ¿validación de cotas/nombres clara?
- [ ] Hipótesis: ¿la automática de peso propio se explica (por qué es read-only)? ¿combinaciones nombradas visibles?
- [ ] Opciones de análisis: ¿el bloqueo de "comprobar estática" bajo P-Δ se explica? ¿lenguaje de obra?
- [ ] Accesibilidad de diálogos (Radix): roles, foco atrapado, teclado.

### E. Cargas e hipótesis
Ficheros: `SeccionCargas.tsx`, `entradaPanos/SeccionCargaSuperficial.tsx`, `SelectHipotesis.tsx`, biblioteca de acciones.
- [ ] Flujo de añadir/editar/borrar carga; ¿editar carga = borrar+crear (fricción)?
- [ ] ¿Se ven las cargas existentes con su hipótesis y valor claramente? ¿signo/sentido comprensible?
- [ ] Combinaciones (ELU 1.35G+1.5Q / ELS) ¿visibles y nombradas en algún sitio antes de calcular?
- [ ] ¿La normativa está "presente pero discreta" como pide el spec §7.3?

### F. Secciones y materiales (biblioteca)
Ficheros: `SelectSeccion.tsx`, `SelectMaterial.tsx`, `src/biblioteca/*`.
- [ ] ¿Falta una **biblioteca visible** para crear/editar secciones (hormigón paramétrico, perfiles) y verlas? (opinable, alcance — el ToolsRail tiene un botón "biblioteca" placeholder).
- [ ] ¿Preview de la sección (geometría) y del material (fck/E/ρ/denominación)? ¿O el usuario elige a ciegas por nombre?
- [ ] Etiquetas: dimensiones en mm, denominación normativa; ¿mono tabular?

### G. Viewport / dibujo del modelo
Ficheros: `src/ui/viewport/{Viewport,Escena,GeometriaModelo,colores,ejesEscena,Hud,Slot,AjusteCamara3D}.*`, `useGeometriaModelo.ts`.
- [ ] **Colores semánticos** vs spec §1.3 (pilar/viga/muro/support/load/moment/deformed/node): ¿fieles y consistentes en lienzo, leyendas, árbol, badges?
- [ ] **Legibilidad en planta**: grosores, etiquetas de elemento (Pn/Vn + sección), cruz de ejes del pilar, rejilla, cotas. ¿El spec pide doble línea ocre para vigas y etiquetas — están?
- [ ] **Selección/hover**: ¿claros y distinguibles? ¿halo solo para pilar único — y las vigas/paños seleccionados cómo se marcan? ¿multiselección con Shift descubrible?
- [ ] **Cámara**: pan/zoom/órbita naturales; encuadre automático correcto; zoom con +/− y rueda; ¿"Mosaico" es placeholder (cae a 3D) — se comunica o engaña?
- [ ] **HUD glass**: legibilidad sobre el lienzo, no tapa el modelo, posiciones canónicas del spec §4.2.
- [ ] **Ejes/gizmo/orientación**: ¿el usuario entiende dónde está el norte/planta/3D?

### H. Resultados (deformada, diagramas, reacciones)
Ficheros: `src/ui/resultados/{DeformadaOverlay,deformadaGeometria,ComboSelector,LeyendaEscala,PanelDiagramas,DiagramaBarra,TablaReacciones}.*`.
- [ ] **Deformada solo 3D**: ¿el usuario que está en planta entiende que debe ir a 3D? ¿debería haber flecha en planta? (opinable).
- [ ] **Escala manual [1x,500x]**: ¿auto-escala inicial sensata? ¿estructuras rígidas se ven planas y confunden? (candidato a fix seguro: default calculado; validar con el usuario si cambia comportamiento).
- [ ] **Diagramas**: ¿fácil seleccionar la barra? ¿se anotan **máx/mín**? ¿leyenda de ejes/unidades? ¿convención de signo comunicada (sagging)? Pilar trocado: ¿"Primer tramo" es suficiente o se pierde info?
- [ ] **Reacciones**: columnas claras (FX..MZ), nombres de apoyo por pilar, fila "Losa (borde)" con "—" en momentos — ¿se entiende por qué? ¿mono tabular alineado?
- [ ] Tag "obsoleta" al editar tras calcular: ¿visible y comprensible?
- [ ] ComboSelector: ¿ELU/ELS con nombres legibles? ¿envolvente disponible?

### I. Isovalores / paños
Ficheros: `IsovaloresOverlay.tsx`, `PanelIsovalores.tsx`, `LeyendaRampa.tsx`, `isovaloresBuffers.ts`.
- [ ] Magnitudes (Flecha/Mx/My): ¿etiquetas y unidades (kN·m/m, mm) claras? ¿rango de la rampa legible y con números?
- [ ] ¿Isovalores en planta Y 3D — coherente? ¿leyenda min/max? ¿estado vacío si no hay placa calculada?

### J. Modal / frecuencias
Ficheros: `PanelFrecuencias.tsx`, `ModoOverlay.tsx`, `modalStore.ts`.
- [ ] Nº de modos, calcular, lista de f (Hz), aviso de acotado: ¿claros?
- [ ] Amplificación en **m** vs deformada en **×**: **inconsistencia terminológica** — evaluar unificar el lenguaje/UX (candidato a fix seguro de etiqueta o propuesta).
- [ ] Solo 3D, animación: coherente con deformada.

### K. Ver modelo de cálculo · CM · CR (overlays)
Ficheros: `ModeloCalculo*.tsx`, `CentroMasa*.tsx`, `CentroRigidez*.tsx`, `modeloCalculoGeometria.ts`.
- [ ] "Ver modelo de cálculo": ¿es comprensible/útil (docencia) sin ser ingeniero? ¿la jerga FEM está confinada aquí (única excepción permitida)? ¿glifos de apoyo legibles?
- [ ] Solo 3D: ¿se comunica que en planta no aparece?
- [ ] CM ⊕ vs CR ◇: ¿distinguibles (color+forma)? ¿paneles claros? ¿por qué solo en planta?

### L. Estados asíncronos, feedback y errores (transversal)
Ficheros: `calculoStore.ts`, `estadoMotorUI.ts`, `BotonCalcular.tsx`, `Brandbar.tsx`, `useCalcular.ts`, validaciones.
- [ ] **Feedback de cálculo**: ¿estados "cargando motor" y "calculando" visibles y suficientes (¿en el viewport, no solo en el botón?)? ¿progreso percibido tolerable?
- [ ] **Errores de validación**: en lenguaje de obra, apuntando al elemento, accionables. Provoca varios y evalúa (recorrido 7).
- [ ] **Estados vacíos** en todos los paneles de datos del dock.
- [ ] **ErrorBoundary**: ¿un fallo de un panel (p. ej. Plotly) degrada con gracia sin tumbar la app?
- [ ] `prefers-reduced-motion` respetado en animaciones (deformada/modal/colapsos).

---

## 6 · Entregable: informe de auditoría

Escribe `informe-auditoria-uiux.md` (raíz del repo). Estructura (calca la auditoría previa `audit/fable5`):

1. **Resumen ejecutivo**: nº de hallazgos por severidad; los 3–5 temas de mayor impacto; qué se aplicó (rojo→verde) y qué queda como propuesta para decidir.
2. **Hallazgos**, uno por bloque, ordenados por severidad. Para cada uno:
   - **ID y título** (p. ej. `UX-A-3 · Menús con ítems muertos sin señalizar`).
   - **Severidad** (§ criterios abajo) y **tipo**: `objetivo/bajo-riesgo` o `opinable`.
   - **Área** (A–L) y **archivo:línea**.
   - **Evidencia**: captura(s) + descripción del recorrido donde apareció.
   - **Impacto en el usuario** (por qué importa para un arquitecto).
   - **Recomendación** concreta. Si es opinable: 2–3 opciones con trade-offs.
   - **Estado**: `APLICADO` (con commit/test) · `PROPUESTO` (espera decisión) · `DOCUMENTADO` (deuda menor).
3. **Conformidad con el spec de diseño**: tabla de desviaciones token/patrón vs `Spec_Diseno_UI.md`.
4. **Zonas limpias**: qué está bien resuelto (para no tocarlo).
5. **Registro de decisiones opinables** (§7.3) para el usuario.
6. **Limitaciones** de la auditoría (qué no se pudo probar y por qué).

**Criterios de severidad (UX):**
- **Crítico**: bloquea una tarea F1 esencial, provoca pérdida de trabajo, o hace creer al usuario algo falso sobre su estructura.
- **Alto**: fricción grave o confusión frecuente en el flujo F1; incoherencia que erosiona la confianza; error sin lenguaje de obra.
- **Medio**: fricción o inconsistencia notable pero con workaround; desviación del spec visible.
- **Bajo**: cosmético, pulido, deuda menor.

Actualiza también `MEMORY.md` con un puntero a la auditoría (una línea) y crea un memory `project` con el resumen y las deudas UX abiertas (sigue las reglas de memoria del entorno).

---

## 7 · Aplicar fixes: qué sí y qué no

### 7.1 Aplica directamente (rojo→verde) — solo objetivo / bajo riesgo
Ejemplos del tipo permitido (aplícalos con test cuando toquen lógica):
- Cablear o **retirar** los toggles muertos Orto/Rejilla (si retiras, es cambio visible → mejor propuesta; si cableas Rejilla a mostrar/ocultar la malla, es bajo riesgo — usa tu juicio y déjalo trazado).
- Añadir **unidad anexa** faltante en un campo; corregir una etiqueta ambigua/errata; unificar el sufijo de amplificación.
- Añadir **estado vacío** a un panel de datos que hoy hace `return null`.
- Señalizar ítems de menú no disponibles (deshabilitar + tooltip "próximamente") en vez de dejarlos como clic muerto.
- **Anotar máx/mín** en los diagramas (es aditivo y objetivamente útil).
- Añadir **foco visible**/`aria-label` faltante; respetar `prefers-reduced-motion` donde falte.
- Corregir desviaciones de token respecto al spec (color/tipografía que no coinciden con el valor decidido).

Regla: si el cambio **no altera un comportamiento que el usuario podría querer** y **no es cuestión de gusto**, es seguro. Ante la duda → propuesta.

### 7.2 NO apliques (deja como propuesta)
- Reordenar/fusionar pestañas (pilares+vigas), reubicar Calcular, rediseñar la sidebar.
- Cambiar el modelo de introducción (nº de clics, imán, commit en vivo).
- Auto-escalar la deformada por defecto (cambia lo que ve el usuario).
- Añadir features de alcance (carga puntual, biblioteca de secciones editable, proyección 2D de deformada).
- Cualquier cambio de paleta/marca (placeholders del §18).

### 7.3 Registro de decisiones opinables
Mantén una tabla en el informe: `ID · descripción · opciones (A/B/C) · recomendación · impacto · esfuerzo`. El usuario decide; NO implementes hasta que lo apruebe.

### 7.4 Guardarraíles al aplicar
- **Antes de codificar un fix**, pásalo por `guardian-arquitectura` si toca invariantes (dos capas, vocabulario, unidades, jerga FEM, dock).
- Respeta: TypeScript `strict` sin `any`; español ASCII en dominio, inglés en infraestructura, etiquetas UI con tildes; comentarios en español sobre el *porqué*.
- **No rompas tests.** Tras cada tanda: `npm run lint && npm run typecheck && npm run test`. Si tocas flujos E2E, `npm run e2e`. Actualiza los `.test.tsx` afectados en el mismo commit.
- Conversión de unidades **solo en el borde** (`/src/unidades`); nunca en mitad de la UI.
- Commits pequeños y descriptivos por hallazgo (p. ej. `ux(A-3): señaliza ítems de menú no disponibles + test`). No mezcles fixes de distintas áreas en un commit.
- No toques `/src/discretizador`, `/src/solver`, `/src/dominio` salvo que un hallazgo de UX lo exija y lo justifiques (y entonces con guardián).

---

## 8 · Orden sugerido de ejecución

1. Fase 0 (entorno + semilla de datos).
2. Recorridos 1–4 + áreas A, C, D (el corazón F1: navegar e introducir). Prioridad máxima.
3. Recorridos 5–7 + áreas B, E, F, L (paños, cargas, dock, cálculo/estados).
4. Recorridos 8–12 + áreas G, H, I, J, K (dibujo y resultados — todo lo que el usuario mencionó explícitamente).
5. Recorridos 13–15 (ayudas, edición/recalcular, barrido general).
6. Fase 3: síntesis, aplicar seguros, escribir informe + registro de decisiones, actualizar memoria.

**Consejo de eficiencia:** puedes lanzar `experto-frontend-cad` en paralelo para diagnósticos
profundos de un área mientras tú haces dogfooding de otra. Consolida sus hallazgos en el informe
(verifícalos en la app; no los des por buenos sin evidencia).

---

## 9 · Definición de "hecho"
- Informe `informe-auditoria-uiux.md` completo, con severidades, evidencia (capturas) y registro de decisiones opinables.
- Fixes seguros aplicados en rama `audit/uiux`, con `lint`+`typecheck`+`test` en verde (y `e2e` si se tocó).
- Memoria actualizada (puntero en `MEMORY.md` + memory `project` de deudas UX).
- Un mensaje final al usuario: top hallazgos, qué se aplicó, y **la lista de decisiones opinables que necesitan su criterio** (idealmente vía preguntas concretas).
