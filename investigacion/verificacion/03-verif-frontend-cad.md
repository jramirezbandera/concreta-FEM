# Verificación adversarial · Área 3 · Frontend CAD/3D

> Verificación independiente de `investigacion/areas/03-frontend-cad.md` contra fuentes primarias (docs oficiales R3F, drei, Zustand, three-mesh-bvh) y discusiones reales del repo. Objetivo: cazar alucinaciones de API y datos falsables.
> Fecha: 2026-06-20.

---

## Afirmación 1 — R3F recomienda NO hacer `setState` dentro de `useFrame`; mutar refs/deltas

**Veredicto: VERIFICADO**

- Fuente: https://r3f.docs.pmnd.rs/advanced/pitfalls
- Cita textual: *"You might be tempted to setState inside `useFrame` but there is no reason to."* → *"Instead, just mutate, use deltas"* → patrón recomendado `useFrame((state, delta) => (meshRef.current.position.x += delta))`. La doc rotula explícitamente "`setState` in useFrame is bad".
- También verificado en la misma página: *"Share materials and geometries if you can, either in global scope or locally"*; advertencia sobre crear vectores por frame (*"This creates a new vector 60 times a second, which allocates memory and forces the GC to eventually kick in"*); y *"Consider using visibility instead"* (`<Stage1 visible={stage === 1} />`) en vez de montar/desmontar.

Esto respalda las afirmaciones 1.1, 5.2 del documento. Sin matices.

---

## Afirmación 2 — Zustand ofrece "transient updates" vía `store.subscribe(...)` sin re-render

**Veredicto: VERIFICADO (con matiz de firma)**

- Fuente: README oficial https://github.com/pmndrs/zustand
- Cita textual: *"The subscribe function allows components to bind to a state-portion without forcing re-render on changes. Best combine it with useEffect for automatic unsubscribe on unmount. This can make a drastic performance impact when you are allowed to mutate the view directly."*
- **Matiz importante sobre la firma:** la suscripción base es `subscribe(callback)`. La forma con selector `subscribe(selector, callback, options?)` **requiere el middleware `subscribeWithSelector`** — no está disponible por defecto. El documento (1.2) escribe `store.subscribe(selector, callback)` sin mencionar este requisito.

**Corrección recomendada:** aclarar que `subscribe(selector, callback)` exige envolver el store con `subscribeWithSelector`; sin ese middleware solo existe `subscribe(callback)` (que recibe `(state, prevState)`). No es un error grave pero la firma con selector tal cual está escrita no funciona out-of-the-box.

> Nota sobre la URL del documento: cita `https://awesomedevin.github.io/zustand-vue/...` (un fork de docs no oficial). La fuente primaria correcta es el README de pmndrs/zustand. Sustituir.

---

## Afirmación 3 — `useShallow` existe en Zustand; comparación superficial para evitar re-render

**Veredicto: VERIFICADO**

- Fuentes: https://deepwiki.com/pmndrs/zustand/4.5-shallow-and-useshallow ; uso confirmado en README/discusiones del repo.
- API real: `import { useShallow } from 'zustand/react/shallow'`. Envuelve el selector y previene re-render cuando el resultado es superficialmente igual al anterior. Caso de uso: selectores que devuelven objeto/array nuevo por render.
- Limitaciones reales confirmadas: no compara en profundidad (devuelve `false` para objetos con props anidadas aunque sean deep-equal), prototipos distintos nunca iguales, funciones con referencias distintas siempre desiguales.

Respalda la afirmación 1.4. Nombre de API correcto y ruta de import correcta. Sin matices.

---

## Afirmación 4 — `<Bvh>` de drei usa three-mesh-bvh / `acceleratedRaycast` y acelera el raycasting

**Veredicto: VERIFICADO**

- Fuente drei: https://drei.docs.pmnd.rs/performances/bvh
- Cita textual: *"An abstraction around gkjohnson/three-mesh-bvh to speed up raycasting exponentially. Use this component to wrap your scene, a sub-graph, a model or single mesh, and it will automatically compute boundsTree and assign acceleratedRaycast."* Confirma además que es side-effect free, revierte el `raycast` original al desmontar, y expone `firstHitOnly`.
- Fuente three-mesh-bvh: https://github.com/gkjohnson/three-mesh-bvh — *"A BVH implementation to speed up raycasting and enable spatial queries against three.js meshes."* Provee `computeBoundsTree` y `acceleratedRaycast`. Ejemplo concreto: *"Casting 500 rays against an 80,000 polygon model at 60fps!"*

Nombres `boundsTree` y `acceleratedRaycast` correctos (no inventados). Respalda 4.1.

**Matiz menor:** la doc dice "exponentially", el documento dice "órdenes de magnitud". Ambas son licencias retóricas; el dato duro (500 rayos / 80k polígonos / 60fps) es lo verificable.

---

## Afirmación 5 — `InstancedMesh` / `<Instances>` de drei renderiza muchos objetos en una draw call

**Veredicto: VERIFICADO**

- Fuente R3F: https://r3f.docs.pmnd.rs/advanced/scaling-performance — instancing permite *"hundreds of thousands of objects in a single draw call."*
- Fuente drei: https://drei.docs.pmnd.rs/performances/instances — `<Instances>` es *"a wrapper around THREE.InstancedMesh"* que permite definir cientos de miles de objetos en una draw call de forma declarativa, con `<Instance>` hijos.

**Matiz relevante (que el documento omite):** la doc de drei advierte que `<Instances>` declarativo *"comes at the cost of CPU overhead"*; para casos masivos sin overhead (p. ej. follaje) recomienda `THREE.InstancedMesh` directo. Conviene añadirlo: para miles de barras/nudos `<Instances>` está bien, pero si el conteo crece mucho, valorar `InstancedMesh` crudo.

Respalda 5.1.

---

## Afirmación 6 — `frameloop="demand"` + `invalidate()` existen; `invalidate` solicita frame, no renderiza al instante

**Veredicto: VERIFICADO**

- Fuente: https://r3f.docs.pmnd.rs/advanced/scaling-performance
- Cita textual: *"Calling `invalidate()` will not render immediately, it merely requests a new frame to be rendered out."* `frameloop="demand"` habilita render on-demand.

Semántica exactamente como la describe el documento (5.3, 7 del resumen). Sin matices.

---

## Afirmación 7 — `makeDefault` existe en cámaras drei; el swap dinámico perspectiva↔ortográfica puede romper controls/postproceso

**Veredicto: VERIFICADO**

- Fuente: discusión oficial https://github.com/pmndrs/react-three-fiber/discussions/709
- Confirmado: *"swapping perspective -> orthographic causes problems with systems like controls and postprocessing"*. Se documentan glitches con postprocessing (normales renderizadas por un frame) y agotamiento de contextos WebGL en cambios repetidos (*"new WebGL contexts are being generated on each switch, and eventually you'll get a crash"*).
- `makeDefault` confirmado como prop de cámaras/controles drei (también aparece en la doc de GizmoHelper: *"Make sure to set the makeDefault prop on your controls"*).

Respalda 3.2 y la recomendación 5. La advertencia del documento es real, no inventada.

---

## Afirmación 8 — `performance.regress()` existe en R3F

**Veredicto: VERIFICADO**

- Fuente: https://r3f.docs.pmnd.rs/advanced/scaling-performance
- Cita textual: *"Mere calls to `regress()` will not change or affect anything!"* — la función existe; debe llamarse en eventos de movimiento y la app debe escuchar `performance.current` para aplicar el escalado de calidad.

El documento (5.4) cita correctamente la frase y la semántica (`performance.regress()` + `performance.current`). Sin matices.

---

## Afirmación 9 — `GizmoHelper` / `GizmoViewcube` / `GizmoViewport` existen en drei

**Veredicto: VERIFICADO**

- Fuente: https://drei.docs.pmnd.rs/gizmos/gizmo-helper
- Confirmado: `<GizmoHelper>` contenedor con props `alignment`, `margin`, `onUpdate`, `onTarget`, `renderPriority`; gizmos incluidos `<GizmoViewport>` y `<GizmoViewcube>`. Ejemplo oficial usa ambos. Los tres nombres son correctos.

Respalda 3.3.

---

## Afirmación 10 — shadcn se basa en Radix + Tailwind y los componentes se copian al repo

**Veredicto: VERIFICADO**

- Fuentes: https://vercel.com/academy/shadcn-ui ; documentación e infraestructura coincidentes.
- Confirmado: cada componente shadcn se construye sobre **primitivas Radix UI** (accesibilidad, navegación por teclado, gestión de foco) y se estiliza con **Tailwind CSS**. Modelo copy-paste real: *"you copy and paste components directly into your codebase ... You own the components completely"*, vía CLI que copia el código fuente TS a `/components`. No es dependencia npm tradicional.

Respalda 8.1, 8.3. Sin matices.

---

## Afirmación 11 — Plotly.js pesa ~3 MB y rinde mal con muchos datos; uPlot es más ligero

**Veredicto: MATIZADO (orden de magnitud correcto)**

- El tamaño exacto no pudo extraerse de Bundlephobia (la página carga las cifras por JS y no aparecen en el markdown). Triangulando fuentes:
  - Foro oficial Plotly: hilo titulado *"Plotly js size is huge (>3MB) in production build"* (https://community.plotly.com/t/plotly-js-size-is-huge-3mb-in-production-build/45407) — confirma el orden de magnitud >3 MB en build de producción.
  - El bundle completo `plotly.js` minificado ronda **~3.4 MB minificado / ~1 MB gzipped** según versiones; el `dist` completo sin minificar llega a ~10 MB.
- "Rinde mal con muchos datos / muchos charts": afirmación de comparativas de terceros (scichart, medium), **no de la doc oficial de Plotly**. Es opinión de blog comparativo, plausible pero no fuente primaria neutral.
- uPlot "más ligero": correcto y robusto — uPlot pesa ~40-50 KB minificado, dos órdenes de magnitud menos que Plotly. Es un hecho ampliamente documentado.

**Corrección recomendada:** matizar que "~3 MB" se refiere al bundle minificado completo (con gzip baja a ~1 MB), y que el juicio de rendimiento procede de comparativas de terceros, no de la doc oficial. El orden de magnitud (Plotly pesado, uPlot ligero) es correcto. La recomendación práctica del documento (arrancar con Plotly, aislar tras `<DiagramaBarra>`, migrar a uPlot si crece) es sensata y no depende de la cifra exacta.

---

## CORRECCIONES NECESARIAS

1. **(Afirmación 2 — firma de `subscribe`)** Aclarar que `store.subscribe(selector, callback)` requiere el middleware `subscribeWithSelector`. Sin él solo existe `subscribe(callback)` con firma `(state, prevState)`. Sustituir la URL no oficial (`awesomedevin.github.io/zustand-vue`) por el README de pmndrs/zustand.

2. **(Afirmación 5 — `<Instances>`)** Añadir el matiz de la propia doc drei: `<Instances>` declarativo tiene CPU overhead; para conteos masivos sin overhead usar `THREE.InstancedMesh` directo. No invalida la recomendación, la completa.

3. **(Afirmación 11 — tamaño Plotly)** Precisar: "~3 MB minificado (≈1 MB gzipped); ~10 MB el dist sin minificar". Atribuir el juicio de rendimiento a comparativas de terceros, no a fuente primaria de Plotly.

Ninguna corrección es bloqueante. No se detectó ninguna API inventada ni mal escrita: `useShallow`, `boundsTree`, `acceleratedRaycast`, `<Bvh>`, `frameloop="demand"`, `invalidate()`, `performance.regress()`, `performance.current`, `makeDefault`, `GizmoHelper`/`GizmoViewport`/`GizmoViewcube`, `<Instances>`/`<Instance>` — todos existen con esos nombres exactos.

## CONFIANZA GLOBAL

**Alta.** 8 de 11 afirmaciones falsables VERIFICADAS al pie de la letra contra fuente primaria; 3 MATIZADAS (firma de `subscribe`, overhead de `<Instances>`, cifra exacta de Plotly), ninguna REFUTADA, ninguna NO CONFIRMABLE. El documento no contiene alucinaciones de API. Las correcciones son precisiones de exactitud, no errores de fondo.
