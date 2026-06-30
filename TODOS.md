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

## T-vigas-1 · Instanciar las vigas (InstancedMesh) y unificar el resaltado por refs — RESUELTO (F2c)

- **Estado:** RESUELTO en F2c (3D pleno lo disparaba: pinta todas las vigas de todas las
  plantas a la vez). En [GeometriaModelo.tsx](src/ui/viewport/GeometriaModelo.tsx) las vigas
  ya NO son N `<mesh>` + 2N suscripciones: el picking es UN `InstancedMesh` de cilindros
  (`VigasPicking`) y el resaltado hover/seleccion se hace MUTANDO el atributo de color
  por-vertice de la linea visible (`lineSegments`) con UNA sola pareja de suscripciones a
  `seleccionStore` para todas las vigas. La linea visible (ya unica) se conserva. Coste O(1)
  en mallas/suscripciones, igual que los pilares.
- **Origen:** Revisión de ingeniería F9 (Issue 4); cerrado en F2c (outside-voice #10 reorientó
  el refactor al camino de picking/halo, no a la representacion visible).

<details><summary>Contexto histórico (pre-resolución)</summary>

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

</details>

---

## T-design-1 · Estado del motor visible (spec §6.3) — RESUELTO (feature-17)

- **Estado:** RESUELTO en feature-17. La [Brandbar](src/ui/shell/Brandbar.tsx) muestra un
  indicador "● motor listo / preparando / calculando / con error" (lenguaje de obra) leído del
  nuevo `calculoStore`, y el botón "▶ Calcular obra" se **habilita** solo cuando el motor está
  listo (o en error, para reintentar) y no hay cálculo en curso; cableado a `calcularObra()`.
- **Origen:** Revisión de diseño F9 (Pass 7); cerrado en feature-17.

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

## T-calcular-menu-sink · "Calcular obra" del menú no refleja estado/errores — RESUELTO (feature-17)

- **Estado:** RESUELTO en feature-17. Se creó `src/estado/calculoStore.ts` (Zustand, fuera de
  undo) y `calcularObra()` escribe SIEMPRE en él por un sink por defecto, así que el cálculo
  lanzado desde el menú ([Menubar.tsx](src/ui/shell/Menubar.tsx)) refleja estado/errores en
  todos los consumidores del store (botón del panel y brandbar). El menú deshabilita su item
  según `estadoMotor`. El guard de reentrada `calculoEnVuelo` se conserva.
- **Origen:** Revisión de ingeniería F14 (outside voice Codex, MEDIUM); cerrado en feature-17.

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

---

## T-hud-layout · Sistema de slots del HUD: los paneles flotantes se solapan — RESUELTO (feature-17)

- **Estado:** RESUELTO en feature-17. El HUD pasó a una capa `.cx-hud` con **8 zonas**
  (`.cx-zone--*`, flex-column) y un componente [Slot.tsx](src/ui/viewport/Slot.tsx)
  (`createPortal` al contenedor de zona); [Viewport.tsx](src/ui/viewport/Viewport.tsx) monta las
  zonas + provee el contexto, y [Hud.tsx](src/ui/viewport/Hud.tsx) + [App.tsx](src/App.tsx)
  envuelven cada panel en `<Slot zona>`. Paneles de orígenes distintos (HUD persistente + overlays)
  se **apilan en columna** en la misma zona; BotonCalcular se movió a `top-center` (fin del solape
  con el GroupRibbon). Se eliminó el parche `resultadosLayout.css`, las anclas absolutas co-locadas
  de cada panel y las clases `.cx-float--top-left/top-right/bottom-right`. Los specs E2E vuelven a
  `.click()` (se quitó el `dispatchEvent`). Gotcha resuelto: bucle de render en `CapaHud` por
  callback-ref inline → refs estables con `useMemo([])`.
- **Origen:** Revisión de diseño /design-review F16 (hallazgo nº1, crítico); cerrado en feature-17.

<details><summary>Contexto histórico (pre-resolución)</summary>

- **Qué:** Los paneles flotantes del viewport colisionan en las esquinas. El HUD
  siempre-presente ([Hud.tsx](src/ui/viewport/Hud.tsx)) pinta GroupRibbon (arriba-izq),
  SelectorModo (arriba-der) y ControlesZoom (abajo-der); y los `hudOverlays` que inyecta
  [App.tsx](src/App.tsx) (InspectorPilar/Viga + PanelPlantillas arriba-der; PanelHerramienta
  arriba-izq; BotonCalcular arriba-izq; ComboSelector arriba-der; docks de Resultados abajo)
  se anclan TODOS a la MISMA esquina con `position:absolute; top/left:12px`
  ([viewport.css](src/ui/viewport/viewport.css) `.cx-float--*`), sin reserva de espacio. Son
  hermanos planos dentro de `.cx-viewport`, solo apilados por orden DOM (z-index del HUD 2).
- **Síntomas (verificados en /design-review F16):** GroupRibbon tapa el título del diálogo
  (ya mitigado: el modal sube a `--z-dialog`) y la cabecera del panel de herramienta; el
  SelectorModo tapa el inspector y el ComboSelector ("Combina[ción]" recortado); el zoom tapa
  el dock de esfuerzos; y el ↓/↑ del GroupRibbon **intercepta el clic del botón Calcular** (por
  eso los specs E2E usan `dispatchEvent` en vez de `.click()`).
- **Por qué no se arregló en /design-review:** es estructural (cambia el contrato de
  `hudOverlays` de Viewport, la composición Hud/Viewport, ~8 CSS de panel y borra el parche
  [resultadosLayout.css](src/ui/resultados/resultadosLayout.css)), y exige re-verificar el E2E.
  Hacerlo a vuelapluma arriesgaba el trabajo verificado de F16.
- **Cómo retomar (diseño propuesto, outside-voice):** convertir el HUD en una rejilla con
  slots por zona (8 zonas canónicas §4.2). Los paneles declaran su zona (`grid-area`) en vez
  de `top/left:12px`; varios paneles en la misma zona **se apilan en columna** (flex + gap) en
  vez de solaparse. Eliminar `resultadosLayout.css` y su hack de orden de import. Definir una
  escala de z-index (ya añadida: `--z-canvas/hud/float/dialog`). Tras el refactor, **quitar los
  `dispatchEvent` de los specs E2E** (volver a `.click()`) y re-correr `npm run e2e` + `npm test`.
- **Depende de / bloquea:** nada técnico, pero conviene hacerlo en su propia tarea con
  experto-frontend-cad + re-verificación E2E. **Coste:** CC ~60-90 min.
- **Origen:** Revisión de diseño /design-review F16 (hallazgo nº1, crítico; outside voice
  Claude subagent confirmó la causa raíz).

</details>

---

## T-estado-motor-helpers · DRY de los helpers de estado del motor

- **Qué:** La lógica etiqueta/habilitación/tag por `EstadoMotor` está triplicada:
  `etiquetaBoton`/`botonHabilitado`/`tagEstadoMotor` en [BotonCalcular.tsx](src/ui/resultados/BotonCalcular.tsx),
  y réplicas en [Brandbar.tsx](src/ui/shell/Brandbar.tsx) (`rotuloMotor`/`tonoMotor`/
  `botonCalculoHabilitado`) y en el criterio de habilitación de [Menubar.tsx](src/ui/shell/Menubar.tsx).
- **Por qué:** Duplicación consciente introducida en feature-17 (aislamiento de tareas paralelas:
  los consumidores no podían tocar `/src/ui/resultados`). Tres copias del mismo criterio
  "listo|error y no calculando" pueden divergir al evolucionar.
- **Cómo retomar:** extraer los helpers a un módulo compartido (p. ej.
  `src/ui/resultados/estadoMotorUI.ts`) y consumirlo desde BotonCalcular, Brandbar y Menubar.
- **Depende de / bloquea:** nada. **Coste:** CC ~15-20 min.
- **Origen:** Auditoría de arquitectura feature-17 (guardián, MENOR).

---

## T-cr-fem-exacto · Centro de rigidez vía solver (FEM-exacto), no analítico

- **Qué:** Calcular el centro de rigidez (CR) por planta usando PyNite, no a mano. Aplicar un
  cortante unitario por planta (con hipótesis de diafragma rígido) y derivar el CR de los
  desplazamientos resultantes. F2a entrega el centro de MASAS; el CR quedó fuera.
- **Por qué:** En la revisión de F2 se descartó el CR analítico `12EI/h³`: ignora vigas, releases,
  torsión, flexibilidad de bases y el acoplamiento entre plantas, y monta un **segundo solver
  simplificado** que choca con la regla de oro #1 (PyNite es la única fuente del cálculo). Un CR
  con pinta de fiable pero engañoso induce decisiones de torsión erróneas en el arquitecto.
- **Cómo retomar:** tras F2a (el módulo `src/discretizador/centros.ts` ya da el CM). Definir la
  hipótesis de diafragma rígido por planta; añadir corridas FEM auxiliares en el glue (cortante
  unitario por dirección/planta) y leer los desplazamientos para localizar el CR; extender el
  contrato de centros/resultados. Golden con un caso de simetría conocida (CR≡CM en planta simétrica).
- **Depende de / bloquea:** requiere F2a (CM) hecho. Comparte la hipótesis de masa/diafragma con el
  modal (F2b) y con un futuro sísmico.
- **Coste:** CC ~varias horas (corridas FEM auxiliares + contrato + golden).
- **Origen:** Revisión de ingeniería F2 (Tensión-3, outside voice Codex; revierte la decisión D1 de
  hacer el CR analítico). Plan: `vamos-a-planificar-la-effervescent-newt.md`.

---

## T-pdelta-subdivision · Subdividir barras para el P-δ (curvatura), no solo P-Δ de balanceo

- **Qué:** Subdividir cada pilar/viga en N elementos de cálculo para captar el efecto **P-δ**
  (curvatura de la propia barra), no solo el **P-Δ** de balanceo (nivel nudo) que entrega F2a.
- **Por qué:** F2a habilita `analyze_PDelta` sobre el mallado actual (un elemento de pilar por
  planta): capta el desplazamiento lateral de planta (P-Δ) pero **no** la amplificación por curvatura
  del elemento (P-δ). La guía de PyNite recomienda subdividir barras para el P-δ local; sin
  subdivisión el efecto de segundo orden es parcial.
- **Cómo retomar:** añadir subdivisión por longitud en el discretizador (nudos/members intermedios).
  **Cuidado:** toca el núcleo del discretizador, la `trazabilidad` (`pilarAMembers` ya contempla
  varios members) y la concatenación de diagramas por barra. Decidir el criterio de subdivisión
  (nº fijo de tramos vs por esbeltez). Se aprovecha junto a T-diagramas-pilar-tramos.
- **Depende de / bloquea:** requiere F2a (P-Δ de balanceo) hecho.
- **Coste:** CC ~varias horas.
- **Origen:** Revisión de ingeniería F2 (Tensión-5, outside voice Codex #8). Plan:
  `vamos-a-planificar-la-effervescent-newt.md`.

---

## T-3dpleno-ux · Semántica de selección/edición cross-planta en 3D pleno — RESUELTO (F2c)

- **Estado:** RESUELTO en F2c con la opción (a) **sincronizar contexto**: al pickear un elemento
  en 3D (clic simple, sin shift) se fija `grupoActivoId`/`plantaActivaId` a los suyos vía el helper
  puro [resolverContextoElemento.ts](src/ui/viewport/hooks/resolverContextoElemento.ts) (pilar → planta
  del PIE) y se cambia a la pestaña del tipo (pilar→`entradaPilares`, viga→`entradaVigas`) para montar
  el inspector correcto; la geometría 3D no se oculta. shift-multiselección NO mueve contexto ni pestaña.
  Sidebar/inspector/GroupRibbon/plantillas quedan coherentes reusando el acoplamiento existente. La
  colocación gráfica se inhabilita en 3D (SelectorModo fuerza "seleccion"; App no monta paneles/DXF).
  Tests de componente en [GeometriaModelo.test.tsx](src/ui/viewport/GeometriaModelo.test.tsx).
- **Deuda derivada:** la planta del pilar PASANTE se resuelve por el pie (no por la altura del clic) →
  ver [T-3dpleno-pick-altura]; "Ver modelo de cálculo" sólo en 3D → ver [T-modelo-calculo-planta].
- **Origen:** Revisión de ingeniería F2 (outside voice Codex #15/#16); cerrado en F2c.

---

## T-cm-cargas-muertas · Incluir cargas muertas de grupo en el centro de masas (requiere paños)

- **Qué:** Extender `src/discretizador/centros.ts` para incluir `Grupo.cargasMuertas` (kN/m²) en el
  cálculo del centro de masas, una vez que los paños (F3) aporten el **área tributaria** por elemento.
- **Por qué:** F2a omite deliberadamente las cargas muertas de grupo en el CM: son kN/m² y no hay
  superficie de forjado a la que aplicarlas hasta que existan paños. El CM de F2a usa solo lo
  computable (peso propio `A·ρ·L` + cargas lineales sobre vigas + cargas nodales). Cuando lleguen los
  paños, el CM debe completarse para reflejar la masa permanente real.
- **Cómo retomar:** tras F3 (paños). Definir el área tributaria por elemento y sumar
  `cargasMuertas·área` a los términos del CM; retirar la nota de omisión del panel; golden que compare
  CM con/sin cargas muertas en una planta con paño conocido.
- **Depende de / bloquea:** requiere F3 (paños / área de forjado). La omisión está documentada en E5 del
  plan F2a.
- **Coste:** CC ~30-45 min (cálculo + golden), una vez exista el área.
- **Origen:** Revisión de ingeniería F2a (outside voice Codex). Plan: `vamos-a-empezar-a-hidden-quokka.md`.

---

## T-pdelta-imperfeccion · Imperfección nocional / carga lateral para que el P-Δ tenga efecto

- **Qué:** Generar una **imperfección nocional** (fuerza horizontal equivalente / desplome inicial,
  estilo normativo) para que el análisis P-Δ produzca efectos de segundo orden reales en pórticos
  solo-gravedad y simétricos.
- **Por qué:** F2a entrega el *pipeline* P-Δ (`analyze_PDelta` expuesto), pero sin carga lateral ni
  imperfección el P-Δ es prácticamente **inerte** (no hay sway que amplificar). Los códigos exigen P-Δ
  con imperfecciones nocionales: ése es el trabajo que convierte el pipeline en una función útil.
- **Cómo retomar:** junto a la fase de **viento/sísmico** (donde también aparecen los casos de carga
  lateral). Decidir magnitud/dirección por código (p. ej. desplome H/n o fuerza nocional), aplicarla
  como caso de carga, y un golden que demuestre amplificación frente al análisis lineal.
- **Depende de / bloquea:** requiere casos de carga lateral (fase viento/sísmico). El alcance "solo
  pipeline, inerte hasta carga lateral" está documentado en la nota CV2 del plan F2a.
- **Coste:** CC ~varias horas (reglas normativas + casos de carga + golden).
- **Origen:** Revisión de ingeniería F2a (outside voice Codex). Plan: `vamos-a-empezar-a-hidden-quokka.md`.

---

## T-cm-pilar-pasante · CM: repartir la masa de pilares pasantes a las plantas intermedias

- **Qué:** En `src/discretizador/centros.ts`, el peso de un pilar se reparte **medio a `plantaInicial` y
  medio a `plantaFinal`**. Un pilar pasante que atraviesa una planta **intermedia** no aporta masa a esa
  planta intermedia, aunque físicamente la atraviesa (y el discretizador sí le pone un tramo allí).
- **Por qué:** En edificios con plantas técnicas/entreplantas el CM de la planta intermedia
  **subestima** la masa de pilares. Es comportamiento *especificado* en el plan F2a ("medio pilar a cada
  forjado que conecta"), no un bug, pero el reparto a forjados intermedios sería más fiel.
- **Cómo retomar:** decidir el criterio (¿el pilar "conecta" también los forjados intermedios que
  atraviesa? reparto por tramos del troceo del discretizador, `cotasDePilar`). Actualizar el comentario
  de `centros.ts:96-104` (hoy describe solo pilares de un tramo) y añadir golden de pilar pasante.
- **Depende de / bloquea:** nada. **Coste:** CC ~30-45 min.
- **Origen:** Auditoría guardián F2a (M1, MENOR). Plan: `vamos-a-empezar-a-hidden-quokka.md`.

---

## T-dedup-planta-de-nudo · Factorizar la regla "primera viga por id" (CM ↔ discretizador)

- **Qué:** La regla de desempate "la primera viga por orden de id fija la planta/cota de un nudo" está
  **duplicada**: `plantaDeNudo` en `centros.ts` y `localizarNodoDeNudo` en `discretizar.ts`. Hoy
  coinciden (ambas ordenan por id), pero son dos implementaciones independientes.
- **Por qué:** Si se toca una y no la otra, el CM atribuiría una carga nodal a una planta distinta de la
  que el solver asigna a su nodo, **en silencio**. Deuda de DRY entre módulos (regla de oro: DRY).
- **Cómo retomar:** extraer el desempate a un helper puro compartido (junto al A-dry en
  `propiedadesBarra.ts` o en `geometria.ts`) y consumirlo desde ambos; o, como mínimo, un golden que
  compare ambas atribuciones para detectar deriva.
- **Depende de / bloquea:** nada. **Coste:** CC ~20-30 min.
- **Origen:** Auditoría guardián F2a (M2, MENOR). Plan: `vamos-a-empezar-a-hidden-quokka.md`.

---

## T-cm-overlay-recompute · El overlay del CM recalcula oculto y por duplicado

- **Qué:** `CentroMasaOverlay` llama a `useCentroMasa()` (cálculo) ANTES de la guarda de
  visibilidad (`if (!visible) return null`), y el panel también lo llama, así que
  `calcularCentroMasaPlanta` se ejecuta (a) aun con el toggle APAGADO y (b) DOS veces cuando
  está encendido (un `useMemo` por instancia, no compartido).
- **Por qué:** el overlay está montado en las tres pestañas y se suscribe a `s.modelo`, así que
  cada edición de obra (colocar/mover pilar = camino caliente) recalcula el CM de un marcador
  oculto; con el panel abierto, el doble. La cabecera del hook afirma "no recomputar dos veces":
  hoy es falso. (Regla #11 de rendimiento del lienzo.)
- **Cómo retomar:** NO se puede `return null` antes de llamar al hook (reglas de hooks). Pasar
  `visible` al hook y cortocircuitar el cálculo dentro del `useMemo` cuando no es visible; y
  compartir UN solo resultado entre overlay y panel (p. ej. memoizar a nivel de módulo sobre
  `(modelo, plantaActivaId)` o exponer un único snapshot). Acotar también la suscripción para no
  recomputar ante ediciones de otra planta.
- **Depende de / bloquea:** nada. **Coste:** CC ~30-45 min.
- **Origen:** Code-review F2a (high) #4. Plan: `vamos-a-empezar-a-hidden-quokka.md`.

---

## T-pdelta-deteccion-inestable · Clasificar la inestabilidad P-Δ sin depender del texto de PyNite

- **Qué:** El glue (`pynite_glue.py`, `_MARCADORES_INESTABLE`) detecta la inestabilidad P-Δ por
  coincidencia de subcadenas en los mensajes de excepción de PyNite en inglés
  (singular/unstable/diverged), que usa `ValueError`/`Exception` genéricos.
- **Por qué:** CLAUDE.md §8 obliga a pinear PyNite y avisa de que cambia entre versiones. Una
  actualización que reformule (o localice) los mensajes rompe el clasificador en silencio: una
  estructura realmente inestable cae al catch-all y muestra un traceback crudo en vez del mensaje
  de obra ("La estructura es inestable bajo P-Δ…") — justo lo opaco que este código evitaba.
- **Cómo retomar:** detección más robusta que el string: inspeccionar el estado/flag de
  estabilidad del propio solver, o acotar el catch al punto de llamada concreto, o pinear un
  contrato verificado por versión. Cubrir con un golden de inestabilidad que falle si el mensaje
  deja de mapearse.
- **Depende de / bloquea:** nada. **Coste:** CC ~30-60 min (requiere motor real para verificar).
- **Origen:** Code-review F2a (high) #5. Plan: `vamos-a-empezar-a-hidden-quokka.md`.

---

## T-migracion-id-usurpadora · Reasignación de id "usurpadora" sin chequeo de colisión ni re-apuntar cargas

- **Qué:** En la migración v1→v2, la rama "usurpadora" (un import trae `id=hip-peso-propio` con
  datos NO automáticos) reasigna a un id FIJO `hip-peso-propio-usuario` sin comprobar que esté
  libre, y NO re-apunta las cargas que referenciaban el id antiguo. Zod valida unicidad de
  NOMBRES, no de ids.
- **Por qué:** un .json importado a mano/heredado con ese id (o con `hip-peso-propio-usuario` ya
  ocupado) produce ids duplicados (una hipótesis sombrea a otra y su carga desaparece) o cargas
  huérfanas → rotura aguas abajo. Raro en v1 real (ids opacos/UUID) pero es el **borde de import**
  ("importar nunca debe romper la app", §2.8).
- **Cómo retomar:** reutilizar la misma búsqueda de hueco libre que ya hace el nombre
  (`elegirNombrePesoPropio`) para elegir un id no ocupado, y re-apuntar `modelo.cargas[].hipotesisId`
  del id viejo al reasignado. Tests del borde con ambos ids ocupados y con cargas colgando.
- **Depende de / bloquea:** nada. **Coste:** CC ~30 min.
- **Origen:** Code-review F2a (high) #6. Plan: `vamos-a-empezar-a-hidden-quokka.md`.

---

## T-opciones-comprobar-previo · "Comprobar estática" pierde el valor previo al salir de P-Δ

- **Qué:** En `DialogoOpcionesAnalisis`, `comprobarPrevio` (useRef) captura `comprobarEstatica`
  una sola vez al montar. Si el diálogo se abre con el análisis YA en P-Δ (donde
  `comprobarEstatica` está forzado a false), el ref captura false; al volver a lineal/general se
  "restaura" false, perdiendo un true previo.
- **Por qué:** UX/correctness: abrir un proyecto en P-Δ y cambiar a Lineal deja "Comprobar
  estática" apagada aunque estuviera encendida antes. El estado de restauración vive solo mientras
  el diálogo está montado.
- **Cómo retomar:** arreglo de fondo (elimina el ref frágil): que el MODELO conserve
  `comprobarEstatica` intacto siempre y que el discretizador/glue lo IGNOREN bajo P-Δ (el glue ya
  lo fuerza a false, E6). Así la restauración es automática y no depende del ciclo de vida del
  diálogo; la UI solo deshabilita+explica el checkbox bajo P-Δ sin tocar el valor del modelo.
- **Depende de / bloquea:** nada. **Coste:** CC ~20-30 min.
- **Origen:** Code-review F2a (high) #8. Plan: `vamos-a-empezar-a-hidden-quokka.md`.

---

## T-modal-nummodos-persist · Persistir el nº de modos (y dirección de masa) en el modelo

- **Qué:** En F2b el nº de modos (`numModos`) es un parámetro **transitorio**: vive en `vistaStore`
  (UI, fuera de undo, default 6) y se pasa a `discretizar(modelo,{modal:{numModos}})`; no se persiste.
  Al recargar el proyecto vuelve al default. Promoverlo a `OpcionesAnalisis` (Capa 1, persistido) si
  el usuario quiere que las opciones modales sobrevivan al reload.
- **Por qué:** decisión de alcance de F2b (modal mínimo): se evitó el bump de schema + migración
  tratando `numModos` como `nPoints` de los diagramas (transitorio). Es deliberado, no un bug.
- **Cómo retomar:** añadir `numModos` (y, si se decide exponerla, una preferencia de dirección de masa)
  a `OpcionesAnalisisSchema` con bump de `SCHEMA_VERSION` + `MIGRACIONES` (default 6 a proyectos viejos);
  `discretizar` leería de `modelo.analisis` en vez de `opts`; la UI escribiría por comando reversible.
- **Depende de / bloquea:** nada. **Coste:** CC ~30-45 min (schema + migración + comando + tests).
- **Origen:** Decisión de alcance F2b (modal transitorio por mínimo). Plan: `vamos-a-hacer-f2b-lazy-blossom.md`.

---

## T-modal-masa-participante · Masa participante / % de masa movilizada por modo

- **Qué:** El modal de F2b entrega frecuencias + formas modales, **sin** la masa participante (% de
  masa movilizada por cada modo). Añadirla como paso hacia la combinación sísmica (NCSE-02).
- **Por qué:** se acotó F2b a "modal mínimo" (frecuencias + animación). La participación de masa es un
  concepto aparte (factores de participación, masa efectiva acumulada) que no se quiso mezclar al
  contrato `ResultadosModales` ni a la UI mínima.
- **Cómo retomar:** junto a la fase sísmica. Calcular en el glue los factores de participación (PyNite
  los deriva del autovector y la matriz de masa) y extender `ResultadosModales` + panel con la masa
  efectiva por modo y acumulada; decidir el criterio de nº de modos por % de masa objetivo.
- **Depende de / bloquea:** prerrequisito de la combinación sísmica (NCSE-02). **Coste:** CC ~varias horas.
- **Origen:** Decisión de alcance F2b (mínimo: frecuencias + formas). Plan: `vamos-a-hacer-f2b-lazy-blossom.md`.

---

## T-modal-overlay-dedup · Factorizar ModoOverlay/DeformadaOverlay (y sus buffers/geometría)

- **Qué:** `ModoOverlay`/`modalBuffers`/`modalGeometria` duplican casi 1:1 a `DeformadaOverlay`/
  `deformadaBuffers`/`deformadaGeometria` (patrón `useSyncExternalStore`+`useFrame`, empaquetado
  base/delta/color a lineSegments, y la transformación de ejes FEM(Y-up)→escena(Z-up) `[x,z,y]`/`[DX,DZ,DY]`).
  Igual `calcularModos` (useSolicitarModos) reimplementa el esqueleto de `calcularObra` (guard de reentrada,
  sink, guard de identidad de modelo, auto-switch de pestaña).
- **Por qué:** un bug del patrón hay que arreglarlo en los DOS. Evidencia concreta: el bug de "parar la
  animación deja la forma a amplitud intermedia" (code-review F2b) hubo que corregirlo a mano en
  `ModoOverlay` Y en `DeformadaOverlay` por separado; el gotcha de ejes está escrito dos veces.
- **Cómo retomar:** extraer (a) un hook `useAnimacionBuffers(base, delta, escala, animando)` o un
  componente `OverlayLineas`; (b) un `proyectarFEMaEscena(base, [6 GDL])` compartido; (c) un runner
  `ejecutarPipeline({discretizar, calcular, alExito, sink})` que `calcularObra`/`calcularModos` parametricen.
- **Depende de / bloquea:** nada. **Coste:** CC ~1-1.5 h. **Origen:** Code-review F2b (reuse/altitud).

---

## T-modal-overlay-perf · ModoOverlay recrea el BufferGeometry al arrastrar el slider de amplitud

- **Qué:** En `ModoOverlay` (y su espejo `DeformadaOverlay`), el `useMemo` de `geom` lleva `entradas.escala`
  en las deps → cada `onChange` del slider de amplitud crea un `BufferGeometry` nuevo (alloc + `dispose`) en
  vez de mutar el atributo de posiciones in situ; el `useMemo` de `buffers` va atado al objeto `entradas`
  entero → togglear animación o cambiar de vista reconstruye los buffers con dos pasadas de geometría.
- **Por qué:** jank al ajustar amplitud en obras grandes (regla #11 de rendimiento del lienzo). La animación
  ya muta las posiciones in situ en `useFrame`; el reescalado por slider debería hacer lo mismo.
- **Cómo retomar:** sacar `escala` de las deps de `geom` y reescalar el atributo existente en un efecto
  (mutación in situ + `needsUpdate` + `invalidate`); memoizar `buffers` sobre `[modeloFEM, modos, modoActivo]`.
- **Depende de / bloquea:** se hace junto a T-modal-overlay-dedup. **Coste:** CC ~30 min. **Origen:** Code-review F2b (eficiencia).

---

## T-modal-masa-altitud · La masa modal se fabrica en el glue, divergente del peso propio del discretizador

- **Qué:** La masa modal la fabrica el glue (`add_member_self_weight` + `gravity=9.81`, masa consistente) como
  segundo mecanismo para `A·ρ`, que el discretizador ya ensambla como peso propio (dist_loads, F2a). La masa
  modal ignora las cargas muertas/permanentes y el toggle `incluirPesoPropio`, y la masa que vibra es invisible
  a "Ver modelo de cálculo" (vive en Python). Además `g=9.81` está duplicado a mano en los tests
  (`modal.golden.test.ts`/`modal.smoke.test.ts`) además de `_G_FISICO` en el glue.
- **Por qué:** el día que el peso propio del discretizador cambie (densidades, cargas de forjado), la masa
  modal seguirá usando solo `A·ρ` y dará frecuencias incoherentes con la deformada estática del mismo modelo.
  *Cuidado:* el camino lumped de la Capa 2 es −15% erróneo (spike F2b), así que emitir masa consistente desde
  la Capa 2 requeriría un primitivo "self-weight" en el contrato, no es trivial.
- **Cómo retomar:** decidir si el discretizador emite la masa (combo/case de masa con flag self-weight en el
  contrato) para que el glue solo la consuma y "Ver modelo de cálculo" la muestre; y centralizar `g` (en
  `/src/unidades` o una constante que glue y tests importen) en vez de literales sueltos.
- **Depende de / bloquea:** se cruza con T-modal-masa-participante y un futuro sísmico. **Coste:** CC ~varias horas.
- **Origen:** Code-review F2b (altitud). Detección de errores del motor por substring de mensajes ingleses
  (`_MARCADORES_SIN_MASA`/`_MARCADORES_INESTABLE`/"k >= n") comparte la fragilidad ya anotada en
  [T-pdelta-deteccion-inestable].

---

## T-modelo-calculo-planta · "Ver modelo de cálculo" también en 2D planta

- **Qué:** El overlay "Ver modelo de cálculo" (F2c) solo se muestra en vista 3D
  ([ModeloCalculoOverlay.tsx](src/ui/viewport/ModeloCalculoOverlay.tsx) y el control
  [ModeloCalculo.tsx](src/ui/viewport/ModeloCalculo.tsx) se restringen a `modoVista==="3d"`).
  Extenderlo a 2D planta, filtrando la Capa 2 a la planta activa.
- **Por qué:** CLAUDE.md §3 lo describe "sobre la obra… útil para docencia", sin atarlo a 3D. En la
  introducción en planta (estilo CYPECAD), ver los nudos/releases/apoyos de la planta activa sobre el
  plano es un apoyo didáctico clásico. Se acotó a 3D en F2c por coherencia con el bundle (Issue 2).
- **Cómo retomar:** quitar la restricción a "3d" en la visibilidad y, en planta, filtrar la geometría
  Capa 2 a los nudos/barras de la planta activa (la Capa 2 no porta planta directamente: cruzar por
  `trazabilidad` o por cota de nudo). Cuidar la densidad visual del lienzo 2D. **Coste:** CC ~45-60 min.
- **Depende de / bloquea:** nada. **Origen:** Revisión de ingeniería F2c (Issue 2, alcance acotado).

---

## T-3dpleno-pick-altura · Resolver la planta de un pilar pasante por la altura del clic

- **Qué:** Al pickear un pilar en 3D, [resolverContextoElemento.ts](src/ui/viewport/hooks/resolverContextoElemento.ts)
  sincroniza el contexto a la planta del **pie** (cota menor). Un pilar pasante (varias plantas) se dibuja
  como UNA instancia, así que clicar arriba salta igualmente al pie.
- **Por qué:** En edificios con pilares pasantes el salto al pie es contraintuitivo (esperarías la planta
  donde clicaste). Se eligió el pie en F2c por simplicidad (Issue 6-A): el `instanceId` no aporta la cota.
- **Cómo retomar:** usar la Z del punto de impacto del raycast (`e.point.z` ya disponible en el `onClick`
  del pilar) para elegir la planta más cercana por cota; pasar esa Z a `resolverContextoElemento` (o un
  helper "plantaMásCercana(modelo, grupo, z)"). Cubrir con test el caso pasante + clic por encima de la
  última planta. **Coste:** CC ~20-30 min.
- **Depende de / bloquea:** nada. **Origen:** Revisión de ingeniería F2c (Issue 6-A) + auto-decisión del plan.

---

## T-3d-toolsrail-gating · La barra de herramientas (derecha) muestra herramientas 2D en 3D

- **Qué:** En vista 3D, la `ToolsRail` del shell sigue mostrando herramientas que solo
  tienen sentido en introducción 2D: snap (⌖), modo orto (∟), rejilla (▤) y el botón F4
  (plantillas DXF/DWG ▦). La colocación está inhabilitada en 3D y el panel de plantillas
  ya no se monta (F2c gating en App), así que el botón F4 queda inerte en 3D.
- **Por qué:** Inconsistencia menor de coherencia: ofrecer afordancias inertes en 3D
  confunde (un botón que no hace nada). F2c acotó el gating al HUD/overlays/App, no a la
  `ToolsRail` del shell (pre-existente, fuera del alcance de F2c). Hallazgo /design-review.
- **Cómo retomar:** en la `ToolsRail` del shell, ocultar o deshabilitar las herramientas
  2D (snap/orto/rejilla/F4) cuando `modoVista !== "planta"`; F3 (capturas ▣) sí tiene
  sentido en 3D y debe permanecer. **Coste:** CC ~20 min. **Depende de / bloquea:** nada.
- **Origen:** /design-review de F2c (hallazgo menor, shell-scope).

---

## T-modelo-calculo-6dof · Glifos fieles de apoyos (6 GDL) y releases por GDL/extremo

- **Qué:** El overlay "Ver modelo de cálculo" (F2c) dibuja apoyos en **vista simplificada**
  ([modeloCalculoGeometria.ts](src/ui/viewport/modeloCalculoGeometria.ts) `clasificarApoyo`):
  empotrado / articulado / "otro" (cualquier combinación atípica de los 6 GDL cae en "otro"), y los
  releases como una marca genérica en el extremo liberado. El panel lo rotula "vista simplificada".
- **Por qué:** un apoyo puede restringir cualquier combinación de 6 GDL (rodillo, empotramiento parcial…)
  y un release puede liberar GDL concretos en uno o ambos extremos; los glifos actuales no lo distinguen.
  Como es herramienta de docencia/verificación, conviene no inducir a error en casos atípicos (Issue 7-B).
- **Cómo retomar:** diseñar glifos que codifiquen el patrón real de GDL restringidos del apoyo (y una
  insignia para combinaciones atípicas) y marcadores de release por GDL/extremo; quitar la etiqueta "vista
  simplificada" cuando sea fiel. **Coste:** CC ~45-60 min (diseño de glifos + leyenda + tests).
- **Depende de / bloquea:** nada. **Origen:** Revisión de ingeniería F2c (Issue 7-B, alcance acotado).

---

## T-cr-una-factorizacion · CR: optimizar a una sola factorización (multi-RHS), no 3·nPlantas `analyze()`

- **Qué:** `calcular_cr` ([src/solver/pynite_glue.py](src/solver/pynite_glue.py)) resuelve el CR con la
  **opción A** del spike F0.1: por cada planta y cada uno de los 3 campos de cuerpo rígido unitarios,
  **reconstruye el modelo base** (`build_model`) e invoca `analyze_linear` → `3·nPlantas` factorizaciones.
- **Por qué:** `def_node_disp` es una propiedad del **modelo**, no del combo (no toma `case`), así que
  tres campos distintos por planta NO caben en un único `analyze()` con combos. La opción A es la que el
  spike validó (física correcta) y es suficiente para F2 (pocas plantas), pero re-factoriza la misma K
  geométrica/rigidez `3·nPlantas` veces. En un edificio grande es coste evitable.
- **Cómo retomar:** opción B de la nota del spike ([cr_diafragma_spike.md](src/solver/spikes/cr_diafragma_spike.md)):
  construir el campo de carga **equivalente** (cargas nodales por planta) en vez de desplazamientos
  prescritos, usar `add_load_combo` con `3·nPlantas` combos dedicados y `analyze_linear` UNA vez
  (una factorización, multi-RHS). **Requiere RE-VALIDAR contra la fixture** (`cr_diafragma_fixture.json`)
  y el golden del CR ([tests/golden/cr.golden.test.ts](tests/golden/cr.golden.test.ts)): la equivalencia
  carga↔desplazamiento debe reproducir CR, cond y K. Cuidado con un modelo de N plantas + diafragmas
  simultáneos (el campo de una planta no debe contaminar a otra).
- **Depende de / bloquea:** nada (optimización; la opción A es correcta). **Coste:** CC ~1-1.5 h
  (reformulación + re-validación del golden + la fixture).
- **Origen:** Spike F0.1 (nota de diseño, "Una sola factorización"/6A); diferido conscientemente en F1.2.

---

## T-cr-nodo-compartido-plantas · CR: un nudo FEM compartido entre plantas cae en una sola

- **Qué:** `nodoFEMAPlanta` ([modeloCR.ts](src/discretizador/modeloCR.ts)/[discretizar.ts](src/discretizador/discretizar.ts))
  etiqueta cada nudo FEM a UNA planta con desempate `min(id)`. Si dos plantas comparten físicamente un
  nudo FEM (mismo X,Z y misma cota, p.ej. grupos distintos a igual cota), el nudo va al diafragma de la
  planta "ganadora" y falta en el de la "perdedora" → el diafragma de esa planta queda con un nudo menos.
- **Por qué:** Exótico (requiere dos plantas a la MISMA cota compartiendo geometría). En el flujo F1/F2
  normal (plantas a cotas distintas) no ocurre. El desempate es determinista (no rompe el cálculo), solo
  el reparto es discutible. No es un ship-blocker.
- **Cómo retomar:** decidir si un nudo compartido debe pertenecer a AMBOS diafragmas (cada planta lo
  incluye en su `plantasInfo.nodos`) o mantener el desempate; si lo primero, `prepararModeloCR` emitiría
  el nudo en varias plantas. Cubrir con un caso de dos plantas a igual cota. **Coste:** CC ~30-45 min.
- **Depende de / bloquea:** nada. **Origen:** /code-review F1.2 (xhigh) hallazgo #4 (menor, exótico).

---

## T-cr-bases-elasticas · El CR no capta la flexibilidad de bases (arranque elástico = empotrado)

- **Qué:** El centro de rigidez (F2) es tan fiel como el modelo de apoyos actual. Hoy
  `arranque:"elastico"` se trata como **empotrado-con-aviso** ([discretizar.ts](src/discretizador/discretizar.ts)
  `ELASTICO_NO_SOPORTADO`); no hay muelles de apoyo. Así que el CR **no** refleja la flexibilidad de
  bases todavía, aunque la revisión de F2 la citó como algo que el analítico ignora.
- **Por qué:** un CR que se anuncie como "incluye flexibilidad de bases" sin implementarla sería
  engañoso (el espíritu del propio `T-cr-fem-exacto`). El plan F2-CR corrigió el texto para ser honesto
  y difirió esto.
- **Cómo retomar:** cablear `arranque:"elastico"` a `def_support_spring` de PyNite (que existe) en el
  discretizador/glue (rigidez del muelle por GDL), con su propio golden. El CR entonces lo reflejará
  automáticamente (usa la misma Capa 2 base). **Coste:** CC ~varias horas (dominio rigidez de muelle +
  discretizador + glue + golden). **Depende de / bloquea:** nada.
- **Origen:** Revisión de ingeniería F2-CR (cross-model 9A, Codex #8).

---

## T-cr-acoplamiento-multiplanta · CR riguroso de plantas intermedias (dependencia del patrón de carga)

- **Qué:** El CR (F2) se define por planta cargando **una planta a la vez** con todos los diafragmas
  presentes (`calcular_cr`, [pynite_glue.py](src/solver/pynite_glue.py)). Para edificios de varias
  plantas, el CR riguroso de las plantas intermedias **depende del patrón de carga** (Cheung–Tso): el
  resultado actual es la **convención** estándar, no una propiedad única.
- **Por qué:** "centro de rigidez" multi-planta no es un invariante geométrico como el de una sola
  planta; conviene no sobrevenderlo (ni como "exacto" multi-planta ni como listo para sísmico) hasta
  formalizar el criterio. El panel ya etiqueta la hipótesis de diafragma rígido.
- **Cómo retomar:** junto a la fase sísmica (donde aparece el patrón de carga real). Decidir el criterio
  (CR por modos / por patrón normativo) y documentar la diferencia con la convención actual.
- **Depende de / bloquea:** se cruza con sísmico. **Coste:** CC ~varias horas.
- **Origen:** Revisión de ingeniería F2-CR (NOT-in-scope; Codex #11).

---

## T-cr-diafragma-pano · Derivar el diafragma rígido del forjado real (paños) en vez de imponerlo

- **Qué:** El CR (F2) impone un **diafragma rígido por planta** como HIPÓTESIS (no hay paños/forjados
  todavía). El panel lo etiqueta explícitamente ("supone diafragma rígido por planta"). Cuando F3 aporte
  paños, el diafragma podrá derivarse del forjado real (rígido/semirrígido/flexible según el paño).
- **Por qué:** hoy es una hipótesis que el usuario no definió; con paños, la condición de diafragma sería
  una propiedad del modelo, no una suposición global del CR.
- **Cómo retomar:** tras F3 (paños). Que `prepararModeloCR` ([modeloCR.ts](src/discretizador/modeloCR.ts))
  derive la condición de diafragma del paño de cada planta (y soporte diafragma flexible: sin
  `def_node_disp`, o rigidez de membrana real). Quitar la etiqueta de hipótesis cuando proceda.
- **Depende de / bloquea:** requiere F3 (paños). **Coste:** CC ~varias horas.
- **Origen:** Revisión de ingeniería F2-CR (NOT-in-scope; Codex #18).

---

## T-cr-cosmeticos · Pulidos cosméticos del CR (etiqueta de ejes + nombre de helper)

- **Qué:** Dos pulidos menores de la auditoría del guardián (no bloqueantes): (1) en
  [CentroRigidez.tsx](src/ui/viewport/CentroRigidez.tsx) las coords se rotulan "X"/"Y" sin sufijo de
  replanteo (un arquitecto podría confundir la "Y" de planta con la cota) — aclarar a "X (replanteo)"/
  "Y (replanteo)", **alineado con `CentroMasa`** (cambiar ambos a la vez por coherencia); (2)
  `_es_inestabilidad_pdelta` ([pynite_glue.py](src/solver/pynite_glue.py)) lo comparten ahora P-Δ y CR —
  renombrar a algo genérico (`_es_inestabilidad_solver`) es más honesto.
- **Por qué:** claridad/coherencia; ninguno afecta a la corrección.
- **Cómo retomar:** trivial; hacerlo junto a otro toque de esos archivos. **Coste:** CC ~10-15 min.
- **Origen:** Auditoría guardián F2-CR (observaciones menores, verdes).

---

## T-f3-pano-acople · Acoplar la malla del paño al pórtico (compartir nudos / transferir carga)

- **Qué:** En F3 corte 1 la losa es **AISLADA** (decisión 5A): su malla tiene nudos PROPIOS y NO
  comparte nudos con pilares/vigas, así que **no transfiere su carga al pórtico**. El acoplamiento real
  (la losa descarga en las vigas/pilares de su contorno) está diferido.
- **Por qué:** compartir nudos malla↔barra ES acoplamiento estructural (cambia los esfuerzos del pórtico);
  hacerlo bien (compatibilidad de GDL, snapping malla→nudos de obra, reparto de rigidez) es un corte en sí
  mismo. Aislar primero permitió cerrar el cálculo de placa de punta a punta sin arrastrar esa complejidad.
- **Cómo retomar:** que `mallado.ts`/`discretizar` snapeen los nudos de borde del paño a los nudos FEM del
  pórtico coincidentes (reusar `clavePosicion`/`TOL_NODO`) en vez de crear nudos propios; validar
  compatibilidad de apoyos. Golden: losa sobre vigas → las vigas reciben la reacción de borde de la losa.
- **Depende de / bloquea:** corte 1 (hecho). **Coste:** CC ~varias horas.
- **Origen:** Plan F3 corte 1 (NOT-in-scope; decisión 5A, Codex outside-voice).

---

## T-f3-pano-poligonal · Paños poligonales / con huecos (no solo rectángulo)

- **Qué:** El corte 1 solo malla **rectángulos** alineados a ejes (4 nudos); `mallarPano` rechaza lo demás
  (`PANO_NO_RECTANGULAR`/`PANO_DEGENERADO`). Faltan polígonos arbitrarios y huecos (patios, escaleras).
- **Por qué:** una malla estructurada NxM rectangular es trivial y determinista; mallar un polígono con
  huecos exige un mallador no estructurado (Delaunay/quad-dominante), otro nivel de complejidad.
- **Cómo retomar:** mallador de polígono (triángulos o quads) en `mallado.ts`; el resto del pipeline
  (quads en Capa 2, isovalores) ya es agnóstico al número de quads.
- **Depende de / bloquea:** corte 1. **Coste:** CC ~1 día.
- **Origen:** Plan F3 corte 1 (NOT-in-scope).

---

## T-f3-pano-reticular · Forjado reticular (casetones / nervios)

- **Qué:** `tipo:"reticular"` se RECHAZA hoy con error de obra (`PANO_TIPO_NO_SOPORTADO`). Falta su modelo
  (malla de nervios + capa de compresión, o placa ortótropa equivalente).
- **Por qué:** su rigidez no es la de una losa maciza homogénea; modelarlo bien (ortotropía o nervios
  explícitos) es trabajo propio.
- **Cómo retomar:** decidir modelo (placa ortótropa vs nervios como barras + losa superior); levantar el
  rechazo en `validaciones.ts`.
- **Depende de / bloquea:** corte 1 (losa maciza). **Coste:** CC ~1 día.
- **Origen:** Plan F3 corte 1 (NOT-in-scope).

---

## T-f3-pano-unidireccional · Forjado unidireccional (viguetas en una dirección)

- **Qué:** `tipo:"unidireccional"` se RECHAZA hoy (`PANO_TIPO_NO_SOPORTADO`). Falta su modelo (viguetas
  paralelas + reparto unidireccional de carga).
- **Por qué:** reparte la carga en UNA dirección (no bidireccional como la losa); su discretización y sus
  esfuerzos son distintos.
- **Cómo retomar:** modelar como conjunto de barras (viguetas) en la dirección de canto, o placa muy
  ortótropa; levantar el rechazo.
- **Depende de / bloquea:** corte 1. **Coste:** CC ~1 día.
- **Origen:** Plan F3 corte 1 (NOT-in-scope).

---

## T-f3-muros · Muros y pantallas (placas verticales)

- **Qué:** F3 (epic) incluye muros/pantallas como elementos de superficie verticales (rigidez lateral).
  El corte 1 solo hizo la losa horizontal. Los muros usan el mismo motor de quads pero en vertical y se
  cruzan con el centro de rigidez (aportan rigidez lateral real).
- **Por qué:** los muros cambian el reparto lateral y el CR; encadenarlos con la losa habría ensanchado
  demasiado el corte. El motor de placa (quads) ya está, así que el muro reutiliza F1.3.
- **Cómo retomar:** `Muro` (hoy stub) → Capa 1 análogo a `Pano` pero vertical; discretizar a quads en el
  plano del muro; integrar con el CR (cruza con `T-cr-diafragma-pano`).
- **Depende de / bloquea:** corte 1 (motor de placa). Se cruza con F2-CR. **Coste:** CC ~1-2 días.
- **Origen:** Plan F3 (epic; NOT-in-scope del corte 1).

---

## T-f3-masa-placa · Masa de los paños en modal / P-Δ (hoy bloqueado)

- **Qué:** El análisis modal y P-Δ se **BLOQUEAN** si el modelo tiene quads (la masa de los paños no se
  modela aún): el glue lanza `MotorAnalisisConPanos` → error de obra (`pynite_glue.py`). Falta añadir la
  masa de placa (consistente, vía la densidad del quad) al modal/P-Δ.
- **Por qué:** la masa modal hoy se fabrica solo con `add_member_self_weight` (barras); ignorar la masa de
  la losa daría frecuencias falsas. Bloquear con aviso honesto es más seguro que un resultado erróneo.
- **Cómo retomar:** añadir la masa de placa al camino modal (PyNite: masa consistente del quad) y levantar
  el bloqueo. **Mejora menor (guardián):** duplicar el bloqueo como guarda TS de fallo-rápido en
  `validaciones.ts` (p. ej. `ANALISIS_CON_PANOS` cuando modal/P-Δ y `panos.length>0`), manteniendo el glue
  como red final, para no viajar al worker por algo detectable en TS.
- **Depende de / bloquea:** corte 1. **Coste:** CC ~medio día (masa) + ~15 min (guarda TS).
- **Origen:** Plan F3 corte 1 (decisión 6A) + auditoría guardián F3 (hallazgo menor).

---

## T-f3-isolineas · Isolíneas y promediado avanzado de isovalores

- **Qué:** Los Isovalores del corte 1 colorean por vértice (Mx/My promediados a nudos, flecha nodal).
  Faltan **isolíneas/contornos** (curvas de nivel) y un promediado más fino (p. ej. extrapolación de puntos
  de Gauss, suavizado, discontinuidades en bordes de material).
- **Por qué:** el color por vértice cubre el MVP de Isovalores; las isolíneas y el promediado avanzado son
  refinamiento de presentación.
- **Cómo retomar:** marching squares sobre la malla para contornos en `isovaloresBuffers.ts`/overlay.
- **Depende de / bloquea:** corte 1. **Coste:** CC ~medio día.
- **Origen:** Plan F3 corte 1 (NOT-in-scope).

---

## T-f3-convergencia · Documentar la convergencia de malla de la placa

- **Qué:** El golden de placa usa tolerancia de malla del 8% (DKMQ 8×8 da +1.5% flecha / +2.5% Mx vs
  Navier). Falta un estudio de convergencia documentado (error vs tamMalla) y, quizá, una recomendación de
  `tamMalla` por luz en la UI.
- **Por qué:** el usuario elige `tamMalla` a ciegas; un mapa error↔malla daría una guía y justificaría el
  cap de quads. No bloquea el cálculo.
- **Cómo retomar:** barrido de mallas en un golden/spike; documentar; opcional: sugerir tamMalla en
  `PanelHerramientaPano`.
- **Depende de / bloquea:** corte 1. **Coste:** CC ~2-3 h.
- **Origen:** Plan F3 corte 1 (NOT-in-scope) + tolerancia documentada en `placa.golden.test.ts`.

---

## T-f3-quad-centroide-norectangular · Centroide del quad en check_statics para cuadriláteros no rectangulares

- **Qué:** `_resultante_carga_quad` (`pynite_glue.py`) usa el **centroide aritmético** (media de los 4
  vértices) para el balance de momentos de `check_statics`. Es **exacto para rectángulos** (único caso del
  corte 1) pero no para un cuadrilátero general.
- **Por qué:** afecta solo al residuo de MOMENTO del check de estática (no a los esfuerzos); con rectángulos
  es correcto. Se vuelve relevante solo con paños poligonales/no rectangulares.
- **Cómo retomar:** usar el centroide real del cuadrilátero (descomposición en triángulos) cuando F3 admita
  no-rectángulos (junto a `T-f3-pano-poligonal`).
- **Depende de / bloquea:** `T-f3-pano-poligonal`. **Coste:** CC ~15-20 min.
- **Origen:** Auditoría guardián F3 (hallazgo menor).

---

## T-f3-sujecion-componentes · validarSujecion no detecta componentes desconectados

- **Qué:** `validarSujecion` ([validaciones.ts](src/discretizador/validaciones.ts)) es un heurístico de
  "¿hay ALGUNA sujeción?" (≥1 pilar con vinculación exterior, y ahora ≥1 paño con `bordeApoyo≠"libre"`),
  NO un análisis de componentes conexos. Un modelo con una losa apoyada (sujeción OK) MÁS un pórtico
  desconectado y sin vinculación exterior pasa la validación, pero ese pórtico es un mecanismo flotante.
- **Por qué:** F3 NO introdujo el fallo (el heurístico nunca verificó conexión a tierra por componente; un
  pórtico desconectado con otro pilar sujeto en el modelo ya se colaba), pero la rama del paño lo ENSANCHA:
  ahora la losa aporta sujeción global aunque el pórtico flote. Bajo `sparse` el solver no lanza (devuelve
  desplazamientos basura) en vez de un error de obra claro.
- **Cómo retomar:** análisis de componentes conexos del grafo nudo↔barra/quad; cada componente debe tener
  su propia sujeción (apoyo). Error de obra por componente ("el pórtico de la zona X no está sujeto").
- **Depende de / bloquea:** ninguno. **Coste:** CC ~2-3 h.
- **Origen:** /code-review F3 corte 1 (finder correctness, severidad media; pre-existente, ensanchado).

---

## T-f3-isovalores-rango-panel · PanelIsovalores reconstruye toda la malla solo para el min/max

- **Qué:** `PanelIsovalores.tsx` llama a `construirBuffersIsovalores` (posiciones+índices+color por vértice)
  solo para leer `valorMin`/`valorMax` de la leyenda, descartando el resto; `IsovaloresOverlay` construye
  los MISMOS buffers aparte → doble build por recálculo (memoizado, no por frame).
- **Por qué:** desperdicia ~2 Float32Array(nVert·3) + el bucle de rampa por vértice en cada cambio de
  combo/magnitud (control que el usuario pulsa a menudo). No es bug (correcto y memoizado), solo eficiencia.
- **Cómo retomar:** extraer `rangoIsovalores(entradas)` que haga solo la pasada `valorPorNudo` → {min,max}
  para el panel; o compartir un único resultado memoizado entre overlay y panel.
- **Depende de / bloquea:** ninguno. **Coste:** CC ~20-30 min.
- **Origen:** /code-review F3 corte 1 (finders cleanup + cross-file, eficiencia).

---

## T-f3-seccion-carga-superficial-fork · SeccionCargaSuperficial es un fork de SeccionCargas

- **Qué:** `src/ui/entradaPanos/SeccionCargaSuperficial.tsx` es ~90% copia de
  `src/ui/dialogos/SeccionCargas.tsx` (mismos hooks, añadir/eliminar, branching de hipótesis-null/automática,
  markup, CSS). Solo difieren `tipo:"superficial"` fijo y el sufijo "kN/m²" (que `SeccionCargas` ya mapea en
  `SUFIJO_POR_TIPO`). `avisoSuperficial` ([validacionesCarga.ts](src/ui/dialogos/validacionesCarga.ts)) quedó
  como código muerto (devuelve `null` siempre, sin caller en producción).
- **Por qué:** un arreglo al flujo de añadir carga (p.ej. el fix de hipótesis-null/automática, que YA fue un
  bug documentado) habría que aplicarlo en dos sitios → riesgo de divergencia silenciosa.
- **Cómo retomar:** unificar en un componente parametrizado por `tipo`+`ambito` (lookup `SUFIJO_POR_TIPO`);
  eliminar `avisoSuperficial` muerto + su test.
- **Depende de / bloquea:** ninguno. **Coste:** CC ~30-45 min.
- **Origen:** /code-review F3 corte 1 (finder cleanup).

---

## T-f3-pano-huella-instancing · PanoHuella duplica el resaltado y escala con suscripciones por paño

- **Qué:** `PanoHuella` ([GeometriaModelo.tsx](src/ui/viewport/GeometriaModelo.tsx)) reimplementa el
  hover/selección inline (un `useEffect` con SU PROPIO par de `seleccionStore.subscribe` POR paño) en vez de
  reusar `useResaltadoSeleccion`; como cada paño es un `Mesh` aparte (no `InstancedMesh`), el helper no es
  drop-in. Escala como 2N suscripciones para N paños + lógica de tinte duplicada en 3 sitios.
- **Por qué:** en corte 1 hay pocos paños por planta (impacto bajo), pero la duplicación y el escalado son
  deuda; alinear con el patrón instanciado de vigas (T-vigas-1, ya resuelto para vigas).
- **Cómo retomar:** instanciar los paños (InstancedMesh) + color/tinte por-instancia con un par único de
  suscripciones (espejo de las vigas en F2c).
- **Depende de / bloquea:** se relaciona con el render de huella de paño. **Coste:** CC ~1-2 h.
- **Origen:** /code-review F3 corte 1 (finder cleanup/altitud).

---

## T-f3-herramienta-pano-fuera-de-pestana · La herramienta "pano" queda colgada al cambiar de pestaña

- **Qué:** La herramienta `"pano"` solo se puede USAR en la pestaña Entrada de vigas (ahí se monta
  `ColocacionPano`); si el usuario la activa y cambia a Isovalores, `vistaStore.herramienta` sigue `"pano"`
  pero no hay placement montado ni guía en la barra de estado ([App.tsx](src/App.tsx) ~línea 368). Clics sin
  efecto, sin pista. No es crash; estado de herramienta colgada. (Patrón general "la herramienta persiste
  entre pestañas", no exclusivo de paños.)
- **Por qué:** confunde; el usuario no entiende por qué no pasa nada.
- **Cómo retomar:** resetear `herramienta` a `"seleccion"` al cambiar de pestaña (decisión general para
  todas las herramientas), o gatear el mensaje/placement de cada herramienta a las pestañas donde aplica.
- **Depende de / bloquea:** ninguno. **Coste:** CC ~20 min.
- **Origen:** /code-review F3 corte 1 (finder cross-file/UX).
