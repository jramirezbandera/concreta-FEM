# Área 3 · Frontend CAD/3D (React + TS + Vite + R3F/drei + Zustand + Command)

> Investigación de mejores prácticas para el editor gráfico tipo CYPECAD de **Concreta · Estructuras**.
> Stack objetivo: React + TypeScript + Vite + three.js + React-Three-Fiber (R3F) + drei + Zustand(+Immer) + patrón Command para undo/redo. Viewport conmutable 2D planta / 3D / mosaico, selección/hover, inspector, diagramas Plotly, deformada 3D animada, lienzo oscuro tipo CAD.

---

## Resumen ejecutivo

1. **El modelo no va en estado React reactivo del bucle de render.** El "loop visual" (cámara, hover, animación de deformada, arrastre) se actualiza por **mutación directa de refs dentro de `useFrame`** y por **transient updates de Zustand (`store.subscribe`)**, nunca por `setState`/selectores que disparen render por frame. Esto es consenso explícito de los docs de R3F y Zustand.
2. **Separar tres ámbitos de estado**: (a) *modelo persistente* (Capa 1, la obra) en `modeloStore`; (b) *estado transitorio de UI* (selección, hover, cámara, pestaña activa) en stores propios (`seleccionStore`, `vistaStore`); (c) *estado efímero de render* (posiciones animadas, drag en curso) **fuera de React**, en refs/Three. Mezclarlos es la causa nº1 de jank.
3. **Undo/redo por patrón Command con `aplicar()`/`revertir()` que guardan solo el *delta***, no snapshots completos del modelo. Para acciones que tocan varias partes, **Composite Command / transacción** (begin/commit) agrupa varios comandos en una sola entrada de historial.
4. **Cámara**: ortográfica para planta 2D (sin distorsión, escala constante — estándar CAD), perspectiva para 3D. Conmutar con `makeDefault` de drei, pero **recrear/reanclar controles y postproceso** al cambiar, porque el swap dinámico rompe `OrbitControls`/efectos.
5. **Picking acelerado con `three-mesh-bvh`** (envoltorio `<Bvh>` de drei): mejora el raycasting en órdenes de magnitud frente a comprobar triángulo a triángulo. Imprescindible cuando hay muchos elementos.
6. **Instancing (`InstancedMesh` / `<Instances>` de drei)** para elementos repetidos (barras, nudos, símbolos): una sola draw call para miles de objetos. Reutilizar geometrías/materiales con `useMemo`/scope global; nunca recrearlos por frame ni montar/desmontar para ocultar (usar `visible`).
7. **`frameloop="demand"` + `invalidate()`**: el lienzo CAD pasa mucho tiempo estático; renderizar solo cuando cambia algo (edición, cámara, animación) ahorra batería/CPU. Durante animación de deformada se usa el loop continuo o se llama `invalidate()` por frame.
8. **Diagramas N/V/M/flecha**: Plotly es cómodo y rico pero **pesado** (~3 MB) y flojo con muchos puntos/charts simultáneos; **uPlot** es la alternativa ligera y rápida para los diagramas por barra. Recomendación: uPlot para diagramas densos, Plotly solo si se necesitan sus interacciones 3D/avanzadas.
9. **Snapping**: el snap a rejilla es aritmética simple (`round(v/step)*step`); el snap a objeto (extremos, intersecciones) requiere consultas espaciales. DXF de fondo como capa no interactiva detrás del modelo.
10. **Radix UI / shadcn** para diálogos, pestañas y popovers: comportamiento y accesibilidad (focus trap, ARIA, teclado) de Radix; estilo con Tailwind + **CSS variables como design tokens semánticos** (encaja con el lienzo oscuro y los tokens del spec).

---

## 1. Arquitectura de estado para CAD

### 1.1 No metas el modelo entero en estado React reactivo del bucle de render
- **Claim:** El estado que cambia muchas veces por segundo (cámara, hover, posiciones animadas, arrastre) **no** debe pasar por `setState` ni por selectores de Zustand suscritos en componentes que se renderizan por frame; debe mutarse directamente en refs/objetos Three dentro de `useFrame`.
- **Rationale:** Los docs de R3F lo afirman literalmente ("don't `setState` inside `useFrame`"): enrutar una actualización por frame a través del scheduler de React provoca render de componentes y GC innecesarios; la mutación directa de refs es la vía esperada y mantiene 60/120 fps. Todo lo que ocurre dentro de `useFrame` está fuera de React y no provoca re-render.
- **Sources:** https://r3f.docs.pmnd.rs/advanced/pitfalls · https://r3f.docs.pmnd.rs/advanced/scaling-performance · https://discourse.threejs.org/t/how-to-use-state-management-with-react-three-fiber-without-performance-issues/61223
- **Confidence:** alta

### 1.2 Transient updates de Zustand (`subscribe`) para el viewport
- **Claim:** Para llevar estado de Zustand al viewport sin re-render, usar **transient updates**: `store.subscribe(selector, callback)` dentro de un `useEffect` (con desuscripción al desmontar), y aplicar el cambio por mutación; o leer el estado directamente (`useStore.getState()`) dentro de `useFrame` en vez de suscribirse.
- **Rationale:** La documentación de Zustand describe `subscribe` como mecanismo para "bind a component to a state-portion without forcing re-render on changes", recomendado precisamente cuando se puede "mutate the view directly". Es la combinación canónica con R3F.
- **Sources:** https://awesomedevin.github.io/zustand-vue/en/docs/advanced/transiend-updates · https://github.com/pmndrs/react-three-fiber/issues/126 · https://zustand.docs.pmnd.rs/learn/index
- **Confidence:** alta

### 1.3 Separar modelo persistente de estado transitorio en stores distintos
- **Claim:** Mantener stores separados por ciclo de vida: `modeloStore` (Capa 1, persistente/undo-able), `seleccionStore` (selección/hover, efímero), `vistaStore` (pestaña, grupo activo, modo de vista, combinación activa), `resultadosStore` (derivados). No mezclar selección/hover/cámara con el modelo.
- **Rationale:** Cada componente debe suscribirse al mínimo slice que necesita y re-renderizar solo cuando ese slice cambia; separar dominios evita que un hover invalide componentes del árbol del modelo y simplifica el snapshot para undo (solo `modeloStore` participa en la pila de comandos). El patrón de slices está documentado para apps grandes.
- **Sources:** https://zustand.docs.pmnd.rs/learn/index · https://deepwiki.com/pmndrs/zustand/2.3-selectors-and-re-rendering · https://github.com/pmndrs/zustand
- **Confidence:** alta

### 1.4 Selectores atómicos y `useShallow` para evitar re-renders
- **Claim:** Suscribirse con **selectores atómicos** (un valor por hook) cuando sea posible; al seleccionar varios valores en un objeto/array, usar **`useShallow`** para comparar superficialmente y evitar re-render por nueva referencia. Nunca suscribirse a acciones solo para renderizar (las acciones son estables).
- **Rationale:** Zustand compara con igualdad estricta por defecto; construir un objeto nuevo en el selector en cada render dispara re-render salvo que se use `useShallow`. Documentado en la guía oficial y en el deepwiki de selectores.
- **Sources:** https://deepwiki.com/pmndrs/zustand/2.3-selectors-and-re-rendering · https://zustand.docs.pmnd.rs/learn/index · https://github.com/pmndrs/zustand/discussions/2642
- **Confidence:** alta

---

## 2. Patrón Command / undo-redo

### 2.1 Comandos con `aplicar()`/`revertir()` que guardan el delta, no snapshots
- **Claim:** Cada edición de obra es un objeto comando con `aplicar()` y `revertir()` que conoce únicamente el cambio que produce (el delta) y cómo deshacerlo; la pila de historial almacena estos comandos, no copias completas del modelo.
- **Rationale:** Almacenar el *historial de cambios* (Command) en vez del *historial de estados* (Memento/snapshot con deep-clone) escala mejor con modelos grandes y un historial largo, evitando clonado profundo costoso. Es el argumento central del patrón Command para undo/redo.
- **Sources:** https://www.esveo.com/en/blog/undo-redo-and-the-command-pattern/ · https://www.jitblox.com/blog/designing-a-lightweight-undo-history-with-typescript · https://medium.com/fbbd/intro-to-writing-undo-redo-systems-in-javascript-af17148a852b
- **Confidence:** alta

### 2.2 Composite Command / transacciones para agrupar
- **Claim:** Operaciones que tocan varias partes del modelo (p. ej. crear una planta con sus pilares, o pegar un grupo) se agrupan en un **Composite Command** (macro) o transacción `begin/commit`, de modo que un solo "deshacer" revierte todo el lote y aparece como una entrada nombrada en el historial.
- **Rationale:** La interfaz común de comando permite componer varios en uno; las transacciones (`OpenUndoTransaction`/`CloseUndoTransaction`) son el patrón estándar para que múltiples sub-acciones se deshagan/rehagan atómicamente, importante cuando un cambio afecta varios slices.
- **Sources:** https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2007/ms477952(v=office.12) · https://java-design-patterns.com/patterns/command/ · https://www.esveo.com/en/blog/undo-redo-and-the-command-pattern/
- **Confidence:** alta

### 2.3 Coalescing de comandos para acciones continuas
- **Claim:** Para acciones de entrada continua (arrastrar un pilar, escribir en un campo numérico), **fusionar (coalesce)** los micro-cambios en una sola entrada de historial: actualizar la última entrada en vez de empujar una nueva (`upsertCommand` frente a `pushCommand`).
- **Rationale:** Evita que un arrastre genere cientos de entradas de undo; el patrón de "upsert" sobre la entrada previa está descrito como técnica práctica de coalescing.
- **Sources:** https://www.esveo.com/en/blog/undo-redo-and-the-command-pattern/ · https://lobste.rs/s/lwepwh/undo_redo_command_pattern
- **Confidence:** media

### 2.4 Integración con Zustand (+Immer)
- **Claim:** Los comandos operan sobre `modeloStore` mediante acciones de set con Immer (producen el nuevo estado de forma inmutable); el comando captura lo necesario para revertir. Al aplicar/revertir un comando se **invalidan los resultados** (`resultadosStore`), pues la deformada/esfuerzos dejan de ser válidos.
- **Rationale:** Immer permite escribir mutaciones "drafty" y obtener estado inmutable, compatible con la captura de delta por comando; existen patrones documentados de undo/redo con Zustand. La invalidación de derivados es coherente con el modelo de dos capas del proyecto.
- **Sources:** https://dev.to/math-krish/time-travel-for-your-state-undoredo-with-zustand-and-react-query-part-2-4d64 · https://zustand.docs.pmnd.rs/learn/index
- **Confidence:** media

---

## 3. Viewport R3F (escena 3D/2D ↔ React)

### 3.1 Cámara ortográfica para planta, perspectiva para 3D
- **Claim:** Usar **OrthographicCamera** para la vista en planta 2D (sin distorsión de perspectiva, los objetos conservan su tamaño real → estándar CAD/arquitectura) y **PerspectiveCamera** para la vista 3D; en ortográfica el "zoom" se hace con la propiedad `zoom`/frustum y la navegación es paneo.
- **Rationale:** Documentación y guías de R3F/drei señalan la ortográfica como idónea para CAD y visualización arquitectónica precisamente por mantener escala y permitir medir; drei expone `OrthographicCamera`/`PerspectiveCamera` con `makeDefault`.
- **Sources:** https://iifx.dev/en/articles/457433476/orthographic-camera-control-a-guide-for-three-js-react-three-fiber-users · https://onion2k.github.io/r3f-by-example/examples/cameras/orthographic-camera/ · https://drei.docs.pmnd.rs/
- **Confidence:** alta

### 3.2 Conmutación de cámara con `makeDefault`, reanclando controles
- **Claim:** Conmutar planta/3D montando ambas cámaras y controlando `makeDefault` por estado; **al cambiar hay que reanclar/recrear `OrbitControls` y el postproceso**, porque el swap dinámico perspectiva↔ortográfica puede romper controles y efectos.
- **Rationale:** Discusiones oficiales de R3F advierten que "swapping from perspective to orthographic dynamically can cause problems with systems like controls and postprocessing"; la solución habitual es vincular los controles a la cámara activa y reinicializarlos.
- **Sources:** https://github.com/pmndrs/react-three-fiber/discussions/709 · https://github.com/pmndrs/react-three-fiber/discussions/933
- **Confidence:** alta

### 3.3 Gizmo de orientación con drei
- **Claim:** Para el cubo/gizmo de orientación 3D usar `GizmoHelper` + `GizmoViewcube`/`GizmoViewport` de drei, vinculados a los controles de cámara.
- **Rationale:** drei provee estos helpers listos para integrar con `OrbitControls`/`CameraControls`, evitando reinventar la navegación por caras.
- **Sources:** https://drei.docs.pmnd.rs/ · https://shekhar14.medium.com/react-three-fiber-r3f-blog-series-part-2-9cd7b1312de6
- **Confidence:** media

### 3.4 Desacoplar escena de React: leer estado, no atarse a él
- **Claim:** Los objetos de escena (barras, nudos) se declaran como JSX a partir del modelo, pero las actualizaciones de alta frecuencia (selección visual, hover, animación) se aplican por mutación/refs; la escena lee el modelo, no se "ata" reactivamente a cada cambio efímero.
- **Rationale:** Mantiene el viewport fluido y separa "qué existe" (declarativo, render ocasional) de "cómo se ve ahora mismo" (imperativo, por frame), alineado con 1.1–1.2.
- **Sources:** https://r3f.docs.pmnd.rs/advanced/pitfalls · https://discourse.threejs.org/t/how-to-use-state-management-with-react-three-fiber-without-performance-issues/61223
- **Confidence:** alta

---

## 4. Picking / selección

### 4.1 Raycasting acelerado con three-mesh-bvh / `<Bvh>` de drei
- **Claim:** Acelerar el picking envolviendo la escena (o subgrafos) con `<Bvh>` de drei, que computa el `boundsTree` y asigna `acceleratedRaycast` de **three-mesh-bvh**; mejora el raycasting en órdenes de magnitud frente a probar todos los triángulos.
- **Rationale:** Documentación de drei y three-mesh-bvh: el BVH particiona el espacio y descarta grandes porciones de geometría antes de comprobar triángulos; recomendado explícitamente para escenas grandes/complejas.
- **Sources:** https://drei.docs.pmnd.rs/performances/bvh · https://github.com/gkjohnson/three-mesh-bvh · https://www.npmjs.com/package/three-mesh-bvh
- **Confidence:** alta

### 4.2 Eventos de puntero de R3F para selección/hover, con capas
- **Claim:** Usar los eventos de puntero integrados de R3F (`onPointerOver`/`onPointerOut`/`onClick`, `event.stopPropagation()`) para hover y selección de barras/nudos; segmentar lo seleccionable con **layers** o `raycast` desactivado en mallas decorativas (rejilla, DXF) para no interferir.
- **Rationale:** R3F enruta el raycasting a través de su sistema de eventos; limitar qué es raycasteable (capas / `raycast={null}`) reduce coste y evita seleccionar el fondo. (Complementa el BVH de 4.1.)
- **Sources:** https://r3f.docs.pmnd.rs/advanced/pitfalls · https://drei.docs.pmnd.rs/performances/bvh
- **Confidence:** media

### 4.3 Hover highlighting sin re-render del árbol
- **Claim:** El resaltado de hover/selección debe cambiar material/emissive/escala por mutación de ref del objeto apuntado (o mediante un store transitorio leído en `useFrame`), no re-renderizando el componente de cada barra.
- **Rationale:** Mismo principio de 1.1–1.2: el hover es alta frecuencia; cambiar color por `setState` en cientos de barras causa jank. La mutación directa o el outline/postproceso es la vía.
- **Sources:** https://r3f.docs.pmnd.rs/advanced/pitfalls · https://github.com/pmndrs/react-three-fiber/issues/126
- **Confidence:** alta

---

## 5. Rendimiento R3F

### 5.1 Instancing para elementos repetidos
- **Claim:** Renderizar barras, nudos y símbolos repetidos con **`InstancedMesh`** (o `<Instances>`/`<Instance>` de drei): una sola draw call para miles de objetos que comparten geometría y material.
- **Rationale:** Docs de R3F y drei: el instancing reduce drásticamente draw calls; R3F recomienda "use instancing as much as you can when you need to display many objects of a similar type" y `InstancedMesh` para cientos de miles de objetos en una draw call.
- **Sources:** https://r3f.docs.pmnd.rs/advanced/scaling-performance · https://tympanus.net/codrops/2025/07/10/three-js-instances-rendering-multiple-objects-simultaneously/ · https://r3f.docs.pmnd.rs/advanced/pitfalls
- **Confidence:** alta

### 5.2 Reutilizar geometrías/materiales; no recrear por frame; ocultar con `visible`
- **Claim:** Compartir geometrías y materiales (scope global o `useMemo`); no asignar `new Vector3`/`new Material` dentro de `useFrame` ni bucles; **ocultar con `visible={false}` en lugar de montar/desmontar** para no recompilar materiales.
- **Rationale:** R3F advierte que crear objetos por frame fuerza al GC y que el montaje indiscriminado obliga a compilación/proceso caros de materiales y geometrías; togglear visibilidad preserva recursos compilados.
- **Sources:** https://r3f.docs.pmnd.rs/advanced/pitfalls · https://r3f.docs.pmnd.rs/advanced/scaling-performance
- **Confidence:** alta

### 5.3 `frameloop="demand"` + `invalidate()`; loop continuo solo en animación
- **Claim:** Configurar el `<Canvas frameloop="demand">` para renderizar solo cuando hay cambios; llamar `invalidate()` cuando se muta algo fuera del conocimiento de React (controles de cámara, fin de un drag). Para la animación de deformada, usar loop continuo o `invalidate()` por frame mientras dure.
- **Rationale:** El lienzo CAD está estático gran parte del tiempo; el modo "demand" ahorra batería/CPU. Los docs aclaran que `invalidate()` no renderiza al instante sino que solicita un frame, y que conviene pre-llamarlo antes de animar para evitar saltos.
- **Sources:** https://r3f.docs.pmnd.rs/advanced/scaling-performance
- **Confidence:** alta

### 5.4 Regresión de calidad durante el movimiento y profiling
- **Claim:** Usar `performance.regress()` + `performance.current` para bajar pixel ratio/efectos durante navegación y restaurar al detenerse; **medir antes de optimizar** con `r3f-perf` o el panel Performance de Chrome. Apuntar a < ~100–1000 draw calls; usar LOD (`<Detailed/>`) si el 3D crece.
- **Rationale:** Docs de R3F describen el sistema de regresión de rendimiento (los componentes deben escuchar el factor, "mere calls to regress() will not change anything"); las guías de three.js recomiendan reducir draw calls y perfilar primero. LOD puede mejorar fps un 30–40% en escenas grandes.
- **Sources:** https://r3f.docs.pmnd.rs/advanced/scaling-performance · https://www.utsubo.com/blog/threejs-best-practices-100-tips · https://tympanus.net/codrops/2025/02/11/building-efficient-three-js-scenes-optimize-performance-while-maintaining-quality/
- **Confidence:** alta

---

## 6. Edición en planta 2D

### 6.1 Snap a rejilla = aritmética simple
- **Claim:** El snap a rejilla se implementa como `snapped = Math.round(value / step) * step` por eje; densidad de rejilla visible y densidad de snap pueden diferir.
- **Rationale:** No requiere cálculo vectorial; es redondeo al múltiplo más cercano del paso. Convención de CAD (AutoCAD) que la rejilla mostrada y el snap pueden tener pasos distintos.
- **Sources:** https://medium.com/@rychkov/brief-deconstruction-of-snapping-in-cad-like-web-drawing-f5f2f5be3ebd · https://opentextbc.ca/autocad2d/chapter/grids-and-snap/
- **Confidence:** alta

### 6.2 Snap a objeto (osnap) por consulta espacial; precalcular parámetros
- **Claim:** El snap a puntos notables (extremos de pilar/viga, intersecciones, puntos medios) requiere consultar candidatos cercanos al cursor con tolerancia; optimizar inicializando los parámetros de rejilla/snap una vez y actualizándolos por suscripción solo si cambian, evitando recalcular en cada `move`.
- **Rationale:** El artículo de deconstrucción de snapping en CAD web detalla que el snap a objeto va más allá de la aritmética de rejilla y recomienda no re-direccionar el parámetro de rejilla en cada movimiento por rendimiento.
- **Sources:** https://medium.com/@rychkov/brief-deconstruction-of-snapping-in-cad-like-web-drawing-f5f2f5be3ebd · https://nanocad.com/learning/online-help/nanocad-platform/snap-and-grid-mode/
- **Confidence:** media

### 6.3 Plantillas DXF de fondo como capa no interactiva
- **Claim:** Cargar el DXF (F4) como una capa de líneas detrás del modelo, con `raycast` desactivado/baja opacidad, para que sirva de calco sin capturar eventos de picking ni participar en el snap salvo que se active explícitamente.
- **Rationale:** Coherente con 4.2 (segmentar lo seleccionable) y con la práctica CAD de plantilla de fondo; mantiene el rendimiento del picking del modelo.
- **Sources:** https://r3f.docs.pmnd.rs/advanced/pitfalls · https://medium.com/@rychkov/brief-deconstruction-of-snapping-in-cad-like-web-drawing-f5f2f5be3ebd
- **Confidence:** baja

---

## 7. Diagramas (N/V/M/flecha)

### 7.1 Plotly: rico pero pesado y limitado con mucho dato/charts
- **Claim:** Plotly.js es cómodo y completo (incl. 3D), pero **pesado** y con problemas de rendimiento con datasets grandes o muchos gráficos simultáneos en una página.
- **Rationale:** Comparativas coinciden en que Plotly.js es más pesado que la mayoría y "struggles with performance with large datasets or many charts on a page"; el coste de carga es un factor.
- **Sources:** https://www.scichart.com/blog/alternatives-to-plotly-js/ · https://medium.com/@ponshriharini/comparing-8-popular-react-charting-libraries-performance-features-and-use-cases-cc178d80b3ba · https://npmtrends.com/chartjs-vs-plotly.js-vs-uplot
- **Confidence:** media

### 7.2 uPlot: ligero y rápido para diagramas densos por barra
- **Claim:** Para los diagramas N/V/M/flecha por barra (muchos puntos, posiblemente varios a la vez), **uPlot** es la opción ligera y de alto rendimiento; reservar Plotly solo si se necesitan sus interacciones/3D.
- **Rationale:** uPlot se cita como alternativa "lighter and faster" frente a Plotly para casos no-3D; el propio CLAUDE.md del proyecto ya lo contempla como alternativa por rendimiento. Limpiar instancias al desmontar para evitar fugas de memoria.
- **Sources:** https://npmtrends.com/chartjs-vs-plotly.js-vs-uplot · https://www.scichart.com/blog/alternatives-to-plotly-js/ · https://medium.com/@ponshriharini/comparing-8-popular-react-charting-libraries-performance-features-and-use-cases-cc178d80b3ba
- **Confidence:** media

> Recomendación: arrancar el MVP con Plotly (velocidad de desarrollo, los `*_array()` de PyNite mapean directo), pero aislar el diagrama tras un componente `<DiagramaBarra>` para poder cambiar a uPlot si el rendimiento con muchas barras/combos lo exige.

---

## 8. Primitivas UI accesibles (Radix/shadcn + Tailwind tokens)

### 8.1 Radix para comportamiento/accesibilidad; Tailwind para estilo
- **Claim:** Construir diálogos, pestañas y popovers sobre **primitivas Radix** (Dialog, Tabs, Popover): aportan focus trap, navegación por teclado, gestión de foco y ARIA "battle-tested" sin estilo; el estilo va con Tailwind.
- **Rationale:** shadcn se asienta sobre Radix + Tailwind; las primitivas Radix proveen el comportamiento complejo accesible mientras permanecen sin estilar. Customizar la "capa de superficie" sin tocar la "base" de comportamiento de Radix preserva la accesibilidad.
- **Sources:** https://vercel.com/academy/shadcn-ui/what-are-radix-primitives · https://eastondev.com/blog/en/posts/dev/20260330-shadcn-radix-accessibility/ · https://infinum.com/handbook/frontend/react/tailwind/shadcn
- **Confidence:** alta

### 8.2 Design tokens como CSS variables semánticas (encaja con lienzo oscuro)
- **Claim:** Definir el sistema de diseño con **CSS custom properties** que crean tokens semánticos de color (acento Concreta, fondos de panel, semántica de color en resultados) consumidos por Tailwind; permite tema oscuro/claro y centraliza la marca.
- **Rationale:** shadcn implementa el design system directamente con utilidades Tailwind y CSS variables como tokens semánticos; encaja con el `--accent` provisional y los tokens del spec, y con el estilo lienzo oscuro tipo CAD.
- **Sources:** https://vercel.com/academy/shadcn-ui/core-concepts · https://www.radix-ui.com/themes/docs/overview/styling · https://infinum.com/handbook/frontend/react/tailwind/shadcn
- **Confidence:** alta

### 8.3 Código propio (copy-in), no dependencia opaca
- **Claim:** Con shadcn los componentes se copian al repo y quedan bajo control del proyecto (100% editables), a diferencia de una librería externa cerrada.
- **Rationale:** Es el modelo explícito de shadcn ("copy-and-paste blueprints ... que siguen siendo 100% tuyos"), útil para ajustar a fondo la estética CAD sin pelearse con overrides.
- **Sources:** https://vercel.com/academy/shadcn-ui/why-shadcn-ui-is-different · https://vercel.com/academy/shadcn-ui
- **Confidence:** alta

---

## Recomendaciones accionables

1. **Tres ámbitos de estado, stores separados.** `modeloStore` (Capa 1, persistente, único que entra en la pila de undo) · `seleccionStore` (selección/hover) · `vistaStore` (pestaña, grupo activo, modo de vista, combinación) · `resultadosStore` (derivados, se limpian al editar). Nada de cámara/hover en el store del modelo.
2. **Regla de oro del viewport:** nada de alta frecuencia pasa por `setState`. Cámara, hover, drag y animación de deformada → **mutación de refs en `useFrame`** y **`store.subscribe` (transient)**. Leer con `getState()` dentro de `useFrame`.
3. **Selectores atómicos + `useShallow`** para multi-pick; no suscribirse a acciones para render.
4. **Undo/redo Command:** interfaz `aplicar()/revertir()` con delta; `CompositeComando`/transacción `begin/commit` para acciones multi-parte; **coalescing** en arrastres y edición numérica continua. Aplicar/revertir invalida `resultadosStore`.
5. **Cámara:** `OrthographicCamera` (planta) y `PerspectiveCamera` (3D) con `makeDefault`; al conmutar, **reanclar `OrbitControls`/`CameraControls` y postproceso** a la cámara activa. Gizmo con `GizmoHelper` de drei.
6. **Picking:** envolver la escena del modelo en `<Bvh>` (three-mesh-bvh). Hacer no-raycasteables rejilla y DXF de fondo (capas / `raycast={null}`). Hover/selección por mutación de material/emissive o outline, no por re-render.
7. **Render:** `InstancedMesh`/`<Instances>` para barras/nudos/símbolos repetidos; geometrías/materiales compartidos (`useMemo`/global); ocultar con `visible`, no desmontar; `frameloop="demand"` + `invalidate()` en estático y loop continuo solo durante la animación de deformada; `performance.regress()` al navegar; perfilar con `r3f-perf`.
8. **Planta 2D:** snap a rejilla por aritmética (`round(v/step)*step`); osnap por consulta de candidatos con tolerancia, parámetros de rejilla precalculados; DXF de fondo como capa pasiva.
9. **Diagramas:** aislar tras `<DiagramaBarra>`; arrancar con Plotly por velocidad de desarrollo, dejar puerta abierta a **uPlot** si crece el nº de barras/combinaciones simultáneas. Limpiar instancias al desmontar.
10. **UI:** Radix (Dialog/Tabs/Popover) para accesibilidad + Tailwind con **CSS variables semánticas** como design tokens (acento Concreta, paneles, semántica de color de resultados); componentes shadcn copiados al repo para control total del estilo CAD oscuro.
11. **Tests:** golden del discretizador en Node puro (fuera de este área pero condiciona la arquitectura); para el viewport, tests de que las acciones efímeras no disparan render del árbol del modelo (medir re-renders con React DevTools/why-did-you-render en dev).

---

### Fuentes principales
- R3F — Performance pitfalls: https://r3f.docs.pmnd.rs/advanced/pitfalls
- R3F — Scaling performance (demand/invalidate, instancing, regress): https://r3f.docs.pmnd.rs/advanced/scaling-performance
- three.js forum — state management con R3F sin problemas de rendimiento: https://discourse.threejs.org/t/how-to-use-state-management-with-react-three-fiber-without-performance-issues/61223
- Zustand — Learn / selectores y re-render: https://zustand.docs.pmnd.rs/learn/index · https://deepwiki.com/pmndrs/zustand/2.3-selectors-and-re-rendering
- Zustand — Transient updates: https://awesomedevin.github.io/zustand-vue/en/docs/advanced/transiend-updates · https://github.com/pmndrs/react-three-fiber/issues/126
- Command/undo-redo: https://www.esveo.com/en/blog/undo-redo-and-the-command-pattern/ · https://www.jitblox.com/blog/designing-a-lightweight-undo-history-with-typescript · https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2007/ms477952(v=office.12)
- drei — Bvh / three-mesh-bvh: https://drei.docs.pmnd.rs/performances/bvh · https://github.com/gkjohnson/three-mesh-bvh
- Cámaras orto/perspectiva en R3F: https://github.com/pmndrs/react-three-fiber/discussions/709 · https://iifx.dev/en/articles/457433476/orthographic-camera-control-a-guide-for-three-js-react-three-fiber-users
- Snapping CAD web: https://medium.com/@rychkov/brief-deconstruction-of-snapping-in-cad-like-web-drawing-f5f2f5be3ebd
- Diagramas: https://www.scichart.com/blog/alternatives-to-plotly-js/ · https://npmtrends.com/chartjs-vs-plotly.js-vs-uplot
- Radix/shadcn/Tailwind: https://vercel.com/academy/shadcn-ui/what-are-radix-primitives · https://eastondev.com/blog/en/posts/dev/20260330-shadcn-radix-accessibility/ · https://vercel.com/academy/shadcn-ui/core-concepts
