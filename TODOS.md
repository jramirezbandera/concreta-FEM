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

## T-design-2 · Hospedar las fuentes Geist (woff2) — RESUELTO

- **Estado:** RESUELTO (revisión de diseño /design-review, feature-16). Geist y Geist Mono
  (fuentes VARIABLES, un woff2 por familia) vendorizadas en [src/styles/fonts/](src/styles/fonts/)
  (no `public/`: así Vite fingerprintea y rebasea la `url()` con el base `/concreta-FEM/`, que una
  ruta absoluta a public no respeta). `@font-face` con `font-display: swap` en
  [src/styles/fonts.css](src/styles/fonts.css), importado el primero en `index.css`. Licencia OFL
  incluida. Verificado en navegador: `document.fonts.check('14px Geist')` y `'Geist Mono'` = true;
  toda la UI y las cifras (mono tabular) renderizan ya con la tipografía de marca.
- **Origen:** Revisión de diseño F9 (Pass 5); cerrado en /design-review F16.

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

---

## T-deformada-flecha · Deformada con flecha del vano (no solo cuerda entre nudos) — RESUELTO

- **Estado:** RESUELTO. El glue (`_deformada_global` en [src/solver/pynite_glue.py](src/solver/pynite_glue.py))
  emite, por barra y combinación, el desplazamiento GLOBAL por estación (`deformada_global`, forma (3,n))
  vía `member.deflection('dx'/'dy'/'dz',x,combo)` transformado con la triada real de PyNite
  (`_ejes_locales_globales`/`T()`). El render dibuja una polilínea por barra:
  [deformadaGeometria.ts](src/ui/resultados/deformadaGeometria.ts) (polilínea, base por lerp de los nudos
  de la barra recta) y [deformadaBuffers.ts](src/ui/resultados/deformadaBuffers.ts) (expande a `2·(n-1)`
  vértices para `lineSegments`). Una viga que flecta se ve CURVADA. Golden (Capa B) asevera continuidad
  estación-extremo == `nodos[].disp` y flecha del vano biapoyada ≈ `5qL⁴/384EIz`. Guardian APTO, 731 tests.
- **Origen:** Revisión de ingeniería F14 (D4, outside voice Codex, HIGH). Resuelto en sesión posterior.

---

## T-glue-barra-degenerada · Guardar el glue ante barras de longitud cero

- **Qué:** `_ejes_locales_globales` ([src/solver/pynite_glue.py](src/solver/pynite_glue.py) ~225) y los
  consumidores que normalizan por `member.L()` (proyección de cargas, `_deformada_global`) NO comprueban
  L>0 antes de dividir. Una barra con nudos coincidentes (L=0) daría NaN/crash al serializar resultados.
- **Por qué:** El discretizador YA bloquea barras degeneradas (criterio `TOL_NODO`, feature-12), así que
  no ocurre en el flujo normal. Pero el glue acepta payloads Capa 2 crudos (p. ej. un proyecto importado
  o un test): un member coincidente reventaría el cálculo en vez de fallar limpio. Es defensa en
  profundidad, NO un bug del flujo actual. Pre-existente (no lo introdujo T-deformada-flecha).
- **Cómo retomar:** validar L>0 al construir/serializar (o en el schema Capa 2) y devolver un ErrorMotor
  legible ("dos nudos coinciden") en vez de NaN. **Coste:** CC ~20 min. **Depende de / bloquea:** nada.
- **Origen:** Revisión de ingeniería T-deformada-flecha (outside voice Codex, LOW; pre-existente).

---

## ~~T-discretizar-nudo-orden~~ · RESUELTO · localizarNodoDeNudo orden-dependiente y ambiguo entre plantas

- **Qué (era):** [src/discretizador/discretizar.ts](src/discretizador/discretizar.ts) (`localizarNodoDeNudo`)
  elegía la PRIMERA viga de `modelo.vigas` (orden de inserción, no `vigasOrdenadas`) que usa un
  nudo. Rompía el determinismo byte-a-byte (CLAUDE.md §7) en `node_loads` y `trazabilidad.nudoANodo`,
  y dejaba arbitraria la planta cuando un nudo se compartía entre plantas distintas.
- **Resuelto:** `localizarNodoDeNudo` itera ahora `vigasOrdenadas` (orden total por id) en lugar de
  `modelo.vigas` → resultado independiente del orden de entrada. **Desempate documentado** para el
  nudo compartido entre plantas: la PRIMERA viga por `id` (orden canónico del discretizador) fija la
  cota; no se bloquea ni se avisa (una carga sobre `ambito=nudoId` no porta planta en el dominio, así
  que es un input ambiguo; F1 prima determinismo + comportamiento estable y documentado). El caso
  común (nudo en una sola planta) se resuelve igual que antes. Golden añadidos en
  [tests/golden/discretizador.casos.test.ts](tests/golden/discretizador.casos.test.ts): determinismo
  bajo reordenado (deep-equal de Capa 2 + `nudoANodo`) y nudo compartido entre dos plantas.
- **Origen:** Revisión de ingeniería F14 (outside voice Codex, HIGH).

---

## T-reacciones-ejes · La tabla de reacciones expone el eje FEM (FY vertical) sobre escena Z-up

- **Qué:** [src/ui/resultados/TablaReacciones.tsx](src/ui/resultados/TablaReacciones.tsx) rotula FX/FY/FZ y ΣFY
  con FY=vertical (eje FEM Y-up), pero la escena del viewport es Z-up. Mezcla convención interna
  con presentación (CLAUDE.md §14 "convertir en los bordes" aplica también a ejes).
- **Por qué:** Coherencia de ejes y menos jerga de implementación visible al arquitecto.
- **Cómo retomar:** decidir nomenclatura de presentación (p. ej. H1/H2/V o "Horizontal/Vertical")
  y mapear las componentes de `rxn` a esa convención en el borde de la tabla.
- **Depende de / bloquea:** nada. **Coste:** CC ~20 min. **Origen:** Revisión de ingeniería F14 (outside voice Codex, MEDIUM).

---

## T-diagramas-plano · Diagramas solo Fy/Mz/dy con etiqueta genérica (asunción in-plane)

- **Qué:** `pynite_glue.py` (~446-448) serializa solo `Fy`/`Mz`/`dy`; [src/ui/resultados/PanelDiagramas.tsx](src/ui/resultados/PanelDiagramas.tsx)
  los rotula genéricos "V/M/Flecha". En 3D es una asunción de plano (2D) no declarada.
- **Por qué:** Para F1 (cargas gravitatorias planas) el plano dominante es el correcto, pero
  conviene declarar la limitación y prever la otra dirección (Fz/My/dz) en F2.
- **Cómo retomar:** documentar la asunción en el panel; cuando F2 añada cargas fuera de plano,
  emitir también la otra componente y dar selector de plano/eje.
- **Depende de / bloquea:** F2 (cargas no gravitatorias). **Coste:** CC ~30 min (cuando aplique).
- **Origen:** Revisión de ingeniería F14 (outside voice Codex, MEDIUM).

---

## T-diagramas-pilar-tramos · Diagrama de pilar muestra solo el tramo de pie (tramos[0])

- **Qué:** [src/ui/resultados/PanelDiagramas.tsx](src/ui/resultados/PanelDiagramas.tsx) (~111) muestra solo
  `pilarAMembers[id][0]` para un pilar pasante (varias plantas). No es "el diagrama del pilar",
  es solo su tramo inferior; hay una nota al usuario pero no resuelve el feature.
- **Por qué:** Un pilar de varias plantas tiene un esfuerzo por tramo; mostrar solo uno es parcial.
- **Cómo retomar:** concatenar los diagramas de todos los tramos del pilar a lo largo de su altura,
  o un selector de tramo. Usa `trazabilidad.pilarAMembers` (ya tiene todos los members).
- **Depende de / bloquea:** nada. **Coste:** CC ~30-40 min. **Origen:** Revisión de ingeniería F14 (outside voice Codex, MEDIUM).

---

## T-calcular-menu-sink · "Calcular obra" del menú no refleja estado/errores en el botón

- **Qué:** El menú (entradaVigas) dispara `calcularObra()` fire-and-forget sin sink
  ([src/ui/shell/Menubar.tsx](src/ui/shell/Menubar.tsx) ~65); `BotonCalcular` solo sondea estado
  cuando su propio estado ya es transitorio, así que un cálculo lanzado desde el menú puede no
  reflejarse (estado/errores de obra) hasta otro refresh.
- **Por qué:** El usuario podría no ver "Calculando…" ni los errores de obra de un cálculo de menú.
  (El guard de reentrada a nivel de módulo SÍ evita el doble cálculo, así que no es un bug de datos.)
- **Cómo retomar:** que el camino de menú comparta un sink/observador (p. ej. un store ligero de
  estado de cálculo) que el botón consuma, o que `usePrecargaMotor`/un store de cálculo dispare el
  sondeo al iniciarse cualquier cálculo. **Coste:** CC ~30 min.
- **Depende de / bloquea:** nada. **Origen:** Revisión de ingeniería F14 (outside voice Codex, MEDIUM).

---

## T-stale-labels · Resultados obsoletos (gris) resuelven etiquetas del modelo VIVO

- **Qué:** Tras editar la obra, `resultadosStore.limpiar()` conserva `modeloFEM`/`trazabilidad`
  viejos (para mostrar la deformada obsoleta en gris), pero `TablaReacciones` resuelve los nombres
  de pilar desde `modeloStore` ACTUAL. Si se renombró/movió un pilar, las reacciones viejas se
  muestran bajo nombres nuevos. (El race de marcar-vigente ya se cerró en D3; esto es solo el
  desajuste de etiquetas en el estado obsoleto explícito.)
- **Por qué:** Coherencia de los datos obsoletos en gris.
- **Cómo retomar:** resolver las etiquetas desde el `modeloFEM`/snapshot guardado con los resultados,
  no desde el modelo vivo; o no mostrar etiquetas resolubles cuando `!vigente`. **Coste:** CC ~20 min.
- **Depende de / bloquea:** nada. **Origen:** Revisión de ingeniería F14 (outside voice Codex, MEDIUM).

---

## T-trazabilidad-zod · Trazabilidad no se valida con Zod (a diferencia de ModeloFEM/Resultados)

- **Qué:** `Trazabilidad` ([src/discretizador/contratoFEM.ts](src/discretizador/contratoFEM.ts) ~139) es solo
  un `interface`; `ModeloFEM` y `ResultadosCalculo` sí se validan con Zod. Una traza rota degrada
  en silencio (diagramas/etiquetas vacíos o erróneos).
- **Por qué:** Salida derivada interna (riesgo bajo), pero un esquema daría red ante regresiones del
  discretizador.
- **Cómo retomar:** schema Zod para `Trazabilidad` y `safeParse` en el borde (o aserción en dev).
  **Coste:** CC ~15 min. **Depende de / bloquea:** nada.
- **Origen:** Revisión de ingeniería F14 (outside voice Codex, LOW).

---

## T-f16-ci · Integrar el E2E mock en CI (instalación de navegadores)

- **Qué:** Añadir a [.github/workflows/deploy.yml](.github/workflows/deploy.yml) un job que ejecute
  `npm test` (Vitest) + el E2E mock (`npm run e2e`), instalando Chromium con
  `npx playwright install --with-deps chromium`. El `e2e:real` (golden-real, lento/gateado)
  queda FUERA de CI por defecto.
- **Por qué:** En F16 se difirió CI por decisión explícita. Un suite E2E que solo corre en local
  se pudre: nadie lo ejecuta y deja de proteger (Codex #18, revisión de ingeniería F16). El E2E
  mock es barato (Chromium headless, pocos segundos) y cabe bien en el pipeline.
- **Cómo retomar:** job `test` en el workflow (Node 24, `npm ci`, instalar Chromium, `npm test`,
  `npm run e2e`); subir `playwright-report/` como artifact en fallo. Hoy `deploy.yml` solo hace
  build+deploy, sin tests.
- **Depende de / bloquea:** requiere F16 (el andamiaje Playwright) hecho. **Coste:** CC ~25 min.
- **Origen:** Revisión de ingeniería F16 (decisión CI diferida; Codex #18).

---

## T-f16-canvas-smoke · Humo E2E de canvas real (raycaster/picking)

- **Qué:** Un spec E2E que coloca un pilar con `page.mouse.click` sobre el canvas R3F en planta
  (mapeando mundo→pantalla con la cámara ortográfica) y asevera que aparece en el árbol de obra,
  ejercitando el raycaster y el picking reales.
- **Por qué:** En F16 (D10) se eligió **costura pura** (`window.__concreta` despacha comandos),
  que NO pasa por el ratón-sobre-el-lienzo: la colocación/picking/inspector-al-seleccionar quedan
  sin cobertura E2E. Esa UX sí tiene component tests ([flujoEntradaPilares.test.tsx](src/ui/entradaPilares/flujoEntradaPilares.test.tsx),
  [ColocacionViga.test.ts](src/ui/viewport/ColocacionViga.test.ts)), pero no a nivel E2E.
- **Cómo retomar:** un único spec con helper `mundoAPantalla(x,y, camara)` y `page.mouse.click`;
  vigilar la fragilidad ante zoom/tamaño de viewport (fijar tamaño de viewport y cámara conocida).
- **Depende de / bloquea:** requiere F16. **Coste:** CC ~30 min.
- **Origen:** Revisión de ingeniería F16 (outside voice Codex #1+#2, D10).
