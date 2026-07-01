# Plan de auditoría — Concreta · Estructuras

> **Destinatario:** Fable 5 (agente auditor).
> **Autor del plan:** sesión de preparación (Opus 4.8, 1M).
> **Fecha de preparación:** 2026-07-01.
> **Estado del repo al preparar:** rama `feat/dock-paneles`, F1 + F2 completas, F3 corte 1 (losa maciza + isovalores) fusionado a `main`. ~1200 tests + 90 golden verdes.

---

## 0. Cómo usar este documento

Eres el **auditor**. Tu trabajo NO es implementar features ni refactorizar por gusto: es **encontrar dónde la implementación puede estar dando un resultado incorrecto** y demostrarlo. En una herramienta de cálculo estructural el error más peligroso es el **silencioso**: un momento, un cortante o una flecha equivocados que se presentan al arquitecto como válidos. Ese es el objetivo número uno.

Alcance decidido por el usuario: **todo el sistema, priorizado por riesgo** (Tier 1 = cálculo; Tier 2 = fronteras de datos; Tier 3 = UI numérica; Tier 4 = estado/undo).
Modo decidido por el usuario: **informe + corrección propuesta**. Para cada hallazgo de severidad Alta o Crítica entregas (a) la prueba que lo reproduce y (b) un fix propuesto con su test de regresión, **sin integrarlo en `main`**.

Trabaja de arriba abajo por tiers, pero **no te saltes el Tier 1**: es donde un fallo hace daño real.

---

## 1. Objetivo y filosofía

### 1.1 Qué buscas (en orden de importancia)
1. **Incorrectitud numérica silenciosa** — un número estructural (esfuerzo, reacción, flecha, frecuencia, centro de rigidez/masas, momento de placa) que sale mal y se muestra como bueno. **Máxima prioridad.**
2. **Corrupción o pérdida de datos** — importar/migrar/persistir que rompe el modelo o lo altera sin avisar.
3. **Violación de invariantes del proyecto** — reglas de oro del `CLAUDE.md` (dos capas, unidades en los bordes, PyNite como única fuente de verdad, determinismo byte-a-byte, Zod en los bordes).
4. **Fragilidad** — código correcto hoy pero que se rompe con una entrada plausible (floats, orden de entrada, referencias colgantes).

### 1.2 Fuentes de verdad (jerarquía; si dos chocan, gana la de arriba)
1. **[CLAUDE.md](../CLAUDE.md)** — las 9 reglas de oro y los antipatrones (§2, §17). Es el contrato del proyecto.
2. **[PyNite_Guia_Completa.md](../PyNite_Guia_Completa.md)** — API y contrato de datos del solver (firmas, convenciones de signo, `*_array()`).
3. **Normativa oficial vigente** — Código Estructural (RD 470/2021) para materiales de hormigón/acero; CTE DB-SE / DB-SE-AE para acciones y combinaciones. **Verifica contra el texto oficial, no contra la memoria.** (Nota de memoria: la EHE-08 está **derogada**; el módulo del hormigón es `Ecm = 22000·(fcm/10)^0,3`, no la fórmula EHE.)
4. **Golden tests** — [tests/golden/](../tests/golden/): casos de libro con solución cerrada. Son la red de seguridad.

### 1.3 Reglas de conducta del auditor (innegociables)
- **Nunca aflojes una tolerancia ni "ajustes" una fórmula de referencia para que un golden pase.** Es un antipatrón explícito del proyecto ([tests/golden/README.md](../tests/golden/README.md)): si un número se mueve por encima de tolerancia, el bug está en el discretizador/unidades/glue, **jamás en la fórmula de libro**.
- **Prueba, no especules.** Todo hallazgo Alto/Crítico debe venir con un test que lo **reproduce** (rojo antes del fix, verde después). Un hallazgo sin prueba reproducible es una *sospecha*, y va etiquetado como tal (severidad máxima "Media — sin confirmar").
- **Verifica contra el código, no contra los comentarios ni la memoria.** El código está muy comentado y hay notas de memoria; algunas están **desfasadas** (ejemplo real: [tests/golden/README.md](../tests/golden/README.md) dice "este repo no es un repositorio git" — ya sí lo es). Los comentarios documentan la *intención*; tu trabajo es comprobar que el *código* la cumple.
- **No confundas "feature no implementada" con "bug".** El proyecto va por fases (F1→F4) y tiene deudas documentadas (`T-...`). Una limitación conocida y bloqueada de forma segura (p. ej. paños reticulares aún no soportados → se bloquean con error de obra) **no es un hallazgo**. Un cálculo que corre pero da un número mal, **sí**. Ver §5.

---

## 2. Preparación (establece la línea base antes de tocar nada)

Ejecuta y guarda la salida como **baseline**. Si algo ya está en rojo, ese es tu **hallazgo cero** (y cámbialo tu punto de partida — no puedes distinguir tu regresión de una preexistente sin baseline verde).

```bash
npm install            # asegura deps + postinstall (copy-pyodide-assets)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run test           # suite Vitest completa (~1200 tests)
npm run test:golden    # Capa A (discretizador, ms) + Capa B (motor real PyNite, ~8-9 s)
npm run build          # tsc + vite build
```

Notas:
- Los golden de **Capa B** arrancan Pyodide + numpy/scipy + PyNiteFEA **offline** (wheels vendorizados en `vendor/wheels/`, runtime en `node_modules/pyodide`). No hay red. Si en tu entorno no arranca Pyodide, la Capa B se **auto-salta** con SKIP; intenta que corra, es la validación numérica del motor.
- El par de versiones está **pineado**: Pyodide **0.28.3** ↔ PyNiteFEA **2.0.2** (numpy 2.2.5 / scipy 1.14.1). Fuente única: [src/solver/config.ts](../src/solver/config.ts). No lo cambies.

### Disciplina de trabajo
- **Rama propia** de auditoría (p. ej. `audit/fable5`). **No toques `main` ni `feat/dock-paneles`.**
- **Un commit por hallazgo** (o por fix propuesto), atómico, mensaje que cite el id del hallazgo. **No abras PR ni mergees.**
- Aprovecha los **subagentes de dominio** del repo para profundizar en paralelo (delegan lectura y análisis, tú consolidas):
  - `experto-discretizador` → Tier 1.1, 1.3, 1.4.
  - `experto-motor-fem` → Tier 1.2, 1.5 (glue), CR.
  - `experto-normativa` → Tier 1.3 (γ/ψ/qk), Tier 2.2 (materiales/secciones).
  - `experto-persistencia-testing` → Tier 2.3/2.4, y escribir los tests de reproducción.
  - `experto-frontend-cad` → Tier 3, Tier 4.
  - `guardian-arquitectura` → pásale cada zona para comprobar cumplimiento de las reglas de oro.

---

## 3. Escala de severidad (calibrada para una herramienta de cálculo)

| Severidad | Definición |
|---|---|
| **Crítico** | Un número estructural incorrecto se presenta al usuario como válido (esfuerzo/reacción/flecha/frecuencia/CR/CM/momento de placa mal, sin aviso). O pérdida/corrupción silenciosa de datos del modelo. O la app se rompe de forma irrecuperable con una entrada plausible. |
| **Alto** | Un número mal solo bajo una configuración concreta pero **plausible** (p. ej. pilar pasante multiplanta, dos hipótesis variables, cota con decimales); o un aviso/bloqueo que **debería** existir y no existe, permitiendo calcular con menos carga/rigidez de la real. |
| **Medio** | Fragilidad real (float exacto, orden de entrada, referencia colgante) que hoy no se dispara pero se disparará; o divergencia de la normativa vigente aún no verificada; o violación de invariante sin impacto numérico inmediato. |
| **Bajo** | Deuda técnica con impacto acotado y documentado; inconsistencia menor; robustez defensiva ausente sin ruta de disparo conocida. |
| **Cosmético** | Naming, comentarios desfasados, formato. Reporta agregado, no uno por uno. |

Cada hallazgo lleva además una **confianza**: *Confirmado* (test que lo reproduce) o *Sin confirmar* (razonado pero no reproducido). Un Crítico/Alto **debe** aspirar a *Confirmado*.

---

## 4. Formato de cada hallazgo (entregable)

Escribe los hallazgos en `auditoria/INFORME.md` (uno consolidado) y, si son muchos, particiona por tier en `auditoria/INFORME-tierN.md`. Cada hallazgo:

```
### [H-###] Título corto y concreto
- **Tier / Área:** 1.1 Discretizador
- **Severidad:** Alto · **Confianza:** Confirmado
- **Ubicación:** src/discretizador/discretizar.ts:368
- **Síntoma:** qué se observa mal (el número/comportamiento incorrecto).
- **Escenario de fallo:** inputs concretos → salida errónea esperada vs. obtenida.
- **Causa raíz:** por qué ocurre, en una o dos frases.
- **Prueba:** ruta del test que lo reproduce (rojo sin fix). Cómo correrlo.
- **Fix propuesto:** el diff (o descripción precisa), + su test de regresión (verde tras fix).
- **Riesgo del fix:** qué podría romper; qué golden/tests lo cubren.
```

**Regla:** el fix propuesto va en **commit separado** del test de reproducción, para que se pueda ver el test en rojo antes y en verde después. No lo integres a `main`.

---

## 5. Qué NO reportar (fuera de alcance / deudas aceptadas)

No son hallazgos (a menos que descubras que además producen un **número incorrecto mostrado como válido**, en cuyo caso el hallazgo es ese número, no la limitación):

- **Features de fases futuras**: armado y comprobación normativa (F4), cimentación, paños reticulares/unidireccionales/poligonales, muros/pantallas, acoplamiento malla↔pórtico, bases elásticas, P-Δ/modal con masa de placa. Están **bloqueadas con error de obra** o diferidas por diseño.
- **Deudas `T-...` documentadas**: haz `grep -rn "T-" src/` y revisa la memoria del proyecto. Si una limitación está documentada Y bloqueada de forma segura, no es hallazgo. Ejemplos: `J=0` en sección rectangular maciza (torsión no comprobada en F1, decisión documentada en [hormigon.ts](../src/biblioteca/hormigon.ts)), `Grupo.cargasMuertas` no incluidas en el CM sin paños, ψ de F/G marcados `TODO VERIFICAR`.
- **Cosmética pura** sin impacto (salvo que el usuario la pida): naming, comentarios desfasados. Repórtala agregada al final.

> **Matiz clave:** una decisión "documentada" solo está fuera de alcance si es **segura**. Si `J=0` (por ejemplo) puede producir una **matriz singular / mecanismo torsional** que hoy no se detecta y da un resultado inestable o falso → eso **sí** es un hallazgo (el problema no es "no comprobamos torsión", es "el modelo puede volverse singular en silencio"). Aplica este criterio a toda deuda: **¿la limitación está contenida, o puede filtrar un número mal?**

---

## 6. Matriz de auditoría (el núcleo del trabajo)

Para cada módulo: **qué hace**, **hipótesis de riesgo concretas** (pistas del preparador; no son exhaustivas — busca más), **cómo verificar**, **evidencia esperada**.

---

### TIER 1 — Motor de cálculo (MÁXIMA PRIORIDAD)

Aquí es donde un error es silencioso y peligroso. Dedica aquí la mayor parte del esfuerzo.

#### 1.1 · El discretizador — el corazón
**Archivos:** [src/discretizador/discretizar.ts](../src/discretizador/discretizar.ts) (`construirBaseFEM` + `discretizar`), [geometria.ts](../src/discretizador/geometria.ts) (`mapearEjes`, `clavePosicion`, `TOL_NODO`), [validaciones.ts](../src/discretizador/validaciones.ts), [contratoFEM.ts](../src/discretizador/contratoFEM.ts).
**Qué hace:** traduce Capa 1 (obra) → Capa 2 (JSON PyNite). Genera nodos por snapping, barras, apoyos, releases, cargas, combos. Es **puro y determinista**. Es el código más crítico del producto.

**Hipótesis de riesgo (verificar):**
- **[R1.1-a] Igualdad exacta de floats en cotas.** `cotasDePilar` usa `planta.cota > cMin && planta.cota < cMax` y `plantaDeCotaPilar` filtra `pl.cota === c` ([discretizar.ts:233](../src/discretizador/discretizar.ts#L233), [discretizar.ts:263](../src/discretizador/discretizar.ts#L263)). El XY se compara con tolerancia (`TOL_NODO`) pero **la cota con `===` exacto**. ¿Qué pasa si dos plantas tienen cotas que deberían coincidir pero difieren en 1e-12 por una edición/importación? ¿Un pilar pasante deja de trocearse en una planta intermedia, o `nodoFEMAPlanta` lanza el "bug interno"? Construye un modelo con cotas resultado de aritmética (p. ej. `0.1+0.2`) y observa.
- **[R1.1-b] Carga de usuario sobre pilar pasante solo llega al tramo inferior.** `barraPorAmbito.set(p.id, name)` solo para `k===0` (el pie) ([discretizar.ts:368](../src/discretizador/discretizar.ts#L368)). El peso propio (Paso 6b) sí recorre **todos** los tramos, pero una **carga lineal del usuario** sobre un pilar de varias plantas se aplicaría solo al tramo inferior. ¿Es intencionado y documentado, o se pierde carga en silencio? Compara el tratamiento de peso propio vs. carga de usuario sobre el mismo pilar pasante.
- **[R1.1-c] `rotation: p.angulo` — unidades.** Se pasa `p.angulo` como `rotation` de la barra ([discretizar.ts:375](../src/discretizador/discretizar.ts#L375)) → `add_member(..., rotation=...)` en el glue. **Verifica en [PyNite_Guia_Completa.md](../PyNite_Guia_Completa.md) si PyNite espera grados o radianes**, y confirma que `p.angulo` del dominio está en la misma unidad. Un desajuste grados/radianes rota mal la sección (clásico error de signo/orientación → Iy/Iz intercambiados de facto).
- **[R1.1-d] Releases: Rx nunca liberado en ambos extremos.** `releasesDeExtremo` ([discretizar.ts:107](../src/discretizador/discretizar.ts#L107)). Confirma que (1) el orden del array de 12 bools casa con `def_releases` de PyNite `[Dxi,Dyi,Dzi,Rxi,Ryi,Rzi,Dxj...]`, y (2) que ninguna combinación (articulado/articulado, tirante) puede liberar Rxi **y** Rxj (mecanismo torsional). Testea las 4 combinaciones de extremos + tirante.
- **[R1.1-e] Determinismo byte-a-byte.** El invariante clave: mismo modelo lógico reordenado ⇒ misma Capa 2. Toma un modelo no trivial, **baraja** `pilares/vigas/nudos/plantas/cargas/panos` y compara `JSON.stringify(discretizar(m))` byte a byte. Busca cualquier iteración de `Map`/`Set` cuya salida dependa del orden de inserción (hay varias; el código las ordena antes de numerar — confirma que **todas** lo hacen).
- **[R1.1-f] Nodos compartidos vs. colisión de snap.** `clavePosicion(coord, TOL_NODO)`: dos elementos a < `TOL_NODO` colapsan en un nodo. ¿Puede eso **fusionar por error** dos pilares distintos que el arquitecto quiso separados (TOL_NODO demasiado grande)? ¿O **no** compartir nudo una viga y un pilar que coinciden (TOL_NODO demasiado pequeño respecto al snapping de la UI — ver R3.3)? Verifica el valor de `TOL_NODO` y su coherencia con la UI.
- **[R1.1-g] Errores bloqueantes vs. avisos.** El discretizador **bloquea** cargas que perderían carga real en silencio (superficial no aplicable, puntual sin posición) y **avisa** (no bloquea) el arranque elástico tratado como empotrado. Verifica que ninguna rama de traducción **descarta carga o rigidez sin avisar** (busca `continue` que salte una carga sin empujar a `erroresTraduccion` ni `avisos`).

**Cómo verificar:** amplía la **Capa A** ([tests/golden/discretizador.casos.test.ts](../tests/golden/discretizador.casos.test.ts)) con casos que aíslen cada hipótesis; corre en Node puro (ms). Para R1.1-c, cruza con la Capa B (motor real) comparando un pórtico con pilar rotado contra el mismo con la sección ya girada a mano.

---

#### 1.2 · El glue Python — extracción de resultados y convenciones de signo
**Archivos:** [src/solver/pynite_glue.py](../src/solver/pynite_glue.py), [resultados.ts](../src/solver/resultados.ts), [solverClient.ts](../src/solver/solverClient.ts), [worker.ts](../src/solver/worker.ts).
**Qué hace:** construye `FEModel3D` desde la Capa 2, analiza (`analyze_linear`/`analyze`/`analyze_PDelta`/`analyze_modal`), y serializa `ResultadosCalculo`. Es la **única fuente de verdad del cálculo** (no reimplementar FEM). Aquí viven las convenciones de signo más delicadas.

**Hipótesis de riesgo (verificar):**
- **[R1.2-a] Signo de `moment_z` / `min_moment_z`.** [pynite_glue.py:813-814](../src/solver/pynite_glue.py#L813). La memoria marca un "gotcha del signo de Mz en `min_moment_z`". Verifica contra fórmula cerrada (biapoyada: `M_max = qL²/8` positivo; voladizo: `M_empotramiento` negativo) que `max_moment_z`/`min_moment_z` tienen el signo correcto y que el diagrama `moment_z` (array 2×n) no está invertido.
- **[R1.2-b] Signo de presión de quad.** [pynite_glue.py:174-183](../src/solver/pynite_glue.py#L174) y el emparejamiento en el discretizador ([discretizar.ts:656](../src/discretizador/discretizar.ts#L656) `presion: -valor`, y peso propio de losa `+ρ·t` en [discretizar.ts:930](../src/discretizador/discretizar.ts#L930)). **Este ya fue un bug real** (la losa flectaba hacia arriba, estable pero mal, invisible al golden de gate). Confirma con el **golden de integración** (discretizar real → motor real → `DY_centro < 0` bajo presión gravitatoria) que sigue correcto, y que carga de usuario y peso propio de losa cargan en el **mismo** sentido. Comprueba también el signo en `_resultante_carga_quad` (check_statics, [pynite_glue.py:637](../src/solver/pynite_glue.py#L637)).
- **[R1.2-c] Deformada global por proyección `T()`.** `_deformada_global` ([pynite_glue.py:482](../src/solver/pynite_glue.py#L482)) proyecta la flecha local a global con la tríada `Member3D.T()`. Invariante: estación 0 == `disp` del nudo i, estación n-1 == nudo j. Verifica ese invariante con un golden (continuidad con `nodos[].disp`).
- **[R1.2-d] `check_statics` — residuo de equilibrio.** `_check_statics` ([pynite_glue.py:664](../src/solver/pynite_glue.py#L664)) suma reacciones + cargas externas y exige ~0. Incluye términos `r×F` respecto al origen y proyección local→global de cargas transversales. Verifica: (1) que una carga **local transversal** (Fy/Fz) sobre una barra inclinada no dé falso negativo (ya se corrigió una vez, T1.2 de feature-6); (2) que las cargas de **momento** (MX..Mz) entren como par puro sin `r×F`; (3) que la resultante de **quad** entre en el balance (sin ella, "ok" falso con placas).
- **[R1.2-e] Masa modal: `gravity=9.81`.** `_run_modal` ([pynite_glue.py:338](../src/solver/pynite_glue.py#L338)). El spike confirmó que `rho` es **peso** específico (kN/m³), así que masa = peso/g y hay que pasar `gravity=9.81` (con 1.0 las frecuencias salen ×√g, "plausibles pero erróneas"). Verifica con el golden modal (biapoyada: f1 analítica) que `gravity=_G_FISICO` y que la masa es **consistente** (`add_member_self_weight`), no lumped (lumped daba −15%).
- **[R1.2-f] Muestreo de esquinas de placa.** `serialize_results` mapea las 4 esquinas i,j,m,n a `(xi,eta) = (-1,-1),(1,-1),(1,1),(-1,1)` con `local=True` ([pynite_glue.py:830-847](../src/solver/pynite_glue.py#L830)). Confirma que ese mapeo casa con las funciones de forma de `Quad3D` de PyNiteFEA 2.0.2 (el comentario lo afirma; **verifícalo** contra el código de PyNite en `node_modules`/wheel o la guía), porque de ahí depende que Mx/My/Mxy se asignen a la esquina correcta y que el promediado a nudos de los isovalores no mezcle componentes.
- **[R1.2-g] Robustez de la frontera.** `calcular`/`calcular_cr` devuelven **siempre** `{ok, ...}`, nunca propagan excepción cruda por Comlink. Verifica que todo camino de error (inestable, sin masa, panos+modal) cae en un `except` que emite mensaje en lenguaje de obra, y que `float()`/`.tolist()` materializan **todo** ndarray antes de cruzar (un `np.float64` o `NaN`/`Inf` que se cuele rompe el Zod del otro lado — revisa el saneo de no-finitos en modal, [pynite_glue.py:886](../src/solver/pynite_glue.py#L886)).

**Cómo verificar:** **Capa B** ([tests/golden/pipeline.golden.test.ts](../tests/golden/pipeline.golden.test.ts)) contra fórmula cerrada. Recuerda: **todos los golden de motor real van en un único fichero** (el arranque de Pyodide cuesta ~8 s y Vitest aísla por fichero). Añade casos ahí, no en ficheros nuevos.

---

#### 1.3 · Combinaciones CTE
**Archivos:** [src/discretizador/combinaciones.ts](../src/discretizador/combinaciones.ts), [src/biblioteca/acciones.ts](../src/biblioteca/acciones.ts).
**Qué hace:** genera los combos ELU (1,35·G + 1,50·Q) y ELS (1,00·todas) desde las hipótesis.

**Hipótesis de riesgo (verificar):**
- **[R1.3-a] Varias hipótesis variables sin ψ0.** `generarCombos` aplica `γ_Q=1,50` a **toda** hipótesis variable ([combinaciones.ts:66](../src/discretizador/combinaciones.ts#L66)), sin coeficiente de simultaneidad ψ0. El comentario dice "F1: una única variable dominante". **¿Hay algo que impida crear dos hipótesis variables?** Si el usuario define dos (p. ej. sobrecarga de uso + otra), el combo ELU las suma **ambas a 1,50**, lo que **no es la combinación CTE** (§4.2.2: una dominante a γ_Q + las demás a γ_Q·ψ0). Comprueba si se **bloquea/avisa** ese caso o si se calcula un combo silenciosamente no normativo. (Puede ser conservador o no según la envolvente; el punto es que se aparta de la norma sin avisar.)
- **[R1.3-b] Valores γ vigentes.** `GAMMA_G_DESFAV=1,35`, `GAMMA_Q_DESFAV=1,50`, `GAMMA_G_FAV=0,8`, `GAMMA_Q_FAV=0`, `GAMMA_ELS=1,0` ([acciones.ts:177-195](../src/biblioteca/acciones.ts#L177)). Verifica contra **CTE DB-SE Tabla 4.1** (resistencia, situación persistente/transitoria) con el texto oficial.
- **[R1.3-c] qk y ψ por categoría de uso.** Tabla en [acciones.ts:63-164](../src/biblioteca/acciones.ts#L63). Verifica qk (DB-SE-AE Tabla 3.1) y ψ0/ψ1/ψ2 (DB-SE Tabla 4.2) **letra por letra** contra el texto oficial. Presta atención a los marcados `TODO VERIFICAR`: **F** (ψ heredan del uso de acceso, hoy candidato = residencial A) y **G** (fila en blanco en la norma, hoy ψ=0 por no-concomitancia). Nota: qk **no** lo consume hoy el discretizador (se cablea en el diálogo de grupos a `sobrecargaUso`); ψ **no** los consume nadie aún. Aun así verifica los valores: entrarán en F2/F4 y un dato mal aquí es una bomba de relojería.
- **[R1.3-d] Peso propio en combos.** La hipótesis automática de peso propio se **excluye** del combo si `incluirPesoPropio` está OFF ([combinaciones.ts:63](../src/discretizador/combinaciones.ts#L63)), y se factoriza como **permanente** (γ_G) cuando aporta. Verifica que se identifica por **predicado** (flag), no por id, y que no queda un "combo fantasma" ni un doble cómputo.

**Cómo verificar:** unit tests puros sobre `generarCombos`; para la normativa, `experto-normativa` + WebFetch al texto oficial de codigotecnico.org.

---

#### 1.4 · Peso propio automático
**Archivos:** [discretizar.ts:720-768](../src/discretizador/discretizar.ts#L720) (Paso 6b), [propiedadesBarra.ts](../src/discretizador/propiedadesBarra.ts).
**Qué hace:** emite `w = −(A·ρ)` (kN/m, FY negativa) por cada barra en la hipótesis automática, cuando `incluirPesoPropio` está activo. Es ensamblado de carga (no `add_member_self_weight`), puro y golden-testable.

**Hipótesis de riesgo (verificar):**
- **[R1.4-a] A·ρ correcto para cada tipo de sección.** `propiedadesComunes` resuelve A desde `resolverSeccionFEMPorId` para las 4 clases: perfil de catálogo, hormigón rectangular, hormigón circular, genérico ([propiedadesBarra.ts](../src/discretizador/propiedadesBarra.ts)). Verifica que A sale en **m²** (conversión mm→m solo en `resolverSeccion`) y ρ en **kN/m³**, para las 4. Un error de unidades aquí escala todo el peso propio.
- **[R1.4-b] Pilar pasante: todos los tramos.** El Paso 6b recorre `pilarAMembers[p.id]` (todos los tramos), a diferencia de la carga de usuario (R1.1-b). Confirma que el peso propio del pilar entero se reparte y que la **longitud** usada por `propiedadesDePilar` es la total (arranque→cabeza), no la de un tramo — porque `w=A·ρ` se emite **por tramo** y PyNite integra sobre la longitud de cada tramo; verifica que la suma de tramos = A·ρ·L_total (no doble ni mitad).
- **[R1.4-c] Coherencia peso propio análisis ↔ centro de masas.** Ambos usan `propiedadesBarra` (A-dry). Verifica que no divergen (mismo A·ρ·L). Es un invariante que la memoria destaca.

---

#### 1.5 · Mallado de losa (F3)
**Archivos:** [src/discretizador/mallado.ts](../src/discretizador/mallado.ts), consumido en [discretizar.ts:770-935](../src/discretizador/discretizar.ts#L770) (Paso 6c).
**Qué hace:** rejilla NxM de quads de una losa rectangular **aislada** (nudos propios, sin snapping al pórtico), con apoyos de borde + estabilización anti-singular.

**Hipótesis de riesgo (verificar):**
- **[R1.5-a] Orden CCW i→j→m→n.** El orden de nudos fija los ejes locales de la placa → consistencia de Mx/My entre quads y signo de la presión ([mallado.ts:291-306](../src/discretizador/mallado.ts#L291)). Verifica que **todos** los quads salen en el mismo sentido CCW visto desde +Y y que ninguno se emite invertido (un quad invertido cambia el signo de Mx/My y rompe el promediado a nudos de los isovalores).
- **[R1.5-b] Estabilización no colineal.** DX+DZ en (0,0) y DZ en (nx,0) ([mallado.ts:331-336](../src/discretizador/mallado.ts#L331)). Fija 3 GDL de cuerpo rígido en el plano (2 traslaciones + giro RY). Confirma que los 2 nudos son **siempre distintos** (garantizado por nx≥1) y que la estabilización **no** contamina la flexión (no toca DY ni RX/RZ). Un caso degenerado a vigilar: losa de **una sola celda** (nx=ny=1) — ¿siguen siendo suficientes 3 restricciones?
- **[R1.5-c] Cap de quads.** `CAP_QUADS=2000`, engrosado iterativo ([mallado.ts:215-242](../src/discretizador/mallado.ts#L215)). Verifica que converge siempre (guardia de 10000) y que emite el aviso `PANO_MALLA_LIMITADA`. ¿Un `tamMalla` diminuto (p. ej. 1e-6) hace algo raro antes del cap?
- **[R1.5-d] Fusión de apoyos de borde + estabilización.** `acumularApoyo` fusiona (OR) los GDL en un nudo que sea a la vez borde y estabilización ([discretizar.ts:871-909](../src/discretizador/discretizar.ts#L871)). Verifica que empotrado→DY+RX+RZ, simple→DY, y que la estabilización DX/DZ se **suma** sin borrar lo anterior (mismo bug-clase que el FIX #1 del CR — ver 1.6).
- **[R1.5-e] Presión: signo y reparto.** Presión uniforme repartida a **todos** los quads del paño ([discretizar.ts:911-934](../src/discretizador/discretizar.ts#L911)). Verifica el signo (ver R1.2-b) y que la resultante total = presión × área del paño (ni de más ni de menos por el reparto por quad).

**Cómo verificar:** Capa A para estructura de la malla (nudos/quads/apoyos), Capa B (golden de integración `placa-discretizada.golden.test.ts`) para el número: flecha nodal `DY<0`, Mx/My contra solución de placa conocida si existe, o al menos signo/orden de magnitud y equilibrio.

---

#### 1.6 · Centro de rigidez (CR) FEM-exacto
**Archivos:** [src/discretizador/modeloCR.ts](../src/discretizador/modeloCR.ts), [src/solver/resultadosCR.ts](../src/solver/resultadosCR.ts), [src/solver/ensamblarCR.ts](../src/solver/ensamblarCR.ts), glue `calcular_cr`/`_rigidez_diafragma_planta`/`_cr_de_rigidez` ([pynite_glue.py:935-1205](../src/solver/pynite_glue.py#L935)).
**Qué hace:** impone campos de cuerpo rígido unitarios (ux,uz,θ) por planta, lee reacciones, ensambla K 3×3 del diafragma, y saca `x_cr = xm + K[1][2]/K[1][1]`, `z_cr = zm − K[0][2]/K[0][0]`. Degeneración por `cond(K) > 1e12`. Es un camino **separado** (spike-derivado), no enrutado por `analysis.type`.

**Hipótesis de riesgo (verificar):**
- **[R1.6-a] Fórmula y signos del CR.** [pynite_glue.py:1100-1101](../src/solver/pynite_glue.py#L1100). El spike eligió la formulación de **rigidez** (no la de flexibilidad Cθz/Cθθ). Verifica los signos con un caso simétrico (CR debe caer en el centro geométrico) y uno asimétrico con solución conocida (golden `cr.golden.test.ts`, ya hay 6 casos de motor real).
- **[R1.6-b] `def_support` ASIGNA, no fusiona (FIX #1).** El bug ship-blocker: `def_support` reescribe los 6 flags; el diafragma debe **conservar** DY/RX/RY/RZ del apoyo base y solo forzar DX,DZ ([pynite_glue.py:1047-1053](../src/solver/pynite_glue.py#L1047)). Verifica que un nudo de cimentación empotrado no pierde su sujeción vertical al imponer el diafragma. (Mismo bug-clase que R1.5-d — busca **otros** sitios donde `def_support` pueda sobrescribir sin querer.)
- **[R1.6-c] Detección de cimentación (FIX #2).** Una planta cuyos nudos están **todos** con los 6 GDL True es cimentación (pies de pilar que `nodoFEMAPlanta` etiqueta a la planta más baja), no un forjado: se marca CR null sin analizar ([pynite_glue.py:1167](../src/solver/pynite_glue.py#L1167)). Verifica que no da un CR espurio, y que la detección no marca null por error un forjado real que casualmente tenga todos sus nudos apoyados.
- **[R1.6-d] Degeneración.** `cond(K) > 1e12` → planta no determinable (x/y null), **no** error ([pynite_glue.py:1084-1104](../src/solver/pynite_glue.py#L1084)). Verifica: 1 pilar → null; pilares **colineales** → ¿degeneran o no? (el comentario dice que NO degeneran por su GJ — confirma que eso es correcto y no un CR sin sentido). Un modelo base **inestable** sí es error de obra (distínguelo de planta degenerada).
- **[R1.6-e] "Combo 1" implícito.** El CR lee `RxnFX["Combo 1"]` ([pynite_glue.py:1073](../src/solver/pynite_glue.py#L1073)) porque el payload base llega con `combos:[]`. Verifica que `prepararModeloCR` efectivamente no emite combos de usuario y que ese "Combo 1" es el único.
- **[R1.6-f] ex/ey desde el CM.** El glue emite x/y (CR); el lado TS (`ensamblarResultadosCR`) añade ex/ey (excentricidad = CR − CM). Verifica que CR y CM se comparan en el **mismo sistema de coordenadas** (obra x,y) — el CR sale de FEM (X,Z) que == obra por `mapearEjes`, el CM sale ya en obra. Un desajuste de ejes aquí da una excentricidad girada.

---

#### 1.7 · Centro de masas (CM)
**Archivos:** [src/discretizador/centros.ts](../src/discretizador/centros.ts).
**Qué hace:** centroide ponderado por peso (kN) por planta, en coordenadas de obra. Pilares reparten medio peso a cada forjado que conectan.

**Hipótesis de riesgo (verificar):**
- **[R1.7-a] Reparto de pilares 50/50.** Un pilar aporta 0,5·(A·ρ·L) a cada forjado conectado; si `plantaInicial===plantaFinal` (degenerado), el pilar entero a esa planta ([centros.ts:129-148](../src/discretizador/centros.ts#L129)). Verifica el reparto y el caso degenerado.
- **[R1.7-b] Solo permanentes.** El CM incluye peso propio (siempre, sea cual sea el flag `incluirPesoPropio`, porque la masa es física) + cargas **permanentes** (lineales y nodales). Verifica que **no** cuenta variables, y que no hay **doble cómputo** peso propio vs. cargas (una `Carga` de usuario nunca apunta a la hipótesis automática — confirma ese invariante).
- **[R1.7-c] Atribución de nudo a planta (regla primera-viga).** `plantaDeNudo` replica el desempate del discretizador (primera viga por id) ([centros.ts:84-93](../src/discretizador/centros.ts#L84)). Verifica que coincide **exactamente** con `localizarNodoDeNudo` del discretizador (si divergen, el CM cuenta una carga nodal en una planta distinta a la que el solver le asigna el nodo).
- **[R1.7-d] `cargasMuertas` omitidas.** `Grupo.cargasMuertas` (kN/m²) no se incluye sin paños (no hay área tributaria). Documentado (`T-cm-cargas-muertas`). Fuera de alcance **salvo** que descubras que se cuentan a medias en algún sitio.

---

#### 1.8 · Transversal del cálculo (aplica a TODO el Tier 1)
Revisa estas cuatro convenciones **en cada módulo** que toques; son las fuentes de error nº1 del proyecto (lo dice el propio `CLAUDE.md`):

- **Signos.** Gravedad = FY global **negativa** para barras; presión de quad **positiva** hacia abajo (convención OPUESTA — verifica el acoplamiento `-valor`). El signo se decide en **un único punto** (`signoGravitatorio`, [discretizar.ts:127](../src/discretizador/discretizar.ts#L127)) — confirma que ningún otro sitio vuelve a aplicar un signo (doble signo = error nº1).
- **Ejes.** Obra (x,y) + cota → FEM `[x, cota, y]` = `[X, Y, Z]` (Y-up). La escena R3F es **Z-up**: hay una conversión FEM(Y-up)→escena(Z-up) en la UI (gotcha documentado de feature-14). Verifica que `mapearEjes` es la **única** traducción obra→FEM y que la de FEM→escena está aislada en la UI.
- **Unidades.** Todo interno en **kN, m** (y derivados). Conversión **solo en los bordes** (`src/unidades`, `resolverSeccion`, biblioteca). Busca cualquier factor numérico "a mano" (1000, 1e-4, 9.81, /2...) fuera de `src/unidades` y de las tablas de biblioteca: cada uno es sospechoso de conversión filtrada a la lógica.
- **Determinismo.** Ordenar antes de numerar. Ver R1.1-e.

---

### TIER 2 — Fronteras de datos (corrupción / falsear datos)

#### 2.1 · Unidades
**Archivos:** [src/unidades/conversion.ts](../src/unidades/conversion.ts), [index.ts](../src/unidades/index.ts).
**Hipótesis:** verifica cada conversión (`mmToM`, `mpaToInterno` = ×1000, `cm2ToM2`=×1e-4, `cm4ToM4`=×1e-8) con un caso numérico. Confirma que **fuerzas/momentos/cargas** ya están en interno (identidad, sin conversión). Busca conversiones **duplicadas** (un valor convertido dos veces) o **ausentes** (un valor de catálogo que entra sin convertir).

#### 2.2 · Biblioteca de materiales y secciones
**Archivos:** [src/biblioteca/hormigon.ts](../src/biblioteca/hormigon.ts), [aceros.ts](../src/biblioteca/aceros.ts), [perfiles.ts](../src/biblioteca/perfiles.ts), [tipos.ts](../src/biblioteca/tipos.ts).
**Hipótesis:**
- **[R2.2-a] Ecm del hormigón.** `derivarEcm = 22000·(fcm/10)^0,3`, `fcm=fck+8` ([hormigon.ts:60-63](../src/biblioteca/hormigon.ts#L60)). Verifica contra Código Estructural Anejo 19 Tabla A19.3.1 / EC2 Tabla 3.1. Comprobación informativa del comentario: fck25→≈31476 MPa, fck30→≈32837, fck35→≈34077. Confirma que **no** es la fórmula EHE derogada.
- **[R2.2-b] G derivado.** `G = E/(2(1+ν))`, ν=0,2 ([hormigon.ts:86](../src/biblioteca/hormigon.ts#L86)). Correcto para isótropo; verifica ν y la conversión MPa→kN/m² de E, G, fck, Ecm.
- **[R2.2-c] Inercias de sección paramétrica.** Rectangular: `Iy=b·h³/12`, `Iz=h·b³/12`, `J=0`; circular: `Iy=Iz=π·r⁴/4`, `J=π·r⁴/2` ([hormigon.ts:129-172](../src/biblioteca/hormigon.ts#L129)). Verifica la **asignación de ejes** Iy/Iz (¿qué eje es `b` y cuál `h`?) contra la convención de `add_section` de PyNite — un intercambio Iy↔Iz flecta mal la barra en su eje débil/fuerte. Verifica `J=0` rectangular (§5: ¿puede volver singular el modelo?) y `J=π·r⁴/2` circular (correcto solo en macizo).
- **[R2.2-d] Perfiles laminados.** [perfiles.ts](../src/biblioteca/perfiles.ts): A (cm²), Iy/Iz/J (cm⁴) tabulados → conversión cm→m en el borde. Verifica una muestra (p. ej. un IPE y un HEB) de A/Iy/Iz/J contra catálogo EN 10365, y que la conversión `cm2ToM2`/`cm4ToM4` se aplica.
- **[R2.2-e] Aceros.** [aceros.ts](../src/biblioteca/aceros.ts): E, ν, G, fy de S235/S275/S355. Verifica E=210000 MPa, ν=0,3, y fy por grado contra EC3.

#### 2.3 · Esquemas Zod (contratos de borde)
**Archivos:** [contratoFEM.ts](../src/discretizador/contratoFEM.ts), [resultados.ts](../src/solver/resultados.ts), [resultadosModales.ts](../src/solver/resultadosModales.ts), [persistencia/esquema.ts](../src/persistencia/esquema.ts).
**Hipótesis:**
- **[R2.3-a] Optional vs default en quads.** La memoria avisa: `quads`/`quad_loads` son `.optional()` **NO `.default([])`** (un default rompía los literales / la regresión byte-a-byte del pórtico sin placas). Verifica que un modelo de barras produce Capa 2 y resultados **sin** esas claves, y que los consumidores leen `?? []`/`?? {}`.
- **[R2.3-b] El discretizador valida su salida.** `ModeloFEMSchema.parse(modeloFEM)` al final ([discretizar.ts:1058](../src/discretizador/discretizar.ts#L1058)) — si lanza es bug interno. Verifica que el schema es tan estricto como para atrapar una Capa 2 malformada (direcciones de carga fuera de FX..MZ/Fx..Mz, releases de longitud ≠12, etc.).
- **[R2.3-c] Frontera de resultados.** El Zod que valida `ResultadosCalculo` al volver del worker: ¿acepta `Inf`? (la memoria nota que Zod rechaza `NaN` pero **acepta `Inf`** → un modo modal "infinito Hz" espurio; por eso el glue filtra no-finitos). Verifica que la frontera rechaza lo que debe.

#### 2.4 · Persistencia, import/export, migraciones
**Archivos:** [src/persistencia/](../src/persistencia/): `repositorio.ts`, `serializacion.ts`, `esquema.ts`, `autosave.ts`, `plantillas/`.
**Hipótesis:**
- **[R2.4-a] Importar no puede romper la app (regla de oro #8).** Alimenta `migrarYValidar` con JSON **corrupto/parcial/versión antigua** (v1, v2, v3) y con campos extra/tipos mal. Debe rechazar limpio con mensaje, nunca dejar el store en estado inválido. Fuzzing ligero: quita claves, mete `null`, cambia tipos.
- **[R2.4-b] Migraciones.** `SCHEMA_VERSION=3`; v2→v3 **descarta paños-stub**. Verifica que la migración no pierde datos reales ni deja referencias colgantes (una carga que apuntaba a un paño descartado). Solo se persiste **Capa 1** (Capa 2 y resultados se regeneran — confirma que no se guardan por error).
- **[R2.4-c] Autosave y multi-proyecto.** Debounce, aislamiento entre proyectos (Dexie). Verifica que un autosave a medias no corrompe el proyecto previo.

---

### TIER 3 — UI numérica (lo que el usuario ve)

#### 3.1 · Deformada y mapeo de ejes
**Archivos:** [src/ui/resultados/deformadaBuffers.ts](../src/ui/resultados/deformadaBuffers.ts), `deformadaGeometria.*`, overlays de `src/ui/resultados/`.
**Hipótesis:** el gotcha documentado: FEM Y-up → escena Z-up. Verifica que la deformada se dibuja en el eje correcto (una viga que flecta hacia abajo en el modelo se ve hacia abajo en pantalla), que la **escala de deformada** no distorsiona el signo, y que `deformada_global` (del glue) se consume con la misma convención con que se generó.

#### 3.2 · Diagramas N/V/M
**Archivos:** [src/ui/resultados/diagramaLazy.ts](../src/ui/resultados/diagramaLazy.ts), consumidores de Plotly.
**Hipótesis:** signo y orientación de los diagramas (momento positivo tracciona la fibra... ¿qué cara?; convención de dibujo). Que el pico etiquetado (`max_moment_z`/`min_moment_z`) casa con el diagrama. Plotly va **lazy** (aislado tras `<DiagramaBarra>`): verifica que un fallo de carga de Plotly no rompe la pestaña de resultados.

#### 3.3 · Snapping de la UI vs. discretizador
**Archivos:** [src/ui/viewport/snap.ts](../src/ui/viewport/snap.ts), [imanViga.ts](../src/ui/viewport/imanViga.ts), [dxf/snapDxf.ts](../src/ui/viewport/dxf/snapDxf.ts) vs. `TOL_NODO` del discretizador.
**Hipótesis (importante):** si la tolerancia de imán de la UI **difiere** de `TOL_NODO` del discretizador, el usuario puede colocar dos elementos que la UI muestra "unidos" pero el discretizador trata como nudos distintos (o al revés). Compara los valores y la semántica. Es una fuente clásica de "por qué mi estructura sale con un mecanismo si yo la dibujé conectada".

#### 3.4 · Isovalores (F3)
**Archivos:** [src/ui/resultados/isovaloresBuffers.ts](../src/ui/resultados/isovaloresBuffers.ts), [IsovaloresOverlay.tsx](../src/ui/resultados/IsovaloresOverlay.tsx), [PanelIsovalores.tsx](../src/ui/resultados/PanelIsovalores.tsx), [LeyendaRampa.tsx](../src/ui/resultados/LeyendaRampa.tsx), y el promediado a nudos (`quadANodos`).
**Hipótesis:** Mx/My se promedian de esquinas de quad a nudos ([discretizar.ts](../src/discretizador/discretizar.ts) trazabilidad `quadANodos`). Verifica que el promediado no mezcla componentes de quads con ejes locales inconsistentes (depende de R1.5-a), que la rampa de color mapea el rango correcto (deuda `T-f3-isovalores-rango-panel` — revisa si el rango es correcto o solo cosmético), y que la flecha nodal se lee del nudo correcto.

---

### TIER 4 — Estado y undo/redo

**Archivos:** [src/estado/comandos/comandosModelo.ts](../src/estado/comandos/comandosModelo.ts), [comando.ts](../src/estado/comandos/comando.ts), [pilaUndo.ts](../src/estado/comandos/pilaUndo.ts), stores (`modeloStore`, `resultadosStore`, `crStore`, `modalStore`, `calculoStore`, `vistaStore`).
**Qué hace:** comandos con patches de Immer (delta) para undo/redo; cascadas en borrado; invalidación de resultados al editar.

**Hipótesis de riesgo (verificar):**
- **[R4-a] Reversibilidad exacta.** Aplica una secuencia de comandos (crear/mover/editar/eliminar pilar, viga, grupo, planta, carga, hipótesis, paño), deshaz todo y compara el modelo con el inicial **byte a byte**. Cualquier comando cuyo `revertir` no restaure exactamente es un hallazgo (undo que "casi" restaura corrompe el modelo poco a poco).
- **[R4-b] Cascadas.** Borrar un grupo borra sus plantas; borrar una planta/nudo/sección en uso, ¿deja referencias colgantes (una viga apuntando a un nudo borrado, una carga a un ámbito inexistente)? Verifica que la cascada es completa y reversible en un solo undo.
- **[R4-c] Invalidación de resultados.** Al editar la Capa 1, `resultadosStore`/`crStore`/`modalStore` deben invalidarse (los esfuerzos/deformada dejan de ser válidos). Verifica que **no** queda visible un resultado obsoleto tras una edición (mostrar una deformada de un modelo que ya cambió es un error de correctitud percibida).
- **[R4-d] Coalescing.** Ediciones continuas (arrastrar) se agrupan por `coalesceKey`. Verifica que un arrastre completo es **un** undo, no N, y que el coalescing no fusiona dos acciones distintas.

---

## 7. Checklist transversal (marca en cada módulo auditado)

- [ ] **Signos** verificados contra fórmula cerrada (no contra el comentario).
- [ ] **Ejes** (obra→FEM→escena) coherentes; una sola traducción por frontera.
- [ ] **Unidades** kN-m internas; sin factores a mano fuera de `src/unidades`/biblioteca.
- [ ] **Determinismo** byte-a-byte ante reordenación de la entrada.
- [ ] **Floats** — sin `===` sobre magnitudes calculadas donde debería haber tolerancia.
- [ ] **Zod** en la frontera; importar datos corruptos no rompe la app.
- [ ] **Pureza** — dominio y discretizador sin React/IO/Pyodide (regla de oro).
- [ ] **Avisos vs. bloqueos** — nada descarta carga/rigidez real en silencio.

---

## 8. Orden de ejecución sugerido

1. **Baseline** (§2) — imprescindible antes de nada.
2. **Tier 1.1 + 1.2 + 1.8** (discretizador + glue + transversales) — el 70% del riesgo real vive aquí. Empieza por los signos (R1.2-a/b) y el determinismo (R1.1-e).
3. **Tier 1.3 + 1.4** (combinaciones + peso propio) — normativa + unidades.
4. **Tier 1.5 + 1.6 + 1.7** (losa + CR + CM) — lo más nuevo (F2-CR, F3), donde la implementación es más reciente y menos rodada.
5. **Tier 2** (fronteras de datos) — en paralelo con `experto-persistencia-testing`.
6. **Tier 3 + 4** (UI numérica + estado) — importante pero el fallo suele ser visible, no silencioso.

Sugerencia de paralelización: lanza los subagentes de dominio sobre 1.x en paralelo; consolida sus hallazgos tú, deduplica y **verifica cada uno con su propio test** antes de darlo por bueno (un hallazgo de subagente sin test reproducible es una sospecha, no un hallazgo).

---

## 9. Entregable final

En `auditoria/INFORME.md`:
1. **Resumen ejecutivo** — nº de hallazgos por severidad; los 3-5 más importantes en una línea cada uno; veredicto general de salud del cálculo.
2. **Hallazgos** — con el formato de §4, ordenados por severidad, cada Alto/Crítico con su prueba (commit del test rojo) y su fix propuesto (commit separado).
3. **Zonas auditadas sin hallazgos** — di explícitamente qué revisaste y salió limpio (tan valioso como los hallazgos: acota la confianza).
4. **Cobertura y limitaciones de la auditoría** — qué no llegaste a cubrir y por qué; qué hallazgos quedaron *Sin confirmar* y qué haría falta para confirmarlos.
5. **Apéndice cosmético** — deuda menor agregada.

**No integres nada a `main`.** El usuario revisará el informe y los fixes propuestos y decidirá qué entra.

---

## 10. Recordatorios finales

- El código está **muy bien comentado y muy testeado**. Eso es bueno, pero **no bajes la guardia**: los comentarios afirman intención; algunos gotchas se descubrieron tarde (el signo de la presión de losa era estable pero mal, e **invisible al golden de gate** hasta que se añadió un golden de integración). Los bugs que quedan serán exactamente de ese tipo: **plausibles, comentados como correctos, y solo detectables con un test que ataque el número final del pipeline completo**. Prioriza los golden de **integración** (obra real → discretizar → motor real → número) sobre los tests de unidad que montan la Capa 2 a mano.
- Cuando dudes entre "es un bug" y "es una decisión de fase", pregúntate: **¿esto puede mostrar un número estructural incorrecto como si fuera válido?** Si sí, es hallazgo, cueste lo que cueste catalogarlo.
```