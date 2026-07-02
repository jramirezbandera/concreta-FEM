# Informe de auditoría UI/UX — Concreta · Estructuras

> **Rama:** `audit/uiux` (creada desde `audit/fable5`, que incluye el dock y los fixes de la auditoría de correctitud).
> **Método:** híbrido — auditoría estática de `src/ui/**` contra `Concreta_Estructuras_Spec_Diseno_UI.md` + dogfooding en navegador real (gstack `/browse`, viewport 1440×900, recorridos 1–15 del plan) con capturas.
> **Alcance:** F1 (pilares/vigas/cargas/resultados) + F2 (modal, CM/CR) + F3 (losas, isovalores). Prioridad al flujo F1.
> **Plan de origen:** `plan-auditoria-uiux.md`. Auditoría de experiencia, no de correctitud del cálculo (esa fue `audit/fable5`).

---

## 1 · Resumen ejecutivo

**74 hallazgos consolidados** (tras dedupe de 5 auditores estáticos por área + dogfooding):
**2 Críticos · 16 Altos · 33 Medios · 23 Bajos.**

**Se aplicaron 43 fixes seguros (rojo→verde)** en 6 commits, todos con tests de regresión.
Suite final: **lint ✓ · typecheck ✓ · 1353 tests en verde** (desde 1252: +101 tests nuevos).
Los fixes sensibles pasaron por `guardian-arquitectura` antes de codificarse (6 validados: 4 APTO, 2 APTO CON CONDICIONES — condiciones incorporadas).

**Los 5 temas de mayor impacto:**

1. **La app callaba cuando más importaba.** Calcular una obra inválida desde Pilares no daba *ningún* feedback (L-2, verificado en vivo); una obra vacía se enviaba al motor y "calculaba" (N-1); un fallo de carga del proyecto guardado dejaba de auto-guardar sin avisar (L-1, Crítico); el cálculo descartado por editar en vuelo moría en silencio (L-5). **Todo corregido.**
2. **Controles que mienten.** El 66–96 % de los ítems de menú eran clics muertos indistinguibles de los vivos; Orto/Rejilla eran toggles cosméticos; la escala "1:100" de la statusbar era un literal falso; los diálogos prometían "Ctrl+Z" sin que existiera el atajo; el mensaje de statusbar decía "haz clic para colocar pilares" con la herramienta inactiva. **Todo corregido** (señalizado, cableado o retirado).
3. **Obsolescencia e "isla" de los isovalores.** Tras editar la obra, deformada/reacciones/modal se marcaban obsoletos pero el mapa de isovalores seguía a todo color (H-4, verificado); además nada comunicaba que la losa se calcula **aislada** del pórtico (C-9, roza el Crítico). **Corregido** (obsolescencia espejo + notas honestas).
4. **Sobrecarga de uso y cargas muertas del grupo NO influyen en el cálculo** (D-1, Crítico): el diálogo las pide con tabla CTE detrás, pero `discretizar()` no las convierte en cargas en F1. Aplicada la **mitigación honesta** (nota visible); el cierre real (reparto a vigas, retirar campos…) es **decisión de producto pendiente** (registro §5, D1).
5. **El lienzo es mudo y la deformada tímida.** Sin etiquetas Pn/Vn, sin cotas, sin ejes de replanteo, las cargas no se dibujan (G-1/G-2), la banda elástica no muestra longitud/ángulo (C-1) y la deformada a ×1 es invisible (H-10). Son **propuestas de alcance** — las de mayor valor para la siguiente iteración.

---

## 2 · Hallazgos

Formato: `ID · título` — severidad · tipo · área · archivo:línea → **Estado**.
Estados: **APLICADO** (commit + test) · **PROPUESTO** (espera decisión, ver §5) · **DOCUMENTADO** (deuda menor asumida).

### 2.1 Críticos

**UX-D-1 · La sobrecarga de uso y las cargas muertas del grupo no influyen en el cálculo**
Crítico · opinable (mitigación objetiva aplicada) · D · `DialogoGruposYPlantas.tsx:445-458`, sin consumidor en `src/discretizador/`.
*Evidencia:* el diálogo pide categoría de uso (auto-rellena qk del CTE), sobrecarga y cargas muertas en kN/m² con validación y tabla normativa (`acciones.ts`)… pero `discretizar()` solo genera cargas desde `modelo.cargas` + peso propio. Ni el CM las usa. Es la deuda "tabla qk sin consumidor" de feature-13, invisible para el usuario.
*Impacto:* el arquitecto configura 2,0 kN/m² en el grupo, calcula, y sus esfuerzos NO la incluyen: cree algo falso sobre su estructura (criterio literal de Crítico).
*Estado:* **APLICADO (mitigación)** — nota visible junto a los campos: "Estos valores aún no se aplican al cálculo…". El cierre definitivo es la **decisión D1** del registro (§5).

**UX-L-1 · Fallo de carga del proyecto = silencio total y autosave desactivado**
Crítico · objetivo · L · `useArranquePersistencia.ts:87-96`.
*Evidencia:* si el proyecto guardado no carga (corrupto), el único feedback era `console.error` en DEV; el autosave no arranca (decisión correcta para no machacar el registro) pero el usuario no lo sabía: seguía modelando sin guardado.
*Impacto:* pérdida de trabajo real al cerrar la pestaña.
*Estado:* **APLICADO** — el hook expone la causa; banner `role="alert"` (tono danger) para proyecto corrupto y aviso discreto `role="status"` para navegador sin IndexedDB. Con tests. (`AvisoPersistencia.tsx`)

### 2.2 Altos

**UX-L-2 · Errores de cálculo invisibles fuera de Resultados** — objetivo · L · `ejecutarPipelineAuxiliar.ts:128` → **APLICADO**.
Verificado en vivo (captura `17-calcular-sin-sujecion.png`): "Calcular obra" desde Pilares con obra sin sujeción no producía cambio de pestaña, ni error, ni statusbar — el motor volvía a "listo". El único consumidor de `calculoStore.errores` (BotonCalcular) vive en el dock de Resultados. Fix: se navega a Resultados también en fallo (respetando `autoSwitchResultados` del camino CR, condición del guardián).

**UX-N-1 · La obra vacía se envía al motor y "calcula"** — objetivo · L/dogfooding → **APLICADO**.
Verificado: con 0 elementos, PyNite corría (statics check todo ceros en consola) y Resultados mostraba paneles vacíos sin explicación. Fix (condición del guardián: el veredicto lo emite el discretizador, no la UI): validación bloqueante `OBRA_VACIA` en `validaciones.ts` con mensaje de obra.

**UX-A-1 · 66–96 % de ítems de menú muertos sin señalizar** — objetivo · A · `menus.ts:35-157`, `Menubar.tsx:109-115` → **APLICADO**.
Inventario exacto: Pilares 20/26 muertos (77 %), Vigas 19/29 (66 %), Resultados 22/23 (96 %), Isovalores 14/15 (93 %). El clic muerto ni cerraba el popover (verificado). Fix: `<button disabled aria-disabled title="Disponible próximamente">` con estilo de deshabilitado. No se eliminan (mapa mental CYPECAD).

**UX-A-3 · La app promete "Ctrl+Z" sin tener el atajo** — objetivo · A · `InspectorViga.tsx:151` y análogos; menú Edición muerto → **APLICADO**.
Los diálogos de borrado decían "Podrás deshacerlo con Ctrl+Z" y el único keydown de la app era Escape. Fix: `useAtajosGlobales` (Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z, ignora foco en campos y diálogos) + ítems Deshacer/Rehacer del menú cableados.

**UX-A-4 · Orto/Rejilla: toggles cosméticos sin efecto** — objetivo · A · `ToolsRail.tsx:29-64` → **APLICADO**.
Verificado en vivo: Rejilla en "off" y la malla seguía dibujada. Fix: `rejillaVisible` en vistaStore (patrón `snapActivo`, fuera de undo) + `Escena` monta la rejilla según el flag; Orto deshabilitado con "Disponible próximamente".

**UX-A-2 · Sin Exportar/Importar/Nueva obra en la UI** — opinable (alcance) · A · `menus.ts:35-38` vs `persistencia/serializacion.ts:45-76` → **PROPUESTO (D2)**.
`exportarProyecto`/`importarProyecto` existen completos y testeados (roundtrip Zod) y ningún componente los usa. La obra vive solo en IndexedDB: borrar datos de navegación = pérdida total. Es la brecha más grave entre lo prometido (CLAUDE.md §9) y lo alcanzable desde la UI.

**UX-B-1 · Paneles que "desaparecen" (`return null`) en vez de estados vacíos** — objetivo · B/C/I · inspectores, PanelIsovalores → **APLICADO**.
El plan del dock (PR2, [E-iso-null]) exigía convertirlos en estados de sección y quedó a medias. Fix: PanelIsovalores con estado vacío guía (I-1) e inspectores con "Selecciona un pilar/viga/paño…" y caso multiselección (C-6).

**UX-C-1 · Banda elástica sin cota viva de longitud/ángulo** — objetivo (esfuerzo medio) · C · `ColocacionViga.tsx:235-267`, spec §6.1 → **PROPUESTO (D8)**.
Verificado (captura `13-banda-elastica.png`): se dibuja a ciegas; la longitud solo puede deducirse restando coordenadas de la statusbar. El spec pide la etiqueta "13.10 m · 0°" en acento. Es el fix pendiente de más valor para la entrada.

**UX-C-9 · La losa se calcula AISLADA y la UI no lo decía** — objetivo · C · `ColocacionPano.tsx:1-5` (solo comentario) → **APLICADO**.
El arquitecto dibujaba la losa sobre sus vigas, le colgaba 5 kN/m² y asumía que baja a los pilares — no es así en el corte 1 de F3. Fix: nota honesta en PanelHerramientaPano e InspectorPano.

**UX-F-1 · Hormigón inmodelable: catálogo solo IPE/HEB, sin secciones paramétricas, botón "Biblioteca" muerto** — opinable (alcance) · F · `biblioteca/index.ts:51-55`, `hormigon.ts` sin consumidor → **PROPUESTO (D3)**; el botón muerto del ToolsRail sí quedó deshabilitado (A-6).
Los materiales ofrecen HA-25…HA-40 pero ninguna sección de hormigón es alcanzable: el producto solo modela acero laminado. La tubería dominio→discretizador para secciones de obra ya existe entera; falta solo el diálogo.

**UX-G-1 · El lienzo no rotula nada: sin etiquetas Pn/Vn, sin cotas, sin ejes de replanteo** — objetivo (alcance) · G · `GeometriaModelo.tsx`, spec §4.1 → **PROPUESTO (D7)**.
De las 8 capas de render del spec faltan la 3 (ejes A,B,C/1,2,3 con burbujas), la 4 (cotas) y las etiquetas de la 5. No hay un solo texto en el lienzo (verificado: 4 pilares = 4 cuadraditos anónimos). La planta no es "un plano", es un croquis mudo.

**UX-G-2 · Las cargas no se dibujan nunca** — objetivo (alcance) · G · token `--load` sin consumidor → **PROPUESTO (D7)**.
Tras cargar una viga, el modelo se ve idéntico a uno sin cargar; la única representación es la fila de texto del inspector. Es el paso previo al cálculo con más consecuencias y el único sin feedback gráfico.

**UX-G-3 / UX-A-9 · Escala "1:100" fija y falsa en la statusbar** — objetivo · G/A · `StatusBar.tsx:22` → **APLICADO** (retirada hasta poder derivarla del zoom real).

**UX-H-1 · Deformada solo-3D con leyenda y controles vivos en planta** — objetivo · H · `DeformadaOverlay.tsx:178` vs `LeyendaEscala` → **APLICADO** (guía "La deformada se muestra en la vista 3D" + controles deshabilitados en planta). La proyección de flecha en planta queda como **PROPUESTO (D6)**.
Verificado (captura `18-resultados-planta.png`): tras calcular, en planta, rampa+slider+animar visibles y el lienzo inmóvil.

**UX-H-2 · Deformada y forma modal superpuestas sin control para ocultarlas** — mixto · H · `App.tsx:425-435` → **PROPUESTO (D9)**.
Verificado (captura `21-modal-solape.png`): tras "Calcular modos", dos mallas de líneas con la MISMA rampa conviven (más el modelo de cálculo si se activa: 4 capas). No hay toggle de visibilidad ni exclusión. El mecanismo (toggle vs exclusión mutua) es decisión de diseño.

**UX-H-3 · La tabla de reacciones expone los ejes FEM (FY = vertical)** — opinable · H · `TablaReacciones.tsx:38-47` → **PROPUESTO (D5)**.
En toda la UI "Y" es el eje horizontal de planta; en esta tabla "FY" es la reacción vertical (convenio interno Y-up). Es la mayor fuga de Capa 2 fuera de "Ver modelo de cálculo" y puede hacer leer una reacción falsa.

**UX-H-4 / UX-L-3 · Isovalores no se marcan obsoletos al editar la obra** — objetivo · H/I → **APLICADO**.
Verificado en vivo dos veces (capturas `28`/`29`): con deformada/modos/reacciones ya marcados "obsoletos", el mapa seguía a todo color. Fix espejo de la deformada: overlay agrisado + tag/aviso.

**UX-L-4 · Camino estático sin traducción de inestabilidad (mensaje crudo en inglés)** — objetivo · L · `pynite_glue.py:286-311` → **DOCUMENTADO (deuda T-ux-inestabilidad-estatica)**.
P-Δ, modal y CR reclasifican "singular/unstable" a lenguaje de obra; `linear`/`analyze` no: una inestabilidad que esquive la heurística `SIN_SUJECION` acabaría en "The stiffness matrix is singular…" en pantalla. No se aplicó en esta pasada por tocar la lógica de clasificación del glue (requiere caso de reproducción con motor real primero).

### 2.3 Medios

**UX-A-5 / UX-L-9 · F3/F4 anunciadas y muertas** — objetivo · `ToolsRail.tsx:78-94` → **APLICADO** (keydown global con preventDefault → captura/plantillas).
**UX-A-6 · Biblioteca/Configuración/Ayuda con clic muerto** — objetivo → **APLICADO** (disabled + "Disponible próximamente").
**UX-A-7 · Sidebar "Vistas" no accionable y desalineada del conmutador real** — opinable → **PROPUESTO (D11)**. Dos filas inertes ("Planta de grupo", "Vista 3D") que ni reflejan el modo activo ni listan Mosaico.
**UX-A-8 · Contadores de sidebar con criterios mezclados** — objetivo · `Sidebar.tsx:54` → **APLICADO** (vigas y paños por ámbito activo, espejo de pilares; nueva fila Paños).
**UX-A-10 / UX-L-11 · Menubar es un Popover con ARIA de menú rota** — opinable (refactor) → **PROPUESTO (D12)**. `role="menuitem"` huérfanos, sin navegación por flechas; migrar a Radix Menubar/DropdownMenu.
**UX-A-11 · Menú Edición ausente justo en la pestaña Vigas** — objetivo → **APLICADO**.
**UX-A-12 · "Obra sin título" hardcodeado sin UI para nombrar/renombrar** — opinable (alcance) → **PROPUESTO (D13)**.
**UX-A-13 · "Mosaico" cae a 3D** — opinable → **DOCUMENTADO**: el aviso "Mosaico: próximamente" existe (`role="status"`, testeado) — el olor del plan era infundado; queda la decisión menor de ocultar la opción (D11).
**UX-N-2 · Statusbar decía "haz clic para colocar pilares" con la herramienta inactiva** — objetivo · dogfooding → **APLICADO** (mensajes por herramienta: "Activa Introducción → Pilar…"; y "Une nudos…" reescrito sin jerga).
**UX-B-2/B-3 · Dock sin colapso, sin cabecera pinned, con scrolls anidados** — deuda del plan dock (PR3 y parte de PR2 sin ejecutar) → **PROPUESTO (D14)** — ya diseñado y revisado en `plan-dock-paneles.md`; no es decisión nueva.
**UX-B-4 · El dock se monta siempre (contrato "sin contenido no se renderiza" es código muerto)** — objetivo-documental → **DOCUMENTADO** (corregir el comentario de Shell.tsx al ejecutar D14).
**UX-B-5 / UX-G-8 · Las dos leyendas de rampa viven en sitios distintos** (deformada: glass bottom-center; isovalores: dock) — opinable → **PROPUESTO (D10)**.
**UX-C-2 · El imán no comunica QUÉ enganchó (nudo vs DXF vs rejilla)** — opinable → **PROPUESTO (D8)**. Es la diferencia entre "estructura unida" y "viga suelta a 10 cm".
**UX-C-3 · Imán no desactivable, radio 0.6 m en unidades de modelo > paso 0.5 m** — opinable → **PROPUESTO (D8)**.
**UX-C-5 · InspectorViga/Pano ni muestran su geometría (longitud, extremos, dimensiones)** — opinable → **PROPUESTO (D8)**.
**UX-C-6 · Inspectores sin estado vacío** — objetivo → **APLICADO** (ver B-1).
**UX-C-7 · Sección/Material sin etiqueta visible** — objetivo → **APLICADO** (rótulo visible + `aria-labelledby`, patrón del resto de campos).
**UX-C-8 · Enter no confirmaba, Esc no revertía en campos** — objetivo → **APLICADO** (Enter=commit, Esc=revertir sin commit; nota: Radix cierra el diálogo con ese mismo Esc en fase de captura — el valor queda protegido igualmente).
**UX-C-10 · Defaults absurdos: pilar/viga/losa arrancan como IPE 80 + S235** — opinable → **PROPUESTO (D15)**. Verificado: hasta la LOSA nace con acero S235; una viga IPE 80 con 10 kN/m dio 280 mm de flecha. El primer ítem del catálogo no es un default.
**UX-C-12 · (= A-4)** — **APLICADO**.
**UX-D-2 · Cambiar categoría pisa la sobrecarga en silencio; sin ayuda qk** — objetivo (la ayuda) → **APLICADO** (qk visible en las opciones + nota "La categoría A fija 2,0 kN/m² (CTE DB-SE-AE)"); el comportamiento de sincronización se mantiene (decisión aparte si molesta).
**UX-D-3 · Cotas y alturas independientes sin coherencia validada** — opinable → **PROPUESTO (D16)**.
**UX-E-1 · Editar una carga = borrar + crear** — opinable → **PROPUESTO (D17)** (el comando `editarCarga` ya existe sin consumidor).
**UX-E-2 / UX-H-11 · Combinaciones invisibles antes de calcular y sin fórmula** — objetivo (parte) → **APLICADO** (fórmulas "1,35·G + 1,50·Q" en el selector); la envolvente y una vista previa de combinaciones quedan en D18.
**UX-E-4 · Carga puntual no existe en la UI** — opinable (alcance F1) → **PROPUESTO (D19)**.
**UX-F-2 · Se permite IPE 300 + HA-25 sin aviso** — opinable → **PROPUESTO (D15)**. Física incoherente presentada con la misma seguridad que la correcta.
**UX-F-3 · Elección a ciegas: sin propiedades en los selects** — opinable → **PROPUESTO (D3)** (subtítulo mono con A/Iy o fck/E/ρ).
**UX-G-4 · Selección/hover de viga/paño solo por tinte; halo solo para pilar único** — objetivo (esfuerzo medio) → **PROPUESTO (D7)**.
**UX-G-5 · Multiselección Shift indetectable; sin contador de selección** — objetivo → **DOCUMENTADO (deuda T-ux-descubribilidad-shift)** — no aplicado en esta pasada para no engordar la lógica de mensajes; candidato fácil a la siguiente.
**UX-G-6 · (= C-1)**.
**UX-G-7 · Rejilla de líneas (drei Grid) en vez de malla de puntos del spec; comparte color con la plantilla DXF** — opinable → **DOCUMENTADO** (razonable por rendimiento; dar token propio a la sección de 5 m si molesta al calcar).
**UX-H-5 · Diagramas sin máx/mín anotados** — objetivo → **APLICADO** (anotaciones con valor+unidad; unidad también en el hover).
**UX-H-6 · Convención de signos de M sin comunicar (sagging del spec sin aplicar)** — opinable → **PROPUESTO (D5)**.
**UX-H-7 · Pilar trocado: solo se ve el tramo inferior** — opinable → **PROPUESTO (D20)**.
**UX-H-8 · "—" de "Losa (borde)" sin explicación** — objetivo → **APLICADO** (title + nota al pie).
**UX-H-9 · Mosaico: deformada/modal desaparecían (criterio `=== "3d"` vs `!== "planta"`)** — objetivo → **APLICADO** (alineados al criterio de F2c).
**UX-H-10 · Deformada plana a ×1 por defecto; slider lineal [1,500]** — opinable → **PROPUESTO (D6)**. Verificado: a ×1 es invisible; a ×8 se lee perfecta; el rango útil ocupa el 2 % del slider.
**UX-I-1 · (= B-1, PanelIsovalores)** — **APLICADO**.
**UX-I-2 · Flecha en isovalores con signo (rojo=no flecta) vs deformada con |módulo| (rojo=máximo)** — opinable → **PROPUESTO (D10)**.
**UX-J-1 · "Amplitud ×N" modal parecía el multiplicador de la deformada** — objetivo (etiqueta) → **APLICADO** ("Amplitud de dibujo", valor sin ×).
**UX-J-2 · Forma modal obsoleta a todo color** — objetivo → **APLICADO** (atenuada, espejo del CR).
**UX-K-1 · Glifos de apoyo sin leyenda** — objetivo → **APLICADO** (mini-leyenda ■▲●○ en el panel, mismos tokens que el overlay).
**UX-K-2 · Los controles CM/CR (solo-planta) y modelo de cálculo (solo-3D) desaparecen del dock sin rastro al cambiar de vista** — opinable → **PROPUESTO (D11)**.
**UX-L-5 · Cálculo descartado en silencio si se edita en vuelo** — objetivo → **APLICADO** (aviso "La obra cambió durante el cálculo: vuelve a calcular").
**UX-L-6 · Sin feedback de cálculo fuera del punto de la brandbar** — objetivo → **APLICADO** ("Calculando obra…" / "Preparando el motor de cálculo…" en statusbar). El overlay en viewport queda opcional (D21).
**UX-L-7 · `elementoId` del error nunca se usa; 4 mensajes genéricos ilocalizables** — mixto → **PROPUESTO (D22)** (clic en el error → seleccionar/encuadrar; enriquecer REF_AMBITO/FLOTANTE con nombre/posición). Verificado en vivo: "Hay un punto en la obra que no conecta con ninguna viga. (×4)" sin forma de saber cuáles.
**UX-L-8 · (= B-1/C-6)** — **APLICADO**.
**UX-L-10 · Sin Supr para borrar selección** — opinable → **PROPUESTO (D23)**.
**UX-L-12 · (= H-1)** — **APLICADO**.

### 2.4 Bajos

| ID | Hallazgo | Estado |
|---|---|---|
| UX-A-14 | Redundancia Calcular (brandbar/menú/dock) intencionada y bien resuelta; asimetría por pestaña sin explicar | DOCUMENTADO |
| UX-A-15 | Los números 1-4 de las solapas no son atajos de teclado | PROPUESTO (D23) |
| UX-B-6 | Cabeceras caps de Sidebar colapsan; las del dock no (misma pinta, distinta afordancia) | PROPUESTO (D14) |
| UX-C-4 | Rechazo de clic silencioso (viga/paño degenerados): `ignorar` sin mensaje | DOCUMENTADO (T-ux-clic-ignorado) |
| UX-C-11 | Esc de colocación sin coordinar con diálogos (doble efecto) | APLICADO (`escColocacion.ts`) |
| UX-C-13 / UX-G-11 | El paño no tiene token semántico (`--pano`); usa el del pilar / acento según el sitio | PROPUESTO (D7) |
| UX-D-4 | "Lineal/General/P-Δ" sin explicación práctica por opción | DOCUMENTADO |
| UX-D-5 | Diálogos sin `prefers-reduced-motion` | APLICADO |
| UX-D-6 | Candado emoji 🔒 fuera del set de iconografía | DOCUMENTADO |
| UX-E-3 | Sentido de la carga (gravitatoria, positivo=abajo) sin comunicar | APLICADO |
| UX-F-4 | Secciones/materiales sin mono tabular en los selects | APLICADO (`cx-select--mono`) |
| UX-G-9 | Ejes de origen con RGB nativo (rojo=danger, verde=success) | APLICADO (token `--canvas-axis`) |
| UX-G-10 | Posible colisión gizmo ↔ zoom en bottom-right | DOCUMENTADO — verificado en vivo a 1440×900: no colisionan |
| UX-G-12 | Overlay de introducción con color inconsistente entre herramientas (viga=ocre, paño=acento) | PROPUESTO (D7) |
| UX-G-13 | Paradas de la rampa equidistantes en vez de 0/.28/.52/.74/1 del spec | APLICADO |
| UX-H-12/K-4 | Leyenda horizontal bottom-center vs RampLegend vertical derecha del spec; ComboRibbon → dock | DOCUMENTADO (amparado por "datos → dock"; ubicación única en D10) |
| UX-K-3 | Fugas leves de vocabulario: "Une nudos…", "barra" | APLICADO parcial (statusbar reescrita); "barra" se mantiene (decisión consciente, CYPE también la usa) |
| UX-L-13 | `useFrame` sin `prefers-reduced-motion` | APLICADO (`reducedMotion.ts`) |
| UX-L-14 | Textos del motor sin tildes y con "(Pyodide/PyNite)" en el mensaje de UI | APLICADO (solo campos `mensaje`; marcadores de matching intactos — guardián) |
| UX-L-15 | Tag "obsoleta" gris en vez de ámbar | APLICADO (`--warning`) |
| UX-L-16 | `role="listbox"` mal construido en la lista de modos | APLICADO (botones con `aria-pressed`) |
| UX-N-3 | La unidad "mm" se leía "MM" por el uppercase del caps | APLICADO |
| UX-N-4 | Rango de leyenda ilegible "-0.0 … 0.0" con flechas pequeñas | APLICADO (formato adaptativo) |
| UX-N-6 | Filas de reacciones desordenadas (P1, P4, P2, P3) | APLICADO (orden natural; "Losa (borde)" al final) |
| UX-N-5 | Pyodide carga **matplotlib/Pillow/contourpy** al arrancar el motor (contra CLAUDE.md §8; alarga el arranque) | DOCUMENTADO (T-solver-matplotlib: investigar si es dependencia de PyNiteFEA 2.0.2 y recortarla) |
| UX-N-7 | Slider de amplificación lineal 1..500 (rango útil en el 2 % del recorrido) | PROPUESTO (D6) |

---

## 3 · Conformidad con el spec de diseño (`Concreta_Estructuras_Spec_Diseno_UI.md`)

La implementación de tokens es **notablemente fiel**: superficies, texto, semántica de elementos, rampa (colores), sombras, radios, dimensiones del scaffold (40/34/236/52/26/34) y tipografía Geist/Geist Mono coinciden valor a valor.

| Spec | Esperado | Implementado | Veredicto |
|---|---|---|---|
| §1.2 `--text-3` | `#8b95a5` | `#6b7585` | Desviación **justificada** (contraste AA, comentada en tokens.css) |
| §1.4 rampa | paradas 0/.28/.52/.74/1 | equidistantes | **Corregido** en esta auditoría (G-13) |
| §4.3 `--undeformed` (fantasma sin deformar) | mencionado | no existe | FALTANTE (la obra a color hace de referencia) — aceptable, documentar |
| §1.3 `--load` / `--support` en lienzo | consumidores | sin consumidor (cargas no se dibujan; apoyos usan `--apoyo-calc`) | Ver G-2 / ampliaciones `*-calc` documentadas |
| §2 statusbar | coords+escala+snap reales | escala falsa | **Corregido** (retirada) |
| §3.3 sidebar | Vistas/Elementos leídos/muta en Resultados | parcial, no muta | Desviación amplia → D11 |
| §3.4 F-keys | funcionales | solo rótulo | **Corregido** (F3/F4 reales) |
| §4.1 capas de render | 8 capas | faltan ejes replanteo, cotas, etiquetas, cargas | → D7 (propuesta mayor) |
| §4.2 RampLegend | vertical, derecha | horizontal, bottom-center / dock | → D10 |
| §4.4 diagramas | valores máx | sin anotar | **Corregido** (H-5) |
| §6.1 etiqueta viva | longitud/ángulo | no existe | → D8 |
| §6.4 nota de discretización | leyenda glifos | no existía | **Corregido** (K-1) |
| Badge normativo | "CTE DB-SE · EHE-08" | "Código Estructural · CTE DB-SE" | Corrección normativa consciente (EHE-08 derogada) ✓ |
| Plan dock D2/PR3 | pinned + colapso | pendiente | → D14 |
| tokens legacy | — | alias "RETIRAR tras F9" aún vivos | Deuda menor |

---

## 4 · Zonas limpias (no tocar)

- **Estado vacío de primer arranque** ("Empieza tu estructura" + CTA al diálogo): ejemplar. Diálogo Grupos/Plantas maestro-detalle con commit en vivo, validación inline `role="alert"` en lenguaje de obra ("Ya hay una planta a la cota 0 m…"), cotas autoincrementadas, borrado con recuento de cascada.
- **Undo/redo**: fiable en el dogfooding (4 ediciones deshechas exactas); comandos con no-op limpio.
- **Autosave**: la obra sobrevive a recargas (verificado); frontera Zod al importar.
- **Mensajes de `validaciones.ts`**: lenguaje de obra, nombran al culpable, accionables (salvo los 4 genéricos de L-7).
- **Arquitectura del estado de cálculo** (`calculoStore` + `estadoMotorUI`): botón/menú/brandbar no pueden divergir; guard de reentrada; timeout con terminación del worker.
- **Rendimiento del lienzo**: frameloop demand, InstancedMesh, BVH, cero setState por frame — las reglas del proyecto se cumplen de verdad.
- **Layout del shell**: dimensiones y tokens clavados al spec; landmarks y semántica correctos; foco visible global; targets 26–30 px.
- **`FilaArbol`** y su regla "solo parece pulsable si LO ES" (con test): el patrón que el resto de la UI ha ido adoptando en esta auditoría.
- **TablaReacciones y PanelDiagramas**: estados guía y obsolescencia bien resueltos desde antes (el estándar que esta auditoría extendió a isovalores/modal/inspectores).
- **CM ⊕ / CR ◇**: distinguibles por forma+color, unidades claras, nota de honestidad técnica sobre el diafragma — ejemplar.
- **Mosaico**: comunicado como "próximamente" (el olor del plan era infundado).
- **Contención de jerga FEM**: sin fugas duras; "Ver modelo de cálculo" bien confinado.

---

## 5 · Registro de decisiones opinables (esperan tu criterio)

| ID | Decisión | Opciones | Recomendación | Impacto | Esfuerzo |
|---|---|---|---|---|---|
| **D1** | Sobrecarga/cargas muertas del grupo (Crítico D-1) | A) dejar la nota honesta (hecho) · B) repartir a vigas por tributarias en F1 · C) retirar los campos hasta F3 | **B** en el siguiente corte de F3; mientras, A | El dato normativo central del grupo hoy es decorativo | B: medio |
| **D2** | Exportar/Importar .json | A) cablear ya (la lógica existe entera) · B) esperar a UI de proyectos | **A** — es pegamento de UI y elimina el riesgo de pérdida total | Crítico latente de datos | Bajo |
| **D3** | Biblioteca de secciones | A) diálogo mínimo hormigón b×h / Ø (tubería ya existe) · B) biblioteca completa con preview · C) seguir solo perfiles | **A** ya; B en F4 | Hoy no se puede modelar hormigón (público objetivo) | A: medio |
| **D4** | Defaults de material del MVP (ligado a CLAUDE §18) | A) hormigón (HA-25 + 30×30) · B) acero sensato (IPE 300/HEB 200) · C) recordar última elección | **C + arranque en A o B** según decidas el material del MVP | El default actual (IPE 80 hasta en losas) produce modelos absurdos | Bajo |
| **D5** | Reacciones y signos en lenguaje de obra | A) reetiquetar columnas (Vertical/Horiz. X/Horiz. Y) · B) nota de convenio · C) dejar FX..MZ | **A** | FY≠"eje y de tu planta": lectura falsa posible | Bajo-medio |
| **D6** | Deformada: escala inicial + slider | A) auto-escala inicial calculada (~5 % del bbox) + slider log · B) solo slider log · C) dejar ×1 | **A** | A ×1 parece que "no calculó nada" | Bajo-medio |
| **D7** | Lienzo legible (etiquetas Pn/Vn+sección, cargas dibujadas, cotas, ejes replanteo, halo de selección para vigas/paños, token `--pano`) | por fases: A) etiquetas+cargas · B) +cotas/ejes · C) todo | **A** primero | El mayor salto de valor visual pendiente | Medio-alto |
| **D8** | Entrada precisa (cota viva de banda elástica, feedback del tipo de imán, radio en px de pantalla, Alt suprime imán, geometría en inspectores) | A) cota viva + geometría solo-lectura · B) +feedback de imán · C) todo | **A** ya (spec §6.1); B después | Se dibuja a ciegas | Medio |
| **D9** | Convivencia deformada/forma modal | A) toggle "Mostrar forma modal" · B) exclusión mutua (ver una u otra) | **B** (dos magnitudes con la misma rampa no deben convivir) | Escena ilegible tras calcular modos | Bajo |
| **D10** | Leyendas de rampa: ubicación única + signo de la flecha en isovalores | A) ambas en glass junto al lienzo, |flecha| en isovalores · B) ambas en dock · C) statu quo | **A** | Mismo color significa cosas opuestas entre pestañas | Bajo |
| **D11** | Sidebar "Vistas" + huecos de contexto (CM/CR/modelo cálculo al cambiar de vista, opción Mosaico) | A) cablear Vistas como espejo 2D/3D + notas "(solo planta/3D)" · B) retirar sección Vistas · C) statu quo | **A** | Tres sitios hablan de vistas y uno funciona | Bajo |
| **D12** | Menubar accesible (Radix Menubar) | A) migrar · B) parches ARIA mínimos | **A** (teclado y roles gratis) | Lectores de pantalla y teclado de menú | Medio |
| **D13** | Nombre de obra editable ("Datos generales") | A) mínimo: leer nombre real + renombrar · B) UI multiproyecto completa | **A** | Brandbar siempre miente "Obra sin título" | Bajo |
| **D14** | Dock PR3 (colapso + pinned + SeccionColapsable compartida + quitar scrolls anidados) | ejecutar el plan ya revisado | **Sí**, tal cual `plan-dock-paneles.md` | 400 px irrecuperables; scroll doble | Medio |
| **D15** | Guardarraíles de coherencia sección↔material | A) aviso no bloqueante ("IPE + hormigón: revisa") · B) filtrar catálogo por material · C) nada | **A** | Física incoherente sin señal | Bajo |
| **D16** | Coherencia cotas/alturas de plantas | A) aviso no bloqueante si cota+altura≠siguiente · B) derivar cotas de alturas (modelo CYPECAD) · C) statu quo | **A** | Solapes/huecos silenciosos | Bajo-medio |
| **D17** | Editar carga inline (el comando ya existe) | A) valor/hipótesis editables en la fila · B) statu quo (borrar+crear) | **A** | Fricción en la tarea más iterada | Bajo |
| **D18** | Combinaciones y envolvente | A) vista previa de combos en Opciones de análisis · B) + envolvente de esfuerzos (menú ya la promete) | **A** ya; B es alcance F2+ | Verificabilidad normativa | A: bajo |
| **D19** | Carga puntual en UI | A) exponerla sobre viga (el discretizador la bloquea hoy: requiere trabajo Capa 2) · B) diferir a F3 con nota | **B** con nota "próximamente" en el selector de tipo | Vacío funcional frecuente | A: medio-alto |
| **D20** | Pilar trocado: selector de tramo en diagramas | A) selector "Planta 1/2…" · B) statu quo ("tramo inferior") | **A** | Esfuerzos de cabeza inaccesibles con 2+ plantas | Bajo-medio |
| **D21** | Overlay "Calculando…" en el propio viewport | A) sí (velo sutil + spinner) · B) basta statusbar+botón (hecho) | **B** por ahora | Percepción de cálculo largo | Bajo |
| **D22** | Errores navegables (clic → seleccionar/encuadrar culpable) + enriquecer los 4 mensajes genéricos | A) ambos · B) solo mensajes | **A** | "(×4) puntos sin conectar" sin saber cuáles | Medio |
| **D23** | Atajos restantes: Supr borra selección, 1-4 cambian de pestaña | A) ambos · B) ninguno | **A** (con confirmación en Supr) | Fluidez CAD | Bajo |

---

## 6 · Limitaciones de la auditoría

- **Plantillas DXF (F4) y capturas (F3) no se probaron con fichero real** (no había DXF de prueba en el repo); solo se verificó estáticamente su código y el cableado de los atajos.
- **Lectores de pantalla reales** (NVDA/JAWS) no se probaron; la evaluación ARIA es estática + jsdom.
- **Coma decimal española** en `CampoNumero` (`type="number"` con locale) no se verificó en navegador real con locale es-ES.
- **Multiselección con Shift** y arrastre de plantillas se verificaron solo en código.
- El dogfooding usó **clics sintéticos** (PointerEvent) por limitación del navegador headless; el tacto fino del imán (C-2/C-3) merece prueba manual del autor.
- **Rendimiento con obras grandes** (cientos de barras) fuera de alcance: la obra de prueba fue 4 pilares + 4 vigas + 1 losa.
- Los **E2E** de Playwright corren aparte (ver estado en el mensaje de cierre de la sesión); la suite unitaria/componente completa quedó en verde (1353).
- `matplotlib` cargándose en Pyodide (N-5) se observó pero **no se diagnosticó** (¿dependencia transitiva del wheel de PyNiteFEA?): abrir T-solver-matplotlib antes de tocar nada del solver.

---

## 7 · Deudas nuevas abiertas

- `T-ux-inestabilidad-estatica` — reclasificar "singular/unstable" también en el camino estático (L-4).
- `T-ux-descubribilidad-shift` — contador de selección + pista de Mayús (G-5).
- `T-ux-clic-ignorado` — mensaje transitorio en statusbar al rechazar un clic de colocación (C-4).
- `T-solver-matplotlib` — investigar y recortar la carga de matplotlib/Pillow en Pyodide (N-5).
- `T-ux-b4-comentario` — comentario obsoleto de Shell.tsx sobre dock condicional (B-4), a limpiar con D14.
