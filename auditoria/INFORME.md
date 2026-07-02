# Informe de auditoría — Concreta · Estructuras

> **Auditor:** Fable 5, siguiendo [PLAN.md](PLAN.md).
> **Fecha:** 2026-07-02 · **Rama:** `audit/fable5` (desde `feat/dock-paneles`, b4a423d). **Nada integrado a `main`.**
> **Baseline previa (hallazgo cero: no hubo):** typecheck ✅ · lint ✅ · 1205 tests ✅ · 90 golden motor real ✅ · build ✅.
> **Estado final de la rama:** typecheck ✅ · lint ✅ · **1255 tests** ✅ · **92 golden motor real** ✅ · build ✅.

---

## 1. Resumen ejecutivo

Se auditaron los 4 tiers del plan con 5 auditores de dominio en paralelo más verificación propia; **todo hallazgo Crítico/Alto/Medio fue reproducido con un test (rojo) y corregido con un fix propuesto (verde) en commits separados** sobre la rama de auditoría, para revisión del usuario.

**Recuento: 2 Críticos · 3 Altos · 7 Medios · 7 Bajos (1 corregido, 6 documentados) · apéndice cosmético.**

Los cinco que importan:

1. **[C-1 · Crítico] Las vigas flectaban con el eje DÉBIL** (Iy/Iz intercambiados respecto a lo que PyNite espera): una viga 30×60 daba **flecha 4× la real** — reproducido de punta a punta con el motor real (err. 298,7% = (h/b)²). Invisible a los golden porque eran autoconsistentes con el mismo campo o usaban secciones cuadradas.
2. **[C-2 · Crítico] Toda la serie IPE estaba 10× inflada** en Iy/Iz/It (mm⁴/1000 en vez de cm⁴; IPE 300 guardaba 83 560 cm⁴, oficial EN 10365 = 8356 — valor que la propia I+D del repo ya tenía VERIFICADO). El test que la "cotejaba" era tautológico (comparaba la tabla contra sí misma). La HEB estaba correcta.
3. **[A-1 · Alto] La carga de usuario sobre un pilar pasante solo llegaba al tramo del pie**: un pilar de 2 plantas con 10 kN/m recibía 30 kN de los 60 pedidos, sin error ni aviso, y `check_statics` no lo caza (autoconsistente). Alcanzable desde la UI.
4. **[A-2 · Alto] Centro de rigidez espurio para cimentación articulada**: con arranques articulados (opción real de la UI), la planta de pies devolvía CR=(−0,39, −3,38) — ruido de redondeo con cond bajo presentado como número válido (rombo ◇ en pantalla). Reproducido con motor real.
5. **[A-3 · Alto] `±Infinity` cruzaba los tres bordes Zod del cálculo** (Capa 1, Capa 2, resultados) hasta PyNite o la UI (17 casos reproducidos); el vector real es el blob de IndexedDB (structured clone preserva Infinity; JSON.parse no).

**Veredicto de salud:** la arquitectura (dos capas, discretizador determinista, glue, persistencia, undo) es **notablemente sólida** — los mecanismos más delicados (signos, T(), check_statics, masa modal, fórmula del CR, determinismo byte a byte, autosave atómico, reversibilidad de comandos) se verificaron correctos contra el código fuente real de PyNite y contra fórmula cerrada. Los dos Críticos eran exactamente la clase de bug que el plan anticipó: **plausibles, comentados como correctos e invisibles a golden autoconsistentes**. La lección estructural: los golden de flecha comparaban contra la misma constante que consume el motor; el golden nuevo de C-1 deriva la referencia **de la geometría** (b·h³/12), independiente del catálogo.

---

## 2. Hallazgos corregidos (test rojo → fix verde)

Cada hallazgo tiene dos commits: el test de reproducción (rojo en ese commit) y el fix (verde). `git show <hash>` muestra cada uno.

### [C-1] Vigas flectan con el eje débil (Iy↔Iz intercambiados) — **Crítico · Confirmado (motor real)**
- **Commits:** rojo `3821c4f` · fix `2e63541`
- **Ubicación:** [propiedadesBarra.ts](../src/discretizador/propiedadesBarra.ts) / [discretizar.ts](../src/discretizador/discretizar.ts) Paso 1+3; origen del error en la premisa de [hormigon.ts](../src/biblioteca/hormigon.ts) ("eje local y = horizontal de la sección" — falsa para vigas).
- **Causa raíz (evidencia primaria, Member3D.py de PyNiteFEA 2.0.2):** `k()` usa el campo **Iz** para la flexión del plano local x-y (`12·E·Iz/L³`) y `T()` fija, para barra horizontal, **local y = vertical global**. ⇒ la flexión vertical de una viga la gobierna el campo `Iz` de `add_section`; la biblioteca ponía el eje fuerte en `Iy`. Dos partes del proyecto tenían creencias contradictorias: `hormigon.ts` afirmaba que Iy gobierna; la cabecera de los golden sabía que gobierna Iz — y daba por bueno el valor débil.
- **Síntoma:** viga hormigón 30×60 biapoyada: flecha real 3,958 mm vs 0,993 mm teórica (eje fuerte) = **factor 3,99 = (h/b)²**. En pórticos hiperestáticos, además, reparto de esfuerzos falseado (rigidez relativa viga/pilar errónea). IPE como viga: rigidez 13,8× infravalorada (combinado con C-2, error neto 1,36–2,72× según perfil).
- **El pilar NO sufría el error** (verificado): para miembro vertical `T()` da y=[−1,0,0], z=[0,0,1] → con `angulo=0` el mapeo directo es correcto (b según obra-x, h según obra-y). Por eso el fix es **específico de viga**.
- **Fix:** el discretizador emite las secciones **por uso**: pilar → tal cual; viga → variante `<id>~viga` con Iy/Iz intercambiados (`seccionFEMParaViga`). Convención de la app documentada (Iy = eje fuerte "de pie", como los catálogos europeos). Golden de integración nuevo con referencia derivada de la geometría; Capa A ahora verifica el intercambio de valores; el golden del voladizo pasó de regresión opaca a **cuasi-analítico** (giro de pilar + viga, coincide <0,1% con el motor — valida ambos mapeos a la vez); snapshot del pórtico recapturado (invariante |M⁻|+|M⁺| = qB²/8 = 37,5 exacto en ambas capturas).
- **Decisión del usuario (2026-07-02, commit `426f18c`): eje FUERTE también en pilares.** Con `angulo=0` el eje fuerte resiste la flexión en X del pilar (`angulo` gira la sección). Consecuencia: el intercambio Iy/Iz pasó a ser **uniforme** para toda barra (`seccionFEMParaPyNite`), lo que simplificó el fix — desaparecen la variante `~viga` y el sufijo (una sola sección FEM por id; la forma de la Capa 2 vuelve a la previa a C-1 con los valores intercambiados). El voladizo cuasi-analítico valida ambos mapeos a la vez (giro de pilar con eje fuerte 0,0308 + viga 0,0103 = 0,0410 m, motor coincide <1%); el pórtico de regresión volvió a ~los números originales pre-auditoría (coherencia física: el reparto depende de cocientes de rigidez, restaurados al ser viga y pilar proporcionales de nuevo). La huella en planta se dibuja como cuadrado `max(b,h)`, así que el render no contradice la orientación.

### [C-2] Serie IPE 10× inflada en Iy/Iz/It — **Crítico · Confirmado (EN 10365)**
- **Commits:** rojo `507ecdd` · fix `e485fd1`
- **Ubicación:** [perfiles.ts](../src/biblioteca/perfiles.ts) (tabla `IPE_CRUDO`); test tautológico en [biblioteca.test.ts](../src/biblioteca/biblioteca.test.ts).
- **Causa raíz:** los crudos se transcribieron en mm⁴/1000 (= cm⁴×10). `A_cm2` estaba bien (por eso pasaba desapercibido). La propia I+D del repo ([04-verif-normativa.md:199](../investigacion/verificacion/04-verif-normativa.md)) ya tenía los valores correctos VERIFICADOS: el 10× entró al cablear la tabla. HEB correcta (control).
- **Síntoma:** cada IPE 10× más rígido → flechas 10× menores presentadas como válidas.
- **Fix:** tabla re-cotejada 1:1 contra EN 10365; test nuevo permanente [perfiles.oficial.test.ts](../src/biblioteca/perfiles.oficial.test.ts) contra **literales oficiales independientes** (IPE 80/160/200/300/400/600 + HEB de control); el test tautológico corregido; constantes de golden actualizadas con recaptura documentada.

### [A-1] Carga sobre pilar pasante solo llega al pie — **Alto · Confirmado**
- **Commits:** rojo `3d3d93d` · fix `6ebe37c`
- **Ubicación:** [discretizar.ts](../src/discretizador/discretizar.ts) Paso 6 (`barraPorAmbito` solo mapea el primer tramo).
- **Síntoma:** pilar p0→p2 con carga lineal de 10 kN/m: se emitía UN `dist_load` (tramo del pie) — 30 kN de 60, mal ubicados, `ok:true`, `check_statics` en verde. Alcanzable desde la UI (`InspectorPilar` monta `SeccionCargas` sin restricción). Contrastaba con el peso propio (Paso 6b), que sí recorre todos los tramos.
- **Fix:** la carga lineal cuyo ámbito es un pilar se emite en **todos** sus tramos vía `pilarAMembers` (espejo del peso propio); comentarios que documentaban la pérdida como "comportamiento estable de F1" corregidos.

### [A-2] CR espurio en cimentación articulada — **Alto · Confirmado (motor real)**
- **Commits:** rojo `3823f69` · fix `311f342`
- **Ubicación:** [pynite_glue.py](../src/solver/pynite_glue.py) `calcular_cr` (guarda de cimentación).
- **Síntoma:** la guarda FIX #2 reconocía cimentación solo por la firma "6 GDL True" (empotrado). Con arranque **articulado** (DX,DY,DZ True) la planta de pies no se filtraba; imponer el diafragma sobre nudos ya DX/DZ-fijos da K = ruido de redondeo con cond≈119 (pasa el umbral 1e12) → **CR=(−0,394, −3,380) finito y espurio** mostrado como válido.
- **Fix:** el criterio pasa a "todos los nudos con **DX y DZ ya restringidos** en el base" (cubre empotrado y articulado). Un forjado real nunca lo casa (cabezas libres); blindado por los golden de integración (la planta elevada sigue determinable ≈ centroide).

### [A-3 + M-2] `±Infinity` cruza los bordes Zod del cálculo — **Alto · Confirmado (reproducido)**
- **Commits:** rojo `39f4194` (17 casos) · fix `454ef12`
- **Ubicación:** esquemas de [dominio](../src/dominio/) (Capa 1), [contratoFEM.ts](../src/discretizador/contratoFEM.ts) (Capa 2) y [resultados.ts](../src/solver/resultados.ts) (frontera de resultados del camino estático).
- **Causa raíz:** `z.number()` pelado acepta ±Infinity (solo rechaza NaN). Los esquemas de plantillas DXF, modal y CR **ya** usaban `.finite()` con comentario de "defensa de borde"; los tres bordes del cálculo, no. Además `.positive()` solo no basta (Infinity es positivo). Vector real: `cargarProyectoEnStore` desde IndexedDB (structured clone preserva Infinity; el import por fichero está a salvo porque JSON.parse lo rechaza).
- **Fix:** `NumeroFinitoSchema` en `dominio/comunes.ts` + `numFinito` en contratoFEM/resultados, aplicado a toda magnitud física. Test permanente [blindajeFinito.test.ts](../src/dominio/blindajeFinito.test.ts) (21 casos, 3 bordes). Cierra también **[M-2]** (un modelo cuasi-singular ya no puede mostrar "Inf" como esfuerzo válido — el motor-fem confirmó que `_check_stability` de PyNite tapa los caminos probados, así que era defensa en profundidad) y **[B-5]** (export de Infinity → null, ya inalcanzable).

### [M-1] Ids duplicados → geometría silenciosamente errónea — **Medio · Confirmado**
- **Commits:** rojo `ce9c46e` · fix `a8bd8af` — dos nudos con el mismo id y posiciones distintas: la viga usaba el primero (`.find()`) e ignoraba el segundo con `ok:true`. Nueva validación bloqueante `ID_DUP` por colección (protege el borde de import; los comandos de la UI ya generaban ids únicos).

### [M-3] Pilar de longitud 0 → apoyo fantasma — **Medio · Confirmado**
- **Commits:** rojo `ce9c46e` · fix `a8bd8af` — `plantaInicial===plantaFinal` (o dos plantas a la misma cota) no emitía ninguna barra pero sí el support, que además contaba como sujeción válida. Nueva validación `PILAR_DEGENERADO` (simétrica de `VIGA_DEGENERADA`), umbral `TOL_NODO`. La UI permitía el caso desde el diálogo de edición.

### [M-4] Criterio de "mismo nudo" divergente (UI euclídeo vs FEM celda de rejilla) — **Medio · Confirmado**
- **Commit:** fix `6e33ec0` (el test de la divergencia va en el mismo commit: frontera 0,49/0,51 mm)
- Cuatro sitios de UI/comandos (`resolverExtremo`, `resolverPuntoPerimetro`, `imanViga`, `extremosCoinciden`) replicaban el predicado con `Math.hypot < TOL_NODO`, que **diverge de la clave de rejilla en la frontera de celda** — la UI podía creer "unido" lo que el solver separa (mecanismo silencioso; alcanzable por import con coordenadas sub-milimétricas). Los comentarios afirmaban "mismo criterio" (falso) y **dos tests consagraban valores exactamente en la frontera** (0,5 mm = celda vecina: el FEM los separaba). Fix: predicado único `mismaPosicionEnPlanta` en [geometria.ts](../src/discretizador/geometria.ts) (la fuente declarada), usado por los cuatro sitios; comentarios y tests corregidos.

### [M-5] Losa de bordes libres: error opaco del motor — **Medio→contenido · Verificado con motor real**
- **Commit:** fix `dced7d0`
- Verificación empírica: la losa "libre" aislada NO produce números basura — PyNite lanza limpio (`_check_stability`) — pero el usuario recibía un error técnico. Como en el corte 1 los paños son aislados por diseño, "libre" no puede calcular **nunca**: se bloquea antes con `PANO_SIN_APOYO` en lenguaje de obra. Relajar al implementar el acople malla↔pórtico (`T-f3-pano-acople`).

### [M-6] Sin ErrorBoundary: un chunk de Plotly rechazado tumbaba la app — **Medio · Confirmado**
- **Commit:** fix `9e3fe90` — `<Suspense>` solo cubre el *pending* del lazy; el *rejected* (offline tras redeploy, 404 del hash) desmontaba el árbol entero (pantalla en blanco; sin pérdida de datos por el autosave, pero sesión perdida). Nuevo `ErrorBoundary` en primitivas envolviendo `DiagramaBarraLazy`, con test jsdom.

### [M-7] CM del pilar pasante: la planta intermedia recibía 0 masa — **Medio · Confirmado**
- **Commits:** rojo `f696024` · fix `509230a`
- El reparto "medio pilar a plantaInicial + medio a plantaFinal" daba **cero** a las plantas intermedias que el pilar atraviesa y sobrepesaba los extremos (conservación global se mantenía por casualidad) → CM por planta y excentricidad CM↔CR mostradas distorsionadas. Fix: masa **tributaria** (mitad de cada tramo adyacente, espejo del troceo `cotasDePilar`; desempate de cotas compartidas como `plantaDeCotaPilar`). Pilar de una planta: idéntico al reparto anterior (regresión cubierta).

### [B-1] Fila "Losa (borde)" sumaba momentos sin r×F — **Bajo · Confirmado**
- **Commit:** fix `9e3fe90` — con borde empotrado, MX/MY/MZ del agregado mostraban una suma cruda sin sentido físico (no es resultante sin el término r×F). Ahora las fuerzas se agregan (resultante trasladable, ΣFY sigue cerrando) y los momentos muestran "—". Test jsdom con momentos no nulos.

---

## 3. Hallazgos documentados SIN fix (a decisión del usuario)

| Id | Sev. | Hallazgo | Por qué sin fix |
|---|---|---|---|
| B-2 | Bajo | El coalescing de undo (`pilaUndo.ts:26-39`) solo es correcto para comandos de patches absolutos con ruta estable (los dos actuales lo son). Un comando coalescible futuro con `add`/deltas relativos corrompería el redo en silencio. | Trampa para el mantenedor, no disparable hoy. Recomendado: documentar el invariante + test-guardián. |
| B-3 | Bajo | Una edición no-op (parches vacíos, p. ej. Aceptar sin cambios en Opciones de análisis) invalida los resultados y apila un paso de undo fantasma. Dirección conservadora (invalidar de más), daño solo UX. | Toca el núcleo del undo; beneficio menor. Fix sugerido: tratar `patches.length===0` como no-op en `PilaUndo.ejecutar`/`modeloStore.ejecutar`. |
| B-4 | Bajo | La migración v2→v3 purga solo cargas `superficial` de paños-stub descartados; una `puntual`/`lineal` colgante sobrevive. **Contenido**: el discretizador la bloquea después con `REF_AMBITO`. | Inconsistencia menor entre lo que la migración promete y hace; sin ruta a número mal. |
| B-6 | Bajo | Dos losas adyacentes con arista compartida se mallan desacopladas (nudos FEM duplicados en las mismas coordenadas). Cada losa es internamente correcta; la *continuidad* no se modela. | Limitación documentada (`T-f3-pano-acople`). Recomendado: aviso de obra "dos losas contiguas se calculan por separado". |
| B-7 | Bajo | El CM corre sobre el modelo vivo sin la pasada de validaciones: un `.json` manipulado con una carga en la hipótesis automática contaría doble en el CM mostrado (el **cálculo** sí está bloqueado por `CARGA_EN_AUTOMATICA`). | Requiere blob manipulado + solo afecta al overlay CM mientras el cálculo está bloqueado. |

**Notas de diseño / futuro (no son bugs hoy):**
- **ψ0 y varias variables (R1.3-a):** contenido — la UI bloquea la 2ª hipótesis variable y el import emite el aviso `VARIAS_VARIABLES`; con todas las acciones gravitatorias de F1, sumar todas a 1,50 es **conservador**. Deja de serlo en cuanto F2 introduzca variables no gravitatorias (viento): revisar al abrirlo.
- **Orientación del pilar** con `angulo=0`: ~~decidir~~ **RESUELTO** — el usuario eligió eje fuerte en X (commit `426f18c`, ver C-1).
- **ψ de F y G** (`TODO VERIFICAR` en acciones.ts): siguen sin cerrar contra el texto vigente (los PDF de codigotecnico.org no se pudieron renderizar); **hoy no los consume nadie** — bomba de relojería para F2/F4, cerrar antes de consumirlos.
- **Combo por defecto ELU** en Resultados: rotulado correctamente ("E.L.U. (resistencia)"); valorar ELS por defecto para la flecha.

---

## 4. Zonas auditadas SIN hallazgo (limpias — acota la confianza)

**Motor de cálculo (Tier 1), verificado contra el código fuente real de PyNiteFEA 2.0.2 y/o fórmula cerrada:**
- **Signos del glue:** `moment_z`/`max`/`min` internamente consistentes (biapoyada sagging negativo −qL²/8; voladizo +PL — verificado ejecutando PyNite); signo de presión de quad (+=abajo) confirmado en `Quad3D.fer` y con reacciones; carga de usuario y peso propio de losa cargan en el mismo sentido.
- **Proyección `T()`:** filas = cosenos directores (no hay trasposición); `_deformada_global` correcta; `check_statics` con barra inclinada 3-4-5 y carga local: residuo 1,8e-15.
- **`check_statics`:** r×F, momentos como par puro, resultante de quads, factores de combo — sin clase de carga omitida ni doble factor.
- **Modal:** `gravity=9.81` (masa=peso/g), masa consistente, frecuencias ya en Hz (`sqrt(λ)/2π`), conteo de GDL correcto (releases no reducen GDL nodales).
- **Esquinas de placa:** mapeo (ξ,η)↔i,j,m,n confirmado contra las funciones de forma `N_i` reales; unidades kN·m/m y kN/m.
- **CR:** fórmula y signos re-derivados y confirmados (simétrico→centroide exacto; asimétrico→hacia el lado rígido); colineales NO degeneran y su CR es físicamente correcto (GJ); "Combo 1" implícito coherente; ex/ey en los mismos ejes de obra; `def_support` no pisa en ningún otro sitio (mallas y pies usan nudos disjuntos).
- **Discretizador:** determinismo **byte a byte** verificado barajando todas las colecciones de un modelo grande; releases (orden de 12 bools, Rx nunca en ambos extremos); `rotation` en grados (confirmado con `radians()` en el fuente); R1.1-a (igualdad `===` de cotas) **no alcanzable** — toda cota comparada proviene literalmente de una planta; ninguna rama de traducción descarta carga sin bloquear/avisar; mallado CCW consistente, cap convergente, resultante de presión = presión×área, estabilización mínima y suficiente.
- **Peso propio:** w=A·ρ por tramo (suma = A·ρ·L_total), unidades correctas en las 4 clases de sección; CM y análisis comparten `propiedadesBarra`.

**Normativa y biblioteca (verificado con cita):** γ (1,35/1,50/0,80/0/1,00 — CTE DB-SE Tabla 4.1) ✔; qk y ψ de A–E (Tablas 3.1/4.2) ✔; exclusión del peso propio del combo con flag OFF (por predicado, sin combo fantasma) ✔; Ecm = 22000·(fcm/10)^0,3 (Código Estructural A19.3.1, NO la EHE derogada; 31476/32837/34077 MPa) ✔; ν=0,2, G=E/2(1+ν), peso 25 kN/m³ ✔; aceros E=210000, ν=0,3, fy por grado ✔; serie HEB completa ✔; conversiones cm²/cm⁴→m exactas ✔.

**Fronteras de datos (Tier 2):** conversiones de unidades correctas y centralizadas (sin dobles conversiones ni factores a mano filtrados); `quads`/`quad_loads` `.optional()` correcto (regresión byte a byte sin placas); `migrarYValidar` nunca lanza (corrupto/parcial/versión futura → rechazo limpio); **solo Capa 1 se persiste** (verificado exhaustivamente); autosave con debounce + `put()` atómico en transacción (cierre a mitad no corrompe) + concurrencia optimista + guarda anti-machaque al arrancar; round-trip export→import fiel para modelos válidos; plantillas DXF con `.finite()` y valida-al-leer.

**UI numérica y estado (Tiers 3-4):** mapeo FEM(Y-up)→escena(Z-up) **centralizado** en `puntoFemDesplazadoAEscena` y anclado a la salida real del discretizador (deformada y modal comparten helper; la escala preserva signo); diagramas con ejes/unidades correctos y sin flip; promediado de isovalores esquina↔nudo correcto, rampa sobre el rango real, mismo combo en overlay y panel; reversibilidad exacta de todos los comandos (delta Immer, deep-equal tras undo); cascadas completas en un solo undo (`nudoEnUso` evita orfandades); invalidación de resultados incondicional en la única vía de mutación; **sin carrera** en el pipeline (guard de reentrada + guard de identidad del modelo tras el await).

---

## 5. Cobertura y limitaciones de la auditoría

- **Confirmado con reproducción real:** todos los Críticos/Altos/Medios (tests rojos commiteados; C-1, A-2 y M-5 además contra el **motor real PyNite** del par pineado).
- **Método:** 5 subagentes de dominio en paralelo (discretizador+mallado, glue+CR, normativa, persistencia+Zod, UI+estado) + verificación propia de cada hallazgo antes de aceptarlo; dos hallazgos duplicados entre agentes (M-2/M-4) se cruzaron y reforzaron.
- **No cubierto / menor confianza:**
  - Los **E2E Playwright** no se ejecutaron (fuera de la baseline del plan); la suite unit/golden completa sí.
  - Los **ψ de F y G** no se cerraron contra el PDF oficial (binario no renderizable en este entorno); no se consumen hoy.
  - El agente del motor ejecutó PyNite 2.0.2 con numpy/scipy locales para verificar convenciones (código Python puro idéntico); la validación numérica canónica sigue siendo la Capa B sobre el par pineado, que está verde.
  - **P-Δ y modal** se auditaron a nivel de convenciones y guardas (correctas); no se añadieron golden nuevos suyos.
  - La cota del snapshot del pórtico se recapturó dos veces (C-2 y C-1) con el invariante isostático como control; el modelo analítico simple no reproduce el valor pre-fix — no se investigó más (el fixture tiene algún detalle no modelado a mano) porque los invariantes físicos cierran exactos en ambas capturas.

## 6. Apéndice cosmético (agregado, sin commits)

- [tests/golden/README.md](../tests/golden/README.md): dice "este repo no es un repositorio git" (desactualizado) y "los golden de motor van en UN único fichero" (hoy son 6 ficheros de motor — actualizar la regla o consolidar).
- `fixtures.ts:350` (sección genérica de peso propio): comentario "Iz gobierna la flexión vertical" — cierto para la Capa 2 emitida pre-C-1; tras C-1 el campo del catálogo que gobierna es Iy (el discretizador intercambia). Sin efecto (esos casos solo verifican M isostáticos).
- `ComboSelector` muestra `combos[0]` como fallback visual sin escribirlo al store (incoherencia teórica no disparable).
- Asimetría de limpieza de nudos huérfanos (`eliminarViga` purga; `eliminarPlanta` no) — inertes ambos.
- Patrón `let snapCache` a nivel de módulo en 5 overlays con `useSyncExternalStore` — inocuo mientras sean singletons.
- La UI expone ejes FEM en tablas/diagramas (`T-reacciones-ejes`, `T-diagramas-plano`) — deudas ya documentadas.

---

## 7. Cómo revisar esta rama

```bash
git log --oneline main..audit/fable5     # 19 commits: plan + informe + (rojo, fix) por hallazgo
git show 3821c4f                         # ejemplo: reproducción C-1 (roja en ese commit)
npm run test && npm run test:golden      # estado final: 1255 + 92 verdes
```

Los commits `audit(<id>): test ... ROJO` fallan **a propósito** en su instantánea (así se ve el bug vivo); cada `audit(<id>): FIX` los pone en verde. El estado final de la rama está completamente verde (suite, golden, typecheck, lint, build). **Nada se ha integrado a `main`**: la decisión de fusionar (entera o por hallazgos) es del usuario.
