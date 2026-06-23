# TODOS — Concreta · Estructuras

Deuda técnica diferida con contexto. Cada item nace de una decisión explícita
(p. ej. una revisión de ingeniería) y dice por qué se aplazó y dónde retomar.

---

## T-mosaico-1 · Eliminar singletons de módulo del viewport antes de implementar mosaico

- **Qué:** El viewport tiene estado a nivel de módulo que asume UN solo `<Viewport>`:
  `snapCache` (memo del snapshot en [src/ui/viewport/hooks/useGeometriaModelo.ts](src/ui/viewport/hooks/useGeometriaModelo.ts) ~línea 159)
  y `oyentes` (bus de zoom en [src/ui/viewport/hooks/zoomBus.ts](src/ui/viewport/hooks/zoomBus.ts) línea 10).
- **Por qué:** El modo `mosaico` (definido en `vistaStore.ModoVista` y en el Spec UI §4.3)
  muestra varias vistas a la vez. Con el código actual: `snapCache` es una sola ranura
  global (todas las vistas comparten snapshot) y un clic de zoom `+` emitiría a TODAS las
  vistas en lugar de a la suya. También `snapCache` viola CLAUDE.md §9 ("Sin estado oculto
  en módulos"). En F1 (un viewport) es invisible.
- **Cómo retomar:** `snapCache` → `useRef` dentro de `useGeometriaModelo` (memo por
  instancia); `zoomBus` → contexto/ref por `<Viewport>` en vez de Set global. Si mosaico
  necesita grupo/planta por-vista, el snapshot debe parametrizarse por las entradas de esa
  vista, no leer los stores globales.
- **Depende de / bloquea:** implementación de mosaico (no fijada a una feature concreta;
  Spec §4.3). Hacerlo ANTES de mosaico, no después.
- **Coste:** CC ~20-25 min.
- **Origen:** Revisión de ingeniería F9 (Issue 1).

---

## T-vigas-1 · Instanciar las vigas (InstancedMesh) y unificar el resaltado por refs

- **Qué:** Las vigas no están instanciadas. [src/ui/viewport/GeometriaModelo.tsx](src/ui/viewport/GeometriaModelo.tsx)
  (~líneas 182-184, 218-235) crea un `<mesh>` + `cylinderGeometry` y DOS suscripciones a
  `seleccionStore` por cada viga.
- **Por qué:** En un edificio real (cientos de vigas) son N mallas + N geometrías + 2N
  suscripciones, y cada hover dispara las N suscripciones de `seleccion` (cada una corre
  `includes()`). Los pilares ya usan `InstancedMesh` (regla de rendimiento del spec); las
  vigas quedaron como excepción. El propio comentario del código lo reconoce ("si crece,
  migrar a instancing de cilindros").
- **Cómo retomar:** migrar vigas a `InstancedMesh` (cilindros o cajas finas) con un único
  mecanismo de resaltado por mutación de refs (como `useResaltadoSeleccion` para pilares),
  eliminando las 2N suscripciones. Diseñarlo junto al color-por-barra que necesita F14
  (deformada/esfuerzos).
- **Depende de / bloquea:** se aprovecha mejor al implementar F11/F12 (introducción real de
  vigas) o F14 (color por barra). Vigilar: si F11 introduce muchas vigas antes del refactor,
  habrá un bajón de rendimiento temporal.
- **Coste:** CC ~40 min.
- **Origen:** Revisión de ingeniería F9 (Issue 4).

---

## T-design-1 · Estado del motor visible (spec §6.3)

- **Qué:** El botón `Calcular obra` ([src/ui/shell/Brandbar.tsx](src/ui/shell/Brandbar.tsx)) está
  deshabilitado con un tooltip, pero no hay indicador del estado del motor.
- **Por qué:** El Spec Diseño UI §6.3 quiere un estado visible "● PyNite · Pyodide ready"
  (verde) + datos del worker. Sin él, el usuario no sabe cuándo el motor está listo y el
  botón parece muerto. Diseño para la confianza.
- **Cómo retomar:** al cablear el solver a la UI (feature del motor), añadir un indicador de
  estado del worker (cargando motor / listo / calculando) en la brandbar o un panel "Motor",
  y habilitar `Calcular obra` solo cuando esté listo. Reutiliza `solverClient`.
- **Depende de / bloquea:** integración del solver en la UI (no fijada a F9).
- **Coste:** CC ~25 min. **Origen:** Revisión de diseño F9 (Pass 7).

---

## T-design-2 · Hospedar las fuentes Geist (woff2)

- **Qué:** [src/styles/tokens.css](src/styles/tokens.css) declara `"Geist"`/`"Geist Mono"` al
  frente del stack pero sin `@font-face`; se usa el fallback de sistema.
- **Por qué:** La "firma de ingeniería" del Spec (datos numéricos en mono tabular) se renderiza
  en una mono genérica hasta que aterricen los woff2. Fidelidad del sistema de diseño.
- **Cómo retomar:** vendorizar Geist Sans + Geist Mono woff2 en `public/fonts/` y añadir las
  reglas `@font-face` con `font-display: swap`. No hay que tocar el stack (ya prioriza Geist).
- **Depende de / bloquea:** nada. **Coste:** CC ~15 min. **Origen:** Revisión de diseño F9 (Pass 5).

---

## T-dialogo-1 · Unificar CampoTexto/CampoNumero (DRY)

- **Qué:** En [src/ui/dialogos/DialogoGruposYPlantas.tsx](src/ui/dialogos/DialogoGruposYPlantas.tsx)
  los subcomponentes `CampoTexto` y `CampoNumero` son casi gemelos: ambos mantienen estado local,
  se resincronizan con `useEffect([valor])` y commitean en `onBlur`. Difieren solo en el parseo
  (`Number`/NaN) y dos props (`sufijo`, `className`).
- **Por qué:** Duplicación real (CLAUDE.md §9 / preferencia del usuario: DRY agresivo). Cualquier
  ajuste al patrón controlado-local + commit hay que hacerlo en dos sitios.
- **Cómo retomar:** un único `CampoEditable<T>` parametrizado por una función `parse(string): T`
  (identidad para texto, `"" → NaN` / `Number` para número) y `format(T): string`. El commit del
  número vacío→NaN ya vive ahí; conservarlo.
- **Depende de / bloquea:** nada. Se reutilizará en F11/12 (inspectores de pilar/viga).
- **Coste:** CC ~20 min. **Origen:** Revisión de ingeniería F10 (DRY, diferido en D4).

---

## T-dialogo-2 · Helper de orden "plantas por cota descendente"

- **Qué:** El orden de plantas por cota descendente (orden CYPECAD) está duplicado en
  [src/ui/shell/Sidebar.tsx](src/ui/shell/Sidebar.tsx) (~línea 71) y
  [src/ui/dialogos/DialogoGruposYPlantas.tsx](src/ui/dialogos/DialogoGruposYPlantas.tsx) (~línea 281):
  `plantas.filter(p => p.grupoId === g).sort((a,b) => b.cota - a.cota)`.
- **Por qué:** DRY. Si el criterio de orden cambia (p. ej. desempate por nombre) hay que tocar dos
  sitios; F11/12/14 mostrarán plantas y repetirán el patrón.
- **Cómo retomar:** añadir `plantasDeGrupoOrdenadas(modelo, grupoId): Planta[]` en
  [src/dominio/helpers.ts](src/dominio/helpers.ts) (junto a `plantasDeGrupo`) y consumirlo en ambos.
- **Depende de / bloquea:** nada. **Coste:** CC ~10 min. **Origen:** Revisión de ingeniería F10 (DRY, diferido en D4).

---

## T-vigas-2 · Memoizar los candidatos del imán en ColocacionViga.onMove

- **Qué:** [src/ui/viewport/ColocacionViga.tsx](src/ui/viewport/ColocacionViga.tsx) (`onMove`,
  ~línea 204) llama `getModelo()` y `resolverPunto()` en CADA `pointermove`; `resolverPunto`
  ([src/ui/viewport/imanViga.ts](src/ui/viewport/imanViga.ts)) reconstruye la lista de candidatos
  de enganche (nudos de la planta + cabezas de pilar) — O(nudos+pilares) por frame de ratón.
- **Por qué:** A escala F1 (pocos elementos) es invisible. En un modelo real con cientos de
  nudos/pilares, mover el cursor durante la colocación de vigas hará O(n) por evento y el imán
  puede ir a tirones. Mismo espíritu que `useGeometriaModelo` (memoiza la geometría y recomputa
  solo al cambiar el modelo/grupo/planta), aquí no aplicado.
- **Cómo retomar:** memoizar los candidatos por `plantaId` (p. ej. `useMemo`/ref) y recomputar
  solo cuando cambie el modelo o la planta colocable, en vez de en cada `onMove`. `resolverPunto`
  pasaría a recibir los candidatos ya construidos.
- **Depende de / bloquea:** nada. Se aprovecha junto a T-vigas-1 (instancing) si se tocan a la vez.
- **Coste:** CC ~20 min. **Origen:** Revisión de ingeniería F12 (Performance, #2; P3).

---

## T-dialogo-3 · SelectUso sin etiqueta visible

- **Qué:** [src/ui/primitivas/SelectUso.tsx](src/ui/primitivas/SelectUso.tsx) usa `etiqueta` solo
  como `aria-label`; no renderiza una etiqueta visible como sí hace `Campo`. En el diálogo, la
  "Categoría de uso" depende del texto de la opción seleccionada para explicarse.
- **Por qué:** Inconsistencia visual con `Campo` (todos los demás campos llevan label visible).
  Menor, pero afecta a la coherencia del formulario.
- **Cómo retomar:** envolver `SelectUso` con la misma estructura `.cx-campo__label` que `Campo`
  (o un wrapper común) y mostrar `etiqueta` encima del trigger.
- **Depende de / bloquea:** nada. **Coste:** CC ~10 min. **Origen:** Revisión de ingeniería F10 (outside voice Codex, LOW).
